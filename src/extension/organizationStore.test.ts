import { describe, expect, it } from 'vitest';
import { createOrganizationStore, type MementoLike } from './organizationStore';
import { createFolder, emptyOrganization, type SessionOrganization } from './sessionOrganization';

const KEY = 'test.organization';

/** Unwraps an operation that must succeed. */
function folderIn(org: SessionOrganization, id: string, name: string): SessionOrganization {
  const result = createFolder(org, id, name);
  if (!result.ok) throw new Error(`fixture: ${result.reason}`);
  return result.org;
}

/**
 * A fabricated Memento: `stored` is what a later window would read, `delays` are how many
 * microtask turns each successive `update` takes to finish (so writes can finish out of order).
 */
function fakeMemento(initial: unknown, delays: number[] = []) {
  const state = { stored: initial, calls: 0, finished: [] as unknown[] };
  const memento: MementoLike = {
    get: () => state.stored,
    update: async (_key, value) => {
      const delay = delays[state.calls] ?? 0;
      state.calls += 1;
      for (let turn = 0; turn < delay; turn += 1) await Promise.resolve();
      state.stored = value;
      state.finished.push(value);
    },
  };
  return { memento, state };
}

/**
 * Protects the persistence of the folders, pins and archive (E9-sessions-organize): a read of a
 * damaged value must not throw, and two writes in a row must not leave the OLDER organization on
 * disk (risk R6). Provenance: a FABRICATED memento, not a real `workspaceState`.
 */
describe('createOrganizationStore', () => {
  it('starts empty for a folder with no entry, and reads the entry of the folder it serves', () => {
    const saved = folderIn(emptyOrganization(), 'f1', 'Docs');
    const { memento } = fakeMemento({ '/a': saved, '/b': emptyOrganization() });
    const store = createOrganizationStore({ memento, key: KEY });
    expect(store.use('/c')).toEqual(emptyOrganization());
    expect(store.use('/a').folders['f1']?.name).toBe('Docs');
    expect(store.folder()).toBe('/a');
  });

  it('turns an unreadable value into an empty organization and says so, without throwing', () => {
    const warnings: string[] = [];
    const { memento } = fakeMemento({ '/a': 'garbage', '/b': { version: 9 } });
    const store = createOrganizationStore({
      memento,
      key: KEY,
      log: { warn: (message) => warnings.push(message) },
    });
    expect(store.use('/a')).toEqual(emptyOrganization());
    expect(store.use('/b')).toEqual(emptyOrganization());
    expect(warnings).toHaveLength(2);
    const broken = createOrganizationStore({ memento: fakeMemento([1, 2]).memento, key: KEY });
    expect(broken.use('/a')).toEqual(emptyOrganization());
  });

  it('does not write when nothing changed or no folder is in use', async () => {
    const { memento, state } = fakeMemento(undefined);
    const store = createOrganizationStore({ memento, key: KEY });
    expect(store.set(emptyOrganization())).toBe(false);
    store.use('/a');
    expect(store.set(store.current())).toBe(false);
    await store.flush();
    expect(state.calls).toBe(0);
  });

  it('keeps the entries of other folders exactly as they were read', async () => {
    const other = { version: 1, somethingNew: true };
    const { memento, state } = fakeMemento({ '/other': other });
    const store = createOrganizationStore({ memento, key: KEY });
    store.use('/a');
    store.set(folderIn(store.current(), 'f1', 'Docs'));
    await store.flush();
    const written = state.stored as Record<string, unknown>;
    expect(written['/other']).toBe(other);
    expect(Object.keys(written).sort()).toEqual(['/a', '/other']);
  });

  it('ends holding the newest organization when the memento finishes its writes out of order', async () => {
    // The first update is slow (5 turns), the second and third are instant: without the queue the
    // slow one would finish last and put the OLDEST organization on disk.
    const { memento, state } = fakeMemento(undefined, [5, 0, 0]);
    const store = createOrganizationStore({ memento, key: KEY });
    store.use('/a');
    store.set(folderIn(store.current(), 'f1', 'One'));
    store.set(folderIn(store.current(), 'f2', 'Two'));
    store.set(folderIn(store.current(), 'f3', 'Three'));
    await store.flush();
    const stored = (state.stored as Record<string, SessionOrganization>)['/a'];
    expect(Object.keys(stored?.folders ?? {}).sort()).toEqual(['f1', 'f2', 'f3']);
    expect(state.calls).toBe(3);
  });

  it('keeps writing after a failed write and reports it', async () => {
    const warnings: string[] = [];
    let calls = 0;
    const memento: MementoLike = {
      get: () => undefined,
      update: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('disk full')) : Promise.resolve();
      },
    };
    const store = createOrganizationStore({
      memento,
      key: KEY,
      log: { warn: (message) => warnings.push(message) },
    });
    store.use('/a');
    store.set(folderIn(store.current(), 'f1', 'One'));
    store.set(folderIn(store.current(), 'f2', 'Two'));
    await store.flush();
    expect(calls).toBe(2);
    expect(warnings).toHaveLength(1);
  });
});
