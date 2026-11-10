# Mods for OpenCode Station

A **mod** is a small JavaScript program you write yourself. It runs inside the extension, watches
what happens in your chat (a turn starts, a tool is called, a permission is asked) and can show a
line of status above the prompt box, raise a notification, add a command to the `/` menu and the
Command Palette, and put text in the prompt box.

Mods are for the person who installs them. There is no store and no sharing mechanism: you put a
folder in one place and the extension loads it.

> **A mod is not sandboxed.** It runs with the same permissions as you: it can read and write your
> files, start programs and use the network. Read [Security](#security) before you install anything
> you did not write.

## Where mods live

Mods load from ONE folder, the extension's own:

| Platform | Folder |
| --- | --- |
| Linux, macOS | `$XDG_CONFIG_HOME/opencode-station/mods`, or `~/.config/opencode-station/mods` when `XDG_CONFIG_HOME` is not set |
| Windows | `%XDG_CONFIG_HOME%\opencode-station\mods`, or `%USERPROFILE%\.config\opencode-station\mods` |

The command **OpenCode: Open Mods Folder** creates the folder if it is missing and shows it. The
environment variable `OPEN_VS_CODE_MODS_HOME` replaces the whole path (the extension's own tests set
it so they never load your mods).

There are **no project mods**: the extension never loads code from the folder you have open, so
cloning a repository cannot make it run a mod. See [Security](#security) for what this does and does
not protect.

The commands:

| Command | What it does |
| --- | --- |
| `OpenCode: Manage Mods…` | Lists every mod with its state (`active`, `failed` and why, or switched off in this workspace) and the folders that were skipped, with Reload, Open Folder and Show Logs |
| `OpenCode: Reload Mods` | Stops every mod and loads the folder again, except the ones you switched off in this workspace. There is no file watcher: after editing a mod, reload |
| `OpenCode: Open Mods Folder` | Creates and shows the folder |
| `OpenCode: Run Mod Command…` | Picks a command registered by a mod and runs it |

The setting `openVsCode.mods.enabled` (default on, user-level only: a workspace cannot change it)
turns every mod off, in every workspace. To turn off just one mod, in just one workspace, see the
next section.

### Turning one mod off in a workspace

When the mods folder holds at least one mod (or a folder that was skipped), the prompt bar shows a
puzzle-piece button after **+** and **/**, with the number of active mods on it. It opens a popover
with one switch per mod, its description, and a line when the mod is starting or failed. Folders that
were skipped appear without a switch. **Open folder** reveals the mods folder. The same switches are
in the **Mods** section of the **OpenCode Settings** tab (**OpenCode: Open Settings…**), with
**Reload mods** and **Open folder**; it is the same list and the same switch, and a mod that failed
also shows up in that tab's **Needs attention**.

- **Each switch starts or stops only that mod.** Turning one off removes its band, its commands from
  the `/` menu and its open panels, and stops its worker. The other mods keep running: their
  state in memory, their bands and their open panels are not touched. Turning it on starts only that
  mod. A mod that failed keeps its switch on (it is what you asked for); turn it off and on again to
  retry it alone.
- **The choice is saved for the workspace**, not for the machine. It survives **Reload Mods**,
  changing `openVsCode.mods.enabled` and reloading the window. A workspace with several folders
  (a `.code-workspace` file) has one list for the whole workspace, because mods run once per window
  and do not depend on the folder opencode serves. A new mod starts on in every workspace: what is
  saved is the list of mods you turned **off**.
- **It is not a project mod.** The list lives in VS Code's own storage for your user profile, never
  in the folder you opened, so a repository cannot change it. It can only stop mods, never load code.
- **Moving, deleting or cloning the folder again** gives VS Code a new workspace identity, so every
  mod is on again there.
- **With no folder open** the choices last only until you close that window: the popover says so
  ("No folder open: these choices last until you close this window") and **Manage Mods** shows
  `off in this window`.
- **With `openVsCode.mods.enabled` off** the popover still lists the mods, with the switches
  disabled, says the mods are off and offers **Open Settings**. The popover never changes that
  setting.
- **A folder you edited since the last Reload Mods** is started from the manifest read then; run
  **Reload Mods** to pick up changes of the folder itself.

What a mod logs goes to the **OpenCode Mods** output channel, prefixed with its id. Lines about its
life (`mod x loaded`, `mod x failed: …`) go to the **OpenCode** channel. A mod gets at most 50 lines
per second in its channel, counting the warnings the extension writes about what the mod sends; the
rest are dropped, with one warning per second in which something was dropped (that warning does not
count). Also outside the count: the warning about the removed `send` option of
`station.chat.compose`, written once per load.

## The format

One folder per mod, with a `mod.json` and the entry file it names:

```text
<mods folder>/
  hello-station/
    mod.json
    index.mjs
```

`mod.json`:

```json
{
  "id": "hello-station",
  "name": "Hello Station",
  "version": "0.1.0",
  "apiVersion": 1,
  "main": "index.mjs",
  "description": "Says hello after each turn."
}
```

| Field | Rule |
| --- | --- |
| `id` | `^[a-z0-9][a-z0-9-]{0,63}$`. Two mods with the same id: the first one is loaded, the other is skipped |
| `name` | Optional, at most 80 characters. Shown in the band and in the lists. Defaults to the `id` |
| `version` | Required, at most 32 characters |
| `apiVersion` | Required, and `1` is the only value this version accepts. Any other gives `requires Station mod API vN; this version supports 1` |
| `main` | Relative path to a `.js`, `.mjs` or `.cjs` file inside the mod folder (a link that leaves the folder is refused) |
| `description` | Optional, at most 300 characters |

There is no `npm install` and no build step: write plain JavaScript (an `.mjs` file can `import`
Node's own modules). To get editor help, start the file with `// @ts-check` and copy
`src/mods/api.ts` of this repository next to your mod as `api.d.ts`: it is the contract the
extension implements.

A mod needs `export function activate(station)`; an optional `deactivate()` runs when the mod stops.
CommonJS (`module.exports = { activate }`) works too. `activate` may return a cleanup function. At
most 20 mods load.

Each mod runs in its **own worker thread**. One that throws, runs out of memory (256 MB of JavaScript
heap) or blocks its event loop (three missed 5-second heartbeats) is stopped and marked `failed`, with
the reason in **Manage Mods**; the chat and the other mods keep working. A failed mod is not restarted
by itself: fix it and run **Reload Mods**.

A worker contains JavaScript errors, not native code. A native addon that crashes the process, or a
mod that kills the process it runs in (`process.kill(process.pid)`), can take down the whole
extension host and with it every extension (HYPOTHESIS: reasoned from how threads share a process,
not run). A mod is code you chose to run, so read it first.

**Remote windows.** The extension declares no `extensionKind`, so in a remote window (SSH, WSL,
Dev Containers, Codespaces) it runs on the remote machine: the mods folder and the workers are the
remote ones, not your local profile's. That workers start there, and in code-server, is UNVERIFIED:
code-server has reported "Creating workers from remote extensions is currently not supported".

## The API, version 1

`activate(station)` receives:

| Member | What it does |
| --- | --- |
| `station.apiVersion` | Always `1` |
| `station.mod` | `{ id, name, version }` of the running mod |
| `station.log.info(text)`, `.warn`, `.error` | Writes to the OpenCode Mods channel |
| `station.events.on(type, handler)` | Subscribes to an event. Returns a `Disposable` |
| `station.commands.register({ name, description?, run })` | Adds a command. Returns a `Disposable` |
| `station.ui.status.set({ text, tooltip?, severity?, command? })` and `.clear()` | The band above the prompt box |
| `station.ui.toast({ message, severity?, actions? })` | A native notification. Returns a promise of the button pressed, or `undefined` |
| `station.chat.compose({ text })` | Puts text in the prompt box of the chat; it never sends it: the user does |
| `station.ui.panel.open({ title, html, scripts?, styles? })` | A panel in an editor tab beside the chat. Returns `{ postMessage, onMessage, onDidClose, dispose }` |

### Events

A mod only **observes**. There is no replay: a mod that was not running misses what happened.
Deltas, message text and reasoning are never sent.

| `type` | When | Data |
| --- | --- | --- |
| `turn.started` | A turn begins | `sessionID` |
| `turn.finished` | A turn ends | `sessionID`, `outcome` (`succeeded`, `failed` or `interrupted`), `error?` `{ code, message }` |
| `tool.called` | The model called a tool | `sessionID`, `messageID`, `callID`, `tool?`, `input`, `inputTruncated?` |
| `tool.finished` | A tool ended | `sessionID`, `messageID`, `callID`, `tool?`, `status` (`completed` or `error`), `error?` |
| `permission.asked` | opencode asks for a permission | `sessionID`, `id`, `action`, `resources` |
| `permission.replied` | A permission was answered | `sessionID`, `id`, `reply` (`once`, `always` or `reject`) |

`tool` is missing when the extension did not see the call being opened. `input` is `{}` with
`inputTruncated: true` when it is larger than 16 KB. Events of sub-agent sessions arrive with their own
`sessionID`. The names are `tool.called`, not "before the tool": by the time a client sees it, opencode
is already evaluating the permission or running the tool. See
[Blocking a tool](#blocking-or-changing-a-tool-call) for what can stop one.

A handler's return value is ignored. A handler that throws is logged and the mod stays active.

### Commands

`station.commands.register` adds a command that users see as `<modId>:<name>`: in the `/` menu of the
chat (type `/hel` to find `/hello-station:hello`) and in **OpenCode: Run Mod Command…**. `name` follows
`^[a-z0-9][a-z0-9-]{0,47}$`. `run({ args, sessionID })` receives the text typed after the command and
the open session, if any. `args` is at most 4000 characters (a longer text is refused, from the `/`
menu and from the palette alike). At most 20 commands per mod. A command that does not finish in 30 seconds is
answered with an error (the mod itself keeps running).

A mod command is **an action of the client, not a prompt**: running it never creates a session and
never reaches the model. (For a command that expands to a prompt template, use opencode's own
commands, which the `/` menu already lists.) When the server lists a command with the same qualified
name, the server's wins.

Mod commands are listed and run even when opencode is not running (autoStart off, starting,
reconnecting): they never need the server. opencode's own commands appear in the `/` menu once the
server has sent them.

### The band

`station.ui.status.set` pins one line of plain text above the prompt box, one row per mod. `text` is
at most 120 characters and `tooltip` at most 500; both are shown as text, never as HTML (`<b>` appears
as the characters `<b>`). `severity` (`info`, `warning`, `error`) colours the left edge of the row.
`command` names a command of the **same mod**, which then appears as a button on the band. Updates are
limited to 10 per second per mod (the latest wins).

### Toasts

`station.ui.toast` shows a native VS Code notification titled with the mod's name. The text is
cleaned of `[ ] ( )` so it cannot build a link. At most 500 characters, up to 3 buttons of 40
characters, and one toast every 2 seconds per mod (the rest are dropped with a warning in the log).

### Composing text

`station.chat.compose` writes into the prompt box of the chat in front (opening one if there is none).
It never attaches files and it never sends: the user reads the text and presses Send.

The `send` option was removed before 1.0. A mod that still passes `send: true` (plain JS; in
TypeScript it no longer compiles) has its text written, not sent, and gets one warning per load in
the **OpenCode Mods** channel.

Accepted risk (decision of 03/11/2026, issue #169): compose has **no frequency limit**. A mod with a
bug that composes in a loop can keep appending text to the draft (up to 20 000 characters per call)
and pull the chat into view each time, taking the focus from what the user was doing. Unlike a toast
(one every 2 seconds), nothing throttles it. If that shows up in practice, the answer is a cap like
the toast one, in its own issue.

### Panels

`station.ui.panel.open` opens a **panel**: a page of your own in an editor tab beside the chat, for
anything the band and the toast cannot show. It was added without changing `apiVersion` (it stays `1`).

```js
const panel = station.ui.panel.open({
  title: 'My panel', // at most 80 characters
  html: 'panel.html', // markup that goes inside <body>
  scripts: ['panel.js'], // up to 16, loaded in order
  styles: ['panel.css'], // up to 16
});
panel.onMessage((data) => panel.postMessage({ echo: data }));
panel.onDidClose(() => station.log.info('closed'));
```

- **Files.** `html`, `scripts` and `styles` are paths **relative to your mod folder** (`.html` or `.htm`,
  `.js` or `.mjs`, `.css`; each file at most 1 MB). A path with `..`, an absolute path, a drive letter or
  a link that leaves the folder is refused. That check covers the files you declare. It does **not** cover
  what the page asks for by itself (an `<img>` or a `url()`): VS Code serves it when its path is under your
  folder and does not resolve links, so a symlink or junction inside your folder that points outside is
  readable by the page. The page has no network, so all it can do with that is send it to your mod, which
  already has Node (see Security). Do not leave links to private places inside a mod folder.
- **The page has no network.** Its content security policy is `default-src 'none'`, scripts only by a
  nonce the extension adds to the files you declare, styles and images only from your folder, and **no
  `connect-src`**: `fetch`, `XMLHttpRequest` and WebSocket are blocked. Inline `<script>` and `style=`
  are blocked too, so put code and styles in `scripts` and `styles`. The page cannot reach the opencode
  server, and it never sees its address or password.
- **Talking to the page.** The page gets `acquireVsCodeApi()`: `vscode.postMessage(data)` arrives in your
  `onMessage`, and `panel.postMessage(data)` arrives in the page as a `message` event (`event.data`).
  `data` is JSON, at most 1 MB serialized, in both directions. A page message that is not valid JSON or
  is over 1 MB is dropped with a warning in the mods log (at most one per second per panel); a
  `panel.postMessage` with such data throws a `TypeError` in your mod. At most 30 messages per second go
  from the mod to the page (all your panels together); the rest are dropped with a warning, so if you
  send state, resend it rather than relying on every message arriving. Other than that, the content of
  the messages is yours: the extension does not look into it.
- **Theme.** Use the `--vscode-*` variables (for example `var(--vscode-editor-background)`); they are
  present in every VS Code webview and follow the light, dark and high contrast themes.
- **Lifetime.** `onDidClose` runs once when the user closes the tab or the mod calls `dispose()`. A panel
  is also closed when its mod stops, fails or is reloaded. At most 3 panels per mod; `open` throws when
  the options break a limit. The tab is opened without taking the focus from the chat, and its page is
  rebuilt when the tab is hidden and shown again, so keep the state in the mod, not in the page, and send
  it again when the page says it has loaded (the fixture's page sends a first message for that).

`src/extension/test-fixtures/mods/hello-station/` has a working panel (`panel.html`, `panel.js`,
`panel.css`) behind the command `hello-station:panel`.

## Security

**Mods are not a sandbox.** A worker thread keeps a mod's JavaScript mistakes from freezing the
editor (native code that crashes the process is not contained, see above); it does not limit what
the mod may do. A mod can read your files, run programs, use the network, and read the
environment of other processes of your user. The API limits what is stable, not what is possible.
Never install a mod you have not read.

What the extension does to keep the risk small:

- **Only the extension's own folder loads.** Nothing a repository ships (its `.opencode-station`, its
  `.vscode` folder) is executed as a mod. The folder is in your user profile, so only you or a program
  running as you can put a mod there.
- `openVsCode.mods.enabled` is a **user-level** setting: a workspace cannot turn mods on.
- A mod never receives the opencode server's port, its password or the opencode client. The worker's
  environment has `OPENCODE_PASSWORD`, `OPENCODE_SERVER_PASSWORD`, `ELECTRON_RUN_AS_NODE` and the
  `VSCODE_*` variables removed. That keeps them out of the mod's *API*; a mod that really wants
  them could still find them elsewhere on the machine (for example in the environment of the server
  process, on systems that let a program read it). It is a convenience, not a wall.

### What this does NOT cover: opencode's own plugins

opencode itself loads plugins that a project brings: `.ts` and `.js` files in `.opencode/plugin/`
and `.opencode/plugins/`, and every entry of `plugins` (or `plugin`) in `opencode.json`,
`opencode.jsonc` and `.opencode/opencode.json(c)`, npm package names included (opencode downloads
and runs those). It searches the folder you opened and every folder above it. That is opencode's
behaviour, outside this extension's control, and it is separate from mods.

Since issue #153 the extension asks before it starts opencode in such a folder: a warning with
**Start anyway** and **Don't start** (the answer is kept per folder, on this machine, and asked
again when the list of plugins changes), or a modal when you press Start, run **OpenCode: Restart
Server** or send your first prompt. **OpenCode: Forget Plugin Decision for This Folder** clears it.
While opencode runs: opencode 2.0.32 imports a new plugin in 223 to 446 ms with no request (real
opencode, Windows 11), so the extension starts it with its file watcher off
(`OPENCODE_FILEWATCHER_DISABLE=1`; the same plugin was then not loaded in 17 s) and watches the
served folder (`opencode.json(c)` and `.opencode/`) itself. A change to a list of plugins you have
not approved stops the server and asks as above. The cost: config, `AGENTS.md`, skills and
commands changed while it runs need **OpenCode: Restart Server**. What it does not cover: folders
above the served one (opencode's own 24-hour rescan and the one it runs when its own config is
updated, both read in its source and not executed),
`files.watcherExclude`, symlinks, and a plugin written while the server is still `starting`; a
server you connect to with `openVsCode.serverUrl` is not started by the extension, so there is
nothing to ask or watch; and other project code that opencode runs (local MCP servers,
formatters) is not checked. The detection replicates what opencode 2.0.32 reads. Checked
once against a real opencode 2.0.32 on Windows 11: a plugin file in `.opencode/plugins/` was
imported by the first request that loads the folder's models (`GET /api/model`), not when the
server started and not by the other requests tried (`GET /api/info`, `/api/session`,
`/api/agent` and `/api/command`); the extension makes the `GET /api/model` request as soon as it
connects. Plugins declared in `opencode.json` were not part of that check. You can still
set `openVsCode.autoStart` to `false` so the server starts only when you ask. VS Code's own Workspace Trust also applies: the extension does not run in
Restricted Mode.

## Blocking or changing a tool call

A mod cannot block a tool, change its input or answer a permission: a client sees the event after the
server has started handling it. That is a job for an **opencode server plugin**, which runs inside
opencode and can reject a call before it runs. Put a file in `~/.config/opencode/plugins/` (for every
project) or `.opencode/plugins/` (for one project; mind the warning above), for example
`block-env.js`:

```js
// Rejects any tool call that touches a .env file.
export default {
  id: 'block-env',
  setup(ctx) {
    ctx.tool.hook('execute.before', (event) => {
      const text = JSON.stringify(event.input ?? {});
      if (/\.env\b/.test(text)) throw new Error('Blocked: .env files are off limits');
    });
  },
};
```

Of the hooks of the server plugin API (read in the sources of opencode at the `v2.0.32` tag, in
`packages/plugin` and `core/src/plugin/hooks.ts`), only `tool.hook('execute.before')` may fail a
call; `permission.hook('evaluate')` can change a permission to allow, deny or ask. **This example was
not run against a server**: the exact shape of the plugin object (opencode's sources define it with
`Plugin.define({ id, setup(ctx) })`) and of `event` is opencode's, so check it against the version of
opencode you run (this extension supports opencode v2 only) before you rely on it.

A mod and a server plugin can be used together: the plugin enforces, the mod shows what happened (for
example a band that says "Blocked 3 reads of .env today").

## Example

`<mods folder>/turn-counter/mod.json`:

```json
{
  "id": "turn-counter",
  "name": "Turn counter",
  "version": "1.0.0",
  "apiVersion": 1,
  "main": "index.mjs"
}
```

`<mods folder>/turn-counter/index.mjs`:

```js
// @ts-check
let turns = 0;

/** @param {import('./api').StationModApi} station */
export function activate(station) {
  station.commands.register({
    name: 'reset',
    description: 'Sets the counter back to zero',
    run() {
      turns = 0;
      station.ui.status.clear();
    },
  });

  station.events.on('turn.finished', (event) => {
    turns += 1;
    station.ui.status.set({
      text: `Turns this window: ${turns} (last: ${event.outcome})`,
      severity: event.outcome === 'failed' ? 'warning' : 'info',
      command: 'reset',
    });
  });

  station.events.on('permission.asked', (event) => {
    void station.ui.toast({
      message: `opencode asks for ${event.action}`,
      severity: 'warning',
    });
  });
}
```

Run **OpenCode: Reload Mods**, send a prompt, and a row "Turn counter · Turns this window: 1 (last:
succeeded)" appears above the prompt box with a `reset` button. Typing `/turn-counter:reset` in the
prompt box does the same as the button. If something goes wrong, **OpenCode: Manage Mods…** shows the
state and **Show Logs** opens the channel.
