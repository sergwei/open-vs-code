// Protects the sections of the Settings tab that hold buttons and no data of their own (Work mode
// and Advanced; Mods has `ModsSection.test.tsx`, Models `ModelsSection.test.tsx`): each button sends
// exactly the message of its row and in the order of the rows, nothing is sent without a click, and
// Work mode (decision P2 of E10-settings-sections) explains Manual and Auto and offers ONLY "Open
// chat": no switch, never `toggleWorkMode`. Provenance: fabricated state in jsdom; what each command
// does once the host runs it is UNVERIFIED here (`settingsController.test.ts` maps the actions to
// contributed commands, the integration case of `settings.test.ts` is for a real host).
import { afterEach, describe, expect, it } from 'vitest';
import type { SettingsWebviewToHost } from '../../../src/shared/settingsProtocol';
import { mount, type Mounted } from '../testing';
import { AdvancedSection, WorkModeSection } from './LinkSections';

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
