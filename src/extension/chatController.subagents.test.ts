// Protects the host side of the subagent monitor (E2-subagent-monitor, issue #189): what the
// controller publishes about the CHILDREN of the session a pane shows (`subagent.activity`, the
// `subagents` of the snapshot, the tool count read after it) and what `subagent.stop` interrupts
// (only a running direct child of the parent named, never the parent).
//
// Provenance: a small FABRICATED client (hand-made rows and messages, cast to `ChatApi`) and a
// hand-fed stream, like `chatController.activity.test.ts`. Nothing here talks to a real opencode:
// it proves the routing and the revalidation, not that a real server emits these events or
// answers `interrupt` this way. Against the synthetic server the cases "monitors a CREW turn and
// stops one subagent without stopping the others" and "stop all interrupts the running subagents
// and not the parent" of `test/integration/fakeServer.test.ts` passed on Windows 11 (08/11/2026,
// `--label fake-server`, 64 passing); the W3 case (an error when nothing was stopped) has no
// integration counterpart.
import type { SessionInfo, V2Event } from '@opencode/client';
import { describe, expect, it } from 'vitest';
import type { HostToWebview, WebviewToHost } from '../shared/protocol';
import { ChatController, type ChatControllerDeps } from './chatController';
import type { EventStreamOptions } from './eventStream';
import type { ChatApi } from './opencodeClient';
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

/** Two tool blocks of a child, as REST returns them (newest message first in a page). */
const toolMessage = (id: string, blocks: string[]): unknown => ({
  id,
  type: 'assistant',
  agent: 'general',
  model: { id: 'm', providerID: 'p' },
  time: { created: 1 },
  content: blocks.map((block) => ({
    type: 'tool',
    id: block,
    name: 'read',
    state: { status: 'completed', input: { path: `${block}.ts` }, content: [] },
    time: { created: 1 },
  })),
});

interface Options {
  /** Child ids of `ses_a`; default `ses_kid` and `ses_bg`. */
  kids?: string[];
  /** Ids whose `interrupt` call rejects. */
  failing?: string[];
}

function setup(options: Options = {}) {
  const kids = options.kids ?? ['ses_kid', 'ses_bg'];
  const ids = ['ses_a', 'ses_b', ...kids];
  const row = (id: string): SessionInfo =>
    wire<SessionInfo>(
      JSON.stringify({
        id,
        ...(kids.includes(id) ? { parentID: 'ses_a' } : {}),
        projectID: 'p',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 2 },
        location: { directory: 'C:\\work' },
      }),
    );
  const interrupted: string[] = [];
  const messageReads: string[] = [];
  const api = {
    event: {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      }),
    },
    session: {
      list: (input?: { parentID?: unknown }) =>
        Promise.resolve({
          data: typeof input?.parentID === 'string' ? [] : ids.map(row),
          cursor: {},
        }),
      active: () => Promise.resolve({}),
      get: ({ sessionID }: { sessionID: string }) => Promise.resolve(row(sessionID)),
      interrupt: ({ sessionID }: { sessionID: string }) => {
        if (options.failing?.includes(sessionID) === true) {
          return Promise.reject(new Error('interrupt refused'));
        }
        interrupted.push(sessionID);
        return Promise.resolve({ interrupted: true });
      },
      diff: () => Promise.resolve([]),
    },
    message: {
      list: ({ sessionID }: { sessionID: string }) => {
        messageReads.push(sessionID);
        const data = kids.includes(sessionID) ? [toolMessage('m1', ['t1', 't2'])] : [];
        return Promise.resolve({ data, cursor: {} });
      },
    },
    model: {
      list: () => Promise.resolve({ location: LOCATION, data: [] }),
      default: () => Promise.resolve({ location: LOCATION, data: null }),
    },
    provider: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    agent: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    form: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    permission: { request: { list: () => Promise.resolve({ location: LOCATION, data: [] }) } },
  } as unknown as ChatApi;
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
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
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
  const posts: HostToWebview[][] = [[], []];
  const panes = posts.map((into, index) =>
    controller.attachPane({ post: (m) => into.push(m), primary: index === 0 }),
  );
  controller.onServerState({ kind: 'running', server: SERVER });
  let at = 100;
  const emit = (type: string, data: object): void => {
    at += 1;
    streams[0]?.onEvent(
      wire<V2Event>(JSON.stringify({ id: `evt_${String(at)}`, created: at, type, data })),
    );
  };
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  const send = async (index: number, message: WebviewToHost): Promise<void> => {
    await controller.handle(panes[index]?.id ?? -1, message);
  };
  return { controller, posts, emit, settle, send, interrupted, messageReads };
}

