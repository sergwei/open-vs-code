import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Protects the security invariants of the GitHub workflows (issue #43): nothing that can publish
// or read a token may be reachable from a dry run, tokens never reach a command line, and every
// action is pinned to a commit. The workflows are read as TEXT with line-based checks (no YAML
// dependency), so these tests see the shape of the file, not what GitHub would evaluate: they are
// a tripwire for edits, and the real boundary is the `release` environment on GitHub.
//
// Mutations applied by hand to release.yml and seen RED (Windows 11, 2026-10-25), then reverted;
// the tests that failed, by their titles:
// - deleting the tag `if:` of `publish-marketplace`: "has a tag-only `if` and the release
//   environment on both publish jobs, and nowhere else";
// - pinning `actions/setup-node` to `@v7`: "pins every `uses:` to a 40-hex commit SHA with the tag
//   in a comment";
// - moving `VSCE_PAT` to the job-level `env:` of `publish-marketplace`: "references only VSCE_PAT
//   and OVSX_PAT, each in its own job and in a step-level env";
// - `${{ github.head_ref }}` inside the multi-line `run:` of the Summary step: "puts the tag name
//   in an env var, never inside a `run:` script";
// - removing `persist-credentials: false` from the package checkout: "never persists the
//   checkout credentials";
// - turning `if ! git merge-base --is-ancestor` into `if git merge-base …`: "checks the tagged
//   commit is on main in the package job".
// macOS and Linux UNVERIFIED until the CI matrix runs this file.

const WORKFLOWS_DIR = new URL('../../.github/workflows/', import.meta.url);

/** Reads every `*.yml` in `.github/workflows` as `{ name, text }`; fails if there are none. */
function readWorkflows(): { name: string; text: string }[] {
  const names = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yml'));
  expect(names.length).toBeGreaterThan(0);
  return names.map((name) => ({
    name,
    text: readFileSync(new URL(name, WORKFLOWS_DIR), 'utf8'),
  }));
}

/** The text of one workflow; throws if it does not exist (the wanted failure). */
function readWorkflow(name: string): string {
  return readFileSync(new URL(name, WORKFLOWS_DIR), 'utf8');
}

/**
 * Splits a workflow into its top-level jobs, returning each job's text by name.
 *
 * Relies on the layout used here: `jobs:` at column 0 and job names at two spaces of indent.
 */
function splitJobs(text: string): Map<string, string> {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l === 'jobs:');
  expect(start).toBeGreaterThan(-1);
  const jobs = new Map<string, string>();
  let current: string | undefined;
  let buffer: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([\w-]+):\s*$/.exec(line);
    if (header) {
      if (current !== undefined) jobs.set(current, buffer.join('\n'));
      current = header[1];
      buffer = [];
    } else if (current !== undefined) {
      buffer.push(line);
    }
  }
  if (current !== undefined) jobs.set(current, buffer.join('\n'));
  return jobs;
}

/** Lines of `text` that are not comments. */
function codeLines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l));
}

/** The `if:` of a publish job, at job level (four spaces: job name 2, key 4). */
const TAG_IF = "    if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')";

/**
 * Returns the full body of every `run:` in `text`: the inline value, or all the lines after the
 * key that are indented deeper than it (a block scalar, `|` or `>`), blank lines included.
 *
 * Why it exists: checking a few known lines let a `${{ github.head_ref }}` inside a multi-line
 * `run:` go through; the body has to be collected whole. Relies on the layout used here (block
 * scalars indented deeper than the `run:` key, no flow-style YAML).
 */
function runBodies(text: string): string[] {
  const lines = codeLines(text);
  const bodies: string[] = [];
  lines.forEach((line, i) => {
    const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (!match) return;
    const keyIndent = line.indexOf('run:');
    const body = [match[2]];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() === '') {
        body.push(next);
        continue;
      }
      if (next.length - next.trimStart().length <= keyIndent) break;
      body.push(next);
    }
    bodies.push(body.join('\n'));
  });
  return bodies;
}

/**
 * Returns, for every `uses: actions/checkout@…` in `text`, the lines of that step after the
 * `uses:` line (everything indented deeper than the step's own keys).
 */
function checkoutSteps(text: string): string[] {
  const lines = codeLines(text);
  const steps: string[] = [];
  lines.forEach((line, i) => {
    if (!/\buses:\s*actions\/checkout@/.test(line)) return;
    const indent = line.length - line.trimStart().length;
    const body: string[] = [];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() !== '' && next.length - next.trimStart().length < indent) break;
      body.push(next);
    }
    steps.push(body.join('\n'));
  });
  return steps;
}

