// Protects the rules of the attention feature (issue #19, per request since E4 of #77): one
// notification per request, never for a request a visible surface shows, at most three open,
// closed when the request is resolved by anyone or its own card comes into view, a badge that
// counts everything, and a title that names the chat. A wrong rule here is a toast that never
// closes, a flood of toasts, or a pending permission of a hidden tab nobody is told about while
// the agent waits.
//
// Provenance of the data: FABRICATED summaries. They confirm the policy's logic; that VS Code
// renders and runs the `command:` links of a progress notification is UNVERIFIED (F5 point 4).
import { describe, expect, it } from 'vitest';
import {
  MAX_LABEL_LENGTH,
  MAX_OPEN_NOTIFICATIONS,
  notificationMessage,
  notificationTitle,
  planAttention,
  sanitizeLinkText,
} from './attentionPolicy';
import { REPLY_PERMISSION_COMMAND_ID, SHOW_REQUEST_COMMAND_ID } from './ids';
import type { PendingSummary } from './pendingRequests';

const request = (
  id: string,
  kind: PendingSummary['kind'] = 'permission',
  detail = '.env',
): PendingSummary => ({ id, kind, sessionID: 'ses_1', title: `Title ${id}`, detail });

const none = { notified: new Set<string>(), open: new Set<string>() };

/** Every request seen / none seen: the two global answers the old boolean could give. */
const seenAll = (): boolean => true;
const seenNone = (): boolean => false;

describe('planAttention', () => {
  it('notifies each request once while it is not seen, and the badge counts them', () => {
    const plan = planAttention(none, [request('a'), request('b')], seenNone);
    expect(plan.notify.map((r) => r.id)).toEqual(['a', 'b']);
    expect(plan.close).toEqual([]);
    expect(plan.badge).toBe(2);
  });

  it('does not notify again an id that was notified, even after it stopped being open', () => {
    const plan = planAttention(
      { notified: new Set(['a']), open: new Set() },
      [request('a')],
      seenNone,
    );
    expect(plan.notify).toEqual([]);
    expect(plan.badge).toBe(1);
  });

  it('never notifies a request that is seen, but still counts it in the badge', () => {
    const plan = planAttention(none, [request('a')], seenAll);
    expect(plan.notify).toEqual([]);
    expect(plan.badge).toBe(1);
  });

  it('closes every open notification whose request becomes seen', () => {
    const plan = planAttention(
      { notified: new Set(['a', 'b']), open: new Set(['a', 'b']) },
      [request('a'), request('b')],
      seenAll,
    );
    expect(plan.close).toEqual([
      { id: 'a', why: 'visible' },
      { id: 'b', why: 'visible' },
    ]);
  });

  it('decides per request: only the toast whose card is seen closes, the others stay open', () => {
    const plan = planAttention(
      { notified: new Set(['a', 'b']), open: new Set(['a', 'b']) },
      [request('a'), request('b')],
      (r) => r.id === 'b',
    );
    expect(plan.close).toEqual([{ id: 'b', why: 'visible' }]);
    expect(plan.notify).toEqual([]);
  });

  it('notifies the request of a hidden chat while another request is seen', () => {
    const plan = planAttention(none, [request('a'), request('b')], (r) => r.id === 'a');
    expect(plan.notify.map((r) => r.id)).toEqual(['b']);
    expect(plan.badge).toBe(2);
  });

  it('closes a notification whose request is resolved, and says so', () => {
    const plan = planAttention(
      { notified: new Set(['a', 'b']), open: new Set(['a', 'b']) },
      [request('b')],
      seenNone,
    );
    expect(plan.close).toEqual([{ id: 'a', why: 'resolved' }]);
    expect(plan.badge).toBe(1);
  });

  it('prefers resolved over visible when both apply', () => {
    const plan = planAttention({ notified: new Set(['a']), open: new Set(['a']) }, [], seenAll);
    expect(plan.close).toEqual([{ id: 'a', why: 'resolved' }]);
  });

  it('caps the open notifications at three and leaves the rest for the badge', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => request(id));
    const plan = planAttention(none, many, seenNone);
    expect(MAX_OPEN_NOTIFICATIONS).toBe(3);
    expect(plan.notify.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(plan.badge).toBe(5);
  });

  it('counts the slots after the closes, and notifies a queued request when one frees up', () => {
    const state = { notified: new Set(['a', 'b', 'c']), open: new Set(['a', 'b', 'c']) };
    const plan = planAttention(
      state,
      [request('b'), request('c'), request('d'), request('e')],
      seenNone,
    );
    expect(plan.close).toEqual([{ id: 'a', why: 'resolved' }]);
    expect(plan.notify.map((r) => r.id)).toEqual(['d']);
  });

  it('counts the slots after the closes of requests that became seen', () => {
    const state = { notified: new Set(['a', 'b', 'c']), open: new Set(['a', 'b', 'c']) };
    const plan = planAttention(
      state,
      [request('a'), request('b'), request('c'), request('d')],
      (r) => r.id === 'a',
    );
    expect(plan.close).toEqual([{ id: 'a', why: 'visible' }]);
    expect(plan.notify.map((r) => r.id)).toEqual(['d']);
  });

  it('honours a custom maximum', () => {
    const plan = planAttention(none, [request('a'), request('b')], seenNone, 1);
    expect(plan.notify.map((r) => r.id)).toEqual(['a']);
  });

  it('does not mutate the state it is given', () => {
    const state = { notified: new Set(['a']), open: new Set(['a']) };
    planAttention(state, [], seenAll);
    expect([...state.notified]).toEqual(['a']);
    expect([...state.open]).toEqual(['a']);
  });
});

