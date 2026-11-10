// Protects against: a broken or hostile settings webview (untrusted input, architecture rule 1)
// getting the host to connect a provider that does not exist, sending form answers the method does
// not declare, or removing a credential that is not the integration's; and against a flood of
// `settings.state` posts when the store, the attempt and the header change in the same tick.
//
// Provenance: FABRICATED store, flows and UI, written from the shapes of `serverConfig.ts` and
// `providerAuth.ts`. They prove the controller's validation and coalescing, not a real panel
// (the `fake-server` suite drives the same controller through `test.settingsMessage`; `test:visual`
// step 36 drives it with real DOM `postMessage` clicks, see the header of `SettingsController`).
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ProviderAuth, type AuthResult, type AuthUi, type ProviderAuthApi } from './providerAuth';
import {
  SETTINGS_ACTION_COMMANDS,
  SettingsController,
  type SettingsAuth,
  type SettingsConfigSource,
  type SettingsControllerDeps,
  type SettingsGeneralSource,
  type SettingsMods,
} from './settingsController';
import type {
  IntegrationRow,
  McpActionResult,
  McpServerRow,
  ServerConfigSnapshot,
} from './serverConfig';
import type { ModsListing } from '../shared/model';
import {
  SETTINGS_ACTIONS,
  type AuthAttemptView,
  type SettingsGeneral,
  type SettingsHostToWebview,
  type SettingsWritableKey,
} from '../shared/settingsProtocol';

const PLANTED_KEY = 'sk-planted-key-777';

const ROWS: IntegrationRow[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    connections: [{ kind: 'credential', id: 'cred_a', label: 'default', method: 'key' }],
    methods: [{ index: 0, type: 'key', label: 'API key', fields: [], supported: true }],
  },
  {
    id: 'azure',
    name: 'Azure',
    connections: [{ kind: 'env', name: 'AZURE_KEY' }],
    methods: [
      {
        index: 0,
        type: 'key',
        label: 'API key',
        fields: [{ key: 'resourceName', required: true }],
        supported: true,
      },
    ],
  },
];

const MODELS: ServerConfigSnapshot['models'] = {
  loaded: true,
  failed: false,
  rows: [
    {
      providerID: 'anthropic',
      id: 'claude-sonnet',
      name: 'Claude Sonnet',
      providerName: 'Anthropic',
      integrationID: 'anthropic',
    },
    {
      providerID: 'anthropic',
      id: 'claude-haiku',
      name: 'Claude Haiku',
      providerName: 'Anthropic',
    },
    { providerID: 'openrouter', id: 'meta/llama', name: 'Llama', providerName: 'OpenRouter' },
  ],
  serverDefault: { providerID: 'anthropic', id: 'claude-sonnet', name: 'Claude Sonnet' },
};

function snapshotOf(
  rows: IntegrationRow[],
  models: ServerConfigSnapshot['models'],
  servers: McpServerRow[] = [],
): ServerConfigSnapshot {
  return {
    epoch: 1,
    integrations: { loaded: true, failed: false, rows },
    models,
    mcp: { loaded: true, failed: false, pendingFirstRead: false, servers },
  };
}

