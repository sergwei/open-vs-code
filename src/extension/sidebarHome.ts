// What the OpenCode container shows around the Sessions tree while the chat lives in editor tabs
// (E9-sidebar-home, issue #187): the native Changes and Usage views, built here so that
// `chatLifecycle.ts` only wires hooks (it is already 1.5k lines). The Quick start webview view
// (`homeView.ts`, `homeController.ts`) is built through this same entry point.
//
// `registerSidebarHome` creates the two models and their trees, registers the internal command that
// opens a file of the Changes view and the refresh commands, and returns the hooks the lifecycle
// calls: `filesChanged` (a step changed files), `sessionRemoved`, `sessionsChanged` (tabs or the
// Sessions tree moved), `connection` (the server came or went) and `activity` (the sessions that run
// now, from which it sees a turn end). The views are registered in BOTH chat locations, like the
// Sessions tree: the `when` of their manifest entries decides whether the container shows them, and
// a view that is never shown never becomes visible, so it never reads.

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { Catalog, ErrorInfo, ModelRef } from '../shared/model';
import {
  isHomeWebviewToHost,
  type HomeHostToWebview,
  type HomeState,
} from '../shared/homeProtocol';
import { registerChangesView, type ChangesView } from './changesView';
import { HomeController, type HomeControllerDeps } from './homeController';
import { homeModelItems, pickedRef } from './homeModelPick';
import { parseModelSetting } from './modelPreference';
import { registerHomeView } from './homeView';
import {
  OPEN_CHANGED_FILE_COMMAND_ID,
  REFRESH_CHANGES_COMMAND_ID,
  REFRESH_USAGE_COMMAND_ID,
} from './ids';
import type { ChatApi } from './opencodeClient';
import type { ServerLog } from './opencodeServer';
import type { DiffTarget } from './sessionDiff';
import { createSessionChanges, type SessionChanges } from './sessionChanges';
import { createUsage, type Usage } from './usageStats';
import { registerUsageView, type UsageView } from './usageView';

/** What {@link registerSidebarHome} needs from the lifecycle; every read is lazy. */
export interface SidebarHomeDeps {
  log: ServerLog;
  /** The client of the current server, or `undefined` without one. */
  client(): ChatApi | undefined;
  /** The folder the server serves, or `undefined` without a server. */
  folder(): string | undefined;
  /** The catalog of the server (free models, display names), or `undefined` before it is read. */
  catalog(): Catalog | undefined;
  /** The root sessions that have a chat tab. */
  tabs(): readonly string[];
  /** The root sessions of the "Today" group of the Sessions tree. */
  today(): readonly string[];
  updatedAt(sessionID: string): number | undefined;
  titleOf(sessionID: string): string;
  /** The boundary of the revert prepared in the tab of the session, if any. */
  boundary(sessionID: string): string | undefined;
  /** Opens the native diff of a listed file (`EditorActions.openDiff`: the column of the files). */
  openDiff(target: DiffTarget): Promise<'diff' | 'file'>;
  describe(error: unknown): ErrorInfo;
  /** `vscode.env.language`, for the money and the counts. */
  locale: string;
  extensionUri: vscode.Uri;
  channel: vscode.LogOutputChannel;
  /**
   * What the Quick start view reads and does (its own sources and actions: see `HomeControllerDeps`),
   * plus the two subscriptions that tell it to look again. Each `on*` returns the unsubscribe.
   */
  quick: Omit<HomeControllerDeps, 'post' | 'log' | 'pickModel'> & {
    /**
     * Test mode only: the pre-loaded answer of the NEXT model picker (`provider/id` picks it, `null`
     * cancels; read once, `undefined` means "no answer: open the real QuickPick").
     */
    testModelAnswer?(): string | null | undefined;
    onActivity(listener: () => void): () => void;
    onConfig(listener: () => void): () => void;
  };
}

