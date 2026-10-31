# Integration tests

Mocha tests that run inside a real VS Code (downloaded to `.vscode-test/`) through
`@vscode/test-cli`. Vitest does not pick them up (it only includes `src/**/*.test.ts`).

## Run

```sh
npm run test:integration
```

This script is self-sufficient: it builds the host and the webview (development bundles), bundles
the tests to `out/test/integration` (esbuild, CommonJS) and then runs `vscode-test`. The exit code
is non-zero if any test fails. The first run downloads VS Code (hundreds of MB, once per
checkout/worktree). It opens a real VS Code window for a few seconds.

### Duration

Measured on Windows 11, 31/10/2026, in `.vscode-test/integration-test-speed-1.txt` (the Mocha
`passing (…)` line of each label; exit 0, wall clock 197 s as noted in the phase, with
`OPEN_VS_CODE_REAL_OPENCODE` unset):

| Label | Passing | Mocha time |
|---|---|---|
| `main` | 43 (+1 pending) | 37 s |
| `external-server` | 9 | 9 s |
| `fake-server` | 44 | about 2 min (Mocha prints `2m`; about 110 s by the timestamps of the log) |
| `default-location` | 5 | 6 s |
| `real-opencode` (opt-in) | 16 | 20 s, in the baseline of 30/10/2026 (`OPEN_VS_CODE_REAL_OPENCODE` set: 223 s wall clock, 117 passing + 1 pending in all) |

Each label starts its own VS Code, which costs a few seconds on top of the Mocha time (about 20 s
for the five starts of the baseline). The build before them is about 3.5 s on a warm checkout
(`build:host` 0.83 s, `build:webview` 1.88 s, `compile:integration` 0.84 s).

**Fixed waits.** The `SETTLE_MS` sleeps were about 97 s of the 199 s of Mocha in the baseline
(`fake-server` 41 x 1.5 s, `chatPanel` 18 x 1.5 s, `default-location` 3 x 1.5 s, `external-server`
2 x 2 s). Only the ones that precede something that must HAPPEN were moved to `waitForQuiet`
(3 of the 18 in `chatPanel` and 8 of the 41 in `fakeServer`): they wait for that condition and no
longer for a fixed time. The rest stay as fixed sleeps on purpose: they are NEGATIVE windows (the
check is that something does NOT show up), and a window that ends as soon as nothing has happened
yet would prove nothing; shortening them only weakens the check. 36 mentions of `SETTLE_MS` remain
in `fakeServer.test.ts` and 17 in `chatPanel.test.ts`. The real saving was about 17 s, not the 97 s
that the sleeps add up to. The lever for time is the policy (run only the affected labels while
iterating, the full run once per task: `test/visual/README.md`, "What to run when"), not these
waits.

**No fingerprint.** The code fingerprint of `test/visual/fingerprint.mjs` is only valid for
`test:visual`: it hashes neither `test/integration/**` nor `.vscode-test.mjs`, so it cannot say
whether an integration run still covers the tree. The integration suite is rerun whole (about
200 s) whenever the CODE changed, `test/integration/**` and `.vscode-test.mjs` included.
Comments, README and markers do not count: whoever changes a file judges it from the diff. The `.vscode-test/*.txt` paths cited above are local files that the next run
overwrites; the figures are the ones copied here.

Other scripts: `npm run compile:integration` (only bundles the tests) and
`npm run check-types:integration` (type-checks them; part of `npm run check-types`).

`out/` is not cleaned: delete `out/test/integration` if you remove a test, or the old bundle keeps
running.

## CI contract (issue #5)

- Linux needs a display: `xvfb-run -a npm run test:integration`. Windows and macOS: as is.
- Needs network on the first run (VS Code download). Cache `.vscode-test/vscode-*` if wanted.
- `npm run test:integration` runs every configuration that is not opt-in: `main`,
  `external-server`, `fake-server` and `default-location`.
- Run it before `npm run vsix` (that one rebuilds `dist/` in production mode).

## How the tests observe the extension

They read `OpenCode.log` of the isolated user data dir
(`.vscode-test/user-data/logs/<session>/window*/exthost/sergwei.open-vs-code/OpenCode.log`). The
path and format are internal to VS Code. If a test fails with "OpenCode.log not found", look at the
listing in the error and at that folder. Settings are written into the isolated profile, never into
your own `settings.json`.

The opt-in `real-opencode` suite creates and removes sessions in a real opencode, so
`.vscode-test.mjs` points opencode's `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` to
`.vscode-test/real-opencode-xdg` (in the environment of the test VS Code, inherited by the
extension host and by `opencode serve`). It does not add sessions to your
`~/.local/share/opencode`. Checked on Windows 11 with opencode 2.0.32 (a new `opencode.db`
appears there, the real one keeps its modification time); POSIX is unchecked.

## Where the chat lives in the test profiles (E5 of #77)

The default of `openVsCode.chatLocation` is `editor`, but the existing suites verify the `sidebar`
mode (a view that resolves, a snapshot sent to it). So `.vscode-test.mjs` writes
`"openVsCode.chatLocation": "sidebar"` (`TEST_CHAT_LOCATION`) into the `settings.json` of the four
profiles (`main` and `real-opencode` share one) every time it loads, and the cases that switch
modes restore with `restoreChatLocation` (`support/chatLocation.ts`), never with
`setChatLocation(undefined, …)`, which would now mean `editor`.

