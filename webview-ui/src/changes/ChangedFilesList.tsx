import { For, Show } from 'solid-js';
import type { ChangedFile } from '../../../src/shared/model';
import { metaText, openName } from './changedFileText';

/**
 * The rows of the "Changed files" list (issue #31): one button per file with its path, its status
 * in words and, unless it is binary, its `+added −deleted` counts. PRESENTATIONAL on purpose: it
 * knows nothing about the store or the host, so issue #32 (revert by message) can show "what would
 * be undone" with the same rows; the caller decides what `onOpen` does with the path.
 *
 * Each row is a real `<button>` (Tab, Enter and Space work) whose accessible name is the sentence
 * of {@link openName}; the visible path and meta stay short. `<For>` keys the rows by object
 * identity, and the store reconciles the list by `path`, so a row whose counts change keeps its
 * DOM node (and the focus) instead of being rebuilt. Nothing is drawn for an empty list. No
 * colour carries the status: it is a word, and the text uses the foreground colours. No `style`
 * attribute.
 * VERIFIED in jsdom by `ChangedFilesList.test.tsx` (fabricated rows: the text, the name, that a
 * click reports the exact path, that a changed count keeps the row node). Enter and Space on a row
 * are a browser feature of `<button>` that jsdom does not run. VERIFIED in a real VS Code by
 * `npm run test:visual` (Windows 11, 23/10/2026): the check "Enter on the deleted row opens a diff
 * editor" (the keyboard path) and the contrast checks of the changed-files text in each theme.
 * Space and macOS/Linux are UNVERIFIED in a real window.
 */
export function ChangedFilesList(props: {
  files: readonly ChangedFile[];
  onOpen: (path: string) => void;
}) {
  return (
    <Show when={props.files.length > 0}>
      <ul class="changed-files-list">
        <For each={props.files}>
          {(file) => (
            <li>
              <button
                type="button"
                class="secondary changed-file"
                data-status={file.binary ? 'binary' : file.status}
                aria-label={openName(file)}
                title={file.path}
                onClick={() => {
                  props.onOpen(file.path);
                }}
              >
                <span class="session-title">{file.path}</span>
                <span class="session-meta">{metaText(file)}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
