// Code fingerprint of the tree a `npm run test:visual` run covered (tooling/test-speed, phase 3).
//
// ONLY VALID FOR `test:visual` (decision of Sergio, 31/10/2026, review C1): it hashes neither
// `test/integration/**` nor `.vscode-test.mjs`, so it says nothing about the integration suite,
// which is rerun whole whenever the CODE changed. Comments, README and markers do not count, and
// whoever changes a file judges from the diff whether it is code (decision of Sergio, 31/10/2026, R4).
//
// `node test/visual/fingerprint.mjs --print` prints `fingerprint <sha256>`; `--check <saved-output>`
// compares the `fingerprint` line of a saved run with the tree as it is now. The point: a run is
// evidence for the code it ran, so a change that only touches comments, formatting, line endings or
// types must not make a 9-minute full run stale (ciclo-extension section 3 used to demand a rerun
// after ANY touch of run.mjs), while a change of code must.
//
// How: every hashed source file goes through `esbuild.transformSync` (comments dropped, spacing
// and CRLF normalised, TypeScript types erased), and the sha256 of the sorted (path, output) pairs
// is the fingerprint. VERIFIED (30/10/2026, Windows 11, esbuild 0.28.2, `transformSync` on two
// hand-written variants of each file): a ts, a tsx and a css file with different comments and line
// endings gave identical output. The run also saves a
// manifest of the per-file digests (`.vscode-test/fingerprints/<hash>.json`) so that `--check` can
// say WHICH files changed and what `selectForFiles` would run for them.
//
// WHAT IS HASHED (the list, in {@link hashedFiles}):
//  - `src/**` and `webview-ui/src/**` except tests (`*.test.*`, `*.spec.*`), Markdown and
//    `tsconfig*.json`. `src/extension/test-fixtures/**` IS hashed: the synthetic opencode is the
//    server the run drives, so a change there moves the checks (and `selectForFiles` calls it
//    cross-cutting).
//  - `test/visual/*.mjs` except tests, `compare-runs.mjs` and this file (post-processors that
//    never feed the run). `run.mjs`, `steps.mjs`, `affected.mjs`, `vscodeProcess.mjs` and
//    `webviewCdp.mjs` ARE the harness.
//  - Raw (line endings normalised): `package.json`, `package-lock.json`, `esbuild.mjs`,
//    `webview-ui/build.mjs`, `webview-ui/vite.config.mts` and `webview-ui/index.html` when it exists
//    (today it does not: Vite's HTML is generated).
//  - `media/**` (the icons the run captures), without compiling: text files (`.svg`, `.json`,
//    `.html`, `.txt`) with normalised line endings, anything else as raw bytes.
//
// WHAT THE FINGERPRINT DOES NOT SEE (a stale run can hide any of these):
//  - the VS Code version (the run prints "Validated version" apart);
//  - `node_modules` changed without a lockfile change, and the Node version;
//  - any file outside the list: `.vscode-test.mjs`, `test/integration/**`, `scripts/`, `docs/`, tsconfigs, the
//    opencode binary the run does not use (it uses the synthetic one);
//  - a change that only alters types: it does not alter the runtime, `check-types` covers it;
//  - a comment that changes behaviour at runtime (none known; `esbuild` keeps `/*! legal */`
//    comments only when asked, and here they are dropped);
//  - an untracked or ignored file that the code imports from outside the list;
//  - the OS and the display: a run on Windows says nothing about macOS or Linux.
//
// Pure functions below take the root as an argument so `fingerprint.test.mjs` can use a temporary
// tree. The CLI at the bottom is the only part that reads `process.argv`.
import { transformSync } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectForFiles } from './affected.mjs';

/** Files that are raw-hashed when present. */
const RAW_FILES = [
  'package.json',
  'package-lock.json',
  'esbuild.mjs',
  'webview-ui/build.mjs',
  'webview-ui/vite.config.mts',
  'webview-ui/index.html',
];

/** esbuild loader per extension; an extension not listed is hashed raw. */
const LOADERS = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.css': 'css',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
};

/** Extensions of non-compiled files that are text: hashed with normalised line endings. */
const TEXT_EXTENSIONS = new Set(['.svg', '.json', '.html', '.txt']);

/** A test file: same shape as the no-effect rule of `affected.mjs`. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Files of a source tree that are not code: Markdown and tsconfigs. */
const NOT_CODE = /(\.md$|(^|\/)tsconfig[^/]*\.json$)/;

