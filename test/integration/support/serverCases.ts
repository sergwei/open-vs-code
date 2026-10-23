// Helpers shared by the two suites that run the extension's OWN server in a real VS Code with a
// workspace folder: `realOpencode.test.ts` (opt-in, real opencode) and `fakeServer.test.ts`
// (always on, the synthetic fixture), issue #41. They only read the extension log, the folder
// and the process table; none of them knows which server is behind. `startOwnServer` is the one
// exception: it starts a SECOND server of its own, outside the extension, for the cases that talk
// to the API directly (the contract of `realOpencode.test.ts`, the external-server case).
import * as assert from 'node:assert';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OpenCode, type OpenCodeClient } from '@opencode/client';
import * as vscode from 'vscode';
import { INJECT_WEBVIEW_MESSAGE_COMMAND_ID } from '../../../src/extension/ids';
import {
  basicAuthHeader,
  killTree,
  readUrlLine,
  waitForExit,
} from '../../../src/extension/opencodeServer';
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

/** A `serve --stdio` process started by a test itself, with a client already pointed at it. */
export interface OwnServer {
  /** `http://127.0.0.1:<port>`, as the server printed it. */
  origin: string;
  password: string;
  /** The full promise client (not the narrow one of the host), authenticated and tied to the folder. */
  client: OpenCodeClient;
  /** Closes stdin, and kills the process tree if the server ignores it. Safe to call twice. */
  stop(): Promise<void>;
}

/**
 * Starts `<binary> serve --stdio --hostname 127.0.0.1 --port 0` in `folder` with `password`, reads
 * its `{"url":…}` line and returns the server with a client for it.
 *
 * It is NOT the extension's server: the test owns the process and must call `stop()` (the external
 * server case and the contract cases of `realOpencode.test.ts` do it in `finally` / `after`). The
 * environment is the test host's, so the redirected XDG dirs of `.vscode-test.mjs` apply and the
 * run does not touch the developer's opencode data. The extracted code is the spawn that the
 * external-server case used to carry inline; VERIFIED there against a real opencode 2.0.32
 * (Windows 11, 22/10/2026), and by the cases of this suite that use it now (see their headers).
 */
export async function startOwnServer(
  binary: string,
  folder: string,
  password = 'own-server-pw',
): Promise<OwnServer> {
  const child: ChildProcessWithoutNullStreams = spawn(
    binary,
    ['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0'],
    {
      cwd: folder,
      env: { ...process.env, OPENCODE_PASSWORD: password },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    },
  );
  child.stderr.resume();
  const quiet = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
  let origin: string;
  try {
    origin = await readUrlLine(child.stdout, 35_000, quiet);
  } catch (error) {
    await killTree(child, quiet);
    throw error;
  }
  const client = OpenCode.make({
    baseUrl: origin,
    headers: {
      Authorization: basicAuthHeader(password),
      'x-opencode-directory': encodeURIComponent(folder),
    },
  });
  let stopped: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopped ??= (async () => {
      child.stdin.end();
      // Back-up (S5 of the review of #11): a real opencode that ignores the EOF must not outlive the run.
      if (!(await waitForExit(child, 10_000))) {
        await killTree(child, quiet);
        await waitForExit(child, 10_000);
      }
    })();
    return stopped;
  };
  return { origin, password, client, stop };
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
