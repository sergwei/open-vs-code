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
  FileDiffInfo,
  FileFindInput,
  FileFindOutput,
  FormInfo,
  FormListOutput,
  ModelInfo,
  PermissionRequest,
  PermissionSavedInfo,
  ProviderInfo,
  SessionDiffInput,
  SessionInfo,
  SessionListInput,
  SessionMessageInfo,
  SessionRevert,
  SessionsResponse,
  V2Event,
} from '@opencode/client';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelRef } from '../shared/model';
import type { HostToWebview, Snapshot, WebviewToHost } from '../shared/protocol';
import type { AttachmentRef, PromptFileRef } from '../shared/protocol';
import {
  ChatController,
  FILE_SEARCH_LIMIT,
  FOCUS_REQUEST_TTL_MS,
  OFFERED_URIS_MAX,
  type ChatControllerDeps,
  type EditorActions,
  type EditorContext,
  type SavedPermission,
} from './chatController';
import type { DroppedFiles } from './chatController';
import type { EventStreamOptions } from './eventStream';
import type { ChatApi } from './opencodeClient';
import type { PendingSummary } from './pendingRequests';
import type { ServerState } from './serverManager';
import { onePane } from './test-fixtures/onePane';

const SERVER = {
  url: 'http://127.0.0.1:43211',
  password: 'pw-secret-1',
  version: '2.0.32',
  folder: 'C:\\work',
  binaryPath: 'opencode.exe',
  pid: 1,
  source: 'spawned' as const,
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
  /**
   * User messages `message.list({ type: 'user' })` answers with, oldest first (issue #31); the
   * "Changed files" range is read with that filter, which the default `messages` do not model.
   */
  userMessages: SessionMessageInfo[];
  /** Replaces `session.diff` (issue #31); receives the input of the call. */
  diffImpl: (input: SessionDiffInput) => Promise<FileDiffInfo[]>;
  /** `subpath` `session.get` adds to every row (issue #31). */
  subpath: string;
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
  /**
   * Issue #32. `rowRevert` is the `revert` every session row (`session.list` and `session.get`)
   * carries; `stageImpl` replaces `session.revert.stage`; `revertError` rejects stage, clear and
   * commit with this server error body; `messageTypes` are the `type` `session.message.get` answers
   * by id (default `user`; an id mapped to `unknown` rejects `MessageNotFoundError`).
   */
  rowRevert: SessionRevert;
  stageImpl: (input: { sessionID: string; messageID: string }) => Promise<SessionRevert>;
  revertError: object;
  messageTypes: Record<string, string>;
  /** Replaces `session.revert.clear` / `commit`, to hold them while a test runs something else. */
  clearImpl: () => Promise<void>;
  /** Replaces `file.find` (issue #28); receives the input and the abort signal of the call. */
  findImpl: (
    input: FileFindInput,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<FileFindOutput>;
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
  const finds: FileFindInput[] = [];
  const diffInputs: SessionDiffInput[] = [];
  const reverts: string[] = [];
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
          (() =>
            Promise.resolve({
              data: (options.sessions ?? []).map((id) => ({
                ...sessionInfo(id),
                ...(options.rowRevert === undefined ? {} : { revert: options.rowRevert }),
              })),
              cursor: {},
            }))
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
          ...(options.subpath === undefined ? {} : { subpath: options.subpath }),
          ...(options.rowRevert === undefined ? {} : { revert: options.rowRevert }),
          ...stored,
        });
      },
      revert: {
        stage: (input) => {
          calls.push('session.revert.stage');
          reverts.push(`stage ${input.messageID}`);
          if (options.revertError !== undefined) return failWith(options.revertError);
          return (
            options.stageImpl ?? ((i) => Promise.resolve({ messageID: i.messageID, files: [] }))
          )(input);
        },
        clear: () => {
          calls.push('session.revert.clear');
          reverts.push('clear');
          if (options.revertError !== undefined) return failWith(options.revertError);
          return (options.clearImpl ?? (() => Promise.resolve()))();
        },
        commit: () => {
          calls.push('session.revert.commit');
          reverts.push('commit');
          if (options.revertError !== undefined) return failWith(options.revertError);
          return Promise.resolve();
        },
      },
      message: {
        get: ({ sessionID, messageID }) => {
          calls.push('session.message.get');
          const type = options.messageTypes?.[messageID] ?? 'user';
          if (type === 'unknown') {
            return failWith({ _tag: 'MessageNotFoundError', sessionID, messageID });
          }
          return Promise.resolve({ id: messageID, type } as unknown as SessionMessageInfo);
        },
      },
      diff: (input) => {
        calls.push('session.diff');
        diffInputs.push(input);
        return (options.diffImpl ?? (() => Promise.resolve([])))(input);
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
        return (options.promptImpl ?? (() => Promise.resolve({ id: 'msg_in' })))() as ReturnType<
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
      list: (input) => {
        if (input.type === 'user') {
          // The range read of the "Changed files" list (issue #31), kept out of `message.list`
          // so the snapshot tests that count history reads keep their meaning.
          calls.push('message.list.user');
          const users = options.userMessages ?? [];
          const ordered = input.order === 'desc' ? [...users].reverse() : users;
          return Promise.resolve({
            data: ordered.slice(0, input.limit ?? ordered.length),
            cursor: {},
          });
        }
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
    file: {
      find: (input, requestOptions) => {
        calls.push('file.find');
        finds.push(input);
        return (options.findImpl ?? (() => Promise.resolve({ location: LOCATION, data: [] })))(
          input,
          requestOptions,
        );
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
    finds,
    diffInputs,
    reverts,
  };
}

/**
 * A fake {@link EditorActions} that records its calls as `name(args)` strings. `failWith` makes
 * every method reject with that error; `picked` is what the file picker returns and `context` what
 * the editor-context button gets.
 */
function fakeEditor(
  options: {
    failWith?: Error;
    picked?: AttachmentRef[];
    context?: EditorContext;
    diffOutcome?: 'diff' | 'file';
    dropped?: DroppedFiles;
  } = {},
) {
  const calls: unknown[][] = [];
  const run = (name: string, ...args: unknown[]): Promise<void> => {
    calls.push([name, ...args]);
    return options.failWith === undefined ? Promise.resolve() : Promise.reject(options.failWith);
  };
  const editor: EditorActions = {
    open: (path, line, column, folder) => run('open', path, line, column, folder),
    editorContext: (folder) => {
      calls.push(['editorContext', folder]);
      if (options.failWith !== undefined) return Promise.reject(options.failWith);
      return Promise.resolve(options.context ?? { refs: [], ranged: 0, unsaved: false });
    },
    insert: (text) => run('insert', text),
    newFile: (text, language) => run('newFile', text, language),
    copy: (text) => run('copy', text),
    pickFiles: (kind) => {
      calls.push(['pickFiles', kind]);
      return options.failWith === undefined
        ? Promise.resolve(options.picked ?? [])
        : Promise.reject(options.failWith);
    },
    droppedFiles: (folder, uris) => {
      calls.push(['droppedFiles', folder, uris]);
      if (options.failWith !== undefined) return Promise.reject(options.failWith);
      return Promise.resolve(
        options.dropped ?? {
          refs: [],
          skipped: { folders: 0, outside: 0, remote: 0, missing: 0 },
        },
      );
    },
    openDiff: (target) => {
      calls.push(['openDiff', target]);
      return options.failWith === undefined
        ? Promise.resolve(options.diffOutcome ?? 'diff')
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
  confirmRevertDiscard: () => Promise<boolean> = () => Promise.resolve(true),
) {
  const confirmations: Array<{ title: string; running: boolean }> = [];
  let discardAsked = 0;
  const posted: HostToWebview[] = [];
  /** Whether the chat view can take a post; a test sets `ready` false to model a hidden view. */
  const view = { ready: true };
  const logs: string[] = [];
  const memoryWrites: Array<{ folder: string; id: string | undefined }> = [];
  const stored = new Map<string, string>();
  if (remembered !== undefined) stored.set(SERVER.folder, remembered);
  const attentionCalls: Array<readonly PendingSummary[]> = [];
  const serverCalls: string[] = [];
  /**
   * The `setup.action`s that reached `deps.setup`. `binary` scripts the "Choose binary…" dialog:
   * `picked` is what the dialog returns, `current` the setting's value, `pickError` makes the
   * dialog reject, `writeError` makes the write reject, and `postedAtWrite` is how many messages the pane had received when the write
   * started (issue #86: `setup.binary chosen` must already be among them).
   */
  const setupCalls: string[] = [];
  const binary: {
    picked: string | undefined;
    current: string;
    pickError: Error | undefined;
    writeError: Error | undefined;
    postedAtWrite: number | undefined;
  } = {
    picked: undefined,
    current: '',
    pickError: undefined,
    writeError: undefined,
    postedAtWrite: undefined,
  };
  const focusCalls: boolean[] = [];
  /** How many times the controller asked to give the keyboard to the chat iframe again. */
  const viewFocuses = { count: 0 };
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
      confirmRevertDiscard: () => {
        discardAsked += 1;
        return confirmRevertDiscard();
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
    setup: {
      pickBinary: () => {
        setupCalls.push('binary.choose');
        return binary.pickError === undefined
          ? Promise.resolve(binary.picked)
          : Promise.reject(binary.pickError);
      },
      currentBinaryPath: () => binary.current,
      writeBinaryPath: (path) => {
        setupCalls.push(`binary.write:${path}`);
        binary.postedAtWrite = posted.length;
        return binary.writeError === undefined
          ? Promise.resolve()
          : Promise.reject(binary.writeError);
      },
      redetectBinary: () => {
        setupCalls.push('binary.redetect');
      },
      openBinarySettings: () => {
        setupCalls.push('binary.settings');
      },
      openServerSettings: () => {
        setupCalls.push('server.settings');
      },
      setServerPassword: () => {
        setupCalls.push('server.password');
      },
      openInstallGuide: () => {
        setupCalls.push('install.guide');
      },
      openFolder: () => {
        setupCalls.push('folder.open');
      },
    },
    ui: {
      setChatFocused: (focused) => {
        focusCalls.push(focused);
      },
      focusView: () => {
        viewFocuses.count += 1;
      },
    },
    runStream: ((options: EventStreamOptions<V2Event>) => {
      streams.push({ options, aborted: () => options.signal.aborted });
      return new Promise<void>((resolve) => {
        options.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }) as ChatControllerDeps['runStream'],
  };
  // The tests below were written when the host had one webview: `onePane` keeps their calls.
  const controller = onePane(new ChatController(deps), {
    post: (message) => posted.push(message),
    canDeliver: () => view.ready,
  });
  const snapshots = (): Snapshot[] =>
    posted.flatMap((m) => (m.type === 'snapshot' ? [m.snapshot] : []));
  return {
    controller,
    posted,
    view,
    logs,
    memoryWrites,
    streams,
    snapshots,
    attentionCalls,
    serverCalls,
    setupCalls,
    /** Scripts the "Choose binary…" dialog and the setting; see `binary` above. */
    binary,
    focusCalls,
    viewFocuses,
    picked,
    confirmations,
    /** How many times the "Discard for good" modal was shown. */
    discardAsked: () => discardAsked,
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
    expect(logs).toContain('info: prompt accepted for ses_new (input msg_in)');
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

// Issue #25. The compaction message and the usage totals follow what the planner's spike saw on a
// real opencode 2.0.32 (Windows 11, 22/10/2026); the controller is driven with a FAKE client, so
// this protects OUR wiring: the boundary reaching the snapshot, the stream winning over an older
// REST read (one case per direction, opencode-api §4), and the resync on `compaction.ended` of the
// open session only.
describe('context usage (issue #25)', () => {
  const compaction = (status: string, created: number): SessionMessageInfo =>
    wire<SessionMessageInfo>(
      `{"id":"msg_c${String(created)}","type":"compaction","status":"${status}","reason":"manual","summary":"s","recent":"r","time":{"created":${String(created)}}}`,
    );
  const usageRow = (id: string, input: number): SessionInfo =>
    wire<SessionInfo>(
      `{"id":"${id}","projectID":"p","cost":0.5,"tokens":{"input":${String(input)},"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"time":{"created":1,"updated":2},"location":{"directory":"C:\\\\work"}}`,
    );

  it('puts the time of the last completed compaction in the open session of the snapshot', async () => {
    const { api } = fakeApi({
      messages: [compaction('running', 900), compaction('completed', 500)],
    });
    const { controller, snapshots } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(snapshots().at(-1)?.open?.compactedAt).toBe(500);
  });

  it('leaves compactedAt out when no compaction completed', async () => {
    const { api } = fakeApi({ messages: [compaction('failed', 900)] });
    const { controller, snapshots } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(snapshots().at(-1)?.open).toBeDefined();
    expect(snapshots().at(-1)?.open?.compactedAt).toBeUndefined();
  });

  it('carries the REST totals of each row as usage', async () => {
    const { api } = fakeApi({
      listImpl: () => Promise.resolve({ data: [usageRow('ses_a', 700)], cursor: {} }),
    });
    const { controller, snapshots } = setup(api);
    controller.onServerState(RUNNING);
    await controller.resync();
    expect(snapshots().at(-1)?.sessions[0]?.usage).toEqual({
      cost: 0.5,
      tokens: { input: 700, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it('lets a usage update that arrived while REST was being read win over the older row', async () => {
    let release: (value: { data: SessionInfo[]; cursor: object }) => void = () => undefined;
    const { api } = fakeApi({
      listImpl: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const { controller, streams, snapshots } = setup(api);
    controller.onServerState(RUNNING);
    const pending = controller.resync();
    await flush();
    emit(streams, 'session.usage.updated', {
      sessionID: 'ses_a',
      cost: 0.75,
      tokens: { input: 900, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    release({ data: [usageRow('ses_a', 700)], cursor: {} });
    await pending;
    expect(snapshots().at(-1)?.sessions[0]?.usage?.tokens.input).toBe(900);
    expect(snapshots().at(-1)?.sessions[0]?.usage?.cost).toBe(0.75);
  });

  it('does not let a usage update from before the resync overwrite a newer REST row', async () => {
    const { api } = fakeApi({
      listImpl: () => Promise.resolve({ data: [usageRow('ses_a', 700)], cursor: {} }),
    });
    const { controller, streams, snapshots } = setup(api);
    controller.onServerState(RUNNING);
    emit(streams, 'session.usage.updated', {
      sessionID: 'ses_a',
      cost: 0.1,
      tokens: { input: 5, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    await controller.resync();
    expect(snapshots().at(-1)?.sessions[0]?.usage?.tokens.input).toBe(700);
  });

  it('logs a usage update with the session id and a token count only', () => {
    const { controller, streams, logs } = setup(fakeApi().api);
    controller.onServerState(RUNNING);
    emit(streams, 'session.usage.updated', {
      sessionID: 'ses_a',
      cost: 0,
      tokens: { input: 4951, output: 4, reasoning: 0, cache: { read: 4608, write: 0 } },
    });
    expect(logs).toContain('info: usage updated for ses_a: 9563 tokens');
  });

  it('resyncs when the OPEN session finishes a compaction, and only then', async () => {
    const { api, calls } = fakeApi();
    const { controller, streams, logs } = setup(api, 'ses_open');
    controller.onServerState(RUNNING);
    await controller.resync();
    const before = calls.filter((c) => c === 'session.list').length;
    emit(streams, 'session.compaction.ended', {
      sessionID: 'ses_other',
      reason: 'manual',
      text: 't',
      recent: 'r',
    });
    await flush();
    expect(calls.filter((c) => c === 'session.list')).toHaveLength(before);
    emit(streams, 'session.compaction.ended', {
      sessionID: 'ses_open',
      reason: 'manual',
      text: 't',
      recent: 'r',
    });
    await flush();
    expect(calls.filter((c) => c === 'session.list')).toHaveLength(before + 1);
    expect(logs).toContain('info: compaction ended for ses_open; refreshing the snapshot');
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

  // E2 (issue #85). Fabricated states: they pin the copy, not what a real detection produces.
  it('copies the binary diagnosis of an unavailable server to the connection, and only then', () => {
    const { controller, posted } = setup(fakeApi().api);
    const binary = {
      settingPath: 'C:\\opencode.exe',
      checks: [
        {
          source: 'setting' as const,
          path: 'C:\\opencode.exe',
          outcome: 'invalid' as const,
          detail: 'the file does not exist',
        },
      ],
    };
    controller.onServerState({
      kind: 'unavailable',
      reason: 'binary-missing',
      message: 'no binary',
      binary,
    });
    expect(posted.at(-1)).toEqual({
      type: 'connection.state',
      connection: {
        state: 'unavailable',
        reason: 'binary-missing',
        error: { code: 'binary-missing', message: 'no binary' },
        binary,
      },
    });
    controller.onServerState({ kind: 'unavailable', reason: 'start-failed', message: 'boom' });
    const last = posted.at(-1);
    expect(last).toMatchObject({ connection: { state: 'unavailable', reason: 'start-failed' } });
    expect(JSON.stringify(last)).not.toContain('binary"');
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
      ['open', 'src/a.ts', 42, 7, undefined],
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

  // E2 (issue #85, decision P11). Fake editor: it records the kind the controller passes on; the
  // dialog filter itself is UNVERIFIED (a native dialog cannot be driven by the test API).
  it('passes the kind of attachments.pick to the picker, file by default', async () => {
    const { editor, calls } = fakeEditor();
    const { controller } = setup(fakeApi().api, undefined, editor);
    await controller.handle({ type: 'attachments.pick', requestId: 'p1' });
    await controller.handle({ type: 'attachments.pick', requestId: 'p2', kind: 'image' });
    expect(calls).toEqual([
      ['pickFiles', 'file'],
      ['pickFiles', 'image'],
    ]);
  });

  it('answers a failing picker through request.result', async () => {
    const { editor } = fakeEditor({ failWith: new Error('dialog failed') });
    const { controller, posted } = setup(fakeApi().api, undefined, editor);
    await controller.handle({ type: 'attachments.pick', requestId: 'p1' });
    expect(posted.at(-1)).toMatchObject({ requestId: 'p1', error: { message: 'dialog failed' } });
  });
});

// E7-file-context (issues #28/#29). Provenance: a FAKE client and a fake editor; the entry shapes
// copy the ones the planner saw in a spike against a real opencode 2.0.32 (Windows 11,
// 22/10/2026): `{path, type}`, directories with a trailing `\`. They confirm the controller's
// logic (whitelist, abort of the superseded search, scrubbing), not the contract with the server;
// the round trip over HTTP is `chatController.e2e.test.ts` and the real server is the opt-in suite.
describe('file mentions and editor context (issues #28/#29)', () => {
  const found = (...paths: string[]): FileFindOutput => ({
    location: LOCATION,
    data: paths.map((path) => ({
      path,
      type: path.endsWith('\\') ? ('directory' as const) : ('file' as const),
    })),
  });
  // The controller maps results with the `path` of the machine running the test, and SERVER's
  // folder is a Windows one: building the expected reference the same way keeps the case valid on
  // Linux and macOS (where `C:\work` is just an odd relative folder name).
  const refOf = (relative: string) => ({
    uri: pathToFileURL(path.resolve(SERVER.folder, relative)).href,
    name: relative,
  });
  const sendWith = (files: PromptFileRef[], text = 'look') =>
    ({
      type: 'prompt.send',
      requestId: 'r1',
      text,
      delivery: 'queue',
      files,
    }) satisfies WebviewToHost;

  it('asks the server for files only, with the limit, and maps the answer', async () => {
    const { api, finds } = fakeApi({
      findImpl: () => Promise.resolve(found('src/a.ts', 'src/shared\\', 'src\\b.ts')),
    });
    const { controller, posted, logs } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'files.search', requestId: 'f1', query: 'needle' });
    expect(finds).toEqual([{ query: 'needle', type: 'file', limit: FILE_SEARCH_LIMIT }]);
    expect(posted.at(-1)).toEqual({
      type: 'files.found',
      requestId: 'f1',
      query: 'needle',
      files: [refOf('src/a.ts'), refOf('src/b.ts')],
    });
    // The count only: the query is the user's words.
    expect(logs).toContain('info: file search: 2 results');
    expect(logs.join(' | ')).not.toContain('needle');
  });

  it('never answers a search with a request.result and leaves Send usable', async () => {
    const { api } = fakeApi({ findImpl: () => Promise.resolve(found('a.ts')) });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'files.search', requestId: 'f1', query: 'a' });
    expect(posted.some((m) => m.type === 'request.result')).toBe(false);
  });

  it('answers a search without a server with ServerUnavailable inside files.found', async () => {
    const { controller, posted } = setup(fakeApi().api);
    await controller.handle({ type: 'files.search', requestId: 'f1', query: 'a' });
    expect(posted).toEqual([
      {
        type: 'files.found',
        requestId: 'f1',
        query: 'a',
        files: [],
        error: { code: 'ServerUnavailable', message: 'The opencode server is not running' },
      },
    ]);
  });

  it('scrubs the server URL and password from a failed search', async () => {
    const { api } = fakeApi({
      findImpl: () =>
        // The real client rejects with the server's error BODY (an object), not an Error.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject({
          _tag: 'UnauthorizedError',
          message: `no at ${SERVER.url} ${SERVER.password}`,
        }),
    });
    const { controller, posted, logs } = setup(api);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'files.search', requestId: 'f1', query: 'a' });
    const answer = posted.at(-1);
    expect(answer).toMatchObject({
      type: 'files.found',
      files: [],
      error: { code: 'UnauthorizedError' },
    });
    expect(JSON.stringify(answer)).not.toContain('43211');
    expect(JSON.stringify(answer)).not.toContain(SERVER.password);
    expect(logs).toContain('warn: file search failed: UnauthorizedError');
  });

  it('aborts the superseded search and publishes only the newest answer', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const resolvers: Array<(output: FileFindOutput) => void> = [];
    const { api } = fakeApi({
      findImpl: (_input, options) => {
        signals.push(options?.signal);
        return new Promise<FileFindOutput>((resolve) => resolvers.push(resolve));
      },
    });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    const first = controller.handle({ type: 'files.search', requestId: 'f1', query: 'a' });
    const second = controller.handle({ type: 'files.search', requestId: 'f2', query: 'ab' });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    // The old one resolves late: it must not be published.
    resolvers[0]?.(found('old.ts'));
    resolvers[1]?.(found('new.ts'));
    await Promise.all([first, second]);
    const answers = posted.filter((m) => m.type === 'files.found');
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ requestId: 'f2', files: [{ name: 'new.ts' }] });
  });

  // Defends the popup from staying on "Searching…" when the server stops mid-search (review of
  // E7-file-context, round 2, W1). Synthetic: a fake client whose promise the test settles by hand.
  it('answers its own requestId with ServerUnavailable when the server stops mid-search', async () => {
    const resolvers: Array<(output: FileFindOutput) => void> = [];
    const { api } = fakeApi({
      findImpl: () => new Promise<FileFindOutput>((resolve) => resolvers.push(resolve)),
    });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    const pending = controller.handle({ type: 'files.search', requestId: 'f1', query: 'a' });
    controller.onServerState({ kind: 'stopped' });
    resolvers[0]?.(found('a.ts'));
    await pending;
    expect(posted.filter((m) => m.type === 'files.found')).toEqual([
      {
        type: 'files.found',
        requestId: 'f1',
        query: 'a',
        files: [],
        error: { code: 'ServerUnavailable', message: 'The opencode server is not running' },
      },
    ]);
  });

  it('also answers with ServerUnavailable when the aborted find() rejects', async () => {
    const { api } = fakeApi({
      findImpl: (_input, options) =>
        new Promise<FileFindOutput>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    const pending = controller.handle({ type: 'files.search', requestId: 'f1', query: 'a' });
    controller.onServerState({ kind: 'stopped' });
    await pending;
    expect(posted.filter((m) => m.type === 'files.found')).toMatchObject([
      { requestId: 'f1', files: [], error: { code: 'ServerUnavailable' } },
    ]);
  });

  it('stays silent for a search replaced by a newer one whose find() rejects on abort', async () => {
    const resolvers: Array<(output: FileFindOutput) => void> = [];
    const { api } = fakeApi({
      findImpl: (_input, options) =>
        new Promise<FileFindOutput>((resolve, reject) => {
          resolvers.push(resolve);
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    });
    const { controller, posted } = setup(api);
    controller.onServerState(RUNNING);
    const first = controller.handle({ type: 'files.search', requestId: 'f1', query: 'a' });
    const second = controller.handle({ type: 'files.search', requestId: 'f2', query: 'ab' });
    resolvers[1]?.(found('new.ts'));
    await Promise.all([first, second]);
    const answers = posted.filter((m) => m.type === 'files.found');
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ requestId: 'f2' });
  });

  it('accepts a prompt file the search offered, and refuses one it invented', async () => {
    const { api, prompts } = fakeApi({ findImpl: () => Promise.resolve(found('src/a.ts')) });
    const { controller, posted } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'files.search', requestId: 'f1', query: 'a' });
    const offered = refOf('src/a.ts');
    await controller.handle(sendWith([offered]));
    expect(prompts).toEqual([
      { sessionID: 'ses_old', text: 'look', delivery: 'queue', files: [offered] },
    ]);
    await controller.handle(sendWith([{ uri: 'file:///C:/work/.env', name: '.env' }]));
    expect(prompts).toHaveLength(1);
    expect(posted.at(-1)).toMatchObject({
      error: { code: 'AttachmentRejected', message: 'Only files chosen in the chat can be sent' },
    });
  });

  it('forgets the oldest offered uri after OFFERED_URIS_MAX results', async () => {
    let next = 0;
    const { api, prompts } = fakeApi({
      findImpl: () => {
        const paths = Array.from({ length: FILE_SEARCH_LIMIT }, () => `f${String(next++)}.ts`);
        return Promise.resolve(found(...paths));
      },
    });
    const { controller } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    const searches = Math.ceil(OFFERED_URIS_MAX / FILE_SEARCH_LIMIT) + 1;
    for (let index = 0; index < searches; index++) {
      await controller.handle({ type: 'files.search', requestId: `f${String(index)}`, query: 'f' });
    }
    // f0.ts was the very first result: it is out by now; the last one is still in.
    await controller.handle(sendWith([refOf('f0.ts')]));
    expect(prompts).toHaveLength(0);
    await controller.handle(sendWith([refOf(`f${String(next - 1)}.ts`)]));
    expect(prompts).toHaveLength(1);
  });

  it('forwards a mention only when it points at the text it claims', async () => {
    const file = refOf('src/a.ts');
    const { api, prompts } = fakeApi({ findImpl: () => Promise.resolve(found('src/a.ts')) });
    const { controller } = setup(api, 'ses_old');
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'files.search', requestId: 'f1', query: 'a' });
    const text = 'read @src/a.ts now';
    const mention = { start: 5, end: 14, text: '@src/a.ts' };
    await controller.handle(sendWith([{ ...file, mention }], text));
    await controller.handle(
      sendWith([{ ...file, mention: { start: 0, end: 9, text: '@src/a.ts' } }], text),
    );
    expect(prompts.map((prompt) => prompt.files)).toEqual([[{ ...file, mention }], [file]]);
  });

  // Issue #30, decisions Q1/Q2 of Sergio. Fake editor and fake `file.find`: they pin what the
  // controller does with a drop, not what a real VS Code puts in `resourceurls`.
  describe('dropped files and pasted images (issue #30)', () => {
    // Built with `refOf` (the `path` of the machine running the test), like the search results the
    // fake `file.find` maps: a literal Windows uri only matched on Windows (CI failed on Linux and
    // macOS, 23/10/2026).
    const A = refOf('src/a.ts');
    const IGNORED = refOf('.env');
    const skipped = { folders: 1, outside: 1, remote: 0, missing: 0 };
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString('base64');
    const drop = (uris: string[]) => ({ type: 'attachments.drop', requestId: 'd1', uris }) as const;

    it('whitelists only the files the server also lists, and warns once with the count', async () => {
      const { editor, calls } = fakeEditor({
        dropped: { refs: [A, IGNORED], skipped },
      });
      const { api, prompts } = fakeApi({
        findImpl: (input) =>
          Promise.resolve(input.query === 'src/a.ts' ? found('src/a.ts') : found()),
      });
      const { controller, posted, logs } = setup(api, 'ses_old', editor);
      controller.onServerState(RUNNING);
      await controller.handle(drop(['file:///c%3A/work/src/a.ts', 'file:///c%3A/work/.env']));
      expect(calls[0]?.[0]).toBe('droppedFiles');
      expect(posted).toContainEqual({ type: 'attachments.picked', requestId: 'd1', files: [A] });
      expect(posted).toContainEqual({
        type: 'notice',
        level: 'warning',
        error: {
          code: 'DroppedItemsSkipped',
          message:
            '3 dropped items were not added: folders, ignored files and files outside the workspace folder cannot be attached',
        },
      });
      expect(logs).toContain(
        'info: dropped files added: 1, skipped: 3 (1 folder(s), 1 outside, 0 remote, 0 missing, 1 ignored)',
      );
      expect(logs.join(' | ')).not.toContain('a.ts');
      await controller.handle(sendWith([A]));
      await controller.handle({ ...sendWith([IGNORED]), requestId: 'r2' });
      expect(prompts).toHaveLength(1);
      expect(posted.at(-1)).toMatchObject({ error: { code: 'AttachmentRejected' } });
    });

    it('refuses a drop with no server to verify against, and skips the check for the menu command', async () => {
      const { editor } = fakeEditor({
        dropped: { refs: [A], skipped: { ...skipped, folders: 0, outside: 0 } },
      });
      const { api, finds } = fakeApi();
      const { controller, posted } = setup(api, 'ses_old', editor);
      await controller.handle(drop(['file:///c%3A/work/src/a.ts']));
      const results = posted.filter((message) => message.type === 'request.result');
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('error');
      expect(posted.map((message) => message.type)).not.toContain('attachments.picked');
      controller.onServerState(RUNNING);
      await controller.addToChat(['file:///c%3A/work/src/a.ts']);
      expect(finds).toEqual([]);
      expect(posted).toContainEqual({
        type: 'attachments.picked',
        requestId: 'menu-1',
        files: [A],
      });
    });

    it('answers a drop with no folder through request.result', async () => {
      const failure = Object.assign(
        new Error('Only files inside the workspace folder can be added'),
        {
          name: 'OutsideWorkspace',
        },
      );
      const { editor } = fakeEditor({ failWith: failure });
      const { controller, posted } = setup(fakeApi().api, undefined, editor);
      controller.onServerState(RUNNING);
      await controller.handle(drop(['file:///c%3A/other/a.ts']));
      expect(posted.at(-1)).toMatchObject({ error: { code: 'OutsideWorkspace' } });
      expect(posted.map((m) => m.type)).not.toContain('attachments.picked');
    });

    it('keeps a pasted image in memory and sends it as a data URL without a mention', async () => {
      const { api, prompts } = fakeApi();
      const { controller, posted, logs } = setup(api, 'ses_old');
      controller.onServerState(RUNNING);
      await controller.handle({
        type: 'attachments.image',
        requestId: 'i1',
        mime: 'image/png',
        data: PNG,
      });
      const ref = { uri: 'pasted-image:1', name: 'Pasted image 1' };
      expect(posted.slice(-2)).toEqual([
        { type: 'attachments.picked', requestId: 'i1', files: [ref] },
        { type: 'request.result', requestId: 'i1' },
      ]);
      expect(logs).toContain('info: image added: image/png, 0 KiB');
      await controller.handle(sendWith([ref]));
      expect(prompts[0]?.files).toEqual([
        { uri: `data:image/png;base64,${PNG}`, name: 'Pasted image 1' },
      ]);
      // Accepted: the host forgot it, so a second send of the same chip is refused.
      await controller.handle({ ...sendWith([ref]), requestId: 'r2' });
      expect(prompts).toHaveLength(1);
      expect(posted.at(-1)).toMatchObject({ error: { code: 'AttachmentRejected' } });
    });

    // Review of 23/10/2026 (B2): with the chat hidden the provider drops every post, so the chips of
    // the Explorer command were lost. Fake `view.ready`: it models the provider's condition.
    it('keeps the Explorer command chips for a hidden chat and delivers them after the next ready', async () => {
      const { editor } = fakeEditor({
        dropped: { refs: [A], skipped: { ...skipped, folders: 0, outside: 0 } },
      });
      const { controller, posted, view } = setup(fakeApi().api, 'ses_old', editor);
      controller.onServerState(RUNNING);
      view.ready = false;
      await controller.addToChat(['file:///c%3A/work/src/a.ts']);
      expect(posted.map((m) => m.type)).not.toContain('attachments.picked');
      view.ready = true;
      await controller.onWebviewReady();
      const types = posted.map((m) => m.type);
      expect(posted.at(-1)).toEqual({
        type: 'attachments.picked',
        requestId: 'menu-1',
        files: [A],
      });
      expect(types.indexOf('snapshot')).toBeLessThan(types.indexOf('attachments.picked'));
      // Delivered once: a later ready does not bring the chip back.
      const before = posted.length;
      await controller.onWebviewReady();
      expect(posted.slice(before).map((m) => m.type)).not.toContain('attachments.picked');
    });

    // Review-2 of 23/10/2026 (W7): the view can hide again during the resync of a `ready`; the kept
    // chips must wait for the next one instead of being posted into a provider that drops them.
    it('keeps the Explorer command chips when the chat hides again before they go out', async () => {
      const { editor } = fakeEditor({
        dropped: { refs: [A], skipped: { ...skipped, folders: 1, outside: 0 } },
      });
      const { controller, posted, view } = setup(fakeApi().api, 'ses_old', editor);
      controller.onServerState(RUNNING);
      view.ready = false;
      await controller.addToChat(['file:///c%3A/work/src/a.ts', 'file:///c%3A/work/src']);
      // A `ready` arrives but the view is hidden again by the time the kept chips go out.
      await controller.onWebviewReady();
      expect(posted.map((m) => m.type)).not.toContain('attachments.picked');
      view.ready = true;
      await controller.onWebviewReady();
      expect(posted.filter((m) => m.type === 'attachments.picked')).toHaveLength(1);
      // The command has its own notice: it neither drops nor filters ignored files.
      expect(posted.find((m) => m.type === 'notice')).toMatchObject({
        error: {
          code: 'DroppedItemsSkipped',
          message:
            '1 selected item was not added: folders and files outside the workspace folder cannot be attached',
        },
      });
    });

    it('frees a pasted image when the webview forgets it, and ignores a uri it never issued', async () => {
      const { api, prompts } = fakeApi();
      const { controller, posted } = setup(api, 'ses_old');
      controller.onServerState(RUNNING);
      await controller.handle({
        type: 'attachments.image',
        requestId: 'i1',
        mime: 'image/png',
        data: PNG,
      });
      const ref = { uri: 'pasted-image:1', name: 'Pasted image 1' };
      await controller.handle({ type: 'attachments.forget', uri: 'pasted-image:77' });
      await controller.handle({ type: 'attachments.forget', uri: 'file:///C:/work/src/a.ts' });
      await controller.handle({ type: 'attachments.forget', uri: ref.uri });
      await controller.handle(sendWith([ref]));
      expect(prompts).toHaveLength(0);
      expect(posted.at(-1)).toMatchObject({ error: { code: 'AttachmentRejected' } });
    });

    it('refuses an image whose bytes are not the declared type and an invented pasted-image uri', async () => {
      const { api, prompts } = fakeApi();
      const { controller, posted } = setup(api, 'ses_old');
      controller.onServerState(RUNNING);
      await controller.handle({
        type: 'attachments.image',
        requestId: 'i1',
        mime: 'image/jpeg',
        data: PNG,
      });
      expect(posted.at(-1)).toEqual({
        type: 'request.result',
        requestId: 'i1',
        error: {
          code: 'UnsupportedImage',
          message: 'Only PNG, JPEG, GIF and WebP images can be attached',
        },
      });
      await controller.handle(sendWith([{ uri: 'pasted-image:99', name: 'x' }]));
      expect(prompts).toHaveLength(0);
      expect(posted.at(-1)).toMatchObject({ error: { code: 'AttachmentRejected' } });
    });
  });

  it('adds the editor context to the whitelist and answers like the file picker', async () => {
    const refs = [{ uri: 'file:///C:/work/src/a.ts?start=2&end=3', name: 'src/a.ts#2-3' }];
    const { editor, calls } = fakeEditor({ context: { refs, ranged: 1, unsaved: false } });
    const { api, prompts } = fakeApi();
    const { controller, posted, logs } = setup(api, 'ses_old', editor);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'attachments.fromEditor', requestId: 'e1' });
    expect(calls).toEqual([['editorContext', 'C:\\work']]);
    expect(posted.slice(-2)).toEqual([
      { type: 'attachments.picked', requestId: 'e1', files: refs },
      { type: 'request.result', requestId: 'e1' },
    ]);
    expect(logs).toContain('info: editor context added: 0 file(s), 1 selection(s)');
    await controller.handle(sendWith(refs));
    expect(prompts).toHaveLength(1);
  });

  it('warns that the model reads the saved version when the buffer is dirty', async () => {
    const refs = [{ uri: 'file:///C:/work/src/a.ts', name: 'src/a.ts' }];
    const { editor } = fakeEditor({ context: { refs, ranged: 0, unsaved: true } });
    const { controller, posted, logs } = setup(fakeApi().api, undefined, editor);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'attachments.fromEditor', requestId: 'e1' });
    expect(posted).toContainEqual({
      type: 'notice',
      level: 'warning',
      error: {
        code: 'UnsavedChanges',
        message: 'Unsaved changes: the model reads the saved version',
      },
    });
    // The file still attaches, and the log has counts only.
    expect(posted).toContainEqual({ type: 'attachments.picked', requestId: 'e1', files: refs });
    expect(logs).toContain('info: editor context added: 1 file(s), 0 selection(s)');
    expect(logs.join(' | ')).not.toContain('src/a.ts');
  });

  it('answers a failing editor context through request.result and attaches nothing', async () => {
    const failure = Object.assign(new Error('Save the file first'), { name: 'NoFileOnDisk' });
    const { editor } = fakeEditor({ failWith: failure });
    const { controller, posted } = setup(fakeApi().api, undefined, editor);
    await controller.handle({ type: 'attachments.fromEditor', requestId: 'e1' });
    expect(posted).toEqual([
      {
        type: 'request.result',
        requestId: 'e1',
        error: { code: 'NoFileOnDisk', message: 'Save the file first' },
      },
    ]);
  });

  // Decision W2 of Sergio (22/10/2026). The editor side refuses a file outside the served folder
  // (the fake stands for it, `isInServedFolder` is unit-tested in `fileMentions.test.ts`); the
  // controller must then leave the whitelist alone, or `prompt.send` would take a `uri` the user
  // never attached. The fake's error is a hand-made copy of the real one.
  it('whitelists nothing when the editor refuses a file outside the served folder', async () => {
    const outside = Object.assign(
      new Error('Only files inside the workspace folder can be added'),
      {
        name: 'OutsideWorkspace',
      },
    );
    const { editor, calls } = fakeEditor({ failWith: outside });
    const { api, calls: apiCalls } = fakeApi();
    const { controller, posted } = setup(api, 'ses_old', editor);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'attachments.fromEditor', requestId: 'e1' });
    expect(calls).toEqual([['editorContext', 'C:\\work']]);
    expect(posted.at(-1)).toEqual({
      type: 'request.result',
      requestId: 'e1',
      error: {
        code: 'OutsideWorkspace',
        message: 'Only files inside the workspace folder can be added',
      },
    });
    expect(posted.map((message) => message.type)).not.toContain('attachments.picked');
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'look',
      delivery: 'queue',
      files: [{ uri: 'file:///C:/Users/me/.ssh/config', name: 'config' }],
    });
    expect(apiCalls).not.toContain('session.prompt');
    expect(posted.at(-1)).toMatchObject({ error: { code: 'AttachmentRejected' } });
  });

  it('opens a chip against the folder the server serves', async () => {
    const { editor, calls } = fakeEditor();
    const { controller } = setup(fakeApi().api, undefined, editor);
    controller.onServerState(RUNNING);
    await controller.handle({ type: 'editor.open', path: 'file:///C:/work/src/a.ts', line: 2 });
    expect(calls).toEqual([['open', 'file:///C:/work/src/a.ts', 2, undefined, 'C:\\work']]);
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

  // E2 (issue #85). Fake `deps.setup`: it records the call; what each one does in VS Code is
  // `setupActions.ts`, which has no unit test (only Choose binary… was driven in a real window by
  // `test:visual`; the rest is UNVERIFIED, see its header).
  it('forwards each setup.action to its command of deps.setup', async () => {
    const { controller, setupCalls } = setup(fakeApi().api);
    for (const action of [
      'binary.choose',
      'binary.settings',
      'server.settings',
      'server.password',
      'install.guide',
      'folder.open',
    ] as const) {
      await controller.handle({ type: 'setup.action', action });
    }
    expect(setupCalls).toEqual([
      'binary.choose',
      'binary.settings',
      'server.settings',
      'server.password',
      'install.guide',
      'folder.open',
    ]);
  });

  // Issue #86. Provenance: FABRICATED dialog and setting (a recording double); the real dialog
  // and the real order of `setup.binary` against `connection.state` are driven by `test:visual`
  // step 0 ("Checking…" with the chosen path, then back after a cancel).
  it('answers a cancelled dialog with setup.binary cancelled and writes nothing', async () => {
    const { controller, posted, setupCalls, logs } = setup(fakeApi().api);
    await controller.handle({ type: 'setup.action', action: 'binary.choose' });
    expect(posted.filter((m) => m.type === 'setup.binary')).toEqual([
      { type: 'setup.binary', outcome: 'cancelled' },
    ]);
    expect(setupCalls).toEqual(['binary.choose']);
    expect(logs).toContain('info: binary choice: cancelled');
  });

  it('posts setup.binary chosen BEFORE it writes the setting, and never logs the path', async () => {
    const { controller, posted, setupCalls, binary, logs } = setup(fakeApi().api);
    binary.picked = '/opt/secret-user/opencode';
    await controller.handle({ type: 'setup.action', action: 'binary.choose' });
    expect(setupCalls).toEqual(['binary.choose', 'binary.write:/opt/secret-user/opencode']);
    const chosenAt = posted.findIndex((m) => m.type === 'setup.binary');
    expect(posted[chosenAt]).toEqual({
      type: 'setup.binary',
      outcome: 'chosen',
      path: '/opt/secret-user/opencode',
    });
    expect(binary.postedAtWrite).toBeGreaterThan(chosenAt);
    expect(logs.join('\n')).not.toContain('secret-user');
  });

  it('re-runs the detection instead of writing when the pick equals the setting', async () => {
    const { controller, posted, setupCalls, binary } = setup(fakeApi().api);
    binary.picked = '/opt/opencode';
    binary.current = '/opt/opencode';
    await controller.handle({ type: 'setup.action', action: 'binary.choose' });
    expect(setupCalls).toEqual(['binary.choose', 'binary.redetect']);
    expect(posted.filter((m) => m.type === 'setup.binary')).toEqual([
      { type: 'setup.binary', outcome: 'chosen', path: '/opt/opencode' },
    ]);
  });

  it('turns a failed write into setup.binary failed plus a warning notice, without throwing', async () => {
    const { controller, posted, binary, logs } = setup(fakeApi().api);
    binary.picked = '/opt/opencode';
    binary.writeError = new Error('could not write the setting');
    await controller.handle({ type: 'setup.action', action: 'binary.choose' });
    expect(posted.filter((m) => m.type === 'setup.binary')).toEqual([
      { type: 'setup.binary', outcome: 'chosen', path: '/opt/opencode' },
      { type: 'setup.binary', outcome: 'failed' },
    ]);
    expect(posted.at(-1)).toMatchObject({
      type: 'notice',
      level: 'warning',
      error: { message: 'could not write the setting' },
    });
    expect(logs.some((line) => line.startsWith('warn: setup.action failed'))).toBe(true);
  });

  // Issue #86 (review C1/S1). Protects the `choosing` state of the guide: if a rejected dialog
  // were not answered, the button would stay disabled for good. Provenance: FABRICATED rejection.
  it('turns a rejected dialog into setup.binary failed plus a warning notice, writing nothing', async () => {
    const { controller, posted, setupCalls, binary, logs } = setup(fakeApi().api);
    binary.pickError = new Error('the dialog broke');
    await controller.handle({ type: 'setup.action', action: 'binary.choose' });
    expect(posted.filter((m) => m.type === 'setup.binary')).toEqual([
      { type: 'setup.binary', outcome: 'failed' },
    ]);
    expect(posted.at(-1)).toMatchObject({
      type: 'notice',
      level: 'warning',
      error: { message: 'the dialog broke' },
    });
    expect(setupCalls).toEqual(['binary.choose']);
    expect(logs.some((line) => line.startsWith('warn: setup.action failed'))).toBe(true);
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

  // Issue #11. Synthetic states: what the manager would publish for an external server.
  it('shows connecting as starting, and the external-server failures with their own reason', () => {
    const { controller, posted } = setup(fakeApi().api);
    controller.onServerState({
      kind: 'connecting',
      folder: 'C:\\work',
      url: 'http://127.0.0.1:4096',
    });
    expect(posted.at(-1)).toEqual({ type: 'connection.state', connection: { state: 'starting' } });
    for (const reason of ['unreachable', 'unauthorized', 'invalid-url'] as const) {
      controller.onServerState({ kind: 'unavailable', reason, message: `msg ${reason}` });
      expect(posted.at(-1)).toEqual({
        type: 'connection.state',
        connection: {
          state: 'unavailable',
          reason,
          error: { code: reason, message: `msg ${reason}` },
        },
      });
    }
  });

  it('a new password for the same external URL builds a new client and stream', () => {
    const { controller, streams } = setup(fakeApi().api);
    const external = (password: string): ServerState => ({
      kind: 'running',
      server: { ...SERVER, binaryPath: undefined, source: 'external', password },
    });
    controller.onServerState(external('one'));
    controller.onServerState(external('one'));
    expect(streams).toHaveLength(1);
    controller.onServerState(external('two'));
    expect(streams).toHaveLength(2);
    expect(streams[0]?.aborted()).toBe(true);
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

  // Issue #35. Protects against a command running twice (the way `focusRequest` repeats itself would
  // re-run New Session or Stop on the next `ready`) and against one lost to a document still loading.
  // Fabricated view state (`view.ready`); a real hidden view is covered by `commands.test.ts`.
  describe('runUiCommand', () => {
    const uiCommands = (posted: HostToWebview[]) =>
      posted.flatMap((m) => (m.type === 'ui.command' ? [m.command] : []));

    it('posts now when the webview can take it and does not repeat it after the next ready', async () => {
      const { controller, posted, viewFocuses } = setup(fakeApi().api);
      controller.onServerState(RUNNING);
      controller.runUiCommand('session.stop');
      expect(uiCommands(posted)).toEqual(['session.stop']);
      await controller.onWebviewReady();
      expect(uiCommands(posted)).toEqual(['session.stop']);
      // The reveal of the command itself focused a document that existed: nothing to repeat.
      expect(viewFocuses.count).toBe(0);
    });

    it('keeps it for a hidden view and sends it once, after the snapshot and the ui.focus', async () => {
      const { controller, posted, view, viewFocuses } = setup(fakeApi().api);
      controller.onServerState(RUNNING);
      view.ready = false;
      controller.focusRequest(target);
      controller.runUiCommand('prompt.focus');
      controller.runUiCommand('session.new');
      controller.runUiCommand('session.new');
      expect(uiCommands(posted)).toEqual([]);
      view.ready = true;
      await controller.onWebviewReady();
      expect(uiCommands(posted)).toEqual(['prompt.focus', 'session.new']);
      const types = posted.map((m) => m.type);
      expect(types.indexOf('ui.command')).toBeGreaterThan(types.lastIndexOf('snapshot'));
      await controller.onWebviewReady();
      expect(uiCommands(posted)).toEqual(['prompt.focus', 'session.new']);
      // Once, for the flush that sent them; the second ready had nothing to send.
      expect(viewFocuses.count).toBe(1);
    });

    it('drops a kept command older than the focus TTL', async () => {
      const { controller, posted, view } = setup(fakeApi().api);
      controller.onServerState(RUNNING);
      const now = Date.now();
      const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
      view.ready = false;
      controller.runUiCommand('session.stop');
      spy.mockReturnValue(now + FOCUS_REQUEST_TTL_MS + 1);
      view.ready = true;
      await controller.onWebviewReady();
      expect(uiCommands(posted)).toEqual([]);
    });

    it('keeps it when the view hides again during the resync', async () => {
      const { controller, posted, view } = setup(fakeApi().api);
      controller.onServerState(RUNNING);
      view.ready = false;
      controller.runUiCommand('session.stop');
      await controller.onWebviewReady();
      expect(uiCommands(posted)).toEqual([]);
      view.ready = true;
      await controller.onWebviewReady();
      expect(uiCommands(posted)).toEqual(['session.stop']);
    });

    it('relays chat.focusChanged to the focus dependency', async () => {
      const { controller, focusCalls } = setup(fakeApi().api);
      await controller.handle({ type: 'chat.focusChanged', focused: true });
      await controller.handle({ type: 'chat.focusChanged', focused: false });
      expect(focusCalls).toEqual([true, false]);
    });
  });

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
        usage: {
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        },
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

    // Issue #61. FABRICATED catalog (variants low/high as the spike saw for glm-5.3-flash-free).
    it('refuses a variant the model does not list: VariantUnavailable, no server call, catalog reloaded', async () => {
      const { api, calls, creates, switches } = fakeApi();
      const { controller, posted, prefs } = setup(api);
      controller.onServerState(RUNNING);
      await controller.handle(send({ model: { ...GLM, variant: 'ultra' } }));
      expect(lastResult(posted)).toMatchObject({
        requestId: 'r1',
        error: { code: 'VariantUnavailable' },
      });
      expect(creates).toEqual([]);
      expect(switches).toEqual([]);
      expect(calls).not.toContain('session.prompt');
      expect(prefs.writes).toEqual([]);
      await flush();
      await flush();
      expect(calls.filter((c) => c === 'model.list')).toHaveLength(2);
    });

    it('a variant "default" from the webview counts as no variant (new session)', async () => {
      const { api, creates } = fakeApi();
      const { controller, posted, logs, prefs } = setup(api);
      controller.onServerState(RUNNING);
      await controller.handle(send({ model: { ...GLM, variant: 'default' } }));
      expect(lastResult(posted)).toEqual({ type: 'request.result', requestId: 'r1' });
      expect(creates).toEqual([{ model: GLM }]);
      expect(logs).toContain('info: model selected opencode/glm-5.3-flash-free for ses_new');
      expect(prefs.writes).toEqual([GLM]);
    });

    it('a variant "default" on a session stored on high switches back to no variant', async () => {
      const { api, switches } = fakeApi({
        sessions: ['ses_old'],
        sessionSelection: { model: { ...GLM, variant: 'high' } },
      });
      const { controller } = setup(api, 'ses_old');
      controller.onServerState(RUNNING);
      await controller.handle(
        send({ sessionID: 'ses_old', model: { ...GLM, variant: 'default' } }),
      );
      expect(switches).toEqual(['model:opencode/glm-5.3-flash-free']);
    });

    // Protects against `isModelRef` accepting extra keys: a foreign key from the webview must not
    // reach `session.create` nor the persisted last model. Synthetic message, no real webview.
    it('does not pass keys other than providerID, id and variant on to the server or the memory', async () => {
      const { api, creates } = fakeApi();
      const { controller, prefs } = setup(api);
      controller.onServerState(RUNNING);
      const withExtra = { ...GLM, variant: 'high', extra: 'x' };
      await controller.handle(send({ model: withExtra }));
      expect(creates).toEqual([{ model: { ...GLM, variant: 'high' } }]);
      expect(prefs.writes).toEqual([{ ...GLM, variant: 'high' }]);
      expect(Object.keys(prefs.writes[0] ?? {})).toEqual(['providerID', 'id', 'variant']);
    });

    it('creates a new session with the variant, logs it at the end of the line and remembers it', async () => {
      const { api, creates } = fakeApi();
      const { controller, logs, prefs } = setup(api);
      controller.onServerState(RUNNING);
      await controller.handle(send({ model: { ...GLM, variant: 'high' } }));
      expect(creates).toEqual([{ model: { ...GLM, variant: 'high' } }]);
      expect(logs).toContain(
        'info: model selected opencode/glm-5.3-flash-free for ses_new (variant high)',
      );
      expect(prefs.writes).toEqual([{ ...GLM, variant: 'high' }]);
    });

    it('switching an existing session to a variant logs it at the end of the line', async () => {
      const { api, switches } = fakeApi({
        sessions: ['ses_old'],
        sessionSelection: { model: GLM },
      });
      const { controller, logs } = setup(api, 'ses_old');
      controller.onServerState(RUNNING);
      await controller.handle(send({ sessionID: 'ses_old', model: { ...GLM, variant: 'low' } }));
      expect(switches).toEqual(['model:opencode/glm-5.3-flash-free@low']);
      expect(logs).toContain(
        'info: model selected opencode/glm-5.3-flash-free for ses_old (variant low)',
      );
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

// ---------------------------------------------------------------------------------------------
// E7-session-diff (issue #31): the "Changed files" list and the native diff.
//
// Protects: the list reloaded on the events that can change it and on nothing else (a step of
// another session, a step that touched no file), a burst costing at most one more load, the list
// sent again after a snapshot, and above all the whitelist: the host opens a diff only for a path
// IT listed for the open session, so a webview (untrusted input) cannot make it open another file.
// Provenance: a FAKE client with hand-made `FileDiffInfo` rows and user messages; the module's
// own logic is in `sessionDiff.test.ts`, the real client over HTTP in `chatController.e2e.test.ts`.
// ---------------------------------------------------------------------------------------------
describe('changed files (issue #31)', () => {
  const STEP_TOKENS = { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } };
  const userMessage = (id: string): SessionMessageInfo =>
    wire<SessionMessageInfo>(
      JSON.stringify({ id, type: 'user', text: 'hi', time: { created: 1 } }),
    );
  const rowFor = (file: string, status: FileDiffInfo['status'] = 'modified'): FileDiffInfo => ({
    file,
    status,
    additions: 1,
    deletions: 1,
    patch: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n',
  });
  const stepEnded = (sessionID: string, files?: string[]) => ({
    sessionID,
    assistantMessageID: 'msg_a',
    finish: 'stop',
    cost: 0,
    tokens: STEP_TOKENS,
    ...(files === undefined ? {} : { files }),
  });
  /** A running controller with `ses_1` open and the fake serving `rows` as the diff. */
  function withOpenSession(rows: FileDiffInfo[] = [rowFor('src/a.ts')], editor?: EditorActions) {
    const api = fakeApi({
      sessions: ['ses_1'],
      userMessages: [userMessage('msg_1'), userMessage('msg_2')],
      diffImpl: () => Promise.resolve(rows),
    });
    const ctl = setup(api.api, 'ses_1', editor);
    ctl.controller.onServerState(RUNNING);
    return { ...api, ...ctl };
  }
  const diffLists = (posted: HostToWebview[]) =>
    posted.flatMap((m) => (m.type === 'session.diff' ? [m] : []));
  const absolute = (file: string): string => path.resolve(SERVER.folder, file);

  it('lists the files when a step of the open session ends with changed files', async () => {
    const { posted, streams, logs, diffInputs } = withOpenSession();
    emit(streams, 'session.step.ended', stepEnded('ses_1', ['src/a.ts']));
    await flush();
    await flush();
    expect(diffLists(posted)).toEqual([
      {
        type: 'session.diff',
        sessionID: 'ses_1',
        files: [
          {
            path: 'src/a.ts',
            status: 'modified',
            additions: 1,
            deletions: 1,
            binary: false,
            tooLarge: false,
          },
        ],
      },
    ]);
    expect(diffInputs).toEqual([{ sessionID: 'ses_1', from: 'msg_1', to: 'msg_2', context: 0 }]);
    expect(logs).toContain('info: session diff: 1 files for ses_1');
  });

  it('also reloads when a step FAILS with changed files', async () => {
    const { streams, diffInputs } = withOpenSession();
    emit(streams, 'session.step.failed', {
      ...stepEnded('ses_1', ['src/a.ts']),
      error: { type: 'aborted', message: 'Step interrupted' },
    });
    await flush();
    await flush();
    expect(diffInputs).toHaveLength(1);
  });

  it('ignores a step of another session, a step with no files and a step without the field', async () => {
    const { streams, diffInputs, calls } = withOpenSession();
    emit(streams, 'session.step.ended', stepEnded('ses_other', ['src/a.ts']));
    emit(streams, 'session.step.ended', stepEnded('ses_1', []));
    emit(streams, 'session.step.ended', stepEnded('ses_1'));
    await flush();
    await flush();
    expect(diffInputs).toEqual([]);
    expect(calls).not.toContain('message.list.user');
  });

  it('reloads on any revert event of the open session, and not on those of another', async () => {
    const { streams, diffInputs } = withOpenSession();
    emit(streams, 'session.revert.staged', { sessionID: 'ses_other', revert: { messageID: 'm' } });
    await flush();
    expect(diffInputs).toEqual([]);
    for (const [type, data] of [
      // `msg_2` is the second user message: the range then stops at `msg_1` (issue #32).
      ['session.revert.staged', { sessionID: 'ses_1', revert: { messageID: 'msg_2' } }],
      ['session.revert.cleared', { sessionID: 'ses_1' }],
      ['session.revert.committed', { sessionID: 'ses_1', to: 'm' }],
    ] as const) {
      const before = diffInputs.length;
      emit(streams, type, data);
      await flush();
      await flush();
      expect(diffInputs.length, type).toBe(before + 1);
    }
  });

  it('turns a burst of steps into at most two loads', async () => {
    const { streams, diffInputs } = withOpenSession();
    for (let i = 0; i < 5; i++) {
      emit(streams, 'session.step.ended', stepEnded('ses_1', ['src/a.ts']));
    }
    await flush();
    await flush();
    await flush();
    expect(diffInputs.length).toBeGreaterThanOrEqual(1);
    expect(diffInputs.length).toBeLessThanOrEqual(2);
  });

  it('sends the held list again right after the next snapshot', async () => {
    const { controller, posted, streams } = withOpenSession();
    emit(streams, 'session.step.ended', stepEnded('ses_1', ['src/a.ts']));
    await flush();
    await flush();
    posted.length = 0;
    await controller.onWebviewReady();
    const kinds = posted.map((m) => m.type);
    expect(kinds.indexOf('session.diff')).toBeGreaterThan(kinds.indexOf('snapshot'));
    expect(diffLists(posted)).toHaveLength(1);
  });

  it('forgets the list when the open session is deleted', async () => {
    const { controller, streams } = withOpenSession();
    emit(streams, 'session.step.ended', stepEnded('ses_1', ['src/a.ts']));
    await flush();
    await flush();
    emit(streams, 'session.deleted', { sessionID: 'ses_1' });
    await flush();
    await expect(controller.diffOriginal('ses_1', 'src/a.ts')).rejects.toMatchObject({
      name: 'DiffNotListed',
    });
  });

  it('forgets the list when the server goes away', async () => {
    const { controller, streams } = withOpenSession();
    emit(streams, 'session.step.ended', stepEnded('ses_1', ['src/a.ts']));
    await flush();
    await flush();
    controller.onServerState({ kind: 'stopped' });
    await expect(controller.diffOriginal('ses_1', 'src/a.ts')).rejects.toMatchObject({
      name: 'DiffNotListed',
    });
  });

  describe('session.diff.open', () => {
    const open = (path: string, sessionID = 'ses_1'): WebviewToHost => ({
      type: 'session.diff.open',
      sessionID,
      path,
    });
    /** The notices posted, as `code`s. */
    const noticeCodes = (posted: HostToWebview[]) =>
      posted.flatMap((m) => (m.type === 'notice' ? [m.error.code] : []));

    it('opens the diff of a listed path with the absolute path of the served folder', async () => {
      const { editor, calls } = fakeEditor();
      const { controller, streams, logs } = withOpenSession(
        [rowFor('src/a.ts', 'deleted')],
        editor,
      );
      emit(streams, 'session.step.ended', stepEnded('ses_1', ['src/a.ts']));
      await flush();
      await flush();
      await controller.handle(open('src/a.ts'));
      expect(calls).toEqual([
        [
          'openDiff',
          {
            sessionID: 'ses_1',
            path: 'src/a.ts',
            absolute: absolute('src/a.ts'),
            status: 'deleted',
            binary: false,
            side: 'before',
          },
        ],
      ]);
      expect(logs).toContain('info: diff opened (deleted)');
    });

    it('refuses what was not listed, with a notice and a log line that carries no path', async () => {
      const { editor, calls } = fakeEditor();
      const { controller, streams, logs, posted } = withOpenSession(
        [rowFor('src/a.ts'), rowFor('../outside.ts')],
        editor,
      );
      emit(streams, 'session.step.ended', stepEnded('ses_1', ['src/a.ts']));
      await flush();
      await flush();
      const wanted = ['src/other.ts', '../outside.ts', 'C:\\Windows\\win.ini', '/etc/passwd'];
      for (const target of wanted) await controller.handle(open(target));
      expect(calls).toEqual([]);
      expect(noticeCodes(posted)).toEqual(wanted.map(() => 'DiffNotListed'));
      expect(logs.filter((l) => l === 'warn: diff open refused: not listed')).toHaveLength(4);
      const everything = logs.join('\n');
      for (const secret of ['other.ts', 'outside.ts', 'win.ini', 'passwd']) {
        expect(everything, secret).not.toContain(secret);
      }
    });

    it('refuses a listed path asked for another session, and any path while nothing is listed', async () => {
      const { editor, calls } = fakeEditor();
      const { controller, streams, logs } = withOpenSession(undefined, editor);
      await controller.handle(open('src/a.ts'));
      emit(streams, 'session.step.ended', stepEnded('ses_1', ['src/a.ts']));
      await flush();
      await flush();
      await controller.handle(open('src/a.ts', 'ses_other'));
      expect(calls).toEqual([]);
      expect(logs.filter((l) => l === 'warn: diff open refused: session not open')).toHaveLength(2);
    });

    it('says so when the editor opened the file instead of a diff', async () => {
      const { editor } = fakeEditor({ diffOutcome: 'file' });
      const { controller, streams, posted, logs } = withOpenSession([rowFor('logo.png')], editor);
      emit(streams, 'session.step.ended', stepEnded('ses_1', ['logo.png']));
      await flush();
      await flush();
      await controller.handle(open('logo.png'));
      expect(noticeCodes(posted)).toEqual(['NoTextDiff']);
      expect(logs).toContain('info: diff opened (modified, file only)');
    });

    it('turns an editor failure into a warning notice', async () => {
      const failure = Object.assign(new Error('That file is not on disk any more'), {
        name: 'FileNotFound',
      });
      const { editor } = fakeEditor({ failWith: failure });
      const { controller, streams, posted, logs } = withOpenSession(undefined, editor);
      emit(streams, 'session.step.ended', stepEnded('ses_1', ['src/a.ts']));
      await flush();
      await flush();
      await controller.handle(open('src/a.ts'));
      expect(posted.at(-1)).toMatchObject({
        type: 'notice',
        level: 'warning',
        error: { code: 'FileNotFound' },
      });
      expect(logs.some((l) => l.startsWith('warn: session.diff.open failed: FileNotFound'))).toBe(
        true,
      );
    });
  });

  describe('diffOriginal', () => {
    it('rebuilds the old text from the complete patch of the range', async () => {
      const { controller, streams, diffInputs } = withOpenSession();
      emit(streams, 'session.step.ended', stepEnded('ses_1', ['src/a.ts']));
      await flush();
      await flush();
      expect(await controller.diffOriginal('ses_1', 'src/a.ts')).toBe('one\ntwo\n');
      expect(diffInputs.at(-1)).toEqual({ sessionID: 'ses_1', from: 'msg_1', to: 'msg_2' });
    });

    it('rejects a path that is not listed', async () => {
      const { controller } = withOpenSession();
      await expect(controller.diffOriginal('ses_1', 'src/a.ts')).rejects.toMatchObject({
        name: 'DiffNotListed',
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------
// E7-message-revert (issue #32): revert from a user message.
//
// Protects: the host refusing to stage from anything but a USER message of the OPEN session before
// the server rewrites a single file; the state reaching the webview once, in the snapshot and as
// `session.revert`; a committed revert clearing the webview through a snapshot and NEVER through an
// empty `session.revert` first (the hidden messages would flash back); the only confirmation being
// the "Discard for good" modal; the boundary bounding the "Changed files" range; and the whitelist
// of the "what the revert undid" diffs. Provenance: a FAKE client with hand-made `SessionRevert`
// rows (the real client over HTTP is `chatController.e2e.test.ts`; the real server, only with an
// empty `files`, is `realOpencode.test.ts`). `sessionRevert.test.ts` has the module's own logic.
// ---------------------------------------------------------------------------------------------
describe('message revert (issue #32)', () => {
  const userMessage = (id: string): SessionMessageInfo =>
    wire<SessionMessageInfo>(
      JSON.stringify({ id, type: 'user', text: 'hi', time: { created: 1 } }),
    );
  const undone: FileDiffInfo = {
    file: 'src/a.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    patch: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n',
  };
  /** A running controller with `ses_1` open, two user messages and a client that stages `msg_2`. */
  function withOpenSession(
    options: Parameters<typeof fakeApi>[0] = {},
    editor?: EditorActions,
    discard?: () => Promise<boolean>,
  ) {
    const api = fakeApi({
      sessions: ['ses_1'],
      userMessages: [userMessage('msg_1'), userMessage('msg_2')],
      stageImpl: (input) => Promise.resolve({ messageID: input.messageID, files: [undone] }),
      ...options,
    });
    const ctl = setup(api.api, 'ses_1', editor, undefined, undefined, discard);
    ctl.controller.onServerState(RUNNING);
    return { ...api, ...ctl };
  }
  const stage = (messageID = 'msg_2', sessionID = 'ses_1'): WebviewToHost => ({
    type: 'session.revert.stage',
    requestId: 'r1',
    sessionID,
    messageID,
  });
  const revertPosts = (posted: HostToWebview[]) =>
    posted.flatMap((m) => (m.type === 'session.revert' ? [m] : []));
  const mapped = {
    path: 'src/a.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
    tooLarge: false,
  };

  it('refuses a message that is not a user one, and a session that is not open, without staging', async () => {
    const { controller, posted, reverts, logs } = withOpenSession({
      messageTypes: { msg_a: 'assistant' },
    });
    await controller.handle(stage('msg_a'));
    await controller.handle(stage('msg_2', 'ses_other'));
    expect(reverts).toEqual([]);
    expect(posted.filter((m) => m.type === 'request.result')).toMatchObject([
      { requestId: 'r1', error: { code: 'NotAUserMessage' } },
      { requestId: 'r1', error: { code: 'SessionNotOpen' } },
    ]);
    expect(logs).toContain('warn: revert refused: not a user message');
    expect(logs).toContain('warn: revert refused: session not open');
  });

  it('answers the server error of a busy session or an unknown message as the result', async () => {
    const busy = withOpenSession({ revertError: { _tag: 'SessionBusyError', sessionID: 'ses_1' } });
    await busy.controller.handle(stage());
    expect(busy.posted.at(-1)).toMatchObject({
      type: 'request.result',
      error: { code: 'SessionBusyError' },
    });
    expect(revertPosts(busy.posted)).toEqual([]);
    const unknown = withOpenSession({ messageTypes: { msg_x: 'unknown' } });
    await unknown.controller.handle(stage('msg_x'));
    expect(unknown.reverts).toEqual([]);
    expect(unknown.posted.at(-1)).toMatchObject({ error: { code: 'MessageNotFoundError' } });
  });

  it('stages from a user message: publishes the state once and bounds the changed files', async () => {
    const { controller, posted, logs, reverts, diffInputs } = withOpenSession({
      diffImpl: () => Promise.resolve([]),
    });
    await controller.handle(stage());
    await flush();
    await flush();
    expect(reverts).toEqual(['stage msg_2']);
    expect(revertPosts(posted)).toEqual([
      {
        type: 'session.revert',
        sessionID: 'ses_1',
        revert: { messageID: 'msg_2', files: [mapped] },
      },
    ]);
    expect(posted.filter((m) => m.type === 'request.result')).toEqual([
      { type: 'request.result', requestId: 'r1' },
    ]);
    expect(logs).toContain('info: revert staged for ses_1: 1 files');
    // The range stops at the user message before the boundary (`msg_1`), one turn only.
    expect(diffInputs.at(-1)).toEqual({ sessionID: 'ses_1', from: 'msg_1', context: 0 });
  });

  // Defends against a resync that cannot read the open row (not in the list of 50 and `session.get`
  // failing) clearing a revert the server still has (review W2). Fake client: the failing read is
  // fabricated; no real server was made to fail like that.
  it('keeps the held revert in the snapshot when the open row cannot be read', async () => {
    let failGet = false;
    const { controller, snapshots } = withOpenSession({
      listImpl: () => Promise.resolve({ data: [], cursor: {} }),
      getImpl: (sessionID) =>
        failGet ? Promise.reject(new Error('down')) : Promise.resolve(sessionInfo(sessionID)),
    });
    await controller.handle(stage());
    await flush();
    failGet = true;
    await controller.onWebviewReady();
    expect(snapshots().at(-1)?.open?.revert).toMatchObject({ messageID: 'msg_2' });
  });

  it('does not repeat the state when the staged event follows the answer, and ignores another session', async () => {
    const { controller, posted, streams } = withOpenSession();
    await controller.handle(stage());
    emit(streams, 'session.revert.staged', {
      sessionID: 'ses_1',
      revert: { messageID: 'msg_2', files: [undone] },
    });
    emit(streams, 'session.revert.staged', { sessionID: 'ses_other', revert: { messageID: 'x' } });
    emit(streams, 'session.revert.cleared', { sessionID: 'ses_other' });
    await flush();
    await flush();
    expect(revertPosts(posted)).toHaveLength(1);
  });

  it('clears the state when the server says cleared, with an absent revert', async () => {
    const { controller, posted, streams } = withOpenSession();
    await controller.handle(stage());
    emit(streams, 'session.revert.cleared', { sessionID: 'ses_1' });
    await flush();
    await flush();
    expect(revertPosts(posted).at(-1)).toEqual({ type: 'session.revert', sessionID: 'ses_1' });
  });

  it('takes the revert of the session row into the snapshot, without a second message', async () => {
    const { controller, posted, snapshots } = withOpenSession({
      rowRevert: { messageID: 'msg_2', files: [undone] },
    });
    await controller.onWebviewReady();
    expect(snapshots().at(-1)?.open?.revert).toEqual({ messageID: 'msg_2', files: [mapped] });
    expect(revertPosts(posted)).toEqual([]);
  });

  it('a committed revert resyncs and never posts an empty session.revert first', async () => {
    const { controller, posted, streams, snapshots } = withOpenSession({
      rowRevert: { messageID: 'msg_2', files: [] },
    });
    await controller.onWebviewReady();
    posted.length = 0;
    emit(streams, 'session.revert.committed', { sessionID: 'ses_1', to: 'msg_2' });
    await flush();
    await flush();
    expect(revertPosts(posted)).toEqual([]);
    // A snapshot arrived after the event: that is what clears the webview.
    expect(snapshots().length).toBeGreaterThan(0);
  });

  describe('Restore and Discard for good', () => {
    const clear: WebviewToHost = {
      type: 'session.revert.clear',
      requestId: 'r2',
      sessionID: 'ses_1',
    };
    const commit: WebviewToHost = {
      type: 'session.revert.commit',
      requestId: 'r3',
      sessionID: 'ses_1',
    };

    it('restores from the answer, without waiting for the event', async () => {
      const { controller, posted, reverts, logs } = withOpenSession();
      await controller.handle(stage());
      await controller.handle(clear);
      expect(reverts).toEqual(['stage msg_2', 'clear']);
      expect(revertPosts(posted).at(-1)).toEqual({ type: 'session.revert', sessionID: 'ses_1' });
      expect(logs).toContain('info: revert cleared for ses_1');
      expect(posted.at(-1)).toEqual({ type: 'request.result', requestId: 'r2' });
    });

    it('asks with the native modal and commits only on yes', async () => {
      const yes = withOpenSession({}, undefined, () => Promise.resolve(true));
      await yes.controller.handle(commit);
      expect(yes.discardAsked()).toBe(1);
      expect(yes.reverts).toEqual(['commit']);
      const no = withOpenSession({}, undefined, () => Promise.resolve(false));
      await no.controller.handle(commit);
      expect(no.discardAsked()).toBe(1);
      expect(no.reverts).toEqual([]);
      expect(no.logs).toContain('info: revert commit cancelled ses_1');
      expect(no.posted.at(-1)).toEqual({ type: 'request.result', requestId: 'r3' });
    });

    it('forgets the revert and resyncs after a commit, and refuses another session', async () => {
      const { controller, posted, snapshots, logs } = withOpenSession();
      await controller.handle(stage());
      const before = snapshots().length;
      await controller.handle(commit);
      await flush();
      await flush();
      expect(snapshots().length).toBeGreaterThan(before);
      expect(snapshots().at(-1)?.open?.revert).toBeUndefined();
      posted.length = 0;
      await controller.handle({ ...commit, sessionID: 'ses_other' });
      expect(posted).toMatchObject([{ error: { code: 'SessionNotOpen' } }]);
      expect(logs).toContain('warn: revert refused: session not open');
    });

    it('a prompt sent with a revert prepared forgets it and resyncs', async () => {
      const { controller, snapshots, logs } = withOpenSession();
      await controller.handle(stage());
      const before = snapshots().length;
      await controller.handle({
        type: 'prompt.send',
        requestId: 'r9',
        text: 'next',
        delivery: 'queue',
        files: [],
      });
      await flush();
      await flush();
      expect(snapshots().length).toBeGreaterThan(before);
      expect(logs).toContain('info: prompt accepted for ses_1 (input msg_in)');
    });
  });

  describe('session.revert.open', () => {
    const open = (path: string, sessionID = 'ses_1'): WebviewToHost => ({
      type: 'session.revert.open',
      sessionID,
      path,
    });

    it('opens the diff of a file the revert undid and refuses one it did not list', async () => {
      const { editor, calls } = fakeEditor();
      const { controller, logs, posted } = withOpenSession({}, editor);
      await controller.handle(stage());
      await controller.handle(open('src/never.ts'));
      await controller.handle(open('../outside.ts'));
      await controller.handle(open('src/a.ts', 'ses_other'));
      expect(calls).toEqual([]);
      expect(logs.filter((l) => l === 'warn: revert diff open refused: not listed')).toHaveLength(
        2,
      );
      expect(logs).toContain('warn: revert diff open refused: session not open');
      expect(logs.join('\n')).not.toContain('never.ts');
      await controller.handle(open('src/a.ts'));
      expect(calls).toEqual([
        [
          'openDiff',
          {
            sessionID: 'ses_1',
            path: 'src/a.ts',
            absolute: path.resolve(SERVER.folder, 'src/a.ts'),
            status: 'modified',
            binary: false,
            side: 'reverted',
          },
        ],
      ]);
      expect(logs).toContain('info: revert diff opened (modified)');
      expect(posted.filter((m) => m.type === 'notice')).toHaveLength(3);
    });

    it('rebuilds the text before the revert from the patch the stage answered', async () => {
      const { controller } = withOpenSession();
      await expect(controller.revertedOriginal('ses_1', 'src/a.ts')).rejects.toMatchObject({
        name: 'DiffNotListed',
      });
      await controller.handle(stage());
      expect(await controller.revertedOriginal('ses_1', 'src/a.ts')).toBe('one\ntwo\n');
    });
  });
});
