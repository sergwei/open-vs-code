// Protects the rules of the context and cost line (issue #25): which assistant message counts
// (last with usage, after the last completed compaction), when the percentage is omitted, when the
// cost is hidden (zero on a free model), the family sum, and the exact words of the line.
//
// Provenance of the data: the token split 4912 + 2 + 4096 = 9010 is the one the planner's spike
// saw on a real opencode 2.0.32 (Windows 11, 22/10/2026) and 200000 is the context of the free
// models of that catalog; everything else (ids, times, costs, paid model, children) is FABRICATED.
// These tests confirm OUR logic against upstream's documented rule, not the server's numbers.
import { describe, expect, it } from 'vitest';
import type {
  Catalog,
  MessageInfo,
  ModelOption,
  SessionSummary,
  TokenUsage,
} from '../../../src/shared/model';
import {
  contextUsage,
  describeUsage,
  formatCost,
  sessionCost,
  showCost,
  type ContextUsage,
} from './usage';

const PICKLE = { providerID: 'opencode', id: 'big-pickle' };
const PAID = { providerID: 'acme', id: 'pro' };

const option = (ref: { providerID: string; id: string }, free: boolean): ModelOption => ({
  ...ref,
  name: ref.id,
  status: 'active',
  contextLimit: 200_000,
  free,
  variants: [],
  images: true,
});

const catalog: Catalog = {
  models: [option(PICKLE, true), option(PAID, false)],
  providers: [],
  agents: [],
};

const tokens = (extra: Partial<TokenUsage> = {}): TokenUsage => ({
  input: 4912,
  output: 2,
  reasoning: 0,
  cacheRead: 4096,
  cacheWrite: 0,
  ...extra,
});

const reply = (
  id: string,
  createdAt: number,
  usage: TokenUsage | undefined,
  model = PICKLE,
): MessageInfo => ({
  kind: 'assistant',
  id,
  createdAt,
  agent: 'build',
  model,
  ...(usage === undefined ? {} : { tokens: usage }),
});

describe('contextUsage', () => {
  it('is undefined without messages or without any assistant usage', () => {
    expect(contextUsage([], undefined, catalog)).toBeUndefined();
    expect(contextUsage([reply('a', 10, undefined)], undefined, catalog)).toBeUndefined();
    expect(
      contextUsage(
        [{ kind: 'user', id: 'u', createdAt: 1, text: 'hi', files: [] }],
        undefined,
        catalog,
      ),
    ).toBeUndefined();
  });

  it('adds input, output, reasoning and both cache counters, and rounds the percentage', () => {
    const result = contextUsage(
      [reply('a', 10, tokens({ reasoning: 6, cacheWrite: 4 }))],
      undefined,
      catalog,
    );
    expect(result).toEqual({ tokens: 9020, model: PICKLE, limit: 200_000, percent: 5 });
  });

  it('takes the LAST assistant message that has usage', () => {
    const result = contextUsage(
      [
        reply('a', 10, tokens()),
        reply('b', 20, tokens({ input: 20_000 })),
        reply('c', 30, undefined),
      ],
      undefined,
      catalog,
    );
    expect(result?.tokens).toBe(20_000 + 2 + 4096);
  });

  it('skips a message whose total is zero instead of hiding the line', () => {
    const empty = tokens({ input: 0, output: 0, cacheRead: 0 });
    const result = contextUsage(
      [reply('a', 10, tokens()), reply('b', 20, empty)],
      undefined,
      catalog,
    );
    expect(result?.tokens).toBe(9010);
  });

  it('ignores every message created at or before the last completed compaction', () => {
    const messages = [reply('a', 10, tokens()), reply('b', 20, tokens({ input: 50 }))];
    expect(contextUsage(messages, 20, catalog)).toBeUndefined();
    expect(contextUsage(messages, 15, catalog)?.tokens).toBe(50 + 2 + 4096);
    expect(contextUsage(messages, 5, catalog)?.tokens).toBe(50 + 2 + 4096);
  });

  it('keeps the tokens but drops the share for a model outside the catalog', () => {
    const result = contextUsage(
      [reply('a', 10, tokens(), { providerID: 'x', id: 'gone' })],
      undefined,
      catalog,
    );
    expect(result).toEqual({ tokens: 9010, model: { providerID: 'x', id: 'gone' } });
    expect(contextUsage([reply('a', 10, tokens())], undefined, undefined)).toEqual({
      tokens: 9010,
      model: PICKLE,
    });
  });

  it('may exceed 100 percent and ignores a zero limit', () => {
    const big = contextUsage([reply('a', 10, tokens({ input: 300_000 }))], undefined, catalog);
    expect(big?.percent).toBe(152); // (300000 + 2 + 4096) / 200000
    const zero: Catalog = { ...catalog, models: [{ ...option(PICKLE, true), contextLimit: 0 }] };
    expect(contextUsage([reply('a', 10, tokens())], undefined, zero)?.percent).toBeUndefined();
  });
});

