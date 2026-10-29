/**
 * The text that stands for a session in lists and tab titles. It lives in `src/shared` because the
 * session list of the webview and the editor-tab titles of the host must read the same string, and
 * the host may not reach into the webview folder (architecture boundaries in `eslint.config.mjs`).
 * Moved here from the webview's `sessionGroups.ts`, which re-exports both names.
 */
import type { SessionSummary } from './model';

/**
 * Title shown while a session has none. It must differ from the "New session" button next to it:
 * with the same text the bar read "New session [New session]" (seen in the CDP run of 20/10/2026).
 */
export const EMPTY_TITLE = 'Untitled session';

/**
 * The title of a row, or {@link EMPTY_TITLE} when it has none or only blanks.
 * VERIFIED by `sessionGroups.test.ts` (it imports it through the re-export) and
 * `sessionLabel.test.ts`.
 */
export function sessionLabel(row: Pick<SessionSummary, 'title'>): string {
  const title = row.title?.trim();
  return title === undefined || title === '' ? EMPTY_TITLE : title;
}
