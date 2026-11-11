// The editor tabs that mods open with `station.ui.panel.open` (E10-mods phase 4; plan Engram #1765
// section 3.3 option B, decision P1=2): one `WebviewPanel` per panel, built by the host.
//
// What a panel is allowed to be (architecture rules 1, 2 and 6):
//   - It is not the chat webview and shares nothing with it. Its page is served files by path under
//     its mod folder (`localResourceRoots` = that folder; before VS Code 1.146 the roots are
//     compared as text, so a link inside the folder that points outside is readable by the page;
//     from 1.146 the real path is resolved and such a file is refused, microsoft/vscode#346026: see
//     `resolveModFile` and `docs/mods.md`), and its HTML comes from
//     `buildModPanelHtml`, whose CSP has no `connect-src`: the page cannot make a request, so it can
//     reach neither the opencode server nor the network. The server URL and the password never enter
//     this file; the only data that crosses is what the mod and its page choose to exchange.
//   - The one exception to "every host <-> webview message is typed" (rule 2): the payload of a
//     panel message is opaque JSON chosen by the mod, capped at 1 MB in both directions
//     (`isPanelData`). The channel itself is typed: `ModHost` only relays a message to the panel of
//     the mod that owns it.
//
// A panel closes when the mod closes it, when the user closes the tab (the mod is told with
// `panel.closed`) and when the mod stops or fails or the mods reload (`ModHost` calls `close` for
// each open panel). The tab is created with `preserveFocus` so opening it does not steal the
// composer, and without `retainContextWhenHidden` (memory; `vscode-extension` section 2): a hidden
// tab's page is rebuilt when shown, and a message posted while it is hidden is dropped.

import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import type { ModJson } from '../mods/api';
import { isPanelData, type LogLevel } from '../mods/wire';
import type { ModPanelRequest, ModPanelUi } from './modHost';
import { buildModPanelHtml } from './modPanelHtml';
import { PANEL_DROP_WARN_WINDOW_MS, createWarnGate, resolveModFile } from './modPanelPolicy';
import { createNonce } from './webviewHtml';

/** What {@link createModPanels} needs from the rest of the extension. */
export interface ModPanelsDeps {
  /** Tells the mod that the user closed a tab, and hands it what the page sent. */
  relay: {
    message(modId: string, panelId: string, data: ModJson): void;
    closed(modId: string, panelId: string): void;
  };
  /** The log of a mod (the "OpenCode Mods" channel). */
  log(modId: string, level: LogLevel, text: string): void;
}

/** The tab type of a mod's panels: `openVsCode.mod.<id>`. */
export function modPanelViewType(modId: string): string {
  return `openVsCode.mod.${modId}`;
}

/**
 * Creates the {@link ModPanelUi} that `ModHost` drives.
 *
 * `open` creates the tab at once (`ViewColumn.Beside`, `preserveFocus`) and fills it after the
 * files are read; if any file is refused or missing the tab is closed, one `error` line goes to the
 * mod's log and the mod is told `panel.closed` (the tab's dispose). A message from the page that
 * is not JSON of at most 1 MB is dropped, with a `warn` gated to one per second per panel
 * (`createWarnGate`; the message is always dropped, only the line is limited). Panels are keyed by
 * mod id and panel id.
 * VERIFIED in VS Code 1.144.0 on Windows 11 (02/11/2026, `test:visual --steps 39`): "ok   P1 the
 * panel opened Beside the chat, in the editor area to the right of the side bar" (with the active
 * group empty VS Code reuses it: one group, not a split), "ok   P2 a click on the button reaches the
 * mod and its answer comes back: "pong 1 from mod"" (both directions of the relay), "ok   P5 the mod
 * heard onDidClose (its sentinel panel.closed exists)" (a tab closed by the user) and "ok   P6
 * Reload Mods closed the open panel (its tab is gone)" (a panel closed by the host). Also VERIFIED
 * there (03/11/2026, `test:visual --steps 39`): "ok   P8 ten page messages over 1 MB were dropped
 * with 1 warning(s) in the mods log, not ten" (mutation with the gate bypassed: the same check
 * read 10 warnings and failed). The links that leave the folder depend on the VS Code version and
 * are VERIFIED only on 1.146.0 (11/11/2026, Windows 11, two runs of `test:visual --steps 39`): "ok
 * P7 on VS Code 1.146.0 a link inside the mod folder that points outside is refused by the page,
 * like VS Code since 1.146 (microsoft/vscode#346026; documented in docs/mods.md): inside.png
 * loaded, outside/probe.png error" (a junction out of the folder: the page did not get the file).
 * The pre-1.146 behaviour (served to the page) was seen on 1.144.0 on 03/11/2026 and is UNVERIFIED
 * since the check changed. UNVERIFIED on macOS or Linux (test:visual runs only on Windows, CI included), for a
 * missing file and a hidden tab receiving a message: no test makes them happen.
 */
