// The native "Sessions" view of the editor mode (issue #77, `openVsCode.chatLocation` = `editor`):
// the VS Code side of the tree whose data lives in `sessionTree.ts`. This file only maps the nodes
// the model projects onto `TreeItem`s and tells VS Code when to ask again; it decides nothing about
// sessions. The wiring (what feeds the model, what the rows do) is `chatLifecycle.ts`.
//
// It is registered always; the `when` of the two views of package.json decides which one the
// container shows. With no rows VS Code shows the `viewsWelcome` entry whose `when` matches the
// context key {@link SESSIONS_STATE_CONTEXT_KEY}, unless the view has a `message`, which hides the
// welcome (treeView.ts of VS Code 1.105, read): that is why "Loading sessions…" is a message and
// the other empty states are welcomes.

import * as vscode from 'vscode';
import { msUntilNextLocalMidnight } from './sessionTree';
import type {
  SessionTree,
  SessionTreeGroup,
  SessionTreeNode,
  SessionTreeSession,
} from './sessionTree';
import {
  OPEN_SESSION_COMMAND_ID,
  SESSIONS_STATE_CONTEXT_KEY,
  SESSIONS_VIEW_ID,
  SHOW_MORE_SESSIONS_COMMAND_ID,
} from './ids';
import type { ServerLog } from './opencodeServer';

/** Which `viewsWelcome` entry applies while the tree has no rows. */
export type SessionsState = 'offline' | 'ready' | 'noFolder';

/** What {@link registerSessionsView} needs from the wiring. */
export interface SessionsViewOptions {
  tree: SessionTree;
  log: ServerLog;
  /** `vscode.env.language`, for the dates; `undefined` uses the `Intl` default. */
  locale?: string;
  /** Which welcome entry to show when the tree is empty; read on every refresh. */
  state(): SessionsState;
  /** The name of the served folder when the window has more than one folder, else `undefined`. */
  folderName(): string | undefined;
}

/** The view and the few things the host changes on it. */
export interface SessionsView {
  /** Shows `count` pending requests on the badge of the view (0 clears it). */
  setBadge(count: number): void;
  /**
   * The model changed (or the clock moved a day): re-reads it and repaints. Calls made in the same
   * task are coalesced into ONE repaint (decision T3=1), so a burst of events paints once.
   */
  refresh(): void;
  /**
   * Selects the row of `sessionID` without taking the focus (decision T8=1: the tree follows the
   * active tab). Does nothing while the view is not visible, because `TreeView.reveal` would
   * otherwise open it (vscode.d.ts 1.105: "If the tree view is not visible then the tree view is
   * shown"), nor when the session has no row.
   */
  reveal(sessionID: string | undefined): void;
  /** The session rows selected in the tree (the target of F2 and Delete). */
  selectedSessions(): SessionTreeSession[];
  disposable: vscode.Disposable;
}

/** Delay added to the midnight timer so it fires after the day changed, never just before. */
const MIDNIGHT_MARGIN_MS = 1000;

/**
 * Registers the Sessions tree view over the model.
 *
 * The data provider holds the last projection (`nodes`) and answers from it, so `getParent` (needed
 * by `reveal`) can find the group of a row. Repaints are coalesced in a microtask and re-read the
 * projection with the current time; a timer to the next LOCAL midnight (and the view becoming
 * visible again) forces one more, because nothing in the model changes when "Today" turns into
 * "Yesterday". The badge is the pending-request count (`TreeView.badge` surfaces on the container
 * icon, vscode.d.ts 1.105). The tooltip is plain text appended with `appendText` and the
 * `MarkdownString` is NOT trusted: the title comes from the server, and a trusted string could run
 * commands (risk R9 of the plan).
 *
 * Logs the stable line `sessions view: N rows (more: true|false)` each time the loaded list changes,
 * which the integration suite waits for. VERIFIED in `npm run test:integration` on the final tree
 * (Windows 11, VS Code 1.144.0, 30/10/2026; fake-server configuration, 41 passing, 0 failing):
 * "✔ lists the session another turn created, one more row" (fakeServer.test.ts) waits for that
 * line with one more row, and "✔ keeps the tab when the delete is declined, and closes it when it
 * is confirmed" for the line with one row less.
 * VERIFIED by a full `npm run test:visual` (Windows 11, VS Code 1.144.0, 30/10/2026, 0 FAIL, exit 0)
 * on the final tree: "ok   V4 with no sessions the view says "No sessions in this folder yet."…",
 * "ok   V5 with the server down the view says "OpenCode is not running for this folder."…", "ok
 * V3 the context menu of a session row lists Rename Session… and then Delete Session" and "ok   V1
 * dark: …" (N `codicon-bell-dot` 7.69:1 and F `codicon-error` 7.03:1, both "selected false"). The description (state words and time) is drawn only when
 * the title leaves room: with long titles it is cut or hidden and the state lives in the icon, the
 * tooltip and the aria label. The failed read message ("Could not load the sessions. See Show Logs.")
 * is UNVERIFIED on screen (a Vitest case drives the model, no visual cell). The badge reaching the
 * Activity Bar while the view is hidden stays HYPOTHESIS (C11 of step 27 had the view in front).
 */
