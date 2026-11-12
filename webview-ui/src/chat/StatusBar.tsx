import * as l10n from '@vscode/l10n';
import { plural } from '../../../src/shared/l10n';
import { createEffect, createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js';
import type { Activity, TurnLine } from '../store/activity';
import type { ChatState } from '../store/chatStore';
import { formatElapsed } from '../subagents/subagentView';
import { describeConnection } from './connectionView';
import { StopIcon } from './icons';

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
 *
 * Issue #188 (phase 3) turns the activity line into the FOOTER of a running turn: spinner, the
 * `turn` label (a running tool reads "Editing src/a.ts", see `describeTurn`), "Step N", "N
 * subagents running" from one on, the elapsed `m:ss` and the ONE Stop button of the panel (the
 * composer no longer has one; Escape in the prompt box still stops). The clock is a 1 s interval
 * that exists only while a turn runs with a `since`; the time is `aria-hidden` and the footer is
 * NOT a live region, so a screen reader is not interrupted every second (the end of the turn is
 * already announced by `announcement`). With no `since` no clock is drawn. Stop is drawn only
 * while the line is (a busy session with the connection `offline`/`unavailable` has none).
 * VERIFIED in jsdom by `App.test.tsx` (the footer text, the single "Stop" button and its click,
 * the step, the subagent count and the clock after fake timers advance). VERIFIED in a real VS Code
 * (Windows 11, VS Code 1.146.0, 12/11/2026) by `test:visual` step 54: "T4 the clock advances", "T4
 * exactly one Stop, in the activity footer and not in the composer" and "T4 the footer names a verb
 * and its target and the step"; and by step 55: "W1 at 300 px the tabs, the chip, the footer and
 * the buttons fit the document with no style attribute". UNVERIFIED in a real window: the
 * "N subagents running" text.
 */
export function StatusBar(props: {
  state: ChatState;
  activity: Activity;
  /** The footer text of the running turn (issue #188); defaults to the activity's own label. */
  turn?: TurnLine;
  /** Epoch ms the turn started (the server's, or when this document first saw it busy); none hides the clock. */
  since?: number;
  /** Subagents of the open session that are running; the footer says so from one on. */
  subagentsRunning?: number;
  announcement: string;
  canRetry: boolean;
  onRetry(): void;
  /** The ONE Stop button of the panel lives in the footer of a running turn (issue #188). */
  onStop(): void;
  onDismiss(id: number): void;
}) {
  const connection = () => props.state.connection;
  const isWorking = () =>
    props.activity.kind !== 'idle' &&
    props.activity.kind !== 'offline' &&
    props.activity.kind !== 'error';
  // The elapsed time moves once a second, and only while there is a turn to time: the interval is
  // created and cleared by the effect, so an idle chat has no timer.
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (!isWorking() || props.since === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    onCleanup(() => {
      clearInterval(timer);
    });
  });
  return (
    <div class="status-bar">
      <div class="connection-status visually-hidden" role="status" data-state={connection().state}>
        {describeConnection(connection())}
      </div>

      <Switch>
        <Match when={props.activity.kind === 'error'}>
          <div class="alert alert-error" role="alert">
            <span class="alert-text">
              {props.activity.error
                ? l10n.t(
                    'Error ({0}): {1}',
                    props.activity.error.code,
                    props.activity.error.message,
                  )
                : l10n.t('Error: {0}', '')}
              {/* no error object: the sentence stays "Error: " as before */}
            </span>
            <Show when={props.canRetry}>
              <button type="button" class="secondary" onClick={() => props.onRetry()}>
                {l10n.t('Retry')}
              </button>
            </Show>
          </div>
        </Match>
        <Match when={isWorking()}>
          <div class="activity" data-kind={props.activity.kind}>
            <span class="spinner" aria-hidden="true" />
            <span class="activity-label">{props.turn?.label ?? props.activity.label}</span>
            <Show when={props.turn?.step}>
              {(step) => <span class="activity-meta">{l10n.t('Step {0}', step())}</span>}
            </Show>
            <Show when={(props.subagentsRunning ?? 0) > 0}>
              <span class="activity-meta">
                {plural(
                  props.subagentsRunning ?? 0,
                  l10n.t('{0} subagent running', props.subagentsRunning ?? 0),
                  l10n.t('{0} subagents running', props.subagentsRunning ?? 0),
                )}
              </span>
            </Show>
            <Show when={props.since}>
              {(since) => (
                <span class="activity-meta activity-time" aria-hidden="true">
                  {formatElapsed(now() - since())}
                </span>
              )}
            </Show>
            <button
              type="button"
              class="secondary stop-button"
              aria-label={l10n.t('Stop')}
              title={l10n.t('Stop')}
              onClick={() => {
                props.onStop();
              }}
            >
              <StopIcon />
            </button>
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
              {notice.level === 'error'
                ? l10n.t('Error: {0}', notice.error.message)
                : notice.error.message}
            </span>
            <button
              type="button"
              class="secondary"
              aria-label={l10n.t('Dismiss notice')}
              onClick={() => props.onDismiss(notice.id)}
            >
              {l10n.t('Dismiss')}
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
