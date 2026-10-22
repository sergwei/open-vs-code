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

Other scripts: `npm run compile:integration` (only bundles the tests) and
`npm run check-types:integration` (type-checks them; part of `npm run check-types`).

`out/` is not cleaned: delete `out/test/integration` if you remove a test, or the old bundle keeps
running.

## CI contract (issue #5)

- Linux needs a display: `xvfb-run -a npm run test:integration`. Windows and macOS: as is.
- Needs network on the first run (VS Code download). Cache `.vscode-test/vscode-*` if wanted.
- Run it before `npm run vsix` (that one rebuilds `dist/` in production mode).

## How the tests observe the extension

They read `OpenCode.log` of the isolated user data dir
(`.vscode-test/user-data/logs/<session>/window*/exthost/sergwei.open-vs-code/OpenCode.log`). The
path and format are internal to VS Code. If a test fails with "OpenCode.log not found", look at the
listing in the error and at that folder. Settings are written into the isolated profile, never into
your own `settings.json`.

The opt-in `real-opencode` suite sends real prompts, so `.vscode-test.mjs` points opencode's
`XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` to `.vscode-test/real-opencode-xdg` (in the
environment of the test VS Code, inherited by the extension host and by `opencode serve`). It does
not add sessions to your `~/.local/share/opencode`. Checked on Windows 11 with opencode 2.0.32 (a
new `opencode.db` appears there, the real one keeps its modification time, and the free model
works); POSIX is unchecked.

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
