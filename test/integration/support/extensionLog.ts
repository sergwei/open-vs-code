// Helper to observe the extension through its own `OpenCode.log` (issue #41, decision of Sergio in
// wave3/decisions: tests read the log of the isolated user data dir and `src/**` is not touched).
//
// The path and the format of that log are INTERNAL to VS Code, not API:
//   <userDataDir>/logs/<yyyymmddThhmmss>/window<N>/exthost/<publisher.name>/OpenCode.log
// Sources (microsoft/vscode main, read 2026-10-20): `extHostOutput.ts` L149-150 builds
// `<logsLocation>/<extensionId>/<channel name>.log` and `environmentService.ts` L73-77 puts the
// logs in `<userDataPath>/logs/<timestamp>`. If a VS Code release moves it, `findExtensionLog`
// fails listing what it did find, so the break is easy to read. The file logger flushes through a
// 100 ms throttled delayer (`fileLog.ts` L31), hence everything here polls with a timeout.
import * as fs from 'node:fs';
import * as path from 'node:path';

const EXTENSION_ID = 'sergwei.open-vs-code';
const LOG_FILE_NAME = 'OpenCode.log';
const POLL_INTERVAL_MS = 100;
const RENDERER_LOG_NAME = 'renderer.log';
// Lines worth showing in a failure (#141): VS Code's own webview messages. Our own choice.
const RENDERER_PATTERN = /Webview\(|Error loading webview|service worker/i;
const RENDERER_EXCERPT_MAX_LINES = 40;

/**
 * Sleeps for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lists the entries of a directory, or an empty list if it cannot be read.
 *
 * Used for diagnostics and probing; a missing directory is expected while VS Code is still
 * creating the log tree.
 */
function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Returns the user data dir of the test instance, set by `.vscode-test.mjs`.
 *
 * Throws if the variable is missing, which means the tests were not started through
 * `vscode-test` with this repository's config.
 */
function userDataDir(): string {
  const dir = process.env['OPEN_VS_CODE_TEST_USER_DATA_DIR'];
  if (dir === undefined || dir === '') {
    throw new Error('OPEN_VS_CODE_TEST_USER_DATA_DIR is not set; run through `vscode-test`.');
  }
  return dir;
}

/**
 * Finds `OpenCode.log` of the current test session, polling until it exists.
 *
 * Takes the most recent session folder under `logs/` (names are timestamps, so the greatest
 * sorts last; the folder of the running instance is the newest because it was just created),
 * then looks in every `window*` for the extension log. Rejects after `timeoutMs` with a listing of
 * the session folder, so a moved log path shows up as a readable failure.
 * HYPOTHESIS: the layout was read in the VS Code sources (see the top of this file), not
 * executed; the first real `npm run test:integration` confirms it.
 */
export async function findExtensionLog(timeoutMs: number): Promise<string> {
  const logsRoot = path.join(userDataDir(), 'logs');
  const deadline = Date.now() + timeoutMs;
  let lastSession = '(no session folder)';
  for (;;) {
    const sessions = listDir(logsRoot).sort();
    const session = sessions[sessions.length - 1];
    if (session !== undefined) {
      lastSession = path.join(logsRoot, session);
      for (const entry of listDir(lastSession)) {
        if (!entry.startsWith('window')) continue;
        const candidate = path.join(lastSession, entry, 'exthost', EXTENSION_ID, LOG_FILE_NAME);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${LOG_FILE_NAME} not found under ${lastSession} after ${timeoutMs} ms; ` +
          `entries: ${JSON.stringify(listDir(lastSession))}`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Reads the log from a byte offset to its end, as text.
 */
function readFrom(file: string, offset: number): string {
  const buffer = fs.readFileSync(file);
  return buffer.subarray(offset).toString('utf8');
}

/**
 * A position in the extension log: only what was appended after {@link LogCursor.mark} counts.
 *
 * Why: the log accumulates across the whole session, so each test marks the end of the file
 * before triggering the action and then looks only at the new lines. Matching is by literal
 * substring (Windows paths contain backslashes, which a hand-built regex would mangle).
 */
export class LogCursor {
  private offset = 0;
  private rendererOffset = 0;

  constructor(private readonly file: string) {}

  /**
   * Returns the `renderer.log` of the window this extension log belongs to.
   *
   * The extension log lives at `<window>/exthost/<id>/OpenCode.log`, so the window folder is three
   * levels up (the same layout {@link findExtensionLog} walks down). `path` is used for every step.
   * VERIFIED on Windows 11, VS Code 1.144.1 (03/11/2026): the window folder held `renderer.log`
   * next to `exthost` (listing of the newest session of the `main` profile).
   * UNVERIFIED on macOS and Linux until the CI runs it.
   */
  private rendererFile(): string {
    const windowDir = path.dirname(path.dirname(path.dirname(this.file)));
    return path.join(windowDir, RENDERER_LOG_NAME);
  }

  /**
   * Remembers the current end of the window's `renderer.log`, for
   * {@link LogCursor.rendererExcerpt}.
   *
   * Independent from {@link LogCursor.mark}: call it BEFORE the action that opens a tab, because
   * `mark()` is taken after the tab said `ready` and by then the handshake lines are behind it
   * (#141, reopened). A missing file leaves the offset at 0; it never throws.
   * VERIFIED (Windows 11, VS Code 1.144.1, 03/11/2026): the mutated run of `chatPanel.test.ts`
   * (`TAB_READY_WAIT_MS = 1`) failed with "renderer.log (webview lines):" and three
   * `Webview(<id>): will update content...` lines. UNVERIFIED that the offset excludes anything:
   * that renderer.log had no `Webview(` line before the New Session, so an offset of 0 would have
   * printed the same; a second wait or a case after another tab would exercise it.
   */
  markRenderer(): void {
    try {
      this.rendererOffset = fs.statSync(this.rendererFile()).size;
    } catch {
      this.rendererOffset = 0;
    }
  }

  /**
   * Returns the lines the renderer log gained since {@link LogCursor.markRenderer} that mention a
   * webview, or one fixed sentence if the file cannot be read or has none.
   *
   * Why: when a chat tab never says `ready` (#141, macOS runner) the host log shows only that
   * nothing arrived; the renderer log is where VS Code writes `Webview(<id>): …` (TRACE) and
   * `Error loading webview`, which tells a handshake that never completes from a bundle that never
   * posts `ready`. A line matches if it contains `Webview(`, `Error loading webview` or `service
   * worker` (case-insensitive). At most {@link RENDERER_EXCERPT_MAX_LINES} lines come back (the
   * FIRST ones: the handshake order is what matters), with a count of the omitted ones. The output
   * goes to the public CI log, but it is only a summary: with the renderer at trace
   * the test host already mirrors the WHOLE renderer.log to the job's stdout (runner paths, command
   * ids, settings keys, crash-reporter id; `main` has no server and no password), so this adds
   * nothing new to what is public.
   * UNVERIFIED: that those lines show up at all on the macOS runner (needs the renderer at trace,
   * see `.vscode-test.mjs`); the fixed sentence says so when they do not.
   */
  rendererExcerpt(): string {
    let text: string;
    try {
      text = readFrom(this.rendererFile(), this.rendererOffset);
    } catch {
      return '(renderer.log not readable)';
    }
    const lines = text.split(/\r?\n/).filter((line) => RENDERER_PATTERN.test(line));
    if (lines.length === 0) return '(no webview lines in renderer.log since the tab was requested)';
    const shown = lines.slice(0, RENDERER_EXCERPT_MAX_LINES);
    const omitted = lines.length - shown.length;
    return omitted > 0 ? `${shown.join('\n')}\n(+${String(omitted)} more lines)` : shown.join('\n');
  }

  /**
   * Moves the cursor to the current end of the log.
   */
  mark(): void {
    this.offset = fs.statSync(this.file).size;
  }

  /**
   * Returns what was appended since the last {@link LogCursor.mark}.
   */
  added(): string {
    return readFrom(this.file, this.offset);
  }

  /**
   * Waits until `text` appears in the lines added since the mark.
   *
   * Rejects after `timeoutMs` including the added text, so a failure shows what the log did
   * contain. Polls every 100 ms because the logger flushes with a delay.
   */
  async waitFor(text: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.added().includes(text)) return;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${timeoutMs} ms waiting for ${JSON.stringify(text)} in the log. ` +
            `Added since the mark:\n${this.added()}`,
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  /**
   * Waits until the log has stopped growing: its size is the same for `quietMs` in a row.
   *
   * For the pause a case used to take BEFORE a `mark()` so that what the previous action still
   * writes (a tab's first requests, a view's resolve) lands before the mark: it ends as soon as
   * the log is quiet instead of after a fixed 1.5 s. It says nothing about an event that has not
   * been logged yet, so it is NOT a substitute for waiting on a line that must appear, and it
   * does not prove the absence of anything (those cases keep their fixed margin).
   *
   * `quietMs` defaults to 500 ms: five polls, and five times the 100 ms flush delay of the
   * logger (HYPOTHESIS: leaves room for it, as `waitFor` assumes; read in `fileLog.ts` of
   * microsoft/vscode on 20/10/2026, see {@link openLogCursor}). Rejects after `timeoutMs` (default
   * 8000) if the log never stays quiet that long, with the size it had.
   */
  async waitForQuiet(quietMs = 500, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let size = fs.statSync(this.file).size;
    let since = Date.now();
    for (;;) {
      await sleep(POLL_INTERVAL_MS);
      const now = fs.statSync(this.file).size;
      if (now !== size) {
        size = now;
        since = Date.now();
      } else if (Date.now() - since >= quietMs) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(`The log did not stay quiet for ${quietMs} ms within ${timeoutMs} ms`);
      }
    }
  }

  /**
   * Throws if `text` is present in the lines added since the mark.
   *
   * It checks the current content only; the caller decides how long to wait before asking,
   * because absence cannot be proven without a delay.
   */
  assertAbsent(text: string): void {
    const added = this.added();
    if (added.includes(text)) {
      throw new Error(`Unexpected ${JSON.stringify(text)} in the log. Added:\n${added}`);
    }
  }
}

/**
 * Locates the log and returns a cursor already marked at its end.
 *
 * Call it after the extension is active. HYPOTHESIS: the file is created on the first write of
 * the channel (read in `extHostOutput.ts` / `fileLog.ts` of microsoft/vscode main, 2026-10-20);
 * if it is created lazily later, `findExtensionLog` polls until `timeoutMs`. The default of
 * 8000 ms is our own choice (the log appears in well under a second locally per the sources'
 * 100 ms delayer; the rest is margin for slow CI), not a VS Code value. Rejects like
 * {@link findExtensionLog}.
 */
export async function openLogCursor(timeoutMs = 8000): Promise<LogCursor> {
  const cursor = new LogCursor(await findExtensionLog(timeoutMs));
  cursor.mark();
  return cursor;
}

/**
 * Same as {@link openLogCursor} but with the cursor at the START of the file.
 *
 * For checks about lines written before the test could mark (activation, view resolution).
 * The 8000 ms default is our own choice, as in {@link openLogCursor}.
 */
export async function openLogFromStart(timeoutMs = 8000): Promise<LogCursor> {
  return new LogCursor(await findExtensionLog(timeoutMs));
}
