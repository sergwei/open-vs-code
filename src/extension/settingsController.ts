// The brain of the OpenCode Settings tab (issue #128, E10): joins what the host knows about the
// server's configuration (`ServerConfig`) and the sign-in flows (`ProviderAuth`) with the webview.
// Pure host code, no `vscode`: the panel (`settingsPanel.ts`) feeds it the webview's
// messages and gives it a `post`.
//
// The webview is UNTRUSTED input (plan section 3). Every request is validated by
// `isSettingsWebviewToHost` and then REVALIDATED against the snapshot the host holds: the
// integration must exist, the method index must exist, the `answer` keeps only the keys of that
// method's form (with the bounds of the protocol), and a credential is removed only if it is one of
// that integration's connections and always after a native confirmation. Nothing here carries or
// logs a key: the key is asked by `ProviderAuth` in a native InputBox.

import * as l10n from '@vscode/l10n';
import type { AuthResult, ProviderAuth } from './providerAuth';
import type {
  IntegrationRow,
  McpServerRow,
  ServerConfig,
  ServerConfigSnapshot,
} from './serverConfig';
import type { ServerLog } from './opencodeServer';
import type { ModsChat } from './modEvents';
import {
  CLEAR_SERVER_PASSWORD_COMMAND_ID,
  FORGET_PLUGIN_DECISION_COMMAND_ID,
  MANAGE_PERMISSIONS_COMMAND_ID,
  OPEN_CHAT_COMMAND_ID,
  OPEN_MODS_FOLDER_COMMAND_ID,
  OPEN_SETTINGS_COMMAND_ID,
  RELOAD_MODS_COMMAND_ID,
  RESTART_SERVER_COMMAND_ID,
  SET_SERVER_PASSWORD_COMMAND_ID,
  SHOW_LOGS_COMMAND_ID,
} from './ids';
import type { ConnectionState } from '../shared/protocol';
import {
  MAX_SETTINGS_ANSWERS,
  MAX_SETTINGS_VALUE,
  isSettingsWebviewToHost,
  type ProviderRow,
  type SettingsAction,
  type SettingsGeneral,
  type SettingsHostToWebview,
  type SettingsMcpOp,
  type SettingsMcpServerRow,
  type SettingsNotice,
  type SettingsPreference,
  type SettingsSettingKey,
  type SettingsState,
  type SettingsWebviewToHost,
  type SettingsWritableKey,
} from '../shared/settingsProtocol';
import { isAvailable, parseModelSetting } from './modelPreference';

/**
 * The command each {@link SettingsAction} runs. A PURE constant (`ids.ts` has no `vscode`) so that
 * `settingsController.test.ts` can check that every action points at a command contributed in
 * `package.json`; `chatLifecycle.ts` only does `executeCommand(SETTINGS_ACTION_COMMANDS[action])`.
 * There is no `toggleWorkMode` entry on purpose (decision P2 of E10-settings-sections).
 */
export const SETTINGS_ACTION_COMMANDS: Record<SettingsAction, string> = {
  logs: SHOW_LOGS_COMMAND_ID,
  extensionSettings: OPEN_SETTINGS_COMMAND_ID,
  restart: RESTART_SERVER_COMMAND_ID,
  reloadMods: RELOAD_MODS_COMMAND_ID,
  openModsFolder: OPEN_MODS_FOLDER_COMMAND_ID,
  setServerPassword: SET_SERVER_PASSWORD_COMMAND_ID,
  clearServerPassword: CLEAR_SERVER_PASSWORD_COMMAND_ID,
  managePermissions: MANAGE_PERMISSIONS_COMMAND_ID,
  forgetPluginDecision: FORGET_PLUGIN_DECISION_COMMAND_ID,
  openChat: OPEN_CHAT_COMMAND_ID,
};

/** The slice of {@link ModsChat} the controller uses: the listing, the per-mod switch and its changes. */
export type SettingsMods = Pick<ModsChat, 'state' | 'toggle' | 'onDidChange'>;

/**
 * The two General settings as `chatLifecycle.ts` reads and writes them. Like
 * {@link SettingsPreferences}: the controller never touches `vscode`.
 */
export interface SettingsGeneralSource {
  /** The effective values and whether the workspace or the folder overrides each one. */
  read(): SettingsGeneral;
  /** Writes the USER (global) value of one of the two settings. */
  write(key: SettingsWritableKey, value: string | boolean): Promise<void>;
}

/** The slice of {@link ServerConfig} the controller reads. */
export type SettingsConfigSource = Pick<
  ServerConfig,
  'snapshot' | 'onDidChange' | 'reloadAll' | 'mcpAction' | 'shellAction'
