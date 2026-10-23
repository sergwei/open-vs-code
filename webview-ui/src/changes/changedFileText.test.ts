// Protects the words of the "Changed files" rows (issue #31): the status is a WORD (never only a
// colour), a binary says "Binary" and shows no counts, and the accessible name is one sentence that
// starts with the action and the path. Provenance: rows FABRICATED by hand from `ChangedFile`.
import { describe, expect, it } from 'vitest';
import type { ChangedFile } from '../../../src/shared/model';
import { changedFilesSummary, countsText, metaText, openName, statusWord } from './changedFileText';

const file = (extra: Partial<ChangedFile> = {}): ChangedFile => ({
  path: 'src/a.ts',
  status: 'modified',
  additions: 3,
  deletions: 1,
  binary: false,
  tooLarge: false,
  ...extra,
});

describe('changed file text', () => {
  it('writes the summary with the count', () => {
    expect(changedFilesSummary(4)).toBe('Changed files (4)');
  });

  it('says the status in words', () => {
    expect(statusWord(file({ status: 'added' }))).toBe('Added');
    expect(statusWord(file({ status: 'modified' }))).toBe('Modified');
    expect(statusWord(file({ status: 'deleted' }))).toBe('Deleted');
  });

  it('says Binary for a file with no text diff, whatever its status', () => {
    expect(statusWord(file({ status: 'deleted', binary: true }))).toBe('Binary');
  });

  // Pending item of #31, done in #32: a patch the server cut for size keeps its counts and says why
  // it cannot be opened as a diff. FABRICATED rows.
  it('says "Too large to diff" for a file whose patch was cut, and keeps its counts', () => {
    const large = file({ status: 'added', additions: 1200, deletions: 0, tooLarge: true });
    expect(statusWord(large)).toBe('Too large to diff');
    expect(countsText(large)).toBe('+1200 −0');
    expect(metaText(large)).toBe('Too large to diff · +1200 −0');
    expect(openName({ ...large, path: 'docs/big.txt' })).toBe(
      'Open docs/big.txt, Too large to diff, 1200 added, 0 deleted',
    );
  });

  it('writes the counts with a real minus sign, and none for a binary', () => {
    expect(countsText(file())).toBe('+3 −1');
    expect(countsText(file({ additions: 0, deletions: 0 }))).toBe('+0 −0');
    expect(countsText(file({ binary: true, additions: 0, deletions: 0 }))).toBe('');
  });

  it('writes the second line of a row', () => {
    expect(metaText(file())).toBe('Modified · +3 −1');
    expect(metaText(file({ status: 'added', binary: true }))).toBe('Binary');
  });

  it('builds the accessible name as one sentence', () => {
    expect(openName(file())).toBe('Open diff of src/a.ts, Modified, 3 added, 1 deleted');
    expect(
      openName(file({ path: 'src/b.ts', status: 'deleted', additions: 0, deletions: 12 })),
    ).toBe('Open diff of src/b.ts, Deleted, 0 added, 12 deleted');
    expect(openName(file({ path: 'logo.png', binary: true }))).toBe('Open logo.png, Binary');
  });
});
