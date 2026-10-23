// The VS Code side of the "Changed files" diffs (issue #31): a read-only content provider for the
// ORIGINAL side and the command that opens VS Code's own diff editor. The logic that decides what
// may be opened and what the original text is lives in `sessionDiff.ts` (pure); this file only
// builds URIs and calls the API. The webview never names a path to VS Code: the controller checks
// the whitelist and hands this module a `DiffTarget`.

import * as vscode from 'vscode';
import { SESSION_DIFF_SCHEME } from './ids';
import type { DiffTarget } from './sessionDiff';

/** Where {@link registerSessionDiffProvider} gets the original text of a listed file. */
export interface OriginalSource {
  /** Rejects when the file is not listed for that session or its original cannot be known. */
  original(sessionID: string, path: string): Promise<string>;
  /** Calls `listener` when the originals of a session may have changed; returns the unsubscribe. */
  onRenewed(listener: (sessionID: string) => void): () => void;
}

/** Error with a stable `name` code, shown by the controller as the code of a notice. */
function codedError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = code;
  return error;
}

/**
 * The URI of a virtual document of a diff. `path` carries the listed path (relative to the served
 * folder) so VS Code picks the language from its extension; `side` is `before` (the original text,
 * asked to the source) or `empty` (nothing: the left of an added file, the right of a deleted or
 * gone one); `role` only keeps the two sides of a diff from being the same URI when both are empty.
 * The query holds the session id and nothing else: no port, no password, no absolute path.
 */
function virtualUri(
  target: Pick<DiffTarget, 'sessionID' | 'path'>,
  side: 'before' | 'empty',
  role: 'left' | 'right',
): vscode.Uri {
  return vscode.Uri.from({
    scheme: SESSION_DIFF_SCHEME,
    path: `/${target.path}`,
    query: new URLSearchParams({ session: target.sessionID, side, role }).toString(),
  });
}

/** True when `uri` exists on disk (a `stat` that does not throw). */
async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Registers the provider of the virtual documents on the left of a "Changed files" diff.
 *
 * Registered at activation and not on first use: VS Code restores open editor tabs after a Reload
 * Window, and a restored diff tab asks for its documents before any click. A restored tab that
 * arrives before the server is ready or the list is loaded gets the source's rejection, which VS
 * Code shows inside the editor (HYPOTHESIS, not run). The provider remembers the `before` URIs it
 * served and fires `onDidChange` for those of a session when `source.onRenewed` says its originals
 * may have moved (a new list, or a committed revert moving the start of the range), so a diff tab
 * already open re-reads its left side (decision W4 of the review #1157, Engram #1159; plan #1150).
 * Fired for every remembered URI of the session, also those no longer open: VS Code ignores a
 * change for a document nobody has open.
 * VERIFIED in `fakeServer.test.ts` (real VS Code 1.143, Windows 11, synthetic server) by the check
 * "lists the files an edit turn changed and opens the native diff of one" (the left side is read
 * through this provider). UNVERIFIED in a real VS Code: that an OPEN diff tab re-reads its left
 * side on `onDidChange` (the trigger, `SessionDiffs.onRenewed`, is unit-tested in
 * `sessionDiff.test.ts` with a fake client; a fakeServer case needs a revert the synthetic
 * server cannot commit yet, issue #32): open a diff, commit a revert, and look at the left side.
 */
export function registerSessionDiffProvider(source: OriginalSource): vscode.Disposable {
  const changed = new vscode.EventEmitter<vscode.Uri>();
  const served = new Map<string, vscode.Uri[]>();
  const unsubscribe = source.onRenewed((sessionID) => {
    for (const uri of served.get(sessionID) ?? []) changed.fire(uri);
  });
  const provider = vscode.workspace.registerTextDocumentContentProvider(SESSION_DIFF_SCHEME, {
    onDidChange: changed.event,
    provideTextDocumentContent(uri) {
      const query = new URLSearchParams(uri.query);
      if (query.get('side') === 'empty') return '';
      const sessionID = query.get('session');
      if (sessionID === null || sessionID === '') {
        return Promise.reject(codedError('DiffNotListed', 'This diff has no session'));
      }
      const known = served.get(sessionID) ?? [];
      if (!known.some((item) => item.toString() === uri.toString())) {
        served.set(sessionID, [...known, uri]);
      }
      return source.original(sessionID, uri.path.replace(/^\//, ''));
    },
  });
  return {
    dispose: () => {
      unsubscribe();
      provider.dispose();
      changed.dispose();
    },
  };
}

/**
 * Opens VS Code's diff editor for a listed changed file: the original text on the left (a virtual,
 * read-only document) and the real file on the right, editable like the native Source Control diff.
 *
 * Added: the left is empty. Deleted, or a file that is no longer on disk: the right is empty
 * (decision of the plan: the diff then shows what the session removed). A `binary` target (no text
 * diff from the server) opens the file itself with `vscode.open` and resolves `'file'`; it rejects
 * with `FileNotFound` when that file is not on disk. Cost accepted: if the user edited the file
 * after the turn, the right side shows those edits too.
 * VERIFIED in `fakeServer.test.ts` (real VS Code 1.143, Windows 11, synthetic server, 23/10/2026):
 * the active tab is a `TabInputTextDiff` whose `original.scheme` is the provider's and whose
 * `modified` is the file of the served folder; the deleted case has a virtual `modified`; the
 * added file has an empty left (same suite, check "lists the files an edit turn changed and opens
 * the native diff of one"). In `test:visual` (Windows 11, 23/10/2026) the checks "a diff editor
 * opens in the active tab "sample.ts"", "Enter on the deleted row opens a diff editor", "a diff
 * editor opens for the added file" and "a binary opens no diff editor" passed. macOS and Linux
 * UNVERIFIED.
 */
export async function openSessionDiff(target: DiffTarget): Promise<'diff' | 'file'> {
  const file = vscode.Uri.file(target.absolute);
  const onDisk = await exists(file);
  if (target.binary) {
    if (!onDisk) throw codedError('FileNotFound', 'That file is not on disk any more');
    await vscode.commands.executeCommand('vscode.open', file, { preview: true });
    return 'file';
  }
  const left = virtualUri(target, target.status === 'added' ? 'empty' : 'before', 'left');
  const right =
    target.status === 'deleted' || !onDisk ? virtualUri(target, 'empty', 'right') : file;
  await vscode.commands.executeCommand(
    'vscode.diff',
    left,
    right,
    `${target.path} (OpenCode session)`,
    { preview: true },
  );
  return 'diff';
}
