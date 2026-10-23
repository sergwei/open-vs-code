// Pure logic of the event-shape check (`npm run test:event-shapes`, tooling/tests-without-model):
// reduces the SSE events of one turn to their SHAPE (which paths exist, of which types, which are
// optional) and compares two such recordings. No `vscode`, no network, no process: Vitest drives it
// with fabricated events (`eventShapes.test.ts`), so those tests prove THIS logic, never that a
// real opencode emits any particular shape. What the check is for: the synthetic opencode
// (`fake-opencode.mjs`) is what `npm run test:visual` and the e2e suites run on; this is how it is
// compared with a real server's turn, when a model is available (`eventShapes.contract.ts`).

/** The shape of one event type: for every path, the value types seen there and whether it is optional. */
export type EventShape = Record<string, { types: string[]; optional: boolean }>;

/** A recording reduced to shapes, keyed by event `type`. */
export type EventShapes = Record<string, EventShape>;

/** The kinds of difference {@link diffShapes} reports. */
export type DiffKind =
  | 'event-only-real'
  | 'event-only-fake'
  | 'path-only-real'
  | 'path-only-fake'
  | 'type-mismatch'
  | 'optional-mismatch';

/** One difference between the real and the fake recording. */
export interface ShapeDiff {
  event: string;
  /** Absent for the two `event-only-*` kinds. */
  path?: string;
  kind: DiffKind;
  /** Types (or `optional`/`required`) on the real side; absent when the path is not there. */
  real?: string;
  fake?: string;
}

/** An accepted difference: a conscious decision, with the reason it is acceptable. */
export interface AllowEntry {
  /** Absent = every event type (what a `location.*` envelope entry needs). */
  event?: string;
  /**
   * Absent = every path of that event for that kind. A trailing `.*` is a prefix: `location.*`
   * covers `location` itself and everything under `location.`; any other value is an exact path.
   */
  path?: string;
  kind: DiffKind;
  reason: string;
}

/** Result of {@link diffShapes}. */
export interface DiffResult {
  /** Differences nobody accepted: the check fails when there are any. */
  diffs: ShapeDiff[];
  /** Differences an {@link AllowEntry} covers, kept so the output can say what was waved through. */
  accepted: ShapeDiff[];
  /** Entries of the allow list that matched nothing: the difference they excused has gone. */
  stale: AllowEntry[];
}

/** Name of the JSON type of a leaf, `undefined` for what JSON does not carry. */
function leafType(value: unknown): string | undefined {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return undefined;
  }
}

/** True for a plain JSON object (not an array, not null). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The path segment for `value` stored under `key`: the key itself, or, for a tool `state` object
 * (it has a string `status`), `state[status=completed]`, so the four states of a tool block do not
 * merge into one set of optional keys.
 */
function keySegment(key: string, value: unknown): string {
  if (key === 'state' && isObject(value) && typeof value['status'] === 'string') {
    return `state[status=${value['status']}]`;
  }
  return key;
}

/**
 * Adds every path of `value` (rooted at `path`) to `out`, mapping a path to the set of types seen.
 *
 * Objects add the type `object` at their own path and recurse into their keys; arrays add `array`
 * and recurse into the elements under `<path>[]`; an object element that has a string `type` goes
 * under `<path>[type=<that value>]`, so the three kinds of block of a message (`text`,
 * `reasoning`, `tool`) keep their own keys. `undefined` is skipped (JSON never carries it).
 */
function collectPaths(value: unknown, path: string, out: Map<string, Set<string>>): void {
  const note = (type: string): void => {
    const known = out.get(path) ?? new Set<string>();
    known.add(type);
    out.set(path, known);
  };
  const leaf = leafType(value);
  if (leaf !== undefined) {
    note(leaf);
    return;
  }
  if (Array.isArray(value)) {
    note('array');
    for (const element of value) {
      const tag = isObject(element) && typeof element['type'] === 'string' ? element['type'] : '';
      collectPaths(element, tag === '' ? `${path}[]` : `${path}[type=${tag}]`, out);
    }
    return;
  }
  if (isObject(value)) {
    note('object');
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      collectPaths(
        child,
        path === '' ? keySegment(key, child) : `${path}.${keySegment(key, child)}`,
        out,
      );
    }
  }
}

/**
 * Whether the check looks at an event type: the ones a turn is made of (`session.*`,
 * `permission.*`, `form.*`) and the first frame. Everything else a server publishes on the
 * stream (model refreshes, project updates, ...) is noise for the question "does the fake match a
 * turn".
 */
export function isTurnEvent(type: string): boolean {
  return (
    type === 'server.connected' ||
    type.startsWith('session.') ||
    type.startsWith('permission.') ||
    type.startsWith('form.')
  );
}

/**
 * Reduces the events of a recording to {@link EventShapes}.
 *
 * Events are grouped by their string `type` (events without one are skipped, as are those
 * {@link isTurnEvent} rejects). Occurrences of the same type are merged: a path has the union of
 * its types and is `optional` when some occurrence of that event lacks it. The whole event is
 * flattened, envelope included (`id`, `created`, `type`, `data...`, `location`, `durable`).
 */
