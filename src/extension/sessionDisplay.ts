// How the host writes a session in its own surfaces (tree rows, editor-tab titles): the shared
// `sessionLabel` keeps `EMPTY_TITLE` as a stable KEY and the host translates it here, where it is
// shown (decision of the E11-i18n plan, section 5 "Compartido"). PURE: no `vscode` import.

import * as l10n from '@vscode/l10n';
import type { SessionSummary } from '../shared/model';

/**
 * The title shown while a session has none, in the language of the host.
 *
 * The English text is the same as `EMPTY_TITLE` in `src/shared/sessionLabel.ts`; a function and not
 * a constant, so the language configured after the import is honoured. Written twice (here and in
 * `webview-ui/src/sessions/sessionGroups.ts`) because the catalog exporter does not read
 * `src/shared` and a shared module may not import `@vscode/l10n`; both use the same message, so the
 * catalog holds it once.
 * VERIFIED by `sessionDisplay.test.ts` "writes the empty title in Spanish with the Spanish catalog
 * and in English with none": the same call returns `Sesión sin título` or `Untitled session`.
 */
export function emptyTitle(): string {
  return l10n.t('Untitled session');
}

/**
 * The title of a row, or {@link emptyTitle} when it has none or only blanks. Same rule as
 * `sessionLabel` in `src/shared`, but translated: a title the user or the model wrote is returned
 * as is, never run through the catalog. Duplicated in the webview for the reason given on
 * {@link emptyTitle}: the exporter does not read `src/shared`.
 */
export function displayLabel(row: Pick<SessionSummary, 'title'>): string {
  const title = row.title?.trim();
  return title === undefined || title === '' ? emptyTitle() : title;
}