>;
/** The slice of {@link ProviderAuth} the controller drives. */
export type SettingsAuth = Pick<
  ProviderAuth,
  'connect' | 'cancel' | 'copyCode' | 'disconnect' | 'attempt' | 'onDidChangeAttempt'
>;

/** What the header of the tab needs that neither the store nor the flows know. */
export interface SettingsHeader {
  connection: ConnectionState;
  /** Basename of the served folder. */
  folder: string;
  serverVersion?: string;
  /** `vscode.env.remoteName` (`ssh-remote`, `wsl`...); absent in a local window. */
  remote?: string;
}

/**
 * The `openVsCode.defaultModel` setting, as `chatLifecycle.ts` reads and writes it. The controller
 * never touches `vscode`: it only asks.
 */
export interface SettingsPreferences {
  /**
   * The effective text of the setting (`''` when unset) and whether the workspace or the folder
   * has a value of its own, which hides the user's one.
   */
  read(): { value: string; workspaceOverride: boolean };
  /** Writes the USER (global) value; `undefined` removes it. */
  write(value: string | undefined): Promise<void>;
}

/** Everything the controller is given. */
export interface SettingsControllerDeps {
  config: SettingsConfigSource;
  auth: SettingsAuth;
  preferences: SettingsPreferences;
  /** `openVsCode.chatLocation` and `openVsCode.autoStart` (PR3 of issue #186). */
  general: SettingsGeneralSource;
  /** The mods half; absent when the host has none (the state then carries no `mods`). */
  mods?: SettingsMods;
  /** Sends one message to the webview (the panel drops it if the webview is not ready). */
  post(message: SettingsHostToWebview): void;
  header(): SettingsHeader;
  /** Runs one of the closed {@link SettingsAction}s with its existing command. */
  runAction(action: SettingsAction): void;
  /** Opens one setting of this extension in the native Settings editor. */
  openSetting(key: SettingsSettingKey): void;
  log: ServerLog;
}

/**
 * Builds `settings.state` and `settings.notice` and answers the webview's requests.
 *
 * Coalescing: the store, the sign-in attempt and the header can change many times in a tick; the
 * controller marks itself dirty and posts ONE `settings.state` on the next microtask. `ready` posts
 * at once, as the host answers every `ready` with a full state (`vscode-extension` section 4).
 *
 * VERIFIED by `settingsController.test.ts` with fake store and flows (fabricated data: it proves
 * the validation and the coalescing, not a real panel) and, in a real VS Code 1.144.0 on Windows
 * 11 (1/11/2026), by the `fake-server` cases "removes a credential only after a yes, and refuses
 * one of another provider" and "connects a provider with an API key and never writes the key to
 * the log or the state"; those feed the messages through `test.settingsMessage`, which runs the
 * same guard, NOT through a real DOM `postMessage`. VERIFIED with the payloads a real webview posts
 * (Windows 11, VS Code 1.144.0, 1/11/2026, `npm run test:visual -- --group config`, synthetic
 * server; the texts changed with the redesign of issue #186 and the same cells passed again on
 * 7/11/2026, VS Code 1.145.2, `--steps 36`): "ok   V7 pressing Enter connects Azure: it moves to
 * Connected as a row with "API key" and a Disconnect button (lines ["API key · 0 models"]), and the
 * live region says "Connected to Azure."", "ok   V9 confirming the modal removes the credential:
 * Azure is back in Add a provider with no Disconnect button …" and "ok   V8 Cancel in the
 * notification ends the attempt …". Since issue #186 it also builds the models and the
 * `openVsCode.defaultModel` preference into the state, writes that setting on
 * `settings.setDefaultModel` (after revalidating it against the catalog) and opens a setting of the
 * closed list on `settings.openSetting`. The first two are VERIFIED by the `fake-server` case "sets
 * the default model from the Settings tab and the chat proposes it" (7/11/2026, Windows 11, VS Code
 * 1.145.2) and by `test:visual` step 47 ("ok   M1 the Models section offers None and the models of
 * the fixture in 1 group(s) …" for the state, "ok   M1 choosing a model writes openVsCode.defaultModel
 * in the user settings and the select follows the state …" for the write). `settings.openSetting` is
 * UNVERIFIED in a real host: no test presses a button that sends it; `settingsController.test.ts`
 * covers the three with fabricated stores and a fake `preferences`. PR3 of issue #186 adds
 * `settings.setSetting` (the two General settings, USER scope), `settings.modToggle` (through the
 * mods half) and the ten closed `settings.action`s ({@link SETTINGS_ACTION_COMMANDS}); it also asks
 * for a state when the mods listing changes. VERIFIED in a real host (Windows 11, VS Code 1.145.3,
 * 10/11/2026) by the `main` integration cases "the Settings tab writes chatLocation and autoStart to
 * the USER settings, refuses other values and restores" and "switches a mod off and on from the
 * Settings tab: settings.state follows and only that Worker stops" (55 passing, 1 pending), and by
 * `test:visual` step 53 ("ok   B1 the switch of quiet turns it off: aria-checked false, the host
 * logged "mod quiet switched off in this workspace" and the badge of Mods is gone (null)" and "ok
 * B2 the switch of the automatic start writes openVsCode.autoStart false in the user settings
 * (false) and the switch follows the state (aria-checked false: true)"; the full run had one FAIL,
 * in step 25, unrelated). UNVERIFIED, with no date: the
 * controller after the tab is hidden and shown (no `test:visual` cell does it). The `--steps 36`
 * texts above come from a run of 7/11/2026 on an EARLIER tree (the search box, the CSS and the
 * review fixes came after it, among them the `modelRefused` notice and the fresh state after a
 * refused default model); the final full `test:visual` of the branch is what covers this tree, and
 * no run of it is claimed here.
 */
