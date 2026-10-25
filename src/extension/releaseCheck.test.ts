import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Protects `scripts/check-release.mjs` (issue #43), the gate that stops the release workflow when
// the tag, package.json and CHANGELOG.md disagree. The script is run as a CLI, like the workflow
// does, on fixtures written to a temporary directory: the inputs are hand-made, so these tests
// confirm the version logic only; they say nothing about a real tag or a real .vsix (that is
// exercised by the dry run of release.yml on the pull request). Cases come from the plan of #43,
// not from an observed failure. VERIFIED on Windows 11 with `npm test` (2026-10-25); macOS and
// Linux UNVERIFIED until the CI matrix runs this file.

const SCRIPT = fileURLToPath(new URL('../../scripts/check-release.mjs', import.meta.url));

const CHANGELOG_WITH_ENTRY = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '## [1.2.3] - 2026-11-01',
  '',
  '### Added',
  '',
  '- Something.',
  '',
  '## [1.2.2] - 2026-10-01',
  '',
].join('\n');

const CHANGELOG_UNRELEASED_ONLY = ['# Changelog', '', '## [Unreleased]', '', '- Something.'].join(
  '\n',
);

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'check-release-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Writes the fixtures to the temporary directory and runs the real script on them.
 *
 * `packagedVersion`, when given, is written as the `package.json` extracted from a .vsix. The
 * GITHUB_OUTPUT file is always provided, so tests can read the `version=` line; its path is
 * returned too. Returns the exit status and both streams as text.
 */
function run(
  args: string[],
  options: {
    version?: string;
    changelog?: string;
    packagedVersion?: string;
    packagedText?: string;
  },
): RunResult & { outputPath: string } {
  const manifest = join(dir, 'package.json');
  const changelog = join(dir, 'CHANGELOG.md');
  const outputPath = join(dir, 'github-output.txt');
  writeFileSync(manifest, JSON.stringify({ version: options.version ?? '1.2.3' }));
  writeFileSync(changelog, options.changelog ?? CHANGELOG_WITH_ENTRY);
  writeFileSync(outputPath, '');
  const extra = ['--manifest', manifest, '--changelog', changelog];
  if (options.packagedVersion !== undefined || options.packagedText !== undefined) {
    const packaged = join(dir, 'vsix-package.json');
    writeFileSync(
      packaged,
      options.packagedText ?? JSON.stringify({ version: options.packagedVersion }),
    );
    extra.push('--packaged', packaged);
  }
  const result = spawnSync(process.execPath, [SCRIPT, ...args, ...extra], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: outputPath },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, outputPath };
}

describe('scripts/check-release.mjs', () => {
  it('accepts a matching tag, version and changelog entry and writes the version output', () => {
    const result = run(['--tag', 'v1.2.3'], {});
    expect(result.status).toBe(0);
    expect(readFileSync(result.outputPath, 'utf8')).toBe('version=1.2.3\n');
  });

  it('rejects a tag that differs from the package.json version and names both', () => {
    const result = run(['--tag', 'v1.2.4'], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('v1.2.4');
    expect(result.stderr).toContain('1.2.3');
    expect(readFileSync(result.outputPath, 'utf8')).toBe('');
  });

  it('rejects a pre-release tag suffix', () => {
    const result = run(['--tag', 'v1.2.3-beta.1'], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('v1.2.3-beta.1');
  });

  it('rejects a tag without the leading v', () => {
    const result = run(['--tag', '1.2.3'], {});
    expect(result.status).toBe(1);
  });

  it('rejects a package.json version with a pre-release suffix', () => {
    const result = run(['--tag', 'v1.2.3'], { version: '1.2.3-beta.1' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('1.2.3-beta.1');
  });

  it('rejects a tag whose version has no dated changelog section', () => {
    const result = run(['--tag', 'v1.2.3'], { changelog: CHANGELOG_UNRELEASED_ONLY });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CHANGELOG.md');
  });

  it('rejects a changelog section with no bullet under it', () => {
    const empty = [
      '# Changelog',
      '',
      '## [1.2.3] - 2026-11-01',
      '',
      '## [1.2.2] - 2026-10-01',
      '- Old.',
    ].join('\n');
    const result = run(['--tag', 'v1.2.3'], { changelog: empty });
    expect(result.status).toBe(1);
  });

  it('does not let the dots of the version match any character in the changelog', () => {
    const lookalike = ['# Changelog', '', '## [1x2x3] - 2026-11-01', '', '- Something.'].join('\n');
    const result = run(['--tag', 'v1.2.3'], { changelog: lookalike });
    expect(result.status).toBe(1);
  });

  it('accepts a changelog with CRLF line endings', () => {
    const result = run(['--tag', 'v1.2.3'], {
      changelog: CHANGELOG_WITH_ENTRY.replaceAll('\n', '\r\n'),
    });
    expect(result.status).toBe(0);
  });

  it('dry run with only [Unreleased] exits 0 and warns that a real tag would fail', () => {
    const result = run(['--dry-run'], { changelog: CHANGELOG_UNRELEASED_ONLY });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('WARNING');
    expect(result.stdout).toContain('A real tag would fail');
  });

  it('dry run still rejects a version with a pre-release suffix', () => {
    const result = run(['--dry-run'], { version: '1.2.3-rc.1' });
    expect(result.status).toBe(1);
  });

  it('fails with a usage message when given neither --tag nor --dry-run', () => {
    const result = run([], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage');
  });

  it('exits 1 with a read error when the manifest cannot be read', () => {
    const result = run(['--dry-run', '--manifest', join(dir, 'nope.json')], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR: cannot read the release inputs');
  });

  it('fails with a usage message when a flag has no value', () => {
    const result = run(['--tag'], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--tag needs a value');
  });

  it('rejects a packaged manifest that is not JSON', () => {
    const result = run(['--tag', 'v1.2.3'], { packagedText: 'not json {' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not valid JSON');
  });

  it('accepts a packaged manifest with the expected version', () => {
    const result = run(['--tag', 'v1.2.3'], { packagedVersion: '1.2.3' });
    expect(result.status).toBe(0);
  });

  it('rejects a packaged manifest with another version', () => {
    const result = run(['--tag', 'v1.2.3'], { packagedVersion: '1.2.2' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('1.2.2');
    expect(readFileSync(result.outputPath, 'utf8')).toBe('');
  });
});
