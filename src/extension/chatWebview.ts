// What every chat surface shares, whether it is the side-bar view or an editor tab (issue #77):
// the webview options, the HTML with its nonce and the validation of what the webview sends.
// `chatViewProvider.ts` and `chatPanels.ts` use it so the two cannot drift apart on the CSP, the
// resource roots or the guard.

import * as vscode from 'vscode';
import { isWebviewToHost, type WebviewToHost } from '../shared/protocol';
import { buildWebviewHtml, createNonce, type ChatSurface } from './webviewHtml';

// Contract with webview-ui/vite.config.mts: the output directory and the fixed
// file names below must match `build.outDir`, `entryFileNames` and the CSS name.
const WEBVIEW_DIST_SEGMENTS = ['dist', 'webview'];
const SCRIPT_SEGMENTS = ['assets', 'index.js'];
const STYLE_SEGMENTS = ['assets', 'style.css'];

/**
 * The options every chat webview needs: scripts on and `localResourceRoots` limited to
 * `dist/webview` (the default would expose the workspace; HYPOTHESIS, read in vscode.d.ts).
 * A panel adds `retainContextWhenHidden` on top; a view cannot have it.
 */
export function chatWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, ...WEBVIEW_DIST_SEGMENTS)],
  };
}

/**
 * Sets the options and the HTML of a chat webview (options first, as the API requires) with a
 * fresh nonce, and starts a non-blocking check that the bundle exists, which warns in the log if
 * not so a missing build does not look like a silent blank surface.
 * VERIFIED in a real VS Code 1.144.0 on Windows 11 (29/10/2026, `npm run test:integration`): for
 * the view the checks "resolves and finds its bundle" and "sends ready from the bundled webview",
 * and for a tab "opens one tab per New Session, each with a ready document" (two `webview ready`
 * lines, no "Webview bundle file missing" nor "rejected a message from the webview"). Not
 * observed: a missing bundle, macOS and Linux.
 * `surface` ends up in a `<meta name="open-vs-code-surface">`: `tab` makes the webview hide its
 * session picker, because the Sessions tree view is the one place to browse sessions (issue #77).
 */
export function renderChatWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  channel: vscode.LogOutputChannel,
  surface: ChatSurface,
): void {
  const distWebview = vscode.Uri.joinPath(extensionUri, ...WEBVIEW_DIST_SEGMENTS);
  const scriptUri = vscode.Uri.joinPath(distWebview, ...SCRIPT_SEGMENTS);
  const styleUri = vscode.Uri.joinPath(distWebview, ...STYLE_SEGMENTS);
  webview.options = chatWebviewOptions(extensionUri);
  webview.html = buildWebviewHtml({
    cspSource: webview.cspSource,
    scriptUri: webview.asWebviewUri(scriptUri).toString(),
    styleUri: webview.asWebviewUri(styleUri).toString(),
    nonce: createNonce(),
    surface,
  });
  void warnIfBundleMissing(channel, [scriptUri, styleUri]);
}

/**
 * Validates one raw message from a chat webview. Returns the typed message, or `undefined` after
 * logging a warning that names its `type` (if it is a string, cut to 64 characters) and nothing
 * else, because the content is untrusted.
 */
export function parseWebviewMessage(
  raw: unknown,
  channel: vscode.LogOutputChannel,
): WebviewToHost | undefined {
  if (isWebviewToHost(raw)) return raw;
  const type =
    typeof raw === 'object' && raw !== null && typeof (raw as { type?: unknown }).type === 'string'
      ? (raw as { type: string }).type.slice(0, 64) // untrusted text: bounded length
      : 'unknown';
  channel.warn(`rejected a message from the webview (type: ${type})`);
  return undefined;
}

/**
 * Logs a warning for each bundle file that cannot be stat'ed.
 *
 * Never throws: a failed `stat` is the expected signal here. Covers the day Vite
 * renames `style.css` or packaging leaves `dist/webview` out of the .vsix.
 */
async function warnIfBundleMissing(
  channel: vscode.LogOutputChannel,
  uris: vscode.Uri[],
): Promise<void> {
  for (const uri of uris) {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      channel.warn(`Webview bundle file missing: ${uri.fsPath}. Run "npm run build:webview".`);
    }
  }
}
