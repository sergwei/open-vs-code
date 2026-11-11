// The index and the matching of the global search of the Settings tab (issue #186). Pure: no DOM,
// no store, so ranking, accents and the cap are tested directly. The search is a list of JUMPS (a
// section, a provider, a model, an MCP server, a native setting, an action), not a filter of the
// rows on screen: the seven sections are too different to filter together, and a filter would
// rebuild the connect form while someone is typing in it.
import * as l10n from '@vscode/l10n';
import type { SettingsAction, SettingsSettingKey } from '../../../src/shared/settingsProtocol';
import { SETTINGS_SETTING_KEYS } from '../../../src/shared/settingsProtocol';
import type { SettingsStoreState } from './settingsStore';
import { SETTINGS_SECTIONS, type SettingsSection } from './settingsUiState';

/** The most results the list shows. Our choice: more would need scrolling a popup. */
export const MAX_SEARCH_RESULTS = 20;

/** What choosing an entry does. */
export type SearchTarget =
  | { kind: 'jump'; section: SettingsSection; anchor?: { attribute: string; value: string } }
  | { kind: 'setting'; key: SettingsSettingKey }
  | { kind: 'action'; action: SettingsAction };

/** One thing the search can find. */
export interface SearchEntry {
  /** Unique within one index; the option id and the `<For>` key. */
  id: string;
  /** Shown first, and what the ranking looks at first. */
  label: string;
  /** Shown after the label (the group: "Provider", "Setting"…); not ranked. */
  detail: string;
  /** Extra text that also matches, ranked below the label (a setting key, the provider of a model). */
  keywords: string;
  target: SearchTarget;
}

/** The slice of the store {@link buildSearchIndex} reads. */
export type SearchInput = Pick<SettingsStoreState, 'providers' | 'models' | 'mcp'> & {
  mods?: SettingsStoreState['mods'];
};

/** The label of each section, in the interface language. */
export function sectionLabels(): Record<SettingsSection, string> {
  return {
    general: l10n.t('General'),
    providers: l10n.t('Providers'),
    models: l10n.t('Models'),
    mcp: l10n.t('MCP servers'),
    mods: l10n.t('Mods'),
    workMode: l10n.t('Work mode'),
    advanced: l10n.t('Advanced'),
  };
}

/** The label of each native setting the tab can open, in the interface language. */
export function settingLabels(): Record<SettingsSettingKey, string> {
  return {
    opencodePath: l10n.t('opencode executable path'),
    serverUrl: l10n.t('External server URL'),
    defaultModel: l10n.t('Default model'),
    chatLocation: l10n.t('Chat location'),
    autoStart: l10n.t('Start the server automatically'),
    'mods.enabled': l10n.t('Enable mods'),
  };
}

