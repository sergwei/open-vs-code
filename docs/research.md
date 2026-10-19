# Research: upstream reuse, reference extensions and the opencode event stream

Issue #6. Researched on 2026-10-19. Nothing was executed against a running server
(opencode was not installed on the research machine).

Markers: **VERIFIED** = read on 2026-10-19 in the cited source. **HYPOTHESIS** = inferred,
confirm before building on it. **UNVERIFIED** = not checked.

Pinned sources:
- `anomalyco/opencode` tag `v1.19.3` (`e3c4eb24`, released 2026-10-16) for the v1 line, and tag
  `v2.0.32` (`843a6c514e606b436a7fe713422ace0a93ad3d61`, 2026-10-16) for the v2 line. Repo license:
  MIT ("Copyright (c) 2025 opencode", `LICENSE` @v1.19.3).
- v2 claims marked VERIFIED are read at tag `v2.0.32` (`@843a6c51`), because that is what npm
  publishes (`@opencode/cli@2.0.32`, `@opencode/client@2.0.32`). Branch `dev` at `52a10f57`
  (2026-10-19) is cited only as "what is coming": it is 72 commits ahead of the tag (and 1 behind;
  GitHub compare reports `diverged`) and already adds `session.archived` / `session.unarchived`,
  which the tag does not define. Line numbers in `server-process.ts` at the tag are shifted by
  about -4 relative to `dev`; the numbers cited below are the tag's.
- npm registry on 2026-10-19: `opencode-ai@1.19.3`, `@opencode-ai/sdk@1.19.3`,
  `@opencode-ai/ui@1.19.3`; `@opencode/cli`, `@opencode/client`, `@opencode/sdk`, `@opencode/ui`
  all `2.0.32`.
- `saffron-health/opencode-gui` `main` @ `d0d408b` (2026-03-11).
- `bascodes/vscode-opencode` @ `c611070` (2025-07-19).

## 0. Summary

1. **opencode currently ships two incompatible lines** (v1 and v2) and both install a binary called
   `opencode`. The HTTP API, event names and event envelope differ. The decision is recorded in
   section 8: this project targets v2 only (see section 1).
2. **Do not depend on `@opencode-ai/ui` / `session-ui`.** `session-ui` is private and unpublished;
   `ui` ships raw TSX, injects `<style>` at runtime, uses its own ~1,300 design tokens, WASM Shiki
   and a Web Worker. Take patterns; vendor at most a couple of pure files (section 2).
3. **`bascodes/vscode-opencode` has no code** (README + Commons Clause license). Nothing to reuse.
4. **`saffron-health/opencode-gui` is a useful reference** (SolidJS, streaming markdown, tests),
   but its server launch (`process.chdir`, no password) and its "webview SDK over proxied fetch"
   design are what we must avoid (section 3).
5. Full SSE catalog for v1.19.3 in section 4 (kept as reference); v2 summary in section 5. The v2
   permission / form catalog is deferred to #8/#9 (section 8). v2 has no `question.*` events (a
   question is a form) and no todos at all (section 5).

## 1. Two opencode lines

| | v1 line | v2 line |
|---|---|---|
| CLI package | `opencode-ai` 1.19.3 (2026-10-16); GitHub releases are still v1.x | `@opencode/cli` 2.0.32 (`latest`; 2.0.0 published 2026-09-11) |
| Binaries | `opencode` | `opencode` **and** `opencode2` |
| Install docs | README @v1.19.3: `npm i -g opencode-ai`, `opencode.ai/install` | README @v2.0.32 (lines 48-57): `curl -fsSL https://opencode.ai/install`, `npm i -g @opencode/cli@latest`, `scoop`/`choco install opencode`, `brew install anomalyco/tap/opencode`. Caveat: on 2026-10-19 the tap formula `opencode.rb` is version 1.19.3 (v1) and the v2 formula is `opencode-v2.rb` (2.0.32, installs only `opencode`, `conflicts_with "opencode"`), VERIFIED in `anomalyco/homebrew-tap@master`. README on `dev` @52a10f57 (not yet in the tag) adds `opencode.ai/v2/install` and `brew install anomalyco/tap/opencode-v2`; the mise note ("mise 2026.10.9 or later … older versions install OpenCode 1") is on opencode.ai/v2/docs |
| HTTP API | `/global/health`, `/event`, `/session/:id/prompt_async`, ... | everything under `/api/*`: `/api/info`, `/api/event`, `/api/session/:sessionID/prompt`, `/api/session/:sessionID/interrupt`, ... |
| Client package | `@opencode-ai/sdk` (import `@opencode-ai/sdk/v2`) | `@opencode/client` (promise root, `/solid`, `/effect`) |
| Event envelope | SSE `data: {"id","type","properties"}` | frames `{ id, type, data }`; durable events carry `aggregateID`, `seq`, `version` |
| Heartbeat | event `server.heartbeat` every 10 s | SSE comment `: heartbeat` every 15 s |
| `serve` | stdout `opencode server listening on <url>`; `--port 0` tries 4096 first | modes default / service / `--stdio`; `--stdio` prints `{"url": ...}` JSON and exits when stdin closes; a password is always set (random if the env var is missing) |
| Streaming events | `message.part.updated` + `message.part.delta` | `session.text.started/delta/ended`, `session.tool.*`, `session.reasoning.*`, `session.step.*` |
| Public docs | opencode.ai/docs/server (banner: "New OpenCode v2 is now available") | no server/client docs page found; `packages/client/README.md` calls it a "Private generation target" although it is published as public |

