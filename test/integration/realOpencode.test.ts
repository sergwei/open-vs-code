// Real opencode suite (opt-in, follow-up of issue #8): the CONTRACT between the extension and a
// REAL opencode v2, with NO model turn.
//
// Since tooling/tests-without-model this suite never sends a prompt, so it spends no quota and
// passes when the free model is exhausted, rate limited or offline. What it protects is everything
// that can break between the extension and a real server WITHOUT a model answering: the whole
// start path (binary detection -> server manager -> `opencode serve --stdio --port 0` -> `GET
// /api/info` -> version check) inside a real VS Code, the chat view reaching the event stream and
// loading the catalog, the file search, restart and crash recovery, the external-server
// connection and its 401, and, with a server of its own and the full client, the shapes of the
// read-only and lifecycle API (catalog, agents, providers, session create / rename / switch /
// list / get / fork / interrupt / remove, the first SSE frames, pending-request lists, saved
// permissions, file find). What it does NOT see is a TURN (text in parts, `session.step.*` with
// tokens, tools, permissions and forms raised by a model): that is the job of the opt-in
// `npm run test:event-shapes`, which compares a real turn with the synthetic one when a model
// answers, and of `npm run test:visual` / `fake-server`, which play turns on the synthetic server.
// The cases that used to send prompts here (stream a prompt to the end, model + agent, variant,
// interrupt, mention + prompt, selection + prompt, permission hidden / visible, question) have
// their twin in `fakeServer.test.ts`.
//
// Opt-in: it runs only when `OPEN_VS_CODE_REAL_OPENCODE` holds the absolute path to the opencode
// v2 executable, and `.vscode-test.mjs` then adds a configuration with a workspace folder (the
// manager only starts a server when a folder is open). Without the variable the suite skips.
// How to run (from a terminal that is not inside the test VS Code):
//   OPEN_VS_CODE_REAL_OPENCODE=<path to opencode.exe> npm run test:integration
// To run only this suite: add `-- --label real-opencode`.
//
// Issue #41: the cases that did not need the real server (`editor.open`, the whole-file, several
// selections, dirty-buffer and OutsideWorkspace editor-context cases) moved to `fakeServer.test.ts`,
// which runs the synthetic opencode in CI. Helpers shared by both live in `support/serverCases.ts`.
//
// Restart and crash recovery (issue #10) were observed against a real opencode 2.0.32 in VS Code
// 1.142.0 on Windows 11 on 20/10/2026: new pid, stream reconnected, old pid gone; a killed server
// restarts after 1 s. External server case (issue #11): observed on Windows 11 with VS Code 1.143.0
// and opencode 2.0.32 on 22/10/2026; the real server accepted the Basic credential (the extension
// logged "connected to the external server at ... (opencode 2.0.32)") and answered a wrong
// password with HTTP 401 ("GET /api/info failed: HTTP 401", "server not available
// (unauthorized)"); the turn it used to run through that server is gone. Not observed against a
// real opencode: a refused connection and a timeout.
//
// Out of scope: the STOP. Nothing public in the extension stops the server before the window
// closes (`deactivate` does it), and a test cannot observe its own host shutting down. The test
// prints the pid so whoever runs it can check afterwards that the process is gone (Windows:
// `tasklist /FI "PID eq <pid>"`; POSIX: `kill -0 <pid>`). The stop is VERIFIED separately under
// plain Node (spike of 2026-10-20) but NOT through `deactivate` in VS Code.
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { OpenCode, type OpenCodeClient } from '@opencode/client';
import * as vscode from 'vscode';
import {
  CLEAR_SERVER_PASSWORD_COMMAND_ID,
  CONFIG_SECTION,
  INJECT_WEBVIEW_MESSAGE_COMMAND_ID,
  OPENCODE_PATH_KEY,
  OPENCODE_PATH_SETTING,
  RESTART_SERVER_COMMAND_ID,
  SERVER_URL_KEY,
  TEST_SET_SERVER_PASSWORD_COMMAND_ID,
  VIEW_CONTAINER_ID,
} from '../../src/extension/ids';
import { buildServeEnv, PINNED_OPENCODE_VERSION } from '../../src/extension/opencodeServer';
import { diffRoot } from '../../src/extension/sessionDiff';
import {
  toAgentOptions,
  toCommandOption,
  toModelOption,
  toProviderOption,
  toSessionSummary,
} from '../../src/extension/wireMapping';
import { openLogCursor, openLogFromStart } from './support/extensionLog';
import {
  lastReadyPid,
  matchInLog,
  SAMPLE_TS,
  sleep,
  startOwnServer,
  waitUntilGone,
  type OwnServer,
} from './support/serverCases';

const EXTENSION_ID = 'sergwei.open-vs-code';
// Above STARTUP_TIMEOUT_MS (30 s) of the extension, so a start that really hangs fails with the
// extension's own error in the log, not with ours. A healthy start takes well under a second.
const READY_WAIT_MS = 35_000;

/** An event of the stream, as far as these cases read it. */
interface SeenEvent {
  type: string;
  data?: Record<string, unknown>;
}

/**
 * Subscribes to `GET /api/event` and collects every event, so a case can create the session after
 * the subscription and then wait for what the server published about it. `stop()` ends the stream.
 * The subscription is opened by the first `next()` of the iterator, so `ready()` waits for the
 * `server.connected` frame before the case acts.
 */
function watchEvents(client: OpenCodeClient): {
  events: SeenEvent[];
  ready(): Promise<void>;
  waitFor(
    match: (event: SeenEvent) => boolean,
    what: string,
    timeoutMs?: number,
  ): Promise<SeenEvent>;
  stop(): Promise<void>;
} {
  const abort = new AbortController();
  const events: SeenEvent[] = [];
  const pump = (async () => {
    try {
      for await (const event of client.event.subscribe({ signal: abort.signal })) {
        events.push(event);
      }
    } catch {
      // The abort in `stop()` ends the iteration; any other failure shows as a missing event.
    }
  })();
  const waitFor = async (
    match: (event: SeenEvent) => boolean,
    what: string,
    timeoutMs = 10_000,
  ): Promise<SeenEvent> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = events.find(match);
      if (found) return found;
      if (Date.now() >= deadline) {
        assert.fail(
          `${what} did not arrive within ${String(timeoutMs)} ms; saw: ${events.map((e) => e.type).join(', ')}`,
        );
      }
      await sleep(50);
    }
  };
  return {
    events,
    ready: async () => {
      await waitFor((event) => event.type === 'server.connected', 'server.connected', 15_000);
    },
    waitFor,
    stop: async () => {
      abort.abort();
      await pump;
    },
  };
}

