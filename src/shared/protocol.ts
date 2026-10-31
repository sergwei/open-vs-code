/**
 * Typed message protocol between the extension host and the webview (issue #3).
 *
 * Two discriminated unions (`type` is the discriminant), runtime guards, and pure helpers.
 * PURE module: no `vscode`, no DOM, no Node, no `@opencode/client`. Ambient globals are blocked by
 * `types: []` in `src/shared/tsconfig.json`; package imports are blocked by the neutrality test
 * in `neutrality.test.ts` (and by the ESLint rule of issue #4, once it lands). The tsconfig alone
 * does NOT stop a package import such as the `vscode` module (the neutrality scanner flags
 * specifiers even inside comments, so none is spelled out here). The wire-to-protocol adapter
 * lives in the host (issues #9/#14);
 * the concrete transport (`webview.postMessage`, `acquireVsCodeApi`, the queue until `ready`)
 * is issue #2. Nothing here carries the server URL, port or password (architecture rule 1).
 *
 * HYPOTHESIS: the domain shapes come from reading `@opencode/client@2.0.32` types and the
 * v2.0.32 tag, never from a running server. See `model.ts`.
 */
import type {
  Catalog,
  ChangedFile,
  ErrorInfo,
  FormAnswer,
  FormAsk,
  MessageInfo,
  ModelRef,
  Part,
  PermissionAsk,
  PermissionDecision,
  RequestResolution,
  RevertState,
  SessionStatus,
  SessionSummary,
} from './model';

/**
 * Longest session title the host accepts in `session.rename`. Our choice (issue #20): the server
 * schema is a plain `String` with no limit (HYPOTHESIS that no other cap exists; read in
 * `protocol/src/groups/session.ts` of the v2.0.32 tag, not probed with a huge title).
 */
export const MAX_SESSION_TITLE_LENGTH = 200;

/** Longest search text `sessions.query` accepts. Our choice (issue #20), same reasoning as the title cap. */
export const MAX_SESSION_SEARCH_LENGTH = 200;

/**
 * Longest text `files.search` accepts (the part after the `@`). Our choice (issues #28/#29): a
 * path fragment never needs more, and the host passes it to the server as a search string.
 */
export const MAX_FILE_SEARCH_LENGTH = 200;

/**
 * Longest slash command name `prompt.send` accepts in `command` (issue #33). Our choice, same
 * reasoning as {@link MAX_FILE_SEARCH_LENGTH}: names come from file paths and MCP prompt names, and
 * the host checks the name against its own catalog anyway.
 */
export const MAX_COMMAND_NAME_LENGTH = 200;

/**
 * Longest `path` `session.diff.open` accepts (issue #31). Our choice: the path is one the host
 * listed itself, so a longer one is not a real file of the list; 4096 is the usual PATH_MAX of
 * Linux, above any path a repository realistically holds (Windows' own limit is 32767).
 */
export const MAX_DIFF_PATH_LENGTH = 4096;

/** Most items one `attachments.drop` may carry. The TUI's `MAX_PASTED_FILEPATHS` figure (issue #30); our choice. */
export const MAX_DROPPED_ITEMS = 32;

/** Longest URI of a dropped item (issue #30): PATH_MAX of Linux plus room for the scheme and escapes. Our choice. */
export const MAX_DROPPED_URI_LENGTH = 4096 + 64;

/**
 * Largest pasted image the webview and the host accept, in BYTES (issue #30). Our choice: its
 * base64 is about 13.4 MiB, under the 16 MiB `maxSseEventBytes` of the client (the
 * `session.inbox.enqueued` event repeats the data), while the server itself would take 20 MiB.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Longest base64 text of a pasted image: the encoding of {@link MAX_IMAGE_BYTES}. */
export const MAX_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);

/** The image types the model receives as media (`to-llm-message.ts@v2.0.32`; bmp and avif are dropped silently). */
export const IMAGE_MIMES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

/**
 * File the host emitted: picked in the dialog (`attachments.picked`), taken from the editor
 * (`attachments.picked` after `attachments.fromEditor`) or found by `files.search`
 * (`files.found`). The webview echoes it back in `prompt.send`; the host only accepts a `uri` it
 * emitted itself. `uri` may carry `?start=a&end=b` (a line range, 1-based, inclusive) and then
 * `name` ends in `#a-b`.
 */
export type AttachmentRef = { uri: string; name: string };

/**
 * Where an `@path` mention sits in the prompt text, as the server stores it: `text` is
 * `prompt.text.slice(start, end)` (UTF-16 offsets, the same unit as JavaScript strings). The
 * server only copies it (VERIFIED, planner spike against opencode 2.0.32 on Windows 11,
 * 22/10/2026); the model never sees the offsets, only the text.
 */
export type PromptMention = { start: number; end: number; text: string };

/** A file travelling in `prompt.send`: the emitted reference plus, optionally, its `@` mention. */
export type PromptFileRef = AttachmentRef & { mention?: PromptMention };

/**
 * One candidate the binary detection looked at (E2, issue #85): where it came from (`source`: the
 * `openVsCode.opencodePath` setting, or the `opencode2` / `opencode` lookup in PATH), the file if
 * there was one, what happened (`outcome`) and a short text for the user. Mirrors
 * `DetectionAttempt` of the host; it is data to print, never markup.
 */
