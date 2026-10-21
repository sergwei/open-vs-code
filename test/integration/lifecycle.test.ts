// Lifecycle and requests suite (phase 3 of E2: issues #10, #18, #44, #19), `main` configuration:
// a real VS Code with NO workspace folder and NO opencode server.
//
// Protects against: a command that is declared in the manifest but not registered at runtime (or
// the reverse: the internal commands of the notification links), the restart command doing
// something in a window that has nothing to restart, the internal commands accepting arguments
// they did not validate (their arguments come from a link in a notification, so anyone can run
// them), and a permission answer without a server crashing instead of reporting
// `ServerUnavailable`. It does NOT cover the badge, the notifications or a real restart: those
// need a server and live in the opt-in `realOpencode.test.ts`; how they look is for the F5.
//
// Provenance: real VS Code 1.142 on Windows 11 (the CI runs the three OS). The expected log lines
// are the ones the code writes today (`serverManager.ts`, `chatLifecycle.ts`, `chatController.ts`);
// a reworded line fails this test on purpose, since the opt-in suite waits for the same texts.
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
  INJECT_WEBVIEW_MESSAGE_COMMAND_ID,
  MANAGE_PERMISSIONS_COMMAND_ID,
  REPLY_PERMISSION_COMMAND_ID,
  RESTART_SERVER_COMMAND_ID,
  SELECT_FOLDER_COMMAND_ID,
  SHOW_REQUEST_COMMAND_ID,
} from '../../src/extension/ids';
import { openLogCursor } from './support/extensionLog';

const EXTENSION_ID = 'sergwei.open-vs-code';

describe('lifecycle and requests', () => {
  before(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);
    await extension.activate();
  });

  /**
   * The three contributed commands and the two internal ones exist at runtime. The internal ones
   * are not in `contributes`, so only a real window can show they were registered.
   */
  it('registers the new commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      RESTART_SERVER_COMMAND_ID,
      SELECT_FOLDER_COMMAND_ID,
      MANAGE_PERMISSIONS_COMMAND_ID,
      SHOW_REQUEST_COMMAND_ID,
      REPLY_PERMISSION_COMMAND_ID,
    ]) {
      assert.ok(commands.includes(id), `${id} is not registered`);
    }
  });

  /**
   * "Restart Server" in a window with no folder refuses with a log line and starts nothing. The
   * warning toast it also shows is not observable from here (UNVERIFIED, F5 point 8).
   */
  it('restart without a folder logs why and starts nothing', async () => {
    const log = await openLogCursor();
    await vscode.commands.executeCommand(RESTART_SERVER_COMMAND_ID);
    await log.waitFor('restart ignored: no workspace folder to serve', 5000);
    log.assertAbsent('restarting the server');
    log.assertAbsent('starting the server for');
  });

  /**
   * Select Workspace Folder with fewer than two folders explains instead of throwing. (Its
   * `enablement` hides it from the palette, but a command can still be run by id.)
   */
  it('select folder runs without throwing when there is nothing to choose', async () => {
    await vscode.commands.executeCommand(SELECT_FOLDER_COMMAND_ID);
  });

  /**
   * The internal commands refuse arguments that do not have the expected shape, with a `warn`
   * line, and `always` is not accepted by the reply link at all (it must be chosen in the chat,
   * where the rule being stored is shown).
   */
  it('the internal commands reject invalid arguments', async () => {
    const log = await openLogCursor();
    await vscode.commands.executeCommand(REPLY_PERMISSION_COMMAND_ID, { nonsense: true });
    await log.waitFor(`${REPLY_PERMISSION_COMMAND_ID} rejected: invalid arguments`, 5000);
    await vscode.commands.executeCommand(REPLY_PERMISSION_COMMAND_ID, {
      sessionID: 'ses_x',
      permissionID: 'per_x',
      decision: 'always',
    });
    await vscode.commands.executeCommand(SHOW_REQUEST_COMMAND_ID, 'not an object');
    await log.waitFor(`${SHOW_REQUEST_COMMAND_ID} rejected: invalid arguments`, 5000);
    const added = log.added();
    const rejections = added.split(`${REPLY_PERMISSION_COMMAND_ID} rejected`).length - 1;
    assert.strictEqual(rejections, 2, `expected two rejected replies; log:\n${added}`);
  });

  /**
   * A permission answer injected while there is no server is reported as `ServerUnavailable` in the
   * log (the controller's `request ... failed` line) instead of throwing. Needs the message
   * injection command, which exists only because the tests run in `ExtensionMode.Test`.
   */
  it('a permission reply without a server reports ServerUnavailable', async () => {
    const log = await openLogCursor();
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'permission.reply',
      requestId: 'lifecycle-1',
      sessionID: 'ses_x',
      permissionID: 'per_x',
      decision: 'once',
    });
    await log.waitFor('request lifecycle-1 failed: ServerUnavailable', 5000);
  });
});
