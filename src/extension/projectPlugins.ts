// Detects the opencode plugins a folder brings along (issue #153): code that `opencode serve`
// loads and runs with the user's permissions without asking. Pure Node (`node:fs/promises`, no
// `vscode`), so it is tested against real temporary folders.
//
// The rules replicate opencode v2.0.32 (tag 843a6c51), READ on 03/11/2026 and not executed:
// - `core/src/config/discovery.ts` L76-85 and `util/src/fs-util.ts` L165-188: the project config is
//   searched from the served folder UP to the root of the disk, in every ancestor.
// - `core/src/plugin/source-directory.ts` L7-32: in every `.opencode/` it reads `plugin/` and
//   `plugins/`; a file counts when its name ends exactly in `.ts` or `.js` (case sensitive, `.mjs`
//   and `.cjs` do not), any subdirectory counts, and so does a symlink to one of those.
// - `core/src/config/plugin/source.ts` L113-157 and `config/normalize.ts` L185-190: the keys
//   `plugins` (v2) and `plugin` (v1) of `opencode.json(c)` and `.opencode/opencode.json(c)` are
//   merged; an entry is a string, `{ package }` or a `[name, options]` tuple; a string starting
//   with `-` removes a plugin and loads nothing; any other string (an npm name included) is
//   installed and loaded.
// - `core/src/config/config.ts` L110-121: JSONC is parsed with `allowTrailingComma` and any error
//   rejects the whole document. `{env:}` / `{file:}` substitution (L145) is NOT replicated.
//
// VERIFIED against the real opencode 2.0.32 on Windows 11 (03/11/2026, a scratch script, no prompt
// sent): a `.opencode/plugins/marker.js` that writes a marker file when imported was NOT imported
// right after the `{"url":…}` line nor 4 s later with no request, nor by `GET /api/info`, `GET
// /api/session`, `GET /api/agent` or `GET /api/command` with `x-opencode-directory`; the marker
// appeared on the first `GET /api/model` for that location (about 0.8 s into the request), so the
// plugins load LAZILY with the first request that instantiates the location, not at boot. The
// guard asks before spawning because the extension makes such requests right after the start.
// NOT observed: plugins declared in `opencode.json` (npm packages), `.ts` plugins, other OSes.
// Known false positives: the folder is itself opencode's global config root, or the user runs
// with `OPENCODE_CONFIG_PROJECT_DISABLE`. Known false negatives: a plugin added while the server
// runs (hot reload, `source.ts` L81-90).

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
// The ESM entry on purpose: the `main` of `jsonc-parser` is UMD and esbuild cannot follow its
// `require` calls (HYPOTHESIS, the first real bundle is the check).
import { parse, type ParseError } from 'jsonc-parser/lib/esm/main.js';

/** A plugin source found for a folder. `inside` is false for what an ancestor folder brings. */
export type PluginFinding =
  | { kind: 'file'; path: string; inside: boolean }
  | { kind: 'declared'; spec: string; config: string; inside: boolean };

/** What {@link scanProjectPlugins} returns: sorted, de-duplicated findings and unreadable configs. */
export interface PluginScan {
  findings: PluginFinding[];
  /** Config files that exist but are not valid JSONC: opencode ignores them whole, and so do we. */
  skipped: string[];
}

const PLUGIN_DIRS = ['plugin', 'plugins'];
const CONFIG_FILES = ['opencode.json', 'opencode.jsonc'];

/** Stable identity of a finding, used to sort, de-duplicate and fingerprint. */
function findingKey(finding: PluginFinding): string {
  return finding.kind === 'file'
    ? `file|${finding.path}`
    : `declared|${finding.config}|${finding.spec}`;
}

/** The plugin name of one entry of a `plugins`/`plugin` array, or undefined when it loads nothing. */
function specOf(entry: unknown): string | undefined {
  let spec: unknown = entry;
  if (Array.isArray(entry)) spec = entry[0];
  else if (typeof entry === 'object' && entry !== null)
    spec = (entry as { package?: unknown }).package;
  if (typeof spec !== 'string' || spec === '' || spec.startsWith('-')) return undefined;
  return spec;
}

