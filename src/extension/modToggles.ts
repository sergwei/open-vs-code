// The per-workspace list of mods the user switched off (E10-mod-toggles, issue #181; plan Engram
// #1995, decisions #1993 and #1997). PURE: no `vscode` import, so Vitest drives it (`modToggles.test.ts`).
//
// Why a list of DISABLED ids and not of enabled ones: a mod that appears in the folder later starts
// on by default in every workspace, with nothing to migrate. Why per workspace: `modsLifecycle.ts`
// hands this module the `workspaceState` memento of the extension, which VS Code keeps in the user
// profile (`<workspaceStorage>/<workspace.id>/state.vscdb`), never inside the opened folder, so a
// repository cannot write the list (plan #1995 section 3, read in VS Code 1.105.0, not run). A list
// can only REMOVE execution, and mods are still loaded only from the extension's own folder (P4).

import { MOD_ID_PATTERN } from '../shared/protocol';

/** Key of the list in `workspaceState`; same naming as `OPEN_SESSION_BY_FOLDER_KEY` (`chatLifecycle.ts`). */
export const MODS_DISABLED_KEY = 'openVsCode.mods.disabled';

/** The part of `vscode.Memento` this module needs, so a test can fabricate it. */
export interface DisabledMemento {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** Where the list lives. `persisted` is false when it only lasts as long as the window. */
export interface DisabledStore {
  read(): string[];
  /** Replaces the list; `undefined` (or an empty list) clears it. */
  write(list: readonly string[] | undefined): Promise<void>;
  readonly persisted: boolean;
}

/**
 * Turns whatever was stored into a clean list: only strings that are valid mod ids, each once, in
 * order. Anything else (a non-array, a number inside, an id with `..` or capitals) is dropped, because
 * the stored value is data written by an older or a hand-edited profile, not something to trust.
 * VERIFIED by `modToggles.test.ts` "parseDisabled keeps valid unique ids and drops the rest" with
 * fabricated values (Windows 11, 07/11/2026); a real profile was not read.
 */
export function parseDisabled(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    if (typeof item === 'string' && MOD_ID_PATTERN.test(item)) seen.add(item);
  }
  return [...seen];
}

/**
 * The list after switching `id` on (`enabled` true: removed) or off (added), sorted and without
 * duplicates, or `undefined` when nothing is left off, so the stored key disappears instead of
 * keeping an empty array. Idempotent: the same call twice gives the same list.
 */
export function withToggled(
  list: readonly string[],
  id: string,
  enabled: boolean,
): string[] | undefined {
  const next = new Set(list);
  if (enabled) next.delete(id);
  else next.add(id);
  return next.size === 0 ? undefined : [...next].sort();
}

/**
 * Builds the {@link DisabledStore}: over `memento` (reads and writes {@link MODS_DISABLED_KEY}, always
 * through {@link parseDisabled}), or, without one, in memory (a window with no folder: its
 * `workspace.id` is random per window, so persisting would be unpredictable; decision #1997).
 * `Memento.update` changes the in-memory value synchronously (read in VS Code 1.105.0
 * `extHostMemento.ts`), and the loader still runs read, compute and write inside one queue, so
 * two toggles cannot overwrite each other.
 * VERIFIED by `modToggles.test.ts` "createDisabledStore reads and writes the key of the memento" and
 * "... without a memento keeps the list in memory and touches nothing else" (fabricated memento).
 */
export function createDisabledStore(memento?: DisabledMemento): DisabledStore {
  if (memento === undefined) {
    let held: string[] = [];
    return {
      read: () => [...held],
      write: (list) => {
        held = parseDisabled(list);
        return Promise.resolve();
      },
      persisted: false,
    };
  }
  return {
    read: () => parseDisabled(memento.get(MODS_DISABLED_KEY)),
    write: async (list) => {
      const clean = parseDisabled(list);
      await memento.update(MODS_DISABLED_KEY, clean.length === 0 ? undefined : clean);
    },
    persisted: true,
  };
}
