// Protects against: the settings tab (issue #128, E10) showing a secret, a stale answer or an
// invented "no MCP servers"; the store reading twice at once or after its server went away; and a
// long multi-line MCP error flooding the UI.
//
// Provenance of the data: FABRICATED from the types of `@opencode/client@2.0.32` and from the shapes
// the planner's spike saw against a real opencode 2.0.32 (Windows 11, 01/11/2026: `mcp.list` is
// `[]` at 25 ms and 3 s and full after the first `mcp.status.changed`; a `failed` error holds
// `\r\n` and the whole stderr). The planted secrets are made up to prove the ALLOW-LIST: the real
// server's `integration.list` has none, and these tests do not say what a future one will add.
// They confirm OUR mapping and coalescing, not the contract with the server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ConfigGetOutput,
  ConfigShellsOutput,
  ExperimentalConfigUpdateInput,
  IntegrationInfo,
  McpResourceCatalogOutput,
  ModelInfo,
  ProviderInfo,
} from '@opencode/client';
import {
  MAX_DETAIL,
  MAX_TEXT,
  MCP_FIRST_READ_GRACE_MS,
  SHELL_SETTLE_MS,
  ServerConfig,
  detailText,
  firstLine,
  toIntegrationRow,
  toMcpCatalogRows,
  toShellState,
  type ServerConfigApi,
} from './serverConfig';

/** Parses a JSON literal into the wire type the test says it is. */
function wire<T>(json: string): T {
  return JSON.parse(json) as T;
}

const LOCATION = { directory: 'C:\\work' };
const SECRETS = { url: 'http://127.0.0.1:43211', password: 'pw-secret-1' };

/** Markers planted where a real object carries a secret; none may reach a serialized snapshot. */
const PLANTED = [
  'sk-planted-api-key',
  'rt-planted-refresh',
  'at-planted-access',
  'hdr-planted-token',
];

/** An integration as the wire sends it, plus every place a secret could ride along. */
const INTEGRATION_WITH_SECRETS = wire<IntegrationInfo>(`{
  "id": "anthropic", "name": "Anthropic",
  "settings": {"apiKey": "sk-planted-api-key"},
  "headers": {"authorization": "Bearer hdr-planted-token"},
  "metadata": {"token": "hdr-planted-token"},
  "methods": [
    {"type": "key", "label": "API key", "value": {"key": "sk-planted-api-key"}},
    {"type": "oauth", "id": "browser", "label": "Browser",
     "form": [{"key": "enterpriseUrl", "type": "string", "secret": "rt-planted-refresh"}]},
    {"type": "env", "names": ["ANTHROPIC_API_KEY"]}
  ],
  "connections": [
    {"type": "credential", "id": "cred_1", "label": "work", "method": "key",
     "value": {"key": "sk-planted-api-key", "refresh": "rt-planted-refresh", "access": "at-planted-access"},
     "status": {"status": "needs_auth", "message": "sign in", "url": "https://x.test/?t=hdr-planted-token"}},
    {"type": "env", "name": "ANTHROPIC_API_KEY", "value": "sk-planted-api-key"}
  ]
}`);

interface FakeCalls {
  integrations: number;
  mcp: number;
  catalog: number;
}

/** A model as the wire sends it, with a secret in each place a real `ModelInfo` could carry one. */
const MODEL_WITH_SECRETS = wire<ModelInfo>(`{
  "id": "claude-sonnet", "modelID": "claude-sonnet", "providerID": "anthropic",
  "name": "Claude Sonnet",
  "headers": {"x-api-key": "sk-planted-api-key"},
  "body": {"token": "hdr-planted-token"},
  "settings": {"apiKey": "at-planted-access", "refresh": "rt-planted-refresh"},
  "capabilities": {"tools": true, "input": [], "output": []}, "variants": [],
  "time": {"released": 1}, "cost": [], "status": "active", "enabled": true,
  "limit": {"context": 1, "output": 1}
}`);

/** A provider as the wire sends it, with secrets in its `settings`, `headers` and `body`. */
const PROVIDER_WITH_SECRETS = wire<ProviderInfo>(`{
  "id": "anthropic", "integrationID": "anthropic-int", "name": "Anthropic",
  "activation": "auto", "package": "x",
  "settings": {"apiKey": "sk-planted-api-key"},
  "headers": {"authorization": "Bearer hdr-planted-token"},
  "body": {"refresh": "rt-planted-refresh"}
}`);

/**
 * A client whose reads answer with the (mutable) data and count their calls; since issue #205 it
 * also answers `config.get`/`config.shells` and records the `experimental.config.update` PATCHes
 * (`shell`), without a gate on those reads.
 */
