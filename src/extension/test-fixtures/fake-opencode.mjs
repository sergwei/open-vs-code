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
//   no-info       answers 404 to /api/info (a server that is not opencode v2; issue #11)
//   sse-drop      cuts the FIRST `GET /api/event` connection right after its first frame
//                 (once), to exercise the reconnection of the host
// FAKE_OPENCODE_VERSION sets the version reported by `--version` and `/api/info`.
//
// Chat routes (issue #14, used by the Vitest e2e `chatController.e2e.test.ts`, and, since
// issue #41, by the `fake-server` VS Code integration suite, where the extension runs it as
// `node fixture.mjs` through the Test-mode seam of `testLaunch.ts`). They imitate
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
// E4-session-management (issue #20) adds, SYNTHETIC but copying the behaviour the planner saw in a
// spike against a real opencode 2.0.32 (Windows 11, 21/10/2026): `GET /api/session` with
// `parentID=null|<id>`, `search`, `limit` and an opaque `cursor` returned on every non-empty page;
// `POST /api/session` with `title` and `parentID` (a child inherits its parent's location);
// `PATCH /api/session/:id` (a non-blank title publishes `session.renamed` and bumps the update
// time; a blank one is a 204 with no event) and `DELETE /api/session/:id` (interrupts a running
// session, deletes children first, `session.deleted` per session, 404 afterwards). What is
// INVENTED: the inner format of the cursor and the `InvalidCursorError` 400.
// E4-fork-subsessions (issue #21) adds, SYNTHETIC but copying what the planner saw in a spike
// against a real opencode 2.0.32 (Windows 11, 21/10/2026): `POST /api/session/:id/fork` (body
// `{before?}`) answers `{data: SessionInfo}` for a ROOT session (no `parentID`) with
// `fork: {sessionID, boundary}`, the title of `forkTitle`, the settled history copied with NEW
// message ids (everything before `before`, or all of it) and publishes ONLY `session.forked` (no
// `session.created`); an unknown `before` is 404 `MessageNotFoundError` and an empty session
// without `before` is 400 `InvalidRequestError {kind: "empty_session"}`. A prompt containing
// SUBAGENT plays a turn whose `subagent` tool creates a child session (`session.created` with
// `parentID`, title "Say hello", agent "general"), publishes the volatile `session.tool.progress`
// with `metadata {sessionID, status: "running"}`, runs a short turn in the child and ends with
// `session.tool.success` carrying `metadata {sessionID, status: "completed", truncated: false}`
// (the event ORDER is the spike's; the ids, texts and timing are INVENTED).
// E5-model-agent-selectors (issues #23/#24) adds, SYNTHETIC but copying what the planner saw in a
// spike against a real opencode 2.0.32 (Windows 11, 21/10/2026): `GET /api/model`,
// `GET /api/model/default`, `GET /api/provider` and `GET /api/agent`, all `{location, data}` (the
// client does not unwrap them; `model/default` too is `{location, data: ModelInfo | null}`); the
// agent list holds `build` (the default, first), `general` (subagent), `title` (hidden) and `plan`.
// `POST /api/session` accepts `agent` and `model`; `POST /api/session/:id/model` and `.../agent` answer
// 204 and validate NOTHING (an unknown model or agent is stored, like the real server); the model
// route deduplicates against the model STORED on the session (the same model again publishes
// nothing; a session with no stored model always publishes, which is INVENTED) and the agent route
// does NOT; each
// publishes the durable `session.model.selected` / `session.agent.selected`, appends a
// `model-switched` / `agent-switched` message to the history and bumps `time.updated`. A model chosen
// without a variant is stored (and echoed by `session.get` and `session.step.started`) with
// `variant: "default"`, as the spike saw. What is INVENTED: the two-model catalog (the real one had
// ten, all free), the shape of the `*.selected` payloads beyond `{sessionID, model|agent,
// previous?}`, and that `step.started` and the REST assistant message use the agent and model
// stored in the session (the real server does it; the fixture copies the rule, not the code).
// E6-tool-call-views (issue #26) adds a TOOLS switch: a prompt containing TOOLS plays a turn with
// nine tool calls of different kinds (see `toolsTurn`), SYNTHETIC and written from the tool sources
// read in the 2.0.32 tag, never recorded from a running server.
// E7-file-context (issues #28/#29) adds `GET /api/fs/find` (`{location, data: [{path, type}]}`, a
// SYNTHETIC list of five paths matched as a case-insensitive subsequence; an empty query is `[]`,
// as the planner's spike against a real opencode 2.0.32 saw) and makes a prompt keep its `files`
// (uri with its query, name, mention) in the `session.inbox.enqueued` payload and in the history,
// the way the spike saw a real server store them. File contents are never read.
// On start it writes one stderr line `{"fake":"argv",...}` so tests can check args, cwd and env.
// Every mode has a hard 60 s lifetime so a test that fails half-way cannot leave it running;
// FAKE_OPENCODE_LIFETIME_MS (positive integer, ms) overrides it for `serve` (issue #41).

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

