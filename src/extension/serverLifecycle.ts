import * as vscode from 'vscode';
import { notifyUnlessChatShows, type ChatSurfaceGate } from './chatSurfaceGate';
import type { DetectionResult } from './opencodeBinary';
import { fetchServerInfo, safeLog, startServer, stopServer } from './opencodeServer';
import {
  RESTART_SERVER_COMMAND_ID,
  SELECT_FOLDER_COMMAND_ID,
  SERVER_URL_SETTING,
  SET_SERVER_PASSWORD_COMMAND_ID,
} from './ids';
import { failureActions, ForgottenPasswords } from './externalServer';
import { readServerTarget, registerServerCredentials } from './serverCredentials';
import {
  describeServerFailure,
  describeServerState,
  pickWorkspaceFolder,
  ServerManager,
  type ServerState,
} from './serverManager';
import { launchModesOf, testLaunchFrom, wrapStartServer } from './testLaunch';

/**
 * `workspaceState` key of the folder the user chose to serve (an `fsPath`). Not a secret. The
 * choice is remembered per workspace and used only while that folder is still open on disk.
 */
const SERVED_FOLDER_KEY = 'openVsCode.servedFolder';

/**
 * Restarts the server (the command, the toolbar button and the webview's Restart button) and,
 * when nothing could be restarted, tells the user why instead of failing silently. With an
 * external target (issue #11) "restart" means reconnect: the external server is not ours to
 * restart, and the manager never answers `no-binary` in that case.
 *
 * Resolves after the restart attempt settled; the outcome of the new start is the manager's
 * state, not this function's. `no-binary` (no detection accepted an opencode v2 yet) and
 * `no-workspace` (no folder on disk) are the two cases the manager refuses; both show a warning
 * that points at the log. UNVERIFIED in a real window (the warning text and its placement).
 */
export async function restartServerWithFeedback(manager: ServerManager): Promise<void> {
  const result = await manager.restart('command');
  if (result === 'no-binary') {
    void vscode.window.showWarningMessage(
      'OpenCode cannot restart the server: no opencode v2 executable has been found. Set "openVsCode.opencodePath" or install opencode v2.',
    );
  } else if (result === 'no-workspace') {
    void vscode.window.showWarningMessage(
      'OpenCode cannot restart the server: open a folder from disk first.',
    );
  }
}

/**
 * Runs the button the user pressed on a server-failure notification (`failureActions`). `undefined`
 * means the notification was dismissed. Retry and Restart Server are the same action: the
 * manager restarts its own server, or reconnects to the external one. UNVERIFIED in a real window
 * (no test API for notification buttons); the underlying commands are the ones the integration
 * suites call.
 */
async function runFailureAction(
  choice: string | undefined,
  manager: ServerManager,
  channel: vscode.LogOutputChannel,
): Promise<void> {
  switch (choice) {
    case 'Show Logs':
      channel.show();
      break;
    case 'Set Password':
      await vscode.commands.executeCommand(SET_SERVER_PASSWORD_COMMAND_ID);
      break;
    case 'Open Settings':
      await vscode.commands.executeCommand('workbench.action.openSettings', SERVER_URL_SETTING);
      break;
    case 'Retry':
    case 'Restart Server':
      await restartServerWithFeedback(manager);
      break;
    default:
      break;
  }
}