export class SettingsController {
  private ready = false;
  private dirty = false;
  /** MCP servers with a connect, disconnect or sign-in still running: a second one is refused. */
  private readonly mcpBusy = new Set<string>();
  private readonly unsubscribe: (() => void)[];

  constructor(private readonly deps: SettingsControllerDeps) {
    this.unsubscribe = [
      deps.config.onDidChange(() => this.changed()),
      deps.auth.onDidChangeAttempt(() => this.changed()),
    ];
    if (deps.mods !== undefined) {
      const subscription = deps.mods.onDidChange(() => this.changed());
      this.unsubscribe.push(() => {
        subscription.dispose();
      });
    }
  }

  /** Stops listening to the store and the flows. */
  dispose(): void {
    for (const stop of this.unsubscribe) stop();
    this.unsubscribe.length = 0;
  }

  /** Asks for a fresh `settings.state` (the header changed: server state, folder, version). */
  changed(): void {
    if (!this.ready || this.dirty) return;
    this.dirty = true;
    queueMicrotask(() => {
      this.dirty = false;
      if (this.ready) this.postState();
    });
  }

  /** The webview is up (a new document): answer with the whole state, now. */
  onReady(): void {
    this.ready = true;
    this.postState();
  }

  /** The webview went away: nothing is posted until its next `ready`. */
  onClosed(): void {
    this.ready = false;
  }

  /**
   * The `settings.state` of this moment, from the store, the header, the attempt and the
   * `openVsCode.defaultModel` setting. Integrations that the server marks `source: 'mcp'` are left
   * out of `providers` (they are signed in from the MCP section). Each provider gets a
   * `modelCount` once the models were read: the models whose provider belongs to that integration
   * (`ProviderInfo.integrationID`, or the provider id when the server names none: HYPOTHESIS that
   * the ids match then, unchecked against a real server with a second provider). The preference
   * `status` is judged against the model rows held now, so it is only meaningful once
   * `models.loaded`. Each MCP server gets its `canSignIn` and `integrationID` from {@link mcpRow}
   * (the second only when it names an `mcp` integration row), and keeps its `detail`. Since PR3 it
   * also carries `general` (the two settings, read now, with their workspace-override flag) and,
   * only when a mods half was given, `mods` (its `state().listing` as it is: plain texts of
   * `mod.json` or the Worker). Since issue #205 it carries `shell`, copied field by field from the
   * snapshot (`loaded`, `failed`, `writing`, `current`, `overridden` and the options as
   * `{value, name, terminalOnly}`), so nothing else of the store can ride along.
   * VERIFIED by "builds the shell of opencode field by field" of `settingsController.test.ts`
   * (fabricated snapshot with an extra field, vitest, Windows 11, 11/11/2026).
   */
  buildState(): SettingsState {
    const snapshot = this.deps.config.snapshot();
    const header = this.deps.header();
    const attempt = this.deps.auth.attempt();
    const models = snapshot.models;
    const rows: ProviderRow[] = snapshot.integrations.rows
      .filter((row) => row.source !== 'mcp')
      .map((row) => ({
        id: row.id,
        name: row.name,
        connections: row.connections,
        methods: row.methods,
        ...(models.loaded
          ? {
              modelCount: models.rows.filter(
                (model) => (model.integrationID ?? model.providerID) === row.id,
              ).length,
            }
          : {}),
      }));
    return {
      connection: header.connection,
      folder: header.folder,
      ...(header.serverVersion === undefined ? {} : { serverVersion: header.serverVersion }),
      ...(header.remote === undefined ? {} : { remote: header.remote }),
      providers: {
        loaded: snapshot.integrations.loaded,
        failed: snapshot.integrations.failed,
        rows,
      },
      models: {
        loaded: models.loaded,
        failed: models.failed,
        rows: models.rows.map((model) => ({
          providerID: model.providerID,
          id: model.id,
          name: model.name,
          providerName: model.providerName,
        })),
        ...(models.serverDefault === undefined ? {} : { serverDefault: models.serverDefault }),
      },
      preference: this.preference(),
      general: this.deps.general.read(),
      ...(this.deps.mods === undefined ? {} : { mods: this.deps.mods.state().listing }),
      shell: {
        loaded: snapshot.shell.loaded,
        failed: snapshot.shell.failed,
        writing: snapshot.shell.writing,
        current: snapshot.shell.current,
        overridden: snapshot.shell.overridden,
        options: snapshot.shell.options.map((option) => ({
          value: option.value,
          name: option.name,
          terminalOnly: option.terminalOnly,
        })),
      },
      mcp: {
        loaded: snapshot.mcp.loaded,
        failed: snapshot.mcp.failed,
        pendingFirstRead: snapshot.mcp.pendingFirstRead,
        servers: snapshot.mcp.servers.map((server) => this.mcpRow(server, snapshot)),
      },
      ...(attempt === undefined ? {} : { attempt }),
    };
  }

