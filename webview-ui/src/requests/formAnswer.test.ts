// Protects the answer a question card sends (issue #44): the exact `{ q0, q1 }` shape the
// server reads, what a field left empty does (omitted, or an error when required), the Other box
// replacing the option text, and the number and count limits. A wrong answer here makes the agent
// receive the wrong choice, or the card refuse a valid one.
//
// Provenance: FABRICATED forms shaped like the `question` tool's (q<i> keys, `string` with
// `options` and `custom: true`, `multiselect`), read in `question.ts@v2.0.32`, not captured from a
// running server. They confirm our logic, not how the server validates.
import { describe, expect, it } from 'vitest';
import type { FormAsk, FormField } from '../../../src/shared/model';
import { buildAnswer, initialValues, OTHER, type FormValues } from './formAnswer';

const form = (...fields: FormField[]): Pick<FormAsk, 'fields'> => ({ fields });

const letter: FormField = {
  key: 'q0',
  type: 'string',
  title: 'Letter',
  required: true,
  options: [
    { value: 'A', label: 'A' },
    { value: 'B', label: 'B' },
  ],
  custom: true,
};
const extras: FormField = {
  key: 'q1',
  type: 'multiselect',
  options: [
    { value: 'x', label: 'x' },
    { value: 'y', label: 'y' },
    { value: 'z', label: 'z' },
  ],
  custom: true,
};

describe('initialValues', () => {
  it('starts a radio with nothing chosen and a free text empty', () => {
    const values = initialValues(form(letter, { key: 'q2', type: 'string' }));
    expect(values['q0']).toEqual({ type: 'choice', value: '', other: '' });
    expect(values['q2']).toEqual({ type: 'text', value: '' });
  });

  it('preloads the defaults', () => {
    const values = initialValues(
      form(
        { ...letter, default: 'B' },
        { ...extras, default: ['x', 'z'] },
        { key: 'q2', type: 'boolean', default: true },
        { key: 'q3', type: 'number', integer: true, default: 4 },
        { key: 'q4', type: 'string', default: 'hello' },
      ),
    );
    expect(values['q0']).toEqual({ type: 'choice', value: 'B', other: '' });
    expect(values['q1']).toEqual({
      type: 'multi',
      picked: ['x', 'z'],
      otherChecked: false,
      other: '',
    });
    expect(values['q2']).toEqual({ type: 'boolean', value: true });
    expect(values['q3']).toEqual({ type: 'number', value: '4' });
    expect(values['q4']).toEqual({ type: 'text', value: 'hello' });
  });

  it('sends a default that is not an option to Other when the field allows it, else drops it', () => {
    expect(initialValues(form({ ...letter, default: 'Z' }))['q0']).toEqual({
      type: 'choice',
      value: OTHER,
      other: 'Z',
    });
    expect(initialValues(form({ ...letter, custom: false, default: 'Z' }))['q0']).toEqual({
      type: 'choice',
      value: '',
      other: '',
    });
    expect(initialValues(form({ ...extras, default: ['x', 'q'] }))['q1']).toEqual({
      type: 'multi',
      picked: ['x'],
      otherChecked: true,
      other: 'q',
    });
  });
});

describe('buildAnswer: choices', () => {
  const answer = (values: FormValues, ...fields: FormField[]) =>
    buildAnswer(form(...fields), values);

  it('sends the chosen option value under its key', () => {
    expect(answer({ q0: { type: 'choice', value: 'A', other: '' } }, letter)).toEqual({
      ok: true,
      answer: { q0: 'A' },
    });
  });

  it('Other replaces the option with the typed text, trimmed, and needs text', () => {
    expect(answer({ q0: { type: 'choice', value: OTHER, other: '  purple ' } }, letter)).toEqual({
      ok: true,
      answer: { q0: 'purple' },
    });
    expect(answer({ q0: { type: 'choice', value: OTHER, other: '   ' } }, letter)).toEqual({
      ok: false,
      errors: { q0: 'Enter your answer' },
    });
  });

  it('a required radio with nothing chosen is an error; an optional one is omitted', () => {
    const none = { q0: { type: 'choice', value: '', other: '' } } satisfies FormValues;
    expect(answer(none, letter)).toEqual({ ok: false, errors: { q0: 'Choose one option' } });
    expect(answer(none, { ...letter, required: false })).toEqual({ ok: true, answer: {} });
  });

  it('a multiselect sends the ticked options in option order, plus Other', () => {
    const values: FormValues = {
      q1: { type: 'multi', picked: ['z', 'x'], otherChecked: true, other: ' extra ' },
    };
    expect(answer(values, extras)).toEqual({ ok: true, answer: { q1: ['x', 'z', 'extra'] } });
  });

  it('an Other box ticked with no text is an error, and an empty optional multiselect is omitted', () => {
    expect(
      answer({ q1: { type: 'multi', picked: ['x'], otherChecked: true, other: '' } }, extras),
    ).toEqual({ ok: false, errors: { q1: 'Enter your answer or untick Other' } });
    expect(
      answer({ q1: { type: 'multi', picked: [], otherChecked: false, other: '' } }, extras),
    ).toEqual({ ok: true, answer: {} });
  });

  it('enforces required, minItems and maxItems on a multiselect', () => {
    const empty: FormValues = { q1: { type: 'multi', picked: [], otherChecked: false, other: '' } };
    expect(answer(empty, { ...extras, required: true })).toEqual({
      ok: false,
      errors: { q1: 'Choose at least one' },
    });
    expect(answer(empty, { ...extras, minItems: 1 })).toMatchObject({ ok: false });
    const one: FormValues = {
      q1: { type: 'multi', picked: ['x'], otherChecked: false, other: '' },
    };
    expect(answer(one, { ...extras, minItems: 2 })).toEqual({
      ok: false,
      errors: { q1: 'Choose at least 2' },
    });
    const three: FormValues = {
      q1: { type: 'multi', picked: ['x', 'y', 'z'], otherChecked: false, other: '' },
    };
    expect(answer(three, { ...extras, maxItems: 2 })).toEqual({
      ok: false,
      errors: { q1: 'Choose at most 2' },
    });
  });
});

