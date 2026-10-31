// The chat brain of the extension host (issues #9/#14): owns the opencode client, the SSE loop,
// the snapshot and the answers to the webview. Pure: no `vscode` import. The VS Code side
// (`chatViewProvider.ts`, `chatLifecycle.ts`) only moves messages in and out.
//
// E9-chat-editor-tabs, phase 1 (issue #77, plan Engram #1238, decisions #1245): the controller is
// the shared CORE of one location (server, client, stream, connection, catalog, pending requests,
// resolutions, attachment whitelists, translator) and serves N chat surfaces, each one a
// {@link ChatPane} (`chatPane.ts`) holding what is per surface: the session it shows, its queues,
// its snapshot generation, its file search and session cursor, and its own "Changed files" and
// revert state. A webview message arrives as `handle(paneId, message)`; what the host produces is
// routed by `routeOf`: the content of a session to the panes showing it, the location's news to
// every pane, and the answer to a request ONLY to the pane that asked. A surface is the side-bar
// view or an editor tab (`chatLifecycle.ts`); the protocol does not know which. Wherever the text
// below says "the open session" or "the webview", read it as the one of the pane concerned.
//
// Flow: `onServerState(running)` -> client + `runEventStream`; each `server.connected` and each
// `location.shutdown` -> `resync()` (REST snapshot, because the stream has no replay); every
// other event -> `eventTranslator` -> `post`. Errors reaching the webview always go through
// `toErrorInfo` with the server URL and password as secrets (architecture rule 1).
//
// The info lines of the log are STABLE on purpose: the opt-in integration test waits for them
// (`webview ready`, `event stream connected`, `snapshot sent`, `prompt accepted for`,
// `turn finished`, `abort requested for <sid> (interrupted: <bool>)`, and from phase 3
// `permission asked <id> for <sid> (<action>)`, `permission <id> resolved: <decision>`,
// `form asked <id> for <sid>`, `form <id> resolved: answered|cancelled`,
// `permission reply sent for <id> (<decision>)`, `form reply sent for <id>`,
// `form cancel sent for <id>`, and from E3-resolved-history `resolution recorded <id>
// (<decision|outcome>)`). Never log the password or a token, nor the RESOURCES of a
// permission (they can be shell commands with secrets) nor the text of an answer.
//
// Phase 3 (issues #18/#44/#19/#10): permissions and forms belong to the location, so the snapshot
// reads them with `permission.request.list()` / `form.list()` and the stream forwards every
// session's; a host-side registry (`pendingRequests.ts`) feeds the badge and the notifications
// (`deps.attention`); replies, cancels and the saved-permissions manager call the client.
//
// E3-resolved-history (issues #56/#18): a second host-side memory (`requestResolutions.ts`) turns
// each `*.resolved` into a `RequestResolution` that travels with the message and, for the open
// session, inside every snapshot. Unlike the pending registry it is NOT emptied when the stream
// stops: it must survive a reconnection, a hidden view and Restart Server.
//
// E4-session-management (issue #20): the session list the webview browses (`sessions.query` ->
// `sessions.page`, with search and paging on the server and the cursor kept here), rename and
// delete (the delete is confirmed by the HOST with a native modal), and the open session being
// deleted (by us or by another client): the host forgets it, memory included. New log lines, also
// stable: `sessions page (<n>, more: <bool>)`, `session renamed <id>` (never the title),
// `session deleted <id>`, `session delete cancelled <id>`, `open session deleted <id>`. Neither
// titles nor search texts are logged: they are the user's words.
//
// E4-fork-subsessions (issue #21): `session.fork` (new root session with the history BEFORE a user
// message, opened right away) and the lineage of the open session (its subagent children and the
// rows of its parent / original, added to the snapshot). New stable log line: `session forked
// <origin> -> <new>` (ids only).
//
// E5-model-agent-selectors (issues #23/#24, plan Engram #1011, decisions #1012): the host loads the
// CATALOG of the server (models, providers, selectable agents, default model; `loadCatalog`),
// pushes it to the webview as `catalog` and reloads it on the reload events of the server. A
// `prompt.send` may carry the model and agent the user chose; the choice is applied ON SEND, after
// being validated against the catalog (the server validates neither). New stable log lines, ids
// only: `catalog loaded (<n> models, <m> agents, <k> commands)` (the third count since issue #33),
// `model selected <providerID>/<id> for <sid>`, `agent selected <id> for <sid>`,
// `default model setting ignored: invalid|unavailable`.
//
// E8-slash-commands (issue #33, plan Engram #1415, decisions #1416): the catalog also carries the
// slash COMMANDS of the server (`command.list`, with its own failure handling; reloaded on
// `command.updated`), and a `prompt.send` with `command` is run through `session.command` instead
// of `session.prompt`, after the same checks (the host revalidates the name against its catalog).
// New stable log lines: `command accepted /<name> for <sid>`, `command list failed: <code>: <msg>`,
// and the three of the re-read of an empty list: `commands loaded after retry <n> (<k> commands)`,
// `command list still empty after 3 retries`, `command list retry failed: <code>: <msg>`.
//
// E7-file-context (issues #28/#29, plan Engram #1059, decisions #1064/#1065): `@` mentions and the
// editor context. The host searches files (`files.search` -> `files.found`) and builds every
// attachment `uri` itself; `prompt.send` accepts the union of `pickedUris` (dialog, editor) and
// `offeredUris` (search results, capped). New stable log lines, counts only: `file search: <n>
// results`, `file search failed: <code>`, `editor context added: <n> file(s), <m> selection(s)`.
// Neither the query nor any path is logged.
//
// E7-session-diff (issue #31, plan Engram #1150, decisions #1152-#1154): the "Changed files" list of
// the open session (first user message to last) and its native diffs. The state, the whitelist and
// the reconstruction of the original text live in `sessionDiff.ts`; this file only reloads the list
// on the events that can change it (`watchChangedFiles`), re-sends it after a snapshot, and handles
// `session.diff.open` (`openChangedFile`) and the originals (`diffOriginal`). New stable log lines,
// counts and ids only, never a path: `session diff: <n> files for <sid>`, `session diff failed:
// <code>`, `diff opened (<status>[, file only])`, `diff open refused: not listed|session not open`.
//
// E7-message-revert (issue #32, plan Engram #1173, decisions #1174): revert from a user message. The
// host validates that the message is a USER one of the open session before the server rewrites any
// file (`session.revert.stage`), keeps the prepared revert in `sessionRevert.ts` (its boundary
// bounds the "Changed files" range), publishes it as `session.revert` and inside the snapshot, and
// asks for the only confirmation, a native modal, on "Discard for good" (`session.revert.commit`).
// An accepted prompt with a revert prepared makes the server commit it, so the host forgets it and
// resyncs (`afterCommit`). New stable log lines, ids and counts only, never a path: `revert staged
// for <sid>: <n> files`, `revert cleared for <sid>`, `revert committed for <sid>`, `revert
// refused: <reason>`, `revert commit cancelled <sid>`, `revert diff opened (<status>)`, `revert
// diff open refused: not listed|session not open`; and `prompt accepted for <sid> (input <id>)`.

import type { V2Event } from '@opencode/client';
import type { Catalog, ErrorInfo, ModelRef, SessionStatus, SessionSummary } from '../shared/model';
import {
  dispatch,
  MAX_DROPPED_ITEMS,
  MAX_FILE_SEARCH_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  type AttachmentRef,
  type ConnectionState,
  type HostToWebview,
  type OpenSession,
  type PendingAsks,
  type PromptMention,
  type SetupAction,
  type Snapshot,
  type UiCommand,
  type WebviewToHost,
} from '../shared/protocol';
import {
  ChatPane,
  FOCUS_REQUEST_TTL_MS,
  routeOf,
  type FocusTarget,
  type PaneSurface,
} from './chatPane';
import { buildContextPrompt, type ContextAction, type ContextDiagnostic } from './contextPrompts';
import { createEventTranslator, type EventTranslator, type ResyncToken } from './eventTranslator';
import { runEventStream, type StreamState } from './eventStream';
import { toSearchRefs } from './fileMentions';
import { resolvePreferredModel } from './modelPreference';
import { PASTED_IMAGE_SCHEME, PastedImages } from './pastedImages';
import type { ChatApi } from './opencodeClient';
import { safeLog, type ServerLog } from './opencodeServer';
import { createPendingRequests, type PendingSummary } from './pendingRequests';
import { createRequestResolutions } from './requestResolutions';
import type { RunningServerInfo, ServerState } from './serverManager';
import { createSessionBrowser, type SessionPage } from './sessionBrowser';
import { codedError, createSessionDiffs, type DiffTarget } from './sessionDiff';
import { createSessionLineage, MAX_LINEAGE_DEPTH } from './sessionLineage';
import { createSessionReverts } from './sessionRevert';
import {
  lastCompactionAt,
  toAgentOptions,
  toCommandOption,
  toErrorInfo,
  toFormAsk,
  toMessage,
  toModelOption,
  toModelRef,
  toPermissionAsk,
  toProviderOption,
  toSessionSummary,
  toStructuredErrorInfo,
  type ErrorSecrets,
} from './wireMapping';

/** How many sessions the snapshot asks for (the API default is 50; ours, kept explicit). */
const SESSION_LIMIT = 50;

/** How many messages of the open session the snapshot asks for (the API maximum is 200). */
const MESSAGE_LIMIT = 200;

/**
 * How many files one `@` search asks for. Our choice (issue #28): a popup of 20 rows is already
 * more than fits in a side bar, and the server ranks the best match first. The server's own
 * default is 50 (`search.ts@843a6c51`, read).
 */
export const FILE_SEARCH_LIMIT = 20;

/**
 * How many search results the host remembers as attachable (`offeredUris`); the oldest are
 * forgotten first. Our choice (issue #28), generous because a result is only a short string and a
 * chip can sit in the prompt for a long time; a chip whose result was evicted is refused with
 * `AttachmentRejected` and the user picks it again (it takes more than 5000 results to get there).
 */
export const OFFERED_URIS_MAX = 5000;

/**
 * Where the controller keeps the id of the last session this extension opened IN EACH FOLDER
 * (workspaceState, phase 3). Per folder because a session lives in its location: with a multi-root
 * window and a server that serves one folder at a time, a single remembered id would point at a
 * session of another folder after switching.
 */
export interface SessionMemory {
  get(folder: string): string | undefined;
  set(folder: string, sessionID: string | undefined): Promise<void>;
}

/** A rule stored by "Always", as the saved-permissions manager lists it. */
export interface SavedPermission {
  id: string;
  action: string;
  resource: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/**
 * The attention feature as the controller sees it (issue #19, implemented in `attention.ts`):
 * told the whole set of pending requests every time it changes, and with `[]` when the server
 * goes away. It decides by itself which requests a visible surface shows, asking
 * {@link ChatController.displays} (issue #77 E4). The controller calls `update` again, with the
 * same set, whenever the lineage learns something that can change who shows a pending request
 * (a `session.get` of {@link ChatController.resolveLineage}, or a snapshot with new rows), so
 * the answer of `displays` is re-read; `update` must therefore be idempotent.
 */
export interface AttentionSink {
  update(requests: readonly PendingSummary[]): void;
}

/**
 * One page of ROOT sessions for the native Sessions tree (issue #77, delivery E3). `statuses` is
 * only the `busy` ones REST knows, completed with what the stream said since the read started;
 * `folder` is the one the server serves.
 */
export interface SessionListPage {
  folder: string;
  rows: readonly SessionSummary[];
  statuses: { [sessionID: string]: SessionStatus };
  hasMore: boolean;
}

/** The session events the tree follows (a subset of what {@link ChatController.publish} sends). */
export type SessionListEvent = Extract<
  HostToWebview,
  { type: 'session.upserted' | 'session.removed' | 'session.status' }
>;

/** What {@link ChatController.searchSessions} found: root rows, newest activity first. */
export interface SessionSearchResult {
  rows: SessionSummary[];
  hasMore: boolean;
}

/**
 * Where the controller reports the root sessions of the served folder for the native Sessions tree
 * (issue #77, E3; the model is `sessionTree.ts`, wired by `chatLifecycle.ts`). Optional: without it
 * the controller does exactly what it did before the tree existed (four reads per full resync, no
 * extra REST call, nothing forwarded). Every method must be cheap and must not throw.
 */
export interface SessionListSink {
  /** The first page of a FULL resync: replaces the window it covers (see `sessionTree.ts`). */
  reset(page: SessionListPage): void;
  /** The read of that first page failed: the tree shows an error and no rows until the next one. */
  failed(): void;
  /** The page a "Show more" read: added to the rows held, nothing is pruned. */
  append(rows: readonly SessionSummary[], hasMore: boolean): void;
  /** A session event, also when no pane is open. */
  event(message: SessionListEvent): void;
  /** The connection state changed (every state the panes are told about). */
  connection(connection: ConnectionState): void;
}

/** What the controller needs from the VS Code side to manage the server (issue #10). */
export interface ServerCommands {
  /** Restarts the server; fire and forget (the outcome is the connection state). */
  restart(): void;
  /** Shows the OpenCode output channel. */
  showLogs(): void;
}

/**
 * What the controller needs from the VS Code side to run the buttons of the setup guide and the
 * error card (E2, issue #85; implemented by `setupActions.ts`). "Choose binary…" is split in four
 * so the order of its steps (issue #86) lives in the controller and is unit-tested:
 * `writeBinaryPath` rejects when the setting cannot be written and the controller answers
 * `setup.binary` `failed` plus a `warning` notice. The others are fire and forget, like
 * {@link ServerCommands}.
 */
export interface SetupCommands {
  /** File dialog; the chosen file system path, or `undefined` when the user cancelled. */
  pickBinary(): Promise<string | undefined>;
  /** The current (trimmed) value of `openVsCode.opencodePath`; `''` when unset. */
  currentBinaryPath(): string;
  /** Writes `path` to `openVsCode.opencodePath` (the change event re-runs the detection). */
  writeBinaryPath(path: string): Promise<void>;
  /** Re-runs the binary detection; for a pick equal to the current value, which fires no event. */
  redetectBinary(): void;
  /** Opens Settings filtered to `openVsCode.opencodePath`. */
  openBinarySettings(): void;
  /** Opens Settings filtered to `openVsCode.serverUrl`. */
  openServerSettings(): void;
  /** Runs the existing "Set Server Password" command. */
  setServerPassword(): void;
  /** Opens the install page of opencode v2 in the browser. */
  openInstallGuide(): void;
  /** Opens VS Code's "Open Folder" dialog. */
  openFolder(): void;
}

/** What the controller tells the VS Code side about the chat's keyboard focus (issue #35). */
export interface ChatUi {
  /**
   * Some chat surface has (`focused` true) or has not (false) the keyboard focus; mirrored into a
   * context key. `focused` is the state of ALL panes together (true while at least one holds the
   * focus), and `paneId` is the pane whose message or removal caused this call, so a surface-aware
   * implementation can tell which one changed. An implementation that ignores `paneId` keeps
   * working.
   */
  setChatFocused(focused: boolean, paneId: number): void;
  /**
   * Hands the keyboard to the iframe of surface `paneId` again. Asked after a `ui.command` or a
   * `prompt.compose` that had to wait for a new document. HYPOTHESIS (see `registerChat`): the
   * focus given while the document was loading went nowhere. Seen once in a `test:visual` step 22
   * run without this call (the new document had `hasFocus()` false); not a check, and its
   * necessity was not proven.
   */
  focusView(paneId: number): void;
  /**
   * Brings the surface of `paneId` to the front without changing what it shows. The controller
   * calls it when `session.open` asks for a session that ANOTHER pane already shows. Absent means
   * there is a single surface, so that case cannot arise.
   */
  revealPane?(paneId: number): void;
  /**
   * Lets the VS Code side serve a request in another surface instead of the asking pane: opens (or
   * reveals) the surface for `sessionID`, or a lazy one when it is `undefined` (`session.new`).
   * Returns `true` when it did, and the asking pane is then left untouched. Absent or `false`
   * means "do it in the asking pane", which is the behavior when the chat lives in one view.
   */
  openElsewhere?(fromPaneId: number, sessionID: string | undefined): boolean;
}

// Where `ui.focus` points and how long a focus request waits live with the pane that keeps them.
export { FOCUS_REQUEST_TTL_MS, type FocusTarget } from './chatPane';

/**
 * What the webview may ask the editor to do (issues #13/#15). Implemented in
 * `editorActions.ts` (the only side that imports `vscode`); the controller stays pure. Every
 * method rejects with an `Error` whose `name` is a stable code (`NoWorkspace`, `OutsideWorkspace`,
 * `NoActiveEditor`...) and whose message is fit for the user: the controller turns it into a
 * `notice`. The text to copy or insert is never logged.
 */
export interface EditorActions {
  /**
   * Opens `path` (relative to the served folder, absolute or `file://`) at a 1-based position.
   * `folder` is the folder the SERVER serves; when it is given, the path is resolved against it
   * (issue #28: with several workspace folders the chip of a file of the served one must open),
   * otherwise against the folder the host would pick on its own.
   */
  open(path: string, line?: number, column?: number, folder?: string): Promise<void>;
  /**
   * Issue #29: the references to attach for the active editor. Rejects with `NoActiveEditor`
   * (nothing open), `NoFileOnDisk` (untitled or a non-`file` scheme) or `OutsideWorkspace` (the
   * file is not inside `folder`, or there is no `folder`). See {@link EditorContext}.
   * Issue #36: `options.uri` (a URI string) is the document the context menu was opened on, which
   * is not always the active editor (a split, the left side of a diff); the editor showing it is
   * used, and the active editor when none shows it. `options.diagnostics` also reads the errors
   * and warnings of the selections (or of the whole file) into `EditorContext.diagnostics`.
   */
  editorContext(
    folder: string | undefined,
    options?: { uri?: string; diagnostics?: boolean },
  ): Promise<EditorContext>;
  /** Replaces every selection of the active editor with `text`. */
  insert(text: string): Promise<void>;
  /** Opens an untitled document with `text`; `language` is a VS Code language id. */
  newFile(text: string, language?: string): Promise<void>;
  /** Puts `text` on the system clipboard. */
  copy(text: string): Promise<void>;
  /**
   * Shows the file picker; the returned `uri`s join the ones `prompt.send` accepts (with the ones
   * `files.search` listed and the ones `editorContext` returned: the host only sends what it
   * emitted itself). `kind` `image` (E2, decision P11) filters the dialog to the image types and
   * keeps only files with an image extension; absent or `file` is the plain picker.
   */
  pickFiles(kind?: 'file' | 'image'): Promise<AttachmentRef[]>;
  /**
   * Issue #30: turns the URIs of a drop (or of "Add to OpenCode Chat") into chips. Only regular
   * files inside `folder` come back in `refs`; the rest is counted in `skipped`. Rejects with
   * `OutsideWorkspace` when there is no `folder`. See {@link DroppedFiles}.
   */
  droppedFiles(folder: string | undefined, uris: readonly string[]): Promise<DroppedFiles>;
  /**
   * Issue #31: opens the native diff editor for a file the host listed in "Changed files" (the
   * caller already checked the whitelist), original on the left and the file on disk on the right.
   * Resolves `'diff'` when it did, or `'file'` when there is no text diff to show (a binary, or a
   * patch the server cut) and the file itself was opened instead; rejects with `FileNotFound` when
   * there is nothing to open. See {@link DiffTarget}.
   */
  openDiff(target: DiffTarget): Promise<'diff' | 'file'>;
}

/**
 * What the active editor contributes to a prompt (issue #29): the whole file, or one reference per
 * non-empty selection (`ranged` of them, each limited to its lines). `unsaved` is true when the
 * buffer differs from the disk: the server reads the SAVED file (decision Q3 of Sergio), so the
 * user is warned. Never carries the text of the buffer. `diagnostics` (issue #36) is only filled
 * when the caller asked for it (`options.diagnostics`): the errors and warnings VS Code reports for
 * the selected lines, or for the whole file when nothing is selected; absent means "not asked or
 * none", and carries messages of the language service, not file text.
 */
export interface EditorContext {
  refs: AttachmentRef[];
  ranged: number;
  unsaved: boolean;
  diagnostics?: ContextDiagnostic[];
}

/**
 * What {@link ChatController.composeFromEditor} and {@link ChatController.composeFromFiles} did
 * (issue #36). `composed`: a `prompt.compose` was handed to the pane. `rejected`: nothing was
 * composed and `error` says why, for the caller to show as a NATIVE warning (decision P11=1 of
 * Sergio, 29/10/2026: the click was in the editor or the Explorer, the chat may be closed and a
 * `request.result` would be lost with its view). `notified`: nothing valid was left but the
 * "N items were not added" notice is already in the chat (decision P8=1), so the caller has no
 * second message to show.
 */
export type ComposeOutcome =
  { status: 'composed' } | { status: 'rejected'; error: ErrorInfo } | { status: 'notified' };

/**
 * What {@link EditorActions.droppedFiles} made of a drop: the chips of the regular files of the
 * served folder, and how many items were refused. `missing` also counts URIs that could not be
 * read at all; `remote` is any scheme but `file`.
 */
export interface DroppedFiles {
  refs: AttachmentRef[];
  skipped: { folders: number; outside: number; remote: number; missing: number };
}

/** External effects of the controller, injected so tests need no VS Code, network or processes. */
export interface ChatControllerDeps {
  createClient(server: RunningServerInfo): ChatApi;
  log: ServerLog;
  memory: SessionMemory;
  editor: EditorActions;
  attention: AttentionSink;
  /**
   * The native Sessions tree (issue #77, E3). Absent in the unit tests written before it and in
   * any host that has no tree; see {@link SessionListSink}.
   */
  sessionList?: SessionListSink;
  /** The QuickPick that picks which saved permissions to revoke; resolves with their ids. */
  savedPermissions: { pickToRevoke(items: SavedPermission[]): Promise<string[]> };
  /**
   * The native modal that confirms deleting a session (issue #20); resolves `true` only on
   * "Delete". `title` comes from the server (`session.get`), `running` from `session.active()`.
   */
  sessions: {
    confirmDelete(info: { title: string; running: boolean }): Promise<boolean>;
    /** The native modal of "Discard for good" (issue #32); resolves `true` only on that button. */
    confirmRevertDiscard(): Promise<boolean>;
  };
  preferences: ModelPreferences;
  server: ServerCommands;
  /** The buttons of the setup guide and the error card (E2, issue #85). */
  setup: SetupCommands;
  ui: ChatUi;
  /** The SSE loop; replaced in tests. */
  runStream?: typeof runEventStream;
}

/**
 * What the controller needs to know about the user's model preferences (issue #23). Injected so the
 * controller stays free of `vscode`: `chatLifecycle.ts` reads the `openVsCode.defaultModel` setting
 * and keeps the last model in `globalState`.
 */
export interface ModelPreferences {
  /** The raw text of `openVsCode.defaultModel` (`provider/model`), or `undefined` when unset. */
  defaultModel(): string | undefined;
  /** The model the last accepted prompt was sent with, or `undefined`. */
  lastModel(): ModelRef | undefined;
  /** Remembers `ref` as the last model used; may reject, the controller logs and goes on. */
  setLastModel(ref: ModelRef): Promise<void>;
}

/**
 * Human-readable suffix for the log line of a model choice: ` (variant high)`, or empty when the
 * reference has none. The variant is a catalog id (checked against the catalog before any log),
 * never user text. Appended at the END of the line so older exact-match lines keep their prefix.
 */
function variantSuffix(model: ModelRef): string {
  return model.variant === undefined ? '' : ` (variant ${model.variant})`;
}

/**
 * Rebuilds a model reference coming from the webview as a plain `{ providerID, id, variant? }`,
 * dropping the `"default"` spelling of "no variant" (issue #61). The webview never sends it, but it
 * is untrusted input and `"default"` is not in a model's `variants` (opencode filters it out of the
 * catalog, `core/variant.ts@843a6c51`), so it would be refused as unavailable. The copy is always
 * new on purpose: `isModelRef` does not reject extra keys, and a foreign key must not travel on to
 * `switchModel`, `session.create` or the persisted last model.
 */
function withoutDefaultVariant(model: ModelRef): ModelRef {
  const plain = { providerID: model.providerID, id: model.id };
  return model.variant === undefined || model.variant === 'default'
    ? plain
    : { ...plain, variant: model.variant };
}

/** True when two references name the same model and variant; an absent variant is "default". */
function sameModel(a: ModelRef, b: ModelRef): boolean {
  return a.providerID === b.providerID && a.id === b.id && (a.variant ?? '') === (b.variant ?? '');
}

/** The `_tag` of a thrown server error body, or `undefined` when it is not one. */
function tagOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const tag = (error as { _tag?: unknown })._tag;
  return typeof tag === 'string' ? tag : undefined;
}

/** True when the thrown value is the server's `SessionNotFoundError` body (`_tag`), not an Error. */
function isSessionNotFound(error: unknown): boolean {
  return tagOf(error) === 'SessionNotFoundError';
}

/**
 * True when a reply failed because the request is no longer pending (someone else answered it, or
 * it died): the snapshot, not our view, tells the truth then. `FormInvalidAnswerError` is NOT in
 * the list: the request is still pending and the card must show what to fix. Tags read in
 * `types.d.ts` of `@opencode/client@2.0.32` (L3549-3610); not provoked against a real server.
 */
function isStaleRequest(error: unknown): boolean {
  const tag = tagOf(error);
  return (
    tag === 'PermissionNotFoundError' ||
    tag === 'FormNotFoundError' ||
    tag === 'FormAlreadySettledError' ||
    tag === 'RequestNotPending' // ours: the host's registry did not know the request
  );
}

/**
 * Server events after which the catalog may have changed (all volatile, `data: {}`): the list of
 * models, providers or agents, the credentials behind them, or the config that names the default.
 * Names read in the client types of 2.0.32 and `references/eventos-v2.md`; VERIFIED in the issue
 * #23 spike that a burst of them (nine in the same millisecond) follows the first use of a
 * session. Not exercised against a real server by changing a credential (UNVERIFIED).
 */
const CATALOG_RELOAD_EVENTS: ReadonlySet<string> = new Set([
  'model.updated',
  'provider.updated',
  'agent.updated',
  'integration.updated',
  'credential.updated',
  'config.updated',
  'command.updated', // issue #33: command files changed or an MCP server's prompts did
]);

/** Snapshot with no sessions, sent when there is no server to ask. */
const EMPTY_SNAPSHOT: Snapshot = {
  sessions: [],
  statuses: {},
  requests: { permissions: [], forms: [] },
  resolutions: [],
};

