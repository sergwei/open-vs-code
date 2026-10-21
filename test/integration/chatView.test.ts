// Chat view suite (issue #41).
//
// Protects against: the view container id drifting from the manifest so the view never resolves,
// and the file names that the host expects from the webview build (`dist/webview/assets/index.js`
// and `style.css`) drifting from what Vite emits (the host logs "Webview bundle file missing").
// `npm run test:integration` builds the webview first, so a missing file here is a real contract
// break. Out of scope (decision of Sergio, wave3/decisions): anything inside the webview iframe
// (DOM, CSP, themes); the test API cannot reach it. That stays with the manual F5 check.
import * as vscode from 'vscode';
import { VIEW_CONTAINER_ID } from '../../src/extension/ids';
import { openLogFromStart } from './support/extensionLog';

const EXTENSION_ID = 'sergwei.open-vs-code';

describe('chat view', () => {
  /**
   * Revealing the container resolves the view, and its bundle files exist.
   *
   * HYPOTHESIS: `workbench.view.extension.<containerId>` is the auto-generated command that
   * opens a contributed view container; if it does not exist the first run fails at
   * `executeCommand` and the alternative is `<viewId>.focus`.
   */
  it('resolves and finds its bundle', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    await extension?.activate();
    // From the start of the file: if VS Code restored the container as visible, the view resolved
    // before this test could mark the end, and a cursor marked now would miss the line.
    const log = await openLogFromStart();
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    // 8000 ms and 1000 ms are our own choices (margin for a slow CI; one second for the host to
    // log a missing file, since absence cannot be proven instantly), not VS Code values.
    await log.waitFor('Chat view resolved', 8000);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    log.assertAbsent('Webview bundle file missing');
  });

  /**
   * The webview document loads, runs its bundle and its `ready` message reaches the host through
   * the guard `isWebviewToHost` (issue #14: the controller logs `webview ready`).
   *
   * This is the only automatic proof that the bundle EXECUTES under the CSP and that the
   * webview-to-host path works end to end, without reaching into the iframe. It does not say how
   * the chat looks. 8000 ms is our own choice (margin for a slow CI), not a VS Code value.
   * VERIFIED on Windows 11 in VS Code 1.142 (20/10/2026, `npm run test:integration` main suite,
   * `sends ready from the bundled webview` passing; the real-opencode run's OpenCode.log shows
   * `Chat view resolved` then `webview ready`). macOS and Linux are UNVERIFIED until the CI of
   * the PR runs.
   */
  it('sends ready from the bundled webview', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    await extension?.activate();
    const log = await openLogFromStart();
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    await log.waitFor('webview ready', 8000);
    log.assertAbsent('rejected a message from the webview');
  });
});