describe('real opencode', function () {
  let binary: string;
  // Guards the cleanup in `after`: when the suite is skipped nothing was changed to undo.
  let changedSetting = false;

  before(function () {
    const fromEnv = process.env['OPEN_VS_CODE_REAL_OPENCODE'];
    if (fromEnv === undefined || fromEnv === '') {
      this.skip();
    }
    binary = fromEnv;
  });

  after(async () => {
    if (!changedSetting) return;
    // The server keeps running until the window closes (the manager does not restart or stop on
    // a settings change); only the profile's setting is restored.
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(OPENCODE_PATH_KEY, undefined, vscode.ConfigurationTarget.Global);
  });

  /**
   * With a workspace folder open and the setting pointing at the real binary, the extension
   * starts the server and reports it ready on a real port with the pinned version.
   *
   * The setting is written BEFORE `activate()`: detection runs on activation and the setting
   * wins over PATH. On the development machine the runner's PATH has an opencode whenever it is
   * launched from a shell that loads fnm, which it needs for `npm`: the persistent Windows PATH
   * has no fnm entry, but `fnm\aliases\default` holds `opencode.cmd` and `opencode2.cmd` next to
   * that `npm` (VERIFIED by listing both, Windows 11, 2026-10-20). Writing it afterwards would race a
   * PATH-detected server. The variable must point to the `.exe`, not to a shim: the setting
   * resolves a shim to the `.exe` and the log would then show another path. For that reason, and
   * because a restored view may have activated the extension earlier, the assertions do not
   * compare the binary path with the variable: they need `starting the server for <folder>` and
   * `binary detection: setting ...: ok`.
   * VERIFIED (first local run, Windows 11, VS Code 1.142.0, 2026-10-20): passes in ~1.2 s
   * against a real opencode 2.0.32 on a real port, and `binary detection: setting ...: ok` shows
   * that a `scope: machine` setting accepts `ConfigurationTarget.Global`.
   * UNVERIFIED: whether the server came from the setting or from a PATH binary detected before
   * the setting was written (the output does not say whether the extension was already active,
   * and the manager does not restart on a binary change, issue #10). POSIX UNVERIFIED.
   */
  it('starts the server and reports it ready', async function () {
    this.timeout(READY_WAIT_MS + 10_000);

    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(
      folder,
      'no workspace folder is open: run with the `real-opencode` configuration of .vscode-test.mjs',
    );

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);

    changedSetting = true;
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(OPENCODE_PATH_KEY, binary, vscode.ConfigurationTarget.Global);
    await extension.activate();

    // From the start of the file: the ready line may come before we start waiting.
    const log = await openLogFromStart();
    await log.waitFor('server ready at http://127.0.0.1:', READY_WAIT_MS);

    const text = log.added();
    assert.ok(
      text.includes(`starting the server for ${folder} with `),
      `the server was not started for ${folder}; log:\n${text}`,
    );
    assert.ok(
      /binary detection: setting .*: ok/.test(text),
      `${OPENCODE_PATH_SETTING}=${binary} was not detected as ok; log:\n${text}`,
    );
    const ready = /server ready at http:\/\/127\.0\.0\.1:(\d+) \(opencode (\S+), pid (\d+)\)/.exec(
      text,
    );
    assert.ok(ready, `ready line not in the expected shape; log:\n${text}`);
    const [, port, version, pid] = ready;
    assert.notStrictEqual(Number(port), 0, '--port 0 must resolve to the real port');
    assert.strictEqual(version, PINNED_OPENCODE_VERSION);
    assert.ok(!text.includes('printed port 0'), `plan B (port 0) triggered; log:\n${text}`);
    // The pid is for whoever runs the suite: check it is gone once the window has closed.
    console.log(`real opencode ready on port ${String(port)}, pid ${String(pid)}`);
  });

  /**
   * The chat view against a REAL server, with no prompt: the webview loads, the event stream
   * connects (first frame `server.connected`, read by the host) and the host loads the catalog
   * (`catalog loaded (<n> models, <m> agents, <k> commands)` with n >= 1 and m >= 1: the four
   * catalog GETs and their mapping worked on the real answers; since issue #33 the line also counts
   * the commands, `no` when `command.list` failed). The first wait accepts any count, `no`
   * included; a SECOND wait (issue #33) requires at least two commands, either in a `catalog loaded`
   * line or in `commands loaded after retry <n> (<k> commands)` after an empty first answer. This
   * folder has no project command, so the two are the built-ins `init` and `review`.
   *
   * VERIFIED for that second wait on Windows 11, opencode 2.0.32 (29/10/2026, the `real-opencode`
   * label, no prompt, 16 passing): the log of the run showed "catalog loaded (8 models, 0 agents, 0
   * commands)" followed by "catalog loaded (8 models, 2 agents, 2 commands)", so the commands
   * arrived in a load and the retry path was not needed in that run. NOT observed in this case: the
   * retry path against the real server (`commands loaded after retry` did not appear).
   *
   * VERIFIED on Windows 11, VS Code 1.143.0, opencode 2.0.32 (22/10/2026, the `real-opencode`
   * label, no prompt): the log of the run showed `webview ready`, `event stream connected` and three
   * `catalog loaded` lines, `(9 models, 0 agents)` first and `(9 models, 2 agents)` after, so the
   * catalog can be read once with an empty agent list right after the server starts. HYPOTHESIS:
   * the real server answers `agent.list` empty for a moment while it boots (or the first load
   * races a restore); not investigated. Whether the webview ever shows no agents because of it
   * was not observed.
   *
   * Replaces the first half of the case that used to send a prompt and wait for `turn finished`;
   * the rest of that case (the reply streamed to the end, the usage update) is covered by the
   * `fake-server` suite and, for shapes, by `npm run test:event-shapes`. The log is read from the
   * start of the file: the catalog may have loaded on activation, before the view opened.
   * Depends on the previous `it` (same window, server already running). Needs no network beyond
   * the server's own catalog and no model quota.
   */
  it('opens the chat: the stream connects and the catalog loads, with no prompt', async function () {
    this.timeout(READY_WAIT_MS + 30_000);
    const log = await openLogFromStart();
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    await log.waitFor('webview ready', 8_000);
    await log.waitFor('event stream connected', 10_000);
    // The host loads the catalog more than once on a start, and the FIRST line of the run that
    // recorded this case read `(9 models, 0 agents)` before `(9 models, 2 agents)` (see the header
    // of the case), so the wait is for a line that has both: it is the final state that matters.
    await matchInLog(
      log,
      /catalog loaded \([1-9]\d* models, [1-9]\d* agents, (?:no|\d+) commands\)/,
      15_000,
      'a catalog line with models and agents',
    );
    // Issue #33: the host's catalog must end with the built-ins (`init`, `review`), either in a
    // load or through the retry of an empty first answer. This folder has no project command.
    await matchInLog(
      log,
      /catalog loaded \(\d+ models, \d+ agents, [2-9]\d* commands\)|commands loaded after retry \d \([2-9]\d* commands\)/,
      15_000,
      'a catalog with at least the two built-in commands',
    );
    log.assertAbsent('prompt accepted');
  });

  /**
   * `@` mention search (issue #28) against a REAL opencode, no prompt: `files.search` reaches
   * `GET /api/fs/find`, the answer is mapped and the host logs `file search: N results` with N >= 1
   * for a file that exists in the served folder.
   *
   * Protects: the v2 route and its `{location, data}` answer (the issue text cites the v1
   * `/find/file`) and the `type: 'file'` and `limit` query. The search is retried for up to 25 s:
   * the real server refreshes its file index every 10 s (read in `search.ts@843a6c51`), so a file
   * written a moment ago may not be listed yet; 25 s and the 2 s pause are our own choices. Writes
   * `src/sample.ts` into the temporary workspace folder (the fake-server suite has its own file
   * with the same name in its fixed workspace folder). The part that sent a prompt mentioning the
   * file is gone (it needed a model); the real server taking `files[].mention` is left to the
   * event-shape check.
   */
  it('finds a file with files.search (no prompt)', async function () {
    this.timeout(READY_WAIT_MS);
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(folder, 'no workspace folder is open');
    const file = path.join(folder, 'src', 'sample.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SAMPLE_TS);

    const log = await openLogCursor();
    const deadline = Date.now() + 25_000;
    let attempt = 0;
    while (!/file search: [1-9]\d* results/.test(log.added()) && Date.now() < deadline) {
      attempt += 1;
      await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
        type: 'files.search',
        requestId: `integration-find-${String(attempt)}`,
        query: 'sample',
      });
      await sleep(2_000);
    }
    assert.ok(
      /file search: [1-9]\d* results/.test(log.added()),
      `no search returned a result for "sample" in ${String(attempt)} attempts; log:\n${log.added()}`,
    );
    log.assertAbsent('prompt accepted');
  });

  /**
   * The API contract against a REAL server of the test's own (`startOwnServer`), through the
   * full promise client and with NO prompt: nothing here reaches a model. Each case reads the
   * answer the way the host does (`wireMapping` for the catalog and the session rows), so a
   * change of shape in a release shows up as a failure with the field named.
   *
   * What the plan of tooling/tests-without-model took from the spikes of the planner against
   * opencode 2.0.32 (Windows 11, 20-22/10/2026) and from `references/endpoints-v2.md`; the cases
   * were then run against the real server, and the header of each says what that run showed.
   * A server of its own, not the extension's: the extension's would be touched by the restart
   * cases and by `session.remove`.
   * Every VERIFIED below is the passing case of `npm run test:integration -- --label
   * real-opencode` on Windows 11 with opencode 2.0.32 (23/10/2026, final tree of
   * tooling/tests-without-model), the case title as the line that backs it; macOS and Linux are
   * UNVERIFIED.
   */
  describe('API contract (own server, no prompt)', function () {
    let own: OwnServer;
    let folder: string;

    before(async function () {
      this.timeout(READY_WAIT_MS + 5_000);
      const first = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      assert.ok(first, 'no workspace folder is open');
      folder = first;
      own = await startOwnServer(binary, folder, 'contract-pw');
    });

    after(async () => {
      // `own` is unassigned when the `before` hook failed.
      await (own as OwnServer | undefined)?.stop();
    });

    /**
     * `GET /api/info` (what the host's version check reads) and the 401 of a wrong password with
     * the DIRECT client: `{version, pid, urls, paths: {tmp}}`, the pinned version, and an
     * `UnauthorizedError` body (`_tag`) for a client with a wrong password.
     * VERIFIED (23/10/2026): "answers /api/info with the pinned version, and 401 to a wrong
     * password" passed against the real server, so those fields and the `_tag` exist as asserted.
     */
    it('answers /api/info with the pinned version, and 401 to a wrong password', async function () {
      const info = await own.client.server.info();
      assert.strictEqual(info.version, PINNED_OPENCODE_VERSION);
      assert.strictEqual(typeof info.pid, 'number');
      assert.ok(Array.isArray(info.urls), 'urls is not an array');
      assert.strictEqual(typeof info.paths.tmp, 'string');

      const stranger = OpenCode.make({
        baseUrl: own.origin,
        headers: {
          Authorization: `Basic ${Buffer.from('opencode:not-the-password').toString('base64')}`,
        },
      });
      await assert.rejects(stranger.server.info(), (error: unknown) => {
        assert.strictEqual((error as { _tag?: string })._tag, 'UnauthorizedError');
        return true;
      });
    });

    /**
     * `model.list()` is `{location, data}` and every model maps through `toModelOption` without
     * throwing, with a numeric context limit above zero (the context line of issue #25 divides by
     * it), a `cost` array (what makes a model "free") and a `variants` array.
     * VERIFIED (23/10/2026): "lists models the host can map, with the context limit, cost and
     * variants" passed for every model of the real catalog. Not observed: a model without
     * `limit.context` (the case would name it).
     */
    it('lists models the host can map, with the context limit, cost and variants', async function () {
      const listed = await own.client.model.list();
      assert.ok(Array.isArray(listed.data), 'model.list().data is not an array');
      assert.ok(listed.data.length >= 1, 'the real catalog lists no model');
      for (const model of listed.data) {
        assert.ok(Array.isArray(model.cost), `${model.id}: cost is not an array`);
        assert.ok(Array.isArray(model.variants), `${model.id}: variants is not an array`);
        assert.strictEqual(typeof model.limit.context, 'number', `${model.id}: no context limit`);
        assert.ok(
          model.limit.context > 0,
          `${model.id}: context limit is ${String(model.limit.context)}`,
        );
        const option = toModelOption(model);
        assert.strictEqual(option.id, model.id);
        assert.strictEqual(option.providerID, model.providerID);
      }
    });

    /**
     * `model.default()` is `{data: ModelInfo | null}`, not a bare model.
     * VERIFIED (23/10/2026): "answers model.default as {data: model | null}" passed. The case
     * accepts both `null` and a model, so it does not say which one this server returned.
     */
    it('answers model.default as {data: model | null}', async function () {
      const fallback = await own.client.model.default();
      assert.ok('data' in fallback, 'model.default() has no `data`');
      assert.ok(
        fallback.data === null || typeof fallback.data.id === 'string',
        `model.default().data is neither null nor a model: ${JSON.stringify(fallback.data)}`,
      );
    });

    /**
     * `agent.list()` holds `build` and `plan` as primary agents; `provider.list()` maps.
     * VERIFIED (23/10/2026): "lists build and plan as selectable agents, and the providers"
     * passed against the real server.
     */
    it('lists build and plan as selectable agents, and the providers', async function () {
      const agents = await own.client.agent.list();
      const selectable = toAgentOptions(agents.data).map((agent) => agent.id);
      assert.ok(selectable.includes('build'), `no build agent among ${selectable.join(', ')}`);
      assert.ok(selectable.includes('plan'), `no plan agent among ${selectable.join(', ')}`);
      const providers = await own.client.provider.list();
      assert.ok(Array.isArray(providers.data));
      for (const provider of providers.data) {
        assert.strictEqual(toProviderOption(provider).id, provider.id);
      }
    });

    /**
     * The session lifecycle and the events it publishes, in one case because each step needs the
     * session of the one before: the stream opens with `server.connected`; `session.create` gives
     * `session.created`; `session.update({title})` gives `session.renamed`; `switchAgent(plan)`
     * gives `session.agent.selected`; `switchModel` (a model of the catalog, with its first
     * variant if it lists one) gives `session.model.selected` carrying the variant;
     * `message.list` then holds the `agent-switched` and `model-switched` messages; `session.get`
     * and `session.list({directory, parentID: null, search})` find it (and map through
     * `toSessionSummary`); `interrupt` on an idle session answers the BARE `{interrupted: false}`;
     * `fork` of a session without messages (checked right after `create`, before any switch) is
     * refused with `InvalidRequestError` / `empty_session`; the pending-request lists and the saved
     * permissions are empty; and `session.remove` gives `session.deleted`, after which `get`
     * throws `SessionNotFoundError`.
     * The model switch on a session with no stored model publishes the event: the synthetic
     * fixture INVENTED that rule; this case is where it meets a real server.
     * Observed on the first run against opencode 2.0.32 (22/10/2026): a fork AFTER the agent and
     * model switches was NOT refused, so those two switch messages count as messages for the
     * "empty session" rule; that is why the refusal is checked before them.
     * VERIFIED (23/10/2026): "creates, renames, switches, lists, forks, interrupts and removes a
     * session, with the events" passed again on the final tree.
     */
    it('creates, renames, switches, lists, forks, interrupts and removes a session, with the events', async function () {
      this.timeout(60_000);
      const watcher = watchEvents(own.client);
      try {
        await watcher.ready();
        assert.strictEqual(
          watcher.events[0]?.type,
          'server.connected',
          'the first frame is not server.connected',
        );

        const created = await own.client.session.create({});
        const sessionID = created.id;
        await watcher.waitFor(
          (e) => e.type === 'session.created' && e.data?.['sessionID'] === sessionID,
          'session.created',
        );

        // A session without any message cannot be forked (the planner's spike, 21/10/2026).
        await assert.rejects(own.client.session.fork({ sessionID }), (error: unknown) => {
          const body = error as { _tag?: string; kind?: string };
          assert.strictEqual(
            body._tag,
            'InvalidRequestError',
            `fork error: ${JSON.stringify(body)}`,
          );
          assert.strictEqual(body.kind, 'empty_session');
          return true;
        });

        await own.client.session.update({ sessionID, title: 'Contract check' });
        await watcher.waitFor(
          (e) => e.type === 'session.renamed' && e.data?.['sessionID'] === sessionID,
          'session.renamed',
        );

        await own.client.session.switchAgent({ sessionID, agent: 'plan' });
        await watcher.waitFor(
          (e) => e.type === 'session.agent.selected' && e.data?.['sessionID'] === sessionID,
          'session.agent.selected',
        );

        const models = (await own.client.model.list()).data;
        const model = models[0];
        assert.ok(model, 'the catalog lists no model to switch to');
        const variant = model.variants[0]?.id;
        await own.client.session.switchModel({
          sessionID,
          model: {
            id: model.id,
            providerID: model.providerID,
            ...(variant === undefined ? {} : { variant }),
          },
        });
        const selected = await watcher.waitFor(
          (e) => e.type === 'session.model.selected' && e.data?.['sessionID'] === sessionID,
          'session.model.selected',
        );
        const chosen = selected.data?.['model'] as { id?: string; variant?: string } | undefined;
        assert.strictEqual(chosen?.id, model.id);
        if (variant !== undefined) assert.strictEqual(chosen?.variant, variant);

        const messages = await own.client.message.list({ sessionID, order: 'asc' });
        const kinds = messages.data.map((message) => message.type);
        assert.ok(
          kinds.includes('agent-switched'),
          `no agent-switched message in ${kinds.join(', ')}`,
        );
        assert.ok(
          kinds.includes('model-switched'),
          `no model-switched message in ${kinds.join(', ')}`,
        );

        const row = await own.client.session.get({ sessionID });
        assert.strictEqual(row.id, sessionID);
        assert.strictEqual(toSessionSummary(row).id, sessionID);
        const listed = await own.client.session.list({
          directory: folder,
          parentID: null,
          search: 'Contract check',
          limit: 20,
        });
        assert.ok(
          listed.data.some((item) => item.id === sessionID),
          `the session is not in session.list: ${listed.data.map((item) => item.id).join(', ')}`,
        );
        assert.ok('cursor' in listed, 'session.list has no cursor');

        const idle = await own.client.session.interrupt({ sessionID });
        assert.deepStrictEqual(idle, { interrupted: false });

        const pending = await own.client.permission.request.list();
        assert.deepStrictEqual(pending.data, []);
        const forms = await own.client.form.list();
        assert.deepStrictEqual(forms.data, []);
        const saved = await own.client.permission.saved.list();
        assert.ok(Array.isArray(saved), 'permission.saved.list() is not an array');

        await own.client.session.remove({ sessionID });
        await watcher.waitFor(
          (e) => e.type === 'session.deleted' && e.data?.['sessionID'] === sessionID,
          'session.deleted',
        );
        await assert.rejects(own.client.session.get({ sessionID }), (error: unknown) => {
          assert.strictEqual((error as { _tag?: string })._tag, 'SessionNotFoundError');
          return true;
        });
      } finally {
        await watcher.stop();
      }
    });

    /**
     * `file.find({query, type: 'file'})` answers `{location, data: [{path, type}]}`; the index is
     * refreshed every 10 s (read in `search.ts@843a6c51`), so the file is written first and the
     * query retried for up to 25 s. The file exists in the served folder (`src/sample.ts`).
     * VERIFIED (23/10/2026): "finds a file with file.find" passed against the real server.
     */
    it('finds a file with file.find', async function () {
      this.timeout(40_000);
      const file = path.join(folder, 'src', 'sample.ts');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, SAMPLE_TS);
      const deadline = Date.now() + 25_000;
      let found = await own.client.file.find({ query: 'sample', type: 'file' });
      while (
        !found.data.some((entry) => entry.path.endsWith('sample.ts')) &&
        Date.now() < deadline
      ) {
        await sleep(2_000);
        found = await own.client.file.find({ query: 'sample', type: 'file' });
      }
      assert.ok(
        found.data.some((entry) => entry.path.replace(/\\/g, '/').endsWith('src/sample.ts')),
        `src/sample.ts not found: ${JSON.stringify(found.data)}`,
      );
      for (const entry of found.data) {
        assert.strictEqual(typeof entry.path, 'string');
        assert.ok(
          entry.type === 'file' || entry.type === 'directory',
          `type ${String(entry.type)}`,
        );
      }
    });

    /**
     * The reads behind "Changed files" (issue #31) on a session with NO changed file and no turn:
     * `message.list({ type: 'user', order, limit })` is accepted and answers `{data, cursor}`;
     * `session.diff` answers `[]` with and without `from`/`context`, even with no user message;
     * an input admitted with `prompt({ resume: false })` (decision of Sergio, 23/10/2026, Engram
     * #1154) is NOT a message of the history (it waits in the inbox), so it cannot be a `from`:
     * `session.diff({ from: <that id> })` throws `MessageNotFoundError`, like an unknown id; an
     * unknown session throws `SessionNotFoundError`. That the `type` filter really filters, and
     * what `from`/`to` of real user messages do, needs a delivered turn and is NOT checked here.
     * The input left in the inbox disappears with the session, which this case removes.
     * VERIFIED (23/10/2026, Windows 11, opencode 2.0.32, `npm run test:integration -- --label
     * real-opencode`): "reads user messages and diffs a session that changed nothing" passed.
     * The folder of this case is not a git repository; the same answers came from a git one in a
     * spike outside the suite.
     */
    it('reads user messages and diffs a session that changed nothing', async function () {
      const created = await own.client.session.create({});
      const sessionID = created.id;
      try {
        const none = await own.client.message.list({
          sessionID,
          type: 'user',
          order: 'asc',
          limit: 1,
        });
        assert.deepStrictEqual(none.data, []);
        assert.ok('cursor' in none, 'message.list has no cursor');
        assert.deepStrictEqual(await own.client.session.diff({ sessionID }), []);
        assert.deepStrictEqual(await own.client.session.diff({ sessionID, context: 0 }), []);

        const admitted = await own.client.session.prompt({
          sessionID,
          text: 'contract check, never delivered',
          resume: false,
        });
        assert.strictEqual(typeof admitted.id, 'string');
        const after = await own.client.message.list({ sessionID, type: 'user', order: 'desc' });
        assert.deepStrictEqual(after.data, [], 'resume:false must leave no message in the history');
        for (const from of [admitted.id, 'msg_does_not_exist']) {
          await assert.rejects(own.client.session.diff({ sessionID, from }), (error: unknown) => {
            assert.strictEqual((error as { _tag?: string })._tag, 'MessageNotFoundError');
            return true;
          });
        }
        await assert.rejects(
          own.client.session.diff({ sessionID: 'ses_does_not_exist' }),
          (error: unknown) => {
            assert.strictEqual((error as { _tag?: string })._tag, 'SessionNotFoundError');
            return true;
          },
        );
      } finally {
        await own.client.session.remove({ sessionID });
      }
    });

    /**
     * Protects the contract of the Usage view (E9-sidebar-home, issue #187, decision P3=2): the
     * experimental `experimental.session.stats` (called by its 2.2 name since issue #191; the
     * VERIFIED run below used the old `session.stats` alias; the new name passed too, see the
     * 2.2.7 run below) answers the `SessionStatsInfo` shape for a window with NO
     * `project` (so the whole opencode database, every project) and `tools: 'none'`, and an invalid
     * `timezone` is refused with `InvalidRequestError`. Sends no prompt. The numbers are not
     * asserted (the database is isolated by `XDG_*` but a session of an earlier case may exist);
     * only that the fields the view reads are there with their types, that the window comes back
     * as asked and that the model rows, if any, carry the fields the view prints.
     * VERIFIED against a real server (Windows 11, 07/11/2026, `npm run test:integration -- --label
     * real-opencode`): this case passed, with the 2.0.32 client against an opencode **2.2.5**
     * executable (the one installed here, not the pinned 2.0.32: the suite's version cases failed
     * for that reason on the same run). So the shape and the timezone refusal are seen on 2.2.5;
     * on 2.0.32 itself they are only read in `types.d.ts` and `core/src/session/stats.ts`
     * @843a6c51 (UNVERIFIED there). Never asserted: the numbers.
     * VERIFIED (10/11/2026, Windows 11, opencode CLI 2.2.7, `npm run test:integration -- --label
     * real-opencode`, "21 passing"): this case, "reads the usage of a window across all projects
     * and refuses an invalid timezone", passed through `experimental.session.stats`.
     */
    it('reads the usage of a window across all projects and refuses an invalid timezone', async function () {
      const to = Date.now();
      const from = to - 24 * 60 * 60 * 1000;
      const stats = await own.client.experimental.session.stats({
        from,
        to,
        timezone: 'UTC',
        tools: 'none',
      });
      assert.strictEqual(stats.range.from, from);
      assert.strictEqual(stats.range.to, to);
      for (const key of ['sessions', 'subagents', 'prompts', 'steps', 'cost'] as const) {
        assert.strictEqual(typeof stats[key], 'number', `${key} is not a number`);
      }
      for (const key of ['input', 'output', 'reasoning'] as const) {
        assert.strictEqual(typeof stats.tokens[key], 'number', `tokens.${key} is not a number`);
      }
      assert.strictEqual(typeof stats.tokens.cache.read, 'number');
      assert.strictEqual(typeof stats.tokens.cache.write, 'number');
      assert.deepStrictEqual(stats.tools, { mode: 'none' });
      assert.ok(Array.isArray(stats.models), 'models is not a list');
      for (const model of stats.models) {
        assert.strictEqual(typeof model.model.id, 'string');
        assert.strictEqual(typeof model.model.providerID, 'string');
        assert.strictEqual(typeof model.steps, 'number');
        assert.strictEqual(typeof model.cost, 'number');
      }
      await assert.rejects(
        own.client.experimental.session.stats({ from, to, timezone: 'Not/AZone' }),
        (error: unknown) => {
          assert.strictEqual((error as { _tag?: string })._tag, 'InvalidRequestError');
          return true;
        },
      );
    });

    /**
     * The revert contract (issue #32) WITHOUT a model: `session.shell` runs a command with no model
     * and its projection leaves a message of type `shell` in the history, which is enough to stage,
     * clear and commit a revert and see the three events. Checks: an invented message id is
     * `MessageNotFoundError` on `stage`; `stage` answers `{ messageID, files }` with an empty
     * `files` (this folder is not a git repository, so the server takes no snapshot), publishes
     * `session.revert.staged` and puts the same revert on `session.get`; `message.list` keeps
     * listing the message while the revert is staged (nothing filters it, the clients hide it);
     * `clear` publishes `cleared` and empties the revert; `commit` publishes `committed { to }` and
     * the message is GONE from `message.list`; after a commit `clear` resolves, emits nothing and
     * the message does not come back (a committed revert cannot be undone).
     * `message.get` with the id of a message of ANOTHER session (a second `shell` session, removed
     * at once) must not return that message under this session (review S1 of the host's check).
     * The files of a revert from a real turn, and `files: false`, are NOT checked here (they need a
     * model and a git repository). The session is removed at the end.
     *
     * Issue #144, why the case cancels an inbox item first: `session.shell` admits its result as a
     * `synthetic` inbox item with `resume: false` (opencode 2.0.32 `session.ts` L213-216, tag
     * 843a6c51), pending and with no turn; `revert.clear` ends with `execution.wake` (L331-339),
     * and the runner PROMOTES a pending item and calls the model. Before the fix the case ran a
     * model turn on every execution, and only passed because `whenIdle` retried `SessionBusyError`
     * until the turn ended. So the case now waits for that one `synthetic` in `inbox.list`, cancels
     * it (`session.inbox.cancelled`), and after each `clear` waits for the run it woke to emit
     * `session.execution.succeeded` (`untilSettled`); a `SessionBusyError` is now a failure.
     * HYPOTHESIS: that event means the session is idle again; see the comment in `untilSettled`
     * (the emitter runs before the coordinator drops the execution).
     * Finally it asserts that its session saw no `session.step.started` and no
     * `session.inbox.delivered`, and no `execution.failed|interrupted`.
     * VERIFIED (Windows 11, opencode 2.0.32, 02/11/2026): before the fix the case failed with
     * "AssertionError [ERR_ASSERTION]: a model turn ran in a case that must not run one" and a
     * `seen` of `session.inbox.enqueued,session.revert.staged,session.revert.cleared,session.execution.started,session.inbox.delivered,session.step.started,…,session.execution.succeeded`;
     * after it, three runs of `--label real-opencode --grep "commits a revert"` printed
     * "✔ stages, clears and commits a revert on a shell message". The same day, on the final code,
     * the full `--label real-opencode` printed "19 passing" with
     * "✔ stages, clears and commits a revert on a shell message (1700ms)".
     * Observed: the `clear` after a commit also publishes `execution.started` and
     * `execution.succeeded` with nothing to run, which is why `untilSettled(2)` follows it.
     * NOT observed: macOS/Linux, a model that is slow (the point of the fix is that it is not called).
     */
    it('stages, clears and commits a revert on a shell message', async function () {
      this.timeout(60_000);
      const sessionID = (await own.client.session.create({})).id;
      const seen: string[] = [];
      let committedTo: string | undefined;
      const stream = new AbortController();
      const pump = (async () => {
        try {
          for await (const event of own.client.event.subscribe({ signal: stream.signal })) {
            if (
              event.type === 'session.revert.staged' ||
              event.type === 'session.revert.cleared' ||
              event.type === 'session.revert.committed' ||
              event.type === 'session.execution.started' ||
              event.type === 'session.execution.succeeded' ||
              event.type === 'session.execution.failed' ||
              event.type === 'session.execution.interrupted' ||
              event.type === 'session.step.started' ||
              event.type === 'session.inbox.enqueued' ||
              event.type === 'session.inbox.delivered' ||
              event.type === 'session.inbox.cancelled'
            ) {
              if (event.data.sessionID !== sessionID) continue;
              seen.push(event.type);
              if (event.type === 'session.revert.committed') committedTo = event.data.to;
            }
          }
        } catch {
          // The stream ends when the case aborts it.
        }
      })();
      const kinds = async (): Promise<string[]> =>
        (await own.client.message.list({ sessionID, order: 'asc', limit: 50 })).data.map(
          (message) => message.type,
        );
      const untilSeen = async (type: string, count: number): Promise<void> => {
        const deadline = Date.now() + 10_000;
        while (seen.filter((item) => item === type).length < count && Date.now() < deadline) {
          await sleep(100);
        }
        assert.ok(
          seen.filter((item) => item === type).length >= count,
          `no ${type}: ${seen.join()}`,
        );
      };
      // Waits (10 s) for `count` runs of the session to have SUCCEEDED, and fails if one failed or
      // was interrupted. A `clear` wakes the session (`execution.wake`), so the next call must wait
      // for that run to end instead of retrying on `SessionBusyError`.
      // HYPOTHESIS: after `session.execution.succeeded` the session is no longer active. Read in the
      // tag 843a6c51, the order points the other way: `settled` (which publishes `succeeded`,
      // `packages/core/src/session/execution.ts` L119-126) runs in the first `onExit` of
      // `packages/core/src/session/run-coordinator.ts` (L101-105), BEFORE the second one (L106)
      // calls `settle`, whose `executions.delete` (L118) is what `isActive` (L122) reads. So a window
      // with the event seen and the session still active exists, but it is a few synchronous steps
      // on the server against an SSE delivery plus two HTTP round trips (`session.get`, then
      // `revert.stage`) on this side; after the second `clear` nothing here can be busy. Not
      // observed in 4 runs on Windows (three of this case alone and the full real suite); if a
      // `SessionBusyError` ever shows up right after this helper, poll `session.active()` instead.
      const untilSettled = async (count: number): Promise<void> => {
        const total = (type: string): number => seen.filter((item) => item === type).length;
        const deadline = Date.now() + 10_000;
        while (total('session.execution.succeeded') < count && Date.now() < deadline) {
          await sleep(100);
        }
        assert.ok(
          total('session.execution.succeeded') >= count,
          `session.execution.succeeded x${String(count)} not seen: ${seen.join()}`,
        );
        assert.strictEqual(total('session.execution.failed'), 0, `a run failed: ${seen.join()}`);
        assert.strictEqual(
          total('session.execution.interrupted'),
          0,
          `a run was interrupted: ${seen.join()}`,
        );
      };
      try {
        await own.client.session.shell({ sessionID, command: 'echo revert-contract' });
        let shellID: string | undefined;
        const deadline = Date.now() + 20_000;
        while (shellID === undefined && Date.now() < deadline) {
          const page = await own.client.message.list({ sessionID, order: 'asc', limit: 50 });
          shellID = page.data.find((message) => message.type === 'shell')?.id;
          if (shellID === undefined) await sleep(250);
        }
        assert.ok(shellID, 'session.shell left no shell message in the history');

        // `shell` leaves its result as a pending `synthetic` inbox item (`resume: false`); a `clear`
        // would wake the session and run a MODEL turn on it (#144). Cancel it first.
        let synthetic = [] as Awaited<ReturnType<typeof own.client.session.inbox.list>>;
        const inboxDeadline = Date.now() + 10_000;
        while (synthetic.length === 0 && Date.now() < inboxDeadline) {
          synthetic = (await own.client.session.inbox.list({ sessionID })).filter(
            (item) => item.type === 'synthetic',
          );
          if (synthetic.length === 0) await sleep(100);
        }
        assert.strictEqual(synthetic.length, 1, `expected one pending synthetic: ${seen.join()}`);
        const [pending] = synthetic;
        assert.ok(pending, 'no pending synthetic');
        await own.client.session.inbox.cancel({ sessionID, inboxID: pending.id });
        assert.deepStrictEqual(await own.client.session.inbox.list({ sessionID }), []);
        await untilSeen('session.inbox.cancelled', 1);

        // The host trusts `message.get({ sessionID, messageID })` to be scoped to the session before
        // it stages (`stageRevert`): a message of ANOTHER session must not come back under this one.
        const otherID = (await own.client.session.create({})).id;
        try {
          await own.client.session.shell({ sessionID: otherID, command: 'echo other-session' });
          let foreignID: string | undefined;
          const foreignDeadline = Date.now() + 20_000;
          while (foreignID === undefined && Date.now() < foreignDeadline) {
            const page = await own.client.message.list({
              sessionID: otherID,
              order: 'asc',
              limit: 50,
            });
            foreignID = page.data.find((message) => message.type === 'shell')?.id;
            if (foreignID === undefined) await sleep(250);
          }
          assert.ok(foreignID, 'session.shell left no shell message in the other session');
          const foreign = await own.client.session.message
            .get({ sessionID, messageID: foreignID })
            .then(
              (message) => message,
              () => undefined,
            );
          assert.ok(
            foreign === undefined || foreign.id !== foreignID,
            'message.get returned a message of another session under this session',
          );
        } finally {
          await own.client.session.remove({ sessionID: otherID });
        }

        await assert.rejects(
          own.client.session.revert.stage({ sessionID, messageID: 'msg_does_not_exist' }),
          (error: unknown) => {
            assert.strictEqual((error as { _tag?: string })._tag, 'MessageNotFoundError');
            return true;
          },
        );

        const staged = await own.client.session.revert.stage({ sessionID, messageID: shellID });
        assert.deepStrictEqual(staged, { messageID: shellID, files: [] });
        await untilSeen('session.revert.staged', 1);
        assert.strictEqual(
          (await own.client.session.get({ sessionID })).revert?.messageID,
          shellID,
        );
        assert.deepStrictEqual(
          await kinds(),
          ['shell'],
          'a staged revert must not hide the message',
        );

        await own.client.session.revert.clear({ sessionID });
        await untilSeen('session.revert.cleared', 1);
        await untilSettled(1);
        assert.strictEqual((await own.client.session.get({ sessionID })).revert, undefined);

        await own.client.session.revert.stage({ sessionID, messageID: shellID });
        await untilSeen('session.revert.staged', 2);
        await own.client.session.revert.commit({ sessionID });
        await untilSeen('session.revert.committed', 1);
        assert.strictEqual(committedTo, shellID);
        assert.ok(!(await kinds()).includes('shell'), 'a committed revert must delete the message');

        // A committed revert cannot be undone: `clear` resolves, says nothing, brings nothing back.
        await own.client.session.revert.clear({ sessionID });
        await untilSettled(2);
        await sleep(1_000);
        assert.strictEqual(seen.filter((item) => item === 'session.revert.cleared').length, 1);
        assert.ok(
          !(await kinds()).includes('shell'),
          'clear after commit brought the message back',
        );

        // The case spends no model quota: no step started and no inbox item was delivered.
        assert.deepStrictEqual(
          seen.filter((t) => t === 'session.step.started' || t === 'session.inbox.delivered'),
          [],
          `a model turn ran in a case that must not run one; seen: ${seen.join()}`,
        );
      } finally {
        stream.abort();
        await pump;
        await own.client.session.remove({ sessionID });
      }
    });

    /**
     * What a session says about WHERE it lives when the server runs in a SUBFOLDER of a git
     * repository (issue #31), which is how the extension runs it (cwd = the served folder): the
     * location is that subfolder and `subpath` says how deep it is below the project directory, so
     * `diffRoot(location.directory, subpath)` gives the repository root, the base of the paths of
     * `session.diff`. A second server of its own, started in `<repo>/src` of a temporary
     * repository this case creates and deletes (`git` must be on the PATH).
     * Observation behind the design: `x-opencode-directory` did NOT move a session to another
     * folder in a spike (the location stayed the server's cwd whatever the header said), which is
     * harmless for the extension because its cwd and its header are the same folder.
     * VERIFIED (23/10/2026, Windows 11, opencode 2.0.32, `npm run test:integration -- --label
     * real-opencode`): "reports the subpath of a session served from a subfolder of a repository"
     * passed. NOT observed: a worktree, a symlinked folder, a turn that changes a file (so that
     * the paths of `session.diff` really start at that root is still HYPOTHESIS), macOS/Linux.
     */
    it('reports the subpath of a session served from a subfolder of a repository', async function () {
      this.timeout(60_000);
      const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsc-contract-repo-'));
      const served = path.join(repo, 'src');
      fs.mkdirSync(served);
      fs.writeFileSync(path.join(served, 'a.ts'), 'export const a = 1;\n');
      execFileSync('git', ['init', '-q'], { cwd: repo });
      const sub = await startOwnServer(binary, served, 'subfolder-pw');
      try {
        const created = await sub.client.session.create({});
        const row = await sub.client.session.get({ sessionID: created.id });
        const real = (value: string): string => fs.realpathSync.native(value).toLowerCase();
        assert.strictEqual(real(row.location.directory), real(served));
        assert.strictEqual(row.subpath, 'src');
        const root = diffRoot(row.location.directory, row.subpath);
        assert.ok(root !== undefined, 'diffRoot refused the location and subpath of the server');
        assert.strictEqual(real(root), real(repo));
        assert.deepStrictEqual(await sub.client.session.diff({ sessionID: created.id }), []);
        await sub.client.session.remove({ sessionID: created.id });
      } finally {
        await sub.stop();
        fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    });

    /**
     * Slash commands (issue #33) against a REAL server, with NO prompt and NO existing command run
     * (running `init`, `review` or `hello` would send a prompt to a model and spend quota): a third
     * server of its own is started in a temporary folder that already holds
     * `.opencode/command/hello.md` (frontmatter `description: Say hello`), and the case checks that
     * `command.list()` is `{location, data}` with the built-ins `init` and `review` and the project
     * file `hello` with its description (the plan only had HYPOTHESIS that `.opencode/command` is
     * read), that every entry maps through `toCommandOption`, and that `session.command` with an
     * unknown name is refused with the `CommandNotFoundError` body, which is what the host relays.
     * The file is written BEFORE the server starts, so it needs no `command.updated` (a hot reload
     * on a new file was not tried: UNVERIFIED). The folder is created and deleted by the case.
     *
     * The list is polled for up to 10 s, on purpose, until `init`, `review` AND `hello` are all in
     * it (issue #191; before, until the first non-empty answer): the FIRST `GET /api/command` on a
     * server that has just started answered `data: []` (the location is still loading) and the same
     * request a moment later answered the three commands; the first version of this case, which
     * read it once, failed with "command.list lacks \"init\"; got: " for that reason. So a catalog
     * loaded right after the start can hold an empty command list. HYPOTHESIS: on 2.2.x the
     * built-in and the project commands may load at different moments (the issue saw `goal` listed
     * and `hello` missing); the new loop logs `command.list: complete after <n> reads` so a run
     * shows whether it waited. VERIFIED (10/11/2026, Windows 11, opencode CLI 2.2.7, "21
     * passing"): the case "lists the project commands and refuses an unknown one with
     * CommandNotFoundError" passed and printed `command.list: first answer empty: true` and
     * `command.list: complete after 3 reads: true`. The log gives no per-read breakdown, so the
     * goal/hello race above stays a HYPOTHESIS.
     * VERIFIED (28/10/2026, Windows 11, VS Code 1.144.0, opencode 2.0.32, `npm run test:integration
     * -- --label real-opencode`, "16 passing"): the case "lists the project commands and refuses an
     * unknown one with CommandNotFoundError" passed and printed `command.list: first answer empty:
     * true`; so `init`, `review` and the `.opencode/command/hello.md` file are listed with its
     * description, and an unknown name throws `CommandNotFoundError`. NOT observed: any existing
     * command run (it would spend quota), `command.updated` on a new file, macOS and Linux.
     */
    it('lists the project commands and refuses an unknown one with CommandNotFoundError', async function () {
      this.timeout(60_000);
      const served = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsc-contract-commands-'));
      fs.mkdirSync(path.join(served, '.opencode', 'command'), { recursive: true });
      fs.writeFileSync(
        path.join(served, '.opencode', 'command', 'hello.md'),
        '---\ndescription: Say hello\n---\nSay hello to $ARGUMENTS.\n',
      );
      const sub = await startOwnServer(binary, served, 'commands-pw');
      try {
        let listed = await sub.client.command.list();
        assert.ok(Array.isArray(listed.data), 'command.list().data is not an array');
        const firstWasEmpty = listed.data.length === 0;
        const wantedNames = ['init', 'review', 'hello'];
        const complete = (): boolean =>
          wantedNames.every((wanted) => listed.data.some((entry) => entry.name === wanted));
        const deadline = Date.now() + 10_000;
        let reads = 1;
        while (!complete() && Date.now() < deadline) {
          await sleep(500);
          listed = await sub.client.command.list();
          reads++;
        }
        console.log(`command.list: first answer empty: ${String(firstWasEmpty)}`);
        console.log(`command.list: complete after ${String(reads)} reads: ${String(complete())}`);
        const options = listed.data.map(toCommandOption);
        const names = options.map((option) => option.name);
        for (const wanted of wantedNames) {
          assert.ok(
            names.includes(wanted),
            `command.list lacks "${wanted}"; got: ${names.join(', ')}`,
          );
        }
        assert.strictEqual(
          options.find((option) => option.name === 'hello')?.description,
          'Say hello',
        );
        for (const option of options) {
          assert.strictEqual(typeof option.name, 'string');
          assert.ok(option.name.length > 0, 'a command with an empty name');
        }

        const created = await sub.client.session.create({});
        try {
          await assert.rejects(
            sub.client.session.command({
              sessionID: created.id,
              name: 'no-such-command',
              text: '',
              delivery: 'queue',
            }),
            (error: unknown) => {
              assert.strictEqual((error as { _tag?: string })._tag, 'CommandNotFoundError');
              return true;
            },
          );
        } finally {
          await sub.client.session.remove({ sessionID: created.id });
        }
      } finally {
        await sub.stop();
        fs.rmSync(served, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    });
  });

  /**
   * The server side of the OpenCode Settings tab (issue #128, E10) against a REAL opencode, through
   * the full client and with NO prompt (no model, no quota): the providers list without secrets, a
   * fake API key connected and removed, a device login started and cancelled, and an MCP server
   * of the config listed with its resource. These are the routes `serverConfig.ts` and
   * `providerAuth.ts` call; the unit tests and the `fake-server` suite fabricate their answers, so
   * this is where a change of shape in a release would show.
   *
   * Isolation: the credentials go to the XDG database of this suite (`.vscode-test.mjs`), which
   * PERSISTS between runs, so the key case removes what an earlier run left before it starts. The
   * login case needs the network (OpenAI's device-code endpoint) and skips with its reason when the
   * server cannot get a code; a 4xx with a `_tag` still fails. Nothing here completes a real
   * login: only start, status and cancel.
   * VERIFIED (1/11/2026, Windows 11, opencode 2.0.32, `--label real-opencode`, 19 passing): "✔
   * lists integrations without secrets, connects a fake key and removes it", "✔ starts a device
   * login, reads an https link and cancels it" (not skipped: the network answered) and "✔ lists an
   * MCP server of the config with its resource". macOS and Linux are UNVERIFIED.
   */
  describe('OpenCode Settings API (own server, no prompt)', function () {
    const FAKE_KEY = 'sk-fake-real-opencode-key-DO-NOT-LOG-5b8e20d1';

    /** A body error with a `_tag`: the server answered and refused, as opposed to a network failure. */
    const isTagged = (error: unknown): error is { _tag: string } =>
      typeof error === 'object' &&
      error !== null &&
      typeof (error as { _tag?: unknown })._tag === 'string';

    /**
     * `integration.list` has the shapes the host maps and no secret; a fake key connects (the
     * server does not validate it), shows as a `credential` connection of method `key`, appears
     * nowhere in the answers, and `credential.remove` takes it away.
     *
     * Protects the connect/remove pair of the Providers section and the "no secret in the list"
     * premise of H3 (the host maps `integration.list` without `credential.list`).
     *
     * The FIRST `integration.list` after the `{url}` line is empty on 2.2.7: the catalog loads
     * asynchronously and the server publishes `integration.updated` when it is ready, so the case
     * polls up to 10 s for a non-empty list instead of reading once (a list that stays empty still
     * fails with "no integrations listed"). The host is not affected: `ServerConfig.event` re-reads
     * the integrations on that event.
     * VERIFIED (10/11/2026, Windows 11, scripted probe against the real CLIs, 3 runs each): 2.2.7
     * answered `n=0` at ~235 ms and `n=239` at ~1380 ms with `integration.updated` on the stream at
     * ~860 ms; 2.2.5 answered `n=239` at ~235 ms. Why 2.2.7 answers empty first: UNVERIFIED (the
     * server source was not read).
     */
    it('lists integrations without secrets, connects a fake key and removes it', async function () {
      this.timeout(60_000);
      const served = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsc-contract-auth-'));
      const sub = await startOwnServer(binary, served, 'auth-pw');
      try {
        let listed = await sub.client.integration.list({});
        const catalogDeadline = Date.now() + 10_000;
        while (listed.data.length === 0 && Date.now() < catalogDeadline) {
          await sleep(200);
          listed = await sub.client.integration.list({});
        }
        assert.ok(Array.isArray(listed.data) && listed.data.length > 0, 'no integrations listed');
        for (const integration of listed.data) {
          assert.strictEqual(typeof integration.id, 'string');
          assert.ok(Array.isArray(integration.methods), `${integration.id}: methods`);
          assert.ok(Array.isArray(integration.connections), `${integration.id}: connections`);
        }
        const target = listed.data.find((integration) => integration.id === 'anthropic');
        assert.ok(target, 'the real catalog has no anthropic integration');
        assert.ok(
          target.methods.some((method) => method.type === 'key'),
          'anthropic offers no key method',
        );

        // A previous run of this suite may have left a credential in the persistent XDG database.
        for (const stale of target.connections) {
          if (stale.type === 'credential') {
            await sub.client.credential.remove({ credentialID: stale.id });
          }
        }
        await sub.client.integration.connect.key({ integrationID: 'anthropic', key: FAKE_KEY });
        let connected: string | undefined;
        const deadline = Date.now() + 10_000;
        while (connected === undefined && Date.now() < deadline) {
          const current = (await sub.client.integration.get({ integrationID: 'anthropic' })).data;
          const credential = current.connections.find((c) => c.type === 'credential');
          if (credential?.type === 'credential') {
            assert.strictEqual(credential.method, 'key');
            connected = credential.id;
          } else {
            await sleep(200);
          }
        }
        assert.ok(connected, 'the fake key never showed as a credential connection');

        const after = JSON.stringify([
          await sub.client.integration.list({}),
          await sub.client.integration.get({ integrationID: 'anthropic' }),
        ]);
        assert.ok(!after.includes(FAKE_KEY), 'the key came back in integration.list/get');

        await sub.client.credential.remove({ credentialID: connected });
        const removed = (await sub.client.integration.get({ integrationID: 'anthropic' })).data;
        assert.ok(
          !removed.connections.some((c) => c.type === 'credential' && c.id === connected),
          'the credential is still connected after credential.remove',
        );
      } finally {
        await sub.stop();
        fs.rmSync(served, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    });

    /**
     * Starts the OpenAI device login (`chatgpt-headless`, mode `auto`), checks the link is an
     * `https:` address and the instructions carry a code, then cancels: `status` afterwards is
     * `IntegrationAttemptNotFoundError`. Nothing is completed.
     *
     * Protects the `https`-only rule of `ProviderAuth` against what the real server returns, and
     * the cancel contract its idempotent Cancel relies on (a 404 after the first cancel).
     */
    it('starts a device login, reads an https link and cancels it', async function () {
      this.timeout(60_000);
      const served = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsc-contract-oauth-'));
      const sub = await startOwnServer(binary, served, 'oauth-pw');
      try {
        const openai = (await sub.client.integration.list({})).data.find((i) => i.id === 'openai');
        const method = openai?.methods.find(
          (m) => m.type === 'oauth' && m.id === 'chatgpt-headless',
        );
        if (openai === undefined || method === undefined || method.type !== 'oauth') {
          this.skip();
        }
        let started;
        try {
          started = (
            await sub.client.integration.oauth.connect({
              integrationID: 'openai',
              methodID: method.id,
            })
          ).data;
        } catch (error) {
          if (isTagged(error)) throw error;
          return this.skip(); // the server could not reach OpenAI: nothing to judge offline
        }
        assert.strictEqual(started.mode, 'auto');
        assert.ok(started.url.startsWith('https://'), `the link is not https: ${started.url}`);
        assert.ok(/code:\s*[A-Z0-9-]{4,}/i.test(started.instructions), started.instructions);
        const status = (
          await sub.client.integration.oauth.status({
            integrationID: 'openai',
            attemptID: started.attemptID,
          })
        ).data;
        assert.strictEqual(status.status, 'pending');
        await sub.client.integration.oauth.cancel({
          integrationID: 'openai',
          attemptID: started.attemptID,
        });
        await assert.rejects(
          sub.client.integration.oauth.status({
            integrationID: 'openai',
            attemptID: started.attemptID,
          }),
          (error: unknown) => {
            assert.strictEqual(
              (error as { _tag?: string })._tag,
              'IntegrationAttemptNotFoundError',
            );
            return true;
          },
        );
      } finally {
        await sub.stop();
        fs.rmSync(served, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    });

    /**
     * An MCP server declared in `mcp.servers` (passed through `OPENCODE_CONFIG_CONTENT`, a stdio
     * server in `fake-mcp.mjs` run by the suite's Node) shows as `connected` in `mcp.list` and its
     * resource and template are in `mcp.resource.catalog`.
     *
     * Protects the two reads of the MCP section. The list is EMPTY for the first moments of a
     * server (the spike saw `[]` at 25 ms and 3 s, filled after the first `mcp.status.changed`),
     * so the case polls up to 30 s instead of reading once.
     */
    it('lists an MCP server of the config with its resource', async function () {
      this.timeout(90_000);
      const node = process.env['OPEN_VS_CODE_TEST_NODE'];
      const script = process.env['OPEN_VS_CODE_TEST_FAKE_MCP'];
      assert.ok(node && script, 'OPEN_VS_CODE_TEST_NODE / OPEN_VS_CODE_TEST_FAKE_MCP are not set');
      const served = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsc-contract-mcp-'));
      const config = JSON.stringify({
        mcp: { servers: { fakemcp: { type: 'local', command: [node, script] } } },
      });
      const sub = await startOwnServer(binary, served, 'mcp-pw', {
        OPENCODE_CONFIG_CONTENT: config,
      });
      try {
        const deadline = Date.now() + 30_000;
        let status: string | undefined;
        while (status !== 'connected' && Date.now() < deadline) {
          const servers = (await sub.client.mcp.list({})).data;
          status = servers.find((server) => server.name === 'fakemcp')?.status.status;
          if (status !== 'connected') await sleep(500);
        }
        assert.strictEqual(status, 'connected', `fakemcp ended ${String(status)}`);
        const catalog = (await sub.client.mcp.resource.catalog({})).data;
        assert.ok(
          catalog.resources.some((r) => r.server === 'fakemcp' && r.name === 'fake-readme'),
          `resources: ${JSON.stringify(catalog.resources)}`,
        );
        assert.ok(
          catalog.templates.some((t) => t.server === 'fakemcp' && t.name === 'fake-file'),
          `templates: ${JSON.stringify(catalog.templates)}`,
        );
      } finally {
        await sub.stop();
        fs.rmSync(served, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    });

    /**
     * The three facts PR2 of #186 (MCP actions) rests on, against a real server and no prompt:
     * (a) a REMOTE MCP server registers an integration `mcp_` + sha1(name NUL url)[0:16] with
     * `metadata.source === 'mcp'` and one oauth method, and `integration.list` returns it; (b)
     * `mcp.list` gives that server the same `integrationID`; (c) `mcp.disconnect` leaves a local
     * server `disabled` and `mcp.connect` brings it back to `connected`. It prints
     * `mcp.connect: connected at return: <bool>`: whether the 204 came after the handshake or
     * before it (the status is read right after the call returns, before any polling).
     *
     * Protects the sign-in button (a, b: without the integration row there is nothing to run the
     * OAuth flow with) and the host's "read the state after the 204" (c). The remote server is a
     * closed port (`127.0.0.1:1`), so it never connects and the case never touches the network;
     * the OAuth flow itself (discovery, browser, callback) is NOT exercised: it needs an MCP
     * server with OAuth.
     */
    it('registers the integration of a remote MCP server and connects and disconnects a local one', async function () {
      this.timeout(120_000);
      const node = process.env['OPEN_VS_CODE_TEST_NODE'];
      const script = process.env['OPEN_VS_CODE_TEST_FAKE_MCP'];
      assert.ok(node && script, 'OPEN_VS_CODE_TEST_NODE / OPEN_VS_CODE_TEST_FAKE_MCP are not set');
      const remoteUrl = 'http://127.0.0.1:1/mcp';
      const integrationID = `mcp_${createHash('sha1').update(`remotemcp\0${remoteUrl}`).digest('hex').slice(0, 16)}`;
      const served = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsc-contract-mcp-actions-'));
      const config = JSON.stringify({
        mcp: {
          servers: {
            fakemcp: { type: 'local', command: [node, script] },
            remotemcp: { type: 'remote', url: remoteUrl },
          },
        },
      });
      const sub = await startOwnServer(binary, served, 'mcp-actions-pw', {
        OPENCODE_CONFIG_CONTENT: config,
      });
      const statusOf = async (name: string) =>
        (await sub.client.mcp.list({})).data.find((server) => server.name === name);
      const until = async (name: string, wanted: string, ms: number): Promise<void> => {
        const deadline = Date.now() + ms;
        while ((await statusOf(name))?.status.status !== wanted && Date.now() < deadline) {
          await sleep(300);
        }
        assert.strictEqual(
          (await statusOf(name))?.status.status,
          wanted,
          `${name} never ${wanted}`,
        );
      };
      try {
        await until('fakemcp', 'connected', 30_000);
        // (a) and (b): polled up to 30 s because the integration may register after the first read.
        const deadline = Date.now() + 30_000;
        let row:
          Awaited<ReturnType<typeof sub.client.integration.list>>['data'][number] | undefined;
        while (row === undefined && Date.now() < deadline) {
          row = (await sub.client.integration.list({})).data.find((r) => r.id === integrationID);
          if (row === undefined) await sleep(500);
        }
        const all = (await sub.client.integration.list({})).data.map((r) => r.id).join(',');
        assert.ok(row !== undefined, `(a) no ${integrationID} in integration.list: ${all}`);
        assert.strictEqual(row.metadata?.['source'], 'mcp');
        assert.ok(
          row.methods.some((m) => m.type === 'oauth'),
          `(a) methods: ${JSON.stringify(row.methods)}`,
        );
        assert.strictEqual((await statusOf('remotemcp'))?.integrationID, integrationID, '(b)');

        // (c)
        await sub.client.experimental.mcp.disconnect({ server: 'fakemcp' });
        await until('fakemcp', 'disabled', 10_000);
        await sub.client.experimental.mcp.connect({ server: 'fakemcp' });
        const atReturn = (await statusOf('fakemcp'))?.status.status === 'connected';
        console.log(`mcp.connect: connected at return: ${String(atReturn)}`);
        await until('fakemcp', 'connected', 30_000);
      } finally {
        await sub.stop();
        fs.rmSync(served, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    });
  });

  /**
   * "Restart Server" (issue #10) against a real server: the old process is stopped (and really
   * gone), a new one comes up, and the event stream reconnects by itself.
   *
   * The pid is read from the last `server ready` line. `process.kill(pid, 0)` throws `ESRCH` only
   * once the process no longer exists, which proves the stop did not leave the old server behind.
   * Runs near the end because it restarts the server the cases above share.
   */
  it('restart replaces the server: new pid, stream reconnected, old process gone', async function () {
    this.timeout(READY_WAIT_MS + 30_000);
    const before = await openLogFromStart();
    const oldPid = lastReadyPid(before.added());
    assert.ok(oldPid, `no \`server ready\` line yet; log:\n${before.added()}`);
    const log = await openLogCursor();
    await vscode.commands.executeCommand(RESTART_SERVER_COMMAND_ID);
    await log.waitFor('restarting the server (command)', 5_000);
    const ready = await matchInLog(
      log,
      /server ready at \S+ \(opencode \S+, pid (\d+)\)/,
      READY_WAIT_MS,
      'the new server',
    );
    const newPid = Number(ready[1]);
    assert.notStrictEqual(newPid, oldPid, 'the restart reused the same process');
    await log.waitFor('event stream connected', 10_000);
    await waitUntilGone(oldPid, 10_000);
  });

  /**
   * Crash recovery (issue #10): killing the server from outside makes the extension restart it
   * after the first backoff (1 s) without any user action, and the stream reconnects.
   *
   * `process.kill(pid)` terminates the server like a crash (Windows: TerminateProcess). Only the
   * first attempt is exercised; the 5 s, 15 s and give-up steps are in the unit tests with an
   * injected clock.
   */
  it('a killed server is restarted automatically after 1 s', async function () {
    this.timeout(READY_WAIT_MS + 30_000);
    const before = await openLogFromStart();
    const pid = lastReadyPid(before.added());
    assert.ok(pid, `no \`server ready\` line yet; log:\n${before.added()}`);
    const log = await openLogCursor();
    process.kill(pid);
    await log.waitFor('server exited unexpectedly; restarting in 1 s (attempt 1 of 3)', 10_000);
    const ready = await matchInLog(
      log,
      /server ready at \S+ \(opencode \S+, pid (\d+)\)/,
      READY_WAIT_MS,
      'the restarted server',
    );
    assert.notStrictEqual(Number(ready[1]), pid);
    await log.waitFor('event stream connected', 10_000);
  });

  /**
   * Issue #158, NO prompt: a plugin written into the served folder while a real opencode runs with
   * the environment of the extension's own server (`buildServeEnv`) is NOT imported, while the same
   * plugin IS imported by a server started without that variable (the control, which keeps the
   * case from passing just because the plugin never loads).
   *
   * Protects the premise of the whole feature: with `OPENCODE_FILEWATCHER_DISABLE=1` opencode does
   * not hot-load a new plugin, so the extension can stop the server and ask before it ever runs.
   * It is what notices a newer opencode renaming the variable. The plugin's only effect is a line
   * appended to a marker file outside the project. Own servers, not the extension's: the
   * extension's watcher would restart the extension's server within ~0.5 s and could hide a plugin
   * that opencode was about to load (so this is a DEVIATION from the plan, which used the
   * extension's server); the environment still comes from `buildServeEnv`, minus the password.
   * The control is skipped when the host already sets either name of the variable, in any
   * spelling. `.opencode/plugins/` exists
   * (empty) before each server starts, so the case does not depend on opencode watching a folder
   * that was created later (the spike of Engram 1849 did not record that detail). Each server gets
   * one `model.list()` BEFORE the plugin is written, because opencode loads the plugins of a
   * location lazily, with the first request that instantiates it (`projectPlugins.ts`), and only
   * a location that is already up has a watcher: the first run of this case, without that
   * request, saw the control server NOT import the plugin within 10 s. The extension makes such
   * requests right after the start, so a running server has the location up.
   * VERIFIED (Windows 11, VS Code 1.144.1, opencode 2.0.32, 03/11/2026, `--label real-opencode`):
   * "✔ does not run a plugin written while the server runs" (about 5 s), "20 passing"; with the
   * line that sets the variable removed from `buildServeEnv`, the same run printed "AssertionError
   * [ERR_ASSERTION]: the plugin ran although the file watcher is off", so the case does see a
   * server whose watcher is on. NOT observed: macOS and Linux, and a plugin declared in
   * `opencode.json`.
   */
  it('does not run a plugin written while the server runs', async function () {
    this.timeout(READY_WAIT_MS * 2 + 60_000);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsc-hotplugin-'));
    const marker = path.join(root, 'marker.txt');
    const writePlugin = (served: string): void => {
      fs.writeFileSync(
        path.join(served, '.opencode', 'plugins', 'late.js'),
        `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, 'loaded\\n');\nexport default {};\n`,
      );
    };
    const prepare = (name: string): string => {
      const served = path.join(root, name);
      fs.mkdirSync(path.join(served, '.opencode', 'plugins'), { recursive: true });
      return served;
    };
    const ownEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(buildServeEnv({}, 'unused', process.platform))) {
      if (key !== 'OPENCODE_PASSWORD' && value !== undefined) ownEnv[key] = value;
    }
    try {
      const hostSetsWatcher = Object.keys(process.env).some((key) =>
        ['OPENCODE_FILEWATCHER_DISABLE', 'OPENCODE_DISABLE_FILEWATCHER'].includes(
          key.toUpperCase(),
        ),
      );
      if (!hostSetsWatcher) {
        const control = await startOwnServer(binary, prepare('control'), 'hotplugin-control-pw');
        try {
          await control.client.model.list();
          writePlugin(path.join(root, 'control'));
          const deadline = Date.now() + 10_000;
          while (!fs.existsSync(marker) && Date.now() < deadline) await sleep(100);
          assert.ok(
            fs.existsSync(marker),
            'the control server (file watcher on) did not import the new plugin: the case cannot tell anything',
          );
        } finally {
          await control.stop();
        }
        fs.rmSync(marker, { force: true });
      }
      const served = prepare('served');
      const own = await startOwnServer(binary, served, 'hotplugin-pw', ownEnv);
      try {
        await own.client.model.list();
        writePlugin(served);
        await sleep(3_000);
        assert.ok(!fs.existsSync(marker), 'the plugin ran although the file watcher is off');
      } finally {
        await own.stop();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  /**
   * External server (issue #11) against a REAL opencode, no prompt: the test starts a second
   * `opencode serve --stdio` itself (`startOwnServer`), with a known password, and points
   * `openVsCode.serverUrl` at it. The extension must stop its own server, check `GET /api/info`
   * with Basic `opencode:<password>`, report the connection with the pinned version and connect the
   * event stream. A wrong password must be refused by the REAL server (a genuine 401), which the
   * synthetic fixture of `externalServer.test.ts` cannot prove.
   *
   * Last on purpose: it swaps the server the cases above share, and puts the profile back at the
   * end (the setting emptied and the password forgotten make the extension launch its own server
   * again with the binary it already detected; that relaunch is not awaited here). Needs no model:
   * the turn that used to run through the external server was dropped. See the header for what
   * was observed on 22/10/2026.
   */
  it('connects to an external real opencode, and a wrong password is refused', async function () {
    this.timeout(READY_WAIT_MS + 30_000);
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(folder, 'no workspace folder is open');
    const external = await startOwnServer(binary, folder, 'real-external-pw');
    try {
      const { origin, password } = external;
      const log = await openLogCursor();
      await vscode.commands.executeCommand(TEST_SET_SERVER_PASSWORD_COMMAND_ID, {
        origin,
        password,
      });
      await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update(SERVER_URL_KEY, origin, vscode.ConfigurationTarget.Global);
      await log.waitFor('opencode server stopped', READY_WAIT_MS);
      await log.waitFor(
        `connected to the external server at ${origin} (opencode ${PINNED_OPENCODE_VERSION})`,
        READY_WAIT_MS,
      );
      await log.waitFor('event stream connected', 10_000);
      assert.ok(!log.added().includes(password), 'the password is in the log');
      log.assertAbsent('prompt accepted');

      log.mark();
      await vscode.commands.executeCommand(TEST_SET_SERVER_PASSWORD_COMMAND_ID, {
        origin,
        password: 'not-the-password',
      });
      await log.waitFor('server not available (unauthorized)', 10_000);
      assert.ok(!log.added().includes('not-the-password'), 'the wrong password is in the log');
    } finally {
      await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update(SERVER_URL_KEY, undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand(CLEAR_SERVER_PASSWORD_COMMAND_ID);
      await external.stop();
    }
  });
});
