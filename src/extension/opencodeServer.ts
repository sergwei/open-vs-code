// Starts, checks and stops ONE `opencode serve --stdio` process (issue #8). Pure logic: no
// `vscode` import, so it is unit-testable with a synthetic stand-in (see
// `test-fixtures/fake-opencode.mjs`). The state machine that decides WHEN to start lives in
// `serverManager.ts`, the VS Code wiring in `serverLifecycle.ts`.
//
// Everything here is based on `references/arranque.md` of the opencode-api skill (reviewed code,
// itself never run against a real opencode) plus the improvements listed on each function.
// VERIFIED against the real opencode 2.0.32 (npm @opencode/cli), Windows 11, spike on 2026-10-20:
// `--version` prints `opencode v2.0.32`; `--port 0` prints the real port in ~280 ms; `/api/info`
// answers 200 `{version,pid,urls,paths:{tmp},capabilities}` (401 without auth and with a wrong
// password); closing stdin makes it exit 0 in ~30 ms and its only child (`conhost.exe`)
// disappears; it exits by itself when the parent process dies (the parent was a plain Node
// process in the spike, not a VS Code extension host); and this module, bundled, ran
// detect, start, fetch, check and stop end to end (`how: 'stdin'`, 26 ms, no leftovers).
// Still UNVERIFIED: POSIX with a real opencode, the children opencode spawns on demand (LSP,
// MCP, PTY) dying with the tree kill, and the proxy layer of the host's `fetch`.
// Unit tests run against the synthetic fixture (`test-fixtures/fake-opencode.mjs`); the opt-in
// integration test `realOpencode.test.ts` runs the real binary inside VS Code (not run yet).

