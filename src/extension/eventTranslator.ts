// Translates opencode v2 SSE events (`GET /api/event`) into the typed host-to-webview protocol of
// `src/shared` (issue #14). Pure and stateful: no `vscode`, no I/O. The webview never sees a
// `V2Event` (architecture rule 2); the controller feeds events in and posts what comes out.
//
// Why it keeps state: v2 gives `text` and `reasoning` blocks no id and does not publish the user
// message or the session status as events, so the translator rebuilds all three:
//   - busy / idle / error come from `session.execution.*` (VERIFIED against a real opencode
//     2.0.32, Windows 11, 2026-10-20: a whole turn, successful and failed, published NO
//     `session.status` and NO `session.idle`; lesson `estado-sesion-execution`);
//   - the user message appears on `session.inbox.delivered`, with the payload remembered from
//     `enqueued` (VERIFIED, same spike; `inboxID` is the id REST returns for that message);
//   - block ids are a per-message position counter (`contentPartId`), and events are routed like
//     the core projector does: text -> last text block, reasoning -> last reasoning block not
//     completed, tool -> by id. `ordinal` is NOT used as an index (VERIFIED, same spike: both
//     `ordinal`s were 0 and `text.started` arrived before `reasoning.ended`).
// Self-healing instead of buffering: every closing event (`*.ended`, `step.*`, `tool.*`) emits the
// WHOLE object, so what a snapshot/stream gap lost is repaired when the block closes. A delta for
// an unknown message or block is dropped (deltas are not idempotent, so they cannot be replayed).

import type { SessionMessageInfo, V2Event } from '@opencode/client';
import type {
  ErrorInfo,
  JsonObject,
  MessageInfo,
  Part,
  SessionStatus,
  SessionSummary,
  ToolState,
} from '../shared/model';
import {
  contentPartId,
  type HostToWebview,
  type OpenSession,
  type Snapshot,
} from '../shared/protocol';
import {
  toAttachments,
  toAssistantMessage,
  toFormAsk,
  toJsonObject,
  toModelRef,
  toPermissionAsk,
  toStructuredErrorInfo,
  toToolOutput,
  toTokenUsage,
  type ErrorSecrets,
} from './wireMapping';

/** Assistant message as the translator tracks it. */
type AssistantTracker = {
  info: Extract<MessageInfo, { kind: 'assistant' }>;
  /** Next position in `content[]`; advances on `text.started`, `reasoning.started`, `tool.input.started`. */
  count: number;
  /** Position of the last `text` block, the target of `text.delta/ended`. */
  lastText: number | undefined;
  /** Position of the last `reasoning` block that is not completed. */
  openReasoning: number | undefined;
  /** Tool blocks by tool id (their id is the part id); the same objects as in `parts`. */
  tools: Map<string, Extract<Part, { type: 'tool' }>>;
  /**
   * The blocks as the stream has built them, indexed by position. Kept so a snapshot that was
   * read before they existed can be completed with them (see `mergeLive`).
   */
  parts: Part[];
  /** `seed`: built from a REST message; `stream`: born from a `step.started` event. Drives pruning. */
  origin: 'seed' | 'stream';
};

/** Fresh tracker for an assistant message that the stream has just announced. */
const newTracker = (info: AssistantTracker['info']): AssistantTracker => ({
  info,
  count: 0,
  lastText: undefined,
  openReasoning: undefined,
  tools: new Map(),
  parts: [],
  origin: 'stream',
});

/** What `enqueued` told us about a user prompt, kept until its `delivered`. */
type PendingUser = { text: string; files: ReturnType<typeof toAttachments> };

/** Bound on the per-session statuses remembered between two resyncs. Our own choice. */
const MAX_LIVE_STATUSES = 256;

/**
 * Copies into `target` the longer text of each `text`/`reasoning` block of `source`, block by
 * block (same position and type). Used when REST and the stream saw the same number of blocks.
 */
function keepLongerText(target: Part[], source: Part[]): void {
  target.forEach((part, index) => {
    const other = source[index];
    if (other === undefined) return;
    if (
      (part.type === 'text' && other.type === 'text') ||
      (part.type === 'reasoning' && other.type === 'reasoning')
    ) {
      if (other.text.length > part.text.length) part.text = other.text;
    }
  });
}

