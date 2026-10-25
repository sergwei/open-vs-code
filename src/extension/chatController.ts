// The chat brain of the extension host (issues #9/#14): owns the opencode client, the SSE loop,
// the snapshot, the open session and the answers to the webview. Pure: no `vscode` import. The
// VS Code side (`chatViewProvider.ts`, `chatLifecycle.ts`) only moves messages in and out.
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
// only: `catalog loaded (<n> models, <m> agents)`, `model selected <providerID>/<id> for <sid>`,
// `agent selected <id> for <sid>`, `default model setting ignored: invalid|unavailable`.
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
  type Sender,
  type Snapshot,
  type UiCommand,
  type WebviewToHost,
} from '../shared/protocol';
import { createEventTranslator, type EventTranslator } from './eventTranslator';
import { runEventStream, type StreamState } from './eventStream';
import { toSearchRefs } from './fileMentions';
import { resolvePreferredModel } from './modelPreference';
import { PASTED_IMAGE_SCHEME, PastedImages } from './pastedImages';
import type { ChatApi } from './opencodeClient';
import { safeLog, type ServerLog } from './opencodeServer';
import { createPendingRequests, type PendingSummary } from './pendingRequests';
import { createRequestResolutions } from './requestResolutions';
import type { RunningServerInfo, ServerState } from './serverManager';
import { createSessionBrowser } from './sessionBrowser';
import { createSessionDiffs, type DiffTarget, type SessionDiffs } from './sessionDiff';
import { createSessionReverts, type SessionReverts } from './sessionRevert';
import {
  lastCompactionAt,
  toAgentOptions,
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
 * goes away. It decides by itself whether the view is visible.
 */
export interface AttentionSink {
  update(requests: readonly PendingSummary[]): void;
}

/** What the controller needs from the VS Code side to manage the server (issue #10). */
export interface ServerCommands {
  /** Restarts the server; fire and forget (the outcome is the connection state). */
  restart(): void;
  /** Shows the OpenCode output channel. */
  showLogs(): void;
}

/** What the controller tells the VS Code side about the chat's keyboard focus (issue #35). */
export interface ChatUi {
  /** The webview gained (`true`) or lost (`false`) the keyboard focus; mirrored into a context key. */
  setChatFocused(focused: boolean): void;
  /**
   * Hands the keyboard to the chat view's iframe again. Asked after a `ui.command` that had to wait
   * for a new document. HYPOTHESIS (see `registerChat`): the focus given while the document was
   * loading went nowhere. Seen once in a `test:visual` step 22 run without this call (the new
   * document had `hasFocus()` false); not a check, and its necessity was not proven.
   */
  focusView(): void;
}

/** Where `ui.focus` points: a pending request of any session. */
export type FocusTarget = Extract<HostToWebview, { type: 'ui.focus' }>['target'];

/**
 * How long a focus request waits for a webview that was still loading. Our own choice: long enough
 * for a document to load and send `ready`, short enough that a late `ready` (the user hid and
 * showed the view minutes later) does not steal the focus to a request long gone.
 */
export const FOCUS_REQUEST_TTL_MS = 10_000;

/** Most messages of "Add to OpenCode Chat" kept for a hidden chat (issue #30); our choice, a few clicks' worth. */
const MAX_KEPT_MENU_MESSAGES = 64;

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
   */
  editorContext(folder: string | undefined): Promise<EditorContext>;
  /** Replaces every selection of the active editor with `text`. */
  insert(text: string): Promise<void>;
  /** Opens an untitled document with `text`; `language` is a VS Code language id. */
  newFile(text: string, language?: string): Promise<void>;
  /** Puts `text` on the system clipboard. */
  copy(text: string): Promise<void>;
  /**
   * Shows the file picker; the returned `uri`s join the ones `prompt.send` accepts (with the ones
   * `files.search` listed and the ones `editorContext` returned: the host only sends what it
   * emitted itself).
   */
  pickFiles(): Promise<AttachmentRef[]>;
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
 * user is warned. Never carries the text of the buffer.
 */
export interface EditorContext {
  refs: AttachmentRef[];
  ranged: number;
  unsaved: boolean;
}

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
  /** Publishes to the webview; the provider drops what it cannot deliver (not ready or hidden). */
  post: Sender<HostToWebview>;
  /**
   * True while a `post` would reach the webview. Optional: absent means "always" (tests that do
   * not model a hidden view). Used only by "Add to OpenCode Chat" (issue #30), whose chips would
   * otherwise be lost when the chat view is hidden.
   */
  webviewReady?: () => boolean;
  log: ServerLog;
  memory: SessionMemory;
  editor: EditorActions;
  attention: AttentionSink;
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
]);

/** Snapshot with no sessions, sent when there is no server to ask. */
const EMPTY_SNAPSHOT: Snapshot = {
  sessions: [],
  statuses: {},
  requests: { permissions: [], forms: [] },
  resolutions: [],
};

