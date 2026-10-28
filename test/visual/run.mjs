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
// Without the flag too, the run stops after a step that left the chat webview stuck (a CDP call
// timed out): the later steps would only fail in cascade (issue #93, see `step`).
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
import { WEBVIEW_STUCK, openWebview } from './webviewCdp.mjs';
import {
  STEP_IDS,
  parseAllThemesArg,
  parseBailArg,
  parseStepsArg,
  resolveSelection,
  stepIdOf,
} from './steps.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const workDir = path.join(repoRoot, '.vscode-test', 'visual');

// `--steps` filter (see the header). Read before anything is created, so a typo costs nothing.
const parsedSteps = parseStepsArg(process.argv.slice(2));
if (parsedSteps.error !== undefined) {
  console.error(`test:visual: ${parsedSteps.error}`);
  process.exit(2);
}
/** `undefined` for the full run, else the requested ids closed over their prerequisites. */
const selection = parsedSteps.ids === undefined ? undefined : resolveSelection(parsedSteps.ids);
const partial = selection !== undefined;
/** `--all-themes`: the screenshot-only theme loops capture in four themes instead of dark only. */
const allThemes = parseAllThemesArg(process.argv.slice(2));
/** `--bail`: stop after the first step that fails (for development; see `parseBailArg`). */
const bail = parseBailArg(process.argv.slice(2));
const selectedIds = new Set(selection?.selected ?? STEP_IDS);
if (partial) {
  console.log(`PARTIAL RUN (steps ${selection.selected.join(', ')}): not evidence for a commit`);
  if (selection.added.length > 0) {
    console.log(
      `steps added because the requested ones need them: ${selection.added.join(', ')} (requested: ${parsedSteps.ids.join(', ')})`,
    );
  }
}
if (bail)
  console.log('--bail: the run stops after the first step that fails; not evidence for a commit');
// A filtered or bailing run never touches the folders of the full run.
const scratchOutput = partial || bail;
const shotsDir = path.join(workDir, scratchOutput ? 'shots-partial' : 'shots');

const failures = [];
const warnings = [];
const shots = [];
/** Lines the webview logged (CSP violations, console, exceptions), across every connection. */
const webviewLogs = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
 */
