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
import type { MessageInfo, SessionStatus } from '../../src/shared/model';
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol';
import { App } from './App';
import { createChatStore, type ChatStore } from './store/chatStore';
import { must } from './testing';
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

  it('shows the session title and the agent/model marker of the last assistant message', () => {
    const h = start();
    expect(must(h.container, '.chat-title').textContent).toBe('Untitled session');
    h.apply(...openSession([user('m1', 'hi'), assistant('m2')]));
    expect(must(h.container, '.chat-title').textContent).toBe('Fix the build');
    const marker = must<HTMLButtonElement>(h.container, '.model-marker');
    expect(marker.textContent).toBe('build · opencode/big-pickle');
    expect(marker.disabled).toBe(true);
    expect(h.container.querySelector('.suggestion')).toBeNull();
  });

  it('starts a new session from the header', () => {
    const h = start();
    h.apply(connected);
    h.button('New session').click();
    expect(h.sent).toMatchObject([{ type: 'session.new' }]);
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
