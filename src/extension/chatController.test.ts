// Protects against the controller's coordination rules breaking: a webview that gets no state
// after `ready`, a prompt that fails silently, a stale snapshot overwriting a newer one, a
// forgotten-session loop, the stream surviving a server stop, and any error text leaking the
// server URL or password to the webview (architecture rule 1). Phase 2 adds: an abort that does
// not use `resume` and heals a stale "busy" with a resync, editor failures that become notices
// instead of unhandled rejections, and attachments restricted to what the picker emitted (the
// webview is untrusted and the server would read any `file://`).
//
// Phase 3 adds: permission replies (the `requestID`, and a `message` only for a non-blank reject),
// form replies and cancels with the exact arguments, a stale request (already answered by someone
// else) that resyncs while an invalid answer does not, the snapshot's `requests` read from the
// LOCATION lists (not from the open session), requests of other sessions reaching both the webview
// and the attention feature, the cure for an interrupt that deletes a pending permission without
// an event, the saved-permissions manager, `focusRequest`, the restart/log commands, the
// reconnecting banner during a scheduled restart, the session remembered per folder, and that the
// log never carries the resources of a permission nor the text of an answer.
//
// E4-session-management (issue #20), at the end of the file: the paged session list (first page
// input, cursor-only "more", the cursor never reaching the webview, `hasMore` from the page size),
// rename (trim, a blank title never reaches the server), delete (the user is asked first, with the
// title and running flag read from the server), the open session being deleted (forgotten with its
// memory, a notice only when the delete was not ours, its pending requests dropped) and the lazy
// "New session".
//
// Provenance of the data: a FAKE `ChatApi` with hand-made JSON shaped like the REST answers a
// real opencode 2.0.32 gave the planner (2026-10-20, Windows 11); the permission and form shapes
// come from the TYPES only. These tests confirm the controller's logic, not the contract with the
// server; the wiring with the real client over HTTP is covered by `chatController.e2e.test.ts`
// against a synthetic server.
import type {
  AgentInfo,
  FormInfo,
  FormListOutput,
  ModelInfo,
  PermissionRequest,
  PermissionSavedInfo,
  ProviderInfo,
  SessionInfo,
  SessionListInput,
  SessionMessageInfo,
  SessionsResponse,
  V2Event,
} from '@opencode/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelRef } from '../shared/model';
import type { HostToWebview, Snapshot, WebviewToHost } from '../shared/protocol';
import type { AttachmentRef } from '../shared/protocol';
import {
  ChatController,
  FOCUS_REQUEST_TTL_MS,
  type ChatControllerDeps,
  type EditorActions,
  type SavedPermission,
} from './chatController';
import type { EventStreamOptions } from './eventStream';
import type { ChatApi } from './opencodeClient';
import type { PendingSummary } from './pendingRequests';
import type { ServerState } from './serverManager';

const SERVER = {
  url: 'http://127.0.0.1:43211',
  password: 'pw-secret-1',
  version: '2.0.32',
  folder: 'C:\\work',
  binaryPath: 'opencode.exe',
  pid: 1,
};
const RUNNING: ServerState = { kind: 'running', server: SERVER };

const wire = <T>(json: string): T => JSON.parse(json) as T;

/** A minimal REST session with the given id, in the shape of a real `session.list` row. */
const sessionInfo = (id: string): SessionInfo =>
  wire<SessionInfo>(
    `{"id":"${id}","projectID":"p","cost":0,"tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"time":{"created":1,"updated":2},"location":{"directory":"C:\\\\work"}}`,
  );

type FakeOptions = Partial<{
  sessions: string[];
  messages: SessionMessageInfo[];
  listImpl: (input?: SessionListInput) => Promise<SessionsResponse>;
  /** Titles `session.get` answers with, by session id (the default row has none). */
  titles: Record<string, string>;
  /** Rejects `session.get` / `session.update` / `session.remove` with this server error body. */
  getError: object;
  updateError: object;
  sessionRemoveError: object;
  /** Replaces `session.remove`; a test uses it to publish the event BEFORE the answer, as the server does. */
  removeImpl: (input: { sessionID: string }) => Promise<void>;
  /** Rows `session.list({ parentID })` answers with (issue #21). */
  children: SessionInfo[];
  /** Rejects the children read of the lineage (`session.list({ parentID })`) with this body. */
  childrenError: object;
  /** Replaces `session.get` entirely (issue #21: rows with `parentID` / `fork`, or failures). */
  getImpl: (sessionID: string) => Promise<SessionInfo>;
  /** Replaces `session.fork` (issue #21). */
  forkImpl: (input: { sessionID: string; before?: string }) => Promise<SessionInfo>;
  messageListImpl: () => Promise<{ data: SessionMessageInfo[]; cursor: object }>;
  promptImpl: () => Promise<unknown>;
  active: Record<string, { type: 'running' }>;
  interruptImpl: () => Promise<{ interrupted: boolean }>;
  permissions: PermissionRequest[];
  forms: FormInfo[];
  saved: PermissionSavedInfo[];
  /** Rejects the next permission/form reply or cancel with this server error body. */
  replyError: object;
  removeError: object;
  /** Models `model.list` answers with (default: {@link DEFAULT_MODELS}); `model.default` is the first. */
  models: ModelInfo[];
  /** Replaces what `model.default` answers with; `null` is the server's "no model". */
  defaultModelInfo: ModelInfo | null;
  /** Agents `agent.list` answers with (default: {@link DEFAULT_AGENTS}). */
  agents: AgentInfo[];
  /** Rejects `model.list` (the catalog load) with this server error body. */
  catalogError: object;
  /** `agent` / `model` fields `session.get` adds to every row (issues #23/#24). */
  sessionSelection: {
    agent?: string;
    model?: { id: string; providerID: string; variant?: string };
  };
  /** Rejects `switchAgent` / `switchModel` with this server error body. */
  switchError: object;
}>;

/** A catalog model in the shape of a real `ModelInfo` (fields trimmed to what the mapping reads). */
const modelInfo = (id: string, name: string, cost = 0): ModelInfo =>
  wire<ModelInfo>(
    JSON.stringify({
      id,
      modelID: id,
      providerID: 'opencode',
      name,
      capabilities: { tools: true, input: [], output: [] },
      variants: [{ id: 'low' }, { id: 'high' }],
      time: { released: 1 },
      cost: [{ input: cost, output: cost, cache: { read: 0, write: 0 } }],
      status: 'active',
      enabled: true,
      limit: { context: 200000, output: 32000 },
    }),
  );

/** Two free models; the first is the server default. */
const DEFAULT_MODELS: ModelInfo[] = [
  modelInfo('big-pickle', 'Big Pickle'),
  modelInfo('glm-5.3-flash-free', 'GLM-5.3-Flash Free'),
];

const PROVIDER = wire<ProviderInfo>(
  '{"id":"opencode","name":"OpenCode","activation":"auto","package":"x"}',
);

/** What a real server lists: build (default, first), a subagent, a hidden agent and plan. */
const DEFAULT_AGENTS: AgentInfo[] = [
  'build:primary:false',
  'general:subagent:false',
  'title:primary:true',
  'plan:primary:false',
].map((spec) => {
  const [id = '', mode = '', hidden = ''] = spec.split(':');
  return wire<AgentInfo>(
    `{"id":"${id}","name":"${id}","mode":"${mode}","hidden":${hidden},"request":{},"permissions":[]}`,
  );
});

const LOCATION = wire<FormListOutput['location']>('{"directory":"C:\\\\work"}');

/** A pending permission as `permission.request.list` and the event carry it. */
const permissionRequest = (id: string, sessionID = 'ses_old'): PermissionRequest =>
  wire<PermissionRequest>(
    JSON.stringify({
      id,
      sessionID,
      action: 'read',
      resources: ['SECRET-RESOURCE-.env'],
      save: ['*'],
    }),
  );

/** A pending question form as `form.list` and `form.created` carry it. */
const questionForm = (id: string, sessionID = 'ses_old'): FormInfo =>
  wire<FormInfo>(
    JSON.stringify({
      id,
      sessionID,
      title: 'Questions',
      metadata: { kind: 'question' },
      fields: [{ key: 'q0', type: 'string', title: 'Color', options: [], custom: true }],
    }),
  );

/** A fake client recording its calls; every method has a harmless default. */
function fakeApi(options: FakeOptions = {}) {
  const calls: string[] = [];
  const prompts: Array<{
    sessionID: string;
    text: string;
    delivery?: string;
    files?: ReadonlyArray<{ uri: string; name?: string }>;
  }> = [];
  const interrupts: unknown[] = [];
  const permissionReplies: unknown[] = [];
  const formReplies: unknown[] = [];
  const formCancels: unknown[] = [];
  const removed: string[] = [];
  const listInputs: Array<SessionListInput | undefined> = [];
  const childListInputs: Array<SessionListInput | undefined> = [];
  const forks: Array<{ sessionID: string; before?: string }> = [];
  const updates: unknown[] = [];
  const sessionRemoves: unknown[] = [];
  const creates: unknown[] = [];
  const switches: string[] = [];
  /** Rejects like the real client: with the server's error BODY, an object, not an Error. */
  const failWith = (body: object): Promise<never> =>
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    Promise.reject(body);
  const api: ChatApi = {
    event: {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      }),
    },
    session: {
      list: (input) => {
        // Issue #21: the children read of the lineage is its own call, kept out of `session.list`
        // so the tests that count snapshots by counting root reads keep meaning one per resync.
        if (typeof input?.parentID === 'string') {
          calls.push('session.list.children');
          childListInputs.push(input);
          if (options.childrenError !== undefined) return failWith(options.childrenError);
          return Promise.resolve({ data: options.children ?? [], cursor: {} });
        }
        calls.push('session.list');
        listInputs.push(input);
        return (
          options.listImpl ??
          (() => Promise.resolve({ data: (options.sessions ?? []).map(sessionInfo), cursor: {} }))
        )(input);
      },
      active: () => {
        calls.push('session.active');
        return Promise.resolve(options.active ?? {});
      },
      create: (input) => {
        calls.push('session.create');
        creates.push(input);
        return Promise.resolve(sessionInfo('ses_new'));
      },
      get: ({ sessionID }) => {
        calls.push('session.get');
        if (options.getImpl !== undefined) return options.getImpl(sessionID);
        if (options.getError !== undefined) return failWith(options.getError);
        const title = options.titles?.[sessionID];
        const stored = options.sessionSelection ?? {};
        return Promise.resolve({
          ...sessionInfo(sessionID),
          ...(title === undefined ? {} : { title }),
          ...stored,
        });
      },
      switchAgent: (input) => {
        calls.push('session.switchAgent');
        switches.push(`agent:${input.agent}`);
        return options.switchError === undefined
          ? Promise.resolve()
          : failWith(options.switchError);
      },
      switchModel: (input) => {
        calls.push('session.switchModel');
        switches.push(
          `model:${input.model.providerID}/${input.model.id}${input.model.variant === undefined ? '' : `@${input.model.variant}`}`,
        );
        return options.switchError === undefined
          ? Promise.resolve()
          : failWith(options.switchError);
      },
      update: (input) => {
        calls.push('session.update');
        updates.push(input);
        return options.updateError === undefined
          ? Promise.resolve()
          : failWith(options.updateError);
      },
      remove: (input) => {
        calls.push('session.remove');
        sessionRemoves.push(input);
        if (options.removeImpl !== undefined) return options.removeImpl(input);
        return options.sessionRemoveError === undefined
          ? Promise.resolve()
          : failWith(options.sessionRemoveError);
      },
      fork: (input) => {
        calls.push('session.fork');
        forks.push(input);
        return (options.forkImpl ?? ((i) => Promise.resolve(sessionInfo(`${i.sessionID}_fork`))))(
          input,
        );
      },
      prompt: (input) => {
        calls.push('session.prompt');
        prompts.push({
          sessionID: input.sessionID,
          text: input.text,
          ...(input.delivery ? { delivery: input.delivery } : {}),
          ...(input.files ? { files: input.files } : {}),
        });
        return (options.promptImpl ?? (() => Promise.resolve({})))() as ReturnType<
          ChatApi['session']['prompt']
        >;
      },
      interrupt: (input) => {
        calls.push('session.interrupt');
        interrupts.push(input);
        return (options.interruptImpl ?? (() => Promise.resolve({ interrupted: true })))();
      },
      form: {
        reply: (input) => {
          calls.push('session.form.reply');
          formReplies.push(input);
          return options.replyError === undefined
            ? Promise.resolve()
            : failWith(options.replyError);
        },
        cancel: (input) => {
          calls.push('session.form.cancel');
          formCancels.push(input);
          return options.replyError === undefined
            ? Promise.resolve()
            : failWith(options.replyError);
        },
      },
    },
    message: {
      list: () => {
        calls.push('message.list');
        return (
          options.messageListImpl ??
          (() => Promise.resolve({ data: options.messages ?? [], cursor: {} }))
        )();
      },
    },
    model: {
      list: () => {
        calls.push('model.list');
        if (options.catalogError !== undefined) return failWith(options.catalogError);
        return Promise.resolve({ location: LOCATION, data: options.models ?? DEFAULT_MODELS });
      },
      default: () => {
        calls.push('model.default');
        return Promise.resolve({
          location: LOCATION,
          data:
            options.defaultModelInfo === undefined
              ? (DEFAULT_MODELS[0] ?? null)
              : options.defaultModelInfo,
        });
      },
    },
    provider: {
      list: () => {
        calls.push('provider.list');
        return Promise.resolve({ location: LOCATION, data: [PROVIDER] });
      },
    },
    agent: {
      list: () => {
        calls.push('agent.list');
        return Promise.resolve({ location: LOCATION, data: options.agents ?? DEFAULT_AGENTS });
      },
    },
    form: {
      list: () => {
        calls.push('form.list');
        return Promise.resolve({ location: LOCATION, data: options.forms ?? [] });
      },
    },
    permission: {
      reply: (input) => {
        calls.push('permission.reply');
        permissionReplies.push(input);
        return options.replyError === undefined ? Promise.resolve() : failWith(options.replyError);
      },
      request: {
        list: () => {
          calls.push('permission.request.list');
          return Promise.resolve({ location: LOCATION, data: options.permissions ?? [] });
        },
      },
      saved: {
        list: () => {
          calls.push('permission.saved.list');
          return Promise.resolve(options.saved ?? []);
        },
        remove: ({ id }) => {
          calls.push('permission.saved.remove');
          if (options.removeError !== undefined) return failWith(options.removeError);
          removed.push(id);
          return Promise.resolve();
        },
      },
    },
  };
  return {
    api,
    calls,
    prompts,
    interrupts,
    permissionReplies,
    formReplies,
    formCancels,
    removed,
    listInputs,
    childListInputs,
    forks,
    updates,
    sessionRemoves,
    creates,
    switches,
  };
}

