// SYNTHETIC stand-in for `opencode`, born for the unit tests of issue #8 and since used by the e2e
// and integration suites, `test:visual` and the event-shape check. It is NOT opencode.
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
// E5-context-usage (issue #25): every step now reports non-zero tokens (see `STEP_TOKENS`) and the
// assistant message of the history carries them, so the REST snapshot and the stream agree; after
// each step the session row accumulates them and a volatile `session.usage.updated` carries the
// totals (see `addUsage`). A prompt containing COSTLY gives the step a cost of 0.0123 USD (the
// catalog stays free, so a model-free assumption cannot hide it) and one containing COMPACT plays
// a manual compaction after the turn (see `compactionSteps`). SYNTHETIC; the shapes copy the
// planner's spike against a real opencode 2.0.32 (Windows 11, 22/10/2026).
// E8-chat-commands (issue #125) adds `POST /api/session/:id/compact` (see `playCompaction`): the
// compaction message now starts `running` with `id` = the inbox item, and a user message containing
// KEEP_ALL makes the compaction fail with "Nothing to compact yet". SYNTHETIC, like the rest.
// tooling/tests-without-model: `npm run test:visual` no longer needs a model, so it runs against
// this fixture too (through the seam of `testLaunch.ts`, in `ExtensionMode.Development`). What that
// adds is SYNTHETIC: the CONTENT (texts, ids, timing) is invented and the SHAPE of every event is
// the one this file already emitted or the one of `references/eventos-v2.md` (opencode v2.0.32, tag
// 843a6c51); where a shape has no source it says HYPOTHESIS next to it. Nothing here proves that a
// real model behaves like this: `npm run test:event-shapes` is what compares the shapes with a real
// turn when a model is available.
//   - MARKDOWN in a prompt: the reply is a Markdown text (ts and bash fences, a table, a list, an
//     inline file reference, a link) split in deltas 600 ms apart, one of them cutting a fence open.
//   - LONG: the reply is the numbers 1 to 400, five per delta, 200 ms apart (about 16 s), so the
//     turn can be stopped. BROKEN_READ (not "TOOL_FAIL": FAIL is the trigger of a failed turn and
//     matches by substring): a `read` of `src/does-not-exist.ts` that ends in
//     `session.tool.failed` with `error {type: "tool.execution", message: "File not found: ..."}`
//     (the type and the message are READ in `ToolFailure` / `to-session-error.ts` / `read.ts` at
//     843a6c51, never seen running).
//   - A reject or a dismissal WITHOUT a message ends the turn the way the real server does (the
//     opencode-api skill, section 6, records it from a real run of 20/10/2026; not re-checked here):
//     `session.tool.failed` (aborted), `session.step.failed {error: {type: "aborted", message:
//     "Step interrupted"}}` and `session.execution.interrupted {reason: "user"}`. With a message the
//     turn goes on, as before (HYPOTHESIS that the model does).
//   - FAKE_OPENCODE_MODE `visual` (set only by `test/visual/vscodeProcess.mjs`): a catalog with one
//     more primary agent (`docs`), a model without variants and a model with a 5000-token context
//     (so one `STEP_TOKENS` step is 85 %), and `GET /api/fs/find` walks the served folder. Without
//     it the catalog is the two models and four agents the Vitest e2e expects.
//   - A prompt containing CRASH (E2, issue #85; only with FAKE_OPENCODE_STATE_FILE) writes the marker
//     `<state file>.down` and exits with code 1 mid-turn; while the marker exists every start
//     behaves like `exit-early`. Deleting the marker and restarting brings the server back.
//   - While the marker `<state file>.slow-version` exists, `--version` waits for it to go away,
//     at most 8 s (issue #86: `test:visual` step 0 measures "Checking…" in that window).
//   - FAKE_OPENCODE_STATE_FILE: sessions, history and the id counter are loaded from it on start
//     and rewritten after every change (temporary file, then rename), so a relaunched server (the
//     visual run's Restart Server and Reload Window) still has the conversation, as the real
//     server's database does.
// tooling/tests-without-model, first real `npm run test:event-shapes` (opencode 2.0.32, 23/10/2026,
// decision in Engram `tooling/tests-without-model/decisions/event-shape-diffs`): the events now
// carry what that run recorded and this fixture lacked. `session.renamed` with an automatic title
// after the first turn of an untitled session; `session.tool.input.ended` (`{id, text}`) between
// `input.started` and `tool.called`; `data.executed: true` on `tool.called` and `tool.success`;
// `data.metadata.truncated: false` on every `tool.success`; and no `variant` inside the `model` of
// `session.created` (the REST row keeps it, see `selectOnSession`). The VALUES are invented: the
// run only recorded the shape, so the title text and `executed: true` are SYNTHETIC.
// E7-session-diff (issue #31): `GET /api/session/:id/diff?from=&to=&context=` and an EDIT_FILES
// switch. A prompt containing EDIT_FILES ends its step with a `files` list and a `snapshot`, and
// records four changes for the diff route: a modified `src/sample.ts` (`value2 = 2` becomes
// `value2 = 22`), an added `src/added.ts`, a deleted `src/removed.ts` and an added binary
// `assets/logo.png` (empty patch, zero counts). The route follows the READING of
// `core/src/session/diff.ts`, `vcs/git.ts` and `vcs/patch.ts` @843a6c51 (a range of user messages,
// complete files without `context`, only the changes with `context=0`, `MessageNotFoundError` for
// an id the session lacks, 400 `InvalidRequestError` for one that is not a user message); the
// patches are produced by a small line diff here and
// were NEVER compared with a real server's. `GET /api/session/:id/message` now honours `type`,
// `order` and `limit`. Only in `visual` mode do the changes also touch the served folder (see
// `applyEdits`); elsewhere nothing is written.
// E8-slash-commands (issue #33): `GET /api/command` (`{location, data: [{name, description?}]}`,
// not unwrapped) lists `init` and `review` (descriptions copied from the tag v2.0.32 source) plus
// every `*.md` under `<served folder>/.opencode/{command,commands}/**` (name = relative path
// without `.md`, `/` as separator; `description` from the frontmatter), and `POST
// /api/session/:id/command` answers 204 and plays the turn of the expanded template (`$ARGUMENTS`,
// `$1..$N`, else the arguments appended). An unlisted name is 404 `CommandNotFoundError`, a template
// containing FAIL_COMMAND is 500 `CommandExecutionError` (both tags READ in the sources, never
// seen). SYNTHETIC: the templates of the built-ins, the frontmatter parser (only `description`),
// and, INVENTED, that `command.updated` is NEVER emitted (the real server watches the folders).
// E7-message-revert (issue #32): `POST /api/session/:id/revert/stage`, `DELETE .../revert`, `POST
// .../revert/commit` and `GET .../message/:mid`, with the `session.revert.staged|cleared|committed`
// events and a `revert` field on the session row (so `GET /api/session[/:id]` carries it). The
// model, from the READING of `revert.ts` / `session.ts` / `projector.ts` @843a6c51: a stage undoes
// the recorded `EDIT_FILES` edits of the turns from the boundary on (really, on disk, in `visual`
// mode; a prompt containing LARGE adds `docs/big.txt`, a file whose patch is a header with counts),
// a commit deletes the history from the boundary on, and a prompt with a revert staged commits it
// first. The ids and the error `_tag`s (`SessionBusyError`, `MessageNotFoundError`) follow a
// spike against a real opencode 2.0.32 on a `shell` message; everything about FILES is invented
// (the real one only ever answered `files: []` there). EDIT_FILES now turns `value2 = N` into
// `value2 = N2` (2 -> 22, 5 -> 52), so a run can write its own value first.
// E10-config-views (issue #128), phase 1: the READ routes of the OpenCode Settings tab. `GET
// /api/integration[/:id]` (a small SYNTHETIC catalog: key, env, oauth with a form, oauth with
// several methods, external; `/:id` of an unknown one is 404 `IntegrationNotFoundError`) and `GET
// /api/mcp` + `GET /api/mcp/resource` (all `{location, data}`). The MCP list is `[]` at start and,
// 300 ms later, holds 4 servers (connected, failed with a long CRLF error, disabled, needs_auth),
// each announced with `mcp.status.changed` (the spike saw `[]` for the first moments and the fill
// after the first event). A prompt containing MCPFLIP turns `broken` into `connected`, adds a
// resource to it and publishes `mcp.status.changed` and `mcp.resources.changed` (INVENTED trigger).
// Phase 2 adds the AUTH routes (`handleIntegrationWrites`): `connect/key|external` (204, 404 for an
// unknown integration), `connect/oauth` (`auto` with a link to `/fake-oauth/approve?attempt=…` on
// this server, which approves (except for GitHub Copilot, whose page does not, so that `test:visual`
// can see the "waiting" state); method id `code` gives a `code` attempt that `complete` accepts with
// FAKE-CODE), `status`, `complete`, `cancel` (afterwards `status` is 404) and `DELETE
// /api/credential/:id`, each publishing the events in the spike's order. The fake never logs a key.
// Everything above is synthetic.
// On start it writes one stderr line `{"fake":"argv",...}` so tests can check args, cwd and env.
// Every mode has a hard 60 s lifetime so a test that fails half-way cannot leave it running;
// FAKE_OPENCODE_LIFETIME_MS (positive integer, ms) overrides it for `serve` (issue #41).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';

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
const activeSteps = new Map(); // session id -> {a, chosen} of the step in flight, failed by an interrupt
let seq = 0;
let dropped = false;

// ---- E10-config-views (issue #128), phase 1: the READ routes of the OpenCode Settings tab ----

/**
 * The MCP servers `GET /api/mcp` lists once {@link populateMcp} ran, in this order: `docs`
 * connected, `broken` failed (an error whose first line is longer than 200 characters and that has
 * `\r\n` and more lines, like the stderr the spike saw), `off` disabled, `linear` needs_auth. The
 * names, statuses and texts are SYNTHETIC; the shapes follow the types of `@opencode/client`
 * 2.0.32 and the planner's spike (01/11/2026).
 */
