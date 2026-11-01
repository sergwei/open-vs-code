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
import type { IntegrationInfo, McpResourceCatalogOutput } from '@opencode/client';
import {
  MAX_TEXT,
  MCP_FIRST_READ_GRACE_MS,
  ServerConfig,
  firstLine,
  toIntegrationRow,
  toMcpCatalogRows,
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

/** A client whose three reads answer with the (mutable) data and count their calls. */
function fakeApi(
  initial: {
    integrations?: IntegrationInfo[];
    mcp?: string;
    catalog?: McpResourceCatalogOutput['data'];
  } = {},
) {
  const calls: FakeCalls = { integrations: 0, mcp: 0, catalog: 0 };
  const state = {
    integrations: initial.integrations ?? [],
    mcp: initial.mcp ?? '[]',
    catalog: initial.catalog ?? { resources: [], templates: [] },
    /** When set, the next read of that source waits for `release()` and answers afterwards. */
    gate: undefined as { promise: Promise<void>; release: () => void } | undefined,
    fail: undefined as 'integrations' | 'mcp' | 'catalog' | undefined,
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
  return { api, calls, state, gate };
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
      mcp: `[{"name":"docs","status":{"status":"failed","error":"x","headers":{"a":"hdr-planted-token"}},"integrationID":"at-planted-access"}]`,
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
    const { api, calls } = fakeApi();
    const { store } = setup(api);
    store.detach();
    store.event('server.connected');
    await store.reloadAll();
    expect(calls).toEqual({ integrations: 0, mcp: 0, catalog: 0 });
  });
});
