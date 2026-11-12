// Protects the tab row of the chat panel (issue #188): the WAI-ARIA tabs pattern (roles,
// aria-selected, roving tabindex, arrows with wrap-around, Home/End, activation on focus move) and
// the two badges (the word "working" on Chat during a turn, the number of changed files on Changes).
//
// Provenance: the component alone in jsdom with FABRICATED props. They confirm the wiring and the
// attributes, not the layout in a narrow bar nor a screen reader (`test:visual` step 54, phase 5).
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../testing';
import type { PanelTab } from './panelTab';
import { PanelTabs } from './PanelTabs';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

/** Mounts the row over a signal, so the tests can see which tab the parent holds. */
function setup(options: { working?: boolean; changedCount?: number } = {}) {
  const [active, setActive] = createSignal<PanelTab>('chat');
  mounted = mount(() => (
    <PanelTabs
      active={active()}
      onSelect={setActive}
      working={options.working ?? false}
      changedCount={options.changedCount ?? 0}
    />
  ));
  const tabs = [...mounted.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const press = (tab: HTMLElement, key: string): void => {
    tab.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
  return { active, tabs, press };
}

describe('PanelTabs', () => {
  it('is a tablist of Chat, Changes and Session with the pattern attributes', () => {
    const { tabs } = setup();
    expect(mounted?.container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      'Chat panel',
    );
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Chat', 'Changes', 'Session']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs.map((tab) => tab.getAttribute('aria-controls'))).toEqual([
      'panel-chat',
      'panel-changes',
      'panel-session',
    ]);
  });

  it('activates and focuses a tab on click, moving the roving tabindex', () => {
    const { tabs, active } = setup();
    tabs[2]?.click();
    expect(active()).toBe('session');
    expect(document.activeElement).toBe(tabs[2]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('moves with the arrows (wrapping), Home and End, activating each tab it reaches', () => {
    const { tabs, active, press } = setup();
    press(tabs[0] as HTMLElement, 'ArrowLeft');
    expect(active()).toBe('session');
    press(tabs[2] as HTMLElement, 'ArrowRight');
    expect(active()).toBe('chat');
    press(tabs[0] as HTMLElement, 'End');
    expect(active()).toBe('session');
    press(tabs[2] as HTMLElement, 'Home');
    expect(active()).toBe('chat');
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('ignores the keys that are not tab keys', () => {
    const { tabs, active, press } = setup();
    press(tabs[0] as HTMLElement, 'a');
    press(tabs[0] as HTMLElement, 'Enter');
    expect(active()).toBe('chat');
  });

  it('shows "working" on Chat during a turn and the file count on Changes when positive', () => {
    const idle = setup();
    expect(idle.tabs.map((tab) => tab.textContent)).toEqual(['Chat', 'Changes', 'Session']);
    mounted?.dispose();
    const busy = setup({ working: true, changedCount: 3 });
    expect(busy.tabs.map((tab) => tab.textContent)).toEqual(['Chatworking', 'Changes3', 'Session']);
    expect(busy.tabs[0]?.querySelector('[data-badge="working"]')?.textContent).toBe('working');
    expect(busy.tabs[1]?.querySelector('[data-badge="count"]')?.textContent).toBe('3');
  });
});