/**
 * What {@link ChatController.readPane} read for one pane, waiting for the synchronous publication:
 * the session it showed when the reads started (`openID`; the pane may show another one, or none,
 * by publication time), the history as the snapshot's `open` (absent without a session), the raw
 * messages the translator is seeded with, the session rows (the location's plus the pane's own
 * and its lineage) and the REST statuses.
 */
interface PaneRead {
  openID: string | undefined;
  open: OpenSession | undefined;
  rawMessages: Awaited<ReturnType<ChatApi['message']['list']>>['data'];
  sessions: SessionSummary[];
  statuses: { [sessionID: string]: SessionStatus };
}

/**
 * Coordinates the opencode client, the event stream and the chat surfaces (panes).
 *
 * Decisions (plan `E2-mvp-prototype/plan-fase1`): the open session is the last one this extension
 * created or opened, kept in `workspaceState` (alternative discarded: the most recent of
 * `session.list`, which could drop a prompt into a session of the TUI); with none, the first
 * prompt creates one. `prompt.send` always goes with the delivery the webview chose (the UI sends
 * `queue`). A resync started while another one is in flight wins: only the newest publishes.
 * Phase 2 (`plan-fase2`) added abort, the editor actions behind `deps.editor` and attachments
 * restricted to what the picker emitted; it did not touch `resync`, `onEvent` or the translator.
 * Phase 3 (`plan-fase3`) adds, in this class: permission replies and form replies/cancels; the
 * pending requests of the LOCATION (snapshot and stream) and their registry for the badge and the
 * notifications; the cure for the one thing the server never publishes (an interrupt deletes a
 * pending permission WITHOUT `permission.replied`, read in `permission.ts@v2.0.32` L247-258, so an
 * `interrupted`/`failed` of a session that had requests triggers a resync); the saved-permissions
 * manager; `focusRequest`; restart/log commands; and the remembered session PER FOLDER.
 * Issue #20 (`E4-session-management`, plan Engram #977, decisions #978) adds the session list,
 * rename and delete, and makes "New session" LAZY: it creates nothing on the server, it only makes
 * the controller forget the open session, and the first prompt creates one through `sendPrompt`.
 * Deleting the open session leaves NO session open (alternative discarded: open the newest one,
 * which could drop the next prompt into a session of the TUI; same reasoning as the remembered
 * session above).
 * Issue #21 (`E4-fork-subsessions`, plan Engram #1000, decisions #1001) adds `session.fork`: the
 * HOST calls the server, mirrors the new row, publishes it as `session.upserted` and opens the
 * session (the webview gets no new host message, only `session.upserted` + `snapshot`); a fork made
 * by another client arrives as a bare `session.forked` event, which carries no title, so
 * {@link refreshSession} reads the row. `resync` also brings the lineage of the open session.
 * Issues #23/#24 (`E5-model-agent-selectors`, plan Engram #1011, decisions #1012) add the CATALOG:
 * `loadCatalog` reads models, providers, agents and the default model IN PARALLEL with `resync`
 * (not inside it: `model.list` waits for the plugins and must not delay the snapshot), keeps the
 * result in `catalog`, REPLACES it whole on every load (the host-registry rule) and pushes it to the
 * webview; the reload events of the server trigger it again, coalesced into at most one more run.
 * The choice of model and agent is a draft in the webview and travels in `prompt.send`; `sendPrompt`
 * validates it against `catalog` and applies it just before the prompt (alternative discarded:
 * apply on every click, which adds `*-switched` noise and reconfigures a running turn).
 * Issues #28/#29 (`E7-file-context`, plan Engram #1059) add the file context: `files.search` asks
 * the server for files matching the text after an `@` and answers `files.found` (never a
 * `request.result`; each search aborts the previous one, and a superseded or late answer is
 * dropped), `attachments.fromEditor` takes the active file or selections from the editor, and
 * `prompt.send` accepts the `uri`s of both (`offeredUris` for search results, capped, plus
 * `pickedUris` for the dialog and the editor, whose threat model is on that field) and forwards a
 * file's `mention` only when it
 * points at the prompt text it claims. `editor.open` is resolved against the SERVED folder.
 * Issue #31 (`E7-session-diff`, plan Engram #1150) adds the "Changed files" list: `diffs`
 * (`sessionDiff.ts`) loads it for the OPEN session on the events of {@link watchChangedFiles} and
 * after every snapshot, and the host opens a diff (`session.diff.open`) only for a path it listed.
 * VERIFIED with a fake client (unit tests) and against a synthetic HTTP/SSE server
 * (`chatController.e2e.test.ts`, real client and stream loop). The permission and question flows
 * against a real opencode are exercised only by the opt-in `realOpencode.test.ts` (see its
 * header for what a run observed); POSIX UNVERIFIED.
 */
export class ChatController {
  private readonly log: ServerLog;
  private readonly runStream: typeof runEventStream;
  private server: RunningServerInfo | undefined;
  private client: ChatApi | undefined;
  private translator: EventTranslator = createEventTranslator();
  private streamAbort: AbortController | undefined;
  private connection: ConnectionState = { state: 'starting' };
  /**
   * The chat surfaces, by pane id. Each one keeps its own session; only a server for a NEW folder
   * replaces them (the primary pane, i.e. the side-bar view, takes the session remembered for that
   * folder, else the first pane does; the others none).
   */
  private readonly panes = new Map<number, ChatPane>();
  /**
   * The panes whose webview reported `chat.focusChanged` with `focused: true` and not yet false.
   * A set, not a boolean: with two surfaces a `blur` of A can arrive after the `focus` of B, and
   * a single flag would read "not focused" while B holds the keyboard.
   */
  private readonly focusedPanes = new Set<number>();
  private nextPaneId = 1;
  /**
   * The folder of the last server that ran, so a restart of the SAME folder keeps the session of
   * every pane, while another folder resets them (a session lives in its location).
   */
  private lastFolder: string | undefined;
  /**
   * Pane id -> the session {@link restorePane} bound to it, until the first read of that pane
   * ({@link readPane}) consumes it. Only a restored session whose first read finds it deleted
   * earns the Q1 notice; any other pane that loses its session keeps today's silent behaviour.
   */
  private readonly restored = new Map<number, string>();
  /**
   * Panes whose restored session turned out not to exist and whose Q1 notice has not been
   * delivered yet. {@link readPane} adds the pane; {@link publishSnapshot} removes it only when
   * the pane was deliverable, because a hidden or not-ready tab drops every post and the notice is
   * one-shot (consume on delivery, not on read). Cleared by {@link detachPane} and by a real
   * change of folder.
   */
  private readonly lostSession = new Set<number>();
  /**
   * Bumped by every resync and when the server goes away. Only consulted by a resync that targets
   * NO pane (the controller can resync before any surface exists); with panes, their own
   * `generation` decides.
   */
  private locationGeneration = 0;
  /** Listeners of {@link onDiffRenewed}; each pane's holder feeds all of them. */
  private readonly renewedListeners = new Set<(sessionID: string) => void>();
  /**
   * `uri`s the host took from four sources: the native file dialog, `editorContext`, a drop and
   * the "Add to OpenCode Chat" command. `prompt.send` accepts these and {@link offeredUris}, plus
   * the live pasted images of {@link images}, no other attachment. No cap: a user does not pick
   * thousands.
   *
   * Threat model, as it stands (decision W2 of Sergio, 22/10/2026, widened by issue #30). The
   * dialog is a native modal, so only the user can fill it, and so is the Explorer command
   * (`addToChat`): a click the host sees. `attachments.fromEditor` is NOT a proof of a click: it
   * is a webview message, and a compromised webview can send it without the user. What bounds it
   * is on the editor side: it yields only the file ACTIVE in the editor (or its selections), and
   * only when that file is inside the served folder (`OutsideWorkspace` otherwise). So the worst
   * a compromised webview gets whitelisted that way is the file the user already has in front of
   * them inside the project, `.env` or a git-ignored file included; the model's `read`
   * permission is skipped for it. `attachments.drop` is also only a webview message (the host
   * sees no drag), and it takes ANY path, so it is bounded harder (decision Q2 of Sergio,
   * 23/10/2026): a dropped URI is whitelisted only if it is a `file:` URI of a regular file inside
   * the served folder AND `file.find` of the server lists that exact file, so what git ignores
   * (`.env` included) cannot enter by a drop; for those there is Attach, whose dialog needs the
   * user. The Explorer command skips the `file.find` step on purpose (the user chose that file in
   * a click the host sees, the same trust as Attach) but keeps the folder and regular-file rules.
   * A pasted image is not a path: the host holds the bytes it validated (`pasted-image:` URIs) and
   * nothing else. Symlinks are not resolved anywhere (the check is lexical). Accepted risk.
   */
  private readonly pickedUris = new Set<string>();
  /** Pasted images that can still be sent (issue #30); bytes live only here, never in the webview. */
  private readonly images = new PastedImages();
  /** Counter of the synthetic request ids of "Add to OpenCode Chat" (no webview request to answer). */
  private menuRequests = 0;
  /**
   * `uri`s the host listed in `files.found`, in insertion order and capped at
   * {@link OFFERED_URIS_MAX}. Kept apart from `pickedUris` because they are not a choice yet: a
   * result becomes a chip only when the user picks it, but the host cannot tell which, so every
   * result stays attachable. Narrower than "any file inside the folder", which a compromised
   * webview could use to attach `.env` and skip the model's `read` permission.
   */
  private readonly offeredUris = new Set<string>();
  private readonly pending = createPendingRequests();
  /**
   * Who is whose ancestor among the sessions seen (issue #77 E4): decides which chat tab shows a
   * request ({@link displays}) and under which root the Sessions tree marks "Needs input"
   * ({@link rootOf}). Fed by every `session.upserted`, every snapshot and the reads of
   * {@link resolveLineage}; emptied when the folder changes.
   */
  private readonly lineage = createSessionLineage();
  /** Sessions with a {@link resolveLineage} in flight, so one request does not start two walks. */
  private readonly lineageReads = new Set<string>();
  /** Bumped when the server goes away: a walk started under an older value publishes nothing. */
  private lineageEpoch = 0;
  /**
   * What the user answered, kept for the history (E3-resolved-history). Created ONCE for the life of
   * the controller and never emptied by `stopStream`/`onServerState`: that is what makes the lines
   * survive Restart Server (the controller is not recreated, only the client).
   */
  private readonly resolutions = createRequestResolutions({ now: () => Date.now() });
  /**
   * Requests the stream announced or resolved while a resync was reading REST, so the snapshot can
   * be completed with them (same problem and cure as `translator.mergeLive` for messages: the
   * webview REPLACES its requests with the snapshot). Only filled while a resync is in flight, so
   * it stays bounded.
   */
  private readonly live = {
    permissions: new Map<string, PendingAsks['permissions'][number]>(),
    forms: new Map<string, PendingAsks['forms'][number]>(),
    gone: new Set<string>(),
    /** Sessions deleted during the reads: their requests in the REST lists are already dead. */
    removed: new Set<string>(),
  };
  private resyncing = 0;
  /**
   * Ids with a {@link refreshSession} read in flight. A `session.removed` for the id takes it out
   * (`live.removed` only records during a resync, so it cannot guard that call); the read then
   * drops its row. Entries leave when their read ends, so the set stays bounded.
   */
  private readonly refreshing = new Set<string>();
  /**
   * Sessions this controller is deleting, so the `session.removed` that comes back is not
   * announced as "deleted elsewhere". The id only lives for the duration of `deleteSession`: it
   * leaves the set when the FIRST `session.removed` for it is consumed by `onSessionRemoved` (the
   * server's, which arrives before the HTTP answer, or the one the controller publishes itself
   * after the 204 when the stream is down), or when the call fails. So the set never grows and
   * needs no bound.
   */
  private readonly deleting = new Set<string>();
  private disposed = false;
  /**
   * Pagination of the native Sessions tree (issue #77, E3), apart from every pane's browser: the
   * tree reads the first page in the FULL resync and the next ones on "Show more". Used only when
   * `deps.sessionList` exists.
   */
  private readonly treeBrowser = createSessionBrowser();
  /** Pagination of the tree's "Search Sessions…" QuickPick; its own cursor, never the tree's. */
  private readonly searchBrowser = createSessionBrowser();
  /** Bumped by every {@link searchSessions}: only the newest answer is returned. */
  private searchTicket = 0;
  /**
   * Bumped when the tree's first page is read (and when the server goes away): a "Show more" that
   * started before it must not append rows older than a list that has just been replaced.
   */
  private treeEpoch = 0;
  /**
   * True once rows of the tree were mirrored in the translator. While it is, the seed of a snapshot
   * adds to the mirror instead of replacing it (R2 of the E9 plan): otherwise one pane's resync
   * would forget the rows loaded with "Show more", and a `session.renamed` of one of them would be
   * dropped as an unknown row.
   */
  private treeMirrored = false;
  /** Models, providers and agents of the CURRENT server; `undefined` until the first load succeeds. */
  private catalog: Catalog | undefined;
  /**
   * The load in flight, or `undefined`. A request that arrives meanwhile sets `catalogDirty` and
   * shares this promise, so a burst of reload events costs at most one more load.
   */
  private catalogRun: Promise<void> | undefined;
  private catalogDirty = false;
  /** Bumped when the server goes away: a load that started for the old one must not publish. */
  private catalogEpoch = 0;
  /** The pending re-read of an empty command list (issue #33), or `undefined`; see {@link scheduleCommandRetry}. */
  private commandRetryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every {@link cancelCommandRetry}; a re-read in flight compares it after its await. */
  private commandRetryGeneration = 0;
  /** The `defaultModel` setting value the user was last told about, so it is told once. */
  private ignoredSettingNoticed: string | undefined;

  /**
   * Wires the injected effects. The "Changed files" and revert holders are per pane and are built
   * in {@link attachPane}.
   */
  constructor(private readonly deps: ChatControllerDeps) {
    this.log = safeLog(deps.log);
    this.runStream = deps.runStream ?? runEventStream;
  }

  /** URL and password of the current server, for scrubbing error texts. */
  private get secrets(): ErrorSecrets {
    return this.server === undefined
      ? {}
      : { url: this.server.url, password: this.server.password };
  }

  /**
   * Adds a chat surface and returns its pane; the surface then receives what is routed to it.
   *
   * The pane's "Changed files" holder (issue #31) reads the client, the served folder and ITS
   * session through getters, so a new server or a session change is seen by a load that is
   * already in flight; its revert holder (issue #32) is the source of the boundary that bounds
   * that range and borrows its root lookup. Both post to this pane only. A pane starts with no
   * session, unless {@link restorePane} binds one right after: when the first server reaches
   * `running`, {@link onServerState} keeps those and gives the primary pane (the side-bar view),
   * else the first pane, the session remembered for the folder if it is empty and nobody shows it;
   * a pane attached while the server already runs stays empty. Does not send anything: the
   * surface announces itself with `ready`.
   */
  attachPane(surface: PaneSurface): ChatPane {
    const id = this.nextPaneId++;
    const pane = new ChatPane(id, surface, this.log, (built) => ({
      diffs: createSessionDiffs({
        client: () => this.client,
        folder: () => this.server?.folder,
        open: () => built.sessionID,
        boundary: (sessionID) => built.reverts.boundary(sessionID),
        post: (message) => {
          built.post(message);
        },
        log: this.log,
        describe: (error) => toErrorInfo(error, this.secrets),
      }),
      reverts: createSessionReverts({
        folder: () => this.server?.folder,
        open: () => built.sessionID,
        rootFor: (sessionID) => built.diffs.rootFor(sessionID),
        post: (message) => {
          built.post(message);
        },
        log: this.log,
      }),
    }));
    pane.releaseDiffs = pane.diffs.onRenewed((sessionID) => {
      for (const listener of this.renewedListeners) listener(sessionID);
    });
    this.panes.set(id, pane);
    return pane;
  }

  /**
   * Binds `sessionID` to pane `paneId` for a tab restored after Reload Window (issue #77), with or
   * without a server: only the pane's field and the tracked set change. It does NOT write the
   * per-folder memory (restoring is not "touching" a session; otherwise the tab deserialized last
   * would win the memory by chance of order) and does NOT publish: the `ready` of the new document
   * does, through {@link onPaneReady}. It remembers the id as the pane's restored session, so if
   * the first read finds it deleted the notice of decision Q1 goes to this pane only
   * ({@link readPane}). Unknown pane ids are ignored.
   * VERIFIED by `chatController.panes.test.ts` "binds a restored session without a server and
   * leaves the memory alone" (fake surfaces, Windows 11, 29/10/2026).
   */
  restorePane(paneId: number, sessionID: string): void {
    const pane = this.paneById(paneId);
    if (pane === undefined) return;
    pane.sessionID = sessionID;
    this.restored.set(paneId, sessionID);
    this.syncTracked();
  }

  /**
   * Removes a surface (it was closed): its pending work is cut off and it stops receiving. The
   * session it showed is no longer tracked by the translator. If it held the keyboard focus, the
   * focus state is recomputed from the panes left (false when none), so the context key does not
   * stay true for a surface that is gone. Unknown ids are ignored.
   */
  detachPane(paneId: number): void {
    const pane = this.panes.get(paneId);
    if (pane === undefined) return;
    if (this.focusedPanes.delete(paneId)) {
      this.deps.ui.setChatFocused(this.focusedPanes.size > 0, paneId);
    }
    pane.fileSearch?.abort();
    pane.fileSearch = undefined;
    pane.generation++;
    pane.diffs.reset();
    pane.reverts.reset();
    pane.releaseDiffs?.();
    this.panes.delete(paneId);
    this.restored.delete(paneId);
    this.lostSession.delete(paneId);
    this.syncTracked();
  }

  /**
   * Makes `sessionID` the session of pane `paneId` (or empties it when `undefined`: the next
   * prompt creates one) without a requester: remembers it for the served folder and publishes a
   * snapshot to THAT pane only. For a new surface that must show a session, a change of where the
   * chat lives and "open chat" with no surface; no `request.result` is posted because nobody asked
   * through the webview. A session deleted meanwhile is cleaned by the resync itself. Unknown pane
   * ids are ignored, and so is a call before the server runs (there is nothing to read).
   * VERIFIED by `chatController.panes.test.ts` "binds the session, remembers it and publishes to
   * that pane only" (fake surfaces, 29/10/2026, Windows 11).
   */
  async openInPane(paneId: number, sessionID: string | undefined): Promise<void> {
    const pane = this.paneById(paneId);
    if (pane === undefined || this.client === undefined) return;
    if (sessionID === undefined) {
      await this.forgetOpen(pane);
      await this.resync([pane]);
      return;
    }
    await this.openSession(pane, sessionID);
  }

  /** The pane with this id, if it is attached. */
  private paneById(paneId: number): ChatPane | undefined {
    return this.panes.get(paneId);
  }

  /** Tells the translator which sessions are shown now (one per pane, without repeats). */
  private syncTracked(): void {
    const ids = new Set<string>();
    for (const pane of this.panes.values()) {
      if (pane.sessionID !== undefined) ids.add(pane.sessionID);
    }
    this.translator.setTracked([...ids]);
  }

  /**
   * The session pane `paneId` shows, or `undefined` (an empty pane or an unknown id). This is the
   * source of truth for "which surface shows session X": it changes as soon as a session is bound,
   * before any snapshot reaches the webview.
   */
  sessionOf(paneId: number): string | undefined {
    return this.panes.get(paneId)?.sessionID;
  }

  /** The panes showing `sessionID`. */
  private panesOf(sessionID: string): ChatPane[] {
    return [...this.panes.values()].filter((pane) => pane.sessionID === sessionID);
  }

  /**
   * True when pane `paneId` puts a request of `sessionID` in its dock: ALWAYS for a surface that
   * shows every request of the location (the side-bar view, decision Q3=1), and for a tab
   * ({@link PaneSurface.ownRequestsOnly}) only when the session it shows is `sessionID` itself or
   * one of its ancestors, i.e. the request comes from the tab's session or from its subagent
   * lineage. A tab with no session shows none. An unknown pane id is `false`.
   *
   * This is the ONE rule behind both halves of issue #77 E4 (decision T1=1): the host uses it to
   * route a new `permission.asked` / `form.asked` and to filter the snapshot, and the attention
   * feature uses it (with the visibility of the surface) to decide whether someone is looking at
   * the card; two implementations could disagree and leave a request with neither dock nor toast.
   * It says nothing about the surface being on screen: that is the VS Code side's to know, so
   * `seenBySurface` in `chatLifecycle.ts` combines `displays` with `WebviewPanel.active` (tabs,
   * decision Q1=2) or visibility (side-bar view). A request whose chain is not complete yet (unknown parent) is not displayed
   * by any tab until {@link resolveLineage} completes it (decision T2=1).
   * VERIFIED by `chatController.panes.test.ts` "routes a request only to the tabs that show its
   * session or a descendant" and the cases around it (fabricated panes and events, 30/10/2026).
   */
  displays(paneId: number, sessionID: string): boolean {
    const pane = this.panes.get(paneId);
    return pane !== undefined && this.paneDisplays(pane, sessionID);
  }

  /** The rule of {@link displays} for a pane we already hold. */
  private paneDisplays(pane: ChatPane, sessionID: string): boolean {
    if (!pane.ownRequestsOnly) return true;
    const shown = pane.sessionID;
    return shown !== undefined && this.lineage.chain(sessionID).includes(shown);
  }

  /** The panes whose dock shows a request of `sessionID`. */
  private displayingPanes(sessionID: string): ChatPane[] {
    return [...this.panes.values()].filter((pane) => this.paneDisplays(pane, sessionID));
  }

  /**
   * The root of `sessionID`'s tree, or `undefined` while the chain up to a known root is not
   * complete. The Sessions tree lists roots only, so "Needs input" of a subagent's request is
   * marked on this row (decision E3 Q6=1 left the full lineage for E4). Asking never reads the
   * server.
   */
  rootOf(sessionID: string): string | undefined {
    return this.lineage.rootOf(sessionID);
  }

  /**
   * The text that names the chat a request belongs to in the toast title (decision Q2=1): the
   * title of the ROOT of its tree (the session a tab shows, even when a subagent is the one that
   * asks), else the session's own, else `''`, which the notification reads as "Untitled session".
   * Asking never reads the server. Server text: the caller sanitises it (`notificationTitle`).
   */
  labelOf(sessionID: string): string {
    const root = this.lineage.rootOf(sessionID) ?? sessionID;
    return this.lineage.titleOf(root) ?? this.lineage.titleOf(sessionID) ?? '';
  }

  /** The asks of `asks` that `pane` shows; all of them for a surface that shows everything. */
  private requestsOf(pane: ChatPane, asks: PendingAsks): PendingAsks {
    if (!pane.ownRequestsOnly) return asks;
    return {
      permissions: asks.permissions.filter((ask) => this.paneDisplays(pane, ask.sessionID)),
      forms: asks.forms.filter((ask) => this.paneDisplays(pane, ask.sessionID)),
    };
  }

  /**
   * Starts the completion of `sessionID`'s chain when it is incomplete AND somebody needs it: a
   * tab that filters by lineage exists, or the Sessions tree wants roots. Without either the
   * side-bar view shows every request and no extra `session.get` is worth making. In production
   * `registerChat` always passes `deps.sessionList`, so the reads happen there too (the tree needs
   * the root); only a host built without the tree, as in some unit tests, skips them.
   */
  private ensureLineage(sessionID: string): void {
    const needed =
      this.deps.sessionList !== undefined ||
      [...this.panes.values()].some((pane) => pane.ownRequestsOnly);
    if (needed && this.lineage.unresolved(sessionID) !== undefined) {
      void this.resolveLineage(sessionID);
    }
  }

  /**
   * Completes the chain of `sessionID` with `session.get`, one ancestor at a time (decision T2=1,
   * the "full lineage" that E3 Q6 left for E4), at most {@link MAX_LINEAGE_DEPTH} reads. Never
   * rejects: a failing read is a `debug` line and the chain stays incomplete (the request then
   * shows in no tab and is notified, which is the safe side). A walk for the same session runs at
   * most once at a time, also across a server restart: the `finally` of a stale walk leaves the
   * entry of the newer one alone.
   *
   * While the request is still pending: the tabs that NOW display it but did not before get a
   * snapshot of their own (the ask was routed while the chain was incomplete, so it never reached
   * them) and the attention feature is told again, because the answer of {@link displays} may have
   * changed. This happens even when this walk learned nothing itself, because another path (a
   * `session.upserted` of the missing parent, a resync) may have completed the chain during the
   * `await`. A walk whose `session.get` resolves after the server changed (`lineageEpoch`), the
   * client changed or the host was disposed publishes nothing, whether its read resolved or rejected
   * (the same check runs again after the `finally`).
   * VERIFIED by `chatController.panes.test.ts` (fabricated client and stream, 31/10/2026): "ignores
   * a stale lineage walk whose session.get rejects", and (30/10/2026) "completes
   * an unknown parent with session.get, then gives the tab a snapshot and tells attention again",
   * "does not reject when session.get fails, and gives no tab the request", "ignores a lineage walk
   * that a server restart made stale", "runs one lineage walk per session at a time, also across a
   * restart" and "resyncs a tab that gained the request through another path during the walk".
   * UNVERIFIED: the `disposed` flag alone (`dispose` also bumps the epoch, so no case isolates it)
   * and a real subagent that asks for permission (the fake server has none).
   */
  private async resolveLineage(sessionID: string): Promise<void> {
    const client = this.client;
    if (client === undefined || this.lineageReads.has(sessionID)) return;
    this.lineageReads.add(sessionID);
    const epoch = this.lineageEpoch;
    const before = new Set(this.displayingPanes(sessionID).map((pane) => pane.id));
    try {
      for (let step = 0; step < MAX_LINEAGE_DEPTH; step += 1) {
        const missing = this.lineage.unresolved(sessionID);
        if (missing === undefined) break;
        let found: SessionSummary;
        try {
          found = toSessionSummary(await client.session.get({ sessionID: missing }));
        } catch (error) {
          this.log.debug(`could not read an ancestor session row: ${String(error)}`);
          break;
        }
        if (this.disposed || epoch !== this.lineageEpoch || client !== this.client) return;
        this.lineage.learn([found]);
      }
    } finally {
      // A restart cleared `lineageReads` and a newer walk may own the entry now: leave it.
      if (epoch === this.lineageEpoch) this.lineageReads.delete(sessionID);
    }
    // A read that REJECTED skipped the check inside the loop: repeat it for a stale walk.
    if (this.disposed || epoch !== this.lineageEpoch || client !== this.client) return;
    if (!this.pending.hasSession(sessionID)) return;
    const gained = this.displayingPanes(sessionID).filter((pane) => !before.has(pane.id));
    if (gained.length > 0) void this.resync(gained);
    this.deps.attention.update(this.pending.list());
  }

