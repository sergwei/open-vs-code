// Raw CDP access to the chat webview of a VS Code started with `--remote-debugging-port`.
//
// Why raw CDP and not Playwright for the webview: VS Code hosts a webview in an out-of-process
// iframe that Playwright does not expose as a frame. It does show up as a CDP target of type
// `iframe` whose URL carries `extensionId=<publisher.name>`; this module opens its own WebSocket
// to that target and evaluates JavaScript inside the inner same-origin document
// (`iframe#active-frame`). Playwright (see `run.mjs`) drives the workbench: real mouse and
// keyboard, screenshots, the command palette.
//
// The target is a NEW one every time VS Code rebuilds the webview (the view is hidden and shown,
// the window reloads, the server restarts), so callers re-open it after those events. Everything
// the webview logs (CSP violations come through the `Log` domain) and every uncaught exception is
// appended to the array the caller gives, which `run.mjs` turns into assertions.
//
// Needs the global `WebSocket` (Node 22+). VERIFIED on Windows 11, Node 24, VS Code 1.142.0
// (20/10/2026, manual CDP run, Engram #934).

const EXTENSION_ID = 'sergwei.open-vs-code';

/** Longest wait for one CDP reply, in ms; see `send` inside {@link openWebview}. */
const CALL_TIMEOUT_MS = 20_000;

/**
 * Start of the message every call of a connection rejects with once one of its calls timed out;
 * `run.mjs` reads it to notice a stuck connection after a step (issue #93) and then diagnoses and
 * reopens it (issue #127).
 */
export const WEBVIEW_STUCK = 'the chat webview stopped answering CDP';

/**
 * Message `webviewTarget` throws when no target of the extension appears in time: the view is
 * hidden or closed and VS Code destroyed the webview. `run.mjs` tells it apart from a target that
 * appears and does not answer, which is the only case that cuts the run (decision #1638).
 */
export const WEBVIEW_NO_TARGET = 'the chat webview target did not appear';

/**
 * Finds the webview target of the extension, polling the debugging endpoint.
 *
 * With `wantedId` it returns the target whose URL carries `id=<wantedId>`, the id the workbench
 * gives as the `name` attribute of that webview's `iframe.webview` (see `run.mjs` `openChat`);
 * without it, the first target of the extension, which is the only choice while one chat exists.
 * Why an id and not a state of the target: with two chat tabs open (`openVsCode.chatLocation:
 * editor`) the order of `/json` does not follow the active tab, and in both targets
 * `document.visibilityState` is "visible" (the tabs keep their context when hidden) and the two
 * `.chat-title` read "Untitled session" until a prompt is sent; `document.hasFocus()` is true only
 * in the active tab and only while VS Code holds the system focus. VERIFIED on Windows 11, VS Code
 * 1.144.0 (29/10/2026), spike with two tabs: visibilityState "visible" in both, `hasFocus()` in
 * one, and the hidden tab's workbench iframe reported `checkVisibility()` false with its `name`
 * equal to the `id=` of its own target. NOT observed: a target of a tab in a hidden editor group
 * other than by switching tabs, macOS, Linux.
 */
