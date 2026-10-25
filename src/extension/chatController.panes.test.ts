// Protects the routing between SEVERAL chat surfaces (panes) served by one `ChatController` (issue
// #77, phase 1 of `E9-chat-editor-tabs`), which the single-pane battery (`chatController.test.ts`,
// run through `onePane()`) cannot see: the answer to a request reaches only the pane that asked
// (two panes use the same `requestId` on purpose: the ids are a per-document counter); the content
// of a session reaches only the pane showing it while the location's news reaches all; a server
// connection reads the location once and publishes one snapshot per pane; a pane that opens or
// creates a session does not move another pane; a closed pane stops receiving; and the "Changed
// files" and revert holders are per pane (a path listed for A cannot be opened from B).
//
// Provenance: a small FAKE client (hand-made rows in the shape of the REST answers, cast to
// `ChatApi` because only the calls these cases reach are implemented) and a fake stream runner
// that lets the test feed events. Nothing here talks to a real opencode or VS Code: it proves the
// routing logic, not that the real server or a real tab behaves so. The same routing against a
// real client and SSE loop is `chatController.e2e.test.ts` ("streams two prompts at once, each pane receiving only the
// content of its own session").
import type { FileDiffInfo, SessionInfo, V2Event } from '@opencode/client';
import { describe, expect, it } from 'vitest';
import type { HostToWebview, WebviewToHost } from '../shared/protocol';
import { ChatController, type ChatControllerDeps } from './chatController';
import type { ChatPane } from './chatPane';
import type { EventStreamOptions } from './eventStream';
import type { ChatApi } from './opencodeClient';

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

/** A session row in the shape of a real `session.list` row. */
const row = (id: string): SessionInfo =>
  wire<SessionInfo>(
    `{"id":"${id}","projectID":"p","cost":0,"tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"time":{"created":1,"updated":2},"location":{"directory":"C:\\\\work"}}`,
  );

const LOCATION = wire<{ directory: string }>('{"directory":"C:\\\\work"}');

/** A fake client with only what these cases reach; `calls` records the root list reads. */
function fakeClient(sessions: string[]) {
  const calls: string[] = [];
  let created = 0;
  const api = {
    event: {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      }),
    },
    session: {
      list: (input?: { parentID?: unknown }) => {
        if (typeof input?.parentID === 'string') return Promise.resolve({ data: [], cursor: {} });
        calls.push('session.list');
        return Promise.resolve({ data: sessions.map(row), cursor: {} });
      },
      active: () => Promise.resolve({}),
      get: ({ sessionID }: { sessionID: string }) => Promise.resolve(row(sessionID)),
      create: () => {
        created += 1;
        const id = `ses_new${String(created)}`;
        sessions.push(id);
        return Promise.resolve(row(id));
      },
      prompt: () => Promise.resolve({ id: 'msg_in' }),
      diff: (): Promise<FileDiffInfo[]> => Promise.resolve([]),
      message: { get: () => Promise.reject(new Error('not used')) },
      revert: {
        stage: () => {
          calls.push('session.revert.stage');
          return Promise.resolve({ messageID: 'x', files: [] });
        },
      },
    },
    message: { list: () => Promise.resolve({ data: [], cursor: {} }) },
    model: {
      list: () => Promise.resolve({ location: LOCATION, data: [] }),
      default: () => Promise.resolve({ location: LOCATION, data: null }),
    },
    provider: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    agent: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    form: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    permission: { request: { list: () => Promise.resolve({ location: LOCATION, data: [] }) } },
  } as unknown as ChatApi;
  return { api, calls };
}

