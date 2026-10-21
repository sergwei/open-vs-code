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

/** Finds the webview target of the extension, polling the debugging endpoint. */
async function webviewTarget(port, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(port)}/json`)).json();
      const target = list.find(
        (entry) => entry.type === 'iframe' && entry.url.includes(`extensionId=${EXTENSION_ID}`),
      );
      if (target) return target;
    } catch {
      // The endpoint may not answer while VS Code is reloading: keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('the chat webview target did not appear');
}

/**
 * Connects to the webview target and returns `{ inDoc, close }`.
 *
 * `inDoc(fn, arg)` evaluates `fn(document, arg)` inside the inner frame and returns its JSON-able
 * result. `fn` is serialized with `toString()`, so it must be self-contained (no closures); `arg`
 * must be JSON-able. `logs` receives one line per `Log` entry, console call and exception
 * (`[exception] ...`, `[error] ...`), which `run.mjs` filters for CSP violations and exceptions.
 */
export async function openWebview(port, logs, timeoutMs = 30_000) {
  const target = await webviewTarget(port, timeoutMs);
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
  /**
   * Sends one CDP command and resolves with its reply. Rejects when the socket closes or when no
   * reply comes within `CALL_TIMEOUT_MS` (our own figure: a `Runtime.evaluate` of these small
   * scripts answers in milliseconds, so 20 s means the target is gone or stuck). Without this a
   * destroyed target left the promise pending forever and `run.mjs` never reached its cleanup.
   */
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${String(CALL_TIMEOUT_MS)} ms`));
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
    close: () => {
      ws.close();
    },
  };
}
