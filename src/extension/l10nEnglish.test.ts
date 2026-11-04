// Tests for `l10nEnglish.ts` (E11-i18n, fixes of the review of pass 1): the English twin of a
// translated text, for the log. Provenance: SYNTHETIC; the Spanish text is read from the shipped
// `l10n/bundle.l10n.es.json` through `useSpanish`, not written here.

import * as l10n from '@vscode/l10n';
import { afterEach, describe, expect, it } from 'vitest';
import { bothTexts, inEnglish, logErrorOf, logMessageOf, translatedError } from './l10nEnglish';
import { ServerStartError } from './opencodeServer';
import { useEnglish, useSpanish } from './test-fixtures/spanishCatalog';

afterEach(useEnglish);

describe('inEnglish', () => {
  it('gives the English text and puts the Spanish catalog back', () => {
    useSpanish();
    const spanish = l10n.t('Retry');
    expect(spanish).toBe('Reintentar');
    expect(inEnglish(() => l10n.t('Retry'))).toBe('Retry');
    expect(l10n.t('Retry')).toBe('Reintentar');
  });

  it('puts the catalog back when the producer throws', () => {
    useSpanish();
    expect(() =>
      inEnglish(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(l10n.t('Retry')).toBe('Reintentar');
  });

  // Protects the pass-2 review (S1): a nested call used to restore the catalog in the middle of
  // the outer producer, so the rest of it came out in Spanish.
  it('keeps English through a nested call', () => {
    useSpanish();
    const texts = inEnglish(() => [
      l10n.t('Retry'),
      inEnglish(() => l10n.t('Retry')),
      l10n.t('Retry'),
    ]);
    expect(texts).toEqual(['Retry', 'Retry', 'Retry']);
    expect(l10n.t('Retry')).toBe('Reintentar');
  });
});

describe('translatedError', () => {
  it('keeps the English twin of a translated error out of its keys', () => {
    useSpanish();
    const error = translatedError(() => l10n.t('Retry'), 'Code');
    expect(error.name).toBe('Code');
    expect(error.message).toBe('Reintentar');
    expect(logMessageOf(error)).toBe('Retry');
    expect(Object.keys(error)).not.toContain('logMessage');
    expect(JSON.stringify({ ...error })).not.toContain('Retry');
  });

  it('writes a thrown translated error in English', () => {
    useSpanish();
    expect(logErrorOf(translatedError(() => l10n.t('Retry'), 'Code'))).toBe('Code: Retry');
    expect(logErrorOf(new Error('plain'))).toBe('Error: plain');
    expect(logErrorOf('text')).toBe('text');
  });
});

describe('bothTexts', () => {
  it('evaluates the producer in the language of VS Code and in English', () => {
    useSpanish();
    expect(bothTexts(() => l10n.t('Retry'))).toEqual({
      message: 'Reintentar',
      logMessage: 'Retry',
    });
  });
});

describe('logMessageOf', () => {
  it('prefers the logMessage of an error', () => {
    expect(logMessageOf(new ServerStartError('aborted', 'cancelado', 'cancelled'))).toBe(
      'cancelled',
    );
    expect(logMessageOf(new Error('plain'))).toBe('plain');
    expect(logMessageOf('text')).toBe('text');
  });
});
