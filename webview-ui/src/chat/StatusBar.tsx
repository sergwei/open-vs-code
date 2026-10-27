import { For, Match, Show, Switch } from 'solid-js';
import type { Activity } from '../store/activity';
import type { ChatState } from '../store/chatStore';
import { describeConnection } from './connectionView';

/**
 * The strip between the conversation and the input (issues #16/#17): what the assistant is doing,
 * the error of the session with Retry, dismissible notices and the live regions for screen readers.
 *
 * E2 (issue #85, P10=1) removed the visible connection line and its Restart server / Show logs
 * buttons (issue #10): the failure now has its own error card in the conversation and the setup
 * guide (`ConnectionCard`, `SetupGuide`), and the connection dot lives in the chip
 * (`AgentModelMenu`). What stays is a visually hidden `role="status"` with the connection text (`.connection-status`),
 * so a screen reader still hears the changes, next to the turn announcement. The `alert` and
 * the notices share their row with a button only when both fit: the CSS wraps them (bug #1294).
 * The "Waiting for permission" lines
 * of phase 1 are gone: the `RequestDock` shows the requests. The activity spinner is CSS and
 * turns into a static "…" under reduced motion. Errors (`role="alert"`) interrupt a screen
 * reader, so only errors use it; info and warnings are plain text. `announcement` is computed by
 * the parent, which knows about the turn closing, and is rendered in a visually hidden
 * `aria-live="polite"` region.
 *
 * An error of the SESSION STATUS is always the red alert with its code and text and, when there
 * is a prompt to resend, a Retry; there is no neutral "Stopped" here. The neutral "Stopped" note
 * exists only for a stopped step inside a message (`MessageList.tsx`, `isStopError`): a status
 * `aborted` can also be a system failure ("interrupted repeatedly") and must not look like a
 * user action (decision of Sergio, 20/10/2026).
 * VERIFIED by `App.test.tsx` in jsdom; the visual result and a real screen reader are UNVERIFIED
 * (F5 points 8, 10 and 6).
 */
export function StatusBar(props: {
  state: ChatState;
  activity: Activity;
  announcement: string;
  canRetry: boolean;
  onRetry(): void;
  onDismiss(id: number): void;
}) {
  const connection = () => props.state.connection;
  const isWorking = () =>
    props.activity.kind !== 'idle' &&
    props.activity.kind !== 'offline' &&
    props.activity.kind !== 'error';
  return (
    <div class="status-bar">
      <div class="connection-status visually-hidden" role="status" data-state={connection().state}>
        {describeConnection(connection())}
      </div>

      <Switch>
        <Match when={props.activity.kind === 'error'}>
          <div class="alert alert-error" role="alert">
            <span class="alert-text">
              Error{props.activity.error ? ` (${props.activity.error.code})` : ''}:{' '}
              {props.activity.error?.message}
            </span>
            <Show when={props.canRetry}>
              <button type="button" class="secondary" onClick={() => props.onRetry()}>
                Retry
              </button>
            </Show>
          </div>
        </Match>
        <Match when={isWorking()}>
          <div class="activity" data-kind={props.activity.kind}>
            <span class="spinner" aria-hidden="true" />
            <span>{props.activity.label}</span>
          </div>
        </Match>
      </Switch>

      <For each={props.state.notices}>
        {(notice) => (
          <div
            class="alert"
            classList={{
              'alert-error': notice.level === 'error',
              'alert-warning': notice.level === 'warning',
            }}
            role={notice.level === 'error' ? 'alert' : undefined}
          >
            <span class="alert-text">
              {notice.level === 'error' ? 'Error: ' : ''}
              {notice.error.message}
            </span>
            <button
              type="button"
              class="secondary"
              aria-label="Dismiss notice"
              onClick={() => props.onDismiss(notice.id)}
            >
              Dismiss
            </button>
          </div>
        )}
      </For>

      <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {props.announcement}
      </div>
    </div>
  );
}
