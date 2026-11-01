// The native "Sessions" view of the editor mode (issue #77, `openVsCode.chatLocation` = `editor`):
// the VS Code side of the tree whose data lives in `sessionTree.ts`. This file only maps the nodes
// the model projects onto `TreeItem`s, answers the tree's drag and drop, and tells VS Code when to
// ask again; it decides nothing about sessions or folders. The wiring (what feeds the model, what
// the rows do) is `chatLifecycle.ts`; what a drop DOES is `sessionsOrganize.ts`.
//
// It is registered always; the `when` of the two views of package.json decides which one the
// container shows. With no rows VS Code shows the `viewsWelcome` entry whose `when` matches the
// context key {@link SESSIONS_STATE_CONTEXT_KEY}, unless the view has a `message`, which hides the
// welcome (treeView.ts of VS Code 1.105, read): that is why "Loading sessions…" is a message and
// the other empty states are welcomes.

import * as vscode from 'vscode';
import { msUntilNextLocalMidnight } from './sessionTree';
import type { SessionDrag, SessionDropTarget } from './sessionOrganization';
import type {
  SessionTree,
  SessionTreeFolder,
  SessionTreeNode,
  SessionTreeSection,
  SessionTreeSession,
} from './sessionTree';
import {
  OPEN_SESSION_COMMAND_ID,
  SESSIONS_FILTERED_CONTEXT_KEY,
  SESSIONS_STATE_CONTEXT_KEY,
  SESSIONS_VIEW_ID,
  SHOW_MORE_SESSIONS_COMMAND_ID,
} from './ids';
import type { ServerLog } from './opencodeServer';

/**
 * Which `viewsWelcome` entry applies while the tree has no rows. `filteredEmpty`: a filter is on and
 * no session matches ("No sessions match the filters." with its Clear Filters button).
 */
export type SessionsState = 'offline' | 'ready' | 'noFolder' | 'filteredEmpty';

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
  /** How many changed files the tab of a session lists, for its tooltip; `undefined` if unknown. */
  changedFiles?(sessionID: string): number | undefined;
  /** Applies a drop; called by the drag-and-drop controller, never throws. */
  drop?(drag: SessionDrag, target: SessionDropTarget): void;
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
   * Selects the home row (`session:<id>`) of `sessionID` without taking the focus (decision T8=1:
   * the tree follows the active tab). Does nothing while the view is not visible, because
   * `TreeView.reveal` would otherwise open it (vscode.d.ts 1.105: "If the tree view is not visible
   * then the tree view is shown"), nor when the session has no row. Revealing a row inside a
   * collapsed folder or "Archived" expands what it needs (HYPOTHESIS: VS Code reveals through
   * `getParent`; to check, open a tab of an archived session and look at the tree).
   */
  reveal(sessionID: string | undefined): void;
  /** The session rows selected in the tree (the target of F2 and Delete). */
  selectedSessions(): SessionTreeSession[];
  /** The folder rows selected in the tree. */
  selectedFolders(): SessionTreeFolder[];
  disposable: vscode.Disposable;
}

/** Delay added to the midnight timer so it fires after the day changed, never just before. */
const MIDNIGHT_MARGIN_MS = 1000;

/**
 * MIME type of the drags of the Sessions tree. VS Code adds `application/vnd.code.tree.<id in lower
 * case>` to every drag by itself and keeps the `DataTransferItem`s of that type inside the same tree
 * (vscode.d.ts 1.105, `TreeDragAndDropController`, read); declaring it also in `dropMimeTypes`
 * lets the tree accept its own drags.
 */
export const SESSIONS_DRAG_MIME = 'application/vnd.code.tree.openvscode.sessions';

/** Whether `value` is a list of non-empty strings. */
function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string' && id.length > 0);
}

/**
 * Reads what a drag carried. The value comes through the DataTransfer, so it is not trusted:
 * anything but `{ sessions: string[], folders: string[] }` with something in it is refused.
 */
function parseDrag(value: unknown): SessionDrag | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { sessions, folders } = value as Record<string, unknown>;
  if (!isIdList(sessions) || !isIdList(folders) || sessions.length + folders.length === 0) {
    return undefined;
  }
  return { sessions: [...new Set(sessions)], folders: [...new Set(folders)] };
}

/** Indexes `nodes` and everything under them by `id`, each with its parent (top level: none). */
function indexParents(
  nodes: readonly SessionTreeNode[],
  parent: SessionTreeNode | undefined,
  into: Map<string, SessionTreeNode | undefined>,
): void {
  for (const node of nodes) {
    into.set(node.id, parent);
    if ('children' in node) indexParents(node.children, node, into);
  }
}

/** The node with `id` anywhere in `nodes`, else `undefined`. */
function findNode(nodes: readonly SessionTreeNode[], id: string): SessionTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if ('children' in node) {
      const inside = findNode(node.children, id);
      if (inside !== undefined) return inside;
    }
  }
  return undefined;
}