describe('buildAnswer: free text, booleans, numbers, external', () => {
  const text: FormField = { key: 'q0', type: 'string', required: true };
  const count: FormField = { key: 'q1', type: 'number', integer: true, minimum: 1, maximum: 10 };

  it('trims free text, errors when required and empty, omits when optional and empty', () => {
    expect(buildAnswer(form(text), { q0: { type: 'text', value: '  hi  ' } })).toEqual({
      ok: true,
      answer: { q0: 'hi' },
    });
    expect(buildAnswer(form(text), { q0: { type: 'text', value: ' ' } })).toEqual({
      ok: false,
      errors: { q0: 'This field is required' },
    });
    expect(
      buildAnswer(form({ ...text, required: false }), { q0: { type: 'text', value: '' } }),
    ).toEqual({ ok: true, answer: {} });
  });

  it('always sends a boolean, false included', () => {
    const field: FormField = { key: 'q0', type: 'boolean' };
    expect(buildAnswer(form(field), { q0: { type: 'boolean', value: false } })).toEqual({
      ok: true,
      answer: { q0: false },
    });
  });

  it('parses a number and enforces whole numbers and the range', () => {
    expect(buildAnswer(form(count), { q1: { type: 'number', value: '7' } })).toEqual({
      ok: true,
      answer: { q1: 7 },
    });
    expect(buildAnswer(form(count), { q1: { type: 'number', value: '2.5' } })).toEqual({
      ok: false,
      errors: { q1: 'Enter a whole number' },
    });
    expect(buildAnswer(form(count), { q1: { type: 'number', value: '0' } })).toEqual({
      ok: false,
      errors: { q1: 'Must be at least 1' },
    });
    expect(buildAnswer(form(count), { q1: { type: 'number', value: '11' } })).toEqual({
      ok: false,
      errors: { q1: 'Must be at most 10' },
    });
    expect(buildAnswer(form(count), { q1: { type: 'number', value: 'abc' } })).toEqual({
      ok: false,
      errors: { q1: 'Enter a valid number' },
    });
  });

  it('accepts a decimal for a non-integer field, and treats empty as an error only when required', () => {
    const decimal: FormField = { key: 'q0', type: 'number', integer: false };
    expect(buildAnswer(form(decimal), { q0: { type: 'number', value: '2.5' } })).toEqual({
      ok: true,
      answer: { q0: 2.5 },
    });
    expect(buildAnswer(form(decimal), { q0: { type: 'number', value: '' } })).toEqual({
      ok: true,
      answer: {},
    });
    expect(
      buildAnswer(form({ ...decimal, required: true }), { q0: { type: 'number', value: '' } }),
    ).toEqual({ ok: false, errors: { q0: 'Enter a number' } });
  });

  it('leaves an external field out of the answer', () => {
    const field: FormField = { key: 'q0', type: 'external', url: 'https://example.test' };
    expect(buildAnswer(form(field), { q0: { type: 'external' } })).toEqual({
      ok: true,
      answer: {},
    });
  });

  it('collects the errors of every field at once', () => {
    // `q2` has no entry in the values: it starts from its own default (empty), as a card would.
    const result = buildAnswer(form(letter, { ...text, key: 'q2' }), {
      q0: { type: 'choice', value: '', other: '' },
    });
    expect(result).toEqual({
      ok: false,
      errors: { q0: 'Choose one option', q2: 'This field is required' },
    });
  });
});