function fakeApi(
  initial: {
    integrations?: IntegrationInfo[];
    mcp?: string;
    catalog?: McpResourceCatalogOutput['data'];
    models?: ModelInfo[];
    providers?: ProviderInfo[];
    modelDefault?: ModelInfo | null;
  } = {},
) {
  const calls: FakeCalls = { integrations: 0, mcp: 0, catalog: 0 };
  /** Reads of the model catalog, counted apart so the older `calls` expectations stay exact. */
  const modelCalls = { list: 0, default: 0, provider: 0 };
  const state = {
    models: initial.models ?? [],
    providers: initial.providers ?? [],
    modelDefault: initial.modelDefault ?? null,
    integrations: initial.integrations ?? [],
    mcp: initial.mcp ?? '[]',
    catalog: initial.catalog ?? { resources: [], templates: [] },
    /** When set, the next read of that source waits for `release()` and answers afterwards. */
    gate: undefined as { promise: Promise<void>; release: () => void } | undefined,
    fail: undefined as 'integrations' | 'mcp' | 'catalog' | 'models' | undefined,
    /** What `experimental.mcp.connect` and `.disconnect` throw, when set. */
    writeError: undefined as unknown,
    /** Runs when a write succeeds: the test changes `mcp` there, like the server would. */
    onWrite: undefined as (() => void) | undefined,
  };
  /** The writes the store made, in order: `connect docs`, `disconnect docs`. */
  const writes: string[] = [];
  /**
   * One write of `experimental.mcp.connect` or `.disconnect`: records it, then fails or succeeds
   * as told.
   */
  const write = (label: string): Promise<void> => {
    writes.push(label);
    if (state.writeError !== undefined) {
      // The client THROWS the body of a declared error (`{ _tag, message }`), not an `Error`.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      return Promise.reject(state.writeError);
    }
    state.onWrite?.();
    return Promise.resolve();
  };
  /** The shell row (issue #205): what `config.get`/`config.shells` answer and the PATCHes seen. */
  const shell = {
    entries: [] as ConfigGetOutput,
    shells: [] as ConfigShellsOutput,
    gets: 0,
    patches: [] as ExperimentalConfigUpdateInput[],
    patchError: undefined as unknown,
    fail: false,
    /** Runs when a PATCH succeeds: the test changes `entries` there, like the reload would. */
    onPatch: undefined as (() => void) | undefined,
    /** When set, the NEXT PATCH waits for it before succeeding (taken once, like `state.gate`). */
    patchGate: undefined as { promise: Promise<void> } | undefined,
  };
  const hold = async (): Promise<void> => {
    const gate = state.gate;
    state.gate = undefined;
    if (gate !== undefined) await gate.promise;
  };
  const api: ServerConfigApi = {
    integration: {
      list: async () => {
        calls.integrations++;
        await hold();
        if (state.fail === 'integrations') throw new Error(`boom ${SECRETS.url}`);
        return { location: LOCATION, data: state.integrations };
      },
      get: () => Promise.reject(new Error('not used')),
    },
    model: {
      list: async () => {
        modelCalls.list++;
        await hold();
        if (state.fail === 'models') throw new Error(`boom ${SECRETS.url}`);
        return { location: LOCATION, data: state.models };
      },
      default: async () => {
        modelCalls.default++;
        await hold();
        return { location: LOCATION, data: state.modelDefault };
      },
    },
    provider: {
      list: async () => {
        modelCalls.provider++;
        await hold();
        return { location: LOCATION, data: state.providers };
      },
    },
    experimental: {
      mcp: {
        connect: (input) => write(`connect ${input.server}`),
        disconnect: (input) => write(`disconnect ${input.server}`),
      },
      config: {
        update: async (input) => {
          shell.patches.push(input);
          const gate = shell.patchGate;
          shell.patchGate = undefined;
          if (gate !== undefined) await gate.promise;
          if (shell.patchError !== undefined) {
            // The client THROWS the body of a declared error, not an `Error`.
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            return Promise.reject(shell.patchError);
          }
          shell.onPatch?.();
          return Promise.resolve();
        },
      },
    },
    config: {
      get: async () => {
        // No `hold()` here: a gate set for another source must not be taken by this read.
        shell.gets++;
        await Promise.resolve();
        if (shell.fail) throw new Error(`boom ${SECRETS.url}`);
        return shell.entries;
      },
      shells: async () => {
        await Promise.resolve();
        return shell.shells;
      },
    },
    mcp: {
      list: async () => {
        calls.mcp++;
        await hold();
        if (state.fail === 'mcp') throw new Error('boom');
        return {
          location: LOCATION,
          data: wire<Awaited<ReturnType<ServerConfigApi['mcp']['list']>>['data']>(state.mcp),
        };
      },
      resource: {
        catalog: async () => {
          calls.catalog++;
          await hold();
          if (state.fail === 'catalog') throw new Error('boom');
          return { location: LOCATION, data: state.catalog };
        },
      },
    },
  };
  const gate = () => {
    let release: () => void = () => undefined;
    const promise = new Promise<void>((done) => {
      release = done;
    });
    state.gate = { promise, release };
    return release;
  };
  return { api, calls, modelCalls, state, gate, writes, shell };
}

