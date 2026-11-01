// Protects the behaviour that spans components in the chat UI: the empty state fills (does not
// send) the input; Send / Stop / Retry / Attach post the right protocol messages; a failed send
// gives the text back; the live region announces how a turn ended; and the connection and error
// states are visible with the right roles.
//
// Phase 3 adds: the connection banner's Restart server / Show logs buttons, and where the request
// dock sits in the page (the turn announcements are read from the status strip's own live region,
// because the dock has another one for requests).
//
// Provenance: a real `createChatStore` driven with FABRICATED host messages, rendered in jsdom
// with a recording sender and a fake persisted-state API. They confirm the wiring between the
// components and the store, not the host contract, the layout, the themes or a screen reader
// (F5 points 1, 6, 8-11).
import { batch, createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChangedFile,
  MessageInfo,
  Part,
  RequestResolution,
  SessionStatus,
} from '../../src/shared/model';
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol';
import { App, FILE_SEARCH_DEBOUNCE_MS } from './App';
import { createChatStore, type ChatStore } from './store/chatStore';
import { must, splitRequestId } from './testing';
import { createUiState } from './uiState';

const SES = 'ses_1';
const user = (id: string, text: string): MessageInfo => ({
  kind: 'user',
  id,
  createdAt: 1,
  text,
  files: [],
});
const assistant = (
  id: string,
  extra: Partial<Extract<MessageInfo, { kind: 'assistant' }>> = {},
): MessageInfo => ({
  kind: 'assistant',
  id,
  createdAt: 2,
  agent: 'build',
  model: { providerID: 'opencode', id: 'big-pickle' },
  ...extra,
});

interface Harness {
  store: ChatStore;
  sent: WebviewToHost[];
  /** The `chat.focusChanged` messages, apart from `sent`. */
  focusReports: WebviewToHost[];
  saved: unknown[];
  container: HTMLElement;
  apply(...messages: HostToWebview[]): void;
  textarea(): HTMLTextAreaElement;
  button(name: string): HTMLButtonElement;
  type(text: string): void;
  dispose(): void;
}

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

/** Mounts the App with a fresh store; `initial` is the persisted state it restores. */
function start(initial: unknown = undefined): Harness {
  const store = createRoot(() => createChatStore());
  const sent: WebviewToHost[] = [];
  const focusReports: WebviewToHost[] = [];
  const saved: unknown[] = [];
  const uiState = createUiState({
    getState: () => initial,
    setState: (state) => {
      saved.push(state);
    },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const dispose = render(
    () => (
      <App
        store={store}
        send={(message) => {
          // Focus reports (issue #35) go to their own list so `sent.at(-1)` and `sent[0]` keep
          // meaning "the last / first thing the user caused".
          if (message.type === 'chat.focusChanged') focusReports.push(message);
          else sent.push(message);
        }}
        uiState={uiState}
      />
    ),
    container,
  );
  const harness: Harness = {
    store,
    sent,
    focusReports,
    saved,
    container,
    apply: (...messages) => {
      for (const message of messages) store.apply(message);
    },
    textarea: () => must<HTMLTextAreaElement>(container, 'textarea'),
    button: (name) => {
      const found = [...container.querySelectorAll('button')].find(
        (b) => b.textContent === name || b.getAttribute('aria-label') === name,
      );
      if (found === undefined) throw new Error(`no button named ${name}`);
      return found;
    },
    type: (text) => {
      const field = must<HTMLTextAreaElement>(container, 'textarea');
      field.value = text;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    },
    dispose: () => {
      dispose();
      container.remove();
    },
  };
  harnesses.push(harness);
  return harness;
}

/** A snapshot with `SES` open, the given messages and status, and a connected server. */
function openSession(
  messages: MessageInfo[],
  status: SessionStatus = { type: 'idle' },
  parts: Record<string, never[]> = {},
): HostToWebview[] {
  return [
    { type: 'connection.state', connection: { state: 'connected', serverVersion: '2.0.32' } },
    {
      type: 'snapshot',
      snapshot: {
        sessions: [{ id: SES, title: 'Fix the build', createdAt: 1, updatedAt: 2 }],
        statuses: { [SES]: status },
        open: { sessionID: SES, messages, parts },
        requests: { permissions: [], forms: [] },
        resolutions: [],
      },
    },
  ];
}

const connected: HostToWebview = {
  type: 'connection.state',
  connection: { state: 'connected', serverVersion: '2.0.32' },
};

describe('empty state and header', () => {
  it('shows suggestions that fill the input without sending', () => {
    const h = start();
    h.apply(connected);
    const suggestion = must<HTMLButtonElement>(h.container, '.suggestion');
    suggestion.click();
    expect(h.textarea().value).toBe(suggestion.textContent);
    expect(h.sent).toEqual([]);
  });

  // E5 (issues #23/#24, decision of 21/10/2026): the disabled "Agent · model" marker is gone from the
  // header; each assistant reply says which agent and model answered instead.
  it('shows the session title, no model marker in the header, and the agent and model of each reply', () => {
    const h = start();
    expect(must(h.container, '.chat-title').textContent).toBe('Untitled session');
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    expect(must(h.container, '.chat-title').textContent).toBe('Fix the build');
    expect(h.container.querySelector('.model-marker')).toBeNull();
    expect(must(h.container, 'header').textContent).not.toContain('·');
    expect(must(h.container, '.message-assistant .message-meta').textContent).toBe(
      'build · opencode/big-pickle',
    );
    expect(h.container.querySelector('.suggestion')).toBeNull();
  });

  // Issue #20, decision of 21/10/2026: "New session" is LAZY. The webview only asks the host to
  // forget the open session; the host creates nothing, and the snapshot that comes back (no `open`)
  // is what empties the view. The input takes the focus so the user can type at once.
  it('"New session" asks the host to forget the open session, focuses the prompt, and the empty snapshot empties the view', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    expect(h.container.querySelector('.suggestion')).toBeNull();
    h.button('New session').click();
    expect(h.sent).toMatchObject([{ type: 'session.new' }]);
    expect(document.activeElement).toBe(h.textarea());
    h.apply({
      type: 'snapshot',
      snapshot: {
        sessions: [],
        statuses: {},
        requests: { permissions: [], forms: [] },
        resolutions: [],
      },
    });
    expect(h.container.querySelector('.suggestion')).not.toBeNull();
    expect(must(h.container, '.chat-title').textContent).toBe('Untitled session');
  });

  it('has a "Sessions" button that needs a connection and opens the list', () => {
    const h = start();
    expect(h.button('Sessions').disabled).toBe(true);
    h.apply(connected);
    const button = h.button('Sessions');
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(h.sent).toMatchObject([{ type: 'sessions.query', search: '', more: false }]);
    expect(h.container.querySelector('[role="dialog"][aria-label="Sessions"]')).not.toBeNull();
  });

  // Issue #77 (E3, Q7=1): in an editor tab the host writes the surface meta and the Sessions tree
  // view is the one place to browse. Fabricated DOM: the meta is added by hand; the real document
  // is covered by test:visual step 29 cell B7.
  it('in an editor tab (surface meta "tab") has no "Sessions" button, but keeps New session and the subagent list', () => {
    const meta = document.createElement('meta');
    meta.name = 'open-vs-code-surface';
    meta.content = 'tab';
    document.head.append(meta);
    try {
      const h = start();
      h.apply(
        ...openWith(
          [
            { id: SES, title: 'Fix the build' },
            { id: 'ses_k1', title: 'Child', parentID: SES, agent: 'general', createdAt: 10 },
          ],
          [user('m1', 'hi')],
        ),
      );
      const labels = [...must(h.container, 'header').querySelectorAll('button')].map(
        (button) => button.textContent,
      );
      expect(labels).toEqual(['New session']);
      expect(h.container.querySelector('[data-session-trigger]')).toBeNull();
      expect(must(h.container, '.chat-title').textContent).toBe('Fix the build');
      expect(must(h.container, 'details.subagent-sessions summary').textContent).toBe(
        'Subagent sessions (1)',
      );
    } finally {
      meta.remove();
    }
  });

  it('opening a session from the list sends session.open, closes the list and focuses the prompt', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]));
    h.button('Sessions').click();
    const query = h.sent[0];
    h.apply({
      type: 'sessions.page',
      requestId: query !== undefined && 'requestId' in query ? query.requestId : '',
      search: '',
      sessions: [{ id: 'ses_2', title: 'Other work', createdAt: 1, updatedAt: Date.now() }],
      append: false,
      hasMore: false,
    });
    must<HTMLButtonElement>(h.container, 'button.session-main').click();
    expect(h.sent.at(-1)).toMatchObject({ type: 'session.open', sessionID: 'ses_2' });
    expect(h.container.querySelector('.session-picker')).toBeNull();
    expect(document.activeElement).toBe(h.textarea());
  });

  it('deleting the open session (here from another client) leaves the empty view', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    expect(must(h.container, '.chat-title').textContent).toBe('Fix the build');
    h.apply({ type: 'session.removed', sessionID: SES });
    expect(h.container.querySelector('.suggestion')).not.toBeNull();
    expect(must(h.container, '.chat-title').textContent).toBe('Untitled session');
  });

  it('has the landmarks: header, main with a log, a labelled form', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]));
    expect(h.container.querySelector('header')).not.toBeNull();
    expect(h.container.querySelector('main [role="log"]')).not.toBeNull();
    expect(h.container.querySelector('form[aria-label]')).not.toBeNull();
  });
});

describe('sending', () => {
  it('sends the trimmed draft with queue delivery, clears it and remembers it', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]));
    h.type('  hello there  ');
    h.button('Send').click();
    expect(h.sent).toMatchObject([
      { type: 'prompt.send', sessionID: SES, text: 'hello there', delivery: 'queue', files: [] },
    ]);
    expect(h.textarea().value).toBe('');
    // The state also carries the session shown (issue #77), since a snapshot opened `SES`.
    expect(h.saved.at(-1)).toEqual({
      draft: '',
      history: ['hello there'],
      files: [],
      sessionID: SES,
    });
  });

  it('restores the draft and the attachments, and shows the error, when the send fails', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]));
    h.apply({
      type: 'attachments.picked',
      requestId: 'pick',
      files: [{ uri: 'file:///a.ts', name: 'a.ts' }],
    });
    h.type('please look');
    h.button('Send').click();
    const request = h.sent[0];
    expect(request).toMatchObject({ type: 'prompt.send', files: [{ uri: 'file:///a.ts' }] });
    expect(h.textarea().value).toBe('');
    expect(h.container.querySelector('.chip')).toBeNull();

    h.apply({
      type: 'request.result',
      requestId: request && 'requestId' in request ? request.requestId : '',
      error: { code: 'ServerUnavailable', message: 'The opencode server is not running' },
    });
    expect(h.textarea().value).toBe('please look');
    expect(h.container.querySelector('.chip')?.textContent).toContain('a.ts');
    const alert = must(h.container, '[role="alert"]');
    expect(alert.textContent).toContain('The opencode server is not running');
  });

  it('gives the text back but NOT the attachments when the host rejected them (AttachmentRejected)', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]));
    h.apply({
      type: 'attachments.picked',
      requestId: 'pick',
      files: [{ uri: 'file:///a.ts', name: 'a.ts' }],
    });
    h.type('please look');
    h.button('Send').click();
    const request = h.sent[0];
    h.apply({
      type: 'request.result',
      requestId: request && 'requestId' in request ? request.requestId : '',
      error: { code: 'AttachmentRejected', message: 'Only files chosen with Attach can be sent' },
    });
    expect(h.textarea().value).toBe('please look');
    expect(h.container.querySelector('.chip')).toBeNull();
    expect(must(h.container, '[role="alert"]').textContent).toContain('Only files chosen');
  });

  it('keeps what the user typed meanwhile instead of overwriting it on failure', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]));
    h.type('first');
    h.button('Send').click();
    h.type('second draft');
    const request = h.sent[0];
    h.apply({
      type: 'request.result',
      requestId: request && 'requestId' in request ? request.requestId : '',
      error: { code: 'X', message: 'failed' },
    });
    expect(h.textarea().value).toBe('second draft');
  });

  it('does not send while busy, and the draft is kept', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')], { type: 'busy' }));
    h.type('another');
    h.textarea().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(h.sent).toEqual([]);
    expect(h.textarea().value).toBe('another');
  });

  it('sends the files chosen with Attach and lets a chip be removed first', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]));
    h.button('Add context').click();
    h.button('Attach file…').click();
    expect(h.sent).toMatchObject([{ type: 'attachments.pick' }]);
    expect(h.sent[0]).not.toHaveProperty('kind');
    const pickRequest = h.sent[0];
    const requestId = pickRequest && 'requestId' in pickRequest ? pickRequest.requestId : '';
    h.apply(
      {
        type: 'attachments.picked',
        requestId,
        files: [
          { uri: 'file:///a.ts', name: 'a.ts' },
          { uri: 'file:///b.ts', name: 'b.ts' },
          { uri: 'file:///a.ts', name: 'a.ts' },
        ],
      },
      { type: 'request.result', requestId },
    );
    expect(h.container.querySelectorAll('.chip')).toHaveLength(2);
    h.button('Remove b.ts').click();
    h.type('what is in the file?');
    h.button('Send').click();
    expect(h.sent[1]).toMatchObject({
      type: 'prompt.send',
      files: [{ uri: 'file:///a.ts', name: 'a.ts' }],
    });
  });

  it('restores the draft and the history persisted by the previous document', () => {
    const h = start({ draft: 'unsent', history: ['old prompt'] });
    expect(h.textarea().value).toBe('unsent');
    h.textarea().setSelectionRange(0, 0);
    h.textarea().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );
    expect(h.textarea().value).toBe('old prompt');
  });
});

describe('stopping', () => {
  it('shows Stop while busy and aborts the open session', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'count'), assistant('m2')], { type: 'busy' }));
    expect(h.container.querySelector('button[type="submit"]')).toBeNull();
    h.button('Stop').click();
    expect(h.sent).toMatchObject([{ type: 'session.abort', sessionID: SES }]);
  });

  it('stops with Escape in the textarea', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'count'), assistant('m2')], { type: 'busy' }));
    h.textarea().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(h.sent).toMatchObject([{ type: 'session.abort', sessionID: SES }]);
  });

  it('shows the activity while busy and Send again afterwards', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'count'), assistant('m2')], { type: 'busy' }));
    expect(must(h.container, '.activity').textContent).toContain('Working');
    h.apply({ type: 'session.status', sessionID: SES, status: { type: 'idle' } });
    expect(h.container.querySelector('.activity')).toBeNull();
    expect(h.button('Send')).toBeDefined();
  });
});

describe('announcements', () => {
  const announced = (h: Harness): string =>
    must(h.container, '.status-bar .visually-hidden[aria-live="polite"]').textContent.trim();

  it('announces "Response complete" when a busy turn ends', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')], { type: 'busy' }));
    expect(announced(h)).toBe('');
    h.apply({ type: 'session.status', sessionID: SES, status: { type: 'idle' } });
    expect(announced(h)).toBe('Response complete');
  });

  it('announces "Stopped" after Stop and "Error: ..." after a failure', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')], { type: 'busy' }));
    h.button('Stop').click();
    h.apply({ type: 'session.status', sessionID: SES, status: { type: 'idle' } });
    expect(announced(h)).toBe('Stopped');

    h.apply({ type: 'session.status', sessionID: SES, status: { type: 'busy' } });
    h.apply({
      type: 'session.status',
      sessionID: SES,
      status: { type: 'error', error: { code: 'provider.no-route', message: 'no model' } },
    });
    expect(announced(h)).toBe('Error: no model');
  });

  it('changes the live region content even when the same text repeats', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')], { type: 'busy' }));
    h.apply({ type: 'session.status', sessionID: SES, status: { type: 'idle' } });
    const first = must(h.container, '.status-bar .visually-hidden[aria-live="polite"]').textContent;
    h.apply({ type: 'session.status', sessionID: SES, status: { type: 'busy' } });
    h.apply({ type: 'session.status', sessionID: SES, status: { type: 'idle' } });
    const second = must(
      h.container,
      '.status-bar .visually-hidden[aria-live="polite"]',
    ).textContent;
    expect(second.trim()).toBe(first.trim());
    expect(second).not.toBe(first);
  });
});

