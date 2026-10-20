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

/** Configuration section (the prefix of every setting id). */
export const CONFIG_SECTION = 'openVsCode';

/** Key of the opencode executable path inside {@link CONFIG_SECTION}. */
export const OPENCODE_PATH_KEY = 'opencodePath';

/** Full id of the opencode path setting (`contributes.configuration.properties`). */
export const OPENCODE_PATH_SETTING = `${CONFIG_SECTION}.${OPENCODE_PATH_KEY}`;

/** Display name of the log output channel. */
export const LOG_CHANNEL_NAME = 'OpenCode';
