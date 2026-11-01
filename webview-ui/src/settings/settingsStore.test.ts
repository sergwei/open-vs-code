// Protects the two promises of the settings store: a new `settings.state` keeps the identity of the
// rows (so `<For>` keeps the DOM, and a field being typed in), and two notices that arrive in the
// same batch are both delivered, in order. Provenance: fabricated messages (see settingsFixtures.ts).
import { batch, createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { anthropic, azure, makeState, mcpServers } from './settingsFixtures';
import { createSettingsStore, noticeText } from './settingsStore';

describe('createSettingsStore', () => {
  it('starts as not received, with nothing loaded', () =>
    createRoot((dispose) => {
      const { state } = createSettingsStore();
      expect(state.received).toBe(false);
      expect(state.providers.loaded).toBe(false);
      expect(state.mcp.pendingFirstRead).toBe(true);
      dispose();
    }));

  it('keeps the identity of provider rows, nested connections and servers across states', () =>
    createRoot((dispose) => {
      const store = createSettingsStore();
      const first = makeState({
        providers: {
          loaded: true,
          failed: false,
          rows: [structuredClone(anthropic), structuredClone(azure)],
        },
        mcp: {
          loaded: true,
          failed: false,
          pendingFirstRead: false,
          servers: structuredClone(mcpServers),
        },
      });
      store.apply({ type: 'settings.state', state: first });
      const rowBefore = store.state.providers.rows[0];
      const connectionBefore = rowBefore?.connections[0];
      const azureBefore = store.state.providers.rows[1];
      const serverBefore = store.state.mcp.servers[0];

      // The host sends a fresh copy: azure moves first, anthropic gets another label, docs is renamed in its status.
      const second = structuredClone(first);
      second.providers.rows.reverse();
      const changed = second.providers.rows[1];
      if (changed?.connections[0]?.kind === 'credential')
        changed.connections[0].label = 'Anthropic 2';
      const docs = second.mcp.servers[0];
      if (docs !== undefined) docs.status = 'failed';
      store.apply({ type: 'settings.state', state: second });

      expect(store.state.providers.rows[0]).toBe(azureBefore);
      expect(store.state.providers.rows[1]).toBe(rowBefore);
      expect(rowBefore?.connections[0]).toBe(connectionBefore);
      const label = rowBefore?.connections[0];
      expect(label?.kind === 'credential' ? label.label : '').toBe('Anthropic 2');
      expect(store.state.mcp.servers[0]).toBe(serverBefore);
      expect(serverBefore?.status).toBe('failed');
      dispose();
    }));

  it('sets and clears the attempt and the optional server version', () =>
    createRoot((dispose) => {
      const store = createSettingsStore();
      store.apply({
        type: 'settings.state',
        state: makeState({ attempt: { integrationID: 'azure', phase: 'waiting', code: 'AB-12' } }),
      });
      expect(store.state.attempt).toEqual({
        integrationID: 'azure',
        phase: 'waiting',
        code: 'AB-12',
      });
      const { serverVersion: _version, ...withoutVersion } = makeState();
      store.apply({ type: 'settings.state', state: withoutVersion });
      expect(store.state.attempt).toBeUndefined();
      expect(store.state.serverVersion).toBeUndefined();
      dispose();
    }));

  it('queues notices of the same batch and drains them once, in order', () =>
    createRoot((dispose) => {
      const store = createSettingsStore();
      batch(() => {
        store.apply({ type: 'settings.notice', notice: { integrationID: 'a', kind: 'connected' } });
        store.apply({
          type: 'settings.notice',
          notice: { integrationID: 'b', kind: 'failed', message: 'x' },
        });
      });
      expect(store.state.notices).toHaveLength(2);
      expect(store.drainNotices().map((n) => n.integrationID)).toEqual(['a', 'b']);
      expect(store.state.notices).toHaveLength(0);
      expect(store.drainNotices()).toEqual([]);
      dispose();
    }));

  it('does not touch the notice queue when a state arrives', () =>
    createRoot((dispose) => {
      const store = createSettingsStore();
      store.apply({ type: 'settings.notice', notice: { integrationID: 'a', kind: 'removed' } });
      store.apply({ type: 'settings.state', state: makeState() });
      expect(store.state.notices).toHaveLength(1);
      dispose();
    }));
});

describe('noticeText', () => {
  it('names the provider and appends the host message only where it explains a problem', () => {
    expect(noticeText({ integrationID: 'a', kind: 'connected', message: 'ignored' }, 'Azure')).toBe(
      'Connected to Azure.',
    );
    expect(noticeText({ integrationID: 'a', kind: 'failed', message: 'denied' }, 'Azure')).toBe(
      'Sign-in to Azure failed. denied',
    );
    expect(noticeText({ integrationID: 'a', kind: 'expired' }, 'Azure')).toBe(
      'Sign-in to Azure expired.',
    );
    expect(noticeText({ integrationID: 'a', kind: 'cancelled' }, 'Azure')).toContain('cancelled');
    expect(noticeText({ integrationID: 'a', kind: 'removed' }, 'Azure')).toContain('Removed');
    expect(noticeText({ integrationID: 'a', kind: 'unsupported' }, 'Azure')).toContain(
      'opencode auth login',
    );
  });
});