/**
 * A fake {@link EditorActions} that records its calls as `name(args)` strings. `failWith` makes
 * every method reject with that error; `picked` is what the file picker returns.
 */
function fakeEditor(options: { failWith?: Error; picked?: AttachmentRef[] } = {}) {
  const calls: unknown[][] = [];
  const run = (name: string, ...args: unknown[]): Promise<void> => {
    calls.push([name, ...args]);
    return options.failWith === undefined ? Promise.resolve() : Promise.reject(options.failWith);
  };
  const editor: EditorActions = {
    open: (path, line, column) => run('open', path, line, column),
    insert: (text) => run('insert', text),
    newFile: (text, language) => run('newFile', text, language),
    copy: (text) => run('copy', text),
    pickFiles: () => {
      calls.push(['pickFiles']);
      return options.failWith === undefined
        ? Promise.resolve(options.picked ?? [])
        : Promise.reject(options.failWith);
    },
  };
  return { editor, calls };
}

/**
 * Builds a controller with a fake api, a fake stream runner, a recording memory and recording
 * fakes for the attention feature, the saved-permissions picker and the server commands.
 * `remembered` is the session remembered for the folder of `SERVER` (`C:\work`).
 */
function setup(
  api: ChatApi,
  remembered?: string,
  editor: EditorActions = fakeEditor().editor,
  picker: (items: SavedPermission[]) => Promise<string[]> = () => Promise.resolve([]),
  confirmDelete: (info: { title: string; running: boolean }) => Promise<boolean> = () =>
    Promise.resolve(true),
) {
  const confirmations: Array<{ title: string; running: boolean }> = [];
  const posted: HostToWebview[] = [];
  const logs: string[] = [];
  const memoryWrites: Array<{ folder: string; id: string | undefined }> = [];
  const stored = new Map<string, string>();
  if (remembered !== undefined) stored.set(SERVER.folder, remembered);
  const attentionCalls: Array<readonly PendingSummary[]> = [];
  const serverCalls: string[] = [];
  const picked: SavedPermission[][] = [];
  const streams: Array<{ options: EventStreamOptions<V2Event>; aborted: () => boolean }> = [];
  /** The user's model preferences, editable by a test; `writes` records `setLastModel`. */
  const prefs: {
    setting: string | undefined;
    last: ModelRef | undefined;
    writes: ModelRef[];
    writeError: Error | undefined;
  } = { setting: undefined, last: undefined, writes: [], writeError: undefined };
  const deps: ChatControllerDeps = {
    preferences: {
      defaultModel: () => prefs.setting,
      lastModel: () => prefs.last,
      setLastModel: (ref) => {
        if (prefs.writeError !== undefined) return Promise.reject(prefs.writeError);
        prefs.writes.push(ref);
        prefs.last = ref;
        return Promise.resolve();
      },
    },
    createClient: () => api,
    editor,
    post: (message) => posted.push(message),
    log: {
      info: (m) => logs.push(`info: ${m}`),
      warn: (m) => logs.push(`warn: ${m}`),
      error: (m) => logs.push(`error: ${m}`),
      debug: (m) => logs.push(`debug: ${m}`),
    },
    memory: {
      get: (folder) => stored.get(folder),
      set: (folder, id) => {
        if (id === undefined) stored.delete(folder);
        else stored.set(folder, id);
        memoryWrites.push({ folder, id });
        return Promise.resolve();
      },
    },
    attention: {
      update: (requests) => {
        attentionCalls.push(requests);
      },
    },
    savedPermissions: {
      pickToRevoke: (items) => {
        picked.push(items);
        return picker(items);
      },
    },
    sessions: {
      confirmDelete: (info) => {
        confirmations.push(info);
        return confirmDelete(info);
      },
    },
    server: {
      restart: () => {
        serverCalls.push('restart');
      },
      showLogs: () => {
        serverCalls.push('showLogs');
      },
    },
    runStream: ((options: EventStreamOptions<V2Event>) => {
      streams.push({ options, aborted: () => options.signal.aborted });
      return new Promise<void>((resolve) => {
        options.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }) as ChatControllerDeps['runStream'],
  };
  const controller = new ChatController(deps);
  const snapshots = (): Snapshot[] =>
    posted.flatMap((m) => (m.type === 'snapshot' ? [m.snapshot] : []));
  return {
    controller,
    posted,
    logs,
    memoryWrites,
    streams,
    snapshots,
    attentionCalls,
    serverCalls,
    picked,
    confirmations,
    prefs,
    /** Makes the host know a pending permission, as the stream would (needs a running server). */
    seedPermission: (id = 'per_1', sessionID = 'ses_1', save: string[] = ['*']) => {
      emit(streams, 'permission.asked', { id, sessionID, action: 'read', resources: ['x'], save });
    },
    /** Makes the host know a pending form, as the stream would (needs a running server). */
    seedForm: (id = 'frm_1', sessionID = 'ses_1') => {
      emit(streams, 'form.created', { form: questionForm(id, sessionID) });
    },
  };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ready', () => {
  it('answers with the connection state and an empty snapshot when there is no server', async () => {
    const { controller, posted } = setup(fakeApi().api);
    await controller.onWebviewReady();
    expect(posted).toEqual([
      { type: 'connection.state', connection: { state: 'starting' } },
      {
        type: 'snapshot',
        snapshot: {
          sessions: [],
          statuses: {},
          requests: { permissions: [], forms: [] },
          resolutions: [],
        },
      },
    ]);
  });

  it('answers with a real snapshot when the server is running', async () => {
    const { controller, snapshots, logs } = setup(fakeApi({ sessions: ['ses_a', 'ses_b'] }).api);
    controller.onServerState(RUNNING);
    await controller.onWebviewReady();
    expect(snapshots()[0]?.sessions.map((s) => s.id)).toEqual(['ses_a', 'ses_b']);
    expect(logs).toContain('info: webview ready');
    expect(logs).toContain('info: snapshot sent (2 sessions, open none)');
  });
});

describe('prompt.send', () => {
  it('creates a session when none is open, remembers it, publishes it and sends with the delivery', async () => {
    const { api, calls, prompts } = fakeApi();
    const { controller, posted, memoryWrites, snapshots, logs } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'hi',
      delivery: 'queue',
      files: [],
    });
    expect(calls.indexOf('session.create')).toBeLessThan(calls.indexOf('session.prompt'));
    expect(memoryWrites).toEqual([{ folder: SERVER.folder, id: 'ses_new' }]);
    expect(snapshots().at(-1)?.open?.sessionID).toBe('ses_new');
    expect(prompts).toEqual([{ sessionID: 'ses_new', text: 'hi', delivery: 'queue' }]);
    expect(posted.at(-1)).toEqual({ type: 'request.result', requestId: 'r1' });
    expect(logs).toContain('info: prompt accepted for ses_new');
  });

  it('reuses the open session instead of creating one', async () => {
    const { api, calls } = fakeApi({ sessions: ['ses_old'] });
    const { controller } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'hi',
      delivery: 'queue',
      files: [],
    });
    expect(calls).not.toContain('session.create');
    expect(calls).toContain('session.prompt');
  });

  it('answers a server error with a scrubbed ErrorInfo', async () => {
    const { api } = fakeApi({
      promptImpl: () =>
        // The real client rejects with the server's error BODY (an object), not an Error.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject({
          _tag: 'SessionBusyError',
          message: `busy at ${SERVER.url} (token ${SERVER.password})`,
        }),
    });
    const { controller, posted } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'hi',
      delivery: 'queue',
      files: [],
    });
    const result = posted.at(-1);
    expect(result).toMatchObject({
      type: 'request.result',
      requestId: 'r1',
      error: { code: 'SessionBusyError' },
    });
    expect(JSON.stringify(result)).not.toContain('43211');
    expect(JSON.stringify(result)).not.toContain(SERVER.password);
  });

  it('refuses an attachment the picker never emitted (AttachmentRejected)', async () => {
    const { api, calls } = fakeApi();
    const { controller, posted } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'look',
      delivery: 'queue',
      files: [{ uri: 'file:///C:/work/.env', name: '.env' }],
    });
    expect(calls).not.toContain('session.prompt');
    expect(posted.at(-1)).toMatchObject({ error: { code: 'AttachmentRejected' } });
  });

  it('sends the attachments the picker emitted', async () => {
    const picked = [{ uri: 'file:///C:/work/src/a.ts', name: 'src/a.ts' }];
    const { api, prompts } = fakeApi();
    const { controller, posted } = setup(api, 'ses_old', fakeEditor({ picked }).editor);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'attachments.pick', requestId: 'p1' });
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'look',
      delivery: 'queue',
      files: picked,
    });
    expect(prompts).toEqual([
      { sessionID: 'ses_old', text: 'look', delivery: 'queue', files: picked },
    ]);
    expect(posted.at(-1)).toEqual({ type: 'request.result', requestId: 'r1' });
  });

  it('answers ServerUnavailable when the server is not running', async () => {
    const { controller, posted } = setup(fakeApi().api);
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'hi',
      delivery: 'queue',
      files: [],
    });
    expect(posted.at(-1)).toMatchObject({ error: { code: 'ServerUnavailable' } });
  });
});

describe('open session memory', () => {
  it('forgets a remembered session that the server no longer has', async () => {
    const { api } = fakeApi({
      messageListImpl: () =>
        // Same as above: the client throws the 404 body, not an Error.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject({ _tag: 'SessionNotFoundError', message: 'Session not found' }),
    });
    const { controller, memoryWrites, snapshots } = setup(api, 'ses_gone');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(memoryWrites).toEqual([{ folder: SERVER.folder, id: undefined }]);
    expect(snapshots().at(-1)?.open).toBeUndefined();
  });

  it('reopens the remembered session with its history on startup', async () => {
    const messages = [
      wire<SessionMessageInfo>('{"id":"msg_u","type":"user","text":"hi","time":{"created":1}}'),
      wire<SessionMessageInfo>(
        '{"id":"msg_a","type":"assistant","agent":"build","model":{"id":"m","providerID":"p"},"time":{"created":2},"content":[{"type":"text","text":"yo"}]}',
      ),
    ];
    // REST returns newest first.
    const { api } = fakeApi({ sessions: ['ses_old'], messages: [...messages].reverse() });
    const { controller, snapshots } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    await controller.resync();
    const open = snapshots().at(-1)?.open;
    expect(open?.messages.map((m) => m.id)).toEqual(['msg_u', 'msg_a']);
    expect(open?.parts['msg_a']).toEqual([{ type: 'text', id: 'msg_a#0', text: 'yo' }]);
  });

  it('shows busy for an active session and error when the newest message is a failed idle', async () => {
    const failed = wire<SessionMessageInfo>(
      '{"id":"msg_i","type":"idle","outcome":"failed","time":{"created":3},"error":{"type":"provider.no-route","message":"nope"}}',
    );
    const { api } = fakeApi({ sessions: ['ses_old'], messages: [failed] });
    const { controller, snapshots } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(snapshots().at(-1)?.statuses['ses_old']).toEqual({
      type: 'error',
      error: { code: 'provider.no-route', message: 'nope' },
    });

    const busy = fakeApi({ sessions: ['ses_old'], active: { ses_old: { type: 'running' } } });
    const second = setup(busy.api, 'ses_old');
    second.controller.onServerState(RUNNING);
    await second.controller.resync();
    expect(second.snapshots().at(-1)?.statuses['ses_old']).toEqual({ type: 'busy' });
  });
});

