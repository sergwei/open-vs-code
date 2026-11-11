// Protects the sections of the Settings tab that hold buttons and no data of their own (Work mode
// and Advanced; Mods has `ModsSection.test.tsx`, Models `ModelsSection.test.tsx`): each button sends
// exactly the message of its row and in the order of the rows, nothing is sent without a click, and
// Work mode (decision P2 of E10-settings-sections) explains Manual and Auto and offers ONLY "Open
// chat": no switch, never `toggleWorkMode`. Provenance: fabricated state in jsdom; what each command
// does once the host runs it is UNVERIFIED here (`settingsController.test.ts` maps the actions to
// contributed commands, the integration case of `settings.test.ts` is for a real host).
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { SettingsState, SettingsWebviewToHost } from '../../../src/shared/settingsProtocol';
import { mount, type Mounted } from '../testing';
import { AdvancedSection, WorkModeSection } from './LinkSections';
import { makeState } from './settingsFixtures';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

function buttons(container: Element): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'));
}

describe('link sections', () => {
  it('Work mode explains Manual and Auto and offers only Open chat', () => {
    const sent: SettingsWebviewToHost[] = [];
    mounted = mount(() => (
      <WorkModeSection
        send={(message) => {
          sent.push(message);
        }}
      />
    ));
    expect(mounted.container.textContent).toContain('Manual asks before each action.');
    expect(mounted.container.textContent).toContain('Toggle Work Mode');
    expect(mounted.container.querySelector('[role="switch"]')).toBeNull();
    const all = buttons(mounted.container);
    expect(all).toHaveLength(1);
    expect(sent).toEqual([]);
    all[0]?.click();
    expect(sent).toEqual([{ type: 'settings.action', action: 'openChat' }]);
  });

  it('sends each action of Advanced in order', () => {
    const sent: SettingsWebviewToHost[] = [];
    mounted = mount(() => (
      <AdvancedSection
        state={makeState()}
        send={(message) => {
          sent.push(message);
        }}
      />
    ));
    const all = buttons(mounted.container);
    expect(all.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open setting: opencode executable path',
      'Open setting: External server URL',
      'Set password: Server password',
      'Forget password: Server password',
      'Manage: Saved permissions',
      'Forget decision: Plugins of this folder',
      'Show logs: Log',
      'Open settings: All extension settings',
    ]);
    expect(sent).toEqual([]);
    for (const button of all) button.click();
    expect(sent).toEqual([
      { type: 'settings.openSetting', key: 'opencodePath' },
      { type: 'settings.openSetting', key: 'serverUrl' },
      { type: 'settings.action', action: 'setServerPassword' },
      { type: 'settings.action', action: 'clearServerPassword' },
      { type: 'settings.action', action: 'managePermissions' },
      { type: 'settings.action', action: 'forgetPluginDecision' },
      { type: 'settings.action', action: 'logs' },
      { type: 'settings.action', action: 'extensionSettings' },
    ]);
  });

  it('opens the two machine settings from Advanced', () => {
    const sent: SettingsWebviewToHost[] = [];
    mounted = mount(() => (
      <AdvancedSection
        state={makeState()}
        send={(message) => {
          sent.push(message);
        }}
      />
    ));
    const [path, url] = buttons(mounted.container);
    path?.click();
    url?.click();
    expect(sent).toEqual([
      { type: 'settings.openSetting', key: 'opencodePath' },
      { type: 'settings.openSetting', key: 'serverUrl' },
    ]);
  });
});

/**
 * Protects issue #205 (decisions P1-P3): the shell row of Advanced. State is fabricated and the
 * select is driven by `change` events in jsdom; what VS Code shows is `test:visual` step 53 (F3).
 */
