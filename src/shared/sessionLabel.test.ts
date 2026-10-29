// Protects the text that names a session in lists and tab titles: no title and a blank title both
// read as `EMPTY_TITLE`. Provenance: fabricated rows, no server.
import { describe, expect, it } from 'vitest';
import { EMPTY_TITLE, sessionLabel } from './sessionLabel';

describe('sessionLabel', () => {
  it('returns the trimmed title', () => {
    expect(sessionLabel({ title: '  Fix the bug ' })).toBe('Fix the bug');
  });

  it('returns EMPTY_TITLE for a missing, empty or blank title', () => {
    expect(sessionLabel({})).toBe(EMPTY_TITLE);
    expect(sessionLabel({ title: '' })).toBe(EMPTY_TITLE);
    expect(sessionLabel({ title: '   ' })).toBe(EMPTY_TITLE);
  });
});
