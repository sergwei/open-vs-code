// Compares the assertion lines of two `npm run test:visual` outputs (issue #89).
//
// `node test/visual/compare-runs.mjs [--present-only] <base> <new> [<base2>]`. The lines are
// grouped by step and compared as multisets (`steps.mjs`). With `<base2>`, a second run of the
// SAME code as `<base>`, the lines that differ between those two are volatile and left out. With
// `--present-only` only the steps `<new>` printed are compared (for a `--steps` run against a full
// baseline). Exit 0 with no differences, 1 with some, 2 on a wrong call. Reads files only; it does
// not start anything.
import fs from 'node:fs';
import { compareRuns, extractChecks, restrictToPresent, volatileBetween } from './steps.mjs';

const args = process.argv.slice(2);
const presentOnly = args.includes('--present-only');
const [basePath, newPath, base2Path] = args.filter((arg) => arg !== '--present-only');
if (basePath === undefined || newPath === undefined) {
  console.error('usage: node test/visual/compare-runs.mjs [--present-only] <base> <new> [<base2>]');
  process.exit(2);
}

const read = (file) => extractChecks(fs.readFileSync(file, 'utf8'));
const next = read(newPath);
const baseFull = read(basePath);
const base = presentOnly ? restrictToPresent(baseFull, next) : baseFull;
const volatile = base2Path === undefined ? new Set() : volatileBetween(baseFull, read(base2Path));
const { differences, okA, okB, warnsA, warnsB, racesA, racesB } = compareRuns(base, next, volatile);

console.log(`volatile lines left out: ${String(volatile.size)}`);
console.log(
  `environment: clock times, UUIDs and clipboard format counts are normalised; webview-host race warnings counted apart: base ${String(racesA)}, new ${String(racesB)}`,
);
console.log(
  `ok lines: base ${String(okA)}, new ${String(okB)}; warn lines: base ${String(warnsA)}, new ${String(warnsB)}`,
);
for (const { id, line, a, b } of differences) {
  console.log(`step ${id}: base x${String(a)}, new x${String(b)}: ${line}`);
}
console.log(
  differences.length === 0 ? 'no differences' : `${String(differences.length)} differences`,
);
process.exit(differences.length === 0 ? 0 : 1);