import {
  execFile,
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { parseOpencodeVersion } from './opencodeBinary';

/**
 * The opencode version the extension is developed against. It moves together with the
 * `@opencode/client` pin (opencode-api skill, references/mantenimiento.md). A different version
 * only produces a warning in the log, never a failure; a different major does fail.
 */
export const PINNED_OPENCODE_VERSION = '2.0.32';

/** Time to wait for the `{url}` line. Our own choice (upstream gives no figure): HYPOTHESIS. */
export const STARTUP_TIMEOUT_MS = 30_000;

/** Time to wait for `GET /api/info`. Our own choice: HYPOTHESIS that 5 s covers a loaded machine. */
export const INFO_TIMEOUT_MS = 5_000;

/**
 * Grace period after closing stdin before the tree kill, and the wait after the kill.
 *
 * 2 s + 1 s and not the skill's 5 s because VS Code gives all extensions at most 5 s to finish
 * an async `deactivate` on shutdown ("Give extensions at most 5 seconds to wrap up any async
 * deactivate, then exit", `extHostExtensionService.ts` on the microsoft/vscode main branch, read
 * 2026-10-20, not run and not checked on the 1.105 tag). HYPOTHESIS: with a 5 s grace the kill
 * would never get to run.
 */
export const STOP_GRACE_MS = 2_000;
export const STOP_KILL_WAIT_MS = 1_000;

/** Pause that lets the last stderr lines arrive before an "exited" error is built. HYPOTHESIS. */
const STDERR_FLUSH_MS = 50;

/** How many trailing stderr lines go into a startup error message. */
const STDERR_TAIL_LINES = 5;

/**
 * Hosts a server URL may have: the password only ever travels to loopback. `localhost` is left
 * out on purpose: we launch with `--hostname 127.0.0.1`, so accepting a name resolved through
 * hosts/DNS would only widen where the Basic credential can go.
 */
const LOOPBACK_HOSTS = ['127.0.0.1', '[::1]'];

/** Anything with the four log levels; `vscode.LogOutputChannel` satisfies it structurally. */
export interface ServerLog {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/**
 * Wraps a {@link ServerLog} so that no call can throw: each level runs in its own try/catch and
 * a failure is swallowed.
 *
 * Why: a disposed `vscode.LogOutputChannel` THROWS "Channel has been closed" on info/warn/error,
 * and a log call that throws in the middle of the stop path would skip the tree kill and leave an
 * orphan (review of issue #8, BLOCKER). Logging is diagnostics, never a precondition for killing a
 * process, so every function here that logs and also kills guards its log with this. Returns a
 * new object; the original is untouched. VERIFIED on Windows 11 / Node 24.22.0 by a test that
 * makes the log throw as `stop()` is called against an `ignore-stdin` fixture and checks that the
 * process and its grandchild still die. That the real channel throws after dispose was VERIFIED
 * by `reviewer` reading the VS Code 1.142 bundle and with a probe; not re-run in VS Code itself.
 */
export function safeLog(log: ServerLog): ServerLog {
  const guard =
    (level: 'info' | 'warn' | 'error' | 'debug') =>
    (message: string): void => {
      try {
        log[level](message);
      } catch {
        // diagnostics must never interrupt the start or the kill
      }
    };
  return { info: guard('info'), warn: guard('warn'), error: guard('error'), debug: guard('debug') };
}

/** Why {@link startServer} gave up. */
export type ServerStartErrorCode =
  'timeout' | 'exited' | 'spawn-failed' | 'folder-missing' | 'port-zero' | 'bad-url' | 'aborted';

/** Typed startup failure; `code` lets the manager choose a reaction (plan B for `port-zero`). */
export class ServerStartError extends Error {
  constructor(
    readonly code: ServerStartErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ServerStartError';
  }
}

/** A started server: the child (owned by the caller) and the credentials to talk to it. */
export interface RunningServer {
  child: ChildProcessWithoutNullStreams;
  url: string;
  password: string;
}

/** Inputs of {@link startServer}. `prefixArgs` exists only so tests can run `node fixture.mjs`. */
export interface StartServerOptions {
  command: string;
  prefixArgs?: string[];
  folder: string;
  /** `0` asks for an ephemeral port; `undefined` omits `--port` (plan B, searches from 4096). */
  port: 0 | undefined;
  log: ServerLog;
  baseEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  startupTimeoutMs?: number;
  killWaitMs?: number;
  signal?: AbortSignal;
}

/** How {@link stopServer} ended; `unkillable` means the process was still alive after the kill. */
export interface StopResult {
  how: 'already-exited' | 'stdin' | 'killed' | 'unkillable';
}

/** What the extension needs from `GET /api/info`. */
export interface ServerInfo {
  version: string;
  pid: number | undefined;
}

/** Verdict of {@link checkServerVersion}. */
export interface VersionCheck {
  kind: 'ok' | 'warn' | 'unsupported';
  message: string;
}

/**
 * Arguments for `opencode serve`, always with `--stdio` and loopback.
 *
 * `--port 0` is our choice (Sergio, Engram 841) so the fixed 4096 other tools expect is left
 * alone. VERIFIED (Windows 11, real opencode 2.0.32, spike on 2026-10-20): the printed URL
 * carries the real port, so plan B (`port-zero`, where the manager retries with `undefined` and
 * the server searches upwards from 4096) did not trigger. Kept as a safety net; POSIX
 * UNVERIFIED.
 */
export function serveArgs(port: 0 | undefined): string[] {
  const args = ['serve', '--stdio', '--hostname', '127.0.0.1'];
  if (port !== undefined) args.push('--port', String(port));
  return args;
}

/**
 * Builds the child's environment: a copy of `baseEnv` carrying our random `OPENCODE_PASSWORD`
 * and no `OPENCODE_SERVER_PASSWORD`.
 *
 * `OPENCODE_PASSWORD` wins over the legacy name inside the server (`env.ts:7-13@v2.0.32`), so a
 * user-defined one would make our client get 401: it is overwritten, and the legacy one removed.
 * On win32 any spelling of both names is removed first, because the spread of `process.env`
 * is a plain case-sensitive object there; which variant would win in the child if two spellings
 * survived is HYPOTHESIS, so the doubt is removed instead of tested. Does not mutate `baseEnv`.
 * VERIFIED by unit tests (synthetic input).
 */
export function buildServeEnv(
  baseEnv: NodeJS.ProcessEnv,
  password: string,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  if (platform === 'win32') {
    for (const key of Object.keys(env)) {
      const upper = key.toUpperCase();
      if (upper === 'OPENCODE_PASSWORD' || upper === 'OPENCODE_SERVER_PASSWORD') delete env[key];
    }
  }
  delete env['OPENCODE_SERVER_PASSWORD'];
  env['OPENCODE_PASSWORD'] = password;
  return env;
}

/**
 * Interprets one stdout line as the readiness line `{ "url": "http://127.0.0.1:<port>" }`.
 *
 * Returns `undefined` when the line is not ours (not JSON, or JSON without a string `url`), so
 * callers skip noise. A line that is ours but unusable returns an `error`: `port-zero` when the
 * port is `0` (trigger of plan B) and `bad-url` for anything that is not plain `http` on
 * loopback with an explicit port, because the Basic credentials would travel to that URL.
 * The returned `url` is the normalized origin (no trailing slash). A trailing `\r` (CRLF) is fine
 * because `JSON.parse` ignores it. VERIFIED by unit tests (synthetic lines) and by the line of
 * the real opencode 2.0.32 (Windows 11, spike on 2026-10-20: `{"url":"http://127.0.0.1:<port>"}`
 * with the real port under `--port 0`).
 */
export function parseUrlLine(
  line: string,
): { url: string } | { error: 'port-zero' | 'bad-url'; message: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('url' in parsed) ||
    typeof parsed.url !== 'string'
  ) {
    return undefined;
  }
  const raw = parsed.url;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'bad-url', message: `the server printed an invalid url: ${raw}` };
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.includes(url.hostname)) {
    return {
      error: 'bad-url',
      message: `the server printed a url that is not plain http on loopback: ${raw}`,
    };
  }
  if (url.port === '0') {
    return { error: 'port-zero', message: `the server printed port 0 in its url: ${raw}` };
  }
  if (url.port === '') {
    return { error: 'bad-url', message: `the server printed a url without a port: ${raw}` };
  }
  return { url: url.origin };
}

