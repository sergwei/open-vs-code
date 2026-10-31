// Identifiers shared by the host code. The ids of the view container, view, commands and the
// opencodePath setting are declared twice: here and in `contributes` of package.json, and they
// MUST stay identical. CONFIG_SECTION and OPENCODE_PATH_KEY are only the prefix and suffix of
// that setting id; LOG_CHANNEL_NAME lives only here and is NOT checked by any test.
// `manifest.test.ts` (issue #4) compares against the real package.json in both directions:
// VIEW_CONTAINER_ID, CHAT_VIEW_ID and SHOW_LOGS_COMMAND_ID must exist in `contributes`, and every
// contributed command / view / view container id must have a constant here.
// `opencodeBinary.test.ts` (issue #7) checks that OPENCODE_PATH_SETTING exists in
// `contributes.configuration` with scope `machine`. A new command, view or view container
// without its constant fails `manifest.test.ts`. Since issue #38 the `contributes.configuration`
// describe of that file also fails for a contributed setting without a constant here (and for
// one without type, default, scope, description or a distinct `order`).

/** Activity Bar container id (`contributes.viewsContainers.activitybar[].id`). */
export const VIEW_CONTAINER_ID = 'openVsCode';

/** Chat webview view id (`contributes.views.openVsCode[].id`). */
export const CHAT_VIEW_ID = 'openVsCode.chat';

/**
 * Native Sessions tree view, shown in place of the chat while `openVsCode.chatLocation` is `editor`
 * (issue #77, `contributes.views.openVsCode[].id`). It lists the sessions of the folder and holds
 * no chat.
 */
export const SESSIONS_VIEW_ID = 'openVsCode.sessions';

/**
 * `viewType` of the editor tabs that show the chat (issue #77). Not contributed: a
 * `WebviewPanel` needs no entry in `contributes`. VS Code may prefix the type it reports in
 * `TabInputWebview.viewType` (HYPOTHESIS), so tests compare with `endsWith`.
 */
export const CHAT_PANEL_VIEW_TYPE = 'openVsCode.chatPanel';

/** Command id of "OpenCode: Open Settings" (contributed; issue #77): Settings filtered to this extension. */
export const OPEN_SETTINGS_COMMAND_ID = 'openVsCode.openSettings';

/** Key of the chat-location setting inside {@link CONFIG_SECTION} (issue #77): `sidebar` or `editor`. */
export const CHAT_LOCATION_KEY = 'chatLocation';

/** Full id of the chat-location setting (`contributes.configuration.properties`; also read by the `when` of the views). */
export const CHAT_LOCATION_SETTING = 'openVsCode.chatLocation';

/** Command id of "OpenCode: Show Logs" (`contributes.commands[].command`). */
export const SHOW_LOGS_COMMAND_ID = 'openVsCode.showLogs';

/**
 * Internal command that feeds a webview message to the host as if the webview had sent it
 * (issue #14). It is registered ONLY when the extension runs in `ExtensionMode.Test` and it is
 * deliberately NOT declared in `contributes`: it is not a user command. `manifest.test.ts` only
 * demands a constant for what IS contributed, so having one here for an uncontributed id is fine.
 */
export const INJECT_WEBVIEW_MESSAGE_COMMAND_ID = 'openVsCode.test.injectWebviewMessage';

/**
 * Internal command that creates a `WebviewPanel` of {@link CHAT_PANEL_VIEW_TYPE} and hands it to
 * the SAME `ChatPanels.restore` the panel serializer uses (issue #77), because the test API cannot
 * make VS Code call a serializer (a real Reload Window kills the test host). Argument:
 * `{ state?: unknown, title?: string }`, the persisted webview state and the title the revived tab
 * would carry. Registered ONLY in `ExtensionMode.Test` and NOT declared in `contributes`, like
 * {@link INJECT_WEBVIEW_MESSAGE_COMMAND_ID}.
 */
export const RESTORE_CHAT_TAB_TEST_COMMAND_ID = 'openVsCode.test.restoreChatTab';

/** Command id of "OpenCode: Restart Server" (contributed; issue #10). */
export const RESTART_SERVER_COMMAND_ID = 'openVsCode.restartServer';

/** Command id of "OpenCode: Select Workspace Folder" (contributed; multi-root, issue #10). */
export const SELECT_FOLDER_COMMAND_ID = 'openVsCode.selectFolder';

/** Command id of "OpenCode: Manage Saved Permissions" (contributed; issue #18). */
export const MANAGE_PERMISSIONS_COMMAND_ID = 'openVsCode.managePermissions';

/**
 * Internal command behind the "Open chat" link of an attention notification (issue #19): shows
 * the chat view and focuses the request. Registered always, deliberately NOT declared in
 * `contributes` (it takes arguments and is no user command), like the injection command above.
 * `manifest.test.ts` only demands constants for what IS contributed.
 */
