// Pagination state of the session list the webview browses (issue #20). Pure: no `vscode`, no I/O.
// The controller asks it what to send to `session.list` and hands it the answer; it owns the one
// thing that must not reach the webview, the paging cursor.
//
// Why the cursor stays here: it is base64url JSON that embeds the whole query, `directory`
// included (VERIFIED by reading `protocol/src/groups/session.ts` and the handler in the v2.0.32
// tag, and by the planner spike against a real opencode 2.0.32, Windows 11, 21/10/2026). The
// webview is untrusted input, so a cursor it could write would let it list another folder.
//
// Facts this module relies on, all from that spike unless said otherwise:
//   - `session.list` orders by `time_updated` (desc by default) with the id as tie-break;
//   - `search` is `LIKE '%x%'` on the title: case-insensitive for ASCII, `%` and `_` are wildcards,
//     and a session without a title never matches (so the search box cannot find "Untitled");
//   - `parentID: null` means ROOT sessions only (the client sends the string "null");
//   - a request carrying only `cursor` keeps the filters of the query that produced it;
//   - `cursor.next` comes back on EVERY non-empty page, the last one included (a page of 1 with a
//     `next` led to an empty page with none). So "there may be more" is `data.length === limit`,
//     never "a cursor exists". The price is one extra empty request when the total is an exact
//     multiple of the page size.

import type { SessionInfo, SessionListInput } from '@opencode/client';
import type { SessionSummary } from '../shared/model';
import { toSessionSummary } from './wireMapping';

/** Rows per page. Our own choice, equal to the API default and to the snapshot's `SESSION_LIMIT`. */
export const SESSION_PAGE_SIZE = 50;

/** What the controller should do with one page that came back. */
export interface SessionPage {
  /** Rows of this page only, already mapped for the protocol. */
  rows: SessionSummary[];
  /** True when the rows continue the list the webview holds; false when they replace it. */
  append: boolean;
  /** True when another page may exist (`rows.length === pageSize`). */
  hasMore: boolean;
}

/** The answer shape {@link SessionQuery.accept} reads: a slice of `SessionsResponse`. */
export interface SessionListAnswer {
  data: readonly SessionInfo[];
  cursor: { next?: string | null };
}

/** One query prepared by {@link SessionBrowser.query}. */
export interface SessionQuery {
  /** What to pass to `client.session.list`. */
  input: SessionListInput;
  /**
   * Reads the answer to `input`. Keeps `cursor.next` for the next "more" ONLY if no newer query was
   * prepared meanwhile: the webview debounces typing, but two requests can still overlap, and the
   * older answer finishing last must not overwrite the cursor of the list the user is looking at.
   */
  accept(answer: SessionListAnswer): SessionPage;
}

/** The pagination state returned by {@link createSessionBrowser}. */
export interface SessionBrowser {
  /**
   * Prepares the `session.list` call for the webview's request. With `more` and a cursor kept for
   * the SAME normalised search the input is just `{ cursor }`; any other case is a first page
   * (`more` with no cursor, or with a different search, falls back to it instead of failing). The
   * search is trimmed, and omitted when empty.
   */
  query(search: string, more: boolean, directory: string): SessionQuery;
  /** Forgets the cursor (the server changed or the cursor was refused). */
  reset(): void;
}

/**
 * Creates an empty browser. VERIFIED by `sessionBrowser.test.ts` (fabricated answers: logic only)
 * and, for the shapes, by the planner spike and `chatController.e2e.test.ts` (a synthetic server
 * that copies the spike's cursor behaviour). `pageSize` is injectable so tests need not fabricate
 * 50 rows.
 */
export function createSessionBrowser(options: { pageSize?: number } = {}): SessionBrowser {
  const pageSize = options.pageSize ?? SESSION_PAGE_SIZE;
  let cursor: { value: string; search: string } | undefined;
  /** Counts prepared queries; an answer is current only if it carries the latest number. */
  let latest = 0;

  return {
    query(search, more, directory) {
      const normalised = search.trim();
      const ticket = ++latest;
      const appending = more && cursor !== undefined && cursor.search === normalised;
      const input: SessionListInput =
        appending && cursor !== undefined
          ? { cursor: cursor.value }
          : {
              directory,
              order: 'desc',
              limit: pageSize,
              parentID: null,
              ...(normalised === '' ? {} : { search: normalised }),
            };
      return {
        input,
        accept(answer) {
          if (ticket === latest) {
            const next = answer.cursor.next;
            cursor =
              typeof next === 'string' && next !== ''
                ? { value: next, search: normalised }
                : undefined;
          }
          return {
            rows: answer.data.map(toSessionSummary),
            append: appending,
            hasMore: answer.data.length === pageSize,
          };
        },
      };
    },

    reset() {
      cursor = undefined;
      latest += 1; // an answer still in flight belongs to the previous server
    },
  };
}
