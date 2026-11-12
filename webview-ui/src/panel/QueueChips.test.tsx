// Protects the chips of the queued prompts (issue #188): the text of a queued and of a steering
// chip, which buttons each one has, that the callbacks get the item, that Edit is `aria-disabled`
// without an empty box, and the focus rules after a chip is removed (next chip, else the prompt box,
// only when the focus was lost and the document has it).
//
// Provenance: the component alone in jsdom with FABRICATED items and a store-less parent. `hasFocus`
// is stubbed (jsdom answers false with nothing focused). They confirm the wiring, not the ellipsis
// in a narrow bar (`test:visual` step 54, phase 5).
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedPrompt } from '../../../src/shared/model';
import { mount, type Mounted } from '../testing';
import { QueueChips } from './QueueChips';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
  vi.restoreAllMocks();
});

const item = (
  id: string,
  text: string,
  delivery: QueuedPrompt['delivery'] = 'queue',
): QueuedPrompt => ({
  id,
  text,
  delivery,
  files: 0,
});

/** Mounts the chips over a signal holding the list, with spies for the callbacks. */
function setup(initial: QueuedPrompt[], canEdit = true) {
  const [items, setItems] = createSignal(initial);
  const calls = {
    remove: vi.fn<(entry: QueuedPrompt) => void>(),
    steer: vi.fn<(entry: QueuedPrompt) => void>(),
    edit: vi.fn<(entry: QueuedPrompt) => void>(),
    focusInput: vi.fn(),
  };
  mounted = mount(() => (
    <QueueChips
      items={items()}
      canEdit={canEdit}
      onRemove={calls.remove}
      onSteer={calls.steer}
      onEdit={calls.edit}
      focusInput={calls.focusInput}
    />
  ));
  const chips = () => [...(mounted?.container.querySelectorAll<HTMLElement>('.queue-chip') ?? [])];
  return { calls, chips, setItems };
}

