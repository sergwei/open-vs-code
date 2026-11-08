// Protects the sections that only link in phase 1.2 of issue #186 (Mods, Work mode, Advanced): each
// button sends exactly the message of its row, nothing is sent without a click, and Work mode has
// text and no button. (The Models section has its own file, `ModelsSection.test.tsx`.) Provenance:
// fabricated state in jsdom; what the native Settings editor shows after `settings.openSetting` is
// UNVERIFIED: the synthetic-server case in `fakeServer.test.ts` covers `settings.setDefaultModel`,
// not this link.
import { afterEach, describe, expect, it } from 'vitest';
import type { SettingsWebviewToHost } from '../../../src/shared/settingsProtocol';
import { must, mount, type Mounted } from '../testing';
import { AdvancedSection, ModsSection, WorkModeSection } from './LinkSections';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

function buttons(container: Element): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'));
}

describe('link sections', () => {
  it('Mods opens openVsCode.mods.enabled and sends nothing before the click', () => {
    const sent: SettingsWebviewToHost[] = [];
    mounted = mount(() => (
      <ModsSection
        send={(message) => {
          sent.push(message);
        }}
      />
    ));
    expect(sent).toEqual([]);
    must<HTMLButtonElement>(mounted.container, 'button').click();
    expect(sent).toEqual([{ type: 'settings.openSetting', key: 'mods.enabled' }]);
    expect(buttons(mounted.container)[0]?.getAttribute('aria-label')).toBe(
      'Open setting: Enable mods',
    );
  });

  it('Work mode is text only: the sentences are there and there is no button', () => {
    mounted = mount(() => <WorkModeSection />);
    expect(mounted.container.querySelectorAll('button')).toHaveLength(0);
    expect(mounted.container.textContent).toContain('Manual asks before each action.');
    expect(mounted.container.textContent).toContain('Toggle Work Mode');
  });

  it('Advanced opens the two machine settings and runs the two footer actions', () => {
    const sent: SettingsWebviewToHost[] = [];
    mounted = mount(() => (
      <AdvancedSection
        send={(message) => {
          sent.push(message);
        }}
      />
    ));
    for (const button of buttons(mounted.container)) button.click();
    expect(sent).toEqual([
      { type: 'settings.openSetting', key: 'opencodePath' },
      { type: 'settings.openSetting', key: 'serverUrl' },
      { type: 'settings.action', action: 'logs' },
      { type: 'settings.action', action: 'extensionSettings' },
    ]);
  });
});