/** A controller with `count` panes over fake surfaces, a running server and a hand-fed stream. */
function setup(count = 2, sessions: string[] = ['ses_a', 'ses_b']) {
  const { api, calls } = fakeClient(sessions);
  const opened: string[] = [];
  const remembered = new Map<string, string | undefined>();
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
      openDiff: (target) => {
        opened.push(target.path);
        return Promise.resolve('diff');
      },
    },
    log: {
      info: (m) => logs.push(`info: ${m}`),
      warn: (m) => logs.push(`warn: ${m}`),
      error: (m) => logs.push(`error: ${m}`),
      debug: (m) => logs.push(`debug: ${m}`),
    },
    // Last-writer-wins per folder, like the real workspaceState memory.
    memory: {
      get: (folder) => remembered.get(folder),
      set: (folder, id) => {
        remembered.set(folder, id);
        return Promise.resolve();
      },
    },
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
    ui: { setChatFocused: () => undefined, focusView: () => undefined },
    runStream: ((options: EventStreamOptions<V2Event>) => {
      streams.push(options);
      return new Promise<void>((resolve) => {
        options.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }) as ChatControllerDeps['runStream'],
  };
  const controller = new ChatController(deps);
  const panes: Array<{ pane: ChatPane; posted: HostToWebview[] }> = [];
  for (let index = 0; index < count; index++) {
    const posted: HostToWebview[] = [];
    panes.push({ pane: controller.attachPane({ post: (m) => posted.push(m) }), posted });
  }
  controller.onServerState({ kind: 'running', server: SERVER });
  const emit = (type: string, data: object): void => {
    streams[0]?.onEvent(
      wire<V2Event>(JSON.stringify({ id: `evt_${type}`, created: 5, type, data })),
    );
  };
  /** Sends a webview message as pane `index` and waits for it. */
  const send = (index: number, message: WebviewToHost): Promise<void> =>
    controller.handle(panes[index]?.pane.id ?? -1, message);
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  return { controller, panes, calls, logs, opened, emit, send, flush };
}

const typesOf = (posted: HostToWebview[]): string[] => posted.map((m) => m.type);

describe('answers go only to the pane that asked', () => {
  it('delivers a request.result to the pane that sent the request, with the same requestId in two panes', async () => {
    const { panes, send } = setup();
    await send(0, { type: 'session.new', requestId: 'r1' });
    await send(1, { type: 'session.new', requestId: 'r1' });
    for (const { posted } of panes) {
      expect(posted.filter((m) => m.type === 'request.result')).toEqual([
        { type: 'request.result', requestId: 'r1' },
      ]);
    }
    // Pane 0's own request: only its snapshot and its result, nothing of pane 1's answer.
    const first = panes[0]?.posted ?? [];
    expect(first.filter((m) => m.type === 'snapshot')).toHaveLength(1);
  });

  it('sends a notice caused by a request to that pane only', async () => {
    const { panes, send } = setup();
    // Pane 1 asks to open a diff of a path nobody listed: refused with a warning notice for IT.
    await send(1, { type: 'session.diff.open', sessionID: 'ses_a', path: 'src/x.ts' });
    expect((panes[1]?.posted ?? []).filter((m) => m.type === 'notice')).toHaveLength(1);
    expect((panes[0]?.posted ?? []).filter((m) => m.type === 'notice')).toHaveLength(0);
  });
});