/**
 * Registers the Sessions tree view over the model.
 *
 * The data provider holds the last projection (`nodes`) and a map from every node id to its parent
 * (rebuilt on each repaint), so `getParent` (needed by `reveal`) finds the folder, section or
 * date group of a row at any depth. Repaints are coalesced in a microtask and re-read the
 * projection with the current time; a timer to the next LOCAL midnight (and the view becoming
 * visible again) forces one more, because nothing in the model changes when "Today" turns into
 * "Yesterday". The badge is the pending-request count (`TreeView.badge` surfaces on the container
 * icon, vscode.d.ts 1.105). The TOOLTIP is not part of the `TreeItem` built here: `resolveTreeItem`
 * asks the model when the pointer rests on a row (vscode.d.ts 1.105: resolved once per item and only
 * if `tooltip` is still undefined), so the cost line that moves at every agent step repaints
 * nothing. It is plain text appended with `appendText` and the `MarkdownString` is NOT trusted: the
 * title comes from the server, and a trusted string could run commands (risk R9 of the plan).
 * `canSelectMany` lets commands act on several rows; Rename and Delete still act on the row that
 * was clicked (risk R5, see `chatLifecycle.ts`). The drag-and-drop controller only parses the drag
 * and the target and hands them to `options.drop`; a bad payload is dropped with a debug line.
 * What a filter keeps ("Filtered: Running") is written in BOTH `view.description` and
 * `view.message`: a view that is alone in its container draws no description (`test:visual` step 34,
 * 1/11/2026: the title bar read "OpenCode: Sessions" with the filter on, at 300 and at 520 px), so
 * the message line above the rows is what the user sees; the load states take that line first, and
 * with no rows left the line stays empty, because a message hides the welcome of the empty filter
 * ("No sessions match the filters." with its Clear Filters link; step 34 V5 lost it that way).
 * Initial state: "Needs attention", "Pinned" and the date groups expanded, folders and "Archived"
 * collapsed (a folder with no children has no arrow); VS Code keeps what the user changed, by `id`.
 *
 * Logs the stable line `sessions view: N rows (more: true|false)` each time the loaded list changes,
 * which the integration suite waits for. VERIFIED in `npm run test:integration` on the final tree
 * of E3 (Windows 11, VS Code 1.144.0, 30/10/2026; fake-server configuration, 41 passing, 0 failing):
 * "✔ lists the session another turn created, one more row" (fakeServer.test.ts) waits for that
 * line with one more row, and "✔ keeps the tab when the delete is declined, and closes it when it
 * is confirmed" for the line with one row less.
 * VERIFIED by a full `npm run test:visual` (Windows 11, VS Code 1.144.0, 30/10/2026, 0 FAIL, exit 0)
 * on the final tree of E3: "ok   V4 with no sessions the view says "No sessions in this folder yet."…",
 * "ok   V5 with the server down the view says "OpenCode is not running for this folder."…", "ok
 * V3 the context menu of a session row lists Rename Session… and then Delete Session" and "ok   V1
 * dark: …" (N `codicon-bell-dot` 7.69:1 and F `codicon-error` 7.03:1, both "selected false"). The description (state words and time) is drawn only when
 * the title leaves room: with long titles it is cut or hidden and the state lives in the icon, the
 * tooltip and the aria label. The failed read message ("Could not load the sessions. See Show Logs.")
 * is UNVERIFIED on screen (a Vitest case drives the model, no visual cell). The badge reaching the
 * Activity Bar while the view is hidden stays HYPOTHESIS (C11 of step 27 had the view in front).
 * VERIFIED by `test:visual` step 34 (E9-sessions-organize; Windows 11, VS Code 1.144.0, 1/11/2026,
 * synthetic server, 0 FAIL in the run of `--steps 34,29,27`): "V1 dark at 300 px: the tree reads
 * Needs attention, Pinned, the folder, Today and Archived in that order", "V6 the tooltip of a row
 * shows its cost and tokens and the folder" (the text arrives through `resolveTreeItem`), "B3
 * dragging the row of Org34C onto the folder Spikes34 moves the session into it" and "B12 dragging
 * the folder Docs34 onto Spikes34 makes it a subfolder of it" (a real mouse drag through CDP), "B9
 * after Reload Window the folder with its subfolder, the pinned session and the archived one are
 * still there" and "V5 a filter with no result shows "No sessions match the filters."". NOT observed:
 * `reveal` of a session inside a folded folder (HYPOTHESIS that it opens the parents), a drag of
 * several selected rows, macOS and Linux.
 */
