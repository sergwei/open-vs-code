// Protects the arrow-key recall of prompts: going back and forth must return the draft the user
// was typing (losing it would make the history a trap), duplicates must not pile up, and the
// list must stay bounded.
//
// Provenance: fabricated strings; pure logic, nothing about the textarea.
import { describe, expect, it } from 'vitest';
import { createHistory, MAX_HISTORY } from './promptHistory';

describe('createHistory', () => {
  it('walks back to older prompts and forward to the saved draft', () => {
    const history = createHistory(['one', 'two', 'three']);
    expect(history.prev('typing')).toBe('three');
    expect(history.prev('ignored')).toBe('two');
    expect(history.next()).toBe('three');
    expect(history.next()).toBe('typing');
    expect(history.next()).toBeUndefined();
  });

  it('stops at the oldest prompt', () => {
    const history = createHistory(['one', 'two']);
    history.prev('');
    history.prev('');
    expect(history.prev('')).toBeUndefined();
  });

  it('does nothing when empty', () => {
    const history = createHistory([]);
    expect(history.prev('draft')).toBeUndefined();
    expect(history.next()).toBeUndefined();
  });

  it('ignores blank prompts and a repeat of the newest one', () => {
    const history = createHistory([]);
    history.push('a');
    history.push('a');
    history.push('   ');
    history.push('b');
    history.push('a');
    expect(history.entries()).toEqual(['a', 'b', 'a']);
  });

  it('keeps only the newest MAX_HISTORY entries', () => {
    const history = createHistory([]);
    for (let index = 0; index < MAX_HISTORY + 10; index++) history.push(`p${String(index)}`);
    expect(history.entries()).toHaveLength(MAX_HISTORY);
    expect(history.entries().at(-1)).toBe(`p${String(MAX_HISTORY + 9)}`);
    expect(history.entries()[0]).toBe('p10');
  });

  it('trims seed entries to the limit', () => {
    const seed = Array.from({ length: 5 }, (_, index) => `s${String(index)}`);
    expect(createHistory(seed, 3).entries()).toEqual(['s2', 's3', 's4']);
  });

  it('starts a new browse from the current draft after push or reset', () => {
    const history = createHistory(['one']);
    history.prev('first draft');
    history.reset();
    expect(history.prev('second draft')).toBe('one');
    expect(history.next()).toBe('second draft');
    history.prev('x');
    history.push('two');
    expect(history.prev('y')).toBe('two');
  });
});
