/**
 * Bounded trace of the focus handoff of the Providers tab (issue #151, follow-up of #143).
 *
 * `test:visual` step 36 (F1/F2) sometimes ends with `hasFocus` true and the `body` active, and the
 * final state alone cannot say which sequence led there. The section records what happened here and
 * publishes it as JSON in the `data-focus-trace` attribute of `.settings-providers`, which the
 * harness reads through `inDoc` without any new host message.
 *
 * The trace never stores values, text, ids of DOM nodes or the key: the fields are limited to
 * `hasFocus`, provider ids, tag names, closed reasons and counters, and `record` copies only the
 * whitelisted keys, so a caller cannot leak anything by accident.
 */

/** The moments the section annotates (closed union; the tests and a human reading S1-S4 look at these names). */
export type FocusTraceEvent =
  | 'arm'
  | 'window-focus'
  | 'serve'
  | 'poll-start'
  | 'poll-stop'
  | 'attempt-end'
  | 'disarm'
  | 'card-focusout'
  | 'focusin';

/** Why something happened (closed union, so a trace never carries free text). */
export type FocusTraceWhy =
  | 'take-focus'
  | 'attempt-end'
  | 'served'
  | 'left-active'
  | 'no-doc-focus'
  | 'no-card'
  | 'id-changed'
  | 'nothing-armed'
  | 'focusin-other'
  | 'cleanup'
  | 'direct'
  | 'limit';

/** The active element reduced to its tag name and `data-provider`; never its value or text. */
export interface ActiveDescription {
  tag: string;
  provider: string | null;
}

/** The optional fields of an entry. `hf` is `document.hasFocus()`, `armed` the parked provider id. */
export interface FocusTraceFields {
  hf?: boolean;
  armed?: string | null;
  act?: ActiveDescription;
  why?: FocusTraceWhy;
  ticks?: number;
  card?: boolean;
}

/** One annotation: `n` counts up forever, `t` is whole milliseconds of the window's clock. */
export interface FocusTraceEntry extends FocusTraceFields {
  n: number;
  t: number;
  e: FocusTraceEvent;
}

/** Handle returned by `createFocusTrace`. `serialize` is what ends up in the DOM attribute. */
export interface FocusTrace {
  record: (e: FocusTraceEvent, fields?: FocusTraceFields) => void;
  entries: () => readonly FocusTraceEntry[];
  serialize: () => string;
}

/**
 * Describes `doc.activeElement` with its tag name and `data-provider` only.
 *
 * Nothing else is read (no `value`, `textContent`, `id` or `aria-*`), because the active element
 * can be the key field or the search box. With nothing focused it returns the tag `BODY` (the usual `activeElement`) or, when
 * `activeElement` is `null`, the tag `NONE`; the provider is null in both.
 */
export function describeActive(doc: Document): ActiveDescription {
  const element = doc.activeElement;
  if (element === null) return { tag: 'NONE', provider: null };
  return { tag: element.tagName, provider: element.getAttribute('data-provider') };
}

/**
 * Creates a ring buffer of annotations.
 *
 * Bounded so a long session cannot grow the attribute without limit. 40 comes from counting: the
 * F1 flow and the F2 flow of `test:visual` step 36 wrote 13 entries each in the full run of
 * 3/11/2026 (Windows 11, VS Code 1.144.1; entries counted in the printed `focus trace F1:` and
 * `focus trace F2:` lines), so 40 holds three flows. `n` is a monotonic counter besides `t` because every window has its
 * own `performance` clock: the harness marks the last `n` before a key press and asks for the
 * entries after it, which does not depend on where the clock started. `now` is injectable so tests
 * need no real clock; `t` is rounded to whole milliseconds to keep the attribute short.
 */
export function createFocusTrace(
  limit = 40,
  now: () => number = () => performance.now(),
): FocusTrace {
  let entries: FocusTraceEntry[] = [];
  let counter = 0;
  return {
    record(e, fields = {}) {
      counter++;
      const entry: FocusTraceEntry = { n: counter, t: Math.round(now()), e };
      if (fields.hf !== undefined) entry.hf = fields.hf;
      if (fields.armed !== undefined) entry.armed = fields.armed;
      if (fields.act !== undefined) {
        entry.act = { tag: fields.act.tag, provider: fields.act.provider };
      }
      if (fields.why !== undefined) entry.why = fields.why;
      if (fields.ticks !== undefined) entry.ticks = fields.ticks;
      if (fields.card !== undefined) entry.card = fields.card;
      entries.push(entry);
      if (entries.length > limit) entries = entries.slice(entries.length - limit);
    },
    entries: () => entries,
    serialize: () => JSON.stringify(entries),
  };
}
