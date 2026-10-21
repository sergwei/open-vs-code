// Protects the rows of the session list (issue #20) from the ways an event-driven list rots: a page
// that duplicates a row, a rename that leaves the row where it was, a child session (subagent)
// appearing in a list of roots, and a search that keeps a row whose title no longer matches.
//
// Provenance: fabricated rows. They prove the list logic, not what the server returns.
import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '../../../src/shared/model';
import { applyPage, removeRow, upsertRow } from './browserRows';

const row = (id: string, updatedAt: number, title?: string, parentID?: string): SessionSummary => ({
  id,
  createdAt: 0,
  updatedAt,
  ...(title === undefined ? {} : { title }),
  ...(parentID === undefined ? {} : { parentID }),
});

const ids = (rows: readonly SessionSummary[]) => rows.map((r) => r.id);

describe('applyPage', () => {
  it('replaces the list when the page does not append', () => {
    expect(ids(applyPage([row('a', 1)], { sessions: [row('b', 2)], append: false }))).toEqual([
      'b',
    ]);
  });

  it('appends without duplicating a row that moved between two requests', () => {
    const held = [row('a', 3, 'old title'), row('b', 2)];
    const next = applyPage(held, { sessions: [row('b', 2), row('c', 1)], append: true });
    expect(ids(next)).toEqual(['a', 'b', 'c']);
    // A row present in both takes the page's copy.
    const refreshed = applyPage(held, { sessions: [row('a', 3, 'new title')], append: true });
    expect(refreshed[0]?.title).toBe('new title');
  });

  it('does not mutate its input', () => {
    const held = [row('a', 1)];
    applyPage(held, { sessions: [row('b', 0)], append: true });
    expect(ids(held)).toEqual(['a']);
  });
});

describe('upsertRow', () => {
  it('updates in place and re-sorts: a rename bumps the row to the top', () => {
    const held = [row('a', 3), row('b', 2), row('c', 1)];
    const next = upsertRow(held, row('c', 9, 'renamed'), '');
    expect(ids(next)).toEqual(['c', 'a', 'b']);
    expect(next[0]?.title).toBe('renamed');
  });

  it('breaks a tie of update time by id, descending, like the server', () => {
    expect(ids(upsertRow([row('a', 5)], row('b', 5), ''))).toEqual(['b', 'a']);
  });

  it('inserts a new ROOT row, but never a child session', () => {
    const held = [row('a', 1)];
    expect(ids(upsertRow(held, row('n', 5, 'new'), ''))).toEqual(['n', 'a']);
    expect(ids(upsertRow(held, row('child', 5, 'sub', 'a'), ''))).toEqual(['a']);
  });

  it('inserts only a row whose title matches the search, case-insensitively', () => {
    const held = [row('a', 1, 'beta one')];
    expect(ids(upsertRow(held, row('n', 5, 'Beta two'), 'BETA'))).toEqual(['n', 'a']);
    expect(ids(upsertRow(held, row('m', 5, 'alpha'), 'beta'))).toEqual(['a']);
    // An untitled session never matches a search, like the server's LIKE on the title.
    expect(ids(upsertRow(held, row('u', 5), 'beta'))).toEqual(['a']);
  });

  it('drops a held row whose new title no longer matches the search', () => {
    const held = [row('a', 1, 'beta one'), row('b', 0, 'beta two')];
    expect(ids(upsertRow(held, row('a', 5, 'gamma'), 'beta'))).toEqual(['b']);
  });
});

describe('removeRow', () => {
  it('drops the row and ignores an unknown id', () => {
    const held = [row('a', 2), row('b', 1)];
    expect(ids(removeRow(held, 'a'))).toEqual(['b']);
    expect(ids(removeRow(held, 'zzz'))).toEqual(['a', 'b']);
  });
});
