// Finds the mods on disk (E10-mods, plan Engram #1765 section 3.5, decision P4/P5 of #1768). No
// `vscode` import: Vitest covers it with temporary folders.
//
// There is ONE root: the extension's own folder, `$XDG_CONFIG_HOME/opencode-station/mods` or
// `~/.config/opencode-station/mods` (same on the three OSes, parallel to opencode's own config),
// or `OPEN_VS_CODE_MODS_HOME` when set (the seed every test suite sets so the developer's real
// mods never load). There are NO project mods: nothing a repository ships is ever executed by
// this module (decision P4). A mod is a folder `<root>/<dir>/mod.json` plus its entry file.
//
// Discovery only READS the manifests and proves the entry lies inside its folder; it never
// imports or runs mod code. Problems are returned, not thrown, so one broken mod cannot hide the
// others.

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { MAX_MANIFEST_BYTES, parseManifest, type ModManifest } from '../mods/manifest';
import { MAX_MODS } from '../mods/wire';
import { resolveInsideFolder } from './pathPolicy';

/** Environment variable that replaces the mods root (tests set it; users may too). */
export const MODS_HOME_ENV = 'OPEN_VS_CODE_MODS_HOME';

/** A mod that passed every check and is ready for the host to start. */
export interface DiscoveredMod {
  manifest: ModManifest;
  /** Real (symlink-resolved) path of the mod folder. */
  dir: string;
  /** Real path of the entry file, proven to lie inside {@link DiscoveredMod.dir}. */
  entry: string;
}

/** A folder that looked like a mod and was refused, with a sentence for the user. */
export interface DiscoveryProblem {
  /** Name of the folder under the root. */
  folder: string;
  reason: string;
}

/** What {@link discoverMods} found under one root. */
export interface DiscoveryResult {
  root: string;
  mods: DiscoveredMod[];
  problems: DiscoveryProblem[];
}

/**
 * Where mods live: `OPEN_VS_CODE_MODS_HOME` if set and non-empty, else `$XDG_CONFIG_HOME/
 * opencode-station/mods` if `XDG_CONFIG_HOME` is set, else `<home>/.config/opencode-station/mods`.
 * Parallel to opencode's `~/.config/opencode`. The Windows half is HYPOTHESIS: that opencode v2
 * itself uses the XDG layout on Windows was not checked; the path here is our own choice
 * (decision P5=1) either way. VERIFIED by `modDiscovery.test.ts` (the three branches, Windows 11,
 * 02/11/2026).
 */
export function globalModsRoot(env: NodeJS.ProcessEnv, homeDir: string): string {
  const override = env[MODS_HOME_ENV];
  if (override !== undefined && override !== '') return path.resolve(override);
  const xdg = env['XDG_CONFIG_HOME'];
  const base = xdg !== undefined && xdg !== '' ? xdg : path.join(homeDir, '.config');
  return path.join(base, 'opencode-station', 'mods');
}

/** Reads one mod folder; a string is the reason it was refused. */
async function readMod(root: string, folder: string): Promise<DiscoveredMod | string> {
  const dir = path.join(root, folder);
  const manifestPath = path.join(dir, 'mod.json');
  let size: number;
  try {
    size = (await stat(manifestPath)).size;
  } catch {
    return 'no mod.json in the folder';
  }
  if (size > MAX_MANIFEST_BYTES) return `mod.json is larger than ${MAX_MANIFEST_BYTES} bytes`;
  const parsed = parseManifest(await readFile(manifestPath, 'utf8'));
  if (!parsed.ok) return parsed.error;

  const { manifest } = parsed;
  let realDir: string;
  let realEntry: string;
  try {
    realDir = await realpath(dir);
    realEntry = await realpath(path.join(realDir, manifest.main));
  } catch {
    return `entry file "${manifest.main}" not found`;
  }
  if (resolveInsideFolder(realDir, realEntry) === undefined) {
    return `entry file "${manifest.main}" resolves outside the mod folder`;
  }
  if (!(await stat(realEntry)).isFile()) return `entry "${manifest.main}" is not a file`;
  return { manifest, dir: realDir, entry: realEntry };
}

/**
 * Lists the mods under `root`.
 *
 * A missing root is not an error: it gives no mods and no problems (a fresh install). Entries are
 * visited sorted by folder name, so the result is stable; dot-folders and plain files are skipped.
 * A folder is refused (reported in `problems`) when it has no `mod.json`, the manifest is invalid,
 * the entry is missing, is not a file or, after `realpath`, lies outside the folder (a symlink
 * pointing out), when its `id` repeats an earlier mod's, or past {@link MAX_MODS} mods. Never
 * reads or imports the entry. VERIFIED by `modDiscovery.test.ts` with real temporary folders
 * (Windows 11, 02/11/2026), including "refuses an entry that is a symlink pointing outside the
 * mod folder", which ran and was not skipped on this machine (the suite reported no skipped
 * test of its own). On POSIX it is UNVERIFIED until the CI.
 */
export async function discoverMods(root: string): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { root, mods: [], problems: [] };
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return result;
  }
  const seen = new Set<string>();
  for (const folder of names.sort()) {
    if (folder.startsWith('.')) continue;
    try {
      if (!(await stat(path.join(root, folder))).isDirectory()) continue;
    } catch {
      continue;
    }
    const found = await readMod(root, folder).catch((error: unknown) =>
      error instanceof Error ? error.message : 'unreadable',
    );
    if (typeof found === 'string') {
      result.problems.push({ folder, reason: found });
    } else if (seen.has(found.manifest.id)) {
      result.problems.push({
        folder,
        reason: `id "${found.manifest.id}" is already used by another mod`,
      });
    } else if (result.mods.length >= MAX_MODS) {
      result.problems.push({ folder, reason: `at most ${MAX_MODS} mods are loaded` });
    } else {
      seen.add(found.manifest.id);
      result.mods.push(found);
    }
  }
  return result;
}
