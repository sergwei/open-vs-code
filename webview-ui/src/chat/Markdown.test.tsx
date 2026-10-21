// Protects the interaction contract of streamed Markdown: a click or Enter on a file reference
// posts `editor.open` and never reaches anything above (so VS Code's own link opener cannot also
// run); closed blocks keep the SAME DOM node while the live tail grows (otherwise selection,
// scroll and focus would be lost on every token); and a closed code fence becomes a block with
// actions.
//
// Provenance: hand-written Markdown rendered in jsdom. Identity of DOM nodes is checked with
// `toBe` on references taken before and after a signal write. Real iframe behaviour (VS Code's
// click forwarding) is UNVERIFIED until the F5.
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { must, mount, type Mounted } from '../testing';
import { Markdown } from './Markdown';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

describe('file references', () => {
  it('posts editor.open on click and stops the event at the Markdown', () => {
    mounted = mount(() => <Markdown text="see `src/a.ts:42:7` now" live={false} />);
    const seenByWindow: Event[] = [];
    const listener = (event: Event): void => {
      seenByWindow.push(event);
    };
    window.addEventListener('click', listener);
    try {
      must(mounted.container, '.file-ref').click();
    } finally {
      window.removeEventListener('click', listener);
    }
    expect(mounted.sent).toEqual([{ type: 'editor.open', path: 'src/a.ts', line: 42, column: 7 }]);
    expect(seenByWindow).toHaveLength(0);
  });

  it('opens the file with Enter on the focused reference and ignores other keys', () => {
    mounted = mount(() => <Markdown text="`src/a.ts#L3`" live={false} />);
    const reference = must(mounted.container, '.file-ref');
    reference.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(mounted.sent).toEqual([]);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    reference.dispatchEvent(enter);
    expect(mounted.sent).toEqual([{ type: 'editor.open', path: 'src/a.ts', line: 3 }]);
    expect(enter.defaultPrevented).toBe(true);
  });

  it('does nothing when the click is elsewhere', () => {
    mounted = mount(() => <Markdown text="plain `code` text" live={false} />);
    must(mounted.container, 'p').click();
    expect(mounted.sent).toEqual([]);
  });
});

describe('streaming', () => {
  it('keeps the DOM node of a closed block while the live block grows', () => {
    const [text, setText] = createSignal('first paragraph\n\nsec');
    mounted = mount(() => <Markdown text={text()} live={true} />);
    const before = must(mounted.container, '.md');
    // The inner <p> too: a rewrite of innerHTML would replace it even if the wrapper stayed.
    const paragraph = must(before, 'p');
    expect(before.textContent).toContain('first paragraph');

    setText('first paragraph\n\nsecond paragraph\n\nthi');
    const blocks = mounted.container.querySelectorAll('.md');
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toBe(before);
    expect(blocks[0]?.querySelector('p')).toBe(paragraph);
    expect(blocks[0]?.querySelector('p')?.textContent).toBe('first paragraph');
    expect(blocks[2]?.textContent).toContain('thi');
  });

  it('turns a closed fence into a code block with actions, plain while open', () => {
    const [text, setText] = createSignal('intro\n\n```ts\nconst a = 1;\n');
    mounted = mount(() => <Markdown text={text()} live={true} />);
    expect(mounted.container.querySelector('.code-block')).not.toBeNull();
    expect(mounted.container.querySelector('.hljs-keyword')).toBeNull();

    setText('intro\n\n```ts\nconst a = 1;\n```\n\nafter');
    expect(mounted.container.querySelector('.hljs-keyword')).not.toBeNull();
    expect(mounted.container.querySelectorAll('button[aria-label="Copy code"]')).toHaveLength(1);
  });

  it('keeps the code blocks separate once the message is finished', () => {
    const [live, setLive] = createSignal(true);
    mounted = mount(() => <Markdown text={'a\n\n```sh\nls\n```\n\nb'} live={live()} />);
    setLive(false);
    expect(mounted.container.querySelectorAll('.code-block')).toHaveLength(1);
    expect(mounted.container.textContent).toContain('ls');
  });
});

describe('safety', () => {
  it('never renders markup from the text', () => {
    mounted = mount(() => (
      <Markdown text={'<img src=x onerror=alert(1)> <script>1</script>'} live={false} />
    ));
    expect(mounted.container.querySelector('img, script')).toBeNull();
  });
});
