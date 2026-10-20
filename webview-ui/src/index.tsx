import { render } from 'solid-js/web';
import { App } from './App';
import './index.css';
// Imported for its side effect: acquires the VS Code API once, at startup.
import './vscode';

const root = document.getElementById('root');
if (!root) {
  // The host's HTML (src/extension/webviewHtml.ts) is the other half of this contract.
  throw new Error('Webview root element #root not found');
}
// Solid's `render` appends instead of replacing, so drop the host's "Loading..." fallback.
root.textContent = '';
render(() => <App />, root);
