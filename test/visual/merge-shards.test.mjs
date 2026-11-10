// Protects the merge of the shard outputs of `test:visual` (issue #199): the CI accepts the
// result of N runners only through `merge-shards.mjs`, so a merge that lost a step, took a step
// from the wrong shard or called a failed run a pass would let a broken tree through.
//
// ALL the inputs are FABRICATED by `shardText` below, in the shape `run.mjs` prints (its banners,
// `== <id>` headers, `  ok   ` lines, `== timings`, the tail). They test the logic of the merge,
// NOT that the real output of `run.mjs` has that shape; that was cut by hand from a saved full run
// and merged by the one-off check recorded in Engram `tooling/visual-ci-parallel/implementation-2`.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkRun, fingerprint } from './fingerprint.mjs';
import { mergeShardOutputs } from './merge-shards.mjs';
import {
  BAIL_BANNER,
  STEP_IDS,
  extractChecks,
  resolveSelection,
  shardLine,
  shardPlan,
} from './steps.mjs';

const HASH = 'a'.repeat(64);
const FINAL_OK = '  ok   the synthetic opencode kept the conversation of the run in its state file';

/**
 * The output of one run over `ids` (closed over `needs`, as `--steps` does). With `shard` it
 * carries the PARTIAL banner and the SHARD line like a shard; without it, none (a full run).
 * `fail` makes that step print a FAIL line and the run end without the passing line; `stop`
 * cuts the run after that step with a STOPPED line; `lines` replaces the header lines.
 */
function shardText({ ids, shard, hash = HASH, fail, stop, finalCheck = FINAL_OK, extra = [] }) {
  const selected = resolveSelection(ids).selected;
  const out = ['> open-vs-code@0.0.1 test:visual', '', `fingerprint ${hash}`];
  if (shard !== undefined) {
    out.push(`PARTIAL RUN (steps ${selected.join(', ')}): not evidence for a commit`);
    out.push(shardLine(shard.index, shard.count, ids));
  }
  out.push(...extra, 'window 1440x900 CSS px, DPR 1, screen work area 1920x1032');
  out.push('system focus true');
  if (selected.includes('0')) out.push('  ok   preamble check before the step 0');
  let stopped = false;
  const printed = [];
  for (const id of selected) {
    if (stopped) break;
    printed.push(id);
    out.push('', `== ${id} title of ${id}`);
    out.push(`  ok   first check of ${id}`);
    if (id === fail) out.push(`  FAIL the check that breaks in ${id}`);
    out.push(`  ok   last check of ${id}`, '  time 1.0 s');
    if (id === stop) {
      out.push(`STOPPED after step ${id}: the VS Code window does not have the system focus`);
      stopped = true;
    }
  }
  if (!stopped) out.push(finalCheck);
  out.push('', '== summary', 'screenshots (0):', '', '== timings');
  for (const id of printed) out.push(`  ${id.padEnd(3)}    1.0 s  title of ${id}`);
  out.push(
    '  total 12.5 s since VS Code was started',
    '',
    '== waits',
    '  expired waitFor: 0 calls',
  );
  if (fail !== undefined || stop !== undefined) {
    out.push('FAILED (1):', `  - ${fail ?? stop} broke`);
  } else {
    out.push('warnings (1):', '  - a warning of the run', 'all visual checks passed');
  }
  return out.join('\n');
}

/** The N shard outputs of a clean split, plus the full run they stand for. */
function cleanSplit(count = 4, options = {}) {
  const plan = shardPlan(count);
  const shards = plan.map((ids, at) =>
    shardText({ ids, shard: { index: at + 1, count }, ...options }),
  );
  return { plan, shards, full: shardText({ ids: STEP_IDS }) };
}

