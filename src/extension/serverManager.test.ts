// Tests for `serverManager.ts` (issues #8 and #10).
//
// What they protect: the rules of WHEN the server starts and stops (usable detection starts it,
// a fixed setting recovers without a reload, plan B for port 0, stop is idempotent and final,
// an unexpected exit is reported, nothing starts without a folder) and the texts of the
// notifications. Phase 3 adds the restart rules: a restart is serialized, aborts a start in
// progress without a spurious `start-failed`, a crash is retried after 1 s / 5 s / 15 s and then
// given up, a server that lived 120 s resets the counter, `stop()` cancels a pending retry (a
// server launched after the window began closing would be an orphan), a changed binary or folder
// restarts a running server, and the multi-root folder choice. Everything here is SYNTHETIC:
// `start`, `stop`, `fetchInfo`, the timer and the clock are fakes and the "child" is an
// EventEmitter, so these tests say nothing about real processes (those are in
// `opencodeServer.test.ts`, against the fixture, and in the opt-in `realOpencode.test.ts`) nor
// about a real opencode (UNVERIFIED).

import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { DetectionResult } from './opencodeBinary';
import {
  ServerStartError,
  startServer,
  stopServer,
  type RunningServer,
  type ServerInfo,
  type StartServerOptions,
} from './opencodeServer';
import {
  AUTO_RESTART_DELAYS_MS,
  describeServerFailure,
  describeServerState,
  pickWorkspaceFolder,
  ServerManager,
  STABLE_RUN_MS,
  type ServerState,
} from './serverManager';

const okResult = (binaryPath = '/bin/opencode'): DetectionResult => ({
  kind: 'ok',
  binary: { path: binaryPath, source: 'opencode', version: '2.0.32' },
  attempts: [],
});
const notFound: DetectionResult = { kind: 'not-found', attempts: [] };
const unsupported: DetectionResult = {
  kind: 'unsupported',
  binary: { path: '/bin/opencode', source: 'opencode', version: '1.19.3' },
  attempts: [],
};

/**
 * Builds a fake `RunningServer`. The single cast is on purpose: the manager only uses `pid` and
 * the `exit` event of the child, and building a real `ChildProcess` would need a real process.
 */
function fakeServer(exitCode: number | null = null): RunningServer {
  const child = Object.assign(new EventEmitter(), { pid: 4242, exitCode, signalCode: null });
  return {
    child: child as unknown as RunningServer['child'],
    url: 'http://127.0.0.1:5555',
    password: 'secret',
  };
}

/** Builds a manager over fakes; `start`, `stop` and `fetchInfo` can be overridden per test. */
function harness(
  overrides: {
    start?: (options: StartServerOptions) => Promise<RunningServer>;
    fetchInfo?: (url: string, password: string, signal: AbortSignal) => Promise<ServerInfo>;
    stop?: (server: RunningServer) => Promise<unknown>;
  } = {},
) {
  const messages: string[] = [];
  const push = (message: string): void => {
    messages.push(message);
  };
  const created: RunningServer[] = [];
  const start = vi.fn(
    overrides.start ??
      (() => {
        const server = fakeServer();
        created.push(server);
        return Promise.resolve(server);
      }),
  );
  const stop = vi.fn(
    overrides.stop ??
      ((server: RunningServer) => {
        server.child.emit('exit', 0, null);
        return Promise.resolve({ how: 'stdin' });
      }),
  );
  const fetchInfo = vi.fn(
    overrides.fetchInfo ?? (() => Promise.resolve({ version: '2.0.32', pid: 4242 })),
  );
  // Manual timer and clock: the backoff is observed and fired by hand, nothing really waits.
  const timers: Array<{ ms: number; fn: () => void; cancelled: boolean }> = [];
  let clock = 0;
  const manager = new ServerManager({
    start,
    stop,
    fetchInfo,
    log: { info: push, warn: push, error: push, debug: push },
    schedule: (ms, fn) => {
      const timer = { ms, fn, cancelled: false };
      timers.push(timer);
      return {
        cancel: () => {
          timer.cancelled = true;
        },
      };
    },
    now: () => clock,
  });
  const states: ServerState[] = [];
  manager.onDidChangeState((state) => states.push(state));
  return {
    manager,
    start,
    stop,
    fetchInfo,
    messages,
    states,
    created,
    timers,
    advance: (ms: number): void => {
      clock += ms;
    },
    /** Fires the newest timer that is still armed, like the clock reaching it. */
    fire: (): void => {
      const armed = timers.filter((timer) => !timer.cancelled);
      const last = armed[armed.length - 1];
      if (last === undefined) throw new Error('no armed timer');
      last.cancelled = true;
      last.fn();
    },
  };
}