describe('resync', () => {
  it('publishes only the newest of two overlapping snapshots', async () => {
    const resolvers: Array<(value: { data: SessionInfo[]; cursor: object }) => void> = [];
    const { api } = fakeApi({
      listImpl: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    });
    const { controller, snapshots } = setup(api);
    controller.onServerState(RUNNING);
    const first = controller.resync();
    const second = controller.resync();
    await flush();
    resolvers[1]?.({ data: [sessionInfo('ses_new')], cursor: {} });
    resolvers[0]?.({ data: [sessionInfo('ses_stale')], cursor: {} });
    await Promise.all([first, second]);
    expect(snapshots().map((s) => s.sessions.map((x) => x.id))).toEqual([['ses_new']]);
  });

  it('does not drop a message that streamed in while the snapshot was being read (review BLOCKER)', async () => {
    let release: (value: { data: SessionInfo[]; cursor: object }) => void = () => undefined;
    const { api } = fakeApi({
      listImpl: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const { controller, streams, snapshots } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    const pending = controller.resync(); // REST reads start with nothing in flight
    await flush();
    const options = streams[0]?.options;
    const send = (type: string, data: object) =>
      options?.onEvent(wire<V2Event>(JSON.stringify({ id: type, created: 5, type, data })));
    const a = { sessionID: 'ses_open', assistantMessageID: 'msg_live' };
    send('session.step.started', {
      ...a,
      agent: 'build',
      model: { id: 'm', providerID: 'p' },
      started: 5,
    });
    send('session.text.started', { ...a, ordinal: 0 });
    send('session.text.delta', { ...a, ordinal: 0, delta: 'streaming' });
    release({ data: [sessionInfo('ses_open')], cursor: {} });
    await pending;
    const open = snapshots().at(-1)?.open;
    expect(open?.messages.map((m) => m.id)).toEqual(['msg_live']);
    expect(open?.parts['msg_live']).toEqual([
      { type: 'text', id: 'msg_live#0', text: 'streaming' },
    ]);
  });

  it('publishes idle when the turn ended while the snapshot was being read (review round 2)', async () => {
    let release: (value: { data: SessionInfo[]; cursor: object }) => void = () => undefined;
    const { api } = fakeApi({
      active: { ses_open: { type: 'running' } }, // REST says running...
      listImpl: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const { controller, streams, snapshots } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    const pending = controller.resync();
    await flush();
    // ...but the turn finishes before the snapshot is published.
    streams[0]?.options.onEvent(
      wire<V2Event>(
        '{"id":"e","created":9,"type":"session.execution.succeeded","data":{"sessionID":"ses_open"}}',
      ),
    );
    release({ data: [sessionInfo('ses_open')], cursor: {} });
    await pending;
    expect(snapshots().at(-1)?.statuses['ses_open']).toEqual({ type: 'idle' });
  });

  it('refreshes on server.connected and on location.shutdown', async () => {
    const { api, calls } = fakeApi();
    const { controller, streams, logs } = setup(api);
    controller.onServerState(RUNNING);
    const options = streams[0]?.options;
    options?.onEvent(wire<V2Event>('{"id":"e","type":"server.connected","data":{}}'));
    await flush();
    options?.onEvent(wire<V2Event>('{"id":"e2","created":1,"type":"location.shutdown","data":{}}'));
    await flush();
    expect(calls.filter((c) => c === 'session.list')).toHaveLength(2);
    expect(logs).toContain('info: event stream connected');
  });

  it('logs a finished turn with its outcome', () => {
    const { api } = fakeApi();
    const { controller, streams, logs } = setup(api);
    controller.onServerState(RUNNING);
    streams[0]?.options.onEvent(
      wire<V2Event>(
        '{"id":"e","created":1,"type":"session.execution.succeeded","data":{"sessionID":"ses_1"}}',
      ),
    );
    expect(logs).toContain('info: turn finished: succeeded for ses_1');
  });
});

describe('server state', () => {
  it('starts one stream per running server and ignores a repeated running state', () => {
    const { controller, streams } = setup(fakeApi().api);
    controller.onServerState(RUNNING);
    controller.onServerState(RUNNING);
    expect(streams).toHaveLength(1);
  });

  it('aborts the stream and publishes stopped when the server stops', () => {
    const { controller, streams, posted } = setup(fakeApi().api);
    controller.onServerState(RUNNING);
    controller.onServerState({ kind: 'stopping' });
    controller.onServerState({ kind: 'stopped' });
    expect(streams[0]?.aborted()).toBe(true);
    expect(posted.at(-1)).toEqual({ type: 'connection.state', connection: { state: 'stopped' } });
  });

  it('maps an unavailable server to an unavailable connection with the reason', () => {
    const { controller, posted } = setup(fakeApi().api);
    controller.onServerState({ kind: 'unavailable', reason: 'exited', message: 'it died' });
    expect(posted.at(-1)).toEqual({
      type: 'connection.state',
      connection: {
        state: 'unavailable',
        reason: 'exited',
        error: { code: 'exited', message: 'it died' },
      },
    });
  });

  it('shows connected on a connected stream and reconnecting (scrubbed) on a lost one', () => {
    const { controller, streams, posted } = setup(fakeApi().api);
    controller.onServerState(RUNNING);
    streams[0]?.options.onState({ kind: 'connected' });
    expect(posted.at(-1)).toEqual({
      type: 'connection.state',
      connection: { state: 'connected', serverVersion: '2.0.32' },
    });
    streams[0]?.options.onState({
      kind: 'reconnecting',
      attempt: 2,
      error: new Error(`failed at ${SERVER.url}`),
    });
    const last = posted.at(-1);
    expect(last).toMatchObject({ connection: { state: 'reconnecting', attempt: 2 } });
    expect(JSON.stringify(last)).not.toContain('43211');
  });

  it('dispose aborts the stream synchronously', () => {
    const { controller, streams } = setup(fakeApi().api);
    controller.onServerState(RUNNING);
    controller.dispose();
    expect(streams[0]?.aborted()).toBe(true);
  });
});

describe('other webview messages', () => {
  it('opens a session after checking that it exists', async () => {
    const { api, calls } = fakeApi({ sessions: ['ses_x'] });
    const { controller, memoryWrites, snapshots } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'session.open', requestId: 'r2', sessionID: 'ses_x' });
    expect(calls).toContain('session.get');
    expect(memoryWrites).toEqual([{ folder: SERVER.folder, id: 'ses_x' }]);
    expect(snapshots().at(-1)?.open?.sessionID).toBe('ses_x');
  });
});

describe('session.abort (issue #16)', () => {
  it('interrupts without resume, answers ok and logs the stable line', async () => {
    const { api, interrupts, calls } = fakeApi();
    const { controller, posted, logs } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'session.abort', requestId: 'a1', sessionID: 'ses_1' });
    expect(interrupts).toEqual([{ sessionID: 'ses_1' }]);
    expect(posted.at(-1)).toEqual({ type: 'request.result', requestId: 'a1' });
    expect(logs).toContain('info: abort requested for ses_1 (interrupted: true)');
    expect(calls).not.toContain('session.list');
  });

  it('resyncs when the server had nothing to interrupt (stale busy in the webview)', async () => {
    const { api, calls } = fakeApi({
      interruptImpl: () => Promise.resolve({ interrupted: false }),
    });
    const { controller, logs, snapshots } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'session.abort', requestId: 'a1', sessionID: 'ses_1' });
    expect(logs).toContain('info: abort requested for ses_1 (interrupted: false)');
    expect(calls).toContain('session.list');
    expect(snapshots()).toHaveLength(1);
  });

  it('answers a scrubbed error when the server rejects the interrupt', async () => {
    const { api } = fakeApi({
      interruptImpl: () =>
        // The client throws the server's error body (an object), not an Error.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject({
          _tag: 'SessionNotFoundError',
          message: `Session not found at ${SERVER.url} with ${SERVER.password}`,
        }),
    });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'session.abort', requestId: 'a1', sessionID: 'ses_1' });
    const result = posted.at(-1);
    expect(result).toMatchObject({ requestId: 'a1', error: { code: 'SessionNotFoundError' } });
    expect(JSON.stringify(result)).not.toContain('43211');
    expect(JSON.stringify(result)).not.toContain(SERVER.password);
  });

  it('answers ServerUnavailable without a server', async () => {
    const { controller, posted } = setup(fakeApi().api);
    await controller.handle({ type: 'session.abort', requestId: 'a1', sessionID: 'ses_1' });
    expect(posted.at(-1)).toMatchObject({ error: { code: 'ServerUnavailable' } });
  });
});

describe('editor actions and attachments', () => {
  it('forwards each editor message to the editor with the exact arguments', async () => {
    const { editor, calls } = fakeEditor();
    const { controller } = setup(fakeApi().api, undefined, editor);
    await controller.handle({ type: 'editor.open', path: 'src/a.ts', line: 42, column: 7 });
    await controller.handle({ type: 'editor.insert', text: 'const $x = 1;' });
    await controller.handle({ type: 'editor.newFile', text: 'echo hi', language: 'shellscript' });
    await controller.handle({ type: 'clipboard.write', text: 'copied' });
    expect(calls).toEqual([
      ['open', 'src/a.ts', 42, 7],
      ['insert', 'const $x = 1;'],
      ['newFile', 'echo hi', 'shellscript'],
      ['copy', 'copied'],
    ]);
  });

  it('never writes the inserted or copied text to the log', async () => {
    const secret = 'API_KEY=sk-very-secret';
    const { controller, logs } = setup(fakeApi().api);
    await controller.handle({ type: 'editor.insert', text: secret });
    await controller.handle({ type: 'clipboard.write', text: secret });
    await controller.handle({ type: 'editor.newFile', text: secret });
    expect(logs.join(' | ')).not.toContain(secret);
  });

  it('works without a server: the editor never depends on the client', async () => {
    const { editor, calls } = fakeEditor();
    const { controller, posted } = setup(fakeApi().api, undefined, editor);
    await controller.handle({ type: 'editor.insert', text: 'x' });
    expect(calls).toEqual([['insert', 'x']]);
    expect(posted).toEqual([]);
  });

  it('turns a failing editor action into a scrubbed warning notice and a warn log', async () => {
    const failure = Object.assign(new Error(`cannot reach ${SERVER.url} (${SERVER.password})`), {
      name: 'NoActiveEditor',
    });
    const { editor } = fakeEditor({ failWith: failure });
    const { controller, posted, logs } = setup(fakeApi().api, undefined, editor);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'editor.insert', text: 'x' });
    const notice = posted.find((m) => m.type === 'notice');
    expect(notice).toMatchObject({ level: 'warning', error: { code: 'NoActiveEditor' } });
    expect(JSON.stringify(notice)).not.toContain('43211');
    expect(JSON.stringify(notice)).not.toContain(SERVER.password);
    expect(logs.some((line) => line.startsWith('warn: editor.insert failed: NoActiveEditor'))).toBe(
      true,
    );
  });

  it('answers attachments.pick with the picked files and then a successful result', async () => {
    const picked = [{ uri: 'file:///C:/work/a.ts', name: 'a.ts' }];
    const { editor } = fakeEditor({ picked });
    const { controller, posted } = setup(fakeApi().api, undefined, editor);
    await controller.handle({ type: 'attachments.pick', requestId: 'p1' });
    expect(posted).toEqual([
      { type: 'attachments.picked', requestId: 'p1', files: picked },
      { type: 'request.result', requestId: 'p1' },
    ]);
  });

  it('answers a failing picker through request.result', async () => {
    const { editor } = fakeEditor({ failWith: new Error('dialog failed') });
    const { controller, posted } = setup(fakeApi().api, undefined, editor);
    await controller.handle({ type: 'attachments.pick', requestId: 'p1' });
    expect(posted.at(-1)).toMatchObject({ requestId: 'p1', error: { message: 'dialog failed' } });
  });
});

/** Feeds one stream event (built from JSON like it arrives) to the controller under test. */
function emit(
  streams: Array<{ options: EventStreamOptions<V2Event> }>,
  type: string,
  data: object,
): void {
  streams[0]?.options.onEvent(
    wire<V2Event>(JSON.stringify({ id: `evt_${type}`, created: 5, type, data })),
  );
}

/** The summaries of the last call to the attention feature. */
const lastAttention = (calls: Array<readonly PendingSummary[]>): string[] =>
  (calls.at(-1) ?? []).map((item) => item.id);

