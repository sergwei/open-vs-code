// Protects E2 (issue #85, P3=2): the native failure notifications are skipped only while the chat
// shows the problem itself, and always shown otherwise. Provenance: pure logic with fabricated
// callbacks; it does not prove that VS Code stays silent in a real window.
import { describe, expect, it, vi } from 'vitest';
import { createChatSurfaceGate, notifyUnlessChatShows } from './chatSurfaceGate';

describe('chat surface gate', () => {
  it('is closed until a chat attaches (the lifecycle registers before the chat)', () => {
    expect(createChatSurfaceGate().isShowing()).toBe(false);
  });

  it('follows the attached chat live, not the value it had when attached', () => {
    const gate = createChatSurfaceGate();
    let showing = false;
    gate.attach(() => showing);
    expect(gate.isShowing()).toBe(false);
    showing = true;
    expect(gate.isShowing()).toBe(true);
  });
});

describe('notifyUnlessChatShows', () => {
  it('shows the notification when the chat is hidden or not ready yet (the race)', () => {
    const notify = vi.fn();
    expect(notifyUnlessChatShows(() => false, notify)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('skips the notification while the chat shows the problem', () => {
    const notify = vi.fn();
    expect(notifyUnlessChatShows(() => true, notify)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});
