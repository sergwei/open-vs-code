// The VS Code side of the "Usage (all projects)" view (E9-sidebar-home, issue #187, phase 3): a
// native tree over `usageStats.ts`. A tree and not a webview (decision of the plan): accessible for
// free, no extra document, at the price of no charts. It tells the model when the view is visible
// (`onDidChangeVisibility`) and repaints on its changes; it reads nothing from the server itself.

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { USAGE_VIEW_ID } from './ids';
import {
  modelDescription,
  periodDescription,
  periodLabel,
  usageTooltip,
  type Usage,
  type UsageModelRow,
  type UsagePeriod,
} from './usageStats';

/** A node of the tree: a period (its models below it), one model of it, or a one-line note. */
export type UsageNode =
  | { kind: 'period'; id: string; period: UsagePeriod }
  | { kind: 'model'; id: string; period: UsagePeriod; row: UsageModelRow }
  | { kind: 'note'; id: string; text: string; retry: boolean };

/** What {@link registerUsageView} gives back. */
export interface UsageView {
  /** The data provider, so the Test-mode command can read the tree the way VS Code does. */
  provider: vscode.TreeDataProvider<UsageNode>;
  disposable: vscode.Disposable;
}

/** What it needs: the model, the locale of the dates and numbers, and the command of the retry note. */
export interface UsageViewOptions {
  usage: Usage;
  /** `vscode.env.language`, for the money and the counts; `undefined` uses the `Intl` default. */
  locale?: string;
  /** Command the "Retry" note runs. */
  retryCommand: string;
}

/**
 * Registers the Usage tree.
 *
 * The view says in its own `description` that it covers ALL projects ("All projects"), and every
 * tooltip repeats it (decision P3=2 of Sergio, 07/11/2026): the numbers are the whole opencode
 * database, not this folder, and a user who reads "Today $0.42" must not take it for this
 * project's. Today starts expanded (its models are the point) and the week collapsed; VS Code keeps
 * what the user changed, by `id`. While the first read runs `view.message` says so; after a failed
 * read a note row with the FIXED text "Could not read the usage. Retry" (the error itself is not
 * shown) and a Retry command stays below the last good data. Period and model rows carry an
 * `accessibilityInformation` label with their name and description (S1 of the review).
 * `setVisible` is fed from `onDidChangeVisibility` and once at registration with the current value,
 * so a view that is already on screen when the extension activates reads at once.
 * Tooltips are plain text (no Markdown), moneys in US dollars like the Sessions tree.
 * VERIFIED by `--steps 29,34,49,50` (Windows 11, VS Code 1.145.2, 08/11/2026, after the
 * `accessibilityInformation` change): "ok   U3 at 300 px (Dark
 * Modern) the description of Today is drawn whole and the model row shows its description inside
 * the side bar" and "ok   U4 with the Usage pane collapsed a finished turn made no stats request
 * (0 new)". Not observed: the failure note in a real window, and what a screen reader reads.
 */
export function registerUsageView(options: UsageViewOptions): UsageView {
  const { usage, locale } = options;
  const changed = new vscode.EventEmitter<undefined>();
  let scheduled = false;
  let disposed = false;

  const provider: vscode.TreeDataProvider<UsageNode> = {
    onDidChangeTreeData: changed.event,
    getTreeItem: (node) => toTreeItem(node, locale, options.retryCommand),
    getChildren: (element) => {
      const snapshot = usage.snapshot();
      if (element === undefined) {
        const nodes: UsageNode[] = snapshot.periods.map((period) => ({
          kind: 'period',
          id: `usage:${period.key}`,
          period,
        }));
        if (snapshot.state === 'failed') {
          nodes.push({
            kind: 'note',
            id: 'usage:error',
            text: l10n.t('Could not read the usage. Retry'),
            retry: true,
          });
        }
        return nodes;
      }
      if (element.kind !== 'period') return [];
      return element.period.models.map((row): UsageNode => ({
        kind: 'model',
        id: `usage:${element.period.key}:${row.ref.providerID}/${row.ref.id}/${row.ref.variant ?? ''}`,
        period: element.period,
        row,
      }));
    },
  };

  const view = vscode.window.createTreeView(USAGE_VIEW_ID, { treeDataProvider: provider });
  view.description = l10n.t('All projects');

  /** Writes the loading message and repaints; one per task however many changes arrived. */
  const flush = (): void => {
    scheduled = false;
    if (disposed) return;
    const snapshot = usage.snapshot();
    view.message =
      snapshot.periods.length === 0 && snapshot.state === 'loading'
        ? l10n.t('Reading the usage…')
        : undefined;
    changed.fire(undefined);
  };
  const refresh = (): void => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(flush);
  };
  const unsubscribe = usage.onChange(refresh);
  const visibility = view.onDidChangeVisibility((event) => {
    usage.setVisible(event.visible);
  });
  usage.setVisible(view.visible);
  refresh();

  return {
    provider,
    disposable: vscode.Disposable.from(view, changed, visibility, {
      dispose: () => {
        disposed = true;
        unsubscribe();
      },
    }),
  };
}

/** Maps a node to the `TreeItem` VS Code draws. */
function toTreeItem(
  node: UsageNode,
  locale: string | undefined,
  retryCommand: string,
): vscode.TreeItem {
  switch (node.kind) {
    case 'period': {
      const item = new vscode.TreeItem(
        periodLabel(node.period.key),
        node.period.key === 'today'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.id = node.id;
      item.description = periodDescription(node.period, locale);
      item.iconPath = new vscode.ThemeIcon(node.period.key === 'today' ? 'calendar' : 'history');
      item.tooltip = new vscode.MarkdownString().appendText(
        usageTooltip(node.period, node.period.hasUnreported, locale),
      );
      item.contextValue = 'usagePeriod';
      item.accessibilityInformation = {
        label: l10n.t('{0}, {1}', periodLabel(node.period.key), item.description),
      };
      return item;
    }
    case 'model': {
      const item = new vscode.TreeItem(node.row.name, vscode.TreeItemCollapsibleState.None);
      item.id = node.id;
      item.description = modelDescription(node.row, locale);
      item.iconPath = new vscode.ThemeIcon('hubot');
      item.tooltip = new vscode.MarkdownString().appendText(
        usageTooltip({ tokens: node.row.tokens, steps: node.row.steps }, false, locale),
      );
      item.contextValue = 'usageModel';
      item.accessibilityInformation = {
        label: l10n.t('{0}, {1}', node.row.name, item.description),
      };
      return item;
    }
    case 'note': {
      const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
      item.id = node.id;
      item.contextValue = 'usageNote';
      if (node.retry) item.command = { command: retryCommand, title: l10n.t('Retry') };
      return item;
    }
  }
}
