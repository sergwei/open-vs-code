// Protects the question/form card (issue #44): Submit posts the exact `{ q0, q1 }` answer for
// radios, checkboxes and the Other box, validation errors show next to the field and send
// nothing, Dismiss cancels with no message (the agent stops) while "in my own words" cancels with
// one (the agent goes on), a locked card cannot be pressed twice, and the server's error stays in
// the card with the form still editable. A regression here sends the model the wrong answer.
//
// Provenance: a fabricated `FormAsk` shaped like the `question` tool's, read in `question.ts@
// v2.0.32` (q<i> keys, `string` with `options` and `custom`, `multiselect`); rendered in jsdom with
// a recording sender. They confirm wiring and wording, not layout or a screen reader (F5).
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormAsk } from '../../../src/shared/model';
import { must, mount, splitRequestId, type Mounted } from '../testing';
import { FormCard } from './FormCard';

const mountedCards: Mounted[] = [];
afterEach(() => {
  for (const card of mountedCards.splice(0)) card.dispose();
});

const question: FormAsk = {
  id: 'frm_1',
  sessionID: 'ses_1',
  title: 'Questions',
  kind: 'question',
  fields: [
    {
      key: 'q0',
      type: 'string',
      title: 'Letter',
      description: 'Pick A or B',
      required: true,
      options: [
        { value: 'A', label: 'A', description: 'the first' },
        { value: 'B', label: 'B' },
      ],
      custom: true,
    },
    {
      key: 'q1',
      type: 'multiselect',
      title: 'Extras',
      options: [
        { value: 'x', label: 'x' },
        { value: 'y', label: 'y' },
      ],
      custom: true,
    },
  ],
};

