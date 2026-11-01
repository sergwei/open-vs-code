// Pure helpers for the form of a connection method in the OpenCode Settings tab (issue #128, E10):
// which fields are visible, which required ones are empty, and what answer to send. No DOM, no
// Solid, so they are tested as plain functions.
import type { SettingsFieldRow } from '../../../src/shared/settingsProtocol';

/** The values typed so far, by field key. A key that is absent counts as the empty string. */
export type FieldValues = Readonly<Record<string, string>>;

/**
 * True when every `when` condition of `field` holds for `values`.
 *
 * `when` only decides whether the field is SHOWN: the host revalidates the answer it receives
 * against the method's declared fields, so a webview that gets this wrong cannot widen what is
 * accepted. A field without `when` is always visible. Conditions are combined with AND, and `eq` /
 * `neq` compare the whole string. HYPOTHESIS: upstream combines `FormWhen[]` with AND too (the
 * type is an array and every form seen in the planner spike has at most one entry); it would be
 * confirmed by a form with two conditions, which no provider of opencode 2.0.32 has.
 */
export function isFieldVisible(field: SettingsFieldRow, values: FieldValues): boolean {
  if (field.when === undefined) return true;
  return field.when.every((condition) => {
    const current = values[condition.key] ?? '';
    return condition.op === 'eq' ? current === condition.value : current !== condition.value;
  });
}

/** The fields of `fields` that are visible for `values`, in their original order. */
export function visibleFields(
  fields: readonly SettingsFieldRow[],
  values: FieldValues,
): SettingsFieldRow[] {
  return fields.filter((field) => isFieldVisible(field, values));
}

/** The visible required fields whose value is empty or only spaces. */
export function missingRequired(
  fields: readonly SettingsFieldRow[],
  values: FieldValues,
): SettingsFieldRow[] {
  return visibleFields(fields, values).filter(
    (field) => field.required && (values[field.key] ?? '').trim() === '',
  );
}

/**
 * The answer `settings.connect` carries: the visible fields that have a value, by key. A hidden
 * field is left out even if the user typed in it before the condition changed, and an empty
 * optional field is left out so the server applies its own default. Never contains a key or a
 * secret: the tab has no field for one (the API key goes through a native InputBox in the host).
 */
export function buildAnswer(
  fields: readonly SettingsFieldRow[],
  values: FieldValues,
): Record<string, string> {
  const answer: Record<string, string> = {};
  for (const field of visibleFields(fields, values)) {
    const value = values[field.key] ?? '';
    if (value.trim() !== '') answer[field.key] = value;
  }
  return answer;
}

/**
 * The starting value of every field: the saved draft if there is one, else the field's `default`,
 * else, for a required field with `options`, the first option (a `<select>` always shows one
 * option, so the value must be that one), else the empty string.
 */
export function initialValues(
  fields: readonly SettingsFieldRow[],
  draft: FieldValues,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const saved = draft[field.key];
    if (saved !== undefined) {
      values[field.key] = saved;
    } else if (field.default !== undefined) {
      values[field.key] = field.default;
    } else if (field.required && field.options !== undefined && field.options.length > 0) {
      values[field.key] = field.options[0]?.value ?? '';
    } else {
      values[field.key] = '';
    }
  }
  return values;
}
