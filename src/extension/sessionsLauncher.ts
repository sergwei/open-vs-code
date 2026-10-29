// The OpenCode view while the chat lives in editor tabs (issue #77, `openVsCode.chatLocation` =
// `editor`): a tree view with NO items, so VS Code shows its `viewsWelcome` (the text and the New
// Session / Open Chat buttons of package.json) and the title buttons. It is registered always;
// the `when` of the two views decides which one the container shows.

import * as vscode from 'vscode';
import { SESSIONS_VIEW_ID } from './ids';

/** The launcher and the one thing the host changes on it. */
export interface SessionsLauncher {
  /** Shows `count` pending requests on the badge of the view (0 clears it). */
  setBadge(count: number): void;
  disposable: vscode.Disposable;
}

/**
 * Registers the empty tree view behind the launcher.
 *
 * The empty provider is what makes the welcome appear: a tree view with no children shows its
 * `viewsWelcome`. `TreeView.badge` surfaces on the icon of the container in the Activity Bar
 * (vscode.d.ts 1.105, read), which is where the pending-request count goes in `editor` mode.
 * VERIFIED in `npm run test:visual` step 27 (Windows 11, VS Code 1.144.0, 29/10/2026): "ok C1 the
 * launcher shows its welcome text, its New Session and Open Chat buttons and the New Session and
 * Open Settings title buttons, no chat" and "ok C11 with every chat tab hidden a request raises a
 * native notification (…) and a badge on the OpenCode icon ("1")". HYPOTHESIS: that the badge
 * reaches the Activity Bar icon while the view is not the one in front; in C11 the launcher WAS in
 * front, so that case was not observed.
 */
export function registerSessionsLauncher(): SessionsLauncher {
  const provider: vscode.TreeDataProvider<string> = {
    getTreeItem: (element) => new vscode.TreeItem(element),
    getChildren: () => [],
  };
  const view = vscode.window.createTreeView(SESSIONS_VIEW_ID, { treeDataProvider: provider });
  return {
    setBadge(count) {
      view.badge =
        count > 0
          ? {
              value: count,
              tooltip: `${String(count)} OpenCode request${count === 1 ? '' : 's'} waiting`,
            }
          : undefined;
    },
    disposable: view,
  };
}