/**
 * Value of the `Authorization` header for the server: Basic with the fixed user `opencode`.
 *
 * Exported so the SDK client of issue #9 can reuse it in `OpenCode.make({ headers })`. The user
 * name is fixed by the server (`auth.ts:18-37@v2.0.32`). VERIFIED by a unit test against a
 * hand-computed base64 string, and the real opencode 2.0.32 accepted it (200 on `/api/info`;
 * 401 without it and with a wrong password; Windows 11, spike on 2026-10-20).
 */
export function basicAuthHeader(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
}

/**
 * Resolves with the server URL from the first stdout line that {@link parseUrlLine} accepts.
 *
 * Rejects with `timeout`, with `port-zero`/`bad-url` when the line is ours but unusable, and
 * with `exited` if stdout closes first. It does NOT kill the child: the caller owns the process.
 * The line interface is deliberately kept open after success so stdout keeps being drained
 * (lines go to `log.debug`): closing it pauses the stream (VERIFIED by `reviewer`, Node 20.19.6),
 * and that an undrained pipe blocks the child is HYPOTHESIS. Non-matching lines before the URL
 * are logged at debug too.
 */
export function readUrlLine(
  stdout: Readable,
  timeoutMs: number,
  rawLog: ServerLog,
): Promise<string> {
  const log = safeLog(rawLog); // the line handler runs inside an event: a throw would be uncaught
  return new Promise((resolve, reject) => {
    let settled = false;
    const lines = createInterface({ input: stdout });
    const timer = setTimeout(() => {
      settled = true;
      reject(
        new ServerStartError('timeout', `timed out after ${timeoutMs} ms waiting for the url line`),
      );
    }, timeoutMs);
    lines.on('line', (line) => {
      if (settled) {
        log.debug(`[opencode stdout] ${line}`);
        return;
      }
      const result = parseUrlLine(line);
      if (result === undefined) {
        log.debug(`[opencode stdout] ${line}`);
        return;
      }
      settled = true;
      clearTimeout(timer);
      if ('error' in result) reject(new ServerStartError(result.error, result.message));
      else resolve(result.url);
    });
    lines.on('close', () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new ServerStartError('exited', 'stdout closed before the url line'));
      }
    });
  });
}

/**
 * Waits for the child's `exit` event, never `close`, and resolves `true` if it exited within
 * `ms` (immediately if it already had), `false` otherwise.
 *
 * `close` waits for every stdio stream to end, and a grandchild that inherited stdout keeps them
 * open after the child is gone, so `close` could hang a stop that already succeeded. A child
 * that never spawned (ENOENT) never exits: do not call this for one.
 */
export function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, ms);
    child.once('exit', onExit);
  });
}

