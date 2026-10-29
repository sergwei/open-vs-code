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
import type { ContextDiagnostic } from './contextPrompts';
import { classifyDropped } from './droppedFiles';
import { isInServedFolder, selectionLines, toEditorRef } from './fileMentions';
import type { ServerLog } from './opencodeServer';
import {
  hasImageExtension,
  IMAGE_EXTENSIONS,
  resolveInsideFolder,
  toAttachmentName,
} from './pathPolicy';
import { pickWorkspaceFolder } from './serverManager';
import { openSessionDiff } from './sessionDiffEditor';

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
 * Issue #36 adds `options`: `uri` picks the editor showing the document a context menu was opened
 * on ({@link editorForMenu}) instead of the active one, and `diagnostics` fills
 * `EditorContext.diagnostics` ({@link readDiagnostics}); without options nothing changes. The
 * checks below ran WITHOUT options. The two new branches ran in `npm run test:integration` (Windows
 * 11, VS Code stable, 29/10/2026, fake-server label: 32 passing): "reads the editor of the clicked
 * document, not the active one" (the `uri` branch, with a hand-built `Uri` and a second active
 * editor) and "Fix with OpenCode runs on a file the TypeScript server reports an error for" (the
 * `diagnostics` branch ran without throwing and the prompt was accepted; that the diagnostic text
 * reaches the prompt is HYPOTHESIS here, the log has no text: only unit tests with a fake editor
 * show it). Then with a real right-click (`npm run test:visual`, Windows 11, VS Code 1.144.0,
 * 29/10/2026, full run): "C4 Fix sends the problems of both lines" (the two TypeScript errors,
 * with `Line 1:` and `Line 2:`, in the user message of the conversation) and "C3 Explain from the
 * editor sends "Explain what @src/sample.ts#2-3 does."" (the selection of the clicked editor).
 * Not observed: macOS and Linux, where the context menu may be native.
 * VERIFIED on Windows 11, VS Code 1.143.0 (22/10/2026), in two suites. `npm run test:integration`
 * (22 passing, 1 pending, no folder served): "refuses the editor context with no editor open
 * (NoActiveEditor)", "refuses an untitled document (NoFileOnDisk: Save the file first)" and
 * "refuses a file outside the workspace folder (OutsideWorkspace), with no folder served" (a real
 * file of `os.tmpdir()`, whole and with a selection; the log said `request ctx-outside failed:
 * OutsideWorkspace: Only files inside the workspace folder can be added` and no `editor context
 * added` line). `--label fake-server` (15 passing, a folder open, issue #41): "adds the whole file
 * when nothing is selected", "adds one selection per non-empty selection while the chat view has
 * the focus" (two selections, after `openVsCode.chat.focus`), "warns that the saved version is what
 * the model reads when the buffer is dirty" and "refuses a file outside the open workspace folder
 * (OutsideWorkspace)" (a file outside the served folder). These four ran before in the opt-in
 * `real-opencode` suite (17 passing on 22/10/2026, `editor context added: 0 file(s), 2
 * selection(s)` in the log) and moved because they never needed the real server. And in the real
 * chat of `test:visual` step 16: with the
 * focus in the webview, "Add selection adds the chip src/sample.ts#2-3" for a selection that ended
 * at column 0 of line 4. NOT observed: a document of another non-`file` scheme (only `untitled`),
 * a symlink inside the folder pointing outside it (the check is lexical, so it passes), a
 * notebook cell, the refusal notice in the webview, macOS and Linux.
 */
function readEditorContext(
  folder: string | undefined,
  options: { uri?: string; diagnostics?: boolean } = {},
): EditorContext {
  const editor = editorForMenu(options.uri) ?? vscode.window.activeTextEditor;
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
  return {
    refs,
    ranged: selections.length === 0 ? 0 : refs.length,
    unsaved: document.isDirty,
    ...(options.diagnostics === true
      ? { diagnostics: readDiagnostics(document.uri, selections) }
      : {}),
  };
}

/**
 * The visible editor showing the document a context menu was opened on (issue #36, risk R1: the
 * active editor is not necessarily the one that was right-clicked, as in a split or the left side
 * of a diff), or `undefined` when `uri` is absent, unparsable or shown by no visible editor, so
 * the caller falls back to the active one. Two editors on the same document: the first one in
 * `visibleTextEditors` wins, whichever held the click (HYPOTHESIS that this is acceptable: the
 * selection of the other one is not read). Compares `Uri.toString()` on both sides.
 * VERIFIED in VS Code 1.144.0 on Windows 11 (29/10/2026, `npm run test:integration`): the check
 * "reads the editor of the clicked document, not the active one" passes a `Uri` by hand while
 * another editor is active. UNVERIFIED in a real window with a split editor: no check
 * right-clicks the non-active side of a split.
 */
function editorForMenu(uri: string | undefined): vscode.TextEditor | undefined {
  if (uri === undefined) return undefined;
  let wanted: string;
  try {
    wanted = vscode.Uri.parse(uri).toString();
  } catch {
    return undefined;
  }
  return vscode.window.visibleTextEditors.find(
    (candidate) => candidate.document.uri.toString() === wanted,
  );
}

/**
 * The errors and warnings VS Code reports for `uri` (decision P4=1 of Sergio, 29/10/2026) that
 * touch one of `selections`, or all of them when nothing is selected. Hints and information are
 * left out: "fix" means the red and yellow squiggles. `line` is 1-based, the line the problem
 * starts on; `code` is the plain value (`2304`), also when the language service wraps it in a
 * `{ value, target }` object. A diagnostic with no source or code keeps only its message. The
 * messages are the language service's text, never the file's.
 * VERIFIED on Windows 11 (29/10/2026, `npm run test:integration`, profile with
 * `--disable-extensions`): in the check "Fix with OpenCode runs on a file the TypeScript server
 * reports an error for", `vscode.languages.getDiagnostics` returned an Error for
 * `export const broken: number = 'text';` (the check asserts it) in under a second. UNVERIFIED: the
 * `{ value, target }` shape of `code`, the selection filter EXCLUDING a diagnostic against a real
 * server (the selection of the run below covered both errors; the unit tests use fakes), other
 * languages, macOS and Linux.
 * VERIFIED against the real TypeScript server (`npm run test:visual`, Windows 11, VS Code 1.144.0,
 * 29/10/2026, full run): "C4 Fix sends the problems of both lines ("Fix the problems in
 * @src/broken26.ts#1-2. Problems reported by VS Code: - Line 1: Type 'string' is not assignable to
 * type 'number'. (ts 2322) - Line 2: ...")" with a selection over lines 1-2.
 */
function readDiagnostics(
  uri: vscode.Uri,
  selections: readonly vscode.Selection[],
): ContextDiagnostic[] {
  return vscode.languages
    .getDiagnostics(uri)
    .filter(
      (diagnostic) =>
        diagnostic.severity === vscode.DiagnosticSeverity.Error ||
        diagnostic.severity === vscode.DiagnosticSeverity.Warning,
    )
    .filter(
      (diagnostic) =>
        selections.length === 0 ||
        selections.some((selection) => selection.intersection(diagnostic.range) !== undefined),
    )
    .map((diagnostic): ContextDiagnostic => {
      const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
      return {
        line: diagnostic.range.start.line + 1,
        message: diagnostic.message,
        ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
        ...(code === undefined ? {} : { code: String(code) }),
      };
    });
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
 * `openDiff` (issue #31) is {@link openSessionDiff}: the controller has already checked the
 * whitelist, so it opens whatever target it is given.
 * VERIFIED in a real VS Code 1.142 on Windows 11 (20/10/2026, `npm run test:integration`): `newFile`
 * (with a known and an unknown language id), `insert` (a `$1`/`${name}` text stays verbatim),
 * `copy` and the refusal of `open` without a folder, all in `test/integration/editorActions.test.ts`.
 * Separately, VERIFIED in a real VS Code 1.143.0 on Windows 11 (22/10/2026,
 * `npm run test:integration -- --label fake-server`, a synthetic server, not a real opencode): the
 * check "opens a relative file at the requested line for editor.open" of `fakeServer.test.ts`
 * (it ran in the opt-in `realOpencode.test.ts` until issue #41).
 * The refusal of a path outside the folder is only unit-tested (`pathPolicy.test.ts`).
 * UNVERIFIED: `pickFiles` (a native dialog cannot be
 * driven by the test API; F5), including its `image` kind (E2, decision P11: an "Images" filter
 * plus `hasImageExtension` on what comes back; the visual run does not drive "Attach image…"
 * through the dialog, so it was never run in a real window), and `insert` when the focus is in the side view (whether
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

    editorContext(folder, options) {
      try {
        return Promise.resolve(readEditorContext(folder, options));
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

    openDiff(target) {
      return openSessionDiff(target);
    },

    async droppedFiles(folder, uris) {
      if (folder === undefined) {
        throw new EditorActionError(
          'OutsideWorkspace',
          'Only files inside the workspace folder can be added',
        );
      }
      const { candidates, outside, remote } = classifyDropped(folder, uris);
      const refs: AttachmentRef[] = [];
      let folders = 0;
      let missing = 0;
      for (const candidate of candidates) {
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.file(candidate.absolute));
          // A symlink to a file reports `File | SymbolicLink`; one to a folder `Directory | SymbolicLink`.
          if ((stat.type & vscode.FileType.Directory) !== 0) folders += 1;
          else if ((stat.type & vscode.FileType.File) !== 0) refs.push(candidate.ref);
          else missing += 1;
        } catch {
          missing += 1;
        }
      }
      return { refs, skipped: { folders, outside, remote, missing } };
    },

    async pickFiles(kind = 'file') {
      const folder = workspaceFolder();
      const images = kind === 'image';
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: images ? 'Attach image' : 'Attach',
        ...(images ? { filters: { Images: [...IMAGE_EXTENSIONS] } } : {}),
        ...(folder === undefined ? {} : { defaultUri: vscode.Uri.file(folder) }),
      });
      if (picked === undefined) return [];
      const chosen = images ? picked.filter((uri) => hasImageExtension(uri.fsPath)) : picked;
      return chosen.map((uri): AttachmentRef => {
        const fsPath = uri.fsPath;
        return {
          uri: pathToFileURL(fsPath).href,
          name: folder === undefined ? path.basename(fsPath) : toAttachmentName(folder, fsPath),
        };
      });
    },
  };
}
