/**
 * The bridge of the OpenCode Settings tab to the extension host (issue #128, E10): one outgoing
 * function and one incoming listener, both typed with `src/shared/settingsProtocol.ts`.
 *
 * `vscodeApi` (from `../vscode`) is still the only handle to `acquireVsCodeApi()`: the tab and the
 * chat are different documents, but each calls it exactly once through that module.
 */
import { batch } from 'solid-js';
import {
  isSettingsHostToWebview,
  type SettingsHostToWebview,
  type SettingsWebviewToHost,
} from '../../../src/shared/settingsProtocol';
import { vscodeApi } from '../vscode';

/** Sends one typed message to the host; the host validates it and drops what it does not know. */
export function postSettings(message: SettingsWebviewToHost): void {
  vscodeApi.postMessage(message);
}

/**
 * Listens to the host, applies the messages in one reactive batch per animation frame (in order),
 * and only then posts `settings.ready`.
 *
 * The order matters: the host answers `ready` with a full `settings.state` and does not queue, so
 * the listener must exist before `ready` leaves (as `listenHost` does for the chat). Messages that
 * fail the shallow guard `isSettingsHostToWebview` are dropped. Returns the function that removes
 * the listener. VERIFIED by `settingsHost.test.ts` with a mocked `vscodeApi` and a hand-driven
 * `requestAnimationFrame` (fabricated messages). The `fake-server` suite opens the real tab and
 * waits for its ready state ("opens the OpenCode Settings tab once and its document says ready"),
 * but it feeds messages through `test.settingsMessage`, not from the DOM. VERIFIED that a real VS
 * Code 1.144.0 delivers them to this listener in the right order (Windows 11, 1/11/2026, `npm run
 * test:visual -- --group config`, synthetic server): "ok   V4 after a prompt with MCPFLIP the open
 * tab shows broken as connected with a status.md resource, in the same document" and "ok   V8 an
 * approved OAuth login ends in Connected: OpenAI shows "Signed in · saved by opencode…" and the
 * live region says "Connected to OpenAI."" (a state, then a notice, both received through it).
 */
export function connectSettingsHost(apply: (message: SettingsHostToWebview) => void): () => void {
  let queue: SettingsHostToWebview[] = [];
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
    if (!isSettingsHostToWebview(data)) return;
    queue.push(data);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  };
  window.addEventListener('message', onMessage);
  postSettings({ type: 'settings.ready' });
  return () => {
    window.removeEventListener('message', onMessage);
  };
}
