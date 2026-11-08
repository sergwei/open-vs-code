// The VS Code side of the "Changes of the sessions" view (E9-sidebar-home, issue #187, phase 2): a
// native tree whose data is `sessionChanges.ts`. This file only maps the model onto `TreeItem`s and
// tells VS Code when to ask again; what may be opened, and what the original text is, was decided by
// `sessionDiff.ts` when it listed the file. Opening a row runs `OPEN_CHANGED_FILE_COMMAND_ID`
// (registered by `sidebarHome.ts`), which re-checks the whitelist.

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { ChangedFile } from '../shared/model';
import { CHANGES_VIEW_ID, OPEN_CHANGED_FILE_COMMAND_ID } from './ids';
import { describeChanges, type SessionChanges } from './sessionChanges';

/** A node of the tree: a session (collapsed, its files below it), one of its files, or a one-line note. */
export type ChangesNode =
  | {
      kind: 'session';
      id: string;
      sessionID: string;
      title: string;
      files: readonly ChangedFile[] | undefined;
    }
  | { kind: 'file'; id: string; sessionID: string; file: ChangedFile }
  | { kind: 'note'; id: string; text: string };

/** The state words of a file row, in the language of the host: counts, or why there are none. */
function fileDescription(file: ChangedFile): string {
  if (file.binary) return l10n.t('binary');
  if (file.tooLarge) return l10n.t('too large to diff');
  return `+${String(file.additions)} −${String(file.deletions)}`;
}

/** The icon of a file by what the session did to it; no colour, so every theme keeps its contrast. */
function fileIcon(status: ChangedFile['status']): vscode.ThemeIcon {
  switch (status) {
    case 'added':
      return new vscode.ThemeIcon('diff-added');
    case 'deleted':
      return new vscode.ThemeIcon('diff-removed');
    case 'modified':
      return new vscode.ThemeIcon('diff-modified');
  }
}

/** What {@link registerChangesView} gives back. */
export interface ChangesView {
  /** The data provider, so the Test-mode command can read the tree the way VS Code does. */
  provider: vscode.TreeDataProvider<ChangesNode>;
  /** Whether the view is on screen (expanded and in a visible container). */
  visible(): boolean;
  disposable: vscode.Disposable;
}

/**
 * Registers the Changes tree over the model.
 *
 * Expanding a session row calls `getChildren`, which waits for the first read of its files
 * (`ensureLoaded`); once loaded the call is a plain lookup, so a repaint that VS Code answers by
 * asking again for the children of an expanded row cannot start another read. The model's changes
 * repaint the whole tree through ONE microtask-coalesced event: rows have stable ids
 * (`changes:session:<id>`, `changes:file:<id>:<path>`), so VS Code keeps what is expanded. A session
 * that failed to load shows the FIXED note "Could not refresh the list" under it (the error text
 * itself is not shown: it is not translated and the model only keeps it as `error`), with whatever
 * files were last read above. A session expanded while there is no server (`ensureLoaded` returns
 * without reading) shows "Server not available" instead of "No changed files", which would be
 * false. With no session at all `view.message` says so (a welcome would need its own context
 * key). The row texts go through `l10n.t`; titles and paths come from the server and are plain text.
 * The tooltip is plain text, never Markdown: a title is server text. A session row carries an
 * `accessibilityInformation` label with its title and the description (S1 of the review).
 * VERIFIED by `--steps 29,34,49,50` (Windows 11, VS Code 1.145.2, 08/11/2026, after the
 * `accessibilityInformation` and no-server changes): "ok   C1 expanding the
 * session reads its four files, the row says "4 files · +a −d" and src/sample.ts says "+1 −1"" and
 * "ok   C2 at 300 px (Dark Modern) the descriptions of the session and of src/sample.ts are drawn
 * whole inside the side bar, with the diff-modified icon". Not observed: the failure note and the
 * no-server note in a real window, and what a screen reader reads from `accessibilityInformation`.
 */
