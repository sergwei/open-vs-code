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
 * revert boundary of upstream is applied by the CALLER (issue #32): `UsageIndicator.tsx` passes the
 * messages without the ones a prepared revert hides (`splitAtRevert`), so this function sees only
 * what the model will see.
 * Differences that are ours: a message whose total is 0 (a step that failed before the model
 * answered) is skipped instead of hiding the line, and the 80 % "high" level is our own threshold.
 */
import * as l10n from '@vscode/l10n';
import { currentLocale } from '../../../src/shared/l10n';
import type {
  Catalog,
  MessageInfo,
  ModelOption,
  ModelRef,
  SessionSummary,
  TokenUsage,
} from '../../../src/shared/model';
import { LOADED_MESSAGE_LIMIT } from '../../../src/shared/protocol';
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

/** The figures of the "Usage" section of the Session tab (issue #188). */
export interface UsageBreakdown {
  /** Prompt tokens of the whole session: non-cached input plus cache read and write. */
  inputTokens: number;
  /** Generated tokens of the whole session: output plus reasoning. */
  outputTokens: number;
  /** The server's cost (with direct subagents), absent when it is not worth showing ({@link showCost}). */
  cost: SessionCost | undefined;
  /** User messages among the loaded ones. */
  turns: number;
  /** True when the loaded messages reached {@link LOADED_MESSAGE_LIMIT}, so `turns` is a lower bound. */
  partial: boolean;
}

/**
 * The usage of the open session in four figures, or `undefined` when the session row carries no
 * usage yet. Tokens and cost are the SERVER's session totals (`SessionInfo.tokens`/`cost`, which
 * include the title generation and compactions that no message carries), never a sum of the
 * messages; the turns are the user messages among those the host loaded, which is all the webview
 * knows. `messages` are the ones the caller shows (a prepared revert hides some, see
 * `UsageIndicator`). The cost counts the direct subagents like the header line does.
 * VERIFIED by `usage.test.ts` "usageBreakdown" (fabricated rows and messages).
 */
export function usageBreakdown(
  sessions: { readonly [sessionID: string]: SessionSummary },
  openID: string,
  messages: readonly MessageInfo[],
  catalog: Catalog | undefined,
  contextModel: ModelRef | undefined,
): UsageBreakdown | undefined {
  const usage = sessions[openID]?.usage;
  if (usage === undefined) return undefined;
  const cost = sessionCost(sessions, openID);
  const model = contextModel ?? sessions[openID]?.model;
  return {
    inputTokens: usage.tokens.input + usage.tokens.cacheRead + usage.tokens.cacheWrite,
    outputTokens: usage.tokens.output + usage.tokens.reasoning,
    cost: cost !== undefined && showCost(cost.usd, model, catalog) ? cost : undefined,
    turns: messages.filter((message) => message.kind === 'user').length,
    partial: messages.length >= LOADED_MESSAGE_LIMIT,
  };
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

/** The exact count with the thousands separators of the active language ("9,010" in English, "9.010" in Spanish). */
function exact(count: number): string {
  return count.toLocaleString(currentLocale());
}

/**
 * Builds the line, or `undefined` when there is neither a context nor a cost worth showing (no
 * session, or no usage yet). Both strings are ONE string each (lesson #926: JSX drops line breaks
 * between an expression and the text that follows).
 *
 * Visible: "Context 9K / 200K (5%) · $0.02"; without a known limit "Context 9K · $0.02"; with only a
 * cost "Cost $0.02". Name and tooltip: "Context: 9,010 tokens of 200,000 (5%). Session cost: $0.02,
 * including subagents." The "including subagents" clause appears only when the figure really
 * adds a child session. E11-i18n: every sentence is a whole `l10n.t` message with placeholders,
 * the thousands separators follow `currentLocale()` and the USD amount stays fixed `en-US`.
 * HYPOTHESIS: a real screen reader was not run; `usage.test.ts` and
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
    // Whole sentences with placeholders, never fragments joined: a language orders them differently.
    if (context.limit !== undefined && context.percent !== undefined) {
      text.push(
        l10n.t(
          'Context {0} / {1} ({2}%)',
          compactTokens(context.tokens),
          compactTokens(context.limit),
          context.percent,
        ),
      );
      name.push(
        l10n.t(
          'Context: {0} tokens of {1} ({2}%).',
          exact(context.tokens),
          exact(context.limit),
          context.percent,
        ),
      );
    } else {
      text.push(l10n.t('Context {0}', compactTokens(context.tokens)));
      name.push(l10n.t('Context: {0} tokens.', exact(context.tokens)));
    }
  }
  if (cost !== undefined && costShown) {
    const amount = formatCost(cost.usd);
    text.push(context === undefined ? l10n.t('Cost {0}', amount) : amount);
    name.push(
      cost.withSubagents
        ? l10n.t('Session cost: {0}, including subagents.', amount)
        : l10n.t('Session cost: {0}.', amount),
    );
  }
  const high = context?.percent !== undefined && context.percent >= HIGH_CONTEXT_PERCENT;
  return { text: text.join(' · '), name: name.join(' '), level: high ? 'high' : 'normal' };
}
