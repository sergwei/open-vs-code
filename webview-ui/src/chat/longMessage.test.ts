// Protects the border of the folding of long user messages (issue #105, decision P2=1: more than 12
// lines or more than 1000 characters). Windows messages arrive with CRLF, which must count as one
// line break, or a 12-line template would fold there and not on Linux.
//
// Provenance: FABRICATED texts built with `repeat`; no server involved.
import { describe, expect, it } from 'vitest';
import { FOLD_CHARS, FOLD_LINES, isLongUserText } from './longMessage';

const lines = (count: number, eol = '\n'): string => Array(count).fill('line').join(eol);

describe('isLongUserText', () => {
  it('does not fold up to 12 lines and folds from 13', () => {
    expect(isLongUserText(lines(FOLD_LINES))).toBe(false);
    expect(isLongUserText(lines(FOLD_LINES + 1))).toBe(true);
  });

  it('counts CRLF like LF', () => {
    expect(isLongUserText(lines(FOLD_LINES, '\r\n'))).toBe(false);
    expect(isLongUserText(lines(FOLD_LINES + 1, '\r\n'))).toBe(true);
  });

  it('does not fold up to 1000 characters on one line and folds from 1001', () => {
    expect(isLongUserText('a'.repeat(FOLD_CHARS))).toBe(false);
    expect(isLongUserText('a'.repeat(FOLD_CHARS + 1))).toBe(true);
  });

  it('does not fold an empty or a short text', () => {
    expect(isLongUserText('')).toBe(false);
    expect(isLongUserText('hello')).toBe(false);
  });
});
