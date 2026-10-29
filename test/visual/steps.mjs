// Catalogue of the steps of `test/visual/run.mjs`, the `--steps` filter and the run comparison.
//
// Pure on purpose (no playwright, no vscode, no `fs`): `steps.test.mjs` runs under Vitest, and
// `compare-runs.mjs` and `run.mjs` are thin users of it. Issue #89 (tooling/visual-speed).

/**
 * One entry per step of the run, in the canonical order of `run.mjs`.
 *
 * - `id`: the first token of the step's name in `run.mjs` (`step('6b …')`), which `step()` reads.
 * - `needs`: the DIRECT prerequisites (ids of steps that must run before so that this one finds the
 *   state it starts from). `resolveSelection` closes them transitively.
 * - `sendsPrompt`: whether the step sends a prompt, which is what makes the fake keep a state file
 *   with sessions in it (the final check of `run.mjs` is only judged when one such step ran).
 *
 * The `needs` come from reading `run.mjs` (Engram `tooling/visual-speed/plan`, section 4).
 * VERIFIED on 28/10/2026 (Windows 11, VS Code 1.143.1): each of the 25 ids ran alone with
 * `--steps <id> --bail`, printed the banner "PARTIAL RUN (steps 1, 11): not evidence for a commit"
 * (that one is the id 11) and ended with "all visual checks passed" (24 at the first try; the 7
 * only after its `needs` became `['5']`, see below). NOT observed: any id more than once (the 7 excepted), so an
 * intermittent failure of one id alone would not have shown; macOS and Linux.
 * Decision of Sergio (Engram `tooling/visual-speed/decisions/filter-and-themes`): the closure is
 * automatic and announced, with whole steps (no preparation code the full run never exercises).
 * Judgement calls: "an open conversation" (7b, 9, 22) adds the step 2, and the step 10 needs 9
 * because it expects an EMPTY view (#1303: "10 depends on 9"). The step 16 adds the step 2 too: its
 * "ArrowUp with the popup closed recalls the last prompt" reads the prompt history, which only an
 * earlier step fills. VERIFIED on 28/10/2026 (Windows 11, VS Code 1.143.1): with `needs: ['1']`,
 * `--steps 16,17` failed that check in 6 runs of 6 ("recalls the last prompt ("")"), while the full
 * run passed it. The step 7 needs 5 and not 2: it asserts that the answered-request lines (the
 * "Allowed once" that the step 5 leaves) survive Restart Server, and `--steps 7` alone failed with
 * "the answered-request lines are the same after Restart Server ([] -> [])" (28/10/2026, Windows
 * 11, VS Code 1.143.1; the other 24 ids passed alone). With `needs: ['5']` the 7 passed 2 runs of 2.
 * Steps 24 (slash commands, issue #33) and 25 (Workspace Trust, same issue) came after that
 * measurement: the 24 needs the 1 (it drives the chat) and sends prompts; the 25 needs nothing
 * (it starts two more VS Code windows of its own, a control and one in Restricted Mode, and never
 * touches the main one).
 * The step 26 (editor and Explorer context menus, issue #36) came after that measurement too: it
 * needs the 1 (it drives the chat) and sends prompts.
 * Every step after the 1 needs the 1, except the 25:
 * it is the step that opens the chat webview (`openChat`) and waits for the connection, which the
 * plan's table counted as "connected" and not as a step. VERIFIED by `--steps 8` on 27/10/2026
 * (Windows 11): without the 1 every step threw "Cannot read properties of undefined (reading
 * 'inDoc')", because `web` was never opened.
 */
export const STEPS = [
  { id: '0', needs: [], sendsPrompt: false },
  { id: '1', needs: [], sendsPrompt: false },
  { id: '2', needs: ['1'], sendsPrompt: true },
  { id: '3', needs: ['1'], sendsPrompt: true },
  { id: '4', needs: ['2'], sendsPrompt: true },
  { id: '5', needs: ['1'], sendsPrompt: true },
  { id: '6', needs: ['5'], sendsPrompt: true },
  { id: '6b', needs: ['5'], sendsPrompt: true },
  { id: '7', needs: ['5'], sendsPrompt: true },
  { id: '7b', needs: ['2'], sendsPrompt: true },
  { id: '8', needs: ['5', '6', '6b'], sendsPrompt: true },
  { id: '9', needs: ['2'], sendsPrompt: true },
  { id: '10', needs: ['9'], sendsPrompt: true },
  { id: '11', needs: ['1'], sendsPrompt: true },
  { id: '13', needs: ['1'], sendsPrompt: true },
  { id: '14', needs: ['1'], sendsPrompt: true },
  { id: '15', needs: ['1'], sendsPrompt: true },
  { id: '16', needs: ['2'], sendsPrompt: true },
  { id: '17', needs: ['1'], sendsPrompt: true },
  { id: '18', needs: ['1'], sendsPrompt: true },
  { id: '19', needs: ['1'], sendsPrompt: true },
  { id: '20', needs: ['1'], sendsPrompt: true },
  { id: '21', needs: ['1'], sendsPrompt: false },
  { id: '22', needs: ['2'], sendsPrompt: true },
  { id: '23', needs: ['1'], sendsPrompt: false },
  { id: '24', needs: ['1'], sendsPrompt: true },
  { id: '25', needs: [], sendsPrompt: false },
  { id: '26', needs: ['1'], sendsPrompt: true },
];

