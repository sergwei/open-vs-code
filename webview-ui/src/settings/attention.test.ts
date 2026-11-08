// Protects "Needs attention" (issue #186, decision P5): each source of trouble yields exactly one
// item that jumps to the right place, a healthy state yields none, and the default-model item does
// not appear before the models were read (it would be an artefact then). Provenance: fabricated
// states built from `settingsFixtures.ts`; how a real server fills `needsAuth` or `needs_auth` is
// not exercised here (the fake server's `broken` and `linear` are the real-VS-Code cells of 1.4).
import { describe, expect, it } from 'vitest';
import { attentionBySection, attentionItems, type AttentionInput } from './attention';
import { anthropic, makeState, mcpServers } from './settingsFixtures';

/** A healthy input: connected, one provider, one MCP server that is connected. */
function healthy(): AttentionInput {
  const state = makeState({
    providers: { loaded: true, failed: false, rows: [structuredClone(anthropic)] },
    mcp: {
      loaded: true,
      failed: false,
      pendingFirstRead: false,
      servers: [{ name: 'docs', status: 'connected', resources: [], templates: [] }],
    },
  });
  return {
    connection: state.connection,
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
    input.connection = { state: 'reconnecting', attempt: 1 };
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
      ['serverDown', 'general', undefined],
      ['providerNeedsAuth', 'providers', 'anthropic'],
      ['mcpFailed', 'mcp', 'broken'],
      ['mcpNeedsAuth', 'mcp', 'linear'],
      ['modelIgnored', 'models', undefined],
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(items[2]?.anchor?.attribute).toBe('data-server');
    expect(items[1]?.anchor?.attribute).toBe('data-provider');
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

  it('flags the server down for unavailable, stopped and reconnecting only', () => {
    const cases: [AttentionInput['connection'], number][] = [
      [{ state: 'unavailable', reason: 'start-failed', error: { code: 'x', message: 'y' } }, 1],
      [{ state: 'stopped' }, 1],
      [{ state: 'reconnecting', attempt: 2 }, 1],
      [{ state: 'not-started', reason: 'auto-start-off' }, 0],
      [{ state: 'starting' }, 0],
    ];
    for (const [connection, expected] of cases) {
      const input = healthy();
      input.connection = connection;
      expect(attentionItems(input), connection.state).toHaveLength(expected);
    }
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
      { name: 'off', status: 'disabled', resources: [], templates: [] },
      { name: 'wait', status: 'pending', resources: [], templates: [] },
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
