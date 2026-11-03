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
// first place where the esbuild bundle of the host runs with `jsonc-parser`. I3 (issue #158) goes on
// from the held state: it removes the plugin, restarts the server and writes plugins while it runs.
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  FORGET_PLUGIN_DECISION_COMMAND_ID,
  RESTART_SERVER_COMMAND_ID,
} from '../../src/extension/ids';
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
   * 03/11/2026): "✔ holds the launch and logs why, with no server ready" (the same label has had
   * more cases since, see I3).
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

  /**
   * I3 (issue #158): a plugin that arrives while the own server runs stops it, and nothing else
   * does.
   *
   * Protects `watchServedPlugins` (`pluginConsentUi.ts`): the `FileSystemWatcher` on the served
   * folder, the re-check and the `plugins-changed` restart through the guard of #153. Steps: delete
   * `demo.js` (written by `.vscode-test.mjs`) and Restart Server, so the synthetic server runs with
   * no plugin; write `.opencode/command/x.md` and wait 2 s, which must NOT restart anything; then
   * write `.opencode/plugins/late.js` and wait for `restarting the server (plugins-changed)` and for
   * the held state, then 2 s more with no `server ready at` after it (the final state, not a
   * transition). Also the check that one `RelativePattern` with braces and `/**` delivers the
   * event of a new file in `.opencode/plugins/` (that folder already existed when the watcher was
   * created, because `demo.js` was in it; a folder created later is NOT covered). The command
   * file only shows that a change the guard lets through restarts nothing: it cannot show that
   * its own event arrived.
   * Provenance: the real VS Code and the real watcher on a real folder, and the synthetic server,
   * which does not load plugins (it proves the extension's reaction, not that opencode ignores the
   * plugin: the `real-opencode` suite does).
   * VERIFIED by `npm run test:integration -- --label project-plugins` (Windows 11, VS Code stable
   * 1.144.1, 03/11/2026): "✔ restarts for a plugin that arrives while the server runs, and for
   * nothing else", "3 passing". Not observed: macOS and Linux, a plugin declared in `opencode.json`.
   */
  it('restarts for a plugin that arrives while the server runs, and for nothing else', async function () {
    this.timeout(90_000);
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(folder, 'no workspace folder is open');
    const plugins = path.join(folder, '.opencode', 'plugins');
    const commands = path.join(folder, '.opencode', 'command');
    try {
      fs.rmSync(path.join(plugins, 'demo.js'), { force: true });
      const ready = await openLogCursor();
      await vscode.commands.executeCommand(RESTART_SERVER_COMMAND_ID);
      await ready.waitFor('server ready at', LOG_WAIT_MS);

      // A change the guard would let through: no restart.
      const quiet = await openLogCursor();
      fs.mkdirSync(commands, { recursive: true });
      fs.writeFileSync(path.join(commands, 'x.md'), 'Say x.\n');
      await pause(SETTLE_MS);
      quiet.assertAbsent('restarting the server (plugins-changed)');

      // A plugin nobody allowed: the server stops and the guard holds the launch.
      const late = await openLogCursor();
      fs.mkdirSync(plugins, { recursive: true });
      fs.writeFileSync(path.join(plugins, 'late.js'), 'export default {};\n');
      await late.waitFor('restarting the server (plugins-changed)', LOG_WAIT_MS);
      await late.waitFor('server not started: this folder has opencode plugins', LOG_WAIT_MS);
      await pause(SETTLE_MS);
      late.assertAbsent('server ready at');
    } finally {
      fs.rmSync(path.join(plugins, 'late.js'), { force: true });
      fs.rmSync(path.join(commands, 'x.md'), { force: true });
    }
  });
});