export function createModPanels(deps: ModPanelsDeps): ModPanelUi {
  const open = new Map<string, { panel: vscode.WebviewPanel; byHost: boolean }>();
  const keyOf = (modId: string, panelId: string): string => `${modId}\0${panelId}`;

  const build = async (
    modId: string,
    panelId: string,
    request: ModPanelRequest,
    panel: vscode.WebviewPanel,
  ): Promise<void> => {
    const htmlFile = await resolveModFile(request.dir, request.html);
    const body = await readFile(htmlFile, 'utf8');
    const toUri = async (relative: string): Promise<string> =>
      panel.webview
        .asWebviewUri(vscode.Uri.file(await resolveModFile(request.dir, relative)))
        .toString();
    const scriptUris = await Promise.all(request.scripts.map(toUri));
    const styleUris = await Promise.all(request.styles.map(toUri));
    // The panel may have been closed while the files were read.
    if (!open.has(keyOf(modId, panelId))) return;
    panel.webview.html = buildModPanelHtml({
      cspSource: panel.webview.cspSource,
      nonce: createNonce(),
      title: request.title,
      body,
      scriptUris,
      styleUris,
    });
  };

  return {
    open: (modId, panelId, request) => {
      const key = keyOf(modId, panelId);
      const panel = vscode.window.createWebviewPanel(
        modPanelViewType(modId),
        request.title,
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, localResourceRoots: [vscode.Uri.file(request.dir)] },
      );
      const entry = { panel, byHost: false };
      open.set(key, entry);
      // One gate per panel: at most one warning a second for each of its (at most 3) panels.
      const mayWarn = createWarnGate(PANEL_DROP_WARN_WINDOW_MS);
      panel.webview.onDidReceiveMessage((raw: unknown) => {
        if (!isPanelData(raw)) {
          if (mayWarn()) {
            deps.log(
              modId,
              'warn',
              'dropped a panel message: not JSON, or larger than 1 MB (more drops in the next second are not logged)',
            );
          }
          return;
        }
        deps.relay.message(modId, panelId, raw);
      });
      panel.onDidDispose(() => {
        if (open.get(key) !== entry) return;
        open.delete(key);
        if (!entry.byHost) deps.relay.closed(modId, panelId);
      });
      build(modId, panelId, request, panel).catch((error: unknown) => {
        deps.log(
          modId,
          'error',
          `panel "${request.title}" could not open: ${error instanceof Error ? error.message : String(error)}`,
        );
        panel.dispose();
      });
    },
    message: (modId, panelId, data) => {
      void open.get(keyOf(modId, panelId))?.panel.webview.postMessage(data);
    },
    close: (modId, panelId) => {
      const entry = open.get(keyOf(modId, panelId));
      if (entry === undefined) return;
      entry.byHost = true;
      entry.panel.dispose();
    },
  };
}