/** Plugin files and directories of one `plugin/` or `plugins/` folder; unreadable means absent. */
async function scanPluginDir(dir: string, inside: boolean): Promise<PluginFinding[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: PluginFinding[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const codeName = entry.name.endsWith('.ts') || entry.name.endsWith('.js');
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const target = await stat(full);
        isDir = target.isDirectory();
        isFile = target.isFile();
      } catch {
        continue; // dangling link: upstream treats a failed read as absent
      }
    }
    if (isDir || (isFile && codeName)) found.push({ kind: 'file', path: full, inside });
  }
  return found;
}

/** Plugins declared by one config file; none when it is missing, unreadable or invalid (the latter is added to `skipped`). */
async function scanConfig(
  file: string,
  inside: boolean,
  skipped: string[],
): Promise<PluginFinding[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const errors: ParseError[] = [];
  const root: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    skipped.push(file);
    return [];
  }
  if (typeof root !== 'object' || root === null) return [];
  const found: PluginFinding[] = [];
  for (const key of ['plugins', 'plugin']) {
    const list = (root as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const spec = specOf(entry);
      if (spec !== undefined) found.push({ kind: 'declared', spec, config: file, inside });
    }
  }
  return found;
}

/**
 * Lists every plugin source opencode would load for `folder`: the folder and each of its
 * ancestors up to the root of the disk, as upstream searches them (rules and tag in the file
 * header). Never rejects: a directory or file that cannot be read counts as absent, like upstream.
 *
 * Returns the findings sorted by identity and without duplicates (`inside` is true only for the
 * folder itself) plus the configs skipped for being invalid JSONC. Contents are never read, only
 * names and specs. VERIFIED by `projectPlugins.test.ts` against real temporary folders (plugin
 * dirs, ancestors, the four config files, symlinks, broken JSON) on Windows 11, 03/11/2026;
 * UNVERIFIED on macOS and Linux until the CI matrix passes it. That opencode loads a plugin file
 * of the folder: VERIFIED once against the real 2.0.32 (file header); the declared kind is not.
 */
export async function scanProjectPlugins(folder: string): Promise<PluginScan> {
  const skipped: string[] = [];
  const byKey = new Map<string, PluginFinding>();
  let dir = path.resolve(folder);
  for (let inside = true; ; inside = false) {
    const opencodeDir = path.join(dir, '.opencode');
    const batches = await Promise.all([
      ...PLUGIN_DIRS.map((name) => scanPluginDir(path.join(opencodeDir, name), inside)),
      ...CONFIG_FILES.map((name) => scanConfig(path.join(dir, name), inside, skipped)),
      ...CONFIG_FILES.map((name) => scanConfig(path.join(opencodeDir, name), inside, skipped)),
    ]);
    for (const finding of batches.flat()) byKey.set(findingKey(finding), finding);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const findings = [...byKey.values()].sort((a, b) => findingKey(a).localeCompare(findingKey(b)));
  return { findings, skipped: [...new Set(skipped)].sort() };
}

/**
 * Hash of WHAT is there, not of its content: it changes when a plugin appears or disappears (a
 * `git pull`, a new file), not when one is edited. Order independent. Decision P1 of issue #153.
 * VERIFIED by `projectPlugins.test.ts` (same set in another order, one more finding).
 */
export function pluginFingerprint(findings: readonly PluginFinding[]): string {
  const keys = findings.map(findingKey).sort();
  return createHash('sha256').update(keys.join('\n')).digest('hex');
}

/**
 * Key of a folder in the stored decisions: the resolved path, lower-cased on Windows because NTFS
 * does not tell `C:\Repo` from `c:\repo`. `platform` is injectable so a test covers both. macOS
 * (case-insensitive by default) keeps the case: the worst case there is being asked again.
 */
export function folderKey(folder: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(folder);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}
