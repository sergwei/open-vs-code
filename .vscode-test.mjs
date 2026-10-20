// Config of `vscode-test` (@vscode/test-cli) for the integration tests (issue #41).
//
// The tests run inside a real VS Code downloaded to `.vscode-test/`, with Mocha in the extension
// host. They are bundled to `out/test/integration` by `npm run compile:integration`; the script
// `npm run test:integration` builds the host and the webview first, because `main` of the
// extension points to `dist/extension.js` and the chat view needs `dist/webview`.
import { defineConfig } from '@vscode/test-cli';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Isolated user data dir of the test instance.
 *
 * Why: the "other instance of Code is running" check of VS Code is keyed on the user data dir
 * (the IPC pipe name is a hash of it), so a private dir lets the tests run while the developer's
 * own VS Code is open, and it keeps `settings.json` of the user untouched (the tests change
 * `openVsCode.opencodePath` in THIS profile). It is also where the tests read `OpenCode.log`.
 * HYPOTHESIS (read in the VS Code sources, not run): coexistence with an open Stable window is
 * confirmed by the first local run.
 */
const userDataDir = path.join(import.meta.dirname, '.vscode-test', 'user-data');

/**
 * Environment of the VS Code under test.
 *
 * Why the `undefined` entries: when the runner is launched from a process that descends from VS
 * Code (an extension host, such as Claude Code or the integrated terminal of an agent), the
 * environment carries `ELECTRON_RUN_AS_NODE=1` and many `VSCODE_*` variables. With the first
 * one `Code.exe` behaves as plain Node and exits with 9 ("bad option") on the first VS Code flag;
 * the second group might make the test instance attach to the parent (HYPOTHESIS, no source:
 * it is the reason the plan gave for clearing them, never reproduced; to check, run once with
 * the `VSCODE_*` entries removed from a VS Code terminal). test-cli already clears
 * `ELECTRON_RUN_AS_NODE` (read in @vscode/test-cli 0.0.15, `out/cli/platform/desktop.mjs`
 * L51, not executed); we clear it too and every `VSCODE_*` key (spawn drops keys whose value
 * is `undefined`). Outside VS Code (CI) there is nothing to clear.
 * VERIFIED: `node --extensionDevelopmentPath=/x` exits 9, and `spawnSync` drops `undefined`
 * env values (Node 24.22, Windows 11, 2026-10-20). HYPOTHESIS: that this was the cause of the
 * exit 9 seen in the agent environment.
 *
 * `OPEN_VS_CODE_TEST_NODE` is the Node that runs the runner: the tests use it as a stand-in for
 * the opencode binary (it answers `--version` with a v24 number, so it is "unsupported").
 */
const env = {
  ELECTRON_RUN_AS_NODE: undefined,
  ...Object.fromEntries(
    Object.keys(process.env)
      .filter((key) => key.startsWith('VSCODE_'))
      .map((key) => [key, undefined]),
  ),
  OPEN_VS_CODE_TEST_USER_DATA_DIR: userDataDir,
  OPEN_VS_CODE_TEST_NODE: process.execPath,
  // Opt-in suite `realOpencode.test.ts`: absolute path to a real opencode v2 executable. Passed
  // through only when set; the suite and its configuration below exist only in that case.
  OPEN_VS_CODE_REAL_OPENCODE: process.env.OPEN_VS_CODE_REAL_OPENCODE,
};

/** Settings shared by every configuration below. */
const common = {
  // Decision of Sergio (wave3/decisions): test on what users run. Cost: a new VS Code release
  // can break the suite without a change on our side.
  version: 'stable',
  // `--disable-extensions` as in .vscode/launch.json (crash seen with other extensions loaded);
  // the extension under development is still loaded. The user data dir is explicit so the
  // log helper does not depend on the cwd.
  launchArgs: ['--disable-extensions', `--user-data-dir=${userDataDir}`],
  env,
  // `bdd` (describe/it) like Vitest; test-cli defaults to `tdd`. The 20000 ms timeout is our own
  // choice (Mocha's default is 2000, too short for a real VS Code); it must stay above the sum of
  // the waits inside a single test (see WAIT_MS in binaryDetection.test.ts), or Mocha's generic
  // timeout hides the log diagnostic of the helper.
  mocha: { ui: 'bdd', timeout: 20000 },
};

/**
 * Main configuration: every suite except the opt-in one, with NO folder open (the binary
 * detection suite depends on that: without a workspace folder the server manager never starts a
 * process). The extglob `!(realOpencode)` keeps the opt-in suite out; the recursive part is
 * meant to also pick up suites in subfolders (HYPOTHESIS: there is none yet).
 * VERIFIED with the `glob` package that test-cli uses, against the real
 * `out/test/integration` (Windows 11, Node 24, 2026-10-20): it matches `activation`,
 * `binaryDetection` and `chatView`, and skips `realOpencode`.
 */
const main = {
  ...common,
  label: 'main',
  // Relative to this file. Compiled by `npm run compile:integration`, not by Vitest.
  files: 'out/test/integration/**/!(realOpencode).test.js',
};

/**
 * Opt-in configuration for `realOpencode.test.ts`: runs only when `OPEN_VS_CODE_REAL_OPENCODE`
 * is set, so a plain `npm run test:integration` does not launch a second VS Code just to skip.
 *
 * Why a second configuration and not a folder for everyone: the manager only starts a server
 * with a folder open, and the other suites must keep running without one. The folder is a fixed
 * empty directory under the OS temp dir (created here, never deleted by us): inside the repo it
 * would make opencode treat the checkout as the project, and an empty dir cannot be tracked by
 * git. `--disable-workspace-trust` because the extension does not activate in Restricted Mode and
 * the trust prompt would block it (HYPOTHESIS: the flag is honoured by the test instance; not
 * run yet).
 */
const realOpencode = {
  ...common,
  label: 'real-opencode',
  files: 'out/test/integration/realOpencode.test.js',
  workspaceFolder: path.join(os.tmpdir(), 'open-vs-code-real-opencode-workspace'),
  launchArgs: [...common.launchArgs, '--disable-workspace-trust'],
  // A real server boots in well under a second (~280 ms to the port, spike 2026-10-20) but the
  // startup budget of the extension is 30 s (STARTUP_TIMEOUT_MS); the wait inside the test is
  // 35 s, so this stays above it and the log diagnostic wins over Mocha's generic timeout.
  mocha: { ...common.mocha, timeout: 45000 },
};

if (process.env.OPEN_VS_CODE_REAL_OPENCODE) {
  fs.mkdirSync(realOpencode.workspaceFolder, { recursive: true });
}

export default defineConfig(process.env.OPEN_VS_CODE_REAL_OPENCODE ? [main, realOpencode] : [main]);