/** True when `tracker` has more blocks than `rest`, or the same number with longer text somewhere. */
function isRicher(tracker: Part[], rest: Part[] | undefined): boolean {
  if (rest === undefined) return true;
  if (tracker.length !== rest.length) return tracker.length > rest.length;
  return tracker.some((part, index) => {
    const other = rest[index];
    return (
      other !== undefined &&
      ((part.type === 'text' && other.type === 'text') ||
        (part.type === 'reasoning' && other.type === 'reasoning')) &&
      part.text.length > other.text.length
    );
  });
}

/** Bound on remembered inbox payloads, so a stream of undelivered prompts cannot grow without end. */
const MAX_PENDING_INBOX = 64;

/** What {@link EventTranslator.seed} needs from the REST snapshot. */
export interface TranslatorSeed {
  sessions: SessionSummary[];
  /** Messages of the OPEN session as REST returned them (any order). */
  messages: SessionMessageInfo[];
}

/** The translator returned by {@link createEventTranslator}. */
export interface EventTranslator {
  /**
   * Replaces the mirror of sessions and MERGES the REST messages of the open session into what the
   * stream already built (emptying it lost everything that arrived between the REST reads and
   * this call: review BLOCKER, 20/10/2026). Contract:
   *  - Records `restNewest`, the newest `time.created` among the messages passed.
   *  - For each REST assistant message: if the stream's tracker has MORE blocks it is kept; if it
   *    has the same number, REST's tracker wins but keeps the longer text of each `text` and
   *    `reasoning` block; otherwise REST's wins.
   *  - Prunes trackers REST does not list: those built by an earlier `seed` always (REST itself
   *    once listed them, so they left the window or were deleted); those born in the stream only
   *    when older than `restNewest` (a newer one is in flight). Delivered user messages are
   *    dropped when REST lists them or are older than `restNewest`. This bounds memory.
   *  - Pending `inbox` payloads are left alone.
   * Call it with every snapshot, then {@link EventTranslator.mergeLive}, then publish.
   */
  seed(seed: TranslatorSeed): void;
  /**
   * Adds (or overwrites) `rows` in the mirror of sessions WITHOUT emptying it (issue #20). The
   * snapshot only mirrors its 50 newest sessions, and a `session.renamed` of a row that is not
   * mirrored is dropped (a snapshot is supposed to bring the full row); a page of the session list
   * can show an older session, so the host mirrors each page and a rename of that session reaches
   * the webview as `session.upserted`. The next `seed` replaces the mirror again, which is what
   * bounds its size.
   */
  mirror(rows: readonly SessionSummary[]): void;
  /**
   * Returns `open` completed with what the stream knows and the REST snapshot lacks, so the
   * webview, which REPLACES its state with a snapshot, does not lose a message in flight:
   *  - user and assistant messages not in `open` whose `createdAt` is >= `restNewest` of the last
   *    `seed` (older ones are never brought back, so a message that left the REST window does not
   *    reappear at the end of the chat);
   *  - the tracker's blocks of a message in `open` when they are more than REST's or equal in
   *    number with longer text in some block (same rule as `seed`).
   * Extra messages are appended sorted by `createdAt`. Does not mutate `open`; returns the same
   * object when nothing is added. Statuses are NOT handled here: see `mergeStatuses`.
   */
  mergeLive(open: OpenSession): OpenSession;
  /**
   * Marks the start of a resync: forgets the statuses remembered so far. Call it BEFORE the REST
   * reads, so {@link EventTranslator.mergeStatuses} only holds what the stream said since then.
   */
  beginResync(): void;
  /**
   * Overlays on `statuses` (read from REST, possibly before the stream moved on) the latest status
   * the stream derived from `session.execution.*` / `retry.scheduled` since `beginResync`.
   * Without it a `succeeded` that arrives during the reads is overwritten by a stale `busy`, and
   * the UI would keep "Working…" with Send disabled.
   */
  mergeStatuses(statuses: Snapshot['statuses']): Snapshot['statuses'];
  /**
   * Changes the session whose messages and parts are forwarded, and clears message state.
   * Permissions and forms are NOT tied to it: they are forwarded for every session (phase 3), and
   * the snapshot carries them at `Snapshot.requests`, outside `OpenSession`.
   */
  setOpen(sessionID: string | undefined): void;
  /**
   * Translates one event into zero or more protocol messages, in order. Never throws on unknown
   * shapes. `permission.*` and `form.*` events of ANY session become `*.asked` / `*.resolved`.
   */
  translate(event: V2Event): HostToWebview[];
}

