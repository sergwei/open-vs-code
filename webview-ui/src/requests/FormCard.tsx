import { createSignal, createUniqueId, For, Show, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ErrorInfo, FormAsk, FormField } from '../../../src/shared/model';
import { useSend } from '../chat/hostContext';
import { nextRequestId } from '../chat/PromptInput';
import { buildAnswer, initialValues, OTHER, type FieldState, type FormValues } from './formAnswer';
import type { RequestOrigin } from './PermissionCard';

/** Text shown for a field: its title, or its key when the server gave none. */
const fieldTitle = (field: FormField): string => field.title ?? field.key;

/**
 * The inputs of ONE form field, with its error. A controlled view: the card owns the values.
 *
 * `string` with options is a radio group (plus an "Other" radio and a text box when `custom`),
 * `string` without options a textarea, `multiselect` checkboxes (plus Other), `boolean` a checkbox,
 * `number` a number input honouring `integer`, `minimum` and `maximum`, and `external` shows its URL
 * as text. Typing in an Other box selects Other, so the user never has to tick it first. Every
 * input has a visible label or an `aria-label`; the error is `role="alert"`. UNVERIFIED visually
 * and with a screen reader (F5 points 3, 5, 6); the behaviour is covered by `FormCard.test.tsx`.
 */
function FieldView(props: {
  field: FormField;
  state: FieldState | undefined;
  error: string | undefined;
  disabled: boolean;
  groupName: string;
  onChange(next: FieldState): void;
}) {
  const stringField = () => (props.field.type === 'string' ? props.field : undefined);
  const multiField = () => (props.field.type === 'multiselect' ? props.field : undefined);
  const numberField = () => (props.field.type === 'number' ? props.field : undefined);
  const externalField = () => (props.field.type === 'external' ? props.field : undefined);
  const choice = () => (props.state?.type === 'choice' ? props.state : undefined);
  const text = () => (props.state?.type === 'text' ? props.state : undefined);
  const multi = () => (props.state?.type === 'multi' ? props.state : undefined);
  const hasOptions = () => (stringField()?.options?.length ?? 0) > 0;

  return (
    <fieldset class="form-field" disabled={props.disabled}>
      <legend>
        {fieldTitle(props.field)}
        <Show when={props.field.required === true}>
          <span aria-hidden="true"> *</span>
          <span class="visually-hidden"> (required)</span>
        </Show>
      </legend>
      <Show when={props.field.description}>
        <p class="field-description">{props.field.description}</p>
      </Show>

      <Show when={stringField()}>
        {(field) => (
          <>
            <Show when={hasOptions()}>
              <For each={field().options}>
                {(option) => (
                  <label class="form-option">
                    <input
                      type="radio"
                      name={props.groupName}
                      value={option.value}
                      checked={choice()?.value === option.value}
                      onChange={() =>
                        props.onChange({
                          type: 'choice',
                          value: option.value,
                          other: choice()?.other ?? '',
                        })
                      }
                    />
                    <span>
                      {option.label}
                      <Show when={option.description}>
                        <span class="option-description"> — {option.description}</span>
                      </Show>
                    </span>
                  </label>
                )}
              </For>
              <Show when={field().custom === true}>
                <div class="form-option form-other">
                  <label>
                    <input
                      type="radio"
                      name={props.groupName}
                      value={OTHER}
                      checked={choice()?.value === OTHER}
                      onChange={() =>
                        props.onChange({
                          type: 'choice',
                          value: OTHER,
                          other: choice()?.other ?? '',
                        })
                      }
                    />
                    <span>Other</span>
                  </label>
                  <input
                    type="text"
                    class="form-text"
                    aria-label={`Other answer for ${fieldTitle(props.field)}`}
                    value={choice()?.other ?? ''}
                    onInput={(event) =>
                      props.onChange({
                        type: 'choice',
                        value: OTHER,
                        other: event.currentTarget.value,
                      })
                    }
                  />
                </div>
              </Show>
            </Show>
            <Show when={!hasOptions()}>
              <textarea
                class="form-textarea"
                rows={2}
                aria-label={fieldTitle(props.field)}
                placeholder={field().placeholder}
                value={text()?.value ?? ''}
                onInput={(event) =>
                  props.onChange({ type: 'text', value: event.currentTarget.value })
                }
              />
            </Show>
          </>
        )}
      </Show>

      <Show when={multiField()}>
        {(field) => (
          <>
            <For each={field().options}>
              {(option) => (
                <label class="form-option">
                  <input
                    type="checkbox"
                    value={option.value}
                    checked={multi()?.picked.includes(option.value) ?? false}
                    onChange={(event) => {
                      const current = multi() ?? {
                        type: 'multi' as const,
                        picked: [],
                        otherChecked: false,
                        other: '',
                      };
                      const picked = event.currentTarget.checked
                        ? [...current.picked, option.value]
                        : current.picked.filter((value) => value !== option.value);
                      props.onChange({ ...current, picked });
                    }}
                  />
                  <span>
                    {option.label}
                    <Show when={option.description}>
                      <span class="option-description"> — {option.description}</span>
                    </Show>
                  </span>
                </label>
              )}
            </For>
            <Show when={field().custom === true}>
              <div class="form-option form-other">
                <label>
                  <input
                    type="checkbox"
                    checked={multi()?.otherChecked ?? false}
                    onChange={(event) => {
                      const current = multi() ?? {
                        type: 'multi' as const,
                        picked: [],
                        otherChecked: false,
                        other: '',
                      };
                      props.onChange({ ...current, otherChecked: event.currentTarget.checked });
                    }}
                  />
                  <span>Other</span>
                </label>
                <input
                  type="text"
                  class="form-text"
                  aria-label={`Other answer for ${fieldTitle(props.field)}`}
                  value={multi()?.other ?? ''}
                  onInput={(event) => {
                    const current = multi() ?? {
                      type: 'multi' as const,
                      picked: [],
                      otherChecked: false,
                      other: '',
                    };
                    props.onChange({
                      ...current,
                      otherChecked: true,
                      other: event.currentTarget.value,
                    });
                  }}
                />
              </div>
            </Show>
          </>
        )}
      </Show>

      <Show when={props.field.type === 'boolean'}>
        <label class="form-option">
          <input
            type="checkbox"
            checked={props.state?.type === 'boolean' && props.state.value}
            onChange={(event) =>
              props.onChange({ type: 'boolean', value: event.currentTarget.checked })
            }
          />
          <span>Yes</span>
        </label>
      </Show>

      <Show when={numberField()}>
        {(field) => (
          <input
            type="number"
            class="form-text"
            aria-label={fieldTitle(props.field)}
            step={field().integer ? 1 : 'any'}
            min={field().minimum}
            max={field().maximum}
            value={props.state?.type === 'number' ? props.state.value : ''}
            onInput={(event) =>
              props.onChange({ type: 'number', value: event.currentTarget.value })
            }
          />
        )}
      </Show>

      <Show when={externalField()}>
        {(field) => (
          <p class="field-description">
            Open this link in your browser: <code>{field().url}</code>
          </p>
        )}
      </Show>

      <Show when={props.error}>
        <p class="field-error" role="alert">
          {props.error}
        </p>
      </Show>
    </fieldset>
  );
}

