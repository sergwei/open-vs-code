/**
 * Unit tests for `modToggles.ts` (E10-mod-toggles, issue #181).
 *
 * Protects against: a stored list that is not a clean list of ids (a profile edited by hand or
 * written by another version) reaching the loader, a toggle that is not idempotent or leaves an
 * empty array behind, and a window with no folder writing the workspace memento.
 *
 * ALL DATA IS FABRICATED: the memento is a Map-backed double, so these cases prove the list logic,
 * not what VS Code stores in a real profile (that is measured by step 45 of `test:visual`).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MODS_DISABLED_KEY,
  createDisabledStore,
  parseDisabled,
  withToggled,
  type DisabledMemento,
} from './modToggles';

/** A memento over a Map; `update` is a spy so a test sees every write. */
function fakeMemento(initial?: unknown): {
  memento: DisabledMemento;
  values: Map<string, unknown>;
  update: ReturnType<typeof vi.fn>;
} {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set(MODS_DISABLED_KEY, initial);
  const update = vi.fn((key: string, value: unknown) => {
    if (value === undefined) values.delete(key);
    else values.set(key, value);
    return Promise.resolve();
  });
  return { memento: { get: (key) => values.get(key), update }, values, update };
}

describe('parseDisabled', () => {
  it('keeps valid unique ids and drops the rest', () => {
    expect(parseDisabled(['a', 'b-1', 'a'])).toEqual(['a', 'b-1']);
    expect(
      parseDisabled(['ok', 3, null, { id: 'x' }, '', 'UPPER', '../x', 'x'.repeat(65)]),
    ).toEqual(['ok']);
  });

  it('gives an empty list for a value that is not an array', () => {
    for (const value of [undefined, null, 'a', 7, { 0: 'a', length: 1 }]) {
      expect(parseDisabled(value), JSON.stringify(value)).toEqual([]);
    }
  });
});

describe('withToggled', () => {
  it('adds an id when switched off, removes it when switched on, sorted', () => {
    expect(withToggled(['b'], 'a', false)).toEqual(['a', 'b']);
    expect(withToggled(['a', 'b'], 'a', true)).toEqual(['b']);
  });

  it('is idempotent', () => {
    expect(withToggled(['a'], 'a', false)).toEqual(['a']);
    expect(withToggled([], 'a', true)).toBeUndefined();
  });

  it('gives undefined when nothing is left off', () => {
    expect(withToggled(['a'], 'a', true)).toBeUndefined();
    expect(withToggled([], 'a', true)).toBeUndefined();
  });
});

describe('createDisabledStore', () => {
  it('reads and writes the key of the memento, and clears the key when the list is empty', async () => {
    const { memento, values, update } = fakeMemento(['b', 7, 'b']);
    const store = createDisabledStore(memento);
    expect(store.persisted).toBe(true);
    expect(store.read()).toEqual(['b']);
    await store.write(['a', 'b']);
    expect(update).toHaveBeenCalledWith(MODS_DISABLED_KEY, ['a', 'b']);
    expect(store.read()).toEqual(['a', 'b']);
    await store.write(undefined);
    expect(update).toHaveBeenLastCalledWith(MODS_DISABLED_KEY, undefined);
    expect(values.has(MODS_DISABLED_KEY)).toBe(false);
  });

  it('without a memento keeps the list in memory and touches nothing else', async () => {
    const store = createDisabledStore();
    expect(store.persisted).toBe(false);
    expect(store.read()).toEqual([]);
    await store.write(['a']);
    expect(store.read()).toEqual(['a']);
    await store.write([]);
    expect(store.read()).toEqual([]);
  });
});
