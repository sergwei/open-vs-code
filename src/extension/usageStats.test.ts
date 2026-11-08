// Protects the model of the "Usage (all projects)" view (E9-sidebar-home, issue #187, phase 3)
// against its quiet failure modes: a view that asks the server while it is collapsed (the server
// runs one SQL per 31-day window), a refresh per finished turn instead of one per 10 s, a "Today"
// that starts at UTC midnight or drifts by an hour on a daylight-saving day, a model that reports no
// cost read as "free", and an error that leaves the view empty with no way back.
//
// Provenance of the data: ALL FABRICATED by hand, in the shape of `SessionStatsInfo` of
// `@opencode/client@2.0.32` (types.d.ts L2789-2805, read). The opt-in case "reads the usage of a
// window across all projects and refuses an invalid timezone" of `realOpencode.test.ts` is what
// compared that shape with a real server, and it ran against opencode 2.2.5, not the pinned 2.0.32.
// Timers are fake: `vi.advanceTimersByTimeAsync` drains them (the midnight timer re-arms itself, so
// `vi.runAllTimersAsync` would never finish), per the lesson of `verified-coalescencia-sin-drenar`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, ModelOption } from '../shared/model';
import type { ChatApi } from './opencodeClient';
import {
  createUsage,
  modelDescription,
  periodDescription,
  periodsAt,
  REFRESH_DEBOUNCE_MS,
  summarizePeriod,
  tokensText,
  type StatsAnswer,
  type UsageDeps,
} from './usageStats';

/** A token count with only input and output filled (FABRICATED). */
const tokens = (input: number, output = 0) => ({
  input,
  output,
  reasoning: 0,
  cache: { read: 0, write: 0 },
});

/** An answer with the given models: `[provider/id, cost, input tokens, steps]`. */
function answer(models: [string, number, number, number][]): StatsAnswer {
  return {
    range: { from: 0, to: 1 },
    sessions: 3,
    prompts: 4,
    steps: models.reduce((sum, m) => sum + m[3], 0),
    tokens: tokens(models.reduce((sum, m) => sum + m[2], 0)),
    cost: models.reduce((sum, m) => sum + m[1], 0),
    models: models.map(([ref, cost, input, steps]) => {
      const [providerID = '', id = ''] = ref.split('/');
      return { model: { providerID, id }, steps, tokens: tokens(input), cost };
    }),
  };
}

/** A two-model catalog (big-pickle and acme/pro) where the refs in `free` are marked free. */
const catalog = (free: string[]): Catalog => ({
  models: ['opencode/big-pickle', 'acme/pro'].map((ref): ModelOption => {
    const [providerID = '', id = ''] = ref.split('/');
    return {
      providerID,
      id,
      name: id === 'pro' ? 'Acme Pro' : 'Big Pickle',
      status: 'active',
      contextLimit: 1000,
      free: free.includes(ref),
      variants: [],
      images: false,
    };
  }),
  providers: [],
  agents: [],
});

describe('periodsAt', () => {
  it('starts today at local midnight and the week six local days earlier, also across a 23-hour day', () => {
    // Every day of a year, so whatever zone the machine is in, its daylight-saving days are covered.
    for (let day = 0; day < 366; day += 1) {
      const now = new Date(2026, 0, 1 + day, 15, 30).getTime();
      const { today, week } = periodsAt(now);
      const t = new Date(today.from);
      const w = new Date(week.from);
      expect([t.getHours(), t.getMinutes()], String(day)).toEqual([0, 0]);
      expect([w.getHours(), w.getMinutes()], String(day)).toEqual([0, 0]);
      const expected = new Date(2026, 0, 1 + day - 6);
      expect(w.getDate()).toBe(expected.getDate());
      expect(today.to).toBe(now);
      expect(week.to).toBe(now);
    }
  });
});

