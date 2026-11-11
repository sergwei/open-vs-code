// Protects the `--steps` filter and the run comparison of `test/visual` (issue #89). The inputs
// are fabricated strings and ids, so this checks the logic of `steps.mjs`, NOT that `run.mjs`
// honours it (that was run by hand: `--steps 1` and `--steps 8`).
import { describe, expect, it } from 'vitest';
import {
  COPILOT_BANNER,
  FINAL_GROUP,
  GROUPS,
  STEPS,
  STEP_IDS,
  budgetNote,
  compareRuns,
  extractChecks,
  groupsOf,
  parseAllThemesArg,
  parseBailArg,
  parseGroupArg,
  parseListArg,
  parseShardArg,
  parseShardLine,
  parseStepsArg,
  parseWithCopilotArg,
  restrictToPresent,
  resolveSelection,
  shardLine,
  shardPlan,
  stepIdOf,
  stopLine,
  volatileBetween,
} from './steps.mjs';

describe('parseStepsArg', () => {
  it('returns no ids without the flag (the full run)', () => {
    expect(parseStepsArg(['--other'])).toEqual({ ids: undefined });
  });

  it('trims, de-duplicates and accepts 6b and 7b', () => {
    expect(parseStepsArg(['--steps', ' 6b, 7b ,6b,1'])).toEqual({ ids: ['6b', '7b', '1'] });
    expect(parseStepsArg(['--steps=1,2'])).toEqual({ ids: ['1', '2'] });
  });

  it('rejects an empty or missing list', () => {
    expect(parseStepsArg(['--steps']).error).toMatch(/needs a list/);
    expect(parseStepsArg(['--steps', ' , ']).error).toMatch(/needs a list/);
  });

  it('rejects an unknown id and lists the valid ones', () => {
    const { error } = parseStepsArg(['--steps', '1,12,99']);
    expect(error).toContain('12, 99');
    expect(error).toContain(STEP_IDS.join(', '));
  });
});

describe('resolveSelection', () => {
  it('keeps the canonical order whatever the order requested', () => {
    expect(resolveSelection(['14', '11', '2']).selected).toEqual(['1', '2', '11', '14']);
  });

  it('adds the prerequisites of step 8 and says so', () => {
    const result = resolveSelection(['8']);
    expect(result.selected).toEqual(['1', '5', '6', '6b', '8']);
    expect(result.added).toEqual(['1', '5', '6', '6b']);
  });

  it('closes transitively (10 needs 9, which needs 2, which needs 1)', () => {
    expect(resolveSelection(['10']).selected).toEqual(['1', '2', '9', '10']);
  });

  it('starts with the setup guide only when step 0 is in, and judges the state file only with prompts', () => {
    expect(resolveSelection(['1']).withSetupGuide).toBe(false);
    expect(resolveSelection(['0', '1']).withSetupGuide).toBe(true);
    expect(resolveSelection(['0', '1', '21', '23']).sendsPrompt).toBe(false);
    expect(resolveSelection(['2']).sendsPrompt).toBe(true);
  });

  it('throws on an unknown id', () => {
    expect(() => resolveSelection(['nope'])).toThrow(/unknown step id/);
  });

  it('reads the id from the first token of a step name', () => {
    expect(stepIdOf('6b a plain Reject is kept')).toBe('6b');
  });
});

const SAMPLE = [
  'noise',
  '',
  '== 1 empty state',
  '  ok   a',
  '  ok   a',
  '  warn w',
  '  time 1.2 s',
  '',
  '== 2 markdown',
  '  FAIL b',
  '  ok   c 1.5',
  '  ok   the synthetic opencode kept the conversation',
  '',
  '== summary',
  '  ok   ignored',
  '== timings',
  '  1  1.2 s  empty state',
].join('\n');