/**
 * Builds the steps of a `subagent` tool call (issue #21): the tool starts, a child session is
 * created under `a.sessionID`, the tool reports progress with the child's id, the child runs a
 * one-exchange turn and the tool succeeds with the child's id in its metadata. SYNTHETIC; the
 * event order and the metadata shape copy the planner's spike (opencode 2.0.32, 21/10/2026).
 * `block()` is the completed tool block of the REST message. The child's history is written
 * when the child is created, so opening it right away shows a user and an assistant message.
 */
function subagentTool(a) {
  const toolID = nextId('call');
  const input = { agent: 'general', description: 'Say hello', prompt: 'Say hello' };
  const childID = nextId('ses');
  const parent = sessions.get(a.sessionID);
  const metadata = { sessionID: childID, status: 'completed', truncated: false };
  const content = [
    { type: 'text', text: `<subagent sessionID="${childID}" state="completed">hello</subagent>` },
  ];
  const steps = [
    () => broadcast('session.tool.input.started', { ...a, id: toolID, name: 'subagent' }),
    () => broadcast('session.tool.called', { ...a, id: toolID, input }),
    () => {
      const now = Date.now();
      sessions.set(childID, {
        id: childID,
        projectID: 'prj_fake',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: now, updated: now },
        location: parent.location,
        title: input.description,
        parentID: a.sessionID,
        agent: 'general',
      });
      history.set(childID, [
        { id: nextId('msg'), type: 'user', text: input.prompt, time: { created: now } },
        {
          id: nextId('msg'),
          type: 'assistant',
          agent: 'general',
          model: { id: 'big-pickle', providerID: 'opencode' },
          time: { created: now, completed: now },
          finish: 'stop',
          content: [{ type: 'text', text: 'hello' }],
        },
      ]);
      broadcast('session.created', {
        sessionID: childID,
        projectID: 'prj_fake',
        slug: childID,
        version: '2.0.32',
        location: parent.location,
        title: input.description,
        parentID: a.sessionID,
        agent: 'general',
      });
    },
    () =>
      broadcast('session.tool.progress', {
        ...a,
        id: toolID,
        metadata: { sessionID: childID, status: 'running' },
      }),
    () => broadcast('session.tool.success', { ...a, id: toolID, content, metadata }),
  ];
  const block = () => ({
    type: 'tool',
    id: toolID,
    name: 'subagent',
    state: { status: 'completed', input, content, metadata },
    time: { created: Date.now() },
  });
  return { steps, block };
}

/**
 * The tool calls of a `TOOLS` turn (issue #26): `shell` twice (exit 0 and exit 1 with the warning
 * item), `read`, `edit` (with a real unified patch in `metadata.files`), `write`, `grep`, `glob`,
 * `webfetch` and an unknown MCP-style tool, each as `tool.input.started -> tool.called ->
 * tool.success`. SYNTHETIC / HYPOTHESIS: the shapes of `input`, `content` and `metadata` are those
 * READ in the 2.0.32 tag (`packages/core/src/tool/plugin/*.ts@843a6c51`, plan Engram #1035 section
 * 4), not recorded from a running server; a test that passes here proves the wiring (the block
 * reaches the webview with its metadata, by stream and by snapshot), NOT that opencode sends these
 * shapes. `blocks()` is the list of completed blocks that joins the REST message.
 */
