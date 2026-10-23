import * as vscode from 'vscode';
import {
  CONFIG_SECTION,
  OPENCODE_PATH_KEY,
  OPENCODE_PATH_SETTING,
  SERVER_URL_KEY,
  SERVER_URL_SETTING,
} from './ids';
import {
  describeDetection,
  detectOpencodeBinary,
  nodeDeps,
  type DetectionResult,
} from './opencodeBinary';
import { launchCommandFor, launchModesOf, testLaunchFrom } from './testLaunch';

const OPEN_SETTINGS = 'Open Settings';
const SHOW_LOGS = 'Show Logs';

/**
 * Wires opencode binary detection (issue #7) into VS Code: runs it now and again whenever
 * `openVsCode.opencodePath` changes.
 *
 * Thin adapter over the pure `opencodeBinary.ts`: reads the setting, logs every attempt,
 * and shows a native notification (not the webview, which does not exist yet and where
 * `viewsWelcome` does not apply; HYPOTHESIS: per the VS Code contribution-points docs,
 * not run, F5 will show it). Fire-and-forget so `activate` never waits on a child
 * process. A run counter drops stale results when the setting changes mid-detection.
 * The result is not cached; it is handed to the optional `onResult` callback (issue #8 uses it
 * to start the server), called after stale results are dropped and before the notification, so
 * the server start never waits for the user to dismiss it. A throwing callback is logged.
 * VERIFIED in a real VS Code 1.142 on Windows, macOS and Linux by the integration tests of
 * issue #41 (CI run 39414371746, 2026-10-20): the detection log lines for unsupported, relative
 * and missing paths, an accepted v2 binary (POSIX) and re-detection when the setting changes.
 * The notification and its buttons have no test API: seen by hand with F5 on Windows only
 * (2026-10-19). HYPOTHESIS that
 * `workbench.action.openSettings` with a query filters by the setting id.
 *
 * Issue #11: when `openVsCode.serverUrl` is not empty the extension connects to an external
 * server instead of launching one, so the run logs `binary detection skipped: openVsCode.serverUrl
 * is set` and ends there (no attempts, no `onResult`, no notification). It also re-runs when that
 * setting changes, so emptying it brings detection (and the own server) back without a reload.
 * The decision reads the setting synchronously; that is what keeps a process from being launched
 * before the async target (password from SecretStorage) is known. VERIFIED in a real VS Code by
 * `externalServer.test.ts` (the skip line on activation, the detection line after emptying it).
 *
 * Issue #41: in `ExtensionMode.Test` with `OPEN_VS_CODE_TEST_NODE` set (or, for `npm run
 * test:visual`, in `ExtensionMode.Development` with that variable plus `OPEN_VS_CODE_VISUAL_FAKE=1`),
 * a `.mjs` setting is run as `node <mjs> --version` (`testLaunch.ts`), so the `fake-server` suite
 * and the visual run can use the synthetic opencode as the extension's own server. Never in
 * production. Elsewhere (installed `.vsix`, plain F5) the dependencies are the plain
 * `nodeDeps()`, built on every detection (not once at registration) because it captures
 * `process.env.PATH`/`PATHEXT` and the platform when called; only the launch rule is computed
 * once. HYPOTHESIS that this per-detection read matters in practice (it only does if something
 * mutates `process.env.PATH` after activation); no test observes it, since this file needs
 * `vscode` and has no unit test.
 */
export function registerBinaryDetection(
  context: vscode.ExtensionContext,
  channel: vscode.LogOutputChannel,
  onResult?: (result: DetectionResult) => void,
): void {
  let run = 0;
  // Seam of issue #41: `undefined`, hence plain `nodeDeps()`, unless the host is a test host or
  // the visual run's explicit opt-in (never in production). See `testLaunchFrom`.
  // Only the launch rule is fixed at registration; `nodeDeps` runs inside `detect` so that PATH,
  // PATHEXT and the platform are read afresh on every detection.
  const launchFor = launchCommandFor(
    testLaunchFrom(
      launchModesOf(
        context.extensionMode,
        vscode.ExtensionMode.Test,
        vscode.ExtensionMode.Development,
      ),
      process.env,
    ),
  );

  const detect = async (): Promise<void> => {
    const current = ++run;
    // With an external server configured (issue #11) we launch nothing, so there is no binary to
    // find and no warning to give; the manager would ignore the result anyway.
    const serverUrl = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string>(SERVER_URL_KEY, '')
      .trim();
    if (serverUrl !== '') {
      channel.info(`binary detection skipped: ${SERVER_URL_SETTING} is set`);
      return;
    }
    const settingPath = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string>(OPENCODE_PATH_KEY, '')
      .trim();
    const result = await detectOpencodeBinary({ settingPath }, nodeDeps(launchFor));
    if (current !== run) return;

    for (const attempt of result.attempts) {
      const where = attempt.path === undefined ? '' : ` ${attempt.path}`;
      const line = `binary detection: ${attempt.label}${where}: ${attempt.outcome} (${attempt.detail})`;
      if (attempt.outcome === 'ok' || attempt.outcome === 'duplicate') channel.info(line);
      else channel.warn(line);
    }

    const description = describeDetection(result);
    if (description.level === 'info') channel.info(description.message);
    else channel.warn(description.message);
    try {
      onResult?.(result);
    } catch (error) {
      channel.error(
        `binary detection consumer failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (description.notify === 'none') return;

    const buttons = description.notify === 'actions' ? [OPEN_SETTINGS, SHOW_LOGS] : [];
    const choice = await vscode.window.showWarningMessage(description.message, ...buttons);
    if (choice === OPEN_SETTINGS) {
      await vscode.commands.executeCommand('workbench.action.openSettings', OPENCODE_PATH_SETTING);
    } else if (choice === SHOW_LOGS) {
      channel.show();
    }
  };

  const start = (): void => {
    detect().catch((error: unknown) => {
      channel.error(
        `binary detection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration(OPENCODE_PATH_SETTING) ||
        event.affectsConfiguration(SERVER_URL_SETTING)
      ) {
        start();
      }
    }),
  );
  start();
}
