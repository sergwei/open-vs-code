// Checks the list of files that `vsce` would put in the .vsix (issue #5).
//
// Protects against two regressions: (1) local-only files (CLAUDE.md, .claude/, sources, source
// maps) leaking into a PUBLIC package, and (2) a .vsix that ships without what it needs: the host
// bundle and the webview assets (to work), and the README, CHANGELOG, LICENSE and icon (what the
// Marketplace page asks for, #42). The list comes from `vsce ls --no-dependencies`; `vsce ls` and
// `vsce package` share `collectFiles`, so the list equals the package content (HYPOTHESIS:
// read in vsce v4.0.0 src/package.ts, not compared against a real zip).
//
// In CI the workflow creates canary files (CLAUDE.md, .claude/canary.md) before packaging, so
// the "must not ship" check is not vacuous: those files are never versioned and would not exist
// in the checkout otherwise. Nothing is created here, to avoid overwriting a real CLAUDE.md.
//
// Usage: node scripts/check-vsix.mjs <file-with-one-path-per-line>
// Exit code 0 when the list is fine, 1 with one message per problem otherwise.
// ASCII only on purpose: it prints to Windows consoles with arbitrary code pages.

import { readFileSync } from 'node:fs';

/**
 * Paths a package must contain. Two reasons, mixed on purpose: `package.json`, the host bundle,
 * the webview assets (`assets/index.js` and `style.css` are the webview contract) and the
 * activity icon are needed for the extension to WORK; `README.md`, `CHANGELOG.md`, `LICENSE` and
 * `media/icon.png` are needed for the Marketplace page (#42), not for running.
 */
const REQUIRED = [
  'package.json',
  'dist/extension.js',
  'dist/webview/assets/index.js',
  'dist/webview/assets/style.css',
  'media/activity.svg',
  'media/icon.png',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
];

/** Directory prefixes that must never ship (compared lowercase, with `/` separators). */
const FORBIDDEN_PREFIXES = [
  'src/',
  'webview-ui/',
  '.claude/',
  'node_modules/',
  'docs/',
  '.vscode/',
  '.github/',
  'scripts/',
];

/**
 * Directory names that must never ship at ANY depth (e.g. `dist/.claude/x`): the allowlist in
 * .vscodeignore includes whole trees such as `dist/webview/**`, so a nested copy would ship.
 */
const FORBIDDEN_ANYWHERE = ['.claude/', 'node_modules/'];

/** File name patterns that must never ship, tested against the lowercase base name. */
const FORBIDDEN_NAMES = [/^claude\.md$/, /\.(ts|tsx|mts|map|vsix)$/, /^\.env/, /^\.npmrc$/];

/**
 * Returns one message per packaging problem found in a list of packaged paths.
 *
 * Paths are normalized to `/`. Forbidden paths are compared case-insensitively, because Windows
 * and macOS file systems do not distinguish case, so `Claude.MD` is the same file there.
 * Required paths are compared case-SENSITIVELY: the host loads `assets/index.js` by that exact
 * name, and `Index.js` would not load on Linux. Forbidden directories are matched at the root,
 * and `.claude/` and `node_modules/` at any depth. An empty list
 * is itself a problem (a broken `vsce ls` would otherwise look like "nothing forbidden").
 * Pure: no I/O, so it can be exercised with hand-made lists.
 * VERIFIED on Windows 11 with a valid list, a list with forbidden paths and the real `vsce ls`
 * output of a checkout without `dist/` (2026-10-20). UNVERIFIED on macOS/Linux until the first CI run.
 */
export function findPackagingProblems(files) {
  const problems = [];
  if (files.length === 0) {
    return ['The file list is empty: `vsce ls` produced no output.'];
  }
  const normalized = files.map((f) => f.replaceAll('\\', '/').replace(/^\.\//, ''));
  const lower = normalized.map((f) => f.toLowerCase());

  for (const required of REQUIRED) {
    if (!normalized.includes(required)) {
      problems.push(`Missing from the package: ${required}`);
    }
  }
  normalized.forEach((file, i) => {
    const path = lower[i];
    const base = path.slice(path.lastIndexOf('/') + 1);
    if (
      FORBIDDEN_PREFIXES.some((p) => path.startsWith(p)) ||
      FORBIDDEN_ANYWHERE.some((p) => `/${path}`.includes(`/${p}`))
    ) {
      problems.push(`Must not be packaged (forbidden directory): ${file}`);
    } else if (FORBIDDEN_NAMES.some((re) => re.test(base))) {
      problems.push(`Must not be packaged (forbidden file): ${file}`);
    }
  });
  return problems;
}

/**
 * Reads the file list named in `process.argv[2]`, reports problems and sets the exit code.
 *
 * Sets `process.exitCode = 1` instead of calling `process.exit`, so stdout is flushed on every
 * platform. A missing argument or an unreadable file also exits 1 with a message.
 * UNVERIFIED on macOS/Linux until the first CI run.
 */
function main() {
  const listPath = process.argv[2];
  if (!listPath) {
    console.error('Usage: node scripts/check-vsix.mjs <file-list>');
    process.exitCode = 1;
    return;
  }
  let text;
  try {
    text = readFileSync(listPath, 'utf8');
  } catch (error) {
    console.error(`Cannot read ${listPath}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const files = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const problems = findPackagingProblems(files);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`ERROR: ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK: ${files.length} files`);
}

main();
