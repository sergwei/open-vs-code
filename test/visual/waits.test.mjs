// Protects the rule that every FIXED wait of `test/visual/run.mjs` says why it is fixed (issue #199,
// Engram #2134). Reads the text of run.mjs, so it checks that the comments are there, NOT that the
// waits are the right length: that is what two `--steps` passes and `== waits` show. The rule is
// the one of the `escribir-tests` skill: a `sleep` or `waitForTimeout` is either a negative window
// (`// negative window: <what must not happen>`, after the positive wait that precedes it) or an
// evasion of a known problem (`// kept: <cause>`); anything else is a wait for a condition and
// belongs in `waitFor`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const runSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'run.mjs'),
  'utf8',
);
const lines = runSource.split(/\r?\n/);

/** Matches a marker in a comment: the two forms the rule allows. */
const MARK = /\/\/ (negative window|kept):/;
/** A call of the traced fixed waits; `rawSleep` (the polling pause of `waitFor`) does not match. */
const FIXED_WAIT = /\bawait sleep\(|\.waitForTimeout\(/;

/**
 * Lines (1-based) with a fixed-wait call that has no marker on its own line or in the block of
 * `//` comment lines right above it. Lines that are themselves comments (a TSDoc that names
 * `await sleep(…)`) are not calls.
 */
function unmarkedWaits() {
  const found = [];
  lines.forEach((line, index) => {
    const code = line.trim();
    if (code.startsWith('*') || code.startsWith('//') || !FIXED_WAIT.test(line)) return;
    if (MARK.test(line)) return;
    for (let above = index - 1; above >= 0 && lines[above].trim().startsWith('//'); above -= 1) {
      if (MARK.test(lines[above])) return;
    }
    found.push(`${String(index + 1)}: ${code}`);
  });
  return found;
}

describe('fixed waits of run.mjs', () => {
  it('finds the calls (a regex that matches nothing would make the next test vacuous)', () => {
    const calls = lines.filter(
      (line) => FIXED_WAIT.test(line) && !/^\s*(\*|\/\/)/.test(line),
    ).length;
    expect(calls).toBeGreaterThan(40);
  });

  it('marks every sleep and waitForTimeout as a negative window or as kept, with its cause', () => {
    expect(unmarkedWaits()).toEqual([]);
  });

  it('recognizes an unmarked call and both marks (the matcher itself)', () => {
    expect(MARK.test('await sleep(1); // negative window: nothing may open')).toBe(true);
    expect(MARK.test('await sleep(1); // kept: first character lost')).toBe(true);
    expect(MARK.test('await sleep(1); // the list filters asynchronously')).toBe(false);
    expect(FIXED_WAIT.test('  await page.waitForTimeout(800);')).toBe(true);
    expect(FIXED_WAIT.test('  await rawSleep(150);')).toBe(false);
  });
});
