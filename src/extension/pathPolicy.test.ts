// Protects the rule that the host opens only files inside the folder the server serves, even when
// the model (via the untrusted webview) asks for `..\..\x`, another drive, a UNC share or a path
// that merely shares a prefix (`/wsx` vs `/ws`). Both flavours run on every OS through the
// injected `path.win32` / `path.posix`.
//
// Provenance: FABRICATED inputs written by hand from the traversal cases of the plan
// (`E2-mvp-prototype/plan-fase2` §6). They confirm the logic, not behaviour on a real file
// system (symlinks are not resolved by design).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasImageExtension, resolveInsideFolder, toAttachmentName } from './pathPolicy';

// E2 (issue #85, decision P11). Fabricated names: they pin the extension list and the case rule.
describe('hasImageExtension', () => {
  it('accepts png, jpg, jpeg, gif and webp in any case', () => {
    for (const name of ['a.png', 'C:\\x\\B.JPG', '/x/c.jpeg', 'd.Gif', 'e.webp']) {
      expect(hasImageExtension(name), name).toBe(true);
    }
  });

  it('rejects other types, no extension, and an image name as a mere suffix', () => {
    for (const name of ['a.bmp', 'a.avif', 'a.svg', 'a.png.txt', 'png', '', 'a.']) {
      expect(hasImageExtension(name), name).toBe(false);
    }
  });
});

describe('resolveInsideFolder (win32)', () => {
  const folder = 'C:\\ws';
  const w = path.win32;

  it('accepts a relative path inside the folder', () => {
    expect(resolveInsideFolder(folder, 'src\\a.ts', w)).toBe('C:\\ws\\src\\a.ts');
    expect(resolveInsideFolder(folder, 'src/a.ts', w)).toBe('C:\\ws\\src\\a.ts');
  });

  it('rejects a path that climbs out of the folder', () => {
    expect(resolveInsideFolder(folder, '..\\..\\x', w)).toBeUndefined();
    expect(resolveInsideFolder(folder, 'src\\..\\..\\x', w)).toBeUndefined();
  });

  it('accepts a dotted file name that is not a parent reference', () => {
    expect(resolveInsideFolder(folder, '..hidden', w)).toBe('C:\\ws\\..hidden');
  });

  it('rejects an absolute path on another drive or outside the folder', () => {
    expect(resolveInsideFolder(folder, 'D:\\ws\\x', w)).toBeUndefined();
    expect(resolveInsideFolder(folder, 'C:\\other\\x', w)).toBeUndefined();
    expect(resolveInsideFolder(folder, 'C:\\wsx\\a', w)).toBeUndefined();
  });

  it('is case-insensitive like the Windows file system', () => {
    expect(resolveInsideFolder(folder, 'c:\\WS\\x', w)).toBe('c:\\WS\\x');
  });

  it('accepts a file: URL inside the folder and rejects one outside', () => {
    expect(resolveInsideFolder(folder, 'file:///C:/ws/a.ts', w)).toBe('C:\\ws\\a.ts');
    expect(resolveInsideFolder(folder, 'file:///C:/other/a.ts', w)).toBeUndefined();
  });

  it('rejects a UNC path', () => {
    expect(resolveInsideFolder(folder, '\\\\server\\share\\x', w)).toBeUndefined();
  });

  it('rejects the folder itself, empty text and NUL bytes', () => {
    expect(resolveInsideFolder(folder, '.', w)).toBeUndefined();
    expect(resolveInsideFolder(folder, '', w)).toBeUndefined();
    expect(resolveInsideFolder(folder, 'a\0b', w)).toBeUndefined();
  });
});

describe('resolveInsideFolder (posix)', () => {
  const folder = '/ws';
  const p = path.posix;

  it('accepts relative and absolute paths inside the folder', () => {
    expect(resolveInsideFolder(folder, 'src/a.ts', p)).toBe('/ws/src/a.ts');
    expect(resolveInsideFolder(folder, '/ws/a', p)).toBe('/ws/a');
    expect(resolveInsideFolder(folder, 'file:///ws/a.ts', p)).toBe('/ws/a.ts');
  });

  it('rejects traversal and a misleading shared prefix', () => {
    expect(resolveInsideFolder(folder, '/ws/../etc/passwd', p)).toBeUndefined();
    expect(resolveInsideFolder(folder, '../etc/passwd', p)).toBeUndefined();
    expect(resolveInsideFolder(folder, '/wsx/a', p)).toBeUndefined();
    expect(resolveInsideFolder(folder, 'file:///etc/passwd', p)).toBeUndefined();
  });
});

describe('toAttachmentName', () => {
  it('uses forward slashes for a file inside the folder (win32)', () => {
    expect(toAttachmentName('C:\\ws', 'C:\\ws\\src\\a.ts', path.win32)).toBe('src/a.ts');
  });

  it('falls back to the basename for a file outside the folder', () => {
    expect(toAttachmentName('C:\\ws', 'D:\\docs\\notes.md', path.win32)).toBe('notes.md');
    expect(toAttachmentName('/ws', '/home/u/notes.md', path.posix)).toBe('notes.md');
  });
});
