/**
 * Pure helpers that turn session rows into what the session list shows (issue #20): the date
 * groups ("Today", "Yesterday", ...), the time/date text of a row and the label of a title.
 * No DOM and no Solid, so Vitest drives them with plain dates.
 */
import type { SessionSummary } from '../../../src/shared/model';

// The label helpers moved to `src/shared` so the host can title editor tabs with the same text.
export { EMPTY_TITLE, sessionLabel } from '../../../src/shared/sessionLabel';

/** Names of the date groups, newest first. */
export type GroupLabel = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';

/** One date group of the list; groups with no rows are never produced. */
export interface SessionGroup {
  label: GroupLabel;
  rows: SessionSummary[];
}

/** Midnight (local time) of the day that holds `ts`, shifted by `days` calendar days. */
function startOfDay(ts: number, days = 0): number {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

/** The group `ts` falls in, as seen from `now`. A timestamp from the future counts as today. */
function groupOf(ts: number, now: number): GroupLabel {
  if (ts >= startOfDay(now)) return 'Today';
  if (ts >= startOfDay(now, -1)) return 'Yesterday';
  if (ts >= startOfDay(now, -7)) return 'Previous 7 days';
  return 'Older';
}

/**
 * Splits `rows` (already ordered, newest first) into date groups, keeping their order. The day
 * boundaries are LOCAL midnights, computed with calendar arithmetic so a daylight-saving change
 * does not move a row to the wrong group; the groups use `updatedAt` (last activity), which is
 * what the server orders by. VERIFIED by `sessionGroups.test.ts` with dates built from local
 * components (so the test does not depend on the time zone of the machine).
 */
export function groupSessions(rows: readonly SessionSummary[], now: number): SessionGroup[] {
  const groups: SessionGroup[] = [];
  for (const row of rows) {
    const label = groupOf(row.updatedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

/**
 * Short text for the time of a row: the hour today, the weekday and hour within the last week,
 * the date beyond it. Uses the locale of the webview (`Intl` with `undefined`, HYPOTHESIS that it
 * is the language of VS Code; to check, open the list with another display language).
 */
export function formatSessionTime(ts: number, now: number): string {
  const date = new Date(ts);
  const group = groupOf(ts, now);
  if (group === 'Today') {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  if (group === 'Yesterday' || group === 'Previous 7 days') {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}
