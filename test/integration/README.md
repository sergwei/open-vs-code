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
stay with the manual F5 check.
