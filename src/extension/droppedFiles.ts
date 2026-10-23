// What the host makes of the URIs the webview says the user dropped from the Explorer (issue #30).
// PURE: no `vscode` import; the path flavour is injected like in `pathPolicy.ts`, so the Windows
// and POSIX rules are tested from any OS. The `stat` (file or folder?) and the `file.find`
// cross-check need I/O and live in `editorActions.ts` and `chatController.ts`.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AttachmentRef } from '../shared/protocol';
import { resolveInsideFolder, toAttachmentName, type PathImpl } from './pathPolicy';

/** A dropped URI that passed the lexical checks, still to be `stat`ed: the absolute path and its chip. */
export interface DroppedCandidate {
  absolute: string;
  ref: AttachmentRef;
}

/** Result of {@link classifyDropped}: what may be `stat`ed, and counts of what was refused. */
export interface DroppedClassification {
  candidates: DroppedCandidate[];
  /** Valid `file:` URIs that lie outside the served folder (or the folder itself). */
  outside: number;
  /** URIs of another scheme (`vscode-remote://`, `untitled:`...) or that are not a URI at all. */
  remote: number;
}

/**
 * Splits the dropped URI strings into candidates and refusals, without touching the disk.
 *
 * The strings come from `dataTransfer.getData('resourceurls')` and are untrusted: the webview is
 * not a gesture the host sees. Only the `file` scheme passes (a remote window gives
 * `vscode-remote://`, which this extension does not support). VS Code writes the Windows drive
 * as `file:///c%3A/...` (`URI.toString()`); Node's `fileURLToPath` decodes it, so that form and
 * `file:///C:/...` end in the same path. The check against the served folder is the lexical rule
 * of `editor.open` ({@link resolveInsideFolder}); symlinks are not resolved. Duplicates (by the
 * final `file://` URL) are dropped, and the chip name is the one Attach gives. `invalid` input
 * counts as `remote`: either way it is "not a local file".
 * VERIFIED on Windows 11 (23/10/2026): the check "maps the VS Code drive form and the plain one to
 * the same path" of `droppedFiles.test.ts` passed with `path.win32` and `path.posix` on hand-made
 * URIs in the shape read from `fillEditorsDragData` in VS Code 1.105.0 (not a real drag).
 * UNVERIFIED: what a real Explorer drag puts in `resourceurls` on 1.143 (the drop never reaches the
 * webview there, microsoft/vscode#339036).
 */
export function classifyDropped(
  folder: string,
  uris: readonly string[],
  impl: PathImpl = path,
): DroppedClassification {
  const candidates: DroppedCandidate[] = [];
  const seen = new Set<string>();
  let outside = 0;
  let remote = 0;
  for (const raw of uris) {
    if (!/^file:/i.test(raw)) {
      remote += 1;
      continue;
    }
    const absolute = resolveInsideFolder(folder, raw, impl);
    if (absolute === undefined) {
      outside += 1;
      continue;
    }
    const uri = pathToFileURL(absolute, { windows: impl.sep === '\\' }).href;
    // Windows paths are case-insensitive and `c%3A` / `C:` differ only in the drive letter.
    const key = impl.sep === '\\' ? uri.toLowerCase() : uri;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ absolute, ref: { uri, name: toAttachmentName(folder, absolute, impl) } });
  }
  return { candidates, outside, remote };
}
