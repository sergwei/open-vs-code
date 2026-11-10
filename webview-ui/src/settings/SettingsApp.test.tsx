// Protects the OpenCode Settings tab as a whole: what it says before the first state, while the
// server is not connected and when there is nothing to list; the tabs (roving tabindex and the
// keyboard); search; Refresh and the footer; and the live region that announces the host's notices
// in order. Provenance: fabricated states pushed into a real store (settingsFixtures.ts), jsdom; the
// same tab in a real VS Code is judged by `test:visual` steps 35-36; a screen reader is UNVERIFIED.
import { batch } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ProviderRow,
  SettingsHostToWebview,
  SettingsState,
  SettingsWebviewToHost,
} from '../../../src/shared/settingsProtocol';
import { must, mount, type Mounted } from '../testing';
import { anthropic, azure, copilot, makeState, mcpServers, vertex } from './settingsFixtures';
import { SettingsApp } from './SettingsApp';
import { createSettingsStore } from './settingsStore';
import { createSettingsUi, type PersistedSettingsUi } from './settingsUiState';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Disposes the mounted tab now (a test that mounts a second one, or checks what an unmount leaves). */
function unmount(): void {
  mounted?.dispose();
  mounted = undefined;
}

/** What the tests that predate the redesign assume: the tab opens on Providers. */
const PROVIDERS_OPEN: PersistedSettingsUi = { section: 'providers', search: '', drafts: {} };

/**
 * Mounts the tab. `saved` is what `getState` returns: omit it for a tab that opens on Providers (the
 * old tests), or pass `null` for a first visit with nothing saved (opens on General).
 */
function setup(initial?: SettingsState, saved: PersistedSettingsUi | null = PROVIDERS_OPEN) {
  const store = createSettingsStore();
  const sent: SettingsWebviewToHost[] = [];
  const ui = createSettingsUi({ getState: () => saved, setState: () => undefined });
  if (initial !== undefined) store.apply({ type: 'settings.state', state: initial });
  mounted = mount(() => (
    <SettingsApp
      store={store}
      send={(message) => {
        sent.push(message);
      }}
      ui={ui}
    />
  ));
  const apply = (message: SettingsHostToWebview): void => {
    store.apply(message);
  };
  return { container: mounted.container, store, sent, ui, apply };
}

function press(element: Element, key: string): void {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Presses "+ Add provider" (the picker opens and its input takes the focus). */
function openPicker(container: Element): void {
  must<HTMLButtonElement>(container, 'button.add-provider-button').click();
}

/** Opens the picker and picks `id` the way a mouse does (a click on its option). */
function pickProvider(container: Element, id: string): void {
  openPicker(container);
  must<HTMLElement>(container, `[role="option"][data-option="${id}"]`).click();
}

describe('before and without a connection', () => {
  it('says Loading before the first state, with no tabs and no empty-list message', () => {
    const { container } = setup();
    expect(container.textContent).toContain('Loading…');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.textContent).not.toContain('No ');
  });

  it('shows a card, not the tabs, while the server is not connected, and Restart where it helps', () => {
    const { container, sent, apply } = setup(makeState({ connection: { state: 'starting' } }));
    expect(must(container, '.connection-card').getAttribute('data-state')).toBe('starting');
    expect(container.textContent).toContain('Starting the opencode server…');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.textContent).not.toContain('Restart server');
    apply({
      type: 'settings.state',
      state: makeState({
        connection: {
          state: 'unavailable',
          reason: 'start-failed',
          error: { code: 'start-failed', message: 'boom' },
        },
      }),
    });
    expect(container.textContent).toContain('The opencode server is not available.');
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'Restart server')
      ?.click();
    expect(sent).toEqual([{ type: 'settings.action', action: 'restart' }]);
  });

  it('says the providers are loading while connected but not read yet, and when the read failed', () => {
    const { container, apply } = setup(
      makeState({ providers: { loaded: false, failed: false, rows: [] } }),
    );
    expect(container.textContent).toContain('Loading the providers…');
    apply({
      type: 'settings.state',
      state: makeState({ providers: { loaded: false, failed: true, rows: [] } }),
    });
    expect(container.textContent).toContain('Could not read the providers');
  });

  it('says the server lists no other providers when the list is empty', () => {
    const { container } = setup(makeState());
    expect(container.textContent).not.toContain('The server lists no other providers.');
    expect(container.textContent).toContain('+ Add provider');
    openPicker(container);
    expect(container.textContent).toContain('The server lists no other providers.');
  });
});

