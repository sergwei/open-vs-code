// SYNTHETIC stand-in for `opencode`, used only by the unit tests of issue #8. It is NOT opencode.
//
// It imitates what was READ (never seen running) in opencode v2.0.32 (`server-process.ts`,
// `env.ts`, `process.ts` of github.com/anomalyco/opencode at 843a6c51):
//   - `--version` prints `opencode v<version>`.
//   - `serve --stdio ...` listens on 127.0.0.1:<ephemeral>, prints ONE stdout line
//     `{"url":"http://127.0.0.1:<port>"}`, requires Basic `opencode:<OPENCODE_PASSWORD>` on
//     `GET /api/info`, and exits when stdin ends.
// Tests that pass against it prove our spawn/parse/stop logic, NOT that real opencode behaves
// this way (the project rule: synthetic data is not verification).
//
// Behaviour switches, comma separated in FAKE_OPENCODE_MODE (default `ok`):
//   noise         a non-JSON and a JSON-without-url stdout line before the URL
//   silent        never prints the URL
//   exit-early    prints "boom" on stderr and exits with code 3 before listening
//   hold-stdout   spawns a grandchild that inherits stdout (20 s), reports its pid and exits with 3
//   ignore-stdin  does not exit when stdin ends
//   grandchild    spawns a `node` grandchild (stdio ignored) and reports its pid on stderr
//   port-zero     prints a URL with port 0 when it was given `--port`
//   always-401    answers 401 to every /api/info
//   sse-drop      cuts the FIRST `GET /api/event` connection right after its first frame
//                 (once), to exercise the reconnection of the host
// FAKE_OPENCODE_VERSION sets the version reported by `--version` and `/api/info`.
//
// Chat routes (issue #14, used by the Vitest e2e `chatController.e2e.test.ts`, NOT by the VS Code
// integration tests: the extension cannot launch `node fixture.mjs` as a binary). They imitate
// what the planner RECORDED from a real opencode 2.0.32 on 2026-10-20 (Windows 11): REST answers
// wrapped in `{data}`, `session.list` as `{data, cursor}`, `GET /api/session/:unknown` as 404
// `SessionNotFoundError`, and a prompt that produces the event order
// `inbox.enqueued -> execution.started -> inbox.delivered -> step.started -> reasoning.started
// -> reasoning.delta x2 -> text.started -> reasoning.ended -> text.delta -> text.ended ->
// step.ended -> execution.succeeded` (or `execution.failed` with `provider.no-route` when the
// prompt text contains FAIL). Ids, texts and times are SYNTHETIC: a test that passes here proves
// the HTTP/SSE wiring of the client (auth, directory header, `data` unwrapping, reconnection),
// NOT that opencode behaves like this.
// Phase 2 adds `POST /api/session/:id/interrupt` (answers the bare `{"interrupted":true|false}`)
// and a SLOW switch: a prompt containing SLOW plays its events 300 ms apart so it can be
// interrupted. Both are SYNTHETIC, written from the route and the types read in 2.0.32.
// Phase 3 adds permissions and questions, all SYNTHETIC and written from the routes and types read
// in 2.0.32 (never seen against a server except where `realOpencode.test.ts` says so): a prompt
// containing ASK_PERMISSION runs the turn up to a tool call and a `permission.asked`
// (action `read`, resources `.env`, `save: ["*"]`, `source` = the tool) and WAITS; ASK_QUESTION
// does the same with a `form.created` (`metadata.kind: "question"`, fields q0 string with options
// and custom, q1 multiselect). `POST /api/session/:sid/permission/:rid/reply` (204, then
// `permission.replied`; `reject` rejects every pending request of the session; an unknown id is
// 404 `PermissionNotFoundError`), `POST .../form/:fid/reply` (204 + `form.replied`; an empty `q0`
// is 400 `FormInvalidAnswerError`; a second reply is 409 `FormAlreadySettledError`) and
// `DELETE .../form/:fid?message=` (204 + `form.cancelled`) let the turn go on. The lists
// `GET /api/permission/request` and `GET /api/form` answer `{location, data}` (NOT unwrapped by the
// client) and `GET /api/permission/saved` answers `{data}`. An interrupt with a request pending
// deletes it WITHOUT publishing `permission.replied`, like `permission.ts@v2.0.32` L247-258.
// E3-resolved-history: the tool of an asking turn ends in the state a real opencode 2.0.32 gives it
// (see `askingTool`) and its block is part of the REST message, so a snapshot read after a
// reconnection shows what the tool block says about the answer.
// On start it writes one stderr line `{"fake":"argv",...}` so tests can check args, cwd and env.
// Every mode has a hard 60 s lifetime so a test that fails half-way cannot leave it running.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const version = process.env.FAKE_OPENCODE_VERSION ?? '2.0.32';
const modes = (process.env.FAKE_OPENCODE_MODE ?? 'ok').split(',').map((m) => m.trim());
const has = (mode) => modes.includes(mode);

