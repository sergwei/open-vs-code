import * as vscode from 'vscode';
import { isWebviewToHost, type UiCommand } from '../shared/protocol';
import { createAttention } from './attention';
import { ChatController, type ComposeOutcome, type FocusTarget } from './chatController';
import type { ChatSurfaceGate } from './chatSurfaceGate';
import { registerChatView } from './chatViewProvider';
import { createEditorActions } from './editorActions';
import type { ModelRef } from '../shared/model';
import {
  ADD_SELECTION_TO_CHAT_COMMAND_ID,
  ADD_TO_CHAT_COMMAND_ID,
  CHAT_FOCUSED_CONTEXT_KEY,
  CHAT_VIEW_ID,
  CONFIG_SECTION,
  DEFAULT_MODEL_KEY,
  DEFAULT_MODEL_SETTING,
  EXPLAIN_FILES_COMMAND_ID,
  EXPLAIN_SELECTION_COMMAND_ID,
  FIX_SELECTION_COMMAND_ID,
  FOCUS_PROMPT_COMMAND_ID,
  INJECT_WEBVIEW_MESSAGE_COMMAND_ID,
  MANAGE_PERMISSIONS_COMMAND_ID,
  NEW_SESSION_COMMAND_ID,
  OPEN_CHAT_COMMAND_ID,
  REPLY_PERMISSION_COMMAND_ID,
  SHOW_REQUEST_COMMAND_ID,
  STOP_RESPONSE_COMMAND_ID,
  VIEW_CONTAINER_ID,
} from './ids';
import { createOpencodeClient } from './opencodeClient';
import { safeLog } from './opencodeServer';
import { createSetupActions } from './setupActions';
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
 * Where Focus Prompt sends the focus: the `to` argument of its key (`chat` or `editor`), and with
 * no valid argument (the palette, or `executeCommand` without one) the toggle on `chatFocused`.
 *
 * Why the keys carry it (issue #92): `chatFocused` comes from the webview by `postMessage`, so it
 * lags the real focus. A press right after the focus left the chat still read `true` and sent the
 * focus to the editor it was already in, so the key did nothing. The two keybindings in
 * package.json decide with `editorTextFocus` instead: with the caret in editor text our key goes
 * to the chat. HYPOTHESIS that the workbench sets that key synchronously from its own DOM focus
 * (not read in its source; the loop below is what shows the press no longer lags). On macOS
 * Cmd+Alt+P is also bound by VS Code under `editorFocus` (see `commands.test.ts`), and which rule
 * wins there is UNVERIFIED.
 * VERIFIED on Windows 11, VS Code 1.143.1 (28/10/2026) for the lag itself, with a scratch loop of
 * step 22's presses (not committed): with the old single key, Ctrl+Alt+P pressed from the editor
 * right after the toggle back left the focus in the editor ("DIV.native-edit-context" active, the
 * chat document without focus): 15 of 40 rounds for the press after the chip panel. With these
 * two keys (and the focus hold of `PromptInput`) the same loop ran 160 rounds with no miss of that
 * kind; one press from the editor left the prompt box active with the chat document reporting
 * `hasFocus()` false, a different signature, not explained. The
 * palette keeps the toggle, and so the lag (UNVERIFIED there: the palette takes the focus first).
 */
function focusPromptTarget(raw: unknown, chatFocused: boolean): 'chat' | 'editor' {
  if (typeof raw === 'object' && raw !== null) {
    const { to } = raw as Record<string, unknown>;
    if (to === 'chat' || to === 'editor') return to;
  }
  return chatFocused ? 'editor' : 'chat';
}

/**
 * The `file:` URIs of the Explorer's `(clicked, selected)` arguments, as strings: all of the
 * selection when there is one, else the clicked item. Anything that is not a `Uri` is dropped (a
 * command can be run with any arguments).
 */
function explorerUris(clicked: unknown, selected: unknown): string[] {
  const items = Array.isArray(selected) && selected.length > 0 ? selected : [clicked];
  return items
    .filter((item): item is vscode.Uri => item instanceof vscode.Uri)
    .map((uri) => uri.toString());
}

/**
 * The document `Uri` an `editor/context` entry receives, as a string, or `undefined` from the
 * palette or with any other argument (the host then reads the active editor).
 */
function editorUri(raw: unknown): string | undefined {
  return raw instanceof vscode.Uri ? raw.toString() : undefined;
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
 * Wires the chat (issues #9/#14) into VS Code: controller, view provider (attached to the
 * controller as pane 1, the only chat surface until the editor-tab phases of #77), server-state
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
 * Issue #30 registers `ADD_TO_CHAT_COMMAND_ID` ("Add to OpenCode Chat", `explorer/context`, hidden
 * from the palette because it needs the Explorer's arguments): it shows the chat and hands the
 * selected `file:` URIs to `controller.addToChat`. UNVERIFIED in a real window: the menu entry
 * itself (the integration suite calls the command with URIs, it cannot right-click).
 *
 * Issue #35 registers the four palette commands (Open Chat, Focus Prompt, New Session, Stop
 * Response). Each one first reveals the chat with the command VS Code generates for the view
 * (`openVsCode.chat.focus`), which also hands the keyboard to the iframe, and then asks the
 * webview through `controller.runUiCommand` to do what its button does. Focus Prompt is a toggle:
 * with the chat focused it returns the focus to the editor instead; its two keybindings say the
 * direction in their argument instead of reading the flag (issue #92, {@link focusPromptTarget}),
 * so the keys go by `editorTextFocus` and the flag only decides the key inside the chat and the
 * palette. The `chatFocused` flag comes
 * from the webview (`chat.focusChanged`) and is mirrored into the context key
 * `openVsCode.chatFocused` that the keybindings' `when` clauses read; it is reset when the view
 * hides or is disposed, because `blur` does not always fire for a hidden element. The `when` of
 * the New Session key is that context key, so the key works only inside the chat.
 * VERIFIED by `test:visual` step 22 (real VS Code, Windows 11, 25/10/2026, real keyboard, checks
 * "Control+Alt+P from the editor puts the caret in the prompt box", "Control+Alt+P again returns
 * the focus to the editor", "after Ctrl+B hid the chat while it had the focus, Focus Prompt shows
 * it and the prompt box is the active element of the new document (the context key was reset)" and
 * "Control+Alt+N leaves the empty view (0)"): the keys reach the host with the focus inside the
 * iframe, the toggle works and the context key is false after the chat was hidden while focused.
 * The hide check was also run with the reset of `onVisibilityChange(false)` temporarily removed
 * (25/10/2026): it failed ("the chat webview target did not appear", the key went back to the
 * editor), so it does cover that reset. Since issue #92 that check runs Focus Prompt from the
 * palette (the key from editor text no longer reads the flag) and reads "…, Focus Prompt from the
 * palette shows it and …"; the same mutation repeated on 28/10/2026 (Windows 11, VS Code 1.143.1,
 * `--steps 22 --bail`) failed it again with "the chat webview target did not appear", and
 * unmutated it passed. Not observed: macOS and Linux (keys
 * pressed only as `Control+Alt`), a keyboard layout where Ctrl+Alt+P or +N types a character.
 * HYPOTHESIS: `focusView` (a second `openVsCode.chat.focus` after a kept command went out) is what
 * makes the first keystroke land in a freshly created document; in that run the document reported
 * `hasFocus()` false while a typed letter still reached the box, and the run without the second
 * focus was not repeated to prove it is needed.
 *
 * Issue #87: the optional `gate` is attached to the view (`canDeliver`) and told on every webview
 * `ready` (`gate.changed()`), so a failure notification waiting for the chat can be withheld.
 * VERIFIED on Windows 11, VS Code 1.144.0 (28/10/2026), full `npm run test:visual` (exit 0): "ok
 * no native OpenCode warning appears while the setup guide is shown (center read: true; [])".
 *
 * Issue #86: the optional `redetect` (a lazy closure from `extension.ts`, because the detection is
 * registered after the chat) reaches `createSetupActions`, for "Choose binary…" on the path the
 * setting already holds. Without it that pick re-runs nothing.
 *
 * E2 (issue #85) injects `deps.setup` (`createSetupActions`, `setupActions.ts`): the buttons of the
 * setup guide and the error card run through it. VERIFIED for "Choose binary…" on Windows 11 (27/10/2026,
 * visual check "Choose binary… through the real file dialog wrote the setting and step 1 is done");
 * the other setup actions are UNVERIFIED in a real window (see `setupActions.ts`).
 *
 * Issue #36 registers the context-menu entries: `ADD_SELECTION_TO_CHAT_COMMAND_ID`,
 * `EXPLAIN_SELECTION_COMMAND_ID` and `FIX_SELECTION_COMMAND_ID` (`editor/context`, they get the
 * `Uri` of the clicked document) and `EXPLAIN_FILES_COMMAND_ID` (`explorer/context`, the same
 * `(clicked, selected)` pair as Add to OpenCode Chat). Each asks the controller first and reveals
 * the chat after, only when the outcome is not `rejected`: a refusal is shown as a native
 * `showWarningMessage` and the chat stays closed (decision P11=1). The pane they talk to comes
 * from the single helper `targetPane`. VERIFIED on Windows 11 (29/10/2026, `npm run test:integration`,
 * the commands run with hand-built arguments): "registers the context-menu commands", "Explain with
 * OpenCode sends the selection of the clicked document", "Explorer Explain sends one prompt for the
 * files and counts the folder it skipped" and "Add to OpenCode Chat from the editor attaches the
 * selection and sends nothing". VERIFIED with the real right mouse button (`npm run test:visual`,
 * Windows 11, VS Code 1.144.0, 29/10/2026, full run): "C1 the editor right-click menu lists "Add to
 * OpenCode Chat", "Explain with OpenCode" and "Fix with OpenCode" in that order", "C3 Explain from
 * the editor sends "Explain what @src/sample.ts#2-3 does."", "C2 the Explorer right-click menu
 * lists "Add to OpenCode Chat" then "Explain with OpenCode" and no Fix", "C5 the chat that was
 * hidden when the command ran sends "Explain what @… and @… do."" and the native warning: "C7
 * Explain on a file outside the workspace folder raises the native warning "Only files inside the
 * workspace folder can be added"" (read in `.notifications-toasts`). UNVERIFIED: the chat being
 * CLOSED (not only hidden behind the Explorer) when the command runs, and that a refusal leaves a
 * closed chat closed (the chat was open during C7).
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
  gate?: ChatSurfaceGate,
  redetect?: () => void,
): vscode.Disposable {
  const log = safeLog(channel);
  // Whether the chat webview holds the keyboard focus; the source of truth for the toggle.
  let chatFocused = false;
  const setChatFocused = (focused: boolean): void => {
    chatFocused = focused;
    void vscode.commands.executeCommand('setContext', CHAT_FOCUSED_CONTEXT_KEY, focused);
  };
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
    setup: createSetupActions(redetect),
    ui: {
      setChatFocused,
      focusView: () => {
        void vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
      },
    },
  });
  // The side-bar view is the only chat surface for now (E9 phase 1): pane 1. Its callbacks read
  // `view` lazily, like the attention feature above.
  const pane = controller.attachPane({
    post: (message) => {
      view.provider.post(message);
    },
    canDeliver: () => view.provider.canDeliver,
  });
  const view = registerChatView(context.extensionUri, channel, {
    onReady: () => {
      // Issue #87: the provider marked the view `ready` before calling this, so `canDeliver` is
      // true now; wakes any native notification that is waiting to learn the chat is showing.
      gate?.changed();
      void controller.onPaneReady(pane.id).catch((error: unknown) => {
        log.error(`answering webview ready failed: ${String(error)}`);
      });
    },
    onMessage: (message) => {
      void controller.handle(pane.id, message).catch((error: unknown) => {
        log.error(`handling ${message.type} failed: ${String(error)}`);
      });
    },
    onVisibilityChange: (visible) => {
      attention.onVisibility(visible);
      if (!visible && chatFocused) setChatFocused(false);
    },
  });
  // P3=2 (issue #85): the notifications ask whether this view can show the failure itself.
  gate?.attach(() => view.provider.canDeliver);
  /**
   * The pane every command of the menus talks to: the side-bar one, the only chat surface until
   * #77 phase 2 picks the surface that is active. The ONE place to change then (risk R8 of #36).
   */
  const targetPane = (): typeof pane => pane;
  /**
   * Closes a context-menu entry (issue #36). `rejected` (nothing valid to send) shows the reason
   * as a native warning and does NOT open the chat (decision P11=1 of Sergio); `composed` and
   * `notified` reveal it, `notified` because its "items were not added" notice is waiting there.
   * The warning is not awaited: `showWarningMessage` settles when the user dismisses it.
   */
  const finishContextAction = async (outcome: ComposeOutcome): Promise<void> => {
    if (outcome.status === 'rejected') {
      void vscode.window.showWarningMessage(outcome.error.message);
      return;
    }
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
  };
  /** Reveals the chat (the view's generated focus command) and relays `command` to its webview. */
  const runInChat = async (command: UiCommand): Promise<void> => {
    await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
    controller.runUiCommand(pane.id, command);
  };

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
      await controller.handle(pane.id, { type: 'permissions.manage' });
    }),
    // Issue #35.
    vscode.commands.registerCommand(OPEN_CHAT_COMMAND_ID, () => runInChat('prompt.focus')),
    vscode.commands.registerCommand(FOCUS_PROMPT_COMMAND_ID, async (args: unknown) => {
      if (focusPromptTarget(args, chatFocused) === 'editor') {
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        return;
      }
      await runInChat('prompt.focus');
    }),
    vscode.commands.registerCommand(NEW_SESSION_COMMAND_ID, () => runInChat('session.new')),
    vscode.commands.registerCommand(STOP_RESPONSE_COMMAND_ID, () => runInChat('session.stop')),
    // Issue #30: the Explorer passes (clicked item, all selected items). The strings go through
    // the same host checks as a drop (`dropFiles`), minus the `file.find` one.
    vscode.commands.registerCommand(
      ADD_TO_CHAT_COMMAND_ID,
      async (clicked: unknown, selected: unknown) => {
        await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
        await controller.addToChat(targetPane().id, explorerUris(clicked, selected));
      },
    ),
    // Issue #36: the context-menu entries. The editor ones receive the `Uri` of the right-clicked
    // document (nothing from the palette), the Explorer one the same pair as Add to OpenCode Chat.
    vscode.commands.registerCommand(ADD_SELECTION_TO_CHAT_COMMAND_ID, async (uri: unknown) => {
      await finishContextAction(await controller.addEditorToChat(targetPane().id, editorUri(uri)));
    }),
    vscode.commands.registerCommand(EXPLAIN_SELECTION_COMMAND_ID, async (uri: unknown) => {
      await finishContextAction(
        await controller.composeFromEditor(targetPane().id, 'explain', editorUri(uri)),
      );
    }),
    vscode.commands.registerCommand(FIX_SELECTION_COMMAND_ID, async (uri: unknown) => {
      await finishContextAction(
        await controller.composeFromEditor(targetPane().id, 'fix', editorUri(uri)),
      );
    }),
    vscode.commands.registerCommand(
      EXPLAIN_FILES_COMMAND_ID,
      async (clicked: unknown, selected: unknown) => {
        await finishContextAction(
          await controller.composeFromFiles(
            targetPane().id,
            'explain',
            explorerUris(clicked, selected),
          ),
        );
      },
    ),
    vscode.commands.registerCommand(SHOW_REQUEST_COMMAND_ID, async (raw: unknown) => {
      const target = parseFocusTarget(raw);
      if (target === undefined) {
        log.warn(`${SHOW_REQUEST_COMMAND_ID} rejected: invalid arguments`);
        return;
      }
      await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
      controller.focusRequest(pane.id, target);
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
        await controller.handle(pane.id, raw);
      }),
    );
  }
  return vscode.Disposable.from(...disposables);
}
