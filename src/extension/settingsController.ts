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

import type { ProviderAuth } from './providerAuth';
import type { ServerConfig } from './serverConfig';
import type { ServerLog } from './opencodeServer';
import type { ConnectionState } from '../shared/protocol';
import {
  MAX_SETTINGS_ANSWERS,
  MAX_SETTINGS_VALUE,
  isSettingsWebviewToHost,
  type SettingsAction,
  type SettingsHostToWebview,
  type SettingsNotice,
  type SettingsState,
  type SettingsWebviewToHost,
} from '../shared/settingsProtocol';

/** The slice of {@link ServerConfig} the controller reads. */
export type SettingsConfigSource = Pick<ServerConfig, 'snapshot' | 'onDidChange' | 'reloadAll'>;
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
}

/** Everything the controller is given. */
export interface SettingsControllerDeps {
  config: SettingsConfigSource;
  auth: SettingsAuth;
  /** Sends one message to the webview (the panel drops it if the webview is not ready). */
  post(message: SettingsHostToWebview): void;
  header(): SettingsHeader;
  /** Runs a footer action with the existing command (logs, extension settings, restart). */
  runAction(action: SettingsAction): void;
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
 * server): "ok   V7 pressing Enter connects Azure: it moves to Connected with "API key · saved by
 * opencode for all projects" and a Remove button, and the live region says "Connected to Azure."",
 * "ok   V9 confirming the modal removes the credential: Azure is back in Add a provider with no
 * Remove button …" and "ok   V8 Cancel in the notification ends the attempt …". UNVERIFIED, with
 * no date: the controller after the tab is hidden and shown (no `test:visual` cell does it).
 */
export class SettingsController {
  private ready = false;
  private dirty = false;
  private readonly unsubscribe: (() => void)[];

  constructor(private readonly deps: SettingsControllerDeps) {
    this.unsubscribe = [
      deps.config.onDidChange(() => this.changed()),
      deps.auth.onDidChangeAttempt(() => this.changed()),
    ];
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

  /** The `settings.state` of this moment, from the store, the header and the attempt. */
  buildState(): SettingsState {
    const snapshot = this.deps.config.snapshot();
    const header = this.deps.header();
    const attempt = this.deps.auth.attempt();
    return {
      connection: header.connection,
      folder: header.folder,
      ...(header.serverVersion === undefined ? {} : { serverVersion: header.serverVersion }),
      providers: {
        loaded: snapshot.integrations.loaded,
        failed: snapshot.integrations.failed,
        rows: snapshot.integrations.rows,
      },
      mcp: {
        loaded: snapshot.mcp.loaded,
        failed: snapshot.mcp.failed,
        pendingFirstRead: snapshot.mcp.pendingFirstRead,
        servers: snapshot.mcp.servers,
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
    }
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
      this.notice({ integrationID, kind: 'failed', message: 'Unknown provider' });
      return;
    }
    const method = row.methods.find((candidate) => candidate.index === methodIndex);
    if (method === undefined) {
      this.refused('settings.connect', 'unknown method');
      this.notice({ integrationID, kind: 'failed', message: `Unknown method for ${row.name}` });
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
    switch (result.kind) {
      case 'connected':
        this.notice({ integrationID, kind: 'connected', message: `Connected to ${row.name}` });
        return;
      case 'cancelled':
        this.notice({ integrationID, kind: 'cancelled' });
        return;
      case 'expired':
        this.notice({ integrationID, kind: 'expired', message: 'The sign-in expired' });
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
      this.notice({ integrationID, kind: 'failed', message: 'Unknown credential' });
      return;
    }
    const result = await this.deps.auth.disconnect(row, credentialID);
    if (result.kind === 'removed') {
      this.notice({ integrationID, kind: 'removed', message: `Removed from ${row.name}` });
    } else if (result.kind === 'failed') {
      this.notice({ integrationID, kind: 'failed', message: result.message });
    }
  }

  /** One log line for a request the revalidation refused: the message type and a fixed reason. */
  private refused(type: string, reason: string): void {
    this.deps.log.warn(`settings request refused: ${type}: ${reason}`);
  }
}
