// Protects the Quick start view (issue #187, E9-sidebar-home): Enter sends ONE start and the draft
// goes only when the host says it worked, Shift+Enter breaks the line, blank text and a blocked box
// do nothing, Stop stays in the DOM with `aria-disabled` (and keeps the focus) while the host works,
// the clock counts from `since` with no host traffic, the live region announces rows and not ticks,
// and no element carries a `style` attribute (the CSP has no 'unsafe-inline').
// Provenance: jsdom and FABRICATED states and results; the real document is `test:visual` step 50.
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeState, HomeWebviewToHost } from '../../../src/shared/homeProtocol';
import { mount, must, type Mounted } from '../testing';
import { HomeApp, elapsedName, formatElapsed } from './HomeApp';
import { createHomeStore, type HomeStore } from './homeStore';
import { createHomeUi, type HomeUi } from './homeUiState';

/** A connected, idle `HomeState` (FABRICATED); `patch` overrides fields. */
function state(patch: Partial<HomeState> = {}): HomeState {
  return {
    server: { state: 'connected' },
    canStart: true,
    model: 'Big Pickle',
    mode: 'manual',
    mcp: [],
    running: [],
    waiting: [],
    ...patch,
  };
}

interface Rig {
  view: Mounted;
  store: HomeStore;
  ui: HomeUi;
  sent: HomeWebviewToHost[];
  saved: { draft: string }[];
}

/** Mounts `HomeApp` over a real store with a recorder as `send`; `initial` is applied after mount. */
function rig(initial?: HomeState, savedDraft?: string): Rig {
  const sent: HomeWebviewToHost[] = [];
  const saved: { draft: string }[] = [];
  const store = createRoot(() => createHomeStore());
  const ui = createRoot(() =>
    createHomeUi({
      getState: () => (savedDraft === undefined ? undefined : { draft: savedDraft }),
      setState: (next) => saved.push(next),
    }),
  );
  const view = mount(() => (
    <HomeApp
      store={store}
      send={(message) => {
        sent.push(message);
      }}
      ui={ui}
    />
  ));
  if (initial !== undefined) store.apply({ type: 'home.state', state: initial });
  return { view, store, ui, sent, saved };
}

/** Dispatches a cancelable `keydown` on `target`, as the browser would. */
function key(target: Element, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

/** Sets the box value and fires `input`, so the draft handler runs. */
function type(box: HTMLTextAreaElement, text: string): void {
  box.value = text;
  box.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

let current: Rig | undefined;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  current?.view.dispose();
  current = undefined;
  vi.useRealTimers();
});