export type BinaryCheck = {
  source: 'setting' | 'opencode2' | 'opencode';
  path?: string;
  outcome:
    | 'ok'
    | 'not-on-path'
    | 'invalid'
    | 'run-failed'
    | 'unknown-version'
    | 'unsupported'
    | 'skipped'
    | 'duplicate';
  detail: string;
};

/**
 * What the failed binary detection found, so the setup guide can say what was searched and where:
 * the value of `openVsCode.opencodePath` when it was set and some attempt used it (an invalid
 * value, or a valid file that turned out to be opencode v1; absent otherwise) and every check in
 * the order it ran. Holds no port or password (architecture rule 1).
 */
export type BinaryDiagnosis = { settingPath?: string; checks: BinaryCheck[] };

/**
 * Lifecycle of the opencode server as the host sees it. `binary` is only present on an
 * `unavailable` that came from the binary detection (`binary-missing`, or `unsupported-version`
 * of a binary that answered `--version`); the `unsupported-version` found through `/api/info`
 * after the server started has none, which is how the webview tells step 1 from step 2.
 * `not-started` (issue #124) means `openVsCode.autoStart` is off and nobody asked for a server
 * yet: the chat shows a Start button and the first prompt launches it.
 */
export type ConnectionState =
  | { state: 'not-started' }
  | { state: 'starting' }
  | { state: 'connected'; serverVersion: string }
  | { state: 'reconnecting'; attempt: number; error?: ErrorInfo }
  | {
      state: 'unavailable';
      reason:
        | 'binary-missing'
        | 'unsupported-version'
        | 'no-workspace'
        | 'start-failed'
        | 'exited'
        | 'unreachable'
        | 'unauthorized'
        | 'invalid-url';
      error: ErrorInfo;
      binary?: BinaryDiagnosis;
    }
  | { state: 'stopped' };

/**
 * Setup actions of the guide and the error card (E2, issue #85, decisions P4/P14/P15): choose the
 * opencode binary with a file dialog, open the settings of the binary path or of the server
 * address, set the server password, open the install page (the npm page of `@opencode/cli`) and
 * open a folder.
 */
export type SetupAction =
  | 'binary.choose'
  | 'binary.settings'
  | 'server.settings'
  | 'server.password'
  | 'install.guide'
  | 'folder.open';

/**
 * Full state of the session the user has open. `parts` is keyed by message id.
 *
 * `compactedAt` (issue #25) is the epoch-ms `time.created` of the LAST completed compaction in the
 * messages the host read (absent when there is none). The context indicator ignores every
 * assistant message created at or before it, because a compaction replaces the earlier history in
 * the model prompt although `message.list` still lists it (VERIFIED by the planner spike, opencode
 * 2.0.32, Windows 11, 22/10/2026; not re-run here; plan line "Los mensajes previos SIGUEN
 * listados"). It only changes with a snapshot:
 * the host resyncs when `session.compaction.ended` arrives for the open session.
 *
 * `revert` (issue #32) is the revert prepared in the session, if any (`SessionInfo.revert` of the
 * row the host read, mapped by `sessionRevert.ts`). It travels inside the snapshot so that hiding
 * the reverted messages is atomic with the messages themselves; the live changes arrive as
 * `session.revert`. Absent = no revert.
 */
export type OpenSession = {
  sessionID: string;
  messages: MessageInfo[];
  parts: { [messageID: string]: Part[] };
  compactedAt?: number;
  revert?: RevertState;
};

/**
 * Every request still waiting for the user, of ANY session of the served folder. They belong to
 * the location, not to the open session: a subagent asks from its own child session, and an agent
 * left hanging on a request nobody can see is the worst failure of this feature (issues #18/#44).
 */
export type PendingAsks = {
  permissions: PermissionAsk[];
  forms: FormAsk[];
};

/**
 * Complete state replacing whatever the webview holds. The opencode v2 event stream is
 * volatile and has no replay, so the host sends one after `ready`, after each reconnection
 * and when the open session changes. `requests` is the whole pending set of the location
 * (phase 3: it used to travel inside `open`, which hid the requests of other sessions).
 * `resolutions` are the answered requests the host remembers for the OPEN session only (issues
 * #56/#18), in the order they were answered; empty when no session is open. They replace what the
 * webview held, like everything else in the snapshot. The host keeps them in memory, so they
 * survive a reconnection, a hidden view and Restart Server, but not a Reload Window.
 */
export type Snapshot = {
  sessions: SessionSummary[];
  statuses: { [sessionID: string]: SessionStatus };
  open?: OpenSession;
  requests: PendingAsks;
  resolutions: RequestResolution[];
};

/**
 * What a host command (palette or key) asks the webview to do (issue #35): `prompt.focus` puts the
 * caret in the prompt box, `session.new` runs the "New session" button and `session.stop` the
 * "Stop" button. Running the button code in the webview keeps its invariants (Send locked while a
 * request is in flight, "Stopped" announced); the host runs none of it itself.
 */
export type UiCommand = 'prompt.focus' | 'session.new' | 'session.stop';

