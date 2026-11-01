// Protects against: a broken or hostile settings webview (untrusted input, architecture rule 1)
// getting the host to connect a provider that does not exist, sending form answers the method does
// not declare, or removing a credential that is not the integration's; and against a flood of
// `settings.state` posts when the store, the attempt and the header change in the same tick.
//
// Provenance: FABRICATED store, flows and UI, written from the shapes of `serverConfig.ts` and
// `providerAuth.ts`. They prove the controller's validation and coalescing, not a real panel
// (the `fake-server` suite drives the same controller through `test.settingsMessage`; `test:visual`
// step 36 drives it with real DOM `postMessage` clicks, see the header of `SettingsController`).
import { describe, expect, it, vi } from 'vitest';
import { ProviderAuth, type AuthResult, type AuthUi, type ProviderAuthApi } from './providerAuth';
import {
  SettingsController,
  type SettingsAuth,
  type SettingsConfigSource,
  type SettingsControllerDeps,
} from './settingsController';
import type { IntegrationRow, ServerConfigSnapshot } from './serverConfig';
import type { AuthAttemptView, SettingsHostToWebview } from '../shared/settingsProtocol';

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

function snapshotOf(rows: IntegrationRow[]): ServerConfigSnapshot {
  return {
    epoch: 1,
    integrations: { loaded: true, failed: false, rows },
    mcp: { loaded: true, failed: false, pendingFirstRead: false, servers: [] },
  };
}

function setup(rows: IntegrationRow[] = ROWS) {
  const posted: SettingsHostToWebview[] = [];
  const storeListeners = new Set<() => void>();
  const attemptListeners = new Set<(view: AuthAttemptView | undefined) => void>();
  let attempt: AuthAttemptView | undefined;
  const config = {
    snapshot: vi.fn(() => snapshotOf(rows)),
    onDidChange: (listener: () => void) => {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
    reloadAll: vi.fn(() => Promise.resolve()),
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
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const deps: SettingsControllerDeps = {
    config,
    auth,
    post: (message) => posted.push(message),
    header: () => ({
      connection: { state: 'connected', serverVersion: '2.0.32' },
      folder: 'work',
      serverVersion: '2.0.32',
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
    runAction,
    log,
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
