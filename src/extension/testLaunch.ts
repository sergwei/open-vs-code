// Test-mode seam that lets the integration suite `fake-server` (issue #41) and, with an explicit
// opt-in, `npm run test:visual` (tooling/tests-without-model) run the synthetic opencode
// (`fake-opencode.mjs`) as the extension's OWN server. Pure logic: no `vscode` import, so Vitest
// covers it; the VS Code side only passes `context.extensionMode` in (`binaryDetection.ts`,
// `serverLifecycle.ts`).

import path from 'node:path';
import type { RunningServer, StartServerOptions } from './opencodeServer';

/** Environment variable that carries the Node executable the seam uses (set by `.vscode-test.mjs`). */
export const TEST_NODE_ENV = 'OPEN_VS_CODE_TEST_NODE';

/** Node executable used to run a `.mjs` stand-in for the opencode binary. */
export interface TestLaunch {
  nodePath: string;
}

/** The command line a binary path is run with: the executable and the args before `--version`/`serve`. */
export interface LaunchCommand {
  command: string;
  args: string[];
}

/**
 * Environment variable that, together with {@link TEST_NODE_ENV}, switches the seam on in
 * `ExtensionMode.Development` (set only by `test/visual/vscodeProcess.mjs`).
 */
export const VISUAL_FAKE_ENV = 'OPEN_VS_CODE_VISUAL_FAKE';

/** The two `ExtensionMode`s that can switch the seam on, as flags (this module imports no `vscode`). */
export interface LaunchModes {
  /** `context.extensionMode === ExtensionMode.Test`. */
  test: boolean;
  /** `context.extensionMode === ExtensionMode.Development`. */
  development: boolean;
}

/**
 * Decides whether the seam is on: with `OPEN_VS_CODE_TEST_NODE` set to an absolute path AND either
 * `ExtensionMode.Test`, or `ExtensionMode.Development` with `OPEN_VS_CODE_VISUAL_FAKE=1`.
 *
 * Conditions are on purpose. `ExtensionMode.Test` is what VS Code sets for an extension loaded by
 * the test runner. `npm run test:visual` launches VS Code with `--extensionDevelopmentPath` and no
 * `--extensionTestsPath`, which is `Development` (HYPOTHESIS read in VS Code's
 * `extHostExtensionService.ts`; VERIFIED by a mutation on Windows 11, VS Code 1.143.0
 * (22/10/2026): with `vscodeProcess.mjs` setting `OPEN_VS_CODE_VISUAL_FAKE` to `0`,
 * `npm run test:visual` logged `binary detection failed: spawn EFTYPE` and failed "the webview
 * shows "Connected"", so that run is not in `ExtensionMode.Test` and the opt-in is what turns the
 * seam on), so that mode needs its own
 * explicit opt-in: a developer pressing F5 gets nothing unless they export BOTH variables.
 * Production (an installed `.vsix`) is never on, whatever the environment says; a `.mjs` setting
 * there still fails as before. This widens the "Test mode only" decision of #41 on purpose
 * (Sergio, 22/10/2026). Returns `undefined` when off; the other functions of this module then
 * behave as the identity. A relative or empty path counts as unset, and only the exact value `1`
 * counts as the opt-in.
 * VERIFIED by `testLaunch.test.ts` (on in Test; on in Development only with both variables; off in
 * Development without the opt-in; off in production with everything set; empty and relative
 * values). VERIFIED in a real VS Code 1.143.0 on Windows 11 (22/10/2026) by the `fake-server`
 * suite: with the seam on the log said `binary detection: setting ...fake-opencode.mjs: ok
 * (version 2.0.32)`, and with the function forced to return `undefined` the same run logged
 * `binary detection failed: spawn EFTYPE` and 13 of 15 cases failed. NOT observed: the real
 * `ExtensionMode` value of an installed `.vsix`. UNVERIFIED on macOS/Linux until the CI runs the
 * suite.
 */
export function testLaunchFrom(
  modes: LaunchModes,
  env: Record<string, string | undefined>,
): TestLaunch | undefined {
  const nodePath = env[TEST_NODE_ENV];
  if (nodePath === undefined || !path.isAbsolute(nodePath)) return undefined;
  const optedIn = modes.test || (modes.development && env[VISUAL_FAKE_ENV] === '1');
  return optedIn ? { nodePath } : undefined;
}

/**
 * Builds the {@link LaunchModes} of an `ExtensionMode` value by comparing it with the two numeric
 * constants the caller passes (`vscode.ExtensionMode.Test` / `.Development`), so both call sites
 * share one mapping without this module importing `vscode`.
 */
export function launchModesOf(mode: number, test: number, development: number): LaunchModes {
  return { test: mode === test, development: mode === development };
}

/**
 * Whether `binaryPath` is a Node script that the seam must run through Node (a `.mjs` extension,
 * any case). A real opencode is a native executable (`.exe` or extensionless), never `.mjs`.
 */
function isScript(binaryPath: string): boolean {
  return /\.mjs$/i.test(binaryPath);
}

/**
 * Builds the resolver that `nodeDeps` uses to run `<binary> --version`: with the seam on, a `.mjs`
 * becomes `node <mjs> --version`; anything else, or the seam off, is run as is.
 *
 * Returns the command and the args BEFORE `--version` (the caller appends it), so the detection
 * keeps its single `execFile` with `shell: false` and the 10 s timeout.
 * VERIFIED by `testLaunch.test.ts` (rewrite, and identity for a `.exe`, an extensionless path and
 * the seam off) and by the `fake-server` suite on Windows 11 (22/10/2026), where the detection of
 * the `.mjs` fixture ended `ok (version 2.0.32)` through this resolver.
 */
export function launchCommandFor(
  launch: TestLaunch | undefined,
): (binaryPath: string) => LaunchCommand {
  return (binaryPath) =>
    launch !== undefined && isScript(binaryPath)
      ? { command: launch.nodePath, args: [binaryPath] }
      : { command: binaryPath, args: [] };
}

/**
 * Wraps `startServer` so that, with the seam on, a `.mjs` command is started as
 * `node <mjs> serve ...` through `StartServerOptions.prefixArgs` (which already exists for the
 * Vitest fixtures); with the seam off the function is returned untouched.
 *
 * Any `prefixArgs` the caller already gave stay after the script path. The process is still
 * spawned by `startServer` itself (`shell: false`, process group on POSIX), with Node as the group
 * leader, so the tree kill should work as for a real binary (HYPOTHESIS on POSIX: the group
 * leader is the node process; to check, the CI of macOS/Linux running the restart case).
 * VERIFIED by `testLaunch.test.ts` for the option rewrite. VERIFIED on Windows 11 with VS Code
 * 1.143.0 (22/10/2026) by the `fake-server` cases "restart replaces the server: new pid, stream
 * reconnected, old process gone" and "a killed server is restarted automatically after 1 s".
 * UNVERIFIED on macOS/Linux.
 */
export function wrapStartServer(
  start: (options: StartServerOptions) => Promise<RunningServer>,
  launch: TestLaunch | undefined,
): (options: StartServerOptions) => Promise<RunningServer> {
  if (launch === undefined) return start;
  return (options) =>
    isScript(options.command)
      ? start({
          ...options,
          command: launch.nodePath,
          prefixArgs: [options.command, ...(options.prefixArgs ?? [])],
        })
      : start(options);
}
