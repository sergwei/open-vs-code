import { For, Match, Show, Switch } from 'solid-js';
import type { ConnectionState } from '../../../src/shared/protocol';
import type { Activity } from '../store/activity';
import type { ChatState } from '../store/chatStore';
import { useSend } from './hostContext';

/** Short text of the connection to the host's opencode server. */
function describeConnection(connection: ConnectionState): string {
  switch (connection.state) {
    case 'starting':
      return 'Starting…';
    case 'connected':
      return 'Connected';
    case 'reconnecting':
      return `Reconnecting (${String(connection.attempt)})`;
    case 'unavailable':
      return `Unavailable: ${connection.error.message}`;
    case 'stopped':
      return 'Stopped';
  }
}

/**
 * The strip between the conversation and the input (issues #16/#17): connection, what the
 * assistant is doing, the error of the session with Retry, dismissible notices and the live
 * region for screen readers.
 *
 * The connection line is always there ("Connected" included) and is styled as a banner for every
 * other state. Phase 3 (issue #10) gives it buttons, through `useSend()` and the new protocol
 * messages `server.restart` and `logs.show`: `Unavailable` offers "Restart server" and "Show
 * logs" (it still adds the hint where the full log is), and `Reconnecting` offers "Show logs" (the
 * host is already retrying, so no restart there). Phase 2 had discarded those buttons because
 * they needed new messages; the plan of phase 3 reverses that. The "Waiting for permission" lines
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
  const send = useSend();
  const connection = () => props.state.connection;
  const isWorking = () =>
    props.activity.kind !== 'idle' &&
    props.activity.kind !== 'offline' &&
    props.activity.kind !== 'error';
  return (
    <div class="status-bar">
      <div class="connection-row">
        <div
          class="connection"
          classList={{ 'connection-problem': connection().state !== 'connected' }}
          role="status"
          data-state={connection().state}
        >
          {describeConnection(connection())}
          <Show when={connection().state === 'unavailable'}>
            <span class="connection-hint"> — see Output → OpenCode for details</span>
          </Show>
        </div>
        <Show when={connection().state === 'unavailable' || connection().state === 'reconnecting'}>
          <div class="connection-actions">
            <Show when={connection().state === 'unavailable'}>
              <button
                type="button"
                class="secondary"
                onClick={() => {
                  send({ type: 'server.restart' });
                }}
              >
                Restart server
              </button>
            </Show>
            <button
              type="button"
              class="secondary"
              onClick={() => {
                send({ type: 'logs.show' });
              }}
            >
              Show logs
            </button>
          </div>
        </Show>
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