function check(ok, message) {
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
 */
async function waitFor(fn, ms, intervalMs = 150) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let value;
    try {
      value = await fn();
    } catch {
      value = undefined;
    }
    if (value) return value;
    await sleep(intervalMs);
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

/** Connects Playwright to the workbench, waiting for the debugging endpoint to come up. */
async function connectWorkbench(timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try {
      const connected = await chromium.connectOverCDP(`http://127.0.0.1:${String(vscode.port)}`);
      const pages = connected.contexts().flatMap((context) => context.pages());
      const workbench = pages.find((candidate) => candidate.url().includes('workbench'));
      if (workbench) {
        browser = connected;
        page = workbench;
        boundKeyPresses(page);
        return;
      }
      await connected.close().catch(() => undefined);
    } catch (error) {
      lastError = error;
    }
    await sleep(500); // retry interval of the connection attempts, not a wait for a condition
  }
  throw new Error(`could not connect to VS Code over CDP: ${String(lastError)}`);
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
  const frame = await page
    .locator('iframe.webview.ready')
    .first()
    .boundingBox({ timeout: 5_000 })
    .catch(() => null);
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

/** (Re)opens the CDP connection to the webview target, replacing the previous one. */
async function openChat(timeoutMs = 30_000) {
  web?.close();
  web = await openWebview(vscode.port, webviewLogs, timeoutMs);
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
 * "Do&&n't Save" in `nls.messages.json`, the mnemonic is not drawn. HYPOTHESIS: the dialog is the
 * in-DOM `.monaco-dialog-box` (custom dialog style, `vscodeProcess.mjs`), as Sergio's screenshot
 * shows; the path that presses the button was not run on purpose yet.
 */
async function closeAllEditors() {
  await command('View: Close All Editors');
  const dontSave = page.locator('.monaco-dialog-box button', { hasText: /Don.t Save/ });
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
  const frame = await page.locator('iframe.webview.ready').first().boundingBox();
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
  const frame = await page.locator('iframe.webview.ready').first().boundingBox();
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
    const frame = await page.locator('iframe.webview.ready').first().boundingBox();
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
 */
async function send(text) {
  await focusPromptBox();
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
 */
async function waitIdle(ms = 150_000) {
  await waitFor(isBusy, 2_000, 100);
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

/**
 * Runs a step; an exception becomes a failure plus a screenshot, and the run continues.
 *
 * The id is the first token of `name` (`stepIdOf`), already unique across the 25 calls. A step
 * whose id is not in the selection returns at once without printing anything, so the call sites
 * are the same in a full and in a filtered run. It prints `  time N.N s` when the body ends (also
 * when it throws) and records it for `== timings`; that line is not an ok/FAIL/warn line. Measured
 * with `performance.now()`, so it includes the settling sleeps of the body, which is the point.
 *
 * Under `--bail` the first step that fails (a FAIL check, which ends the body with `BailStop`, or
 * an exception) takes its FAIL screenshot and stops the run: the later steps return at once, as an
 * unselected one does, and the run goes to its cleanup and summary (exit 1).
 *
 * With or without `--bail`, a step after which the chat webview connection is stuck (one CDP call
 * timed out, `stuckReason` in `webviewCdp.mjs`) stops the run the same way and records why. Issue
 * #93: once the webview stopped answering, nearly every later step failed in cascade and the full
 * run took 707.7 s instead of about 240 (28/10/2026); the later steps prove nothing then. VERIFIED on
 * Windows 11, VS Code 1.143.1 (28/10/2026) by mutation, an `inDoc` that never resolves added to
 * step 1, `--steps 2`: the run printed "the webview is stuck (CDP Runtime.evaluate timed out after
 * 20000 ms): stopping after step 1; the remaining steps are skipped" and ended in 27 s with exit 1.
 * NOT observed: a real stuck webview (the cascade was not reproduced: 300 sash drags, 200 theme
 * switches and 150 rounds with the server down, in isolation, were all clean), nor the path where
 * `openChat` itself gets stuck.
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
  }
  const seconds = (performance.now() - startedAt) / 1000;
  timings.push({ id, name, seconds });
  console.log(`  time ${seconds.toFixed(1)} s`);
  const stuck = web?.stuckReason() ?? stuckInException;
  if (stuck !== undefined) {
    bailedAt = id;
    failures.push(`${name}: the remaining steps were skipped, the webview is stuck (#93)`);
    console.log(
      `  the webview is stuck (${stuck}): stopping after step ${id}; the remaining steps are skipped`,
    );
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
  const base =
    parse(root.getPropertyValue('--vscode-sideBar-background')) ??
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
  return Object.fromEntries(Object.entries(selectors).map(([name, sel]) => [name, measure(sel)]));
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
    check(!state.panel && state.expanded === 'false', 'choosing a model closes the panel');
    check(
      state.model === chosen.name,
      `the chip shows the chosen model ("${state.trigger}" for "${chosen.name}")`,
    );
    check(
      state.focus.cls.includes('agent-model-chip'),
      `the focus returns to the chip (${JSON.stringify(state.focus)})`,
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
    await waitPresent('.agent-model-panel', false);
    state = await ui();
    check(
      !state.panel && state.agent === 'Plan' && state.focus.cls.includes('agent-model-chip'),
      `choosing an agent closes the panel, the chip reads Plan and the focus returns ("${state.trigger}")`,
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
      !state.panel &&
        state.agent === 'Build' &&
        kept === 'keep this text' &&
        blocks === before &&
        !(await isBusy()),
      `Enter on an agent row picks it and does NOT send the prompt ("${kept}", agent "${state.agent}")`,
    );
    // Back to Plan with the keyboard only: Enter, ArrowDown, Enter.
    await press('Enter');
    await press('ArrowDown');
    await press('Enter');
    state = await ui();
    check(
      state.agent === 'Plan' && state.focus.cls.includes('agent-model-chip'),
      `the keyboard alone picked Plan again ("${state.trigger}")`,
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
  // Windows 11, VS Code 1.143.1) passed.
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
    /** Opens the chip's panel with the real mouse and presses model `id`; false if not listed. */
    const pickModel = async (id) => {
      if (!(await clickIn('button.agent-model-chip'))) return false;
      await waitPresent('.agent-model-panel');
      const pressed = await clickIn(`.agent-model-panel button.model-option[data-model="${id}"]`);
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
    await waitPresent('.agent-model-panel', false);
    state = await ui();
    check(
      !state.panel && state.level === String(variant),
      `choosing closes the panel and the chip ends in "· ${String(variant)}" ("${state.level}")`,
    );
    check(
      state.focus.cls.includes('agent-model-chip'),
      `the focus returns to the chip (${JSON.stringify(state.focus)})`,
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
      check(await clickIn('button.agent-model-chip'), 'the chip is pressed again');
      await waitPresent('.agent-model-panel');
      check(
        await clickIn(`.menu-reasoning button[data-variant="${String(variant)}"]`),
        `the variant "${String(variant)}" is chosen again`,
      );
      await waitPresent('.agent-model-panel', false);
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
    const clearBox = async () => {
      await focusPromptBox();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
      await sleep(200); // same pause as in `send`: the emptied textarea re-renders
    };
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
  // and contrast in the four themes. A compaction has no UI before issue #34 and stays covered by
  // the Vitest e2e. Self-contained: it makes its own sessions.
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
   * Step 21 (issue #38): how the Settings editor of a real VS Code shows the three contributed
   * settings: filtered by `@ext:sergwei.open-vs-code`, in the `order` of the manifest, with the
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
   * VERIFIED in `npm run test:visual` on Windows 11, VS Code 1.143.1 (2026-10-25): the checks
   * "the Settings editor lists exactly 3 settings for the extension (3; selector
   * .settings-editor .setting-item)", "the #id# link of the first setting is painted as a link
   * ("Open Vs Code: Server Url", 1 link(s))" and "clicking the link focuses the second setting
   * ("Server Url")" passed. Not observed: other VS Code versions or operating systems.
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
      rows.length === 3,
      `the Settings editor lists exactly 3 settings for the extension (${String(rows.length)}; selector .settings-editor .setting-item)`,
    );
    const expected = [
      'Absolute path to the opencode v2 executable.',
      'Address of an opencode v2 server that is already running on this machine',
      'Model that every new chat session starts with',
    ];
    const expectedLabels = [
      'Open Vs Code: Opencode Path',
      'Open Vs Code: Server Url',
      'Open Vs Code: Default Model',
    ];
    rows.slice(0, 3).forEach((row, index) => {
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
    const focusedChat = await waitFor(async () => (await promptState()).focused, 8_000, 250);
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
    const inChatAgain = await waitFor(async () => (await promptState()).focused, 8_000, 250);
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
      (await waitFor(async () => (await promptState()).focused, 8_000, 250)) === true,
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
      (await waitFor(async () => (await promptState()).focused, 8_000, 250)) === true,
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
        await waitPresent('.agent-model-panel', false);
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

console.log('\n== summary');
console.log(`screenshots (${String(shots.length)}):`);
for (const file of shots) console.log(`  ${file}`);
console.log('\n== timings');
for (const { id, name, seconds } of timings) {
  console.log(
    `  ${id.padEnd(3)} ${seconds.toFixed(1).padStart(6)} s  ${name.slice(id.length).trim()}`,
  );
}
console.log(
  `  total ${((performance.now() - vscodeStartedAt) / 1000).toFixed(1)} s since VS Code was started`,
);
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
