// Protects the host side of the work mode (E3-work-mode): in Auto the host answers `once` to the
// permission requests of the session and its subagents with NO card, notification or badge; in
// Manual nothing changes; what `keepsForUser` keeps for the user (secrets, deletions, destructive
// commands, outside the project) keeps asking in both; a failed answer ends as the normal
// card plus a warning; the mode follows the session (two panes on it agree, a deleted session
// forgets it, a draft passes to the session the first prompt creates).
//
// Provenance: a small FABRICATED client (hand-made rows and request lists, cast to `ChatApi`
// because only the calls these cases reach exist) and a hand-fed stream, like
// `chatController.panes.test.ts`. Nothing here talks to a real opencode: it proves the routing and
// timing logic, not that a real server accepts the reply or emits these events with this shape.
// The same path against the synthetic server is `test/integration/fakeServer.test.ts` ("answers
// permissions by itself in Auto work mode ...").
import type { PermissionRequest, SessionInfo, V2Event } from '@opencode/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostToWebview, WebviewToHost } from '../shared/protocol';
import { ChatController, type ChatControllerDeps } from './chatController';
import type { ChatPane } from './chatPane';
import type { EventStreamOptions } from './eventStream';
import type { ChatApi } from './opencodeClient';
import type { PendingSummary } from './pendingRequests';
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
const PARENTS: Record<string, string> = {
  ses_kid: 'ses_a',
  ses_orphan: 'ses_mid',
  ses_mid: 'ses_a',
};
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
const request = (
  id: string,
  sessionID: string,
  action = 'edit',
  resource = 'src/a.ts',
  metadata?: { [key: string]: unknown },
) => ({
  id,
  sessionID,
  action,
  resources: [resource],
  save: [],
  ...(metadata === undefined ? {} : { metadata }),
});
const asRest = (raw: ReturnType<typeof request>): PermissionRequest =>
  wire<PermissionRequest>(JSON.stringify(raw));

/** `reply` outcomes of the fake server, one per call, the last one repeating. */
type ReplyPlan = Array<'ok' | 'fail' | 'gone' | 'hang'>;