describe('pending requests of the location (issues #18/#44)', () => {
  it('publishes the permissions and forms of the WHOLE location, not only of the open session', async () => {
    const { api, calls } = fakeApi({
      permissions: [permissionRequest('per_1', 'ses_child')],
      forms: [questionForm('frm_1', 'ses_other')],
    });
    const { controller, snapshots, attentionCalls } = setup(api);
    controller.onServerState(RUNNING);
    await controller.resync();
    const requests = snapshots().at(-1)?.requests;
    expect(requests?.permissions.map((p) => [p.id, p.sessionID])).toEqual([['per_1', 'ses_child']]);
    expect(requests?.forms.map((f) => [f.id, f.sessionID, f.kind])).toEqual([
      ['frm_1', 'ses_other', 'question'],
    ]);
    expect(calls).toContain('permission.request.list');
    expect(calls).toContain('form.list');
    expect(lastAttention(attentionCalls)).toEqual(['per_1', 'frm_1']);
  });

  it('forwards an ask of ANOTHER session to the webview and to the attention feature, then its resolution', () => {
    const { api } = fakeApi();
    const { controller, streams, posted, attentionCalls, logs } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    emit(streams, 'permission.asked', {
      id: 'per_9',
      sessionID: 'ses_child',
      action: 'read',
      resources: ['SECRET-RESOURCE-.env'],
      save: ['*'],
    });
    expect(posted.at(-1)).toMatchObject({
      type: 'permission.asked',
      permission: { id: 'per_9', sessionID: 'ses_child' },
    });
    expect(lastAttention(attentionCalls)).toEqual(['per_9']);
    expect(logs).toContain('info: permission asked per_9 for ses_child (read)');

    emit(streams, 'permission.replied', {
      sessionID: 'ses_child',
      requestID: 'per_9',
      reply: 'once',
    });
    expect(posted.at(-1)).toMatchObject({ type: 'permission.resolved', permissionID: 'per_9' });
    expect(lastAttention(attentionCalls)).toEqual([]);
    expect(logs).toContain('info: permission per_9 resolved: once');
    // The resources can be shell commands with secrets: they never reach the log.
    expect(logs.join(' | ')).not.toContain('SECRET-RESOURCE');
  });

  it('forms: asked, resolved and logged with their stable lines', () => {
    const { api } = fakeApi();
    const { controller, streams, posted, attentionCalls, logs } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    emit(streams, 'form.created', { form: questionForm('frm_1', 'ses_child') });
    expect(posted.at(-1)).toMatchObject({ type: 'form.asked', form: { id: 'frm_1' } });
    expect(lastAttention(attentionCalls)).toEqual(['frm_1']);
    expect(logs).toContain('info: form asked frm_1 for ses_child');
    emit(streams, 'form.replied', { id: 'frm_1', sessionID: 'ses_child', answer: {} });
    expect(lastAttention(attentionCalls)).toEqual([]);
    expect(logs).toContain('info: form frm_1 resolved: answered');
  });

  it('a repeated ask neither repeats the log nor wakes the attention feature again', () => {
    const { api } = fakeApi();
    const { controller, streams, attentionCalls, logs } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    const ask = { id: 'per_9', sessionID: 'ses_1', action: 'edit', resources: ['a'], save: [] };
    emit(streams, 'permission.asked', ask);
    emit(streams, 'permission.asked', ask);
    expect(attentionCalls).toHaveLength(1);
    expect(logs.filter((l) => l.startsWith('info: permission asked'))).toHaveLength(1);
  });

  it('keeps in the snapshot a request the stream announced while REST was being read, and drops one it resolved', async () => {
    let release: (value: { data: SessionInfo[]; cursor: object }) => void = () => undefined;
    const { api } = fakeApi({
      permissions: [permissionRequest('per_old')],
      listImpl: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const { controller, streams, snapshots } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    const pending = controller.resync();
    await flush();
    // REST listed per_old before it was answered, and did not know per_new yet.
    emit(streams, 'permission.replied', {
      sessionID: 'ses_old',
      requestID: 'per_old',
      reply: 'once',
    });
    emit(streams, 'permission.asked', {
      id: 'per_new',
      sessionID: 'ses_old',
      action: 'edit',
      resources: ['a'],
      save: [],
    });
    release({ data: [sessionInfo('ses_old')], cursor: {} });
    await pending;
    expect(
      snapshots()
        .at(-1)
        ?.requests.permissions.map((p) => p.id),
    ).toEqual(['per_new']);
  });

  it('resyncs on an interrupt of a session that had requests, and clears the ones REST no longer lists', async () => {
    const options: Parameters<typeof fakeApi>[0] = { permissions: [permissionRequest('per_1')] };
    const { api, calls } = fakeApi(options);
    const { controller, streams, snapshots, attentionCalls } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(lastAttention(attentionCalls)).toEqual(['per_1']);
    const before = calls.filter((c) => c === 'session.list').length;

    // The server deletes the pending permission on interrupt and publishes NO permission.replied.
    options.permissions = [];
    emit(streams, 'session.execution.interrupted', { sessionID: 'ses_old', reason: 'user' });
    await flush();
    expect(calls.filter((c) => c === 'session.list').length).toBe(before + 1);
    expect(snapshots().at(-1)?.requests.permissions).toEqual([]);
    expect(lastAttention(attentionCalls)).toEqual([]);
  });

  it('also resyncs when the turn failed, but not for a session with no requests', async () => {
    const { api, calls } = fakeApi({ permissions: [permissionRequest('per_1', 'ses_old')] });
    const { controller, streams } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    await controller.resync();
    const base = calls.filter((c) => c === 'session.list').length;
    emit(streams, 'session.execution.interrupted', { sessionID: 'ses_unrelated', reason: 'user' });
    await flush();
    expect(calls.filter((c) => c === 'session.list').length).toBe(base);
    emit(streams, 'session.execution.failed', {
      sessionID: 'ses_old',
      error: { type: 'provider.no-route', message: 'x' },
    });
    await flush();
    expect(calls.filter((c) => c === 'session.list').length).toBe(base + 1);
  });

  it('forgets the requests when the server goes away (they died with it)', async () => {
    const { api } = fakeApi({ permissions: [permissionRequest('per_1')] });
    const { controller, attentionCalls } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    await controller.resync();
    controller.onServerState({ kind: 'stopping' });
    expect(lastAttention(attentionCalls)).toEqual([]);
  });

  it('dispose tells the attention feature there is nothing pending', () => {
    const { controller, attentionCalls } = setup(fakeApi().api);
    controller.dispose();
    expect(attentionCalls.at(-1)).toEqual([]);
  });
});

describe('snapshot failures (W4)', () => {
  it('an unreachable server logs a warning and posts no error notice (the banner says it)', async () => {
    const { api } = fakeApi({
      // The real client rejects with `ClientError("Transport")`; the mapped code is `Transport`.
      listImpl: () =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject({ _tag: 'Transport', message: 'fetch failed' }),
    });
    const { controller, posted, logs } = setup(api);
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(posted.some((m) => m.type === 'notice')).toBe(false);
    expect(logs.some((l) => l.startsWith('warn: snapshot failed (server unreachable)'))).toBe(true);
  });

  it('any other failure is still an error notice', async () => {
    const { api } = fakeApi({
      listImpl: () =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject({ _tag: 'UnauthorizedError', message: 'no' }),
    });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(posted.at(-1)).toMatchObject({ type: 'notice', level: 'error' });
  });
});

describe('permission.reply', () => {
  const reply = (decision: 'once' | 'always' | 'reject', message?: string) =>
    ({
      type: 'permission.reply',
      requestId: 'r1',
      sessionID: 'ses_1',
      permissionID: 'per_1',
      decision,
      ...(message === undefined ? {} : { message }),
    }) as const;

  it('calls the client with requestID = permissionID and answers ok', async () => {
    const { api, permissionReplies } = fakeApi();
    const { controller, posted, logs, seedPermission } = setup(api);
    controller.onServerState(RUNNING);
    seedPermission();
    await controller.handle(reply('once'));
    expect(permissionReplies).toEqual([
      { sessionID: 'ses_1', requestID: 'per_1', decision: 'once' },
    ]);
    expect(posted.at(-1)).toEqual({ type: 'request.result', requestId: 'r1' });
    expect(logs).toContain('info: permission reply sent for per_1 (once)');
  });

  it('sends the message only with a reject that has text', async () => {
    const { api, permissionReplies } = fakeApi();
    const { controller, seedPermission } = setup(api);
    controller.onServerState(RUNNING);
    seedPermission();
    await controller.handle(reply('reject', "don't read secrets"));
    await controller.handle(reply('reject', '   '));
    await controller.handle(reply('reject'));
    await controller.handle(reply('once', 'ignored'));
    await controller.handle(reply('always', 'ignored'));
    expect(permissionReplies).toEqual([
      { sessionID: 'ses_1', requestID: 'per_1', decision: 'reject', message: "don't read secrets" },
      { sessionID: 'ses_1', requestID: 'per_1', decision: 'reject' },
      { sessionID: 'ses_1', requestID: 'per_1', decision: 'reject' },
      { sessionID: 'ses_1', requestID: 'per_1', decision: 'once' },
      { sessionID: 'ses_1', requestID: 'per_1', decision: 'always' },
    ]);
  });

  it('answers a request that is gone with the error AND a fresh snapshot (the snapshot tells the truth)', async () => {
    const { api, calls } = fakeApi({
      replyError: { _tag: 'PermissionNotFoundError', message: 'gone', requestID: 'per_1' },
    });
    const { controller, posted, seedPermission } = setup(api);
    controller.onServerState(RUNNING);
    seedPermission();
    await controller.handle(reply('once'));
    expect(posted.find((m) => m.type === 'request.result' && m.requestId === 'r1')).toMatchObject({
      error: { code: 'PermissionNotFoundError' },
    });
    expect(calls).toContain('session.list');
  });

  // W3 of the review: the host checks the webview's answer against its own registry.
  it('refuses an id the host does not know, without calling the server, and resyncs', async () => {
    const { api, calls, permissionReplies } = fakeApi();
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle(reply('once'));
    expect(permissionReplies).toEqual([]);
    expect(posted.find((m) => m.type === 'request.result' && m.requestId === 'r1')).toMatchObject({
      error: { code: 'RequestNotPending' },
    });
    expect(calls).toContain('session.list');
  });

  it('refuses a reply whose session is not the one the request belongs to', async () => {
    const { api, permissionReplies } = fakeApi();
    const { controller, posted, seedPermission } = setup(api);
    controller.onServerState(RUNNING);
    seedPermission('per_1', 'ses_other');
    await controller.handle(reply('once')); // reply() says ses_1
    expect(permissionReplies).toEqual([]);
    expect(posted.find((m) => m.type === 'request.result' && m.requestId === 'r1')).toMatchObject({
      error: { code: 'RequestNotPending' },
    });
  });

  it('refuses always for a request with no save rules, but accepts once', async () => {
    const { api, permissionReplies } = fakeApi();
    const { controller, posted, seedPermission } = setup(api);
    controller.onServerState(RUNNING);
    seedPermission('per_1', 'ses_1', []);
    await controller.handle(reply('always'));
    expect(permissionReplies).toEqual([]);
    expect(posted.find((m) => m.type === 'request.result' && m.requestId === 'r1')).toMatchObject({
      error: { code: 'AlwaysNotAvailable' },
    });
    await controller.handle(reply('once'));
    expect(permissionReplies).toEqual([
      { sessionID: 'ses_1', requestID: 'per_1', decision: 'once' },
    ]);
  });

  it('answers ServerUnavailable without a server', async () => {
    const { controller, posted } = setup(fakeApi().api);
    await controller.handle(reply('once'));
    expect(posted.at(-1)).toMatchObject({ error: { code: 'ServerUnavailable' } });
  });

  it('the notification path returns undefined on success and a scrubbed error on failure, posting no result', async () => {
    const ok = fakeApi();
    const first = setup(ok.api);
    first.controller.onServerState(RUNNING);
    first.seedPermission();
    await expect(
      first.controller.replyPermission('ses_1', 'per_1', 'once'),
    ).resolves.toBeUndefined();
    expect(ok.permissionReplies).toEqual([
      { sessionID: 'ses_1', requestID: 'per_1', decision: 'once' },
    ]);
    expect(first.posted.some((m) => m.type === 'request.result')).toBe(false);

    const bad = fakeApi({
      replyError: { _tag: 'PermissionNotFoundError', message: `gone at ${SERVER.url}` },
    });
    const second = setup(bad.api);
    second.controller.onServerState(RUNNING);
    second.seedPermission();
    const info = await second.controller.replyPermission('ses_1', 'per_1', 'reject');
    expect(info).toMatchObject({ code: 'PermissionNotFoundError' });
    expect(JSON.stringify(info)).not.toContain('43211');
    expect(bad.calls).toContain('session.list');
  });
});

describe('form.reply and form.cancel', () => {
  it('replies with the exact answer and never logs it', async () => {
    const { api, formReplies } = fakeApi();
    const { controller, posted, logs, seedForm } = setup(api);
    controller.onServerState(RUNNING);
    seedForm();
    await controller.handle({
      type: 'form.reply',
      requestId: 'r1',
      sessionID: 'ses_1',
      formID: 'frm_1',
      answer: { q0: 'TOP-SECRET-ANSWER', q1: ['a', 'b'] },
    });
    expect(formReplies).toEqual([
      { sessionID: 'ses_1', formID: 'frm_1', answer: { q0: 'TOP-SECRET-ANSWER', q1: ['a', 'b'] } },
    ]);
    expect(posted.at(-1)).toEqual({ type: 'request.result', requestId: 'r1' });
    expect(logs).toContain('info: form reply sent for frm_1');
    expect(logs.join(' | ')).not.toContain('TOP-SECRET-ANSWER');
  });

  it('cancels without a message by default, with one when it has text, and drops a blank one', async () => {
    const { api, formCancels } = fakeApi();
    const { controller, logs, seedForm } = setup(api);
    controller.onServerState(RUNNING);
    seedForm();
    const cancel = (message?: string) =>
      controller.handle({
        type: 'form.cancel',
        requestId: 'r1',
        sessionID: 'ses_1',
        formID: 'frm_1',
        ...(message === undefined ? {} : { message }),
      });
    await cancel();
    await cancel('  ');
    await cancel('in my own words');
    expect(formCancels).toEqual([
      { sessionID: 'ses_1', formID: 'frm_1' },
      { sessionID: 'ses_1', formID: 'frm_1' },
      { sessionID: 'ses_1', formID: 'frm_1', message: 'in my own words' },
    ]);
    expect(logs).toContain('info: form cancel sent for frm_1');
    expect(logs.join(' | ')).not.toContain('in my own words');
  });

  it('an already settled form resyncs; an invalid answer does NOT (the card must stay open)', async () => {
    const settled = fakeApi({ replyError: { _tag: 'FormAlreadySettledError', message: 'late' } });
    const first = setup(settled.api);
    first.controller.onServerState(RUNNING);
    first.seedForm();
    await first.controller.handle({
      type: 'form.reply',
      requestId: 'r1',
      sessionID: 'ses_1',
      formID: 'frm_1',
      answer: { q0: 'A' },
    });
    expect(settled.calls).toContain('session.list');

    const invalid = fakeApi({
      replyError: { _tag: 'FormInvalidAnswerError', message: 'q0 is required' },
    });
    const second = setup(invalid.api);
    second.controller.onServerState(RUNNING);
    second.seedForm();
    await second.controller.handle({
      type: 'form.reply',
      requestId: 'r2',
      sessionID: 'ses_1',
      formID: 'frm_1',
      answer: {},
    });
    expect(invalid.calls).not.toContain('session.list');
    expect(second.posted.at(-1)).toMatchObject({
      type: 'request.result',
      requestId: 'r2',
      error: { code: 'FormInvalidAnswerError', message: 'q0 is required' },
    });
  });

  it('a cancel of a form that no longer exists resyncs', async () => {
    const { api, calls } = fakeApi({ replyError: { _tag: 'FormNotFoundError', message: 'gone' } });
    const { controller, seedForm } = setup(api);
    controller.onServerState(RUNNING);
    seedForm('f', 's');
    await controller.handle({ type: 'form.cancel', requestId: 'r1', sessionID: 's', formID: 'f' });
    expect(calls).toContain('session.list');
  });

  it('refuses a form id or session the host does not know, without calling the server', async () => {
    const { api, formReplies, formCancels } = fakeApi();
    const { controller, posted, seedForm } = setup(api);
    controller.onServerState(RUNNING);
    seedForm('frm_1', 'ses_1');
    await controller.handle({
      type: 'form.reply',
      requestId: 'r1',
      sessionID: 'ses_1',
      formID: 'frm_unknown',
      answer: { q0: 'A' },
    });
    await controller.handle({
      type: 'form.cancel',
      requestId: 'r2',
      sessionID: 'ses_other',
      formID: 'frm_1',
    });
    expect(formReplies).toEqual([]);
    expect(formCancels).toEqual([]);
    expect(posted.find((m) => m.type === 'request.result' && m.requestId === 'r1')).toMatchObject({
      error: { code: 'RequestNotPending' },
    });
    expect(posted.find((m) => m.type === 'request.result' && m.requestId === 'r2')).toMatchObject({
      error: { code: 'RequestNotPending' },
    });
  });

  it('answers ServerUnavailable without a server', async () => {
    const { controller, posted } = setup(fakeApi().api);
    await controller.handle({ type: 'form.cancel', requestId: 'r1', sessionID: 's', formID: 'f' });
    expect(posted.at(-1)).toMatchObject({ error: { code: 'ServerUnavailable' } });
  });
});

describe('permissions.manage (saved permissions)', () => {
  const saved = [
    wire<PermissionSavedInfo>(
      '{"id":"sp_1","projectID":"p","action":"read","resource":"*","time":{"created":1000,"updated":1000}}',
    ),
    wire<PermissionSavedInfo>(
      '{"id":"sp_2","projectID":"p","action":"edit","resource":"src/*","time":{"created":2000,"updated":2000}}',
    ),
  ];

  it('lists the rules, revokes the ones the picker returns and reports how many', async () => {
    const { api, removed } = fakeApi({ saved });
    const { controller, picked, posted, logs } = setup(api, undefined, undefined, () =>
      Promise.resolve(['sp_2']),
    );
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'permissions.manage' });
    expect(picked[0]).toEqual([
      { id: 'sp_1', action: 'read', resource: '*', createdAt: 1000 },
      { id: 'sp_2', action: 'edit', resource: 'src/*', createdAt: 2000 },
    ]);
    expect(removed).toEqual(['sp_2']);
    expect(posted.at(-1)).toMatchObject({
      type: 'notice',
      level: 'info',
      error: { message: 'Revoked 1 saved permission(s)' },
    });
    expect(logs).toContain('info: revoked 1 saved permission(s)');
  });

  it('removes nothing and says nothing when the picker is dismissed', async () => {
    const { api, removed } = fakeApi({ saved });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'permissions.manage' });
    expect(removed).toEqual([]);
    expect(posted.some((m) => m.type === 'notice')).toBe(false);
  });

  it('says so when the project has no saved permissions, without opening the picker', async () => {
    const { api } = fakeApi({ saved: [] });
    const { controller, picked, posted } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'permissions.manage' });
    expect(picked).toEqual([]);
    expect(posted.at(-1)).toMatchObject({
      type: 'notice',
      level: 'info',
      error: { code: 'NoSavedPermissions' },
    });
  });

  it('reports a failed removal as a scrubbed warning', async () => {
    const { api } = fakeApi({
      saved,
      removeError: { _tag: 'UnauthorizedError', message: `no at ${SERVER.url}` },
    });
    const { controller, posted } = setup(api, undefined, undefined, () =>
      Promise.resolve(['sp_1']),
    );
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'permissions.manage' });
    const notice = posted.at(-1);
    expect(notice).toMatchObject({
      type: 'notice',
      level: 'warning',
      error: { code: 'UnauthorizedError' },
    });
    expect(JSON.stringify(notice)).not.toContain('43211');
  });

  it('warns when there is no server', async () => {
    const { controller, posted } = setup(fakeApi().api);
    await controller.handle({ type: 'permissions.manage' });
    expect(posted.at(-1)).toMatchObject({ type: 'notice', level: 'warning' });
  });
});

