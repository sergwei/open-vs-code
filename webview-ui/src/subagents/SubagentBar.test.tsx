// Protects the subagent bar (issue #189, decisions P2/P3 of Sergio): it exists only while a child
// works or waits and counts those children; its header is ONE string with the right k and m; the
// disclosure wiring (`aria-expanded`, `aria-controls`); one row per child with its tool and time;
// Answer only for a waiting child and through `requestFocus`; Stop and Stop all send the right
// `subagent.stop` (the second without `sessionID`) and lock with `aria-disabled`, never `disabled`;
// a child that arrives moves no focus; the one-second tick runs only while a child is active; the
// bar does not blink away between a child's creation and its start (issue #200).
//
// Provenance: FABRICATED store data (`monitorTesting.tsx`) in jsdom with fake timers. They confirm
// the component logic, not the host contract, the layout or the themes (`test:visual` step 51 covers
// those in a real VS Code: see the header of `SubagentBar.tsx`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { must } from '../testing';
import { SubagentBar } from './SubagentBar';
import {
  addChild,
  addSubagentBlock,
  digestTool,
  formOf,
  mountWithMonitor,
  PARENT,
  permissionOf,
  type MonitorMount,
} from './monitorTesting';

let mounted: MonitorMount | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});
afterEach(() => {
  vi.restoreAllMocks();
  focusInput.mockReset();
  mounted?.dispose();
  mounted = undefined;
  vi.useRealTimers();
});

const focusInput = vi.fn();
const mountBar = (): MonitorMount => {
  mounted = mountWithMonitor(() => <SubagentBar focusInput={focusInput} />);
  return mounted;
};
const bar = (): HTMLElement | null => document.body.querySelector('.subagent-bar');
const toggle = (): HTMLButtonElement =>
  must<HTMLButtonElement>(document.body, '.subagent-bar-toggle');
const button = (name: string): HTMLButtonElement => {
  const found = [...document.body.querySelectorAll('.subagent-bar button')].find(
    (b) => b.textContent === name || b.getAttribute('aria-label') === name,
  );
  if (found === undefined) throw new Error(`no button named ${name}`);
  return found as HTMLButtonElement;
};

