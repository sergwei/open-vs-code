// Protects the pure text helpers of the tool cards (issue #26): the unified-patch parser behind the
// mini diff, the head/tail clipping that keeps a card from building thousands of nodes, ANSI
// stripping and path basenames on Windows and POSIX.
//
// Provenance: FABRICATED strings. The patch shape (`Index:`, `====`, `---`, `+++`, `@@` hunks, CRLF
// lines) is what `createTwoFilesPatch` writes according to `edit.ts@843a6c51`, read, not observed
// from a real edit by this file; the real shape is what `test:visual` step 15 saw (see the header of
// `test/visual/run.mjs`). These tests confirm OUR parser, not the contract with the server.
import { describe, expect, it } from 'vitest';
import {
  allAdded,
  basename,
  clampLines,
  clipText,
  parsePatch,
  replacement,
  stripAnsi,
} from './patchLines';

const HEADERS = [
  'Index: src/a.ts',
  '===================================================================',
  '--- src/a.ts',
  '+++ src/a.ts',
].join('\n');

describe('parsePatch', () => {
  it('drops the four headers and classifies the lines', () => {
    const patch = `${HEADERS}\n@@ -1,3 +1,3 @@\n keep\n-old\n+new\n tail\n`;
    expect(parsePatch(patch)).toEqual([
      { kind: 'hunk', text: '@@ -1,3 +1,3 @@' },
      { kind: 'ctx', text: 'keep' },
      { kind: 'del', text: 'old' },
      { kind: 'add', text: 'new' },
      { kind: 'ctx', text: 'tail' },
    ]);
  });

  it('removes the \\r that a CRLF file leaves and the no-newline marker', () => {
    const patch = `${HEADERS}\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n\\ No newline at end of file\r\n`;
    expect(parsePatch(patch)).toEqual([
      { kind: 'hunk', text: '@@ -1 +1 @@' },
      { kind: 'del', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
  });

  it('keeps a deleted line that starts with "-- " once inside a hunk', () => {
    const patch = `${HEADERS}\n@@ -1 +1 @@\n--- not a header\n+++ nor this\n`;
    expect(parsePatch(patch).map((line) => line.kind)).toEqual(['hunk', 'del', 'add']);
  });

  it('classifies a patch with no headers and no hunk marker by the first character', () => {
    expect(parsePatch('-x\n+y\n z')).toEqual([
      { kind: 'del', text: 'x' },
      { kind: 'add', text: 'y' },
      { kind: 'ctx', text: 'z' },
    ]);
  });

  it('returns nothing for an empty patch or one with only headers', () => {
    expect(parsePatch('')).toEqual([]);
    expect(parsePatch(HEADERS)).toEqual([]);
  });
});

describe('allAdded and replacement', () => {
  it('turns a file into added lines without the empty line after the last newline', () => {
    expect(allAdded('a\r\nb\n')).toEqual([
      { kind: 'add', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
  });

  it('shows old then new with no alignment', () => {
    expect(replacement('a\nb', 'c')).toEqual([
      { kind: 'del', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'c' },
    ]);
  });

  it('shows only additions when the old text is empty', () => {
    expect(replacement('', 'x')).toEqual([{ kind: 'add', text: 'x' }]);
  });
});

describe('clampLines', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('keeps the head', () => {
    expect(clampLines(items, 2, 'head')).toEqual({ items: ['a', 'b'], hidden: 3 });
  });

  it('keeps the tail', () => {
    expect(clampLines(items, 2, 'tail')).toEqual({ items: ['d', 'e'], hidden: 3 });
  });

  it('hides nothing when it fits, and never keeps fewer than one', () => {
    expect(clampLines(items, 9, 'head').hidden).toBe(0);
    expect(clampLines(items, 0, 'head').items).toEqual(['a']);
  });
});

describe('clipText', () => {
  it('reports total and hidden lines, from the tail for a shell', () => {
    const clipped = clipText('1\n2\n3\n4\n5\n', 2, 1000, 'tail');
    expect(clipped).toEqual({ lines: ['4', '5'], total: 5, hidden: 3, truncatedLine: false });
  });

  it('cuts one very long line at the character budget and says so', () => {
    const clipped = clipText('x'.repeat(50), 10, 8, 'head');
    expect(clipped.lines).toEqual(['xxxxxxxx']);
    expect(clipped.truncatedLine).toBe(true);
  });

  it('keeps the end of a long last line when clipping from the tail', () => {
    const clipped = clipText(`first\n${'a'.repeat(5)}END`, 10, 6, 'tail');
    expect(clipped.lines).toEqual(['aaaEND']);
    expect(clipped.hidden).toBe(1);
  });

  it('does not count the newline at the end as a line', () => {
    expect(clipText('a\nb\n', 10, 100, 'head').total).toBe(2);
  });
});

describe('stripAnsi and basename', () => {
  it('removes colour and cursor sequences and keeps the text', () => {
    const esc = String.fromCharCode(0x1b);
    expect(stripAnsi(`${esc}[31mred${esc}[0m ${esc}[2K${esc}[1;32mok${esc}[m`)).toBe('red ok');
  });

  it('takes the last segment of Windows and POSIX paths', () => {
    expect(basename('C:\\work\\src\\a.ts')).toBe('a.ts');
    expect(basename('/work/src/a.ts')).toBe('a.ts');
    expect(basename('src/dir/')).toBe('dir');
    expect(basename('a.ts')).toBe('a.ts');
  });
});
