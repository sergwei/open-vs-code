// The editor tabs that show the chat (issue #77, `openVsCode.chatLocation` = `editor`): one
// `WebviewPanel` per tab, each one a chat pane of the controller. The rules that break silently
// (which tab a command goes to, the column, the title) live in `chatTabs.ts`, which Vitest checks;
// this file only creates, restores, reveals and closes panels and reports what VS Code tells it.

import * as vscode from 'vscode';
import type { HostToWebview, WebviewToHost } from '../shared/protocol';
import { EMPTY_TITLE } from '../shared/sessionLabel';
import { readPersistedSessionID } from '../shared/tabState';
import type { PaneSurface } from './chatPane';
import type { ChatTabs } from './chatTabs';
import { chatWebviewOptions, parseWebviewMessage, renderChatWebview } from './chatWebview';
import { CHAT_PANEL_VIEW_TYPE } from './ids';
import type { ServerLog } from './opencodeServer';

/** What the panels need from the chat side; `registerChat` wires each one to the controller. */
export interface ChatPanelsHost {
  /** Adds a chat pane for a new tab and returns its id. */
  attachPane(surface: PaneSurface): { id: number };
  /** Removes the pane of a tab that was closed. */
  detachPane(paneId: number): void;
  /** The document of tab `paneId` loaded and sent `ready`. */
  onReady(paneId: number): void;
  /** A VALIDATED message from tab `paneId` (`isWebviewToHost` already passed, `ready` excluded). */
  onMessage(paneId: number, message: WebviewToHost): void;
  /**
   * Tab `paneId` is visible again after being hidden. A retained document sends no new `ready`, so
   * the host must bring it up to date itself.
   */
  onResync(paneId: number): void;
  /** The visibility or the active tab changed (also after a tab opened or closed). */
  onSurfaceChange(): void;
  /** Binds the session a restored tab had to its new pane (no server needed, memory untouched). */
  restoreSession(paneId: number, sessionID: string): void;
  /** The pane (a tab or the side bar) that already shows `sessionID`, if any. */
  paneShowing(sessionID: string): number | undefined;
  /** Brings the surface of `paneId` forward (a tab or the side-bar view). */
  revealSurface(paneId: number): void;
  /**
   * The session or the title of tab `paneId` changed, as seen in a message posted to it (the
   * native Sessions tree repaints its "Tab" mark and follows the active tab). Optional.
   */
  onTabSessionChanged?(paneId: number): void;
}

/** How a panel reaches {@link ChatPanels.adopt}: created by us, or handed back by VS Code. */
type PanelOrigin = { kind: 'created' } | { kind: 'restored'; sessionID: string | undefined };

/** One open tab: its panel and what the host knows of its document. */
interface PanelEntry {
  panel: vscode.WebviewPanel;
  /** The listeners of the panel; released on close and by {@link ChatPanels.detachAll}. */
  subscriptions: vscode.Disposable[];
  /** The document sent `ready`; it stays true while hidden, because the context is retained. */
  ready: boolean;
  /** Last visibility seen, to spot the hidden-to-visible transition. */
  visible: boolean;
  disposed: boolean;
}

/**
 * Creates, restores and tracks the chat tabs.
 *
 * After Reload Window the tabs come back: the panel serializer (registered by `registerChat`)
 * hands each revived panel to {@link ChatPanels.restore}, which wires it like a new one and binds
 * the session its webview saved. VS Code revives only the tab that becomes visible; background
 * tabs are restored when the user opens them. `detachAll` leaves the panels open on deactivation
 * so the workbench can save them.
 *
 * `retainContextWhenHidden` is on (decision T2=1 of Sergio, 29/10/2026): switching between code and
 * chat neither reloads the document nor loses the scroll. The price is that VS Code cannot deliver
 * to a hidden webview ("You cannot send messages to a hidden webview, even with
 * retainContextWhenHidden enabled", vscode.d.ts 1.105), so a hidden tab drops what is posted to it
 * (`canDeliver` is false) and, when it becomes visible again, {@link ChatPanelsHost.onResync}
 * brings it up to date; there is no new `ready` to do it. Memory is held per open tab, without a
 * cap. The title of a tab follows its session (`ChatTabs.observe`, fed by every message posted to
 * the pane, delivered or not), and the icon is a fixed pair of SVGs (decision Q6=1). Stable log
 * lines: `chat tab created (pane N)`, `chat tab revealed (pane N)`, `chat tab closed (pane N)`.
 * VERIFIED in VS Code 1.144.0 on Windows 11 (29/10/2026, `npm run test:integration`): "opens one
 * tab per New Session, each with a ready document" (two `created`, two `webview ready`, label
 * "Untitled session"), "reveals the existing tab on Open Chat instead of opening another" and
 * "logs the close of a tab". Inside the iframe, `npm run test:visual` step 27 (Windows 11, VS Code
 * 1.144.0, 29/10/2026): "ok C4 coming back to A shows the whole reply once: 400 numbers, from 1 to
 * 400, in order, no repeats" (a LONG turn ended while the tab was hidden, so the resync on return
 * ran), "ok C2 dark, tab alone in the editor area (…): the chat renders with kind vscode-dark…" and
 * "ok C3 light: the tab reads "Tab27A: Reply with exactly: alpha27. Do", its icon is
 * chat-tab-light.svg (wanted light)…" (the title follows the session). That `onDidChangeViewState`
 * is what fires on return is the inference from C4, not observed on its own. NOT observed: a tab in
 * a group that is hidden or collapsed rather than behind another tab.
 */
