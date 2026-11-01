import * as path from 'node:path';
import * as vscode from 'vscode';
import { isWebviewToHost, type ConnectionState, type UiCommand } from '../shared/protocol';
import { EMPTY_TITLE } from '../shared/sessionLabel';
import { createAttention } from './attention';
import {
  ChatController,
  type AttentionSink,
  type ComposeOutcome,
  type FocusTarget,
} from './chatController';
import {
  planLocationSwitch,
  readChatLocation,
  type ChatLocation,
  type TabSnapshot,
} from './chatLocation';
import type { ChatPane } from './chatPane';
import { ChatPanels } from './chatPanels';
import type { ChatSurfaceGate } from './chatSurfaceGate';
import { ChatTabs } from './chatTabs';
import { registerChatView } from './chatViewProvider';
import { chatWebviewOptions } from './chatWebview';
import { createEditorActions, trackLastTextEditor } from './editorActions';
import type { Catalog, ModelRef } from '../shared/model';
import {
  ADD_SELECTION_TO_CHAT_COMMAND_ID,
  ADD_TO_CHAT_COMMAND_ID,
  CHAT_FOCUSED_CONTEXT_KEY,
  CHAT_LOCATION_KEY,
  CHAT_LOCATION_SETTING,
  CHAT_PANEL_VIEW_TYPE,
  CHAT_VIEW_ID,
  CONFIG_SECTION,
  DEFAULT_MODEL_KEY,
  DEFAULT_MODEL_SETTING,
  DELETE_SESSION_COMMAND_ID,
  EXPLAIN_FILES_COMMAND_ID,
  EXPLAIN_SELECTION_COMMAND_ID,
  FIX_SELECTION_COMMAND_ID,
  FOCUS_PROMPT_COMMAND_ID,
  INJECT_WEBVIEW_MESSAGE_COMMAND_ID,
  MANAGE_PERMISSIONS_COMMAND_ID,
  NEW_SESSION_COMMAND_ID,
  OPEN_CHAT_COMMAND_ID,
  OPEN_SESSION_COMMAND_ID,
  OPEN_SETTINGS_COMMAND_ID,
  RENAME_SESSION_COMMAND_ID,
  REPLY_PERMISSION_COMMAND_ID,
  RESTORE_CHAT_TAB_TEST_COMMAND_ID,
  SEARCH_SESSIONS_COMMAND_ID,
  SHOW_MORE_SESSIONS_COMMAND_ID,
  SERVER_STATUS_ITEM_ID,
  SHOW_REQUEST_COMMAND_ID,
  STOP_RESPONSE_COMMAND_ID,
  TEST_SESSION_ANSWERS_COMMAND_ID,
  TEST_SESSION_ORGANIZATION_COMMAND_ID,
  VIEW_CONTAINER_ID,
} from './ids';
import { createOpencodeClient } from './opencodeClient';
import { safeLog } from './opencodeServer';
import { createSetupActions } from './setupActions';
import { pickSavedPermissionsToRevoke } from './savedPermissionsUi';
import { restartServerWithFeedback } from './serverLifecycle';
import { describeServerStatus } from './serverStatus';
import type { ServerManager } from './serverManager';
import { registerSessionDiffProvider } from './sessionDiffEditor';
import type { PendingSummary } from './pendingRequests';
import { showSessionsSearch } from './sessionsSearch';
import { RevealOrder } from './revealOrder';
import { registerSessionsView, type SessionsState } from './sessionsView';
import { registerSessionsOrganize, sessionIDOf, type OrganizeAnswers } from './sessionsOrganize';
import { createSessionTree, type SessionTreePage } from './sessionTree';
import { askSessionTitle, confirmRevertDiscard, confirmSessionDelete } from './sessionUi';

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

/** Shows a failure of a Sessions-tree action as a native warning, without awaiting its dismissal. */
function warnSessionFailure(action: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  void vscode.window.showWarningMessage(`OpenCode could not ${action}: ${reason}`);
}

