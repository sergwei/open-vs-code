import * as l10n from '@vscode/l10n';
import { For } from 'solid-js';

/**
 * Suggestions of the empty state. Our own wording, chosen to be useful in any project and to
 * exercise Markdown and file references; they fill the input, they never send. A function so each
 * render reads the active language; the Spanish ones are written as the imperative the model gets.
 */
function suggestions(): string[] {
  return [
    l10n.t('Explain the structure of this project'),
    l10n.t('Find and fix bugs in the file I have open'),
    l10n.t('Write unit tests for the most recent changes'),
    l10n.t('Summarize what changed in the last commit'),
  ];
}

/**
 * What the user sees before the first message (issue #12): a short invitation and a few
 * clickable suggestions.
 *
 * Clicking one calls `onPick`, which puts the text in the input and focuses it: the user decides
 * whether to edit and send, so a misclick never starts a turn that costs tokens.
 */
export function EmptyState(props: { onPick(text: string): void }) {
  return (
    <div class="empty-state">
      <p class="empty-title">{l10n.t('Ask opencode about your code')}</p>
      <ul class="suggestions">
        <For each={suggestions()}>
          {(suggestion) => (
            <li>
              <button type="button" class="suggestion" onClick={() => props.onPick(suggestion)}>
                {suggestion}
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
