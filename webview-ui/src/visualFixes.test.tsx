// Protects the fixes that came out of driving a real VS Code over CDP (20/10/2026, Windows 11,
// opencode 2.0.32; method in Engram #934): a step stopped by Stop or a Reject is a neutral
// "Stopped" note at MESSAGE level, not a red error with role="alert", while an `aborted` in the
// SESSION STATUS stays a red error with its text (decision of Sergio, Engram
// `E2-mvp-prototype/decisions-visual`); the empty session title is not the same text as the "New
// session" button; single newlines in an assistant reply survive without breaking lists, tables or
// code; "Allow once" yields the primary look to "Yes, always allow" while the confirmation is
// open; and code never gets the tinted default background of VS Code's webview stylesheet.
//
// Provenance: the message-level `aborted` / "Step interrupted" error is what a REAL opencode
// 2.0.32 emitted (spike of 20/10/2026, Windows 11: `session.step.failed` after a Stop and after a
// Reject, the session then idle). A session STATUS of `aborted` was never seen from the real
// server; the status tests below FABRICATE it from `restart.ts@v2.0.32` (read, not run) to pin
// that it is NOT treated as a user stop. Everything else is fabricated in the shape of
// `src/shared`. jsdom has no layout, so colours and wrapping are checked by `test:visual`.
import { createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageInfo, PermissionAsk, SessionStatus } from '../../src/shared/model';
import type { HostToWebview } from '../../src/shared/protocol';
import { App } from './App';
import { renderMarkdown } from './markdown/renderMarkdown';
import { PermissionCard } from './requests/PermissionCard';
import { deriveActivity, isStopError } from './store/activity';
import { createChatStore } from './store/chatStore';
import { must, mount, type Mounted } from './testing';
import { createUiState } from './uiState';
import rawCss from './index.css?raw';

const SES = 'ses_1';
const ABORTED = { code: 'aborted', message: 'Step interrupted' };

const user = (id: string, text: string): MessageInfo => ({
  kind: 'user',
  id,
  createdAt: 1,
  text,
  files: [],
});
const assistant = (id: string, error?: { code: string; message: string }): MessageInfo => ({
  kind: 'assistant',
  id,
  createdAt: 2,
  agent: 'build',
  model: { providerID: 'opencode', id: 'big-pickle' },
  ...(error === undefined ? {} : { error }),
});

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/** Mounts the whole App on a fresh store; returns the container and an `apply` for host messages. */
function startApp() {
  const store = createRoot(() => createChatStore());
  const container = document.createElement('div');
  document.body.append(container);
  const dispose = render(
    () => (
      <App
        store={store}
        send={() => undefined}
        uiState={createUiState({ getState: () => undefined, setState: () => undefined })}
      />
    ),
    container,
  );
  disposers.push(() => {
    dispose();
    container.remove();
  });
  const apply = (...messages: HostToWebview[]): void => {
    for (const message of messages) store.apply(message);
  };
  apply({ type: 'connection.state', connection: { state: 'connected', serverVersion: '2.0.32' } });
  return { container, apply };
}

/** A snapshot with `SES` open. */
function open(messages: MessageInfo[], status: SessionStatus): HostToWebview {
  return {
    type: 'snapshot',
    snapshot: {
      sessions: [{ id: SES, createdAt: 1, updatedAt: 2 }],
      statuses: { [SES]: status },
      open: { sessionID: SES, messages, parts: {} },
      requests: { permissions: [], forms: [] },
      resolutions: [],
    },
  };
}

