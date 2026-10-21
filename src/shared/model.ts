/**
 * Domain types shared by the extension host and the webview (issue #3).
 *
 * This file is PURE: no `vscode`, no DOM, no Node and no `@opencode/client` imports.
 * `types: []` in `src/shared/tsconfig.json` blocks ambient globals; the neutrality test
 * (`neutrality.test.ts`, plus the ESLint rule of issue #4) blocks package imports. The
 * shapes are semantic and wire-independent: the host adapter (issues #9/#14) translates
 * opencode v2 events into these types, so the webview never sees a `V2Event`.
 *
 * Provenance: the shapes were derived by reading `types.d.ts` of `@opencode/client@2.0.32`
 * and the code at tag v2.0.32 (20/10/2026). HYPOTHESIS: none of them has been observed
 * against a running opencode server; if issues #8/#9 see another shape, the change should
 * stay inside the host adapter.
 */

/** Any JSON value; used where opencode sends free-form data (tool input, metadata). */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A JSON object. */
export type JsonObject = { [key: string]: JsonValue };

/**
 * Error shown to the user. `code` is the opencode `_tag` when it comes from the server, or ours.
 *
 * `message` and `detail` are a free-text channel to the webview. The host MUST strip the server
 * URL, port and any credential from them before sending (architecture rule 1): client transport
 * errors can embed `http://127.0.0.1:PORT`. No field of this type is sanitized here.
 */
export type ErrorInfo = { code: string; message: string; detail?: string };

/**
 * Provider/model pair as opencode names it. `id` is the CATALOG id (`ModelInfo.id`), not the
 * provider's API model id. An absent `variant` means "default": the host normalizes the
 * `variant: "default"` the server echoes back (VERIFIED, issue #23 spike, opencode 2.0.32,
 * Windows 11, 21/10/2026).
 */
export type ModelRef = { providerID: string; id: string; variant?: string };

/**
 * One model of the catalog the user can pick (issue #23), as the host maps `ModelInfo` of
 * `GET /api/model`. `free` is true when every cost entry is zero for both input and output.
 * `contextLimit` is `limit.context` in tokens. The server only lists ENABLED models of AVAILABLE
 * providers, in its own order (newest first, free ones first when no session is started).
 * VERIFIED shape against a real opencode 2.0.32 (issue #23 spike, Windows 11, 21/10/2026: ten
 * models, all of provider `opencode`, all free); a paid provider was never listed (no credentials).
 */
export type ModelOption = {
  providerID: string;
  id: string;
  name: string;
  status: 'alpha' | 'beta' | 'deprecated' | 'active';
  contextLimit: number;
  free: boolean;
  variants: string[];
};

/** Provider that owns some models of the catalog (`GET /api/provider`, available ones only). */
export type ProviderOption = { id: string; name: string };

/**
 * Agent the user can choose (issue #24): only the SELECTABLE ones (`mode !== "subagent"` and not
 * `hidden`, the filter of opencode's own `agent.ts` at v2.0.32). `id` ("build") is what a session
 * and `switchAgent` use; `name` ("Build") is only a label.
 */
export type AgentOption = { id: string; name: string; description?: string };

/**
 * What the host knows about the server's models and agents (issues #23/#24), pushed to the
 * webview in the `catalog` message and replaced whole whenever it reloads.
 *
 * `serverDefault` is `model.default()` (the config `model` if enabled, else the first available);
 * `defaultAgent` is the first of `agent.list()` (the server puts the default first);
 * `preferredModel` is what the host proposes for a NEW session after applying the precedence
 * `openVsCode.defaultModel` setting > last used model > nothing (then the server default applies).
 * It is always one of `models`. Provenance: VERIFIED against a real opencode 2.0.32 (issue
 * #23/#24 spike, Windows 11, 21/10/2026); the server never validates a model or agent choice, so
 * the host checks against this very catalog before applying one.
 */
export type Catalog = {
  models: ModelOption[];
  providers: ProviderOption[];
  agents: AgentOption[];
  serverDefault?: ModelRef;
  defaultAgent?: string;
  preferredModel?: ModelRef;
};

/** Token counters of one assistant message. */
export type TokenUsage = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

/**
 * Row of the session list. Timestamps are epoch milliseconds.
 *
 * `parentID` is the session that SPAWNED this one (a subagent child); `forkOf` is the session this
 * one was FORKED from (issue #21). They are different relations: a fork is a ROOT session (no
 * `parentID`) that only remembers its origin, so it shows up in the list of roots while a subagent
 * child does not. VERIFIED against opencode 2.0.32 (fork spike, Windows 11, 21/10/2026).
 */
export type SessionSummary = {
  id: string;
  title?: string;
  parentID?: string;
  forkOf?: string;
  agent?: string;
  model?: ModelRef;
  createdAt: number;
  updatedAt: number;
  outcome?: 'succeeded' | 'failed' | 'interrupted';
};

/**
 * Live state of a session. `nextAt` of `retry` is an epoch-milliseconds timestamp.
 *
 * `error` means "not running; the last execution failed" (issue #14: opencode 2.0.32 publishes
 * `session.execution.failed`, never a status event). It goes back to `busy` on the next
 * `session.execution.started`, so the UI can show the error and still accept another prompt.
 */
export type SessionStatus =
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt: number; message: string; nextAt: number }
  | { type: 'error'; error: ErrorInfo };

/** File attached to a user message. Never carries the file contents (no base64). */
export type AttachmentInfo = { name?: string; mime: string; uri?: string };

