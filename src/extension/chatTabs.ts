// The registry of editor tabs that show the chat (issue #77). Pure: no `vscode` import. The rules
// that break silently when they are wrong live here, where Vitest checks them in milliseconds:
// which tab a command goes to, in which editor column a new tab opens, and what a tab is titled.
// "Which tab already shows a session" is NOT decided here: the registry's view of the session lags
// the controller's, so that question is answered by `ChatController.sessionOf`. The VS Code side
// (`WebviewPanel`s) only reports events to it and asks it questions.

import type { HostToWebview } from '../shared/protocol';
import { EMPTY_TITLE, sessionLabel } from '../shared/sessionLabel';

/**
 * An editor column for the VS Code side: a number is a real column (`TextEditor.viewColumn`), and
 * `'beside'` means "next to the active group" (`ViewColumn.Beside`).
 */
export type TabColumn = number | 'beside';

/** What the registry keeps of one tab. */
interface Tab {
  paneId: number;
  sessionID: string | undefined;
  title: string;
  column: number | undefined;
  active: boolean;
  /** When the tab was last added or activated; the largest is the most recent. */
  recency: number;
}

/**
 * The tabs, their order of recency and their titles.
 *
 * Titles come from the messages the host posts to each pane (`snapshot` and `session.upserted`),
 * because the controller publishes to a pane even while its tab is hidden, so the registry sees
 * the session and its title without a callback from the controller (decision T4=1 of Sergio,
 * 29/10/2026). A tab with no session reads {@link EMPTY_TITLE}. The session seen this way lags
 * the controller's, so it serves titles only: "which pane shows session X" is answered by
 * `ChatController.sessionOf`, never by this registry.
 * VERIFIED by `chatTabs.test.ts` with fabricated messages for the registry. HYPOTHESIS for the
 * title in a real window; a check that reads the tab label would settle it.
 */
export class ChatTabs {
  private readonly tabs = new Map<number, Tab>();
  private clock = 0;

  /**
   * Registers a tab; it counts as the most recent one. `column` is where it opened, when known.
   * Adding an id twice replaces the first entry.
   *
   * `seed` is for a tab restored after Reload Window: the session it was bound to and the title
   * VS Code persisted, so the tab reads as before until its first real snapshot replaces both
   * (decision Q4=1 of Sergio, 29/10/2026). A blank seed title falls back to {@link EMPTY_TITLE}.
   */
  add(paneId: number, column?: number, seed?: { sessionID?: string; title?: string }): void {
    const seedTitle = seed?.title?.trim();
    this.tabs.set(paneId, {
      paneId,
      sessionID: seed?.sessionID,
      title: seedTitle === undefined || seedTitle === '' ? EMPTY_TITLE : seedTitle,
      column,
      active: false,
      recency: ++this.clock,
    });
  }

  /** Forgets a tab; returns whether it was registered. */
  remove(paneId: number): boolean {
    return this.tabs.delete(paneId);
  }

  /** True while `paneId` is a registered tab. */
  has(paneId: number): boolean {
    return this.tabs.has(paneId);
  }

  /**
   * Marks a tab active or not. Activating makes it the most recent and deactivates every other
   * tab: only one chat tab holds the focus of the workbench at a time. Unknown ids are ignored.
   */
  setActive(paneId: number, active: boolean): void {
    const tab = this.tabs.get(paneId);
    if (tab === undefined) return;
    if (active) {
      for (const other of this.tabs.values()) other.active = false;
      tab.recency = ++this.clock;
    }
    tab.active = active;
  }

  /** Records the column a tab is in now (the user may drag it). Unknown ids are ignored. */
  setColumn(paneId: number, column: number | undefined): void {
    const tab = this.tabs.get(paneId);
    if (tab !== undefined) tab.column = column;
  }

  /** The tab ids, most recent first. */
  recent(): number[] {
    return [...this.tabs.values()].sort((a, b) => b.recency - a.recency).map((tab) => tab.paneId);
  }

  /**
   * The tab a command (Open Chat, Focus Prompt, Stop, a menu action) goes to: the active one, else
   * the most recent, else `undefined` (the caller then opens one).
   */
  commandTarget(): number | undefined {
    for (const tab of this.tabs.values()) {
      if (tab.active) return tab.paneId;
    }
    return this.recent()[0];
  }

  /**
   * The column for a NEW tab: next to the active group when there are no tabs, else the column of
   * the most recent tab, so the chats gather in one group and code stays in the other (decision Q5=1
   * of Sergio). A most recent tab of unknown column also gives `'beside'`.
   */
  columnForNewTab(): TabColumn {
    const latest = this.recent()[0];
    const column = latest === undefined ? undefined : this.tabs.get(latest)?.column;
    return column ?? 'beside';
  }

  /**
   * The column where a file, a diff or a new file opened from a tab goes: the one of the last text
   * editor, unless that is a column holding a chat tab (or there is none), in which case
   * `'beside'`. No editor group is ever locked.
   */
  columnForFiles(lastTextEditorColumn: number | undefined): TabColumn {
    if (lastTextEditorColumn === undefined) return 'beside';
    for (const tab of this.tabs.values()) {
      if (tab.column === lastTextEditorColumn) return 'beside';
    }
    return lastTextEditorColumn;
  }

  /**
   * Updates a tab from a message the host posted to its pane. A `snapshot` sets the session and
   * the title (no open session reads {@link EMPTY_TITLE}); a `session.upserted` of the tab's own
   * session renames it; everything else, including the upsert of another session, is ignored. When
   * a snapshot opens a session that the list does not contain (a child session may not be listed)
   * the title it had is kept if the session did not change. Returns `true` when the session or the
   * title changed, so the caller can retitle the tab.
   */
  observe(paneId: number, message: HostToWebview): boolean {
    const tab = this.tabs.get(paneId);
    if (tab === undefined) return false;
    const before = `${tab.sessionID ?? ''}\u0000${tab.title}`;
    if (message.type === 'snapshot') {
      const sessionID = message.snapshot.open?.sessionID;
      const row = message.snapshot.sessions.find((session) => session.id === sessionID);
      if (sessionID === undefined) tab.title = EMPTY_TITLE;
      else if (row !== undefined) tab.title = sessionLabel(row);
      else if (sessionID !== tab.sessionID) tab.title = EMPTY_TITLE;
      tab.sessionID = sessionID;
    } else if (message.type === 'session.upserted' && message.session.id === tab.sessionID) {
      tab.title = sessionLabel(message.session);
    }
    return before !== `${tab.sessionID ?? ''}\u0000${tab.title}`;
  }

  /** The title of a tab, or `undefined` for an unknown id. */
  titleOf(paneId: number): string | undefined {
    return this.tabs.get(paneId)?.title;
  }
}
