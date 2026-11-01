// Protects the bridge of the settings tab: the listener exists BEFORE `settings.ready` leaves (the
// host does not queue its answer), messages are validated, kept in order and applied in one batch
// per frame, and `postSettings` goes through the single `vscodeApi` handle.
// Provenance: fabricated messages, a mocked `vscodeApi` and a hand-driven `requestAnimationFrame`;
// it confirms the logic, not how VS Code delivers `message` events (`test:visual` steps 35-36 show
// them arriving in a real tab, see the header of `connectSettingsHost`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsHostToWebview } from '../../../src/shared/settingsProtocol';
import { makeState } from './settingsFixtures';

const { postMessage } = vi.hoisted(() => ({ postMessage: vi.fn() }));
vi.mock('../vscode', () => ({ vscodeApi: { postMessage } }));

import { connectSettingsHost, postSettings } from './settingsHost';

let frames: (() => void)[] = [];

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

describe('connectSettingsHost', () => {
  it('posts settings.ready once the listener is up', () => {
    const applied: SettingsHostToWebview[] = [];
    postMessage.mockImplementation(() => {
      // A host that answers at once must already find a listener.
      deliver({ type: 'settings.state', state: makeState() });
    });
    const stop = connectSettingsHost((message) => applied.push(message));
    expect(postMessage).toHaveBeenCalledWith({ type: 'settings.ready' });
    frames[0]?.();
    expect(applied.map((m) => m.type)).toEqual(['settings.state']);
    postMessage.mockReset();
    stop();
  });

  it('applies valid messages in order after one frame and drops anything else', () => {
    const applied: SettingsHostToWebview[] = [];
    const stop = connectSettingsHost((message) => applied.push(message));
    deliver({ type: 'settings.state', state: makeState() });
    deliver({ type: 'settings.notice', notice: { integrationID: 'a', kind: 'connected' } });
    deliver({ type: 'connection.state' });
    deliver('hello');
    deliver(null);
    expect(applied).toEqual([]);
    expect(frames).toHaveLength(1);
    frames[0]?.();
    expect(applied.map((m) => m.type)).toEqual(['settings.state', 'settings.notice']);
    stop();
  });

  it('stops listening after the returned function is called', () => {
    const applied: SettingsHostToWebview[] = [];
    const stop = connectSettingsHost((message) => applied.push(message));
    stop();
    deliver({ type: 'settings.state', state: makeState() });
    expect(frames).toHaveLength(0);
  });
});

describe('postSettings', () => {
  it('sends the message through the vscodeApi handle', () => {
    postSettings({ type: 'settings.refresh' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'settings.refresh' });
  });
});
