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
// Out of scope: the STOP. Nothing public in the extension stops the server before the window
// closes (`deactivate` does it), and a test cannot observe its own host shutting down. The test
// prints the pid so whoever runs it can check afterwards that the process is gone (Windows:
// `tasklist /FI "PID eq <pid>"`; POSIX: `kill -0 <pid>`). The stop is VERIFIED separately under
// plain Node (spike of 2026-10-20) but NOT through `deactivate` in VS Code.
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CONFIG_SECTION, OPENCODE_PATH_KEY, OPENCODE_PATH_SETTING } from '../../src/extension/ids';
import { PINNED_OPENCODE_VERSION } from '../../src/extension/opencodeServer';
import { openLogFromStart } from './support/extensionLog';

const EXTENSION_ID = 'sergwei.open-vs-code';
// Above STARTUP_TIMEOUT_MS (30 s) of the extension, so a start that really hangs fails with the
// extension's own error in the log, not with ours. A healthy start takes well under a second.
const READY_WAIT_MS = 35_000;

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
});
