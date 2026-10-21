import * as vscode from 'vscode';
import { isWebviewToHost } from '../shared/protocol';
import { createAttention } from './attention';
import { ChatController, type FocusTarget } from './chatController';
import { registerChatView } from './chatViewProvider';
import { createEditorActions } from './editorActions';
import {
  INJECT_WEBVIEW_MESSAGE_COMMAND_ID,
  MANAGE_PERMISSIONS_COMMAND_ID,
  REPLY_PERMISSION_COMMAND_ID,
  SHOW_REQUEST_COMMAND_ID,
  VIEW_CONTAINER_ID,
} from './ids';
import { createOpencodeClient } from './opencodeClient';
import { safeLog } from './opencodeServer';
import { pickSavedPermissionsToRevoke } from './savedPermissionsUi';
import { restartServerWithFeedback } from './serverLifecycle';
import type { ServerManager } from './serverManager';

/**
 * `workspaceState` key of the sessions this extension opened last, one per served folder:
 * `{ [folderPath]: sessionID }`. Not a secret, just ids. The key of phases 1-2
 * (`openVsCode.openSessionID`, a single global id) is abandoned on purpose: the prototype was
 * never published, and a session belongs to the folder it was created in.
 */
const OPEN_SESSION_BY_FOLDER_KEY = 'openVsCode.openSessionByFolder';

/** Reads the per-folder map; an absent or malformed value is an empty map. */
function readSessionMap(context: vscode.ExtensionContext): Record<string, string> {
  const stored = context.workspaceState.get<unknown>(OPEN_SESSION_BY_FOLDER_KEY);
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  const map: Record<string, string> = {};
  for (const [folder, id] of Object.entries(stored)) {
    if (typeof id === 'string') map[folder] = id;
  }
  return map;
}

/** True for a non-empty string: the arguments of a command link are untrusted. */
function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Reads the argument of the "Open chat" link: `{ sessionID, id, kind }` with a `permission` or
 * `form` kind. Returns `undefined` for anything else (anyone can run a command with any
 * arguments, so the handler never trusts the shape).
 */
function parseFocusTarget(raw: unknown): FocusTarget | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { sessionID, id, kind } = raw as Record<string, unknown>;
  if (!isFilled(sessionID) || !isFilled(id)) return undefined;
  if (kind !== 'permission' && kind !== 'form') return undefined;
  return { kind, sessionID, id };
}

/**
 * Reads the argument of the "Allow once" / "Reject" links. `always` is refused on purpose: it
 * stores a rule for the whole project and must be chosen in the chat, where the rule is shown.
 */
function parseReply(
  raw: unknown,
): { sessionID: string; permissionID: string; decision: 'once' | 'reject' } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { sessionID, permissionID, decision } = raw as Record<string, unknown>;
  if (!isFilled(sessionID) || !isFilled(permissionID)) return undefined;
  if (decision !== 'once' && decision !== 'reject') return undefined;
  return { sessionID, permissionID, decision };
}

/**
 * Wires the chat (issues #9/#14) into VS Code: controller, view provider, server-state
 * subscription, the editor actions of the chat (`editorActions.ts`, phase 2), the attention
 * feature with its internal commands (issue #19), the saved-permissions command (issue #18) and,
 * only under test, the message-injection command.
 *
 * The controller starts its client and event stream when the manager reaches `running` and stops
 * them in any other state; the current state is applied right away, because registration can
 * happen after the server is already up. The returned disposable aborts the stream
 * synchronously (no waiting: `dispose` is not awaited by VS Code) and closes the notifications.
 * Stopping the server itself stays in `deactivate` (`extension.ts`), and the log is guarded with
 * `safeLog` because the channel is closed only after the stop.
 *
 * The injection command runs a raw message through the SAME guard (`isWebviewToHost`) and the
 * SAME controller as a real webview message. It exists only if `context.extensionMode` is
 * `ExtensionMode.Test`, so the integration suite can send a prompt without reaching into the
 * iframe, which the test API cannot do (decision of the plan, alternative discarded: no e2e of
 * the prompt, only F5). A reviewer should check that `if`: a failed gating would leave an
 * invisible but executable command in production.
 * VERIFIED in a real VS Code 1.142 on Windows 11 (20/10/2026, opt-in `real-opencode` suite against
 * opencode 2.0.32): the command ran, and the log shows `prompt accepted for ses_...` followed by
 * `turn finished: succeeded for ses_...` (reviewer re-read `OpenCode.log` of that run). NOT
 * verified: that the command is absent outside Test mode (the `if` was read, not run in a
 * production-mode host), macOS and Linux.
 *
 * The two internal commands (`SHOW_REQUEST_COMMAND_ID`, `REPLY_PERMISSION_COMMAND_ID`) are always
 * registered and not contributed: they are the targets of the links of an attention
 * notification. They validate their argument and refuse `always`. A rejected argument logs a
 * `warn` line and does nothing.
 */
