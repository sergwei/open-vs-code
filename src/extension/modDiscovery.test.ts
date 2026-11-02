// Tests for `modDiscovery.ts` (E10-mods, phase 1).
//
// What they protect: that only the extension's own mods folder is read (decision P4: no project
// mods), that a broken mod is reported without hiding the others, and that an entry which
// `realpath`s outside its folder is refused (the check a lexical `main` parse cannot make).
// They use REAL temporary folders on disk, created and removed by each test; the manifests are
// hand-written from the plan (Engram #1765 section 3.5), not copied from a real author's mod.

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MODS_HOME_ENV, discoverMods, globalModsRoot } from './modDiscovery';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'ovsc-mods-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Writes `<root>/<folder>/mod.json` (patched over a valid one) and an `index.mjs`. */
async function makeMod(
  folder: string,
  patch: Record<string, unknown> = {},
  entry: string | null = 'index.mjs',
): Promise<string> {
  const dir = path.join(root, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'mod.json'),
    JSON.stringify({ id: folder, version: '1.0.0', apiVersion: 1, main: 'index.mjs', ...patch }),
  );
  if (entry !== null) await writeFile(path.join(dir, entry), 'export function activate() {}\n');
  return dir;
}

describe('globalModsRoot', () => {
  const home = path.join(path.sep, 'home', 'sergio');

  it('prefers OPEN_VS_CODE_MODS_HOME, then XDG_CONFIG_HOME, then ~/.config', () => {
    expect(globalModsRoot({ [MODS_HOME_ENV]: root, XDG_CONFIG_HOME: '/xdg' }, home)).toBe(
      path.resolve(root),
    );
    expect(globalModsRoot({ XDG_CONFIG_HOME: path.join(path.sep, 'xdg') }, home)).toBe(
      path.join(path.sep, 'xdg', 'opencode-station', 'mods'),
    );
    expect(globalModsRoot({}, home)).toBe(path.join(home, '.config', 'opencode-station', 'mods'));
  });

  it('treats empty variables as unset', () => {
    expect(globalModsRoot({ [MODS_HOME_ENV]: '', XDG_CONFIG_HOME: '' }, home)).toBe(
      path.join(home, '.config', 'opencode-station', 'mods'),
    );
  });
});

describe('discoverMods', () => {
  it('finds two valid mods in name order, with real paths', async () => {
    await makeMod('b-mod');
    await makeMod('a-mod');
    const result = await discoverMods(root);
    expect(result.problems).toEqual([]);
    expect(result.mods.map((m) => m.manifest.id)).toEqual(['a-mod', 'b-mod']);
    expect(path.basename(result.mods[0]?.entry ?? '')).toBe('index.mjs');
  });

  it('gives nothing, without an error, for a root that does not exist', async () => {
    expect(await discoverMods(path.join(root, 'nope'))).toEqual({
      root: path.join(root, 'nope'),
      mods: [],
      problems: [],
    });
  });

  it('skips dot-folders and plain files, and reports a folder without mod.json', async () => {
    await makeMod('.hidden');
    await writeFile(path.join(root, 'README.txt'), 'hi');
    await mkdir(path.join(root, 'empty'));
    const result = await discoverMods(root);
    expect(result.mods).toEqual([]);
    expect(result.problems).toEqual([{ folder: 'empty', reason: 'no mod.json in the folder' }]);
  });

  it('reports a bad manifest, a wrong apiVersion and a missing entry without hiding the good mod', async () => {
    await makeMod('good');
    await makeMod('v2', { apiVersion: 2 });
    await makeMod('no-entry', {}, null);
    await mkdir(path.join(root, 'bad-json'));
    await writeFile(path.join(root, 'bad-json', 'mod.json'), '{ not json');
    const result = await discoverMods(root);
    expect(result.mods.map((m) => m.manifest.id)).toEqual(['good']);
    const reasons = Object.fromEntries(result.problems.map((p) => [p.folder, p.reason]));
    expect(reasons['v2']).toBe('requires Station mod API v2; this version supports 1');
    expect(reasons['no-entry']).toContain('not found');
    expect(reasons['bad-json']).toBe('mod.json is not valid JSON');
  });

  it('refuses a second mod with the same id', async () => {
    await makeMod('one', { id: 'same' });
    await makeMod('two', { id: 'same' });
    const result = await discoverMods(root);
    expect(result.mods.map((m) => m.dir.endsWith('one'))).toEqual([true]);
    expect(result.problems).toEqual([
      { folder: 'two', reason: 'id "same" is already used by another mod' },
    ]);
  });

  it('refuses a main whose directory is the entry (not a file)', async () => {
    const dir = await makeMod('dir-main', { main: 'lib.js' });
    await mkdir(path.join(dir, 'lib.js'));
    const result = await discoverMods(root);
    expect(result.mods).toEqual([]);
    expect(result.problems[0]?.reason).toContain('not a file');
  });

  it('loads at most 20 mods and reports the rest', async () => {
    for (let i = 0; i < 22; i += 1) await makeMod(`m${String(i).padStart(2, '0')}`);
    const result = await discoverMods(root);
    expect(result.mods).toHaveLength(20);
    expect(result.problems.map((p) => p.folder)).toEqual(['m20', 'm21']);
  });

  it('refuses an entry that is a symlink pointing outside the mod folder', async (ctx) => {
    const outside = path.join(root, 'outside.mjs');
    await writeFile(outside, 'export function activate() {}\n');
    const dir = await makeMod('escape', {}, null);
    try {
      await symlink(outside, path.join(dir, 'index.mjs'), 'file');
    } catch {
      // Windows without the symlink privilege (or Developer Mode): cannot build the case here.
      ctx.skip();
    }
    const result = await discoverMods(root);
    expect(result.mods).toEqual([]);
    expect(result.problems).toEqual([
      { folder: 'escape', reason: 'entry file "index.mjs" resolves outside the mod folder' },
    ]);
  });
});
