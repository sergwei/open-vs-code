// Protects the context and cost line under the title (issue #25): it is absent without a session or
// without usage, it reads exactly as agreed with Sergio ("Context 9K / 200K (5%) · $0.02"), it
// follows the store when a step ends or the totals change (no resync), the full sentence is a
// visually hidden span next to an aria-hidden shorthand, it is not a live region and it never uses
// a `style` attribute.
//
// Provenance: a real `createChatStore` driven with FABRICATED host messages in jsdom (the token
// split is the one the planner's spike saw on a real opencode 2.0.32, 22/10/2026). They confirm the
// wiring between store and component, not the layout, the contrast or a screen reader, which
// `npm run test:visual` step 17 measures in a real VS Code.
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { Catalog, MessageInfo, SessionSummary } from '../../../src/shared/model';
import { createChatStore, type ChatStore } from '../store/chatStore';
import { mount, type Mounted } from '../testing';
import { UsageIndicator } from './UsageIndicator';

const SES = 'ses_1';
const PICKLE = { providerID: 'opencode', id: 'big-pickle' };
const catalog: Catalog = {
  models: [
    {
      ...PICKLE,
      name: 'Big Pickle',
      status: 'active',
      contextLimit: 200_000,
      free: true,
      variants: [],
    },
  ],
  providers: [],
  agents: [],
};
const zero = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
const answered = (id: string, createdAt: number, input: number): MessageInfo => ({
  kind: 'assistant',
  id,
  createdAt,
  agent: 'build',
  model: PICKLE,
  tokens: { ...zero, input, output: 2, cacheRead: 4096 },
});

/** The visible shorthand: the `aria-hidden` span of the line. */
const shown = (line: Element | null | undefined): string | undefined =>
  line?.querySelector('[aria-hidden="true"]')?.textContent ?? undefined;
/** What a screen reader gets: the `visually-hidden` span with the full sentence. */
const spoken = (line: Element | null | undefined): string | undefined =>
  line?.querySelector('.visually-hidden')?.textContent ?? undefined;

const mounted: Mounted[] = [];
afterEach(() => {
  for (const item of mounted.splice(0)) item.dispose();
});

/** A store with `SES` open, holding `messages`, and the indicator mounted over it. */
function start(
  messages: MessageInfo[],
  row: Partial<SessionSummary> = {},
  compactedAt?: number,
): { store: ChatStore; line: () => HTMLElement | null } {
  const store = createRoot(() => createChatStore());
  store.apply({ type: 'catalog', catalog });
  store.apply({
    type: 'snapshot',
    snapshot: {
      sessions: [{ id: SES, createdAt: 1, updatedAt: 2, ...row }],
      statuses: {},
      open: {
        sessionID: SES,
        messages,
        parts: {},
        ...(compactedAt === undefined ? {} : { compactedAt }),
      },
      requests: { permissions: [], forms: [] },
      resolutions: [],
    },
  });
  const view = mount(() => <UsageIndicator store={store} />);
  mounted.push(view);
  return { store, line: () => view.container.querySelector<HTMLElement>('.usage-line') };
}

