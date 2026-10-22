// Protects the rule that the host, not the webview, decides which `file://` URLs may be attached:
// a search result with mixed separators (the real Windows server mixes them), a directory, a
// traversal or an absolute path of another place must never become a chip, and an editor
// selection must carry its line range in the URL (`?start&end`) AND in the name (`#a-b`), the
// only place the model reads it.
//
// Provenance: the entry shapes (`src/shared\` for a directory, `webview-ui/src/chat/X.tsx` for a
// file, an empty list for an empty query) were seen in the planner spike against a real opencode
// 2.0.32 on Windows 11 (22/10/2026); the inputs here are hand-made copies of those shapes, run
// with `path.win32` and `path.posix` on every OS. They confirm the logic, not what a POSIX server
// returns. `selectionLines` cases are fabricated positions.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInServedFolder, selectionLines, toEditorRef, toSearchRefs } from './fileMentions';

describe('toSearchRefs (win32)', () => {
  const folder = 'C:\\ws';
  const w = path.win32;

  it('maps a file to a file URL and a slash-separated relative name', () => {
    expect(toSearchRefs(folder, [{ path: 'src/a.ts', type: 'file' }], w)).toEqual([
      { uri: 'file:///C:/ws/src/a.ts', name: 'src/a.ts' },
    ]);
  });

  it('normalises backslashes', () => {
    expect(toSearchRefs(folder, [{ path: 'src\\x.ts', type: 'file' }], w)).toEqual([
      { uri: 'file:///C:/ws/src/x.ts', name: 'src/x.ts' },
    ]);
  });

  it('drops directories, entries with a trailing separator and empty paths', () => {
    expect(
      toSearchRefs(
        folder,
        [
          { path: 'src/shared\\', type: 'directory' },
          { path: 'src/shared\\', type: 'file' },
          { path: 'src/shared/', type: 'file' },
          { path: '', type: 'file' },
        ],
        w,
      ),
    ).toEqual([]);
  });

  it('drops anything that resolves outside the folder', () => {
    expect(
      toSearchRefs(
        folder,
        [
          { path: '../evil.ts', type: 'file' },
          { path: '..\\..\\evil.ts', type: 'file' },
          { path: 'D:\\other\\x.ts', type: 'file' },
          { path: 'C:\\other\\x.ts', type: 'file' },
        ],
        w,
      ),
    ).toEqual([]);
  });

  it('encodes characters that would break a URL', () => {
    expect(toSearchRefs(folder, [{ path: 'docs/a b#1.md', type: 'file' }], w)).toEqual([
      { uri: 'file:///C:/ws/docs/a%20b%231.md', name: 'docs/a b#1.md' },
    ]);
  });

  it('keeps the server order and drops duplicated URLs', () => {
    const refs = toSearchRefs(
      folder,
      [
        { path: 'b.ts', type: 'file' },
        { path: 'a.ts', type: 'file' },
        { path: 'b.ts', type: 'file' },
      ],
      w,
    );
    expect(refs.map((ref) => ref.name)).toEqual(['b.ts', 'a.ts']);
  });
});

describe('toSearchRefs (posix)', () => {
  it('maps a file to a file URL', () => {
    expect(toSearchRefs('/ws', [{ path: 'src/a.ts', type: 'file' }], path.posix)).toEqual([
      { uri: 'file:///ws/src/a.ts', name: 'src/a.ts' },
    ]);
  });

  it('drops a traversal', () => {
    expect(toSearchRefs('/ws', [{ path: '../evil.ts', type: 'file' }], path.posix)).toEqual([]);
  });
});

describe('selectionLines', () => {
  it('converts 0-based positions to a 1-based inclusive range', () => {
    expect(selectionLines({ line: 2, character: 4 }, { line: 8, character: 1 })).toEqual({
      start: 3,
      end: 9,
    });
  });

  it('keeps one line for a selection inside it', () => {
    expect(selectionLines({ line: 4, character: 0 }, { line: 4, character: 9 })).toEqual({
      start: 5,
      end: 5,
    });
  });

  it('stops before a line the selection only touches at column 0', () => {
    expect(selectionLines({ line: 1, character: 0 }, { line: 3, character: 0 })).toEqual({
      start: 2,
      end: 3,
    });
  });
});

