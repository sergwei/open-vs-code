/**
 * What the session list of the webview imports to group and date its rows (issue #20). The helpers
 * moved to `src/shared` so the host's native Sessions tree computes the same groups and times;
 * this file re-exports them, so the picker and its tests keep their import path, and adds the one
 * thing only the webview owns: the translated title of a group.
 */
import * as l10n from '@vscode/l10n';
import type { SessionSummary } from '../../../src/shared/model';
import type { GroupLabel } from '../../../src/shared/sessionGroups';

export { EMPTY_TITLE, sessionLabel } from '../../../src/shared/sessionLabel';
export {
  formatSessionTime,
  groupSessions,
  type GroupLabel,
  type SessionGroup,
} from '../../../src/shared/sessionGroups';

/**
 * The title shown while a session has none, in the language of the webview. `EMPTY_TITLE` stays an
 * English key; this is the text that is drawn (same message as the host's `emptyTitle`). Written
 * twice because the catalog exporter does not read `src/shared` and a shared module may not import
 * `@vscode/l10n`; the shared message keeps the catalog to one entry.
 * VERIFIED by `SessionPicker.test.tsx` "shows the group titles and the row times in Spanish"
 * ("Sesión sin título" for a row with no title).
 */
export function emptyTitle(): string {
  return l10n.t('Untitled session');
}

/**
 * The title of a row, or {@link emptyTitle} when it has none or only blanks: `sessionLabel`, but
 * translated. A title the user or the model wrote is returned as is, never run through the catalog.
 * Duplicated in the host (`src/extension/sessionDisplay.ts`) for the reason given on
 * {@link emptyTitle}: the exporter does not read `src/shared`.
 */
export function displayLabel(row: Pick<SessionSummary, 'title'>): string {
  const title = row.title?.trim();
  return title === undefined || title === '' ? emptyTitle() : title;
}

/**
 * The title of a date group in the language of the webview. A {@link GroupLabel} stays an English
 * KEY (the picker groups and keeps DOM by it); only what is drawn goes through here. The four
 * messages are the same keys the host's `groupTitle` uses, so the catalog holds them once. They
 * are written in both places (not in `src/shared`) because the exporter does not read `src/shared`
 * and a shared module may not import `@vscode/l10n`; the exhaustive `switch` of each copy makes a
 * new {@link GroupLabel} variant fail `tsc` in both.
 * VERIFIED by `SessionPicker.test.tsx` "shows the group titles and the row times in Spanish" in
 * Spanish and by the English cases of that file in English.
 */
export function groupTitle(label: GroupLabel): string {
  switch (label) {
    case 'Today':
      return l10n.t('Today');
    case 'Yesterday':
      return l10n.t('Yesterday');
    case 'Previous 7 days':
      return l10n.t('Previous 7 days');
    case 'Older':
      return l10n.t('Older');
  }
}