describe('extractChecks', () => {
  it('groups by step header, normalises, and ignores time, summary and timings', () => {
    const groups = extractChecks(SAMPLE);
    expect(groups.get('1')).toEqual(['ok a', 'ok a', 'warn w']);
    expect(groups.get('2')).toEqual(['FAIL b', 'ok c 1.5']);
    expect(groups.get(FINAL_GROUP)).toEqual(['ok the synthetic opencode kept the conversation']);
    expect([...groups.keys()]).toEqual(['1', '2', FINAL_GROUP]);
  });

  /**
   * Protects `compare-runs` from the `== waits` section that follows `== timings` (tooling/test-speed
   * phase 0): its `gap …` lines carry the text of checks, and a wait line must never be read as an
   * assertion of the last step. The sample is hand-written, not a captured run.
   */
  it('ignores a == waits section, even one whose lines look like checks', () => {
    const groups = extractChecks(
      `${SAMPLE}\n  total 9.9 s since VS Code was started\n== waits\n  ok   looks like a check\n  gap 5 ms step 2 at 9 ms before: ok b\n  expired step 2 cap 100 ms spent 100 ms at run.mjs:1\n`,
    );
    expect(groups.get('2')).toEqual(['FAIL b', 'ok c 1.5']);
    expect([...groups.keys()]).toEqual(['1', '2', FINAL_GROUP]);
  });
});

describe('compareRuns environment volatiles', () => {
  /**
   * Protects the acceptance tool of tooling/test-speed from the 26 differences seen between two
   * full runs of the same code on 30/10/2026: clock times, a view UUID, the clipboard format count
   * and the webview-host race warning. The lines are shortened copies of the real ones, not
   * captured output. Also checks that a changed non-volatile digit still differs.
   */
  it('treats times, UUIDs, clipboard counts and the host race warning as the same', () => {
    const a = extractChecks(
      '== 20 x\n  ok   row "Tab · 07:55 PM" "Untitled session07:52 PM" view fb4a02e9-de88-4cfb-9d74-c6ab36f5d301\n  warn the clipboard held 5 formats: only its text will be given back\n  ok   n 3\n',
    );
    const b = extractChecks(
      '== 20 x\n  ok   row "Tab · 10:01 PM" "Untitled session09:55 PM" view e8c702ce-c587-42e8-b8eb-060796f99b9b\n  warn the clipboard held 3 formats: only its text will be given back\n  warn empty state: VS Code\'s webview host threw "Found unexpected null" while mounting (its own race)\n  ok   n 4\n',
    );
    const result = compareRuns(a, b);
    expect(result.differences).toEqual([
      { id: '20', line: 'ok n 3', a: 1, b: 0 },
      { id: '20', line: 'ok n 4', a: 0, b: 1 },
    ]);
    expect([result.racesA, result.racesB, result.warnsA, result.warnsB]).toEqual([0, 1, 1, 1]);
  });
});

describe('restrictToPresent', () => {
  it('keeps only the steps the filtered run printed, and the final check only if it printed it', () => {
    const full = extractChecks(SAMPLE);
    const partial = extractChecks('== 1 x\n  ok   a\n  ok   a\n  warn w\n');
    const restricted = restrictToPresent(full, partial);
    expect([...restricted.keys()]).toEqual(['1']);
    expect(compareRuns(restricted, partial).differences).toEqual([]);
    const withFinal = extractChecks(
      '== 1 x\n  ok   a\n  ok   a\n  warn w\n  ok   the synthetic opencode kept the conversation\n',
    );
    expect([...restrictToPresent(full, withFinal).keys()]).toEqual(['1', FINAL_GROUP]);
  });
});

describe('parseAllThemesArg', () => {
  it('is off by default and on only with the flag', () => {
    expect(parseAllThemesArg([])).toBe(false);
    expect(parseAllThemesArg(['--steps', '11'])).toBe(false);
    expect(parseAllThemesArg(['--steps', '11', '--all-themes'])).toBe(true);
  });
});

