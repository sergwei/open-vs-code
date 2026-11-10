// Protects the MCP section: each of the five states says itself in words (not only by colour or
// icon) and offers the ONE action of its state (Connect, Retry, Disconnect, Sign in, or a hint to
// run `opencode mcp auth` when the host cannot sign in), that button is a single element that keeps
// its focus when the state changes and is `aria-disabled` (never `disabled`) while its request is
// out, the error is one line with its whole text under "Show details", resources are folded, the
// sign-in in progress shows on its own row, an empty list is not "no servers" until the first read
// is over, and every text of the server is text. Provenance: fabricated rows (settingsFixtures.ts)
// shaped like the ones the fake server lists, pushed into a real store, jsdom. The look, the
// ellipsis and the contrast of the new row in a real VS Code are judged by cells L1-L3 and F1-F4 of
// `test:visual` step 52 (see the header of `McpSection`); V4 of step 35 follows the row too.
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it } from 'vitest';
import { must, mount, type Mounted } from '../testing';
import { countsText, McpSection } from './McpSection';
import { makeState, mcpServers } from './settingsFixtures';
import { createSettingsStore } from './settingsStore';
import type {
  AuthAttemptView,
  SettingsMcpServerRow,
  SettingsState,
  SettingsWebviewToHost,
} from '../../../src/shared/settingsProtocol';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

const loaded = (servers = mcpServers): SettingsState['mcp'] => ({
  loaded: true,
  failed: false,
  pendingFirstRead: false,
  servers,
});

const row = (
  name: string,
  status: SettingsMcpServerRow['status'],
  extra: Partial<SettingsMcpServerRow> = {},
): SettingsMcpServerRow => ({
  name,
  status,
  canSignIn: false,
  resources: [],
  templates: [],
  ...extra,
});

/** Mounts the section over a real store; `host` pushes a later `settings.state`, `bump` a notice. */
function show(mcp: SettingsState['mcp'], attempt?: AuthAttemptView) {
  const store = createSettingsStore();
  const sent: SettingsWebviewToHost[] = [];
  const [seq, setSeq] = createStore<Record<string, number>>({});
  const push = (next: SettingsState['mcp'], nextAttempt?: AuthAttemptView): void => {
    store.apply({
      type: 'settings.state',
      state: makeState({
        // A copy: the store merges later states INTO the objects it was given, and these rows
        // are the shared fixture of every test.
        mcp: structuredClone(next),
        ...(nextAttempt === undefined ? {} : { attempt: nextAttempt }),
      }),
    });
  };
  push(mcp, attempt);
  mounted = mount(() => (
    <McpSection
      state={store.state}
      send={(message) => {
        sent.push(message);
      }}
      seq={seq}
    />
  ));
  const container = mounted.container;
  return {
    container,
    sent,
    host: push,
    bump: (name: string) => {
      setSeq(name, (count) => (count ?? 0) + 1);
    },
    card: (name: string) => must(container, `[data-server="${name}"]`),
    button: (name: string) =>
      must<HTMLButtonElement>(container, `[data-server="${name}"] button.settings-mcp-action`),
  };
}

