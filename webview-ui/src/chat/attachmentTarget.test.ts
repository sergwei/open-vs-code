// Protects the click on a chip: it must open the file the `uri` names, at the first line of its
// range, and never try to open a `data:` or a web URL. The range shape (`?start=16&end=18` kept in
// `source.uri`) is the one the planner's spike saw a real opencode 2.0.32 store (Windows 11,
// 22/10/2026); the URLs here are fabricated by hand.
import { describe, expect, it } from 'vitest';
import { attachmentTarget, openLabel } from './attachmentTarget';

describe('attachmentTarget', () => {
  it('returns the file URL as the path, with no line, for a plain file', () => {
    expect(attachmentTarget('file:///C:/ws/src/a.ts')).toEqual({ path: 'file:///C:/ws/src/a.ts' });
  });

  it('cuts the query and takes the start (and end) of the range', () => {
    expect(attachmentTarget('file:///C:/ws/src/a.ts?start=10&end=20')).toEqual({
      path: 'file:///C:/ws/src/a.ts',
      line: 10,
      endLine: 20,
    });
  });

  it('cuts a hash as well', () => {
    expect(attachmentTarget('file:///ws/a.ts?start=3&end=3#x')).toEqual({
      path: 'file:///ws/a.ts',
      line: 3,
      endLine: 3,
    });
    expect(attachmentTarget('file:///ws/a.ts#frag')).toEqual({ path: 'file:///ws/a.ts' });
  });

  it('ignores a range that is not a positive integer', () => {
    for (const query of ['start=0', 'start=-1', 'start=x', 'start=1.5', 'start=', 'end=4']) {
      expect(attachmentTarget(`file:///ws/a.ts?${query}`), query).toEqual({
        path: 'file:///ws/a.ts',
      });
    }
  });

  it('has no target for anything that is not a file URL', () => {
    expect(attachmentTarget(undefined)).toBeUndefined();
    expect(attachmentTarget('https://example.com/a.ts')).toBeUndefined();
    expect(attachmentTarget('data:text/plain;base64,AAAA')).toBeUndefined();
    expect(attachmentTarget('src/a.ts')).toBeUndefined();
  });

  it('accepts the scheme in any case', () => {
    expect(attachmentTarget('FILE:///ws/a.ts')?.path).toBe('FILE:///ws/a.ts');
  });
});

describe('openLabel', () => {
  it('names a plain file', () => {
    expect(openLabel('src/a.ts', { path: 'file:///ws/src/a.ts' })).toBe('Open src/a.ts');
  });

  it('replaces the #a-b suffix with words', () => {
    expect(openLabel('src/a.ts#10-20', { path: 'x', line: 10, endLine: 20 })).toBe(
      'Open src/a.ts, lines 10-20',
    );
    expect(openLabel('src/a.ts#4', { path: 'x', line: 4, endLine: 4 })).toBe(
      'Open src/a.ts, line 4',
    );
  });

  it('keeps a # that is part of the file name', () => {
    expect(openLabel('docs/a#1.md', { path: 'x', line: 2, endLine: 3 })).toBe(
      'Open docs/a#1.md, lines 2-3',
    );
  });
});