/** Writes to stderr and then exits, so the text is flushed before the process goes away. */
function exitAfterStderr(text, code) {
  process.stderr.write(text, () => process.exit(code));
}

// ---------------------------------------------------------------------------------------------
// Chat routes (see the header). State lives in memory for the life of the process.
// ---------------------------------------------------------------------------------------------

const sseClients = new Set();
const sessions = new Map(); // id -> SessionInfo
const history = new Map(); // id -> messages, oldest first
const running = new Set(); // ids with a turn in flight
const turnTimers = new Map(); // id -> timers of the turn in flight, cleared by an interrupt
const pendingPermissions = new Map(); // id -> PermissionRequest, in order of arrival
const pendingForms = new Map(); // id -> FormInfo
const settledForms = new Set(); // ids already answered or cancelled, to answer 409 to a repeat
const gates = new Map(); // session id -> (outcome) => void that resumes a paused turn
let seq = 0;
let dropped = false;

/** Next synthetic id with a prefix, e.g. `msg_000001`. */
const nextId = (prefix) => `${prefix}_${String(++seq).padStart(6, '0')}`;

/** Writes one SSE data frame to every open `/api/event` connection. */
function broadcast(type, data) {
  const frame = `data: ${JSON.stringify({ id: nextId('evt'), created: Date.now(), type, data })}\n\n`;
  for (const client of sseClients) client.write(frame);
}

/** Sends a JSON answer wrapped the way the real server wraps REST results. */
function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** Reads and parses a JSON request body (`{}` when empty). */
function readBody(request) {
  return new Promise((resolve) => {
    let text = '';
    request.on('data', (chunk) => (text += chunk));
    request.on('end', () => resolve(text === '' ? {} : JSON.parse(text)));
  });
}

/** Sends an empty-bodied answer, like the 204 of the reply and cancel routes. */
function noContent(response) {
  response.writeHead(204);
  response.end();
}

/**
 * Builds the events of a tool call that asks the user something, split in the part played before
 * the question and the part played after it is answered.
 *
 * `kind` is `permission` (a `read` of `.env` with a `permission.asked`) or `question` (a `question`
 * tool with a form). `before` ends with the ask itself, which is also what registers the pending
 * request; `after(result)` is the tool result: `result.outcome` is `success` unless the user
 * rejected or cancelled (`denied`), `result.message` the optional text of that reject/cancel and
 * `result.answer` the form answer. SYNTHETIC, but the FINAL STATES copy the rows of a real opencode
 * 2.0.32 database (read with `node:sqlite`, 20-21/10/2026): a rejection without a message is
 * `error {type: "aborted", message: "The user declined this tool call"}`, a dismissed question
 * `aborted` + "The user dismissed this question" (read in the source, not seen), a rejection with a
 * message `error {type: "permission.rejected", message}`, a dismissal with a message
 * `error {type: "tool.execution", message}`, and an answered `question` is `completed` with
 * `metadata.answers: string[][]` (one array per question). `block()` is the tool block as the
 * REST `message.list` returns it once the tool finished (`content[]` of the assistant message).
 * The shapes follow the types of `@opencode/client@2.0.32`.
 */
