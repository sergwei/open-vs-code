import { createEffect, createSignal, For, on, Show, type JSX } from 'solid-js';
import type { AttachmentRef } from '../../../src/shared/protocol';
import { AttachmentOpenButton } from './AttachmentOpenButton';
import { hasDropPayload, imagesOf, readDrop, type DropContent } from './dropData';
import { applyMention, findMention, type MentionToken } from './mentionQuery';
import { MentionPopup, mentionStatus, optionId, type FileSearchView } from './MentionPopup';
import type { PromptHistory } from './promptHistory';

let requestCounter = 0;

/** Id of the popup's listbox; the textarea points at it with `aria-controls`. One prompt per document. */
const MENTION_LIST_ID = 'mention-list';

/** Built from its code point: a literal one in the source trips `no-irregular-whitespace`. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

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
 * The prompt box (issue #13): a growing textarea with Send / Stop, Attach, Add selection and
 * attachment chips.
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
 * The action row starts with the `selectors` slot (agent switch and model picker, E5), then Add
 * selection, Attach and Send/Stop; the row wraps in a narrow side bar (CSS `flex-wrap`).
 *
 * Issue #28, the `@` mentions. Typing an `@` that starts a word opens the {@link MentionPopup} with
 * the files the parent searched (`fileSearch`); the parent is told the text to search through
 * `onMentionQuery` (`undefined` when the popup closes) and does the debounce and the request. The
 * popup opens or updates ONLY on `input` events, so recalling history or a failed send putting its
 * text back never opens it, and closes on blur, Escape, a send, a pick, or when the caret leaves
 * the word (click or arrow keys). The focus never leaves the textarea. While it is open, and after
 * the IME guard: ArrowUp/ArrowDown move the highlighted row and are NOT history (with it closed,
 * or open without rows, they are history as before); Enter or Tab pick the highlighted row when
 * the rows answer the text under the caret. While the answer is pending (the debounce has not
 * fired, a search is running, so the popup shows "Searching…" or rows of an older text) Enter does
 * NOTHING: no send, no pick, `preventDefault` (decision W1 of Sergio, 22/10/2026; picking the old
 * row and sending a half-typed `@sampl` were both rejected), and Tab keeps moving on. Enter sends
 * as usual when the popup is closed, or open with no rows and nothing pending (no match, an error,
 * the bare hint). A search cut off because the server stopped is answered by the host with a
 * `ServerUnavailable` `files.found` (unit-tested in `chatController.test.ts`, not seen in a real
 * window), so the popup leaves "Searching…". A `find()` that hangs with the server up has no
 * timeout: Enter stays inert until the text changes or Escape/blur closes the popup (UNVERIFIED,
 * never seen). Escape closes the popup and does NOT stop the turn.
 * Picking writes `@name` and a space in the text (decision Q1 of Sergio, 22/10/2026) and calls
 * `onMentionPick`, so the parent adds the chip: text and chip are independent afterwards, deleting
 * one leaves the other (the offsets sent with the files are computed at send time, see
 * `mentionsFor`). The textarea carries `aria-autocomplete="list"`, and `aria-controls` and
 * `aria-activedescendant` only while the popup is open; a visually hidden live region announces
 * the number of results.
 *
 * Issue #30, drop and paste. The form accepts a drag that carries files (`hasDropPayload`: a dragged
 * text selection is left to the browser), cancels `dragenter` and `dragover`, shows the hint "Hold
 * Shift to drop files from the Explorer" with `data-drop="active"` while it is over, and on `drop`
 * hands `readDrop(...)` to the parent. VS Code only delivers a drop to a sidebar webview with
 * Shift held (`WebviewWindowDragMonitor`, read in 1.105.0), and from 1.140 not at all
 * (microsoft/vscode#339036); the same hint is the tooltip of Attach. A paste with image files
 * (`imagesOf`) is cancelled and handed to `onPasteImages`; a text paste is left native. Chips of
 * pasted images show a thumbnail from `thumbs`.
 * VERIFIED on Windows 11, VS Code 1.143.1 (23/10/2026, `test:visual` step 20, a real Ctrl+V with
 * a PNG on the system clipboard): the paste event of the page listed `["file:image/png"]`, and the
 * checks "the chip shows a thumbnail that loaded (blob: allowed by the CSP)" and "a text paste
 * writes text and adds no chip" passed. The drag events are only unit-tested with fabricated
 * events plus untrusted synthetic ones in that step: a real drag from the Explorer was NOT
 * observed (it is not delivered to webviews in 1.140+, microsoft/vscode#339036, not reproduced
 * here either), and neither was macOS or Linux.
 *
 * Add selection (issue #29, decision Q2): a separate button; it only calls `onAddSelection`, and
 * is `aria-disabled` (not `disabled`, so it keeps the focus) without a connection. The name of a
 * chip is a button that opens the file ({@link AttachmentOpenButton}).
 * VERIFIED by `PromptInput.test.tsx` in jsdom (keys, ARIA, mousedown keeping the focus). VERIFIED
 * in a real VS Code 1.143.0 on Windows 11 (22/10/2026, `test:visual` step 16, real keyboard and
 * mouse): "Enter right after a keystroke neither sends nor picks" (W1: typed `x` and pressed Enter
 * at once with the rows of `@sample` still shown; the box kept "@samplex", 0 chips, 0 new
 * messages) and, once the rows were fresh, ArrowDown moved the highlight and "Enter on the popup
 * picks the file and does not send the prompt"; "ArrowUp with the popup closed recalls the last
 * prompt"; with a turn running, "Escape with the popup open does NOT stop the running turn" and
 * "a second Escape (popup closed) stops the turn"; "the keyboard focus stays in the prompt box
 * while the popup is open". The auto-grow, Tab (to pick, and to move on while pending), Enter
 * with an error or "No files match" showing, an IME composition and `aria-activedescendant` with
 * a real screen reader are UNVERIFIED in a real window (the Enter cases are jsdom-only).
 */
