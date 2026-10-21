// Protects the one boundary where hostile text becomes DOM: the model's Markdown goes to
// `innerHTML`, so a script, an event handler, a `javascript:`/`command:`/`vscode:`/`file:` link,
// an inline `style`, a remote image or a frame must never reach the page (architecture rule 6),
// and a file reference must stay a non-anchor so VS Code's link opener never sees it.
//
// Provenance: FABRICATED vectors, written by hand from the usual XSS cheat-sheet shapes and the
// plan (`E2-mvp-prototype/plan-fase2` §6), run through DOMPurify 3.4.x on jsdom. They show the
// sanitizer configuration holds against these inputs; they say nothing about the real webview
// iframe or about vectors that are not in the list.
import { describe, expect, it } from 'vitest';
import { highlightCode, renderMarkdown } from './renderMarkdown';

/** Parses `html` into a detached element so tests can query it instead of matching strings. */
function dom(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

const VECTORS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '<iframe src="https://evil.example"></iframe>',
  '<a href="javascript:alert(1)">x</a>',
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x](command:workbench.action.reloadWindow)',
  '[x](vscode://file/C:/Windows/win.ini)',
  '[x](file:///C:/Windows/win.ini)',
  '[x](data:text/html;base64,PHNjcmlwdD4=)',
  '<div style="position:fixed;inset:0">x</div>',
  '<p onclick="alert(1)">x</p>',
  '![x](https://evil.example/leak.png)',
  '![x](javascript:alert(1))',
  '<form action="https://evil.example"><button>go</button></form>',
  '<style>body{display:none}</style>',
  '[x](&#106;avascript:alert(1))',
  '`<img src=x onerror=alert(1)>`',
  '```html\n<script>alert(1)</script>\n```',
];

describe('renderMarkdown: hostile input', () => {
  for (const vector of VECTORS) {
    it(`neutralizes ${JSON.stringify(vector)}`, () => {
      const root = dom(renderMarkdown(vector));
      expect(
        root.querySelector('script, iframe, svg, img, style, form, button, object'),
      ).toBeNull();
      for (const element of root.querySelectorAll('*')) {
        for (const attribute of element.getAttributeNames()) {
          expect(attribute.startsWith('on')).toBe(false);
          expect(attribute).not.toBe('style');
          // Escaped TEXT may still say "javascript:"; what must not exist is an attribute that does.
          expect(element.getAttribute(attribute)).not.toMatch(
            /^\s*(javascript|command|vscode|file|data):/i,
          );
        }
      }
      for (const anchor of root.querySelectorAll('a')) {
        expect(anchor.getAttribute('href')).toMatch(/^(https?:|mailto:)/i);
      }
    });
  }

  it('shows raw HTML as escaped text', () => {
    const root = dom(renderMarkdown('<div>hola</div>'));
    expect(root.querySelector('div')).toBeNull();
    expect(root.textContent).toContain('<div>hola</div>');
  });

  it('shows an image as text, without an <img>', () => {
    const root = dom(renderMarkdown('![a diagram](https://x.example/y.png)'));
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('[image: a diagram]');
  });
});

describe('renderMarkdown: links', () => {
  it('keeps an https link with rel and no target', () => {
    const anchor = dom(
      renderMarkdown('[docs](https://code.visualstudio.com "VS Code")'),
    ).querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://code.visualstudio.com');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor?.getAttribute('title')).toBe('VS Code');
    expect(anchor?.hasAttribute('target')).toBe(false);
  });

  it('keeps mailto links', () => {
    const anchor = dom(renderMarkdown('[me](mailto:a@b.example)')).querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('mailto:a@b.example');
  });

  it('turns a relative link into a file reference, never an anchor', () => {
    const root = dom(renderMarkdown('see [the file](src/a.ts#L12)'));
    expect(root.querySelector('a')).toBeNull();
    const ref = root.querySelector('.file-ref');
    expect(ref?.getAttribute('data-path')).toBe('src/a.ts');
    expect(ref?.getAttribute('data-line')).toBe('12');
    expect(ref?.getAttribute('role')).toBe('link');
    expect(ref?.getAttribute('tabindex')).toBe('0');
    expect(ref?.textContent).toBe('the file');
  });

  it('leaves the text of a link it refuses', () => {
    const root = dom(renderMarkdown('[click me](javascript:alert(1))'));
    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toContain('click me');
  });
});