/**
 * Creates a translator. `secrets` scrub the server URL and password from error texts.
 *
 * Provenance: the event table follows `references/eventos-v2.md` and the types of
 * `@opencode/client@2.0.32`; the turn sequence `inbox.enqueued -> execution.started -> ... ->
 * step.started -> reasoning/text -> step.ended -> execution.succeeded` was recorded from a real
 * 2.0.32 (VERIFIED, planner spike, Windows 11, 2026-10-20). Tools, permissions, forms and
 * `retry.scheduled` are translated from the types only (UNVERIFIED against a running server),
 * except that in the opt-in `realOpencode.test.ts` of phase 3 (Windows 11, VS Code 1.142.0,
 * 2026-10-20, two runs) a real `permission.asked`, `permission.replied`, `form.created` and
 * `form.replied` were translated well enough for the host to log the expected ids and decisions;
 * the TOOL events around them were not inspected.
 * Tests of this module use recorded sequences, which confirm the logic, not the contract.
 * Phase 3 (issues #18/#44): the `permission.*` / `form.*` events are no longer filtered by the
 * open session, because the event names are `form.*` (not `session.form.*`) and a subagent asks
 * from its own child session; dropping those left the agent waiting on a request nobody saw.
 * Issue #20 added `mirror`: the mirror of sessions is no longer only the snapshot's 50 rows, it also
 * holds the rows of the pages the user browsed, so a rename of an older session is forwarded.
 * VERIFIED by `eventTranslator.test.ts` (fabricated rows); a rename of an old session by another
 * client has only been seen through the synthetic server of `chatController.e2e.test.ts`.
 */
