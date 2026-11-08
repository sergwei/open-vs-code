// Protects the "Add provider" picker (issue #186, phase 1.3): the filter by name or id, the keyboard
// (arrows and Enter choose, Escape closes), the focus on opening, the cap on the list and the empty
// sentences. Provenance: fabricated rows (settingsFixtures.ts) in jsdom; the look at 620 and 300 px
// in four themes is `test:visual` step 36.
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderRow } from '../../../src/shared/settingsProtocol';
import { must, mount, type Mounted } from '../testing';
import { AddProviderPicker, matchesProvider } from './AddProviderPicker';
import { azure, bedrock, copilot, openai } from './settingsFixtures';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

function setup(rows: readonly ProviderRow[]) {
  const chosen: string[] = [];
  let closed = 0;
  const [search, setSearch] = createSignal('');
  mounted = mount(() => (
    <AddProviderPicker
      rows={rows}
      search={search()}
      onSearch={setSearch}
      onChoose={(id) => {
        chosen.push(id);
      }}
      onClose={() => {
        closed++;
      }}
    />
  ));
  const input = must<HTMLInputElement>(mounted.container, 'input');
  const type = (text: string): void => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const key = (name: string): void => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );
  };
  const options = (): (string | null)[] =>
    Array.from(mounted?.container.querySelectorAll('[role="option"]') ?? []).map((li) =>
      li.getAttribute('data-option'),
    );
  return { container: mounted.container, input, type, key, options, chosen, closed: () => closed };
}

describe('matchesProvider', () => {
  it('matches the name or the id, ignoring case and surrounding spaces, and blank matches all', () => {
    expect(matchesProvider(copilot, '  COPI ')).toBe(true);
    expect(matchesProvider(copilot, 'github-co')).toBe(true);
    expect(matchesProvider(copilot, 'azure')).toBe(false);
    expect(matchesProvider(copilot, '   ')).toBe(true);
  });
});

describe('AddProviderPicker with a list that changes', () => {
  /**
   * Protects review S3 of E10-settings-redesign: a provider connecting while the picker is open
   * shrinks `rows`, and the highlight kept an index past the end (`aria-activedescendant` on an
   * option that is not there, Enter doing nothing). Also that `aria-controls` is dropped while the
   * fallback paragraph replaces the list. Fabricated rows, jsdom.
   */
  it('clamps the highlight when the list shrinks and drops aria-controls without a list', () => {
    const [rows, setRows] = createSignal<readonly ProviderRow[]>([azure, copilot, openai]);
    const chosen: string[] = [];
    mounted = mount(() => (
      <AddProviderPicker
        rows={rows()}
        search=""
        onSearch={() => undefined}
        onChoose={(id) => {
          chosen.push(id);
        }}
        onClose={() => undefined}
      />
    ));
    const input = must<HTMLInputElement>(mounted.container, 'input');
    const key = (name: string): void => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
      );
    };
    key('ArrowDown');
    key('ArrowDown');
    setRows([azure]);
    const only = must(mounted.container, '[role="option"]');
    expect(input.getAttribute('aria-activedescendant')).toBe(only.id);
    key('Enter');
    expect(chosen).toEqual(['azure']);
    setRows([]);
    expect(input.hasAttribute('aria-controls')).toBe(false);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  });

  /**
   * Protects the arrows after the list shrank (review W2 of E10-settings-redesign): with the
   * highlight at 2 and the list cut to two rows, ArrowDown must wrap from the clamped 1 to 0. Moving
   * from the raw 2 would give (2 + 1) % 2 = 1, an option the user was already on. Fabricated rows,
   * jsdom. Mutation: `setActive((highlight() + step + count) % count)` in `onKeyDown` turns this
   * red (expected option 0, got option 1).
   */
  it('moves the arrows from the clamped highlight after the list shrinks', () => {
    const [rows, setRows] = createSignal<readonly ProviderRow[]>([azure, copilot, openai]);
    mounted = mount(() => (
      <AddProviderPicker
        rows={rows()}
        search=""
        onSearch={() => undefined}
        onChoose={() => undefined}
        onClose={() => undefined}
      />
    ));
    const input = must<HTMLInputElement>(mounted.container, 'input');
    const key = (name: string): void => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
      );
    };
    key('ArrowDown');
    key('ArrowDown');
    setRows([azure, copilot]);
    expect(input.getAttribute('aria-activedescendant')).toBe('provider-picker-option-1');
    key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('provider-picker-option-0');
  });
});

describe('AddProviderPicker', () => {
  it('takes the focus when it opens and wires the combobox to the list', () => {
    const { container, input } = setup([azure, copilot]);
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-controls')).toBe(must(container, '[role="listbox"]').id);
    expect(input.getAttribute('aria-activedescendant')).toBe(must(container, '[role="option"]').id);
    expect(input.placeholder).toBe('Search 2 providers…');
  });

  it('lists the method summary of each provider and filters while typing', () => {
    const { container, type, options } = setup([azure, copilot, openai, bedrock]);
    expect(container.textContent).toContain('3 ways to connect');
    expect(container.textContent).toContain('AWS profile');
    type('COPI');
    expect(options()).toEqual(['github-copilot']);
    type('zzz');
    expect(container.textContent).toContain('No provider matches “zzz”.');
    expect(options()).toEqual([]);
  });

  it('says the server lists no other providers when there are none to add', () => {
    const { container } = setup([]);
    expect(container.textContent).toContain('The server lists no other providers.');
  });

  it('moves with the arrows, wrapping, and chooses the highlighted one with Enter', () => {
    const { input, key, options, chosen } = setup([azure, copilot, openai]);
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    expect(chosen).toEqual(['openai']);
    key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('provider-picker-option-0');
    key('ArrowUp');
    key('Enter');
    expect(chosen.at(-1)).toBe('openai');
    expect(options()).toHaveLength(3);
  });

  // Protects the V6 failure of `test:visual` step 36 (07/11/2026): choosing on `mousedown` replaced
  // the list with the form under the pointer and the `click` closed the card again. jsdom proves
  // WHEN the choice is made (on `click`, with the focus kept in the input by the `mousedown`'s
  // `preventDefault`), not what a browser does with the click after the list is gone.
  it('chooses on click (not on mousedown) and closes on Escape without choosing', () => {
    const { container, key, chosen, closed } = setup([azure, copilot]);
    const option = must(container, '[data-option="github-copilot"]');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    option.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(chosen).toEqual([]);
    option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(chosen).toEqual(['github-copilot']);
    key('Escape');
    expect(closed()).toBe(1);
    expect(chosen).toEqual(['github-copilot']);
  });

  it('paints at most 30 providers and says how many more match', () => {
    const many: ProviderRow[] = Array.from({ length: 45 }, (_, index) => ({
      id: `p${String(index)}`,
      name: `Provider ${String(index)}`,
      connections: [],
      methods: [],
    }));
    const { container, options } = setup(many);
    expect(options()).toHaveLength(30);
    expect(container.textContent).toContain('15 more match: keep typing to narrow the list.');
  });
});