function setup(
  rows: IntegrationRow[] = ROWS,
  models: ServerConfigSnapshot['models'] = MODELS,
  initialPreference: { value: string; workspaceOverride: boolean } = {
    value: '',
    workspaceOverride: false,
  },
  initialServers: McpServerRow[] = [],
  mods?: SettingsMods,
) {
  let servers = initialServers;
  let preference = initialPreference;
  let general: SettingsGeneral = {
    chatLocation: { value: 'editor', workspaceOverride: false },
    autoStart: { value: true, workspaceOverride: false },
  };
  const generalSource = {
    read: vi.fn(() => general),
    write: vi.fn((key: SettingsWritableKey, value: string | boolean) => {
      general =
        key === 'chatLocation'
          ? {
              ...general,
              chatLocation: {
                ...general.chatLocation,
                value: value === 'sidebar' ? 'sidebar' : 'editor',
              },
            }
          : { ...general, autoStart: { ...general.autoStart, value: value === true } };
      return Promise.resolve();
    }),
  } satisfies SettingsGeneralSource;
  const preferences = {
    read: vi.fn(() => preference),
    write: vi.fn((value: string | undefined) => {
      preference = { ...preference, value: value ?? '' };
      return Promise.resolve();
    }),
  };
  const openSetting = vi.fn();
  const posted: SettingsHostToWebview[] = [];
  const storeListeners = new Set<() => void>();
  const attemptListeners = new Set<(view: AuthAttemptView | undefined) => void>();
  let attempt: AuthAttemptView | undefined;
  const config = {
    snapshot: vi.fn(() => snapshotOf(rows, models, servers)),
    onDidChange: (listener: () => void) => {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
    reloadAll: vi.fn(() => Promise.resolve()),
    mcpAction: vi.fn((_server: string, _op: 'connect' | 'disconnect'): Promise<McpActionResult> =>
      Promise.resolve({ kind: 'done' }),
    ),
  } satisfies SettingsConfigSource;
  const auth = {
    connect: vi.fn(
      (
        _row: IntegrationRow,
        _index: number,
        _answer: Readonly<Record<string, string>>,
      ): Promise<AuthResult> => Promise.resolve({ kind: 'connected' }),
    ),
    cancel: vi.fn(() => Promise.resolve()),
    copyCode: vi.fn((_id: string) => Promise.resolve(true)),
    disconnect: vi.fn((_row: IntegrationRow, _id: string) =>
      Promise.resolve({ kind: 'removed' } as const),
    ),
    attempt: vi.fn(() => attempt),
    onDidChangeAttempt: (listener: (view: AuthAttemptView | undefined) => void) => {
      attemptListeners.add(listener);
      return () => attemptListeners.delete(listener);
    },
  } satisfies SettingsAuth;
  const runAction = vi.fn();
  let remote: string | undefined;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const deps: SettingsControllerDeps = {
    config,
    auth,
    preferences,
    general: generalSource,
    ...(mods === undefined ? {} : { mods }),
    openSetting,
    post: (message) => posted.push(message),
    header: () => ({
      connection: { state: 'connected', serverVersion: '2.0.32' },
      folder: 'work',
      serverVersion: '2.0.32',
      ...(remote === undefined ? {} : { remote }),
    }),
    runAction,
    log,
  };
  const controller = new SettingsController(deps);
  return {
    controller,
    posted,
    config,
    auth,
    preferences,
    generalSource,
    setGeneral: (next: SettingsGeneral) => {
      general = next;
    },
    openSetting,
    runAction,
    log,
    setRemote: (name: string | undefined) => {
      remote = name;
    },
    /** Replaces the MCP rows the next `snapshot()` returns (what a re-read would bring). */
    setServers: (next: McpServerRow[]) => {
      servers = next;
    },
    changeStore: () => storeListeners.forEach((listener) => listener()),
    setAttempt: (view: AuthAttemptView | undefined) => {
      attempt = view;
      attemptListeners.forEach((listener) => listener(view));
    },
  };
}

const states = (posted: SettingsHostToWebview[]) =>
  posted.filter((message) => message.type === 'settings.state');
const notices = (posted: SettingsHostToWebview[]) =>
  posted.flatMap((message) => (message.type === 'settings.notice' ? [message.notice] : []));

describe('SettingsController state', () => {
  it('answers ready with the whole state: header, providers, mcp and the attempt', async () => {
    const t = setup();
    t.setAttempt({
      integrationID: 'azure',
      phase: 'waiting',
      instructions: 'Enter code: AB-12',
      code: 'AB-12',
    });
    await t.controller.onMessage({ type: 'settings.ready' });
    const [state] = states(t.posted);
    expect(state).toMatchObject({
      type: 'settings.state',
      state: {
        connection: { state: 'connected', serverVersion: '2.0.32' },
        folder: 'work',
        serverVersion: '2.0.32',
        providers: { loaded: true, failed: false },
        mcp: { loaded: true, pendingFirstRead: false, servers: [] },
        attempt: { integrationID: 'azure', phase: 'waiting', code: 'AB-12' },
      },
    });
    expect(JSON.stringify(t.posted)).not.toContain('apiKey');
  });

  // Protects the remote hint of the card: `remote` travels host to webview only when the window is
  // remote, and its absence (a local window) must stay absent, not become an empty string.
  // Provenance: FABRICATED header; the real `vscode.env.remoteName` is read in `chatLifecycle.ts`.
  it('carries the remote name in the state only when the header has one', async () => {
    const t = setup();
    await t.controller.onMessage({ type: 'settings.ready' });
    expect('remote' in t.controller.buildState()).toBe(false);
    t.setRemote('ssh-remote');
    expect(t.controller.buildState().remote).toBe('ssh-remote');
    t.setRemote(undefined);
    expect('remote' in t.controller.buildState()).toBe(false);
  });

  it('posts nothing before ready, and ONE state for changes of the same tick after it', async () => {
    const t = setup();
    t.changeStore();
    await Promise.resolve();
    expect(t.posted).toHaveLength(0);
    t.controller.onReady();
    expect(states(t.posted)).toHaveLength(1);
    t.changeStore();
    t.changeStore();
    t.setAttempt({ integrationID: 'azure', phase: 'starting' });
    t.controller.changed();
    expect(states(t.posted)).toHaveLength(1);
    await Promise.resolve();
    expect(states(t.posted)).toHaveLength(2);
    t.changeStore();
    await Promise.resolve();
    expect(states(t.posted)).toHaveLength(3);
  });

  it('stops posting after the webview closes or the controller is disposed', async () => {
    const t = setup();
    t.controller.onReady();
    t.controller.onClosed();
    t.changeStore();
    await Promise.resolve();
    expect(states(t.posted)).toHaveLength(1);
    t.controller.onReady();
    t.controller.dispose();
    t.changeStore();
    await Promise.resolve();
    expect(states(t.posted)).toHaveLength(2);
  });
});

describe('SettingsController requests', () => {
  it('drops a message that carries a key or any unknown property, and calls nothing', async () => {
    const t = setup();
    await t.controller.onMessage({
      type: 'settings.connect',
      integrationID: 'azure',
      method: 0,
      answer: {},
      key: PLANTED_KEY,
    });
    await t.controller.onMessage({ type: 'settings.nope' });
    expect(t.auth.connect).not.toHaveBeenCalled();
    expect(t.posted).toHaveLength(0);
    expect(t.log.warn).toHaveBeenCalledWith('settings message dropped: invalid');
    expect(JSON.stringify(t.log.warn.mock.calls)).not.toContain(PLANTED_KEY);
  });

  it('refuses an unknown integration or method without starting a flow', async () => {
    const t = setup();
    await t.controller.onMessage({
      type: 'settings.connect',
      integrationID: 'ghost',
      method: 0,
      answer: {},
    });
    await t.controller.onMessage({
      type: 'settings.connect',
      integrationID: 'azure',
      method: 5,
      answer: {},
    });
    expect(t.auth.connect).not.toHaveBeenCalled();
    expect(notices(t.posted).map((notice) => notice.kind)).toEqual(['failed', 'failed']);
  });

  /**
   * Protects W3 of the review: an integration with no method is refused (the card offers nothing
   * and points to `opencode auth login`), so the host has no dead "API key for index 0" branch.
   * Fabricated row on fake flows.
   */
  it('refuses a connect to an integration that declares no method', async () => {
    const t = setup([{ id: 'bare', name: 'Bare', connections: [], methods: [] }]);
    await t.controller.onMessage({
      type: 'settings.connect',
      integrationID: 'bare',
      method: 0,
      answer: {},
    });
    expect(t.auth.connect).not.toHaveBeenCalled();
    expect(notices(t.posted).map((notice) => notice.kind)).toEqual(['failed']);
  });

  it('keeps only the answers the method declares, then reports "Connected to X"', async () => {
    const t = setup();
    await t.controller.onMessage({
      type: 'settings.connect',
      integrationID: 'azure',
      method: 0,
      answer: { resourceName: 'res', apiToken: PLANTED_KEY, __proto__: 'x' },
    });
    expect(t.auth.connect).toHaveBeenCalledWith(ROWS[1], 0, { resourceName: 'res' });
    expect(notices(t.posted)).toEqual([
      { integrationID: 'azure', kind: 'connected', message: 'Connected to Azure' },
    ]);
  });

  it('turns each result of the flow into a notice', async () => {
    const t = setup();
    const connect = {
      type: 'settings.connect',
      integrationID: 'anthropic',
      method: 0,
      answer: {},
    };
    t.auth.connect.mockResolvedValueOnce({ kind: 'failed', message: 'bad' });
    t.auth.connect.mockResolvedValueOnce({ kind: 'expired' });
    t.auth.connect.mockResolvedValueOnce({ kind: 'cancelled' });
    t.auth.connect.mockResolvedValueOnce({ kind: 'unsupported', message: 'Use the CLI' });
    for (let i = 0; i < 4; i++) await t.controller.onMessage(connect);
    expect(notices(t.posted).map((notice) => [notice.kind, notice.message])).toEqual([
      ['failed', 'bad'],
      ['expired', 'The sign-in expired'],
      ['cancelled', undefined],
      ['unsupported', 'Use the CLI'],
    ]);
  });

  it('cancels only the sign-in of that integration, copies its code, refreshes and runs actions', async () => {
    const t = setup();
    t.setAttempt({ integrationID: 'azure', phase: 'waiting' });
    await t.controller.onMessage({ type: 'settings.cancel', integrationID: 'anthropic' });
    expect(t.auth.cancel).not.toHaveBeenCalled();
    await t.controller.onMessage({ type: 'settings.cancel', integrationID: 'azure' });
    expect(t.auth.cancel).toHaveBeenCalledOnce();
    await t.controller.onMessage({ type: 'settings.copyCode', integrationID: 'azure' });
    expect(t.auth.copyCode).toHaveBeenCalledWith('azure');
    await t.controller.onMessage({ type: 'settings.refresh' });
    expect(t.config.reloadAll).toHaveBeenCalledOnce();
    await t.controller.onMessage({ type: 'settings.action', action: 'logs' });
    expect(t.runAction).toHaveBeenCalledWith('logs');
  });

  it('removes only a credential among the integration connections', async () => {
    const t = setup();
    const remove = (integrationID: string, credentialID: string) =>
      t.controller.onMessage({ type: 'settings.disconnect', integrationID, credentialID });
    await remove('anthropic', 'cred_other');
    await remove('azure', 'cred_a');
    await remove('azure', 'AZURE_KEY');
    await remove('ghost', 'cred_a');
    expect(t.auth.disconnect).not.toHaveBeenCalled();
    expect(notices(t.posted).map((notice) => notice.kind)).toEqual([
      'failed',
      'failed',
      'failed',
      'failed',
    ]);
    await remove('anthropic', 'cred_a');
    expect(t.auth.disconnect).toHaveBeenCalledWith(ROWS[0], 'cred_a');
    expect(notices(t.posted).at(-1)).toEqual({
      integrationID: 'anthropic',
      kind: 'removed',
      message: 'Removed from Anthropic',
    });
  });

  it('never lets a request throw, and logs only the type and the error name', async () => {
    const t = setup();
    t.config.reloadAll.mockRejectedValueOnce(new TypeError(`boom ${PLANTED_KEY}`));
    await t.controller.onMessage({ type: 'settings.refresh' });
    expect(t.log.warn).toHaveBeenCalledWith('settings request failed: settings.refresh: TypeError');
  });
});

describe('SettingsController with the real ProviderAuth', () => {
  it('asks the native confirmation before it removes, and never removes a foreign credential', async () => {
    const remove = vi.fn((_input: unknown) => Promise.resolve());
    const api = { credential: { remove } } as unknown as ProviderAuthApi;
    const confirm = vi.fn((_prompt: { message: string; action: string }) => Promise.resolve(false));
    const ui = { confirm } as unknown as AuthUi;
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const auth = new ProviderAuth(log, ui);
    auth.attach(api);
    const t = setup();
    const controller = new SettingsController({
      config: t.config,
      auth,
      preferences: t.preferences,
      general: t.generalSource,
      openSetting: t.openSetting,
      post: () => undefined,
      header: () => ({ connection: { state: 'starting' }, folder: 'work' }),
      runAction: () => undefined,
      log,
    });
    await controller.onMessage({
      type: 'settings.disconnect',
      integrationID: 'anthropic',
      credentialID: 'cred_a',
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(true);
    await controller.onMessage({
      type: 'settings.disconnect',
      integrationID: 'anthropic',
      credentialID: 'cred_a',
    });
    expect(remove).toHaveBeenCalledWith({ credentialID: 'cred_a' });
    await controller.onMessage({
      type: 'settings.disconnect',
      integrationID: 'anthropic',
      credentialID: 'cred_zzz',
    });
    expect(remove).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});

/**
 * Protects issue #186: the default-model picker must write the USER setting only for a model the
 * catalog offers, once, and never from a text the webview invented; the state must say where the
 * setting stands; and an MCP integration must not show up as a provider. Provenance: FABRICATED
 * snapshot and `preferences`, written from `serverConfig.ts` and `modelPreference.ts`; the real
 * write to the profile is the `fake-server` case of phase 1.3.
 */
describe('SettingsController default model', () => {
  const stateOf = (t: ReturnType<typeof setup>) => {
    const last = states(t.posted).at(-1);
    return last?.type === 'settings.state' ? last.state : undefined;
  };

  it('writes a model the catalog offers once, as provider/id, and publishes the state', async () => {
    const t = setup();
    await t.controller.onMessage({ type: 'settings.ready' });
    await t.controller.onMessage({
      type: 'settings.setDefaultModel',
      model: '  anthropic/claude-haiku ',
    });
    expect(t.preferences.write).toHaveBeenCalledOnce();
    expect(t.preferences.write).toHaveBeenCalledWith('anthropic/claude-haiku');
    await Promise.resolve();
    expect(stateOf(t)?.preference).toEqual({
      value: 'anthropic/claude-haiku',
      status: 'applied',
      workspaceOverride: false,
    });
    expect(notices(t.posted)).toEqual([]);
  });

  it('keeps a slash inside the model id (openrouter/meta/llama)', async () => {
    const t = setup();
    await t.controller.onMessage({
      type: 'settings.setDefaultModel',
      model: 'openrouter/meta/llama',
    });
    expect(t.preferences.write).toHaveBeenCalledWith('openrouter/meta/llama');
  });

  it('clears the setting on an empty text', async () => {
    const t = setup(ROWS, MODELS, { value: 'anthropic/claude-haiku', workspaceOverride: false });
    await t.controller.onMessage({ type: 'settings.ready' });
    await t.controller.onMessage({ type: 'settings.setDefaultModel', model: '   ' });
    expect(t.preferences.write).toHaveBeenCalledWith(undefined);
    await Promise.resolve();
    expect(stateOf(t)?.preference.status).toBe('none');
  });

  it('refuses an unparsable, an unknown and a not offered model: no write, a notice, one log line', async () => {
    const t = setup();
    for (const model of ['claude', 'anthropic/', 'anthropic/not-a-model', 'azure/gpt-5']) {
      await t.controller.onMessage({ type: 'settings.setDefaultModel', model });
    }
    expect(t.preferences.write).not.toHaveBeenCalled();
    expect(notices(t.posted).map((n) => n.kind)).toEqual([
      'modelRefused',
      'modelRefused',
      'modelRefused',
      'modelRefused',
    ]);
    expect(t.log.warn).toHaveBeenCalledTimes(4);
    for (const call of t.log.warn.mock.calls) {
      expect(String(call[0])).toMatch(/^settings request refused: settings\.setDefaultModel: /);
      expect(String(call[0])).not.toContain('azure');
    }
  });

  /**
   * Protects review W1 of E10-settings-redesign: the native select already shows the refused pick,
   * so a refusal must be followed by a fresh `settings.state` that puts the saved value back.
   * FABRICATED snapshot and `preferences`.
   */
  it('asks for a fresh state after a refused model', async () => {
    const t = setup();
    await t.controller.onMessage({ type: 'settings.ready' });
    const before = states(t.posted).length;
    await t.controller.onMessage({ type: 'settings.setDefaultModel', model: 'azure/gpt-5' });
    expect(states(t.posted).length).toBe(before + 1);
  });

  /**
   * Protects review W1: a `preferences.write` that throws used to leave only a log line. Now the
   * webview gets a `modelRefused` notice and the state. FABRICATED rejection; a real profile
   * write failure was not provoked.
   */
  it('tells the webview when the write throws', async () => {
    const t = setup();
    await t.controller.onMessage({ type: 'settings.ready' });
    const before = states(t.posted).length;
    t.preferences.write.mockRejectedValueOnce(new Error('EACCES'));
    await t.controller.onMessage({
      type: 'settings.setDefaultModel',
      model: 'anthropic/claude-haiku',
    });
    expect(notices(t.posted).map((n) => n.kind)).toEqual(['modelRefused']);
    expect(states(t.posted).length).toBe(before + 1);
    expect(String(t.log.warn.mock.calls.at(-1)?.[0])).not.toContain('EACCES');
  });

  it('derives the status and the workspace override from the setting and the catalog', async () => {
    const cases: [string, string][] = [
      ['', 'none'],
      ['anthropic/claude-haiku', 'applied'],
      ['not-written-right', 'invalid'],
      ['anthropic/gone', 'unavailable'],
    ];
    for (const [value, status] of cases) {
      const t = setup(ROWS, MODELS, { value, workspaceOverride: true });
      await t.controller.onMessage({ type: 'settings.ready' });
      expect(stateOf(t)?.preference).toEqual({ value, status, workspaceOverride: true });
    }
  });

  it('sends the models and the server default, with no field beyond the four of a row', async () => {
    const t = setup();
    await t.controller.onMessage({ type: 'settings.ready' });
    expect(stateOf(t)?.models).toEqual({
      loaded: true,
      failed: false,
      rows: [
        {
          providerID: 'anthropic',
          id: 'claude-sonnet',
          name: 'Claude Sonnet',
          providerName: 'Anthropic',
        },
        {
          providerID: 'anthropic',
          id: 'claude-haiku',
          name: 'Claude Haiku',
          providerName: 'Anthropic',
        },
        { providerID: 'openrouter', id: 'meta/llama', name: 'Llama', providerName: 'OpenRouter' },
      ],
      serverDefault: { providerID: 'anthropic', id: 'claude-sonnet', name: 'Claude Sonnet' },
    });
  });

  it('counts the models of each provider only once the models were read', async () => {
    const t = setup();
    await t.controller.onMessage({ type: 'settings.ready' });
    expect(stateOf(t)?.providers.rows.map((row) => [row.id, row.modelCount])).toEqual([
      ['anthropic', 2],
      ['azure', 0],
    ]);
    const unread = setup(ROWS, { loaded: false, failed: false, rows: [] });
    await unread.controller.onMessage({ type: 'settings.ready' });
    for (const row of stateOf(unread)?.providers.rows ?? []) {
      expect('modelCount' in row).toBe(false);
    }
  });

  it('leaves the integrations of an MCP server out of the providers', async () => {
    const rows: IntegrationRow[] = [
      ...ROWS,
      { id: 'mcp_ab12', name: 'linear', connections: [], methods: [], source: 'mcp' },
    ];
    const t = setup(rows);
    await t.controller.onMessage({ type: 'settings.ready' });
    expect(stateOf(t)?.providers.rows.map((row) => row.id)).toEqual(['anthropic', 'azure']);
    expect(JSON.stringify(t.posted)).not.toContain('mcp_ab12');
  });

  it('opens a setting of the closed list and nothing else', async () => {
    const t = setup();
    await t.controller.onMessage({ type: 'settings.openSetting', key: 'defaultModel' });
    expect(t.openSetting).toHaveBeenCalledExactlyOnceWith('defaultModel');
    await t.controller.onMessage({ type: 'settings.openSetting', key: 'editor.fontSize' });
    expect(t.openSetting).toHaveBeenCalledOnce();
    expect(t.log.warn).toHaveBeenCalledWith('settings message dropped: invalid');
  });
});

/**
 * Protects issue #186 (PR2): the webview may connect, disconnect and sign in to an MCP server only
 * when the host's own snapshot allows it (the server exists, its state permits the operation, nothing
 * else of it is running), never reaches the add/remove routes, and the notice names what the server
 * BECAME after the change, not what was asked. Provenance: FABRICATED snapshot, `mcpAction` and
 * `auth` written from `serverConfig.ts` and `providerAuth.ts`; nothing here touches a server. The
 * `mcp_0123456789abcdef` id has the shape of the one read in `core/src/mcp/index.ts` of the 2.0.32
 * tag and is invented.
 */
describe('SettingsController MCP requests', () => {
  const INTEGRATION = 'mcp_0123456789abcdef';
  const LINEAR_METHOD: IntegrationRow['methods'][number] = {
    index: 0,
    type: 'oauth',
    id: INTEGRATION,
    label: 'linear',
    fields: [],
    supported: true,
  };
  const LINEAR_ROW: IntegrationRow = {
    id: INTEGRATION,
    name: 'linear',
    connections: [],
    methods: [LINEAR_METHOD],
    source: 'mcp',
  };
  const server = (
    name: string,
    status: McpServerRow['status'],
    extra: Partial<McpServerRow> = {},
  ): McpServerRow => ({ name, status, resources: [], templates: [], ...extra });
  const SERVERS: McpServerRow[] = [
    server('docs', 'connected'),
    server('slow', 'pending'),
    server('off', 'disabled'),
    server('broken', 'failed', { error: 'Connection closed', detail: 'Connection closed\nmore' }),
    server('linear', 'needs_auth', { error: 'Sign in', integrationID: INTEGRATION }),
  ];
  const withServers = (
    rows: IntegrationRow[] = [...ROWS, LINEAR_ROW],
    list: McpServerRow[] = SERVERS,
  ) => setup(rows, MODELS, { value: '', workspaceOverride: false }, list);
  const stateOf = (t: ReturnType<typeof setup>) => {
    const last = states(t.posted).at(-1);
    return last?.type === 'settings.state' ? last.state : undefined;
  };
  const rowOf = (t: ReturnType<typeof setup>, name: string) =>
    stateOf(t)?.mcp.servers.find((row) => row.name === name);

  it('marks canSignIn and integrationID only with an mcp integration row and an oauth method', async () => {
    const t = withServers();
    await t.controller.onMessage({ type: 'settings.ready' });
    expect(rowOf(t, 'linear')).toMatchObject({ canSignIn: true, integrationID: INTEGRATION });
    expect(rowOf(t, 'broken')).toMatchObject({
      canSignIn: false,
      detail: 'Connection closed\nmore',
    });
    expect('integrationID' in (rowOf(t, 'docs') ?? {})).toBe(false);

    // The id names a row that is not marked `source: 'mcp'`: no sign-in, and no id passed on.
    const { source: _source, ...unmarked } = LINEAR_ROW;
    const notMcp = withServers([...ROWS, unmarked]);
    await notMcp.controller.onMessage({ type: 'settings.ready' });
    expect(rowOf(notMcp, 'linear')?.canSignIn).toBe(false);
    expect('integrationID' in (rowOf(notMcp, 'linear') ?? {})).toBe(false);

    // An oauth method the tab cannot run, no integration row at all, a server not asking for auth.
    const unsupported = withServers([
      ...ROWS,
      { ...LINEAR_ROW, methods: [{ ...LINEAR_METHOD, supported: false }] },
    ]);
    await unsupported.controller.onMessage({ type: 'settings.ready' });
    expect(rowOf(unsupported, 'linear')?.canSignIn).toBe(false);
    const nobody = withServers([...ROWS]);
    await nobody.controller.onMessage({ type: 'settings.ready' });
    expect(rowOf(nobody, 'linear')?.canSignIn).toBe(false);
    const connected = withServers(undefined, [
      server('linear', 'connected', { integrationID: INTEGRATION }),
    ]);
    await connected.controller.onMessage({ type: 'settings.ready' });
    expect(rowOf(connected, 'linear')?.canSignIn).toBe(false);
  });

  it('allows connect from disabled and failed, disconnect from connected and pending, and nothing else', async () => {
    const allowed: [string, 'connect' | 'disconnect'][] = [
      ['off', 'connect'],
      ['broken', 'connect'],
      ['docs', 'disconnect'],
      ['slow', 'disconnect'],
    ];
    for (const [name, op] of allowed) {
      const t = withServers();
      await t.controller.onMessage({ type: 'settings.mcp', server: name, op });
      expect(t.config.mcpAction, `${op} ${name}`).toHaveBeenCalledExactlyOnceWith(name, op);
    }
    const refused: [string, 'connect' | 'disconnect'][] = [
      ['docs', 'connect'],
      ['slow', 'connect'],
      ['linear', 'connect'],
      ['linear', 'disconnect'],
      ['off', 'disconnect'],
      ['broken', 'disconnect'],
      ['ghost', 'connect'],
      ['ghost', 'disconnect'],
    ];
    for (const [name, op] of refused) {
      const t = withServers();
      await t.controller.onMessage({ type: 'settings.mcp', server: name, op });
      expect(t.config.mcpAction, `${op} ${name}`).not.toHaveBeenCalled();
      expect(t.log.warn, `${op} ${name}`).toHaveBeenCalledWith(
        expect.stringMatching(/^settings request refused: settings\.mcp: /),
      );
      expect(notices(t.posted), `${op} ${name}`).toMatchObject([
        { integrationID: '', kind: 'mcpFailed', server: name },
      ]);
    }
  });

  it('refuses a second request for a server whose first has not finished', async () => {
    const t = withServers();
    let finish: (result: McpActionResult) => void = () => undefined;
    t.config.mcpAction.mockImplementationOnce(
      () =>
        new Promise<McpActionResult>((resolve) => {
          finish = resolve;
        }),
    );
    const first = t.controller.onMessage({ type: 'settings.mcp', server: 'off', op: 'connect' });
    await t.controller.onMessage({ type: 'settings.mcp', server: 'off', op: 'connect' });
    expect(t.config.mcpAction).toHaveBeenCalledOnce();
    expect(t.log.warn).toHaveBeenCalledWith(
      'settings request refused: settings.mcp: another request in progress',
    );
    t.setServers([server('off', 'connected'), ...SERVERS.slice(1)]);
    finish({ kind: 'done' });
    await first;
    // The busy mark is gone: the same server may be asked again (now it can be disconnected).
    await t.controller.onMessage({ type: 'settings.mcp', server: 'off', op: 'disconnect' });
    expect(t.config.mcpAction).toHaveBeenCalledTimes(2);
  });

  it('words the notice by the state read after the change', async () => {
    const cases: [McpServerRow, string, 'connect' | 'disconnect', Record<string, unknown>][] = [
      [server('off', 'connected'), 'off', 'connect', { kind: 'mcpConnected', server: 'off' }],
      [
        server('docs', 'disabled'),
        'docs',
        'disconnect',
        { kind: 'mcpDisconnected', server: 'docs' },
      ],
      [
        server('broken', 'failed', { error: 'Boom' }),
        'broken',
        'connect',
        { kind: 'mcpFailed', server: 'broken', message: 'Boom' },
      ],
      [
        server('off', 'needs_auth', { error: 'Sign in' }),
        'off',
        'connect',
        { kind: 'mcpFailed', server: 'off', message: 'Sign in' },
      ],
    ];
    for (const [after, name, op, expected] of cases) {
      const t = withServers();
      t.config.mcpAction.mockImplementationOnce(() => {
        t.setServers([after]);
        return Promise.resolve({ kind: 'done' });
      });
      await t.controller.onMessage({ type: 'settings.mcp', server: name, op });
      expect(notices(t.posted), `${op} ${name} -> ${after.status}`).toMatchObject([
        { integrationID: '', ...expected },
      ]);
    }
    // Still connecting: nothing yet, the stream will move the row. A server that left: a failure.
    const pending = withServers();
    pending.config.mcpAction.mockImplementationOnce(() => {
      pending.setServers([server('off', 'pending')]);
      return Promise.resolve({ kind: 'done' });
    });
    await pending.controller.onMessage({ type: 'settings.mcp', server: 'off', op: 'connect' });
    expect(notices(pending.posted)).toEqual([]);
    const gone = withServers();
    gone.config.mcpAction.mockImplementationOnce(() => {
      gone.setServers([]);
      return Promise.resolve({ kind: 'done' });
    });
    await gone.controller.onMessage({ type: 'settings.mcp', server: 'off', op: 'connect' });
    expect(notices(gone.posted)).toMatchObject([{ kind: 'mcpFailed', server: 'off' }]);
  });

  it('turns a failed call into an mcpFailed notice with the message it was given', async () => {
    const t = withServers();
    t.config.mcpAction.mockResolvedValueOnce({
      kind: 'failed',
      message: 'Server is gone',
      notFound: true,
    });
    await t.controller.onMessage({ type: 'settings.mcp', server: 'off', op: 'connect' });
    expect(notices(t.posted)).toEqual([
      { integrationID: '', kind: 'mcpFailed', server: 'off', message: 'Server is gone' },
    ]);
  });

  it('signs in through the mcp integration row and its oauth method, and names the ending', async () => {
    const t = withServers();
    await t.controller.onMessage({ type: 'settings.mcpSignIn', server: 'linear' });
    expect(t.auth.connect).toHaveBeenCalledExactlyOnceWith(LINEAR_ROW, 0, {});
    expect(notices(t.posted)).toMatchObject([{ integrationID: INTEGRATION, kind: 'connected' }]);
    t.auth.connect.mockResolvedValueOnce({ kind: 'cancelled' });
    await t.controller.onMessage({ type: 'settings.mcpSignIn', server: 'linear' });
    expect(notices(t.posted).at(-1)).toMatchObject({
      integrationID: INTEGRATION,
      kind: 'cancelled',
    });
  });

  it('refuses a sign-in without an integration, in another state, for a ghost, or while busy', async () => {
    const attempts: [ReturnType<typeof setup>, string][] = [
      [withServers([...ROWS]), 'linear'],
      [withServers(), 'docs'],
      [withServers(), 'broken'],
      [withServers(), 'ghost'],
    ];
    for (const [t, name] of attempts) {
      await t.controller.onMessage({ type: 'settings.mcpSignIn', server: name });
      expect(t.auth.connect, name).not.toHaveBeenCalled();
      expect(t.log.warn, name).toHaveBeenCalledWith(
        expect.stringMatching(/^settings request refused: settings\.mcpSignIn: /),
      );
      expect(notices(t.posted), name).toMatchObject([
        { integrationID: '', kind: 'mcpFailed', server: name },
      ]);
    }
    const busy = withServers();
    let finish: (result: AuthResult) => void = () => undefined;
    busy.auth.connect.mockImplementationOnce(
      () =>
        new Promise<AuthResult>((resolve) => {
          finish = resolve;
        }),
    );
    const first = busy.controller.onMessage({ type: 'settings.mcpSignIn', server: 'linear' });
    await busy.controller.onMessage({ type: 'settings.mcpSignIn', server: 'linear' });
    expect(busy.auth.connect).toHaveBeenCalledOnce();
    finish({ kind: 'connected' });
    await first;
  });

  it('keeps the mcp integration out of the providers while it signs in', async () => {
    const t = withServers();
    await t.controller.onMessage({ type: 'settings.ready' });
    expect(stateOf(t)?.providers.rows.some((row) => row.id.startsWith('mcp_'))).toBe(false);
  });
});

/** A fabricated mods half: a listing that tests replace, and the change listeners it fires. */
function makeMods(listing: ModsListing) {
  const listeners = new Set<() => void>();
  const toggle = vi.fn((_modId: string, _enabled: boolean): Promise<void> => Promise.resolve());
  const mods: SettingsMods = {
    state: () => ({ bands: [], commands: [], listing }),
    toggle,
    onDidChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  return {
    mods,
    toggle,
    listeners,
    fire: () => listeners.forEach((listener) => listener()),
  };
}

const LISTING: ModsListing = {
  enabled: true,
  persisted: true,
  mods: [{ id: 'quiet', name: 'Quiet', version: '1.0.0', enabled: true, state: 'active' }],
  skipped: [],
};

// Protects PR3 of issue #186: the General settings and the mods listing travel in the state, a
// write of `chatLocation` or `autoStart` happens ONCE and never keeps a value the setting does not
// hold, a mod switch goes through the same `toggle` as the chat's `mod.toggle`, and a refusal tells
// the webview without ever logging text of the mod or the value. FABRICATED `general` and mods half.
describe('SettingsController general settings and mods', () => {
  const noPreference = { value: '', workspaceOverride: false };

  it('carries general in the state, and mods only when a mods half was given', () => {
    const without = setup();
    expect(without.controller.buildState().general).toEqual({
      chatLocation: { value: 'editor', workspaceOverride: false },
      autoStart: { value: true, workspaceOverride: false },
    });
    expect('mods' in without.controller.buildState()).toBe(false);
    const m = makeMods(LISTING);
    const withMods = setup(ROWS, MODELS, noPreference, [], m.mods);
    withMods.setGeneral({
      chatLocation: { value: 'sidebar', workspaceOverride: true },
      autoStart: { value: false, workspaceOverride: false },
    });
    const state = withMods.controller.buildState();
    expect(state.general.chatLocation).toEqual({ value: 'sidebar', workspaceOverride: true });
    expect(state.mods).toEqual(LISTING);
  });

  it('writes the user setting once and asks for a fresh state', async () => {
    const t = setup();
    t.controller.onReady();
    t.posted.length = 0;
    await t.controller.onMessage({
      type: 'settings.setSetting',
      key: 'chatLocation',
      value: 'sidebar',
    });
    await t.controller.onMessage({ type: 'settings.setSetting', key: 'autoStart', value: false });
    expect(t.generalSource.write.mock.calls).toEqual([
      ['chatLocation', 'sidebar'],
      ['autoStart', false],
    ]);
    await Promise.resolve();
    // One state per write (the two requests were awaited one after the other, so their
    // microtasks did not coalesce).
    expect(states(t.posted)).toHaveLength(2);
    expect(t.controller.buildState().general).toEqual({
      chatLocation: { value: 'sidebar', workspaceOverride: false },
      autoStart: { value: false, workspaceOverride: false },
    });
    expect(notices(t.posted)).toEqual([]);
  });

  it('refuses a key or a value outside the pair and writes nothing', async () => {
    const t = setup();
    for (const bad of [
      { type: 'settings.setSetting', key: 'opencodePath', value: 'x' },
      { type: 'settings.setSetting', key: 'chatLocation', value: true },
      { type: 'settings.setSetting', key: 'autoStart', value: 'yes' },
    ]) {
      await t.controller.onMessage(bad);
    }
    expect(t.generalSource.write).not.toHaveBeenCalled();
    expect(t.log.warn).toHaveBeenCalledTimes(3);
  });

  it('tells the webview when the write throws, without the value', async () => {
    const t = setup();
    t.controller.onReady();
    t.posted.length = 0;
    t.generalSource.write.mockRejectedValueOnce(new TypeError('cannot write sidebar'));
    await t.controller.onMessage({
      type: 'settings.setSetting',
      key: 'chatLocation',
      value: 'sidebar',
    });
    await Promise.resolve();
    expect(t.log.warn).toHaveBeenCalledWith(
      'settings request failed: settings.setSetting: TypeError',
    );
    expect(JSON.stringify(t.log.warn.mock.calls)).not.toContain('sidebar');
    expect(notices(t.posted)).toMatchObject([{ kind: 'settingFailed' }]);
    expect(states(t.posted)).toHaveLength(1);
  });

  it('switches a mod through the mods half and says nothing on success', async () => {
    const m = makeMods(LISTING);
    const t = setup(ROWS, MODELS, noPreference, [], m.mods);
    t.controller.onReady();
    t.posted.length = 0;
    await t.controller.onMessage({ type: 'settings.modToggle', modId: 'quiet', enabled: false });
    expect(m.toggle).toHaveBeenCalledExactlyOnceWith('quiet', false);
    expect(notices(t.posted)).toEqual([]);
    // The state comes from the mods half's own change event, coalesced.
    m.fire();
    m.fire();
    await Promise.resolve();
    expect(states(t.posted)).toHaveLength(1);
  });

  it('refuses a mod the discovery does not know with a notice and a log without text of the mod', async () => {
    const m = makeMods(LISTING);
    m.toggle.mockRejectedValueOnce(new RangeError('no such mod: secret-mod-text'));
    const t = setup(ROWS, MODELS, noPreference, [], m.mods);
    t.controller.onReady();
    t.posted.length = 0;
    await t.controller.onMessage({ type: 'settings.modToggle', modId: 'ghost', enabled: true });
    await Promise.resolve();
    expect(t.log.warn).toHaveBeenCalledWith(
      'settings request failed: settings.modToggle: RangeError',
    );
    expect(JSON.stringify(t.log.warn.mock.calls)).not.toContain('secret-mod-text');
    expect(notices(t.posted)).toEqual([
      { integrationID: '', kind: 'modFailed', message: 'The mod could not be switched' },
    ]);
    expect(states(t.posted)).toHaveLength(1);
  });

  it('answers a notice when there is no mods half', async () => {
    const t = setup();
    await t.controller.onMessage({ type: 'settings.modToggle', modId: 'quiet', enabled: false });
    expect(notices(t.posted)).toEqual([
      { integrationID: '', kind: 'modFailed', message: 'Mods are not available' },
    ]);
  });

  it('drops a bad mod id or extra field before the mods half hears of it', async () => {
    const m = makeMods(LISTING);
    const t = setup(ROWS, MODELS, noPreference, [], m.mods);
    for (const bad of [
      { type: 'settings.modToggle', modId: '../x', enabled: true },
      { type: 'settings.modToggle', modId: 'Quiet', enabled: true },
      { type: 'settings.modToggle', modId: 'quiet', enabled: 'yes' },
      { type: 'settings.modToggle', modId: 'quiet', enabled: true, key: 'k' },
    ]) {
      await t.controller.onMessage(bad);
    }
    expect(m.toggle).not.toHaveBeenCalled();
  });

  it('stops listening to the mods half when disposed', () => {
    const m = makeMods(LISTING);
    const t = setup(ROWS, MODELS, noPreference, [], m.mods);
    expect(m.listeners.size).toBe(1);
    t.controller.dispose();
    expect(m.listeners.size).toBe(0);
  });
});

describe('SETTINGS_ACTION_COMMANDS', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { contributes: { commands: { command: string }[] } };
  const contributed = new Set(manifest.contributes.commands.map((command) => command.command));

  // Protects: an action of the closed list that points at a command package.json does not
  // contribute would do nothing when pressed. Reads the REAL package.json.
  it('maps every action to a contributed command, and has no entry beyond the list', () => {
    expect(Object.keys(SETTINGS_ACTION_COMMANDS).sort()).toEqual([...SETTINGS_ACTIONS].sort());
    for (const action of SETTINGS_ACTIONS) {
      expect(contributed.has(SETTINGS_ACTION_COMMANDS[action]), action).toBe(true);
    }
  });

  it('never maps an action to Toggle Work Mode (decision P2)', () => {
    expect(Object.values(SETTINGS_ACTION_COMMANDS)).not.toContain('openVsCode.toggleWorkMode');
  });
});
