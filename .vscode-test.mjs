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
import { LANGUAGE_PACK_ES, prepareLanguagePackForStable } from './test/visual/languagePack.mjs';

/**
 * Isolated user data dir of the test instance.
 *
 * Why: the "other instance of Code is running" check of VS Code is keyed on the user data dir
 * (the IPC pipe name is a hash of it), so a private dir lets the tests run while the developer's
 * own VS Code is open, and it keeps `settings.json` of the user untouched (the tests change
 * `openVsCode.opencodePath` in THIS profile). It is also where the tests read `OpenCode.log`.
 * HYPOTHESIS (read in the VS Code sources, not reproduced): the mechanism, i.e. that the pipe
 * name is what lets both instances coexist; no control run without the private dir was made.
 * VERIFIED (first local run of the `real-opencode` configuration, Windows 11, VS Code 1.142.0,
 * 2026-10-20): the test instance started and passed while the developer's own VS Code was open.
 * POSIX UNVERIFIED.
 */
const userDataDir = path.join(import.meta.dirname, '.vscode-test', 'user-data');

/**
 * Baseline of `openVsCode.chatLocation` in the isolated profiles of the existing suites (E5 of
 * #77, decision Q2=1 of Sergio, 30/10/2026).
 *
 * Why: the default of the setting is now `editor`, and ~95 cases of `main`, `external-server`,
 * `fake-server` and `real-opencode` verify the `sidebar` mode (a view that resolves, a snapshot
 * sent to it, injected messages that only reach a side-bar pane). Rewriting them for `editor`
 * would cover no more of the default than a case that runs WITHOUT the key, and that is what the
 * `default-location` configuration below is for: its profile never carries this key. Written
 * into every profile's `settings.json` when this file loads, so a dead run cannot leave another
 * value behind. Keep it equal to `TEST_BASELINE_CHAT_LOCATION` in
 * `test/integration/support/chatLocation.ts`, which restores to it between cases
 * (`src/extension/testConfig.test.ts` fails if they differ).
 */