/**
 * Messages sent by the host. `*.upserted` carry the whole object and REPLACE it (this covers
 * opencode's `text.ended`, which holds the full text); `part.delta` APPENDS to `field`.
 * `request.result` without `error` means success. The `error` of `request.result` and of `notice`
 * is an `ErrorInfo`: the host must strip the server URL and port from `message`/`detail` before
 * sending it (architecture rule 1); nothing in this module does it.
 * `permission.asked` and `form.asked` are forwarded for the sessions the surface displays, which
 * is not only the open one (a subagent asks from its own child session): a chat TAB gets those of
 * its session and its subagent lineage, the side-bar view every one of the location (issue #77 E4;
 * the host decides, `ChatController.displays`, the webview does not filter). `permission.resolved`
 * and `form.resolved` go to every surface. `ui.focus` asks the webview to bring a pending request
 * into view (phase 3).
 * `permission.resolved` and `form.resolved` carry the host's `resolution` record when the host
 * knew the request (it is absent for one it never saw asked, e.g. answered by another client
 * before the first snapshot); the webview files it in the history when the session is the open one.
 * `sessions.page` (issue #20) answers a `sessions.query`: one page of ROOT sessions of the served
 * folder, newest activity first. `append` says whether the rows continue the list (a "Show more")
 * or replace it, and `hasMore` whether another page may exist. The paging cursor never travels:
 * it embeds the folder, and the webview is untrusted input, so the host keeps it.
 * `catalog` (issues #23/#24) is the whole list of models, providers and selectable agents of the
 * server, with the model the host proposes for a new session; it REPLACES the previous catalog,
 * is re-sent after every `ready`, and is absent until the first load succeeds.
 * `session.upserted` is also what carries a change of `usage` (issue #25), sent after each step that
 * ends; nothing new flows from the webview to the host for it.
 * `session.diff` (issue #31) is the whole "Changed files" list of ONE session and REPLACES what the
 * webview holds for it; the webview keeps it only if `sessionID` is the open session. `error` says
 * the host could not refresh the list: `files` then is the last list it had (possibly empty).
 * `ui.command` (issue #35) is a palette or keyboard command of the host, relayed so the webview runs
 * the SAME code as the matching button ({@link UiCommand}); it is a one-shot action, never state,
 * so the host must not repeat one the webview already received.
 * `prompt.compose` (issue #36, "Explain with OpenCode" and "Fix with OpenCode" of the editor and
 * Explorer menus) hands the webview a prompt the HOST wrote, with the references the host emitted
 * for it (they are already in its `pickedUris` whitelist). With `send` the webview sends it with
 * the same code as the Send button, leaving the user's draft untouched; when it cannot (not
 * connected, a request in flight, a busy session) or `send` is false it puts text and chips in the
 * prompt box instead, never losing the text (a compose that was sent and then fails is appended to
 * the draft too). Exceptions, on purpose: chips the host refused with `AttachmentRejected` do not
 * come back, past `MAX_KEPT_COMPOSES` waiting in a hidden pane the oldest is dropped, and a compose
 * out of bounds is refused whole (`ComposeRefused`). Like `ui.command` it is a one-shot action,
 * never state.
 * Check {@link isComposeInBounds} before acting on one.
 * `session.revert` (issue #32) REPLACES the revert the webview holds for ONE session; the webview
 * keeps it only if `sessionID` is the open session, and an absent `revert` means "no revert" (it
 * was restored, discarded for good, or never existed). The host sends it when a revert is prepared
 * or cleared; a committed one is announced by a fresh `snapshot` instead, never by an empty
 * `session.revert` first (the hidden messages would flash back for an instant).
 * `setup.binary` (E2, issue #86) answers ONLY the pane that sent `setup.action` `binary.choose`:
 * `chosen` carries the path the user picked (shown as plain text; it is not a secret, a port or a
 * password) and is sent BEFORE the setting is written, so it always precedes the `connection.state`
 * the new detection produces; `cancelled` (dialog closed) and `failed` (the file dialog was
 * rejected or the setting could not be written) carry no path and give the guide its button back.
 */
export type HostToWebview =
  | { type: 'connection.state'; connection: ConnectionState }
  | { type: 'catalog'; catalog: Catalog }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'session.upserted'; session: SessionSummary }
  | { type: 'session.removed'; sessionID: string }
  | { type: 'session.status'; sessionID: string; status: SessionStatus }
  | { type: 'message.upserted'; sessionID: string; message: MessageInfo }
  | { type: 'message.removed'; sessionID: string; messageID: string }
  | { type: 'part.upserted'; sessionID: string; messageID: string; part: Part }
  | {
      type: 'part.delta';
      sessionID: string;
      messageID: string;
      partID: string;
      field: 'text' | 'input';
      delta: string;
    }
  | { type: 'permission.asked'; permission: PermissionAsk }
  | {
      type: 'permission.resolved';
      sessionID: string;
      permissionID: string;
      decision: PermissionDecision;
      resolution?: RequestResolution;
    }
  | { type: 'form.asked'; form: FormAsk }
  | {
      type: 'form.resolved';
      sessionID: string;
      formID: string;
      outcome: 'answered' | 'cancelled';
      resolution?: RequestResolution;
    }
  | { type: 'request.result'; requestId: string; error?: ErrorInfo }
  | {
      type: 'sessions.page';
      requestId: string;
      search: string;
      sessions: SessionSummary[];
      append: boolean;
      hasMore: boolean;
    }
  | { type: 'attachments.picked'; requestId: string; files: AttachmentRef[] }
  | {
      type: 'files.found';
      requestId: string;
      query: string;
      files: AttachmentRef[];
      error?: ErrorInfo;
    }
  | { type: 'ui.focus'; target: { kind: 'permission' | 'form'; sessionID: string; id: string } }
  | { type: 'ui.command'; command: UiCommand }
  | { type: 'prompt.compose'; text: string; files: AttachmentRef[]; send: boolean }
  | { type: 'session.diff'; sessionID: string; files: ChangedFile[]; error?: ErrorInfo }
  | { type: 'session.revert'; sessionID: string; revert?: RevertState }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; error: ErrorInfo }
  | { type: 'setup.binary'; outcome: 'cancelled' | 'failed' }
  | { type: 'setup.binary'; outcome: 'chosen'; path: string };

