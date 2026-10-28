// Protects E2 (issue #85, P3=2) and issue #87: the native failure notifications are skipped only
// while the chat shows the problem itself, and always shown otherwise; a failure that happens
// before the chat's `ready` waits for it up to a grace period instead of racing it. Provenance:
// pure logic with fabricated callbacks and fake timers; it does not prove that VS Code stays
// silent in a real window (`test:visual` step 0 does). The race cases come from the capture where
// the guide and the native warning appeared together.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_SHOW_GRACE_MS,
  createChatSurfaceGate,
  notifyUnlessChatShows,
} from './chatSurfaceGate';

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

describe('notifyUnlessChatShows (issue #87 race)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A gate whose chat is "ready" when `state.ready` is true; the problem is shown when ready AND `state.problem`. */
  function setup(initial: { ready: boolean; problem: boolean; current?: boolean }) {
    const state = {
      ready: initial.ready,
      problem: initial.problem,
      current: initial.current ?? true,
    };
    const gate = createChatSurfaceGate();
    gate.attach(() => state.ready);
    const notify = vi.fn();
    const run = () =>
      notifyUnlessChatShows({
        gate,
        showsProblem: () => state.ready && state.problem,
        stillCurrent: () => state.current,
        graceMs: CHAT_SHOW_GRACE_MS,
        notify,
      });
    return { state, gate, notify, run };
  }

  it('shows nothing when the chat becomes ready within the grace period', async () => {
    const { state, gate, notify, run } = setup({ ready: false, problem: true });
    const result = run();
    await vi.advanceTimersByTimeAsync(500);
    state.ready = true;
    gate.changed();
    expect(await result).toBe(false);
    await vi.advanceTimersByTimeAsync(CHAT_SHOW_GRACE_MS * 2);
    expect(notify).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows the notification once, exactly when the grace period ends without a ready', async () => {
    const { notify, run } = setup({ ready: false, problem: true });
    const result = run();
    await vi.advanceTimersByTimeAsync(CHAT_SHOW_GRACE_MS - 1);
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHAT_SHOW_GRACE_MS * 2);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when a newer result replaced this one while it waited', async () => {
    const { state, notify, run } = setup({ ready: false, problem: true });
    const result = run();
    state.current = false;
    await vi.advanceTimersByTimeAsync(CHAT_SHOW_GRACE_MS);
    expect(await result).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('shows nothing and leaves no timer when the chat already shows the problem', async () => {
    const { notify, run } = setup({ ready: true, problem: true });
    expect(await run()).toBe(false);
    expect(notify).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps waiting when the gate changes but the chat is still not ready', async () => {
    const { gate, notify, run } = setup({ ready: false, problem: true });
    const result = run();
    await vi.advanceTimersByTimeAsync(1000);
    gate.changed();
    await vi.advanceTimersByTimeAsync(CHAT_SHOW_GRACE_MS - 1001);
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('shows the notification when the chat is ready but does not show this problem', async () => {
    const { notify, run } = setup({ ready: true, problem: false });
    expect(await run()).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows the notification at once when no chat is registered (no gate)', async () => {
    const notify = vi.fn();
    const shown = await notifyUnlessChatShows({
      gate: undefined,
      showsProblem: () => false,
      stillCurrent: () => true,
      graceMs: CHAT_SHOW_GRACE_MS,
      notify,
    });
    expect(shown).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
