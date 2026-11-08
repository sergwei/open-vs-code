// Protects the bridge of the Quick start view: the listener exists BEFORE `home.ready` leaves (the
// host does not queue its answer), messages keep their order inside one frame, and a message that
// fails the guard is dropped. Provenance: fabricated messages, a mocked `vscodeApi`, a hand-driven
// `requestAnimationFrame`; it does not show how VS Code delivers `message` events.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeHostToWebview } from '../../../src/shared/homeProtocol';

const { postMessage } = vi.hoisted(() => ({ postMessage: vi.fn() }));
vi.mock('../vscode', () => ({ vscodeApi: { postMessage } }));

import { connectHomeHost, postHome } from './homeHost';

let frames: (() => void)[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frames.push(callback);
    return frames.length;
  });
  postMessage.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Delivers `data` to the window the way the host's `postMessage` does. */
function deliver(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

describe('connectHomeHost', () => {
  it('posts home.ready only once the listener is up', () => {
    const applied: HomeHostToWebview[] = [];
    postMessage.mockImplementation(() => {
      // A host that answers at once must already find a listener.
      deliver({ type: 'home.result', requestId: 'r', ok: true });
    });
    const stop = connectHomeHost((message) => applied.push(message));
    expect(postMessage).toHaveBeenCalledWith({ type: 'home.ready' });
    frames[0]?.();
    expect(applied.map((m) => m.type)).toEqual(['home.result']);
    stop();
  });

  it('applies a frame in order, drops what fails the guard, and stops listening', () => {
    const applied: string[] = [];
    const stop = connectHomeHost((message) => applied.push(message.type));
    deliver({ type: 'home.result', requestId: 'a', ok: true });
    deliver({ type: 'chat.snapshot' });
    deliver('home.state');
    deliver({ type: 'home.state', state: {} });
    expect(frames).toHaveLength(1); // one frame for the burst
    frames[0]?.();
    expect(applied).toEqual(['home.result', 'home.state']);
    stop();
    deliver({ type: 'home.state', state: {} });
    expect(frames).toHaveLength(1);
  });

  it('postHome goes through the single vscodeApi handle', () => {
    postHome({ type: 'home.mode', mode: 'auto' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'home.mode', mode: 'auto' });
  });
});
