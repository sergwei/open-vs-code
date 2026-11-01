import { createEffect, createMemo, createSignal, For, Show, untrack } from 'solid-js';
import type { ProviderRow } from '../../../src/shared/settingsProtocol';
import { ProviderCard, type SendSettings } from './ProviderCard';
import type { SettingsStoreState } from './settingsStore';
import type { SettingsUi } from './settingsUiState';

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
 * "Never on the `body`" holds only for Cancel from the card, VERIFIED in a real VS Code 1.144.0 on
 * Windows 11 (1/11/2026, `test:visual` step 36, synthetic server): "ok   W2 after the attempt the
 * focus is on the Copilot card, not on the body (card focused true)", and in jsdom: the "keeps the
 * focus on the card ..." and "leaves the focus alone while another part of the window has it ..."
 * cases of `SettingsApp.test.tsx` (`document.activeElement`, `hasFocus` stubbed, fabricated
 * states). UNVERIFIED on the success path (Enter in the key box): the row stays in "Connected", the
 * store reconciles by id so the card is NOT rebuilt and nobody asks for the focus again; the focus
 * of the webview probably ends on the `body` (a follow-up, no cell measures it). On the Escape path
 * the rebuilt card takes the focus only if the document already has it when `settings.state`
 * arrives: HYPOTHESIS, check by reading `focusedCard` after an Escape in the box in `test:visual`.
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
  // focus to `body`; so the id is remembered and the card rebuilt for it takes the focus. It is
  // forgotten once the attempt that followed has ended, when the user focuses anything else, or when
  // a rebuilt card has taken it with no attempt running, so a later refresh cannot steal the focus.
  const [focusID, setFocusID] = createSignal<string | undefined>(undefined);
  let sawAttempt = false;
  createEffect(() => {
    if (props.state.attempt !== undefined) {
      sawAttempt = true;
    } else if (sawAttempt) {
      sawAttempt = false;
      queueMicrotask(() => {
        setFocusID(undefined);
      });
    }
  });
  const takeFocus = (id: string): boolean => {
    if (untrack(focusID) !== id) return false;
    // A key sign-in opens a native InputBox of the host at the same moment the row moves up. If
    // that box already has the focus, this document does not, and `card.focus()` would pull the
    // focus back into the webview and leave the box open but unable to take the key (found by
    // `test:visual` step 36, V7, 1/11/2026). Keep `focusID`: after Escape, the card rebuilt when the
    // box closes asks again (HYPOTHESIS that the document has the focus by then). After a
    // successful key the card is not rebuilt, so nobody asks again (UNVERIFIED, see the header).
    if (!document.hasFocus()) return false;
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
      onFocusIn={(event) => {
        const owner = event.target.closest('[data-provider]');
        if (owner?.getAttribute('data-provider') !== untrack(focusID)) setFocusID(undefined);
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
