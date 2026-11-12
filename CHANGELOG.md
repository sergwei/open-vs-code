# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Quick start: the model pill picks the model of the next conversation.** It is a button with a
  chevron that opens a picker (grouped by provider, searchable); the conversation you start from the
  box uses that model (it lasts until you pick another or reload the window), and
  `openVsCode.defaultModel` is not touched. The server pill now shows only
  when the server is not ready.
- **Built and tested against opencode 2.2.7** (was 2.0.32): the `@opencode/client` pin and the
  recommended CLI move together. Calls to the experimental routes (usage stats, MCP connect and
  disconnect) now use the `client.experimental.*` methods.
- **Several pending requests share one box.** Instead of stacking one card on top of another, the
  permissions and questions the agent is waiting on sit in a single box with a tab per request
  (icon and name, the active one underlined, "1 of 3" on the right) and only the active request
  below. The tab names always show whole; if they do not fit, the row scrolls sideways. With a
  single request nothing changes.

### Added

- **Chat, Changes and Session tabs in the chat panel.** A row of tabs under the header switches the
  central area; the request cards, the subagent strip, the activity line and the prompt box stay in
  all three. **Changes** holds the files the session changed (moved out of the header). **Session**
  holds pinned instructions, a context meter with Compact, token and cost totals, the session's
  subagents with Open, and **Export** to Markdown or JSON (the JSON holds the full text and file
  paths). The context line under the title gains a **Compact** button from 80 % of the window.
- **Write while the agent works.** During a turn Enter queues the message (a "Queued: …" chip with
  Steer now, Edit and remove) and Ctrl+Enter (Cmd+Enter on macOS) steers the turn with it right
  away. Stop moved to the activity line at the bottom, which now says what the agent is doing, the
  step, the elapsed time and how many subagents run.
- **Pinned instructions per session** ("Always answer in Galician"), sent by opencode with every
  step. They and Export use opencode's experimental API, so a newer opencode may change them.
- **The shell of opencode in Settings › Advanced.** A drop-down with Automatic and the shells the
  server offers (the ones opencode only accepts for the terminal are marked). It is saved in your
  global opencode config, so it also applies to the terminal UI and every folder; a hint says when
  another config (the folder's or your organization's) sets its own shell and hides the choice.