describe('errors and retry', () => {
  it('shows the session error with its code and a Retry that resends the last user prompt', () => {
    const h = start();
    h.apply(
      ...openSession([user('m1', 'first'), assistant('m2'), user('m3', 'the last one')], {
        type: 'error',
        error: { code: 'provider.no-route', message: 'Model unavailable' },
      }),
    );
    const alert = must(h.container, '[role="alert"]');
    expect(alert.textContent).toContain('provider.no-route');
    expect(alert.textContent).toContain('Model unavailable');
    h.button('Retry').click();
    expect(h.sent).toMatchObject([
      { type: 'prompt.send', sessionID: SES, text: 'the last one', delivery: 'queue', files: [] },
    ]);
  });

  it('shows the error of the assistant message in line, with a single Retry', () => {
    const h = start();
    h.apply(
      ...openSession(
        [
          user('m1', 'ask'),
          assistant('m2', { error: { code: 'ContextOverflow', message: 'too long' } }),
        ],
        { type: 'error', error: { code: 'ContextOverflow', message: 'too long' } },
      ),
    );
    expect(h.container.querySelector('.message-assistant [role="alert"]')?.textContent).toContain(
      'ContextOverflow',
    );
    expect(
      [...h.container.querySelectorAll('button')].filter((b) => b.textContent === 'Retry'),
    ).toHaveLength(1);
  });

  it('lets a notice be dismissed', () => {
    const h = start();
    h.apply(connected, {
      type: 'notice',
      level: 'warning',
      error: { code: 'NoActiveEditor', message: 'Open a file to insert code' },
    });
    expect(h.container.textContent).toContain('Open a file to insert code');
    h.button('Dismiss notice').click();
    expect(h.container.textContent).not.toContain('Open a file to insert code');
  });
});

describe('connection states', () => {
  // E2 (issue #85): the visible connection line is gone (P10=1); the hidden live region keeps the text.
  it.each([
    [{ state: 'starting' }, 'Starting'],
    [{ state: 'reconnecting', attempt: 2 }, 'Reconnecting (2)'],
    [{ state: 'stopped' }, 'Stopped'],
    [{ state: 'connected', serverVersion: '2.0.32' }, 'Connected'],
  ] as const)('announces %j as "%s" in the hidden live region', (connection, text) => {
    const h = start();
    h.apply({ type: 'connection.state', connection });
    const region = must(h.container, '.connection-status');
    expect(region.textContent).toContain(text);
    expect(region.classList.contains('visually-hidden')).toBe(true);
    expect(h.container.querySelector('.connection-row')).toBeNull();
  });

  const unavailable = (
    reason: 'binary-missing' | 'exited' | 'start-failed' | 'no-workspace',
    message: string,
  ): HostToWebview => ({
    type: 'connection.state',
    connection: { state: 'unavailable', reason, error: { code: reason, message } },
  });

  describe('setup guide and connection card (E2, issue #85)', () => {
    it('shows the guide, and not the header or the prompt box, after a failure with no conversation', () => {
      const h = start();
      h.apply(unavailable('binary-missing', 'opencode was not found'));
      expect(must(h.container, '.setup-guide h2').textContent).toBe('Set up opencode');
      expect(h.container.querySelector('.chat-header')).toBeNull();
      expect(h.container.querySelector('textarea')).toBeNull();
      expect(must(h.container, '.app').getAttribute('data-connection')).toBe('unavailable');
      h.button('Show logs').click();
      expect(h.sent).toEqual([{ type: 'logs.show' }]);
    });

    it('keeps the guide through the next starting and drops it at connected (P1=1)', () => {
      const h = start();
      h.apply(unavailable('start-failed', 'could not start'));
      h.apply({ type: 'connection.state', connection: { state: 'starting' } });
      expect(h.container.querySelector('.setup-guide')).not.toBeNull();
      h.apply(connected);
      expect(h.container.querySelector('.setup-guide')).toBeNull();
      expect(h.container.querySelector('textarea')).not.toBeNull();
    });

    it('never shows the guide in a normal start (starting then connected)', () => {
      const h = start();
      h.apply({ type: 'connection.state', connection: { state: 'starting' } });
      expect(h.container.querySelector('.setup-guide')).toBeNull();
      h.apply(connected);
      expect(h.container.querySelector('.setup-guide')).toBeNull();
    });

    it('shows the card at the end of the conversation, keeps the history and never takes the focus', () => {
      const h = start();
      h.apply(...openSession([user('m1', 'hello there'), assistant('m2')]));
      h.apply(unavailable('exited', 'The server exited'));
      const log = must(h.container, '[role="log"]');
      expect(log.textContent).toContain('hello there');
      const card = must(log, '.connection-card');
      expect(card.getAttribute('role')).toBe('alert');
      expect(card.textContent).toContain('opencode stopped');
      expect(h.container.querySelector('.setup-guide')).toBeNull();
      expect(card.contains(document.activeElement)).toBe(false);
      h.button('Restart').click();
      expect(h.sent).toEqual([{ type: 'server.restart' }]);
      expect(h.textarea().placeholder).toBe('Waiting for opencode…');
      expect(h.textarea().disabled).toBe(false);
      expect(h.textarea().readOnly).toBe(false);
    });

    // Issue #124. SYNTHETIC: a fabricated `not-started` state, no host behind it.
    it('not-started shows the Start card, sends server.restart, and still lets a prompt go', () => {
      const h = start();
      h.apply({ type: 'connection.state', connection: { state: 'not-started' } });
      const card = must(h.container, '.connection-card');
      expect(card.getAttribute('role')).toBe('status');
      expect(card.textContent).toContain('opencode is not running');
      expect(h.container.querySelector('.setup-guide')).toBeNull();
      h.button('Start').click();
      expect(h.sent).toEqual([{ type: 'server.restart' }]);
      expect(h.textarea().placeholder).not.toBe('Waiting for opencode…');
      h.type('hello');
      h.button('Send').click();
      expect(h.sent.at(-1)).toMatchObject({ type: 'prompt.send', text: 'hello' });
    });

    it('reconnecting is a neutral status card with only Show logs', () => {
      const h = start();
      h.apply(...openSession([user('m1', 'hello there'), assistant('m2')]));
      h.apply({ type: 'connection.state', connection: { state: 'reconnecting', attempt: 1 } });
      const card = must(h.container, '.connection-card');
      expect(card.getAttribute('role')).toBe('status');
      expect(card.textContent).toContain('Reconnecting to opencode (attempt 1)…');
      expect(card.querySelectorAll('button')).toHaveLength(1);
    });

    it('no folder is a simple card with Open folder, not the guide (P15=2)', () => {
      const h = start();
      h.apply(unavailable('no-workspace', 'No folder'));
      expect(h.container.querySelector('.setup-guide')).toBeNull();
      expect(must(h.container, '.connection-card').textContent).toContain('Open a folder to start');
      h.button('Open folder').click();
      expect(h.sent).toEqual([{ type: 'setup.action', action: 'folder.open' }]);
    });
  });
});

// Phase 3 (issues #18/#44): the dock and how it sits in the page.
describe('request dock in the app', () => {
  const permission = {
    id: 'per_1',
    sessionID: SES,
    action: 'read',
    resources: ['.env'],
    save: ['*'],
  };

  it('sits between the conversation and the status strip, above the prompt', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]));
    h.apply({ type: 'permission.asked', permission });
    const app = must(h.container, '.app');
    const order = [...app.children].map((child) => child.className.split(' ')[0]);
    expect(order.indexOf('chat-main')).toBeLessThan(order.indexOf('request-dock'));
    expect(order.indexOf('request-dock')).toBeLessThan(order.indexOf('status-bar'));
    expect(order.indexOf('status-bar')).toBeLessThan(order.indexOf('prompt'));
  });

  it('no longer prints the old "Waiting for permission" line', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]));
    h.apply({ type: 'permission.asked', permission });
    expect(h.container.textContent).not.toContain('Waiting for permission');
    expect(h.container.textContent).toContain('Permission needed: Read');
  });

  // The host sent no `resolution` (it never saw the request asked): the dock line is the fallback.
  it('answering a card posts the reply and sending the next prompt clears the result line', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]));
    h.apply({ type: 'permission.asked', permission });
    h.button('Allow once').click();
    expect(h.sent).toMatchObject([
      { type: 'permission.reply', sessionID: SES, permissionID: 'per_1', decision: 'once' },
    ]);
    h.apply({
      type: 'permission.resolved',
      sessionID: SES,
      permissionID: 'per_1',
      decision: 'once',
    });
    expect(must(h.container, '.request-results').textContent).toContain('Allowed once: Read .env');
    h.type('next question');
    h.button('Send').click();
    expect(h.container.querySelector('.request-results')).toBeNull();
  });
});

// E3-resolved-history (issues #56/#18): what the user answered stays in the conversation, under the
// tool that asked. FABRICATED host messages, except the rejected `read` state, which copies a real
// opencode 2.0.32 row (see `toolOutcome.test.ts`). Lessons #906 (writes after mount), #926 (whole
// strings), #918 (no role="alert" for a decision).
describe('answered requests in the conversation', () => {
  const TOOL = { messageID: 'm2', partID: 'call_1' };
  const permission = {
    id: 'per_1',
    sessionID: SES,
    action: 'read',
    resources: ['.env'],
    save: ['*'],
    tool: TOOL,
  };
  const record = (
    extra: Partial<Extract<RequestResolution, { kind: 'permission' }>> = {},
  ): RequestResolution => ({
    kind: 'permission',
    id: 'per_1',
    sessionID: SES,
    tool: TOOL,
    at: 5,
    decision: 'once',
    action: 'read',
    resource: '.env',
    withFeedback: false,
    ...extra,
  });
  const readPart = (state: Extract<Part, { type: 'tool' }>['state']): Part => ({
    type: 'tool',
    id: 'call_1',
    name: 'read',
    state,
  });
  const allowed = readPart({ status: 'completed', input: { path: '.env' }, output: [] });
  const declined = readPart({
    status: 'error',
    input: { path: '.env' },
    error: { code: 'aborted', message: 'The user declined this tool call' },
  });

  /** A snapshot with a user message and an assistant message `m2` holding `part`. */
  const withTool = (part: Part, resolutions: RequestResolution[] = []): HostToWebview => ({
    type: 'snapshot',
    snapshot: {
      sessions: [{ id: SES, createdAt: 1, updatedAt: 2 }],
      statuses: { [SES]: { type: 'idle' } },
      open: {
        sessionID: SES,
        messages: [user('m1', 'read it'), assistant('m2')],
        parts: { m2: [part] },
      },
      requests: { permissions: [], forms: [] },
      resolutions,
    },
  });
  const lines = (h: Harness) =>
    [...h.container.querySelectorAll('[role="log"] .request-outcome')].map((p) => p.textContent);

  it('shows "Allowed once" under the tool, not in the dock, and without an alert', () => {
    const h = start();
    h.apply(connected, withTool(allowed));
    h.apply({ type: 'permission.asked', permission });
    h.apply({
      type: 'permission.resolved',
      sessionID: SES,
      permissionID: 'per_1',
      decision: 'once',
      resolution: record(),
    });
    expect(lines(h)).toEqual(['Permission: Allowed once · Read .env']);
    const article = must(h.container, '.message-assistant');
    // Right after the tool line, nested in the message so the log keeps one child per message.
    expect(article.querySelector('.tool-card + .request-outcome')).not.toBeNull();
    expect(h.container.querySelector('.request-results')).toBeNull();
    expect(h.container.querySelector('[role="alert"]')).toBeNull();
    expect(must(h.container, '.request-outcome .visually-hidden').textContent).toBe('Permission: ');
    expect(h.container.querySelectorAll('[role="log"] > *')).toHaveLength(2);
  });

  it('is not erased by sending the next prompt', () => {
    const h = start();
    h.apply(connected, withTool(allowed));
    h.apply({ type: 'permission.asked', permission });
    h.apply({
      type: 'permission.resolved',
      sessionID: SES,
      permissionID: 'per_1',
      decision: 'once',
      resolution: record(),
    });
    h.type('next question');
    h.button('Send').click();
    expect(lines(h)).toEqual(['Permission: Allowed once · Read .env']);
  });

  it('a record without a tool block goes to the end of the latest message before it was answered', () => {
    const h = start();
    h.apply(connected, withTool(allowed, [record({ tool: undefined, at: 1 })]));
    // user m1 and assistant m2 have createdAt 1 and 2: `at: 1` lands on the user message.
    expect(
      [...h.container.querySelectorAll('.message-user .request-outcome')].map((p) => p.textContent),
    ).toEqual(['Permission: Allowed once · Read .env']);
    h.apply(connected, withTool(allowed, [record({ tool: undefined, at: 50 })]));
    expect(
      [...h.container.querySelectorAll('.message-assistant .request-outcome')].map(
        (p) => p.textContent,
      ),
    ).toEqual(['Permission: Allowed once · Read .env']);
  });

  it('after Reload Window (a snapshot with no records) a rejected tool still says Rejected', () => {
    const h = start();
    h.apply(connected, withTool(declined, []));
    expect(lines(h)).toEqual(['Permission: Rejected · Read .env']);
    // ...and a merely allowed tool shows nothing: the server keeps no trace of that permission.
    h.apply(withTool(allowed, []));
    expect(lines(h)).toEqual([]);
  });

  it('the host record wins over the block, and the rejection feedback comes from the block', () => {
    const h = start();
    const feedback = readPart({
      status: 'error',
      input: { path: '.env' },
      error: { code: 'permission.rejected', message: "don't read secrets" },
    });
    h.apply(connected, withTool(feedback, [record({ decision: 'reject', withFeedback: true })]));
    expect(lines(h)).toEqual([
      "Permission: Rejected with feedback · Read .env — “don't read secrets”",
    ]);
  });

  it('a request of ANOTHER session keeps the dock line and adds nothing to the history', () => {
    const h = start();
    h.apply(connected, withTool(allowed));
    h.apply({
      type: 'permission.asked',
      permission: { ...permission, id: 'per_c', sessionID: 'ses_child', tool: undefined },
    });
    h.apply({
      type: 'permission.resolved',
      sessionID: 'ses_child',
      permissionID: 'per_c',
      decision: 'once',
      resolution: record({ id: 'per_c', sessionID: 'ses_child', tool: undefined }),
    });
    expect(lines(h)).toEqual([]);
    expect(must(h.container, '.request-results').textContent).toContain('Allowed once: Read .env');
    h.type('next question');
    h.button('Send').click();
    expect(h.container.querySelector('.request-results')).toBeNull();
  });
});

describe('review round: activity and pending attachments', () => {
  it('derives the activity from the status, not from the previous turn, right after sending', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'first'), assistant('m2')], { type: 'busy' }));
    h.apply({
      type: 'part.upserted',
      sessionID: SES,
      messageID: 'm2',
      part: { type: 'text', id: 'm2#0', text: 'old answer' },
    });
    expect(must(h.container, '.activity').textContent).toContain('Writing');
    // A new prompt: its user message exists, the new assistant message does not yet.
    h.apply({ type: 'message.upserted', sessionID: SES, message: user('m3', 'second') });
    const label = must(h.container, '.activity').textContent;
    expect(label).toContain('Working');
    expect(label).not.toContain('Writing');
  });

  it('persists the pending attachments and restores them in the next document', () => {
    const first = start();
    first.apply({
      type: 'attachments.picked',
      requestId: 'p',
      files: [{ uri: 'file:///a.ts', name: 'a.ts' }],
    });
    expect(first.saved.at(-1)).toMatchObject({ files: [{ uri: 'file:///a.ts', name: 'a.ts' }] });

    const second = start(first.saved.at(-1));
    expect(second.container.querySelector('.chip')?.textContent).toContain('a.ts');
  });
});

