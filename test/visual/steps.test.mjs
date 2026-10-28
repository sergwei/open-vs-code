// Protects the `--steps` filter and the run comparison of `test/visual` (issue #89). The inputs
// are fabricated strings and ids, so this checks the logic of `steps.mjs`, NOT that `run.mjs`
// honours it (that was run by hand: `--steps 1` and `--steps 8`).
import { describe, expect, it } from 'vitest';
import {
  FINAL_GROUP,
  STEP_IDS,
  compareRuns,
  extractChecks,
  parseAllThemesArg,
  parseBailArg,
  parseStepsArg,
  restrictToPresent,
  resolveSelection,
  stepIdOf,
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
    });
  });

  it('reports a new warning as a difference', () => {
    const a = extractChecks('== 1 x\n  ok   a\n');
    const b = extractChecks('== 1 x\n  ok   a\n  warn new\n');
    expect(compareRuns(a, b).differences).toEqual([{ id: '1', line: 'warn new', a: 0, b: 1 }]);
  });
});
