/**
 * Pure logic of the subagent monitor (E2-subagent-monitor, issue #189): the state of a child
 * session in words, the reason of a failure, the tool call of a digest as a `ToolPart`, the elapsed
 * time, which child a `subagent` tool block belongs to, and the one-line summary of a finished child.
 * No DOM and no Solid: `subagentView.test.ts` drives it with plain objects, and the cards and the
 * bar only render what it returns.
 *
 * Where the data comes from: the digest (`SubagentActivity`) says what the child DID (tools, time);
 * who the child is (agent, title, cost, outcome) and whether it is busy live in `sessions` and
 * `statuses`; whether it waits for the user lives in `requests`. This module joins them and decides
 * nothing about layout.
 *
 * Provenance: the failure and cancellation texts ("Subagent failed (sessionID: X): <message>",
 * "Subagent cancelled (sessionID: X)") and the fact that the child is created with the tool's
 * `description` as title and its `agent` were READ in `packages/core/src/tool/plugin/subagent.ts`
 * of opencode 2.0.32 (tag 843a6c51); no real subagent turn was observed, so every test here uses
 * fabricated data.
 */
import * as l10n from '@vscode/l10n';
import { plural } from '../../../src/shared/l10n';
import type {
  ErrorInfo,
  Part,
  SessionStatus,
  SessionSummary,
  SubagentActivity,
  SubagentTool,
} from '../../../src/shared/model';
import { formatCost } from '../chat/usage';
import { childrenOf, subagentOf } from '../sessions/lineage';

/** What a child is doing, in the words the UI uses (always shown as text, never only as colour). */
export type ChildState = 'waiting' | 'working' | 'failed' | 'stopped' | 'done';

/** What {@link childState} reads about one child. */
export interface ChildFacts {
  /** The child's row (`sessions`): its `outcome` decides failed/stopped once it is idle. */
  row?: SessionSummary;
  /** The child's live status (`statuses`). */
  status?: SessionStatus;
  /** The host's digest; its `running` is only a fallback when no status is known. */
  activity?: SubagentActivity;
  /** True when the child has a permission or form pending in `requests`. */
  waiting: boolean;
  /** The error text of the PARENT's `subagent` tool block, when that block failed. */
  parentError?: string;
  /**
   * True when the PARENT's `subagent` block that created this child is still `running` while the
   * parent is busy or retrying: the child is about to start (issue #200). Only read when the child
   * has no status of its own and no finished run.
   */
  starting?: boolean;
}

/**
 * The state of a child. Precedence: `waiting` (the user is needed) beats `working`, which beats the
 * finished ones: `failed` (status `error`, outcome `failed`, or the parent block says "Subagent
 * failed"), then `stopped` (outcome `interrupted` or "Subagent cancelled"), else `done`.
 *
 * Why the tool block alone cannot say it: with `background: true` the tool returns at once with
 * `status: "running"` while the child keeps going, so liveness comes from the child's own status.
 * With no status known (a child the host has not reported yet) the digest's `running` stands in, and
 * so does `starting`: a child is created (`session.created`) before its first `session.execution.*`,
 * so for that gap it has no status and a digest with `running: false`, and without `starting` it
 * would read `done` and the bar would blink away (issue #200). `starting` only counts with no status
 * (any `session.status` of the child wins), with no `endedAt` in the digest and with no `outcome` in
 * its row (a child that already finished a run does not "start" because of a stale block; same
 * precedence as `activity.running`, so `failed` and `stopped` still show).
 * VERIFIED by `subagentView.test.ts` "ranks waiting over working over the finished states" and
 * "a background child whose tool already completed is still working" (fabricated facts), and by
 * "counts a starting child as working only with no status and no finished run" (fabricated facts).
 * HYPOTHESIS: the creation-to-start gap exists in the real server but lasts milliseconds (read in
 * subagent.ts@843a6c51, not measured).
 */
export function childState(facts: ChildFacts): ChildState {
  if (facts.waiting) return 'waiting';
  const type = facts.status?.type;
  if (type === 'busy' || type === 'retry') return 'working';
  if (
    type === undefined &&
    (facts.activity?.running === true ||
      (facts.starting === true &&
        facts.activity?.endedAt === undefined &&
        facts.row?.outcome === undefined))
  ) {
    return 'working';
  }
  if (type === 'error' || facts.row?.outcome === 'failed') return 'failed';
  if (facts.parentError !== undefined && isFailure(facts.parentError)) return 'failed';
  if (facts.row?.outcome === 'interrupted') return 'stopped';
  if (facts.parentError !== undefined && wasCancelled(facts.parentError)) return 'stopped';
  return 'done';
}

const FAILED_PREFIX = /^Subagent failed \(sessionID: [^)]*\):\s*/;
const CANCELLED_PREFIX = /^Subagent cancelled\b/;

/** True when `text` is the failure the `subagent` tool reports ("Subagent failed (sessionID: X): …"). */
function isFailure(text: string): boolean {
  return FAILED_PREFIX.test(text);
}