/**
 * Messages sent by the webview. `requestId` is generated by the webview (shared has no
 * `crypto`) and echoed by the host in `request.result`. `delivery` is mandatory on
 * `prompt.send` because opencode's default (`steer`) injects the prompt into the running turn.
 * `server.restart` and `logs.show` (phase 3, issue #10) have no `requestId`: the outcome of a
 * restart is the connection state, and the log channel has nothing to answer. `setup.action`
 * (E2, issue #85) is the same: a button of the setup guide or the error card, whose outcome is the
 * next `connection.state` (a failure to write the setting arrives as a `notice`).
 * `attachments.pick` may carry `kind: 'image'` (decision P11): the host's dialog then filters by
 * image extensions; absent or `file` is the plain picker.
 * `session.new` is LAZY (issue #20, decision of 21/10/2026): it creates nothing on the server, it
 * only makes the host forget the open session so the view is empty; the first `prompt.send`
 * without `sessionID` creates the session. `sessions.query` asks for a page of the session list
 * (`more` continues the previous query of the same `search`; the host owns the cursor), and the
 * answer is `sessions.page`. `session.rename` and `session.delete` act on one session; the host
 * validates the title again and asks the user for confirmation on a delete with a native modal,
 * because an irreversible operation is authorised by the policy boundary, not by the webview.
 * `session.fork` (issue #21) asks for a new root session holding the history BEFORE `messageID`
 * (a user message): there is no dedicated answer, the result arrives as a `session.upserted` for
 * the new row, a `snapshot` of it and the usual `request.result`.
 * `prompt.send` may carry the EFFECTIVE `model` and `agent` the user chose (issues #23/#24, decision
 * of 21/10/2026: the choice is a draft in the webview and is applied ON SEND). The host validates
 * both against its catalog before touching the server, because opencode accepts any agent or model
 * on `switchAgent` / `switchModel` and only fails the next turn (VERIFIED, spike, opencode 2.0.32).
 * Absent means "leave the session as it is" (the server defaults for a new one).
 * `files.search` (issue #28) asks the host for workspace files matching what follows an `@` in
 * the prompt; the answer is `files.found` (NOT a `request.result`: it carries its own error, and a
 * search must not lock the prompt). The webview debounces and only accepts the answer to its LAST
 * request. `attachments.fromEditor` (issue #29) asks for the active file, or each non-empty
 * selection of it with its line range, only when that file is inside the served folder (else a
 * `request.result` error `OutsideWorkspace`); the answer is `attachments.picked` plus the usual
 * `request.result`. `prompt.send` files may carry a `mention` (see {@link PromptMention}).
 * The host builds every `uri` itself, so the webview can only send back what it was given.
 * `attachments.drop` (issue #30) carries the URI strings VS Code put in `resourceurls` when the user
 * dropped files from the Explorer. They are untrusted text, not a gesture the host sees: the host
 * keeps only regular files of the served folder that `file.find` also lists, and answers with
 * `attachments.picked`, `request.result` and, for what it dropped, one `notice`.
 * `attachments.image` (issue #30) carries ONE pasted image as base64 (`mime` is only a claim: the
 * host detects the type from the bytes). The host keeps the bytes under an opaque
 * `pasted-image:<n>` `uri` it returns in `attachments.picked`; `prompt.send` echoes that `uri`
 * and the host puts the data in the prompt, so the bytes never travel twice. `attachments.forget`
 * (decision of 23/10/2026) tells the host the user removed the chip of that `uri`, so it frees the
 * image; it has no `requestId` and no answer, and a `uri` the host did not issue is ignored.
 * `session.diff.open` (issue #31) asks the host to open the native diff editor for one row of the
 * "Changed files" list. It has no `requestId`, like `editor.open`: a failure is a `notice`. `path`
 * is the `ChangedFile.path` the host sent; the host opens it only if it listed that path for that
 * session, so the webview cannot name a file of its own.
 * `chat.focusChanged` (issue #35) tells the host whether the webview document has the keyboard focus
 * (`focus`/`blur` of its window, plus the value after `ready`). The host only mirrors it into the
 * `openVsCode.chatFocused` context key, which a `when` clause cannot get from `focusedView`
 * because the webview is an iframe outside the view's own element.
 * `session.revert.stage`, `.clear` and `.commit` (issue #32) prepare a revert from a user message
 * (the history from it on is hidden and the files the agent touched after it are put back on
 * disk), restore it, or make it permanent. They carry a `requestId` and are answered by
 * `request.result`; the new state arrives as `session.revert` (or a `snapshot` after a commit). The
 * host, not the webview, validates that `messageID` is a user message of the open session and asks
 * the user to confirm a commit with a native modal. `session.revert.open` opens the diff of what a
 * prepared revert undid in one file (left: the text before the revert, right: the file on disk); it
 * has no `requestId`, like `session.diff.open`, and `path` must be one the host listed in the
 * `RevertState` it sent.
 * `prompt.send` may carry `command` (issue #33): the name of a slash command of the catalog, without
 * the `/`. The prompt is then RUN as that command: `text` holds only the arguments (it may be
 * empty), the host calls `session.command` instead of `session.prompt`, and the files travel
 * without their `mention` because the command template rewrites the text. The host checks the
 * name against its own catalog and answers `CommandUnavailable` for one it does not list.
 * `session.compact` (issue #125) asks the host to compact the open session; it is answered by
 * `request.result`, and the progress arrives as `message.upserted` notices.
 */
