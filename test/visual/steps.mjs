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
 * - `budgetS`: seconds the step is expected to fit in (the step 51, subagent monitor, issue #189,
 *   has 60 s: 47.2 s in `--steps 51` on 08/11/2026, Windows 11, VS Code 1.145.2, times 1.25 is
 *   59, rounded up to a multiple of 5; the full run on the final tree took 47.6 s, which gives
 *   the same 60). Criterion: the larger of the durations of
 *   the full runs of 30/10/2026 (Windows 11, VS Code 1.144.0; the phase-0 baseline and the first
 *   phase-1 run, each with 0 FAIL), times 1.25, rounded UP to the next multiple of 5 s (5 s at
 *   least). So a step passes on a normal day and is flagged when it grows by about a quarter.
 *   `== timings` marks the ones that go over; it is not a FAIL or a `warn` (decision P4). The
 *   budgets also size the shards of `--shard i/N` ({@link shardPlan}), so a stale budget skews
 *   the balance between runners, never a check. The planner declares the budget of a new step. The final full run of 31/10/2026 (Windows 11, VS Code
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
 * The step 37 (the README crops with the chat in an editor tab, issue #126) came after it too: it
 * needs the 1 (it starts from the side bar chat), sends four prompts (the Markdown one, the two
 * "Reply with exactly" turns of the fork and the ASK_PERMISSION one of the permission crop, #149)
 * and ends with `chatLocation` back at `sidebar`. Its `budgetS` of 45 is the criterion above
 * applied to the full run with the permission crop (03/11/2026, Windows 11, VS Code 1.144.1:
 * 33.1 s, times 1.25 is 41.4, rounded up to 45); the 40 it replaces came from 30.2 s with three
 * prompts (02/11/2026).
 * The step 36 gained the cells F1, F2, K1-K3 and "Copy link" in E10-settings-followup (#143). Its
 * `budgetS` of 50 is the criterion above applied to the full run of 02/11/2026 on the final tree
 * (Windows 11, VS Code 1.144.0, "all visual checks passed", no check FAIL: 38.7 s in the
 * final full run; times 1.25 is 48.4, rounded up to 50). Two partial
 * runs of the same day gave 38.6 s (`--steps 36`) and 38.2 s (`--group config`); the 80 it replaces
 * came from the 34.2 s of a run before those cells.
 * The step 38 (mods in the chat: the band, the "/" menu entry, the native toast and the palette
 * entry of a mod, E10-mods phase 3) came after it too: it needs the 1 (it starts from the side bar
 * chat), loads the `hello-station` fixture mod from the seeded mods root and sends one prompt. Its
 * `budgetS` of 25 is the criterion above applied to the two full runs that passed (02/11/2026,
 * Windows 11, VS Code 1.144.0: 16.8 s and 16.3 s; times 1.25 is 21.0, rounded up to 25). It
 * replaces the plan's estimate of 60. The first full run (62.2 s) failed the step because `web`
 * still pointed at the closed tab of step 37, so it is not a measurement. It also needs to
 * reconnect to the side bar chat: the step does `openChat` first.
 * The step 39 (the panel a mod opens beside the chat, E10-mods phase 4) came after it too: it needs
 * the 1, installs the same fixture mod as the 38 on its own and sends no prompt (it types one
 * mod command, which never reaches the model). Its `budgetS` of 20 is the criterion above applied
 * to the full run of 04/11/2026 with the cells P7 and P8 of #155, which wait 2.5 s (Windows 11,
 * VS Code 1.144.1, 795.2 s; its FAILs were in the steps 16 and 36, the 39 passed): "39    12.3 s",
 * times 1.25 is 15.4, rounded up to 20. It replaces the 15 of the full run of 02/11/2026 before
 * them (VS Code 1.144.0: 9.5 s, times 1.25 is 11.9), which replaced the plan's estimate of 45.
 * The step 40 (a folder with an opencode plugin is not launched without consent, issue #153) came
 * after it too: it needs the 1, writes and removes plugin files in the served folder, reloads the
 * window three times (40a, 40b and 40c) and sends no prompt. Its `budgetS` of 40 is the criterion
 * above applied to the full run that includes the P6 of #158 (a plugin written while the server
 * runs, no Reload): 03/11/2026, Windows 11, VS Code 1.144.1, "40    29.7 s", times 1.25 is 37.1,
 * rounded up to 40. It replaces the 35, which came from the earlier full run without that P6
 * (24.3 s, times 1.25 is 30.4); `--steps 40` alone took 25.6 s.
 * The step 41 (the "/" menu and popup list the mod command without a server, issue #155) came after
 * it too: it needs the 1, installs the `hello-station` fixture, reloads the window once with
 * `autoStart` off and sends no prompt. Its `budgetS` of 15 is the criterion above applied to the
 * full run of 04/11/2026 (Windows 11, VS Code 1.144.1, 819.2 s, its only FAIL the F2 of step 36,
 * #171): "41    11.7 s", times 1.25 is 14.6, rounded up to 15. It replaces the estimate of 30.
 * There was a step 42 (the extension in a Spanish VS Code, E11-i18n); it was removed on 04/11/2026
 * by decision of Sergio, and its id is not reused.
 * The step 43 (the tabs of the request dock, E3-request-tabs) came after the 41: it needs the 1,
 * sends three prompts (two permissions and a question, pending at once in three sessions) and
 * measures 12 theme cells. VERIFIED on Windows 11 with VS Code 1.145.2: "43    13.1 s" in the full
 * run of 07/11/2026 (863.5 s in total, "all visual checks passed"). Its `budgetS` of 20 is the
 * criterion above applied to it (13.1 times 1.25 is 16.4, rounded up to a multiple of 5; #182),
 * replacing the original estimate of 60.
 * The step 44 (the work mode pill, E3-work-mode) needs the 1 and sends prompts: 4
 * turns (an auto-approved edit, a `.env` read, a Manual edit, a SLOW one) plus the matrix of 5
 * components x 4 themes with side bar drags. VERIFIED on Windows 11 with VS Code 1.145.2: "44    28.7 s"
 * in the full run of 07/11/2026. Its `budgetS` of 40 is the criterion above applied to it (28.7 times
 * 1.25 is 35.9, rounded up to a multiple of 5).
 * The step 45 (the mods popover, E10-mod-toggles) needs the 1 and sends prompts (a turn for the
 * band of hello-station, a SLOW one). It installs four mod folders, runs ONE Reload Window and the
 * matrix of 72 cells with side bar drags. Its `budgetS` of 45 is an ESTIMATE: it comes from the
 * "45    34.8 s" (the slowest of three `--steps 45 --bail` runs: 34.3, 34.8, 34.5; Windows 11, VS Code 1.145.2, 07/11/2026, after the
 * review round removed two waits that expired for 20 s each; the 53.0 s of the first run included
 * them), not from a full run: 34.8 times 1.25 is 43.5, rounded up to a multiple of 5. The next
 * branch that runs a full run recalibrates it.
 * The steps 46, 47 and 48 (the redesigned Settings tab, E10-settings-redesign, issue #186) need the
 * 1, send no prompt and are in the group `config`: 46 is the header, the navigation and the search
 * (4 widths x 4 themes, and 2 widths x 4 themes for the search), 47 is Models and General (2 widths
 * x 4 themes each) and 48 is the three sections that only link (300 px x 4 themes). Their `budgetS`
 * of 60, 40 and 30 are ESTIMATES: nobody has timed them in a full run (a side bar drag and a theme
 * change cost about 1 s each in the steps 35 and 36; 46 makes 16 + 8 theme cells and 6 drags, 47
 * 16 and 6, 48 12 and 1), and they are NOT calibrated with the criterion above. The next branch that
 * runs a full run recalibrates them.
 * The step 49 (the native Changes and Usage views under the Sessions tree, E9-sidebar-home, issue
 * #187) needs the 1 and sends three prompts (an edit turn, a COSTLY one and a short one with the
 * Usage view collapsed). Its `budgetS` of 50 comes from the full run of that branch just before the
 * budgets were set (Windows 11, VS Code 1.145.2, 08/11/2026; that tree differs from the final one
 * only in these two `budgetS`): 36.1 s, times 1.25 is 45.1, rounded up to a
 * multiple of 5; it carries an 11.5 s negative window (a refresh 10 s after a finished turn would
 * show that a collapsed view still believed it was visible). The step 50 (the Quick start view)
 * needs the 1 and sends four prompts (MCPFLIP, SLOWER, ASK_PERMISSION and the Auto one) and runs
 * four matrices of 8 cells with side bar drags and theme switches. Its `budgetS` of 80 comes from
 * the same full run: 60.1 s, times 1.25 is 75.1, rounded up to 80. That full run had one FAIL, a
 * check of step 25 that passed 3 of 3 alone (intermittent, no verified cause); the full run on the
 * final tree passed every check (49 at 35.9 s, 50 at 59.4 s), so the budgets stand.
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
  { id: '35', needs: ['1'], sendsPrompt: true, groups: ['config'], budgetS: 120 },
  { id: '36', needs: ['1'], sendsPrompt: false, groups: ['config'], budgetS: 50 },
  { id: '37', needs: ['1'], sendsPrompt: true, groups: ['tabs'], budgetS: 45 },
  { id: '38', needs: ['1'], sendsPrompt: true, groups: ['mods'], budgetS: 25 },
  { id: '39', needs: ['1'], sendsPrompt: false, groups: ['mods'], budgetS: 20 },
  { id: '40', needs: ['1'], sendsPrompt: false, groups: ['setup'], budgetS: 40 },
  { id: '41', needs: ['1'], sendsPrompt: false, groups: ['mods'], budgetS: 15 },
  { id: '43', needs: ['1'], sendsPrompt: true, groups: ['requests'], budgetS: 20 },
  { id: '44', needs: ['1'], sendsPrompt: true, groups: ['composer', 'requests'], budgetS: 40 },
  { id: '45', needs: ['1'], sendsPrompt: true, groups: ['mods', 'composer'], budgetS: 45 },
  { id: '46', needs: ['1'], sendsPrompt: false, groups: ['config'], budgetS: 60 },
  { id: '47', needs: ['1'], sendsPrompt: false, groups: ['config'], budgetS: 40 },
  { id: '48', needs: ['1'], sendsPrompt: false, groups: ['config'], budgetS: 30 },
  { id: '49', needs: ['1'], sendsPrompt: true, groups: ['home', 'sessions'], budgetS: 50 },
  { id: '50', needs: ['1'], sendsPrompt: true, groups: ['home'], budgetS: 80 },
  // E2-subagent-monitor (issue #189): a CREW turn of about 15 s, the Stop and Answer clicks, 16
  // theme cells with side bar drags, the folded cards, a chat tab and three CREW rounds. Measured:
  // 47.2 s in `--steps 51` and 47.6 s in the full run on the final tree (08/11/2026, Windows 11,
  // VS Code 1.145.2).
  { id: '51', needs: ['1'], sendsPrompt: true, groups: ['subagents', 'requests'], budgetS: 60 },
];

/** Every valid id, in canonical order. */
export const STEP_IDS = STEPS.map((entry) => entry.id);

/**
 * Splits the steps into `count` CONTIGUOUS runs of the canonical order, balanced by `budgetS`: the
 * shards of `--shard i/N` (tooling/visual-ci-parallel, issue #199). Returns an array of `count`
 * arrays of ids, in canonical order, each id in exactly one array.
 *
 * Contiguous, not bin-packed, by decision of Sergio (Engram #2146): the full run's order is the
 * only one ever verified, and steps leak state to their neighbours (20 -> 47, #2092; 32 -> 34), so
 * a shard that keeps the adjacencies of the full run (only its first step changes predecessor)
 * sees the failures the full run sees. The split is the optimal one for the largest sum of
 * `budgetS` (dynamic programming over prefix sums; ties broken by the smaller sum of squares, so
 * the shards come out even, then by the earliest cut: deterministic). `budgetS` is a ceiling (the
 * measured time times 1.25), so the sums are a proxy for the wall clock, not the wall clock.
 * Throws `RangeError` unless `count` is an integer from 1 to the number of steps (a shard cannot
 * be empty). Pure and independent of the order of `STEPS` entries beyond the canonical one, so a
 * new step lands in exactly one shard with no extra registration.
 * VERIFIED on Windows 11 (10/11/2026) by `steps.test.mjs`: "puts every id in exactly one
 * contiguous run, in canonical order (n=%i)" for n = 1, 2, 3, 4, 6 and every step, and "is no
 * worse than any other contiguous split (brute force, n=2 and n=3)". For n=4 on this catalogue it
 * gives runs of 26, 9, 8 and 9 steps whose `budgetS` add up to 420, 425, 435 and 425 s (`node
 * test/visual/run.mjs --shard i/4 --list` for i = 1..4). NOT observed: the wall clock of a shard.
 */
export function shardPlan(count) {
  const total = STEPS.length;
  if (!Number.isInteger(count) || count < 1 || count > total) {
    throw new RangeError(
      `shard count must be an integer from 1 to ${String(total)}: ${String(count)}`,
    );
  }
  const prefix = [0];
  for (const entry of STEPS) prefix.push(prefix[prefix.length - 1] + entry.budgetS);
  // best[k][j]: the best split of the first j steps into k non-empty runs, as the largest run
  // (`max`), the sum of squares of the runs (`sq`) and where the last run starts (`cut`).
  const best = [[]];
  for (let k = 1; k <= count; k += 1) {
    best[k] = [];
    for (let j = k; j <= total; j += 1) {
      let chosen;
      for (let i = k - 1; i < j; i += 1) {
        const run = prefix[j] - prefix[i];
        const before = k === 1 ? { max: 0, sq: 0 } : best[k - 1][i];
        if (before === undefined || (k === 1 && i !== 0)) continue;
        const candidate = {
          max: Math.max(before.max, run),
          sq: before.sq + run * run,
          cut: i,
        };
        if (
          chosen === undefined ||
          candidate.max < chosen.max ||
          (candidate.max === chosen.max && candidate.sq < chosen.sq)
        ) {
          chosen = candidate;
        }
      }
      best[k][j] = chosen;
    }
  }
  const runs = [];
  let end = total;
  for (let k = count; k >= 1; k -= 1) {
    const { cut } = best[k][end];
    runs.unshift(STEP_IDS.slice(cut, end));
    end = cut;
  }
  return runs;
}

/**
 * Reads `--shard i/N` or `--shard=i/N` from `argv` (the arguments after the script name).
 *
 * Returns `{ shard: undefined }` when the flag is absent, `{ shard: { index, count } }` (both
 * integers, `index` from 1) or `{ error }` for a value that is not `i/N`, an `N` outside 1 to the
 * number of steps, or an `i` outside 1 to `N`. The caller exits with 2 on `error`.
 */
export function parseShardArg(argv) {
  const at = argv.findIndex((arg) => arg === '--shard' || arg.startsWith('--shard='));
  if (at === -1) return { shard: undefined };
  const raw = (
    argv[at].startsWith('--shard=') ? argv[at].slice('--shard='.length) : (argv[at + 1] ?? '')
  ).trim();
  const match = /^(\d+)\/(\d+)$/.exec(raw);
  if (match === null) return { error: `--shard needs i/N, for example --shard 2/4 (got "${raw}")` };
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (count < 1 || count > STEPS.length) {
    return { error: `--shard ${raw}: N must be from 1 to ${String(STEPS.length)}` };
  }
  if (index < 1 || index > count)
    return { error: `--shard ${raw}: i must be from 1 to N (${String(count)})` };
  return { shard: { index, count } };
}

/**
 * The line a shard run prints to say which steps it OWNS (`SHARD 2/4 owns steps 25, 26, …`),
 * apart from the prerequisites its `needs` add. One function for the two sides that must agree:
 * `run.mjs` prints it and `merge-shards.mjs` reads it back with {@link parseShardLine}, the same
 * pairing as {@link BAIL_BANNER}. It starts with neither `ok`, `FAIL`, `warn` nor `== `.
 */
export function shardLine(index, count, ids) {
  return `SHARD ${String(index)}/${String(count)} owns steps ${ids.join(', ')}`;
}

/** Reads {@link shardLine} back from a shard's output: `{ index, count, ids }`, or `undefined`. */
export function parseShardLine(text) {
  const match = /^SHARD (\d+)\/(\d+) owns steps (.+?)\s*$/m.exec(text);
  if (match === null) return undefined;
  return {
    index: Number(match[1]),
    count: Number(match[2]),
    ids: match[3].split(',').map((id) => id.trim()),
  };
}

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
