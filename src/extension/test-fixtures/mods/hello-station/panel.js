// Test fixture (E10-mods phase 4): the page of the `hello-station` panel. It tells the mod it has
// loaded, sends a ping on each click of the button, and prints what the mod answers.
/* global acquireVsCodeApi, window, document */
const vscode = acquireVsCodeApi();
let pings = 0;

window.addEventListener('message', (event) => {
  const reply = document.getElementById('reply');
  if (reply) reply.textContent = `${event.data.kind} ${event.data.n} from ${event.data.from}`;
});

document.getElementById('ping')?.addEventListener('click', () => {
  pings += 1;
  vscode.postMessage({ kind: 'ping', n: pings });
});

vscode.postMessage({ kind: 'ping', n: 0 });
