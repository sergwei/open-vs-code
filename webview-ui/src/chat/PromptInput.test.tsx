// Protects the keyboard contract of the prompt box: Enter sends and Shift+Enter does not, Enter
// during IME composition is ignored, busy swaps Send for Stop (button and Escape), the arrow
// keys recall history only at the edges of the text, and attachment chips can be removed.
//
// Issue #28 (the `@` popup) at the end: it opens only on `input` events, ArrowUp/ArrowDown move
// the highlighted row instead of walking the history, Enter and Tab pick only rows that answer the
// text under the caret and Enter does nothing (no send, no pick) while that answer is pending,
// Escape closes it WITHOUT stopping a busy turn, a mouse pick keeps the
// focus in the textarea (a blur would close the popup before the click lands), and the ARIA
// attributes of the combobox pattern exist only while it is open. Issue #29: the Add selection
// button is `aria-disabled`, not `disabled`, so it keeps the focus.
//
// Provenance: key events synthesized in jsdom against a controlled textarea. jsdom has no
// layout, so auto-grow and real caret movement are UNVERIFIED (F5 point 7); the real mouse and
// the look of the popup are `test:visual` step 16.
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentRef } from '../../../src/shared/protocol';
import { must, mount, type Mounted } from '../testing';
import type { DropContent } from './dropData';
import type { FileSearchView } from './MentionPopup';
import { PromptInput } from './PromptInput';
import { createHistory } from './promptHistory';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

