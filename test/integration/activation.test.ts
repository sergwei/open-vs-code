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
   * Guard of E11-i18n (H2): the integration suites compare English texts, so a VS Code that starts
   * in another language must fail here, with the reason, and not in dozens of unrelated checks.
   * `vscode.env.language` is `en` when no language pack is installed in the profile, whatever the
   * operating system says: the test profile is new and has no pack (read in microsoft/vscode
   * `base/node/nls.ts`). VERIFIED on Windows 11 (04/11/2026): `--label main` passed
   * "runs in an English VS Code (the suites compare English texts)". macOS and Linux UNVERIFIED
   * until CI.
   */
  it('runs in an English VS Code (the suites compare English texts)', () => {
    assert.strictEqual(
      vscode.env.language,
      'en',
      `vscode.env.language is "${vscode.env.language}": the integration suites compare English ` +
        'texts, so this label must start VS Code without a language pack (locale-es is the one that does).',
    );
  });

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
   * The host writes its language and the size of the loaded bundle (`l10n: locale en, bundle
   * none`): in English VS Code loads no bundle. Protects the wiring of `l10nBoot.ts` (a missing
   * or throwing boot would stop the activation line too). The Spanish counterpart is the
   * `locale-es` label ("logs the host locale es with the loaded bundle").
   */
  it('logs the l10n line', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();
    const log = await openLogFromStart();
    await log.waitFor('l10n: locale en, bundle none', 8000);
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
