import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { MAX_SESSION_SEARCH_LENGTH } from '../../../src/shared/protocol';
import { useSend } from '../chat/hostContext';
import { nextRequestId } from '../chat/PromptInput';
import type { ChatStore } from '../store/chatStore';
import { groupSessions } from './sessionGroups';
import { SessionRow } from './SessionRow';

/** Built from its code point: a literal one in the source trips `no-irregular-whitespace`. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * Wait after the last keystroke before the search goes to the host. Our own choice (issue #20, no
 * measurement): long enough that typing a word sends one query, short enough to feel immediate.
 */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * The session list dropdown (issue #20): a panel under the header with a search box, the root
 * sessions of the folder grouped by date, "Show more", and per-row Rename and Delete.
 *
 * Opening it sends `sessions.query` (a fresh list every time, then the events keep it current) and
 * puts the focus in the search box; typing sends a new query after {@link SEARCH_DEBOUNCE_MS}, and
 * the SERVER filters by title, so it finds sessions older than any loaded page. The webview never
 * decides a delete: the button only sends `session.delete` and the host asks the user with a native
 * modal. It is a `role="dialog"` that is NOT modal: Escape, a click outside or opening a session
 * closes it (`onClose(true)` returns the focus to the "Sessions" button, `false` leaves it where the
 * user clicked). Keyboard: ArrowDown from the search box enters the list; inside it ArrowUp/Down,
 * Home and End move between rows (roving tabindex: only one row is a tab stop), ArrowUp from the
 * first row goes back to the search box. A polite live region announces loading, the count, the
 * empty result and a finished rename; phrases are built as strings (JSX eats line breaks between
 * `{expr}` and text: lesson #926) and repeated ones alternate a no-break space (lesson #918).
 * When rows disappear and the focus was lost with them (a deleted row), it goes back to the search
 * box; deleting the OPEN session does not close the list or move the focus to the prompt (decision
 * of Sergio, 21/10/2026: the user is inside the list and may act on another row). "Show more"
 * stays focusable and ignores the click while a page is loading (`aria-disabled`, not `disabled`,
 * so the keyboard user keeps their place). VERIFIED by `SessionPicker.test.tsx` in jsdom with a fake host; the real look and the
 * focus ring are checked by `npm run test:visual` (step 9), Windows only; screen readers UNVERIFIED.
 */
export function SessionPicker(props: {
  store: ChatStore;
  onOpenSession(sessionID: string): void;
  onClose(restoreFocus: boolean): void;
}) {
  const state = props.store.state;
  const send = useSend();
  const [search, setSearch] = createSignal('');
  const [activeId, setActiveId] = createSignal<string | undefined>();
  const [announcement, setAnnouncement] = createSignal('');
  const [now, setNow] = createSignal(Date.now());
  const [renameTarget, setRenameTarget] = createSignal<{ id: string; title: string } | undefined>();
  let panel: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let flip = false;

  /** Asks the host for a page. `more` continues the previous query of the same search. */
  const runQuery = (text: string, more: boolean): void => {
    const requestId = nextRequestId();
    props.store.beginQuery(requestId, text);
    send({ type: 'sessions.query', requestId, search: text, more });
  };

  /** Announces `text`, alternating a trailing no-break space so a repeat is read again. */
  const announce = (text: string): void => {
    flip = !flip;
    setAnnouncement(flip ? text : `${text}${NO_BREAK_SPACE}`);
  };

  const groups = createMemo(() => groupSessions(state.browser.rows, now()));
  /** Group names only, so a page that changes the rows keeps the DOM of the groups that stay. */
  const labels = createMemo(() => groups().map((group) => group.label), [], {
    equals: (a, b) => a.length === b.length && a.every((label, index) => label === b[index]),
  });
  const rowsOf = (label: string) => groups().find((group) => group.label === label)?.rows ?? [];

  /** The row that is the tab stop: the last focused one, else the open session, else the first. */
  const tabbableId = createMemo(() => {
    const ids = state.browser.rows.map((row) => row.id);
    const wanted = activeId();
    if (wanted !== undefined && ids.includes(wanted)) return wanted;
    const open = state.open.sessionID;
    if (open !== undefined && ids.includes(open)) return open;
    return ids[0];
  });

  const statusText = createMemo(() => {
    const { loading, loaded, rows } = state.browser;
    if (loading && rows.length === 0) return 'Loading sessions…';
    if (loaded && rows.length === 0) {
      return state.browser.search.trim() === '' ? 'No sessions yet' : 'No sessions match';
    }
    return '';
  });

  const mains = (): HTMLButtonElement[] => [
    ...(panel?.querySelectorAll<HTMLButtonElement>('button.session-main') ?? []),
  ];

  /** Moves the focus to the `index`-th row button (clamped); before the first goes to the search. */
  const focusRow = (index: number): void => {
    const buttons = mains();
    if (index < 0) {
      searchInput?.focus();
      return;
    }
    buttons[Math.min(index, buttons.length - 1)]?.focus();
  };

  const onListKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains('session-main')) {
      return;
    }
    const buttons = mains();
    const index = buttons.indexOf(target);
    if (event.key === 'ArrowDown') focusRow(index + 1);
    else if (event.key === 'ArrowUp') focusRow(index - 1);
    else if (event.key === 'Home') focusRow(0);
    else if (event.key === 'End') focusRow(buttons.length - 1);
    else return;
    event.preventDefault();
  };

  const onSearchKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    const stop = mains().find((button) => button.tabIndex === 0);
    (stop ?? mains()[0])?.focus();
  };

  const onPanelKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    props.onClose(true);
  };

  const onOutsidePointer = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Node) || panel?.contains(target)) return;
    // The "Sessions" button toggles the panel by itself; closing here too would reopen it.
    if (target instanceof Element && target.closest('[data-session-trigger]') !== null) return;
    props.onClose(false);
  };

  const rename = (sessionID: string, title: string): void => {
    const requestId = nextRequestId();
    props.store.beginSessionOp(sessionID, 'renaming', requestId);
    setRenameTarget({ id: sessionID, title });
    send({ type: 'session.rename', requestId, sessionID, title });
  };

  const remove = (sessionID: string): void => {
    const requestId = nextRequestId();
    props.store.beginSessionOp(sessionID, 'deleting', requestId);
    send({ type: 'session.delete', requestId, sessionID });
  };

  onMount(() => {
    runQuery('', false);
    searchInput?.focus();
    document.addEventListener('pointerdown', onOutsidePointer, true);
  });
  onCleanup(() => {
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    clearTimeout(debounce);
  });

  createEffect(
    on(
      () => state.browser.rows.length,
      () => {
        setNow(Date.now());
        // A row that held the focus may be gone (deleted); do not leave the focus on the page.
        queueMicrotask(() => {
          const active = document.activeElement;
          if (panel === undefined || !panel.isConnected) return;
          if (active === null || active === document.body) searchInput?.focus();
        });
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    const { loading, loaded, rows } = state.browser;
    if (loading) {
      announce('Loading sessions…');
    } else if (loaded) {
      const count = rows.length;
      if (count === 0) announce(statusText());
      else announce(`${String(count)} session${count === 1 ? '' : 's'}`);
    }
  });

  // "Renamed to …" once the host has answered and the new title is already in the row.
  createEffect(() => {
    const target = renameTarget();
    if (target === undefined || state.sessionOps[target.id] !== undefined) return;
    setRenameTarget(undefined);
    const row = state.browser.rows.find((held) => held.id === target.id);
    if (row?.title === target.title) announce(`Renamed to ${target.title}`);
  });

  return (
    <div
      class="session-picker"
      role="dialog"
      aria-label="Sessions"
      ref={(element) => {
        panel = element;
      }}
      onKeyDown={onPanelKeyDown}
    >
      <input
        type="search"
        class="session-search"
        aria-label="Search sessions"
        placeholder="Search by title"
        maxlength={MAX_SESSION_SEARCH_LENGTH}
        value={search()}
        ref={(element) => {
          searchInput = element;
        }}
        onInput={(event) => {
          const text = event.currentTarget.value;
          setSearch(text);
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            runQuery(text, false);
          }, SEARCH_DEBOUNCE_MS);
        }}
        onKeyDown={onSearchKeyDown}
      />
      <div class="visually-hidden" role="status" aria-live="polite">
        {announcement()}
      </div>
      <Show when={statusText() !== ''}>
        <p class="session-status">{statusText()}</p>
      </Show>
      <div class="session-groups" onKeyDown={onListKeyDown}>
        <For each={labels()}>
          {(label) => (
            <section class="session-group" aria-label={label}>
              <h3 class="session-group-title">{label}</h3>
              <ul class="session-list">
                <For each={rowsOf(label)}>
                  {(row) => (
                    <SessionRow
                      row={row}
                      current={state.open.sessionID === row.id}
                      tabbable={tabbableId() === row.id}
                      running={
                        state.statuses[row.id]?.type === 'busy' ||
                        state.statuses[row.id]?.type === 'retry'
                      }
                      needsInput={
                        state.requests.permissions.some((ask) => ask.sessionID === row.id) ||
                        state.requests.forms.some((ask) => ask.sessionID === row.id)
                      }
                      op={state.sessionOps[row.id]}
                      now={now()}
                      onOpen={() => {
                        props.onOpenSession(row.id);
                      }}
                      onRename={(title) => {
                        rename(row.id, title);
                      }}
                      onDelete={() => {
                        remove(row.id);
                      }}
                      onFocusRow={() => {
                        setActiveId(row.id);
                      }}
                    />
                  )}
                </For>
              </ul>
            </section>
          )}
        </For>
      </div>
      <Show when={state.browser.hasMore}>
        <button
          type="button"
          class="secondary session-more"
          aria-disabled={state.browser.loading ? 'true' : undefined}
          onClick={() => {
            // `aria-disabled`, not `disabled`: pressed with the keyboard, a button that becomes
            // disabled while it holds the focus drops it onto the page (lesson #981, review W2).
            if (state.browser.loading) return;
            runQuery(state.browser.search, true);
          }}
        >
          Show more
        </button>
      </Show>
    </div>
  );
}
