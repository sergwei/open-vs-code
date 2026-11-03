// Project plugins suite (issue #153, `project-plugins` configuration).
//
// Protects against: the extension launching `opencode serve` in a folder whose opencode config
// brings plugins, with no consent. The window opens a folder whose `.opencode/plugins/demo.js`
// exists (written by `.vscode-test.mjs` before VS Code starts) and the synthetic opencode as the
// server to run, so a launch WOULD happen if the guard let it through.
//
// Provenance: the real VS Code, the real manifest, the real extension and the real scan of a real
// folder; the server is the synthetic fixture, which does not load plugins (it proves the guard, not
// that opencode loads them: that is HYPOTHESIS, see the header of `projectPlugins.ts`). The notice
// and the modal cannot be clicked from the test API: `test:visual` step 40 does it. This is also the
// first place where the esbuild bundle of the host runs with `jsonc-parser`.
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { FORGET_PLUGIN_DECISION_COMMAND_ID } from '../../src/extension/ids';
import { openLogCursor, openLogFromStart } from './support/extensionLog';

const EXTENSION_ID = 'sergwei.open-vs-code';
// A fixed pause before asserting an ABSENCE: it cannot be waited for (vscode-extension skill,
// section 11). The server of `fake-server` answers within a second of the detection.
const SETTLE_MS = 2000;
const LOG_WAIT_MS = 15_000;

/** Pauses for `ms`; used for the margin before asserting an absence. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('project plugins (no consent, no launch)', function () {
  this.timeout(60_000);

  before(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
  });

  /**
   * I1: a folder with a plugin ends `not-started` for the plugins and never reaches a server.
   *
   * Protects the launch guard of `ServerManager` and the scan: without them the synthetic opencode
   * of this profile would start as soon as the binary is detected (the `fake-server` suite proves
   * that it does when there is no plugin). The line is the final state, not a transition: after it
   * the test waits 2 s and asserts `server ready at` never showed up. Reads the log from the start
   * because the launch decision is made at activation, before any test could mark its end.
   * VERIFIED by `npm run test:integration -- --label project-plugins` (Windows 11, VS Code stable,
   * 03/11/2026): "✔ holds the launch and logs why, with no server ready", "2 passing".
   */
  it('holds the launch and logs why, with no server ready', async () => {
    const log = await openLogFromStart();
    await log.waitFor(
      'server not started: this folder has opencode plugins that have not been allowed',
      LOG_WAIT_MS,
    );
    await log.waitFor('project plugins in ', LOG_WAIT_MS);
    await pause(SETTLE_MS);
    log.assertAbsent('server ready at');
  });

  /**
   * I2: the forget command is contributed, registered and resolves without throwing.
   *
   * Protects the command id declared in `package.json` and registered by `serverLifecycle.ts`
   * (`commands.test.ts` of `main` checks it for every contributed command too). It runs on a
   * folder with nothing stored, so it only shows the information message and changes nothing.
   * VERIFIED by the same run: "✔ registers the forget command and runs it".
   */
  it('registers the forget command and runs it', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(FORGET_PLUGIN_DECISION_COMMAND_ID));
    const log = await openLogCursor();
    await vscode.commands.executeCommand(FORGET_PLUGIN_DECISION_COMMAND_ID);
    await pause(SETTLE_MS);
    log.assertAbsent('server ready at');
  });
});