/**
 * Wires the server lifecycle (issues #8, #10, #11) into VS Code and returns what `activate` needs.
 *
 * Thin adapter over the pure `serverManager.ts`: picks the workspace folder to serve (the one the
 * user chose with "Select Workspace Folder", else the first on disk), builds the manager
 * with the real process functions and the OpenCode channel as log, mirrors every state change
 * into the log, and shows an error notification (with Show Logs and Restart Server buttons) when
 * a server we tried to run fails for good (a crash that the manager is still retrying is silent:
 * `describeServerFailure`). `onDetection` is meant for `registerBinaryDetection`, so the server
 * starts as soon as a usable binary is found (decision of Sergio, 2026-10-20).
 *
 * Phase 3 (issue #10) registers two commands (restart, select folder) and listens to
 * `onDidChangeWorkspaceFolders`: a removed served folder moves to the first one left and restarts.
 * VERIFIED in the VS Code docs (`vscode.d.ts` 1.105, read) that the event does NOT fire when the
 * FIRST folder changes: the extension host restarts instead, which goes through
 * `deactivate`/`activate` and this function again. Only the commands' registration is exercised by
 * the integration suite (`lifecycle.test.ts`); folder changes in a real multi-root window are
 * UNVERIFIED (F5 point 9).
 *
 * Neither the stop nor the channel is a disposable in `context.subscriptions`: VS Code disposes
 * those right after calling `deactivate` without awaiting them, which would pre-empt the polite
 * stop, and a disposed `LogOutputChannel` THROWS on every log call (VERIFIED by `reviewer` in the
 * VS Code 1.142 bundle). So the caller (`extension.ts`) keeps the channel out of the
 * subscriptions, returns `manager.stop()` from `deactivate` and disposes the channel only when
 * that Promise settles. The state listener stays subscribed meanwhile, so the shutdown is visible
 * in the log. As defence in depth every log call made here goes through `safeLog`, so even a
 * channel closed early cannot interrupt a transition or the tree kill. The two commands and the
 * folder listener are plain disposables in `context.subscriptions` (they hold no process).
 * External server (issue #11): the target the manager follows (own process or the server in
 * `openVsCode.serverUrl`) is read with `readServerTarget` and refreshed whenever the setting or
 * the stored password changes, so no reload is needed. E2 (issue #85, P3=2): the optional `gate`
 * silences the failure notification while the chat is visible and ready (its card or guide shows
 * the failure with the same buttons); without a gate, or with the chat hidden, it appears as
 * before. UNVERIFIED in a real window (the decision itself is unit-tested). `registerServerLifecycle` stays
 * SYNCHRONOUS even though `secrets.get` is not: everything is registered at once and the target
 * is resolved right after, in the background. The alternative (making the function async, so the
 * target is known before the first detection) would have forced `activate`, and every caller,
 * to await a keychain that can be slow. The window that leaves open is closed on purpose: the
 * binary detection decides by reading the setting synchronously (it skips itself when the URL is
 * set), and the manager ignores detections while the target is external, so no process can be
 * launched in that gap. A resolution that lost the race against a newer one is dropped (run
 * counter). A Forget Server Password is remembered per origin (`ForgottenPasswords`) so a password
 * that VS Code hands back right after it is not used. The failure notification takes its buttons from `failureActions(reason)`: Set
 * Password, Open Settings, Retry or Restart Server (the last two both reconnect when the target is
 * external) and Show Logs.
 * Workspace Trust: the extension declares no `capabilities.untrustedWorkspaces`, so it does not
 * activate in Restricted Mode and nothing is launched against an untrusted folder (HYPOTHESIS:
 * VS Code's documented default, not exercised).
 * The underlying start and stop are VERIFIED against the real opencode 2.0.32 on Windows 11
 * (bundled code under plain Node, spike on 2026-10-20). VERIFIED in VS Code 1.142.0 on Windows
 * 11 (opt-in `realOpencode.test.ts`, 2026-10-20): the start against a real opencode and its
 * `starting the server` and `server ready` log lines. UNVERIFIED in VS Code: the notification
 * and its buttons, and that the stop on `deactivate` leaves no process behind; POSIX UNVERIFIED.
 * Issue #41: in `ExtensionMode.Test` with `OPEN_VS_CODE_TEST_NODE` set (or in
 * `ExtensionMode.Development` with that variable plus `OPEN_VS_CODE_VISUAL_FAKE=1`, which only
 * `npm run test:visual` sets), `start` runs a `.mjs` binary as `node <mjs> serve ...`
 * (`testLaunch.ts`); otherwise, and always in production, it is `startServer` itself.
 */
