// Checks that a release tag, package.json and CHANGELOG.md agree (issue #43).
//
// The release workflow (.github/workflows/release.yml) runs this before packaging, so a tag that
// does not match the manifest, or a version with no changelog entry, stops the run before anything
// is built or published. It also re-checks the version found INSIDE the packaged .vsix, because
// the .vsix is the file that gets published to both registries.
//
// Only stable releases: the tag must be `vMAJOR.MINOR.PATCH`. The Marketplace rejects semver
// pre-release suffixes (`-beta.1`) and this project publishes no pre-release channel (decision of
// issue #43), so there is no odd/even minor rule here.
//
// Usage:
//   node scripts/check-release.mjs --tag v1.2.3     release mode: tag, manifest, CHANGELOG must agree
//   node scripts/check-release.mjs --dry-run        test mode: synthetic tag `v<version>`; a missing
//                                                   CHANGELOG section is a WARNING, not an error
//   node scripts/check-release.mjs --packaged <package.json extracted from the .vsix>  [with either]
//   Optional: --manifest <path> (default package.json) and --changelog <path> (default CHANGELOG.md).
// When GITHUB_OUTPUT is set, appends `version=<x.y.z>` to it.
// Exit code 0 when fine, 1 with one ERROR line per problem. ASCII only on purpose: it prints to
// Windows consoles with arbitrary code pages.

import { appendFileSync, readFileSync } from 'node:fs';

const STABLE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Validates a release tag against the manifest version and the changelog text.
 *
 * Pure: no I/O, so it can be exercised with hand-made strings. In release mode (`dryRun` false)
 * the tag must be exactly `v` + a plain `MAJOR.MINOR.PATCH` (no suffix, no missing `v`), equal to
 * `version`, and CHANGELOG.md needs a `## [X.Y.Z] - YYYY-MM-DD` heading with at least one `- `
 * bullet under it. In dry-run mode the tag is synthetic (`v<version>`), so only the version shape
 * is an error and a missing changelog section is reported as a warning, which keeps the test run
 * on `main` (still on `## [Unreleased]`) green while saying that a real tag would fail.
 * Returns `{ problems, warnings, version }`; `problems` empty means the release may go on.
 * VERIFIED by `releaseCheck.test.ts`, which runs the real CLI on hand-made fixtures: "accepts a
 * matching tag, version and changelog entry" and the rejection cases passed (Windows 11,
 * 2026-10-25). UNVERIFIED on macOS/Linux until `npm test` runs there in CI.
 */
export function checkRelease({ tag, version, changelog, dryRun }) {
  const problems = [];
  const warnings = [];

  if (!STABLE_VERSION.test(version)) {
    problems.push(
      `package.json version "${version}" is not a plain MAJOR.MINOR.PATCH (the Marketplace rejects suffixes).`,
    );
  }

  if (!dryRun) {
    const tagMatch = /^v(\d+\.\d+\.\d+)$/.exec(tag);
    if (!tagMatch) {
      problems.push(
        `Tag "${tag}" is not of the form vMAJOR.MINOR.PATCH (no suffix such as -beta.1, and the leading v is required).`,
      );
    } else if (tagMatch[1] !== version) {
      problems.push(`Tag ${tag} does not match package.json version ${version}.`);
    }
  }

  if (STABLE_VERSION.test(version)) {
    const hasEntry = changelogEntryHasBullets(changelog, version);
    if (!hasEntry) {
      const message = `CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section with at least one "- " line.`;
      if (dryRun) {
        warnings.push(`${message} A real tag would fail here.`);
      } else {
        problems.push(message);
      }
    }
  }

  return { problems, warnings, version };
}

/**
 * True when the changelog has a dated `## [version] - YYYY-MM-DD` heading followed by at least one
 * `- ` bullet before the next `## ` heading.
 *
 * The version is escaped before it goes into the regular expression, so the dots only match dots.
 * Line endings may be LF or CRLF.
 */
function changelogEntryHasBullets(changelog, version) {
  const escaped = version.replaceAll('.', '\\.');
  const heading = new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}[ \\t]*$`, 'm');
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return false;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) return false;
    if (lines[i].startsWith('- ')) return true;
  }
  return false;
}

/**
 * Compares the version inside the packaged `package.json` (extracted from the .vsix) with the
 * expected one, and returns one message per problem.
 *
 * It exists because the .vsix is what gets published: a stale `dist/` or a manifest edited after
 * packaging would otherwise ship under a version the checks above never looked at. Unparseable
 * JSON is itself a problem. Pure: no I/O.
 * VERIFIED by `releaseCheck.test.ts` ("rejects a packaged manifest with another version",
 * Windows 11, 2026-10-25). Not run against a real .vsix yet: that happens in the release workflow.
 */
export function checkPackagedVersion(expectedVersion, packagedManifestText) {
  let parsed;
  try {
    parsed = JSON.parse(packagedManifestText);
  } catch (error) {
    return [`The packaged package.json is not valid JSON: ${error.message}`];
  }
  const packaged = typeof parsed === 'object' && parsed !== null ? parsed.version : undefined;
  if (packaged !== expectedVersion) {
    return [`The .vsix contains version ${String(packaged)}, expected ${expectedVersion}.`];
  }
  return [];
}

/**
 * Reads the value that follows `--name` in `argv`, or undefined when the flag is absent or last.
 */
function optionValue(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

/**
 * Parses the command line, runs the checks, prints the result and sets the exit code.
 *
 * Sets `process.exitCode = 1` instead of calling `process.exit`, so stdout is flushed on every
 * platform. Needs `--tag <name>` or `--dry-run`; anything else is a usage error (exit 1). Unreadable
 * files exit 1 with a message. Appends `version=<x.y.z>` to the file named by `GITHUB_OUTPUT` only
 * when every check passed.
 * VERIFIED on Windows 11 (2026-10-25) with `--dry-run`, `--tag v0.0.1` and `--tag v9.9.9` against
 * this repository, and by `releaseCheck.test.ts` for the GITHUB_OUTPUT line.
 */
function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const tagArg = optionValue(argv, '--tag');
  if (!dryRun && !tagArg) {
    console.error(
      'Usage: node scripts/check-release.mjs (--tag <vX.Y.Z> | --dry-run) [--packaged <file>]',
    );
    process.exitCode = 1;
    return;
  }
  const manifestPath = optionValue(argv, '--manifest') ?? 'package.json';
  const changelogPath = optionValue(argv, '--changelog') ?? 'CHANGELOG.md';
  const packagedPath = optionValue(argv, '--packaged');

  let version;
  let changelog;
  let packagedText;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    version = String(manifest.version);
    changelog = readFileSync(changelogPath, 'utf8');
    if (packagedPath) packagedText = readFileSync(packagedPath, 'utf8');
  } catch (error) {
    console.error(`ERROR: cannot read the release inputs: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const tag = dryRun ? `v${version}` : tagArg;
  const result = checkRelease({ tag, version, changelog, dryRun });
  const problems = [...result.problems];
  if (packagedText !== undefined) problems.push(...checkPackagedVersion(version, packagedText));

  for (const warning of result.warnings) console.log(`WARNING: ${warning}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`ERROR: ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK: ${dryRun ? 'dry run for' : 'release'} ${tag} (version ${version})`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  }
}

main();
