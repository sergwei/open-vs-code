import { createSignal, createUniqueId, For, Show } from 'solid-js';
import type { ErrorInfo, PermissionAsk, PermissionDecision } from '../../../src/shared/model';
import { useSend } from '../chat/hostContext';
import { nextRequestId } from '../chat/PromptInput';
import { actionLabel, describeSave, previewResources } from './permissionText';

/** Where a request from another session came from; `onOpen` is set only for a top-level session. */
export interface RequestOrigin {
  title: string;
  onOpen?(): void;
}

/**
 * Card of one pending permission request (issue #18): what the agent wants to do, in plain
 * language, and the buttons to answer it with mouse or keyboard.
 *
 * Shows the action, the resources (up to five and "N more"), the server's `message` if any, the
 * tool that asked (`toolName`, only known for the open session) and, for a request of another
 * session (a subagent), that session's title with an "Open session" button when it can be opened.
 * Buttons: **Allow once**, **Always allow** (only when `save` is not empty: opencode treats an
 * "always" without `save` as "once", read in `permission.ts@v2.0.32`), **Reject** and **Reject with
 * feedback…** (a textarea whose text goes as `message`, so the model keeps working with the
 * correction instead of stopping on a bare rejection).
 *
 * "Always allow" is two steps on purpose: the first press shows what would be stored (`save`) and
 * that it persists for the PROJECT, across sessions and restarts; a broad rule (`*`, `dir/*`) adds
 * a warning that opencode will stop asking about everything of that action. Only the second press
 * sends `always`. The same panel has a "Manage saved permissions" button (`permissions.manage`,
 * served by the host with the QuickPick that revokes rules), so the way back from an "Always" is
 * not only the palette command; it stays enabled while an answer is in flight, since it answers
 * nothing. Reject says it also rejects the other pending requests of the session when there
 * are (`sameSessionCount` > 1), because the server does. While `replying` every button is locked
 * and the card says "Sending…"; `error` (the server's answer to a failed reply) is shown with
 * `role="alert"`. Escape asks the dock to move the focus back to the prompt (`onEscape`): it must
 * NOT reject, because a reject cascades to every request of the session.
 *
 * Accessibility: a `section` with `role="group"` named by its heading and described by its body,
 * focusable by code (`tabindex="-1"`) so `ui.focus` can bring a screen reader to it. VERIFIED by
 * `PermissionCard.test.tsx` in jsdom (messages, locking, wording); the look, the focus order and
 * a real screen reader are UNVERIFIED (F5 points 1, 5, 6).
 */