describe('SubagentBar visibility', () => {
  it('is absent with no children and with only finished ones', () => {
    const m = mountBar();
    expect(bar()).toBeNull();
    addChild(m.store, 'c1', { status: { type: 'idle' }, outcome: 'succeeded' });
    expect(bar()).toBeNull();
  });

  it('appears while a child works and goes away when the last one ends', () => {
    const m = mountBar();
    addChild(m.store, 'c1');
    expect(bar()).not.toBeNull();
    m.store.apply({ type: 'session.status', sessionID: 'c1', status: { type: 'idle' } });
    expect(bar()).toBeNull();
  });

  it('ignores the children of another session', () => {
    const m = mountBar();
    addChild(m.store, 'c1');
    m.store.apply({
      type: 'session.upserted',
      session: { id: 'c2', parentID: 'someone_else', createdAt: 3, updatedAt: 3 },
    });
    m.store.apply({ type: 'session.status', sessionID: 'c2', status: { type: 'busy' } });
    expect(toggle().textContent).toBe('Subagents · 1 · 1 working');
  });

  // Protects issue #200 (the bar vanished ~0.5 s at the start of a CREW turn). The order is the one
  // seen in the fake server's event timeline (10/11/2026): A and B created, C created, C starts and
  // fails, A and B start 517 ms later. FABRICATED store data: it proves the join, not the real
  // server's timing.
  it('keeps the bar while a child is created but has not started (#200 sequence)', () => {
    const m = mountBar();
    const block = (child: string, status: 'running' | 'error'): void => {
      addSubagentBlock(m.store, {
        messageID: 'msg_1',
        toolID: `call_${child}`,
        childID: child,
        status,
        description: `task ${child}`,
      });
    };
    addChild(m.store, 'ses_a', { status: null });
    block('ses_a', 'running');
    addChild(m.store, 'ses_b', { status: null });
    block('ses_b', 'running');
    addChild(m.store, 'ses_c', { status: null });
    block('ses_c', 'running');
    const section = must<HTMLElement>(document.body, '.subagent-bar');
    expect(toggle().textContent).toBe('Subagents · 3 · 3 working');
    m.store.apply({ type: 'session.status', sessionID: 'ses_c', status: { type: 'busy' } });
    expect(bar()).toBe(section);
    m.store.apply({
      type: 'session.status',
      sessionID: 'ses_c',
      status: { type: 'error', error: { code: 'x', message: 'boom' } },
    });
    block('ses_c', 'error');
    // C failed and A and B have not started: the gap in which the bar used to disappear.
    expect(bar()).toBe(section);
    expect(toggle().textContent).toBe('Subagents · 2 · 2 working');
    m.store.apply({ type: 'session.status', sessionID: 'ses_a', status: { type: 'busy' } });
    m.store.apply({ type: 'session.status', sessionID: 'ses_b', status: { type: 'busy' } });
    expect(bar()).toBe(section);
    expect(toggle().textContent).toBe('Subagents · 2 · 2 working');
  });

  it('has no bar for a starting child when the parent is idle', () => {
    const m = mountBar();
    m.store.apply({ type: 'session.status', sessionID: PARENT, status: { type: 'idle' } });
    addChild(m.store, 'ses_a', { status: null });
    addSubagentBlock(m.store, {
      messageID: 'msg_1',
      toolID: 'call_a',
      childID: 'ses_a',
      status: 'running',
    });
    expect(bar()).toBeNull();
  });

  it('has no bar for a child whose subagent block completed and has no status', () => {
    const m = mountBar();
    addChild(m.store, 'ses_a', { status: null });
    addSubagentBlock(m.store, {
      messageID: 'msg_1',
      toolID: 'call_a',
      childID: 'ses_a',
      status: 'completed',
    });
    expect(bar()).toBeNull();
  });
});

describe('SubagentBar summary and disclosure', () => {
  it('writes the summary as ONE string with the working and waiting counts', () => {
    const m = mountBar();
    addChild(m.store, 'c1');
    addChild(m.store, 'c2');
    addChild(m.store, 'c3');
    m.store.apply({ type: 'permission.asked', permission: permissionOf('c3') });
    expect(toggle().textContent).toBe('Subagents · 3 · 2 working · 1 waiting for your answer');
    expect(toggle().childNodes.length).toBe(2); // the chevron and ONE text node
  });

  it('only says "waiting" when every child waits', () => {
    const m = mountBar();
    addChild(m.store, 'c1');
    m.store.apply({ type: 'form.asked', form: formOf('c1') });
    expect(toggle().textContent).toBe('Subagents · 1 · 1 waiting for your answer');
  });

  it('is folded by default and wires aria-expanded and aria-controls when opened', () => {
    const m = mountBar();
    addChild(m.store, 'c1');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().hasAttribute('aria-controls')).toBe(false);
    expect(document.body.querySelector('.subagent-rows')).toBeNull();
    toggle().click();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const id = toggle().getAttribute('aria-controls');
    expect(id).toBeTruthy();
    expect(document.getElementById(id ?? '')?.querySelector('ul[role="list"]')).not.toBeNull();
  });
});

