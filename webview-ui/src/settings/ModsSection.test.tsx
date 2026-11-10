// Protects the Mods section of the Settings tab (issue #186, PR3): it lists the mods with the same
// rows as the chat popover, one switch each that sends `settings.modToggle` with the opposite and
// never assumes its outcome (`aria-busy` and `aria-disabled` until the listing changes or 5 s pass),
// shows a failed mod with its error, the skipped folders and the footer, says the mods are off with
// a link to the setting, says none were found, says they are not available when the host sent no
// mods half, and its two buttons send `reloadMods` and `openModsFolder`. Provenance: FABRICATED
// listings (`settingsFixtures.ts`) pushed into a real store, jsdom: this proves the wiring, not the
// look nor a real Worker (that is `test:visual` step 53 and the integration case "switches a mod
// off and on from the Settings tab" of `mods.test.ts`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModsListing } from '../../../src/shared/model';
import type { SettingsWebviewToHost } from '../../../src/shared/settingsProtocol';
import { must, mount, type Mounted } from '../testing';
import { makeState, modsListing } from './settingsFixtures';
import { ModsSection } from './ModsSection';
import { createSettingsStore } from './settingsStore';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
  vi.useRealTimers();
});

/** Mounts the section over a real store; `host` pushes a later listing (or none). */
function show(listing: ModsListing | undefined) {
  const store = createSettingsStore();
  const sent: SettingsWebviewToHost[] = [];
  const push = (next: ModsListing | undefined): void => {
    store.apply({
      type: 'settings.state',
      state: makeState(next === undefined ? {} : { mods: structuredClone(next) }),
    });
  };
  push(listing);
  mounted = mount(() => (
    <ModsSection
      state={store.state}
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
    row: (id: string) => must(container, `[data-mod-id="${id}"]`),
    toggle: (id: string) =>
      must<HTMLButtonElement>(container, `[data-mod-id="${id}"] button[role="switch"]`),
  };
}

describe('ModsSection', () => {
  it('lists each mod with its switch, a failed one with its error, the skipped folder and the footer', () => {
    const { container, row, toggle } = show(modsListing);
    expect(
      Array.from(container.querySelectorAll('button[role="switch"]')).map((button) => [
        button.getAttribute('aria-label'),
        button.getAttribute('aria-checked'),
      ]),
    ).toEqual([
      ['Quiet', 'true'],
      ['Throws', 'true'],
      ['Slow', 'true'],
      ['Off mod', 'false'],
    ]);
    expect(row('throws').textContent).toContain('boom at start-up');
    expect(row('slow').textContent).toContain('Starting…');
    expect(row('throws').getAttribute('tabindex')).toBe('-1');
    expect(container.textContent).toContain('Skipped: mod.json is missing');
    expect(container.textContent).toContain('Saved for this workspace.');
    expect(toggle('quiet').disabled).toBe(false);
  });

  it('a switch sends settings.modToggle with the opposite and stays busy until the listing changes', () => {
    const { sent, host, toggle, row } = show(modsListing);
    toggle('quiet').click();
    expect(sent).toEqual([{ type: 'settings.modToggle', modId: 'quiet', enabled: false }]);
    expect(toggle('quiet').getAttribute('aria-disabled')).toBe('true');
    expect(row('quiet').getAttribute('aria-busy')).toBe('true');
    toggle('quiet').click();
    expect(sent).toHaveLength(1);
    // The switch did not change by itself: only the host's next state does it.
    expect(toggle('quiet').getAttribute('aria-checked')).toBe('true');
    const next = structuredClone(modsListing);
    next.mods = next.mods.map((mod) =>
      mod.id === 'quiet' ? { ...mod, enabled: false, state: 'disabled' } : mod,
    );
    host(next);
    expect(toggle('quiet').getAttribute('aria-checked')).toBe('false');
    expect(toggle('quiet').getAttribute('aria-disabled')).toBeNull();
    toggle('off-mod').click();
    expect(sent.at(-1)).toEqual({ type: 'settings.modToggle', modId: 'off-mod', enabled: true });
  });

  it('frees a row after 5 s when the host answers with a notice only', () => {
    vi.useFakeTimers();
    const { toggle } = show(modsListing);
    toggle('quiet').click();
    expect(toggle('quiet').getAttribute('aria-disabled')).toBe('true');
    vi.advanceTimersByTime(5000);
    expect(toggle('quiet').getAttribute('aria-disabled')).toBeNull();
  });

  it('with the global switch off: a note, aria-disabled switches, no toggle, and Open Settings', () => {
    const { container, sent, toggle } = show({ ...modsListing, enabled: false });
    expect(must(container, '.mods-off').textContent).toContain('Mods are turned off');
    expect(toggle('quiet').getAttribute('aria-disabled')).toBe('true');
    toggle('quiet').click();
    expect(sent).toEqual([]);
    must<HTMLButtonElement>(container, '.mods-off button').click();
    expect(sent).toEqual([{ type: 'settings.openSetting', key: 'mods.enabled' }]);
  });

  it('says none were found when the list is empty, and that mods are not available without a mods half', () => {
    const empty = show({ enabled: true, persisted: true, mods: [], skipped: [] });
    expect(empty.container.textContent).toContain('No mods were found.');
    expect(empty.container.querySelector('button[role="switch"]')).toBeNull();
    mounted?.dispose();
    const absent = show(undefined);
    expect(absent.container.textContent).toContain('Mods are not available.');
    expect(absent.container.textContent).not.toContain('No mods were found.');
  });

  it('sends reloadMods, openModsFolder and the mods.enabled setting from its buttons, and nothing before', () => {
    const { container, sent } = show({ enabled: true, persisted: true, mods: [], skipped: [] });
    expect(sent).toEqual([]);
    for (const button of Array.from(container.querySelectorAll('button'))) button.click();
    expect(sent).toEqual([
      { type: 'settings.action', action: 'reloadMods' },
      { type: 'settings.action', action: 'openModsFolder' },
      { type: 'settings.openSetting', key: 'mods.enabled' },
    ]);
  });
});
