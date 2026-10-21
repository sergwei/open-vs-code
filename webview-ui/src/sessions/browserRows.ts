/**
 * Pure operations on the rows of the session list (issue #20). The list is a copy of what the
 * server returned for the current search, kept in step with the events while it is open; these
 * functions never mutate their input, so the store can hand the result to `reconcile`.
 */
import type { SessionSummary } from '../../../src/shared/model';

/** Newest activity first, the id as tie-break: the order the server uses (VERIFIED, planner spike). */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  return b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1);
}

/**
 * True when `row` would be returned by the server for `search`: the title contains it,
 * case-insensitively. The server uses `LIKE '%x%'`, where `%` and `_` are wildcards and only ASCII
 * is case-folded; this is the same without the wildcards, so a search for `_` may keep out a row
 * the server would have returned (a small, accepted difference). An empty search matches all.
 */
function matchesSearch(row: SessionSummary, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') return true;
  return (row.title ?? '').toLowerCase().includes(needle);
}

/**
 * Applies one page: `append` adds its rows after the ones held (a row already held is replaced by
 * the page's copy, so a session that moved between two requests is not shown twice), otherwise the
 * page replaces the list.
 */
export function applyPage(
  rows: readonly SessionSummary[],
  page: { sessions: readonly SessionSummary[]; append: boolean },
): SessionSummary[] {
  if (!page.append) return [...page.sessions];
  const incoming = new Map(page.sessions.map((row) => [row.id, row]));
  const kept = rows.map((row) => incoming.get(row.id) ?? row);
  const known = new Set(rows.map((row) => row.id));
  return [...kept, ...page.sessions.filter((row) => !known.has(row.id))];
}

/**
 * Applies a `session.upserted`: a held row is updated in place, a new ROOT row is inserted when its
 * title matches `search`, and the list is re-sorted by recency (a rename bumps `updatedAt`, so the
 * row moves to the top). A child session (it has `parentID`) never belongs to the list, which is
 * roots only, and a row that no longer matches the search leaves it.
 */
export function upsertRow(
  rows: readonly SessionSummary[],
  row: SessionSummary,
  search: string,
): SessionSummary[] {
  if (row.parentID !== undefined) return [...rows];
  const without = rows.filter((held) => held.id !== row.id);
  if (!matchesSearch(row, search)) return without;
  return [...without, row].sort(byRecency);
}

/** Applies a `session.removed`: the row, if held, is dropped. */
export function removeRow(rows: readonly SessionSummary[], sessionID: string): SessionSummary[] {
  return rows.filter((row) => row.id !== sessionID);
}