export function shapesOf(events: readonly unknown[]): EventShapes {
  const byType = new Map<string, Array<Map<string, Set<string>>>>();
  for (const event of events) {
    if (!isObject(event) || typeof event['type'] !== 'string' || !isTurnEvent(event['type'])) {
      continue;
    }
    const paths = new Map<string, Set<string>>();
    for (const [key, child] of Object.entries(event)) {
      if (child !== undefined) collectPaths(child, keySegment(key, child), paths);
    }
    const list = byType.get(event['type']) ?? [];
    list.push(paths);
    byType.set(event['type'], list);
  }
  const result: EventShapes = {};
  for (const [type, occurrences] of byType) {
    const merged = new Map<string, { types: Set<string>; seen: number }>();
    for (const paths of occurrences) {
      for (const [path, types] of paths) {
        const entry = merged.get(path) ?? { types: new Set<string>(), seen: 0 };
        for (const kind of types) entry.types.add(kind);
        entry.seen += 1;
        merged.set(path, entry);
      }
    }
    const shape: EventShape = {};
    for (const path of [...merged.keys()].sort()) {
      const entry = merged.get(path);
      if (entry === undefined) continue;
      shape[path] = { types: [...entry.types].sort(), optional: entry.seen < occurrences.length };
    }
    result[type] = shape;
  }
  return result;
}

/**
 * Whether `entry` excuses `diff`: same kind, the event when the entry names one, and the path
 * exactly or, for an entry ending in `.*`, by prefix (`location.*` matches `location` and
 * `location.region`, not `locations`). An entry with a path never covers a whole-event diff.
 */
function covers(entry: AllowEntry, diff: ShapeDiff): boolean {
  if (entry.kind !== diff.kind) return false;
  if (entry.event !== undefined && entry.event !== diff.event) return false;
  if (entry.path === undefined) return true;
  if (diff.path === undefined) return false;
  if (!entry.path.endsWith('.*')) return entry.path === diff.path;
  const prefix = entry.path.slice(0, -2);
  return diff.path === prefix || diff.path.startsWith(`${prefix}.`);
}

/**
 * Compares the real and the fake recording.
 *
 * Per event type: only on one side -> `event-only-real` / `event-only-fake`; on both, per path:
 * only in the real one -> `path-only-real`, only in the fake one -> `path-only-fake`, different
 * type sets -> `type-mismatch`, one optional and the other not -> `optional-mismatch`. A
 * difference an {@link AllowEntry} covers moves to `accepted`; an entry that covers nothing is
 * `stale` (the thing it excused is gone: drop the entry). The order is stable (event, then path,
 * then kind).
 */
export function diffShapes(
  real: EventShapes,
  fake: EventShapes,
  allow: readonly AllowEntry[] = [],
): DiffResult {
  const all: ShapeDiff[] = [];
  for (const event of [...new Set([...Object.keys(real), ...Object.keys(fake)])].sort()) {
    const realShape = real[event];
    const fakeShape = fake[event];
    if (realShape === undefined) {
      all.push({ event, kind: 'event-only-fake' });
      continue;
    }
    if (fakeShape === undefined) {
      all.push({ event, kind: 'event-only-real' });
      continue;
    }
    for (const path of [
      ...new Set([...Object.keys(realShape), ...Object.keys(fakeShape)]),
    ].sort()) {
      const r = realShape[path];
      const f = fakeShape[path];
      if (r === undefined && f !== undefined) {
        all.push({ event, path, kind: 'path-only-fake', fake: f.types.join('|') });
      } else if (f === undefined && r !== undefined) {
        all.push({ event, path, kind: 'path-only-real', real: r.types.join('|') });
      } else if (r !== undefined && f !== undefined) {
        if (r.types.join('|') !== f.types.join('|')) {
          all.push({
            event,
            path,
            kind: 'type-mismatch',
            real: r.types.join('|'),
            fake: f.types.join('|'),
          });
        }
        if (r.optional !== f.optional) {
          all.push({
            event,
            path,
            kind: 'optional-mismatch',
            real: r.optional ? 'optional' : 'required',
            fake: f.optional ? 'optional' : 'required',
          });
        }
      }
    }
  }
  const used = new Set<AllowEntry>();
  const diffs: ShapeDiff[] = [];
  const accepted: ShapeDiff[] = [];
  for (const diff of all) {
    const entry = allow.find((candidate) => covers(candidate, diff));
    if (entry === undefined) {
      diffs.push(diff);
    } else {
      used.add(entry);
      accepted.push(diff);
    }
  }
  return { diffs, accepted, stale: allow.filter((entry) => !used.has(entry)) };
}

/**
 * Writes a {@link DiffResult} as text for the console and for `diff.txt`: a header with the
 * counts, then the unaccepted differences grouped by event type (alphabetical) and sorted by path,
 * one line each, `<path>  <kind>  real=<types> fake=<types>` (`-` for a side that has no such
 * path); then the stale allow entries. Stable for equal input, so two runs diff cleanly.
 */
export function formatDiff(result: DiffResult): string {
  const lines = [
    `event shapes: ${String(result.diffs.length)} difference(s), ${String(result.accepted.length)} accepted, ${String(result.stale.length)} stale allow entr${result.stale.length === 1 ? 'y' : 'ies'}`,
  ];
  let current = '';
  for (const diff of result.diffs) {
    if (diff.event !== current) {
      current = diff.event;
      lines.push('', current);
    }
    const where = diff.path ?? '(whole event)';
    lines.push(`  ${where}  ${diff.kind}  real=${diff.real ?? '-'} fake=${diff.fake ?? '-'}`);
  }
  for (const entry of result.stale) {
    lines.push(
      '',
      `stale allow entry (nothing matches it any more): ${entry.event ?? '(any event)'} ${entry.kind}${entry.path === undefined ? '' : ` ${entry.path}`} - ${entry.reason}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
