// Protects the host side of the queue of prompts (E2-chat-panel-tabs, issue #188): what the
// controller publishes about the inbox of the session a pane shows (`session.inbox`, the `inbox` of
// the snapshot), the revalidation of `inbox.cancel` and `inbox.steer` (only an id the host listed
// for that session reaches the server), and the rule "the snapshot is a photo" for the queue: an
// inbox event that arrives between the REST read and the publication wins, in BOTH directions
// (`opencode-api` §4, lesson `snapshot-pisa-stream`).
//
// Provenance: a small FABRICATED client (hand-made rows and inbox items, cast to `ChatApi`) and a
// hand-fed stream, like `chatController.subagents.test.ts`. Nothing here talks to a real opencode:
// it proves the routing, the revalidation and the reconciliation, not that a real server emits
// these events in this order or answers `inbox.update` with `ConflictError` for a delivered item
// (UNVERIFIED: the opt-in case "lists and cancels an inbox item, pins and removes an instruction
// and exports a session" of `realOpencode.test.ts` covers one queued item, not the order of the
// events with several queued nor a `ConflictError` of `update` on a delivered one). Against
// the synthetic server, the cases "queues a prompt sent during a SLOW turn and delivers it after
// the turn", "cancels a queued prompt" and "steers a prompt into the running turn" of
// `test/integration/fakeServer.test.ts` drive the same host code end to end.
//
// Phase 2 of the same issue adds the pinned instructions (`instructions.add|remove`, the
// `session.instructions` message, `open.instructions` of the snapshot and its epoch guard) and the
// export (`session.export`, the dialog being a fabricated `saveExport`). Same provenance: a
// fabricated client whose `experimental.session` routes answer what the types of
// `@opencode/client@2.2.7` say; whether a real server does is the job of the opt-in case "lists and
// cancels an inbox item, pins and removes an instruction and exports a session" of
// `realOpencode.test.ts` (it passed against an opencode 2.2.5 executable on 12/11/2026, not yet
// against the pinned 2.2.7).
import type {
  InstructionEntryInfo,
  SessionInboxInfo,
  SessionInfo,
  SessionTransferData,
  V2Event,
} from '@opencode/client';
import { describe, expect, it } from 'vitest';
import type { HostToWebview, WebviewToHost } from '../shared/protocol';
import { ChatController, type ChatControllerDeps } from './chatController';
import type { EventStreamOptions } from './eventStream';
import type { ChatApi } from './opencodeClient';
import type { ExportFile } from './sessionTranscript';
import { noSetup } from './test-fixtures/noSetup';

const SERVER = {
  url: 'http://127.0.0.1:43211',
  password: 'pw-secret-1',
  version: '2.2.7',
  folder: 'C:\\work',
  binaryPath: 'opencode.exe',
  pid: 1,
  source: 'spawned' as const,
};
const wire = <T>(json: string): T => JSON.parse(json) as T;
const LOCATION = wire<{ directory: string }>('{"directory":"C:\\\\work"}');

/** A `user` item (or another `type`) as `session.inbox.list` returns it. */
const restItem = (
  id: string,
  text: string,
  delivery: 'steer' | 'queue' = 'queue',
  type = 'user',
): SessionInboxInfo =>
  wire<SessionInboxInfo>(
    JSON.stringify({
      id,
      sessionID: 'ses_a',
      time: { created: 1 },
      type,
      payload: type === 'user' ? { text } : {},
      delivery,
    }),
  );

interface Options {
  /** What `inbox.list` answers for `ses_a` (a copy is taken when the call is made). */
  inbox?: SessionInboxInfo[];
  /** Makes `inbox.list` reject with this server error body. */
  listError?: object;
  /** Makes `inbox.cancel` reject with this server error body. */
  cancelError?: object;
  /** Makes `inbox.update` reject with this server error body. */
  updateError?: object;
  /** The instructions the server holds for any session; `put` and `remove` change this array. */
  instructions?: InstructionEntryInfo[];
  /** Makes `instructions.entry.list` reject with this server error body. */
  instructionsListError?: object;
  /** Makes `instructions.entry.put` reject with this server error body. */
  putError?: object;
  /** What `session.export` answers. */
  exported?: SessionTransferData;
  /** The save dialog; absent leaves `deps.saveExport` out of the dependencies. */
  saveExport?: (file: ExportFile) => Promise<string | undefined>;
}

