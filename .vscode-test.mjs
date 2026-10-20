// Config of `vscode-test` (@vscode/test-cli) for the integration tests (issue #41).
//
// The tests run inside a real VS Code downloaded to `.vscode-test/`, with Mocha in the extension
// host. They are bundled to `out/test/integration` by `npm run compile:integration`; the script
// `npm run test:integration` builds the host and the webview first, because `main` of the
// extension points to `dist/extension.js` and the chat view needs `dist/webview`.
import { defineConfig } from '@vscode/test-cli';
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
};

export default defineConfig({
  // Relative to this file. Compiled by `npm run compile:integration`, not by Vitest.
  files: 'out/test/integration/**/*.test.js',
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
});