export function registerServerLifecycle(
  context: vscode.ExtensionContext,
  channel: vscode.LogOutputChannel,
  gate?: ChatSurfaceGate,
): {
  manager: ServerManager;
  onDetection: (result: DetectionResult) => void;
} {
  const log = safeLog(channel);
  const manager = new ServerManager({
    // Seam of issue #41: `startServer` itself unless the host is a test host or the visual run's
    // explicit opt-in (never in production). See `testLaunchFrom`.
    start: wrapStartServer(
      startServer,
      testLaunchFrom(
        launchModesOf(
          context.extensionMode,
          vscode.ExtensionMode.Test,
          vscode.ExtensionMode.Development,
        ),
        process.env,
      ),
    ),
    stop: (server) => stopServer(server.child, log),
    fetchInfo: (url, password, signal) =>
      fetchServerInfo(url, password, undefined, undefined, signal),
    log,
  });
  const preferred = (): string | undefined => context.workspaceState.get<string>(SERVED_FOLDER_KEY);
  manager.setFolder(pickWorkspaceFolder(vscode.workspace.workspaceFolders, preferred()));

  let previous: ServerState = manager.state;
  // `setFolder` may already have moved to `unavailable/no-workspace`, before anyone listened.
  if (previous.kind !== 'idle') {
    const initial = describeServerState(previous);
    log[initial.level](initial.message);
  }
  manager.onDidChangeState((next) => {
    const description = describeServerState(next);
    log[description.level](description.message);
    const failure = describeServerFailure(previous, next);
    previous = next;
    if (failure !== undefined) {
      const reason = next.kind === 'unavailable' ? next.reason : 'start-failed';
      // E2 (issue #85, P3=2): while the chat is showing, its card or guide carries the same
      // buttons, so the native notification would only duplicate them.
      notifyUnlessChatShows(
        () => gate?.isShowing() ?? false,
        () => {
          void vscode.window
            .showErrorMessage(failure, ...failureActions(reason))
            .then((choice) => runFailureAction(choice, manager, channel));
        },
      );
    }
  });

  // The target is resolved in the background (see the header); a stale resolution is dropped.
  let targetRun = 0;
  const forgotten = new ForgottenPasswords();
  const refreshTarget = (): void => {
    const run = ++targetRun;
    readServerTarget(context, log, forgotten)
      .then((target) => {
        if (run === targetRun) manager.setTarget(target);
      })
      .catch((error: unknown) => {
        log.error(
          `could not resolve the server target: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  };
  registerServerCredentials(context, log, refreshTarget, forgotten);
  refreshTarget();

  context.subscriptions.push(
    vscode.commands.registerCommand(RESTART_SERVER_COMMAND_ID, async () => {
      await restartServerWithFeedback(manager);
    }),
    vscode.commands.registerCommand(SELECT_FOLDER_COMMAND_ID, async () => {
      const folders = (vscode.workspace.workspaceFolders ?? []).filter(
        (folder) => folder.uri.scheme === 'file',
      );
      if (folders.length < 2) {
        void vscode.window.showInformationMessage(
          'OpenCode: only one folder is open, so there is nothing to choose.',
        );
        return;
      }
      const serving = pickWorkspaceFolder(vscode.workspace.workspaceFolders, preferred());
      const servedPath = 'folder' in serving ? serving.folder : undefined;
      const picked = await vscode.window.showQuickPick(
        folders.map((folder) => ({
          label: folder.name,
          description: folder.uri.fsPath,
          detail: folder.uri.fsPath === servedPath ? 'Currently served' : undefined,
          fsPath: folder.uri.fsPath,
        })),
        { title: 'OpenCode: choose the folder to serve', placeHolder: 'Folder' },
      );
      if (picked === undefined) return;
      await context.workspaceState.update(SERVED_FOLDER_KEY, picked.fsPath);
      manager.setFolder(pickWorkspaceFolder(vscode.workspace.workspaceFolders, picked.fsPath));
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      manager.setFolder(pickWorkspaceFolder(vscode.workspace.workspaceFolders, preferred()));
    }),
  );

  return { manager, onDetection: (result) => manager.onDetection(result) };
}