async function webviewTarget(port, timeoutMs, wantedId) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(port)}/json`)).json();
      const target = list.find(
        (entry) =>
          entry.type === 'iframe' &&
          entry.url.includes(`extensionId=${EXTENSION_ID}`) &&
          (wantedId === undefined || entry.url.includes(`id=${wantedId}&`)),
      );
      if (target) return target;
    } catch {
      // The endpoint may not answer while VS Code is reloading: keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(WEBVIEW_NO_TARGET);
}

/**
 * Connects to the webview target and returns `{ inDoc, stuckReason, isClosed, close }`.
 *
 * `inDoc(fn, arg)` evaluates `fn(document, arg)` inside the inner frame and returns its JSON-able
 * result. `fn` is serialized with `toString()`, so it must be self-contained (no closures); `arg`
 * must be JSON-able. `logs` receives one line per `Log` entry, console call and exception
 * (`[exception] ...`, `[error] ...`), which `run.mjs` filters for CSP violations and exceptions.
 * `wantedId` (optional) picks one of several chat webviews, see {@link webviewTarget}.
 */
export async function openWebview(port, logs, timeoutMs = 30_000, wantedId = undefined) {
  const target = await webviewTarget(port, timeoutMs, wantedId);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 0;
  /** Calls in flight: id -> { resolve, reject, timer }. */
  const pending = new Map();
  /** Rejects every call still waiting (the socket closed or errored: no answer will come). */
  const rejectAll = (reason) => {
    for (const [id, call] of pending) {
      clearTimeout(call.timer);
      call.reject(new Error(reason));
      pending.delete(id);
    }
  };
  ws.onclose = () => {
    rejectAll('the webview CDP socket closed (the view was destroyed or the window reloaded)');
  };
  ws.onerror = () => {
    rejectAll('the webview CDP socket failed');
  };
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const call = pending.get(message.id);
      clearTimeout(call.timer);
      call.resolve(message);
      pending.delete(message.id);
    } else if (message.method === 'Log.entryAdded') {
      logs.push(`[${message.params.entry.level}] ${message.params.entry.text}`);
    } else if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map((arg) => arg.value ?? arg.description).join(' ');
      logs.push(`[console.${message.params.type}] ${text}`);
    } else if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      logs.push(`[exception] ${details.text} ${details.exception?.description ?? ''}`);
    }
  };
  /** Set by the first call that timed out: why this connection is considered stuck. */
  let stuck;
  /**
   * Sends one CDP command and resolves with its reply. Rejects when the socket closes or when no
   * reply comes within `CALL_TIMEOUT_MS` (our own figure: a `Runtime.evaluate` of these small
   * scripts answers in milliseconds, so 20 s means the target is gone or stuck). Without this a
   * destroyed target left the promise pending forever and `run.mjs` never reached its cleanup.
   *
   * After one timeout every later call of this connection rejects at once with `WEBVIEW_STUCK`
   * instead of waiting another 20 s each (issue #93): in the full run of 28/10/2026 that ended in
   * 707.7 s, most steps after the webview got stuck took about 20 s each. A new connection
   * (`openChat`) starts clean. HYPOTHESIS: a webview that timed out once does not answer again; in
   * the two cascades seen, no later call did.
   * A call on a socket that is no longer open rejects at once with "socket closed", not as stuck:
   * `ws.send` on a closed WebSocket does not throw, so it used to wait the 20 s and be told apart
   * from a frozen webview by nothing. VERIFIED with a `node -` probe on Node 24.22, Windows 11
   * (28/10/2026): `send` on a WebSocket in state CLOSED "did not throw".
   * VERIFIED on Windows 11, VS Code 1.143.1 (28/10/2026) by mutation, a call that never answers in
   * step 1 and a second call right after it: the first rejected with "the chat webview stopped
   * answering CDP (CDP Runtime.evaluate timed out after 20000 ms)" and the second with the same
   * message "after 0 ms". Both were caught inside the step (the run then stopped on it, which it no
   * longer does: `run.mjs` diagnoses and reopens, see `diagnoseAfterFailure`). NOT observed: a really frozen webview, a closed socket in a run.
   */
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (stuck !== undefined) {
        reject(new Error(`${WEBVIEW_STUCK} (${stuck})`));
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`CDP ${method}: the webview CDP socket is closed`));
        return;
      }
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        stuck = `CDP ${method} timed out after ${String(CALL_TIMEOUT_MS)} ms`;
        reject(new Error(`${WEBVIEW_STUCK} (${stuck})`));
      }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  await send('Runtime.enable');
  await send('Log.enable');

  /** Evaluates `fn(doc, arg)` in the inner document of the webview. */
  async function inDoc(fn, arg) {
    const expression = `(async () => { const frame = document.querySelector('iframe#active-frame'); const doc = frame && frame.contentDocument; if (!doc) return { __err: 'no inner doc' }; return (${fn.toString()})(doc, ${JSON.stringify(arg ?? null)}); })()`;
    const reply = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (reply.result?.exceptionDetails) {
      throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 400));
    }
    return reply.result?.result?.value;
  }

  // The target exists before its inner document has rendered the app (seen on the first step of a
  // run: `body.innerText` was undefined): wait until `#root` has content.
  const end = Date.now() + timeoutMs;
  for (;;) {
    const ready = await inDoc((doc) => (doc.querySelector('#root')?.childElementCount ?? 0) > 0);
    if (ready === true) break;
    if (Date.now() > end) throw new Error('the chat webview did not render its root');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return {
    inDoc,
    /** Why this connection is stuck (a call timed out), or `undefined` while it answers. */
    stuckReason: () => stuck,
    /** Whether the socket is no longer open: every call then rejects at once with "socket is closed". */
    isClosed: () => ws.readyState !== WebSocket.OPEN,
    close: () => {
      ws.close();
    },
  };
}