describe('server commands, reconnecting banner and per-folder memory (issue #10)', () => {
  it('forwards server.restart and logs.show to the server commands', async () => {
    const { controller, serverCalls } = setup(fakeApi().api);
    await controller.handle({ type: 'server.restart' });
    await controller.handle({ type: 'logs.show' });
    expect(serverCalls).toEqual(['restart', 'showLogs']);
  });

  it('shows reconnecting with the attempt while a restart is scheduled, and starting while restarting', () => {
    const { controller, posted } = setup(fakeApi().api);
    controller.onServerState({
      kind: 'unavailable',
      reason: 'exited',
      message: 'it died',
      retryInMs: 1000,
      attempt: 2,
    });
    expect(posted.at(-1)).toMatchObject({
      type: 'connection.state',
      connection: { state: 'reconnecting', attempt: 2 },
    });
    controller.onServerState({ kind: 'restarting', reason: 'command' });
    expect(posted.at(-1)).toEqual({ type: 'connection.state', connection: { state: 'starting' } });
    controller.onServerState({ kind: 'unavailable', reason: 'exited', message: 'gave up' });
    expect(posted.at(-1)).toMatchObject({ connection: { state: 'unavailable', reason: 'exited' } });
  });

  it("remembers the open session PER folder: switching folders reopens that folder's session", async () => {
    const { api } = fakeApi({ sessions: ['ses_a', 'ses_b'] });
    const { controller, snapshots, memoryWrites } = setup(api, 'ses_a');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(snapshots().at(-1)?.open?.sessionID).toBe('ses_a');

    // Another folder has no remembered session: nothing is open there...
    controller.onServerState({
      kind: 'running',
      server: { ...SERVER, url: 'http://127.0.0.1:43999', folder: 'C:\\other' },
    });
    await controller.resync();
    expect(snapshots().at(-1)?.open).toBeUndefined();

    // ...and opening a session there stores it under THAT folder only.
    await controller.handle({ type: 'session.open', requestId: 'r1', sessionID: 'ses_b' });
    expect(memoryWrites.at(-1)).toEqual({ folder: 'C:\\other', id: 'ses_b' });

    // Back to the first folder: its own session comes back.
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(snapshots().at(-1)?.open?.sessionID).toBe('ses_a');
  });
});

describe('focusRequest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const target = { kind: 'permission', sessionID: 'ses_1', id: 'per_1' } as const;

  it('sends ui.focus now and again after the next snapshot of a webview that was loading', async () => {
    const { controller, posted } = setup(fakeApi().api);
    controller.onServerState(RUNNING);
    controller.focusRequest(target);
    expect(posted.at(-1)).toEqual({ type: 'ui.focus', target });
    await controller.onWebviewReady();
    const types = posted.map((m) => m.type);
    expect(types.lastIndexOf('ui.focus')).toBeGreaterThan(types.lastIndexOf('snapshot'));
    // Only once: a later ready does not steal the focus again.
    const focuses = posted.filter((m) => m.type === 'ui.focus').length;
    await controller.onWebviewReady();
    expect(posted.filter((m) => m.type === 'ui.focus').length).toBe(focuses);
  });

  it('does not repeat a focus request that is too old', async () => {
    const { controller, posted } = setup(fakeApi().api);
    controller.onServerState(RUNNING);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    controller.focusRequest(target);
    const sent = posted.filter((m) => m.type === 'ui.focus').length;
    vi.spyOn(Date, 'now').mockReturnValue(now + FOCUS_REQUEST_TTL_MS + 1);
    await controller.onWebviewReady();
    expect(posted.filter((m) => m.type === 'ui.focus').length).toBe(sent);
  });
});

// E3-resolved-history (issues #56/#18). ALL DATA FABRICATED (the event shapes follow the types and
// the stable log lines of the controller); the full path against the synthetic server is covered by
// `chatController.e2e.test.ts` and, in a real VS Code, by `test:visual`.
describe('answered requests (E3-resolved-history)', () => {
  const ask = (streams: Array<{ options: EventStreamOptions<V2Event> }>, sessionID = 'ses_old') => {
    emit(streams, 'permission.asked', {
      id: 'per_1',
      sessionID,
      action: 'read',
      resources: ['SECRET-RESOURCE-.env', 'other'],
      save: ['*'],
      source: { type: 'tool', messageID: 'msg_1', id: 'call_1' },
    });
  };
  const answer = (
    streams: Array<{ options: EventStreamOptions<V2Event> }>,
    sessionID = 'ses_old',
    reply = 'once',
  ) => {
    emit(streams, 'permission.replied', { sessionID, requestID: 'per_1', reply });
  };

  it('attaches the record to permission.resolved and form.resolved, and logs only ids and the decision', () => {
    const { api } = fakeApi();
    const { controller, streams, posted, logs } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    ask(streams);
    answer(streams);
    expect(posted.at(-1)).toMatchObject({
      type: 'permission.resolved',
      permissionID: 'per_1',
      resolution: {
        kind: 'permission',
        id: 'per_1',
        sessionID: 'ses_old',
        tool: { messageID: 'msg_1', partID: 'call_1' },
        decision: 'once',
        action: 'read',
        resource: 'SECRET-RESOURCE-.env',
        withFeedback: false,
      },
    });
    emit(streams, 'form.created', { form: questionForm('frm_1', 'ses_old') });
    emit(streams, 'form.replied', {
      id: 'frm_1',
      sessionID: 'ses_old',
      answer: { q0: 'SECRET-ANSWER' },
    });
    expect(posted.at(-1)).toMatchObject({
      type: 'form.resolved',
      formID: 'frm_1',
      resolution: { kind: 'form', id: 'frm_1', outcome: 'answered', formKind: 'question' },
    });
    expect(logs).toContain('info: resolution recorded per_1 (once)');
    expect(logs).toContain('info: resolution recorded frm_1 (answered)');
    // Neither the resource of the permission nor the text of an answer reaches the log.
    expect(logs.join(' | ')).not.toContain('SECRET-RESOURCE');
    expect(logs.join(' | ')).not.toContain('SECRET-ANSWER');
  });

  it('leaves a resolved message without record when the host never saw the request asked', () => {
    const { api } = fakeApi();
    const { controller, streams, posted } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    answer(streams);
    const resolved = posted.at(-1);
    expect(resolved).toMatchObject({ type: 'permission.resolved' });
    expect(resolved !== undefined && 'resolution' in resolved).toBe(false);
  });

  it('the snapshot carries the records of the OPEN session only', async () => {
    const { api } = fakeApi();
    const { controller, streams, snapshots } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    ask(streams, 'ses_child');
    answer(streams, 'ses_child');
    ask(streams, 'ses_old');
    answer(streams, 'ses_old', 'reject');
    await controller.resync();
    expect(snapshots().at(-1)?.resolutions).toMatchObject([
      { id: 'per_1', sessionID: 'ses_old', decision: 'reject' },
    ]);
  });

  it('with no open session the snapshot carries no records', async () => {
    const { api } = fakeApi();
    const { controller, streams, snapshots } = setup(api);
    controller.onServerState(RUNNING);
    ask(streams, 'ses_child');
    answer(streams, 'ses_child');
    await controller.resync();
    expect(snapshots().at(-1)?.resolutions).toEqual([]);
  });

  it('survives Restart Server and a stream stop: the records are history, not pending state', async () => {
    const { api } = fakeApi();
    const { controller, streams, snapshots } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    ask(streams);
    answer(streams);
    controller.onServerState({ kind: 'restarting', reason: 'command' });
    controller.onServerState({
      kind: 'running',
      server: { ...SERVER, url: 'http://127.0.0.1:43212' },
    });
    await controller.resync();
    expect(snapshots().at(-1)?.resolutions).toMatchObject([{ id: 'per_1', decision: 'once' }]);
    controller.onServerState({ kind: 'stopping' });
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(snapshots().at(-1)?.resolutions).toMatchObject([{ id: 'per_1' }]);
  });

  it('records a request that only came from the snapshot (asked before the host connected)', async () => {
    const { api } = fakeApi({ permissions: [permissionRequest('per_1', 'ses_old')] });
    const { controller, streams, posted } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    await controller.resync();
    answer(streams);
    expect(posted.at(-1)).toMatchObject({
      type: 'permission.resolved',
      resolution: { id: 'per_1', decision: 'once' },
    });
  });

  /**
   * Protects the ORDER inside `resync()`: `completeWithLive` must run BEFORE `rememberAsks`.
   * `rememberAsks` REPLACES the remembered asks, so if it received the raw REST list, an ask the
   * stream announced while the REST was being read (and REST did not list) would be forgotten,
   * and its later `*.resolved` would yield no record (nor would the next snapshot carry one).
   * Found by the second review of E3-resolved-history (SUGGESTION 1); mutation-checked: moving
   * `rememberAsks` before `completeWithLive` makes this test fail. ALL DATA FABRICATED: the race
   * is forced by emitting the stream event from inside the fake `message.list`; whether a real
   * server interleaves like this is UNVERIFIED (the order itself is deterministic in the host).
   */
  it('keeps the record of an ask that arrived by the stream while the resync was reading REST', async () => {
    let injected = false;
    let emitAsk: () => void = () => undefined;
    const { api } = fakeApi({
      messageListImpl: () => {
        if (!injected) {
          injected = true;
          emitAsk();
        }
        return Promise.resolve({ data: [], cursor: {} });
      },
    });
    const { controller, streams, posted, snapshots } = setup(api, 'ses_old');
    emitAsk = () => {
      ask(streams);
    };
    controller.onServerState(RUNNING);
    await controller.resync();
    // The first resync read REST (empty permission list) and the stream added `per_1` meanwhile.
    expect(snapshots().at(-1)?.requests.permissions).toMatchObject([{ id: 'per_1' }]);
    answer(streams);
    expect(posted.at(-1)).toMatchObject({
      type: 'permission.resolved',
      resolution: { id: 'per_1', decision: 'once' },
    });
    await controller.resync();
    expect(snapshots().at(-1)?.resolutions).toMatchObject([{ id: 'per_1', decision: 'once' }]);
  });

  it('flags withFeedback only for a reject sent with text, and not when the call failed', async () => {
    const { api } = fakeApi();
    const { controller, streams, posted, seedPermission } = setup(api);
    controller.onServerState(RUNNING);
    seedPermission('per_1', 'ses_1');
    await controller.handle({
      type: 'permission.reply',
      requestId: 'r1',
      sessionID: 'ses_1',
      permissionID: 'per_1',
      decision: 'reject',
      message: "don't read secrets",
    });
    emit(streams, 'permission.replied', {
      sessionID: 'ses_1',
      requestID: 'per_1',
      reply: 'reject',
    });
    expect(posted.at(-1)).toMatchObject({ resolution: { withFeedback: true } });

    // A reply the server refused must not leave the flag behind for a later cascade.
    const failing = fakeApi({ replyError: { _tag: 'SomethingElse', message: 'nope' } });
    const second = setup(failing.api);
    second.controller.onServerState(RUNNING);
    second.seedPermission('per_2', 'ses_1');
    await second.controller.handle({
      type: 'permission.reply',
      requestId: 'r2',
      sessionID: 'ses_1',
      permissionID: 'per_2',
      decision: 'reject',
      message: 'will fail',
    });
    emit(second.streams, 'permission.replied', {
      sessionID: 'ses_1',
      requestID: 'per_2',
      reply: 'reject',
    });
    expect(second.posted.at(-1)).toMatchObject({ resolution: { withFeedback: false } });
  });

  it('flags withMessage for a form cancelled with a note', async () => {
    const { api } = fakeApi();
    const { controller, streams, posted, seedForm } = setup(api);
    controller.onServerState(RUNNING);
    seedForm('frm_1', 'ses_1');
    await controller.handle({
      type: 'form.cancel',
      requestId: 'c1',
      sessionID: 'ses_1',
      formID: 'frm_1',
      message: 'in my own words',
    });
    emit(streams, 'form.cancelled', { id: 'frm_1', sessionID: 'ses_1' });
    expect(posted.at(-1)).toMatchObject({
      type: 'form.resolved',
      outcome: 'cancelled',
      resolution: { withMessage: true },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// E4-session-management (issue #20). Fake client and hand-made events: they prove the controller's
// logic (what it asks `session.list`, what it forgets, who is asked before a delete), NOT the
// contract with the server; the HTTP wiring against a synthetic server is in
// `chatController.e2e.test.ts` and the real server's behaviour was only seen by the planner spike
// (opencode 2.0.32, Windows 11, 21/10/2026).
// ---------------------------------------------------------------------------------------------

/** The messages without the `connection.state` that `onServerState` posts first. */
const withoutConnection = (posted: HostToWebview[]): HostToWebview[] =>
  posted.filter((message) => message.type !== 'connection.state');

/** `count` rows ses_p0.. as a full page of the session list. */
const pageOf = (count: number, prefix = 'ses_p'): SessionInfo[] =>
  Array.from({ length: count }, (_, index) => sessionInfo(`${prefix}${String(index)}`));

describe('sessions.query (issue #20)', () => {
  it('asks for the first page of ROOT sessions of the folder and publishes it, mirrored', async () => {
    const { api, listInputs } = fakeApi({
      listImpl: () => Promise.resolve({ data: pageOf(2), cursor: { next: 'CUR1' } }),
    });
    const { controller, posted, streams, logs } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({
      type: 'sessions.query',
      requestId: 'q1',
      search: '  beta  ',
      more: false,
    });
    expect(listInputs).toEqual([
      { directory: 'C:\\work', order: 'desc', limit: 50, parentID: null, search: 'beta' },
    ]);
    const page = posted.find((m) => m.type === 'sessions.page');
    expect(page).toMatchObject({
      type: 'sessions.page',
      requestId: 'q1',
      append: false,
      hasMore: false, // 2 rows < 50: the cursor the server returns anyway does not mean "more"
    });
    expect(page?.type === 'sessions.page' && page.sessions.map((s) => s.id)).toEqual([
      'ses_p0',
      'ses_p1',
    ]);
    expect(posted.at(-1)).toEqual({ type: 'request.result', requestId: 'q1' });
    // Never the search text in the log.
    expect(logs).toContain('info: sessions page (2, more: false)');
    expect(logs.join('\n')).not.toContain('beta');

    // Mirrored: a rename of a row that only this page showed reaches the webview.
    emit(streams, 'session.renamed', { sessionID: 'ses_p1', title: 'Renamed elsewhere' });
    expect(posted.at(-1)).toMatchObject({
      type: 'session.upserted',
      session: { id: 'ses_p1', title: 'Renamed elsewhere' },
    });
  });

  it('continues with ONLY the stored cursor, and a full page says there may be more', async () => {
    const answers = [
      { data: pageOf(50), cursor: { next: 'CUR1' } },
      { data: pageOf(3, 'ses_q'), cursor: { next: 'CUR2' } },
    ];
    const { api, listInputs } = fakeApi({
      listImpl: () => Promise.resolve(answers.shift() ?? { data: [], cursor: {} }),
    });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'sessions.query', requestId: 'q1', search: '', more: false });
    await controller.handle({ type: 'sessions.query', requestId: 'q2', search: '', more: true });
    expect(listInputs[1]).toEqual({ cursor: 'CUR1' });
    const pages = posted.flatMap((m) => (m.type === 'sessions.page' ? [m] : []));
    expect(pages.map((p) => [p.requestId, p.append, p.hasMore])).toEqual([
      ['q1', false, true],
      ['q2', true, false], // CUR2 exists but 3 < 50: this was the last page
    ]);
    // The cursor itself never travels to the webview.
    expect(JSON.stringify(posted)).not.toContain('CUR1');
    expect(JSON.stringify(posted)).not.toContain('CUR2');
  });

  it('starts again when "more" arrives for another search, and after a refused cursor', async () => {
    let mode: 'ok' | 'bad' = 'ok';
    const { api, listInputs } = fakeApi({
      listImpl: () =>
        mode === 'ok'
          ? Promise.resolve({ data: pageOf(50), cursor: { next: 'CUR1' } })
          : // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            Promise.reject({ _tag: 'InvalidCursorError', message: 'bad cursor' }),
    });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'sessions.query', requestId: 'q1', search: 'a', more: false });
    await controller.handle({ type: 'sessions.query', requestId: 'q2', search: 'b', more: true });
    expect(listInputs[1]).toMatchObject({ search: 'b', limit: 50 }); // a new list, not the cursor
    mode = 'bad';
    await controller.handle({ type: 'sessions.query', requestId: 'q3', search: 'b', more: true });
    expect(posted.at(-1)).toMatchObject({
      type: 'request.result',
      requestId: 'q3',
      error: { code: 'InvalidCursorError' },
    });
    mode = 'ok';
    await controller.handle({ type: 'sessions.query', requestId: 'q4', search: 'b', more: true });
    expect(listInputs[3]).toMatchObject({ search: 'b', limit: 50 }); // the cursor was dropped
  });

  /**
   * Protects against the webview staying in "loading" for ever: if the server goes away while a
   * page is in flight, the page is dropped but the request must still be answered (review S3 of
   * E4-session-management). ALL DATA FABRICATED: the server change is forced from inside the fake
   * `session.list`; no real server was stopped mid-query.
   */
  it('answers ServerUnavailable, and publishes no page, when the server goes away mid-query', async () => {
    let stop: () => void = () => undefined;
    const { api } = fakeApi({
      listImpl: () => {
        stop();
        return Promise.resolve({ data: pageOf(2), cursor: {} });
      },
    });
    const { controller, posted } = setup(api);
    stop = () => {
      controller.onServerState({ kind: 'stopped' });
    };
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'sessions.query', requestId: 'q1', search: '', more: false });
    expect(posted.some((m) => m.type === 'sessions.page')).toBe(false);
    expect(posted.at(-1)).toMatchObject({
      type: 'request.result',
      requestId: 'q1',
      error: { code: 'ServerUnavailable' },
    });
  });

  it('answers ServerUnavailable without a server', async () => {
    const { controller, posted } = setup(fakeApi().api);
    await controller.handle({ type: 'sessions.query', requestId: 'q1', search: '', more: false });
    expect(posted).toMatchObject([
      { type: 'request.result', requestId: 'q1', error: { code: 'ServerUnavailable' } },
    ]);
  });
});

