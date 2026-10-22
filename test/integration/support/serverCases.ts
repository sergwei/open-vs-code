// Helpers shared by the two suites that run the extension's OWN server in a real VS Code with a
// workspace folder: `realOpencode.test.ts` (opt-in, real opencode) and `fakeServer.test.ts`
// (always on, the synthetic fixture), issue #41. They only read the extension log, the folder
// and the process table; none of them knows which server is behind.
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { INJECT_WEBVIEW_MESSAGE_COMMAND_ID } from '../../../src/extension/ids';
import type { LogCursor } from './extensionLog';

/** Content of `src/sample.ts` in the served folder: three lines, so a range and a line are testable. */
export const SAMPLE_TS = 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n';

/**
 * Sleeps for `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Absolute path of the first workspace folder; fails the case when none is open.
 *
 * The message names the configuration because the usual cause is running the suite through the
 * `main` configuration, which has no folder.
 */
export function workspaceFolderPath(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(folder, 'no workspace folder is open: run with the configuration of .vscode-test.mjs');
  return folder;
}

/**
 * Writes `src/sample.ts` into the served folder (rewriting it, so a dirty case leaves no trace),
 * opens it and puts an empty selection at the start.
 *
 * The selection is reset because an editor that is already open keeps the one a previous case
 * left (a first run of the real-opencode cases counted the old selection instead of the whole file).
 */
export async function openSample(): Promise<vscode.TextEditor> {
  const file = path.join(workspaceFolderPath(), 'src', 'sample.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, SAMPLE_TS);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const editor = await vscode.window.showTextDocument(document);
  editor.selections = [new vscode.Selection(0, 0, 0, 0)];
  return editor;
}

/**
 * Sends `text` as a prompt the way the webview would and waits for the host to report that the
 * server accepted it. `delivery: 'queue'` so a busy session does not swallow it (opencode-api §7).
 */
export async function sendPrompt(log: LogCursor, text: string): Promise<void> {
  await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
    type: 'prompt.send',
    requestId: `integration-${String(Date.now())}`,
    text,
    delivery: 'queue',
    files: [],
  });
  await log.waitFor('prompt accepted for ses_', 10_000);
}

/**
 * Waits for `pattern` in the lines added since the mark and returns its match.
 *
 * Fails after `timeoutMs` with `what` and the added log; `hint` goes after `what` for suites that
 * know why the line may be missing (the real-opencode one: the model may not use the tool).
 */
export async function matchInLog(
  log: LogCursor,
  pattern: RegExp,
  timeoutMs: number,
  what: string,
  hint = '',
): Promise<RegExpExecArray> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = pattern.exec(log.added());
    if (found) return found;
    if (Date.now() >= deadline) {
      assert.fail(
        `${what} did not appear within ${String(timeoutMs)} ms${hint}; log:\n${log.added()}`,
      );
    }
    await sleep(100);
  }
}

/** Pid of the newest `server ready` line in `text`, or `undefined` when there is none. */
export function lastReadyPid(text: string): number | undefined {
  const all = [...text.matchAll(/server ready at \S+ \(opencode \S+, pid (\d+)\)/g)];
  const last = all[all.length - 1]?.[1];
  return last === undefined ? undefined : Number(last);
}

/** Polls until no process has this pid (`kill(pid, 0)` throws `ESRCH`), or fails after `timeoutMs`. */
export async function waitUntilGone(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    if (Date.now() >= deadline)
      assert.fail(`process ${String(pid)} still exists after ${String(timeoutMs)} ms`);
    await sleep(200);
  }
}
