// Where a chip of the prompt or of the history leads (issue #28/#29): the file to open and the line
// to open it at, read from the `uri` the host gave. Pure; the click itself sends `editor.open`.

/** What `editor.open` needs for an attachment: the `file:` URL without query or hash, and a range. */
export interface AttachmentTarget {
  /** The `file:` URL with its query and hash cut off; the host turns it into a path. */
  path: string;
  /** First line of the range (`?start=`), 1-based; the editor opens there. */
  line?: number;
  /** Last line of the range (`?end=`), only used for the accessible name. */
  endLine?: number;
}

/** A positive safe integer from a query value, or `undefined`. */
function positive(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

/**
 * The target of an attachment `uri`, or `undefined` when there is nothing to open: no `uri` (the
 * host drops a `data:` one), or a scheme other than `file:`. The webview does not decide whether
 * the file is inside the folder: the host refuses anything outside it (`pathPolicy.ts`), so a
 * chip for such a file shows the refusal as a notice instead of doing nothing. VERIFIED by
 * `attachmentTarget.test.ts` with fabricated URLs, including the shape the planner's spike saw a
 * real opencode 2.0.32 store (`file:///…?start=16&end=18`).
 */
export function attachmentTarget(uri: string | undefined): AttachmentTarget | undefined {
  if (uri === undefined || !/^file:/i.test(uri)) return undefined;
  const hash = uri.indexOf('#');
  const withoutHash = hash === -1 ? uri : uri.slice(0, hash);
  const question = withoutHash.indexOf('?');
  if (question === -1) return { path: withoutHash };
  const params = new URLSearchParams(withoutHash.slice(question + 1));
  const line = positive(params.get('start'));
  const endLine = positive(params.get('end'));
  return {
    path: withoutHash.slice(0, question),
    ...(line === undefined ? {} : { line }),
    ...(line === undefined || endLine === undefined ? {} : { endLine }),
  };
}

/**
 * The accessible name of an "open this file" button: `Open src/a.ts`, or `Open src/a.ts, lines
 * 10-20` / `line 4` for a range. The `#a-b` suffix the host put in `name` is dropped from the
 * spoken name because a screen reader would read it as "number sign"; it is only dropped when it
 * matches the range of the `uri`, so a file legitimately called `a#1.md` keeps its name.
 */
export function openLabel(name: string, target: AttachmentTarget): string {
  if (target.line === undefined) return `Open ${name}`;
  const last = target.endLine ?? target.line;
  const suffix = last === target.line ? `#${target.line}` : `#${target.line}-${last}`;
  const base = name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  return last === target.line
    ? `Open ${base}, line ${target.line}`
    : `Open ${base}, lines ${target.line}-${last}`;
}