describe('summarizePeriod', () => {
  it('summarizes a period: order, free versus unreported, totals', () => {
    const period = summarizePeriod(
      'today',
      answer([
        ['opencode/big-pickle', 0, 500, 2],
        ['acme/pro', 0.5, 1000, 3],
        ['acme/mystery', 0, 800, 1],
        ['acme/idle', 0, 0, 0],
      ]),
      catalog(['opencode/big-pickle']),
    );
    expect(period.models.map((m) => [m.name, m.costState])).toEqual([
      ['Acme Pro', 'reported'],
      ['acme/mystery', 'unreported'],
      ['Big Pickle', 'free'],
      ['acme/idle', 'reported'],
    ]);
    expect(period.hasUnreported).toBe(true);
    expect(period.totalTokens).toBe(2300);
    expect(period.cost).toBe(0.5);
  });

  it('is not unreported when every zero-cost model is free or has no tokens', () => {
    const period = summarizePeriod(
      'week',
      answer([['opencode/big-pickle', 0, 500, 2]]),
      catalog(['opencode/big-pickle']),
    );
    expect(period.hasUnreported).toBe(false);
  });

  it('treats every zero-cost model as unreported when the catalog is not known yet', () => {
    const period = summarizePeriod(
      'today',
      answer([['opencode/big-pickle', 0, 500, 2]]),
      undefined,
    );
    expect(period.models[0]?.costState).toBe('unreported');
    expect(period.models[0]?.name).toBe('opencode/big-pickle');
  });
});

describe('descriptions', () => {
  it('writes the period and model descriptions', () => {
    const period = summarizePeriod(
      'today',
      answer([
        ['acme/pro', 0.42, 120_000, 3],
        ['opencode/big-pickle', 0, 500, 1],
        ['acme/mystery', 0, 800, 2],
      ]),
      catalog(['opencode/big-pickle']),
    );
    expect(periodDescription(period, 'en')).toBe('≥ $0.42 · 121.3K tokens');
    const [pro, mystery, free] = [
      period.models.find((m) => m.name === 'Acme Pro'),
      period.models.find((m) => m.name === 'acme/mystery'),
      period.models.find((m) => m.name === 'Big Pickle'),
    ];
    expect(pro && modelDescription(pro, 'en')).toBe('$0.42 · 120K tokens · 3 steps');
    expect(mystery && modelDescription(mystery, 'en')).toBe(
      'cost not reported · 800 tokens · 2 steps',
    );
    expect(free && modelDescription(free, 'en')).toBe('free · 500 tokens · 1 step');
  });

  it('writes token counts compactly', () => {
    expect(tokensText(999, 'en')).toBe('999');
    expect(tokensText(1500, 'en')).toBe('1.5K');
  });
});