Sources (all VERIFIED): `npm view <pkg> dist-tags time bin`; `README.md` @v1.19.3, @v2.0.32 and
@dev (the `dev` README only for the v2 install lines); https://opencode.ai/docs/server/ ;
https://opencode.ai/v2/docs/ (mise note);
`packages/cli/src/server-process.ts` @v2.0.32 (modes, stdio JSON line, `waitForStdinClose`, password);
`packages/protocol/src/groups/{session,event,server}.ts` @v2.0.32 (paths);
`packages/server/src/handlers/event.ts` @v2.0.32 (connected frame, 15 s comment heartbeat);
`packages/schema/src/event.ts` @v2.0.32 (durable envelope, `after` cursors);
`packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts` @v1.19.3.
HYPOTHESIS: the v2 server has no v1-compatible HTTP routes (only a `V1Migration` DB layer was found
in `packages/server/src/routes.ts` @v2.0.32, line 190).

Consequences:
- The `opencode` on a user's PATH can be either line. The host must run `opencode --version` and
  branch on the major version, at minimum to show a clear "unsupported version" error.
- v2 fixes one v1 pain point: `serve --stdio` ties the server's lifetime to our stdin (no orphan
  processes even if the extension host crashes). It does NOT give global replay: `GET /api/event`
  has no `after` parameter and is "Volatile by contract: a slow consumer overflows and fails the
  stream, and events during disconnection are missed" (VERIFIED, `packages/protocol/src/groups/event.ts:44-52`
  @843a6c51). The only replay is per session and experimental: `GET
  /api/experimental/session/:sessionID/log` with `after` (exclusive aggregate sequence) and
  `follow=true` (VERIFIED, `packages/protocol/src/groups/session.ts:726-742` @843a6c51). So after a
  reconnect a full snapshot resync is still required.
- v2 is moving fast (32 releases in ~5 weeks) and undocumented.
- Rejected: v2's in-process `@opencode/sdk` ("executes Server's assembled HTTP router in memory",
  `packages/sdk/README.md` @v2.0.32, VERIFIED). It would run the whole agent (DB, PTY, watchers, tools)
  inside the extension host process shared by every extension, and ignore the user's installed CLI.

## 2. Upstream UI packages

### 2.1 What exists

**`packages/ui`** — `@opencode-ai/ui@1.19.3` on npm, MIT (renamed `@opencode/ui` 2.0.32 at tag `v2.0.32`).
VERIFIED in `packages/ui/package.json` @v1.19.3 and `npm view`.
- ~45 primitives (button, dialog, tooltip, select, tabs, toast, accordion, list, popover...) built
  on `@kobalte/core` 0.13.11, plus theme, i18n, marked/Shiki and file contexts, icon sprites, fonts.
- Ships **source**, not JS: `exports` map to `./src/components/*.tsx`; consumers must compile it
  with `vite-plugin-solid`.
- Runtime deps include `shiki` 4.2.0, `marked` 18.0.7, `marked-shiki`, `katex`, `motion`,
  `morphdom`, `dompurify`, `@pierre/diffs`, `luxon`, `remeda`, `solid-sonner`; peers
  `solid-js ^1.9.0`, `@solidjs/meta ^0.29.0`; unpacked size 5.6 MB.
- Styling: its own token system — `styles/theme.css` (~586 custom properties) and
  `styles/colors.css` (~762); components read `--surface-*`, `--text-*`, `--button-*`, etc.
  Tailwind is optional (`./styles/tailwind` export, dev dependency only).
- `theme/context.tsx` creates a `<style>` element at runtime and writes `textContent`, and uses
  `localStorage` (lines ~92-155).

