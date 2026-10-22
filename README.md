# OpenCode GUI

A mouse-friendly chat interface for [opencode](https://github.com/anomalyco/opencode), inside
VS Code. It gives opencode the kind of graphical interface the Claude Code extension has, so you
do not depend on the limits of a terminal (many terminals on Linux and macOS do not support the
mouse).

The extension is a **client of `opencode serve`**, not a wrapper around the terminal UI: it starts
the server for your workspace and talks to it over HTTP. This is an unofficial project: it is not
affiliated with opencode or with Microsoft.

> **Only opencode v2 is supported** (major version 2, tested with 2.0.32). The 1.x line
> (`opencode-ai`) does not work with this extension.

## Features

- **Streaming chat** with Markdown, syntax highlighting and code actions: copy, insert at the
  cursor, open in a new file, and open `path:line` references in the editor.

  ![The chat view showing a reply with TypeScript and bash code blocks, a table and a list, each code block with Copy, Insert and New file buttons](docs/images/chat-markdown.png)

- **Permission and question cards.** When opencode asks, you answer with a click. With the chat
  hidden you get a notification and a badge on the Activity Bar icon.

  ![A permission card for the read tool with the buttons Allow once, Always allow, Reject and Reject with feedback](docs/images/permission-card.png)

- **Sessions:** a list with groups and search, rename, delete, fork from any of your messages and
  jump into subagent sessions. The open session is remembered per workspace.

  ![A forked session with a "Forked from" crumb above the first exchange and the Fork from here button on the message](docs/images/fork-session.png)

- **Model, agent and reasoning variant** pickers: choose the model, switch between Build and Plan,
  and pick a reasoning variant when the model offers them.

  ![The model picker open above the prompt box, with a search field and a list of models grouped by provider](docs/images/model-picker.png)

- **Collapsible tool cards** for shell, read, grep and edit calls, with diffs for edits.
- **`@` mentions** to add files to the prompt, and an "Add selection" button that attaches the
  editor selection.
- **Themes and accessibility:** light, dark and high-contrast, keyboard navigation and screen
  reader labels. Colors come from your VS Code theme.

## Requirements

- VS Code 1.105 or later.
- opencode **v2** installed on the machine where VS Code runs:
  - npm: `npm i -g @opencode/cli`. With npm 11 the install script is blocked and the binary is not
    created; use `npm i -g --allow-scripts=@opencode/cli @opencode/cli` instead.
  - Homebrew: `brew install anomalyco/tap/opencode-v2`.
- A provider and model configured in opencode.

## Installation

The extension is not on the Marketplace yet; issue #43 will publish it there. Until then, build the
`.vsix` from the source code (Node 24 and git are needed):

1. Clone the repository: `git clone https://github.com/sergwei/open-vs-code.git`
2. In the cloned folder, install the dependencies: `npm ci`
3. Build the package: `npm run vsix`. It writes `open-vs-code-<version>.vsix` in that folder.
4. In VS Code, run **Extensions: Install from VSIX...** from the Command Palette and pick that
   file (or `code --install-extension open-vs-code-<version>.vsix`).

## Usage

1. Open a folder in VS Code and click the **OpenCode** icon in the Activity Bar, then open the
   **Chat** view.
2. The extension starts `opencode serve` for the workspace folder, on `127.0.0.1` with a random port
   and a random password, and stops it when the window closes.
3. Type a prompt and press Enter. Press Escape or **Stop** to interrupt a turn.

In a multi-root workspace, choose the folder opencode works in with **OpenCode: Select Workspace
Folder**.

## Settings

| Setting | Scope | Default | What it does |
| --- | --- | --- | --- |
| `openVsCode.opencodePath` | machine | empty | Absolute path to the opencode **v2** executable. Empty searches `PATH` for `opencode2`, then `opencode`. |
| `openVsCode.serverUrl` | machine | empty | Address of an opencode **v2** server that is already running on **this machine**, for example `http://127.0.0.1:4096`. Empty lets the extension launch its own server. See [Using a server you started](#using-a-server-you-started). |
| `openVsCode.defaultModel` | window | empty | Model every **new** chat session starts with, written `provider/model` (for example `opencode/big-pickle`). It wins over the last model you used. A badly written or unavailable value is ignored with a warning. |

## Commands

All commands are in the Command Palette under the **OpenCode** category.

| Command | What it does |
| --- | --- |
| **OpenCode: Show Logs** | Opens the OpenCode output channel. |
| **OpenCode: Restart Server** | Restarts the server the extension launched, or reconnects to the server in `openVsCode.serverUrl` when that setting is set. Also a button in the chat title bar. |
| **OpenCode: Select Workspace Folder** | Chooses which folder the server runs in (multi-root workspaces only). |
| **OpenCode: Manage Saved Permissions** | Lists the permissions you chose to always allow and lets you revoke them. |
| **OpenCode: Set Server Password** | Stores the password of the server in `openVsCode.serverUrl` in VS Code's SecretStorage. |
| **OpenCode: Forget Server Password** | Deletes that stored password. |

## Using a server you started

Set `openVsCode.serverUrl` to a server that is already running on the same machine
(`127.0.0.1`, `[::1]` or `localhost`, over `http` or `https`). The extension then does not launch
its own. If the server has a password, run **OpenCode: Set Server Password**; the user name is
always `opencode`.

## Known limitations

- Only opencode v2; only a server on the local machine.
- VS Code may not see the PATH of a shell that uses a Node version manager such as fnm or nvm,
  depending on how VS Code is launched (for example, not from that shell). If the extension cannot
  find opencode, set `openVsCode.opencodePath` to the executable
  (`opencode.exe` on Windows).
- "Allowed once" lines in the history do not survive **Developer: Reload Window**: opencode keeps no
  trace of a permission that was allowed once.
- Not yet: context and token usage (issue #25), dragging images into the prompt (issue #30), a
  diff of the session changes (issue #31), reverting changes (issue #32) and slash commands
  (issue #33).
- Mostly tested on Windows; CI builds and tests on Windows, macOS and Linux.

## Privacy and security

The chat view never talks to the opencode server. The port and the password live only in the
extension host, and the server password you set is kept in VS Code's SecretStorage. The extension
does not send any data anywhere other than to the opencode server you use.

## License

[MIT](LICENSE). opencode itself is a separate project by [anomalyco](https://github.com/anomalyco/opencode)
under its own license.