/** Every valid id, in canonical order. */
export const STEP_IDS = STEPS.map((entry) => entry.id);

/** The step id of a step name: its first whitespace-delimited token (`'6b a plain Reject…'` is `6b`). */
export function stepIdOf(name) {
  return name.trim().split(/\s+/)[0] ?? '';
}

/**
 * Reads `--steps a,b,c` or `--steps=a,b,c` from `argv` (the arguments after the script name).
 *
 * Returns `{ ids: undefined }` when the flag is absent (the full run), `{ ids }` with the ids
 * trimmed and de-duplicated in the order given, or `{ error }` with a message that lists the valid
 * ids: an empty or missing list, or an unknown id. The caller exits with 2 on `error`.
 */
export function parseStepsArg(argv) {
  const index = argv.findIndex((arg) => arg === '--steps' || arg.startsWith('--steps='));
  if (index === -1) return { ids: undefined };
  const raw = argv[index].startsWith('--steps=')
    ? argv[index].slice('--steps='.length)
    : (argv[index + 1] ?? '');
  const ids = [
    ...new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    ),
  ];
  const valid = `valid ids: ${STEP_IDS.join(', ')}`;
  if (ids.length === 0) return { error: `--steps needs a list of step ids (${valid})` };
  const unknown = ids.filter((id) => !STEP_IDS.includes(id));
  if (unknown.length > 0) {
    return {
      error: `unknown step id${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')} (${valid})`,
    };
  }
  return { ids };
}

/**
 * Whether `--all-themes` is in `argv` (the arguments after the script name).
 *
 * Decision of Sergio (Engram `tooling/visual-speed/decisions/filter-and-themes`): the loops that
 * only take screenshots (11g, 12b, 12d, 12f, 14b, 14d) capture once, in dark, by default; with
 * this flag they capture in the four themes as before. It never changes a check, only which
 * captures are taken, so it never changes the `ok` lines.
 */
export function parseAllThemesArg(argv) {
  return argv.includes('--all-themes');
}

/**
 * Whether `--bail` is in `argv` (the arguments after the script name).
 *
 * Decision of Sergio (Engram `tooling/visual-speed/decisions/bail-flag`, 28/10/2026): for
 * development, the run stops after the first step that fails instead of letting every later wait
 * expire at its cap on a broken state (a failing `--steps 16,17` took 177 s against 57 s when it
 * passed). A run without the flag still reports every failure; only that one is evidence.
 */
export function parseBailArg(argv) {
  return argv.includes('--bail');
}

/**
 * Turns the requested ids into what the run executes.
 *
 * Returns `{ selected, added, withSetupGuide, sendsPrompt }`: `selected` is the requested ids plus
 * the transitive prerequisites, always in CANONICAL order (a filter never reorders); `added` is
 * the part of `selected` that was not requested (the run announces it); `withSetupGuide` is whether
 * the step 0 is in (it decides the start-up mode: without it VS Code starts normally, with the
 * fixture and no `.down` marker); `sendsPrompt` is whether any selected step sends one. Throws on
 * an unknown id (`parseStepsArg` already rejects those, this is the library's own guard).
 */
export function resolveSelection(ids) {
  const wanted = new Set();
  const visit = (id) => {
    const entry = STEPS.find((candidate) => candidate.id === id);
    if (entry === undefined) throw new Error(`unknown step id: ${id}`);
    if (wanted.has(id)) return;
    wanted.add(id);
    for (const need of entry.needs) visit(need);
  };
  for (const id of ids) visit(id);
  const selected = STEP_IDS.filter((id) => wanted.has(id));
  return {
    selected,
    added: selected.filter((id) => !ids.includes(id)),
    withSetupGuide: wanted.has('0'),
    sendsPrompt: STEPS.some((entry) => wanted.has(entry.id) && entry.sendsPrompt),
  };
}