/** Resolves once the manager reaches `kind`, failing with the states seen so far otherwise. */
async function reach(manager: ServerManager, kind: ServerState['kind']): Promise<void> {
  await vi.waitFor(() => {
    expect(manager.state.kind).toBe(kind);
  });
}

const folderChoice = { folder: '/work/project', ignored: [] };

describe('pickWorkspaceFolder', () => {
  it('reports no workspace for undefined, an empty list and a virtual scheme', () => {
    expect(pickWorkspaceFolder(undefined)).toMatchObject({ reason: 'no-workspace' });
    expect(pickWorkspaceFolder([])).toMatchObject({ reason: 'no-workspace' });
    const virtual = [{ uri: { scheme: 'vscode-vfs', fsPath: '/x' }, name: 'remote' }];
    expect(pickWorkspaceFolder(virtual)).toMatchObject({ reason: 'no-workspace' });
  });

  it('takes the first folder and lists the others as ignored', () => {
    const folders = [
      { uri: { scheme: 'file', fsPath: '/a' }, name: 'a' },
      { uri: { scheme: 'file', fsPath: '/b' }, name: 'b' },
    ];
    expect(pickWorkspaceFolder(folders)).toEqual({ folder: '/a', ignored: ['/b'] });
  });

  it('takes the preferred folder while it is still open and on disk', () => {
    const folders = [
      { uri: { scheme: 'file', fsPath: '/a' }, name: 'a' },
      { uri: { scheme: 'file', fsPath: '/b' }, name: 'b' },
    ];
    expect(pickWorkspaceFolder(folders, '/b')).toEqual({ folder: '/b', ignored: ['/a'] });
  });

  it('falls back to the first folder when the preferred one was removed', () => {
    const folders = [
      { uri: { scheme: 'file', fsPath: '/a' }, name: 'a' },
      { uri: { scheme: 'file', fsPath: '/c' }, name: 'c' },
    ];
    expect(pickWorkspaceFolder(folders, '/b')).toEqual({ folder: '/a', ignored: ['/c'] });
  });

  it('skips a virtual first folder and serves the first one on disk', () => {
    const folders = [
      { uri: { scheme: 'vscode-vfs', fsPath: '/x' }, name: 'remote' },
      { uri: { scheme: 'file', fsPath: '/b' }, name: 'b' },
    ];
    expect(pickWorkspaceFolder(folders)).toEqual({ folder: '/b', ignored: ['/x'] });
  });

  it('never serves a preferred folder that is not on disk', () => {
    const folders = [
      { uri: { scheme: 'file', fsPath: '/a' }, name: 'a' },
      { uri: { scheme: 'vscode-vfs', fsPath: '/x' }, name: 'remote' },
    ];
    expect(pickWorkspaceFolder(folders, '/x')).toMatchObject({ folder: '/a' });
  });
});

