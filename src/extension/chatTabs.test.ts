// Protects the rules of the editor-tab registry (issue #77) that break silently: which tab a
// command goes to (active, else most recent), the column of a new tab and of the files opened from a
// tab (decision Q5=1), and the tab title taken from the messages posted to its pane (T4=1). The
// session-to-pane dedupe is NOT here: it reads the controller (`ChatController.sessionOf`).
//
// Provenance: fabricated registry events and hand-made `snapshot` / `session.upserted` messages in
// the shape of `src/shared/protocol.ts`; no VS Code and no server. It proves the logic, not that a
// real `WebviewPanel` reports its state the way these calls assume.
import { describe, expect, it } from 'vitest';
import type { HostToWebview } from '../shared/protocol';
import type { SessionSummary } from '../shared/model';
import { ChatTabs } from './chatTabs';

const summary = (id: string, title?: string): SessionSummary => ({
  id,
  ...(title === undefined ? {} : { title }),
  createdAt: 1,
  updatedAt: 2,
});

/** A `snapshot` message with `sessions` listed and `open` (a session id) open, or none. */
const snapshot = (sessions: SessionSummary[], open?: string): HostToWebview => ({
  type: 'snapshot',
  snapshot: {
    sessions,
    statuses: {},
    ...(open === undefined ? {} : { open: { sessionID: open, messages: [], parts: {} } }),
    requests: { permissions: [], forms: [] },
    resolutions: [],
  },
});

const upserted = (session: SessionSummary): HostToWebview => ({
  type: 'session.upserted',
  session,
});

describe('a tab seeded for a restore', () => {
  // Protects the Reload Window restore (issue #77, Q4=1): the persisted title shows until the
  // first real snapshot, which then decides. Provenance: fabricated messages.
  it('starts with the seeded title and session, and the first snapshot replaces them', () => {
    const tabs = new ChatTabs();
    tabs.add(1, 2, { sessionID: 'ses_a', title: 'Fix the build' });
    expect(tabs.titleOf(1)).toBe('Fix the build');
    // The session is listed: the title comes from the row.
    expect(tabs.observe(1, snapshot([summary('ses_a', 'Renamed')], 'ses_a'))).toBe(true);
    expect(tabs.titleOf(1)).toBe('Renamed');
  });

  it('keeps the seeded title when the snapshot opens the same session without a row', () => {
    const tabs = new ChatTabs();
    tabs.add(1, undefined, { sessionID: 'ses_a', title: 'Fix the build' });
    tabs.observe(1, snapshot([], 'ses_a'));
    expect(tabs.titleOf(1)).toBe('Fix the build');
  });

  it('reads Untitled session when the snapshot has no session, or another one without a row', () => {
    const none = new ChatTabs();
    none.add(1, undefined, { sessionID: 'ses_a', title: 'Gone' });
    expect(none.observe(1, snapshot([]))).toBe(true);
    expect(none.titleOf(1)).toBe('Untitled session');
    const other = new ChatTabs();
    other.add(1, undefined, { sessionID: 'ses_a', title: 'Gone' });
    other.observe(1, snapshot([], 'ses_b'));
    expect(other.titleOf(1)).toBe('Untitled session');
  });

  it('falls back to Untitled session for a blank seed title', () => {
    const tabs = new ChatTabs();
    tabs.add(1, undefined, { title: '   ' });
    expect(tabs.titleOf(1)).toBe('Untitled session');
  });

  it('leaves the most recent as the last one activated, whatever the restore order', () => {
    const tabs = new ChatTabs();
    tabs.add(3, 2, { sessionID: 'c' });
    tabs.add(1, 2, { sessionID: 'a' });
    tabs.add(2, 2, { sessionID: 'b' });
    tabs.setActive(1, true);
    expect(tabs.recent()).toEqual([1, 2, 3]);
    expect(tabs.commandTarget()).toBe(1);
  });
});

describe('recency and the target of a command', () => {
  it('orders the tabs by activation, most recent first', () => {
    const tabs = new ChatTabs();
    tabs.add(1);
    tabs.add(2);
    tabs.add(3);
    expect(tabs.recent()).toEqual([3, 2, 1]);
    tabs.setActive(1, true);
    expect(tabs.recent()).toEqual([1, 3, 2]);
  });

  it('sends a command to the active tab, else the most recent, else nobody', () => {
    const tabs = new ChatTabs();
    expect(tabs.commandTarget()).toBeUndefined();
    tabs.add(1);
    tabs.add(2);
    expect(tabs.commandTarget()).toBe(2);
    tabs.setActive(1, true);
    expect(tabs.commandTarget()).toBe(1);
    tabs.setActive(2, true);
    expect(tabs.commandTarget()).toBe(2);
  });

  it('falls back to the most recent tab when the active one is deactivated', () => {
    const tabs = new ChatTabs();
    tabs.add(1);
    tabs.add(2);
    tabs.setActive(1, true);
    tabs.setActive(1, false);
    expect(tabs.commandTarget()).toBe(1);
    tabs.remove(1);
    expect(tabs.commandTarget()).toBe(2);
  });

  it('keeps one active tab at a time and ignores unknown ids', () => {
    const tabs = new ChatTabs();
    tabs.add(1);
    tabs.add(2);
    tabs.setActive(1, true);
    tabs.setActive(2, true);
    tabs.setActive(99, true);
    tabs.setColumn(99, 3);
    tabs.setActive(2, false);
    // 2 was active last, so it is the most recent, but neither is active now.
    expect(tabs.commandTarget()).toBe(2);
    expect(tabs.has(99)).toBe(false);
    expect(tabs.remove(99)).toBe(false);
  });
});

