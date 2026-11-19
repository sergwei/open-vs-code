import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Manifest {
  displayName: string;
  description: string;
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

const nls = JSON.parse(readText('package.nls.json')) as Record<string, string>;

/**
 * Turns a `%key%` string of package.json into its English text from `package.nls.json` (what a
 * VS Code in English shows); any other string passes through. Throws on a missing key. The docs
 * are English, so every title and description is compared in its resolved form.
 * VERIFIED indirectly: "has a Commands table whose rows are exactly the contributed commands"
 * passes only if the `OpenCode: Show Logs` row of `docs/commands.md` matches the resolved title.
 */
function resolveNls(text: string): string {
  const key = /^%([\w.-]+)%$/.exec(text)?.[1];
  if (key === undefined) return text;
  const resolved = nls[key];
  if (resolved === undefined) throw new Error(`package.nls.json has no key "${key}"`);
  return resolved;
}

const manifest = JSON.parse(readText('package.json')) as Manifest;
manifest.description = resolveNls(manifest.description);
for (const command of manifest.contributes.commands) command.title = resolveNls(command.title);
const readme = readText('README.md');
const readmeEs = readText('README.es.md');
const featuresDoc = readText('docs/features.md');
// The Settings, Commands and Keyboard shortcuts tables moved out of the short README (E11-readme-
// bilingual); `docs/commands.md` is now where they live and where the table tests below read them.
const commandsDoc = readText('docs/commands.md');

/**
 * Reads the Default column of the short "most changed" Settings table of a README.
 *
 * The READMEs keep a 3-column table (Setting | Default | What it does, `Opción | Por defecto | Qué
 * hace` in Spanish) that is NOT the 4-column one of `docs/commands.md`, so it has its own reader.
 * Returns setting name -> trimmed Default cell; `empty` (English) and `vacío` (Spanish) are
 * mapped to the empty string, and any other cell is returned without its backticks. Rows that are
 * not `openVsCode.*` settings are ignored.
 */
function readmeSettingDefaults(markdown: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of markdown.split(/\r?\n/)) {
    const cells = /^\| `(openVsCode\.[\w.]+)` \| ([^|]+) \|/.exec(line);
    if (cells?.[1] === undefined || cells[2] === undefined) continue;
    const cell = cells[2].trim();
    rows.set(cells[1], cell === 'empty' || cell === 'vacío' ? '' : cell.replace(/^`|`$/g, ''));
  }
  return rows;
}

/**
 * Lists every image reference of a README: Markdown `![alt](target)` and HTML `<img src>`.
 *
 * A regex, not a Markdown parser: enough for the READMEs and the docs/ pages of this repository,
 * which use plain image syntax. It is what vsce's README check cares about (https, no SVG, no
 * inline `<svg>`), so an image written in a form this misses would also be missed here.
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
 * Collects, sorted, the first capture group of every line of a Markdown file (a README or a docs/
 * page) that matches a table-row pattern.
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
 * is big enough, that the license text matches `license`, or that `docs/commands.md` documents what the
 * manifest contributes; a regression would otherwise show up only in the Marketplace page.
 * VERIFIED by reading vsce 4.0.0 `out/package.js` (2026-10-22): `SVGs can't be used as icons`
 * (`/\.svg$/i.test(manifest.icon || '')`) and `The specified icon '${this.icon}' wasn't found in
 * the extension.` are the only icon checks found in that file. Read, not run against a bad icon.
 * The data are the real files. Mutations tried by hand on 2026-10-22 (each turned a test red,
 * then was reverted): a 64x64 `media/icon.png` and `--skip-license` put back in `scripts.vsix`.
 * The table mutations of 2026-10-22 ran against the old README.md, before its tables moved to
 * `docs/commands.md`; they are not evidence for the new file, whose own mutations are recorded in
 * the header of `describe('docs/commands.md')`.
 *
 * The license is PolyForm Shield 1.0.0 (decision of 2026-11-02: forbid published copies that
 * compete with the extension, renamed or free, while use at work stays allowed). It has no SPDX
 * id (checked on 2026-11-02 in spdx/license-list-data `licenses.json`: only PolyForm-Noncommercial
 * and PolyForm-Small-Business are listed), so the manifest uses the npm form
 * `SEE LICENSE IN LICENSE`. VERIFIED on Windows 11 (2026-11-02) by running vsce 4.0.0
 * `LicenseProcessor` from `out/package.js` with this manifest under Node: `extension/LICENSE` came
 * out as `extension/LICENSE.txt`, also as `vsix.license` and the License asset, which is the name
 * `vsixCheck.test.ts` expects. Not packaged (the "never build" rule). On the Open VSX side, ovsx
 * 1.3.0 runs its `checkLicense` only when it packages itself (the release workflow hands it a built
 * `.vsix`), and its `isLicenseOk` accepts any non-empty `license` (read in `publish.js`, not run).
 * HYPOTHESIS: the Open VSX server takes the package too, since its FAQ only asks for a license in
 * the manifest and accepts non-OSI ones; it is checked the first time the release workflow
 * publishes. Mutations tried by hand on 2026-11-02 (Windows 11, `npx vitest run` of this file),
 * each turning the license test red, then reverted: `license` back to `MIT`, and the README link
 * back to `[MIT](LICENSE)`. Not tried: a LICENSE without the `Required Notice:` line.
 *
 * The `Licensor Line of Business:` line is what keeps Shield's "Discontinued Products" clause
 * from letting anyone compete with the extension once it stops being provided (decision of
 * 2026-11-02). HYPOTHESIS, a legal reading of the official 1.0.0 text (Discontinued Products
 * section, read on 2026-11-02) that no test can check and that is not legal advice. The line
 * names the line of business and the repository, not the display name, which issue #126 changed.
 * Mutation tried by hand on 2026-11-02 (Windows 11, `npx vitest run` of this file): the line
 * removed from LICENSE turned the license test red, then reverted.
 *
 * The name test (#79, #126) guards the display name and description chosen on 2026-10-31 and
 * 2026-11-02: "OpenCode GUI" is the name of another extension (`TanishqKancharla.opencode-vscode`),
 * and the Marketplace brand guidelines keep the product name free of "VS Code", so that mention
 * lives in the description. Provenance: the REAL package.json and README. Mutations tried by hand
 * on 2026-11-02 (Windows 11, `npx vitest run` of this file), each turning that test red, then
 * reverted: `displayName` set to "OpenCode GUI" and then to "OpenCode for VS Code" (both fail on
 * the exact-name assertion, so the "VS Code" assertion itself was never reached alone), and the
 * README title set to "# OpenCode GUI" (fails on the title assertion). Not tried: a description
 * that differs only in the README, and the JSON-wide "OpenCode GUI" search on its own.
 */
