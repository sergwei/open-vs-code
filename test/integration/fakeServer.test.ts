// Fake server suite (issue #41): the extension runs the SYNTHETIC opencode as its own server.
//
// Protects: the whole own-server path inside a real VS Code with a workspace folder (the setting
// -> binary detection -> server manager -> spawn -> `{url}` line -> `GET /api/info` -> event stream
// -> turn), the permission and question flows, restart and crash recovery, and the editor-context
// cases that need a served folder. Until issue #41 those ran only in the opt-in `real-opencode`
// suite, which needs a network and a model and never runs in CI; here they run on the three
// operating systems without either. Since tooling/tests-without-model the real-opencode suite
// sends no prompt at all, so every turn case lives here (this includes model and agent selection
// and the reasoning variant); only what a real server alone can show (its API shapes without a
// turn, the real 401 of an external server) stays there.
//
// What this is NOT: evidence about the real opencode. The server is `fake-opencode.mjs`, written
// from what was read in opencode 2.0.32 and from spikes (see its header); the timings, ids and
// texts are invented. A case that passes here proves our wiring, not that the real server answers
// like this. `realOpencode.test.ts` is the check against the real thing.
//
// How the fixture is launched: `.vscode-test.mjs` writes `openVsCode.opencodePath` into the
// profile BEFORE VS Code starts, pointing at `fake-opencode.mjs`, and sets `OPEN_VS_CODE_TEST_NODE`;
// the Test-mode seam of `src/extension/testLaunch.ts` then runs the `.mjs` through Node, both for
// `--version` and for `serve`. The path of a real `.exe` or shim is NOT exercised here (unit tests
// and `real-opencode` do).
//
// Order matters: the cases share one server and one session, and the last two (restart, kill)
// replace the server. After waiting for a FINAL state that several triggers can move (a turn's end,
// a crash restart), a case pauses `SETTLE_MS` and asserts the opposite transition is absent
// (vscode-extension skill, section 11).
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import { toEditorRef } from '../../src/extension/fileMentions';
import { EMPTY_TITLE } from '../../src/shared/sessionLabel';
import {
  ADD_SELECTION_TO_CHAT_COMMAND_ID,
  ADD_TO_CHAT_COMMAND_ID,
  EXPLAIN_FILES_COMMAND_ID,
  EXPLAIN_SELECTION_COMMAND_ID,
  DELETE_SESSION_COMMAND_ID,
  FIX_SELECTION_COMMAND_ID,
  INJECT_WEBVIEW_MESSAGE_COMMAND_ID,
  NEW_SESSION_COMMAND_ID,
  OPEN_SESSION_COMMAND_ID,
  RENAME_SESSION_COMMAND_ID,
  REPLY_PERMISSION_COMMAND_ID,
  RESTART_SERVER_COMMAND_ID,
  RESTORE_CHAT_TAB_TEST_COMMAND_ID,
  SESSION_DIFF_SCHEME,
  SHOW_REQUEST_COMMAND_ID,
  STOP_RESPONSE_COMMAND_ID,
  TEST_SESSION_ANSWERS_COMMAND_ID,
  VIEW_CONTAINER_ID,
} from '../../src/extension/ids';
import { PINNED_OPENCODE_VERSION } from '../../src/extension/opencodeServer';
import {
  chatTabs,
  restoreChatLocation,
  setChatLocation,
  waitForChatTabs,
} from './support/chatLocation';
import { openLogCursor, openLogFromStart, type LogCursor } from './support/extensionLog';
import {
  lastReadyPid,
  matchInLog,
  openSample,
  SAMPLE_TS,
  sendPrompt,
  sleep,
  waitUntilGone,
  workspaceFolderPath,
} from './support/serverCases';

const EXTENSION_ID = 'sergwei.open-vs-code';
// Above STARTUP_TIMEOUT_MS (30 s) of the extension, so a start that really hangs fails with the
// extension's own error in the log, not with ours. The fixture boots in well under a second.
const READY_WAIT_MS = 35_000;
// A fixture turn takes 15 ms per event (about 0.3 s; SLOW: about 5 s). 20 s is our own choice and
// leaves room for a slow CI runner.
const TURN_WAIT_MS = 20_000;
// Margin before asserting that a transition did NOT happen. Our own choice: longer than the 1 s of
// the first crash backoff and than the flush delay of the log (100 ms), short enough not to add
// minutes.
// Every remaining use of `SETTLE_MS` is either a NEGATIVE window (it precedes an `assertAbsent` or
// a count that must not grow: absence cannot be waited for, so it stays fixed) or the pause after
// "OpenCode: New Session" in the side bar, whose round trip through the webview logs nothing to
// wait on. The pauses that preceded a `mark()` and a positive wait now use `log.waitForQuiet()`
// (tooling/test-speed phase 1).
const SETTLE_MS = 1_500;

/** Counts the occurrences of `text` in what the log gained since its mark. */
function countOf(log: LogCursor, text: string): number {
  return log.added().split(text).length - 1;
}