  /**
   * Handles one raw message from the webview. A message that does not pass the protocol guard is
   * dropped with one log line (type only); a valid one is revalidated against the snapshot by its
   * handler. Never throws.
   */
  async onMessage(raw: unknown): Promise<void> {
    if (!isSettingsWebviewToHost(raw)) {
      this.deps.log.warn('settings message dropped: invalid');
      return;
    }
    try {
      await this.dispatch(raw);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown';
      this.deps.log.warn(`settings request failed: ${raw.type}: ${name}`);
    }
  }

  /**
   * One MCP server as the webview gets it. The server's `integrationID` is passed on (and
   * `canSignIn` can be true) only when it matches an integration row marked `source: 'mcp'`: an id
   * the integration list does not know would let the tab show a sign-in that cannot run. `canSignIn`
   * also needs the status `needs_auth` and an OAuth method the tab can run (`supported`).
   * VERIFIED by "marks canSignIn and integrationID only with an mcp integration row and an oauth
   * method" of `settingsController.test.ts` (fabricated snapshot, vitest, Windows 11).
   */
  private mcpRow(server: McpServerRow, snapshot: ServerConfigSnapshot): SettingsMcpServerRow {
    const integration = this.mcpIntegration(server, snapshot);
    return {
      name: server.name,
      status: server.status,
      ...(server.error === undefined ? {} : { error: server.error }),
      ...(server.detail === undefined ? {} : { detail: server.detail }),
      ...(integration === undefined ? {} : { integrationID: integration.id }),
      canSignIn:
        server.status === 'needs_auth' &&
        integration !== undefined &&
        integration.methods.some((method) => method.type === 'oauth' && method.supported),
      resources: server.resources,
      templates: server.templates,
    };
  }

  /** The `source: 'mcp'` integration row the server's `integrationID` names, if any. */
  private mcpIntegration(
    server: McpServerRow,
    snapshot: ServerConfigSnapshot,
  ): IntegrationRow | undefined {
    if (server.integrationID === undefined) return undefined;
    return snapshot.integrations.rows.find(
      (row) => row.id === server.integrationID && row.source === 'mcp',
    );
  }

  /** The setting, read now, with its status against the model rows the store holds now. */
  private preference(): SettingsPreference {
    const { value, workspaceOverride } = this.deps.preferences.read();
    const parsed = parseModelSetting(value);
    let status: SettingsPreference['status'];
    if (parsed.kind === 'none') status = 'none';
    else if (parsed.kind === 'invalid') status = 'invalid';
    else {
      status = isAvailable(parsed.model, this.deps.config.snapshot().models.rows)
        ? 'applied'
        : 'unavailable';
    }
    return { value, status, workspaceOverride };
  }

  private postState(): void {
    this.deps.post({ type: 'settings.state', state: this.buildState() });
  }