/**
 * Card of one pending form or question (issue #44).
 *
 * Renders every field of the form (see {@link FieldView}), preloaded with the server's defaults.
 * **Submit** validates with `buildAnswer`, shows the errors next to the fields and, when there are
 * none, sends `form.reply` with the exact `{ q0: "A", q1: ["x", "y"] }` answer. **Dismiss (stops
 * the agent)** sends `form.cancel` with no message: for the `question` tool that makes the model
 * stop (`CancelledError`, read in `question.ts@v2.0.32`). **Answer in my own words…** opens a
 * textarea whose text goes as the `message` of `form.cancel`: the model keeps going and reads it
 * as the user's feedback instead of the choice. While `replying` the whole card is locked and says
 * "Sending…"; `error` (for example a `FormInvalidAnswerError` from the server) shows at the top
 * with `role="alert"` and the card stays open and editable. Escape asks the dock to move the focus
 * back to the prompt and never dismisses (`onEscape`).
 *
 * The values are created once from the form (`untrack`): a snapshot that re-announces the same
 * form reconciles into the same card, so the user's typing is never reset. VERIFIED by
 * `FormCard.test.tsx` in jsdom; look, focus order and screen reader UNVERIFIED (F5 points 3, 5, 6).
 */
export function FormCard(props: {
  ask: FormAsk;
  origin?: RequestOrigin;
  replying: boolean;
  error?: ErrorInfo;
  onSent(requestId: string): void;
  onEscape(): void;
}) {
  const send = useSend();
  const titleId = createUniqueId();
  const bodyId = createUniqueId();
  const [values, setValues] = createStore<FormValues>(untrack(() => initialValues(props.ask)));
  const [errors, setErrors] = createSignal<{ [key: string]: string }>({});
  const [ownWords, setOwnWords] = createSignal(false);
  const [feedback, setFeedback] = createSignal('');

  /** Submits the answer if it validates; otherwise shows what to fix. */
  const submit = (): void => {
    const result = buildAnswer(props.ask, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    const requestId = nextRequestId();
    props.onSent(requestId);
    send({
      type: 'form.reply',
      requestId,
      sessionID: props.ask.sessionID,
      formID: props.ask.id,
      answer: result.answer,
    });
  };

  /** Cancels the form, with the user's own words when given. */
  const cancel = (message?: string): void => {
    const requestId = nextRequestId();
    props.onSent(requestId);
    send({
      type: 'form.cancel',
      requestId,
      sessionID: props.ask.sessionID,
      formID: props.ask.id,
      ...(message === undefined || message.trim() === '' ? {} : { message }),
    });
  };

  return (
    <section
      class="request-card form-card"
      role="group"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-request-id={props.ask.id}
      data-request-kind="form"
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
        {props.ask.kind === 'question' ? 'Question from the agent' : props.ask.title}
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
        <Show when={props.error}>
          {(error) => (
            <p class="request-error" role="alert">
              {error().message}
            </p>
          )}
        </Show>
      </div>

      <form
        class="request-form"
        noValidate
        onKeyDown={(event) => {
          // No implicit submission: Enter inside a field must not send an answer (browsers submit
          // a form on Enter from a text, number or radio input). Only the Submit button, focused
          // and pressed, sends. Buttons and textareas keep their own Enter behaviour (a textarea
          // makes a new line; a button is clicked). HYPOTHESIS that Chromium would submit from a
          // radio; the guard is cheap either way.
          if (event.key !== 'Enter' || event.isComposing) return;
          const target = event.target;
          if (target instanceof HTMLInputElement) event.preventDefault();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <For each={props.ask.fields}>
          {(field) => (
            <FieldView
              field={field}
              state={values[field.key]}
              error={errors()[field.key]}
              disabled={props.replying}
              groupName={`${props.ask.id}-${field.key}`}
              onChange={(next) => {
                setValues(field.key, next);
              }}
            />
          )}
        </For>

        <Show when={ownWords()}>
          <div class="request-feedback">
            <label>
              Your answer in your own words
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
              disabled={props.replying || feedback().trim() === ''}
              onClick={() => {
                cancel(feedback());
              }}
            >
              Send as feedback
            </button>
          </div>
        </Show>

        <div class="request-actions">
          <button type="submit" class="primary" disabled={props.replying}>
            Submit
          </button>
          <button
            type="button"
            class="secondary"
            disabled={props.replying}
            onClick={() => {
              cancel();
            }}
          >
            Dismiss (stops the agent)
          </button>
          <button
            type="button"
            class="secondary"
            disabled={props.replying}
            aria-expanded={ownWords()}
            onClick={() => setOwnWords((current) => !current)}
          >
            Answer in my own words…
          </button>
        </div>
      </form>
      <Show when={props.replying}>
        <p class="request-hint" role="status">
          Sending…
        </p>
      </Show>
    </section>
  );
}
