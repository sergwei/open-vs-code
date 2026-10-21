// Pure mapping from opencode v2 wire shapes (`@opencode/client@2.0.32`) to the domain types of
// `src/shared` (issues #9/#14). No `vscode` import and no runtime import of the client: only
// `import type`, so Vitest runs it without bundling the SDK. The same functions serve the REST
// snapshot and the SSE translator, which is what keeps block ids identical between both.
//
// Provenance: shapes read in `dist/promise/generated/types.d.ts` of the 2.0.32 tarball and
// checked against recordings of a REAL opencode 2.0.32 (planner spike, Windows 11, 2026-10-20:
// REST `message.list`, `session.list`, `permission.list`, `session.form.list`). Tests built on
// those recorded JSON shapes confirm OUR logic, not the contract (see the test headers).

import type {
  AgentInfo,
  FormInfo,
  ModelInfo,
  PermissionRequest,
  ProviderInfo,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionStructuredError,
  ToolContent,
} from '@opencode/client';
import type {
  AgentOption,
  AttachmentInfo,
  ErrorInfo,
  FormAsk,
  FormField,
  JsonObject,
  MessageInfo,
  ModelOption,
  ModelRef,
  Part,
  PermissionAsk,
  ProviderOption,
  SessionSummary,
  ToolOutput,
  ToolRef,
  ToolState,
  TokenUsage,
} from '../shared/model';
import { contentPartId } from '../shared/protocol';

/** Placeholder that replaces the server URL in any text that reaches the webview. */
const REDACTED_SERVER = '<server>';

/** Placeholder that replaces the password (or its Basic token) in any text that reaches the webview. */
const REDACTED_SECRET = '<redacted>';

/**
 * Loopback `host:port` with an optional scheme, as it appears in transport errors.
 * Matches IPv4 loopback, bracketed IPv6 loopback and `localhost`.
 */
const LOOPBACK_ADDRESS = /(?:https?:\/\/)?(?:127\.0\.0\.1|\[::1\]|localhost):\d+/gi;

/** What {@link toErrorInfo} must scrub: the server URL and the password of the running server. */
export interface ErrorSecrets {
  url?: string;
  password?: string;
}

/**
 * Removes the server URL, any loopback `host:port` and the password from `text`.
 *
 * Architecture rule 1: the port and the password live only in the extension host, and client
 * transport errors can embed `http://127.0.0.1:PORT`. Besides the literal password, the Basic
 * token (`base64("opencode:" + password)`) is scrubbed too, because a failing request can echo
 * its headers. Empty secrets are ignored (replacing "" would insert the placeholder everywhere).
 * VERIFIED by unit tests with fabricated strings; real transport errors were not captured
 * (UNVERIFIED: check what a refused connection and a 401 look like once from the host).
 */
export function sanitizeText(text: string, secrets: ErrorSecrets): string {
  let result = text;
  if (secrets.url !== undefined && secrets.url !== '') {
    result = result.split(secrets.url).join(REDACTED_SERVER);
  }
  result = result.replace(LOOPBACK_ADDRESS, REDACTED_SERVER);
  const { password } = secrets;
  if (password !== undefined && password !== '') {
    const token = Buffer.from(`opencode:${password}`).toString('base64');
    result = result.split(token).join(REDACTED_SECRET).split(password).join(REDACTED_SECRET);
  }
  return result;
}

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads `key` as a string, or `undefined` when absent or of another type. */
function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Turns anything thrown by the client, or a structured error from an event, into an
 * {@link ErrorInfo} that is safe to show.
 *
 * Recognised shapes, in this order: a `ClientError` (duck-typed by `name` and `reason`; its
 * `reason` becomes the code and the `cause` message the detail), a server error body
 * `{ _tag, message }` (the client THROWS that body, it is not an `Error`), a
 * `SessionStructuredError { type, message }` (the code is `type`, not `_tag`), and any other
 * `Error`. Everything else becomes code `Unknown`. The text always goes through
 * {@link sanitizeText}. The `_tag` and `type` shapes were seen on a real opencode 2.0.32
 * (`SessionNotFoundError`, `provider.no-route`; Windows 11, 2026-10-20); the `ClientError` shape
 * is read from `client-error.d.ts` only (HYPOTHESIS for its text in a real failure).
 */