describe('ServerManager', () => {
  it('a usable detection goes starting -> running and exposes the connection data', async () => {
    const { manager, start, states } = harness();
    manager.setFolder(folderChoice);
    manager.onDetection(okResult());
    await vi.waitFor(() => {
      expect(manager.state.kind).toBe('running');
    });
    expect(states.map((s) => s.kind)).toEqual(['starting', 'running']);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ command: '/bin/opencode', folder: '/work/project', port: 0 }),
    );
    expect(manager.state).toMatchObject({
      kind: 'running',
      server: {
        url: 'http://127.0.0.1:5555',
        password: 'secret',
        version: '2.0.32',
        folder: '/work/project',
        binaryPath: '/bin/opencode',
        pid: 4242,
      },
    });
  });

  it('not-found becomes binary-missing without starting; a later ok starts without a reload', async () => {
    const { manager, start } = harness();
    manager.setFolder(folderChoice);
    manager.onDetection(notFound);
    expect(manager.state).toMatchObject({ kind: 'unavailable', reason: 'binary-missing' });
    expect(start).not.toHaveBeenCalled();
    manager.onDetection(okResult());
    await vi.waitFor(() => {
      expect(manager.state.kind).toBe('running');
    });
  });

  it('an unsupported detection is unsupported-version and /api/info with major 1 stops the server', async () => {
    const first = harness();
    first.manager.setFolder(folderChoice);
    first.manager.onDetection(unsupported);
    expect(first.manager.state).toMatchObject({
      kind: 'unavailable',
      reason: 'unsupported-version',
    });

    const { manager, stop } = harness({
      fetchInfo: () => Promise.resolve({ version: '1.19.3', pid: 1 }),
    });
    manager.setFolder(folderChoice);
    manager.onDetection(okResult());
    await vi.waitFor(() => {
      expect(manager.state.kind).toBe('unavailable');
    });
    expect(manager.state).toMatchObject({ reason: 'unsupported-version' });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('a different version only warns and keeps running; a failing /api/info is start-failed', async () => {
    const warn = harness({ fetchInfo: () => Promise.resolve({ version: '2.0.40', pid: 1 }) });
    warn.manager.setFolder(folderChoice);
    warn.manager.onDetection(okResult());
    await vi.waitFor(() => {
      expect(warn.manager.state.kind).toBe('running');
    });
    expect(warn.messages.some((m) => m.includes('2.0.40'))).toBe(true);

    const fail = harness({
      fetchInfo: () => Promise.reject(new Error('GET /api/info failed: HTTP 401')),
    });
    fail.manager.setFolder(folderChoice);
    fail.manager.onDetection(okResult());
    await vi.waitFor(() => {
      expect(fail.manager.state.kind).toBe('unavailable');
    });
    expect(fail.manager.state).toMatchObject({ reason: 'start-failed' });
    expect(fail.stop).toHaveBeenCalledTimes(1);
  });

  it('a different binary while running restarts the server with the new one (issue #10)', async () => {
    const { manager, start, stop, states, created } = harness();
    manager.setFolder(folderChoice);
    manager.onDetection(okResult('/bin/one'));
    await reach(manager, 'running');
    const before = states.length;
    manager.onDetection(okResult('/bin/two'));
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledTimes(2);
      expect(manager.state.kind).toBe('running');
    });
    expect(start.mock.calls[1]?.[0].command).toBe('/bin/two');
    expect(stop).toHaveBeenCalledWith(created[0]);
    expect(states.slice(before).map((s) => s.kind)).toEqual(['restarting', 'starting', 'running']);
    expect(states[before]).toEqual({ kind: 'restarting', reason: 'binary-changed' });
  });

  it('stop() during startup aborts, ends in stopped, is idempotent and final', async () => {
    const { manager, start } = harness({
      start: (options) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new ServerStartError('aborted', 'cancelled'));
          });
        }),
    });
    manager.setFolder(folderChoice);
    manager.onDetection(okResult());
    expect(manager.state.kind).toBe('starting');
    const first = manager.stop();
    expect(manager.stop()).toBe(first);
    await first;
    expect(manager.state.kind).toBe('stopped');
    manager.onDetection(okResult('/bin/other'));
    expect(start).toHaveBeenCalledTimes(1);
    expect(manager.state.kind).toBe('stopped');
  });

  it('stop() when a start finishes after it stops the late server', async () => {
    let finish: (server: RunningServer) => void = () => undefined;
    const late = fakeServer();
    const { manager, stop } = harness({
      start: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    manager.setFolder(folderChoice);
    manager.onDetection(okResult());
    const stopping = manager.stop();
    finish(late);
    await stopping;
    expect(stop).toHaveBeenCalledWith(late);
    expect(manager.state.kind).toBe('stopped');
  });

  it('stop() while /api/info is in flight aborts the request at once and stops the server', async () => {
    // Protects the review fix (CRITICAL): the attempt's signal reaches `fetchInfo`, so `stop()`
    // does not wait out the request timeout (5 s) before stopping the server. The fake request
    // never answers and only ends when the signal fires.
    let received: AbortSignal | undefined;
    const { manager, stop, states } = harness({
      fetchInfo: (_url, _password, signal) =>
        new Promise((_resolve, reject) => {
          received = signal;
          signal.addEventListener('abort', () => {
            reject(new Error('GET /api/info failed: aborted'));
          });
        }),
    });
    manager.setFolder(folderChoice);
    manager.onDetection(okResult());
    await vi.waitFor(() => {
      expect(received).toBeDefined();
    });
    const started = Date.now();
    await manager.stop();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(received?.aborted).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(manager.state.kind).toBe('stopped');
    expect(states.some((s) => s.kind === 'unavailable')).toBe(false);
  });

  it('a child that exited while /api/info was pending is reported as exited, not running', async () => {
    // Protects the review fix (SUGGESTION): the `exit` listener is registered after the await, so
    // an exit in that window must be detected by reading `exitCode`. Synthetic child.
    const dead = fakeServer(1);
    const { manager } = harness({ start: () => Promise.resolve(dead) });
    manager.setFolder(folderChoice);
    manager.onDetection(okResult());
    await vi.waitFor(() => {
      expect(manager.state.kind).toBe('unavailable');
    });
    expect(manager.state).toMatchObject({ reason: 'exited' });
  });

  it('a different binary detected during a start that succeeds is not dropped: it restarts with it', async () => {
    const first = fakeServer();
    const second = fakeServer();
    const start = vi
      .fn<(options: StartServerOptions) => Promise<RunningServer>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            // Resolved by hand below, after the second detection arrived.
            setTimeout(() => {
              resolve(first);
            }, 0);
          }),
      )
      .mockResolvedValueOnce(second);
    const { manager } = harness({ start });
    manager.setFolder(folderChoice);
    manager.onDetection(okResult('/bin/one'));
    manager.onDetection(okResult('/bin/two'));
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledTimes(2);
      expect(manager.state.kind).toBe('running');
    });
    expect(start.mock.calls[1]?.[0].command).toBe('/bin/two');
  });

  it('port 0 in the url relaunches once without --port; a second failure is start-failed', async () => {
    const portZero = new ServerStartError('port-zero', 'port 0');
    const recovered = harness({
      start: vi
        .fn<(options: StartServerOptions) => Promise<RunningServer>>()
        .mockRejectedValueOnce(portZero)
        .mockResolvedValueOnce(fakeServer()),
    });
    recovered.manager.setFolder(folderChoice);
    recovered.manager.onDetection(okResult());
    await vi.waitFor(() => {
      expect(recovered.manager.state.kind).toBe('running');
    });
    expect(recovered.start).toHaveBeenCalledTimes(2);
    expect(recovered.start.mock.calls[0]?.[0].port).toBe(0);
    expect(recovered.start.mock.calls[1]?.[0].port).toBeUndefined();

    const failed = harness({ start: () => Promise.reject(portZero) });
    failed.manager.setFolder(folderChoice);
    failed.manager.onDetection(okResult());
    await vi.waitFor(() => {
      expect(failed.manager.state.kind).toBe('unavailable');
    });
    expect(failed.manager.state).toMatchObject({ reason: 'start-failed' });
    expect(failed.start).toHaveBeenCalledTimes(2);
  });

  it('an unexpected exit is unavailable/exited; the exit caused by stop() is not', async () => {
    const unexpected = harness();
    unexpected.manager.setFolder(folderChoice);
    unexpected.manager.onDetection(okResult());
    await vi.waitFor(() => {
      expect(unexpected.manager.state.kind).toBe('running');
    });
    unexpected.created[0]?.child.emit('exit', 1, null);
    expect(unexpected.manager.state).toMatchObject({ kind: 'unavailable', reason: 'exited' });

    const orderly = harness();
    orderly.manager.setFolder(folderChoice);
    orderly.manager.onDetection(okResult());
    await vi.waitFor(() => {
      expect(orderly.manager.state.kind).toBe('running');
    });
    await orderly.manager.stop();
    expect(orderly.manager.state.kind).toBe('stopped');
    expect(orderly.states.some((s) => s.kind === 'unavailable')).toBe(false);
  });

  it('without a folder nothing starts even with a good detection', () => {
    const { manager, start } = harness();
    manager.setFolder(pickWorkspaceFolder(undefined));
    manager.onDetection(okResult());
    expect(start).not.toHaveBeenCalled();
    expect(manager.state).toMatchObject({ kind: 'unavailable', reason: 'no-workspace' });
  });

  it('a usable detection that arrives during startup is retried once if the attempt fails', async () => {
    let rejectFirst: (error: Error) => void = () => undefined;
    const start = vi
      .fn<(options: StartServerOptions) => Promise<RunningServer>>()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce(fakeServer());
    const { manager } = harness({ start });
    manager.setFolder(folderChoice);
    manager.onDetection(okResult('/bin/broken'));
    manager.onDetection(okResult('/bin/fixed'));
    rejectFirst(new Error('spawn failed'));
    await vi.waitFor(() => {
      expect(manager.state.kind).toBe('running');
    });
    expect(start.mock.calls[1]?.[0].command).toBe('/bin/fixed');
  });
});

