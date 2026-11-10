// Protects "Needs attention" (issue #186, decision P5): each source of trouble yields exactly one
// item that jumps to the right place, a healthy state yields none, and the default-model item does
// not appear before the models were read (it would be an artefact then). PR3: a failed mod is an
// item (and no other mod state is), and there is no item for the server being down (decision P1 of
// E10-settings-sections removed it: the tab shows no sections while disconnected). Provenance: fabricated
// states built from `settingsFixtures.ts`; how a real server fills `needsAuth` or `needs_auth` is
// not exercised here (the fake server's `broken` and `linear` are the real-VS-Code cells of 1.4).
import { describe, expect, it } from 'vitest';
import { attentionBySection, attentionItems, type AttentionInput } from './attention';
import { anthropic, makeState, mcpServers, modsListing } from './settingsFixtures';

/** A healthy input: connected, one provider, one MCP server that is connected. */
function healthy(): AttentionInput {
  const state = makeState({
    providers: { loaded: true, failed: false, rows: [structuredClone(anthropic)] },
    mcp: {
      loaded: true,
      failed: false,
      pendingFirstRead: false,
      servers: [
        { name: 'docs', status: 'connected', canSignIn: false, resources: [], templates: [] },
      ],
    },
  });
  return {
    providers: state.providers,
    models: state.models,
    preference: state.preference,
    mcp: state.mcp,
  };
}

describe('attentionItems', () => {
  it('is empty for a healthy state', () => {
    expect(attentionItems(healthy())).toEqual([]);
  });

  it('yields one item per source, each with the section and row to jump to', () => {
    const input = healthy();
    input.mods = structuredClone(modsListing);
    const row = input.providers.rows[0];
    if (row?.connections[0]?.kind === 'credential') row.connections[0].needsAuth = 'sign in';
    input.mcp = {
      loaded: true,
      failed: false,
      pendingFirstRead: false,
      servers: structuredClone(mcpServers),
    };
    input.preference = { value: 'anthropic/gone', status: 'unavailable', workspaceOverride: false };
    const items = attentionItems(input);
    expect(items.map((item) => [item.kind, item.section, item.anchor?.value])).toEqual([
      ['providerNeedsAuth', 'providers', 'anthropic'],
      ['mcpFailed', 'mcp', 'broken'],
      ['mcpNeedsAuth', 'mcp', 'linear'],
      ['modFailed', 'mods', 'throws'],
      ['modelIgnored', 'models', undefined],
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(items[1]?.anchor?.attribute).toBe('data-server');
    expect(items[0]?.anchor?.attribute).toBe('data-provider');
    expect(items[3]?.anchor?.attribute).toBe('data-mod-id');
    expect(items[3]?.text).toBe('The mod Throws could not start');
  });

  it('flags only a mod that failed, and nothing when the host sent no mods', () => {
    const input = healthy();
    const listing = structuredClone(modsListing);
    listing.mods = listing.mods.filter((mod) => mod.state !== 'failed');
    input.mods = listing;
    expect(attentionItems(input)).toEqual([]);
    input.mods = undefined;
    expect(attentionItems(input)).toEqual([]);
  });

  it('counts a provider once even when two connections need sign-in', () => {
    const input = healthy();
    input.providers.rows = [
      {
        ...anthropic,
        connections: [
          { kind: 'credential', id: 'c1', label: 'a', method: 'key', needsAuth: 'x' },
          { kind: 'env', name: 'KEY', needsAuth: 'y' },
        ],
      },
    ];
    expect(attentionItems(input)).toHaveLength(1);
  });

  it('ignores the default-model setting until the models were read, and when that read failed', () => {
    for (const status of ['invalid', 'unavailable'] as const) {
      const input = healthy();
      input.preference = { value: 'a/b', status, workspaceOverride: false };
      input.models = { loaded: false, failed: false, rows: [] };
      expect(attentionItems(input)).toEqual([]);
      input.models = { loaded: true, failed: true, rows: [] };
      expect(attentionItems(input)).toEqual([]);
      input.models = { loaded: true, failed: false, rows: [] };
      expect(attentionItems(input).map((item) => item.kind)).toEqual(['modelIgnored']);
    }
    const none = healthy();
    none.preference = { value: 'a/b', status: 'applied', workspaceOverride: false };
    expect(attentionItems(none)).toEqual([]);
  });

  it('adds nothing for a disabled or pending MCP server', () => {
    const input = healthy();
    input.mcp.servers = [
      { name: 'off', status: 'disabled', canSignIn: false, resources: [], templates: [] },
      { name: 'wait', status: 'pending', canSignIn: false, resources: [], templates: [] },
    ];
    expect(attentionItems(input)).toEqual([]);
  });
});

describe('attentionBySection', () => {
  it('counts the items of each section', () => {
    const input = healthy();
    input.mcp.servers = structuredClone(mcpServers);
    expect(attentionBySection(attentionItems(input))).toEqual({ mcp: 2 });
    expect(attentionBySection([])).toEqual({});
  });
});