/** Mounts a PromptInput whose draft lives in a signal, with spies for every callback. */
function setup(
  options: {
    busy?: boolean;
    history?: string[];
    files?: AttachmentRef[];
    draft?: string;
    addSelectionDisabled?: boolean;
    thumbs?: Record<string, string>;
  } = {},
) {
  const [draft, setDraft] = createSignal(options.draft ?? '');
  const [search, setSearch] = createSignal<FileSearchView>({
    query: '',
    files: [],
    loading: false,
  });
  // Created once: a call inside a JSX prop is a getter, re-evaluated (new history) on every read.
  const history = createHistory(options.history ?? []);
  const calls = {
    submit: vi.fn(),
    stop: vi.fn(),
    attach: vi.fn(),
    remove: vi.fn(),
    addSelection: vi.fn(),
    mentionQuery: vi.fn<(query: string | undefined) => void>(),
    mentionPick: vi.fn<(file: AttachmentRef) => void>(),
    drop: vi.fn<(content: DropContent) => void>(),
    pasteImages: vi.fn<(files: File[]) => void>(),
  };
  mounted = mount(() => (
    <PromptInput
      draft={draft()}
      onDraft={setDraft}
      history={history}
      files={options.files ?? []}
      busy={options.busy ?? false}
      sendDisabled={false}
      attachDisabled={false}
      addSelectionDisabled={options.addSelectionDisabled ?? false}
      fileSearch={search()}
      onMentionQuery={calls.mentionQuery}
      onMentionPick={calls.mentionPick}
      onSubmit={calls.submit}
      onStop={calls.stop}
      onAttach={calls.attach}
      onAddSelection={calls.addSelection}
      onRemoveFile={calls.remove}
      onDrop={calls.drop}
      onPasteImages={calls.pasteImages}
      thumbs={options.thumbs ?? {}}
    />
  ));
  const textarea = must<HTMLTextAreaElement>(mounted.container, 'textarea');
  const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    textarea.dispatchEvent(event);
    return event;
  };
  /** Types `text` as the user would: the value changes, the caret goes to the end, `input` fires. */
  const type = (text: string): void => {
    textarea.value = text;
    textarea.setSelectionRange(text.length, text.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return { textarea, press, type, draft, setDraft, setSearch, calls };
}

describe('sending', () => {
  it('sends on Enter and not on Shift+Enter', () => {
    const { press, calls } = setup();
    const enter = press('Enter');
    expect(calls.submit).toHaveBeenCalledTimes(1);
    expect(enter.defaultPrevented).toBe(true);
    const shifted = press('Enter', { shiftKey: true });
    expect(calls.submit).toHaveBeenCalledTimes(1);
    expect(shifted.defaultPrevented).toBe(false);
  });

  it('leaves Enter alone while an IME composition is open', () => {
    const { press, calls } = setup();
    press('Enter', { isComposing: true });
    expect(calls.submit).not.toHaveBeenCalled();
  });

  it('has a form with a name and a Send button when idle', () => {
    setup();
    expect(mounted?.container.querySelector('form[aria-label="Send a message"]')).not.toBeNull();
    expect(mounted?.container.querySelector('button[type="submit"]')?.textContent).toBe('Send');
  });
});

describe('busy', () => {
  it('shows Stop instead of Send', () => {
    setup({ busy: true });
    const container = mounted?.container ?? document.body;
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Stop');
    expect(labels).not.toContain('Send');
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('calls onStop for the Stop button and for Escape, only while busy', () => {
    const busy = setup({ busy: true });
    const stopButton = [...(mounted?.container.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Stop',
    );
    stopButton?.click();
    busy.press('Escape');
    expect(busy.calls.stop).toHaveBeenCalledTimes(2);
    mounted?.dispose();

    const idle = setup({ busy: false });
    idle.press('Escape');
    expect(idle.calls.stop).not.toHaveBeenCalled();
  });
});

describe('history', () => {
  it('recalls the previous prompt with ArrowUp at the start and returns with ArrowDown', () => {
    const { textarea, press, draft, setDraft } = setup({ history: ['older', 'newer'] });
    setDraft('typing');
    textarea.setSelectionRange(0, 0);
    const up = press('ArrowUp');
    expect(up.defaultPrevented).toBe(true);
    expect(draft()).toBe('newer');
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    press('ArrowDown');
    expect(draft()).toBe('typing');
  });

  it('does not hijack the arrows when the caret is inside the text', () => {
    const { textarea, press, draft, setDraft } = setup({ history: ['older'] });
    setDraft('line one\nline two');
    textarea.setSelectionRange(5, 5);
    expect(press('ArrowUp').defaultPrevented).toBe(false);
    expect(press('ArrowDown').defaultPrevented).toBe(false);
    expect(draft()).toBe('line one\nline two');
  });

  it('lets ArrowUp through when there is no history', () => {
    const { textarea, press } = setup();
    textarea.setSelectionRange(0, 0);
    expect(press('ArrowUp').defaultPrevented).toBe(false);
  });
});

describe('attachments', () => {
  it('asks the host through onAttach', () => {
    const { calls } = setup();
    const attach = [...(mounted?.container.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Attach',
    );
    attach?.click();
    expect(calls.attach).toHaveBeenCalledTimes(1);
  });

  it('shows a chip per file and removes one by its uri', () => {
    const files = [
      { uri: 'file:///a.ts', name: 'src/a.ts' },
      { uri: 'file:///b.ts', name: 'b.ts' },
    ];
    const { calls } = setup({ files });
    const container = mounted?.container ?? document.body;
    expect(container.querySelectorAll('.chip')).toHaveLength(2);
    must<HTMLButtonElement>(container, 'button[aria-label="Remove src/a.ts"]').click();
    expect(calls.remove).toHaveBeenCalledWith('file:///a.ts');
  });
});

describe('draft', () => {
  it('reports typing through onDraft', () => {
    const { textarea, draft } = setup();
    textarea.value = 'hello';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(draft()).toBe('hello');
  });

  it('shows a draft written from outside (suggestion, restore)', () => {
    const { textarea, setDraft } = setup();
    setDraft('from a suggestion');
    expect(textarea.value).toBe('from a suggestion');
  });
});

const FILES: AttachmentRef[] = [
  { uri: 'file:///ws/src/sample.ts', name: 'src/sample.ts' },
  { uri: 'file:///ws/src/shared/model.ts', name: 'src/shared/model.ts' },
];

describe('the @ popup (issue #28)', () => {
  /** Types `look @sa` and gives the popup the results of `sa`. */
  function openWithResults(options: Parameters<typeof setup>[0] = {}) {
    const harness = setup(options);
    harness.type('look @sa');
    harness.setSearch({ query: 'sa', files: FILES, loading: false });
    return harness;
  }
  const popup = () => mounted?.container.querySelector('.mention-popup') ?? null;
  const rows = () => [...(mounted?.container.querySelectorAll('[role="option"]') ?? [])];

  it('opens on typing an @ that starts a word and reports the query', () => {
    const { calls, textarea } = setup();
    expect(popup()).toBeNull();
    expect(textarea.getAttribute('aria-controls')).toBeNull();
    expect(textarea.getAttribute('aria-autocomplete')).toBe('list');
    textarea.value = 'look @sa';
    textarea.setSelectionRange(8, 8);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(popup()).not.toBeNull();
    expect(calls.mentionQuery).toHaveBeenLastCalledWith('sa');
    expect(textarea.getAttribute('aria-controls')).toBe('mention-list');
    expect(mounted?.container.querySelector('#mention-list')?.getAttribute('role')).toBe('listbox');
  });

  it('does not open for an e-mail address, nor when the draft is written from outside', () => {
    const { type, setDraft, calls } = setup();
    type('mail me a@b');
    expect(popup()).toBeNull();
    setDraft('@recalled from history');
    expect(popup()).toBeNull();
    expect(calls.mentionQuery).not.toHaveBeenCalled();
  });

  it('shows the hint for a bare @ and the loading, empty and error states', () => {
    const { type, setSearch } = setup();
    type('@');
    expect(popup()?.textContent).toContain('Type to search files');
    type('@zz');
    expect(popup()?.textContent).toContain('Searching…');
    setSearch({ query: 'zz', files: [], loading: false });
    expect(popup()?.textContent).toContain('No files match');
    setSearch({
      query: 'zz',
      files: [],
      loading: false,
      error: { code: 'ServerUnavailable', message: 'The opencode server is not running' },
    });
    expect(popup()?.textContent).toContain('Search failed: The opencode server is not running');
  });

  it('lists the results as options and points the textarea at the highlighted one', () => {
    const { textarea } = openWithResults();
    expect(rows()).toHaveLength(2);
    expect(rows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'src/sample.ts',
      'src/shared/model.ts',
    ]);
    expect(rows().map((row) => row.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(textarea.getAttribute('aria-activedescendant')).toBe(rows()[0]?.id);
  });

  it('moves the highlight with the arrows, wrapping, and leaves the history alone', () => {
    const { press, textarea, draft } = openWithResults({ history: ['older'] });
    const down = press('ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(rows().map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(textarea.getAttribute('aria-activedescendant')).toBe(rows()[1]?.id);
    press('ArrowDown');
    expect(rows()[0]?.getAttribute('aria-selected')).toBe('true');
    expect(press('ArrowUp').defaultPrevented).toBe(true);
    expect(rows()[1]?.getAttribute('aria-selected')).toBe('true');
    expect(draft()).toBe('look @sa');
  });

  it('keeps the arrows for the history when the popup is closed or has no rows', () => {
    const closed = setup({ history: ['older'] });
    closed.textarea.setSelectionRange(0, 0);
    expect(closed.press('ArrowUp').defaultPrevented).toBe(true);
    expect(closed.draft()).toBe('older');
    mounted?.dispose();

    const empty = setup({ history: ['older'] });
    empty.type('@');
    // Popup open (hint) but no rows: ArrowDown at the end is the history's, which has nothing newer.
    expect(empty.press('ArrowDown').defaultPrevented).toBe(false);
  });

  it('leaves the arrows alone during an IME composition', () => {
    const { press } = openWithResults();
    expect(press('ArrowDown', { isComposing: true }).defaultPrevented).toBe(false);
    expect(rows()[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('picks the highlighted row with Enter: writes @name, hands the chip over and does not send', () => {
    const { press, draft, calls, textarea } = openWithResults();
    const enter = press('Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(calls.submit).not.toHaveBeenCalled();
    expect(calls.mentionPick).toHaveBeenCalledWith(FILES[0]);
    expect(draft()).toBe('look @src/sample.ts ');
    expect(popup()).toBeNull();
    expect(calls.mentionQuery).toHaveBeenLastCalledWith(undefined);
    expect(textarea.getAttribute('aria-controls')).toBeNull();
    expect(textarea.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('picks the second row with Tab after ArrowDown', () => {
    const { press, draft, calls } = openWithResults();
    press('ArrowDown');
    const tab = press('Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(calls.mentionPick).toHaveBeenCalledWith(FILES[1]);
    expect(draft()).toBe('look @src/shared/model.ts ');
  });

  it('does not pick with Shift+Tab', () => {
    const { press, calls } = openWithResults();
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(calls.mentionPick).not.toHaveBeenCalled();
  });

  // Decision W1 of Sergio (22/10/2026), review of E7-file-context. The rows below were found for an
  // older text, or a search is running: picking one would attach a file the user did not mean, and
  // sending would send a half-typed `@sampl`. Enter does nothing until the answer arrives.
  it('ignores Enter (no send, no pick) while the rows answer an older text', () => {
    const stale = openWithResults();
    stale.setSearch({ query: 's', files: FILES, loading: false });
    const enter = stale.press('Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(stale.calls.mentionPick).not.toHaveBeenCalled();
    expect(stale.calls.submit).not.toHaveBeenCalled();
    expect(popup()).not.toBeNull();
  });

  it('ignores Enter while a search runs, and picks as soon as its answer arrives', () => {
    const running = openWithResults();
    running.setSearch({ query: 'sa', files: FILES, loading: true });
    expect(running.press('Enter').defaultPrevented).toBe(true);
    expect(running.calls.mentionPick).not.toHaveBeenCalled();
    expect(running.calls.submit).not.toHaveBeenCalled();
    running.setSearch({ query: 'sa', files: FILES, loading: false });
    expect(running.press('Enter').defaultPrevented).toBe(true);
    expect(running.calls.mentionPick).toHaveBeenCalledWith(FILES[0]);
    expect(running.calls.submit).not.toHaveBeenCalled();
  });

  it('ignores Enter, with no rows yet, while the first search is pending', () => {
    const { type, press, calls } = setup();
    type('@zz');
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(calls.submit).not.toHaveBeenCalled();
    expect(popup()).not.toBeNull();
  });

  it('leaves Tab to move on, and does not pick, while the answer is pending', () => {
    const stale = openWithResults();
    stale.setSearch({ query: 's', files: FILES, loading: false });
    expect(stale.press('Tab').defaultPrevented).toBe(false);
    expect(stale.calls.mentionPick).not.toHaveBeenCalled();
  });

  it('sends on Enter when the popup has no rows and nothing is pending, and closes it', () => {
    const { type, press, setSearch, calls } = setup();
    type('@zz');
    setSearch({ query: 'zz', files: [], loading: false });
    expect(popup()?.textContent).toContain('No files match');
    press('Enter');
    expect(calls.submit).toHaveBeenCalledTimes(1);
    expect(popup()).toBeNull();
    expect(calls.mentionQuery).toHaveBeenLastCalledWith(undefined);
  });

  it('sends on Enter when the search failed, and for the bare @ hint', () => {
    const failed = setup();
    failed.type('@zz');
    failed.setSearch({
      query: 'zz',
      files: [],
      loading: false,
      error: { code: 'ServerUnavailable', message: 'The opencode server is not running' },
    });
    failed.press('Enter');
    expect(failed.calls.submit).toHaveBeenCalledTimes(1);
    mounted?.dispose();

    const bare = setup();
    bare.type('@');
    bare.press('Enter');
    expect(bare.calls.submit).toHaveBeenCalledTimes(1);
  });

  it('sends on Enter with the popup closed, as before', () => {
    const { type, press, calls } = setup();
    type('plain text');
    expect(popup()).toBeNull();
    press('Enter');
    expect(calls.submit).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape without stopping a busy turn or reaching the listeners above', () => {
    const { press, calls } = openWithResults({ busy: true });
    // Solid delegates `onKeyDown` to the document, so the listener that must NOT see the key is
    // one above it: the window.
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    try {
      const escape = press('Escape');
      expect(escape.defaultPrevented).toBe(true);
      expect(seen).not.toHaveBeenCalled();
      expect(calls.stop).not.toHaveBeenCalled();
      expect(popup()).toBeNull();
      expect(calls.mentionQuery).toHaveBeenLastCalledWith(undefined);
      // The popup is closed now, so the next Escape is the Stop shortcut again.
      press('Escape');
      expect(calls.stop).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', seen);
    }
  });

  it('picks a row with a mouse press that keeps the focus in the textarea', () => {
    const { textarea, draft, calls } = openWithResults();
    textarea.focus();
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    rows()[1]?.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(textarea);
    expect(calls.mentionPick).toHaveBeenCalledWith(FILES[1]);
    expect(draft()).toBe('look @src/shared/model.ts ');
  });

  it('closes when the textarea loses the focus', () => {
    const { textarea } = openWithResults();
    textarea.focus();
    textarea.blur();
    expect(popup()).toBeNull();
  });

  it('closes when the caret leaves the word, and stays closed on keys that do not type', () => {
    const { textarea } = openWithResults();
    textarea.value = 'look @sa x';
    textarea.setSelectionRange(10, 10);
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    expect(popup()).toBeNull();
    // A key that only moves the caret never opens it again.
    textarea.value = 'look @sa';
    textarea.setSelectionRange(8, 8);
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));
    expect(popup()).toBeNull();
  });

  it('announces the number of results and alternates a no-break space for a repeat', () => {
    const { setSearch } = openWithResults();
    const live = () => mounted?.container.querySelector('[role="status"]')?.textContent ?? '';
    const first = live();
    expect(first.trim()).toBe('2 files');
    setSearch({ query: 'sa', files: [...FILES], loading: false });
    const second = live();
    expect(second.trim()).toBe('2 files');
    expect(second).not.toBe(first);
  });

  // The live-region text is an approved wording (decision ui-texts of E7-file-context): pinned so
  // it cannot drift unnoticed.
  it('announces "File search failed" when the search errors', () => {
    const { type, setSearch } = setup();
    type('@zz');
    setSearch({
      query: 'zz',
      files: [],
      loading: false,
      error: { code: 'ServerUnavailable', message: 'The opencode server is not running' },
    });
    const live = mounted?.container.querySelector('[role="status"]')?.textContent ?? '';
    expect(live.trim()).toBe('File search failed');
  });

  it('announces nothing when the popup is closed', () => {
    setup();
    expect(mounted?.container.querySelector('[role="status"]')?.textContent).toBe('');
  });
});

describe('Add selection (issue #29)', () => {
  const button = () =>
    [...(mounted?.container.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Add selection',
    );

  // The tooltip is an approved wording (decision ui-texts of E7-file-context): pinned so it cannot
  // drift unnoticed.
  it('explains in its tooltip what it adds', () => {
    setup();
    expect(button()?.title).toBe(
      'Add the selected lines of the active editor, or the whole file when nothing is selected',
    );
  });

  it('asks the host through onAddSelection', () => {
    const { calls } = setup();
    button()?.click();
    expect(calls.addSelection).toHaveBeenCalledTimes(1);
  });

  // aria-disabled, not disabled: a disabled button that had the focus drops it to the body.
  it('is aria-disabled, still focusable and inert while there is no server', () => {
    const { calls } = setup({ addSelectionDisabled: true });
    const add = button();
    expect(add?.getAttribute('aria-disabled')).toBe('true');
    expect(add?.disabled).toBe(false);
    add?.focus();
    expect(document.activeElement).toBe(add);
    add?.click();
    expect(calls.addSelection).not.toHaveBeenCalled();
  });
});

describe('chips that open the file (issues #28/#29)', () => {
  it('opens the file at the start of its range, naming the range in words', () => {
    setup({
      files: [{ uri: 'file:///ws/src/a.ts?start=10&end=20', name: 'src/a.ts#10-20' }],
    });
    const open = must<HTMLButtonElement>(mounted?.container ?? document.body, '.chip-open');
    expect(open.getAttribute('aria-label')).toBe('Open src/a.ts, lines 10-20');
    expect(open.textContent).toBe('src/a.ts#10-20');
    open.click();
    expect(mounted?.sent).toEqual([{ type: 'editor.open', path: 'file:///ws/src/a.ts', line: 10 }]);
  });

  it('opens a whole file with no line', () => {
    setup({ files: [{ uri: 'file:///ws/b.ts', name: 'b.ts' }] });
    must<HTMLButtonElement>(mounted?.container ?? document.body, '.chip-open').click();
    expect(mounted?.sent).toEqual([{ type: 'editor.open', path: 'file:///ws/b.ts' }]);
  });

  it('keeps removing a chip independent of opening it', () => {
    const { calls } = setup({ files: [{ uri: 'file:///ws/b.ts', name: 'b.ts' }] });
    must<HTMLButtonElement>(mounted?.container ?? document.body, '.chip-remove').click();
    expect(calls.remove).toHaveBeenCalledWith('file:///ws/b.ts');
    expect(mounted?.sent).toEqual([]);
  });
});

// Issue #30. jsdom has neither `DragEvent` nor a `DataTransfer` constructor, so the events are plain
// `Event`s with a hand-made `dataTransfer` / `clipboardData`: this proves OUR handlers (what they
// cancel, what they hand to the parent), not that VS Code delivers a real drop to the webview
// (it does not in the stable 1.143, microsoft/vscode#339036; `test:visual` step 20 says what it saw).
describe('drop and paste (issue #30)', () => {
  const transfer = (types: string[], data: Record<string, string> = {}, files: File[] = []) => ({
    types,
    files,
    dropEffect: 'none',
    getData: (type: string) => data[type] ?? '',
  });
  const fire = (target: Element, type: string, extra: Record<string, unknown>): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries(extra)) {
      Object.defineProperty(event, key, { value });
    }
    target.dispatchEvent(event);
    return event;
  };
  const form = () => must<HTMLFormElement>(mounted?.container ?? document.body, 'form.prompt');

  it('highlights while files are dragged over, with the hint, and clears on leave', () => {
    setup();
    const over = fire(form(), 'dragover', { dataTransfer: transfer(['Files']) });
    expect(over.defaultPrevented).toBe(true);
    expect(form().dataset.drop).toBe('active');
    expect(form().querySelector('.drop-hint')?.textContent).toBe(
      'Hold Shift to drop files from the Explorer',
    );
    fire(form(), 'dragleave', { dataTransfer: transfer(['Files']) });
    expect(form().dataset.drop).toBeUndefined();
  });

  it('leaves a dragged text selection alone', () => {
    setup();
    const over = fire(form(), 'dragover', { dataTransfer: transfer(['text/plain']) });
    expect(over.defaultPrevented).toBe(false);
    expect(form().dataset.drop).toBeUndefined();
  });

  it('hands the Explorer URIs of a drop to the parent and clears the highlight', () => {
    const { calls } = setup();
    const types = ['resourceurls'];
    fire(form(), 'dragover', { dataTransfer: transfer(types) });
    const drop = fire(form(), 'drop', {
      dataTransfer: transfer(types, { resourceurls: '["file:///c%3A/ws/a.ts"]' }),
    });
    expect(drop.defaultPrevented).toBe(true);
    expect(calls.drop).toHaveBeenCalledWith({ kind: 'uris', uris: ['file:///c%3A/ws/a.ts'] });
    expect(form().dataset.drop).toBeUndefined();
  });

  it('takes pasted images without writing text, and leaves a text paste native', () => {
    const { textarea, calls } = setup();
    const png = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const image = fire(textarea, 'paste', {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => png }] },
    });
    expect(image.defaultPrevented).toBe(true);
    expect(calls.pasteImages).toHaveBeenCalledWith([png]);
    const text = fire(textarea, 'paste', {
      clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] },
    });
    expect(text.defaultPrevented).toBe(false);
    expect(calls.pasteImages).toHaveBeenCalledTimes(1);
  });

  it('shows the thumbnail of a pasted image chip', () => {
    setup({
      files: [{ uri: 'pasted-image:1', name: 'Pasted image 1' }],
      thumbs: { 'pasted-image:1': 'blob:x' },
    });
    expect(form().querySelector('img.chip-thumb')?.getAttribute('src')).toBe('blob:x');
    expect(form().querySelector('.chip-open')).toBeNull();
  });

  it('puts the drop hint in the tooltip of Attach', () => {
    setup();
    const attach = [...form().querySelectorAll('button')].find((b) => b.textContent === 'Attach');
    expect(attach?.title).toBe('Hold Shift to drop files from the Explorer');
  });
});
