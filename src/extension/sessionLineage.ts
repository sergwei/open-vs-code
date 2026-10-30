// Who is whose ancestor among the sessions the host has seen (issue #77, delivery E4, plan Engram
// #1533). Pure: no `vscode`, no I/O. `ChatController` feeds it with every `session.upserted`, with
// the rows of each snapshot and with the `session.get` reads it makes to complete a chain, and asks
// it two questions: "does the tab of session S show a request of session X?" (`chain`) and "under
// which root does the Sessions tree mark Needs input?" (`rootOf`).
//
// Why a registry of its own and not the `parentOf` of `sessionTree.ts`: that one is a view cache
// (one level, children only, fed by the tree's events). A request can come from a grandchild, and
// the answer must not depend on whether the tree is shown, so the lineage is a fact of the host.

import type { SessionSummary } from '../shared/model';

/**
 * Longest chain walked (the session itself, its parent, its grandparent…). Our own choice: opencode
 * subagents nest a few levels at most and a longer chain is far more likely a corrupt registry than
 * a real tree; the cap also bounds the `session.get` reads of `ChatController.resolveLineage`.
 */
export const MAX_LINEAGE_DEPTH = 8;

/**
 * Most sessions remembered. Our own choice, same order of magnitude as `MAX_KNOWN_CHILDREN` of
 * `sessionTree.ts`: an entry is two short strings, and the oldest learned is forgotten first, which
 * only costs one `session.get` the day a request of such a session shows up.
 */
export const MAX_KNOWN_SESSIONS = 2000;

/** The part of a session row the lineage needs. */
export type LineageRow = Pick<SessionSummary, 'id' | 'parentID' | 'title'>;

/** How a walk up the ancestors ended; see {@link SessionLineage.walk}. */
export type LineageEnd = 'root' | 'unknown' | 'cycle' | 'cap';

/** What {@link SessionLineage.walk} found. */
export interface LineageWalk {
  /** The session, then its parent, grandparent… up to where the walk stopped (see `end`). */
  ids: string[];
  /**
   * `root`: the last id is a root whose row is known. `unknown`: the last id has no row, so its
   * parent cannot be told (one `session.get` would tell). `cycle` / `cap`: the registry is
   * inconsistent or deeper than {@link MAX_LINEAGE_DEPTH}; the walk gives up.
   */
  end: LineageEnd;
}

/** The registry returned by {@link createSessionLineage}. */
export interface SessionLineage {
  /**
   * Learns the rows. A row without `parentID` is a KNOWN root. A parent is never forgotten because
   * a later row lacks it (a session cannot change parent, so such a row is a partial one). The
   * title is updated only when the row carries one. Returns `true` when the registry learned
   * something it did not know (a new id, a new parent, a new title).
   */
  learn(rows: Iterable<LineageRow>): boolean;
  /** Forgets one session (deleted). Its children then end their chain in `unknown`. */
  forget(id: string): void;
  /** Forgets everything (another folder: ids belong to a location). */
  clear(): void;
  /** Walks up from `id`; see {@link LineageWalk}. An id never seen yields `{ ids: [id], end: 'unknown' }`. */
  walk(id: string): LineageWalk;
  /** `id` and its ancestors, as far as known. */
  chain(id: string): string[];
  /** The root of `id`'s tree, or `undefined` when the chain does not end at a known root. */
  rootOf(id: string): string | undefined;
  /**
   * The id whose row is missing and would complete the chain of `id` (to `session.get`), or
   * `undefined` when the chain is complete or hopeless (cycle, cap).
   */
  unresolved(id: string): string | undefined;
  /** The title learned for `id`, if any. */
  titleOf(id: string): string | undefined;
}

/** One remembered session: `parent` is `null` for a known root. */
type Entry = { parent: string | null; title: string | undefined };

/**
 * Creates an empty registry. Insertion order is recency of learning (a re-learned id moves to the
 * end), so the cap forgets the least recently seen.
 * VERIFIED by `sessionLineage.test.ts` with fabricated rows (logic only; the shape of a real
 * `parentID` is VERIFIED by the spike of #21 for `session.created`, opencode 2.0.32). HYPOTHESIS
 * that `session.list` without a `parentID` filter lists children (risk R3 of the plan): if it does
 * not, the chain is completed by `session.get`.
 */
export function createSessionLineage(): SessionLineage {
  const entries = new Map<string, Entry>();

  /** Walks up from `id` without mutating anything. */
  const walk = (id: string): LineageWalk => {
    const ids = [id];
    let current = id;
    for (;;) {
      const entry = entries.get(current);
      if (entry === undefined) return { ids, end: 'unknown' };
      if (entry.parent === null) return { ids, end: 'root' };
      if (ids.includes(entry.parent)) return { ids, end: 'cycle' };
      if (ids.length >= MAX_LINEAGE_DEPTH) return { ids, end: 'cap' };
      ids.push(entry.parent);
      current = entry.parent;
    }
  };

  return {
    learn(rows) {
      let learned = false;
      for (const row of rows) {
        const before = entries.get(row.id);
        const parent = row.parentID ?? before?.parent ?? null;
        const title = row.title ?? before?.title;
        if (before === undefined || before.parent !== parent || before.title !== title) {
          learned = true;
        }
        entries.delete(row.id);
        entries.set(row.id, { parent, title });
        if (entries.size > MAX_KNOWN_SESSIONS) {
          const oldest = entries.keys().next();
          if (oldest.done !== true) entries.delete(oldest.value);
        }
      }
      return learned;
    },

    forget(id) {
      entries.delete(id);
    },

    clear() {
      entries.clear();
    },

    walk,

    chain(id) {
      return walk(id).ids;
    },

    rootOf(id) {
      const found = walk(id);
      return found.end === 'root' ? found.ids[found.ids.length - 1] : undefined;
    },

    unresolved(id) {
      const found = walk(id);
      return found.end === 'unknown' ? found.ids[found.ids.length - 1] : undefined;
    },

    titleOf(id) {
      return entries.get(id)?.title;
    },
  };
}
