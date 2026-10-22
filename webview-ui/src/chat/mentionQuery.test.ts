// Protects the text rules of the @ mentions (issue #28, decision Q1 of Sergio): the popup opens
// only for an `@` that starts a word (never for `user@host`), picking a result writes `@path` and
// leaves the caret after it, and the offsets sent with the files (`mention`) point at the exact
// text that goes out, whatever the user edited after picking.
//
// Provenance: FABRICATED texts, written by hand from the cases of the plan (Engram #1059 §7). They
// confirm the logic; how it feels in a real textarea is `test:visual` step 16.
import { describe, expect, it } from 'vitest';
import { MAX_FILE_SEARCH_LENGTH } from '../../../src/shared/protocol';
import { applyMention, findMention, mentionsFor } from './mentionQuery';

describe('findMention', () => {
  it('finds an @ at the start of the text', () => {
    expect(findMention('@que', 4)).toEqual({ start: 0, end: 4, query: 'que' });
  });

  it('finds an @ after a space and after a line break', () => {
    expect(findMention('read @src/a', 11)).toEqual({ start: 5, end: 11, query: 'src/a' });
    expect(findMention('line\n@a', 7)).toEqual({ start: 5, end: 7, query: 'a' });
  });

  it('answers an empty query for a bare @', () => {
    expect(findMention('see @', 5)).toEqual({ start: 4, end: 5, query: '' });
  });

  it('does not open for an @ inside a word (an e-mail address)', () => {
    expect(findMention('mail me a@b', 11)).toBeUndefined();
    expect(findMention('a@b', 3)).toBeUndefined();
  });

  it('reads only up to the caret but replaces the whole word', () => {
    expect(findMention('@src/shared/model.ts rest', 5)).toEqual({
      start: 0,
      end: 20,
      query: 'src/',
    });
  });

  it('is closed once the caret is past a space', () => {
    expect(findMention('@src/a done', 11)).toBeUndefined();
    expect(findMention('@src/a ', 7)).toBeUndefined();
  });

  it('takes the last @ of the word as the decider', () => {
    expect(findMention('@a@b', 4)).toBeUndefined();
  });

  it('refuses a query longer than the protocol cap', () => {
    const long = '@'.concat('x'.repeat(MAX_FILE_SEARCH_LENGTH + 1));
    expect(findMention(long, long.length)).toBeUndefined();
    const fits = '@'.concat('x'.repeat(MAX_FILE_SEARCH_LENGTH));
    expect(findMention(fits, fits.length)?.query).toHaveLength(MAX_FILE_SEARCH_LENGTH);
  });

  it('is closed with the caret at 0 or outside the text', () => {
    expect(findMention('@a', 0)).toBeUndefined();
    expect(findMention('@a', 5)).toBeUndefined();
    expect(findMention('', 0)).toBeUndefined();
  });
});

describe('applyMention', () => {
  it('writes @name, a space and puts the caret after it', () => {
    const token = findMention('read @sa', 8);
    expect(token).toBeDefined();
    if (token === undefined) return;
    expect(applyMention('read @sa', token, 'src/sample.ts')).toEqual({
      text: 'read @src/sample.ts ',
      caret: 20,
    });
  });

  it('adds no second space when whitespace already follows', () => {
    const token = findMention('read @sa tail', 8);
    if (token === undefined) throw new Error('no token');
    expect(applyMention('read @sa tail', token, 'a.ts')).toEqual({
      text: 'read @a.ts tail',
      caret: 11,
    });
  });

  it('replaces the tail of the word when the caret was in the middle of it', () => {
    const token = findMention('@sr/old.ts end', 3);
    if (token === undefined) throw new Error('no token');
    expect(applyMention('@sr/old.ts end', token, 'src/new.ts').text).toBe('@src/new.ts end');
  });
});

describe('mentionsFor', () => {
  const file = (name: string) => ({ uri: `file:///ws/${name}`, name });

  it('gives each file the offsets of its @name in the exact text', () => {
    const text = 'compare @src/a.ts with @src/b.ts please';
    const [first, second] = mentionsFor(text, [file('src/a.ts'), file('src/b.ts')]);
    expect(first?.mention).toEqual({ start: 8, end: 17, text: '@src/a.ts' });
    expect(second?.mention).toEqual({ start: 23, end: 32, text: '@src/b.ts' });
    for (const ref of [first, second]) {
      const mention = ref?.mention;
      expect(text.slice(mention?.start, mention?.end)).toBe(mention?.text);
    }
  });

  // Chip and text are independent (Q1): deleting the text must leave the file attached, only
  // without a mention.
  it('sends the file without a mention when its @name is not in the text', () => {
    expect(mentionsFor('no mention here', [file('src/a.ts')])).toEqual([file('src/a.ts')]);
  });

  it('ignores an @name that is not a whole word', () => {
    expect(mentionsFor('x@src/a.ts', [file('src/a.ts')])).toEqual([file('src/a.ts')]);
    expect(mentionsFor('@src/a.ts.bak', [file('src/a.ts')])).toEqual([file('src/a.ts')]);
  });

  it('accepts closing punctuation and a final dot after the name, but not an opening paren before', () => {
    expect(mentionsFor('(@src/a.ts)', [file('src/a.ts')])[0]?.mention).toBeUndefined();
    expect(mentionsFor('see @src/a.ts, ok', [file('src/a.ts')])[0]?.mention).toEqual({
      start: 4,
      end: 13,
      text: '@src/a.ts',
    });
    expect(mentionsFor('read @src/a.ts.', [file('src/a.ts')])[0]?.mention?.end).toBe(14);
  });

  it('does not let two files claim the same text', () => {
    const [first, second] = mentionsFor('@a.ts', [file('a.ts'), file('a.ts')]);
    expect(first?.mention).toEqual({ start: 0, end: 5, text: '@a.ts' });
    expect(second?.mention).toBeUndefined();
  });

  it('skips an occurrence inside another word and finds the later one', () => {
    const text = 'x@a.ts then @a.ts';
    expect(mentionsFor(text, [file('a.ts')])[0]?.mention).toEqual({
      start: 12,
      end: 17,
      text: '@a.ts',
    });
  });

  it('finds a ranged name made by Add selection when the user typed it', () => {
    expect(mentionsFor('look at @src/a.ts#2-3', [file('src/a.ts#2-3')])[0]?.mention?.text).toBe(
      '@src/a.ts#2-3',
    );
  });
});