  private notice(notice: SettingsNotice): void {
    this.deps.post({ type: 'settings.notice', notice });
  }

  /** Routes one valid message. */
  private async dispatch(message: SettingsWebviewToHost): Promise<void> {
    switch (message.type) {
      case 'settings.ready':
        this.onReady();
        return;
      case 'settings.refresh':
        await this.deps.config.reloadAll();
        return;
      case 'settings.action':
        this.deps.runAction(message.action);
        return;
      case 'settings.openSetting':
        this.deps.openSetting(message.key);
        return;
      case 'settings.setDefaultModel':
        await this.setDefaultModel(message.model);
        return;
      case 'settings.connect':
        await this.connect(message.integrationID, message.method, message.answer);
        return;
      case 'settings.cancel':
        if (this.deps.auth.attempt()?.integrationID === message.integrationID) {
          await this.deps.auth.cancel();
        }
        return;
      case 'settings.copyCode':
        await this.deps.auth.copyCode(message.integrationID);
        return;
      case 'settings.disconnect':
        await this.disconnect(message.integrationID, message.credentialID);
        return;
      case 'settings.mcp':
        await this.mcpChange(message.server, message.op);
        return;
      case 'settings.mcpSignIn':
        await this.mcpSignIn(message.server);
        return;
      case 'settings.setSetting':
        await this.setSetting(message.key, message.value);
        return;
      case 'settings.modToggle':
        await this.modToggle(message.modId, message.enabled);
        return;
      case 'settings.setShell':
        await this.setShell(message.shell);
        return;
    }
  }

  /**
   * Revalidates a shell request of the Advanced row and writes it to the GLOBAL opencode config
   * through {@link ServerConfig.shellAction}. The shell must be `''` (Automatic) or the `value` of
   * one of the options the snapshot holds (the server itself accepts any name, so this allow-list
   * is the only one); a request before the first read (`!loaded`) or while a write runs
   * (`writing`) is refused. A refusal writes one `settings request refused` line with a fixed
   * reason (never the text asked for) and posts a `shellFailed` notice with a fixed message, and a
   * fresh state, so the select goes back to the saved value. A shell equal to `current` sends
   * nothing (a patch that changes nothing publishes no `config.updated`, so the write would wait
   * for the settle timer for nothing) and only asks for a state. A failed write posts the
   * scrubbed message of the error. EVERY exit asks for a state: no optimistic value is posted.
   * VERIFIED by the checks of "SettingsController shell requests" in `settingsController.test.ts`
   * (fabricated snapshot and fake `shellAction`, vitest, Windows 11, 11/11/2026): accepts `''` and
   * an offered value, refuses an unoffered one, one before the read and one while writing, sends
   * nothing for the current value, and words a failed write.
   */
  private async setShell(shell: string): Promise<void> {
    const state = this.deps.config.snapshot().shell;
    if (!state.loaded || state.writing) {
      this.refused('settings.setShell', state.writing ? 'another write in progress' : 'not read');
      this.refuseShell(l10n.t('The shell cannot be changed right now.'));
      return;
    }
    if (shell !== '' && !state.options.some((option) => option.value === shell)) {
      this.refused('settings.setShell', 'not offered');
      this.refuseShell(l10n.t('Unknown shell'));
      return;
    }
    if (shell === state.current) {
      this.changed();
      return;
    }
    const result = await this.deps.config.shellAction(shell);
    if (result.kind === 'failed') {
      this.refuseShell(result.message);
      return;
    }
    this.changed();
  }

  /** Posts a `shellFailed` notice and then the current state, so the select returns to the saved shell. */
  private refuseShell(message: string): void {
    this.notice({ integrationID: '', kind: 'shellFailed', message });
    this.changed();
  }

  /**
   * Writes the USER value of `chatLocation` or `autoStart` once and asks for a fresh state on EVERY
   * exit, so the control never keeps a value the setting does not hold (no optimistic state). The
   * value was already checked by the protocol guard (the pair is exact). A write that throws logs one
   * line with the error name only (never the value) and posts a `settingFailed` notice.
   * VERIFIED by "writes the user setting once and asks for a fresh state" and "tells the webview
   * when the write throws, without the value" of `settingsController.test.ts` (fabricated
   * `general`, vitest). VERIFIED in a real host (Windows 11, VS Code 1.145.3, 10/11/2026) by the
   * `main` integration case "the Settings tab writes chatLocation and autoStart to the USER
   * settings, refuses other values and restores" (passing). NOT observed: a real write failure.
   */
  private async setSetting(key: SettingsWritableKey, value: string | boolean): Promise<void> {
    try {
      await this.deps.general.write(key, value);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown';
      this.deps.log.warn(`settings request failed: settings.setSetting: ${name}`);
      this.notice({
        integrationID: '',
        kind: 'settingFailed',
        message: l10n.t('The setting could not be saved'),
      });
    }
    this.changed();
  }

