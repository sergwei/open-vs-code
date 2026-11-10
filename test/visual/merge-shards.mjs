// Merges the outputs of the `--shard i/N` runs of `test/visual/run.mjs` into the ONE file that is
// evidence (tooling/visual-ci-parallel, issue #199).
//
// A shard is a PARTIAL run (its own VS Code, a contiguous run of the steps plus their `needs`), so
// no shard proves the tree by itself. What proves it is the set: this file checks that the shards
// are the N pieces of one split of one tree, takes from each only the steps it OWNS, and writes an
// output shaped like a full run (a `fingerprint` line, the `== <id>` sections in canonical order,
// the final state-file check once, `== timings`, and "all visual checks passed" only if every
// shard passed). `fingerprint.mjs --check` and `compare-runs.mjs` read it unchanged.
//
// CLI: `node test/visual/merge-shards.mjs <out> <shard-output>…`. Exit 0 the merge is valid and
// every shard passed, 1 the merge is valid but some shard failed (the file is still written, with
// no "all visual checks passed"), 2 the merge is invalid (no file is written, so a bad merge never
// looks like evidence). Depends only on `steps.mjs`: the aggregator job needs no `npm ci`.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BAIL_BANNER, COPILOT_BANNER, STEP_IDS, parseShardLine, shardPlan } from './steps.mjs';

/** Headers that close the assertion lines of a run (same set as `extractChecks` in `steps.mjs`). */
const CLOSING = new Set(['summary', 'timings', 'waits']);

/** The final state-file check of `run.mjs`: printed once per shard, merged into one line. */
const FINAL_CHECK = /^\s+(ok|FAIL)\s+the synthetic opencode kept the conversation/;

/** A line that `extractChecks` counts. */
const CHECK_LINE = /^\s+(ok|FAIL|warn)\s/;

/**
 * Reads one shard's output into what the merge needs.
 *
 * Returns `{ fingerprint, shard, bail, copilot, passed, preamble, sections, finals, timings,
 * total, warnings, failures, stopped, windowLine }`: `sections` maps a step id to `{ header, body,
 * count }` (the body without trailing blank lines and without the final-check line, which goes to
 * `finals`; `count` is how many times the header appeared), `preamble` is the lines before the
 * first `== ` header, `timings` maps an id to its `== timings` line, `total` is the seconds of the
 * `total` line, `warnings` and `failures` are the `  - ` items under `warnings (n):` and
 * `FAILED (n):`, `stopped` is whether a `STOPPED after step` line was printed. Pure.
 */
function parseShard(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  const result = {
    fingerprint: /^fingerprint ([0-9a-f]{64})$/m.exec(lines.join('\n'))?.[1],
    shard: parseShardLine(text),
    bail: lines.includes(BAIL_BANNER),
    copilot: lines.includes(COPILOT_BANNER),
    passed: lines.includes('all visual checks passed'),
    preamble: [],
    sections: new Map(),
    finals: [],
    timings: new Map(),
    total: 0,
    warnings: [],
    failures: [],
    stopped: lines.some((line) => line.startsWith('STOPPED after step ')),
    windowLine: lines.find((line) => line.startsWith('window ')),
  };
  let mode = 'preamble';
  let current;
  for (const line of lines) {
    const header = /^== (\S+)/.exec(line);
    if (header !== null) {
      if (CLOSING.has(header[1])) {
        mode = header[1];
        current = undefined;
      } else {
        mode = 'step';
        current = result.sections.get(header[1]) ?? { header: line, body: [], count: 0 };
        current.count += 1;
        result.sections.set(header[1], current);
      }
      continue;
    }
    if (mode === 'preamble') result.preamble.push(line);
    else if (mode === 'step') {
      if (FINAL_CHECK.test(line)) result.finals.push(line);
      else current.body.push(line);
    } else if (mode === 'timings') {
      const total = /^\s+total ([\d.]+) s/.exec(line);
      if (total !== null) result.total = Number(total[1]);
      else {
        const row = /^\s+(\S+)\s+[\d.]+ s\s/.exec(line);
        if (row !== null) result.timings.set(row[1], line);
      }
    }
    // The tail printed after `== waits`, whatever the mode.
    if (/^warnings \(\d+\):$/.test(line)) mode = 'warnings';
    else if (/^FAILED \(\d+\):$/.test(line)) mode = 'failed';
    else if (mode === 'warnings' || mode === 'failed') {
      const item = /^ {2}- (.*)$/.exec(line);
      if (item !== null) (mode === 'warnings' ? result.warnings : result.failures).push(item[1]);
    }
  }
  for (const section of result.sections.values()) {
    while (section.body.length > 0 && section.body[section.body.length - 1] === '') {
      section.body.pop();
    }
  }
  return result;
}

