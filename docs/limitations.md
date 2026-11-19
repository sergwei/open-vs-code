# Known limitations

Back to the [README](../README.md) ([Español](../README.es.md)). This page lists what is known not to
work, or not to have been tried, in this extension.

- Only opencode v2; only a server on the local machine.
- The subagent monitor shows no elapsed time for a subagent that was already running when you
  opened the session, until that subagent's next event (a decided limit: there is no fallback). It
  shows no percentage, counts tools up to "200+", and it has only been exercised with the synthetic
  server: no subagent turn of a real opencode was run, the background case (`background: true`)
  included, and that stopping one subagent leaves its parent turn going on is read from opencode's
  source, not observed.
- VS Code may not see the PATH of a shell that uses a Node version manager such as fnm or nvm,
  depending on how VS Code is launched (for example, not from that shell). If the extension cannot
  find opencode, set `openVsCode.opencodePath` to the executable (`opencode.exe` on Windows).
- The folders, pins and archive of the Sessions tree live in VS Code's workspace storage, not in
  opencode, so the opencode TUI and other clients do not see them. VS Code ties that storage to the
  folder's path and to when it was created: **moving or renaming the project folder, cloning it
  again, or opening it by itself instead of through its `.code-workspace` file starts with an empty
  organization and loses the one you had**, and nothing tells you so. In that case opencode also
  stops listing the old sessions in this window, because it keeps each session under the exact
  folder path it was created in; so the organization is the smaller loss. There is no export or
  import of the organization yet.
- "Allowed once" lines in the history do not survive **Developer: Reload Window**: opencode keeps no
  trace of a permission that was allowed once.
- Dragging files from the Explorer onto the chat is reported not to work in VS Code 1.140 or later:
  the drop does not reach extension views, with or without Shift
  ([microsoft/vscode#339036](https://github.com/microsoft/vscode/issues/339036), open; this project
  has not been able to reproduce a real drag in its own tests). It is reported to work up to 1.139.
  **Add to OpenCode Chat**, Attach and `@` mentions work in every version.
- The default shortcuts use Ctrl+Alt (Cmd+Alt on macOS), which is AltGr on Windows; see
  [Keyboard shortcuts](commands.md#keyboard-shortcuts) to rebind them. They are checked against the
  default shortcuts of VS Code, not against those of your desktop environment or other extensions.
- The editor and Explorer context menus were only tried on Windows. On macOS and Linux (and on macOS
  with `window.titleBarStyle` set to `native`) VS Code may draw the menus natively; they should work
  the same, but this project has not run them there.
- The editor menu entries read the **saved** file: opencode reads the file from disk, so with
  unsaved changes the line numbers may not match what the model sees. Explain and Fix then do not
  send by themselves: they leave the prompt in the box with an "Unsaved changes" notice. Files that
  are not on disk (untitled, `git:` or output documents) have no entries.
- In `editor` mode every chat tab keeps its page in memory while it is hidden
  (`retainContextWhenHidden`), so each open tab costs memory; there is no cap on the number of tabs.
- Chat tabs are restored after **Developer: Reload Window**, but VS Code only brings back a tab when
  it is shown: the tabs in the background are restored when you open them, not before. A restored
  tab whose session is already open in another tab (or in the side bar view) closes itself and
  reveals the one that has it. One whose session was deleted comes back empty, with the notice "This
  session no longer exists", and keeps its draft. With `sidebar` the restored tabs stay open next to
  the view, as extra tabs.
- The Sessions tree lists the root sessions of the folder (50 at a time); subagent sessions are not
  rows, you reach them from the tab of their parent. **Needs input** marks a row for a request of
  its own session or of a subagent at any depth below it. The rows are emptied while the server is
  not running and come back on the next reconnection. The order only changes with the events that
  move a session's update time, so it can be stale until the next reconnection.
- Deleting a session deletes its subagent sessions too (opencode does it). A tab that was showing
  one of those subagent sessions gets the notice "deleted outside this view", although you deleted
  it yourself from the Sessions tree.
- While chat tabs are open, the extension starts when the window opens (VS Code needs it to restore
  them), so the opencode server starts even if you do not touch the chat.
- In `editor` mode a pending permission or question shows only in the tab of its session (and, for a
  subagent, in the tab of an ancestor session); the side bar chat still shows every one. You get the
  native notification, titled with the chat it comes from, when no chat tab that shows the request
  is the active editor, and **Open chat** reveals that tab (the tab of the root session for a
  subagent with no tab of its own). With two tabs side by side, a request from the one you are not
  in raises the notification and leaves your focus where it was; its card is not focused until you
  go to that tab (or press **Open chat**). With the side bar chat visible, a new request shows its
  card and the badge, but it neither moves the focus nor raises a notification. The chat tabs left
  over from `editor` mode keep showing only the requests of their own session and lineage in
  `sidebar` mode too, and **Open chat** looks in those tabs before the side bar chat.
- In `editor` mode, switching to another served folder (for example with **Select Workspace
  Folder**) while tabs are open leaves them empty, with the old title, until they are reloaded; only
  the first chat gets the session remembered for the new folder.
- The draft in the prompt box does not travel when `openVsCode.chatLocation` changes: the text and
  the attachments of the old surface stay with it.
- The editor tabs were only tried on Windows; the integration tests run on Windows, macOS and Linux,
  but the visual checks of the tabs do not.
- OpenCode Settings tab: opencode does not check an API key when you connect it, so the tab says
  "Connected" even with a wrong key and the failure shows on your first prompt. Browser OAuth
  methods probably fail in a remote window (SSH, WSL, Codespaces), because opencode listens for the
  callback on the remote machine; device-code methods work. In a remote window the tab says under
  every OAuth method that the sign-in "may not work if it sends you back from the browser" (it also
  says it for device-code methods, which do work). When the sign-in link carries `%26`, `%2B` or
  `%3D` in its query, VS Code would change it on its way to the browser, so the tab does not open
  it: the notification offers **Copy link** and you open the link in your browser yourself. "Sign in
  with ChatGPT" uses the fixed port 1455, which another process may already hold. opencode saves
  the credentials for all your projects, not only this one. The tab does not come back after Reload
  Window.
- Mostly tested on Windows; CI builds and tests on Windows, macOS and Linux.