export const SHOW_REQUEST_COMMAND_ID = 'openVsCode.internal.showRequest';

/**
 * Internal command behind the "Allow once" / "Reject" links of a permission notification (issue
 * #19). Same status as {@link SHOW_REQUEST_COMMAND_ID}: registered, not contributed. Its arguments
 * come from a link in a notification, so the handler validates them before using them.
 */
export const REPLY_PERMISSION_COMMAND_ID = 'openVsCode.internal.replyPermission';

/**
 * Command id of "Add to OpenCode Chat" (contributed in `menus.explorer/context`; issue #30,
 * decision Q1 of Sergio): attaches the selected Explorer files to the prompt. It works in every
 * VS Code version, unlike dropping, which the stable 1.140+ does not deliver (#339036).
 */
export const ADD_TO_CHAT_COMMAND_ID = 'openVsCode.addToChat';

/**
 * Command id of "Add to OpenCode Chat" in the EDITOR context menu (contributed in
 * `menus.editor/context`; issue #36, decision T2=1 of Sergio): attaches the selection, or the
 * whole file, of the right-clicked document. A separate id from {@link ADD_TO_CHAT_COMMAND_ID},
 * which takes the Explorer's arguments.
 */
export const ADD_SELECTION_TO_CHAT_COMMAND_ID = 'openVsCode.addSelectionToChat';

/**
 * Command id of "Explain with OpenCode" in the EDITOR context menu and the palette (contributed;
 * issue #36): asks the chat to explain the selection, or the whole file.
 */
export const EXPLAIN_SELECTION_COMMAND_ID = 'openVsCode.explainSelection';

/**
 * Command id of "Fix with OpenCode" in the EDITOR context menu and the palette (contributed;
 * issue #36): asks the chat to fix the selection, or the whole file, with the problems VS Code
 * reports for it.
 */
export const FIX_SELECTION_COMMAND_ID = 'openVsCode.fixSelection';

/**
 * Command id of "Explain with OpenCode" in the EXPLORER context menu (contributed, hidden from
 * the palette because it needs the Explorer's arguments; issue #36, decision P2b=1 of Sergio).
 */
export const EXPLAIN_FILES_COMMAND_ID = 'openVsCode.explainFiles';

/**
 * Internal command behind the `command` of every row of the native Sessions tree (issue #77, E3):
 * opens (or reveals) the chat tab of a session. Argument: the session id. Registered always and
 * deliberately NOT contributed (it takes an argument and is no palette command), like
 * {@link SHOW_REQUEST_COMMAND_ID}; it does nothing in `sidebar` mode, where the tree is not shown.
 */
export const OPEN_SESSION_COMMAND_ID = 'openVsCode.openSession';

/**
 * Command id of "OpenCode: Rename Session…" (contributed in `view/item/context`, hidden from the
 * palette; issue #77, E3). Argument: the row clicked; without one (F2) the selected row.
 */
export const RENAME_SESSION_COMMAND_ID = 'openVsCode.renameSession';

/** Command id of "OpenCode: Delete Session" (contributed like {@link RENAME_SESSION_COMMAND_ID}). */
export const DELETE_SESSION_COMMAND_ID = 'openVsCode.deleteSession';

/**
 * Command id of "OpenCode: Search Sessions…" (contributed; issue #77, E3): the QuickPick that
 * searches session titles on the server. In the palette only in `editor` mode.
 */
export const SEARCH_SESSIONS_COMMAND_ID = 'openVsCode.searchSessions';

/**
 * Internal command of the "Show more sessions" row of the tree (issue #77, E3). Registered and NOT
 * contributed, like {@link OPEN_SESSION_COMMAND_ID}.
 */
export const SHOW_MORE_SESSIONS_COMMAND_ID = 'openVsCode.showMoreSessions';

/**
 * Context key `offline | ready | noFolder` (issue #77, E3) that picks which `viewsWelcome` entry of
 * the Sessions view shows. Set with `setContext`, read by the `when` clauses in package.json.
 */
export const SESSIONS_STATE_CONTEXT_KEY = 'openVsCode.sessionsState';

/**
 * Internal command that answers the NEXT Rename box and Delete modal of the Sessions tree without
 * showing them (issue #77, E3), because the integration tests cannot type into a `showInputBox` or
 * click a modal. Argument: `{ title?: string | null, confirmDelete?: boolean }` (`null` cancels the
 * box). Registered ONLY in `ExtensionMode.Test`, NOT contributed, like
 * {@link TEST_SET_SERVER_PASSWORD_COMMAND_ID}.
 */
export const TEST_SESSION_ANSWERS_COMMAND_ID = 'openVsCode.test.sessionAnswers';

