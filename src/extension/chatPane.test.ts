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
  MAX_KEPT_COMPOSES,
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
      { type: 'prompt.compose', text: 'Explain what @a.ts does.', files: [], send: true },
      { type: 'setup.binary', outcome: 'cancelled' },
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

  it('routes a new request to the panes that display it, and its resolution to all', () => {
    // Issue #77 E4: a tab must not get the cards of another chat, but the `*.resolved` of a card
    // it may already hold has to reach it whatever the lineage says.
    expect(
      routeOf({
        type: 'permission.asked',
        permission: { id: 'p', sessionID: 's', action: 'read', resources: [], save: [] },
      }),
    ).toBe('request');
    expect(
      routeOf({
        type: 'form.asked',
        form: { id: 'f', sessionID: 's', title: 'Q', kind: 'question', fields: [] },
      }),
    ).toBe('request');
    expect(
      routeOf({
        type: 'permission.resolved',
        sessionID: 's',
        permissionID: 'p',
        decision: 'once',
      }),
    ).toBe('all');
    expect(
      routeOf({ type: 'form.resolved', sessionID: 's', formID: 'f', outcome: 'answered' }),
    ).toBe('all');
  });
});

describe('ownRequestsOnly', () => {
  it('is false unless the surface says so (the side-bar view and every old test keep all)', () => {
    const log = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    };
    const plain = new ChatPane(1, { post: () => undefined }, log, noHolders);
    const tab = new ChatPane(2, { post: () => undefined, ownRequestsOnly: true }, log, noHolders);
    expect(plain.ownRequestsOnly).toBe(false);
    expect(tab.ownRequestsOnly).toBe(true);
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

// Issue #36: `prompt.compose` is sent now when the surface can take it, kept in order (equal ones
// included, up to the cap) when it cannot, and a stale one is delivered as a draft, not dropped.
// FAKE surface and fake clock, like the blocks above.
describe('prompt.compose kept for a hidden surface', () => {
  const compose = (text: string, send = true): HostToWebview => ({
    type: 'prompt.compose',
    text,
    files: [],
    send,
  });
  const expiredNotice: HostToWebview = {
    type: 'notice',
    level: 'info',
    error: { code: 'ComposeExpired', message: 'The prompt waited too long: it is in the box' },
  };
  /** The fields of {@link compose}, to spread into the message `pane.compose` takes. */
  const asked = (text: string, send = true) => ({ text, files: [], send });

  it('sends now and keeps nothing when the surface can take it', () => {
    const { pane, posted, logs } = setup();
    pane.compose({ type: 'prompt.compose', ...asked('one') });
    expect(posted).toEqual([compose('one')]);
    expect(logs).toContain('info: compose: sent (send=true)');
    expect(pane.flushComposes()).toBe(false);
  });

  it('keeps every compose, equal ones too, and sends them in order after ready', () => {
    const { pane, posted, view, logs } = setup();
    view.ready = false;
    pane.compose({ type: 'prompt.compose', ...asked('one') });
    pane.compose({ type: 'prompt.compose', ...asked('one') });
    pane.compose({ type: 'prompt.compose', ...asked('two') });
    expect(posted).toEqual([]);
    view.ready = true;
    expect(pane.flushComposes()).toBe(true);
    expect(posted).toEqual([compose('one'), compose('one'), compose('two')]);
    expect(logs).toContain('info: compose: kept for the next ready');
    expect(logs).toContain('info: compose: sent after ready (send=true)');
    expect(pane.flushComposes()).toBe(false);
  });

  // Protects W1 (Sergio, 29/10/2026): a compose that falls to the box by age says why. Fake clock.
  it('delivers a compose older than the TTL as a draft instead of dropping it, with a notice', () => {
    vi.useFakeTimers();
    const { pane, posted, view } = setup();
    view.ready = false;
    pane.compose({ type: 'prompt.compose', ...asked('late') });
    vi.advanceTimersByTime(FOCUS_REQUEST_TTL_MS + 1);
    view.ready = true;
    expect(pane.flushComposes()).toBe(true);
    expect(posted).toEqual([compose('late', false), expiredNotice]);
  });

  it('adds no expiry notice to an old compose that was already a draft', () => {
    vi.useFakeTimers();
    const { pane, posted, view } = setup();
    view.ready = false;
    pane.compose({ type: 'prompt.compose', ...asked('dirty', false) });
    vi.advanceTimersByTime(FOCUS_REQUEST_TTL_MS + 1);
    view.ready = true;
    pane.flushComposes();
    expect(posted).toEqual([compose('dirty', false)]);
  });

  // Also asserts that the re-kept compose, once old, is followed by the W1 expiry notice.
  it('keeps it again with its original time when the surface hides during the flush', () => {
    vi.useFakeTimers();
    const { pane, posted, view } = setup();
    view.ready = false;
    pane.compose({ type: 'prompt.compose', ...asked('late') });
    vi.advanceTimersByTime(FOCUS_REQUEST_TTL_MS - 1);
    expect(pane.flushComposes()).toBe(false); // still hidden: kept
    vi.advanceTimersByTime(2); // the original time, not the re-keeping time, is what counts
    view.ready = true;
    expect(pane.flushComposes()).toBe(true);
    expect(posted).toEqual([compose('late', false), expiredNotice]);
  });

  it('forgets the oldest beyond the cap', () => {
    const { pane, posted, view } = setup();
    view.ready = false;
    for (let n = 1; n <= MAX_KEPT_COMPOSES + 2; n++) {
      pane.compose({ type: 'prompt.compose', ...asked(`c${String(n)}`) });
    }
    view.ready = true;
    pane.flushComposes();
    expect(posted).toHaveLength(MAX_KEPT_COMPOSES);
    expect(posted[0]).toEqual(compose('c3'));
  });
});
