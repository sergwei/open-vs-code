// Protects the keyboard contract of the prompt box: Enter sends and Shift+Enter does not, Enter
// during IME composition is ignored, busy swaps Send for Stop (button and Escape), the arrow
// keys recall history only at the edges of the text, and attachment chips can be removed.
//
// Issue #28 (the `@` popup) at the end: it opens only on `input` events, ArrowUp/ArrowDown move
// the highlighted row instead of walking the history, Enter and Tab pick only rows that answer the
// text under the caret and Enter does nothing (no send, no pick) while that answer is pending,
// Escape closes it WITHOUT stopping a busy turn, a mouse pick keeps the
// focus in the textarea (a blur would close the popup before the click lands), and the ARIA
// attributes of the combobox pattern exist only while it is open. Issue #29: the "+" button that
// holds Add selection is `aria-disabled`, not `disabled`, so it keeps the focus (E2 #85, phase 4).
//
// Provenance: key events synthesized in jsdom against a controlled textarea. jsdom has no
// layout, so auto-grow and real caret movement are UNVERIFIED (F5 point 7); the real mouse and
// the look of the popup are `test:visual` step 16.
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandOption } from '../../../src/shared/model';
import type { AttachmentRef } from '../../../src/shared/protocol';
import { must, mount, type Mounted } from '../testing';
import type { DropContent } from './dropData';
import type { FileSearchView } from './MentionPopup';
import { PromptInput } from './PromptInput';
import { createHistory } from './promptHistory';

/** FABRICATED catalog commands; `init` and `review` are the built-in names of opencode v2.0.32. */
const COMMANDS: readonly CommandOption[] = [
  { name: 'init', description: 'guided AGENTS.md setup' },
  { name: 'review', description: 'review changes' },
  { name: 'hello', description: 'Say hello to someone' },
];

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
  // The focus tests of issue #92 stub `document.hasFocus`, which outlives the mounted component.
  vi.restoreAllMocks();
});

/** Mounts a PromptInput whose draft lives in a signal, with spies for every callback. */
function setup(
  options: {
    busy?: boolean;
    history?: string[];
    files?: AttachmentRef[];
    draft?: string;
    attachDisabled?: boolean;
    waiting?: boolean;
    thumbs?: Record<string, string>;
    /** Slash commands of the catalog; the default is `COMMANDS`, `null` is "could not be read". */
    commands?: readonly CommandOption[] | null;
    commandsDisabled?: boolean;
    /** The catalog has not arrived: an absent `commands` then reads "Loading commands…". */
    commandsLoading?: boolean;
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
    attachImage: vi.fn(),
    remove: vi.fn(),
    addSelection: vi.fn(),
    mentionQuery: vi.fn<(query: string | undefined) => void>(),
    mentionPick: vi.fn<(file: AttachmentRef) => void>(),
    drop: vi.fn<(content: DropContent) => void>(),
    pasteImages: vi.fn<(files: File[]) => void>(),
  };
  let focusBox: (() => void) | undefined;
  mounted = mount(() => (
    <PromptInput
      draft={draft()}
      onDraft={setDraft}
      history={history}
      files={options.files ?? []}
      busy={options.busy ?? false}
      waiting={options.waiting ?? false}
      sendDisabled={false}
      attachDisabled={options.attachDisabled ?? false}
      commands={options.commands === null ? undefined : (options.commands ?? COMMANDS)}
      commandsLoading={options.commandsLoading ?? false}
      commandsDisabled={options.commandsDisabled ?? false}
      fileSearch={search()}
      onMentionQuery={calls.mentionQuery}
      onMentionPick={calls.mentionPick}
      onSubmit={calls.submit}
      onStop={calls.stop}
      onAttach={calls.attach}
      onAttachImage={calls.attachImage}
      onAddSelection={calls.addSelection}
      onRemoveFile={calls.remove}
      onDrop={calls.drop}
      onPasteImages={calls.pasteImages}
      thumbs={options.thumbs ?? {}}
      onFocusReady={(focus) => {
        focusBox = focus;
      }}
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
  const plus = must<HTMLButtonElement>(mounted.container, 'button[aria-label="Add context"]');
  /** Opens the "+" menu the way the mouse does. */
  const openMenu = (): void => {
    plus.click();
  };
  return {
    textarea,
    press,
    type,
    draft,
    setDraft,
    setSearch,
    calls,
    plus,
    openMenu,
    focusBox: () => {
      focusBox?.();
    },
  };
}

/** An item of the open "+" menu, by its visible name. */
const menuItem = (name: string): HTMLButtonElement | undefined =>
  [...(mounted?.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])].find(
    (b) => b.textContent === name,
  );

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
    const send = mounted?.container.querySelector('button[type="submit"]');
    // E2 P9=1+b: a round icon button, named by its aria-label and with no text of its own.
    expect(send?.getAttribute('aria-label')).toBe('Send');
    expect(send?.textContent).toBe('');
    expect(send?.querySelector('svg')).not.toBeNull();
  });
});

