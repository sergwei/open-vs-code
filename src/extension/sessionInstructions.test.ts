// Protects the pure side of the pinned instructions (issue #188): which text is stored, the keys the
// host generates (they must pass the server's key rule and never collide with a listed one), how
// an entry another client wrote is shown, and the ledger that decides which key may be removed.
// Provenance: FABRICATED entries and a scripted `random`; the key rule is the one read in the tag
// (`^[a-z0-9][a-z0-9._-]*$`), not one observed from a server.
import { describe, expect, it } from 'vitest';
import { INSTRUCTION_KEY_PATTERN, MAX_INSTRUCTION_LENGTH } from '../shared/protocol';
import {
  InstructionLedger,
  instructionText,
  newInstructionKey,
  toInstructionViews,
} from './sessionInstructions';

describe('instructionText', () => {
  /** Protects the host's revalidation: blank and over-long text are refused, the rest is trimmed. */
  it('refuses blank and too long text', () => {
    expect(instructionText('')).toBeUndefined();
    expect(instructionText(' \n\t ')).toBeUndefined();
    expect(instructionText('x'.repeat(MAX_INSTRUCTION_LENGTH + 1))).toBeUndefined();
    expect(instructionText('x'.repeat(MAX_INSTRUCTION_LENGTH))).toHaveLength(
      MAX_INSTRUCTION_LENGTH,
    );
    expect(instructionText('  keep it short \n')).toBe('keep it short');
  });

  /** Protects the cap against padding: the limit applies to the trimmed text the server will store. */
  it('measures the limit on the trimmed text', () => {
    expect(instructionText(` ${'x'.repeat(MAX_INSTRUCTION_LENGTH)} `)).toHaveLength(
      MAX_INSTRUCTION_LENGTH,
    );
  });
});

describe('newInstructionKey', () => {
  /** Protects the server's key rule and uniqueness: a `random` that first repeats a taken key. */
  it('generates a key the server accepts and skips taken ones', () => {
    const first = newInstructionKey(new Set(), 1_700_000_000_000, () => 0.5);
    expect(first).toMatch(INSTRUCTION_KEY_PATTERN);
    expect(first.startsWith('note-')).toBe(true);
    const draws = [0.5, 0.5, 0.25];
    const next = newInstructionKey(new Set([first]), 1_700_000_000_000, () => draws.shift() ?? 0.9);
    expect(next).not.toBe(first);
    expect(next).toMatch(INSTRUCTION_KEY_PATTERN);
    expect(draws).toEqual([]);
  });

  /** Protects the padding: a tiny random still gives a fixed-width suffix (and a valid key). */
  it('pads the random part', () => {
    const key = newInstructionKey(new Set(), 1, () => 0);
    expect(key).toBe('note-10000');
    expect(key).toMatch(INSTRUCTION_KEY_PATTERN);
  });
});

describe('toInstructionViews', () => {
  /** Protects the display of foreign entries: a string as it is, anything else as readable JSON. */
  it('shows a string as it is and any other value as JSON', () => {
    expect(
      toInstructionViews([
        { key: 'note-a', value: 'hello' },
        { key: 'obj', value: { a: [1, 2] } },
        { key: 'num', value: 3 },
        { key: 'nil', value: null },
      ]),
    ).toEqual([
      { key: 'note-a', text: 'hello', json: false },
      { key: 'obj', text: '{\n  "a": [\n    1,\n    2\n  ]\n}', json: true },
      { key: 'num', text: '3', json: true },
      { key: 'nil', text: 'null', json: true },
    ]);
    expect(toInstructionViews([])).toEqual([]);
  });
});

describe('InstructionLedger', () => {
  /** Protects the remove guard: what was listed per session, a copy, forgotten on request. */
  it('remembers what it listed per session', () => {
    const ledger = new InstructionLedger();
    expect(ledger.lists('ses_a', 'note-a')).toBe(false);
    expect(ledger.viewsOf('ses_a')).toEqual([]);
    const views = [{ key: 'note-a', text: 'x', json: false }];
    ledger.record('ses_a', views);
    views.push({ key: 'note-b', text: 'y', json: false });
    expect(ledger.keysOf('ses_a')).toEqual(new Set(['note-a']));
    expect(ledger.lists('ses_a', 'note-a')).toBe(true);
    expect(ledger.lists('ses_a', 'note-b')).toBe(false);
    expect(ledger.lists('ses_b', 'note-a')).toBe(false);
    ledger.record('ses_a', []);
    expect(ledger.lists('ses_a', 'note-a')).toBe(false);
    ledger.record('ses_a', views);
    ledger.record('ses_b', views);
    ledger.forget('ses_a');
    expect(ledger.viewsOf('ses_a')).toEqual([]);
    expect(ledger.lists('ses_b', 'note-b')).toBe(true);
    ledger.clear();
    expect(ledger.lists('ses_b', 'note-b')).toBe(false);
  });
});