  /**
   * Switches one mod through {@link ModsChat.toggle}, the same path as the chat's `mod.toggle`
   * (which rejects, writing nothing, an id outside the last discovery). Without a mods half, or when
   * the toggle rejects, it logs `settings request failed: settings.modToggle: <error name>` (never a
   * text of the mod), posts a `modFailed` notice with a fixed message and a fresh state. On success
   * it posts nothing: the next `settings.state` comes from `mods.onDidChange`.
   * VERIFIED by "switches a mod through the mods half and says nothing on success", "refuses a
   * mod the discovery does not know with a notice and a log without text of the mod" and "answers a
   * notice when there is no mods half" of `settingsController.test.ts` (fabricated mods half).
   */
  private async modToggle(modId: string, enabled: boolean): Promise<void> {
    const mods = this.deps.mods;
    try {
      if (mods === undefined) throw new Error('Mods are not available');
      await mods.toggle(modId, enabled);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown';
      this.deps.log.warn(`settings request failed: settings.modToggle: ${name}`);
      this.notice({
        integrationID: '',
        kind: 'modFailed',
        message:
          mods === undefined
            ? l10n.t('Mods are not available')
            : l10n.t('The mod could not be switched'),
      });
      this.changed();
    }
  }

  /**
   * Posts an `mcpFailed` notice for `server` with `message`, then a fresh state (a refused request
   * leaves the row's busy mark to the webview, which clears it on the next state or notice of that
   * server). Used for every refusal and failure of the two MCP requests.
   */
  private mcpFailed(server: string, message: string): void {
    this.notice({ integrationID: '', kind: 'mcpFailed', server, message });
    this.changed();
  }

  /**
   * Revalidates a connect or disconnect of an MCP server against the snapshot and runs it. The
   * server must exist; `connect` is allowed from `disabled` and `failed` only, `disconnect` from
   * `connected` and `pending` only (`needs_auth` has its own request, and the tab never offers
   * add or remove: decision P6); a second request for a server whose first has not finished is
   * refused. Every refusal writes one `settings request refused` line with a fixed reason and posts
   * an `mcpFailed` notice, without calling the server. After the call the state is READ again
   * (`ServerConfig.mcpAction` does it) and the notice says what the server became: `connected`
   * says connected, `disabled` says disconnected, `failed` and `needs_auth` say the error, and
   * `pending` says nothing yet (the stream will move the row). No optimistic state is posted.
   * VERIFIED by the checks of "SettingsController MCP requests" in `settingsController.test.ts`
   * (fabricated snapshot and fake `mcpAction`, vitest, Windows 11, 10/11/2026): "allows connect from
   * disabled and failed, disconnect from connected and pending, and nothing else" (every state
   * against both operations), "refuses a second request for a server whose first has not
   * finished" and "words the notice by the state read after the change". Against the SYNTHETIC
   * server the `fake-server` cases "disconnects and reconnects an MCP server from the Settings
   * tab" and "refuses an MCP action the state does not allow" passed (Windows 11, VS Code,
   * 10/11/2026); the real-server half is `mcpAction` in `serverConfig.ts`.
   */
  private async mcpChange(name: string, op: SettingsMcpOp): Promise<void> {
    const server = this.deps.config.snapshot().mcp.servers.find((row) => row.name === name);
    if (server === undefined) {
      this.refused('settings.mcp', 'unknown server');
      this.mcpFailed(name, l10n.t('Unknown MCP server'));
      return;
    }
    const allowed =
      op === 'connect'
        ? server.status === 'disabled' || server.status === 'failed'
        : server.status === 'connected' || server.status === 'pending';
    if (!allowed) {
      this.refused('settings.mcp', `${op} not allowed in this state`);
      this.mcpFailed(name, l10n.t('That is not possible in the current state of the server.'));
      return;
    }
    if (this.mcpBusy.has(name)) {
      this.refused('settings.mcp', 'another request in progress');
      this.mcpFailed(name, l10n.t('Another change of this server is still running.'));
      return;
    }
    this.mcpBusy.add(name);
    try {
      const result = await this.deps.config.mcpAction(name, op);
      if (result.kind === 'failed') {
        this.mcpFailed(name, result.message);
        return;
      }
      const after = this.deps.config.snapshot().mcp.servers.find((row) => row.name === name);
      if (after === undefined) {
        this.mcpFailed(name, l10n.t('Unknown MCP server'));
        return;
      }
      switch (after.status) {
        case 'connected':
          this.notice({ integrationID: '', kind: 'mcpConnected', server: name });
          break;
        case 'disabled':
          this.notice({ integrationID: '', kind: 'mcpDisconnected', server: name });
          break;
        case 'failed':
        case 'needs_auth':
          this.notice({
            integrationID: '',
            kind: 'mcpFailed',
            server: name,
            ...(after.error === undefined || after.error === '' ? {} : { message: after.error }),
          });
          break;
        case 'pending':
          break;
      }
      this.changed();
    } finally {
      this.mcpBusy.delete(name);
    }
  }