describe('a stopped turn is not an error', () => {
  it('recognises only the aborted code', () => {
    expect(isStopError(ABORTED)).toBe(true);
    expect(isStopError({ code: 'provider.no-route', message: 'x' })).toBe(false);
    expect(isStopError(undefined)).toBe(false);
  });

  it('keeps an aborted SESSION status an error activity, with its text', () => {
    const connected = { state: 'connected', serverVersion: '2.0.32' } as const;
    const interrupted = {
      code: 'aborted',
      message: 'Execution was interrupted repeatedly and will not be resumed automatically.',
    };
    expect(deriveActivity(connected, { type: 'error', error: interrupted }, [])).toEqual({
      kind: 'error',
      label: 'Error',
      error: interrupted,
    });
  });

  it('shows "Stopped" in line, neutral and without role=alert, for an aborted assistant message', () => {
    const { container, apply } = startApp();
    apply(open([user('m1', 'count'), assistant('m2', ABORTED)], { type: 'idle' }));
    const note = must(container, '.message-assistant .stopped-note');
    expect(note.textContent).toContain('Stopped');
    expect(note.textContent).not.toContain('Step interrupted');
    expect(note.getAttribute('role')).toBeNull();
    expect(container.querySelector('.message-assistant .alert-error')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    // Retry stays, as a secondary button: re-running a cut prompt is a one-click action.
    expect(must<HTMLButtonElement>(note, 'button').textContent).toBe('Retry');
  });

  it('keeps a real failure red with role=alert', () => {
    const { container, apply } = startApp();
    apply(
      open([user('m1', 'x'), assistant('m2', { code: 'ContextOverflow', message: 'too long' })], {
        type: 'idle',
      }),
    );
    const alert = must(container, '.message-assistant [role="alert"]');
    expect(alert.textContent).toContain('ContextOverflow');
    expect(container.querySelector('.stopped-note')).toBeNull();
  });

  const INTERRUPTED_REPEATEDLY = {
    code: 'aborted',
    message: 'Execution was interrupted repeatedly and will not be resumed automatically.',
  };

  it('shows an aborted SESSION status as a red alert with its text, not as "Stopped"', () => {
    const { container, apply } = startApp();
    apply(
      open([user('m1', 'x'), assistant('m2')], { type: 'error', error: INTERRUPTED_REPEATEDLY }),
    );
    const alert = must(container, '.status-bar [role="alert"]');
    expect(alert.textContent).toContain('aborted');
    expect(alert.textContent).toContain('interrupted repeatedly');
    expect(container.querySelector('.stopped-note')).toBeNull();
  });

  it('announces "Error: <text>", not "Stopped", when a busy turn ends with an aborted status', () => {
    const { container, apply } = startApp();
    apply(open([user('m1', 'x'), assistant('m2')], { type: 'busy' }));
    apply({
      type: 'session.status',
      sessionID: SES,
      status: { type: 'error', error: INTERRUPTED_REPEATEDLY },
    });
    const announced = must(
      container,
      '.status-bar .visually-hidden[aria-live="polite"]',
    ).textContent.trim();
    expect(announced).toContain('Error:');
    expect(announced).toContain('interrupted repeatedly');
    expect(announced).not.toBe('Stopped');
  });

  it('announces "Stopped" for a Stop the user pressed (the session goes idle, not error)', () => {
    const { container, apply } = startApp();
    apply(open([user('m1', 'x'), assistant('m2')], { type: 'busy' }));
    container.querySelectorAll('button').forEach((button) => {
      if (button.textContent === 'Stop') button.click();
    });
    apply({ type: 'session.status', sessionID: SES, status: { type: 'idle' } });
    expect(
      must(container, '.status-bar .visually-hidden[aria-live="polite"]').textContent.trim(),
    ).toBe('Stopped');
  });
});

describe('the header', () => {
  it('does not repeat "New session" as the title of an empty session', () => {
    const { container } = startApp();
    const title = must(container, '.chat-title').textContent;
    const button = [...container.querySelectorAll('header button')].map((b) => b.textContent);
    expect(button).toContain('New session');
    expect(title).toBe('Untitled session');
    expect(title).not.toBe('New session');
  });
});

describe('single newlines in Markdown', () => {
  const html = (source: string): HTMLElement => {
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown(source);
    return root;
  };

  it('turns a single newline in a paragraph into <br>', () => {
    const root = html('line one\nline two');
    expect(root.querySelectorAll('p')).toHaveLength(1);
    expect(root.querySelectorAll('br')).toHaveLength(1);
  });

  it('does not break lists: items stay items, with no <br> between them', () => {
    const root = html('- a\n- b\n- c');
    expect(root.querySelectorAll('li')).toHaveLength(3);
    expect(root.querySelector('br')).toBeNull();
    expect(html('1. a\n2. b').querySelectorAll('li')).toHaveLength(2);
  });

  it('does not break tables', () => {
    const root = html('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |');
    expect(root.querySelectorAll('tr')).toHaveLength(3);
    expect(root.querySelector('br')).toBeNull();
  });

  it('does not touch the newlines of a fenced code block', () => {
    // Inside a list item, where `renderMarkdown` (not CodeBlock) draws the fence.
    const root = html('- item\n\n  ```ts\n  const a = 1;\n  const b = 2;\n  ```');
    expect(must(root, 'pre code').textContent).toContain('const a = 1;\nconst b = 2;');
    expect(root.querySelector('pre br')).toBeNull();
  });

  it('keeps a soft break inside a list item as a <br> and a blank line as a new paragraph', () => {
    const root = html('- first\n  continued\n\nnew paragraph');
    expect(root.querySelectorAll('li br')).toHaveLength(1);
    expect(root.querySelectorAll(':scope > p')).toHaveLength(1);
  });
});

describe('permission card buttons', () => {
  const ask: PermissionAsk = {
    id: 'per_1',
    sessionID: SES,
    action: 'read',
    resources: ['.env'],
    save: ['*'],
  };
  let mounted: Mounted | undefined;
  afterEach(() => {
    mounted?.dispose();
    mounted = undefined;
  });

  it('has a single primary button at any time: Allow once, or Yes always while confirming', () => {
    mounted = mount(() => (
      <PermissionCard
        ask={ask}
        sameSessionCount={1}
        replying={false}
        onSent={() => undefined}
        onEscape={() => undefined}
      />
    ));
    const container = mounted.container;
    const primaries = () =>
      [...container.querySelectorAll('button.primary')].map((b) => b.textContent);
    expect(primaries()).toEqual(['Allow once']);

    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Always allow…')
      ?.click();
    expect(primaries()).toEqual(['Yes, always allow']);
    const once = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Allow once',
    );
    expect(once?.classList.contains('secondary')).toBe(true);

    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Back')?.click();
    expect(primaries()).toEqual(['Allow once']);
  });
});

describe('index.css', () => {
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

  /** The bodies, joined, of every rule whose selector list contains `selector` exactly. */
  const rule = (selector: string): string => {
    let bodies = '';
    for (const chunk of css.split('}')) {
      const [head, body] = chunk.split('{');
      const selectors = (head ?? '').split(',').map((s) => s.trim());
      if (body !== undefined && selectors.includes(selector)) bodies += body;
    }
    return bodies;
  };

  it('neutralises the default `code` paint of the VS Code webview inside code blocks', () => {
    const body = rule('.code-body code');
    expect(body).toMatch(/background:\s*transparent/);
    expect(body).toMatch(/color:\s*inherit/);
  });

  it('draws code in high contrast with the editor foreground on a plain background', () => {
    const body = rule("[class*='vscode-high-contrast'] .code-body");
    expect(body).toContain('--vscode-editor-foreground');
    expect(body).toMatch(/background:\s*transparent/);
    expect(rule("[class*='vscode-high-contrast'] .code-body [class*='hljs-']")).toMatch(
      /color:\s*inherit/,
    );
  });

  it('keeps "New file" on one line', () => {
    expect(rule('.code-action')).toMatch(/white-space:\s*nowrap/);
  });
});