  /** Posts to every pane: what belongs to the location. */
  private broadcast(message: HostToWebview): void {
    for (const pane of this.panes.values()) pane.post(message);
  }

  /**
   * Routes a message produced by the host without a requester (`routeOf`): session content to the
   * panes showing that session, location news to all, a NEW request (`request`, issue #77 E4) to
   * the panes whose dock displays it ({@link displays}; every pane when none filters, so a host
   * with only the side-bar view behaves as before). A request whose chain is incomplete also
   * starts {@link resolveLineage}. An `origin` message has no pane to answer here, so it is
   * dropped with a debug line; nothing the translator makes is one.
   */
  private route(message: HostToWebview): void {
    switch (routeOf(message)) {
      case 'all':
        this.broadcast(message);
        return;
      case 'request': {
        const sessionID =
          message.type === 'permission.asked'
            ? message.permission.sessionID
            : message.type === 'form.asked'
              ? message.form.sessionID
              : undefined;
        if (sessionID === undefined) return;
        for (const pane of this.displayingPanes(sessionID)) pane.post(message);
        this.ensureLineage(sessionID);
        return;
      }
      case 'session':
        if ('sessionID' in message) {
          for (const pane of this.panesOf(message.sessionID)) pane.post(message);
        }
        return;
      case 'origin':
        this.log.debug(`dropped a ${message.type} with no pane to answer`);
        return;
    }
  }

  /**
   * Changes the connection state and tells every pane and, when there is one, the native Sessions
   * tree (`deps.sessionList`, issue #77 E3), which empties its rows unless the state is
   * `connected`. VERIFIED by `chatController.test.ts` "tells the sink every connection state".
   */
  private setConnection(connection: ConnectionState): void {
    this.connection = connection;
    this.broadcast({ type: 'connection.state', connection });
    this.deps.sessionList?.connection(connection);
  }

  /**
   * Reacts to the server manager: `running` starts the client and the event stream; any other
   * state stops the stream (so a `stop` never causes reconnection attempts) and is mirrored as
   * a `ConnectionState`. Re-entering `running` with the same URL and password is a no-op.
   *
   * Panes and sessions. The FIRST server this controller sees keeps every session a pane already
   * holds (tabs bound by {@link restorePane} before any server existed) and gives the remembered
   * session of the folder (`memory.get(folder)`) only to the receiver (the pane whose surface is
   * `primary`, the side-bar view, even when leftover tabs were attached before it, else the one
   * attached first), and only if the receiver has none and no other pane shows it. A later server
   * for a NEW folder resets: the receiver gets the remembered session and the other panes start
   * empty (a session lives in its location), restored sessions included. A server for the SAME
   * folder (a restart) leaves every pane on its own session, because that memory is
   * last-writer-wins across panes. At start in `editor` mode with no tab to restore there are no
   * panes yet, so nothing is given and Open Chat opens the remembered session itself. A server
   * for a NEW folder also empties the session lineage (issue #77 E4: ids belong to a location).
   * VERIFIED by
   * `chatController.panes.test.ts` "gives the remembered session to the primary pane, not the
   * oldest" and the first-server cases next to it (fake surfaces, 29/10/2026). HYPOTHESIS for a
   * real window with several tabs open at a change of folder (risk R6 of the plan): the tabs keep
   * a stale title until their next snapshot.
   * `restarting` and `connecting` (an external server being checked, issue #11) look like
   * `starting` to the webview; the `message` of an `unavailable` is copied as is to the webview,
   * which is why the external-server messages carry no URL, port or raw cause (the webview never
   * learns where the server is; `describeExternalFailure`). The re-entry check compares URL and
   * password, so a new password for the same server creates a new client. An `unavailable` that still has a restart
   * scheduled (`retryInMs`) is `reconnecting` with its attempt number, so the banner says
   * "Reconnecting (n)" instead of an error the manager is already healing. Leaving `running` drops
   * the pending requests (they died with the server) and clears the badge. An `unavailable` that
   * carries `binary` (the detection's attempts, E2 issue #85) passes it on to the connection state
   * as is, and one without it adds no field, so the webview can tell step 1 from step 2.
   * VERIFIED by unit tests with fabricated states (synthetic).
   */
  onServerState(state: ServerState): void {
    if (this.disposed) return;
    switch (state.kind) {
      case 'running': {
        const next = state.server;
        if (
          this.server !== undefined &&
          this.server.url === next.url &&
          this.server.password === next.password
        ) {
          return;
        }
        this.stopStream();
        this.server = next;
        this.client = this.deps.createClient(next);
        // Same folder (a restart): every pane keeps its own session. The memory per folder is
        // "last writer wins" across panes, so reading it here would move pane 1 to the session
        // another pane opened last. New folder: the primary pane (else the first) shows the
        // session remembered for it and the others start empty (a session lives in its location).
        const firstServer = this.lastFolder === undefined;
        const sameFolder = this.lastFolder === next.folder;
        this.lastFolder = next.folder;
        const panes = [...this.panes.values()];
        const receiver = panes.find((pane) => pane.primary) ?? panes[0];
        if (firstServer) {
          // The first server of this host: a pane may already hold a session bound by
          // `restorePane` (a tab restored after Reload Window), which must survive. The receiver
          // gets the remembered session only when it has none and no other pane shows it (the
          // same session on two surfaces is what the restore refuses).
          const remembered = this.deps.memory.get(next.folder);
          if (
            receiver !== undefined &&
            receiver.sessionID === undefined &&
            remembered !== undefined &&
            !panes.some((pane) => pane.sessionID === remembered)
          ) {
            receiver.sessionID = remembered;
          }
        } else if (!sameFolder) {
          for (const pane of panes) {
            pane.sessionID = pane === receiver ? this.deps.memory.get(next.folder) : undefined;
            this.restored.delete(pane.id);
            this.lostSession.delete(pane.id);
          }
          this.lineage.clear(); // session ids belong to a location
        }
        this.translator = createEventTranslator(this.secrets);
        this.treeMirrored = false; // the new translator mirrors nothing of the tree yet
        this.syncTracked();
        this.setConnection({ state: 'starting' });
        this.startStream(this.client);
        return;
      }
      case 'idle':
      case 'starting':
      case 'connecting':
      case 'restarting':
        this.stopStream();
        this.setConnection({ state: 'starting' });
        return;
      case 'unavailable':
        this.stopStream();
        if (state.retryInMs !== undefined) {
          this.setConnection({
            state: 'reconnecting',
            attempt: state.attempt ?? 1,
            error: { code: state.reason, message: state.message },
          });
          return;
        }
        this.setConnection({
          state: 'unavailable',
          reason: state.reason,
          error: { code: state.reason, message: state.message },
          ...(state.binary === undefined ? {} : { binary: state.binary }),
        });
        return;
      case 'stopping':
      case 'stopped':
        this.stopStream();
        this.setConnection({ state: 'stopped' });
        return;
    }
  }

  /**
   * Aborts the stream and forgets the client and the pending requests; the next `running` creates
   * new ones. The requests die with the server (opencode rejects its pending ones on shutdown), so
   * the registry is emptied and the attention feature told, which closes its notifications.
   * The asks remembered for the resolutions die with them (`forgetAsks`), but the RESOLUTIONS
   * already recorded stay: they are history, and Restart Server must not wipe them. The catalog
   * goes too (it described that server) and a catalog load in flight is cut off from publishing.
   * A file search in flight is aborted (its answer would describe the old server); `offeredUris`
   * stays, like `pickedUris`, so a chip pending in the webview survives Restart Server.
   * The "Changed files" list and its originals go too (issue #31): the paths belong to the old
   * server, and a load in flight is cut off; the next snapshot brings the list back.
   * The Sessions tree's cursors and in-flight pages and searches go as well (issue #77, E3), and
   * so do the lineage walks in flight (E4); the lineage rows already learned stay.
   */
  private stopStream(): void {
    this.streamAbort?.abort();
    this.streamAbort = undefined;
    for (const pane of this.panes.values()) {
      pane.fileSearch?.abort();
      pane.fileSearch = undefined;
      pane.diffs.reset();
      pane.reverts.reset();
      pane.generation++; // a snapshot in flight for the old server must not be published
      pane.browser.reset(); // its cursor embeds the old server's query
    }
    this.client = undefined;
    this.server = undefined;
    this.locationGeneration++;
    // The tree's cursors embed the old server's query, and an answer in flight belongs to it.
    this.treeBrowser.reset();
    this.searchBrowser.reset();
    this.treeEpoch++;
    this.searchTicket++;
    this.treeMirrored = false;
    // The catalog belongs to the server that served it: another server may offer other models.
    this.catalog = undefined;
    this.catalogEpoch++;
    this.catalogRun = undefined;
    this.catalogDirty = false;
    this.cancelCommandRetry();
    this.clearPending();
    this.resolutions.forgetAsks();
    // A lineage walk in flight asked the old server; the rows already learned stay (ids survive a
    // restart of the same folder, and a new folder clears them in `onServerState`).
    this.lineageEpoch++;
    this.lineageReads.clear();
  }

  /** Empties the registry of pending requests and tells the attention feature, if it held any. */
  private clearPending(): void {
    if (this.pending.list().length === 0) return;
    this.pending.clear();
    this.deps.attention.update([]);
  }

  /** Launches the reconnecting SSE loop for `client`; it ends when `streamAbort` aborts. */
  private startStream(client: ChatApi): void {
    const controller = new AbortController();
    this.streamAbort = controller;
    const stateOf = (state: StreamState): void => {
      if (controller.signal.aborted) return;
      this.onStreamState(state);
    };
    void this.runStream<V2Event>({
      subscribe: (signal, onActivity) => client.event.subscribe({ signal, onActivity }),
      onEvent: (event) => {
        if (!controller.signal.aborted) this.onEvent(event);
      },
      onState: stateOf,
      onDiagnostic: (message) => {
        this.log.debug(message);
      },
      signal: controller.signal,
    }).catch((error: unknown) => {
      this.log.error(`event stream loop crashed: ${String(error)}`);
    });
  }

  /** Mirrors the loop's phase into the connection state shown to the user. */
  private onStreamState(state: StreamState): void {
    if (state.kind === 'connected' && this.server !== undefined) {
      this.setConnection({ state: 'connected', serverVersion: this.server.version });
    } else if (state.kind === 'reconnecting') {
      this.log.warn(`event stream lost (attempt ${String(state.attempt)}); reconnecting`);
      this.setConnection({
        state: 'reconnecting',
        attempt: state.attempt,
        error: toErrorInfo(state.error, this.secrets),
      });
    }
  }

  /**
   * Handles one stream event: resync on `server.connected`/`location.shutdown` (both also reload the
   * catalog, as do the events of {@link CATALOG_RELOAD_EVENTS}, which have nothing to translate),
   * else translate.
   *
   * Every translated message goes through the registry of pending requests (and the in-flight
   * resync's `live` record); when the set changed, the attention feature is told once per event.
   * It then goes through the memory of answered requests ({@link withResolution}), so a
   * `*.resolved` leaves for the webview already carrying its `resolution`.
   * `session.execution.interrupted` / `.failed` of a session that had pending requests triggers a
   * resync: opencode deletes a pending permission on interrupt WITHOUT publishing
   * `permission.replied` (read in `permission.ts@v2.0.32` L247-258), so the stream alone would
   * leave a card, a badge and a notification for a request that no longer exists. HYPOTHESIS: that
   * the REST read after the event no longer lists it (the deletion could in theory happen after
   * the event); the opt-in suite does not interrupt a pending permission. A resync after
   * `succeeded` is not needed: a turn cannot succeed while a request is pending.
   * `session.forked` (issue #21) is the ONLY event a fork publishes (no `session.created`) and has
   * no title, so the translator cannot build the row: {@link refreshSession} reads it. VERIFIED by
   * the planner spike (opencode 2.0.32, Windows 11, 21/10/2026).
   * Issue #25: `session.compaction.ended` of the OPEN session resyncs (the compaction boundary comes
   * from the REST messages, so no protocol message was added; a compaction of another session needs
   * nothing, its totals arrive as `session.usage.updated`), and `session.usage.updated` writes the
   * stable line `usage updated for <sid>: <n> tokens` (ids and a number only) that the opt-in
   * `realOpencode.test.ts` waits for. HYPOTHESIS: a resync with a turn in flight (automatic
   * compaction mid-turn) keeps the in-flight message through `mergeLive`/`mergeStatuses`, which were
   * built for that but never run with a compaction.
   * Issue #31: {@link watchChangedFiles} looks at the events that go on to the translator (before
   * it) and reloads the "Changed files" list when the open session's files may have changed.
   */
  private onEvent(event: V2Event): void {
    try {
      if (event.type === 'server.connected') {
        this.log.info('event stream connected');
        void this.resync();
        void this.loadCatalog();
        return;
      }
      if (CATALOG_RELOAD_EVENTS.has(event.type)) {
        void this.loadCatalog();
        return;
      }
      if (event.type === 'session.forked') {
        void this.refreshSession(event.data.sessionID);
        return;
      }
      if (event.type === 'location.shutdown') {
        this.log.info('location shutdown; refreshing the snapshot');
        void this.resync();
        void this.loadCatalog();
        return;
      }
      if (event.type === 'session.usage.updated') {
        const total = event.data.tokens;
        const count =
          total.input + total.output + total.reasoning + total.cache.read + total.cache.write;
        this.log.info(`usage updated for ${event.data.sessionID}: ${String(count)} tokens`);
      }
      this.watchChangedFiles(event);
      if (event.type === 'session.compaction.ended') {
        const showing = this.panesOf(event.data.sessionID);
        if (showing.length > 0) {
          // The boundary of the context indicator lives in the snapshot (`compactedAt`), not in a
          // message of its own (issue #25). Not translated: the branch returns first, and the
          // translator has no case for it anyway (it would give `[]`). Only the panes showing the
          // session are refreshed.
          this.log.info(`compaction ended for ${event.data.sessionID}; refreshing the snapshot`);
          void this.resync(showing);
          return;
        }
      }
      if (
        event.type === 'session.execution.succeeded' ||
        event.type === 'session.execution.failed' ||
        event.type === 'session.execution.interrupted'
      ) {
        const outcome = event.type.slice('session.execution.'.length);
        let reason = '';
        if (event.type === 'session.execution.failed') {
          const failure = toStructuredErrorInfo(event.data.error, this.secrets);
          reason = ` (${failure.code}: ${failure.message})`;
        }
        this.log.info(`turn finished: ${outcome} for ${event.data.sessionID}${reason}`);
      }
      this.publish(this.translator.translate(event));
      if (
        (event.type === 'session.execution.interrupted' ||
          event.type === 'session.execution.failed') &&
        this.pending.hasSession(event.data.sessionID)
      ) {
        void this.resync();
      }
    } catch (error) {
      this.log.error(`handling event ${event.type} failed: ${String(error)}`);
    }
  }