describe('mergeShardOutputs', () => {
  it('merges the shards of a clean split into what a full run prints', () => {
    const { shards, full } = cleanSplit(4);
    const merged = mergeShardOutputs(shards);
    expect(merged.problems).toEqual([]);
    expect(merged.ok).toBe(true);
    // The assertion lines are the ones of the full run, per step, the group '' and the final check
    // included, with each shard's prerequisites (the step 1 in all but the first) gone.
    expect(extractChecks(merged.text)).toEqual(extractChecks(full));
    expect([...extractChecks(merged.text).keys()]).toEqual(['', ...STEP_IDS, '\u0000final']);
  });

  it('writes the sections in canonical order, once, and no PARTIAL, SHARD or bail line', () => {
    const merged = mergeShardOutputs(cleanSplit(4).shards);
    const headers = merged.text
      .split('\n')
      .filter((line) => /^== \S+/.test(line) && !/^== (summary|timings|waits)/.test(line))
      .map((line) => /^== (\S+)/.exec(line)[1]);
    expect(headers).toEqual(STEP_IDS);
    expect(merged.text).not.toMatch(/^PARTIAL RUN|^SHARD |--bail|--with-copilot/m);
    expect(merged.text.match(/kept the conversation/g)).toHaveLength(1);
    expect(merged.text.match(/^fingerprint /gm)).toHaveLength(1);
    expect(merged.text.trimEnd().endsWith('all visual checks passed')).toBe(true);
    expect(merged.text.match(/^all visual checks passed$/gm)).toHaveLength(1);
  });

  it('keeps one timing row per step (the owner of each) and sums the totals', () => {
    const merged = mergeShardOutputs(cleanSplit(4).shards);
    const rows = merged.text
      .split('\n')
      .filter((line) => /^ {2}\S+\s+1\.0 s {2}title of/.test(line));
    expect(rows).toHaveLength(STEP_IDS.length);
    expect(merged.text).toMatch(/total 50\.0 s .*summed over the 4 shards/);
  });

  it('prefixes the warnings with their shard', () => {
    const merged = mergeShardOutputs(cleanSplit(4).shards);
    expect(merged.text).toMatch(/warnings \(4\):/);
    expect(merged.text).toContain('  - [shard 3/4] a warning of the run');
  });

  it('accepts CRLF output (a Windows runner with core.autocrlf)', () => {
    const merged = mergeShardOutputs(
      cleanSplit(4).shards.map((text) => text.replace(/\n/g, '\r\n')),
    );
    expect(merged.problems).toEqual([]);
    expect(merged.ok).toBe(true);
  });

  it('accepts one shard (N=1) and the shards in any order', () => {
    const one = mergeShardOutputs(cleanSplit(1).shards);
    expect(one.ok).toBe(true);
    const { shards } = cleanSplit(3);
    expect(mergeShardOutputs([shards[2], shards[0], shards[1]]).ok).toBe(true);
  });

  it('is accepted by fingerprint.mjs --check as a full run that passed', () => {
    const root = path.resolve(import.meta.dirname, '..', '..');
    const hash = fingerprint(root).hash;
    const merged = mergeShardOutputs(cleanSplit(4, { hash }).shards);
    const result = checkRun(root, merged.text);
    expect(result).toMatchObject({
      status: 'covers',
      hash,
      partial: undefined,
      passed: true,
      bail: false,
      copilot: false,
    });
  });

  it('refuses a merge with a shard missing, repeated or extra', () => {
    const { shards } = cleanSplit(4);
    expect(mergeShardOutputs(shards.slice(0, 3)).problems.join('\n')).toMatch(
      /expected 4 shard outputs, got 3/,
    );
    expect(mergeShardOutputs(shards.slice(0, 3)).problems.join('\n')).toMatch(
      /shard 4\/4 is missing/,
    );
    const repeated = mergeShardOutputs([shards[0], shards[1], shards[1], shards[3]]);
    expect(repeated.problems.join('\n')).toMatch(/shard 2\/4 was given 2 times/);
    expect(repeated.problems.join('\n')).toMatch(/shard 3\/4 is missing/);
    const merged = mergeShardOutputs([...shards, shards[0]]);
    expect(merged.problems.join('\n')).toMatch(/expected 4 shard outputs, got 5/);
    expect(merged.text).toBe('');
    expect(merged.ok).toBe(false);
  });

  it('refuses shards of different trees or of different splits', () => {
    const { shards } = cleanSplit(4);
    const other = shardText({
      ids: shardPlan(4)[1],
      shard: { index: 2, count: 4 },
      hash: 'b'.repeat(64),
    });
    expect(mergeShardOutputs([shards[0], other, shards[2], shards[3]]).problems.join('\n')).toMatch(
      /different fingerprints/,
    );
    const three = cleanSplit(3).shards;
    expect(
      mergeShardOutputs([shards[0], shards[1], shards[2], three[0]]).problems.join('\n'),
    ).toMatch(/disagree on N/);
  });

  it('refuses a --bail shard, an input without a fingerprint or a SHARD line, and no input', () => {
    const { shards } = cleanSplit(4);
    const bailed = shardText({
      ids: shardPlan(4)[3],
      shard: { index: 4, count: 4 },
      extra: [BAIL_BANNER],
    });
    expect(mergeShardOutputs([...shards.slice(0, 3), bailed]).problems.join('\n')).toMatch(
      /input 4 was a --bail run/,
    );
    const noHash = shards[0].replace(/^fingerprint .*$/m, '');
    expect(mergeShardOutputs([noHash, ...shards.slice(1)]).problems.join('\n')).toMatch(
      /input 1 has no fingerprint/,
    );
    const noShard = shards[0].replace(/^SHARD .*$/m, '');
    expect(mergeShardOutputs([noShard, ...shards.slice(1)]).problems.join('\n')).toMatch(
      /input 1 has no "SHARD/,
    );
    expect(mergeShardOutputs([]).problems).toHaveLength(1);
  });

  it('refuses a shard that owns steps other than the plan gives it', () => {
    const { shards, plan } = cleanSplit(4);
    const tampered = shardText({
      ids: [...plan[1], plan[2][0]],
      shard: { index: 2, count: 4 },
    }).replace(/^SHARD 2\/4 owns steps .*$/m, shardLine(2, 4, plan[1].slice(1)));
    const merged = mergeShardOutputs([shards[0], tampered, shards[2], shards[3]]);
    expect(merged.problems.join('\n')).toMatch(
      /shard 2\/4 owns steps .* but this tree's plan gives it/,
    );
  });

  it('refuses an owned step with no section, or printed twice, in a shard that passed', () => {
    const { shards, plan } = cleanSplit(4);
    const gone = plan[2][1];
    const lost = shards[2].replace(new RegExp(`^== ${gone} .*$`, 'm'), '-- removed');
    expect(mergeShardOutputs([shards[0], shards[1], lost, shards[3]]).problems.join('\n')).toMatch(
      new RegExp(`shard 3/4 owns step ${gone} but printed no section for it`),
    );
    const twice = `${shards[2]}\n== ${gone} again\n  ok   x\n`;
    expect(mergeShardOutputs([shards[0], shards[1], twice, shards[3]]).problems.join('\n')).toMatch(
      new RegExp(`shard 3/4 printed the section of step ${gone} 2 times`),
    );
  });

  it('a failing shard gives a valid merge that is not ok and does not end in the passing line', () => {
    const { plan } = cleanSplit(4);
    const failing = plan[1][2];
    const shards = plan.map((ids, at) =>
      shardText({
        ids,
        shard: { index: at + 1, count: 4 },
        fail: at === 1 ? failing : undefined,
      }),
    );
    const merged = mergeShardOutputs(shards);
    expect(merged.problems).toEqual([]);
    expect(merged.ok).toBe(false);
    expect(merged.text).toContain(`  FAIL the check that breaks in ${failing}`);
    expect(merged.text).toContain(`  - [shard 2/4] ${failing} broke`);
    expect(merged.text).toContain('shard 2/4: steps');
    expect(merged.text).not.toMatch(/^all visual checks passed$/m);
    const group = extractChecks(merged.text).get(failing);
    expect(group).toContain(`FAIL the check that breaks in ${failing}`);
  });

  it('a shard cut by a STOPPED line leaves its later steps out without making the merge invalid', () => {
    const { plan } = cleanSplit(4);
    const stop = plan[2][1];
    const shards = plan.map((ids, at) =>
      shardText({
        ids,
        shard: { index: at + 1, count: 4 },
        stop: at === 2 ? stop : undefined,
      }),
    );
    const merged = mergeShardOutputs(shards);
    expect(merged.problems).toEqual([]);
    expect(merged.ok).toBe(false);
    expect(merged.text).toContain(`STOPPED after step ${stop}`);
    expect(merged.text).not.toContain(`== ${plan[2][2]} title`);
    expect(merged.text).not.toMatch(/^all visual checks passed$/m);
  });

  it('a failed final check shows up once, as a FAIL', () => {
    const { plan } = cleanSplit(4);
    const shards = plan.map((ids, at) =>
      shardText({
        ids,
        shard: { index: at + 1, count: 4 },
        finalCheck:
          at === 3
            ? '  FAIL the synthetic opencode kept the conversation of the run in its state file'
            : FINAL_OK,
      }),
    );
    const merged = mergeShardOutputs(shards);
    expect(merged.text.match(/kept the conversation/g)).toHaveLength(1);
    expect(extractChecks(merged.text).get('\u0000final')).toEqual([
      'FAIL the synthetic opencode kept the conversation of the run in its state file',
    ]);
  });
});