describe('what a session produces reaches the panes showing it', () => {
  it('sends part.delta of A to the pane on A only, and session.status to both', async () => {
    const { panes, send, emit } = setup();
    await send(0, { type: 'session.open', requestId: 'o1', sessionID: 'ses_a' });
    await send(1, { type: 'session.open', requestId: 'o2', sessionID: 'ses_b' });
    for (const { posted } of panes) posted.length = 0;
    const a = { sessionID: 'ses_a', assistantMessageID: 'msg_a1' };
    emit('session.execution.started', { sessionID: 'ses_a' });
    emit('session.step.started', {
      ...a,
      agent: 'build',
      model: { id: 'm', providerID: 'p' },
      started: 5,
    });
    emit('session.text.started', { ...a, ordinal: 0 });
    emit('session.text.delta', { ...a, ordinal: 0, delta: 'hi' });
    const [first, second] = panes.map(({ posted }) => typesOf(posted));
    expect(first).toEqual(['session.status', 'message.upserted', 'part.upserted', 'part.delta']);
    expect(second).toEqual(['session.status']);
  });

  it('streams two sessions at once, each pane getting only its own deltas', async () => {
    const { panes, send, emit } = setup();
    await send(0, { type: 'session.open', requestId: 'o1', sessionID: 'ses_a' });
    await send(1, { type: 'session.open', requestId: 'o2', sessionID: 'ses_b' });
    for (const { posted } of panes) posted.length = 0;
    for (const [session, message] of [
      ['ses_a', 'msg_a1'],
      ['ses_b', 'msg_b1'],
    ] as const) {
      const ids = { sessionID: session, assistantMessageID: message };
      emit('session.step.started', {
        ...ids,
        agent: 'build',
        model: { id: 'm', providerID: 'p' },
        started: 5,
      });
      emit('session.text.started', { ...ids, ordinal: 0 });
    }
    for (const [session, message, delta] of [
      ['ses_a', 'msg_a1', 'alpha'],
      ['ses_b', 'msg_b1', 'beta'],
      ['ses_a', 'msg_a1', '!'],
    ] as const) {
      emit('session.text.delta', {
        sessionID: session,
        assistantMessageID: message,
        ordinal: 0,
        delta,
      });
    }
    const deltas = (index: number): string[] =>
      (panes[index]?.posted ?? []).flatMap((m) => (m.type === 'part.delta' ? [m.delta] : []));
    expect(deltas(0)).toEqual(['alpha', '!']);
    expect(deltas(1)).toEqual(['beta']);
  });

  it('refuses from the pane on B the diff path and the revert of A, and sends it no list of A', async () => {
    const { panes, send, emit, flush, opened } = setup();
    await send(0, { type: 'session.open', requestId: 'o1', sessionID: 'ses_a' });
    await send(1, { type: 'session.open', requestId: 'o2', sessionID: 'ses_b' });
    await flush();
    for (const { posted } of panes) posted.length = 0;
    emit('session.step.ended', {
      sessionID: 'ses_a',
      assistantMessageID: 'msg_a1',
      finish: 'stop',
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      files: ['src/x.ts'],
    });
    await flush();
    expect(typesOf(panes[1]?.posted ?? [])).not.toContain('session.diff');
    // B may not open a path of A, nor stage a revert on it.
    await send(1, { type: 'session.diff.open', sessionID: 'ses_a', path: 'src/x.ts' });
    await send(1, {
      type: 'session.revert.stage',
      requestId: 's1',
      sessionID: 'ses_a',
      messageID: 'msg_u',
    });
    expect(opened).toEqual([]);
    expect(panes[1]?.posted).toContainEqual({
      type: 'request.result',
      requestId: 's1',
      error: { code: 'SessionNotOpen', message: 'Only the open session can be reverted' },
    });
  });
});