describe('Marketplace metadata (package.json)', () => {
  it('declares the PolyForm Shield license, with the notice and terms in LICENSE and the README', () => {
    expect(manifest.license).toBe('SEE LICENSE IN LICENSE');
    const license = readText('LICENSE').replace(/\s+/g, ' ');
    expect(license.startsWith('Required Notice: Copyright (c) 2026 Sergio González Carbajal')).toBe(
      true,
    );
    expect(license).toContain(
      'Licensor Line of Business: Graphical user interfaces for opencode in code editors',
    );
    expect(license).toContain('# PolyForm Shield License 1.0.0');
    expect(license).toContain(
      'Any purpose is a permitted purpose, except for providing any product that competes with the software',
    );
    expect(readText('README.md')).toContain('[PolyForm Shield License 1.0.0](LICENSE)');
  });

  it('names the extension OpenCode Station, with the brand mention in the description only', () => {
    expect(manifest.displayName).toBe('OpenCode Station');
    expect(manifest.description).toBe('Unofficial GUI for opencode in Visual Studio Code');
    expect(manifest.displayName).not.toMatch(/VS Code|Visual Studio Code/i);
    expect(readme.split(/\r?\n/)[0]).toBe(`# ${manifest.displayName}`);
    expect(readme).toContain(`${manifest.description}.`);
    expect(readme).not.toContain('OpenCode GUI');
    expect(JSON.stringify(manifest)).not.toContain('OpenCode GUI');
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
 * Protects the Marketplace README (and its Spanish copy) against what vsce rejects in a package
 * and against going stale (E11-readme-bilingual, review fixes of 2026-11-19).
 *
 * vsce rewrites relative image links to `raw/HEAD` URLs of the repository and refuses SVG images
 * and inline `<svg>`; the allowlist in `.vscodeignore` keeps `docs/` out of the package, so images
 * must live in `docs/images/`. `README.md` uses relative `docs/images/*.png` links (vsce rewrites
 * them); `README.es.md` is not packaged, so it uses absolute `raw.githubusercontent.com` URLs of
 * `main`. Both must keep at least one image (the Marketplace page was left without any once, and
 * the old image test then passed vacuously) and every image must exist in `docs/images/`. The
 * short 3-column Settings table of each README is checked against the manifest defaults, the
 * drift class of #77/E5. Provenance: the REAL README files, `docs/features.md` and `package.json`.
 * VERIFIED by mutations (Windows 11, `npx vitest run src/extension/marketplace.test.ts`,
 * 2026-11-19), each reverted afterwards: the `openVsCode.autoStart` Default of README.md set to
 * `false` turned "README.md lists settings whose Default is the default of the manifest" red; the
 * `openVsCode.defaultModel` Default of README.es.md set to `x` turned "README.es.md lists settings
 * whose Default is the default of the manifest" red; the second image of README.es.md pointed at
 * `permission-cardX.png` turned "uses only images that vsce accepts, and keeps at least one" red
 * ("... exists: expected false to be true"). Not tried: removing every image of README.md (the
 * `length > 0` assertion), a broken image in docs/features.md, and macOS or Linux.
 * VERIFIED by reading vsce 4.0.0 `out/package.js` (2026-10-22): the `ReadmeProcessor` rejects
 * images that are not `https` (`Images in ${this.name} must come from an HTTPS source`), SVG
 * images (`SVGs are restricted in ${this.name}`) and `<svg>` tags (`SVG tags are not allowed in
 * ${this.name}.`). Unverified here: the `raw/HEAD` rewrite itself; it was observed by running the
 * `ReadmeProcessor` in memory in the review of #42 (2026-10-22), not by this file.
 */
describe('README.md and README.es.md', () => {
  it('is not the template of `yo code`', () => {
    expect(readme).not.toContain('This is the README for your extension');
  });

  it('uses only images that vsce accepts, and keeps at least one', () => {
    expect(readme).not.toMatch(/<svg\b/i);
    expect(readmeEs).not.toMatch(/<svg\b/i);
    const targets = imageTargets(readme);
    expect(targets.length, 'README.md has images').toBeGreaterThan(0);
    for (const target of targets) {
      expect(target, target).toMatch(/^docs\/images\/[\w.-]+\.(png|gif|jpg)$/);
      expect(exists(target), `${target} exists`).toBe(true);
    }
    const targetsEs = imageTargets(readmeEs);
    expect(targetsEs.length, 'README.es.md has images').toBeGreaterThan(0);
    for (const target of targetsEs) {
      const match = new RegExp(
        `^https://raw\\.githubusercontent\\.com/sergwei/open-vs-code/main/(docs/images/[\\w.-]+\\.(?:png|gif|jpg))$`,
      ).exec(target);
      expect(match, `${target} is a raw URL of docs/images`).not.toBeNull();
      expect(exists(match?.[1] ?? ''), `${target} exists`).toBe(true);
    }
  });

  it('only references images of docs/features.md that exist', () => {
    const targets = imageTargets(featuresDoc);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target, target).toMatch(/^images\/[\w.-]+\.(png|gif|jpg)$/);
      expect(exists(`docs/${target}`), `docs/${target} exists`).toBe(true);
    }
  });

  // The 3-column table of each README (Setting | Default | What it does) is not covered by the
  // docs/commands.md tests below. `empty` / `vacío` stand for the empty string. Provenance: the REAL
  // READMEs and manifest.
  it.each([
    ['README.md', readme],
    ['README.es.md', readmeEs],
  ])('%s lists settings whose Default is the default of the manifest', (_name, markdown) => {
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { default?: unknown }
    >;
    const rows = readmeSettingDefaults(markdown);
    expect(rows.size).toBeGreaterThan(0);
    for (const [key, cell] of rows) {
      expect(properties[key], `${key} is contributed`).toBeDefined();
      expect(cell, key).toBe(String(properties[key]?.default));
    }
  });
});

/**
 * Protects the Settings, Commands and Keyboard shortcuts tables of `docs/commands.md` (they left
 * the short README) against going stale, in both directions: a new setting, command or keybinding
 * fails until that page has its row (a parallel task that adds one must add its row there, and in
 * the READMEs only if it is one of the few they list), and a row left behind for something the
 * manifest no longer contributes fails too. Provenance: the REAL `docs/commands.md` and manifest.
 * VERIFIED by mutations on `docs/commands.md` (Windows 11, `npx vitest run
 * src/extension/marketplace.test.ts`, 2026-11-19), each reverted afterwards: the Default cell of
 * `openVsCode.chatLocation` set to `sidebar` turned "has a Settings table whose Default column is
 * the default of each contributed setting" red ("openVsCode.chatLocation: expected '`sidebar`' to
 * be '`editor`'"); an extra "OpenCode: Ghost Command" row turned "has a Commands table whose rows
 * are exactly the contributed commands" red; the `openVsCode.serverUrl` row renamed to
 * `openVsCode.serverUrlX` turned "has a Settings table whose rows are exactly the contributed
 * settings" red; the `Ctrl+Alt+P` cell changed to `Ctrl+Alt+Q` turned "has a Keyboard shortcuts
 * table whose rows are exactly the contributed keybindings" red. Not tried on this file: a row
 * stripped of its backticks, and macOS or Linux.
 */
describe('docs/commands.md', () => {
  it('has a Settings table whose rows are exactly the contributed settings', () => {
    expect(tableKeys(commandsDoc, /^\| `(openVsCode\.[\w.]+)` \|/)).toEqual(
      Object.keys(manifest.contributes.configuration.properties).sort(),
    );
  });

  // E5 of #77: the names test above ignores the Default column, so a page that kept saying
  // `sidebar` after the default moved to `editor` passed. `empty` stands for the empty string.
  // Provenance: the REAL docs/commands.md and manifest. Mutation recorded in the header of the
  // describe (`sidebar` in the chatLocation Default cell).
  it('has a Settings table whose Default column is the default of each contributed setting', () => {
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { default?: unknown }
    >;
    const rows = new Map<string, string>();
    for (const line of commandsDoc.split(/\r?\n/)) {
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
    expect(tableKeys(commandsDoc, /^\| \*\*([^*|]+)\*\* \|/)).toEqual(labels.sort());
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
    const rows = commandsDoc
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
