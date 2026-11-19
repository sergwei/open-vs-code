# Privacy and security

Back to the [README](../README.md) ([Español](../README.es.md)).

**Workspace Trust.** The extension does not support untrusted workspaces
(`capabilities.untrustedWorkspaces.supported: false`): while a folder is in Restricted Mode, VS Code
does not load it. The reason is that opencode can run what the project defines, with the
permissions of your user: a slash command in `.opencode/command` whose text contains `` !`cmd` ``
runs that shell command on your machine when you run the command. Trust the folder only if you
trust whoever wrote its `.opencode` files, its `opencode.json` and its `AGENTS.md`. (Checked by
`npm run test:visual`, step 25, on VS Code 1.144.0 and Windows 11 only.)

**Plugins of the folder.** opencode loads and runs, without asking, the plugins a project brings:
`.ts` and `.js` files in `.opencode/plugin/` and `.opencode/plugins/`, and every entry of `plugins`
(or `plugin`) in `opencode.json` / `opencode.jsonc` and in `.opencode/opencode.json(c)`, npm package
names included (opencode downloads and runs them). It looks in the folder you opened **and in every
folder above it**. Before the extension starts opencode in such a folder it shows a warning, "This
folder has opencode plugins that will run with your permissions", with **Start anyway** and
**Don't start**; the answer is remembered per folder on this machine and the question comes back if
the list of plugins changes. Start, **OpenCode: Restart Server** or your first prompt ask in a modal
instead. **OpenCode: Forget Plugin Decision for This Folder** clears the answer.

*While opencode runs.* opencode 2.0.32 imports a plugin that appears in the folder it serves within
a fraction of a second, with no request at all (checked against a real opencode 2.0.32 on Windows
11: 223 to 446 ms for a file in `.opencode/plugins/`, one in `.opencode/plugin/` and an entry in
`opencode.json`). So the extension starts opencode with its file watcher off
(`OPENCODE_FILEWATCHER_DISABLE=1`; with it, the same plugin was not loaded in 17 s) and watches the
served folder itself: `opencode.json(c)` and `.opencode/` (which holds `.opencode/plugin(s)/` and
`.opencode/opencode.json(c)`). If a change makes the list of plugins one you have not approved, the
extension stops the server and asks as above, before the plugin has run. That restart also cuts a
turn that is in progress. A change that leaves the list approved or empty (a new command, a deleted
plugin, an edit to a plugin you allowed) restarts nothing.

*The cost.* With opencode's watcher off, opencode no longer picks up by itself changes to its
config, `AGENTS.md`, skills or commands while it runs: run **OpenCode: Restart Server** to apply
them.

*What this does not cover.* It does not apply when you connect to a server with
`openVsCode.serverUrl` (the extension starts nothing and does not watch). Plugins in folders
**above** the one you opened are not watched; opencode also rescans every 24 hours (`supervisor.ts`,
read in the source and not executed), and that rescan is not covered; nor is the one opencode runs
when its own config is updated (for example when you connect a provider), read in the same file and
not executed. A `files.watcherExclude` setting that hides `.opencode` from VS Code, and symlinks,
may stop the events from arriving. A plugin written while the server is still starting (`starting`)
can run once before the check made when it becomes ready stops the server. And it does not cover
the other code a project config can run (for example local MCP servers). The detection replicates
what opencode 2.0.32 reads. Checked once against a real opencode 2.0.32 on Windows 11: a plugin
file in `.opencode/plugins/` was imported by the first request that loads the folder's models (`GET
/api/model`), not when the server started and not by the other requests tried (`GET /api/info`,
`/api/session`, `/api/agent` and `/api/command`); the extension makes the `GET /api/model` request
as soon as it connects, so asking before the start is still the right moment. The hot-reload check
is only on Windows; macOS and Linux are covered by CI alone.

The chat view never talks to the opencode server. The port and the password live only in the
extension host, and the server password you set is kept in VS Code's SecretStorage. The extension
does not send any data anywhere other than to the opencode server you use.

An API key typed in the OpenCode Settings tab is asked only in a native VS Code input box: it does
not pass through the webview or the log, and opencode stores it.