describe('createUsage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Builds the model over a fake client that counts the reads and can fail. */
  function build() {
    const calls: {
      from?: number;
      to?: number;
      timezone?: string;
      tools?: string;
      project?: string;
    }[] = [];
    const world: { failure: object | undefined; client: object | undefined; free: string[] } = {
      failure: undefined,
      client: undefined,
      free: [],
    };
    world.client = {
      session: {
        stats: (input: (typeof calls)[number]) => {
          calls.push(input);
          if (world.failure !== undefined) {
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            return Promise.reject(world.failure);
          }
          return Promise.resolve(answer([['acme/pro', 0.5, 1000, 3]]));
        },
      },
    };
    const logs: string[] = [];
    const deps: UsageDeps = {
      client: () => world.client as ChatApi | undefined,
      catalog: () => catalog(world.free),
      now: () => Date.now(),
      timezone: () => 'Europe/Madrid',
      log: {
        info: (m) => logs.push(`info: ${m}`),
        warn: (m) => logs.push(`warn: ${m}`),
        error: (m) => logs.push(`error: ${m}`),
        debug: (m) => logs.push(`debug: ${m}`),
      },
      describe: (error) => ({
        code: (error as { _tag?: string })._tag ?? 'Unknown',
        message: 'scrubbed',
      }),
    };
    const usage = createUsage(deps);
    return { usage, calls, world, logs };
  }

  it('asks the server nothing while it is hidden, whatever happens', async () => {
    const { usage, calls } = build();
    usage.connection(true);
    usage.turnEnded();
    usage.turnEnded();
    await vi.advanceTimersByTimeAsync(3 * REFRESH_DEBOUNCE_MS);
    expect(calls).toEqual([]);
    expect(usage.snapshot().state).toBe('idle');
  });

  it('reads both periods once when it becomes visible, over all projects', async () => {
    const { usage, calls } = build();
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    // Both periods, in local time, with the zone and no tool breakdown; never a `project`.
    const [today, week] = calls;
    expect(today?.to).toBe(Date.now());
    expect(new Date(today?.from ?? 0).getHours()).toBe(0);
    expect(new Date(week?.from ?? 0).getDate()).toBe(1);
    for (const call of calls) {
      expect(call.timezone).toBe('Europe/Madrid');
      expect(call.tools).toBe('none');
      expect(call.project).toBeUndefined();
    }
    expect(usage.snapshot().state).toBe('ready');
    expect(usage.snapshot().periods.map((p) => p.key)).toEqual(['today', 'week']);
  });

  it('does not read again when it is hidden and shown with fresh data', async () => {
    const { usage, calls } = build();
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    usage.setVisible(false);
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
  });

  it('marks the data stale when a turn ends while hidden and reads on the next showing', async () => {
    const { usage, calls } = build();
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    usage.setVisible(false);
    usage.turnEnded();
    await vi.advanceTimersByTimeAsync(2 * REFRESH_DEBOUNCE_MS);
    expect(calls).toHaveLength(2);
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(4);
  });

  it('refreshes a visible view once per 10 s after finished turns, not once per turn', async () => {
    const { usage, calls } = build();
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    usage.turnEnded();
    usage.turnEnded();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS - 1);
    usage.turnEnded();
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(4);
    // A turn that ends after the window opens a new one.
    usage.turnEnded();
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(calls).toHaveLength(6);
  });

  it('turns a pending refresh into a stale mark when the view is hidden before the 10 s', async () => {
    const { usage, calls } = build();
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    usage.turnEnded();
    usage.setVisible(false);
    await vi.advanceTimersByTimeAsync(2 * REFRESH_DEBOUNCE_MS);
    expect(calls).toHaveLength(2);
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(4);
  });

  it('keeps the last good data after a failure and reads again when shown again', async () => {
    const { usage, calls, world, logs } = build();
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    world.failure = { _tag: 'Boom' };
    await usage.refresh();
    expect(usage.snapshot().state).toBe('failed');
    expect(usage.snapshot().error).toEqual({ code: 'Boom', message: 'scrubbed' });
    expect(usage.snapshot().periods).toHaveLength(2);
    expect(logs).toContain('warn: usage failed: Boom');
    world.failure = undefined;
    usage.setVisible(false);
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(usage.snapshot().state).toBe('ready');
    expect(usage.snapshot().error).toBeUndefined();
    expect(calls.length).toBeGreaterThanOrEqual(6);
  });

  it('shares one read between two asks that overlap, and reads once more for the second', async () => {
    const { usage, calls } = build();
    usage.setVisible(true);
    const second = usage.refresh();
    await second;
    await vi.advanceTimersByTimeAsync(0);
    // The visible load plus the refresh asked during it: two loops of two calls, never four at once.
    expect(calls).toHaveLength(4);
  });

  it('drops the data when the server goes away and reads again for the next one if visible', async () => {
    const { usage, calls } = build();
    usage.connection(true);
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(usage.snapshot().periods).toHaveLength(2);
    usage.connection(false);
    expect(usage.snapshot().periods).toEqual([]);
    expect(usage.snapshot().state).toBe('idle');
    const before = calls.length;
    usage.connection(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(before + 2);
  });

  it('publishes nothing from a read cut off by the server going away', async () => {
    const { usage, world } = build();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = (world.client as { session: { stats: (i: unknown) => Promise<StatsAnswer> } })
      .session.stats;
    (world.client as { session: { stats: (i: unknown) => Promise<StatsAnswer> } }).session.stats =
      async (input) => {
        await gate;
        return real(input);
      };
    usage.setVisible(true);
    usage.connection(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(usage.snapshot().periods).toEqual([]);
    expect(usage.snapshot().state).toBe('idle');
  });

  it('reads again at local midnight when visible, and only marks stale when hidden', async () => {
    const { usage, calls } = build();
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    // 12:00 -> past the next local midnight (12 h and the margin).
    await vi.advanceTimersByTimeAsync(12 * 3600_000 + 1500);
    expect(calls).toHaveLength(4);
    expect(new Date(Date.now()).getDate()).toBe(8);
    usage.setVisible(false);
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(calls).toHaveLength(4);
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(6);
  });

  it('writes no amounts in the log', async () => {
    const { usage, logs } = build();
    usage.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(logs).toEqual(['info: usage: read (today, week)']);
  });
});
