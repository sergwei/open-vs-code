// Identifiers shared by the host code. The ids of the view container, view, commands and the
// opencodePath setting are declared twice: here and in `contributes` of package.json, and they
// MUST stay identical. CONFIG_SECTION and OPENCODE_PATH_KEY are only the prefix and suffix of
// that setting id; LOG_CHANNEL_NAME lives only here and is NOT checked by any test.
// `manifest.test.ts` (issue #4) compares against the real package.json in both directions:
// VIEW_CONTAINER_ID, CHAT_VIEW_ID and SHOW_LOGS_COMMAND_ID must exist in `contributes`, and every
// contributed command / view / view container id must have a constant here.
// `opencodeBinary.test.ts` (issue #7) checks that OPENCODE_PATH_SETTING exists in
// `contributes.configuration` with scope `machine`. A new command, view or view container
// without its constant fails `manifest.test.ts`; settings are only checked from the constant to
// the manifest, so a new setting without a constant fails nothing: add the constant by hand.

/** Activity Bar container id (`contributes.viewsContainers.activitybar[].id`). */
export const VIEW_CONTAINER_ID = 'openVsCode';

/** Chat webview view id (`contributes.views.openVsCode[].id`). */
export const CHAT_VIEW_ID = 'openVsCode.chat';

/** Command id of "OpenCode: Show Logs" (`contributes.commands[].command`). */
export const SHOW_LOGS_COMMAND_ID = 'openVsCode.showLogs';

/**
 * Internal command that feeds a webview message to the host as if the webview had sent it
 * (issue #14). It is registered ONLY when the extension runs in `ExtensionMode.Test` and it is
 * deliberately NOT declared in `contributes`: it is not a user command. `manifest.test.ts` only
 * demands a constant for what IS contributed, so having one here for an uncontributed id is fine.
 */
export const INJECT_WEBVIEW_MESSAGE_COMMAND_ID = 'openVsCode.test.injectWebviewMessage';

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

/** Display name of the log output channel. */
export const LOG_CHANNEL_NAME = 'OpenCode';