  /**
   * Reloads the "Changed files" list (issue #31) when an event says the open session's files may
   * have changed: a step that ended or failed with a non-empty `files` (the paths that differ
   * between the snapshot taken at its start and the one at its end; absent or empty when it
   * touched nothing, or when there are no snapshots), or any `session.revert.*` of the open
   * session. A committed revert also forgets the cached first message of the range, because the
   * messages it removes can include it. Events of other sessions (a subagent's) are ignored: the
   * list is the open session's. Does not stop the event: the caller still translates it.
   * `filesystem.changed` is deliberately NOT used: it fires for any edit of any file.
   * HYPOTHESIS: the field names `files` and `snapshot` of `step.ended` are as typed in
   * `@opencode/client@2.0.32`; the synthetic server emits them on its `EDIT_FILES` turn only, and no
   * real turn that edited files was observed.
   */
  private watchChangedFiles(event: V2Event): void {
    switch (event.type) {
      case 'session.step.ended':
      case 'session.step.failed':
        if ((event.data.files?.length ?? 0) > 0) {
          for (const pane of this.panesOf(event.data.sessionID)) {
            void pane.diffs.request(event.data.sessionID);
          }
        }
        return;
      case 'session.revert.committed': {
        const { sessionID } = event.data;
        const showing = this.panesOf(sessionID);
        if (showing.length === 0) return;
        this.log.info(`revert committed for ${sessionID}`);
        this.afterCommit(showing, sessionID, event.data.to);
        return;
      }
      case 'session.revert.staged': {
        const { sessionID } = event.data;
        for (const pane of this.panesOf(sessionID)) {
          pane.revertEvents += 1;
          // The boundary is set synchronously by `apply`, so the load that follows is bounded by it.
          void pane.reverts.apply(sessionID, event.data.revert, { post: true });
          void pane.diffs.request(sessionID);
        }
        return;
      }
      case 'session.revert.cleared': {
        const { sessionID } = event.data;
        for (const pane of this.panesOf(sessionID)) {
          pane.revertEvents += 1;
          void pane.reverts.apply(sessionID, undefined, { post: true });
          void pane.diffs.request(sessionID);
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * A revert of the open session was committed (by the user, by an accepted prompt, or by another
   * client): the server deleted the history from the boundary on, so the host forgets the revert
   * and the cached start of the "Changed files" range and publishes a fresh snapshot. NO empty
   * `session.revert` is posted first: the hidden messages would flash back for an instant, and the
   * snapshot (whose row no longer has a `revert`) clears the webview's state atomically.
   * Idempotent: the event and the HTTP answer of a commit both call it, and a second resync costs
   * one more read. HYPOTHESIS: that the server has deleted the history by the time the event
   * reaches the stream (the projector runs before the bus publishes); if it had not, the snapshot
   * would still list the messages until the next resync (a reconnect, an open or another commit)
   * reads the session again; no event handler removes listed messages.
   */
  private afterCommit(panes: readonly ChatPane[], sessionID: string, boundary?: string): void {
    // The live copies of the deleted messages must go too, or the snapshot's `mergeLive` brings
    // them back as "in flight". Not done for a commit made by a prompt (no `boundary`): its
    // `committed` event does it, before the messages of the prompt itself. Only that session's.
    if (boundary !== undefined) this.translator.forgetFrom(boundary, sessionID);
    for (const pane of panes) {
      pane.reverts.forget(sessionID);
      pane.diffs.forgetRange(sessionID);
    }
    void this.resync(panes);
  }

  /**
   * Sends translated messages to the webview through the host-side bookkeeping: the registry of
   * pending requests (and `live`), the open-session check of {@link onSessionRemoved} and the memory
   * of answered requests; the attention feature is told once if the pending set changed. Used for
   * the events of the stream and for the `session.removed` the controller itself synthesises when
   * a call finds the session gone (self-healing of a stale row). `session.upserted`, `.removed` and
   * `.status` also go to `deps.sessionList` (issue #77, E3), with or without panes: `route` only
   * reaches panes, and the tree must stay current while every chat tab is closed. VERIFIED by
   * `chatController.test.ts` "forwards the session events to the sink with no pane open".
   * Issue #77, E4: every `session.upserted` feeds the lineage before it is routed and every
   * `session.removed` takes the id out of it afterwards, so a request that follows its session's
   * row finds the chain.
   */
  private publish(messages: readonly HostToWebview[]): void {
    let changed = false;
    const sink = this.deps.sessionList;
    for (const message of messages) {
      if (this.trackRequest(message)) changed = true;
      // Before the route: a `permission.asked` that follows its session's row in the same batch
      // must already find the chain (issue #77 E4).
      if (message.type === 'session.upserted') this.lineage.learn([message.session]);
      this.route(this.withResolution(message));
      // The tree follows the session events even with no pane open (`route` reaches only panes).
      if (
        sink !== undefined &&
        (message.type === 'session.upserted' ||
          message.type === 'session.removed' ||
          message.type === 'session.status')
      ) {
        sink.event(message);
      }
      // After the post: the webview empties its view on `session.removed`, and the notice that may
      // follow explains why.
      if (message.type === 'session.removed') {
        this.onSessionRemoved(message.sessionID);
        this.lineage.forget(message.sessionID);
      }
    }
    if (changed) this.deps.attention.update(this.pending.list());
  }

  /**
   * A session is gone. Every pane that showed it forgets it, memory included, so the next prompt
   * without `sessionID` creates a session instead of going to a dead one (before this, the pane's
   * session and `workspaceState` pointed at it until a resync got a 404). The webview empties
   * its own view when it receives the same `session.removed`. An info notice, to those panes
   * only, says so unless the delete was ours (`deleting`). Idempotent: the second report finds no
   * pane showing it. Whatever it was, the session's "Changed files" state is forgotten in every
   * pane (issue #31).
   */
  private onSessionRemoved(sessionID: string): void {
    const ours = this.deleting.delete(sessionID);
    for (const pane of this.panes.values()) {
      pane.diffs.forget(sessionID);
      pane.reverts.forget(sessionID);
    }
    for (const pane of this.panesOf(sessionID)) {
      this.log.info(`open session deleted ${sessionID}`);
      void this.forgetOpen(pane);
      if (!ours) {
        pane.post({
          type: 'notice',
          level: 'info',
          error: {
            code: 'SessionDeleted',
            message: 'The open session was deleted outside this view',
          },
        });
      }
    }
  }

  /**
   * Makes `pane` forget its session: field, translator and the per-folder memory. The returned
   * promise never rejects (a failed write is logged); callers that need the memory written before
   * going on await it, the event path does not. The memory holds ONE session per folder, so with
   * several panes (editor tabs plus, after a change of location, the side-bar view) the last one
   * to open or forget writes it: the memory is "the session the user touched last in this
   * folder", which is what Open Chat reopens when no tab is open. A per-tab memory is not kept.
   */
  private async forgetOpen(pane: ChatPane): Promise<void> {
    pane.sessionID = undefined;
    this.syncTracked();
    const folder = this.server?.folder;
    if (folder === undefined) return;
    try {
      await this.deps.memory.set(folder, undefined);
    } catch (error) {
      this.log.warn(`forgetting the remembered session failed: ${String(error)}`);
    }
  }

  /**
   * Feeds one translated message to the memory of answered requests. For a `permission.resolved`
   * or `form.resolved` of a request it knew, returns the message with its `resolution` attached
   * (and writes the stable line `resolution recorded <id> (<decision|outcome>)`: ids and decision
   * only, never resources, answers or feedback); any other message comes back unchanged.
   */
  private withResolution(message: HostToWebview): HostToWebview {
    const resolution = this.resolutions.observe(message);
    if (resolution === undefined) return message;
    if (message.type === 'permission.resolved' && resolution.kind === 'permission') {
      this.log.info(`resolution recorded ${resolution.id} (${resolution.decision})`);
      return { ...message, resolution };
    }
    if (message.type === 'form.resolved' && resolution.kind === 'form') {
      this.log.info(`resolution recorded ${resolution.id} (${resolution.outcome})`);
      return { ...message, resolution };
    }
    return message;
  }

  /**
   * Feeds one translated message to the registry of pending requests, writes the stable log line
   * for it and, while a resync is reading REST, remembers it in `live`. Returns `true` when the
   * set of pending requests changed (so the attention feature must be told). Logs the ids and the
   * action only, never the resources. A `session.removed` also drops that id from `refreshing`, so
   * a `refreshSession` read still in flight discards its row instead of republishing a deleted
   * session (every `session.removed` goes through `publish`, hence through here).
   */
  private trackRequest(message: HostToWebview): boolean {
    const changed = this.pending.apply(message);
    const recording = this.resyncing > 0;
    switch (message.type) {
      case 'permission.asked': {
        const { id, sessionID, action } = message.permission;
        if (recording) {
          this.live.permissions.set(id, message.permission);
          this.live.gone.delete(`permission:${id}`);
        }
        if (changed) this.log.info(`permission asked ${id} for ${sessionID} (${action})`);
        return changed;
      }
      case 'permission.resolved':
        if (recording) {
          this.live.permissions.delete(message.permissionID);
          this.live.gone.add(`permission:${message.permissionID}`);
        }
        this.log.info(`permission ${message.permissionID} resolved: ${message.decision}`);
        return changed;
      case 'form.asked':
        if (recording) {
          this.live.forms.set(message.form.id, message.form);
          this.live.gone.delete(`form:${message.form.id}`);
        }
        if (changed) this.log.info(`form asked ${message.form.id} for ${message.form.sessionID}`);
        return changed;
      case 'form.resolved':
        if (recording) {
          this.live.forms.delete(message.formID);
          this.live.gone.add(`form:${message.formID}`);
        }
        this.log.info(`form ${message.formID} resolved: ${message.outcome}`);
        return changed;
      case 'session.removed':
        // A `refreshSession` in flight for this id must not republish its row afterwards.
        this.refreshing.delete(message.sessionID);
        // Lesson #969: a record of the host must not inherit requests of a session that is gone.
        // The ones `live` holds would otherwise be re-added to a snapshot that is being built.
        if (recording) {
          this.live.removed.add(message.sessionID);
          for (const [id, ask] of this.live.permissions) {
            if (ask.sessionID === message.sessionID) this.live.permissions.delete(id);
          }
          for (const [id, ask] of this.live.forms) {
            if (ask.sessionID === message.sessionID) this.live.forms.delete(id);
          }
        }
        return changed;
      default:
        return false;
    }
  }

  /**
   * The webview of pane `paneId` loaded (it sends `ready` on every document load): publishes to
   * THAT pane the connection state and a fresh snapshot, or an empty one when there is no server
   * yet (except for a pane that already holds a restored session, which gets only the connection
   * state: see {@link restorePane}); the other panes get nothing. Anything posted earlier was dropped by the provider, so this
   * is the only way a new document gets its state. If a `focusRequest` is waiting (an "Open chat" click that had to load the document first, so its
   * first `ui.focus` went nowhere) it is sent again after the snapshot, as long as it is fresher
   * than {@link FOCUS_REQUEST_TTL_MS}. The cached catalog, if any, is sent right after the snapshot
   * (a new document starts without one; the load that produced it already went to the old
   * document or was dropped). Then the chips and notices that "Add to OpenCode Chat" produced
   * while the view was hidden ({@link ChatPane.postOrKeep}) go out, after the snapshot so nothing
   * empties them. Then the `prompt.compose`s of issue #36 that waited for this document
   * ({@link ChatPane.flushComposes}; a stale one arrives with `send` false). Last, the `ui.command`s of issue #35 that waited for this document
   * ({@link runUiCommand}), so New Session or Stop act on the state the snapshot just set.
   * Unknown pane ids are ignored.
   */
  async onPaneReady(paneId: number): Promise<void> {
    const pane = this.paneById(paneId);
    if (pane === undefined) return;
    this.log.info('webview ready');
    pane.post({ type: 'connection.state', connection: this.connection });
    if (this.client === undefined) {
      // A pane bound to a restored session gets no empty snapshot: its document would persist "no
      // session" and a second Reload with the server down would lose it (decision T3=1). The
      // webview keeps the id it restored until its first real snapshot.
      if (pane.sessionID === undefined) pane.post({ type: 'snapshot', snapshot: EMPTY_SNAPSHOT });
      pane.flushUndeliveredMenu();
      this.flushComposes(pane);
      this.flushUiCommands(pane);
      return;
    }
    await this.resync([pane]);
    if (this.catalog !== undefined) pane.post({ type: 'catalog', catalog: this.catalog });
    const requested = pane.focusRequested;
    pane.focusRequested = undefined;
    if (requested !== undefined && Date.now() - requested.at <= FOCUS_REQUEST_TTL_MS) {
      pane.post({ type: 'ui.focus', target: requested.target });
    }
    pane.flushUndeliveredMenu();
    this.flushComposes(pane);
    this.flushUiCommands(pane);
  }

  /**
   * Sends the `prompt.compose`s a pane kept (see {@link ChatPane.flushComposes}), after the chips
   * of "Add to OpenCode Chat" and before the `ui.command`s, and when at least one went out asks the
   * VS Code side to hand the keyboard to the chat iframe again (same reason as
   * {@link flushUiCommands}, same HYPOTHESIS: the focus given while the document loaded went
   * nowhere).
   */
  private flushComposes(pane: ChatPane): void {
    if (pane.flushComposes()) this.deps.ui.focusView(pane.id);
  }

  /**
   * Sends the `ui.command`s a pane kept (see {@link ChatPane.flushUiCommands}) and, when at least
   * one went out, asks the VS Code side to hand the keyboard to the chat iframe again.
   * HYPOTHESIS (see `registerChat`): the focus given by the reveal landed on an iframe whose
   * document did not exist yet. Seen once in a `test:visual` step 22 run WITHOUT the second focus
   * (the new document had `hasFocus()` false); that run is not a check, and the run without
   * `focusView` was not repeated to prove it is needed.
   */
  private flushUiCommands(pane: ChatPane): void {
    if (pane.flushUiCommands()) this.deps.ui.focusView(pane.id);
  }

  /**
   * Relays a palette or keyboard command to one pane's webview as `ui.command` (issue #35); the
   * keeping rules and their verification are on {@link ChatPane.runUiCommand}. Unknown pane ids
   * are ignored.
   */
  runUiCommand(paneId: number, command: UiCommand): void {
    this.paneById(paneId)?.runUiCommand(command);
  }

  /**
   * Asks one pane's webview to bring a pending request into view (the "Open chat" link of an
   * attention notification, issue #19). Sends `ui.focus` now and keeps the target for the next
   * `ready`: revealing a hidden view loads a NEW document, the message sent before it exists is
   * dropped by the provider, and the snapshot that follows its `ready` is what makes the card
   * exist. Unknown pane ids are ignored.
   */
  focusRequest(paneId: number, target: FocusTarget): void {
    const pane = this.paneById(paneId);
    if (pane === undefined) return;
    pane.focusRequested = { target, at: Date.now() };
    pane.post({ type: 'ui.focus', target });
  }

  /**
   * Reads the state of the server by REST and publishes it as one `snapshot` per pane in `only`
   * (all the panes when omitted).
   *
   * The location is read ONCE for all the targets (session list, active sessions, pending
   * requests); each pane then adds the reads of ITS session ({@link readPane}) and receives its own
   * snapshot ({@link publishSnapshot}), so two panes cost one list and not two. "The newest call
   * wins" is per pane: a result is dropped for a pane whose `generation` moved meanwhile (another
   * resync of that pane, or the server going away), and kept for the others; the registry of
   * pending requests is replaced only if at least one target is still current (with no panes at
   * all, if no newer resync started). Every resync takes its own `translator.beginResync()`
   * stamp, so overlapping resyncs of different panes cannot erase each other's overlay of
   * statuses and totals (R2 of the E9 plan; VERIFIED only by the translator unit test "keeps the
   * idle that arrived after the first resync began although a second one began later").
   *
   * Issue #77, E3: with `deps.sessionList` and no `only`, the FULL resync adds a fifth read in the
   * same `Promise.all`: the first page of ROOT sessions (`parentID: null`, 50) through the tree's
   * own browser, reconciled in {@link publishTree}. A resync of one pane never reads it (it would
   * fold the "Show more" the user opened), and without a sink there are exactly the four reads
   * below. A failure of the fifth read is a `warn` line and never fails the snapshot of the panes;
   * the tree gets `sink.failed()` (empty rows and a message, the next full resync retries).
   * The tree's half has its own stamp (`treeEpoch`), independent of the panes' `dropped()`: a
   * one-pane resync that overtakes this one drops the panes' snapshot but not the tree's page.
   * VERIFIED by `chatController.test.ts` (fake client, Windows 11, 29/10/2026): "still makes the
   * four reads and no extra call without a sink", "reads the roots of the tree in the full resync
   * and reports them, statuses merged", "a pane resync during the full resync does not leave the
   * tree loading" and "reports a failed read of the tree and keeps the panes' snapshot".
   *
   * Asks for the session list (the 50 newest; the open session's row is added by `session.get`
   * when it is older than those), the active sessions, the pending permissions and forms of the
   * whole LOCATION (`permission.request.list()` and `form.list()`, whose `{location, data}` answer
   * is NOT unwrapped by the client, unlike `permission.saved.list`) and, when a session is open,
   * its messages. The newest call wins: if another resync (or a server change) started
   * meanwhile, this result is dropped. A remembered session that no longer exists is forgotten
   * and the snapshot goes out with no open session. The requests are completed with those the
   * stream announced or resolved during the reads (`live`), then become the registry's content.
   * The snapshot also carries `resolutions`: the answered requests of the OPEN session that the
   * host remembers (E3-resolved-history), read at publication time so a `*.resolved` that arrived
   * during the REST reads is included; they come from memory, not from REST.
   *
   * The REST reads are older than the stream by the time they are published, so the snapshot is
   * reconciled with it in three steps: `translator.beginResync()` before the reads;
   * `translator.seed()` (merges REST messages with what the stream built, prunes what REST no
   * longer lists) and `translator.mergeLive()` (adds in-flight messages and longer block text)
   * right before posting; and `translator.mergeStatuses()` so that a `busy`/`idle`/`error` the
   * stream derived since the resync began wins over the REST one. Without these the webview,
   * which replaces its state with the snapshot, would lose a message in flight or stay on
   * "Working…" with Send disabled.
   * If the open session is deleted while its messages are being read (`pane.sessionID` no longer is
   * the id the reads started with), the snapshot goes out with NO open session, and the rows and
   * statuses of sessions deleted meanwhile (`live.removed`) are left out (review W1 of #20).
   * REST status of the open session: `busy` if listed as active; else `error` when its newest
   * message is an `idle` with outcome `failed` (scrubbed); else `idle`.
   * VERIFIED shapes against a real opencode 2.0.32 (planner spike, Windows 11, 2026-10-20).
   * VERIFIED (Windows 11, VS Code 1.142.0, 2026-10-20, opt-in `realOpencode.test.ts`, two runs):
   * `permission.request.list()` and `form.list()` are accepted by the real server and the
   * snapshots of the run were sent (`snapshot sent`, no `snapshot failed`). UNVERIFIED: the shape
   * of a NON-EMPTY list from a real server, because no snapshot was taken while a request was
   * pending (the synthetic fixture covers that shape, which is only as good as its reading of
   * the types).
   * Issue #21: with a session open the rows also carry its LINEAGE, because the header shows
   * "‹ parent", "Forked from" and "Subagent sessions (N)" and none of those rows has to be among
   * the 50 newest: the open session's children (`session.list({ parentID })`, in parallel with the
   * messages), its parent and its fork origin (`session.get` each). All cosmetic: a failure is a
   * `debug` line and the snapshot still goes out (same rule as the open session's own row).
   * Issue #25: the rows go through `translator.mergeUsage()` (a `session.usage.updated` that
   * arrived during the reads wins over the older REST totals), and `open.compactedAt` is the
   * `time.created` of the last completed compaction among the messages read (`lastCompactionAt`).
   * The 200-message window is the only horizon: a compaction older than it is not seen.
   * Issue #31: once the snapshot is out and a session is open, the "Changed files" list the host
   * holds for it is sent again (the webview state was just replaced) and a reload is requested,
   * fire and forget; it never delays or fails the snapshot.
   * #111: once the five reads answered, the tree's half is published from the catch too, so an error
   * AFTER them (a pane's messages, the snapshot) never shows the tree as failed: it gets its page, or
   * the failure of its own read. VERIFIED by `chatController.test.ts` "publishes the tree page when a
   * pane read fails after the tree was read" (fake client, synthetic error, Windows 11, 31/10/2026).
   * The tree's half (full resync with a sink): published on success, and a non-transport failure of
   * any read BEFORE they all answered (the panes' `session.list`, `session.active` or the request
   * lists) tells the sink `failed()` when the host is not disposed,
   * the client is unchanged and this resync still owns the tree's stamp, EVEN IF the panes' half
   * was overtaken by a newer resync of its own (the check runs before the panes' `dropped()`
   * return). VERIFIED by `chatController.test.ts` "reports a failed tree when a read of the panes
   * fails with a server error", "reports a failed tree when a pane-only resync overtakes the full
   * one and a pane read fails" and "does not report a failed tree for a transport error or for a
   * stale tree stamp" (fake client with synthetic errors, Windows 11, 30/10/2026). HYPOTHESIS,
   * read in the code and not run by any test: the "not disposed" and "client unchanged" conditions
   * of the gate. A Transport failure is left to the connection state.
   * Issue #77, E4: the session rows read (the list and each pane's lineage rows) are learned by the
   * lineage before the registry of requests is replaced; when that taught it something and
   * requests are pending the attention feature is told again, and a pending request whose chain is
   * still incomplete starts {@link resolveLineage}. Each pane's snapshot carries only the requests
   * it shows ({@link publishSnapshot}).
   */
  async resync(only?: readonly ChatPane[]): Promise<void> {
    const client = this.client;
    const server = this.server;
    if (client === undefined || server === undefined) return;
    const targets = only ?? [...this.panes.values()];
    const locationStamp = ++this.locationGeneration;
    const stamps = new Map<ChatPane, { generation: number; revertEvents: number }>();
    for (const pane of targets) {
      stamps.set(pane, { generation: ++pane.generation, revertEvents: pane.revertEvents });
    }
    // Statuses the stream derives from here on override the (older) REST ones at publication. The
    // stamp is this resync's own: another one starting meanwhile cannot erase them (R2).
    const token = this.translator.beginResync();
    if (this.resyncing === 0) {
      this.live.permissions.clear();
      this.live.forms.clear();
      this.live.gone.clear();
      this.live.removed.clear();
    }
    this.resyncing += 1;
    /** The targets whose snapshot is still the newest one for them (none left: drop everything). */
    const stillCurrent = (): ChatPane[] =>
      targets.filter((pane) => pane.generation === stamps.get(pane)?.generation);
    const dropped = (): boolean =>
      this.disposed ||
      (targets.length === 0
        ? locationStamp !== this.locationGeneration
        : stillCurrent().length === 0);
    // Only a FULL resync reads the tree's first page, and only with a sink: a resync of one pane
    // (a tab becoming ready) must not fold a "Show more" the user opened, and without a sink the
    // four reads below are exactly what they always were.
    const sink = only === undefined ? this.deps.sessionList : undefined;
    const treeQuery =
      sink === undefined ? undefined : this.treeBrowser.query('', false, server.folder);
    // The tree's own stamp (B1 of review 1): only a NEWER full resync (or a server change, which
    // also bumps `treeEpoch`) may drop the tree's half; the panes' `dropped()` must not, because a
    // one-pane resync racing this one would leave the tree in "Loading sessions…" for good.
    const treeStamp = treeQuery === undefined ? 0 : ++this.treeEpoch;
    /**
     * The tree's half, set once the five reads have answered: the page, or the failure of its own
     * read, unless a newer full resync owns it. It runs at most once, so the catch below can call it
     * for a failure that came AFTER the reads (#111) without publishing twice.
     */
    let publishTreeHalf: (() => void) | undefined;
    try {
      const [list, active, permissionList, formList, treeAnswer] = await Promise.all([
        client.session.list({ directory: server.folder, order: 'desc', limit: SESSION_LIMIT }),
        client.session.active(),
        client.permission.request.list(),
        client.form.list(),
        treeQuery === undefined
          ? Promise.resolve(undefined)
          : // Cosmetic for the chat: a failure here must not fail the snapshot of the panes.
            client.session.list(treeQuery.input).catch((error: unknown) => {
              this.log.warn(
                `sessions tree read failed: ${toErrorInfo(error, this.secrets).message}`,
              );
              return undefined;
            }),
      ]);
      let treePublished = false;
      publishTreeHalf = (): void => {
        if (sink === undefined || treeQuery === undefined || treePublished) return;
        treePublished = true;
        if (this.disposed || client !== this.client || treeStamp !== this.treeEpoch) return;
        if (treeAnswer === undefined) sink.failed();
        else this.publishTree(sink, server.folder, treeQuery.accept(treeAnswer), active, token);
      };
      const restRequests: PendingAsks = {
        permissions: permissionList.data.map(toPermissionAsk),
        forms: formList.data.map(toFormAsk),
      };
      const reads = await Promise.all(
        targets.map((pane) =>
          this.readPane(
            client,
            server,
            pane,
            list.data,
            active,
            stamps.get(pane)?.revertEvents ?? pane.revertEvents,
          ),
        ),
      );
      // Issue #77 E4: the lineage learns from every row read, BEFORE the registry of requests is
      // replaced, so the attention feature and the per-pane filters see the chains of this read.
      let learned = this.lineage.learn(list.data.map(toSessionSummary));
      for (const read of reads) if (this.lineage.learn(read.sessions)) learned = true;
      if (dropped()) {
        publishTreeHalf();
        return;
      }
      const current = stillCurrent();
      const requests = this.completeWithLive(restRequests);
      const pendingChanged = this.pending.replaceAll(requests.permissions, requests.forms);
      // A snapshot that taught the lineage something can change who shows a request that was
      // already pending, so the attention feature reads `displays` again (it must be idempotent).
      if (pendingChanged || (learned && this.pending.list().length > 0)) {
        this.deps.attention.update(this.pending.list());
      }
      for (const request of this.pending.list()) this.ensureLineage(request.sessionID);
      // So a request first seen here (asked before this host connected) can still be resolved
      // into a record when its `*.resolved` arrives.
      this.resolutions.rememberAsks(requests.permissions, requests.forms);
      targets.forEach((pane, index) => {
        const read = reads[index];
        if (read !== undefined && current.includes(pane)) {
          this.publishSnapshot(pane, read, token, requests);
        }
      });
      publishTreeHalf();
    } catch (error) {
      const info = toErrorInfo(error, this.secrets);
      // W1 of review 2 and W1 of its delta review: a failing read of the PANES (session.list,
      // session.active, the requests or a pane's messages) must not leave the tree in "Loading
      // sessions…" for good, so this runs BEFORE the panes' `dropped()` return (a racing one-pane
      // resync makes `dropped()` true without the tree's half having been published). It keeps the
      // gate of `publishTreeHalf`: not disposed, same client, and only the resync that still owns
      // the tree's stamp may say it failed. A Transport failure is left to the connection state.
      if (publishTreeHalf !== undefined) {
        // #111: the five reads answered, so the tree has its own outcome (its page, or the failure
        // of its own read) whatever a pane did afterwards; publishing it is idempotent.
        publishTreeHalf();
      } else if (
        info.code !== 'Transport' &&
        sink !== undefined &&
        treeQuery !== undefined &&
        !this.disposed &&
        client === this.client &&
        treeStamp === this.treeEpoch
      ) {
        sink.failed();
      }
      if (dropped()) return;
      if (info.code === 'Transport') {
        // The server is unreachable (it died or is restarting): the connection banner already
        // says so, and a notice on top would only be noise (W4 of the review; seen in the log
        // of the real-opencode run when the test killed the server mid-snapshot).
        this.log.warn(`snapshot failed (server unreachable): ${info.message}`);
        return;
      }
      this.log.error(`snapshot failed: ${info.code}: ${info.message}`);
      for (const pane of stillCurrent()) pane.post({ type: 'notice', level: 'error', error: info });
    } finally {
      this.resyncing -= 1;
    }
  }

  /**
   * The tree's half of a FULL resync (issue #77, E3): reconciles the first page of root sessions
   * with the stream exactly as the panes' snapshot does and hands it to the sink. Everything here
   * runs without an `await`. The rows and statuses of sessions deleted during the reads
   * (`live.removed`) are left out, so a stale read cannot bring a deleted row back; the usage and
   * the statuses the stream reported after `token` win over the older REST ones. The rows are
   * mirrored in the translator AFTER every pane's seed, so a `session.renamed` of a row only the
   * tree shows still reaches the sink. Not logged at `info`: the host logs what the tree shows.
   * VERIFIED by `chatController.test.ts` "reads the roots of the tree in the full resync and
   * reports them, statuses merged" and "leaves out of the tree a session deleted during the read"
   * (fake client, Windows 11, 29/10/2026).
   */
  private publishTree(
    sink: SessionListSink,
    folder: string,
    page: SessionPage,
    active: Awaited<ReturnType<ChatApi['session']['active']>>,
    token: ResyncToken,
  ): void {
    const rows = this.translator.mergeUsage(
      page.rows.filter((row) => !this.live.removed.has(row.id)),
      token,
    );
    const rest: { [sessionID: string]: SessionStatus } = {};
    for (const id of Object.keys(active)) rest[id] = { type: 'busy' };
    const statuses = { ...this.translator.mergeStatuses(rest, token) };
    for (const id of this.live.removed) delete statuses[id];
    this.translator.mirror(rows);
    this.lineage.learn(rows); // roots: a known root ends a chain without a `session.get`
    this.treeMirrored = rows.length > 0;
    sink.reset({ folder, rows, statuses, hasMore: page.hasMore });
    this.log.debug(
      `sessions tree read (${String(rows.length)} roots, more: ${String(page.hasMore)})`,
    );
  }

  /**
   * The per-pane half of a resync: reads what `pane`'s session needs on top of the location lists
   * (its messages, its children, its row and revert, its lineage) and works out the statuses of
   * the snapshot. Rows and statuses are copies, because every pane completes them its own way.
   * A remembered session that no longer exists is forgotten here (`pane.sessionID` cleared and the
   * per-folder memory emptied ONLY if it pointed at that session, because other tabs may have
   * written it), which the caller sees as `pane.sessionID !== openID`. When the missing session is
   * the one {@link ChatController.restorePane} bound to this pane, the pane goes into `lostSession` and {@link publishSnapshot} sends the Q1 notice to this pane
   * after a snapshot it can deliver; the restored mark is consumed by this first read either way,
   * which is why the pending notice lives in its own set (a read dropped as stale, or a hidden
   * tab, must not lose it). Rejects with whatever the client throws other than
   * `SessionNotFoundError`.
   * VERIFIED by `chatController.panes.test.ts` "a restored session deleted meanwhile…" and by
   * `chatController.test.ts` "forgets a remembered session that the server no longer has" (fake clients,
   * not a real server; Windows 11, 29/10/2026).
   * Issue #32: an event about the revert that arrived during these reads (`pane.revertEvents`
   * moved since `revertEventsAtStart`) is newer than the row: it owns the state, and the snapshot
   * just carries what the host holds. The same when the row could not be read (not in the list and
   * `session.get` failed): "no row" is not "no revert", and applying `undefined` would clear a
   * revert the server still has, showing the hidden messages again while the files stay reverted
   * (review W2).
   */
  private async readPane(
    client: ChatApi,
    server: RunningServerInfo,
    pane: ChatPane,
    listed: Awaited<ReturnType<ChatApi['session']['list']>>['data'],
    active: Awaited<ReturnType<ChatApi['session']['active']>>,
    revertEventsAtStart: number,
  ): Promise<PaneRead> {
    const sessions: SessionSummary[] = listed.map(toSessionSummary);
    const statuses: { [sessionID: string]: SessionStatus } = {};
    for (const id of Object.keys(active)) statuses[id] = { type: 'busy' };
    let open: OpenSession | undefined;
    let rawMessages: PaneRead['rawMessages'] = [];
    const openID = pane.sessionID;
    if (openID !== undefined) {
      try {
        const [messages, children] = await Promise.all([
          client.message.list({ sessionID: openID, order: 'desc', limit: MESSAGE_LIMIT }),
          this.readChildren(client, server.folder, openID),
        ]);
        rawMessages = [...messages.data].reverse(); // REST returned newest first
        open = { sessionID: openID, messages: [], parts: {} };
        for (const raw of rawMessages) {
          const mapped = toMessage(raw, this.secrets);
          if (mapped === undefined) continue;
          open.messages.push(mapped.message);
          if (mapped.parts.length > 0) open.parts[mapped.message.id] = mapped.parts;
        }
        // Issue #32: the prepared revert is a field of the session row, so it comes from the
        // list (or from the `session.get` below when the session is older than the 50 newest).
        let openRow = listed.find((row) => row.id === openID);
        if (openRow === undefined) {
          // Issue #20: a session opened from the list can be older than the 50 newest, and the
          // header takes its title from `sessions`; without the row it read "Untitled session".
          // Cosmetic, so a failure here must not fail the snapshot.
          try {
            openRow = await client.session.get({ sessionID: openID });
            sessions.push(toSessionSummary(openRow));
          } catch (error) {
            this.log.debug(`could not read the open session row: ${String(error)}`);
          }
        }
        const revertState =
          openRow !== undefined && pane.revertEvents === revertEventsAtStart
            ? await pane.reverts.apply(openID, openRow.revert, { post: false })
            : pane.reverts.state(openID);
        if (revertState !== undefined) open.revert = revertState;
        await this.addLineage(client, sessions, openID, children);
        if (statuses[openID] === undefined) {
          const newest = messages.data[0];
          statuses[openID] =
            newest?.type === 'idle' && newest.outcome === 'failed' && newest.error !== undefined
              ? { type: 'error', error: toStructuredErrorInfo(newest.error, this.secrets) }
              : { type: 'idle' };
        }
      } catch (error) {
        if (!isSessionNotFound(error)) throw error;
        this.log.warn(`remembered session ${openID} no longer exists; forgetting it`);
        pane.sessionID = undefined;
        // The memory holds ONE session per folder and several tabs read it: only empty it when
        // it pointed at THIS session, or a deleted session of tab A would erase tab B's memory.
        if (this.deps.memory.get(server.folder) === openID) {
          await this.deps.memory.set(server.folder, undefined);
        }
        if (this.restored.get(pane.id) === openID) this.lostSession.add(pane.id);
      }
    }
    this.restored.delete(pane.id);
    return { openID, open, rawMessages, sessions, statuses };
  }

  /**
   * The synchronous end of a resync for one pane: reconciles what REST said with what the stream
   * said meanwhile and posts the `snapshot` to THAT pane. Everything here runs without an `await`,
   * so no event can slip between the reconciliation and the post.
   *
   * Issue #20, review W1: the pane's session can be deleted (by another client, or by us) WHILE
   * `message.list` was in flight and the server answered before deleting. `onSessionRemoved`
   * already cleared `pane.sessionID`; publishing the local `open` would show the dead session
   * again while the host believes there is none. The same goes for the rows and statuses the
   * stream reported gone (`live.removed`). The totals of `session.usage.updated` seen after
   * `token` are newer than the REST rows (issue #25), and `open.compactedAt` is the
   * `time.created` of the last completed compaction among the messages read (`lastCompactionAt`).
   * The webview replaces its state with the snapshot, and the stream may have produced messages
   * after the REST reads: the snapshot is completed with them (`mergeLive`, review BLOCKER). The
   * statuses need the same care in the other direction: `session.active()` can say `busy` and a
   * `session.execution.succeeded` arrive before we publish; the stream already sent `idle`, so
   * the stale `busy` would overwrite it and nothing would ever correct it (Send stays disabled
   * while busy). `mergeStatuses` lets what the stream said after THIS resync's `token` win over
   * what REST said. Issue #31: once the snapshot is out and the pane has a session, its "Changed
   * files" list is sent again (the webview state was just replaced) and a reload is requested,
   * fire and forget. If the pane changed session between the read and this call, the snapshot
   * carries no open session and the seed uses an empty session id so it prunes no tracker of the
   * session the pane moved to (another pane may show it). HYPOTHESIS: by reading; the window needs
   * two panes and was not driven in a real VS Code. A pane in `lostSession` (its restored session
   * did not exist) gets the Q1 notice, to this pane only, right after a snapshot it could deliver;
   * if it could not, the flag stays for the snapshot of the next resync. VERIFIED with a fabricated
   * surface by "keeps the notice of a restored session that is gone until the tab can receive it,
   * then sends it once" (`chatController.panes.test.ts`, Windows 11, 29/10/2026). UNVERIFIED: a
   * real tab that is hidden when the server comes up (R5 of `test:visual` step 28 opens D after it).
   * Issue #77, E3: the seed ADDS to the translator's mirror (`merge`) not only with several panes
   * but also while the Sessions tree has rows mirrored (`treeMirrored`), or a single pane's resync
   * would forget the rows loaded with "Show more". VERIFIED by `chatController.test.ts` "keeps the
   * rows of the tree in the mirror when one pane resyncs".
   * Issue #77, E4: the snapshot's `requests` are the pane's own ({@link requestsOf}): a tab gets
   * only the requests of its session and its subagent lineage, the side-bar view all of them, and
   * the rows of the snapshot are first learned by the lineage so the filter sees them. VERIFIED by
   * `chatController.panes.test.ts` "sends each tab a snapshot with only the requests it shows"
   * (fabricated panes, 30/10/2026).
   */
  private publishSnapshot(
    pane: ChatPane,
    read: PaneRead,
    token: ResyncToken,
    requests: PendingAsks,
  ): void {
    let { open, rawMessages } = read;
    if (read.openID !== undefined && pane.sessionID !== read.openID) {
      open = undefined;
      rawMessages = [];
    }
    const statuses = { ...read.statuses };
    for (const id of this.live.removed) delete statuses[id];
    const rows = this.translator.mergeUsage(
      read.sessions.filter((row) => !this.live.removed.has(row.id)),
      token,
    );
    if (open !== undefined) {
      const compactedAt = lastCompactionAt(rawMessages);
      if (compactedAt !== undefined) open.compactedAt = compactedAt;
    }
    // The rows of this snapshot (children and parent of the open session included) complete the
    // lineage that decides which requests this pane shows (issue #77 E4).
    this.lineage.learn(rows);
    this.syncTracked();
    // The pane moved to another session since the read: seeding with its new id would prune the
    // trackers of that session, which another pane may be showing. An empty id prunes none.
    const moved = read.openID !== undefined && pane.sessionID !== read.openID;
    this.translator.seed({
      sessions: rows,
      messages: rawMessages,
      sessionID: moved ? '' : (pane.sessionID ?? ''),
      merge: this.panes.size > 1 || this.treeMirrored,
    });
    const complete = open === undefined ? undefined : this.translator.mergeLive(open);
    pane.post({
      type: 'snapshot',
      snapshot: {
        sessions: rows,
        statuses: this.translator.mergeStatuses(statuses, token),
        ...(complete ? { open: complete } : {}),
        requests: this.requestsOf(pane, requests),
        resolutions:
          pane.sessionID === undefined ? [] : this.resolutions.forSession(pane.sessionID),
      },
    });
    this.log.info(
      `snapshot sent (${String(rows.length)} sessions, open ${pane.sessionID ?? 'none'})`,
    );
    if (this.lostSession.has(pane.id) && pane.deliverable()) {
      // Decision Q1 of Sergio (29/10/2026): inside the tab, after its snapshot (the snapshot
      // would clear a notice that came first), to this pane only. Consumed on delivery.
      this.lostSession.delete(pane.id);
      this.log.info(`restored session gone: notice sent to pane ${String(pane.id)}`);
      pane.post({
        type: 'notice',
        level: 'info',
        error: {
          code: 'SessionDeleted',
          message: 'This session no longer exists. Your next prompt starts a new one.',
        },
      });
    }
    if (pane.sessionID !== undefined) {
      // Issue #32: a revert event applied while the snapshot was being built is newer than it.
      pane.reverts.resend(pane.sessionID, complete?.revert);
      pane.diffs.resend(pane.sessionID);
      void pane.diffs.request(pane.sessionID);
    }
  }

  /**
   * The subagent children of `parentID` (issue #21), newest first, at most {@link SESSION_LIMIT}.
   * Never rejects: a failure is a `debug` line and an empty list, so it cannot fail the snapshot.
   * Only rows whose `parentID` really is `parentID` are kept, in case the server ignored the
   * filter. VERIFIED by the planner spike that `list({ parentID })` returns the child and the
   * parent's own list does not (opencode 2.0.32, Windows 11, 21/10/2026).
   */
  private async readChildren(
    client: ChatApi,
    folder: string,
    parentID: string,
  ): Promise<SessionSummary[]> {
    try {
      const answer = await client.session.list({
        directory: folder,
        parentID,
        order: 'desc',
        limit: SESSION_LIMIT,
      });
      return answer.data.map(toSessionSummary).filter((row) => row.parentID === parentID);
    } catch (error) {
      this.log.debug(`could not read the children of the open session: ${String(error)}`);
      return [];
    }
  }

  /**
   * Adds to `sessions`, in place and without duplicating ids, the rows the header of the open
   * session needs (issue #21): its `children`, and its parent and fork origin read with
   * `session.get` when they are not among the rows already. A 404 or any other failure of those
   * reads is a `debug` line: the header then falls back to "Forked session" / no crumb. The two
   * reads go out in parallel (one round trip instead of up to two in the snapshot path); each one
   * catches its own failure, so one failing never loses the other.
   */
  private async addLineage(
    client: ChatApi,
    sessions: SessionSummary[],
    openID: string,
    children: readonly SessionSummary[],
  ): Promise<void> {
    for (const child of children) {
      if (!sessions.some((row) => row.id === child.id)) sessions.push(child);
    }
    const self = sessions.find((row) => row.id === openID);
    if (self === undefined) return;
    const missing = [self.parentID, self.forkOf].filter(
      (relative): relative is string =>
        relative !== undefined && !sessions.some((row) => row.id === relative),
    );
    const reads = await Promise.all(
      missing.map(async (relative) => {
        try {
          return toSessionSummary(await client.session.get({ sessionID: relative }));
        } catch (error) {
          this.log.debug(`could not read a related session row: ${String(error)}`);
          return undefined;
        }
      }),
    );
    for (const row of reads) {
      if (row !== undefined && !sessions.some((have) => have.id === row.id)) sessions.push(row);
    }
  }

  /**
   * Completes the REST requests with what the stream said while they were being read: an ask the
   * stream announced and REST did not list is added (REST was read before it existed); one the
   * stream resolved is removed (REST was read before it was answered). Order: REST first, then
   * the late arrivals. Same reasoning as `translator.mergeLive` for messages; the snapshot
   * REPLACES the webview's requests, so without this a card would vanish for a moment (or an
   * answered one come back) whenever a resync overlaps a request. Requests of a session the stream
   * reported deleted meanwhile (`live.removed`) are dropped too (issue #20).
   */
  private completeWithLive(rest: PendingAsks): PendingAsks {
    const permissions = rest.permissions.filter(
      (ask) => !this.live.gone.has(`permission:${ask.id}`) && !this.live.removed.has(ask.sessionID),
    );
    const forms = rest.forms.filter(
      (ask) => !this.live.gone.has(`form:${ask.id}`) && !this.live.removed.has(ask.sessionID),
    );
    for (const ask of this.live.permissions.values()) {
      if (!permissions.some((known) => known.id === ask.id)) permissions.push(ask);
    }
    for (const ask of this.live.forms.values()) {
      if (!forms.some((known) => known.id === ask.id)) forms.push(ask);
    }
    return { permissions, forms };
  }

  /**
   * Reads the catalog of the server (`model.list`, `provider.list`, `agent.list`, `model.default`,
   * four GETs in parallel) and publishes it as `catalog`. Resolves when the load, and the one more
   * it may owe, are done; never rejects. A call while a load is in flight does not start a second
   * one: it marks the catalog dirty, so the running load repeats once when it ends, and shares its
   * promise. The result REPLACES the previous catalog whole (a model that left must disappear);
   * a failed load keeps the previous one and writes a `warn` line, with no notice (the selectors
   * simply keep what they had). A load for a server that went away meanwhile is dropped.
   * All four answers are `{ location, data }` (VERIFIED, planner spike against opencode 2.0.32,
   * Windows 11, 21/10/2026; `model.default().data` is `null` when no model can be chosen).
   *
   * Issue #33: a fifth GET, `command.list`, runs in the same batch with its OWN failure handling:
   * if it fails, the catalog is still published, with the `commands` of the previous catalog (or
   * none the first time: absent, not `[]`) and a `warn` line `command list failed: <code>:
   * <message>`. The log line is `catalog loaded (<n> models, <m> agents, <k> commands)`, where
   * `<k>` is `no` when the list was never read. `command.updated` also triggers this reload.
   * A real server answered `command.list` with `[]` on the first call after it started (VERIFIED
   * in ONE run of the `real-opencode` case "lists the project commands and refuses an unknown one
   * with CommandNotFoundError", Windows 11, opencode 2.0.32, 28/10/2026; not seen whether it
   * happens every time or on other systems), so a load that reads `[]` also schedules
   * {@link scheduleCommandRetry}: only `command.list` is read again, after 1, 2 and 4 s, until a
   * list that is not empty arrives. A new full load, a stop or a restart of the server cancels it.
   */
  loadCatalog(): Promise<void> {
    if (this.client === undefined || this.disposed) return Promise.resolve();
    if (this.catalogRun !== undefined) {
      this.catalogDirty = true;
      return this.catalogRun;
    }
    const epoch = this.catalogEpoch;
    const run: Promise<void> = this.repeatCatalogLoads(epoch).finally(() => {
      if (this.catalogRun === run) this.catalogRun = undefined;
    });
    this.catalogRun = run;
    return run;
  }

  /** Loads the catalog, and once more per `catalogDirty` raised meanwhile, while `epoch` holds. */
  private async repeatCatalogLoads(epoch: number): Promise<void> {
    do {
      this.catalogDirty = false;
      await this.readCatalog(epoch);
    } while (this.catalogDirty && epoch === this.catalogEpoch && !this.disposed);
  }

  /** One catalog read for the server of `epoch`; see {@link loadCatalog}. Never throws. */
  private async readCatalog(epoch: number): Promise<void> {
    const client = this.client;
    if (client === undefined) return;
    this.cancelCommandRetry(); // this load reads the list itself, and schedules again if it is empty
    try {
      // Issue #33: the command list has its own catch, so a failing `command.list` never takes
      // the models and agents down with it.
      const [models, providers, agents, fallback, commands] = await Promise.all([
        client.model.list(),
        client.provider.list(),
        client.agent.list(),
        client.model.default(),
        client.command.list().catch((error: unknown) => {
          const info = toErrorInfo(error, this.secrets);
          return { failure: `${info.code}: ${info.message}` };
        }),
      ]);
      if (epoch !== this.catalogEpoch || this.disposed) return;
      const agentOptions = toAgentOptions(agents.data);
      const catalog: Catalog = {
        models: models.data.map(toModelOption),
        providers: providers.data.map(toProviderOption),
        agents: agentOptions,
      };
      if ('data' in commands) {
        catalog.commands = commands.data.map(toCommandOption);
      } else {
        this.log.warn(`command list failed: ${commands.failure}`);
        if (this.catalog?.commands !== undefined) catalog.commands = this.catalog.commands;
      }
      if (fallback.data !== null) {
        catalog.serverDefault = { providerID: fallback.data.providerID, id: fallback.data.id };
      }
      // The server lists its default agent first (core/agent.ts L106-111 at v2.0.32, read).
      const first = agentOptions[0];
      if (first !== undefined) catalog.defaultAgent = first.id;
      this.catalog = this.withPreferredModel(catalog);
      this.log.info(
        `catalog loaded (${String(catalog.models.length)} models, ${String(catalog.agents.length)} agents, ${catalog.commands === undefined ? 'no' : String(catalog.commands.length)} commands)`,
      );
      this.broadcast({ type: 'catalog', catalog: this.catalog });
      if ('data' in commands && commands.data.length === 0) this.scheduleCommandRetry(epoch, 0);
    } catch (error) {
      if (epoch !== this.catalogEpoch) return;
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`catalog load failed: ${info.code}: ${info.message}`);
    }
  }

  /**
   * Cancels the pending command re-read, if any, and bumps `commandRetryGeneration` so a re-read
   * already IN FLIGHT (its timer fired, its `command.list` not yet answered) is discarded when it
   * resolves: clearing the timer alone cannot stop an await that is already running.
   */
  private cancelCommandRetry(): void {
    if (this.commandRetryTimer !== undefined) clearTimeout(this.commandRetryTimer);
    this.commandRetryTimer = undefined;
    this.commandRetryGeneration++;
  }

  /**
   * Re-reads ONLY `command.list` after an empty answer (issue #33): waits 1, 2 and 4 s (`attempt`
   * 0, 1, 2; our choice, Sergio's decision of 28/10/2026), stops at the first list that is not
   * empty, publishes the held catalog with it (a plain `catalog` message, no full reload) and logs
   * `commands loaded after retry <n> (<k> commands)`. After the third empty answer it logs
   * `command list still empty after 3 retries` and gives up; a read that fails logs `command list
   * retry failed: <code>: <message>` and gives up too. No new read starts after the epoch changed,
   * the controller was disposed or a full load replaced the catalog (each cancels the timer), and
   * a read already in flight when that happens is discarded on arrival: `retryCommands` compares
   * the generation it captured before the await (also in its catch), so it cannot overwrite a
   * newer catalog, log, or schedule another read.
   * VERIFIED by the unit cases of the describe "retry of an empty list" in `chatController.test.ts`
   * (fake timers, a fake client): "three empty answers in a row: it stops, with no more reads",
   * "a full reload while a retry is in flight: the new list stays and nothing else is read"
   * (non-empty stale list), "a stale read that returns [] does not schedule another read" and
   * "a stale read that throws writes no warn and schedules nothing". Each exit was mutated on
   * 29/10/2026 (Windows 11): dropping `stale() ||` from the success exit fails "a full reload
   * while a retry is in flight…" and "a stale read that returns []…", dropping
   * `if (stale()) return;` from the catch fails "a stale read that throws…". UNVERIFIED against a
   * real server: in the real-opencode runs the first full load gave "0 commands" and the next
   * FULL load (not this retry) gave "2 commands", so this path and its timings were never seen
   * there.
   */
  private scheduleCommandRetry(epoch: number, attempt: number): void {
    this.cancelCommandRetry();
    const delay = 1_000 * 2 ** attempt;
    this.commandRetryTimer = setTimeout(() => {
      this.commandRetryTimer = undefined;
      void this.retryCommands(epoch, attempt);
    }, delay);
  }

  /** One re-read of `command.list`; see {@link scheduleCommandRetry}. Never throws. */
  private async retryCommands(epoch: number, attempt: number): Promise<void> {
    const client = this.client;
    if (client === undefined || epoch !== this.catalogEpoch || this.disposed) return;
    const generation = this.commandRetryGeneration;
    const stale = (): boolean =>
      epoch !== this.catalogEpoch || this.disposed || generation !== this.commandRetryGeneration;
    try {
      const listed = await client.command.list();
      if (stale() || this.catalog === undefined) return;
      if (listed.data.length > 0) {
        this.catalog = { ...this.catalog, commands: listed.data.map(toCommandOption) };
        this.log.info(
          `commands loaded after retry ${String(attempt + 1)} (${String(listed.data.length)} commands)`,
        );
        this.broadcast({ type: 'catalog', catalog: this.catalog });
      } else if (attempt < 2) {
        this.scheduleCommandRetry(epoch, attempt + 1);
      } else {
        this.log.info('command list still empty after 3 retries');
      }
    } catch (error) {
      if (stale()) return;
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`command list retry failed: ${info.code}: ${info.message}`);
    }
  }

  /**
   * Returns `catalog` with `preferredModel` set from the user's preferences: the
   * `openVsCode.defaultModel` setting, then the last model used, each only if the catalog offers it.
   * A setting that is written but unusable is reported by {@link reportIgnoredSetting}.
   */
  private withPreferredModel(catalog: Catalog): Catalog {
    const { model, ignored } = resolvePreferredModel({
      setting: this.deps.preferences.defaultModel(),
      last: this.deps.preferences.lastModel(),
      available: catalog.models,
    });
    this.reportIgnoredSetting(ignored);
    const next: Catalog = {
      models: catalog.models,
      providers: catalog.providers,
      agents: catalog.agents,
    };
    if (catalog.commands !== undefined) next.commands = catalog.commands;
    if (catalog.serverDefault !== undefined) next.serverDefault = catalog.serverDefault;
    if (catalog.defaultAgent !== undefined) next.defaultAgent = catalog.defaultAgent;
    if (model !== undefined) next.preferredModel = model;
    return next;
  }

  /**
   * Tells the user ONCE per distinct value that `openVsCode.defaultModel` is not being applied:
   * a `warn` line with the reason only, and an info `notice`. A value that applies (or no value)
   * forgets the last report, so fixing the setting and breaking it again is told again.
   */
  private reportIgnoredSetting(
    ignored: { value: string; reason: 'invalid' | 'unavailable' } | undefined,
  ): void {
    if (ignored === undefined) {
      this.ignoredSettingNoticed = undefined;
      return;
    }
    if (this.ignoredSettingNoticed === ignored.value) return;
    this.ignoredSettingNoticed = ignored.value;
    this.log.warn(`default model setting ignored: ${ignored.reason}`);
    const shown = ignored.value.length > 80 ? `${ignored.value.slice(0, 80)}…` : ignored.value;
    this.broadcast({
      type: 'notice',
      level: 'info',
      error: {
        code: 'DefaultModelIgnored',
        message:
          ignored.reason === 'invalid'
            ? `openVsCode.defaultModel “${shown}” is not written provider/model, so it is ignored`
            : `The model “${shown}” of openVsCode.defaultModel is not offered by the server, so it is ignored`,
      },
    });
  }

  /**
   * The user's preferences changed (the setting, from `chatLifecycle.ts`): recomputes the model a
   * new session proposes with the catalog already held and publishes it again. No REST call. Does
   * nothing without a catalog (the first load will read the preferences itself).
   */
  onPreferencesChanged(): void {
    if (this.catalog === undefined || this.disposed) return;
    this.catalog = this.withPreferredModel(this.catalog);
    this.broadcast({ type: 'catalog', catalog: this.catalog });
  }

  /** The held catalog, loading it first when there is none; `undefined` if the load failed. */
  private async ensureCatalog(): Promise<Catalog | undefined> {
    if (this.catalog !== undefined) return this.catalog;
    await this.loadCatalog();
    return this.catalog;
  }

  /**
   * Checks the model and agent of a `prompt.send` against `catalog`. Returns the error body to
   * answer with, or `undefined` when both are offered (or absent). A variant must be one the
   * catalog lists for that model, else the answer is `VariantUnavailable` (issue #61), told apart
   * from `ModelUnavailable` because the model is still fine and only the reasoning level must be
   * chosen again. The webview is untrusted input, and the server would accept anything here and
   * fail the NEXT turn instead (VERIFIED, planner spike, opencode 2.0.32; the variant case is read
   * in `model-resolver.ts@843a6c51`, `VariantUnavailableError` raised when the turn runs, not run).
   */
  private checkSelection(
    catalog: Catalog,
    model: ModelRef | undefined,
    agent: string | undefined,
  ): { _tag: string; message: string } | undefined {
    if (model !== undefined) {
      const option = catalog.models.find(
        (candidate) => candidate.providerID === model.providerID && candidate.id === model.id,
      );
      if (option === undefined) {
        return {
          _tag: 'ModelUnavailable',
          message: 'That model is not offered by the server any more. Choose another one.',
        };
      }
      if (model.variant !== undefined && !option.variants.includes(model.variant)) {
        return {
          _tag: 'VariantUnavailable',
          message:
            'That reasoning level is not offered for this model any more. Choose another one.',
        };
      }
    }
    if (agent !== undefined && !catalog.agents.some((candidate) => candidate.id === agent)) {
      return {
        _tag: 'AgentUnavailable',
        message: 'That agent is not available any more. Choose another one.',
      };
    }
    return undefined;
  }

  /**
   * Puts an EXISTING session on the agent and model the user chose, just before its prompt.
   *
   * Reads the session (`session.get`) and compares ONLY with what the session has stored: it calls
   * `switchAgent` when `agent !== info.agent` and `switchModel` when the model differs from
   * `info.model` (variant included, issue #61: the same model with another reasoning level, or with
   * none, is a switch; "Default" is a model reference WITHOUT `variant`, and the server dedupes
   * with `variant ?? "default"`), and a session that stores nothing always gets the switch. So a
   * model or agent the user chose is PINNED on the session, even when it equals the server default
   * of today (decision of Sergio, 21/10/2026, review #1015 W1): leaving it unpinned would let a
   * later credential, provider or config change move the session to another model. The price is one
   * `model-switched` (or `agent-switched`) message the first time a session without a stored value
   * gets a choice.
   * The server does NOT deduplicate `switchAgent` (it publishes an `agent-switched` message every
   * time; going to or from `plan` also queues a reminder), and does deduplicate `switchModel`
   * against the stored model. Agent first, then model. Throws what the client throws; the caller
   * then sends NO prompt. VERIFIED against a real opencode 2.0.32 in the planner spike (Windows 11,
   * 21/10/2026) for the server behaviours quoted; the pinning itself is covered by
   * `chatController.test.ts` with a fake client only. UNVERIFIED against a real server inside VS
   * Code: test:visual steps 11 and 13 send every prompt to a NEW session, which goes through
   * `session.create`, never through this method (review E5-model-agent-selectors/review-2 W1).
   */
  private async applySelection(
    client: ChatApi,
    sessionID: string,
    model: ModelRef | undefined,
    agent: string | undefined,
  ): Promise<void> {
    if (model === undefined && agent === undefined) return;
    const info = await client.session.get({ sessionID });
    if (agent !== undefined && agent !== info.agent) {
      await client.session.switchAgent({ sessionID, agent });
      this.log.info(`agent selected ${agent} for ${sessionID}`);
    }
    const current = info.model === undefined ? undefined : toModelRef(info.model);
    if (model !== undefined && (current === undefined || !sameModel(model, current))) {
      await client.session.switchModel({ sessionID, model });
      this.log.info(
        `model selected ${model.providerID}/${model.id} for ${sessionID}${variantSuffix(model)}`,
      );
    }
  }

  /**
   * Makes `sessionID` the session `pane` shows, remembers it for the served folder and publishes
   * its history to that pane.
   */
  private async openSession(pane: ChatPane, sessionID: string): Promise<void> {
    pane.sessionID = sessionID;
    if (this.server !== undefined) await this.deps.memory.set(this.server.folder, sessionID);
    this.syncTracked();
    await this.resync([pane]);
  }

  /** Posts to `pane` the outcome of a request it made: success, or the scrubbed error. */
  private result(pane: ChatPane, requestId: string, error?: unknown): void {
    if (error === undefined) {
      pane.post({ type: 'request.result', requestId });
      return;
    }
    const info: ErrorInfo = toErrorInfo(error, this.secrets);
    this.log.warn(`request ${requestId} failed: ${info.code}: ${info.message}`);
    pane.post({ type: 'request.result', requestId, error: info });
  }

  /**
   * `session.abort` (issue #16): interrupts the running turn of `sessionID`.
   *
   * Calls `session.interrupt` without `resume`: with this UI Send is disabled while busy, so
   * there are no queued prompts to resume (alternative `resume: true` only makes sense with
   * steering). The session goes idle through the `session.execution.interrupted` event the
   * translator already handles, not through this answer. `interrupted: false` means the server
   * had nothing of its own to interrupt (idle session, or a turn owned by another opencode
   * process), so the webview's "busy" may be stale: `resync()` heals it. The v1 route
   * `/session/:id/abort` that issue #16 cites does not exist in v2. The log line is stable (see
   * the header). VERIFIED against a real opencode 2.0.32 on Windows 11 (20/10/2026, opt-in
   * `realOpencode.test.ts`): a 400-number prompt interrupted 1.5 s in logged `abort requested for
   * ses_... (interrupted: true)` and then `turn finished: interrupted`, so the route, the bare
   * body and the event are as read. The `interrupted: false` path is only exercised against the
   * synthetic fixture (`chatController.e2e.test.ts`). POSIX UNVERIFIED.
   */
  private async abort(pane: ChatPane, requestId: string, sessionID: string): Promise<void> {
    const client = this.client;
    if (client === undefined) return this.result(pane, requestId, unavailable());
    try {
      const { interrupted } = await client.session.interrupt({ sessionID });
      this.log.info(`abort requested for ${sessionID} (interrupted: ${String(interrupted)})`);
      this.result(pane, requestId);
      if (!interrupted) await this.resync();
    } catch (error) {
      this.result(pane, requestId, error);
    }
  }

  /**
   * Runs one editor-side action. These webview messages have no `requestId`, so a failure is
   * reported as a `warning` notice (scrubbed like every error text) and a `warn` log line; it
   * never throws.
   */
  private async editorAction(
    pane: ChatPane,
    type: string,
    action: () => Promise<void>,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`${type} failed: ${info.code}: ${info.message}`);
      pane.post({ type: 'notice', level: 'warning', error: info });
    }
  }