export function registerChat(
  context: vscode.ExtensionContext,
  channel: vscode.LogOutputChannel,
  manager: ServerManager,
): vscode.Disposable {
  const log = safeLog(channel);
  // `view` is assigned below; the attention feature and the controller only use it later, from
  // events and from VS Code callbacks, never during this function.
  const attention = createAttention({
    target: {
      setBadge: (count) => {
        view.provider.setBadge(count);
      },
      get visible() {
        return view.provider.visible;
      },
    },
    log,
  });
  const controller = new ChatController({
    createClient: createOpencodeClient,
    post: (message) => {
      view.provider.post(message);
    },
    log,
    editor: createEditorActions(log),
    memory: {
      get: (folder) => {
        const map = readSessionMap(context);
        return Object.hasOwn(map, folder) ? map[folder] : undefined;
      },
      set: async (folder, sessionID) => {
        const map = readSessionMap(context);
        if (sessionID === undefined) delete map[folder];
        else map[folder] = sessionID;
        await context.workspaceState.update(OPEN_SESSION_BY_FOLDER_KEY, map);
      },
    },
    attention,
    savedPermissions: { pickToRevoke: pickSavedPermissionsToRevoke },
    server: {
      restart: () => {
        void restartServerWithFeedback(manager);
      },
      showLogs: () => {
        channel.show();
      },
    },
  });
  const view = registerChatView(context.extensionUri, channel, {
    onReady: () => {
      void controller.onWebviewReady().catch((error: unknown) => {
        log.error(`answering webview ready failed: ${String(error)}`);
      });
    },
    onMessage: (message) => {
      void controller.handle(message).catch((error: unknown) => {
        log.error(`handling ${message.type} failed: ${String(error)}`);
      });
    },
    onVisibilityChange: (visible) => {
      attention.onVisibility(visible);
    },
  });

  const disposables: vscode.Disposable[] = [
    view.disposable,
    manager.onDidChangeState((state) => {
      controller.onServerState(state);
    }),
    { dispose: () => controller.dispose() },
    { dispose: () => attention.dispose() },
    vscode.commands.registerCommand(MANAGE_PERMISSIONS_COMMAND_ID, async () => {
      await controller.handle({ type: 'permissions.manage' });
    }),
    vscode.commands.registerCommand(SHOW_REQUEST_COMMAND_ID, async (raw: unknown) => {
      const target = parseFocusTarget(raw);
      if (target === undefined) {
        log.warn(`${SHOW_REQUEST_COMMAND_ID} rejected: invalid arguments`);
        return;
      }
      await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
      controller.focusRequest(target);
    }),
    vscode.commands.registerCommand(REPLY_PERMISSION_COMMAND_ID, async (raw: unknown) => {
      const reply = parseReply(raw);
      if (reply === undefined) {
        log.warn(`${REPLY_PERMISSION_COMMAND_ID} rejected: invalid arguments`);
        return;
      }
      const failure = await controller.replyPermission(
        reply.sessionID,
        reply.permissionID,
        reply.decision,
      );
      if (failure !== undefined) {
        void vscode.window.showWarningMessage(
          `OpenCode could not answer the permission: ${failure.message}`,
        );
      }
    }),
  ];
  controller.onServerState(manager.state);

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    disposables.push(
      vscode.commands.registerCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, async (raw: unknown) => {
        if (!isWebviewToHost(raw)) {
          log.warn('injected message rejected by isWebviewToHost');
          return;
        }
        await controller.handle(raw);
      }),
    );
  }
  return vscode.Disposable.from(...disposables);
}
