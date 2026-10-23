// Protects `classifyDropped` (issue #30) from trusting the dropped URIs. The inputs are hand-made
// in the shapes VS Code writes in `resourceurls` (`URI.toString()`, read in VS Code 1.105.0), not
// captured from a real drag: the drop does not reach webviews in the stable 1.143 (#339036).

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyDropped } from './droppedFiles';

describe('classifyDropped', () => {
  it('maps the VS Code drive form and the plain one to the same path', () => {
    const result = classifyDropped(
      'C:\\ws',
      ['file:///c%3A/ws/src/a.ts', 'file:///C:/ws/src/a.ts'],
      path.win32,
    );
    expect(result.candidates.map((c) => c.absolute)).toEqual(['c:\\ws\\src\\a.ts']);
    expect(result.candidates[0]?.ref.name).toBe('src/a.ts');
    expect(result.candidates[0]?.ref.uri).toMatch(/^file:\/\/\/c:\/ws\/src\/a\.ts$/i);
  });

  it('reads POSIX paths, spaces and a hash', () => {
    const result = classifyDropped('/ws', ['file:///ws/a%20b/c%23d.ts'], path.posix);
    expect(result.candidates[0]?.absolute).toBe('/ws/a b/c#d.ts');
    expect(result.candidates[0]?.ref.name).toBe('a b/c#d.ts');
  });

  it('counts other schemes and garbage as remote', () => {
    const result = classifyDropped(
      '/ws',
      ['vscode-remote://ssh/ws/a.ts', 'nonsense', 'untitled:x'],
      path.posix,
    );
    expect(result).toEqual({ candidates: [], outside: 0, remote: 3 });
  });

  it('counts files outside the folder, the folder itself and .. escapes as outside', () => {
    const result = classifyDropped(
      '/ws',
      ['file:///etc/passwd', 'file:///ws', 'file:///ws/../etc/x', 'file:///ws/ok.ts'],
      path.posix,
    );
    expect(result.outside).toBe(3);
    expect(result.candidates.map((c) => c.ref.name)).toEqual(['ok.ts']);
  });
});