/**
 * One message of a session. Assistant content lives in `Part`s, keyed by message id.
 * `notice` collapses opencode's synthetic/system/compaction/model-switched messages into one line.
 */
export type MessageInfo =
  | { kind: 'user'; id: string; createdAt: number; text: string; files: AttachmentInfo[] }
  | {
      kind: 'assistant';
      id: string;
      createdAt: number;
      completedAt?: number;
      agent: string;
      model: ModelRef;
      finish?: 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'unknown';
      error?: ErrorInfo;
      cost?: number;
      tokens?: TokenUsage;
    }
  | { kind: 'notice'; id: string; createdAt: number; text: string };

/** Output item of a finished tool call. */
export type ToolOutput =
  { type: 'text'; text: string } | { type: 'file'; uri: string; mime: string; name?: string };

/**
 * Lifecycle of a tool call. While `streaming`, `input` is the raw JSON text still arriving
 * (`part.delta` with `field: "input"` appends to it); afterwards it is the parsed object.
 */
export type ToolState =
  | { status: 'streaming'; input: string }
  | { status: 'running'; input: JsonObject; metadata?: JsonObject }
  | { status: 'completed'; input: JsonObject; output: ToolOutput[]; metadata?: JsonObject }
  | {
      status: 'error';
      input: JsonObject;
      error: ErrorInfo;
      output?: ToolOutput[];
      metadata?: JsonObject;
    };

/**
 * Content block of an assistant message.
 *
 * Identity: opencode v2 gives `text` and `reasoning` blocks NO id, so the host synthesizes a
 * positional one with `contentPartId(messageID, index)` (index = position in the message's
 * `content[]`). `tool` blocks keep the opencode tool id, because permissions and forms
 * reference it (`ToolRef.partID`).
 */
export type Part =
  | { type: 'text'; id: string; text: string }
  | { type: 'reasoning'; id: string; text: string; completed: boolean }
  | { type: 'tool'; id: string; name: string; state: ToolState };

/** Points at the tool block that triggered a permission or a form. */
export type ToolRef = { messageID: string; partID: string };

/** User answer to a permission request. `reject` also rejects every pending one of the session (server side). */
export type PermissionDecision = 'once' | 'always' | 'reject';

/**
 * Pending permission request. `save` empty means opencode will treat "always" as "once",
 * so the UI must hide "always" (issue #18). "always" persists per project in opencode's database.
 */
export type PermissionAsk = {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save: string[];
  message?: string;
  tool?: ToolRef;
  metadata?: JsonObject;
};

/** Choice of a select-like form field. */
export type FormOption = { value: string; label: string; description?: string };

type FieldBase = { key: string; title?: string; description?: string; required?: boolean };

/**
 * Form field. Wire-only constraints (`when`, `hidden`, `pattern`, `format`, length limits) are
 * deliberately omitted: the server validates and answers with `FormInvalidAnswerError`,
 * which reaches the webview through `request.result`.
 */
export type FormField =
  | (FieldBase & {
      type: 'string';
      placeholder?: string;
      default?: string;
      options?: FormOption[];
      custom?: boolean;
    })
  | (FieldBase & {
      type: 'multiselect';
      options: FormOption[];
      minItems?: number;
      maxItems?: number;
      custom?: boolean;
      default?: string[];
    })
  | (FieldBase & { type: 'boolean'; default?: boolean })
  | (FieldBase & {
      type: 'number';
      integer: boolean;
      minimum?: number;
      maximum?: number;
      default?: number;
    })
  | (FieldBase & { type: 'external'; url: string });

/** Pending form. The `question` tool of opencode arrives as `kind: "question"`. */
export type FormAsk = {
  id: string;
  sessionID: string;
  title: string;
  kind: 'question' | 'form';
  tool?: ToolRef;
  fields: FormField[];
};

/** Answer to a form, keyed by `FormField.key`. */
export type FormAnswer = { [key: string]: string | number | boolean | string[] };

/**
 * What the host remembers about a request the user already answered (issues #56/#18), so the
 * history can say "Allowed once · Read .env" next to the tool that asked.
 *
 * opencode v2.0.32 keeps NO record of a resolved permission, and a resolved form only for ten
 * minutes in memory (read in `permission.ts` and `form.ts@843a6c51`), so this record is the only
 * source of the exact decision (once / always / reject). It lives in the host's memory and is lost
 * with the extension host (Reload Window); what the tool block itself still says afterwards is
 * derived in the webview (`toolOutcome.ts`). `at` is an epoch-milliseconds timestamp of the HOST
 * clock. It NEVER carries a form answer (a form may hold credentials) nor the feedback text: the
 * `question` tool block carries the answers and the rejection error carries the feedback, and both
 * travel as the tool state the webview already has. `resource` is only the first resource, as the
 * card shows it.
 */
export type RequestResolution =
  | {
      kind: 'permission';
      id: string;
      sessionID: string;
      tool?: ToolRef;
      at: number;
      decision: PermissionDecision;
      action: string;
      resource?: string;
      /** True when the user sent a rejection with a message (the model reads it as feedback). */
      withFeedback: boolean;
    }
  | {
      kind: 'form';
      id: string;
      sessionID: string;
      tool?: ToolRef;
      at: number;
      outcome: 'answered' | 'cancelled';
      formKind: 'question' | 'form';
      title: string;
      /** True when the form was dismissed with a message (the model reads it as feedback). */
      withMessage: boolean;
    };
