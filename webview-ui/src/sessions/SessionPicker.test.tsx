// Protects the session list dropdown (issue #20) from the ways such a widget quietly breaks:
//   - a search that sends one query per keystroke, or the rows of an older search replacing the
//     newer ones;
//   - a delete that is decided by the webview (it must only ASK the host; the confirmation is the
//     host's native modal) and a rename that sends an empty or unchanged title;
//   - keyboard users locked out (arrows, Home/End, F2, Delete, Escape returning the focus) and a
//     state told only by colour ("Running" must be text);
//   - Escape inside the rename field closing the whole list.
//
// Provenance: a real `createChatStore` driven with FABRICATED host messages, rendered in jsdom with
// a recording sender. They confirm the wiring of the component and the store, not the layout, the
// themes, the focus ring or a screen reader (`npm run test:visual` step 9 covers the first three on
// Windows; the last is UNVERIFIED). Lessons applied: effects run after the root returns (#906), the
// phrases are compared as whole `textContent` (#926).
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionSummary } from '../../../src/shared/model';
import { createChatStore, type ChatStore } from '../store/chatStore';
import { must, mount, splitRequestId, type Mounted } from '../testing';
import { SEARCH_DEBOUNCE_MS, SessionPicker } from './SessionPicker';

const mounted: Mounted[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const item of mounted.splice(0)) item.dispose();
});

const row = (id: string, title: string | undefined, ageMs = 1000): SessionSummary => ({
  id,
  createdAt: 0,
  updatedAt: Date.now() - ageMs,
  ...(title === undefined ? {} : { title }),
});

interface Harness {
  store: ChatStore;
  view: Mounted;
  opened: string[];
  closes: boolean[];
  /** Answers the newest query with these rows. */
  answer(rows: SessionSummary[], extra?: { append?: boolean; hasMore?: boolean }): void;
  mains(): HTMLButtonElement[];
  key(target: Element, key: string): void;
}

/** Mounts the picker over a fresh store; `rows` answer its first query when given. */
function open(rows?: SessionSummary[], prepare?: (store: ChatStore) => void): Harness {
  const store = createRoot(() => createChatStore());
  prepare?.(store);
  const opened: string[] = [];
  const closes: boolean[] = [];
  const view = mount(() => (
    <SessionPicker
      store={store}
      onOpenSession={(id) => {
        opened.push(id);
      }}
      onClose={(restore) => {
        closes.push(restore);
      }}
    />
  ));
  mounted.push(view);
  const harness: Harness = {
    store,
    view,
    opened,
    closes,
    answer: (list, extra = {}) => {
      const { requestId } = splitRequestId(view.sent.at(-1));
      store.apply({
        type: 'sessions.page',
        requestId,
        search: '',
        sessions: list,
        append: extra.append ?? false,
        hasMore: extra.hasMore ?? false,
      });
    },
    mains: () => [...view.container.querySelectorAll<HTMLButtonElement>('button.session-main')],
    key: (target, key) => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    },
  };
  if (rows !== undefined) harness.answer(rows);
  return harness;
}

describe('opening', () => {
  it('asks for a fresh first page and puts the focus in the search box', () => {
    const h = open();
    expect(h.view.sent).toHaveLength(1);
    expect(splitRequestId(h.view.sent[0]).rest).toEqual({
      type: 'sessions.query',
      search: '',
      more: false,
    });
    expect(document.activeElement).toBe(must(h.view.container, 'input[type="search"]'));
    expect(h.store.state.pending).toEqual([]);
  });

  it('is a labelled, non-modal dialog and says it is loading (as text and in the live region)', () => {
    const h = open();
    const dialog = must(h.view.container, '[role="dialog"]');
    expect(dialog.getAttribute('aria-label')).toBe('Sessions');
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(must(h.view.container, '.session-status').textContent).toBe('Loading sessions…');
    expect(must(h.view.container, '[role="status"]').textContent).toBe('Loading sessions…');
  });

  it('says how many sessions there are, or that there are none', () => {
    const h = open([row('a', 'One'), row('b', 'Two')]);
    expect(must(h.view.container, '[role="status"]').textContent?.trim()).toBe('2 sessions');
    expect(h.view.container.querySelector('.session-status')).toBeNull();
    const empty = open([]);
    expect(must(empty.view.container, '.session-status').textContent).toBe('No sessions yet');
  });
});

