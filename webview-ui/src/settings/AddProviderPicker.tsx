import * as l10n from '@vscode/l10n';
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import { plural } from '../../../src/shared/l10n';
import type { ProviderRow } from '../../../src/shared/settingsProtocol';
import { methodSummary } from './ProviderCard';

/** Most providers listed at once; the catalogue has about 240 and a narrow tab should not paint them all. */
const MAX_LISTED = 30;

/** True when `row` matches `search` (name or id, ignoring case and surrounding spaces); blank matches all. */
export function matchesProvider(row: ProviderRow, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') return true;
  return row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle);
}

/**
 * The "Add provider" picker (issue #186, phase 1.3): a search box and a list of every provider that
 * is not connected, each with a summary of how it connects. It is a combobox of the webview, not a
 * native QuickPick: the connect form lives in the webview, the focus never jumps to the palette, and
 * `test:visual` can measure it at every width and theme (decision of plan #2037).
 *
 * Typing filters BEFORE painting and the list stops at {@link MAX_LISTED} entries, saying how many
 * more match, so 240 providers are never painted at once (HYPOTHESIS that painting them all is slow:
 * never measured; the cap is a precaution). ArrowDown and ArrowUp move the highlight, the focus
 * staying in the input with `aria-activedescendant`; Enter or a click calls `onChoose` with the
 * provider id (the mouse chooses on `click`, NOT on `mousedown`: the first design chose on
 * `mousedown`, the form that replaced the list appeared under the pointer and the `click` that
 * followed pressed the title button of its card, closing it again: `test:visual` step 36, V6,
 * "card focused false", 07/11/2026); Escape calls `onClose`, and the parent returns the focus to its "Add provider"
 * button. The input takes the focus when the picker opens, because the user just pressed the button
 * that opened it; nothing else moves the focus. The text is the persisted `search` of the tab, so
 * reopening the picker keeps what was typed.
 * VERIFIED in jsdom by `AddProviderPicker.test.tsx` (fabricated rows): the filter by name or id, the
 * keyboard, Escape, the cap and the focus on opening. VERIFIED in a real VS Code 1.145.2 on Windows
 * 11 (7/11/2026, `npm run test:visual -- --steps 36` and `--steps 35,46,47,48`, synthetic server):
 * "ok   V1 the picker lists 5 providers and typing "azu" in it leaves one (["azure"])", "ok   V1
 * Escape closes the picker and the focus goes back to "+ Add provider"" and, at 620 and 300 px in
 * four themes, "ok   P1 620 px (620), dark: the picker lists 5 providers inside the document (true)
 * with every row inside the list (true) over the open Copilot form (true) … min contrast 8.10 over
 * 6 texts". NOT observed: the cap of 30 in a real page (the fixture lists 5), the keyboard arrows
 * in a real iframe. Those runs were on an EARLIER tree than the current one; the final full
 * `test:visual` of the branch is what covers this tree, and no run of it is claimed here. The
 * highlight is clamped to the list as it is now, so a list that shrinks with the picker open keeps
 * `aria-activedescendant` on an existing option and Enter choosing it; `aria-controls` is set only
 * while the list is painted. VERIFIED by the check "clamps the highlight when the list shrinks and
 * drops aria-controls without a list" of `AddProviderPicker.test.tsx` (jsdom, fabricated rows). The
 * arrows also start from the clamped value: VERIFIED by "moves the arrows from the clamped
 * highlight after the list shrinks" of the same file (jsdom, fabricated rows; red under the
 * mutation that moves from the raw highlight).
 */
export function AddProviderPicker(props: {
  rows: readonly ProviderRow[];
  search: string;
  onSearch(text: string): void;
  onChoose(id: string): void;
  onClose(): void;
}) {
  const [highlight, setActive] = createSignal(0);
  const matching = createMemo(() => props.rows.filter((row) => matchesProvider(row, props.search)));
  const listed = createMemo(() => matching().slice(0, MAX_LISTED));
  // The highlight is clamped to the list as it is NOW: `rows` can shrink with the picker open (a
  // provider connects), and a stale index named an option that no longer exists (review S3).
  const active = (): number => Math.min(highlight(), Math.max(listed().length - 1, 0));
  const optionId = (index: number): string => `provider-picker-option-${String(index)}`;
  let input: HTMLInputElement | undefined;

  onMount(() => {
    input?.focus();
  });

  const onKeyDown = (event: KeyboardEvent): void => {
    const count = listed().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // From the clamped `active()`, not the raw highlight: with highlight 4 on a list that shrank
      // to 3 rows, ArrowDown must wrap to 0 instead of landing on 2 (review S2, closing round).
      setActive((active() + step + count) % count);
    } else if (event.key === 'Enter') {
      const row = listed()[active()];
      if (row !== undefined) {
        event.preventDefault();
        props.onChoose(row.id);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
    }
  };

  return (
    <div class="provider-picker">
      <input
        type="search"
        class="settings-input"
        role="combobox"
        aria-label={l10n.t('Search providers')}
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listed().length > 0 ? 'provider-picker-list' : undefined}
        aria-activedescendant={listed().length > 0 ? optionId(active()) : undefined}
        placeholder={plural(
          props.rows.length,
          l10n.t('Search {0} provider…', props.rows.length),
          l10n.t('Search {0} providers…', props.rows.length),
        )}
        autocomplete="off"
        spellcheck={false}
        ref={(element) => {
          input = element;
          element.value = props.search;
        }}
        onInput={(event) => {
          props.onSearch(event.currentTarget.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <Show
        when={listed().length > 0}
        fallback={
          <p class="settings-empty">
            {props.rows.length === 0
              ? l10n.t('The server lists no other providers.')
              : l10n.t('No provider matches “{0}”.', props.search.trim())}
          </p>
        }
      >
        <ul class="provider-picker-list" id="provider-picker-list" role="listbox">
          <For each={listed()}>
            {(row, index) => (
              <li
                role="option"
                class="provider-picker-option"
                id={optionId(index())}
                data-option={row.id}
                aria-selected={index() === active()}
                onMouseDown={(event) => {
                  // Keeps the focus in the input; the choice is made on `click`, see the header.
                  event.preventDefault();
                }}
                onClick={() => {
                  props.onChoose(row.id);
                }}
                onMouseMove={() => {
                  setActive(index());
                }}
              >
                <span class="provider-picker-name">{row.name}</span>
                <span class="provider-picker-detail">{methodSummary(row.methods)}</span>
              </li>
            )}
          </For>
        </ul>
        <Show when={matching().length > listed().length}>
          <p class="settings-hint">
            {l10n.t(
              '{0} more match: keep typing to narrow the list.',
              matching().length - listed().length,
            )}
          </p>
        </Show>
      </Show>
    </div>
  );
}