function askingTool(kind, a) {
  const toolID = nextId('call');
  const name = kind === 'permission' ? 'read' : 'question';
  const input =
    kind === 'permission'
      ? { path: '.env' }
      : {
          questions: [
            {
              header: 'Letter',
              question: 'Pick A or B',
              options: [{ label: 'A' }, { label: 'B' }],
            },
            {
              header: 'Extras',
              question: 'Any extras?',
              options: [{ label: 'x' }, { label: 'y' }],
            },
          ],
        };
  let state = { status: 'running', input, metadata: {} };
  const before = [
    () => broadcast('session.tool.input.started', { ...a, id: toolID, name }),
    () => broadcast('session.tool.called', { ...a, id: toolID, input }),
  ];
  if (kind === 'permission') {
    before.push(() => {
      const request = {
        id: nextId('per'),
        sessionID: a.sessionID,
        action: 'read',
        resources: ['.env'],
        save: ['*'],
        source: { type: 'tool', messageID: a.assistantMessageID, id: toolID },
      };
      pendingPermissions.set(request.id, request);
      broadcast('permission.asked', request);
    });
  } else {
    before.push(() => {
      const form = {
        id: nextId('frm'),
        sessionID: a.sessionID,
        title: 'Questions',
        metadata: { kind: 'question', tool: { messageID: a.assistantMessageID, id: toolID } },
        fields: [
          {
            key: 'q0',
            type: 'string',
            title: 'Letter',
            description: 'Pick A or B',
            required: true,
            options: [
              { value: 'A', label: 'A' },
              { value: 'B', label: 'B' },
            ],
            custom: true,
          },
          {
            key: 'q1',
            type: 'multiselect',
            title: 'Extras',
            options: [
              { value: 'x', label: 'x' },
              { value: 'y', label: 'y' },
            ],
          },
        ],
      };
      pendingForms.set(form.id, form);
      broadcast('form.created', { form });
    });
  }
  const after = (result) => {
    if (result.outcome === 'success') {
      const content = [{ type: 'text', text: 'ok' }];
      const answer = result.answer ?? {};
      const metadata =
        kind === 'question'
          ? { answers: [[String(answer.q0 ?? '')], Array.isArray(answer.q1) ? answer.q1 : []] }
          : undefined;
      state = { status: 'completed', input, content, ...(metadata ? { metadata } : {}) };
      return [
        () =>
          broadcast('session.tool.success', {
            ...a,
            id: toolID,
            content,
            ...(metadata ? { metadata } : {}),
          }),
      ];
    }
    const hasMessage = typeof result.message === 'string' && result.message !== '';
    const error = hasMessage
      ? {
          type: kind === 'permission' ? 'permission.rejected' : 'tool.execution',
          message: result.message,
        }
      : {
          type: 'aborted',
          message:
            kind === 'permission'
              ? 'The user declined this tool call'
              : 'The user dismissed this question',
        };
    state = { status: 'error', input, error };
    return [() => broadcast('session.tool.failed', { ...a, id: toolID, error })];
  };
  const block = () => ({ type: 'tool', id: toolID, name, state, time: { created: Date.now() } });
  return { before, after, block };
}

