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
- **Drop files and paste images (issue #30):** right-click files in the Explorer and choose
  **Add to OpenCode Chat** (works in every VS Code version), or drag them from the Explorer onto the
  prompt box **while holding Shift** (VS Code only delivers a drop to a side-bar view with Shift
  held). Only regular files inside the workspace folder are
  added, and a dropped file must also be one that opencode lists (what git ignores, `.env`
  included, cannot be dropped: use Attach for that); folders and anything else are skipped with
  one notice that counts them. Paste an image (PNG, JPEG, GIF or WebP, up to 10 MiB) with
  Ctrl/Cmd+V to attach it, with a thumbnail on its chip; an image dropped from your system's file
  manager is attached the same way, and any other file dropped from there is refused with a notice
  (drop it from the VS Code Explorer, or use Attach). If the selected model cannot read images,
  the chat says so and opencode tells the model. **Retry, "Fork from here" and "Revert from here"
  re-attach files but not pasted images**: paste them again.
- **Context and cost:** a line under the session title shows how much of the model's context the
  last step used and, when the model is not free, what the session cost so far, direct subagents
  included.
- **Changed files:** a "Changed files (N)" list under the header shows what the agent changed in
  the session (git repositories only); a click opens VS Code's own diff editor with the original on
  the left and the file on the right.
- **Revert from a message:** "Revert from here" on one of your messages undoes that turn and
  everything after it, files included, and hides those messages. A block under the conversation
  lists the files it restored, "Restore" brings everything back and "Discard for good" deletes the
  hidden messages. Sending a new message also makes the revert final. The revert also replaces
  edits you made by hand to those files after the reverted turns touched them: "Restore" brings them back
  (but drops what you edited while reverted), and once the revert is final they are gone.
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

All commands are in the Command Palette under the **OpenCode** category, except **Add to OpenCode
Chat**, which lives in the Explorer's right-click menu.

| Command | What it does |
| --- | --- |
| **OpenCode: Show Logs** | Opens the OpenCode output channel. |
| **OpenCode: Restart Server** | Restarts the server the extension launched, or reconnects to the server in `openVsCode.serverUrl` when that setting is set. Also a button in the chat title bar. |
| **OpenCode: Select Workspace Folder** | Chooses which folder the server runs in (multi-root workspaces only). |
| **OpenCode: Manage Saved Permissions** | Lists the permissions you chose to always allow and lets you revoke them. |
| **OpenCode: Set Server Password** | Stores the password of the server in `openVsCode.serverUrl` in VS Code's SecretStorage. |
| **OpenCode: Forget Server Password** | Deletes that stored password. |
| **Add to OpenCode Chat** | Explorer right-click menu: attaches the selected files to the prompt. |

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
- Dragging files from the Explorer onto the chat is reported not to work in VS Code 1.140 or later:
  the drop does not reach extension views, with or without Shift
  ([microsoft/vscode#339036](https://github.com/microsoft/vscode/issues/339036), open; this
  project has not been able to reproduce a real drag in its own tests). It is reported to work up
  to 1.139. **Add to OpenCode Chat**, Attach and `@` mentions work in every version.
- Not yet: slash commands (issue #33).
- Mostly tested on Windows; CI builds and tests on Windows, macOS and Linux.

## Privacy and security

The chat view never talks to the opencode server. The port and the password live only in the
extension host, and the server password you set is kept in VS Code's SecretStorage. The extension
does not send any data anywhere other than to the opencode server you use.

## License

[MIT](LICENSE). opencode itself is a separate project by [anomalyco](https://github.com/anomalyco/opencode)
under its own license.