export function toErrorInfo(error: unknown, secrets: ErrorSecrets): ErrorInfo {
  const clean = (text: string): string => sanitizeText(text, secrets);
  if (error instanceof Error) {
    const reason = (error as { reason?: unknown }).reason;
    const cause = error.cause instanceof Error ? error.cause.message : undefined;
    const info: ErrorInfo = {
      code: error.name === 'ClientError' && typeof reason === 'string' ? reason : error.name,
      message: clean(error.message),
    };
    if (cause !== undefined) info.detail = clean(cause);
    return info;
  }
  if (isRecord(error)) {
    const message = stringField(error, 'message');
    const code = stringField(error, '_tag') ?? stringField(error, 'type');
    if (message !== undefined) return { code: code ?? 'Unknown', message: clean(message) };
  }
  return { code: 'Unknown', message: clean(typeof error === 'string' ? error : 'Unknown error') };
}

/** Maps a `SessionStructuredError` of the wire; same scrubbing as {@link toErrorInfo}. */
export function toStructuredErrorInfo(
  error: SessionStructuredError,
  secrets: ErrorSecrets,
): ErrorInfo {
  return { code: error.type, message: sanitizeText(error.message, secrets) };
}

/**
 * Provider/model pair of the wire to the shared shape. A `variant` of `"default"` becomes ABSENT:
 * the server echoes `variant: "default"` in `session.get` and `session.step.started` when the
 * model was chosen without a variant, and the UI compares references, so both spellings of "no
 * variant" must be one. Any other variant is kept. VERIFIED in the issue #23 spike against
 * opencode 2.0.32 (Windows 11, 21/10/2026).
 */
export function toModelRef(model: { id: string; providerID: string; variant?: string }): ModelRef {
  const ref: ModelRef = { providerID: model.providerID, id: model.id };
  if (model.variant !== undefined && model.variant !== 'default') ref.variant = model.variant;
  return ref;
}

/**
 * Catalog entry of the wire to the shared option (issue #23). `free` needs EVERY cost entry (the
 * price can be tiered by context size) to have zero input and output, and a model with NO cost
 * entries is not called free (we would be guessing). `variants` keeps only the ids.
 * VERIFIED shape against a real opencode 2.0.32 (spike, Windows 11, 21/10/2026: ten free models);
 * the tiered-cost reading is HYPOTHESIS (no tiered model was seen).
 */
export function toModelOption(info: ModelInfo): ModelOption {
  return {
    providerID: info.providerID,
    id: info.id,
    name: info.name,
    status: info.status,
    contextLimit: info.limit.context,
    free: info.cost.length > 0 && info.cost.every((c) => c.input === 0 && c.output === 0),
    variants: info.variants.map((variant) => variant.id),
  };
}

/** Provider of the wire to the shared option. VERIFIED shape (same spike as {@link toModelOption}). */
export function toProviderOption(info: ProviderInfo): ProviderOption {
  return { id: info.id, name: info.name };
}

/**
 * The agents the user may choose, in the server's order (the default agent comes first).
 *
 * Selectable = `mode !== "subagent"` and not `hidden`, the filter opencode's own `agent.ts` applies
 * (`core/src/agent.ts` L74-75 at tag v2.0.32, read). VERIFIED against a real opencode 2.0.32 (spike,
 * Windows 11, 21/10/2026): of seven agents only `build` and `plan` passed; `general`/`explore` are
 * subagents and `compaction`/`title`/`summary` are hidden. `mode: "all"` passes (HYPOTHESIS: none
 * was seen; it is what the filter says).
 */
export function toAgentOptions(list: readonly AgentInfo[]): AgentOption[] {
  return list
    .filter((agent) => agent.mode !== 'subagent' && !agent.hidden)
    .map((agent) => {
      const option: AgentOption = { id: agent.id, name: agent.name };
      if (agent.description !== undefined) option.description = agent.description;
      return option;
    });
}

