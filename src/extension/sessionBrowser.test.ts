// Protects the paging of the session list (issue #20) from the ways it goes wrong quietly:
//   - a "Show more" that repeats the first page (cursor lost) or leaks the query into a cursor
//     from ANOTHER search (the rows of search A glued under search B);
//   - "there is more" decided by the presence of `cursor.next`, which the real server returns on
//     EVERY non-empty page, so the button would never go away;
//   - an older answer arriving last and overwriting the cursor of the list on screen.
//
// Provenance: FABRICATED answers shaped like `SessionsResponse`. The behaviours they copy (cursor on
// every non-empty page, `parentID: null` for roots, a cursor-only request keeping its filters) were
// seen by the planner spike against a real opencode 2.0.32 (Windows 11, 21/10/2026); these tests
// prove our logic, not that spike. The wire round trip is in `chatController.e2e.test.ts`.
import type { SessionInfo } from '@opencode/client';
import { describe, expect, it } from 'vitest';
import { createSessionBrowser } from './sessionBrowser';

const row = (id: string): SessionInfo =>
  JSON.parse(
    JSON.stringify({
      id,
      projectID: 'p',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: 'C:\\work' },
    }),
  ) as SessionInfo;

const rows = (count: number): SessionInfo[] =>
  Array.from({ length: count }, (_, index) => row(`ses_${String(index)}`));

describe('first page', () => {
  it('asks for root sessions of the folder, newest first, with the page size', () => {
    const browser = createSessionBrowser({ pageSize: 3 });
    expect(browser.query('', false, 'C:\\work').input).toEqual({
      directory: 'C:\\work',
      order: 'desc',
      limit: 3,
      parentID: null,
    });
  });

  it('trims the search and leaves it out when it is blank', () => {
    const browser = createSessionBrowser({ pageSize: 3 });
    expect(browser.query('  beta ', false, 'D').input).toMatchObject({ search: 'beta' });
    expect(browser.query('   ', false, 'D').input).not.toHaveProperty('search');
  });
});

describe('more', () => {
  it('sends ONLY the cursor of the previous answer and marks the page as appended', () => {
    const browser = createSessionBrowser({ pageSize: 2 });
    const first = browser.query('beta', false, 'D');
    expect(first.accept({ data: rows(2), cursor: { next: 'CUR1' } })).toMatchObject({
      append: false,
      hasMore: true,
    });
    const second = browser.query('beta', true, 'D');
    expect(second.input).toEqual({ cursor: 'CUR1' });
    expect(second.accept({ data: rows(1), cursor: { next: 'CUR2' } })).toMatchObject({
      append: true,
      hasMore: false,
    });
  });

  it('starts a new list when there is no cursor yet, or when the search changed', () => {
    const browser = createSessionBrowser({ pageSize: 2 });
    expect(browser.query('a', true, 'D').input).toMatchObject({ limit: 2, search: 'a' });
    browser.query('a', false, 'D').accept({ data: rows(2), cursor: { next: 'CUR1' } });
    const other = browser.query('b', true, 'D');
    expect(other.input).toMatchObject({ limit: 2, search: 'b' });
    expect(other.accept({ data: rows(2), cursor: {} })).toMatchObject({ append: false });
  });

  it('treats the search with different padding or an empty one as the same', () => {
    const browser = createSessionBrowser({ pageSize: 2 });
    browser.query(' a ', false, 'D').accept({ data: rows(2), cursor: { next: 'CUR1' } });
    expect(browser.query('a', true, 'D').input).toEqual({ cursor: 'CUR1' });
  });
});

describe('hasMore', () => {
  it('comes from the page size, never from the presence of a cursor', () => {
    const browser = createSessionBrowser({ pageSize: 2 });
    // The real server returns `cursor.next` on the last page too (planner spike).
    const page = browser.query('', false, 'D').accept({ data: rows(1), cursor: { next: 'LAST' } });
    expect(page.hasMore).toBe(false);
    expect(browser.query('', false, 'D').accept({ data: rows(2), cursor: {} }).hasMore).toBe(true);
  });

  it('maps the rows for the protocol', () => {
    const browser = createSessionBrowser({ pageSize: 2 });
    const page = browser.query('', false, 'D').accept({ data: rows(1), cursor: {} });
    expect(page.rows).toEqual([
      {
        id: 'ses_0',
        createdAt: 1,
        updatedAt: 2,
        usage: {
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        },
      },
    ]);
  });
});

describe('overlap and reset', () => {
  it('keeps the cursor of the NEWEST query when an older answer arrives last', () => {
    const browser = createSessionBrowser({ pageSize: 2 });
    const older = browser.query('a', false, 'D');
    const newer = browser.query('ab', false, 'D');
    newer.accept({ data: rows(2), cursor: { next: 'NEWER' } });
    older.accept({ data: rows(2), cursor: { next: 'OLDER' } });
    expect(browser.query('ab', true, 'D').input).toEqual({ cursor: 'NEWER' });
  });

  it('forgets the cursor on reset, and an answer still in flight does not bring it back', () => {
    const browser = createSessionBrowser({ pageSize: 2 });
    const inFlight = browser.query('', false, 'D');
    browser.reset();
    inFlight.accept({ data: rows(2), cursor: { next: 'STALE' } });
    expect(browser.query('', true, 'D').input).toMatchObject({ limit: 2 });
  });
});
