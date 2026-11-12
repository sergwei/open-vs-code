// The VS Code side of "Export session" (issue #188): the native save dialog and the write of the
// file. Kept out of `chatController.ts` so the controller stays free of `vscode` (it receives this
// as `ChatControllerDeps.saveExport`); the content is built by `sessionTranscript.ts` or is the
// server's JSON.

import path from 'node:path';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { ExportFile } from './sessionTranscript';

/**
 * Asks where to save `file` in the native save dialog and writes it as UTF-8 (no BOM). Resolves
 * the NAME of the file written (its base name, never the full path, which can reveal the home
 * folder in a notice), or `undefined` when the user cancels the dialog. A write failure rejects
 * with the error of `workspace.fs`, which the controller turns into a notice.
 * The dialog opens at `folder` joined with the suggested name (`Uri.joinPath`, never string
 * concatenation) and filters by the extension of the name (Markdown or JSON, plus "All files").
 * VERIFIED on Windows 11, VS Code 1.146.0 (12/11/2026) with `files.simpleDialog.enable`, which turns
 * the dialog into a plain input box: `test:visual` step 55, "S6 the markdown file was written" and
 * "S6 the json file was written" (a path typed into the box was written as UTF-8). The native
 * Windows, macOS and Linux dialogs were never driven by any test.
 */
export async function saveExport(file: ExportFile): Promise<string | undefined> {
  const extension = path.extname(file.suggestedName).replace(/^\./, '');
  const label = extension === 'md' ? l10n.t('Markdown') : l10n.t('JSON');
  const defaultUri =
    file.folder === undefined
      ? undefined
      : vscode.Uri.joinPath(vscode.Uri.file(file.folder), file.suggestedName);
  const target = await vscode.window.showSaveDialog({
    ...(defaultUri === undefined ? {} : { defaultUri }),
    filters: { [label]: [extension], [l10n.t('All files')]: ['*'] },
    saveLabel: l10n.t('Export'),
  });
  if (target === undefined) return undefined;
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(file.content));
  return path.basename(target.fsPath);
}
