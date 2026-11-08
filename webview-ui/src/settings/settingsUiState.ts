/**
 * What only the settings webview knows (issue #128, E10): the section chosen, the provider search,
 * the provider card that is open and the form fields typed but not sent. It is kept with the
 * webview `getState`/`setState` so it survives the tab being hidden (VS Code destroys the iframe
 * then; the panel has no `retainContextWhenHidden`). The host never sees it.
 *
 * It never holds a key: the tab has no field for one, and the drafts are only the answers of the
 * method forms (a resource name, a deployment type…).
 */
import { createSignal, type Accessor } from 'solid-js';

/** The seven sections of the tab, in the order of the navigation (issue #186). */
export const SETTINGS_SECTIONS = [
  'general',
  'providers',
  'models',
  'mcp',
  'mods',
  'workMode',
  'advanced',
] as const;

/** One of the {@link SETTINGS_SECTIONS}. */
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Most integrations with a draft, fields per draft and length of one value we keep. Our caps. */
const MAX_DRAFTS = 50;
const MAX_DRAFT_FIELDS = 40;
const MAX_DRAFT_VALUE = 2000;
const MAX_SEARCH = 200;

/** What is persisted. */
export interface PersistedSettingsUi {
  section: SettingsSection;
  search: string;
  expanded?: string;
  drafts: Record<string, Record<string, string>>;
}

/** The slice of the VS Code webview API used here; `vscodeApi` satisfies it. */
export interface SettingsStateApi {
  getState(): unknown;
  setState(state: PersistedSettingsUi): void;
}

/** The reactive view of the persisted state, as the components use it. */
export interface SettingsUi {
  section: Accessor<SettingsSection>;
  setSection(section: SettingsSection): void;
  /** The text typed in the "+ Add provider" picker (the slot of the old provider filter). */
  search: Accessor<string>;
  setSearch(search: string): void;
  /** The integration id whose card is open, if any. */
  expanded: Accessor<string | undefined>;
  setExpanded(id: string | undefined): void;
  /** The typed values of one integration's forms, by `<method index>:<field key>`. */
  draft(integrationID: string): Record<string, string>;
  setDraft(integrationID: string, key: string, value: string): void;
  clearDraft(integrationID: string): void;
}

/** True for a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for one of the seven section ids. */
function isSection(value: unknown): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section === value);
}

/**
 * The section a saved state opens on. A saved `section` wins when it is one of the seven; the
 * previous version of the tab saved `tab: 'providers' | 'mcp'`, which maps to the section of the
 * same name; anything else (nothing saved, junk, another type) opens General, the section of the
 * header cards and "Needs attention".
 */
export function migrateSection(record: Record<string, unknown>): SettingsSection {
  if (isSection(record.section)) return record.section;
  if (record.tab === 'providers' || record.tab === 'mcp') return record.tab;
  return 'general';
}

/**
 * Reads the drafts of a saved state, keeping only well-formed entries within the caps: the state
 * comes from `getState`, which may hold the shape of another version of the extension.
 */
function readDrafts(raw: unknown): Record<string, Record<string, string>> {
  const drafts: Record<string, Record<string, string>> = {};
  if (!isRecord(raw)) return drafts;
  for (const [id, entry] of Object.entries(raw).slice(0, MAX_DRAFTS)) {
    if (!isRecord(entry)) continue;
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry).slice(0, MAX_DRAFT_FIELDS)) {
      if (typeof value === 'string' && value.length <= MAX_DRAFT_VALUE) fields[key] = value;
    }
    drafts[id] = fields;
  }
  return drafts;
}

/**
 * Restores the saved state, validating it, and returns the reactive view; every setter persists at
 * once (one small message per keystroke, like `createUiState`; not measured, HYPOTHESIS: negligible
 * at typing speed). The section goes through {@link migrateSection}, so a state saved by the
 * two-tab version (`tab`) still opens where it was and a state with nothing valid opens General;
 * the state it writes carries `section`, never `tab`. The search is cut to 200 characters.
 * VERIFIED by `settingsUiState.test.ts` with fabricated states (old `tab`, junk, missing, a saved
 * `section`); that the state really survives hiding and showing the tab in VS Code is UNVERIFIED,
 * with no date: no `test:visual` cell hides and shows the tab. The `search` it keeps is the text of
 * the provider picker; in a real VS Code it is VERIFIED to reach the store and filter the picker
 * (1.145.2, Windows 11, the full `npm run test:visual` of 08/11/2026, step
 * "35 OpenCode Settings tab: providers and MCP servers (E10-config-views)": "ok   V1 the picker
 * lists 5 providers and typing "azu"
 * in it leaves one (["azure"])"), and that the text of the last pick stays in the picker is why step
 * 36 clears it before measuring (P1).
 */
export function createSettingsUi(api: SettingsStateApi): SettingsUi {
  const raw: unknown = api.getState();
  const record = isRecord(raw) ? raw : {};
  const [section, setSectionSignal] = createSignal<SettingsSection>(migrateSection(record));
  const [search, setSearchSignal] = createSignal(
    typeof record.search === 'string' ? record.search.slice(0, MAX_SEARCH) : '',
  );
  const [expanded, setExpandedSignal] = createSignal<string | undefined>(
    typeof record.expanded === 'string' && record.expanded !== '' ? record.expanded : undefined,
  );
  const [drafts, setDrafts] = createSignal(readDrafts(record.drafts));

  const persist = (): void => {
    const id = expanded();
    api.setState({
      section: section(),
      search: search(),
      ...(id === undefined ? {} : { expanded: id }),
      drafts: drafts(),
    });
  };

  return {
    section,
    setSection(next) {
      setSectionSignal(next);
      persist();
    },
    search,
    setSearch(next) {
      setSearchSignal(next.slice(0, MAX_SEARCH));
      persist();
    },
    expanded,
    setExpanded(id) {
      setExpandedSignal(id);
      persist();
    },
    draft(integrationID) {
      const all = drafts();
      return (Object.hasOwn(all, integrationID) ? all[integrationID] : undefined) ?? {};
    },
    setDraft(integrationID, key, value) {
      const current = drafts();
      if (!(integrationID in current) && Object.keys(current).length >= MAX_DRAFTS) return;
      const fields = { ...(current[integrationID] ?? {}) };
      if (!(key in fields) && Object.keys(fields).length >= MAX_DRAFT_FIELDS) return;
      fields[key] = value.slice(0, MAX_DRAFT_VALUE);
      setDrafts({ ...current, [integrationID]: fields });
      persist();
    },
    clearDraft(integrationID) {
      const rest = { ...drafts() };
      Reflect.deleteProperty(rest, integrationID);
      setDrafts(rest);
      persist();
    },
  };
}