/** Plays the recorded turn for a prompt, one event every few milliseconds. */
function playTurn(sessionID, inboxID, text) {
  const assistantMessageID = nextId('msg');
  const a = { sessionID, assistantMessageID };
  const fail = text.includes('FAIL');
  const asking = text.includes('ASK_PERMISSION')
    ? 'permission'
    : text.includes('ASK_QUESTION')
      ? 'question'
      : undefined;
  /** The asking tool of this turn, once it exists; its block joins the REST message at the end. */
  let toolBlock;
  const steps = [
    () =>
      broadcast('session.inbox.enqueued', {
        sessionID,
        inboxID,
        item: { type: 'user', payload: { text }, delivery: 'queue' },
      }),
    () => broadcast('session.execution.started', { sessionID }),
    () => {
      history
        .get(sessionID)
        .push({ id: inboxID, type: 'user', text, time: { created: Date.now() } });
      broadcast('session.inbox.delivered', { sessionID, inboxID });
    },
  ];
  if (fail) {
    steps.push(() => {
      running.delete(sessionID);
      history.get(sessionID).push({
        id: nextId('msg'),
        type: 'idle',
        outcome: 'failed',
        time: { created: Date.now() },
        error: { type: 'provider.no-route', message: 'Model unavailable: nope/does-not-exist' },
      });
      broadcast('session.execution.failed', {
        sessionID,
        error: { type: 'provider.no-route', message: 'Model unavailable: nope/does-not-exist' },
      });
    });
  } else {
    const stepStarted = () =>
      broadcast('session.step.started', {
        ...a,
        agent: 'build',
        model: { id: 'big-pickle', providerID: 'opencode' },
        started: Date.now(),
      });
    const body = [
      () => broadcast('session.reasoning.started', { ...a, ordinal: 0 }),
      () => broadcast('session.reasoning.delta', { ...a, ordinal: 0, delta: 'thinking ' }),
      () => broadcast('session.reasoning.delta', { ...a, ordinal: 0, delta: 'about it' }),
      () => broadcast('session.text.started', { ...a, ordinal: 0 }),
      () => broadcast('session.reasoning.ended', { ...a, ordinal: 0, text: 'thinking about it' }),
      () => broadcast('session.text.delta', { ...a, ordinal: 0, delta: 'hello ' }),
      () => broadcast('session.text.delta', { ...a, ordinal: 0, delta: 'there' }),
      () => broadcast('session.text.ended', { ...a, ordinal: 0, text: 'hello there' }),
      () => {
        history.get(sessionID).push({
          id: assistantMessageID,
          type: 'assistant',
          agent: 'build',
          model: { id: 'big-pickle', providerID: 'opencode' },
          time: { created: Date.now(), completed: Date.now() },
          finish: 'stop',
          content: [
            ...(toolBlock === undefined ? [] : [toolBlock()]),
            { type: 'reasoning', text: 'thinking about it', time: { created: 1, completed: 2 } },
            { type: 'text', text: 'hello there' },
          ],
        });
        broadcast('session.step.ended', {
          ...a,
          finish: 'stop',
          cost: 0,
          tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 0, write: 0 } },
        });
      },
      () => {
        running.delete(sessionID);
        broadcast('session.execution.succeeded', { sessionID });
      },
    ];
    if (asking === undefined) {
      steps.push(stepStarted, ...body);
    } else {
      // The turn pauses at the ask and the rest is held in `gates` until a reply resumes it.
      const tool = askingTool(asking, a);
      toolBlock = tool.block;
      steps.push(stepStarted, ...tool.before);
      gates.set(sessionID, (result) => {
        gates.delete(sessionID);
        schedule([...tool.after(result), ...body]);
      });
    }
  }
  // A prompt containing SLOW plays 20x slower (about 5 s), so a test can interrupt it mid-turn.
  const interval = text.includes('SLOW') ? 300 : 15;
  /** Plays `list` one `interval` apart; the timers are kept so an interrupt can cancel them. */
  function schedule(list) {
    const timers = list.map((step, index) => setTimeout(step, interval * (index + 1)));
    turnTimers.set(sessionID, [...(turnTimers.get(sessionID) ?? []), ...timers]);
  }
  turnTimers.delete(sessionID);
  schedule(steps);
}

/**
 * Removes every pending request of a session; with `announce` each one is also published as
 * `permission.replied` (a `reject` does that for the whole session, like `permission.ts`).
 */
function dropRequests(sessionID, announce) {
  for (const [id, request] of pendingPermissions) {
    if (request.sessionID !== sessionID) continue;
    pendingPermissions.delete(id);
    if (announce) {
      broadcast('permission.replied', { sessionID, requestID: id, reply: 'reject' });
    }
  }
  for (const [id, form] of pendingForms) {
    if (form.sessionID === sessionID) pendingForms.delete(id);
  }
}

/**
 * Imitates `POST /api/session/:id/interrupt`: SYNTHETIC. Answers the BARE body `{interrupted}`
 * (no `{data}` wrapper, like the real route read in the client chunk of 2.0.32) and, when a turn
 * was in flight, drops its remaining events and emits `session.execution.interrupted`.
 */
function interrupt(sessionID) {
  if (!running.has(sessionID)) return false;
  for (const timer of turnTimers.get(sessionID) ?? []) clearTimeout(timer);
  turnTimers.delete(sessionID);
  gates.delete(sessionID);
  // A pending request dies with the turn, and NO `permission.replied` is published for it.
  dropRequests(sessionID, false);
  running.delete(sessionID);
  broadcast('session.execution.interrupted', { sessionID, reason: 'user' });
  return true;
}

/**
 * Answers the routes that settle a request: `POST .../permission/:rid/reply`,
 * `POST .../form/:fid/reply` and `DELETE .../form/:fid`. SYNTHETIC (see the header). Every
 * successful route answers 204 and then publishes the event, and resumes the paused turn through
 * `gates`; `denied` is what a reject or a cancel resumes with.
 */