/** A store with a recording log and change counter. */
function setup(api: ServerConfigApi) {
  const lines: string[] = [];
  const store = new ServerConfig({
    info: (m) => lines.push(`info: ${m}`),
    warn: (m) => lines.push(`warn: ${m}`),
    error: (m) => lines.push(`error: ${m}`),
    debug: () => undefined,
  });
  const changes = { count: 0 };
  store.onDidChange(() => {
    changes.count++;
  });
  store.attach(api, 1, SECRETS);
  return { store, lines, changes };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('firstLine', () => {
  it('takes the first non-blank line of a CRLF text and cuts it to 200 characters', () => {
    const long = `${'x'.repeat(500)}\r\nsecond line`;
    const line = firstLine(`\r\n  \r\n${long}`);
    expect(line).toHaveLength(MAX_TEXT);
    expect(line.endsWith('…')).toBe(true);
    expect(line).not.toContain('second');
    expect(firstLine('short\r\nnext')).toBe('short');
    expect(firstLine('')).toBe('');
  });
});

describe('the allow-list mapping', () => {
  it('keeps no planted secret anywhere in a serialized snapshot', async () => {
    const { api } = fakeApi({
      integrations: [INTEGRATION_WITH_SECRETS],
      // `integrationID` is an ALLOWED field since PR2 of issue #186 (the webview matches it with the
      // sign-in in progress), so the secret is planted in `headers` of the server instead, next to
      // the one in `status`; the assertion below checks that the id itself does arrive.
      mcp: `[{"name":"docs","status":{"status":"failed","error":"x","headers":{"a":"hdr-planted-token"}},"headers":{"authorization":"at-planted-access"},"integrationID":"mcp_0123456789abcdef"}]`,
      catalog: wire<McpResourceCatalogOutput['data']>(
        `{"resources":[{"server":"docs","name":"r","uri":"file:///r","headers":{"a":"sk-planted-api-key"}}],"templates":[]}`,
      ),
    });
    const { store } = setup(api);
    await store.reloadAll();
    const json = JSON.stringify(store.snapshot());
    for (const secret of PLANTED) expect(json).not.toContain(secret);
    // ...while the allowed fields did arrive, so the check is not vacuous.
    expect(json).toContain('cred_1');
    expect(json).toContain('ANTHROPIC_API_KEY');
    expect(json).toContain('sign in');
    expect(store.snapshot().mcp.servers[0]?.integrationID).toBe('mcp_0123456789abcdef');
  });

  it('maps connections, key/oauth methods with their index, and drops env methods', () => {
    expect(toIntegrationRow(INTEGRATION_WITH_SECRETS)).toEqual({
      id: 'anthropic',
      name: 'Anthropic',
      connections: [
        { kind: 'credential', id: 'cred_1', label: 'work', method: 'key', needsAuth: 'sign in' },
        { kind: 'env', name: 'ANTHROPIC_API_KEY' },
      ],
      methods: [
        { index: 0, type: 'key', label: 'API key', fields: [], supported: true },
        {
          index: 1,
          type: 'oauth',
          id: 'browser',
          label: 'Browser',
          fields: [{ key: 'enterpriseUrl', required: false }],
          supported: true,
        },
      ],
    });
  });

  it('reads string fields with options and when, hides hidden ones and flags other types', () => {
    const row = toIntegrationRow(
      wire<IntegrationInfo>(`{
        "id": "github-copilot", "name": "GitHub Copilot", "connections": [],
        "methods": [{"type": "oauth", "id": "device", "label": "Login", "form": [
          {"key": "deploymentType", "type": "string", "required": true,
           "options": [{"value": "github.com", "label": "GitHub.com"}, {"value": "ghe", "label": "Enterprise", "description": "own host"}]},
          {"key": "enterpriseUrl", "type": "string", "when": [{"key": "deploymentType", "op": "eq", "value": "ghe"}]},
          {"key": "secretToken", "type": "string", "hidden": true},
          {"key": "agree", "type": "boolean"}
        ]}]
      }`),
    );
    const method = row.methods[0];
    expect(method?.supported).toBe(false);
    expect(method?.fields).toEqual([
      {
        key: 'deploymentType',
        required: true,
        options: [
          { value: 'github.com', label: 'GitHub.com' },
          { value: 'ghe', label: 'Enterprise', description: 'own host' },
        ],
      },
      {
        key: 'enterpriseUrl',
        required: false,
        when: [{ key: 'deploymentType', op: 'eq', value: 'ghe' }],
      },
    ]);
  });

  it('groups resources and templates by server', () => {
    const rows = toMcpCatalogRows(
      wire<McpResourceCatalogOutput['data']>(`{
        "resources": [{"server": "docs", "name": "readme.md", "uri": "file:///readme.md", "mimeType": "text/markdown"}],
        "templates": [{"server": "docs", "name": "files", "uriTemplate": "file:///{path}", "description": "any"}]
      }`),
    );
    expect(rows.resources.get('docs')).toEqual([
      { name: 'readme.md', uri: 'file:///readme.md', mimeType: 'text/markdown' },
    ]);
    expect(rows.templates.get('docs')).toEqual([
      { name: 'files', uriTemplate: 'file:///{path}', description: 'any' },
    ]);
  });
});

describe('the MCP rows', () => {
  it('shows a failed server by the first line of its scrubbed error, at most 200 characters', async () => {
    const error = `Connection closed at ${SECRETS.url}\r\n${'stderr '.repeat(100)}`;
    const { api } = fakeApi({
      mcp: JSON.stringify([
        { name: 'docs', status: { status: 'connected' } },
        { name: 'broken', status: { status: 'failed', error } },
        { name: 'off', status: { status: 'disabled' } },
        { name: 'linear', status: { status: 'needs_auth', error: 'Sign in' } },
      ]),
      catalog: wire<McpResourceCatalogOutput['data']>(
        `{"resources":[{"server":"docs","name":"r","uri":"file:///r"}],"templates":[]}`,
      ),
    });
    const { store } = setup(api);
    await store.reloadAll();
    const servers = store.snapshot().mcp.servers;
    expect(servers.map((s) => `${s.name}:${s.status}`)).toEqual([
      'docs:connected',
      'broken:failed',
      'off:disabled',
      'linear:needs_auth',
    ]);
    const broken = servers[1]?.error ?? '';
    expect(broken.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(broken).not.toContain('\n');
    expect(broken).not.toContain(SECRETS.url);
    expect(servers[0]?.resources).toEqual([{ name: 'r', uri: 'file:///r' }]);
    expect(servers[2]?.error).toBeUndefined();
  });

  it('marks an empty first list as pending until a status event is read or the grace ends', async () => {
    vi.useFakeTimers();
    const { api, state } = fakeApi();
    const { store, changes } = setup(api);
    await store.reloadAll();
    expect(store.snapshot().mcp).toMatchObject({
      loaded: true,
      servers: [],
      pendingFirstRead: true,
    });
    // The server fills its list and says so: the read after the event settles it.
    state.mcp = '[{"name":"docs","status":{"status":"connected"}}]';
    store.event('mcp.status.changed');
    await vi.advanceTimersByTimeAsync(0);
    expect(store.snapshot().mcp).toMatchObject({ pendingFirstRead: false });
    expect(store.snapshot().mcp.servers).toHaveLength(1);

    // Without any event, the grace period ends and the empty list is believed.
    store.detach();
    state.mcp = '[]';
    store.attach(api, 2, SECRETS);
    await store.reloadAll();
    const before = changes.count;
    expect(store.snapshot().mcp.pendingFirstRead).toBe(true);
    await vi.advanceTimersByTimeAsync(MCP_FIRST_READ_GRACE_MS);
    expect(store.snapshot().mcp.pendingFirstRead).toBe(false);
    expect(changes.count).toBeGreaterThan(before);
  });

  it('believes an empty list read after an event, even the first one', async () => {
    const { api } = fakeApi();
    const { store } = setup(api);
    store.event('mcp.status.changed');
    await store.reloadAll();
    expect(store.snapshot().mcp).toMatchObject({ loaded: true, pendingFirstRead: false });
  });
});

describe('the reads', () => {
  it('coalesces requests made while one is in flight into a single repeat', async () => {
    const { api, calls, state, gate } = fakeApi();
    const { store } = setup(api);
    const release = gate();
    const first = store.reloadAll();
    store.event('integration.updated');
    store.event('credential.updated');
    store.event('credential.switched');
    const second = store.reloadAll();
    // The integration read is the one that waited on the gate (the first call takes it).
    release();
    state.gate = undefined;
    await Promise.all([first, second]);
    expect(calls.integrations).toBe(2);
    expect(calls.mcp).toBeLessThanOrEqual(2);
  });

  it('replaces the rows whole: an integration that left disappears', async () => {
    const { api, state } = fakeApi({ integrations: [INTEGRATION_WITH_SECRETS] });
    const { store } = setup(api);
    await store.reloadAll();
    expect(store.snapshot().integrations.rows.map((row) => row.id)).toEqual(['anthropic']);
    state.integrations = [];
    store.event('credential.updated');
    await store.reloadAll();
    expect(store.snapshot().integrations).toMatchObject({ loaded: true, rows: [] });
  });

  it('routes each event to its own read', async () => {
    const { api, calls } = fakeApi();
    const { store } = setup(api);
    store.event('mcp.resources.changed');
    await Promise.resolve();
    expect(calls).toEqual({ integrations: 0, mcp: 0, catalog: 1 });
    store.event('mcp.status.changed');
    // The catalog read of the previous event is still in flight, so the new one is queued behind it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A status change re-reads the list and, as a defence, the catalog too (W6 of the review).
    expect(calls).toEqual({ integrations: 0, mcp: 1, catalog: 2 });
    store.event('integration.updated');
    store.event('model.updated');
    store.event('session.created');
    await Promise.resolve();
    expect(calls).toEqual({ integrations: 1, mcp: 1, catalog: 2 });
    store.event('server.connected');
    store.event('location.shutdown');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.integrations).toBeGreaterThanOrEqual(2);
    expect(calls.mcp).toBeGreaterThanOrEqual(2);
    expect(calls.catalog).toBeGreaterThanOrEqual(2);
  });

  /**
   * Protects the W6 defence: a server version that stops emitting `mcp.resources.changed` on
   * connect (upstream 843a6c5 emits it, `mcp/index.ts` L463-465, but nothing follows it end to end
   * against a real opencode) must not leave the catalog stale. Fabricated events on a fake client.
   */
  it('re-reads the resource catalog on a status change alone, at most twice per burst', async () => {
    const { api, calls } = fakeApi();
    const { store } = setup(api);
    store.event('mcp.status.changed');
    store.event('mcp.status.changed');
    store.event('mcp.status.changed');
    // One read in flight plus one repeat for the events that arrived meanwhile: 2, not 3.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.catalog).toBe(2);
    expect(calls.mcp).toBe(2);
  });

  it('drops an answer that arrives after detach, and after a new attach', async () => {
    const { api, state, gate } = fakeApi({ integrations: [INTEGRATION_WITH_SECRETS] });
    const { store, changes } = setup(api);
    const release = gate();
    const read = store.reloadAll();
    store.detach();
    const afterDetach = changes.count;
    release();
    state.gate = undefined;
    await read;
    expect(store.snapshot().integrations.loaded).toBe(false);
    expect(store.snapshot().epoch).toBeUndefined();
    expect(changes.count).toBe(afterDetach);

    // A new server of epoch 2: only its own reads count.
    store.attach(api, 2, SECRETS);
    await store.reloadAll();
    expect(store.snapshot()).toMatchObject({ epoch: 2, integrations: { loaded: true } });
  });

  it('keeps the previous rows, flags the failure and logs a scrubbed warn line', async () => {
    const { api, state } = fakeApi({ integrations: [INTEGRATION_WITH_SECRETS] });
    const { store, lines } = setup(api);
    await store.reloadAll();
    state.fail = 'integrations';
    await store.reloadAll();
    expect(store.snapshot().integrations).toMatchObject({ loaded: true, failed: true });
    expect(store.snapshot().integrations.rows).toHaveLength(1);
    const warn = lines.find((line) => line.startsWith('warn: integration list failed'));
    expect(warn).toBeDefined();
    expect(warn).not.toContain(SECRETS.url);
    state.fail = undefined;
    await store.reloadAll();
    expect(store.snapshot().integrations.failed).toBe(false);
  });

  it('writes the stable load line with the four counts', async () => {
    const { api } = fakeApi({
      integrations: [INTEGRATION_WITH_SECRETS],
      mcp: '[{"name":"docs","status":{"status":"connected"}}]',
      catalog: wire<McpResourceCatalogOutput['data']>(
        `{"resources":[{"server":"docs","name":"r","uri":"file:///r"}],"templates":[]}`,
      ),
    });
    const { store, lines } = setup(api);
    await store.reloadAll();
    expect(lines.at(-1)).toBe(
      'info: server config loaded (1 integrations, 1 connected, 1 mcp servers, 1 resources)',
    );
    for (const line of lines) for (const secret of PLANTED) expect(line).not.toContain(secret);
  });

  it('reads nothing without a server', async () => {
    const { api, calls, modelCalls } = fakeApi();
    const { store } = setup(api);
    store.detach();
    store.event('server.connected');
    await store.reloadAll();
    expect(calls).toEqual({ integrations: 0, mcp: 0, catalog: 0 });
    expect(modelCalls).toEqual({ list: 0, default: 0, provider: 0 });
  });
});

/**
 * Protects issue #186: the model picker must never carry a secret from `model.list` or
 * `provider.list` (both hold `headers`, `body` and `settings`), must follow the events that change
 * the catalog, and must not read twice at once. Provenance: FABRICATED `ModelInfo` and
 * `ProviderInfo` written from the types of `@opencode/client@2.0.32`, with planted secrets that a
 * real server may or may not send; the events are the names of the 2.0.32 types, never seen on a
 * real stream.
 */
describe('the model catalog', () => {
  it('keeps no planted secret from model.list or provider.list in a serialized snapshot', async () => {
    const { api } = fakeApi({
      models: [MODEL_WITH_SECRETS],
      providers: [PROVIDER_WITH_SECRETS],
      modelDefault: MODEL_WITH_SECRETS,
    });
    const { store } = setup(api);
    await store.reloadAll();
    const json = JSON.stringify(store.snapshot());
    for (const secret of PLANTED) expect(json).not.toContain(secret);
    // ...while the allowed fields did arrive, so the check is not vacuous.
    expect(json).toContain('claude-sonnet');
    expect(json).toContain('anthropic-int');
  });

  it('joins models with their provider and cuts the default to three fields', async () => {
    const orphan = { ...MODEL_WITH_SECRETS, id: 'lone', name: 'Lone', providerID: 'ghost' };
    const { api } = fakeApi({
      models: [MODEL_WITH_SECRETS, orphan],
      providers: [PROVIDER_WITH_SECRETS],
      modelDefault: MODEL_WITH_SECRETS,
    });
    const { store } = setup(api);
    expect(store.snapshot().models).toMatchObject({ loaded: false, failed: false, rows: [] });
    await store.reloadAll();
    expect(store.snapshot().models).toEqual({
      loaded: true,
      failed: false,
      rows: [
        {
          providerID: 'anthropic',
          id: 'claude-sonnet',
          name: 'Claude Sonnet',
          providerName: 'Anthropic',
          integrationID: 'anthropic-int',
        },
        { providerID: 'ghost', id: 'lone', name: 'Lone', providerName: 'ghost' },
      ],
      serverDefault: { providerID: 'anthropic', id: 'claude-sonnet', name: 'Claude Sonnet' },
    });
  });

  it('leaves serverDefault out when the server names no default', async () => {
    const { api } = fakeApi({ models: [MODEL_WITH_SECRETS], providers: [PROVIDER_WITH_SECRETS] });
    const { store } = setup(api);
    await store.reloadAll();
    expect(store.snapshot().models.serverDefault).toBeUndefined();
    expect('serverDefault' in store.snapshot().models).toBe(false);
  });

  it('keeps source mcp of an integration and nothing else of its metadata', () => {
    const row = toIntegrationRow(
      wire<IntegrationInfo>(
        `{"id":"mcp_ab12","name":"linear","metadata":{"source":"mcp","token":"hdr-planted-token"},"methods":[],"connections":[]}`,
      ),
    );
    expect(row).toEqual({
      id: 'mcp_ab12',
      name: 'linear',
      connections: [],
      methods: [],
      source: 'mcp',
    });
    const plain = toIntegrationRow(
      wire<IntegrationInfo>(
        `{"id":"x","name":"X","metadata":{"source":"models.dev"},"methods":[],"connections":[]}`,
      ),
    );
    expect('source' in plain).toBe(false);
  });

  it('re-reads the models on model, provider, config, integration and credential events only', async () => {
    const { api, modelCalls } = fakeApi();
    const { store } = setup(api);
    for (const type of [
      'model.updated',
      'provider.updated',
      'config.updated',
      'integration.updated',
      'credential.updated',
      'credential.switched',
    ]) {
      const before = modelCalls.list;
      store.event(type);
      // Drain the queue: a macrotask, not a microtask, so the coalesced repeat has run.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(modelCalls.list, type).toBe(before + 1);
    }
    const before = { ...modelCalls };
    store.event('session.created');
    store.event('mcp.status.changed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modelCalls).toEqual(before);
  });

  it('coalesces a burst of model events into one read in flight plus one repeat', async () => {
    const { api, modelCalls } = fakeApi();
    const { store } = setup(api);
    store.event('model.updated');
    store.event('provider.updated');
    store.event('config.updated');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modelCalls).toEqual({ list: 2, default: 2, provider: 2 });
  });

  it('keeps the previous rows, flags the failure and logs a scrubbed warn line', async () => {
    const { api, state } = fakeApi({
      models: [MODEL_WITH_SECRETS],
      providers: [PROVIDER_WITH_SECRETS],
    });
    const { store, lines } = setup(api);
    await store.reloadAll();
    state.fail = 'models';
    await store.reloadAll();
    expect(store.snapshot().models).toMatchObject({ loaded: true, failed: true });
    expect(store.snapshot().models.rows).toHaveLength(1);
    const warn = lines.find((line) => line.startsWith('warn: model list failed'));
    expect(warn).toBeDefined();
    expect(warn).not.toContain(SECRETS.url);
    state.fail = undefined;
    await store.reloadAll();
    expect(store.snapshot().models.failed).toBe(false);
  });

  it('forgets the models with the server', async () => {
    const { api } = fakeApi({ models: [MODEL_WITH_SECRETS], providers: [PROVIDER_WITH_SECRETS] });
    const { store } = setup(api);
    await store.reloadAll();
    store.detach();
    expect(store.snapshot().models).toEqual({ loaded: false, failed: false, rows: [] });
  });
});

/**
 * Protects issue #186 (PR2): the whole MCP error reaches "Show details" scrubbed and bounded (it is
 * the stderr of a process, with `\r\n`, and may carry the server URL), and `mcpAction` writes once,
 * re-reads before it resolves and never lets the message of an error into the log. Provenance:
 * FABRICATED client and errors written from the types of `@opencode/client@2.0.32` (the 404 body
 * `{ _tag: 'McpServerNotFoundError', server, message }` is the one declared there); nothing here
 * says what a real server answers.
 */
describe('the MCP details', () => {
  /** An `mcp.list` answer with one failed server whose error is `error`. */
  const failedWith = (error: string): string =>
    JSON.stringify([{ name: 'broken', status: { status: 'failed', error } }]);

  it('keeps the whole error as a scrubbed, bounded detail', async () => {
    const error = `Connection closed at ${SECRETS.url} with ${SECRETS.password}\r\nline two\r\n\r\nline three  \r\n`;
    const { api } = fakeApi({ mcp: failedWith(error) });
    const { store } = setup(api);
    await store.reloadAll();
    const row = store.snapshot().mcp.servers[0];
    expect(row?.error).toBe('Connection closed at <server> with <redacted>');
    expect(row?.detail).toBe(
      'Connection closed at <server> with <redacted>\nline two\n\nline three',
    );
    expect(JSON.stringify(row)).not.toContain(SECRETS.url);
    expect(JSON.stringify(row)).not.toContain(SECRETS.password);
    expect(row?.detail).not.toContain('\r');
  });

  it('cuts the detail to 20 lines and 2000 characters, with an ellipsis, and leaves a one-line error without one', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${String(i + 1)}`);
    expect(detailText(lines.join('\r\n'))).toBe(`${lines.slice(0, 20).join('\n')}…`);
    const wide = detailText(`${'x'.repeat(5000)}\nsecond`);
    expect(wide).toHaveLength(MAX_DETAIL);
    expect(wide.endsWith('…')).toBe(true);
    expect(detailText('a\nb', 5, 100)).toBe('a\nb');
    expect(detailText('\n\n  \nonly\n\n')).toBe('only');
    // A short one-line error is exactly its first line: nothing more to unfold.
    const { api } = fakeApi({ mcp: failedWith('Connection closed') });
    const { store } = setup(api);
    return store.reloadAll().then(() => {
      const row = store.snapshot().mcp.servers[0];
      expect(row?.error).toBe('Connection closed');
      expect('detail' in (row ?? {})).toBe(false);
    });
  });

  it('keeps a long single line whole in the detail while the row line is cut', async () => {
    const { api } = fakeApi({ mcp: failedWith('y'.repeat(500)) });
    const { store } = setup(api);
    await store.reloadAll();
    const row = store.snapshot().mcp.servers[0];
    expect(row?.error).toHaveLength(MAX_TEXT);
    expect(row?.detail).toBe('y'.repeat(500));
  });
});

/**
 * Protects issue #205: the shell row shows what the GLOBAL opencode config holds and what wins
 * over it, never a secret of the document it lives in, and the write waits for the server to
 * reload before reading it back (the 204 comes BEFORE the reload: a read right after it returns
 * the old value). Provenance: FABRICATED entries, shells and client, shaped by the real 2.2.7
 * server the planner of #205 saw (Windows 11, 11/11/2026: bare arrays, `config.updated` about
 * 200 ms after the PATCH, none for a PATCH that changes nothing). Planted secrets prove the
 * allow-list; nothing here proves what a real server answers.
 */
describe('the shell of opencode', () => {
  const doc = (info: string, path = 'C:\\cfg\\opencode.jsonc') =>
    wire<ConfigGetOutput[number]>(
      `{"type":"document","path":${JSON.stringify(path)},"info":${info}}`,
    );
  const dir = wire<ConfigGetOutput[number]>(`{"type":"directory","path":"C:\\\\cfg"}`);
  const shellOf = (name: string, path: string, acceptable = true) => ({ name, path, acceptable });

  it('takes the last shell of the global group, and none when no document holds one', () => {
    expect(toShellState([doc('{"shell":"cmd"}'), doc('{"shell":"bash"}'), dir], [])).toMatchObject({
      current: 'bash',
      overridden: false,
    });
    expect(toShellState([doc('{}'), dir], [])).toMatchObject({ current: '', overridden: false });
    expect(toShellState([], [])).toEqual({ current: '', overridden: false, options: [] });
  });

  it('flags overridden only for a later document with a different shell', () => {
    const global = doc('{"shell":"bash"}');
    expect(toShellState([global, dir, doc('{"shell":"cmd"}')], [])).toMatchObject({
      current: 'bash',
      overridden: true,
    });
    expect(toShellState([global, dir, doc('{"shell":"bash"}')], []).overridden).toBe(false);
    expect(toShellState([global, dir, doc('{"model":"a/b"}')], []).overridden).toBe(false);
    expect(toShellState([dir, doc('{"shell":"cmd"}')], [])).toMatchObject({
      current: '',
      overridden: true,
    });
  });

  it('offers the shells by name, by path when two share one, and marks the unacceptable', () => {
    const { options } = toShellState(
      [],
      [
        shellOf('bash', '/usr/bin/bash'),
        shellOf('bash', '/opt/bin/bash'),
        shellOf('fish', '/usr/bin/fish', false),
        shellOf('zsh', '/bin/zsh'),
      ],
    );
    expect(options).toEqual([
      { value: '/usr/bin/bash', name: '/usr/bin/bash', terminalOnly: false },
      { value: '/opt/bin/bash', name: '/opt/bin/bash', terminalOnly: false },
      { value: 'fish', name: 'fish', terminalOnly: true },
      { value: 'zsh', name: 'zsh', terminalOnly: false },
    ]);
  });

  it('adds a current shell no option offers, and drops options it cannot send back exact', () => {
    const long = 'x'.repeat(2001);
    const { options } = toShellState(
      [doc('{"shell":"nu-custom"}'), dir],
      [
        shellOf('fish', '/usr/bin/fish'),
        shellOf('', '/x'),
        shellOf('cmd', ''),
        shellOf(long, '/y'),
        shellOf('toolong', long),
        wire<ConfigShellsOutput[number]>(`{"name":7,"path":"/z","acceptable":true}`),
      ],
    );
    expect(options.map((option) => option.value)).toEqual(['fish', 'nu-custom']);
  });

  it('keeps no planted secret from the document or the shells in a serialized snapshot', async () => {
    const { api, shell } = fakeApi();
    shell.entries = [
      doc(
        `{"shell":"bash","username":"hdr-planted-token","providers":{"x":{"options":{"apiKey":"sk-planted-api-key"}}},"mcp":{"y":{"headers":{"Authorization":"at-planted-access"}}}}`,
      ),
      dir,
    ];
    shell.shells = [
      wire<ConfigShellsOutput[number]>(
        `{"name":"bash","path":"/usr/bin/bash","acceptable":true,"env":{"K":"rt-planted-refresh"}}`,
      ),
    ];
    const { store } = setup(api);
    await store.reloadAll();
    const json = JSON.stringify(store.snapshot());
    for (const secret of PLANTED) expect(json).not.toContain(secret);
    // ...while the allowed fields did arrive, so the check is not vacuous.
    expect(store.snapshot().shell).toEqual({
      loaded: true,
      failed: false,
      writing: false,
      current: 'bash',
      overridden: false,
      options: [{ value: 'bash', name: 'bash', terminalOnly: false }],
    });
  });

  it('reads on server.connected and on a config.updated nobody is waiting for', async () => {
    const { api, shell } = fakeApi();
    const { store } = setup(api);
    store.event('server.connected');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shell.gets).toBe(1);
    shell.entries = [doc('{"shell":"cmd"}'), dir];
    store.event('config.updated');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shell.gets).toBe(2);
    expect(store.snapshot().shell.current).toBe('cmd');
  });

  it('keeps the previous shell, sets failed and logs the code when the read fails', async () => {
    const { api, shell } = fakeApi();
    shell.entries = [doc('{"shell":"cmd"}'), dir];
    const { store, lines } = setup(api);
    await store.reloadAll();
    shell.fail = true;
    await store.reloadAll();
    expect(store.snapshot().shell).toMatchObject({ loaded: true, failed: true, current: 'cmd' });
    expect(lines.some((line) => line.startsWith('warn: shell read failed'))).toBe(true);
    expect(lines.join('\n')).not.toContain(SECRETS.url);
  });

  describe('shell actions', () => {
    /** A store whose server reloads `delay` ms (fake time) after the PATCH, like the real one. */
    function reloading(value: string | null) {
      const made = fakeApi();
      made.shell.entries = [doc('{}'), dir];
      made.shell.onPatch = () => {
        made.shell.entries = [doc(value === null ? '{}' : `{"shell":"${value}"}`), dir];
      };
      return { ...made, ...setup(made.api) };
    }

    it('sends one PATCH with null for Automatic and the value otherwise', async () => {
      vi.useFakeTimers();
      const a = reloading('bash');
      const first = a.store.shellAction('bash');
      a.store.event('config.updated');
      expect(await first).toEqual({ kind: 'done' });
      expect(a.shell.patches).toEqual([{ shell: 'bash' }]);
      const second = a.store.shellAction('');
      a.store.event('config.updated');
      expect(await second).toEqual({ kind: 'done' });
      expect(a.shell.patches).toEqual([{ shell: 'bash' }, { shell: null }]);
    });

    it('does not re-read before config.updated, and reads the new value on it', async () => {
      vi.useFakeTimers();
      const a = reloading('bash');
      await a.store.reloadAll();
      const reads = a.shell.gets;
      let settled = false;
      const pending = a.store.shellAction('bash').then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(SHELL_SETTLE_MS - 100);
      expect(settled).toBe(false);
      expect(a.shell.gets).toBe(reads);
      a.store.event('config.updated');
      expect(await pending).toEqual({ kind: 'done' });
      expect(a.shell.gets).toBe(reads + 1);
      expect(a.store.snapshot().shell.current).toBe('bash');
      expect(a.lines).toContain('info: shell set');
    });

    it('re-reads after SHELL_SETTLE_MS when no config.updated comes', async () => {
      vi.useFakeTimers();
      const a = reloading('bash');
      await a.store.reloadAll();
      const reads = a.shell.gets;
      const pending = a.store.shellAction('bash');
      await vi.advanceTimersByTimeAsync(SHELL_SETTLE_MS - 1);
      expect(a.shell.gets).toBe(reads);
      await vi.advanceTimersByTimeAsync(2);
      expect(await pending).toEqual({ kind: 'done' });
      expect(a.shell.gets).toBe(reads + 1);
      expect(a.store.snapshot().shell.current).toBe('bash');
    });

    it('goes on at once when config.updated arrived before the 204', async () => {
      vi.useFakeTimers();
      const a = reloading('bash');
      a.shell.onPatch = () => {
        a.shell.entries = [doc('{"shell":"bash"}'), dir];
        a.store.event('config.updated');
      };
      expect(await a.store.shellAction('bash')).toEqual({ kind: 'done' });
      expect(a.store.snapshot().shell.current).toBe('bash');
    });

    it('says writing from the call until the re-read ends, and tells the listeners', async () => {
      vi.useFakeTimers();
      const a = reloading('bash');
      await a.store.reloadAll();
      const seen: boolean[] = [];
      a.store.onDidChange(() => seen.push(a.store.snapshot().shell.writing));
      const pending = a.store.shellAction('bash');
      expect(a.store.snapshot().shell.writing).toBe(true);
      a.store.event('config.updated');
      await pending;
      expect(a.store.snapshot().shell.writing).toBe(false);
      expect(seen[0]).toBe(true);
      expect(seen[seen.length - 1]).toBe(false);
    });

    it('fails with the code in the log and without the value when the PATCH is rejected', async () => {
      vi.useFakeTimers();
      const a = reloading('bash');
      await a.store.reloadAll();
      const reads = a.shell.gets;
      a.shell.patchError = {
        _tag: 'InvalidRequestError',
        message: `Missing key at ${SECRETS.url} for C:\\Users\\planted-user`,
      };
      const result = await a.store.shellAction('C:\\Users\\planted-user\\bash.exe');
      expect(result).toMatchObject({ kind: 'failed' });
      expect(result.kind === 'failed' ? result.message : '').not.toContain(SECRETS.url);
      expect(a.lines).toContain('warn: shell set failed: InvalidRequestError');
      expect(a.lines.join('\n')).not.toContain('planted-user');
      expect(a.shell.gets).toBe(reads);
      expect(a.store.snapshot().shell.writing).toBe(false);
    });

    it('fails without a server, and gives up silently when the server was replaced', async () => {
      vi.useFakeTimers();
      const a = reloading('bash');
      a.store.detach();
      expect(await a.store.shellAction('bash')).toMatchObject({ kind: 'failed' });
      expect(a.shell.patches).toEqual([]);
      a.store.attach(a.api, 2, SECRETS);
      const pending = a.store.shellAction('bash');
      a.store.attach(a.api, 3, SECRETS);
      expect(await pending).toMatchObject({ kind: 'failed' });
      expect(a.lines.filter((line) => line.includes('shell set'))).toEqual([]);
      expect(a.store.snapshot().shell.writing).toBe(false);
    });

    /**
     * Protects the waiter of a newer write (W1 of the review of #205): an old PATCH that settles
     * after the server was replaced must not clear the waiter the new write installed, or the new
     * `config.updated` goes to the plain read and the write sleeps the whole SHELL_SETTLE_MS.
     * Fabricated timeline (fake client, fake timers). Mutation run: with the unconditional
     * `this.shellWaiter = undefined` back in `shellAction`, this check failed (the second write
     * had not settled 100 ms after the event).
     */
    it('does not clear the waiter of a newer write when an old PATCH settles late', async () => {
      vi.useFakeTimers();
      const a = reloading('bash');
      let release: () => void = () => undefined;
      a.shell.patchGate = { promise: new Promise<void>((resolve) => (release = resolve)) };
      const old = a.store.shellAction('bash');
      a.store.attach(a.api, 2, SECRETS);
      let settled = false;
      const fresh = a.store.shellAction('bash').then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(10);
      release();
      expect(await old).toMatchObject({ kind: 'failed' });
      a.store.event('config.updated');
      await vi.advanceTimersByTimeAsync(100);
      expect(settled).toBe(true);
      expect(await fresh).toEqual({ kind: 'done' });
    });
  });
});

describe('the MCP actions', () => {
  const connectedDocs = '[{"name":"docs","status":{"status":"connected"}}]';
  const disabledDocs = '[{"name":"docs","status":{"status":"disabled"}}]';

  it('connects once and has read the list again before it resolves', async () => {
    const { api, calls, state, writes } = fakeApi({ mcp: disabledDocs });
    const { store, lines } = setup(api);
    await store.reloadAll();
    const reads = calls.mcp;
    state.onWrite = () => {
      state.mcp = connectedDocs;
    };
    const result = await store.mcpAction('docs', 'connect');
    expect(result).toEqual({ kind: 'done' });
    expect(writes).toEqual(['connect docs']);
    expect(calls.mcp).toBe(reads + 1);
    // The row already says what the server became: no optimistic state in between.
    expect(store.snapshot().mcp.servers[0]?.status).toBe('connected');
    expect(lines).toContain('info: mcp connect: docs');
  });

  it('disconnects with the other route', async () => {
    const { api, state, writes } = fakeApi({ mcp: connectedDocs });
    const { store } = setup(api);
    await store.reloadAll();
    state.onWrite = () => {
      state.mcp = disabledDocs;
    };
    expect(await store.mcpAction('docs', 'disconnect')).toEqual({ kind: 'done' });
    expect(writes).toEqual(['disconnect docs']);
    expect(store.snapshot().mcp.servers[0]?.status).toBe('disabled');
  });

  it('resolves a failed call with the scrubbed message, a log line without it, and no re-read', async () => {
    const { api, calls, state, writes } = fakeApi({ mcp: disabledDocs });
    const { store, lines } = setup(api);
    await store.reloadAll();
    const reads = calls.mcp;
    state.writeError = new Error(`cannot reach ${SECRETS.url} using ${SECRETS.password}`);
    const result = await store.mcpAction('docs', 'connect');
    expect(result).toMatchObject({ kind: 'failed', notFound: false });
    const message = result.kind === 'failed' ? result.message : '';
    expect(message).toContain('<server>');
    expect(message).not.toContain(SECRETS.url);
    expect(message).not.toContain(SECRETS.password);
    expect(writes).toEqual(['connect docs']);
    expect(calls.mcp).toBe(reads);
    const line = lines.find((entry) => entry.startsWith('warn: mcp connect failed'));
    expect(line).toBe('warn: mcp connect failed: docs: Error');
  });

  it('flags the 404 of a server that left the config as notFound', async () => {
    const { api, state } = fakeApi({ mcp: disabledDocs });
    const { store } = setup(api);
    await store.reloadAll();
    state.writeError = {
      _tag: 'McpServerNotFoundError',
      server: 'docs',
      message: 'No MCP server docs',
    };
    expect(await store.mcpAction('docs', 'connect')).toEqual({
      kind: 'failed',
      message: 'No MCP server docs',
      notFound: true,
    });
  });

  it('fails without a server and writes nothing', async () => {
    const { api, writes } = fakeApi({ mcp: disabledDocs });
    const { store } = setup(api);
    store.detach();
    const result = await store.mcpAction('docs', 'connect');
    expect(result).toMatchObject({ kind: 'failed', notFound: false });
    expect(writes).toEqual([]);
  });

  it('fails when the server was replaced during the call', async () => {
    const { api, state } = fakeApi({ mcp: disabledDocs });
    const { store } = setup(api);
    await store.reloadAll();
    state.onWrite = () => {
      store.attach(api, 2, SECRETS);
    };
    expect(await store.mcpAction('docs', 'connect')).toMatchObject({ kind: 'failed' });
  });

  /**
   * Protects the mitigation for the HYPOTHESIS that the `mcp_...` integration is registered after
   * the first integration read: a server naming an integration the rows do not have makes the store
   * read the integrations again. The queues are drained with a macrotask before counting.
   */
  it('reads the integrations again when a server names one the rows do not have', async () => {
    const { api, calls, state } = fakeApi({ mcp: '[]' });
    const { store } = setup(api);
    await store.reloadAll();
    const before = calls.integrations;
    state.mcp = `[{"name":"linear","status":{"status":"needs_auth","error":"Sign in"},"integrationID":"mcp_0123456789abcdef"}]`;
    store.event('mcp.status.changed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.integrations).toBe(before + 1);
    // Now the row exists: the same id no longer triggers a read.
    state.integrations = [
      wire<IntegrationInfo>(
        `{"id":"mcp_0123456789abcdef","name":"linear","metadata":{"source":"mcp"},"methods":[],"connections":[]}`,
      ),
    ];
    await store.reloadAll();
    const settled = calls.integrations;
    store.event('mcp.status.changed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.integrations).toBe(settled);
  });

  it('does not read the integrations before they were read once', async () => {
    const { api, calls } = fakeApi({
      mcp: `[{"name":"linear","status":{"status":"needs_auth","error":"x"},"integrationID":"mcp_0123456789abcdef"}]`,
    });
    const { store } = setup(api);
    await store.mcpAction('linear', 'connect');
    store.event('mcp.status.changed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.integrations).toBe(0);
  });
});