/** Extracts the decoded JSON argument of the `command:` link whose label is `label`. */
function argumentOf(message: string, label: string): { command: string; argument: unknown } {
  const match = new RegExp(`\\[${label}\\]\\(command:([^?]+)\\?([^)]*)\\)`).exec(message);
  if (match?.[1] === undefined || match[2] === undefined) throw new Error(`no link ${label}`);
  return { command: match[1], argument: JSON.parse(decodeURIComponent(match[2])) as unknown };
}

describe('notificationMessage', () => {
  it('offers Open chat, Allow once and Reject for a permission, with the exact arguments', () => {
    const message = notificationMessage(request('per_1'));
    expect(argumentOf(message, 'Open chat')).toEqual({
      command: SHOW_REQUEST_COMMAND_ID,
      argument: { sessionID: 'ses_1', id: 'per_1', kind: 'permission' },
    });
    expect(argumentOf(message, 'Allow once')).toEqual({
      command: REPLY_PERMISSION_COMMAND_ID,
      argument: { sessionID: 'ses_1', permissionID: 'per_1', decision: 'once' },
    });
    expect(argumentOf(message, 'Reject')).toEqual({
      command: REPLY_PERMISSION_COMMAND_ID,
      argument: { sessionID: 'ses_1', permissionID: 'per_1', decision: 'reject' },
    });
  });

  it('offers only Open chat for a form, and never Always', () => {
    const message = notificationMessage(request('frm_1', 'form'));
    expect(message).toContain('[Open chat]');
    expect(message).not.toContain('Allow once');
    expect(message).not.toContain('Reject');
    expect(message).not.toMatch(/always/i);
  });

  it('a bracket or parenthesis in the detail does not break or forge a link', () => {
    const hostile = 'x](command:workbench.action.reloadWindow) [click';
    const message = notificationMessage(request('per_1', 'permission', hostile));
    // Every link target in the message is one of ours.
    const targets = [...message.matchAll(/\]\(command:([^?)]+)/g)].map((m) => m[1]);
    expect(
      targets.every((t) => t === SHOW_REQUEST_COMMAND_ID || t === REPLY_PERMISSION_COMMAND_ID),
    ).toBe(true);
    // The hostile brackets and parentheses are gone; no backslash escapes are added.
    expect(message).toContain('xcommand:workbench.action.reloadWindow click');
    expect(message).not.toContain('\\');
  });

  it('a hostile server title cannot forge a link in the notification title either', () => {
    const forged = {
      ...request('frm_1', 'form'),
      title: '[Continue](command:evil.command?%5B%5D)',
    };
    const title = notificationTitle(forged);
    expect(title).toBe('OpenCode: Continuecommand:evil.command?%5B%5D');
    expect(`${title}: ${notificationMessage(forged)}`).not.toMatch(/\[[^\]]*\]\(command:evil/);
  });

  it('a quote, an ampersand or a parenthesis in the ids survives the URL encoding', () => {
    const odd: PendingSummary = { ...request('per_"1&2)('), sessionID: 'ses 1' };
    expect(argumentOf(notificationMessage(odd), 'Allow once').argument).toMatchObject({
      permissionID: 'per_"1&2)(',
      sessionID: 'ses 1',
    });
  });
});

describe('notificationTitle and sanitizeLinkText', () => {
  it('prefixes the product name', () => {
    expect(notificationTitle(request('a'))).toBe('OpenCode: Title a');
  });

  it('names the chat the request belongs to when given a label (decision Q2=1)', () => {
    expect(notificationTitle(request('a'), 'Fix the build')).toBe(
      'OpenCode · Fix the build: Title a',
    );
  });

  it('reads "Untitled session" for an empty label', () => {
    expect(notificationTitle(request('a'), '')).toBe('OpenCode · Untitled session: Title a');
    expect(notificationTitle(request('a'), '  \n ')).toBe('OpenCode · Untitled session: Title a');
  });

  it('strips link characters from the label, collapses whitespace and cuts it', () => {
    expect(notificationTitle(request('a'), '[x](command:evil)\nnext')).toBe(
      'OpenCode · xcommand:evil next: Title a',
    );
    const long = notificationTitle(request('a'), 'w'.repeat(100));
    expect(long).toBe(`OpenCode · ${'w'.repeat(MAX_LABEL_LENGTH - 1)}…: Title a`);
  });

  it('removes only the characters that build a link, keeping the rest as it is', () => {
    expect(sanitizeLinkText('my_file.ts *c* [d](e) `f`')).toBe('my_file.ts *c* de `f`');
  });
});
