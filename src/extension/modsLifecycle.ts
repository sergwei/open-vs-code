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
// two generations of Workers. The loop and the "disposed" flag live in `modsLoader.ts`; this file
// routes every write to the two channels through that flag, because VS Code releases a channel on
// deactivate and a released channel throws.
//
// E10-mod-toggles (issue #181): each mod has its own on/off switch, per workspace, on top of the
// machine-wide `openVsCode.mods.enabled`; see `modToggles.ts` and `modsLoader.ts`.

import * as l10n from '@vscode/l10n';
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
  TEST_MOD_TOGGLE_COMMAND_ID,
  TEST_MODS_STATE_COMMAND_ID,
} from './ids';
import { globalModsRoot, discoverMods } from './modDiscovery';
import { createModsSink, type ModsSink } from './modEvents';
import { ModHost, type ModState, type ModUi } from './modHost';
import { createModPanels } from './modPanels';
import { createModsChat } from './modsChat';
import { createModsLoader } from './modsLoader';
import { createDisabledStore } from './modToggles';
import type { LogLevel } from '../mods/wire';

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
 * The word the Manage Mods list shows for the state of a mod, in the language of the host. One
 * `l10n.t` per state (with a comment: each is a single lowercase word that a translator could not
 * place without it).
 */
function modStateLabel(state: ModState): string {
  // The comment of each call is a LITERAL array: the exporter (`l10n-dev`) skips, without a
  // word, a call whose `comment` is a variable, and the text would then never reach the catalog.
  switch (state) {
    case 'starting':
      return l10n.t({
        message: 'starting',
        comment: ['State of a mod, shown after its version in the Manage Mods list'],
      });
    case 'active':
      return l10n.t({
        message: 'active',
        comment: ['State of a mod, shown after its version in the Manage Mods list'],
      });
    case 'failed':
      return l10n.t({
        message: 'failed',
        comment: ['State of a mod, shown after its version in the Manage Mods list'],
      });
    case 'stopped':
      return l10n.t({
        message: 'stopped',
        comment: ['State of a mod, shown after its version in the Manage Mods list'],
      });
  }
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
 * changes (off: discovers, lists and stops every mod; on: discovers again and starts those not
 * switched off in this workspace). Lifecycle lines (`mod x loaded`,
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
 * The returned `dispose` also silences both channels (see `modsLoader.ts`): UNVERIFIED in a real
 * extension host that a log arriving after `deactivate` would have thrown and that it no longer
 * does, because an integration suite cannot deactivate the extension in the middle of a run; the
 * guard logic is covered with a fabricated host by `modsLoader.test.ts`. Look at the extension
 * host log for "Channel has been closed" if a mod's `deactivate()` errors ever go missing.
 * The texts of the Manage Mods list, the "no command" notice and the failure of Run Mod Command
 * go through `l10n.t` when they are shown; the channel names, the log lines and whatever a mod
 * writes (names, descriptions, messages) are not translated.
 *
 * Per-mod switch (E10-mod-toggles, issue #181): the list of switched-off ids is kept in
 * `context.workspaceState` (`modToggles.ts`), or in memory when the window has no folder and no
 * workspace file (decision #1997; then Manage Mods says "off in this window"). Manage Mods is
 * built from the loader's inventory (every mod found, switched off ones included), not from the
 * host's statuses, so it never says "No mods found" with every mod off. In `ExtensionMode.Test`
 * the uncontributed command `openVsCode.test.modToggle(modId, enabled)` calls the same
 * `chat.toggle` as the popover (an unknown id rejects and writes nothing) and the state command
 * also returns `listing`. VERIFIED by `npm run test:integration -- --label main` (Windows 11, VS
 * Code 1.145.2, 07/11/2026, 52 passing), the cases of `mods.test.ts` that start with "turning one
 * mod off", "Reload Mods and turning" and "an unknown id is refused" all passed. VERIFIED for the
 * memento across a window reload (integration keeps workspace storage in memory) on Windows 11,
 * VS Code 1.145.2 (07/11/2026) by `test:visual` step 45 with the real Reload Window: "after Reload
 * Window hello-station is still off (switch false, no band, no new "loaded" line) and quiet started
 * again". Not observed: the no-folder window with its in-memory list (Vitest only,
 * `modToggles.test.ts`), and macOS and Linux (CI only).
 */
export function registerMods(
  context: vscode.ExtensionContext,
  channel: vscode.LogOutputChannel,
): ModsRegistration {
  const modsChannel = vscode.window.createOutputChannel(MODS_LOG_CHANNEL_NAME, { log: true });
  context.subscriptions.push(modsChannel);
  const root = globalModsRoot(process.env, os.homedir());
  const isTest = context.extensionMode === vscode.ExtensionMode.Test;
  // Every write to `modsChannel` and to `channel` goes through `loader.guard`: VS Code releases the
  // first one with `context.subscriptions` while the Workers are still in their grace, and a
  // released channel throws. The guards are read by closure, after the host and the loader exist,
  // like `chat`.
  const writeMods = (modId: string, level: LogLevel, text: string): void => {
    modsChannel[level](`[${modId}] ${text}`);
  };
  const writeMain = (text: string): void => {
    channel.info(text);
  };
  const writeComposeDropped = (modId: string): void => {
    modsChannel.warn(`[${modId}] chat.compose dropped: the chat is not available`);
  };
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
        logMod(modId, level, text);
      },
    }),
    logLifecycle: (text) => {
      logLifecycle(text);
    },
    logMod: (modId, level, text) => {
      logMod(modId, level, text);
    },
    ...(isTest ? { heartbeatMs: TEST_HEARTBEAT_MS } : {}),
  });
  // The per-workspace list of switched-off mods lives in `workspaceState`, which VS Code keeps in
  // the user profile and never in the opened folder (so a repository cannot write it). In a window
  // with no folder and no workspace file the memento belongs to a window id that is random per
  // window, so there the list is kept in memory and the UI says it lasts until the window closes
  // (decision #1997).
  const store = createDisabledStore(
    vscode.workspace.workspaceFolders === undefined && vscode.workspace.workspaceFile === undefined
      ? undefined
      : context.workspaceState,
  );
  const loader = createModsLoader({
    readEnabled,
    discover: () => discoverMods(root),
    host,
    readDisabled: () => store.read(),
    writeDisabled: (list) => store.write(list),
    persisted: store.persisted,
    log: (level, text) => {
      channel[level](text);
    },
  });
  // The loader exists before `chat` because `createModsChat` subscribes to it at once.
  const chat = createModsChat(
    {
      statuses: () => host.statuses(),
      commands: () => host.commands(),
      onDidChange: (listener) => host.onDidChange(listener),
      runCommand: (modId, name, args, sessionID) => host.runCommand(modId, name, args, sessionID),
      inventory: () => loader.inventory(),
      onDidChangeInventory: (listener) => loader.onDidChange(listener),
      toggle: (modId, enabled) => loader.toggle(modId, enabled),
      action: async (kind) => {
        if (kind === 'openFolder') {
          await vscode.commands.executeCommand(OPEN_MODS_FOLDER_COMMAND_ID);
        } else {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            MODS_ENABLED_SETTING,
          );
        }
      },
    },
    (modId) => {
      logComposeDropped(modId);
    },
  );
  const logMod = loader.guard(writeMods);
  const logLifecycle = loader.guard(writeMain);
  const logComposeDropped = loader.guard(writeComposeDropped);
  const load = loader.load;

  const manage = async (): Promise<void> => {
    // Built from the inventory (every mod found), not from the host's statuses: a mod that is
    // switched off has no Worker, and with them all off the list must not say "No mods found".
    const inventory = loader.inventory();
    const off = new Set(inventory.disabled);
    const statusOf = new Map(host.statuses().map((status) => [status.id, status]));
    const items: ManageItem[] = inventory.mods.map((mod) => {
      if (off.has(mod.id)) {
        return {
          label: `$(circle-slash) ${mod.name}`,
          description: `${mod.id} ${mod.version} · ${
            inventory.persisted ? l10n.t('off in this workspace') : l10n.t('off in this window')
          }`,
        };
      }
      const status = statusOf.get(mod.id);
      const state: ModState = status?.state ?? 'stopped';
      const item: ManageItem = {
        label: `${state === 'active' ? '$(check)' : state === 'failed' ? '$(error)' : '$(circle-outline)'} ${mod.name}`,
        description: `${mod.id} ${mod.version} · ${modStateLabel(state)}`,
      };
      if (status?.error !== undefined) item.detail = status.error;
      return item;
    });
    for (const problem of loader.problems()) {
      items.push({
        label: `$(warning) ${problem.folder}`,
        description: l10n.t({
          message: 'skipped',
          comment: ['Description of a mod folder that was not loaded, in the Manage Mods list'],
        }),
        detail: problem.reason,
      });
    }
    if (items.length === 0) items.push({ label: l10n.t('No mods found'), description: root });
    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: `$(refresh) ${l10n.t('Reload Mods')}`, action: 'reload' },
      { label: `$(folder-opened) ${l10n.t('Open Mods Folder')}`, action: 'folder' },
      { label: `$(output) ${l10n.t('Show Logs')}`, action: 'logs' },
    );
    const picked = await vscode.window.showQuickPick(items, { title: l10n.t('OpenCode Mods') });
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
          l10n.t(
            'No mod has registered a command. Mods live in the folder that "OpenCode: Open Mods Folder" opens.',
          ),
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
        { title: l10n.t('Run Mod Command') },
      );
      if (picked === undefined) return;
      target = { modId: picked.modId, name: picked.name, args: '' };
    }
    try {
      await host.runCommand(target.modId, target.name, target.args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        sanitizeLinkText(l10n.t('Mod command failed: {0}', message)),
      );
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
        problems: loader.problems(),
        listing: chat.state().listing,
      })),
      // Same path as the popover's switch; a bad argument or an unknown id rejects, writing nothing.
      vscode.commands.registerCommand(
        TEST_MOD_TOGGLE_COMMAND_ID,
        (modId: unknown, enabled: unknown) => {
          if (typeof modId !== 'string' || typeof enabled !== 'boolean') {
            return Promise.reject(new TypeError('expected (modId: string, enabled: boolean)'));
          }
          return chat.toggle(modId, enabled);
        },
      ),
    );
  }
  void load();
  return {
    sink: createModsSink((event) => {
      host.dispatch(event);
    }, chat),
    // `loader.dispose` raises the loader's flag, then calls `host.dispose`, which raises the host's
    // own: a load still in flight (it awaits discovery or the grace of `reload`) neither starts
    // Workers nor writes a line afterwards, and neither does a Worker that logs during its grace.
    dispose: () => loader.dispose(),
  };
}
