// The Quick start webview view (`openVsCode.home`, issue #187, E9-sidebar-home): a small webview at
// the top of the OpenCode container while the chat lives in editor tabs. This file only resolves the
// view, runs the `ready` handshake and validates what the document sends; what to show and what to
// do with an intention is `homeController.ts` (pure), reached through {@link HomeViewHandlers}.

import * as vscode from 'vscode';
import {
  isHomeWebviewToHost,
  type HomeHostToWebview,
  type HomeWebviewToHost,
} from '../shared/homeProtocol';
import { renderChatWebview } from './chatWebview';
import { HOME_VIEW_ID } from './ids';
import type { ServerLog } from './opencodeServer';

/** What the view reports to the controller. */
export interface HomeViewHandlers {
  /** The document loaded and sent `home.ready`: answer with the whole state. */
  onReady(): void;
  /** A message that passed the protocol guard (`home.ready` excluded). */
  onMessage(message: HomeWebviewToHost): void;
  /** The document is gone (hidden or disposed): post nothing until the next `ready`. */
  onClosed(): void;
}

/**
 * Provides the Quick start view. Registered ALWAYS (like the Sessions tree); the `when` of its
 * manifest entry (`config.openVsCode.chatLocation != sidebar`) decides whether VS Code shows it, and
 * a view that is never shown is never resolved.
 *
 * Handshake (`vscode-extension` section 4): `ready` is false on every `resolveWebviewView` (a new
 * document), when the view hides and on dispose; {@link post} DROPS what it is given until the
 * document sends `home.ready`, and the controller answers each `ready` with a complete state, so
 * nothing is queued. No `retainContextWhenHidden`: what only the webview knows (the half-typed text)
 * goes through `vscode.setState` on its side. Incoming messages pass `isHomeWebviewToHost`; a
 * rejected one logs a warning naming its `type` (control characters out, 64 characters at most) and
 * nothing else.
 * VERIFIED (Windows 11, VS Code 1.145.2, 08/11/2026): the `fake-server` case "starts a conversation
 * from the home view: one tab, a new session, prompt accepted" passed in a 69-passing run, and
 * the full `test:visual` run of the branch (same day) printed "ok   L1 with chatLocation sidebar the Quick start pane is gone and with
 * editor it is back without reloading (gone true, back true)". Not observed: the `ready` of a view
 * hidden and shown again inside a window with the view collapsed. UNVERIFIED on macOS and Linux.
 */
export class HomeViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private ready = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly channel: vscode.LogOutputChannel,
    private readonly log: ServerLog,
    private readonly handlers: HomeViewHandlers,
  ) {}

  /** True while the current document has sent `ready` and the view is visible (what {@link post} needs). */
  get canDeliver(): boolean {
    return this.ready && this.view !== undefined && this.view.visible;
  }

  /** Sends to the document; dropped when there is none ready and visible. */
  post(message: HomeHostToWebview): void {
    if (this.canDeliver) void this.view?.webview.postMessage(message);
  }

  /** Resolves a new document: HTML with the `home` surface, listeners of THIS view only. */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.ready = false;
    const subscriptions = [
      webviewView.webview.onDidReceiveMessage((raw: unknown) => {
        this.receive(raw);
      }),
      webviewView.onDidChangeVisibility(() => {
        if (!webviewView.visible) {
          this.ready = false;
          this.handlers.onClosed();
        }
      }),
      webviewView.onDidDispose(() => {
        this.ready = false;
        if (this.view === webviewView) this.view = undefined;
        this.handlers.onClosed();
        for (const subscription of subscriptions) subscription.dispose();
      }),
    ];
    renderChatWebview(webviewView.webview, this.extensionUri, this.channel, 'home');
    this.log.info('home view resolved');
  }

  /**
   * Validates one raw message (the document is untrusted input). `home.ready` marks the document
   * ready BEFORE calling `onReady`, so the state posted in answer is delivered.
   */
  private receive(raw: unknown): void {
    if (!isHomeWebviewToHost(raw)) {
      const type =
        typeof raw === 'object' &&
        raw !== null &&
        typeof (raw as { type?: unknown }).type === 'string'
          ? (raw as { type: string }).type.replace(/\p{Cc}/gu, '').slice(0, 64)
          : 'unknown';
      this.log.warn(`rejected a message from the home webview (type: ${type})`);
      return;
    }
    if (raw.type === 'home.ready') {
      this.ready = true;
      this.log.info('home webview ready');
      this.handlers.onReady();
      return;
    }
    this.handlers.onMessage(raw);
  }
}

/** Registers the provider under {@link HOME_VIEW_ID}; the disposable unregisters it. */
export function registerHomeView(
  extensionUri: vscode.Uri,
  channel: vscode.LogOutputChannel,
  log: ServerLog,
  handlers: HomeViewHandlers,
): { provider: HomeViewProvider; disposable: vscode.Disposable } {
  const provider = new HomeViewProvider(extensionUri, channel, log, handlers);
  return {
    provider,
    disposable: vscode.window.registerWebviewViewProvider(HOME_VIEW_ID, provider),
  };
}
