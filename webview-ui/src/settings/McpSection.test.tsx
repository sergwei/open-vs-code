// Protects the MCP tab: each of the five states says itself in words (not only by colour or icon),
// resources and templates are listed as text, an empty list is not "no servers" until the first
// read is over, and the tab says it is read only. Provenance: fabricated rows (settingsFixtures.ts)
// shaped like the ones the fake server lists; contrast and look are VERIFIED in a real VS Code
// 1.144.0 on Windows 11 (1/11/2026, `test:visual` step 35, synthetic server): "ok   V2 1080 px,
// dark: docs connected with 2 resources and 1 template, broken failed with the first line of its
// error (200 chars, one line), off disabled, linear needs sign-in, nothing outside the document, no
// overflow (0 px), no style attribute (0), min contrast 6.08 over 12 texts".
import { afterEach, describe, expect, it } from 'vitest';
import { must, mount, type Mounted } from '../testing';
import { countsText, McpSection } from './McpSection';
import { mcpServers } from './settingsFixtures';
import type { SettingsState } from '../../../src/shared/settingsProtocol';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

function show(mcp: SettingsState['mcp']): HTMLElement {
  mounted = mount(() => <McpSection mcp={mcp} />);
  return mounted.container;
}

const loaded = (servers = mcpServers): SettingsState['mcp'] => ({
  loaded: true,
  failed: false,
  pendingFirstRead: false,
  servers,
});

describe('McpSection', () => {
  it('says the state of each server in words and tones the card from it', () => {
    const container = show(loaded());
    const card = (name: string) => must(container, `[data-server="${name}"]`);
    expect(card('docs').textContent).toContain('docs — connected');
    expect(card('broken').textContent).toContain('broken — failed');
    expect(card('off').textContent).toContain('off — disabled');
    expect(card('linear').textContent).toContain('linear — needs sign-in');
    expect(card('docs').getAttribute('data-status')).toBe('done');
    expect(card('broken').getAttribute('data-status')).toBe('failed');
    expect(card('off').getAttribute('data-status')).toBe('waiting');
    expect(card('linear').getAttribute('data-status')).toBe('attention');
  });

  it('shows the error of a failed server, the read-only note of needs_auth and a spinner for pending', () => {
    const container = show(
      loaded([...mcpServers, { name: 'slow', status: 'pending', resources: [], templates: [] }]),
    );
    expect(must(container, '[data-server="broken"]').textContent).toContain('Connection closed');
    expect(must(container, '[data-server="linear"]').textContent).toContain(
      'Sign in with the opencode CLI; this view is read-only.',
    );
    expect(must(container, '[data-server="slow"]').textContent).toContain('connecting');
    expect(must(container, '[data-server="slow"] .spinner')).not.toBeNull();
  });

  it('lists resources and templates with their counts', () => {
    const container = show(loaded());
    const docs = must(container, '[data-server="docs"]');
    expect(docs.textContent).toContain('1 resource · 1 template');
    expect(docs.textContent).toContain('readme.md');
    expect(docs.textContent).toContain('text/markdown');
    expect(docs.textContent).toContain('files');
    expect(docs.textContent).toContain('file:///{path}');
    expect(countsText({ name: 'x', status: 'connected', resources: [], templates: [] })).toBe('');
  });

  it('always says where the servers come from', () => {
    expect(show(loaded()).textContent).toContain('Servers come from mcp.servers in opencode.json.');
  });

  it('does not say "no servers" before the first read is over', () => {
    const container = show({ loaded: true, failed: false, pendingFirstRead: true, servers: [] });
    expect(container.textContent).toContain('Reading the MCP servers…');
    expect(container.textContent).not.toContain('No MCP servers');
  });

  it('says there are no servers once the first read is over, and that a read failed', () => {
    expect(show(loaded([])).textContent).toContain('No MCP servers are configured.');
    mounted?.dispose();
    const failed = show({ loaded: false, failed: true, pendingFirstRead: false, servers: [] });
    expect(failed.textContent).toContain('Could not read the MCP servers');
  });

  it('renders the texts of the server as text, not as HTML', () => {
    const container = show(
      loaded([
        {
          name: '<b>x</b>',
          status: 'failed',
          error: '<img src=x onerror=alert(1)>',
          resources: [],
          templates: [],
        },
      ]),
    );
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