  /**
   * Revalidates an MCP sign-in and runs the existing OAuth flow of {@link ProviderAuth} with the
   * server's integration row (the one `source: 'mcp'`, hidden from Providers) and its first OAuth
   * method the tab can run. The server must exist, be `needs_auth` and have `canSignIn` (the
   * same test the state uses), and have no other request running; otherwise the request is
   * refused with one fixed-reason line and an `mcpFailed` notice, and nothing is started. The
   * result becomes the same notices as {@link connect}, with the integration id `mcp_...` (the
   * webview names them with the server).
   * VERIFIED by "signs in through the mcp integration row and its oauth method, and names the
   * ending" and "refuses a sign-in without an integration, in another state, for a ghost, or
   * while busy" of `settingsController.test.ts` (fabricated snapshot and fake `auth`, vitest,
   * Windows 11, 10/11/2026). UNVERIFIED: a real OAuth sign-in of an MCP
   * server (no suite has a server that speaks MCP OAuth).
   */
  private async mcpSignIn(name: string): Promise<void> {
    const snapshot = this.deps.config.snapshot();
    const server = snapshot.mcp.servers.find((row) => row.name === name);
    if (server === undefined) {
      this.refused('settings.mcpSignIn', 'unknown server');
      this.mcpFailed(name, l10n.t('Unknown MCP server'));
      return;
    }
    const integration = this.mcpIntegration(server, snapshot);
    const method = integration?.methods.find((m) => m.type === 'oauth' && m.supported);
    if (server.status !== 'needs_auth' || integration === undefined || method === undefined) {
      this.refused('settings.mcpSignIn', 'cannot sign in to this server');
      this.mcpFailed(name, l10n.t('That is not possible in the current state of the server.'));
      return;
    }
    if (this.mcpBusy.has(name)) {
      this.refused('settings.mcpSignIn', 'another request in progress');
      this.mcpFailed(name, l10n.t('Another change of this server is still running.'));
      return;
    }
    this.mcpBusy.add(name);
    try {
      const result = await this.deps.auth.connect(integration, method.index, {});
      this.announce(integration.id, integration.name, result);
    } finally {
      this.mcpBusy.delete(name);
    }
  }

  /**
   * Revalidates a default-model request and writes the USER setting once. `''` (after trimming)
   * clears it. Anything else must parse as `provider/model` AND be in the catalog the store holds
   * (so a model of a provider that is not connected is refused); a refused request writes nothing,
   * logs one fixed-reason line and posts a `modelRefused` notice (not a sign-in failure) whose
   * `integrationID` is the provider half, or `''` when the text did not parse. The value written is
   * the canonical `providerID/id`, not the raw text. There is no optimistic state: the webview
   * waits for the next `settings.state`, and this method asks for one on EVERY exit (written,
   * cleared, refused, or a write that threw), because the native `<select>` already shows the
   * user's pick and only a fresh state puts the saved value back. A write that throws posts a
   * `modelRefused` notice and the state, instead of leaving only a log line.
   * VERIFIED on Windows 11 (08/11/2026, vitest, fabricated `preferences`): the checks "asks for a
   * fresh state after a refused model" and "tells the webview when the write throws" of
   * `settingsController.test.ts` passed. UNVERIFIED against a real write failure of the profile.
   */
  private async setDefaultModel(text: string): Promise<void> {
    const parsed = parseModelSetting(text);
    let providerID = '';
    let value: string | undefined;
    if (parsed.kind === 'invalid') {
      this.refused('settings.setDefaultModel', 'not provider/model');
      this.refuseModel('', l10n.t('Unknown model'));
      return;
    }
    if (parsed.kind === 'model') {
      providerID = parsed.model.providerID;
      if (!isAvailable(parsed.model, this.deps.config.snapshot().models.rows)) {
        this.refused('settings.setDefaultModel', 'model not in the catalog');
        this.refuseModel(providerID, l10n.t('Unknown model'));
        return;
      }
      value = `${providerID}/${parsed.model.id}`;
    }
    try {
      await this.deps.preferences.write(value);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown';
      this.deps.log.warn(`settings request failed: settings.setDefaultModel: ${name}`);
      this.refuseModel(providerID, l10n.t('The setting could not be saved'));
      return;
    }
    this.changed();
  }