describe('restart (issue #10)', () => {
  /** A manager already `running` on `/bin/opencode` in `/work/project`. */
  async function running(overrides: Parameters<typeof harness>[0] = {}) {
    const h = harness(overrides);
    h.manager.setFolder(folderChoice);
    h.manager.onDetection(okResult());
    await reach(h.manager, 'running');
    return h;
  }

  it('goes restarting -> starting -> running, stops the old server and reuses the binary and folder', async () => {
    const { manager, start, stop, states, created } = await running();
    const before = states.length;
    await expect(manager.restart('command')).resolves.toBe('attempted');
    expect(states.slice(before).map((s) => s.kind)).toEqual(['restarting', 'starting', 'running']);
    expect(states[before]).toEqual({ kind: 'restarting', reason: 'command' });
    expect(stop).toHaveBeenCalledWith(created[0]);
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1]?.[0]).toMatchObject({
      command: '/bin/opencode',
      folder: '/work/project',
    });
  });

  it('two restarts at once share one stop and one start', async () => {
    const { manager, start, stop } = await running();
    const first = manager.restart('command');
    const second = manager.restart('command');
    expect(second).toBe(first);
    await first;
    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('aborts a start in progress without publishing a spurious start-failed', async () => {
    const start = vi
      .fn<(options: StartServerOptions) => Promise<RunningServer>>()
      .mockImplementationOnce(
        (options) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(new ServerStartError('aborted', 'cancelled'));
            });
          }),
      )
      .mockResolvedValueOnce(fakeServer());
    const { manager, states } = harness({ start });
    manager.setFolder(folderChoice);
    manager.onDetection(okResult());
    expect(manager.state.kind).toBe('starting');
    await manager.restart('command');
    expect(manager.state.kind).toBe('running');
    expect(states.some((s) => s.kind === 'unavailable')).toBe(false);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('answers no-binary before any detection and no-workspace for a command without a folder', async () => {
    const bare = harness();
    bare.manager.setFolder(folderChoice);
    await expect(bare.manager.restart('command')).resolves.toBe('no-binary');
    expect(bare.start).not.toHaveBeenCalled();

    const none = harness();
    none.manager.onDetection(okResult());
    none.manager.setFolder(pickWorkspaceFolder(undefined));
    await expect(none.manager.restart('command')).resolves.toBe('no-workspace');
    expect(none.start).not.toHaveBeenCalled();
  });

  it('a restart after stop() does nothing', async () => {
    const { manager, start } = await running();
    await manager.stop();
    await expect(manager.restart('command')).resolves.toBe('disposed');
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('a different folder restarts a running server; the same one does not', async () => {
    const { manager, start, states } = await running();
    manager.setFolder({ folder: '/work/project', ignored: [] });
    expect(start).toHaveBeenCalledTimes(1);
    manager.setFolder({ folder: '/work/other', ignored: [] });
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledTimes(2);
      expect(manager.state.kind).toBe('running');
    });
    expect(start.mock.calls[1]?.[0].folder).toBe('/work/other');
    expect(states.find((s) => s.kind === 'restarting')).toEqual({
      kind: 'restarting',
      reason: 'folder-changed',
    });
  });

  /**
   * A manager running, whose SECOND start (the one of a restart) waits for `release()`. Lets a test
   * change the folder or the binary while the relaunch of a restart is in `starting` (W1).
   */
  async function restartHeldInStarting() {
    const servers = [fakeServer(), fakeServer(), fakeServer()];
    let call = 0;
    let release: () => void = () => undefined;
    const h = harness({
      start: () => {
        const server = servers[call++] ?? fakeServer();
        if (call !== 2) return Promise.resolve(server);
        return new Promise((resolve) => {
          release = () => {
            resolve(server);
          };
        });
      },
    });
    h.manager.setFolder(folderChoice);
    h.manager.onDetection(okResult());
    await reach(h.manager, 'running');
    const restarting = h.manager.restart('command');
    await vi.waitFor(() => {
      expect(h.start).toHaveBeenCalledTimes(2);
    });
    return { ...h, restarting, release: () => release() };
  }

  it('a folder change during the relaunch of a restart is not lost: it restarts again on the new folder', async () => {
    const { manager, start, restarting, release } = await restartHeldInStarting();
    manager.setFolder({ folder: '/work/other', ignored: [] });
    release();
    await restarting;
    await vi.waitFor(() => {
      expect(manager.state.kind).toBe('running');
    });
    expect(start).toHaveBeenCalledTimes(3);
    expect(start.mock.calls[2]?.[0].folder).toBe('/work/other');
    expect(manager.state).toMatchObject({ server: { folder: '/work/other' } });
  });

  it('a binary change during the relaunch of a restart is not lost either', async () => {
    const { manager, start, restarting, release } = await restartHeldInStarting();
    manager.onDetection(okResult('/bin/two'));
    release();
    await restarting;
    await vi.waitFor(() => {
      expect(manager.state.kind).toBe('running');
    });
    expect(start).toHaveBeenCalledTimes(3);
    expect(start.mock.calls[2]?.[0].command).toBe('/bin/two');
  });

  it('losing every folder stops the server and reports no-workspace', async () => {
    const { manager, stop, created } = await running();
    manager.setFolder(pickWorkspaceFolder([]));
    await reach(manager, 'unavailable');
    expect(manager.state).toMatchObject({ reason: 'no-workspace' });
    expect(stop).toHaveBeenCalledWith(created[0]);
  });

  it('logs the folder it serves', () => {
    const { manager, messages } = harness();
    manager.setFolder({ folder: '/work/project', ignored: ['/work/other'] });
    expect(messages).toContain('serving folder /work/project');
    expect(messages.some((m) => m.includes('/work/other'))).toBe(true);
  });
});

