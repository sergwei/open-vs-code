// Protects the two ways the chat webview connection of `test:visual` stops being usable (issue
// #127, after #93): a call that never answers (the connection turns "stuck" and every later call
// rejects at once instead of waiting 20 s each) and a closed socket (rejects at once, and
// `isClosed` says so, which `run.mjs` reads to reopen the chat). The WebSocket and `fetch` are
// fabricated doubles, so this checks the logic of `webviewCdp.mjs`, NOT that a real webview
// behaves so: that part is covered by the mutations M1/M1b of the issue #127 run in a real VS Code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEBVIEW_STUCK, openWebview } from './webviewCdp.mjs';

/** The doubles the tests drive: `silent` makes every send go unanswered. */
const control = { silent: false, socket: undefined };

/** A WebSocket that answers `Runtime.evaluate` with `true` (the root is rendered) unless silent. */
class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  onopen = undefined;
  onclose = undefined;
  onerror = undefined;
  onmessage = undefined;
  constructor() {
    control.socket = this;
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    });
  }
  send(data) {
    if (control.silent) return;
    const { id } = JSON.parse(String(data));
    queueMicrotask(() => {
      this.onmessage?.({ data: JSON.stringify({ id, result: { result: { value: true } } }) });
    });
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
}

beforeEach(() => {
  control.silent = false;
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([
            {
              type: 'iframe',
              url: 'vscode-webview://x/index.html?extensionId=sergwei.open-vs-code&id=a&',
              webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/x',
            },
          ]),
      }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('openWebview connection state', () => {
  it('resolves a call that is answered and reports an open socket', async () => {
    const web = await openWebview(1, []);
    await expect(web.inDoc(() => true)).resolves.toBe(true);
    expect(web.stuckReason()).toBeUndefined();
    expect(web.isClosed()).toBe(false);
  });

  it('turns stuck after one unanswered call and rejects the next one at once', async () => {
    const web = await openWebview(1, []);
    control.silent = true;
    const first = web.inDoc(() => true);
    const firstResult = expect(first).rejects.toThrow(
      `${WEBVIEW_STUCK} (CDP Runtime.evaluate timed out after 20000 ms)`,
    );
    await vi.advanceTimersByTimeAsync(20_000);
    await firstResult;
    expect(web.stuckReason()).toMatch(/timed out after 20000 ms/);
    // The short-circuit: no timer is needed for the second one to reject.
    await expect(web.inDoc(() => true)).rejects.toThrow(WEBVIEW_STUCK);
  });

  it('rejects at once with "socket is closed" once the socket is gone', async () => {
    const web = await openWebview(1, []);
    control.socket.close();
    expect(web.isClosed()).toBe(true);
    await expect(web.inDoc(() => true)).rejects.toThrow(/the webview CDP socket is closed/);
    expect(web.stuckReason()).toBeUndefined();
  });
});
