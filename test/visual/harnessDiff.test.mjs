// Protects the per-step `--affected` for changes to `run.mjs` and `steps.mjs` (tooling/visual-ci-parallel,
// issue #199): a step added or edited selects only that step, comments and layout select nothing,
// and any change outside the steps (a shared helper, a reordered or removed step, text that does
// not parse) selects the full run. The sources are FABRICATED and minimal, so this checks the
// logic of `harnessDiff.mjs`; that it says `steps 51` for the real commits is checked by hand
// against git (Engram `tooling/visual-ci-parallel/implementation-1`).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { diffRunMjs, diffStepsMjs } from './harnessDiff.mjs';
import { STEP_IDS, stepIdOf } from './steps.mjs';

/** A minimal `run.mjs`: a helper, two consecutive steps and a trailing statement. */
function run({ helper = 'return 1;', one = 'check(1);', two = 'check(2);', extra = '' } = {}) {
  return `
function shared() { ${helper} }
async function main() {
  await step('1 first', async () => {
    ${one}
  });
  await step('2 second', async () => {
    ${two}
  });
  ${extra}
  done();
}
`;
}

describe('diffRunMjs', () => {
  it('chooses only the step whose body changed', () => {
    expect(diffRunMjs(run(), run({ two: 'check(3);' }))).toMatchObject({
      mode: 'steps',
      steps: ['2'],
    });
  });

  it('ignores comments and layout, inside and outside the steps', () => {
    const after = run({ one: '// why\n check( 1 );', helper: '/* c */ return 1;' });
    expect(diffRunMjs(run(), after).mode).toBe('none');
  });

  it('chooses a new step by its id', () => {
    const added = run().replace(
      "await step('2 second'",
      "await step('1b between', async () => { check(9); });\n  await step('2 second'",
    );
    expect(diffRunMjs(run(), added)).toMatchObject({ mode: 'steps', steps: ['1b'] });
  });

  it('is full when a top-level helper changed', () => {
    expect(diffRunMjs(run(), run({ helper: 'return 2;' })).mode).toBe('full');
  });

  it('is full when code between the steps changed', () => {
    expect(diffRunMjs(run(), run({ extra: 'setup();' })).mode).toBe('full');
  });

  it('is full when the steps are reordered or one is removed', () => {
    const reordered = run()
      .replace("'1 first'", "'TMP'")
      .replace("'2 second'", "'1 first'")
      .replace("'TMP'", "'2 second'");
    expect(diffRunMjs(run(), reordered).mode).toBe('full');
    const removed = run().replace(/await step\('2 second'[\s\S]*?\}\);\n/, '');
    expect(diffRunMjs(run(), removed).mode).toBe('full');
  });

  it('is full when the text does not parse or a step name is not a literal', () => {
    expect(diffRunMjs(run(), run({ one: 'check(' })).mode).toBe('full');
    const dynamic = run().replace("'1 first'", 'name');
    expect(diffRunMjs(run(), dynamic).mode).toBe('full');
  });

  it('reads Windows and Unix line endings as the same text', () => {
    expect(diffRunMjs(run(), run().replace(/\n/g, '\r\n')).mode).toBe('none');
  });
});

// Protects the "next step" rule of `--affected` (review S1): `selectForFiles` takes the successor
// from `STEP_IDS`, and an id from `run.mjs` that is not there would be dropped. This reads the REAL
// `run.mjs` (not fabricated): its `await step('<id> …')` ids, in order, are exactly `STEP_IDS`.
describe('the real run.mjs against STEP_IDS', () => {
  it('declares its steps in the canonical order of STEP_IDS', () => {
    const source = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
    const ids = [...source.matchAll(/^\s*await step\(\s*['"`]([^'"`]+)['"`]/gm)].map((match) =>
      stepIdOf(match[1]),
    );
    expect(ids).toEqual(STEP_IDS);
  });
});

/** A minimal `steps.mjs`. */
function stepsSource({ budget = 10, entry = '', fn = 'return 1;' } = {}) {
  return `
// header
export const STEPS = [
  { id: '1', needs: [], sendsPrompt: false, groups: ['smoke'], budgetS: ${String(budget)} },
  // a note
  { id: '2', needs: ['1'], sendsPrompt: true, groups: ['render'], budgetS: 20 },${entry}
];
export function other() { ${fn} }
`;
}

describe('diffStepsMjs', () => {
  it('ignores a budgetS change and comments: no check depends on them', () => {
    expect(diffStepsMjs(stepsSource(), stepsSource({ budget: 99 })).mode).toBe('none');
  });

  it('chooses a new entry by its id', () => {
    const entry =
      "\n  { id: '3', needs: ['1'], sendsPrompt: false, groups: ['mods'], budgetS: 5 },";
    expect(diffStepsMjs(stepsSource(), stepsSource({ entry }))).toMatchObject({
      mode: 'steps',
      steps: ['3'],
    });
  });

  it('chooses an entry whose groups changed', () => {
    const after = stepsSource().replace("groups: ['render']", "groups: ['render', 'tabs']");
    expect(diffStepsMjs(stepsSource(), after)).toMatchObject({ mode: 'steps', steps: ['2'] });
  });

  it('is full when a function of the module changed or an entry was removed', () => {
    expect(diffStepsMjs(stepsSource(), stepsSource({ fn: 'return 2;' })).mode).toBe('full');
    const removed = stepsSource().replace(/\n {2}\{ id: '2'.*\},/, '');
    expect(diffStepsMjs(stepsSource(), removed).mode).toBe('full');
  });

  it('is full when STEPS is not an array literal', () => {
    expect(diffStepsMjs(stepsSource(), 'export const STEPS = build();').mode).toBe('full');
  });
});