function handleAnswer(request, response, [, rawSession, kind, rawId, verb]) {
  const sessionID = decodeURIComponent(rawSession);
  const id = decodeURIComponent(rawId);
  const resume = (outcome) => gates.get(sessionID)?.(outcome);

  if (kind === 'permission') {
    if (request.method !== 'POST' || verb !== 'reply') return false;
    readBody(request).then((body) => {
      const pending = pendingPermissions.get(id);
      if (pending === undefined || pending.sessionID !== sessionID) {
        json(response, 404, {
          _tag: 'PermissionNotFoundError',
          message: `Permission not found: ${id}`,
          requestID: id,
        });
        return;
      }
      pendingPermissions.delete(id);
      noContent(response);
      broadcast('permission.replied', { sessionID, requestID: id, reply: body.decision });
      if (body.decision === 'reject') dropRequests(sessionID, true);
      resume(
        body.decision === 'reject'
          ? { outcome: 'denied', message: body.message }
          : { outcome: 'success' },
      );
    });
    return true;
  }

  /** Common checks of a form route; answers the error itself and returns false when it fails. */
  const settle = () => {
    if (settledForms.has(id)) {
      json(response, 409, {
        _tag: 'FormAlreadySettledError',
        message: `Form already settled: ${id}`,
      });
      return false;
    }
    const form = pendingForms.get(id);
    if (form === undefined || form.sessionID !== sessionID) {
      json(response, 404, { _tag: 'FormNotFoundError', message: `Form not found: ${id}` });
      return false;
    }
    return true;
  };

  if (request.method === 'POST' && verb === 'reply') {
    readBody(request).then((body) => {
      if (!settle()) return;
      const answer = body.answer ?? {};
      if (typeof answer.q0 !== 'string' || answer.q0 === '') {
        json(response, 400, { _tag: 'FormInvalidAnswerError', message: 'q0 is required' });
        return;
      }
      pendingForms.delete(id);
      settledForms.add(id);
      noContent(response);
      broadcast('form.replied', { id, sessionID, answer });
      resume({ outcome: 'success', answer });
    });
    return true;
  }
  if (request.method === 'DELETE' && verb === undefined) {
    if (!settle()) return true;
    pendingForms.delete(id);
    settledForms.add(id);
    noContent(response);
    broadcast('form.cancelled', { id, sessionID });
    const note = new URL(request.url ?? '/', 'http://fake.invalid').searchParams.get('message');
    resume({ outcome: 'denied', message: note ?? undefined });
    return true;
  }
  return false;
}

/**
 * Answers the chat routes; returns false when the request is not one of them.
 * Authentication was already checked by the caller.
 */
function handleChat(request, response) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  const method = request.method;

  if (method === 'GET' && path === '/api/event') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    response.write(
      `data: ${JSON.stringify({ id: nextId('evt'), type: 'server.connected', data: {} })}\n\n`,
    );
    if (has('sse-drop') && !dropped) {
      dropped = true;
      setTimeout(() => response.end(), 20);
      return true;
    }
    sseClients.add(response);
    request.on('close', () => sseClients.delete(response));
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000);
    heartbeat.unref();
    response.on('close', () => clearInterval(heartbeat));
    return true;
  }
  if (method === 'GET' && path === '/api/session/active') {
    json(response, 200, {
      data: Object.fromEntries([...running].map((id) => [id, { type: 'running' }])),
    });
    return true;
  }
  if (method === 'GET' && path === '/api/session') {
    json(response, 200, { data: [...sessions.values()].reverse(), cursor: {} });
    return true;
  }
  if (method === 'POST' && path === '/api/session') {
    readBody(request).then(() => {
      const id = nextId('ses');
      const now = Date.now();
      const info = {
        id,
        projectID: 'prj_fake',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: now, updated: now },
        location: {
          directory: decodeURIComponent(String(request.headers['x-opencode-directory'] ?? '')),
        },
      };
      sessions.set(id, info);
      history.set(id, []);
      json(response, 200, { data: info });
      broadcast('session.created', {
        sessionID: id,
        projectID: 'prj_fake',
        slug: id,
        version: '2.0.32',
        location: info.location,
      });
    });
    return true;
  }
  const location = {
    directory: decodeURIComponent(String(request.headers['x-opencode-directory'] ?? '')),
  };
  if (method === 'GET' && path === '/api/permission/request') {
    json(response, 200, { location, data: [...pendingPermissions.values()] });
    return true;
  }
  if (method === 'GET' && path === '/api/form') {
    json(response, 200, { location, data: [...pendingForms.values()] });
    return true;
  }
  if (method === 'GET' && path === '/api/permission/saved') {
    json(response, 200, { data: [] });
    return true;
  }
  const act = /^\/api\/session\/([^/]+)\/(permission|form)\/([^/]+)(?:\/(reply))?$/.exec(path);
  if (act !== null) return handleAnswer(request, response, act);
  const match = /^\/api\/session\/([^/]+)(?:\/(message|permission|form|prompt|interrupt))?$/.exec(
    path,
  );
  if (match === null) return false;
  const [, id, sub] = match;
  const session = sessions.get(decodeURIComponent(id));
  if (session === undefined) {
    json(response, 404, { _tag: 'SessionNotFoundError', message: `Session not found: ${id}` });
    return true;
  }
  if (method === 'GET' && sub === undefined) {
    json(response, 200, { data: session });
    return true;
  }
  if (method === 'GET' && sub === 'message') {
    json(response, 200, { data: [...history.get(session.id)].reverse(), cursor: {} });
    return true;
  }
  if (method === 'GET' && (sub === 'permission' || sub === 'form')) {
    json(response, 200, { data: [] });
    return true;
  }
  if (method === 'POST' && sub === 'interrupt') {
    readBody(request).then(() => json(response, 200, { interrupted: interrupt(session.id) }));
    return true;
  }
  if (method === 'POST' && sub === 'prompt') {
    readBody(request).then((body) => {
      const inboxID = nextId('msg');
      running.add(session.id);
      json(response, 200, {
        data: {
          id: inboxID,
          sessionID: session.id,
          time: { created: Date.now() },
          type: 'user',
          payload: { text: body.text },
          delivery: body.delivery ?? 'steer',
        },
      });
      playTurn(session.id, inboxID, String(body.text));
    });
    return true;
  }
  return false;
}