/**
 * Groups the assertion lines of a run's output by the step that printed them.
 *
 * Returns a `Map` from step id to the list of lines, each normalised to `ok <text>`, `FAIL <text>`
 * or `warn <text>` (indentation dropped). A step is opened by a `== <id> …` header; `== summary`
 * and `== timings` close the last one, and the `  time N.N s` lines are not assertion lines, so
 * they never appear. Lines before the first header go under `''`. The final state-file check of
 * `run.mjs` ("the synthetic opencode kept the conversation…") prints after the last step; it goes
 * under its own group `FINAL_GROUP`, so that a filtered run, which judges it after whatever step
 * ran last, still compares against the full run's. A single line stays comparable across runs only
 * if it carries no timing: that is why the time lines do not start with `ok`/`FAIL`/`warn`.
 */
export function extractChecks(text) {
  const groups = new Map();
  let current = '';
  for (const line of text.split(/\r?\n/)) {
    const header = /^== (\S+)/.exec(line);
    if (header !== null) {
      current = header[1] === 'summary' || header[1] === 'timings' ? '\u0000closed' : header[1];
      continue;
    }
    const check = /^\s+(ok|FAIL|warn)\s+(.*)$/.exec(line);
    if (check === null || current === '\u0000closed') continue;
    const key = check[2].startsWith(FINAL_CHECK_PREFIX) ? FINAL_GROUP : current;
    const bucket = groups.get(key) ?? [];
    bucket.push(`${check[1]} ${check[2]}`);
    groups.set(key, bucket);
  }
  return groups;
}

/** Group of the final state-file check in `extractChecks`. */
export const FINAL_GROUP = '\u0000final';
const FINAL_CHECK_PREFIX = 'the synthetic opencode kept the conversation';

/**
 * The part of `base` a filtered run can be compared with: the groups `next` has (the final
 * state-file check only if `next` printed it). Returns a new `Map`; the full run is never
 * reduced, so comparing a full run with a full run is unchanged.
 */
export function restrictToPresent(base, next) {
  return new Map([...base].filter(([id]) => next.has(id)));
}

/** Counts the occurrences of each line (a multiset: 1009 `ok` lines are only 942 distinct ones). */
function multiset(lines) {
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

/**
 * Compares two runs (`extractChecks` results) as multisets of lines per step.
 *
 * `volatile` is a `Set` of `"<id>\t<line>"` strings to leave out on both sides (the lines that
 * already differ between two runs of the SAME code, see `volatileBetween`). Returns
 * `{ differences, okA, okB, warnsA, warnsB }`: `differences` lists `{ id, line, a, b }` for each
 * line whose count differs (`FAIL` and `warn` lines included, so a new warning is a difference);
 * the counters are the totals of `ok` and `warn` lines after dropping the volatile ones.
 */
export function compareRuns(a, b, volatile = new Set()) {
  const differences = [];
  const totals = { okA: 0, okB: 0, warnsA: 0, warnsB: 0 };
  const ids = [...new Set([...a.keys(), ...b.keys()])];
  for (const id of ids) {
    const keep = (line) => !volatile.has(`${id}\t${line}`);
    const linesA = (a.get(id) ?? []).filter(keep);
    const linesB = (b.get(id) ?? []).filter(keep);
    for (const line of linesA) {
      if (line.startsWith('ok ')) totals.okA += 1;
      if (line.startsWith('warn ')) totals.warnsA += 1;
    }
    for (const line of linesB) {
      if (line.startsWith('ok ')) totals.okB += 1;
      if (line.startsWith('warn ')) totals.warnsB += 1;
    }
    const countsA = multiset(linesA);
    const countsB = multiset(linesB);
    for (const line of new Set([...countsA.keys(), ...countsB.keys()])) {
      const countA = countsA.get(line) ?? 0;
      const countB = countsB.get(line) ?? 0;
      if (countA !== countB) differences.push({ id, line, a: countA, b: countB });
    }
  }
  return { differences, ...totals };
}

/**
 * The volatile lines between two runs of the SAME code: every line whose multiset count differs
 * per step, as the `"<id>\t<line>"` strings `compareRuns` takes. Measured, not assumed: the
 * `ok` lines carry box coordinates with decimals that can move between runs.
 */
export function volatileBetween(a, b) {
  return new Set(compareRuns(a, b).differences.map((entry) => `${entry.id}\t${entry.line}`));
}
