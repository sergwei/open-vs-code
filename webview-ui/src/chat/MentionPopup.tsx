import { createEffect, For, Show } from 'solid-js';
import type { ErrorInfo } from '../../../src/shared/model';
import type { AttachmentRef } from '../../../src/shared/protocol';

/** What the popup shows: the store's `fileSearch` reduced to what a render needs. */
export interface FileSearchView {
  /** The text the files answer, or the one being asked while `loading`. */
  query: string;
  files: readonly AttachmentRef[];
  loading: boolean;
  error?: ErrorInfo;
}

/** What the popup has to say for a typed `query`. */
export type MentionStatus = 'hint' | 'list' | 'loading' | 'empty' | 'error';

/**
 * Decides what the popup shows for the `query` under the caret (an empty one is the bare `@`).
 *
 * Results win over everything else, stale ones included: while a newer search runs the old list
 * stays on screen (it flickers less) and the user may still click a row, which is a valid file the
 * host offered. Without results, a failure is shown, then "searching" for as long as the answer
 * is not for this query (the debounce has not fired, or the request is in flight), and "no files"
 * only for an answered query. `PromptInput` reuses it to know whether Enter may pick a row.
 */
export function mentionStatus(query: string, search: FileSearchView): MentionStatus {
  if (query === '') return 'hint';
  if (search.files.length > 0) return 'list';
  if (search.error !== undefined) return 'error';
  if (search.loading || search.query !== query) return 'loading';
  return 'empty';
}

/** The DOM id of option `index` of the listbox `listId`; the textarea points at it. */
export function optionId(listId: string, index: number): string {
  return `${listId}-option-${String(index)}`;
}

/** Splits `src/chat/PromptInput.tsx` into its folder (`src/chat`) and file name. */
function splitName(name: string): { dir: string; base: string } {
  const slash = name.lastIndexOf('/');
  return slash === -1
    ? { dir: '', base: name }
    : { dir: name.slice(0, slash), base: name.slice(slash + 1) };
}

/**
 * The list of files that opens above the prompt while an `@` mention is typed (issue #28).
 *
 * It is a listbox that NEVER takes the focus: the user keeps typing in the textarea, which points
 * at the highlighted row with `aria-activedescendant` (the pattern of a combobox), unlike the
 * model picker, whose focus travels into its list. Rows are picked with the mouse on `mousedown`
 * with `preventDefault`, so the textarea does not blur (a blur closes the popup before the click
 * lands). The keyboard (arrows, Enter, Tab, Escape) is handled by `PromptInput`, which owns the
 * textarea. The listbox is always in the DOM while the popup is open so the textarea's
 * `aria-controls` never dangles; the hint, "Searching…", "No files match" and the error are a
 * line next to it. What a screen reader hears is a separate live region in `PromptInput`.
 * Colours are the suggest-widget variables of VS Code (`index.css`).
 * VERIFIED by `PromptInput.test.tsx` in jsdom. VERIFIED in a real VS Code 1.143.0 on Windows 11
 * (22/10/2026, `test:visual` step 16): a real mouse press on a row picks it and "the focus is still
 * in the prompt box after the mouse pick"; text contrast of a normal row, the highlighted row and
 * the "No files match" line is >= 4.5 in light, dark, hc-dark and hc-light (the lowest, the folder
 * part of a normal row: 5.47 in hc-light). NOT observed: the other states ("Searching…", the error)
 * in a real window, a long list that scrolls, a real screen reader and `aria-activedescendant` on a
 * textarea (UNVERIFIED).
 */
export function MentionPopup(props: {
  id: string;
  query: string;
  search: FileSearchView;
  /** Index of the highlighted row (`aria-selected`), when the status is `list`. */
  active: number;
  onPick(file: AttachmentRef): void;
}) {
  const status = () => mentionStatus(props.query, props.search);

  // Keep the highlighted row visible when the list scrolls. jsdom has no `scrollIntoView`.
  createEffect(() => {
    const row = document.getElementById(optionId(props.id, props.active));
    if (props.search.files.length > 0 && typeof row?.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  });

  return (
    <div class="mention-popup">
      <ul
        id={props.id}
        class="mention-list"
        role="listbox"
        aria-label="Files"
        aria-busy={props.search.loading}
      >
        <Show when={status() === 'list'}>
          <For each={props.search.files}>
            {(file, index) => (
              <li
                id={optionId(props.id, index())}
                class="mention-option"
                role="option"
                aria-label={file.name}
                aria-selected={index() === props.active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  props.onPick(file);
                }}
              >
                <span class="mention-name">{splitName(file.name).base}</span>
                <span class="mention-dir">{splitName(file.name).dir}</span>
              </li>
            )}
          </For>
        </Show>
      </ul>
      <Show when={status() !== 'list'}>
        <div class="mention-status">
          {status() === 'hint' && 'Type to search files'}
          {status() === 'loading' && 'Searching…'}
          {status() === 'empty' && 'No files match'}
          {status() === 'error' &&
            `Search failed: ${props.search.error?.message ?? 'unknown error'}`}
        </div>
      </Show>
    </div>
  );
}
