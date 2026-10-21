// Protects the webview side of the bridge: messages coming from the host are validated with the
// shallow guard, kept in order and applied in ONE batch per animation frame, and `post` goes
// through the single `vscodeApi` handle (never a second `acquireVsCodeApi`).
//
// Provenance of the data: fabricated protocol messages, a mocked `vscodeApi` and a hand-driven
// `requestAnimationFrame`. It confirms the bridge logic, not that VS Code delivers `message`
// events to a real webview that way (UNVERIFIED until the F5 of issue #14).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '../../src/shared/protocol';

const { postMessage } = vi.hoisted(() => ({ postMessage: vi.fn() }));
vi.mock('./vscode', () => ({ vscodeApi: { postMessage } }));

import { listenHost, post } from './host';

let frames: Array<() => void> = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frames.push(callback);
    return frames.length;
  });
  postMessage.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Delivers a window `message` event the way the webview runtime does. */
function deliver(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

describe('listenHost', () => {
  it('applies valid messages in order after a single animation frame', () => {
    const applied: HostToWebview[] = [];
    const stop = listenHost((message) => applied.push(message));
    deliver({ type: 'connection.state', connection: { state: 'starting' } });
    deliver({ type: 'session.removed', sessionID: 'ses_1' });
    expect(applied).toEqual([]);
    expect(frames).toHaveLength(1);
    frames[0]?.();
    expect(applied.map((m) => m.type)).toEqual(['connection.state', 'session.removed']);
    stop();
  });

  it('drops anything that is not a known host message', () => {
    const applied: HostToWebview[] = [];
    const stop = listenHost((message) => applied.push(message));
    deliver('hello');
    deliver({ type: 'not.a.type' });
    deliver(null);
    expect(frames).toHaveLength(0);
    expect(applied).toEqual([]);
    stop();
  });

  it('stops listening after the returned function is called', () => {
    const applied: HostToWebview[] = [];
    const stop = listenHost((message) => applied.push(message));
    stop();
    deliver({ type: 'session.removed', sessionID: 'ses_1' });
    expect(frames).toHaveLength(0);
  });
});

describe('post', () => {
  it('sends through the vscode api handle', () => {
    post({ type: 'ready' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });
  });
});
