import { createEffect, For, Show } from 'solid-js';
import type { CommandOption } from '../../../src/shared/model';
import { optionId } from './MentionPopup';
import { filterCommands } from './slashCommand';

/** What the popup has to say for a typed `query`. */
export type CommandStatus = 'list' | 'loading' | 'unavailable' | 'none' | 'empty';

/** The line each non-list status shows, shared by the popup and the "/" menu (decision of 28/10/2026, Engram #1425). */
export const COMMAND_STATUS_TEXT = {
  loading: 'Loading commands…',
  unavailable: 'Commands could not be loaded',
  none: 'No commands available',
  empty: 'No commands match',
} as const;

/**
 * Decides what the popup shows. Four statements that must not be confused (lesson
 * `opcional-ausente-no-es-hecho`): no catalog yet (`loading`: nothing was tried), a catalog without
 * `commands` (`unavailable`: the read failed), an empty list (`none`: the server has no commands),
 * and a non-empty list that the typed text filters to nothing (`empty`, "No commands match").
 * `loading` only applies while `commands` is absent: a list that is there wins. `PromptInput`
 * reuses it to know whether the keyboard has rows to act on.
 */
export function commandStatus(
  query: string,
  commands: readonly CommandOption[] | undefined,
  loading = false,
): CommandStatus {
  if (commands === undefined) return loading ? 'loading' : 'unavailable';
  if (commands.length === 0) return 'none';
  return filterCommands(commands, query).length === 0 ? 'empty' : 'list';
}

/**
 * The list of slash commands that opens above the prompt while `/` is typed at the start of the
 * draft (issue #33), a sibling of {@link MentionPopup} that wears the same classes and follows the
 * same combobox pattern: the listbox NEVER takes the focus, the textarea points at the highlighted
 * row with `aria-activedescendant`, a row is picked on `mousedown` with `preventDefault` so the
 * textarea does not blur, and the keyboard belongs to `PromptInput`. Each row is `/name` and the
 * server's description cut with an ellipsis, whole in the `title` (decision P2=1 of Sergio,
 * 28/10/2026, Engram #1416). The listbox stays in the DOM in every state so `aria-controls` never
 * dangles; the states "Loading commands…" (no catalog yet), "Commands could not be loaded" (a
 * catalog without the list), "No commands available" (an empty list) and "No commands match"
 * (decisions P7=1 and Engram #1425) are a line next to it. Written separately from MentionPopup
 * because its statuses and rows share nothing with the file search but the layout.
 * VERIFIED by `PromptInput.test.tsx` ("the / popup") in jsdom, and in a real window (Windows 11,
 * VS Code 1.144.0, 28/10/2026) by the `test:visual` checks "C2 typing" "/" opens the popup with the
 * rows (the opening, the rows and the focus in the box) and "C2 the popup is inside the view"; that
 * Escape does not stop the turn is the check "C4 Escape with the "/" popup open does NOT stop the
 * running turn".
 * UNVERIFIED: a screen reader, and the four state lines in a real window (the fake server always
 * answers the catalog with commands; the lines are covered in jsdom only).
 */
export function CommandPopup(props: {
  id: string;
  query: string;
  /** The catalog's commands; `undefined` when they could not be read (or the catalog is loading). */
  commands: readonly CommandOption[] | undefined;
  /** True while the catalog has not arrived: an absent list then means "loading", not "failed". */
  loading?: boolean;
  /** Index of the highlighted row (`aria-selected`), when the status is `list`. */
  active: number;
  onPick(name: string): void;
}) {
  const status = () => commandStatus(props.query, props.commands, props.loading);
  const rows = () =>
    props.commands === undefined ? [] : filterCommands(props.commands, props.query);

  // Keep the highlighted row visible when the list scrolls. jsdom has no `scrollIntoView`.
  createEffect(() => {
    const row = document.getElementById(optionId(props.id, props.active));
    if (status() === 'list' && typeof row?.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  });

  return (
    <div class="mention-popup command-popup">
      <ul id={props.id} class="mention-list" role="listbox" aria-label="Commands">
        <Show when={status() === 'list'}>
          <For each={rows()}>
            {(command, index) => (
              <li
                id={optionId(props.id, index())}
                class="mention-option"
                role="option"
                aria-label={`/${command.name}`}
                aria-selected={index() === props.active}
                title={command.description}
                onMouseDown={(event) => {
                  event.preventDefault();
                  props.onPick(command.name);
                }}
              >
                <span class="command-name">{`/${command.name}`}</span>
                <span class="command-description">{command.description}</span>
              </li>
            )}
          </For>
        </Show>
      </ul>
      <Show when={status()}>
        {(current) => (
          <Show when={current() !== 'list'}>
            <div class="mention-status">
              {COMMAND_STATUS_TEXT[current() as Exclude<CommandStatus, 'list'>]}
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}
