// Test helper of E11-i18n: puts the REAL Spanish catalog of the host (`l10n/bundle.l10n.es.json`)
// in `@vscode/l10n`, the way `l10nBoot.ts` does with `vscode.l10n.bundle`, and takes it out again.
// Only tests import it (the exporter skips `test-fixtures/`).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setLocale } from '../../shared/l10n';
import { setHostBundle } from '../l10nEnglish';

/** The shipped Spanish catalog, read once from the file (not a copy of it written in a test). */
const SPANISH = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../l10n/bundle.l10n.es.json', import.meta.url)),
    'utf8',
  ),
) as Record<string, string>;

/**
 * Switches the host texts to Spanish: the shipped catalog for `l10n.t` and `es` for `plural`.
 * Call it in a `beforeEach` and pair it with {@link useEnglish} in an `afterEach`, or the catalog
 * leaks into the other tests of the file.
 */
export function useSpanish(): void {
  setHostBundle(SPANISH);
  setLocale('es');
}

/** Back to the English default: no catalog (the message is its own text) and `en` for `plural`. */
export function useEnglish(): void {
  setHostBundle({});
  setLocale('en');
}
