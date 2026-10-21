/**
 * Form state and validation for the question/form card (issue #44): from a `FormAsk` to the values
 * the inputs edit, and from those values to the `FormAnswer` the host sends (or to the messages
 * shown inline). Pure: no DOM, no Solid, so Vitest drives it directly.
 *
 * The server validates too and answers `FormInvalidAnswerError`, which the card shows; this module
 * exists so the obvious mistakes (a required field left empty, a number out of range) are caught
 * before the round trip and shown next to the field. Wire-only constraints the protocol dropped
 * (`pattern`, `format`, length limits, `when`, `hidden`) are NOT checked here.
 */
import type { FormAnswer, FormAsk, FormField } from '../../../src/shared/model';

/**
 * Value of a `choice` field that means "the Other option". It starts with a NUL so no option value
 * the server sends can equal it.
 */
export const OTHER = '\u0000other';

/** What an input of one field edits. */
export type FieldState =
  /** `string` without options: free text. */
  | { type: 'text'; value: string }
  /** `string` with options: `value` is an option value, {@link OTHER}, or `''` for none. */
  | { type: 'choice'; value: string; other: string }
  /** `multiselect`: the ticked option values, plus the optional Other box. */
  | { type: 'multi'; picked: string[]; otherChecked: boolean; other: string }
  | { type: 'boolean'; value: boolean }
  /** Kept as text so the user can type `1.`, `-` and so on; parsed when submitting. */
  | { type: 'number'; value: string }
  /** `external`: nothing to edit (the URL is shown). */
  | { type: 'external' };

/** The inputs of a whole form, by field key. */
export type FormValues = { [key: string]: FieldState };

/** Result of {@link buildAnswer}. */
export type BuiltAnswer =
  { ok: true; answer: FormAnswer } | { ok: false; errors: { [key: string]: string } };

/** Initial state of one field from its `default`; a default that is no option goes to Other if allowed. */
function initialField(field: FormField): FieldState {
  switch (field.type) {
    case 'string': {
      const options = field.options;
      if (options === undefined || options.length === 0) {
        return { type: 'text', value: field.default ?? '' };
      }
      const fallback = field.default;
      if (fallback === undefined) return { type: 'choice', value: '', other: '' };
      if (options.some((option) => option.value === fallback)) {
        return { type: 'choice', value: fallback, other: '' };
      }
      return field.custom === true
        ? { type: 'choice', value: OTHER, other: fallback }
        : { type: 'choice', value: '', other: '' };
    }
    case 'multiselect': {
      const known = new Set(field.options.map((option) => option.value));
      const defaults = field.default ?? [];
      const outside = defaults.filter((value) => !known.has(value));
      const wantsOther = field.custom === true && outside.length > 0;
      return {
        type: 'multi',
        picked: defaults.filter((value) => known.has(value)),
        otherChecked: wantsOther,
        other: wantsOther ? (outside[0] ?? '') : '',
      };
    }
    case 'boolean':
      return { type: 'boolean', value: field.default ?? false };
    case 'number':
      return { type: 'number', value: field.default === undefined ? '' : String(field.default) };
    case 'external':
      return { type: 'external' };
  }
}

/**
 * Inputs of a form, preloaded with the defaults the server sent. A `string` field with no options
 * (even with `custom: true`, which then adds nothing) is a plain textarea.
 */
export function initialValues(form: Pick<FormAsk, 'fields'>): FormValues {
  const values: FormValues = {};
  for (const field of form.fields) values[field.key] = initialField(field);
  return values;
}

/** Turns the raw text of a number input into a number, or an error message. */
function parseNumber(
  raw: string,
  field: Extract<FormField, { type: 'number' }>,
): { value: number } | { error: string } {
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) return { error: 'Enter a valid number' };
  if (field.integer && !Number.isInteger(value)) return { error: 'Enter a whole number' };
  if (field.minimum !== undefined && value < field.minimum) {
    return { error: `Must be at least ${String(field.minimum)}` };
  }
  if (field.maximum !== undefined && value > field.maximum) {
    return { error: `Must be at most ${String(field.maximum)}` };
  }
  return { value };
}

/**
 * Builds the answer the server expects (`{ q0: "A", q1: ["x", "y"] }`) from the inputs, or the
 * errors to show inline.
 *
 * Rules: choosing Other sends the typed text instead of the option (and needs text); a multiselect
 * sends its ticked options in option order, plus the Other text when ticked; an empty field that
 * is not required is left out of the answer; `required`, `minItems` and `maxItems` are enforced;
 * numbers must parse, be whole when `integer`, and sit inside `minimum`/`maximum`; booleans always
 * go; `external` fields are display-only and never go. A key the form does not have is ignored.
 * VERIFIED by `formAnswer.test.ts` with fabricated forms (logic only: how a real opencode
 * validates the answer is UNVERIFIED, the opt-in suite answers a question with a plain `q0`).
 */
export function buildAnswer(form: Pick<FormAsk, 'fields'>, values: FormValues): BuiltAnswer {
  const answer: FormAnswer = {};
  const errors: { [key: string]: string } = {};
  for (const field of form.fields) {
    const state = values[field.key] ?? initialField(field);
    const required = field.required === true;
    switch (field.type) {
      case 'string': {
        if (state.type === 'choice') {
          if (state.value === OTHER) {
            const text = state.other.trim();
            if (text === '') errors[field.key] = 'Enter your answer';
            else answer[field.key] = text;
          } else if (state.value === '') {
            if (required) errors[field.key] = 'Choose one option';
          } else {
            answer[field.key] = state.value;
          }
        } else if (state.type === 'text') {
          const text = state.value.trim();
          if (text === '') {
            if (required) errors[field.key] = 'This field is required';
          } else {
            answer[field.key] = text;
          }
        }
        break;
      }
      case 'multiselect': {
        if (state.type !== 'multi') break;
        const known = field.options.map((option) => option.value);
        const chosen = known.filter((value) => state.picked.includes(value));
        if (state.otherChecked) {
          const text = state.other.trim();
          if (text === '') {
            errors[field.key] = 'Enter your answer or untick Other';
            break;
          }
          chosen.push(text);
        }
        if (chosen.length === 0) {
          if (required || (field.minItems !== undefined && field.minItems > 0)) {
            errors[field.key] = 'Choose at least one';
          }
        } else if (field.minItems !== undefined && chosen.length < field.minItems) {
          errors[field.key] = `Choose at least ${String(field.minItems)}`;
        } else if (field.maxItems !== undefined && chosen.length > field.maxItems) {
          errors[field.key] = `Choose at most ${String(field.maxItems)}`;
        } else {
          answer[field.key] = chosen;
        }
        break;
      }
      case 'boolean':
        if (state.type === 'boolean') answer[field.key] = state.value;
        break;
      case 'number': {
        if (state.type !== 'number') break;
        if (state.value.trim() === '') {
          if (required) errors[field.key] = 'Enter a number';
          break;
        }
        const parsed = parseNumber(state.value, field);
        if ('error' in parsed) errors[field.key] = parsed.error;
        else answer[field.key] = parsed.value;
        break;
      }
      case 'external':
        break;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, answer };
}
