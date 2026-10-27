// Path policy of the host for what the webview asks it to open or attach (issues #13/#15).
// PURE: no `vscode` import. The path flavour is injected (`path.win32` / `path.posix`) so the
// Windows and POSIX rules are tested from any OS.
//
// Why a policy exists: the webview renders LLM text and is untrusted input (architecture rule 1
// and `isWebviewToHost`, which says path policy is the host handler's job). A file reference in a
// reply is a path chosen by the model; the host must not open `C:\Windows\...` or `~/.ssh/...`
// because a reply said so. Symlinks are NOT resolved (`realpath`): one inside the folder that
// points outside would still open. Accepted risk of the plan (`plan-fase2` §7): the editor only
// reads it, and the user clicked it.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The subset of `node:path` the policy uses; `path.win32` and `path.posix` both satisfy it. */
export type PathImpl = Pick<
  typeof path.posix,
  'resolve' | 'relative' | 'isAbsolute' | 'sep' | 'basename'
>;

/** True when `relative` (from `path.relative(folder, target)`) stays inside the folder. */
function isInside(relative: string, impl: PathImpl): boolean {
  if (relative === '' || relative === '..' || relative.startsWith(`..${impl.sep}`)) return false;
  // A different drive or a UNC share: `relative` comes back absolute on win32.
  return !impl.isAbsolute(relative);
}

/**
 * Resolves `raw` (relative, absolute or `file://`) to an absolute path, only if it lies inside
 * `folder`; otherwise `undefined`.
 *
 * Relative paths are taken against `folder`. The check is lexical (`..` segments are collapsed by
 * `resolve`, then `relative` must not start with `..` nor be absolute), and the folder itself
 * does not count (it is not a file). On win32 `relative` is case-insensitive, so `c:\WS\x` is
 * inside `C:\ws`. A `file:` URL that cannot be converted, or text with a NUL byte, gives
 * `undefined` instead of throwing. VERIFIED by `pathPolicy.test.ts` with `path.win32` and
 * `path.posix` (synthetic inputs, run on Windows 11); real symlinks and network shares are
 * UNVERIFIED.
 */
export function resolveInsideFolder(
  folder: string,
  raw: string,
  impl: PathImpl = path,
): string | undefined {
  if (raw === '' || raw.includes('\0')) return undefined;
  let target = raw;
  if (/^file:/i.test(raw)) {
    try {
      target = fileURLToPath(raw, { windows: impl.sep === '\\' });
    } catch {
      return undefined;
    }
  }
  const resolved = impl.resolve(folder, target);
  return isInside(impl.relative(folder, resolved), impl) ? resolved : undefined;
}

/**
 * Name shown on an attachment chip: the path relative to `folder` with `/` separators, or the
 * basename when the file is outside it (the user may attach any file, but the host never shows a
 * long absolute path).
 */
export function toAttachmentName(folder: string, fsPath: string, impl: PathImpl = path): string {
  const relative = impl.relative(folder, fsPath);
  if (!isInside(relative, impl)) return impl.basename(fsPath);
  return relative.split(impl.sep).join('/');
}

/**
 * The extensions "Attach image…" offers and accepts (E2, decision P11): the four types the model
 * receives as media (`IMAGE_MIMES` of `src/shared`: png, jpeg, gif, webp), with `jpg` for jpeg.
 * Lower case, no dot.
 */
export const IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

/**
 * True when `fsPath` ends in one of {@link IMAGE_EXTENSIONS}, compared case-insensitively.
 *
 * The check is by extension only, not by content: a dialog filter is a hint the user can
 * override with "All files", so the host applies this too (plan section 12, P11: "validar el tipo
 * en el host"). The server then detects the real type from the bytes. VERIFIED by
 * `pathPolicy.test.ts` with literal names (synthetic).
 */
export function hasImageExtension(fsPath: string): boolean {
  const dot = fsPath.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.includes(fsPath.slice(dot + 1).toLowerCase());
}
