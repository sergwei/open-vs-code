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
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelRef, Part } from '../shared/model';
import type { HostToWebview, WebviewToHost } from '../shared/protocol';
import {
  ChatController,
  type SessionListEvent,
  type SessionListPage,
  type SessionListSink,
} from './chatController';
import { createOpencodeClient } from './opencodeClient';
import { startServer, stopServer, type RunningServer, type ServerLog } from './opencodeServer';
import type { PendingSummary } from './pendingRequests';
import type { ServerState } from './serverManager';
import { noSetup } from './test-fixtures/noSetup';
import { onePane, type OnePaneController } from './test-fixtures/onePane';

const FIXTURE = fileURLToPath(new URL('./test-fixtures/fake-opencode.mjs', import.meta.url));

const quiet: ServerLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const servers: RunningServer[] = [];
const folders: string[] = [];
const controllers: Array<{ dispose(): void }> = [];

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
  extraEnv: Record<string, string> = {},
  sessionList?: SessionListSink,
) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'ovsc-chat-'));
  folders.push(folder);
  const server = await startServer({
    command: process.execPath,
    prefixArgs: [FIXTURE],
    folder,
    port: 0,
    log: quiet,
    baseEnv: { ...process.env, FAKE_OPENCODE_MODE: mode, ...extraEnv },
  });
  servers.push(server);
  const posted: HostToWebview[] = [];
  const remembered: Array<string | undefined> = [];
  const attention: Array<readonly PendingSummary[]> = [];
  let lastModel: ModelRef | undefined;
  const core = new ChatController({
    createClient: createOpencodeClient,
    ...(sessionList === undefined ? {} : { sessionList }),
    editor: {
      open: () => Promise.resolve(),
      editorContext: () => Promise.resolve({ refs: [], ranged: 0, unsaved: false }),
      insert: () => Promise.resolve(),
      newFile: () => Promise.resolve(),
      copy: () => Promise.resolve(),
      pickFiles: () => Promise.resolve([]),
      droppedFiles: () =>
        Promise.resolve({ refs: [], skipped: { folders: 0, outside: 0, remote: 0, missing: 0 } }),
      openDiff: () => Promise.resolve('diff'),
    },
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
    sessions: { confirmDelete, confirmRevertDiscard: () => Promise.resolve(true) },
    preferences: {
      defaultModel: () => undefined,
      lastModel: () => lastModel,
      setLastModel: (ref) => {
        lastModel = ref;
        return Promise.resolve();
      },
    },
    server: { restart: () => undefined, showLogs: () => undefined },
    setup: noSetup,
    ui: { setChatFocused: () => undefined, focusView: () => undefined },
  });
  // Written when the host had one webview: `onePane` keeps the calls of the cases below.
  const controller = onePane(core, (message) => posted.push(message));
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
      source: 'spawned',
    },
  };
  return { controller, core, posted, remembered, state, attention };
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

  // E7-file-context (#28/#29). What can break only over HTTP: the query string the real client
  // builds for `GET /api/fs/find` (`query`, `type`, `limit`), the `{location, data}` answer that the
  // client does not unwrap, and the `files` of a prompt (uri WITH its `?start&end`, name) coming
  // back in the user message of the stream. The fixture's file list and ranking are SYNTHETIC.
  it('searches files over HTTP and sends one with a line range back in the user message', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await controller.handle({ type: 'files.search', requestId: 'f1', query: 'smp' });
    const answer = posted.find((m) => m.type === 'files.found');
    expect(answer).toMatchObject({
      requestId: 'f1',
      query: 'smp',
      files: [{ name: 'src/sample.ts' }],
    });
    const found = answer?.type === 'files.found' ? answer.files[0] : undefined;
    expect(found?.uri).toMatch(/^file:\/\/\/.*src\/sample\.ts$/);

    // A directory the fixture lists with a trailing `\` never reaches the chips.
    await controller.handle({ type: 'files.search', requestId: 'f2', query: 'shared' });
    const shared = posted.filter((m) => m.type === 'files.found').at(-1);
    expect(shared).toMatchObject({ requestId: 'f2', files: [{ name: 'src/shared/model.ts' }] });

    const uri = `${found?.uri ?? ''}?start=2&end=3`;
    const mention = { start: 5, end: 19, text: '@src/sample.ts' };
    // A range reference is not an offered uri: only the plain one is. Send the offered one with a
    // mention, and check the stream hands the file back with its name.
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'read @src/sample.ts please',
      delivery: 'queue',
      files: [{ uri: found?.uri ?? '', name: 'src/sample.ts', mention }],
    });
    expect(posted.at(-1)).toMatchObject({ type: 'request.result', requestId: 'r1' });
    await waitUntil(
      () => posted.some((m) => m.type === 'message.upserted' && m.message.kind === 'user'),
      'the user message',
    );
    const user = posted.find((m) => m.type === 'message.upserted' && m.message.kind === 'user');
    expect(user).toMatchObject({
      message: { files: [{ name: 'src/sample.ts', uri: found?.uri, mime: 'text/plain' }] },
    });
    // The same prompt with an uri the host never emitted is refused before the server.
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r2',
      text: 'again',
      delivery: 'queue',
      files: [{ uri, name: 'src/sample.ts#2-3' }],
    });
    expect(posted.at(-1)).toMatchObject({ requestId: 'r2', error: { code: 'AttachmentRejected' } });
  }, 20_000);

  // E8-slash-commands (#33). What can break only over HTTP: `GET /api/command` answering
  // `{location, data}` that the client does not unwrap, `POST /api/session/:id/command` answering a
  // 204 with NO body (a client that expected JSON would throw `MalformedResponse` there), the 404
  // and 500 bodies arriving as thrown objects with their `_tag`, and the turn coming through the
  // stream as the expanded template. The command files, the 404/500 bodies and the templates are
  // SYNTHETIC (the fixture's); the `.opencode/command` layout is read in upstream, not run here.
  it('lists the project commands, runs one over HTTP and reports the 404 and the 500', async () => {
    const { controller, posted, state } = await boot('ok');
    const commandsFolder = path.join(state.server.folder, '.opencode', 'command');
    await mkdir(path.join(commandsFolder, 'docs'), { recursive: true });
    await writeFile(
      path.join(commandsFolder, 'hello.md'),
      '---\r\ndescription: Say hello\r\n---\r\nGreet $1 warmly.\r\n',
    );
    await writeFile(path.join(commandsFolder, 'docs', 'search.md'), 'Search the docs for: ');
    await writeFile(path.join(commandsFolder, 'broken.md'), 'Do FAIL_COMMAND now');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'catalog'), 'the catalog');
    const catalog = posted.flatMap((m) => (m.type === 'catalog' ? [m.catalog] : [])).at(-1);
    expect(catalog?.commands).toEqual([
      { name: 'init', description: 'guided AGENTS.md setup' },
      { name: 'review', description: 'review changes [commit|branch|pr], defaults to uncommitted' },
      { name: 'broken' },
      { name: 'docs/search' },
      { name: 'hello', description: 'Say hello' },
    ]);

    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'Ana and more',
      delivery: 'queue',
      files: [],
      command: 'hello',
    });
    expect(posted).toContainEqual({ type: 'request.result', requestId: 'r1' });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the command turn to finish',
    );
    const user = posted.find((m) => m.type === 'message.upserted' && m.message.kind === 'user');
    expect(user).toMatchObject({ message: { text: 'Greet Ana warmly.' } });

    // The 500 of a command that fails, with its tag, and the draft stays the webview's to restore.
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r2',
      text: '',
      delivery: 'queue',
      files: [],
      command: 'broken',
    });
    expect(posted.at(-1)).toMatchObject({
      requestId: 'r2',
      error: { code: 'CommandExecutionError' },
    });

    // A file deleted after the catalog was read: the host still lists it, the server answers 404.
    await rm(path.join(commandsFolder, 'docs', 'search.md'));
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r3',
      text: '',
      delivery: 'queue',
      files: [],
      command: 'docs/search',
    });
    expect(posted.filter((m) => m.type === 'request.result').at(-1)).toMatchObject({
      requestId: 'r3',
      error: { code: 'CommandNotFoundError' },
    });
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
    controller: OnePaneController,
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

  // Issue #26. Protects the wiring of tool cards: every tool of a turn reaches the webview as a
  // completed block with its input, text output and metadata (the edit one with its unified patch),
  // and a snapshot read afterwards carries the same blocks. SYNTHETIC: the fixture's `TOOLS` turn
  // is written from the tool sources read in the 2.0.32 tag, so this proves our mapping and
  // transport, NOT that a real opencode sends these shapes (that is `npm run test:event-shapes`).
  it('a TOOLS turn: nine tool blocks arrive by stream with their metadata and the snapshot agrees', async () => {
    const { controller, posted } = await bootSessions();
    await turn(controller, posted, 'TOOLS please', 1);
    const streamed = new Map<string, Extract<Part, { type: 'tool' }>>();
    for (const message of posted) {
      if (message.type === 'part.upserted' && message.part.type === 'tool') {
        streamed.set(message.part.id, message.part);
      }
    }
    const blocks = [...streamed.values()];
    expect(blocks.map((block) => block.name)).toEqual([
      'shell',
      'shell',
      'read',
      'edit',
      'write',
      'grep',
      'glob',
      'webfetch',
      'mcp_echo',
    ]);
    expect(blocks.every((block) => block.state.status === 'completed')).toBe(true);
    expect(blocks[1]?.state).toMatchObject({
      output: [
        { type: 'text', text: 'FAIL src/a.test.ts\n' },
        { type: 'text', text: 'Exited with code 1' },
      ],
      metadata: { exit: 1 },
    });
    const edit = blocks[3]?.state;
    const files = edit?.status === 'completed' ? edit.metadata?.['files'] : undefined;
    expect(files).toMatchObject([{ file: 'src/sample.ts', additions: 1, deletions: 1 }]);

    await controller.handle({ type: 'ready' });
    const open = lastSnapshot(posted).open;
    const fromSnapshot = Object.values(open?.parts ?? {})
      .flat()
      .filter((part) => part.type === 'tool');
    expect(fromSnapshot).toEqual(blocks);
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
    controller: OnePaneController,
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

  // Issue #25. What can break only over HTTP: the `cost`/`tokens` of the REST rows and of the
  // assistant message reaching the shared model through the real client, the volatile
  // `session.usage.updated` becoming a `session.upserted`, and the snapshot agreeing with the
  // stream. The fixture's numbers are SYNTHETIC (see `fake-opencode.mjs`).
  it('E5 #25: a turn brings tokens on the reply and accumulated usage on the row, and a resync agrees', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await controller.handle({ type: 'ready' });
    await controller.handle({
      type: 'prompt.send',
      requestId: 'u1',
      text: 'Reply with exactly: hello there',
      delivery: 'queue',
      files: [],
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish',
    );
    // The LAST upsert: the first one (step.started) carries no tokens yet.
    const reply = posted
      .filter((m) => m.type === 'message.upserted' && m.message.kind === 'assistant')
      .at(-1);
    expect(reply).toMatchObject({
      message: {
        tokens: { input: 1200, output: 40, reasoning: 8, cacheRead: 3000, cacheWrite: 0 },
      },
    });
    const live = posted.filter((m) => m.type === 'session.upserted').at(-1);
    const expected = {
      cost: 0,
      tokens: { input: 1200, output: 40, reasoning: 8, cacheRead: 3000, cacheWrite: 0 },
    };
    expect(live).toMatchObject({ session: { usage: expected } });

    await controller.resync();
    const snapshot = posted.filter((m) => m.type === 'snapshot').at(-1);
    const opened = snapshot?.type === 'snapshot' ? snapshot.snapshot : undefined;
    expect(opened?.sessions.find((row) => row.id === opened.open?.sessionID)?.usage).toEqual(
      expected,
    );
    expect(opened?.open?.compactedAt).toBeUndefined();
    // What keeps the context line after Reload/Restart: the assistant read back through REST
    // carries the same per-step tokens as the live reply (reconciliation W2).
    const answered = opened?.open?.messages.filter((m) => m.kind === 'assistant').at(-1);
    expect(answered?.kind === 'assistant' ? answered.tokens : undefined).toEqual({
      input: 1200,
      output: 40,
      reasoning: 8,
      cacheRead: 3000,
      cacheWrite: 0,
    });
  }, 20_000);

  it('E5 #25: a COSTLY turn puts a positive cost on the session row', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await controller.handle({ type: 'ready' });
    await controller.handle({
      type: 'prompt.send',
      requestId: 'c1',
      text: 'COSTLY please',
      delivery: 'queue',
      files: [],
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish',
    );
    expect(posted.filter((m) => m.type === 'session.upserted').at(-1)).toMatchObject({
      session: { usage: { cost: 0.0123 } },
    });
  }, 20_000);

  it('E5 #25: a compaction of the open session refreshes the snapshot with its boundary', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await controller.handle({ type: 'ready' });
    await controller.handle({
      type: 'prompt.send',
      requestId: 'k1',
      text: 'COMPACT after this',
      delivery: 'queue',
      files: [],
    });
    await waitUntil(
      () =>
        posted.some(
          (m) => m.type === 'snapshot' && typeof m.snapshot.open?.compactedAt === 'number',
        ),
      'a snapshot with compactedAt (resync on compaction.ended)',
    );
  }, 20_000);

  // Issue #125. SYNTHETIC server: `POST /api/session/:id/compact` and the events around it are
  // invented from the types and the source (see the fixture), so these pass for OUR transport,
  // mapping and notice, not for what a real server sends.
  const compactionLines = (posted: HostToWebview[]) =>
    posted.flatMap((m) =>
      m.type === 'message.upserted' && m.message.kind === 'notice'
        ? [[m.message.id, m.message.compaction, m.message.text]]
        : [],
    );

  it('E8 #125: /compact answers the request, shows running then completed, and the snapshot has the boundary', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await controller.handle({ type: 'ready' });
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
    const sessionID = lastSnapshot(posted).open?.sessionID ?? '';
    posted.length = 0;
    await controller.handle({ type: 'session.compact', requestId: 'k1', sessionID });
    expect(posted).toContainEqual({ type: 'request.result', requestId: 'k1' });
    await waitUntil(
      () =>
        posted.some(
          (m) => m.type === 'snapshot' && typeof m.snapshot.open?.compactedAt === 'number',
        ),
      'a snapshot with compactedAt',
    );
    const lines = compactionLines(posted);
    expect(lines.map(([, compaction]) => compaction)).toEqual(['running', 'completed']);
    expect(lines[0]?.[0]).toBe(lines[1]?.[0]);
    // The REST message of the snapshot is the same notice (same id), completed.
    const open = lastSnapshot(posted).open;
    expect(open?.messages.filter((m) => m.kind === 'notice')).toMatchObject([
      { id: lines[0]?.[0], compaction: 'completed', text: 'Conversation compacted' },
    ]);
  }, 20_000);

  it('E8 #125: a session with nothing to compact shows a failed line and the turn ends idle', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await controller.handle({ type: 'ready' });
    await controller.handle({
      type: 'prompt.send',
      requestId: 'p1',
      text: 'KEEP_ALL please',
      delivery: 'queue',
      files: [],
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn to finish',
    );
    const sessionID = lastSnapshot(posted).open?.sessionID ?? '';
    posted.length = 0;
    await controller.handle({ type: 'session.compact', requestId: 'k1', sessionID });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the execution to end',
    );
    expect(compactionLines(posted).map(([, compaction, text]) => [compaction, text])).toEqual([
      ['running', 'Compacting the conversation…'],
      ['failed', 'Compaction failed: Nothing to compact yet'],
    ]);
    // Real opencode ends this execution as a success (read in compaction.ts@843a6c51 L235-237 and
    // L639-646, not recorded): no error status, so no red banner.
    expect(posted.some((m) => m.type === 'session.status' && m.status.type === 'error')).toBe(
      false,
    );
  }, 20_000);

  // tooling/tests-without-model. What `npm run test:visual` needs from the synthetic server, now that
  // it runs on it. SYNTHETIC like everything here: the shapes are the ones of the 2.0.32 tag
  // (the failed tool's error is READ in `read.ts` / `to-session-error.ts`, never recorded), so a
  // pass proves our transport and mapping, not that a real server sends them.

  it('a LONG turn streams the numbers in many deltas and can be interrupted, failing its step like the real server', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await controller.handle({
      type: 'prompt.send',
      requestId: 'long',
      text: 'count to 400 LONG',
      delivery: 'queue',
      files: [],
    });
    await waitUntil(
      () => posted.filter((m) => m.type === 'part.delta').length >= 3,
      'a few deltas of the long reply',
    );
    // Still running a second later: the reply lasts about 16 s.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(posted.some((m) => m.type === 'session.status' && m.status.type === 'idle')).toBe(false);
    const sessionID = lastSnapshot(posted).open?.sessionID ?? '';
    await controller.handle({ type: 'session.abort', requestId: 'a1', sessionID });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'idle after the interruption',
    );
    // The message that was being written ends in the `aborted` error, as the real server's does.
    await controller.handle({ type: 'ready' });
    const assistant = lastSnapshot(posted).open?.messages.find((m) => m.kind === 'assistant');
    expect(assistant).toMatchObject({ error: { code: 'aborted' } });
  }, 30_000);

  it('a MARKDOWN turn answers with fences, a table, a file reference and a link, and the snapshot agrees', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await turn(controller, posted, 'show markdown MARKDOWN', 1);
    await controller.handle({ type: 'ready' });
    const parts = Object.values(lastSnapshot(posted).open?.parts ?? {}).flat();
    const text = parts.find((part) => part.type === 'text');
    const body = text?.type === 'text' ? text.text : '';
    expect(body).toContain('```ts');
    expect(body).toContain('```bash');
    expect(body).toContain('| Name | Value |');
    expect(body).toContain('`src/sample.ts:20`');
    expect(body).toContain('](https://code.visualstudio.com)');
    // Several deltas, not one: the first cuts the ts fence open.
    expect(posted.filter((m) => m.type === 'part.delta').length).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it('a BROKEN_READ turn ends the read tool in the error state with the message opencode gives', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await turn(controller, posted, 'read a missing file BROKEN_READ', 1);
    const expected = {
      name: 'read',
      state: {
        status: 'error',
        error: { code: 'tool.execution', message: 'File not found: src/does-not-exist.ts' },
      },
    };
    const streamed = posted.find(
      (m) =>
        m.type === 'part.upserted' && m.part.type === 'tool' && m.part.state.status === 'error',
    );
    expect(streamed).toMatchObject({ part: expected });
    await controller.handle({ type: 'ready' });
    const tool = Object.values(lastSnapshot(posted).open?.parts ?? {})
      .flat()
      .find((part) => part.type === 'tool');
    expect(tool).toMatchObject(expected);
  }, 30_000);

  it('a reject WITHOUT a message cuts the turn: the step fails as aborted and the execution is interrupted', async () => {
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
      'idle after the reject',
    );
    await controller.handle({ type: 'ready' });
    const assistant = lastSnapshot(posted).open?.messages.find((m) => m.kind === 'assistant');
    expect(assistant).toMatchObject({ error: { code: 'aborted', message: 'Step interrupted' } });
    // The reply the turn would have written never came.
    const texts = Object.values(lastSnapshot(posted).open?.parts ?? {})
      .flat()
      .filter((part) => part.type === 'text');
    expect(texts).toEqual([]);
  }, 20_000);

  it('visual mode: the catalog adds a custom agent and the two models of the context line, plain mode does not', async () => {
    const visual = await boot('visual');
    visual.controller.onServerState(visual.state);
    await waitUntil(() => catalogsOf(visual.posted).length > 0, 'the visual catalog');
    const catalog = catalogsOf(visual.posted)[0];
    expect(catalog?.models.map((m) => m.id)).toEqual([
      'big-pickle',
      'glm-5.3-flash-free',
      'tiny-context',
    ]);
    expect(catalog?.models[2]).toMatchObject({ contextLimit: 5000, variants: [] });
    expect(catalog?.agents.map((a) => a.id)).toEqual(['build', 'plan', 'docs']);
  }, 20_000);

  it('visual mode: file search walks the served folder and sees a file written a moment ago', async () => {
    const { state } = await boot('visual');
    if (state.kind !== 'running') throw new Error('the server is not running');
    const folder = state.server.folder;
    await mkdir(path.join(folder, 'src'), { recursive: true });
    await mkdir(path.join(folder, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(path.join(folder, '.hidden'), { recursive: true });
    await writeFile(path.join(folder, 'src', 'sample.ts'), 'a');
    await writeFile(path.join(folder, 'src', 'sample-extra.ts'), 'b');
    await writeFile(path.join(folder, 'node_modules', 'pkg', 'sample.js'), 'c');
    await writeFile(path.join(folder, '.hidden', 'sample.txt'), 'd');
    const client = createOpencodeClient(state.server);
    const found = await client.file.find({ query: 'sample', type: 'file' });
    expect(found.data.map((entry) => entry.path)).toEqual(['src/sample-extra.ts', 'src/sample.ts']);
    expect(found.data.every((entry) => entry.type === 'file')).toBe(true);
    // Without visual mode the fixed list answers, whatever the folder holds.
    const plain = await boot('ok');
    if (plain.state.kind !== 'running') throw new Error('the server is not running');
    const fixed = await createOpencodeClient(plain.state.server).file.find({
      query: 'sample',
      type: 'file',
    });
    expect(fixed.data.map((entry) => entry.path)).toEqual(['src/sample.ts']);
  }, 20_000);

  it('FAKE_OPENCODE_STATE_FILE: a second server process lists the first one’s sessions and history, and keeps counting ids', async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), 'ovsc-state-'));
    folders.push(stateDir);
    const env = { FAKE_OPENCODE_STATE_FILE: path.join(stateDir, 'state.json') };
    const first = await boot('ok', undefined, env);
    if (first.state.kind !== 'running') throw new Error('the server is not running');
    first.controller.onServerState(first.state);
    await waitUntil(() => first.posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await turn(first.controller, first.posted, 'hello', 1);
    const sessionID = lastSnapshot(first.posted).open?.sessionID ?? '';
    // The state is written 25 ms after the last change; a stop writes it again on exit.
    for (const server of servers.splice(0)) await stopServer(server.child, quiet);

    const second = await boot('ok', undefined, env);
    if (second.state.kind !== 'running') throw new Error('the server is not running');
    const client = createOpencodeClient(second.state.server);
    const row = await client.session.get({ sessionID });
    expect(row.id).toBe(sessionID);
    const history = await client.message.list({ sessionID });
    expect(history.data.map((message) => message.type).sort()).toEqual(['assistant', 'user']);
    const fresh = await client.session.create({});
    expect(fresh.id > sessionID).toBe(true);
  }, 30_000);

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

  // E7-session-diff (#31). What can break only over HTTP: the query the real client builds for
  // `GET /api/session/:id/diff` (`from`, `to`, `context`), the `{data}` it unwraps, and the
  // `type`/`order`/`limit` of `message.list` that pick the first and the last user message. The
  // fixture's patches and its range rules are SYNTHETIC (written from the reading of the server);
  // a pass proves our wiring, not that a real server answers like this.
  it('lists the files of the whole session and rebuilds their originals, over HTTP', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    const send = (requestId: string, text: string) =>
      controller.handle({ type: 'prompt.send', requestId, text, delivery: 'queue', files: [] });
    const turnsDone = () =>
      posted.filter((m) => m.type === 'session.status' && m.status.type === 'idle').length;
    await send('r1', 'EDIT_FILES first turn');
    await waitUntil(() => turnsDone() >= 1, 'the first turn');
    const lists = () => posted.flatMap((m) => (m.type === 'session.diff' ? [m] : []));
    await waitUntil(() => lists().length >= 1, 'the changed files');
    expect(lists()[0]?.files).toEqual([
      {
        path: 'assets/logo.png',
        status: 'added',
        additions: 0,
        deletions: 0,
        binary: true,
        tooLarge: false,
      },
      {
        path: 'src/added.ts',
        status: 'added',
        additions: 1,
        deletions: 0,
        binary: false,
        tooLarge: false,
      },
      {
        path: 'src/removed.ts',
        status: 'deleted',
        additions: 0,
        deletions: 1,
        binary: false,
        tooLarge: false,
      },
      {
        path: 'src/sample.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        binary: false,
        tooLarge: false,
      },
    ]);

    const sessionID = lists()[0]?.sessionID ?? '';
    // The original comes from the COMPLETE patch the fixture serves when no `context` is sent.
    expect(await controller.diffOriginal(sessionID, 'src/sample.ts')).toBe(
      '// Sample file for the visual test run.\nexport const value2 = 2;\n',
    );
    expect(await controller.diffOriginal(sessionID, 'src/removed.ts')).toBe(
      'export const removed = true;\n',
    );
    expect(await controller.diffOriginal(sessionID, 'src/added.ts')).toBe('');
    await expect(controller.diffOriginal(sessionID, 'src/not-listed.ts')).rejects.toMatchObject({
      name: 'DiffNotListed',
    });

    // A second turn makes the range span two user messages (`from` and `to`): the first turn's
    // files are still listed, and nothing else is.
    await send('r2', 'say hello');
    await waitUntil(() => turnsDone() >= 2, 'the second turn');
    await controller.handle({ type: 'ready' });
    await waitUntil(
      () => posted.filter((m) => m.type === 'snapshot').length >= 2,
      'a snapshot after the second turn',
    );
    expect(await controller.diffOriginal(sessionID, 'src/sample.ts')).toBe(
      '// Sample file for the visual test run.\nexport const value2 = 2;\n',
    );
  }, 30_000);

  // E7-message-revert (#32). What can break only over HTTP: the routes and bodies the real client
  // builds (`POST /revert/stage` with `{messageID}`, `DELETE /revert`, `POST /revert/commit`), the
  // `GET /message/:id` the host checks first, the `session.revert.*` events through the stream and
  // the `revert` field of the session row in the snapshot. The fixture's revert model is SYNTHETIC
  // (read from the server, files invented); a pass proves our wiring, not the real server.
  it('stages, restores and discards a revert over HTTP', async () => {
    const { controller, posted, state } = await boot('ok');
    controller.onServerState(state);
    await waitUntil(() => posted.some((m) => m.type === 'snapshot'), 'first snapshot');
    await controller.handle({
      type: 'prompt.send',
      requestId: 'r1',
      text: 'EDIT_FILES first turn',
      delivery: 'queue',
      files: [],
    });
    await waitUntil(
      () => posted.some((m) => m.type === 'session.status' && m.status.type === 'idle'),
      'the turn',
    );
    const reverts = () => posted.flatMap((m) => (m.type === 'session.revert' ? [m] : []));
    const results = (requestId: string) =>
      posted.flatMap((m) => (m.type === 'request.result' && m.requestId === requestId ? [m] : []));
    const user = posted.find((m) => m.type === 'message.upserted' && m.message.kind === 'user');
    if (user?.type !== 'message.upserted') throw new Error('no user message was streamed');
    const sessionID = user.sessionID;
    const messageID = user.message.id;

    // A message that is not a user one is refused by the host before the server is asked.
    const assistant = posted.find(
      (m) => m.type === 'message.upserted' && m.message.kind === 'assistant',
    );
    if (assistant?.type !== 'message.upserted') throw new Error('no assistant message');
    await controller.handle({
      type: 'session.revert.stage',
      requestId: 'r2',
      sessionID,
      messageID: assistant.message.id,
    });
    expect(results('r2')[0]?.error?.code).toBe('NotAUserMessage');
    expect(reverts()).toEqual([]);

    await controller.handle({
      type: 'session.revert.stage',
      requestId: 'r3',
      sessionID,
      messageID,
    });
    expect(results('r3')).toEqual([{ type: 'request.result', requestId: 'r3' }]);
    await waitUntil(() => reverts().length >= 1, 'the staged revert');
    expect(reverts()[0]?.revert?.messageID).toBe(messageID);
    expect(reverts()[0]?.revert?.files.map((file) => file.path)).toEqual([
      'assets/logo.png',
      'src/added.ts',
      'src/removed.ts',
      'src/sample.ts',
    ]);
    // The stream's own `session.revert.staged` carries the same state and is not repeated.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(reverts()).toHaveLength(1);

    await controller.handle({ type: 'session.revert.clear', requestId: 'r4', sessionID });
    expect(results('r4')).toEqual([{ type: 'request.result', requestId: 'r4' }]);
    await waitUntil(() => reverts().length >= 2, 'the cleared revert');
    expect(reverts()[1]).toEqual({ type: 'session.revert', sessionID });

    await controller.handle({
      type: 'session.revert.stage',
      requestId: 'r5',
      sessionID,
      messageID,
    });
    await waitUntil(() => reverts().length >= 3, 'the second staged revert');
    const snapshotsBefore = posted.filter((m) => m.type === 'snapshot').length;
    await controller.handle({ type: 'session.revert.commit', requestId: 'r6', sessionID });
    expect(results('r6')).toEqual([{ type: 'request.result', requestId: 'r6' }]);
    await waitUntil(
      () => posted.filter((m) => m.type === 'snapshot').length > snapshotsBefore,
      'the snapshot after the commit',
    );
    const last = posted.filter((m) => m.type === 'snapshot').at(-1);
    // The history from the boundary on is gone, and the webview learns it from the snapshot alone.
    expect(last?.type === 'snapshot' ? last.snapshot.open?.messages : undefined).toEqual([]);
    expect(last?.type === 'snapshot' ? last.snapshot.open?.revert : 'missing').toBeUndefined();
    expect(reverts()).toHaveLength(3);
  }, 30_000);
});