export function registerChangesView(model: SessionChanges): ChangesView {
  const changed = new vscode.EventEmitter<undefined>();
  let scheduled = false;
  let disposed = false;

  const provider: vscode.TreeDataProvider<ChangesNode> = {
    onDidChangeTreeData: changed.event,
    getTreeItem: (node) => toTreeItem(node),
    getChildren: async (element) => {
      if (element === undefined) {
        return model.sessions().map((session): ChangesNode => ({
          kind: 'session',
          id: `changes:session:${session.sessionID}`,
          sessionID: session.sessionID,
          title: session.title,
          files: session.files,
        }));
      }
      if (element.kind !== 'session') return [];
      await model.ensureLoaded(element.sessionID);
      const session = model
        .sessions()
        .find((candidate) => candidate.sessionID === element.sessionID);
      if (session === undefined) return [];
      const files = session.files ?? [];
      const nodes: ChangesNode[] = files.map((file) => ({
        kind: 'file',
        id: `changes:file:${element.sessionID}:${file.path}`,
        sessionID: element.sessionID,
        file,
      }));
      if (session.error !== undefined) {
        nodes.push({
          kind: 'note',
          id: `changes:error:${element.sessionID}`,
          text: l10n.t('Could not refresh the list'),
        });
      } else if (session.files === undefined) {
        // `ensureLoaded` returned without reading: there is no server, so "no changed files" would be false.
        nodes.push({
          kind: 'note',
          id: `changes:offline:${element.sessionID}`,
          text: l10n.t('Server not available'),
        });
      } else if (files.length === 0) {
        nodes.push({
          kind: 'note',
          id: `changes:empty:${element.sessionID}`,
          text: l10n.t('No changed files'),
        });
      }
      return nodes;
    },
  };

  const view = vscode.window.createTreeView(CHANGES_VIEW_ID, { treeDataProvider: provider });

  /** Writes the empty-state message and repaints; one per task however many changes arrived. */
  const flush = (): void => {
    scheduled = false;
    if (disposed) return;
    view.message =
      model.sessions().length === 0 ? l10n.t('No sessions with changed files yet.') : undefined;
    changed.fire(undefined);
  };
  const refresh = (): void => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(flush);
  };
  const unsubscribe = model.onChange(refresh);
  refresh();

  return {
    provider,
    visible: () => view.visible,
    disposable: vscode.Disposable.from(view, changed, {
      dispose: () => {
        disposed = true;
        unsubscribe();
      },
    }),
  };
}

/** Maps a node to the `TreeItem` VS Code draws. */
function toTreeItem(node: ChangesNode): vscode.TreeItem {
  switch (node.kind) {
    case 'session': {
      const item = new vscode.TreeItem(
        node.title === '' ? l10n.t('Untitled session') : node.title,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.id = node.id;
      item.description = node.files === undefined ? undefined : describeChanges(node.files);
      item.iconPath = new vscode.ThemeIcon('comment-discussion');
      item.contextValue = 'changesSession';
      const name = node.title === '' ? l10n.t('Untitled session') : node.title;
      item.tooltip = new vscode.MarkdownString().appendText(name);
      item.accessibilityInformation = {
        label: item.description === undefined ? name : l10n.t('{0}, {1}', name, item.description),
      };
      return item;
    }
    case 'file': {
      const item = new vscode.TreeItem(node.file.path, vscode.TreeItemCollapsibleState.None);
      item.id = node.id;
      item.description = fileDescription(node.file);
      item.iconPath = fileIcon(node.file.status);
      item.contextValue = 'changesFile';
      item.accessibilityInformation = {
        label: l10n.t('{0}, {1}', node.file.path, statusWord(node.file.status)),
      };
      item.command = {
        command: OPEN_CHANGED_FILE_COMMAND_ID,
        title: l10n.t('Open diff'),
        arguments: [node.sessionID, node.file.path],
      };
      return item;
    }
    case 'note': {
      const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
      item.id = node.id;
      item.contextValue = 'changesNote';
      return item;
    }
  }
}

/** The status of a file in words, for the accessible name (an icon alone says nothing to a reader). */
function statusWord(status: ChangedFile['status']): string {
  switch (status) {
    case 'added':
      return l10n.t('added');
    case 'deleted':
      return l10n.t('deleted');
    case 'modified':
      return l10n.t('modified');
  }
}
