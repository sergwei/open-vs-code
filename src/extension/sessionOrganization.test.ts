// Protects the pure organization of the Sessions tree (plan E9-sessions-organize) from the bugs an
// editable folder structure falls into: a folder moved into its own descendant (a loop the tree
// would never finish drawing), a delete that takes sessions with it instead of releasing them,
// archiving that forgets the folder (so unarchiving cannot put the session back), the same name
// twice in one folder, and a corrupt `workspaceState` value that throws at activation.
//
// Provenance: FABRICATED organizations built in this file. They prove the logic of the operations
// and of the validation; no organization written by a real VS Code was read. Operations are
// immutable, so most cases also check that the input was not touched.
import { describe, expect, it } from 'vitest';
import {
  applyDrop,
  archiveSessions,
  createFolder,
  deleteFolder,
  emptyOrganization,
  folderContents,
  folderNameProblem,
  folderOf,
  folderPath,
  isArchived,
  isPinned,
  MAX_FOLDER_NAME_LENGTH,
  moveFolder,
  moveSessions,
  organizedSessionIDs,
  pinSessions,
  pruneSessions,
  renameFolder,
  unarchiveSessions,
  unpinSessions,
  validateOrganization,
  type SessionOrganization,
} from './sessionOrganization';

/** Unwraps an operation that must have worked. */
function applied(result: { ok: boolean; org?: SessionOrganization }): SessionOrganization {
  if (!result.ok || result.org === undefined) throw new Error('the operation was refused');
  return result.org;
}

/** Spikes > SSE, Docs; sessions s1 in SSE, s2 in Spikes. */
function sample(): SessionOrganization {
  let org = emptyOrganization();
  org = applied(createFolder(org, 'f-spikes', 'Spikes'));
  org = applied(createFolder(org, 'f-sse', 'SSE', 'f-spikes'));
  org = applied(createFolder(org, 'f-docs', 'Docs'));
  org = applied(moveSessions(org, ['s1'], 'f-sse'));
  org = applied(moveSessions(org, ['s2'], 'f-spikes'));
  return org;
}

