import { createEffect, For, onMount, Show, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import type {
  AuthAttemptView,
  ProviderRow,
  SettingsConnectionRow,
  SettingsMethodRow,
  SettingsWebviewToHost,
} from '../../../src/shared/settingsProtocol';
import { CheckIcon, WaitingIcon } from '../chat/icons';
import { FormFields } from './FormFields';
import { buildAnswer, initialValues, missingRequired } from './formWhen';
import type { SettingsUi } from './settingsUiState';

/** Sends one typed message to the host. */
export type SendSettings = (message: SettingsWebviewToHost) => void;

/** The label of the primary button of a method: what pressing it starts, by method type. */
export function primaryLabel(type: SettingsMethodRow['type']): string {
  if (type === 'key') return 'Enter API key…';
  if (type === 'oauth') return 'Sign in…';
  return 'Connect';
}

/** The short line under the name of a provider that is not connected yet. */
export function methodSummary(methods: readonly SettingsMethodRow[]): string {
  const first = methods[0];
  if (first === undefined) return 'Not available here';
  if (methods.length > 1) return `${String(methods.length)} ways to connect`;
  return first.type === 'key' ? 'API key' : first.label;
}

/** What a connection says about itself, as plain text. */
function connectionText(connection: SettingsConnectionRow): string {
  if (connection.kind === 'env') return `From ${connection.name}`;
  if (connection.method === 'key') return 'API key · saved by opencode for all projects';
  if (connection.method === 'oauth') return 'Signed in · saved by opencode for all projects';
  return 'External · saved by opencode for all projects';
}

/** The credential behind a connection, or `undefined` for an environment variable. */
function credentialOf(
  connection: SettingsConnectionRow,
): Extract<SettingsConnectionRow, { kind: 'credential' }> | undefined {
  return connection.kind === 'credential' ? connection : undefined;
}

/**
 * One way to connect a provider: its label, the fields of its form and the primary button.
 *
 * The primary button is "Enter API key…" for `key`, "Sign in…" for `oauth` and "Connect" for
 * `external`; it sends `settings.connect` with the answers of the VISIBLE fields (never a key: a
 * `key` method opens a native InputBox in the host). While a required visible field is empty, or
 * the host is busy with an attempt, the button is `aria-disabled` and ignores the press, never
 * `disabled`, so a focus it holds is not thrown to the body (solid-webview section 7). The typed
 * values live in a local store and are copied to `ui` for `setState`; the drafts of the several
 * methods of one provider are kept apart by the method index.
 */
function MethodPanel(props: {
  row: ProviderRow;
  method: SettingsMethodRow;
  /** Show the method's label (a provider with several methods needs it to tell them apart). */
  showLabel: boolean;
  busy: boolean;
  ui: SettingsUi;
  send: SendSettings;
  /** When set, a Cancel button joins the actions row (single-method providers). */
  onCancel: (() => void) | undefined;
}) {
  const draftKey = (key: string): string => `${String(props.method.index)}:${key}`;
  const saved: Record<string, string> = {};
  for (const field of props.method.fields) {
    const value = props.ui.draft(props.row.id)[draftKey(field.key)];
    if (value !== undefined) saved[field.key] = value;
  }
  const [values, setValues] = createStore<Record<string, string>>(
    initialValues(props.method.fields, saved),
  );
  const missing = () => missingRequired(props.method.fields, values);
  const blocked = () => props.busy || missing().length > 0;
  const hintId = `hint-${props.row.id}-${String(props.method.index)}`;
  return (
    <div class="settings-method" data-method={props.method.type}>
      <Show when={props.showLabel}>
        <p class="step-line settings-method-label">{props.method.label}</p>
      </Show>
      <Show
        when={props.method.supported}
        fallback={
          <p class="step-line">
            This method needs the opencode CLI: run opencode auth login in a terminal.
          </p>
        }
      >
        <FormFields
          fields={props.method.fields}
          values={values}
          idPrefix={`f-${props.row.id}-${String(props.method.index)}`}
          onInput={(key, value) => {
            setValues(key, value);
            props.ui.setDraft(props.row.id, draftKey(key), value);
          }}
        />
        <Show when={missing().length > 0}>
          <p class="settings-hint" id={hintId}>
            {`Fill in ${missing()
              .map((field) => field.title ?? field.key)
              .join(', ')} to continue.`}
          </p>
        </Show>
        <div class="step-actions">
          <button
            type="button"
            class="primary"
            aria-disabled={blocked() ? 'true' : undefined}
            aria-describedby={missing().length > 0 ? hintId : undefined}
            onClick={() => {
              if (blocked()) return;
              props.send({
                type: 'settings.connect',
                integrationID: props.row.id,
                method: props.method.index,
                answer: buildAnswer(props.method.fields, values),
              });
            }}
          >
            {primaryLabel(props.method.type)}
          </button>
          <Show when={props.onCancel}>
            {(cancel) => (
              <button type="button" class="secondary" onClick={cancel()}>
                Cancel
              </button>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

/**
 * One provider of the OpenCode Settings tab (issue #128, E10, variant 1 of plan B), in the D5
 * language: a round mark, the name in bold, a grey description and a row with a primary and a
 * secondary button. It has three faces, chosen from the data:
 *
 * - Connected (it has `connections`): one line per connection ("API key · saved by opencode for
 *   all projects", "From GOOGLE_APPLICATION_CREDENTIALS") and a Remove button per stored
 *   credential. Remove only sends `settings.disconnect`; the host asks for the confirmation.
 * - Signing in (the host's `attempt` is for this provider): "Starting…", then the instructions,
 *   the code with Copy code, and Cancel (`settings.cancel`, idempotent in the host), then
 *   "Finishing…". Copy code sends `settings.copyCode`: the code stays a host matter.
 * - Not connected: the name is a toggle; open, it shows the methods with their forms.
 *
 * Focus: opening the card moves the focus to the CARD (`tabindex="-1"`), never to a button that
 * connects, so a Space or Enter already on its way cannot start a sign-in; closing it returns the
 * focus to the toggle. When the user presses the primary button the row changes list (it moves to
 * "Connected" while it signs in, and back if the attempt is cancelled or fails), so the card is
 * rebuilt and the button that had the focus is gone; the new card asks `takeFocus` on mount and,
 * when `ProvidersSection` says so, takes the focus itself (never the `body`, on that path). While
 * the host works (`busy`) every action button is `aria-disabled`, not `disabled`. All texts of the
 * server are rendered as text. VERIFIED by `ProviderCard.test.tsx`
 * (jsdom, fabricated rows): the three faces, the primary label per method type, the focus on
 * expand, no `input[type=password]` anywhere; and in a real VS Code 1.144.0 on Windows 11
 * (1/11/2026, `npm run test:visual -- --group config`, synthetic server) by "ok   V6 opening the
 * GitHub Copilot card shows the deploymentType field only and puts the focus on the card …", "ok
 * V8 the card waits: it shows "Enter code: ABCD-1234" with the buttons Copy code and Cancel …", the
 * V6 and V8 contrast cells in four themes at 620 and 300 px, and "ok   W2 after the attempt the
 * focus is on the Copilot card, not on the body (card focused true)". NOT observed: a screen reader.
 */
export function ProviderCard(props: {
  row: ProviderRow;
  attempt: AuthAttemptView | undefined;
  /** True while the host runs an attempt (of any provider): action buttons are aria-disabled. */
  busy: boolean;
  ui: SettingsUi;
  send: SendSettings;
  /** Asked once on mount with this card's id: true means "you are the one the user was on". */
  takeFocus?: (integrationID: string) => boolean;
}) {
  let card: HTMLLIElement | undefined;
  let toggle: HTMLButtonElement | undefined;
  const connected = () => props.row.connections.length > 0;
  const signingIn = () => props.attempt !== undefined;
  const expanded = () => props.ui.expanded() === props.row.id && !connected() && !signingIn();
  const status = () => (signingIn() ? 'running' : connected() ? 'done' : 'waiting');
  const titleId = `provider-${props.row.id}-title`;

  // The first run only records the starting state, so a card restored open from the saved state
  // does not steal the focus at load. (`on(..., { defer: true })` is not used: its `before` is
  // `undefined` on the first real change, so it cannot tell an opening from a closing.)
  let wasExpanded = untrack(expanded);
  createEffect(() => {
    const now = expanded();
    if (now && !wasExpanded) card?.focus();
    if (!now && wasExpanded) toggle?.focus();
    wasExpanded = now;
  });

  onMount(() => {
    if (props.takeFocus?.(props.row.id) === true) card?.focus();
  });

  const collapse = (): void => {
    props.ui.setExpanded(undefined);
    props.ui.clearDraft(props.row.id);
  };

  return (
    <li
      class="setup-step settings-card"
      data-status={status()}
      data-provider={props.row.id}
      tabindex="-1"
      aria-labelledby={titleId}
      ref={(element) => {
        card = element;
      }}
    >
      <span class="step-mark settings-mark">
        <Show when={signingIn()}>
          <span class="spinner" aria-hidden="true" />
        </Show>
        <Show when={!signingIn() && connected()}>
          <CheckIcon />
        </Show>
        <Show when={!signingIn() && !connected()}>
          <WaitingIcon />
        </Show>
      </span>
      <div class="step-body">
        <Show
          when={connected() || signingIn()}
          fallback={
            <button
              type="button"
              class="settings-toggle"
              aria-expanded={expanded()}
              ref={(element) => {
                toggle = element;
              }}
              onClick={() => {
                props.ui.setExpanded(expanded() ? undefined : props.row.id);
              }}
            >
              <span class="step-title" id={titleId}>
                {props.row.name}
              </span>
              <span class="step-status">{methodSummary(props.row.methods)}</span>
            </button>
          }
        >
          <p class="step-title" id={titleId}>
            {props.row.name}
          </p>
        </Show>

        <For each={props.row.connections}>
          {(connection) => (
            <div class="settings-connection">
              <p class="step-line">{connectionText(connection)}</p>
              <Show when={connection.needsAuth}>
                {(message) => <p class="step-line">{`Needs sign-in: ${message()}`}</p>}
              </Show>
              <Show when={credentialOf(connection)}>
                {(credential) => (
                  <div class="step-actions">
                    <button
                      type="button"
                      class="secondary"
                      aria-label={`Remove ${props.row.name} (${credential().label})`}
                      aria-disabled={props.busy ? 'true' : undefined}
                      onClick={() => {
                        if (props.busy) return;
                        props.send({
                          type: 'settings.disconnect',
                          integrationID: props.row.id,
                          credentialID: credential().id,
                        });
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </Show>
            </div>
          )}
        </For>

        <Show when={props.attempt}>
          {(attempt) => (
            <div class="settings-attempt" data-phase={attempt().phase}>
              <Show when={attempt().phase === 'starting'}>
                <p class="step-line">Starting sign-in…</p>
              </Show>
              <Show when={attempt().phase === 'waiting'}>
                <p class="step-line">{attempt().instructions ?? 'Waiting for the browser…'}</p>
                <Show
                  when={
                    attempt().code !== undefined &&
                    !(attempt().instructions ?? '').includes(attempt().code ?? '')
                  }
                >
                  <p class="step-line">
                    {'Code: '}
                    <code class="settings-code">{attempt().code}</code>
                  </p>
                </Show>
              </Show>
              <Show when={attempt().phase === 'finishing'}>
                <p class="step-line">Finishing the sign-in…</p>
              </Show>
              <div class="step-actions">
                <Show when={attempt().phase === 'waiting' && attempt().code !== undefined}>
                  <button
                    type="button"
                    class="secondary"
                    onClick={() => {
                      props.send({ type: 'settings.copyCode', integrationID: props.row.id });
                    }}
                  >
                    Copy code
                  </button>
                </Show>
                <button
                  type="button"
                  class="secondary"
                  aria-disabled={attempt().phase === 'finishing' ? 'true' : undefined}
                  onClick={() => {
                    if (attempt().phase === 'finishing') return;
                    props.send({ type: 'settings.cancel', integrationID: props.row.id });
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Show>

        <Show when={expanded()}>
          <div class="settings-methods">
            <Show
              when={props.row.methods.length > 0}
              fallback={
                <p class="step-line">
                  No sign-in method of this provider works from this tab. Use opencode auth login in
                  a terminal, or set its environment variable.
                </p>
              }
            >
              <p class="settings-hint">Credentials are saved by opencode for all your projects.</p>
              <For each={props.row.methods}>
                {(method) => (
                  <MethodPanel
                    row={props.row}
                    method={method}
                    showLabel={props.row.methods.length > 1}
                    busy={props.busy}
                    ui={props.ui}
                    send={props.send}
                    onCancel={props.row.methods.length === 1 ? collapse : undefined}
                  />
                )}
              </For>
              <Show when={props.row.methods.length > 1}>
                <div class="step-actions">
                  <button type="button" class="secondary" onClick={collapse}>
                    Cancel
                  </button>
                </div>
              </Show>
            </Show>
          </div>
        </Show>
      </div>
    </li>
  );
}