const MCP_FIXTURE = [
  { name: 'docs', status: { status: 'connected' } },
  {
    name: 'broken',
    status: {
      status: 'failed',
      error: `Connection closed: MCP server process exited with code 1 ${'while starting the server '.repeat(12)}\r\nsecond stderr line\r\nthird stderr line`,
    },
  },
  { name: 'off', status: { status: 'disabled' } },
  {
    name: 'linear',
    status: { status: 'needs_auth', error: 'Sign in with the opencode CLI to use this server' },
  },
];
/** What `GET /api/mcp/resource` lists, per server (`MCPFLIP` adds a resource to `broken`). */
const MCP_RESOURCES = [
  { server: 'docs', name: 'readme.md', uri: 'file:///docs/readme.md', mimeType: 'text/markdown' },
  { server: 'docs', name: 'api.md', uri: 'file:///docs/api.md', description: 'API notes' },
];
const MCP_TEMPLATES = [
  { server: 'docs', name: 'files', uriTemplate: 'file:///docs/{path}', description: 'Any doc' },
];
/** Delay of the first fill of the MCP list after the server starts (the spike saw about 580 ms). */
const MCP_FILL_DELAY_MS = 300;
/** Empty until {@link populateMcp}: a real server answers `[]` for the first moments. */
let mcpServers = [];
let mcpResources = [];
let mcpTemplates = [];
let mcpFlipped = false;

/**
 * Fills the MCP list (4 servers, their resources) and publishes one `mcp.status.changed` per
 * server, like the first events the spike saw. Runs once, {@link MCP_FILL_DELAY_MS} after start.
 */
function populateMcp() {
  mcpServers = MCP_FIXTURE.map((server) => structuredClone(server));
  mcpResources = MCP_RESOURCES.map((resource) => ({ ...resource }));
  mcpTemplates = MCP_TEMPLATES.map((template) => ({ ...template }));
  for (const server of mcpServers) broadcast('mcp.status.changed', { server: server.name });
  // The catalog read at `server.connected` came before this fill. `docs` is the connected server
  // with resources, so announce them. Mirrors upstream opencode 843a6c5
  // (`packages/core/src/mcp/index.ts`): L463-465 publish `ResourcesChanged` when a server
  // connects, from the `startServer` calls at L518 and L558 (read in the review of this task, #1689;
  // not run end to end against a real stream, so the store also re-reads the catalog on
  // `mcp.status.changed`). Only the order and timing of the burst are invented here.
  for (const server of new Set(mcpResources.map((resource) => resource.server))) {
    broadcast('mcp.resources.changed', { server });
  }
}

/**
 * MCPFLIP (INVENTED trigger, for `test:visual` cell V4): `broken` becomes `connected` and gains a
 * resource, publishing `mcp.status.changed` and `mcp.resources.changed` for it. Idempotent.
 */
function flipMcp() {
  if (mcpFlipped) return;
  mcpFlipped = true;
  const broken = mcpServers.find((server) => server.name === 'broken');
  if (broken !== undefined) broken.status = { status: 'connected' };
  mcpResources.push({
    server: 'broken',
    name: 'status.md',
    uri: 'file:///broken/status.md',
    mimeType: 'text/markdown',
  });
  broadcast('mcp.status.changed', { server: 'broken' });
  broadcast('mcp.resources.changed', { server: 'broken' });
}

/**
 * The integrations `GET /api/integration` lists: a SMALL catalog (the real one has 238) with one
 * of each kind the tab handles. Shapes follow `IntegrationInfo` of `@opencode/client` 2.0.32 and the
 * spike's list of methods; ids, labels and forms are SYNTHETIC. No secret in it, like the real
 * `integration.list`. Module state, so connect and remove change the connections.
 */
const integrationRows = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    methods: [{ type: 'key' }, { type: 'env', names: ['ANTHROPIC_API_KEY'] }],
    connections: [
      { type: 'credential', id: 'cred_fake_anthropic', label: 'default', method: 'key' },
    ],
  },
  {
    id: 'google-vertex',
    name: 'Google Vertex',
    methods: [
      {
        type: 'key',
        form: [
          { key: 'project', type: 'string', title: 'Project' },
          {
            key: 'location',
            type: 'string',
            title: 'Location',
            options: [
              { value: 'us-central1', label: 'us-central1' },
              { value: 'europe-west4', label: 'europe-west4' },
            ],
          },
        ],
      },
      { type: 'env', names: ['GOOGLE_APPLICATION_CREDENTIALS'] },
    ],
    connections: [{ type: 'env', name: 'GOOGLE_APPLICATION_CREDENTIALS' }],
  },
  {
    id: 'azure',
    name: 'Azure',
    methods: [
      {
        type: 'key',
        form: [{ key: 'resourceName', type: 'string', title: 'Resource name', required: true }],
      },
    ],
    connections: [],
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    methods: [
      {
        type: 'oauth',
        id: 'device',
        label: 'Login with GitHub',
        form: [
          {
            key: 'deploymentType',
            type: 'string',
            title: 'Deployment type',
            required: true,
            options: [
              { value: 'github.com', label: 'GitHub.com' },
              { value: 'enterprise', label: 'GitHub Enterprise' },
            ],
          },
          {
            key: 'enterpriseUrl',
            type: 'string',
            title: 'Enterprise URL',
            when: [{ key: 'deploymentType', op: 'eq', value: 'enterprise' }],
          },
        ],
      },
    ],
    connections: [],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    methods: [
      { type: 'oauth', id: 'chatgpt-browser', label: 'ChatGPT Pro/Plus (browser)' },
      { type: 'oauth', id: 'chatgpt-headless', label: 'ChatGPT Pro/Plus (headless)' },
      { type: 'key' },
    ],
    connections: [],
  },
  {
    id: 'fakeco',
    name: 'FakeCo',
    methods: [{ type: 'oauth', id: 'code', label: 'Paste a code' }],
    connections: [],
  },
  {
    id: 'amazon-bedrock',
    name: 'Amazon Bedrock',
    methods: [
      {
        type: 'external',
        id: 'profile',
        label: 'AWS profile',
        form: [
          {
            key: 'profile',
            type: 'string',
            title: 'Profile',
            options: [
              { value: 'default', label: 'default' },
              { value: 'work', label: 'work' },
            ],
          },
        ],
      },
    ],
    connections: [],
  },
];

/** Next synthetic id with a prefix, e.g. `msg_000001`. */
const nextId = (prefix) => `${prefix}_${String(++seq).padStart(6, '0')}`;

/** Where the conversation is kept between processes (see the header); empty = in memory only. */
const STATE_FILE = process.env.FAKE_OPENCODE_STATE_FILE ?? '';
/** The marker a CRASH turn leaves next to the state file; while it exists every start fails. */
const DOWN_MARKER = `${STATE_FILE}.down`;

/**
 * Loads sessions, history and the id counter from {@link STATE_FILE} when it exists. A missing or
 * unreadable file starts from nothing: the file is a convenience of the visual run, never required.
 */
function loadState() {
  if (STATE_FILE === '' || !fs.existsSync(STATE_FILE)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const [id, row] of saved.sessions) sessions.set(id, row);
    for (const [id, messages] of saved.history) history.set(id, messages);
    for (const [id, edits] of saved.edits ?? []) sessionEdits.set(id, edits);
    for (const [id, moves] of saved.reverts ?? []) revertSaved.set(id, moves);
    seq = saved.seq;
  } catch {
    sessions.clear();
    history.clear();
    sessionEdits.clear();
    revertSaved.clear();
  }
}

/**
 * Writes the state to a temporary file and renames it over {@link STATE_FILE}, so a kill half way
 * through a write leaves the previous complete file, not a truncated one.
 */
function saveState() {
  if (STATE_FILE === '') return;
  const temporary = `${STATE_FILE}.tmp`;
  fs.writeFileSync(
    temporary,
    JSON.stringify({
      seq,
      sessions: [...sessions],
      history: [...history],
      edits: [...sessionEdits],
      reverts: [...revertSaved],
    }),
  );
  fs.renameSync(temporary, STATE_FILE);
}

let saveTimer;
/** Saves soon after a change (25 ms, coalescing the burst of one turn); never keeps the process alive. */
function scheduleSave() {
  if (STATE_FILE === '' || saveTimer !== undefined) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      saveState();
    } catch {
      // The state directory may be gone already (the test cleaned up first): not a crash.
    }
  }, 25);
  saveTimer.unref();
}

/** Writes one SSE data frame to every open `/api/event` connection. */
function broadcast(type, data) {
  const frame = `data: ${JSON.stringify({ id: nextId('evt'), created: Date.now(), type, data })}\n\n`;
  for (const client of sseClients) client.write(frame);
  scheduleSave();
}

/**
 * The two steps that open a tool call: `session.tool.input.started` and `session.tool.input.ended`.
 *
 * The real server sends `input.ended` with `text`, the input as a JSON string, before
 * `tool.called` (shape recorded by `test:event-shapes` against opencode 2.0.32, 23/10/2026; the
 * host turns it into a `streaming` tool state). No `input.delta` is played: the host does not need
 * one and the fake never had it. `a` is `{sessionID, assistantMessageID}`.
 */
