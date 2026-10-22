// The VS Code side of what the chat webview can ask the editor for (issues #13/#15): open a file
// at a line, insert or paste code, open an untitled document, copy, and pick files to attach; and
// (issue #29) the active file or selection as an attachment.
// The controller (`chatController.ts`) stays free of `vscode` and receives this object through
// `ChatControllerDeps.editor`.
//
// Privacy: the text to copy or insert is code from the model and may contain secrets from the
// user's files, so it is never logged. What is logged is a rejected path (truncated).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import type { AttachmentRef } from '../shared/protocol';
import type { EditorActions, EditorContext } from './chatController';
import { isInServedFolder, selectionLines, toEditorRef } from './fileMentions';
import type { ServerLog } from './opencodeServer';
import { resolveInsideFolder, toAttachmentName } from './pathPolicy';
import { pickWorkspaceFolder } from './serverManager';

/** Longest rejected path written to the log; our own cap, so a huge string cannot flood it. */
const LOG_PATH_MAX = 200;

/**
 * An expected failure of an editor action. `name` is the stable code the webview shows
 * (`ErrorInfo.code`) and `message` is written for the user, in English.
 */
class EditorActionError extends Error {
  constructor(code: string, message: string) {
    super(message);
    this.name = code;
  }
}

/** The served folder (the first workspace folder, as the server manager picks it), if any. */
function workspaceFolder(): string | undefined {
  const choice = pickWorkspaceFolder(vscode.workspace.workspaceFolders);
  return 'folder' in choice ? choice.folder : undefined;
}

/**
 * Reads what the active editor contributes to a prompt (issue #29): the file, or one reference per
 * non-empty selection with its line range.
 *
 * Throws `NoActiveEditor` without an editor and `NoFileOnDisk` ("Save the file first") for a
 * document whose scheme is not `file` (untitled, `git:`, `output:`): the server reads from disk,
 * and a buffer that is not one cannot be attached (decision Q3 of Sergio, 22/10/2026). It throws
 * `OutsideWorkspace` ("Only files inside the workspace folder can be added") for a file that is
 * not inside `folder`, and for any file when `folder` is `undefined` (no server is serving a
 * folder): decision W2 of Sergio, 22/10/2026. `attachments.fromEditor` needs no click on the host
 * side (a compromised webview can send it), and what it returns joins the whitelist of
 * `prompt.send`, so without this gate an open `.env` of another project or `~/.ssh/config` could
 * be whitelisted and sent to the model provider. The check is lexical (see
 * {@link isInServedFolder}). Order matters: a non-`file` document is refused as `NoFileOnDisk`
 * first. A dirty `file` buffer still gives the file on disk and sets `unsaved`, so the controller
 * warns that the model reads the saved version. Selections over the same lines give one
 * reference; each distinct range is one reference (one chip), in the order
 * `TextEditor.selections` lists them. `ranged` is the number of references that carry a range (0
 * when the whole file was taken).
 * VERIFIED on Windows 11, VS Code 1.143.0 (22/10/2026), in two suites. `npm run test:integration`
 * (22 passing, 1 pending, no folder served): "refuses the editor context with no editor open
 * (NoActiveEditor)", "refuses an untitled document (NoFileOnDisk: Save the file first)" and
 * "refuses a file outside the workspace folder (OutsideWorkspace), with no folder served" (a real
 * file of `os.tmpdir()`, whole and with a selection; the log said `request ctx-outside failed:
 * OutsideWorkspace: Only files inside the workspace folder can be added` and no `editor context
 * added` line). `--label real-opencode` (17 passing, a folder open): "adds the whole file when
 * nothing is selected", "adds one selection per non-empty selection while the chat view has the
 * focus" (two selections, after `openVsCode.chat.focus`; the log said `editor context added: 0
 * file(s), 2 selection(s)`), "warns that the saved version is what the model reads when the buffer
 * is dirty" and "refuses a file outside the open workspace folder (OutsideWorkspace)" (a file of
 * `os.tmpdir()` with the folder open). And in the real chat of `test:visual` step 16: with the
 * focus in the webview, "Add selection adds the chip src/sample.ts#2-3" for a selection that ended
 * at column 0 of line 4. NOT observed: a document of another non-`file` scheme (only `untitled`),
 * a symlink inside the folder pointing outside it (the check is lexical, so it passes), a
 * notebook cell, the refusal notice in the webview, macOS and Linux.
 */
function readEditorContext(folder: string | undefined): EditorContext {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    throw new EditorActionError('NoActiveEditor', 'Open a file in the editor to add it');
  }
  const { document } = editor;
  if (document.uri.scheme !== 'file') {
    throw new EditorActionError('NoFileOnDisk', 'Save the file first');
  }
  const fsPath = document.uri.fsPath;
  if (!isInServedFolder(folder, fsPath)) {
    // Not logged with the path: it is a file the user has open, and may be private.
    throw new EditorActionError(
      'OutsideWorkspace',
      'Only files inside the workspace folder can be added',
    );
  }
  const selections = editor.selections.filter((selection) => !selection.isEmpty);
  const refs: AttachmentRef[] = [];
  const seen = new Set<string>();
  const add = (ref: AttachmentRef): void => {
    if (seen.has(ref.uri)) return;
    seen.add(ref.uri);
    refs.push(ref);
  };
  if (selections.length === 0) add(toEditorRef(folder, fsPath));
  for (const selection of selections) {
    add(toEditorRef(folder, fsPath, selectionLines(selection.start, selection.end)));
  }
  return { refs, ranged: selections.length === 0 ? 0 : refs.length, unsaved: document.isDirty };
}

