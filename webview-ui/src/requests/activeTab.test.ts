// Protects the tab rules of the request dock: the active tab follows its request by id (a new
// permission inserted before a form does not move it) and, when it is resolved, the tab in its
// position takes over. A regression here is a box that changes under the user's eyes or lands on a
// request that was not the one they were reading.
//
// Provenance: FABRICATED ids; the rules are pure, nothing here touches the server or a DOM.
import { describe, expect, it } from 'vitest';
import { resolveActive, tabKeyTarget } from './activeTab';

describe('resolveActive', () => {
  it.each([
    ['requested is still pending: it wins', ['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 'c', 'c'],
    ['requested is gone: the previous active stays', ['a', 'b'], ['a', 'b'], 'b', 'zzz', 'b'],
    [
      'active resolved in the middle: the next one',
      ['a', 'b', 'c'],
      ['a', 'c'],
      'b',
      undefined,
      'c',
    ],
    ['active resolved at the end: the new last', ['a', 'b', 'c'], ['a', 'b'], 'c', undefined, 'b'],
    [
      'active resolved at the start: the new first',
      ['a', 'b', 'c'],
      ['b', 'c'],
      'a',
      undefined,
      'b',
    ],
    ['cascade removes the active and more', ['a', 'b', 'c', 'd'], ['a'], 'c', undefined, 'a'],
    [
      'a permission inserted before the active form: unchanged',
      ['f1'],
      ['p1', 'f1'],
      'f1',
      undefined,
      'f1',
    ],
    ['first request ever: the first one', [], ['a', 'b'], undefined, undefined, 'a'],
    ['empty list: nothing', ['a'], [], 'a', undefined, undefined],
  ] as const)('%s', (_name, previous, current, active, requested, expected) => {
    expect(resolveActive(previous, current, active, requested)).toBe(expected);
  });
});

describe('tabKeyTarget', () => {
  it('moves with the arrows and wraps at both ends', () => {
    expect(tabKeyTarget('ArrowRight', 0, 3)).toBe(1);
    expect(tabKeyTarget('ArrowRight', 2, 3)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 1, 3)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 0, 3)).toBe(2);
  });

  it('jumps to the extremes with Home and End', () => {
    expect(tabKeyTarget('Home', 2, 3)).toBe(0);
    expect(tabKeyTarget('End', 0, 3)).toBe(2);
  });

  it('ignores other keys, and a row of one stays on itself', () => {
    expect(tabKeyTarget('Enter', 0, 3)).toBeUndefined();
    expect(tabKeyTarget('a', 0, 3)).toBeUndefined();
    expect(tabKeyTarget('ArrowRight', 0, 1)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 0, 1)).toBe(0);
    expect(tabKeyTarget('Home', 0, 0)).toBeUndefined();
  });
});
