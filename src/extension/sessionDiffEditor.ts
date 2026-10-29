// The VS Code side of the "Changed files" diffs (issue #31) and of the "what the revert undid"
// diffs (issue #32): a read-only content provider for the ORIGINAL side and the command that opens
// VS Code's own diff editor. The logic that decides what may be opened and what the original text
// is lives in `sessionDiff.ts` and `sessionRevert.ts` (pure); this file only builds URIs and calls
// the API. The webview never names a path to VS Code: the controller checks the whitelist and
// hands this module a `DiffTarget`.

import * as vscode from 'vscode';
import { SESSION_DIFF_SCHEME } from './ids';
import type { ServerLog } from './opencodeServer';
import { codedError, type DiffTarget } from './sessionDiff';

/** Where {@link registerSessionDiffProvider} gets the original text of a listed file. */
export interface OriginalSource {
  /** Rejects when the file is not listed for that session or its original cannot be known. */
  original(sessionID: string, path: string): Promise<string>;
  /**
   * The text a file of the prepared revert had BEFORE the revert undid the session's changes
   * (issue #32); rejects when the file is not one of the revert or the text cannot be known.
   */
  reverted(sessionID: string, path: string): Promise<string>;
  /** Calls `listener` when the originals of a session may have changed; returns the unsubscribe. */
  onRenewed(listener: (sessionID: string) => void): () => void;
}

/**
 * The URI of a virtual document of a diff. `path` carries the listed path (relative to the served
 * folder) so VS Code picks the language from its extension; `side` is `before` (the original text,
 * asked to the source), `reverted` (the text before a prepared revert, asked to the source) or
 * `empty` (nothing: the left of an added file, the right of a deleted or gone one); `role` only
 * keeps the two sides of a diff from being the same URI when both are empty.
 * The query holds the session id and nothing else: no port, no password, no absolute path.
 */
