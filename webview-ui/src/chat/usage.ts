/**
 * Pure logic of the context and cost line under the session title (issue #25): which assistant
 * message says how full the context is, what the session costs, and the words of the line. No DOM
 * and no Solid: `usage.test.ts` drives it with plain objects, and `UsageIndicator.tsx` only
 * renders what {@link describeUsage} returns.
 *
 * The webview COMPUTES the context from data it already holds (the assistant messages, the
 * catalog, the snapshot's `compactedAt`) and the host only transports it (decision of the plan
 * #1093; the alternative, a `session.context` message built by the host, would duplicate
 * `message.upserted` and force the translator to know the catalog).
 *
 * The context rule follows the opencode client (`client/src/solid/usage.ts`, `lastAssistantWithUsage`,
 * tag v2.0.32, read with `gh api` on 22/10/2026): the LAST assistant message that has token usage
 * and was created after the last completed compaction; context = input + output + reasoning +
 * cache read + cache write; percent = context / the context limit of THAT message's model. The
 * revert boundary of upstream is left out (no revert yet, issue #32 must add it: UNVERIFIED).
 * Differences that are ours: a message whose total is 0 (a step that failed before the model
 * answered) is skipped instead of hiding the line, and the 80 % "high" level is our own threshold.
 */
import type {
  Catalog,
  MessageInfo,
  ModelOption,
  ModelRef,
  SessionSummary,
  TokenUsage,
} from '../../../src/shared/model';
import { compactTokens, findModel } from '../selectors/selection';
import { childrenOf } from '../sessions/lineage';

/** Percent of the context window from which the line is flagged (our choice, not opencode's). */
export const HIGH_CONTEXT_PERCENT = 80;

/** How full the context is: tokens in the prompt of the last answered step, and the share of the limit. */
export interface ContextUsage {
  /** input + output + reasoning + cache read + cache write of the message. */
  tokens: number;
  /** The model that answered, as the message names it. */
  model: ModelRef;
  /** `contextLimit` of that model in the catalog; absent when the catalog does not know it. */
  limit?: number;
  /** `tokens / limit` as a whole percent (rounded, may exceed 100); absent without `limit`. */
  percent?: number;
}

/** Cost of the open session and whether the figure includes the direct subagent children. */
export interface SessionCost {
  usd: number;
  withSubagents: boolean;
}

/** Everything the header needs to draw the line. */
export interface UsageView {
  /** The visible words, e.g. "Context 9K / 200K (5%) · $0.02". */
  text: string;
  /** Accessible name and tooltip: the same facts with exact figures, one string. */
  name: string;
  /** `high` from {@link HIGH_CONTEXT_PERCENT}; the text still says the percentage (not colour alone). */
  level: 'normal' | 'high';
}

/** Sum of every token counter of `usage`. */
function totalOf(usage: TokenUsage): number {
  return usage.input + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite;
}

/**
 * The context of the open session, or `undefined` when no message qualifies.
 *
 * Walks `messages` from the end for the first assistant message with a positive token total whose
 * `createdAt` is after `compactedAt` (epoch ms of the last completed compaction; none when
 * absent). The percentage needs the model in `catalog` with a positive `contextLimit`; a model
 * that left the catalog still gives the token count, without a limit.
 * VERIFIED by the planner spike (opencode 2.0.32, Windows 11, 22/10/2026); not re-run here: two
 * sessions with the same prompt reported `4912+2+4096` and `48+2+8960` tokens, both 9010, so the
 * sum is coherent whatever the cache split (plan line "Real: 4912+2+4096 = 9010 y 48+2+8960 =
 * 9010"). HYPOTHESIS: a compaction filter against
 * `createdAt` equals upstream's order-based one (only the manual compaction was seen).
 */
export function contextUsage(
  messages: readonly MessageInfo[],
  compactedAt: number | undefined,
  catalog: Catalog | undefined,
): ContextUsage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.kind !== 'assistant' || message.tokens === undefined) continue;
    if (compactedAt !== undefined && message.createdAt <= compactedAt) continue;
    const tokens = totalOf(message.tokens);
    if (tokens <= 0) continue;
    const result: ContextUsage = { tokens, model: message.model };
    const limit = findModel(catalog, message.model)?.contextLimit;
    if (limit !== undefined && limit > 0) {
      result.limit = limit;
      result.percent = Math.round((tokens / limit) * 100);
    }
    return result;
  }
  return undefined;
}

