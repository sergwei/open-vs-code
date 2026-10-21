import { createMemo, createSignal, Show, untrack } from 'solid-js';
import type { SessionSummary } from '../../../src/shared/model';
import { MAX_SESSION_TITLE_LENGTH } from '../../../src/shared/protocol';
import type { SessionOp } from '../store/chatStore';
import { formatSessionTime, sessionLabel } from './sessionGroups';

/**
 * One row of the session list (issue #20): the main button that opens the session, and the
 * Rename and Delete buttons, which appear on hover and whenever focus is inside the row.
 *
 * Keyboard: the main button is the stop of the roving tabindex of the list (`tabbable`), and so
 * are Rename and Delete, but only in the row that holds the tab stop (`tabindex` -1 in the rest:
 * the actions are invisible until hover or focus, so Tab must not walk through 2 x N of them;
 * review W3 of #20). Enter
 * and Space open it (it is a button), F2 starts the in-line rename and Delete asks the host to
 * delete (the host shows the confirmation; this component never decides to delete). In rename mode
 * Enter saves a trimmed, non-empty, changed title through `onRename`, Escape or leaving the field
 * cancels; after Enter or Escape the focus returns to the row's main button (leaving the field
 * with the mouse leaves it where the user went); Escape is stopped there so it does not also
 * close the list. The two action buttons carry the title in their accessible name
 * ("Rename session Fix the build"), because a bare "Rename" repeated 50 times says nothing.
 * "Fork" (issue #21: the row was forked from another session; a fork gets its original's title,
 * so without it two rows read the same), "Running", "Needs input" and the in-flight "Renaming…" /
 * "Deleting…" are TEXT, never only a colour, and the phrase is built as one string (JSX eats the
 * line break between `{expr}` and the text on the next line: lesson #926). A row being renamed or
 * deleted by the host is locked with `aria-disabled` and ignores clicks and keys, instead of
 * `disabled`: a button that is disabled
 * while it holds the focus drops the keyboard user onto the page.
 * VERIFIED by `SessionPicker.test.tsx` in jsdom; look, hover and focus ring are checked by
 * `npm run test:visual` (step 9) on Windows only.
 */
export function SessionRow(props: {
  row: SessionSummary;
  /** True for the session open in the chat (`aria-current`). */
  current: boolean;
  /** True when this row holds the tab stop of the list. */
  tabbable: boolean;
  running: boolean;
  needsInput: boolean;
  op: SessionOp | undefined;
  /** Epoch milliseconds the times are shown against. */
  now: number;
  onOpen(): void;
  onRename(title: string): void;
  onDelete(): void;
  onFocusRow(): void;
}) {
  const [editing, setEditing] = createSignal(false);
  let main: HTMLButtonElement | undefined;
  let input: HTMLInputElement | undefined;

  const label = createMemo(() => sessionLabel(props.row));
  const busyText = createMemo(() => {
    if (props.op?.op === 'renaming') return 'Renaming…';
    if (props.op?.op === 'deleting') return 'Deleting…';
    return '';
  });
  /** "Running · Needs input" or the in-flight text; empty when there is nothing to say. */
  const badges = createMemo(() => {
    if (busyText() !== '') return busyText();
    const parts: string[] = [];
    // A fork is titled like its original (or "Untitled session"), so the row says what it is.
    if (props.row.forkOf !== undefined) parts.push('Fork');
    if (props.running) parts.push('Running');
    if (props.needsInput) parts.push('Needs input');
    return parts.join(' · ');
  });
  const locked = () => props.op !== undefined;

  /** Gives the focus back to the main button once Solid has put the right nodes in place. */
  const refocusMain = (): void => {
    queueMicrotask(() => {
      main?.focus();
    });
  };

  const startEdit = (): void => {
    if (locked()) return;
    setEditing(true);
  };

  const stopEdit = (): void => {
    if (!editing()) return;
    setEditing(false);
    refocusMain();
  };

  const save = (): void => {
    const next = (input?.value ?? '').trim();
    const changed = next !== '' && next !== label() && next !== (props.row.title ?? '').trim();
    stopEdit();
    if (changed) props.onRename(next);
  };

  const onMainKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'F2') {
      event.preventDefault();
      startEdit();
    } else if (event.key === 'Delete' && !locked()) {
      event.preventDefault();
      props.onDelete();
    }
  };

  const onInputKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      stopEdit();
    }
  };

  return (
    <li class="session-row" classList={{ current: props.current }} aria-busy={locked()}>
      <Show
        when={editing()}
        fallback={
          <>
            <button
              type="button"
              class="session-main"
              ref={(element) => {
                main = element;
              }}
              tabindex={props.tabbable ? 0 : -1}
              aria-current={props.current ? 'true' : undefined}
              aria-disabled={locked() ? 'true' : undefined}
              onClick={() => {
                if (!locked()) props.onOpen();
              }}
              onFocus={() => {
                props.onFocusRow();
              }}
              onKeyDown={onMainKeyDown}
            >
              <span class="session-title">{label()}</span>
              <span class="session-meta">
                <span class="session-time">
                  {formatSessionTime(props.row.updatedAt, props.now)}
                </span>
                <Show when={badges() !== ''}>
                  <span class="session-badge">{badges()}</span>
                </Show>
              </span>
            </button>
            <span class="session-row-actions">
              <button
                type="button"
                class="secondary session-action"
                aria-label={`Rename session ${label()}`}
                tabindex={props.tabbable ? 0 : -1}
                aria-disabled={locked() ? 'true' : undefined}
                onClick={startEdit}
              >
                Rename
              </button>
              <button
                type="button"
                class="secondary session-action"
                aria-label={`Delete session ${label()}`}
                tabindex={props.tabbable ? 0 : -1}
                aria-disabled={locked() ? 'true' : undefined}
                onClick={() => {
                  if (!locked()) props.onDelete();
                }}
              >
                Delete
              </button>
            </span>
          </>
        }
      >
        <input
          type="text"
          class="session-rename-input"
          maxlength={MAX_SESSION_TITLE_LENGTH}
          aria-label={`New title for session ${label()}`}
          ref={(element) => {
            input = element;
            // Set ONCE, not as a reactive `value=` prop: a `session.renamed` that arrives while the
            // user is typing (the automatic title appears seconds after the first answer) would
            // otherwise overwrite their text and drop the selection. Found by `npm run test:visual`
            // step 9 (21/10/2026): the typed title was appended to the generated one.
            element.value = untrack(() => props.row.title ?? '');
            queueMicrotask(() => {
              element.focus();
              element.select();
            });
          }}
          onKeyDown={onInputKeyDown}
          onBlur={() => {
            // Leaving the field cancels, but must not pull the focus back from where the user went.
            setEditing(false);
          }}
        />
      </Show>
    </li>
  );
}
