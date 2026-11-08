// Protects the combobox of the header search (issue #186): the ARIA wiring a screen reader needs, the
// keys (arrows, Enter, Escape twice), choosing by Enter and by mouse, the list closing when the
// focus leaves, and the "nothing matches" line. Provenance: fabricated entries in jsdom; a screen
// reader announcing the options is UNVERIFIED, and the look is `test:visual` step 46 (cell S1).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { must, mount, type Mounted } from '../testing';
import { SettingsSearch } from './SearchBox';
import type { SearchEntry } from './settingsSearch';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

const entry = (label: string): SearchEntry => ({
  id: label,
  label,
  detail: 'Section',
  keywords: '',
  target: { kind: 'jump', section: 'general' },
});
const ENTRIES = [entry('Alpha one'), entry('Alpha two'), entry('Beta')];

function setup() {
  const chosen: string[] = [];
  mounted = mount(() => (
    <SettingsSearch
      entries={() => ENTRIES}
      onChoose={(picked) => {
        chosen.push(picked.label);
      }}
    />
  ));
  const container = mounted.container;
  const input = must<HTMLInputElement>(container, 'input');
  const type = (text: string): void => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const press = (key: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return event;
  };
  return { container, input, type, press, chosen };
}

describe('SettingsSearch', () => {
  it('wires the combobox, the listbox and aria-activedescendant', () => {
    const { container, input, type } = setup();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    type('alp');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(
      must(container, '[role="listbox"]').getAttribute('id'),
    );
    const options = Array.from(container.querySelectorAll('[role="option"]'));
    expect(options.map((o) => o.querySelector('.settings-search-label')?.textContent)).toEqual([
      'Alpha one',
      'Alpha two',
    ]);
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.getAttribute('id'));
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  });

  it('moves the highlight with the arrows, wrapping, and chooses with Enter', () => {
    const { container, input, type, press, chosen } = setup();
    type('alp');
    press('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(
      container.querySelectorAll('[role="option"]')[1]?.getAttribute('id'),
    );
    press('ArrowDown');
    expect(container.querySelectorAll('[role="option"]')[0]?.getAttribute('aria-selected')).toBe(
      'true',
    );
    press('ArrowUp');
    press('Enter');
    expect(chosen).toEqual(['Alpha two']);
    // Choosing closes the list and leaves the text.
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(input.value).toBe('alp');
  });

  it('chooses with the mouse without taking the focus from the input', () => {
    const { container, input, type, chosen } = setup();
    input.focus();
    type('beta');
    const option = must(container, '[role="option"]');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    option.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    // The choice is made on `click`, after the press: choosing on `mousedown` removed the list
    // under the pointer and the click landed on something else (provider picker, step 36 V6).
    expect(chosen).toEqual([]);
    option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(chosen).toEqual(['Beta']);
    expect(document.activeElement).toBe(input);
  });

  it('closes with Escape and clears with a second Escape', () => {
    const { container, input, type, press } = setup();
    type('alp');
    const first = press('Escape');
    expect(first.defaultPrevented).toBe(true);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(input.value).toBe('alp');
    press('Escape');
    expect(input.value).toBe('');
    const third = press('Escape');
    expect(third.defaultPrevented).toBe(false);
  });

  it('does not eat Enter when no list is open, and opens with ArrowDown', () => {
    const { container, input, type, press, chosen } = setup();
    type('alp');
    press('Escape');
    const enter = press('Enter');
    expect(enter.defaultPrevented).toBe(false);
    expect(chosen).toEqual([]);
    press('ArrowDown');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it('says nothing matches, without options, and stays closed for a blank text', () => {
    const { container, type, press, chosen } = setup();
    type('zzz');
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(must(container, '[role="listbox"]').textContent).toBe('Nothing matches “zzz”.');
    press('Enter');
    expect(chosen).toEqual([]);
    type('   ');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('closes when the focus leaves, and stays open when it moves inside', () => {
    const { container, input, type } = setup();
    input.focus();
    type('alp');
    const option = must(container, '[role="option"]');
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: option }));
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    input.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }),
    );
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    // Reopens on focus while there is text.
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.restoreAllMocks();
  });
});
