// Protects the date groups and the time text of the session list (issue #20) from the classic date
// bugs: a row filed under the wrong day around midnight, a daylight-saving change moving the week
// boundary, a "Today" built from a UTC day, and a group shown with no rows.
//
// Provenance: dates are built from LOCAL components (`new Date(year, month, day, hour)`), so the
// expected groups do not depend on the time zone of the machine that runs the test. Fabricated
// rows; they prove the grouping logic, not what the server returns.
import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '../../../src/shared/model';
import { EMPTY_TITLE, formatSessionTime, groupSessions, sessionLabel } from './sessionGroups';

/** Local time on 21 Oct 2026 (a Wednesday), 15:30: the "now" of every test. */
const NOW = new Date(2026, 9, 21, 15, 30).getTime();

const row = (id: string, updatedAt: number, title?: string): SessionSummary => ({
  id,
  createdAt: 0,
  updatedAt,
  ...(title === undefined ? {} : { title }),
});

describe('groupSessions', () => {
  it('files rows by the local day of their last activity, newest group first', () => {
    const rows = [
      row('today-morning', new Date(2026, 9, 21, 0, 0, 1).getTime()),
      row('yesterday-late', new Date(2026, 9, 20, 23, 59, 59).getTime()),
      row('yesterday-early', new Date(2026, 9, 20, 0, 0, 0).getTime()),
      row('week-edge', new Date(2026, 9, 14, 0, 0, 0).getTime()),
      row('older', new Date(2026, 9, 13, 23, 59, 59).getTime()),
    ];
    expect(groupSessions(rows, NOW).map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['Today', ['today-morning']],
      ['Yesterday', ['yesterday-late', 'yesterday-early']],
      ['Previous 7 days', ['week-edge']],
      ['Older', ['older']],
    ]);
  });

  it('omits the groups that would be empty', () => {
    const groups = groupSessions([row('a', NOW), row('b', new Date(2025, 0, 1).getTime())], NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Older']);
    expect(groupSessions([], NOW)).toEqual([]);
  });

  it('counts a timestamp from the future (clock skew) as today', () => {
    expect(groupSessions([row('a', NOW + 3 * 86_400_000)], NOW)[0]?.label).toBe('Today');
  });

  it('uses calendar days, not 24-hour blocks: just after midnight, 20 hours ago is still yesterday', () => {
    const justAfterMidnight = new Date(2026, 9, 21, 0, 10).getTime();
    const lastEvening = new Date(2026, 9, 20, 19, 30).getTime();
    expect(groupSessions([row('a', lastEvening)], justAfterMidnight)[0]?.label).toBe('Yesterday');
  });
});

describe('formatSessionTime', () => {
  it('shows only the hour for today, and the year for an old row', () => {
    const today = formatSessionTime(new Date(2026, 9, 21, 9, 5).getTime(), NOW);
    expect(today).toMatch(/9|09/);
    expect(today).not.toMatch(/2026/);
    expect(formatSessionTime(new Date(2024, 2, 3, 12, 0).getTime(), NOW)).toMatch(/2024/);
  });

  it('adds a weekday for yesterday and the last week', () => {
    const yesterday = formatSessionTime(new Date(2026, 9, 20, 18, 0).getTime(), NOW);
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(
      new Date(2026, 9, 20),
    );
    expect(yesterday).toContain(weekday);
  });
});

describe('sessionLabel', () => {
  it('falls back to the placeholder for a missing or blank title', () => {
    expect(sessionLabel({})).toBe(EMPTY_TITLE);
    expect(sessionLabel({ title: '   ' })).toBe(EMPTY_TITLE);
    expect(sessionLabel({ title: ' Fix the build ' })).toBe('Fix the build');
  });
});