describe('search', () => {
  it('sends ONE query after the debounce, with the final text', () => {
    vi.useFakeTimers();
    const h = open([row('a', 'One')]);
    const input = must<HTMLInputElement>(h.view.container, 'input[type="search"]');
    for (const text of ['a', 'al', 'alp']) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50);
    }
    expect(h.view.sent).toHaveLength(1); // still only the query made on opening
    vi.advanceTimersByTime(60);
    expect(h.view.sent).toHaveLength(2);
    expect(splitRequestId(h.view.sent[1]).rest).toEqual({
      type: 'sessions.query',
      search: 'alp',
      more: false,
    });
  });

  it('shows "No sessions match" for an empty result of a search, and keeps the last good rows meanwhile', () => {
    vi.useFakeTimers();
    const h = open([row('a', 'One')]);
    const input = must<HTMLInputElement>(h.view.container, 'input[type="search"]');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 1);
    expect(h.mains()).toHaveLength(1); // old rows stay while the new page loads
    h.answer([]);
    expect(h.mains()).toHaveLength(0);
    expect(must(h.view.container, '.session-status').textContent).toBe('No sessions match');
  });

  it('"Show more" continues the current search', () => {
    const h = open([row('a', 'One')], undefined);
    h.store.beginQuery('x', 'abc');
    h.store.apply({
      type: 'sessions.page',
      requestId: 'x',
      search: 'abc',
      sessions: [row('a', 'One')],
      append: false,
      hasMore: true,
    });
    const more = [...h.view.container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Show more',
    );
    expect(more).toBeDefined();
    more?.click();
    expect(splitRequestId(h.view.sent.at(-1)).rest).toEqual({
      type: 'sessions.query',
      search: 'abc',
      more: true,
    });
  });
});

