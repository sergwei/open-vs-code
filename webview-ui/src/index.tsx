import { createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { App } from './App';
import { listenHost, post } from './host';
import './index.css';
import { SettingsApp } from './settings/SettingsApp';
import { connectSettingsHost, postSettings } from './settings/settingsHost';
import { createSettingsStore } from './settings/settingsStore';
import { createSettingsUi } from './settings/settingsUiState';
import { createChatStore } from './store/chatStore';
import { createUiState } from './uiState';
import { vscodeApi } from './vscode';

const root = document.getElementById('root');
if (!root) {
  // The host's HTML (src/extension/webviewHtml.ts) is the other half of this contract.
  throw new Error('Webview root element #root not found');
}
// Solid's `render` appends instead of replacing, so drop the host's "Loading..." fallback.
root.textContent = '';

// One bundle, two surfaces (decision P3=1 of E10): the host writes
// `<meta name="open-vs-code-surface" content="settings">` for the OpenCode Settings tab; any other
// value is the chat, as before. Each surface has its own store and its own listener, and both use
// the single `vscodeApi` handle.
const surface = document
  .querySelector('meta[name="open-vs-code-surface"]')
  ?.getAttribute('content');

if (surface === 'settings') {
  const store = createRoot(() => createSettingsStore());
  const ui = createSettingsUi(vscodeApi);
  render(() => <SettingsApp store={store} send={postSettings} ui={ui} />, root);
  // The listener goes up before `settings.ready` leaves: `connectSettingsHost` does both in order.
  connectSettingsHost((message) => {
    store.apply(message);
  });
} else {
  // The store lives in its own root: it is created once for the whole document and never disposed.
  const store = createRoot(() => createChatStore());
  // The draft and the prompt history come from the webview state of the previous document, if any
  // (VS Code destroys the iframe when the view is hidden).
  const uiState = createUiState(vscodeApi);
  render(() => <App store={store} send={post} uiState={uiState} />, root);

  // Order matters: the listener must exist BEFORE `ready` is posted, because the host answers
  // `ready` with the connection state and a snapshot, and a message that arrives before the
  // listener would be lost (the host does not queue, see `ChatViewProvider`).
  listenHost(store.apply);
  post({ type: 'ready' });
}