describe('renderMarkdown: inline code', () => {
  it('turns a path with a line into a file reference', () => {
    const ref = dom(renderMarkdown('open `src/a.ts:42`')).querySelector('.file-ref');
    expect(ref?.getAttribute('data-path')).toBe('src/a.ts');
    expect(ref?.getAttribute('data-line')).toBe('42');
    expect(ref?.hasAttribute('data-column')).toBe(false);
    expect(ref?.textContent).toBe('src/a.ts:42');
  });

  it('keeps the column', () => {
    const ref = dom(renderMarkdown('`src/a.ts:42:7`')).querySelector('.file-ref');
    expect(ref?.getAttribute('data-column')).toBe('7');
  });

  it('leaves ordinary code alone', () => {
    const root = dom(renderMarkdown('call `console.log(x)` or `a < b`'));
    expect(root.querySelector('.file-ref')).toBeNull();
    expect(root.querySelectorAll('code')).toHaveLength(2);
    expect(root.textContent).toContain('a < b');
  });
});

describe('renderMarkdown: GFM', () => {
  it('renders a table with alignment and without inline style', () => {
    const root = dom(renderMarkdown('| a | b |\n| :-- | --: |\n| 1 | 2 |'));
    expect(root.querySelector('table')).not.toBeNull();
    const cells = [...root.querySelectorAll('th')];
    expect(cells.map((cell) => cell.getAttribute('align'))).toEqual(['left', 'right']);
    expect(root.querySelector('[style]')).toBeNull();
  });

  it('renders lists, quotes, headings and strikethrough', () => {
    const root = dom(renderMarkdown('# T\n\n- a\n- b\n\n> q\n\n~~gone~~'));
    expect(root.querySelector('h1')?.textContent).toBe('T');
    expect(root.querySelectorAll('li')).toHaveLength(2);
    expect(root.querySelector('blockquote')).not.toBeNull();
    expect(root.querySelector('del')?.textContent).toBe('gone');
  });

  it('renders task list checkboxes as disabled inputs', () => {
    const input = dom(renderMarkdown('- [x] done\n- [ ] todo')).querySelector('input');
    expect(input?.getAttribute('type')).toBe('checkbox');
    expect(input?.hasAttribute('disabled')).toBe(true);
  });

  it('returns the same string for the same source (cache)', () => {
    expect(renderMarkdown('**same**')).toBe(renderMarkdown('**same**'));
  });
});

describe('highlightCode', () => {
  it('emits only span.hljs-* for a known language', () => {
    const html = highlightCode('const x: number = 1; // hi', 'ts');
    const root = dom(html);
    expect(root.querySelector('span.hljs-keyword')).not.toBeNull();
    for (const element of root.querySelectorAll('*')) {
      expect(element.tagName).toBe('SPAN');
      expect(element.getAttributeNames()).toEqual(['class']);
    }
    expect(root.textContent).toBe('const x: number = 1; // hi');
  });

  it('escapes the code of an unknown language instead of guessing', () => {
    expect(highlightCode('<b>&</b>', 'klingon')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
    expect(highlightCode('<b>', undefined)).toBe('&lt;b&gt;');
  });

  it('does not let code inject markup through a known language', () => {
    const html = highlightCode('<script>alert(1)</script>', 'html');
    expect(dom(html).querySelector('script')).toBeNull();
  });
});

describe('renderMarkdown: a link around a path', () => {
  it('lets the link win: no nested file reference, and the href decides what opens', () => {
    const root = dom(renderMarkdown('[`src/a.ts`](src/b.ts)'));
    const refs = root.querySelectorAll('.file-ref');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.getAttribute('data-path')).toBe('src/b.ts');
    expect(refs[0]?.querySelector('.file-ref')).toBeNull();
    expect(refs[0]?.textContent).toBe('src/a.ts');
  });

  it('does not nest inside an https link either', () => {
    const root = dom(renderMarkdown('[`src/a.ts`](https://example.com)'));
    expect(root.querySelector('a .file-ref')).toBeNull();
    expect(root.querySelector('a code')?.textContent).toBe('src/a.ts');
  });
});
