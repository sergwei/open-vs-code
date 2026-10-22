/**
 * Pure text helpers of the tool cards (issue #26): reading the unified patch the server puts in
 * `metadata.files`, clipping long output for the screen, and cleaning terminal noise. No DOM and
 * no Solid, so Vitest drives them with plain strings.
 */

/** Kind of one rendered diff line: a hunk header, an addition, a deletion or unchanged context. */
export type DiffKind = 'hunk' | 'add' | 'del' | 'ctx';

/** One line of a mini diff; `text` has no leading `+`/`-`/space marker and no trailing `\r`. */
export interface DiffLine {
  kind: DiffKind;
  text: string;
}

/** Header lines `createTwoFilesPatch` writes before the first hunk. */
const PATCH_HEADER = /^(Index: |=+$|--- |\+\+\+ )/;

/** The ANSI escape introducer. Built from its code so the source has no control character. */
const ESC = String.fromCharCode(0x1b);

/** CSI sequences (colours, cursor moves, erase): `ESC [ params intermediates final`. */
const ANSI_CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

/**
 * Turns a unified patch into render lines, dropping the `Index:`, `====`, `---` and `+++` headers
 * that come before the first hunk, the `\ No newline at end of file` markers and the `\r` that a
 * CRLF file leaves at the end of every line.
 *
 * Header lines are skipped only before the first line that is not one of them; inside a hunk a
 * deleted line whose text starts with `-- ` is still a deletion. A patch with no headers (or with
 * no `@@` at all) is classified by the first character of each line, so nothing is lost. The
 * trailing empty string that `split` leaves after the final newline is not a line.
 * VERIFIED on one real patch: `test:visual` step 15 (the run of 22/10/2026 13:59-14:05, Windows 11,
 * opencode 2.0.32) edited `value2 = 2;` in `src/sample.ts`, and the open card showed 1 hunk line,
 * 1 added and 1 deleted line and no header text (checks "the edit body is a diff with added (1)
 * and deleted (1) lines", log line "edit hunk lines: 1"). HYPOTHESIS for the rest: CRLF files, a
 * patch with several hunks or files, and "\ No newline" markers were never seen in a real patch;
 * `patchLines.test.ts` uses fabricated patches, so it confirms this parser only.
 */
export function parsePatch(patch: string): DiffLine[] {
  const lines = patch.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const result: DiffLine[] = [];
  let header = true;
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (header && PATCH_HEADER.test(line)) continue;
    header = false;
    if (line.startsWith('\\')) continue;
    if (line.startsWith('@@')) result.push({ kind: 'hunk', text: line });
    else if (line.startsWith('+')) result.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) result.push({ kind: 'del', text: line.slice(1) });
    else result.push({ kind: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line });
  }
  return result;
}

/** Every line of `text` as an added diff line (the `write` tool: the whole file is new). */
export function allAdded(text: string): DiffLine[] {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => ({
    kind: 'add',
    text: line.endsWith('\r') ? line.slice(0, -1) : line,
  }));
}

/**
 * Old and new text as a "-old / +new" block, with no attempt to align them (no LCS). Used by `edit`
 * while it has no `metadata.files` yet (still running, or it failed). Decision (a) of Sergio,
 * 22/10/2026: no diff library.
 */
export function replacement(oldText: string, newText: string): DiffLine[] {
  const removed = oldText === '' ? [] : oldText.split('\n');
  const added = newText === '' ? [] : newText.split('\n');
  return [
    ...removed.map((text): DiffLine => ({ kind: 'del', text: text.replace(/\r$/, '') })),
    ...added.map((text): DiffLine => ({ kind: 'add', text: text.replace(/\r$/, '') })),
  ];
}

/** Result of clipping a list of lines: what is shown and how many were left out. */
export interface Clamped<T> {
  items: T[];
  hidden: number;
}

/**
 * Keeps at most `max` items from the start (`head`) or from the end (`tail`) of `items`.
 * `hidden` is how many were dropped, for the "Showing N of M" notice. A `max` below 1 keeps one.
 */
export function clampLines<T>(items: readonly T[], max: number, from: 'head' | 'tail'): Clamped<T> {
  const limit = Math.max(1, max);
  if (items.length <= limit) return { items: [...items], hidden: 0 };
  const kept = from === 'head' ? items.slice(0, limit) : items.slice(items.length - limit);
  return { items: kept, hidden: items.length - kept.length };
}

/** Result of {@link clipText}: the visible lines, the total, and whether anything was cut. */
export interface ClippedText {
  lines: string[];
  total: number;
  hidden: number;
  /** True when a single line was cut at the character cap (the line count alone would hide it). */
  truncatedLine: boolean;
}

/**
 * Clips `text` to `maxLines` lines and about `maxChars` characters, from the head or from the tail.
 *
 * Lines are counted first (`clampLines`) and then the character budget is spent line by line from
 * the kept end; the first line that does not fit is cut to what is left (from its start for `head`,
 * from its end for `tail`). The character cap exists because one minified line can be megabytes
 * while counting as a single line. `hidden` counts only whole lines dropped. The caller decides
 * the caps (`OutputBlock.tsx` passes its `MAX_LINES` and `MAX_CHARS`); the line break kept is `\n` whatever the source used.
 */
export function clipText(
  text: string,
  maxLines: number,
  maxChars: number,
  from: 'head' | 'tail',
): ClippedText {
  const all = text.split(/\r?\n/);
  if (all.length > 1 && all[all.length - 1] === '') all.pop();
  const clamped = clampLines(all, maxLines, from);
  const ordered = from === 'head' ? clamped.items : [...clamped.items].reverse();
  const out: string[] = [];
  let budget = Math.max(1, maxChars);
  let cut = false;
  let dropped = 0;
  for (const line of ordered) {
    if (budget <= 0) {
      dropped += 1;
      continue;
    }
    if (line.length <= budget) {
      out.push(line);
      budget -= line.length;
      continue;
    }
    out.push(from === 'head' ? line.slice(0, budget) : line.slice(line.length - budget));
    cut = true;
    budget = 0;
  }
  return {
    lines: from === 'head' ? out : out.reverse(),
    total: all.length,
    hidden: clamped.hidden + dropped,
    truncatedLine: cut,
  };
}

/** Removes ANSI colour and cursor sequences (CSI) from terminal output. OSC and others are kept. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_CSI, '');
}

/** Last segment of a path written with `/` or `\` (the tool may run on Windows or POSIX). */
export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}
