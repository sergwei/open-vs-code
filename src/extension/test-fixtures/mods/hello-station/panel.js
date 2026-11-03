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

// Hidden button (E10-mods-hardening): ten messages over the 1 MB cap, which the host must drop with
// at most one warning in the same second. Hidden, so the screenshots and contrast checks of step 39
// do not see it.
document.getElementById('flood')?.addEventListener('click', () => {
  for (let i = 0; i < 10; i += 1)
    vscode.postMessage({ kind: 'flood', blob: 'x'.repeat(1_100_000) });
});

vscode.postMessage({ kind: 'ping', n: 0 });
