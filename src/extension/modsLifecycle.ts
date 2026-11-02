// The VS Code side of mods (E10-mods, phase 2; plan Engram #1765, decisions #1768). It builds the
// pieces that are pure and tested elsewhere (`ModHost`, `discoverMods`, `createModsSink`) and joins
// them to VS Code: the "OpenCode Mods" output channel, the `openVsCode.mods.enabled` switch, the
// four commands and the native toast.
//
// There are no project mods (decision P4): mods load only from the extension's own folder
// (`globalModsRoot`). Nothing a repository ships is ever executed here. The chat UI of phase 3 is
// fed through `modsChat.ts` (`ModsSink.chat`): band updates (`ModUi.status`) and composes
// (`ModUi.compose`) go to it, and `registerChat` binds the compose to a pane.
//
// Loading never blocks activation: `registerMods` returns at once and `load()` runs behind it. Loads
// are serialized (a reload while one runs waits for it), so two quick setting changes cannot leave
// two generations of Workers.

import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import * as vscode from 'vscode';
import { sanitizeLinkText } from './attentionPolicy';
import {
  CONFIG_SECTION,
  MANAGE_MODS_COMMAND_ID,
  MODS_ENABLED_KEY,
  MODS_ENABLED_SETTING,
  MODS_LOG_CHANNEL_NAME,
  OPEN_MODS_FOLDER_COMMAND_ID,
  RELOAD_MODS_COMMAND_ID,
  RUN_MOD_COMMAND_ID,
  TEST_MODS_STATE_COMMAND_ID,
} from './ids';
import { discoverMods, globalModsRoot, type DiscoveryProblem } from './modDiscovery';
import { createModsSink, type ModsSink } from './modEvents';
import { ModHost, type ModUi } from './modHost';
import { createModPanels } from './modPanels';
import { createModsChat } from './modsChat';

/** What {@link registerMods} gives back. */
export interface ModsRegistration {
  /** The door `ChatController` feeds stream events to. */
  sink: ModsSink;
  /** Stops every mod (graceful `deactivate`, then `terminate`); `deactivate()` awaits it. */
  dispose(): Promise<void>;
}

/**
 * Heartbeat period under `ExtensionMode.Test`: 500 ms instead of 5000, so the integration case of
 * a mod that blocks its event loop sees `failed` in about 2 s, inside Mocha's 20 s. Own choice.
 */
const TEST_HEARTBEAT_MS = 500;

/** One row of the Manage Mods list: a mod, a folder that was refused, or an action. */
interface ManageItem extends vscode.QuickPickItem {
  action?: 'reload' | 'logs' | 'folder';
}

/** Reads the switch; an absent or non-boolean value counts as on (the declared default). */
function readEnabled(): boolean {
  const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<unknown>(MODS_ENABLED_KEY);
  return value !== false;
}

/**
 * Shows the native notification of a mod. Title and text are passed through `sanitizeLinkText`
 * because VS Code builds `title: message` and links `[x](command:…)` in it: a mod must not be able
 * to forge a link (`vscode-extension` skill, section 7). Button labels are not parsed as links and
 * go as they are. Resolves with the pressed label, or `undefined` if the notification is closed.
 * VERIFIED for the sanitizing by `attentionPolicy.test.ts`. VERIFIED in VS Code 1.144.0 on Windows
 * 11 (02/11/2026, the final full `test:visual` run): "ok   M5 the toast text is "<mod>:
 * <message>" with the brackets and parentheses of the mod's message removed and no link in it".
 * Not observed on macOS or Linux, or a click on a toast button.
 */
function showToast(
  name: string,
  toast: { message: string; severity?: 'info' | 'warning' | 'error'; actions?: string[] },
): Promise<string | undefined> {
  const text = `${sanitizeLinkText(name)}: ${sanitizeLinkText(toast.message)}`;
  const actions = toast.actions ?? [];
  const show =
    toast.severity === 'error'
      ? vscode.window.showErrorMessage
      : toast.severity === 'warning'
        ? vscode.window.showWarningMessage
        : vscode.window.showInformationMessage;
  return Promise.resolve(show(text, ...actions));
}