/**
 * The cost of session `openID` plus its DIRECT subagent children (decision of Sergio, 22/10/2026,
 * as upstream's `data.ts` does for the loaded family), or `undefined` when the open row carries no
 * usage. Only the children the snapshot brings (`childrenOf`, up to 50) are added; grandchildren
 * are not. `withSubagents` is true when at least one child row exists, so the wording never claims
 * subagents that are not there. The figure is the server's (`SessionInfo.cost`), never derived.
 */
export function sessionCost(
  sessions: { readonly [sessionID: string]: SessionSummary },
  openID: string,
): SessionCost | undefined {
  const own = sessions[openID]?.usage;
  if (own === undefined) return undefined;
  const children = childrenOf(sessions, openID);
  let usd = own.cost;
  for (const child of children) usd += child.usage?.cost ?? 0;
  return { usd, withSubagents: children.length > 0 };
}

/**
 * Whether the cost is worth showing: any positive cost is; a zero cost only when the model is
 * paid or unknown to the catalog, because "$0.00" next to a free model says nothing (upstream
 * hides it too). "Unknown" means the catalog EXISTS and the model is not in it (Sergio's decision
 * of 22/10/2026, Engram #1115). With no model at all, or with no catalog yet, there is nothing to
 * judge, so a zero cost is hidden: the catalog loads in parallel with the snapshot, and reading
 * "no catalog" as "unknown" flashed "$0.00" on a free model after every reload (and would stick
 * if the catalog never loads). HYPOTHESIS for the flash itself: derived from the load order, not
 * observed; `usage.test.ts` covers the three cases (no catalog, free, paid/outside the catalog).
 */
export function showCost(
  usd: number,
  model: ModelRef | undefined,
  catalog: Catalog | undefined,
): boolean {
  if (usd > 0) return true;
  if (model === undefined) return false;
  if (catalog === undefined) return false;
  const option: ModelOption | undefined = findModel(catalog, model);
  return option === undefined || !option.free;
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * "$0.02", or "<$0.01" for a positive amount that rounds to zero. Fixed `en-US` so the text does
 * not depend on the OS locale (the figure is the server's USD).
 */
export function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return USD.format(usd);
}

/** The exact count with thousands separators ("9,010"), fixed `en-US`. */
function exact(count: number): string {
  return count.toLocaleString('en-US');
}

/**
 * Builds the line, or `undefined` when there is neither a context nor a cost worth showing (no
 * session, or no usage yet). Both strings are ONE string each (lesson #926: JSX drops line breaks
 * between an expression and the text that follows).
 *
 * Visible: "Context 9K / 200K (5%) · $0.02"; without a known limit "Context 9K · $0.02"; with only a
 * cost "Cost $0.02". Name and tooltip: "Context: 9,010 tokens of 200,000 (5%). Session cost: $0.02,
 * including subagents." The "including subagents" clause appears only when the figure really
 * adds a child session. HYPOTHESIS: a real screen reader was not run; `usage.test.ts` and
 * `UsageIndicator.test.tsx` check the strings only.
 */
export function describeUsage(
  context: ContextUsage | undefined,
  cost: SessionCost | undefined,
  catalog: Catalog | undefined,
  fallbackModel: ModelRef | undefined,
): UsageView | undefined {
  const costShown =
    cost !== undefined && showCost(cost.usd, context?.model ?? fallbackModel, catalog);
  if (context === undefined && !costShown) return undefined;

  const text: string[] = [];
  const name: string[] = [];
  if (context !== undefined) {
    let visible = `Context ${compactTokens(context.tokens)}`;
    let spoken = `Context: ${exact(context.tokens)} tokens`;
    if (context.limit !== undefined && context.percent !== undefined) {
      visible += ` / ${compactTokens(context.limit)} (${String(context.percent)}%)`;
      spoken += ` of ${exact(context.limit)} (${String(context.percent)}%)`;
    }
    text.push(visible);
    name.push(`${spoken}.`);
  }
  if (cost !== undefined && costShown) {
    const amount = formatCost(cost.usd);
    text.push(context === undefined ? `Cost ${amount}` : amount);
    name.push(`Session cost: ${amount}${cost.withSubagents ? ', including subagents' : ''}.`);
  }
  const high = context?.percent !== undefined && context.percent >= HIGH_CONTEXT_PERCENT;
  return { text: text.join(' · '), name: name.join(' '), level: high ? 'high' : 'normal' };
}
