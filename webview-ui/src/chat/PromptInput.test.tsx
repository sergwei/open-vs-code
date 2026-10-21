// Protects the keyboard contract of the prompt box: Enter sends and Shift+Enter does not, Enter
// during IME composition is ignored, busy swaps Send for Stop (button and Escape), the arrow
// keys recall history only at the edges of the text, and attachment chips can be removed.
//
// Provenance: key events synthesized in jsdom against a controlled textarea. jsdom has no
// layout, so auto-grow and real caret movement are UNVERIFIED (F5 point 7).
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentRef } from '../../../src/shared/protocol';
import { must, mount, type Mounted } from '../testing';
import { PromptInput } from './PromptInput';
import { createHistory } from './promptHistory';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

/** Mounts a PromptInput whose draft lives in a signal, with spies for every callback. */
function setup(
  options: { busy?: boolean; history?: string[]; files?: AttachmentRef[]; draft?: string } = {},
) {
  const [draft, setDraft] = createSignal(options.draft ?? '');
  // Created once: a call inside a JSX prop is a getter, re-evaluated (new history) on every read.
  const history = createHistory(options.history ?? []);
  const calls = {
    submit: vi.fn(),
    stop: vi.fn(),
    attach: vi.fn(),
    remove: vi.fn(),
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
      onSubmit={calls.submit}
      onStop={calls.stop}
      onAttach={calls.attach}
      onRemoveFile={calls.remove}
    />
  ));
  const textarea = must<HTMLTextAreaElement>(mounted.container, 'textarea');
  const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    textarea.dispatchEvent(event);
    return event;
  };
  return { textarea, press, draft, setDraft, calls };
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
