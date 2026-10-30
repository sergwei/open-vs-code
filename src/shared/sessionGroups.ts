/**
 * Pure helpers that turn session rows into what a session list shows (issue #20, moved here for
 * issue #77 phase E3): the date groups ("Today", "Yesterday", ...) and the time/date text of a row.
 * They live in `src/shared` because the webview picker and the host's native Sessions tree must
 * group and date a row the same way, and the host may not reach into the webview folder
 * (architecture boundaries in `eslint.config.mjs`). No DOM, no Solid and no `vscode`, so Vitest
 * drives them with plain dates. The webview's `sessionGroups.ts` re-exports every name.
 */
import type { SessionSummary } from './model';

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
 * what the server orders by. VERIFIED (Vitest, Windows 11, 29/10/2026) by the cases of
 * `sessionTree.test.ts` "files the rows in date groups, newest first, and adds "Show more
 * sessions" only while there is more", which builds its dates from local components so it does
 * not depend on the time zone of the machine.
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
 * the date beyond it. `locale` is a BCP 47 tag; the webview passes none (`Intl` default, HYPOTHESIS
 * that it is the language of VS Code; to check, open the list with another display language) and
 * the host passes `vscode.env.language`. VERIFIED by `sessionGroups.test.ts` "formats the time
 * with an explicit locale" (Windows 11); an unknown tag falls back to the default locale inside
 * `Intl`, which was not exercised.
 */
export function formatSessionTime(ts: number, now: number, locale?: string): string {
  const date = new Date(ts);
  const group = groupOf(ts, now);
  if (group === 'Today') {
    return formatter(locale, 'time', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  if (group === 'Yesterday' || group === 'Previous 7 days') {
    return formatter(locale, 'weekday', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }
  return formatter(locale, 'date', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** Formatters by locale and shape: the host's tree dates hundreds of rows on every event (S2). */
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The cached `Intl.DateTimeFormat` of `shape` for `locale`, built on first use. */
function formatter(
  locale: string | undefined,
  shape: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${shape}`;
  let found = formatters.get(key);
  if (found === undefined) {
    found = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, found);
  }
  return found;
}
