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
 * - `groups`: the `--group` names the step belongs to (at least one; several allowed). Chosen by
 *   reading the step titles of `run.mjs`; the map is the area the step exercises, so that
 *   `--affected` (`affected.mjs`) can send a changed file to the groups that cover it. The step 18
 *   (changed files and native diff) is in `render` although the plan's table left it out.
 * - `budgetS`: seconds the step is expected to fit in. Criterion: the larger of the durations of
 *   the full runs of 30/10/2026 (Windows 11, VS Code 1.144.0; the phase-0 baseline and the first
 *   phase-1 run, each with 0 FAIL), times 1.25, rounded UP to the next multiple of 5 s (5 s at
 *   least). So a step passes on a normal day and is flagged when it grows by about a quarter.
 *   `== timings` marks the ones that go over; it is not a FAIL or a `warn` (decision P4). The
 *   planner declares the budget of a new step. The final full run of 31/10/2026 (Windows 11, VS Code
 *   1.144.0, 0 FAIL) is a third run: no step printed `over budget`. UNVERIFIED beyond those three
 *   runs; the steps 22, 24, 28 and 29 are unstable in the background (issue #117), so their durations
 *   vary more.
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
 * The step 27 (the chat in editor tabs, issue #77) came after it too: it starts from the side bar
 * chat that the 1 opens, sends prompts, and ends with `chatLocation` back at `sidebar`.
 * The step 31 (the default of `chatLocation` is `editor`, issue #77 E5) came after it too: it
 * starts from the side bar chat that the 1 opens, sends a prompt, takes the key out of the live
 * profile and ends with `chatLocation` back at `sidebar`. VERIFIED on 30/10/2026 (Windows 11, VS
 * Code 1.144.0): `--steps 25,31 --bail` ran the 1 and the 31 and ended "all visual checks passed"
 * (the 31 alone, without the 1, was not run).
 * The step 32 (`openVsCode.autoStart` off, issue #124) came after it too: it needs the 1, reloads
 * the window twice with the key in the profile and sends one prompt. Its `budgetS` of 25 is the
 * criterion above applied to its first full run (31/10/2026, Windows 11, VS Code 1.144.0:
 * 18.1 s; a partial `--steps 21,32 --bail` had taken 10.6 s).
 * The step 33 (chat commands: `/compact`, folded user messages and Retry of a command, issue
 * #125) came after it too: it needs the 1 (it drives the chat), makes its own sessions and sends
 * six turns. Its `budgetS` of 40 is an ESTIMATE (the 24, with 36 cells, has 50): recalibrate it
 * from its first full run with the criterion above.
 * Every step after the 1 needs the 1, except the 25:
 * it is the step that opens the chat webview (`openChat`) and waits for the connection, which the
 * plan's table counted as "connected" and not as a step. VERIFIED by `--steps 8` on 27/10/2026
 * (Windows 11): without the 1 every step threw "Cannot read properties of undefined (reading
 * 'inDoc')", because `web` was never opened.
 */
export const STEPS = [
  { id: '0', needs: [], sendsPrompt: false, groups: ['setup'], budgetS: 25 },
  { id: '1', needs: [], sendsPrompt: false, groups: ['smoke'], budgetS: 5 },
  { id: '2', needs: ['1'], sendsPrompt: true, groups: ['smoke', 'render'], budgetS: 15 },
  { id: '3', needs: ['1'], sendsPrompt: true, groups: ['render'], budgetS: 10 },
  { id: '4', needs: ['2'], sendsPrompt: true, groups: ['render'], budgetS: 5 },
  { id: '5', needs: ['1'], sendsPrompt: true, groups: ['smoke', 'requests'], budgetS: 5 },
  { id: '6', needs: ['5'], sendsPrompt: true, groups: ['requests'], budgetS: 5 },
  { id: '6b', needs: ['5'], sendsPrompt: true, groups: ['requests'], budgetS: 5 },
  { id: '7', needs: ['5'], sendsPrompt: true, groups: ['setup'], budgetS: 10 },
  { id: '7b', needs: ['2'], sendsPrompt: true, groups: ['setup'], budgetS: 15 },
  {
    id: '8',
    needs: ['5', '6', '6b'],
    sendsPrompt: true,
    groups: ['smoke', 'requests'],
    budgetS: 5,
  },
  { id: '9', needs: ['2'], sendsPrompt: true, groups: ['sessions'], budgetS: 35 },
  { id: '10', needs: ['9'], sendsPrompt: true, groups: ['sessions'], budgetS: 15 },
  { id: '11', needs: ['1'], sendsPrompt: true, groups: ['selectors'], budgetS: 15 },
  { id: '13', needs: ['1'], sendsPrompt: true, groups: ['composer'], budgetS: 10 },
  { id: '14', needs: ['1'], sendsPrompt: true, groups: ['selectors'], budgetS: 10 },
  { id: '15', needs: ['1'], sendsPrompt: true, groups: ['render'], budgetS: 30 },
  { id: '16', needs: ['2'], sendsPrompt: true, groups: ['composer'], budgetS: 40 },
  { id: '17', needs: ['1'], sendsPrompt: true, groups: ['render'], budgetS: 10 },
  { id: '18', needs: ['1'], sendsPrompt: true, groups: ['render'], budgetS: 15 },
  { id: '19', needs: ['1'], sendsPrompt: true, groups: ['render'], budgetS: 20 },
  { id: '20', needs: ['1'], sendsPrompt: true, groups: ['composer'], budgetS: 15 },
  { id: '21', needs: ['1'], sendsPrompt: false, groups: ['setup'], budgetS: 5 },
  { id: '22', needs: ['2'], sendsPrompt: true, groups: ['keyboard'], budgetS: 20 },
  { id: '23', needs: ['1'], sendsPrompt: false, groups: ['selectors'], budgetS: 25 },
  { id: '24', needs: ['1'], sendsPrompt: true, groups: ['composer'], budgetS: 50 },
  { id: '25', needs: [], sendsPrompt: false, groups: ['setup'], budgetS: 25 },
  { id: '26', needs: ['1'], sendsPrompt: true, groups: ['composer'], budgetS: 40 },
  { id: '27', needs: ['1'], sendsPrompt: true, groups: ['tabs'], budgetS: 60 },
  { id: '28', needs: ['1'], sendsPrompt: true, groups: ['tabs'], budgetS: 50 },
  { id: '29', needs: ['1'], sendsPrompt: true, groups: ['sessions', 'tabs'], budgetS: 105 },
  { id: '30', needs: ['1'], sendsPrompt: true, groups: ['requests', 'tabs'], budgetS: 60 },
  { id: '31', needs: ['1'], sendsPrompt: true, groups: ['tabs'], budgetS: 20 },
  { id: '32', needs: ['1'], sendsPrompt: true, groups: ['setup'], budgetS: 25 },
  { id: '33', needs: ['1'], sendsPrompt: true, groups: ['composer', 'render'], budgetS: 40 },
  { id: '34', needs: ['1'], sendsPrompt: true, groups: ['sessions'], budgetS: 120 },
];

/** Every valid id, in canonical order. */
export const STEP_IDS = STEPS.map((entry) => entry.id);

/**
 * The step groups of `--group`: group name to its step ids, in canonical order. Derived from
 * `groups` in {@link STEPS} (a step can be in several), so there is one place to edit. Insertion
 * order is the order of first appearance, which is what the error message lists.
 */
export const GROUPS = (() => {
  const map = new Map();
  for (const entry of STEPS) {
    for (const group of entry.groups) map.set(group, [...(map.get(group) ?? []), entry.id]);
  }
  return map;
})();

/**
 * Reads `--group a,b` or `--group=a,b` from `argv` (the arguments after the script name).
 *
 * Returns `{ ids: undefined }` when the flag is absent, `{ ids }` with the union of the groups'
 * step ids in canonical order, or `{ error }` listing the valid groups: an empty or missing list,
 * or an unknown group. The caller exits with 2 on `error`. The ids are then closed over `needs`
 * by {@link resolveSelection}, so a group never runs without the steps it starts from.
 */
export function parseGroupArg(argv) {
  const index = argv.findIndex((arg) => arg === '--group' || arg.startsWith('--group='));
  if (index === -1) return { ids: undefined };
  const raw = argv[index].startsWith('--group=')
    ? argv[index].slice('--group='.length)
    : (argv[index + 1] ?? '');
  const names = [
    ...new Set(
      raw
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== ''),
    ),
  ];
  const valid = `valid groups: ${[...GROUPS.keys()].join(', ')}`;
  if (names.length === 0) return { error: `--group needs a list of group names (${valid})` };
  const unknown = names.filter((name) => !GROUPS.has(name));
  if (unknown.length > 0) {
    return {
      error: `unknown group${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')} (${valid})`,
    };
  }
  const wanted = new Set(names.flatMap((name) => GROUPS.get(name)));
  return { ids: STEP_IDS.filter((id) => wanted.has(id)) };
}

/**
 * The groups that contain at least one of `ids`, in the order of {@link GROUPS}. `--list` prints
 * them next to the resolved steps.
 */
export function groupsOf(ids) {
  return [...GROUPS.keys()].filter((name) => GROUPS.get(name).some((id) => ids.includes(id)));
}

/**
 * The `== timings` suffix of a step: `'  over budget (Ns)'` when `seconds` exceeds the step's
 * `budgetS`, else `''`. Never a `warn` or a FAIL (decision P4, Engram
 * `tooling/test-speed/decisions/p1-p4`: the budget brakes growth, it does not break runs, and a
 * `warn` would enter `compare-runs`). An id without a budget gets `''`.
 */
export function budgetNote(id, seconds) {
  const budget = STEPS.find((entry) => entry.id === id)?.budgetS;
  return budget !== undefined && seconds > budget ? `  over budget (${String(budget)} s)` : '';
}

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
 * The line `run.mjs` prints when `--bail` is on.
 *
 * One constant for the two sides that must agree: `run.mjs` prints it, and `fingerprint.mjs`
 * looks for it to refuse a `--bail` run as evidence (exit 3). With the text copied in both, a
 * reworded banner would let a `--bail` run pass `--check` with exit 0 (review #1586 of #118).
 */
export const BAIL_BANNER =
  '--bail: the run stops after the first step that fails; not evidence for a commit';

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
 * The line `run.mjs` prints when `--with-copilot` is on; `fingerprint.mjs` refuses such a run as
 * evidence (exit 3), the same pairing and for the same reason as {@link BAIL_BANNER}.
 */
export const COPILOT_BANNER =
  '--with-copilot: VS Code keeps its AI features and secondary side bar; not evidence for a commit';

/**
 * Whether `--with-copilot` is in `argv` (issue #98).
 *
 * The profile of the suite turns the AI features of VS Code off (`chat.disableAIFeatures`) and hides
 * the secondary side bar, so that the Copilot chat and its GitHub terms dialog never get in the
 * way. With the flag those two settings are not written, to see the extension in the window a
 * user has before a release. The run is not evidence: the checks were written for the quiet profile.
 */
export function parseWithCopilotArg(argv) {
  return argv.includes('--with-copilot');
}

/**
 * The line that ends a run cut short by the diagnosis after a failed step (issue #127).
 *
 * `cause` is `{ kind, detail }`: `cdp` (the chat webview stopped answering and could not be
 * reopened), `workbench` (the page of the workbench stopped answering), `focus` (the VS Code window
 * does not hold the system focus) or `dialog` (a modal dialog is open; `detail` is its text, cut to
 * 80 characters). The line starts with neither `ok`, `FAIL`, `warn` nor `== `, so `extractChecks`
 * and `compare-runs` ignore it, and it is not indented so it is not mistaken for part of the step.
 * Throws on another `kind`, so a new cause cannot go out without a text.
 */
export function stopLine(id, cause) {
  const detail = cause.detail.replace(/\s+/g, ' ').trim();
  const reasons = {
    cdp: `the chat webview stopped answering CDP (${detail})`,
    workbench: `the workbench stopped answering CDP (${detail})`,
    focus: 'the VS Code window does not have the system focus (another window is in front)',
    dialog: `a modal dialog of VS Code is open ("${detail.slice(0, 80)}")`,
  };
  const reason = reasons[cause.kind];
  if (reason === undefined) throw new Error(`unknown stop cause "${String(cause.kind)}"`);
  return `STOPPED after step ${id}: ${reason}; the remaining steps are skipped`;
}

/**
 * Whether `--list` is in `argv`: print the resolved selection (steps, groups, `--affected` choice,
 * PARTIAL banner or full) and exit 0 before starting VS Code (`node test/visual/run.mjs --list` builds nothing;
 * `npm run test:visual -- --list` runs the build scripts first), so that
 * `--group` and `--affected` can be checked without paying a run (added by Sergio in phase 2 of
 * tooling/test-speed).
 */
export function parseListArg(argv) {
  return argv.includes('--list');
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
 * `== timings` and `== waits` close the last one, and the `  time N.N s` lines are not assertion
 * lines, so they never appear. Lines before the first header go under `''`. The final state-file check of
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
      current = CLOSING_HEADERS.has(header[1]) ? '\u0000closed' : header[1];
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

/** Headers after the last step that end the assertion lines in `extractChecks`. */
const CLOSING_HEADERS = new Set(['summary', 'timings', 'waits']);

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
 * The `warn` that VS Code's webview host raises on its own while mounting a webview (a race of
 * VS Code, `run.mjs` already words it that way). Seen in one run and not in another of the same
 * code (30/10/2026: steps 0 and 1 in the instrumented run only), so it is not a difference.
 */
const RACE_WARN = /^warn .*VS Code's webview host threw "Found unexpected null" while mounting/;

/**
 * Makes a line comparable across runs of the same code: wall-clock times (`07:55 PM`, also when
 * glued to a word, as in the rows "Untitled session07:52 PM"), UUIDs (the
 * view id in the C10 check of step 27) and the number of formats the clipboard held (step 20,
 * "held 3 formats"; it is whatever the user had copied) become fixed placeholders. Only those
 * three shapes; every other digit still counts. Derived from the 26 differences between two
 * identical-code full runs of 30/10/2026, all of them one of these shapes or {@link RACE_WARN}.
 */
export function normalizeVolatile(line) {
  return line
    .replace(/\d{1,2}:\d{2} [AP]M/g, '<time>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')
    .replace(/(clipboard held) \d+ formats/g, '$1 <n> formats');
}

/**
 * Compares two runs (`extractChecks` results) as multisets of lines per step.
 *
 * `volatile` is a `Set` of `"<id>\t<line>"` strings to leave out on both sides (the lines that
 * already differ between two runs of the SAME code, see `volatileBetween`). Lines are compared
 * after {@link normalizeVolatile}, and the {@link RACE_WARN} lines are taken out of the
 * comparison and counted apart. Returns `{ differences, okA, okB, warnsA, warnsB, racesA, racesB }`:
 * `differences` lists `{ id, line, a, b }` (the line as normalised) for each line whose count
 * differs (`FAIL` and `warn` lines included, so a new warning is a difference); the counters are
 * the totals of `ok` and `warn` lines after dropping the volatile ones, and `racesA`/`racesB`
 * count the race warnings dropped on each side (they are not in `warnsA`/`warnsB`).
 */
export function compareRuns(a, b, volatile = new Set()) {
  const differences = [];
  const totals = { okA: 0, okB: 0, warnsA: 0, warnsB: 0, racesA: 0, racesB: 0 };
  const ids = [...new Set([...a.keys(), ...b.keys()])];
  for (const id of ids) {
    const keep = (line) => !volatile.has(`${id}\t${line}`);
    const split = (lines, side) => {
      const kept = [];
      for (const line of lines.filter(keep)) {
        if (RACE_WARN.test(line)) totals[side] += 1;
        else kept.push(normalizeVolatile(line));
      }
      return kept;
    };
    const linesA = split(a.get(id) ?? [], 'racesA');
    const linesB = split(b.get(id) ?? [], 'racesB');
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
