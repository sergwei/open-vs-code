import * as l10n from '@vscode/l10n';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import { plural } from '../../../src/shared/l10n';
import type { ProviderRow } from '../../../src/shared/settingsProtocol';
import {
  createFocusTrace,
  describeActive,
  type FocusTraceEvent,
  type FocusTraceFields,
  type FocusTraceWhy,
} from './focusTrace';
import { ProviderCard, type SendSettings } from './ProviderCard';
import type { SettingsStoreState } from './settingsStore';
import type { SettingsUi } from './settingsUiState';

/**
 * From every `arm` (and after a `focus` event that finds the document still unfocused) the parked
 * request is retried every 100 ms, 100 times (10 s). Picked by hand (issue #151): 100 ms gives 30
 * reads inside the 3 s of the F2 check of `test:visual` step 36, and VS Code itself polls
 * `document.hasFocus()` every 250 ms in its webview host page (HYPOTHESIS, read in 1.144.0
 * `pre/index.html`, `trackFocus`, not run); 10 s is far above those 3 s and only keeps the
 * interval from running forever when the focus went somewhere else. The gap between a `focus`
 * event and `document.hasFocus()` has never been measured.
 */
const POLL_MS = 100;
const POLL_TICKS = 100;

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
 * When the document has no focus the request is parked and served by a `window` `focus` listener
 * or by a poll that starts at every arm (to the card, and only if the focus is idle on the
 * `body`), so the card ends focused
 * on the success path (Enter: the row stays in "Connected" and the card is NOT rebuilt) and on the
 * Escape path, in either order of "the state without the attempt arrives" and "the focus comes
 * back from the box". The same request is also served when the attempt ends with the document
 * focused. "Never on the `body`" holds for Cancel from the card, VERIFIED in a real VS Code 1.144.0
 * on Windows 11 (1/11/2026, `test:visual` step 36, synthetic server): "ok   W2 after the attempt the
 * focus is on the Copilot card, not on the body (card focused true)". In jsdom (`SettingsApp.test.tsx`,
 * `document.activeElement`, `hasFocus` stubbed, fabricated states): the "keeps the focus on the
 * card ..." and "leaves the focus alone while another part of the window has it ..." cases, and
 * the Enter and Escape cases in both orders. VERIFIED in a real VS Code 1.144.1 on Windows 11
 * (3/11/2026, the full `npm run test:visual`, which ended "all visual checks passed", and
 * `npm run test:visual -- --steps 36` twice, synthetic server, this code including the poll; the
 * full run printed the same ok texts as below). In all three runs without the mutation F1 and F2
 * were served by the `window-focus` entry with `ticks=0` in the trace: the poll did not act, and
 * only the mutation below proves in a real VS Code that the poll serves. "ok   F1 after Enter in the key box the Azure card has the focus with the document focused
 * (true; document {"hasFocus":true,"active":"LI","activeProvider":"azure","parked":null}) and the
 * box is closed" and "ok   F2 Escape in the native box closes it (true), Azure is back in Add a
 * provider (true) and its card has the focus with the document focused (true; document
 * {"hasFocus":true,"active":"LI","activeProvider":"azure","parked":null}), and the host never
 * logged "provider connected: azure"". With the `window` `focus` listener removed (a mutation, since
 * reverted) F1 and F2 still passed, served by the poll with one tick and no `window-focus` entry in
 * the trace: the poll serves without the event. Not observed in this tree: S1 or S2 as the cause of
 * the failure. An earlier tree, without poll or trace, FAILED F2 in intermittent runs (document
 * {"hasFocus":true,"active":"BODY","activeProvider":null}); the final state alone did not say
 * whether the request had been used up or was still parked. Two HYPOTHESES for that cause, neither observed: (S1) a
 * `focus` event of `window` that arrives while `document.hasFocus()` is still false, with no
 * second event after it, and (S2) `hasFocus()` turning true with no `focus` event at all, because
 * VS Code 1.144.0 does not listen to `focus`/`blur` in the webview host page
 * (`pre/index.html`) but polls `document.hasFocus()` every 250 ms (`trackFocus`; read, not run).
 * Hence the request is retried by a poll that starts at every `arm` (`POLL_MS`, `POLL_TICKS`) and
 * restarts after a `focus` event that finds no focus, so it does not depend on the event; and the
 * end of the attempt goes through `arm` + `serve` instead of consuming the request when the card
 * is not in the DOM yet (S3). The jsdom cases "a focus event before the document has the focus
 * does not consume the request" and "with no focus event at all the poll focuses the card once hasFocus is true" cover
 * S1 and S2 with fabricated orders; that VS Code produces either order is not observed.
 *
 * Trace (issue #151): every `window` `focus` (with `hasFocus` and the armed id), arm, serve with
 * its result, poll start/stop, end of attempt, disarm with its reason and a card that loses the
 * focus to nowhere (S4) is annotated in a bounded ring (`focusTrace.ts`) published as JSON in the
 * `data-focus-trace` attribute of the container, where `test:visual` step 36 reads it. It stores
 * no value, text or key, and no annotation changes control flow. Not observed: which sequence a
 * failing run had, a screen reader, macOS and Linux.
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
  // `window` `focus` listener, or a poll that starts at every arm, serves it when the focus comes
  // back. Both orders of the two events (the host's state without the attempt, and the focus
  // returning from the box) end on the card, with or without the `focus` event.
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
  // The focus trace (issue #151): one per section instance, published in the container attribute
  // after every annotation. `note` fills `hf`, `armed` and `act` itself; it reads no signal.
  const trace = createFocusTrace();
  /** Annotates `e` with the current focus state plus `fields`, then republishes the attribute. */
  const note = (e: FocusTraceEvent, fields: FocusTraceFields = {}): void => {
    trace.record(e, {
      hf: document.hasFocus(),
      armed: armedID ?? null,
      act: describeActive(document),
      ...fields,
    });
    container?.setAttribute('data-focus-trace', trace.serialize());
  };
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let pollTicks = 0;
  /** Ends the poll if one runs and annotates `poll-stop` with `why` and the ticks spent; else a no-op. */
  const stopPolling = (why: FocusTraceWhy): void => {
    if (pollTimer === undefined) return;
    clearInterval(pollTimer);
    pollTimer = undefined;
    note('poll-stop', { why, ticks: pollTicks });
  };
  /**
   * (Re)starts the poll window: `serve` every POLL_MS for up to POLL_TICKS. Restarting replaces a
   * running poll without annotating its end. Individual ticks are not annotated (they would fill
   * the ring); only the start, the end with its tick count and the result that ends it are.
   */
  const startPolling = (): void => {
    if (pollTimer !== undefined) clearInterval(pollTimer);
    pollTicks = 0;
    note('poll-start');
    pollTimer = setInterval(() => {
      pollTicks++;
      if (serve('poll')) stopPolling('served');
      else if (pollTicks >= POLL_TICKS) stopPolling('limit');
    }, POLL_MS);
  };
  /** Forgets the parked request: annotates `disarm` if one was armed, stops the poll, removes the `focus` listener. */
  const disarm = (why: FocusTraceWhy): void => {
    if (armedID !== undefined) note('disarm', { why });
    armedID = undefined;
    stopPolling(why);
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
   * `source` only decides what is annotated: an event always records its result, a poll tick
   * records only the result that ends the request.
   */
  const serve = (source: 'event' | 'poll'): boolean => {
    const result = (why: FocusTraceWhy, over: boolean): boolean => {
      if (source === 'event' || over) note('serve', { why });
      return over;
    };
    const id = armedID;
    if (id === undefined) return result('nothing-armed', true);
    if (untrack(focusID) !== id) {
      result('id-changed', true);
      disarm('id-changed');
      return true;
    }
    if (!document.hasFocus()) return result('no-doc-focus', false);
    const card = cardOf(id);
    if (card === undefined) return result('no-card', false);
    // Only an idle focus (nothing, or the body the destroyed button left) is taken: a field the
    // user chose in the meantime stays.
    const active = document.activeElement;
    const idle = active === null || active === document.body;
    if (idle) card.focus();
    // While the attempt still runs the request stays: if the row then goes back to "Add a
    // provider" (Escape) its card is a new element, and the end of the attempt focuses that one.
    if (untrack(() => props.state.attempt) === undefined) setFocusID(undefined);
    result(idle ? 'served' : 'left-active', true);
    disarm('served');
    return true;
  };
  /** The `window` `focus` listener: annotates, serves, and reopens the poll window if still parked. */
  function onWindowFocus(): void {
    note('window-focus');
    if (serve('event')) return;
    // The event can come before `document.hasFocus()` says true, and no second event follows: look
    // again from now on (a fresh window of POLL_MS x POLL_TICKS; the listener stays armed).
    startPolling();
  }
  /** Parks the request for `id`, opens a fresh poll window and adds the `focus` listener once. */
  const arm = (id: string, why: FocusTraceWhy): void => {
    armedID = id;
    note('arm', { why });
    // Every arm opens a fresh poll window, so a long typing before Enter does not leave the
    // request waiting for an event that may never come.
    startPolling();
    if (listening) return;
    listening = true;
    window.addEventListener('focus', onWindowFocus);
  };
  onCleanup(() => {
    disarm('cleanup');
  });
  // The attempt that followed the press has ended: the card of that provider exists now (rebuilt or
  // not) and is asked for the focus. The state arrives as one batch, so the card is in the DOM.
  // The request is parked and served at once; if the card is not there yet or the document has no
  // focus, it stays parked for the poll and the `focus` event instead of being consumed.
  let sawAttempt = false;
  createEffect(() => {
    if (props.state.attempt !== undefined) {
      sawAttempt = true;
    } else if (sawAttempt) {
      sawAttempt = false;
      const id = untrack(focusID);
      if (id === undefined) return;
      note('attempt-end', { card: cardOf(id) !== undefined });
      arm(id, 'attempt-end');
      serve('event');
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
      arm(id, 'take-focus');
      return false;
    }
    disarm('direct');
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
        note('focusin');
        const owner = event.target.closest('[data-provider]');
        if (owner?.getAttribute('data-provider') !== untrack(focusID)) {
          setFocusID(undefined);
          disarm('focusin-other');
        }
      }}
      onFocusOut={(event) => {
        // S4: a card that had the focus loses it to nowhere (rebuilt, or the focus left the page).
        const target = event.target;
        if (target.hasAttribute('data-provider') && event.relatedTarget === null) {
          note('card-focusout');
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
                {` ${l10n.t('Loading the providers…')}`}
              </>
            }
          >
            {l10n.t('Could not read the providers from the server. Try Refresh.')}
          </Show>
        </p>
      </Show>
      <Show when={props.state.providers.loaded}>
        <Show when={top().length > 0}>
          <h2 class="settings-heading">{l10n.t('Connected')}</h2>
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
        <h2 class="settings-heading">{l10n.t('Add a provider')}</h2>
        <input
          type="search"
          class="settings-input"
          aria-label={l10n.t('Search providers')}
          placeholder={plural(
            addable().length,
            l10n.t('Search {0} provider…', addable().length),
            l10n.t('Search {0} providers…', addable().length),
          )}
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
                ? l10n.t('The server lists no other providers.')
                : l10n.t('No provider matches “{0}”.', props.ui.search().trim())}
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
