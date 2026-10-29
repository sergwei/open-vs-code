// The editor tabs that show the chat (issue #77, `openVsCode.chatLocation` = `editor`): one
// `WebviewPanel` per tab, each one a chat pane of the controller. The rules that break silently
// (which tab a command goes to, the column, the title) live in `chatTabs.ts`, which Vitest checks;
// this file only creates, reveals and closes panels and reports what VS Code tells it.

import * as vscode from 'vscode';
import type { HostToWebview, WebviewToHost } from '../shared/protocol';
import { EMPTY_TITLE } from '../shared/sessionLabel';
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
}

/** One open tab: its panel and what the host knows of its document. */
interface PanelEntry {
  panel: vscode.WebviewPanel;
  /** The document sent `ready`; it stays true while hidden, because the context is retained. */
  ready: boolean;
  /** Last visibility seen, to spot the hidden-to-visible transition. */
  visible: boolean;
  disposed: boolean;
}

/**
 * Creates and tracks the chat tabs.
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

  /** True while at least one tab is on screen. */
  anyVisible(): boolean {
    return [...this.entries.values()].some((entry) => !entry.disposed && entry.panel.visible);
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
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, 'media', 'chat-tab-light.svg'),
      dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'chat-tab-dark.svg'),
    };
    const entry: PanelEntry = { panel, ready: false, visible: panel.visible, disposed: false };
    let paneId = -1;
    const pane = this.host.attachPane({
      post: (message) => {
        this.post(paneId, entry, message);
      },
      canDeliver: () => this.canDeliver(entry),
    });
    paneId = pane.id;
    this.entries.set(paneId, entry);
    this.tabs.add(paneId, panel.viewColumn);
    this.tabs.setActive(paneId, panel.active);

    const subscriptions = [
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
        for (const subscription of subscriptions) subscription.dispose();
      }),
    ];
    renderChatWebview(panel.webview, this.extensionUri, this.channel);
    this.log.info(`chat tab created (pane ${String(paneId)})`);
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

  /** Closes every tab (the extension is deactivating); each one runs its own dispose handler. */
  dispose(): void {
    for (const entry of [...this.entries.values()]) entry.panel.dispose();
  }

  /** Document ready and tab visible: the same condition `post` uses, so the two cannot disagree. */
  private canDeliver(entry: PanelEntry): boolean {
    return !entry.disposed && entry.ready && entry.panel.visible;
  }

  /**
   * The `post` of a tab's pane. First the registry looks at the message (title), whether or not it
   * can be delivered: the controller publishes to hidden panes too, which is how a hidden tab
   * keeps its title current. Then the message goes out only if the tab can take it; what is dropped
   * is repaired by the resync when the tab is visible again.
   */
  private post(paneId: number, entry: PanelEntry, message: HostToWebview): void {
    if (entry.disposed) return;
    if (this.tabs.observe(paneId, message)) {
      entry.panel.title = this.tabs.titleOf(paneId) ?? EMPTY_TITLE;
    }
    if (!this.canDeliver(entry)) return;
    void entry.panel.webview.postMessage(message).then(undefined, (error: unknown) => {
      // debug, not warn: closing the window rejects in-flight posts with "Canceled".
      this.log.debug(`posting ${message.type} to a chat tab failed: ${String(error)}`);
    });
  }
}
