import * as l10n from '@vscode/l10n';
import { createEffect, For, on, Show } from 'solid-js';
import type { QueuedPrompt } from '../../../src/shared/model';

/** Characters of a queued prompt kept in the chip; the rest is an ellipsis (the CSS clips the line too). */
const CHIP_TEXT_LIMIT = 300;

/** One line of `text` for a chip: whitespace collapsed, cut at {@link CHIP_TEXT_LIMIT}. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > CHIP_TEXT_LIMIT ? `${flat.slice(0, CHIP_TEXT_LIMIT)}…` : flat;
}

/** Characters of a queued prompt kept in the accessible name of its buttons (as `SessionPanel` does). */
const NAME_TEXT_LIMIT = 40;

/** The prompt text for a button name: whitespace collapsed, cut at {@link NAME_TEXT_LIMIT}. */
function nameText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > NAME_TEXT_LIMIT ? `${flat.slice(0, NAME_TEXT_LIMIT)}…` : flat;
}

/**
 * The chips of the prompts the server holds in the inbox of the open session (issue #188, phase 3):
 * `Queued: "…"` with a remove button, "Steer now" and "Edit". Presentational: `App` owns what the
 * three actions send. A chip is drawn for the list the host sent (`items`), so it disappears when
 * the server delivers or cancels the prompt, whoever did it.
 *
 * Why it looks like this:
 * - A prompt that already goes `steer` reads `Steering: "…"` and has no "Steer now" button: there
 *   is nothing left to change.
 * - "Edit" is `aria-disabled` (not `disabled`, so it keeps the focus) unless `canEdit`: the server
 *   cannot edit the text of a queued item, so Edit means cancel it and give the text back to the
 *   box (`App` does it once the host confirms the cancel), which is only safe with an empty box
 *   and with no other Edit in flight (`editPending` disables every Edit meanwhile).
 *   The attachments a chip carried (its `files` count)
 *   are NOT given back, because the host never sends their content.
 * - Removing a chip would drop the focus to `body`, so the chip being removed is remembered and,
 *   once the list no longer has it, the focus goes to the first button of the chip now in its
 *   place (or the last one), or to the prompt box when none is left. It only acts when the focus
 *   was lost (`body` or nothing) and the document has the focus (solid-webview skill §7), so a
 *   removal made by another client never steals it. When no chip is left the prompt box gets it
 *   without reading the DOM, because the unmounted list may still hold its old nodes. "Steer now"
 *   turns the chip into a steering one and drops its button, which would send the focus to `body`:
 *   with the same guards the focus goes to the first button of the NEXT chip, or to the prompt box
 *   when there is none (when the server delivers the chip at once and it vanishes, the chip that
 *   took its place gets it, as after a removal). A steer the server refuses leaves the chip as it
 *   was and the memory of the steer waits for the next change of the list (accepted: the guards
 *   still apply then).
 * - "Steer now", "Edit" and the remove button carry an `aria-label` that starts with their visible
 *   word and ends with the short text of the prompt (`Edit: "…"`), so with several chips a screen
 *   reader tells them apart (review S2 of #188).
 * - Chips are keyed by object, and the store reconciles the list by `id`, so a chip keeps its DOM
 *   node while the list changes around it.
 * VERIFIED in jsdom by `QueueChips.test.tsx` (text, buttons, callbacks, the focus rules after a
 * removal and after "Steer now", guarded by `document.hasFocus()`).
 * VERIFIED in a real VS Code (Windows 11, VS Code 1.146.0, 12/11/2026) by `test:visual` step 54:
 * "T2 the chip reads Queued: "queued one" with Steer now, Edit and Remove from queue" and "T3 Steer
 * now delivers the prompt into the turn that is still running"; and by step 55: "W1 the chip text
 * ends in an ellipsis, the Queue button is whole and the working badge shows" and "C2/C3 chat in
 * dark the chip text has contrast >= 4.5" (and the same for the buttons in the four themes).
 * UNVERIFIED in a real window: the focus after a removal.
 */
