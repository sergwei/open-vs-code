// Protects against: the sign-in flows of the settings tab (issue #128, E10) leaking a key or a
// server message into the log, calling the server with a blank key or a form the user did not fill,
// opening a non-https link, polling on after a Cancel, or failing the second of two Cancels (the
// notification's and the card's can both fire).
//
// Provenance: FABRICATED. The clients and the UI are fakes written from the types of
// `@opencode/client@2.0.32` and the statuses the planner's spike saw against a real opencode 2.0.32
// (Windows 11, 01/11/2026: cancel then status is 404; an empty key is accepted by the server; a
// missing form field is 400). These tests prove OUR logic, not that a real provider's login works.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderAuth,
  buildAnswer,
  cleanInstructions,
  extractDeviceCode,
  type AuthProgressView,
  type AuthUi,
  type ProviderAuthApi,
} from './providerAuth';
import type { FieldRow, IntegrationRow, MethodRow } from './serverConfig';
import type { AuthAttemptView } from '../shared/settingsProtocol';

const LOCATION = { directory: 'C:\\work' };
const KEY = 'sk-live-planted-1234';
const SERVER_MESSAGE = 'Invalid credentials: the provider said no';

type Status =
  | { status: 'pending' }
  | { status: 'complete' }
  | { status: 'failed'; message: string }
  | { status: 'expired' };

/** Attempt data of `oauth.connect`; the link is https unless the test changes it. */
function attemptData(
  overrides: Partial<{ url: string; instructions: string; mode: 'auto' | 'code' }> = {},
) {
  return {
    attemptID: 'att_1',
    url: 'https://auth.example.test/login',
    instructions: 'Enter code: ABCD-1234',
    mode: 'auto' as const,
    time: { created: 0, expires: Date.now() + 600_000 },
    ...overrides,
  };
}

/** A fake client whose calls are recorded and whose answers the test can change. */
function setup(options: { allowLoopbackHttp?: boolean } = {}) {
  const lines: string[] = [];
  const log = {
    info: (m: string) => lines.push(`info ${m}`),
    warn: (m: string) => lines.push(`warn ${m}`),
    error: (m: string) => lines.push(`error ${m}`),
    debug: (m: string) => lines.push(`debug ${m}`),
  };
  const state = {
    statuses: [{ status: 'pending' }] as Status[],
    connectKeyError: undefined as Error | undefined,
    cancelError: undefined as Error | undefined,
    attempt: attemptData(),
    completeError: undefined as Error | undefined,
    secret: KEY as string | undefined,
    code: 'CODE-1' as string | undefined,
    confirm: true,
  };
  const mocks = {
    key: vi.fn((_input: unknown) =>
      state.connectKeyError === undefined
        ? Promise.resolve()
        : Promise.reject(state.connectKeyError),
    ),
    external: vi.fn((_input: unknown) => Promise.resolve()),
    connect: vi.fn((_input: unknown): Promise<unknown> =>
      Promise.resolve({ location: LOCATION, data: state.attempt }),
    ),
    status: vi.fn((_input: unknown): Promise<unknown> => {
      const next = state.statuses.length > 1 ? state.statuses.shift() : state.statuses[0];
      return Promise.resolve({ location: LOCATION, data: next });
    }),
    complete: vi.fn((_input: unknown) =>
      state.completeError === undefined ? Promise.resolve() : Promise.reject(state.completeError),
    ),
    cancel: vi.fn((_input: unknown) =>
      state.cancelError === undefined ? Promise.resolve() : Promise.reject(state.cancelError),
    ),
    remove: vi.fn((_input: unknown) => Promise.resolve()),
  };
  const api = {
    integration: {
      connect: { key: mocks.key, external: mocks.external },
      oauth: {
        connect: mocks.connect,
        status: mocks.status,
        complete: mocks.complete,
        cancel: mocks.cancel,
      },
    },
    credential: { remove: mocks.remove },
  } as unknown as ProviderAuthApi;
  const views: AuthProgressView[] = [];
  const handle = { update: vi.fn(), dispose: vi.fn() };
  let onCancel: (() => void) | undefined;
  const ui = {
    askSecret: vi.fn((_prompt: { signal: AbortSignal }) => Promise.resolve(state.secret)),
    askCode: vi.fn(() => Promise.resolve(state.code)),
    openExternal: vi.fn((_url: string) => Promise.resolve(true)),
    progress: vi.fn((view: AuthProgressView, cancel: () => void) => {
      views.push(view);
      onCancel = cancel;
      return handle;
    }),
    confirm: vi.fn(() => Promise.resolve(state.confirm)),
    copy: vi.fn((_text: string) => Promise.resolve()),
  } satisfies AuthUi;
  const auth = new ProviderAuth(log, ui, { pollMs: 1000, ...options });
  auth.attach(api, { url: 'http://127.0.0.1:43211', password: 'pw-secret' });
  const published: (AuthAttemptView | undefined)[] = [];
  auth.onDidChangeAttempt((view) => published.push(view));
  return {
    auth,
    lines,
    state,
    mocks,
    ui,
    views,
    handle,
    published,
    pressNotificationCancel: () => onCancel?.(),
  };
}

