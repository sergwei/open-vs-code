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
// E4-session-management (#20): paging and search over HTTP (the `parentID: null` and the cursor
// round trip through the real client), rename, deleting a running session with a child, a decline,
// a delete by another client, and the lazy "New session".
// E4-fork-subsessions (#21): a fork over HTTP (only the history before the message, a ROOT row with
// `forkOf`, the original intact), a fork made by another client, an unknown message, and a turn
// whose `subagent` tool creates a child session that the host can open and list.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelRef } from '../shared/model';
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
async function boot(
  mode: string,
  confirmDelete: (info: { title: string; running: boolean }) => Promise<boolean> = () =>
    Promise.resolve(true),
) {
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
  let lastModel: ModelRef | undefined;
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
    sessions: { confirmDelete },
    preferences: {
      defaultModel: () => undefined,
      lastModel: () => lastModel,
      setLastModel: (ref) => {
        lastModel = ref;
        return Promise.resolve();
      },
    },
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
    // A session with a finished turn (idle): since issue #20 `session.new` creates nothing.
    await controller.handle({
      type: 'prompt.send',
      requestId: 'p1',
      text: 'hello',
      delivery: 'queue',
      files: [],
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish',
    );
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

  // E4 / issue #20. The fixture copies what the planner spike saw in a real opencode 2.0.32 (cursor
  // returned on every non-empty page, `parentID=null` for roots, children first on delete, the
  // events before the HTTP answer); a pass proves our wiring with the real client, not the server.

  /** A booted controller whose first snapshot has arrived, plus a second, independent client. */
  async function bootSessions(confirm?: Parameters<typeof boot>[1]) {
    const booted = await boot('ok', confirm);
    booted.controller.onServerState(booted.state);
    await waitUntil(() => booted.posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    if (booted.state.kind !== 'running') throw new Error('the server is not running');
    return { ...booted, other: createOpencodeClient(booted.state.server) };
  }

  const pages = (posted: HostToWebview[]) =>
    posted.flatMap((m) => (m.type === 'sessions.page' ? [m] : []));

  it('pages and searches the session list over HTTP: null parentID, cursor round trip, server-side search', async () => {
    const { controller, posted, other } = await bootSessions();
    for (let index = 0; index < 52; index++) {
      await other.session.create({
        title: `${index % 2 === 0 ? 'alpha' : 'BETA'} ${String(index)}`,
      });
    }
    const root = await other.session.create({ title: 'parent' });
    await other.session.create({ title: 'alpha child', parentID: root.id });

    await controller.handle({ type: 'sessions.query', requestId: 'q1', search: '', more: false });
    await controller.handle({ type: 'sessions.query', requestId: 'q2', search: '', more: true });
    const [first, second] = pages(posted);
    expect(first).toMatchObject({ append: false, hasMore: true });
    expect(first?.sessions).toHaveLength(50);
    expect(second).toMatchObject({ append: true, hasMore: false });
    // 52 + the parent = 53 roots, and the child is not one of them.
    const ids = [...(first?.sessions ?? []), ...(second?.sessions ?? [])].map((s) => s.id);
    expect(ids).toHaveLength(53);
    expect(new Set(ids).size).toBe(53);
    expect(
      [...(first?.sessions ?? []), ...(second?.sessions ?? [])].some(
        (s) => s.title === 'alpha child',
      ),
    ).toBe(false);

    // The search is the server's (case-insensitive substring of the title).
    await controller.handle({
      type: 'sessions.query',
      requestId: 'q3',
      search: 'beta',
      more: false,
    });
    const found = pages(posted).at(-1);
    expect(found?.sessions).toHaveLength(26);
    expect(found?.sessions.every((s) => s.title?.startsWith('BETA'))).toBe(true);
    expect(found?.hasMore).toBe(false);
  }, 30_000);

  it('rename: the server publishes session.renamed and the row comes back as an upsert, moved to the top', async () => {
    const { controller, posted, other } = await bootSessions();
    const first = await other.session.create({ title: 'first' });
    await other.session.create({ title: 'second' });
    // The fixture stamps `time.updated` in milliseconds and breaks ties by id: without a pause the
    // rename can land in the same millisecond as the creation of `second` and not move above it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await controller.handle({
      type: 'session.rename',
      requestId: 'r1',
      sessionID: first.id,
      title: '  Renamed by the panel  ',
    });
    expect(posted).toContainEqual({ type: 'request.result', requestId: 'r1' });
    await waitUntil(
      () =>
        posted.some(
          (m) =>
            m.type === 'session.upserted' &&
            m.session.id === first.id &&
            m.session.title === 'Renamed by the panel',
        ),
      'the rename to reach the webview',
    );
    await controller.handle({ type: 'sessions.query', requestId: 'q1', search: '', more: false });
    expect(pages(posted).at(-1)?.sessions[0]).toMatchObject({
      id: first.id,
      title: 'Renamed by the panel',
    });
  }, 20_000);

  it('deleting the open RUNNING session with a child: asks first (running), interrupts, removes both, forgets it', async () => {
    const asked: Array<{ title: string; running: boolean }> = [];
    const { controller, posted, other, remembered } = await bootSessions((info) => {
      asked.push(info);
      return Promise.resolve(true);
    });
    await controller.handle({
      type: 'prompt.send',
      requestId: 'p1',
      text: 'SLOW count to 400',
      delivery: 'queue',
      files: [],
    });
    const snapshot = posted.filter((m) => m.type === 'snapshot').at(-1);
    const sessionID = snapshot?.type === 'snapshot' ? snapshot.snapshot.open?.sessionID : undefined;
    expect(sessionID).toMatch(/^ses_/);
    const child = await other.session.create({ parentID: sessionID ?? '' });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'busy'),
      'busy',
    );

    await controller.handle({
      type: 'session.delete',
      requestId: 'd1',
      sessionID: sessionID ?? '',
    });

    expect(asked).toEqual([{ title: '', running: true }]);
    expect(posted).toContainEqual({ type: 'request.result', requestId: 'd1' });
    await waitUntil(
      () =>
        posted.some((m) => m.type === 'session.removed' && m.sessionID === child.id) &&
        posted.some((m) => m.type === 'session.removed' && m.sessionID === sessionID),
      'both sessions to be reported removed',
    );
    expect(posted.some((m) => m.type === 'session.status' && m.status.type === 'idle')).toBe(true); // the interruption the server does before deleting
    expect(remembered.at(-1)).toBeUndefined();
    expect(posted.some((m) => m.type === 'notice')).toBe(false); // our own delete: no "outside" notice
    await expect(other.session.get({ sessionID: sessionID ?? '' })).rejects.toMatchObject({
      _tag: 'SessionNotFoundError',
    });
  }, 20_000);

  it('a delete the user declines leaves the session alone', async () => {
    const { controller, posted, other } = await bootSessions(() => Promise.resolve(false));
    const session = await other.session.create({ title: 'keep me' });
    await controller.handle({ type: 'session.delete', requestId: 'd1', sessionID: session.id });
    expect(posted).toContainEqual({ type: 'request.result', requestId: 'd1' });
    await expect(other.session.get({ sessionID: session.id })).resolves.toMatchObject({
      id: session.id,
    });
  }, 20_000);

  it('another client deleting the open session: the host forgets it and says so', async () => {
    const { controller, posted, other, remembered } = await bootSessions();
    await controller.handle({
      type: 'prompt.send',
      requestId: 'p1',
      text: 'hello',
      delivery: 'queue',
      files: [],
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish',
    );
    const snapshot = posted.filter((m) => m.type === 'snapshot').at(-1);
    const sessionID = snapshot?.type === 'snapshot' ? snapshot.snapshot.open?.sessionID : undefined;
    await other.session.remove({ sessionID: sessionID ?? '' });
    await waitUntil(() => posted.some((m) => m.type === 'notice'), 'the notice');
    expect(posted).toContainEqual({ type: 'session.removed', sessionID });
    expect(posted.find((m) => m.type === 'notice')).toMatchObject({
      level: 'info',
      error: { code: 'SessionDeleted' },
    });
    expect(remembered.at(-1)).toBeUndefined();
  }, 20_000);

  it('session.new creates nothing on the server (lazy): the list of sessions does not grow', async () => {
    const { controller, posted, other } = await bootSessions();
    const before = (await other.session.list({})).data.length;
    await controller.handle({ type: 'session.new', requestId: 'n1' });
    expect(posted).toContainEqual({ type: 'request.result', requestId: 'n1' });
    expect((await other.session.list({})).data).toHaveLength(before);
    const last = posted.filter((m) => m.type === 'snapshot').at(-1);
    expect(last?.type === 'snapshot' ? last.snapshot.open : 'missing').toBeUndefined();
  }, 20_000);

  // E4 / issue #21. The fixture copies what the planner spike saw in a real opencode 2.0.32 (the
  // fork is a ROOT session with `fork.sessionID`, only `session.forked` is published, a subagent
  // child has `parentID` and the tool carries its id in `metadata`); a pass proves our wiring with
  // the real client, not that the real server does it.

  /** Sends `text` in the open session and waits for the turn to end (`idleCount` idles so far). */
  async function turn(
    controller: ChatController,
    posted: HostToWebview[],
    text: string,
    idleCount: number,
  ) {
    await controller.handle({
      type: 'prompt.send',
      requestId: `p${String(idleCount)}`,
      text,
      delivery: 'queue',
      files: [],
    });
    await waitUntil(
      () =>
        posted.filter((m) => m.type === 'session.status' && m.status.type === 'idle').length >=
        idleCount,
      `turn ${String(idleCount)} to finish`,
    );
  }

  it('forks before the second prompt over HTTP: the fork holds only the first exchange and opens', async () => {
    const { controller, posted, other } = await bootSessions();
    await turn(controller, posted, 'first question', 1);
    await turn(controller, posted, 'second question', 2);
    const originalID = lastSnapshot(posted).open?.sessionID ?? '';
    const history = await other.message.list({ sessionID: originalID, order: 'desc', limit: 200 });
    const secondUser = history.data.find((m) => m.type === 'user');
    expect(secondUser).toBeDefined();

    await controller.handle({
      type: 'session.fork',
      requestId: 'f1',
      sessionID: originalID,
      messageID: secondUser?.id ?? '',
    });

    expect(posted).toContainEqual({ type: 'request.result', requestId: 'f1' });
    const snapshot = lastSnapshot(posted);
    const forkID = snapshot.open?.sessionID ?? '';
    expect(forkID).not.toBe(originalID);
    expect(snapshot.open?.messages.map((m) => m.kind)).toEqual(['user', 'assistant']);
    expect(snapshot.open?.messages[0]).toMatchObject({ kind: 'user', text: 'first question' });
    expect(snapshot.sessions.find((row) => row.id === forkID)).toMatchObject({
      forkOf: originalID,
    });
    expect(snapshot.sessions.find((row) => row.id === forkID)?.parentID).toBeUndefined();
    // The row reached the webview as an upsert before the snapshot, and the original is intact.
    expect(
      posted.some((m) => m.type === 'session.upserted' && m.session.forkOf === originalID),
    ).toBe(true);
    const after = await other.message.list({ sessionID: originalID, order: 'desc', limit: 200 });
    expect(after.data).toHaveLength(history.data.length);
  }, 20_000);

  it('a fork made by ANOTHER client reaches the webview as a session.upserted (session.forked has no title)', async () => {
    const { controller, posted, other } = await bootSessions();
    await turn(controller, posted, 'hello', 1);
    const originalID = lastSnapshot(posted).open?.sessionID ?? '';
    const forked = await other.session.fork({ sessionID: originalID });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.upserted' && m.session.id === forked.id),
      'the upsert of the fork',
    );
    expect(
      posted.find((m) => m.type === 'session.upserted' && m.session.id === forked.id),
    ).toMatchObject({ session: { forkOf: originalID } });
  }, 20_000);

  it('a fork before an unknown message answers the server error and keeps the session open', async () => {
    const { controller, posted } = await bootSessions();
    await turn(controller, posted, 'hello', 1);
    const originalID = lastSnapshot(posted).open?.sessionID ?? '';
    await controller.handle({
      type: 'session.fork',
      requestId: 'f1',
      sessionID: originalID,
      messageID: 'msg_nope',
    });
    expect(posted.at(-1)).toMatchObject({
      type: 'request.result',
      requestId: 'f1',
      error: { code: 'MessageNotFoundError' },
    });
    expect(lastSnapshot(posted).open?.sessionID).toBe(originalID);
  }, 20_000);

  it('a subagent turn: the tool carries the child id, the child is a session with parentID, opening it brings the parent row', async () => {
    const { controller, posted } = await bootSessions();
    await turn(controller, posted, 'SUBAGENT say hello', 1);
    const parentID = lastSnapshot(posted).open?.sessionID ?? '';
    const child = posted.find(
      (m) => m.type === 'session.upserted' && m.session.parentID === parentID,
    );
    expect(child).toMatchObject({ session: { title: 'Say hello', agent: 'general' } });
    const childID = child?.type === 'session.upserted' ? child.session.id : '';

    const tools = posted.flatMap((m) =>
      m.type === 'part.upserted' && m.part.type === 'tool' && m.part.name === 'subagent'
        ? [m.part.state]
        : [],
    );
    expect(tools.map((state) => state.status)).toContain('running');
    expect(tools.at(-1)).toMatchObject({
      status: 'completed',
      metadata: { sessionID: childID, status: 'completed' },
    });
    expect(
      tools.some(
        (state) =>
          state.status === 'running' &&
          state.metadata?.sessionID === childID &&
          state.metadata.status === 'running',
      ),
    ).toBe(true);

    await controller.handle({ type: 'session.open', requestId: 'o1', sessionID: childID });
    const snapshot = lastSnapshot(posted);
    expect(snapshot.open?.sessionID).toBe(childID);
    expect(snapshot.open?.messages.map((m) => m.kind)).toEqual(['user', 'assistant']);
    expect(snapshot.sessions.find((row) => row.id === parentID)).toBeDefined();

    // Back to the parent: its snapshot lists the child (the "Subagent sessions" of the header).
    await controller.handle({ type: 'session.open', requestId: 'o2', sessionID: parentID });
    expect(lastSnapshot(posted).sessions.find((row) => row.id === childID)).toMatchObject({
      parentID,
    });
  }, 20_000);

  // E5 / issues #23 and #24. The fixture copies what the planner spike saw in a real opencode 2.0.32
  // (catalog answers `{location, data}`, switches that validate nothing, `agent-switched` /
  // `model-switched` messages, `variant: "default"` echoed); a pass proves our wiring with the real
  // client (the new methods exist and send these bodies), not that a real server behaves so. The
  // real-server counterpart is the `model selected` case of `realOpencode.test.ts` (opt-in).
  const GLM = { providerID: 'opencode', id: 'glm-5.3-flash-free' };
  const PICKLE = { providerID: 'opencode', id: 'big-pickle' };

  const catalogsOf = (posted: HostToWebview[]) =>
    posted.flatMap((m) => (m.type === 'catalog' ? [m.catalog] : []));

  /** Sends a prompt with a choice and waits for the `idleCount`-th idle. */
  async function turnWith(
    controller: ChatController,
    posted: HostToWebview[],
    idleCount: number,
    choice: { model?: ModelRef; agent?: string; sessionID?: string },
  ) {
    await controller.handle({
      type: 'prompt.send',
      requestId: `c${String(idleCount)}`,
      text: 'hello',
      delivery: 'queue',
      files: [],
      ...choice,
    });
    await waitUntil(
      () =>
        posted.filter((m) => m.type === 'session.status' && m.status.type === 'idle').length >=
        idleCount,
      `turn ${String(idleCount)} to finish`,
    );
  }

  it('E5: publishes the catalog (real client, four GETs) once the stream connects', async () => {
    const { posted } = await bootSessions();
    await waitUntil(() => catalogsOf(posted).length > 0, 'the catalog');
    const catalog = catalogsOf(posted)[0];
    expect(catalog?.models.map((m) => m.id)).toEqual(['big-pickle', 'glm-5.3-flash-free']);
    expect(catalog?.models[0]).toMatchObject({
      free: true,
      contextLimit: 200000,
      variants: ['low', 'high'],
    });
    expect(catalog?.providers).toEqual([{ id: 'opencode', name: 'OpenCode' }]);
    expect(catalog?.agents.map((a) => a.id)).toEqual(['build', 'plan']);
    expect(catalog?.serverDefault).toEqual(PICKLE);
    expect(catalog?.defaultAgent).toBe('build');
  }, 20_000);

  it('E5: a new session is created with the chosen agent and model, and that is what answers', async () => {
    const { controller, posted, other } = await bootSessions();
    await turnWith(controller, posted, 1, { model: GLM, agent: 'plan' });
    const sessionID = lastSnapshot(posted).open?.sessionID ?? '';

    const assistant = posted.find(
      (m) => m.type === 'message.upserted' && m.message.kind === 'assistant',
    );
    expect(assistant).toMatchObject({ message: { agent: 'plan', model: GLM } });
    expect(lastSnapshot(posted).sessions.find((row) => row.id === sessionID)).toMatchObject({
      agent: 'plan',
      model: GLM,
    });
    // Created with the choice: no switch message in the history of the server.
    // (The fixture answers newest first, as the real server does for `order: 'desc'`.)
    const history = await other.message.list({ sessionID, order: 'desc', limit: 50 });
    expect(history.data.map((m) => m.type).reverse()).toEqual(['user', 'assistant']);

    // The same choice again costs nothing: no `agent-switched`, no `model-switched`.
    await turnWith(controller, posted, 2, { model: GLM, agent: 'plan', sessionID });
    const again = await other.message.list({ sessionID, order: 'desc', limit: 50 });
    expect(again.data.some((m) => m.type === 'agent-switched' || m.type === 'model-switched')).toBe(
      false,
    );
  }, 30_000);

  it('E5: changing agent and model in an existing session switches both before the prompt, and reopening shows them', async () => {
    const { controller, posted, other } = await bootSessions();
    await turnWith(controller, posted, 1, { model: GLM, agent: 'plan' });
    const sessionID = lastSnapshot(posted).open?.sessionID ?? '';

    await turnWith(controller, posted, 2, { model: PICKLE, agent: 'build', sessionID });
    const upserts = posted.flatMap((m) =>
      m.type === 'session.upserted' && m.session.id === sessionID ? [m.session] : [],
    );
    expect(upserts.at(-1)).toMatchObject({ agent: 'build', model: PICKLE });
    const history = await other.message.list({ sessionID, order: 'desc', limit: 50 });
    const kinds = history.data.map((m) => m.type).reverse();
    expect(kinds).toEqual([
      'user',
      'assistant',
      'agent-switched',
      'model-switched',
      'user',
      'assistant',
    ]);
    const assistants = posted.flatMap((m) =>
      m.type === 'message.upserted' && m.message.kind === 'assistant' ? [m.message] : [],
    );
    expect(assistants.at(-1)).toMatchObject({ agent: 'build', model: PICKLE });

    await controller.handle({ type: 'session.new', requestId: 'n1' });
    await controller.handle({ type: 'session.open', requestId: 'o1', sessionID });
    expect(lastSnapshot(posted).sessions.find((row) => row.id === sessionID)).toMatchObject({
      agent: 'build',
      model: PICKLE,
    });
  }, 30_000);

  it('E5: a model the catalog does not list is refused and the server is not touched', async () => {
    const { controller, posted, other } = await bootSessions();
    const before = await other.session.list({});
    await controller.handle({
      type: 'prompt.send',
      requestId: 'bad',
      text: 'hello',
      delivery: 'queue',
      files: [],
      model: { providerID: 'opencode', id: 'nope' },
    });
    expect(posted.filter((m) => m.type === 'request.result').at(-1)).toMatchObject({
      requestId: 'bad',
      error: { code: 'ModelUnavailable' },
    });
    const after = await other.session.list({});
    expect(after.data).toHaveLength(before.data.length);
  }, 20_000);

  // E5 / issue #61. Same fixture caveat as above: it copies the shapes the spike saw (variant
  // "default" echoed, switchModel deduplicated on `variant ?? "default"`); a pass proves our wiring
  // with the real client, not that a real server runs a turn with a variant (see
  // realOpencode.test.ts).
  it('E5 #61: a new session is created with the variant, and the reply and the row carry it', async () => {
    const { controller, posted } = await bootSessions();
    const HIGH = { ...GLM, variant: 'high' };
    await turnWith(controller, posted, 1, { model: HIGH });
    const sessionID = lastSnapshot(posted).open?.sessionID ?? '';
    const assistant = posted.find(
      (m) => m.type === 'message.upserted' && m.message.kind === 'assistant',
    );
    expect(assistant).toMatchObject({ message: { model: HIGH } });
    expect(lastSnapshot(posted).sessions.find((row) => row.id === sessionID)).toMatchObject({
      model: HIGH,
    });
  }, 30_000);

  it('E5 #61: another variant of the same model switches it, and Default (no variant) goes back', async () => {
    const { controller, posted, other } = await bootSessions();
    await turnWith(controller, posted, 1, { model: { ...GLM, variant: 'high' } });
    const sessionID = lastSnapshot(posted).open?.sessionID ?? '';

    await turnWith(controller, posted, 2, { model: { ...GLM, variant: 'low' }, sessionID });
    const rowOf = () =>
      posted
        .flatMap((m) =>
          m.type === 'session.upserted' && m.session.id === sessionID ? [m.session] : [],
        )
        .at(-1);
    expect(rowOf()).toMatchObject({ model: { ...GLM, variant: 'low' } });

    await turnWith(controller, posted, 3, { model: GLM, sessionID });
    expect(rowOf()?.model).toEqual(GLM);
    const assistants = posted.flatMap((m) =>
      m.type === 'message.upserted' && m.message.kind === 'assistant' ? [m.message] : [],
    );
    expect(assistants.at(-1)).toMatchObject({ model: GLM });
    const history = await other.message.list({ sessionID, order: 'desc', limit: 50 });
    expect(history.data.filter((m) => m.type === 'model-switched')).toHaveLength(2);
  }, 40_000);

  it('E5 #61: a variant the model does not list is refused with VariantUnavailable and the server is not touched', async () => {
    const { controller, posted, other } = await bootSessions();
    const before = await other.session.list({});
    await controller.handle({
      type: 'prompt.send',
      requestId: 'ultra',
      text: 'hello',
      delivery: 'queue',
      files: [],
      model: { ...GLM, variant: 'ultra' },
    });
    expect(posted.filter((m) => m.type === 'request.result').at(-1)).toMatchObject({
      requestId: 'ultra',
      error: { code: 'VariantUnavailable' },
    });
    const after = await other.session.list({});
    expect(after.data).toHaveLength(before.data.length);
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
