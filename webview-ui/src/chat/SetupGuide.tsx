import { For, Show } from 'solid-js';
import type { Catalog } from '../../../src/shared/model';
import type { ConnectionState } from '../../../src/shared/protocol';
import type { BinaryChoice } from '../store/chatStore';
import { guideSteps, type StepStatus } from './connectionView';
import { useSend } from './hostContext';
import { CheckIcon, CrossIcon, WaitingIcon } from './icons';

/** The word that says the state of a step, so it never depends on colour or icon alone. */
const STATUS_TEXT: Record<StepStatus, string> = {
  waiting: 'Waiting',
  running: 'In progress',
  done: 'Done',
  failed: 'Failed',
  checking: 'Checking…',
};

/**
 * The "Set up opencode" guide (E2, issue #85, decisions P1/P2/P14): when the server cannot start
 * and there is no conversation yet, it replaces the whole view (no header, no prompt box) with the
 * numbered steps binary, server and model (or "Connect to the server…" when the server is
 * external), says what was searched at the failing step and offers its buttons; "Show logs" closes
 * the guide as a link. `App` decides when it is shown (`nextGuideLatch`) and what each step says
 * comes from the pure `guideSteps`.
 *
 * Accessibility: an `h2`, an ordered list, and every step states its status in WORDS next to the
 * icon; the buttons sit BELOW the text of their step (never in the same row, bug #1294). A hidden
 * `role="status"` says "opencode is not available" when the guide appears. It never moves the
 * focus. Step 3 is informational (P2=1). The paths and details are plain text.
 * VERIFIED in jsdom by `SetupGuide.test.tsx`. VERIFIED in a real VS Code (Windows 11, `stable`
 * build, 27/10/2026, `npm run test:visual` step 0): "guide at 300 (bar 300 px), dark: the text
 * block is 85 % of the width" and the same at 900 px and 170 px in the four themes with contrast
 * >= 4.5, "guide at narrow (bar 170 px), dark: the buttons are below the text", and "Choose binary…
 * through the real file dialog wrote the setting and step 1 is done" (real mouse click, path typed
 * in the simple dialog). NOT observed: macOS and Linux, a screen reader, the dialog's filters on
 * a path without an extension.
 *
 * Issue #86: `binaryCheck` (the store's {@link BinaryChoice}) makes step 1 say "Checking…" with a
 * spinner while the detection judges the path just chosen, and the hidden region then says
 * "Checking the opencode binary…". A button whose action is `disabled` stays `aria-disabled`
 * (never `disabled`, so the focus it holds is not thrown to the body) and ignores the press.
 * Pressing "Choose binary…" first calls `onChoose` (the store moves to `choosing`), then sends the
 * message. VERIFIED on Windows 11, VS Code 1.144.0 (28/10/2026), full `npm run test:visual`: "ok
 * while the file dialog is open, Choose binary… is aria-disabled (not disabled) and step 1 still
 * says Failed", "ok   cancelling the file dialog gives Choose binary… back and step 1 stays
 * Failed" and, in the 4 themes at 300 px, "the hidden region announces the check and step 2 still
 * waits" and "title contrast 14.55 >= 4.5" (hc-light). NOT observed: a screen reader, 900 px and
 * 170 px widths in "Checking…", the contrast of the busy button (opacity 0.5).
 */
export function SetupGuide(props: {
  connection: ConnectionState;
  catalog: Catalog | undefined;
  binaryCheck?: BinaryChoice;
  onChoose?: () => void;
}) {
  const send = useSend();
  const steps = () =>
    guideSteps(props.connection, props.catalog, props.binaryCheck ?? { kind: 'idle' });
  const announcement = () =>
    props.binaryCheck?.kind === 'checking'
      ? 'Checking the opencode binary…'
      : props.connection.state === 'unavailable'
        ? 'opencode is not available'
        : '';
  return (
    <section class="setup-guide" aria-labelledby="setup-guide-title">
      <div class="visually-hidden" role="status">
        {announcement()}
      </div>
      <h2 id="setup-guide-title" class="setup-title">
        Set up opencode
      </h2>
      <p class="setup-subtitle">The chat needs a running opencode v2. One step is missing.</p>
      <ol class="setup-steps">
        <For each={steps()}>
          {(step, index) => (
            <li class="setup-step" data-step={step.id} data-status={step.status}>
              <span class="step-mark">
                <Show when={step.status === 'done'}>
                  <CheckIcon />
                </Show>
                <Show when={step.status === 'failed'}>
                  <CrossIcon />
                </Show>
                <Show when={step.status === 'waiting'}>
                  <WaitingIcon />
                </Show>
                <Show when={step.status === 'running' || step.status === 'checking'}>
                  <span class="spinner" aria-hidden="true" />
                </Show>
              </span>
              <div class="step-body">
                <p class="step-title">
                  {`${String(index() + 1)}. ${step.title}`}
                  <span class="step-status">{` — ${STATUS_TEXT[step.status]}`}</span>
                </p>
                <For each={step.lines}>{(line) => <p class="step-line">{line}</p>}</For>
                <Show when={step.actions.length > 0}>
                  <div class="step-actions">
                    <For each={step.actions}>
                      {(action) => (
                        <button
                          type="button"
                          class="secondary"
                          aria-disabled={action.disabled === true ? 'true' : undefined}
                          onClick={() => {
                            if (action.disabled === true) return;
                            if (
                              action.message.type === 'setup.action' &&
                              action.message.action === 'binary.choose'
                            ) {
                              props.onChoose?.();
                            }
                            send(action.message);
                          }}
                        >
                          {action.label}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </li>
          )}
        </For>
      </ol>
      <p class="setup-footer">
        <button
          type="button"
          class="link-button"
          onClick={() => {
            send({ type: 'logs.show' });
          }}
        >
          Show logs
        </button>
      </p>
    </section>
  );
}