function setup(plan: ReplyPlan = ['ok']) {
  const sessions = ['ses_a', 'ses_b', 'ses_kid', 'ses_orphan', 'ses_mid'];
  const unlisted = new Set(['ses_mid']);
  const rest: { permissions: PermissionRequest[] } = { permissions: [] };
  const replies: Array<{ sessionID: string; requestID: string; decision: string }> = [];
  const releaseHung: Array<() => void> = [];
  let created = 0;
  const api = {
    event: {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      }),
    },
    session: {
      list: (input?: { parentID?: unknown }) =>
        Promise.resolve({
          data:
            typeof input?.parentID === 'string'
              ? []
              : sessions.filter((id) => !unlisted.has(id)).map(row),
          cursor: {},
        }),
      active: () => Promise.resolve({}),
      get: ({ sessionID }: { sessionID: string }) => Promise.resolve(row(sessionID)),
      create: () => {
        created += 1;
        const id = `ses_new${String(created)}`;
        sessions.push(id);
        return Promise.resolve(row(id));
      },
      prompt: () => Promise.resolve({ id: 'msg_in' }),
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
      request: { list: () => Promise.resolve({ location: LOCATION, data: [...rest.permissions] }) },
      reply: (input: { sessionID: string; requestID: string; decision: string }) => {
        replies.push(input);
        const outcome = plan[Math.min(replies.length - 1, plan.length - 1)];
        if (outcome === 'fail') return Promise.reject(new Error('boom'));
        // The real client throws the body of a declared HTTP error, not an Error.
        if (outcome === 'gone') {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          return Promise.reject({ _tag: 'PermissionNotFoundError', message: 'x' });
        }
        if (outcome === 'hang') return new Promise<void>((resolve) => releaseHung.push(resolve));
        return Promise.resolve();
      },
    },
  } as unknown as ChatApi;
  const attention: PendingSummary[][] = [];
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
    attention: { update: (requests) => attention.push([...requests]) },
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
    runStream: ((options: EventStreamOptions<V2Event>) => {
      streams.push(options);
      return new Promise<void>((resolve) => {
        options.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }) as ChatControllerDeps['runStream'],
  };
  const controller = new ChatController(deps);
  const panes: Array<{ pane: ChatPane; posted: HostToWebview[] }> = [];
  for (let index = 0; index < 2; index++) {
    const posted: HostToWebview[] = [];
    panes.push({
      // Chat tabs (`ownRequestsOnly`): they show only their lineage's requests and make the host
      // walk an incomplete lineage, as production does.
      pane: controller.attachPane({
        post: (m) => posted.push(m),
        primary: index === 0,
        ownRequestsOnly: true,
      }),
      posted,
    });
  }
  controller.onServerState({ kind: 'running', server: SERVER });
  const emit = (type: string, data: object): void => {
    streams[0]?.onEvent(
      wire<V2Event>(JSON.stringify({ id: `evt_${type}`, created: 5, type, data })),
    );
  };
  const send = (index: number, message: WebviewToHost): Promise<void> =>
    controller.handle(panes[index]?.pane.id ?? -1, message);
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  const open = async (index: number, sessionID: string): Promise<void> => {
    await send(index, { type: 'session.open', requestId: `o${sessionID}`, sessionID });
    for (const { posted } of panes) posted.length = 0;
  };
  const types = (index: number): string[] => (panes[index]?.posted ?? []).map((m) => m.type);
  const modes = (index: number): string[] =>
    (panes[index]?.posted ?? []).flatMap((m) => (m.type === 'workMode.state' ? [m.mode] : []));
  return {
    controller,
    panes,
    attention,
    rest,
    replies,
    releaseHung,
    logs,
    emit,
    send,
    settle,
    open,
    types,
    modes,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Auto work mode answers permissions by itself', () => {
  it('answers once with no card, no notification and a record flagged auto', async () => {
    const t = setup();
    await t.open(0, 'ses_a');
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    t.emit('permission.asked', request('per_1', 'ses_a'));
    await t.settle();
    expect(t.replies).toEqual([{ sessionID: 'ses_a', requestID: 'per_1', decision: 'once' }]);
    expect(t.types(0)).not.toContain('permission.asked');
    expect(t.types(1)).not.toContain('permission.asked');
    expect(t.attention.flat().filter((s) => s.id === 'per_1')).toEqual([]);
    expect(t.logs).toContain('info: permission auto-approved per_1 for ses_a (edit)');
    t.emit('permission.replied', { sessionID: 'ses_a', requestID: 'per_1', reply: 'once' });
    const resolved = t.panes[0]?.posted.find((m) => m.type === 'permission.resolved');
    expect(resolved).toMatchObject({
      resolution: { auto: true, decision: 'once', action: 'edit' },
    });
  });

  it('shows the card as before in Manual and never answers by itself', async () => {
    const t = setup();
    await t.open(0, 'ses_a');
    t.emit('permission.asked', request('per_1', 'ses_a'));
    await t.settle();
    expect(t.replies).toEqual([]);
    expect(t.types(0)).toContain('permission.asked');
    expect(t.attention.flat().some((s) => s.id === 'per_1')).toBe(true);
  });

  it('keeps asking for .env reads in Auto, and approves .env.example', async () => {
    const t = setup();
    await t.open(0, 'ses_a');
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    t.emit('permission.asked', request('per_env', 'ses_a', 'read', 'config/.env.local'));
    t.emit('permission.asked', request('per_ex', 'ses_a', 'read', '.env.example'));
    await t.settle();
    expect(t.replies.map((r) => r.requestID)).toEqual(['per_ex']);
    const asked = t.panes[0]?.posted.filter((m) => m.type === 'permission.asked') ?? [];
    expect(asked.map((m) => (m.type === 'permission.asked' ? m.permission.id : ''))).toEqual([
      'per_env',
    ]);
    expect(t.attention.flat().some((s) => s.id === 'per_env')).toBe(true);
  });

  /** Protects the decision "Auto never approves a destructive command" end to end, also in the sweep. */
  it('keeps a destructive shell command as a card in Auto, in the stream and in the sweep', async () => {
    const t = setup();
    await t.open(0, 'ses_a');
    const stale = request('per_old', 'ses_a', 'shell', 'rm -rf build');
    t.rest.permissions.push(asRest(stale));
    t.emit('permission.asked', stale); // a card while Manual
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    await t.settle();
    t.emit('permission.asked', request('per_new', 'ses_a', 'shell', 'git reset --hard'));
    t.emit('permission.asked', request('per_ok', 'ses_a', 'shell', 'npm test'));
    await t.settle();
    expect(t.replies.map((r) => r.requestID)).toEqual(['per_ok']);
    expect(t.attention.flat().some((s) => s.id === 'per_old')).toBe(true);
    expect(t.attention.flat().some((s) => s.id === 'per_new')).toBe(true);
  });

  /**
   * Protects the review #1988 (S1, W2) end to end: an `edit` whose `metadata.files` says `deleted`
   * reaches the controller through the stream and the sweep (so through `toPermissionAsk`, which
   * must keep the metadata) and stays a card, like `external_directory` (decision
   * `secretos-y-borrados` 4); a modified file is still approved. Fabricated requests.
   */
  it('keeps an edit that deletes a file and an external_directory request as cards in Auto', async () => {
    const t = setup();
    await t.open(0, 'ses_a');
    const deleting = request('per_del', 'ses_a', 'edit', 'src/a.ts', {
      files: [{ file: 'src/a.ts', status: 'deleted' }],
    });
    t.rest.permissions.push(asRest(deleting));
    t.emit('permission.asked', deleting); // a card while Manual, swept when the pane goes Auto
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    await t.settle();
    t.emit(
      'permission.asked',
      request('per_del2', 'ses_a', 'edit', 'src/b.ts', {
        files: [{ file: 'src/b.ts', status: 'deleted' }],
      }),
    );
    t.emit('permission.asked', request('per_out', 'ses_a', 'external_directory', '/home/x/*'));
    t.emit(
      'permission.asked',
      request('per_mod', 'ses_a', 'edit', 'src/c.ts', {
        files: [{ file: 'src/c.ts', status: 'modified' }],
      }),
    );
    await t.settle();
    expect(t.replies.map((r) => r.requestID)).toEqual(['per_mod']);
    const ids = t.attention.flat().map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['per_del', 'per_del2', 'per_out']));
  });

  it('answers the request of a subagent whose chain is complete', async () => {
    const t = setup();
    await t.open(0, 'ses_a');
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    t.emit('permission.asked', request('per_kid', 'ses_kid'));
    await t.settle();
    expect(t.replies.map((r) => r.requestID)).toEqual(['per_kid']);
    expect(t.types(0)).not.toContain('permission.asked');
  });

  it('keeps the card of a request with an incomplete chain until the walk completes it, then sweeps it', async () => {
    const t = setup();
    await t.open(0, 'ses_a');
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    t.rest.permissions.push(asRest(request('per_o', 'ses_orphan')));
    t.emit('permission.asked', request('per_o', 'ses_orphan'));
    // ses_orphan -> ses_mid (the list does not return it) -> ses_a: incomplete, so a card for now
    expect(t.replies).toEqual([]);
    await t.settle();
    await t.settle();
    expect(t.replies.map((r) => r.requestID)).toEqual(['per_o']);
  });

  it('sweeps the cards already on screen when the pane goes Auto, except .env', async () => {
    const t = setup();
    await t.open(0, 'ses_a');
    for (const [id, resource] of [
      ['per_1', 'src/a.ts'],
      ['per_2', '.env'],
    ] as const) {
      const raw = request(id, 'ses_a', id === 'per_2' ? 'read' : 'edit', resource);
      t.rest.permissions.push(asRest(raw));
      t.emit('permission.asked', raw);
    }
    expect(t.replies).toEqual([]);
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    await t.settle();
    expect(t.replies.map((r) => r.requestID)).toEqual(['per_1']);
  });

  it('keeps the request out of the snapshot of a resync while its answer is in flight', async () => {
    const t = setup(['hang']);
    await t.open(0, 'ses_a');
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    t.rest.permissions.push(asRest(request('per_1', 'ses_a')));
    t.emit('permission.asked', request('per_1', 'ses_a'));
    await t.settle();
    await t.controller.resync();
    const snapshots = (t.panes[0]?.posted ?? []).flatMap((m) =>
      m.type === 'snapshot' ? [m.snapshot] : [],
    );
    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) expect(snapshot.requests.permissions).toEqual([]);
    expect(t.replies).toHaveLength(1); // the resync did not answer a second time
    for (const release of t.releaseHung) release();
  });

  it('retries twice and then shows the normal card with a warning', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const t = setup(['fail']);
    await t.open(0, 'ses_a');
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    t.emit('permission.asked', request('per_1', 'ses_a'));
    await t.settle();
    expect(t.replies).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.replies).toHaveLength(2);
    expect(t.types(0)).not.toContain('permission.asked');
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.replies).toHaveLength(3);
    await t.settle();
    expect(t.types(0)).toContain('permission.asked');
    expect(t.attention.flat().some((s) => s.id === 'per_1')).toBe(true);
    const notice = t.panes[0]?.posted.find((m) => m.type === 'notice');
    expect(notice).toMatchObject({ level: 'warning', error: { code: 'AutoApproveFailed' } });
    expect(t.logs.some((l) => l.startsWith('warn: permission auto-approve failed per_1: '))).toBe(
      true,
    );
  });

  it('shows no card when the server says the request is gone', async () => {
    const t = setup(['gone']);
    await t.open(0, 'ses_a');
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    t.emit('permission.asked', request('per_1', 'ses_a'));
    await t.settle();
    await t.settle();
    expect(t.replies).toHaveLength(1);
    expect(t.types(0)).not.toContain('permission.asked');
    expect(t.logs).toContain('info: permission auto-approve skipped per_1: gone');
  });

  it('answers a duplicate announcement of the same request only once', async () => {
    const t = setup(['hang']);
    await t.open(0, 'ses_a');
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    t.emit('permission.asked', request('per_1', 'ses_a'));
    t.emit('permission.asked', request('per_1', 'ses_a'));
    await t.settle();
    expect(t.replies).toHaveLength(1);
    for (const release of t.releaseHung) release();
  });
});

