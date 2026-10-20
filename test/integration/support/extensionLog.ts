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

  constructor(private readonly file: string) {}

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
