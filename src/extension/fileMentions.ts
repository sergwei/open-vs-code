// Pure helpers of the file context features (issues #28/#29): turning what the server finds, or
// what the editor holds, into the `AttachmentRef`s the webview shows as chips. PURE: no `vscode`
// import; the path flavour is injected (`path.win32` / `path.posix`), like `pathPolicy.ts`, so both
// are tested from any OS.
//
// Rule behind all of it: the HOST builds every `uri` (the webview is untrusted input, architecture
// rule 1). A search result or an editor selection becomes a `file://` URL made with `pathToFileURL`
// and is remembered by the controller; `prompt.send` accepts nothing else.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AttachmentRef } from '../shared/protocol';
import { resolveInsideFolder, toAttachmentName, type PathImpl } from './pathPolicy';

/** One entry of `GET /api/fs/find`: a path relative to the searched folder and its kind. */
export interface FoundEntry {
  readonly path: string;
  readonly type: string;
}

/** A 1-based, inclusive line range. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** A VS Code position, reduced to what {@link selectionLines} reads (0-based). */
export interface PositionLike {
  readonly line: number;
  readonly character: number;
}

/**
 * Turns the entries of a file search into attachment references, in the order the server ranked
 * them.
 *
 * Why it normalises: the real server answers files with `/` but directories with a trailing `\` on
 * Windows (VERIFIED, planner spike, opencode 2.0.32, Windows 11, 22/10/2026), so separators are
 * mixed; every `\` becomes `/` before the path is resolved against `folder`. Only entries of type
 * `file` survive (decision Q4 of Sergio: the popup lists files only), a trailing separator also
 * discards the entry, and so does anything that resolves outside `folder` (`../x`, an absolute
 * path of another place): the server is trusted for what it finds, not for what it may return.
 * A `\` inside a POSIX file name is therefore read as a separator (that file cannot be mentioned;
 * accepted, such names are vanishingly rare). Duplicated `uri`s are dropped. The name is the path
 * relative to `folder` with `/`, the same label the Attach dialog gives, so a file found twice by
 * different routes dedupes in the chip row. VERIFIED by `fileMentions.test.ts` with `path.win32`
 * and `path.posix` (synthetic entries copied from the spike's shapes, run on Windows 11); POSIX
 * server output is UNVERIFIED.
 */
export function toSearchRefs(
  folder: string,
  entries: readonly FoundEntry[],
  impl: PathImpl = path,
): AttachmentRef[] {
  const seen = new Set<string>();
  const refs: AttachmentRef[] = [];
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    const normalised = entry.path.replace(/\\/g, '/');
    if (normalised === '' || normalised.endsWith('/')) continue;
    const absolute = resolveInsideFolder(folder, normalised, impl);
    if (absolute === undefined) continue;
    const uri = pathToFileURL(absolute, { windows: impl.sep === '\\' }).href;
    if (seen.has(uri)) continue;
    seen.add(uri);
    refs.push({ uri, name: toAttachmentName(folder, absolute, impl) });
  }
  return refs;
}

/**
 * The line range an editor selection covers, 1-based and inclusive.
 *
 * A selection that ends at column 0 of a later line (a triple click, or dragging down to the
 * start of the next line) does not include that line, so the range stops on the one before: the
 * model would otherwise be handed a line the user never meant. A selection that starts and ends in
 * the same place (empty) maps to its one line; callers drop empty selections before asking.
 * VERIFIED by `fileMentions.test.ts` (fabricated positions) and in a real VS Code 1.143.0 on
 * Windows 11 (22/10/2026, `test:visual` step 16): two Shift+ArrowDown from the start of line 2 left
 * the editor on "Ln 4, Col 1 (51 selected)" and "Add selection adds the chip
 * src/sample.ts#2-3". HYPOTHESIS for box and multi-cursor selections (the caller handles one range
 * at a time) and a selection made backwards: not run.
 */
export function selectionLines(start: PositionLike, end: PositionLike): LineRange {
  const endLine = end.character === 0 && end.line > start.line ? end.line - 1 : end.line;
  return { start: start.line + 1, end: endLine + 1 };
}

/**
 * True when `fsPath` lies inside the served `folder`; false without a folder, for the folder
 * itself and for anything outside it.
 *
 * Gate of "Add selection" (decision W2 of Sergio, 22/10/2026): the host takes the active editor's
 * file only if it is in the folder the server serves, so a webview that sends
 * `attachments.fromEditor` without a click cannot get an open `~/.ssh/config` or a `.env` of
 * another project whitelisted. Same lexical rule as `editor.open` ({@link resolveInsideFolder}):
 * symlinks are not resolved, so a link inside the folder that points outside passes. The `folder`
 * predicate narrows `string | undefined` for the caller. VERIFIED by `fileMentions.test.ts` with
 * `path.win32` and `path.posix` (hand-made paths, run on Windows 11, 22/10/2026) and in a real
 * VS Code 1.143.0 on Windows 11 (22/10/2026) by the integration cases "refuses a file outside the
 * workspace folder (OutsideWorkspace), with no folder served" (`editorActions.test.ts`) and
 * "refuses a file outside the open workspace folder (OutsideWorkspace)" (`fakeServer.test.ts`,
 * a file outside the served folder with a folder open; it ran in `realOpencode.test.ts` with a file
 * of `os.tmpdir()` until issue #41). Real symlinks UNVERIFIED.
 */
export function isInServedFolder(
  folder: string | undefined,
  fsPath: string,
  impl: PathImpl = path,
): folder is string {
  return folder !== undefined && resolveInsideFolder(folder, fsPath, impl) !== undefined;
}

/**
 * Builds the reference of a file on disk, optionally limited to a line range.
 *
 * The range travels as `?start=a&end=b` in the `file://` URL, which the server reads (VERIFIED,
 * planner spike against opencode 2.0.32, Windows 11, 22/10/2026: `data` held exactly lines 16-18,
 * and the stored `source.uri` kept the query), and as `#a-b` (`#a` for one line) at the end of the
 * `name`, because the model only sees the name and description (`to-llm-message.ts`, read at the
 * v2.0.32 tag): that suffix is the only way it learns which lines it got. The name is the path
 * relative to `folder`, or the basename when the file is outside it or there is no folder (the same
 * label as the Attach dialog; the editor context no longer reaches those two cases, because
 * {@link isInServedFolder} refuses them first). `Node`'s `fileURLToPath` DROPS the query, which is what lets
 * `editor.open` take such a URL (VERIFIED on Node 24.22). The range is only applied by the server
 * to text/plain files: a Latin-1 or UTF-16 file would go whole while the name still says `#a-b`
 * (HYPOTHESIS, not executed).
 */
export function toEditorRef(
  folder: string | undefined,
  fsPath: string,
  lines?: LineRange,
  impl: PathImpl = path,
): AttachmentRef {
  const url = pathToFileURL(fsPath, { windows: impl.sep === '\\' });
  const base =
    folder === undefined ? impl.basename(fsPath) : toAttachmentName(folder, fsPath, impl);
  if (lines === undefined) return { uri: url.href, name: base };
  url.searchParams.set('start', String(lines.start));
  url.searchParams.set('end', String(lines.end));
  const suffix = lines.start === lines.end ? `#${lines.start}` : `#${lines.start}-${lines.end}`;
  return { uri: url.href, name: `${base}${suffix}` };
}
