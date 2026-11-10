// The model behind the native "Usage (all projects)" view (E9-sidebar-home, issue #187, phase 3,
// decision P3=2 of Sergio: the WHOLE opencode database, no `project` filter). PURE: no `vscode`
// import; the tree is `usageView.ts` and the wiring `sidebarHome.ts`.
//
// What the server gives (READ in `@opencode/client@2.0.32`, `core/src/session/stats.ts` and
// `server/src/handlers/session.ts` @843a6c51; the route is EXPERIMENTAL, so it may change in another
// version; the opt-in `realOpencode.test.ts` case is the only watch on it): `GET
// /api/experimental/session/stats` sums cost and tokens of the sessions created in `[from, to)`,
// subagents included, grouped by model. WITHOUT `project` it covers every project in the database,
// which is why the view is called "all projects" and says so in its description and tooltips. `cost`
// is `sum(cost ?? 0)`: a provider that reports no cost reads as 0, indistinguishable from free, so a
// model with tokens and no cost is "free" only when the catalog says so, else "cost not reported".
//
// When it reads (the server runs one SQL per 31-day window with `json_extract`, so it is not free):
// NOTHING while the view is collapsed or hidden; one load (two calls, today and the last 7 days)
// when it becomes visible with no data or stale data; at most one refresh per 10 s after a turn
// ended while it is visible (else it is only marked stale); at local midnight; the refresh button.

import * as l10n from '@vscode/l10n';
import type { ModelRef, ErrorInfo, Catalog } from '../shared/model';
import { plural } from '../shared/l10n';
import type { ChatApi } from './opencodeClient';
import type { ServerLog } from './opencodeServer';
import { costText, msUntilNextLocalMidnight } from './sessionTree';

/** The server's token counters (`TokenUsageInfo`), restated so this module needs no SDK import. */
export interface UsageTokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

/** The two periods the view shows. */
export type UsagePeriodKey = 'today' | 'week';

/** How a model's cost reads: reported by the provider, free by the catalog, or unknown. */
export type CostState = 'reported' | 'free' | 'unreported';

/** One model of a period. */
export interface UsageModelRow {
  ref: ModelRef;
  /** The catalog's name when it lists the model, else `provider/id`; the variant is appended when present. */
  name: string;
  steps: number;
  tokens: UsageTokens;
  totalTokens: number;
  cost: number;
  costState: CostState;
}

/** One period with its totals and its models. */
export interface UsagePeriod {
  key: UsagePeriodKey;
  range: { from: number; to: number };
  sessions: number;
  prompts: number;
  steps: number;
  tokens: UsageTokens;
  totalTokens: number;
  cost: number;
  /** True when at least one model has tokens but reported no cost and is not known to be free. */
  hasUnreported: boolean;
  models: UsageModelRow[];
}

/** The part of `SessionStatsInfo` this module reads. */
export interface StatsAnswer {
  range: { from: number; to: number };
  sessions: number;
  prompts: number;
  steps: number;
  tokens: UsageTokens;
  cost: number;
  models: readonly { model: ModelRef; steps: number; tokens: UsageTokens; cost: number }[];
}

/**
 * The two periods at `now`, in LOCAL time: Today = this local midnight to now; Last 7 days = the
 * local midnight six days ago to now (a sliding window, so it does not depend on the first day of
 * the week of the locale). Built with calendar arithmetic (`new Date(y, m, d - 6)`), not `- 6 × 24 h`,
 * so a daylight-saving day of 23 or 25 hours does not move the start by an hour.
 * VERIFIED by `usageStats.test.ts` "starts today at local midnight and the week six local days
 * earlier, also across a 23-hour day" (Vitest, Windows 11, 07/11/2026): it walks every day of 2026,
 * building the dates from local components, and asserts the local hour is 0. It covers a 23-hour day
 * only if the zone of the machine has daylight saving (UNVERIFIED which zone ran it).
 */
export function periodsAt(now: number): Record<UsagePeriodKey, { from: number; to: number }> {
  const date = new Date(now);
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  return {
    today: { from: new Date(y, m, d).getTime(), to: now },
    week: { from: new Date(y, m, d - 6).getTime(), to: now },
  };
}