  /**
   * `setup.action` (E2, issue #85): runs the button of the setup guide or the error card through
   * `deps.setup`. The action is a closed union the guard already checked, so there is nothing to
   * whitelist. Only `binary.choose` can fail (its file dialog can reject and it writes a setting): its failure becomes a
   * `warning` notice like any editor action; the other actions are fire and forget and their
   * outcome, if any, is the next `connection.state`. Logs `setup action: <action>`.
   * Issue #86: `binary.choose` answers the asking pane (never a broadcast) with `setup.binary`:
   * `cancelled` when the dialog closes without a file; otherwise `chosen` with the path, posted
   * BEFORE the setting is written so it precedes the `connection.state` the detection produces
   * (same channel, in order). A pick equal to the current setting fires no change event, so the
   * controller calls `redetectBinary` instead of writing (P-C=1); a failed write answers `failed`
   * and a `warning` notice. A rejected `pickBinary` (the dialog itself failing, not a cancel)
   * answers `failed` plus the same `warning` notice (decision of Sergio, 28/10/2026), and writes
   * nothing; the unit test "turns a rejected dialog into setup.binary failed ..." covers it. Logs `binary choice:
   * <outcome>` without the path (the detection lines carry it).
   * VERIFIED on Windows 11, VS Code 1.143.1 (27/10/2026) for `binary.choose` and `server.restart`:
   * the visual checks "Choose binary… through the real file dialog wrote the setting and step 1
   * is done" and "Restart is pressed with the real mouse". The other actions were never clicked
   * in a real window (UNVERIFIED, see `setupActions.ts`). VERIFIED on Windows 11, VS Code 1.144.0
   * (28/10/2026), full `npm run test:visual`: "ok   after choosing a path, step 1 says Checking…
   * while the detection runs" and "ok   cancelling the file dialog gives Choose binary… back and
   * step 1 stays Failed". The order `chosen` before the write is checked by `chatController.test.ts`
   * with a recording double only.
   */
  private async setupAction(pane: ChatPane, action: SetupAction): Promise<void> {
    this.log.info(`setup action: ${action}`);
    switch (action) {
      case 'binary.choose':
        await this.chooseBinary(pane);
        return;
      case 'binary.settings':
        this.deps.setup.openBinarySettings();
        return;
      case 'server.settings':
        this.deps.setup.openServerSettings();
        return;
      case 'server.password':
        this.deps.setup.setServerPassword();
        return;
      case 'install.guide':
        this.deps.setup.openInstallGuide();
        return;
      case 'folder.open':
        this.deps.setup.openFolder();
        return;
    }
  }