describe('the mode follows the session', () => {
  it('sends the same state to two panes on one session and a new document gets it on ready', async () => {
    const t = setup();
    await t.open(0, 'ses_a');
    // `session.open` would reveal pane 0 instead; `openInPane` is how a second tab shows it too.
    await t.controller.openInPane(t.panes[1]?.pane.id ?? -1, 'ses_a');
    for (const { posted } of t.panes) posted.length = 0;
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    expect(t.modes(0)).toEqual(['auto']);
    expect(t.modes(1)).toEqual(['auto']);
    t.panes[1]?.posted.splice(0);
    await t.send(1, { type: 'ready' });
    expect(t.modes(1)).toEqual(['auto']);
    expect(t.logs).toContain('info: work mode auto for ses_a');
  });

  it('shows Manual for another session and forgets the mode of a removed one', async () => {
    const t = setup();
    await t.open(0, 'ses_a');
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    await t.send(0, { type: 'session.open', requestId: 'o2', sessionID: 'ses_b' });
    expect(t.modes(0).at(-1)).toBe('manual');
    await t.send(0, { type: 'session.open', requestId: 'o3', sessionID: 'ses_a' });
    expect(t.modes(0).at(-1)).toBe('auto');
    t.emit('session.deleted', { sessionID: 'ses_a' });
    await t.send(0, { type: 'session.open', requestId: 'o4', sessionID: 'ses_a' });
    expect(t.modes(0).at(-1)).toBe('manual');
  });

  it('gives the mode chosen before the first prompt to the session that prompt creates', async () => {
    const t = setup();
    await t.send(0, { type: 'session.new', requestId: 'n1' });
    t.panes[0]?.posted.splice(0);
    await t.send(0, { type: 'workMode.set', mode: 'auto' });
    expect(t.logs).toContain(
      'info: work mode auto for draft of pane ' + String(t.panes[0]?.pane.id),
    );
    expect(t.modes(0)).toEqual(['auto']);
    await t.send(0, {
      type: 'prompt.send',
      requestId: 'p1',
      text: 'hi',
      delivery: 'queue',
      files: [],
    });
    expect(t.logs).toContain('info: work mode auto for ses_new1');
    expect(t.modes(0).at(-1)).toBe('auto');
  });

  it('toggles between Manual and Auto for the command', async () => {
    const t = setup();
    await t.open(0, 'ses_a');
    t.controller.toggleWorkMode(t.panes[0]?.pane.id ?? -1);
    expect(t.modes(0)).toEqual(['auto']);
    t.controller.toggleWorkMode(t.panes[0]?.pane.id ?? -1);
    expect(t.modes(0)).toEqual(['auto', 'manual']);
    t.controller.toggleWorkMode(9999); // unknown pane: ignored
  });
});