/**
 * Builds the {@link EditorActions} backed by the real VS Code API.
 *
 * Decisions (plan `E2-mvp-prototype/plan-fase2` §3): copy goes through `env.clipboard` and not
 * `navigator.clipboard` in the iframe (the clipboard permission of a webview depends on focus,
 * HYPOTHESIS); insert replaces each selection through `TextEditor.edit` and not `insertSnippet`,
 * which would interpret `$` in the code; attachments are `file://` URLs made with `pathToFileURL`
 * because `Uri.toString()` encodes the Windows drive colon as `c%3A` and the server would have to
 * decode it (HYPOTHESIS that it does). `open` refuses anything outside the served folder
 * (`pathPolicy.ts`); symlinks are not resolved. `open` resolves the path against `servedFolder`
 * (the folder the SERVER serves) when the controller gives it, and only otherwise against the
 * folder the host would pick (issue #28: with several workspace folders a chip of the served one
 * must open); the multi-root case itself was not run. `editorContext` is {@link readEditorContext}.
 * VERIFIED in a real VS Code 1.142 on Windows 11 (20/10/2026, `npm run test:integration`): `newFile`
 * (with a known and an unknown language id), `insert` (a `$1`/`${name}` text stays verbatim),
 * `copy` and the refusal of `open` without a folder, all in `test/integration/editorActions.test.ts`;
 * and `open` of a relative file at a line against a folder, in the opt-in `realOpencode.test.ts`.
 * The refusal of a path outside the folder is only unit-tested (`pathPolicy.test.ts`).
 * UNVERIFIED: `pickFiles` (a native dialog cannot be
 * driven by the test API; F5), and `insert` when the focus is in the side view (whether
 * `activeTextEditor` is still the last editor, HYPOTHESIS), macOS and Linux.
 */
export function createEditorActions(log: ServerLog): EditorActions {
  return {
    async open(target, line, column, servedFolder) {
      const folder = servedFolder ?? workspaceFolder();
      if (folder === undefined) {
        throw new EditorActionError('NoWorkspace', 'Open a folder to open files from the chat');
      }
      const resolved = resolveInsideFolder(folder, target);
      if (resolved === undefined) {
        // JSON.stringify escapes newlines and control characters, so a hostile path cannot forge
        // log lines.
        log.warn(
          `refused to open a path outside the workspace: ${JSON.stringify(target.slice(0, LOG_PATH_MAX))}`,
        );
        throw new EditorActionError(
          'OutsideWorkspace',
          'That file is outside the workspace folder, so it was not opened',
        );
      }
      let document: vscode.TextDocument;
      try {
        document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
      } catch {
        throw new EditorActionError(
          'FileNotFound',
          `Could not open ${path.basename(resolved)}: it does not exist or is not a text file`,
        );
      }
      const position = new vscode.Position(
        Math.max(0, (line ?? 1) - 1),
        Math.max(0, (column ?? 1) - 1),
      );
      await vscode.window.showTextDocument(document, {
        selection: new vscode.Range(position, position),
        preview: true,
      });
    },

    editorContext(folder) {
      try {
        return Promise.resolve(readEditorContext(folder));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },

    async insert(text) {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined) {
        throw new EditorActionError('NoActiveEditor', 'Open a file to insert code');
      }
      const applied = await editor.edit((builder) => {
        for (const selection of editor.selections) builder.replace(selection, text);
      });
      if (!applied) {
        throw new EditorActionError(
          'InsertFailed',
          'The editor refused the edit (read-only file?)',
        );
      }
    },

    async newFile(text, language) {
      // The webview's language id comes from a fixed table, but it is still input from an
      // untrusted side: an unknown id is dropped instead of failing the whole action.
      const known = language === undefined ? [] : await vscode.languages.getLanguages();
      const document = await vscode.workspace.openTextDocument({
        content: text,
        ...(language !== undefined && known.includes(language) ? { language } : {}),
      });
      await vscode.window.showTextDocument(document, { preview: false });
    },

    async copy(text) {
      await vscode.env.clipboard.writeText(text);
    },

    async pickFiles() {
      const folder = workspaceFolder();
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: 'Attach',
        ...(folder === undefined ? {} : { defaultUri: vscode.Uri.file(folder) }),
      });
      if (picked === undefined) return [];
      return picked.map((uri): AttachmentRef => {
        const fsPath = uri.fsPath;
        return {
          uri: pathToFileURL(fsPath).href,
          name: folder === undefined ? path.basename(fsPath) : toAttachmentName(folder, fsPath),
        };
      });
    },
  };
}
