import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import type { ProviderRow } from '../../../src/shared/settingsProtocol';
import { ProviderCard, type SendSettings } from './ProviderCard';
import type { SettingsStoreState } from './settingsStore';
import type { SettingsUi } from './settingsUiState';

/**
 * After a `focus` event that finds the document still unfocused, the parked request is retried
 * every 50 ms, 20 times (1 s). Values picked by hand: the gap between the event and
 * `document.hasFocus()` has never been measured (HYPOTHESIS that it exists), and the cap only keeps
 * the interval from running forever when the focus went somewhere else.
 */
const POLL_MS = 50;
const POLL_TICKS = 20;

/** True when `row` matches the search text (name or id, ignoring case and surrounding spaces). */
export function matchesSearch(row: ProviderRow, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') return true;
  return row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle);
}

/**
 * The Providers tab (issue #128, E10): the connected providers (and the one signing in) on top,
 * then "Add a provider" with a search box over the rest.
 *
 * The search filters in a memo BEFORE anything is painted, so a narrow tab never builds the ~236
 * cards of the catalogue when the user has typed a word (the unfiltered list is not capped:
 * HYPOTHESIS that painting 236 collapsed rows is cheap, never measured; if the tab is slow at
 * 300 px, cap the list with a "Show more" button). A provider with a connection, or the one the
 * host is signing in to, lives in the first list and is NOT offered in the second; to change a
 * connection the user removes it first. The three empty states (loading, failed read, nothing
 * listed) are different sentences, so "no providers" is never said while the first read is still
 * running. VERIFIED by `SettingsApp.test.tsx` and `ProviderCard.test.tsx` (jsdom, fabricated
 * rows) and, for the look at 300/620/1080 px in four themes, by `test:visual` step 35 in a real VS
 * Code 1.144.0 on Windows 11 (1/11/2026, synthetic server): "ok   V1 300 px, hc-light: Connected
 * lists Anthropic (API key, Remove) and Google Vertex …" (12 combinations).
 *
 * Focus: pressing a primary button moves its row between the two lists, which rebuilds the card;
 * the section remembers the provider the user acted on and the rebuilt card takes the focus, in
 * "Connected" while it signs in and back in "Add a provider" if the attempt is cancelled or fails,
 * and only while this document has the focus: a key sign-in opens a native InputBox at the same
 * time, and a card that pulled the focus back would leave that box open but unable to take the key.
 * When the document has no focus the request is parked and a single `window` `focus` listener
 * serves it (to the card, and only if the focus is idle on the `body`), so the card ends focused
 * on the success path (Enter: the row stays in "Connected" and the card is NOT rebuilt) and on the
 * Escape path, in either order of "the state without the attempt arrives" and "the focus comes
 * back from the box". The same request is also served when the attempt ends with the document
 * focused. "Never on the `body`" holds for Cancel from the card, VERIFIED in a real VS Code 1.144.0
 * on Windows 11 (1/11/2026, `test:visual` step 36, synthetic server): "ok   W2 after the attempt the
 * focus is on the Copilot card, not on the body (card focused true)". In jsdom (`SettingsApp.test.tsx`,
 * `document.activeElement`, `hasFocus` stubbed, fabricated states): the "keeps the focus on the
 * card ..." and "leaves the focus alone while another part of the window has it ..." cases, and
 * the Enter and Escape cases in both orders. VERIFIED in a real VS Code 1.144.0 on Windows 11
 * (2/11/2026, `npm run test:visual -- --group config` and `--steps 36`, synthetic server): "ok   F1
 * after Enter in the key box the Azure card has the focus with the document focused (true) and the
 * box is closed" and "ok   F2 Escape in the native box closes it (true), Azure is back in Add a
 * provider (true) and its card has the focus with the document focused (true; document
 * {"hasFocus":true,"active":"LI","activeProvider":"azure"}), and the host never logged "provider
 * connected: azure"". F2 also FAILED in two runs on idle or loaded machines (the first run that had
 * the cell, and a full run of the final tree: document {"hasFocus":true,"active":"BODY",
 * "activeProvider":null}): the card ended unfocused, but that diagnostic does not say whether the
 * request had been used up or was still parked and never served. HYPOTHESIS for the cause, not
 * observed: a `focus` event of `window` that arrives while `document.hasFocus()` is
 * still false, with no second event after it; the request now stays parked in that case and is
 * retried every 50 ms for 1 s (`serve`, `onWindowFocus`), and the jsdom cases "a focus event before
 * the document has the focus does not consume the request" (Enter and Escape) went red without it.
 * With it, F1 and F2 passed in five `--steps 36` runs and in the final full run (2/11/2026, the
 * same texts as above). Not observed: which order VS Code produced in each run, the gap between the event and
 * `hasFocus()` in a real run, a screen reader, macOS and Linux.
 */
