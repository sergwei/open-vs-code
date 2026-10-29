// Editor actions suite (issues #13/#15, phase 2 of E2-mvp-prototype).
//
// Protects against: the actions behind the chat's code buttons and file links silently failing in
// a REAL VS Code even though the controller's unit tests pass with a fake editor. Each case
// drives the same path as a webview click: `openVsCode.test.injectWebviewMessage` runs the raw
// message through `isWebviewToHost` and the real `ChatController` + `editorActions.ts`. The
// iframe itself is out of reach of the test API, so what the buttons look like and whether the
// click reaches `postMessage` stay with the F5.
//
// This is the `main` configuration: NO workspace folder is open, which is exactly what the
// "open without a folder" case needs. Opening a real file at a line (`editor.open` inside a
// folder) is covered by `fakeServer.test.ts` (issue #41), whose configuration opens one and runs
// in CI; until then only the opt-in `realOpencode.test.ts` had it.
// Not covered here: the Attach file dialog (a native dialog, no test hook) and `insert` with the
// focus in the side view (needs a real click on the chat view; F5 point 3).
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { INJECT_WEBVIEW_MESSAGE_COMMAND_ID, NEW_SESSION_COMMAND_ID } from '../../src/extension/ids';
import { setChatLocation, waitForChatTabs } from './support/chatLocation';
import { openLogCursor } from './support/extensionLog';

const EXTENSION_ID = 'sergwei.open-vs-code';

/** Runs a raw webview message through the host, as the view would. */
async function inject(message: unknown): Promise<void> {
  await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, message);
}

/** Temp folders made by the editor-context cases, removed after each case. */
const tempDirs: string[] = [];