  /**
   * The "Choose binary…" flow of {@link setupAction} (issue #86): pick, tell the pane, then write
   * the setting or re-run the detection. Never throws: every failure (a rejected dialog or a
   * rejected write) becomes `setup.binary` `failed`, a `warning` notice as any editor action, and
   * a log line. Both failure branches are covered by unit tests with a FABRICATED rejecting double
   * ("turns a failed write ..." and "turns a rejected dialog ..." in `chatController.test.ts`);
   * UNVERIFIED in a real window. The happy path and the cancel are driven by `test:visual` step 0.
   */
  private async chooseBinary(pane: ChatPane): Promise<void> {
    const { setup } = this.deps;
    let picked: string | undefined;
    try {
      picked = await setup.pickBinary();
    } catch (error) {
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`setup.action failed: ${info.code}: ${info.message}`);
      this.log.info('binary choice: failed');
      pane.post({ type: 'setup.binary', outcome: 'failed' });
      pane.post({ type: 'notice', level: 'warning', error: info });
      return;
    }
    if (picked === undefined) {
      this.log.info('binary choice: cancelled');
      pane.post({ type: 'setup.binary', outcome: 'cancelled' });
      return;
    }
    this.log.info('binary choice: chosen');
    pane.post({ type: 'setup.binary', outcome: 'chosen', path: picked });
    if (picked === setup.currentBinaryPath()) {
      setup.redetectBinary();
      return;
    }
    try {
      await setup.writeBinaryPath(picked);
    } catch (error) {
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`setup.action failed: ${info.code}: ${info.message}`);
      this.log.info('binary choice: failed');
      pane.post({ type: 'setup.binary', outcome: 'failed' });
      pane.post({ type: 'notice', level: 'warning', error: info });
    }
  }

  /**
   * `session.diff.open` (issue #31): opens the native diff of one row of "Changed files".
   *
   * The webview is untrusted, so the host opens a file only if it LISTED that `path` for that very
   * session and the session is the open one (`SessionDiffs.target`); the path was already checked
   * to lie inside the served folder when the list was built. Anything else is refused with a
   * `warning` notice and the log line `diff open refused: not listed` or `diff open refused:
   * session not open`, which carries no path (it is a file name of the user's project, and the
   * rejected one was chosen by the webview). A success logs `diff opened (<status>)`, or `diff
   * opened (<status>, file only)` when the editor side had no text diff and opened the file, and
   * the user is told so with an `info` notice. An editor failure becomes a `warning` notice like
   * the other editor actions. Never throws.
   * VERIFIED by `chatController.test.ts` with a fake editor (refusals call nothing, a listed path
   * calls `openDiff` with the absolute path of the served folder) and, in a real VS Code 1.143
   * (Windows 11, 23/10/2026, synthetic server), by the `fakeServer.test.ts` checks "lists the files
   * an edit turn changed and opens the native diff of one" and "refuses to open a diff for a path
   * it did not list", and by the `test:visual` check "a diff editor opens in the active tab
   * "sample.ts"". macOS and Linux UNVERIFIED.
   */
  private async openChangedFile(pane: ChatPane, sessionID: string, shown: string): Promise<void> {
    const checked = pane.diffs.target(sessionID, shown);
    if (!checked.ok) {
      this.log.warn(`diff open refused: ${checked.reason}`);
      pane.post({
        type: 'notice',
        level: 'warning',
        error: {
          code: 'DiffNotListed',
          message: 'That file is not in the changed files of this session any more',
        },
      });
      return;
    }
    await this.editorAction(pane, 'session.diff.open', async () => {
      const opened = await this.deps.editor.openDiff(checked.target);
      this.log.info(
        opened === 'diff'
          ? `diff opened (${checked.target.status})`
          : `diff opened (${checked.target.status}, file only)`,
      );
      if (opened === 'file') {
        pane.post({
          type: 'notice',
          level: 'info',
          error: {
            code: 'NoTextDiff',
            message: 'There is no text diff for this file, so the file itself was opened',
          },
        });
      }
    });
  }

  /**
   * `session.revert.open` (issue #32): opens the diff of what a prepared revert undid in one file,
   * the text before the revert on the left and the file on disk on the right. Same policy as
   * {@link openChangedFile}: only a path the host listed in the revert it sent, for the open
   * session, is opened; anything else is a `warning` notice and the log line `revert diff open
   * refused: not listed|session not open` (no path). Success logs `revert diff opened (<status>)`
   * (or `… file only` for a file with no text diff). Never throws.
   * VERIFIED by `chatController.test.ts` with a fake editor ("opens the diff of a file the revert
   * undid and refuses one it did not list", Windows 11, 23/10/2026); the VS Code side is covered
   * by `sessionDiffEditor.ts`.
   */
  private async openRevertedFile(pane: ChatPane, sessionID: string, shown: string): Promise<void> {
    const checked = pane.reverts.target(sessionID, shown);
    if (!checked.ok) {
      this.log.warn(`revert diff open refused: ${checked.reason}`);
      pane.post({
        type: 'notice',
        level: 'warning',
        error: {
          code: 'DiffNotListed',
          message: 'That file is not among the files of the revert any more',
        },
      });
      return;
    }
    await this.editorAction(pane, 'session.revert.open', async () => {
      const opened = await this.deps.editor.openDiff(checked.target);
      this.log.info(
        opened === 'diff'
          ? `revert diff opened (${checked.target.status})`
          : `revert diff opened (${checked.target.status}, file only)`,
      );
      if (opened === 'file') {
        pane.post({
          type: 'notice',
          level: 'info',
          error: {
            code: 'NoTextDiff',
            message: 'There is no text diff for this file, so the file itself was opened',
          },
        });
      }
    });
  }

  /**
   * The text `shown` had before the prepared revert undid the session's changes, for the left side
   * of a revert diff (called by the content provider of `sessionDiffEditor.ts`). Rejects with
   * `DiffNotListed` when it is not a file of the revert and `NoTextDiff` when it cannot be rebuilt.
   */
  revertedOriginal(sessionID: string, shown: string): Promise<string> {
    const pane = this.panesOf(sessionID)[0];
    if (pane === undefined) {
      return Promise.reject(
        codedError('DiffNotListed', 'That file is not among the files of the revert'),
      );
    }
    return pane.reverts.original(sessionID, shown);
  }

  /**
   * `session.revert.stage` (issue #32): prepares a revert from a USER message of the open session.
   *
   * Staging rewrites files on the user's disk, so unlike the fork the host checks first, with
   * `session.message.get`, that `messageID` is a `user` message (upstream only offers the action on
   * those; staging from an assistant message would delete history without restoring its files,
   * `revert.ts` @843a6c51) and that `sessionID` is the open session. Otherwise the result is an
   * error (`SessionNotOpen`, `NotAUserMessage`) and the server is not asked to stage. A turn in
   * flight is the server's `SessionBusyError`, returned as the error of the result (the webview
   * disables the action while busy; this covers the race). On success the answer is mapped and
   * published as `session.revert` and the "Changed files" list is reloaded, bounded by the new
   * boundary. Logs ids and a count only: `revert staged for <sid>: <n> files`, `revert refused:
   * <reason>`.
   * HYPOTHESIS: `message.get` answers a `type` for every message kind (read in the client types);
   * the real server answered `MessageNotFoundError` for an unknown id on `stage` (observed 23/10/2026,
   * Windows 11, case "stages, clears and commits a revert on a shell message" of `realOpencode.test.ts`).
   * VERIFIED (23/10/2026, Windows 11, real opencode 2.0.32, same case): `message.get` with the
   * `messageID` of a `shell` message of ANOTHER session did not return that message under this
   * `sessionID` (an assertion inside the case, no model needed). HYPOTHESIS: a foreign `user`
   * message is refused the same way, so it cannot pass the `type === 'user'` check (only `shell`
   * messages exist without a model). Not observed: whether it rejects or returns something else
   * (the assertion accepts both).
   */
  private async stageRevert(
    pane: ChatPane,
    message: Extract<WebviewToHost, { type: 'session.revert.stage' }>,
  ): Promise<void> {
    const { requestId, sessionID, messageID } = message;
    const client = this.client;
    if (client === undefined) return this.result(pane, requestId, unavailable());
    if (sessionID !== pane.sessionID) {
      this.log.warn('revert refused: session not open');
      return this.result(pane, requestId, {
        _tag: 'SessionNotOpen',
        message: 'Only the open session can be reverted',
      });
    }
    try {
      const target = await client.session.message.get({ sessionID, messageID });
      if (target.type !== 'user') {
        this.log.warn('revert refused: not a user message');
        return this.result(pane, requestId, {
          _tag: 'NotAUserMessage',
          message: 'You can only revert from a message you sent',
        });
      }
      const revert = await client.session.revert.stage({ sessionID, messageID });
      if (client !== this.client) return this.result(pane, requestId, unavailable());
      pane.revertEvents += 1;
      this.log.info(`revert staged for ${sessionID}: ${String(revert.files?.length ?? 0)} files`);
      await pane.reverts.apply(sessionID, revert, { post: true });
      void pane.diffs.request(sessionID);
      this.result(pane, requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(pane, requestId, error);
    }
  }

  /**
   * `session.revert.clear` ("Restore"): the server puts the files back and the history returns. The
   * state is applied from the HTTP answer without waiting for `session.revert.cleared`, so the
   * banner goes at once and a downed stream cannot leave it up. Right after a clear the server
   * wakes the session and a new revert can be `SessionBusyError` for a moment (observed, see
   * {@link ChatApi}). Logs `revert cleared for <sid>`.
   */
  private async clearRevert(
    pane: ChatPane,
    message: Extract<WebviewToHost, { type: 'session.revert.clear' }>,
  ): Promise<void> {
    const { requestId, sessionID } = message;
    const client = this.client;
    if (client === undefined) return this.result(pane, requestId, unavailable());
    if (sessionID !== pane.sessionID) {
      this.log.warn('revert refused: session not open');
      return this.result(pane, requestId, {
        _tag: 'SessionNotOpen',
        message: 'Only the open session can be restored',
      });
    }
    try {
      await client.session.revert.clear({ sessionID });
      if (client !== this.client) return this.result(pane, requestId, unavailable());
      pane.revertEvents += 1;
      this.log.info(`revert cleared for ${sessionID}`);
      await pane.reverts.apply(sessionID, undefined, { post: true });
      void pane.diffs.request(sessionID);
      this.result(pane, requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(pane, requestId, error);
    }
  }

  /**
   * `session.revert.commit` ("Discard for good"): asks the user through
   * `deps.sessions.confirmRevertDiscard` (a native modal, the only confirmation of the feature;
   * the step that cannot be undone is this one, preparing is reversible) and only on "Discard for
   * good" calls the server. A declined dialog is a success without error and logs `revert commit
   * cancelled <sid>`. After the call the host forgets the revert and resyncs ({@link afterCommit}):
   * the `session.revert.committed` event does the same, and a downed stream must not leave the
   * banner up. Refuses (`SessionNotOpen`) a session that is not the open one.
   */
  private async commitRevert(
    pane: ChatPane,
    message: Extract<WebviewToHost, { type: 'session.revert.commit' }>,
  ): Promise<void> {
    const { requestId, sessionID } = message;
    const client = this.client;
    if (client === undefined) return this.result(pane, requestId, unavailable());
    if (sessionID !== pane.sessionID) {
      this.log.warn('revert refused: session not open');
      return this.result(pane, requestId, {
        _tag: 'SessionNotOpen',
        message: 'Only the open session can be discarded',
      });
    }
    try {
      if (!(await this.deps.sessions.confirmRevertDiscard())) {
        this.log.info(`revert commit cancelled ${sessionID}`);
        return this.result(pane, requestId);
      }
      const boundary = pane.reverts.boundary(sessionID);
      await client.session.revert.commit({ sessionID });
      if (client !== this.client) return this.result(pane, requestId, unavailable());
      this.afterCommit([pane], sessionID, boundary);
      this.result(pane, requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(pane, requestId, error);
    }
  }

  /**
   * The text `shown` had before the open session changed it, for the read-only document on the left
   * of a diff (called by the content provider of `sessionDiffEditor.ts`). Rejects with
   * `DiffNotListed` when the path is not one the host listed for the open session, and with
   * `NoTextDiff` when the original cannot be rebuilt; VS Code then shows the message in the editor.
   */
  diffOriginal(sessionID: string, shown: string): Promise<string> {
    const pane = this.panesOf(sessionID)[0];
    if (pane === undefined) {
      return Promise.reject(
        codedError('DiffNotListed', 'That file is not in the changed files of this session'),
      );
    }
    return pane.diffs.original(sessionID, shown);
  }

  /**
   * Subscribes to "the originals of this session may have changed" (a new list or a moved range,
   * see `SessionDiffs.onRenewed`); the content provider re-reads its open documents on it.
   * Returns the unsubscribe function.
   */
  onDiffRenewed(listener: (sessionID: string) => void): () => void {
    this.renewedListeners.add(listener);
    return () => {
      this.renewedListeners.delete(listener);
    };
  }

  /**
   * `attachments.pick`: shows the picker and answers with the files. Their `uri`s are remembered
   * in `pickedUris`: the webview is untrusted, and the server would read any `file://` it is
   * given and send it to the model provider, so `prompt.send` accepts only what came from here.
   * A cancelled dialog is an empty list, not an error. `kind` (E2, decision P11) is handed to the
   * picker: `image` filters the dialog and drops anything that is not an image by extension.
   */
  private async pickAttachments(
    pane: ChatPane,
    requestId: string,
    kind: 'file' | 'image',
  ): Promise<void> {
    try {
      const files = await this.deps.editor.pickFiles(kind);
      for (const file of files) this.pickedUris.add(file.uri);
      pane.post({ type: 'attachments.picked', requestId, files });
      this.result(pane, requestId);
    } catch (error) {
      this.result(pane, requestId, error);
    }
  }

  /**
   * `attachments.drop` (issue #30) and, with `verify` false, "Add to OpenCode Chat": turns URIs
   * into chips. The editor side keeps regular files inside the served folder; with `verify` the
   * server must also LIST each one (`file.find` with the relative path, exact match on the `uri`),
   * so what git ignores cannot be whitelisted by a message that is no click (decision Q2 of
   * Sergio, 23/10/2026; the threat model is on {@link pickedUris}). The Explorer command passes
   * `false`: it is a click the host sees, the same trust as the Attach dialog. Whatever was
   * refused (folders, ignored files, outside the folder, remote, missing) makes ONE `warning`
   * notice with the count and nothing else (no names); the valid ones of the same drop still go.
   * The drop says "dropped … folders, ignored files and files outside…"; the Explorer command says
   * "selected … folders and files outside…", since it filters no ignored file.
   * Logs `dropped files added: N, skipped: M` (counts only). Without a server `verify` fails with
   * `ServerUnavailable`. The chips and the notice of the Explorer command (`verify` false) go
   * through {@link ChatPane.postOrKeep}: with the chat view hidden they wait for the next `ready` instead of
   * being dropped by the provider (review of 23/10/2026, B2).
   * UNVERIFIED against a real VS Code drag (microsoft/vscode#339036); see the integration case
   * "adds dropped files, counts what it refuses" for the injected message. UNVERIFIED that
   * `file.find` of a real server lists an ordinary file among its first 20 results (the fake
   * invents the list).
   */
  private async dropFiles(
    pane: ChatPane,
    requestId: string,
    uris: readonly string[],
    verify: boolean,
  ): Promise<void> {
    try {
      const folder = this.server?.folder;
      const dropped = await this.deps.editor.droppedFiles(folder, uris);
      let refs = dropped.refs;
      let ignored = 0;
      if (verify) {
        const client = this.client;
        if (client === undefined || folder === undefined) {
          return this.result(pane, requestId, unavailable());
        }
        const listed = await Promise.all(
          refs.map(async (ref) => {
            if (ref.name.length > MAX_FILE_SEARCH_LENGTH) return false;
            const found = await client.file.find({
              query: ref.name,
              type: 'file',
              limit: FILE_SEARCH_LIMIT,
            });
            return toSearchRefs(folder, found.data.slice(0, FILE_SEARCH_LIMIT)).some(
              (entry) => entry.uri === ref.uri,
            );
          }),
        );
        const kept = refs.filter((_, index) => listed[index] === true);
        ignored = refs.length - kept.length;
        refs = kept;
      }
      for (const ref of refs) this.pickedUris.add(ref.uri);
      const send = (message: HostToWebview): void => {
        if (verify) pane.post(message);
        else pane.postOrKeep(message);
      };
      send({ type: 'attachments.picked', requestId, files: refs });
      const { folders, outside, remote, missing } = dropped.skipped;
      const skipped = folders + outside + remote + missing + ignored;
      this.log.info(
        `dropped files added: ${String(refs.length)}, skipped: ${String(skipped)} (${String(folders)} folder(s), ${String(outside)} outside, ${String(remote)} remote, ${String(missing)} missing, ${String(ignored)} ignored)`,
      );
      if (skipped > 0) {
        const items = skipped === 1 ? 'item was' : 'items were';
        // The Explorer command neither drops nor filters ignored files: its own text (decision of
        // Sergio, 23/10/2026, Engram `E7-drop-paste/decisions/cierre`).
        send({
          type: 'notice',
          level: 'warning',
          error: {
            code: 'DroppedItemsSkipped',
            message: verify
              ? `${String(skipped)} dropped ${items} not added: folders, ignored files and files outside the workspace folder cannot be attached`
              : `${String(skipped)} selected ${items} not added: folders and files outside the workspace folder cannot be attached`,
          },
        });
      }
      this.result(pane, requestId);
    } catch (error) {
      this.result(pane, requestId, error);
    }
  }

  /**
   * "Add to OpenCode Chat" of the Explorer context menu (issue #30, decision Q1 of Sergio): the
   * `uris` are what VS Code handed the command for the clicked or selected items. A user gesture
   * the host sees, so it skips the `file.find` check of a drop (see {@link dropFiles}); the answer
   * goes to the webview with a request id of its own, which the webview never began.
   */
  async addToChat(paneId: number, uris: readonly string[]): Promise<void> {
    const pane = this.paneById(paneId);
    if (pane === undefined || uris.length === 0) return;
    this.menuRequests += 1;
    await this.dropFiles(
      pane,
      `menu-${String(this.menuRequests)}`,
      uris.slice(0, MAX_DROPPED_ITEMS),
      false,
    );
  }

  /**
   * "Explain with OpenCode" / "Fix with OpenCode" of the EDITOR context menu (issue #36): reads the
   * selections (or the whole file) and the diagnostics of the document the menu was opened on
   * (`uri`, a URI string; the active editor when absent), writes the prompt
   * ({@link buildContextPrompt}) and hands it to the pane as `prompt.compose` (decision T1=1 of
   * Sergio, 29/10/2026), to be sent in the act (P5=1) or, when the buffer has unsaved changes
   * (P12=1), left in the prompt box with the `UnsavedChanges` notice, which goes through
   * {@link ChatPane.postOrKeep} because the chat may be hidden. The references join `pickedUris`
   * exactly as {@link attachFromEditor} does (same trust: the editor side limits them to the served
   * folder), so the `prompt.send` that follows is accepted.
   * An expected refusal (`NoActiveEditor`, `NoFileOnDisk`, `OutsideWorkspace`) returns `rejected`
   * with the sanitized {@link ErrorInfo}; nothing is whitelisted or composed then. Logs counts and
   * the action name only, never a path or text: `context action explain: 0 file(s), 1
   * selection(s)`, `context action explain: refused (OutsideWorkspace)`, and for a dirty buffer
   * `context action explain: the buffer has unsaved changes, the prompt goes to the box`. Needs no
   * running server (the pane keeps the message until the webview can take it).
   * VERIFIED by `chatController.test.ts` ("composeFromEditor", fake editor, 29/10/2026).
   * VERIFIED in VS Code 1.144.0 on Windows 11 (29/10/2026): the integration check "reads the
   * editor of the clicked document, not the active one" (`npm run test:integration`, a `Uri`
   * passed by hand) and the `test:visual` check "C3 Explain from the editor sends "Explain what
   * @src/sample.ts#2-3 does."" (a real right-click, one editor). NOT observed: a real right-click
   * on the non-active side of a split.
   */
  async composeFromEditor(
    paneId: number,
    action: ContextAction,
    uri?: string,
  ): Promise<ComposeOutcome> {
    const pane = this.paneById(paneId);
    if (pane === undefined) return this.refused(action, new Error('The chat is not available'));
    let context: EditorContext;
    try {
      context = await this.deps.editor.editorContext(this.server?.folder, {
        ...(uri === undefined ? {} : { uri }),
        diagnostics: action === 'fix',
      });
    } catch (error) {
      return this.refused(action, error);
    }
    for (const ref of context.refs) this.pickedUris.add(ref.uri);
    this.log.info(
      `context action ${action}: ${String(context.refs.length - context.ranged)} file(s), ${String(context.ranged)} selection(s)`,
    );
    if (context.unsaved) {
      this.log.warn(
        `context action ${action}: the buffer has unsaved changes, the prompt goes to the box`,
      );
      pane.postOrKeep({
        type: 'notice',
        level: 'warning',
        error: {
          code: 'UnsavedChanges',
          message: 'Unsaved changes: the model reads the saved version',
        },
      });
    }
    pane.compose({
      type: 'prompt.compose',
      text: buildContextPrompt({
        action,
        refs: context.refs,
        ...(context.diagnostics === undefined ? {} : { diagnostics: context.diagnostics }),
      }),
      files: context.refs,
      send: !context.unsaved,
    });
    return { status: 'composed' };
  }

  /**
   * "Explain with OpenCode" of the EXPLORER context menu (issue #36): like {@link addToChat} it
   * takes the `uris` VS Code handed the command (at most `MAX_DROPPED_ITEMS`), keeps the regular
   * files inside the served folder without the `file.find` check of a drop (a click the host
   * sees), whitelists them in `pickedUris`, and hands ONE `prompt.compose` with all of them
   * (decision P8=1 of Sergio, 29/10/2026). Folders, files outside the workspace, remote and
   * missing items are counted in ONE `DroppedItemsSkipped` warning notice with the wording of
   * "Add to OpenCode Chat" (counts only, no names), through {@link ChatPane.postOrKeep}. With
   * nothing valid left only that notice is shown and the outcome is `notified`; a refusal of the
   * editor side (no served folder: `OutsideWorkspace`) is `rejected`. Logs `context action
   * explain: 2 file(s), 0 selection(s)` and, when something was refused, `context action explain:
   * skipped 3 (1 folder(s), 1 outside, 0 remote, 1 missing)`.
   * VERIFIED by `chatController.test.ts` ("composeFromFiles", fake editor, 29/10/2026).
   * VERIFIED in VS Code 1.144.0 on Windows 11 (29/10/2026) with a real multi-selection:
   * `test:visual` "C5 two files and the folder src are selected", "C5 ONE notice counts the
   * skipped folder" and "C5 the sent message carries two chips, one per file"; the integration
   * check "Explorer Explain sends one prompt for the files and counts the folder it skipped".
   * NOT observed: macOS and Linux.
   */
  async composeFromFiles(
    paneId: number,
    action: ContextAction,
    uris: readonly string[],
  ): Promise<ComposeOutcome> {
    const pane = this.paneById(paneId);
    if (pane === undefined) return this.refused(action, new Error('The chat is not available'));
    let dropped: DroppedFiles;
    try {
      dropped = await this.deps.editor.droppedFiles(
        this.server?.folder,
        uris.slice(0, MAX_DROPPED_ITEMS),
      );
    } catch (error) {
      return this.refused(action, error);
    }
    const refs = dropped.refs;
    for (const ref of refs) this.pickedUris.add(ref.uri);
    this.log.info(`context action ${action}: ${String(refs.length)} file(s), 0 selection(s)`);
    const { folders, outside, remote, missing } = dropped.skipped;
    const skipped = folders + outside + remote + missing;
    if (skipped > 0) {
      this.log.info(
        `context action ${action}: skipped ${String(skipped)} (${String(folders)} folder(s), ${String(outside)} outside, ${String(remote)} remote, ${String(missing)} missing)`,
      );
      // Same wording as the "selected" variant of dropFiles, kept in step by hand.
      pane.postOrKeep({
        type: 'notice',
        level: 'warning',
        error: {
          code: 'DroppedItemsSkipped',
          message: `${String(skipped)} selected ${skipped === 1 ? 'item was' : 'items were'} not added: folders and files outside the workspace folder cannot be attached`,
        },
      });
    }
    if (refs.length === 0) return { status: 'notified' };
    pane.compose({
      type: 'prompt.compose',
      text: buildContextPrompt({ action, refs }),
      files: refs,
      send: true,
    });
    return { status: 'composed' };
  }

  /**
   * "Add to OpenCode Chat" of the EDITOR context menu (issue #36, decision P1=1 of Sergio): like
   * {@link attachFromEditor} it attaches the file or each non-empty selection of the document the
   * menu was opened on (`uri`, a URI string; the active editor when absent) and sends nothing. The
   * chips and the `UnsavedChanges` notice go through {@link ChatPane.postOrKeep} with a request id
   * of their own (`menu-N`), because the chat may be hidden when the entry is clicked. The
   * references join `pickedUris`; an expected refusal (`NoActiveEditor`, `NoFileOnDisk`,
   * `OutsideWorkspace`) returns `rejected` and whitelists nothing, for the caller to show as a
   * native warning (P11=1). Logs `context action add: 0 file(s), 1 selection(s)` or `context
   * action add: refused (<code>)`, counts and codes only.
   * VERIFIED by `chatController.test.ts` ("addEditorToChat", fake editor, 29/10/2026).
   * VERIFIED in VS Code 1.144.0 on Windows 11 (29/10/2026, `npm run test:integration`): the check
   * "Add to OpenCode Chat from the editor attaches the selection and sends nothing". NOT observed
   * in a real window: the chips of a hidden chat appearing after its next `ready`.
   */
  async addEditorToChat(paneId: number, uri?: string): Promise<ComposeOutcome> {
    const pane = this.paneById(paneId);
    if (pane === undefined) return this.refused('add', new Error('The chat is not available'));
    let context: EditorContext;
    try {
      context = await this.deps.editor.editorContext(this.server?.folder, {
        ...(uri === undefined ? {} : { uri }),
      });
    } catch (error) {
      return this.refused('add', error);
    }
    for (const ref of context.refs) this.pickedUris.add(ref.uri);
    this.menuRequests += 1;
    pane.postOrKeep({
      type: 'attachments.picked',
      requestId: `menu-${String(this.menuRequests)}`,
      files: context.refs,
    });
    if (context.unsaved) {
      this.log.warn(
        'context action add: the buffer has unsaved changes, the saved file is attached',
      );
      pane.postOrKeep({
        type: 'notice',
        level: 'warning',
        error: {
          code: 'UnsavedChanges',
          message: 'Unsaved changes: the model reads the saved version',
        },
      });
    }
    this.log.info(
      `context action add: ${String(context.refs.length - context.ranged)} file(s), ${String(context.ranged)} selection(s)`,
    );
    return { status: 'composed' };
  }

  /** The `rejected` outcome of a context action: sanitized error and a count-free log line. */
  private refused(action: ContextAction | 'add', error: unknown): ComposeOutcome {
    const info = toErrorInfo(error, this.secrets);
    this.log.warn(`context action ${action}: refused (${info.code})`);
    return { status: 'rejected', error: info };
  }

  /**
   * `attachments.image` (issue #30): validates one pasted image BY ITS BYTES ({@link PastedImages}),
   * keeps it in memory and answers with a chip whose `uri` is the opaque `pasted-image:<n>`. The
   * bytes never go back to the webview and are never logged; the log line has the type and the
   * size in KiB. A refusal (`UnsupportedImage`, `ImageTooLarge`) is the error of the
   * `request.result`. Needs no server. Retry, fork and revert do not re-attach the image: the
   * history has no `uri` for an inline attachment (README says so, decision Q3).
   */
  private attachImage(
    pane: ChatPane,
    requestId: string,
    mime: string,
    data: string,
  ): Promise<void> {
    try {
      const ref = this.images.add(mime, data);
      pane.post({ type: 'attachments.picked', requestId, files: [ref] });
      this.log.info(`image added: ${mime}, ${String(this.images.sizeKiB(ref.uri) ?? 0)} KiB`);
      this.result(pane, requestId);
    } catch (error) {
      this.result(pane, requestId, error);
    }
    return Promise.resolve();
  }

  /**
   * `attachments.fromEditor` (issue #29): asks the editor side for the active file, or each
   * non-empty selection with its line range, remembers the `uri`s in `pickedUris` (not proof of a
   * click, unlike the dialog; the editor side limits it to the served folder, see that field) and
   * answers with `attachments.picked` and a successful result, which is how the existing chip
   * row, its dedupe by `uri` and its restore on a failed send are reused. A buffer with unsaved
   * changes still attaches the file on disk and adds a `warning` notice, because the server reads
   * the saved version (decision Q3 of Sergio, 22/10/2026). An expected failure
   * (`NoActiveEditor`, `NoFileOnDisk`, `OutsideWorkspace`) becomes the error of the
   * `request.result`, which the store turns into a notice; nothing is whitelisted then. Needs no
   * running server but does need the served folder (`this.server?.folder`): without one the editor
   * side refuses with `OutsideWorkspace`. The log lines `editor context added: N file(s), M
   * selection(s)` carry counts, never paths or text; a dirty buffer also logs `editor context: the
   * buffer has unsaved changes, the saved file is attached`.
   * VERIFIED by unit tests with a fake editor (including "whitelists nothing when the editor
   * refuses a file outside the served folder"), and against a real VS Code 1.143.0 and a real
   * opencode 2.0.32 on Windows 11 (22/10/2026, `--label real-opencode`, 17 passing): "adds the
   * whole file when nothing is selected", "warns that the saved version is what the model reads
   * when the buffer is dirty" (log lines `editor context: the buffer has unsaved changes` and
   * `editor context added: 1 file(s), 0 selection(s)`), "refuses a file outside the open
   * workspace folder (OutsideWorkspace)", and "adds the selection of the active file and sends it
   * with its line range", where the host logged `editor context added: 0 file(s), 1
   * selection(s)`, then `prompt accepted for ses_…` and `turn finished: succeeded` for a prompt
   * carrying that `?start=1&end=2` reference. NOT observed: the warning notice reaching the
   * webview (the controller test sees it posted).
   */
  private async attachFromEditor(pane: ChatPane, requestId: string): Promise<void> {
    try {
      const context = await this.deps.editor.editorContext(this.server?.folder);
      for (const ref of context.refs) this.pickedUris.add(ref.uri);
      pane.post({ type: 'attachments.picked', requestId, files: context.refs });
      if (context.unsaved) {
        this.log.warn('editor context: the buffer has unsaved changes, the saved file is attached');
        pane.post({
          type: 'notice',
          level: 'warning',
          error: {
            code: 'UnsavedChanges',
            message: 'Unsaved changes: the model reads the saved version',
          },
        });
      }
      this.log.info(
        `editor context added: ${String(context.refs.length - context.ranged)} file(s), ${String(context.ranged)} selection(s)`,
      );
      this.result(pane, requestId);
    } catch (error) {
      this.result(pane, requestId, error);
    }
  }

  /**
   * `files.search` (issue #28): looks for files whose path matches `query` and answers with
   * `files.found`, never with a `request.result` (it must not lock the prompt, and a typed key is
   * not worth a notice: the error travels inside the answer and the popup shows it).
   *
   * Each call aborts the one before (`RequestOptions.signal`). A search replaced by a newer one
   * ends silently, so the webview only ever sees the answer to its newest query. A search cut off
   * because the server stopped or changed (`stopStream`) answers its own `requestId` with a
   * `ServerUnavailable` error instead, so the popup leaves "Searching…" and shows it. A `find()`
   * that simply hangs has no timeout and is not covered: it ends when the user types, presses
   * Escape, blurs, or the server stops. Results are mapped by `toSearchRefs` against the
   * served folder (directories, traversals and mixed separators are handled there) and every
   * `uri` is added to {@link offeredUris}, the second half of the whitelist `prompt.send`
   * checks. Without a client the answer is a `ServerUnavailable` error. The log line `file search:
   * N results` has the count only: the query is the user's words. A failure logs `file search
   * failed: <code>`.
   * VERIFIED by unit tests with a fake client and by the e2e against the synthetic server. Against
   * a real opencode 2.0.32 on Windows 11, VS Code 1.143.0 (22/10/2026): the call, the shape and the
   * empty-query answer come from the planner spike; the opt-in `real-opencode` case "finds a file
   * with files.search and sends a prompt that mentions it" logged `file search: 1 results` for
   * `sample` and the host accepted, and the real server admitted, a prompt with that file and a
   * `mention` (`prompt accepted for ses_…`, then `turn finished: succeeded`); and `test:visual` step
   * 16 listed `src/sample.ts` and `src/sample-extra.ts` for `@sample` in the real popup. NOT
   * observed: a failed search against a real server (only the fake client throws), the
   * eviction of `offeredUris` (unit-tested), POSIX.
   */
  private async searchFiles(
    pane: ChatPane,
    message: Extract<WebviewToHost, { type: 'files.search' }>,
  ): Promise<void> {
    const { requestId, query } = message;
    pane.fileSearch?.abort();
    const client = this.client;
    const server = this.server;
    if (client === undefined || server === undefined) {
      pane.post({
        type: 'files.found',
        requestId,
        query,
        files: [],
        error: toErrorInfo(unavailable(), this.secrets),
      });
      return;
    }
    const controller = new AbortController();
    pane.fileSearch = controller;
    // True when the search ended without an answer to publish. A newer search owns `fileSearch`
    // (it is set to a different controller): stay silent, the webview waits for that one. Otherwise
    // the server went away (`stopStream` cleared it and swapped the client): answer with an error,
    // or the popup would keep saying "Searching…" for a request nobody will resolve.
    const abandoned = (): boolean => {
      if (!controller.signal.aborted && client === this.client) return false;
      if (pane.fileSearch === undefined || pane.fileSearch === controller) {
        pane.post({
          type: 'files.found',
          requestId,
          query,
          files: [],
          error: toErrorInfo(unavailable(), this.secrets),
        });
      }
      return true;
    };
    try {
      const found = await client.file.find(
        { query, type: 'file', limit: FILE_SEARCH_LIMIT },
        { signal: controller.signal },
      );
      if (abandoned()) return;
      const files = toSearchRefs(server.folder, found.data.slice(0, FILE_SEARCH_LIMIT));
      for (const file of files) {
        // Delete first so a result seen again counts as the newest, not as one about to be evicted.
        this.offeredUris.delete(file.uri);
        this.offeredUris.add(file.uri);
      }
      while (this.offeredUris.size > OFFERED_URIS_MAX) {
        const oldest = this.offeredUris.values().next();
        if (oldest.done) break;
        this.offeredUris.delete(oldest.value);
      }
      this.log.info(`file search: ${String(files.length)} results`);
      pane.post({ type: 'files.found', requestId, query, files });
    } catch (error) {
      if (abandoned()) return;
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`file search failed: ${info.code}`);
      pane.post({ type: 'files.found', requestId, query, files: [], error: info });
    } finally {
      if (pane.fileSearch === controller) pane.fileSearch = undefined;
    }
  }

  /**
   * Sends the permission decision. Throws what the client throws (the server's error body) or the
   * `ServerUnavailable` body; callers turn it into a `request.result` or a return value.
   *
   * The `message` travels only with `reject` and only when it has text: the server uses it as the
   * correction the model sees (`CorrectedError`, the turn goes on), and an empty one would turn a
   * plain rejection into a "correction" with no content. `once` and `always` take no message.
   * A rejection with feedback is flagged in the memory of answered requests before the call (and
   * unflagged if the call fails), so the record says `withFeedback`; the text itself is not kept.
   * `requestID` is the permission id (`POST /api/session/:sid/permission/:rid/reply`, 204).
   * VERIFIED against a real opencode 2.0.32 (Windows 11, VS Code 1.142.0, 2026-10-20, opt-in
   * `realOpencode.test.ts`, two runs): `once` and a bare `reject` were accepted for a `read` of
   * `.env`; after `once` the turn ended `succeeded`, and after a bare `reject` it ended
   * `interrupted` (the model does NOT go on without a message). A `reject` with a message was
   * not sent to a real server. `always` is never sent by any automated test (it writes a rule
   * into the user's opencode database).
   */
  private async sendPermissionReply(
    sessionID: string,
    permissionID: string,
    decision: Extract<WebviewToHost, { type: 'permission.reply' }>['decision'],
    message?: string,
  ): Promise<void> {
    const client = this.client;
    // Thrown as a plain `{_tag, message}` body on purpose: it is what the real client throws for a
    // server error, and `toErrorInfo` reads both shapes the same way.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (client === undefined) throw unavailable();
    const problem = this.checkPending('permission', permissionID, sessionID, decision === 'always');
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (problem !== undefined) throw problem;
    const feedback =
      decision === 'reject' && message !== undefined && message.trim() !== '' ? message : undefined;
    // Marked BEFORE the call: the `permission.resolved` event can reach us before the HTTP answer.
    if (feedback !== undefined) this.resolutions.markReplied('permission', permissionID);
    try {
      await client.permission.reply({
        sessionID,
        requestID: permissionID,
        decision,
        ...(feedback === undefined ? {} : { message: feedback }),
      });
    } catch (error) {
      if (feedback !== undefined) this.resolutions.unmark('permission', permissionID);
      throw error;
    }
    this.log.info(`permission reply sent for ${permissionID} (${decision})`);
  }

  /** `permission.reply`: answers the request; never throws, the outcome is a `request.result`. */
  private async answerPermission(
    pane: ChatPane,
    message: Extract<WebviewToHost, { type: 'permission.reply' }>,
  ): Promise<void> {
    try {
      await this.sendPermissionReply(
        message.sessionID,
        message.permissionID,
        message.decision,
        message.message,
      );
      this.result(pane, message.requestId);
    } catch (error) {
      this.result(pane, message.requestId, error);
      await this.healIfStale(error);
    }
  }

  /**
   * Answers a pending permission without a `requestId` (the "Allow once" / "Reject" links of an
   * attention notification, issue #19). Resolves with the scrubbed error, or `undefined` on
   * success; never rejects. A request that is gone resyncs, as for the webview's own replies.
   */
  async replyPermission(
    sessionID: string,
    permissionID: string,
    decision: 'once' | 'reject',
  ): Promise<ErrorInfo | undefined> {
    try {
      await this.sendPermissionReply(sessionID, permissionID, decision);
      return undefined;
    } catch (error) {
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`permission reply for ${permissionID} failed: ${info.code}: ${info.message}`);
      await this.healIfStale(error);
      return info;
    }
  }

  /**
   * `form.reply`: sends the answer of a question/form (`POST .../form/:fid/reply`, 204). A
   * `FormInvalidAnswerError` comes back as the error of the `request.result` and the form stays
   * open for the user to fix; a form that is already gone resyncs. The answer text is never logged.
   * VERIFIED against a real opencode 2.0.32 (Windows 11, VS Code 1.142.0, 2026-10-20, opt-in
   * `realOpencode.test.ts`): the `question` tool raised a form, the session waited (no turn end
   * in the 3 s after it), `{ q0: "A" }` (a plain string) was accepted and the turn then ended
   * `succeeded`. A `FormInvalidAnswerError` and `form.cancel` were never provoked on a real server.
   */
  private async answerForm(
    pane: ChatPane,
    message: Extract<WebviewToHost, { type: 'form.reply' }>,
  ): Promise<void> {
    const client = this.client;
    if (client === undefined) return this.result(pane, message.requestId, unavailable());
    const problem = this.checkPending('form', message.formID, message.sessionID);
    if (problem !== undefined) {
      this.result(pane, message.requestId, problem);
      return this.healIfStale(problem);
    }
    try {
      await client.session.form.reply({
        sessionID: message.sessionID,
        formID: message.formID,
        answer: message.answer,
      });
      this.log.info(`form reply sent for ${message.formID}`);
      this.result(pane, message.requestId);
    } catch (error) {
      this.result(pane, message.requestId, error);
      await this.healIfStale(error);
    }
  }

  /**
   * `form.cancel`: dismisses a form (`DELETE .../form/:fid?message=`, 204). Without a message the
   * model STOPS (`CancelledError`); with one it goes on and reads it as feedback (read in
   * `question.ts@v2.0.32`; the real-server run of the opt-in suite does not cancel a question).
   * A blank message is dropped so "Dismiss" can never turn into an empty correction. A non-blank
   * one is flagged in the memory of answered requests (`withMessage`), like a rejection's feedback.
   */
  private async cancelForm(
    pane: ChatPane,
    message: Extract<WebviewToHost, { type: 'form.cancel' }>,
  ): Promise<void> {
    const client = this.client;
    if (client === undefined) return this.result(pane, message.requestId, unavailable());
    const problem = this.checkPending('form', message.formID, message.sessionID);
    if (problem !== undefined) {
      this.result(pane, message.requestId, problem);
      return this.healIfStale(problem);
    }
    const note =
      message.message !== undefined && message.message.trim() !== '' ? message.message : undefined;
    // Marked BEFORE the call, as in `sendPermissionReply`.
    if (note !== undefined) this.resolutions.markReplied('form', message.formID);
    try {
      await client.session.form.cancel({
        sessionID: message.sessionID,
        formID: message.formID,
        ...(note === undefined ? {} : { message: note }),
      });
      this.log.info(`form cancel sent for ${message.formID}`);
      this.result(pane, message.requestId);
    } catch (error) {
      if (note !== undefined) this.resolutions.unmark('form', message.formID);
      this.result(pane, message.requestId, error);
      await this.healIfStale(error);
    }
  }

  /**
   * Checks an answer from the webview (or from a notification link) against the host's own
   * registry of pending requests: the request must be pending, belong to the `sessionID` given,
   * and for an `always` have `save[]` rules (opencode treats an `always` without them as `once`,
   * so allowing it would let the UI say one thing and the server do another). Returns the error
   * body to answer with, or `undefined` when it is fine. The webview is untrusted input (same
   * reasoning as `pickedUris`); today the server would also refuse an unknown id with a 404, so
   * this is defence in depth, not a fix for a reachable bug. `RequestNotPending` is treated as
   * stale and resyncs, because the usual cause is a registry that is behind or ahead of the
   * webview.
   */
  private checkPending(
    kind: PendingSummary['kind'],
    id: string,
    sessionID: string,
    always = false,
  ): { _tag: string; message: string } | undefined {
    const known = this.pending.find(kind, id);
    if (known?.sessionID !== sessionID) {
      return {
        _tag: 'RequestNotPending',
        message: 'That request is no longer waiting for an answer',
      };
    }
    if (always && known.canAlways !== true) {
      return {
        _tag: 'AlwaysNotAvailable',
        message: 'This request has no rules to save, so “always” is not available',
      };
    }
    return undefined;
  }

  /** Resyncs when `error` says the request is no longer pending (see {@link isStaleRequest}). */
  private async healIfStale(error: unknown): Promise<void> {
    if (isStaleRequest(error)) await this.resync();
  }

  /**
   * `permissions.manage`: lists the rules "Always" stored for the project, lets the user pick
   * which to revoke (`deps.savedPermissions`, which also asks for confirmation) and removes them
   * one by one. Reports the result as an info `notice`; a failure is a `warning` notice and a
   * `warn` log line. Stops at the first failed removal, so the count in the message is what really
   * went away. The rules' resources are never logged.
   */
  private async manageSavedPermissions(pane: ChatPane): Promise<void> {
    const client = this.client;
    if (client === undefined) {
      pane.post({
        type: 'notice',
        level: 'warning',
        error: { code: 'ServerUnavailable', message: unavailable().message },
      });
      return;
    }
    let removed = 0;
    try {
      const saved = await client.permission.saved.list();
      if (saved.length === 0) {
        pane.post({
          type: 'notice',
          level: 'info',
          error: { code: 'NoSavedPermissions', message: 'This project has no saved permissions' },
        });
        return;
      }
      const ids = await this.deps.savedPermissions.pickToRevoke(
        saved.map((rule) => ({
          id: rule.id,
          action: rule.action,
          resource: rule.resource,
          createdAt: rule.time.created,
        })),
      );
      for (const id of ids) {
        await client.permission.saved.remove({ id });
        removed += 1;
      }
      if (removed > 0) {
        this.log.info(`revoked ${String(removed)} saved permission(s)`);
        pane.post({
          type: 'notice',
          level: 'info',
          error: {
            code: 'SavedPermissionsRevoked',
            message: `Revoked ${String(removed)} saved permission(s)`,
          },
        });
      }
    } catch (error) {
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(
        `managing saved permissions failed after ${String(removed)} removal(s): ${info.code}: ${info.message}`,
      );
      pane.post({ type: 'notice', level: 'warning', error: info });
    }
  }

  /**
   * Handles one VALIDATED webview message (the caller ran `isWebviewToHost`) from the pane
   * `paneId`. A message from a pane that is not attached (closed, or never attached) is dropped
   * with a `warn` log `dropped a <type> from unknown pane <n>` and resolves without answering.
   *
   * `prompt.send` creates a session when none is open (with the model and agent the webview chose,
   * issues #23/#24), then calls `session.prompt` with the
   * delivery the webview chose and the attachments the host emitted. `session.new` (lazy)
   * and `session.open` change the open session. `session.abort` interrupts the turn (issue #16).
   * Issue #20: `sessions.query`, `session.rename` and `session.delete` serve the session list.
   * Issue #21: `session.fork` forks the open session before a message and opens the fork.
   * `editor.*`, `clipboard.write` and `attachments.pick` go to `deps.editor` and never need the
   * server; a failure becomes a `warning` notice (those messages carry no `requestId`).
   * Issues #28/#29: `files.search` asks the server for files (answer `files.found`) and
   * `attachments.fromEditor` takes the active file or selections from the editor.
   * Issue #31: `session.diff.open` opens the native diff of a listed changed file.
   * Issue #32: `session.revert.stage|clear|commit` prepare, restore and discard for good a revert
   * from a user message, and `session.revert.open` opens the diff of a file the revert undid.
   * Phase 3: `permission.reply`, `form.reply` and `form.cancel` call the server (a reply that fails
   * because the request is gone also resyncs, since the snapshot tells the truth);
   * `permissions.manage` runs the saved-permissions manager; `server.restart` and `logs.show` go
   * to `deps.server`. E2 (issue #85): `setup.action` goes to `deps.setup` and `attachments.pick`
   * passes its `kind` (default `file`) to the picker.
   */
  handle(paneId: number, message: WebviewToHost): Promise<void> {
    const pane = this.paneById(paneId);
    if (pane === undefined) {
      this.log.warn(`dropped a ${message.type} from unknown pane ${String(paneId)}`);
      return Promise.resolve();
    }
    return this.run(pane, message);
  }

  /** Dispatch body of {@link handle}; kept apart so `dispatch` can return a Promise. */
  private async run(pane: ChatPane, message: WebviewToHost): Promise<void> {
    const pending: Promise<void>[] = [];
    dispatch<WebviewToHost>(message, {
      ready: () => {
        pending.push(this.onPaneReady(pane.id));
      },
      'session.new': (m) => {
        pending.push(this.newSession(pane, m.requestId));
      },
      'session.open': (m) => {
        pending.push(this.openRequested(pane, m.requestId, m.sessionID));
      },
      'sessions.query': (m) => {
        pending.push(this.querySessions(pane, m));
      },
      'session.rename': (m) => {
        pending.push(this.renameSession(pane, m));
      },
      'session.delete': (m) => {
        pending.push(this.deleteSession(pane, m));
      },
      'session.fork': (m) => {
        pending.push(this.forkSession(pane, m));
      },
      'prompt.send': (m) => {
        pending.push(this.sendPrompt(pane, m));
      },
      'session.abort': (m) => {
        pending.push(this.abort(pane, m.requestId, m.sessionID));
      },
      'permission.reply': (m) => {
        pending.push(this.answerPermission(pane, m));
      },
      'form.reply': (m) => {
        pending.push(this.answerForm(pane, m));
      },
      'form.cancel': (m) => {
        pending.push(this.cancelForm(pane, m));
      },
      'attachments.pick': (m) => {
        pending.push(this.pickAttachments(pane, m.requestId, m.kind ?? 'file'));
      },
      'attachments.fromEditor': (m) => {
        pending.push(this.attachFromEditor(pane, m.requestId));
      },
      'attachments.drop': (m) => {
        pending.push(this.dropFiles(pane, m.requestId, m.uris, true));
      },
      'attachments.image': (m) => {
        pending.push(this.attachImage(pane, m.requestId, m.mime, m.data));
      },
      // Sergio's decision of 23/10/2026 (S5): removing a chip frees the image. Only `PastedImages`
      // can forget, and it knows only the uris it issued; any other uri is a no-op.
      'attachments.forget': (m) => {
        this.images.forget(m.uri);
      },
      'files.search': (m) => {
        pending.push(this.searchFiles(pane, m));
      },
      'permissions.manage': () => {
        pending.push(this.manageSavedPermissions(pane));
      },
      'server.restart': () => {
        this.deps.server.restart();
      },
      'logs.show': () => {
        this.deps.server.showLogs();
      },
      'setup.action': (m) => {
        pending.push(this.setupAction(pane, m.action));
      },
      'editor.open': (m) => {
        pending.push(
          this.editorAction(pane, m.type, () =>
            this.deps.editor.open(m.path, m.line, m.column, this.server?.folder),
          ),
        );
      },
      'session.diff.open': (m) => {
        pending.push(this.openChangedFile(pane, m.sessionID, m.path));
      },
      'session.revert.stage': (m) => {
        pending.push(this.stageRevert(pane, m));
      },
      'session.revert.clear': (m) => {
        pending.push(this.clearRevert(pane, m));
      },
      'session.revert.commit': (m) => {
        pending.push(this.commitRevert(pane, m));
      },
      'session.revert.open': (m) => {
        pending.push(this.openRevertedFile(pane, m.sessionID, m.path));
      },
      'editor.insert': (m) => {
        pending.push(this.editorAction(pane, m.type, () => this.deps.editor.insert(m.text)));
      },
      'editor.newFile': (m) => {
        pending.push(
          this.editorAction(pane, m.type, () => this.deps.editor.newFile(m.text, m.language)),
        );
      },
      'clipboard.write': (m) => {
        pending.push(this.editorAction(pane, m.type, () => this.deps.editor.copy(m.text)));
      },
      'chat.focusChanged': (m) => {
        if (m.focused) this.focusedPanes.add(pane.id);
        else this.focusedPanes.delete(pane.id);
        this.deps.ui.setChatFocused(this.focusedPanes.size > 0, pane.id);
      },
      'webview.log': (m) => {
        this.log[m.level === 'warn' ? 'warn' : m.level === 'error' ? 'error' : 'info'](
          `[webview] ${m.message}`,
        );
      },
    });
    await Promise.all(pending);
  }

  /**
   * `session.new`, LAZY (issue #20, decision of Sergio 21/10/2026): creates nothing. It forgets the
   * open session (field, translator and per-folder memory) and resyncs, so the webview receives a
   * snapshot with no open session and shows the empty view; the first `prompt.send` without a
   * `sessionID` then creates the session through the path `sendPrompt` already has. Before this it
   * did `POST /api/session` on every click, leaving an empty "Untitled session" in the list (and
   * in the database the TUI shares). The session has no id until that first prompt. Still needs a
   * running server: the snapshot is how the webview learns it, and the button is disabled without
   * one.
   *
   * Where the new session lives is not always this pane: `deps.ui.openElsewhere(pane.id,
   * undefined)` gets the first say, and when it returns `true` (a lazy surface was opened for it)
   * this pane is left exactly as it was and the request just answers OK. Without that dependency,
   * or when it returns `false`, the behavior is the one above.
   * VERIFIED by `chatController.panes.test.ts` "leaves the asking pane alone when the VS Code
   * side opens the new session elsewhere" and "behaves as before when there is no openElsewhere"
   * (fake surfaces, 29/10/2026, Windows 11). Not observed with a real second surface.
   */
  private async newSession(pane: ChatPane, requestId: string): Promise<void> {
    if (this.client === undefined) return this.result(pane, requestId, unavailable());
    try {
      if (this.deps.ui.openElsewhere?.(pane.id, undefined) === true) {
        this.result(pane, requestId);
        return;
      }
      await this.forgetOpen(pane);
      await this.resync([pane]);
      this.result(pane, requestId);
    } catch (error) {
      this.result(pane, requestId, error);
    }
  }

  /**
   * `session.open`: checks the session exists, then opens it. A `SessionNotFoundError` means the
   * row the user clicked is stale (deleted by another client, or an event was lost), so it is also
   * reported as `session.removed` to heal the list.
   *
   * A session is never shown by two panes through this request: when ANOTHER pane already shows
   * it, that pane is revealed (`deps.ui.revealPane`) and this one keeps its own session. Otherwise
   * `deps.ui.openElsewhere(pane.id, sessionID)` may serve it in a new surface (decision Q8=1 of
   * Sergio, 29/10/2026: opening another session from a tab opens or reveals that session's tab);
   * `true` leaves this pane untouched. Without those optional dependencies, with a single pane,
   * or when this pane is EMPTY (no session bound) and no other pane shows the session, the
   * session simply opens in this pane: an empty tab adopts it (decision "empty tab adopts" of
   * Sergio, 29/10/2026). A pane asking for the session it already shows is not a duplicate: it
   * falls through and resyncs.
   * VERIFIED by `chatController.panes.test.ts` "reveals the other pane that shows the session
   * instead of opening it twice", "an empty pane adopts the session instead of asking
   * openElsewhere" and the checks around them (fake surfaces, 29/10/2026, Windows 11).
   * Not observed with a real second surface.
   */
  private async openRequested(pane: ChatPane, requestId: string, sessionID: string): Promise<void> {
    const client = this.client;
    if (client === undefined) return this.result(pane, requestId, unavailable());
    try {
      await client.session.get({ sessionID });
      const other = this.panesOf(sessionID).find((candidate) => candidate.id !== pane.id);
      if (other !== undefined && pane.sessionID !== sessionID) {
        this.deps.ui.revealPane?.(other.id);
        this.result(pane, requestId);
        return;
      }
      // An EMPTY pane (no session bound) adopts the session instead of leaving itself behind
      // next to a new surface (decision of Sergio, 29/10/2026); a pane with a session stays bound.
      if (
        pane.sessionID !== undefined &&
        this.deps.ui.openElsewhere?.(pane.id, sessionID) === true
      ) {
        this.result(pane, requestId);
        return;
      }
      await this.openSession(pane, sessionID);
      this.result(pane, requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(pane, requestId, error);
    }
  }

  /** Tells the webview (and the bookkeeping) that `sessionID` is gone when `error` says it is. */
  private healMissing(error: unknown, sessionID: string): void {
    if (isSessionNotFound(error)) this.publish([{ type: 'session.removed', sessionID }]);
  }

  /**
   * `sessions.query`: one page of the root sessions of the served folder, newest activity first,
   * optionally filtered by title ON THE SERVER (so it finds sessions older than any loaded page).
   * The cursor lives in {@link createSessionBrowser}; the page is mirrored in the translator so a
   * later `session.renamed` of one of its rows reaches the webview. The answer is `sessions.page`
   * followed by the `request.result` (the webview does NOT mark these as a pending send). An
   * `InvalidCursorError` resets the browser, so the next "more" starts again. If the server
   * changed while the page was in flight the page is dropped and the request answers
   * `ServerUnavailable`, so the webview never stays waiting. Logs the row count,
   * never the search text. VERIFIED against the synthetic server (`chatController.e2e.test.ts`,
   * real client); the real server's `search`, `parentID: null` and cursor were checked by the
   * planner spike only (Windows 11, opencode 2.0.32, 21/10/2026).
   */
  private async querySessions(
    pane: ChatPane,
    message: Extract<WebviewToHost, { type: 'sessions.query' }>,
  ): Promise<void> {
    const { requestId } = message;
    const client = this.client;
    const server = this.server;
    if (client === undefined || server === undefined) {
      return this.result(pane, requestId, unavailable());
    }
    try {
      const query = pane.browser.query(message.search, message.more, server.folder);
      const answer = await client.session.list(query.input);
      // The server changed while we waited: the page belongs to another server, but the webview
      // must still hear back or its list stays "loading" (review S3).
      if (client !== this.client) return this.result(pane, requestId, unavailable());
      const page = query.accept(answer);
      this.translator.mirror(page.rows);
      pane.post({
        type: 'sessions.page',
        requestId,
        search: message.search,
        sessions: page.rows,
        append: page.append,
        hasMore: page.hasMore,
      });
      this.log.info(`sessions page (${String(page.rows.length)}, more: ${String(message.more)})`);
      this.result(pane, requestId);
    } catch (error) {
      if (tagOf(error) === 'InvalidCursorError') pane.browser.reset();
      this.result(pane, requestId, error);
    }
  }

  /**
   * `session.rename`: trims the title and re-checks it (the webview already did, but it is
   * untrusted, and a BLANK title would make the server run the LLM title generator instead of
   * clearing it: VERIFIED by the planner spike). The visible result is the `session.renamed` event
   * the server publishes (translated to `session.upserted`, also when another client renames);
   * this only answers with a `request.result`. A session that no longer exists is reported as
   * `session.removed`. Logs the id, never the title. The work is {@link renameSessionById}, which
   * the native Sessions tree calls too (issue #77, E3); this handler only turns its outcome into
   * the `request.result`, as it always did.
   */
  private async renameSession(
    pane: ChatPane,
    message: Extract<WebviewToHost, { type: 'session.rename' }>,
  ): Promise<void> {
    const { requestId, sessionID } = message;
    try {
      await this.renameSessionById(sessionID, message.title);
      this.result(pane, requestId);
    } catch (error) {
      this.result(pane, requestId, error);
    }
  }

  /**
   * Renames `sessionID` with no pane involved (issue #77, E3: the tree's Rename and the webview's
   * `session.rename` share it). Trims the title and re-checks it, because the caller is not
   * trusted and a BLANK title would make the server run the LLM title generator instead of
   * clearing it (planner spike). Rejects with `ServerUnavailable` when no server runs, with
   * `InvalidTitle` (an Error whose `name` is the code, as `toErrorInfo` reads it) for a title that is blank or
   * longer than {@link MAX_SESSION_TITLE_LENGTH}, and with whatever the server answers; a
   * `SessionNotFoundError` is also published as `session.removed` first (self-healing of a stale
   * row). The visible result is the `session.renamed` event of the server. Logs the id only.
   * VERIFIED by `chatController.test.ts` "renames a session without a pane, trimming the title",
   * "refuses a blank or overlong title and a missing server without calling the server" and
   * "heals a session that no longer exists as removed and rejects with the server error", and, for
   * the webview path, by the unchanged `session.rename` cases of the same file (fake client,
   * Windows 11, 29/10/2026).
   */
  async renameSessionById(sessionID: string, rawTitle: string): Promise<void> {
    const client = this.client;
    if (client === undefined) throw unavailableError();
    const title = rawTitle.trim();
    if (title === '' || title.length > MAX_SESSION_TITLE_LENGTH) {
      throw codedError(
        'InvalidTitle',
        `A session title needs 1 to ${String(MAX_SESSION_TITLE_LENGTH)} characters`,
      );
    }
    try {
      await client.session.update({ sessionID, title });
      this.log.info(`session renamed ${sessionID}`);
    } catch (error) {
      this.healMissing(error, sessionID);
      throw error;
    }
  }

  /**
   * `session.delete`: asks the user through `deps.sessions.confirmDelete` (a native modal) and only
   * on "Delete" calls `DELETE /api/session/:id`. The host asks, not the webview: see
   * `sessionUi.ts`. The title shown comes from `session.get` and "running" from
   * `session.active()` at this moment, never from the webview's message, so the dialog cannot be
   * made to say something else. The id is put in `deleting` BEFORE the call, because the
   * `session.removed` events arrive before the HTTP answer (VERIFIED by the planner spike, all
   * within the same millisecond) and must not be announced as a delete by someone else. A
   * declined dialog is a success without error. The server deletes the child sessions too and
   * interrupts a busy one first; the events do the rest (`onSessionRemoved`, pending requests,
   * resolutions). If the stream is down no event comes, so after a successful call the controller
   * reports the removal itself (idempotent: the real event, if it arrives, finds nothing left to
   * do). Logs ids only. The work is {@link deleteSessionById}, which the native Sessions tree
   * calls too (issue #77, E3); a declined dialog and a delete both answer without error here.
   */
  private async deleteSession(
    pane: ChatPane,
    message: Extract<WebviewToHost, { type: 'session.delete' }>,
  ): Promise<void> {
    try {
      await this.deleteSessionById(message.sessionID);
      this.result(pane, message.requestId);
    } catch (error) {
      this.result(pane, message.requestId, error);
    }
  }

  /**
   * Deletes `sessionID` after the native confirmation, with no pane involved (issue #77, E3).
   * Resolves `{ deleted: true }` once the server accepted the DELETE and `{ deleted: false }` when
   * the user declined the modal (no DELETE is sent). Rejects with `ServerUnavailable` when no
   * server runs, and with whatever the server answers; a `SessionNotFoundError` is also published
   * as `session.removed` first (self-healing of a stale row). The rest is as documented on
   * {@link deleteSession}: the dialog's title and running flag are read from the server, the id
   * enters `deleting` before the call so the `session.removed` that follows is not announced as
   * "deleted elsewhere", and after a successful call the controller publishes the removal itself
   * in case the stream is down. A caller that wants to close the tab of the session must read
   * {@link sessionOf} BEFORE calling, because the removal makes every pane forget it.
   * VERIFIED by `chatController.test.ts` "deletes a session without a pane and closes it for the
   * pane that showed it, without the "outside this view" notice", "resolves deleted false when
   * the user declines, and sends no DELETE" and "heals a session that is already gone as removed
   * and rejects, asking nobody", and, for the webview path, by the unchanged `session.delete`
   * cases of the same file (fake client, Windows 11, 29/10/2026).
   */
  async deleteSessionById(sessionID: string): Promise<{ deleted: boolean }> {
    const client = this.client;
    if (client === undefined) throw unavailableError();
    try {
      const [info, active] = await Promise.all([
        client.session.get({ sessionID }),
        client.session.active(),
      ]);
      const confirmed = await this.deps.sessions.confirmDelete({
        title: info.title ?? '',
        running: Object.hasOwn(active, sessionID),
      });
      if (!confirmed) {
        this.log.info(`session delete cancelled ${sessionID}`);
        return { deleted: false };
      }
      this.deleting.add(sessionID);
      try {
        await client.session.remove({ sessionID });
      } catch (error) {
        this.deleting.delete(sessionID);
        throw error;
      }
      this.log.info(`session deleted ${sessionID}`);
      this.publish([{ type: 'session.removed', sessionID }]);
      return { deleted: true };
    } catch (error) {
      this.healMissing(error, sessionID);
      throw error;
    }
  }

  /**
   * "Show more sessions" of the native tree (issue #77, E3): reads the next page of root sessions
   * with the tree's own cursor and appends it through the sink. Does nothing without a sink or a
   * server. The page is mirrored in the translator (a later `session.renamed` of one of its rows
   * must reach the sink, R2 of the plan). The page is dropped when the server changed, or when a
   * full resync replaced the first page while this one was in flight (`treeEpoch`): its rows are
   * older than a list that no longer is the one it was cut from, and could bring back a deleted
   * session. Rejects with the server's error for the caller to show as a native warning; an
   * `InvalidCursorError` also resets the cursor, so the next call starts again from the first page
   * (harmless: the sink replaces rows by id).
   * VERIFIED by `chatController.test.ts` "loads the next page of the tree with the cursor and
   * mirrors it" and, against a real client and cursor, `chatController.e2e.test.ts` "pages the
   * tree through the cursor of the synthetic server" (Windows 11, 29/10/2026). UNVERIFIED against
   * a real opencode: only the planner spike of #20 saw its cursors.
   */
  async loadMoreSessions(): Promise<void> {
    const sink = this.deps.sessionList;
    const client = this.client;
    const server = this.server;
    if (sink === undefined || client === undefined || server === undefined) return;
    const epoch = this.treeEpoch;
    const query = this.treeBrowser.query('', true, server.folder);
    try {
      const answer = await client.session.list(query.input);
      if (client !== this.client || epoch !== this.treeEpoch) return;
      const page = query.accept(answer);
      this.translator.mirror(page.rows);
      if (page.rows.length > 0) this.treeMirrored = true;
      sink.append(page.rows, page.hasMore);
      this.log.debug(
        `sessions tree page (${String(page.rows.length)}, more: ${String(page.hasMore)})`,
      );
    } catch (error) {
      if (tagOf(error) === 'InvalidCursorError') this.treeBrowser.reset();
      throw error;
    }
  }

  /**
   * "Search Sessions…" of the native tree (issue #77, E3): the root sessions of the served folder
   * whose title contains `text`, searched ON THE SERVER (so it finds sessions older than any
   * loaded page), newest activity first, first page only. It uses its own browser, never the
   * tree's cursor. Two searches may overlap while the user types: only the newest one answers,
   * and an older answer that arrives later resolves `undefined` instead of overwriting it. The
   * rows are mirrored in the translator so a rename of one of them still reaches the sink. Rejects
   * with `ServerUnavailable` when no server runs and with the server's error otherwise. Logs the
   * row count, never the text.
   * VERIFIED by `chatController.test.ts` "keeps a late answer of an older search from replacing
   * the newer one" (fake client with answers released out of order, Windows 11, 29/10/2026).
   */
  async searchSessions(text: string): Promise<SessionSearchResult | undefined> {
    const client = this.client;
    const server = this.server;
    if (client === undefined || server === undefined) throw unavailableError();
    const ticket = ++this.searchTicket;
    const query = this.searchBrowser.query(text, false, server.folder);
    const answer = await client.session.list(query.input);
    if (ticket !== this.searchTicket || client !== this.client) return undefined;
    const page = query.accept(answer);
    this.translator.mirror(page.rows);
    this.log.debug(`sessions search (${String(page.rows.length)} found)`);
    return { rows: page.rows, hasMore: page.hasMore };
  }

  /**
   * `session.fork` (issue #21): forks `sessionID` before `messageID` and opens the new session.
   *
   * The fork is a ROOT session, so the row goes to the translator's mirror and out as
   * `session.upserted` BEFORE the snapshot of the new session (the list then shows it, and a later
   * rename reaches the webview); `openSession` then publishes its history and remembers it for the
   * folder. The webview gets no message of its own: the answer is the `request.result`. A busy
   * source session is allowed (the server copies only what is settled, VERIFIED by the planner
   * spike, opencode 2.0.32, Windows 11, 21/10/2026). The host does not check that `messageID` is a
   * user message: a fork is not destructive, and an unknown id is the server's `MessageNotFoundError`
   * (returned as the error of the result; the open session does not change). A vanished source is
   * also reported as `session.removed`. If the server changed while the call was in flight the
   * result is `ServerUnavailable`. Logs ids only (the stable line `session forked <a> -> <b>`).
   */
  private async forkSession(
    pane: ChatPane,
    message: Extract<WebviewToHost, { type: 'session.fork' }>,
  ): Promise<void> {
    const { requestId, sessionID, messageID } = message;
    const client = this.client;
    if (client === undefined) return this.result(pane, requestId, unavailable());
    try {
      const info = await client.session.fork({ sessionID, before: messageID });
      if (client !== this.client) return this.result(pane, requestId, unavailable());
      const row = toSessionSummary(info);
      this.translator.mirror([row]);
      this.publish([{ type: 'session.upserted', session: row }]);
      this.log.info(`session forked ${sessionID} -> ${info.id}`);
      await this.openSession(pane, info.id);
      this.result(pane, requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(pane, requestId, error);
    }
  }

  /**
   * Reads one session and publishes its row as `session.upserted`. Used for the `session.forked`
   * event of a fork made by another client (the TUI): the event has no title and there is no
   * `session.created`, so the row has to be read. A 404 is ignored (deleted meanwhile); any other
   * failure is a `warn` line and nothing else, because the next snapshot brings the row anyway.
   * Drops the result if the server changed while waiting, or if the stream reported the session
   * deleted meanwhile (tracked in `refreshing`; two concurrent refreshes of the same id share the
   * entry, so at worst the later one is dropped and the next snapshot brings the row).
   */
  private async refreshSession(sessionID: string): Promise<void> {
    const client = this.client;
    if (client === undefined) return;
    this.refreshing.add(sessionID);
    try {
      const row = toSessionSummary(await client.session.get({ sessionID }));
      // A `session.removed` that arrived while the get was in flight wins (it left `refreshing`),
      // or the row of a deleted session would be republished.
      if (client !== this.client || this.disposed || !this.refreshing.has(sessionID)) return;
      this.translator.mirror([row]);
      this.publish([{ type: 'session.upserted', session: row }]);
    } catch (error) {
      if (isSessionNotFound(error)) return;
      this.log.warn(
        `could not read forked session ${sessionID}: ${toErrorInfo(error, this.secrets).message}`,
      );
    } finally {
      this.refreshing.delete(sessionID);
    }
  }

  /**
   * `prompt.send`: see {@link handle}. Never throws; the outcome goes out as `request.result`.
   * Every `files[].uri` must be in `pickedUris` or `offeredUris` (what the dialog, the editor
   * button or a search emitted), else the whole prompt is refused with `AttachmentRejected` before
   * touching the server (the attachment name is not trusted either, but it is only a label). A
   * `pasted-image:` uri is checked against the live {@link images} instead, whose `data:` URL is
   * read before the first `await`, so an image evicted or forgotten meanwhile still goes whole
   * (UNVERIFIED by execution: read from the code, no test evicts an image during the await). It
   * goes to the server as that `data:` URL without a `mention`, and is forgotten once `prompt
   * accepted` is logged (not after a failure: the chip comes back and can be sent again, unless
   * the image was evicted during the await, or its chip was removed, which
   * already made the webview send `attachments.forget`). VERIFIED by the chatController unit test
   * "keeps a pasted image in memory and sends it as a data URL without a mention" and the
   * integration case "accepts a pasted PNG, refuses a lying type and an invented image uri"
   * (fake server). UNVERIFIED against a real opencode: the `real-opencode` suite sends no prompt. A
   * file may carry the `mention` of its `@path` text (issue #28); it is forwarded only when
   * `text.slice(start, end)` equals its `text`, otherwise the file goes without it (see
   * {@link sameMention}). Chip and text are independent: deleting the `@path` text leaves the file
   * attached with no mention, and deleting the chip leaves a plain `@path` the model reads as text.
   *
   * Issues #23/#24: when the message carries a `model` and/or an `agent`, they are checked against
   * the catalog FIRST (loading it if the host has none; a catalog that cannot be read is
   * `CatalogUnavailable`). One that is not offered answers `ModelUnavailable` /
   * `VariantUnavailable` (a variant the model does not list, issue #61) / `AgentUnavailable` with
   * no call to the server and reloads the catalog, because the webview is behind it. The model is
   * first rebuilt as a plain reference, a `variant: "default"` counting as absent
   * ({@link withoutDefaultVariant}). Then the choice is applied: a NEW session is created with it
   * (`session.create({ agent, model })`), an existing one is switched by {@link applySelection}; a
   * failure there answers the error and sends NO prompt (a prompt sent to a session on a bad
   * model would be redelivered later, VERIFIED in the planner spike). After the prompt is
   * accepted the model becomes the last one used (`preferences.setLastModel`; a failure is a
   * `warn` line, the send stands) and the catalog is published again so a new session proposes
   * it. The model's own variant, if any, is kept, and the `model selected` log lines end in
   * ` (variant <id>)` when there is one. VERIFIED by unit tests with a fake client.
   *
   * Issue #33: a message with `command` runs a slash command. The catalog is needed for it too, and
   * a name it does not list answers `CommandUnavailable` ("The command /<name> is not available on
   * this server") with no call to the server and no session created, reloading the catalog like the
   * other unavailable answers. Everything else is the prompt path (lazy session, model and agent,
   * revert commit, last model), except the last call: `session.command({ name, text })` replaces
   * `session.prompt`, `text` being only the arguments, and the files go WITHOUT `mention` (the
   * template rewrites the text). The log line is `command accepted /<name> for <sid>` instead of
   * `prompt accepted`. A throw of the server (`CommandNotFoundError`, `CommandExecutionError`)
   * is answered as the error of the `request.result`, like any other. UNVERIFIED against a real
   * opencode: the opt-in suite never runs an existing command (it would spend quota).
   * A command whose frontmatter sets `agent:` or `model:` changes the session's agent or model on the
   * server; the next prompt goes back to whatever the chip says, because we send the chip's choice
   * with every prompt (HYPOTHESIS from the plan of #33, Engram #1415: not run). With `subagent: true`
   * the work goes to a child session and the parent may show nothing (HYPOTHESIS: check by running
   * such a command against a real server).
   *
   * VERIFIED
   * against a real opencode 2.0.32 on Windows 11 (22/10/2026), on the final tree: the opt-in
   * `real-opencode` case "applies a chosen reasoning variant before the prompt" logged
   * `model selected opencode/glm-5.3-flash-free … (variant low)` at 09:50:12.869, `prompt
   * accepted` at 09:50:12.874 and `turn finished: succeeded` at 09:50:28.212 (the extension's
   * own OpenCode.log); `test:visual` step 14 repeated it with the real UI at 09:56:55.960 /
   * 09:56:55.989 / 09:56:58.038 (same log lines, same OS and versions). NOT observed: the host
   * refusing an unlisted variant against a real server, macOS and Linux (UNVERIFIED).
   */
  private async sendPrompt(
    pane: ChatPane,
    message: Extract<WebviewToHost, { type: 'prompt.send' }>,
  ): Promise<void> {
    const { requestId } = message;
    const client = this.client;
    if (client === undefined) return this.result(pane, requestId, unavailable());
    // The `data:` URLs are taken NOW, before any await: an image evicted or forgotten while the
    // catalog or the session loads must not leave its raw `pasted-image:` uri for the server
    // (review-2 of 23/10/2026, S8).
    const imageData = new Map<string, string>();
    for (const file of message.files) {
      const data = this.images.dataUrlFor(file.uri);
      if (data !== undefined) imageData.set(file.uri, data);
    }
    if (
      message.files.some((file) =>
        file.uri.startsWith(PASTED_IMAGE_SCHEME)
          ? !imageData.has(file.uri)
          : !this.pickedUris.has(file.uri) && !this.offeredUris.has(file.uri),
      )
    ) {
      this.log.warn(`prompt ${requestId} rejected: an attachment was not emitted by the host`);
      return this.result(pane, requestId, {
        _tag: 'AttachmentRejected',
        message: 'Only files chosen in the chat can be sent',
      });
    }
    try {
      const { agent, command } = message;
      const model = message.model === undefined ? undefined : withoutDefaultVariant(message.model);
      let catalog: Catalog | undefined;
      if (model !== undefined || agent !== undefined || command !== undefined) {
        catalog = await this.ensureCatalog();
        if (client !== this.client) return this.result(pane, requestId, unavailable());
        if (catalog === undefined) {
          return this.result(pane, requestId, {
            _tag: 'CatalogUnavailable',
            message:
              'The models and agents of the server could not be read. Try again in a moment.',
          });
        }
        // Issue #33: the webview parsed the name against ITS catalog; the host checks its own, and
        // an unlisted one never reaches the server nor creates an empty session.
        const problem =
          command !== undefined && catalog.commands?.some((c) => c.name === command) !== true
            ? {
                _tag: 'CommandUnavailable',
                message: `The command /${command} is not available on this server`,
              }
            : this.checkSelection(catalog, model, agent);
        if (problem !== undefined) {
          this.log.warn(`prompt ${requestId} rejected: ${problem._tag}`);
          void this.loadCatalog();
          return this.result(pane, requestId, problem);
        }
      }
      let sessionID = message.sessionID ?? pane.sessionID;
      if (sessionID === undefined) {
        sessionID = (
          await client.session.create({
            ...(agent === undefined ? {} : { agent }),
            ...(model === undefined ? {} : { model }),
          })
        ).id;
        if (agent !== undefined) this.log.info(`agent selected ${agent} for ${sessionID}`);
        if (model !== undefined) {
          this.log.info(
            `model selected ${model.providerID}/${model.id} for ${sessionID}${variantSuffix(model)}`,
          );
        }
        await this.openSession(pane, sessionID);
      } else {
        if (sessionID !== pane.sessionID) await this.openSession(pane, sessionID);
        if (catalog !== undefined) {
          await this.applySelection(client, sessionID, model, agent);
        }
      }
      // Issue #32: a prompt sent with a revert prepared makes the server COMMIT it (`session.ts`
      // @843a6c51 L164-165), without asking; the banner says so. The host forgets the revert as
      // soon as the prompt is accepted (the event does it too).
      const committing = pane.reverts.boundary(sessionID) !== undefined;
      const files =
        message.files.length > 0
          ? {
              files: message.files.map((file) => {
                // A pasted image goes as its `data:` URL and without a mention (issue #30).
                const data = imageData.get(file.uri);
                if (data !== undefined) return { uri: data, name: file.name };
                // Issue #33 (decision P9): a command template rewrites the text, so the offsets
                // of a mention would point at another text; the host forces it off.
                const mention =
                  command === undefined ? sameMention(file.mention, message.text) : undefined;
                return {
                  uri: file.uri,
                  name: file.name,
                  ...(mention === undefined ? {} : { mention }),
                };
              }),
            }
          : {};
      if (command !== undefined) {
        await client.session.command({
          sessionID,
          name: command,
          text: message.text,
          delivery: message.delivery,
          ...files,
        });
        this.log.info(`command accepted /${command} for ${sessionID}`);
      } else {
        const admitted = await client.session.prompt({
          sessionID,
          text: message.text,
          delivery: message.delivery,
          ...files,
        });
        this.log.info(`prompt accepted for ${sessionID} (input ${admitted.id})`);
      }
      for (const file of message.files) this.images.forget(file.uri);
      if (committing) this.afterCommit([pane], sessionID);
      this.result(pane, requestId);
      if (model !== undefined) await this.rememberModel(model);
    } catch (error) {
      this.result(pane, requestId, error);
    }
  }

  /**
   * Stores `model` as the last one used and republishes the catalog so a new session proposes it.
   * Runs AFTER the `request.result` of the prompt, so a slow or failing write never delays or
   * breaks the send; a failure is only a `warn` line.
   */
  private async rememberModel(model: ModelRef): Promise<void> {
    try {
      await this.deps.preferences.setLastModel(model);
      this.onPreferencesChanged();
    } catch (error) {
      this.log.warn(`remembering the last model failed: ${String(error)}`);
    }
  }

  /**
   * Stops the stream and makes the controller inert. Synchronous: the abort does not wait. Tells
   * the attention feature there is nothing pending any more (it closes its notifications), even
   * when the registry was already empty.
   */
  dispose(): void {
    this.disposed = true;
    this.stopStream();
    this.deps.attention.update([]);
  }
}

/**
 * The `mention` a file may keep, or `undefined` to send the file without one.
 *
 * The webview computes the offsets, and the guard only checks their shape: here it is checked that
 * they still point at the text they claim (`text.slice(start, end) === mention.text`). A mention
 * that does not would make the server store a lie about the prompt, so it is dropped silently; the
 * file itself still goes. A copy is returned so nothing but `start`, `end` and `text` travels.
 */
function sameMention(mention: PromptMention | undefined, text: string): PromptMention | undefined {
  if (mention === undefined) return undefined;
  if (text.slice(mention.start, mention.end) !== mention.text) return undefined;
  return { start: mention.start, end: mention.end, text: mention.text };
}

/** Error body for a request that arrives while there is no running server. */
function unavailable(): { _tag: string; message: string } {
  return { _tag: 'ServerUnavailable', message: 'The opencode server is not running' };
}

/**
 * The same refusal as {@link unavailable} as a real `Error`, for the pane-less cores that throw
 * (`toErrorInfo` reads the same `ServerUnavailable` code and text from both).
 */
function unavailableError(): Error {
  const body = unavailable();
  return codedError(body._tag, body.message);
}
