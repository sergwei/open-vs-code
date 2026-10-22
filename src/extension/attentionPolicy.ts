// Pure decisions of the "attention" feature (issue #19): what to notify, what to close and what
// number the badge shows when requests arrive while the chat view is not visible. The VS Code side
// (`attention.ts`) only executes the plan this module returns, so the rules are testable without
// a window. No `vscode` import.

import { REPLY_PERMISSION_COMMAND_ID, SHOW_REQUEST_COMMAND_ID } from './ids';
import type { PendingSummary } from './pendingRequests';

/**
 * Most notifications open at once. Our own choice (anti-spam): a subagent swarm asking for
 * permission must not bury the editor in toasts. The rest only count in the badge, and are
 * notified later if a slot frees up while the view is still hidden.
 */
export const MAX_OPEN_NOTIFICATIONS = 3;

/** Why a notification is closed by us (the user hiding it is `cancelled`, decided by the adapter). */
export type CloseReason = 'resolved' | 'visible';

/** What the adapter remembers between two plans. */
export type AttentionState = {
  /** Ids already notified at some point (open or not): never notified a second time. */
  notified: ReadonlySet<string>;
  /** Ids whose notification is open right now. */
  open: ReadonlySet<string>;
};

/** What the adapter must do now. */
export type AttentionPlan = {
  notify: PendingSummary[];
  close: { id: string; why: CloseReason }[];
  /** Total pending requests: the number on the Activity Bar icon. */
  badge: number;
};

/**
 * Decides the notifications for the current set of pending requests.
 *
 * Rules: an open notification is closed when its request is gone (`resolved`, whoever answered
 * it, including the cascade of a `reject`) or when the view is visible (`visible`: the card is
 * right there); a request is notified once per id, only while the view is hidden and only while
 * fewer than `maxOpen` notifications are open (counted AFTER the closes); the badge is always the
 * total, visible or not, so a queued request is never invisible. Pure: it mutates nothing, the
 * adapter updates its sets from the plan. VERIFIED by `attentionPolicy.test.ts` (fabricated
 * requests, logic only).
 */
export function planAttention(
  state: AttentionState,
  requests: readonly PendingSummary[],
  viewVisible: boolean,
  maxOpen: number = MAX_OPEN_NOTIFICATIONS,
): AttentionPlan {
  const pendingIds = new Set(requests.map((request) => request.id));
  const close: AttentionPlan['close'] = [];
  for (const id of state.open) {
    if (!pendingIds.has(id)) close.push({ id, why: 'resolved' });
    else if (viewVisible) close.push({ id, why: 'visible' });
  }
  const stillOpen = state.open.size - close.length;
  const notify: PendingSummary[] = [];
  if (!viewVisible) {
    let slots = maxOpen - stillOpen;
    for (const request of requests) {
      if (slots <= 0) break;
      if (state.notified.has(request.id)) continue;
      notify.push(request);
      slots -= 1;
    }
  }
  return { notify, close, badge: requests.length };
}

/**
 * Removes `[`, `]`, `(` and `)` from text that comes from the server or a file name, so it cannot
 * close or open a link in a notification. Applied to the title and to the detail; the links we
 * build ourselves are added afterwards, untouched.
 *
 * Why remove instead of escaping with a backslash: VERIFIED by reading the VS Code 1.142 bundle
 * (the `workbench.desktop.main.js` of the downloaded build, review of 20/10/2026) that the
 * notification does NOT parse Markdown: it links text with the pattern
 * `[label](https?:|command:|file:target)` and shows every other character as is, so a `\` would
 * be printed and the escape would work only by accident of breaking that pattern. Also read
 * there: the message is built as `title: message`.
 * HYPOTHESIS that the same holds in other VS Code versions (1.105 is the minimum supported); to
 * check, repeat the read on that bundle or watch a notification with brackets in F5 point 4.
 */
export function sanitizeLinkText(text: string): string {
  return text.replace(/[[\]()]/g, '');
}

/**
 * Builds a `command:` link whose single JSON argument is URL-encoded, as VS Code expects.
 * `encodeURIComponent` leaves `(` and `)` alone, and a `)` inside the target would end the
 * Markdown link early, so those two are encoded by hand.
 */
function commandLink(label: string, command: string, argument: object): string {
  const encoded = encodeURIComponent(JSON.stringify(argument))
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
  return `[${label}](command:${command}?${encoded})`;
}

/**
 * Heading of the notification (the `title` of `withProgress`): what is being asked, in one line.
 * The title can carry server text (a form title, an action name), hence {@link sanitizeLinkText}.
 */
export function notificationTitle(summary: PendingSummary): string {
  return `OpenCode: ${sanitizeLinkText(summary.title)}`;
}

/**
 * Body of the notification, in Markdown: the detail, then the action links. A permission offers
 * "Open chat", "Allow once" and "Reject"; a form only "Open chat" (answering needs the card). There
 * is no "Always" on purpose: it stores a rule for the whole project and must be read before
 * pressing, which a toast does not allow.
 *
 * The links are `command:` URIs to commands that are registered but NOT contributed. HYPOTHESIS
 * (read in a 2022 blog, not in the docs): that a `withProgress` notification renders and runs such
 * links on VS Code 1.105+; the backup plan is `showWarningMessage` with buttons. To check: F5 point
 * 4 of the plan. The `decision` in the reply link is fixed here, but the handler validates it again
 * because anyone can run a command with arbitrary arguments.
 */
export function notificationMessage(summary: PendingSummary): string {
  const target = { sessionID: summary.sessionID, id: summary.id, kind: summary.kind };
  const links = [commandLink('Open chat', SHOW_REQUEST_COMMAND_ID, target)];
  if (summary.kind === 'permission') {
    const reply = (decision: 'once' | 'reject') => ({
      sessionID: summary.sessionID,
      permissionID: summary.id,
      decision,
    });
    links.push(
      commandLink('Allow once', REPLY_PERMISSION_COMMAND_ID, reply('once')),
      commandLink('Reject', REPLY_PERMISSION_COMMAND_ID, reply('reject')),
    );
  }
  const detail = summary.detail === '' ? '' : `${sanitizeLinkText(summary.detail)} — `;
  return `${detail}${links.join(' · ')}`;
}