- **A switch per mod.** A puzzle-piece button after **+** and **/** in the prompt bar (with the
  number of active mods) opens a popover listing the mods with one switch each. A switch starts or
  stops only that mod: the others keep their state, bands and open panels. The choice is saved for
  the workspace (the list of mods you turned off), survives Reload Mods and reloading the window,
  and a new mod starts on. With no folder open it lasts until the window closes. With
  `openVsCode.mods.enabled` off the popover still lists the mods, with the switches disabled and an
  **Open Settings** button. **Manage Mods** shows the mods that are off.
- **Work mode (Manual / Auto)**: a pill left of Send in the prompt bar (person icon and
  **Manual**, bolt and **Auto**; only the icon under 200 px) chooses, per session, who answers
  opencode's permission requests. **Manual** changes nothing: the card appears whenever opencode's
  rules ask. In **Auto** the extension answers "once" for you (never "always"), also for the
  session's subagents and for the requests already on screen, and the history says **Allowed
  automatically**. Auto does not approve for you what it **recognises** as reading a secret (`.env`
  files, SSH keys, certificates, `credentials*.json`, `.npmrc`, `.kube/config`…, also when a shell
  command names one), going outside the project (`external_directory`), deleting or moving files
  (a patch that deletes or moves, an `edit` of an unknown shape) or publishing or pushing. Those
  keep the usual card. For shell commands the check is a **heuristic blacklist by family, not a
  guarantee**: it asks for deleters and overwriters (`rm`, `mv`, `cp`, `>`, `tee`), every `git
  push` and the git options that run a command, publishing (`npm publish`, `docker push`, `gh pr
  merge`…), infrastructure and cloud destructives (`kubectl delete`, `terraform destroy`,
  `docker run|exec`…), shells and interpreters fed by stdin or inline code, launchers (`npx`,
  `pnpm exec`, `uv run`, `dnx`, `asdf env`, `wsl`, `ssh`…) classified by what they run (they
  also ask for the options that change where the package comes from, such as `uvx --index` and
  `npx --registry`, and for `uvx --env-file`), `mise env` (it prints secrets), SQL
  clients, copies to another machine (`scp`, `rsync host:`, `sftp`) and publishing through `gh`
  (`repo create --push`, `workflow run`…), an unquoted glob or `$` in a word, a backslash in a
  command name or one that is a POSIX escape (`git pu\sh`; Windows paths such as `src\app.ts`
  are fine), and environment variables that configure what runs (`GIT_*`, `PAGER`, `LD_*`, also
  through `export`; `GIT_EDITOR=true` and a few like it pass), uploads to the cloud
  (`aws s3 sync . s3://b`, `gcloud storage cp … gs://`, `az storage blob upload`, `azcopy`;
  downloads pass), framework database resets (`rails db:drop`, `php artisan migrate:fresh`,
  `manage.py flush`, `dotnet ef database drop`…) and, because in Windows a leading dot hides
  nothing, a recursive listing (`Get-ChildItem -Recurse`, `dir /s`, `ls -R`) unless it lists only
  names (`-Name`, `-Directory`, `dir /b`), and deployments (`vercel --prod`, `firebase deploy`,
  `fly deploy`, `wrangler deploy`, `cdk deploy`, `sam deploy`, `kubectl apply`…). Known limits: it
  classifies one simple command by its text, so it does not know the value-taking options of every
  launcher (`bunx --cwd src tool`), reads `%VAR%` only in capitals, does not look at `--import`
  after `node --test`, and `ls -R` also asks in bash. What it does **not** see is approved: tools
  it does not name (`fd -X rm`, `trash`, `rclone`, `gsutil rm` through an alias…), an alias you
  configured (`git p` for `git push`), what a script does (`bash build.sh`, `npm run clean`) and
  any tool that is not named in its list; reviews keep finding more of those. The agent's own
  questions still reach you. The mode lives in the extension host's memory: a new
  session and a reload start in Manual. New command **OpenCode: Toggle Work Mode** (no default
  shortcut). Auto only answers what opencode asks: what its configuration allows without asking
  runs the same in both modes.

## [1.0.0] - 2026-11-04

First release on the Visual Studio Marketplace and Open VSX.

### Added

- **Spanish and a way to add languages**: the manifest (commands, settings, views), the notices and
  dialogs of the extension host, the chat and the Settings tab follow the display language of VS
  Code; Spanish ships with the extension. VS Code needs the matching language pack installed,
  otherwise it reports English. A new language is two files named after the pack's language id
  (`package.nls.<id>.json`, `l10n/bundle.l10n.<id>.json`) checked by `npm run l10n:check`; see
  `docs/i18n.md`. Visible changes: dates in the chat's session list follow the language of VS Code
  (before, the system's), and the prompt that **Explain** and **Fix with OpenCode** write is in
  the language of VS Code, so the model answers in it. Logs and channel names stay in English.
- **Plugin consent**: before the extension starts opencode in a folder whose opencode config brings
  plugins (files in `.opencode/plugin(s)/`, or `plugins` / `plugin` entries in `opencode.json(c)`,
  npm names included, in the folder or any folder above it) it shows a warning with **Start
  anyway** and **Don't start**. The answer is remembered per folder and asked again if the plugin
  list changes; Start, **OpenCode: Restart Server** and the first prompt ask in a modal. New command
  **OpenCode: Forget Plugin Decision for This Folder**. A plugin that arrives while opencode runs
  (a `git pull`, a branch switch) stops the server and asks again (see Changed). Not covered: a
  server set in `openVsCode.serverUrl`, which the extension does not start. The chat card and the
  status bar say "not started" because of the plugins.
- **Mods**: JavaScript you write yourself, loaded only from `~/.config/opencode-station/mods`
  (never from a project), each in its own Worker. A mod can show a status band in the chat, add
  commands to the `/` menu and to **OpenCode: Run Mod Command…**, show a toast, write text into the
  prompt box (only you send it), open its own panel beside the chat and observe the turns, tools and
  permissions of a session. A mod that throws or hangs is stopped without affecting the chat. Mods
  are not a sandbox: they run with your permissions. Turn them off with `openVsCode.mods.enabled`.
  See `docs/mods.md`.
- OpenCode Settings tab, follow-up: in a remote window every OAuth method says its sign-in may not
  work if it sends you back from the browser; a sign-in link whose query VS Code would rewrite
  (`%26`, `%2B`, `%3D`) is not opened and the notification offers **Copy link**; after you enter
  or dismiss the API key in the native box, the provider card gets the focus back; an OAuth login
  whose status cannot be read three times, or whose local deadline passes while the server still
  says it is pending, is cancelled on the server too (not when the server itself answers expired).
- **OpenCode Settings** tab (**OpenCode: Open Settings…**, also the gear of the Chat and Sessions views):
  the providers of the opencode server with **Connect** (API key in a masked native box that only
  the extension host sees, OAuth `auto` or with a code, external methods) and **Remove**, and the
  MCP servers of the folder with their status, resources and templates, live and read only. The
  previous **Open Settings** command is now **Open Extension Settings** (same id) and is a link at
  the foot of the tab. Credentials are saved by opencode for all your projects; the extension does
  not store, send to the webview or log a key.
- Organize the Sessions tree (`chatLocation: editor`): **folders** and subfolders (**New Folder…**,
  **New Subfolder…**, **Rename Folder…**, **Delete Folder**; **Move to Folder…** or drag the
  rows, several at once), **Pin** and **Unpin** (a **Pinned** section at the top) and **Archive**
  and **Unarchive** (a collapsed **Archived** section at the end; the folder is remembered). A
  **Needs attention** section above them repeats the sessions that are running or waiting for
  input. **Filter Sessions…** keeps the running, the waiting-for-input or the open-in-a-tab
  sessions (**Clear Filters** turns it off; the filter is also written above the rows). The
  tooltip of a row shows the cost and tokens, the folder and, for a session with a tab, the number
  of changed files. **Search Sessions…** also finds archived sessions and says so. Folders, pins and
  the archive are stored per workspace folder in VS Code and are lost if the project folder is
  moved, renamed or cloned again (see Known limitations); no session is ever deleted by them. In
  `sidebar` mode nothing changes and no new command is offered.
- Requests per chat tab: with `chatLocation: editor`, a permission or question shows only in the
  tab of its session or of an ancestor of the subagent that asked (the side bar chat still shows
  all of them). The native notification is titled `OpenCode · <session title>: …` and appears when
  no chat tab that shows the request is the active editor; **Open chat** reveals that tab, or the
  tab of the root session for a subagent with none, and focuses the card. **Needs input** marks the
  root row of the Sessions tree for a request at any depth of its subagents. A new request card no
  longer takes the focus when its chat does not have it (a tab side by side with the one you are
  in), so the notification stays and your focus is not moved. With the side bar chat visible, a
  new request shows its card and the badge, but neither moves the focus nor raises a
  notification (issue #77).
- Native **Sessions** tree in `editor` mode: the OpenCode view lists the root sessions of the
  folder, grouped by Today, Yesterday, Previous 7 days and Older. Each row shows its state with an
  icon (Running, Needs input, Failed) and, when the side bar is wide enough, in words (also Fork
  and Tab) before its time; a long title can hide the words, and the tooltip and the screen
  reader label always carry them. The chat in a tab has no **Sessions** button: the tree is the
  place to browse, search, rename and delete sessions (the side bar chat keeps its button). It
  follows the server without refreshing
  (created, renamed, deleted, running, waiting for input), opens a session in a tab or reveals the
  one it has, renames and deletes from the row (inline buttons, context menu, `F2` and `Delete`),
  searches the titles on the server with **Search Sessions…**, loads 50 more with **Show more
  sessions**, follows the active tab, and shows a welcome with buttons when the folder has no
  sessions, when opencode is not running or when no folder is open. The badge is the number of
  pending requests. Known limits: deleting a session also deletes its subagent sessions, and a tab
  that showed one of them gets the "deleted outside this view" notice (issue #77).
- Setting `openVsCode.chatLocation` (`editor` by default, or `sidebar`; any other value counts as
  `editor`): with `editor` every session opens in its own editor tab beside the code and the
  OpenCode view is the Sessions tree (above); `sidebar` keeps one chat in the OpenCode view.
  Opening a session that already has a tab reveals it, New Session opens a new tab, and
  Insert at cursor and Add selection write into the last text editor, while file links and diffs
  open outside the chat's group. Opening a row of the tree adopts an empty tab instead of leaving
  one behind. Changing the setting applies at
  once: the side bar session opens in a tab, and going back to `sidebar` leaves the tabs open.
  The tabs are restored after Reload Window, each with its session, draft and title (the ones in
  the background when you open them); a restored tab whose session is already open elsewhere
  closes and reveals the other one, and one whose session was deleted comes back empty with a
  notice. With tabs open the extension now activates when the window opens. Known limits: the draft
  in the prompt box does not move when the setting changes, and changing the served folder with
  tabs open leaves them empty (issue #77).
- Editor and Explorer context menus: **Add to OpenCode Chat**, **Explain with OpenCode** and **Fix
  with OpenCode** (Fix includes the errors and warnings VS Code reports for the selection)
  in the editor, and **Explain with OpenCode** on one or more files in the Explorer. The prompt is
  sent at once in the open session, or left in the prompt box with a notice when the chat is busy,
  not connected, or the buffer has unsaved changes, or when the chat took more than 10 s to open
  (issue #36).
- Settings editor: the settings are listed in a fixed order (executable, server address,
  default model, chat location) and link to each other (issue #38).
- opencode v2 detection: finds `opencode2` or `opencode` (or the `openVsCode.opencodePath`
  executable), accepts only major version 2, and resolves npm `.cmd` shims to the real executable
  on Windows (issue #7).
- One `opencode serve` per workspace folder, started on a loopback port with a random password
  and stopped with its whole process tree when the window closes. Restart Server, Select
  Workspace Folder for multi-root workspaces, and an OpenCode output channel (issues #8, #10).
- Connect to an opencode v2 server that is already running on this machine with
  `openVsCode.serverUrl`, with its password kept in VS Code's SecretStorage (issue #11).
- Chat view in the Activity Bar with a prompt box, streaming replies and a status line inside the
  chat that shows the connection state (issues #12, #13, #14).
- Command Palette commands Open Chat, Focus Prompt, New Session and Stop Response, with default
  shortcuts Ctrl+Alt+P / Cmd+Alt+P (Focus Prompt, toggles back to the editor) and Ctrl+Alt+N /
  Cmd+Alt+N (New Session, only with the chat focused); both can be rebound (issue #35).
- Attach files by right-clicking them in the Explorer (**Add to OpenCode Chat**) or by dragging
  them onto the prompt box **while holding Shift**, and paste images (PNG, JPEG, GIF, WebP, up to
  10 MiB) with Ctrl/Cmd+V (issue #30). An image dropped from the system's file manager is attached
  like a pasted one; any other file from there is refused with a notice. Retry, "Fork from here"
  and "Revert from here" do not re-attach pasted images. In VS Code 1.140 or later the Explorer drop is reported not to reach
  extension views at all
  ([microsoft/vscode#339036](https://github.com/microsoft/vscode/issues/339036), not reproduced
  here); the menu command, Attach and `@` mentions keep working.
- Markdown rendering while streaming, syntax highlighting, and code actions (copy, insert at the
  cursor, open in a new file, open `path:line` references) (issue #15).
- Stop button and Escape to interrupt a turn, a neutral "Stopped" note, and readable error
  messages (issue #16).
- Light, dark and high-contrast themes, keyboard navigation and screen-reader labels (issue #17).
- Permission cards, a notification and a badge when the chat is hidden, and a list of saved
  permissions that can be revoked (issues #18, #19).
- Question cards, and a line in the history for every permission or question already answered
  (issues #44, #56).
- Session list with groups, search, rename and delete; the open session is remembered per
  workspace (issues #20, #22).
- Fork a session from any of your messages, and open subagent sessions from their tool call
  (issue #21).
- Model and agent (Build/Plan) selectors, the `openVsCode.defaultModel` setting and the reasoning
  variant control (issues #23, #24, #61).
- Collapsible tool cards for shell, read, grep and edit, with diffs for edits (issue #26).
- `@` file mentions in the prompt and an "Add selection" button that attaches the editor
  selection (issues #28, #29).
- A line under the session title with the context used by the last step and, for paid models,
  the session cost including direct subagents (issue #25).
- Continuous integration on Windows, macOS and Linux, with a check of the packaged file list
  (issue #5).
- Marketplace packaging: icon, README, changelog and license (issue #42).
- Release workflow that publishes the same package to the VS Code Marketplace and Open VSX from a
  version tag (issue #43).

### Changed

- opencode now starts with its file watcher off (`OPENCODE_FILEWATCHER_DISABLE=1`), so it no longer
  imports a project plugin that lands while it runs (opencode 2.0.32 did so in under half a
  second, with no prompt). Instead the extension watches the served folder: a plugin you have not
  allowed stops the server (cutting a running turn) and asks again, before it runs. The cost:
  changes to opencode's config, `AGENTS.md`, skills and commands now apply after **OpenCode:
  Restart Server**. Not covered: plugin folders above the served one, events lost to
  `files.watcherExclude` or symlinks, and a plugin written while the server is still starting,
  which can run once (issue #158).
- Mods have flood limits: at most 50 lines a second in the **OpenCode Mods** channel (including the
  extension's warnings about what the mod sends) and 30 messages a second to its panels; the rest
  is dropped with one warning per second. Command arguments are capped at 4000 characters on every
  path, **OpenCode: Run Mod Command…** included (issue #155).
- Mod commands show in the `/` menu and run even when opencode is not running (autoStart off,
  starting, reconnecting): a typed mod command runs in its mod instead of going out as a prompt,
  which used to start the server. opencode's own commands appear once the server sends them
  (issue #155).
- Mods are sturdier around shutdown: a load or a message that ends after the extension stops no
  longer writes to a closed output channel. A panel page's warning for a dropped message is limited
  to one a second per panel. `docs/mods.md` now says that a link inside a mod folder that points
  outside it can be read by that mod's panel page (issue #155).
- The license is now the [PolyForm Shield License 1.0.0](LICENSE) instead of MIT: you may use,
  change and share the extension for any purpose except providing a product that competes with
  it. It is source-available, not an OSI open source license.
- Choosing an agent, a model or a reasoning level in the chip panel no longer closes it, so all
  three can be changed in one opening. The chip, Escape, a click outside and moving the focus away
  still close it.
- Chat view in the side bar: **Open Settings** is a title button and **Restart Server** moved to the
  "…" menu, as in the Sessions view (issue #133).
