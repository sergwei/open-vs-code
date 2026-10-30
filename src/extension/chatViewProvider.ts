import * as vscode from 'vscode';
import type { HostToWebview, WebviewToHost } from '../shared/protocol';
import { parseWebviewMessage, renderChatWebview } from './chatWebview';
import { CHAT_VIEW_ID } from './ids';

/** What the provider tells the chat controller; the controller never touches `vscode`. */
export interface ChatViewHooks {
  /** The webview document loaded and sent `ready`; the controller answers with state + snapshot. */
  onReady(): void;
  /** A VALIDATED message from the webview (`isWebviewToHost` already passed). */
  onMessage(message: WebviewToHost): void;
  /**
   * The view became visible or hidden (issue #19). Also called with `true` right after
   * `resolveWebviewView`, because a view is resolved when it is first shown and VS Code fires no
   * visibility event for that. The attention feature closes its notifications on `true`.
   */
  onVisibilityChange?(visible: boolean): void;
}

/**
 * Provides the chat webview view (`openVsCode.chat`) and carries its messages.
 *
 * Handshake (issue #14): `ready` is reset on every `resolveWebviewView` (a new document), when
 * the view stops being visible and on dispose. Until the webview sends `ready` — which it does on
 * every document load — {@link post} DISCARDS what it is given instead of queueing it: a queue
 * would replay old deltas onto an empty store before the snapshot, while the controller already
 * answers each `ready` with the connection state and a complete snapshot (plan
 * `E2-mvp-prototype/plan-fase1`, alternative discarded: queue + flush). Incoming messages pass
 * through `isWebviewToHost`; a rejected one is logged as a warning with its `type` only, never its
 * content. Each `resolveWebviewView` gets a fresh nonce.
 * HYPOTHESIS: VS Code calls `resolveWebviewView` again when the view is shown after being hidden
 * (`WebviewViewProvider` docs in vscode.d.ts); the reset on visibility covers the case where it
 * does not, because a hidden webview cannot be written to. Not observed: check the log in F5 for
 * one "Chat view resolved" per resolution and for `webview ready` after hiding and showing.
 * Phase 3 (issue #19) adds the Activity Bar badge ({@link setBadge}, kept here because every
 * `resolveWebviewView` hands over a NEW `WebviewView` object that starts without a badge) and the
 * visibility hook.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  /** Number of pending requests the badge must show; survives the view being re-resolved. */
  private badgeCount = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly channel: vscode.LogOutputChannel,
    private readonly hooks: ChatViewHooks,
  ) {}

  /** True while a resolved view exists and is visible; false before the first resolution. */
  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  /**
   * True while the current document has sent `ready` and the view is visible, i.e. while
   * {@link post} would deliver. The controller asks it to keep what the Explorer command produces
   * for a hidden chat (issue #30); same condition as `post`, so the two cannot disagree.
   */
  get canDeliver(): boolean {
    return this.ready && this.view !== undefined && this.view.visible;
  }

  /**
   * Shows `count` pending requests on the view's badge (0 clears it) and remembers it for the
   * next resolution. `WebviewView.badge` is documented to surface on the container's icon in the
   * Activity Bar (vscode.d.ts 1.105, read); without a resolved view there is nothing to set, so
   * a request that arrives before the first time the view was shown has no badge, only the
   * notification. HYPOTHESIS: that the badge reaches the icon of the container (F5 point 4).
   */
  setBadge(count: number): void {
    this.badgeCount = count;
    this.applyBadge();
  }

  /** Writes the remembered count into the current view; a no-op without one. */
  private applyBadge(): void {
    const view = this.view;
    if (view === undefined) return;
    const count = this.badgeCount;
    view.badge =
      count > 0
        ? {
            value: count,
            tooltip: `${String(count)} OpenCode request${count === 1 ? '' : 's'} waiting`,
          }
        : undefined;
  }

  /**
   * Sends `message` to the webview if the document is ready and visible; otherwise drops it.
   *
   * Dropping is safe because the next `ready` brings a snapshot. `postMessage` resolving to
   * `true` only means the message was published, not received (vscode.d.ts), which is why the
   * handshake exists at all.
   */
  post(message: HostToWebview): void {
    const view = this.view;
    if (!this.ready || view === undefined || !view.visible) return;
    void view.webview.postMessage(message).then(undefined, (error: unknown) => {
      // debug, not warn: closing the window rejects in-flight posts with "Canceled" (seen in the
      // real-opencode run of 2026-10-20), which is expected noise.
      this.channel.debug(`posting ${message.type} to the webview failed: ${String(error)}`);
    });
  }

  /**
   * Configures the webview, sets its HTML and wires the message listener.
   *
   * Options, HTML, nonce and the bundle check are {@link renderChatWebview}, shared with the
   * editor tabs (`chatPanels.ts`). The listener, the visibility handler and the dispose handler
   * are disposed with the view.
   * VERIFIED in F5 (Windows 11, 2026-10-20, issue #2): the bundle loads and "Chat view resolved"
   * appears. The message path is VERIFIED by the integration suite only as far as `webview ready`
   * reaching the log (`chatView.test.ts`); UNVERIFIED by eye until the F5 of issue #14.
   */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webview = webviewView.webview;

    this.view = webviewView;
    this.ready = false;

    const subscriptions = [
      webview.onDidReceiveMessage((raw: unknown) => {
        this.receive(raw);
      }),
      webviewView.onDidChangeVisibility(() => {
        if (!webviewView.visible) this.ready = false;
        this.hooks.onVisibilityChange?.(webviewView.visible);
      }),
      webviewView.onDidDispose(() => {
        this.ready = false;
        if (this.view === webviewView) {
          this.view = undefined;
          this.hooks.onVisibilityChange?.(false);
        }
        for (const subscription of subscriptions) subscription.dispose();
      }),
    ];

    renderChatWebview(webview, this.extensionUri, this.channel, 'view');
    this.channel.info('Chat view resolved');
    this.applyBadge();
    this.hooks.onVisibilityChange?.(true);
  }

  /**
   * Validates one raw message from the webview ({@link parseWebviewMessage}) and routes it.
   *
   * `ready` marks the document ready BEFORE calling `onReady`, so what the controller posts in
   * answer is delivered. A message that fails the guard is dropped with a warning.
   */
  private receive(raw: unknown): void {
    const message = parseWebviewMessage(raw, this.channel);
    if (message === undefined) return;
    if (message.type === 'ready') {
      this.ready = true;
      this.hooks.onReady();
      return;
    }
    this.hooks.onMessage(message);
  }
}

/**
 * Registers the chat view provider and returns it with its disposable.
 *
 * One call from `registerChat`. VERIFIED that the view id matches the `contributes.views` entry and
 * the view resolves with its bundle: F5 on Windows (2026-10-20) and the integration tests of
 * issue #41 in a real VS Code 1.142 on Windows, macOS and Linux (CI run 39414371746).
 */
export function registerChatView(
  extensionUri: vscode.Uri,
  channel: vscode.LogOutputChannel,
  hooks: ChatViewHooks,
): { provider: ChatViewProvider; disposable: vscode.Disposable } {
  const provider = new ChatViewProvider(extensionUri, channel, hooks);
  return {
    provider,
    disposable: vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, provider),
  };
}
