import * as l10n from '@vscode/l10n';
import { afterEach, describe, expect, it } from 'vitest';
import { currentLocale, setLocale } from '../../src/shared/l10n';
import { bootL10n } from './l10nBoot';

/**
 * Guards the boot of the webview translations (E11-i18n P2=1). Fabricated documents: they prove
 * that a valid meta translates, and that a missing or broken one degrades to English instead of
 * throwing. They do NOT prove that the host writes the meta (`webviewHtml.test.ts`), nor that a real
 * VS Code in Spanish delivers it: no test runs in one (the Spanish window of `test:visual` was
 * removed on 04/11/2026). Importing the module also boots the jsdom `document` once, which is why
 * every test resets the library state afterwards.
 */

/** Builds a document with the given `lang` and, when `meta` is a string, the l10n meta. */
function documentWith(lang: string | undefined, meta: string | undefined): Document {
  const doc = document.implementation.createHTMLDocument('t');
  if (lang !== undefined) doc.documentElement.lang = lang;
  if (meta !== undefined) {
    const tag = doc.createElement('meta');
    tag.setAttribute('name', 'open-vs-code-l10n');
    tag.setAttribute('content', meta);
    doc.head.append(tag);
  }
  return doc;
}

afterEach(() => {
  l10n.config({ contents: {} });
  setLocale('en');
});

describe('bootL10n', () => {
  it('loads a valid meta and the lang', () => {
    const result = bootL10n(documentWith('es', JSON.stringify({ 'Hello {0}': 'Hola {0}' })));

    expect(result).toEqual({ locale: 'es', keys: 1 });
    expect(l10n.t('Hello {0}', 'Ana')).toBe('Hola Ana');
    expect(currentLocale()).toBe('es');
  });

  it('stays in English when the meta is absent', () => {
    const result = bootL10n(documentWith('en', undefined));

    expect(result).toEqual({ locale: 'en', keys: 0 });
    expect(l10n.t('Hello {0}', 'Ana')).toBe('Hello Ana');
  });

  it('uses English when there is no lang at all', () => {
    expect(bootL10n(documentWith(undefined, undefined)).locale).toBe('en');
  });

  it.each(['{not json', '[]', '{"a": 1}', '"text"', 'null'])(
    'ignores a malformed meta (%s) and keeps the lang',
    (meta) => {
      const result = bootL10n(documentWith('es', meta));

      expect(result).toEqual({ locale: 'es', keys: 0 });
      expect(l10n.t('Hello {0}', 'Ana')).toBe('Hello Ana');
    },
  );
});
