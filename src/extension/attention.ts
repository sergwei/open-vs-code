import * as vscode from 'vscode';
import {
  MAX_OPEN_NOTIFICATIONS,
  notificationMessage,
  notificationTitle,
  planAttention,
} from './attentionPolicy';
import type { ServerLog } from './opencodeServer';
import type { PendingSummary } from './pendingRequests';

/** What the attention feature needs from the chat view provider. */
export interface AttentionTarget {
  setBadge(count: number): void;
  readonly visible: boolean;
}

/** Why a notification closed; `cancelled` is the user pressing its Cancel button. */
type ClosedBy = 'resolved' | 'visible' | 'cancelled' | 'disposed';

/** The feature as the lifecycle uses it. */
export interface Attention {
  /** The set of pending requests changed (also called with `[]` when the server goes away). */
  update(requests: readonly PendingSummary[]): void;
  /** The chat view was shown or hidden. */
  onVisibility(visible: boolean): void;
  /** Closes every notification and clears the badge; call it on deactivation. */
  dispose(): void;
}

/**
 * VS Code side of issue #19: the Activity Bar badge and one auto-closing notification per request
 * that arrives while the chat view is hidden. WHAT to show comes from `planAttention`
 * (`attentionPolicy.ts`); this module only executes the plan.
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
 * for the badge and the open/close log lines, not for how the toast looks.
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
          title: notificationTitle(summary),
          cancellable: true,
        },
        (progress, token) => {
          progress.report({ message: notificationMessage(summary) });
          token.onCancellationRequested(() => {
            close(summary.id, 'cancelled');
            replan(target.visible); // a slot freed: a queued request may take it
          });
          return done;
        },
      ),
    ).catch((error: unknown) => {
      log.debug(`attention notification failed: ${String(error)}`);
    });
  };

  /** Applies the plan for the current requests and visibility. */
  const replan = (visible: boolean): void => {
    if (disposed) return;
    const plan = planAttention({ notified, open: new Set(open.keys()) }, latest, visible, maxOpen);
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
      replan(target.visible);
    },
    onVisibility(visible) {
      replan(visible);
    },
    dispose() {
      if (disposed) return;
      for (const id of [...open.keys()]) close(id, 'disposed');
      disposed = true;
      target.setBadge(0);
    },
  };
}