describe('session.rename (issue #20)', () => {
  it('sends the trimmed title and logs the id but not the title', async () => {
    const { api, updates } = fakeApi();
    const { controller, posted, logs } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({
      type: 'session.rename',
      requestId: 'r1',
      sessionID: 'ses_a',
      title: '  Secret plan  ',
    });
    expect(updates).toEqual([{ sessionID: 'ses_a', title: 'Secret plan' }]);
    expect(posted.at(-1)).toEqual({ type: 'request.result', requestId: 'r1' });
    expect(logs).toContain('info: session renamed ses_a');
    expect(logs.join('\n')).not.toContain('Secret plan');
  });

  it('refuses a blank or overlong title WITHOUT calling the server (a blank one runs the LLM)', async () => {
    const { api, updates } = fakeApi();
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    for (const title of ['   ', 'x'.repeat(201)]) {
      await controller.handle({
        type: 'session.rename',
        requestId: 'r1',
        sessionID: 'ses_a',
        title,
      });
      expect(posted.at(-1)).toMatchObject({
        type: 'request.result',
        error: { code: 'InvalidTitle' },
      });
    }
    expect(updates).toEqual([]);
  });

  it('reports a session that no longer exists as removed, besides the error', async () => {
    const { api } = fakeApi({
      updateError: { _tag: 'SessionNotFoundError', message: 'Session not found' },
    });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({
      type: 'session.rename',
      requestId: 'r1',
      sessionID: 'ses_gone',
      title: 'New',
    });
    expect(withoutConnection(posted)).toMatchObject([
      { type: 'session.removed', sessionID: 'ses_gone' },
      { type: 'request.result', requestId: 'r1', error: { code: 'SessionNotFoundError' } },
    ]);
  });
});

describe('session.delete (issue #20)', () => {
  it('asks the user first, with the title from the server and the running flag from active()', async () => {
    const { api, sessionRemoves, calls } = fakeApi({
      titles: { ses_a: 'Fix the build' },
      active: { ses_a: { type: 'running' } },
    });
    const { controller, confirmations, logs, posted } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'session.delete', requestId: 'r1', sessionID: 'ses_a' });
    expect(confirmations).toEqual([{ title: 'Fix the build', running: true }]);
    expect(calls.indexOf('session.get')).toBeLessThan(calls.indexOf('session.remove'));
    expect(sessionRemoves).toEqual([{ sessionID: 'ses_a' }]);
    expect(logs).toContain('info: session deleted ses_a');
    expect(posted.at(-1)).toEqual({ type: 'request.result', requestId: 'r1' });
  });

  it('does NOT delete when the user declines, and answers success', async () => {
    const { api, sessionRemoves } = fakeApi();
    const { controller, posted, logs } = setup(api, undefined, undefined, undefined, () =>
      Promise.resolve(false),
    );
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'session.delete', requestId: 'r1', sessionID: 'ses_a' });
    expect(sessionRemoves).toEqual([]);
    expect(posted.at(-1)).toEqual({ type: 'request.result', requestId: 'r1' });
    expect(logs).toContain('info: session delete cancelled ses_a');
  });

  it('reports a session that is already gone as removed, without asking anyone', async () => {
    const { api } = fakeApi({
      getError: { _tag: 'SessionNotFoundError', message: 'Session not found' },
    });
    const { controller, posted, confirmations } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'session.delete', requestId: 'r1', sessionID: 'ses_gone' });
    expect(confirmations).toEqual([]);
    expect(withoutConnection(posted)).toMatchObject([
      { type: 'session.removed', sessionID: 'ses_gone' },
      { type: 'request.result', requestId: 'r1', error: { code: 'SessionNotFoundError' } },
    ]);
  });

  it('a failed delete is an error result and leaves the open session alone', async () => {
    const { api } = fakeApi({
      sessionRemoveError: { _tag: 'UnexpectedStatus', message: 'boom' },
      sessions: ['ses_open'],
    });
    const { controller, posted, memoryWrites } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'session.delete', requestId: 'r1', sessionID: 'ses_open' });
    expect(posted.at(-1)).toMatchObject({
      type: 'request.result',
      error: { code: 'UnexpectedStatus' },
    });
    expect(memoryWrites).toEqual([]);
  });
});

describe('the open session being deleted (issue #20)', () => {
  const settle = async () => {
    await flush();
  };

  it('forgets it, memory included, and the next prompt creates a session instead of using the dead one', async () => {
    const { api, calls, prompts } = fakeApi({ sessions: ['ses_open'] });
    const { controller, posted, streams, memoryWrites, logs } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.resync();
    emit(streams, 'session.deleted', { sessionID: 'ses_open' });
    await settle();
    expect(posted.at(-2)).toEqual({ type: 'session.removed', sessionID: 'ses_open' });
    expect(memoryWrites).toEqual([{ folder: SERVER.folder, id: undefined }]);
    expect(logs).toContain('info: open session deleted ses_open');

    await controller.handle({
      type: 'prompt.send',
      requestId: 'p1',
      text: 'hi',
      delivery: 'queue',
      files: [],
    });
    expect(calls).toContain('session.create');
    expect(prompts.map((p) => p.sessionID)).toEqual(['ses_new']);
  });

  it('tells the user when ANOTHER client deleted it, and stays quiet about our own delete', async () => {
    // Elsewhere: only the event.
    const elsewhere = setup(fakeApi({ sessions: ['ses_open'] }).api, 'ses_open');
    elsewhere.controller.onServerState(RUNNING);
    await elsewhere.controller.resync();
    emit(elsewhere.streams, 'session.deleted', { sessionID: 'ses_open' });
    expect(elsewhere.posted).toContainEqual({
      type: 'notice',
      level: 'info',
      error: { code: 'SessionDeleted', message: 'The open session was deleted outside this view' },
    });

    // Ours: the server publishes the event BEFORE the HTTP answer (planner spike, same millisecond).
    const own = setup(
      fakeApi({
        sessions: ['ses_open'],
        removeImpl: ({ sessionID }) => {
          emit(own.streams, 'session.deleted', { sessionID });
          return Promise.resolve();
        },
      }).api,
      'ses_open',
    );
    own.controller.onServerState(RUNNING);
    await own.controller.resync();
    await own.controller.handle({ type: 'session.delete', requestId: 'r1', sessionID: 'ses_open' });
    expect(own.posted.some((m) => m.type === 'notice')).toBe(false);
    expect(own.posted.filter((m) => m.type === 'session.removed')).not.toHaveLength(0);
    expect(own.memoryWrites).toEqual([{ folder: SERVER.folder, id: undefined }]);
  });

  /**
   * Protects `resync` (review W1 of E4-session-management): the open session is deleted WHILE
   * `message.list` is in flight and the server answered before deleting. The snapshot must not
   * bring the dead session back: no `open`, no row for it, and the next prompt creates a session.
   * ALL DATA FABRICATED: the deletion is emitted from inside the fake `message.list`; whether a
   * real server interleaves like this is UNVERIFIED (the window is narrow and was not reproduced).
   */
  it('publishes no open session, nor its row, when it is deleted while its messages are being read', async () => {
    let remove: () => void = () => undefined;
    const { api, prompts } = fakeApi({
      sessions: ['ses_open', 'ses_other'],
      messageListImpl: () => {
        remove();
        return Promise.resolve({ data: [], cursor: {} });
      },
    });
    const { controller, streams, snapshots } = setup(api, 'ses_open');
    remove = () => {
      emit(streams, 'session.deleted', { sessionID: 'ses_open' });
    };
    controller.onServerState(RUNNING);
    await controller.resync();
    const snapshot = snapshots().at(-1);
    expect(snapshot?.open).toBeUndefined();
    expect(snapshot?.sessions.map((row) => row.id)).toEqual(['ses_other']);

    await controller.handle({
      type: 'prompt.send',
      requestId: 'p1',
      text: 'hi',
      delivery: 'queue',
      files: [],
    });
    expect(prompts.map((p) => p.sessionID)).toEqual(['ses_new']);
  });

  it('does not touch the open session when ANOTHER session is deleted', async () => {
    const { api } = fakeApi({ sessions: ['ses_open', 'ses_other'] });
    const { controller, posted, streams, memoryWrites } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.resync();
    emit(streams, 'session.deleted', { sessionID: 'ses_other' });
    expect(memoryWrites).toEqual([]);
    expect(posted.some((m) => m.type === 'notice')).toBe(false);
  });

  it('drops the pending requests of the deleted session (nothing replies to them)', async () => {
    const { api } = fakeApi({ sessions: ['ses_open'] });
    const { controller, streams, attentionCalls, seedPermission, seedForm } = setup(
      api,
      'ses_open',
    );
    controller.onServerState(RUNNING);
    await controller.resync();
    seedPermission('per_1', 'ses_open');
    seedPermission('per_2', 'ses_other');
    seedForm('frm_1', 'ses_open');
    expect(lastAttention(attentionCalls)).toEqual(['per_1', 'per_2', 'frm_1']);
    emit(streams, 'session.deleted', { sessionID: 'ses_open' });
    expect(lastAttention(attentionCalls)).toEqual(['per_2']);
  });
});

describe('session.new is lazy (issue #20)', () => {
  it('creates nothing on the server: forgets the open session and publishes a snapshot without one', async () => {
    const { api, calls } = fakeApi({ sessions: ['ses_open'] });
    const { controller, snapshots, memoryWrites, posted } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(snapshots().at(-1)?.open?.sessionID).toBe('ses_open');
    await controller.handle({ type: 'session.new', requestId: 'n1' });
    expect(calls).not.toContain('session.create');
    expect(memoryWrites).toEqual([{ folder: SERVER.folder, id: undefined }]);
    expect(snapshots().at(-1)?.open).toBeUndefined();
    expect(posted.at(-1)).toEqual({ type: 'request.result', requestId: 'n1' });
  });

  it('the first prompt then creates the session through the usual path', async () => {
    const { api, calls, prompts } = fakeApi({ sessions: ['ses_open'] });
    const { controller, snapshots } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'session.new', requestId: 'n1' });
    await controller.handle({
      type: 'prompt.send',
      requestId: 'p1',
      text: 'hello',
      delivery: 'queue',
      files: [],
    });
    expect(calls.filter((call) => call === 'session.create')).toHaveLength(1);
    expect(prompts).toEqual([{ sessionID: 'ses_new', text: 'hello', delivery: 'queue' }]);
    expect(snapshots().at(-1)?.open?.sessionID).toBe('ses_new');
  });

  it('answers ServerUnavailable without a server', async () => {
    const { controller, posted } = setup(fakeApi().api);
    await controller.handle({ type: 'session.new', requestId: 'n1' });
    expect(posted).toMatchObject([
      { type: 'request.result', requestId: 'n1', error: { code: 'ServerUnavailable' } },
    ]);
  });
});

describe('the open session row (issue #20)', () => {
  it('adds the row of an open session older than the 50 newest, so the header can name it', async () => {
    const { api } = fakeApi({ sessions: ['ses_new1'], titles: { ses_ancient: 'Old but gold' } });
    const { controller, snapshots } = setup(api, 'ses_ancient');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(
      snapshots()
        .at(-1)
        ?.sessions.map((s) => [s.id, s.title]),
    ).toEqual([
      ['ses_new1', undefined],
      ['ses_ancient', 'Old but gold'],
    ]);
  });

  it('a session.open of a row that no longer exists is also reported as removed', async () => {
    const { api } = fakeApi({
      getError: { _tag: 'SessionNotFoundError', message: 'Session not found' },
    });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'session.open', requestId: 'o1', sessionID: 'ses_gone' });
    expect(withoutConnection(posted)).toMatchObject([
      { type: 'session.removed', sessionID: 'ses_gone' },
      { type: 'request.result', requestId: 'o1', error: { code: 'SessionNotFoundError' } },
    ]);
  });
});

// Issue #21 (E4-fork-subsessions). The fake client answers with hand-made rows shaped like the
// ones the planner spike saw in a real opencode 2.0.32 (Windows 11, 21/10/2026): a fork is a ROOT
// row with `fork.sessionID`, a subagent child has `parentID`. These tests pin the controller's
// coordination; the contract with the server is the spike's, and the HTTP wiring is covered by
// `chatController.e2e.test.ts` against the synthetic server.