// Issue #21 (E4-fork-subsessions): "Fork from here", the subagent link and the related-sessions
// header. FABRICATED host messages in jsdom: they prove the wiring and the accessibility of the
// controls (names, aria-disabled, focus), not the host contract (`chatController*.test.ts`), the
// look or a screen reader (`test:visual` step 10 covers the look in a real VS Code).

/** A snapshot with `sessions`, `SES` open and the given messages and parts, connected. */
function openWith(
  sessions: Array<{
    id: string;
    title?: string;
    parentID?: string;
    forkOf?: string;
    agent?: string;
    createdAt?: number;
  }>,
  messages: MessageInfo[],
  parts: Record<string, Part[]> = {},
  extra: Partial<Extract<HostToWebview, { type: 'snapshot' }>['snapshot']> = {},
): HostToWebview[] {
  return [
    connected,
    {
      type: 'snapshot',
      snapshot: {
        sessions: sessions.map((row) => ({ createdAt: 1, updatedAt: 2, ...row })),
        statuses: {},
        open: { sessionID: SES, messages, parts },
        requests: { permissions: [], forms: [] },
        resolutions: [],
        ...extra,
      },
    },
  ];
}

const userWithFiles = (
  id: string,
  text: string,
  files: Extract<MessageInfo, { kind: 'user' }>['files'],
): MessageInfo => ({ kind: 'user', id, createdAt: 1, text, files });

const subagentTool = (metadata?: Record<string, string>): Part => ({
  type: 'tool',
  id: 'call_1',
  name: 'subagent',
  state: {
    status: 'completed',
    input: { agent: 'general', description: 'Say hello' },
    output: [],
    ...(metadata ? { metadata } : {}),
  },
});

describe('fork from a message (issue #21)', () => {
  const twoExchanges = [
    user('m1', 'first question'),
    assistant('m2'),
    user('m3', 'second   question\nwith a break'),
    assistant('m4'),
  ];

  it('offers "Fork from here" on user messages only, named after the message', () => {
    const h = start();
    h.apply(...openWith([{ id: SES, title: 'Fix the build' }], twoExchanges));
    const buttons = [...h.container.querySelectorAll('.message-action[aria-label^="Fork"]')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Fork from here: first question',
      'Fork from here: second question with a break',
    ]);
    expect(buttons.map((b) => b.textContent)).toEqual(['Fork from here', 'Fork from here']);
    expect(h.container.querySelectorAll('.message-assistant .message-action')).toHaveLength(0);
  });

  it('cuts a long message in the name and names an attachment-only message plainly', () => {
    const h = start();
    h.apply(
      ...openWith(
        [{ id: SES }],
        [user('m1', 'x'.repeat(100)), userWithFiles('m3', '', [{ mime: 'text/plain' }])],
      ),
    );
    const names = [...h.container.querySelectorAll('.message-action[aria-label^="Fork"]')].map(
      (b) => b.getAttribute('aria-label'),
    );
    expect(names).toEqual([`Fork from here: ${'x'.repeat(60)}…`, 'Fork from here']);
  });

  it('sends session.fork with the id of the message that was clicked', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], twoExchanges));
    h.button('Fork from here: second question with a break').click();
    expect(h.sent).toHaveLength(1);
    const { requestId, rest } = splitRequestId(h.sent[0]);
    expect(requestId).toMatch(/\S/);
    expect(rest).toEqual({ type: 'session.fork', sessionID: SES, messageID: 'm3' });
  });

  it('locks the buttons with aria-disabled (focus stays) and blocks Send while the fork is in flight', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], twoExchanges));
    const button = h.button('Fork from here: first question');
    button.focus();
    button.click();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(button);
    button.click();
    h.button('Fork from here: second question with a break').click();
    expect(h.sent).toHaveLength(1);
    h.type('typed meanwhile');
    expect(h.button('Send').getAttribute('disabled')).not.toBeNull();

    const { requestId } = splitRequestId(h.sent[0]);
    h.apply({ type: 'request.result', requestId });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
  });

  it('refills the prompt with the message text, and focuses it, when the draft is empty', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], twoExchanges));
    h.button('Fork from here: second question with a break').click();
    const { requestId } = splitRequestId(h.sent[0]);
    expect(h.textarea().value).toBe('');
    h.apply({ type: 'request.result', requestId });
    expect(h.textarea().value).toBe('second   question\nwith a break');
    expect(document.activeElement).toBe(h.textarea());
    expect(h.saved.at(-1)).toMatchObject({ draft: 'second   question\nwith a break' });
  });

  it('does not overwrite what the user was typing', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], twoExchanges));
    h.type('my own draft');
    h.button('Fork from here: first question').click();
    const { requestId } = splitRequestId(h.sent[0]);
    h.apply({ type: 'request.result', requestId });
    expect(h.textarea().value).toBe('my own draft');
    expect(document.activeElement).toBe(h.textarea());
  });

  it('re-attaches only the files of the message this document picked itself', () => {
    const h = start();
    h.apply({
      type: 'attachments.picked',
      requestId: 'pick',
      files: [{ uri: 'file:///a.ts', name: 'a.ts' }],
    });
    h.apply(
      ...openWith(
        [{ id: SES }],
        [
          userWithFiles('m1', 'look at these', [
            { mime: 'text/plain', uri: 'file:///a.ts', name: 'a.ts' },
            { mime: 'text/plain', uri: 'file:///elsewhere.ts', name: 'elsewhere.ts' },
          ]),
          assistant('m2'),
        ],
      ),
    );
    // The picked file is a pending chip already; clear it as a sent prompt would, then fork.
    h.store.takeDraftFiles();
    h.button('Fork from here: look at these').click();
    h.apply({ type: 'request.result', requestId: splitRequestId(h.sent[0]).requestId });
    // Only the pending chips of the prompt box: the message's own chips are in the conversation.
    // The chip name is a button that opens the file (a `file:` uri) or plain text (anything else).
    const chips = [...h.container.querySelectorAll('.chips .chip-open, .chips .chip-name')].map(
      (c) => c.textContent,
    );
    expect(chips).toEqual(['a.ts']);
  });

  it('leaves the prompt alone and shows the error when the fork fails', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], twoExchanges));
    h.button('Fork from here: first question').click();
    const { requestId } = splitRequestId(h.sent[0]);
    h.apply({
      type: 'request.result',
      requestId,
      error: { code: 'MessageNotFoundError', message: 'Message not found' },
    });
    expect(h.textarea().value).toBe('');
    expect(must(h.container, '[role="alert"]').textContent).toContain('Message not found');
    // And the button works again.
    expect(h.button('Fork from here: first question').hasAttribute('aria-disabled')).toBe(false);
  });

  it('locks the buttons without a connection', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], twoExchanges));
    h.apply({
      type: 'connection.state',
      connection: { state: 'reconnecting', attempt: 1, error: { code: 'x', message: 'lost' } },
    });
    const button = h.button('Fork from here: first question');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.click();
    expect(h.sent).toEqual([]);
  });
});

