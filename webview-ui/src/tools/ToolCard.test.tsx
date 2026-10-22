// Protects the tool card (issue #26): folded by default with NO body in the DOM, a disclosure
// button with an accessible name that holds the whole header, an open state that survives the
// update running -> completed, the diff markers and classes, the on-screen clipping with its notice,
// and the messages the card sends (Copy, Open in editor, open a path).
//
// Provenance: FABRICATED blocks rendered in jsdom with a recording sender. jsdom does not turn
// Enter/Space into a click on a `<button>` (the browser does, natively), so the keyboard is NOT
// exercised here: the header is asserted to be a real `<button>`, and the real key presses are step
// 15 of `test:visual`. No layout either, so scrolling and colours are not covered.
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonObject, Part } from '../../../src/shared/model';
import { must, mount, type Mounted } from '../testing';
import { ToolCard } from './ToolCard';

type ToolPart = Extract<Part, { type: 'tool' }>;

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

const PATCH = [
  'Index: src/a.ts',
  '===================================================================',
  '--- src/a.ts',
  '+++ src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' one',
  '-two',
  '+TWO',
  '+three',
  '',
].join('\n');

function done(
  name: string,
  input: JsonObject,
  output: string[] = [],
  metadata?: JsonObject,
): ToolPart {
  return {
    type: 'tool',
    id: 'call_1',
    name,
    state: {
      status: 'completed',
      input,
      output: output.map((text) => ({ type: 'text' as const, text })),
      ...(metadata ? { metadata } : {}),
    },
  };
}

const card = (): HTMLElement => must(mounted?.container ?? document.body, '.tool-card');
const toggle = (): HTMLButtonElement => must<HTMLButtonElement>(card(), '.tool-toggle');

describe('ToolCard disclosure', () => {
  it('is folded by default and the body is not in the DOM', () => {
    mounted = mount(() => (
      <ToolCard
        part={done('shell', { command: 'ls' }, ['a'])}
        awaiting={false}
        onOpenSession={() => {}}
      />
    ));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().hasAttribute('aria-controls')).toBe(false);
    expect(card().querySelector('.tool-body')).toBeNull();
    expect(toggle().tagName).toBe('BUTTON');
  });

  it('opens and closes, and aria-controls points at the body only while open', () => {
    mounted = mount(() => (
      <ToolCard
        part={done('shell', { command: 'ls' }, ['a'])}
        awaiting={false}
        onOpenSession={() => {}}
      />
    ));
    toggle().click();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const body = must(card(), '.tool-body');
    expect(toggle().getAttribute('aria-controls')).toBe(body.id);
    expect(body.getAttribute('aria-live')).toBe('off');
    toggle().click();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(card().querySelector('.tool-body')).toBeNull();
  });

  it('names the toggle with the whole header in one string', () => {
    mounted = mount(() => (
      <ToolCard
        part={done('shell', { command: 'npm test' }, ['x'], { exit: 1 })}
        awaiting={false}
        onOpenSession={() => {}}
      />
    ));
    expect(toggle().getAttribute('aria-label')).toBe('Shell npm test · done · exit 1');
    expect(must(card(), '.tool-status').textContent).toBe('done');
  });

  it('keeps the open state when the same block goes from running to completed', () => {
    const [part, setPart] = createSignal<ToolPart>({
      type: 'tool',
      id: 'call_1',
      name: 'shell',
      state: { status: 'running', input: { command: 'ls' } },
    });
    mounted = mount(() => <ToolCard part={part()} awaiting={false} onOpenSession={() => {}} />);
    toggle().click();
    expect(must(card(), '.tool-status').textContent).toBe('running');
    setPart(done('shell', { command: 'ls' }, ['file.txt']));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(must(card(), '.tool-status').textContent).toBe('done');
    expect(card().textContent).toContain('file.txt');
  });

  it('brings the header into view after the frame when it opens, and not when it closes', async () => {
    // Frames queued by the tests above may fire during this one, so each call remembers its
    // element and only the toggle of THIS card is counted.
    const seen: { element: unknown; options: unknown }[] = [];
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value(this: Element, options: unknown) {
        seen.push({ element: this, options });
      },
    });
    const calls = (): unknown[] =>
      seen.filter((call) => call.element === toggle()).map((call) => call.options);
    try {
      mounted = mount(() => (
        <ToolCard
          part={done('shell', { command: 'ls' }, ['a'])}
          awaiting={false}
          onOpenSession={() => {}}
        />
      ));
      toggle().click();
      expect(calls()).toEqual([]);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(calls()).toEqual([{ block: 'nearest' }]);
      toggle().click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(calls()).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('says "waiting for approval" while a request of the tool is pending', () => {
    const running: ToolPart = {
      type: 'tool',
      id: 'call_1',
      name: 'edit',
      state: { status: 'running', input: { path: 'a.ts' } },
    };
    mounted = mount(() => <ToolCard part={running} awaiting={true} onOpenSession={() => {}} />);
    expect(must(card(), '.tool-status').textContent).toBe('waiting for approval');
    expect(card().dataset['status']).toBe('awaiting');
  });

  it('never sets a style attribute, folded or open', () => {
    mounted = mount(() => (
      <ToolCard
        part={done('edit', { path: 'src/a.ts' }, [], {
          files: [{ file: 'src/a.ts', patch: PATCH }],
        })}
        awaiting={false}
        onOpenSession={() => {}}
      />
    ));
    toggle().click();
    expect(card().querySelector('[style]')).toBeNull();
  });
});

