import * as vscode from 'vscode';
import {
  MAX_OPEN_NOTIFICATIONS,
  notificationMessage,
  notificationTitle,
  planAttention,
} from './attentionPolicy';
import type { ServerLog } from './opencodeServer';
import type { PendingSummary } from './pendingRequests';

/** What the attention feature needs from the chat surfaces. */
export interface AttentionTarget {
  setBadge(count: number): void;
  /**
   * Whether some surface that is being looked at shows the card of `request` right now (decision
   * Q1=2 of Sergio, 30/10/2026: a chat tab sees only while it is the ACTIVE editor, the side-bar
   * view while it is visible). Asked per request, every time the plan is computed.
   */
  seen(request: PendingSummary): boolean;
  /** The chat the request belongs to, for the title of its notification (`ChatController.labelOf`). */
  label(sessionID: string): string;
}

/** Why a notification closed; `cancelled` is the user pressing its Cancel button. */
type ClosedBy = 'resolved' | 'visible' | 'cancelled' | 'disposed';

/** The feature as the lifecycle uses it. */
export interface Attention {
  /** The set of pending requests changed (also called with `[]` when the server goes away). */
  update(requests: readonly PendingSummary[]): void;
  /**
   * What a surface shows changed (a tab became active or hidden, the view was shown, a tab opened
   * another session): asks `seen` again for every request and applies the new plan.
   */
  refresh(): void;
  /** Closes every notification and clears the badge; call it on deactivation. */
  dispose(): void;
}

/**
 * VS Code side of issue #19 and of E4 of #77: the Activity Bar badge and one auto-closing
 * notification per request that no looked-at surface shows. "Shows" is `target.seen(request)`,
 * asked per request, so with several chat tabs a request of a hidden tab is notified even while
 * another tab is in front. WHAT to show comes from `planAttention` (`attentionPolicy.ts`); this
 * module only executes the plan.
 *
 * Why `withProgress` and not `showWarningMessage`: a message box cannot be closed from code, so a
 * permission answered from the chat would leave a stale toast whose button then says "already
 * answered". A `Notification` progress is the one notification the API lets us dismiss, by
 * resolving the promise of its task. Its Cancel button only hides it (and the request is never
 * notified again, though it still counts in the badge). Cancel is the only dismiss VS Code gives
 * the user on such a toast, which is why it is enabled.
 * HYPOTHESIS: that links `command:` in the `message` of such a notification are rendered and
 * executed on VS Code 1.105+ (source: a 2022 blog post, not the docs) and that dismissing by
 * resolving works as described; neither has been run. Reinforced by reading the VS Code 1.142
 * bundle in the review (not executed): `withNotificationProgress` closes the notification
 * (`close()`) in the `finally` of the task's promise, builds the text as `title: message`, and
 * links `[label](command:...)` with its own pattern, not Markdown. Plan B written in the plan: switch to
 * `showWarningMessage` with buttons (it would not close itself). To check: F5 point 4.
 *
 * Log lines (stable, the integration test waits for them): `attention: badge <n>`,
 * `attention: notified <id>`, `attention: closed <id> (<resolved|visible|cancelled|disposed>)`.
 * Requests' resources and titles are never logged. Not unit-tested (it needs a window): the
 * decisions are, in `attentionPolicy.test.ts`; this is covered by the opt-in `realOpencode.test.ts`
 * for the badge and the open/close log lines, not for how the toast looks. The per-tab behaviour
 * (a request of a tab behind the active one is notified, one of the active tab is not, and "Open
 * chat" closes it as `visible`) is covered by `fakeServer.test.ts`, whose cases are named in the
 * header of `registerChat`.
 */
export function createAttention(deps: {
  target: AttentionTarget;
  log: ServerLog;
  maxOpen?: number;
}): Attention {
  const { target, log } = deps;
  const maxOpen = deps.maxOpen ?? MAX_OPEN_NOTIFICATIONS;
  const notified = new Set<string>();
  const open = new Map<string, (why: ClosedBy) => void>();
  let latest: readonly PendingSummary[] = [];
  let lastBadge = 0;
  let disposed = false;

  /** Closes the notification of `id`, if open; the progress task ends when its promise resolves. */
  const close = (id: string, why: ClosedBy): void => {
    const finish = open.get(id);
    if (finish === undefined) return;
    open.delete(id);
    log.info(`attention: closed ${id} (${why})`);
    finish(why);
  };

  /** Opens the notification of one request; it stays until `close` resolves its task. */
  const notify = (summary: PendingSummary): void => {
    notified.add(summary.id);
    let finish: (why: ClosedBy) => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finish = () => {
        resolve();
      };
    });
    open.set(summary.id, finish);
    log.info(`attention: notified ${summary.id}`);
    void Promise.resolve(
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: notificationTitle(summary, target.label(summary.sessionID)),
          cancellable: true,
        },
        (progress, token) => {
          progress.report({ message: notificationMessage(summary) });
          token.onCancellationRequested(() => {
            close(summary.id, 'cancelled');
            replan(); // a slot freed: a queued request may take it
          });
          return done;
        },
      ),
    ).catch((error: unknown) => {
      log.debug(`attention notification failed: ${String(error)}`);
    });
  };

  /** Applies the plan for the current requests, asking `target.seen` for each one. */
  const replan = (): void => {
    if (disposed) return;
    const plan = planAttention(
      { notified, open: new Set(open.keys()) },
      latest,
      (request) => target.seen(request),
      maxOpen,
    );
    if (plan.badge !== lastBadge) {
      lastBadge = plan.badge;
      log.info(`attention: badge ${String(plan.badge)}`);
    }
    target.setBadge(plan.badge);
    for (const { id, why } of plan.close) close(id, why);
    for (const summary of plan.notify) notify(summary);
    // Forget ids that are neither pending nor open: they can never come back (S1 of the review).
    const pendingIds = new Set(latest.map((request) => request.id));
    for (const id of notified) {
      if (!pendingIds.has(id) && !open.has(id)) notified.delete(id);
    }
  };

  return {
    update(requests) {
      latest = requests;
      replan();
    },
    refresh() {
      replan();
    },
    dispose() {
      if (disposed) return;
      for (const id of [...open.keys()]) close(id, 'disposed');
      disposed = true;
      target.setBadge(0);
    },
  };
}
