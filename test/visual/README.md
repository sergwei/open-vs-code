# Visual tests (`npm run test:visual`)

Drives a **real VS Code** with the extension loaded and checks what no unit or integration test
can see: how the chat looks in the four themes, the notification and the badge with the view
hidden, focus on request cards, Stop, and that Restart Server and Reload Window keep the session.
It also takes screenshots. Born from a manual CDP run on 20/10/2026 that found two real bugs
(code unreadable in High Contrast Light, Stop painted as a red error).

## Run

```powershell
$env:OPEN_VS_CODE_REAL_OPENCODE = "C:\path\to\opencode.exe"   # the .exe, not the .cmd shim
npm run test:visual
```

```sh
OPEN_VS_CODE_REAL_OPENCODE=/path/to/opencode npm run test:visual
```

- **Opt-in**, like the `real-opencode` integration suite: without the variable the script exits
  with code 2 and a message. It sends real prompts to the free default model, so it needs network.
  It takes several minutes and is not run in CI.
- The script builds the host and the webview first (development bundles), then launches VS Code.
- Needs Node 22+ (global `WebSocket`) and a display (a real window opens; on Linux use `xvfb-run`).
- Exit code `0` when every assertion held, `1` when any failed, `2` when it could not start (the
  variable or the build is missing, or the VS Code download, launch or CDP connection failed).

## What it does

