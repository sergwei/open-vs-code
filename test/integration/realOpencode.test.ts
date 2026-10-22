// Real opencode suite (opt-in, follow-up of issue #8).
//
// Protects against: the whole server start path (binary detection -> server manager -> `opencode
// serve --stdio --port 0` -> `GET /api/info` -> version check) breaking when it runs inside a real
// VS Code against a REAL opencode instead of the synthetic fixture. The unit tests cannot see
// that: the fixture is ours. The same path was verified under plain Node on Windows 11 with
// opencode 2.0.32 (spike of 2026-10-20); this suite adds the VS Code side (extension host,
// workspace folder, log channel).
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
// which runs the synthetic opencode in CI; their OutsideWorkspace case also stopped deleting a temp
// folder from inside the suite (EPERM on Windows). Several flows are covered in both suites on
// purpose: there with the fixture (deterministic, CI), here with the real server and model.
// Helpers shared by both live in `support/serverCases.ts`.
//
// Phase 3 (issues #18/#44/#19/#10) cases, observed on Windows 11 with VS Code 1.142.0 and the
// free default model on 2026-10-20 (two runs; in the first, the older case "streams a real
// prompt" saw no turn end within 60 s; the second run passed all 9 and the same prompt finished
// in 4 s). HYPOTHESIS that the free model was slow or stuck: the log of that first run
// (the extension's OpenCode.log of that run, read on 20/10/2026) shows `prompt accepted` at
// 20:54:16 and NO `turn finished` line of any kind until the
// next case's prompt at 20:55:16, which queued behind it and was cut by the interrupt; nothing in
// that log points at the model or rules it out. To check: rerun until it repeats and read the
// server's own session messages for that prompt.
//   - `read` of `.env` raises a real `permission.asked` (action `read`) with the default config;
//   - hidden view: `attention: badge 1` and ONE `attention: notified`, then `resolved: reject`,
//     `attention: closed ... (resolved)` and `attention: badge 0`; a bare reject ends the turn
//     `interrupted`;
//   - visible view: no notification, `once` ends the turn `succeeded`;
//   - the `question` tool raised a form, the session waited, `{ q0: "A" }` was accepted;
//   - restart: new pid, stream reconnected, old pid gone; killing the server restarts it after 1 s.
// NEVER pressed: "Always" (it stores a rule such as `read *` in the opencode database of whoever
// runs this). Not observed: how the toast or its links look, the badge on the icon, a REST
// snapshot taken while a request is pending, `form.cancel`, an interrupt with a request pending.
//
// External server case (issue #11), the last `it`: observed on Windows 11 with VS Code 1.143.0 and
// opencode 2.0.32 on 22/10/2026. The real server accepted the Basic credential (the extension
// logged "connected to the external server at ... (opencode 2.0.32)" and a turn finished
// `succeeded` through it) and answered a wrong password with HTTP 401 (the extension logged
// "GET /api/info failed: HTTP 401" and "server not available (unauthorized)"). Not observed
// against a real opencode: a refused connection and a timeout. Details in the header of the case.
//
// Out of scope: the STOP. Nothing public in the extension stops the server before the window
// closes (`deactivate` does it), and a test cannot observe its own host shutting down. The test
// prints the pid so whoever runs it can check afterwards that the process is gone (Windows:
// `tasklist /FI "PID eq <pid>"`; POSIX: `kill -0 <pid>`). The stop is VERIFIED separately under
// plain Node (spike of 2026-10-20) but NOT through `deactivate` in VS Code.
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import { toEditorRef } from '../../src/extension/fileMentions';
import {
  CLEAR_SERVER_PASSWORD_COMMAND_ID,
  CONFIG_SECTION,
  INJECT_WEBVIEW_MESSAGE_COMMAND_ID,
  OPENCODE_PATH_KEY,
  OPENCODE_PATH_SETTING,
  REPLY_PERMISSION_COMMAND_ID,
  RESTART_SERVER_COMMAND_ID,
  SERVER_URL_KEY,
  TEST_SET_SERVER_PASSWORD_COMMAND_ID,
  VIEW_CONTAINER_ID,
} from '../../src/extension/ids';
import {
  killTree,
  PINNED_OPENCODE_VERSION,
  readUrlLine,
  waitForExit,
} from '../../src/extension/opencodeServer';
import { openLogCursor, openLogFromStart, type LogCursor } from './support/extensionLog';
import {
  lastReadyPid,
  matchInLog as sharedMatchInLog,
  sendPrompt,
  waitUntilGone,
} from './support/serverCases';