describe('automatic restart after a crash (issue #10)', () => {
  async function running() {
    const h = harness();
    h.manager.setFolder(folderChoice);
    h.manager.onDetection(okResult());
    await reach(h.manager, 'running');
    return h;
  }

  it('retries after 1 s, 5 s and 15 s and then gives up, notifying only then', async () => {
    const h = await running();
    expect([...AUTO_RESTART_DELAYS_MS]).toEqual([1000, 5000, 15000]);
    const seen: Array<ServerState> = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      h.created.at(-1)?.child.emit('exit', 1, null);
      expect(h.manager.state).toMatchObject({
        kind: 'unavailable',
        reason: 'exited',
        retryInMs: AUTO_RESTART_DELAYS_MS[attempt - 1],
        attempt,
      });
      seen.push(h.manager.state);
      h.fire();
      await reach(h.manager, 'running');
    }
    const previous = h.manager.state;
    h.created.at(-1)?.child.emit('exit', 1, null);
    const last = h.manager.state;
    expect(last).toMatchObject({ kind: 'unavailable', reason: 'exited' });
    expect('retryInMs' in last).toBe(false);
    expect(h.timers.filter((timer) => !timer.cancelled)).toEqual([]);
    expect(h.messages).toContain('giving up restarting the server after 3 attempts');
    // The scheduled states are silent; the surrender is not.
    for (const state of seen) expect(describeServerFailure(previous, state)).toBeUndefined();
    expect(describeServerFailure(previous, last)).toMatch(/exited unexpectedly/);
    expect(h.start).toHaveBeenCalledTimes(4);
  });

  it('starts the backoff over when the server stayed up for the stable period', async () => {
    const h = await running();
    h.created.at(-1)?.child.emit('exit', 1, null);
    h.fire();
    await reach(h.manager, 'running');
    h.created.at(-1)?.child.emit('exit', 1, null);
    expect(h.manager.state).toMatchObject({ retryInMs: 5000, attempt: 2 });
    h.fire();
    await reach(h.manager, 'running');
    h.advance(STABLE_RUN_MS);
    h.created.at(-1)?.child.emit('exit', 1, null);
    expect(h.manager.state).toMatchObject({ retryInMs: 1000, attempt: 1 });
  });

  it('a restart the user asked for resets the counter', async () => {
    const h = await running();
    h.created.at(-1)?.child.emit('exit', 1, null);
    h.fire();
    await reach(h.manager, 'running');
    await h.manager.restart('command');
    h.created.at(-1)?.child.emit('exit', 1, null);
    expect(h.manager.state).toMatchObject({ retryInMs: 1000, attempt: 1 });
  });

  it('stop() cancels a pending retry: nothing is launched after it', async () => {
    const h = await running();
    h.created.at(-1)?.child.emit('exit', 1, null);
    expect(h.timers.filter((timer) => !timer.cancelled)).toHaveLength(1);
    await h.manager.stop();
    expect(h.timers.filter((timer) => !timer.cancelled)).toEqual([]);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.manager.state.kind).toBe('stopped');
  });

  it('a retry that arrives after stop() through a stale callback launches nothing', async () => {
    const h = await running();
    h.created.at(-1)?.child.emit('exit', 1, null);
    const callback = h.timers[0]?.fn;
    await h.manager.stop();
    callback?.();
    await Promise.resolve();
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('a new detection while waiting overrides the retry', async () => {
    const h = await running();
    h.created.at(-1)?.child.emit('exit', 1, null);
    h.manager.onDetection(okResult('/bin/fixed'));
    await reach(h.manager, 'running');
    expect(h.timers.filter((timer) => !timer.cancelled)).toEqual([]);
    expect(h.start.mock.calls[1]?.[0].command).toBe('/bin/fixed');
  });

  it('a restart that fails to start is not retried automatically', async () => {
    const start = vi
      .fn<(options: StartServerOptions) => Promise<RunningServer>>()
      .mockResolvedValueOnce(fakeServer())
      .mockRejectedValueOnce(new Error('spawn failed'));
    const h = harness({ start });
    h.manager.setFolder(folderChoice);
    h.manager.onDetection(okResult());
    await reach(h.manager, 'running');
    await h.manager.restart('command');
    expect(h.manager.state).toMatchObject({ kind: 'unavailable', reason: 'start-failed' });
    expect(h.timers.filter((timer) => !timer.cancelled)).toEqual([]);
  });
});

