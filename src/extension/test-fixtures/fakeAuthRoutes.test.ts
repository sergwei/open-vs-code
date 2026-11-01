// Protects against: the fake server's AUTH routes (issue #128, phase 2) drifting from what the
// settings flows (`providerAuth.ts`) and the later integration suites rely on: the 204 of
// `connect/key|external`, the 404s, an `auto` attempt whose link points at the fake's own approval
// page, a `code` attempt, cancel followed by a 404 status, credential removal, and the events in
// the order the planner's spike saw.
//
// Provenance: the real `@opencode/client` against `fake-opencode.mjs`, a SYNTHETIC server. Status
// codes, `_tag`s and the event ORDER follow the planner's spike against a real opencode 2.0.32
// (Windows 11, 01/11/2026); the event `data` fields other than `credential.switched`, and every
// body of the fake, are invented. A pass proves the fake and our wiring, not the real server.
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpencodeClient, type ChatApi } from '../opencodeClient';
import { startServer, stopServer, type RunningServer, type ServerLog } from '../opencodeServer';

const FIXTURE = fileURLToPath(new URL('./fake-opencode.mjs', import.meta.url));
const quiet: ServerLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};
const PLANTED_KEY = 'sk-planted-fake-route';

const servers: RunningServer[] = [];
const stops: AbortController[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) stop.abort();
  for (const server of servers.splice(0)) await stopServer(server.child, quiet);
});

/** Starts the fake and returns a real client for it, the base URL and a recorder of event types. */
async function start() {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'ovsc-auth-'));
  const server = await startServer({
    command: process.execPath,
    prefixArgs: [FIXTURE],
    folder,
    port: 0,
    log: quiet,
    baseEnv: { ...process.env, FAKE_OPENCODE_MODE: '' },
  });
  servers.push(server);
  const api: ChatApi = createOpencodeClient({
    url: server.url,
    password: server.password,
    version: '2.0.32',
    folder,
    binaryPath: undefined,
    pid: undefined,
    source: 'spawned',
  });
  const stop = new AbortController();
  stops.push(stop);
  const events: string[] = [];
  void (async () => {
    try {
      for await (const event of api.event.subscribe({ signal: stop.signal })) {
        if (event.type !== 'server.connected') events.push(event.type);
      }
    } catch {
      // The stream ends with the server or the abort.
    }
  })();
  // The first frame is `server.connected`; give the subscription a moment to be registered.
  await new Promise((resolve) => setTimeout(resolve, 200));
  return { api, url: server.url, events };
}

