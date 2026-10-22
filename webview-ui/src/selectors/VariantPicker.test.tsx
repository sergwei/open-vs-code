// Protects the reasoning-variant control (issue #61) from the ways such a widget quietly breaks:
//   - a control that shows up for a model with nothing to choose, or that hides a variant which is
//     set but no longer listed (the user would not know why the host refuses the send);
//   - a panel without a keyboard model (focus on the current entry, arrows, Enter, Escape giving the
//     focus back to the button) or with the current entry marked only by colour;
//   - a button that is `disabled` while it holds the focus (the focus falls onto the page) instead of
//     `aria-disabled`, and an accessible name that does not contain the visible text (WCAG 2.5.3);
//   - "Default" reaching the host as the string "default" instead of an absent variant.
//
// Provenance: FABRICATED choices rendered in jsdom (the ids low/high/max are what the planner's spike
// saw for glm-5.3-flash-free in a real opencode 2.0.32, Windows 11, 21/10/2026). They confirm the
// wiring of the component, not the layout, the upward panel in a narrow side bar, the real mouse, the
// focus ring or a screen reader (`npm run test:visual` step 14 covers the first three on Windows; the
// last is UNVERIFIED). Focus is checked with `document.activeElement`.
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { must, mount, type Mounted } from '../testing';
import type { VariantChoices } from './selection';
import { VariantPicker } from './VariantPicker';

const mounted: Mounted[] = [];
afterEach(() => {
  for (const item of mounted.splice(0)) item.dispose();
});

const LISTED: VariantChoices = { options: ['low', 'high', 'max'], visible: true };

interface Harness {
  view: Mounted;
  picked: (string | undefined)[];
  choose(choices: VariantChoices): void;
  disable(on: boolean): void;
  trigger(): HTMLButtonElement | null;
  open(): void;
  entries(): HTMLButtonElement[];
  key(target: Element, key: string): boolean;
}

/** Mounts the control with `choices`; the harness can change them and the connection afterwards. */
function start(choices: VariantChoices = LISTED, disabled = false): Harness {
  const picked: (string | undefined)[] = [];
  const [current, setCurrent] = createSignal(choices);
  const [off, setOff] = createSignal(disabled);
  const view = mount(() => (
    <VariantPicker
      choices={current()}
      disabled={off()}
      onSelect={(variant) => {
        picked.push(variant);
      }}
    />
  ));
  mounted.push(view);
  const harness: Harness = {
    view,
    picked,
    choose: setCurrent,
    disable: setOff,
    trigger: () => view.container.querySelector<HTMLButtonElement>('button.variant-trigger'),
    open: () => {
      harness.trigger()?.click();
    },
    entries: () => [...view.container.querySelectorAll<HTMLButtonElement>('button.model-option')],
    key: (target, key) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    },
  };
  return harness;
}

/** Lets the `queueMicrotask` that focuses the current entry run. */
const settle = () => Promise.resolve();

describe('visibility', () => {
  it('renders nothing for a model with nothing to choose', () => {
    const h = start({ options: [], visible: false });
    expect(h.trigger()).toBeNull();
    expect(h.view.container.textContent).toBe('');
  });

  it('appears and disappears as the effective model changes', () => {
    const h = start({ options: [], visible: false });
    h.choose(LISTED);
    expect(h.trigger()?.textContent).toBe('Reasoning: Default');
    h.choose({ options: [], visible: false });
    expect(h.trigger()).toBeNull();
  });
});

