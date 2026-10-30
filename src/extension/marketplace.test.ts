import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Manifest {
  version: string;
  license?: string;
  icon?: string;
  galleryBanner?: { color?: string; theme?: string };
  keywords?: string[];
  bugs?: { url?: string };
  homepage?: string;
  scripts: Record<string, string>;
  contributes: {
    configuration: { properties: Record<string, unknown> };
    commands: { command: string; title: string; category?: string }[];
    keybindings?: { command: string; key: string; mac?: string }[];
  };
}

const REPO_URL = 'https://github.com/sergwei/open-vs-code';

/**
 * Reads a repository file (relative to the repo root) as UTF-8 text.
 *
 * These tests read the REAL files of the repository, like `manifest.test.ts`; a missing file
 * throws, which is the wanted failure. VERIFIED on Windows 11 with `npm test` (2026-10-22): the
 * relative URL resolves from `src/extension/`. Other operating systems UNVERIFIED.
 */
function readText(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

/** True when a repository file (relative to the repo root) exists. */
function exists(relativePath: string): boolean {
  return existsSync(new URL(`../../${relativePath}`, import.meta.url));
}

const manifest = JSON.parse(readText('package.json')) as Manifest;
const readme = readText('README.md');

/**
 * Lists every image reference of a README: Markdown `![alt](target)` and HTML `<img src>`.
 *
 * A regex, not a Markdown parser: enough for the README of this repository, which uses plain
 * image syntax. It is what vsce's README check cares about (https, no SVG, no inline `<svg>`),
 * so an image written in a form this misses would also be missed here.
 * VERIFIED by reading vsce 4.0.0 `out/package.js` (2026-10-22): the README check parses the
 * rendered HTML and applies, to every `img`, `Images in ${this.name} must come from an HTTPS
 * source`, `SVGs are restricted in ${this.name}` and `SVG tags are not allowed in ${this.name}.`,
 * so reference-style images are checked by vsce too (after Markdown rendering) while this regex
 * does not list them. Read, not run for the reference-style case.
 */
function imageTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g))
    targets.push(match[1] ?? '');
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    targets.push(match[1] ?? '');
  }
  return targets;
}

/**
 * Reads the pixel size a PNG declares in its IHDR chunk.
 *
 * Why not a library: only the signature and the first chunk are needed, and this repository adds
 * no image dependency. Throws when the signature is not PNG, so a renamed JPEG or SVG fails.
 * The test "points at a square PNG icon of at least 128 px" below reads `media/icon.png`
 * (256x256) through it. VERIFIED on Windows 11 with `npm test` (2026-10-22): that test passes
 * on the real icon and went red in the 64x64 mutation described in the header of the first
 * `describe`.
 */
function pngSize(file: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!file.subarray(0, 8).equals(signature)) throw new Error('not a PNG file');
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

/**
 * Collects, sorted, the first capture group of every README line that matches a table-row pattern.
 *
 * Exact names, not `includes()` over the whole README: a name mentioned in another section, or a
 * longer name that merely starts with the real one, must not count as documented. The sort makes
 * the comparison independent of the order of the rows. Duplicated rows are kept, so a row written
 * twice fails against the manifest instead of hiding.
 */
function tableKeys(markdown: string, row: RegExp): string[] {
  const keys: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const key = row.exec(line)?.[1];
    if (key !== undefined) keys.push(key);
  }
  return keys.sort();
}

/**
 * Protects the Marketplace metadata that `vsce` only checks while packaging (issue #42).
 *
 * `vsce package` refuses an SVG icon or a missing icon file, but it does not check that the icon
 * is big enough, that the license text matches `license`, or that the README documents what the
 * manifest contributes; a regression would otherwise show up only in the Marketplace page.
 * VERIFIED by reading vsce 4.0.0 `out/package.js` (2026-10-22): `SVGs can't be used as icons`
 * (`/\.svg$/i.test(manifest.icon || '')`) and `The specified icon '${this.icon}' wasn't found in
 * the extension.` are the only icon checks found in that file. Read, not run against a bad icon.
 * The data are the real files. Mutations tried by hand on 2026-10-22 (each turned a test red,
 * then was reverted): a 64x64 `media/icon.png`, `--skip-license` put back in `scripts.vsix`, and,
 * for the README tables (2026-10-22, on Windows 11, `npx vitest run` of this file): the
 * `openVsCode.serverUrl` row renamed to `openVsCode.serverUrlX` (Settings test red), the same row
 * stripped of its backticks, which makes it a non-row (Settings test red), and an extra
 * "OpenCode: Ghost Command" row (Commands test red).
 */
