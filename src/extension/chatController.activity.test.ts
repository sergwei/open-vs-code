// Protects the controller's side of the shared activity registry (E2-session-activity: the piece
// common to E9-sidebar-home, issue #187, and the subagent monitor, issue #189): the registry the
// controller owns sees the stream and the snapshots (and a failing listener never costs the chat an
// event), and `stopSession` and `interruptSessions` stop only what the HOST sees running, in
// parallel and one failure at a time.
//
// Provenance: a small FABRICATED client (hand-made rows, cast to `ChatApi` because only the calls
// these cases reach exist) and a hand-fed stream, like `chatController.workMode.test.ts`. Nothing
// here talks to a real opencode: it proves the routing and the arbitration logic, not that a real
// server answers `interrupt` this way or emits these events in this order. UNVERIFIED against the
// synthetic server: no integration test stops sessions through this path yet.
import type { SessionInfo, V2Event } from '@opencode/client';
import { describe, expect, it } from 'vitest';
import type { HostToWebview } from '../shared/protocol';
import { ChatController, type ChatControllerDeps } from './chatController';
import type { EventStreamOptions } from './eventStream';
import type { ChatApi } from './opencodeClient';
import { MAX_INPUT_VALUE_CHARS } from './sessionActivity';
import { noSetup } from './test-fixtures/noSetup';

const SERVER = {
  url: 'http://127.0.0.1:43211',
  password: 'pw-secret-1',
  version: '2.0.32',
  folder: 'C:\\work',
  binaryPath: 'opencode.exe',
  pid: 1,
  source: 'spawned' as const,
};
const wire = <T>(json: string): T => JSON.parse(json) as T;
const LOCATION = wire<{ directory: string }>('{"directory":"C:\\\\work"}');
const PARENTS: Record<string, string> = { ses_kid: 'ses_a', ses_bg: 'ses_a' };
const IDS = ['ses_a', 'ses_b', 'ses_kid', 'ses_bg'];
const row = (id: string): SessionInfo =>
  wire<SessionInfo>(
    JSON.stringify({
      id,
      ...(PARENTS[id] === undefined ? {} : { parentID: PARENTS[id] }),
      projectID: 'p',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: 'C:\\work' },
    }),
  );

interface Options {
  /** What `session.interrupt` answers per session; default `true`. A string rejects with it. */
  interrupts?: Record<string, boolean | string>;
  /** When set, every `interrupt` waits for `releaseInterrupts()` (to prove they are parallel). */
  holdInterrupts?: boolean;
}