/**
 * Maps a REST session to a row of the session list: `time.created/updated` become
 * `createdAt/updatedAt` (epoch ms). The sidebar needs no more in phase 1. `fork.sessionID`
 * becomes `forkOf` (issue #21); the fork boundary is dropped because nothing in the UI uses it.
 * Shape VERIFIED on a real opencode 2.0.32 (`session.list`, Windows 11, 2026-10-20); `fork`
 * VERIFIED by the issue #21 spike (`session.fork`, same version, 2026-10-21).
 */
export function toSessionSummary(info: SessionInfo): SessionSummary {
  const summary: SessionSummary = {
    id: info.id,
    createdAt: info.time.created,
    updatedAt: info.time.updated,
  };
  if (info.title !== undefined) summary.title = info.title;
  if (info.parentID !== undefined) summary.parentID = info.parentID;
  if (info.fork !== undefined) summary.forkOf = info.fork.sessionID;
  if (info.agent !== undefined) summary.agent = info.agent;
  if (info.model !== undefined) summary.model = toModelRef(info.model);
  if (info.outcome !== undefined) summary.outcome = info.outcome;
  return summary;
}

/** Wire token usage (`cache.read/write`) to the flat shared counters. */
export function toTokenUsage(tokens: {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}): TokenUsage {
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cacheRead: tokens.cache.read,
    cacheWrite: tokens.cache.write,
  };
}

/**
 * Narrows free-form wire JSON (`any` in events, `JsonValue` in REST) to a {@link JsonObject}.
 * A non-object becomes `{}`: tool input is only displayed, never interpreted, in phase 1.
 */
export function toJsonObject(value: unknown): JsonObject {
  return isRecord(value) ? (value as JsonObject) : {};
}

/** Wire tool output (text or file) to the shared shape; a `null` file name becomes absent. */
export function toToolOutput(content: ToolContent | { type: string }): ToolOutput {
  const item = content as Record<string, unknown>;
  if (item['type'] === 'file') {
    const output: ToolOutput = {
      type: 'file',
      uri: stringField(item, 'uri') ?? '',
      mime: stringField(item, 'mime') ?? '',
    };
    const name = stringField(item, 'name');
    if (name !== undefined) output.name = name;
    return output;
  }
  return { type: 'text', text: stringField(item, 'text') ?? '' };
}

/**
 * Maps the `state` of a wire tool block (REST or event data) to a {@link ToolState}.
 *
 * `completed.content` becomes `output`. While `streaming`, `input` is still the raw JSON text.
 * Shape read in `types.d.ts` (the four `SessionMessageToolState*`); a tool in each state was
 * NOT observed on a real server in the spike (UNVERIFIED: only reasoning and text were).
 */
export function toToolState(
  state: SessionMessageAssistantTool['state'],
  secrets: ErrorSecrets,
): ToolState {
  switch (state.status) {
    case 'streaming':
      return { status: 'streaming', input: state.input };
    case 'running':
      return {
        status: 'running',
        input: toJsonObject(state.input),
        metadata: toJsonObject(state.metadata),
      };
    case 'completed': {
      const done: ToolState = {
        status: 'completed',
        input: toJsonObject(state.input),
        output: state.content.map(toToolOutput),
      };
      if (state.metadata !== undefined) done.metadata = toJsonObject(state.metadata);
      return done;
    }
    case 'error': {
      const failed: ToolState = {
        status: 'error',
        input: toJsonObject(state.input),
        error: toStructuredErrorInfo(state.error, secrets),
      };
      if (state.content !== undefined) failed.output = state.content.map(toToolOutput);
      if (state.metadata !== undefined) failed.metadata = toJsonObject(state.metadata);
      return failed;
    }
  }
}

/**
 * Whether a REST reasoning block is finished: `time.completed` is set. A block without `time`
 * counts as completed, because only a block that is still streaming has a live `time.created`
 * (HYPOTHESIS: REST payloads of finished messages were recorded with the block closed; a
 * reasoning block without `time` while streaming was not seen).
 */
export function isReasoningCompleted(block: SessionMessageAssistantReasoning): boolean {
  return block.time === undefined || block.time.completed !== undefined;
}

