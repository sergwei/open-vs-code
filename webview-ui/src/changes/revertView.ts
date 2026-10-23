import type { ChangedFile, MessageInfo, RevertState } from '../../../src/shared/model';
import { statusWord } from './changedFileText';

/** What the conversation shows while a revert is prepared (see {@link splitAtRevert}). */
export interface RevertSplit {
  /** The messages to draw: all of them, or only those BEFORE the boundary. */
  visible: readonly MessageInfo[];
  /** How many USER messages are hidden (what "N messages reverted" counts). */
  revertedCount: number;
  /** False when there is no revert, or its boundary is not among the loaded messages. */
  found: boolean;
}

/**
 * Hides, by POSITION, the boundary message of a prepared revert and everything after it (issue
 * #32). Position and not id order, like the TUI of opencode (`routes/session/index.tsx` L176-187 @
 * tag v2.0.32, read): the list the webview holds is already in the server's order. The store keeps
 * the hidden messages, so Restore is instant.
 *
 * Without a revert, or when the boundary is not in `messages` (older than the 200 the snapshot
 * loads), NOTHING is hidden and `found` is false: hiding by guess would show a conversation that
 * is not the one the model will see. Returns `messages` itself in those cases (no copy, so the
 * list is not rebuilt on every streamed token). `revertedCount` counts user messages only, since
 * those are the ones the user wrote and sees as "messages".
 * VERIFIED by `revertView.test.ts` with fabricated messages (boundary first, in the middle, absent,
 * no revert; Windows 11, 23/10/2026); the position rule against a real server's order is
 * HYPOTHESIS (the real `message.list` order is the one the snapshot already assumes).
 */
export function splitAtRevert(
  messages: readonly MessageInfo[],
  revert: RevertState | undefined,
): RevertSplit {
  if (revert === undefined) return { visible: messages, revertedCount: 0, found: false };
  const at = messages.findIndex((message) => message.id === revert.messageID);
  if (at < 0) return { visible: messages, revertedCount: 0, found: false };
  const hidden = messages.slice(at);
  return {
    visible: messages.slice(0, at),
    revertedCount: hidden.filter((message) => message.kind === 'user').length,
    found: true,
  };
}

/**
 * The title of the revert block: "1 message reverted", "3 messages reverted", or "Reverted
 * messages" when the boundary is not among the loaded messages and there is no honest count.
 */
export function revertTitle(split: Pick<RevertSplit, 'revertedCount' | 'found'>): string {
  if (!split.found) return 'Reverted messages';
  return split.revertedCount === 1
    ? '1 message reverted'
    : `${String(split.revertedCount)} messages reverted`;
}

/** "1 file changed on disk" / "3 files changed on disk": the caption of the list of files. */
export function revertFilesCaption(count: number): string {
  return count === 1 ? '1 file changed on disk' : `${String(count)} files changed on disk`;
}

/**
 * The accessible name of a row of the revert block, built as ONE string (lesson #926): it says the
 * click shows what the revert undid, not the session's diff, e.g. "Show what the revert undid in
 * src/a.ts, Modified, 3 added, 1 deleted". A file with no text diff says it opens the file.
 * HYPOTHESIS: a real screen reader was not run; `revertView.test.ts` checks the strings.
 */
export function revertOpenName(file: ChangedFile): string {
  if (file.binary || file.tooLarge) return `Open ${file.path}, ${statusWord(file)}`;
  return `Show what the revert undid in ${file.path}, ${statusWord(file)}, ${String(file.additions)} added, ${String(file.deletions)} deleted`;
}
