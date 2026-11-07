// Tests for `modHost.ts` (E10-mods, phase 1).
//
// What they protect: containment. The promise of the mods system is that a mod which throws,
// hangs, exits or ignores a command ends in `failed` (or a rejected call) with one log line while
// the rest of the extension and the other mods keep working, and that a mod never receives the
// opencode password. A regression here freezes the extension host for good (an unterminated
// `while (true)`) or leaks the secret.
//
// Provenance: the first describe runs a REAL `worker_threads.Worker`: `beforeAll` bundles
// `src/mods/worker.ts` with the esbuild JS API (the same options as `esbuild.mjs`) into a temp
// file and the mods are small `.mjs`/`.cjs` files written to temp folders, so the code under test
// is the real bootstrap, the real `import()` and the real `terminate()`. The second describe uses
// a fake Worker with fake timers for what real time makes slow or flaky (the exact heartbeat
// arithmetic, the rate limits). Nothing here runs inside VS Code's extension host: a Worker there
// (the plan's main risk, microsoft/vscode#88386) is for the phase-2 integration test.
// MUTATION (02/11/2026, Windows 11): removing the `terminate` call of `fail` (the one the
// heartbeat reaches) made "terminates a mod that blocks its event loop, without freezing the
// others" time out and "pings once per period and terminates the Worker after 3 unanswered pings"
// fail; reverted afterwards.

import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModEvent } from '../mods/api';
import type { LogLevel } from '../mods/wire';
import { MAX_MOD_COMMAND_ARGS } from '../shared/protocol';
import type { DiscoveredMod } from './modDiscovery';
import {
  ModHost,
  buildModEnv,
  type ModHostOptions,
  type ModPanelUi,
  type ModStatusLine,
  type WorkerFactory,
  type WorkerLike,
} from './modHost';

const WORKER_SOURCE = fileURLToPath(new URL('../mods/worker.ts', import.meta.url));

let tmp: string;
let workerFile: string;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'ovsc-modhost-'));
  workerFile = path.join(tmp, 'modWorker.cjs');
  await build({
    entryPoints: [WORKER_SOURCE],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    outfile: workerFile,
    logLevel: 'silent',
  });
}, 60_000);

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Writes a mod folder under the temp dir and returns the record discovery would have produced. */
async function makeMod(id: string, code: string, file = 'index.mjs'): Promise<DiscoveredMod> {
  const dir = path.join(tmp, `mods-${Math.random().toString(36).slice(2)}`, id);
  await mkdir(dir, { recursive: true });
  const entry = path.join(dir, file);
  await writeFile(entry, code);
  return {
    manifest: { id, name: id, version: '1.0.0', apiVersion: 1, main: file },
    dir,
    entry,
  };
}