/**
 * Maps one `content[]` block of an assistant message to a {@link Part}.
 *
 * `text` and `reasoning` blocks have no id in v2, so they get `contentPartId(messageID, index)`;
 * tools keep their own id. `index` MUST be the position in `content[]`, the same counter the
 * event translator keeps, or snapshot and stream disagree on ids.
 */
export function toPart(
  messageID: string,
  index: number,
  block:
    SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool,
  secrets: ErrorSecrets,
): Part {
  switch (block.type) {
    case 'text':
      return { type: 'text', id: contentPartId(messageID, index), text: block.text };
    case 'reasoning':
      return {
        type: 'reasoning',
        id: contentPartId(messageID, index),
        text: block.text,
        completed: isReasoningCompleted(block),
      };
    case 'tool':
      return {
        type: 'tool',
        id: block.id,
        name: block.name,
        state: toToolState(block.state, secrets),
      };
  }
}

/**
 * Maps the files of a user prompt to attachment rows WITHOUT their contents: the wire carries
 * base64 `data`, which must never travel to the webview (shared `AttachmentInfo` rule).
 */
export function toAttachments(
  files:
    | ReadonlyArray<{ mime: string; name?: string; source: { type: string; uri?: string } }>
    | undefined,
): AttachmentInfo[] {
  return (files ?? []).map((file) => {
    const info: AttachmentInfo = { mime: file.mime };
    if (file.name !== undefined) info.name = file.name;
    if (file.source.type === 'uri' && file.source.uri !== undefined) info.uri = file.source.uri;
    return info;
  });
}

/** Result of mapping one REST message: the message and, for assistants, its blocks. */
export interface MappedMessage {
  message: MessageInfo;
  parts: Part[];
}

/**
 * Maps an assistant message of the wire (REST or snapshot) to {@link MappedMessage}.
 * Split from {@link toMessage} because the translator seeds its per-message counters from it.
 */
export function toAssistantMessage(
  info: SessionMessageAssistant,
  secrets: ErrorSecrets,
): MappedMessage {
  const message: MessageInfo = {
    kind: 'assistant',
    id: info.id,
    createdAt: info.time.created,
    agent: info.agent,
    model: toModelRef(info.model),
  };
  if (info.time.completed !== undefined) message.completedAt = info.time.completed;
  if (info.finish !== undefined) message.finish = info.finish;
  if (info.error !== undefined) message.error = toStructuredErrorInfo(info.error, secrets);
  if (info.cost !== undefined) message.cost = info.cost;
  if (info.tokens !== undefined) message.tokens = toTokenUsage(info.tokens);
  return {
    message,
    parts: info.content.map((block, index) => toPart(info.id, index, block, secrets)),
  };
}

/**
 * Maps one REST message to the shared model, or `undefined` when phase 1 does not show it.
 *
 * `user` and `assistant` are mapped; `idle` (which REST returns, with `outcome`), `model-switched`
 * and every other type give `undefined` (the shared `notice` kind is not produced yet).
 * VERIFIED with recordings of a real opencode 2.0.32 (Windows 11, 2026-10-20): user message,
 * assistant `[reasoning, text]`, and the `idle` failure message.
 */
export function toMessage(
  info: SessionMessageInfo,
  secrets: ErrorSecrets,
): MappedMessage | undefined {
  switch (info.type) {
    case 'user':
      return {
        message: {
          kind: 'user',
          id: info.id,
          createdAt: info.time.created,
          text: info.text,
          files: toAttachments(info.files),
        },
        parts: [],
      };
    case 'assistant':
      return toAssistantMessage(info, secrets);
    default:
      return undefined;
  }
}

/**
 * Maps a pending permission (REST `permission.list` item or `permission.asked` data).
 *
 * `source` of type tool becomes a {@link ToolRef} (`partID` is the tool id, which is the part id
 * of tool blocks); `save` absent becomes `[]`, which tells the UI "always" is not offered.
 * Shape seen only through types: `permission.list` was EMPTY in the spike (UNVERIFIED with a
 * real request).
 */
