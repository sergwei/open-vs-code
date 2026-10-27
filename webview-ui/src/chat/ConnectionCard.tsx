import { For, Show } from 'solid-js';
import type { ProblemView } from './connectionView';
import { useSend } from './hostContext';
import { WarningIcon } from './icons';

/**
 * The error card of a connection problem (E2, issue #85): title, cause and the buttons of the
 * problem, drawn inside the conversation (after its last message) so the history stays visible.
 *
 * `role="alert"` for a failure and `role="status"` for a reconnection in progress (a neutral note
 * with only Show logs). It never takes the focus (lesson of the permission cards: a button focused
 * by code gets pressed by the Space the user was typing). The text block and the buttons wrap: the
 * buttons go BELOW the text when they do not fit (CSS `.connection-card`, bug #1294). The title is
 * an `h3` so a screen reader can reach the card by its headings (the card itself is an
 * `alert` or `status` live region, not a landmark); the cause is plain text, never markup
 * (it can carry a server message). Each button sends the message of its {@link ProblemView} action
 * through `useSend()`.
 * VERIFIED in jsdom by `ConnectionCard.test.tsx`. VERIFIED in a real VS Code (Windows 11, `stable`
 * build, 27/10/2026, `npm run test:visual` step 7b): "card at 300 (bar 300 px), light: the text
 * block is 84 % of the width", the buttons below the text at 300 and 170 px, contrast >= 4.5 in
 * the four themes; and by mutation: with the old `.connection-row` rules (no wrap, `flex: 1`) the
 * same checks fail ("the text block is 29 % of the width (76/259 px) >= 60 %"). NOT observed:
 * macOS and Linux, a screen reader.
 */
export function ConnectionCard(props: { problem: ProblemView }) {
  const send = useSend();
  return (
    <div
      class="connection-card"
      classList={{ 'connection-card-neutral': props.problem.role === 'status' }}
      role={props.problem.role}
    >
      <Show when={props.problem.role === 'alert'}>
        <span class="card-icon">
          <WarningIcon />
        </span>
      </Show>
      <div class="card-text">
        <h3 class="card-title">{props.problem.title}</h3>
        <Show when={props.problem.cause}>{(cause) => <p class="card-cause">{cause()}</p>}</Show>
      </div>
      <div class="card-actions">
        <For each={props.problem.actions}>
          {(action) => (
            <button
              type="button"
              class="secondary"
              onClick={() => {
                send(action.message);
              }}
            >
              {action.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
