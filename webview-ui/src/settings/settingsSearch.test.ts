// Protects the global search of the Settings tab (issue #186): accents and case do not matter, a
// prefix beats a word start beats the inside of a word beats a keyword, ties keep the index order,
// the list is capped, and an empty query finds nothing. Provenance: fabricated entries and states
// (`settingsFixtures.ts`); the keyboard and the listbox are in `SettingsSearch.test.tsx`.
import { describe, expect, it } from 'vitest';
import {
  MAX_SEARCH_RESULTS,
  buildSearchIndex,
  normalize,
  searchEntries,
  type SearchEntry,
} from './settingsSearch';
import { anthropic, azure, makeState, mcpServers, modsListing } from './settingsFixtures';

const entry = (label: string, keywords = ''): SearchEntry => ({
  id: label,
  label,
  detail: '',
  keywords,
  target: { kind: 'jump', section: 'general' },
});

describe('normalize', () => {
  it('lowercases and strips accents', () => {
    expect(normalize('Configuración ÁÉÍ ñ')).toBe('configuracion aei n');
    expect(normalize('ANTHROPIC')).toBe('anthropic');
  });
});

describe('searchEntries', () => {
  it('ignores case and accents on both sides', () => {
    const entries = [entry('Configuración'), entry('Other')];
    expect(searchEntries(entries, 'CONFIGURACION').map((e) => e.label)).toEqual(['Configuración']);
    expect(searchEntries(entries, 'configuración').map((e) => e.label)).toEqual(['Configuración']);
  });

  it('ranks prefix, then word start, then inside a word, then keyword, keeping ties in order', () => {
    const entries = [
      entry('Xtoolbar'), // inside a word
      entry('My tool'), // word start
      entry('Tool two'), // prefix
      entry('Zzz', 'tool-key'), // keyword only
      entry('Tool one'), // prefix, later than 'Tool two'
    ];
    expect(searchEntries(entries, 'tool').map((e) => e.label)).toEqual([
      'Tool two',
      'Tool one',
      'My tool',
      'Xtoolbar',
      'Zzz',
    ]);
  });

  it('matches the trimmed query as one substring', () => {
    const entries = [entry('Default model'), entry('Model default')];
    expect(searchEntries(entries, '  default m ').map((e) => e.label)).toEqual(['Default model']);
  });

  it('finds nothing for an empty or blank query, and nothing that is absent', () => {
    const entries = [entry('Anthropic')];
    expect(searchEntries(entries, '')).toEqual([]);
    expect(searchEntries(entries, '   ')).toEqual([]);
    expect(searchEntries(entries, 'zzz')).toEqual([]);
  });

  it('caps the list at 20, and at a custom limit', () => {
    const entries = Array.from({ length: 50 }, (_, i) => entry(`Model ${String(i)}`));
    expect(searchEntries(entries, 'model')).toHaveLength(MAX_SEARCH_RESULTS);
    expect(MAX_SEARCH_RESULTS).toBe(20);
    expect(searchEntries(entries, 'model', 3).map((e) => e.label)).toEqual([
      'Model 0',
      'Model 1',
      'Model 2',
    ]);
  });
});

describe('buildSearchIndex', () => {
  const state = makeState({
    providers: { loaded: true, failed: false, rows: [anthropic, azure] },
    models: {
      loaded: true,
      failed: false,
      rows: [
        {
          providerID: 'anthropic',
          id: 'claude-sonnet',
          name: 'Claude Sonnet',
          providerName: 'Anthropic',
        },
      ],
    },
    mcp: { loaded: true, failed: false, pendingFirstRead: false, servers: mcpServers },
  });
  const index = buildSearchIndex(state);
  const find = (query: string) => searchEntries(index, query);

  it('finds the seven sections', () => {
    for (const label of [
      'General',
      'Providers',
      'Models',
      'MCP servers',
      'Mods',
      'Work mode',
      'Advanced',
    ]) {
      expect(find(label)[0]?.target, label).toMatchObject({ kind: 'jump' });
    }
    expect(find('work mode')[0]?.target).toEqual({ kind: 'jump', section: 'workMode' });
  });

  it('finds connected and not connected providers and jumps to their row', () => {
    expect(find('azure')[0]).toMatchObject({
      detail: 'Provider · not connected',
      target: {
        kind: 'jump',
        section: 'providers',
        anchor: { attribute: 'data-provider', value: 'azure' },
      },
    });
    expect(find('anthropic')[0]?.detail).toBe('Provider · connected');
  });

  it('finds a model by its name, and by provider/id', () => {
    expect(find('sonnet')[0]?.target).toEqual({ kind: 'jump', section: 'models' });
    expect(find('anthropic/claude').map((e) => e.id)).toContain('model:anthropic/claude-sonnet');
  });

  it('finds an MCP server and jumps to its row', () => {
    expect(find('linear')[0]?.target).toEqual({
      kind: 'jump',
      section: 'mcp',
      anchor: { attribute: 'data-server', value: 'linear' },
    });
  });

  it('finds the native settings by label and by key, and the two actions', () => {
    expect(find('chat location')[0]?.target).toEqual({ kind: 'setting', key: 'chatLocation' });
    expect(find('openVsCode.autoStart')[0]?.target).toEqual({ kind: 'setting', key: 'autoStart' });
    expect(find('restart')[0]?.target).toEqual({ kind: 'action', action: 'restart' });
    expect(find('logs')[0]?.target).toEqual({ kind: 'action', action: 'logs' });
  });

  it('finds a mod by name or id and jumps to its row, and the actions of PR3', () => {
    const withMods = buildSearchIndex({ ...state, mods: structuredClone(modsListing) });
    expect(searchEntries(withMods, 'throws')[0]?.target).toEqual({
      kind: 'jump',
      section: 'mods',
      anchor: { attribute: 'data-mod-id', value: 'throws' },
    });
    expect(searchEntries(withMods, 'off-mod')[0]?.label).toBe('Off mod');
    expect(find('throws')).toEqual([]);
    expect(find('reload mods')[0]?.target).toEqual({ kind: 'action', action: 'reloadMods' });
    expect(find('server password')[0]?.target).toEqual({
      kind: 'action',
      action: 'setServerPassword',
    });
    expect(find('saved permissions')[0]?.target).toEqual({
      kind: 'action',
      action: 'managePermissions',
    });
    expect(find('open chat')[0]?.target).toEqual({ kind: 'action', action: 'openChat' });
  });

  it('has unique ids', () => {
    expect(new Set(index.map((e) => e.id)).size).toBe(index.length);
  });
});
