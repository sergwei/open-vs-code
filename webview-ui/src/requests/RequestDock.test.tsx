// Protects the dock of pending requests (issues #18/#44): permissions come before forms, a request
// of another session says where it comes from, the live region announces each new request even
// when the text repeats, the focus goes to a new card only when the user is not typing, `ui.focus`
// always focuses (and waits for a card that has not arrived), and the focus returns to the prompt
// when the focused card is resolved. A regression here is a request nobody notices, or the focus
// stolen in the middle of a sentence.
//
// Provenance: a real `createChatStore` driven with FABRICATED host messages, rendered in jsdom next
// to a stand-in prompt form. jsdom implements focus and `activeElement`, but not layout, scrolling
// or a screen reader: those are UNVERIFIED (F5 points 1, 5).
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAsk, PermissionAsk, RequestResolution } from '../../../src/shared/model';
import { createChatStore, type ChatStore } from '../store/chatStore';
import { must, mount, splitRequestId, type Mounted } from '../testing';
import { RequestDock } from './RequestDock';

const mountedDocks: Mounted[] = [];
afterEach(() => {
  for (const dock of mountedDocks.splice(0)) dock.dispose();
});

const permission = (
  id: string,
  sessionID = 'ses_1',
  extra: Partial<PermissionAsk> = {},
): PermissionAsk => ({
  id,
  sessionID,
  action: 'read',
  resources: ['.env'],
  save: ['*'],
  ...extra,
});
const question = (id: string, sessionID = 'ses_1'): FormAsk => ({
  id,
  sessionID,
  title: 'Questions',
  kind: 'question',
  fields: [{ key: 'q0', type: 'string' }],
});

/** A snapshot with `ses_1` open, plus the given sessions and requests. */
function snapshot(
  requests: { permissions?: PermissionAsk[]; forms?: FormAsk[] } = {},
  sessions: Array<{ id: string; title?: string; parentID?: string }> = [],
) {
  return {
    type: 'snapshot' as const,
    snapshot: {
      sessions: [{ id: 'ses_1', title: 'Main', createdAt: 1, updatedAt: 1 }, ...sessions].map(
        (s) => ({
          createdAt: 1,
          updatedAt: 1,
          ...s,
        }),
      ),
      statuses: {},
      open: { sessionID: 'ses_1', messages: [], parts: {} },
      requests: { permissions: requests.permissions ?? [], forms: requests.forms ?? [] },
      resolutions: [],
    },
  };
}

/**
 * Mounts the dock beside a stand-in prompt form (`.prompt` with a textarea). `typing` and the
 * store are driven from the test AFTER mount (lesson #906).
 */
function setup() {
  const store: ChatStore = createRoot(() => createChatStore());
  const [typing, setTyping] = createSignal(false);
  const focusInput = vi.fn();
  const mounted = mount(() => (
    <>
      <RequestDock store={store} typing={typing()} focusInput={focusInput} />
      <form class="prompt">
        <textarea aria-label="Message" />
      </form>
    </>
  ));
  mountedDocks.push(mounted);
  const container = mounted.container;
  return {
    store,
    container,
    sent: mounted.sent,
    focusInput,
    setTyping,
    prompt: () => must<HTMLTextAreaElement>(container, '.prompt textarea'),
    live: () => must(container, '[aria-live]').textContent ?? '',
    card: (id: string) => must(container, `[data-request-id="${id}"]`),
    active: () => document.activeElement,
  };
}