describe('subagent link in the conversation (issue #21)', () => {
  const withTool = (part: Part) =>
    openWith([{ id: SES }], [user('m1', 'delegate'), assistant('m2')], { m2: [part] });

  it('shows the line as one sentence and opens the child session', () => {
    const h = start();
    h.apply(...withTool(subagentTool({ sessionID: 'ses_kid', status: 'completed' })));
    expect(must(h.container, '.part-subagent .tool-toggle').getAttribute('aria-label')).toBe(
      'Subagent Say hello (general) · done',
    );
    h.button('Open subagent session Say hello').click();
    const { rest } = splitRequestId(h.sent[0]);
    expect(rest).toEqual({ type: 'session.open', sessionID: 'ses_kid' });
  });

  it('says "running" while the child runs', () => {
    const h = start();
    // A tool that is running while its child runs: `running` state, as the server publishes it.
    h.apply(
      ...withTool({
        type: 'tool',
        id: 'call_1',
        name: 'subagent',
        state: {
          status: 'running',
          input: { agent: 'general', description: 'Say hello' },
          metadata: { sessionID: 'ses_kid', status: 'running' },
        },
      }),
    );
    expect(must(h.container, '.part-subagent .tool-toggle').getAttribute('aria-label')).toBe(
      'Subagent Say hello (general) · running',
    );
  });

  it('keeps the plain card, with no button, when the block has no child id', () => {
    const h = start();
    h.apply(...withTool(subagentTool()));
    expect(must(h.container, '.tool-toggle').getAttribute('aria-label')).toBe(
      'Subagent Say hello (general) · done',
    );
    expect(h.container.querySelector('.subagent-link')).toBeNull();
    expect(h.container.querySelector('.part-subagent')).toBeNull();
  });

  // Issue #26. With the REAL store: the card the user unfolded stays unfolded when the same block
  // is upserted again (running to completed), because the store reconciles in place and `<For>`
  // keeps the component. FABRICATED events; a Reject keeps its line under the card, and a pending
  // permission of the tool turns its status into "waiting for approval".
  it('keeps a tool card unfolded across part.upserted, and shows the pending request', () => {
    const h = start();
    const running: Part = {
      type: 'tool',
      id: 'call_9',
      name: 'edit',
      state: { status: 'running', input: { path: 'a.ts', oldString: 'a', newString: 'b' } },
    };
    h.apply(
      ...openWith([{ id: SES }], [user('m1', 'edit it'), assistant('m2')], { m2: [running] }),
    );
    h.apply({
      type: 'permission.asked',
      permission: {
        id: 'per_9',
        sessionID: SES,
        action: 'edit',
        resources: ['a.ts'],
        save: [],
        tool: { messageID: 'm2', partID: 'call_9' },
      },
    });
    expect(must(h.container, '.tool-status').textContent).toBe('waiting for approval');
    must<HTMLButtonElement>(h.container, '.tool-toggle').click();
    expect(h.container.querySelectorAll('.diff-line')).toHaveLength(2);
    h.apply({
      type: 'part.upserted',
      sessionID: SES,
      messageID: 'm2',
      part: {
        type: 'tool',
        id: 'call_9',
        name: 'edit',
        state: {
          status: 'completed',
          input: { path: 'a.ts', oldString: 'a', newString: 'b' },
          output: [],
          metadata: { files: [{ file: 'a.ts', patch: '@@ -1 +1 @@\n-a\n+b\n' }] },
        },
      },
    });
    expect(must(h.container, '.tool-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(h.container.querySelectorAll('.tool-card')).toHaveLength(1);
    expect(h.container.querySelectorAll('[role="log"] > *')).toHaveLength(2);
    const lines = [...h.container.querySelectorAll('.diff-line')].map((line) => line.textContent);
    expect(lines).toEqual(['@@ -1 +1 @@', '-a', '+b']);
  });

  it('does not unfold when the child session is opened', () => {
    const h = start();
    h.apply(...withTool(subagentTool({ sessionID: 'ses_kid', status: 'completed' })));
    h.button('Open subagent session Say hello').click();
    expect(must(h.container, '.tool-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(h.container.querySelector('.tool-body')).toBeNull();
  });
});

describe('related sessions in the header (issue #21)', () => {
  it('shows the crumb "‹ parent" on a subagent child and goes back to the parent', () => {
    const h = start();
    h.apply(
      ...openWith(
        [
          { id: SES, title: 'Say hello', parentID: 'ses_parent', agent: 'general' },
          { id: 'ses_parent', title: 'Fix the build' },
        ],
        [user('m1', 'hi')],
      ),
    );
    const nav = must(h.container, 'nav[aria-label="Session path"]');
    expect(nav.textContent).toBe('‹ Fix the build');
    h.button('Back to parent session Fix the build').click();
    expect(splitRequestId(h.sent[0]).rest).toEqual({
      type: 'session.open',
      sessionID: 'ses_parent',
    });
  });

  it('names the original of a fork and opens it', () => {
    const h = start();
    h.apply(
      ...openWith(
        [
          { id: SES, title: 'Fix the build (fork #1)', forkOf: 'ses_orig' },
          { id: 'ses_orig', title: 'Fix the build' },
        ],
        [user('m1', 'hi')],
      ),
    );
    expect(must(h.container, 'nav[aria-label="Session path"]').textContent).toBe(
      'Forked from Fix the build',
    );
    // WCAG 2.5.3: the accessible name contains the visible text "Forked from Fix the build".
    h.button('Forked from Fix the build: open the original session').click();
    expect(splitRequestId(h.sent[0]).rest).toEqual({
      type: 'session.open',
      sessionID: 'ses_orig',
    });
  });

  it('shows plain text, with nothing to open, when the original is not known', () => {
    const h = start();
    h.apply(...openWith([{ id: SES, forkOf: 'ses_gone' }], [user('m1', 'hi')]));
    const nav = must(h.container, 'nav[aria-label="Session path"]');
    expect(nav.textContent).toBe('Forked session');
    expect(nav.querySelector('button')).toBeNull();
  });

  it('has no path on a plain session', () => {
    const h = start();
    h.apply(...openWith([{ id: SES, title: 'Fix the build' }], [user('m1', 'hi')]));
    expect(h.container.querySelector('nav[aria-label="Session path"]')).toBeNull();
  });

  it('lists the children of the open session, oldest first, closed, with their state as text', () => {
    const h = start();
    h.apply(
      ...openWith(
        [
          { id: SES, title: 'Fix the build' },
          { id: 'ses_k2', title: 'Second', parentID: SES, agent: 'explore', createdAt: 20 },
          { id: 'ses_k1', parentID: SES, agent: 'general', createdAt: 10 },
          { id: 'ses_other', title: 'Not mine', parentID: 'ses_zzz', createdAt: 5 },
        ],
        [user('m1', 'hi')],
        {},
        {
          statuses: { ses_k2: { type: 'busy' } },
          requests: {
            permissions: [],
            forms: [{ id: 'frm_1', sessionID: 'ses_k1', title: 'Q', kind: 'question', fields: [] }],
          },
        },
      ),
    );
    const details = must<HTMLDetailsElement>(h.container, 'details.subagent-sessions');
    expect(details.open).toBe(false);
    expect(must(details, 'summary').textContent).toBe('Subagent sessions (2)');
    const items = [...details.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['Untitled sessiongeneral · Needs input', 'Secondexplore · Running']);
    // Regression (review W1): the aria-label replaces the content, so it must carry the state
    // words ("Running", "Needs input") and the agent, or a screen reader never hears them.
    h.button('Open subagent session Untitled session, general · Needs input');
    h.button('Open subagent session Second, explore · Running').click();
    expect(splitRequestId(h.sent[0]).rest).toEqual({ type: 'session.open', sessionID: 'ses_k2' });
  });

  it('shows no "Subagent sessions" when the open session has no children', () => {
    const h = start();
    h.apply(...openWith([{ id: SES, title: 'Fix the build' }], [user('m1', 'hi')]));
    expect(h.container.querySelector('.subagent-sessions')).toBeNull();
  });
});

// Issue #25: where the context line sits (Sergio's choice: under the title, in the header area) and
// that it appears only once a step has reported usage. FABRICATED snapshot; the line itself is
// tested in `UsageIndicator.test.tsx`.
describe('context and cost line (issue #25)', () => {
  it('sits in the header area after the title bar, and only once there is usage', () => {
    const h = start();
    h.apply(...openWith([{ id: SES, title: 'Fix the build' }], [user('m1', 'hi')]));
    expect(h.container.querySelector('.usage-line')).toBeNull();
    h.apply({
      type: 'message.upserted',
      sessionID: SES,
      message: assistant('m2', {
        tokens: { input: 4912, output: 2, reasoning: 0, cacheRead: 4096, cacheWrite: 0 },
      }),
    });
    const line = must(h.container, '.header-area > .usage-line');
    expect(line.querySelector('[aria-hidden="true"]')?.textContent).toBe('Context 9K');
    expect(line.querySelector('.visually-hidden')?.textContent).toBe('Context: 9,010 tokens.');
    expect(line.previousElementSibling?.classList.contains('chat-header')).toBe(true);
  });
});

// E5 / issues #23 and #24: the agent switch and the model picker in the prompt row, and what
// `prompt.send` carries. FABRICATED catalog and snapshots (the shapes are the ones the planner spike
// saw in a real opencode 2.0.32, but these tests prove the wiring and the precedence, not the
// server). The choice is a DRAFT: nothing is sent to the host when the user picks.
describe('model and agent selectors (issues #23/#24)', () => {
  const PICKLE = { providerID: 'opencode', id: 'big-pickle' };
  const GLM = { providerID: 'opencode', id: 'glm-5.3-flash-free' };
  const option = (id: string, name: string) => ({
    providerID: 'opencode',
    id,
    name,
    status: 'active' as const,
    contextLimit: 200000,
    free: true,
    variants: [],
    images: true,
  });
  const catalog: HostToWebview = {
    type: 'catalog',
    catalog: {
      models: [
        option('big-pickle', 'Big Pickle'),
        option('glm-5.3-flash-free', 'GLM-5.3-Flash Free'),
      ],
      providers: [{ id: 'opencode', name: 'OpenCode' }],
      agents: [
        { id: 'build', name: 'Build' },
        { id: 'plan', name: 'Plan' },
      ],
      serverDefault: PICKLE,
      defaultAgent: 'build',
    },
  };
  /** A snapshot opening `SES`, whose row may carry a model and an agent. */
  const withRow = (
    row: { model?: typeof GLM; agent?: string } = {},
    sessionID = SES,
  ): HostToWebview[] => [
    connected,
    {
      type: 'snapshot',
      snapshot: {
        sessions: [{ id: sessionID, title: 'Work', createdAt: 1, updatedAt: 2, ...row }],
        statuses: { [sessionID]: { type: 'idle' } },
        open: { sessionID, messages: [user('m1', 'hi')], parts: {} },
        requests: { permissions: [], forms: [] },
        resolutions: [],
      },
    },
  ];
  const trigger = (h: Harness) => must<HTMLButtonElement>(h.container, 'button.agent-model-chip');
  /** The agent the chip names (the text before the first " · "). */
  const agentOf = (h: Harness) => trigger(h).textContent.split(' · ')[0];
  /**
   * Opens the chip's panel unless it is open already: a choice leaves it open (decision of
   * 01/11/2026), so a second click on the chip would CLOSE it.
   */
  const openPanel = (h: Harness) => {
    if (trigger(h).getAttribute('aria-expanded') !== 'true') trigger(h).click();
  };
  /** Opens the chip's panel and presses the agent row of `id`. */
  const pickAgent = (h: Harness, id: string) => {
    openPanel(h);
    must<HTMLButtonElement>(h.container, `button[data-agent="${id}"]`).click();
  };
  const lastSent = (h: Harness) => {
    const message = h.sent.at(-1);
    if (message?.type !== 'prompt.send') throw new Error('the last message is not a prompt.send');
    return message;
  };

  it('sends no model or agent, and the selectors are inert, until the host sends a catalog', () => {
    const h = start();
    h.apply(...withRow());
    expect(trigger(h).getAttribute('aria-disabled')).toBe('true');
    trigger(h).click();
    expect(h.container.querySelector('.model-panel')).toBeNull();
    // The Send button is still named, whatever the connection (icon button, E2 P9=1+b).
    expect(h.button('Send').getAttribute('aria-label')).toBe('Send');
    h.type('hi');
    h.button('Send').click();
    const sent = lastSent(h);
    expect(sent.model).toBeUndefined();
    expect(sent.agent).toBeUndefined();
  });

  it('with no session shows Build and the default model, and a send carries the agent but not the default model', () => {
    const h = start();
    h.apply(connected, catalog);
    expect(trigger(h).getAttribute('aria-label')).toBe(
      'Agent and model: Build · Big Pickle (Connected)',
    );
    expect(trigger(h).textContent).toBe('Build · Big Pickle');
    expect(agentOf(h)).toBe('Build');
    h.type('hi');
    h.button('Send').click();
    const sent = lastSent(h);
    expect(sent.agent).toBe('build');
    expect(sent.model).toBeUndefined();
    expect(sent.sessionID).toBeUndefined();
  });

  it("proposes the host's preferred model for a NEW session and sends it", () => {
    const h = start();
    h.apply(connected, {
      ...catalog,
      catalog: { ...catalog.catalog, preferredModel: GLM },
    });
    expect(trigger(h).textContent).toBe('Build · GLM-5.3-Flash Free');
    h.type('hi');
    h.button('Send').click();
    expect(lastSent(h).model).toEqual(GLM);
  });

  // Regression found by `test:visual` step 11 in a real VS Code (21/10/2026): the model came out of
  // the Solid store as a Proxy, `postMessage` could not clone it (DataCloneError) and the prompt never
  // left. jsdom's `postMessage` does not clone, so the test clones the sent message itself.
  it('sends a model and an agent that survive structuredClone (no store proxies inside)', () => {
    const h = start();
    h.apply(...withRow({ model: GLM, agent: 'plan' }), catalog);
    pickAgent(h, 'build');
    openPanel(h);
    [...h.container.querySelectorAll<HTMLButtonElement>('button[data-model]')][0]?.click();
    h.type('go');
    h.button('Send').click();
    expect(() => structuredClone(lastSent(h))).not.toThrow();
    expect(lastSent(h)).toMatchObject({ model: PICKLE, agent: 'build' });
  });

  // Same DataCloneError, other source (review #1015 S1, found by reading the store): the picked
  // files are store elements, so `takeDraftFiles` and the `knownFiles` that Retry reads must hand out
  // plain copies. Checked by mutation: with the old `[...state.draftFiles]` both cases throw.
  // FABRICATED host messages; the real-VS-Code evidence is the attach step of `test:visual`.
  it('sends an attachment that survives structuredClone', () => {
    const h = start();
    h.apply(...withRow({ model: PICKLE, agent: 'build' }), catalog);
    h.apply({
      type: 'attachments.picked',
      requestId: 'pick',
      files: [{ uri: 'file:///a.ts', name: 'a.ts' }],
    });
    h.type('look at it');
    h.button('Send').click();
    expect(() => structuredClone(lastSent(h))).not.toThrow();
    expect(lastSent(h).files).toEqual([{ uri: 'file:///a.ts', name: 'a.ts' }]);
  });

  it('a Retry that re-attaches a file survives structuredClone', () => {
    const h = start();
    h.apply(...withRow({ model: PICKLE, agent: 'build' }), catalog);
    h.apply({
      type: 'attachments.picked',
      requestId: 'pick',
      files: [{ uri: 'file:///a.ts', name: 'a.ts' }],
    });
    h.type('look at it');
    h.button('Send').click();
    const first = h.sent.at(-1);
    h.apply({
      type: 'request.result',
      requestId: first && 'requestId' in first ? first.requestId : '',
    });
    h.apply({
      type: 'snapshot',
      snapshot: {
        sessions: [{ id: SES, createdAt: 1, updatedAt: 2, model: PICKLE, agent: 'build' }],
        statuses: { [SES]: { type: 'error', error: { code: 'provider.no-route', message: 'x' } } },
        open: {
          sessionID: SES,
          messages: [
            userWithFiles('m1', 'look at it', [
              { mime: 'text/plain', uri: 'file:///a.ts', name: 'a.ts' },
            ]),
          ],
          parts: {},
        },
        requests: { permissions: [], forms: [] },
        resolutions: [],
      },
    });
    h.button('Retry').click();
    expect(() => structuredClone(lastSent(h))).not.toThrow();
    expect(lastSent(h).files).toEqual([{ uri: 'file:///a.ts', name: 'a.ts' }]);
  });

  // Review #1015 W1 (decision of Sergio, 21/10/2026): the host pins whatever it receives, so an
  // EXPLICIT pick of the server's default must reach it; only an untouched default stays unsent.
  it('an explicit pick of the server default model IS sent (the host pins it)', () => {
    const h = start();
    h.apply(...withRow(), catalog);
    trigger(h).click();
    const pickle = [...h.container.querySelectorAll<HTMLButtonElement>('button.model-option')].find(
      (b) => b.textContent.startsWith('Big Pickle'),
    );
    pickle?.click();
    h.type('go');
    h.button('Send').click();
    expect(lastSent(h).model).toEqual(PICKLE);
  });

  it('picking an agent and a model sends nothing yet; the next prompt carries both', () => {
    const h = start();
    h.apply(...withRow({ model: PICKLE, agent: 'build' }), catalog);
    pickAgent(h, 'plan');
    openPanel(h);
    const glm = [...h.container.querySelectorAll<HTMLButtonElement>('button[data-model]')].find(
      (b) => b.textContent.startsWith('GLM-5.3-Flash Free'),
    );
    glm?.click();
    expect(h.sent).toEqual([]);
    expect(trigger(h).textContent).toBe('Plan · GLM-5.3-Flash Free');
    h.type('go');
    h.button('Send').click();
    expect(lastSent(h)).toMatchObject({ sessionID: SES, model: GLM, agent: 'plan' });
  });

  it('an open session shows and sends its own model and agent', () => {
    const h = start();
    h.apply(...withRow({ model: GLM, agent: 'plan' }), catalog);
    expect(trigger(h).textContent).toBe('Plan · GLM-5.3-Flash Free');
    h.type('go');
    h.button('Send').click();
    expect(lastSent(h)).toMatchObject({ model: GLM, agent: 'plan' });
  });

  it('Retry carries the choice too', () => {
    const h = start();
    h.apply(
      connected,
      {
        type: 'snapshot',
        snapshot: {
          sessions: [{ id: SES, createdAt: 1, updatedAt: 2, model: PICKLE, agent: 'build' }],
          statuses: {
            [SES]: { type: 'error', error: { code: 'provider.no-route', message: 'x' } },
          },
          open: { sessionID: SES, messages: [user('m1', 'hi')], parts: {} },
          requests: { permissions: [], forms: [] },
          resolutions: [],
        },
      },
      catalog,
    );
    pickAgent(h, 'plan');
    h.button('Retry').click();
    expect(lastSent(h)).toMatchObject({ text: 'hi', agent: 'plan', model: PICKLE });
  });

  it('forgets the draft when another session opens, but keeps it across a snapshot of the same one', () => {
    const h = start();
    h.apply(...withRow({ agent: 'build' }), catalog);
    pickAgent(h, 'plan');
    h.apply(...withRow({ agent: 'build' }));
    expect(agentOf(h)).toBe('Plan');
    h.apply(...withRow({ agent: 'build' }, 'ses_2'));
    expect(agentOf(h)).toBe('Build');
  });

  it('keeps the draft of a session that does not exist yet until the first prompt creates it', () => {
    const h = start();
    h.apply(connected, catalog);
    pickAgent(h, 'plan');
    expect(agentOf(h)).toBe('Plan');
    h.type('hi');
    h.button('Send').click();
    expect(lastSent(h).agent).toBe('plan');
    // The host created the session: the snapshot opens it, and from then on its row speaks.
    h.apply(...withRow({ agent: 'plan' }, 'ses_new'));
    expect(agentOf(h)).toBe('Plan');
  });

  it('persists the pick with the session it belongs to, and restores it only for that session', () => {
    const first = start();
    first.apply(...withRow({ agent: 'build' }), catalog);
    pickAgent(first, 'plan');
    expect(first.saved.at(-1)).toMatchObject({ selection: { sessionID: SES, agent: 'plan' } });

    const same = start({
      draft: '',
      history: [],
      files: [],
      selection: { sessionID: SES, agent: 'plan' },
    });
    same.apply(...withRow({ agent: 'build' }), catalog);
    expect(agentOf(same)).toBe('Plan');

    const other = start({
      draft: '',
      history: [],
      files: [],
      selection: { sessionID: SES, agent: 'plan' },
    });
    other.apply(...withRow({ agent: 'build' }, 'ses_2'), catalog);
    expect(agentOf(other)).toBe('Build');
  });

  // Protects the Reload Window restore (issue #77): the mount-time `persist` must not erase the
  // session restored from the previous document before the host's first snapshot arrives.
  // Provenance: fabricated persisted state and snapshots.
  it('persists the restored session before the first snapshot, then the one the host shows', () => {
    const h = start({ draft: '', history: [], files: [], sessionID: 'ses_old' });
    expect(h.saved.at(-1)).toMatchObject({ sessionID: 'ses_old' });
    h.apply(...openSession([user('m1', 'hi')]));
    expect(h.saved.at(-1)).toMatchObject({ sessionID: SES });
    h.apply({
      type: 'snapshot',
      snapshot: {
        sessions: [],
        statuses: {},
        requests: { permissions: [], forms: [] },
        resolutions: [],
      },
    });
    expect(h.saved.at(-1)).not.toHaveProperty('sessionID');
  });

  it('names the agent and model of each reply from the catalog', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]), catalog);
    expect(must(h.container, '.message-assistant .message-meta').textContent).toBe(
      'Build · Big Pickle',
    );
  });

  it('shows a session model the server no longer offers as unavailable', () => {
    const h = start();
    h.apply(...withRow({ model: { providerID: 'opencode', id: 'retired' } }), catalog);
    expect(trigger(h).textContent).toBe('Build · opencode/retired (unavailable)');
  });

  it('Enter in the search box of the panel does not send the prompt', () => {
    const h = start();
    h.apply(...withRow({ agent: 'build' }), catalog);
    h.type('keep me');
    trigger(h).click();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    must(h.container, 'input[type="search"]').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(h.sent).toEqual([]);
    expect(h.textarea().value).toBe('keep me');
  });

  it('keeps the combined chip in the prompt bar, not in the header, and no loose selectors', () => {
    const h = start();
    h.apply(...withRow(), catalog);
    expect(h.container.querySelector('header .agent-model-chip')).toBeNull();
    expect(
      h.container.querySelector('.prompt-actions .prompt-selectors .agent-model-chip'),
    ).not.toBeNull();
    expect(h.container.querySelector('.agent-toggle, .model-trigger, .variant-trigger')).toBeNull();
  });

  it('draws Send and Stop as round icon buttons named by aria-label (P9=1+b)', () => {
    const h = start();
    h.apply(...withRow(), catalog);
    const send = h.button('Send');
    expect(send.textContent).toBe('');
    expect(send.querySelector('svg')).not.toBeNull();
    expect(send.type).toBe('submit');
  });
});

