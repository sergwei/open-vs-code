// Protects the HTTP/SSE WIRING of the chat: the real `@opencode/client` (bundled by Vitest), the
// real reconnecting loop and the real controller talking to a server over a socket. What can break
// here and nowhere else: the Basic auth header, the `x-opencode-directory` header, the unwrapping
// of `{data}`, the SSE parsing and the client's behaviour when the stream is cut. Phase 2 adds the
// interrupt route: its answer `{interrupted}` is BARE (no `{data}`); a client that unwrapped it
// would read `interrupted` as undefined and every abort would silently end in a resync.
//
// Provenance of the data: `test-fixtures/fake-opencode.mjs` is a SYNTHETIC server that replays the
// event order recorded from a real opencode 2.0.32 (planner spike, Windows 11, 2026-10-20) with
// made-up ids and texts. A pass proves our wiring against the client's own request/stream code, NOT
// that a real opencode answers like the fixture; the real-server run is the opt-in
// `realOpencode.test.ts`.
// E3-resolved-history: the cases tagged `E3:` protect the record of answered requests. The final
// states of the asking tool in the fixture copy rows of a real opencode 2.0.32 database (a rejected
// `read`, an answered `question`); the rejection WITH feedback and the dismissals are read in the
// sources only. The webview-side derivation of those states is `toolOutcome.test.ts`.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostToWebview } from '../shared/protocol';
import { ChatController } from './chatController';
import { createOpencodeClient } from './opencodeClient';
import { startServer, stopServer, type RunningServer, type ServerLog } from './opencodeServer';
import type { PendingSummary } from './pendingRequests';
import type { ServerState } from './serverManager';

const FIXTURE = fileURLToPath(new URL('./test-fixtures/fake-opencode.mjs', import.meta.url));

const quiet: ServerLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const servers: RunningServer[] = [];
const folders: string[] = [];
const controllers: ChatController[] = [];

afterEach(async () => {
  // Controllers first: their reconnection loop must not outlive the server it talks to, even if
  // an assertion failed before the end of the test.
  for (const controller of controllers.splice(0)) controller.dispose();
  for (const server of servers.splice(0)) await stopServer(server.child, quiet);
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

/** Polls until `check` returns a truthy value, or fails with `label` after `timeoutMs`. */
async function waitUntil(check: () => boolean, label: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Starts the fixture and a controller wired to it with the real client. */
async function boot(mode: string) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'ovsc-chat-'));
  folders.push(folder);
  const server = await startServer({
    command: process.execPath,
    prefixArgs: [FIXTURE],
    folder,
    port: 0,
    log: quiet,
    baseEnv: { ...process.env, FAKE_OPENCODE_MODE: mode },
  });
  servers.push(server);
  const posted: HostToWebview[] = [];
  const remembered: Array<string | undefined> = [];
  const attention: Array<readonly PendingSummary[]> = [];
  const controller = new ChatController({
    createClient: createOpencodeClient,
    editor: {
      open: () => Promise.resolve(),
      insert: () => Promise.resolve(),
      newFile: () => Promise.resolve(),
      copy: () => Promise.resolve(),
      pickFiles: () => Promise.resolve([]),
    },
    post: (message) => posted.push(message),
    log: quiet,
    memory: {
      get: () => undefined,
      set: (_folder, id) => {
        remembered.push(id);
        return Promise.resolve();
      },
    },
    attention: {
      update: (requests) => {
        attention.push(requests);
      },
    },
    savedPermissions: { pickToRevoke: () => Promise.resolve([]) },
    server: { restart: () => undefined, showLogs: () => undefined },
  });
  controllers.push(controller);
  const state: ServerState = {
    kind: 'running',
    server: {
      url: server.url,
      password: server.password,
      version: '2.0.32',
      folder,
      binaryPath: process.execPath,
      pid: server.child.pid,
    },
  };
  return { controller, posted, remembered, state, attention };
}

