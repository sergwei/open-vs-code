// Protects the state only the settings webview keeps (section, search, open card, unsent form
// values): a corrupt or foreign saved state falls back to defaults, a state saved by the two-tab
// version (`tab`) still opens on the same section, every change is persisted at once, and the caps
// hold. Provenance: fabricated states handed to a fake `getState`/`setState` (the old `tab` shape
// is the one the previous version of `settingsUiState.ts` wrote); whether the state really survives
// hiding the tab in VS Code is UNVERIFIED, with no date: no `test:visual` cell hides and shows the
// tab (phase 5 judged the tab open, not its restoration after hiding).
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  createSettingsUi,
  migrateSection,
  SETTINGS_SECTIONS,
  type PersistedSettingsUi,
} from './settingsUiState';

function fakeApi(saved: unknown) {
  const setState = vi.fn<(state: PersistedSettingsUi) => void>();
  return { api: { getState: () => saved, setState }, setState };
}

describe('migrateSection', () => {
  it('keeps a saved section, maps the old tab, and opens General for anything else', () => {
    for (const section of SETTINGS_SECTIONS) expect(migrateSection({ section })).toBe(section);
    expect(migrateSection({ tab: 'providers' })).toBe('providers');
    expect(migrateSection({ tab: 'mcp' })).toBe('mcp');
    expect(migrateSection({})).toBe('general');
    // A valid section beats an old tab left in the same object.
    expect(migrateSection({ section: 'models', tab: 'mcp' })).toBe('models');
    for (const junk of [
      { section: 'nope' },
      { section: 7 },
      { section: null },
      { tab: 'x' },
      { tab: 'general' },
      { tab: ['mcp'] },
      { section: '__proto__' },
    ]) {
      expect(migrateSection(junk)).toBe('general');
    }
  });
});

describe('createSettingsUi', () => {
  it('starts on General with nothing typed when nothing was saved', () =>
    createRoot((dispose) => {
      const ui = createSettingsUi(fakeApi(undefined).api);
      expect(ui.section()).toBe('general');
      expect(ui.search()).toBe('');
      expect(ui.expanded()).toBeUndefined();
      expect(ui.draft('azure')).toEqual({});
      dispose();
    }));

  it('restores a valid saved state and ignores the broken parts', () =>
    createRoot((dispose) => {
      const ui = createSettingsUi(
        fakeApi({
          section: 'mcp',
          search: 'az',
          expanded: 'azure',
          drafts: { azure: { '0:resourceName': 'r1', bad: 3 }, other: 'nope' },
        }).api,
      );
      expect(ui.section()).toBe('mcp');
      expect(ui.search()).toBe('az');
      expect(ui.expanded()).toBe('azure');
      expect(ui.draft('azure')).toEqual({ '0:resourceName': 'r1' });
      expect(ui.draft('other')).toEqual({});
      const foreign = createSettingsUi(
        fakeApi({ section: 'x', search: 7, expanded: '', drafts: [] }).api,
      );
      expect(foreign.section()).toBe('general');
      expect(foreign.search()).toBe('');
      expect(foreign.expanded()).toBeUndefined();
      dispose();
    }));

  it('opens a state saved by the two-tab version on the same section, and saves it as section', () =>
    createRoot((dispose) => {
      const { api, setState } = fakeApi({ tab: 'mcp', search: 'az', drafts: {} });
      const ui = createSettingsUi(api);
      expect(ui.section()).toBe('mcp');
      expect(ui.search()).toBe('az');
      ui.setSection('models');
      const saved = setState.mock.lastCall?.[0];
      expect(saved).toEqual({ section: 'models', search: 'az', drafts: {} });
      expect(saved).not.toHaveProperty('tab');
      dispose();
    }));

  it('persists every change with the whole state', () =>
    createRoot((dispose) => {
      const { api, setState } = fakeApi(undefined);
      const ui = createSettingsUi(api);
      ui.setSection('mcp');
      ui.setSearch('goo');
      ui.setExpanded('azure');
      ui.setDraft('azure', '0:resourceName', 'r1');
      expect(setState).toHaveBeenLastCalledWith({
        section: 'mcp',
        search: 'goo',
        expanded: 'azure',
        drafts: { azure: { '0:resourceName': 'r1' } },
      });
      ui.clearDraft('azure');
      ui.setExpanded(undefined);
      expect(setState).toHaveBeenLastCalledWith({ section: 'mcp', search: 'goo', drafts: {} });
      dispose();
    }));

  it('caps the search and the draft values', () =>
    createRoot((dispose) => {
      const ui = createSettingsUi(fakeApi(undefined).api);
      ui.setSearch('x'.repeat(500));
      expect(ui.search()).toHaveLength(200);
      ui.setDraft('a', 'k', 'y'.repeat(5000));
      expect(ui.draft('a').k).toHaveLength(2000);
      dispose();
    }));
});