**`packages/session-ui`** — `@opencode-ai/session-ui`, `"private": true`, **not on npm** (same at
`v2.0.32`, where it is `@opencode/session-ui`). VERIFIED (`package.json`, `npm view` → 404).
- Chat rendering: `message-part.tsx` (2,642 lines; every Part type and tool), `session-turn`,
  `basic-tool`, `markdown` + `markdown-stream` + `markdown-cache` + worker, `session-review` /
  diffs (`@pierre/diffs`), `dock-prompt`, `v2/prompt-input`.
- `context/data.tsx` expects a normalized store `{ session, session_status, session_diff, message:
  {[sessionID]: Message[]}, part: {[messageID]: Part[]} }` typed with `@opencode-ai/sdk/v2` — the
  same shape we plan for our store.
- Couplings: `@opencode-ai/ui` contexts (i18n, dialog, file), `@opencode-ai/core` (workspace only;
  npm has just `0.0.0-reserved.0`), `@opencode-ai/client` from a vendored tarball
  (`file:../app/vendor/...`).
- Markdown highlighting runs in a Vite `?worker&url` worker (`markdown-worker.ts`) using Shiki
  `createHighlighter` (default Oniguruma/WASM engine) and `bundledLanguages` (dynamic imports);
  `ui/context/marked.tsx` sets `preferredHighlighter: "shiki-wasm"`.

### 2.2 Fit with our webview constraints