// Decision W2 of Sergio (22/10/2026): "Add selection" accepts only files inside the served folder,
// so the active editor's file of another place (an open `~/.ssh/config`, a `.env` of another
// project) never reaches the whitelist of `prompt.send`. Hand-made paths, both path flavours.
describe('isInServedFolder', () => {
  it('accepts a file inside the folder (win32 and posix)', () => {
    expect(isInServedFolder('C:\\ws', 'C:\\ws\\src\\a.ts', path.win32)).toBe(true);
    expect(isInServedFolder('/ws', '/ws/src/a.ts', path.posix)).toBe(true);
  });

  // VS Code's `fsPath` lowercases the drive letter (`c:\ws`) while the served folder may carry
  // `C:`; win32 relative() is case-insensitive, so the file is still inside.
  it('ignores the case of the drive letter', () => {
    expect(isInServedFolder('C:\\ws', 'c:\\ws\\a.ts', path.win32)).toBe(true);
  });

  it('refuses a file outside the folder, another drive and a traversal', () => {
    expect(isInServedFolder('C:\\ws', 'C:\\Users\\me\\.ssh\\config', path.win32)).toBe(false);
    expect(isInServedFolder('C:\\ws', 'D:\\ws\\a.ts', path.win32)).toBe(false);
    expect(isInServedFolder('C:\\ws', 'C:\\ws\\..\\other\\a.ts', path.win32)).toBe(false);
    expect(isInServedFolder('/ws', '/home/me/.ssh/config', path.posix)).toBe(false);
    expect(isInServedFolder('/ws', '/ws-other/a.ts', path.posix)).toBe(false);
  });

  it('refuses everything when no folder is served, and the folder itself', () => {
    expect(isInServedFolder(undefined, 'C:\\ws\\src\\a.ts', path.win32)).toBe(false);
    expect(isInServedFolder('C:\\ws', 'C:\\ws', path.win32)).toBe(false);
  });
});

describe('toEditorRef', () => {
  const w = path.win32;

  it('references the whole file like the Attach dialog does', () => {
    expect(toEditorRef('C:\\ws', 'C:\\ws\\src\\a.ts', undefined, w)).toEqual({
      uri: 'file:///C:/ws/src/a.ts',
      name: 'src/a.ts',
    });
  });

  it('puts the range in the URL query and at the end of the name', () => {
    expect(toEditorRef('C:\\ws', 'C:\\ws\\src\\a.ts', { start: 3, end: 9 }, w)).toEqual({
      uri: 'file:///C:/ws/src/a.ts?start=3&end=9',
      name: 'src/a.ts#3-9',
    });
  });

  it('names a one-line range with a single number', () => {
    expect(toEditorRef('C:\\ws', 'C:\\ws\\src\\a.ts', { start: 4, end: 4 }, w)).toEqual({
      uri: 'file:///C:/ws/src/a.ts?start=4&end=4',
      name: 'src/a.ts#4',
    });
  });

  it('falls back to the basename outside the folder or without a folder', () => {
    expect(toEditorRef('C:\\ws', 'D:\\other\\x.ts', undefined, w).name).toBe('x.ts');
    expect(toEditorRef(undefined, 'C:\\ws\\src\\a.ts', { start: 1, end: 2 }, w).name).toBe(
      'a.ts#1-2',
    );
  });

  it('encodes # and spaces in the path, so the range query stays the only query', () => {
    expect(toEditorRef('/ws', '/ws/a b#c.ts', { start: 1, end: 2 }, path.posix).uri).toBe(
      'file:///ws/a%20b%23c.ts?start=1&end=2',
    );
  });
});