function setup(options: Options = {}) {
  const running: Record<string, { type: 'running' }> = {};
  const interrupted: string[] = [];
  const held: Array<() => void> = [];
  const counts = { active: 0 };
  const api = {
    event: {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      }),
    },
    session: {
      list: (input?: { parentID?: unknown }) =>
        Promise.resolve({
          data: typeof input?.parentID === 'string' ? [] : IDS.map(row),
          cursor: {},
        }),
      active: () => {
        counts.active += 1;
        return Promise.resolve({ ...running });
      },
      get: ({ sessionID }: { sessionID: string }) => Promise.resolve(row(sessionID)),
      interrupt: ({ sessionID }: { sessionID: string }) => {
        interrupted.push(sessionID);
        const answer = options.interrupts?.[sessionID] ?? true;
        const settle = (): Promise<{ interrupted: boolean }> =>
          typeof answer === 'string'
            ? Promise.reject(new Error(answer))
            : Promise.resolve({ interrupted: answer });
        if (options.holdInterrupts !== true) return settle();
        return new Promise((resolve, reject) => {
          held.push(() => {
            settle().then(resolve, reject);
          });
        });
      },
      diff: () => Promise.resolve([]),
    },
    message: { list: () => Promise.resolve({ data: [], cursor: {} }) },
    model: {
      list: () => Promise.resolve({ location: LOCATION, data: [] }),
      default: () => Promise.resolve({ location: LOCATION, data: null }),
    },
    provider: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    agent: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    form: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    permission: {
      request: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    },
  } as unknown as ChatApi;
  const logs: string[] = [];
  const streams: Array<EventStreamOptions<V2Event>> = [];
  const deps: ChatControllerDeps = {
    createClient: () => api,
    editor: {
      open: () => Promise.resolve(),
      editorContext: () => Promise.resolve({ refs: [], ranged: 0, unsaved: false }),
      insert: () => Promise.resolve(),
      newFile: () => Promise.resolve(),
      copy: () => Promise.resolve(),
      pickFiles: () => Promise.resolve([]),
      droppedFiles: () =>
        Promise.resolve({ refs: [], skipped: { folders: 0, outside: 0, remote: 0, missing: 0 } }),
      openDiff: () => Promise.resolve('diff'),
    },
    log: {
      info: (m) => logs.push(`info: ${m}`),
      warn: (m) => logs.push(`warn: ${m}`),
      error: (m) => logs.push(`error: ${m}`),
      debug: (m) => logs.push(`debug: ${m}`),
    },
    memory: { get: () => undefined, set: () => Promise.resolve() },
    attention: { update: () => undefined },
    savedPermissions: { pickToRevoke: () => Promise.resolve([]) },
    sessions: {
      confirmDelete: () => Promise.resolve(true),
      confirmRevertDiscard: () => Promise.resolve(true),
    },
    preferences: {
      defaultModel: () => undefined,
      lastModel: () => undefined,
      setLastModel: () => Promise.resolve(),
    },
    server: { restart: () => undefined, showLogs: () => undefined },
    setup: noSetup,
    ui: { setChatFocused: () => undefined, focusView: () => undefined },
    runStream: ((streamOptions: EventStreamOptions<V2Event>) => {
      streams.push(streamOptions);
      return new Promise<void>((resolve) => {
        streamOptions.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }) as ChatControllerDeps['runStream'],
  };
  const controller = new ChatController(deps);
  const posted: HostToWebview[] = [];
  const pane = controller.attachPane({ post: (m) => posted.push(m), primary: true });
  controller.onServerState({ kind: 'running', server: SERVER });
  let at = 100;
  const emit = (type: string, data: object): void => {
    at += 1;
    streams[0]?.onEvent(
      wire<V2Event>(JSON.stringify({ id: `evt_${String(at)}`, created: at, type, data })),
    );
  };
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  return {
    controller,
    pane,
    posted,
    logs,
    running,
    interrupted,
    counts,
    emit,
    settle,
    releaseInterrupts: (): void => held.splice(0).forEach((release) => release()),
  };
}

describe('the activity registry of the controller', () => {
  /**
   * The registry is fed at the top of `onEvent`; a listener that throws is the way a consumer can
   * make it fail. A second listener, registered after the throwing one, must still be called for
   * each change: that is what "the other listeners still run" rests on. Provenance: fabricated
   * events.
   */
  it('sees the events of a turn, and a throwing listener does not stop the chat', async () => {
    const t = setup();
    await t.settle();
    t.controller.onActivity(() => {
      throw new Error('listener broke');
    });
    // Registered AFTER the throwing one: it must still hear every change.
    const heard: string[][] = [];
    t.controller.onActivity((ids) => heard.push([...ids]));
    t.emit('session.execution.started', { sessionID: 'ses_a' });
    t.emit('session.tool.input.started', {
      sessionID: 'ses_a',
      assistantMessageID: 'm',
      id: 'c1',
      name: 'read',
    });
    expect(t.controller.activityOf('ses_a')).toMatchObject({
      running: true,
      current: { kind: 'tool', name: 'read' },
    });
    expect(t.controller.runningSessions()).toEqual(['ses_a']);
    expect(heard).toEqual([['ses_a'], ['ses_a']]);
    expect(t.logs).toContain('warn: activity listener failed: Error: listener broke');
    // The chat still got the event: the pane is told the session is busy.
    expect(t.posted.some((m) => m.type === 'session.status')).toBe(true);
  });

  /**
   * Architecture rule 1: the server's URL and password never leave the host. The registry keeps the
   * raw text of a failed call, so `activityOf` is where it is scrubbed. Provenance: fabricated
   * events with a PLANTED secret (the password and the loopback URL of `SERVER`).
   */
  it("activityOf scrubs the server URL and password out of a failed tool's error and its input strings", async () => {
    const t = setup();
    await t.settle();
    t.emit('session.execution.started', { sessionID: 'ses_a' });
    t.emit('session.tool.input.started', {
      sessionID: 'ses_a',
      assistantMessageID: 'm',
      id: 'c1',
      name: 'fetch',
    });
    t.emit('session.tool.called', {
      sessionID: 'ses_a',
      assistantMessageID: 'm',
      id: 'c1',
      input: { url: `${SERVER.url}/x?p=${SERVER.password}`, n: 1 },
    });
    t.emit('session.tool.failed', {
      sessionID: 'ses_a',
      assistantMessageID: 'm',
      id: 'c1',
      error: { type: 'x', message: `refused ${SERVER.url} with ${SERVER.password}` },
    });
    const run = t.controller.activityOf('ses_a')?.tools.recent[0];
    expect(run?.status).toBe('error');
    expect(run?.input?.n).toBe(1);
    const text = JSON.stringify(run);
    expect(text).not.toContain(SERVER.password);
    expect(text).not.toContain('127.0.0.1');
    expect(run?.error).toContain('refused');
  });

  /**
   * Protects the order "scrub, then cut": a secret that straddles the 160th character of an input
   * string keeps its prefix if the cut comes first. The filler is computed so the secret really
   * crosses the cut (the first expects pin it): the password starts 5 characters before index 160
   * and ends after it; the URL's `http://127.0` ends exactly at 160 (a cut-first copy keeps
   * `127.0`, which the loopback pattern needs a port to match). MUTATION seen red on 08/11/2026:
   * with `slimInput` cutting BEFORE `clean`, both cases failed on `not.toContain(...)`.
   * Provenance: fabricated events with planted secrets; nothing from a real server.
   */
  it.each([
    {
      name: 'the password',
      lead: ' -u opencode:',
      before: 5,
      secret: SERVER.password,
      leaks: SERVER.password.slice(0, 4),
    },
    {
      name: 'the loopback URL',
      lead: '',
      before: 'http://127.0'.length,
      secret: SERVER.url,
      leaks: '127.0',
    },
  ])(
    'activityOf keeps $name out of the registry when it crosses the 160-character cut',
    async (c) => {
      const pad = 'x'.repeat(MAX_INPUT_VALUE_CHARS - c.lead.length - c.before);
      const long = `${pad}${c.lead}${c.secret} tail`;
      const start = long.indexOf(c.secret);
      expect(start).toBeLessThan(MAX_INPUT_VALUE_CHARS);
      expect(start + c.secret.length).toBeGreaterThan(MAX_INPUT_VALUE_CHARS);
      const t = setup();
      await t.settle();
      t.emit('session.execution.started', { sessionID: 'ses_a' });
      t.emit('session.tool.input.started', {
        sessionID: 'ses_a',
        assistantMessageID: 'm',
        id: 'c1',
        name: 'bash',
      });
      t.emit('session.tool.called', {
        sessionID: 'ses_a',
        assistantMessageID: 'm',
        id: 'c1',
        input: { command: long },
      });
      const text = JSON.stringify(t.controller.activityOf('ses_a'));
      // Not even the first characters of the secret survive the cut.
      expect(text).not.toContain(c.leaks);
      expect(t.controller.activityOf('ses_a')?.tools.recent[0]?.input?.command).toBeDefined();
    },
  );

  /** The agent and the tool name are the server's text too: scrubbed like the rest (fabricated). */
  it('activityOf scrubs the password out of an agent and a tool name', async () => {
    const t = setup();
    await t.settle();
    t.emit('session.execution.started', { sessionID: 'ses_a' });
    t.emit('session.step.started', { sessionID: 'ses_a', agent: `a-${SERVER.password}` });
    t.emit('session.tool.input.started', {
      sessionID: 'ses_a',
      assistantMessageID: 'm',
      id: 'c1',
      name: `t-${SERVER.password}`,
    });
    const text = JSON.stringify(t.controller.activityOf('ses_a'));
    expect(text).not.toContain(SERVER.password);
    expect(t.controller.activityOf('ses_a')?.agent).toMatch(/^a-/);
    expect(t.controller.activityOf('ses_a')?.current).toMatchObject({ kind: 'tool' });
  });

  it('a full resync tells the registry what runs and a pane-only one does not', async () => {
    const t = setup();
    t.running.ses_a = { type: 'running' };
    t.emit('server.connected', {});
    await t.settle();
    expect(t.controller.activityOf('ses_a')).toMatchObject({ running: true });
    expect(t.controller.activityOf('ses_a')?.since).toBeUndefined();
    expect(t.controller.activityOf('ses_kid')).toMatchObject({ parentID: 'ses_a', running: false });
    delete t.running.ses_a;
    await t.controller.resync([t.pane]);
    expect(t.controller.activityOf('ses_a')?.running).toBe(true);
    await t.controller.resync();
    expect(t.controller.activityOf('ses_a')?.running).toBe(false);
  });
});

describe('stopSession and interruptSessions', () => {
  const FROM = ' from the side bar';
  const start = (t: ReturnType<typeof setup>, ...ids: string[]): void => {
    for (const sessionID of ids) t.emit('session.execution.started', { sessionID });
  };
  const learn = async (t: ReturnType<typeof setup>): Promise<void> => {
    t.emit('server.connected', {});
    await t.settle();
  };

  it('stopSession interrupts the root and its running descendants and refuses a tree that is not running', async () => {
    const t = setup();
    await learn(t);
    start(t, 'ses_a', 'ses_kid', 'ses_b');
    expect(await t.controller.stopSession('ses_zzz', FROM)).toEqual({ status: 'refused' });
    expect(await t.controller.stopSession('ses_a', FROM)).toEqual({
      status: 'stopped',
      sessions: ['ses_a', 'ses_kid'],
    });
    expect([...t.interrupted].sort()).toEqual(['ses_a', 'ses_kid']);
    // The origin is the caller's: it lands verbatim on each line.
    expect(t.logs).toContain(
      'info: abort requested for ses_a (interrupted: true) from the side bar',
    );
    expect(t.logs).toContain(
      'info: abort requested for ses_kid (interrupted: true) from the side bar',
    );
  });

  /**
   * The lineage learns a child from the rows of a resync or from `session.upserted`; here the
   * registry alone hears `session.created` (before any resync read it), so only its `parentID`
   * links tell the child belongs to `ses_a`. Provenance: fabricated events; the first expect
   * pins the premise (the lineage does not resolve the root).
   */
  it("stopSession also follows the registry's parent links when the lineage does not know the root", async () => {
    const t = setup();
    t.emit('session.created', { sessionID: 'ses_new', parentID: 'ses_a' });
    t.emit('session.created', { sessionID: 'ses_grand', parentID: 'ses_new' });
    start(t, 'ses_a', 'ses_new', 'ses_grand', 'ses_b');
    expect(t.controller.rootOf('ses_grand')).toBeUndefined();
    expect(await t.controller.stopSession('ses_a', FROM)).toEqual({
      status: 'stopped',
      sessions: ['ses_a', 'ses_new', 'ses_grand'],
    });
    expect(t.interrupted).not.toContain('ses_b');
  });

  it('stops a background child although its root already ended', async () => {
    const t = setup();
    await learn(t);
    start(t, 'ses_a', 'ses_bg');
    t.emit('session.execution.succeeded', { sessionID: 'ses_a' });
    expect(await t.controller.stopSession('ses_a', FROM)).toEqual({
      status: 'stopped',
      sessions: ['ses_bg'],
    });
    expect(t.interrupted).toEqual(['ses_bg']);
  });

  it('interruptSessions skips what the host does not see running and calls the rest in parallel', async () => {
    const t = setup({ holdInterrupts: true });
    start(t, 'ses_a', 'ses_b');
    const pending = t.controller.interruptSessions(['ses_a', 'ses_b', 'ses_kid', 'ses_a'], '');
    await t.settle();
    // Both are in flight before either answered, and the idle one and the duplicate were skipped.
    expect([...t.interrupted].sort()).toEqual(['ses_a', 'ses_b']);
    t.releaseInterrupts();
    expect((await pending).sort()).toEqual(['ses_a', 'ses_b']);
    expect(t.logs).toContain('info: abort requested for ses_a (interrupted: true)');
  });

  it('a failure of one interrupt does not stop the others, and interrupted false resyncs once', async () => {
    const t = setup({ interrupts: { ses_a: 'boom', ses_b: false, ses_kid: true } });
    await learn(t);
    start(t, 'ses_a', 'ses_b', 'ses_kid');
    const before = t.counts.active;
    const done = await t.controller.interruptSessions(['ses_a', 'ses_b', 'ses_kid'], ' (test)');
    expect(done).toEqual(['ses_kid']);
    expect(t.logs.some((l) => l.startsWith('warn: abort failed for ses_a:'))).toBe(true);
    expect(t.logs).toContain('info: abort requested for ses_b (interrupted: false) (test)');
    expect(t.logs).toContain('info: abort requested for ses_kid (interrupted: true) (test)');
    expect(t.counts.active - before).toBe(1);
  });

  it('does nothing without a server', async () => {
    const t = setup();
    t.controller.onServerState({ kind: 'stopped' });
    expect(await t.controller.interruptSessions(['ses_a'], '')).toEqual([]);
    expect(await t.controller.stopSession('ses_a', FROM)).toEqual({ status: 'refused' });
  });
});