describe('ToolCard bodies', () => {
  it('draws a diff with a marker and a kind on every line', () => {
    mounted = mount(() => (
      <ToolCard
        part={done('edit', { path: 'src/a.ts' }, ['Edited'], {
          files: [{ file: 'src/a.ts', patch: PATCH }],
        })}
        awaiting={false}
        onOpenSession={() => {}}
      />
    ));
    toggle().click();
    const lines = [...card().querySelectorAll('.diff-line')].map((line) => [
      (line as HTMLElement).dataset['kind'],
      line.textContent,
    ]);
    expect(lines).toEqual([
      ['hunk', '@@ -1,2 +1,3 @@'],
      ['ctx', ' one'],
      ['del', '-two'],
      ['add', '+TWO'],
      ['add', '+three'],
    ]);
  });

  it('clips a long shell output to its tail and says how much is hidden', () => {
    const output = Array.from({ length: 500 }, (_, index) => `line ${String(index + 1)}`).join(
      '\n',
    );
    mounted = mount(() => (
      <ToolCard
        part={done('shell', { command: 'x' }, [output])}
        awaiting={false}
        onOpenSession={() => {}}
      />
    ));
    toggle().click();
    const shown = must(card(), 'pre[aria-label="Output"]').textContent;
    expect(shown.split('\n')).toHaveLength(200);
    expect(shown.endsWith('line 500')).toBe(true);
    expect(must(card(), '.tool-notice').textContent).toBe('Showing the last 200 of 500 lines.');
  });

  it('Copy and Open in editor send the FULL text, not the clipped one', () => {
    const output = Array.from({ length: 300 }, (_, index) => `l${String(index)}`).join('\n');
    mounted = mount(() => (
      <ToolCard
        part={done('read', { path: 'src/a.ts' }, [output])}
        awaiting={false}
        onOpenSession={() => {}}
      />
    ));
    toggle().click();
    must<HTMLButtonElement>(card(), 'button[aria-label="Copy contents"]').click();
    must<HTMLButtonElement>(card(), 'button[aria-label="Open contents in an editor"]').click();
    expect(mounted.sent).toEqual([
      { type: 'clipboard.write', text: output },
      { type: 'editor.newFile', text: output, language: 'typescript' },
    ]);
  });

  it('opens a path from the header and a grep hit at its line', () => {
    mounted = mount(() => (
      <ToolCard
        part={done('read', { path: 'src/a.ts', offset: 7 }, [
          'Read file src/a.ts, lines 7-9\n7: x',
        ])}
        awaiting={false}
        onOpenSession={() => {}}
      />
    ));
    must<HTMLButtonElement>(card(), 'button[aria-label="Open src/a.ts at line 7"]').click();
    expect(mounted.sent).toEqual([{ type: 'editor.open', path: 'src/a.ts', line: 7 }]);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens a grep hit at its line', () => {
    mounted = mount(() => (
      <ToolCard
        part={done('grep', { pattern: 'greet' }, ['Found 1 match\nsrc/a.ts:\n  Line 3: greet()'])}
        awaiting={false}
        onOpenSession={() => {}}
      />
    ));
    toggle().click();
    must<HTMLButtonElement>(card(), 'button[aria-label="Open src/a.ts at line 3"]').click();
    expect(mounted.sent).toEqual([{ type: 'editor.open', path: 'src/a.ts', line: 3 }]);
  });

  it('shows the generic view for an unknown tool', () => {
    mounted = mount(() => (
      <ToolCard
        part={done('mcp_echo', { message: 'hi' }, ['echo: hi'])}
        awaiting={false}
        onOpenSession={() => {}}
      />
    ));
    toggle().click();
    expect(card().textContent).toContain('"message": "hi"');
    expect(card().textContent).toContain('echo: hi');
  });

  it('shows the error of a failed tool as plain text, with no alert role', () => {
    const failed: ToolPart = {
      type: 'tool',
      id: 'c',
      name: 'shell',
      state: {
        status: 'error',
        input: { command: 'x' },
        error: { code: 'tool.execution', message: 'Unable to execute command: x' },
      },
    };
    mounted = mount(() => <ToolCard part={failed} awaiting={false} onOpenSession={() => {}} />);
    toggle().click();
    expect(must(card(), '.tool-error').textContent).toBe('Unable to execute command: x');
    expect(card().querySelector('[role="alert"]')).toBeNull();
    expect(must(card(), '.tool-status').dataset['tone']).toBe('error');
  });
});

describe('ToolCard subagent', () => {
  it('has its own button, outside the toggle, that does not unfold the card', () => {
    const opened: string[] = [];
    const part = done('subagent', { agent: 'general', description: 'Say hello' }, [], {
      sessionID: 'ses_kid',
      status: 'completed',
    });
    mounted = mount(() => (
      <ToolCard
        part={part}
        awaiting={false}
        onOpenSession={(id) => {
          opened.push(id);
        }}
      />
    ));
    const button = must<HTMLButtonElement>(card(), '.subagent-link');
    expect(toggle().contains(button)).toBe(false);
    button.click();
    expect(opened).toEqual(['ses_kid']);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
});