export function registerSessionsView(options: SessionsViewOptions): SessionsView {
  const { tree, log } = options;
  const changed = new vscode.EventEmitter<void>();
  let nodes: SessionTreeNode[] = [];
  const parents = new Map<string, SessionTreeNode | undefined>();
  let scheduled = false;
  let lastState: SessionsState | undefined;
  let lastFiltered: boolean | undefined;
  let lastLogged = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const provider: vscode.TreeDataProvider<SessionTreeNode> = {
    onDidChangeTreeData: changed.event,
    getTreeItem: (node) => toTreeItem(node),
    getChildren: (element) => {
      if (element === undefined) return nodes;
      return 'children' in element ? element.children : [];
    },
    getParent: (element) => parents.get(element.id),
    resolveTreeItem: (item, element) => {
      if (element.kind !== 'session') return item;
      const text = tree.tooltipOf(
        element.sessionID,
        options.locale,
        options.changedFiles?.(element.sessionID),
      );
      if (text !== undefined) item.tooltip = new vscode.MarkdownString().appendText(text);
      return item;
    },
  };

  /**
   * What the drop landed on, reduced to a {@link SessionDropTarget}, or `undefined` for a place
   * that takes nothing ("Needs attention"). A session stands for the place it sits in.
   */
  const targetOf = (node: SessionTreeNode | undefined): SessionDropTarget | undefined => {
    if (node === undefined) return { kind: 'none' };
    switch (node.kind) {
      case 'folder':
        return { kind: 'folder', folderID: node.folderID };
      case 'section':
        return sectionTarget(node);
      case 'session': {
        const parent = parents.get(node.id);
        return parent === undefined ? { kind: 'none' } : targetOf(parent);
      }
      case 'group':
      case 'more':
        return { kind: 'none' };
    }
  };

  const dragAndDropController: vscode.TreeDragAndDropController<SessionTreeNode> = {
    dragMimeTypes: [SESSIONS_DRAG_MIME],
    dropMimeTypes: [SESSIONS_DRAG_MIME],
    handleDrag: (source, dataTransfer) => {
      const drag: SessionDrag = {
        sessions: [
          ...new Set(source.flatMap((node) => (node.kind === 'session' ? [node.sessionID] : []))),
        ],
        folders: source.flatMap((node) => (node.kind === 'folder' ? [node.folderID] : [])),
      };
      if (drag.sessions.length + drag.folders.length === 0) return;
      dataTransfer.set(SESSIONS_DRAG_MIME, new vscode.DataTransferItem(drag));
    },
    handleDrop: (target, dataTransfer) => {
      const drag = parseDrag(dataTransfer.get(SESSIONS_DRAG_MIME)?.value);
      if (drag === undefined) {
        log.debug('sessions drop ignored: no usable drag');
        return;
      }
      const where = targetOf(target);
      if (where === undefined) {
        log.debug('sessions drop ignored: that place takes nothing');
        return;
      }
      options.drop?.(drag, where);
    },
  };

  const view = vscode.window.createTreeView(SESSIONS_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController,
  });

  /** Re-reads the model and writes message, description, context keys and the log line. */
  const flush = (): void => {
    scheduled = false;
    if (disposed) return;
    nodes = tree.project(Date.now(), options.locale);
    parents.clear();
    indexParents(nodes, undefined, parents);
    const load = tree.load();
    const filterText = tree.filterDescription();
    view.message =
      load === 'loading'
        ? 'Loading sessions…'
        : load === 'failed'
          ? 'Could not load the sessions. See Show Logs.'
          : nodes.length > 0
            ? filterText
            : undefined; // with no rows the "No sessions match" welcome shows, and a message would hide it
    view.description =
      [options.folderName(), filterText].filter((part) => part !== undefined).join(' · ') ||
      undefined;
    const state = options.state();
    if (state !== lastState) {
      lastState = state;
      void vscode.commands.executeCommand('setContext', SESSIONS_STATE_CONTEXT_KEY, state);
    }
    const filtered = filterText !== undefined;
    if (filtered !== lastFiltered) {
      lastFiltered = filtered;
      void vscode.commands.executeCommand('setContext', SESSIONS_FILTERED_CONTEXT_KEY, filtered);
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
      const node = findNode(nodes, `session:${sessionID}`);
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
    selectedFolders: () =>
      view.selection.filter((node): node is SessionTreeFolder => node.kind === 'folder'),
    disposable: vscode.Disposable.from(view, changed, visibility, {
      dispose: () => {
        disposed = true;
        if (timer !== undefined) clearTimeout(timer);
      },
    }),
  };
}

/** What a drop on a section means: pin, archive, or nothing ("Needs attention" takes no drops). */
function sectionTarget(node: SessionTreeSection): SessionDropTarget | undefined {
  switch (node.section) {
    case 'pinned':
      return { kind: 'pinned' };
    case 'archived':
      return { kind: 'archived' };
    case 'attention':
      return undefined;
  }
}

/** The codicon of each section. */
const SECTION_ICON: Record<SessionTreeSection['section'], string> = {
  attention: 'bell',
  pinned: 'pinned',
  archived: 'archive',
};

/** Maps a node of the projection to the `TreeItem` VS Code draws (no tooltip: see `resolveTreeItem`). */
function toTreeItem(node: SessionTreeNode): vscode.TreeItem {
  switch (node.kind) {
    case 'section': {
      const item = new vscode.TreeItem(
        node.label,
        node.section === 'archived'
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = node.id;
      item.description = node.description;
      item.iconPath = new vscode.ThemeIcon(SECTION_ICON[node.section]);
      item.contextValue = `section;${node.section}`;
      return item;
    }
    case 'folder': {
      const item = new vscode.TreeItem(
        node.label,
        node.children.length === 0
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.id = node.id;
      item.description = node.description;
      item.iconPath = new vscode.ThemeIcon('folder');
      item.contextValue = node.contextValue;
      return item;
    }
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
