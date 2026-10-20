// Identifiers shared by the host code. The first three are declared twice: here
// and in `contributes` of package.json, and they MUST stay identical.
// LOG_CHANNEL_NAME lives only here and is NOT checked by any test. `manifest.test.ts` (issue #4)
// compares against the real package.json in both directions: VIEW_CONTAINER_ID, CHAT_VIEW_ID and
// SHOW_LOGS_COMMAND_ID must exist in `contributes`, and every contributed command / view /
// view container id must have a constant here.
// Extension point: issue #2 imports the view id, issue #7 adds its own ids here. Each new
// `contributes` command or view needs its constant, or that test fails.

/** Activity Bar container id (`contributes.viewsContainers.activitybar[].id`). */
export const VIEW_CONTAINER_ID = 'openVsCode';

/** Chat webview view id (`contributes.views.openVsCode[].id`). */
export const CHAT_VIEW_ID = 'openVsCode.chat';

/** Command id of "OpenCode: Show Logs" (`contributes.commands[].command`). */
export const SHOW_LOGS_COMMAND_ID = 'openVsCode.showLogs';

/** Display name of the log output channel. */
export const LOG_CHANNEL_NAME = 'OpenCode';