/** A session row with extra wire fields (`parentID`, `fork`, `title`) merged into the default. */
const rowWith = (id: string, extra: object): SessionInfo =>
  wire<SessionInfo>(JSON.stringify({ ...sessionInfo(id), ...extra }));

/** Rejects like the real client does: with the server's error body, not an Error. */
const reject = (body: object): Promise<never> =>
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
  Promise.reject(body);

const forkBoundary = { type: 'before', messageID: 'msg_2' };

describe('session.fork (issue #21)', () => {
  it('forks before the message, publishes the row, then opens the new session', async () => {
    const { api, forks } = fakeApi({
      forkImpl: () =>
        Promise.resolve(
          rowWith('ses_fork', { fork: { sessionID: 'ses_1', boundary: forkBoundary } }),
        ),
    });
    const { controller, posted, memoryWrites, logs } = setup(api, 'ses_1');
    controller.onServerState(RUNNING);
    await controller.handle({
      type: 'session.fork',
      requestId: 'f1',
      sessionID: 'ses_1',
      messageID: 'msg_2',
    });
    expect(forks).toEqual([{ sessionID: 'ses_1', before: 'msg_2' }]);
    const sent = withoutConnection(posted);
    expect(sent.map((m) => m.type)).toEqual(['session.upserted', 'snapshot', 'request.result']);
    expect(sent[0]).toMatchObject({ session: { id: 'ses_fork', forkOf: 'ses_1' } });
    expect(sent[1]).toMatchObject({ snapshot: { open: { sessionID: 'ses_fork' } } });
    expect(sent[2]).toEqual({ type: 'request.result', requestId: 'f1' });
    expect(memoryWrites).toEqual([{ folder: SERVER.folder, id: 'ses_fork' }]);
    expect(logs).toContain('info: session forked ses_1 -> ses_fork');
  });

  it('keeps the open session, and answers the error, when the message does not exist', async () => {
    const { api } = fakeApi({
      forkImpl: () => reject({ _tag: 'MessageNotFoundError', message: 'Message not found' }),
    });
    const { controller, posted, memoryWrites } = setup(api, 'ses_1');
    controller.onServerState(RUNNING);
    await controller.handle({
      type: 'session.fork',
      requestId: 'f1',
      sessionID: 'ses_1',
      messageID: 'msg_gone',
    });
    expect(withoutConnection(posted)).toMatchObject([
      { type: 'request.result', requestId: 'f1', error: { code: 'MessageNotFoundError' } },
    ]);
    expect(memoryWrites).toEqual([]);
  });

  it('also reports the source session as removed when the server says it is gone', async () => {
    const { api } = fakeApi({
      forkImpl: () => reject({ _tag: 'SessionNotFoundError', message: 'Session not found' }),
    });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({
      type: 'session.fork',
      requestId: 'f1',
      sessionID: 'ses_gone',
      messageID: 'msg_1',
    });
    expect(withoutConnection(posted)).toMatchObject([
      { type: 'session.removed', sessionID: 'ses_gone' },
      { type: 'request.result', requestId: 'f1', error: { code: 'SessionNotFoundError' } },
    ]);
  });

  it('answers ServerUnavailable without a server, and when the server changed meanwhile', async () => {
    const idle = setup(fakeApi().api);
    await idle.controller.handle({
      type: 'session.fork',
      requestId: 'f1',
      sessionID: 'ses_1',
      messageID: 'msg_1',
    });
    expect(idle.posted).toMatchObject([
      { type: 'request.result', requestId: 'f1', error: { code: 'ServerUnavailable' } },
    ]);

    let release: (info: SessionInfo) => void = () => undefined;
    const slow = setup(
      fakeApi({
        forkImpl: () =>
          new Promise<SessionInfo>((resolve) => {
            release = resolve;
          }),
      }).api,
      'ses_1',
    );
    slow.controller.onServerState(RUNNING);
    const pending = slow.controller.handle({
      type: 'session.fork',
      requestId: 'f2',
      sessionID: 'ses_1',
      messageID: 'msg_1',
    });
    slow.controller.onServerState({ kind: 'stopped' });
    release(sessionInfo('ses_fork'));
    await pending;
    expect(slow.posted.some((m) => m.type === 'session.upserted')).toBe(false);
    expect(slow.posted.at(-1)).toMatchObject({
      type: 'request.result',
      requestId: 'f2',
      error: { code: 'ServerUnavailable' },
    });
  });

  it('reads and publishes the row of a fork made by another client (session.forked has no title)', async () => {
    const { api, calls } = fakeApi({
      getImpl: (id) =>
        Promise.resolve(
          rowWith(id, {
            title: 'Chat (fork #1)',
            fork: { sessionID: 'ses_1', boundary: forkBoundary },
          }),
        ),
    });
    const { controller, posted, streams } = setup(api);
    controller.onServerState(RUNNING);
    emit(streams, 'session.forked', {
      sessionID: 'ses_fork',
      parentID: 'ses_1',
      boundary: forkBoundary,
    });
    await flush();
    expect(calls).toContain('session.get');
    expect(posted).toContainEqual({
      type: 'session.upserted',
      session: {
        id: 'ses_fork',
        title: 'Chat (fork #1)',
        forkOf: 'ses_1',
        createdAt: 1,
        updatedAt: 2,
      },
    });
  });

  /**
   * Protects review S2 of #21: a `session.deleted` that lands while the row of a bare
   * `session.forked` is being read must win over the late answer. SYNTHETIC: ordering forced
   * with a deferred `session.get`.
   */
  it('does not republish the row of a forked session deleted while it was being read', async () => {
    let answer: (row: SessionInfo) => void = () => undefined;
    const { api } = fakeApi({
      getImpl: (id) =>
        new Promise<SessionInfo>((resolve) => {
          answer = () => {
            resolve(rowWith(id, { title: 'Chat (fork #1)' }));
          };
        }),
    });
    const { controller, posted, streams } = setup(api);
    controller.onServerState(RUNNING);
    emit(streams, 'session.forked', {
      sessionID: 'ses_fork',
      parentID: 'ses_1',
      boundary: forkBoundary,
    });
    await flush();
    emit(streams, 'session.deleted', { sessionID: 'ses_fork' });
    answer(sessionInfo('ses_fork'));
    await flush();
    expect(posted.some((m) => m.type === 'session.upserted')).toBe(false);
  });

  it('ignores a forked session that is already gone, and survives other read failures', async () => {
    const gone = setup(
      fakeApi({ getError: { _tag: 'SessionNotFoundError', message: 'nope' } }).api,
    );
    gone.controller.onServerState(RUNNING);
    emit(gone.streams, 'session.forked', {
      sessionID: 'ses_fork',
      parentID: 'ses_1',
      boundary: forkBoundary,
    });
    await flush();
    expect(gone.posted.some((m) => m.type === 'session.upserted' || m.type === 'notice')).toBe(
      false,
    );

    const broken = setup(fakeApi({ getError: { _tag: 'Transport', message: 'down' } }).api);
    broken.controller.onServerState(RUNNING);
    emit(broken.streams, 'session.forked', {
      sessionID: 'ses_fork',
      parentID: 'ses_1',
      boundary: forkBoundary,
    });
    await flush();
    expect(
      broken.logs.some((l) => l.startsWith('warn: could not read forked session ses_fork')),
    ).toBe(true);
  });
});

describe('the lineage of the open session (issue #21)', () => {
  it('adds the children, the parent and nothing twice', async () => {
    const { api, childListInputs } = fakeApi({
      sessions: ['ses_other'],
      children: [
        rowWith('ses_kid1', { parentID: 'ses_open' }),
        rowWith('ses_kid2', { parentID: 'ses_open' }),
      ],
      getImpl: (id) =>
        Promise.resolve(
          id === 'ses_open' ? rowWith(id, { parentID: 'ses_parent' }) : sessionInfo(id),
        ),
    });
    const { controller, snapshots } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(
      snapshots()
        .at(-1)
        ?.sessions.map((s) => s.id),
    ).toEqual(['ses_other', 'ses_open', 'ses_kid1', 'ses_kid2', 'ses_parent']);
    expect(childListInputs).toEqual([
      { directory: SERVER.folder, parentID: 'ses_open', order: 'desc', limit: 50 },
    ]);
  });

  it('adds the original of an open fork', async () => {
    const { api } = fakeApi({
      getImpl: (id) =>
        Promise.resolve(
          id === 'ses_fork'
            ? rowWith(id, { fork: { sessionID: 'ses_orig', boundary: forkBoundary } })
            : rowWith(id, { title: 'Original' }),
        ),
    });
    const { controller, snapshots } = setup(api, 'ses_fork');
    controller.onServerState(RUNNING);
    await controller.resync();
    const rows = snapshots().at(-1)?.sessions ?? [];
    expect(rows.map((s) => [s.id, s.forkOf, s.title])).toEqual([
      ['ses_fork', 'ses_orig', undefined],
      ['ses_orig', undefined, 'Original'],
    ]);
  });

  it('does not look the parent up again when it is already among the newest rows', async () => {
    const { api, calls } = fakeApi({
      listImpl: () =>
        Promise.resolve({
          data: [rowWith('ses_parent', {}), rowWith('ses_open', { parentID: 'ses_parent' })],
          cursor: {},
        }),
    });
    const { controller } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(calls).not.toContain('session.get');
  });

  it('still sends the snapshot when the parent read fails', async () => {
    const { api } = fakeApi({
      listImpl: () =>
        Promise.resolve({
          data: [rowWith('ses_open', { parentID: 'ses_parent' })],
          cursor: {},
        }),
      getImpl: () => reject({ _tag: 'SessionNotFoundError', message: 'gone' }),
    });
    const { controller, snapshots } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(
      snapshots()
        .at(-1)
        ?.sessions.map((s) => s.id),
    ).toEqual(['ses_open']);
    expect(snapshots().at(-1)?.open?.sessionID).toBe('ses_open');
  });

  /**
   * Protects the plan's promise that a failing children list never costs the snapshot (review W3
   * of #21). SYNTHETIC: the failure is injected by the fake client, not seen on a real server.
   */
  it('still sends the snapshot when the children list fails', async () => {
    const { api, calls } = fakeApi({
      sessions: ['ses_open'],
      childrenError: { _tag: 'Transport', message: 'down' },
    });
    const { controller, snapshots, logs } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(calls).toContain('session.list.children');
    expect(snapshots().at(-1)?.open?.sessionID).toBe('ses_open');
    expect(
      snapshots()
        .at(-1)
        ?.sessions.map((s) => s.id),
    ).toEqual(['ses_open']);
    expect(logs.some((l) => l.startsWith('debug: could not read the children'))).toBe(true);
  });

  /**
   * Protects the fault tolerance of the parent/original reads (review S3): both rows arrive, and
   * one failing read does not lose the other. It does NOT prove the reads run in parallel (it
   * passes with sequential awaits too; review E4-fork-subsessions/review-2). SYNTHETIC fake client.
   */
  it('reads the parent and the original together and keeps the one that worked', async () => {
    const { api } = fakeApi({
      listImpl: () =>
        Promise.resolve({
          data: [
            rowWith('ses_open', {
              parentID: 'ses_parent',
              fork: { sessionID: 'ses_orig', boundary: forkBoundary },
            }),
          ],
          cursor: {},
        }),
      getImpl: (id) =>
        id === 'ses_parent'
          ? reject({ _tag: 'SessionNotFoundError', message: 'gone' })
          : Promise.resolve(rowWith(id, { title: 'Original' })),
    });
    const { controller, snapshots } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(
      snapshots()
        .at(-1)
        ?.sessions.map((s) => s.id),
    ).toEqual(['ses_open', 'ses_orig']);
  });

  it('asks for no children when no session is open', async () => {
    const { api, calls } = fakeApi({ sessions: ['ses_a'] });
    const { controller } = setup(api);
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(calls).not.toContain('session.list.children');
  });
});

/**
 * Issues #23/#24 (E5-model-agent-selectors): the catalog and the choice of model and agent.
 *
 * Protects against: a snapshot that waits for a slow `model.list`; a burst of reload events that
 * costs a load each; a failed load that wipes the catalog the selectors hold; a model or agent that
 * the server never validated reaching `switchModel` / `switchAgent` (the server accepts anything
 * and fails the NEXT turn, VERIFIED in the planner spike, opencode 2.0.32, Windows 11,
 * 21/10/2026, so the HOST must check); `switchAgent` called when the agent did not change (it does
 * not deduplicate and `plan` injects a reminder); a prompt sent after a failed switch (it would be
 * redelivered with the next good run); and the precedence setting > last used > server default.
 * SYNTHETIC: a fake client with hand-made `ModelInfo` / `AgentInfo` in the shapes the spike saw.
 */