/** True while a process with this pid exists (`EPERM` still means it exists). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

describe('ServerManager with real processes and a log that throws', () => {
  // Regression test for the BLOCKER of the issue #8 review. In VS Code a disposed
  // `LogOutputChannel` throws "Channel has been closed" on info/warn/error, and VS Code disposes
  // `context.subscriptions` right after calling `deactivate`. Before the fix, the `log.warn`
  // that precedes the tree kill threw, the kill never ran, `stop()` rejected and a server that
  // ignores stdin survived the window close. Here the log starts throwing at the moment `stop()`
  // is called (imitating that). The server is the SYNTHETIC fixture in `ignore-stdin` mode with a
  // grandchild; real processes, Windows 11 / Node 24.22.0. A real opencode is UNVERIFIED.
  it('stop() resolves, ends in stopped and kills the server and its grandchild', async () => {
    const fixture = fileURLToPath(new URL('./test-fixtures/fake-opencode.mjs', import.meta.url));
    const folder = await mkdtemp(path.join(os.tmpdir(), 'ovsc-mgr-'));
    const lines: string[] = [];
    let broken = false;
    const record =
      (level: string) =>
      (message: string): void => {
        if (broken) throw new Error('Channel has been closed');
        lines.push(`${level}:${message}`);
      };
    const log = {
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      debug: record('debug'),
    };
    const manager = new ServerManager({
      start: (options) =>
        startServer({
          ...options,
          prefixArgs: [fixture],
          baseEnv: { ...process.env, FAKE_OPENCODE_MODE: 'ignore-stdin,grandchild' },
        }),
      // The raw (throwing) log on purpose: `stopServer` must defend itself.
      stop: (server) => stopServer(server.child, log, { graceMs: 300, killWaitMs: 3000 }),
      fetchInfo: () => Promise.resolve({ version: '2.0.32', pid: undefined }),
      log,
    });
    try {
      manager.setFolder({ folder, ignored: [] });
      manager.onDetection(okResult(process.execPath));
      await vi.waitFor(
        () => {
          expect(manager.state.kind).toBe('running');
        },
        { timeout: 10_000 },
      );
      const pidOf = (kind: string): number => {
        const line = lines.find((l) => l.includes(`{"fake":"${kind}"`));
        if (line === undefined) throw new Error(`no ${kind} line in the log`);
        return (JSON.parse(line.slice(line.indexOf('{"fake"'))) as { pid: number }).pid;
      };
      const childPid = pidOf('argv');
      const grandchildPid = pidOf('grandchild');
      expect(isAlive(childPid)).toBe(true);
      expect(isAlive(grandchildPid)).toBe(true);

      broken = true; // from now on every log call throws, as in a closed channel
      await manager.stop();

      expect(manager.state.kind).toBe('stopped');
      await vi.waitFor(
        () => {
          expect(isAlive(childPid)).toBe(false);
          expect(isAlive(grandchildPid)).toBe(false);
        },
        { timeout: 3000 },
      );
    } finally {
      broken = false;
      await manager.stop();
      await rm(folder, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('describeServerState / describeServerFailure', () => {
  const running: ServerState = {
    kind: 'running',
    server: {
      url: 'http://127.0.0.1:5555',
      password: 'secret',
      version: '2.0.32',
      folder: '/f',
      binaryPath: '/b',
      pid: 7,
    },
  };

  it('the ready line has url, version and pid and never the password', () => {
    const { message } = describeServerState(running);
    expect(message).toBe('server ready at http://127.0.0.1:5555 (opencode 2.0.32, pid 7)');
    expect(message).not.toContain('secret');
  });

  it('the restart lines are the stable ones the integration test waits for', () => {
    expect(describeServerState({ kind: 'restarting', reason: 'command' })).toEqual({
      level: 'info',
      message: 'restarting the server (command)',
    });
    expect(
      describeServerState({
        kind: 'unavailable',
        reason: 'exited',
        message: 'x',
        retryInMs: 1000,
        attempt: 1,
      }).message,
    ).toBe('server exited unexpectedly; restarting in 1 s (attempt 1 of 3)');
    expect(
      describeServerState({
        kind: 'unavailable',
        reason: 'exited',
        message: 'x',
        retryInMs: 15000,
        attempt: 3,
      }).message,
    ).toBe('server exited unexpectedly; restarting in 15 s (attempt 3 of 3)');
  });

  it('only failures after an attempt notify', () => {
    const failed: ServerState = { kind: 'unavailable', reason: 'start-failed', message: 'boom' };
    const missing: ServerState = { kind: 'unavailable', reason: 'binary-missing', message: 'x' };
    const idle: ServerState = { kind: 'idle' };
    const starting: ServerState = { kind: 'starting', folder: '/f', binaryPath: '/b' };
    expect(describeServerFailure(starting, failed)).toBe('boom');
    expect(describeServerFailure(running, { ...failed, reason: 'exited' })).toBe('boom');
    expect(describeServerFailure(idle, failed)).toBeUndefined();
    expect(describeServerFailure(starting, missing)).toBeUndefined();
    expect(describeServerFailure(starting, running)).toBeUndefined();
  });
});