/**
 * Creates the mods host and registers everything that belongs to it.
 *
 * Registers the "OpenCode Mods" channel, the four contributed commands (Manage Mods, Reload Mods,
 * Open Mods Folder, Run Mod Command) and, in `ExtensionMode.Test` only, the uncontributed state
 * command. Starts the first load without awaiting it, and reloads when `openVsCode.mods.enabled`
 * changes (off: stops every mod; on: discovers again). Lifecycle lines (`mod x loaded`,
 * `mod x failed: …`, `mod folder x skipped: …`) go to `channel`, the main log; what a mod logs goes
 * to its own channel prefixed with `[id]`. The returned sink also carries the chat half (bands,
 * commands, run, compose) built by `createModsChat`, which `status` and `compose` of the host feed.
 *
 * The Worker file is `dist/modWorker.js` next to the extension bundle. VERIFIED that a Worker
 * starts, contains a throw and a blocked loop, and runs a command inside the real extension host
 * (plan risk, microsoft/vscode#88386): `npm run test:integration -- --label main` on Windows 11,
 * VS Code 1.144.0, 02/11/2026, checks "✔ loads the good mod and contains the one that throws and
 * the one that hangs", "✔ runs the command of the good mod inside its Worker" and "✔ stops every
 * mod when openVsCode.mods.enabled is turned off". UNVERIFIED on macOS and Linux until the CI.
 */