// E5 / issue #61: the reasoning-variant control in the prompt row and what `prompt.send` carries.
// FABRICATED catalog and snapshots (variants low/high as the planner spike saw for
// glm-5.3-flash-free in a real opencode 2.0.32); they prove the wiring and the decisions of Sergio
// (22/10/2026, Engram #1021), not the server. A variant set from outside (the TUI) is modelled as
// a session row that carries it, which is the shape `toModelRef` gives it on the host.
describe('reasoning variant selector (issue #61)', () => {
  const PICKLE = { providerID: 'opencode', id: 'big-pickle' };
  const GLM = { providerID: 'opencode', id: 'glm-5.3-flash-free' };
  const option = (id: string, name: string, variants: string[]) => ({
    providerID: 'opencode',
    id,
    name,
    status: 'active' as const,
    contextLimit: 200000,
    free: true,
    variants,
    images: true,
  });
  const catalog: HostToWebview = {
    type: 'catalog',
    catalog: {
      models: [
        option('big-pickle', 'Big Pickle', []),
        option('glm-5.3-flash-free', 'GLM-5.3-Flash Free', ['low', 'high']),
      ],
      providers: [{ id: 'opencode', name: 'OpenCode' }],
      agents: [{ id: 'build', name: 'Build' }],
      serverDefault: PICKLE,
      defaultAgent: 'build',
    },
  };
  const withRow = (model?: { providerID: string; id: string; variant?: string }, id = SES) =>
    [
      connected,
      {
        type: 'snapshot',
        snapshot: {
          sessions: [
            // A COPY: the store keeps the object it is given and a later `session.upserted`
            // reconciles INTO it, so the shared `GLM` constant would gain the variant for every
            // later test (seen as "· high" in the name of an unrelated test, 27/10/2026).
            {
              id,
              title: 'Work',
              createdAt: 1,
              updatedAt: 2,
              ...(model ? { model: { ...model } } : {}),
            },
          ],
          statuses: { [id]: { type: 'idle' } },
          open: { sessionID: id, messages: [user('m1', 'hi')], parts: {} },
          requests: { permissions: [], forms: [] },
          resolutions: [],
        },
      },
    ] satisfies HostToWebview[];
  const chip = (h: Harness) => must<HTMLButtonElement>(h.container, 'button.agent-model-chip');
  /** What the chip shows for the reasoning level: "· low" at its end, nothing for Default. */
  const levelShown = (h: Harness) => chip(h).textContent.split(' · ').slice(2).join(' · ');
  const reasoningRows = (h: Harness) => h.container.querySelectorAll('.menu-reasoning button');
  const entry = (h: Harness, id: string) =>
    must<HTMLButtonElement>(h.container, `button.model-option[data-variant="${id}"]`);
  const lastSent = (h: Harness) => {
    const message = h.sent.at(-1);
    if (message?.type !== 'prompt.send') throw new Error('the last message is not a prompt.send');
    return message;
  };
  /** Opens the panel unless it is open already: a choice leaves it open (01/11/2026). */
  const openPanel = (h: Harness) => {
    if (chip(h).getAttribute('aria-expanded') !== 'true') chip(h).click();
  };
  const pickVariant = (h: Harness, id: string) => {
    openPanel(h);
    entry(h, id).click();
  };

  it('is not in the panel for a model without variants, and is there for one with', () => {
    const h = start();
    h.apply(...withRow(PICKLE), catalog);
    chip(h).click();
    expect(reasoningRows(h).length).toBe(0);
    chip(h).click(); // closes
    h.apply(...withRow(GLM));
    chip(h).click();
    expect([...reasoningRows(h)].map((b) => b.querySelector('.model-name')?.textContent)).toEqual([
      'Default',
      'low',
      'high',
    ]);
    expect(levelShown(h)).toBe('');
  });

  it('picking a variant sends nothing yet; the next prompt carries it, and it survives structuredClone', () => {
    const h = start();
    h.apply(...withRow(GLM), catalog);
    pickVariant(h, 'high');
    expect(h.sent).toEqual([]);
    expect(levelShown(h)).toBe('high');
    h.type('go');
    h.button('Send').click();
    expect(lastSent(h).model).toEqual({ ...GLM, variant: 'high' });
    expect(() => structuredClone(lastSent(h))).not.toThrow();
  });

  it('Default removes the variant: the model goes without the field, never "default"', () => {
    const h = start();
    h.apply(...withRow({ ...GLM, variant: 'low' }), catalog);
    expect(levelShown(h)).toBe('low');
    pickVariant(h, 'default');
    expect(levelShown(h)).toBe('');
    h.type('go');
    h.button('Send').click();
    const model = lastSent(h).model;
    expect(model).toEqual(GLM);
    expect('variant' in (model ?? {})).toBe(false);
  });

  it('a variant set from outside (the TUI) is shown and kept by the next send', () => {
    const h = start();
    h.apply(...withRow({ ...GLM, variant: 'low' }), catalog);
    expect(levelShown(h)).toBe('low');
    h.type('go');
    h.button('Send').click();
    expect(lastSent(h).model).toEqual({ ...GLM, variant: 'low' });
  });

  it('a variant that arrives live changes the chip while there is no draft', () => {
    const h = start();
    h.apply(...withRow(GLM), catalog);
    expect(levelShown(h)).toBe('');
    h.apply({
      type: 'session.upserted',
      session: {
        id: SES,
        title: 'Work',
        createdAt: 1,
        updatedAt: 3,
        model: { ...GLM, variant: 'high' },
      },
    });
    expect(levelShown(h)).toBe('high');
  });

  it('a variant the catalog does not list shows as unavailable', () => {
    const h = start();
    h.apply(...withRow({ ...GLM, variant: 'ultra' }), catalog);
    expect(levelShown(h)).toBe('ultra (unavailable)');
  });

  it('choosing another model resets to Default; choosing the same one again keeps the variant', () => {
    const h = start();
    h.apply(...withRow(GLM), catalog);
    pickVariant(h, 'high');
    const pickModel = (name: string) => {
      openPanel(h);
      [...h.container.querySelectorAll<HTMLButtonElement>('button[data-model]')]
        .find((b) => b.textContent.startsWith(name))
        ?.click();
    };
    pickModel('GLM-5.3-Flash Free');
    expect(levelShown(h)).toBe('high');
    pickModel('Big Pickle');
    expect(chip(h).textContent).toBe('Build · Big Pickle');
    pickModel('GLM-5.3-Flash Free');
    expect(levelShown(h)).toBe('');
  });

  it('Retry carries the variant and survives structuredClone', () => {
    const h = start();
    h.apply(
      connected,
      {
        type: 'snapshot',
        snapshot: {
          sessions: [
            {
              id: SES,
              createdAt: 1,
              updatedAt: 2,
              model: { ...GLM, variant: 'low' },
            },
          ],
          statuses: {
            [SES]: { type: 'error', error: { code: 'provider.no-route', message: 'x' } },
          },
          open: { sessionID: SES, messages: [user('m1', 'hi')], parts: {} },
          requests: { permissions: [], forms: [] },
          resolutions: [],
        },
      },
      catalog,
    );
    h.button('Retry').click();
    expect(lastSent(h).model).toEqual({ ...GLM, variant: 'low' });
    expect(() => structuredClone(lastSent(h))).not.toThrow();
  });

  it('the chip is aria-disabled while disconnected, says why in its name, and keeps its place in the bar', () => {
    const h = start();
    h.apply(...withRow(GLM), catalog, {
      type: 'connection.state',
      connection: { state: 'reconnecting', attempt: 1 },
    });
    expect(chip(h).getAttribute('aria-disabled')).toBe('true');
    expect(chip(h).getAttribute('aria-label')).toBe(
      'Agent and model: Build · GLM-5.3-Flash Free (Reconnecting)',
    );
    expect(h.container.querySelector('.prompt-actions .agent-model-chip')).not.toBeNull();
  });
});

