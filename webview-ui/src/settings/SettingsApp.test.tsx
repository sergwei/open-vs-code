// Protects the OpenCode Settings tab as a whole: what it says before the first state, while the
// server is not connected and when there is nothing to list; the tabs (roving tabindex and the
// keyboard); search; Refresh and the footer; and the live region that announces the host's notices
// in order. Provenance: fabricated states pushed into a real store (settingsFixtures.ts), jsdom; the
// same tab in a real VS Code is judged by `test:visual` steps 35-36; a screen reader is UNVERIFIED.
import { batch } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});

function setup(initial?: SettingsState, saved?: PersistedSettingsUi) {
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
    expect(container.textContent).toContain('The server lists no other providers.');
    expect(container.textContent).toContain('Add a provider');
  });
});

describe('connected', () => {
  const state = makeState({
    providers: { loaded: true, failed: false, rows: [anthropic, vertex, azure, copilot] },
    mcp: { loaded: true, failed: false, pendingFirstRead: false, servers: mcpServers },
  });

  it('puts connected providers first and the rest under Add a provider, with the version in the header', () => {
    const { container } = setup(state);
    expect(must(container, '.settings-subtitle').textContent).toBe(
      'Providers and MCP servers of the opencode v2.0.32 server for my-project.',
    );
    const lists = container.querySelectorAll('#settings-panel-providers ul.setup-steps');
    const ids = (list: Element | undefined) =>
      Array.from(list?.querySelectorAll('li.settings-card') ?? []).map((li) =>
        li.getAttribute('data-provider'),
      );
    expect(ids(lists[0])).toEqual(['anthropic', 'google-vertex']);
    expect(ids(lists[1])).toEqual(['azure', 'github-copilot']);
    expect(must<HTMLInputElement>(container, 'input[type="search"]').placeholder).toBe(
      'Search 2 providers…',
    );
  });

  it('filters the addable providers by name or id before painting them', () => {
    const { container, ui } = setup(state);
    const search = must<HTMLInputElement>(container, 'input[type="search"]');
    search.value = 'COPI';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ui.search()).toBe('COPI');
    expect(container.querySelector('[data-provider="azure"]')).toBeNull();
    expect(container.querySelector('[data-provider="github-copilot"]')).not.toBeNull();
    search.value = 'zzz';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(container.textContent).toContain('No provider matches “zzz”.');
  });

  it('keeps the open card and what is typed in it when the host sends a new state', () => {
    const { container, apply } = setup(state);
    must(container, '[data-provider="azure"] button.settings-toggle').click();
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
    must(container, '[data-provider="azure"] button.settings-toggle').click();
    expect(
      must(container, '[data-provider="azure"] button.primary').getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('has no password input anywhere in the whole tree, with a form open', () => {
    const { container } = setup(state, {
      tab: 'providers',
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

describe('tabs', () => {
  const state = makeState({
    mcp: { loaded: true, failed: false, pendingFirstRead: false, servers: mcpServers },
  });

  it('is a tablist with a roving tabindex and one visible panel', () => {
    const { container } = setup(state);
    const tabs = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual(['Providers', 'MCP servers']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1']);
    expect(must(container, '#settings-panel-providers').hasAttribute('hidden')).toBe(false);
    expect(must(container, '#settings-panel-mcp').hasAttribute('hidden')).toBe(true);
    expect(tabs[0]?.getAttribute('aria-controls')).toBe('settings-panel-providers');
    expect(must(container, '#settings-panel-mcp').getAttribute('aria-labelledby')).toBe(
      'settings-tab-mcp',
    );
  });

  it('moves and activates with ArrowRight, ArrowLeft (wrapping), End and Home, taking the focus', () => {
    const { container, ui } = setup(state);
    const list = must(container, '[role="tablist"]');
    const [providers, mcp] = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
    providers?.focus();
    press(providers as HTMLElement, 'ArrowRight');
    expect(ui.tab()).toBe('mcp');
    expect(document.activeElement).toBe(mcp);
    expect(mcp?.getAttribute('tabindex')).toBe('0');
    expect(providers?.getAttribute('tabindex')).toBe('-1');
    expect(must(container, '#settings-panel-mcp').hasAttribute('hidden')).toBe(false);
    press(list, 'ArrowRight');
    expect(ui.tab()).toBe('providers');
    press(list, 'ArrowLeft');
    expect(ui.tab()).toBe('mcp');
    press(list, 'Home');
    expect(ui.tab()).toBe('providers');
    press(list, 'End');
    expect(ui.tab()).toBe('mcp');
    press(list, 'a');
    expect(ui.tab()).toBe('mcp');
  });

  it('selects with a click and restores the saved tab', () => {
    const first = setup(state);
    Array.from(first.container.querySelectorAll<HTMLElement>('[role="tab"]'))[1]?.click();
    expect(first.ui.tab()).toBe('mcp');
    mounted?.dispose();
    const restored = setup(state, { tab: 'mcp', search: '', drafts: {} });
    expect(must(restored.container, '#settings-tab-mcp').getAttribute('aria-selected')).toBe(
      'true',
    );
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
    must(cardOf(container) as HTMLElement, 'button.settings-toggle').click();
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
   * Protects the focus of the native InputBox: a key sign-in shows it while the row moves up, and a
   * card that took the focus anyway left the box open but unable to take the key (`test:visual`
   * step 36, V7: "focused false" right after the box appeared, 1/11/2026). With `hasFocus` false
   * (the box has it) the rebuilt card leaves the focus alone. `hasFocus` is stubbed because jsdom
   * has no real window focus: this proves the guard, not what VS Code does with the focus.
   */
  it('leaves the focus alone while another part of the window has it (the native key box)', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { container, apply } = setup(withAttempt(false));
    must(cardOf(container) as HTMLElement, 'button.settings-toggle').click();
    must(container, 'li[data-provider="acme"] button.primary').click();
    apply({ type: 'settings.state', state: withAttempt(true) });
    expect(document.activeElement).not.toBe(cardOf(container));
  });

  it('does not take the focus back on a later refresh once the user is elsewhere', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { container, apply } = setup(withAttempt(false));
    must(cardOf(container) as HTMLElement, 'button.settings-toggle').click();
    must(container, 'li[data-provider="acme"] button.primary').click();
    apply({ type: 'settings.state', state: withAttempt(true) });
    apply({ type: 'settings.state', state: withAttempt(false) });
    await Promise.resolve();
    const search = must(container, 'input[type="search"]');
    search.focus();
    apply({ type: 'settings.state', state: withAttempt(false) });
    await Promise.resolve();
    expect(document.activeElement).toBe(search);
  });
});
