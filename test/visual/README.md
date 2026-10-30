# Visual tests (`npm run test:visual`)

Drives a **real VS Code** with the extension loaded and checks what no unit or integration test
can see: how the chat looks in the four themes, the notification and the badge with the view
hidden, focus on request cards, Stop, and that Restart Server and Reload Window keep the session.
It also takes screenshots. Born from a manual CDP run on 20/10/2026 that found two real bugs
(code unreadable in High Contrast Light, Stop painted as a red error).

**It needs no model, no quota and no network.** The opencode behind the extension is the
synthetic one, `src/extension/test-fixtures/fake-opencode.mjs`, which the extension launches as its
own server (see "How the extension runs the fixture"). So what the run proves is the extension's
own behaviour: the UI, the host, the protocol between them, themes, focus, CSP. It does **not**
prove that a real model chooses a tool, writes a given Markdown or follows an instruction, nor that a
real opencode sends the same events as the fixture: the shapes of a real turn are compared with the
fixture's by the opt-in `npm run test:event-shapes`, which does need a model.

## Run

```sh
npm run test:visual
```

- The script builds the host and the webview first (development bundles), then launches VS Code.
  It only needs the `stable` VS Code that `@vscode/test-electron` caches in `.vscode-test/`
  (downloaded the first time).
- It is still run locally, not in CI (decision of Sergio, 22/10/2026): Linux needs `xvfb` and the
  focus under it is unverified, macOS needs `Cmd+B` where step 22 sends `Control+b` (step 5 clicks
  the layout button, and sends it only when the notification has no "Open" link), and contrast and
  screenshots vary per system.
- **Duration.** A clean full run takes about 553 s counted from the moment VS Code starts
  (Windows 11, VS Code 1.144.0, 30/10/2026, steps up to 31: 1382 ok, no FAIL; 553.4 s), of which
  step 31 takes 13.8 s, step 30 43.2 s, step 27 47.5 s, step 28 37.0 s and step 29 78.9 s (from that one full run); before step 27 existed it was 230-245 s on VS Code 1.143.1. That figure is the `total … since VS
  Code was started` line of the summary: the build of the host and the webview before it, and the
  start-up of VS Code, are not in it. Every step prints its own `time N.N s` and the summary ends
  with a `== timings` table, so a slow step shows.
- **What was measured, and on which code.** The last full run (30/10/2026, with steps up to 31 and
  D0 in step 25) ended "all visual checks passed", and so did the ones before it with step 27. The two before them, without step 27 (230.6 s and 231.4 s,
  28/10/2026), ended "all visual checks passed", and `compare-runs` against the baseline found "no
  differences". They are the first runs with VS Code's own Chat (Copilot) turned off in the test
  profile (`chat.disableAIFeatures`, the secondary side bar hidden). Earlier the same day, runs
  on earlier code failed now and then: one FAIL in step 22, and two cascades of failures (see
  below).