// E9-chat-editor-tabs, phase 1 (#77): the routing between panes over the real client and the real
// SSE loop. The server is the synthetic fixture (a second pane is the only new thing), so this
// proves our routing against the client's own stream code, NOT that a real opencode interleaves
// two sessions' events this way.
// Issue #77, delivery E3 (`E9-sessions-sidebar`, phase 1): the Sessions tree's reads and the
// pane-less rename/delete over HTTP, with the real client and the real reconnecting loop. The
// server is the SYNTHETIC fixture (its cursor format is invented, its `parentID=null` and `limit`
// copy the planner spike of 21/10/2026), so a pass proves our wiring, not the real server.
describe('the Sessions tree over HTTP and SSE against the synthetic server', () => {
  /** A booted controller with a recording sink and a second, independent client. */
  async function bootTree(confirm?: Parameters<typeof boot>[1]) {
    const resets: SessionListPage[] = [];
    const appends: Array<{ ids: string[]; hasMore: boolean }> = [];
    const events: SessionListEvent[] = [];
    const sink: SessionListSink = {
      reset: (page) => {
        resets.push(page);
      },
      // The read cannot fail against the fixture; the failure path is a Vitest case of
      // `chatController.test.ts` ("reports a failed read of the tree…").
      failed: () => undefined,
      append: (rows, hasMore) => {
        appends.push({ ids: rows.map((row) => row.id), hasMore });
      },
      event: (message) => {
        events.push(message);
      },
      connection: () => undefined,
    };
    const booted = await boot('ok', confirm, {}, sink);
    if (booted.state.kind !== 'running') throw new Error('the server is not running');
    return { ...booted, resets, appends, events, other: createOpencodeClient(booted.state.server) };
  }

  it('pages the tree through the cursor of the synthetic server', async () => {
    const { core, state, resets, appends, other } = await bootTree();
    for (let index = 0; index < 52; index++)
      await other.session.create({ title: `s${String(index)}` });
    const parent = await other.session.create({ title: 'parent' });
    await other.session.create({ title: 'a child', parentID: parent.id });

    core.onServerState(state);
    await waitUntil(() => resets.length > 0, 'the first page of the tree');
    const first = resets[0];
    // 53 roots exist; the child is not one of them, and the page holds the 50 newest.
    expect(first?.rows).toHaveLength(50);
    expect(first?.hasMore).toBe(true);
    expect(first?.rows.some((row) => row.title === 'a child')).toBe(false);
    expect(first?.rows.every((row) => row.parentID === undefined)).toBe(true);

    await core.loadMoreSessions();
    expect(appends).toHaveLength(1);
    expect(appends[0]?.ids).toHaveLength(3);
    expect(appends[0]?.hasMore).toBe(false);
    const all = [...(first?.rows.map((row) => row.id) ?? []), ...(appends[0]?.ids ?? [])];
    expect(new Set(all).size).toBe(53);
  }, 30_000);

  it('follows another client over the stream, and renames and deletes without a pane', async () => {
    const { controller, core, state, resets, events, other } = await bootTree();
    core.onServerState(state);
    await waitUntil(() => resets.length > 0, 'the first page of the tree');
    core.detachPane(controller.pane.id); // no chat tab open: only the tree listens

    const created = await other.session.create({ title: 'from the TUI' });
    await waitUntil(
      () => events.some((e) => e.type === 'session.upserted' && e.session.id === created.id),
      'the session created by another client',
    );

    await core.renameSessionById(created.id, '  Renamed from the tree ');
    await waitUntil(
      () =>
        events.some(
          (e) =>
            e.type === 'session.upserted' &&
            e.session.id === created.id &&
            e.session.title === 'Renamed from the tree',
        ),
      'the rename to reach the sink',
    );

    await expect(core.deleteSessionById(created.id)).resolves.toEqual({ deleted: true });
    expect(events).toContainEqual({ type: 'session.removed', sessionID: created.id });
  }, 30_000);
});

