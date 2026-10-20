import * as vscode from 'vscode';
import { CONFIG_SECTION, OPENCODE_PATH_KEY, OPENCODE_PATH_SETTING } from './ids';
import { describeDetection, detectOpencodeBinary, nodeDeps } from './opencodeBinary';

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
 * The result is not cached or exposed: issue #8 decides how it consumes the detection.
 * UNVERIFIED in VS Code: notification, both buttons and the config listener are only
 * checked by hand with F5 (no integration tests yet). HYPOTHESIS that
 * `workbench.action.openSettings` with a query filters by the setting id.
 */
export function registerBinaryDetection(
  context: vscode.ExtensionContext,
  channel: vscode.LogOutputChannel,
): void {
  let run = 0;

  const detect = async (): Promise<void> => {
    const current = ++run;
    const settingPath = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string>(OPENCODE_PATH_KEY, '')
      .trim();
    const result = await detectOpencodeBinary({ settingPath }, nodeDeps());
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
      if (event.affectsConfiguration(OPENCODE_PATH_SETTING)) start();
    }),
  );
  start();
}