- **Two known intermittent failures**, not explained yet:
  - Step 22 fails some checks that move the focus with `Control+Alt` (for example "Control+Alt+P
    again brings the focus back to the prompt box after the chip panel"): [#92](https://github.com/sergwei/open-vs-code/issues/92). The cause is a
    HYPOTHESIS: a key sent while the focus is still moving between the webview and the editor is
    lost. It was not reproduced (18 of 18 runs of the step alone passed), so nothing confirms it.
  - The webview stops answering and the failures cascade (the side bar stuck at an unintended
    width, the theme not applied, 20 s timeouts): [#93](https://github.com/sergwei/open-vs-code/issues/93).
    When it shows as a CDP call that times out, the run now stops by itself after that step,
    with or without `--bail` (checked by forcing a call that never answers). When it shows as a
    theme that is not applied, with no CDP timeout, nothing stops it: one such run, with Copilot
    still on, cascaded from step 0 and showed a GitHub/Copilot modal in step 9. That Copilot
    played a part is a HYPOTHESIS.
- Needs Node 22+ (global `WebSocket`) and a display (a real window opens; on Linux use `xvfb-run`).
- Exit code `0` when every assertion held, `1` when any failed, `2` when it could not start (the
  build is missing, or the VS Code download, launch or CDP connection failed).
- Save the output with `npm run test:visual > .vscode-test/visual/run-output.txt 2>&1` to reread it.

### Running only some steps

```sh
node test/visual/run.mjs --steps 11,14,23     # no build: dist/ must be up to date
npm run test:visual -- --steps 11,14,23       # builds first
```

- `--steps a,b,c` runs those steps, always in the canonical order of the table below (a filter
  never reorders). An unknown id exits with `2` and lists the valid ones.
- **The prerequisites are added automatically and announced**: `--steps 8` runs 1, 5, 6, 6b and 8,
  and prints `steps added because the requested ones need them: 1, 5, 6, 6b (requested: 8)`. They
  are whole steps, so they bring their own `ok` lines; there is no separate set-up code that the
  full run never exercises. The dependencies live in `STEPS[].needs` in `steps.mjs`.
- A filtered run starts with the banner `PARTIAL RUN (steps …): not evidence for a commit` and writes
  its screenshots to `.vscode-test/visual/shots-partial/` and the README crops to
  `.vscode-test/visual/readme-partial/`, so the `shots/` and `readme/` of the last full run are not
  touched. Without the step 0 VS Code starts normally (the fixture, no `.down` marker).
- The check that the fixture kept its state file only runs if a selected step sends a prompt. A
  selection without the step 20 should not touch the clipboard: read in `run.mjs`, only that step
  uses `withSavedClipboard` and none presses Copy or Ctrl+C (not observed by running).
- `--bail` is for development: the run stops after the first step that fails and skips the rest,
  instead of letting every later wait expire on a broken state. It exits with `1`, prints its own
  banner, and is **not evidence**: a run without it reports every failure.
- `--all-themes` takes the screenshots that are only screenshots (11g, 12b, 12d, 12f, 14b, 14d) in
  the four themes. By default they are taken once, in dark. It never changes a check, so it never
  changes the `ok` lines; use it when a task touches the CSS of those views.
- **Only the full run (no `--steps`, no `--bail`) is evidence for a commit.** A filtered run answers
  "does my change to step N still hold" in seconds; it does not prove that the other steps do.

The ids 24 and 25 (issue #33) were added later and were run with `--steps 24,25` and `--steps 25`
(28/10/2026, Windows 11, VS Code 1.144.0), not with `--bail`; the 24 needs the 1 because it drives
the chat, the 25 needs nothing because it starts its own windows. The 26 (issue #36) was run with
`--steps 26` (29/10/2026, Windows 11, VS Code 1.144.0); it needs the 1 because it drives the chat.
The 27 (issue #77, the chat in editor tabs) needs the 1 because it starts from the side bar chat;
its times come only from the full run (see Duration above), not from a run of its own. The 28
(issue #77, delivery E2, the tabs after Reload Window) needs the 1 for the same reason; its times
come only from that same full run (see Duration above); no `--steps 28` run is the source of any
figure, because the step's prologue changed after the last one. The 31 (issue #77, delivery E5, the
default of `chatLocation`) needs the 1 because it starts from the side bar chat and sends a prompt;
its times come only from a full run.

Every id up to 23 was run alone with `--steps <id> --bail` on 28/10/2026 (Windows 11, VS Code 1.143.1). 24
passed on the first try; the 7 failed ("the answered-request lines are the same after Restart
Server ([] -> [])") until its `needs` became the step 5, and then passed twice. "Step" is the time
of the step itself, "Total" the `total … since VS Code was started` of that run (it includes the
added steps):

| Id | What runs | Step (s) | Total (s) |
|---|---|---|---|
| 0 | 0 | 9.3 | 13.5 |
| 1 | 1 | 1.2 | 4.3 |
| 2 | 1, 2 | 8.0 | 12.7 |
| 3 | 1, 3 | 4.7 | 9.0 |
| 4 | 1, 2, 4 | 2.1 | 14.5 |
| 5 | 1, 5 | 2.7 | 6.8 |
| 6 | 1, 5, 6 | 3.7 | 10.8 |
| 6b | 1, 5, 6b | 3.3 | 11.0 |
| 7 | 1, 5, 7 | 4.9 | 11.4 |
| 7b | 1, 2, 7b | 10.0 | 22.6 |
| 8 | 1, 5, 6, 6b, 8 | 2.6 | 16.6 |
| 9 | 1, 2, 9 | 24.9 | 37.4 |
| 10 | 1, 2, 9, 10 | 10.5 | 47.1 |
| 11 | 1, 11 | 8.0 | 12.6 |
| 13 | 1, 13 | 5.3 | 10.4 |
| 14 | 1, 14 | 6.8 | 10.9 |
| 15 | 1, 15 | 21.0 | 25.3 |
| 16 | 1, 2, 16 | 27.8 | 39.6 |
| 17 | 1, 17 | 6.3 | 10.4 |
| 18 | 1, 18 | 9.1 | 13.2 |
| 19 | 1, 19 | 12.7 | 16.8 |
| 20 | 1, 20 | 13.4 | 17.2 |
| 21 | 1, 21 | 2.5 | 6.9 |
| 22 | 1, 2, 22 | 15.5 | 27.4 |
| 23 | 1, 23 | 18.0 | 22.2 |
| 24 | 1, 24 | 39.1 | 61.5 incl. the 23 (`--steps 23,24`) |
| 25 | 25 | 15.0 | 18.5 (with D0, the step took 17.7 s in the full run of E9-default-editor, 30/10/2026) |
| 26 | 1, 26 | 29.2 | 32.8 |
| 27 | 1, 27 | in the full run | in the full run (see Duration above) |
| 28 | 1, 28 | in the full run | in the full run (see Duration above) |
| 29 | 1, 29 | in the full run (78.9 s) | in the full run (see Duration above) |
| 30 | 1, 30 | in the full run (43.2 s) | in the full run (see Duration above) |
| 31 | 1, 31 | in the full run (13.8 s) | in the full run (see Duration above) |

The 16 needs the 2 because its "ArrowUp with the popup closed recalls the last prompt" reads a
prompt history that an earlier step fills; 4, 7b, 9 and 22 need a conversation open (the 2's), and
the 10 expects the EMPTY view the 9 leaves. Each of these was run once alone, so an intermittent
failure would not show in the table.

### Window size

The run **sets the window to 1440x900 CSS px** (`window.resizeTo` over CDP; 1440x900 is, as far as
we read, VS Code's own default for a new window with a folder) and prints it before the first step,
with the device pixel ratio and the screen's work area: `window 1440x902 CSS px, DPR 1.25, screen
work area 4096x1152`, and in step 1 the width of the webview. If the measured size is not the
requested one (a work area smaller than 1440 px, say) the run is meant to exit with `2` and say so,
instead of going on with a layout nobody chose (that path has not been executed).

Why: until 27/10/2026 it inherited the size of the monitor VS Code opened on. The window of the
failing runs of 25/10/2026 was 1080 px wide (the captures were 1080x900 at DPR 1), probably a
vertical monitor that VS Code clipped to; the side bar was probably about 270 px, and ten checks
failed (steps 9, 10, 11 and 15) with no code change. When a run fails and the same tree passed
before, compare these lines (and the screenshot size) first.

The window size does NOT change the side bar width (seen: it stayed 300 px after a resize). So step
15 measures the failed tool card a second time in a 1080x900 window with the side bar dragged to
270 px (`setSideBarWidth`, the real mouse on the sash; 270 is a HYPOTHESIS for what a window that
opened 1080 px wide gets), then restores the theme, the side bar (to the width measured before) and
the window, and measures again. Before that it checks that, at the default side bar width, the
Edit, Write, Grep, Fetch and failed headers take one line each. The checks of steps 9, 10 and 11
still run with the default 300 px side bar.

## What it does

Every step is asserted; nothing is skipped because of what a model did.

| Step | Checks (assertions) | Screenshots |
|---|---|---|
| 0 setup guide (E2, #85) | VS Code starts with `openVsCode.opencodePath` at a file that does not exist and the fixture's `.down` marker in place: the guide "Set up opencode" replaces the view (no header, no prompt box), step 1 says "Failed" in words and names the searched path; at 300 px, ~900 px and under 200 px, in the 4 themes: text block >= 60 % of the guide, no sideways overflow, contrast >= 4.5, buttons BELOW the text when narrow. issue #86: "Choose binary…" is pressed and the dialog cancelled (while open the button is `aria-disabled` and step 1 still says Failed; Escape gives it back), then pressed again with the fixture's `.slow-version` marker in place (`--version` waits up to 8 s): step 1 says "Checking…" with a spinner, one line `Checking <path>…` and the hidden region "Checking the opencode binary…", measured at 300 px in the 4 themes (contrast >= 4.5, a `warn` names any theme the 8 s window missed); "Choose binary…" is pressed with the real mouse and the path typed in VS Code's file dialog (plan B, `writeSettings`, if the dialog refuses the `.mjs`: printed as a `warn`); step 1 turns done and step 2 fails (marker); issue #87: no native OpenCode notification (toast or notification center, the latter opened from the palette) while the guide is shown, read 4.5 s after the guide appeared (past the 3 s grace period of `CHAT_SHOW_GRACE_MS`) and again 1.5 s after step 2 fails (without the grace period in `chatSurfaceGate.ts` the first check FAILS; a notification center that cannot be opened or read also FAILS both checks, because it is "not measured", never "0 notices"); the marker is deleted, Restart is pressed and the normal empty state returns | `00-guide`, `00b`, `00c-server-down`, `00c-checking-<theme>` (the "Checking…" state, one per theme), `guide-<width>-<theme>` |
| 1 empty state | the app root says `data-connection="connected"` (there is no visible "Connected" line), title "Untitled session", New session button, suggestions; it also prints the diagnostic lines `window 1440x902 CSS px, DPR 1.25, screen work area 4096x1152` (before the step) and `webview 298 CSS px wide`, so an environment difference shows in seconds | `01-empty` |
| 2 Markdown | a `MARKDOWN` reply streamed in deltas (the shot at 3 s sees an unfinished block); code actions, highlighting, a rendered table, no inline `style`, only http(s)/mailto links, click on `src/sample.ts:20` gives `Ln 20`, New file gets a language | `02a`, `02b`, `02c` |
| 3 Stop | a `LONG` reply (the numbers 1 to 400, about 16 s); Stop visible, Escape stops, a neutral "Stopped" note (message level) with no `role="alert"` and no red box, ArrowUp recalls the prompt | `03a`, `03b` |
| 4 themes | code and token contrast >= 4.5 (tokens only in the high-contrast themes; weak tokens elsewhere are warnings) | `04-theme-{light,dark,hc-dark,hc-light}` |
| 5 permission | `ASK_PERMISSION` in a new session: toast and badge with the view hidden, focus in the card, the "Always" panel has one primary button, "Allow once", badge cleared, and an "Allowed once" line under the tool in the conversation (not in the dock, not an alert) | `05a`-`05d` |
| 6 question | "Allowed once" survives the next prompt; `ASK_QUESTION`: question card shown and focused, option B answered, gone, and an "Answered … Letter: B" line in the conversation | `07a`, `07b` |
| 6b reject | a plain Reject (never Always): the turn ends, a "Rejected" line under the tool, no alert, no red box, earlier lines still there | `07c` |
| 7 Restart Server | same conversation and title afterwards, and the same answered-request lines (the fixture relaunched keeps the conversation in its state file) | `08a` |
| 7b error card (E2, #85) | the prompt `CRASH` makes the fixture exit mid-turn and leave `<state file>.down`; the card "opencode could not start" (role alert) appears at the end of the conversation with the history visible, no guide, the box says "Waiting for opencode…" and stays editable, Send blocked; same layout rounds as step 0 (300 / ~900 / < 200 px, 4 themes, text >= 60 %, contrast >= 4.5, buttons below when narrow); marker deleted, Restart pressed, same session, card gone | `07b-card`, `card-<width>-<theme>` |
| 8 Reload Window | same conversation and title afterwards; "Answered … Letter: B" and "Rejected" are read back from the tool blocks; "Allowed once" is asserted GONE, because the server keeps no trace of an allowed permission and the host memory dies with the window. Against the fixture this checks the host's side only | `09` |
| 9 sessions (#20) | the Sessions button opens a list with groups, times and exactly one open session marked in the four themes; focus in the search box, ArrowDown enters the list with a visible focus, Escape returns the focus to the button; New session leaves the empty view and creates NO session; the first prompt creates it (a `LONG` one, so it is still running: it says "Running" in text); in-line rename shows in the row AND the header; the search finds only that session, case-insensitively; clicking another row opens it and closes the list (rows are pressed with `clickRowMain`, left of the hidden Rename/Delete overlay, and it throws if the pointer would land elsewhere); Delete asks in the MODAL dialog of VS Code (named session, "cannot be undone"), Cancel keeps everything, Delete removes it and empties the view with no "deleted outside" notice | `10a`-`10i` |
| 10 fork and subagents (#21) | every user message (not the assistant's) has a "Fork from here" named after it; the action bar shows on hover (that message's only) and on Tab with a focus ring; the fork opens with only the first exchange, a "Forked from" crumb, the prompt refilled with the forked text and focused, and a "Fork" word in the session list; the crumb returns to the intact original. Then a `SUBAGENT` turn: the block gets "Open subagent session", the child shows a "‹ parent" crumb that goes back, and the parent lists "Subagent sessions (1)" that opens it again | `11a`-`11h` |
| 11 agent and model chip (#23/#24, E2 #85) | the prompt bar has ONE chip "agent · model ▾" named "Agent and model: …" with a connection dot, and the header no longer has the marker; its panel opens upwards with the focus on the current agent, the Agent column (Build, Plan and the fixture's custom agent `docs`, one current) beside the Model column (grouped by provider, one model marked current), columns stacked only under 360 px of container, shot in the four themes; clicking the search box and typing a name filters, ArrowDown enters the list with a visible focus, Enter picks, closes and returns the focus to the chip; Escape closes without picking; a press outside the panel closes it; Plan by mouse (the panel closes), Tab reaches the chip with a ring, Enter opens, ArrowUp/ArrowDown move between agents, Enter on an agent row does NOT send the prompt; a prompt makes the reply read "Plan · " plus the chosen model's name; the next new session proposes the last used model and Build; the `openVsCode.defaultModel` setting beats the last used model, a malformed value is reported once and ignored; reopening the session shows its model and agent. **Rewritten on the chip in E2 phase 3; its first full run was the one of phase 4 (27/10/2026), all green** | `12a`-`12h` (step 11's shots use the prefix `12`; there is no step 12) |
| 13 attachment (review #1015 S1) | a real file is picked with the "Attach file…" item of the "+" menu, pressed with the real mouse (VS Code's own file dialog, `files.simpleDialog.enable`), shows as a chip, and the prompt sent with it leaves (the message shows the file, the chip is gone, no alert) with no exception: the pre-fix code threw `DataCloneError` here | `13a`, `13b`, `13c` |
| 14 reasoning variant (#61) | the fixture's catalog has two models with variants (low, high) and one without (`tiny-context`); the model without variants has no Reasoning section; for the other one the chip shows no level (Default) and the Reasoning section of its panel (Default current + the catalog ids) opens with the real mouse, shot closed and open in the four themes; choosing a variant closes the panel and the chip ends in the level after a middle dot (for example `· low`); Tab reaches the chip with a visible ring, Enter opens, Tab reaches the Reasoning list on the current level, ArrowUp moves, Escape returns the focus to the chip, a press outside closes it; re-choosing the same model keeps the variant, another model starts on Default; a prompt makes the reply line end in the variant; a new session proposes the last model with its variant; reopening the session shows the variant the server stored; no `style` attribute | `14a`-`14h` |
| 15 tool cards (#26) | one `TOOLS` prompt: the fixture plays nine tool calls (shell twice, read, edit, write, grep, glob, webfetch, an MCP-style tool); every card is folded by default (`aria-expanded=false`, no `.tool-body` in the DOM, no style attribute); for shell, read, edit and grep: Shift+Tab from the prompt box reaches its toggle with a visible ring, Enter opens it (the log keeps the same number of children) and the body is right (shell: output of `node --version`; read: the file; grep: the pattern; edit: a diff with added AND deleted lines), Space closes it; the edit diff is measured in the four themes (text contrast >= 4.5); the header of the LAST card (its `data-tool` is printed, `mcp_echo`) stays in view after unfolding it (auto-scroll); then a `BROKEN_READ` prompt: a read of the missing `src/does-not-exist.ts` fails with opencode's error, and the card must say "failed" with the first error line in the header ("·" separators), stay folded, fit its toggle (at 1440x900 and again in a 1080x900 window with a 270 px side bar, then back at the wide size), show the same line when unfolded and have an error chip and an error body with text contrast >= 4.5 in the four themes; the path button of the read card opens `src/sample.ts` in the editor | `15a`-`15f`, `15e-tool-failed-narrow`, `15e-tool-failed-narrow-hc-light` |
| 16 `@` mentions and editor context (#28/#29) | writes a second file (`src/sample-extra.ts`) so the popup has two rows (the fixture's `find` walks the served folder in this mode); typing `@sample` with the real keyboard opens a listbox with the two files (relative names), the box keeps the keyboard focus and points at the highlighted option (`aria-controls`, `aria-activedescendant`) and Send is not locked; text contrast of a normal row, the highlighted row (name and folder) and the "No files match" line is measured in the four themes (>= 4.5); one more key and Enter at once, while the rows are those of the older text, neither sends nor picks; ArrowDown moves the highlight and Enter adds the chip `src/sample.ts` AND writes `@src/sample.ts ` in the box without sending; ArrowUp with the popup closed recalls the last prompt; with a `LONG` turn RUNNING, Escape with the popup open closes it and does NOT stop the turn, a second Escape does; a real mouse press on a row picks it and the focus stays in the box; pressing the chip opens `src/sample.ts` in the editor; selecting lines 2-3 in that editor and choosing "Add selection" in the "+" menu adds the chip `src/sample.ts#2-3` (this proves the active editor is still the active editor when the focus is in the chat); sending with both chips shows both in the conversation; pressing the conversation chip of the range opens the file at "Ln 2"; no `style` attribute and no webview error | `16a`-`16f` |
| 17 context and cost line (#25) | a new session shows no line; after a normal turn (4248 tokens per step in the fixture) the dimmed line under the title reads exactly `Context 4K / 200K (2%)` with no cost (the model is free) and level `normal`; then a `COSTLY` turn on the `tiny-context` model (5000-token window) reads `Context 4K / 5K (85%) · $0.01` with level `high`. In both it is a plain `<p>` (no role, `aria-label` or `title`): the shorthand is `aria-hidden` (and carries the tooltip) and a visually hidden span holds the full sentence with exact figures, which is all a screen reader reads (not a live region); it sits right under the title bar, has no `style` attribute and fits its width; its text contrast is measured in the four themes in each state (>= 4.5). A compaction has no UI before issue #34 and stays in the Vitest e2e | `17-context-line-{normal,high}-<theme>` |
| 18 changed files and native diff (#31) | creates `src/removed.ts` and sends an `EDIT_FILES` turn: the synthetic server changes four files of the workspace for real (a modified `src/sample.ts`, an added `src/added.ts`, a deleted `src/removed.ts`, an added binary `assets/logo.png`) and ends its step with `files`. A new session shows no list; afterwards a closed `<details>` "Changed files (4)" sits in the header area; a real press on its summary opens it; the rows read path, status in words and counts (`Modified · +1 −1`, `Binary`) and are buttons whose accessible name is a sentence; summary, path and status line have text contrast >= 4.5 in the four themes. A real press on `src/sample.ts` opens VS Code's diff editor in a tab titled "... (OpenCode session)" with the original line (`value2 = 2`) on the left and the new one (`value2 = 22`) on the right; Tab, Tab, Tab, Enter from the summary opens the deleted file's diff (text on the left, empty right); the added file has an empty left; the binary opens its own file, no diff editor, and the chat says there is no text diff. No `style` attribute, no webview error. Needs `diffEditor.renderSideBySide` (the step writes it) | `18a`-`18g` |
| 19 revert from a message (#32) | rewrites `src/sample.ts` and `src/removed.ts` and sends `EDIT_FILES LARGE`: "Changed files (5)", the row of `docs/big.txt` reads `Too large to diff · +1200 −0` with contrast >= 4.5 in the four themes (pending item of #31); the diff of `sample.ts` is opened and PINNED. A real press on "Revert from here" of the message hides the conversation, draws the block OUTSIDE the log ("1 message reverted", "5 files changed on disk", the rows seen from the revert, Restore and Discard for good), refills the prompt, empties "Changed files" (bounded to the visible turns) and restores the DISK for real (the test reads `sample.ts`, `added.ts`, `removed.ts`, `logo.png` and `big.txt` back); the block has contrast >= 4.5 in the four themes. A press on its `sample.ts` row opens a diff titled "(before the revert)" (left `value2 = 22`, right `value2 = 2`) while the pinned tab stays. Restore brings the messages, the list and the disk back; reverting again and pressing Discard for good raises VS Code's modal (Cancel keeps the revert, the second answer deletes the history; the files stay). Finally the pinned "Changed files" diff tab is brought to the front, `sample.ts` is written by hand with `value2 = 5`, another `EDIT_FILES` turn runs, and the tab shows `value2 = 5` on the left WITHOUT being touched (the provider's `onDidChange`, pending item of #31); no error notification, no `style` attribute, no webview error | `19a`-`19h` |
| 20 drop and paste (#30) | **Windows only** (the paste needs PowerShell to fill the clipboard: `navigator.clipboard.write` is denied in the workbench, so on macOS and Linux this step FAILS). **Writes the system clipboard** (a PNG, then text): the step first saves the text or image you had on it (in memory only, never on disk or in the log) and gives it back at the end, also when the step fails. A copy from Word, Excel or a browser comes back as plain text only (the run warns), anything else (copied files, HTML-only content) cannot be restored and the run prints a warning, and a run killed halfway does not restore either. A 1x1 PNG is put on the clipboard (PowerShell) and pasted with the real keyboard into the prompt box: the chip "Pasted image 1" appears with a thumbnail that loaded (`blob:` allowed by the CSP), the box stays empty, and a model that cannot read images (`big-pickle` in the fixture) gets one warning; a text paste writes text and no chip; the x button removes the chip; with `glm-5.3-flash-free` (reads images) the same paste raises no new warning; Send leaves with the image and the conversation shows its chip. The DROP is **synthetic** (untrusted `DragEvent`s with `resourceurls`): the box highlights with its hint "Hold Shift to drop files from the Explorer" (contrast >= 4.5 in the four themes) and the highlight goes away; a drop of a file, a folder and an outside file adds only `src/sample.ts` and raises ONE notice with the count. Last, the Explorer is shown (which hides the chat view), `src/sample.ts` is right-clicked with the real mouse and **Add to OpenCode Chat** is chosen: the chat reopens and the CHIP `src/sample.ts` must be in its DOM (the host keeps it until the new document is ready). If the paste event carried the image and no chip appeared the step fails at once; it retries only an empty clipboard. It does NOT show that VS Code delivers a real drag to the webview: that is not automated (the chat and the Explorer cannot share a side bar), see microsoft/vscode#339036 | `20a`-`20f` |
| 21 settings UI (#38) | opens "Preferences: Open Settings (UI)", types `@ext:sergwei.open-vs-code` in its search box and reads the editor's DOM (`.settings-editor .setting-item`, internal to VS Code): exactly 4 settings (the fourth is `chatLocation`, issue #77), in the manifest `order`, shown with the labels VS Code derives, `Open Vs Code: Opencode Path`, `Open Vs Code: Server Url`, `Open Vs Code: Default Model` and `Open Vs Code: Chat Location` (the extension-name prefix is VS Code's, an `id` on the category did not remove it; each label is printed in its own `ok` line); each description contains its first sentence; the `` `#openVsCode.serverUrl#` `` reference of the first setting is painted as a link (`<a>`; this step only sees the backtick form: the bare `#id#` showing as literal text was seen once by hand over CDP, VS Code 1.143.1, Windows 11, 2026-10-25, and is not a check of this step) and a real mouse click on it focuses the second setting. The editor opens in VS Code's own overlay and is closed with Ctrl+W. Like the whole run, it is checked only on Windows | `21a-settings`, `21b-settings-link` |
| 22 palette commands and shortcuts (#35) | focus in `src/sample.ts` (quick open), the REAL keyboard: Ctrl+Alt+P (Cmd+Alt+P on macOS) puts the caret in the prompt box of the chat, and again returns the focus to the editor; Ctrl+B hides the chat WHILE IT HOLDS THE FOCUS and Ctrl+Alt+P shows it again with the caret in the prompt (a stale `openVsCode.chatFocused` would send the focus to the editor instead); with text typed, Ctrl+Alt+N (only bound while the chat has the focus) leaves the empty view, keeps the draft and the focus and creates NO session (the state file of the fixture keeps its count); a `LONG` turn is interrupted from the palette with "OpenCode: Stop Response" while the editor has the focus ("Stopped" note and live region); with nothing running the same command shows "No response is running" with contrast >= 4.5 in the four themes. Key presses are only exercised with `Control+Alt` on Windows. With the "+" menu OPEN (E2 #85, phase 4), Ctrl+Alt+N still leaves the empty view and Ctrl+Alt+P still moves the focus to the editor, and both close the menu. With the CHIP panel open, Ctrl+Alt+P moves the focus to the editor and closes the panel ("with the chip panel open moves the focus to the editor and closes the panel"); Ctrl+Alt+N is not pressed with the chip panel open | `22a`-`22e`, `22c2` |
| 23 "+" menu and compact state (E2 #85, phase 4) | the "+" button ("Add context", tooltip "Add context: selection, files, images or a mention") opens a menu with Add selection, Attach file…, Attach image… and Mention a file: Enter or Space open it with the focus on the first item, the arrows wrap, Home/End jump, Escape closes and returns the focus to the button, Tab closes without dropping the focus onto the page, a press outside closes it; "Mention a file" writes `@` and opens the file popup; at 300 px, about 900 px and under 200 px, in the four themes, the "+", the chip and Send do not overlap, nothing sticks out of the view and the page does not scroll sideways; under 200 px the chip takes a row of its own at the width of the box; the menu opens inside the view with item contrast >= 4.5. At about 900 px, in the four themes, the chip panel (reconciliation C1) is judged by boxes: the Agent and Model columns side by side (not stacked), Reasoning inside the Model column under the model list, the panel inside the view with no sideways scroll, row and column-title contrast >= 4.5, and Escape closes it and returns the focus to the chip. Steps 13 and 16 open this menu to pick Attach file… and Add selection (they were loose text buttons before phase 4), and step 20 reads the Shift-drop hint on the "Attach file…" item | `23-bar-*`, `23-menu-*`, `23-chip-panel-wide-*` |
| 24 slash commands (#33) | the workspace has two project commands (`.opencode/command/hello.md`, "Say hello to someone", and `broken.md`, whose template makes the fixture answer 500) next to the fixture's `init` and `review`. Matrix of 36 cells (component x width x theme: 300 px, wide, compact; light, dark, hc-dark, hc-light): **C1** the "/" button is pressed with the real mouse, the menu opens inside the view with the four commands, and a row that is neither focused nor hovered has name and description contrast >= 4.5; **C2** typing `/` with the real keyboard opens the popup with the rows and the description of `/hello`, exactly one highlighted, the focus in the box, inside the view, with contrast >= 4.5 in a normal row and in the highlighted one; **C3** the "+", the "/", the chip and Send do not overlap and are inside the view, the page does not scroll sideways, no `style` attribute, and in the compact state the chip takes a row of its own. **C4**, one cell on purpose (behaviour, dark, 300 px): the menu with the keyboard (Enter, ArrowDown, End, wrap, Home, Escape back to the button, Space, Tab without dropping the focus to the page); a row chosen with the mouse writes `/hello` and a space and leaves the focus in the box; `/hello Ana` + Enter shows the expanded template as the user message, the fake answers and the host log says `command accepted /hello for ses_…`; `/broken` + Enter shows the 500's message and gives the draft back; `/nope hola` goes as a normal prompt; Escape with the popup open during a `LONG` turn closes the popup and does not stop it, a second one does. The compact width gives a 170 px bar (the sash does not go to 150), judged as under 200 px | `24-menu-<width>-<theme>`, `24-popup-<width>-<theme>` |
| 25 Workspace Trust (#33) | starts two more VS Code windows with the extension INSTALLED (copied into an isolated extensions dir with an `extensions.json`, because an extension loaded with `--extensionDevelopmentPath` is not disabled by Restricted Mode): a control with trust switched off, where the OpenCode item shows in the activity bar, and one with trust enabled on a folder nobody trusted. In the second the status bar says "Restricted Mode", the activity bar has NO OpenCode item, the palette lists "Manage Workspace Trust" (so it works) but no OpenCode command (a missing `OpenCode.log` is not checked: neither window opens the chat, so it would prove nothing). Mutation: with `supported: true` in `package.json` the item and the commands show up and two checks FAIL; with no `capabilities` block at all the step still passes, because VS Code 1.144.0 treats an extension with code and no declaration as unsupported (read in `workbench.desktop.main.js`), so the declaration documents and pins the behaviour. Only Windows 11 and VS Code 1.144.0 were run. **D0** (#77, E5): the control window is the closest thing here to a fresh install (the extension INSTALLED, a new profile) and starts with NO `openVsCode.chatLocation` key (`chatLocation: null` in `startVSCode`; every other window of the run carries `sidebar`). The profile file has no such key, the host log says `chat location at start: editor` (the first activation), the OpenCode icon opens the Sessions view (its New Session and Search Sessions title buttons) and no chat iframe has its centre inside the side bar after a 3 s margin; the title text and the welcome text of the view are printed as data, not judged | `25-restricted-mode`, `25a-default-editor` |
| 26 editor and Explorer context menus (#36) | the REAL right mouse button, judged in the DOM of the webview and never in the host log. **C1** right-click on a selected line of `src/sample.ts`: the editor menu lists **Add to OpenCode Chat**, **Explain with OpenCode** and **Fix with OpenCode** in that order (VS Code draws that menu in a shadow root, so the rows are read with Playwright locators). **C3** with a draft (`my draft`) in the box and lines 2-3 selected, **Explain** sends exactly `Explain what @src/sample.ts#2-3 does.` with the chip `src/sample.ts#2-3` and leaves the draft untouched. **C4** `src/broken26.ts` (two type errors, written by the step): once the TypeScript server underlines both, **Fix** sends the prompt with `Line 1` and `Line 2` of the problems. **C6** during a `LONG` turn, **Fix** goes to the prompt box (text, chip `src/broken26.ts#1-2`, the notice "OpenCode is busy: the prompt is in the box", focus in the box and nothing sent); that notice has contrast >= 4.5 in the four themes at 300 px, and the box with its five lines does not overflow at 300 px and under 200 px (dark; the bar settles at 170 px). **C2 + C5** the Explorer is shown (the chat view is hidden) and two files are selected: the menu lists **Add to OpenCode Chat** then **Explain with OpenCode** and no Fix; with the folder `src` added to the selection, **Explain** brings the chat back and sends `Explain what @src/sample.ts and @src/context-b.ts do.` with two chips and ONE notice counting the folder. **C7** the menu of an untitled document has no OpenCode entry (the `resourceScheme == file` guard), and **Explain** on a file outside the workspace folder raises the native warning "Only files inside the workspace folder can be added" and sends nothing. NOT measured: that a refused action leaves a CLOSED chat closed (the chat is open during it), a right-click on macOS or Linux (the menus may be native there), and the colours of VS Code's own menus | `26a-editor-menu` to `26i-untitled-menu` |
| 27 chat in editor tabs (#77) | writes `openVsCode.chatLocation: editor` into the profile (and `sidebar` back at the end) and judges the workbench DOM (tabs, groups, the Sessions tree, toasts, badge) and the webview of each tab. Matrix of 24 cells: **C1** the Sessions view (dark): the row of the session of the tab and NO welcome text, the New Session, Search Sessions… and Open Settings title buttons, no chat in the side bar (the welcome of each empty state is step 29) (a webview floats over the side bar, so "in the side bar" is a chat iframe whose centre lies inside its box); **C2** the chat inside a tab renders with the theme kind and text contrast >= 4.5 and no CSP error, in the four themes at the width of a tab beside the code (541 px, measured) and in dark with the tab alone in the editor area (1082 px, measured); **C3** the tab reads the session title and its icon is the SVG that matches the theme (light for light and hc-light) with stroke contrast >= 3 against the tab background, four themes; **C4** a `LONG` turn of tab A ends while tab B is on screen, and back in A the reply is the 400 numbers once and in order; **C5** a click on A's row in the Sessions view, with B on screen, reveals A and adds no tab (and the tab has no Sessions button); **C6** New Session from the palette, from the title button of the Sessions view and with Ctrl+Alt+N inside a tab: a new empty tab each time, with the caret in its prompt; **C7** Insert at cursor and Add selection from a tab reach the last text editor (`src/sample.ts`, in the first group); **C8** a file link and the diff of "Changed files" open outside the chat's group; **C9** Explain from the editor menu with every chat tab hidden goes to the most recent tab, no tab added (on `src/other27.ts`: with `sample.ts` open in two groups the first editor wins, see `editorForMenu`); **C10** both directions of the switch: `sidebar` to `editor` opens ONE tab with the side bar session beside the code, and `editor` to `sidebar` leaves the tabs open (one answers a new prompt) while the side bar chat answers its own; **C11** a permission request with every chat tab hidden raises a native toast and the badge of the Sessions view on the OpenCode icon, and the toast's "Open" link reveals the tab of that session with its card. (The old **C12**, Reload Window with no serializer, left this step when step 28 took over what a Reload does to the tabs.) **Where its times come from**: the `time` of the step in the final full run of E9-tab-requests, 30/10/2026 (48.2 s of 547.4 s in total; Windows 11, VS Code 1.144.0); no run of the step alone is a source. NOT measured: the colours of the welcome of the Sessions view (VS Code's own), the badge in the side bar chat mode, macOS and Linux, two tabs open in two different windows | `27a-launcher` to `27h-back-to-sidebar` |
| 28 chat tabs after Reload Window (#77, E2) | a REAL `Developer: Reload Window`, twice, judged in the workbench DOM and in each tab's webview. Montage in `editor` mode: `src/sample.ts` in the first group and, in the chat's group, B (answered), C (lazy, draft `draft28-C`), D (answered) and A (answered, draft `draft28-A`, active); D's session is deleted by "another client" while D is hidden (the fixture trigger `DELETE_TITLED:<needle>`, sent from A: a tab has no picker since E3), so D's document still believes it has it. Matrix of 16 cells: **R1** right after the reload the four labels read exactly as before (this does NOT tell the current `detachAll` from closing the panels when the extension deactivates: run once with the panels closed instead, `--steps 28` still read the same 4 tabs, 29/10/2026); **R2** A, the active tab, is deserialized at once with its title, its blocks, its draft, the dark theme and no webview error; **R3** the background tabs are not deserialized until opened (the chat iframe count before opening B is printed as data: 1), and B then shows title and conversation (2 cells); **R4** C comes back lazy, "Untitled session", with its draft; **R5** D shows the notice with the exact text "This session no longer exists. Your next prompt starts a new one." and "Untitled session", and keeps the draft `draft28-D` typed in it before its session was deleted; **R6** Focus Prompt from the editor puts the caret in A's prompt, and New Session opens in the chat's group (2 cells); **R7** a prompt typed in the restored B is answered (one more user message AND one more assistant block than before; the fake always replies "hello there", so a non-empty reply alone would pass with the old one); **R8** in `sidebar` mode, after a second Reload, A's tab is back and answers a prompt (same two counts as R7), and the side bar view shows its own session, not A's (2 cells); **R9** the notice of R5 has contrast >= 4.5 in the four themes at the width of a tab beside the code (541 px, measured: 9.14, 7.56, 21.00, 14.55) (4 cells); **R10** the second Reload keeps the number of chat tabs (5). Besides the cells: the host log shows 4 lines "chat tab restored (pane N)" and none "restore skipped", and a mark set in A's document survives hiding A (`retainContextWhenHidden` of a revived panel). Leaves `chatLocation` at `sidebar`, no editor open and `sample.ts` as it was. **Where its times come from**: the final full run of E9-tab-requests, 30/10/2026 (38.7 s of 547.4 s in total; Windows 11, VS Code 1.144.0); no run of the step alone is a source. NOT measured: macOS and Linux, a restored tab and the side bar view holding the SAME session (the side bar has its own here; only the Vitest case "does not hand the memory to the primary when another pane already shows that session" covers the memory side of it, and the Q3 branch that closes a restored tab because the side bar shows its session is run by no test), two windows, more than one group of chat tabs | `28a-before-reload` to `28f-sidebar-and-tab` |
| 29 native Sessions tree (#77, E3) | writes `openVsCode.chatLocation: editor` and judges the rows VS Code draws in the side bar (`.part.sidebar .monaco-list-row`) and the webview of each tab, against the fixture, with three invented triggers: `SEED_SESSIONS` (55 roots, the last five days old), `DELETE_TITLED:<needle>` and `WIPE_SESSIONS`. Matrix of 20 cells: **V1** the rows in the four themes and dark at 170 px: "Today" first, the description of three sessions (`Tab · time`, `Needs input · Running · Tab · time`, `Failed · Tab · time`) as the DOM holds it, whether each one is fully drawn, cut or hidden by the title (printed: with long titles the words are cut or hidden, and the state lives in the icon, the tooltip and the aria label, which the cell checks), the icon classes (`codicon-bell-dot`, `codicon-error`) and contrast >= 3 of those two icons against their row, measured on rows that are NOT selected or hovered (the tab of B is made active first and the cell asserts `selected` false; 5 cells; the lowest contrast of the drawn descriptions, opacity included, is printed as data, with a `warn` under 4.5); **V2** the inline Rename Session… and Delete Session on hover and on keyboard focus, dark and high contrast dark (2); **V3** the context menu lists Rename Session… then Delete Session (Open is not contributed); **V4** a folder with no sessions: "No sessions in this folder yet." with New Session and Open Settings; **V5** the server down (a `CRASH` turn): "OpenCode is not running for this folder." with Open Chat and Show Logs, and Open Chat opens a tab with the guide or the error card; **B1** a click on a session without a tab opens one, and a click on one that has it reveals it (2); **B2** Rename on the row asks "New title for the session" with the current title and the row and the tab then read the new one; **B3** Delete on the row asks in the modal, the row leaves and the tab closes; **B4** Search Sessions… finds "Seed29 07" and opens it; **B5** Show more sessions loads the next page and the groups read Today, Yesterday, Previous 7 days, Older; **B6** the row reads Running and then Needs input during an `ASK_PERMISSION SLOW` turn and the badge is 1; **B7** the tab has no Sessions button and keeps New session, the side bar chat keeps it (2); **B8** the selection follows the active tab and a hidden side bar is not opened. NOT measured: macOS and Linux, "Loading sessions…" and the move across midnight (Vitest only), a real screen reader, other locales than the machine's, the tree with more than two pages. The step wipes every session of the fixture (V4) and leaves `chatLocation` at `sidebar`. Harness notes: the first click on a tab sometimes did not take (a hover of the command center drawn over the tab strip; `clickTabAndChat` removes the `.workbench-hover-container` nodes before each click, clicks the page of the chat first and prints the count of clicks), and a revealed tab is revealed a second time when its document is ready (the post-ready focus), which the host drops when another chat surface was revealed meanwhile (Vitest only: in the run that late reveal came before the second click, so B1 passes with or without that drop), so B1 clicks the second row with no pause | `29a-tree-needs-input` to `29j-offline` |
| 30 requests of the chat tabs (#77, E4) | `editor` mode with tabs A and B, judged in the workbench DOM (toasts, badge, tabs, groups, the Sessions tree), the webview of each tab and the host log (`attention: notified`, `closed … (visible)`). Cells: **D1** B asks (`ASK_PERMISSION SLOW`) while A is in front: a native notification titled `OpenCode · <B's title>: …`, badge 1, B's row reads "Needs input", A has no permission card; **D2** "Open chat" brings B forward with its card focused and the notification gone; **D3** control, the tab in front asks: its card, no notification after 3 s; **D4** two groups side by side (View: Move Editor into Right Group), the visible tab that is not the active editor asks: the notification is raised and, 3 s later, it is still there, the editor in front is still the other tab and `closed … (visible)` was not logged (the request dock does not focus a card in a document without focus: before that it closed within 1 s); **D5** `sidebar` mode with the side bar chat visible and tabs left over: the card is in the side bar chat, no notification. Not covered: a subagent that asks (the fixture has none), macOS, Linux | `30a-request-of-hidden-tab` to `30e-sidebar-mode` |
| 31 the default is `editor` (#77, E5) | the profile of the run carries `openVsCode.chatLocation: sidebar` (the baseline of steps 0-26), so this step takes the key OUT of the live profile, the way a user who deletes the setting does. Cells: **D1** removing the key opens ONE tab with the side bar session beside the code (`src/sample.ts` is open in another group) and the side bar holds no chat; **D2** the side bar shows the Sessions view with the row of that session, no welcome text and no chat; **D3** the Settings editor (`@ext:sergwei.open-vs-code`) shows Chat Location as `editor` and not modified, with a control after D5: once `sidebar` is written the same row reads `sidebar` and modified (the row is printed as data; its selectors, `select`, `.is-configured` and `.setting-item-modified-indicator`, were observed in VS Code 1.144.0 on Windows 11, 30/10/2026: `select` is there, `.is-configured` is false and the indicator shows once `sidebar` is written; other versions are not checked); **D4** New Session from the title button of the Sessions view opens a new empty tab with the caret in its prompt; **D5** writing `sidebar` brings the Chat view back to the side bar and the tabs stay open. Dark only: the surfaces are the ones steps 27 and 29 already measure in four themes. The first activation of a fresh install is D0 of step 25. Leaves `chatLocation` at `sidebar` and no editor open. In VS Code 1.144.0 the Chat Location row never gets `is-configured`; the modified signal is the visible `.setting-item-modified-indicator` (the control shows it after D5), so D3 reads either. **Where its times come from**: the final full run of E9-default-editor, 30/10/2026 (13.8 s of 553.4 s in total; Windows 11, VS Code 1.144.0). NOT measured: macOS, Linux | `31a-default-tab` to `31f-back-to-sidebar` |

After every step it asserts the webview logged **no CSP violation and no uncaught exception**. At
the end it asserts that the fixture wrote its state file, which proves the server that answered was
the fixture. Two `warn`s are expected to show up now and then: the contrast of a weak highlighted
token in a theme that is not strict (step 4), which depends on the colours, not on a model; and
VS Code's own "Found unexpected null" race while it mounts the webview, which is VS Code's, not
ours (only that exact message with that stack; any other exception still fails).

**"Always allow".** The script only opens that panel (the "Always allow…" toggle), checks it, goes
Back and presses "Allow once". It never asks for "Yes, always allow": the click helper throws on
that text, and before every button click it checks in the page that the element under the pointer
is the intended button and not an /always/ button other than that toggle. That does not cover a
layout shift in the few milliseconds between the check and the click, nor clicks made by selector
(textarea, file links, code buttons), which never target a request card.

## How the extension runs the fixture

`src/extension/testLaunch.ts` lets the extension run a `.mjs` as its server through Node. It was
only on in `ExtensionMode.Test` (the `fake-server` integration suite); this run launches VS Code
with `--extensionDevelopmentPath` and no `--extensionTestsPath`, which VS Code treats as
`ExtensionMode.Development`, so it is also on there, but only with `OPEN_VS_CODE_VISUAL_FAKE=1` next
to `OPEN_VS_CODE_TEST_NODE` (an absolute Node path). Only `vscodeProcess.mjs` sets them. An
installed `.vsix` is in production mode and never runs a script as a server, whatever the
environment holds. The profile's `openVsCode.opencodePath` is the fixture, and the fixture reads
`FAKE_OPENCODE_MODE=visual` (a bigger catalog, a `find` that walks the folder), a state file and a
one-hour lifetime. Prompts carry plain trigger words that the fixture reacts to (`MARKDOWN`,
`LONG`, `ASK_PERMISSION`, `ASK_QUESTION`, `SUBAGENT`, `TOOLS`, `BROKEN_READ`, `COSTLY`,
`EDIT_FILES`, `LARGE`); the header
of `fake-opencode.mjs` says what each one plays and where its shape comes from.

## Where things go

- Screenshots: `.vscode-test/visual/shots/` (ignored by git); a filtered run writes to
  `shots-partial/` instead. The paths are printed at the end.
- README crops: for the shots listed in `README_CROPS` (`run.mjs`), a PNG of only the chat
  webview goes to `.vscode-test/visual/readme/` (the full-window shots carry the VS Code logo
  watermark, toasts and the temporary workspace path). The images of the root README
  (`docs/images/`) are copied from there BY HAND after looking at each one. Since the run moved to
  the synthetic server the text in them is the fixture's, not a model's: check that no user path
  or leftover card appears.
- Profile and extensions dir: `.vscode-test/visual/user-data` and `extensions`, wiped at the start
  of every run. Your own VS Code and its `settings.json` are not touched.
- The fixture's state file: `.vscode-test/visual/fake-opencode-state.json` (wiped at the start). The
  run also points `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` to
  `.vscode-test/visual/opencode-xdg` as a safety net; the fixture writes nothing there.
- The workspace is a temporary folder with `src/sample.ts` and a dummy `.env`, deleted at the end.
- At the end, after an exception, and on Ctrl+C / SIGTERM, VS Code is closed with its whole process
  tree (`taskkill /T /F` by absolute path on Windows, process group on POSIX) and the workspace is
  deleted. A hung CDP call is cut after 20 s so that cleanup is reached. A `kill -9` of the script
  itself cannot be handled: then VS Code and the fixture stay and must be closed by hand.

## How it works

- `vscodeProcess.mjs`: gets the `stable` VS Code that `@vscode/test-electron` caches in
  `.vscode-test/`, launches it with an isolated profile, `--disable-extensions`,
  `--extensionDevelopmentPath`, a free `--remote-debugging-port` and a clean environment
  (`ELECTRON_RUN_AS_NODE` and `VSCODE_*` removed, plus the fixture variables above).
- `run.mjs`: Playwright (`playwright-core`, no browsers downloaded) connects to the workbench over
  CDP for real mouse and keyboard, screenshots and the command palette.
- `webviewCdp.mjs`: the webview is an out-of-process iframe that Playwright does not expose, so it
  is reached through its own CDP target (`type: iframe`, `extensionId=sergwei.open-vs-code`) with
  `Runtime.evaluate` inside `iframe#active-frame`, and `Log.enable` to catch CSP violations.
- The profile sets `window.dialogStyle: custom` (step 9): a modal dialog drawn by the workbench is
  DOM (`.monaco-dialog-box`) that Playwright can press, whereas a native one is an Electron message
  box that CDP cannot see. If step 9 fails with "the confirmation modal never appeared as DOM", the
  style was not honoured; do not work around it in production code (see the plan, risk 1).
- The profile sets `openVsCode.chatLocation: sidebar` (the `chatLocation` option of `startVSCode`,
  `'sidebar'` by default, `null` writes no key). Since E5 (#77) the extension's own default is
  `editor`, and steps 0-26 judge the chat in the side bar; the default itself is judged by D0 of
  step 25 (a window with `chatLocation: null`) and by step 31 (the key taken out of the live
  profile).
- Themes change by writing `workbench.colorTheme` into the profile's `settings.json`, which VS
  Code reloads live.

## Troubleshooting

- "could not connect to VS Code over CDP": another VS Code with the same profile, or the window did
  not start. Look at the screenshot `FAIL-*` of the failing step.
- A step fails waiting for the server: look at `exthost/sergwei.open-vs-code/OpenCode.log` of the
  run (under `.vscode-test/visual/user-data/logs`). `binary detection failed: spawn EFTYPE` means
  the seam of `testLaunch.ts` was off in the extension host (see "How the extension runs the
  fixture").
- Selectors (`.activitybar`, `.notification-toast`, `#status.editor.selection`) are internal to VS
  Code, not API: a new release may move them.
