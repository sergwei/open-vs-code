import * as vscode from 'vscode';
import { registerBinaryDetection } from './binaryDetection';
import { registerChat } from './chatLifecycle';
import { LOG_CHANNEL_NAME, SHOW_LOGS_COMMAND_ID } from './ids';
import { registerServerLifecycle } from './serverLifecycle';
import type { ServerManager } from './serverManager';

/** The window's server manager, kept at module level so `deactivate` can stop it. */
let serverManager: ServerManager | undefined;

/**
 * The log channel, also at module level and deliberately NOT in `context.subscriptions`: VS Code
 * disposes those right after calling `deactivate`, and a disposed channel throws on every log
 * call, so the shutdown could not log (or, before the fix, could not even kill). `deactivate`
 * disposes it once the stop has finished.
 */
let logChannel: vscode.LogOutputChannel | undefined;

/**
 * Extension entry point: creates the log channel, registers the commands, the server lifecycle
 * (with its restart and select-folder commands, issue #10) and the chat (view, client and event
 * stream, issues #9/#14, plus the permission, question and attention features of phase 3, wired
 * to the manager's state), and starts opencode binary detection, whose usable results start
 * `opencode serve` in the served workspace folder (issue #8; the manager is kept for
 * `deactivate`). The lifecycle is registered before the chat because the chat subscribes to the
 * manager and uses its restart helper.
 * The server start path is VERIFIED against the real opencode 2.0.32 outside VS Code (bundled
 * code under plain Node, Windows 11, spike on 2026-10-20). UNVERIFIED inside VS Code (F5 or
 * the opt-in `realOpencode.test.ts`) and on POSIX.
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
  logChannel = channel; // disposed by `deactivate` after the stop, see `logChannel`

  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_LOGS_COMMAND_ID, () => {
      channel.show();
    }),
  );

  const lifecycle = registerServerLifecycle(context, channel);
  serverManager = lifecycle.manager;
  context.subscriptions.push(registerChat(context, channel, lifecycle.manager));
  registerBinaryDetection(context, channel, lifecycle.onDetection);

  const { version } = context.extension.packageJSON as { version?: unknown };
  channel.info(`open-vs-code ${String(version)} activated`);
}

/**
 * Extension shutdown hook: returns the Promise that stops `opencode serve` (issue #8) and then
 * disposes the log channel.
 *
 * `context.subscriptions` disposables are not awaited, only the Promise returned from here is
 * (vscode-extension skill, §5), and VS Code disposes the subscriptions right after calling this
 * without waiting for the Promise, so the stop lives here and not in a disposable; the log
 * channel is kept out of the subscriptions for the same reason and is disposed in `finally`,
 * once the stop settled (a closed channel throws on every log call). The stop closes the
 * server's stdin, gives it 2 s and then kills the process tree: about 3 s in total plus the
 * run time of `taskkill`/`kill`, which is not bounded here (a start still in progress is
 * aborted, including a pending `/api/info`; an attempt aborted before the url line kills its
 * child at once, one aborted during `/api/info` goes through the same 2 s + kill). That fits the
 * ~5 s VS Code gives all extensions on window close ("Give extensions at most 5 seconds to wrap
 * up any async deactivate", `extHostExtensionService.ts` on the microsoft/vscode main branch,
 * read 2026-10-20; HYPOTHESIS for the 1.105 line, not run). If `deactivate` never runs, the OS
 * closes the child's stdin when the host dies and the server exits by itself (read in
 * `server-process.ts@v2.0.32`; VERIFIED with the real opencode 2.0.32 on Windows 11, spike on
 * 2026-10-20: it exits by itself when its parent process dies, but the parent was a plain Node
 * process, not an extension host; POSIX UNVERIFIED). Without a manager (activation did not get
 * that far) it only disposes the channel and returns `undefined`.
 */
export function deactivate(): Promise<void> | undefined {
  if (serverManager === undefined) {
    logChannel?.dispose();
    return undefined;
  }
  return serverManager.stop().finally(() => {
    logChannel?.dispose();
  });
}