// E7-file-context (issues #28/#29, decisions Q1-Q4 of Sergio). Protects: one `files.search` per
// pause in typing (and none in `pending`, or Send would lock on every key), only the answer to the
// newest search reaching the popup, a picked result becoming BOTH a chip and `@name` text with the
// offsets of that text sent as `mention` (and a chip and its text staying independent when one of
// them is deleted), the files and mentions being structured-cloneable (a store Proxy would throw
// DataCloneError in `postMessage`), Add selection asking the host and failing with a visible
// notice, and the chips of the conversation opening the file at the start of its range.
// Provenance: fabricated host messages, jsdom, fake timers; the real round trip is
// `chatController.e2e.test.ts` and `test:visual` step 16.
describe('@ mentions and the editor context (issues #28/#29)', () => {
  const SAMPLE = { uri: 'file:///ws/src/sample.ts', name: 'src/sample.ts' };

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The ids of the `files.search` requests sent so far, oldest first. */
  const searches = (h: Harness) =>
    h.sent.flatMap((message) => (message.type === 'files.search' ? [message] : []));

  /** Types `text` (caret at its end) and lets the debounce fire. */
  function typeAndWait(h: Harness, text: string): void {
    const field = h.textarea();
    field.value = text;
    field.setSelectionRange(text.length, text.length);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(FILE_SEARCH_DEBOUNCE_MS);
  }

  const press = (h: Harness, key: string): void => {
    h.textarea().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  };

  it('asks the host once after typing pauses, and does not lock Send', () => {
    vi.useFakeTimers();
    const h = start();
    h.apply(connected);
    for (const text of ['@s', '@sa', '@sam']) h.type(text);
    expect(searches(h)).toEqual([]);
    vi.advanceTimersByTime(FILE_SEARCH_DEBOUNCE_MS);
    expect(searches(h)).toMatchObject([{ type: 'files.search', query: 'sam' }]);
    expect(h.store.state.pending).toEqual([]);
    expect(h.button('Send').disabled).toBe(false);
  });

  it('does not search for a bare @, and forgets the results when the popup closes', () => {
    vi.useFakeTimers();
    const h = start();
    h.apply(connected);
    typeAndWait(h, '@');
    expect(searches(h)).toEqual([]);
    typeAndWait(h, '@sa');
    const request = searches(h)[0];
    h.textarea().focus(); // jsdom fires `blur` only for an element that has the focus
    h.textarea().blur();
    h.apply({
      type: 'files.found',
      requestId: request?.requestId ?? '',
      query: 'sa',
      files: [SAMPLE],
    });
    expect(h.store.state.fileSearch.files).toEqual([]);
  });

  it('shows only the answer to the newest search', () => {
    vi.useFakeTimers();
    const h = start();
    h.apply(connected);
    typeAndWait(h, '@sa');
    typeAndWait(h, '@sam');
    const [first, second] = searches(h);
    h.apply({
      type: 'files.found',
      requestId: first?.requestId ?? '',
      query: 'sa',
      files: [SAMPLE],
    });
    expect(h.container.querySelectorAll('[role="option"]')).toHaveLength(0);
    h.apply({
      type: 'files.found',
      requestId: second?.requestId ?? '',
      query: 'sam',
      files: [{ uri: 'file:///ws/src/shared/model.ts', name: 'src/shared/model.ts' }],
    });
    expect([...h.container.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual([
      'model.tssrc/shared',
    ]);
  });

  /** Types `look @sa`, answers the search with SAMPLE and picks it with Enter. */
  function pickSample(h: Harness): void {
    typeAndWait(h, 'look @sa');
    const request = searches(h)[0];
    h.apply({
      type: 'files.found',
      requestId: request?.requestId ?? '',
      query: 'sa',
      files: [SAMPLE],
    });
    press(h, 'Enter');
  }

  it('turns a picked result into a chip and @name text, and sends the offsets of that text', () => {
    vi.useFakeTimers();
    const h = start();
    h.apply(connected);
    pickSample(h);
    expect(h.textarea().value).toBe('look @src/sample.ts ');
    expect(
      [...h.container.querySelectorAll('.chips .chip-open')].map((c) => c.textContent),
    ).toEqual(['src/sample.ts']);
    expect(h.store.state.fileSearch.requestId).toBeUndefined();
    expect(h.sent).toHaveLength(1); // only the search: Enter picked, it did not send

    h.button('Send').click();
    const prompt = h.sent[1];
    expect(prompt).toMatchObject({
      type: 'prompt.send',
      // The trailing space was trimmed before the offsets were computed.
      text: 'look @src/sample.ts',
      files: [{ ...SAMPLE, mention: { start: 5, end: 19, text: '@src/sample.ts' } }],
    });
    expect(() => structuredClone(prompt)).not.toThrow();
    // Sending forgets the search.
    expect(h.store.state.fileSearch.requestId).toBeUndefined();
  });

  // Q1: chip and text are independent. Deleting the text keeps the file; deleting the chip keeps
  // the text, which the model then reads as a plain @path.
  it('sends the file without a mention when its @name text was deleted', () => {
    vi.useFakeTimers();
    const h = start();
    h.apply(connected);
    pickSample(h);
    h.type('look');
    h.button('Send').click();
    const prompt = h.sent[1];
    expect(prompt).toMatchObject({ text: 'look', files: [SAMPLE] });
    expect(prompt && 'files' in prompt ? prompt.files[0] : undefined).toEqual(SAMPLE);
  });

  it('keeps the @name text as plain text when the chip is removed', () => {
    vi.useFakeTimers();
    const h = start();
    h.apply(connected);
    pickSample(h);
    h.button('Remove src/sample.ts').click();
    expect(h.container.querySelector('.chip')).toBeNull();
    expect(h.textarea().value).toBe('look @src/sample.ts ');
    h.button('Send').click();
    expect(h.sent[1]).toMatchObject({ text: 'look @src/sample.ts', files: [] });
  });

  it('puts a picked file back as a chip, with the text, when the send fails', () => {
    vi.useFakeTimers();
    const h = start();
    h.apply(connected);
    pickSample(h);
    h.button('Send').click();
    const sent = h.sent[1];
    h.apply({
      type: 'request.result',
      requestId: sent && 'requestId' in sent ? sent.requestId : '',
      error: { code: 'ServerUnavailable', message: 'down' },
    });
    expect(h.textarea().value).toBe('look @src/sample.ts');
    expect(h.container.querySelectorAll('.chips .chip-open')).toHaveLength(1);
  });

  it('asks the host for the editor context and shows what comes back as chips', () => {
    const h = start();
    h.apply(connected);
    h.button('Add context').click();
    h.button('Add selection').click();
    const request = h.sent[0];
    expect(request).toMatchObject({ type: 'attachments.fromEditor' });
    const requestId = request && 'requestId' in request ? request.requestId : '';
    expect(h.store.state.pending).toEqual([requestId]);
    h.apply(
      {
        type: 'attachments.picked',
        requestId,
        files: [{ uri: 'file:///ws/src/a.ts?start=2&end=3', name: 'src/a.ts#2-3' }],
      },
      { type: 'request.result', requestId },
    );
    expect(must(h.container, '.chips .chip-open').textContent).toBe('src/a.ts#2-3');
    expect(h.store.state.pending).toEqual([]);
  });

  it('shows why Add selection found nothing to add', () => {
    const h = start();
    h.apply(connected);
    h.button('Add context').click();
    h.button('Add selection').click();
    const request = h.sent[0];
    h.apply({
      type: 'request.result',
      requestId: request && 'requestId' in request ? request.requestId : '',
      error: { code: 'NoFileOnDisk', message: 'Save the file first' },
    });
    expect(must(h.container, '[role="alert"]').textContent).toContain('Save the file first');
    expect(h.container.querySelector('.chip')).toBeNull();
  });

  it('keeps the "+" menu inert, and aria-disabled, without a connection', () => {
    const h = start();
    const plus = h.button('Add context');
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    expect(plus.hasAttribute('disabled')).toBe(false);
    plus.click();
    expect(h.container.querySelector('[role="menu"]')).toBeNull();
    expect(h.sent).toEqual([]);
    h.apply(connected);
    expect(plus.getAttribute('aria-disabled')).toBeNull();
  });

  it('asks for an image picker with kind "image" from the "+" menu (decision P11=1)', () => {
    const h = start();
    h.apply(connected);
    h.button('Add context').click();
    h.button('Attach image…').click();
    expect(h.sent).toMatchObject([{ type: 'attachments.pick', kind: 'image' }]);
  });

  it('opens a file of the conversation at the start of its range from its chip', () => {
    const h = start();
    h.apply(
      ...openSession([
        userWithFiles('m1', 'read this', [
          { mime: 'text/plain', uri: 'file:///ws/src/a.ts?start=2&end=3', name: 'src/a.ts#2-3' },
          { mime: 'text/plain', name: 'no-uri.txt' },
        ]),
      ]),
    );
    const chips = h.container.querySelectorAll('[role="log"] .message-files .chip');
    expect(chips).toHaveLength(2);
    // Only a chip with a `file:` URL is a button; the other stays plain text.
    expect(h.container.querySelectorAll('[role="log"] .chip-open')).toHaveLength(1);
    h.button('Open src/a.ts, lines 2-3').click();
    expect(h.sent).toEqual([{ type: 'editor.open', path: 'file:///ws/src/a.ts', line: 2 }]);
  });

  it('forgets the search when the open session changes', () => {
    vi.useFakeTimers();
    const h = start();
    h.apply(connected);
    typeAndWait(h, '@sa');
    const request = searches(h)[0];
    h.apply({
      type: 'snapshot',
      snapshot: {
        sessions: [{ id: 'ses_2', createdAt: 1, updatedAt: 2 }],
        statuses: {},
        open: { sessionID: 'ses_2', messages: [], parts: {} },
        requests: { permissions: [], forms: [] },
        resolutions: [],
      },
    });
    h.apply({
      type: 'files.found',
      requestId: request?.requestId ?? '',
      query: 'sa',
      files: [SAMPLE],
    });
    expect(h.store.state.fileSearch.files).toEqual([]);
  });
});

// Issue #31 (E7-session-diff): the "Changed files" `<details>` under the header, Sergio's choice of
// 23/10/2026 (Engram #1153). FABRICATED host messages in jsdom: they confirm where it sits, that it
// is closed by default and drawn only with files, and the message a click sends (no `requestId`,
// the OPEN session's id and the exact listed path). The real keyboard path and the look are
// `test:visual` checks "the list is closed by default" and "Enter on the deleted row opens a diff
// editor".
describe('changed files (issue #31)', () => {
  const changed = (path: string, extra: Partial<ChangedFile> = {}): ChangedFile => ({
    path,
    status: 'modified',
    additions: 3,
    deletions: 1,
    binary: false,
    tooLarge: false,
    ...extra,
  });

  it('draws nothing while the open session has no changed files', () => {
    const h = start();
    h.apply(...openWith([{ id: SES, title: 'Fix the build' }], [user('m1', 'hi')]));
    expect(h.container.querySelector('.changed-files')).toBeNull();
    h.apply({ type: 'session.diff', sessionID: SES, files: [] });
    expect(h.container.querySelector('.changed-files')).toBeNull();
  });

  it('shows a closed "Changed files (N)" under the header with one button per file', () => {
    const h = start();
    h.apply(...openWith([{ id: SES, title: 'Fix the build' }], [user('m1', 'hi')]));
    h.apply({
      type: 'session.diff',
      sessionID: SES,
      files: [changed('src/a.ts'), changed('assets/logo.png', { binary: true })],
    });
    const details = must<HTMLDetailsElement>(h.container, 'details.changed-files');
    expect(details.open).toBe(false);
    expect(must(details, 'summary').textContent).toBe('Changed files (2)');
    expect(details.parentElement?.classList.contains('header-area')).toBe(true);
    expect(
      [...details.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'Open diff of src/a.ts, Modified, 3 added, 1 deleted',
      'Open assets/logo.png, Binary',
    ]);
  });

  it('sits after the "Subagent sessions" list', () => {
    const h = start();
    h.apply(
      ...openWith(
        [
          { id: SES, title: 'Fix the build' },
          { id: 'ses_k1', parentID: SES, agent: 'general' },
        ],
        [user('m1', 'hi')],
      ),
    );
    h.apply({ type: 'session.diff', sessionID: SES, files: [changed('src/a.ts')] });
    const area = must(h.container, '.header-area');
    const classes = [...area.children].map((child) => child.className);
    expect(classes.indexOf('subagent-sessions')).toBeGreaterThan(-1);
    expect(classes.indexOf('changed-files')).toBe(classes.indexOf('subagent-sessions') + 1);
  });

  it('sends session.diff.open for the open session and the exact path of the pressed row', () => {
    const h = start();
    h.apply(...openWith([{ id: SES, title: 'Fix the build' }], [user('m1', 'hi')]));
    h.apply({
      type: 'session.diff',
      sessionID: SES,
      files: [changed('src/a.ts'), changed('src/b.ts')],
    });
    h.button('Open diff of src/b.ts, Modified, 3 added, 1 deleted').click();
    expect(h.sent).toEqual([{ type: 'session.diff.open', sessionID: SES, path: 'src/b.ts' }]);
  });

  it('never shows the list of another session', () => {
    const h = start();
    h.apply(...openWith([{ id: SES, title: 'Fix the build' }], [user('m1', 'hi')]));
    h.apply({ type: 'session.diff', sessionID: 'ses_other', files: [changed('src/a.ts')] });
    expect(h.container.querySelector('.changed-files')).toBeNull();
  });

  it('says the list could not be refreshed, keeping the last rows', () => {
    const h = start();
    h.apply(...openWith([{ id: SES, title: 'Fix the build' }], [user('m1', 'hi')]));
    h.apply({
      type: 'session.diff',
      sessionID: SES,
      files: [changed('src/a.ts')],
      error: { code: 'Boom', message: 'it broke' },
    });
    expect(must(h.container, '.changed-files-error').textContent).toBe(
      'Could not refresh the list: it broke',
    );
    expect(h.container.querySelectorAll('.changed-files button')).toHaveLength(1);
  });
});

// Issue #32 (E7-message-revert): "Revert from here", the hidden messages and the block under the
// conversation. FABRICATED host messages in jsdom: they prove the wiring, the names and the
// aria-disabled rules, not the host contract (`chatController*.test.ts`), the contrast or the real
// modal (`test:visual` step 19 covers those in a real VS Code).
describe('revert from a message (issue #32)', () => {
  const exchanges = [
    user('m1', 'first question'),
    assistant('m2'),
    user('m3', 'second   question\nwith a break'),
    assistant('m4'),
  ];
  const aFile: ChangedFile = {
    path: 'src/a.ts',
    status: 'modified',
    additions: 3,
    deletions: 1,
    binary: false,
    tooLarge: false,
  };
  const revertAt = (messageID: string, files: ChangedFile[] = [aFile]): HostToWebview => ({
    type: 'session.revert',
    sessionID: SES,
    revert: { messageID, files },
  });
  const log = (h: Harness): HTMLElement => must(h.container, '[role="log"]');
  const names = (h: Harness): (string | null)[] =>
    [...log(h).querySelectorAll('.message-user .part-text')].map((e) => e.textContent);

  it('offers "Revert from here" on user messages only, named after the message', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    const buttons = [...h.container.querySelectorAll('.message-action[aria-label^="Revert"]')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Revert from here: first question',
      'Revert from here: second question with a break',
    ]);
    expect(buttons.map((b) => b.textContent)).toEqual(['Revert from here', 'Revert from here']);
  });

  it('sends session.revert.stage with the id of the message that was clicked', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    h.button('Revert from here: second question with a break').click();
    expect(h.sent).toHaveLength(1);
    const { requestId, rest } = splitRequestId(h.sent[0]);
    expect(requestId).toMatch(/\S/);
    expect(rest).toEqual({ type: 'session.revert.stage', sessionID: SES, messageID: 'm3' });
  });

  it('locks the buttons with aria-disabled (focus stays) while the request is in flight', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    const button = h.button('Revert from here: first question');
    button.focus();
    button.click();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(button);
    button.click();
    h.button('Revert from here: second question with a break').click();
    expect(h.sent).toHaveLength(1);
    h.apply({ type: 'request.result', requestId: splitRequestId(h.sent[0]).requestId });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
  });

  it('locks the buttons, and ignores the click, while the session is busy or disconnected', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    h.apply({ type: 'session.status', sessionID: SES, status: { type: 'busy' } });
    const button = h.button('Revert from here: first question');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.click();
    expect(h.sent).toEqual([]);
    h.apply({ type: 'session.status', sessionID: SES, status: { type: 'idle' } });
    h.apply({
      type: 'connection.state',
      connection: { state: 'reconnecting', attempt: 1, error: { code: 'x', message: 'lost' } },
    });
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('refills the prompt with the message text only when the draft is empty', () => {
    const empty = start();
    empty.apply(...openWith([{ id: SES }], exchanges));
    empty.button('Revert from here: second question with a break').click();
    expect(empty.textarea().value).toBe('');
    empty.apply({ type: 'request.result', requestId: splitRequestId(empty.sent[0]).requestId });
    expect(empty.textarea().value).toBe('second   question\nwith a break');
    expect(document.activeElement).toBe(empty.textarea());

    const typed = start();
    typed.apply(...openWith([{ id: SES }], exchanges));
    typed.type('my own draft');
    typed.button('Revert from here: first question').click();
    typed.apply({ type: 'request.result', requestId: splitRequestId(typed.sent[0]).requestId });
    expect(typed.textarea().value).toBe('my own draft');
  });

  it('does not refill the prompt when the revert fails, and shows why', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    h.button('Revert from here: first question').click();
    h.apply({
      type: 'request.result',
      requestId: splitRequestId(h.sent[0]).requestId,
      error: { code: 'SessionBusyError', message: 'The session is busy' },
    });
    expect(h.textarea().value).toBe('');
    expect(must(h.container, '[role="alert"]').textContent).toContain('The session is busy');
  });

  it('hides the messages from the boundary on and draws the block OUTSIDE the log', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    expect(h.container.querySelector('.revert-banner')).toBeNull();
    h.apply(revertAt('m3'));
    expect(names(h)).toEqual(['first question']);
    expect(log(h).querySelectorAll('.message')).toHaveLength(2);
    const banner = must(h.container, '.revert-banner');
    expect(log(h).contains(banner)).toBe(false);
    expect(must(banner, '.revert-banner-title').textContent).toBe('1 message reverted');
    expect(banner.querySelectorAll('.changed-file')).toHaveLength(1);
    expect(banner.textContent).toContain('1 file changed on disk');
  });

  it('brings the messages back when the revert goes away, without a new snapshot', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    h.apply(revertAt('m1'));
    expect(names(h)).toEqual([]);
    expect(must(h.container, '.revert-banner-title').textContent).toBe('2 messages reverted');
    h.apply({ type: 'session.revert', sessionID: SES });
    expect(names(h)).toEqual(['first question', 'second   question\nwith a break']);
    expect(h.container.querySelector('.revert-banner')).toBeNull();
  });

  it('hides from the very first snapshot when the host carries the revert inside it', () => {
    const h = start();
    h.apply(
      ...openWith(
        [{ id: SES }],
        exchanges,
        {},
        {
          open: {
            sessionID: SES,
            messages: exchanges,
            parts: {},
            revert: { messageID: 'm3', files: [] },
          },
        },
      ),
    );
    expect(names(h)).toEqual(['first question']);
    expect(h.container.querySelector('.revert-banner-caption')).toBeNull();
  });

  it('says only "Reverted messages" when the boundary is not among the loaded messages', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    h.apply(revertAt('msg_old'));
    expect(names(h)).toHaveLength(2);
    expect(must(h.container, '.revert-banner-title').textContent).toBe('Reverted messages');
  });

  it('ignores the revert of another session', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    h.apply({
      type: 'session.revert',
      sessionID: 'ses_other',
      revert: { messageID: 'm1', files: [] },
    });
    expect(h.container.querySelector('.revert-banner')).toBeNull();
    expect(names(h)).toHaveLength(2);
  });

  it('Restore and Discard for good send the requests for the open session', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    h.apply(revertAt('m3'));
    h.button('Restore').click();
    expect(splitRequestId(h.sent[0]).rest).toEqual({
      type: 'session.revert.clear',
      sessionID: SES,
    });
    // The first request is still in flight: the other button waits.
    h.button('Discard for good').click();
    expect(h.sent).toHaveLength(1);
    h.apply({ type: 'request.result', requestId: splitRequestId(h.sent[0]).requestId });
    h.button('Discard for good').click();
    expect(splitRequestId(h.sent[1]).rest).toEqual({
      type: 'session.revert.commit',
      sessionID: SES,
    });
  });

  // Defends against the focus falling to <body> when the banner (which held it) unmounts after a
  // Restore or Discard for good (review of E7-message-revert, W1). Fabricated host messages in
  // jsdom: the real-VS-Code part is the `test:visual` step of the revert.
  it('focuses the prompt after Restore finishes, but not when it ended with a notice', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    h.apply(revertAt('m3'));
    h.button('Restore').click();
    h.button('Restore').focus();
    h.apply({ type: 'session.revert', sessionID: SES });
    h.apply({ type: 'request.result', requestId: splitRequestId(h.sent[0]).requestId });
    expect(document.activeElement).toBe(h.textarea());

    h.apply(revertAt('m3'));
    h.button('Discard for good').click();
    h.button('Discard for good').focus();
    h.apply({
      type: 'request.result',
      requestId: splitRequestId(h.sent[1]).requestId,
      error: { code: 'SessionBusyError', message: 'The session is busy.' },
    });
    expect(document.activeElement).not.toBe(h.textarea());
  });

  it('locks the two buttons of the block while the session is busy', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    h.apply(revertAt('m3'));
    h.apply({ type: 'session.status', sessionID: SES, status: { type: 'busy' } });
    for (const name of ['Restore', 'Discard for good']) {
      const button = h.button(name);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      button.click();
    }
    expect(h.sent).toEqual([]);
  });

  it('sends session.revert.open with the exact path of the pressed row', () => {
    const h = start();
    h.apply(...openWith([{ id: SES }], exchanges));
    h.apply(revertAt('m3', [aFile, { ...aFile, path: 'src/b.ts' }]));
    h.button('Show what the revert undid in src/b.ts, Modified, 3 added, 1 deleted').click();
    expect(h.sent).toEqual([{ type: 'session.revert.open', sessionID: SES, path: 'src/b.ts' }]);
  });

  it('measures the context without the hidden messages', () => {
    const h = start();
    h.apply(
      ...openWith(
        [{ id: SES }],
        [
          user('m1', 'first'),
          assistant('m2', {
            tokens: { input: 1000, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          }),
          user('m3', 'second'),
          assistant('m4', {
            tokens: { input: 9000, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          }),
        ],
      ),
    );
    expect(must(h.container, '.usage-line [aria-hidden="true"]').textContent).toBe('Context 9K');
    h.apply(revertAt('m3'));
    expect(must(h.container, '.usage-line [aria-hidden="true"]').textContent).toBe('Context 1K');
  });

  it('Retry resends the last VISIBLE user message, not a hidden one', () => {
    const h = start();
    h.apply(
      ...openWith(
        [{ id: SES }],
        [
          user('m1', 'first question'),
          assistant('m2', { error: { code: 'X', message: 'broke' } }),
          user('m3', 'hidden one'),
        ],
      ),
    );
    h.apply(revertAt('m3'));
    h.button('Retry').click();
    expect(h.sent.at(-1)).toMatchObject({ type: 'prompt.send', text: 'first question' });
  });
});

