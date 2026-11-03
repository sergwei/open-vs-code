// Tests of the plugin detection of issue #153 against REAL temporary folders (no mocks of `fs`).
// What they protect: the rules copied from opencode v2.0.32 (see the header of
// `projectPlugins.ts`). The expectations come from reading that code, not from a run of a real
// opencode, so they pin our replica and say nothing about what opencode loads.

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  folderKey,
  pluginFingerprint,
  scanProjectPlugins,
  type PluginFinding,
} from './projectPlugins';

let root: string;
let folder: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'ovc-plugins-'));
  folder = path.join(root, 'work', 'repo');
  await mkdir(folder, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(file: string, content = ''): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

/** The findings that live under the temporary root (a stray config in `~` would add others). */
async function scanUnderRoot(dir: string): Promise<PluginFinding[]> {
  const { findings } = await scanProjectPlugins(dir);
  return findings.filter((f) => (f.kind === 'file' ? f.path : f.config).startsWith(root));
}

function declared(findings: PluginFinding[]): string[] {
  return findings.flatMap((f) => (f.kind === 'declared' ? [f.spec] : [])).sort();
}

describe('scanProjectPlugins', () => {
  it('finds nothing in an empty folder', async () => {
    expect(await scanUnderRoot(folder)).toEqual([]);
  });

  it('counts plugin/ and plugins/ files and directories, and only exact .ts/.js names', async () => {
    const dot = path.join(folder, '.opencode');
    await put(path.join(dot, 'plugins', 'a.js'));
    await put(path.join(dot, 'plugin', 'b.ts'));
    await mkdir(path.join(dot, 'plugins', 'pkg'), { recursive: true });
    // Ignored (source-directory.ts L23: the check is a case-sensitive suffix of .ts / .js).
    await put(path.join(dot, 'plugins', 'readme.md'));
    await put(path.join(dot, 'plugins', 'x.mjs'));
    await put(path.join(dot, 'plugins', 'X.JS'));
    const found = await scanUnderRoot(folder);
    // Sorted by path, so `plugin/` comes before `plugins/`.
    expect(found.map((f) => (f.kind === 'file' ? path.basename(f.path) : ''))).toEqual([
      'b.ts',
      'a.js',
      'pkg',
    ]);
    expect(found.every((f) => f.inside)).toBe(true);
  });

  it('finds the plugins of an ancestor and marks them as outside the folder', async () => {
    await put(path.join(root, 'work', '.opencode', 'plugins', 'shared.js'));
    const found = await scanUnderRoot(folder);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'file', inside: false });
  });

  it('reads plugins and the legacy plugin key of opencode.json, skipping removals', async () => {
    await put(
      path.join(folder, 'opencode.json'),
      JSON.stringify({
        plugins: ['./local', 'file:///x/y', 'npm-pkg', { package: 'obj-pkg' }, '-removed'],
        plugin: ['legacy', ['tuple', {}]],
      }),
    );
    expect(declared(await scanUnderRoot(folder))).toEqual([
      './local',
      'file:///x/y',
      'legacy',
      'npm-pkg',
      'obj-pkg',
      'tuple',
    ]);
  });

  it('accepts comments and trailing commas in opencode.jsonc and .opencode/opencode.jsonc', async () => {
    await put(path.join(folder, 'opencode.jsonc'), '{ // c\n "plugins": ["one",], }');
    await put(path.join(folder, '.opencode', 'opencode.jsonc'), '{ "plugin": ["two"] }');
    await put(path.join(folder, '.opencode', 'opencode.json'), '{ "plugin": ["three"] }');
    expect(declared(await scanUnderRoot(folder))).toEqual(['one', 'three', 'two']);
  });

  it('ignores a config that is not valid JSONC and reports it as skipped', async () => {
    const broken = await put(path.join(folder, 'opencode.json'), '{ "plugins": ["a" ');
    const scan = await scanProjectPlugins(folder);
    expect(scan.findings.filter((f) => f.kind === 'declared' && f.config === broken)).toEqual([]);
    expect(scan.skipped).toContain(broken);
  });

  it('ignores a config without plugin lists or with a non-array value', async () => {
    await put(path.join(folder, 'opencode.json'), '{ "plugins": "nope", "model": "x" }');
    await put(path.join(folder, 'opencode.jsonc'), '[1, 2]');
    expect(await scanUnderRoot(folder)).toEqual([]);
  });

  it('follows symlinks to a .js file and to a directory', async () => {
    const target = await put(path.join(root, 'elsewhere', 'real.js'));
    const targetDir = path.join(root, 'elsewhere', 'dir');
    await mkdir(targetDir, { recursive: true });
    const plugins = path.join(folder, '.opencode', 'plugins');
    await mkdir(plugins, { recursive: true });
    await symlink(targetDir, path.join(plugins, 'linked-dir'), 'junction');
    let fileLinked = true;
    try {
      await symlink(target, path.join(plugins, 'linked.js'), 'file');
    } catch (error) {
      // Windows without developer mode / admin: creating a file symlink is refused (EPERM).
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      fileLinked = false;
    }
    const names = (await scanUnderRoot(folder)).map((f) =>
      f.kind === 'file' ? path.basename(f.path) : '',
    );
    expect(names).toContain('linked-dir');
    if (fileLinked) expect(names).toContain('linked.js');
  });

  it('returns no duplicates and a stable order', async () => {
    await put(path.join(folder, 'opencode.json'), '{ "plugins": ["b", "a", "a"] }');
    const found = await scanUnderRoot(folder);
    expect(declared(found)).toEqual(['a', 'b']);
    expect(found).toEqual((await scanUnderRoot(folder)).slice());
  });
});

describe('pluginFingerprint', () => {
  const a: PluginFinding = { kind: 'file', path: '/x/a.js', inside: true };
  const b: PluginFinding = {
    kind: 'declared',
    spec: 'p',
    config: '/x/opencode.json',
    inside: true,
  };

  it('does not depend on the order and changes when a finding is added', () => {
    expect(pluginFingerprint([a, b])).toBe(pluginFingerprint([b, a]));
    expect(pluginFingerprint([a, b])).not.toBe(pluginFingerprint([a]));
  });

  it('is the same for a finding whether it is inside or not (only identity counts)', () => {
    expect(pluginFingerprint([a])).toBe(pluginFingerprint([{ ...a, inside: false }]));
  });
});

describe('folderKey', () => {
  it('lower-cases on win32 and keeps the case elsewhere', () => {
    const input = path.resolve(os.tmpdir(), 'MyRepo');
    expect(folderKey(input, 'win32')).toBe(input.toLowerCase());
    expect(folderKey(input, 'linux')).toBe(input);
    expect(folderKey(input, 'darwin')).toBe(input);
  });

  it('normalizes a trailing separator and dot segments', () => {
    const base = path.resolve(os.tmpdir(), 'repo');
    expect(folderKey(`${base}${path.sep}.${path.sep}`, 'linux')).toBe(base);
  });
});