describe('SubagentBar rows', () => {
  it('lists one row per active child with agent, task, current tool, time and count', () => {
    const m = mountBar();
    addChild(m.store, 'c1', {
      title: 'Find the bug',
      agent: 'explore',
      activity: {
        since: Date.now() - 65_000,
        toolCount: 3,
        recent: [digestTool('t1'), digestTool('t2', 'running', 'src/b.ts')],
      },
    });
    addChild(m.store, 'c2', { title: 'Write docs', agent: 'general' });
    toggle().click();
    const rows = [...document.body.querySelectorAll('.subagent-row')];
    expect(rows).toHaveLength(2);
    const first = rows[0] as HTMLElement;
    expect(must(first, '.subagent-agent').textContent).toBe('explore');
    expect(must(first, '.subagent-task').textContent).toBe('Find the bug');
    expect(must(first, '.subagent-current').textContent).toBe('Read src/b.ts · running');
    expect(must(first, '.subagent-elapsed').textContent).toBe('1:05');
    expect(must(first, '.subagent-elapsed').getAttribute('aria-hidden')).toBe('true');
    expect(must(first, '.subagent-count').textContent).toBe('3 tools');
  });

  it('names each button after its task', () => {
    const m = mountBar();
    addChild(m.store, 'c1', { title: 'Find the bug' });
    toggle().click();
    expect(button('Open subagent session Find the bug')).toBeTruthy();
    expect(button('Stop Find the bug')).toBeTruthy();
    expect(button('Stop all')).toBeTruthy();
  });

  it('opens the child session', () => {
    const m = mountBar();
    addChild(m.store, 'c1', { title: 'Find the bug' });
    toggle().click();
    button('Open subagent session Find the bug').click();
    expect(m.opened).toEqual(['c1']);
  });

  it('offers Answer only for a waiting child and asks the dock to focus its request', () => {
    const m = mountBar();
    addChild(m.store, 'c1', { title: 'Waits' });
    addChild(m.store, 'c2', { title: 'Works' });
    m.store.apply({ type: 'permission.asked', permission: permissionOf('c1', 'per_9') });
    toggle().click();
    expect(() => button('Answer Works')).toThrow();
    button('Answer Waits').click();
    expect(m.store.state.focusTarget).toEqual({
      kind: 'permission',
      sessionID: 'c1',
      id: 'per_9',
    });
  });

  it('puts the question of a waiting child as a form target', () => {
    const m = mountBar();
    addChild(m.store, 'c1', { title: 'Asks' });
    m.store.apply({ type: 'form.asked', form: formOf('c1', 'frm_4') });
    toggle().click();
    button('Answer Asks').click();
    expect(m.store.state.focusTarget).toEqual({ kind: 'form', sessionID: 'c1', id: 'frm_4' });
  });
});

describe('SubagentBar stopping', () => {
  it('Stop sends one subagent.stop for that child only and locks it with aria-disabled', () => {
    const m = mountBar();
    addChild(m.store, 'c1', { title: 'One' });
    addChild(m.store, 'c2', { title: 'Two' });
    toggle().click();
    const stop = button('Stop One');
    stop.focus();
    stop.click();
    expect(m.stops).toEqual([
      { type: 'subagent.stop', requestId: 'stop_1', parentID: PARENT, sessionID: 'c1' },
    ]);
    expect(stop.getAttribute('aria-disabled')).toBe('true');
    expect(stop.hasAttribute('disabled')).toBe(false);
    expect(stop.textContent).toBe('Stopping…');
    expect(document.activeElement).toBe(stop);
    expect(button('Stop Two').hasAttribute('aria-disabled')).toBe(false);
    stop.click();
    expect(m.stops).toHaveLength(1);
    m.store.apply({ type: 'request.result', requestId: 'stop_1' });
    expect(stop.getAttribute('aria-disabled')).toBeNull();
  });

  it('Stop all sends ONE message without sessionID and never names the parent as a child', () => {
    const m = mountBar();
    addChild(m.store, 'c1', { title: 'One' });
    addChild(m.store, 'c2', { title: 'Two' });
    toggle().click();
    const all = button('Stop all');
    all.click();
    expect(m.stops).toEqual([{ type: 'subagent.stop', requestId: 'stop_1', parentID: PARENT }]);
    expect(all.getAttribute('aria-disabled')).toBe('true');
    expect(all.textContent).toBe('Stopping…');
    expect(m.store.state.stopping).toEqual({ c1: 'stop_1', c2: 'stop_1' });
  });
});