describe('catalog and selection (issues #23/#24)', () => {
  const GLM = { providerID: 'opencode', id: 'glm-5.3-flash-free' };
  const PICKLE = { providerID: 'opencode', id: 'big-pickle' };
  type PromptSend = Extract<WebviewToHost, { type: 'prompt.send' }>;
  const send = (extra: Partial<PromptSend> = {}): PromptSend => ({
    type: 'prompt.send',
    requestId: 'r1',
    text: 'hi',
    delivery: 'queue',
    files: [],
    ...extra,
  });
  const catalogs = (posted: HostToWebview[]) =>
    posted.flatMap((m) => (m.type === 'catalog' ? [m.catalog] : []));
  /** The last `request.result`: a refused send also reloads the catalog, which posts after it. */
  const lastResult = (posted: HostToWebview[]) =>
    posted.filter((m) => m.type === 'request.result').at(-1);
  /** A client whose `model.list` stays pending until `release()` is called. */
  const slowModels = () => {
    const fake = fakeApi();
    let release: () => void = () => undefined;
    const api: ChatApi = {
      ...fake.api,
      model: {
        ...fake.api.model,
        list: () =>
          new Promise((resolve) => {
            release = () => {
              resolve({ location: LOCATION, data: DEFAULT_MODELS });
            };
          }),
      },
    };
    return { api, release: () => release() };
  };

  it('publishes the catalog on server.connected', async () => {
    const { api, calls } = fakeApi();
    const { controller, posted, streams, logs } = setup(api);
    controller.onServerState(RUNNING);
    emit(streams, 'server.connected', {});
    await flush();
    await flush();
    expect(calls).toEqual(
      expect.arrayContaining(['model.list', 'provider.list', 'agent.list', 'model.default']),
    );
    const [catalog] = catalogs(posted);
    expect(catalog?.models.map((m) => m.id)).toEqual(['big-pickle', 'glm-5.3-flash-free']);
    expect(catalog?.models[0]).toMatchObject({
      free: true,
      status: 'active',
      contextLimit: 200000,
    });
    expect(catalog?.providers).toEqual([{ id: 'opencode', name: 'OpenCode' }]);
    expect(catalog?.agents.map((a) => a.id)).toEqual(['build', 'plan']);
    expect(catalog?.defaultAgent).toBe('build');
    expect(catalog?.serverDefault).toEqual(PICKLE);
    expect(catalog?.preferredModel).toBeUndefined();
    expect(logs).toContain('info: catalog loaded (2 models, 2 agents)');
  });

  it('does not make the snapshot wait for a slow model.list', async () => {
    const { api, release } = slowModels();
    const { controller, snapshots, streams, posted } = setup(api);
    controller.onServerState(RUNNING);
    emit(streams, 'server.connected', {});
    await flush();
    await flush();
    expect(snapshots()).toHaveLength(1);
    expect(catalogs(posted)).toHaveLength(0);
    release();
    await flush();
    await flush();
    expect(catalogs(posted)).toHaveLength(1);
  });

  it('coalesces a burst of reload events into at most two loads', async () => {
    const { api, calls } = fakeApi();
    const { controller, streams, posted } = setup(api);
    controller.onServerState(RUNNING);
    for (const type of [
      'model.updated',
      'provider.updated',
      'agent.updated',
      'integration.updated',
      'credential.updated',
      'config.updated',
    ]) {
      emit(streams, type, {});
    }
    await flush();
    await flush();
    await flush();
    const loads = calls.filter((c) => c === 'model.list').length;
    expect(loads).toBeGreaterThanOrEqual(1);
    expect(loads).toBeLessThanOrEqual(2);
    expect(catalogs(posted).length).toBe(loads);
  });

  it('keeps the previous catalog, warns and shows no notice when a reload fails', async () => {
    const good = fakeApi();
    let failNext = false;
    const flaky: ChatApi = {
      ...good.api,
      model: {
        ...good.api.model,
        list: (input) =>
          failNext
            ? // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
              Promise.reject({ _tag: 'ServerError', message: 'boom' })
            : good.api.model.list(input),
      },
    };
    const { controller, posted, logs, streams } = setup(flaky);
    controller.onServerState(RUNNING);
    emit(streams, 'model.updated', {});
    await flush();
    await flush();
    expect(catalogs(posted)).toHaveLength(1);
    failNext = true;
    emit(streams, 'model.updated', {});
    await flush();
    await flush();
    expect(catalogs(posted)).toHaveLength(1);
    expect(logs.some((l) => l.startsWith('warn: catalog load failed: ServerError'))).toBe(true);
    expect(posted.some((m) => m.type === 'notice')).toBe(false);
    // The held catalog still serves a send that carries a model.
    failNext = false;
    await controller.handle(send({ model: GLM }));
    expect(good.calls).toContain('session.prompt');
  });

  it('republishes the catalog AFTER the snapshot on ready', async () => {
    const { api } = fakeApi();
    const { controller, posted, streams } = setup(api);
    controller.onServerState(RUNNING);
    emit(streams, 'model.updated', {});
    await flush();
    await flush();
    posted.length = 0;
    await controller.onWebviewReady();
    const types = posted.map((m) => m.type);
    expect(types.indexOf('catalog')).toBeGreaterThan(types.indexOf('snapshot'));
  });

  it('drops a load that finishes after the server went away', async () => {
    const { api, release } = slowModels();
    const { controller, posted, streams } = setup(api);
    controller.onServerState(RUNNING);
    emit(streams, 'model.updated', {});
    await flush();
    controller.onServerState({ kind: 'stopped' });
    release();
    await flush();
    await flush();
    expect(catalogs(posted)).toHaveLength(0);
  });

  describe('which model a new session proposes', () => {
    const loaded = async (configure: (p: ReturnType<typeof setup>['prefs']) => void) => {
      const fake = fakeApi();
      const harness = setup(fake.api);
      configure(harness.prefs);
      harness.controller.onServerState(RUNNING);
      emit(harness.streams, 'model.updated', {});
      await flush();
      await flush();
      return { ...harness, ...fake };
    };

    it('the setting wins over the last used model', async () => {
      const { posted } = await loaded((p) => {
        p.setting = 'opencode/big-pickle';
        p.last = GLM;
      });
      expect(catalogs(posted).at(-1)?.preferredModel).toEqual(PICKLE);
    });

    it('without a setting the last used model applies', async () => {
      const { posted } = await loaded((p) => {
        p.last = GLM;
      });
      expect(catalogs(posted).at(-1)?.preferredModel).toEqual(GLM);
    });

    it('a setting the server does not offer is ignored: one warn line and one notice per value', async () => {
      const { controller, posted, logs, prefs } = await loaded((p) => {
        p.setting = 'opencode/nope';
        p.last = GLM;
      });
      expect(catalogs(posted).at(-1)?.preferredModel).toEqual(GLM);
      expect(logs).toContain('warn: default model setting ignored: unavailable');
      expect(posted.filter((m) => m.type === 'notice')).toHaveLength(1);
      controller.onPreferencesChanged();
      expect(posted.filter((m) => m.type === 'notice')).toHaveLength(1);
      prefs.setting = 'opencode/other';
      controller.onPreferencesChanged();
      expect(posted.filter((m) => m.type === 'notice')).toHaveLength(2);
      expect(logs.join('\n')).not.toContain('opencode/nope');
    });

    it('a change of the setting republishes the catalog with no REST call', async () => {
      const { controller, posted, prefs, calls } = await loaded(() => undefined);
      const before = calls.length;
      prefs.setting = 'opencode/glm-5.3-flash-free';
      controller.onPreferencesChanged();
      expect(calls.length).toBe(before);
      expect(catalogs(posted).at(-1)?.preferredModel).toEqual(GLM);
    });

    it('does nothing without a catalog', () => {
      const { api } = fakeApi();
      const { controller, posted } = setup(api);
      controller.onPreferencesChanged();
      expect(posted).toEqual([]);
    });
  });

  describe('prompt.send with a model and an agent', () => {
    it('creates a NEW session with both and calls no switch', async () => {
      const { api, creates, switches, calls } = fakeApi();
      const { controller, logs } = setup(api);
      controller.onServerState(RUNNING);
      await controller.handle(send({ model: GLM, agent: 'plan' }));
      expect(creates).toEqual([{ agent: 'plan', model: GLM }]);
      expect(switches).toEqual([]);
      expect(calls).toContain('session.prompt');
      expect(logs).toContain('info: agent selected plan for ses_new');
      expect(logs).toContain('info: model selected opencode/glm-5.3-flash-free for ses_new');
    });

    it('creates a new session with no fields when the webview sends neither', async () => {
      const { api, creates } = fakeApi();
      const { controller } = setup(api);
      controller.onServerState(RUNNING);
      await controller.handle(send());
      expect(creates).toEqual([{}]);
    });

    it('an existing session on the same agent and model: get, no switch, then the prompt', async () => {
      const { api, calls, switches } = fakeApi({
        sessions: ['ses_old'],
        sessionSelection: { agent: 'plan', model: { ...GLM, variant: 'default' } },
      });
      const { controller } = setup(api, 'ses_old');
      controller.onServerState(RUNNING);
      calls.length = 0;
      await controller.handle(send({ sessionID: 'ses_old', model: GLM, agent: 'plan' }));
      expect(switches).toEqual([]);
      expect(calls).toContain('session.get');
      expect(calls).toContain('session.prompt');
    });

    // Decision of Sergio (21/10/2026, review #1015 W1): a choice is PINNED. The server default here
    // (PICKLE / build) equals the choice, and the session still stores nothing, so both switches go.
    // Reverts the first design, which compared with the catalog default and skipped them.
    it('a session with nothing stored is PINNED even when the choice equals the server default', async () => {
      const { api, switches, calls } = fakeApi({ sessions: ['ses_old'] });
      const { controller } = setup(api, 'ses_old');
      controller.onServerState(RUNNING);
      calls.length = 0;
      await controller.handle(send({ sessionID: 'ses_old', model: PICKLE, agent: 'build' }));
      expect(switches).toEqual(['agent:build', 'model:opencode/big-pickle']);
      expect(calls.filter((c) => c === 'session.prompt' || c.startsWith('session.switch'))).toEqual(
        ['session.switchAgent', 'session.switchModel', 'session.prompt'],
      );
    });

    it('a session that stores only the model still gets the agent switch', async () => {
      const { api, switches } = fakeApi({
        sessions: ['ses_old'],
        sessionSelection: { model: PICKLE },
      });
      const { controller } = setup(api, 'ses_old');
      controller.onServerState(RUNNING);
      await controller.handle(send({ sessionID: 'ses_old', model: PICKLE, agent: 'build' }));
      expect(switches).toEqual(['agent:build']);
    });

    it('a different agent switches the agent BEFORE the model, both BEFORE the prompt', async () => {
      const { api, calls, switches } = fakeApi({
        sessions: ['ses_old'],
        sessionSelection: { agent: 'build', model: PICKLE },
      });
      const { controller, logs } = setup(api, 'ses_old');
      controller.onServerState(RUNNING);
      calls.length = 0;
      await controller.handle(send({ sessionID: 'ses_old', model: GLM, agent: 'plan' }));
      expect(switches).toEqual(['agent:plan', 'model:opencode/glm-5.3-flash-free']);
      expect(calls.filter((c) => c === 'session.prompt' || c.startsWith('session.switch'))).toEqual(
        ['session.switchAgent', 'session.switchModel', 'session.prompt'],
      );
      expect(logs).toContain('info: agent selected plan for ses_old');
      expect(logs).toContain('info: model selected opencode/glm-5.3-flash-free for ses_old');
    });

    it('a different variant counts as a different model', async () => {
      const { api, switches } = fakeApi({
        sessions: ['ses_old'],
        sessionSelection: { model: GLM },
      });
      const { controller } = setup(api, 'ses_old');
      controller.onServerState(RUNNING);
      await controller.handle(send({ sessionID: 'ses_old', model: { ...GLM, variant: 'high' } }));
      expect(switches).toEqual(['model:opencode/glm-5.3-flash-free@high']);
    });

    it('refuses a model the catalog does not list: ModelUnavailable, no server call, catalog reloaded', async () => {
      const { api, calls, switches, creates } = fakeApi();
      const { controller, posted } = setup(api);
      controller.onServerState(RUNNING);
      await controller.handle(send({ model: { providerID: 'opencode', id: 'nope' } }));
      expect(lastResult(posted)).toMatchObject({
        type: 'request.result',
        requestId: 'r1',
        error: { code: 'ModelUnavailable' },
      });
      expect(creates).toEqual([]);
      expect(switches).toEqual([]);
      expect(calls).not.toContain('session.prompt');
      await flush();
      await flush();
      expect(calls.filter((c) => c === 'model.list')).toHaveLength(2);
    });

    it('refuses a variant the model does not list', async () => {
      const { api, calls } = fakeApi();
      const { controller, posted } = setup(api);
      controller.onServerState(RUNNING);
      await controller.handle(send({ model: { ...GLM, variant: 'ultra' } }));
      expect(lastResult(posted)).toMatchObject({ error: { code: 'ModelUnavailable' } });
      expect(calls).not.toContain('session.prompt');
    });

    it('refuses a hidden or subagent agent: AgentUnavailable', async () => {
      const { api, calls } = fakeApi();
      const { controller, posted } = setup(api);
      controller.onServerState(RUNNING);
      for (const agent of ['title', 'general', 'nope']) {
        await controller.handle(send({ agent }));
        expect(lastResult(posted)).toMatchObject({ error: { code: 'AgentUnavailable' } });
      }
      expect(calls).not.toContain('session.prompt');
      expect(calls).not.toContain('session.create');
    });

    it('answers CatalogUnavailable when there is no catalog and loading it fails', async () => {
      const { api, calls } = fakeApi({ catalogError: { _tag: 'ServerError', message: 'down' } });
      const { controller, posted } = setup(api);
      controller.onServerState(RUNNING);
      await controller.handle(send({ model: GLM }));
      expect(posted.at(-1)).toMatchObject({ error: { code: 'CatalogUnavailable' } });
      expect(calls).not.toContain('session.prompt');
    });

    it('loads the catalog first when there is none', async () => {
      const { api, calls } = fakeApi();
      const { controller } = setup(api);
      controller.onServerState(RUNNING);
      await controller.handle(send({ model: GLM }));
      expect(calls.indexOf('model.list')).toBeLessThan(calls.indexOf('session.prompt'));
    });

    it('a failing switch answers the error and sends NO prompt', async () => {
      const { api, calls } = fakeApi({
        sessions: ['ses_old'],
        sessionSelection: { agent: 'build' },
        switchError: { _tag: 'SessionNotFoundError', message: 'gone' },
      });
      const { controller, posted } = setup(api, 'ses_old');
      controller.onServerState(RUNNING);
      await controller.handle(send({ sessionID: 'ses_old', agent: 'plan' }));
      expect(posted.at(-1)).toMatchObject({ error: { code: 'SessionNotFoundError' } });
      expect(calls).not.toContain('session.prompt');
    });

    it('without model or agent an existing session is left alone (no switch, no catalog)', async () => {
      const { api, calls } = fakeApi({ sessions: ['ses_old'] });
      const { controller } = setup(api, 'ses_old');
      controller.onServerState(RUNNING);
      calls.length = 0;
      await controller.handle(send({ sessionID: 'ses_old' }));
      expect(calls).not.toContain('session.switchModel');
      expect(calls).not.toContain('session.switchAgent');
      expect(calls).not.toContain('model.list');
    });

    it('remembers the model only after the prompt is accepted, and republishes the catalog', async () => {
      const failingApi = fakeApi({ promptImpl: () => Promise.reject(new Error('refused')) });
      const failing = setup(failingApi.api);
      failing.controller.onServerState(RUNNING);
      await failing.controller.handle(send({ model: GLM }));
      expect(failing.prefs.writes).toEqual([]);

      const ok = fakeApi();
      const good = setup(ok.api);
      good.controller.onServerState(RUNNING);
      await good.controller.handle(send({ model: GLM }));
      expect(good.prefs.writes).toEqual([GLM]);
      expect(catalogs(good.posted).at(-1)?.preferredModel).toEqual(GLM);
    });

    it('a failing write of the last model does not break the send', async () => {
      const { api, calls } = fakeApi();
      const { controller, posted, logs, prefs } = setup(api);
      prefs.writeError = new Error('disk full');
      controller.onServerState(RUNNING);
      await controller.handle(send({ model: GLM }));
      expect(calls).toContain('session.prompt');
      expect(posted.filter((m) => m.type === 'request.result')).toEqual([
        { type: 'request.result', requestId: 'r1' },
      ]);
      expect(logs.some((l) => l.startsWith('warn: remembering the last model failed'))).toBe(true);
    });

    it('the log lines carry ids, never the text of the prompt', async () => {
      const { api } = fakeApi();
      const { controller, logs } = setup(api);
      controller.onServerState(RUNNING);
      await controller.handle(send({ model: GLM, agent: 'plan', text: 'SECRET-PROMPT-TEXT' }));
      expect(logs.join('\n')).not.toContain('SECRET-PROMPT-TEXT');
    });
  });
});
