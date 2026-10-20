# src/shared

Typed host <-> webview message protocol (issue #3). Both the extension host and the webview
import from here, so it must compile and run in both.

Rules for everything in this folder:

- No `vscode` imports.
- No DOM types or APIs.
- No Node-only APIs.
- No `@opencode/client` types: the protocol is semantic and wire-independent. The host adapter
  (issues #9/#14) translates opencode v2 events into these messages.

Two mechanisms enforce this, and neither is enough alone:

- `src/shared/tsconfig.json` (`types: []`, `lib: ES2023`, no DOM) blocks ambient globals (Node,
  DOM). It does NOT block `import "vscode"` or `import "@opencode/client"`: TS resolves a package
  import to `node_modules` regardless of `types`. Check it with `npm run check-types:shared`.
- `neutrality.test.ts` reads every other `src/shared/*.ts` with `node:fs` (tests included; test
  files may import `vitest` and `node:fs`) and fails on any import, re-export, dynamic `import()`
  or `require(` that is not relative, in any quoting or spacing, and on any
  `/// <reference types|lib|path>` directive in production files (those would bring Node or DOM
  globals back past the tsconfig). It is a regex over raw text: it also flags specifiers written
  in comments, and cannot see specifiers built at runtime. It skips itself by name, because its
  fabricated samples would trip it. The ESLint rule of issue #4 covers the same ground once it
  lands.

Test files are excluded from that tsconfig (they are test code and may use Node/vitest globals
later) and are type-checked by the root `npm run check-types`. Run the tests with
`npx vitest run src/shared` until issue #4 adds the Vitest config and the `test` script.

## Files

- `model.ts` - domain types (sessions, messages, parts, permissions, forms). Types only.
- `protocol.ts` - the two unions (`HostToWebview`, `WebviewToHost`), the guards, `dispatch`,
  `Sender` / `Handlers` and `contentPartId`.
- `neutrality.test.ts` - fails if any file here imports a non-relative module.
- `protocol.test.ts` - unit tests with FABRICATED data (they prove the guards' logic, not the
  opencode wire format).

## Who validates what

- `isWebviewToHost` is DEEP: the webview renders LLM output and is untrusted input. After it
  passes, the host must read fields one by one and never spread the message into SDK calls.
  Path policy, id existence and sizes are the host handler's job.
- `isHostToWebview` is SHALLOW (object + known `type`): the host is our own typed code, and
  validating each `part.delta` at streaming rate costs more than it protects.

## Identity of content blocks

opencode v2 gives `text` and `reasoning` blocks no id. The host synthesizes
`contentPartId(messageID, index)` = `${messageID}#${index}` (index in the message `content[]`).
`tool` blocks keep the opencode tool id. The counter lives in the host adapter (issue #14).

## What is NOT here

Wiring: `webview.postMessage`, `acquireVsCodeApi`, the queue until `ready` and the `Sender`
bindings are issue #2. The wire-to-protocol adapter is issues #9/#14.