/** True when `text` is the cancellation the `subagent` tool reports ("Subagent cancelled (sessionID: X)"). */
export function wasCancelled(text: string): boolean {
  return CANCELLED_PREFIX.test(text);
}

/**
 * The reason of a failed child: the tool's error text without its "Subagent failed (sessionID: X): "
 * prefix, or the text itself when it has none (any other tool error). Trimmed.
 */
export function failureReason(text: string): string {
  return text.replace(FAILED_PREFIX, '').trim();
}

/**
 * The tool call of a digest as a `Part` of type `tool`, so the normal `toolSummary` can say
 * "Read src/a.ts · done" and there is no second mapping of tools. The digest keeps no output, so a
 * completed call has an empty one; an error call gets `tool.execution` as its code, because the
 * digest carries only the text.
 */
export function toolPartOf(tool: SubagentTool): Extract<Part, { type: 'tool' }> {
  switch (tool.status) {
    case 'running':
      return {
        type: 'tool',
        id: tool.id,
        name: tool.name,
        state: { status: 'running', input: tool.input },
      };
    case 'completed':
      return {
        type: 'tool',
        id: tool.id,
        name: tool.name,
        state: { status: 'completed', input: tool.input, output: [] },
      };
    case 'error': {
      const error: ErrorInfo = { code: 'tool.execution', message: tool.error ?? '' };
      return {
        type: 'tool',
        id: tool.id,
        name: tool.name,
        state: { status: 'error', input: tool.input, error },
      };
    }
  }
}

/**
 * Elapsed time as `m:ss`, or `h:mm:ss` from an hour on, for a duration in milliseconds. A negative
 * or non-finite value (a clock that went back) reads `0:00`; seconds are floored.
 */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${String(minutes)}:${pad(seconds)}`;
}

/** The string under `key` of a tool input, or `undefined`. */
function inputString(part: Extract<Part, { type: 'tool' }>, key: string): string | undefined {
  if (part.state.status === 'streaming') return undefined;
  const value = part.state.input[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * The child session a `subagent` tool block belongs to, or `undefined`.
 *
 * First the block's own link (`subagentOf`: `metadata.sessionID`), when that row is a child of
 * `openID`. REST gives `metadata: {}` to a tool still running (HYPOTHESIS, see `lineage.ts`), so after
 * a resync a block of a live child has no link; then the child is recognised by what the tool
 * created it with (title = `input.description`, agent = `input.agent`, parent = the open session).
 * With two or more candidates (two calls with the same description) NONE is returned: guessing
 * would put the Stop button of one child on the card of another.
 * VERIFIED by `subagentView.test.ts` "falls back to title and agent, and gives none on a tie".
 */
export function childForTool(
  part: Part,
  sessions: { readonly [sessionID: string]: SessionSummary },
  openID: string | undefined,
): SessionSummary | undefined {
  if (part.type !== 'tool' || part.name !== 'subagent' || openID === undefined) return undefined;
  const linked = subagentOf(part);
  if (linked !== undefined) {
    const row = sessions[linked.sessionID];
    return row?.parentID === openID ? row : undefined;
  }
  const description = inputString(part, 'description');
  const agent = inputString(part, 'agent');
  if (description === undefined || agent === undefined) return undefined;
  const candidates = childrenOf(sessions, openID).filter(
    (row) => row.title === description && row.agent === agent,
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** What {@link summaryLine} reads. */
export interface SummaryFacts {
  state: ChildState;
  toolCount: number;
  /** True when `toolCount` is a lower bound ("200+"). */
  partial?: boolean;
  /** The server's cost of the child in USD; shown only when positive. */
  cost?: number;
  /** The failure reason, for `failed`. */
  reason?: string;
}

/** "3 tools", "1 tool" or "200+ tools" for the summary and the live line; empty for none. */
export function toolsText(count: number, partial: boolean | undefined): string {
  if (count <= 0) return '';
  if (partial === true) return l10n.t('{0}+ tools', count);
  return plural(count, l10n.t('{0} tool', count), l10n.t('{0} tools', count));
}

/**
 * The one line a card shows once its child is no longer live: "Finished · 3 tools · $0.02",
 * "Failed: <reason>" or "Stopped"; `undefined` while the child works or waits (the live section
 * says it). The whole line is ONE string (lesson #926: JSX drops the line break between an
 * expression and the text that follows). The cost is the server's figure, shown only when positive.
 * VERIFIED by `subagentView.test.ts` "builds the summary of a finished, failed and stopped child".
 */
export function summaryLine(facts: SummaryFacts): string | undefined {
  switch (facts.state) {
    case 'waiting':
    case 'working':
      return undefined;
    case 'failed':
      return facts.reason === undefined || facts.reason === ''
        ? l10n.t('Failed')
        : l10n.t('Failed: {0}', facts.reason);
    case 'stopped':
      return l10n.t('Stopped');
    case 'done': {
      const parts = [l10n.t('Finished'), toolsText(facts.toolCount, facts.partial)];
      if (facts.cost !== undefined && facts.cost > 0) parts.push(formatCost(facts.cost));
      return parts.filter((part) => part !== '').join(' · ');
    }
  }
}