const EXTENSION_ID = 'sergwei.open-vs-code';
// Above STARTUP_TIMEOUT_MS (30 s) of the extension, so a start that really hangs fails with the
// extension's own error in the log, not with ours. A healthy start takes well under a second.
const READY_WAIT_MS = 35_000;
// Time for a real turn with the free default model (network): our own choice, see the test.
const TURN_WAIT_MS = 60_000;

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
   * End to end of issue #14 against a REAL opencode: the view loads, the event stream connects,
   * a prompt injected as if the webview had sent it is accepted, and the turn ends `succeeded`.
   *
   * The prompt goes through the internal command `openVsCode.test.injectWebviewMessage` (only
   * registered in `ExtensionMode.Test`), because the test API cannot reach the iframe. It uses
   * the free default model of opencode (`opencode/big-pickle`, seen working in the planner's
   * spike on 2026-10-20), so it needs network: a failure may come from the service, and the log
   * excerpt in the assertion includes the `execution.failed` error. The reply TEXT is not
   * asserted (a model may word it differently); the visual result is for the F5 of Sergio.
   * 60 s for the turn is our own choice (the spike's turn took a few seconds).
   * Depends on the previous `it` (same window, server already running).
   */
  it('streams a real prompt to the end', async function () {
    this.timeout(TURN_WAIT_MS + READY_WAIT_MS);
    const log = await openLogFromStart();
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    await log.waitFor('webview ready', 8_000);
    await log.waitFor('event stream connected', 10_000);

    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'integration-1',
      text: 'Reply with exactly: hello there',
      delivery: 'queue',
      files: [],
    });
    await log.waitFor('prompt accepted for ses_', 10_000);
    await log.waitFor('turn finished: ', TURN_WAIT_MS);
    const text = log.added();
    assert.ok(
      text.includes('turn finished: succeeded'),
      `the turn did not end succeeded; log:\n${text}`,
    );
  });

  /**
   * Model and agent selectors (issues #23/#24) against a REAL opencode: a prompt that carries
   * `opencode/glm-5.3-flash-free` and `plan` is validated against the catalog the host loaded from
   * `model.list` / `agent.list`, the session is switched with the real `switchAgent` and
   * `switchModel` routes, and the turn ends `succeeded`.
   *
   * Protects: the four catalog GETs and the two switch routes existing in the real server with the
   * bodies the host sends (a 4xx would fail the send and log `request ... failed`), and that the
   * order is switch, then prompt. The model is one of the ten free ones the planner's spike listed
   * (opencode 2.0.32, Windows 11, 21/10/2026); free models change over time, so when the host
   * REFUSES it (`ModelUnavailable`: the real catalog no longer lists it) the case is skipped with
   * the reason, not failed. It runs in the session the previous cases left open, so the agent
   * really changes (`build` -> `plan`). The reply text is not asserted; the visible proof
   * ("Plan · <model>" under the reply) is `test:visual` step 11. Needs network and the free model.
   */
  it('applies a chosen model and agent before the prompt', async function () {
    this.timeout(TURN_WAIT_MS + READY_WAIT_MS);
    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'integration-model-1',
      text: 'Reply with exactly: hello there',
      delivery: 'queue',
      files: [],
      model: { providerID: 'opencode', id: 'glm-5.3-flash-free' },
      agent: 'plan',
    });
    // Either the prompt is accepted, or the host refused the choice before touching the server.
    const deadline = Date.now() + 15_000;
    while (
      !log.added().includes('prompt accepted for ses_') &&
      !log.added().includes('prompt integration-model-1 rejected: ') &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (log.added().includes('prompt integration-model-1 rejected: ModelUnavailable')) {
      console.log('SKIP: opencode/glm-5.3-flash-free is not in the real catalog any more');
      this.skip();
    }
    await log.waitFor('prompt accepted for ses_', 1_000);
    await log.waitFor('turn finished: ', TURN_WAIT_MS);
    const text = log.added();
    assert.ok(
      text.includes('agent selected plan for ses_'),
      `the agent was not switched to plan; log:\n${text}`,
    );
    assert.ok(
      text.includes('model selected opencode/glm-5.3-flash-free for ses_'),
      `the model was not switched; log:\n${text}`,
    );
    assert.ok(
      text.indexOf('model selected') < text.indexOf('prompt accepted'),
      `the choice must be applied BEFORE the prompt; log:\n${text}`,
    );
    assert.ok(text.includes('turn finished: succeeded'), `the turn did not succeed; log:\n${text}`);
  });

  /**
   * Reasoning variant (issue #61) against a REAL opencode: a prompt that carries
   * `opencode/glm-5.3-flash-free` with variant `low` switches the session through the real
   * `switchModel` route (the model is already the session's, so only the variant changes), and the
   * turn runs with it and ends `succeeded`.
   *
   * Protects: the variant reaching `switchModel` (the host logs `model selected … (variant low)`
   * only after the call returned) BEFORE the prompt, and the turn not dying with the server's
   * `VariantUnavailableError` ("Variant unavailable for p/m: x", raised when the turn runs, read in
   * `model-resolver.ts@843a6c51`, never seen here before). The model and its variants come from
   * the planner spike (glm-5.3-flash-free: low/high/max, opencode 2.0.32, Windows 11,
   * 21/10/2026); free models change over time, so when the host REFUSES it (`ModelUnavailable` or
   * `VariantUnavailable`) the case is skipped with the reason, not failed. Runs in the session
   * the previous cases left open. The reply text is not asserted; the visible proof ("· low"
   * under the reply) is `test:visual` step 14. Needs network and the free model.
   *
   * VERIFIED on Windows 11, VS Code 1.143.0, opencode 2.0.32, on 22/10/2026 ~09:50 (run of the
   * `real-opencode` label on the final tree, 11 passing; OpenCode.log read afterwards): `model
   * selected opencode/glm-5.3-flash-free for ses_… (variant low)` at 09:50:12.869, then `prompt
   * accepted` at 09:50:12.874 and `turn finished: succeeded` at 09:50:28.212, so the real server
   * took the variant and `VariantUnavailableError` did not show up. NOT observed: that error
   * itself (no unlisted variant was sent to a real server), macOS and Linux (UNVERIFIED).
   */
  it('applies a chosen reasoning variant before the prompt', async function () {
    this.timeout(TURN_WAIT_MS + READY_WAIT_MS);
    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'integration-variant-1',
      text: 'Reply with exactly: hello there',
      delivery: 'queue',
      files: [],
      model: { providerID: 'opencode', id: 'glm-5.3-flash-free', variant: 'low' },
    });
    const deadline = Date.now() + 15_000;
    while (
      !log.added().includes('prompt accepted for ses_') &&
      !log.added().includes('prompt integration-variant-1 rejected: ') &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const refused =
      /prompt integration-variant-1 rejected: (ModelUnavailable|VariantUnavailable)/.exec(
        log.added(),
      );
    if (refused !== null) {
      console.log(
        `SKIP: the real catalog does not offer glm-5.3-flash-free@low (${refused[1] ?? ''})`,
      );
      this.skip();
    }
    await log.waitFor('prompt accepted for ses_', 1_000);
    await log.waitFor('turn finished: ', TURN_WAIT_MS);
    const text = log.added();
    assert.ok(
      text.includes('model selected opencode/glm-5.3-flash-free for ses_'),
      `the model was not switched; log:\n${text}`,
    );
    assert.ok(text.includes('(variant low)'), `the variant was not applied; log:\n${text}`);
    assert.ok(
      text.indexOf('(variant low)') < text.indexOf('prompt accepted'),
      `the variant must be applied BEFORE the prompt; log:\n${text}`,
    );
    assert.ok(text.includes('turn finished: succeeded'), `the turn did not succeed; log:\n${text}`);
  });

  /**
   * Stop (issue #16) against a REAL opencode: a long prompt is interrupted mid-turn through the
   * same `session.abort` message the Stop button sends, and the server confirms it.
   *
   * Protects: the v2 route (`POST /api/session/:id/interrupt`, not the v1 `/abort` the issue
   * cites), the BARE `{interrupted}` body (a wrapped read would give `undefined` and log
   * `interrupted: undefined`), and the `session.execution.interrupted` event reaching the turn log.
   * The session id is read from the `prompt accepted for ses_...` line. The 1500 ms wait lets the
   * turn start before the interrupt; if the model were fast enough to finish a 400-number list in
   * that time the test would see `interrupted: false` and fail (our own choice, flaky only on an
   * absurdly fast model; not observed). Needs network and the free model, like the test above.
   */
  it('interrupts a long turn with session.abort', async function () {
    this.timeout(TURN_WAIT_MS + READY_WAIT_MS);
    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'integration-abort-1',
      text: 'Count from 1 to 400, one number per line. Do not stop early.',
      delivery: 'queue',
      files: [],
    });
    await log.waitFor('prompt accepted for ses_', 10_000);
    const sessionID = /prompt accepted for (ses_\S+)/.exec(log.added())?.[1];
    assert.ok(sessionID, `no session id in the log:\n${log.added()}`);
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'session.abort',
      requestId: 'integration-abort-2',
      sessionID,
    });
    await log.waitFor(`abort requested for ${sessionID} (interrupted: true)`, 10_000);
    await log.waitFor(`turn finished: interrupted for ${sessionID}`, 15_000);
  });

  /**
   * `@` mention search (issue #28) against a REAL opencode: `files.search` reaches
   * `GET /api/fs/find`, the answer is mapped and the host logs `file search: N results` with N >= 1
   * for a file that exists in the served folder; and a prompt that mentions that file (its `uri`
   * is built here the way the host builds it, `pathToFileURL`) is accepted by the whitelist
   * (`offeredUris`) and by the server, with a `mention`, and the turn ends `succeeded`.
   *
   * Protects: the v2 route and its `{location, data}` answer (the issue text cites the v1
   * `/find/file`), the `type: 'file'` and `limit` query, and the real server accepting
   * `files[].mention`. The search is retried for up to 25 s: the real server refreshes its file
   * index every 10 s (read in `search.ts@843a6c51`), so a file written a moment ago may not be
   * listed yet; 25 s and the 2 s pause are our own choices. Writes `src/sample.ts` into the
   * temporary workspace folder (the fake-server suite has its own file with the same name in
   * its fixed workspace folder). Needs network and the free model for
   * the turn. The reply text is not asserted.
   */
  it('finds a file with files.search and sends a prompt that mentions it', async function () {
    this.timeout(TURN_WAIT_MS + READY_WAIT_MS);
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(folder, 'no workspace folder is open');
    const file = path.join(folder, 'src', 'sample.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');

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
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    assert.ok(
      /file search: [1-9]\d* results/.test(log.added()),
      `no search returned a result for "sample" in ${attempt} attempts; log:\n${log.added()}`,
    );

    const text = 'Reply with exactly: OK. Do not use any tools. See @src/sample.ts';
    const marker = '@src/sample.ts';
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'integration-mention-1',
      text,
      delivery: 'queue',
      files: [
        {
          uri: pathToFileURL(file).href,
          name: 'src/sample.ts',
          mention: {
            start: text.indexOf(marker),
            end: text.indexOf(marker) + marker.length,
            text: marker,
          },
        },
      ],
    });
    await log.waitFor('prompt accepted for ses_', 10_000);
    await log.waitFor('turn finished: ', TURN_WAIT_MS);
    const added = log.added();
    assert.ok(!added.includes('rejected: an attachment'), `the file was refused; log:\n${added}`);
    assert.ok(
      added.includes('turn finished: succeeded'),
      `the turn did not succeed; log:\n${added}`,
    );
  });

  /**
   * Editor context (issue #29) against a REAL opencode and a real folder: the selection of the open
   * file becomes one reference with its line range, and a prompt that carries that reference
   * (built with the same `toEditorRef` the host uses, `?start=1&end=2`) is accepted by the host and
   * by the real server, and the turn ends `succeeded`.
   *
   * Protects: `attachments.fromEditor` inside a folder (the unit-tested name/URL logic with a real
   * `TextEditor`), and the real server taking a `file://…?start&end` URL. What the model DID with
   * the range is not asserted (the reply is free text); the spike of the planner saw the stored
   * `data` hold exactly the selected lines. Depends on `src/sample.ts` from the case above.
   */
  it('adds the selection of the active file and sends it with its line range', async function () {
    this.timeout(TURN_WAIT_MS + READY_WAIT_MS);
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(folder, 'no workspace folder is open');
    const file = path.join(folder, 'src', 'sample.ts');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 1, 5);

    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'attachments.fromEditor',
      requestId: 'integration-context-1',
    });
    await log.waitFor('editor context added: 0 file(s), 1 selection(s)', 8_000);

    const ref = toEditorRef(folder, file, { start: 1, end: 2 });
    assert.strictEqual(ref.name, 'src/sample.ts#1-2');
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'integration-context-2',
      text: 'Reply with exactly: OK. Do not use any tools.',
      delivery: 'queue',
      files: [ref],
    });
    await log.waitFor('prompt accepted for ses_', 10_000);
    await log.waitFor('turn finished: ', TURN_WAIT_MS);
    const added = log.added();
    assert.ok(!added.includes('rejected: an attachment'), `the range was refused; log:\n${added}`);
    assert.ok(
      added.includes('turn finished: succeeded'),
      `the turn did not succeed; log:\n${added}`,
    );
  });

  // The editor-context cases that only need a served folder (whole file, several selections, dirty
  // buffer, OutsideWorkspace) and the `editor.open` case moved to `fakeServer.test.ts` (issue #41):
  // they never used the real server, and there they run in CI. The case above stays because it
  // checks the real server accepting a `file://…?start&end` reference.

  // ---------------------------------------------------------------------------------------------
  // Phase 3 (issues #18, #44, #19, #10). These cases depend on the free model CHOOSING to use the
  // `read` or `question` tool, which a prompt cannot force: a failure to see `permission asked` or
  // `form asked` may be the model, not the extension (the assertion message carries the log so
  // the two can be told apart). They NEVER send `always`: that writes a rule into the opencode
  // database of whoever runs the suite (with `read` it is `read *`, which allows reading every
  // file of the project, `.env` included, from then on).
  // ---------------------------------------------------------------------------------------------

  /** Writes the `.env` that the permission prompts ask to read (opencode asks before reading it). */
  function writeEnvFile(): void {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(folder, 'no workspace folder is open');
    fs.writeFileSync(path.join(folder, '.env'), 'OPEN_VS_CODE_TEST=1\n');
  }

  const READ_ENV_PROMPT =
    'Use the read tool to read the file .env in the current folder and reply with its first line.';

  /** `matchInLog` with the hint that, against the real server, a missing line may be the model. */
  function matchInLog(
    log: LogCursor,
    pattern: RegExp,
    timeoutMs: number,
    what: string,
  ): Promise<RegExpExecArray> {
    return sharedMatchInLog(
      log,
      pattern,
      timeoutMs,
      what,
      ' (the model may not have used the tool)',
    );
  }

  /**
   * Hidden view (issue #19): a permission asked while the chat is not on screen raises the badge
   * and ONE notification, and answering it from a command closes both by themselves.
   *
   * The Explorer is shown to hide the chat container. The prompt asks to read `.env`, the one
   * file that opencode v2 asks permission for with its default rules (`read *.env` is `ask`, read
   * in `packages/schema/src/agent.ts@v2.0.32`). The answer is a REJECT through the internal
   * command of the notification link (`Allow once` would work too; reject avoids the file being
   * read). Waits for `resolved: reject` and the closing lines; the model then goes on without the
   * file, so the turn ends (any outcome is accepted). NOT verified here: that the toast looks
   * right or that its links render (F5 point 4).
   */
  it('a permission asked with the view hidden raises the badge and one notification, and closes them on reject', async function () {
    this.timeout(TURN_WAIT_MS + READY_WAIT_MS);
    writeEnvFile();
    await vscode.commands.executeCommand('workbench.view.explorer');
    // Give VS Code a moment to report the chat view as hidden before the request arrives.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const log = await openLogCursor();
    await sendPrompt(log, READ_ENV_PROMPT);
    const asked = await matchInLog(
      log,
      /permission asked (per_\S+) for (ses_\S+) \(read\)/,
      TURN_WAIT_MS,
      'permission asked',
    );
    const [, permissionID, sessionID] = asked;
    assert.ok(permissionID && sessionID, 'ids missing from the log line');
    await log.waitFor('attention: badge 1', 5_000);
    await log.waitFor(`attention: notified ${permissionID}`, 5_000);
    assert.strictEqual(
      (log.added().match(/attention: notified /g) ?? []).length,
      1,
      `expected exactly one notification for the request; log:\n${log.added()}`,
    );

    await vscode.commands.executeCommand(REPLY_PERMISSION_COMMAND_ID, {
      sessionID,
      permissionID,
      decision: 'reject',
    });
    await log.waitFor(`permission ${permissionID} resolved: reject`, 10_000);
    await log.waitFor(`attention: closed ${permissionID} (resolved)`, 5_000);
    await log.waitFor('attention: badge 0', 5_000);
    await log.waitFor('turn finished:', TURN_WAIT_MS);
  });

  /**
   * Visible view: the same request raises NO notification (the card is right there), and an
   * "allow once" sent as the webview would lets the turn finish.
   *
   * The container is revealed first and `webview ready` awaited, so the plan's rule "notify only
   * when the view is not visible" is exercised against a view that really is. The reply goes
   * through the injected `permission.reply` message (the same path as the card's button).
   */
  it('a permission asked with the view visible raises no notification and allow once finishes the turn', async function () {
    this.timeout(TURN_WAIT_MS + READY_WAIT_MS);
    writeEnvFile();
    const log = await openLogCursor();
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    await log.waitFor('webview ready', 8_000);
    await sendPrompt(log, READ_ENV_PROMPT);
    const asked = await matchInLog(
      log,
      /permission asked (per_\S+) for (ses_\S+) \(read\)/,
      TURN_WAIT_MS,
      'permission asked',
    );
    const [, permissionID, sessionID] = asked;
    assert.ok(permissionID && sessionID, 'ids missing from the log line');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    log.assertAbsent('attention: notified');
    await log.waitFor('attention: badge 1', 5_000);

    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'permission.reply',
      requestId: 'integration-allow-once',
      sessionID,
      permissionID,
      decision: 'once',
    });
    await log.waitFor(`permission reply sent for ${permissionID} (once)`, 10_000);
    await log.waitFor(`permission ${permissionID} resolved: once`, 10_000);
    await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
  });

  /**
   * A question (issue #44): the tool `question` creates a form and the session WAITS until it is
   * answered; answering lets the turn finish.
   *
   * Confirms the HYPOTHESIS of the plan that, without an answer, no `turn finished` line appears
   * (3 s of watching: an absence cannot be proven instantly, so the number is our own choice).
   * The answer is `{ q0: "A" }`; if the server insists the field is a list (a multiselect), the
   * test retries once with `["A"]`, and the log shows which one the server accepted.
   * Depends on the free model using the `question` tool, like the cases above.
   */
  it('a question waits for its answer, and answering lets the turn finish', async function () {
    this.timeout(TURN_WAIT_MS + READY_WAIT_MS);
    const log = await openLogCursor();
    await sendPrompt(
      log,
      'Use the question tool to ask me to choose between A and B, then reply with my choice.',
    );
    const asked = await matchInLog(
      log,
      /form asked (frm_\S+) for (ses_\S+)/,
      TURN_WAIT_MS,
      'form asked',
    );
    const [, formID, sessionID] = asked;
    assert.ok(formID && sessionID, 'ids missing from the log line');
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    log.assertAbsent('turn finished');

    const answer = (value: string | string[], requestId: string) =>
      vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
        type: 'form.reply',
        requestId,
        sessionID,
        formID,
        answer: { q0: value },
      });
    await answer('A', 'integration-answer-1');
    const outcome = await matchInLog(
      log,
      /form frm_\S+ resolved: answered|request integration-answer-1 failed: \S+/,
      10_000,
      'the answer to be accepted',
    );
    if (outcome[0].startsWith('request integration-answer-1 failed')) {
      await answer(['A'], 'integration-answer-2');
    }
    await log.waitFor(`form ${formID} resolved: answered`, 10_000);
    await log.waitFor('turn finished:', TURN_WAIT_MS);
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
   * External server (issue #11) against a REAL opencode: the test starts a second `opencode serve
   * --stdio` itself, with a known password, and points `openVsCode.serverUrl` at it. The
   * extension must stop its own server, check `GET /api/info` with Basic `opencode:<password>`,
   * report the connection with the pinned version, and run a real turn through it. A wrong
   * password must be refused by the REAL server (a genuine 401), which the synthetic fixture of
   * `externalServer.test.ts` cannot prove.
   *
   * Last on purpose: it swaps the server the cases above share, and puts the profile back at the
   * end (the setting emptied and the password forgotten make the extension launch its own server
   * again with the binary it already detected; that relaunch is not awaited here). Both servers
   * use the SAME database (the redirected XDG dirs of
   * the configuration), so the session the earlier cases left open exists on the external one too.
   * The reply text is not asserted. Needs network and the free default model, like the cases above.
   *
   * VERIFIED on Windows 11, VS Code 1.143.0, real opencode 2.0.32, 22/10/2026 (suite of 12, all
   * passing): the log showed "connected to the external server at http://127.0.0.1:<port>
   * (opencode 2.0.32)", "prompt accepted for ses_...", "turn finished: succeeded for ses_...", and,
   * after the wrong password, "could not connect to the external server at ...: GET /api/info
   * failed: HTTP 401" followed by "server not available (unauthorized)". NOT covered here: a
   * refused connection or a timeout against a real opencode (the refusal is in
   * `externalServer.test.ts`, against the fixture), and macOS/Linux (UNVERIFIED).
   */
  it('connects to an external real opencode, and a wrong password is refused', async function () {
    this.timeout(READY_WAIT_MS + TURN_WAIT_MS + 30_000);
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(folder, 'no workspace folder is open');
    const password = 'real-external-pw';
    const child = spawn(binary, ['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0'], {
      cwd: folder,
      env: { ...process.env, OPENCODE_PASSWORD: password },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    child.stderr.resume();
    const quiet = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    };
    try {
      const origin = await readUrlLine(child.stdout, READY_WAIT_MS, quiet);
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

      await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
        type: 'prompt.send',
        requestId: 'integration-external-1',
        text: 'Reply with exactly: hello there',
        delivery: 'queue',
        files: [],
      });
      await log.waitFor('prompt accepted for ses_', 10_000);
      await log.waitFor('turn finished: ', TURN_WAIT_MS);
      assert.ok(
        log.added().includes('turn finished: succeeded'),
        `the turn through the external server did not succeed; log:\n${log.added()}`,
      );

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
      child.stdin.end();
      // Back-up (S5 of the review): a real opencode that ignores the EOF must not outlive the run.
      if (!(await waitForExit(child, 10_000))) {
        await killTree(child, quiet);
        await waitForExit(child, 10_000);
      }
    }
  });
});
