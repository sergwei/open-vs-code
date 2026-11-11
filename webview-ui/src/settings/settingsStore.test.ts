// Protects the two promises of the settings store: a new `settings.state` keeps the identity of the
// rows (so `<For>` keeps the DOM, and a field being typed in), and two notices that arrive in the
// same batch are both delivered, in order. Provenance: fabricated messages (see settingsFixtures.ts).
import { batch, createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { anthropic, azure, makeState, mcpServers, modsListing } from './settingsFixtures';
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

  it('keeps two models that share an id across providers, and drops a default the host stops sending', () =>
    createRoot((dispose) => {
      const store = createSettingsStore();
      const shared = [
        { providerID: 'a', id: 'gpt', name: 'GPT A', providerName: 'A' },
        { providerID: 'b', id: 'gpt', name: 'GPT B', providerName: 'B' },
      ];
      store.apply({
        type: 'settings.state',
        state: makeState({
          models: {
            loaded: true,
            failed: false,
            rows: shared,
            serverDefault: { providerID: 'a', id: 'gpt', name: 'GPT A' },
          },
          preference: { value: 'b/gpt', status: 'applied', workspaceOverride: true },
        }),
      });
      expect(store.state.models.rows.map((row) => row.name)).toEqual(['GPT A', 'GPT B']);
      expect(store.state.models.serverDefault?.name).toBe('GPT A');
      expect(store.state.preference).toEqual({
        value: 'b/gpt',
        status: 'applied',
        workspaceOverride: true,
      });
      store.apply({ type: 'settings.state', state: makeState() });
      expect(store.state.models.rows).toEqual([]);
      expect(store.state.models.serverDefault).toBeUndefined();
      expect(store.state.preference.status).toBe('none');
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

  /**
   * Protects the live region from announcing a sign-in failure for a refused default model (review
   * W2 of E10-settings-redesign). FABRICATED notice; the wording is checked, not a screen reader.
   */
  it('words a refused model without mentioning sign-in', () => {
    const text = noticeText(
      { integrationID: '', kind: 'modelRefused', message: 'Unknown model' },
      '',
    );
    expect(text).toBe('The default model was not changed. Unknown model');
    expect(text).not.toContain('Sign-in');
  });

  /**
   * Protects the live region from reading out the `mcp_...` id and from mentioning sign-in for a
   * Connect/Disconnect/Retry of an MCP server (issue #186, PR2). FABRICATED notices; the wording is
   * checked, not a screen reader. `message` is appended only for the failure.
   */
  it("words the three MCP notices with the server's name", () => {
    const base = { integrationID: '', server: 'docs' } as const;
    expect(noticeText({ ...base, kind: 'mcpConnected', message: 'ignored' }, 'docs')).toBe(
      'Connected to docs.',
    );
    expect(noticeText({ ...base, kind: 'mcpDisconnected', message: 'ignored' }, 'docs')).toBe(
      'Disconnected from docs.',
    );
    const failed = noticeText({ ...base, kind: 'mcpFailed', message: 'Connection closed' }, 'docs');
    expect(failed).toBe('docs could not be changed. Connection closed');
    expect(failed).not.toContain('Sign-in');
    expect(noticeText({ ...base, kind: 'mcpFailed' }, 'docs')).toBe('docs could not be changed.');
  });

  /** Protects PR3 of issue #186: the two new kinds never mention sign-in. FABRICATED notices. */
  it('words the General setting and mod notices', () => {
    expect(noticeText({ integrationID: '', kind: 'settingFailed', message: 'No write' }, '')).toBe(
      'The setting was not changed. No write',
    );
    expect(noticeText({ integrationID: '', kind: 'modFailed' }, '')).toBe(
      'The mod was not changed.',
    );
  });
});

describe('the shell half of the state', () => {
  /** Protects issue #205: the shell reaches the store, and a row object keeps its identity. FABRICATED states. */
  it('keeps the shell options and their DOM across states', () =>
    createRoot((dispose) => {
      const store = createSettingsStore();
      expect(store.state.shell.loaded).toBe(false);
      const options = [{ value: 'bash', name: 'bash', terminalOnly: false }];
      const shell = {
        loaded: true,
        failed: false,
        writing: false,
        current: 'bash',
        overridden: true,
        options,
      };
      store.apply({ type: 'settings.state', state: makeState({ shell }) });
      expect(store.state.shell.current).toBe('bash');
      expect(store.state.shell.overridden).toBe(true);
      const row = store.state.shell.options[0];
      store.apply({
        type: 'settings.state',
        state: makeState({ shell: { ...shell, writing: true, options: structuredClone(options) } }),
      });
      expect(store.state.shell.writing).toBe(true);
      expect(store.state.shell.options[0]).toBe(row);
      dispose();
    }));
});

describe('the shell notice', () => {
  /** Protects issue #205: the shell notice says what was not changed and appends the host's text. FABRICATED notices. */
  it('words the shell notice', () => {
    expect(
      noticeText({ integrationID: '', kind: 'shellFailed', message: 'Unknown shell' }, ''),
    ).toBe('The shell was not changed. Unknown shell');
    expect(noticeText({ integrationID: '', kind: 'shellFailed' }, '')).toBe(
      'The shell was not changed.',
    );
  });
});

describe('the General and mods halves of the state', () => {
  it('holds general, and keeps the mods listing absent until the host sends it', () =>
    createRoot((dispose) => {
      const store = createSettingsStore();
      expect(store.state.mods).toBeUndefined();
      store.apply({
        type: 'settings.state',
        state: makeState({
          general: {
            chatLocation: { value: 'sidebar', workspaceOverride: true },
            autoStart: { value: false, workspaceOverride: false },
          },
        }),
      });
      expect(store.state.general.chatLocation).toEqual({
        value: 'sidebar',
        workspaceOverride: true,
      });
      expect(store.state.general.autoStart.value).toBe(false);
      expect(store.state.mods).toBeUndefined();
      dispose();
    }));

  it('mods: keeps the identity of a mod row across states, replaces the skipped folders and drops the listing the host stops sending', () =>
    createRoot((dispose) => {
      const store = createSettingsStore();
      store.apply({
        type: 'settings.state',
        state: makeState({ mods: structuredClone(modsListing) }),
      });
      const quiet = store.state.mods?.mods.find((mod) => mod.id === 'quiet');
      const next = structuredClone(modsListing);
      next.mods = next.mods.map((mod) => (mod.id === 'quiet' ? { ...mod, state: 'stopped' } : mod));
      next.skipped = [];
      store.apply({ type: 'settings.state', state: makeState({ mods: next }) });
      expect(store.state.mods?.mods.find((mod) => mod.id === 'quiet')).toBe(quiet);
      expect(quiet?.state).toBe('stopped');
      expect(store.state.mods?.skipped).toEqual([]);
      store.apply({ type: 'settings.state', state: makeState() });
      expect(store.state.mods).toBeUndefined();
      dispose();
    }));
});