export function registerSessionsView(options: SessionsViewOptions): SessionsView {
  const { tree, log } = options;
  const changed = new vscode.EventEmitter<void>();
  let nodes: SessionTreeNode[] = [];
  let scheduled = false;
  let lastState: SessionsState | undefined;
  let lastLogged = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const provider: vscode.TreeDataProvider<SessionTreeNode> = {
    onDidChangeTreeData: changed.event,
    getTreeItem: (node) => toTreeItem(node),
    getChildren: (element) => {
      if (element === undefined) return nodes;
      return element.kind === 'group' ? element.children : [];
    },
    getParent: (element) => {
      if (element.kind !== 'session') return undefined;
      return nodes.find(
        (node): node is SessionTreeGroup => node.kind === 'group' && node.label === element.group,
      );
    },
  };
  const view = vscode.window.createTreeView(SESSIONS_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  /** Re-reads the model and writes message, description, context key and the log line. */
  const flush = (): void => {
    scheduled = false;
    if (disposed) return;
    nodes = tree.project(Date.now(), options.locale);
    const load = tree.load();
    view.message =
      load === 'loading'
        ? 'Loading sessions…'
        : load === 'failed'
          ? 'Could not load the sessions. See Show Logs.'
          : undefined;
    view.description = options.folderName();
    const state = options.state();
    if (state !== lastState) {
      lastState = state;
      void vscode.commands.executeCommand('setContext', SESSIONS_STATE_CONTEXT_KEY, state);
    }
    if (load === 'ready') {
      const { rows, more } = tree.summary();
      const line = `sessions view: ${String(rows)} rows (more: ${String(more)})`;
      if (line !== lastLogged) {
        lastLogged = line;
        log.info(line);
      }
    } else {
      lastLogged = '';
    }
    changed.fire();
  };

  const refresh = (): void => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(flush);
  };

  /** Arms the timer for the next local midnight; each firing repaints and arms the next. */
  const armMidnight = (): void => {
    timer = setTimeout(
      () => {
        refresh();
        armMidnight();
      },
      msUntilNextLocalMidnight(Date.now()) + MIDNIGHT_MARGIN_MS,
    );
  };
  armMidnight();

  const visibility = view.onDidChangeVisibility((event) => {
    if (event.visible) refresh();
  });
  refresh();

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
    refresh,
    reveal(sessionID) {
      if (sessionID === undefined || !view.visible) return;
      const node = nodes
        .flatMap((candidate) => (candidate.kind === 'group' ? candidate.children : []))
        .find((row) => row.sessionID === sessionID);
      if (node === undefined) return;
      void Promise.resolve(view.reveal(node, { select: true, focus: false })).then(
        undefined,
        (error: unknown) => {
          log.debug(`revealing a session row failed: ${String(error)}`);
        },
      );
    },
    selectedSessions: () =>
      view.selection.filter((node): node is SessionTreeSession => node.kind === 'session'),
    disposable: vscode.Disposable.from(view, changed, visibility, {
      dispose: () => {
        disposed = true;
        if (timer !== undefined) clearTimeout(timer);
      },
    }),
  };
}

/** Maps a node of the projection to the `TreeItem` VS Code draws. */
function toTreeItem(node: SessionTreeNode): vscode.TreeItem {
  switch (node.kind) {
    case 'group': {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = node.id;
      item.contextValue = 'group';
      return item;
    }
    case 'more': {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.id = node.id;
      item.iconPath = new vscode.ThemeIcon('ellipsis');
      item.contextValue = 'more';
      item.command = { command: SHOW_MORE_SESSIONS_COMMAND_ID, title: node.label };
      return item;
    }
    case 'session': {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.id = node.id;
      item.description = node.description;
      item.iconPath = new vscode.ThemeIcon(
        node.icon.id,
        node.icon.color === undefined ? undefined : new vscode.ThemeColor(node.icon.color),
      );
      item.contextValue = node.contextValue;
      item.tooltip = new vscode.MarkdownString().appendText(node.tooltip);
      item.accessibilityInformation = { label: node.accessibilityLabel };
      item.command = {
        command: OPEN_SESSION_COMMAND_ID,
        title: 'Open',
        arguments: [node.sessionID],
      };
      return item;
    }
  }
}
