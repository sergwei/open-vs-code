// Protects the "/" button of the prompt bar (issue #33, decisions P1=1, P6=1 and P7=1 of Sergio,
// 28/10/2026, Engram #1416), the twin of the "+" menu: the WAI-ARIA wiring (`aria-haspopup="menu"`,
// `aria-expanded`, `role="menu"` with `role="menuitem"`), the roving keys, Escape closing WITHOUT
// reaching the prompt box (spy on `window`, because Solid delegates to `document`, lesson #1070) and
// giving the focus back, Tab closing with the focus kept on the trigger, `aria-disabled` instead of
// `disabled` (lesson #981), the names pinned by P7, and the three states (Engram #1425): "Loading
// commands…", "Commands could not be loaded" and "No commands available", each a lone disabled
// menuitem with the focus.
//
// Provenance: events synthesized in jsdom on Windows 11 with `document.activeElement` checks and
// FABRICATED commands. They prove the wiring, not the look, the upward menu in a narrow bar or a
// real mouse: those are the `test:visual` checks "C1 the "/" button is pressed with the real mouse"
// and "C4 Enter on the "/" button opens the menu with the focus on the first item" (Windows 11, VS
// Code 1.144.0, 28/10/2026).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandOption } from '../../../src/shared/model';
import { must, mount, type Mounted } from '../testing';
import { CommandMenu } from './CommandMenu';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

const COMMANDS: readonly CommandOption[] = [
  { name: 'init', description: 'guided AGENTS.md setup' },
  { name: 'review', description: 'review changes' },
  { name: 'docs:search' },
];

/** `null` stands for an ABSENT list (the host could not read it). */
function setup(commands: readonly CommandOption[] | null = COMMANDS, disabled = false) {
  const onPick = vi.fn<(name: string) => void>();
  mounted = mount(() => (
    <CommandMenu commands={commands ?? undefined} disabled={disabled} onPick={onPick} />
  ));
  const trigger = must<HTMLButtonElement>(mounted.container, 'button[aria-haspopup="menu"]');
  const items = (): HTMLButtonElement[] => [
    ...(mounted?.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ];
  const press = (target: Element, key: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  return { onPick, trigger, items, press };
}

describe('CommandMenu', () => {
  it('names the button and explains it in the tooltip', () => {
    const { trigger } = setup();
    expect(trigger.getAttribute('aria-label')).toBe('Commands');
    expect(trigger.title).toBe('Run a slash command');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.querySelector('svg')).not.toBeNull();
  });

  it('opens with one item per command, the first focused, linked to the button', () => {
    const { trigger, items } = setup();
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = must(mounted?.container ?? document.body, '[role="menu"]');
    expect(menu.getAttribute('aria-label')).toBe('Slash commands');
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
    expect(items().map((item) => item.textContent)).toEqual([
      '/initguided AGENTS.md setup',
      '/reviewreview changes',
      '/docs:search',
    ]);
    expect(items()[0]?.title).toBe('guided AGENTS.md setup');
    expect(document.activeElement).toBe(items()[0]);
    expect(items().map((item) => item.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves with the arrows (wrapping), Home and End', () => {
    const { trigger, items, press } = setup();
    trigger.click();
    press(items()[0] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    press(items()[1] as HTMLElement, 'End');
    expect(document.activeElement).toBe(items()[2]);
    press(items()[2] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    press(items()[0] as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(items()[2]);
    press(items()[2] as HTMLElement, 'Home');
    expect(document.activeElement).toBe(items()[0]);
  });

  it('opens from the closed trigger with the arrows, first or last item', () => {
    const { trigger, items, press } = setup();
    press(trigger, 'ArrowUp');
    expect(document.activeElement).toBe(items()[2]);
  });

  // A click, not an Enter: jsdom does not turn Enter into a click; the real Enter is the
  // `test:visual` check "C4 Enter on the "/" button opens the menu with the focus on the first item".
  it('a click on an item picks it, closes the menu and leaves the focus to the parent', () => {
    const { trigger, items, onPick } = setup();
    trigger.click();
    items()[1]?.click();
    expect(onPick).toHaveBeenCalledWith('review');
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('Escape closes, gives the focus back and does not reach the window', () => {
    const { trigger, items, press } = setup();
    trigger.click();
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    const escape = press(items()[0] as HTMLElement, 'Escape');
    window.removeEventListener('keydown', spy);
    expect(escape.defaultPrevented).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Tab closes and the focus stays on the button, not the page', () => {
    const { trigger, items, press } = setup();
    trigger.click();
    press(items()[0] as HTMLElement, 'Tab');
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('a pointer-down outside closes it without moving the focus', () => {
    const { trigger } = setup();
    trigger.click();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
  });

  it('is aria-disabled, never disabled, and ignores clicks and keys', () => {
    const { trigger, press, onPick } = setup(COMMANDS, true);
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.disabled).toBe(false);
    trigger.click();
    press(trigger, 'ArrowDown');
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  // Decision of Sergio, 28/10/2026 (Engram #1425): three different states, each as the ONLY
  // menuitem (aria-disabled, focused), so a screen reader announces it. FABRICATED props.
  describe.each([
    ['no catalog yet', null, true, 'Loading commands…'],
    ['a catalog without the list', null, false, 'Commands could not be loaded'],
    ['an empty list', [], false, 'No commands available'],
  ] as const)('%s', (_name, commands, loading, text) => {
    const open = () => {
      const view = setupStatus(commands, loading);
      view.trigger.click();
      return view;
    };

    it(`says "${text}" in a single disabled menuitem that has the focus`, () => {
      const { items } = open();
      expect(items()).toHaveLength(1);
      expect(items()[0]?.textContent).toBe(text);
      expect(items()[0]?.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(items()[0]);
    });

    it('Enter and a click on it do nothing, and Escape gives the focus back to the button', () => {
      const { trigger, items, press, onPick } = open();
      const item = items()[0] as HTMLButtonElement;
      press(item, 'Enter');
      item.click();
      expect(onPick).not.toHaveBeenCalled();
      expect(mounted?.container.querySelector('[role="menu"]')).not.toBeNull();
      press(item, 'Escape');
      expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });
});

/** Like `setup`, with the `loading` prop; `null` stands for an absent list. */
function setupStatus(commands: readonly CommandOption[] | null, loading: boolean) {
  const onPick = vi.fn<(name: string) => void>();
  mounted = mount(() => (
    <CommandMenu
      commands={commands ?? undefined}
      loading={loading}
      disabled={false}
      onPick={onPick}
    />
  ));
  const trigger = must<HTMLButtonElement>(mounted.container, 'button[aria-haspopup="menu"]');
  const items = (): HTMLButtonElement[] => [
    ...(mounted?.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ];
  const press = (target: Element, key: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  return { onPick, trigger, items, press };
}