/** The hooks and models the lifecycle uses; see the file header. */
export interface SidebarHome {
  changes: SessionChanges;
  usage: Usage;
  /** A step of `sessionID` changed files; `rootID` is the root of its tree. */
  filesChanged(rootID: string): void;
  /** The session was deleted. */
  sessionRemoved(sessionID: string): void;
  /** A tab opened or closed, or the Sessions tree moved: the candidates of Changes may differ. */
  sessionsChanged(): void;
  /** The server connected (`true`) or went away (`false`); only a change of state does anything. */
  connection(connected: boolean): void;
  /** The sessions that run now; a turn ending is what refreshes a visible Usage view. */
  activity(running: readonly string[]): void;
  /** Something the Quick start view draws changed (connection, catalog, pending requests, mode). */
  quickChanged(): void;
  /** Test mode: the state the Quick start view would get now. */
  quickState(): HomeState;
  /**
   * Test mode: runs a raw message through the guard and the controller as the home webview would,
   * and answers the `home.result` it posted (`undefined` for a message with no result or a rejected one).
   */
  quickMessage(raw: unknown): Promise<HomeHostToWebview | undefined>;
  /**
   * What the two trees draw, as text, read through their real data providers (Test mode only; see
   * `TEST_SIDEBAR_VIEWS_COMMAND_ID`). `expand` expands that session of the Changes tree first.
   */
  describeViews(expand?: string): Promise<SidebarViewsText>;
  disposable: vscode.Disposable;
}

/** The text the Test-mode command answers; plain data, JSON-serializable. */
export interface SidebarViewsText {
  changes: {
    sessionID: string;
    label: string;
    description: string | undefined;
    files: { label: string; description: string | undefined }[];
  }[];
  usage: {
    state: string;
    description: string | undefined;
    periods: {
      label: string;
      description: string | undefined;
      tooltip: string | undefined;
      models: { label: string; description: string | undefined }[];
    }[];
  };
}

/** The label of a tree item as text (it can be a string or a `{ label }` object). */
function labelText(item: vscode.TreeItem): string {
  const { label } = item;
  return typeof label === 'string' ? label : (label?.label ?? '');
}

/**
 * The tooltip of a tree item as plain text. A `MarkdownString` built with `appendText` stores its
 * text ESCAPED (a space becomes `&nbsp;`, a Markdown token gets a backslash), so the value is
 * unescaped here to give back what the user reads. The first run of the fake-server case "shows the
 * usage of all projects after a COSTLY turn…" failed on its "the tooltip does not say all projects"
 * check and the same case passed with this unescape (Windows 11, VS Code 1.145.2, 07/11/2026); that
 * the cause was `&nbsp;` is HYPOTHESIS (the raw value was not printed). Only the Test-mode command
 * reads it.
 */
function tooltipText(item: vscode.TreeItem): string | undefined {
  const { tooltip } = item;
  if (tooltip === undefined) return undefined;
  if (typeof tooltip === 'string') return tooltip;
  return tooltip.value.replaceAll('&nbsp;', ' ').replace(/\\(.)/g, '$1');
}

/** A `description` that is a string, else `undefined` (VS Code also allows `true`). */
function descriptionText(item: vscode.TreeItem): string | undefined {
  return typeof item.description === 'string' ? item.description : undefined;
}

/**
 * Creates the Changes and Usage views and returns the hooks that feed them.
 *
 * The open command is the one place a file of the Changes view reaches VS Code: it takes the
 * session id and the listed path from the row, asks the model's whitelist (`SessionDiffs.target`)
 * and refuses with a warning and a stable log line, `changes view refused a file: <reason>`, when
 * the pair was not listed; an accepted one logs `changes view opened a diff|file for <sid>` (id
 * only, never a path). The arguments come from a tree row but the command is also reachable from
 * the palette's Execute Command and from other extensions, so they are checked as untrusted.
 * It also creates the Quick start view (`homeView.ts`) and its controller (`homeController.ts`,
 * fed by `deps.quick`), which re-compose their state when `quickChanged`, the registry's activity or
 * the server config say so; in Test mode `quickMessage` and `quickState` drive it without a webview.
 * The model pill's picker (issue #223) is a native QuickPick built here from `homeModelItems`
 * (providers as separators, the current model checked); in Test mode a pre-loaded answer
 * (`deps.quick.testModelAnswer`, one use) replaces it. VERIFIED on Windows 11, VS Code 1.146.0, 12/11/2026: the
 * `fake-server` case "starts a conversation from the home view with the model chosen in its picker"
 * (the answer path) and, with the real QuickPick opened by a mouse click, "ok   P1 the model pill
 * opens the picker "Model for the next conversation" listing both models, and Escape closes it
 * leaving the pill as it was" of `test:visual` step 50. UNVERIFIED until a check reads
 * `document.activeElement`: where the focus goes when the QuickPick closes (VS Code is expected to
 * give it back to the webview; the next check clicks the box anyway, so a loss would not show).
 * The usage reacts to a turn END seen as a session leaving the running set (the registry is the
 * controller's; this module only compares two sets), and to the connection going up or down.
 * VERIFIED (Windows 11, VS Code 1.145.2, 08/11/2026, `npm run test:integration` with all labels,
 * the fake-server one with 69 passing): "lists the changed files of a session without a tab and
 * opens its native diff" (the open command opened a diff tab and logged `changes view opened a
 * diff for <sid>`) and "refuses a path the Changes view did not list" (four refusals and one
 * `rejected: invalid arguments`, no tab). The turn-end detection of `activity` is VERIFIED in a real
 * window by the full run and by `--steps 29,34,49,50` (step 49, 08/11/2026): "ok   U4 expanding it again reads once more, two requests, because the
 * turn marked the data stale (2 new)". UNVERIFIED: the `connection` reset (no check restarts the
 * server with the Usage view shown), macOS and Linux.
 */
