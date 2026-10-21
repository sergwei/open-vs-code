// Protects the permission card (issue #18): every button posts the exact protocol message, "Always
// allow" needs a second press that shows what would be stored (and warns when the rule is broad),
// "Reject" says it takes the session's other pending requests with it, a locked card cannot be
// pressed twice, and Escape never rejects. A regression here is a click that answers the wrong
// thing, or a persistent rule saved without the user reading it.
//
// Provenance: a fabricated `PermissionAsk` shaped like the one `file-access.ts@v2.0.32` was READ to
// send for a `.env` read (`save: ["*"]`); components rendered in jsdom with a recording sender.
// They confirm the wiring and the wording, not the layout, the focus ring or a screen reader (F5).
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermissionAsk } from '../../../src/shared/model';
import { must, mount, splitRequestId, type Mounted } from '../testing';
import { PermissionCard } from './PermissionCard';

const mountedCards: Mounted[] = [];
afterEach(() => {
  for (const card of mountedCards.splice(0)) card.dispose();
});

const ask: PermissionAsk = {
  id: 'per_1',
  sessionID: 'ses_1',
  action: 'read',
  resources: ['.env'],
  save: ['*'],
};

/** Mounts a card; `replying` and `error` are signals so a test can change them after mount (lesson #906). */
function setup(
  options: {
    ask?: PermissionAsk;
    sameSessionCount?: number;
    toolName?: string;
    origin?: { title: string; onOpen?(): void };
  } = {},
) {
  const [replying, setReplying] = createSignal(false);
  const [error, setError] = createSignal<{ code: string; message: string } | undefined>(undefined);
  const onSent = vi.fn();
  const onEscape = vi.fn();
  const mounted = mount(() => (
    <PermissionCard
      ask={options.ask ?? ask}
      sameSessionCount={options.sameSessionCount ?? 1}
      toolName={options.toolName}
      origin={options.origin}
      replying={replying()}
      error={error()}
      onSent={onSent}
      onEscape={onEscape}
    />
  ));
  mountedCards.push(mounted);
  const container = mounted.container;
  const button = (name: string): HTMLButtonElement => {
    const found = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
    if (found === undefined) throw new Error(`no button named ${name}`);
    return found;
  };
  return { container, sent: mounted.sent, onSent, onEscape, button, setReplying, setError };
}

describe('answers', () => {
  it('Allow once posts the exact reply and marks the card as sent with the same request id', () => {
    const { button, sent, onSent } = setup();
    button('Allow once').click();
    expect(sent).toHaveLength(1);
    const { requestId, rest } = splitRequestId(sent[0]);
    expect(rest).toEqual({
      type: 'permission.reply',
      sessionID: 'ses_1',
      permissionID: 'per_1',
      decision: 'once',
    });
    expect(onSent).toHaveBeenCalledWith(requestId);
  });

  it('Reject posts a reject with no message', () => {
    const { button, sent } = setup();
    button('Reject').click();
    expect(sent).toEqual([expect.objectContaining({ decision: 'reject' })]);
    expect(sent[0]).not.toHaveProperty('message');
  });

  it('Reject with feedback opens a textarea and sends its text as the message', () => {
    const { button, sent, container } = setup();
    expect(container.querySelector('textarea')).toBeNull();
    button('Reject with feedback…').click();
    const textarea = must<HTMLTextAreaElement>(container, 'textarea');
    textarea.value = "don't read secrets";
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    button('Reject with this feedback').click();
    expect(sent).toEqual([
      expect.objectContaining({ decision: 'reject', message: "don't read secrets" }),
    ]);
  });

  it('a blank feedback is sent as a plain reject (no empty correction)', () => {
    const { button, sent, container } = setup();
    button('Reject with feedback…').click();
    const textarea = must<HTMLTextAreaElement>(container, 'textarea');
    textarea.value = '   ';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    button('Reject with this feedback').click();
    expect(sent[0]).not.toHaveProperty('message');
  });
});