describe('Marketplace metadata (package.json)', () => {
  it('declares the MIT license and a LICENSE file that says so', () => {
    expect(manifest.license).toBe('MIT');
    const license = readText('LICENSE');
    expect(license.startsWith('MIT License')).toBe(true);
    expect(license).toContain('Copyright (c) 2026 Sergio González Carbajal');
  });

  it('points at a square PNG icon of at least 128 px', () => {
    expect(manifest.icon).toMatch(/\.png$/);
    const size = pngSize(readFileSync(new URL(`../../${manifest.icon ?? ''}`, import.meta.url)));
    expect(size.width).toBe(size.height);
    expect(size.width).toBeGreaterThanOrEqual(128);
  });

  it('has a gallery banner, at most 30 keywords, and links into this repository', () => {
    expect(manifest.galleryBanner?.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(['dark', 'light']).toContain(manifest.galleryBanner?.theme);
    expect(manifest.keywords?.length).toBeGreaterThan(0);
    expect(manifest.keywords?.length).toBeLessThanOrEqual(30);
    expect(manifest.bugs?.url).toBe(`${REPO_URL}/issues`);
    expect(manifest.homepage).toBe(`${REPO_URL}#readme`);
  });

  it('does not skip the license check when packaging', () => {
    expect(manifest.scripts.vsix).not.toContain('--skip-license');
  });
});

/**
 * Protects the README against what vsce rejects in a package and against going stale.
 *
 * vsce rewrites relative image links to `raw/HEAD` URLs of the repository and refuses SVG images
 * and inline `<svg>`; the allowlist in `.vscodeignore` keeps `docs/` out of the package, so images
 * must live in `docs/images/`. The two table checks compare the rows of the Settings and Commands
 * tables of the README with the manifest, in both directions: a new setting or command fails until
 * the README has its row (a parallel task that adds one must add its README row too), and a row
 * left behind for something the manifest no longer contributes fails too.
 * VERIFIED by reading vsce 4.0.0 `out/package.js` (2026-10-22): the `ReadmeProcessor` rejects
 * images that are not `https` (`Images in ${this.name} must come from an HTTPS source`), SVG
 * images (`SVGs are restricted in ${this.name}`) and `<svg>` tags (`SVG tags are not allowed in
 * ${this.name}.`). Unverified here: the `raw/HEAD` rewrite itself; it was observed by running the
 * `ReadmeProcessor` in memory in the review of #42 (2026-10-22), not by this file.
 */
describe('README.md', () => {
  it('is not the template of `yo code`', () => {
    expect(readme).not.toContain('This is the README for your extension');
  });

  it('uses only images that vsce accepts', () => {
    expect(readme).not.toMatch(/<svg\b/i);
    for (const target of imageTargets(readme)) {
      if (/^https:\/\//i.test(target)) {
        expect(target, target).not.toMatch(/\.svg(\?|$)/i);
      } else {
        expect(target, target).toMatch(/^docs\/images\/[\w.-]+\.(png|gif|jpg)$/);
        expect(exists(target), `${target} exists`).toBe(true);
      }
    }
  });

  it('has a Settings table whose rows are exactly the contributed settings', () => {
    expect(tableKeys(readme, /^\| `(openVsCode\.[\w.]+)` \|/)).toEqual(
      Object.keys(manifest.contributes.configuration.properties).sort(),
    );
  });

  // E5 of #77: the names test above ignores the Default column, so a README that kept saying
  // `sidebar` after the default moved to `editor` passed. `empty` stands for the empty string.
  // Provenance: the REAL README and manifest. Mutation (Windows 11, `npx vitest run`, 30/10/2026):
  // with `sidebar` in the Default cell of the `openVsCode.chatLocation` row this test is red.
  it('has a Settings table whose Default column is the default of each contributed setting', () => {
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { default?: unknown }
    >;
    const rows = new Map<string, string>();
    for (const line of readme.split(/\r?\n/)) {
      const cells = /^\| `(openVsCode\.[\w.]+)` \| [^|]+ \| ([^|]+) \|/.exec(line);
      if (cells?.[1] !== undefined && cells[2] !== undefined) rows.set(cells[1], cells[2].trim());
    }
    expect(rows.size).toBe(Object.keys(properties).length);
    for (const [key, property] of Object.entries(properties)) {
      const wanted = property.default === '' ? 'empty' : `\`${String(property.default)}\``;
      expect(rows.get(key), key).toBe(wanted);
    }
  });

  it('has a Commands table whose rows are exactly the contributed commands', () => {
    const labels = manifest.contributes.commands.map(({ title, category }) =>
      category ? `${category}: ${title}` : title,
    );
    expect(tableKeys(readme, /^\| \*\*([^*|]+)\*\* \|/)).toEqual(labels.sort());
  });

  // Issue #35. The first column is NOT bold on purpose: the Commands regex above would count a
  // bold cell as a command. Keys are compared case-insensitively ("Ctrl+Alt+P" vs "ctrl+alt+p").
  it('has a Keyboard shortcuts table whose rows are exactly the contributed keybindings', () => {
    const label = (id: string): string => {
      const command = manifest.contributes.commands.find((c) => c.command === id);
      if (command === undefined) throw new Error(`keybinding for an uncontributed command ${id}`);
      return command.category ? `${command.category}: ${command.title}` : command.title;
    };
    // One row per key and command: Focus Prompt has two rules for the same key, one per direction
    // (issue #92), and the reader sees one shortcut.
    const expected = [
      ...new Set(
        (manifest.contributes.keybindings ?? []).map((binding) =>
          `${binding.key} | ${binding.mac ?? ''} | ${label(binding.command)}`.toLowerCase(),
        ),
      ),
    ];
    const rows = readme
      .split(/\r?\n/)
      .map((line) => /^\| `([^`]+)` \| `([^`]+)` \| (OpenCode: [^|]+?) \|/.exec(line))
      .flatMap((m) => (m === null ? [] : [`${m[1]} | ${m[2]} | ${m[3]}`.toLowerCase()]));
    expect(rows.sort()).toEqual(expected.sort());
  });
});

/**
 * Protects the changelog format that vsce renders on the Marketplace "Changelog" tab.
 *
 * Keep a Changelog 1.1.0 asks for an `Unreleased` section or one per version; the version of
 * `package.json` is accepted too so that #43 can cut a release by renaming the heading.
 */
describe('CHANGELOG.md', () => {
  it('starts with "# Changelog" and has an Unreleased or current-version section', () => {
    const changelog = readText('CHANGELOG.md');
    expect(changelog.startsWith('# Changelog')).toBe(true);
    const sections = [...changelog.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]);
    expect(sections.some((s) => s === 'Unreleased' || s === manifest.version)).toBe(true);
  });
});