export function registerSidebarHome(deps: SidebarHomeDeps): SidebarHome {
  const changes = createSessionChanges({
    client: () => deps.client(),
    folder: () => deps.folder(),
    tabs: () => deps.tabs(),
    today: () => deps.today(),
    updatedAt: (sessionID) => deps.updatedAt(sessionID),
    titleOf: (sessionID) => deps.titleOf(sessionID),
    boundary: (sessionID) => deps.boundary(sessionID),
    now: () => Date.now(),
    log: deps.log,
    describe: (error) => deps.describe(error),
  });
  const usage = createUsage({
    client: () => deps.client(),
    catalog: () => deps.catalog(),
    now: () => Date.now(),
    timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    log: deps.log,
    describe: (error) => deps.describe(error),
  });
  const changesView: ChangesView = registerChangesView(changes);
  const usageView: UsageView = registerUsageView({
    usage,
    locale: deps.locale,
    retryCommand: REFRESH_USAGE_COMMAND_ID,
  });

  // The Quick start webview. `tap` lets the Test-mode command read what the controller posted.
  let tap: ((message: HomeHostToWebview) => void) | undefined;
  const quick = new HomeController({
    ...deps.quick,
    log: deps.log,
    pickModel: async (current, catalog) => {
      // Test mode: a pre-loaded answer stands for the QuickPick, which would hang the test command.
      const answer = deps.quick.testModelAnswer?.();
      if (answer !== undefined) {
        if (answer === null) return undefined;
        const wanted = parseModelSetting(answer);
        return wanted.kind === 'model' ? pickedRef(catalog, wanted.model) : undefined;
      }
      const items: (vscode.QuickPickItem & { ref?: ModelRef })[] = homeModelItems(
        catalog,
        current,
      ).map((item) =>
        item.kind === 'separator'
          ? { label: item.label, kind: vscode.QuickPickItemKind.Separator }
          : { label: item.label, description: item.description, ref: item.ref },
      );
      const picked = await vscode.window.showQuickPick(items, {
        title: l10n.t('Model for the next conversation'),
        placeHolder: l10n.t('Search models'),
        matchOnDescription: true,
      });
      return picked?.ref === undefined ? undefined : pickedRef(catalog, picked.ref);
    },
    post: (message) => {
      // `homeView` is assigned right below; `post` only runs after a message, never before.
      homeView.provider.post(message);
      tap?.(message);
    },
  });
  const homeView = registerHomeView(deps.extensionUri, deps.channel, deps.log, {
    onReady: () => {
      quick.onReady();
    },
    onMessage: (message) => {
      void quick.onMessage(message);
    },
    onClosed: () => {
      quick.onClosed();
    },
  });
  const unsubscribeQuick = [
    deps.quick.onActivity(() => {
      quick.changed();
    }),
    deps.quick.onConfig(() => {
      quick.changed();
    }),
  ];

  let connected = false;
  let running = new Set<string>();

  const open = async (sessionID: unknown, path: unknown): Promise<void> => {
    if (typeof sessionID !== 'string' || typeof path !== 'string') {
      deps.log.warn(`${OPEN_CHANGED_FILE_COMMAND_ID} rejected: invalid arguments`);
      return;
    }
    const checked = changes.target(sessionID, path);
    if (!checked.ok) {
      deps.log.warn(`changes view refused a file: ${checked.reason}`);
      void vscode.window.showWarningMessage(
        l10n.t('That file is not in the changed files of this session'),
      );
      return;
    }
    try {
      const opened = await deps.openDiff(checked.target);
      deps.log.info(`changes view opened a ${opened} for ${sessionID}`);
    } catch (error) {
      const info = deps.describe(error);
      deps.log.warn(`changes view could not open a file: ${info.code}`);
      void vscode.window.showWarningMessage(info.message);
    }
  };

  return {
    changes,
    usage,
    filesChanged: (rootID) => {
      changes.touch(rootID);
    },
    sessionRemoved: (sessionID) => {
      changes.forget(sessionID);
    },
    sessionsChanged: () => {
      changes.listChanged();
    },
    connection: (next) => {
      if (next === connected) return;
      connected = next;
      if (!next) changes.reset();
      usage.connection(next);
    },
    activity: (now) => {
      const next = new Set(now);
      const ended = [...running].some((id) => !next.has(id));
      running = next;
      if (ended) usage.turnEnded();
    },
    quickChanged: () => {
      quick.changed();
    },
    quickState: () => quick.buildState(),
    quickMessage: async (raw) => {
      if (!isHomeWebviewToHost(raw)) {
        deps.log.warn('rejected a message from the home webview (type: test)');
        return undefined;
      }
      const seen: HomeHostToWebview[] = [];
      tap = (message) => seen.push(message);
      try {
        await quick.onMessage(raw);
      } finally {
        tap = undefined;
      }
      return seen.find((message) => message.type === 'home.result');
    },
    describeViews: async (expand) => {
      const rows = await Promise.resolve(changesView.provider.getChildren(undefined));
      const sessions = rows ?? [];
      const changesText: SidebarViewsText['changes'] = [];
      for (const node of sessions) {
        if (node.kind !== 'session') continue;
        const expanded = node.sessionID === expand;
        const children = expanded
          ? ((await Promise.resolve(changesView.provider.getChildren(node))) ?? [])
          : [];
        // Re-read the row after the expansion: the description appears once its files are held.
        const fresh =
          (await Promise.resolve(changesView.provider.getChildren(undefined)))?.find(
            (candidate) => candidate.id === node.id,
          ) ?? node;
        const item = await Promise.resolve(changesView.provider.getTreeItem(fresh));
        changesText.push({
          sessionID: node.sessionID,
          label: labelText(item),
          description: descriptionText(item),
          files: await Promise.all(
            children.map(async (child) => {
              const childItem = await Promise.resolve(changesView.provider.getTreeItem(child));
              return { label: labelText(childItem), description: descriptionText(childItem) };
            }),
          ),
        });
      }
      const periods: SidebarViewsText['usage']['periods'] = [];
      for (const node of (await Promise.resolve(usageView.provider.getChildren(undefined))) ?? []) {
        if (node.kind !== 'period') continue;
        const item = await Promise.resolve(usageView.provider.getTreeItem(node));
        const models = await Promise.all(
          ((await Promise.resolve(usageView.provider.getChildren(node))) ?? []).map(
            async (child) => {
              const childItem = await Promise.resolve(usageView.provider.getTreeItem(child));
              return { label: labelText(childItem), description: descriptionText(childItem) };
            },
          ),
        );
        periods.push({
          label: labelText(item),
          description: descriptionText(item),
          tooltip: tooltipText(item),
          models,
        });
      }
      return {
        changes: changesText,
        usage: {
          state: usage.snapshot().state,
          description: l10n.t('All projects'),
          periods,
        },
      };
    },
    disposable: vscode.Disposable.from(
      changesView.disposable,
      usageView.disposable,
      homeView.disposable,
      {
        dispose: () => {
          for (const stop of unsubscribeQuick) stop();
          quick.dispose();
        },
      },
      { dispose: () => usage.dispose() },
      vscode.commands.registerCommand(OPEN_CHANGED_FILE_COMMAND_ID, open),
      vscode.commands.registerCommand(REFRESH_CHANGES_COMMAND_ID, () => {
        changes.refresh();
      }),
      vscode.commands.registerCommand(REFRESH_USAGE_COMMAND_ID, async () => {
        await usage.refresh();
      }),
    ),
  };
}
