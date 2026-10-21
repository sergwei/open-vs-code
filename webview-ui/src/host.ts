/**
 * The webview's bridge to the extension host: one outgoing function and one incoming listener.
 *
 * `vscodeApi` (from `./vscode`) is the only handle to `acquireVsCodeApi()`; this module never
 * calls it. The protocol types come from `src/shared`, the same unions the host uses.
 */
import { batch } from 'solid-js';
import { isHostToWebview, type HostToWebview, type WebviewToHost } from '../../src/shared/protocol';
import { vscodeApi } from './vscode';

/**
 * Sends one typed message to the extension host.
 *
 * The host validates it with `isWebviewToHost` (deep guard); a malformed message is dropped there
 * with a warning, so a typo here shows up in the OpenCode log as "rejected a message".
 */
export function post(message: WebviewToHost): void {
  vscodeApi.postMessage(message);
}

/**
 * Listens to the host and hands messages to `apply`, grouped into one reactive batch per frame.
 *
 * Why batch per `requestAnimationFrame`: during streaming the host sends tens of `part.delta` per
 * second, and one reactive pass per frame instead of per token keeps the UI smooth (design of the
 * solid-webview skill §3; the gain was NOT measured, HYPOTHESIS). Order is preserved. Messages
 * that fail the shallow guard `isHostToWebview` are dropped. Returns the function that removes the
 * listener (tests and HMR). A hidden webview may not get animation frames, but a hidden webview
 * document is destroyed by VS Code and rebuilt with a snapshot on `ready`, so nothing is lost.
 * UNVERIFIED in a real webview: only the logic is exercised by `host.test.ts`.
 */
export function listenHost(apply: (message: HostToWebview) => void): () => void {
  let queue: HostToWebview[] = [];
  let scheduled = false;
  const flush = (): void => {
    scheduled = false;
    const pending = queue;
    queue = [];
    batch(() => {
      for (const message of pending) apply(message);
    });
  };
  const onMessage = (event: MessageEvent<unknown>): void => {
    const data = event.data;
    if (!isHostToWebview(data)) return;
    queue.push(data);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  };
  window.addEventListener('message', onMessage);
  return () => {
    window.removeEventListener('message', onMessage);
  };
}