/** Polls until `predicate` holds; the message names what was awaited. */
async function waitFor(predicate: () => boolean, what: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

interface Harness {
  host: ModHost;
  logs: string[];
  lifecycle: string[];
  statuses: Array<[string, ModStatusLine | undefined]>;
  toasts: Array<{ message: string; actions?: string[] }>;
  composes: Array<{ text: string }>;
  /** One entry per Worker created; `exited` resolves when it ends. */
  workers: Array<{ worker: Worker; exited: Promise<number> }>;
}

const hosts: ModHost[] = [];

/** Builds a host over the real Worker, recording every sink call. */
function harness(overrides: Partial<ModHostOptions> = {}, toastAnswer = 'Yes'): Harness {
  const h: Harness = {
    host: undefined as unknown as ModHost,
    logs: [],
    lifecycle: [],
    statuses: [],
    toasts: [],
    composes: [],
    workers: [],
  };
  const createWorker: WorkerFactory = (file, options) => {
    const worker = new Worker(file, options);
    h.workers.push({
      worker,
      exited: new Promise<number>((resolve) => worker.on('exit', resolve)),
    });
    return worker;
  };
  h.host = new ModHost({
    workerFile,
    createWorker,
    ui: {
      status: (id, line) => void h.statuses.push([id, line]),
      toast: (_id, toast) => {
        h.toasts.push(toast);
        return Promise.resolve(toastAnswer);
      },
      compose: (_id, request) => void h.composes.push(request),
    },
    logLifecycle: (text) => void h.lifecycle.push(text),
    logMod: (id: string, level: LogLevel, text: string) =>
      void h.logs.push(`${id}|${level}|${text}`),
    ...overrides,
  });
  hosts.push(h.host);
  return h;
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

const state = (h: Harness, id: string): string | undefined =>
  h.host.statuses().find((s) => s.id === id)?.state;

describe('ModHost with a real Worker', () => {
  it('delivers events to a mod that works and lists its commands', async () => {
    const h = harness();
    const mod = await makeMod(
      'good',
      `export function activate(station) {
         station.events.on('turn.started', (e) => station.log.info('got ' + e.sessionID));
         station.commands.register({ name: 'hello', description: 'Says hello', run() {} });
       }`,
    );
    h.host.start([mod]);
    await waitFor(() => state(h, 'good') === 'active', 'good to be active');
    expect(h.lifecycle).toContain('mod good loaded');
    expect(h.host.commands()).toEqual([
      { modId: 'good', modName: 'good', name: 'hello', description: 'Says hello' },
    ]);
    const event: ModEvent = { type: 'turn.started', sessionID: 's1' };
    h.host.dispatch(event);
    await waitFor(() => h.logs.includes('good|info|got s1'), 'the handler to log');
  });

  it('loads a CommonJS mod whose activate is on module.exports', async () => {
    const h = harness();
    const mod = await makeMod(
      'cjs',
      `module.exports = { activate(station) { station.log.info('cjs ok'); } };`,
      'index.cjs',
    );
    h.host.start([mod]);
    await waitFor(() => state(h, 'cjs') === 'active', 'the CJS mod to be active');
    expect(h.logs).toContain('cjs|info|cjs ok');
  });

  it('marks a mod failed when activate throws, and the other mod keeps working', async () => {
    const h = harness();
    const bad = await makeMod('bad', `export function activate() { throw new Error('boom'); }`);
    const good = await makeMod('fine', `export function activate() {}`);
    h.host.start([bad, good]);
    await waitFor(
      () => state(h, 'bad') === 'failed' && state(h, 'fine') === 'active',
      'bad failed',
    );
    expect(h.host.statuses().find((s) => s.id === 'bad')?.error).toBe('boom');
    expect(h.lifecycle).toContain('mod bad failed: boom');
    await h.workers[0]?.exited;
  });

  it('marks a mod failed when the entry exports no activate()', async () => {
    const h = harness();
    h.host.start([await makeMod('empty', `export const nothing = 1;`)]);
    await waitFor(() => state(h, 'empty') === 'failed', 'empty to fail');
    expect(h.host.statuses()[0]?.error).toContain('no activate');
  });

  it('keeps a mod active when a handler throws or rejects, and logs it', async () => {
    const h = harness();
    const mod = await makeMod(
      'flaky',
      `export function activate(station) {
         station.events.on('turn.started', () => { throw new Error('sync boom'); });
         station.events.on('turn.started', async () => { throw new Error('async boom'); });
         station.events.on('turn.started', () => station.log.info('third handler still ran'));
       }`,
    );
    h.host.start([mod]);
    await waitFor(() => state(h, 'flaky') === 'active', 'flaky to be active');
    h.host.dispatch({ type: 'turn.started', sessionID: 's1' });
    await waitFor(() => h.logs.includes('flaky|info|third handler still ran'), 'third handler');
    await waitFor(() => h.logs.some((l) => l.includes('async boom')), 'async error log');
    expect(
      h.logs.some((l) => l.startsWith('flaky|error|handler for turn.started threw: sync boom')),
    ).toBe(true);
    expect(state(h, 'flaky')).toBe('active');
  });

  it('terminates a mod that blocks its event loop, without freezing the others', async () => {
    const h = harness({ heartbeatMs: 400, missedLimit: 3 });
    const hang = await makeMod('hang', `export function activate() { while (true) {} }`);
    const calm = await makeMod(
      'calm',
      `export function activate(station) { station.commands.register({ name: 'ping', run() {} }); }`,
    );
    h.host.start([hang, calm]);
    await waitFor(() => state(h, 'hang') === 'failed', 'hang to fail');
    expect(h.host.statuses().find((s) => s.id === 'hang')?.error).toMatch(/^hung:/);
    // The Worker really ended: a failed state with a live thread would be the bug.
    const hangWorker = h.workers[0];
    expect(hangWorker).toBeDefined();
    await hangWorker?.exited;
    expect(state(h, 'calm')).toBe('active');
    await expect(h.host.runCommand('calm', 'ping', '')).resolves.toBeUndefined();
  }, 30_000);

  it('marks a mod failed when it exits the Worker with process.exit()', async () => {
    const h = harness();
    const mod = await makeMod(
      'quitter',
      `export function activate(station) { station.events.on('turn.started', () => process.exit(3)); }`,
    );
    h.host.start([mod]);
    await waitFor(() => state(h, 'quitter') === 'active', 'quitter to be active');
    h.host.dispatch({ type: 'turn.started', sessionID: 's1' });
    await waitFor(() => state(h, 'quitter') === 'failed', 'quitter to fail');
    expect(h.host.statuses()[0]?.error).toBe('worker exited with code 3');
  });

  it('runs a command and rejects with its error, with an unknown name and when the mod is not running', async () => {
    const h = harness();
    const mod = await makeMod(
      'cmd',
      `export function activate(station) {
         station.commands.register({ name: 'ok', run(c) { station.log.info('args=' + c.args + ' s=' + c.sessionID); } });
         station.commands.register({ name: 'bad', run() { throw new Error('nope'); } });
       }`,
    );
    h.host.start([mod]);
    await waitFor(() => state(h, 'cmd') === 'active', 'cmd to be active');
    await waitFor(() => h.host.commands().length === 2, 'two commands');
    await expect(h.host.runCommand('cmd', 'ok', 'x y', 's9')).resolves.toBeUndefined();
    expect(h.logs).toContain('cmd|info|args=x y s=s9');
    await expect(h.host.runCommand('cmd', 'bad', '')).rejects.toThrow('nope');
    await expect(h.host.runCommand('cmd', 'missing', '')).rejects.toThrow('no command');
    await expect(h.host.runCommand('ghost', 'ok', '')).rejects.toThrow('not running');
  });

  it('rejects a command that never answers and leaves the mod active', async () => {
    const h = harness({ commandTimeoutMs: 300 });
    const mod = await makeMod(
      'slow',
      `export function activate(station) {
         station.commands.register({ name: 'wait', run() { return new Promise(() => {}); } });
       }`,
    );
    h.host.start([mod]);
    await waitFor(() => h.host.commands().length === 1, 'the command');
    await expect(h.host.runCommand('slow', 'wait', '')).rejects.toThrow('timed out');
    expect(state(h, 'slow')).toBe('active');
  });

  it('rejects API calls that break a limit inside the mod instead of sending them', async () => {
    const h = harness();
    const mod = await makeMod(
      'greedy',
      `export function activate(station) {
         station.events.on('turn.started', () => station.ui.status.set({ text: 'x'.repeat(121) }));
       }`,
    );
    h.host.start([mod]);
    await waitFor(() => state(h, 'greedy') === 'active', 'greedy to be active');
    h.host.dispatch({ type: 'turn.started', sessionID: 's1' });
    await waitFor(() => h.logs.some((l) => l.includes('oversized')), 'the limit error');
    expect(h.statuses).toEqual([]);
  });

  it('hands the Worker an environment without the opencode password', async () => {
    const h = harness({
      baseEnv: {
        OPENCODE_PASSWORD: 'secret-1',
        opencode_server_password: 'secret-2',
        ELECTRON_RUN_AS_NODE: '1',
        VSCODE_PID: '42',
        KEEP_ME: 'yes',
      },
      platform: 'win32',
    });
    const mod = await makeMod(
      'env',
      `export function activate(station) { station.log.info('keys=' + Object.keys(process.env).join(',')); }`,
    );
    h.host.start([mod]);
    await waitFor(() => h.logs.some((l) => l.startsWith('env|info|keys=')), 'the env log');
    const line = h.logs.find((l) => l.startsWith('env|info|keys=')) ?? '';
    expect(line).toContain('KEEP_ME');
    for (const hidden of ['OPENCODE', 'opencode', 'ELECTRON', 'VSCODE']) {
      expect(line).not.toContain(hidden);
    }
  });

  /**
   * Also protects #169 across the REAL Worker to host boundary: the mod passes the removed
   * `send: true` (plain JS), the host receives the legacy wire field, writes the text WITHOUT a
   * `send` key and logs the one warning. Real Worker compiled from `src/mods/worker.ts` by this
   * file; fabricated mod; passed on Windows 11 (03/11/2026).
   */
  it('passes toasts, composes and status updates to the UI, and drops a second toast within 2 s', async () => {
    const h = harness();
    const mod = await makeMod(
      'ui',
      `export function activate(station) {
         station.events.on('turn.started', async () => {
           station.ui.status.set({ text: 'Working', severity: 'info' });
           station.chat.compose({ text: 'hello', send: true });
           const first = await station.ui.toast({ message: 'one', actions: ['Yes', 'No'] });
           const second = await station.ui.toast({ message: 'two' });
           station.log.info('answers=' + first + ',' + second);
           station.ui.status.clear();
         });
       }`,
    );
    h.host.start([mod]);
    await waitFor(() => state(h, 'ui') === 'active', 'ui to be active');
    h.host.dispatch({ type: 'turn.started', sessionID: 's1' });
    await waitFor(() => h.logs.includes('ui|info|answers=Yes,undefined'), 'both toast answers');
    expect(h.toasts).toEqual([{ message: 'one', actions: ['Yes', 'No'] }]);
    expect(h.composes).toEqual([{ text: 'hello' }]);
    expect(
      h.logs.filter((l) => l.startsWith('ui|warn|chat.compose: "send" no longer exists')),
    ).toHaveLength(1);
    expect(h.logs.some((l) => l.startsWith('ui|warn|toast dropped'))).toBe(true);
    await waitFor(() => h.statuses.length === 2, 'status set and clear');
    expect(h.statuses.map(([, line]) => line?.text)).toEqual(['Working', undefined]);
  });

  /**
   * Protects the panel plumbing of phase 4: a mod opens a panel, the page's JSON reaches the mod and
   * its answer reaches the page, a tab the user closes reaches the mod as `onDidClose`, a bad path
   * or a fourth panel is refused inside the mod, and a panel left open is closed when the mod stops.
   * Real Worker; the VS Code half is a recorder (`modPanels.ts` has no unit test: it needs VS Code).
   */
  it('relays panel messages both ways, reports a closed tab and closes open panels on stop', async () => {
    const events: string[] = [];
    const panels: ModPanelUi = {
      open: (modId, panelId, request) =>
        void events.push(
          `open ${modId} ${panelId} ${request.html} [${request.scripts.join(',')}] [${request.styles.join(',')}]`,
        ),
      message: (_modId, panelId, data) =>
        void events.push(`message ${panelId} ${JSON.stringify(data)}`),
      close: (_modId, panelId) => void events.push(`close ${panelId}`),
    };
    const h = harness({ panels });
    const mod = await makeMod(
      'pan',
      `export function activate(station) {
         station.commands.register({ name: 'open', run() {
           const panel = station.ui.panel.open({ title: 'T', html: 'panel.html', scripts: ['a.js'], styles: ['s.css'] });
           panel.onMessage((data) => panel.postMessage({ echo: data }));
           panel.onDidClose(() => station.log.info('tab closed'));
         } });
         station.commands.register({ name: 'bad', run() {
           station.ui.panel.open({ title: 'T', html: '../escape.html' });
         } });
       }`,
    );
    h.host.start([mod]);
    await waitFor(() => state(h, 'pan') === 'active', 'pan to be active');

    await h.host.runCommand('pan', 'open', '');
    expect(events).toEqual(['open pan p1 panel.html [a.js] [s.css]']);
    h.host.panelMessage('pan', 'p1', { n: 1 });
    await waitFor(() => events.includes('message p1 {"echo":{"n":1}}'), 'the echo to come back');
    h.host.panelClosed('pan', 'p1');
    await waitFor(() => h.logs.includes('pan|info|tab closed'), 'the mod to hear the close');
    // A message for a panel that is closed goes nowhere.
    h.host.panelMessage('pan', 'p1', { n: 2 });

    await expect(h.host.runCommand('pan', 'bad', '')).rejects.toThrow(/invalid or oversized/);
    await h.host.runCommand('pan', 'open', '');
    await h.host.runCommand('pan', 'open', '');
    await h.host.runCommand('pan', 'open', '');
    await expect(h.host.runCommand('pan', 'open', '')).rejects.toThrow(/at most 3 panels/);
    expect(events.filter((e) => e.startsWith('open '))).toHaveLength(4);

    await h.host.dispose();
    expect(events.filter((e) => e.startsWith('close '))).toEqual([
      'close p2',
      'close p3',
      'close p4',
    ]);
    expect(events).not.toContain('message p1 {"echo":{"n":2}}');
  });

  it('refuses a panel when the host has no panel UI, and the mod hears it closed', async () => {
    const h = harness();
    const mod = await makeMod(
      'nopan',
      `export function activate(station) {
         station.commands.register({ name: 'open', run() {
           const panel = station.ui.panel.open({ title: 'T', html: 'panel.html' });
           panel.onDidClose(() => station.log.info('refused'));
         } });
       }`,
    );
    h.host.start([mod]);
    await waitFor(() => state(h, 'nopan') === 'active', 'nopan to be active');
    await h.host.runCommand('nopan', 'open', '');
    await waitFor(() => h.logs.includes('nopan|info|refused'), 'the refusal to reach the mod');
    expect(h.logs.some((l) => l.includes('panel refused'))).toBe(true);
  });

  it('reload terminates the old Workers and starts new ones', async () => {
    const h = harness();
    const mod = await makeMod('again', `export function activate() {}`);
    h.host.start([mod]);
    await waitFor(() => state(h, 'again') === 'active', 'again to be active');
    await h.host.reload([mod]);
    await waitFor(() => state(h, 'again') === 'active', 'again to be active after reload');
    expect(h.workers).toHaveLength(2);
    await h.workers[0]?.exited;
  });

  /**
   * Protects the log cap (#155) on the real path worker.ts -> host: a mod that logs in a loop cannot flood the
   * channel. Real Worker and a real mod; the assertion is not exact because a window may split on a
   * slow machine.
   */
  it('a mod that logs in a loop cannot flood the channel', async () => {
    const h = harness();
    const mod = await makeMod(
      'loud',
      `export function activate(station) {
         for (let i = 0; i < 1000; i++) station.log.info('n' + i);
       }`,
    );
    h.host.start([mod]);
    await waitFor(() => state(h, 'loud') === 'active', 'loud to be active');
    await waitFor(() => h.logs.some((l) => l.includes('log lines dropped')), 'the limit warning');
    expect(h.logs.filter((l) => l.startsWith('loud|info|n')).length).toBeLessThan(1000);
  });

  it("dispose leaves no Worker alive and runs the mods' deactivate", async () => {
    const h = harness({ deactivateGraceMs: 300 });
    const mod = await makeMod(
      'tidy',
      `export function activate(station) {
         return () => station.log.info('cleanup ran');
       }`,
    );
    h.host.start([mod]);
    await waitFor(() => state(h, 'tidy') === 'active', 'tidy to be active');
    await h.host.dispose();
    await Promise.all(h.workers.map((w) => w.exited));
    expect(h.logs).toContain('tidy|info|cleanup ran');
    expect(state(h, 'tidy')).toBe('stopped');
  });
});

describe('buildModEnv', () => {
  const base = {
    OPENCODE_PASSWORD: 'a',
    OPENCODE_SERVER_PASSWORD: 'b',
    ELECTRON_RUN_AS_NODE: '1',
    VSCODE_IPC_HOOK: 'x',
    Opencode_Password: 'c',
    vscode_cwd: 'd',
    PATH: '/bin',
    EMPTY: undefined,
  };

  it('drops every spelling on win32 and keeps the rest', () => {
    expect(buildModEnv(base, 'win32')).toEqual({ PATH: '/bin' });
  });

  it('matches exactly on POSIX, where names are case-sensitive', () => {
    expect(buildModEnv(base, 'linux')).toEqual({
      Opencode_Password: 'c',
      vscode_cwd: 'd',
      PATH: '/bin',
    });
  });

  it('does not mutate its input', () => {
    const copy = { ...base };
    buildModEnv(base, 'win32');
    expect(base).toEqual(copy);
  });
});

/** A Worker stand-in: records what the host posts and lets the test speak as the Worker. */
class FakeWorker extends EventEmitter implements WorkerLike {
  readonly posted: Array<{ type: string; [key: string]: unknown }> = [];
  readonly terminate = vi.fn(() => Promise.resolve(0));
  postMessage(value: unknown): void {
    this.posted.push(value as { type: string });
  }
  say(message: unknown): void {
    this.emit('message', message);
  }
  count(type: string): number {
    return this.posted.filter((m) => m.type === type).length;
  }
}

describe('ModHost with a fake Worker and fake timers', () => {
  let fake: FakeWorker;
  let host: ModHost;
  let uiStatus: Array<ModStatusLine | undefined>;
  let uiToast: ReturnType<typeof vi.fn>;
  let uiComposes: Array<{ text: string }>;
  let logs: string[];
  const mod: DiscoveredMod = {
    manifest: { id: 'f', name: 'F', version: '1', apiVersion: 1, main: 'i.mjs' },
    dir: '/m/f',
    entry: '/m/f/i.mjs',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fake = new FakeWorker();
    uiComposes = [];
    uiStatus = [];
    uiToast = vi.fn(() => Promise.resolve(undefined));
    logs = [];
    host = new ModHost({
      workerFile: '/w.cjs',
      createWorker: () => fake,
      heartbeatMs: 1000,
      missedLimit: 3,
      ui: {
        status: (_id, line) => void uiStatus.push(line),
        toast: uiToast as never,
        compose: (_id, request) => void uiComposes.push(request),
      },
      logLifecycle: () => undefined,
      logMod: (_id, level, text) => void logs.push(`${level}|${text}`),
    });
    host.start([mod]);
    fake.say({ type: 'ready' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Protects the contract "no Worker is alive after dispose" against a load that was in flight
   * when the extension deactivated (review E10-mods W1). Fake factory counting creations, fake
   * timers for the 250 ms grace of `stopAll`; nothing here touches a real Worker or VS Code.
   */
  it('start and reload after dispose create no Worker', async () => {
    // The host of beforeEach has its own heartbeat: stop it so the timer count below is ours (its
    // dispose waits for the stop grace, so the fake clock has to move).
    const earlier = host.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    await earlier;
    const created: FakeWorker[] = [];
    const h = new ModHost({
      workerFile: '/w.cjs',
      createWorker: () => {
        const w = new FakeWorker();
        created.push(w);
        return w;
      },
      ui: { status: () => undefined, toast: uiToast as never, compose: () => undefined },
      logLifecycle: () => undefined,
      logMod: () => undefined,
    });
    await h.dispose();
    h.start([mod]);
    await h.reload([mod]);
    expect(created).toHaveLength(0);
    expect(h.statuses()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  /** Same defence for the case that matters: dispose arrives while `reload` waits for the grace. */
  it('a reload that was waiting when dispose came creates no Worker', async () => {
    const earlier = host.dispose(); // as above: only this test's host may own a timer
    await vi.advanceTimersByTimeAsync(1000);
    await earlier;
    const created: FakeWorker[] = [];
    const h = new ModHost({
      workerFile: '/w.cjs',
      createWorker: () => {
        const w = new FakeWorker();
        created.push(w);
        return w;
      },
      ui: { status: () => undefined, toast: uiToast as never, compose: () => undefined },
      logLifecycle: () => undefined,
      logMod: () => undefined,
    });
    h.start([mod]);
    created[0]?.say({ type: 'ready' });
    const reloading = h.reload([{ ...mod, manifest: { ...mod.manifest, id: 'g' } }]);
    const disposing = h.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([reloading, disposing]);
    expect(created).toHaveLength(1);
    expect(h.statuses().map((s) => s.state)).toEqual(['stopped']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pings once per period and terminates the Worker after 3 unanswered pings', async () => {
    await vi.advanceTimersByTimeAsync(3000);
    expect(fake.count('ping')).toBe(3);
    expect(host.statuses()[0]?.state).toBe('active');
    expect(fake.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.statuses()[0]).toMatchObject({ state: 'failed' });
    expect(host.statuses()[0]?.error).toMatch(/^hung:/);
    expect(fake.terminate).toHaveBeenCalledTimes(1);
  });

  it('a pong resets the count, so a slow but alive mod is never terminated', async () => {
    for (let round = 0; round < 6; round += 1) {
      await vi.advanceTimersByTimeAsync(1000);
      fake.say({ type: 'pong', n: round + 1 });
    }
    expect(host.statuses()[0]?.state).toBe('active');
    expect(fake.terminate).not.toHaveBeenCalled();
  });

  it('fails a mod whose activate() never finishes', async () => {
    const slowFake = new FakeWorker();
    const slowHost = new ModHost({
      workerFile: '/w.cjs',
      createWorker: () => slowFake,
      activateTimeoutMs: 5000,
      heartbeatMs: 60_000,
      ui: { status: () => undefined, toast: uiToast as never, compose: () => undefined },
      logLifecycle: () => undefined,
      logMod: () => undefined,
    });
    slowHost.start([{ ...mod, manifest: { ...mod.manifest, id: 's' } }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(slowHost.statuses()[0]?.error).toBe('activate() did not finish within 5000 ms');
    expect(slowFake.terminate).toHaveBeenCalled();
  });

  it('coalesces band updates to one per 100 ms, delivering the latest', async () => {
    fake.say({ type: 'status.set', text: 'one' });
    fake.say({ type: 'status.set', text: 'two' });
    fake.say({ type: 'status.set', text: 'three' });
    expect(uiStatus.map((l) => l?.text)).toEqual(['one']);
    await vi.advanceTimersByTimeAsync(100);
    expect(uiStatus.map((l) => l?.text)).toEqual(['one', 'three']);
  });

  it('clears the band of a mod that fails', () => {
    fake.say({ type: 'status.set', text: 'one' });
    fake.say({ type: 'failed', message: 'dead' });
    expect(uiStatus).toEqual([{ text: 'one' }, undefined]);
  });

  it('allows a toast again once 2 seconds have passed', async () => {
    fake.say({ type: 'toast', requestId: 't1', message: 'a' });
    await vi.advanceTimersByTimeAsync(1999);
    fake.say({ type: 'toast', requestId: 't2', message: 'b' });
    await vi.advanceTimersByTimeAsync(1);
    fake.say({ type: 'toast', requestId: 't3', message: 'c' });
    expect(uiToast).toHaveBeenCalledTimes(2);
    expect(
      uiToast.mock.calls.map((call) => (call as [string, { message: string }])[1].message),
    ).toEqual(['a', 'c']);
  });

  /**
   * Protects #169 and the decision #1887: a compose never carries `send` to the UI, a legacy
   * `send: true` warns exactly once per LOAD of the mod (the flag lives in the record, so Reload
   * Mods warns again), and a compose without `send` or with `false` does not warn. Fabricated
   * messages through a fake Worker and fake timers, Windows 11.
   * MUTATION (03/11/2026, Windows 11): deleting `rec.sendWarned = true` in `composeText` made this
   * case fail; reverted afterwards.
   */
  it('writes a compose that asks to send without sending it, and warns once per load', async () => {
    const warns = (): string[] => logs.filter((l) => l.startsWith('warn|chat.compose: "send"'));
    fake.say({ type: 'compose', text: 'plain' });
    fake.say({ type: 'compose', text: 'no', send: false });
    expect(warns()).toHaveLength(0);
    fake.say({ type: 'compose', text: 'a', send: true });
    await vi.advanceTimersByTimeAsync(2000);
    fake.say({ type: 'compose', text: 'b', send: true });
    expect(uiComposes).toEqual([{ text: 'plain' }, { text: 'no' }, { text: 'a' }, { text: 'b' }]);
    expect(warns()).toHaveLength(1);
    const reloading = host.reload([mod]);
    await vi.advanceTimersByTimeAsync(300);
    await reloading;
    fake.say({ type: 'ready' });
    fake.say({ type: 'compose', text: 'c', send: true });
    expect(warns()).toHaveLength(2);
    expect(uiComposes.at(-1)).toEqual({ text: 'c' });
  });

  /**
   * Defends writing the send warning with `logMod` directly: through `log` the spent budget would
   * drop it. Fabricated messages, Windows 11. MUTATION (03/11/2026): replacing `logMod` by
   * `this.log` in `composeText` made this case fail; reverted afterwards.
   */
  it('the send warning is written even when the log budget is spent', () => {
    for (let i = 0; i < 60; i += 1) fake.say({ type: 'log', level: 'info', text: `l${i}` });
    fake.say({ type: 'compose', text: 'x', send: true });
    expect(logs.some((l) => l.startsWith('warn|chat.compose: "send" no longer exists'))).toBe(true);
  });

  it('ignores an invalid message and keeps the mod active', () => {
    fake.say({ type: 'status.set', text: 'x'.repeat(500) });
    fake.say({ type: 'rm-rf' });
    expect(host.statuses()[0]?.state).toBe('active');
    expect(uiStatus).toEqual([]);
  });

  /**
   * Protects the log cap of #155: a mod cannot flood the "OpenCode Mods" channel. Fabricated
   * `log` messages through a fake Worker and fake timers (the real-Worker path is the test below).
   * MUTATION (03/11/2026, Windows 11): replacing the `if (this.admit(...))` of `log` by `if (true)`
   * made this test, "counts the host's own warnings...", "counts `error` reports..." and the
   * real-Worker "a mod that logs in a loop..." fail; reverted afterwards.
   */
  it('lets 50 log lines a second through and drops the rest with one warning per window', async () => {
    for (let i = 0; i < 60; i += 1) fake.say({ type: 'log', level: 'info', text: `l${i}` });
    expect(logs.filter((l) => l.startsWith('info|'))).toHaveLength(50);
    expect(logs.filter((l) => l.startsWith('warn|'))).toHaveLength(1);
    expect(logs.at(-1)).toMatch(/^warn\|log lines dropped: more than 50 per second/);
    await vi.advanceTimersByTimeAsync(1000);
    fake.say({ type: 'log', level: 'info', text: 'after' });
    expect(logs.at(-1)).toBe('info|after');
    for (let i = 0; i < 60; i += 1) fake.say({ type: 'log', level: 'info', text: `m${i}` });
    expect(logs.filter((l) => l.startsWith('warn|'))).toHaveLength(2);
  });

  /** Protects the host's own `warn` lines (invalid message) from being an unlimited log path. Fabricated input. */
  it("counts the host's own warnings about the mod in the log limit", () => {
    for (let i = 0; i < 60; i += 1) fake.say({ type: 'rm-rf' });
    expect(logs.filter((l) => l.includes('ignored an invalid message'))).toHaveLength(50);
    expect(logs.filter((l) => l.includes('log lines dropped'))).toHaveLength(1);
  });

  /** Protects `error` reports of the Worker from bypassing the log limit. Fabricated input. */
  it('counts `error` reports in the log budget', () => {
    for (let i = 0; i < 60; i += 1) fake.say({ type: 'error', message: `e${i}` });
    expect(logs.filter((l) => l.startsWith('error|'))).toHaveLength(50);
    expect(logs.filter((l) => l.includes('log lines dropped'))).toHaveLength(1);
  });

  /**
   * Protects the panel.message cap of #155: at most 30 `panel.message` a second per mod, all its panels together, one `warn`
   * per window. Fabricated messages, a recording `ModPanelUi`.
   * MUTATION (03/11/2026, Windows 11): removing the `this.admit(...)` condition of the
   * `panel.message` case made this test fail (only that test); reverted afterwards.
   */
  it('relays at most 30 panel messages a second, all panels together, and warns once', async () => {
    const delivered: string[] = [];
    const panels: ModPanelUi = {
      open: () => undefined,
      message: (_id, panelId) => void delivered.push(panelId),
      close: () => undefined,
    };
    const worker = new FakeWorker();
    const panelLogs: string[] = [];
    const h = new ModHost({
      workerFile: '/w.cjs',
      createWorker: () => worker,
      heartbeatMs: 60_000,
      ui: { status: () => undefined, toast: uiToast as never, compose: () => undefined },
      panels,
      logLifecycle: () => undefined,
      logMod: (_id, level, text) => void panelLogs.push(`${level}|${text}`),
    });
    h.start([{ ...mod, manifest: { ...mod.manifest, id: 'p' } }]);
    worker.say({ type: 'ready' });
    for (const panelId of ['a', 'b']) {
      worker.say({ type: 'panel.open', panelId, title: 'T', html: 'p.html' });
    }
    for (let i = 0; i < 20; i += 1) {
      worker.say({ type: 'panel.message', panelId: 'a', data: i });
      worker.say({ type: 'panel.message', panelId: 'b', data: i });
    }
    expect(delivered).toHaveLength(30);
    expect(panelLogs.filter((l) => l.includes('panel messages dropped'))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    worker.say({ type: 'panel.message', panelId: 'a', data: 'again' });
    expect(delivered).toHaveLength(31);
    const closing = h.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    await closing;
  });

  /**
   * Protects the single args cap of #155: the single cap on command args is applied by the host, so it also covers the
   * palette. Fabricated `command.add`; the real-Worker run of a command is covered elsewhere.
   * MUTATION (03/11/2026, Windows 11): disabling the `args.length` check of `runCommand` made
   * this test fail (the 4001-character call stayed pending until the 5 s test timeout instead of
   * rejecting); reverted afterwards.
   */
  it('rejects command args longer than MAX_MOD_COMMAND_ARGS and posts nothing', async () => {
    fake.say({ type: 'command.add', name: 'go' });
    void host.runCommand('f', 'go', 'x'.repeat(MAX_MOD_COMMAND_ARGS)).catch(() => undefined);
    expect(fake.count('command.run')).toBe(1);
    await expect(host.runCommand('f', 'go', 'x'.repeat(MAX_MOD_COMMAND_ARGS + 1))).rejects.toThrow(
      /too long/,
    );
    expect(fake.count('command.run')).toBe(1);
  });
});

/**
 * `ModHost.stopMod` (E10-mod-toggles, issue #181, plan Engram #1995 section 6 H1-H5).
 *
 * Protects the promise of the per-mod switch: turning ONE mod off stops only that mod (its Worker,
 * its band, its tabs) and leaves every other Worker, band and tab alone, and a mod that fails or is
 * disposed while it is being stopped is not stopped twice. FABRICATED Workers and fake timers: this
 * proves the host's bookkeeping, not that a real Worker survives two `terminate` calls (that is
 * HYPOTHESIS, see the header of `stopMod`).
 * MUTATIONS (07/11/2026, Windows 11, each applied, seen red and reverted):
 * - H1: the body of `stopMod` replaced by `await this.stopAll()` -> "stopMod stops only that mod:
 *   the other keeps its Worker, its band and its open panels" failed (b got `deactivate`).
 * - H2: without the `records.delete` -> "a stopped mod leaves statuses() and start([mod]) spawns a
 *   new Worker" failed (statuses still listed `a`).
 * - H3: the grace waited for any state -> "stopMod waits the grace only for an active mod" failed.
 * - H4: without the second state check, `rec.state = 'stopped'` unconditionally -> "stopMod of a
 *   mod that failed during the grace does not mark it stopped" failed (the second `terminate` saw
 *   `stopped`).
 * - H5 (review W2): without the `deactivateSent` mark of `postDeactivate` -> "stopMod after dispose
 *   creates nothing and does not throw, and an unknown id is a no-op" failed (the Worker got two
 *   `deactivate`, expected 1).
 */
describe('ModHost.stopMod with fake Workers and fake timers', () => {
  const make = (id: string): DiscoveredMod => ({
    manifest: { id, name: id.toUpperCase(), version: '1', apiVersion: 1, main: 'i.mjs' },
    dir: `/m/${id}`,
    entry: `/m/${id}/i.mjs`,
  });
  const A = make('a');
  const B = make('b');
  let created: FakeWorker[];
  let statusCalls: Array<[string, string | undefined]>;
  let panelCalls: string[];
  let lifecycle: string[];
  let host: ModHost;

  beforeEach(() => {
    vi.useFakeTimers();
    created = [];
    statusCalls = [];
    panelCalls = [];
    lifecycle = [];
    host = new ModHost({
      workerFile: '/w.cjs',
      createWorker: () => {
        const worker = new FakeWorker();
        created.push(worker);
        return worker;
      },
      heartbeatMs: 100_000,
      ui: {
        status: (id, line) => void statusCalls.push([id, line?.text]),
        toast: () => Promise.resolve(undefined),
        compose: () => undefined,
      },
      panels: {
        open: (modId, panelId) => void panelCalls.push(`open ${modId}:${panelId}`),
        message: () => undefined,
        close: (modId, panelId) => void panelCalls.push(`close ${modId}:${panelId}`),
      },
      logLifecycle: (text) => void lifecycle.push(text),
      logMod: () => undefined,
    });
  });

  afterEach(async () => {
    const closing = host.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    await closing;
    vi.useRealTimers();
  });

  /** Starts `mods`, makes each Worker active and gives each a band and one open panel. */
  function startWithBandAndPanel(...mods: DiscoveredMod[]): void {
    host.start(mods);
    mods.forEach((mod, index) => {
      const worker = created[index];
      worker?.say({ type: 'ready' });
      worker?.say({ type: 'status.set', text: `band of ${mod.manifest.id}` });
      worker?.say({ type: 'panel.open', panelId: 'p1', title: 'T', html: 'p.html' });
    });
  }

  it('stopMod stops only that mod: the other keeps its Worker, its band and its open panels', async () => {
    startWithBandAndPanel(A, B);
    const stopping = host.stopMod('a');
    await vi.advanceTimersByTimeAsync(250);
    await stopping;
    expect(created[0]?.count('deactivate')).toBe(1);
    expect(created[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(created[1]?.count('deactivate')).toBe(0);
    expect(created[1]?.terminate).not.toHaveBeenCalled();
    expect(panelCalls).toEqual(['open a:p1', 'open b:p1', 'close a:p1']);
    expect(statusCalls).toContainEqual(['a', undefined]);
    expect(statusCalls).not.toContainEqual(['b', undefined]);
    expect(host.statuses().map((s) => [s.id, s.state])).toEqual([['b', 'active']]);
  });

  it('a stopped mod leaves statuses() and start([mod]) spawns a new Worker', async () => {
    startWithBandAndPanel(A, B);
    const stopping = host.stopMod('a');
    await vi.advanceTimersByTimeAsync(250);
    await stopping;
    expect(host.statuses().map((s) => s.id)).toEqual(['b']);
    host.start([A, B]);
    expect(created).toHaveLength(3);
    expect(host.statuses().map((s) => [s.id, s.state])).toEqual([
      ['b', 'active'],
      ['a', 'starting'],
    ]);
  });

  it('stopMod waits the grace only for an active mod', async () => {
    host.start([A, B]);
    created[1]?.say({ type: 'ready' }); // b is active, a is still starting
    let startingDone = false;
    void host.stopMod('a').then(() => {
      startingDone = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(startingDone).toBe(true);
    expect(created[0]?.count('deactivate')).toBe(1);
    let activeDone = false;
    void host.stopMod('b').then(() => {
      activeDone = true;
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(activeDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(activeDone).toBe(true);
  });

  it('stopMod of a mod that failed during the grace does not mark it stopped', async () => {
    host.start([A]);
    const worker = created[0];
    worker?.say({ type: 'ready' });
    const seenByTerminate: Array<string | undefined> = [];
    worker?.terminate.mockImplementation(() => {
      seenByTerminate.push(host.statuses()[0]?.state);
      return Promise.resolve(0);
    });
    const stopping = host.stopMod('a');
    worker?.say({ type: 'failed', message: 'boom' }); // the mod dies while stopMod waits
    await vi.advanceTimersByTimeAsync(250);
    await stopping;
    expect(lifecycle).toEqual(['mod a loaded', 'mod a failed: boom']);
    expect(seenByTerminate).toEqual(['failed', 'failed']);
    expect(host.statuses()).toEqual([]);
  });

  it('stopMod after dispose creates nothing and does not throw, and an unknown id is a no-op', async () => {
    startWithBandAndPanel(A);
    const during = host.stopMod('a'); // dispose arrives while stopMod waits
    const disposing = host.dispose();
    await vi.advanceTimersByTimeAsync(250);
    await Promise.all([during, disposing]);
    await expect(host.stopMod('a')).resolves.toBeUndefined();
    await expect(host.stopMod('nobody')).resolves.toBeUndefined();
    expect(created).toHaveLength(1);
    // stopMod posted it first; stopAll must not repeat it (the mod's hook would run twice).
    expect(created[0]?.count('deactivate')).toBe(1);
    expect(panelCalls).toEqual(['open a:p1', 'close a:p1']); // released once, not twice
  });
});