/**
 * Merges the outputs of all the shards of one `--shard i/N` split into a full-run-shaped output.
 *
 * Returns `{ text, ok, problems }`. `problems` lists why the merge is INVALID (then `text` is `''`
 * and `ok` false): fewer or more inputs than N, an input without a `fingerprint` or `SHARD` line,
 * different fingerprints (the shards ran different trees) or different N, a shard index missing or
 * repeated, a `--bail` or `--with-copilot` shard, a shard whose owned steps are not the
 * `shardPlan(N)` run for its index (the plan changed under it), an owned step printed twice, and
 * an owned step with no section in a shard that did not fail. `ok` is true only for a valid merge
 * in which every shard ended "all visual checks passed" with no FAIL line, and only then does
 * `text` end in that line; a valid merge with a failing shard still returns its `text` (every
 * section it did print, its FAIL lines, a `FAILED` list), so the artifact says what broke.
 *
 * What `text` holds, in this order: `fingerprint <hash>`; the check lines printed before `== 0`
 * (the group `''` of `extractChecks`) taken from the shard that owns the step 0, whose start-up
 * mode (no `.down` marker, the setup guide) is the one the full run has; the `== <id>` section of
 * every step from the shard that OWNS it, in canonical order (the prerequisites a shard added are
 * dropped: the step 1 runs once per shard but only its owner's counts); the final check once (the
 * FAIL if any shard has one); `== summary`; `== timings` (owned steps only, `total` summed over
 * the shards, which ran in parallel); the warnings and failures of all shards, prefixed with the
 * shard; the closing line. No `PARTIAL RUN`, `--bail` or `SHARD` line, so `fingerprint.mjs
 * --check` judges it as a full run.
 * VERIFIED on Windows 11 (10/11/2026), against a REAL saved full run cut into four shard-shaped
 * files by a one-off script (its steps 43-51 did not exist in that run and were filled with one
 * fabricated `ok` each): the merge returned no problems and `extractChecks` of the merge equalled
 * the one of the run, 53 groups, 0 differences; `merge-shards.test.mjs` covers the invalid and
 * failing cases with fabricated shards ("refuses a merge with a shard missing, repeated or
 * extra", "a failing shard gives a valid merge that is not ok…") and that `checkRun` of
 * `fingerprint.mjs` reports `covers` and `passed` for a merge ("is accepted by fingerprint.mjs
 * --check as a full run that passed"). NOT observed: the output of a real shard on a runner.
 * HYPOTHESIS: the merge of real shards is equivalent to a full run for `compare-runs.mjs` only up
 * to the state each shard's first step inherits (a fresh VS Code instead of the previous step's).
 * Not observed: a merge of the shards of a real CI run (the spike runs predate the `SHARD` line).
 */