  /** Posts a `modelRefused` notice and then the current state, so the select returns to the saved value. */
  private refuseModel(providerID: string, message: string): void {
    this.notice({ integrationID: providerID, kind: 'modelRefused', message });
    this.changed();
  }

  /**
   * Revalidates a connect request: the integration exists, the method index exists, and the answer
   * is reduced to the declared keys of that method. An integration with no method is refused here
   * (unknown method): the card offers nothing for it and points to `opencode auth login`. Then runs the flow and turns its result into a notice.
   */
  private async connect(
    integrationID: string,
    methodIndex: number,
    answer: Record<string, string>,
  ): Promise<void> {
    const row = this.deps.config
      .snapshot()
      .integrations.rows.find((candidate) => candidate.id === integrationID);
    if (row === undefined) {
      this.refused('settings.connect', 'unknown integration');
      this.notice({ integrationID, kind: 'failed', message: l10n.t('Unknown provider') });
      return;
    }
    const method = row.methods.find((candidate) => candidate.index === methodIndex);
    if (method === undefined) {
      this.refused('settings.connect', 'unknown method');
      this.notice({
        integrationID,
        kind: 'failed',
        message: l10n.t('Unknown method for {0}', row.name),
      });
      return;
    }
    const declared = new Set(method.fields.map((field) => field.key));
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(answer)) {
      if (!declared.has(key)) continue;
      if (Object.keys(clean).length >= MAX_SETTINGS_ANSWERS) break;
      clean[key] = value.slice(0, MAX_SETTINGS_VALUE);
    }
    const result = await this.deps.auth.connect(row, methodIndex, clean);
    this.announce(integrationID, row.name, result);
  }

  /**
   * Turns the end of a sign-in flow into its notice: `connected`, `cancelled`, `expired`, `failed`
   * or `unsupported`, all with the integration id (a provider's or an MCP server's `mcp_...`).
   * Shared by {@link connect} and {@link mcpSignIn}, so both word the five endings the same.
   */
  private announce(integrationID: string, name: string, result: AuthResult): void {
    switch (result.kind) {
      case 'connected':
        this.notice({
          integrationID,
          kind: 'connected',
          message: l10n.t('Connected to {0}', name),
        });
        return;
      case 'cancelled':
        this.notice({ integrationID, kind: 'cancelled' });
        return;
      case 'expired':
        this.notice({ integrationID, kind: 'expired', message: l10n.t('The sign-in expired') });
        return;
      case 'failed':
        this.notice({ integrationID, kind: 'failed', message: result.message });
        return;
      case 'unsupported':
        this.notice({ integrationID, kind: 'unsupported', message: result.message });
        return;
    }
  }

  /**
   * Revalidates a remove request: the integration exists and `credentialID` is a credential among
   * ITS connections (a credential of another integration, an env connection or an invented id is
   * refused without touching the server). The confirmation modal is `ProviderAuth.disconnect`'s.
   */
  private async disconnect(integrationID: string, credentialID: string): Promise<void> {
    const row = this.deps.config
      .snapshot()
      .integrations.rows.find((candidate) => candidate.id === integrationID);
    const owns =
      row?.connections.some(
        (connection) => connection.kind === 'credential' && connection.id === credentialID,
      ) === true;
    if (row === undefined || !owns) {
      this.refused('settings.disconnect', 'credential not in this integration');
      this.notice({ integrationID, kind: 'failed', message: l10n.t('Unknown credential') });
      return;
    }
    const result = await this.deps.auth.disconnect(row, credentialID);
    if (result.kind === 'removed') {
      this.notice({
        integrationID,
        kind: 'removed',
        message: l10n.t('Removed from {0}', row.name),
      });
    } else if (result.kind === 'failed') {
      this.notice({ integrationID, kind: 'failed', message: result.message });
    }
  }

  /** One log line for a request the revalidation refused: the message type and a fixed reason. */
  private refused(type: string, reason: string): void {
    this.deps.log.warn(`settings request refused: ${type}: ${reason}`);
  }
}