describe('HomeApp box', () => {
  it('Enter sends one start, keeps the draft until the host answers ok, then clears it', () => {
    current = rig(state());
    const box = must<HTMLTextAreaElement>(current.view.container, '.home-box');
    type(box, 'fix the build');
    key(box, { key: 'Enter' });
    key(box, { key: 'Enter' }); // a second Enter while it starts sends nothing
    expect(current.sent).toHaveLength(1);
    const message = current.sent[0];
    if (message?.type !== 'home.start') throw new Error('expected home.start');
    expect(message.text).toBe('fix the build');
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(box.value).toBe('fix the build');
    current.store.apply({ type: 'home.result', requestId: message.requestId, ok: true });
    expect(box.value).toBe('');
    expect(current.ui.draft()).toBe('');
    expect(box.getAttribute('aria-disabled')).toBe('false');
  });

  it('keeps the text and says why when the host refuses', () => {
    current = rig(state());
    const box = must<HTMLTextAreaElement>(current.view.container, '.home-box');
    type(box, 'hello');
    key(box, { key: 'Enter' });
    const message = current.sent[0];
    if (message?.type !== 'home.start') throw new Error('expected home.start');
    current.store.apply({
      type: 'home.result',
      requestId: message.requestId,
      ok: false,
      error: 'No tab could be opened',
    });
    expect(box.value).toBe('hello');
    expect(must(current.view.container, '.home-notice').textContent).toBe('No tab could be opened');
  });

  it('Shift+Enter, blank text and a composition in progress send nothing', () => {
    current = rig(state());
    const box = must<HTMLTextAreaElement>(current.view.container, '.home-box');
    type(box, 'a');
    const shifted = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    box.dispatchEvent(shifted);
    expect(shifted.defaultPrevented).toBe(false); // the browser inserts the line break
    key(box, { key: 'Enter', isComposing: true });
    type(box, '  \n ');
    key(box, { key: 'Enter' });
    expect(current.sent).toEqual([]);
  });

  it('ignores Enter and says why while the server cannot start anything', () => {
    current = rig(
      state({ canStart: false, server: { state: 'unavailable', reason: 'no-workspace' } }),
    );
    const box = must<HTMLTextAreaElement>(current.view.container, '.home-box');
    type(box, 'hello');
    key(box, { key: 'Enter' });
    expect(current.sent).toEqual([]);
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(box.hasAttribute('disabled')).toBe(false); // never `disabled`: the focus would drop
    expect(must(current.view.container, '.home-hint').textContent).toBe(
      'Open a folder to start a conversation',
    );
  });

  it('restores the draft of the previous document and saves each change', () => {
    current = rig(state(), 'half typed');
    const box = must<HTMLTextAreaElement>(current.view.container, '.home-box');
    expect(box.value).toBe('half typed');
    type(box, 'half typed more');
    expect(current.saved.at(-1)).toEqual({ draft: 'half typed more' });
  });

  it('does not send text over the protocol cap', () => {
    current = rig(state());
    const box = must<HTMLTextAreaElement>(current.view.container, '.home-box');
    type(box, 'x'.repeat(20_001));
    key(box, { key: 'Enter' });
    expect(current.sent).toEqual([]);
    expect(must(current.view.container, '.home-notice').textContent).toContain('too long');
  });
});