/** Lists the files under `dir` (relative to `root`, `/` separators), skipping `node_modules`. */
function walk(root, dir) {
  const out = [];
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) return out;
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(root, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/**
 * The relative paths (`/` separators, sorted) that make up the fingerprint of the tree at `root`.
 * The rule and the reasons for each include or exclude are in the header of this file.
 */
export function hashedFiles(root) {
  const files = [];
  for (const dir of ['src', 'webview-ui/src']) {
    for (const rel of walk(root, dir)) {
      if (!TEST_FILE.test(rel) && !NOT_CODE.test(rel)) files.push(rel);
    }
  }
  for (const rel of walk(root, 'test/visual')) {
    const name = rel.slice('test/visual/'.length);
    if (name.includes('/') || !name.endsWith('.mjs') || TEST_FILE.test(name)) continue;
    if (name === 'compare-runs.mjs' || name === 'fingerprint.mjs') continue;
    files.push(rel);
  }
  files.push(...walk(root, 'media'));
  for (const rel of RAW_FILES) if (fs.existsSync(path.join(root, rel))) files.push(rel);
  return [...new Set(files)].sort();
}

/** Line endings to `\n`, so a Windows checkout with autocrlf hashes like a Linux one. */
function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n');
}

/**
 * The sha256 (hex) of one file as the fingerprint sees it: esbuild's output for source files, the
 * text with normalised line endings for the text files without a loader, and the raw bytes for
 * any other extension (a binary read as utf8 would collapse its non-utf8 bytes to U+FFFD). A file
 * esbuild cannot parse is hashed raw (marked, so it differs from a parsed twin): a syntax error
 * must not make the fingerprint throw, and the run itself would fail on it anyway.
 */
export function digestFile(root, rel) {
  const bytes = fs.readFileSync(path.join(root, rel));
  const ext = path.extname(rel);
  const loader = RAW_FILES.includes(rel) ? undefined : LOADERS[ext];
  if (loader === undefined && !RAW_FILES.includes(rel) && !TEXT_EXTENSIONS.has(ext)) {
    return createHash('sha256').update('bin\n').update(bytes).digest('hex');
  }
  const text = normalizeEol(bytes.toString('utf8'));
  let body = `raw\n${text}`;
  if (loader !== undefined) {
    try {
      body = `code\n${transformSync(text, { loader, legalComments: 'none' }).code}`;
    } catch {
      // keep the raw body: see the header of this function
    }
  }
  return createHash('sha256').update(body).digest('hex');
}

/** Combines a `{ path: digest }` map into the single fingerprint (sha256 hex of the sorted pairs). */
export function combine(digests) {
  const hash = createHash('sha256');
  for (const rel of Object.keys(digests).sort()) hash.update(`${rel}\0${digests[rel]}\n`);
  return hash.digest('hex');
}

/**
 * The fingerprint of the tree at `root`: `{ hash, digests }`, `digests` being the per-file map
 * the manifest stores. VERIFIED on Windows 11 (31/10/2026): `node test/visual/fingerprint.mjs
 * --print` on this tree took 0.35 s wall clock, so doing it at the start of every run is free
 * (measured before `media/` was added to the list; a handful of small icons).
 */
export function fingerprint(root) {
  const digests = {};
  for (const rel of hashedFiles(root)) digests[rel] = digestFile(root, rel);
  return { hash: combine(digests), digests };
}

/** Where the manifest of a fingerprint lives: outside `.vscode-test/visual`, which a run recreates. */
export function manifestPath(root, hash) {
  return path.join(root, '.vscode-test', 'fingerprints', `${hash}.json`);
}