const KEY_METHOD: MethodRow = {
  index: 0,
  type: 'key',
  label: 'API key',
  fields: [],
  supported: true,
};

function row(
  methods: MethodRow[],
  connections: IntegrationRow['connections'] = [],
): IntegrationRow {
  return { id: 'acme', name: 'Acme', connections, methods };
}

const COPILOT_FIELDS: FieldRow[] = [
  {
    key: 'deploymentType',
    title: 'Deployment type',
    required: true,
    options: [
      { value: 'github.com', label: 'GitHub.com' },
      { value: 'enterprise', label: 'GitHub Enterprise' },
    ],
  },
  {
    key: 'enterpriseUrl',
    required: true,
    when: [{ key: 'deploymentType', op: 'eq', value: 'enterprise' }],
  },
];

const OAUTH_AUTO: MethodRow = {
  index: 0,
  type: 'oauth',
  id: 'device',
  label: 'Login',
  fields: [],
  supported: true,
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('buildAnswer', () => {
  it('walks options, when, required and defaults of the form', () => {
    expect(buildAnswer(COPILOT_FIELDS, {})).toEqual({
      ok: false,
      message: 'Deployment type is required',
    });
    expect(buildAnswer(COPILOT_FIELDS, { deploymentType: 'other' })).toEqual({
      ok: false,
      message: 'Deployment type is not one of the available options',
    });
    // `enterpriseUrl` is inactive for github.com: skipped even though it is required.
    expect(
      buildAnswer(COPILOT_FIELDS, { deploymentType: 'github.com', enterpriseUrl: 'x' }),
    ).toEqual({
      ok: true,
      answer: { deploymentType: 'github.com' },
    });
    expect(buildAnswer(COPILOT_FIELDS, { deploymentType: 'enterprise' })).toEqual({
      ok: false,
      message: 'enterpriseUrl is required',
    });
    expect(
      buildAnswer(COPILOT_FIELDS, {
        deploymentType: 'enterprise',
        enterpriseUrl: ' https://ghe.test ',
      }),
    ).toEqual({
      ok: true,
      answer: { deploymentType: 'enterprise', enterpriseUrl: 'https://ghe.test' },
    });
  });

  it('uses defaults, supports neq, drops unknown keys and blank optional fields', () => {
    const fields: FieldRow[] = [
      { key: 'region', required: false, default: 'us' },
      { key: 'note', required: false },
      { key: 'extra', required: false, when: [{ key: 'region', op: 'neq', value: 'us' }] },
    ];
    expect(buildAnswer(fields, { note: '  ', stray: 'x' })).toEqual({
      ok: true,
      answer: { region: 'us' },
    });
    expect(buildAnswer(fields, { region: 'eu', extra: 'v' })).toEqual({
      ok: true,
      answer: { region: 'eu', extra: 'v' },
    });
  });
});

describe('cleanInstructions / extractDeviceCode', () => {
  it('removes [ ] ( ) and control characters and cuts long text', () => {
    expect(cleanInstructions('Open [here](command:evil) now\r\nEnter code: AB-12')).toBe(
      'Open herecommand:evil now Enter code: AB-12',
    );
    expect(cleanInstructions('x'.repeat(900))).toHaveLength(500);
  });

  it('finds the device code of the spike formats', () => {
    expect(extractDeviceCode('Enter code: ABCD-1234')).toBe('ABCD-1234');
    expect(extractDeviceCode('Paste the token')).toBeUndefined();
  });
});

describe('connect: choosing the method', () => {
  it('refuses an integration with no method instead of inventing an API key', async () => {
    const t = setup();
    expect(await t.auth.connect(row([]), 0, {})).toEqual({
      kind: 'failed',
      message: 'Unknown method for Acme',
    });
    expect(t.mocks.key).not.toHaveBeenCalled();
    expect(t.ui.askSecret).not.toHaveBeenCalled();
  });

  it('refuses an unknown index, a method the tab cannot render and a missing server', async () => {
    const t = setup();
    expect(await t.auth.connect(row([KEY_METHOD]), 3, {})).toEqual({
      kind: 'failed',
      message: 'Unknown method for Acme',
    });
    expect(await t.auth.connect(row([{ ...KEY_METHOD, supported: false }]), 0, {})).toEqual({
      kind: 'unsupported',
      message: 'Use `opencode auth login` in a terminal for Acme',
    });
    t.auth.detach();
    expect(await t.auth.connect(row([KEY_METHOD]), 0, {})).toEqual({
      kind: 'failed',
      message: 'The opencode server is not running',
    });
    expect(t.mocks.key).not.toHaveBeenCalled();
  });

  it('refuses a form that does not pass before asking anything', async () => {
    const t = setup();
    const result = await t.auth.connect(row([{ ...KEY_METHOD, fields: COPILOT_FIELDS }]), 0, {});
    expect(result).toEqual({ kind: 'failed', message: 'Deployment type is required' });
    expect(t.ui.askSecret).not.toHaveBeenCalled();
  });
});

describe('connect: API key', () => {
  it('sends the trimmed key with the form answers and logs no key', async () => {
    const t = setup();
    t.state.secret = `  ${KEY}  `;
    const fields: FieldRow[] = [{ key: 'resourceName', required: true }];
    const result = await t.auth.connect(row([{ ...KEY_METHOD, fields }]), 0, {
      resourceName: 'res',
    });
    expect(result).toEqual({ kind: 'connected' });
    expect(t.mocks.key).toHaveBeenCalledWith({
      integrationID: 'acme',
      key: KEY,
      answer: { resourceName: 'res' },
    });
    expect(t.lines).toContain('info provider connected: acme (key)');
    expect(t.lines.join('\n')).not.toContain(KEY);
    expect(JSON.stringify(t.published)).not.toContain(KEY);
  });

  it('rejects a blank key before calling the server, and a dismissed input is a cancel', async () => {
    const t = setup();
    t.state.secret = '   ';
    expect(await t.auth.connect(row([KEY_METHOD]), 0, {})).toEqual({
      kind: 'failed',
      message: 'The API key is empty',
    });
    t.state.secret = undefined;
    expect(await t.auth.connect(row([KEY_METHOD]), 0, {})).toEqual({ kind: 'cancelled' });
    expect(t.mocks.key).not.toHaveBeenCalled();
  });

  it('keeps the server message and the key out of the log, and the key out of the result', async () => {
    const t = setup();
    t.state.connectKeyError = Object.assign(
      new Error(`${SERVER_MESSAGE} ${KEY} http://127.0.0.1:43211`),
      {
        name: 'InvalidRequestError',
      },
    );
    const result = await t.auth.connect(row([KEY_METHOD]), 0, {});
    expect(result.kind).toBe('failed');
    const text = JSON.stringify(result);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('43211');
    expect(t.lines.join('\n')).not.toContain(SERVER_MESSAGE);
    expect(t.lines.join('\n')).not.toContain(KEY);
    expect(t.lines).toContain('warn provider connect failed: acme (key): InvalidRequestError');
  });

  it('allows one sign-in at a time', async () => {
    const t = setup();
    let release: (value: string) => void = () => undefined;
    t.ui.askSecret.mockImplementationOnce(
      () => new Promise<string | undefined>((r) => (release = r)),
    );
    const first = t.auth.connect(row([KEY_METHOD]), 0, {});
    expect(await t.auth.connect(row([KEY_METHOD]), 0, {})).toEqual({
      kind: 'failed',
      message: 'Another sign-in is already in progress',
    });
    release(KEY);
    expect(await first).toEqual({ kind: 'connected' });
  });
});

describe('connect: key cancelled from the card', () => {
  /**
   * Protects W1 of the review: a Cancel from the card while the masked box is open must reach the
   * box (its `signal` aborts), or it stays open and swallows what is typed. Fake UI, fabricated.
   */
  it('aborts the signal of the masked input when the attempt is cancelled', async () => {
    const t = setup();
    let seen: AbortSignal | undefined;
    t.ui.askSecret.mockImplementationOnce(
      (prompt: { signal: AbortSignal }) =>
        new Promise<string | undefined>((resolve) => {
          seen = prompt.signal;
          prompt.signal.addEventListener('abort', () => resolve(undefined), { once: true });
        }),
    );
    const done = t.auth.connect(row([KEY_METHOD]), 0, {});
    await Promise.resolve();
    expect(seen?.aborted).toBe(false);
    await t.auth.cancel();
    expect(seen?.aborted).toBe(true);
    expect(await done).toEqual({ kind: 'cancelled' });
  });
});

describe('connect: external', () => {
  it('calls connect.external with the method id and the answers', async () => {
    const t = setup();
    const method: MethodRow = {
      index: 0,
      type: 'external',
      id: 'profile',
      label: 'AWS profile',
      fields: [{ key: 'profile', required: false, options: [{ value: 'work', label: 'work' }] }],
      supported: true,
    };
    expect(await t.auth.connect(row([method]), 0, { profile: 'work' })).toEqual({
      kind: 'connected',
    });
    expect(t.mocks.external).toHaveBeenCalledWith({
      integrationID: 'acme',
      methodID: 'profile',
      answer: { profile: 'work' },
    });
  });
});

describe('connect: OAuth auto', () => {
  it('opens the https link at once, shows the code and polls every second until complete', async () => {
    const t = setup();
    t.state.statuses = [{ status: 'pending' }, { status: 'pending' }, { status: 'complete' }];
    const done = t.auth.connect(row([OAUTH_AUTO]), 0, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ui.openExternal).toHaveBeenCalledWith('https://auth.example.test/login');
    expect(t.views[0]).toEqual({
      title: 'Sign in to Acme',
      instructions: 'Enter code: ABCD-1234',
      code: 'ABCD-1234',
    });
    expect(t.auth.attempt()).toEqual({
      integrationID: 'acme',
      phase: 'waiting',
      instructions: 'Enter code: ABCD-1234',
      code: 'ABCD-1234',
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(t.mocks.status).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.mocks.status).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await done).toEqual({ kind: 'connected' });
    expect(t.mocks.status).toHaveBeenCalledTimes(3);
    expect(t.handle.dispose).toHaveBeenCalled();
    expect(t.auth.attempt()).toBeUndefined();
    expect(t.published.at(-1)).toBeUndefined();
    const log = t.lines.join('\n');
    expect(log).toContain('provider sign-in started: acme (auto, auth.example.test, opened: true)');
    expect(log).not.toContain('ABCD-1234');
  });

  it('reports failed with the scrubbed message but logs only that it failed', async () => {
    const t = setup();
    t.state.statuses = [{ status: 'failed', message: `${SERVER_MESSAGE} http://127.0.0.1:43211` }];
    const done = t.auth.connect(row([OAUTH_AUTO]), 0, {});
    await vi.advanceTimersByTimeAsync(1000);
    const result = await done;
    expect(result.kind).toBe('failed');
    expect(JSON.stringify(result)).toContain(SERVER_MESSAGE);
    expect(JSON.stringify(result)).not.toContain('43211');
    expect(t.lines.join('\n')).not.toContain(SERVER_MESSAGE);
  });

  it('reports expired', async () => {
    const t = setup();
    t.state.statuses = [{ status: 'expired' }];
    const done = t.auth.connect(row([OAUTH_AUTO]), 0, {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(await done).toEqual({ kind: 'expired' });
  });

  it('fails after three consecutive unreadable statuses', async () => {
    const t = setup();
    t.mocks.status.mockRejectedValue(new Error('network down'));
    const done = t.auth.connect(row([OAUTH_AUTO]), 0, {});
    await vi.advanceTimersByTimeAsync(3000);
    expect((await done).kind).toBe('failed');
    expect(t.mocks.status).toHaveBeenCalledTimes(3);
  });

  it('does not open a link that is not https, and cancels the attempt on the server', async () => {
    const t = setup();
    t.state.attempt = attemptData({ url: 'http://evil.example.test/login' });
    const result = await t.auth.connect(row([OAUTH_AUTO]), 0, {});
    expect(result.kind).toBe('failed');
    expect(t.ui.openExternal).not.toHaveBeenCalled();
    expect(t.mocks.cancel).toHaveBeenCalledOnce();
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
      t.state.attempt = attemptData({ url });
      expect((await t.auth.connect(row([OAUTH_AUTO]), 0, {})).kind).toBe('failed');
    }
    expect(t.ui.openExternal).not.toHaveBeenCalled();
  });

  it('opens loopback http only when allowed (the fake server), never another host', async () => {
    const t = setup({ allowLoopbackHttp: true });
    t.state.statuses = [{ status: 'complete' }];
    t.state.attempt = attemptData({ url: 'http://127.0.0.1:5555/fake-oauth/approve?attempt=1' });
    const done = t.auth.connect(row([OAUTH_AUTO]), 0, {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(await done).toEqual({ kind: 'connected' });
    expect(t.ui.openExternal).toHaveBeenCalledWith(
      'http://127.0.0.1:5555/fake-oauth/approve?attempt=1',
    );
    t.state.attempt = attemptData({ url: 'http://example.test/x' });
    expect((await t.auth.connect(row([OAUTH_AUTO]), 0, {})).kind).toBe('failed');
  });

  it('stops polling after Cancel: a late status read neither publishes nor polls on', async () => {
    const t = setup();
    let answer: (value: unknown) => void = () => undefined;
    t.mocks.status.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const done = t.auth.connect(row([OAUTH_AUTO]), 0, {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.mocks.status).toHaveBeenCalledTimes(1);
    await t.auth.cancel();
    answer({ location: LOCATION, data: { status: 'complete' } });
    expect(await done).toEqual({ kind: 'cancelled' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.mocks.status).toHaveBeenCalledTimes(1);
    expect(t.published.at(-1)).toBeUndefined();
  });

  it('Cancel is idempotent: the notification and the card can both press it, and a 404 is ignored', async () => {
    const t = setup();
    t.state.cancelError = Object.assign(new Error('gone'), {
      name: 'IntegrationAttemptNotFoundError',
    });
    const done = t.auth.connect(row([OAUTH_AUTO]), 0, {});
    await vi.advanceTimersByTimeAsync(0);
    t.pressNotificationCancel();
    await t.auth.cancel();
    await t.auth.cancel();
    expect(await done).toEqual({ kind: 'cancelled' });
    expect(t.mocks.cancel).toHaveBeenCalledOnce();
    expect(t.lines.some((line) => line.startsWith('error') || line.startsWith('warn'))).toBe(false);
  });

  it('cancels the server attempt of a flow cancelled while oauth.connect was in flight', async () => {
    const t = setup();
    let answer: (value: unknown) => void = () => undefined;
    t.mocks.connect.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const done = t.auth.connect(row([OAUTH_AUTO]), 0, {});
    await t.auth.cancel();
    answer({ location: LOCATION, data: attemptData() });
    expect(await done).toEqual({ kind: 'cancelled' });
    expect(t.mocks.cancel).toHaveBeenCalledOnce();
    expect(t.ui.openExternal).not.toHaveBeenCalled();
  });

  it('copyCode copies only the code of the matching sign-in in progress', async () => {
    const t = setup();
    const done = t.auth.connect(row([OAUTH_AUTO]), 0, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(await t.auth.copyCode('other')).toBe(false);
    expect(await t.auth.copyCode('acme')).toBe(true);
    expect(t.ui.copy).toHaveBeenCalledWith('ABCD-1234');
    await t.auth.cancel();
    await done;
  });
});

describe('connect: OAuth code', () => {
  const CODE_METHOD: MethodRow = { ...OAUTH_AUTO, id: 'code' };

  it('asks the code and completes with it, keeping it out of the log', async () => {
    const t = setup();
    t.state.attempt = attemptData({ mode: 'code', instructions: 'Paste the code from the page' });
    t.state.code = ' SECRET-CODE ';
    const result = await t.auth.connect(row([CODE_METHOD]), 0, {});
    expect(result).toEqual({ kind: 'connected' });
    expect(t.mocks.complete).toHaveBeenCalledWith({
      integrationID: 'acme',
      attemptID: 'att_1',
      code: 'SECRET-CODE',
    });
    expect(t.lines.join('\n')).not.toContain('SECRET-CODE');
    expect(t.published.some((view) => view?.phase === 'finishing')).toBe(true);
  });

  it('cancels the attempt when the code input is dismissed', async () => {
    const t = setup();
    t.state.attempt = attemptData({ mode: 'code' });
    t.state.code = undefined;
    expect(await t.auth.connect(row([CODE_METHOD]), 0, {})).toEqual({ kind: 'cancelled' });
    expect(t.mocks.complete).not.toHaveBeenCalled();
    expect(t.mocks.cancel).toHaveBeenCalledOnce();
  });

  it('reports an invalid code without the code in the result or the log', async () => {
    const t = setup();
    t.state.attempt = attemptData({ mode: 'code' });
    t.state.code = 'BAD-CODE-9';
    t.state.completeError = new Error('Invalid code BAD-CODE-9');
    const result = await t.auth.connect(row([CODE_METHOD]), 0, {});
    expect(result.kind).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('BAD-CODE-9');
    expect(t.lines.join('\n')).not.toContain('BAD-CODE-9');
  });
});

describe('disconnect', () => {
  const connections: IntegrationRow['connections'] = [
    { kind: 'credential', id: 'cred_1', label: 'work', method: 'key' },
    { kind: 'env', name: 'ACME_KEY' },
  ];

  it('removes a credential of the integration after a confirmation', async () => {
    const t = setup();
    expect(await t.auth.disconnect(row([], connections), 'cred_1')).toEqual({ kind: 'removed' });
    expect(t.ui.confirm).toHaveBeenCalledOnce();
    expect(t.mocks.remove).toHaveBeenCalledWith({ credentialID: 'cred_1' });
  });

  it('does not call the server for a foreign credential, an env connection or a "no"', async () => {
    const t = setup();
    expect((await t.auth.disconnect(row([], connections), 'cred_other')).kind).toBe('failed');
    expect((await t.auth.disconnect(row([], connections), 'ACME_KEY')).kind).toBe('failed');
    t.state.confirm = false;
    expect(await t.auth.disconnect(row([], connections), 'cred_1')).toEqual({ kind: 'cancelled' });
    expect(t.mocks.remove).not.toHaveBeenCalled();
  });
});
