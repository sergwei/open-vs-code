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
import {
  INJECT_WEBVIEW_MESSAGE_COMMAND_ID,
  REPLY_PERMISSION_COMMAND_ID,
  RESTART_SERVER_COMMAND_ID,
  SESSION_DIFF_SCHEME,
  VIEW_CONTAINER_ID,
} from '../../src/extension/ids';
import { PINNED_OPENCODE_VERSION } from '../../src/extension/opencodeServer';
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
