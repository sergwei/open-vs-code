# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Setting `openVsCode.chatLocation` (`sidebar` by default, or `editor`): with `editor` every session
  opens in its own editor tab beside the code and the OpenCode view becomes a launcher (New
  Session, Open Chat, Open Settings). Opening a session that already has a tab reveals it, New
  Session opens a new tab, and Insert at cursor and Add selection write into the last text editor,
  while file links and diffs open outside the chat's group. A tab with no session opens the
  session you pick in it, instead of leaving an empty tab behind. Changing the setting applies at
  once: the side bar session opens in a tab, and going back to `sidebar` leaves the tabs open.
  Known limits: the tabs are closed by Reload Window (Open Chat reopens the last session), every
  tab shows every pending request, the draft in the prompt box does not move when the setting
  changes, and changing the served folder with tabs open leaves them empty (issue #77).
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
