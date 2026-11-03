import { describe, expect, it } from 'vitest';
import { createFocusTrace, describeActive } from './focusTrace';

describe('focus trace', () => {
  /**
   * Protects the bound of the ring buffer: the attribute that carries it must not grow forever.
   * Fabricated input, injected clock.
   */
  it('keeps only the last `limit` entries', () => {
    const trace = createFocusTrace(3, () => 0);
    for (let i = 0; i < 5; i++) trace.record('arm');
    expect(trace.entries().map((entry) => entry.n)).toEqual([3, 4, 5]);
  });

  /**
   * Protects the filter "entries after the mark" of the harness: `n` must keep counting although
   * old entries were dropped, or a mark taken before a wrap would match the wrong entries.
   */
  it('keeps counting `n` after entries were discarded', () => {
    const trace = createFocusTrace(2, () => 0);
    for (let i = 0; i < 4; i++) trace.record('serve');
    trace.record('disarm');
    expect(trace.entries().at(-1)?.n).toBe(5);
  });

  /** Protects the transport: the harness `JSON.parse`s the attribute. */
  it('serializes to parseable JSON with whole-millisecond times', () => {
    const trace = createFocusTrace(40, () => 12.7);
    trace.record('window-focus', { hf: false, armed: 'acme' });
    const parsed: unknown = JSON.parse(trace.serialize());
    expect(parsed).toEqual([{ n: 1, t: 13, e: 'window-focus', hf: false, armed: 'acme' }]);
  });

  /**
   * Protects the privacy rule: an entry has only whitelisted keys even if a caller passes extras
   * (cast on purpose: the type already forbids it, the copy is the second line of defence).
   */
  it('copies only the whitelisted keys', () => {
    const trace = createFocusTrace(40, () => 0);
    const sneaky = { hf: true, value: 'SECRET', text: 'SECRET' } as never;
    trace.record('arm', sneaky);
    const allowed = new Set(['n', 't', 'e', 'hf', 'armed', 'act', 'why', 'ticks', 'card']);
    for (const key of Object.keys(trace.entries()[0] ?? {})) expect(allowed.has(key)).toBe(true);
    expect(trace.serialize()).not.toContain('SECRET');
  });

  /** Protects the privacy rule for the active element: a typed value never reaches the trace. */
  it('describes the active element without its value', () => {
    const input = document.createElement('input');
    input.value = 'SECRET';
    input.setAttribute('data-provider', 'acme');
    document.body.append(input);
    input.focus();
    const described = describeActive(document);
    input.remove();
    expect(described).toEqual({ tag: 'INPUT', provider: 'acme' });
    expect(JSON.stringify(described)).not.toContain('SECRET');
  });
});