function virtualUri(
  target: Pick<DiffTarget, 'sessionID' | 'path'>,
  side: 'before' | 'reverted' | 'empty',
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
 * Registers the provider of the virtual documents on the left of a "Changed files" diff and of a
 * "reverted files" diff.
 *
 * Registered at activation and not on first use: VS Code restores open editor tabs after a Reload
 * Window, and a restored diff tab asks for its documents before any click. A restored tab that
 * arrives before the server is ready or the list is loaded gets the source's rejection, which VS
 * Code shows inside the editor (HYPOTHESIS, not run). The provider remembers the `before` and
 * `reverted` URIs it served and fires `onDidChange` for those of a session when `source.onRenewed`
 * says its originals may have moved (the start of the range moved: a committed revert), so a diff
 * tab already open re-reads its left side (decision W4 of the review #1157, Engram #1159; plan
 * #1150). It fires for every remembered URI of the session; the remembered ones are forgotten when
 * their document is closed (`onDidCloseTextDocument`), so the map does not grow for the life of the
 * window. VS Code ignores a change for a document nobody has open. The close event arrives when
 * VS Code disposes the document, which is some time after the tab closes, so the pruning is
 * bounded, not immediate.
 * `log` gets one stable line per renewal that had URIs to refresh: `diff originals renewed for
 * <sid> (<n> open)` (ids and a count, never a path), which the fake-server suite waits for.
 * READ in the VS Code 1.142 extension host (`ExtHostDocumentContentProvider` returns when the
 * document is not open), not run: that a change for a closed document is ignored.
 * VERIFIED in `fakeServer.test.ts` (real VS Code 1.143, Windows 11, synthetic server) by the check
 * "lists the files an edit turn changed and opens the native diff of one" (the left side is read
 * through this provider). VERIFIED by `test:visual` (real VS Code 1.143, Windows 11, synthetic
 * server, 23/10/2026): the checks "the diff tab opened before the revert now shows value2 = 5 on
 * the left, without reopening it" and "and the new text (value2 = 52) on the right" passed, i.e. an
 * OPEN diff tab re-read its left side on `onDidChange` after a committed revert without being
 * reopened; and `fakeServer.test.ts` waits for the log line `diff originals renewed for <sid> (`.
 * Not observed: macOS/Linux, a revert of a turn made by a real model (the trigger,
 * `SessionDiffs.onRenewed`, is unit-tested in `sessionDiff.test.ts` with a fake client).
 */
export function registerSessionDiffProvider(
  source: OriginalSource,
  log: ServerLog,
): vscode.Disposable {
  const changed = new vscode.EventEmitter<vscode.Uri>();
  const served = new Map<string, vscode.Uri[]>();
  const unsubscribe = source.onRenewed((sessionID) => {
    const uris = served.get(sessionID) ?? [];
    if (uris.length === 0) return;
    log.info(`diff originals renewed for ${sessionID} (${String(uris.length)} open)`);
    for (const uri of uris) changed.fire(uri);
  });
  const closed = vscode.workspace.onDidCloseTextDocument((document) => {
    if (document.uri.scheme !== SESSION_DIFF_SCHEME) return;
    const sessionID = new URLSearchParams(document.uri.query).get('session');
    if (sessionID === null) return;
    const rest = (served.get(sessionID) ?? []).filter(
      (item) => item.toString() !== document.uri.toString(),
    );
    if (rest.length === 0) served.delete(sessionID);
    else served.set(sessionID, rest);
  });
  const provider = vscode.workspace.registerTextDocumentContentProvider(SESSION_DIFF_SCHEME, {
    onDidChange: changed.event,
    provideTextDocumentContent(uri) {
      const query = new URLSearchParams(uri.query);
      const side = query.get('side');
      if (side === 'empty') return '';
      const sessionID = query.get('session');
      if (sessionID === null || sessionID === '') {
        return Promise.reject(codedError('DiffNotListed', 'This diff has no session'));
      }
      const known = served.get(sessionID) ?? [];
      if (!known.some((item) => item.toString() === uri.toString())) {
        served.set(sessionID, [...known, uri]);
      }
      const shown = uri.path.replace(/^\//, '');
      return side === 'reverted'
        ? source.reverted(sessionID, shown)
        : source.original(sessionID, shown);
    },
  });
  return {
    dispose: () => {
      unsubscribe();
      closed.dispose();
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
 * after the turn, the right side shows those edits too. `target.side` picks the source of the left
 * text: `before` for "Changed files", `reverted` for the files of a prepared revert (left = the
 * text before the revert, right = the file now on disk).
 * VERIFIED in `fakeServer.test.ts` (real VS Code 1.143, Windows 11, synthetic server, 23/10/2026):
 * the active tab is a `TabInputTextDiff` whose `original.scheme` is the provider's and whose
 * `modified` is the file of the served folder; the deleted case has a virtual `modified`; the
 * added file has an empty left (same suite, check "lists the files an edit turn changed and opens
 * the native diff of one"). In `test:visual` (Windows 11, 23/10/2026) the checks "a diff editor
 * opens in the active tab "sample.ts"", "Enter on the deleted row opens a diff editor", "a diff
 * editor opens for the added file" and "a binary opens no diff editor" passed. macOS and Linux
 * UNVERIFIED.
 *
 * Issue #77: `viewColumn`, when given, is passed in the options of `vscode.open` and `vscode.diff`
 * so the diff opens in the column the caller picked (`ChatTabs.columnForFiles`: the last text
 * editor's, or beside when that column holds a chat tab); this function opens wherever it is told.
 * Absent, the options are the ones above. VERIFIED that `vscode.diff` honours `viewColumn` in its
 * options (risk R8 of the plan): in VS Code 1.144.0 on Windows 11 (29/10/2026,
 * `npm run test:integration --label fake-server`, synthetic server) the check "opens the diff
 * beside a chat tab, and serves prompts and session.open from tabs" passed: with the sample file
 * in column one and two chat tabs in another, the active diff tab's group was the sample's column
 * and none of the chat columns. Not observed: the `vscode.open` branch (a binary), macOS, Linux.
 */
export async function openSessionDiff(
  target: DiffTarget,
  viewColumn?: vscode.ViewColumn,
): Promise<'diff' | 'file'> {
  const file = vscode.Uri.file(target.absolute);
  const onDisk = await exists(file);
  const columnOption = viewColumn === undefined ? {} : { viewColumn };
  if (target.binary) {
    if (!onDisk) throw codedError('FileNotFound', 'That file is not on disk any more');
    await vscode.commands.executeCommand('vscode.open', file, { preview: true, ...columnOption });
    return 'file';
  }
  const left = virtualUri(target, target.status === 'added' ? 'empty' : target.side, 'left');
  const right =
    target.status === 'deleted' || !onDisk ? virtualUri(target, 'empty', 'right') : file;
  await vscode.commands.executeCommand(
    'vscode.diff',
    left,
    right,
    target.side === 'reverted'
      ? `${target.path} (before the revert)`
      : `${target.path} (OpenCode session)`,
    { preview: true, ...columnOption },
  );
  return 'diff';
}