export function createEventTranslator(secrets: ErrorSecrets = {}): EventTranslator {
  const sessions = new Map<string, SessionSummary>();
  const assistants = new Map<string, AssistantTracker>();
  const pendingUsers = new Map<string, PendingUser>();
  /** User messages the stream delivered, kept (bounded) so `mergeLive` can restore them. */
  const liveUsers = new Map<string, Extract<MessageInfo, { kind: 'user' }>>();
  /** Latest status the stream derived per session since `beginResync`, to override a stale snapshot. */
  const liveStatuses = new Map<string, SessionStatus>();
  /** `time.created` of the newest message of the last REST read, `undefined` when it was empty. */
  let restNewest: number | undefined;
  let open: string | undefined;

  /** The tracker of an assistant message of the open session, if we know it. */
  const assistantOf = (sessionID: string, messageID: string): AssistantTracker | undefined =>
    sessionID === open ? assistants.get(messageID) : undefined;

  const status = (sessionID: string, value: SessionStatus): HostToWebview[] => {
    if (liveStatuses.size >= MAX_LIVE_STATUSES) {
      const oldest = liveStatuses.keys().next();
      if (!oldest.done) liveStatuses.delete(oldest.value);
    }
    liveStatuses.delete(sessionID); // re-insert at the end so the oldest is evicted first
    liveStatuses.set(sessionID, value);
    return [{ type: 'session.status', sessionID, status: value }];
  };

  const upsertMessage = (sessionID: string, message: MessageInfo): HostToWebview => ({
    type: 'message.upserted',
    sessionID,
    message,
  });

  const upsertPart = (sessionID: string, messageID: string, part: Part): HostToWebview => ({
    type: 'part.upserted',
    sessionID,
    messageID,
    part,
  });

  /** Builds the tracker of one REST assistant message (counters and open blocks come from `content[]`). */
  const trackerFromMessage = (info: SessionMessageInfo): AssistantTracker | undefined => {
    if (info.type !== 'assistant') return undefined;
    const mapped = toAssistantMessage(info, secrets);
    if (mapped.message.kind !== 'assistant') return undefined;
    const tracker: AssistantTracker = {
      info: mapped.message,
      count: mapped.parts.length,
      lastText: undefined,
      openReasoning: undefined,
      tools: new Map(),
      parts: mapped.parts,
      origin: 'seed',
    };
    mapped.parts.forEach((part, index) => {
      if (part.type === 'text') tracker.lastText = index;
      else if (part.type === 'reasoning' && !part.completed) tracker.openReasoning = index;
      else if (part.type === 'tool') tracker.tools.set(part.id, part);
    });
    return tracker;
  };

  /** Emits a tool block after changing its state in the tracker. */
  const setToolState = (
    sessionID: string,
    messageID: string,
    toolID: string,
    next: (tool: Extract<Part, { type: 'tool' }>) => ToolState,
  ): HostToWebview[] => {
    const tracker = assistantOf(sessionID, messageID);
    const tool = tracker?.tools.get(toolID);
    if (tracker === undefined || tool === undefined) return [];
    tool.state = next(tool);
    return [upsertPart(sessionID, messageID, structuredClone(tool))];
  };

  /** The input object of a tool in a non-streaming state, or `{}` while it is still raw text. */
  const inputOf = (tool: Extract<Part, { type: 'tool' }>): JsonObject =>
    tool.state.status === 'streaming' ? {} : tool.state.input;

  return {
    beginResync() {
      liveStatuses.clear();
    },

    mergeStatuses(statuses) {
      if (liveStatuses.size === 0) return statuses;
      return { ...statuses, ...Object.fromEntries(liveStatuses) };
    },

    seed({ sessions: rows, messages }) {
      sessions.clear();
      for (const row of rows) sessions.set(row.id, row);
      const listed = new Set(messages.map((message) => message.id));
      restNewest = messages.reduce<number | undefined>(
        (max, message) =>
          max === undefined ? message.time.created : Math.max(max, message.time.created),
        undefined,
      );
      for (const message of messages) {
        const fromRest = trackerFromMessage(message);
        if (fromRest === undefined) continue;
        // Keep the stream's tracker when it already has MORE blocks than REST had when it was
        // read; with the same number, REST wins but keeps the longer text of each block (the
        // stream may have accumulated deltas REST was read before).
        const live = assistants.get(fromRest.info.id);
        if (live !== undefined && live.count > fromRest.count) continue;
        if (live !== undefined) keepLongerText(fromRest.parts, live.parts);
        assistants.set(fromRest.info.id, fromRest);
      }
      // Prune what REST no longer lists (it left the MESSAGE_LIMIT window or was deleted):
      // `mergeLive` must not bring it back at the end of the chat, and the maps stay bounded.
      // A tracker that came from a previous seed is dropped whatever its date, because REST
      // itself once listed it; one born in the stream is only dropped when it is OLDER than
      // REST's newest message, since a newer one is a message in flight REST has not seen.
      for (const [id, tracker] of assistants) {
        if (listed.has(id)) continue;
        const older = restNewest !== undefined && tracker.info.createdAt < restNewest;
        if (tracker.origin === 'seed' || older) assistants.delete(id);
      }
      if (restNewest !== undefined) {
        const newest = restNewest;
        for (const [id, user] of liveUsers) {
          if (listed.has(id) || user.createdAt < newest) liveUsers.delete(id);
        }
      }
    },

    mirror(rows) {
      for (const row of rows) sessions.set(row.id, row);
    },

    mergeLive(snapshot) {
      const known = new Map(snapshot.messages.map((message, index) => [message.id, index]));
      const extraMessages: MessageInfo[] = [];
      const parts = { ...snapshot.parts };
      let changed = false;
      /** True when the item is newer than the newest message REST returned (so, in flight). */
      const isNewer = (createdAt: number): boolean =>
        restNewest === undefined || createdAt >= restNewest;
      for (const user of liveUsers.values()) {
        if (known.has(user.id) || !isNewer(user.createdAt)) continue;
        extraMessages.push(user);
        changed = true;
      }
      for (const tracker of assistants.values()) {
        const id = tracker.info.id;
        if (!known.has(id)) {
          if (!isNewer(tracker.info.createdAt)) continue;
          extraMessages.push(tracker.info);
          parts[id] = structuredClone(tracker.parts);
          changed = true;
        } else if (isRicher(tracker.parts, snapshot.parts[id])) {
          parts[id] = structuredClone(tracker.parts);
          changed = true;
        }
      }
      if (!changed) return snapshot;
      extraMessages.sort((a, b) => a.createdAt - b.createdAt);
      return { ...snapshot, messages: [...snapshot.messages, ...extraMessages], parts };
    },

    setOpen(sessionID) {
      if (sessionID === open) return;
      open = sessionID;
      assistants.clear();
      pendingUsers.clear();
      liveUsers.clear();
    },

    translate(event) {
      switch (event.type) {
        case 'session.created': {
          const { data } = event;
          const row: SessionSummary = {
            id: data.sessionID,
            createdAt: event.created,
            updatedAt: event.created,
          };
          if (data.title !== undefined) row.title = data.title;
          if (data.parentID !== undefined) row.parentID = data.parentID;
          if (data.agent !== undefined) row.agent = data.agent;
          if (data.model !== undefined) row.model = toModelRef(data.model);
          sessions.set(row.id, row);
          return [{ type: 'session.upserted', session: row }];
        }
        case 'session.renamed': {
          const row = sessions.get(event.data.sessionID);
          if (row === undefined) return []; // not mirrored: a snapshot will bring the full row
          const next: SessionSummary = {
            ...row,
            title: event.data.title,
            updatedAt: event.created,
          };
          sessions.set(next.id, next);
          return [{ type: 'session.upserted', session: next }];
        }
        case 'session.deleted': {
          sessions.delete(event.data.sessionID);
          return [{ type: 'session.removed', sessionID: event.data.sessionID }];
        }

        case 'session.execution.started':
          return status(event.data.sessionID, { type: 'busy' });
        case 'session.execution.succeeded':
        case 'session.execution.interrupted':
          return status(event.data.sessionID, { type: 'idle' });
        case 'session.execution.failed': {
          const error: ErrorInfo = toStructuredErrorInfo(event.data.error, secrets);
          return status(event.data.sessionID, { type: 'error', error });
        }
        case 'session.retry.scheduled':
          return status(event.data.sessionID, {
            type: 'retry',
            attempt: event.data.attempt,
            message: toStructuredErrorInfo(event.data.error, secrets).message,
            nextAt: event.data.at,
          });

        case 'session.inbox.enqueued': {
          const { data } = event;
          if (data.sessionID !== open || data.item.type !== 'user') return [];
          if (pendingUsers.size >= MAX_PENDING_INBOX) {
            const oldest = pendingUsers.keys().next();
            if (!oldest.done) pendingUsers.delete(oldest.value);
          }
          pendingUsers.set(data.inboxID, {
            text: data.item.payload.text,
            files: toAttachments(data.item.payload.files),
          });
          return [];
        }
        case 'session.inbox.delivered': {
          const { data } = event;
          const pending = pendingUsers.get(data.inboxID);
          if (data.sessionID !== open || pending === undefined) return [];
          pendingUsers.delete(data.inboxID);
          const user: Extract<MessageInfo, { kind: 'user' }> = {
            kind: 'user',
            id: data.inboxID,
            createdAt: event.created,
            text: pending.text,
            files: pending.files,
          };
          if (liveUsers.size >= MAX_PENDING_INBOX) {
            const oldest = liveUsers.keys().next();
            if (!oldest.done) liveUsers.delete(oldest.value);
          }
          liveUsers.set(user.id, user);
          return [upsertMessage(data.sessionID, user)];
        }

        case 'session.step.started': {
          const { data } = event;
          if (data.sessionID !== open) return [];
          const info: AssistantTracker['info'] = {
            kind: 'assistant',
            id: data.assistantMessageID,
            createdAt: data.started,
            agent: data.agent,
            model: toModelRef(data.model),
          };
          const existing = assistants.get(info.id);
          if (existing === undefined) {
            assistants.set(info.id, newTracker(info));
          } else {
            existing.info = { ...existing.info, ...info };
          }
          return [upsertMessage(data.sessionID, info)];
        }
        case 'session.step.ended': {
          const { data } = event;
          const tracker = assistantOf(data.sessionID, data.assistantMessageID);
          if (tracker === undefined) return [];
          tracker.info = {
            ...tracker.info,
            completedAt: event.created,
            finish: data.finish,
            cost: data.cost,
            tokens: toTokenUsage(data.tokens),
          };
          return [upsertMessage(data.sessionID, tracker.info)];
        }
        case 'session.step.failed': {
          const { data } = event;
          const tracker = assistantOf(data.sessionID, data.assistantMessageID);
          if (tracker === undefined) return [];
          tracker.info = {
            ...tracker.info,
            completedAt: event.created,
            finish: data.finish ?? 'error',
            error: toStructuredErrorInfo(data.error, secrets),
          };
          if (data.cost !== undefined) tracker.info.cost = data.cost;
          if (data.tokens !== undefined) tracker.info.tokens = toTokenUsage(data.tokens);
          return [upsertMessage(data.sessionID, tracker.info)];
        }

        case 'session.text.started': {
          const { data } = event;
          const tracker = assistantOf(data.sessionID, data.assistantMessageID);
          if (tracker === undefined) return [];
          const index = tracker.count++;
          tracker.lastText = index;
          const part: Part = {
            type: 'text',
            id: contentPartId(data.assistantMessageID, index),
            text: '',
          };
          tracker.parts[index] = part;
          return [upsertPart(data.sessionID, data.assistantMessageID, structuredClone(part))];
        }
        case 'session.text.delta': {
          const { data } = event;
          const tracker = assistantOf(data.sessionID, data.assistantMessageID);
          if (tracker?.lastText === undefined) return [];
          const target = tracker.parts[tracker.lastText];
          if (target?.type === 'text') target.text += data.delta;
          return [
            {
              type: 'part.delta',
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              partID: contentPartId(data.assistantMessageID, tracker.lastText),
              field: 'text',
              delta: data.delta,
            },
          ];
        }
        case 'session.text.ended': {
          const { data } = event;
          const tracker = assistantOf(data.sessionID, data.assistantMessageID);
          if (tracker?.lastText === undefined) return [];
          const part: Part = {
            type: 'text',
            id: contentPartId(data.assistantMessageID, tracker.lastText),
            text: data.text,
          };
          tracker.parts[tracker.lastText] = part;
          return [upsertPart(data.sessionID, data.assistantMessageID, structuredClone(part))];
        }

        case 'session.reasoning.started': {
          const { data } = event;
          const tracker = assistantOf(data.sessionID, data.assistantMessageID);
          if (tracker === undefined) return [];
          const index = tracker.count++;
          tracker.openReasoning = index;
          const part: Part = {
            type: 'reasoning',
            id: contentPartId(data.assistantMessageID, index),
            text: '',
            completed: false,
          };
          tracker.parts[index] = part;
          return [upsertPart(data.sessionID, data.assistantMessageID, structuredClone(part))];
        }
        case 'session.reasoning.delta': {
          const { data } = event;
          const tracker = assistantOf(data.sessionID, data.assistantMessageID);
          if (tracker?.openReasoning === undefined) return [];
          const target = tracker.parts[tracker.openReasoning];
          if (target?.type === 'reasoning') target.text += data.delta;
          return [
            {
              type: 'part.delta',
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              partID: contentPartId(data.assistantMessageID, tracker.openReasoning),
              field: 'text',
              delta: data.delta,
            },
          ];
        }
        case 'session.reasoning.ended': {
          const { data } = event;
          const tracker = assistantOf(data.sessionID, data.assistantMessageID);
          if (tracker?.openReasoning === undefined) return [];
          const part: Part = {
            type: 'reasoning',
            id: contentPartId(data.assistantMessageID, tracker.openReasoning),
            text: data.text,
            completed: true,
          };
          tracker.parts[tracker.openReasoning] = part;
          tracker.openReasoning = undefined;
          return [upsertPart(data.sessionID, data.assistantMessageID, structuredClone(part))];
        }

        case 'session.tool.input.started': {
          const { data } = event;
          const tracker = assistantOf(data.sessionID, data.assistantMessageID);
          if (tracker === undefined) return [];
          const index = tracker.count++;
          const tool: Extract<Part, { type: 'tool' }> = {
            type: 'tool',
            id: data.id,
            name: data.name,
            state: { status: 'streaming', input: '' },
          };
          tracker.tools.set(data.id, tool);
          tracker.parts[index] = tool;
          return [upsertPart(data.sessionID, data.assistantMessageID, structuredClone(tool))];
        }
        case 'session.tool.input.delta': {
          const { data } = event;
          const tool = assistantOf(data.sessionID, data.assistantMessageID)?.tools.get(data.id);
          if (tool?.state.status !== 'streaming') return [];
          tool.state = { status: 'streaming', input: tool.state.input + data.delta };
          return [
            {
              type: 'part.delta',
              sessionID: data.sessionID,
              messageID: data.assistantMessageID,
              partID: data.id,
              field: 'input',
              delta: data.delta,
            },
          ];
        }
        case 'session.tool.input.ended': {
          const { data } = event;
          return setToolState(data.sessionID, data.assistantMessageID, data.id, () => ({
            status: 'streaming',
            input: data.text,
          }));
        }
        case 'session.tool.called': {
          const { data } = event;
          return setToolState(data.sessionID, data.assistantMessageID, data.id, () => ({
            status: 'running',
            input: toJsonObject(data.input),
            metadata: {},
          }));
        }
        case 'session.tool.progress': {
          const { data } = event;
          return setToolState(data.sessionID, data.assistantMessageID, data.id, (tool) => ({
            status: 'running',
            input: inputOf(tool),
            metadata: toJsonObject(data.metadata),
          }));
        }
        case 'session.tool.success': {
          const { data } = event;
          return setToolState(data.sessionID, data.assistantMessageID, data.id, (tool) => {
            const done: ToolState = {
              status: 'completed',
              input: inputOf(tool),
              output: data.content.map(toToolOutput),
            };
            if (data.metadata !== undefined) done.metadata = toJsonObject(data.metadata);
            return done;
          });
        }
        case 'session.tool.failed': {
          const { data } = event;
          return setToolState(data.sessionID, data.assistantMessageID, data.id, (tool) => {
            const failed: ToolState = {
              status: 'error',
              input: inputOf(tool),
              error: toStructuredErrorInfo(data.error, secrets),
            };
            if (data.content !== undefined) failed.output = data.content.map(toToolOutput);
            if (data.metadata !== undefined) failed.metadata = toJsonObject(data.metadata);
            return failed;
          });
        }

        // Requests belong to the LOCATION, so they are forwarded whatever the session (phase 3).
        case 'permission.asked': {
          return [{ type: 'permission.asked', permission: toPermissionAsk(event.data) }];
        }
        case 'permission.replied': {
          return [
            {
              type: 'permission.resolved',
              sessionID: event.data.sessionID,
              permissionID: event.data.requestID,
              decision: event.data.reply,
            },
          ];
        }
        case 'form.created': {
          return [{ type: 'form.asked', form: toFormAsk(event.data.form) }];
        }
        case 'form.replied':
        case 'form.cancelled': {
          return [
            {
              type: 'form.resolved',
              sessionID: event.data.sessionID,
              formID: event.data.id,
              outcome: event.type === 'form.replied' ? 'answered' : 'cancelled',
            },
          ];
        }

        default:
          // Includes `session.status` / `session.idle` (not published by 2.0.32, ignored on
          // purpose), `server.connected`, `location.shutdown` and `session.forked` (the controller
          // handles those; the last has no title, so it reads the row, issue #21).
          return [];
      }
    },
  };
}