describe('listing', () => {
  it('shows permissions before forms, each group in arrival order', () => {
    const { store, container } = setup();
    store.apply(
      snapshot({
        permissions: [permission('per_1'), permission('per_2')],
        forms: [question('frm_1')],
      }),
    );
    store.apply({ type: 'form.asked', form: question('frm_0') });
    store.apply({ type: 'permission.asked', permission: permission('per_3') });
    const order = [...container.querySelectorAll('[data-request-id]')].map((card) =>
      card.getAttribute('data-request-id'),
    );
    expect(order).toEqual(['per_1', 'per_2', 'per_3', 'frm_1', 'frm_0']);
  });

  it('renders nothing but the live region when there is nothing pending', () => {
    const { container } = setup();
    expect(container.querySelector('.request-dock')).toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('says which session a request comes from, and offers to open a top-level one only', () => {
    const { store, container, sent } = setup();
    store.apply(
      snapshot(
        {
          permissions: [permission('per_top', 'ses_top'), permission('per_child', 'ses_child')],
        },
        [
          { id: 'ses_top', title: 'Other chat' },
          { id: 'ses_child', title: 'explore subagent', parentID: 'ses_1' },
        ],
      ),
    );
    const top = must(container, '[data-request-id="per_top"] .request-origin');
    expect(top.textContent).toContain('Other chat');
    must<HTMLButtonElement>(top, 'button').click();
    expect(sent).toHaveLength(1);
    expect(splitRequestId(sent[0]).rest).toEqual({ type: 'session.open', sessionID: 'ses_top' });
    const child = must(container, '[data-request-id="per_child"] .request-origin');
    expect(child.textContent).toContain('explore subagent');
    expect(child.querySelector('button')).toBeNull();
    // A request of the open session has no origin line.
    store.apply({ type: 'permission.asked', permission: permission('per_own') });
    expect(container.querySelector('[data-request-id="per_own"] .request-origin')).toBeNull();
  });

  it('names the tool that raised a request when its block is in the open session', () => {
    const { store, container } = setup();
    store.apply({
      ...snapshot({
        permissions: [
          permission('per_1', 'ses_1', { tool: { messageID: 'msg_a', partID: 'call_1' } }),
        ],
      }),
    });
    store.apply({
      type: 'part.upserted',
      sessionID: 'ses_1',
      messageID: 'msg_a',
      part: { type: 'tool', id: 'call_1', name: 'read', state: { status: 'running', input: {} } },
    });
    expect(must(container, '.request-tool').textContent).toContain('read');
  });

  // The host sent no record, so the dock line is the fallback (E3-resolved-history).
  it('keeps the one-line result of an answered request until the store clears it', () => {
    const { store, container } = setup();
    store.apply(snapshot({ permissions: [permission('per_1')] }));
    store.apply({
      type: 'permission.resolved',
      sessionID: 'ses_1',
      permissionID: 'per_1',
      decision: 'reject',
    });
    expect(container.querySelector('[data-request-id]')).toBeNull();
    expect(must(container, '.request-results').textContent).toContain('Rejected: Read .env');
    store.clearResolved();
    expect(container.querySelector('.request-results')).toBeNull();
  });

  // E3-resolved-history, decision of Sergio (21/10/2026): the dock line is only for requests whose
  // history is not on screen (another session's); the open session's go under their tool.
  it('prints the result line for a request of another session, never for the open one', () => {
    const { store, container } = setup();
    store.apply(
      snapshot(
        {
          permissions: [permission('per_open'), permission('per_child', 'ses_child')],
        },
        [{ id: 'ses_child', title: 'explore subagent', parentID: 'ses_1' }],
      ),
    );
    const record = (id: string, sessionID: string): RequestResolution => ({
      kind: 'permission',
      id,
      sessionID,
      at: 5,
      decision: 'once',
      action: 'read',
      resource: '.env',
      withFeedback: false,
    });
    store.apply({
      type: 'permission.resolved',
      sessionID: 'ses_1',
      permissionID: 'per_open',
      decision: 'once',
      resolution: record('per_open', 'ses_1'),
    });
    store.apply({
      type: 'permission.resolved',
      sessionID: 'ses_child',
      permissionID: 'per_child',
      decision: 'once',
      resolution: record('per_child', 'ses_child'),
    });
    expect(must(container, '.request-results').querySelectorAll('li')).toHaveLength(1);
    expect(must(container, '.request-results').textContent).toContain('Allowed once: Read .env');
  });

  it('locks the card of a request whose answer is in flight', () => {
    const { store, container } = setup();
    store.apply(snapshot({ permissions: [permission('per_1')] }));
    store.beginReply('per_1', 'r1');
    for (const button of container.querySelectorAll('[data-request-id] button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    store.apply({
      type: 'request.result',
      requestId: 'r1',
      error: { code: 'X', message: 'It failed' },
    });
    expect(container.textContent).toContain('It failed');
  });
});

describe('announcements', () => {
  it('announces a permission and a question', () => {
    const { store, live } = setup();
    store.apply({ type: 'permission.asked', permission: permission('per_1') });
    expect(live().trim()).toBe('Permission requested: Read .env');
    store.apply({ type: 'form.asked', form: question('frm_1') });
    expect(live().trim()).toBe('Question from the agent');
  });

  it('announces several arrivals together as a count', () => {
    const { store, live } = setup();
    store.apply(snapshot({ permissions: [permission('per_1'), permission('per_2')] }));
    expect(live().trim()).toBe('2 requests from the agent');
  });

  it('changes the text when the same request is announced twice (lesson #918)', () => {
    const { store, live } = setup();
    store.apply({ type: 'permission.asked', permission: permission('per_1') });
    const first = live();
    store.apply({
      type: 'permission.resolved',
      sessionID: 'ses_1',
      permissionID: 'per_1',
      decision: 'once',
    });
    store.apply({ type: 'permission.asked', permission: permission('per_2') });
    const second = live();
    expect(second.trim()).toBe(first.trim());
    expect(second).not.toBe(first);
  });
});

describe('focus', () => {
  // jsdom answers `document.hasFocus()` from its own state, which is false with nothing focused;
  // the tests below model a document that has the focus unless one says otherwise.
  let documentHasFocus = true;
  beforeEach(() => {
    documentHasFocus = true;
    vi.spyOn(document, 'hasFocus').mockImplementation(() => documentHasFocus);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Protects the phase 3b decision (D4 of `test:visual` step 30): a card that arrives in a document
   * without the focus (a tab visible in another group) is not focused, because focusing it made VS
   * Code activate that tab; with the focus the card is focused as before. SYNTHETIC: `hasFocus` is
   * a spy, the real behaviour is read in `test:visual` step 30.
   */
  it('does not focus a new card when its document has no focus, and does when it has', () => {
    const { store, card, active } = setup();
    documentHasFocus = false;
    store.apply({ type: 'permission.asked', permission: permission('per_1') });
    expect(active()).not.toBe(card('per_1'));
    documentHasFocus = true;
    store.apply({ type: 'permission.asked', permission: permission('per_2') });
    expect(active()).toBe(card('per_2'));
  });

  it('ui.focus focuses the card even when the document has no focus ("Open chat")', () => {
    const { store, card, active } = setup();
    documentHasFocus = false;
    store.apply({ type: 'permission.asked', permission: permission('per_1') });
    store.apply({
      type: 'ui.focus',
      target: { kind: 'permission', sessionID: 'ses_1', id: 'per_1' },
    });
    expect(active()).toBe(card('per_1'));
  });

  it('moves the focus to the CARD (never a button) of a new request when nothing has it', () => {
    const { store, card, active } = setup();
    store.apply({ type: 'permission.asked', permission: permission('per_1') });
    expect(active()).toBe(card('per_1'));
    expect(active()?.tagName).toBe('SECTION');
    expect(active()?.getAttribute('aria-labelledby')).not.toBeNull();
  });

  it('does not steal the focus while the user is typing in the prompt', () => {
    const { store, prompt, setTyping, active } = setup();
    prompt().focus();
    setTyping(true);
    store.apply({ type: 'permission.asked', permission: permission('per_1') });
    expect(active()).toBe(prompt());
  });

  it('takes the focus from an idle prompt (empty) but only onto the card, so Space/Enter answer nothing', () => {
    const { store, prompt, card, active, sent } = setup();
    prompt().focus();
    store.apply({ type: 'permission.asked', permission: permission('per_1') });
    expect(active()).toBe(card('per_1'));
    // Synthetic keydown events on the focused card. jsdom has no default action for keys, so this
    // only shows that nothing in OUR code (card or dock) sends a reply on Space or Enter and that
    // the focus is not on a button; that a real browser would not press a button is true by
    // construction (a section is not activatable) but is not exercised here.
    for (const key of [' ', 'Enter']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      active()?.dispatchEvent(event);
    }
    expect(sent).toEqual([]);
    expect(active()?.tagName).not.toBe('BUTTON');
  });

  it('does not steal the focus from another card the user is answering', () => {
    const { store, card, active } = setup();
    store.apply({ type: 'permission.asked', permission: permission('per_1') });
    expect(active()).toBe(card('per_1'));
    store.apply({ type: 'permission.asked', permission: permission('per_2') });
    expect(active()).toBe(card('per_1'));
  });

  it('ui.focus always focuses the card, even while typing, and clears the target', () => {
    const { store, prompt, setTyping, card, active } = setup();
    store.apply({ type: 'permission.asked', permission: permission('per_1') });
    prompt().focus();
    setTyping(true);
    store.apply({
      type: 'ui.focus',
      target: { kind: 'permission', sessionID: 'ses_1', id: 'per_1' },
    });
    expect(active()).toBe(card('per_1'));
    expect(store.state.focusTarget).toBeUndefined();
  });

  it('ui.focus waits for a card that the snapshot has not brought yet', () => {
    const { store, card, active } = setup();
    store.apply({ type: 'ui.focus', target: { kind: 'form', sessionID: 'ses_1', id: 'frm_1' } });
    expect(store.state.focusTarget).toBeDefined();
    store.apply(snapshot({ forms: [question('frm_1')] }));
    expect(active()).toBe(card('frm_1'));
    expect(store.state.focusTarget).toBeUndefined();
  });

  it('returns the focus to the prompt when the focused card is resolved', () => {
    const { store, focusInput } = setup();
    store.apply({ type: 'permission.asked', permission: permission('per_1') });
    expect(focusInput).not.toHaveBeenCalled();
    store.apply({
      type: 'permission.resolved',
      sessionID: 'ses_1',
      permissionID: 'per_1',
      decision: 'once',
    });
    expect(focusInput).toHaveBeenCalledTimes(1);
  });

  it('does not touch the focus when a card the user was not in is resolved', () => {
    const { store, prompt, focusInput } = setup();
    store.apply({ type: 'permission.asked', permission: permission('per_1') });
    prompt().focus();
    store.apply({
      type: 'permission.resolved',
      sessionID: 'ses_1',
      permissionID: 'per_1',
      decision: 'once',
    });
    expect(focusInput).not.toHaveBeenCalled();
  });

  it('Escape inside a card asks to return the focus to the prompt', () => {
    const { store, card, focusInput } = setup();
    store.apply({ type: 'permission.asked', permission: permission('per_1') });
    card('per_1').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(focusInput).toHaveBeenCalledTimes(1);
  });
});
