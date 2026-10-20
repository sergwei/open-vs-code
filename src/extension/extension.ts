import * as vscode from 'vscode';
import { registerBinaryDetection } from './binaryDetection';
import { registerChatView } from './chatViewProvider';
import { LOG_CHANNEL_NAME, SHOW_LOGS_COMMAND_ID } from './ids';

/**
 * Extension entry point: creates the log channel, registers the commands and the chat view,
 * and starts opencode binary detection.
 *
 * Kept thin on purpose, with one call per feature, so that parallel issues
 * (#2 webview provider, #7 binary detection) each add a single line here and
 * merge without conflicts. Activation is implicit: the contributed command and
 * view trigger it (VS Code >= 1.74), so `activationEvents` stays empty.
 * VERIFIED on Windows 11 with F5 (VS Code 1.142, 2026-10-19): the Activity Bar
 * icon shows up, "OpenCode: Show Logs" activates the extension and the channel
 * shows `open-vs-code 0.0.1 activated`, in light and dark themes.
 * macOS/Linux UNVERIFIED.
 *
 * `ExtensionContext.extension.packageJSON` is `any` in @types/vscode 1.105.0, so the `version`
 * read narrows it with an assertion to `{ version?: unknown }` to satisfy the typed lint rules;
 * a missing version would print "undefined".
 * VERIFIED with F5 on Windows 11 (VS Code 1.142, 2026-10-20, issue #2 branch, PR #49): the
 * channel shows
 * `open-vs-code 0.0.1 activated` and `Chat view resolved`, and the chat view renders the
 * bundled app in light, dark and high-contrast themes.
 * VERIFIED with F5 on Windows 11 (2026-10-20, issue #7 branch), read in the OpenCode log: with
 * no opencode on PATH it tries opencode2 then opencode and warns; with the setting pointing at
 * node.exe it reports "requires opencode v2 (found 24.22.0 ...)"; a relative setting is reported
 * as invalid; and changing the setting re-runs detection without reloading the window.
 */
export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel(LOG_CHANNEL_NAME, { log: true });
  context.subscriptions.push(channel);

  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_LOGS_COMMAND_ID, () => {
      channel.show();
    }),
  );

  context.subscriptions.push(registerChatView(context.extensionUri, channel));
  registerBinaryDetection(context, channel);

  const { version } = context.extension.packageJSON as { version?: unknown };
  channel.info(`open-vs-code ${String(version)} activated`);
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
