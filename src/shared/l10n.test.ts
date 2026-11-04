import { afterEach, describe, expect, it } from 'vitest';
import { currentLocale, formatParts, isL10nBundle, plural, setLocale } from './l10n';

/**
 * Guards the helpers of E11-i18n that both bundles share. Fabricated input throughout: what they
 * protect is the choice of the singular/plural text, the order of the pieces of a translated
 * sentence and the validation of the bundle the webview reads from its HTML. Whether a real VS
 * Code in Spanish picks the same forms is NOT covered: no test runs in a Spanish VS Code (the
 * integration label and the `test:visual` step that did were removed on 04/11/2026).
 */

afterEach(() => {
  setLocale('en');
});

describe('plural', () => {
  it.each(['en', 'es', 'gl'])('uses the singular only for 1 in %s', (language) => {
    setLocale(language);
    expect(plural(1, 'one', 'other')).toBe('one');
    expect(plural(0, 'one', 'other')).toBe('other');
    expect(plural(2, 'one', 'other')).toBe('other');
    expect(plural(1.5, 'one', 'other')).toBe('other');
  });

  it('falls back to English rules when Intl rejects the locale', () => {
    setLocale('not a locale!');
    expect(plural(1, 'one', 'other')).toBe('one');
    expect(plural(3, 'one', 'other')).toBe('other');
  });

  it('starts in English and remembers the locale it was given', () => {
    expect(currentLocale()).toBe('en');
    setLocale('es');
    expect(currentLocale()).toBe('es');
  });
});

describe('formatParts', () => {
  it('replaces each placeholder and keeps the text around it', () => {
    expect(formatParts('Open {file} now', { file: 'F' })).toEqual(['Open ', 'F', ' now']);
  });

  it('follows the order of the translation, not the order of the values', () => {
    expect(formatParts('{b} antes que {a}', { a: 'A', b: 'B' })).toEqual(['B', ' antes que ', 'A']);
  });

  it('repeats a placeholder that appears twice and does not emit empty strings', () => {
    expect(formatParts('{x}{x}', { x: 1 })).toEqual([1, 1]);
  });

  it('keeps an unknown placeholder as text', () => {
    expect(formatParts('Hi {who}', {})).toEqual(['Hi {who}']);
  });
});

describe('isL10nBundle', () => {
  it('accepts strings and the message/comment form', () => {
    expect(isL10nBundle({})).toBe(true);
    expect(isL10nBundle({ a: 'b', c: { message: 'd', comment: ['e'] } })).toBe(true);
  });

  it.each([null, undefined, 'x', 3, [], { a: 1 }, { a: null }, { a: { message: 'x' } }])(
    'rejects %j',
    (value) => {
      expect(isL10nBundle(value)).toBe(false);
    },
  );

  it('rejects a comment that is not an array of strings', () => {
    expect(isL10nBundle({ a: { message: 'x', comment: [1] } })).toBe(false);
  });
});