describe('creating and renaming folders', () => {
  it('trims the name, nests under a parent and leaves the input untouched', () => {
    const base = emptyOrganization();
    const made = applied(createFolder(base, 'a', '  Spikes  '));
    expect(made.folders['a']).toEqual({ name: 'Spikes' });
    expect(base.folders).toEqual({});
    const nested = applied(createFolder(made, 'b', 'SSE', 'a'));
    expect(nested.folders['b']).toEqual({ name: 'SSE', parent: 'a' });
    expect(folderPath(nested, 'b')).toEqual(['Spikes', 'SSE']);
  });

  it('refuses an empty name, one past the limit, and exactly accepts the limit', () => {
    const base = emptyOrganization();
    expect(createFolder(base, 'a', '   ')).toEqual({ ok: false, reason: 'length' });
    expect(createFolder(base, 'a', 'x'.repeat(MAX_FOLDER_NAME_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'length',
    });
    expect(createFolder(base, 'a', 'x'.repeat(MAX_FOLDER_NAME_LENGTH)).ok).toBe(true);
  });

  it('refuses a sibling with the same name in any case, but allows it in another folder', () => {
    const org = sample();
    expect(createFolder(org, 'x', 'spikes')).toEqual({ ok: false, reason: 'duplicate' });
    expect(createFolder(org, 'x', 'SSE', 'f-spikes')).toEqual({ ok: false, reason: 'duplicate' });
    expect(createFolder(org, 'x', 'SSE', 'f-docs').ok).toBe(true);
    expect(createFolder(org, 'f-docs', 'Another')).toEqual({ ok: false, reason: 'duplicate' });
    expect(createFolder(org, 'x', 'Child', 'nope')).toEqual({ ok: false, reason: 'missingFolder' });
  });

  it('renames a folder, lets it keep its own name in another case, refuses a sibling name', () => {
    const org = sample();
    expect(applied(renameFolder(org, 'f-docs', 'DOCS')).folders['f-docs']?.name).toBe('DOCS');
    expect(renameFolder(org, 'f-docs', 'Spikes')).toEqual({ ok: false, reason: 'duplicate' });
    expect(renameFolder(org, 'f-docs', '')).toEqual({ ok: false, reason: 'length' });
    expect(renameFolder(org, 'zzz', 'Name')).toEqual({ ok: false, reason: 'missingFolder' });
    expect(folderNameProblem(org, 'Docs', undefined)).toBe('duplicate');
  });
});

describe('deleting a folder', () => {
  it('removes it and its subfolders, releases every session and deletes none of them', () => {
    const org = archiveSessions(pinSessions(sample(), ['s1'], 5), ['s2'], 6);
    const result = deleteFolder(org, 'f-spikes');
    if (!result.ok) throw new Error('refused');
    expect(Object.keys(result.org.folders)).toEqual(['f-docs']);
    expect(result.org.placement).toEqual({});
    expect(result.releasedSessions.sort()).toEqual(['s1', 's2']);
    expect(result.removedFolders.sort()).toEqual(['f-spikes', 'f-sse']);
    // pins and archives are about the session, not the folder
    expect(isPinned(result.org, 's1')).toBe(true);
    expect(isArchived(result.org, 's2')).toBe(true);
    expect(folderContents(org, 'f-spikes')).toEqual({
      sessions: ['s1', 's2'],
      subfolders: ['f-sse'],
    });
  });

  it('refuses a folder that does not exist', () => {
    expect(deleteFolder(sample(), 'nope')).toEqual({ ok: false, reason: 'missingFolder' });
  });
});

describe('moving sessions', () => {
  it('moves one or several, and out of every folder with undefined', () => {
    let org = applied(moveSessions(sample(), ['s1', 's3'], 'f-docs'));
    expect(folderOf(org, 's1')).toBe('f-docs');
    expect(folderOf(org, 's3')).toBe('f-docs');
    org = applied(moveSessions(org, ['s1'], undefined));
    expect(folderOf(org, 's1')).toBeUndefined();
    expect(folderOf(org, 's3')).toBe('f-docs');
  });

  it('refuses a destination that does not exist and leaves the input alone', () => {
    const org = sample();
    expect(moveSessions(org, ['s1'], 'nope')).toEqual({ ok: false, reason: 'missingFolder' });
    expect(folderOf(org, 's1')).toBe('f-sse');
  });

  it('does not treat a session id such as "constructor" as an inherited property', () => {
    const org = applied(moveSessions(emptyOrganization(), ['constructor'], undefined));
    expect(folderOf(org, 'constructor')).toBeUndefined();
    expect(isPinned(org, 'toString')).toBe(false);
  });
});

describe('moving folders', () => {
  it('moves a folder with its content under another and back to the top', () => {
    let org = applied(moveFolder(sample(), 'f-spikes', 'f-docs'));
    expect(folderPath(org, 'f-sse')).toEqual(['Docs', 'Spikes', 'SSE']);
    org = applied(moveFolder(org, 'f-spikes', undefined));
    expect(folderPath(org, 'f-sse')).toEqual(['Spikes', 'SSE']);
  });

  it('rejects a loop: into itself and into a descendant', () => {
    const org = sample();
    expect(moveFolder(org, 'f-spikes', 'f-spikes')).toEqual({ ok: false, reason: 'cycle' });
    expect(moveFolder(org, 'f-spikes', 'f-sse')).toEqual({ ok: false, reason: 'cycle' });
    expect(moveFolder(org, 'f-spikes', 'nope')).toEqual({ ok: false, reason: 'missingFolder' });
  });

  it('rejects a move onto a sibling that has the same name', () => {
    let org = applied(createFolder(sample(), 'f-sse2', 'sse', 'f-docs'));
    org = applied(createFolder(org, 'f-x', 'Docs', 'f-spikes'));
    expect(moveFolder(org, 'f-sse2', 'f-spikes')).toEqual({ ok: false, reason: 'duplicate' });
  });
});

describe('pinning and archiving', () => {
  it('pins and unpins without touching the folder', () => {
    const org = pinSessions(sample(), ['s1'], 100);
    expect(org.pinned['s1']).toBe(100);
    expect(folderOf(org, 's1')).toBe('f-sse');
    expect(pinSessions(org, ['s1'], 999).pinned['s1']).toBe(100);
    expect(isPinned(unpinSessions(org, ['s1']), 's1')).toBe(false);
  });

  it('archiving drops the pin and keeps the folder; unarchiving brings the folder back, not the pin', () => {
    const pinned = pinSessions(sample(), ['s1'], 100);
    const archived = archiveSessions(pinned, ['s1'], 200);
    expect(isArchived(archived, 's1')).toBe(true);
    expect(isPinned(archived, 's1')).toBe(false);
    expect(folderOf(archived, 's1')).toBe('f-sse');
    expect(pinSessions(archived, ['s1'], 300).pinned).toEqual({});
    const back = unarchiveSessions(archived, ['s1']);
    expect(isArchived(back, 's1')).toBe(false);
    expect(folderOf(back, 's1')).toBe('f-sse');
    expect(isPinned(back, 's1')).toBe(false);
    expect(pinned.pinned['s1']).toBe(100); // the input was not touched
  });

  it('keeps the first archive date of a session archived twice', () => {
    const org = archiveSessions(archiveSessions(emptyOrganization(), ['a'], 1), ['a'], 2);
    expect(org.archived['a']).toBe(1);
  });
});

describe('pruneSessions', () => {
  it('forgets placement, pin and archive of the vanished sessions only', () => {
    let org = pinSessions(sample(), ['s1', 's9'], 1);
    org = archiveSessions(org, ['s2'], 2);
    const pruned = pruneSessions(org, ['s1', 's2']);
    expect(organizedSessionIDs(pruned)).toEqual(['s9']);
    expect(Object.keys(pruned.folders).sort()).toEqual(['f-docs', 'f-spikes', 'f-sse']);
  });

  it('returns the very same object when there is nothing to forget', () => {
    const org = sample();
    expect(pruneSessions(org, ['unknown'])).toBe(org);
  });
});

describe('validateOrganization', () => {
  it('round-trips a valid organization through JSON without discarding anything', () => {
    const org = archiveSessions(pinSessions(sample(), ['s3'], 7), ['s4'], 8);
    const outcome = validateOrganization(JSON.parse(JSON.stringify(org)) as unknown);
    expect(outcome.org).toEqual(org);
    expect(outcome.discarded).toBe(0);
    expect(outcome.problem).toBeUndefined();
  });

  it('gives an empty organization, with a reason, for junk and for an unknown version', () => {
    for (const junk of [undefined, null, 'text', 3, ['a']]) {
      expect(validateOrganization(junk)).toEqual({
        org: emptyOrganization(),
        discarded: 0,
        problem: 'notObject',
      });
    }
    expect(validateOrganization({ version: 2, folders: {} }).problem).toBe('version');
  });

  it('drops folders with a bad name, a missing parent or a loop, and what pointed at them', () => {
    const outcome = validateOrganization({
      version: 1,
      folders: {
        ok: { name: 'Fine' },
        child: { name: 'Child', parent: 'ok' },
        noName: { name: '  ' },
        notObject: 'x',
        orphan: { name: 'Orphan', parent: 'ghost' },
        grandchild: { name: 'G', parent: 'orphan' },
        loopA: { name: 'A', parent: 'loopB' },
        loopB: { name: 'B', parent: 'loopA' },
        badParent: { name: 'P', parent: 7 },
      },
      placement: { s1: 'child', s2: 'orphan', s3: 'ghost', s4: 5 },
      pinned: { p1: 10, p2: 'x', p3: Number.NaN },
      archived: { a1: 20, a2: null },
    });
    expect(Object.keys(outcome.org.folders).sort()).toEqual(['child', 'ok']);
    expect(outcome.org.placement).toEqual({ s1: 'child' });
    expect(outcome.org.pinned).toEqual({ p1: 10 });
    expect(outcome.org.archived).toEqual({ a1: 20 });
    // 2 bad names + orphan + grandchild + 2 loop + badParent + 3 placements + 2 pins + 1 archive
    expect(outcome.discarded).toBe(13);
  });

  it('tolerates missing sections as empty ones', () => {
    expect(validateOrganization({ version: 1 })).toEqual({
      org: emptyOrganization(),
      discarded: 0,
    });
  });
});

/**
 * Protects the drop of the Sessions tree: sessions land where the pointer was, folders can only go
 * under a folder or to the top, and a folder dropped into its own subtree is refused instead of
 * looping. Provenance: FABRICATED organizations; the gesture itself is `test:visual` step 34.
 */
describe('applyDrop', () => {
  const none = { kind: 'none' } as const;
  const onFolder = (folderID: string) => ({ kind: 'folder', folderID }) as const;
  const sessions = (...ids: string[]) => ({ sessions: ids, folders: [] });
  const folders = (...ids: string[]) => ({ sessions: [], folders: ids });

  it('applies a drop: sessions by target, folders under the target, cycles refused', () => {
    const org = sample();
    const toDocs = applyDrop(org, sessions('s1', 's3'), onFolder('f-docs'), 5);
    expect(folderOf(toDocs.org, 's1')).toBe('f-docs');
    expect(folderOf(toDocs.org, 's3')).toBe('f-docs');
    expect(folderOf(applyDrop(org, sessions('s1'), none, 5).org, 's1')).toBeUndefined();

    const pinned = applyDrop(org, sessions('s1'), { kind: 'pinned' }, 7);
    expect(pinned.org.pinned).toEqual({ s1: 7 });
    expect(folderOf(pinned.org, 's1')).toBe('f-sse');
    const archived = applyDrop(org, sessions('s1'), { kind: 'archived' }, 9);
    expect(isArchived(archived.org, 's1')).toBe(true);
    const repinned = applyDrop(archived.org, sessions('s1'), { kind: 'pinned' }, 11);
    expect(isPinned(repinned.org, 's1')).toBe(false);
    expect(isArchived(repinned.org, 's1')).toBe(true);

    const nested = applyDrop(org, folders('f-docs'), onFolder('f-sse'), 1);
    expect(folderPath(nested.org, 'f-docs')).toEqual(['Spikes', 'SSE', 'Docs']);
    const toTop = applyDrop(org, folders('f-sse'), none, 1);
    expect(folderPath(toTop.org, 'f-sse')).toEqual(['SSE']);
    const loop = applyDrop(org, folders('f-spikes'), onFolder('f-sse'), 1);
    expect(loop.refused).toEqual(['cycle']);
    expect(loop.org).toBe(org);
    expect(applyDrop(org, folders('f-docs'), onFolder('f-docs'), 1).refused).toEqual(['cycle']);
    expect(applyDrop(org, folders('f-docs'), { kind: 'pinned' }, 1).org).toBe(org);
  });
});
