// Where the organization of the sessions (`sessionOrganization.ts`) is kept between windows: one
// entry per served folder inside ONE `workspaceState` key (E9-sessions-organize, decision Q1=1).
// Pure: it only needs something shaped like a `vscode.Memento`, so Vitest drives it with a fake whose
// writes finish out of order (risk R6 of the plan). The VS Code glue is `sessionsOrganize.ts`.

import {
  emptyOrganization,
  validateOrganization,
  type SessionOrganization,
} from './sessionOrganization';

/** The part of `vscode.Memento` the store uses; a `vscode.Memento` satisfies it. */
export interface MementoLike {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** What the store needs from the outside. */
export interface OrganizationStoreOptions {
  memento: MementoLike;
  /** The `workspaceState` key the whole map lives under. */
  key: string;
  /** Reports what loading threw away and write failures; never throws. */
  log?: { warn(message: string): void };
}

/** The store returned by {@link createOrganizationStore}. */
export interface OrganizationStore {
  /**
   * Switches to `folder` (the served folder), reading its entry from the memento on the first call
   * and validating it (a broken value gives an empty organization and a warning, never an
   * exception). Returns the organization now held. Calling it again for the folder in use returns
   * what is in memory.
   */
  use(folder: string): SessionOrganization;
  /** The folder in use, or `undefined` before the first {@link use}. */
  folder(): string | undefined;
  /** The organization in use (empty before the first {@link use}). */
  current(): SessionOrganization;
  /**
   * Replaces the organization in memory at once and queues the write. Returns `false` (and writes
   * nothing) when `next` is the object already held or no folder is in use.
   */
  set(next: SessionOrganization): boolean;
  /** Resolves when every write queued so far has finished (tests and the Test command await it). */
  flush(): Promise<void>;
}

/**
 * Creates the store. Memory is the source of truth: `set` is synchronous, so the tree repaints at
 * once, and the writes go through a promise queue where each one starts after the previous one
 * finished. A write saves the whole map as it is when the write STARTS, not as it was when it was
 * queued, so even a memento that resolves out of order ends holding the newest organization.
 * Why a queue (risk R6): HYPOTHESIS that two `Memento.update` calls in flight keep their order; the
 * queue makes the question moot at the cost of one write at a time.
 * The map is read from the memento ONCE; entries of folders other than the one in use are written
 * back exactly as they were read (not validated, not dropped), so a window that serves another
 * folder of a multi-root workspace loses nothing.
 * VERIFIED by `organizationStore.test.ts` (Vitest, Windows 11, 01/11/2026): "ends holding the
 * newest organization when the memento finishes its writes out of order". That memento is a FAKE:
 * it proves the queue, not what a real `workspaceState` does on disk. The real Memento is read
 * back by `fakeServer.test.ts` ("organizes sessions in folders, pins and archives them, and
 * deleting a folder deletes no session" and "forgets the organization of a session that is
 * deleted"), which passed in `test:integration` (Windows 11, 01/11/2026). Not observed: a write
 * that fails, or a window reload on Linux or macOS.
 */
export function createOrganizationStore(options: OrganizationStoreOptions): OrganizationStore {
  const { memento, key, log } = options;
  let folder: string | undefined;
  let organization: SessionOrganization = emptyOrganization();
  /** The map as read once, with the organizations held since then; what a write saves. */
  let all: Record<string, unknown> | undefined;
  let queue: Promise<void> = Promise.resolve();

  /** The map from the memento: anything but a plain object is an empty map. */
  const readAll = (): Record<string, unknown> => {
    const stored = memento.get(key);
    return typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? { ...(stored as Record<string, unknown>) }
      : {};
  };

  return {
    use(next) {
      if (folder === next) return organization;
      folder = next;
      all ??= readAll();
      const read = Object.hasOwn(all, next) ? all[next] : undefined;
      if (read === undefined) {
        organization = emptyOrganization();
        return organization;
      }
      const validated = validateOrganization(read);
      organization = validated.org;
      if (validated.problem !== undefined || validated.discarded > 0) {
        log?.warn(
          `session organization: ${validated.problem ?? 'partly unusable'}, ${String(validated.discarded)} entries discarded`,
        );
      }
      return organization;
    },

    folder: () => folder,

    current: () => organization,

    set(next) {
      if (folder === undefined || next === organization) return false;
      organization = next;
      const map = (all ??= readAll());
      map[folder] = next;
      queue = queue
        .then(() => memento.update(key, { ...map }))
        .catch((error: unknown) => {
          log?.warn(`session organization not saved: ${String(error)}`);
        });
      return true;
    },

    flush: () => queue,
  };
}