/** Configuration section (the prefix of every setting id). */
export const CONFIG_SECTION = 'openVsCode';

/** Key of the opencode executable path inside {@link CONFIG_SECTION}. */
export const OPENCODE_PATH_KEY = 'opencodePath';

/** Full id of the opencode path setting (`contributes.configuration.properties`). */
export const OPENCODE_PATH_SETTING = `${CONFIG_SECTION}.${OPENCODE_PATH_KEY}`;

/** Key of the default-model setting (`provider/model`) inside {@link CONFIG_SECTION} (issue #23). */
export const DEFAULT_MODEL_KEY = 'defaultModel';

/** Full id of the default-model setting (`contributes.configuration.properties`). */
export const DEFAULT_MODEL_SETTING = `${CONFIG_SECTION}.${DEFAULT_MODEL_KEY}`;

/** Key of the external-server URL setting inside {@link CONFIG_SECTION} (issue #11). */
export const SERVER_URL_KEY = 'serverUrl';

/**
 * Full id of the external-server URL setting (`contributes.configuration.properties`). Empty
 * means "launch my own server"; a loopback address means "connect to that one".
 */
export const SERVER_URL_SETTING = `${CONFIG_SECTION}.${SERVER_URL_KEY}`;

/** Key of the auto-start setting inside {@link CONFIG_SECTION} (issue #124). */
export const AUTO_START_KEY = 'autoStart';

/**
 * Full id of the auto-start setting (`contributes.configuration.properties`). `false` keeps the
 * window from launching its own server until the user or the first prompt asks for it.
 */
export const AUTO_START_SETTING = `${CONFIG_SECTION}.${AUTO_START_KEY}`;

/** Id of the server status item of the status bar (issue #124). */
export const SERVER_STATUS_ITEM_ID = 'openVsCode.serverStatus';

/** Command id of "OpenCode: Set Server Password" (contributed; issue #11). */
export const SET_SERVER_PASSWORD_COMMAND_ID = 'openVsCode.setServerPassword';

/** Command id of "OpenCode: Forget Server Password" (contributed; issue #11). */
export const CLEAR_SERVER_PASSWORD_COMMAND_ID = 'openVsCode.clearServerPassword';

/**
 * Internal command that stores a server password without the input box (issue #11). Registered
 * ONLY when the extension runs in `ExtensionMode.Test` and deliberately NOT declared in
 * `contributes`, like {@link INJECT_WEBVIEW_MESSAGE_COMMAND_ID}: the integration tests cannot
 * type into a `showInputBox`.
 */
export const TEST_SET_SERVER_PASSWORD_COMMAND_ID = 'openVsCode.test.setServerPassword';

/**
 * URI scheme of the read-only documents that hold the ORIGINAL side of a "Changed files" diff
 * (issue #31). Registered by `registerSessionDiffProvider` in `sessionDiffEditor.ts`. Not a
 * contributed id, so `manifest.test.ts` neither demands nor checks it.
 */
export const SESSION_DIFF_SCHEME = 'openvscode-diff';

/**
 * Page "Install guide" of the setup guide opens (E2, issue #85, decision P4): the npm page of the
 * v2 CLI package, which names the pinned `@opencode/cli`. External, so it can change; HYPOTHESIS
 * that the page stays at that address (check by opening it).
 */
export const INSTALL_GUIDE_URL = 'https://www.npmjs.com/package/@opencode/cli';

/** Display name of the log output channel. */
export const LOG_CHANNEL_NAME = 'OpenCode';

/** Command id of "OpenCode: Open Chat" (contributed; issue #35): shows the chat, caret in the prompt. */
export const OPEN_CHAT_COMMAND_ID = 'openVsCode.openChat';

/**
 * Command id of "OpenCode: Focus Prompt" (contributed; issue #35): like Open Chat, but pressed
 * again with the chat focused it gives the focus back to the editor (a toggle).
 */
export const FOCUS_PROMPT_COMMAND_ID = 'openVsCode.focusPrompt';

/** Command id of "OpenCode: New Session" (contributed; issue #35): runs the chat's "New session" button. */
export const NEW_SESSION_COMMAND_ID = 'openVsCode.newSession';

/** Command id of "OpenCode: Stop Response" (contributed; issue #35): runs the chat's "Stop" button. */
export const STOP_RESPONSE_COMMAND_ID = 'openVsCode.stopResponse';

/**
 * Context key that is `true` while the chat webview has the keyboard focus (issue #35). Not a
 * contributed id: it is set with `setContext` and read by the `when` clauses of the keybindings
 * in package.json, where it is written out by hand.
 */
export const CHAT_FOCUSED_CONTEXT_KEY = 'openVsCode.chatFocused';
