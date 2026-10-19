import * as vscode from 'vscode';
import { LOG_CHANNEL_NAME, SHOW_LOGS_COMMAND_ID } from './ids';

/**
 * Extension entry point: creates the log channel and registers the commands.
 *
 * Kept thin on purpose, with one call per feature, so that parallel issues
 * (#2 webview provider, #7 binary detection) each add a single line here and
 * merge without conflicts. Activation is implicit: the contributed command and
 * view trigger it (VS Code >= 1.74), so `activationEvents` stays empty.
 * VERIFIED on Windows 11 with F5 (VS Code 1.142, 2026-10-19): the Activity Bar
 * icon shows up, "OpenCode: Show Logs" activates the extension and the channel
 * shows `open-vs-code 0.0.1 activated`, in light and dark themes.
 * macOS/Linux UNVERIFIED.
 */
export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel(LOG_CHANNEL_NAME, { log: true });
  context.subscriptions.push(channel);

  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_LOGS_COMMAND_ID, () => {
      channel.show();
    }),
  );

  const version = String(context.extension.packageJSON.version);
  channel.info(`open-vs-code ${version} activated`);
}

/**
 * Extension shutdown hook; intentionally empty for now.
 *
 * It is the place where the server-lifecycle issue will return the Promise
 * that stops `opencode serve`: `context.subscriptions` disposables are not
 * awaited, only the Promise returned from here is (vscode-extension skill, §5).
 * HYPOTHESIS: VS Code does not guarantee `deactivate` runs or give it a time limit.
 */
export function deactivate(): Promise<void> | undefined {
  return undefined;
}
