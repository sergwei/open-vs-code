// The editor tab "OpenCode Settings" (issue #128, E10): ONE `WebviewPanel` that shows the providers
// and the MCP servers of the opencode server. This file only creates, reveals, validates and closes
// the panel; what to show and what to do with a request is `settingsController.ts` (pure, tested
// by Vitest), reached through {@link SettingsPanelHandlers}.

import * as vscode from 'vscode';
import {
  isSettingsWebviewToHost,
  type SettingsHostToWebview,
  type SettingsWebviewToHost,
} from '../shared/settingsProtocol';
import { chatWebviewOptions, renderChatWebview } from './chatWebview';
import { SETTINGS_PANEL_VIEW_TYPE } from './ids';
import type { ServerLog } from './opencodeServer';

/** Title of the tab. */
const SETTINGS_TITLE = 'OpenCode Settings';

/** What the panel reports to the controller. */
export interface SettingsPanelHandlers {
  /** The document loaded and sent `settings.ready`: answer with the whole state. */
  onReady(): void;
  /** A message that passed the protocol guard (`settings.ready` excluded). */
  onMessage(message: SettingsWebviewToHost): void;
  /** The document is gone (the tab closed or was hidden): post nothing until the next `ready`. */
  onClosed(): void;
}

/**
 * The single settings tab. {@link show} creates it or reveals the one that exists, so the command
 * never opens a second tab; {@link post} sends to the live document and drops the message when
 * there is none (the next `ready` brings a complete `settings.state`, `vscode-extension` section 4).
 *
 * No `retainContextWhenHidden` (plan section 6): the host holds the state, and what only the
 * webview knows (tab, search, half-typed fields) goes through `vscode.setState` on its side. A
 * hidden tab therefore loses its document, so hiding counts as closing for the controller and the
 * next reveal sends a new `ready`.
 * No `WebviewPanelSerializer`: Reload Window does not bring the tab back, no blank tab and no
 * error left behind. VERIFIED in a real VS Code 1.144.0 on Windows 11 (1/11/2026, `npm run
 * test:visual -- --group config`, step 36, after the tab was open with the chat in the side bar):
 * the run printed "observed after Reload Window: tabs titled OpenCode Settings 0, document null"
 * (15 s of waiting for one) and "ok   Reload Window leaves either no Settings tab or one that shows
 * the settings UI (tab false, document null)". Not observed: a reload with the tab hidden behind
 * another one.
 *
 * VERIFIED in a real VS Code 1.144.0 on Windows 11 (1/11/2026, `npm run test:integration -- --label
 * fake-server`): "✔ opens the OpenCode Settings tab once and its document says ready" (one tab
 * labelled "OpenCode Settings", a second command opens no second tab, the log has one `settings tab
 * opened` and `settings webview ready`, no `Webview bundle file missing`, no rejected message).
 * UNVERIFIED: hidden-tab behaviour in a real window (the hidden-to-visible `ready`), macOS and
 * Linux.
 */
export class SettingsPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly channel: vscode.LogOutputChannel,
    private readonly log: ServerLog,
    private readonly handlers: SettingsPanelHandlers,
  ) {}

  /** Opens the tab in the active column, or reveals it when it is already open. */
  show(): void {
    if (this.panel !== undefined) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SETTINGS_PANEL_VIEW_TYPE,
      SETTINGS_TITLE,
      vscode.ViewColumn.Active,
      chatWebviewOptions(this.extensionUri),
    );
    this.panel = panel;
    renderChatWebview(panel.webview, this.extensionUri, this.channel, 'settings');
    this.subscriptions.push(
      panel.webview.onDidReceiveMessage((raw: unknown) => {
        this.receive(raw);
      }),
      panel.onDidChangeViewState(() => {
        // A hidden tab has no document (no retained context): stop posting until it is back.
        if (!panel.visible) this.handlers.onClosed();
      }),
      panel.onDidDispose(() => {
        this.release();
        this.handlers.onClosed();
      }),
    );
    this.log.info('settings tab opened');
  }

  /** Sends `message` to the document; a closed or hidden tab drops it. */
  post(message: SettingsHostToWebview): void {
    if (this.panel?.visible === true) void this.panel.webview.postMessage(message);
  }

  /** Closes the tab, if open. */
  dispose(): void {
    const panel = this.panel;
    this.release();
    panel?.dispose();
    this.handlers.onClosed();
  }

  /**
   * Validates one raw message with the protocol guard (the webview is untrusted input): a message
   * that does not pass is dropped with one warning that names its `type` (a string, stripped
   * of control characters and cut to 64 characters) and nothing else. `settings.ready` goes to {@link SettingsPanelHandlers.onReady};
   * the rest to `onMessage`.
   */
  private receive(raw: unknown): void {
    if (!isSettingsWebviewToHost(raw)) {
      const type =
        typeof raw === 'object' &&
        raw !== null &&
        typeof (raw as { type?: unknown }).type === 'string'
          ? // Untrusted text: control characters out (a `\n` would forge a log line, and the tests
            // read the log for exact lines), then a bounded length.
            (raw as { type: string }).type.replace(/\p{Cc}/gu, '').slice(0, 64)
          : 'unknown';
      this.log.warn(`rejected a message from the settings webview (type: ${type})`);
      return;
    }
    if (raw.type === 'settings.ready') {
      this.log.info('settings webview ready');
      this.handlers.onReady();
      return;
    }
    this.handlers.onMessage(raw);
  }

  /** Forgets the panel and its listeners (the panel itself is already disposed or about to be). */
  private release(): void {
    this.panel = undefined;
    for (const subscription of this.subscriptions) subscription.dispose();
    this.subscriptions = [];
  }
}