The default itself is checked by the `default-location` configuration (`defaultLocation.test.ts`):
its own profile `.vscode-test/user-data-default`, deleted and recreated with `settings.json` `{}`, no
folder and no server. It proves what VS Code registers as default, that the first activation logs
`chat location at start: editor`, that the Chat view does not resolve until `sidebar` is written,
that New Session opens a tab, and that an unknown value reads as `editor` in the host and in the
views. Run only it: `npm run test:integration -- --label default-location`.

## The opt-in `real-opencode` suite: a contract, never a turn

`realOpencode.test.ts` never sends a prompt (tooling/tests-without-model), so it spends no quota
and passes with the free model exhausted. It checks what can break between the extension and a
real opencode v2 without a model answering: the start path inside a real VS Code, the chat view
reaching the stream and loading the catalog (`catalog loaded (n models, m agents, k commands)`), the `@` file
search, restart and crash recovery, the external-server connection with its real 401, and, with a
server of its own (`startOwnServer` in `support/serverCases.ts`) and the full client, the shapes
of the catalog, agents, providers, the session lifecycle and its first SSE events, the pending
lists and `file.find`. A turn (text in parts, tokens, tools, permissions raised by a model) is
covered on the synthetic server by `fake-server` and `npm run test:visual`, and the shapes of a
real turn are compared with the synthetic one by the opt-in `npm run test:event-shapes`
(`src/extension/test-fixtures/eventShapes.contract.ts`), which needs a model that answers.
Run it with `OPEN_VS_CODE_REAL_OPENCODE=<opencode.exe> npm run test:integration -- --label real-opencode`.

## The `external-server` configuration (issue #11)

`externalServer.test.ts` runs in its own configuration (`external-server` in `.vscode-test.mjs`),
not opt-in, with its own user data dir `.vscode-test/user-data-external` and an empty workspace
folder under the OS temp dir. Why a separate profile: the suite stores secrets and writes
`openVsCode.serverUrl`, and a run that dies half way must not leave either in the profile of
`main`. `.vscode-test.mjs` rewrites that profile's `settings.json` on every start, so the first
activation is already in external mode (`serverUrl` on the discard port 9, no password) and
`openVsCode.opencodePath` points at a file that does not exist, which makes it impossible to
launch a real opencode by accident. The "external server" is `fake-opencode.mjs` started by the
test (synthetic); the real one is the last case of the opt-in `real-opencode` suite. Passwords are
stored with the test-only command `openVsCode.test.setServerPassword` (an input box cannot be
typed into). The configuration passes `--password-store=basic` on all three systems (it is in
the `launchArgs` of `.vscode-test.mjs` unconditionally), so SecretStorage works without a keyring
under `xvfb-run`.

## The `fake-server` configuration (issue #41)

`fakeServer.test.ts` runs in its own configuration (`fake-server` in `.vscode-test.mjs`), not
opt-in, so it runs in CI on Windows, macOS and Linux with no network and no model. The extension
runs the synthetic opencode (`src/extension/test-fixtures/fake-opencode.mjs`) as its OWN server in
a folder it is serving: setting -> detection -> spawn -> stream -> turn, stop, `@` search, editor
context, permissions (view hidden and visible), a question, restart and crash recovery.

- **Synthetic.** A pass proves our wiring, not that the real opencode answers like this. The real
  server is checked by the opt-in `real-opencode` suite (API shapes without a turn, the real 401 of
  an external server). Every turn case lives here, model and agent choice and the reasoning variant
  included.
- **How a `.mjs` becomes the server.** The profile's `settings.json` (rewritten on every start,
  before VS Code runs) sets `openVsCode.opencodePath` to the fixture. In `ExtensionMode.Test` and
  with `OPEN_VS_CODE_TEST_NODE` set (the config does), `src/extension/testLaunch.ts` makes the
  extension run a `.mjs` as `node <mjs>`, both for `--version` and for `serve`. The `.exe` / shim
  resolution of a real install is NOT exercised here (unit tests and `real-opencode` do).
- **Folders** live under `.vscode-test/fake-server/` of the checkout (`workspace` is served,
  `outside` holds the OutsideWorkspace file) and are wiped on every load of the configuration.
  `FAKE_OPENCODE_LIFETIME_MS` raises the fixture's 60 s cap.
- **Run only this suite:** `npm run test:integration -- --label fake-server` (about 2 min; see
  "Duration" above).
- The cases share one server and one session and run in order; the last two (restart, kill)
  replace the server.

## Running it from inside VS Code (agents, integrated terminals)

A process that descends from a VS Code extension host inherits `ELECTRON_RUN_AS_NODE=1` and many
`VSCODE_*` variables. `ELECTRON_RUN_AS_NODE` makes the test VS Code behave as plain Node (exit
code 9 seen in an agent environment; the link is a HYPOTHESIS, not reproduced). The `VSCODE_*`
ones might attach the test instance to the parent (HYPOTHESIS). The config in `.vscode-test.mjs`
clears them all for the child process.

The user data dir is private, so the tests should be able to run while your own VS Code is open.
HYPOTHESIS until the first local run (read in the VS Code sources, never run).

## What is not covered

The notification and its buttons, and anything inside the webview iframe (DOM, CSP, themes). Those
are covered by the opt-in visual run, `npm run test:visual` (see `test/visual/README.md`), which
drives a real VS Code over CDP; only what is subjective stays with a human F5.