/**
 * Kills `child` and everything it spawned: `taskkill /T /F` on Windows, the whole process group
 * on POSIX (that is why {@link startServer} spawns `detached` there). Last resort: the normal
 * stop is closing stdin.
 *
 * Differences from `references/arranque.md`: also skips when `signalCode` is set (a child killed
 * by a signal has `exitCode === null`), and on Windows runs `%SystemRoot%\System32\taskkill.exe`
 * by absolute path so a `taskkill` planted in PATH is not picked up (falls back to the bare name
 * when `SystemRoot` is unset). If `taskkill` fails it falls back to `child.kill()` and logs why.
 * On every OS, if the server already exited its leftover grandchildren are not chased (decision
 * of 2026-10-19 for POSIX, Engram 845, extended to Windows on 2026-10-20, Engram 883): on POSIX
 * always sending `kill(-pid)` risks hitting a reused process group; on Windows `taskkill /T` on a
 * dead pid fails ("process not found", exit 128, VERIFIED with a probe) and hunting orphans by
 * ParentProcessId has the same pid-reuse risk. On Windows, children a libuv runtime spawns
 * without `detached` die with their parent through a job object (VERIFIED with Node); that
 * opencode (built with Bun) behaves the same is HYPOTHESIS.
 * Resolves when `taskkill` finished; the caller still waits for `exit`. The log is guarded with
 * {@link safeLog}: a log that throws must not skip the fallback `child.kill()`.
 * VERIFIED on Windows 11 / Node 24.22.0 by the test suite: `taskkill /T /F` killed a synthetic
 * child and its DETACHED grandchild (detached so the job object cannot be what kills it; without
 * `/T` that grandchild survives and the test fails, checked by mutation on 2026-10-20).
 * HYPOTHESIS: that opencode's real children (LSP, MCP, PTY) die too.
 * POSIX UNVERIFIED on this machine (the `kill(-pgid)` branch only runs in a Linux/macOS CI).
 */
export async function killTree(
  child: ChildProcess,
  rawLog: ServerLog,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const log = safeLog(rawLog);
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (platform === 'win32') {
    const root = process.env['SystemRoot'];
    const taskkill = root === undefined ? 'taskkill' : path.join(root, 'System32', 'taskkill.exe');
    await new Promise<void>((resolve) => {
      execFile(
        taskkill,
        ['/pid', String(child.pid), '/T', '/F'],
        { windowsHide: true },
        (error) => {
          if (error !== null) {
            log.warn(`taskkill failed, falling back to child.kill(): ${error.message}`);
            child.kill();
          }
          resolve();
        },
      );
    });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL'); // the group is already gone, or was never ours
  }
}

/** Confirms `folder` exists and is a directory, or throws `folder-missing`. */
async function assertDirectory(folder: string): Promise<void> {
  try {
    if ((await stat(folder)).isDirectory()) return;
  } catch {
    // falls through to the error below
  }
  throw new ServerStartError('folder-missing', `the workspace folder does not exist: ${folder}`);
}