/**
 * Protects the pure side of the early stop and of `--with-copilot` (issue #127, #98): the text of
 * the cut line for each cause (the focus cause with and without the window in front as detail,
 * tooling/vscode-1146), that no tool reads it as a check, and the flag. The causes are
 * fabricated; that `run.mjs` finds them in a real VS Code is covered by its mutations M1-M3.
 */
describe('stopLine', () => {
  const causes = [
    {
      kind: 'cdp',
      detail: 'socket closed',
      text: 'the chat webview stopped answering CDP (socket closed)',
    },
    {
      kind: 'workbench',
      detail: 'timed out',
      text: 'the workbench stopped answering CDP (timed out)',
    },
    {
      kind: 'focus',
      detail: '',
      text: 'the VS Code window does not have the system focus (another window is in front)',
    },
    {
      // tooling/vscode-1146: a non-empty detail names the window in front (synthetic input).
      kind: 'focus',
      detail: 'foreground powershell pid 7 "x" (Y)',
      text: 'the VS Code window does not have the system focus (another window is in front: foreground powershell pid 7 "x" (Y))',
    },
    {
      kind: 'dialog',
      detail: 'By continuing,\n you agree',
      text: 'a modal dialog of VS Code is open ("By continuing, you agree")',
    },
  ];

  it.each(causes)('words the $kind cause and starts with the step id', ({ kind, detail, text }) => {
    expect(stopLine('22', { kind, detail })).toBe(
      `STOPPED after step 22: ${text}; the remaining steps are skipped`,
    );
  });

  it('cuts the dialog text to 80 characters and rejects an unknown cause', () => {
    const line = stopLine('1', { kind: 'dialog', detail: 'x'.repeat(200) });
    expect(line).toContain(`("${'x'.repeat(80)}")`);
    expect(() => stopLine('1', { kind: 'other', detail: '' })).toThrow(/unknown stop cause/);
  });

  it('is not a check for extractChecks, with or without indentation', () => {
    const line = stopLine('3', { kind: 'focus', detail: '' });
    const base = '== 3 a step\n  ok one\n  FAIL two\n';
    expect(extractChecks(`${base}${line}\n== summary\n`)).toEqual(
      extractChecks(`${base}== summary\n`),
    );
  });
});

describe('parseWithCopilotArg', () => {
  it('is off without the flag and on with it', () => {
    expect(parseWithCopilotArg(['--steps', '1'])).toBe(false);
    expect(parseWithCopilotArg(['--steps', '1', '--with-copilot'])).toBe(true);
    expect(COPILOT_BANNER).toMatch(/^--with-copilot: /);
  });
});

// `--bail` must be opt-in: a run without it is the one that reports every failure (decision
// `tooling/visual-speed/decisions/bail-flag`).
describe('parseBailArg', () => {
  it('is off by default and on only with the flag', () => {
    expect(parseBailArg([])).toBe(false);
    expect(parseBailArg(['--steps', '16', '--all-themes'])).toBe(false);
    expect(parseBailArg(['--steps', '16', '--bail'])).toBe(true);
  });
});

