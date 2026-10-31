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
//   - `session.model.selected` / `session.agent.selected` (issues #23/#24) update the model / agent
//     of a MIRRORED row and bump its `updatedAt` (the server bumps `time.updated` too, VERIFIED in
//     the issue #23 spike, opencode 2.0.32, Windows 11, 21/10/2026); a row it does not know gives
//     `[]` and the next snapshot brings it. The reload events of the catalog (`model.updated`,
//     `agent.updated`...) are NOT handled here: the controller reloads the catalog itself.
//   - `session.usage.updated` (issue #25) carries the ACCUMULATED cost and tokens of a session and
//     is volatile (no `durable`). A MIRRORED row becomes a `session.upserted` with the new `usage`
//     and an untouched `updatedAt` (usage is not activity: the title generation also publishes
//     it); a row it does not know gives `[]`. Either way the latest usage is remembered (bounded),
//     so `mergeUsage` can overlay it on the REST rows of a resync that began before it arrived.
//     VERIFIED by the planner spike (opencode 2.0.32, Windows 11, 22/10/2026); not re-run here:
//     the totals of `usage.updated` equal `session.get` and `session.list` after a turn
//     (plan line "tras el turno `usage.updated` = `GET` = `list` = `{input:4951, output:4,
//     cache.read:4608}`"). UNVERIFIED for paid models and for the compaction usage in a live VS Code.
//   - `session.compaction.started|ended|failed` (issue #125) become ONE `notice` message that is
//     upserted in place: `started` draws "Compacting…" with the id of the inbox item (`inputID`, the
//     id of the REST `compaction` message too), `ended` and `failed` (which may lack `inputID`) update
//     it through a bounded per-session memory, and a turn that closes with the compaction still
//     running turns the line into a failure ("it did not finish"). Stop of a manual compaction
//     DOES publish `failed {type:'aborted', message:'Compaction cancelled', inputID}` (read in
//     `runner/llm.ts@843a6c51` L150-158); the abandon path is only a net for a lost `failed`.
//     `compaction.delta` is ignored.
//     The order started -> ended was recorded from a real 2.0.32 (planner spike #25, Windows 11,
//     22/10/2026); `failed` and the abandoned case come from the types and the source only.
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
  SessionUsage,
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
  compactionNotice,
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
  /** The session the message belongs to: seeding, pruning and merging work per session. */
  sessionID: string;
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

/** Fresh tracker for an assistant message of `sessionID` that the stream has just announced. */
const newTracker = (sessionID: string, info: AssistantTracker['info']): AssistantTracker => ({
  sessionID,
  info,
  count: 0,
  lastText: undefined,
  openReasoning: undefined,
  tools: new Map(),
  parts: [],
  origin: 'stream',
});

/** What `enqueued` told us about a user prompt, kept until its `delivered`. */
type PendingUser = {
  sessionID: string;
  text: string;
  files: ReturnType<typeof toAttachments>;
};

/** A user message the stream delivered, with the session it belongs to. */
type LiveUser = {
  sessionID: string;
  user: Extract<MessageInfo, { kind: 'user' }>;
};

/** Bound on the per-session statuses remembered between two resyncs. Our own choice. */
const MAX_LIVE_STATUSES = 256;

/**
 * Bound on the rows the mirror of sessions may hold. It matters when `seed` only adds to the
 * mirror (several panes: the seed of one must not forget the rows another needs) or when pages of
 * the session list are mirrored between two seeds. Our own choice: far above the 50 newest rows of
 * one snapshot plus the lineage of a handful of panes; the oldest inserted row is evicted first.
 */
const MAX_MIRROR_ROWS = 1000;

/**
 * Opaque stamp of one resync, given by {@link EventTranslator.beginResync}: the statuses and totals
 * the stream produced AFTER it. Two overlapping resyncs each keep their own stamp, so the second
 * one starting cannot erase what the first still has to overlay (R2 of the E9 plan).
 */
export interface ResyncToken {
  readonly since: number;
}

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
  /** Messages of the session `sessionID` as REST returned them (any order). */
  messages: SessionMessageInfo[];
  /**
   * The session `messages` belong to. Optional only for the single-session callers: absent means
   * "the one tracked session", or none when zero or several are tracked.
   */
  sessionID?: string | undefined;
  /**
   * True when the mirror must only be added to. Default (false): it is replaced by `sessions`,
   * which is what bounds its size when one surface is served.
   */
  merge?: boolean | undefined;
}

