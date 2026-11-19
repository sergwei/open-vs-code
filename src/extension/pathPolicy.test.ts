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
import { expandHome, hasImageExtension, resolveInsideFolder, toAttachmentName } from './pathPolicy';

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

// Issue #228: macOS users clicked `~/proj/src/a.ts` in the chat and got "does not exist", because
// the `~` was taken as a folder name inside the workspace. Fabricated paths (the user's real path
// was not shared); they pin which forms expand, and that expansion never widens the policy.
describe('expandHome', () => {
  const ana = () => '/Users/ana';

  it('expands a leading ~/ on posix and leaves every other form alone', () => {
    const p = path.posix;
    expect(expandHome('~/proj/src/a.ts', ana, p)).toBe('/Users/ana/proj/src/a.ts');
    expect(expandHome('~', ana, p)).toBe('~');
    expect(expandHome('~bob/a.ts', ana, p)).toBe('~bob/a.ts');
    expect(expandHome('a/~/b.ts', ana, p)).toBe('a/~/b.ts');
    expect(expandHome('./~/x.ts', ana, p)).toBe('./~/x.ts');
    expect(expandHome('src/a.ts', ana, p)).toBe('src/a.ts');
    expect(expandHome('~\\a.ts', ana, p)).toBe('~\\a.ts');
  });

  it('expands both ~/ and ~\\ on win32', () => {
    const w = path.win32;
    const home = () => 'C:\\Users\\ana';
    expect(expandHome('~\\proj\\a.ts', home, w)).toBe('C:\\Users\\ana\\proj\\a.ts');
    expect(expandHome('~/proj/a.ts', home, w)).toBe('C:\\Users\\ana\\proj\\a.ts');
  });

  // HYPOTHESIS (Node docs, not reproduced): os.homedir() throws with no HOME and no passwd entry.
  // Whatever it does, a plain path must not depend on it; the getter here is a fabricated stand-in.
  it('does not ask for the home folder unless the path starts with ~', () => {
    const throwing = () => {
      throw new Error('no home');
    };
    expect(expandHome('src/a.ts', throwing, path.posix)).toBe('src/a.ts');
    expect(() => expandHome('~/a.ts', throwing, path.posix)).toThrow('no home');
  });

  it('still goes through the folder policy: inside opens, outside stays refused', () => {
    const p = path.posix;
    const open = (raw: string) =>
      resolveInsideFolder('/Users/ana/proj', expandHome(raw, ana, p), p);
    expect(open('~/proj/src/a.ts')).toBe('/Users/ana/proj/src/a.ts');
    expect(open('~/.ssh/id_rsa')).toBeUndefined();
    expect(open('~/proj/../other/a.ts')).toBeUndefined();
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