describe('compareRuns', () => {
  it('compares as multisets: a repeated line counts', () => {
    const a = extractChecks('== 1 x\n  ok   a\n  ok   a\n');
    const b = extractChecks('== 1 x\n  ok   a\n');
    expect(compareRuns(a, b).differences).toEqual([{ id: '1', line: 'ok a', a: 2, b: 1 }]);
  });

  /**
   * Protects `compare-runs` with a second base: the lines that differ between two runs of the same
   * code (a box coordinate with decimals) are left out per step, `ok` and `warn` are counted
   * after that, and the race-warning counters (`racesA`/`racesB`) are 0 when no such warning is
   * there. The runs are hand-written, not captured output.
   */
  it('leaves the volatile lines out, per step, and counts ok and warn', () => {
    const a = extractChecks('== 4 x\n  ok   top 380.8\n  ok   same\n  warn w\n');
    const b = extractChecks('== 4 x\n  ok   top 380.9\n  ok   same\n  warn w\n');
    const volatile = volatileBetween(a, b);
    expect(volatile).toEqual(new Set(['4\tok top 380.8', '4\tok top 380.9']));
    expect(compareRuns(a, b, volatile)).toEqual({
      differences: [],
      okA: 1,
      okB: 1,
      warnsA: 1,
      warnsB: 1,
      racesA: 0,
      racesB: 0,
    });
  });

  it('reports a new warning as a difference', () => {
    const a = extractChecks('== 1 x\n  ok   a\n');
    const b = extractChecks('== 1 x\n  ok   a\n  warn new\n');
    expect(compareRuns(a, b).differences).toEqual([{ id: '1', line: 'warn new', a: 0, b: 1 }]);
  });
});

// Groups, budgets and `--list` (tooling/test-speed, phase 2). Fabricated argv, so this checks the
// parsers and the catalogue; that `run.mjs` runs the selection was run by hand (`--group selectors`).
describe('GROUPS and the catalogue', () => {
  it('gives every step a group and a positive budget, and the groups cover STEP_IDS', () => {
    for (const entry of STEPS) {
      expect(entry.groups.length, `step ${entry.id} has no group`).toBeGreaterThan(0);
      expect(entry.budgetS, `step ${entry.id} has no budget`).toBeGreaterThan(0);
    }
    const union = new Set([...GROUPS.values()].flat());
    expect([...union].sort()).toEqual([...STEP_IDS].sort());
  });

  it('keeps the ids of a group in canonical order', () => {
    for (const ids of GROUPS.values()) {
      expect(ids).toEqual(STEP_IDS.filter((id) => ids.includes(id)));
    }
  });
});

describe('parseGroupArg', () => {
  it('returns no ids without the flag', () => {
    expect(parseGroupArg(['--bail'])).toEqual({ ids: undefined });
  });

  it('returns the union of the groups in canonical order, both spellings', () => {
    expect(parseGroupArg(['--group', 'selectors']).ids).toEqual(['11', '14', '23']);
    expect(parseGroupArg(['--group=keyboard,selectors']).ids).toEqual(['11', '14', '22', '23']);
  });

  it('rejects an unknown group listing the valid ones, and an empty list', () => {
    expect(parseGroupArg(['--group', 'nope']).error).toMatch(
      /unknown group: nope.*valid groups: .*tabs/,
    );
    expect(parseGroupArg(['--group']).error).toMatch(/needs a list/);
  });

  it('closes over needs once resolved, like --steps (a group never runs without its base)', () => {
    const { ids } = parseGroupArg(['--group', 'selectors']);
    expect(resolveSelection(ids).selected).toEqual(['1', '11', '14', '23']);
  });
});

describe('groupsOf, budgetNote and parseListArg', () => {
  it('lists the groups that contain any of the ids', () => {
    expect(groupsOf(['22'])).toEqual(['keyboard']);
    expect(groupsOf(['29'])).toEqual(['sessions', 'tabs']);
  });

  it('marks only a step that goes over its budget, never as a warn or FAIL', () => {
    const budget = STEPS.find((entry) => entry.id === '9').budgetS;
    expect(budgetNote('9', budget)).toBe('');
    const note = budgetNote('9', budget + 0.1);
    expect(note).toBe(`  over budget (${String(budget)} s)`);
    expect(note).not.toMatch(/^\s*(ok|FAIL|warn)/);
    expect(budgetNote('nope', 999)).toBe('');
  });

  it('reads --list', () => {
    expect(parseListArg(['--list', '--group', 'tabs'])).toBe(true);
    expect(parseListArg(['--group', 'tabs'])).toBe(false);
  });
});