describe('connecting the server', () => {
  it('reads the location once and publishes one snapshot per pane, each with its own session', async () => {
    const { controller, panes, calls, send, emit, flush } = setup();
    await send(0, { type: 'session.open', requestId: 'o1', sessionID: 'ses_a' });
    await send(1, { type: 'session.open', requestId: 'o2', sessionID: 'ses_b' });
    for (const { posted } of panes) posted.length = 0;
    calls.length = 0;
    emit('server.connected', {});
    await flush();
    await controller.loadCatalog();
    expect(calls.filter((call) => call === 'session.list')).toHaveLength(1);
    const open = (index: number): string | undefined => {
      const snapshot = (panes[index]?.posted ?? []).find((m) => m.type === 'snapshot');
      return snapshot?.type === 'snapshot' ? snapshot.snapshot.open?.sessionID : undefined;
    };
    expect(open(0)).toBe('ses_a');
    expect(open(1)).toBe('ses_b');
  });

  // Protects W1 of review-1 (fix round 1): the memory per folder is last-writer-wins, so a restart
  // of the same folder must not hand pane 1 the session pane 2 opened last. Fake memory and client.
  it('keeps every pane on its own session when the server restarts on the same folder', async () => {
    const { controller, panes, send } = setup();
    await send(0, { type: 'session.open', requestId: 'o1', sessionID: 'ses_a' });
    await send(1, { type: 'session.open', requestId: 'o2', sessionID: 'ses_b' });
    controller.onServerState({
      kind: 'running',
      server: { ...SERVER, url: 'http://127.0.0.1:43999' },
    });
    expect(panes[0]?.pane.sessionID).toBe('ses_a');
    expect(panes[1]?.pane.sessionID).toBe('ses_b');
  });

  it('drops the sessions of every pane when the folder changes and nothing is remembered for it', async () => {
    const { controller, panes, send } = setup();
    await send(0, { type: 'session.open', requestId: 'o1', sessionID: 'ses_a' });
    await send(1, { type: 'session.open', requestId: 'o2', sessionID: 'ses_b' });
    controller.onServerState({
      kind: 'running',
      server: { ...SERVER, url: 'http://127.0.0.1:43999', folder: 'C:\\other' },
    });
    expect(panes[0]?.pane.sessionID).toBeUndefined();
    expect(panes[1]?.pane.sessionID).toBeUndefined();
  });

  it('answers the ready of one pane with a snapshot for that pane only', async () => {
    const { panes, controller } = setup();
    for (const { posted } of panes) posted.length = 0;
    await controller.onPaneReady(panes[1]?.pane.id ?? -1);
    expect(typesOf(panes[0]?.posted ?? [])).toEqual([]);
    expect(typesOf(panes[1]?.posted ?? [])).toContain('snapshot');
  });
});

describe('a pane that creates or opens a session', () => {
  it('binds the new session to its pane only', async () => {
    const { panes, send } = setup();
    await send(1, {
      type: 'prompt.send',
      requestId: 'p1',
      text: 'hi',
      delivery: 'queue',
      files: [],
    });
    expect(panes[1]?.pane.sessionID).toBe('ses_new1');
    expect(panes[0]?.pane.sessionID).toBeUndefined();
    expect(panes[1]?.posted).toContainEqual({ type: 'request.result', requestId: 'p1' });
    expect(panes[0]?.posted.filter((m) => m.type === 'request.result')).toEqual([]);
  });

  it('keeps the other pane on its session when one forgets its own (New session)', async () => {
    const { panes, send } = setup();
    await send(0, { type: 'session.open', requestId: 'o1', sessionID: 'ses_a' });
    await send(1, { type: 'session.open', requestId: 'o2', sessionID: 'ses_b' });
    await send(0, { type: 'session.new', requestId: 'n1' });
    expect(panes[0]?.pane.sessionID).toBeUndefined();
    expect(panes[1]?.pane.sessionID).toBe('ses_b');
  });
});

describe('closing a pane', () => {
  it('stops receiving and stops being tracked, while the others go on', async () => {
    const { controller, panes, send, emit } = setup();
    await send(0, { type: 'session.open', requestId: 'o1', sessionID: 'ses_a' });
    await send(1, { type: 'session.open', requestId: 'o2', sessionID: 'ses_b' });
    controller.detachPane(panes[0]?.pane.id ?? -1);
    for (const { posted } of panes) posted.length = 0;
    emit('session.execution.started', { sessionID: 'ses_a' });
    emit('session.execution.started', { sessionID: 'ses_b' });
    expect(panes[0]?.posted).toEqual([]);
    expect(typesOf(panes[1]?.posted ?? [])).toEqual(['session.status', 'session.status']);
    // A message from the closed pane is dropped with a warning, not answered.
    await controller.handle(panes[0]?.pane.id ?? -1, { type: 'session.new', requestId: 'late' });
    expect(panes[0]?.posted).toEqual([]);
  });
});