export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'session.new'; requestId: string }
  | { type: 'session.open'; requestId: string; sessionID: string }
  | { type: 'sessions.query'; requestId: string; search: string; more: boolean }
  | { type: 'session.rename'; requestId: string; sessionID: string; title: string }
  | { type: 'session.delete'; requestId: string; sessionID: string }
  | { type: 'session.fork'; requestId: string; sessionID: string; messageID: string }
  | {
      type: 'prompt.send';
      requestId: string;
      sessionID?: string;
      text: string;
      delivery: 'steer' | 'queue';
      files: PromptFileRef[];
      model?: ModelRef;
      agent?: string;
      command?: string;
    }
  | { type: 'session.abort'; requestId: string; sessionID: string }
  | { type: 'session.compact'; requestId: string; sessionID: string }
  | {
      type: 'permission.reply';
      requestId: string;
      sessionID: string;
      permissionID: string;
      decision: PermissionDecision;
      message?: string;
    }
  | { type: 'form.reply'; requestId: string; sessionID: string; formID: string; answer: FormAnswer }
  | { type: 'form.cancel'; requestId: string; sessionID: string; formID: string; message?: string }
  | { type: 'attachments.pick'; requestId: string; kind?: 'file' | 'image' }
  | { type: 'attachments.fromEditor'; requestId: string }
  | { type: 'attachments.drop'; requestId: string; uris: string[] }
  | { type: 'attachments.image'; requestId: string; mime: string; data: string }
  | { type: 'attachments.forget'; uri: string }
  | { type: 'files.search'; requestId: string; query: string }
  | { type: 'permissions.manage' }
  | { type: 'server.restart' }
  | { type: 'logs.show' }
  | { type: 'setup.action'; action: SetupAction }
  | { type: 'editor.open'; path: string; line?: number; column?: number }
  | { type: 'session.diff.open'; sessionID: string; path: string }
  | { type: 'session.revert.stage'; requestId: string; sessionID: string; messageID: string }
  | { type: 'session.revert.clear'; requestId: string; sessionID: string }
  | { type: 'session.revert.commit'; requestId: string; sessionID: string }
  | { type: 'session.revert.open'; sessionID: string; path: string }
  | { type: 'editor.insert'; text: string }
  | { type: 'editor.newFile'; text: string; language?: string }
  | { type: 'clipboard.write'; text: string }
  | { type: 'webview.log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'chat.focusChanged'; focused: boolean };

/** Posts one message of union `M` to the other side. The concrete binding is issue #2. */
export type Sender<M extends { type: string }> = (message: M) => void;

/** One handler per `type` of `M`; leaving one out is a compile error. */
export type Handlers<M extends { type: string }> = {
  [K in M['type']]: (message: Extract<M, { type: K }>) => void;
};

/**
 * Calls the handler registered for `message.type`.
 *
 * Exhaustiveness is checked by the `Handlers` type at compile time. Callers must validate
 * `message` with the matching guard first: an unknown `type` would throw a TypeError here.
 * VERIFIED by unit tests (fabricated messages, Windows 11, vitest 5.0.5).
 */
export function dispatch<M extends { type: string }>(message: M, handlers: Handlers<M>): void {
  // TypeScript cannot correlate `message.type` with the handler of that exact key,
  // hence the single assertion; the Handlers type is what guarantees it is sound.
  const handler = handlers[message.type as M['type']] as (message: M) => void;
  handler(message);
}

/**
 * Id of a `text` or `reasoning` block, which opencode v2 does not identify: `${messageID}#${index}`,
 * `index` being the block position in the message `content[]`.
 *
 * Snapshot (REST index) and stream (host counter = `content.length` at `*.started`) yield the
 * same id because the core projector only appends blocks and never removes or reorders them.
 * VERIFIED for one message with a reasoning block and a text block against a real opencode
 * 2.0.32 (Windows 11, 20/10/2026, planner spike): the stream opened them in `[reasoning, text]`
 * order (`text.started` even before `reasoning.ended`) and REST `content[]` came back in that
 * same order, so index 0 and 1 match. HYPOTHESIS with tool blocks interleaved (not observed).
 * If a version reorders blocks, the host adapter (#14) must refetch the message by REST. The
 * counter lives in that adapter (`eventTranslator.ts`).
 */
export function contentPartId(messageID: string, index: number): string {
  return `${messageID}#${index}`;
}

// ---------------------------------------------------------------------------
// Runtime guards
// ---------------------------------------------------------------------------

type PlainObject = { [key: string]: unknown };

/** Field validator: receives the already-checked object holding the message. */
type Validator = (value: PlainObject) => boolean;

/**
 * True for a plain JSON-like object: prototype is `Object.prototype` or `null`.
 *
 * Rejects arrays, `Date`, `Map`, class instances and `Object.create(x)` objects, none of which
 * survive a JSON round trip. Whether the VS Code webview-to-host transport is JSON or structured
 * clone is UNVERIFIED (issue #2), so the guard does not rely on the transport to strip them.
 */
function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Reads `key` only if it is an OWN property, so inherited fields never validate a message.
 * May throw if the property is a throwing getter; `isWebviewToHost` catches that.
 */
function field(object: PlainObject, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/** True for a string, including the empty one. */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** True for a string with at least one character; used for ids, which are never meaningful empty. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * True for a safe integer >= 1.
 *
 * Lines and columns are 1-based in this protocol (the host converts to VS Code's 0-based
 * positions). `isSafeInteger` bounds the value: 1e308 and 2^60 are integers but not safe.
 */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * True for a real array with no holes (`[ , ]` is rejected), so `for..of` on the host never
 * sees `undefined` where the type promises an element.
 */
function isDenseArray(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    Array.from({ length: value.length }, (_, i) => i in value).every(Boolean)
  );
}

/** True when `value` is absent (`undefined`) or passes `check`. */
function isOptional(value: unknown, check: (v: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

/** Builds an enum check from a closed list of strings; inherited keys like `toString` do not match. */
function isOneOf(options: readonly string[]): (value: unknown) => boolean {
  return (value) => typeof value === 'string' && options.includes(value);
}

const isDecision = isOneOf(['once', 'always', 'reject']);
const isDelivery = isOneOf(['steer', 'queue']);
const isLogLevel = isOneOf(['info', 'warn', 'error']);
const isSetupAction = isOneOf([
  'binary.choose',
  'binary.settings',
  'server.settings',
  'server.password',
  'install.guide',
  'folder.open',
] satisfies SetupAction[]);

/** True for `{ uri, name }` with both non-empty: an unnamed attachment cannot be shown to the user. */
function isAttachmentRef(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(field(value, 'uri')) &&
    isNonEmptyString(field(value, 'name'))
  );
}

/**
 * True for a `mention` the host could forward: a plain object with integer offsets
 * `0 <= start <= end` and a non-empty `text`. That the text really is `prompt.text.slice(start,
 * end)` needs the prompt text, so it is the host handler's check (`sendPrompt`).
 */
function isPromptMention(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const start = field(value, 'start');
  const end = field(value, 'end');
  return (
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    end >= start &&
    isNonEmptyString(field(value, 'text'))
  );
}

/** True for an attachment ref with an optional, well-formed `mention`. */
function isPromptFileRef(value: unknown): boolean {
  return (
    isAttachmentRef(value) &&
    isPlainObject(value) &&
    isOptional(field(value, 'mention'), isPromptMention)
  );
}

/** True for a hole-free array of valid prompt file refs (an empty list is valid). */
function isAttachmentList(value: unknown): boolean {
  return isDenseArray(value) && value.every(isPromptFileRef);
}

/**
 * Form answers are flat: string, finite number, boolean or a hole-free list of strings. No nesting.
 * The answer itself must be a plain object, so a `Date` or `Map` is rejected.
 */
function isFormAnswer(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(
    (entry) =>
      isString(entry) ||
      typeof entry === 'boolean' ||
      (typeof entry === 'number' && Number.isFinite(entry)) ||
      (isDenseArray(entry) && entry.every(isString)),
  );
}

/**
 * True for a model reference the host could apply: a plain object with non-empty `providerID` and
 * `id`, and an optional non-empty `variant`. Whether it EXISTS is the host's catalog check.
 */
function isModelRef(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(field(value, 'providerID')) &&
    isNonEmptyString(field(value, 'id')) &&
    isOptional(field(value, 'variant'), isNonEmptyString)
  );
}

/** True for a boolean. */
function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/** True for a string of at most `max` characters; the empty string passes (an empty search means "all"). */
function isStringUpTo(value: unknown, max: number): boolean {
  return isString(value) && value.length <= max;
}

/**
 * True for a title the host would accept: not blank after trimming, at most
 * `MAX_SESSION_TITLE_LENGTH` once trimmed. Blank is refused because the server answers an empty
 * title by running the LLM title generator instead of clearing it (VERIFIED, issue #20 spike).
 */
function isSessionTitle(value: unknown): boolean {
  if (!isString(value)) return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_SESSION_TITLE_LENGTH;
}

/** Message with no payload beyond `type`. */
const noFields: Validator = () => true;

/** Validator for messages that carry only a `requestId`. */
const requestOnly: Validator = (m) => isNonEmptyString(field(m, 'requestId'));

/**
 * True for a slash command name the host would look up (issue #33): not empty, no leading or
 * trailing whitespace, no `NUL`, at most `MAX_COMMAND_NAME_LENGTH`. Inner spaces are allowed on
 * purpose: names come from file paths, which may contain them.
 */
function isCommandName(value: unknown): boolean {
  return (
    isString(value) &&
    value.length > 0 &&
    value.length <= MAX_COMMAND_NAME_LENGTH &&
    value === value.trim() &&
    !value.includes('\0')
  );
}

/**
 * A `prompt.send` must carry something: non-blank text, at least one attachment, or a `command`
 * (issue #33: `/init` alone is a whole prompt, its arguments are empty).
 */
const hasPromptContent: Validator = (m) => {
  const text = field(m, 'text');
  const files = field(m, 'files');
  return (
    (isString(text) && text.trim().length > 0) ||
    (Array.isArray(files) && files.length > 0) ||
    field(m, 'command') !== undefined
  );
};

/**
 * Shape of `session.diff.open` and `session.revert.open`: a session id and a `path` of at most
 * `MAX_DIFF_PATH_LENGTH` characters without `NUL`. That the path is one the host listed is the
 * handler's check, not this guard's.
 */
const isDiffOpen: Validator = (m) => {
  const path = field(m, 'path');
  return (
    isNonEmptyString(field(m, 'sessionID')) &&
    isNonEmptyString(path) &&
    path.length <= MAX_DIFF_PATH_LENGTH &&
    !path.includes('\0')
  );
};

/**
 * One validator per webview-to-host `type`. The `Record` key type makes it exhaustive: adding a
 * member to `WebviewToHost` without its validator is a compile error.
 */
const WEBVIEW_VALIDATORS: Record<WebviewToHost['type'], Validator> = {
  ready: noFields,
  'session.new': requestOnly,
  'session.open': (m) =>
    isNonEmptyString(field(m, 'requestId')) && isNonEmptyString(field(m, 'sessionID')),
  'sessions.query': (m) =>
    isNonEmptyString(field(m, 'requestId')) &&
    isStringUpTo(field(m, 'search'), MAX_SESSION_SEARCH_LENGTH) &&
    isBoolean(field(m, 'more')),
  'session.rename': (m) =>
    isNonEmptyString(field(m, 'requestId')) &&
    isNonEmptyString(field(m, 'sessionID')) &&
    isSessionTitle(field(m, 'title')),
  'session.delete': (m) =>
    isNonEmptyString(field(m, 'requestId')) && isNonEmptyString(field(m, 'sessionID')),
  'session.fork': (m) =>
    isNonEmptyString(field(m, 'requestId')) &&
    isNonEmptyString(field(m, 'sessionID')) &&
    isNonEmptyString(field(m, 'messageID')),
  'prompt.send': (m) =>
    isNonEmptyString(field(m, 'requestId')) &&
    isOptional(field(m, 'sessionID'), isNonEmptyString) &&
    isString(field(m, 'text')) &&
    isDelivery(field(m, 'delivery')) &&
    isAttachmentList(field(m, 'files')) &&
    isOptional(field(m, 'model'), isModelRef) &&
    isOptional(field(m, 'agent'), isNonEmptyString) &&
    isOptional(field(m, 'command'), isCommandName) &&
    hasPromptContent(m),
  'session.abort': (m) =>
    isNonEmptyString(field(m, 'requestId')) && isNonEmptyString(field(m, 'sessionID')),
  'session.compact': (m) =>
    isNonEmptyString(field(m, 'requestId')) && isNonEmptyString(field(m, 'sessionID')),
  'permission.reply': (m) =>
    isNonEmptyString(field(m, 'requestId')) &&
    isNonEmptyString(field(m, 'sessionID')) &&
    isNonEmptyString(field(m, 'permissionID')) &&
    isDecision(field(m, 'decision')) &&
    isOptional(field(m, 'message'), isString),
  'form.reply': (m) =>
    isNonEmptyString(field(m, 'requestId')) &&
    isNonEmptyString(field(m, 'sessionID')) &&
    isNonEmptyString(field(m, 'formID')) &&
    isFormAnswer(field(m, 'answer')),
  'form.cancel': (m) =>
    isNonEmptyString(field(m, 'requestId')) &&
    isNonEmptyString(field(m, 'sessionID')) &&
    isNonEmptyString(field(m, 'formID')) &&
    isOptional(field(m, 'message'), isString),
  // `kind` (E2, decision P11): absent means a plain file; `image` filters the dialog to images.
  'attachments.pick': (m) =>
    isNonEmptyString(field(m, 'requestId')) &&
    isOptional(field(m, 'kind'), isOneOf(['file', 'image'])),
  'attachments.fromEditor': requestOnly,
  'attachments.drop': (m) => {
    const uris = field(m, 'uris');
    return (
      isNonEmptyString(field(m, 'requestId')) &&
      isDenseArray(uris) &&
      uris.length >= 1 &&
      uris.length <= MAX_DROPPED_ITEMS &&
      uris.every(
        (uri) =>
          isNonEmptyString(uri) && uri.length <= MAX_DROPPED_URI_LENGTH && !uri.includes('\0'),
      )
    );
  },
  'attachments.image': (m) => {
    const data = field(m, 'data');
    return (
      isNonEmptyString(field(m, 'requestId')) &&
      isOneOf(IMAGE_MIMES)(field(m, 'mime')) &&
      isNonEmptyString(data) &&
      data.length <= MAX_IMAGE_BASE64_LENGTH
    );
  },
  'attachments.forget': (m) => {
    const uri = field(m, 'uri');
    return isNonEmptyString(uri) && uri.length <= MAX_DROPPED_URI_LENGTH;
  },
  // An empty query has nothing to search for (the server answers `[]` to it anyway), so it is
  // refused here instead of costing a round trip.
  'files.search': (m) => {
    const query = field(m, 'query');
    return (
      isNonEmptyString(field(m, 'requestId')) &&
      isNonEmptyString(query) &&
      query.length <= MAX_FILE_SEARCH_LENGTH
    );
  },
  'permissions.manage': noFields,
  'server.restart': noFields,
  'logs.show': noFields,
  'setup.action': (m) => isSetupAction(field(m, 'action')),
  'editor.open': (m) =>
    isNonEmptyString(field(m, 'path')) &&
    isOptional(field(m, 'line'), isPositiveInteger) &&
    isOptional(field(m, 'column'), isPositiveInteger),
  // Only the shape: that the path is one the host listed for that session is the handler's check.
  'session.diff.open': isDiffOpen,
  'session.revert.stage': (m) =>
    isNonEmptyString(field(m, 'requestId')) &&
    isNonEmptyString(field(m, 'sessionID')) &&
    isNonEmptyString(field(m, 'messageID')),
  'session.revert.clear': (m) =>
    isNonEmptyString(field(m, 'requestId')) && isNonEmptyString(field(m, 'sessionID')),
  'session.revert.commit': (m) =>
    isNonEmptyString(field(m, 'requestId')) && isNonEmptyString(field(m, 'sessionID')),
  'session.revert.open': isDiffOpen,
  'editor.insert': (m) => isString(field(m, 'text')),
  'editor.newFile': (m) => isString(field(m, 'text')) && isOptional(field(m, 'language'), isString),
  // An empty string is a legitimate clipboard write (clears it), unlike an empty prompt.
  'clipboard.write': (m) => isString(field(m, 'text')),
  'webview.log': (m) => isLogLevel(field(m, 'level')) && isString(field(m, 'message')),
  'chat.focusChanged': (m) => isBoolean(field(m, 'focused')),
};

/**
 * Exhaustive set of host-to-webview `type`s. A `Record<..., true>` (not an array) so that a new
 * union member without an entry fails to compile.
 */
const HOST_TYPE_SET: Record<HostToWebview['type'], true> = {
  'connection.state': true,
  catalog: true,
  snapshot: true,
  'session.upserted': true,
  'session.removed': true,
  'session.status': true,
  'message.upserted': true,
  'message.removed': true,
  'part.upserted': true,
  'part.delta': true,
  'permission.asked': true,
  'permission.resolved': true,
  'form.asked': true,
  'form.resolved': true,
  'request.result': true,
  'sessions.page': true,
  'attachments.picked': true,
  'files.found': true,
  'ui.focus': true,
  'ui.command': true,
  'prompt.compose': true,
  'session.diff': true,
  'session.revert': true,
  notice: true,
  'setup.binary': true,
};

/** Every `type` the host may send; derived from the exhaustive record, so it cannot drift. */
export const HOST_TO_WEBVIEW_TYPES = Object.keys(HOST_TYPE_SET) as HostToWebview['type'][];

/** Every `type` the webview may send; derived from the exhaustive validators. */
export const WEBVIEW_TO_HOST_TYPES = Object.keys(WEBVIEW_VALIDATORS) as WebviewToHost['type'][];

/**
 * True when a `prompt.compose` could become a valid `prompt.send`: non-blank `text` and at most
 * {@link MAX_DROPPED_ITEMS} files with a non-empty `uri` and `name`.
 *
 * Why it exists: {@link isHostToWebview} is shallow on purpose, and a `prompt.send` that breaks its
 * validator is dropped by the host with NO `request.result`, which would leave the request pending
 * and Send locked (`solid-webview` §3). The webview calls this BEFORE `begin`. The cap is the one
 * of `attachments.drop` (our choice, issue #36: the host never composes more than one drop's worth);
 * there is no text cap because `prompt.send` has none.
 * VERIFIED by `protocol.test.ts` (fabricated messages, Windows 11, 29/10/2026).
 */
export function isComposeInBounds(message: {
  text: string;
  files: readonly AttachmentRef[];
}): boolean {
  return (
    message.text.trim().length > 0 &&
    message.files.length <= MAX_DROPPED_ITEMS &&
    message.files.every((file) => file.uri !== '' && file.name !== '')
  );
}

/**
 * Deep guard for messages arriving at the host from the webview.
 *
 * Why deep: the webview renders LLM markdown, so it is untrusted input, and the host is the
 * policy boundary. Checks every field and enum of the message and rejects unknown `type` values.
 * Hardened against non-JSON shapes: only OWN properties are read, objects must be plain
 * (prototype `Object.prototype` or `null`), arrays must have no holes, and a getter that throws
 * makes the guard return `false` instead of propagating. Empty strings are rejected where they
 * are meaningless (ids, attachment names, a `prompt.send` with blank text and no files).
 * It does NOT check path policy, existence of ids or sizes: those are the host handler's job.
 * Contract for the host: after this guard passes, read fields ONE BY ONE; never spread the
 * message into SDK calls, because unknown extra properties are not rejected.
 * VERIFIED by unit tests with fabricated messages (Windows 11, vitest 5.0.5); how real
 * `postMessage` payloads behave is UNVERIFIED until issue #2 wires the transport.
 */
export function isWebviewToHost(value: unknown): value is WebviewToHost {
  try {
    if (!isPlainObject(value)) return false;
    const type = field(value, 'type');
    if (typeof type !== 'string' || !Object.hasOwn(WEBVIEW_VALIDATORS, type)) return false;
    const validate = WEBVIEW_VALIDATORS[type as WebviewToHost['type']];
    return validate(value);
  } catch {
    return false;
  }
}

/**
 * Shallow guard for messages arriving at the webview from the host: object with a known `type`.
 *
 * Why shallow: the host is our own typed code, and deep-validating each `part.delta` at
 * streaming rate (tens of Hz) costs CPU without protecting against anything an XSS in the
 * webview could not already do. Consequence: a malformed message from a host bug is NOT
 * rejected here and will reach the reducer. Do not "fix" this without deciding the trade-off.
 */
export function isHostToWebview(value: unknown): value is HostToWebview {
  if (!isPlainObject(value)) return false;
  const type = field(value, 'type');
  return typeof type === 'string' && Object.hasOwn(HOST_TYPE_SET, type);
}
