// Protects the decision of what counts as a clickable file reference: enough to catch
// `src/a.ts:42`, not so much that `console.log`, a URL or a sentence become fake links.
//
// Provenance: hand-written strings (the shapes the plan names plus the false positives we want
// to avoid); NOT sampled from real model output.
import { describe, expect, it } from 'vitest';
import { parseFileRef } from './fileRefs';

describe('parseFileRef: accepts', () => {
  it.each([
    ['src/a.ts', { path: 'src/a.ts' }],
    ['src/a.ts:42', { path: 'src/a.ts', line: 42 }],
    ['src/a.ts:42:7', { path: 'src/a.ts', line: 42, column: 7 }],
    ['src/a.ts#L10', { path: 'src/a.ts', line: 10 }],
    ['src/a.ts#L10-L20', { path: 'src/a.ts', line: 10 }],
    ['./src/a.ts', { path: './src/a.ts' }],
    ['..\\x\\a.ts:3', { path: '..\\x\\a.ts', line: 3 }],
    ['C:\\ws\\a.ts:3', { path: 'C:\\ws\\a.ts', line: 3 }],
    ['README.md', { path: 'README.md' }],
    ['package.json:12', { path: 'package.json', line: 12 }],
    ['dir/file.unknownext', { path: 'dir/file.unknownext' }],
  ])('%s', (text, expected) => {
    expect(parseFileRef(text)).toEqual(expected);
  });

  it('drops a zero or unsafe position instead of keeping it', () => {
    expect(parseFileRef('src/a.ts:0')).toEqual({ path: 'src/a.ts' });
    expect(parseFileRef('src/a.ts:99999999999999999999')).toEqual({ path: 'src/a.ts' });
    expect(parseFileRef('src/a.ts:3:0')).toEqual({ path: 'src/a.ts', line: 3 });
  });
});

describe('parseFileRef: rejects', () => {
  it.each([
    'console.log',
    'e.g',
    'Foo.Bar',
    'v1.2.3',
    'https://example.com/a.ts',
    'file:///C:/a.ts',
    'src/extension',
    'src/',
    'src\\',
    'two words.ts',
    'a/b.ts\nrm -rf',
    'src/<a>.ts',
    'src/*.ts',
    '',
    '   ',
    '42',
    'and/or',
  ])('%j', (text) => {
    expect(parseFileRef(text)).toBeUndefined();
  });
});