describe('HomeApp status and rows', () => {
  it('each pill is a button with its action; the mode asks for the OTHER mode', () => {
    current = rig(
      state({
        mcp: [{ name: 'github', status: 'failed' }],
        server: { state: 'connected' },
      }),
    );
    const pills = [...current.view.container.querySelectorAll<HTMLButtonElement>('.home-pill')];
    expect(pills.map((p) => p.dataset.kind)).toEqual(['server', 'model', 'mode', 'mcp']);
    for (const pill of pills) pill.click();
    expect(current.sent).toEqual([
      { type: 'home.action', action: 'logs' },
      { type: 'home.action', action: 'settings' },
      { type: 'home.mode', mode: 'auto' },
      { type: 'home.action', action: 'settings' },
    ]);
  });

  it('a stopped server pill restarts it', () => {
    current = rig(state({ server: { state: 'not-started', reason: 'auto-start-off' } }));
    must<HTMLButtonElement>(current.view.container, '.home-pill[data-kind="server"]').click();
    expect(current.sent).toEqual([{ type: 'home.action', action: 'restart' }]);
  });

  it('Stop is aria-disabled while it stops, keeps the focus, and ignores a second press', () => {
    current = rig(
      state({
        running: [{ sessionID: 'ses_1', title: 'Fix build', since: Date.now(), subagents: 0 }],
      }),
    );
    const button = must<HTMLButtonElement>(current.view.container, '.home-action');
    expect(button.getAttribute('aria-label')).toBe('Stop Fix build');
    button.focus();
    button.click();
    button.click();
    expect(current.sent).toHaveLength(1);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(button);
    const message = current.sent[0];
    if (message?.type !== 'home.stop') throw new Error('expected home.stop');
    current.store.apply({
      type: 'home.result',
      requestId: message.requestId,
      ok: false,
      error: 'That session is not running anymore',
    });
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(must(current.view.container, '.home-notice').textContent).toBe(
      'That session is not running anymore',
    );
  });

  /**
   * Protects review B1 of E9-sidebar-home: the host posts a NEW state on every tool start of a
   * running session, and `<For>` over fresh objects recreated every row, dropping the keyboard focus
   * to the body (probe: "same element: false | activeElement is body: true"). The row, the Reply
   * button and the MCP pill must also stay. FABRICATED states in jsdom.
   */
  it('keeps the same Stop, Reply and pill elements, and the focus, across a new state of the same rows', () => {
    const running = (activity: string) => ({
      sessionID: 'ses_1',
      title: 'Fix build',
      subagents: 0,
      activity: { kind: 'tool' as const, name: activity },
    });
    const waiting = { kind: 'form' as const, sessionID: 'ses_2', id: 'frm_1', title: 'Other' };
    const mcp = [{ name: 'linear', status: 'failed' as const }];
    current = rig(state({ running: [running('read')], waiting: [waiting], mcp }));
    const root = current.view.container;
    const stopButton = must<HTMLButtonElement>(root, '[aria-label="Stop Fix build"]');
    const reply = must<HTMLButtonElement>(root, '[aria-label="Reply to Other"]');
    const pill = must<HTMLButtonElement>(root, '.home-pill[data-kind="mcp"]');
    stopButton.focus();
    current.store.apply({
      type: 'home.state',
      state: state({ running: [running('bash')], waiting: [{ ...waiting }], mcp: [...mcp] }),
    });
    expect(must(root, '.home-row[data-kind="running"] .home-row-detail').textContent).toBe('bash');
    expect(must(root, '[aria-label="Stop Fix build"]')).toBe(stopButton);
    expect(must(root, '[aria-label="Reply to Other"]')).toBe(reply);
    expect(must(root, '.home-pill[data-kind="mcp"]')).toBe(pill);
    expect(document.activeElement).toBe(stopButton);
  });

  /**
   * Protects the promise of the header of `HomeApp`: after a SUCCESSFUL Stop pressed with the
   * keyboard the focus goes to the box (the row is about to leave), and a Stop pressed elsewhere
   * does not move it. FABRICATED state and result in jsdom.
   */
  it('moves the focus to the box after a successful Stop pressed with the keyboard', () => {
    current = rig(state({ running: [{ sessionID: 'ses_1', title: 'Fix build', subagents: 0 }] }));
    const button = must<HTMLButtonElement>(current.view.container, '[aria-label="Stop Fix build"]');
    button.focus();
    button.click();
    const message = current.sent[0];
    if (message?.type !== 'home.stop') throw new Error('expected home.stop');
    current.store.apply({ type: 'home.result', requestId: message.requestId, ok: true });
    expect(document.activeElement).toBe(must(current.view.container, '.home-box'));
  });

  it('does not move the focus after a successful Stop pressed with the focus elsewhere', () => {
    current = rig(state({ running: [{ sessionID: 'ses_1', title: 'Fix build', subagents: 0 }] }));
    const open = must<HTMLButtonElement>(current.view.container, '.home-row-open');
    open.focus();
    must<HTMLButtonElement>(current.view.container, '[aria-label="Stop Fix build"]').click();
    const message = current.sent[0];
    if (message?.type !== 'home.stop') throw new Error('expected home.stop');
    current.store.apply({ type: 'home.result', requestId: message.requestId, ok: true });
    expect(document.activeElement).toBe(open);
  });

  /**
   * Protects decision S2 (Sergio, 08/11/2026): the elapsed time is in the accessible name of the
   * open button of a running row ("running for 2 minutes"), changes only by the minute, and the
   * visible clock stays `aria-hidden` and outside the live region. FABRICATED state, fake timers.
   */
  it('names the elapsed time in the accessible name of a running row, by the minute', () => {
    expect(elapsedName(30_000)).toBe('running for less than a minute');
    expect(elapsedName(60_000)).toBe('running for 1 minute');
    expect(elapsedName(125_000)).toBe('running for 2 minutes');
    expect(elapsedName(3_900_000)).toBe('running for 1 h 5 min');
    expect(elapsedName(-5)).toBe('running for less than a minute');
    current = rig(
      state({
        running: [
          { sessionID: 'ses_1', title: 'Fix build', since: Date.now() - 125_000, subagents: 0 },
        ],
      }),
    );
    const open = must<HTMLButtonElement>(current.view.container, '.home-row-open');
    expect(open.getAttribute('aria-label')).toBe('Fix build, running for 2 minutes');
    const announced = must(current.view.container, '[role="status"]').textContent;
    vi.advanceTimersByTime(5_000);
    expect(open.getAttribute('aria-label')).toBe('Fix build, running for 2 minutes');
    expect(must(current.view.container, '[role="status"]').textContent).toBe(announced);
    expect(must(current.view.container, '.home-clock').getAttribute('aria-hidden')).toBe('true');
    vi.advanceTimersByTime(60_000);
    expect(open.getAttribute('aria-label')).toBe('Fix build, running for 3 minutes');
  });

  it('Reply and Open send the triple and the session of the row', () => {
    current = rig(
      state({
        waiting: [{ kind: 'permission', sessionID: 'child', id: 'per_1', title: 'Fix build' }],
        running: [{ sessionID: 'ses_1', title: 'Other', subagents: 0 }],
      }),
    );
    must<HTMLButtonElement>(current.view.container, '[aria-label="Reply to Fix build"]').click();
    must<HTMLButtonElement>(current.view.container, '.home-row-open').click();
    expect(current.sent).toEqual([
      { type: 'home.reply', kind: 'permission', sessionID: 'child', id: 'per_1' },
      { type: 'home.open', sessionID: 'ses_1' },
    ]);
  });

  it('shows the empty state and the clock counts from since without any message', () => {
    current = rig(state());
    expect(must(current.view.container, '.home-empty').textContent).toBe('Nothing running');
    current.store.apply({
      type: 'home.state',
      state: state({
        running: [
          {
            sessionID: 'ses_1',
            title: '',
            since: Date.now() - 65_000,
            activity: { kind: 'tool', name: 'bash' },
            subagents: 0,
          },
        ],
      }),
    });
    const clock = must(current.view.container, '.home-clock');
    expect(clock.textContent).toBe('1:05');
    expect(clock.getAttribute('aria-hidden')).toBe('true');
    vi.advanceTimersByTime(3000);
    expect(clock.textContent).toBe('1:08');
    expect(current.sent).toEqual([]); // no traffic per tick
    expect(must(current.view.container, '.home-row-title').textContent).toBe('Untitled session');
  });

  it('the live region announces a row that appears or goes, and not the clock', () => {
    current = rig(state());
    const live = must(current.view.container, '[role="status"]');
    const running = state({
      running: [{ sessionID: 'ses_1', title: 'Fix build', since: Date.now(), subagents: 0 }],
    });
    current.store.apply({ type: 'home.state', state: running });
    expect(live.textContent?.trim()).toBe('Fix build is running');
    vi.advanceTimersByTime(5000);
    expect(live.textContent?.trim()).toBe('Fix build is running');
    current.store.apply({ type: 'home.state', state: state() });
    expect(live.textContent?.trim()).toBe('Fix build finished');
  });

  it('puts no style attribute anywhere', () => {
    current = rig(
      state({
        mcp: [{ name: 'github', status: 'needs_auth' }],
        waiting: [{ kind: 'form', sessionID: 's', id: 'f', title: 'T' }],
        running: [{ sessionID: 'ses_1', title: 'R', since: Date.now(), subagents: 2 }],
      }),
    );
    expect(current.view.container.querySelector('[style]')).toBeNull();
  });
});

describe('formatElapsed', () => {
  it('writes m:ss, h:mm:ss, and never a negative time', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
    expect(formatElapsed(-5000)).toBe('0:00');
  });
});