function toolsTurn(a) {
  const patch = [
    'Index: src/sample.ts',
    '===================================================================',
    '--- src/sample.ts',
    '+++ src/sample.ts',
    '@@ -1,2 +1,2 @@',
    ' export const one = 1;',
    '-export const two = 2;',
    '+export const two = 22;',
    '',
  ].join('\n');
  const specs = [
    {
      name: 'shell',
      input: { command: 'node --version' },
      content: [{ type: 'text', text: 'v24.22.0\n' }],
      metadata: { status: 'completed', truncated: false, exit: 0 },
    },
    {
      name: 'shell',
      input: { command: 'npm test' },
      content: [
        { type: 'text', text: 'FAIL src/a.test.ts\n' },
        { type: 'text', text: 'Exited with code 1' },
      ],
      metadata: { status: 'completed', truncated: false, exit: 1 },
    },
    {
      name: 'read',
      input: { path: 'src/sample.ts' },
      content: [
        {
          type: 'text',
          text: 'Read file src/sample.ts, lines 1-2\n1: export const one = 1;\n2: export const two = 2;',
        },
      ],
      metadata: { truncated: false },
    },
    {
      name: 'edit',
      input: { path: 'src/sample.ts', oldString: 'two = 2', newString: 'two = 22' },
      content: [{ type: 'text', text: 'Edited src/sample.ts (1 replacement)' }],
      metadata: {
        files: [{ file: 'src/sample.ts', patch, additions: 1, deletions: 1, status: 'modified' }],
        truncated: false,
      },
    },
    {
      name: 'write',
      input: { path: 'src/new.ts', content: 'export const a = 1;\nexport const b = 2;\n' },
      content: [{ type: 'text', text: 'Created file successfully: src/new.ts' }],
      metadata: {},
    },
    {
      name: 'grep',
      input: { pattern: 'greet', path: 'src' },
      content: [
        {
          type: 'text',
          text: 'Found 2 matches\nsrc/sample.ts:\n  Line 1: export function greet() {}\n  Line 4: greet();',
        },
      ],
      metadata: { matches: 2, truncated: false },
    },
    {
      name: 'glob',
      input: { pattern: '**/*.ts' },
      content: [{ type: 'text', text: 'src/sample.ts\nsrc/new.ts' }],
      metadata: { count: 2, truncated: false },
    },
    {
      name: 'webfetch',
      input: { url: 'https://example.test/page', format: 'text' },
      content: [{ type: 'text', text: 'Example page' }],
      metadata: { contentType: 'text/html' },
    },
    {
      name: 'mcp_echo',
      input: { message: 'hi' },
      content: [{ type: 'text', text: 'echo: hi' }],
      metadata: {},
    },
  ].map((spec) => ({ ...spec, id: nextId('call') }));
  const steps = specs.flatMap((spec) => [
    () => broadcast('session.tool.input.started', { ...a, id: spec.id, name: spec.name }),
    () => broadcast('session.tool.called', { ...a, id: spec.id, input: spec.input }),
    () =>
      broadcast('session.tool.success', {
        ...a,
        id: spec.id,
        content: spec.content,
        metadata: spec.metadata,
      }),
  ]);
  const blocks = () =>
    specs.map((spec) => ({
      type: 'tool',
      id: spec.id,
      name: spec.name,
      state: {
        status: 'completed',
        input: spec.input,
        content: spec.content,
        metadata: spec.metadata,
      },
      time: { created: Date.now() },
    }));
  return { steps, blocks };
}

/** The model a session answers with when none was ever selected: the catalog default. */
const DEFAULT_MODEL = { id: 'big-pickle', providerID: 'opencode' };

/** The agent and model the next turn of a session uses: its stored choice, else the defaults. */
function selectionOf(sessionID) {
  const session = sessions.get(sessionID);
  return { agent: session?.agent ?? 'build', model: session?.model ?? DEFAULT_MODEL };
}

/**
 * The catalog the model and agent routes answer (see the header). `ModelInfo` fields are trimmed to
 * what the host's mapping reads (`id`, `providerID`, `name`, `status`, `limit`, `cost`, `variants`).
 */
