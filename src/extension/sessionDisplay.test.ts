// Protects the translated title of an untitled session (E11-i18n phase 4a): the host paints
// `Untitled session` in the language of VS Code, and a title somebody wrote is never run through
// the catalog. Provenance: literal rows; the Spanish text is read from `l10n/bundle.l10n.es.json`.
import { afterEach, describe, expect, it } from 'vitest';
import { displayLabel, emptyTitle } from './sessionDisplay';
import { useEnglish, useSpanish } from './test-fixtures/spanishCatalog';

describe('sessionDisplay', () => {
  afterEach(useEnglish);

  it('writes the empty title in Spanish with the Spanish catalog and in English with none', () => {
    expect(emptyTitle()).toBe('Untitled session');
    useSpanish();
    expect(emptyTitle()).toBe('Sesión sin título');
    expect(displayLabel({ title: '   ' })).toBe('Sesión sin título');
    expect(displayLabel({})).toBe('Sesión sin título');
    useEnglish();
    expect(displayLabel({})).toBe('Untitled session');
  });

  it('returns a real title as written, trimmed, whatever the language', () => {
    useSpanish();
    expect(displayLabel({ title: '  Today  ' })).toBe('Today');
  });
});
