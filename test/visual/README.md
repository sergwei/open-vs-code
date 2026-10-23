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

## What it does

Every step is asserted; nothing is skipped because of what a model did.

| Step | Checks (assertions) | Screenshots |
|---|---|---|
| 1 empty state | "Connected", title "Untitled session", New session button, suggestions | `01-empty` |
| 2 Markdown | a `MARKDOWN` reply streamed in deltas (the shot at 3 s sees an unfinished block); code actions, highlighting, a rendered table, no inline `style`, only http(s)/mailto links, click on `src/sample.ts:20` gives `Ln 20`, New file gets a language | `02a`, `02b`, `02c` |
| 3 Stop | a `LONG` reply (the numbers 1 to 400, about 16 s); Stop visible, Escape stops, a neutral "Stopped" note (message level) with no `role="alert"` and no red box, ArrowUp recalls the prompt | `03a`, `03b` |
| 4 themes | code and token contrast >= 4.5 (tokens only in the high-contrast themes; weak tokens elsewhere are warnings) | `04-theme-{light,dark,hc-dark,hc-light}` |
| 5 permission | `ASK_PERMISSION` in a new session: toast and badge with the view hidden, focus in the card, the "Always" panel has one primary button, "Allow once", badge cleared, and an "Allowed once" line under the tool in the conversation (not in the dock, not an alert) | `05a`-`05d` |
| 6 question | "Allowed once" survives the next prompt; `ASK_QUESTION`: question card shown and focused, option B answered, gone, and an "Answered … Letter: B" line in the conversation | `07a`, `07b` |
| 6b reject | a plain Reject (never Always): the turn ends, a "Rejected" line under the tool, no alert, no red box, earlier lines still there | `07c` |
| 7 Restart Server | same conversation and title afterwards, and the same answered-request lines (the fixture relaunched keeps the conversation in its state file) | `08a` |
| 8 Reload Window | same conversation and title afterwards; "Answered … Letter: B" and "Rejected" are read back from the tool blocks; "Allowed once" is asserted GONE, because the server keeps no trace of an allowed permission and the host memory dies with the window. Against the fixture this checks the host's side only | `09` |
| 9 sessions (#20) | the Sessions button opens a list with groups, times and exactly one open session marked in the four themes; focus in the search box, ArrowDown enters the list with a visible focus, Escape returns the focus to the button; New session leaves the empty view and creates NO session; the first prompt creates it (a `LONG` one, so it is still running: it says "Running" in text); in-line rename shows in the row AND the header; the search finds only that session, case-insensitively; clicking another row opens it and closes the list; Delete asks in the MODAL dialog of VS Code (named session, "cannot be undone"), Cancel keeps everything, Delete removes it and empties the view with no "deleted outside" notice | `10a`-`10i` |
| 10 fork and subagents (#21) | every user message (not the assistant's) has a "Fork from here" named after it; the action bar shows on hover (that message's only) and on Tab with a focus ring; the fork opens with only the first exchange, a "Forked from" crumb, the prompt refilled with the forked text and focused, and a "Fork" word in the session list; the crumb returns to the intact original. Then a `SUBAGENT` turn: the block gets "Open subagent session", the child shows a "‹ parent" crumb that goes back, and the parent lists "Subagent sessions (1)" that opens it again | `11a`-`11h` |
| 11 model and agent selectors (#23/#24) | the prompt row has a Build/Plan switch and a model button ("(default)" on a new session) and the header no longer has the marker; the model panel opens upwards with the focus in "Search models", grouped by provider, one model marked current, shot in the four themes; typing a name filters, ArrowDown enters the list with a visible focus, Enter picks, closes and returns the focus to the button; Escape closes without picking; a press outside the panel and outside "More agents" closes it (the fixture's catalog has a custom agent, `docs`); Plan by mouse, Tab lands on the switch with a ring, arrows change the agent, Enter on it does NOT send the prompt; a prompt makes the reply read "Plan · " plus the chosen model's name; the next new session proposes the last used model and Build; the `openVsCode.defaultModel` setting beats the last used model, a malformed value is reported once and ignored; reopening the session shows its model and agent | `12a`-`12h` (step 11's shots use the prefix `12`; there is no step 12) |
| 13 attachment (review #1015 S1) | a real file is picked with the real Attach button (VS Code's own file dialog, `files.simpleDialog.enable`), shows as a chip, and the prompt sent with it leaves (the message shows the file, the chip is gone, no alert) with no exception: the pre-fix code threw `DataCloneError` here | `13a`, `13b`, `13c` |
| 14 reasoning variant (#61) | the fixture's catalog has two models with variants (low, high) and one without (`tiny-context`); the model without variants shows no control; the control reads "Reasoning: Default" right after the model button, its panel (Default current + the catalog ids) opens with the real mouse with the focus on the current entry, shot closed and open in the four themes; choosing a variant closes it and the control reads `Reasoning: ` plus the id; Tab from the model button reaches it with a visible ring, Enter opens, ArrowUp moves, Escape returns the focus, a press outside closes it; re-choosing the same model keeps the variant, another model starts on Default; a prompt makes the reply line end in the variant; a new session proposes the last model with its variant; reopening the session shows the variant the server stored; no `style` attribute | `14a`-`14h` |
| 15 tool cards (#26) | one `TOOLS` prompt: the fixture plays nine tool calls (shell twice, read, edit, write, grep, glob, webfetch, an MCP-style tool); every card is folded by default (`aria-expanded=false`, no `.tool-body` in the DOM, no style attribute); for shell, read, edit and grep: Shift+Tab from the prompt box reaches its toggle with a visible ring, Enter opens it (the log keeps the same number of children) and the body is right (shell: output of `node --version`; read: the file; grep: the pattern; edit: a diff with added AND deleted lines), Space closes it; the edit diff is measured in the four themes (text contrast >= 4.5); the header of the LAST card (its `data-tool` is printed, `mcp_echo`) stays in view after unfolding it (auto-scroll); then a `BROKEN_READ` prompt: a read of the missing `src/does-not-exist.ts` fails with opencode's error, and the card must say "failed" with the first error line in the header ("·" separators), stay folded, fit its toggle, show the same line when unfolded and have an error chip and an error body with text contrast >= 4.5 in the four themes; the path button of the read card opens `src/sample.ts` in the editor | `15a`-`15f` |
| 16 `@` mentions and editor context (#28/#29) | writes a second file (`src/sample-extra.ts`) so the popup has two rows (the fixture's `find` walks the served folder in this mode); typing `@sample` with the real keyboard opens a listbox with the two files (relative names), the box keeps the keyboard focus and points at the highlighted option (`aria-controls`, `aria-activedescendant`) and Send is not locked; text contrast of a normal row, the highlighted row (name and folder) and the "No files match" line is measured in the four themes (>= 4.5); one more key and Enter at once, while the rows are those of the older text, neither sends nor picks; ArrowDown moves the highlight and Enter adds the chip `src/sample.ts` AND writes `@src/sample.ts ` in the box without sending; ArrowUp with the popup closed recalls the last prompt; with a `LONG` turn RUNNING, Escape with the popup open closes it and does NOT stop the turn, a second Escape does; a real mouse press on a row picks it and the focus stays in the box; pressing the chip opens `src/sample.ts` in the editor; selecting lines 2-3 in that editor and pressing "Add selection" adds the chip `src/sample.ts#2-3` (this proves the active editor is still the active editor when the focus is in the chat); sending with both chips shows both in the conversation; pressing the conversation chip of the range opens the file at "Ln 2"; no `style` attribute and no webview error | `16a`-`16f` |
| 17 context and cost line (#25) | a new session shows no line; after a normal turn (4248 tokens per step in the fixture) the dimmed line under the title reads exactly `Context 4K / 200K (2%)` with no cost (the model is free) and level `normal`; then a `COSTLY` turn on the `tiny-context` model (5000-token window) reads `Context 4K / 5K (85%) · $0.01` with level `high`. In both it is a plain `<p>` (no role, `aria-label` or `title`): the shorthand is `aria-hidden` (and carries the tooltip) and a visually hidden span holds the full sentence with exact figures, which is all a screen reader reads (not a live region); it sits right under the title bar, has no `style` attribute and fits its width; its text contrast is measured in the four themes in each state (>= 4.5). A compaction has no UI before issue #34 and stays in the Vitest e2e | `17-context-line-{normal,high}-<theme>` |

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
`LONG`, `ASK_PERMISSION`, `ASK_QUESTION`, `SUBAGENT`, `TOOLS`, `BROKEN_READ`, `COSTLY`); the header
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