export function registerMods(
  context: vscode.ExtensionContext,
  channel: vscode.LogOutputChannel,
): ModsRegistration {
  const modsChannel = vscode.window.createOutputChannel(MODS_LOG_CHANNEL_NAME, { log: true });
  context.subscriptions.push(modsChannel);
  const root = globalModsRoot(process.env, os.homedir());
  const isTest = context.extensionMode === vscode.ExtensionMode.Test;
  let problems: DiscoveryProblem[] = [];
  // Declared before the host: the UI callbacks need the host's list to find a mod's name.
  const names = (modId: string): string =>
    host.statuses().find((s) => s.id === modId)?.name ?? modId;

  // `chat` is created after the host (it reads it) but the UI callbacks only run later, so they may
  // refer to it.
  const ui: ModUi = {
    status: (modId, line) => {
      chat.setLine(modId, line);
    },
    toast: (modId, toast) => showToast(names(modId), toast),
    compose: (modId, request) => {
      chat.compose(modId, request);
    },
  };
  const host: ModHost = new ModHost({
    workerFile: vscode.Uri.joinPath(context.extensionUri, 'dist', 'modWorker.js').fsPath,
    ui,
    panels: createModPanels({
      relay: {
        message: (modId, panelId, data) => {
          host.panelMessage(modId, panelId, data);
        },
        closed: (modId, panelId) => {
          host.panelClosed(modId, panelId);
        },
      },
      log: (modId, level, text) => {
        modsChannel[level](`[${modId}] ${text}`);
      },
    }),
    logLifecycle: (text) => {
      channel.info(text);
    },
    logMod: (modId, level, text) => {
      modsChannel[level](`[${modId}] ${text}`);
    },
    ...(isTest ? { heartbeatMs: TEST_HEARTBEAT_MS } : {}),
  });
  const chat = createModsChat(host, (modId) => {
    modsChannel.warn(`[${modId}] chat.compose dropped: the chat is not available`);
  });

  /** Discovers and starts the mods, or stops them all when the switch is off. */
  const loadNow = async (): Promise<void> => {
    try {
      if (!readEnabled()) {
        problems = [];
        await host.reload([]);
        channel.info('mods are turned off (openVsCode.mods.enabled)');
        return;
      }
      const found = await discoverMods(root);
      problems = found.problems;
      for (const problem of found.problems) {
        channel.warn(`mod folder ${problem.folder} skipped: ${problem.reason}`);
      }
      await host.reload(found.mods);
    } catch (error) {
      channel.error(
        `could not load mods: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  let chain: Promise<void> = Promise.resolve();
  const load = (): Promise<void> => (chain = chain.then(loadNow));

  const manage = async (): Promise<void> => {
    const items: ManageItem[] = host.statuses().map((status) => {
      const item: ManageItem = {
        label: `${status.state === 'active' ? '$(check)' : status.state === 'failed' ? '$(error)' : '$(circle-outline)'} ${status.name}`,
        description: `${status.id} ${status.version} · ${status.state}`,
      };
      if (status.error !== undefined) item.detail = status.error;
      return item;
    });
    for (const problem of problems) {
      items.push({
        label: `$(warning) ${problem.folder}`,
        description: 'skipped',
        detail: problem.reason,
      });
    }
    if (items.length === 0) items.push({ label: 'No mods found', description: root });
    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(refresh) Reload Mods', action: 'reload' },
      { label: '$(folder-opened) Open Mods Folder', action: 'folder' },
      { label: '$(output) Show Logs', action: 'logs' },
    );
    const picked = await vscode.window.showQuickPick(items, { title: 'OpenCode Mods' });
    if (picked?.action === 'reload') await vscode.commands.executeCommand(RELOAD_MODS_COMMAND_ID);
    else if (picked?.action === 'folder') {
      await vscode.commands.executeCommand(OPEN_MODS_FOLDER_COMMAND_ID);
    } else if (picked?.action === 'logs') modsChannel.show();
  };

  const run = async (arg: unknown): Promise<void> => {
    let target: { modId: string; name: string; args: string } | undefined;
    if (typeof arg === 'object' && arg !== null) {
      const { modId, name, args } = arg as Record<string, unknown>;
      if (typeof modId === 'string' && typeof name === 'string') {
        target = { modId, name, args: typeof args === 'string' ? args : '' };
      }
    }
    if (target === undefined) {
      const commands = host.commands();
      if (commands.length === 0) {
        void vscode.window.showInformationMessage(
          'No mod has registered a command. Mods live in the folder that "OpenCode: Open Mods Folder" opens.',
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(
        commands.map((c) => ({
          label: `${c.modId}:${c.name}`,
          ...(c.description !== undefined ? { description: c.description } : {}),
          modId: c.modId,
          name: c.name,
        })),
        { title: 'Run Mod Command' },
      );
      if (picked === undefined) return;
      target = { modId: picked.modId, name: picked.name, args: '' };
    }
    try {
      await host.runCommand(target.modId, target.name, target.args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(sanitizeLinkText(`Mod command failed: ${message}`));
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(MANAGE_MODS_COMMAND_ID, manage),
    vscode.commands.registerCommand(RELOAD_MODS_COMMAND_ID, load),
    vscode.commands.registerCommand(OPEN_MODS_FOLDER_COMMAND_ID, async () => {
      await mkdir(root, { recursive: true });
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(root));
    }),
    vscode.commands.registerCommand(RUN_MOD_COMMAND_ID, run),
    vscode.workspace.onDidChangeConfiguration((change) => {
      if (change.affectsConfiguration(MODS_ENABLED_SETTING)) void load();
    }),
  );
  if (isTest) {
    context.subscriptions.push(
      vscode.commands.registerCommand(TEST_MODS_STATE_COMMAND_ID, () => ({
        root,
        mods: host.statuses(),
        commands: host.commands(),
        problems,
      })),
    );
  }
  void load();
  return {
    sink: createModsSink((event) => {
      host.dispatch(event);
    }, chat),
    // `host.dispose` sets the host's `disposed` flag first, so a load still in flight (it awaits
    // discovery or the grace of `reload`) cannot start Workers afterwards: no chain needed.
    dispose: () => host.dispose(),
  };
}