function setup(options: Options = {}) {
  const row = (id: string): SessionInfo =>
    wire<SessionInfo>(
      JSON.stringify({
        id,
        projectID: 'p',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 2 },
        location: { directory: 'C:\\work' },
      }),
    );
  const cancels: unknown[] = [];
  const updates: unknown[] = [];
  const puts: Array<{ sessionID: string; key: string; value: unknown }> = [];
  const removes: Array<{ sessionID: string; key: string }> = [];
  const exports: unknown[] = [];
  const instructionList = [...(options.instructions ?? [])];
  /** While set, `instructions.entry.list` answers only after it resolves; the photo is taken at call time. */
  let instructionGate: Promise<void> | undefined;
  /** While set, `inbox.list` answers only after it resolves (the "REST read is slow" of the race). */
  let gate: Promise<void> | undefined;
  const reject = (body: object): Promise<never> =>
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    Promise.reject(body);
  const api = {
    event: {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      }),
    },
    session: {
      list: () => Promise.resolve({ data: ['ses_a', 'ses_b'].map(row), cursor: {} }),
      active: () => Promise.resolve({}),
      get: ({ sessionID }: { sessionID: string }) => Promise.resolve(row(sessionID)),
      diff: () => Promise.resolve([]),
      inbox: {
        list: async () => {
          const photo = [...(options.inbox ?? [])]; // the photo is taken when REST is READ
          if (gate !== undefined) await gate;
          if (options.listError !== undefined) return reject(options.listError);
          return photo;
        },
        cancel: (input: unknown) => {
          cancels.push(input);
          return options.cancelError === undefined
            ? Promise.resolve()
            : reject(options.cancelError);
        },
        update: (input: unknown) => {
          updates.push(input);
          return options.updateError === undefined
            ? Promise.resolve()
            : reject(options.updateError);
        },
      },
    },
    message: { list: () => Promise.resolve({ data: [], cursor: {} }) },
    experimental: {
      session: {
        export: (input: unknown) => {
          exports.push(input);
          return options.exported === undefined
            ? reject({ _tag: 'SessionNotFoundError', message: 'no export' })
            : Promise.resolve(options.exported);
        },
        instructions: {
          entry: {
            list: async () => {
              const photo = instructionList.map((entry) => ({ ...entry }));
              if (instructionGate !== undefined) await instructionGate;
              if (options.instructionsListError !== undefined) {
                return reject(options.instructionsListError);
              }
              return photo;
            },
            put: (input: { sessionID: string; key: string; value: unknown }) => {
              puts.push(input);
              if (options.putError !== undefined) return reject(options.putError);
              instructionList.push({ key: input.key, value: input.value as string });
              return Promise.resolve();
            },
            remove: (input: { sessionID: string; key: string }) => {
              removes.push(input);
              const at = instructionList.findIndex((entry) => entry.key === input.key);
              if (at !== -1) instructionList.splice(at, 1);
              return Promise.resolve();
            },
          },
        },
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
    ...(options.saveExport === undefined ? {} : { saveExport: options.saveExport }),
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
  const enqueue = (inboxID: string, text: string, delivery: 'steer' | 'queue' = 'queue'): void =>
    emit('session.inbox.enqueued', {
      sessionID: 'ses_a',
      inboxID,
      item: { type: 'user', payload: { text }, delivery },
    });
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  const send = async (index: number, message: WebviewToHost): Promise<void> => {
    await controller.handle(panes[index]?.id ?? -1, message);
  };
  /** Opens `ses_a` in pane 0 and `ses_b` in pane 1, so the tests can see who gets what. */
  const openBoth = async (): Promise<void> => {
    await settle();
    await send(0, { type: 'session.open', requestId: 'o1', sessionID: 'ses_a' });
    await send(1, { type: 'session.open', requestId: 'o2', sessionID: 'ses_b' });
    await settle();
  };
  /** Holds `inbox.list` until `release()`; the photo of the read is taken at call time. */
  const holdInbox = (): (() => void) => {
    let release = (): void => undefined;
    gate = new Promise<void>((resolve) => {
      release = () => {
        gate = undefined;
        resolve();
      };
    });
    return release;
  };
  /** Holds `instructions.entry.list` until `release()`; the photo of the read is taken at call time. */
  const holdInstructions = (): (() => void) => {
    let release = (): void => undefined;
    instructionGate = new Promise<void>((resolve) => {
      release = () => {
        instructionGate = undefined;
        resolve();
      };
    });
    return release;
  };
  return {
    controller,
    posts,
    emit,
    enqueue,
    settle,
    send,
    openBoth,
    holdInbox,
    holdInstructions,
    cancels,
    updates,
    puts,
    removes,
    exports,
    instructionList,
  };
}

/** The `inbox` of the newest snapshot a pane received. */
const snapshotInbox = (posts: HostToWebview[]) => {
  const snapshot = [...posts].reverse().find((m) => m.type === 'snapshot');
  return snapshot?.type === 'snapshot' ? snapshot.snapshot.open?.inbox : undefined;
};

/** The `session.inbox` messages of a pane's posts. */
const inboxMessages = (posts: HostToWebview[]) =>
  posts.flatMap((m) => (m.type === 'session.inbox' ? [m] : []));

/** The `request.result` posted for `requestId`. */
const resultOf = (posts: HostToWebview[], requestId: string) =>
  posts.find((m) => m.type === 'request.result' && m.requestId === requestId);

describe('the queue of prompts in the controller', () => {
  /**
   * Protects the routing: an inbox event of `ses_a` reaches the pane showing it and no other, and
   * what arrives is the whole list.
   */
  it('publishes the queue only to the panes showing the session', async () => {
    const t = setup();
    await t.openBoth();
    t.enqueue('msg_1', 'first');
    t.enqueue('msg_2', 'second', 'steer');
    expect(inboxMessages(t.posts[0] ?? []).at(-1)).toMatchObject({
      sessionID: 'ses_a',
      items: [
        { id: 'msg_1', text: 'first', delivery: 'queue' },
        { id: 'msg_2', text: 'second', delivery: 'steer' },
      ],
    });
    expect(inboxMessages(t.posts[1] ?? [])).toEqual([]);
  });

  /** Protects `open.inbox`: only `user` items of REST, in order; the other kinds never become chips. */
  it('puts the user items REST listed in the snapshot of the open session', async () => {
    const t = setup({
      inbox: [
        restItem('msg_r', 'from REST', 'steer'),
        restItem('msg_c', '', 'queue', 'compaction'),
      ],
    });
    await t.openBoth();
    expect(snapshotInbox(t.posts[0] ?? [])).toEqual([
      { id: 'msg_r', text: 'from REST', delivery: 'steer', files: 0 },
    ]);
  });

  /**
   * Protects the failure rule: a failing `inbox.list` (an older server without the route, say) is
   * cosmetic. The snapshot still goes out, and carries the queue the stream built.
   */
  it('keeps the queue the stream built when the inbox cannot be read', async () => {
    const t = setup({ listError: { _tag: 'UnexpectedStatus', message: 'no such route' } });
    await t.openBoth();
    t.enqueue('msg_1', 'first');
    await t.controller.resync();
    expect(snapshotInbox(t.posts[0] ?? [])).toEqual([
      { id: 'msg_1', text: 'first', delivery: 'queue', files: 0 },
    ]);
    expect((t.posts[0] ?? []).some((m) => m.type === 'notice')).toBe(false);
  });

  /**
   * Protects R2 of the plan (lesson `snapshot-pisa-stream`), direction "appears": the user typed a
   * prompt while the snapshot was being read. REST (a photo taken before) does not list it; the
   * stream did say so, and the snapshot must keep it or the chip would vanish until the next event.
   */
  it('keeps in the snapshot a prompt enqueued during the read', async () => {
    const t = setup({ inbox: [restItem('msg_old', 'old')] });
    await t.openBoth();
    const release = t.holdInbox();
    const done = t.controller.resync();
    await t.settle(); // the read has started and holds its photo
    t.enqueue('msg_new', 'typed during the read');
    release();
    await done;
    expect(snapshotInbox(t.posts[0] ?? [])?.map((item) => item.id)).toEqual(['msg_old', 'msg_new']);
  });

  /**
   * Protects R2, direction "disappears": the turn delivered a prompt while the snapshot was being
   * read. REST (the older photo) still lists it; publishing that would show a chip for a prompt
   * that is already in the conversation, and nothing would ever remove it.
   */
  it('leaves out of the snapshot a prompt delivered during the read', async () => {
    const t = setup({ inbox: [restItem('msg_1', 'first'), restItem('msg_2', 'second')] });
    await t.openBoth();
    const release = t.holdInbox();
    const done = t.controller.resync();
    await t.settle();
    t.emit('session.inbox.delivered', { sessionID: 'ses_a', inboxID: 'msg_1' });
    t.emit('session.inbox.cancelled', { sessionID: 'ses_a', inboxID: 'msg_2' });
    release();
    await done;
    expect(snapshotInbox(t.posts[0] ?? [])).toEqual([]);
  });

  /** Protects `inbox.cancel`: the server is called with the ids, and the request succeeds. */
  it('cancels a queued prompt', async () => {
    const t = setup();
    await t.openBoth();
    t.enqueue('msg_1', 'first');
    await t.send(0, {
      type: 'inbox.cancel',
      requestId: 'c1',
      sessionID: 'ses_a',
      inboxID: 'msg_1',
    });
    expect(t.cancels).toEqual([{ sessionID: 'ses_a', inboxID: 'msg_1' }]);
    expect(resultOf(t.posts[0] ?? [], 'c1')).toEqual({ type: 'request.result', requestId: 'c1' });
  });

  /** Protects `inbox.steer`: `update` with `steer`, and no call at all for an item already steering. */
  it('steers a queued prompt', async () => {
    const t = setup();
    await t.openBoth();
    t.enqueue('msg_1', 'first');
    t.enqueue('msg_2', 'second', 'steer');
    await t.send(0, { type: 'inbox.steer', requestId: 's1', sessionID: 'ses_a', inboxID: 'msg_1' });
    await t.send(0, { type: 'inbox.steer', requestId: 's2', sessionID: 'ses_a', inboxID: 'msg_2' });
    expect(t.updates).toEqual([{ sessionID: 'ses_a', inboxID: 'msg_1', delivery: 'steer' }]);
    expect(resultOf(t.posts[0] ?? [], 's1')).toEqual({ type: 'request.result', requestId: 's1' });
    expect(resultOf(t.posts[0] ?? [], 's2')).toEqual({ type: 'request.result', requestId: 's2' });
  });

  /**
   * Protects the revalidation (the webview is untrusted): an id the host never listed, one already
   * gone, and one that is listed for ANOTHER session all answer `NotQueued` and call nothing.
   */
  it('refuses an id it did not list', async () => {
    const t = setup();
    await t.openBoth();
    t.enqueue('msg_1', 'first');
    await t.send(0, {
      type: 'inbox.cancel',
      requestId: 'r1',
      sessionID: 'ses_a',
      inboxID: 'msg_x',
    });
    await t.send(0, { type: 'inbox.steer', requestId: 'r2', sessionID: 'ses_b', inboxID: 'msg_1' });
    t.emit('session.inbox.cancelled', { sessionID: 'ses_a', inboxID: 'msg_1' });
    await t.send(0, {
      type: 'inbox.cancel',
      requestId: 'r3',
      sessionID: 'ses_a',
      inboxID: 'msg_1',
    });
    expect(t.cancels).toEqual([]);
    expect(t.updates).toEqual([]);
    for (const id of ['r1', 'r2', 'r3']) {
      expect(resultOf(t.posts[0] ?? [], id)).toMatchObject({ error: { code: 'NotQueued' } });
    }
  });

  /**
   * Protects the benign race: `update` on a prompt the turn delivered meanwhile throws
   * `ConflictError`. That is not the user's error; the request succeeds and the pane is resynced
   * (a new snapshot) so it shows the truth. Another failure still reaches the user.
   * SYNTHETIC: the fabricated client throws the bodies.
   */
  it('treats a conflict on steer as benign and resyncs', async () => {
    const t = setup({ updateError: { _tag: 'ConflictError', message: 'not pending' } });
    await t.openBoth();
    t.enqueue('msg_1', 'first');
    const snapshotsBefore = (t.posts[0] ?? []).filter((m) => m.type === 'snapshot').length;
    await t.send(0, { type: 'inbox.steer', requestId: 's1', sessionID: 'ses_a', inboxID: 'msg_1' });
    expect(resultOf(t.posts[0] ?? [], 's1')).toEqual({ type: 'request.result', requestId: 's1' });
    expect((t.posts[0] ?? []).filter((m) => m.type === 'snapshot').length).toBe(
      snapshotsBefore + 1,
    );

    const failing = setup({ cancelError: { _tag: 'UnauthorizedError', message: 'no' } });
    await failing.openBoth();
    failing.enqueue('msg_1', 'first');
    await failing.send(0, {
      type: 'inbox.cancel',
      requestId: 'c1',
      sessionID: 'ses_a',
      inboxID: 'msg_1',
    });
    expect(resultOf(failing.posts[0] ?? [], 'c1')).toMatchObject({
      error: { code: 'UnauthorizedError' },
    });
  });
});

/** A small export of `ses_a`: a title, one user message, one assistant message with a tool. */
const EXPORTED = wire<SessionTransferData>(
  JSON.stringify({
    info: {
      id: 'ses_a',
      title: 'Fix the login',
      projectID: 'p',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 1000 },
      location: { directory: 'C:\\work' },
    },
    messages: [
      { id: 'msg_1', type: 'user', time: { created: 1 }, text: 'please fix the login' },
      {
        id: 'msg_2',
        type: 'assistant',
        time: { created: 2 },
        agent: 'build',
        model: { id: 'm', providerID: 'p' },
        content: [
          { type: 'text', text: 'Done.' },
          {
            type: 'tool',
            id: 't1',
            name: 'edit',
            time: { created: 2 },
            state: { status: 'completed', input: { filePath: 'src/login.ts' }, content: [] },
          },
        ],
      },
    ],
  }),
);

