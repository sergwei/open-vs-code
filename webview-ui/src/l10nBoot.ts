// Loads the translations of the webview (E11-i18n). It MUST be the first import of `index.tsx`:
// modules evaluate in import order, so a module-level `l10n.t(...)` of App or SettingsApp already
// sees the bundle, and the first render comes out translated with no reactivity. The language and
// the bundle come from the host's HTML (`<html lang>` and `<meta name="open-vs-code-l10n">`,
// `src/extension/webviewHtml.ts`), not from a protocol message (decision P2=1): the language of
// VS Code cannot change while a window lives, so there is nothing to push later.

import * as l10n from '@vscode/l10n';
import { isL10nBundle, setLocale, type L10nBundle } from '../../src/shared/l10n';

/** What {@link bootL10n} ended up using. */
export interface L10nBootResult {
  /** The `<html lang>` of the document, `en` when it has none. */
  locale: string;
  /** Number of keys loaded; 0 means English (no meta, empty meta or a rejected one). */
  keys: number;
}

/**
 * Configures `@vscode/l10n` and the shared locale from the host's HTML.
 *
 * The meta is untrusted input, like any DOM content: it is parsed in a `try` and validated with
 * `isL10nBundle`; anything absent, unparseable or malformed leaves the bundle empty, so every
 * `l10n.t` returns its English message instead of the webview failing to start. Never throws.
 * VERIFIED by `l10nBoot.test.ts` (valid, absent and malformed meta, with the lang).
 */
export function bootL10n(doc: Document): L10nBootResult {
  const locale = doc.documentElement.lang || 'en';
  const raw = doc.querySelector('meta[name="open-vs-code-l10n"]')?.getAttribute('content');
  let bundle: L10nBundle = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isL10nBundle(parsed)) bundle = parsed;
    } catch {
      // malformed JSON: English
    }
  }
  l10n.config({ contents: bundle });
  setLocale(locale);
  return { locale, keys: Object.keys(bundle).length };
}

bootL10n(document);
