# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
- Marketplace packaging: icon, README, changelog and MIT license (issue #42).
- Release workflow that publishes the same package to the VS Code Marketplace and Open VSX from a
  version tag (issue #43).

### Changed

- Choosing an agent, a model or a reasoning level in the chip panel no longer closes it, so all
  three can be changed in one opening. The chip, Escape, a click outside and moving the focus away
  still close it.
- Chat view in the side bar: **Open Settings** is a title button and **Restart Server** moved to the
  "…" menu, as in the Sessions view (issue #133).
