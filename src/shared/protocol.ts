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
  ErrorInfo,
  FormAnswer,
  FormAsk,
  MessageInfo,
  ModelRef,
  Part,
  PermissionAsk,
  PermissionDecision,
  RequestResolution,
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

/** File picked by the user. Produced by the host (`attachments.picked`) and echoed back in `prompt.send`. */
export type AttachmentRef = { uri: string; name: string };

/** Lifecycle of the opencode server as the host sees it. */
export type ConnectionState =
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
    }
  | { state: 'stopped' };

/** Full state of the session the user has open. `parts` is keyed by message id. */
export type OpenSession = {
  sessionID: string;
  messages: MessageInfo[];
  parts: { [messageID: string]: Part[] };
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
 * Messages sent by the host. `*.upserted` carry the whole object and REPLACE it (this covers
 * opencode's `text.ended`, which holds the full text); `part.delta` APPENDS to `field`.
 * `request.result` without `error` means success. The `error` of `request.result` and of `notice`
 * is an `ErrorInfo`: the host must strip the server URL and port from `message`/`detail` before
 * sending it (architecture rule 1); nothing in this module does it.
 * `permission.*` and `form.*` are forwarded for EVERY session of the location, not only the open
 * one, and `ui.focus` asks the webview to bring a pending request into view (phase 3).
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
  | { type: 'ui.focus'; target: { kind: 'permission' | 'form'; sessionID: string; id: string } }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; error: ErrorInfo };

/**
 * Messages sent by the webview. `requestId` is generated by the webview (shared has no
 * `crypto`) and echoed by the host in `request.result`. `delivery` is mandatory on
 * `prompt.send` because opencode's default (`steer`) injects the prompt into the running turn.
 * `server.restart` and `logs.show` (phase 3, issue #10) have no `requestId`: the outcome of a
 * restart is the connection state, and the log channel has nothing to answer.
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
      files: AttachmentRef[];
      model?: ModelRef;
      agent?: string;
    }
  | { type: 'session.abort'; requestId: string; sessionID: string }
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
  | { type: 'attachments.pick'; requestId: string }
  | { type: 'permissions.manage' }
  | { type: 'server.restart' }
  | { type: 'logs.show' }
  | { type: 'editor.open'; path: string; line?: number; column?: number }
  | { type: 'editor.insert'; text: string }
  | { type: 'editor.newFile'; text: string; language?: string }
  | { type: 'clipboard.write'; text: string }
  | { type: 'webview.log'; level: 'info' | 'warn' | 'error'; message: string };

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

/** True for `{ uri, name }` with both non-empty: an unnamed attachment cannot be shown to the user. */
function isAttachmentRef(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isNonEmptyString(field(value, 'uri')) &&
    isNonEmptyString(field(value, 'name'))
  );
}

/** True for a hole-free array of valid attachment refs (an empty list is valid). */
function isAttachmentList(value: unknown): boolean {
  return isDenseArray(value) && value.every(isAttachmentRef);
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

/** A `prompt.send` must carry something: non-blank text or at least one attachment. */
const hasPromptContent: Validator = (m) => {
  const text = field(m, 'text');
  const files = field(m, 'files');
  return (isString(text) && text.trim().length > 0) || (Array.isArray(files) && files.length > 0);
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
    hasPromptContent(m),
  'session.abort': (m) =>
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
  'attachments.pick': requestOnly,
  'permissions.manage': noFields,
  'server.restart': noFields,
  'logs.show': noFields,
  'editor.open': (m) =>
    isNonEmptyString(field(m, 'path')) &&
    isOptional(field(m, 'line'), isPositiveInteger) &&
    isOptional(field(m, 'column'), isPositiveInteger),
  'editor.insert': (m) => isString(field(m, 'text')),
  'editor.newFile': (m) => isString(field(m, 'text')) && isOptional(field(m, 'language'), isString),
  // An empty string is a legitimate clipboard write (clears it), unlike an empty prompt.
  'clipboard.write': (m) => isString(field(m, 'text')),
  'webview.log': (m) => isLogLevel(field(m, 'level')) && isString(field(m, 'message')),
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
  'ui.focus': true,
  notice: true,
};

/** Every `type` the host may send; derived from the exhaustive record, so it cannot drift. */
export const HOST_TO_WEBVIEW_TYPES = Object.keys(HOST_TYPE_SET) as HostToWebview['type'][];

/** Every `type` the webview may send; derived from the exhaustive validators. */
export const WEBVIEW_TO_HOST_TYPES = Object.keys(WEBVIEW_VALIDATORS) as WebviewToHost['type'][];

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