describe('the shell row of Advanced', () => {
  const options = [
    { value: 'bash', name: 'bash', terminalOnly: false },
    { value: '/usr/bin/fish', name: 'fish', terminalOnly: true },
  ];

  function shellState(shell: Partial<SettingsState['shell']>): SettingsState {
    return makeState({
      shell: {
        loaded: true,
        failed: false,
        writing: false,
        current: '',
        overridden: false,
        options,
        ...shell,
      },
    });
  }

  function mountShell(initial: SettingsState): {
    sent: SettingsWebviewToHost[];
    set: (state: SettingsState) => void;
  } {
    const sent: SettingsWebviewToHost[] = [];
    const [state, set] = createSignal(initial);
    mounted = mount(() => (
      <AdvancedSection
        state={state()}
        send={(message) => {
          sent.push(message);
        }}
      />
    ));
    return { sent, set };
  }

  function shellSelect(): HTMLSelectElement {
    const element = mounted?.container.querySelector<HTMLSelectElement>('#settings-shell');
    if (element === null || element === undefined) throw new Error('no shell select');
    return element;
  }

  function pick(value: string): void {
    const select = shellSelect();
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('lists Automatic and the options, marks the terminal-only one, and shows the saved shell', () => {
    mountShell(shellState({ current: 'bash' }));
    const select = shellSelect();
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Automatic',
      'bash',
      'fish (terminal only)',
    ]);
    expect(select.value).toBe('bash');
    expect(select.getAttribute('data-setting')).toBe('shell');
    expect(mounted?.container.querySelector('label[for="settings-shell"]')?.textContent).toBe(
      'opencode shell',
    );
    expect(mounted?.container.textContent).toContain('global opencode config');
  });

  it('sends exactly one setShell per pick, and the select goes back to the saved shell', () => {
    const { sent } = mountShell(shellState({ current: 'bash' }));
    pick('/usr/bin/fish');
    expect(sent).toEqual([{ type: 'settings.setShell', shell: '/usr/bin/fish' }]);
    expect(shellSelect().value).toBe('bash');
    pick('');
    expect(sent[1]).toEqual({ type: 'settings.setShell', shell: '' });
  });

  it('shows the pick while writing, ignores a second pick, and never disables the select', () => {
    const { sent, set } = mountShell(shellState({ current: '' }));
    pick('bash');
    set(shellState({ current: '', writing: true }));
    const select = shellSelect();
    expect(select.value).toBe('bash');
    expect(select.getAttribute('aria-busy')).toBe('true');
    expect(select.getAttribute('aria-disabled')).toBe('true');
    expect(select.disabled).toBe(false);
    pick('/usr/bin/fish');
    expect(sent).toHaveLength(1);
    expect(select.value).toBe('bash');
    set(shellState({ current: 'bash', writing: false }));
    expect(select.value).toBe('bash');
    expect(select.hasAttribute('aria-busy')).toBe(false);
  });

  it('returns to the saved shell when the write ends refused, even with the same value', () => {
    const { set } = mountShell(shellState({ current: '' }));
    pick('bash');
    set(shellState({ current: '', writing: true }));
    expect(shellSelect().value).toBe('bash');
    set(shellState({ current: '', writing: false }));
    expect(shellSelect().value).toBe('');
  });

  it('says the shells are being read, or could not be read, and has no select then', () => {
    const loading = mountShell(shellState({ loaded: false }));
    expect(mounted?.container.querySelector('#settings-shell')).toBeNull();
    expect(mounted?.container.textContent).toContain('Reading the shells…');
    loading.set(shellState({ loaded: true, failed: true, current: 'zsh' }));
    expect(mounted?.container.querySelector('#settings-shell')).toBeNull();
    expect(mounted?.container.textContent).toContain('The shells could not be read. zsh');
  });

  it('tells when another config hides the shell, and not otherwise', () => {
    const { set } = mountShell(shellState({ overridden: true }));
    expect(mounted?.container.querySelector('[data-hint="shell-override"]')?.textContent).toContain(
      'sets its own shell',
    );
    set(shellState({ overridden: false }));
    expect(mounted?.container.querySelector('[data-hint="shell-override"]')).toBeNull();
  });
});