describe('Always allow', () => {
  it('is not offered when the request has no save rules (the server would treat it as once)', () => {
    const { container } = setup({ ask: { ...ask, save: [] } });
    expect(container.textContent).not.toContain('Always allow');
  });

  it('needs a second press: the first shows the rules and that they persist for the project', () => {
    const { button, sent, container } = setup();
    button('Always allow…').click();
    expect(sent).toEqual([]);
    const panel = must(container, '.request-always');
    expect(panel.textContent).toContain('Read: *');
    expect(panel.textContent).toContain('this project');
    expect(panel.textContent).toContain('survives restarts');
    button('Yes, always allow').click();
    expect(sent).toEqual([expect.objectContaining({ decision: 'always' })]);
  });

  it('warns that a broad rule stops the questions about everything, with .env as the example', () => {
    const { button, container } = setup();
    button('Always allow…').click();
    const warning = must(container, '.request-warning');
    expect(warning.textContent).toContain('broad');
    expect(warning.textContent).toContain('.env');
  });

  it('does not warn for a specific rule', () => {
    const { button, container } = setup({ ask: { ...ask, action: 'edit', save: ['src/a.ts'] } });
    button('Always allow…').click();
    expect(container.querySelector('.request-warning')).toBeNull();
    expect(must(container, '.request-always').textContent).toContain('Edit: src/a.ts');
  });

  it('the panel offers Manage saved permissions, which posts permissions.manage and answers nothing', () => {
    const { button, sent, onSent, container } = setup();
    expect(container.textContent).not.toContain('Manage saved permissions');
    button('Always allow…').click();
    button('Manage saved permissions').click();
    expect(sent).toEqual([{ type: 'permissions.manage' }]);
    expect(onSent).not.toHaveBeenCalled();
    // The panel stays open: the user can still confirm or go back.
    expect(container.querySelector('.request-always')).not.toBeNull();
  });

  it('Back closes the panel without sending', () => {
    const { button, sent, container } = setup();
    button('Always allow…').click();
    button('Back').click();
    expect(container.querySelector('.request-always')).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe('content', () => {
  it('names the action, lists up to five resources and folds the rest', () => {
    const { container } = setup({
      ask: { ...ask, resources: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
    });
    expect(must(container, '.request-title').textContent).toBe('Permission needed: Read');
    expect(container.querySelectorAll('.request-resources li code')).toHaveLength(5);
    expect(must(container, '.request-more').textContent).toBe('+2 more');
  });

  it('shows the server message, the tool and the session it comes from', () => {
    const onOpen = vi.fn();
    const { container, button } = setup({
      ask: { ...ask, message: 'This file may hold secrets' },
      toolName: 'read',
      origin: { title: 'Subagent: explore', onOpen },
    });
    expect(container.textContent).toContain('This file may hold secrets');
    expect(must(container, '.request-tool').textContent).toContain('read');
    expect(must(container, '.request-origin').textContent).toContain('Subagent: explore');
    button('Open session').click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('does not offer Open session for a session that cannot be opened', () => {
    const { container } = setup({ origin: { title: 'child' } });
    expect(container.textContent).not.toContain('Open session');
  });

  it('warns that Reject also rejects the other pending requests of the session', () => {
    const { container } = setup({ sameSessionCount: 3 });
    expect(container.textContent).toContain('also rejects the 2 other pending requests');
    const single = setup({ sameSessionCount: 2 });
    expect(single.container.textContent).toContain('also rejects the 1 other pending request of');
    const alone = setup({ sameSessionCount: 1 });
    expect(alone.container.textContent).not.toContain('also rejects');
  });

  it('is a named group, described by its body, focusable by code', () => {
    const { container } = setup();
    const card = must(container, 'section.request-card');
    expect(card.getAttribute('role')).toBe('group');
    const labelledBy = card.getAttribute('aria-labelledby') ?? '';
    expect(container.querySelector(`[id="${labelledBy}"]`)?.tagName).toBe('H2');
    const describedBy = card.getAttribute('aria-describedby') ?? '';
    expect(container.querySelector(`[id="${describedBy}"]`)).not.toBeNull();
    expect(card.getAttribute('tabindex')).toBe('-1');
  });
});

describe('while the answer travels', () => {
  it('locks every button and says Sending…, then unlocks on an error shown with role=alert', () => {
    const { container, setReplying, setError, button } = setup();
    setReplying(true);
    for (const b of container.querySelectorAll('button')) expect(b.disabled).toBe(true);
    expect(container.textContent).toContain('Sending…');
    setReplying(false);
    setError({ code: 'PermissionNotFoundError', message: 'No such request' });
    expect(button('Allow once').disabled).toBe(false);
    expect(must(container, '[role="alert"]').textContent).toBe('No such request');
  });
});

describe('keyboard', () => {
  it('Escape asks to return the focus and never rejects', () => {
    const { container, sent, onEscape } = setup();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    must(container, 'button').dispatchEvent(event);
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(sent).toEqual([]);
  });
});
