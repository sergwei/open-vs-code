// Protects `readDrop`/`imagesOf` (issue #30). The transfers are plain objects shaped like the
// `resourceurls` string VS Code's Explorer sets (read in VS Code 1.105.0), not a captured drag.
import { describe, expect, it } from 'vitest';
import { hasDropPayload, imagesOf, readDrop } from './dropData';

const transfer = (types: string[], data: Record<string, string> = {}, files: File[] = []) => ({
  types,
  files,
  getData: (type: string) => data[type] ?? '',
});

describe('readDrop', () => {
  it('reads the JSON list of resourceurls', () => {
    expect(
      readDrop(transfer(['resourceurls'], { resourceurls: '["file:///a","file:///b"]' })),
    ).toEqual({ kind: 'uris', uris: ['file:///a', 'file:///b'] });
  });

  it('ignores invalid JSON and non-string entries, then falls back to files', () => {
    const file = new File(['x'], 'a.txt');
    expect(readDrop(transfer(['resourceurls', 'Files'], { resourceurls: 'nope' }, [file]))).toEqual(
      {
        kind: 'files',
        files: [file],
      },
    );
    expect(readDrop(transfer(['resourceurls'], { resourceurls: '[1,null,""]' }))).toEqual({
      kind: 'none',
    });
  });

  it('falls back to the VS Code uri-list and cuts to 32 items', () => {
    const list = Array.from({ length: 40 }, (_, i) => `file:///f${String(i)}`).join('\n');
    const result = readDrop(
      transfer(['application/vnd.code.uri-list'], { 'application/vnd.code.uri-list': list }),
    );
    expect(result.kind === 'uris' ? result.uris.length : -1).toBe(32);
  });

  it('says none for an empty transfer', () => {
    expect(readDrop(transfer([]))).toEqual({ kind: 'none' });
  });
});

describe('hasDropPayload and imagesOf', () => {
  it('accepts files and Explorer data but not plain text', () => {
    expect(hasDropPayload(['Files'])).toBe(true);
    expect(hasDropPayload(['ResourceURLs'])).toBe(true);
    expect(hasDropPayload(['text/plain'])).toBe(false);
  });

  it('keeps only file items that claim to be images', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    const items = [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'application/pdf', getAsFile: () => new File(['y'], 'a.pdf') },
      { kind: 'file', type: 'image/png', getAsFile: () => png },
    ];
    expect(imagesOf(items)).toEqual([png]);
  });
});