describe('"Show more" while a page loads (review W2 of E4-session-management)', () => {
  // Protects the keyboard user: a `disabled` button that holds the focus drops it onto the page,
  // and the list would then send it to the search box after every "Show more". Fabricated host
  // messages in jsdom; the real focus behaviour of VS Code's webview is UNVERIFIED.
  it('keeps the focus on the button, is aria-disabled and ignores a second click until the page arrives', () => {
    const h = open([row('a', 'One')]);
    h.store.beginQuery('x', '');
    h.store.apply({
      type: 'sessions.page',
      requestId: 'x',
      search: '',
      sessions: [row('a', 'One')],
      append: false,
      hasMore: true,
    });
    const more = must<HTMLButtonElement>(h.view.container, 'button.session-more');
    more.focus();
    more.click();
    expect(h.view.sent).toHaveLength(2); // opening + this one
    expect(more.disabled).toBe(false);
    expect(more.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(more);
    more.click();
    expect(h.view.sent).toHaveLength(2); // ignored while loading
    h.answer([row('b', 'Two')], { append: true, hasMore: true });
    expect(more.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('rows', () => {
  it('groups by date, marks the open session, and writes Running and Needs input as text', () => {
    const h = open(
      [
        row('open', 'Fix the build'),
        row('busy', 'Refactor', 2_000),
        row('old', 'Ancient', 40 * 86_400_000),
      ],
      (store) => {
        store.apply({
          type: 'snapshot',
          snapshot: {
            sessions: [],
            statuses: { busy: { type: 'busy' } },
            open: { sessionID: 'open', messages: [], parts: {} },
            requests: {
              permissions: [
                { id: 'per_1', sessionID: 'busy', action: 'read', resources: [], save: [] },
              ],
              forms: [],
            },
            resolutions: [],
          },
        });
      },
    );
    const titles = [...h.view.container.querySelectorAll('.session-group-title')].map(
      (e) => e.textContent,
    );
    expect(titles).toEqual(['Today', 'Older']);
    const [current, busy] = h.mains();
    expect(current?.getAttribute('aria-current')).toBe('true');
    expect(busy?.getAttribute('aria-current')).toBeNull();
    expect(must(busy ?? h.view.container, '.session-badge').textContent).toBe(
      'Running · Needs input',
    );
    expect(h.view.container.querySelectorAll('.session-badge')).toHaveLength(1);
  });

  it('shows "Untitled session" for a session without title and names the buttons after the title', () => {
    const h = open([row('a', undefined), row('b', 'Fix the build')]);
    expect(h.mains()[0]?.querySelector('.session-title')?.textContent).toBe('Untitled session');
    const labels = [...h.view.container.querySelectorAll('.session-action')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual([
      'Rename session Untitled session',
      'Delete session Untitled session',
      'Rename session Fix the build',
      'Delete session Fix the build',
    ]);
  });

  it('has a single tab stop: the open session, else the first row', () => {
    const h = open([row('a', 'One'), row('b', 'Two')], (store) => {
      store.apply({
        type: 'snapshot',
        snapshot: {
          sessions: [],
          statuses: {},
          open: { sessionID: 'b', messages: [], parts: {} },
          requests: { permissions: [], forms: [] },
          resolutions: [],
        },
      });
    });
    expect(h.mains().map((b) => b.tabIndex)).toEqual([-1, 0]);
  });

  it('keeps Rename and Delete out of the Tab order except in the row that holds the tab stop (review W3)', () => {
    // Without this Tab would walk through 2 x N invisible buttons (they are opacity 0 until hover).
    const h = open([row('a', 'One'), row('b', 'Two')]);
    const tabIndexes = [...h.view.container.querySelectorAll('.session-row')].map((li) =>
      [...li.querySelectorAll<HTMLButtonElement>('button')].map((b) => b.tabIndex),
    );
    expect(tabIndexes).toEqual([
      [0, 0, 0], // main, Rename, Delete of the tab-stop row
      [-1, -1, -1],
    ]);
  });

  it('locks a row while the host renames or deletes it, and says so in words', () => {
    const h = open([row('a', 'One'), row('b', 'Two')]);
    h.store.beginSessionOp('a', 'deleting', 'r1');
    h.store.beginSessionOp('b', 'renaming', 'r2');
    const [first, second] = [...h.view.container.querySelectorAll('.session-row')];
    expect(first?.querySelector('.session-badge')?.textContent).toBe('Deleting…');
    expect(second?.querySelector('.session-badge')?.textContent).toBe('Renaming…');
    // aria-disabled, not `disabled`: a button disabled while it has the focus drops the keyboard
    // user onto the page. The row ignores clicks instead.
    expect(first?.querySelector('.session-main')?.getAttribute('aria-disabled')).toBe('true');
    expect(first?.querySelector('.session-action')?.getAttribute('aria-disabled')).toBe('true');
    first?.querySelector<HTMLButtonElement>('.session-main')?.click();
    first?.querySelector<HTMLButtonElement>('.session-action')?.click();
    expect(h.opened).toEqual([]);
    expect(h.view.sent).toHaveLength(1); // only the query made on opening
  });

  it('clicking a row opens that session', () => {
    const h = open([row('a', 'One'), row('b', 'Two')]);
    h.mains()[1]?.click();
    expect(h.opened).toEqual(['b']);
  });
});

describe('keyboard', () => {
  it('ArrowDown from the search enters the list; arrows, Home and End move between rows; ArrowUp from the first goes back', () => {
    const h = open([row('a', 'One'), row('b', 'Two'), row('c', 'Three')]);
    const search = must(h.view.container, 'input[type="search"]');
    h.key(search, 'ArrowDown');
    const [a, b, c] = h.mains();
    expect(document.activeElement).toBe(a);
    h.key(a ?? search, 'ArrowDown');
    expect(document.activeElement).toBe(b);
    h.key(b ?? search, 'End');
    expect(document.activeElement).toBe(c);
    h.key(c ?? search, 'ArrowDown'); // clamped at the last row
    expect(document.activeElement).toBe(c);
    h.key(c ?? search, 'Home');
    expect(document.activeElement).toBe(a);
    h.key(a ?? search, 'ArrowUp');
    expect(document.activeElement).toBe(search);
  });

  it('the last focused row becomes the tab stop', () => {
    const h = open([row('a', 'One'), row('b', 'Two')]);
    h.mains()[1]?.focus();
    expect(h.mains().map((button) => button.tabIndex)).toEqual([-1, 0]);
  });

  it('Escape closes and asks for the focus back on the button', () => {
    const h = open([row('a', 'One')]);
    h.key(must(h.view.container, 'input[type="search"]'), 'Escape');
    expect(h.closes).toEqual([true]);
  });

  it('a click outside closes without taking the focus; a click inside or on the Sessions button does not close', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const trigger = document.createElement('button');
    trigger.setAttribute('data-session-trigger', '');
    document.body.append(trigger);
    try {
      const h = open([row('a', 'One')]);
      h.mains()[0]?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      trigger.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(h.closes).toEqual([]);
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(h.closes).toEqual([false]);
    } finally {
      outside.remove();
      trigger.remove();
    }
  });

  it('stops listening for outside clicks once it is unmounted', () => {
    const h = open([row('a', 'One')]);
    h.view.dispose();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(h.closes).toEqual([]);
  });
});

describe('rename', () => {
  /** Starts the in-line edit of the first row with F2 and returns its field. */
  function edit(h: Harness): HTMLInputElement {
    const first = h.mains()[0];
    if (first === undefined) throw new Error('no row');
    first.focus();
    h.key(first, 'F2');
    return must<HTMLInputElement>(h.view.container, 'input.session-rename-input');
  }
  const flushMicrotasks = () => Promise.resolve();

  it('F2 edits the title in place with the text selected; Enter sends the trimmed title', async () => {
    const h = open([row('a', 'Old title')]);
    const field = edit(h);
    await flushMicrotasks();
    expect(field.value).toBe('Old title');
    expect(document.activeElement).toBe(field);
    field.value = '  New title  ';
    h.key(field, 'Enter');
    expect(splitRequestId(h.view.sent.at(-1)).rest).toEqual({
      type: 'session.rename',
      sessionID: 'a',
      title: 'New title',
    });
    expect(h.view.container.querySelector('input.session-rename-input')).toBeNull();
    await flushMicrotasks();
    expect(document.activeElement).toBe(h.mains()[0]);
    expect(h.store.state.sessionOps['a']?.op).toBe('renaming');
  });

  // Found by `npm run test:visual` (step 9, 21/10/2026): the automatic title arrives seconds after
  // the first answer, and a reactive `value=` overwrote what the user was typing.
  it('keeps the text being typed when the title changes underneath (an automatic title arrives)', async () => {
    const h = open([row('a', 'Old title')]);
    const field = edit(h);
    await flushMicrotasks();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe('Old title'.length);
    field.value = 'My own words';
    h.store.apply({ type: 'session.upserted', session: row('a', 'Generated by the model') });
    expect(must<HTMLInputElement>(h.view.container, 'input.session-rename-input').value).toBe(
      'My own words',
    );
    h.key(field, 'Enter');
    expect(splitRequestId(h.view.sent.at(-1)).rest).toMatchObject({ title: 'My own words' });
  });

  it('Escape cancels without sending and does NOT close the list', async () => {
    const h = open([row('a', 'Old title')]);
    const field = edit(h);
    field.value = 'Changed my mind';
    h.key(field, 'Escape');
    expect(h.view.sent).toHaveLength(1); // only the query made on opening
    expect(h.closes).toEqual([]);
    expect(h.view.container.querySelector('input.session-rename-input')).toBeNull();
    await flushMicrotasks();
    expect(document.activeElement).toBe(h.mains()[0]);
  });

  it('sends nothing for a blank or unchanged title', () => {
    const h = open([row('a', 'Old title')]);
    const field = edit(h);
    field.value = '   ';
    h.key(field, 'Enter');
    const again = edit(h);
    again.value = '  Old title ';
    h.key(again, 'Enter');
    expect(h.view.sent).toHaveLength(1);
  });

  it('the Rename button starts the same edit, and the field is capped at 200 characters', () => {
    const h = open([row('a', 'Old title')]);
    must<HTMLButtonElement>(h.view.container, '.session-action').click();
    const field = must<HTMLInputElement>(h.view.container, 'input.session-rename-input');
    expect(field.maxLength).toBe(200);
    expect(field.getAttribute('aria-label')).toBe('New title for session Old title');
  });

  it('announces "Renamed to …" once the host answered and the new title is in the row', async () => {
    const h = open([row('a', 'Old title')]);
    const field = edit(h);
    field.value = 'Better';
    h.key(field, 'Enter');
    const { requestId } = splitRequestId(h.view.sent.at(-1));
    h.store.apply({ type: 'session.upserted', session: row('a', 'Better') });
    h.store.apply({ type: 'request.result', requestId });
    await flushMicrotasks();
    expect(must(h.view.container, '[role="status"]').textContent?.trim()).toBe('Renamed to Better');
  });
});

describe('delete', () => {
  it('Delete key and the Delete button only ASK the host: no confirmation lives in the webview', () => {
    const h = open([row('a', 'One'), row('b', 'Two')]);
    const first = h.mains()[0];
    if (first === undefined) throw new Error('no row');
    first.focus();
    h.key(first, 'Delete');
    expect(splitRequestId(h.view.sent.at(-1)).rest).toEqual({
      type: 'session.delete',
      sessionID: 'a',
    });
    expect(h.store.state.sessionOps['a']?.op).toBe('deleting');
    // The second row, through its button.
    const buttons = [...h.view.container.querySelectorAll<HTMLButtonElement>('.session-action')];
    buttons.find((b) => b.getAttribute('aria-label') === 'Delete session Two')?.click();
    expect(splitRequestId(h.view.sent.at(-1)).rest).toEqual({
      type: 'session.delete',
      sessionID: 'b',
    });
    expect(h.view.container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('a declined delete (success result, row still there) unlocks the row', () => {
    const h = open([row('a', 'One')]);
    h.mains()[0]?.focus();
    h.key(h.mains()[0] ?? document.body, 'Delete');
    const { requestId } = splitRequestId(h.view.sent.at(-1));
    h.store.apply({ type: 'request.result', requestId });
    expect(h.mains()[0]?.getAttribute('aria-disabled')).toBeNull();
  });

  it('a removed row disappears and, if the focus was on it, goes back to the search box', async () => {
    const h = open([row('a', 'One'), row('b', 'Two')]);
    h.mains()[0]?.focus();
    h.store.apply({ type: 'session.removed', sessionID: 'a' });
    await Promise.resolve();
    expect(h.mains()).toHaveLength(1);
    expect(document.activeElement).toBe(must(h.view.container, 'input[type="search"]'));
  });
});