export function PermissionCard(props: {
  ask: PermissionAsk;
  sameSessionCount: number;
  toolName?: string;
  origin?: RequestOrigin;
  replying: boolean;
  error?: ErrorInfo;
  onSent(requestId: string): void;
  onEscape(): void;
}) {
  const send = useSend();
  const titleId = createUniqueId();
  const bodyId = createUniqueId();
  const [showFeedback, setShowFeedback] = createSignal(false);
  const [feedback, setFeedback] = createSignal('');
  const [confirmingAlways, setConfirmingAlways] = createSignal(false);

  const preview = () => previewResources(props.ask.resources);
  const saved = () => describeSave(props.ask.save, props.ask.action);
  const canAlways = () => props.ask.save.length > 0;
  const othersRejected = () => Math.max(0, props.sameSessionCount - 1);
  /** The warning that Reject takes the other pending requests of the session with it. */
  const cascadeText = () =>
    `Rejecting also rejects the ${String(othersRejected())} other pending request${othersRejected() === 1 ? '' : 's'} of this session.`;

  /** Sends the decision and marks the card as waiting for the server. */
  const answer = (decision: PermissionDecision, message?: string): void => {
    const requestId = nextRequestId();
    props.onSent(requestId);
    send({
      type: 'permission.reply',
      requestId,
      sessionID: props.ask.sessionID,
      permissionID: props.ask.id,
      decision,
      ...(message === undefined || message.trim() === '' ? {} : { message }),
    });
  };

  return (
    <section
      class="request-card permission-card"
      role="group"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-request-id={props.ask.id}
      data-request-kind="permission"
      tabindex="-1"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          props.onEscape();
        }
      }}
    >
      <h2 class="request-title" id={titleId}>
        Permission needed: {actionLabel(props.ask.action)}
      </h2>
      <div class="request-body" id={bodyId}>
        <Show when={props.origin}>
          {(origin) => (
            <p class="request-origin">
              From session “{origin().title}”
              <Show when={origin().onOpen !== undefined}>
                <button type="button" class="secondary" onClick={() => origin().onOpen?.()}>
                  Open session
                </button>
              </Show>
            </p>
          )}
        </Show>
        <Show when={props.toolName}>
          <p class="request-tool">
            Requested by the <code>{props.toolName}</code> tool
          </p>
        </Show>
        <Show when={props.ask.message}>
          <p class="request-message">{props.ask.message}</p>
        </Show>
        <ul class="request-resources" aria-label="Resources">
          <For each={preview().shown}>
            {(resource) => (
              <li>
                <code>{resource}</code>
              </li>
            )}
          </For>
          <Show when={preview().more > 0}>
            <li class="request-more">+{preview().more} more</li>
          </Show>
        </ul>
      </div>

      <Show when={confirmingAlways()}>
        <div class="request-always" role="group" aria-label="Always allow">
          <p>
            This saves {saved().rules.length === 1 ? 'this rule' : 'these rules'} for this project.
            It applies to every session and survives restarts; revoke it later with “OpenCode:
            Manage Saved Permissions”.
          </p>
          <ul>
            <For each={saved().rules}>
              {(rule) => (
                <li>
                  <code>{rule}</code>
                </li>
              )}
            </For>
          </ul>
          <Show when={saved().broad}>
            <p class="request-warning">
              Careful: this rule is broad. opencode will stop asking about ALL of it, for example
              “Read: *” lets it read any file of the project, <code>.env</code> files included.
            </p>
          </Show>
          <div class="request-actions">
            <button
              type="button"
              class="primary"
              disabled={props.replying}
              onClick={() => {
                answer('always');
              }}
            >
              Yes, always allow
            </button>
            <button
              type="button"
              class="secondary"
              disabled={props.replying}
              onClick={() => setConfirmingAlways(false)}
            >
              Back
            </button>
            <button
              type="button"
              class="secondary"
              onClick={() => {
                send({ type: 'permissions.manage' });
              }}
            >
              Manage saved permissions
            </button>
          </div>
        </div>
      </Show>

      <Show when={showFeedback()}>
        <div class="request-feedback">
          <label>
            Tell the agent what to do instead
            <textarea
              rows={2}
              value={feedback()}
              disabled={props.replying}
              onInput={(event) => setFeedback(event.currentTarget.value)}
            />
          </label>
          <button
            type="button"
            class="secondary"
            disabled={props.replying}
            onClick={() => {
              answer('reject', feedback());
            }}
          >
            Reject with this feedback
          </button>
        </div>
      </Show>

      <div class="request-actions">
        {/* While the "Always" confirmation is open its "Yes, always allow" is the one primary
            button; two primaries at once hid which one was the decision (CDP run, 20/10/2026). */}
        <button
          type="button"
          classList={{ primary: !confirmingAlways(), secondary: confirmingAlways() }}
          disabled={props.replying}
          onClick={() => {
            answer('once');
          }}
        >
          Allow once
        </button>
        <Show when={canAlways()}>
          <button
            type="button"
            class="secondary"
            disabled={props.replying}
            aria-expanded={confirmingAlways()}
            onClick={() => setConfirmingAlways((current) => !current)}
          >
            Always allow…
          </button>
        </Show>
        <button
          type="button"
          class="secondary"
          disabled={props.replying}
          aria-describedby={othersRejected() > 0 ? `${bodyId}-cascade` : undefined}
          onClick={() => {
            answer('reject');
          }}
        >
          Reject
        </button>
        <button
          type="button"
          class="secondary"
          disabled={props.replying}
          aria-expanded={showFeedback()}
          onClick={() => setShowFeedback((current) => !current)}
        >
          Reject with feedback…
        </button>
      </div>
      <Show when={othersRejected() > 0}>
        <p class="request-hint" id={`${bodyId}-cascade`}>
          {cascadeText()}
        </p>
      </Show>
      <Show when={props.replying}>
        <p class="request-hint" role="status">
          Sending…
        </p>
      </Show>
      <Show when={props.error}>
        {(error) => (
          <p class="request-error" role="alert">
            {error().message}
          </p>
        )}
      </Show>
    </section>
  );
}