/** The `session.instructions` messages of a pane's posts. */
const instructionMessages = (posts: HostToWebview[]) =>
  posts.flatMap((m) => (m.type === 'session.instructions' ? [m] : []));

/** The `instructions` of the newest snapshot a pane received. */
const snapshotInstructions = (posts: HostToWebview[]) => {
  const snapshot = [...posts].reverse().find((m) => m.type === 'snapshot');
  return snapshot?.type === 'snapshot' ? snapshot.snapshot.open?.instructions : undefined;
};

// Protects the pinned instructions in the host (issue #188): the add generates its own key and
// stores the trimmed text as a string, the list is posted before the request unlocks, a key the
// host did not list is never removed, the 413 and a failed re-read reach the user, a late older
// read cannot replace a newer one, and the snapshot carries the list only when nothing changed it
// during the read. Provenance: FABRICATED client (see the header); no real server was asked.
describe('the pinned instructions in the controller', () => {
  /** Protects `instructions.add`: key shape, trimmed string value, list before result, route. */
  it('pins an instruction and lists it again', async () => {
    const t = setup();
    await t.openBoth();
    await t.send(0, {
      type: 'instructions.add',
      requestId: 'i1',
      sessionID: 'ses_a',
      text: '  Always answer in Spanish  ',
    });
    expect(t.puts).toHaveLength(1);
    expect(t.puts[0]?.sessionID).toBe('ses_a');
    expect(t.puts[0]?.key).toMatch(/^note-[a-z0-9]+$/);
    expect(t.puts[0]?.value).toBe('Always answer in Spanish');
    const key = t.puts[0]?.key ?? '';
    expect(instructionMessages(t.posts[0] ?? []).at(-1)).toEqual({
      type: 'session.instructions',
      sessionID: 'ses_a',
      entries: [{ key, text: 'Always answer in Spanish', json: false }],
    });
    const own = t.posts[0] ?? [];
    expect(own.findIndex((m) => m.type === 'session.instructions')).toBeLessThan(
      own.findIndex((m) => m.type === 'request.result' && m.requestId === 'i1'),
    );
    expect(resultOf(own, 'i1')).toEqual({ type: 'request.result', requestId: 'i1' });
    expect(instructionMessages(t.posts[1] ?? [])).toEqual([]);
  });

  /** Protects the host's own revalidation: a blank text (a hostile webview) never reaches the server. */
  it('refuses a blank instruction without calling the server', async () => {
    const t = setup();
    await t.openBoth();
    await t.send(0, { type: 'instructions.add', requestId: 'i1', sessionID: 'ses_a', text: '   ' });
    expect(t.puts).toEqual([]);
    expect(resultOf(t.posts[0] ?? [], 'i1')).toMatchObject({
      error: { code: 'InvalidInstruction' },
    });
  });

  /** Protects the server's size refusal (413 `InstructionEntryValueTooLargeError`): a clear error, list re-read. */
  it('answers the 413 of the server', async () => {
    const t = setup({
      putError: {
        _tag: 'InstructionEntryValueTooLargeError',
        actualBytes: 300000,
        maxBytes: 262144,
        message: 'too large',
      },
    });
    await t.openBoth();
    await t.send(0, { type: 'instructions.add', requestId: 'i1', sessionID: 'ses_a', text: 'x' });
    expect(resultOf(t.posts[0] ?? [], 'i1')).toMatchObject({
      error: { code: 'InstructionTooLarge' },
    });
    expect(instructionMessages(t.posts[0] ?? []).at(-1)?.entries).toEqual([]);
  });

  /** Protects `instructions.remove` of a listed key, including an entry another client wrote as JSON. */
  it('removes a listed instruction', async () => {
    const t = setup({
      instructions: [
        { key: 'note-a', value: 'keep' },
        { key: 'meta', value: { a: 1 } },
      ],
    });
    await t.openBoth();
    await t.send(0, {
      type: 'instructions.remove',
      requestId: 'd1',
      sessionID: 'ses_a',
      key: 'meta',
    });
    expect(t.removes).toEqual([{ sessionID: 'ses_a', key: 'meta' }]);
    expect(instructionMessages(t.posts[0] ?? []).at(-1)?.entries).toEqual([
      { key: 'note-a', text: 'keep', json: false },
    ]);
    expect(resultOf(t.posts[0] ?? [], 'd1')).toEqual({ type: 'request.result', requestId: 'd1' });
  });

  /** Protects the webview-is-untrusted rule: an unlisted key, or a listed one on a session never listed, calls nothing. */
  it('refuses to remove a key it did not list', async () => {
    const t = setup({ instructions: [{ key: 'note-a', value: 'keep' }] });
    await t.openBoth();
    await t.send(0, {
      type: 'instructions.remove',
      requestId: 'd1',
      sessionID: 'ses_a',
      key: 'note-zzz',
    });
    await t.send(0, {
      type: 'instructions.remove',
      requestId: 'd2',
      sessionID: 'ses_c',
      key: 'note-a',
    });
    expect(t.removes).toEqual([]);
    for (const id of ['d1', 'd2']) {
      expect(resultOf(t.posts[0] ?? [], id)).toMatchObject({ error: { code: 'NotPinned' } });
    }
  });

  /**
   * Protects the failure rule of the re-read: the add worked, the list could not be read, so the
   * view gets the last list it knew WITH the error (not an empty list that would hide the entries),
   * and the request itself still succeeds. The snapshot of a failed read carries no list at all.
   */
  it('keeps the last list and reports the error when the instructions cannot be read', async () => {
    const options: Options = { instructions: [{ key: 'note-a', value: 'keep' }] };
    const t = setup(options);
    await t.openBoth();
    expect(snapshotInstructions(t.posts[0] ?? [])).toEqual([
      { key: 'note-a', text: 'keep', json: false },
    ]);
    options.instructionsListError = { _tag: 'UnexpectedStatus', message: 'no such route' };
    await t.send(0, { type: 'instructions.add', requestId: 'i1', sessionID: 'ses_a', text: 'new' });
    expect(instructionMessages(t.posts[0] ?? []).at(-1)).toMatchObject({
      entries: [{ key: 'note-a', text: 'keep', json: false }],
      error: { code: 'UnexpectedStatus' },
    });
    expect(resultOf(t.posts[0] ?? [], 'i1')).toEqual({ type: 'request.result', requestId: 'i1' });
    await t.controller.resync();
    expect(snapshotInstructions(t.posts[0] ?? [])).toBeUndefined();
  });

  /**
   * Protects the ticket: a read that is overtaken by a newer one (here the server event of another
   * client's change arrives while the add's re-read is still pending) must not post, or its older
   * photo would replace the newer list.
   */
  it('drops the answer of an older read of the instructions', async () => {
    const t = setup();
    await t.openBoth();
    const release = t.holdInstructions();
    const adding = t.send(0, {
      type: 'instructions.add',
      requestId: 'i1',
      sessionID: 'ses_a',
      text: 'first',
    });
    await t.settle(); // the put is done and the first re-read holds a photo with the new note
    t.instructionList.length = 0; // another client removed it; the next read will not see it
    t.emit('session.instructions.updated', { sessionID: 'ses_a', delta: {} });
    await t.settle();
    release();
    await adding;
    const messages = instructionMessages(t.posts[0] ?? []);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.entries).toEqual([]);
  });

  /**
   * Protects review W1 (ticket): two panes show two sessions, and the read that follows an add in
   * A is still pending when a server event of B starts a read of B. The ticket is per session, so
   * A's read still posts (a global ticket dropped it: no row for the new note and a ✕ that answered
   * `NotPinned`). The fake keeps one list for every session, which is enough to see who posts.
   */
  it('does not drop the read of a session because another session started a read', async () => {
    const t = setup();
    await t.openBoth();
    const release = t.holdInstructions();
    const adding = t.send(0, {
      type: 'instructions.add',
      requestId: 'i1',
      sessionID: 'ses_a',
      text: 'rule of A',
    });
    await t.settle(); // the put is done and A's re-read holds its photo
    t.emit('session.instructions.updated', { sessionID: 'ses_b', delta: {} });
    await t.settle(); // B's read is held too
    release();
    await adding;
    await t.settle();
    expect(instructionMessages(t.posts[0] ?? []).at(-1)).toMatchObject({
      sessionID: 'ses_a',
      entries: [{ text: 'rule of A' }],
    });
    expect(instructionMessages(t.posts[1] ?? []).at(-1)).toMatchObject({ sessionID: 'ses_b' });
    const key = t.puts[0]?.key ?? '';
    await t.send(0, { type: 'instructions.remove', requestId: 'd1', sessionID: 'ses_a', key });
    expect(resultOf(t.posts[0] ?? [], 'd1')).toEqual({ type: 'request.result', requestId: 'd1' });
  });

  /**
   * Protects review W1 (epoch): a snapshot that opens A is being read when a server event changes
   * the instructions of B. Only B's epoch moves, so A's snapshot keeps the list it read (a global
   * epoch dropped it and the newly opened A showed no instructions and none in the ledger).
   */
  it('keeps the instructions of a snapshot when another session changed meanwhile', async () => {
    const t = setup({ instructions: [{ key: 'note-a', value: 'keep' }] });
    await t.openBoth();
    const release = t.holdInstructions();
    const done = t.controller.resync();
    await t.settle(); // the snapshot's read holds its photo
    t.emit('session.instructions.updated', { sessionID: 'ses_b', delta: {} });
    await t.settle();
    release();
    await done;
    await t.settle();
    expect(snapshotInstructions(t.posts[0] ?? [])).toEqual([
      { key: 'note-a', text: 'keep', json: false },
    ]);
  });

  /** Protects `open.instructions`: REST's list as views, a non-string value shown as JSON. */
  it('puts the instructions in the snapshot', async () => {
    const t = setup({
      instructions: [
        { key: 'note-a', value: 'hello' },
        { key: 'meta', value: { a: 1 } },
      ],
    });
    await t.openBoth();
    expect(snapshotInstructions(t.posts[0] ?? [])).toEqual([
      { key: 'note-a', text: 'hello', json: false },
      { key: 'meta', text: '{\n  "a": 1\n}', json: true },
    ]);
  });

  /**
   * Protects R2 for the instructions: an add lands while the snapshot is being read, so the
   * snapshot's photo (taken before the put) is stale. It must carry no list; the add's own
   * `session.instructions` is the truth, and the webview keeps what it holds.
   */
  it('leaves the instructions out of a snapshot whose read an add overtook', async () => {
    const t = setup();
    await t.openBoth();
    const release = t.holdInstructions();
    const done = t.controller.resync();
    await t.settle(); // the snapshot's read holds its (empty) photo
    const adding = t.send(0, {
      type: 'instructions.add',
      requestId: 'i1',
      sessionID: 'ses_a',
      text: 'late rule',
    });
    await t.settle();
    release();
    await Promise.all([done, adding]);
    expect(snapshotInstructions(t.posts[0] ?? [])).toBeUndefined();
    expect(instructionMessages(t.posts[0] ?? []).at(-1)?.entries).toMatchObject([
      { text: 'late rule' },
    ]);
  });

  /** Protects the live update from another client: the event makes the host read the list again, for the panes showing it only. */
  it('reads the instructions again when the server says they changed', async () => {
    const t = setup({ instructions: [{ key: 'note-a', value: 'keep' }] });
    await t.openBoth();
    t.instructionList.push({ key: 'note-b', value: 'from the TUI' });
    t.emit('session.instructions.updated', { sessionID: 'ses_a', delta: { 'note-b': 'h' } });
    await t.settle();
    expect(
      instructionMessages(t.posts[0] ?? [])
        .at(-1)
        ?.entries.map((e) => e.key),
    ).toEqual(['note-a', 'note-b']);
    expect(instructionMessages(t.posts[1] ?? [])).toEqual([]);
  });
});

