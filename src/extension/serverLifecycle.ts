import * as vscode from 'vscode';
import type { DetectionResult } from './opencodeBinary';
import { fetchServerInfo, safeLog, startServer, stopServer } from './opencodeServer';
import {
  describeServerFailure,
  describeServerState,
  pickWorkspaceFolder,
  ServerManager,
  type ServerState,
} from './serverManager';

const SHOW_LOGS = 'Show Logs';

/**
 * Wires the server lifecycle (issue #8) into VS Code and returns what `activate` needs.
 *
 * Thin adapter over the pure `serverManager.ts`: picks the workspace folder once (first
 * folder, `file` scheme only; folder changes and multi-root are issue #10), builds the manager
 * with the real process functions and the OpenCode channel as log, mirrors every state change
 * into the log, and shows an error notification (with a Show Logs button) when a server we tried
 * to run fails. `onDetection` is meant for `registerBinaryDetection`, so the server starts as
 * soon as a usable binary is found (decision of Sergio, 2026-10-20).
 *
 * Neither the stop nor the channel is a disposable in `context.subscriptions`: VS Code disposes
 * those right after calling `deactivate` without awaiting them, which would pre-empt the polite
 * stop, and a disposed `LogOutputChannel` THROWS on every log call (VERIFIED by `reviewer` in the
 * VS Code 1.142 bundle). So the caller (`extension.ts`) keeps the channel out of the
 * subscriptions, returns `manager.stop()` from `deactivate` and disposes the channel only when
 * that Promise settles. The state listener stays subscribed meanwhile, so the shutdown is visible
 * in the log. As defence in depth every log call made here goes through `safeLog`, so even a
 * channel closed early cannot interrupt a transition or the tree kill.
 * Takes no `ExtensionContext` because it registers no disposable (see above).
 * Workspace Trust: the extension declares no `capabilities.untrustedWorkspaces`, so it does not
 * activate in Restricted Mode and nothing is launched against an untrusted folder (HYPOTHESIS:
 * VS Code's documented default, not exercised).
 * The underlying start and stop are VERIFIED against the real opencode 2.0.32 on Windows 11
 * (bundled code under plain Node, spike on 2026-10-20). UNVERIFIED in VS Code: log lines,
 * notification and its button, and the whole path against a real opencode (the opt-in
 * `realOpencode.test.ts` or F5 would cover the log lines); POSIX UNVERIFIED.
 */
export function registerServerLifecycle(channel: vscode.LogOutputChannel): {
  manager: ServerManager;
  onDetection: (result: DetectionResult) => void;
} {
  const log = safeLog(channel);
  const manager = new ServerManager({
    start: startServer,
    stop: (server) => stopServer(server.child, log),
    fetchInfo: (url, password, signal) =>
      fetchServerInfo(url, password, undefined, undefined, signal),
    log,
  });
  manager.setFolder(pickWorkspaceFolder(vscode.workspace.workspaceFolders));

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
      void vscode.window.showErrorMessage(failure, SHOW_LOGS).then((choice) => {
        if (choice === SHOW_LOGS) channel.show();
      });
    }
  });

  return { manager, onDetection: (result) => manager.onDetection(result) };
}