describe('McpSection', () => {
  it('says the state of each server in words and tones the card from it', () => {
    const { card } = show(loaded());
    expect(card('docs').textContent).toContain('docs — connected');
    expect(card('broken').textContent).toContain('broken — failed');
    expect(card('off').textContent).toContain('off — disabled');
    expect(card('linear').textContent).toContain('linear — needs sign-in');
    expect(card('docs').getAttribute('data-status')).toBe('done');
    expect(card('broken').getAttribute('data-status')).toBe('failed');
    expect(card('off').getAttribute('data-status')).toBe('waiting');
    expect(card('linear').getAttribute('data-status')).toBe('attention');
    // The card stays focusable by the jump of "Needs attention" and the search.
    expect(card('docs').getAttribute('tabindex')).toBe('-1');
  });

  it('offers one button per state: Connect, Retry, Disconnect (also while connecting) and Sign in', () => {
    const { button, container } = show(loaded([...mcpServers, row('slow', 'pending')]));
    expect(button('off').textContent).toBe('Connect');
    expect(button('broken').textContent).toBe('Retry');
    expect(button('docs').textContent).toBe('Disconnect');
    expect(button('slow').textContent).toBe('Disconnect');
    expect(button('linear').textContent).toBe('Sign in');
    expect(must(container, '[data-server="slow"] .spinner')).not.toBeNull();
    expect(container.querySelectorAll('button.settings-mcp-action')).toHaveLength(5);
  });

  it('sends the message of each button: connect, retry as connect, disconnect and sign-in', () => {
    const { button, sent } = show(loaded([...mcpServers, row('slow', 'pending')]));
    button('off').click();
    button('broken').click();
    button('docs').click();
    button('slow').click();
    button('linear').click();
    expect(sent).toEqual([
      { type: 'settings.mcp', server: 'off', op: 'connect' },
      { type: 'settings.mcp', server: 'broken', op: 'connect' },
      { type: 'settings.mcp', server: 'docs', op: 'disconnect' },
      { type: 'settings.mcp', server: 'slow', op: 'disconnect' },
      { type: 'settings.mcpSignIn', server: 'linear' },
    ]);
  });

  it('tells a server that needs sign-in without a way to do it to run opencode mcp auth, with no button', () => {
    const { card, container } = show(loaded([row('manual', 'needs_auth', { error: 'Sign in' })]));
    expect(card('manual').textContent).toContain('Run opencode mcp auth manual in a terminal.');
    expect(container.querySelector('button.settings-mcp-action')).toBeNull();
    // ...and a server that CAN sign in does not get the hint.
    const other = show(loaded());
    expect(other.card('linear').textContent).not.toContain('opencode mcp auth');
  });

  it('keeps ONE button whose label changes with the state, and its focus', () => {
    const { button, host, container } = show(loaded());
    const before = button('off');
    before.focus();
    expect(document.activeElement).toBe(before);
    host(
      loaded(
        mcpServers.map((server) =>
          server.name === 'off' ? { ...server, status: 'connected' } : server,
        ),
      ),
    );
    const after = button('off');
    expect(after).toBe(before);
    expect(after.textContent).toBe('Disconnect');
    expect(document.activeElement).toBe(after);
    expect(
      container.querySelectorAll('[data-server="off"] button.settings-mcp-action'),
    ).toHaveLength(1);
  });

  it('is aria-disabled and aria-busy while its request is out, never disabled, and presses once', () => {
    const { button, sent, host, bump } = show(loaded());
    const connect = button('off');
    connect.click();
    expect(connect.getAttribute('aria-disabled')).toBe('true');
    expect(connect.getAttribute('aria-busy')).toBe('true');
    expect(connect.disabled).toBe(false);
    connect.click();
    expect(sent).toHaveLength(1);
    // A notice for that server clears it even if the state is the same (a refused request).
    bump('off');
    expect(connect.getAttribute('aria-disabled')).toBeNull();
    expect(connect.getAttribute('aria-busy')).toBeNull();
    connect.click();
    expect(sent).toHaveLength(2);
    // A final state of that server clears it too.
    host(
      loaded(
        mcpServers.map((server) =>
          server.name === 'off' ? { ...server, status: 'connected' } : server,
        ),
      ),
    );
    expect(button('off').getAttribute('aria-disabled')).toBeNull();
    // Another server is not affected by the request of this one.
    expect(button('docs').getAttribute('aria-disabled')).toBeNull();
  });

  /**
   * Protects the window after Connect: the server goes to `pending` while the host is still
   * inside its call and refuses a second change. SYNTHETIC states pushed by hand (vitest, no
   * server); the real timing is covered by `test:visual` step 52.
   */
  it('stays busy while the server is pending after the click, until the notice or a final state', () => {
    const { button, sent, host, bump } = show(loaded());
    const withOff = (status: SettingsMcpServerRow['status']): SettingsState['mcp'] =>
      loaded(mcpServers.map((server) => (server.name === 'off' ? { ...server, status } : server)));
    button('off').click();
    host(withOff('pending'));
    const connect = button('off');
    expect(connect.textContent).toBe('Disconnect');
    expect(connect.getAttribute('aria-disabled')).toBe('true');
    expect(connect.getAttribute('aria-busy')).toBe('true');
    connect.click();
    expect(sent).toHaveLength(1);
    // The final notice frees it even though the state is still pending.
    bump('off');
    expect(connect.getAttribute('aria-disabled')).toBeNull();
    connect.click();
    expect(sent).toHaveLength(2);
    // A click made on a pending server frees it as soon as the state leaves pending.
    host(withOff('connected'));
    expect(connect.getAttribute('aria-disabled')).toBeNull();
  });

  /**
   * Protects issue #202: failed -> pending -> failed with no notice used to return to the status of
   * the click and leave the row busy for good. SYNTHETIC states pushed by hand (vitest, no server).
   */
  it.each([
    ['broken', 'failed'],
    ['off', 'disabled'],
  ] as const)(
    'frees the row on the first state that is not pending after the click went through pending (%s, no notice)',
    (name, initial) => {
      const { button, sent, host } = show(loaded());
      const withStatus = (status: SettingsMcpServerRow['status']): SettingsState['mcp'] =>
        loaded(mcpServers.map((server) => (server.name === name ? { ...server, status } : server)));
      const control = button(name);
      control.click();
      host(withStatus('pending'));
      expect(control.getAttribute('aria-busy')).toBe('true');
      host(withStatus(initial));
      expect(control.getAttribute('aria-disabled')).toBeNull();
      expect(control.getAttribute('aria-busy')).toBeNull();
      control.click();
      expect(sent).toHaveLength(2);
    },
  );

  it('keeps a click made while pending (Disconnect) busy until a final state', () => {
    const { button, host } = show(loaded([...mcpServers, row('slow', 'pending')]));
    const disconnect = button('slow');
    disconnect.click();
    expect(disconnect.getAttribute('aria-busy')).toBe('true');
    host(loaded([...mcpServers, row('slow', 'pending')]));
    expect(disconnect.getAttribute('aria-busy')).toBe('true');
    host(loaded([...mcpServers, row('slow', 'disabled')]));
    expect(disconnect.getAttribute('aria-busy')).toBeNull();
  });

  it('waits to sign in while any sign-in of the host is running, but not to connect', () => {
    const other: AuthAttemptView = { integrationID: 'azure', phase: 'waiting' };
    const { button, sent } = show(loaded(), other);
    expect(button('linear').getAttribute('aria-disabled')).toBe('true');
    button('linear').click();
    expect(sent).toEqual([]);
    expect(button('off').getAttribute('aria-disabled')).toBeNull();
    button('off').click();
    expect(sent).toEqual([{ type: 'settings.mcp', server: 'off', op: 'connect' }]);
  });

  it('shows the error in one line with its whole text in the title, and the details folded under "Show details"', () => {
    const whole = 'Connection closed\nstack line 1\nstack line 2';
    const { card } = show(
      loaded([
        row('broken', 'failed', { error: 'Connection closed', detail: whole }),
        row('plain', 'failed', { error: 'No detail here' }),
      ]),
    );
    const error = must(card('broken'), '.settings-error');
    expect(error.textContent).toBe('Connection closed');
    expect(error.getAttribute('title')).toBe('Connection closed');
    const details = must<HTMLDetailsElement>(card('broken'), 'details.settings-details');
    expect(must(details, 'summary').textContent).toBe('Show details');
    expect(details.open).toBe(false);
    expect(must(details, '.settings-detail-text').textContent).toBe(whole);
    expect(card('plain').querySelector('details')).toBeNull();
    expect(must(card('plain'), '.settings-error').textContent).toBe('No detail here');
  });

  it('folds the resources and templates under their count and lists them as text', () => {
    const { card } = show(loaded());
    const docs = card('docs');
    const folded = must<HTMLDetailsElement>(docs, 'details.settings-details');
    expect(must(folded, 'summary').textContent).toBe('1 resource · 1 template');
    expect(folded.open).toBe(false);
    expect(docs.textContent).toContain('readme.md');
    expect(docs.textContent).toContain('text/markdown');
    expect(docs.textContent).toContain('files');
    expect(docs.textContent).toContain('file:///{path}');
    expect(card('off').querySelector('details')).toBeNull();
    expect(countsText({ ...row('x', 'connected') })).toBe('');
  });

  it('shows the sign-in in progress on the row that owns it, with Cancel, and on no other', () => {
    const attempt: AuthAttemptView = {
      integrationID: 'mcp_0123456789abcdef',
      phase: 'waiting',
      instructions: 'Authorize linear in your browser',
    };
    const { card, sent } = show(loaded(), attempt);
    const linear = must(card('linear'), '.settings-attempt');
    expect(linear.textContent).toContain('Authorize linear in your browser');
    must<HTMLButtonElement>(linear, 'button').click();
    expect(sent).toEqual([{ type: 'settings.cancel', integrationID: 'mcp_0123456789abcdef' }]);
    expect(card('docs').querySelector('.settings-attempt')).toBeNull();
    expect(card('broken').querySelector('.settings-attempt')).toBeNull();
  });

  it('does not show an attempt of a provider on an MCP row, and says what it does while starting and finishing', () => {
    const provider = show(loaded(), { integrationID: 'azure', phase: 'waiting' });
    expect(provider.container.querySelector('.settings-attempt')).toBeNull();
    mounted?.dispose();
    const starting = show(loaded(), { integrationID: 'mcp_0123456789abcdef', phase: 'starting' });
    expect(starting.card('linear').textContent).toContain('Starting sign-in…');
    mounted?.dispose();
    const finishing = show(loaded(), { integrationID: 'mcp_0123456789abcdef', phase: 'finishing' });
    expect(finishing.card('linear').textContent).toContain('Finishing the sign-in…');
    expect(
      must(finishing.card('linear'), '.settings-attempt button').getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('says once, for the whole section, that Connect and Disconnect last until opencode restarts', () => {
    const { container } = show(loaded());
    const text = container.textContent;
    const note =
      'Connect and Disconnect last until opencode restarts. To change it for good, edit mcp.servers in opencode.json.';
    expect(text).toContain(note);
    expect(text.split(note)).toHaveLength(2);
    expect(text).not.toContain('read-only');
    expect(text).not.toContain('Servers come from');
  });

  it('does not say "no servers" before the first read is over', () => {
    const { container } = show({
      loaded: true,
      failed: false,
      pendingFirstRead: true,
      servers: [],
    });
    expect(container.textContent).toContain('Reading the MCP servers…');
    expect(container.textContent).not.toContain('No MCP servers');
  });

  it('says there are no servers once the first read is over, and that a read failed', () => {
    expect(show(loaded([])).container.textContent).toContain('No MCP servers are configured.');
    mounted?.dispose();
    const failed = show({ loaded: false, failed: true, pendingFirstRead: false, servers: [] });
    expect(failed.container.textContent).toContain('Could not read the MCP servers');
  });

  it('renders the texts of the server as text, not as HTML', () => {
    const { container } = show(
      loaded([
        row('<b>x</b>', 'failed', {
          error: '<img src=x onerror=alert(1)>',
          detail: '<img src=x onerror=alert(2)>',
        }),
      ]),
    );
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('<img src=x onerror=alert(2)>');
  });
});