describe('the trigger', () => {
  it('says "Reasoning: Default" with no variant and "Reasoning: low" with one, and starts closed', () => {
    const h = start();
    expect(h.trigger()?.textContent).toBe('Reasoning: Default');
    expect(h.trigger()?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(h.trigger()?.getAttribute('aria-expanded')).toBe('false');
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    h.choose({ ...LISTED, current: 'low' });
    expect(h.trigger()?.textContent).toBe('Reasoning: low');
  });

  it('has no aria-label of its own, so its name is its visible text (WCAG 2.5.3)', () => {
    expect(start().trigger()?.getAttribute('aria-label')).toBeNull();
  });

  it('is aria-disabled, not disabled, without a connection, and does not open', () => {
    const h = start(LISTED, true);
    h.open();
    expect(h.trigger()?.getAttribute('aria-disabled')).toBe('true');
    expect(h.trigger()?.disabled).toBe(false);
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps the focus on the button when the connection drops with the panel open', async () => {
    const h = start();
    h.open();
    await settle();
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
    h.disable(true);
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(h.trigger());
  });
});

describe('the panel', () => {
  it('lists Default and the catalog ids in order, in a labelled non-modal dialog', async () => {
    const h = start();
    h.open();
    await settle();
    const dialog = must(h.view.container, '[role="dialog"]');
    expect(dialog.getAttribute('aria-label')).toBe('Choose a reasoning level');
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(h.trigger()?.getAttribute('aria-controls')).toBe(dialog.id);
    expect(h.entries().map((b) => b.querySelector('.model-name')?.textContent)).toEqual([
      'Default',
      'low',
      'high',
      'max',
    ]);
  });

  it('marks the current entry with aria-current and the word "Current", and focuses it', async () => {
    const h = start({ ...LISTED, current: 'high' });
    h.open();
    await settle();
    const current = h.entries().filter((b) => b.getAttribute('aria-current') === 'true');
    expect(current.map((b) => b.dataset['variant'])).toEqual(['high']);
    expect(current[0]?.querySelector('.model-meta')?.textContent).toBe('Current');
    expect(document.activeElement).toBe(current[0]);
    expect(h.entries().map((b) => b.tabIndex)).toEqual([-1, -1, 0, -1]);
  });

  it('Default is the current entry when no variant is set', async () => {
    const h = start();
    h.open();
    await settle();
    expect(h.entries()[0]?.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(h.entries()[0]);
  });

  it('shows a variant that is set but not listed as "<id> (unavailable)", and cannot pick it again', async () => {
    const h = start({ ...LISTED, current: 'ultra', missing: 'ultra' });
    expect(h.trigger()?.textContent).toBe('Reasoning: ultra (unavailable)');
    h.open();
    await settle();
    const names = h.entries().map((b) => b.querySelector('.model-name')?.textContent);
    expect(names).toEqual(['Default', 'low', 'high', 'max', 'ultra (unavailable)']);
    const missing = h.entries()[4] as HTMLElement;
    expect(missing.getAttribute('aria-current')).toBe('true');
    missing.click();
    expect(h.picked).toEqual([]);
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('stays visible with only the missing variant (a model with no variants but one set on it)', () => {
    const h = start({ options: [], current: 'low', missing: 'low', visible: true });
    expect(h.trigger()?.textContent).toBe('Reasoning: low (unavailable)');
  });
});

describe('choosing', () => {
  it('a click on a variant picks it, closes the panel and returns the focus to the button', async () => {
    const h = start();
    h.open();
    await settle();
    (h.entries()[2] as HTMLElement).click();
    expect(h.picked).toEqual(['high']);
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(h.trigger());
  });

  it('Default reaches the host as undefined, never as the string "default"', async () => {
    const h = start({ ...LISTED, current: 'low' });
    h.open();
    await settle();
    (h.entries()[0] as HTMLElement).click();
    expect(h.picked).toEqual([undefined]);
  });

  it('arrows, Home and End move between entries without wrapping', async () => {
    const h = start();
    h.open();
    await settle();
    const entries = h.entries();
    expect(h.key(entries[0] as Element, 'ArrowDown')).toBe(true);
    expect(document.activeElement).toBe(entries[1]);
    h.key(entries[1] as Element, 'End');
    expect(document.activeElement).toBe(entries[3]);
    h.key(entries[3] as Element, 'ArrowDown');
    expect(document.activeElement).toBe(entries[3]);
    h.key(entries[3] as Element, 'ArrowUp');
    expect(document.activeElement).toBe(entries[2]);
    h.key(entries[2] as Element, 'Home');
    expect(document.activeElement).toBe(entries[0]);
    h.key(entries[0] as Element, 'ArrowUp');
    expect(document.activeElement).toBe(entries[0]);
  });

  it('Escape closes without picking, returns the focus to the button and is not left to the prompt', async () => {
    const h = start();
    h.open();
    await settle();
    expect(h.key(h.entries()[0] as Element, 'Escape')).toBe(true);
    expect(h.picked).toEqual([]);
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(h.trigger());
  });

  it('a pointer-down outside closes the panel without moving the focus; on the trigger it does not', async () => {
    const outside = document.createElement('input');
    document.body.append(outside);
    const h = start();
    h.open();
    await settle();
    h.trigger()?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(h.view.container.querySelector('[role="dialog"]')).not.toBeNull();
    outside.focus();
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