/**
 * Lowercases and strips accents (`NFD`, then the combining marks), so "Configuracion" finds
 * "Configuración" and "ANTHROPIC" finds "Anthropic".
 */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Builds the entries from the state of the tab: the sections, the providers (connected or not), the
 * models, the MCP servers, the native settings (found by label or by their `openVsCode.<key>`) and
 * the mods (one jump each, to its row by `data-mod-id`; none when the host sent no mods) and the
 * actions: Restart server and Show logs, and, since PR3, Reload mods, Open mods folder, Set server
 * password, Manage saved permissions and Open chat. The shell of opencode (issue #205) is one more
 * entry after the native settings, found by "opencode shell", "shell" or "terminal", that jumps to
 * its select in Advanced by `data-setting="shell"`. The order is the order of the ties of
 * {@link searchEntries}.
 * VERIFIED by `settingsSearch.test.ts` with fabricated states (the shell entry by "finds the shell of
 * opencode by label or keyword and jumps to its select in Advanced"); a real catalog of 238 providers
 * and thousands of models is not measured here (the list is capped at {@link MAX_SEARCH_RESULTS}
 * after ranking, and the index is rebuilt only when the state changes).
 */
export function buildSearchIndex(input: SearchInput): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const sections = sectionLabels();
  for (const section of SETTINGS_SECTIONS) {
    entries.push({
      id: `section:${section}`,
      label: sections[section],
      detail: l10n.t('Section'),
      keywords: '',
      target: { kind: 'jump', section },
    });
  }
  for (const row of input.providers.rows) {
    const connected = row.connections.length > 0;
    entries.push({
      id: `provider:${row.id}`,
      label: row.name,
      detail: connected ? l10n.t('Provider · connected') : l10n.t('Provider · not connected'),
      keywords: row.id,
      target: {
        kind: 'jump',
        section: 'providers',
        anchor: { attribute: 'data-provider', value: row.id },
      },
    });
  }
  for (const model of input.models.rows) {
    entries.push({
      id: `model:${model.providerID}/${model.id}`,
      label: model.name,
      detail: l10n.t('Model · {0}', model.providerName),
      keywords: `${model.providerName} ${model.providerID}/${model.id}`,
      target: { kind: 'jump', section: 'models' },
    });
  }
  for (const server of input.mcp.servers) {
    entries.push({
      id: `mcp:${server.name}`,
      label: server.name,
      detail: l10n.t('MCP server'),
      keywords: '',
      target: {
        kind: 'jump',
        section: 'mcp',
        anchor: { attribute: 'data-server', value: server.name },
      },
    });
  }
  for (const mod of input.mods?.mods ?? []) {
    entries.push({
      id: `mod:${mod.id}`,
      label: mod.name,
      detail: l10n.t('Mod'),
      keywords: mod.id,
      target: {
        kind: 'jump',
        section: 'mods',
        anchor: { attribute: 'data-mod-id', value: mod.id },
      },
    });
  }
  const settings = settingLabels();
  for (const key of SETTINGS_SETTING_KEYS) {
    entries.push({
      id: `setting:${key}`,
      label: settings[key],
      detail: l10n.t('Setting'),
      keywords: `openVsCode.${key}`,
      target: { kind: 'setting', key },
    });
  }
  // The shell of opencode is not a VS Code setting: it jumps to its select in Advanced (issue #205).
  entries.push({
    id: 'setting:shell',
    label: l10n.t('opencode shell'),
    detail: l10n.t('Setting'),
    keywords: 'shell terminal',
    target: {
      kind: 'jump',
      section: 'advanced',
      anchor: { attribute: 'data-setting', value: 'shell' },
    },
  });
  entries.push(
    {
      id: 'action:restart',
      label: l10n.t('Restart server'),
      detail: l10n.t('Action'),
      keywords: '',
      target: { kind: 'action', action: 'restart' },
    },
    {
      id: 'action:logs',
      label: l10n.t('Show logs'),
      detail: l10n.t('Action'),
      keywords: '',
      target: { kind: 'action', action: 'logs' },
    },
    {
      id: 'action:reloadMods',
      label: l10n.t('Reload mods'),
      detail: l10n.t('Action'),
      keywords: '',
      target: { kind: 'action', action: 'reloadMods' },
    },
    {
      id: 'action:openModsFolder',
      label: l10n.t('Open mods folder'),
      detail: l10n.t('Action'),
      keywords: '',
      target: { kind: 'action', action: 'openModsFolder' },
    },
    {
      id: 'action:setServerPassword',
      label: l10n.t('Set server password'),
      detail: l10n.t('Action'),
      keywords: '',
      target: { kind: 'action', action: 'setServerPassword' },
    },
    {
      id: 'action:managePermissions',
      label: l10n.t('Manage saved permissions'),
      detail: l10n.t('Action'),
      keywords: '',
      target: { kind: 'action', action: 'managePermissions' },
    },
    {
      id: 'action:openChat',
      label: l10n.t('Open chat'),
      detail: l10n.t('Action'),
      keywords: '',
      target: { kind: 'action', action: 'openChat' },
    },
  );
  return entries;
}

/**
 * The rank of `needle` in `text` (both already normalized): 0 when `text` starts with it, 1 when a
 * word of it does, 2 when it appears inside a word, `undefined` when it does not appear.
 */
function rank(text: string, needle: string): number | undefined {
  const at = text.indexOf(needle);
  if (at === -1) return undefined;
  if (at === 0) return 0;
  if (/[^\p{L}\p{N}]/u.test(text.charAt(at - 1))) return 1;
  return 2;
}

/**
 * Finds the entries that match `query`: no case, no accents, the trimmed query as ONE substring
 * (a space inside it must match as written). A match in the label ranks 0 (prefix), 1 (start of
 * a word) or 2 (inside); a match only in `keywords` ranks 3. Ties keep the index order, and at most
 * `limit` come back. An empty query finds nothing, so the list closes when the box is cleared.
 * VERIFIED by `settingsSearch.test.ts` (accents, case, the four ranks, ties and the cap).
 */
export function searchEntries(
  entries: readonly SearchEntry[],
  query: string,
  limit: number = MAX_SEARCH_RESULTS,
): SearchEntry[] {
  const needle = normalize(query.trim());
  if (needle === '') return [];
  const scored: { entry: SearchEntry; score: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    const inLabel = rank(normalize(entry.label), needle);
    const score =
      inLabel ?? (rank(normalize(entry.keywords), needle) === undefined ? undefined : 3);
    if (score !== undefined) scored.push({ entry, score, order });
  });
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.slice(0, limit).map((item) => item.entry);
}