export function mergeShardOutputs(texts) {
  const fail = (problems) => ({ text: '', ok: false, problems });
  if (texts.length === 0) return fail(['no shard output was given']);
  const shards = texts.map(parseShard);
  const problems = [];
  shards.forEach((shard, at) => {
    const label = `input ${String(at + 1)}`;
    if (shard.fingerprint === undefined) problems.push(`${label} has no fingerprint line`);
    if (shard.shard === undefined) problems.push(`${label} has no "SHARD i/N owns steps" line`);
    if (shard.bail) problems.push(`${label} was a --bail run: not evidence`);
    if (shard.copilot) problems.push(`${label} was a --with-copilot run: not evidence`);
  });
  if (problems.length > 0) return fail(problems);

  const hashes = new Set(shards.map((shard) => shard.fingerprint));
  if (hashes.size > 1)
    problems.push(`the shards have different fingerprints: ${[...hashes].join(', ')}`);
  const counts = new Set(shards.map((shard) => shard.shard.count));
  if (counts.size > 1) {
    problems.push(`the shards disagree on N: ${[...counts].join(', ')}`);
    return fail(problems);
  }
  const count = shards[0].shard.count;
  if (shards.length !== count) {
    problems.push(`expected ${String(count)} shard outputs, got ${String(shards.length)}`);
  }
  const indexes = shards.map((shard) => shard.shard.index);
  for (let index = 1; index <= count; index += 1) {
    const times = indexes.filter((candidate) => candidate === index).length;
    if (times === 0) problems.push(`shard ${String(index)}/${String(count)} is missing`);
    if (times > 1)
      problems.push(`shard ${String(index)}/${String(count)} was given ${String(times)} times`);
  }
  for (const index of indexes) {
    if (index < 1 || index > count)
      problems.push(`shard index ${String(index)} is outside 1..${String(count)}`);
  }
  if (problems.length > 0) return fail(problems);

  let plan;
  try {
    plan = shardPlan(count);
  } catch (error) {
    return fail([`N=${String(count)} is not a valid shard count: ${error.message}`]);
  }
  const byIndex = new Map(shards.map((shard) => [shard.shard.index, shard]));
  const failedShards = new Set();
  for (let index = 1; index <= count; index += 1) {
    const shard = byIndex.get(index);
    const label = `shard ${String(index)}/${String(count)}`;
    if (shard.shard.ids.join(',') !== plan[index - 1].join(',')) {
      problems.push(
        `${label} owns steps ${shard.shard.ids.join(', ')} but this tree's plan gives it ${plan[index - 1].join(', ')}`,
      );
    }
    const hasFail = [...shard.sections.values()].some((section) =>
      section.body.some((line) => /^\s+FAIL\s/.test(line)),
    );
    if (!shard.passed || hasFail || shard.stopped || shard.failures.length > 0) {
      failedShards.add(index);
    }
    for (const id of plan[index - 1]) {
      const section = shard.sections.get(id);
      if (section === undefined) {
        if (!failedShards.has(index)) {
          problems.push(`${label} owns step ${id} but printed no section for it`);
        }
      } else if (section.count > 1) {
        problems.push(`${label} printed the section of step ${id} ${String(section.count)} times`);
      }
    }
  }
  if (problems.length > 0) return fail(problems);

  const owner = new Map();
  plan.forEach((ids, at) => ids.forEach((id) => owner.set(id, byIndex.get(at + 1))));
  const out = [`fingerprint ${shards[0].fingerprint}`];
  out.push(
    `merged from ${String(count)} shards, each its own VS Code run on its own runner (not one run); the sections below are the steps each shard owns`,
  );
  const first = owner.get(STEP_IDS[0]);
  for (const line of first.preamble) if (CHECK_LINE.test(line)) out.push(line);
  for (const id of STEP_IDS) {
    const section = owner.get(id).sections.get(id);
    if (section === undefined) continue; // the owner failed before it: its FAILED list says so
    out.push('', section.header, ...section.body);
  }
  const finals = shards.flatMap((shard) => shard.finals);
  const finalLine = finals.find((line) => /^\s+FAIL\s/.test(line)) ?? finals[0];
  if (finalLine !== undefined) out.push(finalLine);

  out.push('', '== summary');
  for (let index = 1; index <= count; index += 1) {
    const shard = byIndex.get(index);
    out.push(
      `shard ${String(index)}/${String(count)}: steps ${plan[index - 1].join(', ')}, ${failedShards.has(index) ? 'FAILED' : 'passed'}${shard.windowLine === undefined ? '' : `, ${shard.windowLine}`}`,
    );
  }
  out.push('', '== timings');
  for (const id of STEP_IDS) {
    const row = owner.get(id).timings.get(id);
    if (row !== undefined) out.push(row);
  }
  const totals = shards.map((shard) => shard.total);
  out.push(
    `  total ${totals.reduce((sum, value) => sum + value, 0).toFixed(1)} s since VS Code was started, summed over the ${String(count)} shards (they ran in parallel; the slowest took ${Math.max(...totals).toFixed(1)} s)`,
  );

  const tagged = (pick) =>
    [...byIndex].flatMap(([index, shard]) =>
      pick(shard).map((item) => `[shard ${String(index)}/${String(count)}] ${item}`),
    );
  const warnings = tagged((shard) => shard.warnings);
  if (warnings.length > 0)
    out.push(`warnings (${String(warnings.length)}):`, ...warnings.map((item) => `  - ${item}`));
  const failures = [
    ...tagged((shard) => shard.failures),
    ...[...failedShards]
      .filter((index) => byIndex.get(index).failures.length === 0)
      .map(
        (index) =>
          `[shard ${String(index)}/${String(count)}] did not end in "all visual checks passed"`,
      ),
  ];
  const ok = failedShards.size === 0;
  if (failures.length > 0) {
    out.push(`FAILED (${String(failures.length)}):`, ...failures.map((item) => `  - ${item}`));
  }
  if (ok) out.push('all visual checks passed');
  return { text: `${out.join('\n')}\n`, ok, problems: [] };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [outFile, ...inputs] = process.argv.slice(2);
  if (outFile === undefined || inputs.length === 0) {
    console.error('usage: node test/visual/merge-shards.mjs <out> <shard-output>…');
    process.exit(2);
  }
  let texts;
  try {
    texts = inputs.map((file) => fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`merge-shards: ${error.message}`);
    process.exit(2);
  }
  const { text, ok, problems } = mergeShardOutputs(texts);
  if (problems.length > 0) {
    console.error('merge-shards: the merge is INVALID, nothing was written:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(2);
  }
  fs.writeFileSync(outFile, text);
  console.log(
    ok
      ? `merge-shards: ${String(inputs.length)} shards merged into ${outFile}; every shard passed`
      : `merge-shards: ${String(inputs.length)} shards merged into ${outFile}; some shard FAILED (see the FAILED list)`,
  );
  process.exit(ok ? 0 : 1);
}