/**
 * Coordinates the opencode client, the event stream and the webview.
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
  /** Open session of the SERVED folder; read from the memory when a server comes up. */
  private open: string | undefined;
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
   * Answers of "Add to OpenCode Chat" that the webview could not receive because the chat was
   * hidden (a hidden view loses its document; the chips live only in the webview). Published after
   * the snapshot of the next `ready`; capped at {@link MAX_KEPT_MENU_MESSAGES}.
   */
  private undeliveredMenu: HostToWebview[] = [];
  /**
   * `uri`s the host listed in `files.found`, in insertion order and capped at
   * {@link OFFERED_URIS_MAX}. Kept apart from `pickedUris` because they are not a choice yet: a
   * result becomes a chip only when the user picks it, but the host cannot tell which, so every
   * result stays attachable. Narrower than "any file inside the folder", which a compromised
   * webview could use to attach `.env` and skip the model's `read` permission.
   */
  private readonly offeredUris = new Set<string>();
  /** The file search in flight; a newer one or `stopStream` aborts it. */
  private fileSearch: AbortController | undefined;
  private readonly pending = createPendingRequests();
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
   * Counts the `session.revert.staged` / `.cleared` events and the revert calls the host made. A
   * snapshot compares it with the value at its start: if it moved, the REST row is older than what
   * the host already knows about the revert (issue #32).
   */
  private revertEvents = 0;
  /**
   * Ids with a {@link refreshSession} read in flight. A `session.removed` for the id takes it out
   * (`live.removed` only records during a resync, so it cannot guard that call); the read then
   * drops its row. Entries leave when their read ends, so the set stays bounded.
   */
  private readonly refreshing = new Set<string>();
  /** Paging state of the session list; owns the cursor, which never leaves the host. */
  private readonly browser = createSessionBrowser();
  /**
   * Sessions this controller is deleting, so the `session.removed` that comes back is not
   * announced as "deleted elsewhere". The id only lives for the duration of `deleteSession`: it
   * leaves the set when the FIRST `session.removed` for it is consumed by `onSessionRemoved` (the
   * server's, which arrives before the HTTP answer, or the one the controller publishes itself
   * after the 204 when the stream is down), or when the call fails. So the set never grows and
   * needs no bound.
   */
  private readonly deleting = new Set<string>();
  /** A focus request the webview may have missed, repeated after its next snapshot. */
  private focusRequested: { target: FocusTarget; at: number } | undefined;
  /** `ui.command`s the webview could not receive yet; see {@link runUiCommand}. */
  private keptUiCommands: Array<{ command: UiCommand; at: number }> = [];
  private generation = 0;
  private disposed = false;
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
  /** The `defaultModel` setting value the user was last told about, so it is told once. */
  private ignoredSettingNoticed: string | undefined;
  /** The "Changed files" list of the open session and the originals of its diffs (issue #31). */
  private readonly diffs: SessionDiffs;
  /** The prepared revert of the open session and the files behind its banner (issue #32). */
  private readonly reverts: SessionReverts;

  /**
   * Wires the injected effects and the "Changed files" holder (issue #31), which reads the client,
   * the served folder and the open session through getters, so a new server or a session change
   * is seen by a load that is already in flight. The revert holder (issue #32) is the source of
   * the boundary that bounds the "Changed files" range, and borrows its root lookup.
   */
  constructor(private readonly deps: ChatControllerDeps) {
    this.log = safeLog(deps.log);
    this.runStream = deps.runStream ?? runEventStream;
    this.diffs = createSessionDiffs({
      client: () => this.client,
      folder: () => this.server?.folder,
      open: () => this.open,
      boundary: (sessionID) => this.reverts.boundary(sessionID),
      post: (message) => {
        this.post(message);
      },
      log: this.log,
      describe: (error) => toErrorInfo(error, this.secrets),
    });
    this.reverts = createSessionReverts({
      folder: () => this.server?.folder,
      open: () => this.open,
      rootFor: (sessionID) => this.diffs.rootFor(sessionID),
      post: (message) => {
        this.post(message);
      },
      log: this.log,
    });
  }

  /** URL and password of the current server, for scrubbing error texts. */
  private get secrets(): ErrorSecrets {
    return this.server === undefined
      ? {}
      : { url: this.server.url, password: this.server.password };
  }

  /** True while a `post` would reach the webview (`deps.webviewReady`, absent meaning always). */
  private canPost(): boolean {
    return this.deps.webviewReady === undefined || this.deps.webviewReady();
  }

  /**
   * Posts a message of "Add to OpenCode Chat": delivered now if the webview can take it, else kept
   * for {@link flushUndeliveredMenu} (called when the next document says `ready`).
   */
  private postOrKeep(message: HostToWebview): void {
    if (this.canPost()) {
      this.post(message);
      return;
    }
    this.undeliveredMenu.push(message);
    if (this.undeliveredMenu.length > MAX_KEPT_MENU_MESSAGES) this.undeliveredMenu.shift();
  }

  /**
   * Publishes what {@link postOrKeep} kept, after the snapshot of a `ready`. It goes through
   * {@link postOrKeep} again: the view may have been hidden during the `await` of the resync, and
   * a plain `post` would then drop the chips for good (review-2 of 23/10/2026, W7). VERIFIED by
   * the unit test "keeps the Explorer command chips when the chat hides again before they go out"
   * (fake view, 23/10/2026, Windows 11). Not observed in a real VS Code: the window is narrow.
   */
  private flushUndeliveredMenu(): void {
    const kept = this.undeliveredMenu;
    this.undeliveredMenu = [];
    for (const message of kept) this.postOrKeep(message);
  }

  /** Posts, never throwing: a failing sender must not break the stream or a request. */
  private post(message: HostToWebview): void {
    try {
      this.deps.post(message);
    } catch (error) {
      this.log.error(`posting to the webview failed: ${String(error)}`);
    }
  }

  /** Changes the connection state and tells the webview. */
  private setConnection(connection: ConnectionState): void {
    this.connection = connection;
    this.post({ type: 'connection.state', connection });
  }

  /**
   * Reacts to the server manager: `running` starts the client and the event stream; any other
   * state stops the stream (so a `stop` never causes reconnection attempts) and is mirrored as
   * a `ConnectionState`. Re-entering `running` with the same URL and password is a no-op.
   *
   * Phase 3: a new server reads the session remembered for ITS folder (`memory.get(folder)`);
   * `restarting` and `connecting` (an external server being checked, issue #11) look like
   * `starting` to the webview; the `message` of an `unavailable` is copied as is to the webview,
   * which is why the external-server messages carry no URL, port or raw cause (the webview never
   * learns where the server is; `describeExternalFailure`). The re-entry check compares URL and
   * password, so a new password for the same server creates a new client. An `unavailable` that still has a restart
   * scheduled (`retryInMs`) is `reconnecting` with its attempt number, so the banner says
   * "Reconnecting (n)" instead of an error the manager is already healing. Leaving `running` drops
   * the pending requests (they died with the server) and clears the badge.
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
        this.open = this.deps.memory.get(next.folder);
        this.translator = createEventTranslator(this.secrets);
        this.translator.setOpen(this.open);
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
   */
  private stopStream(): void {
    this.streamAbort?.abort();
    this.streamAbort = undefined;
    this.fileSearch?.abort();
    this.fileSearch = undefined;
    this.diffs.reset();
    this.reverts.reset();
    this.client = undefined;
    this.server = undefined;
    this.generation++; // a snapshot in flight for the old server must not be published
    // The catalog belongs to the server that served it: another server may offer other models.
    this.catalog = undefined;
    this.catalogEpoch++;
    this.catalogRun = undefined;
    this.catalogDirty = false;
    this.browser.reset(); // its cursor embeds the old server's query
    this.clearPending();
    this.resolutions.forgetAsks();
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
      if (
        event.type === 'session.compaction.ended' &&
        this.open !== undefined &&
        event.data.sessionID === this.open
      ) {
        // The boundary of the context indicator lives in the snapshot (`compactedAt`), not in a
        // message of its own (issue #25). Not translated: the branch returns first, and the translator
        // has no case for it anyway (it would give `[]`).
        this.log.info(`compaction ended for ${event.data.sessionID}; refreshing the snapshot`);
        void this.resync();
        return;
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
    const open = this.open;
    if (open === undefined) return;
    switch (event.type) {
      case 'session.step.ended':
      case 'session.step.failed':
        if (event.data.sessionID === open && (event.data.files?.length ?? 0) > 0) {
          void this.diffs.request(open);
        }
        return;
      case 'session.revert.committed':
        if (event.data.sessionID !== open) return;
        this.log.info(`revert committed for ${open}`);
        this.afterCommit(open, event.data.to);
        return;
      case 'session.revert.staged':
        if (event.data.sessionID !== open) return;
        this.revertEvents += 1;
        // The boundary is set synchronously by `apply`, so the load that follows is bounded by it.
        void this.reverts.apply(open, event.data.revert, { post: true });
        void this.diffs.request(open);
        return;
      case 'session.revert.cleared':
        if (event.data.sessionID !== open) return;
        this.revertEvents += 1;
        void this.reverts.apply(open, undefined, { post: true });
        void this.diffs.request(open);
        return;
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
  private afterCommit(sessionID: string, boundary?: string): void {
    // The live copies of the deleted messages must go too, or the snapshot's `mergeLive` brings
    // them back as "in flight". Not done for a commit made by a prompt (no `boundary`): its
    // `committed` event does it, before the messages of the prompt itself.
    if (boundary !== undefined) this.translator.forgetFrom(boundary);
    this.reverts.forget(sessionID);
    this.diffs.forgetRange(sessionID);
    void this.resync();
  }

  /**
   * Sends translated messages to the webview through the host-side bookkeeping: the registry of
   * pending requests (and `live`), the open-session check of {@link onSessionRemoved} and the memory
   * of answered requests; the attention feature is told once if the pending set changed. Used for
   * the events of the stream and for the `session.removed` the controller itself synthesises when
   * a call finds the session gone (self-healing of a stale row).
   */
  private publish(messages: readonly HostToWebview[]): void {
    let changed = false;
    for (const message of messages) {
      if (this.trackRequest(message)) changed = true;
      this.post(this.withResolution(message));
      // After the post: the webview empties its view on `session.removed`, and the notice that may
      // follow explains why.
      if (message.type === 'session.removed') this.onSessionRemoved(message.sessionID);
    }
    if (changed) this.deps.attention.update(this.pending.list());
  }

  /**
   * A session is gone. If it was the open one the controller forgets it, memory included, so the
   * next prompt without `sessionID` creates a session instead of going to a dead one (before this,
   * `this.open` and `workspaceState` pointed at it until a resync got a 404). The webview empties
   * its own view when it receives the same `session.removed`. An info notice says so unless the
   * delete was ours (`deleting`). Idempotent: the second report finds `open` already cleared.
   * Whatever it was, the session's "Changed files" state is forgotten (issue #31).
   */
  private onSessionRemoved(sessionID: string): void {
    const ours = this.deleting.delete(sessionID);
    this.diffs.forget(sessionID);
    this.reverts.forget(sessionID);
    if (sessionID !== this.open) return;
    this.log.info(`open session deleted ${sessionID}`);
    void this.forgetOpen();
    if (!ours) {
      this.post({
        type: 'notice',
        level: 'info',
        error: {
          code: 'SessionDeleted',
          message: 'The open session was deleted outside this view',
        },
      });
    }
  }

  /**
   * Makes the controller forget the open session: field, translator and the per-folder memory.
   * The returned promise never rejects (a failed write is logged); callers that need the memory
   * written before going on await it, the event path does not.
   */
  private async forgetOpen(): Promise<void> {
    this.open = undefined;
    this.translator.setOpen(undefined);
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
   * The webview loaded (it sends `ready` on every document load): publishes the connection state
   * and a fresh snapshot, or an empty one when there is no server yet. Anything posted earlier was
   * dropped by the provider, so this is the only way a new document gets its state. If a
   * `focusRequest` is waiting (an "Open chat" click that had to load the document first, so its
   * first `ui.focus` went nowhere) it is sent again after the snapshot, as long as it is fresher
   * than {@link FOCUS_REQUEST_TTL_MS}. The cached catalog, if any, is sent right after the snapshot
   * (a new document starts without one; the load that produced it already went to the old
   * document or was dropped). Then the chips and notices that "Add to OpenCode Chat" produced
   * while the view was hidden ({@link postOrKeep}) go out, after the snapshot so nothing empties
   * them. Last, the `ui.command`s of issue #35 that waited for this document
   * ({@link runUiCommand}), so New Session or Stop act on the state the snapshot just set.
   */
  async onWebviewReady(): Promise<void> {
    this.log.info('webview ready');
    this.post({ type: 'connection.state', connection: this.connection });
    if (this.client === undefined) {
      this.post({ type: 'snapshot', snapshot: EMPTY_SNAPSHOT });
      this.flushUndeliveredMenu();
      this.flushUiCommands();
      return;
    }
    await this.resync();
    if (this.catalog !== undefined) this.post({ type: 'catalog', catalog: this.catalog });
    const requested = this.focusRequested;
    this.focusRequested = undefined;
    if (requested !== undefined && Date.now() - requested.at <= FOCUS_REQUEST_TTL_MS) {
      this.post({ type: 'ui.focus', target: requested.target });
    }
    this.flushUndeliveredMenu();
    this.flushUiCommands();
  }

  /**
   * Relays a palette or keyboard command to the webview as `ui.command` (issue #35), which runs
   * the same code as the matching button. With the webview able to take it, it goes out now and
   * is NOT kept: unlike {@link focusRequest}, repeating it after the next `ready` would run New
   * Session or Stop a second time. With the view hidden (revealing it loads a new document and a
   * message sent before its `ready` is dropped) it is kept at most once per command (see
   * {@link keepUiCommand}), and {@link flushUiCommands} sends it after the snapshot, the
   * catalog and any `ui.focus` of that `ready`, as long as it is younger than
   * {@link FOCUS_REQUEST_TTL_MS}. A command already waiting is not queued twice.
   * VERIFIED against a real VS Code (Windows 11, 25/10/2026): with the chat hidden by Ctrl+B the
   * log shows `ui command prompt.focus: kept for the next ready`, then `webview ready`, then
   * `ui command prompt.focus: sent after ready`, and the `test:visual` step 22 check "and a real
   * keystroke typed right after lands in the prompt box" passed. Not observed: a kept
   * `session.new` or `session.stop` in a real window (unit tests only).
   */
  runUiCommand(command: UiCommand): void {
    if (this.canPost()) {
      this.log.info(`ui command ${command}: sent`);
      this.post({ type: 'ui.command', command });
      return;
    }
    this.log.info(`ui command ${command}: kept for the next ready`);
    this.keepUiCommand(command, Date.now());
  }

  /**
   * Queues `command` unless it already waits; `at` is when the user asked, not when it was re-kept.
   * No size cap: one entry per {@link UiCommand} at most, so the queue is bounded by the union.
   */
  private keepUiCommand(command: UiCommand, at: number): void {
    if (this.keptUiCommands.some((kept) => kept.command === command)) return;
    this.keptUiCommands.push({ command, at });
  }

  /**
   * Sends what {@link runUiCommand} kept, in the order asked, dropping what is older than
   * {@link FOCUS_REQUEST_TTL_MS}. Each goes through the same gate as a fresh command, so a view
   * hidden again during the resync keeps it instead of losing it (same trap as
   * {@link flushUndeliveredMenu}). When at least one went out it also asks `ui.focusView`.
   * HYPOTHESIS (same as `registerChat`): the focus given by the reveal landed on an iframe whose
   * document did not exist yet. Seen once in a `test:visual` step 22 run WITHOUT the second focus
   * (the new document had `hasFocus()` false); that run is not a check, and the run without
   * `focusView` was not repeated to prove it is needed.
   */
  private flushUiCommands(): void {
    const kept = this.keptUiCommands;
    this.keptUiCommands = [];
    const now = Date.now();
    let posted = false;
    for (const { command, at } of kept) {
      if (now - at > FOCUS_REQUEST_TTL_MS) continue;
      if (this.canPost()) {
        this.log.info(`ui command ${command}: sent after ready`);
        this.post({ type: 'ui.command', command });
        posted = true;
      } else {
        this.keepUiCommand(command, at);
      }
    }
    // HYPOTHESIS: the reveal that preceded the command focused an iframe with no document yet.
    if (posted) this.deps.ui.focusView();
  }

  /**
   * Asks the webview to bring a pending request into view (the "Open chat" link of an attention
   * notification, issue #19). Sends `ui.focus` now and keeps the target for the next `ready`:
   * revealing a hidden view loads a NEW document, the message sent before it exists is dropped by
   * the provider, and the snapshot that follows its `ready` is what makes the card exist.
   */
  focusRequest(target: FocusTarget): void {
    this.focusRequested = { target, at: Date.now() };
    this.post({ type: 'ui.focus', target });
  }

  /**
   * Reads the state of the server by REST and publishes it as one `snapshot`.
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
   * If the open session is deleted while its messages are being read (`this.open` no longer is the
   * id the reads started with), the snapshot goes out with NO open session, and the rows and
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
   */
  async resync(): Promise<void> {
    const client = this.client;
    const server = this.server;
    if (client === undefined || server === undefined) return;
    const generation = ++this.generation;
    const revertEventsAtStart = this.revertEvents;
    // Statuses the stream derives from here on override the (older) REST ones at publication.
    this.translator.beginResync();
    if (this.resyncing === 0) {
      this.live.permissions.clear();
      this.live.forms.clear();
      this.live.gone.clear();
      this.live.removed.clear();
    }
    this.resyncing += 1;
    try {
      const [list, active, permissionList, formList] = await Promise.all([
        client.session.list({ directory: server.folder, order: 'desc', limit: SESSION_LIMIT }),
        client.session.active(),
        client.permission.request.list(),
        client.form.list(),
      ]);
      const sessions: SessionSummary[] = list.data.map(toSessionSummary);
      const statuses: { [sessionID: string]: SessionStatus } = {};
      for (const id of Object.keys(active)) statuses[id] = { type: 'busy' };
      const restRequests: PendingAsks = {
        permissions: permissionList.data.map(toPermissionAsk),
        forms: formList.data.map(toFormAsk),
      };

      let open: OpenSession | undefined;
      let rawMessages: Awaited<ReturnType<ChatApi['message']['list']>>['data'] = [];
      const openID = this.open;
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
          let openRow = list.data.find((row) => row.id === openID);
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
          // An event about the revert that arrived during these reads is newer than the row: it
          // owns the state, and the snapshot just carries what the host holds. The same when the row
          // could not be read (not in the list and `session.get` failed): "no row" is not "no
          // revert", and applying `undefined` would clear a revert the server still has, showing
          // the hidden messages again while the files stay reverted (review W2).
          const revertState =
            openRow !== undefined && this.revertEvents === revertEventsAtStart
              ? await this.reverts.apply(openID, openRow.revert, { post: false })
              : this.reverts.state(openID);
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
          this.open = undefined;
          await this.deps.memory.set(server.folder, undefined);
        }
      }
      if (generation !== this.generation || this.disposed) return;
      // Issue #20, review W1: the open session can be deleted (by another client, or by us) WHILE
      // `message.list` was in flight and the server answered before deleting. `onSessionRemoved`
      // already cleared `this.open`; publishing the local `open` would show the dead session again
      // while the host believes there is none. The same goes for the rows the stream reported gone.
      if (openID !== undefined && this.open !== openID) {
        open = undefined;
        rawMessages = [];
      }
      for (const id of this.live.removed) delete statuses[id];
      // The totals of `session.usage.updated` seen since `beginResync` are newer than the REST rows.
      const rows = this.translator.mergeUsage(
        sessions.filter((row) => !this.live.removed.has(row.id)),
      );
      if (open !== undefined) {
        const compactedAt = lastCompactionAt(rawMessages);
        if (compactedAt !== undefined) open.compactedAt = compactedAt;
      }
      this.translator.setOpen(this.open);
      this.translator.seed({ sessions: rows, messages: rawMessages });
      const requests = this.completeWithLive(restRequests);
      if (this.pending.replaceAll(requests.permissions, requests.forms)) {
        this.deps.attention.update(this.pending.list());
      }
      // So a request first seen here (asked before this host connected) can still be resolved
      // into a record when its `*.resolved` arrives.
      this.resolutions.rememberAsks(requests.permissions, requests.forms);
      // The webview replaces its state with the snapshot, and the stream may have produced
      // messages after the REST reads: complete the snapshot with them (review BLOCKER). The
      // statuses need the same care in the other direction: `session.active()` can say `busy`
      // and a `session.execution.succeeded` arrive before we publish; the stream already sent
      // `idle`, so the stale `busy` would overwrite it and nothing would ever correct it (Send
      // stays disabled while busy). `mergeStatuses` lets what the stream said since the resync
      // began win over what REST said.
      const complete = open === undefined ? undefined : this.translator.mergeLive(open);
      this.post({
        type: 'snapshot',
        snapshot: {
          sessions: rows,
          statuses: this.translator.mergeStatuses(statuses),
          ...(complete ? { open: complete } : {}),
          requests,
          resolutions: this.open === undefined ? [] : this.resolutions.forSession(this.open),
        },
      });
      this.log.info(`snapshot sent (${String(rows.length)} sessions, open ${this.open ?? 'none'})`);
      // Issue #31: the webview replaced its state with this snapshot, so the held list is sent
      // again (a new document starts without one) and then refreshed.
      if (this.open !== undefined) {
        // Issue #32: a revert event applied while the snapshot was being built is newer than it.
        this.reverts.resend(this.open, complete?.revert);
        this.diffs.resend(this.open);
        void this.diffs.request(this.open);
      }
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      const info = toErrorInfo(error, this.secrets);
      if (info.code === 'Transport') {
        // The server is unreachable (it died or is restarting): the connection banner already
        // says so, and a notice on top would only be noise (W4 of the review; seen in the log
        // of the real-opencode run when the test killed the server mid-snapshot).
        this.log.warn(`snapshot failed (server unreachable): ${info.message}`);
        return;
      }
      this.log.error(`snapshot failed: ${info.code}: ${info.message}`);
      this.post({ type: 'notice', level: 'error', error: info });
    } finally {
      this.resyncing -= 1;
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
    try {
      const [models, providers, agents, fallback] = await Promise.all([
        client.model.list(),
        client.provider.list(),
        client.agent.list(),
        client.model.default(),
      ]);
      if (epoch !== this.catalogEpoch || this.disposed) return;
      const agentOptions = toAgentOptions(agents.data);
      const catalog: Catalog = {
        models: models.data.map(toModelOption),
        providers: providers.data.map(toProviderOption),
        agents: agentOptions,
      };
      if (fallback.data !== null) {
        catalog.serverDefault = { providerID: fallback.data.providerID, id: fallback.data.id };
      }
      // The server lists its default agent first (core/agent.ts L106-111 at v2.0.32, read).
      const first = agentOptions[0];
      if (first !== undefined) catalog.defaultAgent = first.id;
      this.catalog = this.withPreferredModel(catalog);
      this.log.info(
        `catalog loaded (${String(catalog.models.length)} models, ${String(catalog.agents.length)} agents)`,
      );
      this.post({ type: 'catalog', catalog: this.catalog });
    } catch (error) {
      if (epoch !== this.catalogEpoch) return;
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`catalog load failed: ${info.code}: ${info.message}`);
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
    this.post({
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
    this.post({ type: 'catalog', catalog: this.catalog });
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

  /** Remembers `sessionID` as the open one (for the served folder) and publishes its history. */
  private async openSession(sessionID: string): Promise<void> {
    this.open = sessionID;
    if (this.server !== undefined) await this.deps.memory.set(this.server.folder, sessionID);
    this.translator.setOpen(sessionID);
    await this.resync();
  }

  /** Posts the outcome of a request: success, or the scrubbed error. */
  private result(requestId: string, error?: unknown): void {
    if (error === undefined) {
      this.post({ type: 'request.result', requestId });
      return;
    }
    const info: ErrorInfo = toErrorInfo(error, this.secrets);
    this.log.warn(`request ${requestId} failed: ${info.code}: ${info.message}`);
    this.post({ type: 'request.result', requestId, error: info });
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
  private async abort(requestId: string, sessionID: string): Promise<void> {
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
    try {
      const { interrupted } = await client.session.interrupt({ sessionID });
      this.log.info(`abort requested for ${sessionID} (interrupted: ${String(interrupted)})`);
      this.result(requestId);
      if (!interrupted) await this.resync();
    } catch (error) {
      this.result(requestId, error);
    }
  }

  /**
   * Runs one editor-side action. These webview messages have no `requestId`, so a failure is
   * reported as a `warning` notice (scrubbed like every error text) and a `warn` log line; it
   * never throws.
   */
  private async editorAction(type: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`${type} failed: ${info.code}: ${info.message}`);
      this.post({ type: 'notice', level: 'warning', error: info });
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
  private async openChangedFile(sessionID: string, shown: string): Promise<void> {
    const checked = this.diffs.target(sessionID, shown);
    if (!checked.ok) {
      this.log.warn(`diff open refused: ${checked.reason}`);
      this.post({
        type: 'notice',
        level: 'warning',
        error: {
          code: 'DiffNotListed',
          message: 'That file is not in the changed files of this session any more',
        },
      });
      return;
    }
    await this.editorAction('session.diff.open', async () => {
      const opened = await this.deps.editor.openDiff(checked.target);
      this.log.info(
        opened === 'diff'
          ? `diff opened (${checked.target.status})`
          : `diff opened (${checked.target.status}, file only)`,
      );
      if (opened === 'file') {
        this.post({
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
  private async openRevertedFile(sessionID: string, shown: string): Promise<void> {
    const checked = this.reverts.target(sessionID, shown);
    if (!checked.ok) {
      this.log.warn(`revert diff open refused: ${checked.reason}`);
      this.post({
        type: 'notice',
        level: 'warning',
        error: {
          code: 'DiffNotListed',
          message: 'That file is not among the files of the revert any more',
        },
      });
      return;
    }
    await this.editorAction('session.revert.open', async () => {
      const opened = await this.deps.editor.openDiff(checked.target);
      this.log.info(
        opened === 'diff'
          ? `revert diff opened (${checked.target.status})`
          : `revert diff opened (${checked.target.status}, file only)`,
      );
      if (opened === 'file') {
        this.post({
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
    return this.reverts.original(sessionID, shown);
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
    message: Extract<WebviewToHost, { type: 'session.revert.stage' }>,
  ): Promise<void> {
    const { requestId, sessionID, messageID } = message;
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
    if (sessionID !== this.open) {
      this.log.warn('revert refused: session not open');
      return this.result(requestId, {
        _tag: 'SessionNotOpen',
        message: 'Only the open session can be reverted',
      });
    }
    try {
      const target = await client.session.message.get({ sessionID, messageID });
      if (target.type !== 'user') {
        this.log.warn('revert refused: not a user message');
        return this.result(requestId, {
          _tag: 'NotAUserMessage',
          message: 'You can only revert from a message you sent',
        });
      }
      const revert = await client.session.revert.stage({ sessionID, messageID });
      if (client !== this.client) return this.result(requestId, unavailable());
      this.revertEvents += 1;
      this.log.info(`revert staged for ${sessionID}: ${String(revert.files?.length ?? 0)} files`);
      await this.reverts.apply(sessionID, revert, { post: true });
      void this.diffs.request(sessionID);
      this.result(requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(requestId, error);
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
    message: Extract<WebviewToHost, { type: 'session.revert.clear' }>,
  ): Promise<void> {
    const { requestId, sessionID } = message;
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
    if (sessionID !== this.open) {
      this.log.warn('revert refused: session not open');
      return this.result(requestId, {
        _tag: 'SessionNotOpen',
        message: 'Only the open session can be restored',
      });
    }
    try {
      await client.session.revert.clear({ sessionID });
      if (client !== this.client) return this.result(requestId, unavailable());
      this.revertEvents += 1;
      this.log.info(`revert cleared for ${sessionID}`);
      await this.reverts.apply(sessionID, undefined, { post: true });
      void this.diffs.request(sessionID);
      this.result(requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(requestId, error);
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
    message: Extract<WebviewToHost, { type: 'session.revert.commit' }>,
  ): Promise<void> {
    const { requestId, sessionID } = message;
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
    if (sessionID !== this.open) {
      this.log.warn('revert refused: session not open');
      return this.result(requestId, {
        _tag: 'SessionNotOpen',
        message: 'Only the open session can be discarded',
      });
    }
    try {
      if (!(await this.deps.sessions.confirmRevertDiscard())) {
        this.log.info(`revert commit cancelled ${sessionID}`);
        return this.result(requestId);
      }
      const boundary = this.reverts.boundary(sessionID);
      await client.session.revert.commit({ sessionID });
      if (client !== this.client) return this.result(requestId, unavailable());
      this.afterCommit(sessionID, boundary);
      this.result(requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(requestId, error);
    }
  }

  /**
   * The text `shown` had before the open session changed it, for the read-only document on the left
   * of a diff (called by the content provider of `sessionDiffEditor.ts`). Rejects with
   * `DiffNotListed` when the path is not one the host listed for the open session, and with
   * `NoTextDiff` when the original cannot be rebuilt; VS Code then shows the message in the editor.
   */
  diffOriginal(sessionID: string, shown: string): Promise<string> {
    return this.diffs.original(sessionID, shown);
  }

  /**
   * Subscribes to "the originals of this session may have changed" (a new list or a moved range,
   * see `SessionDiffs.onRenewed`); the content provider re-reads its open documents on it.
   * Returns the unsubscribe function.
   */
  onDiffRenewed(listener: (sessionID: string) => void): () => void {
    return this.diffs.onRenewed(listener);
  }

  /**
   * `attachments.pick`: shows the picker and answers with the files. Their `uri`s are remembered
   * in `pickedUris`: the webview is untrusted, and the server would read any `file://` it is
   * given and send it to the model provider, so `prompt.send` accepts only what came from here.
   * A cancelled dialog is an empty list, not an error.
   */
  private async pickAttachments(requestId: string): Promise<void> {
    try {
      const files = await this.deps.editor.pickFiles();
      for (const file of files) this.pickedUris.add(file.uri);
      this.post({ type: 'attachments.picked', requestId, files });
      this.result(requestId);
    } catch (error) {
      this.result(requestId, error);
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
   * through {@link postOrKeep}: with the chat view hidden they wait for the next `ready` instead of
   * being dropped by the provider (review of 23/10/2026, B2).
   * UNVERIFIED against a real VS Code drag (microsoft/vscode#339036); see the integration case
   * "adds dropped files, counts what it refuses" for the injected message. UNVERIFIED that
   * `file.find` of a real server lists an ordinary file among its first 20 results (the fake
   * invents the list).
   */
  private async dropFiles(
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
          return this.result(requestId, unavailable());
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
        if (verify) this.post(message);
        else this.postOrKeep(message);
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
      this.result(requestId);
    } catch (error) {
      this.result(requestId, error);
    }
  }

  /**
   * "Add to OpenCode Chat" of the Explorer context menu (issue #30, decision Q1 of Sergio): the
   * `uris` are what VS Code handed the command for the clicked or selected items. A user gesture
   * the host sees, so it skips the `file.find` check of a drop (see {@link dropFiles}); the answer
   * goes to the webview with a request id of its own, which the webview never began.
   */
  async addToChat(uris: readonly string[]): Promise<void> {
    if (uris.length === 0) return;
    this.menuRequests += 1;
    await this.dropFiles(
      `menu-${String(this.menuRequests)}`,
      uris.slice(0, MAX_DROPPED_ITEMS),
      false,
    );
  }

  /**
   * `attachments.image` (issue #30): validates one pasted image BY ITS BYTES ({@link PastedImages}),
   * keeps it in memory and answers with a chip whose `uri` is the opaque `pasted-image:<n>`. The
   * bytes never go back to the webview and are never logged; the log line has the type and the
   * size in KiB. A refusal (`UnsupportedImage`, `ImageTooLarge`) is the error of the
   * `request.result`. Needs no server. Retry, fork and revert do not re-attach the image: the
   * history has no `uri` for an inline attachment (README says so, decision Q3).
   */
  private attachImage(requestId: string, mime: string, data: string): Promise<void> {
    try {
      const ref = this.images.add(mime, data);
      this.post({ type: 'attachments.picked', requestId, files: [ref] });
      this.log.info(`image added: ${mime}, ${String(this.images.sizeKiB(ref.uri) ?? 0)} KiB`);
      this.result(requestId);
    } catch (error) {
      this.result(requestId, error);
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
  private async attachFromEditor(requestId: string): Promise<void> {
    try {
      const context = await this.deps.editor.editorContext(this.server?.folder);
      for (const ref of context.refs) this.pickedUris.add(ref.uri);
      this.post({ type: 'attachments.picked', requestId, files: context.refs });
      if (context.unsaved) {
        this.log.warn('editor context: the buffer has unsaved changes, the saved file is attached');
        this.post({
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
      this.result(requestId);
    } catch (error) {
      this.result(requestId, error);
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
    message: Extract<WebviewToHost, { type: 'files.search' }>,
  ): Promise<void> {
    const { requestId, query } = message;
    this.fileSearch?.abort();
    const client = this.client;
    const server = this.server;
    if (client === undefined || server === undefined) {
      this.post({
        type: 'files.found',
        requestId,
        query,
        files: [],
        error: toErrorInfo(unavailable(), this.secrets),
      });
      return;
    }
    const controller = new AbortController();
    this.fileSearch = controller;
    // True when the search ended without an answer to publish. A newer search owns `fileSearch`
    // (it is set to a different controller): stay silent, the webview waits for that one. Otherwise
    // the server went away (`stopStream` cleared it and swapped the client): answer with an error,
    // or the popup would keep saying "Searching…" for a request nobody will resolve.
    const abandoned = (): boolean => {
      if (!controller.signal.aborted && client === this.client) return false;
      if (this.fileSearch === undefined || this.fileSearch === controller) {
        this.post({
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
      this.post({ type: 'files.found', requestId, query, files });
    } catch (error) {
      if (abandoned()) return;
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`file search failed: ${info.code}`);
      this.post({ type: 'files.found', requestId, query, files: [], error: info });
    } finally {
      if (this.fileSearch === controller) this.fileSearch = undefined;
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
    message: Extract<WebviewToHost, { type: 'permission.reply' }>,
  ): Promise<void> {
    try {
      await this.sendPermissionReply(
        message.sessionID,
        message.permissionID,
        message.decision,
        message.message,
      );
      this.result(message.requestId);
    } catch (error) {
      this.result(message.requestId, error);
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
  private async answerForm(message: Extract<WebviewToHost, { type: 'form.reply' }>): Promise<void> {
    const client = this.client;
    if (client === undefined) return this.result(message.requestId, unavailable());
    const problem = this.checkPending('form', message.formID, message.sessionID);
    if (problem !== undefined) {
      this.result(message.requestId, problem);
      return this.healIfStale(problem);
    }
    try {
      await client.session.form.reply({
        sessionID: message.sessionID,
        formID: message.formID,
        answer: message.answer,
      });
      this.log.info(`form reply sent for ${message.formID}`);
      this.result(message.requestId);
    } catch (error) {
      this.result(message.requestId, error);
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
    message: Extract<WebviewToHost, { type: 'form.cancel' }>,
  ): Promise<void> {
    const client = this.client;
    if (client === undefined) return this.result(message.requestId, unavailable());
    const problem = this.checkPending('form', message.formID, message.sessionID);
    if (problem !== undefined) {
      this.result(message.requestId, problem);
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
      this.result(message.requestId);
    } catch (error) {
      if (note !== undefined) this.resolutions.unmark('form', message.formID);
      this.result(message.requestId, error);
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
  private async manageSavedPermissions(): Promise<void> {
    const client = this.client;
    if (client === undefined) {
      this.post({
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
        this.post({
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
        this.post({
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
      this.post({ type: 'notice', level: 'warning', error: info });
    }
  }

  /**
   * Handles one VALIDATED webview message (the caller ran `isWebviewToHost`).
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
   * to `deps.server`.
   */
  handle(message: WebviewToHost): Promise<void> {
    return this.run(message);
  }

  /** Dispatch body of {@link handle}; kept apart so `dispatch` can return a Promise. */
  private async run(message: WebviewToHost): Promise<void> {
    const pending: Promise<void>[] = [];
    dispatch<WebviewToHost>(message, {
      ready: () => {
        pending.push(this.onWebviewReady());
      },
      'session.new': (m) => {
        pending.push(this.newSession(m.requestId));
      },
      'session.open': (m) => {
        pending.push(this.openRequested(m.requestId, m.sessionID));
      },
      'sessions.query': (m) => {
        pending.push(this.querySessions(m));
      },
      'session.rename': (m) => {
        pending.push(this.renameSession(m));
      },
      'session.delete': (m) => {
        pending.push(this.deleteSession(m));
      },
      'session.fork': (m) => {
        pending.push(this.forkSession(m));
      },
      'prompt.send': (m) => {
        pending.push(this.sendPrompt(m));
      },
      'session.abort': (m) => {
        pending.push(this.abort(m.requestId, m.sessionID));
      },
      'permission.reply': (m) => {
        pending.push(this.answerPermission(m));
      },
      'form.reply': (m) => {
        pending.push(this.answerForm(m));
      },
      'form.cancel': (m) => {
        pending.push(this.cancelForm(m));
      },
      'attachments.pick': (m) => {
        pending.push(this.pickAttachments(m.requestId));
      },
      'attachments.fromEditor': (m) => {
        pending.push(this.attachFromEditor(m.requestId));
      },
      'attachments.drop': (m) => {
        pending.push(this.dropFiles(m.requestId, m.uris, true));
      },
      'attachments.image': (m) => {
        pending.push(this.attachImage(m.requestId, m.mime, m.data));
      },
      // Sergio's decision of 23/10/2026 (S5): removing a chip frees the image. Only `PastedImages`
      // can forget, and it knows only the uris it issued; any other uri is a no-op.
      'attachments.forget': (m) => {
        this.images.forget(m.uri);
      },
      'files.search': (m) => {
        pending.push(this.searchFiles(m));
      },
      'permissions.manage': () => {
        pending.push(this.manageSavedPermissions());
      },
      'server.restart': () => {
        this.deps.server.restart();
      },
      'logs.show': () => {
        this.deps.server.showLogs();
      },
      'editor.open': (m) => {
        pending.push(
          this.editorAction(m.type, () =>
            this.deps.editor.open(m.path, m.line, m.column, this.server?.folder),
          ),
        );
      },
      'session.diff.open': (m) => {
        pending.push(this.openChangedFile(m.sessionID, m.path));
      },
      'session.revert.stage': (m) => {
        pending.push(this.stageRevert(m));
      },
      'session.revert.clear': (m) => {
        pending.push(this.clearRevert(m));
      },
      'session.revert.commit': (m) => {
        pending.push(this.commitRevert(m));
      },
      'session.revert.open': (m) => {
        pending.push(this.openRevertedFile(m.sessionID, m.path));
      },
      'editor.insert': (m) => {
        pending.push(this.editorAction(m.type, () => this.deps.editor.insert(m.text)));
      },
      'editor.newFile': (m) => {
        pending.push(this.editorAction(m.type, () => this.deps.editor.newFile(m.text, m.language)));
      },
      'clipboard.write': (m) => {
        pending.push(this.editorAction(m.type, () => this.deps.editor.copy(m.text)));
      },
      'chat.focusChanged': (m) => {
        this.deps.ui.setChatFocused(m.focused);
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
   */
  private async newSession(requestId: string): Promise<void> {
    if (this.client === undefined) return this.result(requestId, unavailable());
    try {
      await this.forgetOpen();
      await this.resync();
      this.result(requestId);
    } catch (error) {
      this.result(requestId, error);
    }
  }

  /**
   * `session.open`: checks the session exists, then opens it. A `SessionNotFoundError` means the
   * row the user clicked is stale (deleted by another client, or an event was lost), so it is also
   * reported as `session.removed` to heal the list.
   */
  private async openRequested(requestId: string, sessionID: string): Promise<void> {
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
    try {
      await client.session.get({ sessionID });
      await this.openSession(sessionID);
      this.result(requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(requestId, error);
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
    message: Extract<WebviewToHost, { type: 'sessions.query' }>,
  ): Promise<void> {
    const { requestId } = message;
    const client = this.client;
    const server = this.server;
    if (client === undefined || server === undefined) {
      return this.result(requestId, unavailable());
    }
    try {
      const query = this.browser.query(message.search, message.more, server.folder);
      const answer = await client.session.list(query.input);
      // The server changed while we waited: the page belongs to another server, but the webview
      // must still hear back or its list stays "loading" (review S3).
      if (client !== this.client) return this.result(requestId, unavailable());
      const page = query.accept(answer);
      this.translator.mirror(page.rows);
      this.post({
        type: 'sessions.page',
        requestId,
        search: message.search,
        sessions: page.rows,
        append: page.append,
        hasMore: page.hasMore,
      });
      this.log.info(`sessions page (${String(page.rows.length)}, more: ${String(message.more)})`);
      this.result(requestId);
    } catch (error) {
      if (tagOf(error) === 'InvalidCursorError') this.browser.reset();
      this.result(requestId, error);
    }
  }

  /**
   * `session.rename`: trims the title and re-checks it (the webview already did, but it is
   * untrusted, and a BLANK title would make the server run the LLM title generator instead of
   * clearing it: VERIFIED by the planner spike). The visible result is the `session.renamed` event
   * the server publishes (translated to `session.upserted`, also when another client renames);
   * this only answers with a `request.result`. A session that no longer exists is reported as
   * `session.removed`. Logs the id, never the title.
   */
  private async renameSession(
    message: Extract<WebviewToHost, { type: 'session.rename' }>,
  ): Promise<void> {
    const { requestId, sessionID } = message;
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
    const title = message.title.trim();
    if (title === '' || title.length > MAX_SESSION_TITLE_LENGTH) {
      return this.result(requestId, {
        _tag: 'InvalidTitle',
        message: `A session title needs 1 to ${String(MAX_SESSION_TITLE_LENGTH)} characters`,
      });
    }
    try {
      await client.session.update({ sessionID, title });
      this.log.info(`session renamed ${sessionID}`);
      this.result(requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(requestId, error);
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
   * do). Logs ids only.
   */
  private async deleteSession(
    message: Extract<WebviewToHost, { type: 'session.delete' }>,
  ): Promise<void> {
    const { requestId, sessionID } = message;
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
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
        return this.result(requestId);
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
      this.result(requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(requestId, error);
    }
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
    message: Extract<WebviewToHost, { type: 'session.fork' }>,
  ): Promise<void> {
    const { requestId, sessionID, messageID } = message;
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
    try {
      const info = await client.session.fork({ sessionID, before: messageID });
      if (client !== this.client) return this.result(requestId, unavailable());
      const row = toSessionSummary(info);
      this.translator.mirror([row]);
      this.publish([{ type: 'session.upserted', session: row }]);
      this.log.info(`session forked ${sessionID} -> ${info.id}`);
      await this.openSession(info.id);
      this.result(requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(requestId, error);
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
   * ` (variant <id>)` when there is one. VERIFIED by unit tests with a fake client. VERIFIED
   * against a real opencode 2.0.32 on Windows 11 (22/10/2026), on the final tree: the opt-in
   * `real-opencode` case "applies a chosen reasoning variant before the prompt" logged
   * `model selected opencode/glm-5.3-flash-free … (variant low)` at 09:50:12.869, `prompt
   * accepted` at 09:50:12.874 and `turn finished: succeeded` at 09:50:28.212 (the extension's
   * own OpenCode.log); `test:visual` step 14 repeated it with the real UI at 09:56:55.960 /
   * 09:56:55.989 / 09:56:58.038 (same log lines, same OS and versions). NOT observed: the host
   * refusing an unlisted variant against a real server, macOS and Linux (UNVERIFIED).
   */
  private async sendPrompt(
    message: Extract<WebviewToHost, { type: 'prompt.send' }>,
  ): Promise<void> {
    const { requestId } = message;
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
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
      return this.result(requestId, {
        _tag: 'AttachmentRejected',
        message: 'Only files chosen in the chat can be sent',
      });
    }
    try {
      const { agent } = message;
      const model = message.model === undefined ? undefined : withoutDefaultVariant(message.model);
      let catalog: Catalog | undefined;
      if (model !== undefined || agent !== undefined) {
        catalog = await this.ensureCatalog();
        if (client !== this.client) return this.result(requestId, unavailable());
        if (catalog === undefined) {
          return this.result(requestId, {
            _tag: 'CatalogUnavailable',
            message:
              'The models and agents of the server could not be read. Try again in a moment.',
          });
        }
        const problem = this.checkSelection(catalog, model, agent);
        if (problem !== undefined) {
          this.log.warn(`prompt ${requestId} rejected: ${problem._tag}`);
          void this.loadCatalog();
          return this.result(requestId, problem);
        }
      }
      let sessionID = message.sessionID ?? this.open;
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
        await this.openSession(sessionID);
      } else {
        if (sessionID !== this.open) await this.openSession(sessionID);
        if (catalog !== undefined) {
          await this.applySelection(client, sessionID, model, agent);
        }
      }
      // Issue #32: a prompt sent with a revert prepared makes the server COMMIT it (`session.ts`
      // @843a6c51 L164-165), without asking; the banner says so. The host forgets the revert as
      // soon as the prompt is accepted (the event does it too).
      const committing = this.reverts.boundary(sessionID) !== undefined;
      const admitted = await client.session.prompt({
        sessionID,
        text: message.text,
        delivery: message.delivery,
        ...(message.files.length > 0
          ? {
              files: message.files.map((file) => {
                // A pasted image goes as its `data:` URL and without a mention (issue #30).
                const data = imageData.get(file.uri);
                if (data !== undefined) return { uri: data, name: file.name };
                const mention = sameMention(file.mention, message.text);
                return {
                  uri: file.uri,
                  name: file.name,
                  ...(mention === undefined ? {} : { mention }),
                };
              }),
            }
          : {}),
      });
      this.log.info(`prompt accepted for ${sessionID} (input ${admitted.id})`);
      for (const file of message.files) this.images.forget(file.uri);
      if (committing) this.afterCommit(sessionID);
      this.result(requestId);
      if (model !== undefined) await this.rememberModel(model);
    } catch (error) {
      this.result(requestId, error);
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
