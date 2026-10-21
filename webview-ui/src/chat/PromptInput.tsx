import { For, Show, type JSX } from 'solid-js';
import type { AttachmentRef } from '../../../src/shared/protocol';
import type { PromptHistory } from './promptHistory';

let requestCounter = 0;

/**
 * Builds a request id without `crypto.randomUUID` (the shared protocol has no `crypto`): a
 * counter plus the clock, unique within one webview document, which is all the host needs to
 * match `request.result`.
 */
export function nextRequestId(): string {
  requestCounter += 1;
  return `r${String(requestCounter)}-${String(Date.now())}`;
}

/**
 * The prompt box (issue #13): a growing textarea with Send / Stop, Attach and attachment chips.
 *
 * The draft is CONTROLLED from outside (`draft` / `onDraft`), because the empty-state
 * suggestions, a restored unsent prompt and the history all write it. Keys: Enter sends,
 * Shift+Enter inserts a new line, and Enter during an IME composition is left alone; ArrowUp with
 * the caret at the very start (and ArrowDown at the very end) walks the prompt history, so
 * moving the caret inside a multi-line draft still works; Escape stops the turn while busy.
 * While `busy` the Stop button replaces Send (Send is disabled then, the textarea stays editable
 * so the next prompt can be written). The height follows the content with CSS
 * (`field-sizing: content`, capped by `max-height`), with no script and no inline style:
 * HYPOTHESIS that the Chromium of VS Code 1.105+ supports it (Chrome has it since 123); where
 * it does not, the box keeps its minimum height and still works. `onFocusReady` hands the parent
 * a function that focuses the textarea, used after sending, stopping or retrying.
 * The action row starts with the `selectors` slot (agent switch and model picker, E5), then Attach
 * and Send/Stop; the row wraps in a narrow side bar (CSS `flex-wrap`).
 * VERIFIED by `PromptInput.test.tsx` in jsdom; keyboard feel, the auto-grow and the look are
 * UNVERIFIED until the F5.
 */
export function PromptInput(props: {
  draft: string;
  onDraft(text: string): void;
  history: PromptHistory;
  files: readonly AttachmentRef[];
  busy: boolean;
  sendDisabled: boolean;
  attachDisabled: boolean;
  onSubmit(): void;
  onStop(): void;
  onAttach(): void;
  onRemoveFile(uri: string): void;
  onFocusReady?(focus: () => void): void;
  /**
   * The agent and model selectors (issues #23/#24), drawn at the start of the action row. They are
   * buttons and radios INSIDE this form, so their Enter must not submit it (each one cancels it).
   */
  selectors?: JSX.Element;
}) {
  let textarea: HTMLTextAreaElement | undefined;

  props.onFocusReady?.(() => {
    textarea?.focus();
  });

  /** Puts recalled history text in the draft and the caret at its end. */
  const recall = (text: string): void => {
    props.onDraft(text);
    queueMicrotask(() => {
      textarea?.setSelectionRange(text.length, text.length);
    });
  };

  const onKeyDown = (event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }): void => {
    if (event.isComposing) return;
    const field = event.currentTarget;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      props.onSubmit();
    } else if (event.key === 'Escape' && props.busy) {
      event.preventDefault();
      props.onStop();
    } else if (
      event.key === 'ArrowUp' &&
      !event.shiftKey &&
      field.selectionStart === 0 &&
      field.selectionEnd === 0
    ) {
      const previous = props.history.prev(props.draft);
      if (previous !== undefined) {
        event.preventDefault();
        recall(previous);
      }
    } else if (
      event.key === 'ArrowDown' &&
      !event.shiftKey &&
      field.selectionStart === field.value.length &&
      field.selectionEnd === field.value.length
    ) {
      const next = props.history.next();
      if (next !== undefined) {
        event.preventDefault();
        recall(next);
      }
    }
  };

  return (
    <form
      class="prompt"
      aria-label="Send a message"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <Show when={props.files.length > 0}>
        <ul class="chips" aria-label="Attached files">
          <For each={props.files}>
            {(file) => (
              <li class="chip">
                <span class="chip-name">{file.name}</span>
                <button
                  type="button"
                  class="chip-remove"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => props.onRemoveFile(file.uri)}
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <textarea
        ref={(element) => {
          textarea = element;
        }}
        class="prompt-text"
        rows={1}
        aria-label="Message"
        placeholder="Ask opencode… (Enter to send, Shift+Enter for a new line)"
        value={props.draft}
        onInput={(event) => {
          props.history.reset();
          props.onDraft(event.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
      />
      <div class="prompt-actions">
        <div class="prompt-selectors">{props.selectors}</div>
        <button
          type="button"
          class="secondary"
          disabled={props.attachDisabled}
          onClick={() => props.onAttach()}
        >
          Attach
        </button>
        <Show
          when={props.busy}
          fallback={
            <button class="primary" type="submit" disabled={props.sendDisabled}>
              Send
            </button>
          }
        >
          <button class="primary" type="button" onClick={() => props.onStop()}>
            Stop
          </button>
        </Show>
      </div>
    </form>
  );
}
