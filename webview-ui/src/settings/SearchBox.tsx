import * as l10n from '@vscode/l10n';
import { createMemo, createSignal, For, Show, type Accessor } from 'solid-js';
import { searchEntries, type SearchEntry } from './settingsSearch';

/**
 * The global search of the header (issue #186): a combobox with a list of jumps, not a filter.
 *
 * Typing opens a listbox with the entries of {@link searchEntries} (at most 20); ArrowDown and
 * ArrowUp move the highlight (the focus stays in the input, `aria-activedescendant` names the
 * option), Enter or a click chooses, Escape closes the list and a second Escape clears the text.
 * Choosing calls `onChoose` and closes the list, leaving the text, so the user sees what they
 * asked for. The list also closes when the focus leaves the component. The mouse presses an option
 * with `mousedown` and `preventDefault` (so the input keeps the focus until `onChoose` decides where
 * it goes) and CHOOSES on `click`: choosing on `mousedown` removed the list before the `click`, which
 * then landed on whatever sat under the pointer (the same defect that `test:visual` step 36 caught
 * in the provider picker, V6, 07/11/2026; here only `SearchBox.test.tsx` covers it, jsdom, and no
 * `test:visual` cell presses a search result). The component never moves the focus on its own.
 *
 * The file is `SearchBox.tsx`, not `SettingsSearch.tsx` as the plan said: next to the pure
 * `settingsSearch.ts` it would differ only by the case of the first letter, and on Windows and
 * macOS (case-insensitive) `import './SettingsSearch'` resolved to the `.ts` module and the
 * component came out `undefined` (seen in `SettingsApp.test.tsx`, Windows 11, 07/11/2026).
 *
 * VERIFIED by `SearchBox.test.tsx` (jsdom, fabricated entries): "wires the combobox, the listbox
 * and aria-activedescendant", "moves the highlight with the arrows, wrapping, and chooses with
 * Enter", "closes with Escape and clears with a second Escape" and "closes when the focus leaves,
 * and stays open when it moves inside". The look in four themes at 1080 and 300 px is VERIFIED in a
 * real VS Code 1.145.2 on Windows 11 (the full `npm run test:visual` of 08/11/2026 on the final
 * tree, "all visual checks passed", step
 * "46 OpenCode Settings: header, navigation and search (E10-settings-redesign)"): "ok
 * S1 1080 px (1080), dark: the search lists 20 jumps (2 to 20) inside the document (true), every row
 * inside the list (true), aria-expanded true and an active option, no sideways overflow (0 px) …".
 * UNVERIFIED: a screen reader announcing the options, and the mouse choosing an option in a real
 * iframe (no `test:visual` cell presses a result; the `click` choice is only in `SearchBox.test.tsx`).
 */
export function SettingsSearch(props: {
  entries: Accessor<readonly SearchEntry[]>;
  onChoose(entry: SearchEntry): void;
}) {
  const [text, setText] = createSignal('');
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  const results = createMemo(() => searchEntries(props.entries(), text()));
  const showList = (): boolean => open() && text().trim() !== '';
  const optionId = (index: number): string => `settings-search-option-${String(index)}`;
  let root: HTMLDivElement | undefined;

  const choose = (entry: SearchEntry): void => {
    setOpen(false);
    props.onChoose(entry);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const count = results().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!showList()) {
        setOpen(true);
        return;
      }
      if (count === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + count) % count);
    } else if (event.key === 'Enter') {
      const entry = results()[active()];
      if (showList() && entry !== undefined) {
        event.preventDefault();
        choose(entry);
      }
    } else if (event.key === 'Escape') {
      if (showList()) {
        event.preventDefault();
        setOpen(false);
      } else if (text() !== '') {
        event.preventDefault();
        setText('');
      }
    }
  };

  return (
    <div
      class="settings-search"
      ref={(element) => {
        root = element;
      }}
      onFocusOut={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !root?.contains(next)) setOpen(false);
      }}
    >
      <input
        type="text"
        class="settings-input settings-search-input"
        role="combobox"
        aria-label={l10n.t('Search settings')}
        aria-autocomplete="list"
        aria-expanded={showList()}
        aria-controls={showList() && results().length > 0 ? 'settings-search-list' : undefined}
        aria-activedescendant={showList() && results().length > 0 ? optionId(active()) : undefined}
        placeholder={l10n.t('Search settings…')}
        autocomplete="off"
        spellcheck={false}
        value={text()}
        onInput={(event) => {
          setText(event.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          if (text().trim() !== '') setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <Show when={showList()}>
        <ul class="settings-search-list" id="settings-search-list" role="listbox">
          <For
            each={results()}
            fallback={
              <li class="settings-search-empty" role="presentation">
                {l10n.t('Nothing matches “{0}”.', text().trim())}
              </li>
            }
          >
            {(entry, index) => (
              <li
                role="option"
                class="settings-search-option"
                id={optionId(index())}
                aria-selected={index() === active()}
                onMouseDown={(event) => {
                  // Keeps the focus in the input; the choice is made on `click`, see the header.
                  event.preventDefault();
                }}
                onClick={() => {
                  choose(entry);
                }}
                onMouseMove={() => {
                  setActive(index());
                }}
              >
                <span class="settings-search-label">{entry.label}</span>
                <span class="settings-search-detail">{entry.detail}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
