/**
 * The bridge of the Quick start view to the extension host (issue #187, E9-sidebar-home): one
 * outgoing function and one incoming listener, both typed with `src/shared/homeProtocol.ts`.
 * `vscodeApi` (from `../vscode`) stays the only handle to `acquireVsCodeApi()`.
 */
import { batch } from 'solid-js';
import {
  isHomeHostToWebview,
  type HomeHostToWebview,
  type HomeWebviewToHost,
} from '../../../src/shared/homeProtocol';
import { vscodeApi } from '../vscode';

/** Sends one typed message to the host; the host validates it and drops what it does not know. */
export function postHome(message: HomeWebviewToHost): void {
  vscodeApi.postMessage(message);
}

/**
 * Listens to the host, applies the messages in one reactive batch per animation frame (in order),
 * and only then posts `home.ready`.
 *
 * The order matters: the host answers `ready` with a complete `home.state` and does not queue, so
 * the listener must exist before `ready` leaves (as `connectSettingsHost` does). A message that
 * fails the shallow guard is dropped. Returns the function that removes the listener.
 * VERIFIED by `homeHost.test.ts` (a mocked `vscodeApi`, a hand-driven `requestAnimationFrame` and
 * fabricated messages: a host that answers `ready` at once finds the listener, order is kept, a
 * bad message is dropped). VERIFIED that a real VS Code delivers to it by the full
 * `test:visual` run of E9-sidebar-home (Windows 11, VS Code 1.145.2, 08/11/2026): "ok   H0 the Quick start view shows the box, "Server ready", the
 * Manual pill and "Nothing running"" (the state arrived after `ready`).
 */
export function connectHomeHost(apply: (message: HomeHostToWebview) => void): () => void {
  let queue: HomeHostToWebview[] = [];
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
    if (!isHomeHostToWebview(data)) return;
    queue.push(data);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  };
  window.addEventListener('message', onMessage);
  postHome({ type: 'home.ready' });
  return () => {
    window.removeEventListener('message', onMessage);
  };
}
