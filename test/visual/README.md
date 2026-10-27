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
  focus under it is unverified, macOS needs `Cmd+B` where step 5 sends `Control+B`, and contrast
  and screenshots vary per system. It takes about 6 minutes on the development machine.
- Needs Node 22+ (global `WebSocket`) and a display (a real window opens; on Linux use `xvfb-run`).
- Exit code `0` when every assertion held, `1` when any failed, `2` when it could not start (the
  build is missing, or the VS Code download, launch or CDP connection failed).
- Save the output with `npm run test:visual > .vscode-test/visual/run-output.txt 2>&1` to reread it.

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
| 0 setup guide (E2, #85) | VS Code starts with `openVsCode.opencodePath` at a file that does not exist and the fixture's `.down` marker in place: the guide "Set up opencode" replaces the view (no header, no prompt box), step 1 says "Failed" in words and names the searched path; at 300 px, ~900 px and under 200 px, in the 4 themes: text block >= 60 % of the guide, no sideways overflow, contrast >= 4.5, buttons BELOW the text when narrow. "Choose binary…" is pressed with the real mouse and the path typed in VS Code's file dialog (plan B, `writeSettings`, if the dialog refuses the `.mjs`: printed as a `warn`); step 1 turns done and step 2 fails (marker); the marker is deleted, Restart is pressed and the normal empty state returns | `00-guide`, `00b`, `00c`, `guide-<width>-<theme>` |
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
| 21 settings UI (#38) | opens "Preferences: Open Settings (UI)", types `@ext:sergwei.open-vs-code` in its search box and reads the editor's DOM (`.settings-editor .setting-item`, internal to VS Code): exactly 3 settings, in the manifest `order`, shown with the labels VS Code derives, `Open Vs Code: Opencode Path`, `Open Vs Code: Server Url` and `Open Vs Code: Default Model` (the extension-name prefix is VS Code's, an `id` on the category did not remove it; each label is printed in its own `ok` line); each description contains its first sentence; the `` `#openVsCode.serverUrl#` `` reference of the first setting is painted as a link (`<a>`; this step only sees the backtick form: the bare `#id#` showing as literal text was seen once by hand over CDP, VS Code 1.143.1, Windows 11, 2026-10-25, and is not a check of this step) and a real mouse click on it focuses the second setting. The editor opens in VS Code's own overlay and is closed with Ctrl+W. Like the whole run, it is checked only on Windows | `21a-settings`, `21b-settings-link` |
| 22 palette commands and shortcuts (#35) | focus in `src/sample.ts` (quick open), the REAL keyboard: Ctrl+Alt+P (Cmd+Alt+P on macOS) puts the caret in the prompt box of the chat, and again returns the focus to the editor; Ctrl+B hides the chat WHILE IT HOLDS THE FOCUS and Ctrl+Alt+P shows it again with the caret in the prompt (a stale `openVsCode.chatFocused` would send the focus to the editor instead); with text typed, Ctrl+Alt+N (only bound while the chat has the focus) leaves the empty view, keeps the draft and the focus and creates NO session (the state file of the fixture keeps its count); a `LONG` turn is interrupted from the palette with "OpenCode: Stop Response" while the editor has the focus ("Stopped" note and live region); with nothing running the same command shows "No response is running" with contrast >= 4.5 in the four themes. Key presses are only exercised with `Control+Alt` on Windows. With the "+" menu OPEN (E2 #85, phase 4), Ctrl+Alt+N still leaves the empty view and Ctrl+Alt+P still moves the focus to the editor, and both close the menu. With the CHIP panel open, Ctrl+Alt+P moves the focus to the editor and closes the panel ("with the chip panel open moves the focus to the editor and closes the panel"); Ctrl+Alt+N is not pressed with the chip panel open | `22a`-`22e`, `22c2` |
| 23 "+" menu and compact state (E2 #85, phase 4) | the "+" button ("Add context", tooltip "Add context: selection, files, images or a mention") opens a menu with Add selection, Attach file…, Attach image… and Mention a file: Enter or Space open it with the focus on the first item, the arrows wrap, Home/End jump, Escape closes and returns the focus to the button, Tab closes without dropping the focus onto the page, a press outside closes it; "Mention a file" writes `@` and opens the file popup; at 300 px, about 900 px and under 200 px, in the four themes, the "+", the chip and Send do not overlap, nothing sticks out of the view and the page does not scroll sideways; under 200 px the chip takes a row of its own at the width of the box; the menu opens inside the view with item contrast >= 4.5. At about 900 px, in the four themes, the chip panel (reconciliation C1) is judged by boxes: the Agent and Model columns side by side (not stacked), Reasoning inside the Model column under the model list, the panel inside the view with no sideways scroll, row and column-title contrast >= 4.5, and Escape closes it and returns the focus to the chip. Steps 13 and 16 open this menu to pick Attach file… and Add selection (they were loose text buttons before phase 4), and step 20 reads the Shift-drop hint on the "Attach file…" item | `23-bar-*`, `23-menu-*`, `23-chip-panel-wide-*` |

After every step it asserts the webview logged **no CSP violation and no uncaught exception**. At
the end it asserts that the fixture wrote its state file, which proves the server that answered was
the fixture. The only `warn` that can remain is the contrast of a weak highlighted token in a theme
that is not strict (step 4), which depends on the colours, not on a model.

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

- Screenshots: `.vscode-test/visual/shots/` (ignored by git). The paths are printed at the end.
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