const CATALOG_MODELS = [
  ['big-pickle', 'Big Pickle'],
  ['glm-5.3-flash-free', 'GLM-5.3-Flash Free'],
].map(([id, name]) => ({
  id,
  modelID: id,
  providerID: 'opencode',
  name,
  capabilities: { tools: true, input: ['text'], output: ['text'] },
  variants: [{ id: 'low' }, { id: 'high' }],
  time: { released: 1 },
  cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  status: 'active',
  enabled: true,
  limit: { context: 200000, output: 32000 },
}));

const CATALOG_AGENTS = [
  ['build', 'Build', 'primary', false],
  ['general', 'General', 'subagent', false],
  ['title', 'Title', 'primary', true],
  ['plan', 'Plan', 'primary', false],
].map(([id, name, mode, hidden]) => ({
  id,
  name,
  mode,
  hidden,
  request: { settings: {}, headers: {} },
  permissions: [],
}));

/**
 * `POST /api/session/:id/model` and `/agent` (issues #23/#24): see the header. Stores the choice
 * with NO validation and publishes the durable event. The model route returns without doing
 * anything when the model equals the one STORED on the session (it deduplicates against the stored
 * model only: a session that stores none always gets the `model-switched`, which is what
 * `chatController.applySelection` assumes since the review #1015 W1 decision); the agent route
 * never deduplicates. Deduplication against a stored model was seen on a real opencode 2.0.32 in the
 * planner spike; the no-stored-model case is INVENTED here, not recorded from a real server.
 */
function selectOnSession(session, sub, body) {
  const now = Date.now();
  session.time.updated = now;
  if (sub === 'model') {
    const next = {
      id: body.model.id,
      providerID: body.model.providerID,
      variant: body.model.variant ?? 'default',
    };
    const previous = session.model;
    if (
      previous !== undefined &&
      previous.id === next.id &&
      previous.providerID === next.providerID &&
      (previous.variant ?? 'default') === next.variant
    ) {
      return;
    }
    session.model = next;
    history.get(session.id).push({
      id: nextId('msg'),
      type: 'model-switched',
      time: { created: now },
      model: next,
      ...(previous ? { previous } : {}),
    });
    broadcast('session.model.selected', {
      sessionID: session.id,
      model: next,
      ...(previous ? { previous } : {}),
    });
    return;
  }
  const previous = session.agent;
  session.agent = body.agent;
  history.get(session.id).push({
    id: nextId('msg'),
    type: 'agent-switched',
    time: { created: now },
    agent: body.agent,
    ...(previous ? { previous } : {}),
  });
  broadcast('session.agent.selected', {
    sessionID: session.id,
    agent: body.agent,
    ...(previous ? { previous } : {}),
  });
}

/**
 * Plays the recorded turn for a prompt, one event every few milliseconds. `files` (already in the
 * wire shape, see `toWireFiles`) travels in the `session.inbox.enqueued` payload and is kept in the
 * history entry of the user message, so a snapshot read later shows the attachments too.
 */
