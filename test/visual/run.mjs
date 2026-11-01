// Visual and behaviour check of the chat inside a REAL VS Code, driven over CDP.
//
// `npm run test:visual`. Needs NO model, quota or network (tooling/tests-without-model): the
// opencode behind the extension is the synthetic `fake-opencode.mjs`, launched as the extension's own
// server through the seam of `testLaunch.ts` (Development mode + OPEN_VS_CODE_VISUAL_FAKE=1, set by
// `vscodeProcess.mjs`). Prompts carry trigger words (MARKDOWN, LONG, ASK_PERMISSION, ASK_QUESTION,
// SUBAGENT, TOOLS, BROKEN_READ, COSTLY) that the fixture reacts to. Not run in CI. See
// `test/visual/README.md`.
//
// HISTORY, not current evidence: until 22/10/2026 this run used a real opencode 2.0.32 and the free
// model, and the long notes below ("VERIFIED ... glm-5.3-flash-free", 326/385/386 ok lines, the
// SKIPPED paths that depended on what the model did) describe those runs. Against the fixture
// nothing is skipped: every former SKIPPED is an assertion. VERIFIED against the fixture (Windows
// 11, VS Code 1.143.1, Node 24, 23/10/2026, final tree of tooling/tests-without-model): the run
// of 23/10/2026 11:19:12-11:25:54 (no real opencode) ended "all visual checks passed" with exit 0
// and 456 `ok`, 0 FAIL. Earlier, three
// consecutive runs ended "all visual checks passed" with exit 0, 456 `ok` lines, 0 FAIL, the
// same set of `ok` lines (identical hash of the sorted lines), and one `warn`
// ("light: weakest highlighted token contrast is 2.89 (< 3)", independent of any model). Step 17
// printed "the figures are those of the step: 4248 tokens of 200000", "the costly line ... Context
// 4K / 5K (85%) · $0.01" and "85 % of the window flags the line as high (high)". NOT observed:
// macOS, Linux, a real model, a screen reader.
//
// What it protects: the things no unit test can see, found by hand on 20/10/2026 (Engram #934):
// code unreadable in "High Contrast Light", a Stop painted as a red error, notifications and
// badge with the view hidden, focus on a request card, a window reload that must keep the session.
// It launches an isolated VS Code (`vscodeProcess.mjs`), drives the workbench with Playwright over
// CDP (real mouse and keyboard, screenshots) and the chat webview with raw CDP (`webviewCdp.mjs`).
//
// Where there is something objective it ASSERTS (a failed assertion makes the exit code 1):
// no CSP violation and no uncaught exception in the webview, a neutral "Stopped" note without
// role=alert after Stop, text/background contrast of code in the four themes, the toast and the badge with
// the view hidden, focus in the permission card, one primary button at a time, "Ln 20" after a
// file link, the session kept after Restart Server and after Reload Window. Since
// E3-resolved-history (issues #56/#18) it also asserts that what the user answered stays in the
// conversation under its tool ("Allowed once", "Answered … Letter: B", a plain "Rejected" that is not an
// alert), survives another prompt and Restart Server unchanged, and after Reload Window keeps only
// what the tool blocks say ("Answered", "Rejected") while "Allowed once" is gone. Since
// E4-session-management (issue #20) step 9 drives the session list with the real mouse and
// keyboard: groups, times, the open session marked in the four themes, ArrowDown and a visible focus
// ring, Escape returning the focus, the lazy New session (no session until the first prompt), the
// in-line rename (row and header), the server-side search, switching, and a delete confirmed in the
// MODAL dialog of VS Code (`window.dialogStyle: custom`, so it is DOM that Playwright can press),
// declined once and confirmed once. Since E4-fork-subsessions (issue #21) step 10 sends two prompts,
// hovers and Tabs to "Fork from here" on the second user message, forks with the real mouse and
// asserts the new session holds only the first exchange, the "Forked from" crumb, the refilled and
// focused prompt, the "Fork" word in the session list, and that the crumb returns to the intact
// original; then it sends SUBAGENT (the fixture creates the child session) and follows the link
// to the child ("‹ parent" crumb), back, and through "Subagent sessions (1)". Since
// E5-model-agent-selectors (issues
// #23/#24), and since E2 (#85) phase 3 on the combined chip "agent · model ▾", step 11 drives the
// chip with the real mouse and keyboard: its panel (focus on the current agent, the Agent and Model
// columns, stacked only under 360 px of container, groups, the four themes), filtering and choosing
// with the keyboard, Escape, the agent (mouse, Tab to the chip with a visible ring, Enter, arrows,
// and that Enter on an agent row does NOT send the prompt), a real prompt whose reply line must
// read "Plan · <chosen model>", the last used model proposed to the next new session, the
// `openVsCode.defaultModel` setting beating it (and a malformed value being reported once and
// ignored) and reopening the session; it also presses the prompt box with the real mouse while the
// panel is open and asserts the panel closes. The rewrite of steps 11 and 14 on the chip first ran
// in the full run of phase 4 (27/10/2026, all green). It runs after steps 1-10,
// which keep the fixture's default model. Step 13 (review #1015 S1) attaches a real file with the "Attach file…" item of the "+" menu (the
// file dialog is VS Code's own quick input, `files.simpleDialog.enable` in `vscodeProcess.mjs`),
// sends, and asserts the message leaves with its attachment and the webview logs no exception: a
// prompt with an attachment used to throw DataCloneError (VERIFIED by running this step against the
// old code on 21/10/2026: the exception was logged and the message never left). Since
// E5-model-variant (issue #61) step 14, the last one, drives the reasoning-variant control: it
// picks (dynamically) a model that lists variants, checks the control sits right after the model
// button, opens its panel with the real mouse (four themes), chooses a variant, Tab / Enter /
// arrows / Escape, an outside press, that the same model keeps the variant and another starts on
// Default, a real prompt whose reply line must end in the variant, that a new session proposes the
// last model with its variant, and that reopening the session shows the variant the server
// stored. The fixture's catalog always has a model with variants, so the step asserts it. What a
// reply says is written by the fixture on a trigger word, never by a model.
//
// "Always allow": the script only opens that panel (the "Always allow…" toggle), checks it, goes
// Back and presses "Allow once". It never asks for "Yes, always allow" (`clickButton` throws on
// that text) and, before each button click, it checks in the page that the element under the
// pointer is the intended button and is not an /always/ button other than that toggle. This does
// not cover a layout shift in the few milliseconds between that check and the click, nor clicks
// made by selector (textarea, file links, code buttons), which never target a request card.
//
// Isolation: opencode's data/state/cache dirs are redirected into `.vscode-test/visual/opencode-xdg`
// (see `vscodeProcess.mjs`), so the run does not add sessions to the developer's own history.
//
// Window: the run sets 1440x900 CSS px (`setWindowSize`) and prints size, DPR and webview width;
// a window that does not reach it is meant to exit with 2 (not executed). Step 15 also measures the failed card in a 1080x900
// window with a 270 px side bar (`setSideBarWidth`), see `test/visual/README.md`.
//
// Filter and timings (issue #89, `steps.mjs`): `--steps 11,14,23` runs only those steps, in the
// canonical order, plus the steps they need (`needs` in `STEPS`, closed automatically and announced
// before the run). A filtered run prints `PARTIAL RUN (steps …): not evidence for a commit`, writes
// its screenshots to `shots-partial/` and its README crops to `readme-partial/` (the full run's
// `shots/` and `readme/` stay untouched), starts VS Code normally (the fixture as server, no `.down`
// marker) unless step 0 is in, and judges the fake's state file only if a selected step sends a
// prompt. An unknown id exits with 2 and lists the valid ones. Every step prints `  time N.N s` and
// the summary has `== timings` (those lines never start with ok/FAIL/warn, so `compare-runs.mjs`
// ignores them). A full run that did not execute exactly the ids of the catalogue fails (a silent
// guard: it prints no `ok` line).
// Waits (tooling/test-speed, phase 0): after `== timings` the run prints `== waits` (no line starts
// with ok/FAIL/warn, and `extractChecks` closes on it): the expired `waitFor`s with step, cap, ms
// spent and calling line, the `waitIdle` calls that paid the 2 s floor, the fixed `sleep` and
// `page.waitForTimeout` ms per step and the longest gaps between checks. Every record also goes to
// `.vscode-test/visual/trace-full-<YYYYMMDD-HHMMSS>.tsv` (`trace-partial-<…>.tsv` for a filtered or
// bailing run; one file per run, none overwritten). The trace only measures: no wait or check
// changed.
// Groups, affected and budget (tooling/test-speed, phase 2): `--group selectors,tabs` runs the steps
// of those groups (`GROUPS` in `steps.mjs`, from the `groups` of each step) and unites with
// `--steps`; both close over `needs` and print the PARTIAL banner with the groups. `--affected
// [ref]` (default `origin/main`) reads the files changed since the merge-base, plus the untracked
// ones, and `affected.mjs` maps them to groups: it prints `affected: <groups | full | none>` with
// one reason per file, and a cross-cutting or unmapped file (or git failing) means the FULL run.
// It does not combine with `--steps`/`--group`. `--list` prints the resolved selection and exits 0
// before starting VS Code (`node test/visual/run.mjs --list` builds nothing; `npm run test:visual
// -- --list` runs the build scripts first, because npm runs them before this file). Each step has a `budgetS`; `== timings` appends
// "over budget (N s)" to the ones that exceed it (no FAIL, no warn: decision P4).
// `npm run test:visual -- --steps 8` passes the arguments through npm to this script
// (VERIFIED on Windows 11, 27/10/2026: `npm run test:visual -- --steps 1` printed "PARTIAL RUN
// (steps 1): not evidence for a commit" and ran only that step; `node test/visual/run.mjs --steps
// 8` printed "steps added because the requested ones need them: 1, 5, 6, 6b (requested: 8)" and
// ended "all visual checks passed"). Every step after the 1 needs the 1, which opens the chat.
// Only a FULL run is evidence.
// `--bail` (for development, decision of Sergio, 28/10/2026): the first FAIL ends its step, the
// later steps are skipped and the run exits 1 after its cleanup, so a broken state costs seconds
// instead of every later wait running to its cap. It prints that the run is not evidence and
// writes to `shots-partial/` and `readme-partial/`, like a filtered run. Combines with `--steps`.
// Without the flag too, after a FAILED step the run looks for a reason it cannot go on (the chat
// webview stopped answering and cannot be reopened, the window lost the system focus, a modal
// dialog is open) and stops with a `STOPPED after step <id>: …` line: the later steps would only
// fail in cascade (issues #93 and #127, see `step`).
// `--with-copilot` (issue #98) starts VS Code without the two settings that hide the Chat (Copilot)
// and turn the AI features off; like `--bail` it is not evidence and writes to `shots-partial/`.
//
// Themes (issue #89): every theme change goes through `setTheme`, which waits for the theme to be
// applied (workbench class, webview kind, two frames) instead of sleeping. The six loops that only
// take screenshots (11g, 12b, 12d, 12f, 14b, 14d) capture once, in dark, unless `--all-themes` is
// given (decision of Sergio); they carry no check, so the `ok` lines are the same either way.
//
// Waits (issue #89 phase 3): a wait is a condition with a cap (`waitFor`, `waitPresent`,
// `waitEmptyView`, `settleLayout`, `command`, the start of `waitIdle`), never a fixed sleep, except
// where the comment next to the `sleep` says why it stays (negative checks, the pace of the
// fixture, keys whose effect has no signal). A wait that expires does not throw: the check after
// it still runs, so a failure is still a FAIL line.
//
// Output: screenshots in `.vscode-test/visual/shots/` (ignored by git), and a summary on stdout.
// At the end (also after an exception, and on SIGINT/SIGTERM) VS Code is closed with its whole
// process tree and the temporary workspace is deleted. A hang inside a CDP call is cut by a
// timeout (`webviewCdp.mjs`), so cleanup is reached. Exit codes: 0 all good, 1 an assertion
// failed, 2 the run could not start (missing build, VS Code download or launch).
//
// VERIFIED on Windows 11, VS Code 1.143.0 (the `stable` archive that `@vscode/test-electron`
// resolved on 21/10/2026, read from the run's main.log; earlier runs used 1.142.0), opencode 2.0.32,
// Node 24 (see the run recorded in Engram `E2-mvp-prototype/implementation-visual`). One earlier run
// of the same day failed in step 9 (a rename left in edit mode, then no delete modal) and passed on
// the next, with no code change in between: HYPOTHESIS that step 9 has a timing flake.
// macOS and Linux UNVERIFIED.
//
// HISTORY (real opencode, 22/10/2026): step 14 (issue #61) VERIFIED on Windows 11, VS Code
// 1.143.0, opencode 2.0.32, ~09:56-09:57, on the final tree: the whole run passed ("all visual checks passed", exit 0) and
// step 14 used `opencode/glm-5.3-flash-free` (variants low/high/max). Both halves of "the control
// appears only for a model with variants" RAN in that run (not skipped): `opencode/big-pickle`
// showed no control, and "another model starts on Default or shows no control" held. The
// extension's OpenCode.log of that run shows `model selected opencode/glm-5.3-flash-free for
// ses_… (variant low)` at 09:56:55.960, `prompt accepted` at 09:56:55.989 and `turn finished:
// succeeded` at 09:56:58.038; the step also checked, in four themes, the panel and the chosen
// state, the focus ring, the reply line ending in "· low", the new session and the reopened one
// (the check "the reopened session shows the variant the SERVER stored ("Reasoning: low")"
// passed). NOT observed: a screen reader,
// macOS and Linux, a catalog whose models list no variants (the step skipped then), and the host
// refusing an unlisted variant against a real server.
//
// HISTORY (real opencode, 22/10/2026): step 15 (issue #26, tool cards) VERIFIED on Windows 11,
// VS Code 1.143.0, opencode 2.0.32, model
// `opencode/glm-5.3-flash-free`, on 22/10/2026 in the final run of the polish round (~15:23-15:30,
// on the final tree; "all visual checks passed", exit 0, 326 ok lines, 0 FAIL; an earlier run of
// the same step on 22/10/2026 13:59-14:05 printed the same checks except the last one below). The
// model completed shell, read, grep and edit from ONE combined prompt (no retry prompt was
// needed): the line `cards: ["shell:completed","read:completed","grep:completed",
// "edit:completed"]`, so shell, read and edit were NOT skipped. In the extension's OpenCode.log of
// the final run the combined prompt is `prompt accepted` 15:29:21.382 to `turn finished:
// succeeded` 15:29:28.795, and the failing read asked ONCE (no retry) as 15:29:48.935 to
// 15:29:50.112. Real headers: "Shell node --version · done · exit 0", "Read src/sample.ts ·
// done · lines 1-30", "Grep greet in src · done · 1 match", "Edit src/sample.ts · done · +1 −1".
// Per tool: Shift+Tab from the prompt box reached the toggle with a visible ring, Enter opened
// it, the body was right (shell "v24.22.0"; read the file; grep the match; edit 1 hunk line, 1
// added, 1 deleted), Space closed it. Diff text contrast >= 4.5 in the four themes, header words
// too (lowest 5.47). Last card: `the header of the last card
// (data-tool="edit") is still in view after unfolding it (true)`: `tagCard` now really marks the
// LAST card (an earlier version passed two arguments to `inDoc`, which forwards one, and silently
// tagged the first card, so the older "last card" claims were about the shell card; Engram #1041
// C1), and it prints the `data-tool` it marked. It proves the header was in view, NOT that the
// deferred `scrollIntoView` of `ToolCard` moved anything. Failed: the model called
// read on the missing `src/does-not-exist.ts` at the first ask; the card said "Read
// src/does-not-exist.ts · failed · File not found: src/does-not-exist.ts", folded, error tone, the
// unfolded body held the same line, the header fitted its toggle, and the chip text contrast was
// 8.68 / 8.03 / 21.00 / 14.55 in light / dark / hc-dark / hc-light. The error text inside the
// unfolded body (`.tool-error`, foreground text with the error colour on a left border) passed
// "the error text of the unfolded failed body has text contrast >= 4.5 in light|dark|hc-dark|
// hc-light" with 10.55 / 11.06 / 21.00 / 14.55; it was NOT measured with the old bare
// `errorForeground` text (its 3.16 in light is the chip's, inferred for the body). If the model
// never called the tool the failed part was skipped with a `warn` (it was not, in that run); the
// fixture run asserts it instead. The
// check found two real defects in earlier runs of this round (bare errorForeground 3.16 in
// light; an error line running over the "Open" link in the side bar), both fixed in `index.css`;
// the overflow check is a regression check added after the fix and was not run against the
// broken CSS. NOT observed: tools other than shell, read, grep and edit (write, patch, glob, webfetch, websearch, skill,
// question, MCP), a running/rejected/stopped/awaiting card, Copy and "Open in editor" pressed, a
// clipped output, macOS and Linux, a screen reader.
//
// HISTORY (real opencode, 22/10/2026): step 16 (issues #28/#29, the `@` popup and the editor
// context) VERIFIED on Windows 11, VS Code
// 1.143.0, opencode 2.0.32, model `opencode/glm-5.3-flash-free`, on 22/10/2026 (last run, after the
// review round that added the Enter-while-pending check: "all visual checks passed", exit 0, 386
// ok lines, 0 FAIL, with the warning "the free model did not finish the turn in 120 s; the reply
// line was not judged" and "More agents" skipped; the run before it, without that new check, had
// 385 ok lines: the count moves with what the free model does in the turn steps). Observed with
// the real keyboard and mouse: "Enter right after a keystroke neither sends nor picks" (decision
// W1 of Sergio: `x` typed after `@sample` and Enter pressed at once, the box kept "@samplex" with
// 0 chips and 0 new messages), which was NOT run against the old code, so it is not shown that
// the check would have failed there; "typing "@sample" lists at least two files" (rows
// `src/sample.ts`, `src/sample-extra.ts`); "the box points at the highlighted option (aria-controls and
// aria-activedescendant)"; "the keyboard focus stays in the prompt box while the popup is open";
// "a search does not lock Send"; text contrast of a normal row, the highlighted row and the "No
// files match" line >= 4.5 in the four themes (the lowest, the folder part of a normal row, was
// 5.47 in hc-light and 6.01 in dark); "Enter adds the chip src/sample.ts" and "the text
// @src/sample.ts stays in the box" with "Enter on the popup picks the file and does not send the
// prompt"; "ArrowUp with the popup closed recalls the last prompt"; with a turn running, "Escape
// with the popup open does NOT stop the running turn" and "a second Escape (popup closed) stops the
// turn"; "a mouse press picks the row" with "the focus is still in the prompt box after the mouse
// pick"; "pressing the chip opens src/sample.ts in the editor (1 tab)"; after selecting lines 2-3
// (the editor said "Ln 4, Col 1 (51 selected)": the selection ends at column 0 of line 4),
// "Add selection adds the chip src/sample.ts#2-3 with the focus in the webview", so the active
// editor is still the active editor while the focus is in the chat; "the message left with both
// files ("src/sample.ts, src/sample.ts#2-3")"; and "the conversation chip opens src/sample.ts at
// line 2 (status bar: "Ln 2, Col 1")". NOT observed: how many tries the new file `src/sample-extra.ts`
// needed to be listed (the step retries for the 10 s index refresh and does not count them), the
// unsaved-changes warning and the "Save the file first" refusal in the webview (the integration
// suite sees only their log lines), a screen reader, a catalog of hundreds of files, macOS and
// Linux.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createWorkspace, startVSCode, writeSettings } from './vscodeProcess.mjs';
import { WEBVIEW_NO_TARGET, WEBVIEW_STUCK, openWebview } from './webviewCdp.mjs';
import { parseAffectedArg, selectForFiles } from './affected.mjs';
import { fingerprint, saveManifest } from './fingerprint.mjs';
import {
  BAIL_BANNER,
  COPILOT_BANNER,
  STEP_IDS,
  budgetNote,
  groupsOf,
  parseAllThemesArg,
  parseBailArg,
  parseGroupArg,
  parseListArg,
  parseStepsArg,
  parseWithCopilotArg,
  resolveSelection,
  stepIdOf,
  stopLine,
} from './steps.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const workDir = path.join(repoRoot, '.vscode-test', 'visual');

/**
 * The files `--affected` judges: those changed since the merge-base of HEAD and `ref` (committed,
 * staged or not) plus the untracked ones that git does not ignore. Returns `{ files }`, or
 * `{ error }` when git or the ref is not there (no `origin/main` in a shallow or detached
 * checkout), which the caller turns into the full run with the reason printed.
 * VERIFIED on Windows 11 (31/10/2026): `node test/visual/run.mjs --list --affected` in this tree
 * printed the changed files of the branch against `origin/main`. NOT run: macOS and Linux; a
 * checkout without `origin/main` (the `error` branch was only read).
 */
function changedFilesSince(ref) {
  const git = (args) =>
    execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .split(/\r?\n/)
      .filter((line) => line !== '');
  try {
    const [base] = git(['merge-base', 'HEAD', ref]);
    const tracked = git(['diff', '--name-only', '--no-renames', base]);
    const untracked = git(['ls-files', '--others', '--exclude-standard']);
    return { files: [...tracked, ...untracked] };
  } catch (error) {
    return { error: `git could not diff against ${ref} (${String(error.message).split('\n')[0]})` };
  }
}

// `--steps`, `--group` and `--affected` filters (see the header). Read before anything is created,
// so a typo costs nothing.
const cliArgs = process.argv.slice(2);
const parsedSteps = parseStepsArg(cliArgs);
const parsedGroups = parseGroupArg(cliArgs);
const affectedArg = parseAffectedArg(cliArgs);
for (const parsed of [parsedSteps, parsedGroups]) {
  if (parsed.error !== undefined) {
    console.error(`test:visual: ${parsed.error}`);
    process.exit(2);
  }
}
if (affectedArg.enabled && (parsedSteps.ids !== undefined || parsedGroups.ids !== undefined)) {
  console.error(
    'test:visual: --affected chooses the steps itself; do not combine it with --steps or --group',
  );
  process.exit(2);
}
/** What `--affected` decided (`{ mode, groups, reasons }`), or `undefined` without the flag. */
let affected;
if (affectedArg.enabled) {
  const ref = affectedArg.ref ?? 'origin/main';
  const changed = changedFilesSince(ref);
  affected =
    changed.error === undefined
      ? selectForFiles(changed.files)
      : { mode: 'full', groups: [], reasons: [changed.error] };
}
/** `--steps` and `--group` together run the union; `--affected` supplies groups instead. */
const requestedIds =
  affected !== undefined
    ? affected.mode === 'groups'
      ? parseGroupArg(['--group', affected.groups.join(',')]).ids
      : affected.mode === 'none'
        ? []
        : undefined
    : parsedSteps.ids === undefined && parsedGroups.ids === undefined
      ? undefined
      : STEP_IDS.filter(
          (id) => (parsedSteps.ids ?? []).includes(id) || (parsedGroups.ids ?? []).includes(id),
        );
/** `undefined` for the full run, else the requested ids closed over their prerequisites. */
const selection = requestedIds === undefined ? undefined : resolveSelection(requestedIds);
const partial = selection !== undefined;
/** `--all-themes`: the screenshot-only theme loops capture in four themes instead of dark only. */
const allThemes = parseAllThemesArg(cliArgs);
/** `--bail`: stop after the first step that fails (for development; see `parseBailArg`). */
const bail = parseBailArg(cliArgs);
/** `--with-copilot`: keep the AI features and the secondary side bar of VS Code (see `parseWithCopilotArg`). */
const withCopilot = parseWithCopilotArg(cliArgs);
const selectedIds = new Set(selection?.selected ?? STEP_IDS);
if (affected !== undefined) {
  const shown = affected.reasons.slice(0, 12).map((reason) => `\n  ${reason}`);
  if (affected.reasons.length > 12)
    shown.push(`\n  … and ${String(affected.reasons.length - 12)} more`);
  console.log(
    `affected: ${affected.mode === 'groups' ? affected.groups.join(', ') : affected.mode}${shown.join('')}`,
  );
}
if (affected?.mode === 'none') {
  console.log('affected: no changed file has a visual effect; nothing to run');
  process.exit(0);
}
if (partial) {
  console.log(`PARTIAL RUN (steps ${selection.selected.join(', ')}): not evidence for a commit`);
  console.log(
    `groups touched (prerequisites included): ${groupsOf(selection.selected).join(', ')}`,
  );
  if (selection.added.length > 0) {
    console.log(
      `steps added because the requested ones need them: ${selection.added.join(', ')} (requested: ${requestedIds.join(', ')})`,
    );
  }
} else if (parseListArg(cliArgs)) {
  console.log(`FULL RUN (all ${String(STEP_IDS.length)} steps)`);
}
if (bail) console.log(BAIL_BANNER);
if (withCopilot) console.log(COPILOT_BANNER);
// `--list` stops here: it only shows what the flags above resolve to; this file starts no VS Code.
if (parseListArg(cliArgs)) process.exit(0);
// The code this run covers (`fingerprint.mjs`, tooling/test-speed phase 3; only valid for
// `test:visual`). Taken before VS Code starts. `npm run test:visual` builds just before this file,
// so the hash is the tree that build saw; running this file directly over a stale `dist/` makes
// the line lie (it hashes the sources, not the bundle that runs). The line does not start with
// ok/FAIL/warn nor `== `, so `extractChecks` and `compare-runs` skip it. `node
// test/visual/fingerprint.mjs --check <this output>` later says whether the run still covers the
// tree. The manifest lets that check name the changed files.
const codeFingerprint = fingerprint(repoRoot);
saveManifest(repoRoot, codeFingerprint);
console.log(`fingerprint ${codeFingerprint.hash}`);
// A filtered, bailing or `--with-copilot` run never touches the folders of the full run.
const scratchOutput = partial || bail || withCopilot;
const shotsDir = path.join(workDir, scratchOutput ? 'shots-partial' : 'shots');

const failures = [];
const warnings = [];
const shots = [];
/** Lines the webview logged (CSP violations, console, exceptions), across every connection. */
const webviewLogs = [];

/**
 * The time trace of the run (tooling/test-speed, phase 0): where the seconds go, with no effect on
 * what the run checks. `step` sets `traceStep`; `waitFor`, `waitIdle`, `sleep`, `check` and the
 * wrapped `page.waitForTimeout` append to `trace`; `printWaits` prints `== waits` and `writeTrace`
 * writes the TSV. Times are `performance.now()` milliseconds, rounded.
 */
const trace = {
  /** `waitFor` calls that ran to their cap: `{ step, capMs, spentMs, line }`. */
  expired: [],
  /** `waitIdle` calls that never saw Stop and so paid the 2 s floor: `{ step, paidMs, line }`. */
  floors: [],
  /** Every `sleep` call: `{ step, ms, line }`. */
  sleeps: [],
  /** Every `page.waitForTimeout` call: `{ step, ms, line }`. */
  pauses: [],
  /** Time between consecutive checks of a step: `{ step, gapMs, atMs, text }`. */
  gaps: [],
};
/** Id of the step running now; `-` outside the steps. */
let traceStep = '-';
/** `performance.now()` when the running step started. */
let traceStepStart = performance.now();
/** `performance.now()` of the step start or of its latest check: the origin of the next gap. */
let traceMark = performance.now();

/** Function names of the helpers of this file that `callerLine` skips to reach the real caller. */
const TRACE_HELPERS = new Set([
  'callerLine',
  'waitFor',
  'waitIdle',
  'sleep',
  'tracedWaitForTimeout',
]);

/**
 * `run.mjs:<line>` of the nearest caller that is not one of the tracing helpers, read from
 * `new Error().stack`, or `run.mjs:?` when no frame matches.
 *
 * Diagnostic only, never a check: it depends on the V8 stack format (`at name (file:///…/run.mjs:L:C)`
 * and `at async name (…)`), and an inner helper such as `setTheme` shows as itself, not as its own
 * caller. VERIFIED on the full run of 30/10/2026 (Windows 11): the TSV rows of `sleep` and `floor`
 * point at the `await sleep(…)` and `waitIdle(` call lines (for example "expired step 7 cap 4000 ms"
 * at a `waitFor(`), whereas the `page.waitForTimeout` rows all pointed at the wrapper itself, because
 * the frame is `at Page.tracedWaitForTimeout [as waitForTimeout]`; fixed after that run. VERIFIED on
 * the full run of 31/10/2026 that ended "all visual checks passed" (Windows 11): its trace has 7
 * `pause` rows, and none of them points at the wrapper, all point at call lines of the steps.
 */
function callerLine() {
  for (const frame of (new Error().stack ?? '').split('\n').slice(1)) {
    const found = /at (?:async )?(?:(\S+) \()?.*run\.mjs:(\d+):\d+/.exec(frame);
    // The wrapped method shows as `at Page.tracedWaitForTimeout [as waitForTimeout] (…)`, a shape
    // the regex cannot name, so it is skipped by its text.
    if (
      found === null ||
      TRACE_HELPERS.has(found[1] ?? '') ||
      frame.includes('tracedWaitForTimeout')
    )
      continue;
    return `run.mjs:${found[2]}`;
  }
  return 'run.mjs:?';
}

/** The sleep itself, without trace: the polling pause of `waitFor` must not count as a fixed wait. */
const rawSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fixed wait of `ms`; it adds the call to `trace.sleeps` (step, ms and line) before sleeping. */
const sleep = (ms) => {
  trace.sleeps.push({ step: traceStep, ms, line: callerLine() });
  return rawSleep(ms);
};

/** Pages whose `waitForTimeout` is already wrapped by {@link instrumentPage}. */
const tracedPages = new WeakSet();

/**
 * Makes `page.waitForTimeout` add its calls to `trace.pauses`, once per page object. Done by
 * wrapping the method on the instance (one place) instead of editing its nine call sites.
 */
function instrumentPage(target) {
  if (tracedPages.has(target)) return;
  tracedPages.add(target);
  const original = target.waitForTimeout.bind(target);
  target.waitForTimeout = function tracedWaitForTimeout(ms) {
    trace.pauses.push({ step: traceStep, ms, line: callerLine() });
    return original(ms);
  };
}

/** Thrown by `check` under `--bail` to end the step at its first FAIL; `step` stops the run. */
class BailStop extends Error {}
/** Whether a step body is running: only there may `check` throw `BailStop`. */
let inStep = false;

/**
 * Records an assertion; prints it; returns whether it held.
 *
 * Under `--bail`, a failed check inside a step also throws `BailStop`, so the rest of the step is
 * not run: on a broken state every later wait of the step would expire at its cap (step 16 took 81
 * s that way on 28/10/2026, against about 17 s when it passes). Outside a step (the final checks
 * after the steps) it never throws. A step body that wraps the check in its own `try/catch` may
 * swallow the throw; that step then runs to its end, and the run still stops after it.
 *
 * Inside a step it also records, in `trace.gaps`, the time since the previous check (or the step
 * start) with this check's text; the printed line is unchanged.
 */
function check(ok, message) {
  const now = performance.now();
  if (inStep) {
    trace.gaps.push({
      step: traceStep,
      gapMs: Math.round(now - traceMark),
      atMs: Math.round(now - traceStepStart),
      text: message,
    });
  }
  traceMark = now;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
  if (!ok && bail && inStep) throw new BailStop(message);
  return ok;
}

/** Records something that could not be judged (never a failure). */
function warn(message) {
  console.log(`  warn ${message}`);
  warnings.push(message);
}

/**
 * Polls `fn` until it returns a truthy value, or returns `undefined` after `ms`; an exception of
 * `fn` counts as "not yet". An expired wait is NOT an error: the caller's check then judges what
 * is on screen, so a timeout still ends as a FAIL line, never as a swallowed problem (#89 phase 3).
 *
 * The default interval is 150 ms (it was 500): the sleep between polls is the mechanism itself
 * (category H of the #89 plan), and 150 ms keeps the polling cost of `evaluate` calls small.
 * HYPOTHESIS: that 150 ms is better than 500 ms was not measured apart; the full run of phase 3
 * is what was timed.
 *
 * An expiry is no longer silent in the output: unless `traceExpiry` is false (the 2 s Stop wait of
 * `waitIdle`, whose expiry is its normal path), it adds `{ step, capMs, spentMs, line }` to
 * `trace.expired`, which `== waits` lists. It changes nothing the wait returns or the checks print.
 */
async function waitFor(fn, ms, intervalMs = 150, traceExpiry = true) {
  const line = callerLine();
  const startedAt = performance.now();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let value;
    try {
      value = await fn();
    } catch {
      value = undefined;
    }
    if (value) return value;
    await rawSleep(intervalMs);
  }
  if (traceExpiry) {
    trace.expired.push({
      step: traceStep,
      capMs: ms,
      spentMs: Math.round(performance.now() - startedAt),
      line,
    });
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------

for (const required of ['dist/extension.js', 'dist/webview/assets/index.js']) {
  if (!fs.existsSync(path.join(repoRoot, required))) {
    console.error(
      `${required} is missing: run through \`npm run test:visual\`, which builds first.`,
    );
    process.exit(2);
  }
}

// The CONTENTS are cleared, not the folder: a process that has `shots` as its working directory
// (an editor or terminal opened there) makes `rmSync` of the folder itself fail with EPERM on
// Windows (seen 27/10/2026), and that is not a reason to stop the run.
fs.mkdirSync(shotsDir, { recursive: true });
for (const entry of fs.readdirSync(shotsDir)) {
  fs.rmSync(path.join(shotsDir, entry), { recursive: true, force: true });
}
// Assigned inside the `try` at the bottom, so that a failure while creating them (the VS Code
// download, say) still reaches `cleanup`.
let workspace;
let vscode;
let browser;
let page;
let web;
/** `performance.now()` when `startVSCode` returned: the origin of the total in `== timings`. */
let vscodeStartedAt;

/**
 * Closes everything the run opened: the CDP connections, VS Code with its whole process tree and
 * the temporary workspace. Idempotent, and safe when the run stopped half way (each piece is
 * optional). Called from the `finally` at the bottom and from the SIGINT/SIGTERM handlers.
 *
 * Every caller gets the SAME promise, not just the first one: on Ctrl+C the handler starts the
 * cleanup, the main body then fails (its browser is gone), reaches the `finally` and must wait for
 * that same cleanup, or it falls through to `process.exit` while `vscode.stop()` is still running
 * and VS Code + `opencode serve` are left orphaned on POSIX (review of the visual round, #941).
 * HYPOTHESIS: reasoned from the control flow, not reproduced with a real Ctrl+C mid-run.
 */
let cleaning;
function cleanup() {
  cleaning ??= (async () => {
    web?.close();
    await browser?.close().catch(() => undefined);
    await vscode?.stop();
    if (workspace !== undefined) fs.rmSync(workspace, { recursive: true, force: true });
  })();
  return cleaning;
}

// Ctrl+C or a kill of this script must not leave VS Code and `opencode serve` running (on POSIX
// VS Code has its own process group, so the signal would not reach it).
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.error(`\n${signal}: closing VS Code`);
    void cleanup().finally(() => process.exit(130));
  });
}

/** Longest one `keyboard.press` may take before the run treats it as hung, in ms (see below). */
const PRESS_TIMEOUT_MS = 10_000;

/**
 * Makes every `keyboard.press` of `target` reject after `PRESS_TIMEOUT_MS` instead of waiting
 * forever, so a key that is never acknowledged becomes a FAIL of its step and the run goes on.
 *
 * Why: Playwright's keyboard and mouse calls take no timeout. A press that went to a webview
 * frame hidden under it never returned: step 5 waited 647 s on 27/10/2026, until VS Code was
 * closed, and the run had no line saying where it was stuck (#89, Engram #1333). Wrapping the
 * method once here covers the 79 call sites and the reconnection after Reload Window, which also
 * goes through `connectWorkbench`. The hung press is not cancelled (Playwright cannot), it is only
 * no longer awaited; the steps after it may then fail for the same broken frame, as they did then.
 * 10 s is our own figure, far above what was seen: the presses traced in step 5 on 28/10/2026
 * answered in 0.00-0.02 s; the other call sites were not timed.
 * HYPOTHESIS: the reject path has not been run; to check it, press a key while a modal native
 * dialog blocks the renderer and expect "keyboard.press(...) did not return" as a FAIL line.
 */
function boundKeyPresses(target) {
  const press = target.keyboard.press.bind(target.keyboard);
  target.keyboard.press = (key, options) => {
    let timer;
    const cap = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `keyboard.press('${key}') did not return within ${String(PRESS_TIMEOUT_MS)} ms (the key was never acknowledged)`,
          ),
        );
      }, PRESS_TIMEOUT_MS);
    });
    return Promise.race([press(key, options), cap]).finally(() => clearTimeout(timer));
  };
}

/**
 * Connects Playwright to the workbench of the VS Code listening on CDP `port`, waiting for the
 * debugging endpoint to come up; returns `{ browser, page }` with the key presses bounded, or throws
 * after `timeoutMs`. Shared by the main instance (`connectWorkbench`) and by the second one that
 * step 25 starts in Restricted Mode.
 */
async function connectPage(port, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try {
      const connected = await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`);
      const pages = connected.contexts().flatMap((context) => context.pages());
      const workbench = pages.find((candidate) => candidate.url().includes('workbench'));
      if (workbench) {
        boundKeyPresses(workbench);
        return { browser: connected, page: workbench };
      }
      await connected.close().catch(() => undefined);
    } catch (error) {
      lastError = error;
    }
    await sleep(500); // retry interval of the connection attempts, not a wait for a condition
  }
  throw new Error(`could not connect to VS Code over CDP: ${String(lastError)}`);
}

/** Connects Playwright to the workbench of the main instance, setting `browser` and `page`. */
async function connectWorkbench(timeoutMs = 90_000) {
  const connected = await connectPage(vscode.port, timeoutMs);
  browser = connected.browser;
  page = connected.page;
  instrumentPage(page);
}

/** Window size the whole run uses (HYPOTHESIS: VS Code's own default for a new window with a folder). */
const WINDOW_SIZE = { width: 1440, height: 900 };
/** Narrow window of the step 15 measurement: the width of a vertical monitor. */
const NARROW_SIZE = { width: 1080, height: 900 };
/**
 * Side bar width for the narrow measurement. 270 is HYPOTHESIS for what a window that OPENED 1080
 * px wide gets (a quarter of it): the failing runs of 25/10/2026 overflowed by 15 px, and 270
 * gave 14 px against the old CSS (a 250 px bar gave 34 px, 27/10/2026); the real proportion of
 * VS Code 1.143.1 was not read from its source. The width to go back to is measured, not assumed.
 */
const NARROW_BAR_WIDTH = 270;
/** CSS px by which the measured inner size may differ from the requested one (see below). */
const SIZE_TOLERANCE = 4;

/** Inner size of the workbench in CSS px, the device pixel ratio and the screen's work area. */
function windowSize() {
  return page.evaluate(() => ({
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
    dpr: globalThis.devicePixelRatio,
    screen: `${String(globalThis.screen.availWidth)}x${String(globalThis.screen.availHeight)}`,
  }));
}

/**
 * Resizes the VS Code window to `width` x `height` with `window.resizeTo` over CDP, waits for the
 * layout to settle and returns the measured size; throws when the window never gets there.
 *
 * Why: the run used to inherit the size of the monitor VS Code opened on, and with a narrow one
 * steps 9, 10, 11 and 15 failed for a reason that was the environment (27/10/2026).
 * HYPOTHESIS (read in `mainImpl.js` of VS Code 1.143.1, not executed): a new window with a folder
 * asks for 1440x900 and VS Code clips it to the work area; the side bar of such a window is
 * probably about 270 px, see `NARROW_BAR_WIDTH`. Throwing, instead of going on with an unknown
 * layout, is meant to make the run exit with 2 ("could not start") when this is called before the
 * first step: HYPOTHESIS read from the `started`/`startupError` flow at the bottom of this file,
 * the throwing path has not been executed. The inner size lands within 1-2 px of the request, not
 * on it, hence `SIZE_TOLERANCE`.
 * VERIFIED on Windows 11, VS Code 1.143.1, DPR 1.25 (27/10/2026): the run prints "window 1440x902
 * CSS px, DPR 1.25, screen work area 4096x1152" at start and, in step 15, "narrow window 1082x902,
 * side bar 270 px: header 169 px wide" (an earlier spike on the real workbench also went from
 * 1440x902 to 1082x902 with `resizeTo(1080, 900)`). NOT observed: macOS, Linux, a request larger
 * than the screen's work area (it would throw here).
 */
async function setWindowSize(width, height) {
  await page.evaluate(([w, h]) => globalThis.resizeTo(w, h), [width, height]);
  const reached = await waitFor(
    async () => {
      const size = await windowSize();
      const close =
        Math.abs(size.width - width) <= SIZE_TOLERANCE &&
        Math.abs(size.height - height) <= SIZE_TOLERANCE;
      return close ? size : undefined;
    },
    8_000,
    250,
  );
  if (reached === undefined) {
    const size = await windowSize();
    throw new Error(
      `the window is ${String(size.width)}x${String(size.height)} CSS px (screen work area ${size.screen}), not the ${String(width)}x${String(height)} that was requested`,
    );
  }
  await settleLayout(); // the layout of the side bar and the webview follows the window
  return windowSize();
}

/**
 * Waits until the boxes of the side bar and of the chat iframe are the same in two reads 100 ms
 * apart (cap 3 s, then goes on: the caller measures and judges). Replaces the 1 s sleeps after a
 * window resize and a sash drag (#89 phase 3). HYPOTHESIS: two equal reads mean the layout is
 * done; a layout that pauses for 100 ms and then moves again would pass too early, which the
 * measurements that follow would show as a different width.
 */
async function settleLayout() {
  let previous;
  await waitFor(
    async () => {
      const now = await page.evaluate(() => {
        const box = (selector) => {
          const rect = globalThis.document.querySelector(selector)?.getBoundingClientRect();
          return rect ? [rect.left, rect.top, rect.width, rect.height] : null;
        };
        return JSON.stringify([box('.part.sidebar'), box('iframe.webview.ready')]);
      });
      const same = now === previous;
      previous = now;
      return same;
    },
    3_000,
    100,
  );
}

/** Box of the primary side bar in page coordinates, or null when it is not in the page. */
function sideBarBox() {
  return page.evaluate(() => {
    const rect = globalThis.document.querySelector('.part.sidebar')?.getBoundingClientRect();
    return rect ? { left: rect.left, right: rect.right, top: rect.top, height: rect.height } : null;
  });
}

/** Width of the primary side bar in CSS px (0 when it is not in the page). */
async function sideBarPx() {
  const box = await sideBarBox();
  return box === null ? 0 : box.right - box.left;
}

/**
 * Drags the sash of the primary side bar with the real mouse until the bar is `width` CSS px
 * wide; returns the width measured afterwards, and throws when it is more than
 * `SIZE_TOLERANCE` off. It waits for the layout to settle (`settleLayout`, two equal reads of the
 * boxes, no fixed second) before measuring. The pointer is parked over the editor afterwards, so a screenshot taken
 * next does not show the sash's hover line (VERIFIED on Windows 11, 27/10/2026: the narrow
 * capture of the final run shows no hover line on the side bar's edge; before the pointer was
 * parked, an earlier capture did).
 *
 * Why: resizing the window does NOT change the side bar width (VERIFIED, below), so a narrow
 * side bar has to be set directly. HYPOTHESIS, not observed: VS Code fixes the width in px when
 * the window opens, as a proportion of the window then, and the 1080 px wide runs of 25/10/2026,
 * where the header of a failed tool card overflowed, had a bar of about 270 px for that reason.
 * VERIFIED on Windows 11, VS Code 1.143.1 (27/10/2026), spike on the real workbench: the side bar
 * stayed 300 px after `resizeTo(1080, 900)` and became 250 and then 200 px with this drag; the
 * run prints "narrow window 1082x902, side bar 270 px: header 169 px wide". NOT observed: macOS
 * and Linux, a side bar on the right (`workbench.sideBar.location`), a side bar hidden when
 * called.
 */
async function setSideBarWidth(width) {
  const before = await sideBarBox();
  if (before === null) throw new Error('the primary side bar is not in the page');
  const y = before.top + before.height / 2;
  await page.mouse.move(before.right, y);
  await page.mouse.down();
  await page.mouse.move(before.left + width, y, { steps: 10 });
  await page.mouse.up();
  await page.mouse.move(before.left + Math.max(width, before.right - before.left) + 200, y);
  await settleLayout();
  const measured = await sideBarPx();
  if (Math.abs(measured - width) > SIZE_TOLERANCE) {
    throw new Error(
      `the side bar is ${String(measured)} px wide after dragging it to ${String(width)}`,
    );
  }
  return measured;
}

/**
 * Saves a screenshot of the whole window and remembers its path.
 *
 * For the names in `README_CROPS` it also saves a webview-only crop (`cropWebview`).
 */
async function shot(name) {
  const file = path.join(shotsDir, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  if (README_CROPS.has(name)) await cropWebview(name);
  return file;
}

// --- README image crops (issue #42) -----------------------------------------------------------

/** Shots that also get a webview-only crop in `readmeDir`: candidates for `docs/images/`. */
const README_CROPS = new Set([
  '02b-markdown',
  '05b-card',
  '07a-question',
  '10a-sessions-dark',
  '11c-fork-dark',
  '12b-chip-panel-dark',
  '12f-reply-meta-dark',
  '15a-tool-cards-folded',
  '15b-tool-edit-open',
  '15c-diff-dark',
  '16a-mention-popup',
  '16e-mention-sent',
]);

const readmeDir = path.join(workDir, scratchOutput ? 'readme-partial' : 'readme');
// Cleared at start, like `shotsDir`: crops of an earlier run must not survive to be copied into
// docs/images/ as if they were new. Declared here, not next to `shotsDir`, because of the const.
fs.rmSync(readmeDir, { recursive: true, force: true });

/**
 * Saves a PNG of just the chat webview (the `iframe.webview.ready` box) to `readmeDir`.
 *
 * Why: the full-window shots carry the VS Code watermark logo, a toast, the Copilot panel and the
 * temporary workspace name, none of which may appear in a README (VS Code branding rules). The
 * clip is the iframe's bounding box in page coordinates, the same box `centreOf` adds to the
 * in-frame coordinates. It never fails the run: a missing frame is a warning. `boundingBox()`
 * waits for the element and THROWS a TimeoutError when there is no iframe at all (it returns null
 * only for an attached but invisible one), so the call carries a short timeout and a `.catch`
 * that turns both cases into the warning. The files are copied BY HAND to `docs/images/` after
 * looking at them, so a screenshot is only copied once someone has judged it.
 * HYPOTHESIS for the throwing case: read in playwright-core `lib/client/locator.js`
 * (`boundingBox` goes through `_withElement` with a timeout), not run without a frame; to check
 * it, call `cropWebview` while no chat view is open and expect the warning, not a failed step.
 * VERIFIED on Windows 11 with VS Code stable (2026-10-22): after a full run that ended with
 * "all visual checks passed", the 12 crops were opened one by one and show the chat content
 * (Markdown, cards, model list), not an empty frame, so the clip does include the out-of-process
 * iframe. Not observed: other operating systems, or a frame that is partly off-screen.
 */
async function cropWebview(name) {
  const frame = await chatFrameBox({ timeout: 5_000 }).catch(() => null);
  if (!frame) {
    warn(`no webview frame to crop for ${name}`);
    return;
  }
  fs.mkdirSync(readmeDir, { recursive: true });
  await page.screenshot({
    path: path.join(readmeDir, `${name}.png`),
    clip: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
  });
}

/**
 * The iframes of THIS extension's webviews (the chat view and the chat tabs). A foreign webview (the
 * extension details page, a Markdown preview) is also an `iframe.webview.ready`, so every chat
 * selector filters by the `extensionId` its `src` carries, as `webviewTarget` does for the CDP url.
 */
const CHAT_FRAME = 'iframe.webview.ready[src*="extensionId=sergwei.open-vs-code"]';

/**
 * Box of the chat webview iframe in page coordinates (what `boundingBox` returns).
 *
 * Order of preference: the iframe of the chat `web` is driving (`drivenChatId`), then a visible
 * chat iframe, then the first one. With a single chat (every step but 27) all three are the same
 * iframe; with several (chat tabs of `openVsCode.chatLocation: editor`, which keep their iframe when
 * hidden) the first one can be a hidden tab. Only iframes of this extension count ({@link CHAT_FRAME}).
 * `options` is passed to `boundingBox` (a `timeout`). Throws like `boundingBox` when there is no
 * iframe at all.
 * VERIFIED on Windows 11, VS Code 1.144.0 (29/10/2026) by the spike with two tabs: the hidden
 * tab's iframe reported `checkVisibility()` false and the active one true; and by step 27 with up to
 * four tabs and the side bar chat at once, where every click through it landed on the chat being
 * driven ("ok C4 coming back to A shows the whole reply once: 400 numbers, from 1 to 400, in
 * order, no repeats" and "ok C10 and a tab left open still works after the switch"). NOT
 * observed: a hidden `drivenChatId` iframe with a visible other one (the fallback is not exercised
 * with two chats).
 */
async function chatFrameBox(options) {
  const driven =
    drivenChatId === undefined ? null : page.locator(`${CHAT_FRAME}[name="${drivenChatId}"]`);
  if (driven !== null && (await driven.count()) > 0) return driven.first().boundingBox(options);
  const visible = page.locator(`${CHAT_FRAME}:visible`);
  const locator = (await visible.count()) > 0 ? visible.first() : page.locator(CHAT_FRAME).first();
  return locator.boundingBox(options);
}

/**
 * The id of the chat webview `web` is connected to (the `name` of its iframe), or `undefined` when
 * `openChat` found none visible and took the first target. `chatFrameBox` looks for that iframe
 * first, so a click lands on the chat that is being driven even when two are visible (a chat tab and
 * the side bar view, the end of step 27).
 */
let drivenChatId;

/**
 * The id of the chat webview that is on screen (the `name` of its {@link CHAT_FRAME}, which is the
 * `id=` of its CDP target), or `undefined` when none is visible. Iframes of other extensions are not
 * looked at. See `webviewTarget`.
 */
function visibleChatId() {
  return page.evaluate(
    (selector) =>
      [...globalThis.document.querySelectorAll(selector)].find(
        (frame) =>
          frame.checkVisibility({ checkVisibilityCSS: true }) &&
          frame.getBoundingClientRect().width > 0,
      )?.name,
    CHAT_FRAME,
  );
}

/**
 * (Re)opens the CDP connection to the chat webview that is on screen, replacing the previous one.
 *
 * The target is chosen by the id of the visible chat iframe (`visibleChatId`), not by the order of
 * `/json`; a given `wantedId` wins. With no chat visible, the first target is taken (the one-chat
 * case of every step but 27, and the start-up before the view shows). The id is read once: a tab
 * that becomes visible after the read is not followed.
 */
async function openChat(timeoutMs = 30_000, wantedId = undefined) {
  web?.close();
  const id = wantedId ?? (await visibleChatId().catch(() => undefined)) ?? undefined;
  drivenChatId = id || undefined;
  web = await openWebview(vscode.port, webviewLogs, timeoutMs, drivenChatId);
}

/**
 * What each theme of the run looks like once applied: the class `.monaco-workbench` carries and the
 * `data-vscode-theme-kind` the webview's `<body>` gets.
 * VERIFIED by reading VS Code 1.143.1 (local install, 27/10/2026): the theme service removes
 * "vs", "vs-dark", "hc-black", "hc-light" and adds the new one on the workbench container, and the
 * webview's `applyStyles` sets the kind and the `--vscode-*` variables in one synchronous call.
 */
const THEME_KINDS = {
  'Default Light Modern': { workbench: 'vs', webview: 'vscode-light' },
  'Default Dark Modern': { workbench: 'vs-dark', webview: 'vscode-dark' },
  'Default High Contrast': { workbench: 'hc-black', webview: 'vscode-high-contrast' },
  'Default High Contrast Light': {
    workbench: 'hc-light',
    webview: 'vscode-high-contrast-light',
  },
};

/** Longest `setTheme` waits for a theme to show up in the workbench and in the webview. */
const THEME_TIMEOUT_MS = 10_000;

/** Whether a chat webview iframe is on screen (a hidden view does not repaint nor run frames). */
function webviewVisible() {
  return page.evaluate(() =>
    [...globalThis.document.querySelectorAll('iframe.webview.ready')].some(
      (frame) =>
        frame.checkVisibility({ checkVisibilityCSS: true }) &&
        frame.getBoundingClientRect().width > 0,
    ),
  );
}

/**
 * Switches the colour theme and returns once it is really applied; throws after `THEME_TIMEOUT_MS`.
 *
 * Replaces the fixed 1.5-3 s sleeps that used to follow every `workbench.colorTheme` write (issue
 * #89): it writes the setting, then waits for (a) the class of the theme on `.monaco-workbench`,
 * (b) only if a chat webview is visible, its `<body>` `data-vscode-theme-kind`, and (c) two
 * animation frames, in the webview if it is visible, else in the workbench. With the view hidden
 * (b) is skipped on purpose: a hidden webview never updates its kind nor runs frames, and waiting
 * for it would be a false timeout. The frames are raced against 1 s so a page that does not
 * run them cannot hang the step. Throws for a theme name it does not know.
 * VERIFIED on Windows 11, VS Code 1.143.1 (27/10/2026): `--steps 2,4` printed lines such as "ok
 * light: code text contrast 10.55 >= 4.5 (code background rgba(0, 0, 0, 0))" and "ok dark: code
 * text contrast 8.82 >= 4.5 (code background rgba(0, 0, 0, 0))" with the same four figures as the
 * full baseline, and with this wait cut out (mutation test) they changed. HYPOTHESIS: that a screenshot never lags one frame behind the wait; only the
 * figures prove that, the captures were read by eye. NOT observed: macOS, Linux.
 */
async function setTheme(theme) {
  const kind = THEME_KINDS[theme];
  if (kind === undefined) throw new Error(`unknown theme: ${theme}`);
  writeSettings(vscode.userDataDir, { 'workbench.colorTheme': theme });
  const end = Date.now() + THEME_TIMEOUT_MS;
  const left = () => Math.max(end - Date.now(), 0);
  const inWorkbench = await waitFor(
    () =>
      page.evaluate(
        (cls) =>
          globalThis.document.querySelector('.monaco-workbench')?.classList.contains(cls) ?? false,
        kind.workbench,
      ),
    left(),
    50,
  );
  if (inWorkbench === undefined) {
    throw new Error(
      `the workbench did not take the theme ${theme} in ${String(THEME_TIMEOUT_MS)} ms`,
    );
  }
  if (web !== undefined && (await webviewVisible())) {
    const inWebview = await waitFor(
      () =>
        web.inDoc((doc, expected) => doc.body?.dataset.vscodeThemeKind === expected, kind.webview),
      left(),
      50,
    );
    if (inWebview === undefined) {
      throw new Error(
        `the chat webview did not take the theme ${theme} (${kind.webview}) in ${String(THEME_TIMEOUT_MS)} ms`,
      );
    }
    await web.inDoc(twoFrames);
  } else {
    await page.evaluate(`(${twoFrames.toString()})(document)`);
  }
}

/**
 * Resolves after two animation frames of `doc`'s window (`true`), or after 1 s if they never run
 * (`false`: a page that is not painting must not hang the step). Self-contained: it is serialized
 * into the workbench page and into the webview.
 */
function twoFrames(doc) {
  return new Promise((resolve) => {
    const win = doc.defaultView;
    const giveUp = win.setTimeout(() => resolve(false), 1_000);
    win.requestAnimationFrame(() => {
      win.requestAnimationFrame(() => {
        win.clearTimeout(giveUp);
        resolve(true);
      });
    });
  });
}

/** The dark theme, the one the screenshot-only loops capture without `--all-themes`. */
const DARK_THEME = ['dark', 'Default Dark Modern'];

/**
 * The themes a screenshot-only loop captures: `themes` with `--all-themes`, else just dark (the
 * theme the run is in when such a loop starts, and the one `README_CROPS` names). Never used by a
 * loop that measures something: those must stay in every theme.
 */
function captureThemes(themes) {
  return allThemes ? themes : [DARK_THEME];
}

/** True when the quick input (the command palette) is not on screen. */
const quickInputHidden = () =>
  page.evaluate(() => {
    const widget = globalThis.document.querySelector('.quick-input-widget');
    return widget === null || globalThis.getComputedStyle(widget).display === 'none';
  });

/**
 * Opens the quick input with a real mouse click on the title bar's command center; false when no
 * visible one is found (the caller then falls back to F1).
 *
 * The point comes from `getBoundingClientRect` of the first `.command-center-center` with a width,
 * and `page.mouse` clicks it, as `clickIn` does for the webview. Not `locator.click()`: on
 * 28/10/2026 (Windows 11, VS Code 1.143.1) it timed out after 5 s in 6 runs of 6 of
 * `--steps 16,17 --bail` although the box was on screen. HYPOTHESIS for why: a hidden match first,
 * or the draggable title bar failing Playwright's "receives events" check; not looked into.
 */
async function clickCommandCenter() {
  const point = await page.evaluate(() => {
    for (const element of globalThis.document.querySelectorAll('.command-center-center')) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  });
  if (point === null) return false;
  await page.mouse.click(point.x, point.y);
  return true;
}

/**
 * Runs a command from the palette.
 *
 * Waits for conditions instead of 400/600/800 ms: the quick input is visible, its focused row
 * names the typed command, Enter, then the quick input is hidden. The 150 ms at the end is a fixed
 * settle: the command runs after the palette closes and there is no signal common to all the
 * commands this suite runs (close editors, restart, reload, stop). #89 phase 3.
 *
 * The palette is opened with the MOUSE (the command center of the title bar) and F1 is only the
 * fallback, up to 3 attempts. Nothing is typed unless the quick input is open AND holds the focus
 * (`typeInQuickInput` reports it): if it never opens, or opens without the focus, the call throws
 * with the command's name and the number of presses, so the step FAILs at once. Why: F1 is lost now
 * and then. It used to be pressed once and the title typed anyway after a 2 s cap, and on
 * 28/10/2026 (Windows 11, VS Code 1.143.1) "View: Revert and Close Editor" landed as text in the
 * Untitled editor of step 2 (screenshot 16d of `--steps 16,17`): a dirty editor, a save dialog
 * nobody answered and every later wait of the run expiring at its cap (step 16 from about 17 s to
 * 81 s). With F1 retried 3 times, `--steps 16,17` still ended once in 4 with "the command palette
 * did not open for "View: Close All Editors" (F1 pressed 3 times)". The same lost F1 is the likely
 * reason the palette "did not hide the side bar" in step 5 (8 runs of 8, Engram #1335):
 * HYPOTHESIS. Why F1 is lost is not known. The click opens the quick input in file mode, so the
 * text starts with `>` and replaces whatever the input held.
 *
 * A palette that opened but did not get the focus is closed and opened again, up to 3 times,
 * before the call throws. It is closed with Escape only once a click has put the focus in its own
 * input: an Escape sent while the focus is elsewhere could reach the chat and stop a running turn.
 * Why the retry: on 28/10/2026 (Windows 11, VS Code 1.143.1), in one full run of two, step 2
 * failed with "the command palette opened but did not take the focus for "View: Revert and Close
 * Editor"", right after "Open code in a new file" had opened an Untitled editor. HYPOTHESIS: that
 * editor took the focus back a moment later; the output shows only the FAIL line.
 * VERIFIED on Windows 11, VS Code 1.143.1 (28/10/2026) by mutation, a click on the editor right
 * after the first opening of each call, `--steps 2 --bail`: for "View: Revert and Close Editor" the
 * first try typed nothing, the second did, and the run ended "all visual checks passed". NOT
 * observed: the close of a palette still shown (the click on the editor had probably closed it
 * already), the throw after 3 openings, and the real late focus move being beaten by the retry.
 */
async function command(title) {
  let clicks = 0;
  let f1Presses = 0;
  let unfocused = 0;
  let typed = false;
  for (let tries = 0; tries < 3 && !typed; tries += 1) {
    let open = false;
    for (let attempt = 0; attempt < 3 && !open; attempt += 1) {
      const clicked = attempt === 0 && (await clickCommandCenter()); // the mouse first, then F1
      if (clicked) clicks += 1;
      else {
        f1Presses += 1;
        await page.keyboard.press('F1');
      }
      open = (await waitFor(async () => !(await quickInputHidden()), 1_000, 50)) === true;
    }
    if (!open) {
      throw new Error(
        `the command palette did not open for "${title}" (${String(clicks)} clicks on the command center, F1 pressed ${String(f1Presses)} times)`,
      );
    }
    typed = await typeInQuickInput(page.locator('.quick-input-widget input').first(), `>${title}`);
    if (!typed) {
      unfocused += 1;
      if (!(await quickInputHidden())) {
        // The focus goes into the palette's input first, so the Escape cannot reach the chat.
        await page
          .locator('.quick-input-widget input')
          .first()
          .click({ timeout: 2_000 })
          .catch(() => undefined);
        const inPalette = await page.evaluate(() =>
          globalThis.document.activeElement?.closest('.quick-input-widget') ? true : false,
        );
        if (inPalette) await page.keyboard.press('Escape');
      }
      await waitFor(quickInputHidden, 1_000, 50);
    }
  }
  if (!typed) {
    throw new Error(
      `the command palette opened but did not take the focus for "${title}" (${String(unfocused)} openings)`,
    );
  }
  await waitFor(
    () =>
      page.evaluate((wanted) => {
        const row = globalThis.document.querySelector('.quick-input-list .monaco-list-row.focused');
        return (row?.textContent ?? '').toLowerCase().includes(wanted);
      }, title.toLowerCase()),
    2_000,
    50,
  );
  await page.keyboard.press('Enter');
  await waitFor(quickInputHidden, 1_500, 50);
  await sleep(150); // the command runs after the palette closes; no common signal for all commands
}

/**
 * Waits until the chat shows the empty view that New session leaves: at least 3 suggestions, no
 * block in the log and the title "Untitled session". Gives up after `ms` (the caller's check then
 * reports what it sees), so a New session that does nothing still FAILs there.
 */
async function waitEmptyView(ms = 5_000) {
  await waitFor(
    () =>
      web.inDoc(
        (doc) =>
          doc.querySelectorAll('.suggestion').length >= 3 &&
          doc.querySelectorAll('[role="log"] > *').length === 0 &&
          (doc.querySelector('.chat-title')?.textContent ?? '') === 'Untitled session',
      ),
    ms,
    100,
  );
}

/**
 * Clicks the prompt box until the focus has stayed in it for 3 consecutive reads 300 ms apart
 * (cap 8 s, then goes on: the caller checks the focus and fails there).
 *
 * Why not one focused read: after a step that ends with the quick input or a restart, VS Code
 * gives the focus back to the editor a moment after the first click, and the text typed next lands
 * in an untitled editor. Seen twice: step 7b (the first run of the step) and, on 28/10/2026 in
 * #89 phase 3, steps 7b and 13 when a single focused read replaced the old 1.5-2 s sleeps. Each
 * round clicks again, so the wait ends only on a focus that stayed. HYPOTHESIS: three reads
 * (about 0.6-0.9 s) are enough for the late focus move; not measured beyond the runs of phase 3.
 *
 * It is the rule for every place that clicks the prompt box and then types or moves with the
 * keyboard (decision of Sergio, 28/10/2026, Engram `tooling/visual-speed/decisions/focus-everywhere`):
 * the same late move then showed up in steps 16 and 17 ("@sample" typed into an editor, a prompt
 * typed into `src/sample.ts`), whenever an editor was the active part. A bare `clickIn('textarea')`
 * stays only where the click itself is what a check judges, or where no key follows it.
 *
 * Returns whether the focus stayed (false after the 8 s cap). {@link send} and
 * {@link clearPromptBox} throw on false: they press Ctrl+A and Backspace, which on an editor that
 * has the focus empty it and leave it dirty
 * (the "src/sample.ts EMPTY and dirty" of 30/10/2026, then a save dialog and a cascade of FAIL).
 */
async function focusPromptBox() {
  let steadyReads = 0;
  await waitFor(
    async () => {
      await clickIn('textarea');
      const has = await web.inDoc(
        (doc) => doc.activeElement?.tagName === 'TEXTAREA' && doc.hasFocus(),
      );
      steadyReads = has ? steadyReads + 1 : 0;
      return steadyReads >= 3;
    },
    8_000,
    300,
  );
  return steadyReads >= 3;
}

/**
 * Empties the prompt box with the keyboard, for the `clearBox` helpers of steps 16, 24, 26 and 27,
 * then pauses `pauseMs` (the first typed character is lost without it, see {@link send}).
 *
 * Throws, sending no key, when {@link focusPromptBox} says the focus did not stay: Ctrl+A and
 * Backspace on an editor empty it and leave it dirty (review 2, C1 of the tests half; the same
 * guard as {@link send}). The Ctrl+A of the suite that only SELECTS (quick inputs, the settings
 * search box, the editor of step 26) deletes nothing and is not covered. NOT observed: the throw.
 */
async function clearPromptBox(pauseMs) {
  if (!(await focusPromptBox())) {
    throw new Error('the prompt box did not keep the focus: it was not cleared');
  }
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await sleep(pauseMs);
}

/** Waits until the workbench has no editor tab open (after "View: Close All Editors"), up to 3 s. */
function waitForNoTabs() {
  return waitFor(async () => (await page.locator('.tab').count()) === 0, 3_000, 100);
}

/**
 * Runs "View: Close All Editors" and waits until no tab is left; if VS Code asks whether to save a
 * changed editor, presses "Don't Save" and warns, so the run never writes to the workspace nor
 * leaves a modal dialog taking the keys of the next steps. If tabs are still open afterwards
 * (and no dialog explains it) it warns instead of returning silently.
 *
 * Why: the Untitled file of step 2 made every Close All Editors raise "Do you want to save the
 * changes you made to …?" and no code answered it (screenshot of Sergio, 28/10/2026); a prompt
 * typed into `src/sample.ts` by a lost focus (step 17, Engram #1337) would have done the same, and
 * "Save" would have kept it on disk. The warning names the editor, because a dialog here means some
 * earlier key went to an editor. The button is found by text: VS Code 1.143.1 keeps it as
 * "Do&&n't Save" in `nls.messages.json`, the mnemonic is not drawn. The dialog is the in-DOM
 * `.monaco-dialog-box` (custom dialog style, `vscodeProcess.mjs`), as Sergio's screenshot shows.
 *
 * The button is looked up as `.monaco-button`, not as a `<button>`: VS Code draws it as
 * `<a class="monaco-button" role="button">` (HYPOTHESIS, read in `workbench.desktop.main.js` of
 * VS Code 1.144.0, Windows 11, 30/10/2026: the Button class creates an `a` element; reading is not
 * running, and no run has shown the dialog). The first
 * version looked for `.monaco-dialog-box button`, which matches nothing, so the path never pressed
 * "Don't Save": a stray dirty editor left the dialog open and every later step failed in cascade
 * (57 FAIL on 30/10/2026, Engram #1510 holds the debug round of that cascade). UNVERIFIED:
 * the press itself was not run against a real dialog; check that a run that leaves a dirty editor
 * prints "Close All Editors asked to save a changed editor" and goes on.
 */
async function closeAllEditors() {
  await command('View: Close All Editors');
  const dontSave = page.locator('.monaco-dialog-box .monaco-button', { hasText: /Don.t Save/ });
  const asked = await waitFor(
    async () => (await dontSave.count()) > 0 || (await page.locator('.tab').count()) === 0,
    3_000,
    100,
  );
  if (asked && (await dontSave.count()) > 0) {
    const text = await page
      .locator('.monaco-dialog-box')
      .first()
      .innerText()
      .catch(() => '');
    warn(
      `Close All Editors asked to save a changed editor: ${text.replace(/\s+/g, ' ').slice(0, 120)}`,
    );
    await dontSave.first().click({ timeout: 5_000 });
    await waitForNoTabs();
  }
  const left = await page.locator('.tab').count();
  if (left > 0) {
    warn(`Close All Editors left ${String(left)} tab(s) open; a later tab count may include them`);
  }
}

/**
 * Waits until an element matching `selector` is in the webview (`present`) or no longer is
 * (`!present`), up to `ms`; an expired wait just returns, so the check that follows judges it.
 */
function waitPresent(selector, present = true, ms = 3_000) {
  return waitFor(
    () =>
      web.inDoc((doc, arg) => (doc.querySelector(arg.selector) !== null) === arg.present, {
        selector,
        present,
      }),
    ms,
    100,
  );
}

/**
 * Types `text` in the quick input that is open (`dialog` is its input) once it has the focus, then
 * waits up to 2 s for the input to hold `text` and goes on (the return only reports the focus),
 * instead of the 400 and 600 ms sleeps the dialogs used.
 *
 * Returns whether the focus reached the quick input within 2 s, and types NOTHING when it did not:
 * a Ctrl+A and a text sent to whatever else holds the focus (an editor) write into the workspace.
 * No caller presses Enter after a `false`, since an Enter without the focus goes to whatever holds
 * it (#94): `command()` closes the palette and opens it again, up to 3 times, then throws; step 0
 * throws inside its `try` and takes its fallback (write the setting, warn); step 13 fails with the
 * dialog named. VERIFIED for `command()` on Windows 11, VS Code 1.143.1 (28/10/2026) by mutation:
 * the first try returned false ("try 0 typed=false") and the second typed. NOT observed: the
 * `false` path in steps 0 and 13.
 */
async function typeInQuickInput(dialog, text) {
  const focused =
    (await waitFor(
      () =>
        page.evaluate(() =>
          globalThis.document.activeElement?.closest('.quick-input-widget') ? true : false,
        ),
      2_000,
      50,
    )) === true;
  if (!focused) return false;
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await waitFor(async () => (await dialog.inputValue()) === text, 2_000, 50);
  return true;
}

/** On-screen centre of the first element matching `selector` in the webview, or null. */
async function centreOf(selector) {
  const box = await web.inDoc((doc, sel) => {
    const element = doc.querySelector(sel);
    if (!element) return null;
    // 'nearest': an element already in view does not move (centring one in the fixed bottom
    // dock shifted the layout and the click missed the button).
    element.scrollIntoView({ block: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  if (!box) return null;
  const frame = await chatFrameBox();
  if (!frame) return null;
  return { x: frame.x + box.x, y: frame.y + box.y };
}

/** A real mouse click on the first element matching `selector`; false when there is none. */
async function clickIn(selector) {
  const point = await centreOf(selector);
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  return true;
}

/**
 * A real click on the main button of a session row (`.session-main`), at a point that is safe from
 * the row actions, or a throw when the pointer would land elsewhere.
 *
 * Why not `clickIn`: that clicks the CENTRE, and `.session-row-actions` (Rename, Delete) is laid
 * over the right end of the row with `opacity: 0`, which still takes the click. In a narrow side
 * bar the centre falls on that overlay, so "the other session is clicked" pressed Rename blind, the
 * row went into edit mode and the next steps failed one after another (found on 27/10/2026 in a
 * 1080 px wide window; the screenshots showed the rename input on the wrong row). Here the point
 * is the middle of the part of the row to the LEFT of the actions, and the page is asked with
 * `elementFromPoint` whether that point is inside the row button before the mouse is used; if not
 * the call throws with what is there instead, so the failure is readable on its own line.
 * Returns false when nothing matches `selector`. What this does NOT cover: a layout shift between
 * the check and the click, as in `clickButton`.
 * VERIFIED on Windows 11, VS Code 1.143.1 (27/10/2026) by mutation, with the side bar dragged to
 * 270 px before step 9 and the `right` bound of the point changed to the row's own right edge
 * (so the point was the CENTRE of the row, where the hidden actions are): the run failed with
 * "the pointer for the session row "[data-visual-pick="true"]" would land on button.secondary
 * session-action, not on the row button (227 px of row left of its actions)" (there "227 px" is
 * the whole row, since the actions bound was removed), in steps 9, 11 and 14.
 * Unmutated, with the side bar at 270 px before step 9, steps 9, 10 and 11 ended without a FAIL
 * line. NOT observed: other widths, themes with a scrollbar in the list.
 */
async function clickRowMain(selector) {
  const target = await web.inDoc((doc, sel) => {
    const main = doc.querySelector(sel);
    if (!main) return null;
    // 'nearest': see `centreOf`.
    main.scrollIntoView({ block: 'nearest' });
    const rect = main.getBoundingClientRect();
    const actions = main.closest('.session-row')?.querySelector('.session-row-actions');
    const right = actions ? Math.min(rect.right, actions.getBoundingClientRect().left) : rect.right;
    const x = rect.left + (right - rect.left) / 2;
    const y = rect.top + rect.height / 2;
    const hit = doc.elementFromPoint(x, y);
    return {
      x,
      y,
      landed: hit !== null && main.contains(hit),
      hit: hit ? `${hit.tagName.toLowerCase()}.${hit.getAttribute('class') ?? ''}` : 'nothing',
      room: Math.round(right - rect.left),
    };
  }, selector);
  if (!target) return false;
  if (!target.landed) {
    throw new Error(
      `the pointer for the session row "${selector}" would land on ${target.hit}, not on the row button (${String(target.room)} px of row left of its actions)`,
    );
  }
  const frame = await chatFrameBox();
  if (!frame) return false;
  await page.mouse.click(frame.x + target.x, frame.y + target.y);
  return true;
}

/**
 * A real click on the button of the webview whose text is exactly `text`, with a guard against
 * pressing "Always allow" by accident.
 *
 * The click is a mouse click at the button's measured centre, so the layout could move between
 * measuring and clicking and the pointer land on a neighbour ("Back" sits in the same row as
 * "Yes, always allow"). Right before clicking, the page is asked what is under that point
 * (`elementFromPoint`): it must be the intended button, and its text must not match /always/
 * unless it is the "Always allow…" toggle (recognised by `aria-expanded`), which only opens the
 * confirmation panel. Otherwise nothing is clicked and the call throws. Returns false when no
 * button has that text. What this does NOT cover: a layout shift in the few milliseconds between
 * that check and the click.
 */
async function clickButton(text) {
  if (/yes,?\s*always/i.test(text)) throw new Error(`refusing to press "${text}"`);
  const target = await web.inDoc((doc, label) => {
    const button = [...doc.querySelectorAll('button')].find(
      // Send and Stop are round icon buttons (E2 P9=1+b): no text, only an `aria-label`.
      (candidate) =>
        candidate.textContent.trim() === label || candidate.getAttribute('aria-label') === label,
    );
    if (!button) return null;
    button.setAttribute('data-visual-click', 'true');
    // 'nearest': an element already in view does not move (centring one in the fixed bottom
    // dock shifted the layout and the click missed the button).
    button.scrollIntoView({ block: 'nearest' });
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, text);
  if (!target) return false;
  try {
    const verdict = await web.inDoc((doc, point) => {
      const hit = doc.elementFromPoint(point.x, point.y)?.closest('button') ?? null;
      return {
        intended: hit !== null && hit === doc.querySelector('[data-visual-click="true"]'),
        text: hit?.textContent.trim() ?? '',
        toggle: hit?.hasAttribute('aria-expanded') ?? false,
      };
    }, target);
    if (!verdict.intended) {
      throw new Error(
        `the pointer for "${text}" would land on "${verdict.text || 'something else'}"`,
      );
    }
    if (/always/i.test(verdict.text) && !verdict.toggle) {
      throw new Error(`refusing to press "${verdict.text}"`);
    }
    const frame = await chatFrameBox();
    if (!frame) return false;
    await page.mouse.click(frame.x + target.x, frame.y + target.y);
    return true;
  } finally {
    await web
      .inDoc((doc) => {
        for (const element of doc.querySelectorAll('[data-visual-click]')) {
          element.removeAttribute('data-visual-click');
        }
      })
      .catch(() => undefined);
  }
}

/**
 * Puts a focus that stays in the textarea (so keyboard focus enters the iframe), empties it, then
 * types and sends. Emptying first matters: a fork refills the draft with the forked prompt and the
 * draft survives New session, so typing straight away concatenated both prompts (seen in screenshot
 * 11h of step 10, review of #21). On an empty textarea select-all + Backspace does nothing.
 *
 * Why `focusPromptBox` and not one click: when the step before left an editor focused, VS Code
 * gave the focus back to it after the click and the prompt was typed into `src/sample.ts`. Seen
 * in step 17 once #89 phase 3 replaced the 1.5 s sleep after New session: on 28/10/2026 (Windows
 * 11, VS Code 1.143.1) `--steps 16,17` traced the focus in the editor (`DIV.native-edit-context`),
 * an empty box and no turn after `send` in 4 runs of 6. The steady focus costs about 0.6-0.9 s
 * per call. HYPOTHESIS: the steady focus is enough; to check, run `--steps 16,17` repeatedly and
 * expect "the context line appears once a step has reported its tokens" every time.
 *
 * Throws, sending no key, when the prompt box did not keep the focus: Ctrl+A and Backspace are
 * destructive on an editor, and the old code pressed them anyway after the 8 s cap of
 * `focusPromptBox`. Root cause of the dirty editors of 30/10/2026 (an emptied `src/sample.ts`, an
 * empty Untitled editor and "@sample" typed into a diff editor in a run of the #92 branch, before the
 * sessions tree existed; Engram #1510): the effect, VERIFIED by those screenshots; that
 * `send` was the one that pressed the keys, HYPOTHESIS (the runs did not trace the focus; the
 * `clearBox` helpers of steps 16, 24, 26 and 27 pressed the same keys after the same unchecked
 * focus until round 2 of the review made them share {@link clearPromptBox}, which throws the same
 * way). Why the focus is lost is still not known. NOT observed: the throw.
 */
async function send(text) {
  if (!(await focusPromptBox())) {
    throw new Error(`the prompt box did not keep the focus: "${text.slice(0, 40)}" was not sent`);
  }
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  // Without this pause the first typed character was lost (screenshot 11h showed "all the
  // subagent tool…" for "Call the…"). Cause: HYPOTHESIS, the webview re-renders the emptied
  // textarea. The 150 ms pause: VERIFIED by the test:visual run of 21/10/2026 (153 ok, 11h clean).
  await sleep(150); // first typed character lost without it (see above): kept, not converted
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/** True while the webview shows a Stop button (a turn is running); an icon button named by aria-label. */
const isBusy = () =>
  web.inDoc((doc) =>
    [...doc.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Stop'),
  );

/**
 * Waits until no turn is running; returns whether it got there in time.
 *
 * It first waits up to 2 s (polling every 100 ms) for the Stop button to appear, so that a turn
 * that has not started yet is not mistaken for an idle chat; if it never shows, the wait ends
 * after those 2 s, exactly as the fixed sleep did, so it is never slower than before. A turn that
 * both starts and ends between two polls costs the full 2 s. #89 phase 3.
 *
 * The 2 s floor is also what lets the focus and the interface settle at the start of a step; two
 * attempts to drop it (a `{ expectTurn: false }` option, and an early exit on the log size) were
 * tried in tooling/test-speed phase 1 and removed, because the runs that had them failed in
 * focus and turn-start checks (steps 22, 24, 28, 29).
 *
 * Every call that paid the whole 2 s floor adds `{ step, paidMs, line }` to `trace.floors`, and
 * `== waits` totals them; that is measurement only, the wait is unchanged.
 */
async function waitIdle(ms = 150_000) {
  const line = callerLine();
  const floorStartedAt = performance.now();
  const started = await waitFor(isBusy, 2_000, 100, false);
  if (!started) {
    trace.floors.push({
      step: traceStep,
      paidMs: Math.round(performance.now() - floorStartedAt),
      line,
    });
  }
  const idle = await waitFor(async () => !(await isBusy()), ms);
  return idle === true;
}

/** Number of message blocks in the conversation log and the title shown in the header. */
const snapshotOfChat = () =>
  web.inDoc((doc) => ({
    messages: doc.querySelectorAll('[role="log"] > *').length,
    title: doc.querySelector('.chat-title')?.textContent ?? '',
  }));

/**
 * The lines of answered requests: those in the conversation (`log`, with their hidden prefix, e.g.
 * "Permission: Allowed once · Read .env"), those in the dock (`dock`) and the number of
 * `role="alert"` elements. E3-resolved-history (issues #56/#18).
 */
const outcomeLines = () =>
  web.inDoc((doc) => ({
    log: [...doc.querySelectorAll('[role="log"] .request-outcome')].map((p) =>
      (p.textContent ?? '').trim(),
    ),
    dock: [...doc.querySelectorAll('.request-results li')].map((li) =>
      (li.textContent ?? '').trim(),
    ),
    alerts: doc.querySelectorAll('[role="alert"]').length,
  }));

/**
 * Whether a logged exception is VS Code's own race while mounting the webview, not our code.
 * VERIFIED by reading VS Code 1.143.1 (28/10/2026): `set contentOptions` and `setHtml` each call
 * `doUpdateContent`, which sends "content", and the webview host page builds an inner frame per
 * content update; `webview.options` then `webview.html` (chatViewProvider) are two updates. The
 * stack seen twice that day was `assertIsDefined` <- `hookupOnLoadHandlers` <- the `setTimeout` of
 * `onFrameLoaded`, in the webview host `index.html`. HYPOTHESIS (deduced from that reading and the
 * stack, not forced): the first frame's pending `hookupOnLoadHandlers` finds its `contentWindow`
 * gone once the second update replaced it, and the second frame loads; the extension cannot avoid
 * it cleanly (scripts need an options update, and html first also makes two).
 * Only that exact message with that frame matches: any other exception still fails the check.
 * VERIFIED on Windows 11, Node 24.22 (28/10/2026) with a scratch script on the logged line of a
 * full run: the real line matched, "Uncaught TypeError: x is undefined" did not, nor the same
 * message with another frame. NOT observed: the warning in a full run.
 */
function isVsCodeFrameRace(line) {
  return (
    line.startsWith('[exception] Uncaught Error: Found unexpected null') &&
    line.includes('at hookupOnLoadHandlers (vscode-webview://')
  );
}

/**
 * Fails when the webview logged a CSP violation or an uncaught exception since the last call.
 * VS Code's own frame race (`isVsCodeFrameRace`) is a warning instead (decision of Sergio,
 * 28/10/2026): it comes from the host page, not from our bundle, and the extension cannot avoid it
 * cleanly (see `isVsCodeFrameRace`).
 */
function assertNoWebviewErrors(where) {
  const logged = webviewLogs
    .splice(0)
    .filter((line) => /Refused to|Content Security Policy|^\[exception\]/i.test(line));
  const races = logged.filter(isVsCodeFrameRace);
  if (races.length > 0) {
    warn(
      `${where}: VS Code's webview host threw "Found unexpected null" while mounting (its own race)`,
    );
  }
  const bad = logged.filter((line) => !isVsCodeFrameRace(line));
  check(
    bad.length === 0,
    `${where}: no CSP violation or exception in the webview${bad.length ? ` (${bad.slice(0, 3).join(' | ')})` : ''}`,
  );
}

/**
 * Runs PowerShell with `-STA` and `input` on stdin; returns stdout. `System.Windows.Forms.Clipboard`
 * requires a single-threaded apartment (HYPOTHESIS from the .NET docs; the calls here only ran
 * with `-STA`). `maxBuffer` is ours, 64 MiB, room for the base64 of a large screenshot: beyond it
 * Node fails with ENOBUFS, so the save throws and the step fails WITHOUT touching the clipboard.
 */
function powershellSta(script, input = '') {
  return execFileSync('powershell', ['-NoProfile', '-STA', '-Command', script], {
    windowsHide: true,
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/**
 * Reads what the user has on the Windows clipboard so step 20 can give it back: text (Unicode) or
 * an image (as PNG), base64 through stdout and kept IN MEMORY only (it may be a password; nothing
 * goes to disk or to the log). Text is checked first, so a copy from Word, Excel or a browser
 * (text plus HTML, RTF or an image) comes back as PLAIN TEXT only, and the run warns when the
 * clipboard held more formats than the one kept. Anything else (copied files, HTML only) is
 * `other` and cannot be restored; the run warns about it. Throws if the clipboard cannot be read
 * or the answer is not one of the four kinds, so the step that would overwrite it fails instead
 * (decision of Sergio, 23/10/2026: save and restore). An image comes back as PNG: its alpha and
 * original formats may differ.
 * VERIFIED for an image (Windows 11, 23/10/2026): a full `npm run test:visual` printed "clipboard
 * saved (image)" and "clipboard restored (image)", and a read-only sha256 of the clipboard was the
 * same before and after the run. UNVERIFIED for text (the clipboard held an image that day), for
 * `empty` and for `other`; the README says what is not kept.
 */
function saveClipboard() {
  // One line for PowerShell: statements joined by `; `, but the if/elseif/else chain by spaces
  // (`; elseif` is a parse error, seen on Windows 11 / PowerShell 5.1, 23/10/2026).
  // The first line says how many formats the clipboard held (a number only), the second the kind.
  const chain = [
    'if ($c::ContainsText()) { "text:" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($c::GetText())) }',
    'elseif ($c::ContainsImage()) { $m = New-Object IO.MemoryStream; $c::GetImage().Save($m, [System.Drawing.Imaging.ImageFormat]::Png); "image:" + [Convert]::ToBase64String($m.ToArray()) }',
    'elseif ($n -gt 0) { "other:" }',
    'else { "empty:" }',
  ].join(' ');
  const out = powershellSta(
    `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $c = [System.Windows.Forms.Clipboard]; $d = $c::GetDataObject(); $n = if ($d) { $d.GetFormats().Length } else { 0 }; "$n"; ${chain}`,
  );
  const [count = '', answer = ''] = out.split(/\r?\n/);
  const colon = answer.indexOf(':');
  const kind = colon < 0 ? '' : answer.slice(0, colon);
  if (!['text', 'image', 'empty', 'other'].includes(kind)) {
    throw new Error('the clipboard could not be read (unexpected answer); it was not touched');
  }
  if ((kind === 'text' || kind === 'image') && Number(count) > 1) {
    warn(`the clipboard held ${count} formats: only its ${kind} will be given back`);
  }
  return { kind, data: answer.slice(colon + 1) };
}

/**
 * Gives back what {@link saveClipboard} read: the same text or image, or an empty clipboard if it
 * was empty. Never throws: a failure is a warning, the run goes on. Logs only the kind.
 * VERIFIED for an image only, by the run quoted in the header of {@link saveClipboard} ("clipboard
 * restored (image)", same sha256 before and after). UNVERIFIED for text and `empty`.
 */
function restoreClipboard(saved) {
  try {
    const read = '$b = [Convert]::FromBase64String([Console]::In.ReadToEnd())';
    const forms = 'Add-Type -AssemblyName System.Windows.Forms,System.Drawing';
    if (saved.kind === 'text') {
      powershellSta(
        `${forms}; ${read}; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::UTF8.GetString($b))`,
        saved.data,
      );
    } else if (saved.kind === 'image') {
      powershellSta(
        `${forms}; ${read}; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromStream((New-Object IO.MemoryStream(,$b))))`,
        saved.data,
      );
    } else if (saved.kind === 'empty') {
      powershellSta(`${forms}; [System.Windows.Forms.Clipboard]::Clear()`);
    } else {
      warn('the clipboard held something that is neither text nor an image: it was NOT restored');
      return;
    }
    console.log(`  clipboard restored (${saved.kind})`);
  } catch (error) {
    warn(
      `the clipboard could not be restored: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Wraps a step body that writes the clipboard: save first, give it back in `finally`. Outside
 * Windows it only runs the body (there is no clipboard code there). A failed save throws BEFORE
 * the body, so the step fails and the clipboard is never written.
 */
function withSavedClipboard(body) {
  return async () => {
    if (process.platform !== 'win32') return body();
    const saved = saveClipboard();
    console.log(`  clipboard saved (${saved.kind})`);
    try {
      await body();
    } finally {
      restoreClipboard(saved);
    }
  };
}

/** The ids of the steps that ran and, per step, `{ id, name, seconds }`, for `== timings`. */
const executedIds = [];
const timings = [];

/**
 * The id of the step after which the run stopped (`--bail` and a failure, or a stuck webview);
 * then every later step is skipped.
 */
let bailedAt;

/** The `STOPPED after step …` line of a run cut short by {@link diagnoseAfterFailure}, if any. */
let stoppedLine;

/**
 * Waits up to `ms` for the caret to be in the prompt box of the chat, proved with the real keyboard;
 * returns whether it was. Issue #127 (#100, step 22; N5 of step 32).
 *
 * The box must be the active element of the chat document AND the chat iframe the active element of
 * the workbench: only then is a typed letter sure to land in the box and never in the editor
 * (`src/sample.ts` is read by later steps) or elsewhere in the workbench. It then types `q`, waits
 * for the box to read its previous value plus `q`, and takes the letter back with Backspace. The
 * older check (`activeElement` AND `doc.hasFocus()`) reads false in a document that was just
 * created although the keyboard works (step 22, 28/10/2026), so it is not used. When the wait
 * expires nothing is typed and a line that is not an ok/FAIL/warn one says what each side held,
 * which answers "does the key arrive?" without a new loop. The 250 ms and 100 ms polls and the 2 s
 * wait for the typed letter are margins chosen in plan #1622 of issue #127, not measured
 * (HYPOTHESIS: a key that reaches the box shows in well under 2 s). HYPOTHESIS: that the workbench active
 * element is the iframe whenever the box is active in a document the keyboard reaches; it held in
 * the runs of steps 22 and 32 (see the README).
 */
async function caretLandsInBox(ms) {
  const reached = await waitFor(
    async () => {
      const outer = await page.evaluate(
        (selector) => globalThis.document.activeElement?.matches(selector) === true,
        CHAT_FRAME,
      );
      if (!outer) return undefined;
      return web.inDoc((doc) => {
        const field = doc.querySelector('textarea.prompt-text');
        return field !== null && doc.activeElement === field ? { value: field.value } : undefined;
      });
    },
    ms,
    250,
  );
  if (reached === undefined) {
    const outer = await page
      .evaluate(() => {
        const active = globalThis.document.activeElement;
        return `${String(active?.tagName)}.${String(active?.className).slice(0, 40)} hasFocus ${String(globalThis.document.hasFocus())}`;
      })
      .catch(() => 'unreadable');
    const inner = await web
      .inDoc((doc) => `${String(doc.activeElement?.tagName)} hasFocus ${String(doc.hasFocus())}`)
      .catch(() => 'unreadable');
    console.log(`  caret not in the prompt box: workbench ${outer}, chat ${inner}`);
    return false;
  }
  await page.keyboard.type('q');
  const landed = await waitFor(
    async () =>
      (await web.inDoc((doc) => doc.querySelector('textarea.prompt-text')?.value)) ===
      `${reached.value}q`,
    2_000,
    100,
  );
  if (landed === true) await page.keyboard.press('Backspace');
  return landed === true;
}

/**
 * Longest one probe of the workbench page may take, in ms (a `page.evaluate` has no timeout).
 * Chosen in plan #1622 of issue #127, not measured: a `page.evaluate` of `document.hasFocus()`
 * answered in milliseconds in the spike, so 5 s is a wide margin (HYPOTHESIS: a healthy workbench
 * never takes that long; a run that cuts on `workbench` with a healthy window would refute it).
 */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Whether the workbench document holds the system focus (`document.hasFocus()`), or rejects after
 * {@link PROBE_TIMEOUT_MS}. VERIFIED on Windows 11, VS Code stable (31/10/2026), spike with
 * `document.hasFocus()` printed at the start and end of steps 1, 2, 21, 22, 25 and 26: true at the
 * start of the run (focus in the empty editor group), with the focus in the editor input
 * (`native-edit-context`), with it inside the chat iframe (`IFRAME#webview` at the end of step 22) and
 * at the start of step 26, right after step 25 closed two windows. NOT observed: false, because the
 * window that was opened in front (a Notepad, then a topmost form) never took the foreground from the
 * hidden Windows session of the agent, so the premise "another window in front gives false" rests on
 * the earlier observation that a video in front left the suite without keyboard (`ciclo-extension`
 * §2bis), not on this spike.
 */
function workbenchHasFocus() {
  return withProbeTimeout(page.evaluate(() => globalThis.document.hasFocus()));
}

/** Rejects with "the workbench page did not answer in 5 s" if `promise` is not settled in time. */
function withProbeTimeout(promise) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(`the workbench page did not answer in ${String(PROBE_TIMEOUT_MS / 1000)} s`),
      );
    }, PROBE_TIMEOUT_MS);
  });
  return Promise.race([promise, limit]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Looks for why the run cannot go on after a failed step; returns `{ kind, detail }` for
 * {@link stopLine}, or `undefined` when nothing stops it (the step failed by itself and the next
 * ones may still prove something). Issue #127: without it, a webview that stops answering, a window
 * that lost the system focus or a modal dialog left open made every later step fail in cascade for
 * 10+ minutes without saying why.
 *
 * Only runs after a FAILED step or one that left the chat connection stuck (`step` decides), so a
 * run with no failed check and no stuck connection pays nothing and cannot be cut by a false
 * positive. The first cause that holds wins, in this order: (1) the chat webview connection is
 * stuck or closed (`stuck` is what the step saw; a probe `inDoc(() => true)` finds a socket that
 * died unnoticed) and, reopening it with `openChat(15_000)`, a target DOES appear but never answers
 * (decision of Sergio, #1638): that is the cut (`cdp`). If the reopen works, the run goes on with
 * the new connection and prints `  reopened the chat webview after step <id>: <why>` (not a check;
 * it also ends the cascade of "socket is closed" of step 24, 31/10/2026). If NO target appears
 * (a failed step left the chat hidden and VS Code destroyed the webview, which the next step's
 * `openChat` reopens) it prints `  no chat webview target after step <id>: <why>; the next step
 * reopens it` and goes on without cutting; (2) `document.hasFocus()` of the workbench stays false
 * for 3 s; (3) a `.monaco-dialog-box` is visible (decision P1=1 of Sergio, 31/10/2026: the
 * GitHub/Copilot terms dialog of `--with-copilot`, or one a failed step left open); its text
 * (`innerText`) goes in the line. A workbench probe that does not answer in 5 s is itself the
 * cause (`workbench`). The 15 s of the reopen and the 3 s of the focus wait are margins chosen in
 * plan #1622 of issue #127, not measured (HYPOTHESIS: a webview that exists is found in under 15 s;
 * the focus returns within 3 s if it is going to).
 * VERIFIED on Windows 11, VS Code 1.144.0 (01/11/2026) by temporary mutations at the end of step 1,
 * `--steps 1,2`, all reverted: (a) `Help: About` left open plus a failed check printed "STOPPED
 * after step 1: a modal dialog of VS Code is open ("Copy OK Visual Studio Code Version: 1.144.0
 * Commit: 2c33b50b16c472efe58357d1d2a8"); the remaining steps are skipped" (text read by
 * `innerText`), exit 1; (b) a closed socket plus a failed check, with the reopen made to find a
 * target that never answers, printed "STOPPED after step 1: the chat webview stopped answering CDP
 * (the webview CDP socket is closed; reopening it failed: the chat webview stopped answering CDP
 * (CDP Runtime.enable timed out after 20000 ms)); the remaining steps are skipped", exit 1, step 2
 * did not run; (c) the same with a reopen that finds no target printed "no chat webview target
 * after step 1: the webview CDP socket is closed; the next step reopens it" and step 2 ran, with
 * no STOPPED; (d) the same with a reopen that works printed "reopened the chat webview after step
 * 1: the webview CDP socket is closed" and step 2 ran; (e) a `Runtime.evaluate` that never
 * answers (stuck, no failed check) printed "reopened the chat webview after step 1: CDP
 * Runtime.evaluate timed out after 20000 ms", the run ended with exit 0 and step 2 ran. The
 * focus cause (2) was verified on 31/10/2026 (issue #127 mutation M2: a focus probe forced to false
 * printed "STOPPED … does not have the system focus") with the code before the reopen change, and
 * was not re-run after it. Observed once in a real run, the full `--with-copilot` run of 01/11/2026,
 * which was cut at step 27 with `STOPPED after step 27: the VS Code window does not have the system
 * focus (another window is in front); the remaining steps are skipped`, while Sergio was using the
 * machine. The line is observed; that another window was really in front is HYPOTHESIS, not
 * confirmed. NOT observed: a really frozen webview, a `workbench` cause (probe timeout).
 */
async function diagnoseAfterFailure(id, stuck) {
  if (page === undefined) return undefined;
  let webviewProblem = stuck;
  if (webviewProblem === undefined && web !== undefined) {
    if (web.isClosed()) webviewProblem = 'the webview CDP socket is closed';
    else {
      await web
        .inDoc(() => true)
        .catch((error) => {
          webviewProblem = error instanceof Error ? error.message : String(error);
        });
    }
  }
  if (webviewProblem !== undefined) {
    try {
      await openChat(15_000);
      console.log(`  reopened the chat webview after step ${id}: ${webviewProblem}`);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      if (!why.includes(WEBVIEW_NO_TARGET)) {
        return { kind: 'cdp', detail: `${webviewProblem}; reopening it failed: ${why}` };
      }
      console.log(
        `  no chat webview target after step ${id}: ${webviewProblem}; the next step reopens it`,
      );
    }
  }
  try {
    const end = Date.now() + 3_000;
    let focused = await workbenchHasFocus();
    while (!focused && Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      focused = await workbenchHasFocus();
    }
    if (!focused) return { kind: 'focus', detail: '' };
    const dialog = await withProbeTimeout(
      page.evaluate(() => {
        const box = [...globalThis.document.querySelectorAll('.monaco-dialog-box')].find((node) =>
          node.checkVisibility({ checkVisibilityCSS: true }),
        );
        return box === undefined ? undefined : box.innerText;
      }),
    );
    if (dialog !== undefined && dialog !== null) return { kind: 'dialog', detail: dialog };
  } catch (error) {
    return { kind: 'workbench', detail: error instanceof Error ? error.message : String(error) };
  }
  return undefined;
}

/**
 * Runs a step; an exception becomes a failure plus a screenshot, and the run continues.
 *
 * The id is the first token of `name` (`stepIdOf`), already unique across the 25 calls. A step
 * whose id is not in the selection returns at once without printing anything, so the call sites
 * are the same in a full and in a filtered run. It prints `  time N.N s` when the body ends (also
 * when it throws) and records it for `== timings`; that line is not an ok/FAIL/warn line. Measured
 * with `performance.now()`, so it includes the settling sleeps of the body, which is the point.
 * It also tells the trace which step is running (`traceStep`, the origin of the check gaps).
 *
 * Under `--bail` the first step that fails (a FAIL check, which ends the body with `BailStop`, or
 * an exception) takes its FAIL screenshot and stops the run: the later steps return at once, as an
 * unselected one does, and the run goes to its cleanup and summary (exit 1).
 *
 * With or without `--bail`, after a step that failed or left the chat webview connection stuck (one
 * CDP call timed out, `stuckReason` in `webviewCdp.mjs`) the run asks {@link diagnoseAfterFailure}
 * whether it can go on, and if not stops the same way and prints `STOPPED after step <id>: <why>;
 * the remaining steps are skipped` (also in `== summary`). Issue #93: once the webview stopped
 * answering, nearly every later step failed in cascade and the full run took 707.7 s instead of
 * about 240 (28/10/2026); the later steps prove nothing then. A stuck connection no longer stops the
 * run by itself: it stops it only when a reopened chat target appears and does not answer (issue
 * #127); a stuck one that reopens fine only prints a line. NOT observed: a real
 * stuck webview (the cascade was not reproduced: 300 sash drags, 200 theme switches and 150 rounds
 * with the server down, in isolation, were all clean).
 */
async function step(name, body) {
  const id = stepIdOf(name);
  if (!selectedIds.has(id) || bailedAt !== undefined) return;
  executedIds.push(id);
  console.log(`\n== ${name}`);
  const startedAt = performance.now();
  const failuresBefore = failures.length;
  // A stuck connection that never reached `web` (it got stuck inside `openChat`) shows only here.
  let stuckInException;
  inStep = true;
  traceStep = id;
  traceStepStart = startedAt;
  traceMark = startedAt;
  try {
    await body();
  } catch (error) {
    // A BailStop was already printed and counted by `check`.
    if (!(error instanceof BailStop)) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${name}: ${message}`);
      console.log(`  FAIL (exception) ${message}`);
      if (message.includes(WEBVIEW_STUCK)) stuckInException = message;
    }
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`).catch(() => undefined);
  } finally {
    inStep = false;
    traceStep = '-';
  }
  const seconds = (performance.now() - startedAt) / 1000;
  timings.push({ id, name, seconds });
  console.log(`  time ${seconds.toFixed(1)} s`);
  const stuck = web?.stuckReason() ?? stuckInException;
  const cause =
    failures.length > failuresBefore || stuck !== undefined
      ? await diagnoseAfterFailure(id, stuck)
      : undefined;
  if (cause !== undefined) {
    bailedAt = id;
    stoppedLine = stopLine(id, cause);
    if (failures.length === failuresBefore) failures.push(`${name}: ${stoppedLine}`);
    console.log(stoppedLine);
  } else if (bail && failures.length > failuresBefore) {
    bailedAt = id;
    console.log(`  --bail: stopping after step ${id}; the remaining steps are skipped`);
  }
}

/**
 * Waits for the webview to be connected (the server is up and the stream is connected). Since E2
 * (issue #85, P10=1) there is no visible "Connected" line: the app root carries
 * `data-connection="connected"`, which is what is read.
 */
async function waitConnected(ms = 60_000) {
  const ok = await waitFor(
    () =>
      web.inDoc(
        (doc) => doc.querySelector('.app')?.getAttribute('data-connection') === 'connected',
      ),
    ms,
  );
  return check(
    ok === true,
    'the webview is connected (the app root says data-connection="connected")',
  );
}

/** The four themes the layout rounds of steps 0 and 7b run in. */
const PROBLEM_THEMES = [
  ['light', 'Default Light Modern'],
  ['dark', 'Default Dark Modern'],
  ['hc-dark', 'Default High Contrast'],
  ['hc-light', 'Default High Contrast Light'],
];

/**
 * Boxes of the pieces of a connection problem (the guide or the card), in CSS px, plus whether the
 * root overflows sideways. `sel` is `{root, text, actions}`; a missing element gives `null`.
 * Self-contained: it is serialized into the page.
 */
function measureProblem(doc, sel) {
  const box = (selector) => {
    const element = doc.querySelector(selector);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
  };
  const root = doc.querySelector(sel.root);
  return {
    root: box(sel.root),
    text: box(sel.text),
    actions: box(sel.actions),
    overflow: root ? root.scrollWidth - root.clientWidth : null,
  };
}

/**
 * Layout round of a connection problem (E2, issue #85; the bug #1294 is "a notice shares its row
 * with its buttons when they do not fit"). At every width it measures, in the four themes: the
 * text block is at least 60 % as wide as the guide or card (no letter-per-line text), nothing
 * overflows sideways, the text and its title/cause are readable (contrast >= 4.5), and, when the
 * width is narrow (the bar is under 400 px), the buttons are BELOW the text, never beside it.
 *
 * Widths: 300 px (the default side bar), about 900 px, and the narrowest the side bar goes under
 * 200 px. `setSideBarWidth` throws when the bar stops elsewhere (the editor has a minimum width,
 * the side bar has its own), so each width is tried and the measured one is recorded; a width the
 * workbench does not allow is a `warn`, not a pass. `contrast` maps names to selectors for
 * `measureText`. Leaves the side bar at 300 px and the dark theme.
 */
async function problemLayoutRounds(label, sel, contrast) {
  const widths = [
    ['300', 300],
    ['wide', 900],
    ['narrow', 150],
  ];
  for (const [name, wanted] of widths) {
    let barPx;
    try {
      barPx = await setSideBarWidth(wanted);
    } catch (error) {
      barPx = await sideBarPx();
      warn(
        `${label}: the side bar did not go to ${String(wanted)} px (it is ${String(barPx)} px): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const inWanted =
      name === '300'
        ? Math.abs(barPx - 300) <= SIZE_TOLERANCE
        : name === 'wide'
          ? barPx >= 600
          : barPx < 200;
    if (!inWanted) {
      warn(`${label}: width "${name}" not reached (side bar ${String(barPx)} px): not judged`);
      continue;
    }
    for (const [themeName, theme] of PROBLEM_THEMES) {
      await setTheme(theme);
      const where = `${label} at ${name} (bar ${String(Math.round(barPx))} px), ${themeName}`;
      const m = await web.inDoc(measureProblem, sel);
      if (m.root === null || m.text === null) {
        check(false, `${where}: the ${sel.root} and ${sel.text} elements exist`);
        continue;
      }
      const ratio = m.text.width / m.root.width;
      check(
        ratio >= 0.6,
        `${where}: the text block is ${String(Math.round(ratio * 100))} % of the width (${String(Math.round(m.text.width))}/${String(Math.round(m.root.width))} px) >= 60 %`,
      );
      check(
        m.overflow !== null && m.overflow <= 1,
        `${where}: no sideways overflow (${String(m.overflow)} px)`,
      );
      if (barPx < 400 && m.actions !== null) {
        check(
          m.actions.top >= m.text.bottom - 1,
          `${where}: the buttons are below the text (buttons top ${String(Math.round(m.actions.top))} >= text bottom ${String(Math.round(m.text.bottom))})`,
        );
      }
      const contrastNow = await web.inDoc(measureText, contrast);
      for (const [part, result] of Object.entries(contrastNow)) {
        if (part === 'error') continue;
        if (!check(result !== null, `${where}: ${part} is on screen to be measured`)) continue;
        check(
          result.ratio >= 4.5,
          `${where}: ${part} contrast ${result.ratio.toFixed(2)} >= 4.5 (${result.color} on ${result.background})`,
        );
      }
      await shot(`${label.replace(/\W+/g, '-')}-${name}-${themeName}`);
    }
  }
  await setTheme('Default Dark Modern');
  await setSideBarWidth(300).catch(() => undefined); // it settles the layout itself
}

/** Measures code text contrast in the webview; see the long comment inside. */
function measureCode(doc) {
  const parse = (value) => {
    const text = String(value).trim();
    let match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(
      text,
    );
    if (match) {
      let alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
      if (match[4]?.endsWith('%')) alpha /= 100;
      return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
    }
    match = /^#([0-9a-f]{3,8})$/i.exec(text);
    if (match) {
      let hex = match[1];
      if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
      const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
        alpha,
      ];
    }
    return null;
  };
  const over = (front, back) => {
    const alpha = front[3];
    return [0, 1, 2].map((i) => front[i] * alpha + back[i] * (1 - alpha)).concat([1]);
  };
  const luminance = (color) => {
    const [r, g, b] = color.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  const win = doc.defaultView;
  const root = win.getComputedStyle(doc.documentElement);
  // The webview body is transparent: what shows through is the side bar of the workbench.
  const base =
    parse(root.getPropertyValue('--vscode-sideBar-background')) ??
    parse(root.getPropertyValue('--vscode-editor-background'));
  if (!base) return { error: 'no base background variable' };
  const effectiveBackground = (element) => {
    const chain = [];
    for (let node = element; node; node = node.parentElement) chain.unshift(node);
    let background = [base[0], base[1], base[2], 1];
    for (const node of chain) {
      const own = parse(win.getComputedStyle(node).backgroundColor);
      if (own && own[3] > 0) background = over(own, background);
    }
    return background;
  };
  const textRatio = (element) => {
    const background = effectiveBackground(element);
    const color = parse(win.getComputedStyle(element).color);
    return color ? ratio(over(color, background), background) : 0;
  };
  const code = doc.querySelector('.code-body code');
  if (!code) return { error: 'no code block in the conversation' };
  const spans = [...doc.querySelectorAll('.code-body [class*="hljs-"]')].slice(0, 60);
  const inline = doc.querySelector('.md code:not(.file-ref)');
  return {
    code: textRatio(code),
    spansMin: spans.length ? Math.min(...spans.map(textRatio)) : null,
    spans: spans.length,
    inline: inline ? textRatio(inline) : null,
    codeBackground: win.getComputedStyle(code).backgroundColor,
  };
}

/**
 * Text/background contrast of the first added and the first deleted line of the OPEN tool card
 * (issue #26, `.diff-line[data-kind=add|del]`), of the header words of the first card (title,
 * argument, status, result), and the border-left width of each (high contrast marks a diff line
 * with a border instead of a tint). Self-contained, because it is serialized into the
 * page; the colour maths is a copy of {@link measureCode} for the same reason. The base is the
 * side bar background (the webview body is transparent); lines are painted over their ancestors.
 */
function measureDiffLines(doc) {
  const parse = (value) => {
    const text = String(value).trim();
    let match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(
      text,
    );
    if (match) {
      let alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
      if (match[4]?.endsWith('%')) alpha /= 100;
      return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
    }
    // The `--vscode-*` variables come as hex (`#rrggbb[aa]`), computed styles as `rgb()`.
    match = /^#([0-9a-f]{3,8})$/i.exec(text);
    if (match) {
      let hex = match[1];
      if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
      const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
        alpha,
      ];
    }
    return null;
  };
  const over = (front, back) =>
    [0, 1, 2].map((i) => front[i] * front[3] + back[i] * (1 - front[3])).concat([1]);
  const luminance = (color) => {
    const [r, g, b] = color.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const win = doc.defaultView;
  const root = win.getComputedStyle(doc.documentElement);
  const base =
    parse(root.getPropertyValue('--vscode-sideBar-background')) ??
    parse(root.getPropertyValue('--vscode-editor-background'));
  if (!base) return { error: 'no base background variable' };
  const measure = (selector) => {
    const line = doc.querySelector(selector);
    if (!line) return null;
    const chain = [];
    for (let node = line; node; node = node.parentElement) chain.unshift(node);
    let background = [base[0], base[1], base[2], 1];
    for (const node of chain) {
      const own = parse(win.getComputedStyle(node).backgroundColor);
      if (own && own[3] > 0) background = over(own, background);
    }
    const style = win.getComputedStyle(line);
    const color = parse(style.color);
    const [high, low] = [luminance(over(color, background)), luminance(background)].sort(
      (x, y) => y - x,
    );
    return {
      ratio: (high + 0.05) / (low + 0.05),
      border: style.borderLeftWidth,
      background: style.backgroundColor,
    };
  };
  return {
    add: measure('.tool-card .diff-line[data-kind="add"]'),
    del: measure('.tool-card .diff-line[data-kind="del"]'),
    // The header words of the card: the argument once vanished in "High Contrast Light" (it was
    // painted with textPreformat-foreground), which only a measurement of it can catch.
    title: measure('.tool-card .tool-title'),
    arg: measure('.tool-card .tool-arg'),
    status: measure('.tool-card .tool-status'),
    result: measure('.tool-card .tool-result'),
    // The error tone of a real failed call (step 15, the read of a missing file).
    failedStatus: measure('.tool-card .tool-status[data-tone="error"]'),
    // The error line inside the unfolded body (null while the card is folded).
    failedError: measure('.tool-card .tool-body .tool-error'),
  };
}

/**
 * Text/background contrast of the first element of each selector (issue #28, the `@` popup).
 * `selectors` maps a name to a CSS selector and the result maps the same names to `{ratio, color,
 * background}` or `null` when nothing matches. Self-contained, because it is serialized into the
 * page, so the colour maths is a copy of {@link measureCode}'s; the base is the side bar
 * background (the webview body is transparent) and each element is painted over its ancestors.
 * A `__base` entry (a CSS variable name, e.g. `--vscode-editor-background`) replaces the side bar
 * as the base and is not measured: the Settings tab sits on the editor background.
 */
function measureText(doc, selectors) {
  const parse = (value) => {
    const text = String(value).trim();
    let match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(
      text,
    );
    if (match) {
      let alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
      if (match[4]?.endsWith('%')) alpha /= 100;
      return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
    }
    match = /^#([0-9a-f]{3,8})$/i.exec(text);
    if (match) {
      let hex = match[1];
      if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
      const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
        alpha,
      ];
    }
    return null;
  };
  const over = (front, back) =>
    [0, 1, 2].map((i) => front[i] * front[3] + back[i] * (1 - front[3])).concat([1]);
  const luminance = (color) => {
    const [r, g, b] = color.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const win = doc.defaultView;
  const root = win.getComputedStyle(doc.documentElement);
  // `__base` (E10-config-views, steps 35-36) names the variable the text sits on when it is not the
  // side bar: the OpenCode Settings tab is an EDITOR, so it asks for `--vscode-editor-background`.
  // It is not a selector: it is taken out before the names are measured.
  const { __base: baseVariable, ...named } = selectors;
  const base =
    parse(root.getPropertyValue(baseVariable ?? '--vscode-sideBar-background')) ??
    parse(root.getPropertyValue('--vscode-editor-background'));
  if (!base) return { error: 'no base background variable' };
  const measure = (selector) => {
    const element = doc.querySelector(selector);
    if (!element) return null;
    const chain = [];
    for (let node = element; node; node = node.parentElement) chain.unshift(node);
    let background = [base[0], base[1], base[2], 1];
    for (const node of chain) {
      const own = parse(win.getComputedStyle(node).backgroundColor);
      if (own && own[3] > 0) background = over(own, background);
    }
    const color = parse(win.getComputedStyle(element).color);
    const [high, low] = [luminance(over(color, background)), luminance(background)].sort(
      (x, y) => y - x,
    );
    return {
      ratio: (high + 0.05) / (low + 0.05),
      color: win.getComputedStyle(element).color,
      background: `rgb(${background.slice(0, 3).map(Math.round).join(', ')})`,
    };
  };
  return Object.fromEntries(Object.entries(named).map(([name, sel]) => [name, measure(sel)]));
}

// ---------------------------------------------------------------------------------------------

let started = false;
let startupError;
try {
  workspace = createWorkspace();
  // Step 0 (E2, issue #85) starts with a binary that does not exist and the fixture marked down:
  // the first thing the chat can show is the setup guide. A run without step 0 (a filtered one)
  // starts normally: the fixture as the binary and no `.down` marker, which is the state step 0
  // leaves behind (`startVSCode` without those two options, see `vscodeProcess.mjs`).
  const withSetupGuide = selectedIds.has('0');
  const missingBinary = path.join(workDir, 'no-such-opencode', 'opencode.exe');
  vscode = await startVSCode({
    repoRoot,
    workDir,
    workspace,
    withCopilot,
    ...(withSetupGuide ? { opencodePath: missingBinary, startDown: true } : {}),
  });
  vscodeStartedAt = performance.now();
  console.log(
    `VS Code pid ${String(vscode.pid)}, CDP port ${String(vscode.port)}, workspace ${workspace}`,
  );
  await connectWorkbench();
  // A wrong size throws here, before `started`, so it takes the start-up path (exit 2).
  const startSize = await setWindowSize(WINDOW_SIZE.width, WINDOW_SIZE.height);
  console.log(
    `window ${String(startSize.width)}x${String(startSize.height)} CSS px, DPR ${String(startSize.dpr)}, screen work area ${startSize.screen}`,
  );
  // Data, not a check: whether the window holds the system focus (see `diagnoseAfterFailure`).
  console.log(`system focus ${String(await workbenchHasFocus().catch(() => 'unknown'))}`);
  if (withCopilot) {
    const visible = await page
      .evaluate(
        () =>
          globalThis.document.querySelector('.part.auxiliarybar')?.checkVisibility({
            checkVisibilityCSS: true,
          }) ?? false,
      )
      .catch(() => 'unknown');
    console.log(`copilot: secondary side bar visible ${String(visible)}`);
  }
  started = true;
  // The OpenCode item of the activity bar is what step 0 clicks first; no fixed 3 s any more.
  await page
    .locator('.activitybar [aria-label^="OpenCode"]')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => undefined);

  /**
   * Texts of the native notifications that mention OpenCode: the visible toasts plus the ones the
   * notification center holds (a toast VS Code hid on its own is still listed there).
   *
   * The center is opened from the palette ("Notifications: Show Notifications") and closed with
   * "Notifications: Hide Notifications", Escape only if it is still open. Returns `{ notices,
   * centerRead }`; `centerRead` is false when the center could not be opened or read, and the
   * callers then FAIL their check (an unreadable center is "not measured", never "0 notices").
   * VERIFIED on Windows 11, VS Code 1.144.0 (28/10/2026), full `npm run test:visual`: "ok   no
   * native OpenCode warning appears while the setup guide is shown (center read: true; [])" and
   * "ok   no native OpenCode warning appears after step 2 (Start the server) fails (center read:
   * true; [])", so both palette titles and the selector opened and read the center. Not observed:
   * a center holding an OpenCode notification (that case is covered by the mutation check of step
   * 0, not re-run in this round).
   */
  const nativeOpenCodeNotices = async () => {
    const isOpenCode = (text) => /opencode|openVsCode/i.test(text);
    const toasts = await page.locator('.notifications-toasts .notification-toast').allInnerTexts();
    let listed = [];
    let centerRead = false;
    try {
      await command('Notifications: Show Notifications');
      await page.locator('.notifications-center.visible').waitFor({ timeout: 3_000 });
      listed = await page.locator('.notifications-center .notification-list-item').allInnerTexts();
      await command('Notifications: Hide Notifications');
      if (await page.locator('.notifications-center.visible').count()) {
        await page.keyboard.press('Escape');
      }
      centerRead = true;
    } catch (error) {
      console.log(`  the notification center could not be read: ${String(error)}`);
    }
    return {
      notices: [...toasts, ...listed].filter(isOpenCode).map((text) => text.replace(/\s+/g, ' ')),
      centerRead,
    };
  };

  // E2 (issue #85) step 0: the setup guide. VS Code started with `openVsCode.opencodePath` pointing
  // at a file that does not exist, and with the fixture's `.down` marker in place.
  await step('0 setup guide: binary missing, Choose binary…, server down, Restart', async () => {
    for (let i = 0; i < 5 && (await page.locator('.onboarding-a-overlay.visible').count()); i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400); // the overlay fades out; the loop condition reads it again
    }
    await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
    await openChat(40_000);
    const guide = await waitFor(
      () => web.inDoc((doc) => doc.querySelector('.setup-guide') !== null),
      30_000,
    );
    check(guide === true, 'the setup guide is shown instead of the chat');
    const state = await web.inDoc((doc) => ({
      title: doc.querySelector('.setup-guide h2')?.textContent,
      steps: [...doc.querySelectorAll('.setup-step .step-title')].map((t) => t.textContent),
      text: doc.querySelector('[data-step="binary"]')?.textContent ?? '',
      header: doc.querySelector('.chat-header') !== null,
      textarea: doc.querySelector('textarea') !== null,
    }));
    check(state.title === 'Set up opencode', `the guide title is "${state.title}"`);
    check(
      state.steps[0] === '1. Find the opencode binary — Failed',
      `step 1 is marked failed in words ("${state.steps[0]}")`,
    );
    check(
      state.text.includes(missingBinary),
      'step 1 says which openVsCode.opencodePath value was searched (the missing file)',
    );
    check(!state.header && !state.textarea, 'the guide has no header and no prompt box');
    const guideSeenAt = Date.now();
    await shot('00-guide');
    // Issue #87: with the guide on screen, no native OpenCode notification may be there, neither as
    // a toast nor in the notification center. The wait runs from the moment the guide was seen, a
    // little past the 3 s grace period of `CHAT_SHOW_GRACE_MS`, so a warning that was only
    // postponed (not withheld) has appeared by now. Placed before the theme rounds on purpose: a
    // toast left on screen disturbs them, and this check must be the one that says why.
    await page.waitForTimeout(Math.max(0, guideSeenAt + 4_500 - Date.now()));
    const afterGuide = await nativeOpenCodeNotices();
    check(
      afterGuide.centerRead && afterGuide.notices.length === 0,
      `no native OpenCode warning appears while the setup guide is shown (center read: ${String(afterGuide.centerRead)}; ${JSON.stringify(afterGuide.notices).slice(0, 200)})`,
    );
    await problemLayoutRounds(
      'guide',
      {
        root: '.setup-guide',
        // The text of the step (its first line), not `.step-body`, which also holds the buttons.
        text: '[data-step="binary"] .step-line',
        actions: '[data-step="binary"] .step-actions',
      },
      {
        title: '[data-step="binary"] .step-title',
        detail: '[data-step="binary"] .step-line',
        subtitle: '.setup-subtitle',
      },
    );

    // Choose binary… with the real mouse, through VS Code's own file dialog (a quick input).
    const fixturePath = path.join(
      repoRoot,
      'src',
      'extension',
      'test-fixtures',
      'fake-opencode.mjs',
    );
    // Issue #86: the state of "Choose binary…" as the page shows it.
    const chooseState = () =>
      web.inDoc((doc) => {
        const button = [...doc.querySelectorAll('[data-step="binary"] button')].find(
          (b) => b.textContent === 'Choose binary…',
        );
        return button
          ? {
              busy: button.getAttribute('aria-disabled'),
              hasDisabled: button.hasAttribute('disabled'),
              status: doc.querySelector('[data-step="binary"]')?.getAttribute('data-status'),
            }
          : null;
      });
    const quickInput = page.locator('.quick-input-widget input').first();

    // Issue #86, part 1: a dialog that is cancelled. While it is open the button is busy
    // (`aria-disabled`, never `disabled`) and the step still says Failed; Escape gives it back.
    check(await clickButton('Choose binary…'), 'Choose binary… is pressed (and then cancelled)');
    await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
    const busyWhileOpen = await waitFor(
      async () => {
        const s = await chooseState();
        return s !== null && s.busy === 'true' && !s.hasDisabled && s.status === 'failed';
      },
      5_000,
      100,
    );
    check(
      busyWhileOpen === true,
      'while the file dialog is open, Choose binary… is aria-disabled (not disabled) and step 1 still says Failed',
    );
    await page.keyboard.press('Escape');
    const usableAgain = await waitFor(
      async () => {
        const s = await chooseState();
        return s !== null && s.busy === null && s.status === 'failed';
      },
      5_000,
      100,
    );
    check(
      usableAgain === true,
      'cancelling the file dialog gives Choose binary… back and step 1 stays Failed',
    );

    // Issue #86, part 2: a path is chosen while the fixture answers `--version` slowly (the
    // `.slow-version` marker, at most 8 s), so "Checking…" stays on screen long enough to be
    // measured at 300 px in the four themes.
    const slowMarker = `${vscode.stateFile}.slow-version`;
    fs.writeFileSync(slowMarker, 'slow --version\n');
    check(await clickButton('Choose binary…'), 'Choose binary… is pressed with the real mouse');
    const dialog = quickInput;
    let viaDialog;
    try {
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      if (!(await typeInQuickInput(dialog, fixturePath))) {
        throw new Error('the Choose binary… dialog did not take the focus'); // to the fallback
      }
      await shot('00b-choose-binary-dialog');
      await page.keyboard.press('Enter');
      const checkingSeen = await waitFor(
        () =>
          web.inDoc(
            (doc) =>
              doc.querySelector('[data-step="binary"]')?.getAttribute('data-status') === 'checking',
          ),
        8_000,
        100,
      );
      check(
        checkingSeen === true,
        'after choosing a path, step 1 says Checking… while the detection runs',
      );
      if (checkingSeen === true) {
        const checkingBarPx = await sideBarPx();
        const shownTheme = [];
        for (const [themeName, theme] of PROBLEM_THEMES) {
          await setTheme(theme);
          const where = `Checking… at 300 (bar ${String(Math.round(checkingBarPx))} px), ${themeName}`;
          const view = await web.inDoc((doc) => ({
            status: doc.querySelector('[data-step="binary"]')?.getAttribute('data-status'),
            title: doc.querySelector('[data-step="binary"] .step-title')?.textContent,
            lines: [...doc.querySelectorAll('[data-step="binary"] .step-line')].map(
              (l) => l.textContent,
            ),
            spinner: doc.querySelector('[data-step="binary"] .spinner') !== null,
            live: doc.querySelector('.setup-guide [role="status"]')?.textContent,
            serverStatus: doc.querySelector('[data-step="server"]')?.getAttribute('data-status'),
          }));
          if (view.status !== 'checking') {
            warn(`${where}: the detection ended before this theme was measured: not judged`);
            continue;
          }
          shownTheme.push(themeName);
          check(
            view.title === '1. Find the opencode binary — Checking…',
            `${where}: the title says Checking… ("${String(view.title)}")`,
          );
          check(
            // Lower-cased: the dialog hands back the drive letter in lower case ("g:\…").
            view.lines.length === 1 &&
              view.lines[0]?.toLowerCase() === `Checking ${fixturePath}…`.toLowerCase(),
            `${where}: one line names the chosen path (${JSON.stringify(view.lines).slice(0, 160)})`,
          );
          check(view.spinner, `${where}: a spinner is shown`);
          check(
            view.live === 'Checking the opencode binary…' && view.serverStatus === 'waiting',
            `${where}: the hidden region announces the check and step 2 still waits`,
          );
          const contrastNow = await web.inDoc(measureText, {
            title: '[data-step="binary"] .step-title',
            detail: '[data-step="binary"] .step-line',
          });
          for (const [part, result] of Object.entries(contrastNow)) {
            if (part === 'error') continue;
            if (!check(result !== null, `${where}: ${part} is on screen to be measured`)) continue;
            check(
              result.ratio >= 4.5,
              `${where}: ${part} contrast ${result.ratio.toFixed(2)} >= 4.5 (${result.color} on ${result.background})`,
            );
          }
          await shot(`00c-checking-${themeName}`);
        }
        console.log(`  Checking… measured in: ${shownTheme.join(', ') || 'no theme'}`);
        await setTheme('Default Dark Modern');
      }
      fs.rmSync(slowMarker, { force: true });
      viaDialog =
        (await waitFor(
          () =>
            web.inDoc(
              (doc) =>
                doc.querySelector('[data-step="binary"]')?.getAttribute('data-status') === 'done',
            ),
          20_000,
          300,
        )) === true;
    } catch {
      viaDialog = false;
    }
    fs.rmSync(slowMarker, { force: true });
    if (!viaDialog) {
      // Plan B (decision of the plan, section 10): the dialog did not take the .mjs. Close it,
      // write the setting the way the action would, and say so.
      await page.keyboard.press('Escape');
      writeSettings(vscode.userDataDir, { 'openVsCode.opencodePath': fixturePath });
      warn(
        'Choose binary…: the simple dialog did not accept the .mjs; the setting was written with writeSettings (plan B). The click and the dialog opening were real, the write by the action was NOT verified',
      );
    } else {
      check(
        true,
        'Choose binary… through the real file dialog wrote the setting and step 1 is done',
      );
    }
    const afterChoose = await waitFor(
      () =>
        web.inDoc(
          (doc) =>
            doc.querySelector('[data-step="binary"]')?.getAttribute('data-status') === 'done' &&
            doc.querySelector('[data-step="server"]')?.getAttribute('data-status') === 'failed',
        ),
      30_000,
      300,
    );
    check(
      afterChoose === true,
      'step 1 is done and step 2 (Start the server) fails: the server is marked down',
    );
    await shot('00c-server-down');
    // Issue #87, the lifecycle notification: the chat is ready and shows the failed step 2, so the
    // "server failed to start" error must not appear natively either.
    await page.waitForTimeout(1_500);
    const afterStep2 = await nativeOpenCodeNotices();
    check(
      afterStep2.centerRead && afterStep2.notices.length === 0,
      `no native OpenCode warning appears after step 2 (Start the server) fails (center read: ${String(afterStep2.centerRead)}; ${JSON.stringify(afterStep2.notices).slice(0, 200)})`,
    );

    // The server is let back up and Restart is pressed with the real mouse.
    fs.rmSync(vscode.downMarker, { force: true });
    check(await clickButton('Restart'), 'Restart is pressed with the real mouse');
    await waitConnected(60_000);
    const after = await web.inDoc((doc) => ({
      guide: doc.querySelector('.setup-guide') !== null,
      suggestions: doc.querySelectorAll('.suggestion').length,
    }));
    check(!after.guide, 'the guide is gone once connected');
    check(after.suggestions >= 3, 'the normal empty state is back');
    assertNoWebviewErrors('setup guide');
  });

  await step('1 empty state and connection', async () => {
    for (let i = 0; i < 5 && (await page.locator('.onboarding-a-overlay.visible').count()); i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400); // the overlay fades out; the loop condition reads it again
    }
    // Step 0 already opened the chat; a second click on the activity bar would hide the side bar.
    if ((await page.locator('iframe.webview.ready').count()) === 0) {
      await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
    }
    await openChat(40_000);
    await waitConnected();
    // Diagnostic: the width the layout-dependent steps (9, 10, 11, 15) run with.
    console.log(
      `  webview ${String(await web.inDoc((doc) => doc.documentElement.clientWidth))} CSS px wide`,
    );
    const state = await web.inDoc((doc) => ({
      title: doc.querySelector('.chat-title')?.textContent,
      newSessionButtons: [...doc.querySelectorAll('header button')].map((b) => b.textContent),
      suggestions: doc.querySelectorAll('.suggestion').length,
    }));
    check(
      state.title === 'Untitled session',
      `empty session title is "Untitled session" (got "${state.title}")`,
    );
    check(state.newSessionButtons.includes('New session'), 'the header has a New session button');
    check(
      state.suggestions >= 3,
      `the empty state offers suggestions (${String(state.suggestions)})`,
    );
    await shot('01-empty');
    assertNoWebviewErrors('empty state');
  });

  await step('2 Markdown, code actions and file links', async () => {
    // MARKDOWN makes the synthetic server answer with a ts fence, a bash fence, a 2x2 table, a list
    // of two, `src/sample.ts:20` and a link, streamed in deltas 600 ms apart (about 4 s), the first
    // fence cut open: the shot 3 s after sending sees a block that is still being written.
    await send(
      'Reply with: a short TypeScript function in a ts code block, a bash command in a bash code block, ' +
        'a markdown table with 2 columns and 2 rows, a bullet list of 2 items, the inline code path `src/sample.ts:20`, ' +
        'and a link to https://code.visualstudio.com . Do not use any tools. MARKDOWN',
    );
    // Fixed on purpose: the fixture's pace (600 ms between deltas) defines "the block is half way".
    await page.waitForTimeout(3000);
    await shot('02a-streaming');
    const ended = await waitIdle(30_000);
    check(ended, 'the first turn ended');
    await waitFor(
      () => web.inDoc((doc) => doc.querySelectorAll('[class*="hljs-"]').length > 0),
      3_000,
      100,
    );
    await shot('02b-markdown');
    const dom = await web.inDoc((doc) => ({
      hljs: doc.querySelectorAll('[class*="hljs-"]').length,
      tables: doc.querySelectorAll('table').length,
      codeButtons: doc.querySelectorAll('button[aria-label="Copy code"]').length,
      links: [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      // Not the `<html>` element: VS Code itself sets the theme variables in its `style`.
      // Only NON-EMPTY ones: Chromium leaves an empty `style=""` on a textarea it has resized,
      // which the CSP does not block (no declarations to apply).
      styleAttributes: [...doc.querySelectorAll('body [style], body[style]')]
        .filter((e) => (e.getAttribute('style') ?? '').trim() !== '')
        .map((e) => `${e.tagName}.${e.className}: ${e.getAttribute('style')}`),
      fileRefs: [...doc.querySelectorAll('.file-ref')].map(
        (e) => `${e.dataset.path}:${e.dataset.line}`,
      ),
    }));
    check(
      dom.codeButtons >= 1,
      `code blocks have actions (${String(dom.codeButtons)} Copy buttons)`,
    );
    check(dom.hljs > 0, 'closed code blocks are highlighted');
    check(
      dom.styleAttributes.length === 0,
      `no inline style attribute in the webview body (${dom.styleAttributes.join(' | ')})`,
    );
    check(dom.tables >= 1, `the reply renders its table (${String(dom.tables)})`);
    check(
      dom.links.every((href) => /^(https?:|mailto:)/.test(href ?? '')),
      `every link is http(s) or mailto (${dom.links.join(', ')})`,
    );
    check(
      dom.fileRefs.includes('src/sample.ts:20'),
      `the reply has a file reference to src/sample.ts:20 (${dom.fileRefs.join(', ') || 'none'})`,
    );
    await clickIn('.file-ref[data-path="src/sample.ts"][data-line="20"]');
    await waitFor(
      async () =>
        /Ln 20\b/.test(
          await page.locator('#status\\.editor\\.selection').first().innerText({ timeout: 500 }),
        ),
      4_000,
      100,
    );
    const selection = await page
      .locator('#status\\.editor\\.selection')
      .first()
      .innerText()
      .catch(() => '');
    check(
      /Ln 20\b/.test(selection),
      `clicking the file reference opens the line (status bar: "${selection}")`,
    );
    await shot('02c-fileref');
    check(
      await clickIn('button[aria-label="Open code in a new file"]'),
      'a code block has an "Open code in a new file" button and it is pressed',
    );
    await waitFor(
      async () => {
        const mode = await page
          .locator('#status\\.editor\\.mode')
          .first()
          .innerText({ timeout: 500 });
        return mode.trim() !== '' && !/plain\s*text/i.test(mode);
      },
      4_000,
      100,
    );
    const language = await page
      .locator('#status\\.editor\\.mode')
      .first()
      .innerText()
      .catch(() => '');
    check(
      language.trim() !== '' && !/plain\s*text/i.test(language),
      `New file opens with a language (status bar: "${language.trim()}")`,
    );
    // The new file is an unsaved Untitled editor: left open, the first "Close All Editors" (step 15)
    // raised "Do you want to save the changes…?" and nothing answered it, so later keys went to the
    // dialog (seen by Sergio in the runs of 28/10/2026). It is the active editor here.
    await command('View: Revert and Close Editor');
    await waitFor(
      async () => (await page.locator('.tab[aria-label*="Untitled"]').count()) === 0,
      3_000,
      100,
    );
    assertNoWebviewErrors('markdown');
  });

  await step('3 Stop is neutral, history, focus', async () => {
    await focusPromptBox();
    // LONG: the synthetic server answers with the numbers 1 to 400, five per delta every 200 ms
    // (about 16 s), so the turn is still running when Escape comes.
    await page.keyboard.type('Count from 1 to 400, one number per line. Do not use tools. LONG');
    await page.keyboard.press('Enter');
    const sawStop = await waitFor(isBusy, 30_000, 300);
    check(sawStop === true, 'Stop is visible while the turn runs');
    // Fixed on purpose: the capture needs the LONG turn running for a while (lines already streamed).
    await page.waitForTimeout(2500);
    await shot('03a-busy');
    await page.keyboard.press('Escape'); // the focus is still in the textarea
    check(await waitIdle(30_000), 'Escape stops the turn');
    await waitFor(
      () => web.inDoc((doc) => doc.querySelectorAll('.stopped-note').length > 0),
      3_000,
      100,
    );
    const state = await web.inDoc((doc) => ({
      stopped: doc.querySelectorAll('.stopped-note').length,
      alerts: doc.querySelectorAll('[role="alert"]').length,
      redBoxes: doc.querySelectorAll('.alert-error').length,
      text: doc.querySelector('.stopped-note')?.textContent ?? '',
    }));
    check(state.stopped >= 1, `a neutral "Stopped" note is shown ("${state.text.trim()}")`);
    check(state.alerts === 0 && state.redBoxes === 0, 'a stopped turn is not an alert and not red');
    await shot('03b-stopped');
    await focusPromptBox();
    await page.keyboard.press('ArrowUp');
    const recalled = await web.inDoc((doc) => doc.querySelector('textarea').value);
    check(recalled.startsWith('Count from 1 to 400'), 'ArrowUp recalls the last prompt');
    await page.keyboard.press('ArrowDown');
    assertNoWebviewErrors('stop');
  });

  await step('4 themes: code contrast and screenshots', async () => {
    for (const [name, theme, strict] of [
      ['light', 'Default Light Modern', false],
      ['dark', 'Default Dark Modern', false],
      ['hc-dark', 'Default High Contrast', true],
      ['hc-light', 'Default High Contrast Light', true],
    ]) {
      await setTheme(theme);
      await shot(`04-theme-${name}`);
      const measured = await web.inDoc(measureCode);
      if (measured.error) {
        check(false, `${name}: could not measure the code (${measured.error})`);
        continue;
      }
      check(
        measured.code >= 4.5,
        `${name}: code text contrast ${measured.code.toFixed(2)} >= 4.5 (code background ${measured.codeBackground})`,
      );
      if (measured.inline !== null) {
        check(
          measured.inline >= 4.5,
          `${name}: inline code contrast ${measured.inline.toFixed(2)} >= 4.5`,
        );
      }
      if (measured.spansMin !== null) {
        if (strict)
          check(
            measured.spansMin >= 4.5,
            `${name}: every highlighted token contrast ${measured.spansMin.toFixed(2)} >= 4.5`,
          );
        else if (measured.spansMin < 3)
          warn(
            `${name}: weakest highlighted token contrast is ${measured.spansMin.toFixed(2)} (< 3)`,
          );
      }
    }
    await setTheme('Default Dark Modern');
    assertNoWebviewErrors('themes');
  });

  await step(
    '5 permission: notification and badge with the view hidden, card, Always panel',
    async () => {
      // A fresh session. ASK_PERMISSION makes the synthetic server run the turn up to a `read` of
      // `.env` and a `permission.asked` (action read, `save: ["*"]` so the Always panel has its
      // option), and wait for the reply.
      check(await clickButton('New session'), 'New session starts a clean conversation');
      await waitEmptyView();
      await focusPromptBox();
      await page.keyboard.type(
        'Use the read tool to read the file .env in the workspace root and tell me its content. ASK_PERMISSION',
      );
      await page.keyboard.press('Enter');
      await waitFor(isBusy, 3_000, 100); // the prompt is on its way before the side bar is hidden
      // Hides the side bar so the chat view is not visible, with a mouse click on the title bar's
      // layout button: no key is sent while the focus is still in the prompt box. With Ctrl+B the
      // webview forwarded the key, the view was hidden under it and `press` never returned (647 s
      // on 27/10/2026, until VS Code was closed; on 28/10/2026 `--steps 0,1,2,3,5` hung there 1
      // time in 5; Engram #1333). The palette is no way out: its F1 also starts in the webview, and
      // `command('View: Toggle Primary Side Bar Visibility')` left the side bar visible in 8 runs
      // of 8 (28/10/2026). The click has a timeout, so a renamed button FAILs the step.
      await page
        .locator('.titlebar [aria-label^="Toggle Primary Side Bar"]')
        .first()
        .click({ timeout: 5_000 });
      await waitFor(async () => (await sideBarPx()) === 0, 3_000, 100);
      const toast = await waitFor(async () => {
        const toasts = page.locator('.notifications-toasts .notification-toast');
        return (await toasts.count())
          ? (await toasts.first().innerText()).replace(/\n/g, ' | ')
          : null;
      }, 30_000);
      check(
        toast !== undefined && toast !== null,
        `a notification appears with the view hidden ("${String(toast).slice(0, 100)}")`,
      );
      const badge = page.locator(
        '.activitybar .action-item:has([aria-label^="OpenCode"]) .badge-content',
      );
      // The badge paints a moment after the toast: read at once it was empty in 2 of 6 runs of
      // `--steps 5` on 28/10/2026, once the poll went from 500 to 150 ms (#89 phase 3).
      const badgeText =
        (await waitFor(
          async () => (await badge.allInnerTexts().catch(() => [])).join(','),
          5_000,
          100,
        )) ?? '';
      check(badgeText !== '', `the OpenCode activity bar item has a badge ("${badgeText}")`);
      await shot('05a-hidden-permission');
      const open = page
        .locator('.notifications-toasts .notification-toast a', { hasText: /open/i })
        .first();
      if (await open.count()) {
        await open.click();
      } else {
        warn('the notification has no "Open" link; showing the side bar with Ctrl+B');
        await page.keyboard.press('Control+b');
      }
      await openChat(30_000);
      const card = await waitFor(
        () => web.inDoc((doc) => doc.querySelector('.permission-card')?.innerText?.slice(0, 200)),
        20_000,
      );
      check(card !== undefined, 'the permission card is shown');
      const focused = await web.inDoc(
        (doc) =>
          doc.activeElement?.closest?.('.request-card') !== null &&
          doc.activeElement?.closest?.('.request-card') !== undefined,
      );
      check(focused === true, 'the focus is inside the request card');
      await shot('05b-card');

      check(await clickButton('Always allow…'), 'the first "Always allow…" press opens the panel');
      await waitFor(
        () => web.inDoc((doc) => doc.querySelector('.request-always') !== null),
        3_000,
        100,
      );
      const panel = await web.inDoc((doc) => ({
        open: doc.querySelector('.request-always') !== null,
        primaries: [...doc.querySelectorAll('.permission-card button.primary')].map((b) =>
          b.textContent.trim(),
        ),
      }));
      check(panel.open, 'the confirmation panel is open (nothing was saved by that press)');
      check(
        panel.primaries.length === 1 && panel.primaries[0] === 'Yes, always allow',
        `a single primary button while the panel is open (${panel.primaries.join(' | ')})`,
      );
      await shot('05c-always-panel');
      check(await clickButton('Back'), 'Back closes the panel');
      await waitFor(
        () => web.inDoc((doc) => doc.querySelector('.request-always') === null),
        3_000,
        100,
      );
      check(
        await web.inDoc((doc) => doc.querySelector('.request-always') === null),
        'the confirmation panel is closed after Back',
      );
      check(await clickButton('Allow once'), 'Allow once is pressed (never Always)');
      check(await waitIdle(30_000), 'the turn ends after Allow once');
      await waitFor(
        async () => (await badge.allInnerTexts().catch(() => ['x'])).join(',') === '',
        3_000,
        100,
      );
      const after = (await badge.allInnerTexts().catch(() => [])).join(',');
      check(after === '', `the badge is gone after answering ("${after}")`);
      // E3-resolved-history: the answer stays in the conversation, under the tool, not in the dock.
      const once = await outcomeLines();
      check(
        once.log.some((line) => /Allowed once/.test(line)),
        `the history says "Allowed once" under the tool (${JSON.stringify(once.log)})`,
      );
      check(
        !once.dock.some((line) => /Allowed once/.test(line)),
        'the dock no longer prints the answer of the open session',
      );
      check(once.alerts === 0, 'an answered permission is not an alert');
      await shot('05d-after-once');
      assertNoWebviewErrors('permission');
    },
  );

  await step('6 question card', async () => {
    // ASK_QUESTION makes the synthetic server call the `question` tool at once: a form with two
    // fields (q0 "Pick A or B", q1 "Any extras?"), as the real tool builds them.
    await waitIdle(30_000);
    await focusPromptBox();
    await page.keyboard.type(
      'Call the question tool now to ask me to pick one option: A or B. Then reply with the letter I picked. ASK_QUESTION',
    );
    await page.keyboard.press('Enter');
    const form = await waitFor(
      () => web.inDoc((doc) => doc.querySelector('.form-card')?.innerText?.slice(0, 200)),
      30_000,
    );
    check(form !== undefined, 'the question card is shown');
    if (form !== undefined) {
      const focused = await web.inDoc((doc) => doc.activeElement?.closest?.('.form-card') != null);
      check(focused === true, 'the focus is inside the question card');
      await shot('07a-question');
    }
    // A new prompt (the one of the question) does not erase the answer given in step 5.
    const afterPrompt = await outcomeLines();
    check(
      afterPrompt.log.some((line) => /Allowed once/.test(line)),
      `sending another prompt keeps the "Allowed once" line (${JSON.stringify(afterPrompt.log)})`,
    );
    if (form) {
      await web.inDoc((doc) => {
        const option = [
          ...doc.querySelectorAll(
            '.form-card input[type="radio"], .form-card input[type="checkbox"]',
          ),
        ].find((input) => (input.closest('label')?.textContent ?? '').trim() === 'B');
        option?.click();
        [...doc.querySelectorAll('.form-card button')]
          .find((b) => /submit/i.test(b.textContent))
          ?.click();
      });
      check(await waitIdle(30_000), 'the turn ends after answering');
      const gone = await web.inDoc((doc) => doc.querySelector('.form-card') === null);
      check(gone === true, 'the question card is gone after the answer');
      await waitFor(
        async () => (await outcomeLines()).log.some((line) => /Answered/.test(line)),
        3_000,
        100,
      );
      const answered = await outcomeLines();
      console.log(`  outcome lines: ${JSON.stringify(answered.log)}`);
      check(
        answered.log.some((line) => /Answered/.test(line) && /Letter: B\b/.test(line)),
        `the history says what was answered ("Answered … Letter: B"): ${JSON.stringify(answered.log)}`,
      );
      check(answered.dock.length === 0, 'the dock prints no result line for the open session');
      await shot('07b-answered');
    }
    assertNoWebviewErrors('question');
  });

  await step('6b a plain Reject is kept in the history, not painted as an error', async () => {
    await waitIdle(30_000);
    await focusPromptBox();
    await page.keyboard.type(
      'Use the read tool to read the file .env in the workspace root once more and tell me its content. ASK_PERMISSION',
    );
    await page.keyboard.press('Enter');
    const card = await waitFor(
      () => web.inDoc((doc) => doc.querySelector('.permission-card')?.innerText?.slice(0, 200)),
      30_000,
    );
    check(card !== undefined, 'the permission card is shown for the second read');
    if (card === undefined) {
      await shot('07c-reject-not-asked');
      return;
    }
    check(await clickButton('Reject'), 'Reject is pressed (the plain one, never Always)');
    check(await waitIdle(30_000), 'the turn ends after Reject');
    await waitFor(
      async () => (await outcomeLines()).log.some((line) => /Rejected/.test(line)),
      3_000,
      100,
    );
    const lines = await outcomeLines();
    check(
      lines.log.some((line) => /Rejected/.test(line) && !/feedback/.test(line)),
      `the history says "Rejected" under the tool: ${JSON.stringify(lines.log)}`,
    );
    check(
      lines.log.some((line) => /Allowed once/.test(line)),
      'the earlier "Allowed once" line is still there',
    );
    const painted = await web.inDoc((doc) => ({
      red: doc.querySelectorAll('.alert-error').length,
      alerts: doc.querySelectorAll('[role="alert"]').length,
      outcomeIsError: [...doc.querySelectorAll('.request-outcome')].some(
        (p) => p.matches('.alert, .alert-error') || p.closest('[role="alert"]') !== null,
      ),
    }));
    check(
      painted.red === 0 && painted.alerts === 0 && !painted.outcomeIsError,
      'a Reject is not an alert and not red',
    );
    await shot('07c-rejected');
    assertNoWebviewErrors('reject');
  });

  await step('7 Restart Server keeps the session', async () => {
    const before = await snapshotOfChat();
    const linesBefore = await outcomeLines();
    check(
      before.messages > 0,
      `there is a conversation to keep (${String(before.messages)} blocks, "${before.title}")`,
    );
    await command('OpenCode: Restart Server');
    // The connection leaves "connected" and comes back; if the change is too quick to be seen the
    // wait ends after 4 s and `waitConnected` below judges (HYPOTHESIS that it is seen, #89).
    await waitFor(
      () =>
        web.inDoc(
          (doc) => doc.querySelector('.app')?.getAttribute('data-connection') !== 'connected',
        ),
      4_000,
      100,
    );
    await openChat(40_000);
    await waitConnected();
    const afterRestart = await snapshotOfChat();
    check(
      afterRestart.messages === before.messages,
      `same number of message blocks after Restart Server (${String(before.messages)} -> ${String(afterRestart.messages)})`,
    );
    check(
      afterRestart.title === before.title,
      `same title after Restart Server ("${afterRestart.title}")`,
    );
    // The host (not the webview, not the server) remembers the exact decisions, and it survives.
    const linesAfter = await outcomeLines();
    check(
      linesBefore.log.length > 0 &&
        JSON.stringify(linesAfter.log) === JSON.stringify(linesBefore.log),
      `the answered-request lines are the same after Restart Server (${JSON.stringify(linesBefore.log)} -> ${JSON.stringify(linesAfter.log)})`,
    );
    await shot('08a-after-restart');
  });

  // E2 (issue #85) step 7b: the error card inside a conversation. A prompt with CRASH makes the
  // fixture exit mid-turn and leave its `.down` marker, so the relaunch fails (reconnecting, then
  // unavailable).
  await step('7b error card after a crash, with the history visible', async () => {
    const before = await snapshotOfChat();
    // After step 7 the keyboard focus is not in the webview (the first run of this step typed
    // "CRASH…" into a new untitled editor); take it into the prompt box and check before typing.
    await waitFor(() => web.inDoc((doc) => doc.querySelector('textarea') !== null), 5_000, 100);
    await focusPromptBox();
    const focused = await web.inDoc(
      (doc) => doc.activeElement?.tagName === 'TEXTAREA' && doc.hasFocus(),
    );
    check(focused === true, 'the prompt box has the keyboard focus before CRASH is typed');
    await send('CRASH the server now');
    const card = await waitFor(
      () =>
        web.inDoc(
          (doc) => doc.querySelector('[role="log"] .connection-card[role="alert"]') !== null,
        ),
      60_000,
      500,
    );
    check(card === true, 'the error card (role alert) is inside the conversation after a CRASH');
    const state = await web.inDoc((doc) => {
      const textarea = doc.querySelector('textarea');
      const send = [...doc.querySelectorAll('button')].find(
        (b) => b.getAttribute('aria-label') === 'Send',
      );
      return {
        messages: doc.querySelectorAll('[role="log"] .message').length,
        title: doc.querySelector('.connection-card .card-title')?.textContent,
        placeholder: textarea?.placeholder,
        editable: textarea !== null && !textarea.disabled && !textarea.readOnly,
        sendBlocked: send?.disabled === true || send?.getAttribute('aria-disabled') === 'true',
        guide: doc.querySelector('.setup-guide') !== null,
      };
    });
    check(
      state.messages > 0 && before.messages > 0,
      `the history is still visible (${String(state.messages)} messages)`,
    );
    check(
      state.title === 'opencode could not start',
      `the card title is "opencode could not start" (got "${String(state.title)}")`,
    );
    check(!state.guide, 'the setup guide does not replace a conversation');
    check(
      state.placeholder === 'Waiting for opencode…',
      `the box says "Waiting for opencode…" (got "${String(state.placeholder)}")`,
    );
    check(state.editable, 'the box stays editable without a connection');
    check(state.sendBlocked, 'Send is blocked without a connection');
    await shot('07b-card');
    await problemLayoutRounds(
      'card',
      {
        root: '.connection-card',
        text: '.connection-card .card-text',
        actions: '.connection-card .card-actions',
      },
      { title: '.connection-card .card-title', cause: '.connection-card .card-cause' },
    );

    fs.rmSync(vscode.downMarker, { force: true });
    check(await clickButton('Restart'), 'Restart on the card is pressed with the real mouse');
    await waitConnected(60_000);
    const after = await snapshotOfChat();
    const cardLeft = await web.inDoc((doc) => doc.querySelector('.connection-card') !== null);
    check(!cardLeft, 'the card is gone once connected');
    check(
      after.title === before.title,
      `the same session is open after the restart ("${after.title}")`,
    );
    assertNoWebviewErrors('error card');
  });

  await step('8 Reload Window keeps the session', async () => {
    const preReload = await snapshotOfChat();
    const linesPreReload = await outcomeLines();
    const hadRejected = linesPreReload.log.some((line) => /Rejected/.test(line));
    const hadAnswered = linesPreReload.log.some((line) => /Answered/.test(line));
    // A mark on the OLD page: the reloaded workbench is the first page without it.
    await page.evaluate(() => {
      globalThis.__visualPreReload = true;
    });
    await command('Developer: Reload Window');
    web?.close();
    await browser.close().catch(() => undefined);
    let reloaded = false;
    for (let tries = 0; tries < 120 && !reloaded; tries++) {
      await connectWorkbench(90_000);
      const stale = await page
        .evaluate(() => globalThis.__visualPreReload === true)
        .catch(() => true);
      reloaded = !stale;
      if (reloaded) break;
      await browser.close().catch(() => undefined);
      await sleep(250); // between two attempts to reach the new page, not a fixed wait for it
    }
    // Only the old page was reachable: every check below would judge it, not a reloaded workbench.
    if (!reloaded) throw new Error('Reload Window did not produce a new workbench page');
    let opened = true;
    try {
      await openChat(8_000);
    } catch {
      opened = false;
    }
    if (!opened) {
      await page
        .locator('.activitybar [aria-label^="OpenCode"]')
        .first()
        .click()
        .catch(() => undefined);
      await openChat(60_000);
    }
    await waitConnected();
    await waitFor(async () => (await snapshotOfChat()).messages === preReload.messages, 5_000, 100);
    const afterReload = await snapshotOfChat();
    check(
      afterReload.messages === preReload.messages,
      `same number of message blocks after Reload Window (${String(preReload.messages)} -> ${String(afterReload.messages)})`,
    );
    check(
      afterReload.title === preReload.title,
      `same title after Reload Window ("${afterReload.title}")`,
    );
    // Reload Window kills the extension host and with it the memory of exact decisions (decision of
    // Sergio, 21/10/2026: nothing is persisted). What the tool blocks say survives, and it comes
    // from REST `message.list`. Against the synthetic server this only proves the host's side of
    // that path: that REST returns the same `content[]` as a real database was checked against a
    // real opencode before this run moved to the fixture (see the header). "Allowed once" is
    // ASSERTED gone, so the documented limit cannot change silently.
    const linesAfterReload = await outcomeLines();
    check(
      !linesAfterReload.log.some((line) => /Allowed once|Always allowed/.test(line)),
      `after Reload Window "Allowed once" is gone (the server keeps no trace): ${JSON.stringify(linesAfterReload.log)}`,
    );
    check(hadAnswered, 'there was an "Answered" line before the reload to read back');
    check(
      linesAfterReload.log.some((line) => /Answered/.test(line) && /Letter: B\b/.test(line)),
      `after Reload Window "Answered … Letter: B" is read back from the tool block: ${JSON.stringify(linesAfterReload.log)}`,
    );
    check(hadRejected, 'there was a "Rejected" line before the reload to read back');
    check(
      linesAfterReload.log.some((line) => /Rejected/.test(line)),
      `after Reload Window "Rejected" is read back from the tool block: ${JSON.stringify(linesAfterReload.log)}`,
    );
    await shot('09-after-reload');
    assertNoWebviewErrors('reload');
  });

  await step('9 sessions: list, search, rename, switch, delete (issue #20)', async () => {
    /** What the open session list shows, and where the focus is. Self-contained (it is serialized). */
    const picker = () =>
      web.inDoc((doc) => ({
        open: doc.querySelector('.session-picker') !== null,
        rows: [...doc.querySelectorAll('.session-row')].map((li) => ({
          title: li.querySelector('.session-title')?.textContent ?? '',
          time: li.querySelector('.session-time')?.textContent ?? '',
          badge: li.querySelector('.session-badge')?.textContent ?? '',
          current: li.querySelector('.session-main')?.getAttribute('aria-current') === 'true',
        })),
        groups: [...doc.querySelectorAll('.session-group-title')].map((e) => e.textContent),
        status: doc.querySelector('.session-status')?.textContent ?? '',
        // The polite live region: "Loading sessions…" while a query is in flight, then the count.
        // The only place that says "loading" when old rows are still on screen.
        live: (doc.querySelector('.session-picker [role="status"]')?.textContent ?? '').trim(),
        focus: {
          tag: doc.activeElement?.tagName ?? '',
          type: doc.activeElement?.getAttribute?.('type') ?? '',
          cls: doc.activeElement?.className ?? '',
          text: (doc.activeElement?.textContent ?? '').trim().slice(0, 40),
          visible: doc.activeElement?.matches?.(':focus-visible') ?? false,
        },
        title: doc.querySelector('.chat-title')?.textContent ?? '',
        suggestions: doc.querySelectorAll('.suggestion').length,
        messages: doc.querySelectorAll('[role="log"] > *').length,
        notices: (doc.body.innerText ?? '').includes('deleted outside'),
      }));
    /** Opens the list with a real click on "Sessions" and waits for its first page. */
    const openList = async () => {
      if ((await picker()).open) return true;
      const clicked = await clickButton('Sessions');
      // Loaded = the live region has left "Loading sessions…" (old rows may be on screen already,
      // from an earlier opening, so the rows alone say nothing about the NEW page).
      const loaded = await waitFor(async () => {
        const state = await picker();
        return state.open && state.live !== '' && !/^Loading/.test(state.live);
      }, 20_000);
      return clicked && loaded === true;
    };
    /** Closes the list with a real Escape (the focus is inside it). */
    const closeList = async () => {
      await page.keyboard.press('Escape');
      await sleep(300); // a short settle: the callers read the list state or reopen it next
    };
    /** Waits until `predicate(await picker())` holds. */
    const until = (predicate, ms = 15_000) =>
      waitFor(async () => predicate(await picker()), ms, 300);

    check(await openList(), 'the Sessions button opens the list');
    let state = await picker();
    check(
      state.rows.length >= 1,
      `the list shows the sessions of the folder (${String(state.rows.length)})`,
    );
    check(
      state.groups.includes('Today'),
      `rows are grouped by date (${JSON.stringify(state.groups)})`,
    );
    check(
      state.rows.every((row) => row.time !== ''),
      'every row carries its time',
    );
    check(
      state.rows.filter((row) => row.current).length === 1,
      'exactly one row is marked as the open session (aria-current)',
    );
    check(
      state.focus.tag === 'INPUT' && state.focus.type === 'search',
      `the focus is in the search box on opening (${state.focus.tag} ${state.focus.type})`,
    );
    const countBefore = state.rows.length;
    for (const [name, theme] of [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ]) {
      await setTheme(theme);
      await shot(`10a-sessions-${name}`);
      const marker = await web.inDoc((doc) => {
        const row = doc.querySelector('.session-row.current');
        if (!row) return null;
        const style = doc.defaultView.getComputedStyle(row);
        return {
          bar: style.borderLeftColor,
          outline: style.outlineStyle,
          background: style.backgroundColor,
        };
      });
      const hc = name.startsWith('hc');
      check(
        marker !== null &&
          (hc ? marker.outline !== 'none' : marker.bar !== 'rgba(0, 0, 0, 0)' && marker.bar !== ''),
        `${name}: the open session has a visible marker (${JSON.stringify(marker)})`,
      );
    }
    await setTheme('Default Dark Modern');

    // Keyboard: ArrowDown from the search box enters the list, with a visible focus ring.
    await openList();
    await clickIn('input[type="search"]');
    await page.keyboard.press('ArrowDown');
    state = await picker();
    // Not the whole `focus` object: its `text` holds the row's clock time, which differs per run.
    check(
      state.focus.cls.includes('session-main') && state.focus.visible,
      `ArrowDown enters the list with a visible focus (${state.focus.tag} ${state.focus.cls}, visible ${String(state.focus.visible)})`,
    );
    await shot('10b-sessions-keyboard');
    await closeList();
    state = await picker();
    check(!state.open, 'Escape closes the list');
    check(
      state.focus.tag === 'BUTTON' && state.focus.text === 'Sessions',
      `Escape returns the focus to the Sessions button (${JSON.stringify(state.focus)})`,
    );

    // "New session" is lazy: it empties the view and creates NOTHING until the first prompt.
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();
    state = await picker();
    check(
      state.suggestions >= 3 && state.title === 'Untitled session',
      `New session leaves the empty view (${String(state.suggestions)} suggestions, "${state.title}")`,
    );
    await openList();
    state = await picker();
    check(
      state.rows.length === countBefore,
      `New session created no session (${String(countBefore)} -> ${String(state.rows.length)})`,
    );
    check(
      state.rows.every((row) => !row.current),
      'no session is marked as open after New session',
    );
    await closeList();

    // The first prompt creates the session.
    // A fixed token: the profile and the fixture's state are wiped at the start of every run, so
    // it is unique anyway, and the `ok` lines that quote it read the same in every run.
    const token = 'vrvisual';
    // LONG: the turn lasts about 16 s, so the list opens while it is running.
    await send(`Reply with exactly: ${token}. Do not use any tools. LONG`);
    await waitFor(isBusy, 5_000, 100);
    const busyNow = await isBusy();
    check(busyNow === true, 'the turn is still running when the session list is opened');
    await openList();
    state = await picker();
    check(
      state.rows.length === countBefore + 1,
      `the first prompt created the session (${String(countBefore)} -> ${String(state.rows.length)})`,
    );
    const running = state.rows.find((row) => row.current);
    check(
      running !== undefined && /Running/.test(running.badge),
      `a running session says "Running" in text (${JSON.stringify(running?.badge)})`,
    );
    await shot('10c-sessions-running');
    await closeList();
    check(await waitIdle(60_000), 'the second session finished');

    // Rename in line, with the real mouse and keyboard.
    const renamed = `Visual ${token}`;
    await openList();
    check(await clickIn('.session-row.current .session-action'), 'the Rename button is pressed');
    await waitPresent('.session-rename-input');
    check(
      (await web.inDoc((doc) => doc.activeElement?.classList.contains('session-rename-input'))) ===
        true,
      'the title becomes an input with the focus',
    );
    await shot('10d-sessions-renaming');
    await page.keyboard.type(renamed);
    await page.keyboard.press('Enter');
    const renamedOk = await until(
      (s) => s.rows.some((row) => row.current && row.title === renamed) && s.title === renamed,
    );
    check(
      renamedOk === true,
      `the row AND the header show the new title ("${(await picker()).title}")`,
    );
    await shot('10e-sessions-renamed');

    // Search happens on the server: only the renamed session matches.
    await clickIn('input[type="search"]');
    await page.keyboard.type(token.toUpperCase());
    const found = await until((s) => s.rows.length === 1 && s.rows[0].title === renamed);
    check(
      found === true,
      `the search finds only the renamed session, case-insensitively (${JSON.stringify((await picker()).rows.map((r) => r.title))})`,
    );
    await shot('10f-sessions-search');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    const cleared = await until((s) => s.rows.length >= countBefore + 1);
    check(cleared === true, 'clearing the search brings the whole list back');

    // Switch to the other session by clicking its row.
    state = await picker();
    const other = state.rows.find((row) => !row.current && row.title !== renamed);
    check(other !== undefined, 'there is another session to switch to');
    if (other !== undefined) {
      await web.inDoc((doc, title) => {
        const row = [...doc.querySelectorAll('.session-row')].find(
          (li) => li.querySelector('.session-title')?.textContent === title,
        );
        row?.querySelector('.session-main')?.setAttribute('data-visual-pick', 'true');
      }, other.title);
      check(await clickRowMain('[data-visual-pick="true"]'), 'the other session is clicked');
      const switched = await until((s) => !s.open && s.title === other.title, 20_000);
      check(
        switched === true,
        `choosing a session opens it and closes the list ("${(await picker()).title}")`,
      );
      state = await picker();
      check(
        state.messages > 0,
        `the other conversation is shown (${String(state.messages)} blocks)`,
      );
      await shot('10g-sessions-switched');
    }

    // Back to the renamed one, then delete it: the host asks with a native modal.
    await openList();
    await web.inDoc((doc, title) => {
      const row = [...doc.querySelectorAll('.session-row')].find(
        (li) => li.querySelector('.session-title')?.textContent === title,
      );
      row?.querySelector('.session-main')?.setAttribute('data-visual-pick', 'true');
    }, renamed);
    // The row actions are laid over its right end (opacity 0 still takes the click), so the CENTRE
    // of a narrow row lands on "Rename": a 9 px scrollbar did it once (issue #21) and a 1080 px
    // wide window does it without any scrollbar (27/10/2026). `clickRowMain` aims left of the
    // actions and throws when it cannot; the overflow check stays because a scrollbar still
    // changes the layout the rest of the step measures.
    const overflowPx = await web.inDoc(
      (doc) => doc.documentElement.scrollHeight - doc.documentElement.clientHeight,
    );
    check(overflowPx <= 0, `the document has no vertical overflow (${String(overflowPx)} px)`);
    await clickRowMain('[data-visual-pick="true"]');
    await until((s) => !s.open && s.title === renamed, 20_000);
    await openList();
    const dialog = page.locator('.monaco-dialog-box');
    const askDelete = async () => {
      check(
        await clickIn('.session-row.current .session-action[aria-label^="Delete"]'),
        'Delete is pressed',
      );
      return waitFor(
        async () => ((await dialog.count()) ? await dialog.first().innerText() : null),
        10_000,
        300,
      );
    };
    let modal = await askDelete();
    check(
      modal !== undefined && modal !== null,
      `a modal dialog of VS Code asks for confirmation (${String(modal).replace(/\s+/g, ' ').slice(0, 160)})`,
    );
    if (modal === undefined || modal === null) {
      await shot('10h-FAIL-no-modal');
      throw new Error(
        'the confirmation modal never appeared as DOM (window.dialogStyle custom): see PREGUNTA PENDIENTE',
      );
    }
    check(modal.includes(renamed), 'the modal names the session');
    check(/cannot be undone/i.test(modal), 'the modal says it cannot be undone');
    await shot('10h-sessions-delete-modal');
    // Declining deletes nothing.
    await dialog
      .first()
      .getByRole('button', { name: /^Cancel$/ })
      .click();
    // A declined dialog changes nothing, so there is no positive signal: a fixed window for the
    // check below, which asserts that nothing was deleted.
    await page.waitForTimeout(800);
    state = await picker();
    check(
      state.rows.some((row) => row.title === renamed) && state.title === renamed,
      'Cancel keeps the session and its conversation',
    );
    check(
      state.rows.every((row) => row.badge === ''),
      `the row unlocks after a declined delete (${JSON.stringify(state.rows.map((r) => r.badge))})`,
    );
    // Confirming deletes it and empties the view.
    modal = await askDelete();
    check(modal !== undefined && modal !== null, 'the modal appears again');
    await dialog
      .first()
      .getByRole('button', { name: /^Delete$/ })
      .click();
    const gone = await until(
      (s) => !s.rows.some((row) => row.title === renamed) && s.suggestions >= 3,
      20_000,
    );
    state = await picker();
    check(gone === true, 'the deleted session leaves the list and the view is empty');
    check(
      state.title === 'Untitled session',
      `the header is back to "Untitled session" ("${state.title}")`,
    );
    check(!state.notices, 'deleting from here does not announce "deleted outside"');
    check((await dialog.count()) === 0, 'the dialog is closed');
    await shot('10i-sessions-deleted');
    // The native dialog took the keyboard focus out of the page: click into the list first.
    await clickIn('input[type="search"]');
    await closeList();
    state = await picker();
    check(
      state.focus.tag === 'BUTTON' && state.focus.text === 'Sessions',
      `Escape returns the focus to the Sessions button again (${JSON.stringify(state.focus)})`,
    );
    assertNoWebviewErrors('sessions');
  });

  await step('10 fork and subagent sessions (issue #21)', async () => {
    /** What the chat shows about the open conversation. Self-contained (it is serialized). */
    const chat = () =>
      web.inDoc((doc) => {
        const bar = (article) => article.querySelector('.message-actions');
        const users = [...doc.querySelectorAll('[role="log"] .message-user')];
        const active = doc.activeElement;
        return {
          blocks: doc.querySelectorAll('[role="log"] > *').length,
          users: users.map((u) => (u.querySelector('.part-text')?.textContent ?? '').trim()),
          bars: users.map((u) =>
            bar(u) ? doc.defaultView.getComputedStyle(bar(u)).opacity : 'none',
          ),
          forkNames: users.map(
            (u) => u.querySelector('.message-action')?.getAttribute('aria-label') ?? '',
          ),
          title: doc.querySelector('.chat-title')?.textContent ?? '',
          path: doc.querySelector('nav[aria-label="Session path"]')?.textContent ?? '',
          pathButton: doc.querySelector('nav[aria-label="Session path"] button') !== null,
          children: doc.querySelector('details.subagent-sessions > summary')?.textContent ?? '',
          draft: doc.querySelector('textarea')?.value ?? '',
          focus: {
            tag: active?.tagName ?? '',
            cls: active?.className ?? '',
            visible: active?.matches?.(':focus-visible') ?? false,
          },
          subagentLinks: doc.querySelectorAll('.subagent-link').length,
          // Issue #26: the line is the accessible name of the card's toggle ("Subagent Say hello (general) · done").
          subagentLine:
            doc.querySelector('.part-subagent .tool-toggle')?.getAttribute('aria-label') ?? '',
          alerts: doc.querySelectorAll('[role="alert"]').length,
        };
      });
    /** Tags the Nth (1-based) user message of the log so the real mouse can find it. */
    const tagUser = (nth) =>
      web.inDoc((doc, n) => {
        for (const old of doc.querySelectorAll('[data-visual-msg]')) {
          old.removeAttribute('data-visual-msg');
        }
        const users = [...doc.querySelectorAll('[role="log"] .message-user')];
        users[n - 1]?.setAttribute('data-visual-msg', 'true');
        return users.length;
      }, nth);
    /** Moves the real mouse to the centre of the first element matching `selector`. */
    const hover = async (selector) => {
      const point = await centreOf(selector);
      if (point) await page.mouse.move(point.x, point.y);
      await sleep(300); // hover styles and tooltips appear after a delay of their own
      return point !== null;
    };

    // --- Fork from the second user message ---------------------------------------------------
    // Step 9 left the view empty (its session was deleted): the first prompt creates a session.
    const ONE = 'Reply with exactly: ONE. Do not use any tools.';
    const TWO = 'Reply with exactly: TWO. Do not use any tools.';
    await send(ONE);
    check(await waitIdle(30_000), 'the first turn of the fork run finished');
    await send(TWO);
    check(await waitIdle(30_000), 'the second turn of the fork run finished');
    let state = await chat();
    check(
      state.users.length === 2 && state.users[1].includes('TWO'),
      `the original session has the two prompts (${JSON.stringify(state.users)})`,
    );
    check(
      state.forkNames.every((name) => name.startsWith('Fork from here: Reply with exactly')),
      `each user message has a "Fork from here" named after it (${JSON.stringify(state.forkNames)})`,
    );
    check(
      (await web.inDoc(
        (doc) => doc.querySelectorAll('.message-assistant .message-action').length,
      )) === 0,
      'assistant messages have no fork button',
    );
    const originalBlocks = state.blocks;
    // Not the title: the model names the session some seconds after its first answer, so a title
    // read now can differ from the one read after navigating (seen in a run of 21/10/2026).

    // Hover shows the bar of that message only (opacity, so Tab can still reach it).
    await tagUser(2);
    check(await hover('textarea'), 'the mouse rests away from the messages');
    state = await chat();
    check(
      state.bars.every((opacity) => opacity === '0'),
      `no action bar is visible without hover or focus (${JSON.stringify(state.bars)})`,
    );
    check(await hover('[data-visual-msg="true"]'), 'the mouse is over the second user message');
    state = await chat();
    check(
      state.bars[1] === '1' && state.bars[0] === '0',
      `hovering a message shows ITS bar only (${JSON.stringify(state.bars)})`,
    );
    await shot('11a-fork-hover');

    // Keyboard: click the text, Tab lands on that message's button, with a visible ring and bar.
    await hover('textarea');
    check(
      await clickIn('[data-visual-msg="true"] .part-text'),
      'the text of the message is clicked',
    );
    await page.keyboard.press('Tab');
    state = await chat();
    check(
      state.focus.tag === 'BUTTON' && state.focus.cls.includes('message-action'),
      `Tab reaches "Fork from here" (${JSON.stringify(state.focus)})`,
    );
    check(state.focus.visible, 'the focused fork button shows a focus ring');
    check(state.bars[1] === '1', 'focusing the button shows its bar without hover');
    await hover('textarea');
    await shot('11b-fork-focus');

    // Fork with the real mouse.
    await web.inDoc((doc) => {
      doc
        .querySelector('[data-visual-msg="true"] .message-action')
        ?.setAttribute('data-visual-fork', 'true');
    });
    check(await clickIn('[data-visual-fork="true"]'), '"Fork from here" is pressed');
    const forked = await waitFor(async () => (await chat()).path.startsWith('Forked from'), 20_000);
    state = await chat();
    check(forked === true, `the fork opened and the header says where from ("${state.path}")`);
    check(
      state.users.length === 1 && state.users[0].includes('ONE'),
      `the fork holds only the history BEFORE the message (${JSON.stringify(state.users)})`,
    );
    check(state.pathButton, 'the "Forked from" crumb is a button');
    check(
      state.draft === TWO,
      `the prompt is refilled with the text of the forked message ("${state.draft}")`,
    );
    check(
      state.focus.tag === 'TEXTAREA',
      `the prompt has the focus after the fork (${JSON.stringify(state.focus)})`,
    );
    check(state.alerts === 0, 'forking raised no alert');
    for (const [name, theme] of [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ]) {
      await setTheme(theme);
      await tagUser(1);
      await hover('[data-visual-msg="true"]');
      await shot(`11c-fork-${name}`);
      const look = await web.inDoc((doc) => {
        const link = doc.querySelector('nav[aria-label="Session path"] button');
        const bar = doc.querySelector('[data-visual-msg="true"] .message-actions');
        return {
          link: link ? doc.defaultView.getComputedStyle(link).color : '',
          bar: bar ? doc.defaultView.getComputedStyle(bar).opacity : '',
        };
      });
      check(
        look.link !== '' && look.bar === '1',
        `${name}: the crumb and the hovered action bar render (${JSON.stringify(look)})`,
      );
    }
    await setTheme('Default Dark Modern');

    // The fork is a root session: it is in the list with the word "Fork"; the original is intact.
    await clickButton('Sessions');
    const listed = await waitFor(
      () =>
        web.inDoc((doc) => {
          const live = doc.querySelector('.session-picker [role="status"]')?.textContent ?? '';
          return (
            doc.querySelector('.session-picker') !== null &&
            live.trim() !== '' &&
            !/^Loading/.test(live.trim())
          );
        }),
      20_000,
      300,
    );
    check(listed === true, 'the session list opened');
    const badges = await web.inDoc((doc) =>
      [...doc.querySelectorAll('.session-row')].map(
        (li) => li.querySelector('.session-badge')?.textContent ?? '',
      ),
    );
    check(
      badges.some((badge) => badge.includes('Fork')),
      `the fork is listed with the word "Fork" (${JSON.stringify(badges)})`,
    );
    await shot('11d-fork-in-list');
    await page.keyboard.press('Escape');
    await sleep(300); // a short settle: the list closing is read by the next check

    // "Forked from ..." goes back to the original, which still has both exchanges.
    check(
      await clickIn('nav[aria-label="Session path"] button'),
      'the "Forked from" crumb is pressed',
    );
    const back = await waitFor(async () => {
      const now = await chat();
      return now.path === '' && now.users.length === 2;
    }, 20_000);
    state = await chat();
    check(
      back === true && state.users.length === 2 && state.blocks === originalBlocks,
      `the crumb opens the original, intact (${String(state.blocks)} of ${String(originalBlocks)} blocks, ${String(state.users.length)} prompts)`,
    );
    assertNoWebviewErrors('fork');

    // --- Subagent session ---------------------------------------------------------------------
    // SUBAGENT makes the synthetic server call the `subagent` tool: it creates a child session
    // ("Say hello", agent general) and answers inside it, as the spike of #21 saw.
    check(await clickButton('New session'), 'New session is pressed for the subagent run');
    await waitEmptyView();
    await send(
      'Call the subagent tool exactly once with agent "general", description "Say hello" and ' +
        'prompt "Reply with exactly: HELLO". After it returns, reply with exactly: DONE. SUBAGENT',
    );
    check(await waitIdle(30_000), 'the subagent turn finished');
    state = await chat();
    check(
      state.subagentLinks > 0,
      `the conversation has an "Open subagent session" link (${String(state.subagentLinks)})`,
    );
    if (state.subagentLinks === 0) {
      await shot('11e-subagent-missing');
      return;
    }
    check(
      state.subagentLine.startsWith('Subagent'),
      `the tool block reads as a subagent line ("${state.subagentLine}")`,
    );
    await shot('11e-subagent-link');
    check(await clickButton('Open subagent session'), '"Open subagent session" is pressed');
    const inChild = await waitFor(async () => (await chat()).path.startsWith('‹'), 20_000);
    state = await chat();
    check(inChild === true, `the child shows the crumb "‹ parent" ("${state.path}")`);
    check(state.pathButton, 'the parent crumb is a button');
    check(state.users.length >= 1, 'the child conversation is shown');
    await shot('11f-subagent-child');
    // Screenshot-only loop: dark by default, light and hc-light with `--all-themes`.
    for (const [name, theme] of captureThemes([
      ['light', 'Default Light Modern'],
      ['hc-light', 'Default High Contrast Light'],
    ])) {
      await setTheme(theme);
      await shot(`11g-subagent-child-${name}`);
    }
    await setTheme('Default Dark Modern');
    check(await clickIn('nav[aria-label="Session path"] button'), 'the parent crumb is pressed');
    const backToParent = await waitFor(async () => {
      const now = await chat();
      return now.path === '' && now.subagentLinks > 0;
    }, 20_000);
    state = await chat();
    check(backToParent === true, `the crumb returns to the parent ("${state.title}")`);
    check(
      state.children === 'Subagent sessions (1)',
      `the parent lists its subagent session ("${state.children}")`,
    );
    // The list opens with the keyboard-native <details> and its button opens the child.
    check(
      await clickIn('details.subagent-sessions > summary'),
      'the "Subagent sessions" summary is pressed',
    );
    await waitPresent('details.subagent-sessions[open] .subagent-child');
    await shot('11h-subagent-list');
    check(await clickIn('.subagent-child'), 'the child in the list is pressed');
    const again = await waitFor(async () => (await chat()).path.startsWith('‹'), 20_000);
    check(again === true, 'the list opens the same child session');
    assertNoWebviewErrors('subagent');
  });

  // Issues #23/#24. The LAST step on purpose: steps 1-10 ran with the fixture's default model and
  // the default agent, because the profile (and so `globalState` and the setting) is wiped at start.
  //
  // E2 (#85, phase 3): rewritten on the combined chip "agent · model ▾" (the Build | Plan switch,
  // "More agents" and the model button are gone). It was not run in phase 3 (decision of Sergio,
  // Engram #1303); its first full run was the one at the end of phase 4 (27/10/2026, Windows 11,
  // VS Code 1.143.1), which passed.
  await step('11 agent and model chip (issues #23/#24, E2 #85)', async () => {
    /** What the prompt bar and the chip's panel show. Self-contained (it is serialized). */
    const ui = () =>
      web.inDoc((doc) => {
        const trigger = doc.querySelector('button.agent-model-chip');
        const parts = (trigger?.textContent ?? '').split(' · ');
        const active = doc.activeElement;
        const app = doc.querySelector('.app');
        const columns = [...doc.querySelectorAll('.agent-model-panel .menu-column')];
        const appStyle = app ? doc.defaultView.getComputedStyle(app) : null;
        const metas = [...doc.querySelectorAll('.message-assistant .message-meta')];
        return {
          trigger: trigger?.textContent ?? '',
          triggerName: trigger?.getAttribute('aria-label') ?? '',
          expanded: trigger?.getAttribute('aria-expanded') ?? '',
          // The chip names the agent and the model, not their ids: "Plan · GLM-5.3-Flash Free".
          agent: parts[0] ?? '',
          model: parts[1] ?? '',
          dot: doc.querySelector('.agent-model-chip .conn-dot')?.getAttribute('data-state') ?? '',
          panel: doc.querySelector('.agent-model-panel') !== null,
          groups: [...doc.querySelectorAll('.agent-model-panel .model-group > h3')].map(
            (h) => h.textContent ?? '',
          ),
          agents: [...doc.querySelectorAll('.agent-model-panel [data-group="agent"] button')].map(
            (b) => ({
              id: b.getAttribute('data-agent') ?? '',
              current: b.getAttribute('aria-current') === 'true',
            }),
          ),
          options: [...doc.querySelectorAll('.agent-model-panel button[data-model]')].map((b) => ({
            id: b.getAttribute('data-model') ?? '',
            name: b.querySelector('.model-name')?.textContent ?? '',
            current: b.getAttribute('aria-current') === 'true',
          })),
          live: (doc.querySelector('.agent-model-panel [role="status"]')?.textContent ?? '').trim(),
          panelTop: doc.querySelector('.agent-model-panel')?.getBoundingClientRect().top ?? null,
          // Columns side by side from 360 px of container, stacked below it (`@container`).
          stacked:
            columns.length === 2 &&
            columns[1].getBoundingClientRect().top > columns[0].getBoundingClientRect().bottom - 1,
          containerWidth:
            app && appStyle
              ? app.clientWidth -
                Number.parseFloat(appStyle.paddingLeft) -
                Number.parseFloat(appStyle.paddingRight)
              : null,
          focus: {
            tag: active?.tagName ?? '',
            cls: active?.className ?? '',
            aria: active?.getAttribute?.('aria-label') ?? '',
            agentRow: active?.getAttribute?.('data-agent') ?? '',
            visible: active?.matches?.(':focus-visible') ?? false,
            ring: active ? doc.defaultView.getComputedStyle(active).outlineStyle : '',
          },
          lastMeta: metas.at(-1)?.textContent ?? '',
          metas: metas.length,
          blocks: doc.querySelectorAll('[role="log"] > *').length,
          headerHasMarker: doc.querySelector('header .model-marker') !== null,
          draft: doc.querySelector('textarea')?.value ?? '',
          alerts: doc.querySelectorAll('[role="alert"]').length,
          text: doc.body.innerText,
        };
      });
    const press = async (key) => {
      await page.keyboard.press(key);
      await sleep(250); // the key reaches the webview through the workbench asynchronously; some keys expect "nothing changes"
    };
    const THEMES = [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ];

    // --- A new session proposes the default agent and the server's default model --------------
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();
    let state = await ui();
    check(state.agent === 'Build', `a new session starts on Build (got "${state.agent}")`);
    check(
      state.triggerName.startsWith(`Agent and model: ${state.trigger} (`) &&
        state.triggerName.endsWith('(Connected)') &&
        state.dot === 'connected',
      `the chip names agent and model and says the connection ("${state.triggerName}", dot "${state.dot}")`,
    );
    check(!state.trigger.includes('(default)'), 'the chip does not write "(default)"');
    check(!state.headerHasMarker, 'the header no longer has the Agent · model marker');
    await shot('12a-prompt-row');

    // --- The panel: focus on the current agent, columns, groups, the four themes ----------------
    check(await clickIn('button.agent-model-chip'), 'the chip is pressed');
    await waitPresent('.agent-model-panel');
    state = await ui();
    check(state.panel && state.expanded === 'true', 'the chip panel opened');
    check(
      state.focus.agentRow === 'build',
      `the focus is on the current agent, Build (${JSON.stringify(state.focus)})`,
    );
    check(
      state.agents.length >= 2 &&
        state.agents.filter((a) => a.current).length === 1 &&
        state.agents.some((a) => a.id === 'plan') &&
        state.agents.some((a) => a.id === 'docs'),
      `the Agent column lists Build, Plan and the custom agent, one current (${JSON.stringify(state.agents)})`,
    );
    check(
      state.containerWidth !== null && state.stacked === state.containerWidth < 360,
      `the columns are ${state.stacked ? 'stacked' : 'side by side'} at ${String(state.containerWidth)} px of container (stacked only under 360)`,
    );
    check(
      state.groups.length >= 1 && state.options.length >= 1,
      `the models are grouped by provider (${JSON.stringify(state.groups)}, ${String(state.options.length)} models)`,
    );
    check(
      state.options.filter((o) => o.current).length === 1,
      'exactly one model is marked as the current one',
    );
    check(
      state.panelTop !== null && state.panelTop >= 0,
      `the panel is inside the view (top ${String(state.panelTop)})`,
    );
    check(
      // eslint-disable-next-line no-irregular-whitespace -- the next line strips a literal no-break space
      /^\d+ models?$/.test(state.live.replace(/ /g, '')),
      `the live region counts the models ("${state.live}")`,
    );
    // Screenshot-only loops (12b, 12d, 12f, 14b, 14d): dark by default, four themes with `--all-themes`.
    for (const [name, theme] of captureThemes(THEMES)) {
      await setTheme(theme);
      await shot(`12b-chip-panel-${name}`);
    }
    await setTheme('Default Dark Modern');

    // --- Filter and pick with the keyboard -----------------------------------------------------
    const options = state.options;
    const target = options.find((o) => !o.current);
    check(target !== undefined, 'the server lists a model other than the current one to pick');
    if (target === undefined) {
      await press('Escape');
      return;
    }
    // The focus starts on the agent, so the mouse takes it to the search box, as a user would.
    check(await clickIn('.agent-model-panel input[type="search"]'), 'the search box is pressed');
    await page.keyboard.type(target.name);
    // The search box holds the typed name AND the list got shorter. An expired wait just falls
    // through: the check below judges the list (it stays strict about "at least one, no more").
    await waitFor(
      async () =>
        (await web.inDoc(
          (doc) => doc.querySelector('.agent-model-panel input[type="search"]')?.value ?? '',
        )) === target.name && (await ui()).options.length < options.length,
      3_000,
      100,
    );
    state = await ui();
    check(
      state.options.length >= 1 && state.options.length <= options.length,
      `typing the name filters the list (${String(options.length)} -> ${String(state.options.length)})`,
    );
    check(
      state.options.some((o) => o.id === target.id),
      'the typed model is still listed',
    );
    await press('ArrowDown');
    state = await ui();
    check(
      state.focus.cls.includes('model-option') && state.focus.visible,
      `ArrowDown enters the list with a visible focus (${JSON.stringify(state.focus)})`,
    );
    const chosen = state.options[0];
    await press('Enter');
    state = await ui();
    check(
      state.panel && state.expanded === 'true',
      'choosing a model leaves the panel open (decision of 01/11/2026)',
    );
    check(
      state.model === chosen.name,
      `the chip shows the chosen model ("${state.trigger}" for "${chosen.name}")`,
    );
    check(
      state.focus.cls.includes('model-option'),
      `the focus stays on the chosen model row (${JSON.stringify(state.focus)})`,
    );
    await press('Escape');
    state = await ui();
    check(
      !state.panel && state.focus.cls.includes('agent-model-chip'),
      `Escape closes it after choosing and the focus returns to the chip (${JSON.stringify(state.focus)})`,
    );

    // --- Escape closes without choosing ---------------------------------------------------------
    check(await clickIn('button.agent-model-chip'), 'the chip is pressed again');
    await waitPresent('.agent-model-panel');
    state = await ui();
    check(
      state.panel && state.focus.agentRow === 'build',
      'the panel reopened with the focus on the current agent',
    );
    await press('Escape');
    state = await ui();
    check(
      !state.panel && state.model === chosen.name && state.focus.cls.includes('agent-model-chip'),
      `Escape closes it, keeps the model and returns the focus (${JSON.stringify(state.focus)})`,
    );

    // --- Sergio's phrase (01/11/2026): once to open, closed only by pressing the button again ------
    // Open with the real mouse, choose a model with the real mouse, see it still open, then press
    // the chip: that second press is what closes it.
    check(await clickIn('button.agent-model-chip'), 'the chip is pressed to test its second press');
    await waitPresent('.agent-model-panel');
    const second = (await ui()).options.find((o) => !o.current);
    check(second !== undefined, 'the server lists a model other than the current one to click');
    if (second !== undefined) {
      check(
        await clickIn(`.agent-model-panel button[data-model="${second.id}"]`),
        `the model "${second.name}" is pressed with the real mouse`,
      );
      await waitFor(async () => (await ui()).model === second.name, 3_000, 100);
      state = await ui();
      check(
        state.panel && state.expanded === 'true' && state.model === second.name,
        `the panel is still open after the choice, with aria-expanded="true" and the chip on "${second.name}"`,
      );
      check(await clickIn('button.agent-model-chip'), 'the chip is pressed a second time');
      await waitPresent('.agent-model-panel', false);
      state = await ui();
      check(
        !state.panel && state.expanded === 'false' && state.model === second.name,
        `pressing the chip with the panel open closes it: no panel, aria-expanded="false", the model "${second.name}" kept`,
      );
      // Put the model back: the checks below expect `chosen`.
      await clickIn('button.agent-model-chip');
      await waitPresent('.agent-model-panel');
      await clickIn(`.agent-model-panel button[data-model="${chosen.id}"]`);
      await press('Escape');
      await waitPresent('.agent-model-panel', false);
      check((await ui()).model === chosen.name, 'the first chosen model is back on the chip');
    }

    // --- A press outside the panel closes it (dismissOutside, review #1015 C1) ------------------
    // A real mouse click on the prompt box: it is outside the panel, so the panel must close, the
    // model must stay, and the focus must stay where the user clicked (the rule does not move it).
    check(await clickIn('button.agent-model-chip'), 'the chip is pressed to test an outside click');
    await waitPresent('.agent-model-panel');
    check((await ui()).panel, 'the panel is open before the outside click');
    check(await clickIn('textarea'), 'the prompt box is pressed (outside the panel)');
    await waitPresent('.agent-model-panel', false);
    state = await ui();
    check(
      !state.panel && state.expanded === 'false' && state.model === chosen.name,
      `a press outside closes the panel and keeps the model ("${state.trigger}")`,
    );
    check(
      state.focus.tag === 'TEXTAREA',
      `...and the focus stays where the user clicked (${JSON.stringify(state.focus)})`,
    );

    // --- The agent: mouse, then keyboard (Tab to the chip, Enter, arrows) ------------------------
    check(await clickIn('button.agent-model-chip'), 'the chip is pressed to pick an agent');
    await waitPresent('.agent-model-panel');
    check(await clickIn('button[data-agent="plan"]'), '"Plan" is pressed');
    await waitFor(async () => (await ui()).agent === 'Plan', 3_000, 100);
    state = await ui();
    check(
      state.panel && state.agent === 'Plan' && state.focus.agentRow === 'plan',
      `choosing an agent leaves the panel open, the chip reads Plan and the focus stays on its row ("${state.trigger}", ${JSON.stringify(state.focus)})`,
    );
    await press('Escape');
    check(
      (await ui()).focus.cls.includes('agent-model-chip'),
      'Escape closes it and the focus returns to the chip',
    );
    await focusPromptBox();
    await page.keyboard.type('keep this text');
    const visited = [];
    for (let i = 0; i < 8; i += 1) {
      await press('Tab');
      const focus = (await ui()).focus;
      visited.push(focus.cls);
      if (focus.cls.includes('agent-model-chip')) break;
    }
    state = await ui();
    check(
      state.focus.cls.includes('agent-model-chip'),
      `Tab from the prompt reaches the chip (${JSON.stringify(visited)})`,
    );
    check(
      state.focus.visible && state.focus.ring !== '' && state.focus.ring !== 'none',
      `the focused chip shows a ring (${JSON.stringify(state.focus)})`,
    );
    await shot('12c-chip-focus');
    const before = await web.inDoc((doc) => doc.querySelectorAll('[role="log"] > *').length);
    await press('Enter');
    state = await ui();
    check(
      state.panel && state.focus.agentRow === 'plan',
      `Enter opens the panel with the focus on the current agent (${JSON.stringify(state.focus)})`,
    );
    await press('ArrowUp');
    state = await ui();
    check(
      state.focus.agentRow === 'build',
      `ArrowUp moves to the previous agent (${JSON.stringify(state.focus)})`,
    );
    await press('Enter');
    // Fixed on purpose: negative check below (Enter on an agent row does NOT send a prompt).
    await sleep(800);
    state = await ui();
    const kept = await web.inDoc((doc) => doc.querySelector('textarea')?.value ?? '');
    const blocks = await web.inDoc((doc) => doc.querySelectorAll('[role="log"] > *').length);
    check(
      state.panel &&
        state.agent === 'Build' &&
        kept === 'keep this text' &&
        blocks === before &&
        !(await isBusy()),
      `Enter on an agent row picks it, leaves the panel open and does NOT send the prompt ("${kept}", agent "${state.agent}")`,
    );
    // Back to Plan with the keyboard only: Escape, Enter (opens), ArrowDown, Enter (picks).
    await press('Escape');
    await press('Enter');
    await press('ArrowDown');
    await press('Enter');
    state = await ui();
    check(
      state.panel && state.agent === 'Plan' && state.focus.agentRow === 'plan',
      `the keyboard alone picked Plan again and the panel stays open ("${state.trigger}", ${JSON.stringify(state.focus)})`,
    );
    await press('Escape');
    check(
      (await ui()).focus.cls.includes('agent-model-chip'),
      'Escape closes it and the focus returns to the chip',
    );
    for (const [name, theme] of captureThemes(THEMES)) {
      await setTheme(theme);
      await shot(`12d-chip-${name}`);
    }
    await setTheme('Default Dark Modern');

    // --- A prompt carries the choice, and the reply says who answered --------------------------
    await send('Reply with exactly: OK. Do not use any tools.');
    const finished = await waitIdle(30_000);
    state = await ui();
    check(finished, 'the turn with the chosen agent and model finished');
    check(
      state.metas > 0 && state.alerts === 0,
      `the turn left a reply and no alert (${String(state.metas)} replies, ${String(state.alerts)} alerts)`,
    );
    check(
      state.lastMeta === `Plan · ${chosen.name}`,
      `the reply says who answered ("${state.lastMeta}", expected "Plan · ${chosen.name}")`,
    );
    check(
      state.agent === 'Plan' && state.model === chosen.name,
      `the session now holds Plan and the chosen model ("${state.agent}", "${state.trigger}")`,
    );
    await shot('12e-reply-meta');
    for (const [name, theme] of captureThemes(THEMES)) {
      await setTheme(theme);
      await shot(`12f-reply-meta-${name}`);
    }
    await setTheme('Default Dark Modern');

    // --- A NEW session proposes the last model used; the setting wins over it --------------------
    check(await clickButton('New session'), 'New session is pressed after the reply');
    await waitEmptyView();
    state = await ui();
    check(
      state.model === chosen.name,
      `a new session proposes the LAST model used ("${state.trigger}")`,
    );
    check(
      state.agent === 'Build',
      `the agent is not remembered: Build again (got "${state.agent}")`,
    );

    const other = options.find((o) => o.id !== chosen.id && o.id !== target.id) ?? target;
    const settingFile = writeSettings(vscode.userDataDir, { 'openVsCode.defaultModel': other.id });
    const applied = await waitFor(async () => (await ui()).model === other.name, 15_000, 300);
    state = await ui();
    check(
      applied === true,
      `the setting wins over the last used model ("${state.trigger}", setting ${other.id} in ${settingFile})`,
    );
    await shot('12g-setting');

    writeSettings(vscode.userDataDir, { 'openVsCode.defaultModel': 'nope' });
    const ignored = await waitFor(
      async () => (await ui()).text.includes('is not written provider/model'),
      15_000,
      300,
    );
    state = await ui();
    check(ignored === true, 'a badly written setting is reported to the user once');
    check(
      state.model === chosen.name,
      `...and ignored: the last used model applies again ("${state.trigger}")`,
    );
    writeSettings(vscode.userDataDir, { 'openVsCode.defaultModel': '' });

    // --- Reopening the session shows ITS model and agent -------------------------------------------
    check(await clickButton('Sessions'), 'Sessions is pressed');
    const rows = await waitFor(
      () => web.inDoc((doc) => doc.querySelectorAll('button.session-main').length > 0),
      20_000,
      300,
    );
    check(rows === true, 'the session list has rows');
    check(await clickRowMain('button.session-main'), 'the newest session is pressed');
    const reopened = await waitFor(async () => (await ui()).agent === 'Plan', 20_000, 300);
    state = await ui();
    check(
      reopened === true && state.model === chosen.name,
      `the reopened session shows its own model and agent ("${state.agent}", "${state.trigger}")`,
    );
    await shot('12h-reopened');
    assertNoWebviewErrors('selectors');
  });

  // Review #1015 S1: a prompt WITH an attachment threw DataCloneError in a real VS Code (the picked
  // files were Solid store Proxies and `postMessage` cannot clone them). jsdom cannot see it, so this
  // attaches a real file through the "Attach file…" item of the "+" menu and sends. The file dialog is the quick-input
  // one (`files.simpleDialog.enable`, see `vscodeProcess.mjs`), which is DOM that Playwright can type in.
  await step('13 attach a real file and send it (review #1015 S1)', async () => {
    const target = path.join(workspace, 'src', 'sample.ts');
    const chips = () =>
      web.inDoc((doc) => ({
        pending: [...doc.querySelectorAll('.chips .chip-open, .chips .chip-name')].map(
          (c) => c.textContent ?? '',
        ),
        sent: [...doc.querySelectorAll('[role="log"] .message-files .chip')].map(
          (c) => c.textContent ?? '',
        ),
        alerts: doc.querySelectorAll('[role="alert"]').length,
      }));
    assertNoWebviewErrors('before attaching');
    // A fresh session: when the model of step 11 ignores "do not use tools" its turn waits for a
    // permission forever (seen on 21/10/2026, screenshot 12e), and a busy session would swallow Enter.
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();
    // E2 #85 phase 4: Attach is now the "Attach file…" item of the "+" menu.
    check(await clickButton('Add context'), 'the "+" button is pressed');
    await waitPresent('[role="menu"]');
    check(await clickButton('Attach file…'), 'Attach file… is pressed in the "+" menu');
    const dialog = page.locator('.quick-input-widget input').first();
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    if (!(await typeInQuickInput(dialog, target))) {
      throw new Error('the Attach file… dialog did not take the focus');
    }
    await shot('13a-attach-dialog');
    await page.keyboard.press('Enter');
    const attached = await waitFor(async () => (await chips()).pending.length > 0, 15_000, 300);
    let state = await chips();
    check(
      attached === true && state.pending.some((name) => name.endsWith('sample.ts')),
      `the picked file shows as a chip ("${state.pending.join(', ')}")`,
    );
    await shot('13b-attached');
    // The quick input gives the focus back to the editor when it closes, a moment later: let it
    // happen, then take the focus into the prompt box before typing (else the text lands in a file).
    await waitFor(quickInputHidden, 2_000, 50);
    await focusPromptBox();
    const focus = await web.inDoc((doc) => ({
      tag: doc.activeElement?.tagName ?? '',
      focused: doc.hasFocus(),
    }));
    check(
      focus.tag === 'TEXTAREA' && focus.focused,
      `the prompt box has the keyboard focus (${JSON.stringify(focus)})`,
    );
    await send('Reply with exactly: OK. Do not use any tools.');
    const left = await waitFor(async () => (await chips()).sent.length > 0, 20_000, 300);
    state = await chips();
    check(
      left === true && state.sent.some((name) => name.endsWith('sample.ts')),
      `the message left with its attachment ("${state.sent.join(', ')}")`,
    );
    check(state.pending.length === 0, 'the chip left the prompt box once sent');
    check(
      state.alerts === 0,
      `no alert after sending with an attachment (${String(state.alerts)})`,
    );
    assertNoWebviewErrors('attach');
    check(await waitIdle(30_000), 'the turn with the attachment finished');
    await shot('13c-attachment-reply');
  });

  // Issue #61 (decisions of Sergio, 22/10/2026, Engram #1021): the reasoning-variant control, a
  // button + panel after the model button, shown only for a model that lists variants. It is the
  // LAST step on purpose: it leaves a remembered "model + variant" behind, which would change what
  // steps 11 and 13 expect a new session to propose. The model with variants is found in the
  // catalog the fixture serves (`visual` mode: models with variants low/high and one without);
  // the step ASSERTS that the catalog has one of each, it never skips.
  //
  // E2 (#85, phase 3): rewritten on the chip. The level is the "· low" at the end of the chip text
  // and the Reasoning section of its panel (present only for a model that lists variants). Not run
  // in phase 3 (decision of Sergio, Engram #1303); its first full run (phase 4, 27/10/2026,
  // Windows 11, VS Code 1.143.1) passed. The checks added on 01/11/2026 (a choice leaves the panel
  // open, the chip closes it, agent + model + reasoning in one opening) ran in `--steps 11,14`
  // (Windows 11, VS Code 1.144.0; the output is quoted in `AgentModelMenu.tsx`). The full run of
  // the final tree passed too (01/11/2026, 1471 ok, "all visual checks passed").
  await step('14 reasoning variant (issue #61)', async () => {
    /** What the chip and its panel show. Self-contained (serialized). */
    const ui = () =>
      web.inDoc((doc) => {
        const chip = doc.querySelector('button.agent-model-chip');
        const parts = (chip?.textContent ?? '').split(' · ');
        const panel = doc.querySelector('.agent-model-panel');
        const active = doc.activeElement;
        const metas = [...doc.querySelectorAll('.message-assistant .message-meta')];
        const style = active ? doc.defaultView.getComputedStyle(active) : null;
        return {
          agent: parts[0] ?? '',
          model: parts[1] ?? '',
          // "" for Default (the chip adds nothing), else the level ("low").
          level: parts.slice(2).join(' · '),
          expanded: chip?.getAttribute('aria-expanded') ?? '',
          disabled: chip?.getAttribute('aria-disabled') ?? '',
          panel: panel !== null,
          hasReasoning: doc.querySelector('.agent-model-panel .menu-reasoning') !== null,
          entries: [
            ...doc.querySelectorAll('.agent-model-panel .menu-reasoning button.model-option'),
          ].map((b) => ({
            id: b.getAttribute('data-variant') ?? '',
            current: b.getAttribute('aria-current') === 'true',
          })),
          modelIds: [...doc.querySelectorAll('.agent-model-panel button[data-model]')].map(
            (b) => b.getAttribute('data-model') ?? '',
          ),
          focus: {
            agentRow: active?.getAttribute?.('data-agent') ?? '',
            cls: active?.className ?? '',
            variant: active?.getAttribute?.('data-variant') ?? '',
            visible: active?.matches?.(':focus-visible') ?? false,
            outline: style ? `${style.outlineStyle} ${style.outlineWidth}` : '',
          },
          // Same filter as step 2: not `<html>` (VS Code sets theme variables there) and only
          // NON-EMPTY attributes (Chromium leaves `style=""` on a textarea it has resized).
          styled: [...doc.querySelectorAll('body [style], body[style]')]
            .filter((e) => (e.getAttribute('style') ?? '').trim() !== '')
            .map((e) => `${e.tagName}.${e.className}: ${e.getAttribute('style')}`),
          lastMeta: metas.at(-1)?.textContent ?? '',
          metas: metas.length,
          alerts: doc.querySelectorAll('[role="alert"]').length,
        };
      });
    const press = async (key) => {
      await page.keyboard.press(key);
      await sleep(250); // the key reaches the webview through the workbench asynchronously; some keys expect "nothing changes"
    };
    const THEMES = [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ];
    /**
     * Opens the chip's panel with the real mouse, presses model `id` and closes the panel with
     * Escape (a choice leaves it open since 01/11/2026); false if not listed.
     */
    const pickModel = async (id) => {
      if (!(await clickIn('button.agent-model-chip'))) return false;
      await waitPresent('.agent-model-panel');
      const pressed = await clickIn(`.agent-model-panel button.model-option[data-model="${id}"]`);
      await press('Escape');
      await waitPresent('.agent-model-panel', false);
      return pressed;
    };
    /** Opens the panel, says whether it has a Reasoning section, and closes it again. */
    const hasReasoning = async () => {
      await clickIn('button.agent-model-chip');
      await waitPresent('.agent-model-panel');
      const has = (await ui()).hasReasoning;
      await press('Escape');
      return has;
    };

    assertNoWebviewErrors('before the variant step');
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();

    // --- Find a model that lists variants and one that lists none; assert both exist ------------
    check(await clickIn('button.agent-model-chip'), 'the chip is pressed');
    await waitPresent('.agent-model-panel');
    const ids = (await ui()).modelIds;
    await press('Escape');
    const GLM = 'opencode/glm-5.3-flash-free';
    const candidates = [...ids.filter((id) => id === GLM), ...ids.filter((id) => id !== GLM)];
    let withVariants;
    let withoutVariants;
    for (const id of candidates) {
      if (!(await pickModel(id))) continue;
      const has = await hasReasoning();
      if (has && withVariants === undefined) withVariants = id;
      if (!has && withoutVariants === undefined) withoutVariants = id;
      if (withVariants !== undefined && withoutVariants !== undefined) break;
    }
    // The synthetic catalog has models with variants (low, high) and one without.
    check(withVariants !== undefined, 'the catalog has a model that lists variants');
    check(withoutVariants !== undefined, 'the catalog has a model that lists no variants');
    if (withVariants === undefined) return;

    // --- A model without variants has no Reasoning section -----------------------------------
    if (withoutVariants !== undefined) {
      await pickModel(withoutVariants);
      check(
        !(await hasReasoning()) && (await ui()).level === '',
        `a model without variants (${withoutVariants}) shows no Reasoning section and no level`,
      );
    }

    // --- A model with variants: the section, closed chip and open panel, in the four themes ----
    check(await pickModel(withVariants), `the model with variants (${withVariants}) is chosen`);
    let state = await ui();
    check(state.level === '', `the chip shows no level for Default ("${state.level}")`);
    await shot('14a-variant-closed');
    check(await clickIn('button.agent-model-chip'), 'the chip is pressed with the real mouse');
    await waitPresent('.agent-model-panel');
    state = await ui();
    check(state.panel && state.expanded === 'true', 'the chip panel opened');
    check(
      state.hasReasoning &&
        state.entries[0]?.id === 'default' &&
        state.entries.length >= 2 &&
        state.entries.filter((e) => e.current).length === 1 &&
        state.entries[0].current,
      `the Reasoning section lists Default (current) and the catalog variants (${JSON.stringify(state.entries)})`,
    );
    // Decision of Sergio (27/10/2026): Reasoning sits INSIDE the Model column, under its list, not
    // across the full width under both columns (also when the columns stack under 360 px).
    check(
      (await web.inDoc((doc) => {
        const reasoning = doc.querySelector('.agent-model-panel .menu-reasoning');
        const column = doc.querySelector('.agent-model-panel [data-group="model"]');
        const lastModel = [...doc.querySelectorAll('.agent-model-panel button[data-model]')].at(-1);
        if (!reasoning || !column || !lastModel) return false;
        return (
          column.contains(reasoning) &&
          reasoning.getBoundingClientRect().top >= lastModel.getBoundingClientRect().bottom - 1
        );
      })) === true,
      'the Reasoning section is inside the Model column, under the model list',
    );
    for (const [name, theme] of captureThemes(THEMES)) {
      await setTheme(theme);
      await shot(`14b-variant-panel-${name}`);
    }
    await setTheme('Default Dark Modern');

    // --- Choose a variant with the real mouse ------------------------------------------------
    const variant = state.entries.find((e) => e.id === 'low')?.id ?? state.entries[1]?.id;
    check(
      await clickIn(`.menu-reasoning button[data-variant="${String(variant)}"]`),
      `the variant "${String(variant)}" is pressed`,
    );
    await waitFor(async () => (await ui()).level === String(variant), 3_000, 100);
    state = await ui();
    check(
      state.panel && state.level === String(variant),
      `choosing leaves the panel open and the chip ends in "· ${String(variant)}" ("${state.level}")`,
    );
    check(
      state.focus.variant === String(variant),
      `the focus stays on the chosen Reasoning row (${JSON.stringify(state.focus)})`,
    );
    await press('Escape');
    check(
      (await ui()).focus.cls.includes('agent-model-chip'),
      'Escape closes it and the focus returns to the chip',
    );
    await shot('14c-variant-chosen');
    for (const [name, theme] of captureThemes(THEMES)) {
      await setTheme(theme);
      await shot(`14d-variant-chosen-${name}`);
    }
    await setTheme('Default Dark Modern');

    // --- Keyboard: Tab to the chip, Enter opens, Tab to the Reasoning list, arrows, Escape ----
    await focusPromptBox();
    const visited = [];
    for (let i = 0; i < 12; i += 1) {
      await press('Tab');
      const focus = (await ui()).focus;
      visited.push(focus.cls);
      if (focus.cls.includes('agent-model-chip')) break;
    }
    state = await ui();
    check(
      state.focus.cls.includes('agent-model-chip'),
      `Tab from the prompt reaches the chip (${JSON.stringify(visited)})`,
    );
    check(
      state.focus.visible && state.focus.outline !== '' && !state.focus.outline.startsWith('none'),
      `...with a visible focus ring (${JSON.stringify(state.focus)})`,
    );
    await shot('14e-variant-focus');
    await press('Enter');
    state = await ui();
    check(
      state.panel && state.focus.agentRow !== '',
      `Enter opens the panel with the focus on the current agent (${JSON.stringify(state.focus)})`,
    );
    for (let i = 0; i < 6 && state.focus.variant === ''; i += 1) {
      await press('Tab');
      state = await ui();
    }
    check(
      state.focus.variant === String(variant),
      `Tab reaches the Reasoning list on the current level (${JSON.stringify(state.focus)})`,
    );
    await press('ArrowUp');
    state = await ui();
    check(
      state.focus.cls.includes('model-option') && state.focus.variant !== String(variant),
      `ArrowUp moves to the previous entry (${JSON.stringify(state.focus)})`,
    );
    await press('Escape');
    state = await ui();
    check(
      !state.panel &&
        state.level === String(variant) &&
        state.focus.cls.includes('agent-model-chip'),
      `Escape closes it, keeps the variant and returns the focus (${JSON.stringify(state.focus)})`,
    );

    // --- A press outside closes the panel (dismissOutside) -----------------------------------
    check(await clickIn('button.agent-model-chip'), 'the chip is pressed to test an outside click');
    await waitPresent('.agent-model-panel');
    check((await ui()).panel, 'the chip panel is open before the outside click');
    check(await clickIn('textarea'), 'the prompt box is pressed (outside the panel)');
    await waitPresent('.agent-model-panel', false);
    state = await ui();
    check(
      !state.panel && state.level === String(variant),
      'a press outside closes the panel and keeps the variant',
    );

    // --- Decision (c): the same model keeps the variant, another model starts on Default ------
    check(await pickModel(withVariants), 'the SAME model is chosen again');
    state = await ui();
    check(
      state.level === String(variant),
      `re-choosing the same model keeps the variant ("${state.level}")`,
    );
    const another = candidates.find((id) => id !== withVariants);
    check(another !== undefined, 'the catalog lists a second model');
    if (another !== undefined) {
      check(await pickModel(another), `another model (${another}) is chosen`);
      state = await ui();
      check(state.level === '', `another model starts on Default ("${state.level}")`);
      check(await pickModel(withVariants), `the first model is chosen again`);
      state = await ui();
      check(
        state.level === '',
        `...and its variant was NOT remembered across the change ("${state.level}")`,
      );
      // Sergio's case (01/11/2026): the agent, the model AND then its reasoning level in ONE
      // opening. The panel was closing on the first choice, so the level took a second opening.
      check(await clickIn('button.agent-model-chip'), 'the chip is pressed again');
      await waitPresent('.agent-model-panel');
      check(
        await clickIn('.agent-model-panel button[data-agent="plan"]'),
        'the agent "Plan" is pressed first, inside the open panel',
      );
      check(
        await clickIn(`.agent-model-panel button.model-option[data-model="${another}"]`),
        `another model (${another}) is pressed inside the open panel`,
      );
      check(
        await clickIn(`.agent-model-panel button.model-option[data-model="${withVariants}"]`),
        `the model with variants (${withVariants}) is pressed in the same opening`,
      );
      state = await ui();
      check(
        state.panel && state.level === '' && state.hasReasoning,
        `the panel is still open after two model choices and shows the Reasoning section (level "${state.level}")`,
      );
      check(
        await clickIn(`.menu-reasoning button[data-variant="${String(variant)}"]`),
        `the variant "${String(variant)}" is chosen in the same opening, without reopening`,
      );
      await waitFor(async () => (await ui()).level === String(variant), 3_000, 100);
      state = await ui();
      check(
        state.panel &&
          state.level === String(variant) &&
          state.focus.variant === String(variant) &&
          state.entries.find((e) => e.id === String(variant))?.current === true,
        `model and reasoning set in one opening: the panel stays open, the chip ends in "· ${String(variant)}" and the focus stays on that row ("${state.level}", ${JSON.stringify(state.focus)})`,
      );
      check(
        state.agent === 'Plan',
        `agent, model and reasoning set in one opening: the chip reads Plan and the variant "${String(variant)}" ("${state.agent}")`,
      );
      // Back to Build in the same opening, so the steps after this one start as before.
      check(
        await clickIn('.agent-model-panel button[data-agent="build"]'),
        'the agent "Build" is pressed to restore it',
      );
      await waitFor(async () => (await ui()).agent === 'Build', 3_000, 100);
      check((await ui()).agent === 'Build', 'the chip reads Build again');
      await press('Escape');
    }

    // --- The prompt carries it, and the reply says so -----------------------------------------
    await send('Reply with exactly: OK. Do not use any tools.');
    const finished = await waitIdle(30_000);
    state = await ui();
    check(finished, 'the turn with the variant finished');
    check(
      state.metas > 0 && state.alerts === 0,
      `the turn left a reply and no alert (${String(state.metas)} replies, ${String(state.alerts)} alerts)`,
    );
    check(
      state.lastMeta.endsWith(` · ${String(variant)}`),
      `the reply line ends in the variant ("${state.lastMeta}", expected "… · ${String(variant)}")`,
    );
    check(state.level === String(variant), `the open session holds the variant ("${state.level}")`);
    await shot('14f-variant-reply');

    // --- A NEW session proposes the last model WITH its variant; reopening shows the stored one
    check(await clickButton('New session'), 'New session is pressed after the reply');
    await waitEmptyView();
    state = await ui();
    check(
      state.level === String(variant),
      `a new session proposes the last used variant ("${state.level}")`,
    );
    await shot('14g-variant-new-session');
    check(await clickButton('Sessions'), 'Sessions is pressed');
    const rows = await waitFor(
      () => web.inDoc((doc) => doc.querySelectorAll('button.session-main').length > 0),
      20_000,
      300,
    );
    check(rows === true, 'the session list has rows');
    check(await clickRowMain('button.session-main'), 'the newest session is pressed');
    const reopened = await waitFor(async () => (await ui()).level === String(variant), 20_000, 300);
    state = await ui();
    check(
      reopened === true,
      `the reopened session shows the variant the SERVER stored ("${state.level}")`,
    );
    check(
      state.styled.length === 0,
      `no inline style attribute in the webview body (${state.styled.join(' | ')})`,
    );
    await shot('14h-variant-reopened');
    assertNoWebviewErrors('variant');
  });

  // Issue #26 (E6-tool-call-views). The tool cards against the fixture: one `TOOLS` prompt makes
  // it call shell, read, grep and edit (and more) on the sample workspace, and each card is
  // judged folded-by-default, reachable with Tab with a visible ring, opened with Enter, closed
  // with Space, with the body the tool should give (shell output, file contents, matches, a diff
  // with added AND deleted lines). Nothing depends on a model, so a missing card is a failed
  // check, not a skip. That a REAL opencode sends the shapes these cards read is not judged here:
  // it is what `npm run test:event-shapes` compares.
  await step('15 tool cards (issue #26)', async () => {
    /** Every tool card of the log, in order. Self-contained (it is serialized). */
    const cards = () =>
      web.inDoc((doc) =>
        [...doc.querySelectorAll('.tool-card')].map((card) => {
          const toggle = card.querySelector('.tool-toggle');
          return {
            tool: card.getAttribute('data-tool') ?? '',
            status: card.getAttribute('data-status') ?? '',
            expanded: toggle?.getAttribute('aria-expanded') ?? '',
            body: card.querySelector('.tool-body') !== null,
            name: toggle?.getAttribute('aria-label') ?? '',
            styled: card.querySelectorAll('[style]').length,
          };
        }),
      );
    /**
     * Marks the first (or last) card of `tool` (any tool when null) for the helpers below and
     * returns the `data-tool` of the card it marked, or null when there is none. `inDoc` forwards
     * ONE argument (`webviewCdp.mjs`), so both options travel in a single object: passing them as
     * two arguments once made `fromEnd` always undefined and tagged the FIRST card (review
     * Engram #1041, C1).
     */
    const tagCard = (tool, last = false) =>
      web.inDoc(
        (doc, { wanted, fromEnd }) => {
          for (const old of doc.querySelectorAll('[data-visual-card]')) {
            old.removeAttribute('data-visual-card');
          }
          const all = [...doc.querySelectorAll('.tool-card')].filter(
            (card) => wanted === null || card.getAttribute('data-tool') === wanted,
          );
          const card = fromEnd ? all.at(-1) : all[0];
          card?.setAttribute('data-visual-card', 'true');
          return card === undefined ? null : (card.getAttribute('data-tool') ?? '');
        },
        { wanted: tool, fromEnd: last },
      );
    /** State of the tagged card: toggle, focus, body text, diff line kinds, outputs. */
    const tagged = () =>
      web.inDoc((doc) => {
        const card = doc.querySelector('[data-visual-card]');
        if (!card) return null;
        const toggle = card.querySelector('.tool-toggle');
        const active = doc.activeElement;
        const lines = [...card.querySelectorAll('.diff-line')];
        const style = active ? doc.defaultView.getComputedStyle(active) : null;
        return {
          expanded: toggle?.getAttribute('aria-expanded') ?? '',
          body: card.querySelector('.tool-body') !== null,
          text: card.querySelector('.tool-body')?.innerText ?? '',
          outputs: [...card.querySelectorAll('.tool-output')].map((pre) => pre.innerText),
          add: lines.filter((line) => line.getAttribute('data-kind') === 'add').length,
          del: lines.filter((line) => line.getAttribute('data-kind') === 'del').length,
          hunk: lines.filter((line) => line.getAttribute('data-kind') === 'hunk').length,
          matches: card.querySelectorAll('.tool-match').length,
          pathButtons: card.querySelectorAll('button.tool-path').length,
          name: toggle?.getAttribute('aria-label') ?? '',
          focusOnToggle: Boolean(active?.matches?.('[data-visual-card] .tool-toggle')),
          focusVisible: active?.matches?.(':focus-visible') ?? false,
          outline: style ? `${style.outlineStyle} ${style.outlineWidth}` : '',
          headerVisible: (() => {
            const list = doc.querySelector('.message-list');
            if (!toggle || !list) return false;
            const t = toggle.getBoundingClientRect();
            const l = list.getBoundingClientRect();
            return t.top >= l.top - 1 && t.bottom <= l.bottom + 1;
          })(),
          logChildren: doc.querySelectorAll('[role="log"] > *').length,
          styled: [...doc.querySelectorAll('body [style], body[style]')]
            .filter((e) => (e.getAttribute('style') ?? '').trim() !== '')
            .map((e) => `${e.tagName}.${e.className}: ${e.getAttribute('style')}`),
        };
      });
    /** Real Shift+Tab from the prompt box until the tagged card's toggle has the focus. */
    const tabToTagged = async () => {
      await focusPromptBox();
      for (let i = 0; i < 120; i += 1) {
        await page.keyboard.press('Shift+Tab');
        await sleep(40); // pace between Shift+Tab presses so the focus read sees each one
        if ((await tagged())?.focusOnToggle) return true;
      }
      return false;
    };
    const THEMES = [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ];
    const seen = async (tool) =>
      (await cards()).some((card) => card.tool === tool && card.status === 'completed');

    assertNoWebviewErrors('before the tool cards step');
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();

    // --- One prompt with the TOOLS trigger: the synthetic server plays nine tool calls ----------
    // (shell twice, read, edit, write, grep, glob, webfetch and an MCP-style tool), each completed.
    await send(
      'Use the tools, do not guess. In this order: 1) call the shell tool with the command ' +
        '`node --version`; 2) call the read tool on src/sample.ts; 3) call the grep tool with the ' +
        'pattern greet in the src folder; 4) call the edit tool on src/sample.ts replacing the text ' +
        '`value2 = 2;` with `value2 = 22;`. Then reply with exactly: DONE. TOOLS',
    );
    check(await waitIdle(30_000), 'the tools turn finished');
    const all = await cards();
    console.log(`  cards: ${JSON.stringify(all.map((c) => `${c.tool}:${c.status}`))}`);
    await shot('15a-tool-cards-folded');

    // --- Every card is folded by default, with no body in the DOM and no style attribute ------
    check(all.length > 0, `the conversation has tool cards (${String(all.length)})`);
    check(
      all.every((card) => card.expanded === 'false' && !card.body),
      'every tool card is folded by default (aria-expanded=false, no .tool-body in the DOM)',
    );
    check(
      all.every((card) => card.styled === 0),
      'no tool card carries a style attribute',
    );
    for (const card of all) console.log(`  header: "${card.name}"`);
    check(
      all.every((card) => card.name.includes(' · ') && card.name.length > 0),
      'every toggle has an accessible name with its status',
    );

    // --- Each kind: Tab, ring, Enter opens, content, Space closes -----------------------------
    const judged = [];
    for (const tool of ['shell', 'read', 'edit', 'grep']) {
      const completed = await seen(tool);
      check(completed, `a "${tool}" call completed, so its card body can be judged`);
      if (!completed) continue;
      judged.push(tool);
      check(await tagCard(tool), `the first ${tool} card is tagged`);
      const reached = await tabToTagged();
      let state = await tagged();
      check(reached === true, `Shift+Tab from the prompt box reaches the ${tool} toggle`);
      check(
        state?.focusVisible === true && state.outline !== '' && !state.outline.startsWith('none'),
        `...with a visible focus ring (${JSON.stringify(state?.outline)})`,
      );
      const before = state?.logChildren ?? 0;
      await page.keyboard.press('Enter');
      await waitFor(async () => (await tagged())?.expanded === 'true', 3_000, 100);
      state = await tagged();
      check(
        state?.expanded === 'true' && state.body,
        `Enter opens the ${tool} card and its body appears`,
      );
      check(
        state?.logChildren === before,
        `opening the card adds no child to the log (${String(before)} -> ${String(state?.logChildren)})`,
      );
      console.log(`  ${tool} body: ${JSON.stringify((state?.text ?? '').slice(0, 300))}`);
      if (tool === 'shell') {
        check(
          (state?.outputs ?? []).some((text) => /v\d+\.\d+\.\d+/.test(text)),
          `the shell body shows the output of node --version (${JSON.stringify(state?.outputs)})`,
        );
      } else if (tool === 'read') {
        check(
          (state?.outputs ?? []).some((text) => /value2|Sample file/.test(text)),
          'the read body shows the contents of src/sample.ts',
        );
      } else if (tool === 'edit') {
        check(
          (state?.add ?? 0) >= 1 && (state?.del ?? 0) >= 1,
          `the edit body is a diff with added (${String(state?.add)}) and deleted (${String(state?.del)}) lines`,
        );
        console.log(`  edit hunk lines: ${String(state?.hunk)}`);
      } else {
        check(/greet/.test(state?.text ?? ''), 'the grep body mentions the pattern');
        console.log(
          `  grep matches: ${String(state?.matches)} grouped, ${String(state?.pathButtons)} path buttons`,
        );
      }
      await shot(`15b-tool-${tool}-open`);
      await page.keyboard.press('Space');
      await waitFor(async () => (await tagged())?.expanded === 'false', 3_000, 100);
      state = await tagged();
      check(
        state?.expanded === 'false' && !state.body,
        `Space closes the ${tool} card and removes its body`,
      );
    }

    // --- The diff in the four themes: contrast of the added and deleted lines -----------------
    if (judged.includes('edit')) {
      await tagCard('edit');
      await tabToTagged();
      await page.keyboard.press('Enter');
      await waitFor(async () => (await tagged())?.expanded === 'true', 3_000, 100);
      for (const [name, theme] of THEMES) {
        await setTheme(theme);
        const diff = await web.inDoc(measureDiffLines);
        console.log(`  diff contrast ${name}: ${JSON.stringify(diff)}`);
        check(
          diff.add !== null && diff.del !== null && !diff.error,
          `the diff has an added and a deleted line in ${name}`,
        );
        if (diff.add && diff.del) {
          check(
            diff.add.ratio >= 4.5 && diff.del.ratio >= 4.5,
            `diff text contrast >= 4.5 in ${name} (add ${diff.add.ratio.toFixed(2)}, del ${diff.del.ratio.toFixed(2)})`,
          );
        }
        for (const word of ['title', 'arg', 'status', 'result']) {
          if (diff[word]) {
            check(
              diff[word].ratio >= 4.5,
              `the card header ${word} has text contrast >= 4.5 in ${name} (${diff[word].ratio.toFixed(2)})`,
            );
          }
        }
        await shot(`15c-diff-${name}`);
      }
      await setTheme('Default Dark Modern');
      await page.keyboard.press('Space');
      await waitFor(async () => (await tagged())?.expanded === 'false', 3_000, 100);
    }

    // --- The header of the LAST card stays in view after unfolding it (auto-scroll risk) ------
    const lastTool = await tagCard(null, true);
    if (lastTool !== null && (await tabToTagged())) {
      await page.keyboard.press('Enter');
      await waitFor(async () => (await tagged())?.expanded === 'true', 3_000, 100);
      // The auto-scroll that could push the header out of view runs after the unfolding: a fixed
      // window for that check, after the positive wait (it is what the check below is about).
      await sleep(400);
      const state = await tagged();
      check(
        state?.expanded === 'true' && state.headerVisible,
        `the header of the last card (data-tool="${String(lastTool)}") is still in view after unfolding it (${JSON.stringify(state?.headerVisible)})`,
      );
      await shot('15d-last-card-open');
      await page.keyboard.press('Space');
      await waitFor(async () => (await tagged())?.expanded === 'false', 3_000, 100);
    } else {
      check(
        false,
        `Shift+Tab reached the last card (data-tool=${JSON.stringify(lastTool)}) for the auto-scroll check`,
      );
    }

    // --- A failed call: a read of a file that does not exist (decision of Sergio, #1042) -------
    // BROKEN_READ makes the synthetic server fail the read with the error opencode gives
    // (`tool.execution`, "File not found: src/does-not-exist.ts").
    await send(
      'Call the read tool exactly once on the file src/does-not-exist.ts. It does not exist: call the ' +
        'tool anyway, do not check first. Then reply with exactly: DONE. BROKEN_READ',
    );
    await waitIdle(30_000);
    const failedSeen = async () =>
      (await cards()).some((card) => card.tool === 'read' && card.status === 'failed');
    check(await failedSeen(), 'the conversation has a read card in the failed state');
    if (await failedSeen()) {
      const failedCard = await web.inDoc((doc) => {
        for (const old of doc.querySelectorAll('[data-visual-card]')) {
          old.removeAttribute('data-visual-card');
        }
        const card = doc.querySelector('.tool-card[data-tool="read"][data-status="failed"]');
        if (!card) return null;
        card.setAttribute('data-visual-card', 'true');
        const toggle = card.querySelector('.tool-toggle');
        return {
          name: toggle?.getAttribute('aria-label') ?? '',
          expanded: toggle?.getAttribute('aria-expanded') ?? '',
          body: card.querySelector('.tool-body') !== null,
          visible: toggle?.innerText ?? '',
          status: card.querySelector('.tool-status')?.textContent ?? '',
          tone: card.querySelector('.tool-status')?.getAttribute('data-tone') ?? '',
          result: card.querySelector('.tool-result')?.textContent ?? '',
          // The toggle must contain its own content: a long error line once ran over the "Open" link.
          overflowPx: toggle ? toggle.scrollWidth - toggle.clientWidth : -1,
        };
      });
      console.log(`  failed header: ${JSON.stringify(failedCard?.name)}`);
      console.log(`  failed visible text: ${JSON.stringify(failedCard?.visible)}`);
      await shot('15e-tool-failed-folded');
      check(
        failedCard !== null && failedCard.status === 'failed' && failedCard.tone === 'error',
        `the failed read card says "failed" with the error tone (${JSON.stringify(failedCard?.status)}, ${JSON.stringify(failedCard?.tone)})`,
      );
      check(
        failedCard !== null && failedCard.result.trim() !== '',
        `the failed card shows the first line of the error in its header (${JSON.stringify(failedCard?.result)})`,
      );
      check(
        failedCard !== null && failedCard.name.includes(' · failed · '),
        `the failed header reads "... · failed · <error>" (${JSON.stringify(failedCard?.name)})`,
      );
      check(
        failedCard !== null && failedCard.overflowPx <= 1,
        `the failed header fits inside its toggle, nothing runs over the Open link (overflow ${String(failedCard?.overflowPx)} px)`,
      );
      // At the default side bar width a header stays on ONE line: the argument and the result
      // shrink with an ellipsis before anything wraps (`.tool-toggle` in index.css). Lines are the
      // toggle's content height over the height of its title; a header that wrapped (the review
      // of 27/10/2026 found Edit, Write, Grep and Fetch on two lines) reads 2.
      const headerLines = await web.inDoc((doc) => {
        const count = (selector) => {
          const toggle = doc.querySelector(`${selector} .tool-toggle`);
          const title = toggle?.querySelector('.tool-title');
          if (!toggle || !title) return -1;
          const style = doc.defaultView.getComputedStyle(toggle);
          const inner =
            toggle.getBoundingClientRect().height -
            parseFloat(style.paddingTop) -
            parseFloat(style.paddingBottom);
          return Math.round(inner / title.getBoundingClientRect().height);
        };
        return {
          edit: count('.tool-card[data-tool="edit"]'),
          write: count('.tool-card[data-tool="write"]'),
          grep: count('.tool-card[data-tool="grep"]'),
          fetch: count('.tool-card[data-tool="webfetch"]'),
          failed: count('[data-visual-card]'),
        };
      });
      check(
        Object.values(headerLines).every((lines) => lines === 1),
        `at the default side bar width the Edit, Write, Grep, Fetch and failed headers take one line each (${JSON.stringify(headerLines)})`,
      );
      // The same card in a 1080 px wide window with a ~270 px side bar (HYPOTHESIS for what such a
      // window gets, see NARROW_BAR_WIDTH), where the header used to run over the "Open" link by
      // 14 px (27/10/2026). The window, the side bar and the theme go back to what they were in a
      // `finally`, and the card is measured again, so a resize that did not undo itself is seen
      // here and not as a cascade in the steps that follow.
      const toggleFit = () =>
        web.inDoc((doc) => {
          const toggle = doc.querySelector('[data-visual-card] .tool-toggle');
          return toggle
            ? { overflowPx: toggle.scrollWidth - toggle.clientWidth, width: toggle.clientWidth }
            : null;
        });
      const barBefore = await sideBarPx();
      const fitBefore = await toggleFit();
      let narrowFit;
      try {
        // Resizing the window leaves the side bar at its width, so the sash is dragged too.
        const narrowSize = await setWindowSize(NARROW_SIZE.width, NARROW_SIZE.height);
        const narrowBar = await setSideBarWidth(NARROW_BAR_WIDTH);
        narrowFit = await toggleFit();
        console.log(
          `  narrow window ${String(narrowSize.width)}x${String(narrowSize.height)}, side bar ${String(narrowBar)} px: header ${String(narrowFit?.width)} px wide`,
        );
        await web.inDoc((doc) =>
          doc.querySelector('[data-visual-card]')?.scrollIntoView({ block: 'center' }),
        );
        await sleep(300); // scrollIntoView has no completion signal; the capture follows
        await shot('15e-tool-failed-narrow');
        await setTheme('Default High Contrast Light');
        await shot('15e-tool-failed-narrow-hc-light');
      } finally {
        for (const [what, restore] of [
          ['theme', () => setTheme('Default Dark Modern')],
          ['side bar', () => setSideBarWidth(barBefore)],
          ['window', () => setWindowSize(WINDOW_SIZE.width, WINDOW_SIZE.height)],
        ]) {
          await restore().catch((error) => {
            check(
              false,
              `the ${what} could not be restored after the narrow measure: ${String(error)}`,
            );
          });
        }
      }
      check(
        narrowFit !== undefined && narrowFit !== null && narrowFit.overflowPx <= 1,
        `the failed header fits inside its toggle in a ${String(NARROW_SIZE.width)} px wide window (overflow ${String(narrowFit?.overflowPx)} px)`,
      );
      const wideFit = await toggleFit();
      const barAfter = await sideBarPx();
      check(
        wideFit !== null &&
          fitBefore !== null &&
          wideFit.overflowPx <= 1 &&
          Math.abs(wideFit.width - fitBefore.width) <= 1 &&
          Math.abs(barAfter - barBefore) <= 1,
        `back at ${String(WINDOW_SIZE.width)}x${String(WINDOW_SIZE.height)} the side bar and the header are as before (side bar ${String(barBefore)} -> ${String(barAfter)} px, header ${String(fitBefore?.width)} -> ${String(wideFit?.width)} px, overflow ${String(wideFit?.overflowPx)} px)`,
      );
      check(
        failedCard !== null && failedCard.expanded === 'false' && !failedCard.body,
        'the failed card is folded by default (aria-expanded=false, no .tool-body)',
      );
      // Unfolded, the body ends with the error section and starts with the same first line.
      if (await tabToTagged()) {
        await page.keyboard.press('Enter');
        await waitFor(async () => (await tagged())?.expanded === 'true', 3_000, 100);
        const opened = await tagged();
        const firstLine = (failedCard?.result ?? '').replace(/…$/, '');
        check(
          opened?.expanded === 'true' && opened.body && (opened.text ?? '').includes(firstLine),
          `unfolded, the failed body contains the header's error line (${JSON.stringify((opened?.text ?? '').slice(0, 200))})`,
        );
        // The error text of the open body, in every theme, while the card stays unfolded.
        for (const [name, theme] of THEMES) {
          await setTheme(theme);
          const errorLook = (await web.inDoc(measureDiffLines)).failedError;
          console.log(`  failed body error contrast ${name}: ${JSON.stringify(errorLook)}`);
          check(
            errorLook !== null && errorLook !== undefined && errorLook.ratio >= 4.5,
            `the error text of the unfolded failed body has text contrast >= 4.5 in ${name} (${errorLook ? errorLook.ratio.toFixed(2) : 'not found'})`,
          );
          await shot(`15f-tool-failed-body-${name}`);
        }
        await setTheme('Default Dark Modern');
        await page.keyboard.press('Space');
        await waitFor(async () => (await tagged())?.expanded === 'false', 3_000, 100);
      } else {
        check(false, 'Shift+Tab reached the failed card to open its body');
      }
      for (const [name, theme] of THEMES) {
        await setTheme(theme);
        const measured = await web.inDoc(measureDiffLines);
        const failedLook = measured.failedStatus;
        console.log(`  failed contrast ${name}: ${JSON.stringify(failedLook)}`);
        check(
          failedLook !== null && failedLook !== undefined && failedLook.ratio >= 4.5,
          `the error-toned "failed" word has text contrast >= 4.5 in ${name} (${failedLook ? failedLook.ratio.toFixed(2) : 'not found'})`,
        );
        await shot(`15e-tool-failed-${name}`);
      }
      await setTheme('Default Dark Modern');
    }

    // --- A path of a card opens the file in the editor ----------------------------------------
    if (judged.includes('read')) {
      await closeAllEditors();
      await tagCard('read');
      check(
        await web.inDoc((doc) => {
          const button = doc.querySelector('[data-visual-card] .tool-header button.tool-path');
          if (!button) return false;
          button.setAttribute('data-visual-click', 'true');
          return true;
        }),
        'the read card has an "Open" path button in its header',
      );
      check(await clickIn('[data-visual-click="true"]'), 'the path button is pressed');
      await waitFor(
        async () => (await page.locator('.tab[aria-label*="sample.ts"]').count()) > 0,
        4_000,
        100,
      );
      const tabs = await page.locator('.tab[aria-label*="sample.ts"]').count();
      check(tabs > 0, `pressing the path opens src/sample.ts in the editor (${String(tabs)} tab)`);
      await web.inDoc((doc) => {
        for (const element of doc.querySelectorAll('[data-visual-click]')) {
          element.removeAttribute('data-visual-click');
        }
      });
    }

    const final = await tagged();
    check(
      (final?.styled ?? []).length === 0,
      `no inline style attribute in the webview body (${(final?.styled ?? []).join(' | ')})`,
    );
    console.log(`  tools judged: ${JSON.stringify(judged)}`);
    assertNoWebviewErrors('tool cards');
  });

  // Issues #28/#29 (decisions Q1-Q4 of Sergio, 22/10/2026, Engram #1064/#1065): the `@` popup and
  // the editor context, driven with the real keyboard and mouse. It is the last step: it leaves
  // chips and a sent message behind that no other step expects. Self-contained: it makes its own
  // second file (`src/sample-extra.ts`) so the popup has two rows to tell apart a normal row from
  // the highlighted one.
  await step('16 @ mentions and editor context (issues #28/#29)', async () => {
    const extra = path.join(workspace, 'src', 'sample-extra.ts');
    /** What the prompt box, the popup and the conversation show. Self-contained (serialized). */
    const ui = () =>
      web.inDoc((doc) => {
        const field = doc.querySelector('textarea.prompt-text');
        const rows = [...doc.querySelectorAll('.mention-popup [role="option"]')];
        const active = doc.activeElement;
        const send = [...doc.querySelectorAll('button')].find(
          (b) => b.getAttribute('aria-label') === 'Send',
        );
        const pointedAt = field?.getAttribute('aria-activedescendant') ?? '';
        return {
          popup: doc.querySelector('.mention-popup') !== null,
          status: doc.querySelector('.mention-status')?.textContent ?? '',
          rows: rows.map((row) => row.getAttribute('aria-label') ?? ''),
          selected: rows.findIndex((row) => row.getAttribute('aria-selected') === 'true'),
          value: field?.value ?? '',
          focusOnField: active === field && doc.hasFocus(),
          controls: field?.getAttribute('aria-controls') ?? '',
          pointsAtSelected:
            pointedAt !== '' &&
            doc.getElementById(pointedAt)?.getAttribute('aria-selected') === 'true',
          chips: [...doc.querySelectorAll('.chips .chip-open, .chips .chip-name')].map(
            (c) => c.textContent ?? '',
          ),
          sent: [...doc.querySelectorAll('[role="log"] .message-files .chip')].map(
            (c) => c.textContent ?? '',
          ),
          busy: [...doc.querySelectorAll('button')].some(
            (b) => b.getAttribute('aria-label') === 'Stop',
          ),
          sendDisabled: send?.disabled ?? null,
          messages: doc.querySelectorAll('[role="log"] > *').length,
          styled: [...doc.querySelectorAll('body [style], body[style]')].filter(
            (e) => (e.getAttribute('style') ?? '').trim() !== '',
          ).length,
        };
      });
    const THEMES = [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ];
    /** Empties the prompt box with the keyboard (focus goes into it first). */
    const clearBox = () => clearPromptBox(200); // same pause as in `send`: the emptied textarea re-renders
    /** Types `text` into an empty prompt box, as a user would. */
    const typeInBox = async (text) => {
      await clearBox();
      await page.keyboard.type(text);
    };
    /** What the last `searchUntil` that gave up saw; the theme loop puts it in its error. */
    let searchMiss = '';
    /**
     * Types `query` and waits for at least `min` rows. The real server refreshes its file index
     * every 10 s, so a file written a moment ago may not be listed yet: the last character is
     * typed again (a new search) until the rows appear, for about 40 s.
     *
     * When it gives up it records in `searchMiss` the box value, the popup rows, where the
     * workbench focus is and the theme class, so the FAIL says whether the text went elsewhere or
     * the popup stopped answering. Why: on 28/10/2026 the theme loop of this step failed twice in 6
     * runs of `--steps 16,17` ("no popup rows after switching to hc-dark", "… to dark"), both
     * times right after the "No files match" check of the theme before, and then passed 8 runs of
     * 8 of `--steps 16` with a trace in place: the cause is UNVERIFIED, this is what will show it.
     * The give-up path that fills `searchMiss` has not run yet either.
     */
    const searchUntil = async (query, min) => {
      await typeInBox(query);
      for (let attempt = 0; attempt < 14; attempt += 1) {
        if (await waitFor(async () => (await ui()).rows.length >= min, 3_000, 250)) return true;
        await page.keyboard.press('Backspace');
        await sleep(100); // retries the last typed character: a pace, not a wait for a condition
        await page.keyboard.type(query.slice(-1));
      }
      const seen = await ui().catch(() => null);
      const workbench = await page
        .evaluate(() => {
          const active = globalThis.document.activeElement;
          const theme = globalThis.document
            .querySelector('.monaco-workbench')
            ?.className.match(/\b(vs|vs-dark|hc-black|hc-light)\b/)?.[0];
          return `focus ${String(active?.tagName)}.${String(active?.className).slice(0, 40)}, theme ${String(theme)}`;
        })
        .catch(() => 'workbench unreadable');
      searchMiss = `box ${JSON.stringify(seen?.value)}, rows ${JSON.stringify(seen?.rows)}, popup ${String(seen?.popup)}, focus in box ${String(seen?.focusOnField)}; ${workbench}`;
      return false;
    };
    const removeChips = async () => {
      for (let guard = 0; guard < 6 && (await ui()).chips.length > 0; guard += 1) {
        await clickIn('.chips .chip-remove');
        await sleep(200); // one chip gone per round: the re-render has no signal apart from the count read next
      }
    };
    const editorSelection = () =>
      page
        .locator('#status\\.editor\\.selection')
        .first()
        .innerText()
        .catch(() => '');

    assertNoWebviewErrors('before the @ step');
    fs.writeFileSync(extra, 'export const extra = 1;\n');
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();

    // --- The popup opens on "@", lists files, and the box keeps the focus ----------------------
    check(await searchUntil('@sample', 2), 'typing "@sample" lists at least two files');
    let state = await ui();
    console.log(`  rows: ${JSON.stringify(state.rows)}`);
    check(
      state.popup &&
        state.rows.includes('src/sample.ts') &&
        state.rows.includes('src/sample-extra.ts'),
      'the popup lists src/sample.ts and src/sample-extra.ts (files only, relative names)',
    );
    check(
      state.controls === 'mention-list' && state.pointsAtSelected,
      'the box points at the highlighted option (aria-controls and aria-activedescendant)',
    );
    check(state.focusOnField, 'the keyboard focus stays in the prompt box while the popup is open');
    check(state.sendDisabled === false, 'a search does not lock Send');
    await shot('16a-mention-popup');

    // --- Contrast of a normal row, the highlighted one and the "no match" line, four themes ----
    for (const [name, theme] of THEMES) {
      await setTheme(theme);
      if (!(await searchUntil('@sample', 2)))
        throw new Error(`no popup rows after switching to ${name} (${searchMiss})`);
      await page.keyboard.press('ArrowDown'); // so row 0 is NOT the highlighted one
      await sleep(250); // the highlight moves in a later render; the measurement follows
      const rowsLook = await web.inDoc(measureText, {
        normalName: '.mention-option[aria-selected="false"] .mention-name',
        normalDir: '.mention-option[aria-selected="false"] .mention-dir',
        selectedName: '.mention-option[aria-selected="true"] .mention-name',
        selectedDir: '.mention-option[aria-selected="true"] .mention-dir',
      });
      console.log(`  popup ${name}: ${JSON.stringify(rowsLook)}`);
      for (const [part, look] of Object.entries(rowsLook)) {
        check(
          look !== null && look !== undefined && look.ratio >= 4.5,
          `the ${part} text of the popup has contrast >= 4.5 in ${name} (${look ? look.ratio.toFixed(2) : 'not found'})`,
        );
      }
      await shot(`16b-mention-popup-${name}`);
      await typeInBox('@qqqzzz');
      const empty = await waitFor(
        async () => (await ui()).status.includes('No files match'),
        20_000,
        300,
      );
      check(empty === true, `a query that matches nothing says "No files match" in ${name}`);
      const statusLook = await web.inDoc(measureText, { status: '.mention-status' });
      check(
        statusLook.status !== null && statusLook.status.ratio >= 4.5,
        `the "No files match" line has contrast >= 4.5 in ${name} (${statusLook.status ? statusLook.status.ratio.toFixed(2) : 'not found'})`,
      );
    }
    await setTheme('Default Dark Modern');

    // --- Keyboard: the arrows move the highlight, Enter picks, nothing is sent ------------------
    check(await searchUntil('@sample', 2), 'the popup opens again in the dark theme');

    // --- Enter does nothing while the rows are those of an older text (decision W1, 22/10/2026) ---
    // One more key, then Enter at once: the 150 ms debounce has not fired, so the popup still shows
    // the rows of "@sample" for the text "@samplex". Nothing may be sent or picked.
    state = await ui();
    const messagesStale = state.messages;
    await page.keyboard.type('x');
    await page.keyboard.press('Enter');
    state = await ui();
    check(
      state.value === '@samplex' &&
        state.popup &&
        state.chips.length === 0 &&
        state.messages === messagesStale &&
        !state.busy,
      `Enter right after a keystroke neither sends nor picks (${JSON.stringify(state.value)}, ${String(state.chips.length)} chips, ${String(state.messages - messagesStale)} new messages)`,
    );
    check(
      await searchUntil('@sample', 2),
      'the popup lists again after the Enter that was ignored',
    );
    state = await ui();
    const wanted = state.rows.indexOf('src/sample.ts');
    const messagesBefore = state.messages;
    for (let i = 0; i < wanted; i += 1) await page.keyboard.press('ArrowDown');
    await sleep(250); // the highlight follows the keys in a later render; `ui()` reads it next
    state = await ui();
    check(
      state.selected === wanted && state.pointsAtSelected,
      `ArrowDown moves the highlight to src/sample.ts (row ${String(state.selected)} of ${state.rows.join(', ')})`,
    );
    await page.keyboard.press('Enter');
    await waitFor(async () => (await ui()).chips.length > 0, 10_000, 250);
    state = await ui();
    check(
      state.chips.length === 1 && state.chips[0] === 'src/sample.ts',
      `Enter adds the chip src/sample.ts (${state.chips.join(', ')})`,
    );
    check(
      state.value === '@src/sample.ts ',
      `the text @src/sample.ts stays in the box (${JSON.stringify(state.value)})`,
    );
    check(!state.popup, 'the popup closes after the pick');
    check(state.focusOnField, 'the focus is still in the prompt box after the pick');
    check(
      state.messages === messagesBefore && !state.busy,
      'Enter on the popup picks the file and does not send the prompt',
    );
    await shot('16c-mention-picked');

    // --- ArrowUp with the popup closed is the history again --------------------------------------
    await removeChips();
    await clearBox();
    await page.keyboard.press('ArrowUp');
    state = await ui();
    check(
      !state.popup && state.value !== '',
      `ArrowUp with the popup closed recalls the last prompt (${JSON.stringify(state.value.slice(0, 40))})`,
    );
    await clearBox();

    // --- Escape closes the popup and does NOT stop a running turn --------------------------------
    await send('Count from 1 to 400, one number per line. Do not use tools. LONG');
    const running = await waitFor(isBusy, 30_000, 300);
    check(running === true, 'the LONG turn is running, so Escape-versus-Stop can be tested');
    if (running === true) {
      await page.keyboard.type('@sample');
      const open = await waitFor(async () => (await ui()).rows.length > 0, 20_000, 250);
      check(open === true, 'the popup opens while a turn is running');
      await page.keyboard.press('Escape');
      await waitFor(async () => !(await ui()).popup, 3_000, 100);
      // Negative check below (the turn is NOT stopped): a fixed window after the positive wait.
      await sleep(300);
      state = await ui();
      check(!state.popup, 'Escape closes the popup');
      check(state.busy, 'Escape with the popup open does NOT stop the running turn');
      check(state.value === '@sample', 'Escape leaves the text as it was');
      await page.keyboard.press('Escape');
      check(await waitIdle(30_000), 'a second Escape (popup closed) stops the turn');
    }
    await clearBox();

    // --- Mouse: a press on a row picks it and keeps the focus in the box --------------------------
    check(await searchUntil('@sample', 2), 'the popup opens for the mouse pick');
    check(await clickIn('.mention-option[aria-label="src/sample.ts"]'), 'the row is pressed');
    await waitFor(async () => (await ui()).chips.length > 0, 10_000, 250);
    state = await ui();
    check(
      state.chips.length === 1 && state.chips[0] === 'src/sample.ts' && !state.popup,
      `a mouse press picks the row (${state.chips.join(', ')})`,
    );
    check(state.focusOnField, 'the focus is still in the prompt box after the mouse pick');
    check(
      state.value === '@src/sample.ts ',
      `the mouse pick writes the text too (${JSON.stringify(state.value)})`,
    );

    // --- The chip opens the file ------------------------------------------------------------------
    await closeAllEditors();
    check(await clickIn('.chips .chip-open'), 'the chip name is pressed');
    await waitFor(
      async () => (await page.locator('.tab.active[aria-label*="sample.ts"]').count()) > 0,
      4_000,
      100,
    );
    const tabs = await page.locator('.tab.active[aria-label*="sample.ts"]').count();
    check(tabs > 0, `pressing the chip opens src/sample.ts in the editor (${String(tabs)} tab)`);

    // --- Add selection: lines 2-3 of the active editor ---------------------------------------------
    await waitFor(
      () =>
        page.evaluate(
          () => (globalThis.document.activeElement?.closest('.monaco-editor') ?? null) !== null,
        ),
      2_000,
      100,
    );
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await waitFor(async () => (await editorSelection()).trim() !== '', 2_000, 100);
    console.log(`  editor selection: "${(await editorSelection()).trim()}"`);
    check(await clickButton('Add context'), 'the "+" button is pressed');
    await waitPresent('[role="menu"]');
    check(await clickButton('Add selection'), 'Add selection is pressed in the "+" menu');
    const ranged = await waitFor(
      async () => (await ui()).chips.includes('src/sample.ts#2-3'),
      10_000,
      250,
    );
    state = await ui();
    check(
      ranged === true,
      `Add selection adds the chip src/sample.ts#2-3 with the focus in the webview (${state.chips.join(', ')})`,
    );
    await shot('16d-add-selection');

    // --- Send with both chips and the typed mention -------------------------------------------------
    await focusPromptBox();
    await page.keyboard.press('End');
    await page.keyboard.type('Reply with exactly: OK. Do not use any tools.');
    await page.keyboard.press('Enter');
    const left = await waitFor(async () => (await ui()).sent.length >= 2, 20_000, 300);
    state = await ui();
    check(
      left === true &&
        state.sent.includes('src/sample.ts') &&
        state.sent.includes('src/sample.ts#2-3'),
      `the message left with both files ("${state.sent.join(', ')}")`,
    );
    check(state.chips.length === 0, 'the chips left the prompt box once sent');
    check(await waitIdle(30_000), 'the mention turn finished');
    await shot('16e-mention-sent');

    // --- The chip of the conversation opens the file at the start of its range --------------------
    await closeAllEditors();
    check(
      await clickIn('[role="log"] .message-files .chip-open[aria-label*="lines 2-3"]'),
      'the chip src/sample.ts#2-3 of the conversation is pressed',
    );
    await waitFor(async () => /Ln 2\b/.test(await editorSelection()), 4_000, 100);
    const selection = await editorSelection();
    const sampleTabs = await page.locator('.tab.active[aria-label*="sample.ts"]').count();
    check(
      sampleTabs > 0 && /Ln 2\b/.test(selection),
      `the conversation chip opens src/sample.ts at line 2 (status bar: "${selection.trim()}")`,
    );
    await shot('16f-chip-opens-line');

    state = await ui();
    check(
      state.styled === 0,
      `no inline style attribute in the webview body (${String(state.styled)})`,
    );
    assertNoWebviewErrors('@ mentions');
  });

  // Issue #25 (decisions of Sergio, 22/10/2026, Engram #1097): the dimmed context line under the
  // session title. Part 1: after a normal turn of the synthetic server (4248 tokens of a 200K
  // window) the line has no cost (the model is free) and the level is normal. Part 2: a COSTLY
  // turn on the `tiny-context` model (5000 tokens: 4248 is 85 %) shows the cost and the `high`
  // level. Both are measured for text, accessible sentence, tag, own attributes, `style`, width
  // and contrast in the four themes. The compaction line and `/compact` (issue #125) are judged in
  // step 33; here a compaction stays covered by the Vitest e2e. Self-contained: it makes its own sessions.
  await step('17 context and cost line (issue #25)', async () => {
    const THEMES = [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ];
    /** The line: text, names, level, style attributes and where it sits. Self-contained (serialized). */
    const line = () =>
      web.inDoc((doc) => {
        const element = doc.querySelector('.usage-line');
        if (!element) return null;
        const shown = element.querySelector('[aria-hidden="true"]');
        const spoken = element.querySelector('.visually-hidden');
        return {
          // The visible shorthand (the aria-hidden span) and the full sentence (visually hidden).
          text: shown?.textContent ?? '',
          label: spoken?.textContent ?? '',
          tooltip: shown?.getAttribute('title') ?? '',
          // What assistive tech reads: the text outside every aria-hidden subtree.
          readable: [...element.children]
            .filter((child) => child.getAttribute('aria-hidden') !== 'true')
            .map((child) => child.textContent ?? '')
            .join(''),
          tag: element.tagName,
          ownAria: ['role', 'aria-label', 'title'].filter((name) => element.hasAttribute(name)),
          level: element.getAttribute('data-level') ?? '',
          live: element.hasAttribute('aria-live') || element.closest('[aria-live]') !== null,
          styled: [...doc.querySelectorAll('body [style], body[style]')].filter(
            (e) => (e.getAttribute('style') ?? '').trim() !== '',
          ).length,
          underTitle:
            element.parentElement?.classList.contains('header-area') === true &&
            element.previousElementSibling?.classList.contains('chat-header') === true,
          overflowPx: element.scrollWidth - element.clientWidth,
        };
      });
    /**
     * Text/background contrast of the line. Self-contained (it is serialized into the page); the
     * colour maths is a copy of the one in {@link measureCode}. The base is the side bar background
     * (the webview body is transparent), and the line is painted over its ancestors.
     */
    const contrast = () =>
      web.inDoc((doc) => {
        const parse = (value) => {
          const text = String(value).trim();
          let match =
            /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(
              text,
            );
          if (match) {
            let alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
            if (match[4]?.endsWith('%')) alpha /= 100;
            return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
          }
          match = /^#([0-9a-f]{3,8})$/i.exec(text);
          if (match) {
            let hex = match[1];
            if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
            const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
            return [
              Number.parseInt(hex.slice(0, 2), 16),
              Number.parseInt(hex.slice(2, 4), 16),
              Number.parseInt(hex.slice(4, 6), 16),
              alpha,
            ];
          }
          return null;
        };
        const over = (front, back) =>
          [0, 1, 2].map((i) => front[i] * front[3] + back[i] * (1 - front[3])).concat([1]);
        const luminance = (color) => {
          const [r, g, b] = color.map((channel) => {
            const value = channel / 255;
            return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const win = doc.defaultView;
        const element = doc.querySelector('.usage-line');
        if (!element) return null;
        const root = win.getComputedStyle(doc.documentElement);
        const base =
          parse(root.getPropertyValue('--vscode-sideBar-background')) ??
          parse(root.getPropertyValue('--vscode-editor-background'));
        if (!base) return null;
        const chain = [];
        for (let node = element; node; node = node.parentElement) chain.unshift(node);
        let background = [base[0], base[1], base[2], 1];
        for (const node of chain) {
          const own = parse(win.getComputedStyle(node).backgroundColor);
          if (own && own[3] > 0) background = over(own, background);
        }
        const color = parse(win.getComputedStyle(element).color);
        if (!color) return null;
        const [high, low] = [luminance(over(color, background)), luminance(background)].sort(
          (x, y) => y - x,
        );
        return {
          ratio: (high + 0.05) / (low + 0.05),
          color: win.getComputedStyle(element).color,
          background: `rgb(${background.slice(0, 3).map(Math.round).join(', ')})`,
        };
      });

    assertNoWebviewErrors('before the context line step');
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();
    check((await line()) === null, 'a session that has not answered yet shows no context line');
    // The synthetic server reports 1200 + 40 + 8 + 3000 = 4248 tokens per step (`STEP_TOKENS`): of
    // a 200,000 window that is 2 %, shown as "4K / 200K" (`compactTokens` floors).
    await send('Reply with exactly: DONE');
    check(await waitIdle(30_000), 'the turn of the context line finished');
    // The usage of a step arrives with `step.ended`, a moment before the turn goes idle.
    const appeared = await waitFor(async () => (await line()) !== null, 20_000);
    check(appeared === true, 'the context line appears once a step has reported its tokens');
    const state = await line();
    console.log(`  line: ${JSON.stringify(state)}`);
    check(
      state !== null && /^Context \d+[KM]? \/ \d+[KM]? \(\d+%\)$/.test(state.text),
      `the text reads "Context <n>K / <limit>K (<p>%)" and nothing else, no cost for the free model (${JSON.stringify(state?.text)})`,
    );
    check(
      state?.text === 'Context 4K / 200K (2%)' &&
        state.label === 'Context: 4,248 tokens of 200,000 (2%).',
      `the figures are those of the step: 4248 tokens of 200000 (${JSON.stringify(state?.text)}, ${JSON.stringify(state?.label)})`,
    );
    check(
      state !== null &&
        /^Context: [\d,]+ tokens of [\d,]+ \(\d+%\)\.$/.test(state.label) &&
        state.readable === state.label,
      `what a screen reader reads is the full sentence once, the shorthand is aria-hidden (${JSON.stringify(state?.readable)})`,
    );
    check(
      state?.tag === 'P' &&
        state.ownAria.length === 0 &&
        state.tooltip === state.label &&
        state.live === false,
      `the line is a plain <p> with no role, aria-label or title of its own, the tooltip sits on the aria-hidden span, and it is not a live region (own: ${JSON.stringify(state?.ownAria)})`,
    );
    check(
      state?.level === 'normal',
      `one short turn leaves the context level normal (${state?.level})`,
    );
    check(state?.underTitle === true, 'the line sits in the header area right under the title bar');
    check(
      state?.styled === 0,
      `no inline style attribute in the webview body (${String(state?.styled)})`,
    );
    check(
      state !== null && state.overflowPx <= 1,
      `the line fits its width, nothing is cut (overflow ${String(state?.overflowPx)} px)`,
    );

    /** Measures the contrast of the line in the four themes; `tag` names the state and the shots. */
    const contrastInThemes = async (tag) => {
      for (const [name, theme] of THEMES) {
        await setTheme(theme);
        const look = await contrast();
        console.log(`  line contrast ${tag} ${name}: ${JSON.stringify(look)}`);
        check(
          look !== null && look.ratio >= 4.5,
          `the ${tag} context line has text contrast >= 4.5 in ${name} (${look ? look.ratio.toFixed(2) : 'not found'})`,
        );
        await shot(`17-context-line-${tag}-${name}`);
      }
      await setTheme('Default Dark Modern');
    };
    await contrastInThemes('normal');

    // --- Part 2: a COSTLY turn on a 5000-token window: the cost and the `high` level ---------
    check(await clickButton('New session'), 'New session is pressed for the costly turn');
    await waitEmptyView();
    check(await clickIn('button.agent-model-chip'), 'the agent and model chip is pressed');
    await waitPresent('.model-panel');
    check(
      await clickIn('.model-panel button.model-option[data-model="opencode/tiny-context"]'),
      'the model with the 5000-token window is chosen',
    );
    // A choice leaves the panel open (01/11/2026): Escape closes it before the prompt.
    await page.keyboard.press('Escape');
    await waitPresent('.model-panel', false);
    await send('Reply with exactly: DONE. COSTLY');
    check(await waitIdle(30_000), 'the costly turn finished');
    const costly = await waitFor(async () => {
      const current = await line();
      return current !== null && current.text.includes('$') ? current : undefined;
    }, 20_000);
    const high = costly ?? (await line());
    console.log(`  costly line: ${JSON.stringify(high)}`);
    check(
      high?.text === 'Context 4K / 5K (85%) · $0.01',
      `the line shows the context of the small window and the cost (${JSON.stringify(high?.text)})`,
    );
    check(
      high?.label === 'Context: 4,248 tokens of 5,000 (85%). Session cost: $0.01.' &&
        high.readable === high.label,
      `the sentence for a screen reader holds the exact figures and the cost (${JSON.stringify(high?.readable)})`,
    );
    check(
      high?.level === 'high',
      `85 % of the window flags the line as high (${String(high?.level)})`,
    );
    check(
      high?.tag === 'P' && high.ownAria.length === 0 && high.live === false && high.styled === 0,
      `the costly line is still a plain <p> with no own attributes, no live region and no style attribute (own: ${JSON.stringify(high?.ownAria)}, style: ${String(high?.styled)})`,
    );
    check(
      high !== null && high.overflowPx <= 1,
      `the costly line fits its width (overflow ${String(high?.overflowPx)} px)`,
    );
    await contrastInThemes('high');
    assertNoWebviewErrors('context line');
  });

  // Issue #31 (E7-session-diff): the "Changed files" list under the header and the native diff.
  // An EDIT_FILES turn of the synthetic server changes four files of the temporary workspace (in
  // `visual` mode it really writes them): a modified `src/sample.ts` (`value2 = 2` becomes `value2 =
  // 22`), an added `src/added.ts`, a deleted `src/removed.ts` (this step creates it first) and an
  // added binary `assets/logo.png`. The step opens the list with the real mouse, reads the rows,
  // measures their contrast in the four themes, opens each kind of row and looks at the workbench:
  // the diff editor with the original on the left and the file on the right, an empty right side
  // for the deleted one, an empty left side for the added one, and the image itself (no diff) for
  // the binary. The deleted row is reached with the keyboard (Tab, Tab, Tab, Enter) to prove a row
  // is a button a keyboard user can press.
  await step('18 changed files and native diff (issue #31)', async () => {
    const THEMES = [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ];
    // Side by side even in a narrow editor group: the inline view would hide the left side.
    writeSettings(vscode.userDataDir, {
      'diffEditor.renderSideBySide': true,
      'diffEditor.useInlineViewWhenSpaceIsLimited': false,
    });
    // The file the turn deletes has to exist before the turn.
    fs.writeFileSync(path.join(workspace, 'src', 'removed.ts'), 'export const removed = true;\n');
    assertNoWebviewErrors('before the changed files step');
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();

    /** The list: summary text, whether it is open, and the rows with their words and names. */
    const list = () =>
      web.inDoc((doc) => {
        const details = doc.querySelector('details.changed-files');
        if (!details) return null;
        const area = doc.querySelector('.header-area');
        return {
          summary: details.querySelector('summary')?.textContent ?? '',
          open: details.open,
          inHeaderArea: details.parentElement === area,
          rows: [...details.querySelectorAll('button.changed-file')].map((button) => ({
            path: button.querySelector('.session-title')?.textContent ?? '',
            meta: button.querySelector('.session-meta')?.textContent ?? '',
            name: button.getAttribute('aria-label') ?? '',
          })),
          styled: [...doc.querySelectorAll('body [style], body[style]')].filter(
            (e) => (e.getAttribute('style') ?? '').trim() !== '',
          ).length,
          overflowPx: details.scrollWidth - details.clientWidth,
        };
      });
    check((await list()) === null, 'a new session shows no "Changed files"');

    await send('EDIT_FILES: change a few files');
    check(await waitIdle(30_000), 'the edit turn finished');
    const appeared = await waitFor(async () => (await list()) !== null, 20_000);
    check(appeared !== undefined, 'the "Changed files" list appears once the step reports files');
    const closed = await list();
    console.log(`  list: ${JSON.stringify(closed)}`);
    check(
      closed?.summary === 'Changed files (4)',
      `the summary counts the files (${JSON.stringify(closed?.summary)})`,
    );
    check(closed?.open === false, 'the list is closed by default');
    check(closed?.inHeaderArea === true, 'the list sits in the header area under the title bar');
    check(
      closed?.styled === 0,
      `no inline style attribute in the body (${String(closed?.styled)})`,
    );
    await shot('18a-changed-files-closed');

    // Open it with the real mouse on the summary.
    check(await clickIn('details.changed-files > summary'), 'the summary is pressed');
    const opened = await waitFor(async () => (await list())?.open === true, 5_000, 200);
    check(opened === true, 'a press on the summary opens the list');
    const rows = (await list())?.rows ?? [];
    console.log(`  rows: ${JSON.stringify(rows)}`);
    check(
      JSON.stringify(rows.map((row) => [row.path, row.meta])) ===
        JSON.stringify([
          ['assets/logo.png', 'Binary'],
          ['src/added.ts', 'Added · +1 −0'],
          ['src/removed.ts', 'Deleted · +0 −1'],
          ['src/sample.ts', 'Modified · +1 −1'],
        ]),
      `the rows say the path, the status in words and the counts (${rows.map((row) => `${row.path}: ${row.meta}`).join(' | ')})`,
    );
    check(
      rows.length === 4 &&
        rows[3]?.name === 'Open diff of src/sample.ts, Modified, 1 added, 1 deleted' &&
        rows[0]?.name === 'Open assets/logo.png, Binary',
      `each row is a button with a sentence for its name (${rows.map((row) => row.name).join(' | ')})`,
    );
    check(
      ((await list())?.overflowPx ?? 99) <= 1,
      `the list fits its width (overflow ${String((await list())?.overflowPx)} px)`,
    );
    await shot('18b-changed-files-open');

    // --- Contrast of the summary, the path and the status line, four themes -------------------
    for (const [name, theme] of THEMES) {
      await setTheme(theme);
      const look = await web.inDoc(measureText, {
        summary: 'details.changed-files > summary',
        path: 'button.changed-file .session-title',
        meta: 'button.changed-file .session-meta',
      });
      console.log(`  changed files ${name}: ${JSON.stringify(look)}`);
      for (const [part, measured] of Object.entries(look)) {
        check(
          measured !== null && measured !== undefined && measured.ratio >= 4.5,
          `the ${part} text of the changed files has contrast >= 4.5 in ${name} (${measured ? measured.ratio.toFixed(2) : 'not found'})`,
        );
      }
      await shot(`18c-changed-files-${name}`);
    }
    await setTheme('Default Dark Modern');

    /** The two sides of the diff editor in view, as text; `null` when no diff editor is shown. */
    const diffSides = () =>
      page.evaluate(() => {
        const editor = globalThis.document.querySelector('.monaco-diff-editor');
        if (!editor) return null;
        const read = (side) =>
          [...editor.querySelectorAll(`.editor.${side} .view-line`)]
            .map((line) => (line.textContent ?? '').replace(/\u00a0/g, ' '))
            .join('\n');
        return { original: read('original'), modified: read('modified') };
      });
    /** Waits for the active tab named `file` with a diff editor whose left side has settled. */
    const waitForDiff = (file) =>
      waitFor(
        async () => {
          const tabs = await page.locator(`.tab.active[aria-label*="${file}"]`).count();
          const sides = await diffSides();
          // Monaco renders the lines a moment after the editor exists: wait for some text.
          const drawn = sides !== null && (sides.original !== '' || sides.modified !== '');
          return tabs > 0 && drawn ? sides : undefined;
        },
        15_000,
        300,
      );

    // --- The modified file, by a real mouse press -------------------------------------------------
    check(
      await clickIn('button.changed-file[aria-label*="src/sample.ts"]'),
      'the row of src/sample.ts is pressed',
    );
    const modified = await waitForDiff('sample.ts');
    check(modified !== undefined, 'a diff editor opens in the active tab "sample.ts"');
    console.log(`  modified sides: ${JSON.stringify(modified)}`);
    check(
      modified?.original.includes('export const value2 = 2;') === true &&
        !modified.original.includes('value2 = 22'),
      'the LEFT side holds the original line (value2 = 2)',
    );
    check(
      modified?.modified.includes('export const value2 = 22;') === true,
      'the RIGHT side holds the new line (value2 = 22)',
    );
    const title = await page.locator('.tab.active[aria-label*="sample.ts"]').first().innerText();
    check(
      title.includes('(OpenCode session)'),
      `the tab is titled with the path and "(OpenCode session)" (${JSON.stringify(title)})`,
    );
    await shot('18d-diff-modified');
    await closeAllEditors();

    // --- The deleted file, with the keyboard ----------------------------------------------------
    await clickIn('details.changed-files > summary'); // focus enters the iframe, closes the list
    await clickIn('details.changed-files > summary'); // and opens it again
    await waitPresent('details.changed-files[open]');
    for (let tabs = 0; tabs < 3; tabs++) {
      await page.keyboard.press('Tab');
      await sleep(150); // pace between Tab presses so the focus read sees each one
    }
    const focused = await web.inDoc((doc) => doc.activeElement?.getAttribute('aria-label') ?? '');
    check(
      focused === 'Open diff of src/removed.ts, Deleted, 0 added, 1 deleted',
      `three Tabs from the summary reach the deleted row (${JSON.stringify(focused)})`,
    );
    await page.keyboard.press('Enter');
    const deleted = await waitForDiff('removed.ts');
    check(deleted !== undefined, 'Enter on the deleted row opens a diff editor');
    console.log(`  deleted sides: ${JSON.stringify(deleted)}`);
    check(
      deleted?.original.includes('export const removed = true;') === true,
      'the LEFT side holds the text the session removed',
    );
    check(deleted?.modified.trim() === '', 'the RIGHT side of a deleted file is empty');
    await shot('18e-diff-deleted');
    await closeAllEditors();

    // --- The added file ---------------------------------------------------------------------------
    check(
      await clickIn('button.changed-file[aria-label*="src/added.ts"]'),
      'the row of src/added.ts is pressed',
    );
    const added = await waitForDiff('added.ts');
    check(added !== undefined, 'a diff editor opens for the added file');
    console.log(`  added sides: ${JSON.stringify(added)}`);
    check(added?.original.trim() === '', 'the LEFT side of an added file is empty');
    check(
      added?.modified.includes('export const added = true;') === true,
      'the RIGHT side holds the new file',
    );
    await shot('18f-diff-added');
    await closeAllEditors();

    // --- The binary: no diff, the file itself and a notice ----------------------------------------
    check(
      await clickIn('button.changed-file[aria-label*="logo.png"]'),
      'the row of assets/logo.png is pressed',
    );
    const logoTab = await waitFor(
      async () => (await page.locator('.tab.active[aria-label*="logo.png"]').count()) > 0,
      15_000,
      300,
    );
    check(logoTab === true, 'the binary opens its own file in the active tab "logo.png"');
    check((await diffSides()) === null, 'a binary opens no diff editor');
    const told = await waitFor(
      () => web.inDoc((doc) => (doc.body?.innerText ?? '').includes('no text diff for this file')),
      10_000,
      300,
    );
    check(told === true, 'the chat says there is no text diff for that file');
    await shot('18g-binary-opened');
    await closeAllEditors();

    assertNoWebviewErrors('changed files');
  });

  // Issue #32 (E7-message-revert): revert from a message, in a real VS Code. The synthetic server
  // really rewrites the workspace (visual mode), so the disk is read back. Also the pending
  // evidence of #31: an open "Changed files" diff tab re-reads its left side after a committed
  // revert (point 5 below).
  await step('19 revert from a message (issue #32)', async () => {
    const THEMES = [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ];
    const SAMPLE_HEADER = '// Sample file for the visual test run.\n';
    const sampleFile = path.join(workspace, 'src', 'sample.ts');
    const removedFile = path.join(workspace, 'src', 'removed.ts');
    const addedFile = path.join(workspace, 'src', 'added.ts');
    const logoFile = path.join(workspace, 'assets', 'logo.png');
    const bigFile = path.join(workspace, 'docs', 'big.txt');
    const readText = (file) => {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    };
    const dialog = page.locator('.monaco-dialog-box');
    writeSettings(vscode.userDataDir, {
      'diffEditor.renderSideBySide': true,
      'diffEditor.useInlineViewWhenSpaceIsLimited': false,
    });
    await setTheme('Default Dark Modern');
    await closeAllEditors();
    // The turn starts from a known disk: step 18 left its own files behind.
    fs.writeFileSync(sampleFile, `${SAMPLE_HEADER}export const value2 = 2;\n`);
    fs.writeFileSync(removedFile, 'export const removed = true;\n');
    for (const file of [addedFile, logoFile, bigFile]) fs.rmSync(file, { force: true });
    assertNoWebviewErrors('before the revert step');
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();

    /** What the page shows about the revert: the log, the block, the draft and the changed files. */
    const view = () =>
      web.inDoc((doc) => {
        const log = doc.querySelector('[role="log"]');
        const banner = doc.querySelector('.revert-banner');
        const details = doc.querySelector('details.changed-files');
        return {
          messages: log?.querySelectorAll('.message').length ?? 0,
          draft: doc.querySelector('textarea')?.value ?? '',
          changedSummary: details?.querySelector('summary')?.textContent ?? null,
          banner:
            banner === null
              ? null
              : {
                  title: banner.querySelector('.revert-banner-title')?.textContent ?? '',
                  caption: banner.querySelector('.revert-banner-caption')?.textContent ?? '',
                  insideLog: log?.contains(banner) ?? false,
                  rows: [...banner.querySelectorAll('button.changed-file')].map((button) => ({
                    path: button.querySelector('.session-title')?.textContent ?? '',
                    meta: button.querySelector('.session-meta')?.textContent ?? '',
                    name: button.getAttribute('aria-label') ?? '',
                  })),
                  buttons: [...banner.querySelectorAll('.revert-banner-actions button')].map(
                    (button) => button.textContent ?? '',
                  ),
                },
          styled: [...doc.querySelectorAll('body [style], body[style]')].filter(
            (e) => (e.getAttribute('style') ?? '').trim() !== '',
          ).length,
        };
      });
    /** The two sides of the diff editor in view, as text; `null` when no diff editor is shown. */
    const diffSides = () =>
      page.evaluate(() => {
        const editor = globalThis.document.querySelector('.monaco-diff-editor');
        if (!editor) return null;
        const read = (side) =>
          [...editor.querySelectorAll(`.editor.${side} .view-line`)]
            .map((line) => (line.textContent ?? '').replace(/\u00a0/g, ' '))
            .join('\n');
        return { original: read('original'), modified: read('modified') };
      });
    const waitForDiff = (file) =>
      waitFor(
        async () => {
          const tabs = await page.locator(`.tab.active[aria-label*="${file}"]`).count();
          const sides = await diffSides();
          const drawn = sides !== null && (sides.original !== '' || sides.modified !== '');
          return tabs > 0 && drawn ? sides : undefined;
        },
        15_000,
        300,
      );

    // --- A turn that changes five files (one of them too large to diff) -----------------------
    await send('EDIT_FILES LARGE: change a few files');
    check(await waitIdle(30_000), 'the edit turn finished');
    const listed = await waitFor(async () => (await view()).changedSummary !== null, 20_000);
    check(listed !== undefined, 'the "Changed files" list appears');
    check(
      (await view()).changedSummary === 'Changed files (5)',
      `the summary counts five files (${JSON.stringify((await view()).changedSummary)})`,
    );
    check(await clickIn('details.changed-files > summary'), 'the summary is pressed');
    await waitPresent('details.changed-files[open]');
    const largeRow = await web.inDoc((doc) => {
      const button = doc.querySelector(
        'details.changed-files button.changed-file[data-status="too-large"]',
      );
      return button === null
        ? null
        : {
            path: button.querySelector('.session-title')?.textContent ?? '',
            meta: button.querySelector('.session-meta')?.textContent ?? '',
            name: button.getAttribute('aria-label') ?? '',
          };
    });
    console.log(`  too large row: ${JSON.stringify(largeRow)}`);
    check(
      largeRow?.path === 'docs/big.txt' && largeRow.meta === 'Too large to diff · +1200 −0',
      `a file whose patch was cut says "Too large to diff · +A −D" (${JSON.stringify(largeRow?.meta)})`,
    );
    check(
      largeRow?.name === 'Open docs/big.txt, Too large to diff, 1200 added, 0 deleted',
      `its accessible name is a sentence (${JSON.stringify(largeRow?.name)})`,
    );
    for (const [name, theme] of THEMES) {
      await setTheme(theme);
      const look = await web.inDoc(measureText, {
        meta: 'button.changed-file[data-status="too-large"] .session-meta',
        path: 'button.changed-file[data-status="too-large"] .session-title',
      });
      for (const [part, measured] of Object.entries(look)) {
        check(
          measured !== null && measured !== undefined && measured.ratio >= 4.5,
          `the ${part} text of the too-large row has contrast >= 4.5 in ${name} (${measured ? measured.ratio.toFixed(2) : 'not found'})`,
        );
      }
      await shot(`19a-too-large-${name}`);
    }
    await setTheme('Default Dark Modern');

    // --- Open the diff of sample.ts and LEAVE it open (pinned) ---------------------------------
    check(
      await clickIn('details.changed-files button.changed-file[aria-label*="src/sample.ts"]'),
      'the row of src/sample.ts is pressed',
    );
    const first = await waitForDiff('sample.ts');
    check(
      first?.original.includes('export const value2 = 2;') === true,
      'the diff opened from "Changed files" has value2 = 2 on the left',
    );
    await command('View: Keep Editor');

    // --- Revert from the message, with the real mouse -----------------------------------------
    check(
      await clickIn('button.message-action[aria-label^="Revert from here"]'),
      'Revert from here is pressed',
    );
    const staged = await waitFor(async () => (await view()).banner !== null, 20_000, 300);
    check(staged !== undefined, 'the revert block appears');
    await waitFor(async () => (await view()).messages === 0, 4_000, 100);
    const afterStage = await view();
    console.log(`  after stage: ${JSON.stringify(afterStage)}`);
    check(afterStage.messages === 0, 'the reverted messages are not in the conversation');
    check(
      afterStage.banner?.title === '1 message reverted',
      `the block says "1 message reverted" (${JSON.stringify(afterStage.banner?.title)})`,
    );
    check(afterStage.banner?.insideLog === false, 'the block is outside the log');
    check(
      afterStage.banner?.caption === '5 files changed on disk',
      `the block says how many files changed on disk (${JSON.stringify(afterStage.banner?.caption)})`,
    );
    check(
      JSON.stringify(afterStage.banner?.rows.map((row) => [row.path, row.meta])) ===
        JSON.stringify([
          ['assets/logo.png', 'Binary'],
          ['docs/big.txt', 'Too large to diff · +1200 −0'],
          ['src/added.ts', 'Deleted · +0 −1'],
          ['src/removed.ts', 'Added · +1 −0'],
          ['src/sample.ts', 'Modified · +1 −1'],
        ]),
      `the rows are the files the revert changed, seen from the revert (${afterStage.banner?.rows.map((row) => `${row.path}: ${row.meta}`).join(' | ')})`,
    );
    check(
      afterStage.banner?.rows[4]?.name ===
        'Show what the revert undid in src/sample.ts, Modified, 1 added, 1 deleted',
      `a row's name says it shows what the revert undid (${JSON.stringify(afterStage.banner?.rows[4]?.name)})`,
    );
    check(
      JSON.stringify(afterStage.banner?.buttons) ===
        JSON.stringify(['Restore', 'Discard for good']),
      'the block has Restore and Discard for good',
    );
    check(
      afterStage.draft === 'EDIT_FILES LARGE: change a few files',
      `the prompt got the text of the message back (${JSON.stringify(afterStage.draft)})`,
    );
    const gone = await waitFor(async () => (await view()).changedSummary === null, 10_000, 300);
    check(gone !== undefined, '"Changed files" shows only what is visible: nothing');
    check(afterStage.styled === 0, 'no inline style attribute in the body');
    check(
      readText(sampleFile) === `${SAMPLE_HEADER}export const value2 = 2;\n`,
      'the disk was restored: src/sample.ts has value2 = 2 again',
    );
    check(
      !fs.existsSync(addedFile),
      'the disk was restored: src/added.ts (created by the turn) is gone',
    );
    check(
      readText(removedFile) === 'export const removed = true;\n',
      'the disk was restored: src/removed.ts (deleted by the turn) is back',
    );
    check(
      !fs.existsSync(logoFile) && !fs.existsSync(bigFile),
      'the files the turn created are gone',
    );
    await shot('19b-revert-staged');

    // Contrast of the block, four themes.
    for (const [name, theme] of THEMES) {
      await setTheme(theme);
      const look = await web.inDoc(measureText, {
        title: '.revert-banner-title',
        note: '.revert-banner-note',
        caption: '.revert-banner-caption',
        path: '.revert-banner button.changed-file .session-title',
        meta: '.revert-banner button.changed-file .session-meta',
        restore: '.revert-banner-actions button',
      });
      console.log(`  revert block ${name}: ${JSON.stringify(look)}`);
      for (const [part, measured] of Object.entries(look)) {
        check(
          measured !== null && measured !== undefined && measured.ratio >= 4.5,
          `the ${part} text of the revert block has contrast >= 4.5 in ${name} (${measured ? measured.ratio.toFixed(2) : 'not found'})`,
        );
      }
      await shot(`19c-revert-block-${name}`);
    }
    await setTheme('Default Dark Modern');

    // --- What the revert undid, by a real press on a row --------------------------------------
    check(
      await clickIn('.revert-banner button.changed-file[aria-label*="src/sample.ts"]'),
      'the row of src/sample.ts in the revert block is pressed',
    );
    const undone = await waitFor(
      async () => {
        const sides = await diffSides();
        const title = await page
          .locator('.tab.active[aria-label*="sample.ts"]')
          .first()
          .innerText()
          .catch(() => '');
        return sides !== null &&
          title.includes('(before the revert)') &&
          sides.original.includes('value2 = 22')
          ? { sides, title }
          : undefined;
      },
      15_000,
      300,
    );
    check(undone !== undefined, 'a diff editor titled "(before the revert)" opens');
    console.log(`  undone sides: ${JSON.stringify(undone)}`);
    check(
      undone?.sides.original.includes('export const value2 = 22;') === true,
      'the LEFT side holds the text before the revert (value2 = 22)',
    );
    check(
      undone?.sides.modified.includes('export const value2 = 2;') === true &&
        !undone.sides.modified.includes('value2 = 22'),
      'the RIGHT side holds the file now on disk (value2 = 2)',
    );
    check(
      (await page.locator('.tab[aria-label*="(OpenCode session)"]').count()) === 1,
      'the pinned "Changed files" diff tab is still open',
    );
    await shot('19d-diff-undone');

    // --- Restore ---------------------------------------------------------------------------------
    check(await clickButton('Restore'), 'Restore is pressed');
    const restored = await waitFor(
      async () => {
        const state = await view();
        return state.banner === null && state.messages === 2 ? state : undefined;
      },
      20_000,
      300,
    );
    check(restored !== undefined, 'Restore brings the two messages back and removes the block');
    check(
      readText(sampleFile) === `${SAMPLE_HEADER}export const value2 = 22;\n` &&
        fs.existsSync(addedFile) &&
        !fs.existsSync(removedFile),
      'Restore put the files back as the turn left them (value2 = 22, added.ts, no removed.ts)',
    );
    const again = await waitFor(
      async () => (await view()).changedSummary === 'Changed files (5)',
      15_000,
      300,
    );
    check(again !== undefined, '"Changed files (5)" is back after Restore');
    await shot('19e-restored');

    // --- Revert again and Discard for good, with the native modal ------------------------------
    check(
      await clickIn('button.message-action[aria-label^="Revert from here"]'),
      'Revert from here is pressed again',
    );
    check(
      (await waitFor(async () => (await view()).banner !== null, 20_000, 300)) !== undefined,
      'the block appears again',
    );
    check(await clickButton('Discard for good'), 'Discard for good is pressed');
    const modal = await waitFor(
      async () => ((await dialog.count()) ? await dialog.first().innerText() : null),
      10_000,
      300,
    );
    check(
      modal !== undefined && modal !== null && /cannot be undone/i.test(modal),
      `a modal dialog of VS Code asks and says it cannot be undone (${String(modal).replace(/\s+/g, ' ').slice(0, 160)})`,
    );
    if (modal === undefined || modal === null)
      throw new Error('the confirmation modal never appeared');
    await shot('19f-discard-modal');
    // Nothing is discarded before the answer; Cancel keeps the block.
    await dialog
      .first()
      .getByRole('button', { name: /^Cancel$/ })
      .click();
    // Fixed on purpose: negative check (Cancel changes nothing), no positive signal to wait for.
    await page.waitForTimeout(800);
    check((await view()).banner !== null, 'Cancel keeps the revert prepared');
    await clickIn('textarea'); // the native dialog took the keyboard focus out of the page
    check(await clickButton('Discard for good'), 'Discard for good is pressed once more');
    check(
      (await waitFor(async () => ((await dialog.count()) ? true : undefined), 10_000, 300)) ===
        true,
      'the modal appears again',
    );
    await dialog
      .first()
      .getByRole('button', { name: /^Discard for good$/ })
      .click();
    const discarded = await waitFor(
      async () => {
        const state = await view();
        return state.banner === null && state.messages === 0 ? state : undefined;
      },
      20_000,
      300,
    );
    check(discarded !== undefined, 'the history is deleted and the block is gone');
    check((await dialog.count()) === 0, 'the dialog is closed');
    check(
      readText(sampleFile) === `${SAMPLE_HEADER}export const value2 = 2;\n` &&
        !fs.existsSync(addedFile),
      'the files stay as the revert left them (a commit touches no file)',
    );
    await shot('19g-discarded');

    // --- Point 5 of #31: an open diff tab re-reads its left side after a committed revert -------
    // The pinned tab is brought to the front BEFORE the turn and not touched afterwards, so what
    // it shows at the end was pushed by the provider (`onDidChange`), not re-read on activation.
    await page.locator('.tab[aria-label*="(OpenCode session)"]').first().click();
    await waitFor(async () => (await diffSides()) !== null, 3_000, 100);
    const shownBefore = await diffSides();
    console.log(`  pinned tab before the turn: ${JSON.stringify(shownBefore)}`);
    check(
      shownBefore !== null && !shownBefore.original.includes('value2 = 5'),
      'the pinned diff tab is in front and does not show value2 = 5 yet',
    );
    fs.writeFileSync(sampleFile, `${SAMPLE_HEADER}export const value2 = 5;\n`);
    // The editor has the keyboard focus now: `send` enters the chat first with a focus that stays
    // (`focusPromptBox`), or the typing would land in the file (#94: a single focused read did not
    // guard against the late focus move back to the editor).
    await send('EDIT_FILES: again');
    check(await waitIdle(30_000), 'the second edit turn finished');
    // Waits for BOTH sides: the left one updates first, and on 28/10/2026 (Windows 11, VS Code
    // 1.143.1) a wait on the left alone read "value2 = 5" on both sides, failing the check of the
    // right in two full runs and in `--steps 19` (the 800 ms sleep before #89 hid it). Each side is
    // still judged on its own, from the last read.
    const renewed =
      (await waitFor(
        async () => {
          const sides = await diffSides();
          return sides?.original.includes('export const value2 = 5;') &&
            sides.modified.includes('export const value2 = 52;')
            ? sides
            : undefined;
        },
        20_000,
        400,
      )) ?? (await diffSides());
    console.log(`  renewed sides: ${JSON.stringify(renewed)}`);
    check(
      renewed?.original.includes('export const value2 = 5;') === true,
      'the diff tab opened before the revert now shows value2 = 5 on the left, without reopening it',
    );
    check(
      renewed?.modified.includes('export const value2 = 52;') === true,
      'and the new text (value2 = 52) on the right',
    );
    await shot('19h-diff-renewed');
    const toasts = await page.locator('.notification-toast').allInnerTexts();
    check(
      toasts.every((text) => !/DiffNotListed|not among the files|NoTextDiff|Unknown/i.test(text)),
      `no error notification came from the provider's rejections (${JSON.stringify(toasts).slice(0, 200)})`,
    );
    await closeAllEditors();
    assertNoWebviewErrors('revert');
  });

  // Issue #30. The PASTE is real (a PNG on the system clipboard and the real keyboard); the DROP is
  // synthetic (`isTrusted: false` events with a `DataTransfer` that carries `resourceurls`): it
  // proves our handler and the host, NOT that VS Code delivers a drag to the webview. A real drag
  // from the Explorer is not automated here (the chat and the Explorer cannot share a side bar
  // without moving a view), so that half stays UNVERIFIED. This step writes the system clipboard
  // (image, then text); {@link withSavedClipboard} saves the user's text or image first and gives
  // it back at the end, also on a failure (anything else on it is lost, with a warning).
  const dropAndPaste = async () => {
    const THEMES = [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ];
    const PNG_B64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const NO_IMAGES = 'The selected model cannot read images: it will be told so';
    /** The URI string VS Code's Explorer writes in `resourceurls` (`URI.toString()`, F2 of the plan). */
    const vsUri = (file) => {
      const slashed = file.replace(/\\/g, '/');
      const drive = /^([A-Za-z]):(.*)$/.exec(slashed);
      return drive
        ? `file:///${drive[1].toLowerCase()}%3A${encodeURI(drive[2])}`
        : `file://${encodeURI(slashed)}`;
    };
    const ui = () =>
      web.inDoc((doc) => {
        const field = doc.querySelector('textarea.prompt-text');
        const thumb = doc.querySelector('.chips img.chip-thumb');
        return {
          value: field?.value ?? '',
          chips: [...doc.querySelectorAll('.chips .chip-open, .chips .chip-name')].map(
            (c) => c.textContent ?? '',
          ),
          thumbLoaded: thumb ? thumb.complete && thumb.naturalWidth > 0 : null,
          drop: doc.querySelector('form.prompt')?.getAttribute('data-drop') ?? '',
          hint: doc.querySelector('.drop-hint')?.textContent ?? '',
          alerts: doc.querySelectorAll('[role="alert"]').length,
          text: doc.body?.innerText ?? '',
          sent: [...doc.querySelectorAll('[role="log"] .message-files .chip')].map(
            (c) => c.textContent ?? '',
          ),
          styled: [...doc.querySelectorAll('body [style], body[style]')].filter(
            (e) => (e.getAttribute('style') ?? '').trim() !== '',
          ).length,
        };
      });
    const count = (text, phrase) => text.split(phrase).length - 1;
    /** Puts the PNG on the system clipboard: the page's own API first, PowerShell on Windows next. */
    const clipboardImage = async () => {
      const viaPage = await page.evaluate(async (b64) => {
        try {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          await navigator.clipboard.write([
            new globalThis.ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) }),
          ]);
          return true;
        } catch (error) {
          return String(error);
        }
      }, PNG_B64);
      if (viaPage === true) return 'navigator.clipboard';
      if (process.platform !== 'win32') throw new Error(`no way to set the clipboard: ${viaPage}`);
      const file = path.join(workDir, 'clipboard.png');
      fs.writeFileSync(file, Buffer.from(PNG_B64, 'base64'));
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-STA',
          '-Command',
          `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('${file}'))`,
        ],
        { windowsHide: true },
      );
      return `powershell (page API said: ${viaPage})`;
    };
    // The page's `navigator.clipboard.write*` is denied in the workbench ("Write permission
    // denied", seen in this step), so the text goes through the OS too.
    const clipboardText = (text) => {
      if (process.platform !== 'win32') throw new Error('no way to set the text clipboard here');
      execFileSync(
        'powershell',
        ['-NoProfile', '-STA', '-Command', `Set-Clipboard -Value '${text}'`],
        {
          windowsHide: true,
        },
      );
    };
    const pasteIntoBox = async () => {
      check(await clickIn('textarea'), 'the prompt box is clicked');
      await sleep(300); // the click moves the focus into the iframe; the paste goes to the focused box
      await web.inDoc((doc) => {
        // Diagnostics only: what the paste event of the page carried (types, never contents).
        doc.defaultView.__lastPaste = undefined;
        doc.addEventListener(
          'paste',
          (event) => {
            doc.defaultView.__lastPaste = [...(event.clipboardData?.items ?? [])].map(
              (item) => `${item.kind}:${item.type}`,
            );
          },
          { capture: true, once: true },
        );
      });
      await page.keyboard.press('ControlOrMeta+V');
      await waitFor(
        async () => (await web.inDoc((doc) => doc.defaultView.__lastPaste ?? null)) !== null,
        3_000,
        100,
      );
      const seen = await web.inDoc((doc) => doc.defaultView.__lastPaste ?? null);
      console.log(`  paste event items: ${JSON.stringify(seen)}`);
      return seen;
    };
    /**
     * Puts the PNG on the clipboard and pastes, up to three times, but ONLY when the clipboard was
     * empty: the clipboard written by a short-lived PowerShell was seen to be gone at the first
     * paste of one run, which shows as a paste event WITHOUT `file:image/png`. If the event did
     * carry the image and there is still no chip, the fault is ours (onPaste, readImage or the
     * host) and the step fails at once instead of being retried into a pass (review of
     * 23/10/2026, W3). Every try says which of the two it was.
     */
    const pasteImage = async () => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        console.log(`  clipboard set through ${await clipboardImage()} (try ${String(attempt)})`);
        const seen = await pasteIntoBox();
        // The chip comes a moment after the paste event (the image is read first): read at once it
        // was missing in two full runs and in `--steps 20` on 28/10/2026, once #89 turned the 1.2 s
        // sleep after Ctrl+V into a wait for the event. A paste without the image never gets one.
        const chipped = seen?.includes('file:image/png')
          ? await waitFor(async () => (await ui()).chips.length > 0, 3_000, 100)
          : (await ui()).chips.length > 0;
        if (chipped) return attempt;
        if (seen?.includes('file:image/png')) {
          throw new Error(
            `the paste event carried the image (${JSON.stringify(seen)}) but no chip appeared: our bug, not an empty clipboard`,
          );
        }
        console.log(`  try ${String(attempt)}: the clipboard was empty (environment), retrying`);
      }
      return 0;
    };
    const removeChips = async () => {
      for (let guard = 0; guard < 6 && (await ui()).chips.length > 0; guard += 1) {
        await clickIn('.chips .chip-remove');
        await sleep(200); // one chip gone per round: the re-render has no signal apart from the count read next
      }
    };

    writeSettings(vscode.userDataDir, { 'openVsCode.defaultModel': 'opencode/big-pickle' });
    await setTheme('Default Dark Modern');
    assertNoWebviewErrors('before the drop and paste step');
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();

    // --- Paste a real image with the real keyboard (HYPOTHESIS F6 of the plan) ------------------
    console.log(`  tries needed: ${String(await pasteImage())}`);
    let state = await ui();
    console.log(`  after paste: ${JSON.stringify({ ...state, text: undefined })}`);
    check(
      state.chips.includes('Pasted image 1'),
      'Ctrl+V with an image on the clipboard adds the chip "Pasted image 1"',
    );
    check(state.value === '', 'and writes no text in the prompt box');
    check(
      state.thumbLoaded === true,
      'the chip shows a thumbnail that loaded (blob: allowed by the CSP)',
    );
    check(
      count(state.text, NO_IMAGES) === 1,
      'a model that cannot read images gets one warning ("The selected model cannot read images")',
    );
    await shot('20a-pasted-image');

    // --- A text paste still writes text and adds no chip ---------------------------------------
    await clipboardText('hello from the clipboard');
    await pasteIntoBox();
    state = await ui();
    check(
      state.value.includes('hello from the clipboard') && state.chips.length === 1,
      'a text paste writes text and adds no chip',
    );
    await shot('20b-text-pasted');

    // --- Remove the chip, then paste again with a model that reads images (no warning) ---------
    await removeChips();
    check((await ui()).chips.length === 0, 'the x button removes the image chip');
    writeSettings(vscode.userDataDir, { 'openVsCode.defaultModel': 'opencode/glm-5.3-flash-free' });
    // Fixed on purpose: the host picks up the edited user setting through a file watcher and
    // there is no observable signal for it before the next New session reads it.
    await page.waitForTimeout(2500);
    check(await clickButton('New session'), 'New session is pressed (the image-capable model)');
    await waitEmptyView();
    const warningsBefore = count((await ui()).text, NO_IMAGES);
    console.log(`  tries needed: ${String(await pasteImage())}`);
    state = await ui();
    check(state.chips.length === 1, 'the image is attached with the image-capable model');
    check(
      count(state.text, NO_IMAGES) <= warningsBefore,
      'and the warning does not appear again for a model that reads images',
    );

    // --- Send it: the chip leaves with the prompt and shows by name in the conversation ---------
    await page.keyboard.type('Reply with exactly: OK.');
    check(await clickButton('Send'), 'Send is pressed with the image chip');
    const delivered = await waitFor(async () => (await ui()).sent.length > 0, 20_000, 300);
    state = await ui();
    check(
      delivered === true && state.sent.some((name) => name.includes('Pasted image')),
      `the conversation shows the chip "Pasted image" (${JSON.stringify(state.sent)})`,
    );
    check(state.alerts === 0, 'and no alert was raised');
    await shot('20c-image-sent');

    // --- Drop (synthetic): the highlight, its hint, and the chips the host answers with ---------
    const drag = (type, uris) =>
      web.inDoc(
        (doc, spec) => {
          const { DataTransfer: Transfer, DragEvent: Drag } = doc.defaultView;
          const transfer = new Transfer();
          if (spec.uris) transfer.setData('resourceurls', JSON.stringify(spec.uris));
          const event = new Drag(spec.type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          });
          doc.querySelector('form.prompt').dispatchEvent(event);
          return event.defaultPrevented;
        },
        { type, uris },
      );
    const sample = path.join(workspace, 'src', 'sample.ts');
    const folder = path.join(workspace, 'src');
    const outside = path.join(workDir, 'outside.ts');
    for (const [name, theme] of THEMES) {
      await setTheme(theme);
      const prevented = await drag('dragover', [vsUri(sample)]);
      await sleep(250); // the drop highlight is painted in a later frame; the capture follows
      state = await ui();
      check(
        prevented === true && state.drop === 'active',
        `a drag over the box highlights it (data-drop=active) in ${name}`,
      );
      check(
        state.hint === 'Hold Shift to drop files from the Explorer',
        'and says "Hold Shift to drop files from the Explorer"',
      );
      const look = await web.inDoc(measureText, { hint: '.drop-hint' });
      check(
        look.hint !== null && look.hint !== undefined && look.hint.ratio >= 4.5,
        `the hint has contrast >= 4.5 in ${name} (${look.hint ? look.hint.ratio.toFixed(2) : 'not found'})`,
      );
      await shot(`20d-drop-highlight-${name}`);
      await web.inDoc((doc) => {
        doc
          .querySelector('form.prompt')
          .dispatchEvent(
            new doc.defaultView.DragEvent('dragleave', { bubbles: true, cancelable: true }),
          );
      });
      await waitFor(async () => (await ui()).drop === '', 2_000, 100);
      check((await ui()).drop === '', `the highlight goes away when the drag leaves in ${name}`);
    }
    // The same hint is the tooltip of the "Attach file…" item of the "+" menu (E2 #85 phase 4).
    check(await clickButton('Add context'), 'the "+" button is pressed to read the Attach hint');
    await waitPresent('[role="menu"]');
    const attachHint = await web.inDoc(
      (doc) =>
        [...doc.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Attach file…')
          ?.title ?? null,
    );
    check(
      attachHint === 'Hold Shift to drop files from the Explorer',
      `the "Attach file…" item carries the drop hint as its tooltip (${JSON.stringify(attachHint)})`,
    );
    await page.keyboard.press('Escape');
    await waitPresent('[role="menu"]', false);
    await removeChips();
    await drag('drop', [vsUri(sample), vsUri(folder), vsUri(outside)]);
    const added = await waitFor(
      async () => (await ui()).chips.includes('src/sample.ts'),
      15_000,
      300,
    );
    state = await ui();
    check(
      added === true,
      `the dropped src/sample.ts becomes a chip (${JSON.stringify(state.chips)})`,
    );
    check(
      state.text.includes(
        '2 dropped items were not added: folders, ignored files and files outside the workspace folder cannot be attached',
      ),
      'and the folder and the outside file raise ONE notice with the count',
    );
    check(
      state.drop === '' && state.styled === 0,
      'the highlight is gone and there is no style attribute',
    );
    await shot('20e-dropped');
    await removeChips();

    // --- "Add to OpenCode Chat" with the chat view HIDDEN (review of 23/10/2026, B2) -------------
    // A real right-click on the Explorer row (the command is not in the palette and the mouse is
    // the only way to hand it the clicked Uri). Showing the Explorer hides the chat view, so the
    // chip can only exist if the host kept it until the new document said `ready`. What is read is
    // the CHIP in the DOM of the webview, not a log line.
    await command('View: Show Explorer');
    const sampleRow = page.locator(
      '.explorer-folders-view [role="treeitem"][aria-label^="sample.ts"]',
    );
    await waitFor(
      async () =>
        (await sampleRow.count()) > 0 ||
        (await page.locator('.explorer-folders-view [role="treeitem"][aria-label="src"]').count()) >
          0,
      4_000,
      100,
    );
    if ((await sampleRow.count()) === 0) {
      await page
        .locator('.explorer-folders-view [role="treeitem"][aria-label="src"]')
        .first()
        .click();
      await waitFor(async () => (await sampleRow.count()) > 0, 3_000, 100);
    }
    check(
      (await sampleRow.count()) > 0,
      'the Explorer lists src/sample.ts (the chat view is hidden while it is shown)',
    );
    await sampleRow.first().click({ button: 'right' });
    const entry = page.getByText('Add to OpenCode Chat', { exact: true });
    await waitFor(async () => (await entry.count()) > 0, 3_000, 100);
    check((await entry.count()) > 0, 'the Explorer context menu has "Add to OpenCode Chat"');
    // A click right after the menu opens only highlights the entry: on 28/10/2026 (Windows 11, VS
    // Code 1.143.1, `--steps 20`) the menu stayed open with the entry highlighted once #89 removed
    // the 600 ms sleep, and the chat never came back. HYPOTHESIS: the menu ignores clicks for a
    // moment after it opens. So the click is repeated until the menu is gone (the entry ran).
    for (let attempt = 0; attempt < 3 && (await entry.count()) > 0; attempt += 1) {
      await entry.first().click();
      await waitFor(async () => (await entry.count()) === 0, 1_000, 100);
    }
    await openChat();
    const viaMenu = await waitFor(
      async () => (await ui()).chips.includes('src/sample.ts'),
      15_000,
      300,
    );
    state = await ui();
    check(
      viaMenu === true,
      `the chip src/sample.ts is in the chat that was hidden when the command ran (${JSON.stringify(state.chips)})`,
    );
    await shot('20f-add-to-chat-hidden');
    await removeChips();
    assertNoWebviewErrors('drop and paste');
  };
  await step('20 drop and paste (issue #30)', withSavedClipboard(dropAndPaste));

  /**
   * Step 21 (issue #38; five settings since #124, `autoStart` is the fifth): how the Settings
   * editor of a real VS Code shows the five contributed settings: filtered by `@ext:sergwei.open-vs-code`, in the `order` of the manifest, with the
   * label the user reads, the first sentence of each description, and the `#id#` link of
   * `opencodePath` painted as a link and followed with a real mouse click.
   *
   * Protects against: `order` ignored by the editor; a label that changes ("Open Vs Code: …" is
   * what VS Code derives from the extension name, and the plan hoped for no prefix); a `#id#`
   * link that is not painted as a link; a description that lost its Markdown. Reads the editor's
   * own DOM (`.settings-editor`, `.setting-item`, `.setting-item-label`, `.setting-item-category`,
   * `.setting-item-description`), which is internal to VS Code and may move in another version:
   * when a selector finds nothing, the check says how many rows it found instead of timing out
   * silently. The expected first sentences are copied from `package.json`; the labels are the
   * ones VS Code really showed, and each one is printed in its own line.
   *
   * What was seen, VERIFIED once by hand in throwaway experiments over CDP (VS Code 1.143.1,
   * Windows 11, 2026-10-25), NOT checks of this step and no longer reproducible from the repo:
   * adding an `id` to the category (`"openVsCode"`) did NOT change the labels, so it was not
   * kept; a bare `#id#` (no backticks) showed as the literal text with 0 links. What this step
   * does check is the backtick form (`` `#openVsCode.serverUrl#` ``): its link text is the
   * target's label ("Open Vs Code: Server Url") and a real mouse click on it focuses that setting.
   * VERIFIED in `npm run test:visual -- --steps 21` on Windows 11, VS Code 1.144.0 (2026-10-29):
   * "ok the Settings editor lists exactly 4 settings for the extension (4; selector
   * .settings-editor .setting-item)", "ok setting 4 is shown as "Open Vs Code: Chat Location", in
   * the order of the manifest" and "ok setting 4 shows its description ("Where the chat lives.
   * sidebar keeps one chat in the OpenCode…")" passed, as did the #id# link and the click check
   * ("clicking the link focuses the second setting ("Server Url")"). Not observed: other VS Code
   * versions or operating systems.
   */
  const settingsUi = async () => {
    await command('Preferences: Open Settings (UI)');
    const searchBox = page
      .locator('.settings-editor .suggest-input-container .monaco-editor')
      .first();
    await searchBox.click({ timeout: 15_000 });
    await page.keyboard.press('Control+A');
    await page.keyboard.type('@ext:sergwei.open-vs-code');
    const readRows = () =>
      page.evaluate(() =>
        [...globalThis.document.querySelectorAll('.settings-editor .setting-item')].map((row) => ({
          id: row.getAttribute('data-id') ?? row.getAttribute('data-key') ?? '',
          label: row.querySelector('.setting-item-label')?.textContent?.trim() ?? '',
          category: row.querySelector('.setting-item-category')?.textContent?.trim() ?? '',
          description: row.querySelector('.setting-item-description')?.textContent?.trim() ?? '',
          links: [...row.querySelectorAll('.setting-item-description a')].map((a) => ({
            text: a.textContent ?? '',
            href: a.getAttribute('href') ?? '',
          })),
        })),
      );
    const rows =
      (await waitFor(async () => {
        // The editor shows its default page ("Commonly Used") until the filter is applied, so a row
        // count alone would accept it: wait for a row that only this extension contributes.
        const found = await readRows();
        return found.some((row) => row.label === 'Default Model') ? found : undefined;
      }, 20_000)) ?? (await readRows());
    console.log(`  rows: ${JSON.stringify(rows)}`);
    check(
      rows.length === 5,
      `the Settings editor lists exactly 5 settings for the extension (${String(rows.length)}; selector .settings-editor .setting-item)`,
    );
    const expected = [
      'Absolute path to the opencode v2 executable.',
      'Address of an opencode v2 server that is already running on this machine',
      'Model that every new chat session starts with',
      'Where the chat lives.',
      'Launch the opencode server when the window starts.',
    ];
    const expectedLabels = [
      'Open Vs Code: Opencode Path',
      'Open Vs Code: Server Url',
      'Open Vs Code: Default Model',
      'Open Vs Code: Chat Location',
      'Open Vs Code: Auto Start',
    ];
    rows.slice(0, 5).forEach((row, index) => {
      console.log(
        `  label ${String(index + 1)}: "${row.category}${row.category ? ' ' : ''}${row.label}"`,
      );
      const shown = `${row.category} ${row.label}`.trim();
      check(
        shown === expectedLabels[index],
        `setting ${String(index + 1)} is shown as "${shown}", in the order of the manifest`,
      );
      check(
        row.description.includes(expected[index] ?? '?'),
        `setting ${String(index + 1)} shows its description ("${row.description.slice(0, 60)}")`,
      );
    });
    await shot('21a-settings');
    const first = rows[0];
    const link = first?.links[0];
    check(
      link !== undefined && !/^#.*#$/.test(link.text),
      `the #id# link of the first setting is painted as a link ("${link?.text ?? 'none'}", ${String(first?.links.length ?? 0)} link(s))`,
    );
    if (link !== undefined) {
      const target = page.locator('.settings-editor .setting-item-description a').first();
      const box = await target.boundingBox({ timeout: 5_000 }).catch(() => null);
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      // Waits for the condition (focus inside the second row), not a fixed time; if the click did
      // nothing the focus stays in row 1 and the read after the deadline fails the check below.
      // Only `activeElement` is read: a `.setting-item.focused` class was never seen to exist.
      const readFocused = () =>
        page.evaluate(() => {
          const row = globalThis.document.activeElement?.closest('.setting-item');
          return row?.querySelector('.setting-item-label')?.textContent?.trim() ?? '';
        });
      const secondLabel = rows[1]?.label ?? '?';
      const focused =
        (await waitFor(
          async () => ((await readFocused()) === secondLabel ? secondLabel : undefined),
          5_000,
        )) ?? (await readFocused());
      check(focused === secondLabel, `clicking the link focuses the second setting ("${focused}")`);
      await shot('21b-settings-link');
    }
    await page.keyboard.press('Control+W');
    await sleep(500); // closing the settings tab has no signal the next step reads; kept short
  };
  await step('21 settings UI (issue #38)', settingsUi);
  // Step 22 (issue #35): the palette commands and the two default keys, with the REAL keyboard in a
  // real VS Code. Keys: Ctrl+Alt+P (Cmd+Alt+P on macOS) Focus Prompt, toggling back to the editor
  // when the chat has the focus; Ctrl+Alt+N New Session, bound only while the chat has the focus.
  // Stop Response runs from the palette. HYPOTHESES this step settles: that a keydown with the
  // focus INSIDE the iframe reaches the workbench keybinding service, that the context key
  // `openVsCode.chatFocused` follows the webview's focus/blur, and that hiding the chat with Ctrl+B
  // while it holds the focus leaves the key false (a mutation without the reset must fail it).
  // Windows only for the key presses (`Control+Alt`): Playwright's AltGr handling
  // on other systems is not modelled here.
  // Issue #127 (#100): the four checks of Ctrl+Alt+P towards the prompt box prove the caret with
  // `caretLandsInBox` (active element in both documents, then a real `q`), never with
  // `doc.hasFocus()`. VERIFIED on Windows 11, VS Code 1.144.0 (31/10/2026, on the tree of that
  // day, before later edits to this file): `--steps 22,32` five times in a row, every run ended
  // "all visual checks passed" with the same `ok` texts as the baseline. The full run of
  // 01/11/2026 on the final tree also passed steps 22 and 32 (1452 ok, "all visual checks
  // passed"). Mutations: without the typed letter the four checks and N5 of step 32 FAIL; with the
  // iframe guard forced to false nothing is typed and each prints "caret not in the prompt box: …".
  // NOT observed: a failure of the old check (it did not fail in those five runs of 31/10), macOS (`Meta+Alt`),
  // and whether `src/sample.ts` stayed clean (not dirty) under the "no typed letter" mutation: the
  // workspace is deleted at the end of the run and the editor tab was not read.
  await step('22 palette commands and keyboard shortcuts (issue #35)', async () => {
    const modifier = process.platform === 'darwin' ? 'Meta+Alt' : 'Control+Alt';
    const promptState = () =>
      web.inDoc((doc) => {
        const field = doc.querySelector('textarea.prompt-text');
        return {
          active: field !== null && doc.activeElement === field,
          focused: field !== null && doc.activeElement === field && doc.hasFocus(),
          value: field?.value ?? '',
          messages: doc.querySelectorAll('[role="log"] > *').length,
          live:
            doc
              .querySelector('.status-bar .visually-hidden[aria-live="polite"]')
              ?.textContent?.trim() ?? '',
          stopNotes: doc.querySelectorAll('.stopped-note').length,
        };
      });
    const editorHasFocus = () =>
      page.evaluate(() => globalThis.document.activeElement?.closest('.monaco-editor') != null);
    const sessionCount = () =>
      JSON.parse(fs.readFileSync(vscode.stateFile, 'utf8')).sessions?.length ?? 0;

    check(await waitIdle(60_000), 'no turn is running when the step starts');
    // Focus in a text editor: quick open the sample file.
    await page.keyboard.press('ControlOrMeta+p');
    await waitFor(async () => !(await quickInputHidden()), 2_000, 50);
    await page.keyboard.type('src/sample.ts');
    await waitFor(
      () =>
        page.evaluate(() =>
          (
            globalThis.document.querySelector('.quick-input-list .monaco-list-row.focused')
              ?.textContent ?? ''
          ).includes('sample.ts'),
        ),
      2_000,
      50,
    );
    await page.keyboard.press('Enter');
    await waitFor(editorHasFocus, 5_000, 100);
    check((await editorHasFocus()) === true, 'the focus is in the text editor (src/sample.ts)');

    // --- Focus Prompt from the editor, then the toggle back ------------------------------------
    await page.keyboard.press(`${modifier}+p`);
    const focusedChat = await caretLandsInBox(8_000);
    check(focusedChat === true, `${modifier}+P from the editor puts the caret in the prompt box`);
    await shot('22a-focus-prompt');
    await sleep(300); // a gap between two presses of the same key: no signal to wait on
    await page.keyboard.press(`${modifier}+p`);
    const backInEditor = await waitFor(editorHasFocus, 8_000, 250);
    check(backInEditor === true, `${modifier}+P again returns the focus to the editor`);
    check((await promptState()).focused === false, 'and the prompt box no longer has the focus');

    // --- Hide the chat WHILE IT HOLDS THE FOCUS, then Focus Prompt must show it again -----------
    // The `blur` of a hidden element does not always fire, so the reset of `chatFocused` in
    // `onVisibilityChange(false)` is the only thing that stops a stale `true` from turning the
    // next Focus Prompt into "go back to the editor". The press must therefore start inside the
    // chat. Focus Prompt then runs from the PALETTE: since issue #92 the key from editor text says
    // "to the chat" in its argument and no longer reads the flag, so only the palette (the toggle)
    // still fails when the reset is missing. The editor is clicked first so the focus is outside
    // the chat, as for a user.
    await page.keyboard.press(`${modifier}+p`);
    const inChatAgain = await caretLandsInBox(8_000);
    check(inChatAgain === true, `${modifier}+P brings the focus back into the chat`);
    await page.keyboard.press('Control+b');
    await waitFor(async () => (await sideBarPx()) === 0, 3_000, 100);
    await page.locator('.monaco-editor .view-lines').first().click();
    await waitFor(editorHasFocus, 2_000, 100);
    await command('OpenCode: Focus Prompt');
    await openChat();
    const reopened = await waitFor(async () => (await promptState()).active, 10_000, 300);
    if (reopened !== true) {
      // Not an ok/FAIL/warn line, so `compare-runs` ignores it: it only says why the check below
      // failed. Why: this check failed 2 times in 6 after #89 phase 3 (28/10/2026) and passed 8 of
      // 8 with a trace that read the state right after `openChat`, so the trace changed the timing;
      // this reads it only once the wait has expired. UNVERIFIED: this branch has not run.
      const where = await page
        .evaluate(() => {
          const active = globalThis.document.activeElement;
          return `${String(active?.tagName)}.${String(active?.className).slice(0, 40)}`;
        })
        .catch(() => 'unreadable');
      const inChat = await web
        .inDoc((doc) => ({
          active: `${String(doc.activeElement?.tagName)}.${String(doc.activeElement?.className).slice(0, 40)}`,
          hasFocus: doc.hasFocus(),
          visibility: doc.visibilityState,
          messages: doc.querySelectorAll('[role="log"] > *').length,
        }))
        .catch((error) => String(error));
      console.log(
        `  focus after the reopen: workbench ${where}, chat ${JSON.stringify(inChat)}, side bar ${String(await sideBarPx())} px`,
      );
    }
    check(
      reopened === true,
      'after Ctrl+B hid the chat while it had the focus, Focus Prompt from the palette shows it and the prompt box is the active element of the new document (the context key was reset)',
    );
    // `doc.hasFocus()` is false in this new document although the workbench holds focus on its iframe
    // (seen in this step), so the proof is the real keyboard: a typed letter must land in the box.
    await page.keyboard.type('q');
    await waitFor(async () => (await promptState()).value === 'q', 2_000, 100);
    check(
      (await promptState()).value === 'q',
      'and a real keystroke typed right after lands in the prompt box',
    );
    await page.keyboard.press('Backspace');
    await shot('22b-focus-after-hide');

    // --- New Session by key, only with the chat focused: the draft stays, nothing is created ----
    await page.keyboard.type('half written draft');
    const sessionsBefore = sessionCount();
    const beforeNew = await promptState();
    check(
      beforeNew.messages > 0,
      `the view has messages before ${modifier}+N is pressed (${beforeNew.messages})`,
    );
    await page.keyboard.press(`${modifier}+n`);
    await waitFor(async () => (await promptState()).messages === 0, 3_000, 100);
    // Negative check below (no session is created): a short fixed window after the positive wait.
    await sleep(300);
    const afterNew = await promptState();
    check(afterNew.messages === 0, `${modifier}+N leaves the empty view (${afterNew.messages})`);
    check(
      afterNew.value === 'half written draft' && afterNew.focused,
      `the draft is kept and the prompt keeps the focus (${JSON.stringify(afterNew.value)})`,
    );
    check(
      sessionCount() === sessionsBefore,
      `and no session was created (${String(sessionsBefore)} before and after)`,
    );
    await shot('22c-new-session');

    // --- E2 #85 phase 4: with the "+" menu OPEN, the shortcuts still work and the menu closes ---
    // The menu holds the focus on an item (a webview element), so `chatFocused` is true: New Session
    // and Focus Prompt must act as before, and the focus leaving the menu must not leave it open.
    const menuOpen = () =>
      web.inDoc((doc) => ({
        menu: doc.querySelector('[role="menu"]') !== null,
        expanded:
          doc.querySelector('button[aria-label="Add context"]')?.getAttribute('aria-expanded') ??
          '',
      }));
    check(await clickButton('Add context'), 'the "+" button is pressed with the real mouse');
    await waitPresent('[role="menu"]');
    check((await menuOpen()).menu === true, 'the "+" menu is open before the shortcut');
    await page.keyboard.press(`${modifier}+n`);
    await waitPresent('[role="menu"]', false);
    // Negative check below (no session is created): a short fixed window after the positive wait.
    await sleep(300);
    let menuNow = await menuOpen();
    check(
      menuNow.menu === false && menuNow.expanded === 'false',
      `${modifier}+N with the "+" menu open closes the menu (menu ${String(menuNow.menu)}, expanded "${menuNow.expanded}")`,
    );
    check(
      (await promptState()).messages === 0 && sessionCount() === sessionsBefore,
      `and ${modifier}+N still leaves the empty view without creating a session`,
    );
    check(await clickButton('Add context'), 'the "+" button is pressed again');
    await waitPresent('[role="menu"]');
    check((await menuOpen()).menu === true, 'the "+" menu is open before Focus Prompt');
    await page.keyboard.press(`${modifier}+p`);
    const leftChat = await waitFor(editorHasFocus, 8_000, 250);
    menuNow = await menuOpen();
    check(
      leftChat === true && menuNow.menu === false,
      `${modifier}+P with the "+" menu open moves the focus to the editor and closes the menu (editor ${String(leftChat)}, menu ${String(menuNow.menu)})`,
    );
    await page.keyboard.press(`${modifier}+p`);
    check(
      (await caretLandsInBox(8_000)) === true,
      `${modifier}+P again brings the focus back to the prompt box`,
    );
    await shot('22c2-plus-menu-shortcuts');

    // --- Review W1: the chip's panel closes the same way when the focus leaves by shortcut ------
    const chipPanelOpen = () =>
      web.inDoc((doc) => ({
        panel: doc.querySelector('.agent-model-panel') !== null,
        expanded: doc.querySelector('button.agent-model-chip')?.getAttribute('aria-expanded') ?? '',
      }));
    check(await clickIn('button.agent-model-chip'), 'the chip is pressed to open its panel');
    await waitPresent('.agent-model-panel');
    check((await chipPanelOpen()).panel === true, 'the chip panel is open before the shortcut');
    await page.keyboard.press(`${modifier}+p`);
    const leftWithChip = await waitFor(editorHasFocus, 8_000, 250);
    const chipNow = await chipPanelOpen();
    check(
      leftWithChip === true && chipNow.panel === false && chipNow.expanded === 'false',
      `${modifier}+P with the chip panel open moves the focus to the editor and closes the panel (editor ${String(leftWithChip)}, panel ${String(chipNow.panel)}, expanded "${chipNow.expanded}")`,
    );
    await page.keyboard.press(`${modifier}+p`);
    check(
      (await caretLandsInBox(8_000)) === true,
      `${modifier}+P again brings the focus back to the prompt box after the chip panel`,
    );

    // --- Stop Response from the palette while a turn runs --------------------------------------
    await send('Count from 1 to 400, one number per line. Do not use tools. LONG');
    check((await waitFor(isBusy, 30_000, 300)) === true, 'a LONG turn is running');
    await page.keyboard.press(`${modifier}+p`); // focus to the editor, so Stop acts from outside
    await waitFor(editorHasFocus, 3_000, 100);
    await command('OpenCode: Stop Response');
    check(await waitIdle(30_000), 'Stop Response interrupts the turn');
    const stopped = await promptState();
    check(stopped.stopNotes >= 1, 'a neutral "Stopped" note is in the conversation');
    check(stopped.live === 'Stopped', `the live region says "Stopped" (${stopped.live})`);
    await shot('22d-stop-response');

    // --- Stop Response with nothing running: the notice, readable in the four themes -----------
    const THEMES = [
      ['light', 'Default Light Modern'],
      ['dark', 'Default Dark Modern'],
      ['hc-dark', 'Default High Contrast'],
      ['hc-light', 'Default High Contrast Light'],
    ];
    for (const [name, theme] of THEMES) {
      await setTheme(theme);
      await command('OpenCode: Stop Response');
      const shown = await waitFor(
        async () =>
          (await web.inDoc((doc) => doc.body.innerText.includes('No response is running'))) ===
          true,
        8_000,
        300,
      );
      check(shown === true, `Stop Response with no turn says "No response is running" in ${name}`);
      const look = await web.inDoc(measureText, { notice: '.status-bar .alert .alert-text' });
      check(
        look.notice !== null && look.notice !== undefined && look.notice.ratio >= 4.5,
        `the notice has contrast >= 4.5 in ${name} (${look.notice ? look.notice.ratio.toFixed(2) : 'not found'})`,
      );
      await shot(`22e-nothing-to-stop-${name}`);
    }
    await setTheme('Default Dark Modern');
    assertNoWebviewErrors('palette commands and shortcuts');
  });

  // E2 (issue #85, phase 4): the "+" menu with the keyboard and the mouse at 300 px and wide, in the
  // four themes, and the compact state under 200 px (decision P13=1: the chip takes a row of its own).
  // The compact state is judged by boxes: the chip is as wide as the prompt box, no two pieces of the
  // bar overlap, and nothing sticks out of the view (the page does not scroll sideways).
  await step('23 "+" menu and the compact state (E2 #85, phase 4)', async () => {
    const plusState = () =>
      web.inDoc((doc) => {
        const rect = (selector) => {
          const element = doc.querySelector(selector);
          if (!element) return null;
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
        };
        const active = doc.activeElement;
        const trigger = doc.querySelector('button[aria-label="Add context"]');
        return {
          open: doc.querySelector('[role="menu"]') !== null,
          expanded: trigger?.getAttribute('aria-expanded') ?? '',
          items: [...doc.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent ?? ''),
          activeItem:
            active?.getAttribute?.('role') === 'menuitem' ? (active.textContent ?? '') : '',
          activeIsTrigger: active === trigger,
          activeIsBody: active === doc.body || active === null,
          view: { width: doc.defaultView.innerWidth, height: doc.defaultView.innerHeight },
          scrollOverflow: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
          menu: rect('[role="menu"]'),
          prompt: rect('form.prompt'),
          plus: rect('button[aria-label="Add context"]'),
          chip: rect('button.agent-model-chip'),
          send: rect('button.send-button'),
          styled: [...doc.querySelectorAll('body [style], body[style]')].filter(
            (e) => (e.getAttribute('style') ?? '').trim() !== '',
          ).length,
        };
      });
    const overlap = (a, b) =>
      a !== null &&
      b !== null &&
      a.left < b.right - 0.5 &&
      b.left < a.right - 0.5 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5;
    const inView = (box, view) =>
      box !== null &&
      box.left >= -0.5 &&
      box.top >= -0.5 &&
      box.right <= view.width + 0.5 &&
      box.bottom <= view.height + 0.5;
    const openByMouse = async () => {
      if ((await plusState()).open) return;
      check(await clickButton('Add context'), 'the "+" button is pressed with the real mouse');
      await waitPresent('[role="menu"]');
    };
    const closeByEscape = async () => {
      await page.keyboard.press('Escape');
      await sleep(250); // the key reaches the webview asynchronously; some callers expect "nothing changes"
    };
    const press = async (key) => {
      await page.keyboard.press(key);
      await sleep(200); // same: asynchronous path of the key, and negative checks follow some presses
    };

    check(await waitIdle(60_000), 'no turn is running when the step starts');
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();
    assertNoWebviewErrors('before the "+" menu step');

    // --- Keyboard, 300 px ------------------------------------------------------------------------
    await setSideBarWidth(300).catch(() => undefined);
    await focusPromptBox();
    // The button is focused by code (its place in the Tab order is not what this step judges): what
    // follows is the REAL keyboard on it.
    await web.inDoc((doc) => doc.querySelector('button[aria-label="Add context"]')?.focus());
    await waitFor(async () => (await plusState()).activeIsTrigger === true, 2_000, 100);
    let state = await plusState();
    check(state.activeIsTrigger === true, 'the "+" button can take the keyboard focus');
    await press('Enter');
    state = await plusState();
    check(
      state.open &&
        state.expanded === 'true' &&
        state.items.join('|') === 'Add selection|Attach file…|Attach image…|Mention a file' &&
        state.activeItem === 'Add selection',
      `Enter opens the menu with its four items and the focus on the first (${JSON.stringify(state.items)}, focus "${state.activeItem}")`,
    );
    check(
      inView(state.menu, state.view) && state.menu.width >= 0.8 * state.prompt.width,
      `the menu is inside the view and as wide as the prompt box (${JSON.stringify(state.menu)})`,
    );
    await press('ArrowDown');
    check((await plusState()).activeItem === 'Attach file…', 'ArrowDown moves to Attach file…');
    await press('End');
    check((await plusState()).activeItem === 'Mention a file', 'End goes to Mention a file');
    await press('ArrowDown');
    check((await plusState()).activeItem === 'Add selection', 'ArrowDown wraps to the first item');
    await press('Home');
    check((await plusState()).activeItem === 'Add selection', 'Home goes to the first item');
    await closeByEscape();
    state = await plusState();
    check(
      !state.open && state.activeIsTrigger,
      `Escape closes the menu and returns the focus to the button (open ${String(state.open)}, focus on the button ${String(state.activeIsTrigger)})`,
    );
    await press('Space');
    check((await plusState()).open === true, 'Space on the button opens the menu');
    await press('Tab');
    state = await plusState();
    check(
      !state.open && !state.activeIsBody,
      `Tab closes the menu and the focus does not fall to the page (open ${String(state.open)}, on the page ${String(state.activeIsBody)})`,
    );

    // --- Mention a file writes the @ and opens the popup like typing it ---------------------------
    await web.inDoc((doc) => doc.querySelector('button[aria-label="Add context"]')?.focus());
    await press('Enter');
    await press('End');
    await press('Enter');
    await waitPresent('.mention-popup');
    const mention = await web.inDoc((doc) => ({
      value: doc.querySelector('textarea.prompt-text')?.value ?? '',
      popup: doc.querySelector('.mention-popup') !== null,
      focusIsBox: doc.activeElement === doc.querySelector('textarea.prompt-text'),
      menu: doc.querySelector('[role="menu"]') !== null,
    }));
    check(
      mention.value.endsWith('@') && mention.popup && mention.focusIsBox && !mention.menu,
      `Mention a file writes "@", opens the file popup and puts the focus in the box (${JSON.stringify(mention)})`,
    );
    await closeByEscape(); // closes the popup; the "@" stays in the box
    await page.keyboard.press('Backspace');
    await waitPresent('.mention-popup', false);

    // --- Mouse: outside click closes without moving the focus; the item with the mouse -------------
    await openByMouse();
    check(
      await clickIn('textarea'),
      'the prompt box is pressed with the real mouse while the menu is open',
    );
    await waitPresent('[role="menu"]', false);
    state = await plusState();
    const boxFocused = await web.inDoc(
      (doc) => doc.activeElement === doc.querySelector('textarea.prompt-text'),
    );
    check(
      !state.open && boxFocused === true,
      `a click outside closes the menu (open ${String(state.open)}) and the box keeps the focus (${String(boxFocused)})`,
    );

    // --- The chip panel at about 900 px (reconciliation C1, decision of Sergio 27/10/2026) -----------
    // The two-column layout (container >= 360 px) was only ever seen stacked at 300 px; jsdom does
    // not evaluate container queries. Judged by boxes, never by a class. Reasoning exists only for a
    // model that lists variants, so one is chosen first (the session keeps it across the themes).
    const chipPanelState = () =>
      web.inDoc((doc) => {
        const box = (element) => {
          if (!element) return null;
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
        };
        const panel = doc.querySelector('.agent-model-panel');
        const agent = panel?.querySelector('[data-group="agent"]') ?? null;
        const model = panel?.querySelector('[data-group="model"]') ?? null;
        const reasoning = panel?.querySelector('.menu-reasoning') ?? null;
        const lastModel = [...(panel?.querySelectorAll('button[data-model]') ?? [])].at(-1) ?? null;
        const chip = doc.querySelector('button.agent-model-chip');
        const active = doc.activeElement;
        return {
          open: panel !== null,
          panel: box(panel),
          agent: box(agent),
          model: box(model),
          reasoning: box(reasoning),
          lastModel: box(lastModel),
          reasoningInModel: reasoning !== null && model !== null && model.contains(reasoning),
          view: { width: doc.defaultView.innerWidth, height: doc.defaultView.innerHeight },
          scrollOverflow: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
          expanded: chip?.getAttribute('aria-expanded') ?? '',
          focusOnChip: active === chip,
        };
      });
    const openChipPanel = async () => {
      if ((await chipPanelState()).open) return;
      check(await clickIn('button.agent-model-chip'), 'the chip is pressed with the real mouse');
      await waitPresent('.agent-model-panel');
    };
    const ensureModelWithVariants = async () => {
      await openChipPanel();
      const ids = await web.inDoc((doc) =>
        [...doc.querySelectorAll('.agent-model-panel button[data-model]')].map(
          (b) => b.getAttribute('data-model') ?? '',
        ),
      );
      await closeByEscape();
      const GLM = 'opencode/glm-5.3-flash-free';
      for (const id of [...ids.filter((x) => x === GLM), ...ids.filter((x) => x !== GLM)]) {
        await openChipPanel();
        await clickIn(`.agent-model-panel button.model-option[data-model="${id}"]`);
        await closeByEscape(); // a choice leaves the panel open (01/11/2026)
        await openChipPanel();
        const has = (await chipPanelState()).reasoning !== null;
        await closeByEscape();
        if (has) return id;
      }
      return undefined;
    };
    const modelWithVariants = await ensureModelWithVariants();
    check(
      modelWithVariants !== undefined,
      'a model that lists variants is chosen for the chip panel',
    );
    const judgeWideChipPanel = async (where, themeName) => {
      await waitFor(async () => (await plusState()).chip !== null, 60_000, 500);
      await openChipPanel();
      // The panel lays out two columns after opening: read it once two reads of its boxes agree.
      let lastBoxes = '';
      await waitFor(
        async () => {
          const now = await chipPanelState();
          const boxes = JSON.stringify([now.panel, now.agent, now.model, now.reasoning]);
          const stable = boxes === lastBoxes;
          lastBoxes = boxes;
          return stable;
        },
        2_000,
        100,
      );
      const s = await chipPanelState();
      const sideBySide =
        s.agent !== null &&
        s.model !== null &&
        s.model.left >= s.agent.right - 1 &&
        Math.abs(s.model.top - s.agent.top) <= 2;
      check(
        sideBySide,
        `${where}: the chip panel has the Agent and Model columns side by side (Agent ${JSON.stringify(s.agent)}, Model ${JSON.stringify(s.model)})`,
      );
      check(
        s.reasoningInModel &&
          s.reasoning !== null &&
          s.lastModel !== null &&
          s.reasoning.top >= s.lastModel.bottom - 1 &&
          s.reasoning.left >= s.model.left - 1 &&
          s.reasoning.right <= s.model.right + 1,
        `${where}: Reasoning is inside the Model column, under the model list (Reasoning ${JSON.stringify(s.reasoning)})`,
      );
      check(
        inView(s.panel, s.view) && s.scrollOverflow <= 1,
        `${where}: the chip panel fits the view and the page does not scroll sideways (panel ${JSON.stringify(s.panel)}, overflow ${String(s.scrollOverflow)} px)`,
      );
      const look = await web.inDoc(measureText, {
        name: '.agent-model-panel button.model-option .model-name',
        title: '.agent-model-panel [data-group="model"] h3',
      });
      check(
        look.name != null &&
          look.name.ratio >= 4.5 &&
          look.title != null &&
          look.title.ratio >= 4.5,
        `${where}: the first row of the chip panel and the Model column title have contrast >= 4.5 (row ${look.name ? look.name.ratio.toFixed(2) : 'not found'}, title ${look.title ? look.title.ratio.toFixed(2) : 'not found'})`,
      );
      await shot(`23-chip-panel-wide-${themeName}`);
      await closeByEscape();
      const after = await chipPanelState();
      check(
        !after.open && after.expanded === 'false' && after.focusOnChip,
        `${where}: Escape closes the chip panel and the focus returns to the chip (open ${String(after.open)}, expanded "${after.expanded}", focus on the chip ${String(after.focusOnChip)})`,
      );
    };

    // --- Themes at 300 px, the wide bar and the compact state ------------------------------------
    const WIDTHS = [
      ['300', 300],
      ['wide', 900],
      ['compact', 150],
    ];
    for (const [name, wanted] of WIDTHS) {
      let barPx;
      try {
        barPx = await setSideBarWidth(wanted);
      } catch (error) {
        barPx = await sideBarPx();
        warn(
          `"+" menu: the side bar did not go to ${String(wanted)} px (it is ${String(barPx)} px): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const reached =
        name === '300'
          ? Math.abs(barPx - 300) <= SIZE_TOLERANCE
          : name === 'wide'
            ? barPx >= 600
            : barPx < 200;
      if (!reached) {
        warn(`"+" menu: width "${name}" not reached (side bar ${String(barPx)} px): not judged`);
        continue;
      }
      for (const [themeName, theme] of PROBLEM_THEMES) {
        await setTheme(theme);
        const where = `at ${name} (bar ${String(Math.round(barPx))} px), ${themeName}`;
        // The bar closed: nothing overlaps, nothing sticks out, and in the compact state the chip
        // has a row of its own at the width of the box.
        // The webview may have been re-created by the resize: wait until it answers again.
        await waitFor(async () => (await plusState()).plus !== null, 60_000, 500);
        state = await plusState();
        check(
          state.scrollOverflow <= 1 && state.styled === 0,
          `${where}: the view does not scroll sideways (${String(state.scrollOverflow)} px) and has no style attribute`,
        );
        check(
          !overlap(state.plus, state.chip) &&
            !overlap(state.plus, state.send) &&
            !overlap(state.chip, state.send),
          `${where}: the "+", the chip and Send do not overlap`,
        );
        check(
          inView(state.plus, state.view) &&
            inView(state.chip, state.view) &&
            inView(state.send, state.view),
          `${where}: the "+", the chip and Send are inside the view`,
        );
        if (name === 'compact') {
          check(
            state.chip.width >= 0.95 * state.prompt.width &&
              state.chip.top >= state.plus.bottom - 1,
            `${where}: the chip takes a row of its own at the width of the box (chip ${String(Math.round(state.chip.width))} of ${String(Math.round(state.prompt.width))} px, below the "+")`,
          );
        }
        await shot(`23-bar-${name}-${themeName}`);
        // The menu open with the real mouse: inside the view, readable.
        await openByMouse();
        state = await plusState();
        check(
          state.open && inView(state.menu, state.view),
          `${where}: the menu opens inside the view (${JSON.stringify(state.menu)})`,
        );
        const look = await web.inDoc(measureText, { item: 'button.plus-item' });
        check(
          look.item !== null && look.item !== undefined && look.item.ratio >= 4.5,
          `${where}: the menu items have contrast >= 4.5 (${look.item ? look.item.ratio.toFixed(2) : 'not found'})`,
        );
        await shot(`23-menu-${name}-${themeName}`);
        await closeByEscape();
        if (name === 'wide') await judgeWideChipPanel(where, themeName);
      }
    }
    await setTheme('Default Dark Modern');
    await setSideBarWidth(300).catch(() => undefined); // it settles the layout itself
    assertNoWebviewErrors('"+" menu');
  });

  // E8 (issue #33): the "/" button with its menu, the popup that opens when `/` is typed, and the
  // bar that now holds one more button. The matrix is component x width x theme (plan
  // E8-slash-commands, section 8): C1 the menu (real mouse), C2 the typed popup (real keyboard), C3
  // the bar with the new button, each at 300 px, wide and compact in the four themes (36 cells),
  // and C4, one cell on purpose (behaviour, not geometry): dark, 300 px. The workspace has two
  // project commands (`hello`, `broken`, see `createWorkspace`) next to the built-in `init` and
  // `review` of the fixture, and the client command `compact` (issue #125) the webview appends.
  await step('24 slash commands (issue #33)', async () => {
    const slashState = () =>
      web.inDoc((doc) => {
        const box = (element) => {
          if (!element) return null;
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
        };
        const one = (selector) => doc.querySelector(selector);
        const field = one('textarea.prompt-text');
        const trigger = one('button[aria-label="Commands"]');
        const active = doc.activeElement;
        const nameOf = (element) => element.querySelector('.command-name')?.textContent ?? '';
        const descriptionOf = (element) =>
          element.querySelector('.command-description')?.textContent ?? '';
        return {
          view: { width: doc.defaultView.innerWidth, height: doc.defaultView.innerHeight },
          scrollOverflow: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
          styled: [...doc.querySelectorAll('body [style], body[style]')].filter(
            (e) => (e.getAttribute('style') ?? '').trim() !== '',
          ).length,
          prompt: box(one('form.prompt')),
          plus: box(one('button[aria-label="Add context"]')),
          trigger: box(trigger),
          chip: box(one('button.agent-model-chip')),
          send: box(one('button.send-button')),
          expanded: trigger?.getAttribute('aria-expanded') ?? '',
          menuOpen: one('.command-menu') !== null,
          menu: box(one('.command-menu')),
          items: [...doc.querySelectorAll('.command-menu [role="menuitem"]')].map(nameOf),
          activeItem: active?.getAttribute?.('role') === 'menuitem' ? nameOf(active) : '',
          activeIsTrigger: active === trigger,
          activeIsBody: active === doc.body || active === null,
          popup: one('.command-popup') !== null,
          popupBox: box(one('.command-popup')),
          rows: [...doc.querySelectorAll('.command-popup [role="option"]')].map((row) => ({
            name: nameOf(row),
            description: descriptionOf(row),
            selected: row.getAttribute('aria-selected') === 'true',
          })),
          value: field?.value ?? '',
          focusOnBox: active === field,
          busy: [...doc.querySelectorAll('button')].some(
            (b) => b.getAttribute('aria-label') === 'Stop',
          ),
          users: [...doc.querySelectorAll('[role="log"] .message-user .part-text')].map((m) =>
            (m.textContent ?? '').trim(),
          ),
          assistants: doc.querySelectorAll('[role="log"] .message-assistant').length,
          notices: [...doc.querySelectorAll('.status-bar .alert .alert-text')].map((n) =>
            (n.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ),
        };
      });
    const overlap = (a, b) =>
      a !== null &&
      b !== null &&
      a.left < b.right - 0.5 &&
      b.left < a.right - 0.5 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5;
    const inView = (box, view) =>
      box !== null &&
      box.left >= -0.5 &&
      box.top >= -0.5 &&
      box.right <= view.width + 0.5 &&
      box.bottom <= view.height + 0.5;
    const press = async (key) => {
      await page.keyboard.press(key);
      await sleep(200); // the key reaches the webview asynchronously and negative checks follow
    };
    // Empties the box with the real keyboard; a popup open on the old text closes with it.
    const clearBox = () => clearPromptBox(150);
    // The text the host logged, from every OpenCode.log of the isolated profile of this run.
    const hostLog = () => {
      const files = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name === 'OpenCode.log') files.push(full);
        }
      };
      try {
        walk(path.join(vscode.userDataDir, 'logs'));
      } catch {
        return '';
      }
      return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    };

    check(await waitIdle(60_000), 'no turn is running when the step starts');
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();
    assertNoWebviewErrors('before the slash commands step');

    // --- C1, C2, C3: widths x themes ---------------------------------------------------------------
    const WIDTHS = [
      ['300', 300],
      ['wide', 900],
      ['compact', 150],
    ];
    for (const [name, wanted] of WIDTHS) {
      let barPx;
      try {
        barPx = await setSideBarWidth(wanted);
      } catch (error) {
        barPx = await sideBarPx();
        warn(
          `slash commands: the side bar did not go to ${String(wanted)} px (it is ${String(barPx)} px): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const reached =
        name === '300'
          ? Math.abs(barPx - 300) <= SIZE_TOLERANCE
          : name === 'wide'
            ? barPx >= 600
            : barPx < 200;
      if (!reached) {
        warn(
          `slash commands: width "${name}" not reached (side bar ${String(barPx)} px): not judged`,
        );
        continue;
      }
      for (const [themeName, theme] of PROBLEM_THEMES) {
        await setTheme(theme);
        const where = `at ${name} (bar ${String(Math.round(barPx))} px), ${themeName}`;
        // The webview may have been re-created by the resize or the theme: wait until it answers.
        await waitFor(async () => (await slashState()).trigger !== null, 60_000, 500);
        let s = await slashState();

        // C3: the bar with the new button.
        check(
          s.scrollOverflow <= 1 && s.styled === 0,
          `${where}: C3 the view does not scroll sideways (${String(s.scrollOverflow)} px) and has no style attribute`,
        );
        check(
          !overlap(s.plus, s.trigger) &&
            !overlap(s.plus, s.chip) &&
            !overlap(s.plus, s.send) &&
            !overlap(s.trigger, s.chip) &&
            !overlap(s.trigger, s.send) &&
            !overlap(s.chip, s.send),
          `${where}: C3 the "+", the "/", the chip and Send do not overlap`,
        );
        check(
          inView(s.plus, s.view) &&
            inView(s.trigger, s.view) &&
            inView(s.chip, s.view) &&
            inView(s.send, s.view),
          `${where}: C3 the "+", the "/", the chip and Send are inside the view`,
        );
        if (name === 'compact') {
          check(
            s.chip.width >= 0.95 * s.prompt.width && s.chip.top >= s.trigger.bottom - 1,
            `${where}: C3 the chip takes a row of its own at the width of the box (chip ${String(Math.round(s.chip.width))} of ${String(Math.round(s.prompt.width))} px, below the "+" and the "/")`,
          );
        }

        // C1: the menu, opened with the real mouse.
        check(
          await clickButton('Commands'),
          `${where}: C1 the "/" button is pressed with the real mouse`,
        );
        await waitPresent('.command-menu');
        s = await slashState();
        check(
          s.menuOpen &&
            s.expanded === 'true' &&
            inView(s.menu, s.view) &&
            ['/init', '/review', '/hello', '/broken', '/compact'].every((n) => s.items.includes(n)),
          `${where}: C1 the menu opens inside the view with the five commands (${JSON.stringify(s.items)}, ${JSON.stringify(s.menu)})`,
        );
        const menuLook = await web.inDoc(measureText, {
          // A row that is neither focused nor hovered: on those the description takes the row's
          // own colour (see the CSS), and the focus is on the first row once the menu opens.
          name: '.command-menu button.command-item:not(:focus):not(:hover) .command-name',
          description:
            '.command-menu button.command-item:not(:focus):not(:hover) .command-description',
        });
        check(
          menuLook.name != null &&
            menuLook.name.ratio >= 4.5 &&
            menuLook.description != null &&
            menuLook.description.ratio >= 4.5,
          `${where}: C1 the name and the description of a row have contrast >= 4.5 (name ${menuLook.name ? menuLook.name.ratio.toFixed(2) : 'not found'}, description ${menuLook.description ? menuLook.description.ratio.toFixed(2) : 'not found'})`,
        );
        await shot(`24-menu-${name}-${themeName}`);
        await press('Escape');
        await waitPresent('.command-menu', false);

        // C2: the popup that opens when `/` is typed, with the real keyboard.
        await clearBox();
        await page.keyboard.type('/');
        await waitPresent('.command-popup [role="option"]');
        s = await slashState();
        const hello = s.rows.find((row) => row.name === '/hello');
        check(
          s.popup &&
            s.focusOnBox &&
            hello !== undefined &&
            hello.description === 'Say hello to someone' &&
            s.rows.filter((row) => row.selected).length === 1,
          `${where}: C2 typing "/" opens the popup with the rows /hello and its description, one highlighted, the focus in the box (${JSON.stringify(s.rows.map((row) => row.name))})`,
        );
        check(
          inView(s.popupBox, s.view),
          `${where}: C2 the popup is inside the view (${JSON.stringify(s.popupBox)})`,
        );
        const normalLook = await web.inDoc(measureText, {
          name: '.command-popup [role="option"][aria-selected="false"] .command-name',
          description: '.command-popup [role="option"][aria-selected="false"] .command-description',
        });
        const litLook = await web.inDoc(measureText, {
          name: '.command-popup [role="option"][aria-selected="true"] .command-name',
          description: '.command-popup [role="option"][aria-selected="true"] .command-description',
        });
        const ratios = [normalLook.name, normalLook.description, litLook.name, litLook.description];
        check(
          ratios.every((r) => r != null && r.ratio >= 4.5),
          `${where}: C2 a normal row and the highlighted row have contrast >= 4.5 (normal ${ratios[0] ? ratios[0].ratio.toFixed(2) : 'not found'}/${ratios[1] ? ratios[1].ratio.toFixed(2) : 'not found'}, highlighted ${ratios[2] ? ratios[2].ratio.toFixed(2) : 'not found'}/${ratios[3] ? ratios[3].ratio.toFixed(2) : 'not found'})`,
        );
        await shot(`24-popup-${name}-${themeName}`);
        await clearBox();
        await waitPresent('.command-popup [role="option"]', false);
      }
    }
    await setTheme('Default Dark Modern');
    await setSideBarWidth(300).catch(() => undefined); // it settles the layout itself
    assertNoWebviewErrors('slash commands, geometry');

    // --- C4: behaviour, dark, 300 px ---------------------------------------------------------------
    // The menu with the keyboard.
    await focusPromptBox();
    await web.inDoc((doc) => doc.querySelector('button[aria-label="Commands"]')?.focus());
    await waitFor(async () => (await slashState()).activeIsTrigger === true, 2_000, 100);
    await press('Enter');
    let state = await slashState();
    const firstItem = state.items[0];
    check(
      state.menuOpen && state.items.length === 5 && state.activeItem === firstItem,
      `C4 Enter on the "/" button opens the menu with the focus on the first item (${JSON.stringify(state.items)}, focus "${state.activeItem}")`,
    );
    await press('ArrowDown');
    check(
      (await slashState()).activeItem === state.items[1],
      `C4 ArrowDown moves to the second item (${state.items[1]})`,
    );
    await press('End');
    check(
      (await slashState()).activeItem === state.items[4],
      `C4 End goes to the last item (${state.items[4]})`,
    );
    await press('ArrowDown');
    check((await slashState()).activeItem === firstItem, 'C4 ArrowDown wraps to the first item');
    await press('End');
    await press('Home');
    check((await slashState()).activeItem === firstItem, 'C4 Home goes to the first item');
    await press('Escape');
    state = await slashState();
    check(
      !state.menuOpen && state.activeIsTrigger,
      `C4 Escape closes the menu and returns the focus to the "/" button (open ${String(state.menuOpen)}, focus on the button ${String(state.activeIsTrigger)})`,
    );
    await press('Space');
    check((await slashState()).menuOpen === true, 'C4 Space on the "/" button opens the menu');
    await press('Tab');
    state = await slashState();
    check(
      !state.menuOpen && !state.activeIsBody,
      `C4 Tab closes the menu and the focus does not fall to the page (open ${String(state.menuOpen)}, on the page ${String(state.activeIsBody)})`,
    );

    // A row chosen with the real mouse writes "/hello " and leaves the focus in the box.
    check(await clickButton('Commands'), 'C4 the "/" button is pressed with the real mouse');
    await waitPresent('.command-menu');
    check(
      await clickIn('.command-menu button.command-item[title="Say hello to someone"]'),
      'C4 the /hello row is pressed with the real mouse',
    );
    await waitFor(async () => (await slashState()).value === '/hello ', 3_000, 100);
    state = await slashState();
    check(
      state.value === '/hello ' && state.focusOnBox && !state.menuOpen && !state.popup,
      `C4 choosing a row with the mouse writes "/hello " and leaves the focus in the box (value ${JSON.stringify(state.value)}, focus in the box ${String(state.focusOnBox)}, menu open ${String(state.menuOpen)}, popup ${String(state.popup)})`,
    );

    // "/hello Ana" + Enter: the user message is the expanded template and the fake answers.
    const usersBefore = state.users.length;
    await page.keyboard.type('Ana');
    await page.keyboard.press('Enter');
    await waitFor(async () => (await slashState()).users.length > usersBefore, 20_000, 200);
    check(await waitIdle(60_000), 'C4 the turn of /hello Ana ends');
    state = await slashState();
    check(
      state.users.at(-1) === 'Say hello to Ana in one short sentence.' && state.assistants >= 1,
      `C4 "/hello Ana" shows the expanded template as the user message and the fake answers (${JSON.stringify(state.users.at(-1))}, ${String(state.assistants)} answer(s))`,
    );
    const accepted = await waitFor(
      () => /command accepted \/hello for ses_/.test(hostLog()),
      5_000,
      250,
    );
    check(accepted === true, 'C4 the host log says "command accepted /hello for ses_…"');

    // "/broken" + Enter: the server answers 500, the notice shows its message and the draft is back.
    await clearBox();
    await page.keyboard.type('/broken');
    await waitPresent('.command-popup [role="option"]');
    await page.keyboard.press('Enter');
    const failed = await waitFor(
      async () =>
        (await slashState()).notices.some((text) => text.includes('Command failed: broken')),
      10_000,
      200,
    );
    state = await slashState();
    check(
      failed === true && state.value === '/broken',
      `C4 "/broken" shows the message of the 500 and gives the draft back (notices ${JSON.stringify(state.notices)}, box ${JSON.stringify(state.value)})`,
    );
    await clickButton('Dismiss notice');

    // "/nope hola": not a command of the list, so it is a normal prompt with its text as typed.
    await clearBox();
    await page.keyboard.type('/nope hola');
    await page.keyboard.press('Enter');
    await waitFor(async () => (await slashState()).users.at(-1) === '/nope hola', 20_000, 200);
    check(await waitIdle(60_000), 'C4 the turn of /nope hola ends');
    state = await slashState();
    check(
      state.users.at(-1) === '/nope hola',
      `C4 "/nope hola" is sent as a normal prompt (${JSON.stringify(state.users.at(-1))})`,
    );
    check(
      !/command accepted \/nope/.test(hostLog()),
      'C4 the host log has no "command accepted /nope"',
    );

    // Escape with the popup open closes it and does NOT stop a running turn.
    await send('Count from 1 to 400, one number per line. Do not use tools. LONG');
    const running = await waitFor(isBusy, 30_000, 300);
    check(running === true, 'C4 the LONG turn is running, so Escape-versus-Stop can be tested');
    if (running === true) {
      await page.keyboard.type('/');
      await waitPresent('.command-popup [role="option"]', true, 20_000);
      await page.keyboard.press('Escape');
      await waitPresent('.command-popup [role="option"]', false);
      // Negative check below (the turn is NOT stopped): a fixed window after the positive wait.
      await sleep(300);
      state = await slashState();
      check(!state.popup, 'C4 Escape closes the "/" popup');
      check(state.busy, 'C4 Escape with the "/" popup open does NOT stop the running turn');
      await page.keyboard.press('Escape');
      check(await waitIdle(30_000), 'C4 a second Escape (popup closed) stops the turn');
    }
    await clearBox();
    assertNoWebviewErrors('slash commands');
  });

  // E8 (issue #33, decision of Sergio 28/10/2026, Engram #1417): `capabilities.untrustedWorkspaces`
  // is `supported: false`, so a folder that is not trusted (Restricted Mode) must not load the
  // extension. Two extra VS Code windows are started with the extension INSTALLED (not loaded with
  // `--extensionDevelopmentPath`, which Workspace Trust does not disable, see `installExtension`):
  // a control whose trust is switched off, where the OpenCode item must show up, and the subject,
  // with trust enabled and the start-up prompt off, on a folder nobody trusted.
  // Cell D0 (issue #77, E5, plan E9-default-editor section 7): the control window is also the
  // closest thing to a fresh install that this suite has (the extension INSTALLED, a new profile),
  // so it starts WITHOUT the `openVsCode.chatLocation` key (`chatLocation: null`, the other windows
  // of the run carry `sidebar`) and judges the default the user gets: the profile has no key, the
  // host logged `chat location at start: editor` on its first activation, and the OpenCode icon
  // opens the Sessions view (its New Session and Search Sessions title buttons) with no chat
  // iframe inside the side bar. The text of the view's title and of its welcome are printed as
  // data, not judged (HYPOTHESIS about the DOM of VS Code 1.144.0: a container with one view is
  // titled "<container>: <view>"; the run printed title "OpenCode: Sessions").
  // VERIFIED by a full `npm run test:visual` (Windows 11, VS Code 1.144.0, 30/10/2026, "all visual
  // checks passed"), which printed a line starting "ok   D0 a profile with no chatLocation key
  // starts in editor mode: the host logged "chat location at start: editor" (true), the OpenCode
  // icon opens the Sessions view with its New Session and Search Sessions buttons (true) and no
  // chat is in the side bar (0 iframe(s)); key in the profile: false". Not observed: macOS, Linux,
  // a Marketplace install.
  await step(
    '25 Restricted Mode keeps the extension off (Workspace Trust, issue #33)',
    async () => {
      const itemCount = (p, label) =>
        p
          .locator(`.activitybar [aria-label^="${label}"]`)
          .count()
          .catch(() => 0);
      // The text of every OpenCode.log under `<userDataDir>/logs` (the extension host writes there).
      const readHostLog = (userDataDir) => {
        const files = [];
        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name === 'OpenCode.log') files.push(full);
          }
        };
        try {
          walk(path.join(userDataDir, 'logs'));
        } catch {
          return '';
        }
        return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
      };
      // What the side bar of `p` shows: its title text, the title buttons, the welcome text and how
      // many chat iframes have their centre inside it (a webview floats over the side bar, it is
      // not a DOM child of it).
      const sideBarState = (p) =>
        p.evaluate((selector) => {
          const side = globalThis.document.querySelector('.part.sidebar');
          const sideBox = side?.getBoundingClientRect();
          const flat = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
          return {
            title: flat(side?.querySelector('.title-label')?.textContent),
            actions: [...(side?.querySelectorAll('.action-label') ?? [])].map(
              (a) => a.getAttribute('aria-label') ?? '',
            ),
            welcome: flat(side?.querySelector('.welcome-view-content')?.innerText),
            chatFrames: [...globalThis.document.querySelectorAll(selector)].filter((frame) => {
              const box = frame.getBoundingClientRect();
              const x = box.left + box.width / 2;
              return (
                sideBox !== undefined &&
                frame.checkVisibility({ checkVisibilityCSS: true }) &&
                box.width > 0 &&
                x >= sideBox.left &&
                x <= sideBox.right
              );
            }).length,
          };
        }, CHAT_FRAME);
      // Starts a window with `options`, connects to it, runs `body(window, instance)` and always
      // stops it and deletes its folder.
      const withWindow = async (label, options, body) => {
        const folder = createWorkspace();
        let instance;
        let connection;
        try {
          instance = await startVSCode({
            repoRoot,
            workDir: path.join(repoRoot, '.vscode-test', `visual-${label}`),
            workspace: folder,
            installed: true,
            ...options,
          });
          connection = await connectPage(instance.port, 90_000);
          await body(connection.page, instance);
        } finally {
          await connection?.browser.close().catch(() => undefined);
          await instance?.stop();
          fs.rmSync(folder, { recursive: true, force: true });
        }
      };
      await withWindow('trusted', { restricted: false, chatLocation: null }, async (other, win) => {
        const up = await waitFor(async () => (await itemCount(other, 'Explorer')) > 0, 60_000, 500);
        check(up === true, 'the control window is up (its activity bar shows Explorer)');
        const shown = await waitFor(
          async () => (await itemCount(other, 'OpenCode')) > 0,
          10_000,
          300,
        );
        check(
          shown === true,
          'control: the OpenCode item is in the activity bar of the installed extension when trust is off',
        );
        // --- D0: the default of a profile with no `openVsCode.chatLocation` key ----------------------
        const profile = JSON.parse(
          fs.readFileSync(path.join(win.userDataDir, 'User', 'settings.json'), 'utf8'),
        );
        await other.locator('.activitybar [aria-label^="OpenCode"]').first().click();
        const sessionsUp = await waitFor(
          async () =>
            (await sideBarState(other)).actions.some((label) => label.startsWith('New Session')),
          15_000,
          300,
        );
        const startedInEditor = await waitFor(
          () => /chat location at start: editor/.test(readHostLog(win.userDataDir)),
          10_000,
          300,
        );
        await sleep(3_000); // negative check after the positive waits: a chat would resolve by now
        const bar = await sideBarState(other);
        console.log(`  D0 side bar of the control window: ${JSON.stringify(bar)}`);
        check(
          !('openVsCode.chatLocation' in profile) &&
            sessionsUp === true &&
            startedInEditor === true &&
            bar.actions.some((label) => label.startsWith('Search Sessions')) &&
            bar.chatFrames === 0,
          `D0 a profile with no chatLocation key starts in editor mode: the host logged "chat location at start: editor" (${String(startedInEditor)}), the OpenCode icon opens the Sessions view with its New Session and Search Sessions buttons (${String(sessionsUp)}) and no chat is in the side bar (${String(bar.chatFrames)} iframe(s)); key in the profile: ${String('openVsCode.chatLocation' in profile)}`,
        );
        await other
          .screenshot({ path: path.join(shotsDir, '25a-default-editor.png') })
          .catch(() => undefined);
      });
      await withWindow('restricted', { restricted: true }, async (other) => {
        const up = await waitFor(async () => (await itemCount(other, 'Explorer')) > 0, 60_000, 500);
        check(up === true, 'the Restricted Mode window is up (its activity bar shows Explorer)');
        const restrictedBadge = await waitFor(
          () =>
            other.evaluate(() =>
              (globalThis.document.querySelector('.statusbar')?.textContent ?? '').includes(
                'Restricted Mode',
              ),
            ),
          15_000,
          300,
        );
        check(
          restrictedBadge === true,
          'the window is in Restricted Mode (the status bar says "Restricted Mode")',
        );
        // Negative checks follow the positive waits above; the extra time is for a slow activation.
        await sleep(4_000);
        const restrictedItems = await itemCount(other, 'OpenCode');
        check(
          restrictedItems === 0,
          `in Restricted Mode the OpenCode item is NOT in the activity bar (${String(restrictedItems)})`,
        );
        // The palette: a query that must match (the palette works), then the one that must not.
        const paletteRows = async (text) => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await other.keyboard.press('F1');
            const open = await waitFor(
              () => other.locator('.quick-input-widget input').first().isVisible(),
              2_000,
              100,
            );
            if (open) break;
          }
          const input = other.locator('.quick-input-widget input').first();
          await input.click({ timeout: 2_000 }).catch(() => undefined);
          await other.keyboard.press('ControlOrMeta+A');
          await other.keyboard.type(`>${text}`);
          await waitFor(async () => (await input.inputValue()) === `>${text}`, 2_000, 50);
          await sleep(1_000); // the list filters asynchronously; the caller reads a negative too
          return other.evaluate(() =>
            [...globalThis.document.querySelectorAll('.quick-input-list .monaco-list-row')].map(
              (row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
            ),
          );
        };
        const trustRows = await paletteRows('Manage Workspace Trust');
        check(
          trustRows.some((row) => /Workspace Trust/i.test(row)),
          `the palette of the Restricted Mode window lists "Manage Workspace Trust" (${JSON.stringify(trustRows.slice(0, 2))})`,
        );
        const openCodeRows = await paletteRows('OpenCode: Open Chat');
        check(
          !openCodeRows.some((row) => /opencode/i.test(row)),
          `the palette of the Restricted Mode window has no OpenCode command (${JSON.stringify(openCodeRows)})`,
        );
        await other.keyboard.press('Escape');
        // No "no OpenCode.log" check: the extension activates when the chat view opens (empty
        // `activationEvents`) and neither window opens it, so the control would have no log either
        // and the absence would prove nothing (review W1, Engram #1423).
        await other
          .screenshot({ path: path.join(shotsDir, '25-restricted-mode.png') })
          .catch(() => undefined);
      });
    },
  );

  // Step 26 (issue #36, plan E9-context-menus section 8): the context-menu entries of the editor
  // and the Explorer, driven with the REAL right mouse button and judged in the DOM of the webview
  // (never in the host log, which carries no text). Cells: C1 the three entries of the editor menu,
  // in order; C2 the two of the Explorer menu with two files selected; C3 Explain from the editor
  // sends the exact prompt with the chip `src/sample.ts#2-3` and leaves the user's draft alone; C4
  // Fix lists the two errors the TypeScript server reports; C5 Explain from the Explorer with the
  // chat view HIDDEN, two files and a folder selected: two chips and ONE notice with the count; C6
  // a busy session makes Fix fall to the prompt box (text, chip, notice, focus), the notice has
  // contrast >= 4.5 in the four themes at 300 px and the box with several lines does not overflow
  // at 300 px and under 200 px (dark); C7 an untitled document has no entries and a file outside
  // the workspace folder raises the native warning and sends nothing.
  await step('26 editor and Explorer context menus (issue #36)', async () => {
    const DARK = 'Default Dark Modern';
    const EXPLAIN = 'Explain with OpenCode';
    const ADD = 'Add to OpenCode Chat';
    const FIX = 'Fix with OpenCode';
    const srcDir = path.join(workspace, 'src');
    const brokenFile = path.join(srcDir, 'broken26.ts');
    const otherFile = path.join(srcDir, 'context-b.ts');
    const outsideFile = path.join(workDir, 'outside26.ts');
    const ctx = () =>
      web.inDoc((doc) => {
        const box = (element) => {
          if (!element) return null;
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
        };
        const field = doc.querySelector('textarea.prompt-text');
        const groups = [...doc.querySelectorAll('[role="log"] .message-files')];
        const lastGroup = groups.at(-1);
        return {
          view: { width: doc.defaultView.innerWidth, height: doc.defaultView.innerHeight },
          scrollOverflow: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
          styled: [...doc.querySelectorAll('body [style], body[style]')].filter(
            (e) => (e.getAttribute('style') ?? '').trim() !== '',
          ).length,
          value: field?.value ?? '',
          field: box(field),
          prompt: box(doc.querySelector('form.prompt')),
          fieldOverflow: field ? field.scrollWidth - field.clientWidth : 0,
          focusOnBox: field !== null && doc.activeElement === field,
          chips: [...doc.querySelectorAll('.chips .chip-open, .chips .chip-name')].map(
            (c) => c.textContent ?? '',
          ),
          users: [...doc.querySelectorAll('[role="log"] .message-user .part-text')].map((m) =>
            (m.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ),
          sentChips: lastGroup
            ? [...lastGroup.querySelectorAll('.chip')].map((c) => (c.textContent ?? '').trim())
            : [],
          notices: [...doc.querySelectorAll('.status-bar .alert .alert-text')].map((n) =>
            (n.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ),
        };
      });
    // A Playwright locator, not `page.evaluate`: the editor's context menu lives in a shadow root
    // (seen 29/10/2026: `querySelectorAll` found no row while the menu was on screen) and locators
    // pierce open shadow roots; the Explorer's menu is plain DOM and works the same way.
    const menuRows = async () =>
      (await page.locator('.monaco-menu .action-label').allInnerTexts())
        .map((text) => text.trim())
        .filter((text) => text !== '');
    const closeMenu = async () => {
      await page.keyboard.press('Escape');
      await waitFor(async () => (await menuRows()).length === 0, 2_000, 100);
    };
    // A real right-click at a point; resolves once a menu with rows is on screen.
    const rightClick = async (point) => {
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await waitFor(async () => (await menuRows()).length > 0, 3_000, 100);
    };
    // The entry is clicked again until the menu is gone: a click right after the menu opens only
    // highlights it (see step 20, 28/10/2026).
    const choose = async (label) => {
      const entry = page.locator('.monaco-menu').getByText(label, { exact: true });
      for (let attempt = 0; attempt < 3 && (await entry.count()) > 0; attempt += 1) {
        await entry.first().click();
        await waitFor(async () => (await entry.count()) === 0, 1_000, 100);
      }
    };
    // Where to right-click in the editor: inside the line that holds `text` (or the first line).
    const linePoint = async (text) => {
      // Without `text` (an empty or unknown document) the point is in the empty area of the
      // visible editor, below its lines: the "Select a language" hint of an untitled document
      // swallowed the right-click when the point was on its line (seen 29/10/2026).
      const target =
        text === undefined
          ? page.locator('.monaco-editor:visible').first()
          : page.locator('.monaco-editor .view-lines .view-line').filter({ hasText: text }).first();
      const box = await target.boundingBox({ timeout: 3_000 }).catch(() => null);
      return box === null
        ? null
        : text === undefined
          ? { x: box.x + 300, y: box.y + 250 }
          : { x: box.x + 40, y: box.y + box.height / 2 };
    };
    const editorHasFocus = () =>
      page.evaluate(() => globalThis.document.activeElement?.closest('.monaco-editor') != null);
    const quickOpen = async (spec, tabName) => {
      await page.keyboard.press('ControlOrMeta+p');
      await waitFor(async () => !(await quickInputHidden()), 2_000, 50);
      await page.keyboard.type(spec);
      await waitFor(
        () =>
          page.evaluate(
            (name) =>
              (
                globalThis.document.querySelector('.quick-input-list .monaco-list-row.focused')
                  ?.textContent ?? ''
              ).includes(name),
            tabName,
          ),
        3_000,
        50,
      );
      await page.keyboard.press('Enter');
      await waitFor(
        async () => (await page.locator(`.tab.active[aria-label*="${tabName}"]`).count()) > 0,
        5_000,
        100,
      );
      await waitFor(editorHasFocus, 3_000, 100);
    };
    const editorSelection = () =>
      page
        .locator('#status\\.editor\\.selection')
        .first()
        .innerText()
        .catch(() => '');
    const selectLines2to3 = async () => {
      await page.keyboard.press('ControlOrMeta+Home');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');
      await waitFor(async () => /\(\d+ selected\)/.test(await editorSelection()), 2_000, 100);
    };
    const clearBox = () => clearPromptBox(150);
    const removeChips = async () => {
      for (let guard = 0; guard < 6 && (await ctx()).chips.length > 0; guard += 1) {
        await clickIn('.chips .chip-remove');
        await sleep(200); // one chip gone per round; the count read next is the only signal
      }
    };
    const dismissNotices = async () => {
      for (let guard = 0; guard < 8 && (await ctx()).notices.length > 0; guard += 1) {
        await clickButton('Dismiss notice');
        await sleep(150); // one notice gone per round; the count read next is the only signal
      }
    };
    const inView = (box, view) =>
      box !== null &&
      box.left >= -0.5 &&
      box.top >= -0.5 &&
      box.right <= view.width + 0.5 &&
      box.bottom <= view.height + 0.5;

    check(await waitIdle(60_000), 'no turn is running when the step starts');
    // The step does not trust what the steps before it left behind: step 19 rewrites
    // `src/sample.ts` (a full run found two lines, `value2 = 52`, so line 2-3 and "line 2" were
    // not there). Its 30 lines are written again, as `createWorkspace` makes them, with no editor
    // holding the old text.
    await closeAllEditors();
    const sampleLines = ['// Sample file for the visual test run.'];
    for (let line = 2; line <= 30; line += 1) {
      sampleLines.push(
        line === 20
          ? 'export function greet(name: string): string { return `Hello, ${name}!`; }'
          : `export const value${String(line)} = ${String(line)};`,
      );
    }
    fs.writeFileSync(path.join(srcDir, 'sample.ts'), `${sampleLines.join('\n')}\n`);
    fs.writeFileSync(brokenFile, "const x: number = 'text';\nconst y: string = 42;\n");
    fs.writeFileSync(otherFile, 'export const other = 1;\n');
    fs.writeFileSync(outsideFile, 'export const outside = 1;\nexport const more = 2;\n');
    try {
      await setTheme(DARK);
      try {
        await setSideBarWidth(300);
      } catch (error) {
        warn(
          `context menus: the side bar did not go to 300 px: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await waitFor(async () => (await ctx()).view !== undefined, 60_000, 500);
      check(await clickButton('New session'), 'New session is pressed');
      await waitEmptyView();
      // Notices, a draft and chips of earlier steps survive New session (a full run showed four
      // notices and a draft here); the cells below count and measure them.
      await dismissNotices();
      await clearBox();
      await removeChips();
      assertNoWebviewErrors('before the context menus step');

      // --- C1 + C3: the editor menu, and Explain from it with a draft in the box ----------------
      await focusPromptBox();
      await page.keyboard.type('my draft');
      await waitFor(async () => (await ctx()).value === 'my draft', 3_000, 100);
      await quickOpen('src/sample.ts', 'sample.ts');
      await selectLines2to3();
      const aim = await linePoint('value2 = 2');
      check(aim !== null, 'C1 the editor shows line 2 of src/sample.ts to right-click on');
      await rightClick(aim);
      let rows = await menuRows();
      const at = rows.indexOf(ADD);
      check(
        at >= 0 && rows[at + 1] === EXPLAIN && rows[at + 2] === FIX,
        `C1 the editor right-click menu lists "${ADD}", "${EXPLAIN}" and "${FIX}" in that order (${JSON.stringify(rows)})`,
      );
      await shot('26a-editor-menu');
      const usersBefore = (await ctx()).users.length;
      await choose(EXPLAIN);
      const asked = await waitFor(
        async () => (await ctx()).users.length > usersBefore,
        20_000,
        200,
      );
      let state = await ctx();
      check(
        asked === true && state.users.at(-1) === 'Explain what @src/sample.ts#2-3 does.',
        `C3 Explain from the editor sends "Explain what @src/sample.ts#2-3 does." (${JSON.stringify(state.users.at(-1))})`,
      );
      check(
        state.sentChips.length === 1 && state.sentChips[0] === 'src/sample.ts#2-3',
        `C3 the sent message carries the chip src/sample.ts#2-3 (${JSON.stringify(state.sentChips)})`,
      );
      check(
        state.value === 'my draft' && state.chips.length === 0,
        `C3 the draft the user was writing is untouched (${JSON.stringify(state.value)}, ${String(state.chips.length)} chips)`,
      );
      await shot('26b-explain-sent');
      check(await waitIdle(60_000), 'C3 the turn of the Explain prompt ends');
      await clearBox();

      // --- C4: Fix lists the diagnostics of the TypeScript server --------------------------------
      await quickOpen('src/broken26.ts', 'broken26.ts');
      const squiggles = await waitFor(
        async () => (await page.locator('.monaco-editor .squiggly-error').count()) >= 2,
        30_000,
        500,
      );
      check(
        squiggles === true,
        'C4 the editor underlines the two errors of src/broken26.ts (the TypeScript server answered)',
      );
      await page.keyboard.press('ControlOrMeta+A');
      const aimBroken = await linePoint('const x');
      check(aimBroken !== null, 'C4 the editor shows line 1 of src/broken26.ts to right-click on');
      await rightClick(aimBroken);
      const usersBeforeFix = (await ctx()).users.length;
      await choose(FIX);
      const fixed = await waitFor(
        async () => (await ctx()).users.length > usersBeforeFix,
        20_000,
        200,
      );
      state = await ctx();
      const fixText = state.users.at(-1) ?? '';
      check(
        fixed === true &&
          fixText.startsWith('Fix the problems in @src/broken26.ts') &&
          fixText.includes('Problems reported by VS Code:') &&
          fixText.includes("Line 1: Type 'string' is not assignable to type 'number'.") &&
          fixText.includes("Line 2: Type 'number' is not assignable to type 'string'."),
        `C4 Fix sends the problems of both lines (${JSON.stringify(fixText)})`,
      );
      await shot('26c-fix-sent');
      check(await waitIdle(60_000), 'C4 the turn of the Fix prompt ends');

      // --- C6: a busy session makes Fix fall to the prompt box ----------------------------------
      await dismissNotices();
      await removeChips();
      await quickOpen('src/broken26.ts', 'broken26.ts');
      await page.keyboard.press('ControlOrMeta+A');
      await send('Count from 1 to 400, one number per line. Do not use tools. LONG');
      check((await waitFor(isBusy, 30_000, 300)) === true, 'C6 a LONG turn is running');
      const usersWhileBusy = (await ctx()).users.length;
      const aimBusy = await linePoint('const x');
      await rightClick(aimBusy);
      await choose(FIX);
      const fell = await waitFor(
        async () => (await ctx()).value.startsWith('Fix the problems in @src/broken26.ts'),
        15_000,
        200,
      );
      state = await ctx();
      check(
        fell === true &&
          state.value.includes('Problems reported by VS Code:') &&
          state.chips.some((chip) => chip.startsWith('src/broken26.ts')) &&
          state.users.length === usersWhileBusy,
        `C6 while a turn runs, Fix goes to the prompt box with its text and its chip and sends nothing (${JSON.stringify(state.value.slice(0, 60))}, ${JSON.stringify(state.chips)})`,
      );
      check(
        state.notices.some((text) => text === 'OpenCode is busy: the prompt is in the box'),
        `C6 the notice says "OpenCode is busy: the prompt is in the box" (${JSON.stringify(state.notices)})`,
      );
      const focused = await waitFor(async () => (await ctx()).focusOnBox, 3_000, 200);
      check(focused === true, 'C6 the prompt box has the focus');
      check(await clickButton('Stop'), 'C6 Stop is pressed');
      check(await waitIdle(30_000), 'C6 the LONG turn ends');
      for (const [themeName, theme] of PROBLEM_THEMES) {
        await setTheme(theme);
        await waitFor(async () => (await ctx()).view !== undefined, 60_000, 500);
        const look = await web.inDoc(measureText, {
          notice: '.status-bar .alert:not(.alert-error) .alert-text',
        });
        check(
          look.notice != null && look.notice.ratio >= 4.5,
          `C6 at 300 px, ${themeName}: the notice has contrast >= 4.5 (${look.notice ? look.notice.ratio.toFixed(2) : 'not found'})`,
        );
        if (themeName === 'dark') {
          await shot('26d-busy-draft-300-dark');
          state = await ctx();
          check(
            state.scrollOverflow <= 1 &&
              state.styled === 0 &&
              inView(state.field, state.view) &&
              inView(state.prompt, state.view) &&
              state.fieldOverflow <= 1,
            `C6 at 300 px, dark: the box with ${String(state.value.split('\n').length)} lines does not overflow (page ${String(state.scrollOverflow)} px, box ${String(state.fieldOverflow)} px, ${JSON.stringify(state.field)})`,
          );
        }
      }
      await setTheme(DARK);
      let narrow;
      try {
        narrow = await setSideBarWidth(150);
      } catch {
        narrow = await sideBarPx();
      }
      if (narrow < 200) {
        await waitFor(async () => (await ctx()).view !== undefined, 60_000, 500);
        state = await ctx();
        await shot('26e-busy-draft-narrow-dark');
        check(
          state.scrollOverflow <= 1 &&
            state.styled === 0 &&
            inView(state.field, state.view) &&
            inView(state.prompt, state.view) &&
            state.fieldOverflow <= 1,
          `C6 under 200 px (bar ${String(Math.round(narrow))} px), dark: the box with several lines does not overflow (page ${String(state.scrollOverflow)} px, box ${String(state.fieldOverflow)} px, ${JSON.stringify(state.field)})`,
        );
      } else {
        warn(
          `context menus: the side bar did not go under 200 px (${String(narrow)} px): not judged`,
        );
      }
      try {
        await setSideBarWidth(300);
      } catch {
        // The sash did not go back; the Explorer cells below do not depend on the width.
      }
      await clearBox();
      await removeChips();
      await dismissNotices();

      // --- C2 + C5: the Explorer menu, Explain on two files and a folder with the chat HIDDEN ----
      await command('View: Show Explorer');
      const rowOf = (label) =>
        page.locator(`.explorer-folders-view [role="treeitem"][aria-label^="${label}"]`);
      const folderRow = page.locator('.explorer-folders-view [role="treeitem"][aria-label="src"]');
      await waitFor(
        async () => (await rowOf('sample.ts').count()) > 0 || (await folderRow.count()) > 0,
        4_000,
        100,
      );
      if ((await rowOf('sample.ts').count()) === 0) {
        await folderRow.first().click();
      }
      await waitFor(
        async () =>
          (await rowOf('sample.ts').count()) > 0 && (await rowOf('context-b.ts').count()) > 0,
        5_000,
        100,
      );
      check(
        (await rowOf('sample.ts').count()) > 0 && (await rowOf('context-b.ts').count()) > 0,
        'C2 the Explorer lists src/sample.ts and src/context-b.ts (the chat view is hidden while it is shown)',
      );
      await rowOf('sample.ts').first().click();
      await rowOf('context-b.ts')
        .first()
        .click({ modifiers: ['ControlOrMeta'] });
      const selectedRows = () =>
        page.locator('.explorer-folders-view .monaco-list-row.selected').count();
      await waitFor(async () => (await selectedRows()) === 2, 2_000, 100);
      check((await selectedRows()) === 2, 'C2 two files are selected in the Explorer');
      await rowOf('context-b.ts').first().click({ button: 'right' });
      await waitFor(async () => (await menuRows()).length > 0, 3_000, 100);
      rows = await menuRows();
      const explorerAt = rows.indexOf(ADD);
      check(
        explorerAt >= 0 && rows[explorerAt + 1] === EXPLAIN && !rows.includes(FIX),
        `C2 the Explorer right-click menu lists "${ADD}" then "${EXPLAIN}" and no Fix (${JSON.stringify(rows)})`,
      );
      await shot('26f-explorer-menu');
      await closeMenu();
      await folderRow.first().click({ modifiers: ['ControlOrMeta'] });
      await waitFor(async () => (await selectedRows()) === 3, 2_000, 100);
      check((await selectedRows()) === 3, 'C5 two files and the folder src are selected');
      await folderRow.first().click({ button: 'right' });
      await waitFor(async () => (await menuRows()).length > 0, 3_000, 100);
      await choose(EXPLAIN);
      await openChat();
      const arrived = await waitFor(
        async () => /^Explain what @\S+ and @\S+ do\.$/.test((await ctx()).users.at(-1) ?? ''),
        20_000,
        300,
      );
      state = await ctx();
      const explorerText = state.users.at(-1) ?? '';
      check(
        arrived === true &&
          explorerText.includes('@src/sample.ts') &&
          explorerText.includes('@src/context-b.ts'),
        `C5 the chat that was hidden when the command ran sends "Explain what @… and @… do." (${JSON.stringify(explorerText)})`,
      );
      check(
        state.sentChips.length === 2 &&
          state.sentChips.includes('src/sample.ts') &&
          state.sentChips.includes('src/context-b.ts'),
        `C5 the sent message carries two chips, one per file (${JSON.stringify(state.sentChips)})`,
      );
      const skippedNotices = state.notices.filter((text) => text.includes('not added'));
      check(
        skippedNotices.length === 1 &&
          skippedNotices[0].startsWith('1 selected item was not added'),
        `C5 ONE notice counts the skipped folder (${JSON.stringify(state.notices)})`,
      );
      await shot('26g-explorer-explain');
      check(await waitIdle(60_000), 'C5 the turn of the Explorer prompt ends');
      await dismissNotices();

      // --- C7: no entries on an untitled document; a file outside the workspace is refused -------
      // The shortcut, not the palette: the palette's best match for the title opened a diff of two
      // untitled files (seen 29/10/2026), and a stray tab would carry stale editor boxes.
      await closeAllEditors();
      await page.keyboard.press('ControlOrMeta+n');
      await waitFor(
        async () => (await page.locator('.tab.active[aria-label*="Untitled"]').count()) > 0,
        5_000,
        100,
      );
      await waitFor(editorHasFocus, 3_000, 100);
      const aimUntitled = await linePoint(undefined);
      check(aimUntitled !== null, 'C7 the untitled editor shows a line to right-click on');
      await rightClick(aimUntitled);
      await shot('26i-untitled-menu');
      rows = await menuRows();
      check(
        rows.some((row) => row.startsWith('Command Palette')) &&
          ![ADD, EXPLAIN, FIX].some((label) => rows.includes(label)),
        `C7 the right-click menu of an untitled document has no OpenCode entry (${JSON.stringify(rows)})`,
      );
      await closeMenu();
      await closeAllEditors();
      await quickOpen(outsideFile, 'outside26.ts');
      const aimOutside = await linePoint(undefined);
      await rightClick(aimOutside);
      const usersBeforeOutside = (await ctx()).users.length;
      await choose(EXPLAIN);
      const warned = await waitFor(
        async () =>
          (await page.locator('.notifications-toasts .notification-toast').allInnerTexts()).some(
            (text) => text.includes('Only files inside the workspace folder can be added'),
          ),
        8_000,
        200,
      );
      check(
        warned === true,
        'C7 Explain on a file outside the workspace folder raises the native warning "Only files inside the workspace folder can be added"',
      );
      await shot('26h-outside-warning');
      await sleep(1_000); // negative check after the positive wait: nothing may reach the chat
      check(
        (await ctx()).users.length === usersBeforeOutside,
        'C7 and the refused Explain sends nothing to the chat',
      );
      await closeAllEditors();
      assertNoWebviewErrors('context menus');
    } finally {
      for (const file of [brokenFile, otherFile, outsideFile]) fs.rmSync(file, { force: true });
    }
  });

  // Step 27 (issue #77, plan E9-chat-location sections 8 and 9): the chat in editor tabs
  // (`openVsCode.chatLocation: editor`), judged in the DOM of the workbench (tabs, groups, the
  // Sessions view, toasts, badge) and of each tab's webview. Cells: C1 the Sessions view; C2 the chat inside
  // a tab in the four themes at a medium width (the tab beside the code) and in one theme at the
  // full width; C3 the tab's title and icon in the four themes; C4 a LONG turn that ends while its
  // tab is hidden shows complete and once when the tab returns; C5 clicking A's row in the Sessions
  // view reveals A; C6 New Session from the palette, from the Sessions view's title button and with
  // Ctrl+Alt+N opens a new tab with the caret in its prompt; C7 Insert at cursor and Add selection
  // from a tab reach the last text editor; C8 a file link and a diff of "Changed files" open
  // outside the chat's group; C9 Explain with every tab hidden goes to the most recent tab; C10
  // the switch of mode in both directions; C11 a request with no chat on screen raises a toast and
  // a badge, and "Open chat" reveals the tab of its session. What Reload Window does to the tabs
  // is step 28 (it was C12 here, a record taken before the serializer existed: "kept 0 of 5
  // tabs"). The widths are measured and printed, not assumed.
  // VERIFIED by a full `npm run test:visual` on the final tree (Windows 11, VS Code 1.144.0,
  // 30/10/2026, 0 FAIL, "all visual checks passed"), which printed: "ok   C10 sidebar -> editor
  // opens ONE tab with the side bar session beside the code, and the side bar has no chat",
  // "ok   C1 the Sessions view lists the session of the tab with no welcome text, shows the New
  // Session, Search Sessions and Open Settings title buttons, and holds no chat", "ok   C4 coming
  // back to A shows the whole reply once: 400 numbers, from 1 to 400, in order, no repeats (1
  // assistant block with the 400)", "ok   C5 clicking A's row in the Sessions view reveals A and
  // adds no tab (2 -> 2 tabs; the tab has no Sessions button: true)", "ok   C9 Explain with every
  // tab hidden reveals the most recent tab and sends there" and "ok   C11 "Open chat" of the
  // notification reveals the tab of the session and its permission card is there (tab true, card
  // true)"; the badge line reads "ok   C11 with every chat tab hidden a request raises a native
  // notification (…) and the badge of the Sessions view shows on the OpenCode icon ("1")".
  // Found by it and not by any unit test: the same file open in two groups makes Explain
  // lose its range (`editorForMenu`, hence `other27.ts`), and a toast that covers the prompt box.
  // NOT measured: macOS, Linux, the badge of the Sessions view while it is hidden, two windows.
  await step('27 chat in editor tabs (issue #77)', async () => {
    const DARK = 'Default Dark Modern';
    const EXPLAIN = 'Explain with OpenCode';
    const PROMPT_A = 'Tab27A: Reply with exactly: alpha27. Do not use any tools.';
    const PROMPT_B = 'Tab27B: Reply with exactly: beta27. Do not use any tools.';
    const titleOf = (prompt) => prompt.slice(0, 40).trim(); // the fixture titles a session so
    const TITLE_A = titleOf(PROMPT_A);
    const srcDir = path.join(workspace, 'src');
    const setLocation = (value) => {
      writeSettings(vscode.userDataDir, { 'openVsCode.chatLocation': value });
    };
    const tabsNow = () =>
      page.evaluate(() => {
        const groups = [...globalThis.document.querySelectorAll('.editor-group-container')];
        return [...globalThis.document.querySelectorAll('.tab')].map((tab) => ({
          label: tab.getAttribute('aria-label') ?? '',
          text: (tab.innerText ?? '').trim(),
          active: tab.classList.contains('active'),
          group: groups.indexOf(tab.closest('.editor-group-container')),
        }));
      });
    // A chat tab is any tab that is not a TypeScript file or a diff of one (no title here has ".ts").
    const isChatTab = (tab) => !/\.ts\b/.test(`${tab.label} ${tab.text}`);
    const chatTabs = async () => (await tabsNow()).filter(isChatTab);
    const groupCount = () => page.locator('.editor-group-container').count();
    const hostLog = () => {
      const files = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name === 'OpenCode.log') files.push(full);
        }
      };
      try {
        walk(path.join(vscode.userDataDir, 'logs'));
      } catch {
        return '';
      }
      return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    };
    const logCount = (pattern) => (hostLog().match(pattern) ?? []).length;
    const view = () =>
      web.inDoc((doc) => {
        const field = doc.querySelector('textarea.prompt-text');
        return {
          title: doc.querySelector('.chat-title')?.textContent ?? '',
          messages: doc.querySelectorAll('[role="log"] > *').length,
          value: field?.value ?? '',
          focusOnBox: field !== null && doc.activeElement === field && doc.hasFocus(),
          users: [...doc.querySelectorAll('[role="log"] .message-user .part-text')].map((m) =>
            (m.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ),
          lastAssistant:
            // innerText, not textContent: the Markdown renders the line breaks as <br>.
            [...doc.querySelectorAll('[role="log"] .message-assistant .markdown')].at(-1)
              ?.innerText ?? '',
          // How many assistant blocks mention 400: a reply shown twice (C4) makes it 2.
          with400: [...doc.querySelectorAll('[role="log"] .message-assistant .markdown')].filter(
            (block) => /\b400\b/.test(block.innerText),
          ).length,
          chips: [...doc.querySelectorAll('.chips .chip-open, .chips .chip-name')].map(
            (c) => c.textContent ?? '',
          ),
          kind: doc.body.getAttribute('data-vscode-theme-kind') ?? '',
        };
      });
    // Brings the chat tab whose label has `needle` to the front and connects to its webview.
    const switchTo = async (needle) => {
      const previous = drivenChatId;
      const already = (await tabsNow()).some((tab) => tab.active && tab.text.includes(needle));
      await page.locator('.tab', { hasText: needle }).first().click();
      if (!already) {
        await waitFor(
          async () => {
            const id = await visibleChatId();
            return id !== undefined && id !== previous ? id : undefined;
          },
          8_000,
          100,
        );
      }
      await openChat(30_000);
    };
    // Waits for a chat other than `previous` to be on screen (a new tab) and connects to it.
    const connectToNew = async (previous) => {
      await waitFor(
        async () => {
          const id = await visibleChatId();
          return id !== undefined && id !== previous ? id : undefined;
        },
        10_000,
        100,
      );
      await openChat(30_000);
    };
    const editorHasFocus = () =>
      page.evaluate(() => globalThis.document.activeElement?.closest('.monaco-editor') != null);
    const quickOpen = async (spec, tabName) => {
      await page.keyboard.press('ControlOrMeta+p');
      await waitFor(async () => !(await quickInputHidden()), 2_000, 50);
      await page.keyboard.type(spec);
      await waitFor(
        () =>
          page.evaluate(
            (name) =>
              (
                globalThis.document.querySelector('.quick-input-list .monaco-list-row.focused')
                  ?.textContent ?? ''
              ).includes(name),
            tabName,
          ),
        3_000,
        50,
      );
      await page.keyboard.press('Enter');
      await waitFor(
        async () => (await page.locator(`.tab.active[aria-label*="${tabName}"]`).count()) > 0,
        5_000,
        100,
      );
      await waitFor(editorHasFocus, 3_000, 100);
    };
    const editorSelection = () =>
      page
        .locator('#status\\.editor\\.selection')
        .first()
        .innerText()
        .catch(() => '');
    const selectLines2to3 = async () => {
      await page.keyboard.press('ControlOrMeta+Home');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');
      await waitFor(async () => /\(\d+ selected\)/.test(await editorSelection()), 2_000, 100);
    };
    // Gives the focus to the text editor of `sample.ts` that sits in the first group, with the real
    // mouse on its tab and then on its text.
    const focusSampleEditor = async () => {
      await page.locator('.tab', { hasText: 'sample.ts' }).first().click();
      await page.locator('.monaco-editor:visible .view-lines').first().click();
      await waitFor(editorHasFocus, 3_000, 100);
    };
    const menuRows = async () =>
      (await page.locator('.monaco-menu .action-label').allInnerTexts())
        .map((text) => text.trim())
        .filter((text) => text !== '');
    const launcher = () =>
      page.evaluate((selector) => {
        const side = globalThis.document.querySelector('.part.sidebar');
        return {
          text: (side?.querySelector('.welcome-view-content')?.innerText ?? '')
            .replace(/\s+/g, ' ')
            .trim(),
          // The rows of the native Sessions tree (group headers and sessions), as VS Code draws them.
          rows: [...(side?.querySelectorAll('.monaco-list-row') ?? [])].map((row) =>
            (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
          ),
          buttons: [...(side?.querySelectorAll('.welcome-view-content .monaco-button') ?? [])].map(
            (b) => (b.textContent ?? '').trim(),
          ),
          actions: [...(side?.querySelectorAll('.action-label') ?? [])].map(
            (a) => a.getAttribute('aria-label') ?? '',
          ),
          // A webview is not a DOM child of the side bar (it floats over it), so a chat "in the
          // side bar" is a visible chat iframe whose centre lies inside the side bar's box.
          chatFrames: [...globalThis.document.querySelectorAll(selector)].filter((frame) => {
            const sideBox = side?.getBoundingClientRect();
            const box = frame.getBoundingClientRect();
            const x = box.left + box.width / 2;
            return (
              sideBox !== undefined &&
              frame.checkVisibility({ checkVisibilityCSS: true }) &&
              box.width > 0 &&
              x >= sideBox.left &&
              x <= sideBox.right
            );
          }).length,
        };
      }, CHAT_FRAME);
    const showOpenCodeBar = async () => {
      const shows = async () =>
        (await launcher()).actions.some((label) => label.startsWith('New Session'));
      if (!(await shows())) {
        await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
        await waitFor(shows, 5_000, 100);
      }
    };
    const sidebarChatId = () =>
      page.evaluate((selector) => {
        const sideBox = globalThis.document.querySelector('.part.sidebar')?.getBoundingClientRect();
        return [...globalThis.document.querySelectorAll(selector)].find((frame) => {
          const box = frame.getBoundingClientRect();
          const x = box.left + box.width / 2;
          return (
            sideBox !== undefined &&
            frame.checkVisibility({ checkVisibilityCSS: true }) &&
            box.width > 0 &&
            x >= sideBox.left &&
            x <= sideBox.right
          );
        })?.name;
      }, CHAT_FRAME);
    const clearBox = () => clearPromptBox(150);
    const removeChips = async () => {
      for (let guard = 0; guard < 6 && (await view()).chips.length > 0; guard += 1) {
        await clickIn('.chips .chip-remove');
        await sleep(200); // one chip gone per round; the count read next is the only signal
      }
    };
    const closeSampleTabs = async () => {
      for (let guard = 0; guard < 6; guard += 1) {
        const tab = page.locator('.tab', { hasText: '.ts' }).first();
        if ((await tab.count()) === 0) break;
        await tab.hover();
        await tab.locator('.tab-actions .action-label').first().click({ timeout: 3_000 });
        await sleep(200); // one tab gone per round; the count read next is the only signal
      }
    };
    const channel = (value) => {
      const s = value / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminanceOf = ([r, g, b]) =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const ratioOf = (a, b) => {
      const [high, low] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x);
      return (high + 0.05) / (low + 0.05);
    };
    const rgbOf = (css) => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    // The label, the icon file and the background of the tab whose text has `needle`.
    const tabLook = (needle) =>
      page.evaluate((text) => {
        const tab = [...globalThis.document.querySelectorAll('.tab')].find((t) =>
          (t.innerText ?? '').includes(text),
        );
        if (!tab) return null;
        // The icon of a webview tab is the inline `background-image` of `.monaco-icon-label-iconpath`
        // (read from the DOM of VS Code 1.144.0, 29/10/2026), not a pseudo-element.
        const iconBox = tab.querySelector('.monaco-icon-label-iconpath');
        const before = iconBox ? globalThis.getComputedStyle(iconBox) : null;
        let background = null;
        // The colour of a tab is painted by its `.tab-fill`; the ancestors are the fallback.
        for (
          let node = tab.querySelector('.tab-fill') ?? tab;
          node && background === null;
          node = node.parentElement
        ) {
          const css = globalThis.getComputedStyle(node).backgroundColor;
          const parts = css.match(/[\d.]+/g) ?? [];
          if (parts.length === 3 || Number(parts[3]) > 0.9) background = css;
        }
        return {
          label: (tab.querySelector('.label-name')?.textContent ?? tab.innerText ?? '').trim(),
          icon: before ? before.backgroundImage : '',
          background,
        };
      }, needle);

    check(await waitIdle(60_000), 'no turn is running when the step starts');
    await closeAllEditors();
    const sampleFile = path.join(srcDir, 'sample.ts');
    const sampleBefore = fs.readFileSync(sampleFile, 'utf8');
    fs.writeFileSync(path.join(srcDir, 'removed.ts'), 'export const removed = true;\n');
    fs.writeFileSync(
      path.join(srcDir, 'other27.ts'),
      'export const o27a = 1;\nexport const o27b = 2;\nexport const o27c = 3;\nexport const o27d = 4;\n',
    );
    try {
      await setTheme(DARK);
      // A toast ("All installed extensions are temporarily disabled", from `--disable-extensions`)
      // sat over the prompt box in the first run of this step and swallowed the click on it.
      await command('Notifications: Clear All Notifications');
      await quickOpen('src/sample.ts', 'sample.ts');

      // --- C10 (sidebar to editor): the side bar session opens in a tab beside the code ---------
      // Step 26 leaves the Explorer in the side bar, but a filtered run finds the chat there: a
      // second press on the activity bar item would hide the side bar.
      if ((await visibleChatId()) === undefined) {
        await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
        await waitFor(async () => (await visibleChatId()) !== undefined, 10_000, 200);
      }
      await openChat(30_000);
      check(
        (await page.locator(`${CHAT_FRAME}[name="${String(drivenChatId)}"]`).count()) === 1,
        'C10 the iframe of the chat carries extensionId=sergwei.open-vs-code in its src, so the chat selectors skip foreign webviews',
      );
      await waitConnected();
      check(await clickButton('New session'), 'C10 New session is pressed in the side bar chat');
      await waitEmptyView();
      await send(PROMPT_A);
      check(await waitIdle(30_000), 'C10 the turn of the side bar session ends');
      // E9-chat-view-settings (#133): the title bar of the side bar Chat view. Open Settings is a
      // button; Restart Server went to the overflow menu, so it is no title button any more.
      // Provenance: the real DOM of VS Code, the same `.action-label` read as C1.
      const chatBar = await launcher();
      check(
        chatBar.actions.includes('Open Settings…') &&
          !chatBar.actions.some((label) => label.startsWith('Restart Server')),
        `C10 the side bar Chat view shows the Open Settings… title button and no Restart Server button (${JSON.stringify(chatBar.actions)})`,
      );
      const inSidebar = await view();
      setLocation('editor');
      const opened = await waitFor(async () => (await chatTabs()).length >= 1, 15_000, 200);
      await connectToNew(drivenChatId);
      await waitFor(async () => (await view()).title === TITLE_A, 15_000, 200);
      const inTab = await view();
      const afterSwitch = await tabsNow();
      const sampleTab = afterSwitch.find((tab) => !isChatTab(tab));
      const tabA = afterSwitch.find(isChatTab);
      const idA = drivenChatId;
      check(
        opened === true &&
          afterSwitch.filter(isChatTab).length === 1 &&
          inTab.title === TITLE_A &&
          inTab.title === inSidebar.title &&
          inTab.messages === inSidebar.messages &&
          (await launcher()).chatFrames === 0 &&
          sampleTab !== undefined &&
          tabA !== undefined &&
          sampleTab.group !== tabA.group,
        `C10 sidebar -> editor opens ONE tab with the side bar session beside the code, and the side bar has no chat (title ${JSON.stringify(inTab.title)}, ${String(inTab.messages)} of ${String(inSidebar.messages)} blocks, groups ${String(sampleTab?.group)}/${String(tabA?.group)})`,
      );

      // --- C1: the Sessions view in the side bar (issue #77 E3: a native tree, not a launcher) ---
      // With sessions in the folder the view lists them and shows NO welcome text; the welcome of
      // each empty state (no sessions, offline) is judged in step 29, cells V4 and V5.
      await waitFor(
        async () => (await launcher()).rows.some((row) => row.includes(TITLE_A)),
        8_000,
        200,
      );
      await shot('27a-launcher');
      const bar = await launcher();
      check(
        bar.text === '' &&
          bar.rows.some((row) => row.includes(TITLE_A)) &&
          bar.actions.some((label) => label.startsWith('New Session')) &&
          bar.actions.some((label) => label.startsWith('Search Sessions')) &&
          bar.actions.includes('Open Settings…') &&
          bar.chatFrames === 0,
        `C1 the Sessions view lists the session of the tab with no welcome text, shows the New Session, Search Sessions and Open Settings… title buttons, and holds no chat (${JSON.stringify(bar)})`,
      );

      // --- C2 + C3: the tab beside the code, in the four themes ---------------------------------
      const mediaWidth = (await chatFrameBox())?.width ?? 0;
      console.log(`  chat tab ${String(Math.round(mediaWidth))} px wide beside the code`);
      for (const [name, theme] of PROBLEM_THEMES) {
        await setTheme(theme);
        const state = await view();
        const look = await web.inDoc(measureText, {
          title: '.chat-title',
          box: 'textarea.prompt-text',
        });
        const textRatio = Math.min(look.title?.ratio ?? 0, look.box?.ratio ?? 0);
        check(
          state.title === TITLE_A && state.kind === THEME_KINDS[theme].webview && textRatio >= 4.5,
          `C2 ${name}, tab beside the code (${String(Math.round(mediaWidth))} px): the chat renders with kind ${state.kind} and text contrast ${textRatio.toFixed(2)} >= 4.5`,
        );
        assertNoWebviewErrors(`C2 ${name} tab`);
        await shot(`27b-tab-${name}`);
        const tab = await tabLook('Tab27A');
        const file = /chat-tab-(light|dark)\.svg/.exec(tab?.icon ?? '')?.[1];
        const wanted = name === 'light' || name === 'hc-light' ? 'light' : 'dark';
        const stroke =
          file === undefined
            ? undefined
            : /stroke="(#[0-9A-Fa-f]{6})"/.exec(
                fs.readFileSync(path.join(repoRoot, 'media', `chat-tab-${file}.svg`), 'utf8'),
              )?.[1];
        const iconRgb =
          stroke === undefined
            ? []
            : [1, 3, 5].map((index) => Number.parseInt(stroke.slice(index, index + 2), 16));
        const tabRgb = tab?.background ? rgbOf(tab.background) : [];
        const iconRatio =
          iconRgb.length === 3 && tabRgb.length === 3 ? ratioOf(iconRgb, tabRgb) : 0;
        check(
          tab !== null && tab.label === TITLE_A && file === wanted && iconRatio >= 3,
          `C3 ${name}: the tab reads ${JSON.stringify(tab?.label)}, its icon is chat-tab-${String(file)}.svg (wanted ${wanted}) and its stroke ${String(stroke)} has contrast ${iconRatio.toFixed(2)} >= 3 against the tab background ${String(tab?.background)}`,
        );
      }
      await setTheme(DARK);

      // --- C6 (palette): a new tab with the caret in its prompt ----------------------------------
      const newTabCheck = async (label, trigger) => {
        const before = (await chatTabs()).length;
        const previous = drivenChatId;
        await trigger();
        await waitFor(async () => (await chatTabs()).length === before + 1, 10_000, 200);
        await connectToNew(previous);
        const focused = await waitFor(async () => (await view()).focusOnBox, 6_000, 200);
        const now = await chatTabs();
        const state = await view();
        check(
          now.length === before + 1 && focused === true && state.messages === 0,
          `C6 ${label} opens a new empty tab with the caret in its prompt (${String(before)} -> ${String(now.length)} tabs, ${String(state.messages)} blocks, focus ${String(focused)})`,
        );
        return now.length;
      };
      await newTabCheck('New Session from the palette', () => command('OpenCode: New Session'));
      const idB = drivenChatId;
      const groupsOfChat = new Set((await chatTabs()).map((tab) => tab.group));
      check(
        groupsOfChat.size === 1,
        `C6 the new tab is in the group of the first one (${JSON.stringify([...groupsOfChat])})`,
      );

      // --- C4: a LONG turn ends in A while B is on screen -----------------------------------------
      await switchTo('Tab27A');
      const finishedBefore = logCount(/turn finished/g);
      await send(`${titleOf(PROMPT_A)} Count from 1 to 400, one number per line. LONG`);
      const running = (await waitFor(isBusy, 15_000, 200)) === true;
      if (!running) {
        console.log(`  C4 A after the prompt: ${JSON.stringify(await view())}`);
        await shot('27z-debug-c4');
      }
      check(running, 'C4 the LONG turn is running in A');
      await switchTo('Untitled session');
      check(
        drivenChatId === idB,
        'C4 B is on screen while the LONG turn of A runs (its webview is hidden)',
      );
      await waitFor(() => logCount(/turn finished/g) > finishedBefore, 60_000, 500);
      await switchTo('Tab27A');
      await waitFor(async () => /\b400\b/.test((await view()).lastAssistant), 10_000, 200);
      const longState = await view();
      const numbers = longState.lastAssistant.match(/\d+/g)?.map(Number) ?? [];
      check(
        numbers.length === 400 &&
          numbers.every((value, index) => value === index + 1) &&
          longState.with400 === 1,
        `C4 coming back to A shows the whole reply once: ${String(numbers.length)} numbers, from ${String(numbers[0])} to ${String(numbers.at(-1))}, in order, no repeats (${String(longState.with400)} assistant block with the 400)`,
      );
      check(!(await isBusy()), 'C4 and A is no longer marked as running');
      assertNoWebviewErrors('C4 tab return');
      await shot('27c-tab-return');

      // --- C5: the tree opens A's session while B is on screen; A is revealed, no tab is added ----
      // (the picker of a tab is gone since issue #77 E3: the Sessions view is the one place)
      await switchTo('Untitled session');
      const countBeforeOpen = (await chatTabs()).length;
      const pickerInTab = await web.inDoc(
        (doc) => doc.querySelector('[data-session-trigger]') !== null,
      );
      await showOpenCodeBar();
      const rowOfA = page.locator('.part.sidebar .monaco-list-row', { hasText: TITLE_A }).first();
      await rowOfA.click({ timeout: 10_000 });
      const revealed = await waitFor(async () => (await visibleChatId()) === idA, 8_000, 150);
      await openChat(30_000);
      check(
        revealed === true && (await chatTabs()).length === countBeforeOpen && !pickerInTab,
        `C5 clicking A's row in the Sessions view reveals A and adds no tab (${String(countBeforeOpen)} -> ${String((await chatTabs()).length)} tabs; the tab has no Sessions button: ${String(!pickerInTab)})`,
      );

      // --- C6 (launcher title button, Ctrl+Alt+N) ---------------------------------------------------
      await showOpenCodeBar();
      await newTabCheck('New Session from the title button of the launcher', async () => {
        await page
          .locator('.part.sidebar .action-label[aria-label^="New Session"]')
          .first()
          .click();
      });
      await newTabCheck('Ctrl+Alt+N inside a tab', async () => {
        await focusPromptBox();
        await page.keyboard.press('ControlOrMeta+Alt+n');
      });

      // --- C7 + C8 (file link): Insert at cursor, the link of the reply, Add selection --------------
      await switchTo('Tab27A');
      await send(
        'Reply with: a short TypeScript function in a ts code block and the inline code path `src/sample.ts:20`. Do not use any tools. MARKDOWN',
      );
      check(await waitIdle(30_000), 'C7 the MARKDOWN turn of A ends');
      await focusSampleEditor();
      await page.keyboard.press('ControlOrMeta+Home');
      await switchTo('Tab27A');
      check(
        await clickIn('button[aria-label="Insert code at cursor"]'),
        'C7 Insert code at cursor is pressed in the tab',
      );
      const firstLine = () =>
        page.evaluate(() => {
          const lines = [...globalThis.document.querySelectorAll('.monaco-editor .view-line')]
            .map((line) => ({
              top: line.getBoundingClientRect().top,
              text: line.textContent ?? '',
            }))
            .filter((line) => line.top > 0)
            .sort((x, y) => x.top - y.top);
          return (lines[0]?.text ?? '').replace(/\xa0/g, ' ');
        });
      const inserted = await waitFor(
        async () => (await firstLine()).startsWith('export function greet(name: string): string {'),
        5_000,
        150,
      );
      check(
        inserted === true,
        `C7 Insert at cursor from the tab wrote into src/sample.ts, the last text editor (first line ${JSON.stringify(await firstLine())})`,
      );
      await shot('27d-insert');
      await focusSampleEditor();
      await command('File: Revert File');
      await focusSampleEditor();
      await selectLines2to3();
      await switchTo('Tab27A');
      check(await clickButton('Add context'), 'C7 the "+" button is pressed in the tab');
      await waitPresent('[role="menu"]');
      check(await clickButton('Add selection'), 'C7 Add selection is pressed in the "+" menu');
      const ranged = await waitFor(
        async () => (await view()).chips.includes('src/sample.ts#2-3'),
        10_000,
        250,
      );
      check(
        ranged === true,
        `C7 Add selection from the tab adds the chip src/sample.ts#2-3 (${JSON.stringify((await view()).chips)})`,
      );
      await removeChips();
      const chatGroups = new Set((await chatTabs()).map((tab) => tab.group));
      check(
        await clickIn('.file-ref[data-path="src/sample.ts"][data-line="20"]'),
        'C8 the file link is pressed in the tab',
      );
      await waitFor(
        async () =>
          /Ln 20\b/.test(
            await page.locator('#status\\.editor\\.selection').first().innerText({ timeout: 500 }),
          ),
        4_000,
        100,
      );
      const afterLink = await tabsNow();
      const linked = afterLink.find((tab) => tab.active && !isChatTab(tab));
      check(
        /Ln 20\b/.test(await editorSelection()) &&
          linked !== undefined &&
          !chatGroups.has(linked.group) &&
          afterLink.filter((tab) => !isChatTab(tab) && chatGroups.has(tab.group)).length === 0,
        `C8 a file link from the tab opens src/sample.ts at line 20 outside the chat's group (status "${(await editorSelection()).trim()}", groups of the tabs ${JSON.stringify([...chatGroups])}, link in ${String(linked?.group)})`,
      );

      // --- C9: Explain with every chat tab hidden goes to the most recent tab -----------------------
      await switchTo('Tab27A');
      const recentId = drivenChatId;
      // Another file than `sample.ts`, which is open in the first group: with two editors on one
      // document `editorForMenu` takes the first visible one, whose selection is another (seen in
      // a first run of this step: "Explain what @src/sample.ts does." with no range).
      await quickOpen('src/other27.ts', 'other27.ts');
      await selectLines2to3();
      const hiddenAll = (await visibleChatId()) === undefined;
      const tabsBeforeExplain = (await chatTabs()).length;
      const aim = await page
        .locator('.editor-group-container.active .monaco-editor .view-lines .view-line')
        .filter({ hasText: 'o27b' })
        .first()
        .boundingBox({ timeout: 3_000 })
        .catch(() => null);
      check(
        aim !== null && hiddenAll,
        `C9 no chat tab is on screen and the editor shows line 2 (hidden: ${String(hiddenAll)})`,
      );
      await page.mouse.click(aim.x + 40, aim.y + aim.height / 2, { button: 'right' });
      await waitFor(async () => (await menuRows()).length > 0, 3_000, 100);
      const entry = page.locator('.monaco-menu').getByText(EXPLAIN, { exact: true });
      for (let attempt = 0; attempt < 3 && (await entry.count()) > 0; attempt += 1) {
        await entry.first().click();
        await waitFor(async () => (await entry.count()) === 0, 1_000, 100);
      }
      const shown = await waitFor(async () => (await visibleChatId()) !== undefined, 10_000, 200);
      await openChat(30_000);
      await waitFor(
        async () => (await view()).users.at(-1) === 'Explain what @src/other27.ts#2-3 does.',
        20_000,
        200,
      );
      check(
        shown !== undefined &&
          drivenChatId === recentId &&
          (await chatTabs()).length === tabsBeforeExplain &&
          (await view()).users.at(-1) === 'Explain what @src/other27.ts#2-3 does.',
        `C9 Explain with every tab hidden reveals the most recent tab and sends there (${JSON.stringify((await view()).users.at(-1))}, tabs ${String(tabsBeforeExplain)} -> ${String((await chatTabs()).length)}, same tab ${String(drivenChatId === recentId)})`,
      );
      check(await waitIdle(60_000), 'C9 the turn of the Explain prompt ends');

      // --- C11: a request with no chat on screen; the toast opens the tab of its session --------------
      await clearBox();
      await removeChips();
      await send(`${titleOf(PROMPT_A)} Read .env. ASK_PERMISSION`);
      await waitFor(isBusy, 5_000, 100);
      // The tab of `other27.ts` (C9) shares the chat group: pressing it hides every chat at once,
      // as the title bar button does in step 5. A quick open took seconds, and the request had
      // already arrived while the tab was still on screen (no toast then).
      await page.locator('.tab', { hasText: 'other27.ts' }).first().click();
      const hidden = (await visibleChatId()) === undefined;
      const toast = await waitFor(async () => {
        const toasts = page.locator('.notifications-toasts .notification-toast');
        return (await toasts.count())
          ? (await toasts.first().innerText()).replace(/\n/g, ' | ')
          : null;
      }, 30_000);
      const badge = page.locator(
        '.activitybar .action-item:has([aria-label^="OpenCode"]) .badge-content',
      );
      const badgeText =
        (await waitFor(
          async () => (await badge.allInnerTexts().catch(() => [])).join(','),
          5_000,
          100,
        )) ?? '';
      check(
        hidden &&
          toast !== undefined &&
          toast !== null &&
          /Permission requested/.test(toast) &&
          badgeText !== '',
        `C11 with every chat tab hidden a request raises a native notification ("${String(toast).slice(0, 80)}") and the badge of the Sessions view shows on the OpenCode icon ("${badgeText}")`,
      );
      await shot('27e-request-hidden');
      const open = page
        .locator('.notifications-toasts .notification-toast a', { hasText: /open/i })
        .first();
      if (await open.count()) await open.click();
      const back = await waitFor(async () => (await visibleChatId()) === idA, 10_000, 200);
      await openChat(30_000);
      const card = await waitFor(
        () => web.inDoc((doc) => doc.querySelector('.permission-card') !== null),
        15_000,
        200,
      );
      check(
        back === true && card === true,
        `C11 "Open chat" of the notification reveals the tab of the session and its permission card is there (tab ${String(back)}, card ${String(card)})`,
      );
      check(await clickButton('Allow once'), 'C11 Allow once is pressed (never Always)');
      check(await waitIdle(30_000), 'C11 the turn ends after Allow once');

      // --- C8 (diff): "Changed files" opens its diff outside the chat's group -----------------------
      await send(`${titleOf(PROMPT_A)} EDIT_FILES: change a few files`);
      check(await waitIdle(30_000), 'C8 the edit turn ends');
      await waitPresent('details.changed-files');
      await clickIn('details.changed-files > summary');
      await waitPresent('details.changed-files[open]');
      const chatGroupsNow = new Set((await chatTabs()).map((tab) => tab.group));
      check(
        await clickIn('details.changed-files button.changed-file[aria-label*="src/sample.ts"]'),
        'C8 the row of src/sample.ts is pressed in "Changed files"',
      );
      const diffTab = await waitFor(
        async () =>
          (await tabsNow()).find((tab) => tab.active && /OpenCode session/.test(tab.label)),
        8_000,
        150,
      );
      check(
        diffTab !== undefined && !chatGroupsNow.has(diffTab.group),
        `C8 the diff of "Changed files" opens outside the chat's group (diff in group ${String(diffTab?.group)}, chat tabs in ${JSON.stringify([...chatGroupsNow])})`,
      );
      await shot('27f-diff');

      // --- C2 (full width): the same tab alone in its editor area ----------------------------------
      await closeSampleTabs();
      await waitFor(async () => (await groupCount()) === 1, 4_000, 150);
      const fullWidth = (await chatFrameBox())?.width ?? 0;
      await setTheme(DARK);
      const fullState = await view();
      const fullLook = await web.inDoc(measureText, {
        title: '.chat-title',
        box: 'textarea.prompt-text',
      });
      const fullRatio = Math.min(fullLook.title?.ratio ?? 0, fullLook.box?.ratio ?? 0);
      check(
        (await groupCount()) === 1 &&
          fullWidth > mediaWidth * 1.5 &&
          fullState.kind === THEME_KINDS[DARK].webview &&
          fullRatio >= 4.5,
        `C2 dark, tab alone in the editor area (${String(Math.round(fullWidth))} px against ${String(Math.round(mediaWidth))} px beside the code): the chat renders with kind ${fullState.kind} and text contrast ${fullRatio.toFixed(2)} >= 4.5`,
      );
      assertNoWebviewErrors('C2 full width tab');
      await shot('27g-tab-full');

      // --- C10 (editor to sidebar): the tabs stay and the side bar chat works -------------------------
      const tabsBeforeBack = (await chatTabs()).map((tab) => tab.text);
      setLocation('sidebar');
      // The launcher goes and the chat view takes its place in the same container; if the side bar
      // is not showing it (hidden, another container), the activity bar item brings it back.
      await waitFor(async () => (await launcher()).rows.length === 0, 8_000, 200);
      let sidebarId = await waitFor(() => sidebarChatId(), 8_000, 200);
      if (sidebarId === undefined) {
        await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
        sidebarId = await waitFor(() => sidebarChatId(), 15_000, 200);
      }
      await openChat(30_000, sidebarId);
      await waitFor(() => web.inDoc((doc) => doc.querySelector('textarea') !== null), 15_000, 200);
      await send(PROMPT_B.replace('Tab27B', 'Tab27S'));
      const answered = await waitIdle(30_000);
      const sideState = await view();
      const tabsAfterBack = (await chatTabs()).map((tab) => tab.text);
      check(
        sidebarId !== undefined &&
          drivenChatId === sidebarId &&
          answered &&
          (sideState.users.at(-1) ?? '').includes('Tab27S') &&
          sideState.lastAssistant.trim() !== '' &&
          tabsAfterBack.length === tabsBeforeBack.length &&
          tabsAfterBack.length >= 2,
        `C10 editor -> sidebar leaves the ${String(tabsAfterBack.length)} tabs open (${JSON.stringify(tabsBeforeBack)} -> ${JSON.stringify(tabsAfterBack)}) and the side bar chat answers (prompt ${JSON.stringify(sideState.users.at(-1))}, reply ${JSON.stringify(sideState.lastAssistant)}, idle ${String(answered)}, view ${String(sidebarId)})`,
      );
      await shot('27h-back-to-sidebar');
      await openChat(30_000, idA);
      const usersBefore = (await view()).users.length;
      await send(`${titleOf(PROMPT_A)} Reply with exactly: again27. Do not use any tools.`);
      const tabAnswered = await waitIdle(30_000);
      const tabState = await view();
      check(
        tabState.title === TITLE_A &&
          tabAnswered &&
          tabState.users.length === usersBefore + 1 &&
          (tabState.users.at(-1) ?? '').includes('again27') &&
          tabState.lastAssistant.trim() !== '',
        `C10 and a tab left open still works after the switch (title ${JSON.stringify(tabState.title)}, prompt ${JSON.stringify(tabState.users.at(-1))} answered ${JSON.stringify(tabState.lastAssistant)})`,
      );
    } finally {
      // Leave the workspace as the step found it: no chat tab or file tab, the setting back to
      // `sidebar`, `sample.ts` as it was (C8 edits it) and the files EDIT_FILES creates removed.
      setLocation('sidebar');
      await closeAllEditors().catch(() => undefined);
      fs.writeFileSync(sampleFile, sampleBefore);
      for (const file of [
        path.join(srcDir, 'removed.ts'),
        path.join(srcDir, 'other27.ts'),
        path.join(srcDir, 'added.ts'),
        path.join(workspace, 'assets', 'logo.png'),
      ]) {
        fs.rmSync(file, { force: true });
      }
    }
  });

  // Step 28 (issue #77, delivery E2, plan E9-chat-tabs-restore section 9): the chat tabs after a
  // REAL Reload Window, judged in the DOM of the workbench and of each tab's webview. Cells: R1 the
  // labels of the four tabs right after the reload (same text, same count); R2 the active tab A is
  // back with its title, its conversation, its draft, the dark theme and no webview error; R3 the
  // background tab B is not deserialized until it is opened (the iframe count is printed as data)
  // and then shows title and conversation; R4 the lazy tab C comes back empty with its draft; R5
  // the tab D, whose session was deleted while D was hidden, shows the notice with its exact text,
  // "Untitled session" and the draft it had; R6 Focus Prompt puts the caret in A's prompt and New Session opens in
  // the chat's group; R7 a prompt typed in the restored B is answered; R8 in `sidebar` mode a
  // second Reload brings A back and answering, and the side bar view does not show A's session; R9
  // the notice of R5 reads with contrast >= 4.5 in the four themes; R10 the second Reload keeps
  // the number of tabs. Also measured: the log lines of the serializer, `retainContextWhenHidden`
  // of a revived panel (a mark set in A's document survives hiding A) and T7 (R1 counts the tabs
  // after a Reload with `detachAll`).
  // T7 MUTATION (29/10/2026, run once, `--steps 28`): with `ChatPanels.detachAll` replaced by a
  // loop that closes every panel (`panel.dispose()`), R1 STILL passed with the same four tabs and
  // the step ended "all visual checks passed". So R1 does not tell `detachAll` from closing the
  // panels in `deactivate`: in this Reload Window harness both keep the tabs. HYPOTHESIS that
  // closing would lose them on a plain window close; this step does not exercise that.
  // VERIFIED by a full `npm run test:visual` on the final tree (Windows 11, VS Code 1.144.0,
  // 30/10/2026, 0 FAIL, "all visual checks passed"), which printed: "ok   R1 right after Reload
  // Window the 4 chat tabs read as before", "ok   R2 A comes back active: title "Tab28A: Reply with
  // exactly: alpha28. Do", 4 blocks, draft "draft28-A", kind vscode-dark" (the `DELETE_TITLED` turn
  // adds blocks to A; D is deleted by that fixture trigger, not by a picker), "ok   R5 D says
  // ["This session no longer exists. Your next prompt starts a new one."] with title "Untitled
  // session", 0 blocks and draft "draft28-D"", "ok   the serializer restored 4 tabs (log lines
  // "chat tab restored (pane N)"), none skipped", "ok   R9 the notice of D has contrast 7.56 >= 4.5
  // in dark (tab 541 px)" (9.14 light, 21.00 hc-dark, 14.55 hc-light), "ok   R7 the restored B
  // answers", "ok   a revived panel keeps its document while hidden (the mark set in A before it
  // was hidden: true, same webview true)", "ok   R10 after the second Reload Window the workbench
  // has 5 chat tabs (5 before it)" and "ok   R8 the side bar view resolved to another session, not
  // A's".
  // The data line "R3 chat iframes in the workbench before
  // any background tab is opened: 1" shows the lazy deserialization. Found by it and not by any
  // unit test: the toast "All installed extensions are temporarily disabled" shows up seconds
  // after a Reload and covers the prompt box (hence `clearToasts`). NOT measured: macOS, Linux,
  // a restored tab and the side bar view holding the SAME session (the side bar had its own, so
  // the dedupe of Q3 after a real Reload is covered only by the integration tests), a tab hidden
  // from the moment it was bound (R2 of the plan), more than one group of chat tabs.
  await step('28 chat tabs come back after Reload Window (issue #77, E2)', async () => {
    const DARK = 'Default Dark Modern';
    const GONE = 'This session no longer exists. Your next prompt starts a new one.';
    const titleOf = (prompt) => prompt.slice(0, 40).trim(); // the fixture titles a session so
    const PROMPT_A = 'Tab28A: Reply with exactly: alpha28. Do not use any tools.';
    const PROMPT_B = 'Tab28B: Reply with exactly: beta28. Do not use any tools.';
    const PROMPT_D = 'Tab28D: Reply with exactly: delta28. Do not use any tools.';
    const PROMPT_L = 'Tab28L: Reply with exactly: lateral28. Do not use any tools.';
    const [TITLE_A, TITLE_B, , TITLE_L] = [PROMPT_A, PROMPT_B, PROMPT_D, PROMPT_L].map(titleOf);
    const sampleFile = path.join(workspace, 'src', 'sample.ts');
    const sampleBefore = fs.readFileSync(sampleFile, 'utf8');
    const setLocation = (value) => {
      writeSettings(vscode.userDataDir, { 'openVsCode.chatLocation': value });
    };
    const tabsNow = () =>
      page.evaluate(() => {
        const groups = [...globalThis.document.querySelectorAll('.editor-group-container')];
        return [...globalThis.document.querySelectorAll('.tab')].map((tab) => ({
          label: tab.getAttribute('aria-label') ?? '',
          text: (tab.innerText ?? '').trim(),
          active: tab.classList.contains('active'),
          group: groups.indexOf(tab.closest('.editor-group-container')),
        }));
      });
    // A chat tab is any tab that is not a TypeScript file (no title of this step has ".ts").
    const isChatTab = (tab) => !/\.ts\b/.test(`${tab.label} ${tab.text}`);
    const chatTabs = async () => (await tabsNow()).filter(isChatTab);
    const hostLog = () => {
      const files = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name === 'OpenCode.log') files.push(full);
        }
      };
      try {
        walk(path.join(vscode.userDataDir, 'logs'));
      } catch {
        return '';
      }
      return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    };
    const logCount = (pattern) => (hostLog().match(pattern) ?? []).length;
    const view = () =>
      web.inDoc((doc) => {
        const field = doc.querySelector('textarea.prompt-text');
        return {
          title: doc.querySelector('.chat-title')?.textContent ?? '',
          messages: doc.querySelectorAll('[role="log"] > *').length,
          value: field?.value ?? '',
          focusOnBox: field !== null && doc.activeElement === field && doc.hasFocus(),
          users: [...doc.querySelectorAll('[role="log"] .message-user .part-text')].map((m) =>
            (m.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ),
          assistants: doc.querySelectorAll('[role="log"] .message-assistant').length,
          lastAssistant:
            [...doc.querySelectorAll('[role="log"] .message-assistant .markdown')].at(-1)
              ?.innerText ?? '',
          notices: [...doc.querySelectorAll('.status-bar .alert .alert-text')].map((n) =>
            (n.textContent ?? '').trim(),
          ),
          kind: doc.body.getAttribute('data-vscode-theme-kind') ?? '',
        };
      });
    // Waits for a chat other than `previous` to be on screen and connects to it.
    const connectToNew = async (previous) => {
      await waitFor(
        async () => {
          const id = await visibleChatId();
          return id !== undefined && id !== previous ? id : undefined;
        },
        10_000,
        100,
      );
      await openChat(30_000);
    };
    // Presses the chat tab at `position` among the chat tabs, in the order the strip shows them.
    const clickChatTab = async (position) => {
      const previous = drivenChatId;
      const all = await tabsNow();
      const indexes = all.flatMap((tab, index) => (isChatTab(tab) ? [index] : []));
      await page.locator('.tab').nth(indexes[position]).click();
      await connectToNew(previous);
    };
    const clickTabNamed = async (needle) => {
      const previous = drivenChatId;
      await page.locator('.tab', { hasText: needle }).first().click();
      await connectToNew(previous);
    };
    const editorHasFocus = () =>
      page.evaluate(() => globalThis.document.activeElement?.closest('.monaco-editor') != null);
    const quickOpen = async (spec, tabName) => {
      await page.keyboard.press('ControlOrMeta+p');
      await waitFor(async () => !(await quickInputHidden()), 2_000, 50);
      await page.keyboard.type(spec);
      await waitFor(
        () =>
          page.evaluate(
            (name) =>
              (
                globalThis.document.querySelector('.quick-input-list .monaco-list-row.focused')
                  ?.textContent ?? ''
              ).includes(name),
            tabName,
          ),
        3_000,
        50,
      );
      await page.keyboard.press('Enter');
      await waitFor(
        async () => (await page.locator(`.tab.active[aria-label*="${tabName}"]`).count()) > 0,
        5_000,
        100,
      );
      await waitFor(editorHasFocus, 3_000, 100);
    };
    // The chat in the side bar view, and the ones in editor tabs, by the box each iframe sits in.
    const chatIds = () =>
      page.evaluate((selector) => {
        const sideBox = globalThis.document.querySelector('.part.sidebar')?.getBoundingClientRect();
        const shown = [...globalThis.document.querySelectorAll(selector)].filter(
          (frame) =>
            frame.checkVisibility({ checkVisibilityCSS: true }) &&
            frame.getBoundingClientRect().width > 0,
        );
        const inSide = (frame) => {
          const box = frame.getBoundingClientRect();
          const x = box.left + box.width / 2;
          return sideBox !== undefined && x >= sideBox.left && x <= sideBox.right;
        };
        return {
          side: shown.find(inSide)?.name,
          tabs: shown.filter((frame) => !inSide(frame)).map((frame) => frame.name),
        };
      }, CHAT_FRAME);
    // Reload Window with a mark on the OLD page: the first page without it is the new workbench.
    const reloadWindow = async (mark) => {
      await page.evaluate((key) => {
        globalThis[key] = true;
      }, mark);
      await command('Developer: Reload Window');
      web?.close();
      await browser.close().catch(() => undefined);
      let reloaded = false;
      for (let tries = 0; tries < 120 && !reloaded; tries++) {
        await connectWorkbench(90_000);
        const stale = await page
          .evaluate((key) => globalThis[key] === true, mark)
          .catch(() => true);
        reloaded = !stale;
        if (reloaded) break;
        await browser.close().catch(() => undefined);
        await sleep(250); // between two attempts to reach the new page, not a wait for it
      }
      if (!reloaded) throw new Error('Reload Window did not produce a new workbench page');
      await waitFor(async () => (await page.locator('.monaco-workbench').count()) > 0, 30_000, 300);
      drivenChatId = undefined;
    };
    // The toast "All installed extensions are temporarily disabled" shows up some seconds AFTER a
    // Reload (seen in the second run of this step: it appeared after a clear made right away), so
    // the clear waits up to 8 s for ANY toast (it returns as soon as one exists, not only that one;
    // without a toast the wait just expires) and prints the text of every toast it finds before
    // clearing, so an error toast of the extension after a Reload is not wiped without a trace.
    const clearToasts = async () => {
      await waitFor(
        () => page.locator('.notifications-toasts .notification-toast').count(),
        8_000,
        200,
      );
      const texts = await page
        .locator('.notifications-toasts .notification-toast')
        .allInnerTexts()
        .catch(() => []);
      for (const text of texts) console.log(`  toast cleared: ${text.replace(/\s+/g, ' ').trim()}`);
      await command('Notifications: Clear All Notifications');
    };
    const typeDraft = async (text) => {
      await focusPromptBox();
      await page.keyboard.type(text);
      await waitFor(async () => (await view()).value === text, 5_000, 100);
    };
    const newSessionTab = async () => {
      const previous = drivenChatId;
      const before = (await chatTabs()).length;
      await command('OpenCode: New Session');
      await waitFor(async () => (await chatTabs()).length === before + 1, 10_000, 200);
      await connectToNew(previous);
    };

    // Step 27 leaves `web` on a tab it closed (the full run) or on the side bar chat (a filtered
    // run): connect to the side bar chat before the first read, as the full run failed on it once.
    // A second press on the activity bar item would hide a side bar that is already showing it, so
    // it is pressed only when no chat shows up within 8 s.
    setLocation('sidebar');
    if (
      (await waitFor(async () => (await visibleChatId()) !== undefined, 8_000, 200)) === undefined
    ) {
      await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
      await waitFor(async () => (await visibleChatId()) !== undefined, 10_000, 200);
    }
    await openChat(30_000);
    check(await waitIdle(60_000), 'no turn is running when the step starts');
    await closeAllEditors();
    try {
      await setTheme(DARK);
      await command('Notifications: Clear All Notifications');
      await quickOpen('src/sample.ts', 'sample.ts');

      // --- Montage: B (answered), C (lazy, draft), D (answered), A (answered, draft, active) ----------
      await waitConnected();
      check(await clickButton('New session'), 'the New session button is pressed in the side bar');
      await waitEmptyView();
      await send(PROMPT_B);
      check(await waitIdle(30_000), 'the turn of B ends');
      setLocation('editor');
      await waitFor(async () => (await chatTabs()).length >= 1, 15_000, 200);
      await connectToNew(drivenChatId);
      await waitFor(async () => (await view()).title === TITLE_B, 15_000, 200);
      await newSessionTab(); // C
      await typeDraft('draft28-C');
      await newSessionTab(); // D
      await send(PROMPT_D);
      check(await waitIdle(30_000), 'the turn of D ends');
      await typeDraft('draft28-D'); // D keeps it although its session is deleted later (R5)
      await newSessionTab(); // A
      await send(PROMPT_A);
      check(await waitIdle(30_000), 'the turn of A ends');
      // D's session is deleted by "another client" while D is hidden: D's document keeps believing
      // it. A's picker used to do it (the real modal); a tab has no picker since issue #77 E3, and
      // deleting from the Sessions view would close D's tab (P8) instead. The fixture trigger
      // `DELETE_TITLED:<needle>` deletes the sessions whose title has the needle.
      await send(`DELETE_TITLED:Tab28D Reply with exactly: gone28. Do not use any tools.`);
      check(await waitIdle(30_000), "the turn that deletes D's session from outside ends");
      await typeDraft('draft28-A');
      await sleep(1_000); // the workbench gets the webview's state through a message; no signal
      const before = await chatTabs();
      const beforeTexts = before.map((tab) => tab.text);
      check(
        before.length === 4 && before.at(-1)?.active === true,
        `the montage has four chat tabs with A active (${JSON.stringify(before.map((t) => [t.text, t.active, t.group]))})`,
      );
      assertNoWebviewErrors('step 28 montage');
      await shot('28a-before-reload');

      // --- Reload Window #1 (editor mode) -------------------------------------------------------
      await reloadWindow('__visualPreReload28a');

      // R1: the labels, before anything is touched.
      const back = await waitFor(
        async () => {
          const tabs = await chatTabs();
          return tabs.length === before.length ? tabs : undefined;
        },
        20_000,
        250,
      );
      const backTexts = (back ?? (await chatTabs())).map((tab) => tab.text);
      check(
        back !== undefined && JSON.stringify(backTexts) === JSON.stringify(beforeTexts),
        `R1 right after Reload Window the ${String(backTexts.length)} chat tabs read as before (${JSON.stringify(beforeTexts)} -> ${JSON.stringify(backTexts)})`,
      );

      // R2: A, the active tab, is deserialized at once.
      const seen = await waitFor(async () => (await visibleChatId()) !== undefined, 60_000, 250);
      await openChat(40_000);
      await waitFor(
        async () => {
          const state = await view();
          return state.title === TITLE_A && state.messages >= 2;
        },
        30_000,
        250,
      );
      const restoredA = await view();
      check(
        seen === true &&
          restoredA.title === TITLE_A &&
          restoredA.messages >= 2 &&
          restoredA.value === 'draft28-A' &&
          restoredA.kind === 'vscode-dark',
        `R2 A comes back active: title ${JSON.stringify(restoredA.title)}, ${String(restoredA.messages)} blocks, draft ${JSON.stringify(restoredA.value)}, kind ${restoredA.kind}`,
      );
      assertNoWebviewErrors('R2 A restored');
      await shot('28b-restored-A');
      const idA = drivenChatId;
      await web.inDoc(() => {
        globalThis.__retained28 = true;
      });

      // R3 (data): the background tabs are not deserialized yet.
      const framesBeforeOpening = await page.locator(CHAT_FRAME).count();
      console.log(
        `  R3 chat iframes in the workbench before any background tab is opened: ${String(framesBeforeOpening)}`,
      );

      // R6 (Focus Prompt): from the editor, the command puts the caret in A's prompt.
      await page.locator('.tab', { hasText: 'sample.ts' }).first().click();
      await page.locator('.monaco-editor:visible .view-lines').first().click();
      const focusStart = await waitFor(editorHasFocus, 3_000, 100);
      await command('OpenCode: Focus Prompt');
      const focused = await waitFor(async () => (await view()).focusOnBox, 6_000, 200);
      check(
        focusStart === true && focused === true && (await visibleChatId()) === idA,
        `R6 Focus Prompt from the editor puts the caret in the prompt of A, the active tab before the reload (editor had the focus ${String(focusStart)}, caret ${String(focused)})`,
      );

      // R3 (opening): B, a background tab, is deserialized when it is opened.
      await clickChatTab(0);
      await waitFor(async () => (await view()).messages >= 2, 15_000, 250);
      const restoredB = await view();
      check(
        restoredB.title === TITLE_B && restoredB.messages >= 2,
        `R3 B, restored when opened (${String(framesBeforeOpening)} chat iframe before): title ${JSON.stringify(restoredB.title)}, ${String(restoredB.messages)} blocks`,
      );
      assertNoWebviewErrors('R3 B restored');

      // R4: C, the lazy tab.
      await clickChatTab(1);
      await waitFor(async () => (await view()).value === 'draft28-C', 15_000, 250);
      const restoredC = await view();
      check(
        restoredC.title === 'Untitled session' &&
          restoredC.messages === 0 &&
          restoredC.value === 'draft28-C',
        `R4 C comes back lazy: title ${JSON.stringify(restoredC.title)}, ${String(restoredC.messages)} blocks, draft ${JSON.stringify(restoredC.value)}`,
      );
      assertNoWebviewErrors('R4 C restored');

      // R5: D, whose session no longer exists.
      await clickChatTab(2);
      await waitFor(async () => (await view()).notices.includes(GONE), 15_000, 250);
      const restoredD = await view();
      check(
        restoredD.notices.includes(GONE) &&
          restoredD.title === 'Untitled session' &&
          restoredD.messages === 0 &&
          restoredD.value === 'draft28-D',
        `R5 D says ${JSON.stringify(restoredD.notices)} with title ${JSON.stringify(restoredD.title)}, ${String(restoredD.messages)} blocks and draft ${JSON.stringify(restoredD.value)}`,
      );
      await shot('28c-notice-D');
      const restoredLines = logCount(/chat tab restored/g);
      check(
        restoredLines === 4 && logCount(/chat tab restore skipped/g) === 0,
        `the serializer restored ${String(restoredLines)} tabs (log lines "chat tab restored (pane N)"), none skipped`,
      );

      // R9: the notice of D in the four themes, tab beside the code.
      const mediaWidth = (await chatFrameBox())?.width ?? 0;
      for (const [name, theme] of PROBLEM_THEMES) {
        await setTheme(theme);
        const look = await web.inDoc(measureText, { notice: '.status-bar .alert .alert-text' });
        check(
          look.notice !== null && look.notice !== undefined && look.notice.ratio >= 4.5,
          `R9 the notice of D has contrast ${look.notice ? look.notice.ratio.toFixed(2) : 'not found'} >= 4.5 in ${name} (tab ${String(Math.round(mediaWidth))} px)`,
        );
        await shot(`28d-notice-${name}`);
      }
      await setTheme(DARK);
      assertNoWebviewErrors('R5 D restored');

      // R7: B answers a prompt.
      await clickChatTab(0);
      // The toast "All installed extensions are temporarily disabled" (from `--disable-extensions`)
      // comes back after a Reload and covered the prompt box in the first runs of this step: the
      // click missed the box and the keys went nowhere.
      await clearToasts();
      await waitFor(async () => (await view()).messages >= 2, 15_000, 250);
      // B already had an answer ("hello there", the fake always says it), so "it answers" is one
      // more assistant block than before, not just a non-empty last reply.
      const beforeB = await view();
      await send(`${titleOf(PROMPT_B)} Reply with exactly: again28. Do not use any tools.`);
      await waitFor(
        async () => (await view()).users.length === beforeB.users.length + 1,
        10_000,
        200,
      );
      const answeredB = await waitIdle(30_000);
      const afterB = await view();
      check(
        answeredB &&
          afterB.title === TITLE_B &&
          afterB.users.length === beforeB.users.length + 1 &&
          (afterB.users.at(-1) ?? '').includes('again28') &&
          afterB.assistants === beforeB.assistants + 1 &&
          afterB.lastAssistant.trim() !== '',
        `R7 the restored B answers (prompt ${JSON.stringify(afterB.users.at(-1))}, reply ${JSON.stringify(afterB.lastAssistant)})`,
      );

      // R6 (New Session): the new tab opens in the group of the chat.
      const chatGroups = new Set((await chatTabs()).map((tab) => tab.group));
      const countBeforeNew = (await chatTabs()).length;
      await newSessionTab();
      const afterNew = await chatTabs();
      const newTab = afterNew.find((tab) => tab.active);
      check(
        afterNew.length === countBeforeNew + 1 &&
          newTab !== undefined &&
          chatGroups.has(newTab.group) &&
          chatGroups.size === 1,
        `R6 New Session after the reload opens a new tab in the chat's group (${String(countBeforeNew)} -> ${String(afterNew.length)} tabs, groups ${JSON.stringify([...chatGroups])}, new tab in ${String(newTab?.group)})`,
      );

      // retainContextWhenHidden of the revived panel: the mark set in A's document survived.
      await clickTabNamed('Tab28A');
      const retained = await web.inDoc(() => globalThis.__retained28 === true);
      check(
        drivenChatId === idA && retained === true,
        `a revived panel keeps its document while hidden (the mark set in A before it was hidden: ${String(retained)}, same webview ${String(drivenChatId === idA)})`,
      );

      // --- Reload Window #2 (sidebar mode) ------------------------------------------------------
      setLocation('sidebar');
      await waitFor(async () => (await chatIds()).side !== undefined, 8_000, 200);
      let ids = await chatIds();
      if (ids.side === undefined) {
        await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
        ids =
          (await waitFor(
            async () => ((await chatIds()).side ? chatIds() : undefined),
            15_000,
            200,
          )) ?? ids;
      }
      await openChat(30_000, ids.side);
      await waitFor(() => web.inDoc((doc) => doc.querySelector('textarea') !== null), 15_000, 200);
      check(await clickButton('New session'), 'New session is pressed in the side bar chat');
      await waitEmptyView();
      await send(PROMPT_L);
      check(await waitIdle(30_000), 'the turn of the side bar session ends');
      await clickTabNamed('Tab28A'); // A is the visible, active tab when the window reloads
      await sleep(1_000); // the workbench gets the webview's state through a message; no signal
      const tabsBeforeSecond = (await chatTabs()).length;
      await shot('28e-before-second-reload');
      await reloadWindow('__visualPreReload28b');

      // R10: the same number of tabs.
      const second = await waitFor(
        async () => {
          const tabs = await chatTabs();
          return tabs.length === tabsBeforeSecond ? tabs : undefined;
        },
        20_000,
        250,
      );
      check(
        second !== undefined,
        `R10 after the second Reload Window the workbench has ${String((await chatTabs()).length)} chat tabs (${String(tabsBeforeSecond)} before it)`,
      );

      // R8: A is back and answers; the side bar view resolves and does not show A's session.
      const shownIds = await waitFor(
        async () => {
          const found = await chatIds();
          return found.side !== undefined && found.tabs.length > 0 ? found : undefined;
        },
        60_000,
        300,
      );
      const seenIds = shownIds ?? (await chatIds());
      if (seenIds.tabs[0] === undefined)
        throw new Error('no chat tab came back after the second reload');
      await openChat(40_000, seenIds.tabs[0]);
      await waitFor(
        async () => {
          const state = await view();
          return state.title === TITLE_A && state.messages >= 2;
        },
        30_000,
        250,
      );
      await clearToasts();
      const beforeA = await view();
      await send(`${titleOf(PROMPT_A)} Reply with exactly: after28. Do not use any tools.`);
      // As R7: wait for the user message to arrive (the fake publishes it by SSE) before judging idle.
      await waitFor(
        async () => (await view()).users.length === beforeA.users.length + 1,
        10_000,
        200,
      );
      const answeredA = await waitIdle(30_000);
      const afterA = await view();
      check(
        answeredA &&
          afterA.title === TITLE_A &&
          afterA.users.length === beforeA.users.length + 1 &&
          (afterA.users.at(-1) ?? '').includes('after28') &&
          afterA.assistants === beforeA.assistants + 1 &&
          afterA.lastAssistant.trim() !== '',
        `R8 in sidebar mode the tab A comes back and answers (title ${JSON.stringify(afterA.title)}, prompt ${JSON.stringify(afterA.users.at(-1))}, reply ${JSON.stringify(afterA.lastAssistant)})`,
      );
      if (seenIds.side === undefined)
        throw new Error('the side bar chat did not show after the second reload');
      await openChat(30_000, seenIds.side);
      await waitFor(async () => (await view()).messages > 0, 20_000, 250);
      const lateral = await view();
      check(
        lateral.title !== TITLE_A && lateral.title === TITLE_L && lateral.messages > 0,
        `R8 the side bar view resolved to another session, not A's (title ${JSON.stringify(lateral.title)} against ${JSON.stringify(TITLE_A)}, ${String(lateral.messages)} blocks)`,
      );
      assertNoWebviewErrors('R8 after the second reload');
      await shot('28f-sidebar-and-tab');
    } finally {
      // Leave the workspace as the step found it: no editor open, the setting back to `sidebar`
      // and `sample.ts` as it was. The sessions it created stay in the fixture, like any other step.
      setLocation('sidebar');
      await closeAllEditors().catch(() => undefined);
      await setTheme(DARK).catch(() => undefined); // R9 leaves another theme if it fails midway
      fs.writeFileSync(sampleFile, sampleBefore);
    }
  });

  // Step 29 (issue #77, delivery E3, plan E9-sessions-sidebar section 9): the native Sessions tree of
  // the `editor` mode, judged in the DOM of the workbench (VS Code draws the rows, so this reads
  // `.part.sidebar .monaco-list-row`) and in the webview of each tab. Cells: V1 the rows (date
  // group, label, description words, icon) in the four themes and at 170 px, with the contrast of
  // the two coloured icons (3:1); V2 the inline Rename and Delete on hover and on keyboard focus,
  // dark and high contrast dark; V3 the context menu; V4 the welcome of an empty folder; V5 the
  // welcome with no server and Open Chat; B1 click opens a tab, a second click reveals it; B2
  // Rename from the row; B3 Delete from the row closes the tab; B4 Search Sessions…; B5 Show more
  // sessions and the date groups; B6 Running, then Needs input, and the badge; B7 the tab has no
  // Sessions button and the side bar chat does; B8 the selection follows the active tab and a hidden
  // side bar is not opened. The data comes from the fixture (SYNTHETIC): the triggers SEED_SESSIONS,
  // DELETE_TITLED and WIPE_SESSIONS exist only for this step. Cells that stay with Vitest: "Loading
  // sessions…" and the move across midnight.
  // VERIFIED by a full `npm run test:visual` on the final tree (Windows 11, VS Code 1.144.0,
  // 30/10/2026, 0 FAIL, "all visual checks passed"), which printed: "ok   B6 during the turn the
  // row of N reads "Running · Tab · 11:15 AM" and then "Needs input · Running · Tab · 11:15 AM",
  // and the badge of the Sessions view is "1"", "ok   V3 the context menu of a session row lists
  // Rename Session… and then Delete Session (rows: ["Rename Session…","Delete Session"])", "ok   V4
  // with no sessions the view says "No sessions in this folder yet."", "ok   V5 with the server down
  // the view says "OpenCode is not running for this folder."", "ok   B7 the chat in a tab has no
  // Sessions button and keeps New session (surface "tab", Sessions button false, New session
  // true)", "ok   B7 the chat in the side bar view keeps its Sessions button (surface "view",
  // Sessions button true)", "ok   B5 Show more sessions loads the next page (54 -> 81 rows, Seed29
  // 55 loaded true) and the groups read ["Today","Yesterday","Previous 7 days","Older"]" and "ok
  // B1 a second click on the row of B reveals its tab and adds none (4 -> 4 tabs)". The V1 line of
  // the dark theme read: N "Needs input · Running · Tab · 11:15 AM" cut, selected false, bell-dot
  // 7.69:1, F "Failed · Tab · 11:15 AM" full, selected false, error 7.03:1, drawn descriptions >=
  // 6.00:1; the same rows in the 170 px side bar show A and N with the description hidden. So the
  // state words show only when there is room (decision of Sergio, review 1 C1): the icon, the
  // tooltip and the aria label carry the state. That B1 line does NOT prove `RevealOrder`: the late
  // reveal came before the second click in that run (Engram #1511), so it passes with or without
  // it.
  // Since E9-sessions-organize (R2 of its plan) the row of N, which is asking during V1, is drawn
  // twice (under "Needs attention" and under "Today"), so V1 expects "Needs attention" as the first
  // row and "Today" after it, and the locators that take the first match (`rowNamed`, `rowLocator`)
  // get the copy under "Needs attention", with the same words. VERIFIED in the run of `--steps
  // 34,29,27` of 1/11/2026 (0 FAIL): "ok   V1 dark: the tree reads Needs attention first and Today
  // after it". The first run of this step on the new tree failed those five V1 cells on "Today
  // first" alone, and nothing else of the step.
  // The row classes were found by probing that DOM, not read from its source. Found by it: the
  // first click on a tab sometimes does not take (a hover of the command center is drawn over the
  // tab strip, hence `clickTabAndChat` removes the `.workbench-hover-container` nodes, clicks the
  // chat first and prints how many clicks it needed), and the revealed tab is revealed a second time
  // when its document is ready (the post-ready focus; the host drops that late reveal only when another chat surface was
  // revealed meanwhile, see `RevealOrder`). NOT measured: macOS, Linux.
  await step('29 native Sessions tree (issue #77, E3)', async () => {
    const DARK = 'Default Dark Modern';
    const HC_DARK = 'Default High Contrast';
    const PROMPT_A = 'Tab29A: SEED_SESSIONS reply with exactly: alpha29. Do not use any tools.';
    const PROMPT_B = 'Tab29B: Reply with exactly: beta29. Do not use any tools.';
    const PROMPT_F = 'Fail29: Reply with exactly: x. FAIL';
    const PROMPT_N = 'Tab29N: Reply with exactly: nu29. Do not use any tools.';
    const PROMPT_N2 = 'Tab29N again: ASK_PERMISSION SLOW';
    const setLocation = (value) => {
      writeSettings(vscode.userDataDir, { 'openVsCode.chatLocation': value });
    };
    const tabsNow = () =>
      page.evaluate(() =>
        [...globalThis.document.querySelectorAll('.tab')].map((tab) => ({
          label: tab.getAttribute('aria-label') ?? '',
          text: (tab.innerText ?? '').trim(),
          active: tab.classList.contains('active'),
        })),
      );
    // A chat tab is any tab that is not a TypeScript file (no title of this step has ".ts").
    const chatTabs = async () =>
      (await tabsNow()).filter((tab) => !/\.ts\b/.test(`${tab.label} ${tab.text}`));
    const view = () =>
      web.inDoc((doc) => ({
        title: doc.querySelector('.chat-title')?.textContent ?? '',
        surface:
          doc.querySelector('meta[name="open-vs-code-surface"]')?.getAttribute('content') ?? '',
        sessionsButton: doc.querySelector('[data-session-trigger]') !== null,
        newSession: [...doc.querySelectorAll('button')].some(
          (button) => (button.textContent ?? '').trim() === 'New session',
        ),
        kind: doc.body.getAttribute('data-vscode-theme-kind') ?? '',
      }));
    const connectToNew = async (previous) => {
      await waitFor(
        async () => {
          const id = await visibleChatId();
          return id !== undefined && id !== previous ? id : undefined;
        },
        10_000,
        100,
      );
      await openChat(30_000);
    };
    const newSessionTab = async () => {
      const previous = drivenChatId;
      const before = (await chatTabs()).length;
      await command('OpenCode: New Session');
      await waitFor(async () => (await chatTabs()).length === before + 1, 10_000, 200);
      await connectToNew(previous);
    };
    const titled = (needle) =>
      waitFor(async () => (await view()).title.includes(needle), 15_000, 200);
    const channel = (value) => {
      const s = value / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminanceOf = ([r, g, b]) =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const ratioOf = (a, b) => {
      const [high, low] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x);
      return (high + 0.05) / (low + 0.05);
    };
    // The rows the native tree draws in the side bar, with the colours VS Code resolved for them.
    // The in-page `parse` reads `rgb()`/`rgba()`; a row whose icon has another colour format gives
    // null and the check that needs it fails with the value in its message.
    const treeRows = () =>
      page.evaluate(() => {
        const side = globalThis.document.querySelector('.part.sidebar');
        const parse = (css) => {
          const m = css.match(/[\d.]+/g);
          return m && m.length >= 3
            ? [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])]
            : null;
        };
        const opaque = (element) => {
          for (let node = element; node; node = node.parentElement) {
            const color = parse(globalThis.getComputedStyle(node).backgroundColor);
            if (color && color[3] >= 0.99) return color.slice(0, 3);
          }
          return null;
        };
        const sideBox = side?.getBoundingClientRect();
        return [...(side?.querySelectorAll('.monaco-list-row') ?? [])].map((row) => {
          const icon = row.querySelector('.custom-view-tree-node-item-icon');
          const description = row.querySelector('.label-description');
          const box = row.getBoundingClientRect();
          const color = (element) => {
            const rgb = element ? parse(globalThis.getComputedStyle(element).color) : null;
            return rgb ? rgb.slice(0, 3) : null;
          };
          // Whether the description is really SEEN (C1 of review 1): VS Code truncates the label and
          // the description from the right, and a long title eats the description whole, while
          // `textContent` still holds all of it. `full` = drawn inside the label container and not
          // ellipsised; `cut` = some of it is drawn; `hidden` = none.
          const container =
            row.querySelector('.monaco-icon-label-container') ??
            row.querySelector('.monaco-icon-label');
          const containerBox = container?.getBoundingClientRect();
          const descriptionBox = description?.getBoundingClientRect();
          const drawnWidth =
            descriptionBox && containerBox
              ? Math.max(
                  0,
                  Math.min(descriptionBox.right, containerBox.right) -
                    Math.max(descriptionBox.left, containerBox.left),
                )
              : 0;
          const descriptionShown =
            description === null || drawnWidth < 1
              ? 'hidden'
              : description.scrollWidth <= description.clientWidth + 1 &&
                  descriptionBox !== undefined &&
                  containerBox !== undefined &&
                  descriptionBox.right <= containerBox.right + 1
                ? 'full'
                : 'cut';
          // The opacity VS Code puts on the description (and on any ancestor up to the row).
          let descriptionOpacity = 1;
          for (
            let node = description;
            node && node !== row.parentElement;
            node = node.parentElement
          ) {
            descriptionOpacity *= Number(globalThis.getComputedStyle(node).opacity);
          }
          return {
            name: (row.querySelector('.label-name')?.textContent ?? '').trim(),
            description: (description?.textContent ?? '').trim(),
            descriptionShown,
            descriptionOpacity,
            hovered: row.matches(':hover'),
            aria: row.getAttribute('aria-label') ?? '',
            selected: row.getAttribute('aria-selected') === 'true',
            focused: row.classList.contains('focused'),
            iconClass: icon ? (icon.getAttribute('class') ?? '') : '',
            iconColor: color(icon),
            descriptionColor: color(description),
            background: opaque(row),
            top: box.top,
            insideSideBar: sideBox !== undefined && box.right <= sideBox.right + 1,
          };
        });
      });
    const rowNamed = async (needle) => (await treeRows()).find((row) => row.name.includes(needle));
    const rowLocator = (needle) =>
      page.locator('.part.sidebar .monaco-list-row', { hasText: needle }).first();
    const sideState = () =>
      page.evaluate((selector) => {
        const side = globalThis.document.querySelector('.part.sidebar');
        return {
          text: (side?.querySelector('.welcome-view-content')?.innerText ?? '')
            .replace(/\s+/g, ' ')
            .trim(),
          buttons: [...(side?.querySelectorAll('.welcome-view-content .monaco-button') ?? [])].map(
            (b) => (b.textContent ?? '').trim(),
          ),
          actions: [...(side?.querySelectorAll('.action-label') ?? [])].map(
            (a) => a.getAttribute('aria-label') ?? '',
          ),
          rows: [...(side?.querySelectorAll('.monaco-list-row') ?? [])].length,
          chatFrames: [...globalThis.document.querySelectorAll(selector)].filter((frame) => {
            const sideBox = side?.getBoundingClientRect();
            const box = frame.getBoundingClientRect();
            const x = box.left + box.width / 2;
            return (
              sideBox !== undefined &&
              frame.checkVisibility({ checkVisibilityCSS: true }) &&
              box.width > 0 &&
              x >= sideBox.left &&
              x <= sideBox.right
            );
          }).length,
        };
      }, CHAT_FRAME);
    const showSessions = async () => {
      const shows = async () =>
        (await sideState()).actions.some((label) => label.startsWith('New Session'));
      if (!(await shows())) {
        await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
        await waitFor(shows, 5_000, 100);
      }
    };
    const menuRows = async () =>
      (await page.locator('.monaco-menu .action-label').allInnerTexts())
        .map((text) => text.trim())
        .filter((text) => text !== '');
    // Scrolls the tree with the wheel until a row with `needle` is drawn (the list is virtual).
    const scrollTo = async (needle, direction = 1) => {
      const side = await sideBarBox();
      if (side === null) return false;
      await page.mouse.move(side.left + 60, side.top + side.height / 2);
      for (let round = 0; round < 40; round += 1) {
        if ((await rowNamed(needle)) !== undefined) return true;
        await page.mouse.wheel(0, 500 * direction);
        await sleep(120); // the list draws its rows after the wheel; no signal to wait on
      }
      return (await rowNamed(needle)) !== undefined;
    };
    // The names of every row from the top to the bottom of the tree, in order, without repeats.
    const allRowNames = async () => {
      await scrollTo('~never~', -1);
      const seen = [];
      for (let round = 0; round < 60; round += 1) {
        const before = seen.length;
        for (const row of await treeRows()) if (!seen.includes(row.name)) seen.push(row.name);
        if (round > 0 && seen.length === before) break;
        await page.mouse.wheel(0, 400);
        await sleep(120); // as in scrollTo
      }
      return seen;
    };
    const badgeText = async () =>
      (
        await page
          .locator('.activitybar .action-item:has([aria-label^="OpenCode"]) .badge-content')
          .allInnerTexts()
          .catch(() => [])
      ).join(',');
    const inlineLabels = (row) =>
      row
        .locator('.actions .action-label')
        .evaluateAll((items) =>
          items
            .filter((item) =>
              item.checkVisibility({ checkVisibilityCSS: true, opacityProperty: true }),
            )
            .map((item) => item.getAttribute('aria-label') ?? ''),
        );
    const clickInline = async (needle, label) => {
      const row = rowLocator(needle);
      await row.hover();
      await row.locator(`.actions .action-label[aria-label^="${label}"]`).first().click({
        timeout: 5_000,
      });
    };
    const closeTabNamed = async (needle) => {
      const tab = page.locator('.tab', { hasText: needle }).first();
      await tab.hover();
      await tab.locator('.tab-actions .action-label').first().click({ timeout: 3_000 });
    };
    // Clicks the tab until it is the active one, and then the page of its chat, like a user who
    // starts to read or type. Returns whether it became active (the caller must ask: a click that
    // never took makes whatever is judged afterwards vacuous) and how many clicks it needed. In 4 of
    // 5 runs of 29/10/2026 the FIRST click on a tab did not activate it; the screenshot of that
    // moment shows the tooltip of the command center drawn over the tab strip. Moving the mouse away
    // did NOT remove it (29/10/2026, `--steps 27,28,29`: the click on the tab timed out with "hover-contents
    // of the command center intercepts pointer events"): HYPOTHESIS that the hover came from the
    // keyboard focus returning to the command center after the palette closed, so it stays until
    // the focus moves. The chat page is clicked first (focus leaves the command center), then the
    // tab. This is the harness, not the extension (S1 of review 1).
    // On 30/10/2026 (`--steps 26,27,28,29`, VS Code 1.144.0) that was not enough: the tooltip stayed
    // over the middle of the tab strip for 3 clicks in a row (it covered the tabs
    // between A, at the left, and N; Engram #1510) and the tab of B never became active, while A, outside the
    // tooltip, needed one click. Each attempt now removes the `.workbench-hover-container` nodes
    // before the click, so nothing is left to intercept it. VERIFIED on Windows 11, VS Code 1.144.0
    // (30/10/2026), in the full run on the final tree (0 FAIL): "ok   V1 setup: the tab of B is the
    // active one and the selection of the tree follows it (active true, row selected true)" and
    // "B8 the tab of A needed 1 click(s)", where the run before the change had both FAIL. One full
    // run only: the tooltip's origin is still HYPOTHESIS and a pass does not rule out a flaky click.
    const clickTabAndChat = async (needle) => {
      let attempts = 0;
      let active = false;
      for (; attempts < 3 && !active; attempts += 1) {
        await page
          .evaluate(() => {
            for (const hover of globalThis.document.querySelectorAll(
              '.workbench-hover-container',
            )) {
              hover.remove();
            }
          })
          .catch(() => undefined);
        const current = page.locator(`${CHAT_FRAME}:visible`).first();
        const currentBox = await current.boundingBox({ timeout: 2_000 }).catch(() => null);
        if (currentBox !== null) {
          await page.mouse.click(currentBox.x + currentBox.width / 2, currentBox.y + 20);
        } else {
          await page.mouse.click(900, 500);
        }
        await sleep(250); // the hover widget closes on the focus change; no signal to wait on
        await page
          .locator('.tab', { hasText: needle })
          .first()
          .click({ timeout: 5_000 })
          .catch(() => undefined); // not active afterwards: the caller's check says so
        active =
          (await waitFor(
            async () => (await chatTabs()).some((tab) => tab.active && tab.text.includes(needle)),
            2_000,
            100,
          )) === true;
      }
      const frame = page.locator(`${CHAT_FRAME}:visible`).first();
      const box = await frame.boundingBox({ timeout: 3_000 }).catch(() => null);
      if (box !== null) await page.mouse.click(box.x + box.width / 2, box.y + 20);
      return { active, clicks: attempts };
    };

    // Step 27 leaves `web` on a tab it closed: connect to the side bar chat before the first read
    // (a second press on the activity bar item would hide a side bar already showing it, so it is
    // pressed only when no chat shows up within 8 s), as step 28 does.
    setLocation('sidebar');
    if (
      (await waitFor(async () => (await visibleChatId()) !== undefined, 8_000, 200)) === undefined
    ) {
      await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
      await waitFor(async () => (await visibleChatId()) !== undefined, 10_000, 200);
    }
    await openChat(30_000);
    check(await waitIdle(60_000), 'no turn is running when the step starts');
    await closeAllEditors();
    const originalWidth = await sideBarPx();
    try {
      // --- Montage: A (answered, seeds 55 sessions), B, F (failed), N, in editor mode -------------
      await setTheme(DARK);
      await command('Notifications: Clear All Notifications');
      await waitConnected();
      check(await clickButton('New session'), 'the New session button is pressed in the side bar');
      await waitEmptyView();
      await send(PROMPT_A);
      check(await waitIdle(30_000), 'the turn of A (it seeds 55 sessions in the fixture) ends');
      setLocation('editor');
      await waitFor(async () => (await chatTabs()).length >= 1, 15_000, 200);
      await connectToNew(drivenChatId);
      await titled('Tab29A');
      // The sessions the fixture just made arrive as events; a full read (a restart) is what gives
      // the tree its first page of 50 and the "Show more sessions" row.
      await command('OpenCode: Restart Server');
      await waitConnected(60_000);
      await newSessionTab(); // B
      await send(PROMPT_B);
      check(await waitIdle(30_000), 'the turn of B ends');
      await titled('Tab29B');
      await newSessionTab(); // F
      await send(PROMPT_F);
      await waitIdle(30_000);
      await newSessionTab(); // N
      await send(PROMPT_N);
      check(await waitIdle(30_000), 'the turn of N ends');
      await titled('Tab29N');
      await showSessions();

      // --- B6: Running, then Needs input, and the badge --------------------------------------------
      await send(PROMPT_N2);
      const running = await waitFor(
        async () => {
          const row = await rowNamed('Tab29N');
          return row !== undefined &&
            /\bRunning\b/.test(row.description) &&
            !/Needs input/.test(row.description)
            ? row.description
            : undefined;
        },
        10_000,
        100,
      );
      const needs = await waitFor(
        async () => {
          const row = await rowNamed('Tab29N');
          return row !== undefined && /^Needs input · Running · Tab · /.test(row.description)
            ? row.description
            : undefined;
        },
        20_000,
        100,
      );
      const badge =
        (await waitFor(async () => (await badgeText()) === '1', 5_000, 100)) === true
          ? '1'
          : await badgeText();
      check(
        running !== undefined && needs !== undefined && badge === '1',
        `B6 during the turn the row of N reads ${JSON.stringify(running)} and then ${JSON.stringify(needs)}, and the badge of the Sessions view is ${JSON.stringify(badge)}`,
      );
      await shot('29a-tree-needs-input');

      // --- V1: the rows in the four themes, and at 170 px ------------------------------------------
      // The icon contrast is read on rows that are NOT selected and NOT hovered (C2 of review 1: on
      // a selected row VS Code paints the codicon with the list's own foreground, so a measure there
      // never reached `list.warningForeground` / `list.errorForeground`): the tab of B is made the
      // active one, so the selection (which follows the active tab) sits on B's row, and the mouse
      // is moved out of the side bar. The check asserts `selected === false` for the rows it judges.
      // The words of the description are judged for what is DRAWN (C1, decided by Sergio: the state
      // lives in the icon, the tooltip and the aria label, and the words show when there is room):
      // `textContent` must hold them (the host's contract), and the check prints whether each one is
      // fully drawn, cut or hidden. The description contrast composes the opacity VS Code gives it
      // (W7) and is only taken from descriptions that are drawn.
      const activeB = await clickTabAndChat('Tab29B');
      const selectedB =
        (await waitFor(async () => (await rowNamed('Tab29B'))?.selected === true, 5_000, 150)) ===
        true;
      check(
        activeB.active && selectedB,
        `V1 setup: the tab of B is the active one and the selection of the tree follows it (active ${String(activeB.active)}, row selected ${String(selectedB)})`,
      );
      const blend = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
      const look = async (label) => {
        await page.mouse.move(900, 500);
        await sleep(150); // the hover state of the row under the old mouse position clears
        const rows = await waitFor(
          async () => {
            const all = await treeRows();
            return all.some((row) => row.name.includes('Tab29N')) ? all : undefined;
          },
          8_000,
          150,
        );
        const all = rows ?? (await treeRows());
        const header = all.at(0);
        const rowA = all.find((row) => row.name.includes('Tab29A'));
        const rowN = all.find((row) => row.name.includes('Tab29N'));
        const rowF = all.find((row) => /^Failed\b/.test(row.description));
        const contrast = (row, key) =>
          row?.[key] && row.background ? ratioOf(row[key], row.background) : 0;
        const iconN = contrast(rowN, 'iconColor');
        const iconF = contrast(rowF, 'iconColor');
        // Opacity composed over the row background; only descriptions that are drawn count.
        const drawn = [rowN, rowF, rowA].filter(
          (row) => row !== undefined && row.descriptionShown !== 'hidden' && row.background,
        );
        const descriptions = Math.min(
          99,
          ...drawn.map((row) =>
            row.descriptionColor
              ? ratioOf(
                  blend(row.descriptionColor, row.background, row.descriptionOpacity),
                  row.background,
                )
              : 99,
          ),
        );
        if (descriptions < 4.5) {
          warn(
            `V1 ${label}: a description reads at ${descriptions.toFixed(2)}:1 (VS Code paints it)`,
          );
        }
        const unselected = [rowN, rowF].every((row) => row?.selected === false && !row.hovered);
        const shown = (row) => `${JSON.stringify(row?.description)} ${row?.descriptionShown}`;
        return {
          ok:
            // N asks while this is judged, so since E9-sessions-organize "Needs attention" opens the
            // tree and "Today" comes after it (R2 of that plan: N is drawn twice, and `find` takes
            // the first copy, which has the same words).
            header?.name === 'Needs attention' &&
            all.some((row) => row.name === 'Today') &&
            /^Tab · \S+/.test(rowA?.description ?? '') &&
            /^Needs input · Running · Tab · \S+/.test(rowN?.description ?? '') &&
            /^Failed · Tab · \S+/.test(rowF?.description ?? '') &&
            /Needs input/.test(rowN?.aria ?? '') &&
            /Failed/.test(rowF?.aria ?? '') &&
            /bell-dot/.test(rowN?.iconClass ?? '') &&
            /codicon-error/.test(rowF?.iconClass ?? '') &&
            unselected &&
            iconN >= 3 &&
            iconF >= 3,
          text: `first row ${JSON.stringify(header?.name)}, A ${shown(rowA)}, N ${shown(rowN)} selected ${String(rowN?.selected)} icon ${JSON.stringify(rowN?.iconClass)} ${iconN.toFixed(2)}:1, F ${shown(rowF)} selected ${String(rowF?.selected)} icon ${JSON.stringify(rowF?.iconClass)} ${iconF.toFixed(2)}:1, drawn descriptions >= ${descriptions.toFixed(2)}:1`,
          insideSideBar: all.every((row) => row.insideSideBar),
        };
      };
      for (const [name, theme] of PROBLEM_THEMES) {
        await setTheme(theme);
        await showSessions();
        const result = await look(name);
        check(
          result.ok,
          `V1 ${name}: the tree reads Needs attention first and Today after it; the rows hold the words of each state and the time (shown as the data says), the aria label of N and F names the state, and the needs-input and failed icons have contrast >= 3 on rows that are not selected (${result.text})`,
        );
        await shot(`29b-tree-${name}`);
      }
      await setTheme(DARK);
      const narrow = await setSideBarWidth(170);
      const small = await look('narrow');
      check(
        small.ok && small.insideSideBar,
        `V1 dark at ${String(narrow)} px: the rows keep their order, the icons and the state in the aria label, the description holds the words (shown as the data says) and none sticks out of the side bar (${small.text})`,
      );
      await shot('29c-tree-narrow');
      await setSideBarWidth(Math.round(originalWidth));

      // --- V2: the inline buttons, on hover and on keyboard focus -----------------------------------
      for (const theme of [DARK, HC_DARK]) {
        await setTheme(theme);
        await showSessions();
        const row = rowLocator('Tab29A');
        await row.hover();
        const hovered = await inlineLabels(row);
        await page.mouse.move(700, 120);
        await page.locator('.part.sidebar .monaco-list').first().focus();
        await page.keyboard.press('Home'); // the focus may already be past the row from the last theme
        let focusedRow;
        for (let key = 0; key < 25 && focusedRow === undefined; key += 1) {
          await page.keyboard.press('ArrowDown');
          const rows = await treeRows();
          const hit = rows.find((candidate) => candidate.focused);
          if (hit?.name.includes('Tab29A')) focusedRow = hit;
        }
        const focused = await inlineLabels(row);
        check(
          // The label carries the shortcut: "Rename Session… (F2)", "Delete Session (Del)".
          hovered.some((label) => label.startsWith('Rename Session…')) &&
            hovered.some((label) => label.startsWith('Delete Session')) &&
            focusedRow !== undefined &&
            focused.some((label) => label.startsWith('Rename Session…')) &&
            focused.some((label) => label.startsWith('Delete Session')),
          `V2 ${theme}: the row shows ${JSON.stringify(hovered)} on hover and ${JSON.stringify(focused)} with the keyboard focus on it`,
        );
        await shot(`29d-inline-${theme === DARK ? 'dark' : 'hc-dark'}`);
      }
      await setTheme(DARK);

      // --- V3: the context menu ---------------------------------------------------------------------
      await rowLocator('Tab29A').click({ button: 'right' });
      await waitFor(async () => (await menuRows()).length > 0, 3_000, 100);
      const menu = await menuRows();
      await shot('29e-context-menu');
      await page.keyboard.press('Escape');
      check(
        menu.includes('Rename Session…') &&
          menu.includes('Delete Session') &&
          menu.indexOf('Rename Session…') < menu.indexOf('Delete Session'),
        `V3 the context menu of a session row lists Rename Session… and then Delete Session (rows: ${JSON.stringify(menu)})`,
      );

      // --- B1 + B7 (tab): click opens a tab, a second click reveals it; the tab has no picker --------
      await closeTabNamed('Tab29B');
      await waitFor(
        async () => !(await chatTabs()).some((tab) => tab.text.includes('Tab29B')),
        5_000,
        150,
      );
      const tabsWithoutB = (await chatTabs()).length;
      const previous = drivenChatId;
      await rowLocator('Tab29B').click();
      await waitFor(async () => (await chatTabs()).length === tabsWithoutB + 1, 8_000, 150);
      await connectToNew(previous);
      await titled('Tab29B');
      const inTab = await view();
      const tabsWithB = (await chatTabs()).length;
      check(
        tabsWithB === tabsWithoutB + 1 &&
          inTab.title.includes('Tab29B') &&
          (await chatTabs()).some((tab) => tab.active && tab.text.includes('Tab29B')),
        `B1 a click on the row of B, which had no tab, opens one with its session (${String(tabsWithoutB)} -> ${String(tabsWithB)} tabs, title ${JSON.stringify(inTab.title)})`,
      );
      await rowLocator('Tab29A').click();
      await waitFor(
        async () => (await chatTabs()).some((tab) => tab.active && tab.text.includes('Tab29A')),
        8_000,
        150,
      );
      // No pause between the two clicks (W3 of review 1): the revealed tab reloads its document and,
      // when it is ready, the host used to reveal it AGAIN ("chat tab revealed" twice per click in
      // the host log of 29/10/2026), which could pull A in front of B's row clicked meanwhile (seen:
      // "4 -> 4 tabs" with A active). The host now drops that late reveal when another chat surface
      // was revealed after it was queued, so a quick click on B's row must win.
      await rowLocator('Tab29B').click();
      // The active tab says which one is on screen; the first visible iframe can still be the one
      // that is being hidden (run of 29/10/2026: `visibleChatId` never read B's id again).
      const back = await waitFor(
        async () => (await chatTabs()).some((tab) => tab.active && tab.text.includes('Tab29B')),
        8_000,
        150,
      );
      check(
        back === true && (await chatTabs()).length === tabsWithB,
        `B1 a second click on the row of B reveals its tab and adds none (${String(tabsWithB)} -> ${String((await chatTabs()).length)} tabs)`,
      );
      await openChat(30_000);
      const tabView = await view();
      check(
        tabView.surface === 'tab' && !tabView.sessionsButton && tabView.newSession,
        `B7 the chat in a tab has no Sessions button and keeps New session (surface ${JSON.stringify(tabView.surface)}, Sessions button ${String(tabView.sessionsButton)}, New session ${String(tabView.newSession)})`,
      );

      // --- B8: the selection follows the active tab; a hidden side bar is not opened ----------------
      // The tab is clicked with `clickTabAndChat` (above), which says whether it became active; the
      // check below requires it, so the "hidden side bar is not opened" half cannot pass vacuously
      // with a tab that never activated (W1 of review 1).
      const tabA = await clickTabAndChat('Tab29A');
      console.log(`  B8 the tab of A needed ${String(tabA.clicks)} click(s) to become active`);
      let selectedNow = [];
      const followed = await waitFor(
        async () => {
          const rows = await treeRows();
          selectedNow = rows.filter((row) => row.selected).map((row) => row.name);
          const rowA = rows.find((row) => row.name.includes('Tab29A'));
          const rowB = rows.find((row) => row.name.includes('Tab29B'));
          return rowA?.selected === true && rowB?.selected !== true;
        },
        8_000,
        150,
      );
      await command('View: Toggle Primary Side Bar Visibility');
      await waitFor(async () => (await sideBarPx()) === 0, 3_000, 100);
      const hiddenBefore = (await sideBarPx()) === 0;
      const tabB = await clickTabAndChat('Tab29B');
      await sleep(1_500); // a reveal that wrongly opened the view would do it within this time
      const stillHidden = (await sideBarPx()) === 0;
      await command('View: Toggle Primary Side Bar Visibility');
      await waitFor(async () => (await sideBarPx()) > 0, 3_000, 100);
      await showSessions();
      check(
        tabA.active && tabB.active && followed === true && hiddenBefore && stillHidden,
        `B8 activating the tab of A selects its row (and not B's), and with the side bar hidden activating the tab of B does not open it (A active ${String(tabA.active)}, B active ${String(tabB.active)}, selected rows ${JSON.stringify(selectedNow)}, hidden ${String(hiddenBefore)}, still hidden ${String(stillHidden)})`,
      );

      // --- B2: Rename from the row ------------------------------------------------------------------
      await clickInline('Tab29A', 'Rename');
      const asked = await waitFor(async () => !(await quickInputHidden()), 5_000, 100);
      const prompt = await page.locator('.quick-input-widget').first().innerText();
      const current = await page.locator('.quick-input-widget input').first().inputValue();
      await shot('29f-rename-input');
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('Renamed29');
      await page.keyboard.press('Enter');
      const renamedRow = await waitFor(
        async () => (await rowNamed('Renamed29')) !== undefined,
        8_000,
        150,
      );
      const renamedTab = await waitFor(
        async () => (await chatTabs()).some((tab) => tab.text.includes('Renamed29')),
        8_000,
        150,
      );
      check(
        asked === true &&
          /New title for the session/.test(prompt) &&
          current.includes('Tab29A') &&
          renamedRow === true &&
          renamedTab === true,
        `B2 Rename on the row asks "New title for the session" with the current title (${JSON.stringify(current)}), and the row and the tab then read Renamed29 (row ${String(renamedRow)}, tab ${String(renamedTab)})`,
      );

      // --- B3: Delete from the row closes the tab ------------------------------------------------------
      const tabsBeforeDelete = (await chatTabs()).length;
      await clickInline('Tab29B', 'Delete');
      const dialog = page.locator('.monaco-dialog-box');
      const modal = await waitFor(
        async () => ((await dialog.count()) ? await dialog.first().innerText() : null),
        10_000,
        300,
      );
      await dialog
        .first()
        .getByRole('button', { name: /^Delete$/ })
        .click();
      const gone = await waitFor(async () => (await rowNamed('Tab29B')) === undefined, 15_000, 200);
      const closed = await waitFor(
        async () => !(await chatTabs()).some((tab) => tab.text.includes('Tab29B')),
        8_000,
        200,
      );
      check(
        typeof modal === 'string' &&
          modal.includes('Tab29B') &&
          gone === true &&
          closed === true &&
          (await chatTabs()).length === tabsBeforeDelete - 1,
        `B3 Delete on the row of B asks in the modal (${String(modal).replace(/\s+/g, ' ').slice(0, 80)}), then its row leaves the tree and its tab closes (${String(tabsBeforeDelete)} -> ${String((await chatTabs()).length)} tabs)`,
      );

      // --- B4: Search Sessions… ----------------------------------------------------------------------
      await showSessions();
      await page
        .locator('.part.sidebar .action-label[aria-label^="Search Sessions"]')
        .first()
        .click();
      await waitFor(async () => !(await quickInputHidden()), 5_000, 100);
      await page.keyboard.type('Seed29 07');
      const item = await waitFor(
        async () =>
          (await page.locator('.quick-input-list .monaco-list-row').allInnerTexts()).find((text) =>
            text.includes('Seed29 07'),
          ),
        8_000,
        150,
      );
      await shot('29g-search');
      const tabsBeforeSearch = (await chatTabs()).length;
      const beforeSearch = drivenChatId;
      await page.keyboard.press('Enter');
      await waitFor(async () => (await chatTabs()).length === tabsBeforeSearch + 1, 8_000, 150);
      await connectToNew(beforeSearch);
      const searched = await titled('Seed29 07');
      check(
        item !== undefined && searched === true,
        `B4 Search Sessions… lists ${JSON.stringify(String(item).replace(/\s+/g, ' '))} for "Seed29 07" and opens it in a tab (${String(tabsBeforeSearch)} -> ${String((await chatTabs()).length)} tabs)`,
      );

      // --- B5: Show more sessions, and the date groups it brings ------------------------------------------
      await showSessions();
      const more = await scrollTo('Show more sessions');
      const before = (await allRowNames()).length;
      await scrollTo('Show more sessions');
      await rowLocator('Show more sessions').click();
      const loaded = await waitFor(
        async () => (await allRowNames()).includes('Seed29 55'),
        10_000,
        300,
      );
      const names = await allRowNames();
      const groups = names.filter((name) =>
        ['Today', 'Yesterday', 'Previous 7 days', 'Older'].includes(name),
      );
      await shot('29h-show-more');
      check(
        more === true &&
          loaded === true &&
          JSON.stringify(groups) ===
            JSON.stringify(['Today', 'Yesterday', 'Previous 7 days', 'Older']) &&
          names.length > before,
        `B5 Show more sessions loads the next page (${String(before)} -> ${String(names.length)} rows, Seed29 55 loaded ${String(loaded)}) and the groups read ${JSON.stringify(groups)}`,
      );

      // --- V4: an empty folder --------------------------------------------------------------------------
      await send('WIPE_SESSIONS now');
      const empty = await waitFor(
        async () => (await sideState()).text.includes('No sessions in this folder yet.'),
        15_000,
        250,
      );
      const emptyState = await sideState();
      await shot('29i-empty');
      check(
        empty === true &&
          emptyState.rows === 0 &&
          emptyState.buttons.includes('New Session') &&
          emptyState.buttons.includes('Open Extension Settings') &&
          emptyState.chatFrames === 0,
        `V4 with no sessions the view says "No sessions in this folder yet." and offers New Session and Open Extension Settings (${JSON.stringify(emptyState)})`,
      );

      // --- V5: no server ----------------------------------------------------------------------------------
      await send('CRASH the server now');
      const offline = await waitFor(
        async () => (await sideState()).text.includes('OpenCode is not running for this folder.'),
        60_000,
        500,
      );
      const offlineState = await sideState();
      await shot('29j-offline');
      await closeAllEditors();
      await showSessions();
      const tabsBeforeOpen = (await chatTabs()).length;
      await page
        .locator('.part.sidebar .welcome-view-content .monaco-button', { hasText: 'Open Chat' })
        .first()
        .click({ timeout: 5_000 });
      const opened = await waitFor(async () => (await visibleChatId()) !== undefined, 15_000, 200);
      await openChat(30_000);
      const guide = await waitFor(
        () =>
          web.inDoc(
            (doc) =>
              doc.querySelector('.connection-card') !== null ||
              doc.querySelector('.setup-guide') !== null,
          ),
        15_000,
        250,
      );
      check(
        offline === true &&
          offlineState.buttons.includes('Open Chat') &&
          offlineState.buttons.includes('Show Logs') &&
          offlineState.rows === 0 &&
          opened !== undefined &&
          (await chatTabs()).length === tabsBeforeOpen + 1 &&
          guide === true,
        `V5 with the server down the view says "OpenCode is not running for this folder." with Open Chat and Show Logs (${JSON.stringify(offlineState)}), and Open Chat opens a tab (${String(tabsBeforeOpen)} -> ${String((await chatTabs()).length)}) that shows the guide or the error card (${String(guide)})`,
      );
      fs.rmSync(vscode.downMarker, { force: true });
      await command('OpenCode: Restart Server');
      await waitConnected(60_000);

      // --- B7 (view): the side bar chat keeps its Sessions button --------------------------------------------
      await closeAllEditors();
      setLocation('sidebar');
      if (
        (await waitFor(async () => (await visibleChatId()) !== undefined, 8_000, 200)) === undefined
      ) {
        await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
        await waitFor(async () => (await visibleChatId()) !== undefined, 10_000, 200);
      }
      await openChat(30_000);
      const sideView = await view();
      check(
        sideView.surface === 'view' && sideView.sessionsButton,
        `B7 the chat in the side bar view keeps its Sessions button (surface ${JSON.stringify(sideView.surface)}, Sessions button ${String(sideView.sessionsButton)})`,
      );
      assertNoWebviewErrors('step 29');
    } finally {
      // Leave the workspace as the step found it: the server up, no editor open, `sidebar`, the dark
      // theme and the side bar at its width. The sessions of the fixture were wiped by V4.
      fs.rmSync(vscode.downMarker, { force: true });
      setLocation('sidebar');
      await closeAllEditors().catch(() => undefined);
      await setTheme(DARK).catch(() => undefined);
      await setSideBarWidth(Math.round(originalWidth)).catch(() => undefined);
    }
  });

  // Step 30 (issue #77, E4): a request goes to the chat tab of its session, and the native
  // notification is raised when no chat TAB that shows it is the ACTIVE editor (Q1 = 2 of the plan).
  // Cells: D1 tab B asks while tab A is in front: toast titled with B's session, badge, "Needs
  // input" on B's row of the Sessions tree, no card in A; D2 "Open chat" brings B forward with its
  // card focused and the toast gone; D3 control, the tab in front asks: card in it, no toast; D4 two
  // groups side by side, the request of the visible tab that is NOT the active editor: toast; D5
  // `sidebar` mode with the side bar chat visible and tabs left over: card in the side bar chat, no
  // toast. Step 5 and C11 of step 27 are the regression of the toast's new title.
  // VERIFIED by a full `npm run test:visual` on the final tree (Windows 11, VS Code 1.144.0,
  // 30/10/2026), which printed lines starting "ok   D1 tab B asks while tab A is in front: the
  // editor in front is "Tab30A: Reply with exactly: alpha30. Do", a native notification reads", "ok
  // D2 "Open chat" brings the tab of the request forward with its card focused and the notification
  // gone (tab in front true, card true, card focused true, toast gone true)", "ok   D3 the tab in
  // front asks: its card is there (true) and no notification follows after 3 s (null;", "ok   D4
  // two groups side by side, the request of the visible tab that is not the active editor: 2 chats
  // on screen in groups [0,1]" and "ok   D5 sidebar mode with the side bar chat visible and 2
  // tab(s) left over: the card is in the side bar chat (true) and no notification follows after 3 s
  // (null;" (the full texts carry the toast and the counts of that run).
  // Found by D4 (decision of Sergio, 30/10/2026): the request dock used to focus the new card in a
  // tab that did not have the focus, which made VS Code activate that tab and closed the
  // notification within 1 s after raising it ("1 s later the editor in front is "Tab30B: …"" and
  // "attention: closed (visible)" logged once). The dock now skips the focus when its document has
  // none (`RequestDock.tsx`), and D4 reads: "3 s later the editor in front is still "Tab30A: …", the
  // notification is still there and "attention: closed (visible)" was logged 0 time(s)", the
  // evidence that the focus was the cause.
  // NOT measured: macOS, Linux, a subagent that asks (the fixture has none), the request of a tab
  // that is visible in a window without the system focus.
  await step('30 requests of the chat tabs (issue #77, E4)', async () => {
    const DARK = 'Default Dark Modern';
    const titleOf = (prompt) => prompt.slice(0, 40).trim(); // the fixture titles a session so
    const PROMPT_A = 'Tab30A: Reply with exactly: alpha30. Do not use any tools.';
    const PROMPT_B = 'Tab30B: Reply with exactly: beta30. Do not use any tools.';
    const setLocation = (value) => {
      writeSettings(vscode.userDataDir, { 'openVsCode.chatLocation': value });
    };
    const tabsNow = () =>
      page.evaluate(() => {
        const groups = [...globalThis.document.querySelectorAll('.editor-group-container')];
        return [...globalThis.document.querySelectorAll('.tab')].map((tab) => ({
          label: tab.getAttribute('aria-label') ?? '',
          text: (tab.innerText ?? '').trim(),
          active: tab.classList.contains('active'),
          group: groups.indexOf(tab.closest('.editor-group-container')),
        }));
      });
    const chatTabs = async () =>
      (await tabsNow()).filter((tab) => !/\.ts\b/.test(`${tab.label} ${tab.text}`));
    const groupCount = () => page.locator('.editor-group-container').count();
    // The text of the tab that is the active editor: the active tab of the active group.
    const activeEditor = () =>
      page.evaluate(() =>
        (
          globalThis.document.querySelector('.editor-group-container.active .tab.active')
            ?.innerText ?? ''
        ).trim(),
      );
    const hostLog = () => {
      const files = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name === 'OpenCode.log') files.push(full);
        }
      };
      try {
        walk(path.join(vscode.userDataDir, 'logs'));
      } catch {
        return '';
      }
      return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    };
    const notifiedCount = () => (hostLog().match(/attention: notified/g) ?? []).length;
    const closedVisibleCount = () =>
      (hostLog().match(/attention: closed \S+ \(visible\)/g) ?? []).length;
    const view = () =>
      web.inDoc((doc) => ({
        title: doc.querySelector('.chat-title')?.textContent ?? '',
        card: doc.querySelector('.permission-card') !== null,
        cardFocused: doc.hasFocus() && doc.activeElement?.closest('.permission-card') != null,
      }));
    const visibleChatIds = () =>
      page.evaluate(
        (selector) =>
          [...globalThis.document.querySelectorAll(selector)]
            .filter(
              (frame) =>
                frame.checkVisibility({ checkVisibilityCSS: true }) &&
                frame.getBoundingClientRect().width > 0,
            )
            .map((frame) => frame.name),
        CHAT_FRAME,
      );
    // Connects to the visible chat whose title has `needle` (two chats can be on screen at once).
    const connectByTitle = async (needle) => {
      for (const id of await visibleChatIds()) {
        await openChat(30_000, id);
        if ((await view()).title.includes(needle)) return id;
      }
      return undefined;
    };
    const connectToNew = async (previous) => {
      await waitFor(
        async () => {
          const id = await visibleChatId();
          return id !== undefined && id !== previous ? id : undefined;
        },
        10_000,
        100,
      );
      await openChat(30_000);
    };
    const newSessionTab = async () => {
      const previous = drivenChatId;
      const before = (await chatTabs()).length;
      await command('OpenCode: New Session');
      await waitFor(async () => (await chatTabs()).length === before + 1, 10_000, 200);
      await connectToNew(previous);
    };
    const switchTo = async (needle) => {
      const previous = drivenChatId;
      await page.locator('.tab', { hasText: needle }).first().click();
      await waitFor(
        async () => {
          const id = await visibleChatId();
          return id !== undefined && id !== previous ? id : undefined;
        },
        8_000,
        100,
      );
      await openChat(30_000);
    };
    const toastText = async () => {
      const toasts = page.locator('.notifications-toasts .notification-toast');
      return (await toasts.count())
        ? (await toasts.first().innerText()).replace(/\n/g, ' | ')
        : null;
    };
    const badgeText = async () =>
      (
        await page
          .locator('.activitybar .action-item:has([aria-label^="OpenCode"]) .badge-content')
          .allInnerTexts()
          .catch(() => [])
      ).join(',');
    const rowsText = () =>
      page.evaluate(() =>
        [...globalThis.document.querySelectorAll('.part.sidebar .monaco-list-row')].map((row) =>
          (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
        ),
      );
    const showSessionsBar = async () => {
      const shows = () =>
        page
          .locator('.part.sidebar .action-label[aria-label^="New Session"]')
          .count()
          .then((n) => n > 0);
      if (!(await shows())) {
        await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
        await waitFor(shows, 5_000, 100);
      }
    };
    const sidebarChatId = () =>
      page.evaluate((selector) => {
        const sideBox = globalThis.document.querySelector('.part.sidebar')?.getBoundingClientRect();
        return [...globalThis.document.querySelectorAll(selector)].find((frame) => {
          const box = frame.getBoundingClientRect();
          const x = box.left + box.width / 2;
          return (
            sideBox !== undefined &&
            frame.checkVisibility({ checkVisibilityCSS: true }) &&
            box.width > 0 &&
            x >= sideBox.left &&
            x <= sideBox.right
          );
        })?.name;
      }, CHAT_FRAME);
    // Clicks the tab with `needle` after moving the mouse off the command center: its hover card
    // ("Search open-vs-code-visual…") covered the tabs and intercepted the click in the first run.
    const clickTab = async (needle) => {
      // Over the status bar, not over a webview: a webview swallows the mouse and the card stays.
      const bar = await page
        .locator('.statusbar')
        .boundingBox({ timeout: 2_000 })
        .catch(() => null);
      if (bar !== null) await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
      await sleep(200); // the hover card needs a moment to go
      await page.locator('.tab', { hasText: needle }).first().click({ timeout: 5_000 });
    };
    const clickOpenChat = async () => {
      const open = page
        .locator('.notifications-toasts .notification-toast a', { hasText: /open/i })
        .first();
      if (await open.count()) await open.click();
    };

    // Step 29 leaves the side bar mode with its chat: connect to it before the first read.
    setLocation('sidebar');
    if (
      (await waitFor(async () => (await visibleChatId()) !== undefined, 8_000, 200)) === undefined
    ) {
      await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
      await waitFor(async () => (await visibleChatId()) !== undefined, 10_000, 200);
    }
    await openChat(30_000);
    check(await waitIdle(60_000), 'no turn is running when the step starts');
    await closeAllEditors();
    try {
      await setTheme(DARK);
      await command('Notifications: Clear All Notifications');
      await waitConnected();
      // --- Montage: A and B in editor mode, B in front, the Sessions view on screen ----------------
      check(await clickButton('New session'), 'the New session button is pressed in the side bar');
      await waitEmptyView();
      await send(PROMPT_A);
      check(await waitIdle(30_000), 'the turn of A ends');
      setLocation('editor');
      await waitFor(async () => (await chatTabs()).length >= 1, 15_000, 200);
      await connectToNew(drivenChatId);
      await newSessionTab(); // B
      await send(PROMPT_B);
      check(await waitIdle(30_000), 'the turn of B ends');
      await showSessionsBar();
      const idB = drivenChatId;
      await command('Notifications: Clear All Notifications');

      // --- D1: B asks while A is in front ----------------------------------------------------------
      const notifiedBefore = notifiedCount();
      await send(`${titleOf(PROMPT_B)} Read .env. ASK_PERMISSION SLOW`);
      // The fixture takes about 1.5 s to the ask (SLOW): the click on A must land before it, or the
      // tab in front is B and the request is seen (a preparation failure, not a product failure).
      await page.locator('.tab', { hasText: 'Tab30A' }).first().click();
      const inFront = await activeEditor();
      const toast1 = await waitFor(toastText, 30_000);
      const badge1 =
        (await waitFor(async () => (await badgeText()) === '1', 5_000, 100)) === true
          ? '1'
          : await badgeText();
      const row1 = await waitFor(
        async () =>
          (await rowsText()).find((row) => row.includes('Tab30B') && /Needs input/.test(row)),
        8_000,
        150,
      );
      await sleep(1_000); // margin: a card sent to A would have arrived with the toast
      await waitFor(async () => (await visibleChatId()) !== idB, 8_000, 100);
      await openChat(30_000);
      const inA = await view();
      check(
        /Tab30A/.test(inFront) &&
          typeof toast1 === 'string' &&
          /Permission requested/.test(toast1) &&
          /Tab30B/.test(toast1) &&
          !/Tab30A/.test(toast1) &&
          badge1 === '1' &&
          row1 !== undefined &&
          inA.title.includes('Tab30A') &&
          inA.card === false &&
          notifiedCount() === notifiedBefore + 1,
        `D1 tab B asks while tab A is in front: the editor in front is "${inFront}", a native notification reads ${JSON.stringify(String(toast1).slice(0, 90))}, the badge is ${JSON.stringify(badge1)}, B's row in the Sessions view reads ${JSON.stringify(row1)}, and A has no permission card (${String(inA.card)}); "attention: notified" ${String(notifiedBefore)} -> ${String(notifiedCount())}`,
      );
      await shot('30a-request-of-hidden-tab');

      // --- D2: "Open chat" brings B forward with its card focused ----------------------------------
      await clickOpenChat();
      const frontAfter = await waitFor(
        async () => ((await activeEditor()).includes('Tab30B') ? true : undefined),
        10_000,
        200,
      );
      await connectByTitle('Tab30B');
      const card2 = await waitFor(
        async () => ((await view()).card ? true : undefined),
        15_000,
        200,
      );
      const focused2 = await waitFor(
        async () => ((await view()).cardFocused ? true : undefined),
        5_000,
        100,
      );
      const goneToast = await waitFor(
        async () => ((await toastText()) === null ? true : undefined),
        8_000,
        200,
      );
      check(
        frontAfter === true && card2 === true && focused2 === true && goneToast === true,
        `D2 "Open chat" brings the tab of the request forward with its card focused and the notification gone (tab in front ${String(frontAfter)}, card ${String(card2)}, card focused ${String(focused2)}, toast gone ${String(goneToast)})`,
      );
      await shot('30b-open-chat');
      check(await clickButton('Allow once'), 'D2 Allow once is pressed (never Always)');
      check(await waitIdle(30_000), 'D2 the turn ends after Allow once');
      void idB;

      // --- D3: control, the tab in front asks --------------------------------------------------------
      await command('Notifications: Clear All Notifications');
      await switchTo('Tab30A');
      const notified3 = notifiedCount();
      await send(`${titleOf(PROMPT_A)} Read .env. ASK_PERMISSION`);
      const card3 = await waitFor(
        async () => ((await view()).card ? true : undefined),
        20_000,
        200,
      );
      await sleep(3_000); // margin: a notification would have come with the card
      const toast3 = await toastText();
      check(
        card3 === true && toast3 === null && notifiedCount() === notified3,
        `D3 the tab in front asks: its card is there (${String(card3)}) and no notification follows after 3 s (${JSON.stringify(toast3)}; "attention: notified" ${String(notified3)} -> ${String(notifiedCount())})`,
      );
      await shot('30c-request-of-front-tab');
      check(await clickButton('Allow once'), 'D3 Allow once is pressed (never Always)');
      check(await waitIdle(30_000), 'D3 the turn ends after Allow once');

      // --- D4: two groups side by side, the request of the visible tab that is not active ------------
      await switchTo('Tab30B');
      await command('View: Move Editor into Right Group');
      const split = await waitFor(
        async () =>
          (await groupCount()) === 2 && (await visibleChatIds()).length === 2 ? true : undefined,
        10_000,
        200,
      );
      const idB4 = await connectByTitle('Tab30B');
      await clickTab('Tab30B'); // B's group is the active one
      await command('Notifications: Clear All Notifications');
      const notified4 = notifiedCount();
      const closed4Before = closedVisibleCount();
      await send(`${titleOf(PROMPT_B)} Read .env. ASK_PERMISSION SLOW`);
      await clickTab('Tab30A'); // A's group takes the active editor
      const tabs4 = await chatTabs();
      const front4 = await activeEditor();
      const toast4 = await waitFor(toastText, 30_000, 25);
      await sleep(3_000); // margin: before the dock stopped stealing the focus it closed within 1 s
      const frontAfter4 = await activeEditor();
      const closed4 = closedVisibleCount() - closed4Before;
      const toastAfter4 = await toastText();
      const stillTwo = (await visibleChatIds()).length;
      await connectByTitle('Tab30A');
      const cardInA4 = (await view()).card;
      check(
        split === true &&
          idB4 !== undefined &&
          new Set(tabs4.map((tab) => tab.group)).size === 2 &&
          stillTwo === 2 &&
          /Tab30A/.test(front4) &&
          typeof toast4 === 'string' &&
          /Permission requested/.test(toast4) &&
          /Tab30B/.test(toast4) &&
          cardInA4 === false &&
          notifiedCount() === notified4 + 1 &&
          /Tab30A/.test(frontAfter4) &&
          closed4 === 0 &&
          typeof toastAfter4 === 'string' &&
          /Permission requested/.test(toastAfter4),
        `D4 two groups side by side, the request of the visible tab that is not the active editor: ${String(stillTwo)} chats on screen in groups ${JSON.stringify(tabs4.map((tab) => tab.group))}, the editor in front is "${front4}", a native notification reads ${JSON.stringify(String(toast4).slice(0, 90))}, A has no card (${String(cardInA4)}); "attention: notified" ${String(notified4)} -> ${String(notifiedCount())}; 3 s later the editor in front is still "${frontAfter4}", the notification is ${toastAfter4 === null ? 'GONE' : 'still there'} and "attention: closed (visible)" was logged ${String(closed4)} time(s)`,
      );
      await shot('30d-two-groups');
      await clickOpenChat();
      await waitFor(
        async () => ((await activeEditor()).includes('Tab30B') ? true : undefined),
        10_000,
        200,
      );
      await connectByTitle('Tab30B');
      await waitFor(async () => ((await view()).card ? true : undefined), 15_000, 200);
      check(await clickButton('Allow once'), 'D4 Allow once is pressed (never Always)');
      check(await waitIdle(30_000), 'D4 the turn ends after Allow once');

      // --- D5: sidebar mode, the side bar chat visible and tabs left over ----------------------------
      await command('Notifications: Clear All Notifications');
      setLocation('sidebar');
      let lateral = await waitFor(() => sidebarChatId(), 8_000, 200);
      if (lateral === undefined) {
        await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
        lateral = await waitFor(() => sidebarChatId(), 15_000, 200);
      }
      await openChat(30_000, lateral);
      await waitConnected();
      const leftOver = (await chatTabs()).length;
      check(await clickButton('New session'), 'D5 New session is pressed in the side bar chat');
      await waitEmptyView();
      const notified5 = notifiedCount();
      await send('Tab30S: Read .env. ASK_PERMISSION');
      const card5 = await waitFor(
        async () => ((await view()).card ? true : undefined),
        20_000,
        200,
      );
      await sleep(3_000); // margin: a notification would have come with the card
      const toast5 = await toastText();
      check(
        leftOver >= 1 && card5 === true && toast5 === null && notifiedCount() === notified5,
        `D5 sidebar mode with the side bar chat visible and ${String(leftOver)} tab(s) left over: the card is in the side bar chat (${String(card5)}) and no notification follows after 3 s (${JSON.stringify(toast5)}; "attention: notified" ${String(notified5)} -> ${String(notifiedCount())})`,
      );
      await shot('30e-sidebar-mode');
      check(await clickButton('Allow once'), 'D5 Allow once is pressed (never Always)');
      check(await waitIdle(30_000), 'D5 the turn ends after Allow once');
      assertNoWebviewErrors('step 30');
    } finally {
      // Leave the workspace as the step found it: `sidebar`, no editor open, the dark theme.
      setLocation('sidebar');
      await command('Notifications: Clear All Notifications').catch(() => undefined);
      await closeAllEditors().catch(() => undefined);
      await setTheme(DARK).catch(() => undefined);
    }
  });

  // Step 31 (issue #77, E5, plan E9-default-editor sections 4 and 7): the default of
  // `openVsCode.chatLocation` is `editor`. The profile of this run carries `sidebar` (the baseline
  // of the steps 0-26, `startVSCode`), so this step takes the key OUT of the live profile, the way a
  // user who deletes the setting does, and judges what follows. Cells: D1 removing the key opens ONE
  // tab with the side bar session beside the code (the side bar keeps no chat); D2 the side bar
  // shows the Sessions view with that session's row and no chat; D3 the Settings editor shows Chat
  // Location as `editor` and NOT modified, with a control: once `sidebar` is written (D5) the same
  // row reads `sidebar` and modified, so the detector is not vacuous; D4 New Session from the title
  // button of the Sessions view opens a new empty tab with the caret in its prompt; D5 writing
  // `sidebar` brings the Chat view back to the side bar and the tabs stay open (Q4 of E1). The
  // first-activation default of a fresh install is cell D0 of step 25. The DOM of the Settings
  // editor (`.setting-item`, `select`, `.is-configured`, `.setting-item-modified-indicator`) is
  // internal to VS Code: the row is printed as data so a selector that moved shows in the output.
  // VERIFIED by a full `npm run test:visual` (Windows 11, VS Code 1.144.0, 30/10/2026, "all visual
  // checks passed"), which printed lines starting "ok   D1 taking chatLocation out of the profile
  // (key in it: true -> false) opens 1 tab with the side bar session", "ok   D2 the side bar shows
  // the Sessions view with the row", "ok   D3 with the key out of the profile the Settings editor
  // shows Chat Location as "editor" and not modified (is-configured false, indicator shown
  // false)", "ok   D4 New Session from the title button of the Sessions view opens a new empty tab
  // with the caret in its prompt (1 -> 2 tabs, 0 blocks, focus true)", "ok   D5 writing sidebar
  // brings the Chat view back to the side bar (chat true) and the tabs stay open (2 -> 2)" and
  // "ok   D3 control: once sidebar is written the same row reads "sidebar" and modified
  // (is-configured false, indicator shown true)". What the control showed: in VS Code 1.144.0 the
  // row never gets `is-configured` here; the modified signal is the visible
  // `.setting-item-modified-indicator`, so the check reads either. Not observed: other VS Code
  // versions, macOS, Linux.
  await step('31 the default of chatLocation is editor (issue #77, E5)', async () => {
    const DARK = 'Default Dark Modern';
    const KEY = 'openVsCode.chatLocation';
    const PROMPT_A = 'Tab31A: Reply with exactly: alpha31. Do not use any tools.';
    const setLocation = (value) => {
      writeSettings(vscode.userDataDir, { [KEY]: value });
    };
    const keyInProfile = () =>
      KEY in
      JSON.parse(fs.readFileSync(path.join(vscode.userDataDir, 'User', 'settings.json'), 'utf8'));
    const tabsNow = () =>
      page.evaluate(() => {
        const groups = [...globalThis.document.querySelectorAll('.editor-group-container')];
        return [...globalThis.document.querySelectorAll('.tab')].map((tab) => ({
          label: tab.getAttribute('aria-label') ?? '',
          text: (tab.innerText ?? '').trim(),
          group: groups.indexOf(tab.closest('.editor-group-container')),
        }));
      });
    // A chat tab is any tab that is not a TypeScript file (no title here has ".ts"); the Settings
    // editor is closed before every count, so it is never mistaken for one.
    const isChatTab = (tab) => !/\.ts\b/.test(`${tab.label} ${tab.text}`);
    const chatTabs = async () => (await tabsNow()).filter(isChatTab);
    const view = () =>
      web.inDoc((doc) => {
        const field = doc.querySelector('textarea.prompt-text');
        return {
          title: doc.querySelector('.chat-title')?.textContent ?? '',
          messages: doc.querySelectorAll('[role="log"] > *').length,
          focusOnBox: field !== null && doc.activeElement === field && doc.hasFocus(),
        };
      });
    // The side bar as VS Code draws it: the rows of the Sessions tree, the title buttons, the
    // welcome text and how many chat iframes have their centre inside it.
    const sideBar = () =>
      page.evaluate((selector) => {
        const side = globalThis.document.querySelector('.part.sidebar');
        const sideBox = side?.getBoundingClientRect();
        return {
          welcome: (side?.querySelector('.welcome-view-content')?.innerText ?? '')
            .replace(/\s+/g, ' ')
            .trim(),
          rows: [...(side?.querySelectorAll('.monaco-list-row') ?? [])].map((row) =>
            (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
          ),
          actions: [...(side?.querySelectorAll('.action-label') ?? [])].map(
            (a) => a.getAttribute('aria-label') ?? '',
          ),
          chatFrames: [...globalThis.document.querySelectorAll(selector)].filter((frame) => {
            const box = frame.getBoundingClientRect();
            const x = box.left + box.width / 2;
            return (
              sideBox !== undefined &&
              frame.checkVisibility({ checkVisibilityCSS: true }) &&
              box.width > 0 &&
              x >= sideBox.left &&
              x <= sideBox.right
            );
          }).length,
        };
      }, CHAT_FRAME);
    const sidebarChatId = () =>
      page.evaluate((selector) => {
        const sideBox = globalThis.document.querySelector('.part.sidebar')?.getBoundingClientRect();
        return [...globalThis.document.querySelectorAll(selector)].find((frame) => {
          const box = frame.getBoundingClientRect();
          const x = box.left + box.width / 2;
          return (
            sideBox !== undefined &&
            frame.checkVisibility({ checkVisibilityCSS: true }) &&
            box.width > 0 &&
            x >= sideBox.left &&
            x <= sideBox.right
          );
        })?.name;
      }, CHAT_FRAME);
    const showSessionsBar = async () => {
      const shows = async () =>
        (await sideBar()).actions.some((label) => label.startsWith('New Session'));
      if (!(await shows())) {
        await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
        await waitFor(shows, 5_000, 100);
      }
    };
    // Waits for a chat other than `previous` to be on screen (a new tab) and connects to it.
    const connectToNew = async (previous) => {
      await waitFor(
        async () => {
          const id = await visibleChatId();
          return id !== undefined && id !== previous ? id : undefined;
        },
        10_000,
        100,
      );
      await openChat(30_000);
    };
    const openSample = async () => {
      await page.keyboard.press('ControlOrMeta+p');
      await waitFor(async () => !(await quickInputHidden()), 2_000, 50);
      await page.keyboard.type('src/sample.ts');
      await waitFor(
        () =>
          page.evaluate(() =>
            (
              globalThis.document.querySelector('.quick-input-list .monaco-list-row.focused')
                ?.textContent ?? ''
            ).includes('sample.ts'),
          ),
        3_000,
        50,
      );
      await page.keyboard.press('Enter');
      await waitFor(
        async () => (await page.locator('.tab.active[aria-label*="sample.ts"]').count()) > 0,
        5_000,
        100,
      );
    };
    // Opens the Settings editor filtered by this extension, reads the row of Chat Location (the
    // value its control shows and whether VS Code marks it as modified), prints it and closes the
    // editor. `modified` is true when the row carries `is-configured` or its modified indicator is
    // visible. Returns the row, or null when it never showed up.
    const readChatLocationRow = async (label) => {
      await command('Preferences: Open Settings (UI)');
      const searchBox = page
        .locator('.settings-editor .suggest-input-container .monaco-editor')
        .first();
      await searchBox.click({ timeout: 15_000 });
      await page.keyboard.press('Control+A');
      await page.keyboard.type('@ext:sergwei.open-vs-code');
      const read = () =>
        page.evaluate(() => {
          const row = [
            ...globalThis.document.querySelectorAll('.settings-editor .setting-item'),
          ].find(
            (candidate) =>
              candidate.querySelector('.setting-item-label')?.textContent?.trim() ===
              'Chat Location',
          );
          if (!row) return null;
          const select = row.querySelector('select');
          const control = row.querySelector('.setting-item-control');
          const indicator = row.querySelector('.setting-item-modified-indicator');
          return {
            value: (select
              ? select.value || (select.selectedOptions[0]?.textContent ?? '')
              : (control?.innerText ?? '')
            ).trim(),
            hasSelect: select !== null,
            configured: row.classList.contains('is-configured'),
            indicatorShown:
              indicator !== null &&
              indicator.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
            classes: row.className,
          };
        });
      const row = (await waitFor(read, 20_000, 250)) ?? null;
      console.log(`  ${label} Settings row of Chat Location: ${JSON.stringify(row)}`);
      await shot(label === 'D3' ? '31c-settings-default' : '31e-settings-sidebar');
      await page.keyboard.press('Control+W');
      await sleep(500); // closing the settings tab has no signal the next step reads; kept short
      return row === null ? null : { ...row, modified: row.configured || row.indicatorShown };
    };

    // Step 30 leaves `sidebar` and its chat in the side bar: connect to it before the first read.
    setLocation('sidebar');
    if (
      (await waitFor(async () => (await visibleChatId()) !== undefined, 8_000, 200)) === undefined
    ) {
      await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
      await waitFor(async () => (await visibleChatId()) !== undefined, 10_000, 200);
    }
    await openChat(30_000);
    check(await waitIdle(60_000), 'no turn is running when the step starts');
    await closeAllEditors();
    try {
      await setTheme(DARK);
      await command('Notifications: Clear All Notifications');
      await waitConnected();
      check(await clickButton('New session'), 'the New session button is pressed in the side bar');
      await waitEmptyView();
      await send(PROMPT_A);
      check(await waitIdle(30_000), 'the turn of the side bar session ends');
      await openSample();

      // --- D1: the key is taken out of the profile; ONE tab opens beside the code ------------------
      const keyBefore = keyInProfile();
      setLocation(undefined);
      const opened = await waitFor(async () => (await chatTabs()).length >= 1, 15_000, 200);
      await connectToNew(drivenChatId);
      await waitFor(async () => (await view()).title.includes('Tab31A'), 15_000, 200);
      await sleep(1_000); // negative check after the positive waits: a second tab would be there
      const tabs1 = await tabsNow();
      const chat1 = tabs1.filter(isChatTab);
      const sample1 = tabs1.find((tab) => !isChatTab(tab));
      const inTab = await view();
      const bar1 = await sideBar();
      check(
        keyBefore === true &&
          !keyInProfile() &&
          opened === true &&
          chat1.length === 1 &&
          inTab.title.includes('Tab31A') &&
          sample1 !== undefined &&
          chat1[0].group !== sample1.group &&
          bar1.chatFrames === 0,
        `D1 taking chatLocation out of the profile (key in it: ${String(keyBefore)} -> ${String(keyInProfile())}) opens ${String(chat1.length)} tab with the side bar session ${JSON.stringify(inTab.title)} beside the code (groups ${String(sample1?.group)}/${String(chat1[0]?.group)}) and the side bar holds ${String(bar1.chatFrames)} chat(s)`,
      );
      await shot('31a-default-tab');

      // --- D2: the side bar shows the Sessions view with the row of the session and no chat --------
      await showSessionsBar();
      const rowA = await waitFor(
        async () => (await sideBar()).rows.find((row) => row.includes('Tab31A')),
        8_000,
        200,
      );
      const bar2 = await sideBar();
      check(
        rowA !== undefined && bar2.welcome === '' && bar2.chatFrames === 0,
        `D2 the side bar shows the Sessions view with the row ${JSON.stringify(rowA)}, no welcome text (${JSON.stringify(bar2.welcome)}) and no chat (${String(bar2.chatFrames)} iframe(s))`,
      );
      await shot('31b-sessions-view');

      // --- D3: the Settings editor shows `editor`, not modified ------------------------------------
      const settingsDefault = await readChatLocationRow('D3');
      check(
        settingsDefault !== null &&
          settingsDefault.value === 'editor' &&
          settingsDefault.modified === false,
        `D3 with the key out of the profile the Settings editor shows Chat Location as ${JSON.stringify(settingsDefault?.value)} and not modified (is-configured ${String(settingsDefault?.configured)}, indicator shown ${String(settingsDefault?.indicatorShown)})`,
      );
      check(
        (await chatTabs()).length === 1,
        'D3 the Settings editor is closed again and only the chat tab of the session is open',
      );

      // --- D4: New Session from the title button of the Sessions view ------------------------------
      await showSessionsBar();
      const previous = drivenChatId;
      const before = (await chatTabs()).length;
      await page.locator('.part.sidebar .action-label[aria-label^="New Session"]').first().click();
      await waitFor(async () => (await chatTabs()).length === before + 1, 10_000, 200);
      await connectToNew(previous);
      const focused = await waitFor(async () => (await view()).focusOnBox, 6_000, 200);
      const now = await chatTabs();
      const fresh = await view();
      check(
        now.length === before + 1 && focused === true && fresh.messages === 0,
        `D4 New Session from the title button of the Sessions view opens a new empty tab with the caret in its prompt (${String(before)} -> ${String(now.length)} tabs, ${String(fresh.messages)} blocks, focus ${String(focused)})`,
      );
      await shot('31d-new-session');

      // --- D5: writing `sidebar` brings the Chat view back; the tabs stay open --------------------
      const tabsBefore = (await chatTabs()).length;
      setLocation('sidebar');
      let lateral = await waitFor(() => sidebarChatId(), 8_000, 200);
      if (lateral === undefined) {
        await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
        lateral = await waitFor(() => sidebarChatId(), 15_000, 200);
      }
      await openChat(30_000, lateral);
      await waitConnected();
      const tabsAfter = (await chatTabs()).length;
      check(
        lateral !== undefined && keyInProfile() && tabsAfter === tabsBefore,
        `D5 writing sidebar brings the Chat view back to the side bar (chat ${String(lateral !== undefined)}) and the tabs stay open (${String(tabsBefore)} -> ${String(tabsAfter)})`,
      );
      await shot('31f-back-to-sidebar');
      const settingsSidebar = await readChatLocationRow('D3 control');
      check(
        settingsSidebar !== null &&
          settingsSidebar.value === 'sidebar' &&
          settingsSidebar.modified === true,
        `D3 control: once sidebar is written the same row reads ${JSON.stringify(settingsSidebar?.value)} and modified (is-configured ${String(settingsSidebar?.configured)}, indicator shown ${String(settingsSidebar?.indicatorShown)}), so the detector of D3 can tell`,
      );
      assertNoWebviewErrors('step 31');
    } finally {
      // Leave the workspace as the step found it: `sidebar`, no editor open, the dark theme.
      setLocation('sidebar');
      await command('Notifications: Clear All Notifications').catch(() => undefined);
      await closeAllEditors().catch(() => undefined);
      await setTheme(DARK).catch(() => undefined);
    }
  });

  // Step 32 (issue #124): `openVsCode.autoStart: false`. Cells: N1 the new activation logs `server
  // not started` and no `starting the server for` follows (2 s margin, the state is the final one);
  // N2 the chat shows the "opencode is not running" card with a Start button and the status bar item
  // reads `OpenCode: not started`; N3 Start connects, the card goes and the item shows the model;
  // N4 after a second Reload, a prompt sent from `not-started` starts the server and is answered
  // (the fake's reply is in the conversation); N5 a click on the status bar item brings the hidden
  // side bar chat back with the caret in its prompt. The DOM of the status bar (`.statusbar-item`,
  // its `aria-label`) is internal to VS Code: the items are printed as data. VERIFIED by `npm run
  // test:visual -- --steps 21,32 --bail` (Windows 11, VS Code 1.144.0, 31/10/2026, "all visual
  // checks passed"): "ok   N1 the log has "server not started" and no "starting the server for"
  // follows (noted true, launched false)", "ok   N3 once connected the card is gone and the item
  // shows the model (OpenCode: Big Pickle. Click to open the chat. | OpenCode: Big Pickle)", "ok
  // N4 the prompt sent from not-started was delivered and answered (2 blocks)" and, with the OLD N5
  // check (`hasFocus()` required), "ok   N5 a click on the status bar item brings the chat back
  // (visible true) with the caret in its prompt (true)". The current N5 (active element plus a
  // typed letter): the same "ok   N5 … (true)" line in `npm run test:visual -- --steps 31,32`
  // (Windows 11, VS Code 1.144.0, 31/10/2026). The captures 32a-not-started and 32b-started were inspected by the main thread
  // (Windows 11, 31/10/2026): the status bar showed "○ OpenCode: not started" and "✓ OpenCode: Big
  // Pickle" (`circle-outline`, `check`). Not observed: the glyphs of `loading~spin`, `circle-slash`
  // and `error`, macOS, Linux; a partial run is not commit evidence.
  await step(
    '32 autoStart off: not started, Start, the prompt and the status bar (issue #124)',
    async () => {
      const KEY = 'openVsCode.autoStart';
      const DARK = 'Default Dark Modern';
      const hostLogSizes = () => {
        const sizes = new Map();
        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name === 'OpenCode.log') sizes.set(full, fs.statSync(full).size);
          }
        };
        try {
          walk(path.join(vscode.userDataDir, 'logs'));
        } catch {
          // no logs yet: nothing to subtract
        }
        return sizes;
      };
      // What the host logged since `before` (a `hostLogSizes()`): the tail of each file, whole new files.
      const logSince = (before) => {
        let text = '';
        for (const file of hostLogSizes().keys()) {
          text += fs.readFileSync(file, 'utf8').slice(before.get(file) ?? 0) + '\n';
        }
        return text;
      };
      const statusItems = () =>
        page.evaluate(() =>
          [...globalThis.document.querySelectorAll('.part.statusbar .statusbar-item')]
            .map(
              (item) =>
                `${item.getAttribute('aria-label') ?? ''} | ${(item.textContent ?? '').trim()}`,
            )
            .filter((text) => /opencode/i.test(text)),
        );
      const reload = async (mark) => {
        await page.evaluate((key) => {
          globalThis[key] = true;
        }, mark);
        await command('Developer: Reload Window');
        web?.close();
        await browser.close().catch(() => undefined);
        let reloaded = false;
        for (let tries = 0; tries < 120 && !reloaded; tries++) {
          await connectWorkbench(90_000);
          const stale = await page
            .evaluate((key) => globalThis[key] === true, mark)
            .catch(() => true);
          reloaded = !stale;
          if (reloaded) break;
          await browser.close().catch(() => undefined);
          await sleep(250); // between two attempts to reach the new page, not a wait for it
        }
        if (!reloaded) throw new Error('Reload Window did not produce a new workbench page');
        await waitFor(
          async () => (await page.locator('.monaco-workbench').count()) > 0,
          30_000,
          300,
        );
        // The chat view activates the extension; press the activity bar item if it is not showing.
        let opened = true;
        try {
          await openChat(8_000);
        } catch {
          opened = false;
        }
        if (!opened) {
          await page
            .locator('.activitybar [aria-label^="OpenCode"]')
            .first()
            .click()
            .catch(() => undefined);
          await openChat(60_000);
        }
      };
      const card = () =>
        web.inDoc((doc) => ({
          text: doc.querySelector('.connection-card')?.textContent ?? '',
          start: [...doc.querySelectorAll('.connection-card button')].some(
            (b) => b.textContent.trim() === 'Start',
          ),
          connection: doc.querySelector('.app')?.getAttribute('data-connection') ?? '',
        }));
      try {
        await command('Notifications: Clear All Notifications');
        // --- N1/N2: autoStart off, Reload ---------------------------------------------------------------
        writeSettings(vscode.userDataDir, { [KEY]: false });
        let before = hostLogSizes();
        await reload('__visualReload32a');
        const noted = await waitFor(
          () => logSince(before).includes('server not started'),
          20_000,
          200,
        );
        await sleep(2_000); // margin: a launch would show within it; the check below is on the final state
        const afterReload = logSince(before);
        check(
          noted === true && !afterReload.includes('starting the server for'),
          `N1 the log has "server not started" and no "starting the server for" follows (noted ${String(noted === true)}, launched ${String(afterReload.includes('starting the server for'))})`,
        );
        const shown = await waitFor(async () => (await card()).start, 15_000, 200);
        const notStarted = await card();
        const items = await waitFor(
          async () =>
            (await statusItems()).some((t) => t.includes('not started')) ? true : undefined,
          15_000,
          200,
        );
        console.log(`  status bar items: ${JSON.stringify(await statusItems())}`);
        check(
          shown === true && notStarted.text.includes('opencode is not running') && items === true,
          `N2 the chat shows the "opencode is not running" card with Start (${JSON.stringify(notStarted.text.slice(0, 80))}) and the status bar item reads "not started" (${String(items === true)})`,
        );
        await shot('32a-not-started');

        // --- N3: Start connects; the item shows the model ---------------------------------------------
        check(await clickButton('Start'), 'N3 Start is pressed with the real mouse');
        await waitConnected(60_000);
        const connectedItem = await waitFor(
          async () =>
            (await statusItems()).find((t) => /OpenCode: \S/.test(t) && !t.includes('not started')),
          10_000,
          200,
        );
        console.log(`  status bar after Start: ${JSON.stringify(await statusItems())}`);
        const cardAfter = await card();
        check(
          connectedItem !== undefined && cardAfter.text === '',
          `N3 once connected the card is gone and the item shows the model (${String(connectedItem)})`,
        );
        await shot('32b-started');

        // --- N4: Reload again (still autoStart off); the prompt starts the server -------------------
        before = hostLogSizes();
        await reload('__visualReload32b');
        await waitFor(async () => (await card()).connection === 'not-started', 30_000, 200);
        check(
          (await card()).connection === 'not-started',
          'N4 after the second Reload the chat is not started again',
        );
        const PROMPT = 'Tab32: Reply with exactly: alpha32. Do not use any tools.';
        await send(PROMPT);
        await waitConnected(60_000);
        check(await waitIdle(60_000), 'N4 the turn of the prompt that started the server ends');
        const conversation = await snapshotOfChat();
        check(
          conversation.messages >= 2 && logSince(before).includes('prompt accepted'),
          `N4 the prompt sent from not-started was delivered and answered (${String(conversation.messages)} blocks)`,
        );

        // --- N5: a click on the status bar item brings the hidden chat back ---------------------------
        await page.keyboard.press('ControlOrMeta+B'); // hide the side bar with the chat
        await waitFor(async () => !(await webviewVisible()), 5_000, 200);
        await page
          .locator('.part.statusbar .statusbar-item[aria-label*="OpenCode"]')
          .first()
          .click();
        const back = await waitFor(() => webviewVisible(), 10_000, 200);
        await openChat(30_000);
        // The side bar view comes back with a NEW document (a WebviewView cannot retain its
        // context). With the old check (`activeElement` AND `doc.hasFocus()`) N5 failed in the
        // first two full runs of #124 (31/10/2026) and passed 3 of 3 with `--steps 31,32`; the
        // output only printed the combined boolean. HYPOTHESIS that `hasFocus()` was the false
        // half, as step 22 saw in the same kind of new document. Same remedy as step 22: the box is
        // the active element, and the proof of the caret is the real keyboard, a typed letter must
        // land in the box. `caretLandsInBox` (issue #127) types the letter only when the box is the
        // active element and the chat iframe is the active element of the workbench.
        const focused = await caretLandsInBox(6_000);
        check(
          back === true && focused === true,
          `N5 a click on the status bar item brings the chat back (visible ${String(back === true)}) with the caret in its prompt (${String(focused === true)})`,
        );
        assertNoWebviewErrors('step 32');
      } finally {
        // Leave the profile as found: no autoStart key, the dark theme. The server stays alive.
        writeSettings(vscode.userDataDir, { [KEY]: undefined });
        await command('Notifications: Clear All Notifications').catch(() => undefined);
        await setTheme(DARK).catch(() => undefined);
      }
    },
  );

  // Step 33 (issue #125, E8-chat-commands; plan Engram `E8-chat-commands/plan`, section 6, step 5).
  // The matrix is component x width x theme, all at a 300 px side bar: F1 a long user message is
  // folded (a "Show more" button inside the view, the text shorter than its full height,
  // `aria-expanded` false, `aria-controls` pointing at the text, no `style` attribute, contrast of
  // the button >= 4.5) in the four themes; F2 the keyboard path (Shift+Tab reaches the button, Enter
  // opens and closes it, a short message has no button) in dark; K1 `/compact` chosen in the "/"
  // menu with the real mouse and sent with Enter ends in ONE "Conversation compacted" line, the host
  // logs `compaction requested for ses_`, and the context part of the usage line is gone, with the
  // contrast of the line measured in the four themes; K2 a session the fake says has nothing to
  // compact (KEEP_ALL) shows "Compaction failed: Nothing to compact yet" with a solid border (>= 1 px) and a
  // text contrast >= 4.5 in the four themes; R1 `/init FAIL` fails, Retry runs the command again
  // (a second `command accepted /init for ses_` and no `prompt accepted` in between) in dark.
  // The transient "Compacting" activity stays in Vitest: the fake finishes in about 60 ms, too fast
  // to observe without flicker. SYNTHETIC server (the compaction route and its events are invented
  // from the types: see the fixture), so a pass proves our UI, host and protocol, not a real
  // opencode. The step is self-contained: it makes its own sessions.
  await step('33 chat commands: compact, fold and retry (issue #125)', async () => {
    const WIDTH = 300;
    const hostLog = () => {
      const files = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name === 'OpenCode.log') files.push(full);
        }
      };
      try {
        walk(path.join(vscode.userDataDir, 'logs'));
      } catch {
        return '';
      }
      return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    };
    // The folding of the user messages: the one with a "Show more" button and the one without.
    const foldState = () =>
      web.inDoc((doc) => {
        const users = [...doc.querySelectorAll('[role="log"] .message-user')];
        const long = users.find((m) => m.querySelector('button.message-fold') !== null);
        const short = users.find((m) => m.querySelector('button.message-fold') === null);
        const text = long?.querySelector('.part-text') ?? null;
        const button = long?.querySelector('button.message-fold') ?? null;
        const box = button?.getBoundingClientRect();
        return {
          users: users.length,
          shortButtons: short === undefined ? -1 : short.querySelectorAll('.message-fold').length,
          shortFolded: short?.querySelector('.part-text')?.hasAttribute('data-folded') ?? null,
          label: button?.textContent?.trim() ?? null,
          expanded: button?.getAttribute('aria-expanded') ?? null,
          controlsOk:
            button !== null &&
            text !== null &&
            text.id !== '' &&
            button.getAttribute('aria-controls') === text.id &&
            doc.getElementById(text.id) === text,
          folded: text?.hasAttribute('data-folded') ?? null,
          height: text === null ? null : text.getBoundingClientRect().height,
          full: text === null ? null : text.scrollHeight,
          left: box?.left ?? null,
          right: box?.right ?? null,
          view: doc.defaultView.innerWidth,
          activeIsFold: button !== null && doc.activeElement === button,
          styled: [...doc.querySelectorAll('body [style], body[style]')].filter(
            (e) => (e.getAttribute('style') ?? '').trim() !== '',
          ).length,
        };
      });
    const notices = () =>
      web.inDoc((doc) =>
        [...doc.querySelectorAll('[role="log"] .message-notice')].map((n) => ({
          text: (n.textContent ?? '').trim(),
          compaction: n.getAttribute('data-compaction') ?? '',
        })),
      );
    const usageText = () =>
      web.inDoc(
        (doc) => doc.querySelector('.usage-line [aria-hidden="true"]')?.textContent?.trim() ?? '',
      );
    const failedBorder = () =>
      web.inDoc((doc) => {
        const element = doc.querySelector('.message-notice[data-compaction="failed"]');
        if (element === null) return null;
        const style = doc.defaultView.getComputedStyle(element);
        return {
          width: style.borderLeftWidth,
          line: style.borderLeftStyle,
          color: style.borderLeftColor,
        };
      });
    // Types a multi-line text in one go (the real keyboard would take seconds for 14 lines) and sends it.
    const sendMultiline = async (text) => {
      if (!(await focusPromptBox())) {
        throw new Error('the prompt box did not keep the focus: the long message was not sent');
      }
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
      await sleep(150); // the first typed character is lost without it (see `send`)
      await page.keyboard.insertText(text);
      await page.keyboard.press('Enter');
    };
    const LONG_TEXT = Array.from(
      { length: 14 },
      (_, index) => `Tab33 line ${String(index + 1)} of a long message, not a command.`,
    ).join('\n');

    check(await waitIdle(60_000), 'no turn is running when the step starts');
    await setSideBarWidth(WIDTH).catch(() => undefined);
    check(await clickButton('New session'), 'New session is pressed');
    await waitEmptyView();
    assertNoWebviewErrors('before the chat commands step');

    // --- a short and a long message, then F1 in the four themes ----------------------------------------
    await send('Tab33 short: Reply with exactly: alpha33. Do not use any tools.');
    check(await waitIdle(60_000), 'F1 the turn of the short message ends');
    await sendMultiline(LONG_TEXT);
    await waitFor(async () => (await foldState()).label !== null, 20_000, 200);
    check(await waitIdle(60_000), 'F1 the turn of the long message ends');
    for (const [themeName, theme] of PROBLEM_THEMES) {
      await setTheme(theme);
      await waitFor(async () => (await foldState()).label !== null, 60_000, 500);
      const f = await foldState();
      const where = `at ${String(WIDTH)} px, ${themeName}`;
      check(
        f.label === 'Show more' && f.expanded === 'false' && f.controlsOk && f.folded === true,
        `${where}: F1 the long message is folded behind "Show more" (label ${JSON.stringify(f.label)}, aria-expanded ${JSON.stringify(f.expanded)}, aria-controls ok ${String(f.controlsOk)}, folded ${String(f.folded)})`,
      );
      check(
        f.height !== null && f.full !== null && f.height < f.full - 1,
        `${where}: F1 the folded text is shorter than the whole text (${String(f.height)} of ${String(f.full)} px)`,
      );
      check(
        f.left !== null && f.left >= -0.5 && f.right <= f.view + 0.5 && f.styled === 0,
        `${where}: F1 the button is inside the view (${String(f.left)}..${String(f.right)} of ${String(f.view)} px) and the view has no style attribute (${String(f.styled)})`,
      );
      const look = await web.inDoc(measureText, { button: 'button.message-fold' });
      check(
        look.button != null && look.button.ratio >= 4.5,
        `${where}: F1 the "Show more" button has contrast >= 4.5 (${look.button ? look.button.ratio.toFixed(2) : 'not found'})`,
      );
      await shot(`33-fold-${themeName}`);
    }

    // --- F2: the keyboard path, in dark ------------------------------------------------------------------
    await setTheme('Default Dark Modern');
    await waitFor(async () => (await foldState()).label !== null, 60_000, 500);
    check(await focusPromptBox(), 'F2 the prompt box has the focus');
    let reached = false;
    for (let presses = 0; presses < 60 && !reached; presses += 1) {
      await page.keyboard.press('Shift+Tab');
      reached = (await foldState()).activeIsFold;
    }
    check(reached, 'F2 Shift+Tab from the prompt box reaches the "Show more" button');
    const folded = await foldState();
    await page.keyboard.press('Enter');
    await waitFor(async () => (await foldState()).expanded === 'true', 3_000, 100);
    const opened = await foldState();
    check(
      opened.label === 'Show less' &&
        opened.expanded === 'true' &&
        opened.folded === false &&
        folded.height !== null &&
        opened.height !== null &&
        opened.height > folded.height + 1,
      `F2 Enter unfolds it: "Show less", aria-expanded true, taller (${String(folded.height)} -> ${String(opened.height)} px)`,
    );
    await page.keyboard.press('Enter');
    await waitFor(async () => (await foldState()).expanded === 'false', 3_000, 100);
    const closed = await foldState();
    check(
      closed.label === 'Show more' && closed.expanded === 'false' && closed.folded === true,
      `F2 Enter again folds it: "Show more", aria-expanded false (${JSON.stringify(closed.label)}, ${JSON.stringify(closed.expanded)})`,
    );
    check(
      closed.users >= 2 && closed.shortButtons === 0 && closed.shortFolded === false,
      `F2 the short message has no button and is not folded (${String(closed.users)} user messages, ${String(closed.shortButtons)} buttons)`,
    );

    // --- K1: /compact from the "/" menu with the real mouse ----------------------------------------------
    const usageBefore = await usageText();
    const logBefore = hostLog().length;
    check(await clickButton('Commands'), 'K1 the "/" button is pressed with the real mouse');
    await waitPresent('.command-menu');
    check(
      await clickIn(
        '.command-menu button.command-item[title="Summarize the conversation to free context"]',
      ),
      'K1 the /compact row is pressed with the real mouse',
    );
    check(
      (await waitFor(
        () => web.inDoc((doc) => doc.querySelector('textarea.prompt-text')?.value === '/compact '),
        3_000,
        100,
      )) === true,
      'K1 choosing /compact writes "/compact " in the box',
    );
    await page.keyboard.press('Enter');
    const compacted = await waitFor(
      async () => (await notices()).some((n) => n.text === 'Conversation compacted'),
      20_000,
      200,
    );
    check(await waitIdle(30_000), 'K1 the session is idle again after the compaction');
    const lines = await notices();
    check(
      compacted === true && lines.length === 1 && lines[0]?.compaction === 'completed',
      `K1 the conversation has ONE compaction line, "Conversation compacted" (${JSON.stringify(lines)})`,
    );
    check(
      /compaction requested for ses_/.test(hostLog().slice(logBefore)),
      'K1 the host log says "compaction requested for ses_…"',
    );
    const lost = await waitFor(async () => !(await usageText()).includes('Context'), 10_000, 200);
    check(
      usageBefore.includes('Context') && lost === true,
      `K1 the usage line loses its context part after the compaction (${JSON.stringify(usageBefore)} -> ${JSON.stringify(await usageText())})`,
    );
    for (const [themeName, theme] of PROBLEM_THEMES) {
      await setTheme(theme);
      await waitFor(async () => (await notices()).length > 0, 60_000, 500);
      const look = await web.inDoc(measureText, { line: '.message-notice' });
      check(
        look.line != null && look.line.ratio >= 4.5,
        `at ${String(WIDTH)} px, ${themeName}: K1 the compaction line has contrast >= 4.5 (${look.line ? look.line.ratio.toFixed(2) : 'not found'})`,
      );
      await shot(`33-compacted-${themeName}`);
    }

    // --- K2: a session with nothing to compact -----------------------------------------------------------
    await setTheme('Default Dark Modern');
    check(await clickButton('New session'), 'K2 New session is pressed');
    await waitEmptyView();
    await send('Tab33 KEEP_ALL: nothing to compact. Do not use any tools.');
    check(await waitIdle(60_000), 'K2 the turn of the first message ends');
    await send('/compact');
    const failedLine = await waitFor(
      async () =>
        (await notices()).some((n) => n.text === 'Compaction failed: Nothing to compact yet'),
      20_000,
      200,
    );
    check(await waitIdle(30_000), 'K2 the session is idle again after the failure');
    // The execution ends as a success (read in runner/llm.ts@843a6c51), so no red banner.
    check(
      (await web.inDoc((doc) => doc.querySelectorAll('.alert').length)) === 0,
      'K2 a failed compaction shows no red .alert banner',
    );
    check(
      failedLine === true,
      `K2 the failed compaction says "Compaction failed: Nothing to compact yet" (${JSON.stringify(await notices())})`,
    );
    for (const [themeName, theme] of PROBLEM_THEMES) {
      await setTheme(theme);
      await waitFor(async () => (await failedBorder()) !== null, 60_000, 500);
      const border = await failedBorder();
      const look = await web.inDoc(measureText, {
        line: '.message-notice[data-compaction="failed"]',
      });
      const where = `at ${String(WIDTH)} px, ${themeName}`;
      check(
        border !== null &&
          Number.parseFloat(border.width) >= 1 &&
          border.line === 'solid' &&
          border.color !== 'rgba(0, 0, 0, 0)',
        // The CSS says 2px; the computed width is 1.6px at this zoom in the light theme (seen 31/10/2026).
        `${where}: K2 the failed line has a visible solid warning border (${JSON.stringify(border)})`,
      );
      check(
        look.line != null && look.line.ratio >= 4.5,
        `${where}: K2 the text of the failed line has contrast >= 4.5 (${look.line ? look.line.ratio.toFixed(2) : 'not found'})`,
      );
      await shot(`33-failed-${themeName}`);
    }

    // --- R1: Retry of a turn started by a command, in dark ----------------------------------------------
    await setTheme('Default Dark Modern');
    check(await clickButton('New session'), 'R1 New session is pressed');
    await waitEmptyView();
    const commandsBefore = hostLog().length;
    await send('/init FAIL');
    const first = await waitFor(
      () => /command accepted \/init for ses_/.test(hostLog().slice(commandsBefore)),
      20_000,
      200,
    );
    check(first === true, 'R1 the first "/init FAIL" reached the host as a command');
    check(await waitIdle(30_000), 'R1 the failed turn ends');
    check(await clickButton('Retry'), 'R1 Retry is pressed with the real mouse');
    const second = await waitFor(
      () =>
        (
          hostLog()
            .slice(commandsBefore)
            .match(/command accepted \/init for ses_/g) ?? []
        ).length >= 2,
      20_000,
      200,
    );
    const since = hostLog().slice(commandsBefore);
    check(
      second === true && !since.includes('prompt accepted'),
      `R1 Retry ran the command again: two "command accepted /init for ses_…" and no "prompt accepted" (${String((since.match(/command accepted \/init for ses_/g) ?? []).length)} command lines, prompt lines ${String((since.match(/prompt accepted/g) ?? []).length)})`,
    );
    check(await waitIdle(30_000), 'R1 the retried turn ends');
    assertNoWebviewErrors('step 33');
    await setTheme('Default Dark Modern');
  });

  // Step 34 (plan Engram `E9-sessions-organize/plan`, sections 8 and 9): organizing the native
  // Sessions tree of the `editor` mode, judged in the DOM of the workbench. Cells (component x
  // width x theme; "normal" is a 300 px side bar, "narrow" 170 px): V1 the tree with every section
  // (Needs attention, Pinned, a folder with a subfolder, the date group, Archived folded) in its
  // order, with its icon and its description, in the four themes at normal width and in dark at
  // narrow width; V2 the title bar with a filter on (the "Filtered: Running" description and the
  // Clear Filters button) and without one, in dark and high contrast dark; V3 the context menu of a
  // session (Pin, Move to Folder…, Archive in order, then Rename and Delete) and the `when` clauses
  // with a look-ahead (Pin on a session that is not pinned, Unpin on a pinned one); V4 the context
  // menu of a folder; V5 the welcome "No sessions match the filters." and its Clear Filters button;
  // V6 the tooltip with the cost and the folder; B1 New Folder…; B2 Move to Folder…; B3 a row
  // dragged onto a folder; B4 Pin and Unpin; B5 Archive and Unarchive (the session returns to its
  // folder); B6 Delete Folder (its sessions go back to the dates, none is deleted on the server);
  // B7 a session that runs and asks enters Needs attention and leaves it when the turn ends; B8 the
  // Running and Open in a tab filters, and Clear Filters; B9 Reload Window keeps everything; B10
  // Search Sessions… finds an archived session and says so; B11 Rename Folder…; B12 New Subfolder…
  // and a folder dragged into another; B13 in `sidebar` mode the palette offers none of the new
  // commands. B3 and B12 need a real drag and drop on the tree: when it does not arrive the cell
  // is printed as a `warn UNVERIFIED …` line and never as `ok` (the list of closed F5 checks for
  // Sergio takes it). SYNTHETIC server: the sessions, the cost and the permission come from the
  // fixture, so a pass proves our UI and host, not a real opencode. Cells that stay with Vitest:
  // the cap of 200 organized sessions read, the midnight move and a corrupt stored JSON.
  // VERIFIED by `npm run test:visual -- --steps 34,29,27` (Windows 11, VS Code 1.144.0, 1/11/2026,
  // 0 FAIL, "all visual checks passed"). That run came BEFORE the review fixes of this work; after
  // them, `npm run test:visual -- --group sessions` (1/11/2026, 180 ok, "all visual checks passed")
  // passed the same checks again. Both runs printed among their lines: "ok   B3
  // dragging the row of Org34C onto the folder Spikes34 moves the session into it", "ok   B12
  // dragging the folder Docs34 onto Spikes34 makes it a subfolder of it" (a real mouse drag with
  // `page.mouse`, so the drag does reach the tree: no cell went to the F5 list), "ok   V3 the
  // context menu of a pinned session offers Unpin and not Pin, so VS Code evaluates the look-ahead
  // of the when clause" and "ok   V5 a filter with no result shows "No sessions match the
  // filters."". Harness findings of that work: the view's description is NOT drawn (a view alone in
  // its container shows no description; the first V2 read "OpenCode: Sessions" at 300 and at 520
  // px), so the host also writes the filter in the message line and V2 judges that line; a click on
  // a context menu item while the menu still fades in did not run the command, hence
  // `menuSettled`; the input box is reused, so its message and value are read only once the
  // message is the asked one (`inputPrompt`). A session is "Untitled session" until a turn ends, so
  // N sends a first turn before the one that asks (as Tab29N of step 29). NOT measured: macOS and
  // Linux, a drag of several rows, `reveal` into a folded folder.
  await step('34 organize the Sessions tree (E9-sessions-organize)', async () => {
    const DARK = 'Default Dark Modern';
    const HC_DARK = 'Default High Contrast';
    const NORMAL = 300;
    const NARROW = 170;
    const setLocation = (value) => {
      writeSettings(vscode.userDataDir, { 'openVsCode.chatLocation': value });
    };
    const unverified = [];
    const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tabsNow = () =>
      page.evaluate(() =>
        [...globalThis.document.querySelectorAll('.tab')].map((tab) => ({
          label: tab.getAttribute('aria-label') ?? '',
          text: (tab.innerText ?? '').trim(),
          active: tab.classList.contains('active'),
        })),
      );
    const chatTabs = async () =>
      (await tabsNow()).filter((tab) => !/\.ts\b/.test(`${tab.label} ${tab.text}`));
    const connectToNew = async (previous) => {
      await waitFor(
        async () => {
          const id = await visibleChatId();
          return id !== undefined && id !== previous ? id : undefined;
        },
        10_000,
        100,
      );
      await openChat(30_000);
    };
    const newSessionTab = async () => {
      const previous = drivenChatId;
      const before = (await chatTabs()).length;
      await command('OpenCode: New Session');
      await waitFor(async () => (await chatTabs()).length === before + 1, 10_000, 200);
      await connectToNew(previous);
    };
    // The rows of the native tree with what is DRAWN of them: the level (`aria-level`), whether a
    // folder is open, the icon, and whether the name and the description are fully drawn inside the
    // label container (`full`), cut by an ellipsis (`cut`) or not drawn (`hidden`).
    const outline = () =>
      page.evaluate(() => {
        const side = globalThis.document.querySelector('.part.sidebar');
        const sideBox = side?.getBoundingClientRect();
        return [...(side?.querySelectorAll('.monaco-list-row') ?? [])].map((row) => {
          const nameElement = row.querySelector('.label-name');
          const description = row.querySelector('.label-description');
          const container =
            row.querySelector('.monaco-icon-label-container') ??
            row.querySelector('.monaco-icon-label');
          const containerBox = container?.getBoundingClientRect();
          const drawn = (element) => {
            if (!element || !containerBox) return 'hidden';
            const box = element.getBoundingClientRect();
            const width = Math.max(
              0,
              Math.min(box.right, containerBox.right) - Math.max(box.left, containerBox.left),
            );
            if (width < 1) return 'hidden';
            return element.scrollWidth <= element.clientWidth + 1 &&
              box.right <= containerBox.right + 1
              ? 'full'
              : 'cut';
          };
          const rowBox = row.getBoundingClientRect();
          const icon = row.querySelector('.custom-view-tree-node-item-icon');
          return {
            name: (nameElement?.textContent ?? '').trim(),
            description: (description?.textContent ?? '').trim(),
            level: Number(row.getAttribute('aria-level') ?? '0'),
            expanded: row.getAttribute('aria-expanded'),
            iconClass: icon ? (icon.getAttribute('class') ?? '') : '',
            nameShown: drawn(nameElement),
            descriptionShown: description === null ? 'none' : drawn(description),
            insideSideBar: sideBox !== undefined && rowBox.right <= sideBox.right + 1,
          };
        });
      });
    // The ancestors of every row whose name contains `needle` (one entry per copy: a session that
    // asks for attention is drawn twice).
    const pathsOf = (rows, needle) => {
      const stack = [];
      const found = [];
      for (const row of rows) {
        stack.length = Math.max(0, row.level - 1);
        if (row.name.includes(needle)) found.push([...stack]);
        stack[row.level - 1] = row.name;
      }
      return found;
    };
    const top = (rows) => rows.filter((row) => row.level === 1).map((row) => row.name);
    const brief = (rows) => rows.map((row) => `${String(row.level)}:${row.name}`);
    const rowOf = (rows, needle) => rows.find((row) => row.name.includes(needle));
    const waitRows = (predicate, ms = 10_000) =>
      waitFor(async () => predicate(await outline()), ms, 150);
    const rowLoc = (needle) =>
      page.locator('.part.sidebar .monaco-list-row', { hasText: needle }).first();
    const sideState = () =>
      page.evaluate(() => {
        const side = globalThis.document.querySelector('.part.sidebar');
        return {
          text: (side?.querySelector('.welcome-view-content')?.innerText ?? '')
            .replace(/\s+/g, ' ')
            .trim(),
          buttons: [...(side?.querySelectorAll('.welcome-view-content .monaco-button') ?? [])].map(
            (b) => (b.textContent ?? '').trim(),
          ),
          actions: [...(side?.querySelectorAll('.action-label') ?? [])].map(
            (a) => a.getAttribute('aria-label') ?? '',
          ),
        };
      });
    // Brings the Sessions view of the side bar on screen. The OpenCode activity bar item TOGGLES:
    // pressed while the side bar is already open on this container it closes it. After a Reload
    // Window VS Code restores the open side bar before the extension draws the title actions of
    // the view, so "no New Session button yet" does not mean "side bar closed": the item is pressed
    // only when the side bar really has no width, and otherwise the view gets time to draw.
    // Evidence (E9-chat-view-settings, 01/11/2026, `--steps 32,34`, probe run without the #133
    // manifest change; the same FAIL reproduced with it): the probe printed "side bar w=300
    // vis=true actions=[]" before the click and "w=0 vis=false" after it, and B9 failed with the
    // side bar closed.
    const showSessions = async () => {
      const shows = async () =>
        (await sideState()).actions.some((label) => label.startsWith('New Session'));
      const sideBarOpen = () =>
        page.evaluate(() => {
          const side = globalThis.document.querySelector('.part.sidebar');
          return side !== null && side.getBoundingClientRect().width > 0 && side.checkVisibility();
        });
      if (await shows()) return;
      if ((await sideBarOpen()) && (await waitFor(shows, 15_000, 100))) return;
      await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
      await waitFor(shows, 5_000, 100);
    };
    // The title bar of the view: the description that carries the filter, and the Clear Filters button.
    const headerState = () =>
      page.evaluate(() => {
        const side = globalThis.document.querySelector('.part.sidebar');
        const sideBox = side?.getBoundingClientRect();
        const inside = (element) => {
          const box = element.getBoundingClientRect();
          return (
            sideBox !== undefined &&
            box.width > 0 &&
            box.left >= sideBox.left - 1 &&
            box.right <= sideBox.right + 1 &&
            element.checkVisibility({ checkVisibilityCSS: true })
          );
        };
        // Drawn = inside the side bar and not clipped by an ancestor with `overflow` other than
        // visible (the title of a view hides its description when the actions take the room).
        const unclipped = (element) => {
          const box = element.getBoundingClientRect();
          for (let node = element.parentElement; node && node !== side; node = node.parentElement) {
            if (globalThis.getComputedStyle(node).overflowX === 'visible') continue;
            const around = node.getBoundingClientRect();
            if (box.right > around.right + 1 || box.left < around.left - 1) return false;
          }
          return true;
        };
        // Every leaf that says "Filtered:" outside the rows (the message line and, in the DOM of
        // some containers, a hidden description): the one that is drawn wins.
        const labels = [...(side?.querySelectorAll('*') ?? [])].filter(
          (element) =>
            !element.closest('.monaco-list') &&
            element.children.length === 0 &&
            /Filtered:/.test(element.textContent ?? ''),
        );
        const label = labels.find((element) => inside(element) && unclipped(element)) ?? labels[0];
        const clear = [...(side?.querySelectorAll('.action-label') ?? [])].find((element) =>
          (element.getAttribute('aria-label') ?? '').startsWith('Clear Filters'),
        );
        return {
          description: (label?.textContent ?? '').trim(),
          descriptionDrawn: label !== undefined && inside(label) && unclipped(label),
          clearPresent: clear !== undefined,
          clearDrawn: clear !== undefined && inside(clear),
        };
      });
    const menuRows = async () =>
      (await page.locator('.monaco-menu .action-label').allInnerTexts())
        .map((text) => text.trim())
        .filter((text) => text !== '');
    // The menu fades in; a click on an item while it is still fading did NOT run the command in
    // three runs of 1/11/2026 (the menu stayed open, the screenshot of the failure shows it), so the
    // menu is used only once its opacity (composed up the tree) is 1 and its box did not move
    // between two reads 100 ms apart.
    const menuSettled = async () => {
      const read = () =>
        page.evaluate(() => {
          const menu = globalThis.document.querySelector('.monaco-menu');
          if (menu === null) return null;
          let opacity = 1;
          for (let node = menu; node; node = node.parentElement) {
            opacity *= Number(globalThis.getComputedStyle(node).opacity);
          }
          const box = menu.getBoundingClientRect();
          return `${opacity.toFixed(2)}|${box.left.toFixed(1)}|${box.top.toFixed(1)}|${box.height.toFixed(1)}`;
        });
      let previous = null;
      return waitFor(
        async () => {
          const now = await read();
          const settled = now !== null && now === previous && now.startsWith('1.00|');
          previous = now;
          return settled;
        },
        3_000,
        100,
      );
    };
    const openMenu = async (needle) => {
      await rowLoc(needle).click({ button: 'right' });
      await waitFor(async () => (await menuRows()).length > 0, 3_000, 100);
      await menuSettled();
      return menuRows();
    };
    const chooseMenu = async (label) => {
      await page
        .locator('.monaco-menu .action-label')
        .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`) })
        .first()
        .click({ timeout: 5_000 });
    };
    const menuAction = async (needle, label) => {
      await openMenu(needle);
      await chooseMenu(label);
    };
    const inputOpen = () => waitFor(async () => !(await quickInputHidden()), 5_000, 100);
    // The message of the input box once it is the one that was asked for: the widget is reused, so
    // right after the previous box closed it can still hold the old text and the old value (run of
    // 1/11/2026: the "current name" of Rename read the SSE34 typed before). Gives up after 5 s with
    // what the widget holds, so the caller's check still says what it saw.
    const inputPrompt = async (wanted) => {
      const read = () =>
        page
          .locator('.quick-input-widget .quick-input-message')
          .first()
          .innerText({ timeout: 500 })
          .catch(() => '');
      let nudge = 0;
      await waitFor(
        async () => {
          // HYPOTHESIS: after a click on a context menu item the window draws nothing until some input
          // event reaches it (a box opened by a menu command showed only after a screenshot, runs
          // of 1/11/2026), so the pointer is moved over the empty editor area between reads.
          nudge += 1;
          await page.mouse.move(700 + (nudge % 2), 400);
          return wanted.test(await read());
        },
        5_000,
        100,
      );
      return read();
    };
    const answerInput = async (text) => {
      await inputOpen();
      await typeInQuickInput(page.locator('.quick-input-widget input').first(), text);
      await page.keyboard.press('Enter');
      await waitFor(quickInputHidden, 3_000, 100);
    };
    const quickRows = () => page.locator('.quick-input-list .monaco-list-row');
    // Unfolds the tree row containing `needle` if it is collapsed; does nothing if already open.
    const ensureOpen = async (needle) => {
      const row = rowOf(await outline(), needle);
      if (row?.expanded === 'false') {
        await rowLoc(needle).click();
        await waitRows((rows) => rowOf(rows, needle)?.expanded === 'true', 4_000);
      }
    };
    // Opens the Filter Sessions picker, ticks the rows named in `labels` and confirms with Enter.
    const setFilters = async (labels) => {
      await page
        .locator('.part.sidebar .action-label[aria-label^="Filter Sessions"]')
        .first()
        .click({ timeout: 5_000 });
      await inputOpen();
      await waitFor(async () => (await quickRows().count()) >= 3, 3_000, 100);
      for (const label of labels) {
        await quickRows().filter({ hasText: label }).first().click({ timeout: 3_000 });
      }
      await page.keyboard.press('Enter');
      await waitFor(quickInputHidden, 3_000, 100);
    };
    const clearFilters = async () => {
      await page
        .locator('.part.sidebar .action-label[aria-label^="Clear Filters"]')
        .first()
        .click({ timeout: 5_000 });
      await waitFor(async () => !(await headerState()).clearPresent, 5_000, 100);
    };
    // How many sessions the fixture's state file holds; -1 when the file cannot be read or parsed.
    const serverSessions = () => {
      try {
        return JSON.parse(fs.readFileSync(vscode.stateFile, 'utf8')).sessions?.length ?? -1;
      } catch {
        return -1;
      }
    };
    // A real drag with the mouse from one row to another; HTML5 drag and drop needs a few moves in
    // between for Chromium to start the drag.
    const dragRow = async (from, to) => {
      const source = await rowLoc(from).boundingBox({ timeout: 3_000 });
      const target = await rowLoc(to).boundingBox({ timeout: 3_000 });
      if (source === null || target === null) return false;
      const sy = source.y + source.height / 2;
      await page.mouse.move(source.x + 60, sy);
      await page.mouse.down();
      await page.mouse.move(source.x + 60, sy + 6, { steps: 3 });
      await page.mouse.move(target.x + 60, target.y + target.height / 2, { steps: 15 });
      await page.mouse.move(target.x + 62, target.y + target.height / 2);
      await page.mouse.up();
      return true;
    };
    const reloadWindow = async (mark) => {
      await page.evaluate((key) => {
        globalThis[key] = true;
      }, mark);
      await command('Developer: Reload Window');
      web?.close();
      await browser.close().catch(() => undefined);
      let reloaded = false;
      for (let tries = 0; tries < 120 && !reloaded; tries++) {
        await connectWorkbench(90_000);
        const stale = await page
          .evaluate((key) => globalThis[key] === true, mark)
          .catch(() => true);
        reloaded = !stale;
        if (reloaded) break;
        await browser.close().catch(() => undefined);
        await sleep(250); // between two attempts to reach the new page, not a wait for it
      }
      if (!reloaded) throw new Error('Reload Window did not produce a new workbench page');
      await waitFor(async () => (await page.locator('.monaco-workbench').count()) > 0, 30_000, 300);
      drivenChatId = undefined;
    };
    // The `OpenCode:` palette commands that match `query`; the 600 ms sleep is the palette
    // filtering as you type (no signal to wait on). Closes the palette before returning.
    const paletteRows = async (query) => {
      if (!(await clickCommandCenter())) await page.keyboard.press('F1');
      await inputOpen();
      await typeInQuickInput(page.locator('.quick-input-widget input').first(), `>${query}`);
      await sleep(600); // the palette filters as you type; no signal to wait on
      const rows = (await quickRows().allInnerTexts())
        .map((text) => text.replace(/\s+/g, ' ').trim())
        .filter((text) => text.startsWith('OpenCode:'));
      await page.keyboard.press('Escape');
      await waitFor(quickInputHidden, 3_000, 100);
      return rows;
    };

    // --- Montage: A (costly), B, C, D made in the side bar, then the tree in editor mode -----------
    setLocation('sidebar');
    if (
      (await waitFor(async () => (await visibleChatId()) !== undefined, 8_000, 200)) === undefined
    ) {
      await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
      await waitFor(async () => (await visibleChatId()) !== undefined, 10_000, 200);
    }
    await openChat(30_000);
    check(await waitIdle(60_000), 'no turn is running when the step starts');
    await closeAllEditors();
    const originalWidth = await sideBarPx();
    try {
      await setTheme(DARK);
      await command('Notifications: Clear All Notifications');
      await waitConnected();
      for (const prompt of ['Org34A COSTLY', 'Org34B', 'Org34C', 'Org34D']) {
        check(await clickButton('New session'), `New session is pressed for ${prompt}`);
        await waitEmptyView();
        await send(prompt);
        check(await waitIdle(30_000), `the turn of ${prompt} ends`);
      }
      setLocation('editor');
      await waitFor(async () => (await chatTabs()).length >= 1, 15_000, 200);
      await connectToNew(drivenChatId);
      await command('OpenCode: Restart Server');
      await waitConnected(60_000);
      await closeAllEditors();
      await showSessions();
      await setSideBarWidth(NORMAL);
      const listed = await waitRows(
        (rows) => ['Org34A', 'Org34B', 'Org34C', 'Org34D'].every((n) => rowOf(rows, n)),
        20_000,
      );
      check(listed === true, 'the four sessions of the step are listed in the tree');

      // --- B1: New Folder… ------------------------------------------------------------------------
      await command('OpenCode: New Folder…');
      const folderPrompt = await inputPrompt(/Name of the new folder/);
      await answerInput('Temp34');
      await waitRows((rows) => rowOf(rows, 'Temp34') !== undefined, 8_000);
      let rows = await outline();
      const temp = rowOf(rows, 'Temp34');
      check(
        /Name of the new folder/.test(folderPrompt) &&
          temp !== undefined &&
          temp.level === 1 &&
          /codicon-folder/.test(temp.iconClass) &&
          temp.description === '0' &&
          top(rows).indexOf('Temp34') < top(rows).indexOf('Today'),
        `B1 New Folder… asks "Name of the new folder" and the tree draws Temp34 at the first level before the date groups, with the folder icon and 0 sessions (${JSON.stringify(temp)}, first level ${JSON.stringify(top(rows))})`,
      );

      // --- V4 + B12 (menu half): the menu of a folder, and New Subfolder… ---------------------------
      const folderMenu = await openMenu('Temp34');
      await shot('34a-folder-menu');
      check(
        folderMenu.length === 3 &&
          folderMenu[0] === 'New Subfolder…' &&
          folderMenu[1] === 'Rename Folder…' &&
          folderMenu[2] === 'Delete Folder',
        `V4 the context menu of a folder lists New Subfolder…, Rename Folder… and Delete Folder in that order (rows: ${JSON.stringify(folderMenu)})`,
      );
      await chooseMenu('New Subfolder…');
      const subPrompt = await inputPrompt(/Name of the new subfolder/);
      await answerInput('SSE34');
      await waitRows((rows2) => rowOf(rows2, 'Temp34')?.expanded !== null, 8_000);
      await ensureOpen('Temp34');
      await waitRows((rows2) => rowOf(rows2, 'SSE34') !== undefined, 5_000);
      rows = await outline();
      await shot('34a2-subfolder');
      check(
        /Name of the new subfolder/.test(subPrompt) &&
          pathsOf(rows, 'SSE34').length === 1 &&
          pathsOf(rows, 'SSE34')[0]?.join('/') === 'Temp34',
        `B12 New Subfolder… on Temp34 asks "Name of the new subfolder" and creates SSE34 one level inside it (menu half; prompt ${JSON.stringify(subPrompt.replace(/\s+/g, ' ').slice(0, 60))}, rows ${JSON.stringify(brief(rows))})`,
      );

      // --- B11: Rename Folder… ----------------------------------------------------------------------
      await menuAction('Temp34', 'Rename Folder…');
      const renamePrompt = await inputPrompt(/New name for the folder/);
      const renameValue = await page.locator('.quick-input-widget input').first().inputValue();
      await answerInput('Spikes34');
      const renamed = await waitRows(
        (rows2) => rowOf(rows2, 'Spikes34') !== undefined && rowOf(rows2, 'Temp34') === undefined,
        8_000,
      );
      rows = await outline();
      check(
        /New name for the folder/.test(renamePrompt) &&
          renameValue === 'Temp34' &&
          renamed === true &&
          pathsOf(rows, 'SSE34')[0]?.join('/') === 'Spikes34',
        `B11 Rename Folder… asks "New name for the folder" with the current name (${JSON.stringify(renameValue)}) and the row reads Spikes34 with its subfolder (paths ${JSON.stringify(pathsOf(rows, 'SSE34'))})`,
      );

      // --- B2: Move to Folder… ----------------------------------------------------------------------
      await menuAction('Org34A', 'Move to Folder…');
      await inputOpen();
      await waitFor(async () => (await quickRows().count()) >= 3, 3_000, 100);
      const choices = (await quickRows().allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      const moveTitle = (await page.locator('.quick-input-title').allInnerTexts()).join(' ');
      await shot('34b-move-to-folder');
      const chosen = choices.findIndex((text) => text === 'Spikes34');
      if (chosen >= 0) await quickRows().nth(chosen).click();
      await waitFor(quickInputHidden, 3_000, 100);
      await waitRows((rows2) => pathsOf(rows2, 'Org34A')[0]?.join('/') === 'Spikes34', 8_000);
      rows = await outline();
      check(
        chosen >= 0 &&
          choices.includes('No Folder') &&
          choices.includes('Spikes34 / SSE34') &&
          choices.includes('New Folder…') &&
          /Move “Org34A/.test(moveTitle) &&
          pathsOf(rows, 'Org34A').length === 1 &&
          pathsOf(rows, 'Org34A')[0]?.join('/') === 'Spikes34' &&
          rowOf(rows, 'Spikes34')?.description === '1',
        `B2 Move to Folder… lists ${JSON.stringify(choices)} under ${JSON.stringify(moveTitle)}; choosing Spikes34 takes Org34A out of Today and into the folder (paths ${JSON.stringify(pathsOf(rows, 'Org34A'))}, folder shows ${JSON.stringify(rowOf(rows, 'Spikes34')?.description)})`,
      );

      // --- V6: the tooltip -------------------------------------------------------------------------
      await rowLoc('Org34A').hover();
      const tooltip = await waitFor(
        async () => {
          const texts = await page.locator('.workbench-hover-container').allInnerTexts();
          return texts.find((text) => text.includes('Cost:'));
        },
        8_000,
        200,
      );
      await shot('34c-tooltip');
      check(
        typeof tooltip === 'string' &&
          /Folder:\s+Spikes34/.test(tooltip) &&
          /Tokens:/.test(tooltip),
        `V6 the tooltip of a row shows its cost and tokens and the folder (${JSON.stringify(String(tooltip).replace(/\s+/g, ' ').slice(0, 220))})`,
      );
      await page.mouse.move(700, 120);

      // --- V3 + B4: Pin and Unpin ---------------------------------------------------------------------
      const plainMenu = await openMenu('Org34B');
      await shot('34d-session-menu');
      const idx = (label) => plainMenu.indexOf(label);
      check(
        idx('Pin') >= 0 &&
          idx('Pin') < idx('Move to Folder…') &&
          idx('Move to Folder…') < idx('Archive') &&
          idx('Archive') < idx('Rename Session…') &&
          idx('Rename Session…') < idx('Delete Session') &&
          !plainMenu.includes('Unpin') &&
          !plainMenu.includes('Unarchive'),
        `V3 the context menu of a session that is not pinned lists Pin, Move to Folder…, Archive, Rename Session… and Delete Session in that order, with no Unpin and no Unarchive (rows: ${JSON.stringify(plainMenu)})`,
      );
      await chooseMenu('Pin');
      await waitRows((rows2) => pathsOf(rows2, 'Org34B')[0]?.join('/') === 'Pinned', 8_000);
      rows = await outline();
      const pinnedAt = pathsOf(rows, 'Org34B');
      const pinnedMenu = await openMenu('Org34B');
      await page.keyboard.press('Escape');
      check(
        pinnedMenu.includes('Unpin') && !pinnedMenu.includes('Pin'),
        `V3 the context menu of a pinned session offers Unpin and not Pin, so VS Code evaluates the look-ahead of the when clause (rows: ${JSON.stringify(pinnedMenu)})`,
      );
      await menuAction('Org34B', 'Unpin');
      const unpinned = await waitRows(
        (rows2) =>
          pathsOf(rows2, 'Org34B')[0]?.join('/') === 'Today' &&
          rowOf(rows2, 'Pinned') === undefined,
        8_000,
      );
      await menuAction('Org34B', 'Pin');
      const pinnedAgain = await waitRows(
        (rows2) => pathsOf(rows2, 'Org34B')[0]?.join('/') === 'Pinned',
        8_000,
      );
      rows = await outline();
      check(
        pinnedAt.length === 1 &&
          pinnedAt[0]?.join('/') === 'Pinned' &&
          unpinned === true &&
          pinnedAgain === true &&
          top(rows).indexOf('Pinned') < top(rows).indexOf('Spikes34'),
        `B4 Pin puts Org34B under Pinned (above the folders), Unpin sends it back to Today and the section goes away, and Pin again brings it back (first level ${JSON.stringify(top(rows))})`,
      );

      // --- B5: Archive and Unarchive -------------------------------------------------------------------
      await menuAction('Org34A', 'Archive');
      await waitRows((rows2) => rowOf(rows2, 'Archived') !== undefined, 8_000);
      rows = await outline();
      const archivedFolded = rowOf(rows, 'Archived');
      const emptied = rowOf(rows, 'Spikes34')?.description === '0';
      const hiddenWhileFolded = pathsOf(rows, 'Org34A').length === 0;
      await ensureOpen('Archived');
      await waitRows((rows2) => pathsOf(rows2, 'Org34A')[0]?.join('/') === 'Archived', 5_000);
      await shot('34e-archived');
      const archivedMenu = await openMenu('Org34A');
      await page.keyboard.press('Escape');
      await menuAction('Org34A', 'Unarchive');
      const back = await waitRows(
        (rows2) =>
          pathsOf(rows2, 'Org34A')[0]?.join('/') === 'Spikes34' &&
          rowOf(rows2, 'Archived') === undefined,
        8_000,
      );
      check(
        archivedFolded?.expanded === 'false' &&
          /codicon-archive/.test(archivedFolded.iconClass) &&
          emptied &&
          hiddenWhileFolded &&
          archivedMenu.includes('Unarchive') &&
          !archivedMenu.includes('Archive') &&
          back === true,
        `B5 Archive takes Org34A out of its folder into Archived, which comes folded (${JSON.stringify(archivedFolded)}, folder left with ${String(emptied)}), its menu offers Unarchive and not Archive (${JSON.stringify(archivedMenu)}), and Unarchive returns it to Spikes34 (${String(back)})`,
      );

      // --- B3 and B12 (drag half): real drag and drop on the tree ------------------------------------------
      const dragged = await dragRow('Org34C', 'Spikes34');
      const dropped =
        dragged &&
        (await waitRows((rows2) => pathsOf(rows2, 'Org34C')[0]?.join('/') === 'Spikes34', 5_000));
      if (dropped === true) {
        check(
          true,
          'B3 dragging the row of Org34C onto the folder Spikes34 moves the session into it',
        );
      } else {
        unverified.push('B3');
        warn(
          `UNVERIFIED B3 the drag of Org34C onto Spikes34 did not arrive at the tree (dragged ${String(dragged)}, paths ${JSON.stringify(pathsOf(await outline(), 'Org34C'))}); goes to the F5 list`,
        );
      }
      await command('OpenCode: New Folder…');
      await inputPrompt(/Name of the new folder/);
      await answerInput('Docs34');
      await waitRows((rows2) => rowOf(rows2, 'Docs34') !== undefined, 8_000);
      const draggedFolder = await dragRow('Docs34', 'Spikes34');
      const nested =
        draggedFolder &&
        (await waitRows((rows2) => pathsOf(rows2, 'Docs34')[0]?.join('/') === 'Spikes34', 5_000));
      if (nested === true) {
        check(true, 'B12 dragging the folder Docs34 onto Spikes34 makes it a subfolder of it');
      } else {
        unverified.push('B12');
        warn(
          `UNVERIFIED B12 the drag of the folder Docs34 onto Spikes34 did not arrive at the tree (dragged ${String(draggedFolder)}, paths ${JSON.stringify(pathsOf(await outline(), 'Docs34'))}); goes to the F5 list`,
        );
      }

      // --- B6: Delete Folder ---------------------------------------------------------------------------------
      await menuAction('Org34C', 'Move to Folder…');
      await inputOpen();
      await waitFor(async () => (await quickRows().count()) >= 3, 3_000, 100);
      const docsChoices = (await quickRows().allInnerTexts()).map((t) =>
        t.replace(/\s+/g, ' ').trim(),
      );
      const docsAt = docsChoices.findIndex((text) => text === 'Docs34' || /\/ Docs34$/.test(text));
      if (docsAt >= 0) await quickRows().nth(docsAt).click();
      await waitFor(quickInputHidden, 3_000, 100);
      await ensureOpen('Docs34');
      await waitRows((rows2) => pathsOf(rows2, 'Org34C')[0]?.at(-1) === 'Docs34', 8_000);
      const sessionsBefore = serverSessions();
      await menuAction('Docs34', 'Delete Folder');
      const dialog = page.locator('.monaco-dialog-box');
      const modal = await waitFor(
        async () => ((await dialog.count()) ? await dialog.first().innerText() : null),
        10_000,
        300,
      );
      await shot('34f-delete-folder');
      await dialog
        .first()
        .getByRole('button', { name: /^Delete Folder$/ })
        .click();
      const goneFolder = await waitRows((rows2) => rowOf(rows2, 'Docs34') === undefined, 8_000);
      rows = await outline();
      check(
        typeof modal === 'string' &&
          /Delete folder “Docs34”\?/.test(modal) &&
          /1 session goes back to No Folder\. No session is deleted\./.test(modal) &&
          goneFolder === true &&
          pathsOf(rows, 'Org34C')[0]?.join('/') === 'Today' &&
          sessionsBefore > 0 &&
          serverSessions() === sessionsBefore,
        `B6 Delete Folder asks in the modal (${String(modal).replace(/\s+/g, ' ').slice(0, 110)}), the folder goes, Org34C returns to Today (${JSON.stringify(pathsOf(rows, 'Org34C'))}) and the server still holds ${String(serverSessions())} of ${String(sessionsBefore)} sessions`,
      );

      // --- B7 + V1: N runs and asks; the tree in four themes and at 170 px --------------------------------------
      await menuAction('Org34D', 'Archive');
      await waitRows((rows2) => rowOf(rows2, 'Archived') !== undefined, 8_000);
      await newSessionTab();
      // The first turn gives the session its title (a session is "Untitled session" until a turn
      // ends, as the Tab29N of step 29); the second one is the one that asks.
      await send('Org34N');
      check(await waitIdle(30_000), 'the first turn of Org34N ends');
      await send('Org34N again ASK_PERMISSION SLOW');
      const asking = await waitRows(
        (rows2) =>
          pathsOf(rows2, 'Org34N').some((p) => p.join('/') === 'Needs attention') &&
          rows2
            .filter((row) => row.name.includes('Org34N'))
            .every((row) => /^Needs input · Running · Tab · /.test(row.description)),
        30_000,
      );
      rows = await outline();
      check(
        asking === true && top(rows)[0] === 'Needs attention',
        `B7 a session that runs and asks enters Needs attention at the top while it also stays in Today (paths ${JSON.stringify(pathsOf(rows, 'Org34N'))}, first level ${JSON.stringify(top(rows))})`,
      );
      const EXPECTED = ['Needs attention', 'Pinned', 'Spikes34', 'Today', 'Archived'];
      const ICONS = {
        'Needs attention': 'codicon-bell',
        Pinned: 'codicon-pinned',
        Spikes34: 'codicon-folder',
        Archived: 'codicon-archive',
      };
      const lookAtTree = async (label, wide) => {
        await page.mouse.move(900, 500);
        await sleep(150); // the hover of the row under the old pointer clears
        await showSessions();
        const all = await outline();
        const levelOne = all.filter((row) => row.level === 1);
        const iconsOk = levelOne.every(
          (row) => ICONS[row.name] === undefined || row.iconClass.includes(ICONS[row.name]),
        );
        const counts = Object.fromEntries(levelOne.map((row) => [row.name, row.description]));
        const drawnOk = all
          .filter((row) => row.level === 1)
          .every(
            (row) =>
              row.insideSideBar &&
              (wide
                ? row.nameShown === 'full' && row.descriptionShown !== 'cut'
                : row.nameShown !== 'hidden'),
          );
        const text = `first level ${JSON.stringify(levelOne.map((row) => row.name))}, descriptions ${JSON.stringify(counts)}, shown ${JSON.stringify(levelOne.map((row) => `${row.nameShown}/${row.descriptionShown}`))}, inside ${String(all.every((row) => row.insideSideBar))}`;
        return {
          ok:
            JSON.stringify(levelOne.map((row) => row.name)) === JSON.stringify(EXPECTED) &&
            iconsOk &&
            counts['Needs attention'] === '1' &&
            counts.Pinned === '1' &&
            counts.Spikes34 === '1' &&
            counts.Archived === '1' &&
            drawnOk &&
            all.every((row) => row.insideSideBar),
          text: `${label}: ${text}`,
        };
      };
      for (const [name, theme] of PROBLEM_THEMES) {
        await setTheme(theme);
        const result = await lookAtTree(name, true);
        check(
          result.ok,
          `V1 ${name} at ${String(NORMAL)} px: the tree reads Needs attention, Pinned, the folder, Today and Archived in that order, each with its icon and its count, drawn whole inside the side bar (${result.text})`,
        );
        await shot(`34g-tree-${name}`);
      }
      await setTheme(DARK);
      await setSideBarWidth(NARROW);
      const narrowLook = await lookAtTree('narrow', false);
      check(
        narrowLook.ok,
        `V1 dark at ${String(NARROW)} px: the same order, icons and counts, every row inside the side bar and its name drawn (${narrowLook.text})`,
      );
      await shot('34h-tree-narrow');
      await setSideBarWidth(NORMAL);

      // --- V2 + B8: the filters ---------------------------------------------------------------------------------------
      for (const theme of [DARK, HC_DARK]) {
        await setTheme(theme);
        await showSessions();
        const before = await headerState();
        await setFilters(['Running']);
        await waitFor(async () => (await headerState()).clearPresent, 5_000, 100);
        const on = await headerState();
        if (theme === DARK) {
          const filtered = await outline();
          check(
            rowOf(filtered, 'Org34N') !== undefined &&
              ['Org34A', 'Org34B', 'Org34C', 'Org34D'].every(
                (n) => rowOf(filtered, n) === undefined,
              ),
            `B8 the Running filter leaves only the running session (rows ${JSON.stringify(filtered.map((row) => row.name))})`,
          );
        }
        await shot(`34i-filter-${theme === DARK ? 'dark' : 'hc-dark'}`);
        await clearFilters();
        const off = await headerState();
        check(
          !before.clearPresent &&
            on.description === 'Filtered: Running' &&
            on.descriptionDrawn &&
            on.clearPresent &&
            on.clearDrawn &&
            !off.clearPresent &&
            off.description === '',
          `V2 ${theme}: without a filter the view has no Clear Filters; with Running it draws ${JSON.stringify(on.description)} (drawn ${String(on.descriptionDrawn)}) and the Clear Filters button of the title bar (drawn ${String(on.clearDrawn)}); Clear Filters removes both (${JSON.stringify(off)})`,
        );
      }
      await setTheme(DARK);
      await showSessions();
      // Only Org34N should keep a tab for the filter to tell it from the others: the rows that
      // were clicked or dragged earlier may have opened one, so their tabs are closed first.
      for (const name of ['Org34A', 'Org34B', 'Org34C', 'Org34D']) {
        while ((await chatTabs()).some((tab) => tab.text.includes(name))) {
          const tab = page.locator('.tab', { hasText: name }).first();
          await tab.hover();
          await tab.locator('.tab-actions .action-label').first().click({ timeout: 3_000 });
          await sleep(300); // the tab strip redraws; no signal to wait on
        }
      }
      await setFilters(['Open in a tab']);
      await waitFor(async () => (await headerState()).clearPresent, 5_000, 100);
      // The "Tab" flag of a row follows the closing of its tab a moment later (run of 1/11/2026: the
      // filter still listed Org34B, Org34C and an empty session right after the tabs were closed), so
      // the rows are read once they are only the ones the filter should keep.
      await waitRows(
        (rows2) =>
          rowOf(rows2, 'Org34N') !== undefined &&
          rows2.every((row) => ['Needs attention', 'Today', 'Org34N'].includes(row.name)),
        10_000,
      );
      const tabFilter = await outline();
      const tabHeader = await headerState();
      await clearFilters();
      const cleared = await waitRows((rows2) => rowOf(rows2, 'Org34C') !== undefined, 5_000);
      check(
        rowOf(tabFilter, 'Org34N') !== undefined &&
          ['Org34A', 'Org34B', 'Org34C'].every((n) => rowOf(tabFilter, n) === undefined) &&
          tabHeader.description === 'Filtered: Open in a tab' &&
          cleared === true,
        `B8 the Open in a tab filter leaves the session with a tab (rows ${JSON.stringify(tabFilter.map((row) => row.name))}, title ${JSON.stringify(tabHeader.description)}) and Clear Filters brings the others back (${String(cleared)})`,
      );

      // --- B7 (the end): the turn ends and the section goes away --------------------------------------------------
      check(await clickButton('Allow once'), 'Allow once is pressed on the request of Org34N');
      check(await waitIdle(30_000), 'the turn of Org34N ends after Allow once');
      const left = await waitRows(
        (rows2) =>
          rowOf(rows2, 'Needs attention') === undefined && pathsOf(rows2, 'Org34N').length === 1,
        15_000,
      );
      check(
        left === true,
        'B7 when the turn ends Needs attention goes away and Org34N stays in Today',
      );

      // --- V5: the welcome of a filter with no result -------------------------------------------------------------
      await setFilters(['Running']);
      const emptyWelcome = await waitFor(
        async () => (await sideState()).text.includes('No sessions match the filters.'),
        8_000,
        200,
      );
      const welcome = await sideState();
      await shot('34j-filtered-empty');
      await page
        .locator('.part.sidebar .welcome-view-content .monaco-button', { hasText: 'Clear Filters' })
        .first()
        .click({ timeout: 5_000 });
      const restored = await waitRows((rows2) => rowOf(rows2, 'Org34C') !== undefined, 8_000);
      check(
        emptyWelcome === true &&
          welcome.buttons.includes('Clear Filters') &&
          restored === true &&
          !(await headerState()).clearPresent,
        `V5 a filter with no result shows "No sessions match the filters." with a Clear Filters button (${JSON.stringify(welcome)}) and pressing it brings the rows back (${String(restored)})`,
      );

      // --- B9: Reload Window keeps the organization -----------------------------------------------------------------
      await closeAllEditors();
      await reloadWindow('__visualPreReload34');
      await showSessions();
      await waitRows((rows2) => rowOf(rows2, 'Spikes34') !== undefined, 60_000);
      await ensureOpen('Spikes34');
      await ensureOpen('Archived');
      const reloaded = await outline();
      await shot('34k-after-reload');
      check(
        top(reloaded).includes('Pinned') &&
          pathsOf(reloaded, 'Org34B')[0]?.join('/') === 'Pinned' &&
          pathsOf(reloaded, 'Org34A')[0]?.join('/') === 'Spikes34' &&
          pathsOf(reloaded, 'SSE34')[0]?.join('/') === 'Spikes34' &&
          pathsOf(reloaded, 'Org34D')[0]?.join('/') === 'Archived',
        `B9 after Reload Window the folder with its subfolder, the pinned session and the archived one are still there (paths B ${JSON.stringify(pathsOf(reloaded, 'Org34B'))}, A ${JSON.stringify(pathsOf(reloaded, 'Org34A'))}, SSE34 ${JSON.stringify(pathsOf(reloaded, 'SSE34'))}, D ${JSON.stringify(pathsOf(reloaded, 'Org34D'))})`,
      );

      // --- B10: Search Sessions… finds an archived session ---------------------------------------------------------------
      await page
        .locator('.part.sidebar .action-label[aria-label^="Search Sessions"]')
        .first()
        .click({ timeout: 5_000 });
      await inputOpen();
      await page.keyboard.type('Org34D');
      const found = await waitFor(
        async () => (await quickRows().allInnerTexts()).find((text) => text.includes('Org34D')),
        8_000,
        150,
      );
      await shot('34l-search-archived');
      await page.keyboard.press('Escape');
      await waitFor(quickInputHidden, 3_000, 100);
      check(
        typeof found === 'string' && /Archived/.test(found),
        `B10 Search Sessions… finds the archived session and its description says Archived (${JSON.stringify(String(found).replace(/\s+/g, ' '))})`,
      );

      // --- B13: in sidebar mode the palette offers none of the new commands ----------------------------------------------
      const control = await paletteRows('OpenCode: Folder');
      setLocation('sidebar');
      await waitFor(
        async () =>
          !(await sideState()).actions.some((label) => label.startsWith('Filter Sessions')),
        10_000,
        200,
      );
      await sleep(1_000); // the context keys follow the setting a moment later; no signal to wait on
      const offered = [];
      for (const word of ['Folder', 'Pin', 'Archive', 'Filter']) {
        for (const row of await paletteRows(`OpenCode: ${word}`)) {
          if (/Folder|Pin|Archive|Filter/.test(row)) offered.push(row);
        }
      }
      const kept = await paletteRows('OpenCode: New Session');
      check(
        control.some((row) => row.includes('New Folder…')) &&
          kept.some((row) => row.includes('New Session')) &&
          offered.length === 0,
        `B13 in editor mode the palette offers New Folder… (${JSON.stringify(control)}), in sidebar mode it offers none of Folder, Pin, Archive or Filter (${JSON.stringify(offered)}) and still offers New Session`,
      );
      if (unverified.length > 0) {
        console.log(`  UNVERIFIED cells of step 34: ${unverified.join(', ')}`);
      }
      assertNoWebviewErrors('step 34');
    } finally {
      // Leave the workspace as the step found it: `sidebar`, no editor, the dark theme, the side bar
      // at its width. The folders and flags it made stay in the workspaceState of the test profile.
      setLocation('sidebar');
      await closeAllEditors().catch(() => undefined);
      await setTheme(DARK).catch(() => undefined);
      await setSideBarWidth(Math.round(originalWidth)).catch(() => undefined);
    }
  });

  // ===========================================================================================
  // Steps 35 and 36 (issue #128, E10-config-views): the OpenCode Settings tab, judged in the DOM
  // of the workbench and, through its own CDP connection, in the DOM of the tab's webview. The
  // fixture is SYNTHETIC (`fake-opencode.mjs`): 4 MCP servers, a small catalog of integrations
  // and an OAuth approval page; nothing here talks to a real provider.
  // ===========================================================================================

  /** The fake API key every step-36 flow types into the native InputBox (V10 looks for it). */
  const SETTINGS_FAKE_KEY = 'sk-visual-FAKE-KEY-0136';
  /** Everything the settings webview logs (CSP violations come through here). */
  const settingsLogs = [];
  /** CDP connection to the settings webview, and the `name` of its iframe in the workbench. */
  let settingsWeb;
  let settingsFrameId;
  /** Cells nobody could judge, named by the steps that print them. */
  const settingsUnverified = [];

  /**
   * (Re)connects `settingsWeb` to the CDP target whose document says
   * `<meta name="open-vs-code-surface" content="settings">`, and returns its iframe id. Every target
   * of the extension is probed (a chat in the side bar is one too) with a throw-away log array, so
   * the console history of a chat target never lands in `settingsLogs`; the match is then reopened
   * with `settingsLogs`. Throws when none shows up in `timeoutMs`.
   */
  async function connectSettings(timeoutMs = 30_000) {
    settingsWeb?.close();
    settingsWeb = undefined;
    settingsFrameId = undefined;
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      let list;
      try {
        list = await (await fetch(`http://127.0.0.1:${String(vscode.port)}/json`)).json();
      } catch {
        list = [];
      }
      for (const entry of list) {
        if (entry.type !== 'iframe' || !entry.url.includes('extensionId=sergwei.open-vs-code')) {
          continue;
        }
        const id = /[?&]id=([^&]+)/.exec(entry.url)?.[1];
        if (id === undefined) continue;
        const probe = await openWebview(vscode.port, [], 3_000, id).catch(() => undefined);
        if (probe === undefined) continue;
        const surface = await probe
          .inDoc(
            (doc) =>
              doc.querySelector('meta[name="open-vs-code-surface"]')?.getAttribute('content') ??
              null,
          )
          .catch(() => null);
        probe.close();
        if (surface !== 'settings') continue;
        settingsWeb = await openWebview(vscode.port, settingsLogs, 10_000, id);
        settingsFrameId = id;
        return id;
      }
      await rawSleep(300);
    }
    throw new Error('the OpenCode Settings webview did not appear as a CDP target');
  }

  /** Box of the settings iframe in page coordinates; `options` goes to `boundingBox`. */
  const settingsBox = (options) =>
    page.locator(`${CHAT_FRAME}[name="${settingsFrameId}"]`).first().boundingBox(options);

  /** Number of editor tabs titled "OpenCode Settings". */
  const settingsTabCount = () =>
    page.evaluate(
      () =>
        [...globalThis.document.querySelectorAll('.tab')].filter((tab) =>
          (tab.getAttribute('aria-label') ?? '').includes('OpenCode Settings'),
        ).length,
    );

  /** Opens the tab with the palette command and connects to its webview once it has rendered. */
  async function openSettingsTab() {
    await command('OpenCode: Open Settings…');
    await waitFor(async () => (await settingsTabCount()) >= 1, 15_000, 200);
    await connectSettings();
  }

  /**
   * A real mouse click on the first element of the settings webview that matches `selector` (and,
   * with `text`, whose trimmed text is exactly that). Right before clicking, the page is asked what
   * is under the point; if it is not the element, nothing is clicked and the call throws. Returns
   * false when nothing matches. Same idea as {@link clickButton}, for the second webview.
   */
  async function settingsClick(selector, text) {
    const target = await settingsWeb.inDoc(
      (doc, spec) => {
        const element = [...doc.querySelectorAll(spec.selector)].find(
          (candidate) => spec.text === null || candidate.textContent.trim() === spec.text,
        );
        if (!element) return null;
        element.scrollIntoView({ block: 'nearest' });
        element.setAttribute('data-visual-click', 'true');
        const rect = element.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      },
      { selector, text: text ?? null },
    );
    if (!target) return false;
    try {
      const landed = await settingsWeb.inDoc((doc, point) => {
        const hit = doc.elementFromPoint(point.x, point.y);
        const mark = doc.querySelector('[data-visual-click="true"]');
        return hit !== null && mark !== null && (mark === hit || mark.contains(hit));
      }, target);
      if (!landed) {
        throw new Error(`the pointer for "${selector}" ${text ?? ''} would land on something else`);
      }
      const frame = await settingsBox();
      if (!frame) return false;
      await page.mouse.click(frame.x + target.x, frame.y + target.y);
      return true;
    } finally {
      await settingsWeb
        .inDoc((doc) => {
          for (const element of doc.querySelectorAll('[data-visual-click]')) {
            element.removeAttribute('data-visual-click');
          }
        })
        .catch(() => undefined);
    }
  }

  /** Waits (up to `ms`) until `fn(doc, arg)` evaluated in the settings webview is truthy. */
  const settingsWait = (fn, arg, ms = 10_000) => waitFor(() => settingsWeb.inDoc(fn, arg), ms, 150);

  /**
   * Narrows or widens the Settings tab to about `target` CSS px by dragging the sash of the side
   * bar (the window stays 1440 px wide, the editor takes what the bar leaves) and returns the width
   * the iframe really has. A drag the workbench refuses is swallowed: the caller judges the width.
   */
  async function fitSettingsTab(target) {
    const before = await settingsBox();
    const bar = await sideBarPx();
    const wanted = Math.max(170, Math.round(bar + before.width - target));
    await setSideBarWidth(wanted).catch(() => undefined);
    await settleLayout();
    let last = -1;
    await waitFor(
      async () => {
        const now = await settingsWeb.inDoc((doc) => doc.documentElement.clientWidth);
        const same = now === last;
        last = now;
        return same;
      },
      3_000,
      150,
    );
    return Math.round((await settingsBox()).width);
  }

  /** Applies a theme and waits until the settings webview carries its kind too. */
  async function setSettingsTheme(theme) {
    await setTheme(theme);
    const kind = THEME_KINDS[theme].webview;
    const ok = await settingsWait(
      (doc, expected) => doc.body?.dataset.vscodeThemeKind === expected,
      kind,
      10_000,
    );
    if (ok === undefined) throw new Error(`the settings webview did not take the theme ${theme}`);
    await settingsWeb.inDoc(twoFrames);
  }

  /**
   * Contrast of `names` (a `measureText` result) against 4.5. Returns `{ ok, text }`: `text` lists
   * the lowest ratio and any name that is missing or below the bar.
   */
  function contrastVerdict(measured, names) {
    if (measured === undefined || measured === null || measured.error !== undefined) {
      return { ok: false, text: `not measured (${JSON.stringify(measured)})` };
    }
    const missing = names.filter((name) => !measured[name]);
    const low = names.filter((name) => measured[name] && measured[name].ratio < 4.5);
    const ratios = names.filter((name) => measured[name]).map((name) => measured[name].ratio);
    const min = ratios.length === 0 ? 0 : Math.min(...ratios);
    return {
      ok: missing.length === 0 && low.length === 0,
      text: `min contrast ${min.toFixed(2)} over ${String(ratios.length)} texts${missing.length ? `, missing ${missing.join('/')}` : ''}${low.length ? `, below 4.5: ${low.map((name) => `${name} ${measured[name].ratio.toFixed(2)}`).join('/')}` : ''}`,
    };
  }

  /** Fails when the settings webview logged a CSP violation or an exception since the last call. */
  function assertNoSettingsErrors(where) {
    const logged = settingsLogs
      .splice(0)
      .filter((line) => /Refused to|Content Security Policy|^\[exception\]/i.test(line))
      .filter((line) => !isVsCodeFrameRace(line));
    check(
      logged.length === 0,
      `${where}: no CSP violation or exception in the settings webview${logged.length ? ` (${logged.slice(0, 3).join(' | ')})` : ''}`,
    );
  }

  /** What the settings document shows of its layout: column, overflow and `style` attributes. */
  function settingsLayout(doc) {
    const column = doc.querySelector('.settings-column')?.getBoundingClientRect();
    const root = doc.documentElement;
    return {
      docWidth: root.clientWidth,
      overflow: root.scrollWidth - root.clientWidth,
      columnWidth: column ? column.width : null,
      columnLeft: column ? column.left : null,
      // Same rule as the other steps: an EMPTY `style=""` (left behind when a script clears it) is
      // not a style; any value is.
      styled: [...doc.querySelectorAll('#root, #root *, body')].filter(
        (el) => (el.getAttribute('style') ?? '').trim() !== '',
      ).length,
    };
  }

  /** The Providers tab as drawn: headings, connected and addable ids, their lines, the search box. */
  function providersShape(doc) {
    const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const lists = [...doc.querySelectorAll('.settings-providers > ul')];
    const idsOf = (list) =>
      [...(list?.querySelectorAll('[data-provider]') ?? [])].map((li) => li.dataset.provider);
    const card = (id) => doc.querySelector(`[data-provider="${id}"]`);
    const search = doc.querySelector('input[type="search"]');
    const removeOf = (id) =>
      [...(card(id)?.querySelectorAll('button') ?? [])].some((button) =>
        (button.getAttribute('aria-label') ?? '').startsWith('Remove'),
      );
    return {
      headings: [...doc.querySelectorAll('h2.settings-heading')].map(text),
      connected: idsOf(lists[0]),
      addable: idsOf(lists[1]),
      anthropic: [...(card('anthropic')?.querySelectorAll('.step-line') ?? [])].map(text),
      vertex: [...(card('google-vertex')?.querySelectorAll('.step-line') ?? [])].map(text),
      anthropicRemove: removeOf('anthropic'),
      vertexRemove: removeOf('google-vertex'),
      placeholder: search?.getAttribute('placeholder') ?? null,
      searchLabel: search?.getAttribute('aria-label') ?? null,
      passwordInputs: doc.querySelectorAll('input[type="password"]').length,
    };
  }

  /** The MCP tab as drawn: per server its title, error, lines and resource lists. */
  function mcpShape(doc) {
    const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const width = doc.documentElement.clientWidth;
    return [...doc.querySelectorAll('[data-server]')].map((li) => ({
      name: li.dataset.server,
      tone: li.dataset.status,
      title: text(li.querySelector('.step-title')),
      error: li.querySelector('.settings-error')?.textContent ?? null,
      lines: [...li.querySelectorAll('.step-line')].map(text),
      lists: [...li.querySelectorAll('.settings-resources')].map((ul) =>
        [...ul.querySelectorAll('li')].map(text),
      ),
      inside: li.getBoundingClientRect().right <= width + 1,
    }));
  }

  const SETTINGS_BASE = { __base: '--vscode-editor-background' };
  const PROVIDERS_TEXT = {
    ...SETTINGS_BASE,
    title: '.settings-title',
    subtitle: '.settings-subtitle',
    heading: '.settings-heading',
    cardTitle: '[data-provider="anthropic"] .step-title',
    cardLine: '[data-provider="anthropic"] .step-line',
    cardStatus: '.settings-providers .settings-toggle .step-status',
    tabOn: 'button.settings-tab[aria-selected="true"]',
    tabOff: 'button.settings-tab[aria-selected="false"]',
    search: 'input[type="search"]',
    refresh: '.settings-toolbar > button.secondary',
    remove: '[data-provider="anthropic"] button.secondary',
    footer: '.settings-footer .link-button',
  };
  const MCP_TEXT = {
    ...SETTINGS_BASE,
    title: '.settings-title',
    docsTitle: '[data-server="docs"] .step-title',
    docsStatus: '[data-server="docs"] .step-title .step-status',
    docsCounts: '[data-server="docs"] .step-line.step-status',
    resource: '[data-server="docs"] .settings-res-name',
    resourceKind: '[data-server="docs"] .settings-resources .step-status',
    brokenError: '[data-server="broken"] .settings-error',
    needsAuth: '[data-server="linear"] .step-line',
    offTitle: '[data-server="off"] .step-title',
    hint: '.settings-mcp > .settings-hint',
    tabOn: 'button.settings-tab[aria-selected="true"]',
    tabOff: 'button.settings-tab[aria-selected="false"]',
  };

  await step('35 OpenCode Settings tab: providers and MCP servers (E10-config-views)', async () => {
    const DARK = 'Default Dark Modern';
    const HC_LIGHT = 'Default High Contrast Light';
    const WIDTHS = [
      ['1080', 1080],
      ['620', 620],
      ['300', 300],
    ];
    const originalWidth = await sideBarPx();
    try {
      await closeAllEditors();
      if ((await visibleChatId()) === undefined) {
        await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
        await waitFor(async () => (await visibleChatId()) !== undefined, 10_000, 200);
      }
      await openChat(30_000);
      await waitConnected();
      const chatId = drivenChatId;

      await openSettingsTab();
      check(
        (await settingsTabCount()) === 1 &&
          (await settingsWeb.inDoc(
            (doc) => doc.querySelector('meta[name="open-vs-code-surface"]')?.content === 'settings',
          )),
        'OpenCode: Open Settings… opens ONE tab titled OpenCode Settings whose document says surface=settings',
      );
      const providersReady = await settingsWait(
        (doc) => doc.querySelectorAll('.settings-providers [data-provider]').length >= 3,
        null,
        20_000,
      );
      check(providersReady === true, 'the Providers tab lists the providers of the fixture');
      assertNoSettingsErrors('step 35 start');

      // MCP: the list fills ~300 ms after the fixture starts and the tab follows the events.
      check(
        await settingsClick('#settings-tab-mcp'),
        'the MCP servers tab is pressed with the mouse',
      );
      const mcpReady = await settingsWait(
        (doc) => doc.querySelectorAll('[data-server]').length === 4,
        null,
        20_000,
      );
      check(mcpReady === true, 'the MCP tab lists the four servers of the fixture');
      check(await settingsClick('#settings-tab-providers'), 'the Providers tab is pressed again');
      await settingsWait(
        (doc) => doc.querySelector('#settings-panel-providers')?.hidden === false,
        null,
        5_000,
      );

      // --- V1, V2, V3: three widths of the tab, four themes ----------------------------------
      for (const [label, target] of WIDTHS) {
        const measuredWidth = await fitSettingsTab(target);
        const ok = Math.abs(measuredWidth - target) <= 60;
        check(
          ok,
          `the Settings tab is ${String(measuredWidth)} px wide for the ${label} px cells (within 60 px of ${String(target)})`,
        );
        if (!ok) settingsUnverified.push(`width ${label}`);

        // Providers tab (V1), then MCP tab (V2), each in the four themes.
        for (const tab of ['providers', 'mcp']) {
          if (tab === 'mcp') {
            await setSettingsTheme(DARK);
            check(await settingsClick('#settings-tab-mcp'), `V2 ${label}: the MCP tab is pressed`);
            await settingsWait(
              (doc) => doc.querySelector('#settings-panel-mcp')?.hidden === false,
              null,
              5_000,
            );
          }
          for (const [themeName, theme] of PROBLEM_THEMES) {
            await setSettingsTheme(theme);
            const layout = await settingsWeb.inDoc(settingsLayout);
            if (tab === 'providers') {
              const shape = await settingsWeb.inDoc(providersShape);
              const contrast = contrastVerdict(
                await settingsWeb.inDoc(measureText, PROVIDERS_TEXT),
                Object.keys(PROVIDERS_TEXT).filter((name) => name !== '__base'),
              );
              const addCount = shape.addable.length;
              check(
                shape.headings.join('|') === 'Connected|Add a provider' &&
                  shape.connected.includes('anthropic') &&
                  shape.connected.includes('google-vertex') &&
                  !shape.connected.includes('azure') &&
                  shape.anthropic.includes('API key · saved by opencode for all projects') &&
                  shape.vertex.includes('From GOOGLE_APPLICATION_CREDENTIALS') &&
                  shape.anthropicRemove &&
                  !shape.vertexRemove &&
                  shape.placeholder === `Search ${String(addCount)} providers…` &&
                  shape.searchLabel === 'Search providers' &&
                  shape.passwordInputs === 0 &&
                  addCount >= 4 &&
                  layout.overflow <= 0 &&
                  layout.styled === 0 &&
                  contrast.ok,
                `V1 ${label} px, ${themeName}: Connected lists Anthropic (API key, Remove) and Google Vertex (From GOOGLE_APPLICATION_CREDENTIALS, no Remove), Add a provider has a search box and ${String(addCount)} providers, no password input, no sideways overflow (${String(layout.overflow)} px), no style attribute (${String(layout.styled)}), ${contrast.text}`,
              );
              if (theme === DARK) {
                check(
                  target >= 600
                    ? Math.abs((layout.columnWidth ?? 0) - 380) <= 1 &&
                        Math.abs(
                          (layout.columnLeft ?? 0) -
                            (layout.docWidth - (layout.columnWidth ?? 0)) / 2,
                        ) <= 12
                    : (layout.columnLeft ?? 99) <= 24 &&
                        layout.docWidth - ((layout.columnLeft ?? 0) + (layout.columnWidth ?? 0)) <=
                          24,
                  `V3 ${label} px: the column is ${String(Math.round(layout.columnWidth ?? 0))} px wide at x ${String(Math.round(layout.columnLeft ?? 0))} in a ${String(layout.docWidth)} px document (${target >= 600 ? 'centred, 380 px' : 'the whole width less 24 px of padding at most on each side'})`,
                );
                await shot(`35a-providers-${label}`);
              }
            } else {
              const servers = await settingsWeb.inDoc(mcpShape);
              const contrast = contrastVerdict(
                await settingsWeb.inDoc(measureText, MCP_TEXT),
                Object.keys(MCP_TEXT).filter((name) => name !== '__base'),
              );
              const by = (name) => servers.find((server) => server.name === name);
              const docs = by('docs');
              const broken = by('broken');
              const linear = by('linear');
              check(
                servers.map((server) => server.name).join(',') === 'docs,broken,off,linear' &&
                  docs?.title.includes('connected') &&
                  docs.lines.includes('2 resources · 1 template') &&
                  docs.lists.flat().includes('readme.md text/markdown') &&
                  docs.lists.flat().includes('api.md file:///docs/api.md') &&
                  docs.lists.flat().includes('files file:///docs/{path}') &&
                  broken?.title.includes('failed') &&
                  typeof broken.error === 'string' &&
                  broken.error.length <= 201 &&
                  broken.error.startsWith('Connection closed') &&
                  !/[\r\n]/.test(broken.error) &&
                  !broken.error.includes('second stderr line') &&
                  by('off')?.title.includes('disabled') &&
                  linear?.title.includes('needs sign-in') &&
                  linear.lines.includes('Sign in with the opencode CLI; this view is read-only.') &&
                  servers.every((server) => server.inside) &&
                  layout.overflow <= 0 &&
                  layout.styled === 0 &&
                  contrast.ok,
                `V2 ${label} px, ${themeName}: docs connected with 2 resources and 1 template, broken failed with the first line of its error (${String(broken?.error?.length)} chars, one line), off disabled, linear needs sign-in, nothing outside the document, no overflow (${String(layout.overflow)} px), no style attribute (${String(layout.styled)}), ${contrast.text}`,
              );
              if (theme === DARK) await shot(`35b-mcp-${label}`);
            }
          }
        }
        await setSettingsTheme(DARK);
        check(
          await settingsClick('#settings-tab-providers'),
          `${label}: back to the Providers tab`,
        );
        await settingsWait(
          (doc) => doc.querySelector('#settings-panel-providers')?.hidden === false,
          null,
          5_000,
        );
      }
      assertNoSettingsErrors('step 35 widths');

      // The search box filters the addable list (real keyboard, 620 px, dark).
      await fitSettingsTab(620);
      check(await settingsClick('input[type="search"]'), 'the search box is clicked');
      await page.keyboard.type('azu');
      const filtered = await settingsWait(
        (doc) =>
          [...doc.querySelectorAll('.settings-providers > ul:last-of-type [data-provider]')]
            .length === 1,
        null,
        5_000,
      );
      const filteredIds = await settingsWeb.inDoc((doc) =>
        [...doc.querySelectorAll('.settings-providers > ul:last-of-type [data-provider]')].map(
          (li) => li.dataset.provider,
        ),
      );
      await shot('35c-search');
      check(
        filtered === true && filteredIds.join(',') === 'azure',
        `V1 typing "azu" in the search box leaves one provider (${JSON.stringify(filteredIds)})`,
      );
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
      await settingsWait(
        (doc) =>
          doc.querySelectorAll('.settings-providers > ul:last-of-type [data-provider]').length > 1,
        null,
        5_000,
      );

      // --- V4: MCPFLIP in the stream updates the open tab, no reload --------------------------
      check(await settingsClick('#settings-tab-mcp'), 'V4: the MCP tab is pressed');
      await settingsWait(
        (doc) => doc.querySelector('#settings-panel-mcp')?.hidden === false,
        null,
        5_000,
      );
      await settingsWeb.inDoc((doc) => {
        doc.defaultView.__visualMark36 = 'still the same document';
      });
      await shot('35d-before-flip');
      await openChat(30_000, chatId);
      await send('MCPFLIP now');
      const flipped = await settingsWait(
        (doc) => {
          const broken = doc.querySelector('[data-server="broken"]');
          return (
            broken !== null &&
            broken.querySelector('.step-title')?.textContent.includes('connected') === true &&
            [...broken.querySelectorAll('.settings-resources li')].some((li) =>
              li.textContent.includes('status.md'),
            )
          );
        },
        null,
        20_000,
      );
      const sameDocument = await settingsWeb.inDoc(
        (doc) => doc.defaultView.__visualMark36 === 'still the same document',
      );
      await shot('35e-after-flip');
      check(
        flipped === true && sameDocument === true,
        `V4 after a prompt with MCPFLIP the open tab shows broken as connected with a status.md resource, in the same document (flipped ${String(flipped)}, same document ${String(sameDocument)})`,
      );
      check(await waitIdle(30_000), 'V4 the MCPFLIP turn ends');

      // --- V5: the server is down: the tab says so, offers Restart server, and recovers --------
      await send('CRASH the server now');
      const down = await settingsWait(
        (doc) => {
          const state = doc.querySelector('.connection-card')?.getAttribute('data-state');
          return state === 'unavailable' || state === 'stopped';
        },
        null,
        60_000,
      );
      for (const [label, target] of [
        ['620', 620],
        ['300', 300],
      ]) {
        const measuredWidth = await fitSettingsTab(target);
        for (const [themeName, theme] of [
          ['Dark Modern', DARK],
          ['High Contrast Light', HC_LIGHT],
        ]) {
          await setSettingsTheme(theme);
          const card = await settingsWeb.inDoc((doc) => ({
            title: doc.querySelector('.card-title')?.textContent.trim() ?? null,
            cause: doc.querySelector('.card-cause')?.textContent.trim() ?? null,
            buttons: [...doc.querySelectorAll('.connection-card button')].map((b) =>
              b.textContent.trim(),
            ),
            tabs: doc.querySelectorAll('.settings-tabs').length,
            providers: doc.querySelectorAll('[data-provider]').length,
            overflow: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
            styled: [...doc.querySelectorAll('#root, #root *, body')].filter(
              (el) => (el.getAttribute('style') ?? '').trim() !== '',
            ).length,
          }));
          const contrast = contrastVerdict(
            await settingsWeb.inDoc(measureText, {
              ...SETTINGS_BASE,
              title: '.card-title',
              cause: '.card-cause',
              restart: '.connection-card button.secondary',
              heading: '.settings-title',
            }),
            ['title', 'cause', 'restart', 'heading'],
          );
          check(
            down === true &&
              /not available|stopped/.test(card.title ?? '') &&
              card.cause === 'Providers and MCP servers show up once it is running.' &&
              card.buttons.includes('Restart server') &&
              card.tabs === 0 &&
              card.providers === 0 &&
              card.overflow <= 0 &&
              card.styled === 0 &&
              contrast.ok,
            `V5 ${label} px (${String(measuredWidth)}), ${themeName}: with the server down the tab says ${JSON.stringify(card.title)}, offers Restart server, shows no tabs or providers, no overflow, no style attribute, ${contrast.text}`,
          );
          if (theme === DARK) await shot(`35f-down-${label}`);
        }
      }
      await setSettingsTheme(DARK);
      fs.rmSync(vscode.downMarker, { force: true });
      check(
        await settingsClick('.connection-card button', 'Restart server'),
        'V5 Restart server is pressed in the tab',
      );
      const recovered = await settingsWait(
        (doc) =>
          doc.querySelector('.connection-card') === null &&
          doc.querySelectorAll('.settings-providers [data-provider]').length >= 3,
        null,
        60_000,
      );
      check(recovered === true, 'V5 Restart server in the tab brings the providers back');
      settingsUnverified.push(
        'V5 loading state (Loading… / Reading the MCP servers…) is transient',
      );
      assertNoSettingsErrors('step 35');
      assertNoWebviewErrors('step 35');
    } finally {
      fs.rmSync(vscode.downMarker, { force: true });
      await closeAllEditors().catch(() => undefined);
      settingsWeb?.close();
      settingsWeb = undefined;
      await setTheme(DARK).catch(() => undefined);
      await setSideBarWidth(Math.round(originalWidth)).catch(() => undefined);
    }
  });

  await step(
    '36 OpenCode Settings tab: sign-in, remove and secrecy (E10-config-views)',
    withSavedClipboard(async () => {
      const DARK = 'Default Dark Modern';
      const originalWidth = await sideBarPx();
      const quick = () =>
        page.evaluate(() => {
          const widget = globalThis.document.querySelector('.quick-input-widget');
          const visible = widget !== null && globalThis.getComputedStyle(widget).display !== 'none';
          const input = widget?.querySelector('input');
          return {
            visible,
            type: input?.type ?? null,
            title: widget?.querySelector('.quick-input-title')?.textContent?.trim() ?? '',
            focused: widget?.contains(globalThis.document.activeElement) ?? false,
            valueLength: input?.value.length ?? 0,
          };
        });
      const toastTexts = () =>
        page.locator('.notifications-toasts .notification-toast').allInnerTexts();
      const hostLog = () => {
        const files = [];
        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name === 'OpenCode.log') files.push(full);
          }
        };
        try {
          walk(path.join(vscode.userDataDir, 'logs'));
        } catch {
          return '';
        }
        return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
      };
      const readClipboard = () => powershellSta('Get-Clipboard').replace(/\r?\n$/, '');
      const setClipboard = (value) => {
        powershellSta(`Set-Clipboard -Value '${value}'`);
      };
      const cardState = (id) =>
        settingsWeb.inDoc((doc, providerId) => {
          const card = doc.querySelector(`[data-provider="${providerId}"]`);
          const lists = [...doc.querySelectorAll('.settings-providers > ul')];
          const inTop = card !== null && lists[0]?.contains(card) === true;
          const attempt = card?.querySelector('.settings-attempt');
          return {
            present: card !== null,
            inConnected:
              inTop && doc.querySelector('h2.settings-heading')?.textContent === 'Connected',
            expanded: card?.querySelector('.settings-methods') != null,
            phase: attempt?.getAttribute('data-phase') ?? null,
            lines: [...(card?.querySelectorAll('.step-line') ?? [])].map((p) =>
              p.textContent.replace(/\s+/g, ' ').trim(),
            ),
            buttons: [...(card?.querySelectorAll('.settings-attempt button') ?? [])].map((b) =>
              b.textContent.trim(),
            ),
            fields: [...(card?.querySelectorAll('[data-field]') ?? [])].map((f) => f.dataset.field),
            removeLabels: [...(card?.querySelectorAll('button') ?? [])]
              .map((b) => b.getAttribute('aria-label') ?? '')
              .filter((label) => label.startsWith('Remove')),
            focusedCard: card !== null && doc.activeElement === card,
          };
        }, id);
      const live = () =>
        settingsWeb.inDoc(
          (doc) => doc.querySelector('.visually-hidden[role="status"]')?.textContent ?? '',
        );
      const expand = async (id) => {
        if (!(await cardState(id)).expanded) {
          check(
            await settingsClick(`[data-provider="${id}"] button.settings-toggle`),
            `${id}: the card is opened with the mouse`,
          );
          await settingsWait(
            (doc, providerId) =>
              doc.querySelector(`[data-provider="${providerId}"] .settings-methods`) !== null,
            id,
            5_000,
          );
        }
      };
      const reloadWindow = async (mark) => {
        await page.evaluate((key) => {
          globalThis[key] = true;
        }, mark);
        await command('Developer: Reload Window');
        web?.close();
        settingsWeb?.close();
        settingsWeb = undefined;
        await browser.close().catch(() => undefined);
        let reloaded = false;
        for (let tries = 0; tries < 120 && !reloaded; tries++) {
          await connectWorkbench(90_000);
          const stale = await page
            .evaluate((key) => globalThis[key] === true, mark)
            .catch(() => true);
          reloaded = !stale;
          if (reloaded) break;
          await browser.close().catch(() => undefined);
          await rawSleep(250);
        }
        if (!reloaded) throw new Error('Reload Window did not produce a new workbench page');
        await waitFor(
          async () => (await page.locator('.monaco-workbench').count()) > 0,
          30_000,
          300,
        );
        drivenChatId = undefined;
      };

      try {
        await closeAllEditors();
        if ((await visibleChatId()) === undefined) {
          await page.locator('.activitybar [aria-label^="OpenCode"]').first().click();
          await waitFor(async () => (await visibleChatId()) !== undefined, 10_000, 200);
        }
        await openChat(30_000);
        await waitConnected();
        await openSettingsTab();
        await settingsWait(
          (doc) => doc.querySelectorAll('.settings-providers [data-provider]').length >= 3,
          null,
          20_000,
        );
        await fitSettingsTab(620);

        // --- V6: a card with a form (GitHub Copilot: deploymentType, enterpriseUrl only for Enterprise)
        await expand('github-copilot');
        const formBefore = await cardState('github-copilot');
        check(
          formBefore.expanded &&
            formBefore.fields.join(',') === 'deploymentType' &&
            formBefore.focusedCard,
          `V6 opening the GitHub Copilot card shows the deploymentType field only and puts the focus on the card (fields ${JSON.stringify(formBefore.fields)}, card focused ${String(formBefore.focusedCard)})`,
        );
        const selectInfo = await settingsWeb.inDoc((doc) => {
          const select = doc.querySelector('[data-provider="github-copilot"] select');
          return {
            options: [...(select?.options ?? [])].map((o) => o.textContent.trim()),
            value: select?.value ?? null,
            primary:
              doc
                .querySelector('[data-provider="github-copilot"] button.primary')
                ?.textContent.trim() ?? null,
          };
        });
        check(
          selectInfo.options.join('|') === 'GitHub.com|GitHub Enterprise' &&
            selectInfo.value === 'github.com' &&
            selectInfo.primary === 'Sign in…',
          `V6 the select offers GitHub.com and GitHub Enterprise with GitHub.com chosen, and the primary button reads Sign in… (${JSON.stringify(selectInfo)})`,
        );
        // Enterprise: a click on the label focuses the select without opening it; ArrowDown changes it.
        check(
          await settingsClick('[data-provider="github-copilot"] label.settings-label'),
          'V6 the Deployment type label is clicked',
        );
        await page.keyboard.press('ArrowDown');
        let enterprise = await settingsWait(
          (doc) =>
            doc.querySelector('[data-provider="github-copilot"] [data-field="enterpriseUrl"]') !==
            null,
          null,
          3_000,
        );
        if (enterprise === undefined) {
          // The key did not reach the select: set it the way the browser would and say so.
          await settingsWeb.inDoc((doc) => {
            const select = doc.querySelector('[data-provider="github-copilot"] select');
            select.value = 'enterprise';
            select.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
          });
          settingsUnverified.push('V6 the select was changed by script, not by the keyboard');
          enterprise = await settingsWait(
            (doc) =>
              doc.querySelector('[data-provider="github-copilot"] [data-field="enterpriseUrl"]') !==
              null,
            null,
            3_000,
          );
        }
        const formEnterprise = await cardState('github-copilot');
        await shot('36a-copilot-enterprise');
        check(
          enterprise === true && formEnterprise.fields.join(',') === 'deploymentType,enterpriseUrl',
          `V6 choosing GitHub Enterprise makes the Enterprise URL field appear (fields ${JSON.stringify(formEnterprise.fields)})`,
        );
        await page.keyboard.press('ArrowUp');
        const hidden = await settingsWait(
          (doc) =>
            doc.querySelector('[data-provider="github-copilot"] [data-field="enterpriseUrl"]') ===
            null,
          null,
          3_000,
        );
        check(hidden === true, 'V6 choosing GitHub.com again hides the Enterprise URL field');
        for (const [label, target] of [
          ['620', 620],
          ['300', 300],
        ]) {
          const measuredWidth = await fitSettingsTab(target);
          for (const [themeName, theme] of PROBLEM_THEMES) {
            await setSettingsTheme(theme);
            const layout = await settingsWeb.inDoc(settingsLayout);
            const contrast = contrastVerdict(
              await settingsWeb.inDoc(measureText, {
                ...SETTINGS_BASE,
                name: '[data-provider="github-copilot"] .step-title',
                summary: '[data-provider="github-copilot"] .step-status',
                label: '[data-provider="github-copilot"] .settings-label',
                hint: '[data-provider="github-copilot"] .settings-hint',
                select: '[data-provider="github-copilot"] select.settings-input',
                primary: '[data-provider="github-copilot"] button.primary',
                cancel: '[data-provider="github-copilot"] button.secondary',
              }),
              ['name', 'summary', 'label', 'hint', 'select', 'primary', 'cancel'],
            );
            check(
              layout.overflow <= 0 && layout.styled === 0 && contrast.ok,
              `V6 ${label} px (${String(measuredWidth)}), ${themeName}: the open Copilot card has no sideways overflow (${String(layout.overflow)} px), no style attribute (${String(layout.styled)}), ${contrast.text}`,
            );
            if (theme === DARK) await shot(`36b-copilot-form-${label}`);
          }
        }
        await setSettingsTheme(DARK);
        await fitSettingsTab(620);
        check(
          await settingsClick('[data-provider="github-copilot"] button.secondary', 'Cancel'),
          'V6 Cancel closes the Copilot card',
        );
        await settingsWait(
          (doc) => doc.querySelector('[data-provider="github-copilot"] .settings-methods') === null,
          null,
          5_000,
        );

        // --- V7 + W1: the API key goes into a masked native InputBox; Cancel in the card closes it
        await expand('azure');
        check(
          await settingsClick('[data-provider="azure"] [data-field="resourceName"] input'),
          'V7 the Resource name field is clicked',
        );
        await page.keyboard.type('my-resource');
        check(
          await settingsClick('[data-provider="azure"] button.primary', 'Enter API key…'),
          'V7 Enter API key… is pressed',
        );
        const boxUp = await waitFor(async () => (await quick()).visible, 8_000, 100);
        const typedFocus = await waitFor(async () => (await quick()).focused, 3_000, 50);
        const box = await quick();
        const noPasswordInWebview = await settingsWeb.inDoc(
          (doc) => doc.querySelectorAll('input[type="password"]').length === 0,
        );
        await shot('36c-key-inputbox');
        check(
          boxUp === true &&
            typedFocus === true &&
            box.type === 'password' &&
            box.title.includes('API key for Azure') &&
            noPasswordInWebview === true,
          `V7 Enter API key… opens a native InputBox titled ${JSON.stringify(box.title)} whose input is type=${String(box.type)} and has the focus, while the webview holds no password input`,
        );
        const during = await cardState('azure');
        check(
          during.inConnected &&
            during.buttons.includes('Cancel') &&
            during.lines.some((line) => line.includes('Starting sign-in')),
          `W1 while the box is open the Azure card shows "Starting sign-in…" with a Cancel button (buttons ${JSON.stringify(during.buttons)}, lines ${JSON.stringify(during.lines)})`,
        );
        check(
          await settingsClick('[data-provider="azure"] .settings-attempt button', 'Cancel'),
          'W1 Cancel is pressed in the card',
        );
        const closed = await waitFor(async () => !(await quick()).visible, 5_000, 100);
        const afterCancel = await cardState('azure');
        await shot('36d-key-cancelled');
        check(
          closed === true && afterCancel.phase === null && !afterCancel.inConnected,
          `W1 Cancel in the card closes the native InputBox (closed ${String(closed)}) and the card goes back to Add a provider (in Connected ${String(afterCancel.inConnected)}, phase ${String(afterCancel.phase)})`,
        );
        check(
          !hostLog().includes('provider connected: azure'),
          'W1 the host never logged "provider connected: azure" after the cancelled key box',
        );
        // Second try: the key is typed and entered.
        await expand('azure');
        const resourceKept = await settingsWeb.inDoc(
          (doc) =>
            doc.querySelector('[data-provider="azure"] [data-field="resourceName"] input')?.value ??
            null,
        );
        if (resourceKept === null || resourceKept === '') {
          check(
            await settingsClick('[data-provider="azure"] [data-field="resourceName"] input'),
            'V7 the Resource name field is clicked again',
          );
          await page.keyboard.type('my-resource');
        }
        check(
          await settingsClick('[data-provider="azure"] button.primary', 'Enter API key…'),
          'V7 Enter API key… is pressed again',
        );
        const boxAgain = await waitFor(async () => (await quick()).visible, 8_000, 100);
        check(boxAgain === true, 'V7 the native box is shown again');
        check(
          await typeInQuickInput(
            page.locator('.quick-input-widget input').first(),
            SETTINGS_FAKE_KEY,
          ),
          'V7 the fake key is typed into the native box',
        );
        const masked = await quick();
        check(
          masked.focused,
          'V7 the native box still has the focus after the card moved to Connected (the webview card did not take it back)',
        );
        check(
          masked.type === 'password' && masked.valueLength === SETTINGS_FAKE_KEY.length,
          `V7 the box holds ${String(masked.valueLength)} characters in a type=${String(masked.type)} input (the DOM of the page is read for the type and the length only)`,
        );
        await page.keyboard.press('Enter');
        const connected = await settingsWait(
          (doc) => {
            const card = doc.querySelector('[data-provider="azure"]');
            const first = doc.querySelector('.settings-providers > ul');
            return (
              card !== null &&
              first?.contains(card) === true &&
              card.querySelector('.settings-attempt') === null
            );
          },
          null,
          15_000,
        );
        const azure = await cardState('azure');
        const announced = await live();
        await shot('36e-azure-connected');
        check(
          connected === true &&
            azure.lines.includes('API key · saved by opencode for all projects') &&
            azure.removeLabels.some((label) => label.startsWith('Remove Azure')) &&
            announced.includes('Connected to Azure'),
          `V7 pressing Enter connects Azure: it moves to Connected with "API key · saved by opencode for all projects" and a Remove button, and the live region says ${JSON.stringify(announced.trim())}`,
        );

        // --- V9: Remove asks in a native modal; declining keeps it; confirming removes it -------
        const dialog = page.locator('.monaco-dialog-box');
        check(
          await settingsClick('[data-provider="azure"] button[aria-label^="Remove Azure"]'),
          'V9 Remove is pressed on the Azure card',
        );
        const modalText = await waitFor(
          async () => ((await dialog.count()) ? await dialog.first().innerText() : null),
          8_000,
          150,
        );
        await shot('36f-remove-modal');
        check(
          typeof modalText === 'string' &&
            modalText.includes('Azure') &&
            /stores it for all your projects/.test(modalText),
          `V9 Remove opens a VS Code modal that names Azure and says opencode stores it for all projects (${JSON.stringify(String(modalText).replace(/\s+/g, ' ').slice(0, 160))})`,
        );
        await page.keyboard.press('Escape');
        await waitFor(async () => (await dialog.count()) === 0, 5_000, 100);
        await rawSleep(500); // a declined dialog changes nothing, so there is no positive signal to wait on
        const declined = await cardState('azure');
        check(
          declined.inConnected && declined.removeLabels.length === 1,
          'V9 declining the modal (Escape) keeps Azure connected with its Remove button',
        );
        check(
          await settingsClick('[data-provider="azure"] button[aria-label^="Remove Azure"]'),
          'V9 Remove is pressed again',
        );
        await waitFor(async () => (await dialog.count()) > 0, 8_000, 150);
        await dialog
          .first()
          .getByRole('button', { name: /^Remove$/ })
          .click({ timeout: 5_000 });
        const gone = await settingsWait(
          (doc) => {
            const card = doc.querySelector('[data-provider="azure"]');
            const first = doc.querySelector('.settings-providers > ul');
            return card !== null && first?.contains(card) !== true;
          },
          null,
          10_000,
        );
        const removed = await cardState('azure');
        await shot('36g-azure-removed');
        check(
          gone === true && removed.removeLabels.length === 0,
          `V9 confirming the modal removes the credential: Azure is back in Add a provider with no Remove button (in Connected ${String(removed.inConnected)})`,
        );

        // --- V8: OAuth auto: the card waits, the notification has the instructions, Copy code, Cancel
        await expand('github-copilot');
        check(
          await settingsClick('[data-provider="github-copilot"] button.primary', 'Sign in…'),
          'V8 Sign in… is pressed on the Copilot card',
        );
        const waiting = await settingsWait(
          (doc) =>
            doc
              .querySelector('[data-provider="github-copilot"] .settings-attempt')
              ?.getAttribute('data-phase') === 'waiting',
          null,
          15_000,
        );
        const toastUp = await waitFor(
          async () => (await toastTexts()).find((text) => text.includes('ABCD-1234')),
          10_000,
          200,
        );
        const copilot = await cardState('github-copilot');
        const toast = page.locator('.notifications-toasts .notification-toast', {
          hasText: 'ABCD-1234',
        });
        const toastParts = await toast
          .first()
          .evaluate((node) => ({
            text: node.innerText.replace(/\s+/g, ' ').trim(),
            links: [...node.querySelectorAll('a')].map((a) => a.textContent.trim()),
            buttons: [...node.querySelectorAll('.monaco-button, .monaco-text-button')].map((b) =>
              b.textContent.trim(),
            ),
          }))
          .catch(() => ({ text: '', links: [], buttons: [] }));
        await shot('36h-oauth-waiting');
        check(
          waiting === true &&
            copilot.inConnected &&
            copilot.lines.some((line) => line.includes('Enter code: ABCD-1234')) &&
            copilot.buttons.join('|') === 'Copy code|Cancel',
          `V8 the card waits: it shows "Enter code: ABCD-1234" with the buttons Copy code and Cancel (lines ${JSON.stringify(copilot.lines)}, buttons ${JSON.stringify(copilot.buttons)})`,
        );
        check(
          toastUp !== undefined &&
            toastParts.text.includes('Enter code: ABCD-1234') &&
            toastParts.links.includes('Copy code') &&
            toastParts.buttons.includes('Cancel'),
          `V8 the native notification shows the instructions, a "Copy code" link and a Cancel button (${JSON.stringify(toastParts)})`,
        );
        // Copy code, from the card and from the notification.
        setClipboard('sentinel-before-card');
        check(
          await settingsClick(
            '[data-provider="github-copilot"] .settings-attempt button',
            'Copy code',
          ),
          'V8 Copy code is pressed in the card',
        );
        const fromCard = await waitFor(async () => readClipboard() === 'ABCD-1234', 5_000, 200);
        check(
          fromCard === true,
          `V8 Copy code in the card puts ABCD-1234 on the clipboard (clipboard ${JSON.stringify(readClipboard())})`,
        );
        setClipboard('sentinel-before-toast');
        await toast
          .first()
          .locator('a', { hasText: 'Copy code' })
          .first()
          .click({ timeout: 5_000 });
        const fromToast = await waitFor(async () => readClipboard() === 'ABCD-1234', 5_000, 200);
        check(
          fromToast === true,
          `V8 the Copy code link of the notification puts ABCD-1234 on the clipboard (clipboard ${JSON.stringify(readClipboard())})`,
        );
        // The card in four themes and two widths while the attempt waits.
        for (const [label, target] of [
          ['620', 620],
          ['300', 300],
        ]) {
          const measuredWidth = await fitSettingsTab(target);
          for (const [themeName, theme] of PROBLEM_THEMES) {
            await setSettingsTheme(theme);
            const layout = await settingsWeb.inDoc(settingsLayout);
            const contrast = contrastVerdict(
              await settingsWeb.inDoc(measureText, {
                ...SETTINGS_BASE,
                name: '[data-provider="github-copilot"] .step-title',
                instructions: '[data-provider="github-copilot"] .settings-attempt .step-line',
                copy: '[data-provider="github-copilot"] .settings-attempt button.secondary',
                heading: '.settings-heading',
              }),
              ['name', 'instructions', 'copy', 'heading'],
            );
            check(
              layout.overflow <= 0 && layout.styled === 0 && contrast.ok,
              `V8 ${label} px (${String(measuredWidth)}), ${themeName}: the waiting card has no sideways overflow (${String(layout.overflow)} px), no style attribute (${String(layout.styled)}), ${contrast.text}`,
            );
            if (theme === DARK) await shot(`36i-waiting-${label}`);
          }
        }
        await setSettingsTheme(DARK);
        await fitSettingsTab(620);
        // Cancel from the notification.
        await toast
          .first()
          .locator('.monaco-button', { hasText: 'Cancel' })
          .first()
          .click({ timeout: 5_000 });
        const cancelledByToast = await settingsWait(
          (doc) => {
            const card = doc.querySelector('[data-provider="github-copilot"]');
            const first = doc.querySelector('.settings-providers > ul');
            return (
              card !== null &&
              card.querySelector('.settings-attempt') === null &&
              first?.contains(card) !== true
            );
          },
          null,
          10_000,
        );
        const toastGone = await waitFor(
          async () => !(await toastTexts()).some((text) => text.includes('ABCD-1234')),
          8_000,
          200,
        );
        check(
          cancelledByToast === true && toastGone === true,
          `V8 Cancel in the notification ends the attempt: the card is back in Add a provider (${String(cancelledByToast)}) and the notification is gone (${String(toastGone)})`,
        );
        // Cancel from the card.
        await expand('github-copilot');
        check(
          await settingsClick('[data-provider="github-copilot"] button.primary', 'Sign in…'),
          'V8 Sign in… is pressed again',
        );
        await settingsWait(
          (doc) =>
            doc
              .querySelector('[data-provider="github-copilot"] .settings-attempt')
              ?.getAttribute('data-phase') === 'waiting',
          null,
          15_000,
        );
        check(
          await settingsClick(
            '[data-provider="github-copilot"] .settings-attempt button',
            'Cancel',
          ),
          'V8 Cancel is pressed in the card',
        );
        const cancelledByCard = await settingsWait(
          (doc) => doc.querySelector('[data-provider="github-copilot"] .settings-attempt') === null,
          null,
          10_000,
        );
        const toastGone2 = await waitFor(
          async () => !(await toastTexts()).some((text) => text.includes('ABCD-1234')),
          8_000,
          200,
        );
        check(
          cancelledByCard === true && toastGone2 === true,
          `V8 Cancel in the card ends the attempt too and the notification goes (${String(cancelledByCard)}, ${String(toastGone2)})`,
        );
        const focusAfter = await cardState('github-copilot');
        check(
          focusAfter.present && focusAfter.focusedCard,
          `W2 after the attempt the focus is on the Copilot card, not on the body (card focused ${String(focusAfter.focusedCard)})`,
        );
        // "Connected": OpenAI's browser method is approved by the fake browser at once.
        await expand('openai');
        check(
          await settingsClick(
            '[data-provider="openai"] [data-method="oauth"] button.primary',
            'Sign in…',
          ),
          'V8 Sign in… is pressed on the OpenAI card',
        );
        const openaiConnected = await settingsWait(
          (doc) => {
            const card = doc.querySelector('[data-provider="openai"]');
            const first = doc.querySelector('.settings-providers > ul');
            return (
              card !== null &&
              first?.contains(card) === true &&
              card.querySelector('.settings-attempt') === null &&
              card.textContent.includes('Signed in')
            );
          },
          null,
          20_000,
        );
        const announcedOpenai = await live();
        await shot('36j-openai-connected');
        check(
          openaiConnected === true && announcedOpenai.includes('Connected to OpenAI'),
          `V8 an approved OAuth login ends in Connected: OpenAI shows "Signed in · saved by opencode…" and the live region says ${JSON.stringify(announcedOpenai.trim())}`,
        );
        assertNoSettingsErrors('step 36 flows');

        // --- V10: the fake key is nowhere ---------------------------------------------------------
        check(
          await settingsClick('input[type="search"]'),
          'V10 control: the search box is clicked',
        );
        await page.keyboard.type('control-marker-0136');
        let list = [];
        try {
          list = await (await fetch(`http://127.0.0.1:${String(vscode.port)}/json`)).json();
        } catch {
          list = [];
        }
        const scanned = [];
        const hits = [];
        let controlSeen = false;
        for (const entry of list) {
          if (entry.type !== 'iframe' || !entry.url.includes('extensionId=sergwei.open-vs-code'))
            continue;
          const id = /[?&]id=([^&]+)/.exec(entry.url)?.[1];
          const handle =
            id === undefined
              ? undefined
              : await openWebview(vscode.port, [], 5_000, id).catch(() => undefined);
          if (handle === undefined) {
            scanned.push(`${String(id)}:unreadable`);
            continue;
          }
          const result = await handle
            .inDoc(
              (doc, keys) => ({
                html: doc.documentElement.outerHTML.includes(keys.secret),
                values: [...doc.querySelectorAll('input,textarea,select')].some((element) =>
                  element.value.includes(keys.secret),
                ),
                control: [...doc.querySelectorAll('input')].some((element) =>
                  element.value.includes(keys.control),
                ),
                surface: doc.querySelector('meta[name="open-vs-code-surface"]')?.content ?? '?',
              }),
              { secret: SETTINGS_FAKE_KEY, control: 'control-marker-0136' },
            )
            .catch(() => undefined);
          handle.close();
          if (result === undefined) {
            scanned.push(`${String(id)}:unreadable`);
            continue;
          }
          scanned.push(result.surface);
          if (result.html || result.values) hits.push(result.surface);
          if (result.control) controlSeen = true;
        }
        const workbenchHas = await page.evaluate(
          (key) => globalThis.document.documentElement.outerHTML.includes(key),
          SETTINGS_FAKE_KEY,
        );
        const log = hostLog();
        const stateFile = fs.existsSync(vscode.stateFile)
          ? fs.readFileSync(vscode.stateFile, 'utf8')
          : '';
        check(
          controlSeen &&
            scanned.length >= 2 &&
            !scanned.some((entry) => entry.endsWith('unreadable')) &&
            hits.length === 0 &&
            !workbenchHas,
          `V10 the fake key is in no webview target (scanned ${JSON.stringify(scanned)}, hits ${JSON.stringify(hits)}; the control marker typed in the search box was found: ${String(controlSeen)}) and not in the workbench DOM`,
        );
        check(
          log.includes('provider connected: azure (key)') &&
            !log.includes(SETTINGS_FAKE_KEY) &&
            !stateFile.includes(SETTINGS_FAKE_KEY) &&
            !settingsLogs.some((line) => line.includes(SETTINGS_FAKE_KEY)) &&
            !webviewLogs.some((line) => line.includes(SETTINGS_FAKE_KEY)),
          'V10 OpenCode.log (which does say "provider connected: azure (key)"), the fixture state file and the console of both webviews do not contain the fake key',
        );
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('Backspace');

        // --- Reload Window: does the tab come back without a serializer? -------------------------
        check((await settingsTabCount()) === 1, 'the Settings tab is open before Reload Window');
        await reloadWindow('__visualPreReload36');
        const tabsAfter = await waitFor(async () => (await settingsTabCount()) >= 1, 15_000, 300);
        let afterReload;
        if (tabsAfter !== undefined) {
          await connectSettings(30_000).catch(() => undefined);
          afterReload = settingsWeb
            ? await settingsWeb
                .inDoc((doc) => ({
                  rootChildren: doc.querySelector('#root')?.childElementCount ?? 0,
                  title: doc.querySelector('.settings-title')?.textContent ?? null,
                }))
                .catch(() => undefined)
            : undefined;
        }
        await shot('36k-after-reload');
        console.log(
          `  observed after Reload Window: tabs titled OpenCode Settings ${String(tabsAfter === undefined ? 0 : await settingsTabCount())}, document ${JSON.stringify(afterReload ?? null)}`,
        );
        check(
          tabsAfter === undefined ||
            (afterReload !== undefined && afterReload.title === 'OpenCode settings'),
          `Reload Window leaves either no Settings tab or one that shows the settings UI (tab ${String(tabsAfter !== undefined)}, document ${JSON.stringify(afterReload ?? null)})`,
        );
        await openChat(30_000);
        if (settingsUnverified.length > 0) {
          console.log(`  UNVERIFIED cells of steps 35-36: ${settingsUnverified.join('; ')}`);
        }
        assertNoSettingsErrors('step 36');
        assertNoWebviewErrors('step 36');
      } finally {
        await closeAllEditors().catch(() => undefined);
        settingsWeb?.close();
        settingsWeb = undefined;
        await setTheme(DARK).catch(() => undefined);
        await setSideBarWidth(Math.round(originalWidth)).catch(() => undefined);
      }
    }),
  );
} catch (error) {
  // Before the first step: the run could not start (exit 2). Later: an unexpected failure.
  if (!started) startupError = error;
  else failures.push(`unexpected error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await cleanup();
}

if (startupError !== undefined) {
  console.error(
    `test:visual could not start: ${startupError instanceof Error ? startupError.message : String(startupError)}`,
  );
  process.exit(2);
}

// The fixture keeps the conversation in a state file (the run's Restart Server and Reload Window
// depend on it): it must exist and hold the sessions of the run. It also proves the server that
// answered was the fixture, not some opencode found on the PATH. Judged only if a selected step
// sends a prompt: a filtered run of steps that never do (0, 1, 21, 23) leaves no session to find.
// Nor after the run stopped early (`--bail`, or a stuck webview, `bailedAt`): the steps that send
// may never have run (seen on 28/10/2026, a run stopped at step 1 failed this check too).
if (bailedAt === undefined && (selection === undefined || selection.sendsPrompt)) {
  check(
    fs.existsSync(vscode.stateFile) &&
      (JSON.parse(fs.readFileSync(vscode.stateFile, 'utf8')).sessions?.length ?? 0) > 0,
    'the synthetic opencode kept the conversation of the run in its state file',
  );
}

// Silent guard (it prints no `ok`, so the count of a full run does not change): a full run must
// have executed exactly the ids of the catalogue, once and in order, or a step was renamed or
// dropped without `steps.mjs` following.
if (
  selection === undefined &&
  bailedAt === undefined &&
  executedIds.join(',') !== STEP_IDS.join(',')
) {
  failures.push(
    `the full run executed steps [${executedIds.join(', ')}] but the catalogue has [${STEP_IDS.join(', ')}]`,
  );
}

/** Sum of `key` over `items`. */
const sumOf = (items, key) => items.reduce((total, item) => total + item[key], 0);

/** Text of a trace field made safe for one TSV cell (tabs and line breaks become spaces). */
const tsvCell = (value) => String(value).replace(/[\t\r\n]+/g, ' ');

/**
 * Writes every trace record to `trace-full-<stamp>.tsv` (or `trace-partial-<stamp>.tsv` for a
 * filtered or bailing run, like the screenshots) in the work folder, and returns the path relative
 * to the repo, or the error text if the write failed (a failed write never changes the verdict).
 * The stamp is the local time of the write as `YYYYMMDD-HHMMSS`, so a run never overwrites the
 * trace of an earlier one (the trace of a failed run was lost that way on 30/10/2026).
 *
 * Columns: `kind` (expired, floor, sleep, pause, gap), `step`, `ms` (spent, paid, asked or gap),
 * `cap_ms` (expired only), `at_ms` (gap: ms since the step started), `line` (`run.mjs:L`, not for
 * gaps) and `text` (gap: the check that closes it). VERIFIED on the full run of 30/10/2026 23:07
 * (Windows 11): its trace file opened with the header row "kind step ms cap_ms at_ms line text".
 */
function writeTrace() {
  const rows = [['kind', 'step', 'ms', 'cap_ms', 'at_ms', 'line', 'text']];
  for (const e of trace.expired) rows.push(['expired', e.step, e.spentMs, e.capMs, '', e.line, '']);
  for (const f of trace.floors) rows.push(['floor', f.step, f.paidMs, '', '', f.line, '']);
  for (const s of trace.sleeps) rows.push(['sleep', s.step, s.ms, '', '', s.line, '']);
  for (const p of trace.pauses) rows.push(['pause', p.step, p.ms, '', '', p.line, '']);
  for (const g of trace.gaps) rows.push(['gap', g.step, g.gapMs, '', g.atMs, '', g.text]);
  const now = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const stamp = `${String(now.getFullYear())}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  const file = path.join(workDir, `${scratchOutput ? 'trace-partial' : 'trace-full'}-${stamp}.tsv`);
  try {
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(file, rows.map((row) => row.map(tsvCell).join('\t')).join('\n') + '\n');
    return path.relative(repoRoot, file);
  } catch (error) {
    return `not written: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Prints the `== waits` section: the 20 most expensive expired `waitFor`s, the `waitIdle` floors,
 * the fixed waits per step and the 20 longest gaps between consecutive checks.
 *
 * It follows `== timings` and no line starts with ok/FAIL/warn, so `compare-runs` ignores it
 * (`extractChecks` closes on `== waits` as well). Nothing here is a verdict: an expired wait is
 * still judged by the check after it (#89). VERIFIED on the full run of 30/10/2026 (Windows 11):
 * it printed "== waits" with the expired waits (9 calls, 14.3 s) and the waitIdle floors.
 */
function printWaits() {
  const seconds = (ms) => (ms / 1000).toFixed(1);
  console.log('\n== waits');
  console.log(
    `  expired waitFor: ${String(trace.expired.length)} calls, ${seconds(sumOf(trace.expired, 'spentMs'))} s in total (an expired wait does not fail by itself)`,
  );
  for (const e of [...trace.expired].sort((a, b) => b.spentMs - a.spentMs).slice(0, 20)) {
    console.log(
      `  expired step ${e.step} cap ${String(e.capMs)} ms spent ${String(e.spentMs)} ms at ${e.line}`,
    );
  }
  console.log(
    `  waitIdle floors: ${String(trace.floors.length)} calls never saw Stop, ${seconds(sumOf(trace.floors, 'paidMs'))} s in total`,
  );
  const stepIds = [...new Set([...executedIds, '-'])];
  console.log('  fixed waits per step (ms): sleep / waitForTimeout / waitIdle floor');
  for (const id of stepIds) {
    const stepTotal = (items, key) =>
      sumOf(
        items.filter((item) => item.step === id),
        key,
      );
    const cells = [
      stepTotal(trace.sleeps, 'ms'),
      stepTotal(trace.pauses, 'ms'),
      stepTotal(trace.floors, 'paidMs'),
    ];
    if (cells.every((cell) => cell === 0)) continue;
    console.log(
      `  step ${id.padEnd(3)} ${cells.map((cell) => String(cell).padStart(7)).join(' ')}`,
    );
  }
  console.log(
    `  fixed waits in total (ms): ${String(sumOf(trace.sleeps, 'ms'))} / ${String(sumOf(trace.pauses, 'ms'))} / ${String(sumOf(trace.floors, 'paidMs'))}`,
  );
  console.log('  longest gaps between consecutive checks:');
  for (const g of [...trace.gaps].sort((a, b) => b.gapMs - a.gapMs).slice(0, 20)) {
    console.log(
      `  gap ${String(g.gapMs)} ms step ${g.step} at ${String(g.atMs)} ms before: ${g.text.slice(0, 110)}`,
    );
  }
  console.log(`  trace: ${writeTrace()}`);
}

console.log('\n== summary');
console.log(`screenshots (${String(shots.length)}):`);
for (const file of shots) console.log(`  ${file}`);
console.log('\n== timings');
for (const { id, name, seconds } of timings) {
  console.log(
    `  ${id.padEnd(3)} ${seconds.toFixed(1).padStart(6)} s  ${name.slice(id.length).trim()}${budgetNote(id, seconds)}`,
  );
}
console.log(
  `  total ${((performance.now() - vscodeStartedAt) / 1000).toFixed(1)} s since VS Code was started`,
);
printWaits();
if (stoppedLine !== undefined) console.log(`stopped early: ${stoppedLine}`);
if (warnings.length) {
  console.log(`warnings (${String(warnings.length)}):`);
  for (const message of warnings) console.log(`  - ${message}`);
}
if (failures.length) {
  console.log(`FAILED (${String(failures.length)}):`);
  for (const message of failures) console.log(`  - ${message}`);
  process.exit(1);
}
console.log('all visual checks passed');