describe('UsageIndicator', () => {
  it('draws nothing without an open session', () => {
    const store = createRoot(() => createChatStore());
    const view = mount(() => <UsageIndicator store={store} />);
    mounted.push(view);
    expect(view.container.querySelector('.usage-line')).toBeNull();
  });

  it('draws nothing for a session without usage', () => {
    expect(start([]).line()).toBeNull();
  });

  it('shows the context, its share of the limit and a paid cost, with the full sentence as name', () => {
    const { line } = start([answered('a', 10, 4912)], {
      usage: { cost: 0.0234, tokens: zero },
    });
    const element = line();
    expect(shown(element)).toBe('Context 9K / 200K (5%) · $0.02');
    expect(spoken(element)).toBe('Context: 9,010 tokens of 200,000 (5%). Session cost: $0.02.');
    expect(element?.getAttribute('data-level')).toBe('normal');
  });

  it('hides the zero cost of a free model', () => {
    const { line } = start([answered('a', 10, 4912)], { usage: { cost: 0, tokens: zero } });
    expect(shown(line())).toBe('Context 9K / 200K (5%)');
  });

  it('adds "including subagents" to the name when a child session is summed', () => {
    const store = createRoot(() => createChatStore());
    store.apply({ type: 'catalog', catalog });
    store.apply({
      type: 'snapshot',
      snapshot: {
        sessions: [
          { id: SES, createdAt: 1, updatedAt: 2, usage: { cost: 0.1, tokens: zero } },
          {
            id: 'ses_k',
            parentID: SES,
            createdAt: 3,
            updatedAt: 4,
            usage: { cost: 0.2, tokens: zero },
          },
        ],
        statuses: {},
        open: { sessionID: SES, messages: [answered('a', 10, 4912)], parts: {} },
        requests: { permissions: [], forms: [] },
        resolutions: [],
      },
    });
    const view = mount(() => <UsageIndicator store={store} />);
    mounted.push(view);
    const element = view.container.querySelector('.usage-line');
    expect(shown(element)).toBe('Context 9K / 200K (5%) · $0.30');
    expect(spoken(element)).toBe(
      'Context: 9,010 tokens of 200,000 (5%). Session cost: $0.30, including subagents.',
    );
  });

  it('updates when a step ends, without a snapshot', () => {
    const { store, line } = start([answered('a', 10, 4912)]);
    expect(shown(line())).toBe('Context 9K / 200K (5%)');
    store.apply({ type: 'message.upserted', sessionID: SES, message: answered('b', 20, 100_000) });
    expect(shown(line())).toBe('Context 104K / 200K (52%)');
  });

  it('follows the totals of session.upserted and keeps the same element', () => {
    const { store, line } = start([answered('a', 10, 4912)], {
      usage: { cost: 0.5, tokens: zero },
    });
    const before = line();
    store.apply({
      type: 'session.upserted',
      session: { id: SES, createdAt: 1, updatedAt: 2, usage: { cost: 0.75, tokens: zero } },
    });
    expect(shown(line())).toBe('Context 9K / 200K (5%) · $0.75');
    expect(line()).toBe(before);
  });

  it('flags a nearly full context with data-level="high" and still says the percentage', () => {
    const { line } = start([answered('a', 10, 160_000)]);
    expect(line()?.getAttribute('data-level')).toBe('high');
    expect(shown(line())).toContain('(82%)');
    expect(spoken(line())).toContain('(82%)');
  });

  it('drops the context after a compaction until a later step answers', () => {
    const { store, line } = start([answered('a', 10, 4912)], undefined, 50);
    expect(line()).toBeNull();
    store.apply({ type: 'message.upserted', sessionID: SES, message: answered('b', 60, 1000) });
    expect(shown(line())).toBe('Context 5K / 200K (3%)');
  });

  it('is plain text: the shorthand is aria-hidden, the full sentence is visually hidden, nothing is read twice', () => {
    const { line } = start([answered('a', 10, 4912)]);
    const element = line();
    expect(element?.tagName).toBe('P');
    expect(element?.hasAttribute('role')).toBe(false);
    expect(element?.hasAttribute('aria-label')).toBe(false);
    expect(element?.hasAttribute('title')).toBe(false);
    // What a screen reader reads: the text nodes outside any aria-hidden subtree.
    const readable = [...(element?.children ?? [])]
      .filter((child) => child.getAttribute('aria-hidden') !== 'true')
      .map((child) => child.textContent)
      .join('');
    expect(readable).toBe(spoken(element));
    // The tooltip sits on the aria-hidden span, so it is not exposed as a second description.
    expect(element?.querySelector('[aria-hidden="true"]')?.getAttribute('title')).toBe(
      spoken(element),
    );
  });

  it('is not a live region and has no style attribute', () => {
    const { line } = start([answered('a', 10, 4912)]);
    const element = line();
    expect(element?.hasAttribute('aria-live')).toBe(false);
    expect(element?.querySelector('[aria-live]')).toBeNull();
    expect(element?.hasAttribute('style')).toBe(false);
    expect(element?.querySelector('[style]')).toBeNull();
  });
});