describe('SubagentBar focus, ticking and markup', () => {
  it('keeps the focus on the prompt when a child arrives or changes', () => {
    const input = document.createElement('textarea');
    document.body.append(input);
    input.focus();
    const m = mountBar();
    addChild(m.store, 'c1', { title: 'One' });
    toggle().click();
    input.focus();
    addChild(m.store, 'c2', { title: 'Two' });
    m.store.apply({ type: 'permission.asked', permission: permissionOf('c2') });
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  /**
   * Protects review B1: the rows keep their identity while OTHER children change. The focus is on
   * "Stop One" and c2 gets a permission, a retry and its first digest; the same button must still
   * hold the focus (before the fix every change rebuilt all rows and the focus fell to the body).
   * FABRICATED store data in jsdom.
   */
  it('keeps the focus on "Stop One" while another child changes state, asks and sends a digest', () => {
    const m = mountBar();
    addChild(m.store, 'c1', { title: 'One' });
    addChild(m.store, 'c2', { title: 'Two' });
    toggle().click();
    const stop = button('Stop One');
    stop.focus();
    expect(document.activeElement).toBe(stop);
    m.store.apply({ type: 'permission.asked', permission: permissionOf('c2') });
    m.store.apply({
      type: 'session.status',
      sessionID: 'c2',
      status: { type: 'retry', attempt: 1, message: 'again', nextAt: Date.now() + 5000 },
    });
    m.store.apply({
      type: 'subagent.activity',
      sessionID: PARENT,
      activity: {
        sessionID: 'c2',
        parentID: PARENT,
        running: true,
        toolCount: 1,
        recent: [digestTool('t1')],
      },
    });
    expect(button('Stop One')).toBe(stop);
    expect(document.activeElement).toBe(stop);
    expect(focusInput).not.toHaveBeenCalled();
  });

  /**
   * Protects review W4: when the row that had the focus disappears (its child ended), and when the
   * whole bar goes, the focus returns to the prompt through `focusInput` instead of falling to the
   * body. `document.hasFocus` is mocked true, as in `RequestDock.test.tsx`. FABRICATED store data.
   */
  it('returns the focus to the prompt when its row or the whole bar goes away', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const m = mountBar();
    addChild(m.store, 'c1', { title: 'One' });
    addChild(m.store, 'c2', { title: 'Two' });
    toggle().click();
    button('Stop One').focus();
    m.store.apply({ type: 'session.status', sessionID: 'c1', status: { type: 'idle' } });
    expect(focusInput).toHaveBeenCalledTimes(1);
    button('Stop Two').focus();
    m.store.apply({ type: 'session.status', sessionID: 'c2', status: { type: 'idle' } });
    expect(bar()).toBeNull();
    expect(focusInput).toHaveBeenCalledTimes(2);
  });

  it('ticks the elapsed time once a second while a child works and stops the interval when none does', async () => {
    const m = mountBar();
    addChild(m.store, 'c1', { activity: { since: Date.now() } });
    toggle().click();
    expect(must(document.body, '.subagent-elapsed').textContent).toBe('0:00');
    await vi.advanceTimersByTimeAsync(3000);
    expect(must(document.body, '.subagent-elapsed').textContent).toBe('0:03');
    expect(vi.getTimerCount()).toBe(1);
    m.store.apply({ type: 'session.status', sessionID: 'c1', status: { type: 'idle' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('carries no style attribute and no live region', () => {
    const m = mountBar();
    addChild(m.store, 'c1');
    toggle().click();
    expect(must(document.body, '.subagent-bar').querySelector('[style]')).toBeNull();
    expect(
      must(document.body, '.subagent-bar').querySelector('[aria-live],[role="log"]'),
    ).toBeNull();
  });
});