// Protects `session.export` (issue #188, decision P1 of Sergio): Markdown is built by the host,
// JSON is the server's COMPLETE export asked with `sanitize: false`, the dialog is a dependency,
// cancelling it is silent, and without a dialog the request says so. Provenance: FABRICATED export
// and dialog; what a real server exports was never read by a test (opt-in case still to run).
describe('the export of a session in the controller', () => {
  /** Protects the Markdown path: name, content from the transcript module, folder, notice with the name only. */
  it('exports the Markdown transcript through the save dialog', async () => {
    const files: ExportFile[] = [];
    const t = setup({
      exported: EXPORTED,
      saveExport: (file) => {
        files.push(file);
        return Promise.resolve(file.suggestedName);
      },
    });
    await t.openBoth();
    await t.send(0, {
      type: 'session.export',
      requestId: 'x1',
      sessionID: 'ses_a',
      format: 'markdown',
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.suggestedName).toBe('session-ses_a.md');
    expect(files[0]?.folder).toBe('C:\\work');
    expect(files[0]?.content.startsWith('# Fix the login\n')).toBe(true);
    expect(files[0]?.content).toContain('## User\n\nplease fix the login');
    expect(files[0]?.content).toContain('- edit: src/login.ts (completed)');
    expect(files[0]?.content).not.toContain('\r');
    const notice = (t.posts[0] ?? []).find((m) => m.type === 'notice');
    expect(notice).toMatchObject({ level: 'info', error: { code: 'SessionExported' } });
    expect(notice?.type === 'notice' ? notice.error.message : '').toContain('session-ses_a.md');
    expect(resultOf(t.posts[0] ?? [], 'x1')).toEqual({ type: 'request.result', requestId: 'x1' });
  });

  /** Protects P1: the JSON is the whole export (no redaction), pretty-printed with a final newline. */
  it('exports the complete JSON without sanitising', async () => {
    const files: ExportFile[] = [];
    const t = setup({
      exported: EXPORTED,
      saveExport: (file) => {
        files.push(file);
        return Promise.resolve(file.suggestedName);
      },
    });
    await t.openBoth();
    await t.send(0, {
      type: 'session.export',
      requestId: 'x1',
      sessionID: 'ses_a',
      format: 'json',
    });
    expect(t.exports).toEqual([{ sessionID: 'ses_a', sanitize: false }]);
    expect(files[0]?.suggestedName).toBe('session-ses_a.json');
    expect(files[0]?.content).toBe(`${JSON.stringify(EXPORTED, null, 2)}\n`);
  });

  /** Protects the silent cancel: no notice, and the request still succeeds so the button unlocks. */
  it('says nothing when the dialog is cancelled', async () => {
    const t = setup({ exported: EXPORTED, saveExport: () => Promise.resolve(undefined) });
    await t.openBoth();
    await t.send(0, {
      type: 'session.export',
      requestId: 'x1',
      sessionID: 'ses_a',
      format: 'markdown',
    });
    expect((t.posts[0] ?? []).some((m) => m.type === 'notice')).toBe(false);
    expect(resultOf(t.posts[0] ?? [], 'x1')).toEqual({ type: 'request.result', requestId: 'x1' });
  });

  /** Protects the absent dependency: the request fails with a code and never asks the server. */
  it('answers ExportUnavailable without a dialog', async () => {
    const t = setup({ exported: EXPORTED });
    await t.openBoth();
    await t.send(0, {
      type: 'session.export',
      requestId: 'x1',
      sessionID: 'ses_a',
      format: 'markdown',
    });
    expect(t.exports).toEqual([]);
    expect(resultOf(t.posts[0] ?? [], 'x1')).toMatchObject({
      error: { code: 'ExportUnavailable' },
    });
  });
});