describe('two panes over HTTP and SSE against the synthetic server', () => {
  it('streams two prompts at once, each pane receiving only the content of its own session', async () => {
    const { controller, core, posted, state } = await boot('ok');
    const second: HostToWebview[] = [];
    const secondPane = core.attachPane({ post: (message) => second.push(message) });
    core.onServerState(state);
    await waitUntil(
      () => posted.some((m) => m.type === 'connection.state' && m.connection.state === 'connected'),
      'connected',
    );
    const prompt = (requestId: string): WebviewToHost => ({
      type: 'prompt.send',
      requestId,
      text: 'Reply with exactly: hello there',
      delivery: 'queue',
      files: [],
    });
    // The same requestId in both panes on purpose: each result must reach its own pane only.
    await Promise.all([controller.handle(prompt('r1')), core.handle(secondPane.id, prompt('r1'))]);
    const firstSession = controller.pane.sessionID ?? '';
    const secondSession = secondPane.sessionID ?? '';
    expect(firstSession).toMatch(/^ses_/);
    expect(secondSession).toMatch(/^ses_/);
    expect(firstSession).not.toBe(secondSession);
    const idle = (feed: HostToWebview[], sessionID: string): boolean =>
      feed.some(
        (m) => m.type === 'session.status' && m.sessionID === sessionID && m.status.type === 'idle',
      );
    await waitUntil(
      () => idle(posted, firstSession) && idle(second, secondSession),
      'both turns to finish',
    );
    for (const [feed, own] of [
      [posted, firstSession],
      [second, secondSession],
    ] as const) {
      const scoped = feed.flatMap((m) =>
        m.type === 'message.upserted' || m.type === 'part.upserted' || m.type === 'part.delta'
          ? [m.sessionID]
          : [],
      );
      expect(scoped.length).toBeGreaterThan(0);
      expect(new Set(scoped)).toEqual(new Set([own]));
      expect(feed.filter((m) => m.type === 'request.result')).toEqual([
        { type: 'request.result', requestId: 'r1' },
      ]);
    }
  }, 30_000);
});