// Issue #30. Fabricated drops and pastes (plain `Event`s: jsdom has no `DragEvent`), a fake
// `URL.createObjectURL` and the fabricated host answers of a store: they pin the wiring and the
// two local warnings, not what VS Code delivers (the stable 1.143 delivers no drop, #339036).
describe('drop and paste (issue #30)', () => {
  const ICON = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const fire = (target: Element, type: string, extra: Record<string, unknown>): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries(extra)) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  };
  const model = (id: string, images: boolean) => ({
    providerID: 'opencode',
    id,
    name: id,
    status: 'active' as const,
    contextLimit: 1,
    free: true,
    variants: [],
    images,
  });
  const withCatalog = (images: boolean): HostToWebview => ({
    type: 'catalog',
    catalog: {
      models: [model('m', images)],
      providers: [{ id: 'opencode', name: 'OpenCode' }],
      agents: [{ id: 'build', name: 'Build' }],
      serverDefault: { providerID: 'opencode', id: 'm' },
      defaultAgent: 'build',
    },
  });
  const pasteImage = (h: Harness, file: File): void => {
    fire(h.textarea(), 'paste', {
      clipboardData: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] },
    });
  };
  // Waits for a CONDITION, not for a fixed time: jsdom's FileReader finishes when the event loop
  // lets it, which a fixed 20 ms missed 2 of 4 full-suite runs (review of 23/10/2026, W1).
  const until = async (condition: () => void): Promise<void> => {
    await vi.waitFor(condition, { timeout: 3000, interval: 5 });
  };
  const chipFor = async (h: Harness, uri: string): Promise<string> => {
    pasteImage(h, new File([ICON], 'a.png', { type: 'image/png' }));
    await until(() => {
      expect(h.sent.length).toBeGreaterThan(0);
    });
    const message = h.sent.at(-1);
    const requestId = message && 'requestId' in message ? message.requestId : '';
    h.apply(
      { type: 'attachments.picked', requestId, files: [{ uri, name: 'Pasted image 1' }] },
      { type: 'request.result', requestId },
    );
    return requestId;
  };

  it('does not lock Send when an empty image is pasted', async () => {
    const h = start();
    h.apply(connected, withCatalog(true));
    pasteImage(h, new File([], 'x.png', { type: 'image/png' }));
    await until(() => {
      expect(h.container.textContent).toContain('That image could not be read');
    });
    expect(h.sent).toEqual([]);
    expect(h.store.state.pending).toEqual([]);
  });

  it('sends only the dropped URIs the host validator accepts, and nothing when none is left', () => {
    const h = start();
    h.apply(connected);
    const form = must<HTMLFormElement>(h.container, 'form.prompt');
    const drop = (uris: string[]): Event =>
      fire(form, 'drop', {
        dataTransfer: { types: ['resourceurls'], files: [], getData: () => JSON.stringify(uris) },
      });
    drop(['file:///ws/a.ts', 'file:///ws/' + 'x'.repeat(5000), 'file:///ws/b\0.ts']);
    expect(h.sent).toMatchObject([{ type: 'attachments.drop', uris: ['file:///ws/a.ts'] }]);
    h.sent.length = 0;
    const pendingBefore = h.store.state.pending.length;
    drop(['file:///ws/' + 'x'.repeat(5000)]);
    expect(h.sent).toEqual([]);
    expect(h.store.state.pending.length).toBe(pendingBefore);
  });

  it('tells the host to forget a pasted image when its chip is removed, and frees the blob', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
    const h = start();
    h.apply(connected, withCatalog(true));
    await chipFor(h, 'pasted-image:1');
    h.sent.length = 0;
    h.button('Remove Pasted image 1').click();
    expect(h.sent).toEqual([{ type: 'attachments.forget', uri: 'pasted-image:1' }]);
    expect(revoke).toHaveBeenCalledWith('blob:thumb');
    expect(h.store.state.thumbs).toEqual({});
    vi.restoreAllMocks();
  });

  it('frees the blob of a pasted image the host refused', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
    const h = start();
    h.apply(connected, withCatalog(true));
    pasteImage(h, new File([ICON], 'a.png', { type: 'image/png' }));
    await until(() => {
      expect(h.sent.length).toBeGreaterThan(0);
    });
    const message = h.sent[0];
    const requestId = message && 'requestId' in message ? message.requestId : '';
    h.apply({
      type: 'request.result',
      requestId,
      error: { code: 'UnsupportedImage', message: 'nope' },
    });
    expect(revoke).toHaveBeenCalledWith('blob:thumb');
    vi.restoreAllMocks();
  });

  it('frees the blob of a pasted image once the prompt carrying it is accepted', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
    const h = start();
    h.apply(connected, withCatalog(true));
    await chipFor(h, 'pasted-image:1');
    h.sent.length = 0;
    h.type('look');
    h.button('Send').click();
    const sent = h.sent.find((m) => m.type === 'prompt.send');
    const requestId = sent && 'requestId' in sent ? sent.requestId : '';
    expect(revoke).not.toHaveBeenCalled();
    h.apply({ type: 'request.result', requestId });
    expect(revoke).toHaveBeenCalledWith('blob:thumb');
    vi.restoreAllMocks();
  });

  it('sends the dropped Explorer URIs to the host', () => {
    const h = start();
    h.apply(connected);
    const form = must<HTMLFormElement>(h.container, 'form.prompt');
    fire(form, 'drop', {
      dataTransfer: {
        types: ['resourceurls'],
        files: [],
        getData: () => '["file:///c%3A/ws/src/a.ts"]',
      },
    });
    expect(h.sent).toMatchObject([
      { type: 'attachments.drop', uris: ['file:///c%3A/ws/src/a.ts'] },
    ]);
  });

  it('sends a pasted image as one clonable attachments.image and gives it a thumbnail', async () => {
    const urls = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
    const h = start();
    h.apply(connected, withCatalog(true));
    pasteImage(h, new File([ICON], 'a.png', { type: 'image/png' }));
    await until(() => {
      expect(h.sent.length).toBeGreaterThan(0);
    });
    const message = h.sent[0];
    expect(message).toMatchObject({
      type: 'attachments.image',
      mime: 'image/png',
      data: 'iVBORw==',
    });
    expect(structuredClone(message)).toEqual(message);
    const requestId = message && 'requestId' in message ? message.requestId : '';
    h.apply(
      {
        type: 'attachments.picked',
        requestId,
        files: [{ uri: 'pasted-image:1', name: 'Pasted image 1' }],
      },
      { type: 'request.result', requestId },
    );
    expect(h.container.querySelector('img.chip-thumb')?.getAttribute('src')).toBe('blob:thumb');
    expect(h.container.querySelector('[role="alert"]')).toBeNull();
    urls.mockRestore();
  });

  it('warns once, locally, when the selected model cannot read images, and still attaches', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
    const h = start();
    h.apply(connected, withCatalog(false));
    pasteImage(h, new File([ICON], 'a.png', { type: 'image/png' }));
    await until(() => {
      expect(h.sent.length).toBeGreaterThan(0);
    });
    expect(h.container.textContent).toContain(
      'The selected model cannot read images: it will be told so',
    );
    expect(h.sent).toMatchObject([{ type: 'attachments.image' }]);
    vi.restoreAllMocks();
  });

  it('refuses a bmp locally, with no message to the host', async () => {
    const h = start();
    h.apply(connected, withCatalog(true));
    pasteImage(h, new File([ICON], 'a.bmp', { type: 'image/bmp' }));
    await until(() => {
      expect(h.container.textContent).toContain(
        'Only PNG, JPEG, GIF and WebP images can be attached',
      );
    });
    expect(h.sent).toEqual([]);
  });

  it('answers a dropped OS file that is not an image with the hint', () => {
    const h = start();
    h.apply(connected);
    const form = must<HTMLFormElement>(h.container, 'form.prompt');
    fire(form, 'drop', {
      dataTransfer: {
        types: ['Files'],
        files: [new File(['x'], 'a.txt', { type: 'text/plain' })],
        getData: () => '',
      },
    });
    expect(h.sent).toEqual([]);
    expect(h.container.textContent).toContain(
      'Drop files from the VS Code Explorer, or use the + menu',
    );
  });
});

// Issue #35. Protects that a palette or keyboard command runs the code of the matching button
// (so "Stopped" is announced, Send is locked while the new session is in flight and the draft
// survives), that Stop with no turn says so instead of staying silent, and that the focus the host
// mirrors into a context key is reported. Fabricated host messages in jsdom: whether the key
// reaches the host with the focus inside the iframe is checked by `test:visual` step 22.
describe('host commands (ui.command)', () => {
  const announced = (h: Harness): string =>
    must(h.container, '.status-bar .visually-hidden[aria-live="polite"]').textContent.trim();

  it('prompt.focus puts the caret in the prompt', () => {
    const h = start();
    h.apply({ type: 'ui.command', command: 'prompt.focus' });
    expect(document.activeElement).toBe(h.textarea());
  });

  it('session.new sends session.new, keeps the draft and focuses the prompt', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    h.type('half written');
    h.apply({ type: 'ui.command', command: 'session.new' });
    expect(h.sent.filter((m) => m.type === 'session.new')).toHaveLength(1);
    expect(h.textarea().value).toBe('half written');
    expect(document.activeElement).toBe(h.textarea());
  });

  it('session.stop on a running turn aborts it and announces "Stopped"', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')], { type: 'busy' }));
    h.apply({ type: 'ui.command', command: 'session.stop' });
    expect(h.sent.filter((m) => m.type === 'session.abort')).toHaveLength(1);
    h.apply({ type: 'session.status', sessionID: SES, status: { type: 'idle' } });
    expect(announced(h)).toBe('Stopped');
  });

  it('session.stop with no turn running sends nothing and shows "No response is running"', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    h.apply({ type: 'ui.command', command: 'session.stop' });
    expect(h.sent.filter((m) => m.type === 'session.abort')).toHaveLength(0);
    expect(h.container.textContent).toContain('No response is running');
  });

  // `listenHost` applies a whole frame inside one `batch`; the harness `apply` does not, so these
  // two wrap it. Without the batch the first test could not see the real behaviour.
  it('runs a stop that arrives in the same batch as the snapshot that makes the turn busy', () => {
    const h = start();
    batch(() => {
      h.apply(...openSession([user('m1', 'hi'), assistant('m2')], { type: 'busy' }), {
        type: 'ui.command',
        command: 'session.stop',
      });
    });
    expect(h.sent.filter((m) => m.type === 'session.abort')).toHaveLength(1);
  });

  // Protects the case of review B1: Stop and Focus Prompt kept for the same `ready` reach the
  // webview in one frame; the Stop must not be overwritten by the second command.
  it('runs every ui.command of one batch, in order', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')], { type: 'busy' }));
    batch(() => {
      h.apply(
        { type: 'ui.command', command: 'session.stop' },
        { type: 'ui.command', command: 'prompt.focus' },
      );
    });
    expect(h.sent.filter((m) => m.type === 'session.abort')).toHaveLength(1);
    expect(document.activeElement).toBe(h.textarea());
  });

  it('session.new closes the session list, as its button does', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    h.button('Sessions').click();
    expect(h.container.querySelector('#session-picker')).not.toBeNull();
    h.apply({ type: 'ui.command', command: 'session.new' });
    expect(h.container.querySelector('#session-picker')).toBeNull();
  });

  it('reports the window focus and blur to the host', () => {
    const h = start();
    // The first report is the value at mount (jsdom: no focus), the next two are the events.
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('blur'));
    expect(h.focusReports.slice(1)).toEqual([
      { type: 'chat.focusChanged', focused: true },
      { type: 'chat.focusChanged', focused: false },
    ]);
    expect(h.focusReports).toHaveLength(3);
  });
});

// Issue #36 (Explain / Fix from the context menus). Protects: a compose sends through the Send code
// (mention computed, chips as files) without touching the user's draft or chips; it falls to the
// draft (P6: set when empty, appended on a new line otherwise, chips added once) when it cannot or
// must not send, with a notice that says why; two in one batch do not both send; an out-of-bounds
// one begins no request; a failed compose adds its text to the user's draft. FABRICATED host
// messages in jsdom: that the real host produces them and a real Send works with them is what the
// integration checks "Explorer Explain sends one prompt for the files and counts the folder it
// skipped" and "reads the editor of the clicked document, not the active one" and the `test:visual`
// checks "C3 Explain from the editor sends ..." and "C5 the chat that was hidden when the command
// ran sends ..." ran.
describe('prompt.compose (issue #36)', () => {
  const FILE = { uri: 'file:///ws/src/a.ts?start=2&end=3', name: 'src/a.ts#2-3' };
  const TEXT = 'Explain what @src/a.ts#2-3 does.';
  const chipNames = (h: Harness): (string | null)[] =>
    [...h.container.querySelectorAll('.chips .chip-open')].map((c) => c.textContent);
  const prompts = (h: Harness) => h.sent.filter((m) => m.type === 'prompt.send');

  it('sends with the mention and leaves the draft and the chips of the user alone', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    h.type('half written');
    h.store.addDraftFiles([{ uri: 'file:///ws/b.ts', name: 'b.ts' }]);
    h.apply({ type: 'prompt.compose', text: TEXT, files: [FILE], send: true });
    const sent = prompts(h);
    expect(sent).toHaveLength(1);
    const message = sent[0];
    if (message?.type !== 'prompt.send') throw new Error('not a prompt.send');
    expect(message.text).toBe(TEXT);
    expect(message.delivery).toBe('queue');
    expect(message.files).toEqual([
      { ...FILE, mention: { start: 13, end: 13 + 1 + FILE.name.length, text: `@${FILE.name}` } },
    ]);
    expect(h.textarea().value).toBe('half written');
    expect(chipNames(h)).toEqual(['b.ts']);
    expect(h.store.state.pending).toHaveLength(1);
  });

  it('puts text and chips in an empty draft when send is false, with no notice', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    h.apply({ type: 'prompt.compose', text: TEXT, files: [FILE], send: false });
    expect(prompts(h)).toHaveLength(0);
    expect(h.textarea().value).toBe(TEXT);
    expect(chipNames(h)).toEqual(['src/a.ts#2-3']);
    expect(h.store.state.notices).toEqual([]);
    expect(document.activeElement).toBe(h.textarea());
  });

  it('appends to a draft that has text on a new line and does not repeat a chip', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    h.type('my notes');
    h.store.addDraftFiles([FILE]);
    h.apply({ type: 'prompt.compose', text: TEXT, files: [FILE], send: false });
    expect(h.textarea().value).toBe(`my notes\n${TEXT}`);
    expect(chipNames(h)).toEqual(['src/a.ts#2-3']);
  });

  it('falls to the draft with a notice when the session is busy', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')], { type: 'busy' }));
    h.apply({ type: 'prompt.compose', text: TEXT, files: [FILE], send: true });
    expect(prompts(h)).toHaveLength(0);
    expect(h.textarea().value).toBe(TEXT);
    expect(h.container.textContent).toContain('OpenCode is busy: the prompt is in the box');
  });

  it('falls to the draft with a notice when it is not connected', () => {
    const h = start();
    h.apply({ type: 'connection.state', connection: { state: 'starting' } });
    h.apply({ type: 'prompt.compose', text: TEXT, files: [FILE], send: true });
    expect(prompts(h)).toHaveLength(0);
    expect(h.textarea().value).toBe(TEXT);
    expect(h.container.textContent).toContain(
      'OpenCode is not connected yet: the prompt is in the box',
    );
  });

  it('sends the first of two composes of one batch and drafts the second', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    batch(() => {
      h.apply(
        { type: 'prompt.compose', text: 'Explain what @a.ts does.', files: [], send: true },
        { type: 'prompt.compose', text: 'Fix the problems in @b.ts.', files: [], send: true },
      );
    });
    const sent = prompts(h);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ text: 'Explain what @a.ts does.' });
    expect(h.textarea().value).toBe('Fix the problems in @b.ts.');
  });

  it('refuses a message out of bounds before beginning a request', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    h.apply({ type: 'prompt.compose', text: '   ', files: [], send: true });
    expect(h.sent).toEqual([]);
    expect(h.store.state.pending).toEqual([]);
    expect(h.textarea().value).toBe('');
  });

  it('gives the text and the chips back when the send fails', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    h.apply({ type: 'prompt.compose', text: TEXT, files: [FILE], send: true });
    const message = prompts(h)[0];
    if (message?.type !== 'prompt.send') throw new Error('not a prompt.send');
    h.apply({
      type: 'request.result',
      requestId: message.requestId,
      error: { code: 'Boom', message: 'it broke' },
    });
    expect(h.textarea().value).toBe(TEXT);
    expect(chipNames(h)).toEqual(['src/a.ts#2-3']);
  });

  // Protects W2 (Sergio, 29/10/2026): the compose left the user's draft alone, so a failure must
  // ADD its text to that draft (new last line, chips once) instead of dropping it.
  it('appends the text of a failed compose to the draft the user had, chips once', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    h.type('half written');
    h.store.addDraftFiles([FILE]);
    h.apply({ type: 'prompt.compose', text: TEXT, files: [FILE], send: true });
    const message = prompts(h)[0];
    if (message?.type !== 'prompt.send') throw new Error('not a prompt.send');
    h.apply({
      type: 'request.result',
      requestId: message.requestId,
      error: { code: 'Boom', message: 'it broke' },
    });
    expect(h.textarea().value).toBe(`half written\n${TEXT}`);
    expect(chipNames(h)).toEqual(['src/a.ts#2-3']);
  });

  // The normal Send is unchanged: its box was emptied, so a user who typed again meanwhile keeps
  // what they typed and the failed text is not appended (restore only into an empty box).
  it('does not append the text of a failed normal send to a newer draft', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    h.type('first');
    h.button('Send').click();
    const message = prompts(h)[0];
    if (message?.type !== 'prompt.send') throw new Error('not a prompt.send');
    h.type('typed meanwhile');
    h.apply({
      type: 'request.result',
      requestId: message.requestId,
      error: { code: 'Boom', message: 'it broke' },
    });
    expect(h.textarea().value).toBe('typed meanwhile');
  });
});