/** Sum of the `budgetS` of `ids`. */
const budgetOf = (ids) =>
  ids.reduce((total, id) => total + STEPS.find((entry) => entry.id === id).budgetS, 0);

/**
 * Protects the split of `--shard i/N` (issue #199): the CI runs one shard per runner and the
 * merge accepts the result only if every step ran exactly once, so a hole or a repeat here would
 * be a step that silently never runs in CI. Uses the real `STEPS` (the catalogue is the input),
 * and a brute force over every set of cuts as the oracle for the optimum.
 */
describe('shardPlan', () => {
  it.each([1, 2, 3, 4, 6, STEP_IDS.length])(
    'puts every id in exactly one contiguous run, in canonical order (n=%i)',
    (count) => {
      const plan = shardPlan(count);
      expect(plan).toHaveLength(count);
      expect(plan.every((ids) => ids.length > 0)).toBe(true);
      expect(plan.flat()).toEqual(STEP_IDS);
    },
  );

  it('n=1 is the whole run', () => {
    expect(shardPlan(1)).toEqual([STEP_IDS]);
  });

  it('is no worse than any other contiguous split (brute force, n=2 and n=3)', () => {
    const largest = (cuts) => {
      const bounds = [0, ...cuts, STEP_IDS.length];
      return Math.max(
        ...bounds.slice(1).map((end, at) => budgetOf(STEP_IDS.slice(bounds[at], end))),
      );
    };
    let best2 = Infinity;
    for (let a = 1; a < STEP_IDS.length; a += 1) best2 = Math.min(best2, largest([a]));
    let best3 = Infinity;
    for (let a = 1; a < STEP_IDS.length; a += 1) {
      for (let b = a + 1; b < STEP_IDS.length; b += 1) best3 = Math.min(best3, largest([a, b]));
    }
    expect(Math.max(...shardPlan(2).map(budgetOf))).toBe(best2);
    expect(Math.max(...shardPlan(3).map(budgetOf))).toBe(best3);
  });

  it('is deterministic', () => {
    expect(shardPlan(4)).toEqual(shardPlan(4));
  });

  it('rejects a count that is not an integer from 1 to the number of steps', () => {
    for (const bad of [0, -1, 1.5, STEP_IDS.length + 1, Number.NaN]) {
      expect(() => shardPlan(bad)).toThrow(RangeError);
    }
  });
});

describe('parseShardArg', () => {
  it('returns no shard without the flag', () => {
    expect(parseShardArg(['--steps', '1'])).toEqual({ shard: undefined });
  });

  it('reads both spellings', () => {
    expect(parseShardArg(['--shard', '2/4'])).toEqual({ shard: { index: 2, count: 4 } });
    expect(parseShardArg(['--shard=4/4'])).toEqual({ shard: { index: 4, count: 4 } });
  });

  it('rejects a missing, malformed or out of range value', () => {
    for (const argv of [
      ['--shard'],
      ['--shard', '2'],
      ['--shard', 'a/4'],
      ['--shard', '0/4'],
      ['--shard', '5/4'],
      ['--shard', '1/0'],
      ['--shard', `1/${String(STEP_IDS.length + 1)}`],
    ]) {
      expect(parseShardArg(argv).error, argv.join(' ')).toMatch(/--shard/);
    }
  });
});

describe('shardLine and parseShardLine', () => {
  it('round-trips, and the line is not a check line', () => {
    const line = shardLine(2, 4, ['25', '26', '6b']);
    expect(line).toBe('SHARD 2/4 owns steps 25, 26, 6b');
    expect(parseShardLine(`x\n${line}\ny`)).toEqual({
      index: 2,
      count: 4,
      ids: ['25', '26', '6b'],
    });
    expect(line).not.toMatch(/^\s*(ok|FAIL|warn)\b|^== /);
    expect(parseShardLine('PARTIAL RUN (steps 1)')).toBeUndefined();
  });
});
