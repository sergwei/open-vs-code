// Protects the per-surface rules that used to live inside `ChatController` and now belong to
// `ChatPane`: which message goes to whom (`routeOf`), the chips and `ui.command`s kept for a
// document that is not there yet (and the cap, the dedupe and the TTL of what is kept), and a
// `post` that never throws.
//
// Provenance: a FAKE surface and a fake clock (`vi.useFakeTimers`); nothing here talks to VS Code
// or a server. The wording of the log lines is the one the integration suite waits for. These
// tests confirm the pane's logic; the behaviour inside a real hidden view is covered by
// `test:visual` step 22 (not re-run by this file).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostToWebview } from '../shared/protocol';
import {
  ChatPane,
  FOCUS_REQUEST_TTL_MS,
  MAX_KEPT_MENU_MESSAGES,
  routeOf,
  type PaneHolders,
} from './chatPane';

afterEach(() => {
  vi.useRealTimers();
});

/** Holders that are never used by these tests. */
const noHolders: PaneHolders = () => ({
  diffs: {} as never,
  reverts: {} as never,
});

/** A pane over a fake surface; `ready` models a hidden view when set to false. */
function setup() {
  const posted: HostToWebview[] = [];
  const logs: string[] = [];
  const view = { ready: true, throws: false };
  const pane = new ChatPane(
    7,
    {
      post: (message) => {
        if (view.throws) throw new Error('boom');
        posted.push(message);
      },
      canDeliver: () => view.ready,
    },
    {
      info: (m) => logs.push(`info: ${m}`),
      warn: (m) => logs.push(`warn: ${m}`),
      error: (m) => logs.push(`error: ${m}`),
      debug: (m) => logs.push(`debug: ${m}`),
    },
    noHolders,
  );
  return { pane, posted, logs, view };
}

const chip = (n: number): HostToWebview => ({
  type: 'attachments.picked',
  requestId: `menu-${String(n)}`,
  files: [],
});

describe('routeOf', () => {
  it('sends the content of a session to the panes that show it', () => {
    for (const message of [
      { type: 'message.removed', sessionID: 's', messageID: 'm' },
      {
        type: 'part.delta',
        sessionID: 's',
        messageID: 'm',
        partID: 'p',
        field: 'text',
        delta: 'x',
      },
      { type: 'session.diff', sessionID: 's', files: [] },
      { type: 'session.revert', sessionID: 's' },
    ] satisfies HostToWebview[]) {
      expect(routeOf(message)).toBe('session');
    }
  });

  it('keeps the answers to a request for the pane that asked', () => {
    for (const message of [
      { type: 'request.result', requestId: 'r' },
      { type: 'files.found', requestId: 'r', query: 'q', files: [] },
      {
        type: 'sessions.page',
        requestId: 'r',
        search: '',
        sessions: [],
        append: false,
        hasMore: false,
      },
      { type: 'attachments.picked', requestId: 'r', files: [] },
      { type: 'ui.command', command: 'prompt.focus' },
    ] satisfies HostToWebview[]) {
      expect(routeOf(message)).toBe('origin');
    }
  });

  it('broadcasts the news of the location', () => {
    for (const message of [
      { type: 'connection.state', connection: { state: 'starting' } },
      { type: 'session.status', sessionID: 's', status: { type: 'idle' } },
      { type: 'session.removed', sessionID: 's' },
      { type: 'notice', level: 'info', error: { code: 'X', message: 'y' } },
    ] satisfies HostToWebview[]) {
      expect(routeOf(message)).toBe('all');
    }
  });
});

describe('post', () => {
  it('does not throw when the surface does, and logs it', () => {
    const { pane, view, logs } = setup();
    view.throws = true;
    expect(() => {
      pane.post(chip(1));
    }).not.toThrow();
    expect(logs).toEqual(['error: posting to the webview failed: Error: boom']);
  });

  it('deliverable follows the surface, and means always when the surface has no opinion', () => {
    const { pane, view } = setup();
    expect(pane.deliverable()).toBe(true);
    view.ready = false;
    expect(pane.deliverable()).toBe(false);
    const quiet = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    };
    const open = new ChatPane(1, { post: () => undefined }, quiet, noHolders);
    expect(open.deliverable()).toBe(true);
  });
});

describe('chips kept for a hidden surface', () => {
  it('delivers now when it can, keeps when it cannot, and flushes in order', () => {
    const { pane, posted, view } = setup();
    pane.postOrKeep(chip(1));
    view.ready = false;
    pane.postOrKeep(chip(2));
    pane.postOrKeep(chip(3));
    expect(posted).toEqual([chip(1)]);
    view.ready = true;
    pane.flushUndeliveredMenu();
    expect(posted).toEqual([chip(1), chip(2), chip(3)]);
  });

  it('keeps them again when the surface hides during the flush', () => {
    const { pane, posted, view } = setup();
    view.ready = false;
    pane.postOrKeep(chip(1));
    pane.flushUndeliveredMenu(); // still hidden: back into the queue
    expect(posted).toEqual([]);
    view.ready = true;
    pane.flushUndeliveredMenu();
    expect(posted).toEqual([chip(1)]);
  });

  it('forgets the oldest beyond the cap', () => {
    const { pane, posted, view } = setup();
    view.ready = false;
    for (let n = 1; n <= MAX_KEPT_MENU_MESSAGES + 2; n++) pane.postOrKeep(chip(n));
    view.ready = true;
    pane.flushUndeliveredMenu();
    expect(posted).toHaveLength(MAX_KEPT_MENU_MESSAGES);
    expect(posted[0]).toEqual(chip(3));
  });
});

describe('ui commands', () => {
  it('sends now and keeps nothing when the surface can take it', () => {
    const { pane, posted, logs } = setup();
    pane.runUiCommand('session.new');
    expect(posted).toEqual([{ type: 'ui.command', command: 'session.new' }]);
    expect(logs).toContain('info: ui command session.new: sent');
    expect(pane.flushUiCommands()).toBe(false);
  });

  it('keeps a command once, sends it after ready and says it posted', () => {
    const { pane, posted, view, logs } = setup();
    view.ready = false;
    pane.runUiCommand('prompt.focus');
    pane.runUiCommand('prompt.focus'); // not queued twice
    view.ready = true;
    expect(pane.flushUiCommands()).toBe(true);
    expect(posted).toEqual([{ type: 'ui.command', command: 'prompt.focus' }]);
    expect(logs).toContain('info: ui command prompt.focus: kept for the next ready');
    expect(logs).toContain('info: ui command prompt.focus: sent after ready');
  });

  it('drops a command older than the TTL', () => {
    vi.useFakeTimers();
    const { pane, posted, view } = setup();
    view.ready = false;
    pane.runUiCommand('session.stop');
    vi.advanceTimersByTime(FOCUS_REQUEST_TTL_MS + 1);
    view.ready = true;
    expect(pane.flushUiCommands()).toBe(false);
    expect(posted).toEqual([]);
  });

  it('keeps a command again, with its original time, when the surface hides during the flush', () => {
    vi.useFakeTimers();
    const { pane, posted, view } = setup();
    view.ready = false;
    pane.runUiCommand('session.new');
    vi.advanceTimersByTime(FOCUS_REQUEST_TTL_MS - 1);
    expect(pane.flushUiCommands()).toBe(false); // still hidden: kept
    vi.advanceTimersByTime(2); // the original time, not the re-keeping time, is what counts
    view.ready = true;
    expect(pane.flushUiCommands()).toBe(false);
    expect(posted).toEqual([]);
  });
});
