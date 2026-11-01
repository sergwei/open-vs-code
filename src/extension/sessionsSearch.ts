// "OpenCode: Search Sessions…" (issue #77, E3, decision Q5=1 and P7 of #1245): a QuickPick that
// searches session TITLES on the server, so it finds sessions older than the pages the tree has
// loaded. The tree's own find (type-to-find) only sees loaded rows; this is the complement.

import * as vscode from 'vscode';
import { formatSessionTime } from '../shared/sessionGroups';
import { sessionLabel } from '../shared/sessionLabel';
import type { SessionSearchResult } from './chatController';

/**
 * Quiet time before a search goes to the server, in ms. The same 250 ms as `SEARCH_DEBOUNCE_MS` of
 * `webview-ui/src/sessions/SessionPicker.tsx` (the host may not import from the webview folder, so
 * the number is repeated here; the two should move together). Chosen by the planner of #77 as
 * "fast enough to feel live, slow enough not to send a request per key"; not measured.
 */
export const SESSION_SEARCH_DEBOUNCE_MS = 250;

/** The label of the single item shown when the server finds nothing. */
const NO_MATCH_LABEL = 'No sessions match';

/** What the search needs from the wiring. */
export interface SessionsSearchHost {
  /**
   * Searches the titles on the server. Resolves `undefined` when a newer search superseded this
   * one (`ChatController.searchSessions`), and rejects when the server cannot answer.
   */
  search(text: string): Promise<SessionSearchResult | undefined>;
  /** Opens the chosen session exactly as clicking its row in the tree does. */
  open(sessionID: string): void;
  /** `vscode.env.language`, for the dates. */
  locale?: string;
  /**
   * Where the user keeps a session when it is not just under its date: `Archived`, or the folder
   * path (`Spikes / SSE`); `undefined` for a loose one. It goes before the time in the description
   * (E9-sessions-organize, decision Q6=1: the search finds archived sessions and says so).
   */
  placeOf?(sessionID: string): string | undefined;
}

/** A result row of the picker; `sessionID` is absent on the "No sessions match" item. */
interface SearchItem extends vscode.QuickPickItem {
  sessionID?: string;
}

/**
 * Shows the search picker and resolves when it is closed.
 *
 * It searches once with an empty text (the newest sessions) and then again, 250 ms after the user
 * stops typing, with `busy` on while the server answers. Every item has `alwaysShow: true`: the
 * server already filtered, and VS Code's own filter (which in 1.105 has no way to be limited to
 * the label, `matchOnLabel` does not exist there) would hide results whose title does not contain
 * the text literally. `keepScrollPosition` stops the list from jumping back to the top on each new
 * answer. The description starts with `host.placeOf` (`Archived`, a folder path) when the user
 * organized the session, so an archived result says so; opening it does NOT unarchive it. Picking a
 * result calls `host.open`. A failing search shows a native warning and leaves
 * the picker usable. An answer that arrives after the picker closed is dropped.
 * VERIFIED by a full `test:visual` (Windows 11, VS Code 1.144.0, 30/10/2026, 0 FAIL): "ok   B4
 * Search Sessions… lists "Seed29 0711:13 AM" for "Seed29 07" and opens it in a tab (3 -> 4 tabs)". Not
 * observed: a failing search, an answer after the picker closed (unit and integration only).
 */
export async function showSessionsSearch(host: SessionsSearchHost): Promise<void> {
  const picker = vscode.window.createQuickPick<SearchItem>();
  picker.title = 'OpenCode: Search Sessions';
  picker.placeholder = 'Search sessions by title';
  picker.matchOnDescription = false;
  picker.keepScrollPosition = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const run = async (text: string): Promise<void> => {
    picker.busy = true;
    try {
      const result = await host.search(text);
      if (closed || result === undefined) return;
      const now = Date.now();
      picker.items =
        result.rows.length === 0
          ? [{ label: NO_MATCH_LABEL, alwaysShow: true }]
          : result.rows.map((row) => ({
              label: sessionLabel(row),
              description: [
                host.placeOf?.(row.id),
                formatSessionTime(row.updatedAt, now, host.locale),
              ]
                .filter((part) => part !== undefined)
                .join(' · '),
              iconPath: new vscode.ThemeIcon('comment-discussion'),
              alwaysShow: true,
              sessionID: row.id,
            }));
    } catch (error) {
      if (!closed) {
        picker.items = [];
        void vscode.window.showWarningMessage(
          `OpenCode could not search the sessions: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      if (!closed) picker.busy = false;
    }
  };

  await new Promise<void>((resolve) => {
    picker.onDidChangeValue((text) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        void run(text);
      }, SESSION_SEARCH_DEBOUNCE_MS);
    });
    picker.onDidAccept(() => {
      const sessionID = picker.selectedItems[0]?.sessionID;
      if (sessionID === undefined) return;
      picker.hide();
      host.open(sessionID);
    });
    picker.onDidHide(() => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      picker.dispose();
      resolve();
    });
    picker.show();
    void run('');
  });
}
