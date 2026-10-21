/**
 * The webview's single handle to the extension host.
 *
 * `acquireVsCodeApi()` may be called only once per webview session, so this module
 * is the only place that calls it and nothing else should touch the global.
 * Deliberately just the handle: the typed `post`/`listenHost` bridge and the `ready`
 * handshake live in `host.ts` (issue #14), on top of this export.
 * HYPOTHESIS (read in the VS Code webview guide and @types/vscode-webview@1.57.5,
 * not executed): the once-per-session rule and the global declaration. UNVERIFIED in the
 * Extension Development Host: check the webview console for an
 * "already acquired" error on reload.
 */
export const vscodeApi = acquireVsCodeApi();