describe('QueueChips', () => {
  it('draws nothing for an empty list', () => {
    setup([]);
    expect(mounted?.container.querySelector('.queue-chips')).toBeNull();
  });

  // Also protects review S2: the accessible name of Steer now, Edit and the remove button ends with
  // the short text of the prompt, so several chips are told apart.
  it('reads Queued with Steer now, Edit and the remove button; a steering chip has no Steer now', () => {
    const { chips } = setup([item('i1', 'write the tests'), item('i2', 'urgent', 'steer')]);
    const [queued, steering] = chips();
    expect(queued?.querySelector('.queue-chip-text')?.textContent).toBe(
      'Queued: "write the tests"',
    );
    expect([...(queued?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Steer now',
      'Edit',
      '×',
    ]);
    expect(
      queued?.querySelector('[aria-label="Remove from queue: \\"write the tests\\""]'),
    ).not.toBeNull();
    expect(
      [...(queued?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'Steer now: "write the tests"',
      'Edit: "write the tests"',
      'Remove from queue: "write the tests"',
    ]);
    expect(steering?.querySelector('.queue-chip-text')?.textContent).toBe('Steering: "urgent"');
    expect([...(steering?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Edit',
      '×',
    ]);
  });

  it('flattens whitespace and cuts a very long text', () => {
    const { chips } = setup([item('i1', `a\n\n  b${'x'.repeat(400)}`)]);
    const text = chips()[0]?.querySelector('.queue-chip-text')?.textContent ?? '';
    expect(text.startsWith('Queued: "a bxxx')).toBe(true);
    expect(text.endsWith('…"')).toBe(true);
    expect(text.length).toBeLessThan(330);
  });

  it('hands the item to the callbacks', () => {
    const entry = item('i1', 'go');
    const { calls, chips } = setup([entry]);
    const buttons = chips()[0]?.querySelectorAll('button') ?? [];
    buttons[0]?.click();
    buttons[1]?.click();
    buttons[2]?.click();
    expect(calls.steer.mock.calls[0]?.[0].id).toBe('i1');
    expect(calls.edit.mock.calls[0]?.[0].id).toBe('i1');
    expect(calls.remove.mock.calls[0]?.[0].id).toBe('i1');
  });

  it('marks Edit aria-disabled, not disabled, when the box is not empty', () => {
    const { chips } = setup([item('i1', 'go')], false);
    const edit = chips()[0]?.querySelectorAll('button')[1];
    expect(edit?.getAttribute('aria-disabled')).toBe('true');
    expect(edit?.disabled).toBe(false);
  });

  // Protects the focus after removing a chip: the document has the focus, the removed chip's button
  // had it (so `activeElement` fell to body), the list now lacks that id.
  it('moves the focus to the chip now in its place, else to the prompt box', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { calls, chips, setItems } = setup([item('i1', 'one'), item('i2', 'two')]);
    chips()[0]?.querySelectorAll('button')[2]?.click();
    setItems([item('i2', 'two')]);
    expect(document.activeElement).toBe(chips()[0]?.querySelector('button'));
    expect(calls.focusInput).not.toHaveBeenCalled();
    chips()[0]?.querySelectorAll('button')[2]?.click();
    (document.activeElement as HTMLElement | null)?.blur();
    setItems([]);
    expect(calls.focusInput).toHaveBeenCalledTimes(1);
  });

  // Protects the focus after "Steer now": the pressed button unmounts when the chip turns into a
  // steering one, so the focus would fall to body. It goes to the NEXT chip, else the prompt box.
  // FABRICATED list changes in jsdom; `hasFocus` stubbed.
  it('moves the focus to the next chip, else to the prompt box, after Steer now', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { calls, chips, setItems } = setup([item('i1', 'one'), item('i2', 'two')]);
    const steerButton = chips()[0]?.querySelector('button');
    steerButton?.focus();
    steerButton?.click();
    expect(calls.steer.mock.calls[0]?.[0].id).toBe('i1');
    setItems([item('i1', 'one', 'steer'), item('i2', 'two')]);
    expect(document.activeElement).toBe(chips()[1]?.querySelector('button'));
    expect(calls.focusInput).not.toHaveBeenCalled();
    // The last chip: nothing after it, so the prompt box.
    const last = chips()[1]?.querySelector('button');
    last?.focus();
    last?.click();
    setItems([item('i1', 'one', 'steer'), item('i2', 'two', 'steer')]);
    expect(calls.focusInput).toHaveBeenCalledTimes(1);
  });

  it('after Steer now treats a chip the server delivered at once like a removed one', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { calls, chips, setItems } = setup([item('i1', 'one'), item('i2', 'two')]);
    chips()[0]?.querySelector('button')?.click();
    setItems([item('i2', 'two')]);
    expect(document.activeElement).toBe(chips()[0]?.querySelector('button'));
    expect(calls.focusInput).not.toHaveBeenCalled();
  });

  it('leaves the focus alone after Steer now when the document has none or it is elsewhere', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { calls, chips, setItems } = setup([item('i1', 'one'), item('i2', 'two')]);
    chips()[0]?.querySelector('button')?.click();
    setItems([item('i1', 'one', 'steer'), item('i2', 'two')]);
    expect(calls.focusInput).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
    hasFocus.mockReturnValue(true);
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    chips()[1]?.querySelector('button')?.click();
    setItems([item('i1', 'one', 'steer'), item('i2', 'two', 'steer')]);
    expect(document.activeElement).toBe(outside);
    expect(calls.focusInput).not.toHaveBeenCalled();
    outside.remove();
  });

  it('does not move the focus when the document has none, or when it is somewhere else', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const { calls, setItems, chips } = setup([item('i1', 'one'), item('i2', 'two')]);
    chips()[0]?.querySelectorAll('button')[2]?.click();
    setItems([item('i2', 'two')]);
    expect(calls.focusInput).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
    hasFocus.mockReturnValue(true);
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    chips()[0]?.querySelectorAll('button')[2]?.click();
    setItems([]);
    expect(document.activeElement).toBe(outside);
    expect(calls.focusInput).not.toHaveBeenCalled();
    outside.remove();
  });
});
