// Localization helpers that both sides share (E11-i18n): the active language, plural choice,
// sentences with nodes inside and the shape of a bundle. No imports (`neutrality.test.ts`): the
// translation itself is `@vscode/l10n`, configured by each side's `l10nBoot.ts`; this file only
// holds what that library does not give.

/** One entry of a bundle: the translated text, or the `{ message, comment }` form of l10n-dev. */
export type L10nBundleEntry = string | { message: string; comment: string[] };

/** The contents of a `bundle.l10n.<id>.json`, as `vscode.l10n.bundle` returns it. */
export type L10nBundle = Record<string, L10nBundleEntry>;

/**
 * The language of this side. State per bundle on purpose: the host and the webview are separate
 * bundles, each with its own copy, set by its own `l10nBoot.ts`.
 */
let locale = 'en';

/** Sets the language ({@link plural} reads it); `vscode.env.language` on the host, `<html lang>` in the webview. */
export function setLocale(value: string): void {
  locale = value;
}

/** The language set by {@link setLocale}; `en` until then. */
export function currentLocale(): string {
  return locale;
}

/**
 * Picks the singular or the plural text of a phrase for `count`, following the CLDR rules of the
 * current language (`Intl.PluralRules`).
 *
 * Both texts are already translated: call it as
 * `plural(n, l10n.t('{0} request waiting', n), l10n.t('{0} requests waiting', n))`, so each form
 * is its own catalog key. Only `one` and `other` exist: a language with more forms (few and many
 * in Polish or Russian) would need a third text, and that is NOT built. A locale that `Intl`
 * rejects with a `RangeError` falls back to English rules instead of throwing.
 * VERIFIED by `l10n.test.ts`: count 1 gives the singular and 0, 2 and 1.5 the plural in `en`,
 * `es` and `gl`, and a malformed locale falls back to English.
 * HYPOTHESIS: the `many` category of Spanish for 1e6 falls in `other` here; it comes from reading
 * CLDR, no test fixes it.
 */
export function plural(count: number, one: string, other: string): string {
  let category: Intl.LDMLPluralRule;
  try {
    category = new Intl.PluralRules(locale).select(count);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    category = new Intl.PluralRules('en').select(count);
  }
  return category === 'one' ? one : other;
}

/**
 * Splits an already translated sentence at its `{name}` placeholders so a UI can put nodes
 * (a link, a code span) where the text has them.
 *
 * Returns the pieces in order: text stays a string and each placeholder is replaced by its value.
 * A `{name}` with no value is kept as literal text (a translator's typo shows instead of
 * vanishing). Adjacent text is not merged across a replacement. Empty strings are not emitted.
 * VERIFIED by `l10n.test.ts` (order kept when a translation moves a placeholder, repeated
 * placeholder, unknown name).
 */
export function formatParts<T>(template: string, values: Record<string, T>): Array<string | T> {
  const parts: Array<string | T> = [];
  const pattern = /\{(\w+)\}/g;
  let last = 0;
  for (const match of template.matchAll(pattern)) {
    const name = match[1];
    if (name === undefined || !Object.hasOwn(values, name)) continue;
    if (match.index > last) parts.push(template.slice(last, match.index));
    parts.push(values[name] as T);
    last = match.index + match[0].length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return parts;
}

/**
 * True when `value` is a plain object whose every entry is a string or a `{ message, comment }`
 * with a string message and an array of strings. The webview reads its bundle from a `<meta>`
 * that it must treat as untrusted input, so a malformed one makes it fall back to English.
 * VERIFIED by `l10n.test.ts` (accepts strings and the comment form; rejects null, arrays, numbers
 * and a bad entry).
 */
export function isL10nBundle(value: unknown): value is L10nBundle {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => {
    if (typeof entry === 'string') return true;
    if (typeof entry !== 'object' || entry === null) return false;
    const { message, comment } = entry as { message?: unknown; comment?: unknown };
    return (
      typeof message === 'string' &&
      Array.isArray(comment) &&
      comment.every((c) => typeof c === 'string')
    );
  });
}