describe('connected', () => {
  const state = makeState({
    providers: { loaded: true, failed: false, rows: [anthropic, vertex, azure, copilot] },
    mcp: { loaded: true, failed: false, pendingFirstRead: false, servers: mcpServers },
  });

  it('puts connected providers in rows and the rest in the picker, with the version in the header', () => {
    const { container } = setup(state);
    expect(must(container, '.settings-subtitle').textContent).toBe(
      'Settings of the opencode v2.0.32 server for my-project.',
    );
    const ids = Array.from(
      container.querySelectorAll('#settings-panel-providers ul.setup-steps li.provider-row'),
    ).map((li) => li.getAttribute('data-provider'));
    expect(ids).toEqual(['anthropic', 'google-vertex']);
    expect(container.querySelector('#settings-panel-providers [role="listbox"]')).toBeNull();
    openPicker(container);
    const options = Array.from(container.querySelectorAll('[role="option"][data-option]')).map(
      (li) => li.getAttribute('data-option'),
    );
    expect(options).toEqual(['azure', 'github-copilot']);
    expect(must<HTMLInputElement>(container, 'input[type="search"]').placeholder).toBe(
      'Search 2 providers…',
    );
  });

  it('filters the addable providers by name or id before painting them', () => {
    const { container, ui } = setup(state);
    openPicker(container);
    const search = must<HTMLInputElement>(container, 'input[type="search"]');
    search.value = 'COPI';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ui.search()).toBe('COPI');
    expect(container.querySelector('[data-option="azure"]')).toBeNull();
    expect(container.querySelector('[data-option="github-copilot"]')).not.toBeNull();
    search.value = 'zzz';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(container.textContent).toContain('No provider matches “zzz”.');
  });

  it('keeps the open card and what is typed in it when the host sends a new state', () => {
    const { container, apply } = setup(state);
    pickProvider(container, 'azure');
    const input = must<HTMLInputElement>(container, '[data-provider="azure"] input');
    input.value = 'typing';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    apply({ type: 'settings.state', state: structuredClone(state) });
    expect(must<HTMLInputElement>(container, '[data-provider="azure"] input')).toBe(input);
    expect(input.value).toBe('typing');
  });

  it('moves the provider that is signing in to the first list and disables the other connects', () => {
    const { container, apply } = setup(state);
    apply({
      type: 'settings.state',
      state: {
        ...structuredClone(state),
        attempt: {
          integrationID: 'github-copilot',
          phase: 'waiting',
          instructions: 'Enter code: AB-12',
          code: 'AB-12',
        },
      },
    });
    const first = container.querySelector('#settings-panel-providers ul.setup-steps');
    expect(
      first?.querySelector('[data-provider="github-copilot"] .settings-attempt'),
    ).not.toBeNull();
    pickProvider(container, 'azure');
    expect(
      must(container, '[data-provider="azure"] button.primary').getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('has no password input anywhere in the whole tree, with a form open', () => {
    const { container } = setup(state, {
      section: 'providers',
      search: '',
      expanded: 'github-copilot',
      drafts: {},
    });
    expect(container.querySelector('select')).not.toBeNull();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });

  it('sends Refresh and the footer actions', () => {
    const { container, sent } = setup(state);
    const click = (label: string) =>
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === label)
        ?.click();
    click('Refresh');
    click('Show logs');
    click('Extension settings');
    expect(sent).toEqual([
      { type: 'settings.refresh' },
      { type: 'settings.action', action: 'logs' },
      { type: 'settings.action', action: 'extensionSettings' },
    ]);
  });
});

/**
 * Protects the frame of the redesign (issue #186): the header cards, the seven-section navigation
 * (roving tabindex, both arrow axes, the numbers), the jumps that carry the focus, the search that
 * opens things, "Needs attention", and when the Default model card may say "Ignored" (not while the
 * models load, not when reading them failed). Provenance: fabricated states (`settingsFixtures.ts`; `broken`
 * and `linear` are the servers the fake opencode lists) in jsdom; the layout at each width and theme
 * is `test:visual` step 46, and jsdom has no layout, so `ResizeObserver` is a stub here.
 * Each test gets its own copy of the state (a store reconciles into the objects it is given), and a
 * test that mounts a second tab unmounts the first: two tabs in one document share ids, and
 * `#id .class` queries then resolve against the first one, which made two tests fail until then
 * (Windows 11, vitest, 07/11/2026).
 */
describe('header and navigation', () => {
  // A fresh copy per test: a store keeps (and reconciles into) the objects it is given, so a state
  // shared between tests was seen with its provider rows already changed by an earlier test.
  let state: SettingsState;
  beforeEach(() => {
    state = structuredClone(
      makeState({
        providers: { loaded: true, failed: false, rows: [anthropic, vertex, azure] },
        mcp: { loaded: true, failed: false, pendingFirstRead: false, servers: mcpServers },
      }),
    );
  });
  const SECTIONS = [
    'General',
    'Providers',
    'Models',
    'MCP servers',
    'Mods',
    'Work mode',
    'Advanced',
  ];
  const tabsOf = (container: Element) =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
  const cardOf = (container: Element, id: string) =>
    must<HTMLButtonElement>(container, `[data-card="${id}"] .status-card-main`);
  const typeInSearch = (container: Element, text: string): HTMLInputElement => {
    const input = must<HTMLInputElement>(container, 'input[role="combobox"]');
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input;
  };

  it('opens on General the first time, with the four header cards and the seven sections', () => {
    const { container, ui } = setup(state, null);
    expect(ui.section()).toBe('general');
    expect(
      tabsOf(container).map((t) => t.querySelector('.settings-tab-label')?.textContent),
    ).toEqual(SECTIONS);
    expect(tabsOf(container).map((t) => t.getAttribute('aria-selected'))).toEqual([
      'true',
      ...Array<string>(6).fill('false'),
    ]);
    expect(tabsOf(container).map((t) => t.getAttribute('tabindex'))).toEqual([
      '0',
      ...Array<string>(6).fill('-1'),
    ]);
    expect(must(container, '#settings-panel-general').hasAttribute('hidden')).toBe(false);
    for (const section of ['providers', 'models', 'mcp', 'mods', 'workMode', 'advanced']) {
      expect(must(container, `#settings-panel-${section}`).hasAttribute('hidden')).toBe(true);
    }
    expect(must(container, '#settings-panel-mcp').getAttribute('aria-labelledby')).toBe(
      'settings-tab-mcp',
    );
    const cards = Array.from(container.querySelectorAll('.status-card')).map((card) => [
      card.querySelector('.status-card-label')?.textContent,
      card.querySelector('.status-card-value')?.textContent,
    ]);
    expect(cards).toEqual([
      ['Server', 'Connected · v2.0.32'],
      ['Providers', '2 providers connected'],
      ['Default model', 'Chosen by opencode'],
      ['MCP servers', '1 of 4 active'],
    ]);
  });

  it('a card opens its section and carries aria-current, with no nested buttons', () => {
    const { container, ui } = setup(state, null);
    expect(cardOf(container, 'server').getAttribute('aria-current')).toBe('true');
    cardOf(container, 'providers').click();
    expect(ui.section()).toBe('providers');
    expect(cardOf(container, 'providers').getAttribute('aria-current')).toBe('true');
    expect(cardOf(container, 'server').hasAttribute('aria-current')).toBe(false);
    cardOf(container, 'model').click();
    expect(ui.section()).toBe('models');
    cardOf(container, 'mcp').click();
    expect(ui.section()).toBe('mcp');
    expect(container.querySelectorAll('button button')).toHaveLength(0);
    // The Server card's secondary buttons are siblings of its title button.
    const actions = container.querySelectorAll('[data-card="server"] .status-card-actions button');
    expect(Array.from(actions).map((b) => b.textContent)).toEqual(['Restart server', 'Show logs']);
  });

  it('turns the MCP card amber and says it in words when servers need attention', () => {
    const { container } = setup(state, null);
    const card = must(container, '[data-card="mcp"]');
    expect(card.getAttribute('data-tone')).toBe('warning');
    expect(must(card, '.status-card-note').textContent).toBe('2 need attention');
    // Unmount first: two tabs in one document share ids, and `#id .class` selectors then resolve
    // against the first one (nwsapi looks the id up in the whole document).
    unmount();
    const healthy = setup(makeState(), null);
    expect(
      healthy.container.querySelector('[data-card="mcp"]')?.getAttribute('data-tone'),
    ).toBeNull();
  });

  it('puts a number in the navigation: connected providers, and MCP servers needing attention', () => {
    const { container } = setup(state, null);
    const badge = (section: string) =>
      container.querySelector(`#settings-tab-${section} .settings-badge`);
    expect(badge('providers')?.textContent).toBe('2');
    expect(badge('providers')?.getAttribute('data-tone')).toBe('neutral');
    expect(badge('mcp')?.textContent).toBe('2');
    expect(badge('mcp')?.getAttribute('data-tone')).toBe('warning');
    expect(must(container, '#settings-tab-mcp .visually-hidden').textContent).toBe(
      '2 need attention',
    );
    expect(badge('general')).toBeNull();
    expect(badge('mods')).toBeNull();
  });

  it('moves and activates with the arrows of both axes, wrapping, Home and End, taking the focus', () => {
    const { container, ui } = setup(state, null);
    const list = must(container, '[role="tablist"]');
    const tabs = tabsOf(container);
    tabs[0]?.focus();
    press(tabs[0] as HTMLElement, 'ArrowDown');
    expect(ui.section()).toBe('providers');
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]?.getAttribute('tabindex')).toBe('0');
    expect(tabs[0]?.getAttribute('tabindex')).toBe('-1');
    expect(must(container, '#settings-panel-providers').hasAttribute('hidden')).toBe(false);
    press(list, 'ArrowRight');
    expect(ui.section()).toBe('models');
    press(list, 'ArrowUp');
    expect(ui.section()).toBe('providers');
    press(list, 'ArrowLeft');
    expect(ui.section()).toBe('general');
    press(list, 'ArrowLeft');
    expect(ui.section()).toBe('advanced');
    press(list, 'ArrowDown');
    expect(ui.section()).toBe('general');
    press(list, 'End');
    expect(ui.section()).toBe('advanced');
    press(list, 'Home');
    expect(ui.section()).toBe('general');
    press(list, 'a');
    expect(ui.section()).toBe('general');
  });

  it('says vertical or horizontal by the width of the tab', () => {
    let notify: ((entries: { contentRect: { width: number } }[]) => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
          notify = callback;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    try {
      const { container } = setup(state, null);
      const list = must(container, '[role="tablist"]');
      expect(list.getAttribute('aria-orientation')).toBe('vertical');
      notify?.([{ contentRect: { width: 599 } }]);
      expect(list.getAttribute('aria-orientation')).toBe('horizontal');
      notify?.([{ contentRect: { width: 600 } }]);
      expect(list.getAttribute('aria-orientation')).toBe('vertical');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('selects with a click and restores a saved section, and one saved as the old tab', () => {
    const first = setup(state, null);
    tabsOf(first.container)[3]?.click();
    expect(first.ui.section()).toBe('mcp');
    mounted?.dispose();
    const restored = setup(state, { section: 'mcp', search: '', drafts: {} });
    expect(must(restored.container, '#settings-tab-mcp').getAttribute('aria-selected')).toBe(
      'true',
    );
    mounted?.dispose();
    const old = setup(state, {
      tab: 'mcp',
      search: '',
      drafts: {},
    } as unknown as PersistedSettingsUi);
    expect(must(old.container, '#settings-tab-mcp').getAttribute('aria-selected')).toBe('true');
  });

  it('shows no search, cards or navigation until the server is connected', () => {
    const { container } = setup(makeState({ connection: { state: 'starting' } }), null);
    expect(container.querySelector('.status-cards')).toBeNull();
    expect(container.querySelector('input[role="combobox"]')).toBeNull();
    expect(container.querySelector('.settings-nav')).toBeNull();
  });

  it('lists what needs attention in General only when something does, and jumps to the row with the focus', () => {
    const { container, ui } = setup(state, null);
    const items = Array.from(container.querySelectorAll<HTMLElement>('.attention-item'));
    expect(items.map((item) => item.textContent)).toEqual([
      'The MCP server broken failed',
      'The MCP server linear needs you to sign in',
    ]);
    items[0]?.click();
    expect(ui.section()).toBe('mcp');
    expect(document.activeElement).toBe(must(container, '[data-server="broken"]'));
    ui.setSection('general');
    Array.from(container.querySelectorAll<HTMLElement>('.attention-item'))[1]?.click();
    expect(document.activeElement).toBe(must(container, '[data-server="linear"]'));
    unmount();
    const clean = setup(makeState(), null);
    expect(clean.container.querySelector('.attention-card')).toBeNull();
  });

  it('jumps from an attention item to its row and takes the focus there', () => {
    const { container, ui } = setup(
      makeState({
        providers: {
          loaded: true,
          failed: false,
          rows: [
            {
              ...anthropic,
              connections: [
                {
                  kind: 'credential',
                  id: 'cred_1',
                  label: 'A',
                  method: 'key',
                  needsAuth: 'sign in',
                },
              ],
            },
          ],
        },
      }),
      null,
    );
    must(container, '.attention-item[data-kind="providerNeedsAuth"]').click();
    expect(ui.section()).toBe('providers');
    expect(document.activeElement).toBe(must(container, '[data-provider="anthropic"]'));
  });

  it('focuses the section heading when the item has no row (the ignored default model)', () => {
    const { container, ui } = setup(
      makeState({
        models: { loaded: true, failed: false, rows: [] },
        preference: { value: 'a/gone', status: 'unavailable', workspaceOverride: false },
      }),
      null,
    );
    must(container, '.attention-item[data-kind="modelIgnored"]').click();
    expect(ui.section()).toBe('models');
    expect(document.activeElement).toBe(
      must(container, '#settings-panel-models .settings-section-title'),
    );
  });

  it('opens a section, a setting or an action from the search, and leaves nothing sent for a jump', () => {
    const { container, ui, sent } = setup(state, null);
    const input = typeInSearch(container, 'linear');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    press(input, 'Enter');
    expect(ui.section()).toBe('mcp');
    expect(document.activeElement).toBe(must(container, '[data-server="linear"]'));
    expect(sent).toEqual([]);
    press(typeInSearch(container, 'chat location'), 'Enter');
    expect(sent).toEqual([{ type: 'settings.openSetting', key: 'chatLocation' }]);
    press(typeInSearch(container, 'restart'), 'Enter');
    expect(sent.at(-1)).toEqual({ type: 'settings.action', action: 'restart' });
    expect(ui.section()).toBe('mcp');
  });

  // Protects review W2 of the reconciliation: a search result for a provider that is not connected
  // used to end on the section title, because its card exists only once expanded. Fabricated state.
  it('focuses the card of a provider that is not connected when the search jumps to it', () => {
    const { container, ui } = setup(
      makeState({ providers: { loaded: true, failed: false, rows: [anthropic, azure] } }),
      null,
    );
    press(typeInSearch(container, 'azure'), 'Enter');
    expect(ui.section()).toBe('providers');
    expect(ui.expanded()).toBe('azure');
    expect(document.activeElement).toBe(must(container, '[data-provider="azure"]'));
  });

  // Protects review W1 of the reconciliation: the Default model card said "Ignored" for a valid
  // value while the models were still loading (the host judges against rows it has not read yet).
  it('does not call the default model ignored while the models load', () => {
    const base = makeState();
    const loading = makeState({
      models: { ...base.models, loaded: false },
      preference: {
        value: 'anthropic/claude-haiku',
        status: 'unavailable',
        workspaceOverride: false,
      },
    });
    const { container } = setup(loading, null);
    const card = must(container, '[data-card="model"]');
    expect(card.textContent).toContain('anthropic/claude-haiku');
    expect(card.textContent).not.toContain('Ignored');
  });

  // Protects review W1 of the closing delta: the other half of the same rule. A re-read of the
  // models that failed (`loaded` and `failed` both true, previous rows kept) must not turn a valid
  // value into "Ignored" either. Fabricated state. Mutation: dropping `!state.models.failed` in
  // `cardsOf` (StatusCards.tsx) turns this red.
  it('does not call the default model ignored when reading the models failed', () => {
    const base = makeState();
    const failed = makeState({
      models: { ...base.models, loaded: true, failed: true },
      preference: {
        value: 'anthropic/claude-haiku',
        status: 'unavailable',
        workspaceOverride: false,
      },
    });
    const { container } = setup(failed, null);
    const card = must(container, '[data-card="model"]');
    expect(card.textContent).toContain('anthropic/claude-haiku');
    expect(card.textContent).not.toContain('Ignored');
  });

  it('shows Server facts in General and sends Restart server and Show logs from there', () => {
    const { container, sent } = setup(state, null);
    const general = must(container, '#settings-panel-general');
    expect(Array.from(general.querySelectorAll('.fact')).map((fact) => fact.textContent)).toEqual([
      'StatusConnected',
      'Versionv2.0.32',
      'Foldermy-project',
    ]);
    const buttons = Array.from(general.querySelectorAll<HTMLElement>('.card-actions button'));
    buttons.forEach((button) => {
      button.click();
    });
    expect(sent).toEqual([
      { type: 'settings.action', action: 'restart' },
      { type: 'settings.action', action: 'logs' },
    ]);
  });
});

describe('announcements', () => {
  it('announces notices of the same batch in order and again when the text repeats', () => {
    const { container, apply } = setup(
      makeState({ providers: { loaded: true, failed: false, rows: [azure] } }),
    );
    const region = must(container, '[role="status"].visually-hidden');
    batch(() => {
      apply({ type: 'settings.notice', notice: { integrationID: 'azure', kind: 'connected' } });
      apply({ type: 'settings.notice', notice: { integrationID: 'other', kind: 'expired' } });
    });
    expect(region.textContent).toBe('Connected to Azure. Sign-in to other expired.');
    const before = region.textContent;
    apply({ type: 'settings.notice', notice: { integrationID: 'azure', kind: 'connected' } });
    expect(region.textContent).not.toBe(before);
    expect(region.textContent.trim()).toBe('Connected to Azure.');
    apply({ type: 'settings.notice', notice: { integrationID: 'azure', kind: 'connected' } });
    expect(region.textContent).toContain('Connected to Azure.');
  });

  /**
   * Protects M3 of issue #186 (PR2): the live region names an MCP server by its name. The notices
   * of Connect/Disconnect/Retry carry `server`; the ones of an MCP sign-in carry the `mcp_...` id of
   * its integration, which must never be read out. Fabricated notices and the `linear` fixture row.
   */
  it('names an MCP server by its name, never by the mcp_ id of its integration', () => {
    const { container, apply } = setup(
      makeState({ mcp: { ...makeState().mcp, servers: mcpServers } }),
    );
    const region = must(container, '[role="status"].visually-hidden');
    batch(() => {
      apply({
        type: 'settings.notice',
        notice: { integrationID: '', kind: 'mcpConnected', server: 'off' },
      });
      apply({
        type: 'settings.notice',
        notice: { integrationID: '', kind: 'mcpDisconnected', server: 'docs' },
      });
      apply({
        type: 'settings.notice',
        notice: { integrationID: '', kind: 'mcpFailed', server: 'broken', message: 'Boom' },
      });
      apply({
        type: 'settings.notice',
        notice: { integrationID: 'mcp_0123456789abcdef', kind: 'connected' },
      });
      apply({
        type: 'settings.notice',
        notice: { integrationID: 'mcp_0123456789abcdef', kind: 'cancelled' },
      });
    });
    expect(region.textContent).toBe(
      'Connected to off. Disconnected from docs. broken could not be changed. Boom Connected to linear. Sign-in to linear was cancelled.',
    );
    expect(region.textContent).not.toContain('mcp_');
  });

  it('clears the busy mark of an MCP row when a notice names its server, even with the same state', () => {
    const { container, apply, sent } = setup(
      makeState({ mcp: { ...makeState().mcp, servers: mcpServers } }),
      { section: 'mcp', search: '', drafts: {} },
    );
    const button = must<HTMLButtonElement>(
      container,
      '[data-server="off"] button.settings-mcp-action',
    );
    button.click();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(sent).toEqual([{ type: 'settings.mcp', server: 'off', op: 'connect' }]);
    apply({
      type: 'settings.notice',
      notice: { integrationID: '', kind: 'mcpFailed', server: 'off', message: 'Not possible' },
    });
    expect(button.getAttribute('aria-disabled')).toBeNull();
  });

  it('clears the busy mark of the Sign in button when the notice carries only the integration id', () => {
    const { container, apply } = setup(
      makeState({ mcp: { ...makeState().mcp, servers: mcpServers } }),
      { section: 'mcp', search: '', drafts: {} },
    );
    const button = must<HTMLButtonElement>(
      container,
      '[data-server="linear"] button.settings-mcp-action',
    );
    button.click();
    expect(button.getAttribute('aria-busy')).toBe('true');
    apply({
      type: 'settings.notice',
      notice: { integrationID: 'mcp_0123456789abcdef', kind: 'cancelled' },
    });
    expect(button.getAttribute('aria-busy')).toBeNull();
  });
});

describe('focus when a row changes list', () => {
  const acme: ProviderRow = {
    id: 'acme',
    name: 'Acme',
    connections: [],
    methods: [{ index: 0, type: 'key', label: 'API key', fields: [], supported: true }],
  };
  const withAttempt = (attempt: boolean) =>
    makeState({
      providers: { loaded: true, failed: false, rows: [anthropic, acme] },
      ...(attempt ? { attempt: { integrationID: 'acme', phase: 'starting' as const } } : {}),
    });
  const cardOf = (container: HTMLElement): HTMLElement | null =>
    container.querySelector<HTMLElement>('li[data-provider="acme"]');

  /**
   * Protects W2 of the review (#1689): the primary button that has the focus is destroyed when its
   * row moves to "Connected" for the sign-in (and back when the attempt is cancelled), and the
   * focus fell to `body`. Fabricated states in a real store, jsdom `document.activeElement`.
   */
  it('keeps the focus on the card while the row goes up for the sign-in and back after Cancel', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { container, apply, sent } = setup(withAttempt(false));
    pickProvider(container, 'acme');
    must(container, 'li[data-provider="acme"] button.primary').click();
    expect(sent.map((m) => m.type)).toEqual(['settings.connect']);
    apply({ type: 'settings.state', state: withAttempt(true) });
    const up = cardOf(container);
    expect(up?.closest('ul')).toBe(container.querySelector('ul.setup-steps'));
    expect(document.activeElement).toBe(up);
    apply({ type: 'settings.state', state: withAttempt(false) });
    await Promise.resolve();
    const back = cardOf(container);
    expect(back).not.toBeNull();
    expect(document.activeElement).toBe(back);
    expect(document.activeElement).not.toBe(document.body);
  });

  /**
   * Protects review W3 of E10-settings-redesign: once the host confirms a Disconnect, the row and
   * the button that held the focus are gone and the focus fell to `body`. It must land on "+ Add
   * provider"; and while the confirmation has not happened (no state change) nothing moves.
   * Fabricated states in a real store, jsdom `document.activeElement`; a real confirmation dialog
   * of VS Code is not exercised here.
   */
  it('moves the focus to + Add provider after a confirmed Disconnect, never to the body', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { container, apply, sent } = setup(withAttempt(false));
    const button = must<HTMLButtonElement>(container, 'li[data-provider="anthropic"] button');
    button.focus();
    button.click();
    expect(sent.map((m) => m.type)).toEqual(['settings.disconnect']);
    expect(document.activeElement).toBe(button);
    apply({
      type: 'settings.state',
      state: makeState({ providers: { loaded: true, failed: false, rows: [acme] } }),
    });
    const addButton = must<HTMLButtonElement>(container, 'button.add-provider-button');
    expect(document.activeElement).toBe(addButton);
    expect(document.activeElement).not.toBe(document.body);
  });

  /**
   * Protects review W1 of the closing round: the user leaves for the editor while the Disconnect
   * confirmation is pending, so when the row goes the focus must NOT be pulled back into this
   * webview. `hasFocus` is stubbed (jsdom has no window focus); fabricated states.
   */
  it('does not move the focus after Disconnect when the document has no focus', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container, apply } = setup(withAttempt(false));
    const button = must<HTMLButtonElement>(container, 'li[data-provider="anthropic"] button');
    button.focus();
    button.click();
    apply({
      type: 'settings.state',
      state: makeState({ providers: { loaded: true, failed: false, rows: [acme] } }),
    });
    expect(document.activeElement).not.toBe(
      must<HTMLButtonElement>(container, 'button.add-provider-button'),
    );
  });

  /**
   * Protects the focus of the native InputBox: a key sign-in shows it while the row moves up, and a
   * card that took the focus anyway left the box open but unable to take the key (`test:visual`
   * step 36, V7: "focused false" right after the box appeared, 1/11/2026). With `hasFocus` false
   * (the box has it) the rebuilt card leaves the focus alone. `hasFocus` is stubbed because jsdom
   * has no real window focus: this proves the guard, not what VS Code does with the focus.
   */
  it('leaves the focus alone while another part of the window has it (the native key box)', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container, apply } = setup(withAttempt(false));
    pickProvider(container, 'acme');
    must(container, 'li[data-provider="acme"] button.primary').click();
    apply({ type: 'settings.state', state: withAttempt(true) });
    expect(document.activeElement).not.toBe(cardOf(container));
  });

  // Protects H1 of E10-settings-followup (#143): after Enter (the row stays in Connected, the card
  // is not rebuilt) and after Escape (the row goes back, the card is rebuilt) the card ends focused
  // in BOTH orders of the two events: the host's state without the attempt, and the focus coming
  // back from the native box. Provenance: FABRICATED states, `hasFocus` stubbed and a synthetic
  // `focus` event on `window`: jsdom proves the logic, not that VS Code delivers that event.
  const connected: ProviderRow = {
    ...acme,
    connections: [{ kind: 'credential', id: 'cred_9', label: 'Acme', method: 'key' }],
  };
  // Rows are cloned per state: the store merges into the objects it is given (`reconcile` with
  // `merge`), so a shared fixture would carry one test's connection into the next.
  const stateWith = (kind: 'attempt' | 'connected' | 'idle') =>
    makeState({
      providers: {
        loaded: true,
        failed: false,
        rows: structuredClone([anthropic, kind === 'connected' ? connected : acme]),
      },
      ...(kind === 'attempt'
        ? { attempt: { integrationID: 'acme', phase: 'starting' as const } }
        : {}),
    });
  const windowFocus = (): void => {
    window.dispatchEvent(new FocusEvent('focus'));
  };
  const pressConnect = (container: HTMLElement): void => {
    pickProvider(container, 'acme');
    must(container, 'li[data-provider="acme"] button.primary').click();
  };

  for (const outcome of ['connected', 'idle'] as const) {
    const how = outcome === 'connected' ? 'Enter' : 'Escape';

    it(`${how}, state first: the card is focused when the focus comes back from the box`, () => {
      const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      const { container, apply } = setup(stateWith('idle'));
      pressConnect(container);
      apply({ type: 'settings.state', state: stateWith('attempt') });
      apply({ type: 'settings.state', state: stateWith(outcome) });
      expect(document.activeElement).not.toBe(cardOf(container));
      hasFocus.mockReturnValue(true);
      windowFocus();
      expect(document.activeElement).toBe(cardOf(container));
      expect(document.activeElement).not.toBe(document.body);
    });

    it(`${how}, focus first: the card is focused when the state without the attempt arrives`, () => {
      const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      const { container, apply } = setup(stateWith('idle'));
      pressConnect(container);
      apply({ type: 'settings.state', state: stateWith('attempt') });
      hasFocus.mockReturnValue(true);
      (document.activeElement as HTMLElement | null)?.blur();
      windowFocus();
      apply({ type: 'settings.state', state: stateWith(outcome) });
      expect(document.activeElement).toBe(cardOf(container));
    });
  }

  it('Enter after the card took the focus and then lost it to the box: the end of the attempt parks the request', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { container, apply } = setup(stateWith('idle'));
    pressConnect(container);
    apply({ type: 'settings.state', state: stateWith('attempt') });
    expect(document.activeElement).toBe(cardOf(container));
    // The native box opens and takes the focus; Enter closes it and the state arrives first.
    hasFocus.mockReturnValue(false);
    (document.activeElement as HTMLElement).blur();
    apply({ type: 'settings.state', state: stateWith('connected') });
    expect(document.activeElement).toBe(document.body);
    hasFocus.mockReturnValue(true);
    windowFocus();
    expect(document.activeElement).toBe(cardOf(container));
  });

  // Protects F2 of `test:visual` step 36 (full run of 02/11/2026: Escape ended with hasFocus true
  // and the `body` active): the `focus` event of `window` can arrive while `document.hasFocus()` is
  // still false and no second event follows, so that event must not use the parked request up.
  // Provenance: FABRICATED order (HYPOTHESIS that VS Code produces it), `hasFocus` stubbed.
  for (const outcome of ['connected', 'idle'] as const) {
    it(`${outcome === 'connected' ? 'Enter' : 'Escape'}: a focus event before the document has the focus does not consume the request`, async () => {
      const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      const { container, apply } = setup(stateWith('idle'));
      pressConnect(container);
      apply({ type: 'settings.state', state: stateWith('attempt') });
      apply({ type: 'settings.state', state: stateWith(outcome) });
      windowFocus(); // hasFocus is still false here
      expect(document.activeElement).not.toBe(cardOf(container));
      hasFocus.mockReturnValue(true); // and no other focus event comes
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(document.activeElement).toBe(cardOf(container));
    });
  }

  // Protects the `active === null || active === document.body` guard of `onWindowFocus` against a
  // focus chosen OUTSIDE `.settings-providers` (the "MCP servers" tab): the section's own `focusin`
  // handler never sees it, so the parked request is still armed when the window focus arrives.
  // Provenance: FABRICATED states, `hasFocus` stubbed, synthetic `focus` event on `window`.
  it('does not move a focus the user put outside the providers section while the request was parked', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container, apply } = setup(stateWith('idle'));
    pressConnect(container);
    apply({ type: 'settings.state', state: stateWith('attempt') });
    apply({ type: 'settings.state', state: stateWith('connected') });
    const mcpTab = must(container, '#settings-tab-mcp');
    mcpTab.focus();
    expect(document.activeElement).toBe(mcpTab);
    hasFocus.mockReturnValue(true);
    windowFocus();
    expect(document.activeElement).toBe(mcpTab);
    expect(document.activeElement).not.toBe(cardOf(container));
  });

  it('does not move a focus the user chose in the meantime, nor act while the box has the focus', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container, apply } = setup(stateWith('idle'));
    pressConnect(container);
    apply({ type: 'settings.state', state: stateWith('attempt') });
    apply({ type: 'settings.state', state: stateWith('connected') });
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    windowFocus(); // document.hasFocus() is still false: the native box keeps it.
    expect(focus).not.toHaveBeenCalled();
    const elsewhere = must<HTMLElement>(container, 'button.add-provider-button');
    elsewhere.focus();
    hasFocus.mockReturnValue(true);
    windowFocus();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('serves the request once: a second focus event does nothing, and none after unmount', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container, apply } = setup(stateWith('idle'));
    pressConnect(container);
    apply({ type: 'settings.state', state: stateWith('attempt') });
    apply({ type: 'settings.state', state: stateWith('connected') });
    hasFocus.mockReturnValue(true);
    windowFocus();
    const card = cardOf(container);
    expect(document.activeElement).toBe(card);
    (document.activeElement as HTMLElement).blur();
    windowFocus();
    expect(document.activeElement).toBe(document.body);

    // Armed again, then unmounted: the listener is gone with the section.
    hasFocus.mockReturnValue(false);
    unmount();
    const second = setup(stateWith('idle'));
    pressConnect(second.container);
    second.apply({ type: 'settings.state', state: stateWith('attempt') });
    second.apply({ type: 'settings.state', state: stateWith('connected') });
    unmount();
    hasFocus.mockReturnValue(true);
    windowFocus();
    expect(document.activeElement).toBe(document.body);
  });

  // Protects the focus trace of issue #151 (the diagnostic `test:visual` step 36 prints for F1/F2)
  // and the poll that starts at every arm. Provenance: FABRICATED states and orders, `hasFocus`
  // stubbed, synthetic `focus` events; jsdom proves the annotations and the poll, not what VS Code
  // delivers. The trace is read from the same attribute the harness reads.
  interface TraceEntry {
    n: number;
    e: string;
    hf?: boolean;
    armed?: string | null;
    why?: string;
  }
  const readTrace = (container: HTMLElement): TraceEntry[] =>
    JSON.parse(
      must(container, '.settings-providers').getAttribute('data-focus-trace') ?? '[]',
    ) as TraceEntry[];
  const labels = (entries: TraceEntry[]): string[] =>
    entries.map((entry) => (entry.why === undefined ? entry.e : `${entry.e}:${entry.why}`));
  /** True when `wanted` appears in `all` in that order (other entries may sit between them). */
  const inOrder = (all: string[], wanted: string[]): boolean => {
    let at = 0;
    for (const label of all) if (label === wanted[at]) at++;
    return at === wanted.length;
  };

  it('traces Escape with the state first: arm, attempt end, window focus, served, disarmed', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container, apply } = setup(stateWith('idle'));
    pressConnect(container);
    apply({ type: 'settings.state', state: stateWith('attempt') });
    apply({ type: 'settings.state', state: stateWith('idle') });
    hasFocus.mockReturnValue(true);
    windowFocus();
    const entries = readTrace(container);
    expect(
      inOrder(labels(entries), [
        'arm:take-focus',
        'attempt-end',
        'arm:attempt-end',
        'window-focus',
        'serve:served',
        'disarm:served',
      ]),
    ).toBe(true);
    const focusEntry = entries.find((entry) => entry.e === 'window-focus');
    expect(focusEntry?.hf).toBe(true);
    expect(focusEntry?.armed).toBe('acme');
    expect(document.activeElement).toBe(cardOf(container));
  });

  it('traces a focus event before hasFocus: no-doc-focus, a new poll window, then served by the poll', () => {
    vi.useFakeTimers();
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container, apply } = setup(stateWith('idle'));
    pressConnect(container);
    apply({ type: 'settings.state', state: stateWith('attempt') });
    apply({ type: 'settings.state', state: stateWith('connected') });
    windowFocus();
    const early = readTrace(container);
    const focusEntry = early.find((entry) => entry.e === 'window-focus');
    expect(focusEntry?.hf).toBe(false);
    expect(focusEntry?.armed).toBe('acme');
    hasFocus.mockReturnValue(true);
    vi.advanceTimersByTime(250); // two poll ticks of 100 ms, on a fake clock
    expect(
      inOrder(labels(readTrace(container)), [
        'window-focus',
        'serve:no-doc-focus',
        'poll-start',
        'serve:served',
        'poll-stop:served',
      ]),
    ).toBe(true);
    expect(document.activeElement).toBe(cardOf(container));
  });

  for (const outcome of ['connected', 'idle'] as const) {
    it(`${outcome === 'connected' ? 'Enter' : 'Escape'}: with no focus event at all the poll focuses the card once hasFocus is true`, () => {
      vi.useFakeTimers();
      const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      const { container, apply } = setup(stateWith('idle'));
      pressConnect(container);
      apply({ type: 'settings.state', state: stateWith('attempt') });
      apply({ type: 'settings.state', state: stateWith(outcome) });
      expect(document.activeElement).not.toBe(cardOf(container));
      hasFocus.mockReturnValue(true); // and no focus event comes (HYPOTHESIS S2)
      vi.advanceTimersByTime(250);
      expect(document.activeElement).toBe(cardOf(container));
      const seen = labels(readTrace(container));
      expect(seen).toContain('serve:served');
      expect(seen).not.toContain('window-focus');
    });
  }

  it('the poll does not focus the card while hasFocus is false', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container, apply } = setup(stateWith('idle'));
    pressConnect(container);
    apply({ type: 'settings.state', state: stateWith('attempt') });
    apply({ type: 'settings.state', state: stateWith('connected') });
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    vi.advanceTimersByTime(250);
    expect(focus).not.toHaveBeenCalled();
    expect(readTrace(container).at(-1)?.armed).toBe('acme');
  });

  // Protects the S1 case of #151 (a `focus` event arrives with `hasFocus` still false, and the
  // document only gets the focus more than 1 s later): the poll window must outlast 2 s. The
  // `window-focus` entry with hf=false is what the key of `test/visual/run.mjs` reads as S1; without
  // it the trace would read as S2 with a long gap (#163, W2). With POLL_TICKS 10 (1 s at POLL_MS
  // 100) the poll stops at 1 s and the card is never focused (mutation run, 03/11/2026: this test
  // went red, the other 35 of the file stayed green; reverted).
  // FABRICATED states, `hasFocus` stubbed, synthetic `focus` event, fake clock.
  it('S1: after a focus event with hasFocus false, the poll still focuses the card when hasFocus turns true 2 s later', () => {
    vi.useFakeTimers();
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container, apply } = setup(stateWith('idle'));
    pressConnect(container);
    apply({ type: 'settings.state', state: stateWith('attempt') });
    apply({ type: 'settings.state', state: stateWith('connected') });
    windowFocus();
    expect(readTrace(container).find((entry) => entry.e === 'window-focus')?.hf).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(document.activeElement).not.toBe(cardOf(container));
    hasFocus.mockReturnValue(true);
    vi.advanceTimersByTime(200);
    expect(document.activeElement).toBe(cardOf(container));
  });

  // Protects the S3 case of #151: when the attempt ends with the document focused but the card of
  // that provider is not in the DOM yet (`why=no-card`), the request stays parked (armed, not
  // disarmed) instead of being consumed. The card that appears later focuses itself through its
  // `takeFocus` (`disarm:direct`) because `focusID` is kept, so the final focus alone would not tell
  // a parked request from a consumed one: that is why the trace is checked right after `no-card`
  // (#163, W1). Mutation run, 03/11/2026: making `no-card` consume the request with `disarm` alone
  // (keeping `focusID`) still left the card focused; this test now goes red at the check right
  // after `no-card` (`['disarm:no-card']`), where before it only went red at the last line,
  // because a disarmed request writes no `disarm:direct`; reverted.
  // FABRICATED states (the row is absent at the end of the attempt), `hasFocus` stubbed.
  it('S3: at the end of the attempt without the card the request stays parked until the card appears', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { container, apply } = setup(stateWith('idle'));
    pressConnect(container);
    apply({ type: 'settings.state', state: stateWith('attempt') });
    apply({
      type: 'settings.state',
      state: makeState({
        providers: { loaded: true, failed: false, rows: structuredClone([anthropic]) },
      }),
    });
    const atNoCard = readTrace(container);
    const seenAtNoCard = labels(atNoCard);
    expect(seenAtNoCard).toContain('serve:no-card');
    const afterNoCard = seenAtNoCard.slice(seenAtNoCard.lastIndexOf('serve:no-card') + 1);
    expect(afterNoCard.filter((label) => label.startsWith('disarm'))).toEqual([]);
    expect(atNoCard.at(-1)?.armed).toBe('acme');
    expect(document.activeElement).toBe(document.body);
    apply({ type: 'settings.state', state: stateWith('idle') });
    vi.advanceTimersByTime(250);
    expect(document.activeElement).toBe(cardOf(container));
    // The card that appears takes the focus itself (`takeFocus`). `disarm:direct` is only written
    // while the request is still armed (`disarm` notes nothing otherwise), so it proves the request
    // was parked, not just that `focusID` was kept.
    expect(labels(readTrace(container))).toContain('disarm:direct');
  });

  // Protects the privacy of the trace: the search box holds a typed value, so `describeActive`
  // looks at an INPUT with a value. Focusing it disarms the request (`focusin-other`), and the
  // `focusin` and `disarm` annotations are the ones that describe that INPUT. Only the tag name and
  // `data-provider` may reach the attribute. FABRICATED states, `hasFocus` stubbed.
  it('keeps typed values out of the trace', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container, apply } = setup(stateWith('idle'));
    pressConnect(container);
    apply({ type: 'settings.state', state: stateWith('attempt') });
    apply({ type: 'settings.state', state: stateWith('connected') });
    openPicker(container);
    const search = must<HTMLInputElement>(container, 'input[type="search"]');
    search.value = 'search-marker-xyz';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.focus();
    expect(document.activeElement).toBe(search);
    expect(labels(readTrace(container))).toContain('disarm:focusin-other');
    const raw = must(container, '.settings-providers').getAttribute('data-focus-trace') ?? '';
    expect(raw).toContain('"tag":"INPUT"');
    expect(raw).not.toContain('search-marker-xyz');
  });

  // Protects the one visible change of the end of the attempt (#151): with the document focused and
  // the focus on the "MCP servers" tab (outside the section, so no `focusin` of the section
  // disarms), the request is served as `left-active` and the card does NOT take the focus. An
  // unconditional `card.focus()` there would steal it. FABRICATED states, `hasFocus` stubbed.
  it('at the end of the attempt does not take a focus that sits outside the section', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { container, apply } = setup(stateWith('idle'));
    pressConnect(container);
    apply({ type: 'settings.state', state: stateWith('attempt') });
    const mcpTab = must(container, '#settings-tab-mcp');
    mcpTab.focus();
    apply({ type: 'settings.state', state: stateWith('idle') });
    expect(document.activeElement).toBe(mcpTab);
    const seen = labels(readTrace(container));
    expect(seen).toContain('serve:left-active');
    expect(seen).toContain('disarm:served');
  });

  it('does not take the focus back on a later refresh once the user is elsewhere', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { container, apply } = setup(withAttempt(false));
    pickProvider(container, 'acme');
    must(container, 'li[data-provider="acme"] button.primary').click();
    apply({ type: 'settings.state', state: withAttempt(true) });
    apply({ type: 'settings.state', state: withAttempt(false) });
    await Promise.resolve();
    const elsewhere = must<HTMLElement>(container, 'button.add-provider-button');
    elsewhere.focus();
    apply({ type: 'settings.state', state: withAttempt(false) });
    await Promise.resolve();
    expect(document.activeElement).toBe(elsewhere);
  });
});