/**
 * Wires the chat (issues #9/#14) into VS Code: controller, the chat surfaces (the side-bar view
 * and the editor tabs, see "Issue #77" below), server-state subscription, the editor actions of the chat (`editorActions.ts`, phase 2), the attention
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
 * Response). In `sidebar` mode each one first reveals the chat with the command VS Code generates
 * for the view (`openVsCode.chat.focus`), which also hands the keyboard to the iframe, and then
 * asks the webview through `controller.runUiCommand` to do what its button does (in `editor` mode
 * the target is a tab, see below). Focus Prompt is a toggle:
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
 * from the single helper `targetPane` (the surface of the current mode, see below). VERIFIED on Windows 11 (29/10/2026, `npm run test:integration`,
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
 * Issue #77 (decisions Q1-Q10 and T1-T4 of Sergio, 29/10/2026): the setting
 * `openVsCode.chatLocation` picks where the chat lives, read at start and on every change.
 * - `sidebar`: ONE pane, the view, attached at start as before. Opt-in since E5 (30/10/2026,
 *   decision Q1=1): the default is `editor`, and `chat location at start: <mode>` is logged on
 *   activation. VERIFIED for the `editor` line: `chat location at start: editor` on the first
 *   activation of a profile with no key, read by the integration case "starts in editor on the
 *   first activation" and by "ok   D0 a profile with no chatLocation key starts in editor
 *   mode: …" of `test:visual` (Windows 11, VS Code 1.144.0, 30/10/2026). UNVERIFIED on macOS and
 *   Linux; the `sidebar` line is read by no test.
 * - `editor` (the default): no side-bar pane. Every chat is an editor tab (`ChatPanels`), one pane each; New
 *   Session always opens a NEW lazy tab; a command goes to the active tab, else the most recent
 *   (`ChatTabs.commandTarget`), else it opens one with the last session of the folder.
 * - A change runs `planLocationSwitch`: to `editor` the view's pane is dropped and its session
 *   opens in a tab; to `sidebar` NO tab is closed (they keep working until the user closes them),
 *   the view gets the remembered session only if no tab shows it, and a session is revealed, not
 *   duplicated, wherever it already is (the controller asks `revealPane`/`openElsewhere`).
 * - An EMPTY tab that opens a session no other surface shows adopts it instead of opening another
 *   tab (decision of Sergio, 29/10/2026; the rule is in `ChatController.openRequested`).
 * - The tabs survive Reload Window: a panel serializer for `CHAT_PANEL_VIEW_TYPE` is registered in
 *   BOTH modes (VS Code only saves a tab whose view type has one) and hands each revived panel to
 *   `ChatPanels.restore`, which binds the session the tab's webview saved. Deactivation releases
 *   the tabs (`detachAll`) instead of closing them. In `ExtensionMode.Test` the internal command
 *   `RESTORE_CHAT_TAB_TEST_COMMAND_ID` feeds a panel it creates through that same `restore`.
 * - The attention feature asks `seenBySurface` PER REQUEST (E4 of #77, decision Q1=2): a chat tab
 *   sees the requests its dock lists (`ChatController.displays`) only while it is the ACTIVE
 *   editor, the side-bar view while it is visible. The badge goes to the view in `sidebar` and to
 *   the Sessions view in `editor`. `chatFocused` is true while ANY surface has the focus; a
 *   surface that hides gets a synthetic blur.
 * VERIFIED in a real VS Code 1.144.0 (Windows 11, `npm run test:integration`, 29/10/2026), with
 * a synthetic server for the session cases: "opens one tab per New Session, each with a ready
 * document", "reveals the existing tab on Open Chat instead of opening another", "opens a tab on
 * Open Chat when none is open", "keeps the tabs open and the side-bar view working when going back
 * to sidebar" (two tabs stay, `Chat view resolved` appears again, a probe reaches the view's pane)
 * and "opens the diff beside a chat tab, and serves prompts and session.open from tabs" (the
 * session of the side bar opens in a tab on the change to `editor`, `session.open` of it from a
 * second tab logs `chat tab revealed` and no third tab, a prompt injected while a tab is the target
 * is accepted). Then in a real window, `npm run test:visual` step 27 (Windows 11, VS Code 1.144.0,
 * 29/10/2026, all visual checks passed): "ok C11 with every chat tab hidden a request raises a
 * native notification ("Source: OpenCode GUI | Cancel | OpenCode: Permission requested: read:
 * .env — Ope") and a badge on the OpenCode icon ("1")", "ok C11 "Open chat" of the notification
 * reveals the tab of the session and its permission card is there (tab true, card true)", "ok C9
 * Explain with every tab hidden reveals the most recent tab and sends there" and, for the iframe of
 * a tab, "ok C4 coming back to A shows the whole reply once: 400 numbers, from 1 to 400, in order,
 * no repeats". Focus Prompt to the chat and to the editor, Stop Response, the two Add to OpenCode
 * Chat entries and Manage Saved Permissions in `editor` mode are run by the cases of
 * `test/integration/chatPanel.test.ts` (log only). UNVERIFIED: macOS and Linux locally (the CI
 * runs the integration suite there), the chips the Add entries give with a folder served (the
 * suite serves none, so the host refuses them), and the badge with the Sessions view not in front
 * (it was the view in front in C11).
 *
 * E3 (issue #77, decisions Q1-Q10 and T1-T9 of Sergio, 29/10/2026): in `editor` mode the OpenCode
 * view is the native Sessions tree (`sessionsView.ts`, model in `sessionTree.ts`). The controller
 * reports the root sessions of the folder to it through `deps.sessionList` and the pending
 * requests reach it through a wrapper of the attention sink; the set of sessions with a tab comes
 * from `controller.sessionOf` over the tabs, never from the registry of titles. Commands: the
 * internal open and show-more (not contributed, run by the rows), Rename and Delete (row menu, F2,
 * Delete) and Search Sessions…. Opening a session reveals its tab with the focus; with no tab it
 * adopts the active or most recent EMPTY tab, else opens a new one; nothing happens in `sidebar`
 * mode. Delete reads the tab that shows the session BEFORE deleting and closes it afterwards (P8).
 * Failures of these commands are native warnings. Under `ExtensionMode.Test` the command
 * `TEST_SESSION_ANSWERS_COMMAND_ID` pre-answers the Rename box and the Delete modal, which the test
 * API cannot operate. VERIFIED by a full `test:visual` (Windows 11, VS Code 1.144.0, 30/10/2026,
 * 0 FAIL, with `RevealOrder`): "ok   B6 during the turn the row of N reads "Running · Tab · 11:15 AM"
 * and then "Needs input · Running · Tab · 11:15 AM", and the badge of the Sessions view is "1"",
 * "ok   V3 the context menu of a session row lists Rename Session… and then Delete Session", "ok
 * B1 a second click on the row of B reveals its tab and adds none (4 -> 4 tabs)" and "ok   B2 Rename
 * on the row asks "New title for the session"…". The post-ready focus of a tab is dropped when
 * another chat surface was revealed after it was queued (`RevealOrder`, W3 of review 1): VERIFIED by
 * `revealOrder.test.ts` only. UNVERIFIED end to end: in that run the late reveal came before the
 * click on the second row, so no focus was dropped, and the B1 line passes with or without the fix.
 * KNOWN LIMITATION (W2 of review 2): only reveals made by our code are tracked, so a manual click
 * on a tab of the tab strip after a row click can be stolen by the late reveal. UNVERIFIED on
 * macOS/Linux.
 *
 * E9-sessions-organize (decisions Q1-Q14 of Sergio, 01/11/2026): in `editor` mode the Sessions tree
 * also has folders, pins, an archive, filters and a tooltip. `registerSessionsOrganize`
 * (`sessionsOrganize.ts`) owns the commands and the organization of the served folder, kept in
 * `workspaceState`; here it is only wired: it receives the folder of each full read (`reset`) BEFORE
 * the rows, reads the organized sessions the page lacks through `controller.readSessions` once the
 * page is in (also when `chatLocation` switches to `editor` later), and forgets a session when
 * `session.removed` arrives. The tooltip asks `controller.changedFilesOf` for the files of a tab.
 * Rename and Delete Session still act on the CLICKED row only (`targetSession`, risk R5).
 * `TEST_SESSION_ORGANIZATION_COMMAND_ID` returns what the real Memento holds. In `sidebar` mode
 * nothing runs: no commands act, no extra read is made. VERIFIED in a real window by `test:visual`
 * step 34 (Windows 11, VS Code 1.144.0, 1/11/2026): "B13 in editor mode the palette offers New
 * Folder…" and, in `sidebar` mode, none of Folder, Pin, Archive or Filter; and "B9 after Reload
 * Window the folder with its subfolder, the pinned session and the archived one are still there".
 *
 * E4 (issue #77, decisions Q1=2, Q2=1, Q3=1, Q4=1, T1=1, T2=1 of Sergio, 30/10/2026): in `editor`
 * mode a request is shown in the dock of the tab of its session or of an ancestor, never in the
 * others (`ChatController.displays`), and the toast title names the chat (`labelOf`). A request
 * whose tab is behind the active one is notified; "Open chat" (`SHOW_REQUEST_COMMAND_ID`) reveals
 * the tab that lists it, else puts the ROOT of its lineage in a tab (`placeSession`) and focuses
 * the card. The Sessions tree marks "Needs input" on the root row at any depth (Vitest only).
 * VERIFIED in a real VS Code 1.144.0 (Windows 11, `npm run test:integration`, main and
 * `--label fake-server`, 30/10/2026): "✔ notifies a permission asked by a tab behind the active
 * one, and closes the toast when Open chat shows it" (waits for `attention: notified <id>`, then
 * after Open chat for `attention: closed <id> (visible)` and a different active chat tab) and "✔
 * does not notify a permission asked by the active tab" (badge 1, no `attention: notified` after
 * 2 s). VERIFIED by `test:visual` step 30 (Windows 11, VS Code 1.144.0, 30/10/2026): "ok   D1 tab
 * B asks while tab A is in front: …" (toast, badge 1, "Needs input" row, no card in A), "ok   D2
 * "Open chat" brings the tab of the request forward with its card focused and the notification
 * gone (tab in front true, card true, card focused true, toast gone true)", "ok   D3 the tab in
 * front asks: its card is there (true) and no notification follows after 3 s (null;" and "ok   D5
 * sidebar mode with the side bar chat visible and 2 tab(s) left over: the card is in the side bar
 * chat (true) and no notification follows after 3 s (null;". Two groups: "ok   D4 two groups side
 * by side, the request of the visible tab that is not the active editor: 2 chats on screen in
 * groups [0,1]" raised the toast and kept it (D4 message: "3 s later the editor in front is still
 * "Tab30A: …", the notification is still there and "attention: closed (visible)" was logged 0
 * time(s)"); before `RequestDock` stopped focusing a card in a document without focus, the same
 * cell logged `closed (visible)` once, within 1 s after the toast, with B in front. The branch with NO
 * owner tab in `editor` mode (the tab of the asking session closed before the ask) is VERIFIED by
 * "✔ opens the tab of the session when Open chat finds no tab that lists the request" (same run:
 * the second chat tab appears after the command, `attention: closed <id> (visible)` follows and
 * the active chat tab is not the one that was in front; the fake has no subagent, so the session
 * itself, not a distinct root, is what the tab opens). NOT observed: the card of that new tab
 * taking the focus (it lives in the iframe), the adoption of an EMPTY tab by that branch, a
 * subagent that asks (the fake has none), and macOS and Linux locally.
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
  /**
   * Where the chat lives now (issue #77): the setting, read at start and again on each change.
   * Since E5 (30/10/2026) an absent or unknown value reads as `editor`, the default; only an
   * exact `sidebar` gives the side bar (`readChatLocation`).
   */
  const readLocation = (): ChatLocation =>
    readChatLocation(
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<unknown>(CHAT_LOCATION_KEY),
    );
  let mode = readLocation();
  // The mode of the FIRST activation, in the log: support can tell where a user's chat lives.
  // VERIFIED (Windows 11, VS Code 1.144.0, 30/10/2026): the integration case "starts in editor on
  // the first activation" reads this line in a profile without the setting.
  log.info(`chat location at start: ${mode}`);
  const tabs = new ChatTabs();
  // Which chat surface was revealed last, so a post-ready focus can tell it was overtaken (W3).
  const revealOrder = new RevealOrder();
  /** Queues the `prompt.focus` of `paneId` and remembers when, for {@link RevealOrder}. */
  const queuePromptFocus = (paneId: number): void => {
    revealOrder.queueFocus(paneId);
    controller.runUiCommand(paneId, 'prompt.focus');
  };
  const lastEditor = trackLastTextEditor();
  // The side-bar pane exists only in `sidebar` mode (decision T3=1).
  let sidebarPane: ChatPane | undefined;
  // Pending requests the badge must show; written to the view or to the Sessions view by `applyBadge`.
  let badgeCount = 0;
  // The model of the native Sessions tree (E3, issue #77) and the last connection state the
  // controller reported, which picks the welcome of the tree when it has no rows.
  const sessionTree = createSessionTree({ locale: vscode.env.language });
  let connection: ConnectionState | undefined;
  // Answers for the NEXT Rename box, Delete modal and the dialogs of the organizing commands, set
  // only by the Test-mode command below (the organizing ones are read by `sessionsOrganize.ts`).
  const testAnswers: { title?: string | null; confirmDelete?: boolean } & OrganizeAnswers = {};
  // The first page of the last full read, to reconcile the organization again when the tree
  // comes into use (`chatLocation` switched to `editor` after the page arrived).
  let lastPage: Pick<SessionTreePage, 'rows' | 'hasMore'> | undefined;
  // `view`, `sessionsView`, `panels` and `controller` are assigned below; the attention feature and
  // the callbacks only use them later, from events and from VS Code callbacks, never during this
  // function.
  /**
   * Whether somebody is looking at the card of `request` right now: the side-bar view (only if its
   * pane exists) while it is VISIBLE and its dock lists the request, or a chat tab that is the
   * ACTIVE editor and whose dock lists it (`controller.displays`, the same rule that routes the
   * request, so a card with no dock and no toast cannot happen). Decision Q1=2 of Sergio
   * (30/10/2026): a tab visible in another group but not active does not count; the side bar
   * needs no focus, so `sidebar` mode, step 5 and C11 of `test:visual` keep their behaviour.
   * Replaces the old global "any surface visible" flag, which could not tell tabs apart.
   */
  const seenBySurface = (request: PendingSummary): boolean => {
    if (
      sidebarPane !== undefined &&
      view.provider.visible &&
      controller.displays(sidebarPane.id, request.sessionID)
    ) {
      return true;
    }
    return panels
      .ids()
      .some((paneId) => panels.isActive(paneId) && controller.displays(paneId, request.sessionID));
  };
  /**
   * Writes the pending-request count to the surface that carries the badge: the view in `sidebar`
   * mode, the Sessions view in `editor` mode, and 0 to the other so it never keeps a stale number.
   * VERIFIED for the view in front by a full `test:visual` (Windows 11, VS Code 1.144.0, 30/10/2026,
   * 0 FAIL): "ok   C11 with every chat tab hidden a request raises a native notification (…) and the
   * badge of the Sessions view shows on the OpenCode icon ("1")" (step 27).
   */
  const applyBadge = (): void => {
    view.provider.setBadge(mode === 'sidebar' ? badgeCount : 0);
    sessionsView.setBadge(mode === 'editor' ? badgeCount : 0);
  };
  const attention = createAttention({
    target: {
      setBadge: (count) => {
        badgeCount = count;
        applyBadge();
      },
      seen: seenBySurface,
      label: (sessionID) => controller.labelOf(sessionID),
    },
    log,
  });
  // What the controller is given instead of `attention`: the same updates, plus the pending
  // summaries reaching the model of the tree, so a row says "Needs input" (decision Q6=1). A
  // request of a subagent marks the ROOT row, at any depth (E4 of #77): the tree lists roots only.
  // An unknown chain (`rootOf` undefined) falls back to the session itself, as before.
  const attentionAndTree: AttentionSink = {
    update: (requests) => {
      attention.update(requests);
      const marked = requests.map((request) => ({
        sessionID: controller.rootOf(request.sessionID) ?? request.sessionID,
      }));
      if (sessionTree.setPending(marked)) sessionsView.refresh();
    },
  };
  // Issue #124: the status bar item with the state of the server and its model. Created here (the
  // controller feeds it), shown at once and disposed with the rest; a click opens the chat.
  const statusItem = vscode.window.createStatusBarItem(
    SERVER_STATUS_ITEM_ID,
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusItem.name = 'OpenCode';
  statusItem.command = OPEN_CHAT_COMMAND_ID;
  let statusConnection: ConnectionState = { state: 'starting' };
  let statusCatalog: Catalog | undefined;
  const paintStatus = (): void => {
    const status = describeServerStatus(statusConnection, statusCatalog);
    statusItem.text = status.text;
    statusItem.tooltip = status.tooltip;
    statusItem.accessibilityInformation = { label: status.ariaLabel };
    statusItem.backgroundColor = status.error
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : undefined;
  };
  paintStatus();
  statusItem.show();
  const controller = new ChatController({
    serverStatus: {
      connection: (next) => {
        statusConnection = next;
        paintStatus();
      },
      catalog: (next) => {
        statusCatalog = next;
        paintStatus();
      },
    },
    createClient: createOpencodeClient,
    log,
    editor: createEditorActions(log, { lastEditor, tabs }),
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
    attention: attentionAndTree,
    savedPermissions: { pickToRevoke: pickSavedPermissionsToRevoke },
    sessions: {
      confirmDelete: (info) => {
        const answer = testAnswers.confirmDelete;
        if (answer === undefined) return confirmSessionDelete(info);
        delete testAnswers.confirmDelete;
        return Promise.resolve(answer);
      },
      confirmRevertDiscard,
    },
    sessionList: {
      reset: (page) => {
        // The organization of the served folder goes in BEFORE the rows, so the first paint is
        // already laid out in folders; the read of the organized sessions the page lacks follows.
        const organized = organize.use(page.folder);
        const reset = sessionTree.reset(page);
        lastPage = { rows: page.rows, hasMore: page.hasMore };
        if (organized || reset) sessionsView.refresh();
        organize.reconcile(lastPage);
      },
      failed: () => {
        if (sessionTree.fail()) sessionsView.refresh();
      },
      append: (rows, hasMore) => {
        if (sessionTree.append(rows, hasMore)) sessionsView.refresh();
      },
      event: (message) => {
        if (sessionTree.event(message)) sessionsView.refresh();
        // A deleted session (here or by another client) leaves the organization too; nothing is
        // deleted on the server by this (risk R7 of the plan: a move by another client may do the same).
        if (message.type === 'session.removed') organize.forget([message.sessionID]);
      },
      connection: (next) => {
        connection = next;
        sessionTree.setOnline(next.state === 'connected');
        // Always repaint: the context key (welcome) may change even when the rows do not.
        sessionsView.refresh();
      },
    },
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
      focusView: (paneId) => {
        // W3 of review 1: this runs after the document of `paneId` is ready, long after the click
        // that asked for it. If the user revealed another chat surface meanwhile, pulling this one
        // in front would undo that choice, so the reveal is dropped.
        if (!revealOrder.focusStillWanted(paneId)) {
          log.debug(
            `post-ready focus of pane ${String(paneId)} dropped: another surface was revealed`,
          );
          return;
        }
        revealSurface(paneId, false, true);
      },
      revealPane: (paneId) => {
        revealSurface(paneId, false);
      },
      openElsewhere: (fromPaneId, sessionID) => {
        if (mode !== 'editor') return false;
        const existing = sessionID === undefined ? undefined : paneShowing(sessionID);
        // The asker already shows it: not a duplicate, the controller resyncs it in place.
        if (existing === fromPaneId) return false;
        if (existing !== undefined) revealSurface(existing, false);
        else openTab(sessionID, true);
        return true;
      },
    },
  });

  /** The session remembered for the folder the server serves now, if any. */
  const rememberedSession = (): string | undefined => {
    const state = manager.state;
    if (state.kind !== 'running') return undefined;
    const map = readSessionMap(context);
    return Object.hasOwn(map, state.server.folder) ? map[state.server.folder] : undefined;
  };
  /**
   * The pane (a tab, most recent first, then the side bar) that already shows `sessionID`, if any.
   * Reads the controller's own state (`ChatController.sessionOf`), which changes the moment a
   * session is bound; the registry of tabs only learns it from a posted snapshot and would let a
   * duplicate through in between.
   */
  const paneShowing = (sessionID: string): number | undefined => {
    const candidates = [...tabs.recent(), ...(sidebarPane === undefined ? [] : [sidebarPane.id])];
    return candidates.find((paneId) => controller.sessionOf(paneId) === sessionID);
  };
  /** The open tabs with the session each shows (the controller's state), most recent first. */
  const tabsSnapshot = (): TabSnapshot[] =>
    tabs.recent().map((paneId) => ({ paneId, sessionID: controller.sessionOf(paneId) }));
  /**
   * Brings the surface of `paneId` forward: the tab in its own column, or the view with the
   * keyboard in it. `preserveFocus` only applies to a tab.
   */
  const revealSurface = (paneId: number, preserveFocus: boolean, late = false): void => {
    // The reveal the post-ready focus makes is not "someone chose this tab": it must not overtake
    // the focus requests of the other tabs still loading (see `RevealOrder`).
    if (!late) revealOrder.noteReveal(paneId);
    if (tabs.has(paneId)) panels.reveal(paneId, preserveFocus);
    else void vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
  };
  /**
   * Opens a NEW tab, bound to `sessionID` or lazy, and returns its pane id. `focus` puts the
   * keyboard in its prompt box (kept by the controller until the document is ready); without it
   * the tab opens in the background, which is what a change of location needs.
   */
  const openTab = (sessionID: string | undefined, focus: boolean): number => {
    const paneId = panels.open(focus);
    revealOrder.noteReveal(paneId);
    if (sessionID !== undefined) void controller.openInPane(paneId, sessionID);
    if (focus) queuePromptFocus(paneId);
    return paneId;
  };
  /**
   * Attaches the side-bar pane, giving it `sessionID` when there is one (nothing else touches the
   * memory). It is the `primary` surface: a server for a new folder gives IT the remembered session
   * even when leftover tabs were attached before it.
   */
  const attachSidebar = (sessionID: string | undefined): ChatPane => {
    const pane = controller.attachPane({
      post: (message) => {
        view.provider.post(message);
      },
      canDeliver: () => view.provider.canDeliver,
      primary: true,
    });
    sidebarPane = pane;
    if (sessionID !== undefined) void controller.openInPane(pane.id, sessionID);
    return pane;
  };
  /**
   * The side-bar pane. In `sidebar` mode it always exists: attached at start, or by
   * `applyLocation` before the mode is observable from outside. Throws if called without it, which
   * would be a bug in the callers, not a state to heal (the view that resolves BEFORE the setting
   * change is handled by `applyLocation`, which answers the view's `ready` it had dropped).
   */
  const ensureSidebar = (): ChatPane => {
    if (sidebarPane === undefined) throw new Error('the side-bar pane is not attached');
    return sidebarPane;
  };
  /**
   * Applies a new value of the setting: runs the actions of `planLocationSwitch` in order, then
   * moves the badge and recomputes visibility. Closes nothing (decision Q4 of Sergio). When the
   * side-bar pane is attached and the view can already deliver, the view's `ready` (dropped by
   * `onReady` while the mode was still `editor`) is answered here, or the view would keep its
   * initial state until it was hidden and shown again. That branch writes its own line, `side-bar
   * view already resolved: replaying ready`, so a test can tell it from a view that resolved
   * again after the switch (which logs `Chat view resolved`).
   * VERIFIED in a real VS Code (Windows 11, 29/10/2026) by "keeps the tabs open and the side-bar
   * view working when going back to sidebar" (the `chat location changed to` lines, no tab
   * closed) and by "opens the diff beside a chat tab, and serves prompts and session.open from
   * tabs" (the side-bar session opens in a tab).
   * NOT observed in a real window: the replay branch. The integration case "answers an
   * already-open side-bar view…" always saw the view resolve again instead (`Chat view resolved`).
   */
  const applyLocation = (next: ChatLocation): void => {
    if (next === mode) return;
    const actions = planLocationSwitch(mode, next, {
      sidebarSession: sidebarPane?.sessionID,
      rememberedSession: rememberedSession(),
      tabs: tabsSnapshot(),
    });
    mode = next;
    log.info(`chat location changed to ${next}`);
    // The tree comes into use: read the organized sessions the page lacked (nothing was read in sidebar).
    if (mode === 'editor' && lastPage !== undefined) organize.reconcile(lastPage);
    for (const action of actions) {
      switch (action.kind) {
        case 'detachSidebar':
          if (sidebarPane !== undefined) controller.detachPane(sidebarPane.id);
          sidebarPane = undefined;
          break;
        case 'openTab':
          openTab(action.sessionID, false);
          break;
        case 'revealTab':
          panels.reveal(action.paneId, true);
          break;
        case 'attachSidebar': {
          const pane = attachSidebar(action.sessionID);
          // A view that resolved while the mode was still `editor` had its `ready` dropped by the
          // view's `onReady` and will not send another: answer it now.
          if (view.provider.canDeliver) {
            // Stable line, only this branch writes it: it tells a test which path answered.
            log.info('side-bar view already resolved: replaying ready');
            void controller.onPaneReady(pane.id).catch((error: unknown) => {
              log.error(`answering webview ready failed: ${String(error)}`);
            });
          }
          break;
        }
      }
    }
    applyBadge();
    onSurfaceChange();
  };
  /**
   * Gives a surface that is no longer on screen the blur its iframe may never send, so
   * `openVsCode.chatFocused` cannot stay true for a hidden chat (issue #35, kept for tabs).
   */
  const blurHiddenSurfaces = (): void => {
    if (!chatFocused) return;
    const hidden = [
      ...(sidebarPane !== undefined && !view.provider.visible ? [sidebarPane.id] : []),
      ...panels.ids().filter((id) => !panels.isVisible(id)),
    ];
    for (const paneId of hidden) {
      void controller.handle(paneId, { type: 'chat.focusChanged', focused: false });
    }
  };
  /**
   * Tells the Sessions tree which sessions have a tab (the controller's own state, see
   * `paneShowing`) and moves its selection to the session of the active tab, or the most recent
   * one (decision T8=1). Does nothing in `sidebar` mode, where the tree is not shown.
   */
  const syncSessionsTree = (): void => {
    if (mode !== 'editor') return;
    const shown = tabs.recent().flatMap((paneId) => {
      const sessionID = controller.sessionOf(paneId);
      return sessionID === undefined ? [] : [sessionID];
    });
    if (sessionTree.setTabs(shown)) sessionsView.refresh();
    const target = tabs.commandTarget();
    sessionsView.reveal(target === undefined ? undefined : controller.sessionOf(target));
  };
  /**
   * A surface appeared, hid, was activated or closed: asks the attention feature again which
   * requests are seen (a tab becoming the active editor closes the toast of the request it shows),
   * and refreshes what depends on the surfaces.
   */
  const onSurfaceChange = (): void => {
    attention.refresh();
    blurHiddenSurfaces();
    syncSessionsTree();
  };
  /** Which welcome the tree shows when it has no rows: no folder, no server, or an empty list. */
  const sessionsState = (): SessionsState => {
    if (connection?.state === 'unavailable' && connection.reason === 'no-workspace') {
      return 'noFolder';
    }
    if (sessionTree.load() === 'offline') return 'offline';
    return sessionTree.filteredEmpty() ? 'filteredEmpty' : 'ready';
  };
  const sessionsView = registerSessionsView({
    tree: sessionTree,
    log,
    locale: vscode.env.language,
    state: sessionsState,
    changedFiles: (sessionID) => controller.changedFilesOf(sessionID),
    drop: (drag, target) => {
      organize.drop(drag, target);
    },
    folderName: () => {
      const state = manager.state;
      if ((vscode.workspace.workspaceFolders?.length ?? 0) < 2 || state.kind !== 'running') {
        return undefined;
      }
      return path.basename(state.server.folder);
    },
  });
  // E9-sessions-organize: folders, pins, archive and the filters of the Sessions tree.
  const organize = registerSessionsOrganize({
    memento: context.workspaceState,
    tree: sessionTree,
    view: sessionsView,
    log,
    editorMode: () => mode === 'editor',
    readSessions: (ids) => controller.readSessions(ids),
    answers: testAnswers,
  });
  const panels = new ChatPanels(context.extensionUri, channel, log, tabs, {
    attachPane: (surface) => controller.attachPane(surface),
    detachPane: (paneId) => {
      revealOrder.forget(paneId);
      controller.detachPane(paneId);
    },
    onReady: (paneId) => {
      gate?.changed();
      void controller.onPaneReady(paneId).catch((error: unknown) => {
        log.error(`answering webview ready failed: ${String(error)}`);
      });
    },
    onMessage: (paneId, message) => {
      void controller.handle(paneId, message).catch((error: unknown) => {
        log.error(`handling ${message.type} failed: ${String(error)}`);
      });
    },
    onResync: (paneId) => {
      gate?.changed();
      void controller.onPaneReady(paneId).catch((error: unknown) => {
        log.error(`resync of a returning chat tab failed: ${String(error)}`);
      });
    },
    onSurfaceChange,
    onTabSessionChanged: () => {
      syncSessionsTree();
      // A tab that now opens the session of a pending request sees it (and one that left it stops).
      attention.refresh();
    },
    restoreSession: (paneId, sessionID) => {
      controller.restorePane(paneId, sessionID);
    },
    paneShowing,
    revealSurface: (paneId) => {
      revealSurface(paneId, false);
    },
  });
  // In `sidebar` mode the side-bar view's pane exists from the start, attached BEFORE the server
  // state is applied so it receives the remembered session. Its callbacks read the pane lazily.
  if (mode === 'sidebar') attachSidebar(undefined);
  const view = registerChatView(context.extensionUri, channel, {
    onReady: () => {
      // Issue #87: the provider marked the view `ready` before calling this, so `canDeliver` is
      // true now; wakes any native notification that is waiting to learn the chat is showing.
      gate?.changed();
      if (mode !== 'sidebar') return;
      const pane = ensureSidebar();
      void controller.onPaneReady(pane.id).catch((error: unknown) => {
        log.error(`answering webview ready failed: ${String(error)}`);
      });
    },
    onMessage: (message) => {
      if (sidebarPane === undefined) return;
      void controller.handle(sidebarPane.id, message).catch((error: unknown) => {
        log.error(`handling ${message.type} failed: ${String(error)}`);
      });
    },
    onVisibilityChange: () => {
      onSurfaceChange();
    },
  });
  // P3=2 (issue #85): the notifications ask whether a surface can show the failure itself.
  gate?.attach(
    () => (sidebarPane !== undefined && view.provider.canDeliver) || panels.anyCanDeliver(),
  );
  /**
   * The pane every command of the menus and the palette talks to (the ONE place to change, risk R8
   * of #36), and whether it had to be created for the call. `sidebar`: the view's pane. `editor`:
   * the active tab, else the most recent, else a NEW tab with the last session of the folder
   * (decision P9=1). `focus` false opens that new tab in the background, for the entries that
   * reveal the chat only if the action is not refused.
   */
  const targetPane = (focus: boolean): { paneId: number; created: boolean } => {
    if (mode === 'sidebar') return { paneId: ensureSidebar().id, created: false };
    const existing = tabs.commandTarget();
    if (existing !== undefined) return { paneId: existing, created: false };
    return { paneId: openTab(rememberedSession(), focus), created: true };
  };
  /** Shows the chat of `paneId` without moving the keyboard into it. */
  const revealChat = async (paneId: number): Promise<void> => {
    revealOrder.noteReveal(paneId);
    if (tabs.has(paneId)) {
      panels.reveal(paneId, false);
      return;
    }
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
  };
  /**
   * Closes a context-menu entry (issue #36). `rejected` (nothing valid to send) shows the reason
   * as a native warning and does NOT open the chat (decision P11=1 of Sergio): a tab that was
   * opened just for this call is closed again. `composed` and `notified` reveal it, `notified`
   * because its "items were not added" notice is waiting there. The warning is not awaited:
   * `showWarningMessage` settles when the user dismisses it.
   */
  const finishContextAction = async (
    outcome: ComposeOutcome,
    target: { paneId: number; created: boolean },
  ): Promise<void> => {
    if (outcome.status === 'rejected') {
      if (target.created) panels.close(target.paneId);
      void vscode.window.showWarningMessage(outcome.error.message);
      return;
    }
    await revealChat(target.paneId);
  };
  /**
   * Reveals the chat and relays `command` to its webview. `sidebar`: the view's generated focus
   * command, then the command. `editor`: the active or most recent tab; with none, a new tab with
   * the last session (it focuses its own prompt) and nothing else, except Stop, which has nothing
   * to stop and opens nothing.
   */
  const runInChat = async (command: UiCommand): Promise<void> => {
    if (mode === 'sidebar') {
      const pane = ensureSidebar();
      await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
      controller.runUiCommand(pane.id, command);
      return;
    }
    const paneId = tabs.commandTarget();
    if (paneId === undefined) {
      if (command !== 'session.stop') openTab(rememberedSession(), true);
      return;
    }
    revealOrder.noteReveal(paneId);
    panels.reveal(paneId, false);
    controller.runUiCommand(paneId, command);
  };

  /**
   * Puts `sessionID` in a tab (an `editor`-mode action, shared by the Sessions tree and by "Open
   * chat" of a notification): a tab that already shows it is revealed; else the active or most
   * recent tab is adopted when it is EMPTY; else a new tab opens in the chat group. Returns the
   * pane and a promise that settles when the pane has loaded the session (immediately when the tab
   * already showed it or is a NEW tab, whose document is not ready yet and keeps its own requests).
   * `focusPrompt` also puts the keyboard in the prompt box (the tree does; the notification does
   * not, because it focuses the request card afterwards). Never leaves two tabs on one session,
   * because the first question is the controller's own state (`paneShowing`).
   * VERIFIED only for the "a new tab opens" branch, through "Open chat" with no owner tab
   * (`fakeServer.test.ts` "opens the tab of the session when Open chat finds no tab that lists the
   * request", Windows 11, VS Code 1.144.0, 30/10/2026). NOT observed in a real window: adopting an
   * EMPTY tab and awaiting `loaded` (only Vitest fabricates it).
   */
  const placeSession = (
    sessionID: string,
    focusPrompt: boolean,
  ): { paneId: number; loaded: Promise<void> } => {
    const shown = paneShowing(sessionID);
    if (shown !== undefined) {
      revealSurface(shown, false);
      if (focusPrompt) queuePromptFocus(shown);
      return { paneId: shown, loaded: Promise.resolve() };
    }
    const candidate = tabs.commandTarget();
    if (candidate !== undefined && controller.sessionOf(candidate) === undefined) {
      const loaded = controller.openInPane(candidate, sessionID).catch((error: unknown) => {
        log.error(`opening a session in an empty tab failed: ${String(error)}`);
      });
      revealSurface(candidate, false);
      if (focusPrompt) queuePromptFocus(candidate);
      return { paneId: candidate, loaded };
    }
    return { paneId: openTab(sessionID, focusPrompt), loaded: Promise.resolve() };
  };
  /**
   * Opens a session from the Sessions tree (decision Q3=1/1), an `editor`-mode action: see
   * {@link placeSession}, with the focus in the prompt. Nothing in `sidebar` mode, where the tree
   * is hidden.
   */
  const openSession = (sessionID: string): void => {
    if (mode !== 'editor') return;
    placeSession(sessionID, true);
  };
  /**
   * The session Rename and Delete act on: its argument (the row that was CLICKED), else the row
   * selected in the tree. With `canSelectMany` VS Code also passes the whole selection as a second
   * argument; it is ignored on purpose (risk R5 of E9-sessions-organize): renaming or deleting
   * every selected row from one click on a row would be a surprise, and Delete is irreversible.
   * The organizing commands (`sessionsOrganize.ts`) are the ones that act on the selection.
   */
  const targetSession = (raw: unknown): string | undefined =>
    sessionIDOf(raw) ?? sessionsView.selectedSessions()[0]?.sessionID;

  const disposables: vscode.Disposable[] = [
    view.disposable,
    sessionsView.disposable,
    organize.disposable,
    // Not `dispose`: the tabs stay open so the workbench can save them for the next start.
    { dispose: () => panels.detachAll() },
    // Registered in BOTH modes: VS Code only persists a chat tab if a serializer exists for its
    // view type, and a tab left over from `editor` mode must come back after `sidebar` too (Q2=1).
    vscode.window.registerWebviewPanelSerializer(CHAT_PANEL_VIEW_TYPE, {
      deserializeWebviewPanel: (panel, state: unknown) => {
        panels.restore(panel, state);
        return Promise.resolve();
      },
    }),
    { dispose: () => lastEditor.dispose() },
    manager.onDidChangeState((state) => {
      controller.onServerState(state);
      // The served folder (multi-root description of the Sessions view) follows the server state.
      sessionsView.refresh();
    }),
    // E3 (issue #77): the actions of the native Sessions tree. Failures are native warnings.
    vscode.commands.registerCommand(OPEN_SESSION_COMMAND_ID, (raw: unknown) => {
      const sessionID = sessionIDOf(raw);
      if (sessionID === undefined) {
        log.warn(`${OPEN_SESSION_COMMAND_ID} rejected: invalid arguments`);
        return;
      }
      openSession(sessionID);
    }),
    vscode.commands.registerCommand(RENAME_SESSION_COMMAND_ID, async (raw: unknown) => {
      const sessionID = targetSession(raw);
      if (sessionID === undefined) return;
      const current = sessionTree.rowOf(sessionID)?.title ?? '';
      let title: string | undefined;
      if (testAnswers.title === undefined) {
        title = await askSessionTitle(current);
      } else {
        title = testAnswers.title ?? undefined;
        delete testAnswers.title;
      }
      if (title === undefined) return;
      try {
        await controller.renameSessionById(sessionID, title);
      } catch (error) {
        warnSessionFailure('rename the session', error);
      }
    }),
    vscode.commands.registerCommand(DELETE_SESSION_COMMAND_ID, async (raw: unknown) => {
      const sessionID = targetSession(raw);
      if (sessionID === undefined) return;
      // P8: read the tab BEFORE deleting, because the removal makes every pane forget the session.
      const shown = paneShowing(sessionID);
      try {
        const { deleted } = await controller.deleteSessionById(sessionID);
        if (deleted && shown !== undefined && tabs.has(shown)) panels.close(shown);
      } catch (error) {
        warnSessionFailure('delete the session', error);
      }
    }),
    vscode.commands.registerCommand(SHOW_MORE_SESSIONS_COMMAND_ID, async () => {
      try {
        await controller.loadMoreSessions();
      } catch (error) {
        warnSessionFailure('load more sessions', error);
      }
    }),
    vscode.commands.registerCommand(SEARCH_SESSIONS_COMMAND_ID, async () => {
      if (mode !== 'editor') return;
      await showSessionsSearch({
        search: (text) => controller.searchSessions(text),
        open: openSession,
        locale: vscode.env.language,
        placeOf: (sessionID) => organize.placeOf(sessionID),
      });
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(DEFAULT_MODEL_SETTING)) controller.onPreferencesChanged();
      if (event.affectsConfiguration(CHAT_LOCATION_SETTING)) applyLocation(readLocation());
    }),
    vscode.commands.registerCommand(OPEN_SETTINGS_COMMAND_ID, async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        `@ext:${context.extension.id}`,
      );
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
    statusItem,
    { dispose: () => attention.dispose() },
    vscode.commands.registerCommand(MANAGE_PERMISSIONS_COMMAND_ID, async () => {
      const target = targetPane(false);
      // `editor` mode with no tab: the tab opened just to host the picker is shown, not left in
      // the background. VERIFIED in VS Code 1.144.0 on Windows 11 (29/10/2026): the integration
      // check "Manage Saved Permissions uses the open tab, or opens and shows one" runs it with no
      // tab open and asserts the new tab is active.
      if (target.created) await revealChat(target.paneId);
      await controller.handle(target.paneId, { type: 'permissions.manage' });
    }),
    // Issue #35.
    vscode.commands.registerCommand(OPEN_CHAT_COMMAND_ID, () => runInChat('prompt.focus')),
    vscode.commands.registerCommand(FOCUS_PROMPT_COMMAND_ID, async (args: unknown) => {
      if (focusPromptTarget(args, chatFocused) === 'editor') {
        // With a chat tab open the active group may be the chat's own, so the focus goes to the
        // last text editor (issue #77); with none, the group command is what it always was.
        const editor = tabs.recent().length > 0 ? lastEditor.current() : undefined;
        if (editor === undefined) {
          await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        } else {
          await vscode.window.showTextDocument(editor.document, {
            viewColumn: editor.viewColumn,
            preserveFocus: false,
          });
        }
        return;
      }
      await runInChat('prompt.focus');
    }),
    // In `editor` mode New Session is a new lazy tab; the button inside a tab asks the same
    // through `session.new` (`openElsewhere`).
    vscode.commands.registerCommand(NEW_SESSION_COMMAND_ID, async () => {
      if (mode === 'editor') {
        openTab(undefined, true);
        return;
      }
      await runInChat('session.new');
    }),
    vscode.commands.registerCommand(STOP_RESPONSE_COMMAND_ID, () => runInChat('session.stop')),
    // Issue #30: the Explorer passes (clicked item, all selected items). The strings go through
    // the same host checks as a drop (`dropFiles`), minus the `file.find` one.
    vscode.commands.registerCommand(
      ADD_TO_CHAT_COMMAND_ID,
      async (clicked: unknown, selected: unknown) => {
        const { paneId } = targetPane(false);
        await revealChat(paneId);
        await controller.addToChat(paneId, explorerUris(clicked, selected));
      },
    ),
    // Issue #36: the context-menu entries. The editor ones receive the `Uri` of the right-clicked
    // document (nothing from the palette), the Explorer one the same pair as Add to OpenCode Chat.
    vscode.commands.registerCommand(ADD_SELECTION_TO_CHAT_COMMAND_ID, async (uri: unknown) => {
      const target = targetPane(false);
      await finishContextAction(
        await controller.addEditorToChat(target.paneId, editorUri(uri)),
        target,
      );
    }),
    vscode.commands.registerCommand(EXPLAIN_SELECTION_COMMAND_ID, async (uri: unknown) => {
      const target = targetPane(false);
      await finishContextAction(
        await controller.composeFromEditor(target.paneId, 'explain', editorUri(uri)),
        target,
      );
    }),
    vscode.commands.registerCommand(FIX_SELECTION_COMMAND_ID, async (uri: unknown) => {
      const target = targetPane(false);
      await finishContextAction(
        await controller.composeFromEditor(target.paneId, 'fix', editorUri(uri)),
        target,
      );
    }),
    vscode.commands.registerCommand(
      EXPLAIN_FILES_COMMAND_ID,
      async (clicked: unknown, selected: unknown) => {
        const target = targetPane(false);
        await finishContextAction(
          await controller.composeFromFiles(
            target.paneId,
            'explain',
            explorerUris(clicked, selected),
          ),
          target,
        );
      },
    ),
    vscode.commands.registerCommand(SHOW_REQUEST_COMMAND_ID, async (raw: unknown) => {
      const target = parseFocusTarget(raw);
      if (target === undefined) {
        log.warn(`${SHOW_REQUEST_COMMAND_ID} rejected: invalid arguments`);
        return;
      }
      // E4 of #77: the owner is the surface whose dock LISTS the request (`controller.displays`: a
      // tab of the session or of an ancestor, most recent first, then the side-bar view), not the
      // active tab. With no owner, `sidebar` mode shows it in the view; `editor` mode puts the ROOT
      // of its lineage in a tab (decision Q4=1; the session itself while the chain is unknown), with
      // the prompt left alone, because the request card takes the focus next.
      const owner = [...tabs.recent(), ...(sidebarPane === undefined ? [] : [sidebarPane.id])].find(
        (candidate) => controller.displays(candidate, target.sessionID),
      );
      let paneId: number;
      let loaded: Promise<void> = Promise.resolve();
      if (owner !== undefined) {
        paneId = owner;
      } else if (mode === 'sidebar') {
        paneId = ensureSidebar().id;
      } else {
        const placed = placeSession(controller.rootOf(target.sessionID) ?? target.sessionID, false);
        paneId = placed.paneId;
        loaded = placed.loaded;
      }
      await revealChat(paneId);
      await loaded;
      controller.focusRequest(paneId, target);
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
      vscode.commands.registerCommand(TEST_SESSION_ANSWERS_COMMAND_ID, (raw: unknown) => {
        // Answers for the NEXT Rename box (`title`, `null` cancels) and Delete modal.
        const args =
          typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
        if (typeof args.title === 'string' || args.title === null) testAnswers.title = args.title;
        if (typeof args.confirmDelete === 'boolean') testAnswers.confirmDelete = args.confirmDelete;
        // The organizing dialogs: same one-shot rule, `null` cancels.
        if (typeof args.folderName === 'string' || args.folderName === null) {
          testAnswers.folderName = args.folderName;
        }
        if (
          args.pickFolder === null ||
          args.pickFolder === 'none' ||
          args.pickFolder === 'new' ||
          (Array.isArray(args.pickFolder) && args.pickFolder.every((p) => typeof p === 'string'))
        ) {
          testAnswers.pickFolder = args.pickFolder;
        }
        if (typeof args.confirmFolderDelete === 'boolean') {
          testAnswers.confirmFolderDelete = args.confirmFolderDelete;
        }
        if (
          args.filters === null ||
          (Array.isArray(args.filters) && args.filters.every((f) => typeof f === 'string'))
        ) {
          testAnswers.filters = args.filters;
        }
      }),
      vscode.commands.registerCommand(TEST_SESSION_ORGANIZATION_COMMAND_ID, () =>
        organize.stored(),
      ),
      vscode.commands.registerCommand(RESTORE_CHAT_TAB_TEST_COMMAND_ID, (raw: unknown) => {
        // The persisted state and title of a tab "revived by VS Code"; a panel we create stands in
        // for the revived one and goes through the SAME `restore` as the serializer.
        const args =
          typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
        const title = typeof args.title === 'string' ? args.title : EMPTY_TITLE;
        const panel = vscode.window.createWebviewPanel(
          CHAT_PANEL_VIEW_TYPE,
          title,
          { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
          { ...chatWebviewOptions(context.extensionUri), retainContextWhenHidden: true },
        );
        panels.restore(panel, args.state);
      }),
      vscode.commands.registerCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, async (raw: unknown) => {
        if (!isWebviewToHost(raw)) {
          log.warn('injected message rejected by isWebviewToHost');
          return;
        }
        // Same target rule as the commands, without opening anything: a test opens its tab first.
        const paneId = mode === 'sidebar' ? sidebarPane?.id : tabs.commandTarget();
        if (paneId === undefined) {
          log.warn('injected message dropped: no chat surface is open');
          return;
        }
        await controller.handle(paneId, raw);
      }),
    );
  }
  return vscode.Disposable.from(...disposables);
}
