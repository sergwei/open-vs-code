import * as vscode from 'vscode';
import { CHAT_VIEW_ID } from './ids';
import { buildWebviewHtml, createNonce } from './webviewHtml';

// Contract with webview-ui/vite.config.mts: the output directory and the fixed
// file names below must match `build.outDir`, `entryFileNames` and the CSS name.
const WEBVIEW_DIST_SEGMENTS = ['dist', 'webview'];
const SCRIPT_SEGMENTS = ['assets', 'index.js'];
const STYLE_SEGMENTS = ['assets', 'style.css'];

/**
 * Provides the chat webview view (`openVsCode.chat`).
 *
 * Skeleton for issue #2: it only loads the bundled SolidJS app. It registers no
 * message listener and keeps no state; the `ready` handshake and the message
 * queue come with the first issue that sends data. Each `resolveWebviewView`
 * gets a fresh nonce, because VS Code calls it again whenever the view is shown
 * after being hidden (HYPOTHESIS: from the `WebviewViewProvider` docs in vscode.d.ts,
 * not observed; check the log for one "Chat view resolved" per resolution in F5).
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly channel: vscode.LogOutputChannel,
  ) {}

  /**
   * Configures the webview and sets its HTML.
   *
   * `localResourceRoots` is limited to `dist/webview` (the default would expose the
   * workspace; HYPOTHESIS, read in vscode.d.ts) and `options` is set before `html`,
   * as the API requires. Also kicks
   * off a non-blocking check that the bundle exists and warns in the log channel
   * if not, so a missing build does not look like a silent blank view.
   * HYPOTHESIS: everything here is untested until F5; expected result is the
   * placeholder rendered and "Chat view resolved" in the OpenCode log.
   */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webview = webviewView.webview;
    const distWebview = vscode.Uri.joinPath(this.extensionUri, ...WEBVIEW_DIST_SEGMENTS);
    const scriptUri = vscode.Uri.joinPath(distWebview, ...SCRIPT_SEGMENTS);
    const styleUri = vscode.Uri.joinPath(distWebview, ...STYLE_SEGMENTS);

    webview.options = { enableScripts: true, localResourceRoots: [distWebview] };
    webview.html = buildWebviewHtml({
      cspSource: webview.cspSource,
      scriptUri: webview.asWebviewUri(scriptUri).toString(),
      styleUri: webview.asWebviewUri(styleUri).toString(),
      nonce: createNonce(),
    });
    this.channel.info('Chat view resolved');
    void this.warnIfBundleMissing([scriptUri, styleUri]);
  }

  /**
   * Logs a warning for each bundle file that cannot be stat'ed.
   *
   * Never throws: a failed `stat` is the expected signal here. Covers the day Vite
   * renames `style.css` or packaging leaves `dist/webview` out of the .vsix.
   */
  private async warnIfBundleMissing(uris: vscode.Uri[]): Promise<void> {
    for (const uri of uris) {
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        this.channel.warn(
          `Webview bundle file missing: ${uri.fsPath}. Run "npm run build:webview".`,
        );
      }
    }
  }
}

/**
 * Registers the chat view provider and returns its disposable.
 *
 * One call from `activate`. VERIFIED that the view id matches the `contributes.views` entry and
 * the view resolves with its bundle: F5 on Windows (2026-10-20) and the integration tests of
 * issue #41 in a real VS Code 1.142 on Windows, macOS and Linux (CI run 39414371746).
 */
export function registerChatView(
  extensionUri: vscode.Uri,
  channel: vscode.LogOutputChannel,
): vscode.Disposable {
  return vscode.window.registerWebviewViewProvider(
    CHAT_VIEW_ID,
    new ChatViewProvider(extensionUri, channel),
  );
}
