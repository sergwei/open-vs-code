# Settings, commands and keyboard shortcuts

Back to the [README](../README.md) ([Español](../README.es.md)). This page lists every setting,
command and default keyboard shortcut the extension contributes. A test
(`src/extension/marketplace.test.ts`) keeps the three tables below in step with `package.json`.

## Settings

| Setting | Scope | Default | What it does |
| --- | --- | --- | --- |
| `openVsCode.opencodePath` | machine | empty | Absolute path to the opencode **v2** executable. Empty searches `PATH` for `opencode2`, then `opencode`. On Windows an npm `opencode.cmd` shim is accepted. Not used while `openVsCode.serverUrl` is set. |
| `openVsCode.serverUrl` | machine | empty | Address of an opencode **v2** server that is already running on **this machine**, for example `http://127.0.0.1:4096`. Empty lets the extension launch its own server. The extension then does not use `openVsCode.opencodePath`. See [Using a server you started](#using-a-server-you-started). |
| `openVsCode.defaultModel` | window | empty | Model every **new** chat session starts with, written `provider/model` (for example `opencode/big-pickle`). It wins over the last model you used. A badly written or unavailable value is ignored with a warning. |
| `openVsCode.autoStart` | window | `true` | Launch the opencode server when the window starts. Turn it off and the chat shows **not started**; **OpenCode: Restart Server**, the Start button or your first prompt starts it. No effect while `openVsCode.serverUrl` is set. |
| `openVsCode.mods.enabled` | machine | `true` | Load the mods in the OpenCode mods folder. A mod is JavaScript that runs with your user's permissions in its own worker thread; it is **not** sandboxed. Turn it off to load none, in every workspace. A workspace cannot change it. To turn off one mod in one workspace use the mods button of the prompt bar (see [mods.md](mods.md)). |
| `openVsCode.chatLocation` | window | `editor` | Where the chat lives: `editor` (one editor tab per session, and the OpenCode view lists the sessions) or `sidebar` (one chat in the OpenCode view). Any other value counts as `editor`. |

## Commands

All commands are in the Command Palette under the **OpenCode** category, except the ones without a
category below, which live in the right-click menus. The three editor entries are also in the
Command Palette (they act on the active editor); the two Explorer entries are not.

| Command | What it does |
| --- | --- |
| **OpenCode: Show Logs** | Opens the OpenCode output channel. |
| **OpenCode: Manage Mods…** | Lists the mods found in the mods folder with their state (active, failed and why, or off in this workspace), and offers Reload, Open Mods Folder and Show Logs. |
| **OpenCode: Reload Mods** | Stops every mod and discovers them again, except the ones switched off in this workspace. |
| **OpenCode: Open Mods Folder** | Creates the mods folder if needed and reveals it in the file manager. |
| **OpenCode: Run Mod Command…** | Picks one of the commands that mods registered and runs it. |
| **OpenCode: Restart Server** | Restarts the server the extension launched (it also starts it when `openVsCode.autoStart` is off), or reconnects to the server in `openVsCode.serverUrl` when that setting is set. Also an entry in the `...` menu of the title bar of the Chat view (`chatLocation` set to `sidebar`) and of the Sessions view. |
| **OpenCode: Forget Plugin Decision for This Folder** | Forgets your Start anyway / Don't start answer for the folder the server runs in, so the extension asks again before it starts opencode there. It stops nothing and starts nothing. |
| **OpenCode: Select Workspace Folder** | Chooses which folder the server runs in (multi-root workspaces only). |
| **OpenCode: Manage Saved Permissions** | Lists the permissions you chose to always allow and lets you revoke them. |
| **OpenCode: Set Server Password** | Stores the password of the server in `openVsCode.serverUrl` in VS Code's SecretStorage. |
| **OpenCode: Forget Server Password** | Deletes that stored password. |
| **OpenCode: Open Chat** | Shows the chat and puts the caret in the prompt. |
| **OpenCode: Focus Prompt** | Puts the caret in the prompt; pressed again while the chat has the focus, it returns to the editor. |
| **OpenCode: New Session** | Opens a new empty chat tab (the default, `chatLocation` set to `editor`). With `chatLocation` set to `sidebar` it is the same as the **New session** button: the next prompt starts a new session and your draft is kept. |
| **OpenCode: Open Settings…** | Opens the **OpenCode Settings** tab (or shows it if it is already open): the providers of the opencode server, with **Connect** (API key in a masked box of VS Code, OAuth in your browser, or an external method) and **Remove**, and the MCP servers of the folder with their status and resources (with **Connect**, **Disconnect** and **Sign in**, which last until opencode restarts, and **Refresh**), plus the **General**, **Mods**, **Work mode** and **Advanced** sections (chat location and automatic start, a switch per mod, an **Open chat** button, the server password, the saved permissions, the shell of opencode, which is saved in the global opencode config). It is also the gear in the title bar of the Chat and Sessions views. Credentials are saved by opencode for all your projects; the extension never stores or logs a key. |
| **OpenCode: Open Extension Settings** | Opens Settings filtered to this extension (a link at the foot of the OpenCode Settings tab). |
| **OpenCode: Stop Response** | Same as **Stop**: interrupts the running turn. Run from the editor it also shows the chat; with no turn running it only says "No response is running". |
| **OpenCode: Toggle Work Mode** | Switches the chat's session between **Manual** (opencode's own rules decide when a permission is asked) and **Auto** (the extension answers "allow once" to the permission requests of that session and its subagents, but keeps the card for what it recognises as reading a secret (`.env` files, SSH keys, certificates, credentials, also when a shell command names one), going outside the project, deleting or moving files, publishing or pushing (`git push`, `npm publish`, `docker push`, `gh pr merge`…) or running a destructive or unclassifiable shell command (disk, git, Kubernetes, Terraform, Docker, cloud CLIs, stdin or inline code, launchers such as `npx`, `uv run` or `ssh`, copies to another machine such as `scp` or `rsync host:`, uploads to the cloud (`aws s3 sync . s3://b`; downloads pass), framework database resets (`rails db:drop`, `php artisan migrate:fresh`), a recursive listing that is not names only (`Get-ChildItem -Recurse`, `dir /s`, also `ls -R` in bash), deployments (`vercel --prod`, `firebase deploy`, `fly deploy`, `kubectl apply`…), publishing through `gh`, an unquoted glob or `$`, a backslash escape; Windows paths such as `src\app.ts` are fine). For shell commands that check is a heuristic blacklist, not a guarantee: it does not see aliases you configured, what a script does, or tools it does not list. The agent's own questions still reach you). Has no default key; bind one in Keyboard Shortcuts if you want. |
| **OpenCode: Rename Session…** | Row of the Sessions list (shown while `chatLocation` is not `sidebar`; the default is `editor`): asks for a new title. Also the pencil on the row and `F2`; not in the Command Palette. |
| **OpenCode: Delete Session** | Row of the Sessions list: after a confirmation, deletes the session for every opencode client and closes its tab. Also the bin on the row and `Delete`; not in the Command Palette. |
| **OpenCode: Search Sessions…** | Searches the session titles on the server and opens the one you pick. Only offered while `chatLocation` is not `sidebar` (the default is `editor`). Also a button in the Sessions title bar. |
| **OpenCode: New Folder…** | Creates a folder in the Sessions list to organize sessions in. Only offered while `chatLocation` is not `sidebar`. Also in the `…` menu of the Sessions title bar. |
| **OpenCode: New Subfolder…** | Row menu of a folder: creates a folder inside it. Not in the Command Palette. |
| **OpenCode: Rename Folder…** | Row menu of a folder: asks for a new name. Not in the Command Palette. |
| **OpenCode: Delete Folder** | Row menu of a folder: after a confirmation, deletes the folder and its subfolders. The sessions inside go back to the date groups; no session is deleted. Not in the Command Palette. |
| **OpenCode: Move to Folder…** | Row menu of a session (or of several selected): picks a folder, "No Folder" or a new folder. You can also drag the rows onto a folder. Not in the Command Palette. |
| **OpenCode: Pin** | Row menu of a session: shows it under "Pinned" at the top of the list. Not in the Command Palette. |
| **OpenCode: Unpin** | Row menu of a pinned session: puts it back. Not in the Command Palette. |
| **OpenCode: Archive** | Row menu of a session: moves it to the collapsed "Archived" section at the end (its folder is remembered). Not in the Command Palette. |
| **OpenCode: Unarchive** | Row menu of an archived session: brings it back to its folder or date group. Not in the Command Palette. |
| **OpenCode: Filter Sessions…** | Shows only the sessions that are running, wait for your input or are open in a tab (the ones you tick are ORed). Only offered while `chatLocation` is not `sidebar`. Also a button in the Sessions title bar. |
| **OpenCode: Clear Filters** | Turns the Sessions filters off. Offered only while a filter is on; also a button in the Sessions title bar. |
| **OpenCode: Refresh Changes** | Button in the title bar of the **Changes of the sessions** view: reads again the files of the sessions you have expanded. Not in the Command Palette. |
| **OpenCode: Refresh Usage** | Button in the title bar of the **Usage (all projects)** view: reads both periods again. Not in the Command Palette. |
| **Add to OpenCode Chat** | Explorer right-click menu: attaches the selected files to the prompt. |
| **Add to OpenCode Chat** | Editor right-click menu: attaches the selection (the whole file when nothing is selected). |
| **Explain with OpenCode** | Editor right-click menu: sends "Explain what @file#lines does." with the selection (or the file) attached. |
| **Explain with OpenCode** | Explorer right-click menu: sends "Explain what @a and @b do." with the selected files attached. |
| **Fix with OpenCode** | Editor right-click menu: sends "Fix the problems in @file#lines." with the selection attached and the errors and warnings VS Code reports there (up to 20). |

## Keyboard shortcuts

Four commands have a default shortcut. Change them in **File > Preferences > Keyboard Shortcuts**
(search for "OpenCode"); the other commands have none by default and you can bind them there too.

| Windows / Linux | macOS | Command | Works when |
| --- | --- | --- | --- |
| `Ctrl+Alt+P` | `Cmd+Alt+P` | OpenCode: Focus Prompt | the editor or the chat has the focus |
| `Ctrl+Alt+N` | `Cmd+Alt+N` | OpenCode: New Session | the chat has the focus |
| `F2` | `F2` | OpenCode: Rename Session… | the Sessions list has the focus |
| `Delete` | `Cmd+Backspace` | OpenCode: Delete Session | the Sessions list has the focus |

On Windows, Ctrl+Alt is the same as AltGr: if your keyboard layout types a character with AltGr+P
or AltGr+N, rebind the shortcut in Keyboard Shortcuts or it will run the command instead of typing.

## Using a server you started

Set `openVsCode.serverUrl` to a server that is already running on the same machine (`127.0.0.1`,
`[::1]` or `localhost`, over `http` or `https`). The extension then does not launch its own. If the
server has a password, run **OpenCode: Set Server Password**; the user name is always `opencode`.