describe('chat over HTTP and SSE against the synthetic server', () => {
  it('connects, sends a prompt and streams the reply to the webview messages', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(
      () => posted.some((m) => m.type === 'connection.state' && m.connection.state === 'connected'),
      'connected',
    );
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');

    await controller.handle({ type: 'ready' });
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'Reply with exactly: hello there',
      delivery: 'queue',
      files: [],
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish',
    );

    expect(posted).toContainEqual({ type: 'request.result', requestId: 'r1' });
    const user = posted.find((m) => m.type === 'message.upserted' && m.message.kind === 'user');
    expect(user).toMatchObject({ message: { text: 'Reply with exactly: hello there' } });
    const finalText = posted.filter((m) => m.type === 'part.upserted').at(-1);
    expect(finalText).toMatchObject({ part: { type: 'text', text: 'hello there' } });
    const deltas = posted.filter((m) => m.type === 'part.delta');
    expect(deltas.length).toBeGreaterThanOrEqual(4);
    // The session was created in the workspace folder through the header, and remembered.
    const snapshot = posted.filter((m) => m.type === 'snapshot').at(-1);
    expect(snapshot?.type === 'snapshot' ? snapshot.snapshot.open?.sessionID : undefined).toMatch(
      /^ses_/,
    );
  }, 20_000);

  it('shows the error of a failed run and accepts another prompt afterwards', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'FAIL please',
      delivery: 'queue',
      files: [],
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'error'),
      'the failure',
    );
    expect(
      posted.find((m) => m.type === 'session.status' && m.status.type === 'error'),
    ).toMatchObject({
      status: { error: { code: 'provider.no-route' } },
    });
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r2',
      text: 'again',
      delivery: 'queue',
      files: [],
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the second turn',
    );
  }, 20_000);

  it('interrupts a turn in flight: bare {interrupted} body, then an idle status from the event', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'SLOW count to 400',
      delivery: 'queue',
      files: [],
    });
    const snapshot = posted.filter((m) => m.type === 'snapshot').at(-1);
    const sessionID = snapshot?.type === 'snapshot' ? snapshot.snapshot.open?.sessionID : undefined;
    expect(sessionID).toMatch(/^ses_/);
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'busy'),
      'busy',
    );

    const snapshotsBefore = posted.filter((m) => m.type === 'snapshot').length;
    await controller.handle({ type: 'session.abort', requestId: 'a1', sessionID: sessionID ?? '' });
    expect(posted).toContainEqual({ type: 'request.result', requestId: 'a1' });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'idle after the interruption',
    );
    // `interrupted: true` was read from the bare body: no healing resync was needed.
    expect(posted.filter((m) => m.type === 'snapshot').length).toBe(snapshotsBefore);
  }, 20_000);

  it('answers {interrupted:false} for an idle session and resyncs instead of failing', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await controller.handle({ type: 'session.new', requestId: 'n1' });
    const before = posted.filter((m) => m.type === 'snapshot').length;
    const snapshot = posted.filter((m) => m.type === 'snapshot').at(-1);
    const sessionID = snapshot?.type === 'snapshot' ? snapshot.snapshot.open?.sessionID : undefined;
    await controller.handle({ type: 'session.abort', requestId: 'a1', sessionID: sessionID ?? '' });
    expect(posted).toContainEqual({ type: 'request.result', requestId: 'a1' });
    expect(posted.filter((m) => m.type === 'snapshot').length).toBeGreaterThan(before);
  }, 20_000);

  /** Boots, connects, sends `text` and waits for the first request of `kind` to be announced. */
  async function askAndWait(text: string, kind: 'permission' | 'form') {
    const booted = await boot('ok');
    const { controller, posted, state } = booted;
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text,
      delivery: 'queue',
      files: [],
    });
    const snapshot = posted.filter((m) => m.type === 'snapshot').at(-1);
    const sessionID = snapshot?.type === 'snapshot' ? snapshot.snapshot.open?.sessionID : undefined;
    await waitUntil(() => posted.some((m) => m.type === `${kind}.asked`), `${kind}.asked`);
    const ask = posted.find((m) => m.type === `${kind}.asked`);
    const id =
      ask?.type === 'permission.asked'
        ? ask.permission.id
        : ask?.type === 'form.asked'
          ? ask.form.id
          : '';
    return { ...booted, sessionID: sessionID ?? '', id };
  }

  it('a permission pauses the turn; allowing it once resolves the card and the turn finishes', async () => {
    const { controller, posted, attention, sessionID, id } = await askAndWait(
      'ASK_PERMISSION read .env',
      'permission',
    );
    expect(posted.find((m) => m.type === 'permission.asked')).toMatchObject({
      permission: { action: 'read', resources: ['.env'], save: ['*'], sessionID },
    });
    expect(attention.at(-1)?.map((item) => item.id)).toEqual([id]);
    // The turn is paused: no idle status while the request is pending.
    expect(posted.some((m) => m.type === 'session.status' && m.status.type === 'idle')).toBe(false);

    await controller.handle({
      type: 'permission.reply',
      requestId: 'p1',
      sessionID,
      permissionID: id,
      decision: 'once',
    });
    expect(posted).toContainEqual({ type: 'request.result', requestId: 'p1' });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish after the reply',
    );
    // E3-resolved-history: the message leaves the host with the record of the answer attached.
    expect(posted.find((m) => m.type === 'permission.resolved')).toMatchObject({
      type: 'permission.resolved',
      sessionID,
      permissionID: id,
      decision: 'once',
      resolution: {
        kind: 'permission',
        id,
        sessionID,
        decision: 'once',
        action: 'read',
        resource: '.env',
        withFeedback: false,
      },
    });
    expect(attention.at(-1)).toEqual([]);
  }, 20_000);

  it('rejecting with feedback fails the tool and the turn still ends', async () => {
    const { controller, posted, sessionID, id } = await askAndWait('ASK_PERMISSION', 'permission');
    await controller.handle({
      type: 'permission.reply',
      requestId: 'p1',
      sessionID,
      permissionID: id,
      decision: 'reject',
      message: "don't read secrets",
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish after the reject',
    );
    const failed = posted.filter(
      (m) =>
        m.type === 'part.upserted' && m.part.type === 'tool' && m.part.state.status === 'error',
    );
    expect(failed.length).toBeGreaterThan(0);
    expect(posted).toContainEqual(
      expect.objectContaining({ type: 'permission.resolved', decision: 'reject' }),
    );
  }, 20_000);

  it('a second reply to an already answered permission is refused by the host itself (RequestNotPending) and resyncs', async () => {
    const { controller, posted, sessionID, id } = await askAndWait('ASK_PERMISSION', 'permission');
    const reply = (requestId: string) =>
      controller.handle({
        type: 'permission.reply',
        requestId,
        sessionID,
        permissionID: id,
        decision: 'once',
      });
    await reply('p1');
    // Wait for the event: only then is the host's registry guaranteed to have dropped the request,
    // so `RequestNotPending` (an error only the HOST produces, never the server) is deterministic.
    await waitUntil(() => posted.some((m) => m.type === 'permission.resolved'), 'resolved');
    const before = posted.filter((m) => m.type === 'snapshot').length;
    await reply('p2');
    const second = posted.find((m) => m.type === 'request.result' && m.requestId === 'p2');
    expect(second?.type === 'request.result' ? second.error?.code : undefined).toBe(
      'RequestNotPending',
    );
    expect(posted.filter((m) => m.type === 'snapshot').length).toBeGreaterThan(before);
  }, 20_000);

  it('the SERVER answers 404 PermissionNotFoundError to a reply for a resolved permission (real client, direct call)', async () => {
    const { controller, posted, state, sessionID, id } = await askAndWait(
      'ASK_PERMISSION',
      'permission',
    );
    await controller.handle({
      type: 'permission.reply',
      requestId: 'p1',
      sessionID,
      permissionID: id,
      decision: 'once',
    });
    await waitUntil(() => posted.some((m) => m.type === 'permission.resolved'), 'resolved');
    // Bypasses the host's registry on purpose, so the request really reaches the fixture. That the
    // controller resyncs on this tag is covered by the unit test "answers a request that is gone".
    if (state.kind !== 'running') throw new Error('the server is not running');
    const client = createOpencodeClient(state.server);
    await expect(
      client.permission.reply({ sessionID, requestID: id, decision: 'once' }),
    ).rejects.toMatchObject({ _tag: 'PermissionNotFoundError' });
  }, 20_000);

  it('the snapshot lists the pending request through /api/permission/request ({location, data} unwrapped by us)', async () => {
    const { controller, posted, id } = await askAndWait('ASK_PERMISSION', 'permission');
    await controller.handle({ type: 'ready' });
    const snapshot = posted.filter((m) => m.type === 'snapshot').at(-1);
    expect(snapshot?.type === 'snapshot' ? snapshot.snapshot.requests.permissions : []).toEqual([
      expect.objectContaining({ id, action: 'read', resources: ['.env'] }),
    ]);
  }, 20_000);

  it('answering a question resolves the form as answered and the turn finishes', async () => {
    const { controller, posted, sessionID, id } = await askAndWait('ASK_QUESTION pick', 'form');
    expect(posted.find((m) => m.type === 'form.asked')).toMatchObject({
      form: { kind: 'question', fields: [{ key: 'q0', custom: true }, { key: 'q1' }] },
    });
    await controller.handle({
      type: 'form.reply',
      requestId: 'f1',
      sessionID,
      formID: id,
      answer: { q0: 'A', q1: ['x'] },
    });
    expect(posted).toContainEqual({ type: 'request.result', requestId: 'f1' });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish after the answer',
    );
    expect(posted.find((m) => m.type === 'form.resolved')).toMatchObject({
      type: 'form.resolved',
      sessionID,
      formID: id,
      outcome: 'answered',
      resolution: { kind: 'form', id, sessionID, outcome: 'answered', formKind: 'question' },
    });
  }, 20_000);

  /** The last snapshot posted, or fails the test. */
  function lastSnapshot(posted: HostToWebview[]) {
    const snapshot = posted.filter((m) => m.type === 'snapshot').at(-1);
    if (snapshot?.type !== 'snapshot') throw new Error('no snapshot was posted');
    return snapshot.snapshot;
  }

  it('E3: a rejection with feedback is recorded, and a later snapshot carries the record AND the failed tool block', async () => {
    const { controller, posted, sessionID, id } = await askAndWait('ASK_PERMISSION', 'permission');
    await controller.handle({
      type: 'permission.reply',
      requestId: 'p1',
      sessionID,
      permissionID: id,
      decision: 'reject',
      message: "don't read secrets",
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish after the reject',
    );
    expect(posted.find((m) => m.type === 'permission.resolved')).toMatchObject({
      resolution: { decision: 'reject', withFeedback: true },
    });
    // What a reconnection (or a view that was hidden) does: ask for a fresh snapshot.
    await controller.handle({ type: 'ready' });
    const snapshot = lastSnapshot(posted);
    expect(snapshot.resolutions).toMatchObject([{ kind: 'permission', id, withFeedback: true }]);
    const tool = Object.values(snapshot.open?.parts ?? {})
      .flat()
      .find((part) => part.type === 'tool');
    // The feedback text travels in the tool block, NOT in the record.
    expect(tool).toMatchObject({
      name: 'read',
      state: {
        status: 'error',
        error: { code: 'permission.rejected', message: "don't read secrets" },
      },
    });
    expect(JSON.stringify(snapshot.resolutions)).not.toContain("don't read secrets");
  }, 20_000);

  it('E3: a plain rejection leaves the aborted/declined tool block in the snapshot', async () => {
    const { controller, posted, sessionID, id } = await askAndWait('ASK_PERMISSION', 'permission');
    await controller.handle({
      type: 'permission.reply',
      requestId: 'p1',
      sessionID,
      permissionID: id,
      decision: 'reject',
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish after the reject',
    );
    await controller.handle({ type: 'ready' });
    const snapshot = lastSnapshot(posted);
    expect(snapshot.resolutions).toMatchObject([{ decision: 'reject', withFeedback: false }]);
    const tool = Object.values(snapshot.open?.parts ?? {})
      .flat()
      .find((part) => part.type === 'tool');
    expect(tool).toMatchObject({
      state: {
        status: 'error',
        error: { code: 'aborted', message: 'The user declined this tool call' },
      },
    });
  }, 20_000);

  it('E3: an answered question completes the tool with metadata.answers; the record has no answer', async () => {
    const { controller, posted, sessionID, id } = await askAndWait('ASK_QUESTION pick', 'form');
    await controller.handle({
      type: 'form.reply',
      requestId: 'f1',
      sessionID,
      formID: id,
      answer: { q0: 'A', q1: ['x'] },
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish after the answer',
    );
    await controller.handle({ type: 'ready' });
    const snapshot = lastSnapshot(posted);
    expect(snapshot.resolutions).toMatchObject([
      { kind: 'form', id, outcome: 'answered', formKind: 'question', withMessage: false },
    ]);
    expect(JSON.stringify(snapshot.resolutions)).not.toContain('"x"');
    const tool = Object.values(snapshot.open?.parts ?? {})
      .flat()
      .find((part) => part.type === 'tool');
    expect(tool).toMatchObject({
      name: 'question',
      state: { status: 'completed', metadata: { answers: [['A'], ['x']] } },
    });
  }, 20_000);

  it('E3: a dismissal with a note is recorded as withMessage and the block carries the note', async () => {
    const { controller, posted, sessionID, id } = await askAndWait('ASK_QUESTION', 'form');
    await controller.handle({
      type: 'form.cancel',
      requestId: 'c1',
      sessionID,
      formID: id,
      message: 'in my own words',
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish after the dismissal',
    );
    await controller.handle({ type: 'ready' });
    const snapshot = lastSnapshot(posted);
    expect(snapshot.resolutions).toMatchObject([
      { kind: 'form', outcome: 'cancelled', withMessage: true },
    ]);
    const tool = Object.values(snapshot.open?.parts ?? {})
      .flat()
      .find((part) => part.type === 'tool');
    expect(tool).toMatchObject({
      state: { status: 'error', error: { code: 'tool.execution', message: 'in my own words' } },
    });
  }, 20_000);

  it('an invalid answer comes back as the error and the form stays pending', async () => {
    const { controller, posted, sessionID, id } = await askAndWait('ASK_QUESTION', 'form');
    const snapshots = posted.filter((m) => m.type === 'snapshot').length;
    await controller.handle({
      type: 'form.reply',
      requestId: 'f1',
      sessionID,
      formID: id,
      answer: { q0: '' },
    });
    expect(posted.find((m) => m.type === 'request.result' && m.requestId === 'f1')).toMatchObject({
      error: { code: 'FormInvalidAnswerError' },
    });
    expect(posted.some((m) => m.type === 'form.resolved')).toBe(false);
    // No resync: the card must stay as the user left it.
    expect(posted.filter((m) => m.type === 'snapshot').length).toBe(snapshots);
  }, 20_000);

  it('cancelling a form uses DELETE and resolves it as cancelled; a repeat is refused by the host (RequestNotPending) and resyncs', async () => {
    const { controller, posted, sessionID, id } = await askAndWait('ASK_QUESTION', 'form');
    await controller.handle({
      type: 'form.cancel',
      requestId: 'c1',
      sessionID,
      formID: id,
      message: 'in my own words',
    });
    expect(posted).toContainEqual({ type: 'request.result', requestId: 'c1' });
    await waitUntil(() => posted.some((m) => m.type === 'form.resolved'), 'form.resolved');
    expect(posted.find((m) => m.type === 'form.resolved')).toMatchObject({ outcome: 'cancelled' });

    const before = posted.filter((m) => m.type === 'snapshot').length;
    await controller.handle({ type: 'form.cancel', requestId: 'c2', sessionID, formID: id });
    // `form.resolved` was already seen, so the host's registry dropped the form: the host refuses.
    const again = posted.find((m) => m.type === 'request.result' && m.requestId === 'c2');
    expect(again?.type === 'request.result' ? again.error?.code : undefined).toBe(
      'RequestNotPending',
    );
    expect(posted.filter((m) => m.type === 'snapshot').length).toBeGreaterThan(before);
  }, 20_000);

  it('the SERVER answers 409 FormAlreadySettledError to a second cancel of a settled form (real client, direct call)', async () => {
    const { controller, posted, state, sessionID, id } = await askAndWait('ASK_QUESTION', 'form');
    await controller.handle({ type: 'form.cancel', requestId: 'c1', sessionID, formID: id });
    await waitUntil(() => posted.some((m) => m.type === 'form.resolved'), 'form.resolved');
    if (state.kind !== 'running') throw new Error('the server is not running');
    const client = createOpencodeClient(state.server);
    await expect(client.session.form.cancel({ sessionID, formID: id })).rejects.toMatchObject({
      _tag: 'FormAlreadySettledError',
    });
  }, 20_000);

  it('an interrupt deletes the pending permission WITHOUT an event: the resync removes the card', async () => {
    const { controller, posted, attention, sessionID } = await askAndWait(
      'ASK_PERMISSION',
      'permission',
    );
    const snapshotsBefore = posted.filter((m) => m.type === 'snapshot').length;
    await controller.handle({ type: 'session.abort', requestId: 'a1', sessionID });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'idle after the interruption',
    );
    // The cure: a snapshot taken AFTER the interrupt, which no longer lists the request.
    await waitUntil(() => {
      const snapshots = posted.filter((m) => m.type === 'snapshot');
      const last = snapshots.at(-1);
      return (
        snapshots.length > snapshotsBefore &&
        last?.type === 'snapshot' &&
        last.snapshot.requests.permissions.length === 0
      );
    }, 'a snapshot without the request');
    expect(posted.some((m) => m.type === 'permission.resolved')).toBe(false);
    expect(attention.at(-1)).toEqual([]);
  }, 20_000);

  it('reconnects and sends a second snapshot when the stream is cut', async () => {
    const { controller, posted, state } = await boot('sse-drop');
    controller.onServerState(state);
    await waitUntil(
      () => posted.filter((m) => m.type === 'snapshot').length >= 2,
      'a second snapshot',
      12_000,
    );
    expect(
      posted.some((m) => m.type === 'connection.state' && m.connection.state === 'reconnecting'),
    ).toBe(true);
    expect(posted.at(-1)).toBeDefined();
  }, 20_000);
});