function toolInputSteps(a, id, name, input) {
  return [
    () => broadcast('session.tool.input.started', { ...a, id, name }),
    () => broadcast('session.tool.input.ended', { ...a, id, text: JSON.stringify(input) }),
  ];
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
 * `result.answer` the form answer. `after` returns `{steps, aborted}`: `aborted` is true when the
 * user declined WITHOUT a message, which cuts the turn (the caller plays `abortedSteps` instead of
 * the rest of the reply). SYNTHETIC, but the FINAL STATES copy the rows of a real opencode
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
    ...toolInputSteps(a, toolID, name, input),
    () => broadcast('session.tool.called', { ...a, id: toolID, input, executed: true }),
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
          ? {
              answers: [[String(answer.q0 ?? '')], Array.isArray(answer.q1) ? answer.q1 : []],
              truncated: false,
            }
          : { truncated: false };
      state = { status: 'completed', input, content, metadata };
      return {
        aborted: false,
        steps: [
          () =>
            broadcast('session.tool.success', {
              ...a,
              id: toolID,
              content,
              metadata,
              executed: true,
            }),
        ],
      };
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
    return {
      // Without a message the real turn is cut (see the header); with one, it goes on.
      aborted: !hasMessage,
      steps: [() => broadcast('session.tool.failed', { ...a, id: toolID, error })],
    };
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
    ...toolInputSteps(a, toolID, 'subagent', input),
    () => broadcast('session.tool.called', { ...a, id: toolID, input, executed: true }),
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
    () =>
      broadcast('session.tool.success', { ...a, id: toolID, content, metadata, executed: true }),
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
 * `webfetch` and an unknown MCP-style tool, each as `tool.input.started -> tool.input.ended ->
 * tool.called -> tool.success` (`truncated: false` in every metadata). SYNTHETIC / HYPOTHESIS:
 * the shapes of `input`, `content` and `metadata` are those
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
          text: 'Read file src/sample.ts, lines 1-2\n1: // Sample file for the visual test run.\n2: export const two = 2;',
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
      metadata: { truncated: false },
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
      metadata: { contentType: 'text/html', truncated: false },
    },
    {
      name: 'mcp_echo',
      input: { message: 'hi' },
      content: [{ type: 'text', text: 'echo: hi' }],
      metadata: { truncated: false },
    },
  ].map((spec) => ({ ...spec, id: nextId('call') }));
  const steps = specs.flatMap((spec) => [
    ...toolInputSteps(a, spec.id, spec.name, spec.input),
    () =>
      broadcast('session.tool.called', { ...a, id: spec.id, input: spec.input, executed: true }),
    () =>
      broadcast('session.tool.success', {
        ...a,
        id: spec.id,
        content: spec.content,
        metadata: spec.metadata,
        executed: true,
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

/**
 * The tool call of a `BROKEN_READ` turn: a `read` of a file that does not exist, as
 * `tool.input.started -> tool.input.ended -> tool.called -> tool.failed`. SYNTHETIC / HYPOTHESIS for
 * the event sequence (the same events the other tools use); the error is READ, not recorded:
 * `ToolFailure` without an inner error becomes `{type: "tool.execution", message}` in
 * `to-session-error.ts`, and `read.ts` builds the message `File not found: <path>` (plus a "Did you
 * mean" list that is absent when no sibling resembles the name), both at tag v2.0.32 (843a6c51,
 * read with `gh api` on 22/10/2026). `block()` is the failed tool block of the REST message.
 */
function failedReadTurn(a) {
  const id = nextId('call');
  const input = { path: 'src/does-not-exist.ts' };
  const error = { type: 'tool.execution', message: 'File not found: src/does-not-exist.ts' };
  const steps = [
    ...toolInputSteps(a, id, 'read', input),
    () => broadcast('session.tool.called', { ...a, id, input, executed: true }),
    () => broadcast('session.tool.failed', { ...a, id, error }),
  ];
  const block = () => ({
    type: 'tool',
    id,
    name: 'read',
    state: { status: 'error', input, error },
    time: { created: Date.now() },
  });
  return { steps, block };
}

/**
 * Marks a step with the milliseconds to wait BEFORE it runs, overriding the turn's interval
 * (`schedule` in `playTurn` adds them up). Used to pace the text deltas of the long replies.
 */
const paced = (ms, step) => Object.assign(step, { delay: ms });

/**
 * The Markdown a `MARKDOWN` turn answers with, in the deltas it is streamed in: a ts fence, a bash
 * fence, a 2x2 table, a list of two, an inline file reference (`src/sample.ts:20`), inline code and
 * a link. The first fence is left open at the end of the first delta, so a screenshot taken
 * mid-stream sees an unclosed block. SYNTHETIC content; `text.delta` x N then `text.ended` is the
 * order of references/eventos-v2.md.
 */
const MARKDOWN_DELTAS = [
  'Here is the reply.\n\n```ts\nexport function greet(name: string): string {\n',
  '  return `Hello, ${name}!`;\n}\n```\n\n',
  '```bash\nnpm run build && echo done\n```\n\n',
  '| Name | Value |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |\n\n',
  '- first item\n- second item\n\n',
  'The sample is at `src/sample.ts:20`, see also `greet()`. ',
  'More: [VS Code](https://code.visualstudio.com).',
];

/** The numbers 1 to 400, one per line, in deltas of five: the reply of a `LONG` turn. */
const LONG_DELTAS = Array.from({ length: 80 }, (_, chunk) =>
  Array.from({ length: 5 }, (_, i) => `${String(chunk * 5 + i + 1)}\n`).join(''),
);

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
  ['big-pickle', 'Big Pickle', true, 200000],
  ['glm-5.3-flash-free', 'GLM-5.3-Flash Free', true, 200000],
  // Only in `visual` mode: no variants (the variant control disappears) and a 5000-token window,
  // so one step of STEP_TOKENS (4248) is 85 % and the context line reaches its `high` level.
  ...(has('visual') ? [['tiny-context', 'Tiny Context', false, 5000]] : []),
].map(([id, name, withVariants, context]) => ({
  id,
  modelID: id,
  providerID: 'opencode',
  name,
  // INVENTED which one reads images: only `glm-5.3-flash-free`, so the tests can show both sides
  // of the "cannot read images" warning (issue #30). The real catalog says it per model.
  capabilities: {
    tools: true,
    input: id === 'glm-5.3-flash-free' ? ['text', 'image'] : ['text'],
    output: ['text'],
  },
  variants: withVariants ? [{ id: 'low' }, { id: 'high' }] : [],
  time: { released: 1 },
  cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  status: 'active',
  enabled: true,
  limit: { context, output: 32000 },
}));

const CATALOG_AGENTS = [
  ['build', 'Build', 'primary', false],
  ['general', 'General', 'subagent', false],
  ['title', 'Title', 'primary', true],
  ['plan', 'Plan', 'primary', false],
  // Only in `visual` mode: a custom primary agent, so the Agent column of the chip's panel has a third row.
  ...(has('visual') ? [['docs', 'Docs', 'primary', false]] : []),
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

/** Tokens every step reports (issue #25): 1200 + 40 + 8 + 3000 = 4248 in the context. SYNTHETIC. */
const STEP_TOKENS = { input: 1200, output: 40, reasoning: 8, cache: { read: 3000, write: 0 } };

/** Cost of a step whose prompt contains COSTLY, in USD. SYNTHETIC. */
const COSTLY_STEP_COST = 0.0123;

/**
 * Adds a step's usage to the session row and publishes the accumulated totals as the volatile
 * `session.usage.updated`, after the step like the real projector does (issue #25). The row is what
 * `session.list` / `session.get` return, so a snapshot read later agrees with the event. SYNTHETIC;
 * the rule "totals are accumulated and equal on the event and on the REST row" is the planner's
 * spike against a real opencode 2.0.32 (Windows 11, 22/10/2026).
 */
function addUsage(sessionID, cost, tokens) {
  const row = sessions.get(sessionID);
  if (row === undefined) return;
  row.cost += cost;
  row.tokens = {
    input: row.tokens.input + tokens.input,
    output: row.tokens.output + tokens.output,
    reasoning: row.tokens.reasoning + tokens.reasoning,
    cache: {
      read: row.tokens.cache.read + tokens.cache.read,
      write: row.tokens.cache.write + tokens.cache.write,
    },
  };
  broadcast('session.usage.updated', { sessionID, cost: row.cost, tokens: row.tokens });
}

/** The error a compaction with nothing to compact ends with (`compaction.ts@843a6c51` L336, read). */
const NOTHING_TO_COMPACT = { type: 'compaction.unavailable', message: 'Nothing to compact yet' };

/**
 * The steps of a manual compaction (a prompt containing COMPACT, after its turn, or
 * `POST /api/session/:id/compact`): `compaction.started` with the `inputID` and a `running`
 * `compaction` message in the history whose `time.created` is the moment of the `started` event,
 * then either `compaction.delta`, `usage.updated` for the summary and `compaction.ended` (the
 * message becomes `completed`) or, with `fail`, `compaction.failed` (the message becomes `failed`
 * with the error). SYNTHETIC; the event ORDER and the message shape of the completed case copy the
 * planner's spike against a real opencode 2.0.32 (Windows 11, 22/10/2026), whose REST message had
 * `id` = the `inputID`; the running and failed messages, the delta and the `failed` event come from
 * the types and the source only. The earlier messages stay in the history, as the spike saw.
 */
function compactionSteps(sessionID, inputID, fail = false) {
  const message = {
    id: inputID,
    type: 'compaction',
    status: 'running',
    reason: 'manual',
    summary: '',
    recent: '',
    time: { created: 0 },
  };
  const started = () => {
    message.time.created = Date.now();
    history.get(sessionID).push(message);
    broadcast('session.compaction.started', { sessionID, reason: 'manual', recent: '', inputID });
  };
  if (fail) {
    return [
      started,
      () => {
        message.status = 'failed';
        message.error = NOTHING_TO_COMPACT;
        delete message.summary;
        delete message.recent;
        broadcast('session.compaction.failed', {
          sessionID,
          reason: 'manual',
          error: NOTHING_TO_COMPACT,
          inputID,
        });
      },
    ];
  }
  return [
    started,
    () => broadcast('session.compaction.delta', { sessionID, text: 'sum' }),
    () =>
      addUsage(sessionID, 0, {
        input: 300,
        output: 20,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }),
    () => {
      message.status = 'completed';
      message.summary = 'summary';
      broadcast('session.compaction.ended', {
        sessionID,
        reason: 'manual',
        text: 'summary',
        recent: '',
      });
    },
  ];
}

/**
 * Plays the manual compaction `POST /api/session/:id/compact` admitted (issue #125):
 * `execution.started`, the steps of {@link compactionSteps}, then `execution.succeeded`. A session
 * with a user message containing KEEP_ALL (INVENTED trigger, `test:visual` step 33 cell K2) has
 * "nothing to compact": the compaction fails with {@link NOTHING_TO_COMPACT} but the execution
 * still ends with `execution.succeeded` and no `idle` failed message. Read in the opencode code at
 * tag 843a6c51 (not recorded from a live server): for "nothing to compact", `compaction.ts`
 * L235-237 (`matchEffect`) sends it to `publish`, which emits `compaction.failed` and returns
 * `{status:'failed'}` as a success (L639-646), and `runner/llm.ts` carries on (L161-162), so the
 * drain ends normally. The timers are kept in
 * `turnTimers`, so an interrupt cancels what is left.
 */
function playCompaction(sessionID, inputID) {
  const fail = (history.get(sessionID) ?? []).some(
    (message) => message.type === 'user' && String(message.text).includes('KEEP_ALL'),
  );
  const steps = [
    () => broadcast('session.execution.started', { sessionID }),
    ...compactionSteps(sessionID, inputID, fail),
    () => {
      running.delete(sessionID);
      broadcast('session.execution.succeeded', { sessionID });
    },
  ];
  let at = 0;
  turnTimers.set(
    sessionID,
    steps.map((step) => setTimeout(step, (at += 15))),
  );
}

/**
 * Plays the recorded turn for a prompt, one event every few milliseconds. `files` (already in the
 * wire shape, see `toWireFiles`) travels in the `session.inbox.enqueued` payload and is kept in the
 * history entry of the user message, so a snapshot read later shows the attachments too. The first
 * answered turn of a session without a title ends with a `session.renamed` (the row gets the start
 * of the prompt as its title); a stopped or failed turn never reaches it. A prompt containing
 * EDIT_FILES makes the step end with the `files` and `snapshot` of {@link applyEdits} (issue #31).
 * Two triggers are served BEFORE the turn: WIPE_SESSIONS deletes every session and plays NO turn at
 * all; DELETE_TITLED:<needle> deletes the other sessions whose title contains the needle and the
 * turn then plays as usual (both INVENTED, for `test:visual` steps 28 and 29). MCPFLIP (issue #128,
 * INVENTED) flips an MCP server first (see `flipMcp`) and the turn plays as usual.
 */
function playTurn(sessionID, inboxID, text, files = []) {
  // MCPFLIP (E10-config-views, issue #128; INVENTED trigger, see {@link flipMcp}): flips an MCP
  // server and the turn then plays as usual.
  if (text.includes('MCPFLIP')) flipMcp();
  // WIPE_SESSIONS (E9-sessions-sidebar, issue #77 E3; INVENTED trigger, `test:visual` step 29 cell
  // V4): deletes EVERY session of the folder, the running one too, publishing `session.deleted`
  // for each, and plays no turn, so the Sessions tree gets its "empty folder" state.
  if (text.includes('WIPE_SESSIONS')) {
    for (const id of [...sessions.keys()]) {
      if (sessions.has(id)) removeSession(id);
    }
    running.delete(sessionID);
    return;
  }
  // DELETE_TITLED:<needle> (same task; INVENTED trigger, `test:visual` step 28 R5): another client
  // deletes every OTHER session whose title contains `<needle>`, publishing `session.deleted`, and
  // the turn then plays as usual. It stands in for the picker of a tab, which no longer exists.
  const doomed = /DELETE_TITLED:(\S+)/.exec(text)?.[1];
  if (doomed !== undefined) {
    for (const [id, row] of [...sessions]) {
      if (id !== sessionID && (row.title ?? '').includes(doomed)) removeSession(id);
    }
  }
  // SEED_SESSIONS (same task; INVENTED trigger, cell B5): adds 55 root sessions titled
  // "Seed29 NN" beside the one that sent the prompt, the first 50 updated one second apart and all
  // OLDER than it, the last five days old, so the tree (page size 50) has a "Show more sessions"
  // row and the second page brings the older date groups. They have no history. The turn then
  // plays as usual.
  if (text.includes('SEED_SESSIONS')) {
    const location = sessions.get(sessionID)?.location ?? { directory: '' };
    const base = Date.now() - 60_000;
    const DAY = 86_400_000;
    // The last five are old on purpose, one per date group beyond "Today": noon of yesterday, three
    // days, nine days, twenty days and sixty days back ("Yesterday", "Previous 7 days", "Older").
    // The first is counted from the local midnight, not from now: "a day and a half ago" falls on
    // the day before yesterday in a run started before noon, and the tree then has no "Yesterday"
    // group (seen 30/10/2026 at 10:00: check B5 of `test:visual` step 29 read ["Today", "Previous 7
    // days", "Older"]; the same step passed at 22:19 the day before).
    const midnight = new Date().setHours(0, 0, 0, 0);
    const old = [midnight - DAY / 2, ...[3, 9, 20, 60].map((days) => Date.now() - days * DAY)];
    for (let index = 0; index < 55; index += 1) {
      const id = nextId('ses');
      const stamp = index >= 50 ? old[index - 50] : base - index * 1_000;
      const title = `Seed29 ${String(index + 1).padStart(2, '0')}`;
      sessions.set(id, {
        id,
        projectID: 'prj_fake',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: stamp, updated: stamp },
        location,
        title,
      });
      history.set(id, []);
      broadcast('session.created', {
        sessionID: id,
        projectID: 'prj_fake',
        slug: id,
        version: '2.0.32',
        location,
        title,
      });
    }
  }
  // CRASH (E2, issue #85): the server dies in the middle of a turn and cannot come back until the
  // marker `<FAKE_OPENCODE_STATE_FILE>.down` is deleted. Only with a state file, because the
  // marker lives next to it and the conversation must survive the exit (the `exit` handler of
  // `runServe` saves it). Exit code 1, as a crashed process would.
  if (text.includes('CRASH') && STATE_FILE !== '') {
    fs.writeFileSync(DOWN_MARKER, 'crashed on purpose by the CRASH trigger\n');
    process.exit(1);
  }
  const assistantMessageID = nextId('msg');
  const chosen = selectionOf(sessionID);
  const a = { sessionID, assistantMessageID };
  const fail = text.includes('FAIL');
  // Taken before the turn pushes anything: the automatic title follows the FIRST answered turn.
  const firstTurn = !history.get(sessionID).some((message) => message.type === 'assistant');
  // Issue #25: COSTLY makes the step cost money (the catalog stays free).
  const stepCost = text.includes('COSTLY') ? COSTLY_STEP_COST : 0;
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
    const stepStarted = () => {
      activeSteps.set(sessionID, { a, chosen });
      broadcast('session.step.started', {
        ...a,
        agent: chosen.agent,
        model: chosen.model,
        started: Date.now(),
      });
    };
    // The reply: two short deltas by default; the Markdown or the long numbered text on request.
    const deltas = text.includes('MARKDOWN')
      ? MARKDOWN_DELTAS
      : text.includes('LONG')
        ? LONG_DELTAS
        : ['hello ', 'there'];
    const pace = text.includes('MARKDOWN') ? 600 : text.includes('LONG') ? 200 : undefined;
    const reply = deltas.join('');
    const body = [
      () => broadcast('session.reasoning.started', { ...a, ordinal: 0 }),
      () => broadcast('session.reasoning.delta', { ...a, ordinal: 0, delta: 'thinking ' }),
      () => broadcast('session.reasoning.delta', { ...a, ordinal: 0, delta: 'about it' }),
      () => broadcast('session.text.started', { ...a, ordinal: 0 }),
      () => broadcast('session.reasoning.ended', { ...a, ordinal: 0, text: 'thinking about it' }),
      ...deltas.map((delta) => {
        const step = () => broadcast('session.text.delta', { ...a, ordinal: 0, delta });
        return pace === undefined ? step : paced(pace, step);
      }),
      () => broadcast('session.text.ended', { ...a, ordinal: 0, text: reply }),
      () => {
        history.get(sessionID).push({
          id: assistantMessageID,
          type: 'assistant',
          agent: chosen.agent,
          model: chosen.model,
          time: { created: Date.now(), completed: Date.now() },
          finish: 'stop',
          cost: stepCost,
          tokens: STEP_TOKENS,
          content: [
            ...(toolBlock === undefined ? [] : [toolBlock()].flat()),
            { type: 'reasoning', text: 'thinking about it', time: { created: 1, completed: 2 } },
            { type: 'text', text: reply },
          ],
        });
        activeSteps.delete(sessionID);
        // E7-session-diff: an EDIT_FILES turn changes files, and the step says which (and the
        // snapshot that holds them), like the `files` / `snapshot` of the real `step.ended` types.
        const changed = text.includes('EDIT_FILES')
          ? applyEdits(sessionID, inboxID, sessions.get(sessionID)?.location?.directory ?? '', text)
          : undefined;
        broadcast('session.step.ended', {
          ...a,
          finish: 'stop',
          cost: stepCost,
          tokens: STEP_TOKENS,
          ...(changed === undefined ? {} : { snapshot: nextId('snap'), files: changed }),
        });
        addUsage(sessionID, stepCost, STEP_TOKENS);
      },
      ...(text.includes('COMPACT') ? compactionSteps(sessionID, nextId('msg')) : []),
      () => {
        // The automatic title of the real server, once the first turn of an untitled session is
        // done; its text here is just the start of the prompt (SYNTHETIC).
        const row = sessions.get(sessionID);
        if (!firstTurn || row === undefined || row.title !== undefined) return;
        // Trimmed: the visual run finds a row by its text and the header does not keep a trailing
        // space, so an untrimmed 40-character cut made the two disagree (seen 23/10/2026).
        row.title = text.slice(0, 40).trim();
        row.time.updated = Date.now();
        broadcast('session.renamed', { sessionID, title: row.title });
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
    } else if (text.includes('BROKEN_READ')) {
      const failed = failedReadTurn(a);
      toolBlock = failed.block;
      steps.push(stepStarted, ...failed.steps, ...body);
    } else if (asking === undefined) {
      steps.push(stepStarted, ...body);
    } else {
      // The turn pauses at the ask and the rest is held in `gates` until a reply resumes it.
      const tool = askingTool(asking, a);
      toolBlock = tool.block;
      steps.push(stepStarted, ...tool.before);
      /**
       * The steps of a turn cut by a reject/dismissal without a message (see the header): the
       * assistant message with the failed tool block and the error lands in the history, then
       * `session.step.failed` and `session.execution.interrupted`. HYPOTHESIS for the REST message
       * (`error` set, no `finish`, no tokens): the types allow it, no real one was read.
       */
      const abortedSteps = () => {
        const error = { type: 'aborted', message: 'Step interrupted' };
        return [
          () => {
            const now = Date.now();
            activeSteps.delete(sessionID);
            history.get(sessionID).push({
              id: assistantMessageID,
              type: 'assistant',
              agent: chosen.agent,
              model: chosen.model,
              time: { created: now, completed: now },
              error,
              content: [tool.block()],
            });
            broadcast('session.step.failed', { ...a, error });
          },
          () => {
            running.delete(sessionID);
            broadcast('session.execution.interrupted', { sessionID, reason: 'user' });
          },
        ];
      };
      gates.set(sessionID, (result) => {
        gates.delete(sessionID);
        const outcome = tool.after(result);
        schedule([...outcome.steps, ...(outcome.aborted ? abortedSteps() : body)]);
      });
    }
  }
  // A prompt containing SLOW plays 20x slower (about 5 s), so a test can interrupt it mid-turn.
  const interval = text.includes('SLOW') ? 300 : 15;
  /**
   * Plays `list` one `interval` apart (a step marked by `paced` waits its own time instead); the
   * timers are kept so an interrupt can cancel them.
   */
  function schedule(list) {
    let at = 0;
    const timers = list.map((step) => {
      at += step.delay ?? interval;
      return setTimeout(step, at);
    });
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
 * was in flight, drops its remaining events, fails the step in flight (`session.step.failed`,
 * `aborted`) and emits `session.execution.interrupted`.
 */
function interrupt(sessionID) {
  if (!running.has(sessionID)) return false;
  for (const timer of turnTimers.get(sessionID) ?? []) clearTimeout(timer);
  turnTimers.delete(sessionID);
  gates.delete(sessionID);
  // A pending request dies with the turn, and NO `permission.replied` is published for it.
  dropRequests(sessionID, false);
  // A step in flight fails with `aborted` / "Step interrupted" before the execution is interrupted,
  // as the real server does (recorded by the opencode-api skill, section 7, from a real spike of
  // 20/10/2026; not re-checked here). The assistant message that reaches the history holds no
  // content: HYPOTHESIS, the partial text the real one keeps was not inspected.
  const step = activeSteps.get(sessionID);
  if (step !== undefined) {
    activeSteps.delete(sessionID);
    const error = { type: 'aborted', message: 'Step interrupted' };
    const now = Date.now();
    history.get(sessionID)?.push({
      id: step.a.assistantMessageID,
      type: 'assistant',
      agent: step.chosen.agent,
      model: step.chosen.model,
      time: { created: now, completed: now },
      error,
      content: [],
    });
    broadcast('session.step.failed', { ...step.a, error });
  }
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
  sessionEdits.delete(sessionID);
  revertSaved.delete(sessionID);
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

// ---------------------------------------------------------------------------------------------
// E7-session-diff (issue #31): the "Changed files" turn and `GET /api/session/:id/diff`.
// ---------------------------------------------------------------------------------------------

const sessionEdits = new Map(); // session id -> [{ userID, file, before, after, binary }], in order

/** The text of `src/sample.ts` when the folder is not the visual run's (nothing is on disk). */
const SAMPLE_BEFORE = '// Sample file for the visual test run.\nexport const value2 = 2;\n';

/** Lines of a text: no trailing empty element for a final newline; `[]` for no text. */
function linesOf(text) {
  if (text === undefined || text === '') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Line diff by longest common subsequence: `[' ' | '-' | '+', line]` pairs. Files are tiny. */
function lineOps(before, after) {
  const a = linesOf(before);
  const b = linesOf(after);
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push([' ', a[i]]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push(['-', a[i++]]);
    } else {
      ops.push(['+', b[j++]]);
    }
  }
  while (i < a.length) ops.push(['-', a[i++]]);
  while (j < b.length) ops.push(['+', b[j++]]);
  return ops;
}

/**
 * The patch of one file in the format READ in `vcs/git.ts` / `patch.ts` @843a6c51
 * (`git diff --unified=N --no-renames`): a header, then hunks. Without `context` the only hunk is
 * the whole file ("Omit for full-file patches"); with `context` the hunks hold that many lines
 * around each change. SYNTHETIC: written from the reading, never compared with a real patch. A
 * binary file has the empty patch, as read. `tooLarge` returns the header with no hunks and the
 * INVENTED counts +1200 -0 (what a file cut for size looks like, issue #32), whatever the texts.
 * Every file here ends in a newline.
 */
function patchOf(file, status, before, after, binary, context, tooLarge = false) {
  if (binary) return { patch: '', additions: 0, deletions: 0 };
  const ops = lineOps(before, after);
  const additions = ops.filter((op) => op[0] === '+').length;
  const deletions = ops.filter((op) => op[0] === '-').length;
  const header = [
    `diff --git a/${file} b/${file}`,
    ...(status === 'added' ? ['new file mode 100644'] : []),
    ...(status === 'deleted' ? ['deleted file mode 100644'] : []),
    'index 1111111..2222222 100644',
    `--- ${status === 'added' ? '/dev/null' : `a/${file}`}`,
    `+++ ${status === 'deleted' ? '/dev/null' : `b/${file}`}`,
  ];
  // A file the server cut for size (issue #31/#32): the header with no hunks and the REAL counts,
  // as `emptyPatch` in `vcs/patch.ts@843a6c51` is read to produce. The counts are INVENTED: 1200
  // added lines, so the row has something to say.
  if (tooLarge) {
    return { patch: [...header, ''].join('\n'), additions: 1200, deletions: 0 };
  }
  const spans = [];
  if (context === undefined) {
    if (ops.length > 0) spans.push({ from: 0, to: ops.length });
  } else {
    ops.forEach((op, index) => {
      if (op[0] === ' ') return;
      const from = Math.max(0, index - context);
      const to = Math.min(ops.length, index + context + 1);
      const last = spans.at(-1);
      if (last !== undefined && from <= last.to) last.to = Math.max(last.to, to);
      else spans.push({ from, to });
    });
  }
  const body = spans.flatMap(({ from, to }) => {
    const slice = ops.slice(from, to);
    const oldBefore = ops.slice(0, from).filter((op) => op[0] !== '+').length;
    const newBefore = ops.slice(0, from).filter((op) => op[0] !== '-').length;
    const oldCount = slice.filter((op) => op[0] !== '+').length;
    const newCount = slice.filter((op) => op[0] !== '-').length;
    const oldStart = oldCount === 0 ? oldBefore : oldBefore + 1;
    const newStart = newCount === 0 ? newBefore : newBefore + 1;
    return [
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...slice.map((op) => `${op[0]}${op[1]}`),
    ];
  });
  return { patch: [...header, ...body, ''].join('\n'), additions, deletions };
}

/**
 * Plays the file changes of an `EDIT_FILES` turn: a `modified` `src/sample.ts` (`value2 = N`
 * becomes `value2 = N2`: 2 -> 22, 5 -> 52), an `added` `src/added.ts`, a `deleted` `src/removed.ts`
 * and an `added` binary `assets/logo.png`; when `text` (the prompt) contains `LARGE`, a fifth file,
 * `docs/big.txt`, `added` and `tooLarge` (its patch is cut, see {@link patchOf}). They are recorded for `GET .../diff` and returned as the `files` of the
 * `session.step.ended`. Only in `visual` mode do they also touch the served folder (the run's
 * temporary workspace, whose `src/sample.ts` is real and whose `src/removed.ts` the run created):
 * the right side of a diff is the real file, and the visual run looks at it. In any other mode
 * nothing is written and the "before" texts are constants. SYNTHETIC: the turn exists to give the
 * host something to list, not to imitate how a model edits.
 */
function applyEdits(sessionID, userID, directory, text = '') {
  const onDisk = has('visual') && directory !== '';
  const target = (file) => nodePath.join(directory, ...file.split('/'));
  const read = (file, fallback) => {
    if (!onDisk) return fallback;
    try {
      return fs.readFileSync(target(file), 'utf8');
    } catch {
      return fallback;
    }
  };
  const sample = read('src/sample.ts', SAMPLE_BEFORE);
  const removed = read('src/removed.ts', 'export const removed = true;\n');
  const added = 'export const added = true;\n';
  const edits = [
    {
      file: 'src/sample.ts',
      before: sample,
      // Appends a `2` to the number (2 -> 22, 5 -> 52): the issue #32 run writes its own value by
      // hand and needs to see the turn built on it.
      after: sample.replace(/value2 = (\d+);/, (_match, digits) => `value2 = ${digits}2;`),
    },
    { file: 'src/added.ts', before: undefined, after: added },
    { file: 'src/removed.ts', before: removed, after: undefined },
    { file: 'assets/logo.png', before: undefined, after: '', binary: true },
    // A prompt containing LARGE adds a file whose patch the "server" cut for size (issue #32).
    ...(text.includes('LARGE')
      ? [{ file: 'docs/big.txt', before: undefined, after: 'big\n', tooLarge: true }]
      : []),
  ].map((edit) => ({ userID, binary: false, tooLarge: false, ...edit }));
  if (onDisk) {
    writeOnDisk(
      directory,
      edits.map((edit) => ({ file: edit.file, text: edit.after, binary: edit.binary })),
    );
  }
  sessionEdits.set(sessionID, [...(sessionEdits.get(sessionID) ?? []), ...edits]);
  return edits.map((edit) => edit.file);
}

/**
 * Writes (or, for an `undefined` text, deletes) files of the served folder; only the `visual` mode
 * calls it. A binary becomes a PNG signature, enough for the editor to treat it as an image.
 */
function writeOnDisk(directory, items) {
  for (const item of items) {
    const where = nodePath.join(directory, ...item.file.split('/'));
    if (item.text === undefined) {
      fs.rmSync(where, { force: true });
      continue;
    }
    fs.mkdirSync(nodePath.dirname(where), { recursive: true });
    fs.writeFileSync(
      where,
      item.binary ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) : item.text,
    );
  }
}

/**
 * `GET /api/session/:id/diff?from=&to=&context=` (issue #31), SYNTHETIC but following the reading of
 * `core/src/session/diff.ts` @843a6c51: without `from` the turn of the LAST user message; `from` is
 * a user message whose turn is diffed and `to` a later one that extends the range; an id the
 * session does not hold is 404 `MessageNotFoundError` and a message that is not a user one is 400
 * `InvalidRequestError` (see `bad` below for what was observed). Several edits of one file in the
 * range collapse to the first "before" and the last "after" (a file added and removed again
 * vanishes). Without `context` the patches are the whole file; `context=0` keeps only the changes.
 * Answers `{data: FileDiffInfo[]}`, which the client unwraps.
 */
function sessionDiff(response, session, params) {
  const users = history
    .get(session.id)
    .filter((message) => message.type === 'user')
    .map((message) => message.id);
  const known = new Set(history.get(session.id).map((message) => message.id));
  // An id the session does not hold is `MessageNotFoundError` (VERIFIED: the case "reads user
  // messages and diffs a session that changed nothing" of `realOpencode.test.ts` sent an unknown
  // id and an admitted inbox id as `from` to a real opencode 2.0.32 on 23/10/2026 and got that
  // `_tag`; the HTTP status was not looked at, so the 404 here is INVENTED); a message that is not
  // a user one is `InvalidRequestError` (READ in `diff.ts`, never provoked).
  const bad = (id) =>
    known.has(id)
      ? json(response, 400, {
          _tag: 'InvalidRequestError',
          message: `Not a user message of this session: ${id}`,
          kind: 'turn_range',
        })
      : json(response, 404, {
          _tag: 'MessageNotFoundError',
          message: `Message not found: ${id}`,
          sessionID: session.id,
          messageID: id,
        });
  const from = params.get('from');
  const to = params.get('to');
  if (from !== null && !users.includes(from)) return bad(from);
  if (to !== null && (!users.includes(to) || users.indexOf(to) < users.indexOf(from ?? to))) {
    return bad(to);
  }
  const first = from === null ? users.length - 1 : users.indexOf(from);
  const last = to === null ? first : users.indexOf(to);
  const turns = new Set(users.slice(Math.max(first, 0), last + 1));
  const merged = new Map();
  for (const edit of sessionEdits.get(session.id) ?? []) {
    if (!turns.has(edit.userID)) continue;
    const known = merged.get(edit.file);
    merged.set(edit.file, known === undefined ? { ...edit } : { ...known, after: edit.after });
  }
  const contextText = params.get('context');
  const context = contextText === null ? undefined : Number(contextText);
  const data = [...merged.values()].flatMap((edit) => {
    const status =
      edit.before === undefined
        ? edit.after === undefined
          ? undefined
          : 'added'
        : edit.after === undefined
          ? 'deleted'
          : 'modified';
    if (status === undefined) return [];
    return [
      {
        file: edit.file,
        status,
        ...patchOf(
          edit.file,
          status,
          edit.before,
          edit.after,
          edit.binary,
          context,
          edit.tooLarge === true,
        ),
      },
    ];
  });
  json(response, 200, { data });
}

// ---------------------------------------------------------------------------------------------
// E7-message-revert (issue #32): `POST /api/session/:id/revert/stage`, `DELETE .../revert` and
// `POST .../revert/commit`, plus `GET .../message/:mid`. SYNTHETIC but following the READING of
// `core/src/session/revert.ts`, `session.ts` and `projector.ts` @843a6c51 (see `opencodeClient.ts`
// for what each route does) and, for the ids, the errors and the three events, the spike against a
// real opencode 2.0.32 on a `shell` message (Windows 11, 23/10/2026).
// ---------------------------------------------------------------------------------------------

/** session id -> the moves a staged revert made on disk: [{ file, current, restored, binary }]. */
const revertSaved = new Map();

/** The error body of a session that is running: stage, clear and commit all refuse it. */
function busyError(response, session) {
  json(response, 409, {
    _tag: 'SessionBusyError',
    message: `Session is busy: ${session.id}`,
    sessionID: session.id,
  });
}

/** Puts back on disk the state the files had BEFORE the staged revert (the "current" side). */
function undoRevertOnDisk(session) {
  const moves = revertSaved.get(session.id) ?? [];
  const directory = session.location?.directory ?? '';
  if (has('visual') && directory !== '') {
    writeOnDisk(
      directory,
      moves.map((move) => ({ file: move.file, text: move.current, binary: move.binary })),
    );
  }
}

/**
 * `POST /api/session/:id/revert/stage` `{ messageID, files? }`: refuses a running session (409
 * `SessionBusyError`) and an unknown message (404 `MessageNotFoundError`, the `_tag` the real
 * server answered to an invented id). Staging again first puts the files back as they were before
 * the earlier revert (the real server reuses the first `original`). The files the revert changes
 * are those the recorded edits of the turns FROM the boundary on touched, collapsed per file like
 * the diff route; `files: false` leaves the disk alone and answers no files. The answer and the
 * `session.revert.staged` event carry `{ messageID, files }` where each file is the diff from the
 * disk before the revert to the disk after it (complete-file patch), so `added` = the revert
 * recreates it and `deleted` = the revert removes it. In `visual` mode the served folder really
 * changes. INVENTED: the order of the files and the counts of the large file.
 */
function stageRevert(response, session, body) {
  if (running.has(session.id)) return busyError(response, session);
  const messages = history.get(session.id) ?? [];
  const at = messages.findIndex((message) => message.id === body.messageID);
  if (at < 0) {
    json(response, 404, {
      _tag: 'MessageNotFoundError',
      message: `Message not found: ${String(body.messageID)}`,
      sessionID: session.id,
      messageID: body.messageID,
    });
    return;
  }
  if (session.revert !== undefined) undoRevertOnDisk(session);
  const turns = new Set(
    messages
      .slice(at)
      .filter((message) => message.type === 'user')
      .map((message) => message.id),
  );
  const merged = new Map();
  for (const edit of sessionEdits.get(session.id) ?? []) {
    if (!turns.has(edit.userID)) continue;
    const known = merged.get(edit.file);
    merged.set(edit.file, known === undefined ? { ...edit } : { ...known, after: edit.after });
  }
  const withFiles = body.files !== false;
  const moves = withFiles
    ? [...merged.values()].map((edit) => ({
        file: edit.file,
        current: edit.after,
        restored: edit.before,
        binary: edit.binary,
        tooLarge: edit.tooLarge === true,
      }))
    : [];
  const directory = session.location?.directory ?? '';
  if (has('visual') && directory !== '') {
    writeOnDisk(
      directory,
      moves.map((move) => ({ file: move.file, text: move.restored, binary: move.binary })),
    );
  }
  revertSaved.set(session.id, moves);
  const files = moves.flatMap((move) => {
    const status =
      move.current === undefined
        ? move.restored === undefined
          ? undefined
          : 'added'
        : move.restored === undefined
          ? 'deleted'
          : 'modified';
    if (status === undefined) return [];
    return [
      {
        file: move.file,
        status,
        ...patchOf(
          move.file,
          status,
          move.current,
          move.restored,
          move.binary,
          undefined,
          move.tooLarge,
        ),
      },
    ];
  });
  session.revert = { messageID: body.messageID, files };
  session.time.updated = Date.now();
  json(response, 200, { data: session.revert });
  broadcast('session.revert.staged', { sessionID: session.id, revert: session.revert });
  scheduleSave();
}

/**
 * `DELETE /api/session/:id/revert`: with no staged revert it is a 204 and NO event (observed in the
 * spike against a real opencode 2.0.32, Windows 11, 23/10/2026: a `clear` after a `commit` emitted
 * no `session.revert.*`). Otherwise it puts the files back as they were before the revert, drops
 * the revert and publishes `session.revert.cleared`. The real server also wakes the session
 * afterwards (a stage right after can be `SessionBusyError`); this fake does not.
 */
function clearRevert(response, session) {
  if (session.revert === undefined) return noContent(response);
  if (running.has(session.id)) return busyError(response, session);
  undoRevertOnDisk(session);
  revertSaved.delete(session.id);
  delete session.revert;
  noContent(response);
  broadcast('session.revert.cleared', { sessionID: session.id });
  scheduleSave();
}

/**
 * Deletes the history from the boundary on (the boundary message included) and the recorded edits
 * of the deleted user messages, drops the revert and publishes `session.revert.committed {to}`.
 * It touches no file, like the real projector. Returns false when no revert is staged.
 */
function commitStaged(session) {
  if (session.revert === undefined) return false;
  const messages = history.get(session.id) ?? [];
  const at = messages.findIndex((message) => message.id === session.revert.messageID);
  const removed = at < 0 ? [] : messages.splice(at);
  const gone = new Set(removed.map((message) => message.id));
  sessionEdits.set(
    session.id,
    (sessionEdits.get(session.id) ?? []).filter((edit) => !gone.has(edit.userID)),
  );
  const to = session.revert.messageID;
  revertSaved.delete(session.id);
  delete session.revert;
  broadcast('session.revert.committed', { sessionID: session.id, to });
  scheduleSave();
  return true;
}

/** `POST /api/session/:id/revert/commit`: 204; with no staged revert nothing happens, no event. */
function commitRevert(response, session) {
  if (session.revert !== undefined && running.has(session.id)) return busyError(response, session);
  commitStaged(session);
  noContent(response);
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
 * The entries are {@link FIND_ENTRIES}, or, in `visual` mode, what {@link walkFolder} finds under
 * `directory` (the folder the request names in `x-opencode-directory`).
 */
function findFiles(params, directory) {
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
  const entries = has('visual') ? walkFolder(directory) : FIND_ENTRIES;
  return entries
    .filter((entry) => (type === null || entry.type === type) && matches(entry.path.toLowerCase()))
    .slice(0, limit);
}

/**
 * The files and folders under `root` as `{path, type}` entries, for the `visual` mode of
 * `GET /api/fs/find`: depth first, names sorted, `node_modules` and everything whose name starts
 * with a dot skipped, files with `/` separators and a folder with a trailing `\` (the mixed
 * separators the planner spike saw on Windows, see {@link FIND_ENTRIES}). It reads the disk on
 * every call, so a file written a moment ago is found at once (the real server refreshes its index
 * every 10 s: INVENTED difference, it makes the visual run faster, not different). At most 2000
 * entries.
 */
function walkFolder(root) {
  const found = [];
  const walk = (relative) => {
    let names;
    try {
      names = fs.readdirSync(nodePath.join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }
    names.sort((x, y) => (x.name < y.name ? -1 : 1));
    for (const entry of names) {
      if (found.length >= 2000) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const shown = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        found.push({ path: `${shown}\\`, type: 'directory' });
        walk(shown);
      } else {
        found.push({ path: shown, type: 'file' });
      }
    }
  };
  walk('');
  return found;
}

/**
 * The `files` of a prompt body as the server stores them (VERIFIED by the planner spike with
 * `resume: false`) for a `file:` URL: `source.uri` keeps the URL as sent (query included), `name`
 * and `mention` are kept as sent. A `data:` URL is stored with `source: { type: 'inline' }` and no
 * `uri` (read in `materializeAttachment`, `prompt.ts@v2.0.32`; not run here). `data` is empty (a
 * real server holds the file's base64). INVENTED: the fixture never reads the file; the `mime` of
 * a `data:` URL is the one in its header (the real server detects it from the bytes) and any other
 * URL says `text/plain`.
 */
function toWireFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.map((file) => ({
    data: '',
    // A `data:` URL is stored `inline` (read in `materializeAttachment`, `prompt.ts@v2.0.32`). INVENTED
    // here: the mime comes from the URL header, while the real server detects it from the bytes.
    mime: /^data:([^;,]+)/.exec(file.uri)?.[1] ?? 'text/plain',
    source: file.uri.startsWith('data:') ? { type: 'inline' } : { type: 'uri', uri: file.uri },
    ...(file.name === undefined ? {} : { name: file.name }),
    ...(file.mention === undefined ? {} : { mention: file.mention }),
  }));
}

/**
 * The two built-in commands `GET /api/command` lists, with the descriptions of the source at the tag
 * v2.0.32 (`core/src/command.ts`, read 28/10/2026). The TEMPLATES are INVENTED (the real ones are
 * long prompts); only their being a template that becomes the user message is copied.
 */
const BUILTIN_COMMANDS = [
  {
    name: 'init',
    description: 'guided AGENTS.md setup',
    template: 'Create or update the AGENTS.md of this project.',
  },
  {
    name: 'review',
    description: 'review changes [commit|branch|pr], defaults to uncommitted',
    template: 'Review the changes.',
  },
];

/**
 * The commands of the folder `directory`: the built-ins plus every `*.md` under
 * `<directory>/.opencode/command` and `<directory>/.opencode/commands` (E8-slash-commands, issue
 * #33). The name is the path relative to that folder without `.md`, always with `/` (upstream
 * replaces `\` the same way, read in `config/plugin/command.ts@843a6c51`); `description` comes from
 * the frontmatter, the rest of the file is the template. A file with the name of a built-in
 * replaces it (HYPOTHESIS: read, not run). Read from disk on every call, so a file written a moment
 * ago is listed at once. INVENTED: the real server watches the folders and publishes
 * `command.updated`; this fake does NOT, so a test that adds a file reloads the catalog itself.
 * The frontmatter parser takes only `description:` and tolerates CRLF, which a `.md` written on
 * Windows has. SYNTHETIC: the real parser reads YAML and more keys (`agent`, `model`, `subagent`).
 *
 * @returns {Array<{ name: string, description?: string, template: string }>}
 */
function commandsOf(directory) {
  const found = new Map(BUILTIN_COMMANDS.map((command) => [command.name, command]));
  for (const folder of ['command', 'commands']) {
    const root = nodePath.join(directory, '.opencode', folder);
    const walk = (relative) => {
      let entries;
      try {
        entries = fs.readdirSync(nodePath.join(root, relative), { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((x, y) => (x.name < y.name ? -1 : 1));
      for (const entry of entries) {
        const shown = relative === '' ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) walk(shown);
        else if (entry.name.endsWith('.md')) {
          let text;
          try {
            text = fs.readFileSync(nodePath.join(root, shown), 'utf8').replace(/\r\n/g, '\n');
          } catch {
            continue;
          }
          const parts = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
          const description = /^description:[ \t]*(.*)$/m.exec(parts?.[1] ?? '')?.[1]?.trim();
          const name = shown.slice(0, -'.md'.length);
          found.set(name, {
            name,
            ...(description === undefined || description === '' ? {} : { description }),
            template: (parts === null ? text : parts[2]).trim(),
          });
        }
      }
    };
    walk('');
  }
  return [...found.values()];
}

/**
 * The text a command turns into: `$ARGUMENTS` becomes all the arguments and `$1..$N` the
 * whitespace-separated ones; a template with neither gets the arguments appended after a blank
 * line (upstream does the same, read in `config/plugin/command.ts@843a6c51`; the exact separator is
 * INVENTED). An empty argument list leaves the template as it is.
 */
function expandTemplate(template, args) {
  const words = args.split(/\s+/).filter((word) => word !== '');
  const marked = /\$ARGUMENTS|\$\d+/.test(template);
  if (!marked) return args === '' ? template : `${template}\n\n${args}`;
  return template
    .replace(/\$ARGUMENTS/g, args)
    .replace(/\$(\d+)/g, (_, index) => words[Number(index) - 1] ?? '');
}

/**
 * Imitates `POST /api/session/:id/command` (E8-slash-commands, issue #33): 204 with no body, then
 * the same turn a prompt plays, with the expanded template as the user message. A name the folder
 * does not list answers 404 `CommandNotFoundError { command, message }`; a template that contains
 * `FAIL_COMMAND` answers 500 `CommandExecutionError` and plays nothing (INVENTED trigger, to test the
 * error path; the tags and statuses are READ in `protocol/src/errors.ts@843a6c51`, not seen).
 * Like a prompt, it commits a staged revert first (UNVERIFIED for a command: a command ends in
 * `session.prompt`, so it should).
 */
function runCommand(response, session, body, directory) {
  const name = typeof body.name === 'string' ? body.name : '';
  const command = commandsOf(directory).find((candidate) => candidate.name === name);
  if (command === undefined) {
    json(response, 404, {
      _tag: 'CommandNotFoundError',
      command: name,
      message: `Command not found: ${name}`,
    });
    return;
  }
  if (command.template.includes('FAIL_COMMAND')) {
    json(response, 500, {
      _tag: 'CommandExecutionError',
      command: name,
      message: `Command failed: ${name}`,
    });
    return;
  }
  commitStaged(session);
  const inboxID = nextId('msg');
  running.add(session.id);
  noContent(response);
  playTurn(
    session.id,
    inboxID,
    expandTemplate(command.template, typeof body.text === 'string' ? body.text : ''),
    toWireFiles(body.files),
  );
}

/** OAuth attempts in progress, by id; an attempt leaves the map on cancel (then `status` is 404). */
const oauthAttempts = new Map();
/** The code `complete` accepts for the `code` mode (SYNTHETIC). */
const FAKE_OAUTH_CODE = 'FAKE-CODE';

/**
 * Connects an integration: adds a credential to its connections and publishes the events in the
 * order the planner's spike saw them for `connect/key` (opencode 2.0.32, Windows 11, 01/11/2026):
 * `credential.updated`, `provider.updated`, `model.updated`, `credential.switched` and
 * `integration.updated`. The `data` of each is SYNTHETIC except `credential.switched`
 * (`{integrationID, credentialID}`, seen in the spike). The fake NEVER logs or stores a key.
 */
function connectIntegration(row, method) {
  const credentialID = nextId('cred_fake');
  row.connections.push({ type: 'credential', id: credentialID, label: 'default', method });
  broadcast('credential.updated', { integrationID: row.id, credentialID });
  broadcast('provider.updated', { integrationID: row.id });
  broadcast('model.updated', {});
  broadcast('credential.switched', { integrationID: row.id, credentialID });
  broadcast('integration.updated', { integrationID: row.id });
}

/**
 * Issue #128, phase 2: the AUTH routes of the settings tab. `POST /api/integration/:id/connect/key`
 * and `/connect/external` answer 204 (the key is read and dropped; an EMPTY key is accepted, like
 * the real server), `/connect/oauth` starts an attempt (`auto` with a link to this fake's own
 * approval page, or `code` for the method id `code`), `GET /connect/oauth/:attempt` is its status,
 * `POST …/complete` finishes a `code` attempt with `FAKE-CODE` (an `auto` one answers 500, as the
 * spike saw) and `DELETE …/:attempt` cancels it (afterwards `status` is 404). `DELETE
 * /api/credential/:id` removes a credential. An unknown integration is 404
 * `IntegrationNotFoundError`; an unknown attempt, `IntegrationAttemptNotFoundError`; a missing
 * required form field is 400 `InvalidRequestError`. Status codes and `_tag`s follow the spike; the
 * bodies' other fields are SYNTHETIC. Returns false when the request is not one of these routes.
 */
function handleIntegrationWrites(request, response, location) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const method = request.method;
  const credential = /^\/api\/credential\/([^/]+)$/.exec(url.pathname);
  if (method === 'DELETE' && credential !== null) {
    const id = decodeURIComponent(credential[1] ?? '');
    const row = integrationRows.find((candidate) =>
      candidate.connections.some((c) => c.type === 'credential' && c.id === id),
    );
    if (row === undefined) {
      json(response, 404, {
        _tag: 'CredentialNotFoundError',
        message: `Credential ${id} not found`,
      });
      return true;
    }
    row.connections = row.connections.filter((c) => !(c.type === 'credential' && c.id === id));
    noContent(response);
    broadcast('credential.updated', { integrationID: row.id, credentialID: id });
    broadcast('integration.updated', { integrationID: row.id });
    return true;
  }
  const route =
    /^\/api\/integration\/([^/]+)\/connect\/(key|external|oauth)(?:\/([^/]+)(\/complete)?)?$/.exec(
      url.pathname,
    );
  if (route === null) return false;
  const integrationID = decodeURIComponent(route[1] ?? '');
  const kind = route[2];
  const attemptID = route[3] === undefined ? undefined : decodeURIComponent(route[3]);
  const isComplete = route[4] !== undefined;
  const row = integrationRows.find((candidate) => candidate.id === integrationID);
  if (row === undefined) {
    json(response, 404, {
      _tag: 'IntegrationNotFoundError',
      message: `Integration ${integrationID} not found`,
    });
    return true;
  }
  if (kind === 'key' && method === 'POST' && attemptID === undefined) {
    readBody(request).then(() => {
      noContent(response);
      connectIntegration(row, 'key');
    });
    return true;
  }
  if (kind === 'external' && method === 'POST' && attemptID === undefined) {
    readBody(request).then(() => {
      noContent(response);
      connectIntegration(row, 'external');
    });
    return true;
  }
  if (kind !== 'oauth') return false;
  if (method === 'POST' && attemptID === undefined) {
    readBody(request).then((body) => {
      const methodID = typeof body.methodID === 'string' ? body.methodID : '';
      const oauth = row.methods.find((m) => m.type === 'oauth' && m.id === methodID);
      if (oauth === undefined) {
        json(response, 400, {
          _tag: 'InvalidRequestError',
          message: `Unknown method: ${methodID}`,
        });
        return;
      }
      const answer = typeof body.answer === 'object' && body.answer !== null ? body.answer : {};
      const form = oauth.form ?? [];
      const values = new Map(Object.entries(answer));
      for (const f of form) {
        const active = (f.when ?? []).every((rule) =>
          rule.op === 'eq'
            ? values.get(rule.key) === rule.value
            : values.get(rule.key) !== rule.value,
        );
        if (active && f.required === true && !values.has(f.key)) {
          json(response, 400, {
            _tag: 'InvalidRequestError',
            message: `Missing required form field: ${f.key}`,
          });
          return;
        }
      }
      const id = nextId('att');
      const mode = methodID === 'code' ? 'code' : 'auto';
      const now = Date.now();
      oauthAttempts.set(id, { integrationID, mode, approved: false, done: false });
      json(response, 200, {
        location,
        data: {
          attemptID: id,
          url:
            mode === 'code'
              ? 'https://fake.example.test/code'
              : `http://${request.headers.host ?? '127.0.0.1'}/fake-oauth/approve?attempt=${id}`,
          instructions:
            mode === 'code' ? 'Paste the code shown on the page' : 'Enter code: ABCD-1234',
          mode,
          time: { created: now, expires: now + 600_000 },
        },
      });
    });
    return true;
  }
  const attempt = attemptID === undefined ? undefined : oauthAttempts.get(attemptID);
  if (attemptID === undefined || attempt === undefined || attempt.integrationID !== integrationID) {
    json(response, 404, {
      _tag: 'IntegrationAttemptNotFoundError',
      message: `Attempt ${attemptID ?? ''} not found`,
    });
    return true;
  }
  if (method === 'GET' && !isComplete) {
    const now = Date.now();
    json(response, 200, {
      location,
      data: {
        status: attempt.approved ? 'complete' : 'pending',
        time: { created: now, expires: now + 600_000 },
      },
    });
    return true;
  }
  if (method === 'POST' && isComplete) {
    readBody(request).then((body) => {
      if (attempt.mode !== 'code') {
        json(response, 500, { _tag: 'UnknownError', message: 'Internal error' });
      } else if (body.code !== FAKE_OAUTH_CODE) {
        json(response, 400, { _tag: 'InvalidRequestError', message: 'Invalid code' });
      } else {
        attempt.approved = true;
        noContent(response);
        if (!attempt.done) {
          attempt.done = true;
          connectIntegration(row, 'oauth');
        }
      }
    });
    return true;
  }
  if (method === 'DELETE' && !isComplete) {
    oauthAttempts.delete(attemptID);
    noContent(response);
    return true;
  }
  return false;
}

/**
 * `GET /fake-oauth/approve?attempt=<id>`: the page an `auto` attempt's link points to. It stands for
 * the provider's consent page and needs no auth (a browser opens it). Approving completes the
 * attempt once (the credential and its events); an unknown or cancelled one is 404. EXCEPTION: for
 * `github-copilot` the page only shows a text and approves nothing, so the attempt stays pending
 * (INVENTED, `test:visual` step 36 needs to see "waiting").
 */
function handleFakeOauthApprove(request, response) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const id = url.searchParams.get('attempt') ?? '';
  const attempt = oauthAttempts.get(id);
  const row =
    attempt === undefined ? undefined : integrationRows.find((r) => r.id === attempt.integrationID);
  if (attempt === undefined || row === undefined) {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('Unknown or cancelled attempt');
    return;
  }
  if (row.id === 'github-copilot') {
    // INVENTED (E10-config-views, `test:visual` step 36): the device-code page of GitHub Copilot
    // waits for a human to type the code, so the fake's stand-in browser does NOT approve it and
    // the attempt stays pending until it is cancelled. Real device flows complete by polling, not
    // by loading this page (HYPOTHESIS, read in upstream `packages/core/src/plugin/provider/
    // github-copilot.ts` L151-154, commit 843a6c5; never run against the real service). No
    // integration case approves a Copilot attempt.
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      '<!doctype html><title>Device code</title><p>Enter the code shown in OpenCode.</p>',
    );
    return;
  }
  attempt.approved = true;
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(
    '<!doctype html><title>Approved</title><p>Sign-in approved. You can close this tab.</p>',
  );
  if (!attempt.done) {
    attempt.done = true;
    connectIntegration(row, 'oauth');
  }
}

/**
 * Answers the chat routes (and, issue #128, the read routes `GET /api/integration[/:id]`, `GET
 * /api/mcp` and `GET /api/mcp/resource`); returns false when the request is not one of them.
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
        // No `variant`: the real `session.created` of 2.0.32 has none (test:event-shapes, 23/10/2026);
        // the REST row above keeps it.
        ...(info.model === undefined
          ? {}
          : { model: { id: info.model.id, providerID: info.model.providerID } }),
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
  if (method === 'GET' && path === '/api/integration') {
    json(response, 200, { location, data: integrationRows });
    return true;
  }
  const integrationPath = /^\/api\/integration\/([^/]+)$/.exec(path);
  if (method === 'GET' && integrationPath !== null) {
    const id = decodeURIComponent(integrationPath[1] ?? '');
    const row = integrationRows.find((candidate) => candidate.id === id);
    if (row === undefined) {
      // SYNTHETIC body: the tag `IntegrationNotFoundError` was seen in the spike, the fields were not.
      json(response, 404, {
        _tag: 'IntegrationNotFoundError',
        message: `Integration ${id} not found`,
      });
    } else {
      json(response, 200, { location, data: row });
    }
    return true;
  }
  if (handleIntegrationWrites(request, response, location)) return true;
  if (method === 'GET' && path === '/api/mcp') {
    json(response, 200, { location, data: mcpServers });
    return true;
  }
  if (method === 'GET' && path === '/api/mcp/resource') {
    json(response, 200, { location, data: { resources: mcpResources, templates: mcpTemplates } });
    return true;
  }
  if (method === 'GET' && path === '/api/agent') {
    json(response, 200, { location, data: CATALOG_AGENTS });
    return true;
  }
  if (method === 'GET' && path === '/api/command') {
    json(response, 200, {
      location,
      data: commandsOf(location.directory).map(({ name, description }) => ({
        name,
        ...(description === undefined ? {} : { description }),
      })),
    });
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
    json(response, 200, { location, data: findFiles(url.searchParams, location.directory) });
    return true;
  }
  const act = /^\/api\/session\/([^/]+)\/(permission|form)\/([^/]+)(?:\/(reply))?$/.exec(path);
  if (act !== null) return handleAnswer(request, response, act);
  const match =
    /^\/api\/session\/([^/]+)(?:\/(message\/[^/]+|message|permission|form|prompt|command|interrupt|compact|fork|model|agent|diff|revert\/stage|revert\/commit|revert))?$/.exec(
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
    // Issue #31: `type`, `order` and `limit` of `message.list` (types of 2.0.32, read), so the host
    // can ask for the first and the last user message. Newest first by default, as before.
    const type = url.searchParams.get('type');
    const limit = Number(url.searchParams.get('limit') ?? '');
    let listed = history
      .get(session.id)
      .filter((message) => type === null || message.type === type);
    if (url.searchParams.get('order') !== 'asc') listed = [...listed].reverse();
    if (Number.isInteger(limit) && limit > 0) listed = listed.slice(0, limit);
    json(response, 200, { data: listed, cursor: {} });
    return true;
  }
  if (method === 'GET' && sub === 'diff') {
    sessionDiff(response, session, url.searchParams);
    return true;
  }
  if (method === 'GET' && sub?.startsWith('message/')) {
    // Issue #32: one message, so the host can check it is a user one. Unknown id: the 404 the
    // real `stage` answered to an invented one (observed 23/10/2026; the route itself is READ).
    const messageID = decodeURIComponent(sub.slice('message/'.length));
    const found = history.get(session.id).find((message) => message.id === messageID);
    if (found === undefined) {
      json(response, 404, {
        _tag: 'MessageNotFoundError',
        message: `Message not found: ${messageID}`,
        sessionID: session.id,
        messageID,
      });
    } else {
      json(response, 200, { data: found });
    }
    return true;
  }
  if (method === 'POST' && sub === 'revert/stage') {
    readBody(request).then((body) => stageRevert(response, session, body));
    return true;
  }
  if (method === 'DELETE' && sub === 'revert') {
    clearRevert(response, session);
    return true;
  }
  if (method === 'POST' && sub === 'revert/commit') {
    commitRevert(response, session);
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
  if (method === 'POST' && sub === 'compact') {
    // Issue #125. The item comes wrapped in `{ data }` (read in the tag's `solid-compaction.test.ts`),
    // like the prompt's; the compaction plays after the answer.
    readBody(request).then((body) => {
      const inboxID = nextId('msg');
      running.add(session.id);
      json(response, 200, {
        data: {
          id: inboxID,
          sessionID: session.id,
          time: { created: Date.now() },
          type: 'compaction',
          payload: {},
          delivery: body.delivery ?? 'steer',
        },
      });
      playCompaction(session.id, inboxID);
    });
    return true;
  }
  if (method === 'POST' && sub === 'command') {
    readBody(request).then((body) => runCommand(response, session, body, location.directory));
    return true;
  }
  if (method === 'POST' && sub === 'prompt') {
    readBody(request).then((body) => {
      // A prompt with a revert staged commits it first, like `session.ts@843a6c51` L164-165 (READ).
      commitStaged(session);
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

/**
 * Longest a `--version` waits for the `<FAKE_OPENCODE_STATE_FILE>.slow-version` marker to go away,
 * in ms. Chosen under the extension's own `VERSION_TIMEOUT_MS` (10 000 in `opencodeBinary.ts`) with
 * room for the process start, so the detection never reports `run-failed` because of the marker.
 */
const SLOW_VERSION_CAP_MS = 8_000;

/**
 * Prints the version, but first waits (polling every 100 ms, at most {@link SLOW_VERSION_CAP_MS})
 * while the `.slow-version` marker exists next to the state file (issue #86: `test:visual` step 0
 * keeps the detection busy long enough to measure the "Checking…" state). Without a state file or
 * without the marker it answers at once. After the cap it answers anyway, so a marker left behind
 * delays the detection by 8 s and never breaks it.
 * VERIFIED on Windows 11, VS Code 1.144.0 (28/10/2026), full `npm run test:visual`: "ok   after
 * choosing a path, step 1 says Checking… while the detection runs" (the extension host's
 * `--version` child saw the marker, so it inherits `FAKE_OPENCODE_STATE_FILE`).
 */
function printVersionWhenNotSlow() {
  const marker = `${STATE_FILE}.slow-version`;
  const started = Date.now();
  const tick = () => {
    if (STATE_FILE !== '' && fs.existsSync(marker) && Date.now() - started < SLOW_VERSION_CAP_MS) {
      setTimeout(tick, 100);
      return;
    }
    process.stdout.write(`opencode v${version}\n`, () => process.exit(0));
  };
  tick();
}

if (args.includes('--version')) {
  printVersionWhenNotSlow();
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

  // The `.down` marker left by a CRASH turn makes every start behave like `exit-early` until the
  // test deletes it (E2, issue #85: an unavailable server WITH a conversation behind it).
  if (has('exit-early') || (STATE_FILE !== '' && fs.existsSync(DOWN_MARKER))) {
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
  if (STATE_FILE !== '') {
    loadState();
    // The last changes of a normal exit, past the 25 ms debounce. A folder that is already gone
    // (the visual run deletes its work dir while the server shuts down) is not an error here.
    process.on('exit', () => {
      try {
        saveState();
      } catch {
        // nothing left to save to
      }
    });
  }

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
    // The consent page of an OAuth attempt is opened by a browser, which has no Basic credentials.
    if (request.method === 'GET' && (request.url ?? '').startsWith('/fake-oauth/approve?')) {
      handleFakeOauthApprove(request, response);
      return;
    }
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
    // E10-config-views (issue #128): the MCP list stays empty for a moment, then fills.
    setTimeout(populateMcp, MCP_FILL_DELAY_MS).unref();
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