// Issue #33 (slash commands): what `prompt.send` carries when the draft starts with a listed
// command. FABRICATED catalog and snapshots (`init`/`review` are the built-in names of opencode
// v2.0.32; the wire shape is the one `protocol.ts` validates). They prove the wiring between the
// draft, the catalog and the message, not what the server does with a command.
describe('slash commands (issue #33)', () => {
  const withCommands = (commands?: { name: string; description?: string }[]): HostToWebview => ({
    type: 'catalog',
    catalog: {
      models: [],
      providers: [],
      agents: [],
      ...(commands === undefined ? {} : { commands }),
    },
  });
  const COMMANDS = [{ name: 'init', description: 'guided AGENTS.md setup' }, { name: 'hello' }];
  const lastSent = (h: Harness) => {
    const message = h.sent.at(-1);
    if (message?.type !== 'prompt.send') throw new Error('the last message is not a prompt.send');
    return message;
  };

  it('sends a listed command with its arguments as text and the full text kept for the draft', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]), withCommands(COMMANDS));
    h.type('/hello world');
    h.button('Send').click();
    expect(lastSent(h)).toMatchObject({
      command: 'hello',
      text: 'world',
      delivery: 'queue',
      sessionID: SES,
    });
    expect(h.saved.at(-1)).toMatchObject({ history: ['/hello world'] });
  });

  it('sends a command without arguments as an empty text', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]), withCommands(COMMANDS));
    h.type('/init');
    h.button('Send').click();
    expect(lastSent(h)).toMatchObject({ command: 'init', text: '' });
  });

  it('sends the chips without a mention when a command runs', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]), withCommands(COMMANDS));
    h.apply({
      type: 'attachments.picked',
      requestId: 'pick',
      files: [{ uri: 'file:///x.ts', name: 'x.ts' }],
    });
    h.type('/hello @x.ts');
    h.button('Send').click();
    expect(lastSent(h).files).toEqual([{ uri: 'file:///x.ts', name: 'x.ts' }]);
  });

  it('sends an unlisted /name as a normal prompt with the full text (P4=1)', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]), withCommands(COMMANDS));
    h.type('/nope x');
    h.button('Send').click();
    const sent = lastSent(h);
    expect(sent.text).toBe('/nope x');
    expect(sent.command).toBeUndefined();
  });

  it('sends a normal prompt when the catalog has no command list at all', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]), withCommands(undefined));
    h.type('/init');
    h.button('Send').click();
    const sent = lastSent(h);
    expect(sent.text).toBe('/init');
    expect(sent.command).toBeUndefined();
  });

  it('gives the full typed text and the chips back when the command fails', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]), withCommands(COMMANDS));
    h.apply({
      type: 'attachments.picked',
      requestId: 'pick',
      files: [{ uri: 'file:///x.ts', name: 'x.ts' }],
    });
    h.type('/hello world');
    h.button('Send').click();
    const request = lastSent(h);
    expect(h.textarea().value).toBe('');
    h.apply({
      type: 'request.result',
      requestId: request.requestId,
      error: {
        code: 'CommandUnavailable',
        message: 'The command /hello is not available on this server',
      },
    });
    expect(h.textarea().value).toBe('/hello world');
    expect(h.container.querySelector('.chip')?.textContent).toContain('x.ts');
    expect(must(h.container, '[role="alert"]').textContent).toContain('/hello is not available');
  });

  it('lists the catalog commands in the "/" button', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]), withCommands(COMMANDS));
    must<HTMLButtonElement>(h.container, 'button[aria-label="Commands"]').click();
    expect(
      [...h.container.querySelectorAll('.command-menu [role="menuitem"]')].map(
        (i) => i.textContent,
      ),
    ).toEqual([
      '/initguided AGENTS.md setup',
      '/hello',
      '/compactSummarize the conversation to free context',
    ]);
  });

  // Engram #1425: the same absent `commands` reads "Loading commands…" before the catalog arrives
  // and "Commands could not be loaded" once a catalog came without them.
  it('tells "loading" (no catalog yet) from "could not be loaded" (a catalog without commands)', () => {
    const h = start();
    h.apply(...openSession([user('m1', 'hi')]));
    const item = () => h.container.querySelector('.command-menu [role="menuitem"]')?.textContent;
    must<HTMLButtonElement>(h.container, 'button[aria-label="Commands"]').click();
    expect(item()).toBe('Loading commands…');
    h.apply(withCommands(undefined)); // the open menu follows the catalog
    expect(item()).toBe('Commands could not be loaded');
  });

  it('keeps the "/" button aria-disabled without a connection', () => {
    const h = start();
    const trigger = must<HTMLButtonElement>(h.container, 'button[aria-label="Commands"]');
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.disabled).toBe(false);
  });

  // Issue #105 (decision P2=1/P3=1): a long user message is folded behind a native button, and
  // the unfolded state is not remembered across sessions. FABRICATED messages; jsdom has no layout,
  // so the height is not measured here.
  describe('folds a long user message', () => {
    const long = Array(13).fill('line').join('\n');
    const toggle = (h: Harness) =>
      h.container.querySelector<HTMLButtonElement>('button.message-fold');

    it('shows Show more with aria-expanded false and aria-controls pointing at the text', () => {
      const h = start();
      h.apply(...openSession([user('m1', long)]));
      const button = toggle(h);
      expect(button?.textContent).toBe('Show more');
      expect(button?.getAttribute('aria-expanded')).toBe('false');
      const text = must(h.container, '.message-user .part-text');
      expect(button?.getAttribute('aria-controls')).toBe(text.id);
      expect(text.hasAttribute('data-folded')).toBe(true);
      expect(text.textContent).toBe(long);
      expect(h.container.querySelector('[style]')).toBeNull();
    });

    it('unfolds and folds again with the click, flipping the label and aria-expanded', () => {
      const h = start();
      h.apply(...openSession([user('m1', long)]));
      toggle(h)?.click();
      expect(toggle(h)?.textContent).toBe('Show less');
      expect(toggle(h)?.getAttribute('aria-expanded')).toBe('true');
      expect(must(h.container, '.message-user .part-text').hasAttribute('data-folded')).toBe(false);
      toggle(h)?.click();
      expect(toggle(h)?.textContent).toBe('Show more');
    });

    it('has no button on a short message', () => {
      const h = start();
      h.apply(...openSession([user('m1', 'short')]));
      expect(toggle(h)).toBeNull();
      expect(must(h.container, '.message-user .part-text').hasAttribute('data-folded')).toBe(false);
    });

    it('keeps it unfolded when a snapshot of the same session updates the message', () => {
      const h = start();
      h.apply(...openSession([user('m1', long)]));
      toggle(h)?.click();
      h.apply(...openSession([user('m1', long), assistant('m2')]));
      expect(toggle(h)?.getAttribute('aria-expanded')).toBe('true');
    });

    it('folds it again when the session is opened again', () => {
      const h = start();
      h.apply(...openSession([user('m1', long)]));
      toggle(h)?.click();
      h.apply({
        type: 'snapshot',
        snapshot: {
          sessions: [{ id: 'ses_2', title: 'Other', createdAt: 1, updatedAt: 2 }],
          statuses: {},
          open: { sessionID: 'ses_2', messages: [user('n1', 'other')], parts: {} },
          requests: { permissions: [], forms: [] },
          resolutions: [],
        },
      });
      h.apply(...openSession([user('m1', long)]));
      expect(toggle(h)?.getAttribute('aria-expanded')).toBe('false');
    });
  });

  // Issue #125, /compact (decision P1=1): a client command that asks the host for `session.compact`.
  describe('/compact', () => {
    const compactions = (h: Harness) => h.sent.filter((m) => m.type === 'session.compact');

    it('asks the host to compact the open session and sends no prompt', () => {
      const h = start();
      h.apply(...openSession([user('m1', 'hi')]), withCommands(COMMANDS));
      h.type('/compact');
      h.button('Send').click();
      expect(h.sent).toMatchObject([{ type: 'session.compact', sessionID: SES }]);
      expect(h.store.state.pending).toHaveLength(1);
      expect(h.textarea().value).toBe('');
      expect(h.saved.at(-1)).toMatchObject({ history: ['/compact'] });
    });

    // Protects review S1 of #125: with the catalog still loading (or failed) "/compact" must not
    // reach the model as a normal prompt. FABRICATED state (no catalog applied).
    it('still compacts, and sends no prompt, while the command catalog is not loaded', () => {
      const h = start();
      h.apply(...openSession([user('m1', 'hi')]));
      h.type('/compact');
      h.button('Send').click();
      expect(h.sent).toMatchObject([{ type: 'session.compact', sessionID: SES }]);
    });

    it('leaves the chips of the draft alone', () => {
      const h = start();
      h.apply(...openSession([user('m1', 'hi')]), withCommands(COMMANDS));
      h.apply({
        type: 'attachments.picked',
        requestId: 'pick',
        files: [{ uri: 'file:///x.ts', name: 'x.ts' }],
      });
      h.type('/compact');
      h.button('Send').click();
      expect(compactions(h)).toHaveLength(1);
      expect(h.container.querySelector('.chip')?.textContent).toContain('x.ts');
    });

    it('says there is nothing to compact, and sends nothing, with no user message', () => {
      const h = start();
      h.apply(...openSession([]), withCommands(COMMANDS));
      h.type('/compact');
      h.button('Send').click();
      expect(h.sent).toEqual([]);
      expect(h.store.state.pending).toEqual([]);
      expect(h.container.textContent).toContain('There is nothing to compact yet');
    });

    it('says the same with no session open', () => {
      const h = start();
      h.apply(connected, withCommands(COMMANDS));
      h.type('/compact');
      h.button('Send').click();
      expect(h.sent).toEqual([]);
      expect(h.container.textContent).toContain('There is nothing to compact yet');
    });

    it('runs the server command when the server lists one called compact', () => {
      const h = start();
      h.apply(...openSession([user('m1', 'hi')]), withCommands([{ name: 'compact' }]));
      h.type('/compact now');
      h.button('Send').click();
      expect(compactions(h)).toEqual([]);
      expect(lastSent(h)).toMatchObject({ command: 'compact', text: 'now' });
    });

    it('shows "Compacting" as the activity while the compaction line runs', () => {
      const h = start();
      h.apply(
        ...openSession(
          [
            user('m1', 'hi'),
            {
              kind: 'notice',
              id: 'msg_c',
              createdAt: 3,
              text: 'Compacting the conversation…',
              compaction: 'running',
            },
          ],
          { type: 'busy' },
        ),
      );
      expect(h.container.querySelector('.activity')?.textContent).toContain('Compacting');
      expect(h.container.querySelector('.message-notice')?.textContent).toBe(
        'Compacting the conversation…',
      );
    });
  });

  // Issue #125, decision P4=1: Retry of a turn this document sent as a command runs the command
  // again; anything else keeps resending the stored text. FABRICATED snapshots: the server keeps
  // the expanded template as the user message, which the second user message stands for.
  describe('Retry of a command turn', () => {
    const failedTurn = (extra: MessageInfo[] = []): HostToWebview[] =>
      openSession([
        user('m1', 'hi'),
        user('m2', 'expanded template'),
        assistant('m3', { error: { code: 'boom', message: 'it broke' } }),
        ...extra,
      ]);
    const answer = (h: Harness): void => {
      h.apply({ type: 'request.result', requestId: lastSent(h).requestId });
    };

    it('runs the command again with its arguments and files', () => {
      const h = start();
      h.apply(...openSession([user('m1', 'hi')]), withCommands(COMMANDS));
      h.apply({
        type: 'attachments.picked',
        requestId: 'pick',
        files: [{ uri: 'file:///x.ts', name: 'x.ts' }],
      });
      h.type('/hello world');
      h.button('Send').click();
      answer(h);
      h.apply(...failedTurn());
      h.button('Retry').click();
      expect(lastSent(h)).toMatchObject({
        command: 'hello',
        text: 'world',
        sessionID: SES,
        files: [{ uri: 'file:///x.ts', name: 'x.ts' }],
      });
      expect(h.sent.filter((m) => m.type === 'prompt.send')).toHaveLength(2);
    });

    it('resends the stored text once a normal prompt came after the command', () => {
      const h = start();
      h.apply(...openSession([user('m1', 'hi')]), withCommands(COMMANDS));
      h.type('/hello world');
      h.button('Send').click();
      answer(h);
      h.type('plain prompt');
      h.button('Send').click();
      answer(h);
      h.apply(
        ...openSession([
          user('m1', 'hi'),
          user('m2', 'plain prompt'),
          assistant('m3', { error: { code: 'boom', message: 'it broke' } }),
        ]),
      );
      h.button('Retry').click();
      const sent = lastSent(h);
      expect(sent.command).toBeUndefined();
      expect(sent.text).toBe('plain prompt');
    });

    // Protects review W1 of #125: /compact is not a prompt, but it ends the "last turn was a
    // command" memory, so a Retry after a failed compaction does not rerun an older command.
    // FABRICATED snapshots (our logic only).
    it('resends the stored text, not the command, after a /compact came in between', () => {
      const h = start();
      h.apply(...openSession([user('m1', 'hi')]), withCommands(COMMANDS));
      h.type('/hello world');
      h.button('Send').click();
      answer(h);
      h.type('/compact');
      h.button('Send').click();
      const compaction = h.sent.find((m) => m.type === 'session.compact');
      h.apply({
        type: 'request.result',
        requestId: compaction?.type === 'session.compact' ? compaction.requestId : '',
      });
      h.apply(...failedTurn());
      h.button('Retry').click();
      const sent = lastSent(h);
      expect(sent.command).toBeUndefined();
      expect(sent.text).toBe('expanded template');
    });

    it('does not reuse the command in another session', () => {
      const h = start();
      h.apply(...openSession([user('m1', 'hi')]), withCommands(COMMANDS));
      h.type('/hello world');
      h.button('Send').click();
      answer(h);
      h.apply({
        type: 'snapshot',
        snapshot: {
          sessions: [{ id: 'ses_2', title: 'Other', createdAt: 1, updatedAt: 2 }],
          statuses: {},
          open: {
            sessionID: 'ses_2',
            messages: [
              user('n1', 'older'),
              assistant('n2', { error: { code: 'boom', message: 'it broke' } }),
            ],
            parts: {},
          },
          requests: { permissions: [], forms: [] },
          resolutions: [],
        },
      });
      h.button('Retry').click();
      expect(lastSent(h)).toMatchObject({ sessionID: 'ses_2', text: 'older' });
      expect(lastSent(h).command).toBeUndefined();
    });

    it('adopts the session a command created when none was open', () => {
      const h = start();
      h.apply(connected, withCommands(COMMANDS));
      h.type('/init');
      h.button('Send').click();
      expect(lastSent(h).sessionID).toBeUndefined();
      answer(h);
      h.apply(...failedTurn());
      h.button('Retry').click();
      expect(lastSent(h)).toMatchObject({ command: 'init', text: '', sessionID: SES });
    });
  });
});