describe('columns', () => {
  it('opens the first tab beside the active group', () => {
    expect(new ChatTabs().columnForNewTab()).toBe('beside');
  });

  it('opens the next tabs in the column of the most recent tab', () => {
    const tabs = new ChatTabs();
    tabs.add(1, 2);
    expect(tabs.columnForNewTab()).toBe(2);
    tabs.add(2, 3);
    expect(tabs.columnForNewTab()).toBe(3);
    tabs.setActive(1, true);
    expect(tabs.columnForNewTab()).toBe(2);
  });

  it('follows a tab the user dragged to another column', () => {
    const tabs = new ChatTabs();
    tabs.add(1, 2);
    tabs.setColumn(1, 1);
    expect(tabs.columnForNewTab()).toBe(1);
  });

  it('opens beside when the most recent tab has an unknown column', () => {
    const tabs = new ChatTabs();
    tabs.add(1);
    expect(tabs.columnForNewTab()).toBe('beside');
  });

  it('sends files to the last text editor column unless a chat tab is in it', () => {
    const tabs = new ChatTabs();
    expect(tabs.columnForFiles(undefined)).toBe('beside');
    expect(tabs.columnForFiles(1)).toBe(1);
    tabs.add(1, 2);
    expect(tabs.columnForFiles(1)).toBe(1);
    expect(tabs.columnForFiles(2)).toBe('beside');
  });
});

describe('tab titles', () => {
  it('starts as the empty title', () => {
    const tabs = new ChatTabs();
    tabs.add(1);
    expect(tabs.titleOf(1)).toBe('Untitled session');
    expect(tabs.titleOf(99)).toBeUndefined();
  });

  it('takes session and title from a snapshot, with and without an open session', () => {
    const tabs = new ChatTabs();
    tabs.add(1);
    expect(tabs.observe(1, snapshot([summary('a', 'Fix login')], 'a'))).toBe(true);
    expect(tabs.titleOf(1)).toBe('Fix login');
    // Same session again: nothing changed. Then the session closes: the title goes back.
    expect(tabs.observe(1, snapshot([summary('a', 'Fix login')], 'a'))).toBe(false);
    expect(tabs.observe(1, snapshot([summary('a', 'Fix login')]))).toBe(true);
    expect(tabs.titleOf(1)).toBe('Untitled session');
  });

  it('renames the tab on a session.upserted of its own session and ignores another one', () => {
    const tabs = new ChatTabs();
    tabs.add(1);
    tabs.observe(1, snapshot([summary('a')], 'a'));
    expect(tabs.observe(1, upserted(summary('b', 'Other')))).toBe(false);
    expect(tabs.titleOf(1)).toBe('Untitled session');
    expect(tabs.observe(1, upserted(summary('a', 'Refactor')))).toBe(true);
    expect(tabs.titleOf(1)).toBe('Refactor');
  });

  it('falls back to the empty title for a blank title', () => {
    const tabs = new ChatTabs();
    tabs.add(1);
    tabs.observe(1, snapshot([summary('a', 'Named')], 'a'));
    tabs.observe(1, upserted(summary('a', '   ')));
    expect(tabs.titleOf(1)).toBe('Untitled session');
  });

  it('retitles a lazy tab when its first prompt binds a session', () => {
    const tabs = new ChatTabs();
    tabs.add(1);
    expect(tabs.observe(1, snapshot([]))).toBe(false);
    expect(tabs.observe(1, snapshot([summary('new', 'First prompt')], 'new'))).toBe(true);
    expect(tabs.titleOf(1)).toBe('First prompt');
  });

  it('keeps the title when a snapshot of the same session does not list it', () => {
    const tabs = new ChatTabs();
    tabs.add(1);
    tabs.observe(1, snapshot([summary('a', 'Kept')], 'a'));
    expect(tabs.observe(1, snapshot([], 'a'))).toBe(false);
    expect(tabs.titleOf(1)).toBe('Kept');
  });

  it('reports no change for an unrelated message or an unknown pane', () => {
    const tabs = new ChatTabs();
    tabs.add(1);
    expect(tabs.observe(1, { type: 'session.removed', sessionID: 'x' })).toBe(false);
    expect(tabs.observe(99, snapshot([], undefined))).toBe(false);
  });
});
