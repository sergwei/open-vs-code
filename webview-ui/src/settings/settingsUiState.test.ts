// Protects the state only the settings webview keeps (tab, search, open card, unsent form values):
// a corrupt or foreign saved state falls back to defaults, every change is persisted at once, and
// the caps hold. Provenance: fabricated states handed to a fake `getState`/`setState`; whether the
// state really survives hiding the tab in VS Code is UNVERIFIED, with no date: no `test:visual` cell
// hides and shows the tab (phase 5 judged the tab open, not its restoration after hiding).
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createSettingsUi, type PersistedSettingsUi } from './settingsUiState';

function fakeApi(saved: unknown) {
  const setState = vi.fn<(state: PersistedSettingsUi) => void>();
  return { api: { getState: () => saved, setState }, setState };
}

describe('createSettingsUi', () => {
  it('starts on the Providers tab with nothing typed when nothing was saved', () =>
    createRoot((dispose) => {
      const ui = createSettingsUi(fakeApi(undefined).api);
      expect(ui.tab()).toBe('providers');
      expect(ui.search()).toBe('');
      expect(ui.expanded()).toBeUndefined();
      expect(ui.draft('azure')).toEqual({});
      dispose();
    }));

  it('restores a valid saved state and ignores the broken parts', () =>
    createRoot((dispose) => {
      const ui = createSettingsUi(
        fakeApi({
          tab: 'mcp',
          search: 'az',
          expanded: 'azure',
          drafts: { azure: { '0:resourceName': 'r1', bad: 3 }, other: 'nope' },
        }).api,
      );
      expect(ui.tab()).toBe('mcp');
      expect(ui.search()).toBe('az');
      expect(ui.expanded()).toBe('azure');
      expect(ui.draft('azure')).toEqual({ '0:resourceName': 'r1' });
      expect(ui.draft('other')).toEqual({});
      const foreign = createSettingsUi(
        fakeApi({ tab: 'x', search: 7, expanded: '', drafts: [] }).api,
      );
      expect(foreign.tab()).toBe('providers');
      expect(foreign.search()).toBe('');
      expect(foreign.expanded()).toBeUndefined();
      dispose();
    }));

  it('persists every change with the whole state', () =>
    createRoot((dispose) => {
      const { api, setState } = fakeApi(undefined);
      const ui = createSettingsUi(api);
      ui.setTab('mcp');
      ui.setSearch('goo');
      ui.setExpanded('azure');
      ui.setDraft('azure', '0:resourceName', 'r1');
      expect(setState).toHaveBeenLastCalledWith({
        tab: 'mcp',
        search: 'goo',
        expanded: 'azure',
        drafts: { azure: { '0:resourceName': 'r1' } },
      });
      ui.clearDraft('azure');
      ui.setExpanded(undefined);
      expect(setState).toHaveBeenLastCalledWith({ tab: 'mcp', search: 'goo', drafts: {} });
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
