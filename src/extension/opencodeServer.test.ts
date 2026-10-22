// Tests for `opencodeServer.ts` (issue #8).
//
// What they protect: the spawn contract (exact args, cwd, env without the legacy password and
// with our own), the readiness-line parsing, and above all that NO failure path leaves an orphan
// process (CLAUDE.md architecture rule 3): timeout, early exit, abort, port 0, a server that
// ignores stdin, and a grandchild that must die with the tree.
//
// ALL the process tests run against `test-fixtures/fake-opencode.mjs` through `node`, a
// SYNTHETIC stand-in written from what was read in opencode v2.0.32. They prove our logic, not
// that a real opencode behaves like that: starting and stopping a real opencode is UNVERIFIED.
// The Windows tree kill (`taskkill /T /F`) really runs here on Windows; its POSIX twin
// (`kill(-pgid)`) is skipped on Windows by design and only a Linux/macOS run exercises it.

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  basicAuthHeader,
  buildServeEnv,
  checkServerVersion,
  fetchServerInfo,
  ServerInfoError,
  parseUrlLine,
  safeLog,
  serveArgs,
  ServerStartError,
  startServer,
  stopServer,
  type RunningServer,
  type ServerLog,
} from './opencodeServer';

const FIXTURE = fileURLToPath(new URL('./test-fixtures/fake-opencode.mjs', import.meta.url));

/** Captures every log line (all levels) so tests can read what the server wrote to stderr. */
function captureLog(): { log: ServerLog; lines: string[] } {
  const lines: string[] = [];
  const push = (message: string): void => {
    lines.push(message);
  };
  return { log: { info: push, warn: push, error: push, debug: push }, lines };
}