/**
 * Spawns `opencode serve --stdio` in `folder` and waits for its readiness line.
 *
 * On ANY failure (timeout, early exit, ENOENT, bad URL, abort) it kills the tree and waits for
 * the exit before throwing, so a failed start never leaves an orphan (CLAUDE.md rule 3). It does
 * NOT close stdin first: with a server that exits on stdin EOF, the voluntary exit won the race
 * against `taskkill` and the tree kill then found a dead root and skipped its detached children
 * (VERIFIED on Windows 11 / Node 24.22.0 with a probe: `taskkill` answered "process not found",
 * the root was dead and the detached grandchild alive; without `stdin.end()` both die and the
 * timeout test passes 3 of 3). Spawns with `shell: false`, `windowsHide`, `detached` only off
 * Windows, and a fresh random password (24 bytes, base64url) that travels only through the
 * child's env.
 * Improvements over `references/arranque.md`, each with a test: the folder is checked first
 * (VERIFIED on Windows 11 / Node 24.22.0: `spawn` with a missing `cwd` emits `ENOENT` blaming
 * the binary, which would send the user to the wrong fix); the child's `exit` joins the race
 * (a grandchild holding stdout would otherwise leave only the 30 s timeout); `signal` aborts;
 * stderr goes to `log.info` line by line and its tail enriches an `exited` error.
 * The log is guarded with {@link safeLog}, so a log that throws cannot interrupt the start or
 * the cleanup kill. The abort listener is registered and then `signal.aborted` is checked again:
 * an abort that lands during the `stat` of the folder would otherwise be lost (an `abort` event
 * is not replayed to listeners added afterwards) and the stop would wait for the 30 s timeout.
 * Rejects with {@link ServerStartError}; the unhandled-rejection trap of ENOENT is covered by
 * a test. VERIFIED against the synthetic fixture on Windows 11 and against the real opencode
 * 2.0.32 on Windows 11 (npm @opencode/cli, spike on 2026-10-20: started and stopped with no
 * leftovers); POSIX is UNVERIFIED. The lost-abort window is VERIFIED only by a test that
 * simulates it (a signal whose `aborted` flips after the first read), not by a real race.
 * That abort is seen right after the spawn, so the kill can land before the child runs a single
 * line: after the spawn it logs `spawned pid N` so a test can prove the process is gone without
 * waiting for output the killed child never wrote (VERIFIED: CI run 39425766653 failed on
 * ubuntu, macOS and Windows waiting for the fixture's `argv` line; reproduced locally on
 * Windows by passing `platform: 'linux'`, where `process.kill(-pid)` throws and the fallback
 * `child.kill('SIGKILL')` is immediate, unlike the ~200 ms of `taskkill.exe`).
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { command, folder, port, signal } = options;
  const log = safeLog(options.log);
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
  const killWaitMs = options.killWaitMs ?? STOP_KILL_WAIT_MS;
  if (signal?.aborted === true) throw new ServerStartError('aborted', 'the start was cancelled');
  await assertDirectory(folder);

  const password = randomBytes(24).toString('base64url');
  const env = buildServeEnv(options.baseEnv ?? process.env, password, platform);
  const args = [...(options.prefixArgs ?? []), ...serveArgs(port)];
  log.info(`launching: ${command} ${args.join(' ')} (cwd ${folder})`);

  const child = spawn(command, args, {
    cwd: folder,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    detached: platform !== 'win32', // own process group, so killTree can signal -pgid
  });
  // Logged synchronously after the spawn: it is the only record of the pid when an immediate
  // abort kills the child before it prints anything (see the header). Undefined on ENOENT.
  if (child.pid !== undefined) log.info(`spawned pid ${String(child.pid)}`);

  const stderrTail: string[] = [];
  let exitInfo: string | undefined;
  let removeAbort = (): void => undefined;
  // Without an 'error' listener a failed spawn (ENOENT) throws inside the extension host.
  const failure = new Promise<never>((_resolve, reject) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      const reason =
        error.code === 'ENOENT'
          ? `opencode binary not found: ${command}`
          : `could not launch ${command}: ${error.message}`;
      reject(new ServerStartError('spawn-failed', reason));
    });
    child.once('exit', (code, exitSignal) => {
      exitInfo = `exited (code ${String(code)}, signal ${String(exitSignal)})`;
      reject(new ServerStartError('exited', exitInfo));
    });
    if (signal !== undefined) {
      const onAbort = (): void => {
        reject(new ServerStartError('aborted', 'the start was cancelled'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbort = () => {
        signal.removeEventListener('abort', onAbort);
      };
      if (signal.aborted) onAbort(); // aborted while we awaited the folder check or the spawn
    }
  });
  failure.catch(() => undefined); // a late 'error' or 'exit' after success must not be unhandled
  child.stdin.on('error', () => undefined); // EPIPE when ending stdin of an already dead child
  createInterface({ input: child.stderr }).on('line', (line) => {
    stderrTail.push(line);
    if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
    log.info(`[opencode] ${line}`);
  });

  try {
    const url = await Promise.race([readUrlLine(child.stdout, timeoutMs, log), failure]);
    return { child, url, password };
  } catch (error) {
    // No `stdin.end()` first: a server that exits on stdin EOF would be gone before `taskkill`
    // (which takes a few hundred ms to start) reaches it, and its detached children would be
    // orphaned (see the header of this function). Killing while the root is alive is what lets
    // `/T` walk the tree; the kill closes the pipes anyway.
    await killTree(child, log, platform);
    if (child.pid !== undefined) await waitForExit(child, killWaitMs);
    if (error instanceof ServerStartError && error.code === 'exited') {
      await new Promise((resolve) => setTimeout(resolve, STDERR_FLUSH_MS));
      const what = exitInfo ?? error.message;
      const tail = stderrTail.length === 0 ? '' : `: ${stderrTail.join(' | ')}`;
      throw new ServerStartError('exited', `opencode ${what} before printing its url${tail}`);
    }
    throw error;
  } finally {
    removeAbort();
  }
}

/**
 * Stops a server politely and escalates: closes stdin, waits `graceMs` for `exit`, then kills
 * the tree and waits `killWaitMs`. Always resolves (never hangs) and reports how it ended.
 *
 * The server shuts down when stdin ends (`server-process.ts:204-239@v2.0.32`, read and run on Windows, see below), and
 * also when the extension host dies and the OS closes the pipe. The log is guarded with
 * {@link safeLog} and the kill never depends on it: a log that throws (a closed channel) does not
 * skip `killTree`. VERIFIED against the real opencode 2.0.32 on Windows 11 (npm @opencode/cli,
 * spike on 2026-10-20): the stdin path exited 0 in ~30 ms and its only child (`conhost.exe`)
 * went away. VERIFIED against the synthetic fixture on Windows 11 (stdin path, kill path, and
 * the kill path with a log that throws). The kill path with a real opencode, and POSIX, are
 * UNVERIFIED.
 */
