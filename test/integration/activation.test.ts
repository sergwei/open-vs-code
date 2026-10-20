// Activation suite (issue #41).
//
// Protects against: a broken bundle or manifest that stops the extension from activating in a
// real VS Code (the unit tests only see the source), and the command contributed in package.json
// not being registered at runtime. Runs in the downloaded VS Code, no mocks. The log line is
// read from the isolated user data dir (see support/extensionLog.ts). Out of scope: the output
// panel contents beyond the activation line.
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { SHOW_LOGS_COMMAND_ID } from '../../src/extension/ids';
import { openLogFromStart } from './support/extensionLog';

const EXTENSION_ID = 'sergwei.open-vs-code';

describe('activation', () => {
  /**
   * The extension is installed from the development path and activates without error.
   *
   * UNVERIFIED until the first run in a real VS Code. HYPOTHESIS that `--disable-extensions`
   * still loads the extension under development: the official "Testing extensions" guide
   * (code.visualstudio.com/api/working-with-extensions/testing-extension) uses
   * `--disable-extensions` together with `extensionDevelopmentPath`, and F5 does the same.
   */
  it('activates', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });

  /**
   * The activation line carries the version of package.json, read from `packageJSON` and not
   * hardcoded, so a version bump does not break the test.
   */
  it('logs the activation line with the manifest version', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();
    const version = (extension.packageJSON as { version: string }).version;
    const log = await openLogFromStart();
    // 8000 ms is our own choice (margin for a slow CI; with the 8000 ms of the log lookup it stays under the 20 s Mocha timeout), not a VS Code value.
    await log.waitFor(`open-vs-code ${version} activated`, 8000);
  });

  /**
   * The contributed "Show Logs" command is registered at runtime and runs without throwing.
   */
  it('registers and runs the Show Logs command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(SHOW_LOGS_COMMAND_ID));
    await vscode.commands.executeCommand(SHOW_LOGS_COMMAND_ID);
  });
});