/** Saves the per-file digests of `fp` so `--check` can list the changed files later. */
export function saveManifest(root, fp) {
  const file = manifestPath(root, fp.hash);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(fp.digests)}\n`);
}

/** Reads a manifest, or `undefined` when there is none (a run from before it, or another checkout). */
export function loadManifest(root, hash) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(root, hash), 'utf8'));
  } catch {
    return undefined;
  }
}

/** Files that differ between two digest maps: `{ changed, added, removed }`, each sorted. */
export function diffDigests(before, after) {
  const changed = [];
  const added = [];
  const removed = [];
  for (const rel of Object.keys(after)) {
    if (!(rel in before)) added.push(rel);
    else if (before[rel] !== after[rel]) changed.push(rel);
  }
  for (const rel of Object.keys(before)) if (!(rel in after)) removed.push(rel);
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() };
}

/** The hash of the first `fingerprint <sha256>` line of a saved run, or `undefined`. */
export function parseFingerprintLine(text) {
  return /^fingerprint ([0-9a-f]{64})\s*$/m.exec(text)?.[1];
}

/**
 * Decides whether a saved run still covers the tree at `root`.
 *
 * Returns `{ status, ... }`: `'no-line'` (the output has no fingerprint line: a run from before
 * phase 3), `'covers'` (same hash; `partial` is the `PARTIAL RUN` line when the run was filtered,
 * because then it covers the tree only for the steps it ran; `passed` is whether the output
 * contains the final "all visual checks passed"; `bail` is whether it carries the `--bail`
 * banner), or `'stale'` with `files` (the `<kind> <path>` lines that changed, or `undefined` when
 * the manifest is missing) and `selection` (what `selectForFiles` returns for them; `undefined`
 * without the list). Same tree is not enough to be evidence: a run that failed or was cut by
 * `--bail` covers the code and proves nothing, which {@link report} turns into exit 3.
 */
export function checkRun(root, savedText) {
  const saved = parseFingerprintLine(savedText);
  if (saved === undefined) return { status: 'no-line' };
  const current = fingerprint(root);
  const partial = /^PARTIAL RUN .*$/m.exec(savedText)?.[0];
  const passed = /^all visual checks passed\s*$/m.test(savedText);
  const bail = /^--bail: the run stops after the first step that fails/m.test(savedText);
  if (current.hash === saved) return { status: 'covers', hash: saved, partial, passed, bail };
  const manifest = loadManifest(root, saved);
  if (manifest === undefined) return { status: 'stale', hash: saved, current: current.hash };
  const diff = diffDigests(manifest, current.digests);
  const all = [...diff.changed, ...diff.added, ...diff.removed];
  return {
    status: 'stale',
    hash: saved,
    current: current.hash,
    files: [
      ...diff.changed.map((f) => `changed ${f}`),
      ...diff.added.map((f) => `added ${f}`),
      ...diff.removed.map((f) => `removed ${f}`),
    ],
    selection: selectForFiles(all),
  };
}

/**
 * Prints the result of {@link checkRun} and returns the exit code: 0 the run covers the tree and
 * ended "all visual checks passed" (and was not a `--bail` run), 1 stale, 2 no fingerprint line,
 * 3 same tree but not evidence (no "all visual checks passed", i.e. it failed or was cut, or it
 * was a `--bail` run). A filtered run still exits 0 when it passed, with the warning printed.
 * Exported for the test; the text of the warnings is not part of the contract, the codes are.
 */
export function report(result) {
  if (result.status === 'no-line') {
    console.log('no `fingerprint` line in that output: it predates phase 3, so it covers nothing');
    return 2;
  }
  if (result.status === 'covers') {
    console.log(`same tree as the current one (fingerprint ${result.hash})`);
    if (result.partial !== undefined) {
      console.log(`but the run was filtered (${result.partial}): only for the steps it ran`);
    }
    if (result.bail || !result.passed) {
      console.log(
        result.bail
          ? 'but it was a --bail run: not evidence'
          : 'but the output does not end in "all visual checks passed": the run failed or was cut; not evidence',
      );
      return 3;
    }
    console.log('and it ended "all visual checks passed": covers the current tree');
    return 0;
  }
  console.log(`does NOT cover the current tree (run ${result.hash}, now ${result.current})`);
  if (result.files === undefined) {
    console.log('no manifest of that run: cannot list the files; treat it as a full rerun');
    return 1;
  }
  for (const line of result.files) console.log(`  ${line}`);
  const { mode, groups, reasons } = result.selection;
  console.log(`selectForFiles: ${mode === 'groups' ? groups.join(', ') : mode}`);
  for (const reason of reasons) console.log(`  ${reason}`);
  return 1;
}

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === '--print' && args.length === 1) {
    console.log(`fingerprint ${fingerprint(repoRoot).hash}`);
  } else if (args[0] === '--check' && args.length === 2) {
    process.exit(report(checkRun(repoRoot, fs.readFileSync(args[1], 'utf8'))));
  } else {
    console.error('usage: node test/visual/fingerprint.mjs --print | --check <saved-output>');
    process.exit(2);
  }
}