describe('workflows: actions', () => {
  it('pins every `uses:` to a 40-hex commit SHA with the tag in a comment', () => {
    for (const { name, text } of readWorkflows()) {
      for (const line of codeLines(text)) {
        const match = /\buses:\s*(\S+)(.*)$/.exec(line);
        if (!match) continue;
        expect(match[1], `${name}: ${line.trim()}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
        expect(match[2], `${name}: ${line.trim()}`).toMatch(/^\s+# v\d/);
      }
    }
  });

  it('never persists the checkout credentials', () => {
    for (const { name, text } of readWorkflows()) {
      const steps = checkoutSteps(text);
      expect(steps.length, name).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step, name).toContain('persist-credentials: false');
      }
    }
  });
});

describe('workflows: release.yml', () => {
  const text = readWorkflow('release.yml');
  const jobs = splitJobs(text);
  const publishJobs = ['publish-marketplace', 'publish-open-vsx'];

  it('has the package job and the two publish jobs', () => {
    expect([...jobs.keys()]).toEqual(['package', ...publishJobs]);
  });

  it('starts with empty permissions and never uses pull_request_target', () => {
    expect(codeLines(text)).toContain('permissions: {}');
    expect(text).not.toContain('pull_request_target');
  });

  it('has a tag-only `if` and the release environment on both publish jobs, and nowhere else', () => {
    for (const name of publishJobs) {
      const job = jobs.get(name) ?? '';
      expect(job.split(/\r?\n/), name).toContain(TAG_IF);
      expect(job, name).toMatch(/environment:\n\s+name: release\n/);
    }
    expect(jobs.get('package')).not.toMatch(/^\s*environment:/m);
    expect(codeLines(text).filter((l) => /^\s+name: release$/.test(l))).toHaveLength(2);
  });

  it('does not let the dry run read a secret: `secrets.` appears only in the publish jobs', () => {
    expect(jobs.get('package')).not.toContain('secrets.');
    for (const name of publishJobs) {
      expect(jobs.get(name), name).toContain('secrets.');
    }
  });

  it('references only VSCE_PAT and OVSX_PAT, each in its own job and in a step-level env', () => {
    const expected: Record<string, string> = {
      'publish-marketplace': 'VSCE_PAT',
      'publish-open-vsx': 'OVSX_PAT',
    };
    for (const [name, token] of Object.entries(expected)) {
      const lines = codeLines(jobs.get(name) ?? '').filter((l) => l.includes('secrets.'));
      expect(lines.length, name).toBeGreaterThan(0);
      for (const line of lines) {
        // Ten spaces: the `env:` of a step (job name 2, `steps:` 4, `- name` 6, `env:` 8, key 10).
        // A job-level `env:` would put the key at six and expose the token to every step.
        expect(line, name).toMatch(
          new RegExp(`^ {10}${token}: \\$\\{\\{ secrets\\.${token} \\}\\}$`),
        );
      }
    }
  });

  it('never passes a token on a command line or interpolates a secret in `run:`', () => {
    for (const line of codeLines(text)) {
      if (/^\s*(run:|npx|npm |vsce|ovsx)/.test(line) || /\brun:/.test(line)) {
        expect(line).not.toMatch(/--pat\b|\s-p\s|\$\{\{\s*secrets/);
      }
    }
  });

  it('has no publish step outside the publish jobs', () => {
    expect(jobs.get('package')).not.toMatch(/\b(vsce|ovsx)\s+publish\b/);
  });

  it('publishes to Open VSX only after the Marketplace job', () => {
    expect(jobs.get('publish-open-vsx')).toContain('needs: [package, publish-marketplace]');
  });

  it('has no pre-release flag, no skip-duplicate and no OIDC permission (PAT flow)', () => {
    const code = codeLines(text).join('\n');
    expect(code).not.toContain('--pre-release');
    expect(code).not.toContain('--skip-duplicate');
    expect(code).not.toContain('id-token');
  });

  it('installs dependencies without scripts in the jobs that hold a token', () => {
    for (const name of publishJobs) {
      expect(jobs.get(name), name).toContain('npm ci --ignore-scripts');
    }
  });

  it('puts the tag name in an env var, never inside a `run:` script', () => {
    // Whole body of every `run:`, inline or block: no `${{ … }}` expression may be interpolated
    // into a script (script injection through `github.ref_name`, `head_ref`, …).
    const bodies = runBodies(text);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain('${{');
    }
  });

  it('checks the tagged commit is on main in the package job', () => {
    expect(jobs.get('package')).toContain('if ! git merge-base --is-ancestor');
  });

  it('writes the dry-run notice and the package job summary', () => {
    expect(text).toContain('DRY RUN — nothing was published');
    expect(text).toContain('Publishing $TAG');
  });
});
