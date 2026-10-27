// Protects the "+" menu button of the prompt bar (E2, issue #85, phase 4) from the ways a menu
// button quietly breaks: the WAI-ARIA wiring (`aria-haspopup="menu"`, `aria-expanded`, `role="menu"`
// with `role="menuitem"`), the roving keys (arrows wrap, Home/End), Escape closing WITHOUT reaching
// the prompt box (which stops the turn on Escape while busy; the spy goes on `window` because Solid
// delegates to `document`, lesson #1070) and giving the focus back, Tab closing with the focus on
// the trigger so it never falls to the page, a pointer-down outside closing without moving the
// focus, `aria-disabled` instead of `disabled` without a connection (lesson #981), and the
// tooltip and name pinned by decision of Sergio (27/10/2026, Engram #1300; P16=1: no shortcut hint).
//
// Provenance: events synthesized in jsdom on Windows 11 with `document.activeElement` checks. They
// prove the wiring, not the look, the upward menu in a narrow side bar or a real mouse: those were
// observed by `npm run test:visual` (27/10/2026, Windows 11, VS Code 1.143.1; see `PlusMenu.tsx`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { must, mount, type Mounted } from '../testing';
import { PlusMenu } from './PlusMenu';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

function setup(disabled = false) {
  const calls = {
    selection: vi.fn(),
    file: vi.fn(),
    image: vi.fn(),
    mention: vi.fn(),
  };
  mounted = mount(() => (
    <PlusMenu
      disabled={disabled}
      onAddSelection={calls.selection}
      onAttachFile={calls.file}
      onAttachImage={calls.image}
      onMention={calls.mention}
    />
  ));
  const plus = must<HTMLButtonElement>(mounted.container, 'button[aria-haspopup="menu"]');
  const items = (): HTMLButtonElement[] => [
    ...(mounted?.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ];
  const press = (target: Element, key: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  return { calls, plus, items, press };
}

describe('PlusMenu', () => {
  it('names the button and explains it in the tooltip', () => {
    const { plus } = setup();
    expect(plus.getAttribute('aria-label')).toBe('Add context');
    expect(plus.title).toBe('Add context: selection, files, images or a mention');
    expect(plus.getAttribute('aria-expanded')).toBe('false');
    expect(plus.querySelector('svg')).not.toBeNull();
  });

  it('opens with the four items, the first one focused, and links the button to the menu', () => {
    const { plus, items } = setup();
    plus.click();
    expect(plus.getAttribute('aria-expanded')).toBe('true');
    const menu = must(mounted?.container ?? document.body, '[role="menu"]');
    expect(plus.getAttribute('aria-controls')).toBe(menu.id);
    expect(items().map((item) => item.textContent)).toEqual([
      'Add selection',
      'Attach file…',
      'Attach image…',
      'Mention a file',
    ]);
    expect(document.activeElement).toBe(items()[0]);
    // Roving: one tab stop.
    expect(items().map((item) => item.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('moves with the arrows (wrapping), Home and End', () => {
    const { plus, items, press } = setup();
    plus.click();
    press(items()[0] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    press(items()[1] as HTMLElement, 'End');
    expect(document.activeElement).toBe(items()[3]);
    press(items()[3] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    press(items()[0] as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(items()[3]);
    press(items()[3] as HTMLElement, 'Home');
    expect(document.activeElement).toBe(items()[0]);
  });

  it('opens from the closed button with ArrowDown (first item) and ArrowUp (last item)', () => {
    const { plus, items, press } = setup();
    expect(press(plus, 'ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items()[0]);
    press(items()[0] as HTMLElement, 'Escape');
    press(plus, 'ArrowUp');
    expect(document.activeElement).toBe(items()[3]);
  });

  it('closes on Escape, returns the focus to the button and does not reach the prompt', () => {
    const { plus, items, press } = setup();
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    plus.click();
    const event = press(items()[1] as HTMLElement, 'Escape');
    window.removeEventListener('keydown', reached);
    expect(event.defaultPrevented).toBe(true);
    expect(reached).not.toHaveBeenCalled();
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
    expect(plus.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(plus);
  });

  it('closes on Tab and leaves the focus on the button, not on the page', () => {
    const { plus, items, press } = setup();
    plus.click();
    const event = press(items()[0] as HTMLElement, 'Tab');
    expect(event.defaultPrevented).toBe(false);
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(plus);
  });

  it('runs the matching callback, closes, and returns the focus (not for the mention)', () => {
    const { plus, items, calls } = setup();
    plus.click();
    items()[0]?.click();
    expect(calls.selection).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(plus);
    plus.click();
    items()[1]?.click();
    plus.click();
    items()[2]?.click();
    plus.click();
    items()[3]?.click();
    expect(calls.file).toHaveBeenCalledTimes(1);
    expect(calls.image).toHaveBeenCalledTimes(1);
    expect(calls.mention).toHaveBeenCalledTimes(1);
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
  });

  it('closes on a pointer-down outside without moving the focus', () => {
    const { plus, items } = setup();
    const other = document.createElement('input');
    document.body.append(other);
    plus.click();
    other.focus();
    other.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(other);
    other.remove();
    expect(items()).toHaveLength(0);
  });

  it('closes when the focus goes to another element of the page', () => {
    const { plus } = setup();
    const other = document.createElement('input');
    document.body.append(other);
    plus.click();
    other.focus();
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
    other.remove();
  });

  // test:visual step 22 (27/10/2026): Ctrl+Alt+P with the menu open sent the focus to the editor and
  // left the menu open, because leaving the webview gives no `focusout` with a target.
  it('closes when the window loses the focus', () => {
    const { plus } = setup();
    plus.click();
    window.dispatchEvent(new Event('blur'));
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
  });

  // aria-disabled, not disabled: a disabled button that holds the focus drops it to the body.
  it('is aria-disabled, focusable and inert without a connection', () => {
    const { plus, calls, press } = setup(true);
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    expect(plus.disabled).toBe(false);
    plus.focus();
    expect(document.activeElement).toBe(plus);
    plus.click();
    press(plus, 'ArrowDown');
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
    expect(calls.selection).not.toHaveBeenCalled();
  });
});