export class ChatPanels {
  private readonly entries = new Map<number, PanelEntry>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly channel: vscode.LogOutputChannel,
    private readonly log: ServerLog,
    private readonly tabs: ChatTabs,
    private readonly host: ChatPanelsHost,
  ) {}

  /** The ids of the open tabs. */
  ids(): number[] {
    return [...this.entries.keys()];
  }

  /** True while at least one tab would deliver a post now (document ready and visible). */
  anyCanDeliver(): boolean {
    return [...this.entries.values()].some((entry) => this.canDeliver(entry));
  }

  /** True while tab `paneId` is open. */
  has(paneId: number): boolean {
    return this.entries.has(paneId);
  }

  /** True while tab `paneId` is open and on screen. */
  isVisible(paneId: number): boolean {
    const entry = this.entries.get(paneId);
    return entry !== undefined && !entry.disposed && entry.panel.visible;
  }

  /**
   * True while tab `paneId` is open and is the ACTIVE editor of the workbench (`WebviewPanel.active`,
   * which implies it is visible), the only state in which a tab counts as "seeing" a request
   * (decision Q1=2 of Sergio, 30/10/2026): a tab that is visible in another group but not the
   * active editor does not. `onDidChangeViewState` carries `active`, and it already ends in
   * `onSurfaceChange`, so the attention feature is refreshed when the active tab changes.
   * VERIFIED in VS Code 1.144.0 on Windows 11 (30/10/2026) for the same-group case, by the
   * integration case "notifies a permission asked by a tab behind the active one, and closes the toast when Open chat shows it": the hidden tab must not be active and the revealed one must turn active.
   * Two groups, VERIFIED by `test:visual` step 30 (Windows 11, VS Code 1.144.0, 30/10/2026): "ok
   * D4 two groups side by side, the request of the visible tab that is not the active editor: 2
   * chats on screen in groups [0,1]" shows `active` was false for the visible tab of the other
   * group (the toast was raised), and the same line reads "3 s later the editor in front is still"
   * the other tab and "attention: closed (visible)" 0 times: the request does not activate the tab
   * (the dock does not focus a card in a document without focus).
   */
  isActive(paneId: number): boolean {
    const entry = this.entries.get(paneId);
    return entry !== undefined && !entry.disposed && entry.panel.active;
  }

  /**
   * Closes tab `paneId`; its dispose handler removes the pane and logs `chat tab closed`. Used to
   * take back a tab that was opened only to receive an action that was then refused.
   */
  close(paneId: number): void {
    this.entries.get(paneId)?.panel.dispose();
  }

  /**
   * Opens a NEW tab (lazy: the caller binds a session) in the column `ChatTabs.columnForNewTab`
   * says, and returns its pane id. `focus` false leaves the keyboard where it was (a change of
   * location must not steal it from the Settings editor). The tab counts as the most recent one.
   */
  open(focus: boolean): number {
    const column = this.tabs.columnForNewTab();
    const viewColumn = column === 'beside' ? vscode.ViewColumn.Beside : column;
    const panel = vscode.window.createWebviewPanel(
      CHAT_PANEL_VIEW_TYPE,
      EMPTY_TITLE,
      { viewColumn, preserveFocus: !focus },
      { ...chatWebviewOptions(this.extensionUri), retainContextWhenHidden: true },
    );
    return this.adopt(panel, { kind: 'created' });
  }

  /**
   * Takes over a panel VS Code revived after Reload Window (the panel serializer, issue #77) and
   * gives it the same wiring as a new tab, bound to the session in `state`. `state` is whatever the
   * webview last saved with `setState`; only the session id is read from it
   * (`readPersistedSessionID`), and an absent or invalid one gives a lazy tab that keeps its draft.
   *
   * If another surface already shows that session the restored panel is closed and the other one is
   * revealed (decision Q3=1 of Sergio, 29/10/2026), logging `chat tab restore skipped: session
   * already shown (pane M)`; otherwise `chat tab restored (pane N)`. The tab is seeded with the
   * title VS Code persisted, so it reads as before until its first snapshot (Q4=1), and counts as
   * the active one if VS Code says so. Never throws: VS Code paints its own failure page when the
   * deserializer rejects, so an error is logged (`chat tab restore failed`) and the panel closed.
   * VERIFIED in a real VS Code 1.144.0 on Windows 11 (29/10/2026, `npm run test:integration`,
   * `fakeServer.test.ts`) through the test command, which hands a panel it created to this same
   * method: "restores a tab with its session and its title", "restores a tab whose session no
   * longer exists…", "closes a restored tab whose session another tab already shows…" and "restores
   * a tab in sidebar mode…". Disposing the panel inside the deserializer (the duplicate branch) is
   * only exercised there, with a panel we created. UNVERIFIED with a panel VS Code revived: the
   * real Reload Window of `test:visual` step 28 logs no skipped tab ("none skipped"), so that branch
   * is not reached there; to check it, reload a window where a restored session is open in two
   * tabs.
   */
  restore(panel: vscode.WebviewPanel, state: unknown): void {
    try {
      const sessionID = readPersistedSessionID(state);
      const other = sessionID === undefined ? undefined : this.host.paneShowing(sessionID);
      if (other !== undefined) {
        this.log.info(`chat tab restore skipped: session already shown (pane ${String(other)})`);
        panel.dispose();
        this.host.revealSurface(other);
        return;
      }
      this.adopt(panel, { kind: 'restored', sessionID });
    } catch (error) {
      this.log.error(`chat tab restore failed: ${String(error)}`);
      try {
        panel.dispose();
      } catch {
        // already gone: nothing else to release
      }
    }
  }

  /**
   * The wiring shared by a new tab and a restored one: attaches the pane, registers the tab,
   * subscribes to the panel, renders the webview and logs `chat tab created (pane N)` or `chat tab
   * restored (pane N)`. Returns the pane id. For a restored panel the session is bound to the pane
   * before the document exists, so its `ready` is answered with that session. The pane is attached
   * with `ownRequestsOnly`, so its dock lists only the requests of its session lineage.
   */
  private adopt(panel: vscode.WebviewPanel, origin: PanelOrigin): number {
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, 'media', 'chat-tab-light.svg'),
      dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'chat-tab-dark.svg'),
    };
    const entry: PanelEntry = {
      panel,
      subscriptions: [],
      ready: false,
      visible: panel.visible,
      disposed: false,
    };
    let paneId = -1;
    const pane = this.host.attachPane({
      post: (message) => {
        this.post(paneId, entry, message);
      },
      canDeliver: () => this.canDeliver(entry),
      // A tab shows the requests of its session and its subagents only (E4 of #77, decision
      // T1=1); the side-bar view does not set this and keeps every request (decision Q3=1).
      ownRequestsOnly: true,
    });
    paneId = pane.id;
    this.entries.set(paneId, entry);
    if (origin.kind === 'restored') {
      this.tabs.add(paneId, panel.viewColumn, { sessionID: origin.sessionID, title: panel.title });
      if (origin.sessionID !== undefined) this.host.restoreSession(paneId, origin.sessionID);
    } else {
      this.tabs.add(paneId, panel.viewColumn);
    }
    this.tabs.setActive(paneId, panel.active);

    entry.subscriptions.push(
      panel.webview.onDidReceiveMessage((raw: unknown) => {
        const message = parseWebviewMessage(raw, this.channel);
        if (message === undefined) return;
        if (message.type === 'ready') {
          entry.ready = true;
          this.host.onReady(paneId);
          return;
        }
        this.host.onMessage(paneId, message);
      }),
      panel.onDidChangeViewState(() => {
        if (entry.disposed) return;
        this.tabs.setColumn(paneId, panel.viewColumn);
        this.tabs.setActive(paneId, panel.active);
        const visible = panel.visible;
        const returned = visible && !entry.visible;
        entry.visible = visible;
        if (returned && entry.ready) this.host.onResync(paneId);
        this.host.onSurfaceChange();
      }),
      panel.onDidDispose(() => {
        entry.disposed = true;
        entry.ready = false;
        this.entries.delete(paneId);
        this.tabs.remove(paneId);
        this.host.detachPane(paneId);
        this.log.info(`chat tab closed (pane ${String(paneId)})`);
        this.host.onSurfaceChange();
        for (const subscription of entry.subscriptions) subscription.dispose();
      }),
    );
    renderChatWebview(panel.webview, this.extensionUri, this.channel, 'tab');
    this.log.info(
      `chat tab ${origin.kind === 'restored' ? 'restored' : 'created'} (pane ${String(paneId)})`,
    );
    this.host.onSurfaceChange();
    return paneId;
  }

  /**
   * Brings tab `paneId` forward in its own column; `preserveFocus` keeps the keyboard where it
   * was. Returns `false` for an unknown id.
   */
  reveal(paneId: number, preserveFocus = false): boolean {
    const entry = this.entries.get(paneId);
    if (entry === undefined || entry.disposed) return false;
    entry.panel.reveal(undefined, preserveFocus);
    this.log.info(`chat tab revealed (pane ${String(paneId)})`);
    return true;
  }

  /**
   * Lets go of every tab WITHOUT closing it (the extension is deactivating): listeners released,
   * panes detached, entries forgotten, the panels left alone. Closing them from the host that is
   * dying could drop them before the workbench saves its layout, and a tab that is not saved is
   * not restored (decision T7=1 of Sergio, 29/10/2026). Logs nothing and does not call
   * `onSurfaceChange`: there is nothing left to refresh.
   * VERIFIED with this behaviour (`npm run test:visual`, full run, Windows 11, VS Code 1.144.0,
   * 29/10/2026): "R1 right after Reload Window the 4 chat tabs read as before" and "R10 after the
   * second Reload Window the workbench has 5 chat tabs (5 before it)". The alternative (closing the
   * panels here) was run ONCE as a mutation of this method with `--steps 28`, and R1 still passed
   * with the same 4 tabs: in that harness closing in `deactivate` did NOT lose the tabs, so the
   * decision T7=1 rests on the risk, not on a measured difference. HYPOTHESIS that it would lose
   * them on a plain window close or an update restart; nothing here exercises those.
   */
  detachAll(): void {
    for (const [paneId, entry] of [...this.entries]) {
      entry.disposed = true;
      entry.ready = false;
      for (const subscription of entry.subscriptions) subscription.dispose();
      this.entries.delete(paneId);
      this.tabs.remove(paneId);
      this.host.detachPane(paneId);
    }
  }

  /** Document ready and tab visible: the same condition `post` uses, so the two cannot disagree. */
  private canDeliver(entry: PanelEntry): boolean {
    return !entry.disposed && entry.ready && entry.panel.visible;
  }

  /**
   * The `post` of a tab's pane. First the registry looks at the message (title), whether or not it
   * can be delivered: the controller publishes to hidden panes too, which is how a hidden tab
   * keeps its title current. Then the message goes out only if the tab can take it; what is dropped
   * is repaired by the resync when the tab is visible again. When the registry says the session or
   * title changed, `onTabSessionChanged` is told too (the Sessions tree marks the tabs).
   */
  private post(paneId: number, entry: PanelEntry, message: HostToWebview): void {
    if (entry.disposed) return;
    if (this.tabs.observe(paneId, message)) {
      entry.panel.title = this.tabs.titleOf(paneId) ?? EMPTY_TITLE;
      this.host.onTabSessionChanged?.(paneId);
    }
    if (!this.canDeliver(entry)) return;
    void entry.panel.webview.postMessage(message).then(undefined, (error: unknown) => {
      // debug, not warn: closing the window rejects in-flight posts with "Canceled".
      this.log.debug(`posting ${message.type} to a chat tab failed: ${String(error)}`);
    });
  }
}