/** Sum of the five counters; cache reads and writes count, as they do in the prompt size. */
export function totalTokens(tokens: UsageTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

/**
 * Turns one answer of the server into the period the view shows: models ordered by cost, then
 * tokens, then name; each with its {@link CostState} (cost above 0 is `reported`; tokens with no
 * cost is `free` when the `catalog` lists the model as free, else `unreported`; no tokens is
 * `reported`).
 * VERIFIED by `usageStats.test.ts` "summarizes a period: order, free versus unreported, totals"
 * (fabricated answers in the shape of `SessionStatsInfo`, Windows 11, 07/11/2026). Not observed: a
 * real paid model (the catalog the project saw only lists free ones).
 */
export function summarizePeriod(
  key: UsagePeriodKey,
  answer: StatsAnswer,
  catalog: Catalog | undefined,
): UsagePeriod {
  const models = answer.models
    .map((row): UsageModelRow => {
      const known = catalog?.models.find(
        (model) => model.providerID === row.model.providerID && model.id === row.model.id,
      );
      const total = totalTokens(row.tokens);
      const costState: CostState =
        row.cost > 0 || total === 0 ? 'reported' : known?.free === true ? 'free' : 'unreported';
      const base = known?.name ?? `${row.model.providerID}/${row.model.id}`;
      const variant = row.model.variant;
      return {
        ref: row.model,
        name: variant === undefined || variant === '' ? base : `${base} (${variant})`,
        steps: row.steps,
        tokens: row.tokens,
        totalTokens: total,
        cost: row.cost,
        costState,
      };
    })
    .sort(
      (a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens || a.name.localeCompare(b.name),
    );
  return {
    key,
    range: answer.range,
    sessions: answer.sessions,
    prompts: answer.prompts,
    steps: answer.steps,
    tokens: answer.tokens,
    totalTokens: totalTokens(answer.tokens),
    cost: answer.cost,
    hasUnreported: models.some((model) => model.costState === 'unreported'),
    models,
  };
}

/** One formatter per locale: a compact count (`120K`) reads in 300 px, a full one does not. */
const compactFormats = new Map<string, Intl.NumberFormat>();

/** A token count in compact notation with one decimal at most (`1.2K`, `120K`, `3.4M` in English; the locale decides the suffix); small counts stay whole. */
export function tokensText(count: number, locale: string | undefined): string {
  const key = locale ?? '';
  let format = compactFormats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
    compactFormats.set(key, format);
  }
  return format.format(count);
}

/** The label of a period row. */
export function periodLabel(key: UsagePeriodKey): string {
  return key === 'today' ? l10n.t('Today') : l10n.t('Last 7 days');
}

/**
 * The description of a period row: `$0.42 · 120K tokens`. A total that includes a model with no
 * reported cost is a lower bound and reads `≥ $0.42`.
 * VERIFIED by `usageStats.test.ts` "writes the period and model descriptions" (Vitest, Windows 11,
 * 07/11/2026): the lower-bound period form and the reported, free and unreported model forms (the
 * plain period form without `≥` is not asserted).
 */
export function periodDescription(period: UsagePeriod, locale: string | undefined): string {
  const cost = costText(period.cost, locale);
  return l10n.t(
    '{0} · {1} tokens',
    period.hasUnreported ? l10n.t('≥ {0}', cost) : cost,
    tokensText(period.totalTokens, locale),
  );
}

/** The description of a model row: cost (or "free" / "cost not reported"), tokens and steps. */
export function modelDescription(row: UsageModelRow, locale: string | undefined): string {
  const tokens = tokensText(row.totalTokens, locale);
  const steps = plural(row.steps, l10n.t('{0} step', row.steps), l10n.t('{0} steps', row.steps));
  switch (row.costState) {
    case 'reported':
      return l10n.t('{0} · {1} tokens · {2}', costText(row.cost, locale), tokens, steps);
    case 'free':
      return l10n.t('free · {0} tokens · {1}', tokens, steps);
    case 'unreported':
      return l10n.t('cost not reported · {0} tokens · {1}', tokens, steps);
  }
}

/**
 * The tooltip of a period or model row as plain lines (the view appends it as text, never as
 * Markdown): the scope sentence first (it covers every project), then the token breakdown, then
 * what the period counted.
 */
export function usageTooltip(
  scope: { tokens: UsageTokens; sessions?: number; prompts?: number; steps: number },
  unreportedNote: boolean,
  locale: string | undefined,
): string {
  const n = (count: number): string => tokensText(count, locale);
  const lines = [
    l10n.t(
      'All projects: this counts every project in the opencode database, not only this folder.',
    ),
    l10n.t(
      'Tokens: {0} in · {1} out · {2} reasoning · {3} cache read · {4} cache write',
      n(scope.tokens.input),
      n(scope.tokens.output),
      n(scope.tokens.reasoning),
      n(scope.tokens.cache.read),
      n(scope.tokens.cache.write),
    ),
  ];
  if (scope.sessions !== undefined && scope.prompts !== undefined) {
    lines.push(
      l10n.t(
        'Sessions: {0} · Prompts: {1} · Steps: {2}',
        scope.sessions,
        scope.prompts,
        scope.steps,
      ),
    );
  } else {
    lines.push(l10n.t('Steps: {0}', scope.steps));
  }
  if (unreportedNote) {
    lines.push(l10n.t('Some models report no cost, so the total is a lower bound.'));
  }
  return lines.join('\n');
}

/** Where the model is: never read, reading, read, or the last read failed. */
export type UsageState = 'idle' | 'loading' | 'ready' | 'failed';

/** What the tree draws. `periods` keeps the last good data while a refresh runs or after it failed. */
export interface UsageSnapshot {
  state: UsageState;
  periods: UsagePeriod[];
  error?: ErrorInfo;
}

/** What the model needs from the outside. */
export interface UsageDeps {
  /** The client of the current server, or `undefined` without one. */
  client(): ChatApi | undefined;
  /** The catalog of the server (free models, display names), or `undefined` before it is read. */
  catalog(): Catalog | undefined;
  /** Epoch ms "now". */
  now(): number;
  /** IANA zone sent as `timezone`; it only groups the activity chart, which is not shown. */
  timezone(): string;
  log: ServerLog;
  /** Turns a thrown value into the scrubbed error shown to the user (`toErrorInfo`). */
  describe(error: unknown): ErrorInfo;
}

/** The model returned by {@link createUsage}. */
export interface Usage {
  snapshot(): UsageSnapshot;
  /**
   * The view became visible or stopped being (expanded or collapsed, container shown or hidden).
   * Becoming visible with no data, or with data marked stale, starts one load. Hiding cancels the
   * pending throttled refresh and, ONLY if one was pending, marks the data stale; hiding with
   * nothing pending keeps the data fresh, and showing it again reads nothing (a turn that ends or a
   * reconnection while hidden, or the local midnight, is what marks it stale).
   */
  setVisible(visible: boolean): void;
  /** A turn ended somewhere: refresh soon if visible, else mark stale. At most one per 10 s. */
  turnEnded(): void;
  /** The refresh button: reads both periods now. Resolves when the read ended (never rejects). */
  refresh(): Promise<void>;
  /** The server connected (`true`: the data is stale) or went away (`false`: it is dropped). */
  connection(connected: boolean): void;
  /** Calls `listener` when the snapshot changed; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  dispose(): void;
}

/**
 * Debounce between a finished turn and the refresh of a visible view. Our own choice (plan #2044):
 * a turn is seconds to minutes, the server's cost per read is a SQL per 31-day window, and 10 s
 * keeps a burst of finished subagents to one read. It is a throttle (the first turn end arms it, the
 * next ones inside the window add nothing), so a busy window cannot postpone it forever.
 */
export const REFRESH_DEBOUNCE_MS = 10_000;

/** Delay added to the midnight timer so it fires after the day changed (as `sessionsView.ts`). */
const MIDNIGHT_MARGIN_MS = 1000;

/**
 * Creates the Usage model.
 *
 * Single flight: a `load` asked while one runs marks it dirty and shares its promise; a read whose
 * server changed (`connection(false)` or a newer connection) does not publish (an `epoch` counter
 * captured before the `await`, compared after, also in the `catch`). Both periods are read in
 * parallel with `tools: 'none'`; if either fails the state is `failed` and the previous data stays
 * visible. Stable log lines (no amounts): `usage: read (today, week)` after a good read and
 * `usage failed: <code>` after a failed one; the fake-server suite counts the server's own
 * `{"fake":"stats"}` lines instead, because what matters is requests, not our logging.
 * VERIFIED by `usageStats.test.ts` with a fabricated client and fake timers: no call while hidden,
 * one load on becoming visible, the 10 s throttle (the timers drained with
 * `vi.advanceTimersByTimeAsync`: the midnight timer re-arms, so `runAllTimersAsync` never ends), a
 * stale mark when hidden, a retry after an error, the server going away, midnight. VERIFIED against
 * the synthetic server (Windows 11, VS Code 1.145.2, 07/11/2026, `--label fake-server`): "shows the
 * usage of all projects after a COSTLY turn, and reads nothing while it is not shown" saw no stats
 * line before the view was shown, exactly two after `openVsCode.usage.focus`, and none in the
 * 11.5 s (past the 10 s throttle) after hiding the side bar and finishing a turn, so a hidden
 * container did report `visible` false. Not observed: the refresh 10 s after a turn with the view
 * visible, a server restart.
 * VERIFIED by `--steps 29,34,49,50` (Windows 11, VS Code 1.145.2, 08/11/2026): "ok   U4 with the Usage pane
 * collapsed a finished turn made no stats request (0 new)" and "ok   U4 expanding it again reads
 * once more, two requests, because the turn marked the data stale (2 new)", so VS Code reports
 * `visible` false for a COLLAPSED view of an open container.
 */
export function createUsage(deps: UsageDeps): Usage {
  let state: UsageState = 'idle';
  let periods: UsagePeriod[] = [];
  let error: ErrorInfo | undefined;
  let visible = false;
  let stale = true;
  let epoch = 0;
  let run: Promise<void> | undefined;
  let dirty = false;
  let throttle: ReturnType<typeof setTimeout> | undefined;
  let midnight: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  /**
   * One read of both periods; publishes unless the server changed meanwhile. Uses
   * `client.experimental.session.stats` (the 2.2 name; `session.stats` is a deprecated alias, #191).
   */
  const readOnce = async (at: number): Promise<void> => {
    const client = deps.client();
    if (client === undefined) {
      state = 'idle';
      stale = true;
      notify();
      return;
    }
    state = 'loading';
    error = undefined;
    notify();
    const ranges = periodsAt(deps.now());
    const timezone = deps.timezone();
    try {
      const [today, week] = await Promise.all([
        client.experimental.session.stats({ ...ranges.today, timezone, tools: 'none' }),
        client.experimental.session.stats({ ...ranges.week, timezone, tools: 'none' }),
      ]);
      if (at !== epoch) return;
      const catalog = deps.catalog();
      periods = [summarizePeriod('today', today, catalog), summarizePeriod('week', week, catalog)];
      state = 'ready';
      stale = false;
      deps.log.info('usage: read (today, week)');
    } catch (cause) {
      if (at !== epoch) return;
      const info = deps.describe(cause);
      state = 'failed';
      error = info;
      stale = true;
      deps.log.warn(`usage failed: ${info.code}`);
    }
    notify();
  };

  /** Reads, and once more per `dirty` raised meanwhile, while the server of `at` holds. */
  const load = (): Promise<void> => {
    if (run !== undefined) {
      dirty = true;
      return run;
    }
    const at = epoch;
    const mine = (async (): Promise<void> => {
      try {
        do {
          dirty = false;
          await readOnce(at);
        } while (dirty && at === epoch && !disposed);
      } finally {
        if (at === epoch) run = undefined;
      }
    })();
    run = mine;
    return mine;
  };

  const armMidnight = (): void => {
    midnight = setTimeout(
      () => {
        stale = true;
        if (visible && !disposed) void load();
        if (!disposed) armMidnight();
      },
      msUntilNextLocalMidnight(deps.now()) + MIDNIGHT_MARGIN_MS,
    );
  };
  armMidnight();

  const clearThrottle = (): void => {
    if (throttle !== undefined) clearTimeout(throttle);
    throttle = undefined;
  };

  return {
    snapshot: () => ({ state, periods, ...(error === undefined ? {} : { error }) }),

    setVisible(next) {
      if (next === visible) return;
      visible = next;
      if (!next) {
        // A refresh that was waiting for its 10 s is now a mark: the next showing reads.
        if (throttle !== undefined) stale = true;
        clearThrottle();
        return;
      }
      if (stale || state === 'idle' || state === 'failed') void load();
    },

    turnEnded() {
      if (!visible) {
        stale = true;
        return;
      }
      if (throttle !== undefined) return;
      throttle = setTimeout(() => {
        throttle = undefined;
        if (visible && !disposed) void load();
      }, REFRESH_DEBOUNCE_MS);
    },

    refresh: () => load(),

    connection(connected) {
      epoch += 1;
      run = undefined;
      dirty = false;
      clearThrottle();
      periods = [];
      error = undefined;
      state = 'idle';
      stale = true;
      notify();
      if (connected && visible) void load();
    },

    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      disposed = true;
      epoch += 1;
      clearThrottle();
      if (midnight !== undefined) clearTimeout(midnight);
      listeners.clear();
    },
  };
}
