import { For, Show, untrack } from 'solid-js';
import type { SettingsFieldRow } from '../../../src/shared/settingsProtocol';
import { isFieldVisible, type FieldValues } from './formWhen';

/**
 * The fields of one connection method (issue #128, E10): a `<select>` when the field has
 * `options`, a text `<input>` otherwise. A field with `when` is shown or hidden from the values
 * typed so far; that is only about what is SHOWN, the host revalidates the answer.
 *
 * Security: every input is `type="text"`. The tab never has a password field because it never
 * asks for a key: the API key is requested by the host in a native InputBox (plan section 3).
 * Texts of the server (titles, descriptions, option labels) are plain JSX text, never HTML.
 *
 * Why the value is set once in `ref` and not bound with `value={...}`: a bound value is assigned
 * again each time the store changes, and would overwrite what the user is typing (solid-webview
 * section 1, rule 3). The options of a `<select>` mark `selected` from the values instead, which
 * does not touch a typed caret. VERIFIED by `ProviderCard.test.tsx` (jsdom: choosing Enterprise in the
 * select shows the dependent field and choosing GitHub.com hides it) and by `SettingsApp.test.tsx`
 * (a typed input keeps its identity and value when the host sends a new state). VERIFIED in a real
 * VS Code 1.144.0 on Windows 11 (1/11/2026, `npm run test:visual -- --group config`): "ok   V6
 * choosing GitHub Enterprise makes the Enterprise URL field appear (fields
 * ["deploymentType","enterpriseUrl"])" and, in four themes at 620 and 300 px, "ok   V6 300 px (300),
 * hc-light: the open Copilot card has no sideways overflow (0 px), no style attribute (0), min
 * contrast 5.47 over 7 texts" (the select, the labels, the hint and both buttons are among the 7).
 * The keyboard did change the select in that run (no "changed by script" note was printed).
 */
export function FormFields(props: {
  fields: readonly SettingsFieldRow[];
  values: FieldValues;
  /** Prefix that keeps the element ids of two forms on the page apart. */
  idPrefix: string;
  onInput(key: string, value: string): void;
}) {
  return (
    <For each={props.fields}>
      {(field) => {
        const id = `${props.idPrefix}-${field.key}`;
        const hintId = `${id}-hint`;
        return (
          <Show when={isFieldVisible(field, props.values)}>
            <div class="settings-field" data-field={field.key}>
              <label class="settings-label" for={id}>
                {field.title ?? field.key}
                <Show when={!field.required}>
                  <span class="step-status">{' (optional)'}</span>
                </Show>
              </label>
              <Show when={field.description !== undefined && field.description !== ''}>
                <p class="settings-hint" id={hintId}>
                  {field.description}
                </p>
              </Show>
              <Show
                when={field.options}
                fallback={
                  <input
                    id={id}
                    class="settings-input"
                    type="text"
                    autocomplete="off"
                    spellcheck={false}
                    placeholder={field.placeholder}
                    aria-describedby={field.description === undefined ? undefined : hintId}
                    ref={(element) => {
                      element.value = untrack(() => props.values[field.key] ?? '');
                    }}
                    onInput={(event) => {
                      props.onInput(field.key, event.currentTarget.value);
                    }}
                  />
                }
              >
                {(options) => (
                  <select
                    id={id}
                    class="settings-input"
                    aria-describedby={field.description === undefined ? undefined : hintId}
                    onChange={(event) => {
                      props.onInput(field.key, event.currentTarget.value);
                    }}
                  >
                    <Show when={!field.required}>
                      <option value="" selected={(props.values[field.key] ?? '') === ''}>
                        None
                      </option>
                    </Show>
                    <For each={options()}>
                      {(option) => (
                        <option
                          value={option.value}
                          selected={(props.values[field.key] ?? '') === option.value}
                        >
                          {option.label}
                        </option>
                      )}
                    </For>
                  </select>
                )}
              </Show>
            </div>
          </Show>
        );
      }}
    </For>
  );
}
