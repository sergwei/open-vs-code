// Identifiers shared by the host code. The first three are declared twice: here
// and in `contributes` of package.json, and they MUST stay identical.
// LOG_CHANNEL_NAME lives only here. UNVERIFIED: nothing checks this automatically yet; a
// Vitest test comparing both (planned for issue #4) would close the gap.
// Extension point: issue #2 imports the view id, issue #7 adds its own ids here.

/** Activity Bar container id (`contributes.viewsContainers.activitybar[].id`). */
export const VIEW_CONTAINER_ID = 'openVsCode';

/** Chat webview view id (`contributes.views.openVsCode[].id`). */
export const CHAT_VIEW_ID = 'openVsCode.chat';

/** Command id of "OpenCode: Show Logs" (`contributes.commands[].command`). */
export const SHOW_LOGS_COMMAND_ID = 'openVsCode.showLogs';

/** Display name of the log output channel. */
export const LOG_CHANNEL_NAME = 'OpenCode';