export function PromptInput(props: {
  draft: string;
  onDraft(text: string): void;
  history: PromptHistory;
  files: readonly AttachmentRef[];
  busy: boolean;
  sendDisabled: boolean;
  attachDisabled: boolean;
  /** Add selection is blocked (aria-disabled) while there is no server to attach for. */
  addSelectionDisabled: boolean;
  /** The `@` popup's results, from the store. */
  fileSearch: FileSearchView;
  /** The text to search after an `@`, or `undefined` when the popup closed. Parent debounces. */
  onMentionQuery(query: string | undefined): void;
  /** A result was picked: the parent adds the chip (the text is already written here). */
  onMentionPick(file: AttachmentRef): void;
  onSubmit(): void;
  onStop(): void;
  onAttach(): void;
  onAddSelection(): void;
  onRemoveFile(uri: string): void;
  /** Issue #30: something was dropped on the box; the parent decides what to do with each kind. */
  onDrop(content: DropContent): void;
  /** Issue #30: a paste carried images (and then nothing is written in the textarea). */
  onPasteImages(files: File[]): void;
  /** Thumbnails (`blob:` URLs the webview made itself) of the pasted-image chips, by `uri`. */
  thumbs: Readonly<Record<string, string>>;
  onFocusReady?(focus: () => void): void;
  /**
   * The agent and model selectors (issues #23/#24), drawn at the start of the action row. They are
   * buttons and radios INSIDE this form, so their Enter must not submit it (each one cancels it).
   */
  selectors?: JSX.Element;
}) {
  let textarea: HTMLTextAreaElement | undefined;
  /** The mention under the caret while the popup is open; `undefined` when it is closed. */
  const [token, setToken] = createSignal<MentionToken | undefined>(undefined);
  /** Index of the highlighted row. */
  const [active, setActive] = createSignal(0);
  const [announcement, setAnnouncement] = createSignal('');
  let announcementFlip = false;

  props.onFocusReady?.(() => {
    textarea?.focus();
  });

  /** True while the `@` popup is open (a mention is under the caret). */
  const mentionOpen = () => token() !== undefined;
  /** What the open popup shows for the word under the caret; `undefined` when it is closed. */
  const status = () => {
    const current = token();
    return current === undefined ? undefined : mentionStatus(current.query, props.fileSearch);
  };
  /** The rows the keyboard can act on: the results, only when the popup shows a list. */
  const rows = (): readonly AttachmentRef[] => (status() === 'list' ? props.fileSearch.files : []);
  /** True when the rows answer the text under the caret (no newer search is running). */
  const rowsAreFresh = () => !props.fileSearch.loading && props.fileSearch.query === token()?.query;
  /**
   * True while the popup is waiting for the answer to the text under the caret: it shows
   * "Searching…", or rows left from an older text. Enter does nothing then (decision W1 of Sergio,
   * 22/10/2026), because neither sending a half-typed `@sampl` nor picking an old row is wanted.
   */
  const answerPending = () => {
    const current = status();
    return current === 'loading' || (current === 'list' && !rowsAreFresh());
  };

  /**
   * Opens, updates or closes the popup for `next` and tells the parent when the text to search
   * changed. A new text puts the highlight back on the first row.
   */
  const applyToken = (next: MentionToken | undefined): void => {
    const previous = token();
    setToken(next);
    if (next === undefined) {
      if (previous !== undefined) props.onMentionQuery(undefined);
      return;
    }
    if (previous === undefined || previous.query !== next.query) {
      props.onMentionQuery(next.query);
      setActive(0);
    }
  };

  /** Closes the popup and tells the parent to drop its search. */
  const closeMention = (): void => {
    applyToken(undefined);
  };

  // A new set of results starts at the first row.
  createEffect(
    on(
      () => props.fileSearch.files,
      () => {
        setActive(0);
      },
    ),
  );

  // The live region: how many results, or that there are none. "Searching" and the bare hint are
  // not announced on every keystroke. A repeated text alternates a trailing no-break space, or the
  // region would not announce it again (solid-webview skill §7).
  createEffect(() => {
    const current = status();
    const count = props.fileSearch.files.length;
    let text = '';
    if (current === 'list') text = `${String(count)} ${count === 1 ? 'file' : 'files'}`;
    else if (current === 'empty') text = 'No files match';
    else if (current === 'error') text = 'File search failed';
    if (text === '') {
      setAnnouncement('');
      return;
    }
    announcementFlip = !announcementFlip;
    setAnnouncement(announcementFlip ? text : `${text}${NO_BREAK_SPACE}`);
  });

  /** Puts recalled history text in the draft and the caret at its end. */
  const recall = (text: string): void => {
    closeMention();
    props.onDraft(text);
    queueMicrotask(() => {
      textarea?.setSelectionRange(text.length, text.length);
    });
  };

  /** Sends, closing the popup first: the text it was about is leaving. */
  const submit = (): void => {
    closeMention();
    props.onSubmit();
  };

  /** Picks `file`: writes `@name` over the word, hands the chip to the parent, keeps the focus. */
  const pick = (file: AttachmentRef): void => {
    const current = token();
    if (current === undefined) return;
    const written = applyMention(textarea?.value ?? props.draft, current, file.name);
    props.history.reset();
    props.onDraft(written.text);
    props.onMentionPick({ uri: file.uri, name: file.name });
    closeMention();
    queueMicrotask(() => {
      textarea?.focus();
      textarea?.setSelectionRange(written.caret, written.caret);
    });
  };

  /** Re-reads the word under the caret after it moved (a click or a key), only to keep or close an open popup. */
  const refreshToken = (field: HTMLTextAreaElement): void => {
    if (!mentionOpen()) return;
    applyToken(findMention(field.value, field.selectionStart));
  };

  /** The keys of an open popup. Returns true when the key was consumed. */
  const onMentionKey = (event: KeyboardEvent): boolean => {
    const list = rows();
    switch (event.key) {
      case 'Escape':
        // Closes the popup and nothing else: it must not reach the Stop handler of the busy turn
        // nor a parent listener that returns the focus.
        event.preventDefault();
        event.stopPropagation();
        closeMention();
        return true;
      case 'ArrowDown':
      case 'ArrowUp': {
        if (list.length === 0 || event.shiftKey) return false;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((index) => (index + step + list.length) % list.length);
        return true;
      }
      case 'Enter':
      case 'Tab': {
        if (event.shiftKey) return false;
        if (answerPending()) {
          // Enter is swallowed (no send, no pick); Tab keeps its normal job and moves on.
          if (event.key !== 'Enter') return false;
          event.preventDefault();
          return true;
        }
        if (list.length === 0) return false;
        const chosen = list[active()];
        if (chosen === undefined) return false;
        event.preventDefault();
        pick(chosen);
        return true;
      }
      default:
        return false;
    }
  };

  const onKeyDown = (event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }): void => {
    if (event.isComposing) return;
    if (mentionOpen() && onMentionKey(event)) return;
    const field = event.currentTarget;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
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

  /** True while a drag with something attachable is over the box (issue #30). */
  const [dropActive, setDropActive] = createSignal(false);

  /** Accepts a drag over the box when it carries files; a dragged text selection is left alone. */
  const onDragOver = (event: DragEvent): void => {
    const transfer = event.dataTransfer;
    if (transfer === null || !hasDropPayload(Array.from(transfer.types))) return;
    // Cancelling `dragenter` as well keeps VS Code's webview script from asking the workbench to
    // block the drop (F1 of the plan, read in `pre/index.html` of VS Code 1.105.0).
    event.preventDefault();
    transfer.dropEffect = 'copy';
    setDropActive(true);
  };

  return (
    <form
      class="prompt"
      aria-label="Send a message"
      data-drop={dropActive() ? 'active' : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setDropActive(false);
      }}
      onDrop={(event) => {
        const transfer = event.dataTransfer;
        setDropActive(false);
        if (transfer === null || !hasDropPayload(Array.from(transfer.types))) return;
        event.preventDefault();
        props.onDrop(readDrop(transfer));
      }}
    >
      <Show when={dropActive()}>
        <p class="drop-hint">Hold Shift to drop files from the Explorer</p>
      </Show>
      <Show when={props.files.length > 0}>
        <ul class="chips" aria-label="Attached files">
          <For each={props.files}>
            {(file) => (
              <li class="chip">
                <Show when={props.thumbs[file.uri]}>
                  {(src) => <img class="chip-thumb" src={src()} alt="" />}
                </Show>
                <AttachmentOpenButton name={file.name} uri={file.uri} />
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
      <Show when={token()}>
        {(current) => (
          <MentionPopup
            id={MENTION_LIST_ID}
            query={current().query}
            search={props.fileSearch}
            active={active()}
            onPick={pick}
          />
        )}
      </Show>
      <textarea
        ref={(element) => {
          textarea = element;
        }}
        class="prompt-text"
        rows={1}
        aria-label="Message"
        aria-autocomplete="list"
        aria-controls={mentionOpen() ? MENTION_LIST_ID : undefined}
        aria-activedescendant={
          status() === 'list' ? optionId(MENTION_LIST_ID, active()) : undefined
        }
        placeholder="Ask opencode… (Enter to send, Shift+Enter for a new line)"
        value={props.draft}
        onInput={(event) => {
          const field = event.currentTarget;
          props.history.reset();
          props.onDraft(field.value);
          applyToken(findMention(field.value, field.selectionStart));
        }}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const images = imagesOf(event.clipboardData?.items ?? []);
          if (images.length === 0) return; // text: the browser writes it as usual
          event.preventDefault();
          props.onPasteImages(images);
        }}
        onKeyUp={(event) => {
          refreshToken(event.currentTarget);
        }}
        onClick={(event) => {
          refreshToken(event.currentTarget);
        }}
        onBlur={closeMention}
      />
      <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement()}
      </div>
      <div class="prompt-actions">
        <div class="prompt-selectors">{props.selectors}</div>
        <button
          type="button"
          class="secondary"
          aria-disabled={props.addSelectionDisabled ? 'true' : undefined}
          title="Add the selected lines of the active editor, or the whole file when nothing is selected"
          onClick={() => {
            if (!props.addSelectionDisabled) props.onAddSelection();
          }}
        >
          Add selection
        </button>
        <button
          type="button"
          class="secondary"
          disabled={props.attachDisabled}
          title="Hold Shift to drop files from the Explorer"
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
