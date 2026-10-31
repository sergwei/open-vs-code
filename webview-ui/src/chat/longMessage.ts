// When a message of the user is long enough to be shown folded (issue #105, decision P2=1 of
// Sergio, 31/10/2026, Engram `E8-chat-commands/decisions/p1-p5`). Pure: no DOM and no Solid.
//
// The messages this is for are the templates a slash command expands into (`/init` alone is a
// long prompt), which the server stores as the user message. Counting is by LOGICAL lines, not by
// the lines the layout draws, so a 900-character paragraph in a narrow view is not folded; the
// character limit catches the long paragraph. Both numbers are our choice, not measured with a
// real user: a plain prompt almost never reaches them. The folded height (6 lines) lives in
// `index.css` (`.part-text[data-folded]`), the unfolded state in `UserText` (not remembered:
// decision P3=1, a message folds again when its session is reopened or the view is reloaded).

/** More logical lines than this fold the message. */
export const FOLD_LINES = 12;

/** More characters than this fold the message, whatever its lines. */
export const FOLD_CHARS = 1000;

/**
 * True when `text` has more than {@link FOLD_LINES} lines (`\n` or `\r\n` both count as one break)
 * or more than {@link FOLD_CHARS} characters. VERIFIED by `longMessage.test.ts` at both borders
 * (fabricated texts).
 */
export function isLongUserText(text: string): boolean {
  return text.length > FOLD_CHARS || text.split(/\r?\n/).length > FOLD_LINES;
}
