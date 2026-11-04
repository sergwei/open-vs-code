import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Protects `scripts/check-vsix.mjs --from-vsix` (issue #43): the release workflow feeds it the
// raw `unzip -Z1` listing of the .vsix, and vsce renames three files inside the zip. The first
// version of the workflow failed on every run with "Missing from the package: README.md" because
// nothing had ever fed the check a listing of a real zip (seen in the dry run of PR #76).
// REAL_LISTING is the literal output of `unzip -Z1` on a .vsix packed by `npm run vsix`
// (vsce 4.0.0, Windows 11, 2026-10-25, without the CI canary files), not a hand-made list; the
// forbidden-file cases are hand-made variations of it (and E11-i18n added the `package.nls.json`
// entry by hand). Linux/macOS UNVERIFIED until CI runs this.

const SCRIPT = fileURLToPath(new URL('../../scripts/check-vsix.mjs', import.meta.url));

const REAL_LISTING = [
  'extension.vsixmanifest',
  '[Content_Types].xml',
  'extension/changelog.md',
  'extension/LICENSE.txt',
  'extension/package.json',
  'extension/package.nls.json',
  'extension/readme.md',
  'extension/media/activity.svg',
  'extension/media/icon.png',
  'extension/dist/extension.js',
  'extension/dist/modWorker.js',
  'extension/dist/webview/assets/index.js',
  'extension/dist/webview/assets/style.css',
];

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'check-vsix-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs the script as the workflow does, on a listing file written to the temp directory. */
function run(lines: string[], flags: string[]): { status: number | null; stderr: string } {
  const list = join(dir, 'vsix-files.txt');
  writeFileSync(list, lines.join('\n') + '\n');
  const result = spawnSync(process.execPath, [SCRIPT, ...flags, list], { encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

describe('scripts/check-vsix.mjs --from-vsix', () => {
  it('accepts the real unzip listing of a packed .vsix, with the three vsce renames', () => {
    const result = run(REAL_LISTING, ['--from-vsix']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('rejects that same listing without --from-vsix (the original workflow bug)', () => {
    const result = run(REAL_LISTING, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing from the package: README.md');
    expect(result.stderr).toContain('Missing from the package: CHANGELOG.md');
    expect(result.stderr).toContain('Missing from the package: LICENSE');
  });

  it('still reports a file that is really missing from the zip', () => {
    const result = run(
      REAL_LISTING.filter((l) => l !== 'extension/readme.md'),
      ['--from-vsix'],
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing from the package: README.md');
  });

  it('still reports a forbidden file packed into the zip', () => {
    const result = run(
      [...REAL_LISTING, 'extension/CLAUDE.md', 'extension/.claude/canary.md'],
      ['--from-vsix'],
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('forbidden file): CLAUDE.md');
    expect(result.stderr).toContain('forbidden directory): .claude/canary.md');
  });

  it('ignores the manifest files at the zip root and directory entries', () => {
    const result = run([...REAL_LISTING, 'extension/dist/', 'extension/media/'], ['--from-vsix']);
    expect(result.status).toBe(0);
  });

  it('fails on a listing with nothing under extension/', () => {
    const result = run(['extension.vsixmanifest', '[Content_Types].xml'], ['--from-vsix']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('The file list is empty');
  });

  // E11-i18n. `REAL_LISTING` has the base manifest catalog since then (hand-added: the
  // listing was taken before it existed); without it, vsce ships no translated manifest at all.
  it('requires package.nls.json', () => {
    const result = run(
      REAL_LISTING.filter((l) => l !== 'extension/package.nls.json'),
      ['--from-vsix'],
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing from the package: package.nls.json');
  });

  it('accepts a language that ships both of its catalogs', () => {
    const result = run(
      [
        ...REAL_LISTING,
        'extension/package.nls.es.json',
        'extension/l10n/bundle.l10n.json',
        'extension/l10n/bundle.l10n.es.json',
      ],
      ['--from-vsix'],
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('reports a language that ships only one of its two catalogs', () => {
    const manifestOnly = run([...REAL_LISTING, 'extension/package.nls.es.json'], ['--from-vsix']);
    expect(manifestOnly.status).toBe(1);
    expect(manifestOnly.stderr).toContain(
      'Language "es" ships package.nls.es.json without l10n/bundle.l10n.es.json',
    );

    const bundleOnly = run(
      [...REAL_LISTING, 'extension/l10n/bundle.l10n.es.json'],
      ['--from-vsix'],
    );
    expect(bundleOnly.status).toBe(1);
    expect(bundleOnly.stderr).toContain(
      'Language "es" ships l10n/bundle.l10n.es.json without package.nls.es.json',
    );
  });
});
