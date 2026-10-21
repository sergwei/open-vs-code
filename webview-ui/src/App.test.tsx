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
import { createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageInfo, Part, RequestResolution, SessionStatus } from '../../src/shared/model';
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol';
import { App } from './App';
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
          sent.push(message);
        }}
        uiState={uiState}
      />
    ),
    container,
  );
  const harness: Harness = {
    store,
    sent,
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
    expect(h.saved.at(-1)).toEqual({ draft: '', history: ['hello there'], files: [] });
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
    h.button('Attach').click();
    expect(h.sent).toMatchObject([{ type: 'attachments.pick' }]);
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
  it.each([
    [{ state: 'starting' }, 'Starting'],
    [{ state: 'reconnecting', attempt: 2 }, 'Reconnecting (2)'],
    [{ state: 'stopped' }, 'Stopped'],
    [{ state: 'connected', serverVersion: '2.0.32' }, 'Connected'],
  ] as const)('shows %j as "%s"', (connection, text) => {
    const h = start();
    h.apply({ type: 'connection.state', connection });
    expect(must(h.container, '.connection').textContent).toContain(text);
  });

  it('shows Unavailable with the message and where to find the log', () => {
    const h = start();
    h.apply({
      type: 'connection.state',
      connection: {
        state: 'unavailable',
        reason: 'binary-missing',
        error: { code: 'binary-missing', message: 'opencode was not found' },
      },
    });
    const banner = must(h.container, '.connection');
    expect(banner.textContent).toContain('Unavailable: opencode was not found');
    expect(banner.textContent).toContain('Output → OpenCode');
    expect(must<HTMLButtonElement>(h.container, '.chat-header button:last-child').disabled).toBe(
      true,
    );
  });

  // Phase 3 (issue #10): the banner has buttons that talk to the host.
  it('Unavailable offers Restart server and Show logs, and each posts its message', () => {
    const h = start();
    h.apply({
      type: 'connection.state',
      connection: {
        state: 'unavailable',
        reason: 'exited',
        error: { code: 'exited', message: 'The server exited' },
      },
    });
    h.button('Restart server').click();
    h.button('Show logs').click();
    expect(h.sent).toEqual([{ type: 'server.restart' }, { type: 'logs.show' }]);
  });

  it('Reconnecting offers only Show logs (the host is already retrying)', () => {
    const h = start();
    h.apply({ type: 'connection.state', connection: { state: 'reconnecting', attempt: 1 } });
    expect(h.container.textContent).toContain('Reconnecting (1)');
    h.button('Show logs').click();
    expect(h.sent).toEqual([{ type: 'logs.show' }]);
    expect(() => h.button('Restart server')).toThrow();
  });

  it('Connected and Starting show no buttons in the banner', () => {
    const h = start();
    h.apply(connected);
    expect(h.container.querySelector('.connection-actions')).toBeNull();
    h.apply({ type: 'connection.state', connection: { state: 'starting' } });
    expect(h.container.querySelector('.connection-actions')).toBeNull();
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
    expect(article.querySelector('.part-tool + .request-outcome')).not.toBeNull();
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
    const buttons = [...h.container.querySelectorAll('.message-action')];
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
    const names = [...h.container.querySelectorAll('.message-action')].map((b) =>
      b.getAttribute('aria-label'),
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
    const chips = [...h.container.querySelectorAll('.chips .chip-name')].map((c) => c.textContent);
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
    expect(must(h.container, '.part-subagent span').textContent).toBe(
      'Subagent · general · Say hello · done',
    );
    h.button('Open subagent session Say hello').click();
    const { rest } = splitRequestId(h.sent[0]);
    expect(rest).toEqual({ type: 'session.open', sessionID: 'ses_kid' });
  });

  it('says "running" while the child runs', () => {
    const h = start();
    h.apply(...withTool(subagentTool({ sessionID: 'ses_kid', status: 'running' })));
    expect(must(h.container, '.part-subagent span').textContent).toBe(
      'Subagent · general · Say hello · running',
    );
  });

  it('keeps the plain line, with no button, when the block has no child id', () => {
    const h = start();
    h.apply(...withTool(subagentTool()));
    expect(must(h.container, '.part-tool').textContent).toBe('subagent · completed');
    expect(h.container.querySelector('.subagent-link')).toBeNull();
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
  const trigger = (h: Harness) => must<HTMLButtonElement>(h.container, 'button.model-trigger');
  const radio = (h: Harness, id: string) => must<HTMLInputElement>(h.container, `#agent-${id}`);
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
    h.type('hi');
    h.button('Send').click();
    const sent = lastSent(h);
    expect(sent.model).toBeUndefined();
    expect(sent.agent).toBeUndefined();
  });

  it('with no session shows Build and the default model, and a send carries the agent but not the default model', () => {
    const h = start();
    h.apply(connected, catalog);
    expect(trigger(h).getAttribute('aria-label')).toBe('Model: Big Pickle (default)');
    expect(trigger(h).textContent).toBe('Big Pickle (default)');
    expect(radio(h, 'build').checked).toBe(true);
    expect(radio(h, 'plan').checked).toBe(false);
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
    expect(trigger(h).textContent).toBe('GLM-5.3-Flash Free');
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
    radio(h, 'build').click();
    trigger(h).click();
    [...h.container.querySelectorAll<HTMLButtonElement>('button.model-option')][0]?.click();
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
    radio(h, 'plan').click();
    trigger(h).click();
    const glm = [...h.container.querySelectorAll<HTMLButtonElement>('button.model-option')].find(
      (b) => b.textContent.startsWith('GLM-5.3-Flash Free'),
    );
    glm?.click();
    expect(h.sent).toEqual([]);
    expect(radio(h, 'plan').checked).toBe(true);
    expect(trigger(h).textContent).toBe('GLM-5.3-Flash Free');
    h.type('go');
    h.button('Send').click();
    expect(lastSent(h)).toMatchObject({ sessionID: SES, model: GLM, agent: 'plan' });
  });

  it('an open session shows and sends its own model and agent', () => {
    const h = start();
    h.apply(...withRow({ model: GLM, agent: 'plan' }), catalog);
    expect(trigger(h).textContent).toBe('GLM-5.3-Flash Free');
    expect(radio(h, 'plan').checked).toBe(true);
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
    radio(h, 'plan').click();
    h.button('Retry').click();
    expect(lastSent(h)).toMatchObject({ text: 'hi', agent: 'plan', model: PICKLE });
  });

  it('forgets the draft when another session opens, but keeps it across a snapshot of the same one', () => {
    const h = start();
    h.apply(...withRow({ agent: 'build' }), catalog);
    radio(h, 'plan').click();
    h.apply(...withRow({ agent: 'build' }));
    expect(radio(h, 'plan').checked).toBe(true);
    h.apply(...withRow({ agent: 'build' }, 'ses_2'));
    expect(radio(h, 'build').checked).toBe(true);
    expect(radio(h, 'plan').checked).toBe(false);
  });

  it('keeps the draft of a session that does not exist yet until the first prompt creates it', () => {
    const h = start();
    h.apply(connected, catalog);
    radio(h, 'plan').click();
    expect(radio(h, 'plan').checked).toBe(true);
    h.type('hi');
    h.button('Send').click();
    expect(lastSent(h).agent).toBe('plan');
    // The host created the session: the snapshot opens it, and from then on its row speaks.
    h.apply(...withRow({ agent: 'plan' }, 'ses_new'));
    expect(radio(h, 'plan').checked).toBe(true);
  });

  it('persists the pick with the session it belongs to, and restores it only for that session', () => {
    const first = start();
    first.apply(...withRow({ agent: 'build' }), catalog);
    radio(first, 'plan').click();
    expect(first.saved.at(-1)).toMatchObject({ selection: { sessionID: SES, agent: 'plan' } });

    const same = start({
      draft: '',
      history: [],
      files: [],
      selection: { sessionID: SES, agent: 'plan' },
    });
    same.apply(...withRow({ agent: 'build' }), catalog);
    expect(radio(same, 'plan').checked).toBe(true);

    const other = start({
      draft: '',
      history: [],
      files: [],
      selection: { sessionID: SES, agent: 'plan' },
    });
    other.apply(...withRow({ agent: 'build' }, 'ses_2'), catalog);
    expect(radio(other, 'build').checked).toBe(true);
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
    expect(trigger(h).textContent).toBe('opencode/retired (unavailable)');
  });

  it('Enter on the agent switch does not send the prompt', () => {
    const h = start();
    h.apply(...withRow({ agent: 'build' }), catalog);
    h.type('keep me');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    radio(h, 'build').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(h.sent).toEqual([]);
  });

  it('keeps the selectors in the prompt row, not in the header', () => {
    const h = start();
    h.apply(...withRow(), catalog);
    expect(h.container.querySelector('header .model-trigger, header .agent-toggle')).toBeNull();
    expect(h.container.querySelector('.prompt-actions .model-trigger')).not.toBeNull();
    expect(h.container.querySelector('.prompt-actions .agent-toggle')).not.toBeNull();
  });
});