describe('editor actions', () => {
  before(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
  });

  afterEach(async () => {
    // A dirty buffer would make the close ask to save: revert first so the editors really close.
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    for (const dir of tempDirs.splice(0)) await removeTempDir(dir);
  });

  /**
   * Removes a temp folder of a case, retrying while Windows still holds it, and never fails.
   *
   * Issue #102: once on the Windows CI runner (VS Code 1.144.0) this `afterEach` failed with
   * "EBUSY: resource busy or locked, rmdir '…\ovsc-context-…'" after the editors were closed, and
   * the re-run passed. HYPOTHESIS: VS Code still held a handle on the folder for a moment after
   * `closeAllEditors`; not reproduced with VS Code. Node retries `EBUSY`/`EPERM`/`ENOTEMPTY` up to
   * `maxRetries` times, waiting `retryDelay` longer on each try (the values of
   * `fakeServer.test.ts`). VERIFIED on Windows 11 with Node 24.22.0 (28/10/2026), a scratch script
   * that kept a child process with its cwd inside the folder (a stand-in for VS Code's handle):
   * without the retries `fs.rm` threw "EBUSY: resource busy or locked, rmdir"; with them a 300 ms
   * hold gave "removed after 324 ms", a 1200 ms hold "removed after 1533 ms", and an 8000 ms hold
   * "EBUSY after 1539 ms", so the retries cover about 1.5 s. HYPOTHESIS: the Node inside VS Code's
   * Electron, where this hook really runs, retries the same way; no integration run has gone
   * through the retries yet. A folder still locked after the retries is only logged: a leftover
   * in the OS temp folder proves nothing about the action the case checked, so it must not turn
   * that case red.
   */
  async function removeTempDir(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.warn(
        `could not remove ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * "New file" opens an untitled document with the code and the language id the webview chose.
   *
   * The language comes from the fence table of the webview (`ts` -> `typescript`); the host
   * double-checks it against `languages.getLanguages()`, so the assertion on `languageId` also
   * proves that check let a real built-in id through.
   */
  it('opens an untitled document with the text and the language for editor.newFile', async () => {
    await inject({
      type: 'editor.newFile',
      text: 'const a: number = 1;\n',
      language: 'typescript',
    });
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, 'no active editor after editor.newFile');
    assert.strictEqual(editor.document.isUntitled, true);
    assert.strictEqual(editor.document.languageId, 'typescript');
    assert.strictEqual(editor.document.getText(), 'const a: number = 1;\n');
  });

  /**
   * An id VS Code does not know is dropped, not an error: the document still opens, as plain text.
   */
  it('ignores an unknown language id instead of failing editor.newFile', async () => {
    await inject({ type: 'editor.newFile', text: 'x', language: 'not-a-language' });
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor);
    assert.strictEqual(editor.document.getText(), 'x');
    assert.strictEqual(editor.document.languageId, 'plaintext');
  });

  /**
   * "Insert at cursor" puts the text at the cursor of the active editor, verbatim (a `$` in the
   * code must not be read as a snippet variable, which is why the host does not use
   * `insertSnippet`).
   */
  it('inserts the text at the cursor for editor.insert, without interpreting $', async () => {
    const document = await vscode.workspace.openTextDocument({ content: 'world' });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await inject({ type: 'editor.insert', text: 'const $1 = ${name}; ' });
    assert.strictEqual(document.getText(), 'const $1 = ${name}; world');
  });

  /**
   * "Insert at cursor" while a CHAT TAB is the active editor writes into the last text editor
   * (issue #77, risk R1 of the plan: `activeTextEditor` is documented as `undefined` while a
   * non-text editor is active, which would make Insert say "Open a file…").
   *
   * Protects `LastTextEditor`: a file open in column one, a chat tab opened beside it and active,
   * then the insert. The case logs what `activeTextEditor` was with the tab active, so the run
   * says whether R1 happens in this VS Code; the assertion holds either way (a defined value is
   * the same editor, an `undefined` one is rescued by the tracker). The text is untitled, so
   * nothing touches the disk.
   */
  it('inserts into the last text editor while a chat tab is the active editor', async () => {
    const log = await openLogCursor();
    await setChatLocation('editor', log);
    const document = await vscode.workspace.openTextDocument({ content: 'world' });
    try {
      const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
      editor.selection = new vscode.Selection(0, 0, 0, 0);
      await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
      await waitForChatTabs(1);
      const deadline = Date.now() + 8000;
      while (
        !(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview)
      ) {
        assert.ok(Date.now() < deadline, 'the chat tab never became the active tab');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      console.log(
        `R1: activeTextEditor with a chat tab active is ${
          vscode.window.activeTextEditor === undefined ? 'undefined' : 'the text editor'
        }`,
      );
      await inject({ type: 'editor.insert', text: 'hello ' });
      assert.strictEqual(document.getText(), 'hello world');
    } finally {
      await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
      await setChatLocation(undefined, log);
    }
  });

  /**
   * Copy goes through the host clipboard, not the iframe's.
   */
  it('writes the text to the clipboard for clipboard.write', async () => {
    await inject({ type: 'clipboard.write', text: 'copied from the chat' });
    assert.strictEqual(await vscode.env.clipboard.readText(), 'copied from the chat');
  });

  /**
   * With no folder open there is nothing to resolve a path against: the editor does not change
   * and the refusal is logged as a warning (the webview gets a notice).
   */
  it('refuses editor.open without a workspace folder and logs a warning', async () => {
    assert.strictEqual(vscode.workspace.workspaceFolders, undefined, 'a folder is open');
    const before = vscode.window.activeTextEditor;
    const log = await openLogCursor();
    await inject({ type: 'editor.open', path: 'src/a.ts', line: 3 });
    // 8000 ms is our own choice (margin for a slow CI), as in the other suites.
    await log.waitFor('editor.open failed: NoWorkspace', 8000);
    assert.strictEqual(vscode.window.activeTextEditor, before);
  });

  // Issue #29, decision Q3 of Sergio. These drive `attachments.fromEditor` through the real
  // `ChatController` and the real `readEditorContext`; what the webview does with the answer
  // (chips, the unsaved-changes notice) is out of reach of the test API and is `test:visual`.
  // The outcome is read from the log lines the controller writes: `request <id> failed: <code>`
  // and `editor context added: N file(s), M selection(s)`.

  /** Opens a file of `os.tmpdir()` with four lines, which the test removes afterwards. */
  async function openTempFile(): Promise<{ uri: vscode.Uri; editor: vscode.TextEditor }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ovsc-context-'));
    const file = path.join(dir, 'sample.ts');
    await fs.writeFile(file, 'one\ntwo\nthree\nfour\n');
    tempDirs.push(dir);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(document);
    return { uri: document.uri, editor };
  }

  it('refuses the editor context with no editor open (NoActiveEditor)', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    assert.strictEqual(vscode.window.activeTextEditor, undefined);
    const log = await openLogCursor();
    await inject({ type: 'attachments.fromEditor', requestId: 'ctx-none' });
    await log.waitFor('request ctx-none failed: NoActiveEditor', 8000);
  });

  it('refuses an untitled document (NoFileOnDisk: Save the file first)', async () => {
    const document = await vscode.workspace.openTextDocument({ content: 'draft' });
    await vscode.window.showTextDocument(document);
    const log = await openLogCursor();
    await inject({ type: 'attachments.fromEditor', requestId: 'ctx-untitled' });
    await log.waitFor('request ctx-untitled failed: NoFileOnDisk: Save the file first', 8000);
  });

  // Decision W2 of Sergio (22/10/2026): only files inside the served folder can be added. This
  // configuration serves NO folder, so a real file of `os.tmpdir()` is refused whether it is a
  // whole file or a selection, and nothing is added. The cases that need a served folder (the
  // whole file, one selection per range with the chat view focused, the dirty buffer, and a file
  // outside an OPEN folder) live in `fakeServer.test.ts`, whose configuration opens one.
  it('refuses a file outside the workspace folder (OutsideWorkspace), with no folder served', async () => {
    const { editor } = await openTempFile();
    const log = await openLogCursor();
    await inject({ type: 'attachments.fromEditor', requestId: 'ctx-outside' });
    await log.waitFor(
      'request ctx-outside failed: OutsideWorkspace: Only files inside the workspace folder can be added',
      8000,
    );
    editor.selection = new vscode.Selection(1, 0, 2, 2);
    await vscode.commands.executeCommand('openVsCode.chat.focus');
    await inject({ type: 'attachments.fromEditor', requestId: 'ctx-outside-selection' });
    await log.waitFor('request ctx-outside-selection failed: OutsideWorkspace', 8000);
    assert.ok(
      !log.added().includes('editor context added'),
      `a file outside the folder was added; log:\n${log.added()}`,
    );
  });
});
