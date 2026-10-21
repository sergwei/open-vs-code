// Protects the three code actions of a block (Copy / Insert / New file): each must send ITS
// protocol message with the exact code, New file must carry the VS Code language id (not the
// highlight.js name), and a fence still being written must stay plain text (no `hljs-*`).
//
// Provenance: fabricated code strings rendered in jsdom with a recording sender. They confirm the
// messages, not that VS Code performs them (that is `editorActions.test.ts` in the integration
// suite) nor how the block looks.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { must, mount, type Mounted } from '../testing';
import { CodeBlock } from './CodeBlock';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
  vi.useRealTimers();
});

const button = (label: string): HTMLButtonElement =>
  must<HTMLButtonElement>(mounted?.container ?? document.body, `button[aria-label="${label}"]`);

describe('CodeBlock actions', () => {
  it('sends clipboard.write, editor.insert and editor.newFile with the exact code', () => {
    const code = 'const $x = `a\nb`;';
    mounted = mount(() => <CodeBlock code={code} language="ts" complete={true} />);
    button('Copy code').click();
    button('Insert code at cursor').click();
    button('Open code in a new file').click();
    expect(mounted.sent).toEqual([
      { type: 'clipboard.write', text: code },
      { type: 'editor.insert', text: code },
      { type: 'editor.newFile', text: code, language: 'typescript' },
    ]);
  });

  it('omits the language of New file when the fence label is unknown or missing', () => {
    mounted = mount(() => <CodeBlock code="x" language={undefined} complete={true} />);
    button('Open code in a new file').click();
    expect(mounted.sent).toEqual([{ type: 'editor.newFile', text: 'x' }]);
  });

  it('shows "Copied" after Copy and clears it', () => {
    vi.useFakeTimers();
    mounted = mount(() => <CodeBlock code="x" language="sh" complete={true} />);
    const status = must(mounted.container, '.code-copied');
    expect(status.textContent).toBe('');
    button('Copy code').click();
    expect(status.textContent).toBe('Copied');
    vi.advanceTimersByTime(2000);
    expect(status.textContent).toBe('');
  });

  it('has visible buttons with an accessible name', () => {
    mounted = mount(() => <CodeBlock code="x" language="sh" complete={true} />);
    const names = [...mounted.container.querySelectorAll('button')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(names).toEqual(['Copy code', 'Insert code at cursor', 'Open code in a new file']);
  });
});

describe('CodeBlock highlighting', () => {
  it('highlights a closed block with hljs classes only', () => {
    mounted = mount(() => <CodeBlock code="const a = 1;" language="ts" complete={true} />);
    expect(mounted.container.querySelector('.hljs-keyword')).not.toBeNull();
    expect(mounted.container.querySelector('[style]')).toBeNull();
  });

  it('keeps an open block as plain text', () => {
    mounted = mount(() => <CodeBlock code="const a = <b>" language="ts" complete={false} />);
    expect(mounted.container.querySelector('[class*="hljs"]')).toBeNull();
    expect(must(mounted.container, 'pre code').textContent).toBe('const a = <b>');
    expect(mounted.container.querySelector('b')).toBeNull();
  });
});