export async function stopServer(
  child: ChildProcess,
  rawLog: ServerLog,
  options: { graceMs?: number; killWaitMs?: number } = {},
): Promise<StopResult> {
  const log = safeLog(rawLog);
  if (child.exitCode !== null || child.signalCode !== null) return { how: 'already-exited' };
  child.stdin?.end();
  if (await waitForExit(child, options.graceMs ?? STOP_GRACE_MS)) {
    log.info('opencode server stopped (stdin closed)');
    return { how: 'stdin' };
  }
  log.warn('opencode server did not exit after stdin closed; killing the process tree');
  await killTree(child, log);
  if (await waitForExit(child, options.killWaitMs ?? STOP_KILL_WAIT_MS)) {
    log.info('opencode server stopped (process tree killed)');
    return { how: 'killed' };
  }
  log.error('opencode server is still running after the kill');
  return { how: 'unkillable' };
}

/**
 * Asks the server for `GET /api/info` with Basic auth and returns `{ version, pid }`.
 *
 * Plain `fetch` on purpose (decision of Sergio, 2026-10-20): no `@opencode/client` yet, that is
 * issue #9. `fetchImpl` is injectable for tests and as an escape hatch if the extension host's
 * proxy layer intercepts loopback (HYPOTHESIS, not checked). Rejects on network failure,
 * timeout, non-2xx status or a body without a string `version`; the messages never contain
 * the password. The request ends at the first of `timeoutMs` and the optional `signal`
 * (combined with `AbortSignal.any`), so the manager can cancel it when `stop()` is called
 * instead of waiting up to {@link INFO_TIMEOUT_MS}. The body shape `{ version, pid, urls, paths }`
 * is VERIFIED against the real opencode 2.0.32 (Windows 11, spike on 2026-10-20: 200 with
 * `{version,pid,urls,paths:{tmp},capabilities}`); the abort is VERIFIED against a synthetic
 * `fetchImpl` that honours it. Inside the extension host the global `fetch` is UNVERIFIED (the
 * spike ran under plain Node).
 */
export async function fetchServerInfo(
  url: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = INFO_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<ServerInfo> {
  let response: Response;
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    response = await fetchImpl(`${url}/api/info`, {
      headers: { Authorization: basicAuthHeader(password) },
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
  } catch (error) {
    throw new Error(
      `GET /api/info failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!response.ok) throw new Error(`GET /api/info failed: HTTP ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('GET /api/info returned a body that is not JSON');
  }
  if (typeof body !== 'object' || body === null || !('version' in body)) {
    throw new Error('GET /api/info returned a body without a version');
  }
  const { version } = body;
  if (typeof version !== 'string') {
    throw new Error('GET /api/info returned a version that is not a string');
  }
  const pid = 'pid' in body && typeof body.pid === 'number' ? body.pid : undefined;
  return { version, pid };
}

/**
 * Judges the version the server reports: major other than 2 is `unsupported`, a different
 * `x.y.z` than {@link PINNED_OPENCODE_VERSION} or an unparseable one (`local`) is a `warn` that
 * lets the start continue, an exact match is `ok`. Reuses `parseOpencodeVersion` from the
 * detection. VERIFIED by unit tests (synthetic strings).
 */
export function checkServerVersion(version: string): VersionCheck {
  const parsed = parseOpencodeVersion(version);
  if (parsed === undefined) {
    return {
      kind: 'warn',
      message: `the server reports the version "${version}", which is not x.y.z; continuing`,
    };
  }
  if (parsed.major !== 2) {
    return {
      kind: 'unsupported',
      message: `open-vs-code requires opencode v2 but the server reports ${parsed.version}`,
    };
  }
  if (parsed.version !== PINNED_OPENCODE_VERSION) {
    return {
      kind: 'warn',
      message: `the server reports opencode ${parsed.version}; this extension is built against ${PINNED_OPENCODE_VERSION}`,
    };
  }
  return { kind: 'ok', message: `opencode ${parsed.version}` };
}