/** The `subagent.activity` messages of a pane's posts. */
const activities = (posts: HostToWebview[]) =>
  posts.flatMap((m) => (m.type === 'subagent.activity' ? [m] : []));

describe('the subagent monitor of the controller', () => {
  /**
   * Protects the routing: the digest of a child goes ONLY to the panes showing its parent, and a
   * burst of events of one child costs one message (the microtask coalescing). Pane 1 shows another
   * session, and an event of the root itself is no child's digest.
   */
  it('publishes the digest of a child only to the panes showing its parent, once per burst', async () => {
    const t = setup();
    await t.settle();
    await t.send(0, { type: 'session.open', requestId: 'o1', sessionID: 'ses_a' });
    await t.send(1, { type: 'session.open', requestId: 'o2', sessionID: 'ses_b' });
    await t.settle();
    const before = activities(t.posts[0] ?? []).length;
    t.emit('session.execution.started', { sessionID: 'ses_kid' });
    t.emit('session.tool.input.started', {
      sessionID: 'ses_kid',
      assistantMessageID: 'm',
      id: 'c1',
      name: 'read',
    });
    t.emit('session.execution.started', { sessionID: 'ses_a' });
    await t.settle(); // a macrotask drains the coalescing microtask before the count
    const sent = activities(t.posts[0] ?? []).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      sessionID: 'ses_a',
      activity: { sessionID: 'ses_kid', parentID: 'ses_a', running: true },
    });
    expect(sent[0]?.activity.recent.at(-1)).toMatchObject({ id: 'c1', status: 'running' });
    expect(activities(t.posts[1] ?? [])).toHaveLength(0);
  });

  /** Protects `open.subagents`: the snapshot of the open session carries its children's digests. */
  it('puts the digest of the children in the snapshot of the open session', async () => {
    const t = setup();
    await t.settle();
    await t.send(0, { type: 'session.open', requestId: 'o1', sessionID: 'ses_a' });
    const snapshot = [...(t.posts[0] ?? [])].reverse().find((m) => m.type === 'snapshot');
    const ids =
      snapshot?.type === 'snapshot'
        ? (snapshot.snapshot.open?.subagents ?? []).map((s) => s.sessionID).sort()
        : [];
    expect(ids).toEqual(['ses_bg', 'ses_kid']);
  });

  /**
   * Protects `refreshSubagents`: a child that ended before the tab opened still gets its tool
   * count (two blocks in the REST page), each child is read once even if the tab resyncs again,
   * and one call reads at most 10 children.
   */
  it('seeds the tool count of a child from its messages, once, up to the cap', async () => {
    const kids = Array.from({ length: 12 }, (_, index) => `ses_k${String(index)}`);
    const t = setup({ kids });
    await t.settle();
    await t.send(0, { type: 'session.open', requestId: 'o1', sessionID: 'ses_a' });
    await t.settle();
    expect(t.controller.activityOf('ses_k0')?.tools.count).toBe(2);
    expect(t.messageReads.filter((id) => id.startsWith('ses_k'))).toHaveLength(10);
    await t.controller.resync();
    await t.settle();
    const reads = t.messageReads.filter((id) => id.startsWith('ses_k'));
    expect(reads).toHaveLength(12);
    expect(new Set(reads).size).toBe(12);
  });

  /** Protects H3: stopping one child interrupts that session and neither its sibling nor the parent. */
  it('stops only the child it is told to', async () => {
    const t = setup();
    await t.controller.resync(); // the full resync teaches the registry who the parents are
    for (const id of ['ses_a', 'ses_kid', 'ses_bg'])
      t.emit('session.execution.started', { sessionID: id });
    await t.send(0, {
      type: 'subagent.stop',
      requestId: 's1',
      parentID: 'ses_a',
      sessionID: 'ses_kid',
    });
    expect(t.interrupted).toEqual(['ses_kid']);
    expect(t.posts[0]).toContainEqual({ type: 'request.result', requestId: 's1' });
  });

  /** Protects "stop all": every running child of the parent, and not the parent. */
  it('stops every running child and not the parent', async () => {
    const t = setup();
    await t.controller.resync();
    for (const id of ['ses_a', 'ses_kid', 'ses_bg'])
      t.emit('session.execution.started', { sessionID: id });
    t.emit('session.execution.succeeded', { sessionID: 'ses_bg' });
    await t.send(0, { type: 'subagent.stop', requestId: 's2', parentID: 'ses_a' });
    expect(t.interrupted).toEqual(['ses_kid']);
    t.emit('session.execution.started', { sessionID: 'ses_bg' });
    await t.send(0, { type: 'subagent.stop', requestId: 's3', parentID: 'ses_a' });
    expect([...t.interrupted].sort()).toEqual(['ses_bg', 'ses_kid', 'ses_kid']);
    expect(t.interrupted).not.toContain('ses_a');
  });

  /**
   * Protects the W3 decision of Sergio: a stop that interrupted nothing answers with an error the
   * user sees (the button would otherwise unlock in silence), a partial success answers without one.
   * SYNTHETIC: the fabricated client rejects `interrupt` for the ids in `failing`.
   */
  it('answers with an error when no child could be stopped, and without one when some was', async () => {
    const t = setup({ failing: ['ses_kid'] });
    await t.controller.resync();
    for (const id of ['ses_a', 'ses_kid', 'ses_bg'])
      t.emit('session.execution.started', { sessionID: id });
    await t.send(0, {
      type: 'subagent.stop',
      requestId: 'f1',
      parentID: 'ses_a',
      sessionID: 'ses_kid',
    });
    await t.send(0, { type: 'subagent.stop', requestId: 'f2', parentID: 'ses_a' });
    const results = (t.posts[0] ?? []).flatMap((m) =>
      m.type === 'request.result' && (m.requestId === 'f1' || m.requestId === 'f2') ? [m] : [],
    );
    expect(results.find((m) => m.requestId === 'f1')?.error?.code).toBe('SubagentStopFailed');
    expect(t.interrupted).toEqual(['ses_bg']);
    expect(results.find((m) => m.requestId === 'f2')?.error).toBeUndefined();
  });

  /** Protects the revalidation: a session that is not a running direct child is never interrupted. */
  it('refuses a session that is not a running direct child', async () => {
    const t = setup();
    await t.controller.resync();
    for (const id of ['ses_a', 'ses_b']) t.emit('session.execution.started', { sessionID: id });
    await t.send(0, {
      type: 'subagent.stop',
      requestId: 'r1',
      parentID: 'ses_a',
      sessionID: 'ses_b',
    });
    await t.send(0, {
      type: 'subagent.stop',
      requestId: 'r2',
      parentID: 'ses_a',
      sessionID: 'ses_kid',
    });
    expect(t.interrupted).toEqual([]);
    const errors = (t.posts[0] ?? []).flatMap((m) =>
      m.type === 'request.result' && m.error !== undefined ? [m.error.code] : [],
    );
    expect(errors).toEqual(['NotASubagent', 'NotASubagent']);
  });
});
