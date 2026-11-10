// Protects the two controls of the General section (issue #186, PR3): the select of `chatLocation`
// and the switch of `autoStart` send exactly `settings.setSetting` with the value picked and no
// other; neither is optimistic (the select goes back to the state value after every state, the
// switch reads `aria-checked` from the state); the switch is never `disabled`; and a workspace
// value shows its hint with the button that opens the setting. Provenance: FABRICATED state pushed
// into a real store, jsdom; the fit and contrast in a real VS Code are `test:visual` steps 47 and 53,
// and the write to the user settings is the integration case "the Settings tab writes chatLocation
// and autoStart to the USER settings".
import { afterEach, describe, expect, it } from 'vitest';
import type { SettingsGeneral, SettingsWebviewToHost } from '../../../src/shared/settingsProtocol';
import { must, mount, type Mounted } from '../testing';
import { GeneralSection } from './GeneralSection';
import { makeState } from './settingsFixtures';
import { createSettingsStore } from './settingsStore';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

const general = (overrides: Partial<SettingsGeneral> = {}): SettingsGeneral => ({
  chatLocation: { value: 'editor', workspaceOverride: false },
  autoStart: { value: true, workspaceOverride: false },
  ...overrides,
});

function show(initial: SettingsGeneral = general()) {
  const store = createSettingsStore();
  const sent: SettingsWebviewToHost[] = [];
  const push = (next: SettingsGeneral): void => {
    store.apply({ type: 'settings.state', state: makeState({ general: structuredClone(next) }) });
  };
  push(initial);
  mounted = mount(() => (
    <GeneralSection
      state={store.state}
      items={[]}
      onJump={() => undefined}
      send={(message) => {
        sent.push(message);
      }}
    />
  ));
  const container = mounted.container;
  return {
    container,
    sent,
    host: push,
    select: () => must<HTMLSelectElement>(container, '#settings-chat-location'),
    toggle: () => must<HTMLButtonElement>(container, 'button[role="switch"]'),
  };
}

describe('GeneralSection controls', () => {
  it('the select and the switch send the exact message', () => {
    const { select, toggle, sent } = show();
    expect(select().value).toBe('editor');
    expect(Array.from(select().options).map((option) => option.textContent)).toEqual([
      'Editor tabs',
      'Side bar',
    ]);
    select().value = 'sidebar';
    select().dispatchEvent(new Event('change', { bubbles: true }));
    toggle().click();
    expect(sent).toEqual([
      { type: 'settings.setSetting', key: 'chatLocation', value: 'sidebar' },
      { type: 'settings.setSetting', key: 'autoStart', value: false },
    ]);
    expect(toggle().disabled).toBe(false);
    expect(toggle().getAttribute('aria-labelledby')).toBe('settings-auto-start-title');
  });

  it('puts the select back to the state value, never optimistic', () => {
    const { select, toggle, host } = show();
    select().value = 'sidebar';
    select().dispatchEvent(new Event('change', { bubbles: true }));
    // Not written yet (or refused): the select is already back on the saved value.
    expect(select().value).toBe('editor');
    host(general());
    expect(select().value).toBe('editor');
    toggle().click();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    host(general({ autoStart: { value: false, workspaceOverride: false } }));
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    host(general({ chatLocation: { value: 'sidebar', workspaceOverride: false } }));
    expect(select().value).toBe('sidebar');
  });

  it('shows the workspace hint of each setting and opens it', () => {
    const none = show();
    expect(none.container.querySelector('[data-hint="workspace"]')).toBeNull();
    mounted?.dispose();
    const { container, sent } = show(
      general({
        chatLocation: { value: 'editor', workspaceOverride: true },
        autoStart: { value: true, workspaceOverride: true },
      }),
    );
    const hints = Array.from(container.querySelectorAll<HTMLElement>('[data-hint="workspace"]'));
    expect(hints.map((hint) => hint.getAttribute('data-setting'))).toEqual([
      'chatLocation',
      'autoStart',
    ]);
    for (const hint of hints) must<HTMLButtonElement>(hint, 'button').click();
    expect(sent).toEqual([
      { type: 'settings.openSetting', key: 'chatLocation' },
      { type: 'settings.openSetting', key: 'autoStart' },
    ]);
  });
});