const TEST_CHAT_LOCATION = 'sidebar';

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
 * the opencode binary (it answers `--version` with a v24 number, so it is "unsupported"). It is
 * also the Node that the Test-mode seam of `src/extension/testLaunch.ts` uses to run a `.mjs`
 * binary (the `fake-server` configuration, issue #41).
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
  // E10-mods: the mods root of EVERY label. Without it the extension would load the developer's
  // real mods from `~/.config/opencode-station/mods` (and one of them could compose a prompt in
  // the real-opencode suite). The folder does not exist until `mods.test.ts` seeds it: a missing
  // root means no mods.
  OPEN_VS_CODE_MODS_HOME: path.join(import.meta.dirname, '.vscode-test', 'mods-home'),
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
 * meant to also pick up suites in subfolders (HYPOTHESIS: there is none yet). `defaultLocation`
 * has its own configuration (a profile WITHOUT the `chatLocation` key) and is excluded here.
 * VERIFIED with the `glob` package that test-cli uses, against the real
 * `out/test/integration` (Windows 11, Node 24, 2026-10-20): it matches `activation`,
 * `binaryDetection` and `chatView`, and skips `realOpencode`.
 *
 * Its profile (shared with `real-opencode`) gets `settings.json` rewritten here with the
 * `sidebar` baseline of {@link TEST_CHAT_LOCATION} and nothing else: no suite of `main` writes
 * other settings that must survive a start (they restore their own).
 *
 * `launchArgs` adds `--log trace --log sergwei.open-vs-code:info` (#141 reopened, run 41485490446):
 * on the macOS runner the document of a chat tab sometimes never says `ready` and the host log
 * cannot tell why; `chatPanel.test.ts` prints the webview lines of the window's `renderer.log` in
 * that failure, and VS Code writes them (`Webview(<id>): webview ready`) only at TRACE. The second
 * `--log` keeps OpenCode.log at info, because the suites match its text. Only `main`: it is where
 * the flake lives. Syntax read in VS Code 1.144.0 (`argv.ts`: `log` is a `string[]` accepting
 * `publisher.name:level`). RISK: trace may change timings (a heisenbug either way).
 * PUBLIC OUTPUT (Sergio's decision, #141): the test host mirrors the window's renderer.log to the
 * job's stdout, so with the renderer at trace the WHOLE renderer.log of every `main` run goes to
 * the public CI log, pass or fail (about 5000 lines against about 170 without the flags), and the
 * main process log goes along (1301 `[main` lines against 10): runner paths, command ids, settings
 * keys and the crash-reporter id. `main` starts no server and holds no password, so none of those
 * is a secret; the configs that do (`real-opencode`, `external-server`, `fake-server`) do not carry
 * the flag. The excerpt of `chatPanel.test.ts` is only a summary placed next to the failure.
 * VERIFIED (Windows 11, VS Code 1.144.1, 03/11/2026, `--label main`): with `--log trace` alone, a
 * run printed "47 passing (43s)" and its OpenCode.log held 2 `[debug]` lines (e.g. "post-ready
 * focus of pane 15 dropped: another surface was revealed"); with the second `--log` too, a run
 * printed "47 passing (42s)" and OpenCode.log held 0 lines with `[trace]` or `[debug]`; the newest
 * session's renderer.log had 139 lines with `Webview(`. Without any `--log`, "47 passing (41s)"
 * and 172 lines of output against 5092 with trace alone (one run of each of those two, so the
 * 1-2 s of difference is within noise). UNVERIFIED: macOS.
 */
const main = {
  ...common,
  label: 'main',
  launchArgs: [...common.launchArgs, '--log', 'trace', '--log', 'sergwei.open-vs-code:info'],
  // Relative to this file. Compiled by `npm run compile:integration`, not by Vitest.
  files:
    'out/test/integration/**/!(realOpencode|externalServer|fakeServer|defaultLocation|projectPlugins|localeEs).test.js',
};
fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
fs.writeFileSync(
  path.join(userDataDir, 'User', 'settings.json'),
  JSON.stringify({ 'openVsCode.chatLocation': TEST_CHAT_LOCATION }, null, 2),
);

/**
 * Opt-in configuration for `realOpencode.test.ts`: runs only when `OPEN_VS_CODE_REAL_OPENCODE`
 * is set, so a plain `npm run test:integration` does not launch a second VS Code just to skip.
 *
 * Why a second configuration and not a folder for everyone: the manager only starts a server
 * with a folder open, and the other suites must keep running without one. The folder is a fixed
 * empty directory under the OS temp dir (created here, never deleted by us): inside the repo it
 * would make opencode treat the checkout as the project, and an empty dir cannot be tracked by
 * git. `--disable-workspace-trust` because the extension does not activate in Restricted Mode and
 * the trust prompt would block it (VERIFIED, first local run, Windows 11, VS Code 1.142.0,
 * 2026-10-20: the extension activated in the temp folder with no prompt and the suite passed;
 * POSIX UNVERIFIED).
 */
const realOpencode = {
  ...common,
  label: 'real-opencode',
  // The real opencode keeps its database under `~/.local/share/opencode`; this suite sends no
  // prompt but its contract cases create and remove sessions, so it would still add sessions and
  // projects to the developer's own history. The XDG
  // variables go in the env of the test VS Code: the extension host inherits it and
  // `opencode serve` inherits the host's, so production code is untouched. VERIFIED (Windows 11,
  // opencode 2.0.32, 20/10/2026, spike): with them a fresh `opencode.db` is created under
  // `.vscode-test/real-opencode-xdg/data/opencode` and the real one is not modified; the free model
  // answers without `XDG_CONFIG_HOME`. POSIX UNVERIFIED.
  env: {
    ...env,
    XDG_DATA_HOME: path.join(import.meta.dirname, '.vscode-test', 'real-opencode-xdg', 'data'),
    XDG_STATE_HOME: path.join(import.meta.dirname, '.vscode-test', 'real-opencode-xdg', 'state'),
    XDG_CACHE_HOME: path.join(import.meta.dirname, '.vscode-test', 'real-opencode-xdg', 'cache'),
    // E10-config-views (issue #128): the stdio MCP server the settings contract case configures in
    // the real opencode through `OPENCODE_CONFIG_CONTENT`. The Node that runs it is
    // `OPEN_VS_CODE_TEST_NODE` (in `env` above). Not read by the extension.
    OPEN_VS_CODE_TEST_FAKE_MCP: path.join(
      import.meta.dirname,
      'src',
      'extension',
      'test-fixtures',
      'fake-mcp.mjs',
    ),
  },
  files: 'out/test/integration/realOpencode.test.js',
  workspaceFolder: path.join(os.tmpdir(), 'open-vs-code-real-opencode-workspace'),
  launchArgs: [...common.launchArgs, '--disable-workspace-trust'],
  // A real server boots in well under a second (~280 ms to the port, spike 2026-10-20) but the
  // startup budget of the extension is 30 s (STARTUP_TIMEOUT_MS); the wait inside the test is
  // 35 s, so this stays above it and the log diagnostic wins over Mocha's generic timeout. The
  // suite sends no prompt (tooling/tests-without-model), so no case waits for a turn any more:
  // 60 s covers the longest default (a server start plus its waits), and the cases that need more
  // (the contract with a server of its own, restart) set their own `this.timeout`.
  mocha: { ...common.mocha, timeout: 60000 },
};

if (process.env.OPEN_VS_CODE_REAL_OPENCODE) {
  fs.mkdirSync(realOpencode.workspaceFolder, { recursive: true });
}

/**
 * Configuration of `externalServer.test.ts` (issue #11): not opt-in, because its "server" is the
 * synthetic fixture started by the test itself, so it needs no real opencode.
 *
 * Why its own user data dir: the suite stores secrets and writes `openVsCode.serverUrl`; a run
 * that dies half way must not leave either in the profile of `main` (whose detection tests assume
 * the setting is empty). The profile's `settings.json` is rewritten here, before VS Code starts,
 * so that the FIRST activation is already in external mode (criterion of the issue: no server
 * launched, no detection) with `serverUrl` at the discard port 9 and no password stored, and
 * `openVsCode.opencodePath` at an absolute path that does not exist: emptying `serverUrl` brings
 * the detection back, and it can only end `invalid-setting`, never start a real opencode. The
 * folder is an empty directory under the OS temp dir, like the `real-opencode` one, and the XDG
 * variables go to a private dir as a safety net in case anything does launch opencode.
 * `--password-store=basic` is a Linux flag (SecretStorage without a keyring under xvfb);
 * HYPOTHESIS that it is harmless on Windows and macOS, and that it is enough on the Linux CI:
 * check on the first CI run of this branch.
 */
const externalUserDataDir = path.join(import.meta.dirname, '.vscode-test', 'user-data-external');
const externalServer = {
  ...common,
  label: 'external-server',
  env: {
    ...env,
    OPEN_VS_CODE_TEST_USER_DATA_DIR: externalUserDataDir,
    XDG_DATA_HOME: path.join(import.meta.dirname, '.vscode-test', 'external-server-xdg', 'data'),
    XDG_STATE_HOME: path.join(import.meta.dirname, '.vscode-test', 'external-server-xdg', 'state'),
    XDG_CACHE_HOME: path.join(import.meta.dirname, '.vscode-test', 'external-server-xdg', 'cache'),
  },
  files: 'out/test/integration/externalServer.test.js',
  workspaceFolder: path.join(os.tmpdir(), 'open-vs-code-external-workspace'),
  launchArgs: [
    '--disable-extensions',
    `--user-data-dir=${externalUserDataDir}`,
    '--disable-workspace-trust',
    '--password-store=basic',
  ],
  mocha: { ...common.mocha, timeout: 60000 },
};
fs.mkdirSync(externalServer.workspaceFolder, { recursive: true });
fs.mkdirSync(path.join(externalUserDataDir, 'User'), { recursive: true });
fs.writeFileSync(
  path.join(externalUserDataDir, 'User', 'settings.json'),
  JSON.stringify(
    {
      'openVsCode.serverUrl': 'http://127.0.0.1:9',
      'openVsCode.opencodePath': path.join(os.tmpdir(), 'open-vs-code-no-such-opencode'),
      'openVsCode.chatLocation': TEST_CHAT_LOCATION,
      // Issue #124: autoStart must have no effect with an external server; the suite connects
      // anyway and asserts the log has no `server not started`.
      'openVsCode.autoStart': false,
    },
    null,
    2,
  ),
);

/**
 * Configuration of `fakeServer.test.ts` (issue #41): the extension runs the synthetic opencode
 * (`fake-opencode.mjs`) as ITS OWN server, with a workspace folder open, so the whole path
 * setting -> detection -> spawn -> `{url}` -> stream -> turn, plus the editor cases that need a
 * folder, runs in CI without a network or a model. Not opt-in.
 *
 * How the extension launches a `.mjs`: the Test-mode seam of `src/extension/testLaunch.ts`
 * (`ExtensionMode.Test` + `OPEN_VS_CODE_TEST_NODE`, set in `env` above) runs it as
 * `node <mjs>`. The profile's `settings.json` is written HERE, before VS Code starts, with
 * `openVsCode.opencodePath` at the fixture, so the FIRST activation already detects it; writing it
 * from a test would race a PATH-detected opencode on a developer machine (see the header of
 * `realOpencode.test.ts`).
 *
 * Folders live under `.vscode-test/` of THIS checkout (ignored by git, and per worktree, unlike
 * `os.tmpdir()` which two worktrees would share). `workspace` is the served folder; `outside` is
 * where the OutsideWorkspace case writes. Both are wiped and recreated on every load, while no
 * VS Code of this configuration is running: a delete from inside the suite right after closing an
 * editor has hit EPERM on Windows (see the case in `fakeServer.test.ts`). The wipe is best effort:
 * a failure only warns, because the tests rewrite what they use.
 * `FAKE_OPENCODE_LIFETIME_MS` raises the fixture's 60 s lifetime to 10 min: the suite takes about
 * 27 s locally, but the fixture is a stand-in that must outlive the slowest CI runner, and a
 * server that exits on its own looks like a crash to the manager ("restarting in 1 s").
 * XDG dirs are private as a safety net, like `external-server`. `--password-store=basic`: see
 * `externalServer`. VERIFIED on Windows 11, VS Code 1.143.0 (22/10/2026): `npm run test:integration
 * -- --label fake-server` printed "15 passing" in three consecutive runs (26-27 s each), and with the
 * lifetime variable set to 5000 the later cases failed. UNVERIFIED on macOS and Linux until the CI
 * runs it.
 */
const fakeRoot = path.join(import.meta.dirname, '.vscode-test', 'fake-server');
const fakeUserDataDir = path.join(import.meta.dirname, '.vscode-test', 'user-data-fake');
const fakeWorkspace = path.join(fakeRoot, 'workspace');
const fakeOutside = path.join(fakeRoot, 'outside');
const fakeOpencode = path.join(
  import.meta.dirname,
  'src',
  'extension',
  'test-fixtures',
  'fake-opencode.mjs',
);
const fakeServer = {
  ...common,
  label: 'fake-server',
  env: {
    ...env,
    OPEN_VS_CODE_TEST_USER_DATA_DIR: fakeUserDataDir,
    OPEN_VS_CODE_TEST_FAKE_OUTSIDE_DIR: fakeOutside,
    FAKE_OPENCODE_LIFETIME_MS: '600000',
    XDG_DATA_HOME: path.join(import.meta.dirname, '.vscode-test', 'fake-server-xdg', 'data'),
    XDG_STATE_HOME: path.join(import.meta.dirname, '.vscode-test', 'fake-server-xdg', 'state'),
    XDG_CACHE_HOME: path.join(import.meta.dirname, '.vscode-test', 'fake-server-xdg', 'cache'),
  },
  files: 'out/test/integration/fakeServer.test.js',
  workspaceFolder: fakeWorkspace,
  launchArgs: [
    '--disable-extensions',
    `--user-data-dir=${fakeUserDataDir}`,
    '--disable-workspace-trust',
    '--password-store=basic',
  ],
  mocha: { ...common.mocha, timeout: 60000 },
};
try {
  fs.rmSync(fakeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch (error) {
  console.warn(
    `could not wipe ${fakeRoot}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
fs.mkdirSync(fakeWorkspace, { recursive: true });
fs.mkdirSync(fakeOutside, { recursive: true });
// Issue #33: a project command, written BEFORE VS Code starts because the fixture does not emit
// `command.updated` when a file appears, so the host would only see it after a catalog reload. CRLF
// on purpose: a `.md` written on Windows has it, and the fixture's frontmatter parser must cope.
fs.mkdirSync(path.join(fakeWorkspace, '.opencode', 'command'), { recursive: true });
fs.writeFileSync(
  path.join(fakeWorkspace, '.opencode', 'command', 'hello.md'),
  '---\r\ndescription: Say hello to someone\r\n---\r\nGreet $ARGUMENTS warmly.\r\n',
);
fs.mkdirSync(path.join(fakeUserDataDir, 'User'), { recursive: true });
fs.writeFileSync(
  path.join(fakeUserDataDir, 'User', 'settings.json'),
  JSON.stringify(
    { 'openVsCode.opencodePath': fakeOpencode, 'openVsCode.chatLocation': TEST_CHAT_LOCATION },
    null,
    2,
  ),
);

/**
 * Configuration of `defaultLocation.test.ts` (E5 of #77): the default of `openVsCode.chatLocation`
 * as a user with a NEW profile sees it.
 *
 * Why its own profile: every other profile carries the `sidebar` baseline of
 * {@link TEST_CHAT_LOCATION}, so none of them can tell what happens with no key. This one has its
 * own user data dir, deleted and recreated with a `settings.json` of `{}` on every load (a dead
 * run cannot leave the key, globalState or an open tab behind), no folder (like `main`: no server, every tab lazy) and no extensions
 * but ours. The suite reads the log of the FIRST activation of this window, so it must be the
 * only suite of the configuration. Not opt-in: it needs no server and no model.
 * `--password-store=basic`, as in the other private profiles, for SecretStorage under `xvfb-run`.
 * UNVERIFIED on macOS and Linux until the CI runs it.
 */
const defaultUserDataDir = path.join(import.meta.dirname, '.vscode-test', 'user-data-default');
const defaultLocation = {
  ...common,
  label: 'default-location',
  env: { ...env, OPEN_VS_CODE_TEST_USER_DATA_DIR: defaultUserDataDir },
  files: 'out/test/integration/defaultLocation.test.js',
  launchArgs: [
    '--disable-extensions',
    `--user-data-dir=${defaultUserDataDir}`,
    '--password-store=basic',
  ],
};
// Wiped like `fakeRoot`, so a dead run cannot leave globalState or an open tab behind: the profile
// is NEW on every load. Best effort: a failure only warns, because `settings.json` is rewritten.
try {
  fs.rmSync(defaultUserDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch (error) {
  console.warn(
    `could not wipe ${defaultUserDataDir}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
fs.mkdirSync(path.join(defaultUserDataDir, 'User'), { recursive: true });
fs.writeFileSync(path.join(defaultUserDataDir, 'User', 'settings.json'), '{}\n');

/**
 * Configuration of `projectPlugins.test.ts` (issue #153): the extension, set to run the synthetic
 * opencode as its own server, opens a folder whose `.opencode/plugins/` holds a plugin and must NOT
 * launch it without consent. Its own profile, deleted and recreated on every load (a decision
 * stored in `globalState` by a previous run would turn the case into a different one), and its own
 * folder under `.vscode-test/` of THIS checkout, whose ancestors carry no opencode config (checked
 * 03/11/2026 for the repository and its parent). The suite reads the log of the FIRST activation, so
 * it must be the only suite of the configuration. Since issue #158 the suite also writes into that
 * workspace while the server runs (case I3: it removes `demo.js`, then adds and removes plugin and
 * command files), so the folder is rebuilt below on every load. `--password-store=basic`, as in the other private
 * profiles. UNVERIFIED on macOS and Linux until the CI runs it.
 */
const pluginsRoot = path.join(import.meta.dirname, '.vscode-test', 'project-plugins');
const pluginsUserDataDir = path.join(pluginsRoot, 'user-data');
const pluginsWorkspace = path.join(pluginsRoot, 'workspace');
const projectPlugins = {
  ...common,
  label: 'project-plugins',
  env: {
    ...env,
    OPEN_VS_CODE_TEST_USER_DATA_DIR: pluginsUserDataDir,
    FAKE_OPENCODE_LIFETIME_MS: '600000',
    XDG_DATA_HOME: path.join(pluginsRoot, 'xdg', 'data'),
    XDG_STATE_HOME: path.join(pluginsRoot, 'xdg', 'state'),
    XDG_CACHE_HOME: path.join(pluginsRoot, 'xdg', 'cache'),
  },
  files: 'out/test/integration/projectPlugins.test.js',
  workspaceFolder: pluginsWorkspace,
  launchArgs: [
    '--disable-extensions',
    `--user-data-dir=${pluginsUserDataDir}`,
    '--disable-workspace-trust',
    '--password-store=basic',
  ],
  mocha: { ...common.mocha, timeout: 60000 },
};
try {
  fs.rmSync(pluginsRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch (error) {
  console.warn(
    `could not wipe ${pluginsRoot}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
fs.mkdirSync(path.join(pluginsWorkspace, '.opencode', 'plugins'), { recursive: true });
fs.writeFileSync(
  path.join(pluginsWorkspace, '.opencode', 'plugins', 'demo.js'),
  'export default {};\n',
);
fs.mkdirSync(path.join(pluginsUserDataDir, 'User'), { recursive: true });
fs.writeFileSync(
  path.join(pluginsUserDataDir, 'User', 'settings.json'),
  JSON.stringify(
    { 'openVsCode.opencodePath': fakeOpencode, 'openVsCode.chatLocation': TEST_CHAT_LOCATION },
    null,
    2,
  ),
);

/**
 * Configuration of `localeEs.test.ts` (E11-i18n): the extension in a VS Code that really runs in
 * Spanish, so the manifest and the host texts can be read translated.
 *
 * Why it is not just `--locale=es`: without a language pack VS Code resolves `en`, and the pack
 * that `installExtensions` of test-cli installs lands in the DEFAULT profile, not in ours. The
 * recipe (spike of 04/11/2026, details in `test/visual/languagePack.mjs`): the pack goes into a
 * private extensions dir, one throw-away window registers it in `languagepacks.json` of the private
 * user data dir, and the real run (`--locale=es`, extensions disabled but ours) resolves `es`. It
 * runs at load time ONLY when this label is selected (`--label locale-es`) or no label is given,
 * because it downloads the pack and opens a window for a few seconds the first time; the profile is
 * kept between runs (`.vscode-test/user-data-es`, `.vscode-test/extensions-es`), so later loads do
 * nothing. A failure throws and stops the run: a Spanish suite that silently ran in English would
 * prove nothing. No folder (no server), `--password-store=basic` as in the other private profiles.
 * VERIFIED on Windows 11, VS Code 1.145.0 (04/11/2026, the full integration run on the final tree
 * of E11-i18n, 4 passing): `--label locale-es` passed "runs in a Spanish VS Code", "reads the
 * manifest title of Show Logs in Spanish", "reads the title of every command and the description
 * of a setting in Spanish" and "logs the host locale es with the loaded bundle". Needs the
 * network the first time (Marketplace
 * download of the pack): on CI it is one more download per OS. UNVERIFIED on macOS and Linux until
 * the CI runs it.
 */
const localeEsUserDataDir = path.join(import.meta.dirname, '.vscode-test', 'user-data-es');
const localeEsExtensionsDir = path.join(import.meta.dirname, '.vscode-test', 'extensions-es');
const localeEs = {
  ...common,
  label: 'locale-es',
  env: { ...env, OPEN_VS_CODE_TEST_USER_DATA_DIR: localeEsUserDataDir },
  files: 'out/test/integration/localeEs.test.js',
  launchArgs: [
    '--disable-extensions',
    `--user-data-dir=${localeEsUserDataDir}`,
    `--extensions-dir=${localeEsExtensionsDir}`,
    '--locale=es',
    '--password-store=basic',
  ],
};
/**
 * The labels named on the command line (`--label a,b`, `--label=a`, repeated); empty means all.
 * `-l` is the alias `@vscode/test-cli` declares for `--label` (`option('label', { alias: 'l' })` in
 * `node_modules/@vscode/test-cli/out/cli/args.mjs`), so `-l main` and `-l=main` count too: without
 * them the language pack would be prepared (download plus warm-up window) for a run that does not
 * ask for `locale-es`. HYPOTHESIS for `-l=x` (yargs reads it as `-l x`; not run here).
 */
function requestedLabels(argv) {
  const labels = [];
  argv.forEach((arg, index) => {
    const value =
      arg === '--label' || arg === '-l'
        ? argv[index + 1]
        : arg.startsWith('--label=')
          ? arg.slice('--label='.length)
          : arg.startsWith('-l=')
            ? arg.slice('-l='.length)
            : '';
    if (value) labels.push(...value.split(','));
  });
  return labels;
}
const labelsAsked = requestedLabels(process.argv);
if (labelsAsked.length === 0 || labelsAsked.includes('locale-es')) {
  await prepareLanguagePackForStable({
    userDataDir: localeEsUserDataDir,
    extensionsDir: localeEsExtensionsDir,
    packId: LANGUAGE_PACK_ES,
    locale: 'es',
  });
}

export default defineConfig(
  process.env.OPEN_VS_CODE_REAL_OPENCODE
    ? [main, realOpencode, externalServer, fakeServer, defaultLocation, projectPlugins, localeEs]
    : [main, externalServer, fakeServer, defaultLocation, projectPlugins, localeEs],
);
