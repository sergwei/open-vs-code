// Protects the Models section (issue #186, phase 1.3): the select lists the models of the connected
// providers grouped by provider, sends the EXACT `provider/model` text (and the empty text for
// "None"), writes nothing optimistically, keeps an ignored value selectable and says so, shows the
// workspace hint with a way to open the setting, and shows the model opencode proposes read only.
// Provenance: fabricated state in jsdom; the real setting and the chat that proposes the model are
// the `fake-server` case "sets the default model from the Settings tab and the chat proposes it".
import { afterEach, describe, expect, it } from 'vitest';
import type {
  SettingsModelRow,
  SettingsPreference,
  SettingsState,
  SettingsWebviewToHost,
} from '../../../src/shared/settingsProtocol';
import { must, mount, type Mounted } from '../testing';
import { makeState } from './settingsFixtures';
import { ModelsSection } from './ModelsSection';
import { createSettingsStore } from './settingsStore';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

const ROWS: SettingsModelRow[] = [
  { providerID: 'anthropic', id: 'sonnet', name: 'Sonnet', providerName: 'Anthropic' },
  { providerID: 'anthropic', id: 'haiku', name: 'Haiku', providerName: 'Anthropic' },
  { providerID: 'openrouter', id: 'meta/llama', name: 'Llama', providerName: 'OpenRouter' },
];

function stateWith(
  preference: SettingsPreference,
  extra: Partial<SettingsState['models']> = {},
): SettingsState {
  return makeState({
    models: { loaded: true, failed: false, rows: structuredClone(ROWS), ...extra },
    preference,
  });
}

function setup(state: SettingsState) {
  const store = createSettingsStore();
  const sent: SettingsWebviewToHost[] = [];
  store.apply({ type: 'settings.state', state });
  mounted = mount(() => (
    <ModelsSection
      state={store.state}
      send={(message) => {
        sent.push(message);
      }}
    />
  ));
  const select = must<HTMLSelectElement>(mounted.container, 'select');
  const choose = (value: string): void => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return { container: mounted.container, store, sent, select, choose };
}

const NONE: SettingsPreference = { value: '', status: 'none', workspaceOverride: false };

describe('ModelsSection', () => {
  it('lists the models grouped by provider, with None first, and selects the saved one', () => {
    const { container, select } = setup(
      stateWith({ value: 'anthropic/haiku', status: 'applied', workspaceOverride: false }),
    );
    const groups = Array.from(container.querySelectorAll('optgroup')).map((group) => [
      group.label,
      Array.from(group.querySelectorAll('option')).map((option) => option.value),
    ]);
    expect(groups).toEqual([
      ['Anthropic', ['anthropic/sonnet', 'anthropic/haiku']],
      ['OpenRouter', ['openrouter/meta/llama']],
    ]);
    expect(select.options[0]?.value).toBe('');
    expect(select.value).toBe('anthropic/haiku');
  });

  it('sends the exact value, sends the empty text for None, and sends nothing before a change', () => {
    const { sent, choose } = setup(stateWith(NONE));
    expect(sent).toEqual([]);
    choose('openrouter/meta/llama');
    choose('');
    expect(sent).toEqual([
      { type: 'settings.setDefaultModel', model: 'openrouter/meta/llama' },
      { type: 'settings.setDefaultModel', model: '' },
    ]);
  });

  it('does not write optimistically: the select goes back to the setting when the state arrives', () => {
    const { store, select, choose } = setup(stateWith(NONE));
    choose('anthropic/sonnet');
    expect(store.state.preference.value).toBe('');
    store.apply({
      type: 'settings.state',
      state: stateWith({ value: 'anthropic/sonnet', status: 'applied', workspaceOverride: false }),
    });
    expect(select.value).toBe('anthropic/sonnet');
    store.apply({ type: 'settings.state', state: stateWith(NONE) });
    expect(select.value).toBe('');
  });

  it('keeps an unavailable value selectable and says new chats ignore it', () => {
    const { container, select } = setup(
      stateWith({ value: 'gone/model', status: 'unavailable', workspaceOverride: false }),
    );
    expect(select.value).toBe('gone/model');
    expect(must(container, '[data-hint="ignored"]').textContent).toContain('gone/model');
  });

  it('does not say a value is ignored while it is applied or unset', () => {
    const { container } = setup(
      stateWith({ value: 'anthropic/sonnet', status: 'applied', workspaceOverride: false }),
    );
    expect(container.querySelector('[data-hint="ignored"]')).toBeNull();
  });

  it('shows the workspace hint and opens the native setting from it', () => {
    const { container, sent } = setup(
      stateWith({ value: 'anthropic/sonnet', status: 'applied', workspaceOverride: true }),
    );
    const hint = must(container, '[data-hint="workspace"]');
    expect(hint.textContent).toContain('This workspace sets its own default model');
    must<HTMLButtonElement>(hint, 'button').click();
    expect(sent).toEqual([{ type: 'settings.openSetting', key: 'defaultModel' }]);
  });

  it('shows the model of opencode read only, with its provider, or says it names none', () => {
    const named = setup(
      stateWith(NONE, { serverDefault: { providerID: 'anthropic', id: 'sonnet', name: 'Sonnet' } }),
    );
    expect(must(named.container, '[data-field="server-default"]').textContent).toBe(
      'Anthropic · Sonnet',
    );
    expect(named.container.textContent).toContain(
      'opencode 2 picks the small model for titles and summaries by itself.',
    );
    mounted?.dispose();
    const none = setup(stateWith(NONE));
    expect(must(none.container, '[data-field="server-default"]').textContent).toBe(
      'opencode names none yet.',
    );
  });

  it('says the models are loading or could not be read instead of an empty select', () => {
    const show = (failed: boolean): Mounted => {
      const store = createSettingsStore();
      store.apply({
        type: 'settings.state',
        state: makeState({ models: { loaded: false, failed, rows: [] }, preference: NONE }),
      });
      return mount(() => <ModelsSection state={store.state} send={() => undefined} />);
    };
    const loading = show(false);
    expect(loading.container.textContent).toContain('Loading the models…');
    expect(loading.container.querySelector('select')).toBeNull();
    loading.dispose();
    mounted = show(true);
    expect(mounted.container.querySelector('select')).toBeNull();
    expect(mounted.container.textContent).toContain('Could not read the models');
  });
});
