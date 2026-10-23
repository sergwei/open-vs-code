import * as vscode from 'vscode';
import { isWebviewToHost } from '../shared/protocol';
import { createAttention } from './attention';
import { ChatController, type FocusTarget } from './chatController';
import { registerChatView } from './chatViewProvider';
import { createEditorActions } from './editorActions';
import type { ModelRef } from '../shared/model';
import {
  CONFIG_SECTION,
  DEFAULT_MODEL_KEY,
  DEFAULT_MODEL_SETTING,
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
import { registerSessionDiffProvider } from './sessionDiffEditor';
import { confirmRevertDiscard, confirmSessionDelete } from './sessionUi';

/**
 * `workspaceState` key of the sessions this extension opened last, one per served folder:
 * `{ [folderPath]: sessionID }`. Not a secret, just ids. The key of phases 1-2
 * (`openVsCode.openSessionID`, a single global id) is abandoned on purpose: the prototype was
 * never published, and a session belongs to the folder it was created in.
 */
const OPEN_SESSION_BY_FOLDER_KEY = 'openVsCode.openSessionByFolder';

/**
 * `globalState` key of the model the last accepted prompt was sent with (issue #23): a `ModelRef`.
 * GLOBAL on purpose, not per folder (decision of the planner, revocable): it is a preference of
 * the user, like the "recent models" of opencode's own app, and it is checked against the catalog
 * of the server in use before it is proposed, so a model another server lacks is skipped.
 */
const LAST_MODEL_KEY = 'openVsCode.lastModel';

/**
 * Reads the last model used from `globalState`. The stored value is untrusted (an old version or
 * another extension host could have written anything): only an object with non-empty string
 * `providerID` and `id` counts. Since issue #61 a `variant` is kept when it is a non-empty string
 * other than `"default"` (that spelling means "no variant" and is never stored by the controller);
 * whether the catalog still lists it is decided later by `resolvePreferredModel`. UNVERIFIED: a
 * variant surviving a window reload in a real `globalState`.
 */
function readLastModel(context: vscode.ExtensionContext): ModelRef | undefined {
  const stored = context.globalState.get<unknown>(LAST_MODEL_KEY);
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return undefined;
  const { providerID, id, variant } = stored as Record<string, unknown>;
  if (!isFilled(providerID) || !isFilled(id)) return undefined;
  if (isFilled(variant) && variant !== 'default') return { providerID, id, variant };
  return { providerID, id };
}

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
 * feature with its internal commands (issue #19), the saved-permissions command (issue #18), the
 * native confirmation of a session delete (`sessionUi.ts`, issue #20), the model preferences of
 * issue #23 (the `openVsCode.defaultModel` setting, re-read when it changes without touching the
 * server, and the last model used in `globalState`) and, only under test, the message-injection
 * command. VERIFIED that the setting is read and ignored/applied as the unit tests say, and that
 * a change of it republishes the catalog, by the `test:visual` step 11 (real VS Code 1.143.0,
 * Windows 11, run of 21/10/2026: the log of the run names the 1.143.0 archive); the `globalState` write surviving a window reload is UNVERIFIED.
 *
 * The controller starts its client and event stream when the manager reaches `running` and stops
 * them in any other state; the current state is applied right away, because registration can
 * happen after the server is already up. The returned disposable aborts the stream
 * synchronously (no waiting: `dispose` is not awaited by VS Code) and closes the notifications.
 * Stopping the server itself stays in `deactivate` (`extension.ts`), and the log is guarded with
 * `safeLog` because the channel is closed only after the stop.
 *
 * Issue #31 registers the content provider of the "Changed files" diffs
 * (`registerSessionDiffProvider`), fed by `controller.diffOriginal` and, for the "what the revert
 * undid" diffs of issue #32, `controller.revertedOriginal`; it re-reads its open documents on
 * `controller.onDiffRenewed`. Issue #32 also hands the controller the modal that confirms
 * "Discard for good" (`confirmRevertDiscard`).
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
    sessions: { confirmDelete: confirmSessionDelete, confirmRevertDiscard },
    preferences: {
      defaultModel: () =>
        vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(DEFAULT_MODEL_KEY),
      lastModel: () => readLastModel(context),
      setLastModel: async (ref) => {
        await context.globalState.update(LAST_MODEL_KEY, ref);
      },
    },
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
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(DEFAULT_MODEL_SETTING)) controller.onPreferencesChanged();
    }),
    // Issue #31: the original side of "Changed files" diffs. Registered now, not on first use, so
    // a diff tab restored by Reload Window finds its provider.
    registerSessionDiffProvider(
      {
        original: (sessionID, shown) => controller.diffOriginal(sessionID, shown),
        reverted: (sessionID, shown) => controller.revertedOriginal(sessionID, shown),
        onRenewed: (listener) => controller.onDiffRenewed(listener),
      },
      log,
    ),
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
