import * as l10n from '@vscode/l10n';
import type { ChangedFile } from '../../../src/shared/model';

/**
 * Words for the status of a changed file, in the interface language; a file with no text diff is
 * just "Binary". A function, not a table built at module level, so the texts follow the locale
 * set at start-up.
 */
function statusText(status: ChangedFile['status']): string {
  switch (status) {
    case 'added':
      return l10n.t('Added');
    case 'modified':
      return l10n.t('Modified');
    case 'deleted':
      return l10n.t('Deleted');
  }
}

/** The text of the summary that opens the list: "Changed files (3)". */
export function changedFilesSummary(count: number): string {
  return l10n.t('Changed files ({0})', count);
}

/**
 * The status as a word: the state must not rely on a colour or an icon. A file the host has no
 * text diff for says why whatever its status, because that is what decides what a click does (it
 * opens the file, not a diff): "Binary" (empty patch) or "Too large to diff" (the server cut the
 * patch for size but sent the counts).
 */
export function statusWord(file: ChangedFile): string {
  if (file.binary) return l10n.t('Binary');
  if (file.tooLarge) return l10n.t('Too large to diff');
  return statusText(file.status);
}

/**
 * "+3 −1" (U+2212 minus, like the tool cards), or `''` for a file with no counts to show. A file
 * that is too large to diff still has its real counts and shows them.
 */
export function countsText(file: ChangedFile): string {
  if (file.binary) return '';
  return `+${String(file.additions)} −${String(file.deletions)}`;
}

/**
 * The second line of a row: "Modified · +3 −1", "Too large to diff · +1200 −0", or just "Binary"
 * when there are no counts.
 */
export function metaText(file: ChangedFile): string {
  const counts = countsText(file);
  return counts === '' ? statusWord(file) : `${statusWord(file)} · ${counts}`;
}

/**
 * The accessible name of a row, built as ONE string (lesson #926: JSX drops the line break between
 * an expression and the text after it). It starts with the action and the path, then the same
 * words the row shows, with the counts spelled out: "Open diff of src/a.ts, Modified, 3 added, 1
 * deleted". A binary row says it opens the file instead: "Open src/logo.png, Binary"; a file too
 * large to diff keeps its counts: "Open src/big.txt, Too large to diff, 1200 added, 0 deleted".
 * HYPOTHESIS: a real screen reader was not run; `ChangedFilesList.test.tsx` checks the string.
 */
export function openName(file: ChangedFile): string {
  if (file.binary) return l10n.t('Open {0}, {1}', file.path, statusWord(file));
  if (file.tooLarge) {
    return l10n.t(
      'Open {0}, {1}, {2} added, {3} deleted',
      file.path,
      statusWord(file),
      file.additions,
      file.deletions,
    );
  }
  return l10n.t(
    'Open diff of {0}, {1}, {2} added, {3} deleted',
    file.path,
    statusWord(file),
    file.additions,
    file.deletions,
  );
}
