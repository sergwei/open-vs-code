// The VS Code side of what the chat webview can ask the editor for (issues #13/#15): open a file
// at a line, insert or paste code, open an untitled document, copy, and pick files to attach.
// The controller (`chatController.ts`) stays free of `vscode` and receives this object through
// `ChatControllerDeps.editor`.
//
// Privacy: the text to copy or insert is code from the model and may contain secrets from the
// user's files, so it is never logged. What is logged is a rejected path (truncated).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import type { AttachmentRef } from '../shared/protocol';
import type { EditorActions } from './chatController';
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
 * Builds the {@link EditorActions} backed by the real VS Code API.
 *
 * Decisions (plan `E2-mvp-prototype/plan-fase2` §3): copy goes through `env.clipboard` and not
 * `navigator.clipboard` in the iframe (the clipboard permission of a webview depends on focus,
 * HYPOTHESIS); insert replaces each selection through `TextEditor.edit` and not `insertSnippet`,
 * which would interpret `$` in the code; attachments are `file://` URLs made with `pathToFileURL`
 * because `Uri.toString()` encodes the Windows drive colon as `c%3A` and the server would have to
 * decode it (HYPOTHESIS that it does). `open` refuses anything outside the served folder
 * (`pathPolicy.ts`); symlinks are not resolved.
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
    async open(target, line, column) {
      const folder = workspaceFolder();
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