describe('sessionCost', () => {
  const row = (
    id: string,
    cost: number | undefined,
    extra: Partial<SessionSummary> = {},
  ): SessionSummary => ({
    id,
    createdAt: 1,
    updatedAt: 2,
    ...(cost === undefined ? {} : { usage: { cost, tokens: tokens() } }),
    ...extra,
  });

  it('is undefined when the open row is unknown or has no usage', () => {
    expect(sessionCost({}, 'ses_1')).toBeUndefined();
    expect(sessionCost({ ses_1: row('ses_1', undefined) }, 'ses_1')).toBeUndefined();
  });

  it('is the cost of the session alone when it has no children', () => {
    expect(sessionCost({ ses_1: row('ses_1', 0.25) }, 'ses_1')).toEqual({
      usd: 0.25,
      withSubagents: false,
    });
  });

  it('adds the direct children only', () => {
    const sessions = {
      ses_1: row('ses_1', 1),
      ses_k: row('ses_k', 0.5, { parentID: 'ses_1' }),
      ses_g: row('ses_g', 4, { parentID: 'ses_k' }),
      ses_other: row('ses_other', 8),
    };
    expect(sessionCost(sessions, 'ses_1')).toEqual({ usd: 1.5, withSubagents: true });
  });

  it('counts a child without usage as zero but still says subagents', () => {
    const sessions = {
      ses_1: row('ses_1', 1),
      ses_k: row('ses_k', undefined, { parentID: 'ses_1' }),
    };
    expect(sessionCost(sessions, 'ses_1')).toEqual({ usd: 1, withSubagents: true });
  });
});

describe('showCost and formatCost', () => {
  it('shows any positive cost, even on a free model', () => {
    expect(showCost(0.01, PICKLE, catalog)).toBe(true);
  });

  it('hides zero on a free model, shows it on a paid one or one outside the catalog', () => {
    expect(showCost(0, PICKLE, catalog)).toBe(false);
    expect(showCost(0, PAID, catalog)).toBe(true);
    expect(showCost(0, { providerID: 'x', id: 'gone' }, catalog)).toBe(true);
  });

  // Review S2 (Sergio, 22/10/2026): the catalog loads in parallel with the snapshot, so "no
  // catalog yet" must not read as "unknown model" or a free model flashes "$0.00" on every reload.
  it('hides zero while there is no catalog, whatever the model, but still shows a positive cost', () => {
    expect(showCost(0, PICKLE, undefined)).toBe(false);
    expect(showCost(0, PAID, undefined)).toBe(false);
    expect(showCost(0.02, PAID, undefined)).toBe(true);
  });

  it('hides zero when no model is known at all', () => {
    expect(showCost(0, undefined, catalog)).toBe(false);
  });

  it('formats USD with a fixed locale and "<$0.01" below a cent', () => {
    expect(formatCost(0.0123)).toBe('$0.01');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(1234.5)).toBe('$1,234.50');
  });
});

describe('describeUsage', () => {
  const context: ContextUsage = { tokens: 9010, model: PICKLE, limit: 200_000, percent: 5 };

  it('is undefined with neither a context nor a cost worth showing', () => {
    expect(describeUsage(undefined, undefined, catalog, PICKLE)).toBeUndefined();
    expect(
      describeUsage(undefined, { usd: 0, withSubagents: false }, catalog, PICKLE),
    ).toBeUndefined();
  });

  it('writes the full line with the share of the limit and the cost', () => {
    expect(describeUsage(context, { usd: 0.0234, withSubagents: false }, catalog, PICKLE)).toEqual({
      text: 'Context 9K / 200K (5%) · $0.02',
      name: 'Context: 9,010 tokens of 200,000 (5%). Session cost: $0.02.',
      level: 'normal',
    });
  });

  it('says "including subagents" only when a child was summed', () => {
    const view = describeUsage(context, { usd: 0.5, withSubagents: true }, catalog, PICKLE);
    expect(view?.name).toBe(
      'Context: 9,010 tokens of 200,000 (5%). Session cost: $0.50, including subagents.',
    );
    expect(view?.text).toBe('Context 9K / 200K (5%) · $0.50');
  });

  it('omits the free-model cost and, without the limit, the "/ 200K (5%)" part', () => {
    const noLimit: ContextUsage = { tokens: 9010, model: PICKLE };
    expect(describeUsage(noLimit, { usd: 0, withSubagents: false }, catalog, PICKLE)).toEqual({
      text: 'Context 9K',
      name: 'Context: 9,010 tokens.',
      level: 'normal',
    });
  });

  it('shows only the cost when there is no context (just after a compaction)', () => {
    expect(describeUsage(undefined, { usd: 0.4, withSubagents: false }, catalog, PICKLE)).toEqual({
      text: 'Cost $0.40',
      name: 'Session cost: $0.40.',
      level: 'normal',
    });
  });

  it('flags the line from 80 percent and not before, keeping the percentage in the text', () => {
    const at = (percent: number): ContextUsage => ({ ...context, tokens: percent * 2000, percent });
    expect(describeUsage(at(79), undefined, catalog, PICKLE)?.level).toBe('normal');
    const high = describeUsage(at(80), undefined, catalog, PICKLE);
    expect(high?.level).toBe('high');
    expect(high?.text).toBe('Context 160K / 200K (80%)');
  });

  it('judges a zero cost by the model that answered, not by the fallback', () => {
    const paid: ContextUsage = { ...context, model: PAID };
    expect(describeUsage(paid, { usd: 0, withSubagents: false }, catalog, PICKLE)?.text).toBe(
      'Context 9K / 200K (5%) · $0.00',
    );
  });
});