| Our constraint | Upstream | Verdict |
|---|---|---|
| CSP `style-src ${cspSource}` without `'unsafe-inline'` | theme injects `<style>` at runtime | blocked by CSP (MDN `style-src`, VERIFIED); would need their ThemeProvider removed |
| `script-src 'nonce-…'`, single bundle | Shiki `bundledLanguages` → dynamic chunks; WASM engine needs `'wasm-unsafe-eval'` | conflicts (Shiki regex-engine docs, MDN `script-src`, VERIFIED) |
| No workers in v0 | markdown worker via `?worker&url` | webviews get a per-webview origin (microsoft/vscode#83188); a worker from an `asWebviewUri` URL is likely cross-origin — HYPOTHESIS; workaround via blob URL + `worker-src blob:` UNVERIFIED |
| Styles only `--vscode-*` | ~1,300 own tokens | needs a full mapping layer — HYPOTHESIS on effort |
| Stable dependency | v1 scope `@opencode-ai/*`, v2 renamed to `@opencode/*` | `@opencode-ai/ui` likely freezes when v1 ends — HYPOTHESIS |

### 2.3 Options

- **A. npm dependency on `@opencode-ai/ui`** — discarded: raw TSX in our build, runtime `<style>`
  injection, WASM Shiki, token remapping, tied to the v1 scope.
- **B. Vendor selected pure files (MIT, keep the copyright notice in a `NOTICE`/file header).**
  Candidates checked for imports @v1.19.3 (VERIFIED):
  - `session-ui/src/components/markdown-stream.ts` (122 lines; imports only `marked`, `remend`,
    `./markdown-projection`) + `markdown-projection.ts` (11 lines) — streaming markdown block
    splitter. Best candidate.
  - `part-default-open.ts` (26 lines; only SDK types).
  - Not pure: `session-diff.ts` (`@pierre/diffs`, `@opencode-ai/client`), `markdown.tsx`,
    `message-part.tsx`.
- **C. Reference only** — reimplement; if accessible primitives are needed use `@kobalte/core`
  directly (same headless library upstream uses; whether it injects styles is UNVERIFIED).

Recommendation: **C, optionally plus B for `markdown-stream.ts`**. Never A. (Section 8 adopts C
plus B for `markdown-stream.ts` and `markdown-projection.ts`.)

## 3. Reference extensions

### 3.1 `bascodes/vscode-opencode`
Only `README.md`, `LICENSE` and a demo GIF (`media/Code-2-15.gif`); no source code. Single commit `c611070` "Batman!" (2025-07-19); license text is
"Commons Clause" (not OSI). Nothing to reuse; do not copy its text. VERIFIED (GitHub API).

### 3.2 `saffron-health/opencode-gui` (MIT, v0.4.3, last commit 2026-03-11)
VERIFIED in the files cited, `main` @ `d0d408b`.

- **Stack**: SolidJS webview; Vite builds host and webview; `@opencode-ai/sdk ^1.2.14` (imports
  `/v2`); tiptap editor for `@` mentions; unified/remark/rehype + Shiki; `zod/v4` for shared
  message schemas; Vitest + Playwright e2e + `@vscode/test-electron` (`package.json`).
- **Server launch** (`src/OpenCodeService.ts`): `where`/`which opencode` preflight with an
  "Install OpenCode" action; then `process.chdir(workspaceRoot)` → SDK
  `createOpencode({ hostname: "127.0.0.1", port: 0, timeout: 15000 })` → `chdir` back. No password.
  `dispose()` → `server.close()`.
- **Webview ↔ server** (`thoughts/webview-direct-sdk/SPEC.md`, `src/OpenCodeViewProvider.ts`,
  `src/webview/hooks/useOpenCode.tsx`): the host sends `init { serverUrl }`; the webview builds
  `createOpencodeClient({ baseUrl, fetch: proxyFetch })`; the host executes `proxyFetch` /
  `sseSubscribe` messages after checking `target.origin === serverUrl.origin` and forwards raw SSE
  data as `sseEvent`. Motivation in the SPEC: avoid "~400+ lines of boilerplate message proxying".
- **SSE** (`src/transport/SseClient.ts`): own parser, exponential backoff 1 s → 30 s, state machine
  (connecting / connected / reconnecting / closed), sends `Last-Event-ID`.
- **Store** (`src/webview/state/{sync.tsx,eventHandlers.ts}`): `createStore` keyed by id,
  `produce`/`reconcile`, `message.part.delta` appended to the part field, REST bootstrap guarded by
  a token so stale responses are dropped.
- **CSP** (prod): `default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src
  'nonce-…'; connect-src http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*`.
- Command `opencode.addSelectionToPrompt` — same `opencode.*` namespace as the official extension.

**Copy**: CLI preflight with an actionable error; bootstrap token to drop stale snapshots; resync
after reconnect; connection state shown in the UI; test pyramid (pure handlers in Vitest,
integration with `@vscode/test-electron`, standalone dev page with a mock host).

**Avoid**:
- `process.chdir` in the extension host: process-global, shared with every extension → use
  `spawn(..., { cwd })`.
- SDK `createOpencode`: no `cwd`, no password (server unsecured on localhost), port 0 tries 4096.
- Generic `proxyFetch` / raw SSE forwarding: the webview learns the server URL and gets the whole
  agent API; an XSS in rendered markdown would reach endpoints like `session.shell`. Our
  semantic, typed protocol keeps the host as the policy boundary (architecture rules 1-2).
- `style-src 'unsafe-inline'`, `connect-src 127.0.0.1:*`.
- `opencode.*` command IDs (collide with the official extension) → own prefix.
- Relying on `Last-Event-ID`: v1.19.3 sends no SSE `id:` field.

### 3.3 Official upstream extension (`sdks/vscode`, publisher `sst-dev`, v2.0.32)
A terminal launcher: opens a terminal running `opencode` with `OPENCODE_CALLER=vscode` and pastes
`@file` references; commands `opencode.openTerminal`, `opencode.openNewTerminal`,
`opencode.addFilepathToTerminal`. No webview. VERIFIED (`sdks/vscode/src/extension.ts`,
`package.json` @v2.0.32).

## 4. SSE catalog — v1 line (opencode 1.19.3, `GET /event`)

Kept as a reference. Section 8 targets v2, so this catalog is not the contract the host will
implement; it documents the shapes the v1 SDK exposes and informs the semantic protocol in
section 6.

**Wire** (VERIFIED, `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts`
@v1.19.3): each message is `event: message`, `data: JSON({ id, type, properties })`; the SSE `id:`
field is undefined (no `Last-Event-ID` replay) while the payload has an `id` (`evt_…`). First
`server.connected`, then `server.heartbeat` every 10 s (not in the SDK `Event` union — filter by
string). Events are filtered to the instance directory; the stream ends after
`server.instance.disposed`.

**Shapes** (VERIFIED, `@opencode-ai/sdk@1.19.3` `dist/v2/gen/types.gen.d.ts`, all `{ id, type,
properties }`):

| type | properties | use |
|---|---|---|
| `server.connected` | `{}` | resync trigger (also after reconnects) |
| `server.instance.disposed` | `{ directory }` | stream closes; restart/reconnect |
| `session.created` / `session.updated` | `{ sessionID, info: Session }` | session list, title, share, revert |
| `session.deleted` | `{ sessionID, info }` | remove from list |
| `session.status` | `{ sessionID, status: SessionStatus }` (`idle` / `busy` / `retry`) | spinner, retry notice |
| `session.idle` | `{ sessionID }` | end of turn |
| `session.error` | `{ sessionID?, error?: ProviderAuthError \| UnknownError \| MessageOutputLengthError \| MessageAbortedError \| StructuredOutputError \| ContextOverflowError \| ContentFilterError \| ApiError }` | banner/toast |
| `session.diff` | `{ sessionID, diff: SnapshotFileDiff[] }` (`file?, patch?, additions, deletions, status?`) | changes panel |
| `session.compacted` | `{ sessionID }` | after summarize |
| `message.updated` | `{ sessionID, info: Message }` | header, cost, tokens, error, completion |
| `message.removed` | `{ sessionID, messageID }` | revert |
| `message.part.updated` | `{ sessionID, part: Part, time }` | **full** part: create/replace by id |
| `message.part.delta` | `{ sessionID, messageID, partID, field, delta }` | **append** `delta` to `part[field]` |
| `message.part.removed` | `{ sessionID, messageID, partID }` | |
| `permission.asked` | `{ id, sessionID, permission, patterns[], metadata, always[], tool?: { messageID, callID } }` | permission dialog |
| `permission.replied` | `{ sessionID, requestID, reply: "once" \| "always" \| "reject" }` | close dialog |
| `question.asked` | `{ id, sessionID, questions: QuestionInfo[], tool? }` | question tool |
| `question.replied` / `question.rejected` | `{ sessionID, requestID, answers }` / `{ sessionID, requestID }` | |
| `todo.updated` | `{ sessionID, todos: Todo[] }` | todo panel |
| `file.edited` | `{ file }` | refresh editors |
| `command.executed` | `{ name, sessionID, arguments, messageID }` | |
| `lsp.updated`, `mcp.tools.changed` | — | re-query status |
| `vcs.branch.updated`, `installation.*`, `pty.*`, `tui.*`, `workspace.*`, `worktree.*`, `project.*`, `integration.*`, `catalog.updated`, `models-dev.refreshed` | — | ignore in v0 |

Notes:
- The union also contains `permission.v2.*` / `question.v2.*` (new core engine; e.g.
  `permission.v2.asked = { id, sessionID, action, resources[], save?, metadata?, source? }`). The
  v1 server's permission service publishes `PermissionV1` events (`permission.asked/replied`)
  (VERIFIED, `packages/opencode/src/permission/index.ts`). HYPOTHESIS: `.v2` events are not emitted
  by v1.19.3; log them if they appear.
- `session.next.*` (~40 types) and versioned `*.1` / `*.2` types exist in the union. `/event` maps
  only plain EventV2 payloads, while versioned types travel in a separate `sync` payload on the
  global bus (VERIFIED, `packages/opencode/src/event-v2-bridge.ts`). HYPOTHESIS: `session.next.*`
  are not emitted in practice on 1.19.3.
- Streaming order (VERIFIED, `packages/opencode/src/session/processor.ts`): text start →
  `message.part.updated` (empty) → N × `message.part.delta` (`field: "text"`) → text end →
  `message.part.updated` (full). Reasoning follows the same pattern; tool parts only send full
  `message.part.updated` per state change (`pending` → `running` → `completed` / `error`).
- No replay → on every `server.connected` resync via REST: `session.list`, `session.status`,
  `permission.list`, `question.list`, and `session.messages` for the open session.

## 5. Event stream — v2 line (summary only)

- `GET /api/event`; first frame `server.connected` with `data: {}`; heartbeat is an SSE comment
  every 15 s (VERIFIED, `packages/server/src/handlers/event.ts` @843a6c51). Exact frame encoding
  (`EventFeed.frame`) is HYPOTHESIS.
- Session events (VERIFIED list, `packages/schema/src/session-event.ts` @843a6c51, i.e. what
  `@opencode/client@2.0.32` ships):
  `session.created/deleted/renamed/forked/moved/viewed`,
  `session.agent.selected`, `session.model.selected`,
  `session.execution.started/succeeded/failed/interrupted`,
  `session.step.started/streamed/ended/failed`, `session.text.started/delta/ended`,
  `session.reasoning.started/delta/ended`, `session.tool.input.started/delta/ended`,
  `session.tool.called/progress/success/failed`, `session.retry.scheduled`,
  `session.compaction.started/delta/ended/failed`, `session.revert.staged/committed/cleared`,
  `session.shell.started/ended`, `session.usage.recorded/updated`, `session.inbox.*`,
  `session.message.content.updated`, `session.metadata.updated`, `session.permissions`,
  `session.skill.activated`, `session.instructions.updated`, `session.synthetic`.
  Coming on `dev` @52a10f57, not in the tag: `session.archived` / `session.unarchived` (the
  tag's `session-event.ts` has no `archived` at all).
- Durable events: `aggregateID`, `seq`, `version`; "`after` cursors accept only values that came
  from those sources" (VERIFIED comment, `packages/schema/src/event.ts:19` @843a6c51).
- **Permissions and questions in v2.** There is no `question.*` event family. Permissions have
  `permission.asked` / `permission.replied` (VERIFIED, `packages/schema/src/permission.ts:45-47`
  @843a6c51). A model question is a **form**: the `question` tool creates a form whose
  `metadata.kind` is `"question"`, with fields `q0..qN`, announced by `form.created` /
  `form.replied` / `form.cancelled` (VERIFIED, `packages/schema/src/form.ts:173-175` and
  `packages/core/src/tool/plugin/question.ts:74-121` @843a6c51) and answered with
  `session.form.reply` (`POST /api/session/:sessionID/form/:formID/reply`, VERIFIED,
  `packages/protocol/src/groups/session.ts:842` @843a6c51). Before creating the form the tool
  asserts a `question` permission (`question.ts:63-72`), so a `permission.asked` may precede
  `form.created` (HYPOTHESIS about ordering on the wire; check in #8/#9). Detailed shapes are deferred to #8/#9
  (section 8): the full v2 catalog lives with the server implementation (#8/#9).
- **What does not exist in v2** (VERIFIED against the `v2.0.32` tree and the files named; absence
  is read from the tree listing and from the absence of matches, not from a running server):
  - **Todos**: no tool (`packages/core/src/tool/plugin/` has no todo tool), no event (none in
    `packages/schema/src/session-event.ts`) and no endpoint (none under
    `packages/protocol/src/groups/`). `packages/schema/src/todo.ts` does not exist (HTTP 404).
  - **Share / unshare**: no endpoint in `packages/protocol/src/groups/session.ts` and no
    `share` protocol group.
  - **A dedicated init endpoint**: there is none, but `init` ("guided AGENTS.md setup") **is
    available** as a built-in command with its own `execute`, which sends the `initialize.txt`
    prompt (`packages/core/src/plugin/command.ts:29-41` @843a6c51). It runs through the generic
    command route `POST /api/session/:sessionID/command` with `name: "init"`
    (`packages/protocol/src/groups/session.ts:418-436`).
  - **LSP status**: `LspEvent` (`packages/schema/src/lsp-event.ts`) is in `Definitions` but not in
    `ServerDefinitions` (`packages/schema/src/event-manifest.ts:71-81` and `:90`), and the public
    stream is built only from `ServerDefinitions` (`packages/protocol/src/groups/event.ts:62`,
    filter `isServer` at `:68`), so it is not on `/api/event`; there is no LSP route in the
    session group.
  - **`unrevert`**: the session group has only `revert.stage`, `revert.commit` and
    `revert.clear` (`session.ts:535-560`); `clear` is the closest equivalent.

## 6. Implications for the next issues

Note: section 4 (v1 catalog) is kept as reference only, and its `question.*` and `todo.*` entries
do not exist in v2 (section 5). The v2 catalog for permissions and forms is to be completed in the
server issue (#8/#9), reading, at tag `v2.0.32`: `packages/schema/src/permission.ts`,
`packages/schema/src/form.ts`, `packages/schema/src/question.ts` (used through forms, by
`packages/core/src/tool/plugin/question.ts`), `packages/protocol/src/groups/permission.ts` and the
per-session form routes in `packages/protocol/src/groups/session.ts:796-867` (the `form` group
itself only has `GET /api/form`).
No v2 event shapes beyond those marked VERIFIED in section 5 should be assumed.

**#1 Scaffold**
- Pin `@opencode/client` exactly (no `^`). It is ESM-only → bundle the host with esbuild
  (`platform: node`, `format: cjs`).
- `engines.vscode ^1.105.0` (section 8).
- Own command/view prefix; do not use `opencode.*`.
- Put server lifecycle behind one host module (`ServerLauncher`-like) that runs
  `opencode --version` first and checks the major version: 2 is supported; 1 (or anything else)
  shows a clear "unsupported version" error.
- `spawn` with `cwd` = workspace folder, `shell: false`, random password in env, `--stdio` mode;
  parse the v2 `--stdio` JSON line (`{"url": ...}`) from stdout; the server exits when our stdin
  closes. Windows: kill the tree (`taskkill /pid <pid> /T /F`) as a fallback.
  VERIFIED @843a6c51 (tag `v2.0.32`): the `--stdio` flag (`packages/cli/src/commands/commands.ts:561`);
  the stdout line `{"url":"..."}` printed with `console.log(JSON.stringify({ url }))` and the exit
  when stdin closes (`packages/cli/src/server-process.ts:202,205-207`, `waitForStdinClose`, defined
  at line 227). Load-bearing details
  (`server-process.ts:67,80-92,203`, `packages/cli/src/commands/handlers/serve.ts:9`; on `dev`
  @52a10f57 the same lines sit about 4 further down):
  - In `--stdio` mode the password is NOT printed (only the default/foreground mode prints it), so
    the host must generate it and pass it via env. `OPENCODE_PASSWORD` wins; the legacy
    `OPENCODE_SERVER_PASSWORD` is read only if the first is unset (`packages/cli/src/env.ts:10-11`
    @843a6c51), so the host sets `OPENCODE_PASSWORD` and removes the legacy one from the child's
    env. If neither is set the server invents a random one nobody can read.
  - In `--stdio` mode, v2 deletes both variables from its own `process.env` after reading them
    (so tools it spawns do not inherit them; `server-process.ts:82-84`).
  - `--service` and `--stdio` cannot be combined (`serve.ts` fails with "--service and --stdio
    cannot be combined").
  Not executed against a running server (see section 7).
- `src/shared` must not import `vscode` (it is compiled into both bundles).

**#2 Webview (SolidJS + Vite)**
- Do not import `@opencode-ai/ui`. Plain CSS files using `--vscode-*` only; no runtime `<style>`;
  CSP without `'unsafe-inline'` (stricter than saffron).
- One JS chunk, no workers in v0; Shiki (if any) with the JavaScript regex engine and explicit
  languages, or defer highlighting.
- Vendored `markdown-stream.ts` / `markdown-projection.ts` per section 8, with upstream's
  copyright notice preserved.
- Dev loop: standalone page + mock host replaying recorded events (saffron does the same with
  `standalone.html` + `MockSyncProvider`).

**#3 Protocol**
- Semantic and domain-shaped, **independent of the wire format**, so upstream's churn is isolated
  in a host adapter. Sketch:
  - `HostToWebview`: `connection.state` (connecting / connected / reconnecting + attempt /
    failed), `snapshot` (full resync), `session.upserted`, `session.removed`, `session.status`,
    `message.upserted`, `message.removed`, `part.upserted`, `part.delta`, `part.removed`,
    `permission.asked`, `permission.resolved`, `question.asked`, `question.resolved`,
    `todos.updated`, `error`.
    These are host-protocol names, not wire names: in v2 `question.*` would be derived from forms
    (`form.created` with `metadata.kind = "question"`, answered via `session.form.reply`;
    `question.reject` maps to `session.form.cancel`, `DELETE /api/session/:sessionID/form/:formID`,
    `session.ts:858`), and
    `todos.updated` has no v2 source at all (section 5), so it should not be implemented.
  - `WebviewToHost`: `ready`, `session.select`, `session.create`, `prompt.send`,
    `session.abort`, `permission.reply`, `question.reply`, `question.reject`.
- Runtime guards on both sides (`isHostToWebview`, `isWebviewToHost`); never forward raw SSE.
- After every reconnect the host resyncs with a `snapshot`: `GET /api/event` is volatile and has no
  `after` (VERIFIED, `packages/protocol/src/groups/event.ts:44-52` @843a6c51). Using the
  experimental per-session log (`/api/experimental/session/:sessionID/log?after=&follow=`,
  VERIFIED to exist in `packages/protocol/src/groups/session.ts:726-742` @843a6c51) to avoid a full snapshot
  for the open session is HYPOTHESIS of usefulness: it is experimental and was never run.

## 7. Not verified / open
- Nothing ran against a real server (either line).
- v2 frame encoding and the v2 permission and form event shapes (the absence of `question.*` and
  todos was read from the `v2.0.32` tree, not observed on a running server).
- Web Worker loading inside a VS Code webview.
- Whether `@kobalte/core` injects styles at runtime.

Closed: `/api/event` does not accept `after` and is volatile (VERIFIED, section 1); replay exists
only via the experimental per-session log. Whether that log is worth using is HYPOTHESIS.

## 8. Decisions

Decided by the maintainer on 2026-10-19.

**Target line: v2 only** (`@opencode/cli` 2.0.x + `@opencode/client`).
- Reason: it is upstream's `latest` and what new installs receive; `serve --stdio` ties the
  server's lifetime to our stdin, which is what solves orphan processes. v2 does NOT provide global
  replay: `/api/event` is volatile and has no `after` (VERIFIED, `packages/protocol/src/groups/event.ts:44-52`
  @843a6c51), so after a reconnect a full snapshot is still needed. The experimental per-session log
  (`GET /api/experimental/session/:sessionID/log?after=&follow=`, `packages/protocol/src/groups/session.ts:726-742` @843a6c51)
  could narrow that resync for the open session; its usefulness is HYPOTHESIS.
- Discarded alternatives: v1 plus an adapter (new users would see "unsupported"), and supporting
  both lines (double event mapping and double fixtures).
- Accepted risks: the API is undocumented and changes quickly. Mitigation: pin the exact client
  version and review this document on every version bump.
- Consequence: v1 (`opencode --version` with major 1) is detected and a clear "unsupported
  version" error is shown.

**UI reuse: reference only, plus vendoring** of
`session-ui/src/components/markdown-stream.ts` and `markdown-projection.ts` (MIT; keep upstream's
copyright notice in the file header or in a `NOTICE`). Never a dependency on `@opencode-ai/ui`.
When the copy is made, pin the exact upstream commit it is taken from and record it in the file
header: `markdown-stream.ts` exists at `v1.19.3`, at `v2.0.32` (`@843a6c51`) and on `dev` @52a10f57
(VERIFIED, HTTP 200 on the raw URLs; `markdown-projection.ts` checked at the `v2.0.32` tag only),
so the pin must say which. The vendored file adds a runtime dependency on `remend`
(it imports `marked`, `remend` and `./markdown-projection`).

**Minimum VS Code: `engines.vscode ^1.105.0`**, to cover forks (Cursor ~1.105 HYPOTHESIS,
VSCodium).

**v2 permission / form catalog: deferred** to the server issues (#8/#9). Issue #6 closes with the v1
catalog (section 4) and the v2 session-event list (section 5); the missing v2 shapes are read from
the sources listed in section 6 (at tag `v2.0.32`) when the host adapter is written. The full v2
catalog lives with the server implementation (#8/#9).

**Not in v2, so not in scope** (section 5, read from the `v2.0.32` tree): `question.*` events
(questions are forms: `form.created` with `metadata.kind = "question"`, fields `q0..qN`, reply with
`session.form.reply`), todos (no tool, event or endpoint), share / unshare, LSP status on the
public stream, and `unrevert`. Features built on those (todo panel, share button, LSP indicator)
have no v2 counterpart to wire to. `init` (AGENTS.md generation) stays **in scope**: it has no
dedicated endpoint but runs as the built-in command `init` through
`POST /api/session/:sessionID/command` (section 5).

## Sources
- https://github.com/anomalyco/opencode/tree/v1.19.3 — `packages/ui`, `packages/session-ui`,
  `packages/opencode/src/{server/routes/instance/httpapi/handlers/event.ts,permission/index.ts,session/processor.ts,event-v2-bridge.ts}`, `LICENSE`, `README.md`
- https://github.com/anomalyco/opencode/tree/843a6c514e606b436a7fe713422ace0a93ad3d61 (tag
  `v2.0.32`, source of the v2 claims) —
  `packages/cli/src/{server-process.ts,commands/commands.ts,commands/handlers/serve.ts}`,
  `packages/server/src/{handlers/event.ts,routes.ts}`,
  `packages/protocol/src/groups/{session,event,server,permission,form}.ts`,
  `packages/schema/src/{event.ts,event-manifest.ts,session-event.ts,permission.ts,form.ts,question.ts,lsp-event.ts}`,
  `packages/core/src/tool/plugin/question.ts`, `packages/core/src/plugin/command.ts`,
  `packages/{client,sdk}/README.md`, `packages/ui/package.json`, `packages/session-ui/package.json`,
  `sdks/vscode`, `README.md`
- https://github.com/anomalyco/opencode/tree/52a10f573f1da5103c85990da9341e3645a39365 (branch `dev`,
  72 commits ahead of the tag; "what is coming" only) — `README.md` (v2 install lines),
  `packages/schema/src/session-event.ts` (`session.archived` / `unarchived`)
- https://www.npmjs.com/package/@opencode-ai/sdk (1.19.3, `dist/v2/gen/types.gen.d.ts`)
- https://www.npmjs.com/package/@opencode-ai/ui · https://www.npmjs.com/package/@opencode/cli ·
  https://www.npmjs.com/package/@opencode/client
- https://opencode.ai/docs/server/ · https://opencode.ai/v2/docs/
- https://github.com/saffron-health/opencode-gui (main @ d0d408b)
- https://github.com/bascodes/vscode-opencode (c611070)
- https://github.com/microsoft/vscode/issues/83188 (per-webview origins) ·
  https://github.com/microsoft/vscode/issues/194751 (workers from webview resources)
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src
- https://shiki.style/guide/regex-engines