describe('fake server', function () {
  this.timeout(60_000);
  // The session of the edit turn (issue #31), for the case that follows it: they share the server.
  let editedSessionID: string | undefined;

  before(async function () {
    // Fails loudly (not a skip) when run through the wrong configuration: this suite is not opt-in.
    workspaceFolderPath();
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);
    await extension.activate();
  });

  /**
   * The extension starts the fixture as its own server and reports it ready on a real port.
   *
   * Protects: the Test-mode seam end to end (a `.mjs` setting is accepted by the detection and
   * launched by the manager), `--port 0` resolving to the fixture's real port, and the pinned
   * version check. The profile's setting is written before VS Code starts, so the FIRST detection
   * already sees the fixture; the assertion on `binary detection: setting ...: ok` is what proves
   * the server came from the setting and not from a PATH binary.
   */
  it('starts the fixture as its own server and reports it ready', async function () {
    const folder = workspaceFolderPath();
    const log = await openLogFromStart();
    await log.waitFor('server ready at http://127.0.0.1:', READY_WAIT_MS);
    const text = log.added();
    assert.ok(
      text.includes(`starting the server for ${folder} with `),
      `the server was not started for ${folder}; log:\n${text}`,
    );
    assert.ok(
      /binary detection: setting .*fake-opencode\.mjs: ok/.test(text),
      `the fixture was not detected as ok through the setting; log:\n${text}`,
    );
    const ready = /server ready at http:\/\/127\.0\.0\.1:(\d+) \(opencode (\S+), pid (\d+)\)/.exec(
      text,
    );
    assert.ok(ready, `ready line not in the expected shape; log:\n${text}`);
    assert.notStrictEqual(Number(ready[1]), 0, '--port 0 must resolve to the real port');
    assert.strictEqual(ready[2], PINNED_OPENCODE_VERSION);
    assert.ok(!text.includes('printed port 0'), `plan B (port 0) triggered; log:\n${text}`);
  });

  /**
   * A prompt injected as the webview would is accepted and the turn ends `succeeded`, once.
   *
   * Protects: the view loading, the SSE connection and the prompt path against the fixture. The
   * `interrupted` and `failed` outcomes must be absent after the margin: the turn has one end.
   */
  it('streams a prompt to the end', async function () {
    const log = await openLogFromStart();
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    await log.waitFor('webview ready', 8_000);
    await log.waitFor('event stream connected', 10_000);
    log.mark();
    await sendPrompt(log, 'Reply with exactly: hello there');
    await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
    await sleep(SETTLE_MS);
    assert.strictEqual(countOf(log, 'turn finished:'), 1, `log:\n${log.added()}`);
    log.assertAbsent('turn finished: interrupted');
    log.assertAbsent('turn finished: failed');
  });

  /**
   * Model and agent selectors (issues #23/#24): a prompt that carries `opencode/glm-5.3-flash-free`
   * and `plan` is validated against the catalog the host loaded from `model.list` / `agent.list`,
   * the session is switched with the `switchAgent` and `switchModel` routes, and the turn ends
   * `succeeded`.
   *
   * This is the twin of the case that used to run in `realOpencode.test.ts` with a real model: it
   * moved here when that suite stopped sending prompts (tooling/tests-without-model). Protects: the
   * order (the choice is applied BEFORE the prompt) and the host's use of the catalog against a
   * server that answers the four GETs and the two switch routes the way the fixture copied them
   * from the planner's spikes. It does NOT show that a real server takes these bodies: the contract
   * cases of `realOpencode.test.ts` switch agent and model on a real server without a prompt.
   * The catalog of the fixture lists both models, so a refusal (`ModelUnavailable`) is a failure.
   */
  it('applies a chosen model and agent before the prompt', async function () {
    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'fake-model-1',
      text: 'Reply with exactly: hello there',
      delivery: 'queue',
      files: [],
      model: { providerID: 'opencode', id: 'glm-5.3-flash-free' },
      agent: 'plan',
    });
    await log.waitFor('prompt accepted for ses_', 10_000);
    await log.waitFor('turn finished: ', TURN_WAIT_MS);
    const text = log.added();
    assert.ok(text.includes('agent selected plan for ses_'), `agent not switched; log:\n${text}`);
    assert.ok(
      text.includes('model selected opencode/glm-5.3-flash-free for ses_'),
      `the model was not switched; log:\n${text}`,
    );
    assert.ok(
      text.indexOf('model selected') < text.indexOf('prompt accepted'),
      `the choice must be applied BEFORE the prompt; log:\n${text}`,
    );
    assert.ok(text.includes('turn finished: succeeded'), `the turn did not succeed; log:\n${text}`);
    log.assertAbsent('rejected: ');
  });

  /**
   * Reasoning variant (issue #61): a prompt that carries `opencode/glm-5.3-flash-free` with variant
   * `low` switches the session through `switchModel` (the model is already the session's, so only
   * the variant changes), BEFORE the prompt, and the turn ends `succeeded`.
   *
   * Twin of the real-server case that moved here (see the one above). The fixture lists `low` and
   * `high` for the model, so a `VariantUnavailable` refusal would be a regression of the host's
   * check. The host logs `model selected … (variant low)` only after the call returned. The real
   * server's `VariantUnavailableError` is not reproduced by the fixture.
   */
  it('applies a chosen reasoning variant before the prompt', async function () {
    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'fake-variant-1',
      text: 'Reply with exactly: hello there',
      delivery: 'queue',
      files: [],
      model: { providerID: 'opencode', id: 'glm-5.3-flash-free', variant: 'low' },
    });
    await log.waitFor('prompt accepted for ses_', 10_000);
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
    log.assertAbsent('rejected: ');
  });

  /**
   * Slash commands (issue #33): the catalog the host loaded lists the project command
   * `.opencode/command/hello.md` of the served folder next to the two built-ins, and a `prompt.send`
   * carrying `command: 'hello'` is run through `session.command`, the turn ending `succeeded`.
   *
   * Protects: `command.list` being read with the other catalog GETs (the log line counts three
   * commands: `init`, `review` and `hello`), the host choosing `session.command` over
   * `session.prompt` (`command accepted /hello for ses_` and NO `prompt accepted` in the added
   * lines), and the unlisted name being refused before the server (`request fake-command-2 failed:
   * CommandUnavailable`).
   * The file is written by `.vscode-test.mjs` before VS Code starts (the fixture emits no
   * `command.updated`). What it does NOT show: that a real opencode lists a `.opencode/command`
   * file the same way, which only `realOpencode.test.ts` can say, and that the expanded template
   * reaches the webview as the user message, which the e2e test and `test:visual` cover.
   */
  it('lists the project commands in the catalog and runs one with arguments', async function () {
    const start = await openLogFromStart();
    const loaded = /catalog loaded \(\d+ models, \d+ agents, (\w+) commands\)/.exec(start.added());
    assert.ok(loaded, `no catalog line with commands yet; log:\n${start.added()}`);
    assert.strictEqual(loaded[1], '3', `expected init, review and hello; log:\n${start.added()}`);

    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'fake-command-1',
      text: 'Ana',
      delivery: 'queue',
      files: [],
      command: 'hello',
    });
    await log.waitFor('command accepted /hello for ses_', 10_000);
    await log.waitFor('turn finished: ', TURN_WAIT_MS);
    assert.ok(
      log.added().includes('turn finished: succeeded'),
      `the turn did not succeed; log:\n${log.added()}`,
    );
    log.assertAbsent('prompt accepted for');

    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'fake-command-2',
      text: '',
      delivery: 'queue',
      files: [],
      command: 'no-such-command',
    });
    await log.waitFor('request fake-command-2 failed: CommandUnavailable', 10_000);
  });

  /**
   * Stop interrupts a long (SLOW) turn through the same `session.abort` message the button sends.
   *
   * Protects: the bare `{interrupted}` body and the `session.execution.interrupted` event reaching
   * the turn log. After the margin the turn must NOT also report `succeeded`.
   */
  it('interrupts a long turn with session.abort', async function () {
    const log = await openLogCursor();
    await sendPrompt(log, 'SLOW: count to a hundred');
    const sessionID = /prompt accepted for (ses_\S+)/.exec(log.added())?.[1];
    assert.ok(sessionID, `no session id in the log:\n${log.added()}`);
    await sleep(1_000);
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'session.abort',
      requestId: 'fake-abort-1',
      sessionID,
    });
    await log.waitFor(`abort requested for ${sessionID} (interrupted: true)`, 10_000);
    await log.waitFor(`turn finished: interrupted for ${sessionID}`, 15_000);
    await sleep(SETTLE_MS);
    log.assertAbsent('turn finished: succeeded');
    assert.strictEqual(countOf(log, 'turn finished:'), 1, `log:\n${log.added()}`);
  });

  /**
   * "OpenCode: Stop Response" interrupts a running turn through the webview (issue #35).
   *
   * Protects the whole round trip host command -> `ui.command` -> the webview runs the Stop button
   * -> `session.abort` back to the host, in a real VS Code with a live webview: the other abort
   * case injects the message and never touches the iframe. The command is the only trigger, so
   * `abort requested for <session>` in the log means the webview sent it. The fixture is
   * synthetic (a SLOW turn of about 5 s); the real opencode is not involved.
   */
  it('Stop Response aborts the running turn through the webview', async function () {
    const log = await openLogCursor();
    await sendPrompt(log, 'SLOW: count to a hundred');
    const sessionID = /prompt accepted for (ses_\S+)/.exec(log.added())?.[1];
    assert.ok(sessionID, `no session id in the log:\n${log.added()}`);
    await sleep(1_000);
    await vscode.commands.executeCommand(STOP_RESPONSE_COMMAND_ID);
    await log.waitFor(`abort requested for ${sessionID} (interrupted: true)`, 10_000);
    await log.waitFor(`turn finished: interrupted for ${sessionID}`, 15_000);
    await sleep(SETTLE_MS);
    log.assertAbsent('turn finished: succeeded');
  });

  /**
   * "OpenCode: New Session" makes the next prompt start another session (issue #35).
   *
   * Protects that the command reaches the webview and ends in the lazy `session.new` of the host:
   * without it the injected prompt (no `sessionID`) goes to the open session, which the first half
   * asserts so the second half cannot pass by luck. Synthetic fixture.
   */
  it('New Session makes the next prompt create another session', async function () {
    const before = await openLogCursor();
    await sendPrompt(before, 'say hello');
    const first = /prompt accepted for (ses_\S+)/.exec(before.added())?.[1];
    await before.waitFor('turn finished:', TURN_WAIT_MS);
    const again = await openLogCursor();
    await sendPrompt(again, 'say hello again');
    assert.strictEqual(/prompt accepted for (ses_\S+)/.exec(again.added())?.[1], first);
    await again.waitFor('turn finished:', TURN_WAIT_MS);
    await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
    await sleep(SETTLE_MS);
    const after = await openLogCursor();
    await sendPrompt(after, 'say hello in a new session');
    const second = /prompt accepted for (ses_\S+)/.exec(after.added())?.[1];
    assert.ok(second, `no session id in the log:\n${after.added()}`);
    assert.notStrictEqual(second, first);
    await after.waitFor('turn finished:', TURN_WAIT_MS);
  });

  /**
   * `files.search` returns the fixture's entry for `sample`, and a prompt that mentions it is
   * accepted by the host whitelist and by the server.
   *
   * Protects: the route and the `{location, data}` mapping, the `type: 'file'` query, and the
   * `files[].mention` shape. The fixture's list is fixed (no index refresh like the real server's
   * 10 s), so one search is enough. The host logs only the NUMBER of results, so that
   * `src/sample.ts` is among them is shown through the whitelist: the only way its `file://` URL
   * (built here with `pathToFileURL`, as the host does) can reach a prompt is `offeredUris`, which
   * only a search result fills (nothing was picked), so `prompt accepted` without
   * `rejected: an attachment` means the search listed that very file. This relies on running
   * BEFORE the Add selection cases, which put the same URL in `pickedUris` for the session.
   */
  it('finds a file with files.search and sends a prompt that mentions it', async function () {
    const file = path.join(workspaceFolderPath(), 'src', 'sample.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SAMPLE_TS);
    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'files.search',
      requestId: 'fake-find-1',
      query: 'sample',
    });
    await matchInLog(log, /file search: [1-9]\d* results/, 10_000, 'a search result');

    const text = 'Reply with exactly: OK. See @src/sample.ts';
    const marker = '@src/sample.ts';
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'fake-mention-1',
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
    // Proves `src/sample.ts` was among the search results (see the header).
    log.assertAbsent('rejected: an attachment');
    await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
    await sleep(SETTLE_MS);
    log.assertAbsent('rejected: an attachment');
    log.assertAbsent('turn finished: failed');
  });

  /**
   * The selection of the active file becomes one reference with its line range, and a prompt that
   * carries it (built with the host's own `toEditorRef`) is accepted.
   *
   * Protects: `attachments.fromEditor` inside a folder, and the `file://…?start&end` reference
   * passing the host whitelist. What the model does with the range is not covered: the fixture
   * never reads files.
   */
  it('adds the selection of the active file and sends it with its line range', async function () {
    const folder = workspaceFolderPath();
    const editor = await openSample();
    editor.selection = new vscode.Selection(0, 0, 1, 5);
    const file = editor.document.uri.fsPath;

    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'attachments.fromEditor',
      requestId: 'fake-context-1',
    });
    await log.waitFor('editor context added: 0 file(s), 1 selection(s)', 8_000);

    const ref = toEditorRef(folder, file, { start: 1, end: 2 });
    assert.strictEqual(ref.name, 'src/sample.ts#1-2');
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'fake-context-2',
      text: 'Reply with exactly: OK.',
      delivery: 'queue',
      files: [ref],
    });
    await log.waitFor('prompt accepted for ses_', 10_000);
    await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
    await sleep(SETTLE_MS);
    log.assertAbsent('rejected: an attachment');
  });

  /**
   * A drop is whitelisted only for regular files of the served folder that the server also lists,
   * and what it refuses is counted in one log line.
   *
   * Protects: `attachments.drop` (issue #30) through the real host with a real `vscode.workspace.fs`:
   * the form `Uri.toString()` gives (`file:///c%3A/...` on Windows, the one VS Code writes in
   * `resourceurls`), the folder, the outside, the remote and the not-listed counts, and that the
   * accepted ref then passes the `prompt.send` whitelist. The accepted file is `src/util/helpers.ts`,
   * which no other case of this host searches, selects or attaches, so the only way its URL
   * reaches the whitelist is the drop (review of 23/10/2026, W4; `sample.ts` is already in
   * `offeredUris` and `pickedUris` by earlier cases). The message is INJECTED: this does not
   * show that VS Code delivers a real drag to the webview (it does not in the stable 1.143,
   * microsoft/vscode#339036). `file.find` is the fixture's, whose list is invented.
   */
  it('adds dropped files, counts what it refuses', async function () {
    const folder = workspaceFolderPath();
    const outside = process.env['OPEN_VS_CODE_TEST_FAKE_OUTSIDE_DIR'];
    assert.ok(
      outside,
      'OPEN_VS_CODE_TEST_FAKE_OUTSIDE_DIR is not set: run with the fake-server config',
    );
    await openSample();
    // `src/util/helpers.ts` is in the fixture's list (FIND_ENTRIES) and no other case searches,
    // selects or attaches it. Created here only if absent, and removed only if created here.
    const sample = path.join(folder, 'src', 'util', 'helpers.ts');
    const unlisted = path.join(folder, 'src', 'unlisted.ts');
    const createdSample = !fs.existsSync(sample);
    if (createdSample) {
      fs.mkdirSync(path.dirname(sample), { recursive: true });
      fs.writeFileSync(sample, 'export const d = 1;\n');
    }
    fs.writeFileSync(unlisted, 'export const u = 1;\n');
    try {
      const log = await openLogCursor();
      await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
        type: 'attachments.drop',
        requestId: 'fake-drop-1',
        uris: [
          vscode.Uri.file(sample).toString(),
          vscode.Uri.file(path.join(folder, 'src')).toString(),
          vscode.Uri.file(path.join(outside, 'outside.ts')).toString(),
          'vscode-remote://ssh-remote+box/home/u/a.ts',
          vscode.Uri.file(unlisted).toString(),
        ],
      });
      await log.waitFor(
        'dropped files added: 1, skipped: 4 (1 folder(s), 1 outside, 1 remote, 0 missing, 1 ignored)',
        10_000,
      );
      await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
        type: 'prompt.send',
        requestId: 'fake-drop-2',
        text: 'Reply with exactly: OK.',
        delivery: 'queue',
        files: [toEditorRef(folder, sample)],
      });
      await log.waitFor('prompt accepted for ses_', 10_000);
      await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
      await sleep(SETTLE_MS);
      log.assertAbsent('rejected: an attachment');
    } finally {
      fs.rmSync(unlisted, { force: true });
      if (createdSample) {
        fs.rmSync(sample, { force: true });
        try {
          fs.rmdirSync(path.dirname(sample));
        } catch {
          // The folder had other files: not ours to remove.
        }
      }
    }
  });

  /**
   * "Add to OpenCode Chat" attaches the selected Explorer files without asking the server.
   *
   * Protects: the command (issue #30, decision Q1) is registered, takes the `(clicked, selected)`
   * arguments the Explorer passes and reaches the same host checks as a drop. The right-click on
   * the menu entry itself is NOT driven (the test API cannot); the arguments are built by hand.
   */
  it('attaches the Explorer selection through Add to OpenCode Chat', async function () {
    const editor = await openSample();
    const uri = editor.document.uri;
    const log = await openLogCursor();
    await vscode.commands.executeCommand(ADD_TO_CHAT_COMMAND_ID, uri, [uri]);
    await log.waitFor(
      'dropped files added: 1, skipped: 0 (0 folder(s), 0 outside, 0 remote, 0 missing, 0 ignored)',
      10_000,
    );
  });

  /**
   * "Explain with OpenCode" of the editor menu sends the selection through the real webview.
   *
   * Protects (issue #36): the command takes the `Uri` the menu passes, the host reads the selection
   * (`0 file(s), 1 selection(s)`), hands `prompt.compose` to the pane and the REAL webview sends it
   * (`prompt accepted for ses_` can only come from the webview: the command itself sends nothing),
   * the reference passes the whitelist (no `rejected: an attachment`) and the turn ends once. The
   * right-click is NOT driven (the test API cannot; `test:visual` does it); the argument is built
   * by hand. The fixture is synthetic.
   */
  it('Explain with OpenCode sends the selection of the clicked document', async function () {
    const editor = await openSample();
    editor.selection = new vscode.Selection(1, 0, 2, 4);
    const log = await openLogCursor();
    await vscode.commands.executeCommand(EXPLAIN_SELECTION_COMMAND_ID, editor.document.uri);
    await log.waitFor('context action explain: 0 file(s), 1 selection(s)', 10_000);
    await log.waitFor('prompt accepted for ses_', 15_000);
    await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
    await sleep(SETTLE_MS);
    log.assertAbsent('rejected: ');
    log.assertAbsent('turn finished: failed');
  });

  /**
   * The menu's `Uri` wins over the active editor (risk R1 of issue #36).
   *
   * A second editor in the other column becomes the active one; Explain is run with the `Uri` of
   * the FIRST one, which holds a selection. `0 file(s), 1 selection(s)` can only be that selection:
   * had the host read the active editor (no selection) it would log `1 file(s), 0 selection(s)`.
   * What is NOT shown: a real right-click on the non-active side of a split (the argument is
   * built by hand), and two editors on the same document.
   */
  it('reads the editor of the clicked document, not the active one', async function () {
    const folder = workspaceFolderPath();
    const other = path.join(folder, 'src', 'other.ts');
    fs.writeFileSync(other, 'export const other = 1;\n');
    try {
      const editor = await openSample();
      editor.selection = new vscode.Selection(0, 0, 1, 5);
      const second = await vscode.workspace.openTextDocument(vscode.Uri.file(other));
      await vscode.window.showTextDocument(second, vscode.ViewColumn.Two);
      assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, other);
      const log = await openLogCursor();
      await vscode.commands.executeCommand(EXPLAIN_SELECTION_COMMAND_ID, editor.document.uri);
      await log.waitFor('context action explain: 0 file(s), 1 selection(s)', 10_000);
      log.assertAbsent('1 file(s), 0 selection(s)');
      await log.waitFor('turn finished:', TURN_WAIT_MS);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      fs.rmSync(other, { force: true });
    }
  });

  /**
   * "Fix with OpenCode" on a file with a real TypeScript error.
   *
   * Protects (issue #36): that `vscode.languages.getDiagnostics` has an error for a `.ts` file in
   * the test profile (`--disable-extensions`; the built-in TypeScript language features are what
   * produces it), which is the premise of decision P4=1, and that Fix then runs through the real
   * webview (`context action fix: 1 file(s), 0 selection(s)`, `prompt accepted for ses_`). The
   * LOG cannot show the text, so that the diagnostic line is in the prompt is covered by the unit
   * tests of `contextPrompts` and `chatController`, not here. Waits up to 40 s for the language
   * service, our own margin for a cold start on a slow runner.
   */
  it('Fix with OpenCode runs on a file the TypeScript server reports an error for', async function () {
    this.timeout(90_000);
    const file = path.join(workspaceFolderPath(), 'src', 'broken.ts');
    fs.writeFileSync(file, "export const broken: number = 'text';\n");
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await vscode.window.showTextDocument(document);
      const deadline = Date.now() + 40_000;
      let found = vscode.languages.getDiagnostics(document.uri);
      while (found.length === 0 && Date.now() < deadline) {
        await sleep(500);
        found = vscode.languages.getDiagnostics(document.uri);
      }
      assert.ok(
        found.some((d) => d.severity === vscode.DiagnosticSeverity.Error),
        `no TypeScript error for broken.ts after 40 s: ${JSON.stringify(found.map((d) => d.message))}`,
      );
      const log = await openLogCursor();
      await vscode.commands.executeCommand(FIX_SELECTION_COMMAND_ID, document.uri);
      await log.waitFor('context action fix: 1 file(s), 0 selection(s)', 10_000);
      await log.waitFor('prompt accepted for ses_', 15_000);
      await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
      log.assertAbsent('rejected: ');
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      fs.rmSync(file, { force: true });
    }
  });

  /**
   * "Add to OpenCode Chat" of the editor menu attaches the selection and sends nothing.
   *
   * Protects (issue #36): `0 file(s), 1 selection(s)` and NO `prompt accepted` after a margin (the
   * entry only adds a chip; sending is for Explain and Fix). Whether the chip shows is
   * `test:visual`'s to say.
   */
  it('Add to OpenCode Chat from the editor attaches the selection and sends nothing', async function () {
    const editor = await openSample();
    editor.selection = new vscode.Selection(0, 0, 0, 6);
    const log = await openLogCursor();
    await vscode.commands.executeCommand(ADD_SELECTION_TO_CHAT_COMMAND_ID, editor.document.uri);
    await log.waitFor('context action add: 0 file(s), 1 selection(s)', 10_000);
    await sleep(SETTLE_MS);
    log.assertAbsent('prompt accepted');
  });

  /**
   * Explorer "Explain with OpenCode" with a folder in the multi-selection: one prompt, the folder
   * counted and skipped.
   *
   * Protects (issue #36, decision P8=1): `1 file(s), 0 selection(s)`, the skipped-count line
   * (`skipped 1 (1 folder(s), 0 outside, 0 remote, 0 missing)`) and that the one file is sent
   * through the real webview. Arguments built by hand as the Explorer passes them
   * `(clicked, selected)`.
   */
  it('Explorer Explain sends one prompt for the files and counts the folder it skipped', async function () {
    const editor = await openSample();
    const file = editor.document.uri;
    const folder = vscode.Uri.file(path.join(workspaceFolderPath(), 'src'));
    const log = await openLogCursor();
    await vscode.commands.executeCommand(EXPLAIN_FILES_COMMAND_ID, file, [file, folder]);
    await log.waitFor('context action explain: 1 file(s), 0 selection(s)', 10_000);
    await log.waitFor(
      'context action explain: skipped 1 (1 folder(s), 0 outside, 0 remote, 0 missing)',
      10_000,
    );
    await log.waitFor('prompt accepted for ses_', 15_000);
    await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
    log.assertAbsent('rejected: ');
  });

  /**
   * A document that is not on disk is refused and nothing is composed or sent.
   *
   * Protects (issue #36, P11=1): the `Uri` of an untitled document makes the host log
   * `context action explain: refused (NoFileOnDisk)` and send no prompt. The NATIVE warning that
   * the lifecycle shows is not readable by the test API, so it is not checked here (the menu does
   * not even offer the entry for untitled: `resourceScheme == file`, only reachable from the
   * palette); `test:visual` looks at the notification.
   */
  it('refuses to explain an untitled document and sends nothing', async function () {
    const document = await vscode.workspace.openTextDocument({ content: 'let x = 1;\n' });
    await vscode.window.showTextDocument(document);
    try {
      const log = await openLogCursor();
      await vscode.commands.executeCommand(EXPLAIN_SELECTION_COMMAND_ID, document.uri);
      await log.waitFor('context action explain: refused (NoFileOnDisk)', 10_000);
      await sleep(SETTLE_MS);
      log.assertAbsent('prompt accepted');
    } finally {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });

  /**
   * A pasted image is checked by its bytes, held by the host and sent as a `data:` URL.
   *
   * Protects: `attachments.image` (issue #30): a real 1x1 PNG is accepted and its opaque
   * `pasted-image:1` uri (the first image of this host) passes the prompt whitelist; JPEG bytes
   * declared as PNG are refused with `UnsupportedImage`; an invented `pasted-image:` uri is
   * refused as not emitted by the host. The fixture stores the attachment `inline` and ignores the
   * bytes: what the real server does with them is only read in code, not run.
   */
  it('accepts a pasted PNG, refuses a lying type and an invented image uri', async function () {
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'attachments.image',
      requestId: 'fake-image-1',
      mime: 'image/png',
      data: png,
    });
    await log.waitFor('image added: image/png, 0 KiB', 8_000);
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'fake-image-2',
      text: 'Reply with exactly: OK.',
      delivery: 'queue',
      files: [{ uri: 'pasted-image:1', name: 'Pasted image 1' }],
    });
    await log.waitFor('prompt accepted for ses_', 10_000);
    await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'attachments.image',
      requestId: 'fake-image-bad',
      mime: 'image/png',
      data: '/9j/4AAQ',
    });
    await log.waitFor(
      'request fake-image-bad failed: UnsupportedImage: Only PNG, JPEG, GIF and WebP images can be attached',
      8_000,
    );
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'prompt.send',
      requestId: 'fake-image-3',
      text: 'look',
      delivery: 'queue',
      files: [{ uri: 'pasted-image:99', name: 'Pasted image 99' }],
    });
    await log.waitFor('rejected: an attachment was not emitted by the host', 8_000);
  });

  // Editor context cases that need a served folder (decision W2 of Sergio, 22/10/2026: only files
  // inside it can be added). They moved here from `realOpencode.test.ts`: they never needed the
  // real server, only the folder. No turn is sent: the outcome is read from the log lines the
  // controller writes (`request <id> failed: <code>` and `editor context added: N file(s), M
  // selection(s)`).

  it('adds the whole file when nothing is selected', async function () {
    await openSample();
    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'attachments.fromEditor',
      requestId: 'fake-context-file',
    });
    await log.waitFor('editor context added: 1 file(s), 0 selection(s)', 8_000);
  });

  // The focus sits in the chat view when a user presses the button, so the view is focused first:
  // `activeTextEditor` must still be the file.
  it('adds one selection per non-empty selection while the chat view has the focus', async function () {
    const editor = await openSample();
    editor.selections = [new vscode.Selection(0, 0, 0, 4), new vscode.Selection(2, 0, 2, 4)];
    await vscode.commands.executeCommand('openVsCode.chat.focus');
    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'attachments.fromEditor',
      requestId: 'fake-context-selections',
    });
    await log.waitFor('editor context added: 0 file(s), 2 selection(s)', 8_000);
  });

  it('warns that the saved version is what the model reads when the buffer is dirty', async function () {
    const editor = await openSample();
    try {
      await editor.edit((builder) => {
        builder.insert(new vscode.Position(0, 0), 'unsaved ');
      });
      assert.strictEqual(editor.document.isDirty, true);
      const log = await openLogCursor();
      await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
        type: 'attachments.fromEditor',
        requestId: 'fake-context-dirty',
      });
      await log.waitFor('editor context: the buffer has unsaved changes', 8_000);
      await log.waitFor('editor context added: 1 file(s), 0 selection(s)', 8_000);
    } finally {
      // Back to the saved text, so later cases read the file as written.
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });

  /**
   * A file outside the served folder is refused with `OutsideWorkspace` and nothing is added.
   *
   * The file lives in a FIXED folder created and emptied by `.vscode-test.mjs` before VS Code
   * starts (`OPEN_VS_CODE_TEST_FAKE_OUTSIDE_DIR`), not in a fresh temp dir per run: the previous
   * version deleted its temp dir right after `closeAllEditors` and hit EPERM on Windows (seen in
   * `real-opencode`). HYPOTHESIS for the cause: VS Code watches the folder of a file opened outside
   * the workspace and the watcher closes asynchronously, so the handle is still alive. Here only
   * the FILE is removed, asynchronously, with retries; if that still fails a warning is printed and
   * the case passes, because the next load of the configuration wipes the folder.
   */
  it('refuses a file outside the open workspace folder (OutsideWorkspace)', async function () {
    const dir = process.env['OPEN_VS_CODE_TEST_FAKE_OUTSIDE_DIR'];
    assert.ok(
      dir,
      'OPEN_VS_CODE_TEST_FAKE_OUTSIDE_DIR is not set: run with the fake-server config',
    );
    const file = path.join(dir, 'secret.ts');
    fs.writeFileSync(file, 'export const secret = 1;\n');
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await vscode.window.showTextDocument(document);
      const log = await openLogCursor();
      await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
        type: 'attachments.fromEditor',
        requestId: 'fake-context-outside',
      });
      await log.waitFor(
        'request fake-context-outside failed: OutsideWorkspace: Only files inside the workspace folder can be added',
        8_000,
      );
      await sleep(SETTLE_MS);
      log.assertAbsent('editor context added');
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      try {
        await fs.promises.rm(file, { force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) {
        console.warn(
          `could not remove ${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  });

  /**
   * A relative `editor.open` opens the file at the requested line inside the served folder.
   *
   * Protects: resolving a RELATIVE path against the folder the server serves, and the 1-based line
   * of the protocol becoming VS Code's 0-based selection (line 3 -> index 2). Paths are compared
   * case-insensitively on Windows.
   */
  it('opens a relative file at the requested line for editor.open', async function () {
    const file = path.join(workspaceFolderPath(), 'src', 'sample.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SAMPLE_TS);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'editor.open',
      path: 'src/sample.ts',
      line: 3,
    });

    const same = (a: string, b: string): boolean =>
      process.platform === 'win32'
        ? a.toLowerCase() === b.toLowerCase()
        : path.normalize(a) === path.normalize(b);
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const editor = vscode.window.activeTextEditor;
      if (editor && same(editor.document.uri.fsPath, file)) {
        assert.strictEqual(editor.selection.active.line, 2);
        return;
      }
      await sleep(100);
    }
    assert.fail(
      `${file} did not become the active editor; active: ${vscode.window.activeTextEditor?.document.uri.fsPath ?? '(none)'}`,
    );
  });

  /**
   * An `EDIT_FILES` turn makes the host list four changed files, and `session.diff.open` opens the
   * native diff editor for a listed one: original on the left (a virtual document of the
   * extension's scheme holding the text rebuilt from the complete patch), the real file on the
   * right; a deleted file has an empty virtual document on the right (issue #31).
   *
   * Protects: the `files` of `session.step.ended` triggering the load, the content provider being
   * registered (a diff tab restored after Reload Window needs it too), the choice of the two sides
   * and the language-less virtual URI carrying only the session id. Provenance: the SYNTHETIC
   * server (its patches and `files` are the reading of the server, not a real turn).
   */
  it('lists the files an edit turn changed and opens the native diff of one', async function () {
    const file = path.join(workspaceFolderPath(), 'src', 'sample.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SAMPLE_TS);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const log = await openLogCursor();
    await sendPrompt(log, 'EDIT_FILES: change a few files');
    const listed = await matchInLog(
      log,
      /session diff: (\d+) files for (ses_\S+)/,
      TURN_WAIT_MS,
      'the changed files list',
    );
    assert.strictEqual(listed[1], '4', `log:\n${log.added()}`);
    const sessionID = listed[2];
    assert.ok(sessionID, 'session id missing from the log line');
    editedSessionID = sessionID;
    await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);

    const openDiff = async (relative: string): Promise<vscode.TabInputTextDiff> => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
        type: 'session.diff.open',
        sessionID,
        path: relative,
      });
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        if (input instanceof vscode.TabInputTextDiff) return input;
        await sleep(100);
      }
      return assert.fail(`no diff tab opened for ${relative}; log:\n${log.added()}`);
    };
    const same = (a: string, b: string): boolean =>
      process.platform === 'win32'
        ? a.toLowerCase() === b.toLowerCase()
        : path.normalize(a) === path.normalize(b);

    // Modified: the original is rebuilt from the patch; the right side is the file on disk.
    const modified = await openDiff('src/sample.ts');
    assert.strictEqual(modified.original.scheme, SESSION_DIFF_SCHEME);
    assert.ok(!modified.original.toString().includes('127.0.0.1'), 'the URI must not carry a port');
    assert.strictEqual(modified.modified.scheme, 'file');
    assert.ok(same(modified.modified.fsPath, file), `right side: ${modified.modified.fsPath}`);
    const before = await vscode.workspace.openTextDocument(modified.original);
    assert.strictEqual(
      before.getText(),
      '// Sample file for the visual test run.\nexport const value2 = 2;\n',
    );
    assert.ok(log.added().includes('diff opened (modified)'), `log:\n${log.added()}`);

    // Deleted: the original holds the removed text and the right side is an empty virtual document.
    const deleted = await openDiff('src/removed.ts');
    assert.strictEqual(deleted.modified.scheme, SESSION_DIFF_SCHEME);
    assert.strictEqual(
      (await vscode.workspace.openTextDocument(deleted.original)).getText(),
      'export const removed = true;\n',
    );
    assert.strictEqual((await vscode.workspace.openTextDocument(deleted.modified)).getText(), '');

    // Added and not on disk (the synthetic server wrote nothing): empty on both sides.
    const added = await openDiff('src/added.ts');
    assert.strictEqual((await vscode.workspace.openTextDocument(added.original)).getText(), '');
    assert.ok(log.added().includes('diff opened (added)'), `log:\n${log.added()}`);
  });

  /**
   * The host opens a diff only for a path it listed: a path outside the folder, one never listed
   * and a listed path asked for another session are refused with a log line, and no tab opens.
   *
   * Protects the whitelist (the webview is untrusted input). After the refusals the case waits and
   * asserts the editor state did not change: a late open would be the failure, not a missing one.
   */
  it('refuses to open a diff for a path it did not list', async function () {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const log = await openLogCursor();
    const sessionID = editedSessionID;
    assert.ok(sessionID, 'the previous case (the edit turn) did not run');
    for (const target of ['../outside.txt', 'src/never-listed.ts', 'C:\\Windows\\win.ini']) {
      await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
        type: 'session.diff.open',
        sessionID,
        path: target,
      });
    }
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'session.diff.open',
      sessionID: 'ses_not_the_open_one',
      path: 'src/sample.ts',
    });
    await sleep(SETTLE_MS);
    const text = log.added();
    assert.strictEqual(countOf(log, 'diff open refused:'), 4, `log:\n${text}`);
    assert.ok(!text.includes('never-listed'), 'the log must not carry the refused path');
    assert.ok(!text.includes('win.ini'), 'the log must not carry the refused path');
    assert.strictEqual(vscode.window.tabGroups.all.flatMap((group) => group.tabs).length, 0);
  });

  /**
   * Revert from a message (issue #32), the whole path against the synthetic server: the host
   * checks first (an unknown message and a session that is not the open one never reach the
   * server's `stage`), a prepared revert lists the four files it changed, the diff of what it undid
   * has the text BEFORE the revert on the left, an unlisted path opens nothing, Restore clears it,
   * and a prompt sent with a revert prepared commits it (the server does, the host forgets it).
   *
   * Protects: the `session.revert.*` messages and events through the real client and stream, the
   * whitelist of `session.revert.open`, the provider serving the `reverted` side, and the re-read
   * of an open "Changed files" diff tab when the start of the range moves (the log line `diff
   * originals renewed for <sid> (<n> open)`, pending item of #31). The final state is checked
   * with a margin and the absence of the opposite transition (lesson estado-final-no-transitorio).
   * Provenance: the SYNTHETIC server, whose revert model is read from the server code, with
   * invented files; the real server was only ever seen with an empty `files` (`realOpencode`).
   */
  it('reverts from a message, shows what it undid, restores it and commits it with a prompt', async function () {
    const sessionID = editedSessionID;
    assert.ok(sessionID, 'the edit-turn case did not run');
    // The revert starts at the FIRST user message of the shared session (the one of "streams a
    // prompt to the end"): then the start of the "Changed files" range moves, which is what makes
    // an open diff tab re-read its left side. Its id is in the log line of its accepted prompt.
    const everything = (await openLogFromStart()).added();
    const inputID = [
      ...everything.matchAll(/prompt accepted for (ses_\S+) \(input (msg_\S+)\)/g),
    ].find((match) => match[1] === sessionID)?.[2];
    assert.ok(inputID, `no accepted prompt of ${sessionID} in the log`);
    const file = path.join(workspaceFolderPath(), 'src', 'sample.ts');
    fs.writeFileSync(file, SAMPLE_TS);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const inject = (message: object): Thenable<unknown> =>
      vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, message);
    const activeDiff = async (): Promise<vscode.TabInputTextDiff> => {
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        if (input instanceof vscode.TabInputTextDiff) return input;
        await sleep(100);
      }
      return assert.fail('no diff tab opened');
    };
    const log = await openLogCursor();

    // An "OpenCode session" diff tab stays open: its provider URI is remembered for the re-read.
    await inject({ type: 'session.diff.open', sessionID, path: 'src/sample.ts' });
    const changedFilesTab = await activeDiff();
    assert.strictEqual(
      (await vscode.workspace.openTextDocument(changedFilesTab.original)).getText(),
      '// Sample file for the visual test run.\nexport const value2 = 2;\n',
    );

    // Refusals first: the server's stage must not be called.
    await inject({
      type: 'session.revert.stage',
      requestId: 'revert-unknown',
      sessionID,
      messageID: 'msg_does_not_exist',
    });
    await log.waitFor('request revert-unknown failed: MessageNotFoundError', 8_000);
    await inject({
      type: 'session.revert.stage',
      requestId: 'revert-foreign',
      sessionID: 'ses_not_the_open_one',
      messageID: inputID,
    });
    await log.waitFor('revert refused: session not open', 8_000);
    assert.ok(!log.added().includes('revert staged'), `log:\n${log.added()}`);

    // Prepare the revert from the user message of the edit turn.
    await inject({
      type: 'session.revert.stage',
      requestId: 'revert-stage',
      sessionID,
      messageID: inputID,
    });
    await log.waitFor(`revert staged for ${sessionID}: 4 files`, 8_000);
    // The range now stops before the boundary (the first user message): the start moved, so the
    // open "Changed files" tab is told to re-read its left side.
    await log.waitFor(`diff originals renewed for ${sessionID} (`, 8_000);

    // What the revert undid: left = the text before the revert (value2 = 22), right = the file.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await inject({ type: 'session.revert.open', sessionID, path: 'src/sample.ts' });
    const undone = await activeDiff();
    assert.strictEqual(undone.original.scheme, SESSION_DIFF_SCHEME);
    assert.ok(!undone.original.toString().includes('127.0.0.1'), 'the URI must not carry a port');
    assert.strictEqual(
      (await vscode.workspace.openTextDocument(undone.original)).getText(),
      '// Sample file for the visual test run.\nexport const value2 = 22;\n',
    );
    assert.strictEqual(undone.modified.scheme, 'file');
    assert.ok(log.added().includes('revert diff opened (modified)'), `log:\n${log.added()}`);

    // A path the revert did not list opens nothing.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await inject({ type: 'session.revert.open', sessionID, path: 'src/never-listed.ts' });
    await inject({ type: 'session.revert.open', sessionID, path: '../outside.txt' });
    await sleep(SETTLE_MS);
    assert.strictEqual(countOf(log, 'revert diff open refused: not listed'), 2, log.added());
    assert.ok(!log.added().includes('never-listed'), 'the log must not carry the refused path');
    assert.strictEqual(vscode.window.tabGroups.all.flatMap((group) => group.tabs).length, 0);

    // Restore: the revert is gone.
    await inject({ type: 'session.revert.clear', requestId: 'revert-clear', sessionID });
    await log.waitFor(`revert cleared for ${sessionID}`, 8_000);

    // Prepare it again and send a prompt: the server commits it, the host forgets it.
    await inject({
      type: 'session.revert.stage',
      requestId: 'revert-stage-2',
      sessionID,
      messageID: inputID,
    });
    await log.waitFor('revert staged for', 8_000);
    await sendPrompt(log, 'say hello after the revert');
    await log.waitFor(`revert committed for ${sessionID}`, 8_000);
    await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
    await sleep(SETTLE_MS);
    await inject({ type: 'session.revert.open', sessionID, path: 'src/sample.ts' });
    await sleep(SETTLE_MS);
    assert.ok(
      log.added().includes('revert diff open refused:'),
      `a committed revert must leave nothing to open; log:\n${log.added()}`,
    );
    assert.strictEqual(vscode.window.tabGroups.all.flatMap((group) => group.tabs).length, 0);
    assert.strictEqual(countOf(log, 'revert staged for'), 2, 'the commit must not stage again');
  });

  /**
   * Hidden view: a permission asked while the chat is not on screen raises the badge and ONE
   * notification, and rejecting it from the command of the notification link closes both.
   *
   * The Explorer is shown to hide the chat container. After the badge goes back to 0 the case waits
   * and asserts that neither a second badge nor a second notification appeared: the final state is
   * reached by two triggers (the reply and the end of the turn).
   */
  it('a permission asked with the view hidden raises the badge and one notification, and closes them on reject', async function () {
    await vscode.commands.executeCommand('workbench.view.explorer');
    // Give VS Code a moment to report the chat view as hidden before the request arrives.
    await sleep(1_000);
    const log = await openLogCursor();
    await sendPrompt(log, 'ASK_PERMISSION: read the env file');
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
      countOf(log, 'attention: notified '),
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
    log.mark();
    await sleep(SETTLE_MS);
    log.assertAbsent('attention: badge 1');
    log.assertAbsent('attention: notified');
  });

  /**
   * Visible view: the same request raises NO notification (the card is right there), and an
   * "allow once" sent as the webview would lets the turn finish `succeeded`, once.
   */
  it('a permission asked with the view visible raises no notification and allow once finishes the turn', async function () {
    const log = await openLogCursor();
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    await log.waitFor('webview ready', 8_000);
    await sendPrompt(log, 'ASK_PERMISSION: read the env file');
    const asked = await matchInLog(
      log,
      /permission asked (per_\S+) for (ses_\S+) \(read\)/,
      TURN_WAIT_MS,
      'permission asked',
    );
    const [, permissionID, sessionID] = asked;
    assert.ok(permissionID && sessionID, 'ids missing from the log line');
    await sleep(SETTLE_MS);
    log.assertAbsent('attention: notified');
    await log.waitFor('attention: badge 1', 5_000);

    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'permission.reply',
      requestId: 'fake-allow-once',
      sessionID,
      permissionID,
      decision: 'once',
    });
    await log.waitFor(`permission reply sent for ${permissionID} (once)`, 10_000);
    await log.waitFor(`permission ${permissionID} resolved: once`, 10_000);
    await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
    await sleep(SETTLE_MS);
    log.assertAbsent('attention: notified');
    log.assertAbsent('turn finished: interrupted');
    assert.strictEqual(countOf(log, 'turn finished:'), 1, `log:\n${log.added()}`);
  });

  /**
   * A question waits for its answer, and answering lets the turn finish.
   *
   * No `turn finished` appears while the form is open (3 s of watching: an absence cannot be proven
   * instantly, the number is our own choice); the answer `{ q0: "A" }` is accepted by the fixture
   * (an empty `q0` would be a 400) and the turn ends once.
   */
  it('a question waits for its answer, and answering lets the turn finish', async function () {
    const log = await openLogCursor();
    await sendPrompt(log, 'ASK_QUESTION: choose between A and B');
    const asked = await matchInLog(
      log,
      /form asked (frm_\S+) for (ses_\S+)/,
      TURN_WAIT_MS,
      'form asked',
    );
    const [, formID, sessionID] = asked;
    assert.ok(formID && sessionID, 'ids missing from the log line');
    await sleep(3_000);
    log.assertAbsent('turn finished');

    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'form.reply',
      requestId: 'fake-answer-1',
      sessionID,
      formID,
      answer: { q0: 'A' },
    });
    await log.waitFor(`form ${formID} resolved: answered`, 10_000);
    await log.waitFor('turn finished:', TURN_WAIT_MS);
    await sleep(SETTLE_MS);
    assert.strictEqual(countOf(log, 'turn finished:'), 1, `log:\n${log.added()}`);
    log.assertAbsent('failed:');
  });

  /**
   * The chat served from editor tabs (issue #77), end to end against the synthetic server: the
   * session of the side bar opens in a tab when the setting changes, a second tab is a lazy one,
   * opening from it a session that the first already shows REVEALS the first (no third tab), a
   * prompt injected while a tab is the target is accepted, and a "Changed files" diff opens in the
   * group of the sample file, outside the groups holding the chat tabs.
   *
   * Protects `applyLocation` (sidebar to editor with a session), `openInPane`, the dedupe through
   * `revealPane` and `targetColumn` in a real window. Provenance: the SYNTHETIC server; the
   * session ids and titles are the fixture's, so what the tab SHOWS (title text, scroll) is not
   * checked here. The diff column check is the one the header of `openSessionDiff` names: the
   * assertion "the diff did not open in the editor column" below passing is what shows that
   * `vscode.diff` honours `viewColumn` (VERIFIED on Windows 11, VS Code 1.144.0, 29/10/2026, in the
   * final `npm run test:integration` of this task).
   */
  it('opens the diff beside a chat tab, and serves prompts and session.open from tabs', async function () {
    const sample = await openSample();
    const sampleColumn = sample.viewColumn;
    assert.ok(sampleColumn, 'the sample file has no column');
    const log = await openLogCursor();
    try {
      await sendPrompt(log, 'hello from the side bar');
      const sessionID = /prompt accepted for (ses_\S+)/.exec(log.added())?.[1];
      assert.ok(sessionID, `no session id in the log:\n${log.added()}`);

      await setChatLocation('editor', log);
      await waitForChatTabs(1);
      await log.waitFor('chat tab created (pane', 8_000);
      await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
      await waitForChatTabs(2);
      await log.waitForQuiet(); // what the second tab still logs lands before the mark

      log.mark();
      await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
        type: 'session.open',
        requestId: 'tab-reveal-1',
        sessionID,
      });
      await log.waitFor('chat tab revealed (pane', 8_000);
      await sleep(SETTLE_MS);
      log.assertAbsent('chat tab created (pane');
      assert.strictEqual(chatTabs().length, 2, 'session.open opened a third tab');

      log.mark();
      await sendPrompt(log, 'EDIT_FILES: change a few files');
      const listed = await matchInLog(
        log,
        /session diff: (\d+) files for (ses_\S+)/,
        TURN_WAIT_MS,
        'the changed files list',
      );
      await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
      await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
        type: 'session.diff.open',
        sessionID: listed[2],
        path: 'src/sample.ts',
      });
      const deadline = Date.now() + 8_000;
      while (
        !(
          vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff
        )
      ) {
        assert.ok(Date.now() < deadline, `no diff tab opened; log:\n${log.added()}`);
        await sleep(100);
      }
      const chatColumns = chatTabs().map((tab) => tab.group.viewColumn);
      const diffColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
      assert.strictEqual(diffColumn, sampleColumn, 'the diff did not open in the editor column');
      assert.ok(
        !chatColumns.includes(diffColumn),
        `the diff opened in a chat column: ${String(chatColumns)}`,
      );
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await restoreChatLocation(await openLogCursor());
    }
  });

  /**
   * A chat tab revived by VS Code after Reload Window, against the synthetic server (issue #77,
   * delivery E2). The test API cannot make VS Code call the panel serializer (a real Reload kills
   * the test host), so the test-only command `RESTORE_CHAT_TAB_TEST_COMMAND_ID` creates a panel of
   * the chat view type and hands it to the SAME `ChatPanels.restore` the serializer calls. The
   * four cases below protect that path: wiring (`chat tab restored`, `webview ready`), the session
   * and title the tab ends up with, the fallback to "Untitled session" for a session that no
   * longer exists plus the host log line that the Q1 notice was sent to the tab (the notice's
   * text is inside the iframe: `test:visual` step 28), the
   * closing of a duplicate, and the `sidebar` mode. Provenance: SYNTHETIC server, fabricated
   * state `{ sessionID }` (what the webview writes is checked by `uiState.test.ts`, what VS Code
   * hands back after a real Reload is NOT checked here).
   */
  describe('a chat tab restored after Reload Window', function () {
    /** Hands a panel carrying `state` and the persisted `title` to `ChatPanels.restore`. */
    async function restoreTab(state: unknown, title: string): Promise<void> {
      await vscode.commands.executeCommand(RESTORE_CHAT_TAB_TEST_COMMAND_ID, { state, title });
    }

    /** Starts a NEW session in the side bar, answers `text` to the end and returns its id. */
    async function answeredSession(text: string): Promise<string> {
      // The command goes through the webview and comes back as `session.new`: without the pause it
      // would land AFTER the prompt and clear the session the prompt just created.
      await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
      await sleep(SETTLE_MS);
      const log = await openLogCursor();
      await sendPrompt(log, text);
      const id = /prompt accepted for (ses_\S+)/.exec(log.added())?.[1];
      assert.ok(id, `no session id in the log:\n${log.added()}`);
      await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
      return id;
    }

    /** Waits until a chat tab carries `label`; fails with the labels it did see. */
    async function waitForTabLabel(label: string): Promise<void> {
      const deadline = Date.now() + 8_000;
      while (!chatTabs().some((tab) => tab.label === label)) {
        assert.ok(
          Date.now() < deadline,
          `no tab labelled "${label}"; labels: ${JSON.stringify(chatTabs().map((t) => t.label))}`,
        );
        await sleep(100);
      }
    }

    /** Switches to `editor` and waits for the tab the session of the side bar opens in it. */
    async function toEditorWithOneTab(log: LogCursor): Promise<void> {
      await setChatLocation('editor', log);
      try {
        await waitForChatTabs(1);
      } catch (error) {
        throw new Error(`${String(error)}\nlog:\n${log.added()}`, { cause: error });
      }
    }

    afterEach(async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await restoreChatLocation(await openLogCursor());
    });

    it('restores a tab with its session and its title', async function () {
      const log = await openLogCursor();
      const sessionID = await answeredSession('Restore77 first');
      await toEditorWithOneTab(log);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await waitForChatTabs(0);
      await log.waitForQuiet(); // what the closed tab still logs lands before the mark

      log.mark();
      await restoreTab({ sessionID }, 'Seeded old title');
      await waitForChatTabs(1);
      await log.waitFor('chat tab restored (pane', 8_000);
      await log.waitFor('webview ready', 8_000);
      await waitForTabLabel('Restore77 first');
      await sleep(SETTLE_MS);
      assert.strictEqual(chatTabs().length, 1, 'the restore opened more than one tab');
      log.assertAbsent('chat tab restore skipped');
      log.assertAbsent('chat tab restore failed');
      log.assertAbsent('no longer exists');
      log.assertAbsent('chat tab created (pane');
    });

    /**
     * Protects the fallback of a tab whose session was deleted: it comes back as "Untitled session"
     * (not the title VS Code persisted), the host forgets the session, and the Q1 notice is sent
     * to that tab (log line "restored session gone: notice sent to pane"; the text it carries is
     * judged by `test:visual` step 28, R5). Synthetic server, fabricated state `{ sessionID }`.
     * UNVERIFIED in this suite: that the notice reaches the DOM of the iframe.
     */
    it('restores a tab whose session no longer exists as "Untitled session"', async function () {
      const log = await openLogCursor();
      await setChatLocation('editor', log);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await waitForChatTabs(0);
      await log.waitForQuiet(); // what the closed tab still logs lands before the mark

      log.mark();
      await restoreTab({ sessionID: 'ses_gone77' }, 'Seeded gone title');
      await waitForChatTabs(1);
      await log.waitFor('chat tab restored (pane', 8_000);
      await log.waitFor('remembered session ses_gone77 no longer exists; forgetting it', 8_000);
      // The Q1 notice itself is inside the iframe (`test:visual` step 28 reads it), but the host
      // logs when it sends it to the tab, once.
      await log.waitFor('restored session gone: notice sent to pane', 8_000);
      await waitForTabLabel(EMPTY_TITLE);
      await sleep(SETTLE_MS);
      assert.strictEqual(chatTabs().length, 1, 'the restore opened more than one tab');
      assert.ok(
        !chatTabs().some((tab) => tab.label === 'Seeded gone title'),
        'the tab kept the title of the session that is gone',
      );
      log.assertAbsent('chat tab restore skipped');
      log.assertAbsent('chat tab restore failed');
    });

    it('closes a restored tab whose session another tab already shows, and reveals that tab', async function () {
      const log = await openLogCursor();
      const sessionID = await answeredSession('Restore77 duplicate');
      await toEditorWithOneTab(log);
      await log.waitForQuiet(); // what the tab still logs lands before the mark

      log.mark();
      await restoreTab({ sessionID }, 'Seeded duplicate title');
      await log.waitFor('chat tab restore skipped: session already shown (pane', 8_000);
      await log.waitFor('chat tab revealed (pane', 8_000);
      await sleep(SETTLE_MS);
      assert.strictEqual(chatTabs().length, 1, 'the duplicate tab stayed open');
      log.assertAbsent('chat tab restored (pane');
      log.assertAbsent('chat tab restore failed');
    });

    it('restores a tab in sidebar mode that shows its session while the side bar keeps its own', async function () {
      const log = await openLogCursor();
      const tabSession = await answeredSession('Restore77 second');
      const sidebarSession = await answeredSession('Restore77 third');
      assert.notStrictEqual(tabSession, sidebarSession);

      log.mark();
      await restoreTab({ sessionID: tabSession }, 'Seeded sidebar title');
      await waitForChatTabs(1);
      await log.waitFor('chat tab restored (pane', 8_000);
      await log.waitFor('webview ready', 8_000);
      await matchInLog(
        log,
        new RegExp(`snapshot sent \\(\\d+ sessions, open ${tabSession}\\)`),
        8_000,
        'the snapshot of the restored tab',
      );
      await waitForTabLabel('Restore77 second');
      // The side bar still answers: injected messages go to ITS pane in sidebar mode.
      const prompts = await openLogCursor();
      await sendPrompt(prompts, 'Restore77 fourth');
      await prompts.waitFor('turn finished: succeeded', TURN_WAIT_MS);
      await sleep(SETTLE_MS);
      assert.strictEqual(chatTabs().length, 1, 'the restore opened more than one tab');
      log.assertAbsent('chat tab restore skipped');
      log.assertAbsent('chat tab restore failed');
    });
  });

  /**
   * The native Sessions tree (issue #77, delivery E3) against the synthetic server: what the model
   * lists (read from the stable log line `sessions view: N rows (more: …)`, the tree itself is not
   * readable by the test API), and the commands behind its rows: open, repeat, rename, delete.
   *
   * Protects: the 5th read of the full resync and the session events reaching the model; the open
   * rule (a session with a tab is revealed, never duplicated); Rename and Delete going through the
   * controller cores; and P8 (the tab of a deleted session closes). The Rename box and the Delete
   * modal are replaced by `TEST_SESSION_ANSWERS_COMMAND_ID`, so this does NOT show that the real box
   * and modal work (`test:visual` step 29 does). "Another client" is the host's own prompt in a
   * second session, not a second process: the test cannot reach the fixture's port and password.
   * Provenance: SYNTHETIC server; row counts are the fixture's.
   */
  describe('the native Sessions tree', function () {
    /** The rows of the newest `sessions view: N rows` line of `text`, or `undefined` when none. */
    function lastRows(text: string): number | undefined {
      const all = [...text.matchAll(/sessions view: (\d+) rows \(more: (true|false)\)/g)];
      const last = all[all.length - 1]?.[1];
      return last === undefined ? undefined : Number(last);
    }

    /** Starts a NEW session in the side bar, answers `text` to the end and returns its id. */
    async function newAnsweredSession(text: string): Promise<string> {
      await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
      await sleep(SETTLE_MS);
      const log = await openLogCursor();
      await sendPrompt(log, text);
      const id = /prompt accepted for (ses_\S+)/.exec(log.added())?.[1];
      assert.ok(id, `no session id in the log:\n${log.added()}`);
      await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
      return id;
    }

    /** Puts the host in `editor` mode with no tab open. */
    async function toEditorWithoutTabs(log: LogCursor): Promise<void> {
      await setChatLocation('editor', log);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await waitForChatTabs(0);
      await log.waitForQuiet(); // what the closed tab still logs lands before the caller's mark
    }

    afterEach(async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await restoreChatLocation(await openLogCursor());
    });

    it('lists the session another turn created, one more row', async function () {
      const before = lastRows((await openLogFromStart()).added());
      assert.ok(before !== undefined, 'the tree never logged a `sessions view` line');
      const log = await openLogCursor();
      await newAnsweredSession('Tree77 appears');
      await log.waitFor(`sessions view: ${String(before + 1)} rows`, 10_000);
    });

    it('opens a session in a tab once, and reveals it the second time', async function () {
      const sessionID = await newAnsweredSession('Tree77 open');
      const log = await openLogCursor();
      await toEditorWithoutTabs(log);
      log.mark();
      await vscode.commands.executeCommand(OPEN_SESSION_COMMAND_ID, sessionID);
      await waitForChatTabs(1);
      await log.waitFor('chat tab created (pane', 8_000);
      await log.waitFor('webview ready', 8_000);
      await log.waitForQuiet(); // what the new tab still logs lands before the mark

      log.mark();
      await vscode.commands.executeCommand(OPEN_SESSION_COMMAND_ID, sessionID);
      await log.waitFor('chat tab revealed (pane', 8_000);
      await sleep(SETTLE_MS);
      log.assertAbsent('chat tab created (pane');
      assert.strictEqual(chatTabs().length, 1, 'opening the same session twice made two tabs');
    });

    it('renames a session and retitles its tab', async function () {
      const sessionID = await newAnsweredSession('Tree77 rename');
      const log = await openLogCursor();
      await toEditorWithoutTabs(log);
      await vscode.commands.executeCommand(OPEN_SESSION_COMMAND_ID, sessionID);
      await waitForChatTabs(1);
      await log.waitForQuiet(); // the new tab's first requests land before the rename

      await vscode.commands.executeCommand(TEST_SESSION_ANSWERS_COMMAND_ID, {
        title: 'Tree77 renamed',
      });
      await vscode.commands.executeCommand(RENAME_SESSION_COMMAND_ID, sessionID);
      await log.waitFor(`session renamed ${sessionID}`, 8_000);
      const deadline = Date.now() + 8_000;
      while (!chatTabs().some((tab) => tab.label === 'Tree77 renamed')) {
        assert.ok(
          Date.now() < deadline,
          `the tab was not retitled: ${JSON.stringify(chatTabs().map((t) => t.label))}`,
        );
        await sleep(100);
      }
    });

    it('keeps the tab when the delete is declined, and closes it when it is confirmed', async function () {
      const sessionID = await newAnsweredSession('Tree77 delete');
      const log = await openLogCursor();
      await toEditorWithoutTabs(log);
      await vscode.commands.executeCommand(OPEN_SESSION_COMMAND_ID, sessionID);
      await waitForChatTabs(1);
      await sleep(SETTLE_MS);
      // Read from the start of the log, not from the cursor opened after the session was created:
      // the line this case compares against must exist, or the final wait would be skipped.
      const rowsBefore = lastRows((await openLogFromStart()).added());
      assert.ok(
        rowsBefore !== undefined,
        'the Sessions view logged no `sessions view: N rows` line',
      );

      log.mark();
      await vscode.commands.executeCommand(TEST_SESSION_ANSWERS_COMMAND_ID, {
        confirmDelete: false,
      });
      await vscode.commands.executeCommand(DELETE_SESSION_COMMAND_ID, sessionID);
      await log.waitFor(`session delete cancelled ${sessionID}`, 8_000);
      await sleep(SETTLE_MS);
      log.assertAbsent('chat tab closed (pane');
      log.assertAbsent(`session deleted ${sessionID}`);
      assert.strictEqual(chatTabs().length, 1);

      await vscode.commands.executeCommand(TEST_SESSION_ANSWERS_COMMAND_ID, {
        confirmDelete: true,
      });
      await vscode.commands.executeCommand(DELETE_SESSION_COMMAND_ID, sessionID);
      await log.waitFor(`session deleted ${sessionID}`, 8_000);
      await log.waitFor('chat tab closed (pane', 8_000);
      await waitForChatTabs(0);
      await log.waitFor(`sessions view: ${String(rowsBefore - 1)} rows`, 8_000);
    });
  });

  /**
   * Requests of chat tabs (issue #77, delivery E4, decision Q1=2 of Sergio: a tab "sees" a request
   * only while it is the ACTIVE editor). Two lazy tabs in `editor` mode, each with its own session;
   * the one asked for permission is put behind the other (`OPEN_SESSION_COMMAND_ID` on the first
   * session reveals its tab, which makes it the active editor of the group and hides the second).
   *
   * Provenance: SYNTHETIC server (the fake asks permission in the very session of the prompt; its
   * `SLOW` switch plays the steps 300 ms apart, so the ask arrives about 1.5 s after the prompt,
   * enough to bring the first tab forward before it). What the toast says and how the dock looks
   * are inside the workbench and the iframe: `test:visual` step 30 reads them, not here. No subagent asks in
   * the fake, so lineages of several levels are only covered by Vitest.
   */
  describe('requests of chat tabs', function () {
    /** The label of the chat tab that is the active editor of its group, if any. */
    function activeChatLabel(): string | undefined {
      return chatTabs().find((tab) => tab.isActive && tab.group.isActive)?.label;
    }

    /** Puts the host in `editor` mode with no tab open. */
    async function toEditorWithoutTabs(log: LogCursor): Promise<void> {
      await setChatLocation('editor', log);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await waitForChatTabs(0);
      await log.waitForQuiet(); // what the closed tab still logs lands before the caller's mark
    }

    /** A NEW tab with the prompt `text` answered to the end; returns the session it created. */
    async function tabWithAnsweredSession(text: string, count: number): Promise<string> {
      await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
      await waitForChatTabs(count);
      await sleep(SETTLE_MS);
      const log = await openLogCursor();
      await sendPrompt(log, text);
      const id = /prompt accepted for (ses_\S+)/.exec(log.added())?.[1];
      assert.ok(id, `no session id in the log:\n${log.added()}`);
      await log.waitFor('turn finished: succeeded', TURN_WAIT_MS);
      return id;
    }

    afterEach(async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await restoreChatLocation(await openLogCursor());
    });

    /**
     * Protects: the per-request `seen` of the attention feature (a request of tab B is NOT seen
     * while tab A is the active editor, although B's dock lists it), the refresh when the active
     * tab changes (Open chat reveals B, B becomes active, the toast closes as `visible`), and the
     * owner choice of `SHOW_REQUEST_COMMAND_ID` (the tab that lists the request, not the active one).
     */
    it('notifies a permission asked by a tab behind the active one, and closes the toast when Open chat shows it', async function () {
      const cursor = await openLogCursor();
      await toEditorWithoutTabs(cursor);
      const sessionA = await tabWithAnsweredSession('E4 tab A first', 1);
      await tabWithAnsweredSession('E4 tab B first', 2);
      const labelA = chatTabs().find((tab) => tab.label.includes('E4 tab A'))?.label;
      assert.ok(labelA, `tab A has no title: ${JSON.stringify(chatTabs().map((t) => t.label))}`);

      const log = await openLogCursor();
      // B is the active tab (the newest): its second prompt asks for permission after ~1.5 s.
      await sendPrompt(log, 'ASK_PERMISSION SLOW E4 tab B');
      const sessionB = /prompt accepted for (ses_\S+)/.exec(log.added())?.[1];
      assert.ok(sessionB && sessionB !== sessionA, `wrong session for tab B:\n${log.added()}`);
      // Now A comes forward; B is hidden behind it before the ask arrives.
      await vscode.commands.executeCommand(OPEN_SESSION_COMMAND_ID, sessionA);
      const asked = await matchInLog(
        log,
        /permission asked (per_\S+) for (ses_\S+) \(read\)/,
        TURN_WAIT_MS,
        'permission asked',
      );
      const permissionID = asked[1];
      assert.ok(permissionID && asked[2] === sessionB, `the ask is not B's:\n${log.added()}`);
      await log.waitFor(`attention: notified ${permissionID}`, 5_000);
      await sleep(SETTLE_MS);
      log.assertAbsent(`attention: closed ${permissionID}`);
      assert.strictEqual(activeChatLabel(), labelA, 'tab A must still be the active one');

      log.mark();
      await vscode.commands.executeCommand(SHOW_REQUEST_COMMAND_ID, {
        sessionID: sessionB,
        id: permissionID,
        kind: 'permission',
      });
      await log.waitFor('chat tab revealed (pane', 8_000);
      await log.waitFor(`attention: closed ${permissionID} (visible)`, 8_000);
      assert.notStrictEqual(activeChatLabel(), labelA, 'Open chat left tab A in front');
      assert.strictEqual(chatTabs().length, 2, 'Open chat opened another tab');

      await vscode.commands.executeCommand(REPLY_PERMISSION_COMMAND_ID, {
        sessionID: sessionB,
        permissionID,
        decision: 'reject',
      });
      await log.waitFor('turn finished:', TURN_WAIT_MS);
    });

    /**
     * Protects the `SHOW_REQUEST_COMMAND_ID` branch with NO owner tab in `editor` mode: the tab of
     * the asking session was closed before the ask, so "Open chat" has to put that session (the
     * root of its lineage; here the session itself, the fake has no subagent) in a NEW tab, make it
     * the active editor and let the toast close as `visible`. Provenance: SYNTHETIC server, same
     * SLOW ask as above. The focus of the card in that tab is inside the iframe: not read here.
     */
    it('opens the tab of the session when Open chat finds no tab that lists the request', async function () {
      const cursor = await openLogCursor();
      await toEditorWithoutTabs(cursor);
      const sessionA = await tabWithAnsweredSession('E4 owner A first', 1);
      await tabWithAnsweredSession('E4 owner B first', 2);
      const labelA = chatTabs().find((tab) => tab.label.includes('E4 owner A'))?.label;
      assert.ok(labelA, `tab A has no title: ${JSON.stringify(chatTabs().map((t) => t.label))}`);

      const log = await openLogCursor();
      await sendPrompt(log, 'ASK_PERMISSION SLOW E4 owner B');
      const sessionB = /prompt accepted for (ses_\S+)/.exec(log.added())?.[1];
      assert.ok(sessionB && sessionB !== sessionA, `wrong session for tab B:\n${log.added()}`);
      // B is the active tab: closing it leaves A in front and no tab that shows B's session.
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await waitForChatTabs(1);
      assert.strictEqual(activeChatLabel(), labelA, 'tab A must be the one left');
      const asked = await matchInLog(
        log,
        /permission asked (per_\S+) for (ses_\S+) \(read\)/,
        TURN_WAIT_MS,
        'permission asked',
      );
      const permissionID = asked[1];
      assert.ok(permissionID && asked[2] === sessionB, `the ask is not B's:\n${log.added()}`);
      await log.waitFor(`attention: notified ${permissionID}`, 5_000);

      log.mark();
      await vscode.commands.executeCommand(SHOW_REQUEST_COMMAND_ID, {
        sessionID: sessionB,
        id: permissionID,
        kind: 'permission',
      });
      await waitForChatTabs(2);
      await log.waitFor(`attention: closed ${permissionID} (visible)`, 8_000);
      assert.notStrictEqual(activeChatLabel(), labelA, 'Open chat left tab A in front');

      await vscode.commands.executeCommand(REPLY_PERMISSION_COMMAND_ID, {
        sessionID: sessionB,
        permissionID,
        decision: 'reject',
      });
      await log.waitFor('turn finished:', TURN_WAIT_MS);
    });

    /**
     * Protects the owner choice of `SHOW_REQUEST_COMMAND_ID` in `sidebar` mode (#114): a chat tab
     * left over from `editor` mode that owns the request is revealed, and Open chat does not
     * resolve the side bar view again. Switching to `sidebar` closes no tab, so tab B (behind tab A)
     * still lists the request. Provenance: SYNTHETIC server, same SLOW ask as above. The card in
     * the side bar when no tab owns it is `test:visual` step 30 (D5). VERIFIED by this case
     * (fake-server suite, Windows 11, 31/10/2026; #123, the premise of #120 refuted by running):
     * `attention: closed … (visible)` is logged right after
     * the switch to `sidebar`, BEFORE Open chat, and the case asserts that. HYPOTHESIS for why: the
     * side bar view the switch shows lists every request (it is not `ownRequestsOnly`) and counts
     * as seen while visible; the log line does not say which surface closed the toast. Whether a
     * tab counts as seen in `sidebar` mode with the side bar hidden is not covered.
     */
    it('reveals the leftover tab that owns the request when Open chat runs in sidebar mode', async function () {
      const cursor = await openLogCursor();
      await toEditorWithoutTabs(cursor);
      const sessionA = await tabWithAnsweredSession('E4 sidebar A first', 1);
      await tabWithAnsweredSession('E4 sidebar B first', 2);
      const labelA = chatTabs().find((tab) => tab.label.includes('E4 sidebar A'))?.label;
      assert.ok(labelA, `tab A has no title: ${JSON.stringify(chatTabs().map((t) => t.label))}`);

      const log = await openLogCursor();
      await sendPrompt(log, 'ASK_PERMISSION SLOW E4 sidebar B');
      const sessionB = /prompt accepted for (ses_\S+)/.exec(log.added())?.[1];
      assert.ok(sessionB && sessionB !== sessionA, `wrong session for tab B:\n${log.added()}`);
      await vscode.commands.executeCommand(OPEN_SESSION_COMMAND_ID, sessionA);
      const asked = await matchInLog(
        log,
        /permission asked (per_\S+) for (ses_\S+) \(read\)/,
        TURN_WAIT_MS,
        'permission asked',
      );
      const permissionID = asked[1];
      assert.ok(permissionID && asked[2] === sessionB, `the ask is not B's:\n${log.added()}`);
      await log.waitFor(`attention: notified ${permissionID}`, 5_000);

      await setChatLocation('sidebar', log);
      await log.waitForQuiet();
      // The toast is already closed by the switch itself (see the header), before Open chat runs.
      assert.ok(
        log.added().includes(`attention: closed ${permissionID} (visible)`),
        `the switch to sidebar did not close the toast:\n${log.added()}`,
      );
      assert.strictEqual(chatTabs().length, 2, 'the switch to sidebar closed a tab');
      assert.strictEqual(activeChatLabel(), labelA, 'tab A must still be the active one');

      log.mark();
      await vscode.commands.executeCommand(SHOW_REQUEST_COMMAND_ID, {
        sessionID: sessionB,
        id: permissionID,
        kind: 'permission',
      });
      await log.waitFor('chat tab revealed (pane', 8_000);
      await sleep(SETTLE_MS);
      assert.notStrictEqual(activeChatLabel(), labelA, 'Open chat left tab A in front');
      assert.strictEqual(chatTabs().length, 2, 'Open chat opened another tab');
      log.assertAbsent('Chat view resolved');

      await vscode.commands.executeCommand(REPLY_PERMISSION_COMMAND_ID, {
        sessionID: sessionB,
        permissionID,
        decision: 'reject',
      });
      await log.waitFor('turn finished:', TURN_WAIT_MS);
    });

    /**
     * Control of the case above (the opposite transition must NOT happen): the same permission,
     * asked by the tab that IS the active editor, raises the badge and no toast. After the margin
     * the absence is asserted (`vscode-extension` §11: an absence cannot be proven instantly).
     */
    it('does not notify a permission asked by the active tab', async function () {
      const cursor = await openLogCursor();
      await toEditorWithoutTabs(cursor);
      await tabWithAnsweredSession('E4 control first', 1);
      const log = await openLogCursor();
      await sendPrompt(log, 'ASK_PERMISSION SLOW E4 control');
      const asked = await matchInLog(
        log,
        /permission asked (per_\S+) for (ses_\S+) \(read\)/,
        TURN_WAIT_MS,
        'permission asked',
      );
      const [, permissionID, sessionID] = asked;
      assert.ok(permissionID && sessionID, 'ids missing from the log line');
      await log.waitFor('attention: badge 1', 5_000);
      await sleep(2_000);
      log.assertAbsent('attention: notified');

      await vscode.commands.executeCommand(REPLY_PERMISSION_COMMAND_ID, {
        sessionID,
        permissionID,
        decision: 'reject',
      });
      await log.waitFor('turn finished:', TURN_WAIT_MS);
    });
  });

  /**
   * "Restart Server" replaces the process: new pid, stream reconnected, old process gone, and no
   * crash restart follows (the stop we asked for must not look like a crash).
   *
   * Runs near the end because it replaces the server the cases above share.
   */
  it('restart replaces the server: new pid, stream reconnected, old process gone', async function () {
    // On the failure path the waits add up to ~61.5 s (5 + 35 + 10 + 10 + SETTLE), more than the
    // 60 s of the suite, and Mocha's generic timeout would hide the log that explains the failure.
    // 35 + 40 = 75 s stays above that sum.
    this.timeout(READY_WAIT_MS + 40_000);
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
    await sleep(SETTLE_MS);
    log.assertAbsent('server exited unexpectedly');
  });

  /**
   * Crash recovery: killing the server from outside makes the extension restart it after the first
   * backoff (1 s) without user action, the stream reconnects, and only ONE restart happens.
   *
   * Only the first attempt is exercised; the 5 s, 15 s and give-up steps are in the unit tests with
   * an injected clock. `process.kill(pid)` terminates the node process of the fixture like a crash
   * (Windows: TerminateProcess).
   */
  it('a killed server is restarted automatically after 1 s', async function () {
    // Same reason as the restart case: its failure-path waits (10 + 35 + 10 + SETTLE) come close
    // to the suite's 60 s, and the explicit 75 s keeps the margin independent of that figure.
    this.timeout(READY_WAIT_MS + 40_000);
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
    await sleep(SETTLE_MS);
    assert.strictEqual(
      countOf(log, 'server exited unexpectedly'),
      1,
      `the server was restarted more than once; log:\n${log.added()}`,
    );
  });
});