function playTurn(sessionID, inboxID, text, files = []) {
  const assistantMessageID = nextId('msg');
  const chosen = selectionOf(sessionID);
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
        item: {
          type: 'user',
          payload: { text, ...(files.length > 0 ? { files } : {}) },
          delivery: 'queue',
        },
      }),
    () => broadcast('session.execution.started', { sessionID }),
    () => {
      history.get(sessionID).push({
        id: inboxID,
        type: 'user',
        text,
        ...(files.length > 0 ? { files } : {}),
        time: { created: Date.now() },
      });
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
        agent: chosen.agent,
        model: chosen.model,
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
          agent: chosen.agent,
          model: chosen.model,
          time: { created: Date.now(), completed: Date.now() },
          finish: 'stop',
          content: [
            ...(toolBlock === undefined ? [] : [toolBlock()].flat()),
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
    if (text.includes('SUBAGENT')) {
      const subagent = subagentTool(a);
      toolBlock = subagent.block;
      steps.push(stepStarted, ...subagent.steps, ...body);
    } else if (text.includes('TOOLS')) {
      const tools = toolsTurn(a);
      toolBlock = tools.blocks;
      steps.push(stepStarted, ...tools.steps, ...body);
    } else if (asking === undefined) {
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
 * `GET /api/session` (issue #20): filters by `directory` (equality), `parentID` (`null` = roots,
 * an id = its children, absent = all) and `search` (case-insensitive substring of the title, so an
 * untitled session never matches), orders by `time.updated` descending with the id as tie-break,
 * cuts `limit` rows (default 50) and, like the real server, returns `cursor.next` on EVERY
 * non-empty page, the last one included. A request with only `cursor` keeps the filters of the
 * query that made it. The cursor is base64url JSON of `{ query, anchor }` (SYNTHETIC format: the
 * real one is also base64url JSON, but its fields were not copied). An undecodable cursor is 400
 * `InvalidCursorError`. The behaviours are copied from the planner spike (opencode 2.0.32, Windows
 * 11, 21/10/2026); the cursor's inner format and the 400 are invented.
 */
function listSessions(params) {
  const cursorText = params.get('cursor');
  let query = Object.fromEntries(params.entries());
  let anchor;
  if (cursorText !== null) {
    try {
      ({ query, anchor } = JSON.parse(Buffer.from(cursorText, 'base64url').toString('utf8')));
    } catch {
      return { error: { _tag: 'InvalidCursorError', message: 'Invalid cursor' } };
    }
  }
  const limit = Number(query.limit ?? 50);
  const needle = typeof query.search === 'string' ? query.search.toLowerCase() : undefined;
  const ordered = (a, b) => b.time.updated - a.time.updated || (a.id < b.id ? 1 : -1);
  const rows = [...sessions.values()]
    .filter((row) => query.directory === undefined || row.location.directory === query.directory)
    .filter((row) => {
      if (query.parentID === undefined) return true;
      return query.parentID === 'null'
        ? row.parentID === undefined
        : row.parentID === query.parentID;
    })
    .filter((row) => needle === undefined || (row.title ?? '').toLowerCase().includes(needle))
    .sort(ordered);
  const start = anchor === undefined ? 0 : rows.findIndex((row) => row.id === anchor) + 1;
  const page = rows.slice(start, start + limit);
  const last = page.at(-1);
  const next =
    last === undefined
      ? undefined
      : Buffer.from(JSON.stringify({ query, anchor: last.id })).toString('base64url');
  return { data: page, cursor: next === undefined ? {} : { next } };
}

/**
 * `DELETE /api/session/:id` (issue #20): interrupts the session if it runs (event
 * `session.execution.interrupted`), deletes its children the same way, then drops its requests,
 * history and row and publishes `session.deleted`; children first, so the order of events is the
 * one the planner spike saw (interrupted, child deleted, parent deleted). No `SessionBusyError`.
 */
function removeSession(sessionID) {
  interrupt(sessionID);
  for (const child of [...sessions.values()].filter((row) => row.parentID === sessionID)) {
    removeSession(child.id);
  }
  dropRequests(sessionID, false);
  sessions.delete(sessionID);
  history.delete(sessionID);
  broadcast('session.deleted', { sessionID });
}

/**
 * Title of a fork, copied from `forkTitle` in `packages/core/src/session/projector.ts` (L51-56) of
 * https://github.com/anomalyco/opencode at tag v2.0.32 (commit 843a6c51), MIT licence: `"<t> (fork
 * #1)"`, and a fork of a fork counts up (`#2`). An untitled original gives an untitled fork
 * (VERIFIED by the planner spike, opencode 2.0.32, 21/10/2026).
 */
function forkTitle(title) {
  if (title === undefined) return undefined;
  const numbered = /^(.*) \(fork #(\d+)\)$/.exec(title);
  return numbered === null
    ? `${title} (fork #1)`
    : `${numbered[1]} (fork #${Number(numbered[2]) + 1})`;
}

/**
 * `POST /api/session/:id/fork` (issue #21), see the header for what is copied and invented.
 * Copies the SETTLED history (an assistant message without `time.completed` is left out) before
 * `body.before`, or all of it, with new ids, into a new root session, answers it and publishes
 * only `session.forked`. Answers the error itself and returns when `before` is unknown or there is
 * nothing to copy.
 */
function forkSession(response, source, body) {
  const original = history.get(source.id);
  let cut = original.length;
  let boundary;
  if (typeof body.before === 'string') {
    const at = original.findIndex((message) => message.id === body.before);
    if (at < 0) {
      json(response, 404, {
        _tag: 'MessageNotFoundError',
        message: `Message not found: ${body.before}`,
        sessionID: source.id,
        messageID: body.before,
      });
      return;
    }
    cut = at;
    boundary = { type: 'before', messageID: body.before };
  } else {
    if (original.length === 0) {
      json(response, 400, {
        _tag: 'InvalidRequestError',
        message: 'The session has no messages',
        kind: 'empty_session',
      });
      return;
    }
    boundary = { type: 'through', messageID: original.at(-1).id };
  }
  const id = nextId('ses');
  const now = Date.now();
  const title = forkTitle(source.title);
  const info = {
    id,
    projectID: 'prj_fake',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: now, updated: now },
    location: source.location,
    fork: { sessionID: source.id, boundary },
    ...(title === undefined ? {} : { title }),
    ...(source.agent === undefined ? {} : { agent: source.agent }),
  };
  sessions.set(id, info);
  history.set(
    id,
    original
      .slice(0, cut)
      .filter((message) => message.type !== 'assistant' || message.time.completed !== undefined)
      .map((message) => ({ ...structuredClone(message), id: nextId('msg') })),
  );
  json(response, 200, { data: info });
  broadcast('session.forked', { sessionID: id, parentID: source.id, boundary });
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
 * The paths `GET /api/fs/find` knows (E7-file-context, issues #28/#29). SYNTHETIC and independent of
 * the folder the server was started in. The shapes copy what the planner saw in a spike against a
 * real opencode 2.0.32 (Windows 11, 22/10/2026): `{path, type}` entries; files with `/`; a
 * directory with a trailing `\` (mixed separators); an empty query answers `[]`. INVENTED: the
 * file names, and the ranking (here: the order of this list).
 */
const FIND_ENTRIES = [
  { path: 'src/sample.ts', type: 'file' },
  { path: 'src/shared/model.ts', type: 'file' },
  { path: 'src/shared\\', type: 'directory' },
  { path: 'src/util/helpers.ts', type: 'file' },
  { path: 'README.md', type: 'file' },
];

/**
 * Imitates `GET /api/fs/find`: keeps the entries whose path contains the characters of `query` in
 * order, ignoring case (a subsequence match, like the fuzzy one the spike saw), then filters by
 * `type` and cuts at `limit` (default 50, read in `search.ts@843a6c51`). An empty query is `[]`.
 */
function findFiles(params) {
  const query = (params.get('query') ?? '').toLowerCase();
  if (query === '') return [];
  const type = params.get('type');
  const limit = Number(params.get('limit') ?? 50);
  const matches = (text) => {
    let at = 0;
    for (const char of query) {
      at = text.indexOf(char, at) + 1;
      if (at === 0) return false;
    }
    return true;
  };
  return FIND_ENTRIES.filter(
    (entry) => (type === null || entry.type === type) && matches(entry.path.toLowerCase()),
  ).slice(0, limit);
}

/**
 * The `files` of a prompt body as the server stores them (VERIFIED by the planner spike with
 * `resume: false`): `source.uri` keeps the URL as sent (query included), `name` and `mention` are
 * kept as sent. `data` is empty here (a real server holds the file's base64); INVENTED: the fixture
 * never reads the file, and says `text/plain` for everything.
 */
function toWireFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.map((file) => ({
    data: '',
    mime: 'text/plain',
    source: { type: 'uri', uri: file.uri },
    ...(file.name === undefined ? {} : { name: file.name }),
    ...(file.mention === undefined ? {} : { mention: file.mention }),
  }));
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
    const listed = listSessions(url.searchParams);
    if (listed.error === undefined) json(response, 200, listed);
    else json(response, 400, listed.error);
    return true;
  }
  if (method === 'POST' && path === '/api/session') {
    readBody(request).then((body) => {
      const id = nextId('ses');
      const now = Date.now();
      const parent = typeof body.parentID === 'string' ? sessions.get(body.parentID) : undefined;
      const info = {
        id,
        projectID: 'prj_fake',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: now, updated: now },
        // A child inherits the location of its parent, like the real one (VERIFIED by the spike).
        location: parent?.location ?? {
          directory: decodeURIComponent(String(request.headers['x-opencode-directory'] ?? '')),
        },
        ...(typeof body.title === 'string' ? { title: body.title } : {}),
        ...(typeof body.parentID === 'string' ? { parentID: body.parentID } : {}),
        ...(typeof body.agent === 'string' ? { agent: body.agent } : {}),
        ...(typeof body.model === 'object' && body.model !== null
          ? { model: { ...body.model, variant: body.model.variant ?? 'default' } }
          : {}),
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
        ...(info.title === undefined ? {} : { title: info.title }),
        ...(info.parentID === undefined ? {} : { parentID: info.parentID }),
        ...(info.agent === undefined ? {} : { agent: info.agent }),
        ...(info.model === undefined ? {} : { model: info.model }),
      });
    });
    return true;
  }
  const location = {
    directory: decodeURIComponent(String(request.headers['x-opencode-directory'] ?? '')),
  };
  if (method === 'GET' && path === '/api/model') {
    json(response, 200, { location, data: CATALOG_MODELS });
    return true;
  }
  if (method === 'GET' && path === '/api/model/default') {
    json(response, 200, { location, data: CATALOG_MODELS[0] });
    return true;
  }
  if (method === 'GET' && path === '/api/provider') {
    json(response, 200, {
      location,
      data: [{ id: 'opencode', name: 'OpenCode', activation: 'auto', package: 'fake' }],
    });
    return true;
  }
  if (method === 'GET' && path === '/api/agent') {
    json(response, 200, { location, data: CATALOG_AGENTS });
    return true;
  }
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
  if (method === 'GET' && path === '/api/fs/find') {
    json(response, 200, { location, data: findFiles(url.searchParams) });
    return true;
  }
  const act = /^\/api\/session\/([^/]+)\/(permission|form)\/([^/]+)(?:\/(reply))?$/.exec(path);
  if (act !== null) return handleAnswer(request, response, act);
  const match =
    /^\/api\/session\/([^/]+)(?:\/(message|permission|form|prompt|interrupt|fork|model|agent))?$/.exec(
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
  if (method === 'PATCH' && sub === undefined) {
    // Issue #20. A non-blank title renames (event + `time.updated` bump, so the session moves to
    // the top of the list, like the spike saw); a blank one answers 204 and does NOTHING here (the
    // real server runs the LLM title generator, which this fake does not imitate).
    readBody(request).then((body) => {
      const title = typeof body.title === 'string' ? body.title : undefined;
      if (title !== undefined && title !== '') {
        session.title = title;
        session.time.updated = Date.now();
        broadcast('session.renamed', { sessionID: session.id, title });
      }
      noContent(response);
    });
    return true;
  }
  if (method === 'DELETE' && sub === undefined) {
    removeSession(session.id);
    noContent(response);
    return true;
  }
  if (method === 'POST' && (sub === 'model' || sub === 'agent')) {
    readBody(request).then((body) => {
      selectOnSession(session, sub, body);
      noContent(response);
    });
    return true;
  }
  if (method === 'POST' && sub === 'fork') {
    readBody(request).then((body) => forkSession(response, session, body));
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
      playTurn(session.id, inboxID, String(body.text), toWireFiles(body.files));
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

/**
 * Lifetime cap of `serve`, in ms: 60 000 unless `FAKE_OPENCODE_LIFETIME_MS` holds a positive
 * integer (issue #41: the `fake-server` integration suite outlives 60 s and sets it to 600 000).
 * Anything else (empty, negative, NaN, a float) is meant to fall back to the default so a typo
 * cannot make the fake exit at once or never.
 * VERIFIED on Windows 11 (22/10/2026), by running `npm run test:integration -- --label
 * fake-server` with the variable set to 600000 (what `.vscode-test.mjs` sets): the fake-server
 * suite finished with 15 passing, and a mutation with 5000 made the later cases fail because the
 * server had exited. HYPOTHESIS: the fallback for invalid values, which no test runs; a
 * `FAKE_OPENCODE_LIFETIME_MS=abc` start observed to stay up past 60 s would confirm it.
 */
function lifetimeMs() {
  const raw = process.env.FAKE_OPENCODE_LIFETIME_MS ?? '';
  return /^[1-9]\d*$/.test(raw) ? Number(raw) : 60_000;
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

  setTimeout(() => process.exit(0), lifetimeMs()); // hard cap, see header

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
    if (request.url === '/api/info' && has('no-info')) {
      response.writeHead(404);
      response.end();
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
