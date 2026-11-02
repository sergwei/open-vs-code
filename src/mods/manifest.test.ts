// Tests for `manifest.ts` (E10-mods, phase 1).
//
// What they protect: the rules that decide whether a folder is a mod at all (id shape, the single
// supported API version, an entry that stays inside the folder). A regression here lets a
// manifest point `main` at `../../x.js` or load a mod written for another API. All manifests are
// FABRICATED by hand from the plan (Engram #1765 section 3.5); no mod written by a real author
// has been parsed. The symlink escape cannot be seen here (the parser is lexical): it is covered
// in `modDiscovery.test.ts`.

import { describe, expect, it } from 'vitest';
import { parseManifest } from './manifest';

/** A valid manifest as JSON text, with `patch` applied on top (a `null`-free override). */
function manifest(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'hello-station',
    name: 'Hello Station',
    version: '0.1.0',
    apiVersion: 1,
    main: 'index.mjs',
    ...patch,
  });
}

describe('parseManifest', () => {
  it('accepts a complete manifest and defaults the name to the id', () => {
    const full = parseManifest(manifest({ description: 'says hello' }));
    expect(full).toEqual({
      ok: true,
      manifest: {
        id: 'hello-station',
        name: 'Hello Station',
        version: '0.1.0',
        apiVersion: 1,
        main: 'index.mjs',
        description: 'says hello',
      },
    });
    const noName = parseManifest(manifest({ name: undefined }));
    expect(noName.ok && noName.manifest.name).toBe('hello-station');
  });

  it.each(['A', '-a', 'a_b', '', 'x'.repeat(65), 'with space'])('rejects the id %j', (id) => {
    const result = parseManifest(manifest({ id }));
    expect(result.ok).toBe(false);
  });

  it('accepts a 64-character id', () => {
    expect(parseManifest(manifest({ id: 'a'.repeat(64) })).ok).toBe(true);
  });

  it('rejects another apiVersion with the sentence the user will read', () => {
    expect(parseManifest(manifest({ apiVersion: 2 }))).toEqual({
      ok: false,
      error: 'requires Station mod API v2; this version supports 1',
    });
    expect(parseManifest(manifest({ apiVersion: '1' })).ok).toBe(false);
  });

  it.each([
    ['../x.js', 'climbs out'],
    ['a/../../x.js', 'climbs out after normalizing'],
    ['..\\x.js', 'backslash climb'],
    ['/etc/x.js', 'POSIX absolute'],
    ['C:\\x\\y.js', 'drive path'],
    ['C:x.js', 'drive-relative'],
    ['\\\\server\\share\\x.js', 'UNC'],
    ['index.ts', 'wrong extension'],
    ['index', 'no extension'],
    ['', 'empty'],
    ['.', 'the folder itself'],
    ['a\0.js', 'NUL byte'],
  ])('rejects main %j (%s)', (main) => {
    expect(parseManifest(manifest({ main })).ok).toBe(false);
  });

  it('accepts nested relative entries and the three extensions, normalizing separators', () => {
    for (const main of ['lib/index.js', 'a\\b.cjs', './index.mjs', 'x/../y.js']) {
      expect(parseManifest(manifest({ main })).ok, main).toBe(true);
    }
    const nested = parseManifest(manifest({ main: 'a\\b.cjs' }));
    expect(nested.ok && nested.manifest.main).toBe('a/b.cjs');
  });

  it('rejects text that is not a JSON object and fields of the wrong type', () => {
    expect(parseManifest('{').ok).toBe(false);
    expect(parseManifest('[]').ok).toBe(false);
    expect(parseManifest('null').ok).toBe(false);
    expect(parseManifest(manifest({ version: 1 })).ok).toBe(false);
    expect(parseManifest(manifest({ name: '' })).ok).toBe(false);
    expect(parseManifest(manifest({ main: 3 })).ok).toBe(false);
    expect(parseManifest(manifest({ description: 'x'.repeat(301) })).ok).toBe(false);
  });
});