/** Mounts a card; `replying` and `error` are signals so a test can change them after mount. */
function setup(ask: FormAsk = question, origin?: { title: string; onOpen?(): void }) {
  const [replying, setReplying] = createSignal(false);
  const [error, setError] = createSignal<{ code: string; message: string } | undefined>(undefined);
  const onSent = vi.fn();
  const onEscape = vi.fn();
  const mounted = mount(() => (
    <FormCard
      ask={ask}
      origin={origin}
      replying={replying()}
      error={error()}
      onSent={onSent}
      onEscape={onEscape}
    />
  ));
  mountedCards.push(mounted);
  const container = mounted.container;
  const button = (name: string): HTMLButtonElement => {
    const found = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
    if (found === undefined) throw new Error(`no button named ${name}`);
    return found;
  };
  /** The input (radio or checkbox) inside the label whose text is `label`. */
  const choose = (label: string): HTMLInputElement => {
    const found = [...container.querySelectorAll('label')].find((l) =>
      (l.textContent ?? '').trim().startsWith(label),
    );
    const input = found?.querySelector('input');
    if (input === null || input === undefined) throw new Error(`no option ${label}`);
    return input;
  };
  const typeInto = (input: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const submit = (): void => {
    must<HTMLFormElement>(container, 'form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  };
  return {
    container,
    sent: mounted.sent,
    onSent,
    onEscape,
    button,
    choose,
    typeInto,
    submit,
    setReplying,
    setError,
  };
}

describe('Submit', () => {
  it('posts the exact answer for a radio and some checkboxes', () => {
    const { choose, submit, sent, onSent } = setup();
    choose('B').click();
    choose('x').click();
    choose('y').click();
    submit();
    expect(sent).toHaveLength(1);
    const { requestId, rest } = splitRequestId(sent[0]);
    expect(rest).toEqual({
      type: 'form.reply',
      sessionID: 'ses_1',
      formID: 'frm_1',
      answer: { q0: 'B', q1: ['x', 'y'] },
    });
    expect(onSent).toHaveBeenCalledWith(requestId);
  });

  it('the Other box replaces the option with the typed text, and typing in it selects Other', () => {
    const { container, typeInto, submit, sent } = setup();
    const others = container.querySelectorAll<HTMLInputElement>('input.form-text');
    const first = others[0];
    if (first === undefined) throw new Error('no Other box');
    typeInto(first, ' purple ');
    submit();
    expect(sent[0]).toMatchObject({ answer: { q0: 'purple' } });
  });

  it('a multiselect Other adds its text to the ticked options', () => {
    const { container, choose, typeInto, submit, sent } = setup();
    choose('A').click();
    choose('x').click();
    const others = container.querySelectorAll<HTMLInputElement>('input.form-text');
    const second = others[1];
    if (second === undefined) throw new Error('no second Other box');
    typeInto(second, 'extra');
    submit();
    expect(sent[0]).toMatchObject({ answer: { q0: 'A', q1: ['x', 'extra'] } });
  });

  it('a required field left empty shows its error and sends nothing', () => {
    const { container, submit, sent } = setup();
    submit();
    expect(sent).toEqual([]);
    expect(must(container, '.field-error').textContent).toBe('Choose one option');
    expect(must(container, '.field-error').getAttribute('role')).toBe('alert');
  });

  it('the error goes away once the field is fixed and the form submits', () => {
    const { container, choose, submit, sent } = setup();
    submit();
    choose('A').click();
    submit();
    expect(container.querySelector('.field-error')).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('preloads the defaults of the server', () => {
    const { submit, sent } = setup({
      ...question,
      fields: [
        { key: 'q0', type: 'string', default: 'hello' },
        { key: 'q1', type: 'boolean', default: true },
        { key: 'q2', type: 'number', integer: true, minimum: 1, default: 3 },
      ],
    });
    submit();
    expect(sent[0]).toMatchObject({ answer: { q0: 'hello', q1: true, q2: 3 } });
  });

  it('shows a number outside its range as an error', () => {
    const { container, typeInto, submit, sent } = setup({
      ...question,
      fields: [{ key: 'q0', type: 'number', integer: true, minimum: 1, maximum: 5 }],
    });
    typeInto(must<HTMLInputElement>(container, 'input[type="number"]'), '9');
    submit();
    expect(sent).toEqual([]);
    expect(must(container, '.field-error').textContent).toBe('Must be at most 5');
  });

  it('shows an external field as text and never sends it', () => {
    const { container, submit, sent } = setup({
      ...question,
      fields: [{ key: 'q0', type: 'external', url: 'https://example.test/login' }],
    });
    expect(container.textContent).toContain('https://example.test/login');
    submit();
    expect(sent[0]).toMatchObject({ answer: {} });
  });
});

describe('Dismiss and own words', () => {
  it('Dismiss cancels with no message', () => {
    const { button, sent } = setup();
    button('Dismiss (stops the agent)').click();
    expect(sent).toHaveLength(1);
    expect(splitRequestId(sent[0]).rest).toEqual({
      type: 'form.cancel',
      sessionID: 'ses_1',
      formID: 'frm_1',
    });
  });

  it('"Answer in my own words" cancels WITH the text, and a blank text cannot be sent', () => {
    const { container, button, typeInto, sent } = setup();
    button('Answer in my own words…').click();
    expect(button('Send as feedback').disabled).toBe(true);
    const textarea = must<HTMLTextAreaElement>(container, '.request-feedback textarea');
    typeInto(textarea, 'neither, I want green');
    expect(button('Send as feedback').disabled).toBe(false);
    button('Send as feedback').click();
    expect(sent).toEqual([
      expect.objectContaining({ type: 'form.cancel', message: 'neither, I want green' }),
    ]);
  });
});

describe('server feedback and state', () => {
  it('shows the server error with role=alert and keeps the form editable', () => {
    const { container, setError, button } = setup();
    setError({ code: 'FormInvalidAnswerError', message: 'q0 is required' });
    const alert = [...container.querySelectorAll('[role="alert"]')].find((el) =>
      (el.textContent ?? '').includes('q0 is required'),
    );
    expect(alert).toBeDefined();
    expect(button('Submit').disabled).toBe(false);
  });

  it('locks the whole card and says Sending… while the answer travels', () => {
    const { container, setReplying, button } = setup();
    setReplying(true);
    expect(button('Submit').disabled).toBe(true);
    expect(button('Dismiss (stops the agent)').disabled).toBe(true);
    for (const input of container.querySelectorAll('fieldset')) expect(input.disabled).toBe(true);
    expect(container.textContent).toContain('Sending…');
  });

  it('titles a question as "Question from the agent" and a plain form by its title', () => {
    expect(must(setup().container, '.request-title').textContent).toBe('Question from the agent');
    const plain = setup({ ...question, kind: 'form', title: 'Deploy settings' });
    expect(must(plain.container, '.request-title').textContent).toBe('Deploy settings');
  });

  it('groups each field with a fieldset and a legend, marks required ones, and names the card', () => {
    const { container } = setup();
    const legends = [...container.querySelectorAll('fieldset > legend')].map((l) => l.textContent);
    expect(legends[0]).toContain('Letter');
    expect(legends[0]).toContain('(required)');
    expect(legends[1]).toBe('Extras');
    const card = must(container, 'section.request-card');
    expect(card.getAttribute('role')).toBe('group');
    expect(
      container.querySelector(`[id="${card.getAttribute('aria-labelledby') ?? ''}"]`),
    ).not.toBeNull();
  });

  it('says which session a form comes from and can open it', () => {
    const onOpen = vi.fn();
    const { container, button } = setup(question, { title: 'Subagent', onOpen });
    expect(must(container, '.request-origin').textContent).toContain('Subagent');
    button('Open session').click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('Enter inside an input does not submit implicitly; the Submit button still can', () => {
    const { container, choose, button, sent } = setup();
    choose('A').click();
    const enter = (target: Element): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };
    expect(enter(choose('A')).defaultPrevented).toBe(true);
    expect(enter(must(container, 'input.form-text')).defaultPrevented).toBe(true);
    expect(sent).toEqual([]);
    // A button keeps its Enter (it is a click), so a focused Submit works.
    expect(enter(button('Submit')).defaultPrevented).toBe(false);
    button('Submit').click();
    expect(sent).toHaveLength(1);
  });

  it('Escape asks to return the focus and never dismisses', () => {
    const { container, sent, onEscape } = setup();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    must(container, 'input').dispatchEvent(event);
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
  });
});