| Step | Checks (assertions) | Screenshots |
|---|---|---|
| 1 empty state | "Connected", title "Untitled session", New session button, suggestions | `01-empty` |
| 2 Markdown | code actions, highlighting, no inline `style`, only http(s)/mailto links, click on `src/sample.ts:20` gives `Ln 20`, New file gets a language | `02a`, `02b`, `02c` |
| 3 Stop | Stop visible, Escape stops, a neutral "Stopped" note (message level) with no `role="alert"` and no red box, ArrowUp recalls the prompt | `03a`, `03b` |
| 4 themes | code and token contrast >= 4.5 (tokens only in the high-contrast themes; weak tokens elsewhere are warnings) | `04-theme-{light,dark,hc-dark,hc-light}` |
| 5 permission | starts in a new session (step 3 told the model not to use tools), toast and badge with the view hidden, focus in the card, the "Always" panel has one primary button, "Allow once", badge cleared, and an "Allowed once" line under the tool in the conversation (not in the dock, not an alert) | `05a`-`05d` |
| 6 question | "Allowed once" survives the next prompt; question card shown and focused, answered, gone, and an "Answered … Blue" line in the conversation | `07a`, `07b` |
| 6b reject | a plain Reject (never Always): a "Rejected" line under the tool, no alert, no red box, earlier lines still there. Skipped with a warning if the model never calls `read` | `07c` |
| 7 Restart Server | same conversation and title afterwards, and the same answered-request lines | `08a` |
| 8 Reload Window | same conversation and title afterwards; "Answered … Blue" and "Rejected" are read back from the tool blocks (this also checks that REST `message.list` returns what the database holds); "Allowed once" is asserted GONE, because opencode keeps no trace of an allowed permission and the host memory dies with the window | `09` |
| 9 sessions (#20) | the Sessions button opens a list with groups, times and exactly one open session marked in the four themes; focus in the search box, ArrowDown enters the list with a visible focus, Escape returns the focus to the button; New session leaves the empty view and creates NO session; the first prompt creates it (and a running one says "Running" in text); in-line rename shows in the row AND the header; the search finds only that session, case-insensitively; clicking another row opens it and closes the list; Delete asks in the MODAL dialog of VS Code (named session, "cannot be undone"), Cancel keeps everything, Delete removes it and empties the view with no "deleted outside" notice | `10a`-`10i` |
| 10 fork and subagents (#21) | every user message (not the assistant's) has a "Fork from here" named after it; the action bar shows on hover (that message's only) and on Tab with a focus ring; the fork opens with only the first exchange, a "Forked from" crumb, the prompt refilled with the forked text and focused, and a "Fork" word in the session list; the crumb returns to the intact original. Then the model is asked to call the `subagent` tool: the block gets "Open subagent session", the child shows a "‹ parent" crumb that goes back, and the parent lists "Subagent sessions (1)" that opens it again. **The subagent half is SKIPPED with a warning if the free model does not call the tool** | `11a`-`11h` |
| 11 model and agent selectors (#23/#24) | the prompt row has a Build/Plan switch and a model button ("(default)" on a new session) and the header no longer has the marker; the model panel opens upwards with the focus in "Search models", grouped by provider, one model marked current, shot in the four themes; typing a name filters, ArrowDown enters the list with a visible focus, Enter picks, closes and returns the focus to the button; Escape closes without picking; Plan by mouse, Tab lands on the switch with a ring, arrows change the agent, Enter on it does NOT send the prompt; a real prompt makes the reply read "Plan · " plus the chosen model's name (**that half is SKIPPED with a warning if the free model fails**); the next new session proposes the last used model and Build; the `openVsCode.defaultModel` setting beats the last used model, a malformed value is reported once and ignored; reopening the session shows its model and agent | `12a`-`12h` (step 11's shots use the prefix `12`; there is no step 12) |
| 13 attachment (review #1015 S1) | a real file is picked with the real Attach button (VS Code's own file dialog, `files.simpleDialog.enable`), shows as a chip, and the prompt sent with it leaves (the message shows the file, the chip is gone, no alert) with no exception: the pre-fix code threw `DataCloneError` here. Also in step 11: a mouse press outside the model panel (and "More agents", when the server has a custom agent) closes it, keeping the model and the focus where the user clicked | `13a`, `13b`, `13c` |
| 14 reasoning variant (#61) | a model that lists variants is picked dynamically (glm-5.3-flash-free first); a model without variants shows no control; the control reads "Reasoning: Default" right after the model button, its panel (Default current + the catalog ids) opens with the real mouse with the focus on the current entry, shot closed and open in the four themes; choosing a variant closes it and the control reads `Reasoning: ` plus the id; Tab from the model button reaches it with a visible ring, Enter opens, ArrowUp moves, Escape returns the focus, a press outside closes it; re-choosing the same model keeps the variant, another model starts on Default; a real prompt makes the reply line end in the variant (**SKIPPED with a warning if the free model fails**); a new session proposes the last model with its variant; reopening the session shows the variant the server stored; no `style` attribute. **The whole step is SKIPPED with a warning when no model of the real catalog lists variants** | `14a`-`14h` |

After every step it asserts the webview logged **no CSP violation and no uncaught exception**.
Things that depend on what the model writes (a file reference in the reply, a table) are skipped
with a warning, never failed.

**"Always allow".** The script only opens that panel (the "Always allow…" toggle), checks it, goes
Back and presses "Allow once". It never asks for "Yes, always allow": the click helper throws on
that text, and before every button click it checks in the page that the element under the pointer
is the intended button and not an /always/ button other than that toggle. That does not cover a
layout shift in the few milliseconds between the check and the click, nor clicks made by selector
(textarea, file links, code buttons), which never target a request card.

## Where things go

- Screenshots: `.vscode-test/visual/shots/` (ignored by git). The paths are printed at the end.
- Profile and extensions dir: `.vscode-test/visual/user-data` and `extensions`, wiped at the start
  of every run. Your own VS Code and its `settings.json` are not touched.
- opencode's data, state and cache: `.vscode-test/visual/opencode-xdg` (wiped at the start). The
  script sets `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` in the environment of the test
  VS Code; the extension host and `opencode serve` inherit it, so the run does not add sessions to
  `~/.local/share/opencode`. Checked on Windows 11 with opencode 2.0.32: a new `opencode.db` is
  created there, the real one keeps its modification time, and the free model works without
  `XDG_CONFIG_HOME`. The run asserts the new database exists and warns if the real directory
  changed (it can also change if you use opencode elsewhere meanwhile). POSIX is unchecked.
- The workspace is a temporary folder with `src/sample.ts` and a dummy `.env`, deleted at the end.
- At the end, after an exception, and on Ctrl+C / SIGTERM, VS Code is closed with its whole process
  tree (`taskkill /T /F` by absolute path on Windows, process group on POSIX) and the workspace is
  deleted. A hung CDP call is cut after 20 s so that cleanup is reached. A `kill -9` of the script
  itself cannot be handled: then VS Code and `opencode serve` stay and must be closed by hand.

## How it works

- `vscodeProcess.mjs`: gets the `stable` VS Code that `@vscode/test-electron` caches in
  `.vscode-test/`, launches it with an isolated profile, `--disable-extensions`,
  `--extensionDevelopmentPath`, a free `--remote-debugging-port` and a clean environment
  (`ELECTRON_RUN_AS_NODE` and `VSCODE_*` removed).
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
- A step fails with a timeout waiting for the model: the free model or the network was slow; rerun.
- Selectors (`.activitybar`, `.notification-toast`, `#status.editor.selection`) are internal to VS
  Code, not API: a new release may move them.