/** The translator returned by {@link createEventTranslator}. */
export interface EventTranslator {
  /**
   * Replaces the mirror of sessions and MERGES the REST messages of one session into what the
   * stream already built (emptying it lost everything that arrived between the REST reads and
   * this call: review BLOCKER, 20/10/2026). The mirror is replaced as always, or only added to
   * when `merge` is set (the seed of one pane must not forget the rows of another). Everything
   * below concerns the session of the seed
   * (`TranslatorSeed.sessionID`) and never touches the trackers of another one. Contract:
   *  - Records `restNewest` of that session, the newest `time.created` among the messages passed.
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
   * Marks the start of a resync and returns its stamp. Call it BEFORE the REST reads and hand the
   * stamp to {@link EventTranslator.mergeStatuses} and {@link EventTranslator.mergeUsage}, which
   * then overlay only what the stream said after THAT stamp. Nothing is forgotten here: a second
   * resync starting while the first is still reading used to wipe the overlays the first one
   * needed, and the first then published a stale `busy` (Send blocked) or older totals (R2 of the
   * E9 plan). What the stream said stays remembered, bounded, until newer entries evict it.
   */
  beginResync(): ResyncToken;
  /**
   * Returns `rows` with the `usage` of each session replaced by the latest `session.usage.updated`
   * the stream delivered after `token` (default: the newest stamp), for the rows it saw. The REST
   * rows were read before publication and the totals only grow, so a newer streamed value must
   * win (rule "the snapshot is a photo" of opencode-api §4). Rows it did not see, and every other
   * field, come back untouched; returns `rows` itself when the stream said nothing since.
   */
  mergeUsage(rows: SessionSummary[], token?: ResyncToken): SessionSummary[];
  /**
   * Overlays on `statuses` (read from REST, possibly before the stream moved on) the latest status
   * the stream derived from `session.execution.*` / `retry.scheduled` after `token` (default: the
   * newest stamp). Without it a `succeeded` that arrives during the reads is overwritten by a
   * stale `busy`, and the UI would keep "Working…" with Send disabled.
   */
  mergeStatuses(statuses: Snapshot['statuses'], token?: ResyncToken): Snapshot['statuses'];
  /**
   * Forgets the live user and assistant messages whose id is `messageID` or later (issue #32): a
   * committed revert deleted them on the server, and `mergeLive` would otherwise bring them back
   * as "in flight" (they are newer than whatever REST still lists). Ids ascend, so "later" is a
   * string comparison (`schema/src/session-message.ts` @843a6c51 L27, read). Call it when the
   * `committed` event arrives, BEFORE the messages of the prompt that may follow it. Does not touch
   * the inbox payloads that were not delivered yet. With `sessionID` only that session's messages
   * go: ids of two sessions interleave, so a boundary of one must not erase the other's.
   */
  forgetFrom(messageID: string, sessionID?: string): void;
  /**
   * Sets the sessions whose messages and parts are forwarded (one per chat surface) and clears the
   * message state of the ones that stopped being tracked; state of a session that stays tracked is
   * kept. Permissions and forms are NOT tied to it: they are forwarded for every session (phase
   * 3), and the snapshot carries them at `Snapshot.requests`, outside `OpenSession`.
   */
  setTracked(sessionIDs: readonly string[]): void;
  /** Single-session shorthand of {@link EventTranslator.setTracked}: tracks `sessionID`, or nothing. */
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
 * Issue #25 added `session.usage.updated` and `mergeUsage`. The logic is covered by
 * `eventTranslator.test.ts` with hand-built events (numbers copied from the planner's spike); that
 * the real server sends the event is covered only by the opt-in `realOpencode.test.ts` (its
 * "streams a real prompt to the end" asserts the log line `usage updated for ses_…`).
 * E9-chat-editor-tabs phase 1 (#77) made it multi-session: `setTracked` follows one session per
 * chat surface, the message state is kept per session, and `beginResync` hands out a stamp
 * instead of clearing what the stream said (see {@link ResyncToken}). VERIFIED by the
 * `eventTranslator.multiSession.test.ts` checks "give each its own parts and deltas, addressed to
 * its own session" and "keeps the idle that arrived after the first resync began although a
 * second one began later" (fabricated events, Windows 11, 25/10/2026); not observed with a real
 * server interleaving two sessions.
 */
export function createEventTranslator(secrets: ErrorSecrets = {}): EventTranslator {
  const sessions = new Map<string, SessionSummary>();
  const assistants = new Map<string, AssistantTracker>();
  const pendingUsers = new Map<string, PendingUser>();
  /** User messages the stream delivered, kept (bounded) so `mergeLive` can restore them. */
  const liveUsers = new Map<string, LiveUser>();
  /** Counts every status and usage entry written, so a resync stamp is a position in that order. */
  let sequence = 0;
  /** The stamp of the newest `beginResync`; the default of the merges. */
  let lastResync: ResyncToken = { since: 0 };
  /**
   * Latest status the stream derived per session, with the position it was written at; a resync
   * overlays the ones written after its stamp, to override a stale snapshot. Bounded by eviction.
   */
  const liveStatuses = new Map<string, { status: SessionStatus; at: number }>();
  /**
   * Latest accumulated usage the stream gave per session (bounded like `liveStatuses`), to
   * override a stale REST row. Remembered even for sessions not mirrored.
   */
  const liveUsage = new Map<string, { usage: SessionUsage; at: number }>();
  /** `time.created` of the newest message of the last REST read of each session, by session. */
  const restNewest = new Map<string, number | undefined>();
  /** The sessions whose messages are forwarded (one per chat surface). */
  let tracked = new Set<string>();
  /**
   * The compaction in progress per session (issue #125): the id and start time of its notice, so
   * `ended` (which carries no `inputID`) and `failed` update the line `started` drew. Bounded like
   * `liveStatuses`; an entry leaves when the compaction ends, fails or its turn closes.
   */
  const liveCompactions = new Map<string, { id: string; createdAt: number }>();

  /** Remembers the compaction of `sessionID`, evicting the oldest entry beyond the bound. */
  const rememberCompaction = (sessionID: string, live: { id: string; createdAt: number }): void => {
    if (liveCompactions.size >= MAX_LIVE_STATUSES) {
      const oldest = liveCompactions.keys().next();
      if (!oldest.done) liveCompactions.delete(oldest.value);
    }
    liveCompactions.delete(sessionID);
    liveCompactions.set(sessionID, live);
  };

  /** The tracker of an assistant message of a tracked session, if we know it. */
  const assistantOf = (sessionID: string, messageID: string): AssistantTracker | undefined =>
    tracked.has(sessionID) ? assistants.get(messageID) : undefined;

  /** Adds to the mirror of sessions, evicting the oldest row beyond {@link MAX_MIRROR_ROWS}. */
  const mirrorRow = (row: SessionSummary): void => {
    sessions.delete(row.id);
    sessions.set(row.id, row);
    if (sessions.size > MAX_MIRROR_ROWS) {
      const oldest = sessions.keys().next();
      if (!oldest.done) sessions.delete(oldest.value);
    }
  };

  const status = (sessionID: string, value: SessionStatus): HostToWebview[] => {
    if (liveStatuses.size >= MAX_LIVE_STATUSES) {
      const oldest = liveStatuses.keys().next();
      if (!oldest.done) liveStatuses.delete(oldest.value);
    }
    liveStatuses.delete(sessionID); // re-insert at the end so the oldest is evicted first
    liveStatuses.set(sessionID, { status: value, at: ++sequence });
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

  /**
   * Closes a compaction still running when its turn ends, so the line does not say "Compacting…"
   * for ever. Stop of a manual one publishes `failed` ("Compaction cancelled", read in
   * `runner/llm.ts@843a6c51` L150-158), so this is only a net for a lost `failed` (a stream gap).
   * HYPOTHESIS that the net is ever needed: it would take a dropped event to see it. Gives `[]`
   * when none is live.
   */
  const abandonCompaction = (sessionID: string): HostToWebview[] => {
    const live = liveCompactions.get(sessionID);
    if (live === undefined) return [];
    liveCompactions.delete(sessionID);
    return [
      upsertMessage(
        sessionID,
        compactionNotice(live.id, live.createdAt, 'failed', { detail: 'it did not finish' }),
      ),
    ];
  };

  /** Builds the tracker of one REST assistant message (counters and open blocks come from `content[]`). */
  const trackerFromMessage = (
    sessionID: string,
    info: SessionMessageInfo,
  ): AssistantTracker | undefined => {
    if (info.type !== 'assistant') return undefined;
    const mapped = toAssistantMessage(info, secrets);
    if (mapped.message.kind !== 'assistant') return undefined;
    const tracker: AssistantTracker = {
      sessionID,
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
      lastResync = { since: sequence };
      return lastResync;
    },

    mergeUsage(rows, token = lastResync) {
      if (![...liveUsage.values()].some((entry) => entry.at > token.since)) return rows;
      return rows.map((row) => {
        const entry = liveUsage.get(row.id);
        return entry === undefined || entry.at <= token.since
          ? row
          : { ...row, usage: entry.usage };
      });
    },

    mergeStatuses(statuses, token = lastResync) {
      const newer = [...liveStatuses].filter(([, entry]) => entry.at > token.since);
      if (newer.length === 0) return statuses;
      return {
        ...statuses,
        ...Object.fromEntries(newer.map(([id, entry]) => [id, entry.status])),
      };
    },

    seed({ sessions: rows, messages, sessionID: given, merge }) {
      // The mirror is replaced, as it always was, unless the caller serves several panes: then the
      // seed of one only adds, or it would forget the lineage rows another pane shows.
      if (merge !== true) sessions.clear();
      for (const row of rows) mirrorRow(row);
      const sessionID = given ?? (tracked.size === 1 ? [...tracked][0] : undefined) ?? '';
      const listed = new Set(messages.map((message) => message.id));
      const newestRest = messages.reduce<number | undefined>(
        (max, message) =>
          max === undefined ? message.time.created : Math.max(max, message.time.created),
        undefined,
      );
      restNewest.set(sessionID, newestRest);
      for (const message of messages) {
        const fromRest = trackerFromMessage(sessionID, message);
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
      // REST's newest message, since a newer one is a message in flight REST has not seen. Only
      // the seeded session's own trackers are pruned: another session's are not REST's to judge.
      for (const [id, tracker] of assistants) {
        if (tracker.sessionID !== sessionID || listed.has(id)) continue;
        const older = newestRest !== undefined && tracker.info.createdAt < newestRest;
        if (tracker.origin === 'seed' || older) assistants.delete(id);
      }
      if (newestRest !== undefined) {
        for (const [id, live] of liveUsers) {
          if (live.sessionID !== sessionID) continue;
          if (listed.has(id) || live.user.createdAt < newestRest) liveUsers.delete(id);
        }
      }
    },

    mirror(rows) {
      for (const row of rows) mirrorRow(row);
    },

    mergeLive(snapshot) {
      const known = new Map(snapshot.messages.map((message, index) => [message.id, index]));
      const extraMessages: MessageInfo[] = [];
      const parts = { ...snapshot.parts };
      let changed = false;
      const newestRest = restNewest.get(snapshot.sessionID);
      /** True when the item is newer than the newest message REST returned (so, in flight). */
      const isNewer = (createdAt: number): boolean =>
        newestRest === undefined || createdAt >= newestRest;
      for (const { sessionID, user } of liveUsers.values()) {
        if (sessionID !== snapshot.sessionID) continue;
        if (known.has(user.id) || !isNewer(user.createdAt)) continue;
        extraMessages.push(user);
        changed = true;
      }
      for (const tracker of assistants.values()) {
        if (tracker.sessionID !== snapshot.sessionID) continue;
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

    forgetFrom(messageID, sessionID) {
      for (const [id, tracker] of [...assistants]) {
        if (id >= messageID && (sessionID === undefined || tracker.sessionID === sessionID)) {
          assistants.delete(id);
        }
      }
      for (const [id, live] of [...liveUsers]) {
        if (id >= messageID && (sessionID === undefined || live.sessionID === sessionID)) {
          liveUsers.delete(id);
        }
      }
    },

    setTracked(sessionIDs) {
      const next = new Set(sessionIDs);
      for (const [id, tracker] of [...assistants]) {
        if (!next.has(tracker.sessionID)) assistants.delete(id);
      }
      for (const [id, pending] of [...pendingUsers]) {
        if (!next.has(pending.sessionID)) pendingUsers.delete(id);
      }
      for (const [id, live] of [...liveUsers]) {
        if (!next.has(live.sessionID)) liveUsers.delete(id);
      }
      for (const id of [...restNewest.keys()]) if (!next.has(id)) restNewest.delete(id);
      for (const id of [...liveCompactions.keys()]) if (!next.has(id)) liveCompactions.delete(id);
      tracked = next;
    },

    setOpen(sessionID) {
      this.setTracked(sessionID === undefined ? [] : [sessionID]);
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
        case 'session.model.selected': {
          const row = sessions.get(event.data.sessionID);
          if (row === undefined) return []; // not mirrored: a snapshot will bring the full row
          const next: SessionSummary = {
            ...row,
            model: toModelRef(event.data.model),
            updatedAt: event.created,
          };
          sessions.set(next.id, next);
          return [{ type: 'session.upserted', session: next }];
        }
        case 'session.agent.selected': {
          const row = sessions.get(event.data.sessionID);
          if (row === undefined) return [];
          const next: SessionSummary = {
            ...row,
            agent: event.data.agent,
            updatedAt: event.created,
          };
          sessions.set(next.id, next);
          return [{ type: 'session.upserted', session: next }];
        }
        case 'session.usage.updated': {
          const { data } = event;
          const usage: SessionUsage = { cost: data.cost, tokens: toTokenUsage(data.tokens) };
          if (liveUsage.size >= MAX_LIVE_STATUSES) {
            const oldest = liveUsage.keys().next();
            if (!oldest.done) liveUsage.delete(oldest.value);
          }
          liveUsage.delete(data.sessionID); // re-insert at the end so the oldest is evicted first
          liveUsage.set(data.sessionID, { usage, at: ++sequence });
          const row = sessions.get(data.sessionID);
          if (row === undefined) return []; // not mirrored: a snapshot will bring the full row
          const next: SessionSummary = { ...row, usage };
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
          return [
            ...abandonCompaction(event.data.sessionID),
            ...status(event.data.sessionID, { type: 'idle' }),
          ];
        case 'session.execution.failed': {
          const error: ErrorInfo = toStructuredErrorInfo(event.data.error, secrets);
          return [
            ...abandonCompaction(event.data.sessionID),
            ...status(event.data.sessionID, { type: 'error', error }),
          ];
        }

        // Compaction (issue #125): `started` draws the running line, `ended` / `failed` update the
        // same one. `session.compaction.delta` (the summary streaming) is ignored on purpose.
        case 'session.compaction.started': {
          const { data } = event;
          if (!tracked.has(data.sessionID)) return [];
          const live = { id: data.inputID ?? `compaction:${event.id}`, createdAt: event.created };
          rememberCompaction(data.sessionID, live);
          return [
            upsertMessage(data.sessionID, compactionNotice(live.id, live.createdAt, 'running')),
          ];
        }
        case 'session.compaction.ended': {
          const { data } = event;
          if (!tracked.has(data.sessionID)) return [];
          const live = liveCompactions.get(data.sessionID);
          liveCompactions.delete(data.sessionID);
          return [
            upsertMessage(
              data.sessionID,
              compactionNotice(
                live?.id ?? `compaction:${event.id}`,
                live?.createdAt ?? event.created,
                'completed',
                { auto: data.reason === 'auto' },
              ),
            ),
          ];
        }
        case 'session.compaction.failed': {
          const { data } = event;
          if (!tracked.has(data.sessionID)) return [];
          const live = liveCompactions.get(data.sessionID);
          liveCompactions.delete(data.sessionID);
          return [
            upsertMessage(
              data.sessionID,
              compactionNotice(
                data.inputID ?? live?.id ?? `compaction:${event.id}`,
                live?.createdAt ?? event.created,
                'failed',
                { detail: toStructuredErrorInfo(data.error, secrets).message },
              ),
            ),
          ];
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
          if (!tracked.has(data.sessionID) || data.item.type !== 'user') return [];
          if (pendingUsers.size >= MAX_PENDING_INBOX) {
            const oldest = pendingUsers.keys().next();
            if (!oldest.done) pendingUsers.delete(oldest.value);
          }
          pendingUsers.set(data.inboxID, {
            sessionID: data.sessionID,
            text: data.item.payload.text,
            files: toAttachments(data.item.payload.files),
          });
          return [];
        }
        case 'session.inbox.delivered': {
          const { data } = event;
          const pending = pendingUsers.get(data.inboxID);
          if (!tracked.has(data.sessionID) || pending === undefined) return [];
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
          liveUsers.set(user.id, { sessionID: data.sessionID, user });
          return [upsertMessage(data.sessionID, user)];
        }

        case 'session.step.started': {
          const { data } = event;
          if (!tracked.has(data.sessionID)) return [];
          const info: AssistantTracker['info'] = {
            kind: 'assistant',
            id: data.assistantMessageID,
            createdAt: data.started,
            agent: data.agent,
            model: toModelRef(data.model),
          };
          const existing = assistants.get(info.id);
          if (existing === undefined) {
            assistants.set(info.id, newTracker(data.sessionID, info));
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
          // handles those; the last has no title, so it reads the row, issue #21) and the
          // `session.revert.*` events (the controller handles them in `watchChangedFiles`: the
          // revert travels as `session.revert` or inside the snapshot, issue #32).
          return [];
      }
    },
  };
}