export function toPermissionAsk(request: PermissionRequest): PermissionAsk {
  const ask: PermissionAsk = {
    id: request.id,
    sessionID: request.sessionID,
    action: request.action,
    resources: [...request.resources],
    save: [...(request.save ?? [])],
  };
  if (request.message !== undefined) ask.message = request.message;
  if (request.source !== undefined && request.source.type === 'tool') {
    ask.tool = { messageID: request.source.messageID, partID: request.source.id };
  }
  if (request.metadata !== undefined) ask.metadata = toJsonObject(request.metadata);
  return ask;
}

/** A finite number, or `undefined` for the wire's `"Infinity"`, `"-Infinity"` and `"NaN"` strings. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Reads `metadata.tool` of a question form as a {@link ToolRef}, if well formed. */
function toolRefOf(metadata: unknown): ToolRef | undefined {
  if (!isRecord(metadata)) return undefined;
  const tool = metadata['tool'];
  if (!isRecord(tool)) return undefined;
  const messageID = stringField(tool, 'messageID');
  const id = stringField(tool, 'id');
  return messageID !== undefined && id !== undefined ? { messageID, partID: id } : undefined;
}

/**
 * Maps one wire form field. `integer` fields become `number` with `integer: true`; wire-only
 * constraints (`when`, `hidden`, `pattern`, ...) are dropped on purpose (see `FormField`).
 */
function toFormField(field: FormInfo['fields'][number]): FormField {
  const base = {
    key: field.key,
    ...(field.title !== undefined ? { title: field.title } : {}),
    ...(field.description !== undefined ? { description: field.description } : {}),
    ...('required' in field && field.required !== undefined ? { required: field.required } : {}),
  };
  switch (field.type) {
    case 'string':
      return {
        ...base,
        type: 'string',
        ...(field.placeholder !== undefined ? { placeholder: field.placeholder } : {}),
        ...(field.default !== undefined ? { default: field.default } : {}),
        ...(field.options !== undefined ? { options: field.options.map((o) => ({ ...o })) } : {}),
        ...(field.custom !== undefined ? { custom: field.custom } : {}),
      };
    case 'multiselect':
      return {
        ...base,
        type: 'multiselect',
        options: field.options.map((o) => ({ ...o })),
        ...(field.minItems !== undefined ? { minItems: field.minItems } : {}),
        ...(field.maxItems !== undefined ? { maxItems: field.maxItems } : {}),
        ...(field.custom !== undefined ? { custom: field.custom } : {}),
        ...(field.default !== undefined ? { default: [...field.default] } : {}),
      };
    case 'boolean':
      return {
        ...base,
        type: 'boolean',
        ...(field.default !== undefined ? { default: field.default } : {}),
      };
    case 'number':
    case 'integer': {
      const minimum = finiteNumber(field.minimum);
      const maximum = finiteNumber(field.maximum);
      const fallback = finiteNumber(field.default);
      return {
        ...base,
        type: 'number',
        integer: field.type === 'integer',
        ...(minimum !== undefined ? { minimum } : {}),
        ...(maximum !== undefined ? { maximum } : {}),
        ...(fallback !== undefined ? { default: fallback } : {}),
      };
    }
    case 'external':
      return { ...base, type: 'external', url: field.url };
  }
}

/**
 * Maps a pending form (REST `session.form.list` item or `form.created` data).
 *
 * `metadata.kind === "question"` marks the opencode `question` tool; its `metadata.tool`
 * (`{ messageID, id }`) becomes the {@link ToolRef}. Read in `question.ts@v2.0.32` and in the
 * types; `session.form.list` was empty in the spike (UNVERIFIED with a real form).
 */
export function toFormAsk(form: FormInfo): FormAsk {
  const ask: FormAsk = {
    id: form.id,
    sessionID: form.sessionID,
    title: form.title,
    kind: isRecord(form.metadata) && form.metadata['kind'] === 'question' ? 'question' : 'form',
    fields: form.fields.map(toFormField),
  };
  const tool = toolRefOf(form.metadata);
  if (tool !== undefined) ask.tool = tool;
  return ask;
}