/** Waits until `events` has at least `count` entries (polling, 5 s at most). */
async function waitForEvents(events: string[], count: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (events.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const SPIKE_ORDER = [
  'credential.updated',
  'provider.updated',
  'model.updated',
  'credential.switched',
  'integration.updated',
];

describe('fake-opencode auth routes', () => {
  it('connects with a key (204, even an empty one), adds the connection and publishes the spike order', async () => {
    const { api, events } = await start();
    await api.integration.connect.key({
      integrationID: 'azure',
      key: PLANTED_KEY,
      answer: { resourceName: 'r' },
    });
    await waitForEvents(events, 5);
    expect(events).toEqual(SPIKE_ORDER);
    const azure = (await api.integration.get({ integrationID: 'azure' })).data;
    expect(azure.connections).toMatchObject([{ type: 'credential', method: 'key' }]);
    expect(JSON.stringify(azure)).not.toContain(PLANTED_KEY);
    await expect(
      api.integration.connect.key({ integrationID: 'azure', key: '' }),
    ).resolves.toBeUndefined();
  });

  it('answers 404 IntegrationNotFoundError for an unknown integration on every connect route', async () => {
    const { api } = await start();
    await expect(
      api.integration.connect.key({ integrationID: 'ghost', key: 'k' }),
    ).rejects.toMatchObject({
      _tag: 'IntegrationNotFoundError',
    });
    await expect(
      api.integration.connect.external({ integrationID: 'ghost', methodID: 'profile' }),
    ).rejects.toMatchObject({ _tag: 'IntegrationNotFoundError' });
    await expect(
      api.integration.oauth.connect({ integrationID: 'ghost', methodID: 'device' }),
    ).rejects.toMatchObject({ _tag: 'IntegrationNotFoundError' });
  });

  it('connects an external method', async () => {
    const { api, events } = await start();
    await api.integration.connect.external({
      integrationID: 'amazon-bedrock',
      methodID: 'profile',
      answer: { profile: 'work' },
    });
    await waitForEvents(events, 5);
    const row = (await api.integration.get({ integrationID: 'amazon-bedrock' })).data;
    expect(row.connections).toMatchObject([{ type: 'credential', method: 'external' }]);
  });

  it('runs an auto attempt: pending, then complete once the approval page is opened', async () => {
    const { api, url, events } = await start();
    const attempt = (
      await api.integration.oauth.connect({
        integrationID: 'openai',
        methodID: 'chatgpt-headless',
      })
    ).data;
    expect(attempt.mode).toBe('auto');
    expect(attempt.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/fake-oauth\/approve\?attempt=att_/);
    expect(new URL(attempt.url).origin).toBe(url);
    const pending = await api.integration.oauth.status({
      integrationID: 'openai',
      attemptID: attempt.attemptID,
    });
    expect(pending.data.status).toBe('pending');
    // `complete` on an auto attempt is a 500 in the spike.
    await expect(
      api.integration.oauth.complete({ integrationID: 'openai', attemptID: attempt.attemptID }),
    ).rejects.toBeDefined();
    // The approval page needs no Basic credentials: a browser opens it.
    expect((await fetch(attempt.url)).status).toBe(200);
    const done = await api.integration.oauth.status({
      integrationID: 'openai',
      attemptID: attempt.attemptID,
    });
    expect(done.data.status).toBe('complete');
    await waitForEvents(events, 5);
    expect(events).toEqual(SPIKE_ORDER);
  });

  it('cancel removes the attempt: status and a second cancel are 404, and the page too', async () => {
    const { api } = await start();
    const attempt = (
      await api.integration.oauth.connect({ integrationID: 'openai', methodID: 'chatgpt-browser' })
    ).data;
    await api.integration.oauth.cancel({ integrationID: 'openai', attemptID: attempt.attemptID });
    await expect(
      api.integration.oauth.status({ integrationID: 'openai', attemptID: attempt.attemptID }),
    ).rejects.toMatchObject({ _tag: 'IntegrationAttemptNotFoundError' });
    await expect(
      api.integration.oauth.cancel({ integrationID: 'openai', attemptID: attempt.attemptID }),
    ).rejects.toMatchObject({ _tag: 'IntegrationAttemptNotFoundError' });
    expect((await fetch(attempt.url)).status).toBe(404);
  });

  it('runs a code attempt: a wrong code is 400, FAKE-CODE connects', async () => {
    const { api } = await start();
    const attempt = (
      await api.integration.oauth.connect({ integrationID: 'fakeco', methodID: 'code' })
    ).data;
    expect(attempt.mode).toBe('code');
    expect(attempt.url.startsWith('https://')).toBe(true);
    await expect(
      api.integration.oauth.complete({
        integrationID: 'fakeco',
        attemptID: attempt.attemptID,
        code: 'nope',
      }),
    ).rejects.toMatchObject({ _tag: 'InvalidRequestError' });
    await api.integration.oauth.complete({
      integrationID: 'fakeco',
      attemptID: attempt.attemptID,
      code: 'FAKE-CODE',
    });
    const row = (await api.integration.get({ integrationID: 'fakeco' })).data;
    expect(row.connections).toMatchObject([{ type: 'credential', method: 'oauth' }]);
  });

  it('refuses a missing required form field with 400 InvalidRequestError', async () => {
    const { api } = await start();
    await expect(
      api.integration.oauth.connect({ integrationID: 'github-copilot', methodID: 'device' }),
    ).rejects.toMatchObject({ _tag: 'InvalidRequestError' });
    const ok = await api.integration.oauth.connect({
      integrationID: 'github-copilot',
      methodID: 'device',
      answer: { deploymentType: 'github.com' },
    });
    expect(ok.data.mode).toBe('auto');
  });

  it('removes a credential (204) and 404s an unknown one', async () => {
    const { api, events } = await start();
    await api.credential.remove({ credentialID: 'cred_fake_anthropic' });
    await waitForEvents(events, 2);
    expect(events).toEqual(['credential.updated', 'integration.updated']);
    const row = (await api.integration.get({ integrationID: 'anthropic' })).data;
    expect(row.connections).toEqual([]);
    await expect(api.credential.remove({ credentialID: 'cred_missing' })).rejects.toBeDefined();
  });
});