export function ProvidersSection(props: {
  state: SettingsStoreState;
  ui: SettingsUi;
  send: SendSettings;
}) {
  const attemptID = () => props.state.attempt?.integrationID;
  const isTop = (row: ProviderRow): boolean => row.connections.length > 0 || row.id === attemptID();
  const top = createMemo(() => props.state.providers.rows.filter(isTop));
  const addable = createMemo(() => props.state.providers.rows.filter((row) => !isTop(row)));
  const shown = createMemo(() => addable().filter((row) => matchesSearch(row, props.ui.search())));
  const busy = () => props.state.attempt !== undefined;

  // Focus follows the provider the user acted on. Pressing its primary button moves the row to the
  // top list (and back if the attempt is cancelled or fails), which rebuilds the card and drops the
  // focus to `body`; so the id is remembered and the card rebuilt for it takes the focus. A key
  // sign-in that succeeds does NOT rebuild the card, and a native box that is still closing holds
  // the focus, so when this document has no focus the request is parked (`armedID`) and ONE
  // `window` `focus` listener serves it when the focus comes back. Both orders of the two events
  // (the host's state without the attempt, and the focus returning from the box) end on the card.
  // The id is forgotten once it has been served, when the user focuses anything else, or when the
  // section goes away, so a later refresh cannot steal the focus.
  const [focusID, setFocusID] = createSignal<string | undefined>(undefined);
  let container: HTMLDivElement | undefined;
  let armedID: string | undefined;
  let listening = false;
  const cardOf = (id: string): HTMLElement | undefined =>
    Array.from(container?.querySelectorAll<HTMLElement>('[data-provider]') ?? []).find(
      (element) => element.getAttribute('data-provider') === id,
    );
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const stopPolling = (): void => {
    if (pollTimer !== undefined) clearInterval(pollTimer);
    pollTimer = undefined;
  };
  const disarm = (): void => {
    armedID = undefined;
    stopPolling();
    if (listening) window.removeEventListener('focus', onWindowFocus);
    listening = false;
  };
  /**
   * Serves the parked request if it can be served now. True when it is over: nothing is armed,
   * it was served (which includes the guard leaving a focus the user chose where it is), or its id
   * is no longer the one the user acted on; false when it stays parked: the document has no focus
   * yet (the native box, or the host page around the webview, still holds it), or the card is not
   * in the DOM yet. Nothing is consumed in the false cases: a `focus` event that arrives while
   * `document.hasFocus()` is still false must not use the request up (E10-settings-followup, F2).
   */
  const serve = (): boolean => {
    const id = armedID;
    if (id === undefined) return true;
    if (untrack(focusID) !== id) {
      disarm();
      return true;
    }
    if (!document.hasFocus()) return false;
    const card = cardOf(id);
    if (card === undefined) return false;
    // Only an idle focus (nothing, or the body the destroyed button left) is taken: a field the
    // user chose in the meantime stays.
    const active = document.activeElement;
    if (active === null || active === document.body) card.focus();
    // While the attempt still runs the request stays: if the row then goes back to "Add a
    // provider" (Escape) its card is a new element, and the end of the attempt focuses that one.
    if (untrack(() => props.state.attempt) === undefined) setFocusID(undefined);
    disarm();
    return true;
  };
  function onWindowFocus(): void {
    if (serve()) return;
    // The event can come before `document.hasFocus()` says true, and no second event follows: look
    // again every POLL_MS for up to POLL_TICKS, then give up polling (the listener stays armed).
    stopPolling();
    let ticks = 0;
    pollTimer = setInterval(() => {
      ticks++;
      if (serve() || ticks >= POLL_TICKS) stopPolling();
    }, POLL_MS);
  }
  const arm = (id: string): void => {
    armedID = id;
    if (listening) return;
    listening = true;
    window.addEventListener('focus', onWindowFocus);
  };
  onCleanup(disarm);
  // The attempt that followed the press has ended: the card of that provider exists now (rebuilt or
  // not) and is asked for the focus. The state arrives as one batch, so the card is in the DOM.
  let sawAttempt = false;
  createEffect(() => {
    if (props.state.attempt !== undefined) {
      sawAttempt = true;
    } else if (sawAttempt) {
      sawAttempt = false;
      const id = untrack(focusID);
      if (id === undefined) return;
      if (document.hasFocus()) {
        cardOf(id)?.focus();
        disarm();
        setFocusID(undefined);
      } else {
        arm(id);
      }
    }
  });
  const takeFocus = (id: string): boolean => {
    if (untrack(focusID) !== id) return false;
    // A key sign-in opens a native InputBox of the host at the same moment the row moves up. If
    // that box already has the focus, this document does not, and `card.focus()` would pull the
    // focus back into the webview and leave the box open but unable to take the key (found by
    // `test:visual` step 36, V7, 1/11/2026). Keep `focusID` and park the request: the focus
    // returning from the box (Escape or Enter) serves it through `onWindowFocus`.
    if (!document.hasFocus()) {
      arm(id);
      return false;
    }
    disarm();
    if (props.state.attempt === undefined) queueMicrotask(() => setFocusID(undefined));
    return true;
  };
  const send: SendSettings = (message) => {
    if (message.type === 'settings.connect') setFocusID(message.integrationID);
    props.send(message);
  };
  return (
    <div
      class="settings-providers"
      ref={(element) => {
        container = element;
      }}
      onFocusIn={(event) => {
        const owner = event.target.closest('[data-provider]');
        if (owner?.getAttribute('data-provider') !== untrack(focusID)) {
          setFocusID(undefined);
          disarm();
        }
      }}
    >
      <Show when={!props.state.providers.loaded}>
        <p class="settings-empty" role="status">
          <Show
            when={props.state.providers.failed}
            fallback={
              <>
                <span class="spinner" aria-hidden="true" />
                {' Loading the providers…'}
              </>
            }
          >
            Could not read the providers from the server. Try Refresh.
          </Show>
        </p>
      </Show>
      <Show when={props.state.providers.loaded}>
        <Show when={top().length > 0}>
          <h2 class="settings-heading">Connected</h2>
          <ul class="setup-steps" role="list">
            <For each={top()}>
              {(row) => (
                <ProviderCard
                  row={row}
                  attempt={row.id === attemptID() ? props.state.attempt : undefined}
                  remote={props.state.remote}
                  busy={busy()}
                  ui={props.ui}
                  send={send}
                  takeFocus={takeFocus}
                />
              )}
            </For>
          </ul>
        </Show>
        <h2 class="settings-heading">Add a provider</h2>
        <input
          type="search"
          class="settings-input"
          aria-label="Search providers"
          placeholder={`Search ${String(addable().length)} providers…`}
          autocomplete="off"
          spellcheck={false}
          ref={(element) => {
            element.value = untrack(() => props.ui.search());
          }}
          onInput={(event) => {
            props.ui.setSearch(event.currentTarget.value);
          }}
        />
        <Show
          when={shown().length > 0}
          fallback={
            <p class="settings-empty">
              {addable().length === 0
                ? 'The server lists no other providers.'
                : `No provider matches “${props.ui.search().trim()}”.`}
            </p>
          }
        >
          <ul class="setup-steps" role="list">
            <For each={shown()}>
              {(row) => (
                <ProviderCard
                  row={row}
                  attempt={undefined}
                  remote={props.state.remote}
                  busy={busy()}
                  ui={props.ui}
                  send={send}
                  takeFocus={takeFocus}
                />
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  );
}