describe('without a connection (E2, issue #85, P5=2)', () => {
  it('shows the waiting placeholder and stays editable without a connection', () => {
    const { textarea, type, draft } = setup({ waiting: true });
    expect(textarea.placeholder).toBe('Waiting for opencode…');
    expect(textarea.readOnly).toBe(false);
    expect(textarea.disabled).toBe(false);
    type('draft while waiting');
    expect(draft()).toBe('draft while waiting');
  });

  it('keeps the normal placeholder when connected', () => {
    expect(setup().textarea.placeholder).toContain('Ask opencode');
  });
});

describe('busy', () => {
  it('shows Stop instead of Send', () => {
    setup({ busy: true });
    const container = mounted?.container ?? document.body;
    const labels = [...container.querySelectorAll('button')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toContain('Stop');
    expect(labels).not.toContain('Send');
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('calls onStop for the Stop button and for Escape, only while busy', () => {
    const busy = setup({ busy: true });
    const stopButton = [...(mounted?.container.querySelectorAll('button') ?? [])].find(
      (b) => b.getAttribute('aria-label') === 'Stop',
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
    const { calls, openMenu } = setup();
    openMenu();
    menuItem('Attach file…')?.click();
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

describe('Add selection (issue #29), an item of the "+" menu', () => {
  // The tooltip is an approved wording (decision ui-texts of E7-file-context): pinned so it cannot
  // drift unnoticed.
  it('explains in its tooltip what it adds', () => {
    const { openMenu } = setup();
    openMenu();
    expect(menuItem('Add selection')?.title).toBe(
      'Add the selected lines of the active editor, or the whole file when nothing is selected',
    );
  });

  it('asks the host through onAddSelection', () => {
    const { calls, openMenu } = setup();
    openMenu();
    menuItem('Add selection')?.click();
    expect(calls.addSelection).toHaveBeenCalledTimes(1);
  });

  // aria-disabled, not disabled: a disabled button that had the focus drops it to the body.
  it('keeps the "+" button aria-disabled, still focusable and inert while there is no server', () => {
    const { calls, plus } = setup({ attachDisabled: true });
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    expect(plus.disabled).toBe(false);
    plus.focus();
    expect(document.activeElement).toBe(plus);
    plus.click();
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
    expect(calls.addSelection).not.toHaveBeenCalled();
  });
});

// Mention a file (E2, issue #85, phase 4): the item writes the `@` and opens the popup by the SAME
// path as typing it. Protects against an `@` written without telling the parent (no search, no popup)
// and against one glued to a word, where `findMention` would not see a mention.
describe('Mention a file, an item of the "+" menu', () => {
  it('writes an @, focuses the box and asks for the files like typing does', () => {
    const { calls, openMenu, textarea, draft } = setup();
    openMenu();
    menuItem('Mention a file')?.click();
    expect(draft()).toBe('@');
    expect(document.activeElement).toBe(textarea);
    expect(calls.mentionQuery).toHaveBeenCalledWith('');
    expect(mounted?.container.querySelector('.mention-popup')).not.toBeNull();
  });

  it('puts a space before the @ when the caret sits right after a word', () => {
    const { calls, openMenu, type, draft } = setup();
    type('look at');
    openMenu();
    menuItem('Mention a file')?.click();
    expect(draft()).toBe('look at @');
    expect(calls.mentionQuery).toHaveBeenLastCalledWith('');
  });

  // test:visual step 22 (27/10/2026): Ctrl+Alt+N with the menu open left it open, because the parent
  // focused the box while the webview document did not own the focus, so no `focusout` fired.
  it('closes an open "+" menu when the parent focuses the box, with no focusout', () => {
    const { openMenu, focusBox, textarea } = setup();
    openMenu();
    expect(mounted?.container.querySelector('[role="menu"]')).not.toBeNull();
    focusBox();
    expect(mounted?.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(textarea);
  });

  // Issue #92: in step 22 the focus the box was given fell to the body in the same millisecond
  // (trace of a scratch loop, 28/10/2026). jsdom has no VS Code around it, so the loss is faked:
  // `blur()` right after, or `focus` doing nothing the first times, with `hasFocus` stubbed.
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const frames = async (count: number) => {
    for (let i = 0; i < count; i++) await nextFrame();
  };
  it('puts the focus back on the box when it falls to the body right after', async () => {
    const { focusBox, textarea } = setup();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    focusBox();
    textarea.blur();
    expect(document.activeElement).toBe(document.body);
    await frames(2);
    expect(document.activeElement).toBe(textarea);
  });

  it('retries a focus that did not land until it holds', async () => {
    const { focusBox, textarea } = setup();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const real = textarea.focus.bind(textarea);
    let lostCalls = 2;
    vi.spyOn(textarea, 'focus').mockImplementation(() => {
      if (lostCalls > 0) lostCalls -= 1;
      else real();
    });
    focusBox();
    expect(document.activeElement).not.toBe(textarea);
    await frames(4);
    expect(document.activeElement).toBe(textarea);
  });

  it('leaves the body active while the document has no focus (the user is in the editor)', async () => {
    const { focusBox, textarea } = setup();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    focusBox();
    textarea.blur();
    await frames(3);
    expect(document.activeElement).toBe(document.body);
  });

  // Review of 28/10/2026: a click on an empty part of the chat also leaves the body active; the
  // hold must not undo it (nor cut a text selection being dragged).
  it('ends the hold when the user presses the pointer or a key in the document', async () => {
    for (const press of [
      () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })),
      () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })),
    ]) {
      const { focusBox, textarea } = setup();
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      focusBox();
      press();
      textarea.blur();
      await frames(3);
      expect(document.activeElement).toBe(document.body);
      mounted?.dispose();
      mounted = undefined;
      vi.restoreAllMocks();
    }
  });

  it('does not take the focus back once it moved to another element', async () => {
    const { focusBox, textarea } = setup();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    focusBox();
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();
    await frames(2);
    other.blur();
    await frames(2);
    expect(document.activeElement).not.toBe(textarea);
    other.remove();
  });

  it('asks for an image through onAttachImage', () => {
    const { calls, openMenu } = setup();
    openMenu();
    menuItem('Attach image…')?.click();
    expect(calls.attachImage).toHaveBeenCalledTimes(1);
    expect(calls.attach).not.toHaveBeenCalled();
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

  it('puts the drop hint in the tooltip of the Attach file… item', () => {
    const { openMenu } = setup();
    openMenu();
    expect(menuItem('Attach file…')?.title).toBe('Hold Shift to drop files from the Explorer');
  });
});

// Issue #33: the typed `/` popup. FABRICATED commands, events synthesized in jsdom; the real
// keyboard, the look and the mouse are `test:visual` step 24 (Windows 11, VS Code 1.144.0,
// 28/10/2026): "C2 typing "/" opens the popup with the rows /hello and its description, one
// highlighted, the focus in the box", "C2 the popup is inside the view" and "C4 choosing a row with
// the mouse writes "/hello " and leaves the focus in the box".
describe('the / popup (issue #33)', () => {
  const popup = () => mounted?.container.querySelector('.command-popup') ?? null;
  const rowNames = () =>
    [...(mounted?.container.querySelectorAll('.command-popup [role="option"]') ?? [])].map((row) =>
      row.getAttribute('aria-label'),
    );
  const live = () => mounted?.container.querySelector('[role="status"]')?.textContent ?? '';

  it('opens on a slash typed first, lists name and description, and filters', () => {
    const { type, textarea } = setup();
    type('/');
    expect(popup()).not.toBeNull();
    expect(rowNames()).toEqual(['/init', '/review', '/hello']);
    expect(mounted?.container.querySelector('.command-popup [role="option"]')?.textContent).toBe(
      '/initguided AGENTS.md setup',
    );
    expect(textarea.getAttribute('aria-controls')).toBe('command-list');
    type('/re');
    expect(rowNames()).toEqual(['/review']);
    expect(textarea.getAttribute('aria-activedescendant')).toBe('command-list-option-0');
  });

  it('does not open for a slash that is not first or after the first word', () => {
    const { type } = setup();
    type('a /x');
    expect(popup()).toBeNull();
    type('/init args');
    expect(popup()).toBeNull();
  });

  it('never opens on recalled history', () => {
    const { press } = setup({ history: ['/init'] });
    press('ArrowUp');
    expect(popup()).toBeNull();
  });

  it('moves the highlight with the arrows and does not walk the history', () => {
    const { type, press, textarea } = setup({ history: ['older'] });
    type('/');
    const down = press('ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(textarea.getAttribute('aria-activedescendant')).toBe('command-list-option-1');
    expect(
      mounted?.container.querySelector('.command-popup [aria-selected="true"]')?.textContent,
    ).toContain('/review');
    press('ArrowUp');
    press('ArrowUp');
    expect(textarea.getAttribute('aria-activedescendant')).toBe('command-list-option-2');
  });

  it('Enter picks the highlighted row, writes "/name " and does not send (P3=1)', async () => {
    const { type, press, draft, calls, textarea } = setup();
    type('/re');
    const enter = press('Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(draft()).toBe('/review ');
    expect(calls.submit).not.toHaveBeenCalled();
    expect(popup()).toBeNull();
    await Promise.resolve(); // the focus is restored in a microtask
    expect(document.activeElement).toBe(textarea);
  });

  it('Tab picks as well', () => {
    const { type, press, draft } = setup();
    type('/he');
    press('Tab');
    expect(draft()).toBe('/hello ');
  });

  it('Enter SENDS when the word typed is exactly a listed name (P5=1)', () => {
    const { type, press, calls, draft } = setup();
    type('/init');
    press('Enter');
    expect(calls.submit).toHaveBeenCalledTimes(1);
    expect(draft()).toBe('/init');
    expect(popup()).toBeNull();
  });

  it('Enter sends as usual when nothing matches', () => {
    const { type, press, calls } = setup();
    type('/zzz');
    expect(mounted?.container.querySelector('.command-popup .mention-status')?.textContent).toBe(
      'No commands match',
    );
    press('Enter');
    expect(calls.submit).toHaveBeenCalledTimes(1);
  });

  // Engram #1425: three states that used to be two. Fabricated props; the catalog-less one is the
  // case of the lesson `opcional-ausente-no-es-hecho` (nothing was tried yet).
  it('says that the catalog is loading, that the list could not be read, and that there are none', () => {
    const status = () =>
      mounted?.container.querySelector('.command-popup .mention-status')?.textContent;
    const loading = setup({ commands: null, commandsLoading: true });
    loading.type('/');
    expect(status()).toBe('Loading commands…');
    mounted?.dispose();
    const failed = setup({ commands: null });
    failed.type('/');
    expect(status()).toBe('Commands could not be loaded');
    mounted?.dispose();
    const none = setup({ commands: [] });
    none.type('/');
    expect(status()).toBe('No commands available');
  });

  it('Escape closes it, stops at the window and does NOT stop a running turn', () => {
    const { type, press, calls } = setup({ busy: true });
    type('/');
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    const escape = press('Escape');
    window.removeEventListener('keydown', spy);
    expect(popup()).toBeNull();
    expect(escape.defaultPrevented).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(calls.stop).not.toHaveBeenCalled();
    press('Escape');
    expect(calls.stop).toHaveBeenCalledTimes(1);
  });

  it('a mouse pick writes the command and keeps the focus in the box', () => {
    const { type, draft, textarea } = setup();
    textarea.focus();
    type('/');
    const row = mounted?.container.querySelectorAll<HTMLElement>(
      '.command-popup [role="option"]',
    )[1];
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    row?.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(draft()).toBe('/review ');
    expect(document.activeElement).toBe(textarea);
  });

  it('closes when the caret leaves the first word, and the @ popup takes over', () => {
    const { type, calls } = setup();
    type('/hello ');
    expect(popup()).toBeNull();
    type('/hello @sam');
    expect(popup()).toBeNull();
    expect(mounted?.container.querySelector('.mention-popup')).not.toBeNull();
    expect(calls.mentionQuery).toHaveBeenLastCalledWith('sam');
  });

  it('closes on blur and on send', () => {
    const { type, textarea, press } = setup();
    type('/he');
    textarea.dispatchEvent(new FocusEvent('blur'));
    expect(popup()).toBeNull();
    type('/he');
    press('Enter'); // picks
    expect(popup()).toBeNull();
  });

  it('announces the number of commands with a no-break space on a repeat', () => {
    const { type } = setup();
    type('/');
    const first = live();
    expect(first.trim()).toBe('3 commands');
    type('/in');
    expect(live().trim()).toBe('1 command');
    type('/');
    expect(live().trim()).toBe('3 commands');
    const again = live();
    type('/');
    expect(live().trim()).toBe('3 commands');
    expect(live()).not.toBe(again);
  });
});

describe('the "/" button (issue #33)', () => {
  const button = () =>
    must<HTMLButtonElement>(mounted?.container ?? document.body, 'button[aria-label="Commands"]');
  const items = () => [
    ...(mounted?.container.querySelectorAll<HTMLElement>('.command-menu [role="menuitem"]') ?? []),
  ];

  it('picking from the menu writes the command over a normal draft and focuses the box', async () => {
    const { draft, textarea } = setup({ draft: 'some text' });
    button().click();
    expect(items().map((item) => item.textContent)).toEqual([
      '/initguided AGENTS.md setup',
      '/reviewreview changes',
      '/helloSay hello to someone',
    ]);
    items()[2]?.click();
    expect(draft()).toBe('/hello some text');
    await Promise.resolve();
    expect(document.activeElement).toBe(textarea);
    expect(mounted?.container.querySelector('.command-menu')).toBeNull();
  });

  it('replaces a previous /other token and keeps its arguments', () => {
    const { draft } = setup({ draft: '/other the args' });
    button().click();
    items()[0]?.click();
    expect(draft()).toBe('/init the args');
  });

  it('is aria-disabled, never disabled, without a connection, and does nothing', () => {
    setup({ commandsDisabled: true });
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(button().disabled).toBe(false);
    button().click();
    expect(items()).toHaveLength(0);
  });
});