export function QueueChips(props: {
  items: readonly QueuedPrompt[];
  /** True when "Edit" can hand the text back to the box (it is empty). */
  canEdit: boolean;
  /**
   * True while another Edit waits for the host to confirm its cancel: every Edit is then
   * `aria-disabled` with its own title, so a second click cannot overwrite the first request (the
   * text of the first prompt would be lost; review W4 of #188, second pass).
   */
  editPending?: boolean;
  onRemove(item: QueuedPrompt): void;
  onSteer(item: QueuedPrompt): void;
  onEdit(item: QueuedPrompt): void;
  /** Focuses the prompt box; used when the last chip goes away. */
  focusInput(): void;
}) {
  let list: HTMLUListElement | undefined;
  /**
   * The chip the user removed (`remove`) or steered (`steer`) and where it stood, until the list
   * stops listing it or lists it as steering.
   */
  let acted: { id: string; index: number; kind: 'remove' | 'steer' } | undefined;

  /** Remembers the chip about to disappear and asks the parent to remove it. */
  const remove = (item: QueuedPrompt): void => {
    acted = {
      id: item.id,
      index: props.items.findIndex((candidate) => candidate.id === item.id),
      kind: 'remove',
    };
    props.onRemove(item);
  };

  /** Remembers the chip whose "Steer now" is about to disappear and asks the parent to steer it. */
  const steer = (item: QueuedPrompt): void => {
    acted = {
      id: item.id,
      index: props.items.findIndex((candidate) => candidate.id === item.id),
      kind: 'steer',
    };
    props.onSteer(item);
  };

  createEffect(
    on(
      () => props.items.map((item) => `${item.id}:${item.delivery}`).join('\n'),
      () => {
        const gone = acted;
        if (gone === undefined) return;
        const still = props.items.find((item) => item.id === gone.id);
        // A removal waits until the chip is gone; a steer until it is gone (delivered) or reads
        // "Steering", which is when its "Steer now" button unmounts.
        if (still !== undefined && (gone.kind === 'remove' || still.delivery === 'queue')) return;
        acted = undefined;
        const active = document.activeElement;
        if (!document.hasFocus() || (active !== null && active !== document.body)) return;
        // With no chip left the list unmounts (its old nodes may still be reachable), so the
        // answer is the prompt box without looking at the DOM.
        const rows =
          props.items.length === 0 ? [] : [...(list?.querySelectorAll<HTMLElement>('li') ?? [])];
        // The chip that took the place of a removed (or delivered) one; after a steer that left
        // the chip standing, the next one.
        const at = still === undefined ? gone.index : gone.index + 1;
        const row = rows[Math.min(at, rows.length - 1)];
        const button = row?.querySelector<HTMLElement>('button');
        if (still !== undefined && at >= rows.length) props.focusInput();
        else if (button === undefined || button === null) props.focusInput();
        else button.focus();
      },
      { defer: true },
    ),
  );

  return (
    <Show when={props.items.length > 0}>
      <ul
        class="queue-chips"
        aria-label={l10n.t('Queued messages')}
        ref={(element) => {
          list = element;
        }}
      >
        <For each={props.items}>
          {(item) => (
            <li class="queue-chip" data-delivery={item.delivery}>
              <span class="queue-chip-text" title={item.text}>
                {item.delivery === 'steer'
                  ? l10n.t('Steering: "{0}"', oneLine(item.text))
                  : l10n.t('Queued: "{0}"', oneLine(item.text))}
              </span>
              <Show when={item.delivery === 'queue'}>
                <button
                  type="button"
                  class="secondary queue-chip-button"
                  aria-label={l10n.t('Steer now: "{0}"', nameText(item.text))}
                  onClick={() => {
                    steer(item);
                  }}
                >
                  {l10n.t('Steer now')}
                </button>
              </Show>
              <button
                type="button"
                class="secondary queue-chip-button"
                aria-label={l10n.t('Edit: "{0}"', nameText(item.text))}
                aria-disabled={!props.canEdit || props.editPending === true}
                title={
                  props.editPending === true
                    ? l10n.t('Wait for the other edit to finish')
                    : props.canEdit
                      ? undefined
                      : l10n.t('Clear the message box to edit this')
                }
                onClick={() => {
                  props.onEdit(item);
                }}
              >
                {l10n.t('Edit')}
              </button>
              <button
                type="button"
                class="chip-remove"
                aria-label={l10n.t('Remove from queue: "{0}"', nameText(item.text))}
                onClick={() => {
                  remove(item);
                }}
              >
                ×
              </button>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