if (args.includes('--version')) {
  process.stdout.write(`opencode v${version}\n`, () => process.exit(0));
} else if (args[0] !== 'serve') {
  exitAfterStderr(`fake-opencode: unknown command ${JSON.stringify(args)}\n`, 2);
} else {
  runServe();
}

/** Runs the `serve --stdio` imitation described in the file header. */
function runServe() {
  const password = process.env.OPENCODE_PASSWORD;
  process.stderr.write(
    `${JSON.stringify({
      fake: 'argv',
      pid: process.pid,
      argv: args,
      cwd: process.cwd(),
      hasPassword: typeof password === 'string' && password !== '',
      hasLegacy: 'OPENCODE_SERVER_PASSWORD' in process.env,
    })}\n`,
  );

  if (has('exit-early')) {
    exitAfterStderr('boom\n', 3);
    return;
  }

  if (has('hold-stdout')) {
    // A grandchild that inherits OUR stdout pipe, then we exit with code 3: stdout stays open
    // after the child is gone, which is the case the `exit` event in the start race exists for.
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 20000)'], {
      stdio: ['ignore', 'inherit', 'ignore'],
    });
    process.stderr.write(`${JSON.stringify({ fake: 'grandchild', pid: holder.pid })}\n`);
    setTimeout(() => process.exit(3), 150);
    return;
  }

  setTimeout(() => process.exit(0), 60_000); // hard cap, see header

  if (has('grandchild')) {
    // detached on Windows only: there Node puts non-detached children in a job object that kills
    // them when their parent dies, so a non-detached grandchild would die even without
    // `taskkill /T` and the kill test could not tell the difference (review of issue #8, verified
    // with a probe). On POSIX detached would move it out of the process group `kill(-pgid)` hits.
    const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 60000)'], {
      stdio: 'ignore',
      detached: process.platform === 'win32',
    });
    process.stderr.write(`${JSON.stringify({ fake: 'grandchild', pid: grandchild.pid })}\n`);
  }

  const expected = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
  const server = createServer((request, response) => {
    const authorized = !has('always-401') && request.headers.authorization === expected;
    if (!authorized) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ _tag: 'UnauthorizedError', message: 'unauthorized' }));
      return;
    }
    if (request.url === '/api/info') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ version, pid: process.pid, urls: [], paths: { tmp: tmpdir() } }),
      );
      return;
    }
    if (handleChat(request, response)) return;
    response.writeHead(404);
    response.end();
  });

  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    if (has('noise')) {
      process.stdout.write('starting opencode, please wait...\n');
      process.stdout.write('{"hello":"world"}\n');
    }
    if (!has('silent')) {
      const shown = has('port-zero') && args.includes('--port') ? 0 : port;
      process.stdout.write(`${JSON.stringify({ url: `http://127.0.0.1:${shown}` })}\n`);
    }
  });

  if (!has('ignore-stdin')) {
    const shutdown = () => {
      server.close();
      process.exit(0);
    };
    process.stdin.on('end', shutdown);
    process.stdin.on('close', shutdown);
    process.stdin.resume();
  }
}