/** True while a process with this pid exists (`EPERM` still means it exists). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Polls `read` until it returns a value, or fails after `timeoutMs`. */
async function waitFor<T>(read: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Waits until `pid` is gone (up to 3 s) and returns whether it is. */
async function waitDead(pid: number): Promise<boolean> {
  const deadline = Date.now() + 3000;
  while (isAlive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

/**
 * Extracts the pid from the `spawned pid N` line `startServer` logs right after the spawn.
 *
 * Unlike the fixture's own `argv` line, it exists even when the child is killed before it runs
 * a single instruction, so tests that abort early can still prove the process is gone. Returns
 * `undefined` when nothing was spawned. Synthetic: parses our own log, not a real server.
 */
function spawnedPid(lines: string[]): number | undefined {
  for (const line of lines) {
    const match = /^spawned pid (\d+)$/.exec(line);
    if (match?.[1] !== undefined) return Number(match[1]);
  }
  return undefined;
}

/** Finds the JSON line `{ fake: kind, ... }` the fixture wrote to stderr, as logged. */
function fakeLine(lines: string[], kind: string): Record<string, unknown> | undefined {
  for (const line of lines) {
    const start = line.indexOf('{"fake":"' + kind + '"');
    if (start >= 0) return JSON.parse(line.slice(start)) as Record<string, unknown>;
  }
  return undefined;
}

describe('pure helpers', () => {
  it('buildServeEnv sets our password, drops the legacy one and does not mutate the input', () => {
    const input = { KEEP: 'x', OPENCODE_PASSWORD: 'user', OPENCODE_SERVER_PASSWORD: 'legacy' };
    const env = buildServeEnv(input, 'ours', 'linux');
    expect(env['OPENCODE_PASSWORD']).toBe('ours');
    expect('OPENCODE_SERVER_PASSWORD' in env).toBe(false);
    expect(env['KEEP']).toBe('x');
    expect(input.OPENCODE_SERVER_PASSWORD).toBe('legacy');
  });

  it('buildServeEnv removes every spelling of both names on win32 only', () => {
    const input = { opencode_password: 'a', Opencode_Server_Password: 'b', Other: 'c' };
    const win = buildServeEnv(input, 'ours', 'win32');
    expect(Object.keys(win).sort()).toEqual(['OPENCODE_PASSWORD', 'Other']);
    const linux = buildServeEnv(input, 'ours', 'linux');
    expect(linux['opencode_password']).toBe('a');
    expect(linux['Opencode_Server_Password']).toBe('b');
  });

  it('serveArgs includes --port 0 or omits --port', () => {
    expect(serveArgs(0)).toEqual(['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0']);
    expect(serveArgs(undefined)).toEqual(['serve', '--stdio', '--hostname', '127.0.0.1']);
  });

  it('parseUrlLine accepts the readiness line, with or without CRLF', () => {
    expect(parseUrlLine('{"url":"http://127.0.0.1:4321"}')).toEqual({
      url: 'http://127.0.0.1:4321',
    });
    expect(parseUrlLine('{"url":"http://127.0.0.1:4321"}\r')).toEqual({
      url: 'http://127.0.0.1:4321',
    });
    expect(parseUrlLine('{"url":"http://[::1]:4321"}')).toEqual({ url: 'http://[::1]:4321' });
  });

  it('parseUrlLine refuses localhost: we launch with 127.0.0.1, a resolved name adds nothing', () => {
    expect(parseUrlLine('{"url":"http://localhost:4321"}')).toMatchObject({ error: 'bad-url' });
  });

  it('safeLog swallows a log that throws on every level and still forwards when it works', () => {
    const seen: string[] = [];
    let broken = false;
    const make =
      (level: string) =>
      (message: string): void => {
        if (broken) throw new Error('Channel has been closed');
        seen.push(`${level}:${message}`);
      };
    const guarded = safeLog({
      info: make('info'),
      warn: make('warn'),
      error: make('error'),
      debug: make('debug'),
    });
    guarded.info('a');
    expect(seen).toEqual(['info:a']);
    broken = true;
    expect(() => {
      guarded.info('b');
      guarded.warn('b');
      guarded.error('b');
      guarded.debug('b');
    }).not.toThrow();
    expect(seen).toEqual(['info:a']);
  });

  it('parseUrlLine skips lines that are not ours', () => {
    expect(parseUrlLine('server starting...')).toBeUndefined();
    expect(parseUrlLine('{"hello":"world"}')).toBeUndefined();
    expect(parseUrlLine('{"url":42}')).toBeUndefined();
    expect(parseUrlLine('42')).toBeUndefined();
  });

  it('parseUrlLine flags port 0 for plan B and refuses non-loopback, https and portless urls', () => {
    expect(parseUrlLine('{"url":"http://127.0.0.1:0"}')).toMatchObject({ error: 'port-zero' });
    expect(parseUrlLine('{"url":"http://example.com:80"}')).toMatchObject({ error: 'bad-url' });
    expect(parseUrlLine('{"url":"https://127.0.0.1:4321"}')).toMatchObject({ error: 'bad-url' });
    expect(parseUrlLine('{"url":"http://127.0.0.1"}')).toMatchObject({ error: 'bad-url' });
    expect(parseUrlLine('{"url":"not a url"}')).toMatchObject({ error: 'bad-url' });
  });

  it('basicAuthHeader encodes the fixed user opencode', () => {
    // base64("opencode:pw"), computed by hand
    expect(basicAuthHeader('pw')).toBe('Basic b3BlbmNvZGU6cHc=');
  });

  it('checkServerVersion: pin ok; other minor or unparseable warns; other major is unsupported', () => {
    expect(checkServerVersion('2.0.32').kind).toBe('ok');
    expect(checkServerVersion('2.0.40').kind).toBe('warn');
    expect(checkServerVersion('local').kind).toBe('warn');
    expect(checkServerVersion('1.19.3').kind).toBe('unsupported');
    expect(checkServerVersion('3.0.0').kind).toBe('unsupported');
  });

  it('fetchServerInfo rejects a body without version, a bad status and a network failure', async () => {
    const reply =
      (body: unknown, status = 200): typeof fetch =>
      () =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
    await expect(fetchServerInfo('http://127.0.0.1:1', 'pw', reply({ pid: 1 }))).rejects.toThrow(
      /without a version/,
    );
    await expect(fetchServerInfo('http://127.0.0.1:1', 'pw', reply({}, 401))).rejects.toThrow(
      /401/,
    );
    const down: typeof fetch = () => Promise.reject(new Error('connect ECONNREFUSED'));
    await expect(fetchServerInfo('http://127.0.0.1:1', 'pw', down)).rejects.toThrow(/ECONNREFUSED/);
    await expect(
      fetchServerInfo('http://127.0.0.1:1', 'pw', reply({ version: '2.0.32', pid: 7 })),
    ).resolves.toEqual({ version: '2.0.32', pid: 7 });
  });

  // Issue #11: the external-server mode needs to tell a wrong password from "not opencode" from
  // "nobody there". Synthetic responses; the messages are the ones the spawn mode always logged.
  it('fetchServerInfo throws a ServerInfoError whose kind tells the failures apart', async () => {
    const reply =
      (body: unknown, status = 200): typeof fetch =>
      () =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
    const kindOf = async (fetchImpl: typeof fetch): Promise<unknown> => {
      const error = await fetchServerInfo('http://127.0.0.1:1', 'pw', fetchImpl).catch(
        (e: unknown) => e,
      );
      return error instanceof ServerInfoError
        ? { kind: error.kind, status: error.status, message: error.message }
        : error;
    };
    await expect(kindOf(reply({}, 401))).resolves.toEqual({
      kind: 'unauthorized',
      status: 401,
      message: 'GET /api/info failed: HTTP 401',
    });
    await expect(kindOf(reply({}, 404))).resolves.toMatchObject({
      kind: 'http-status',
      status: 404,
    });
    await expect(kindOf(reply({}, 500))).resolves.toMatchObject({
      kind: 'http-status',
      status: 500,
    });
    await expect(kindOf(reply({ pid: 1 }))).resolves.toMatchObject({ kind: 'malformed' });
    await expect(kindOf(reply({ version: 3 }))).resolves.toMatchObject({ kind: 'malformed' });
    const notJson: typeof fetch = () => Promise.resolve(new Response('<html>', { status: 200 }));
    await expect(kindOf(notJson)).resolves.toMatchObject({
      kind: 'malformed',
      message: 'GET /api/info returned a body that is not JSON',
    });
    const cause = new Error('connect ECONNREFUSED');
    const down: typeof fetch = () => Promise.reject(cause);
    const error = await fetchServerInfo('http://127.0.0.1:1', 'pw', down).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerInfoError);
    expect(error).toMatchObject({ kind: 'transport', cause });
  });

  it('fetchServerInfo ends as soon as the caller aborts, long before its own timeout', async () => {
    // Synthetic fetch that never answers and only reacts to the signal it receives. Protects the
    // review fix: `stop()` aborts the attempt, and the request must not wait out INFO_TIMEOUT_MS.
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted by signal'));
        });
      });
    const controller = new AbortController();
    const started = Date.now();
    const pending = fetchServerInfo('http://127.0.0.1:1', 'pw', hanging, 60_000, controller.signal);
    setTimeout(() => {
      controller.abort();
    }, 50);
    await expect(pending).rejects.toThrow(/aborted by signal/);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('against the synthetic fixture (real processes)', () => {
  const servers: RunningServer[] = [];
  const folders: string[] = [];

  afterEach(async () => {
    const quiet = captureLog().log;
    await Promise.all(servers.splice(0).map((s) => stopServer(s.child, quiet, { graceMs: 300 })));
    await Promise.all(folders.splice(0).map((f) => rm(f, { recursive: true, force: true })));
  });

  /** Creates a temp folder (removed afterwards) and starts the fixture in it. */
  async function launch(
    mode: string,
    extra: Partial<Parameters<typeof startServer>[0]> = {},
    baseEnv: NodeJS.ProcessEnv = {},
  ): Promise<{ server: RunningServer; folder: string; lines: string[] }> {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'ovsc-serve-'));
    folders.push(folder);
    const { log, lines } = captureLog();
    const server = await startServer({
      command: process.execPath,
      prefixArgs: [FIXTURE],
      folder,
      port: 0,
      log,
      baseEnv: { ...process.env, ...baseEnv, FAKE_OPENCODE_MODE: mode },
      ...extra,
    });
    servers.push(server);
    return { server, folder, lines };
  }

  /** Like {@link launch} but expects a failure and returns the error plus the log. */
  async function launchFailing(
    mode: string,
    extra: Partial<Parameters<typeof startServer>[0]> = {},
  ): Promise<{ error: ServerStartError; lines: string[] }> {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'ovsc-serve-'));
    folders.push(folder);
    const { log, lines } = captureLog();
    try {
      await startServer({
        command: process.execPath,
        prefixArgs: [FIXTURE],
        folder,
        port: 0,
        log,
        baseEnv: { ...process.env, FAKE_OPENCODE_MODE: mode },
        ...extra,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ServerStartError);
      return { error: error as ServerStartError, lines };
    }
    throw new Error('startServer was expected to fail');
  }

  it('happy path: exact args, cwd, our password only, /api/info, stop by stdin', async () => {
    const { server, folder, lines } = await launch(
      'ok',
      {},
      {
        OPENCODE_SERVER_PASSWORD: 'legacy',
        OPENCODE_PASSWORD: 'user-defined',
      },
    );
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*$/);

    const argv = await waitFor(() => fakeLine(lines, 'argv'));
    expect(argv['argv']).toEqual(['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0']);
    expect(argv['hasPassword']).toBe(true);
    expect(argv['hasLegacy']).toBe(false);
    const norm = async (p: string): Promise<string> => {
      const real = await realpath(p);
      return process.platform === 'win32' ? real.toLowerCase() : real;
    };
    expect(await norm(argv['cwd'] as string)).toBe(await norm(folder));

    // The fixture answers 401 unless the password is the one WE generated, so this also proves
    // that the user-defined OPENCODE_PASSWORD was overridden.
    const info = await fetchServerInfo(server.url, server.password);
    expect(info.version).toBe('2.0.32');
    expect(checkServerVersion(info.version).kind).toBe('ok');

    const { log } = captureLog();
    const stop = await stopServer(server.child, log);
    expect(stop.how).toBe('stdin');
    expect(server.child.exitCode).toBe(0);
  }, 15_000);

  it('ignores non-JSON noise before the url line', async () => {
    const { server } = await launch('noise');
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  }, 15_000);

  it('plan B: without --port the fixture prints a real port', async () => {
    const { server, lines } = await launch('port-zero', { port: undefined });
    expect(server.url).toMatch(/:[1-9]\d*$/);
    const argv = await waitFor(() => fakeLine(lines, 'argv'));
    expect(argv['argv']).toEqual(['serve', '--stdio', '--hostname', '127.0.0.1']);
  }, 15_000);

  it('timeout: rejects and kills both the child and its grandchild', async () => {
    const { error, lines } = await launchFailing('silent,grandchild', { startupTimeoutMs: 700 });
    expect(error.code).toBe('timeout');
    const argv = await waitFor(() => fakeLine(lines, 'argv'));
    const grandchild = await waitFor(() => fakeLine(lines, 'grandchild'));
    expect(await waitDead(argv['pid'] as number)).toBe(true);
    expect(await waitDead(grandchild['pid'] as number)).toBe(true);
  }, 15_000);

  it('exit before the url: rejects fast with "exited" and the stderr text, not after the timeout', async () => {
    const started = Date.now();
    const { error, lines } = await launchFailing('exit-early', { startupTimeoutMs: 10_000 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(error.code).toBe('exited');
    expect(error.message).toContain('boom');
    expect(lines.some((line) => line.includes('boom'))).toBe(true);
  }, 15_000);

  it('a missing binary rejects with spawn-failed naming it, without an unhandled rejection', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'ovsc-serve-'));
    folders.push(folder);
    const command = path.join(folder, 'no-such-opencode');
    const failure = await startServer({ command, folder, port: 0, log: captureLog().log }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ServerStartError);
    expect((failure as ServerStartError).code).toBe('spawn-failed');
    expect((failure as ServerStartError).message).toContain('no-such-opencode');
    // Let a late 'error'/'exit' event surface; Vitest fails the run on unhandled rejections.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }, 15_000);

  it('a missing folder rejects with folder-missing and launches nothing', async () => {
    const { log, lines } = captureLog();
    const folder = path.join(os.tmpdir(), 'ovsc-serve-does-not-exist-' + String(Date.now()));
    await expect(
      startServer({
        command: process.execPath,
        prefixArgs: [FIXTURE],
        folder,
        port: 0,
        log,
      }),
    ).rejects.toMatchObject({ code: 'folder-missing' });
    expect(lines.some((line) => line.startsWith('launching'))).toBe(false);
  });

  it('an aborted signal during startup rejects with "aborted" and the child dies', async () => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 500);
    const { error, lines } = await launchFailing('silent', {
      signal: controller.signal,
      startupTimeoutMs: 10_000,
    });
    expect(error.code).toBe('aborted');
    const pid = spawnedPid(lines);
    expect(pid).toBeDefined();
    expect(await waitDead(pid as number)).toBe(true);
  }, 15_000);

  it('an abort that lands after the listener check is not lost (aborted flips during the folder stat)', async () => {
    // SYNTHETIC simulation of the race: a real signal whose `aborted` reads false on the first
    // read (the early guard) and true afterwards, while no `abort` event is ever dispatched,
    // exactly what a listener added after the abort would see. Without the
    // re-check after `addEventListener` this waits for the 10 s startup timeout.
    const controller = new AbortController();
    let reads = 0;
    Object.defineProperty(controller.signal, 'aborted', {
      get: () => ++reads > 1,
    });
    const started = Date.now();
    const { error, lines } = await launchFailing('silent', {
      signal: controller.signal,
      startupTimeoutMs: 10_000,
    });
    expect(error.code).toBe('aborted');
    expect(Date.now() - started).toBeLessThan(5000);
    // The second read of `aborted` happens after the spawn, and the kill that follows can land
    // before the fixture prints its `argv` line (it did on every CI runner), so the pid comes
    // from our own log, not from the child. If nothing was spawned, nothing can be alive.
    const pid = spawnedPid(lines);
    if (pid === undefined) {
      expect(lines.some((line) => line.startsWith('launching'))).toBe(false);
    } else {
      expect(await waitDead(pid)).toBe(true);
    }
  }, 15_000);

  it('exit while a grandchild holds stdout open still rejects fast with "exited"', async () => {
    // Protects the `exit` event in the start race: `close` of stdout never comes here because the
    // grandchild inherited the pipe. Fixture is synthetic. The grandchild is not ours to leave
    // running, so the test ends it (startServer does not signal the leftovers of a child that
    // already exited, by decision of 2026-10-19, Engram 845).
    const started = Date.now();
    const { error, lines } = await launchFailing('hold-stdout', { startupTimeoutMs: 10_000 });
    const holder = await waitFor(() => fakeLine(lines, 'grandchild'));
    try {
      expect(error.code).toBe('exited');
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      try {
        process.kill(holder['pid'] as number);
      } catch {
        // already gone
      }
    }
  }, 15_000);

  it('a url with port 0 rejects with port-zero and the child dies', async () => {
    const { error, lines } = await launchFailing('port-zero');
    expect(error.code).toBe('port-zero');
    const argv = await waitFor(() => fakeLine(lines, 'argv'));
    expect(await waitDead(argv['pid'] as number)).toBe(true);
  }, 15_000);

  it('/api/info answering 401 rejects with the status and without the password', async () => {
    const { server } = await launch('always-401');
    const failure = await fetchServerInfo(server.url, server.password).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain('401');
    expect(message).not.toContain(server.password);
  }, 15_000);

  // The real tree kill. On Windows this runs `taskkill /T /F`; on POSIX it would be the
  // `kill(-pgid)` branch, which only a Linux/macOS run can check.
  it('a server that ignores stdin is killed with its grandchild (taskkill /T on Windows)', async () => {
    const { server, lines } = await launch('ignore-stdin,grandchild');
    const grandchild = await waitFor(() => fakeLine(lines, 'grandchild'));
    const grandchildPid = grandchild['pid'] as number;
    const childPid = server.child.pid as number;
    expect(isAlive(childPid)).toBe(true);
    expect(isAlive(grandchildPid)).toBe(true);

    const { log } = captureLog();
    const stop = await stopServer(server.child, log, { graceMs: 300, killWaitMs: 3000 });
    expect(stop.how).toBe('killed');
    expect(await waitDead(childPid)).toBe(true);
    expect(await waitDead(grandchildPid)).toBe(true);
  }, 15_000);
});
