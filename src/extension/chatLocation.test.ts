// Protects the rules of the `openVsCode.chatLocation` setting (issue #77): an invalid value falls
// back to `editor`, the default (E5, decision Q1=1 of 30/10/2026), and a change of location follows Sergio's decision Q4 of 29/10/2026 (leaving
// `editor` does NOT close the tabs; one session is never in two surfaces).
//
// Provenance: fabricated values and states, no VS Code and no server. It proves the planning
// logic, not that the workbench carries the actions out.
import { describe, expect, it } from 'vitest';
import { planLocationSwitch, readChatLocation, type LocationState } from './chatLocation';

const state = (overrides: Partial<LocationState> = {}): LocationState => ({
  sidebarSession: undefined,
  rememberedSession: undefined,
  tabs: [],
  ...overrides,
});

describe('readChatLocation', () => {
  it('accepts the two valid values', () => {
    expect(readChatLocation('sidebar')).toBe('sidebar');
    expect(readChatLocation('editor')).toBe('editor');
  });

  it('falls back to editor for an absent, mistyped or foreign value', () => {
    for (const raw of [undefined, null, 1, true, {}, 'panel', 'Editor', 'Sidebar', '']) {
      expect(readChatLocation(raw)).toBe('editor');
    }
  });
});

describe('planLocationSwitch', () => {
  it('plans nothing when the location does not change', () => {
    expect(planLocationSwitch('sidebar', 'sidebar', state({ sidebarSession: 's1' }))).toEqual([]);
    expect(planLocationSwitch('editor', 'editor', state())).toEqual([]);
  });

  it('opens a tab with the side-bar session when going to editor', () => {
    expect(planLocationSwitch('sidebar', 'editor', state({ sidebarSession: 's1' }))).toEqual([
      { kind: 'detachSidebar' },
      { kind: 'openTab', sessionID: 's1' },
    ]);
  });

  it('opens no tab when the side bar showed no session', () => {
    expect(planLocationSwitch('sidebar', 'editor', state())).toEqual([{ kind: 'detachSidebar' }]);
  });

  it('reveals the tab that already shows the side-bar session instead of duplicating it', () => {
    const tabs = [
      { paneId: 4, sessionID: 'other' },
      { paneId: 7, sessionID: 's1' },
    ];
    expect(planLocationSwitch('sidebar', 'editor', state({ sidebarSession: 's1', tabs }))).toEqual([
      { kind: 'detachSidebar' },
      { kind: 'revealTab', paneId: 7 },
    ]);
  });

  it('never closes tabs when going back to sidebar: it only attaches the side bar', () => {
    const tabs = [
      { paneId: 4, sessionID: 'a' },
      { paneId: 5, sessionID: 'b' },
    ];
    const actions = planLocationSwitch('editor', 'sidebar', state({ tabs }));
    expect(actions).toEqual([{ kind: 'attachSidebar', sessionID: undefined }]);
    expect(actions.some((action) => action.kind === 'revealTab')).toBe(false);
  });

  it('gives the side bar the remembered session when no tab shows it', () => {
    const tabs = [{ paneId: 4, sessionID: 'a' }];
    expect(
      planLocationSwitch('editor', 'sidebar', state({ rememberedSession: 'r', tabs })),
    ).toEqual([{ kind: 'attachSidebar', sessionID: 'r' }]);
  });

  it('starts the side bar lazy when a tab already shows the remembered session', () => {
    const tabs = [{ paneId: 4, sessionID: 'r' }];
    expect(
      planLocationSwitch('editor', 'sidebar', state({ rememberedSession: 'r', tabs })),
    ).toEqual([{ kind: 'attachSidebar', sessionID: undefined }]);
  });

  it('attaches a lazy side bar when nothing is remembered and there are no tabs', () => {
    expect(planLocationSwitch('editor', 'sidebar', state())).toEqual([
      { kind: 'attachSidebar', sessionID: undefined },
    ]);
  });
});
