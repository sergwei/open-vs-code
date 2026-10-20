// State machine that decides WHEN to start and stop the opencode server (issue #8). Pure: no
// `vscode` import and no real process work, both injected through `ServerManagerDeps`, so
// Vitest drives it with fakes. The process mechanics live in `opencodeServer.ts` and the VS Code
// wiring in `serverLifecycle.ts`. Issue #9 (SDK client + SSE) consumes `state` and
// `onDidChangeState`; issue #10 will add restart and multi-root.

import { describeDetection, type DetectionResult } from './opencodeBinary';
import {
  checkServerVersion,
  safeLog,
  ServerStartError,
  type RunningServer,
  type ServerInfo,
  type ServerLog,
  type StartServerOptions,
} from './opencodeServer';

/** What a consumer (issue #9) needs to talk to a running server. */
export interface RunningServerInfo {
  url: string;
  password: string;
  version: string;
  folder: string;
  binaryPath: string;
  pid: number | undefined;
}

/**
 * Why the server is not available. The first four match `ConnectionState` in `src/shared`
 * on purpose (issues #9/#14 map them); `exited` is new: the server died while running.
 */
export type UnavailableReason =
  'no-workspace' | 'binary-missing' | 'unsupported-version' | 'start-failed' | 'exited';

/** Lifecycle of the single server. `stopped` is final. */
export type ServerState =
  | { kind: 'idle' }
  | { kind: 'starting'; folder: string; binaryPath: string }
  | { kind: 'running'; server: RunningServerInfo }
  | { kind: 'unavailable'; reason: UnavailableReason; message: string }
  | { kind: 'stopping' }
  | { kind: 'stopped' };

/** Outcome of choosing the workspace folder to serve. */
export type FolderChoice =
  { folder: string; ignored: string[] } | { reason: 'no-workspace'; message: string };

/** External effects of the manager, injected so tests need no processes, network or `vscode`. */
export interface ServerManagerDeps {
  start(options: StartServerOptions): Promise<RunningServer>;
  stop(server: RunningServer): Promise<unknown>;
  /** `signal` is the start attempt's: aborted by `stop()` so an in-flight request ends at once. */
  fetchInfo(url: string, password: string, signal: AbortSignal): Promise<ServerInfo>;
  log: ServerLog;
}

/**
 * Picks the folder to serve: the first one, which must be on disk (`file` scheme).
 *
 * Virtual workspaces (`vscode-vfs`, ...) have no directory to use as `cwd`, so they count as no
 * workspace. Extra folders are returned in `ignored` for the log: multi-root support is issue
 * #10. Accepts the structural shape of `vscode.WorkspaceFolder` so it needs no `vscode` import.
 * VERIFIED by unit tests with literal objects (synthetic).
 */
export function pickWorkspaceFolder(
  folders: readonly { uri: { scheme: string; fsPath: string }; name: string }[] | undefined,
): FolderChoice {
  const first = folders?.[0];
  if (folders === undefined || first === undefined) {
    return { reason: 'no-workspace', message: 'no workspace folder is open' };
  }
  if (first.uri.scheme !== 'file') {
    return {
      reason: 'no-workspace',
      message: `the workspace folder "${first.name}" is not on disk (scheme ${first.uri.scheme})`,
    };
  }
  return { folder: first.uri.fsPath, ignored: folders.slice(1).map((f) => f.uri.fsPath) };
}

/**
 * Describes a state for the log: level and text. Texts are built here, in English, so tests can
 * pin them (same idea as `describeDetection`). The ready line carries url, version and pid and
 * never the password. VERIFIED by unit tests; how it reads in the OpenCode channel is UNVERIFIED
 * until Sergio runs F5.
 */
export function describeServerState(state: ServerState): {
  level: 'info' | 'warn' | 'error';
  message: string;
} {
  switch (state.kind) {
    case 'idle':
      return { level: 'info', message: 'server idle' };
    case 'starting':
      return {
        level: 'info',
        message: `starting the server for ${state.folder} with ${state.binaryPath}`,
      };
    case 'running': {
      const s = state.server;
      return {
        level: 'info',
        message: `server ready at ${s.url} (opencode ${s.version}, pid ${String(s.pid)})`,
      };
    }
    case 'unavailable': {
      const level =
        state.reason === 'start-failed' || state.reason === 'exited'
          ? 'error'
          : state.reason === 'no-workspace'
            ? 'info'
            : 'warn';
      return { level, message: `server not available (${state.reason}): ${state.message}` };
    }
    case 'stopping':
      return { level: 'info', message: 'stopping the server' };
    case 'stopped':
      return { level: 'info', message: 'server stopped' };
  }
}

/**
 * Text for an error notification when the server fails after we tried to run it, else
 * `undefined`. Only a transition from `starting` or `running` into start-failed, exited or
 * unsupported-version notifies: detection problems and a missing workspace were already
 * reported (issue #7) or are not an error. VERIFIED by unit tests.
 */
export function describeServerFailure(
  previous: ServerState,
  next: ServerState,
): string | undefined {
  if (next.kind !== 'unavailable') return undefined;
  if (previous.kind !== 'starting' && previous.kind !== 'running') return undefined;
  if (
    next.reason !== 'start-failed' &&
    next.reason !== 'exited' &&
    next.reason !== 'unsupported-version'
  ) {
    return undefined;
  }
  return next.message;
}

/**
 * Owns the one server of this window and reacts to binary detections.
 *
 * Rules: a usable detection (`ok`/`unknown-version`) starts the server when idle or unavailable,
 * so fixing the setting from the issue #7 notification brings it up without reloading; with a
 * server already running a different path is only logged (restart is issue #10); a detection
 * that arrives during `starting` is remembered and retried once if the attempt fails. If the
 * server prints port 0 it is relaunched once without `--port` (plan B, Engram 841). `stop()` is
 * idempotent and final: afterwards no detection starts anything. An unexpected child exit while
 * running becomes `unavailable/exited`; restarting is issue #10.
 * The injected log is wrapped with `safeLog`, so a log that throws (a closed channel) can never
 * interrupt a transition or the stop. VERIFIED with fake dependencies (unit tests) and, for the
 * process side, against the synthetic fixture. The process functions it is wired to were
 * VERIFIED against the real opencode 2.0.32 on Windows 11 (npm @opencode/cli, spike on
 * 2026-10-20: start, `/api/info`, version check and stop end to end, `--port 0` giving the real
 * port so plan B did not trigger). UNVERIFIED inside VS Code until the opt-in
 * `realOpencode.test.ts` or F5 is run; POSIX UNVERIFIED.
 */
export class ServerManager {
  private current: ServerState = { kind: 'idle' };
  private readonly listeners = new Set<(state: ServerState) => void>();
  private folderChoice: FolderChoice | undefined;
  private running: RunningServer | undefined;
  private abort: AbortController | undefined;
  private launching: Promise<void> | undefined;
  private pendingPath: string | undefined;
  private stopPromise: Promise<void> | undefined;
  private disposed = false;
  private readonly deps: ServerManagerDeps;

  constructor(deps: ServerManagerDeps) {
    this.deps = { ...deps, log: safeLog(deps.log) };
  }

  /** Current state, for consumers that read instead of subscribing. */
  get state(): ServerState {
    return this.current;
  }

  /**
   * Subscribes to every state change (also repeats of the same kind). Returns a handle whose
   * `dispose` unsubscribes; a throwing listener is logged and does not affect the others.
   */
  onDidChangeState(listener: (state: ServerState) => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  /**
   * Sets the folder to serve. Call it before the first detection. A `no-workspace` choice moves
   * to `unavailable/no-workspace` right away and nothing will be launched; extra folders are
   * logged as ignored until issue #10.
   */
  setFolder(choice: FolderChoice): void {
    this.folderChoice = choice;
    if ('reason' in choice) {
      this.setState({ kind: 'unavailable', reason: 'no-workspace', message: choice.message });
      return;
    }
    if (choice.ignored.length > 0) {
      this.deps.log.info(
        `multi-root workspace: serving the first folder only; ignoring ${choice.ignored.join(', ')} (issue #10)`,
      );
    }
  }

  /**
   * Reacts to a detection result from `registerBinaryDetection`. Never throws; failures end in
   * an `unavailable` state and the log.
   */
  onDetection(result: DetectionResult): void {
    if (this.disposed) return;
    const usable = result.kind === 'ok' || result.kind === 'unknown-version';
    const kind = this.current.kind;

    if (usable) {
      const binaryPath = result.binary.path;
      if (this.folderChoice === undefined || 'reason' in this.folderChoice) return;
      if (kind === 'idle' || kind === 'unavailable') {
        this.launching = this.launch(binaryPath, this.folderChoice.folder);
      } else if (kind === 'starting') {
        this.pendingPath = binaryPath;
      } else if (this.current.kind === 'running' && binaryPath !== this.current.server.binaryPath) {
        this.deps.log.info('binary changed; restart the server to use it (issue #10)');
      }
      return;
    }

    if (kind === 'idle' || kind === 'unavailable') {
      if (this.folderChoice !== undefined && 'reason' in this.folderChoice) return;
      this.setState({
        kind: 'unavailable',
        reason: result.kind === 'unsupported' ? 'unsupported-version' : 'binary-missing',
        message: describeDetection(result).message,
      });
    } else if (kind === 'running') {
      this.deps.log.warn(
        'binary detection no longer finds a usable binary; leaving the server running',
      );
    }
  }

  /**
   * Stops the server and makes the manager inert. Idempotent: every call returns the same
   * Promise. Aborts a start in progress and waits for it to settle (it kills its own child),
   * asks the injected `stop` to end a running one, and always resolves, ending in `stopped`.
   * The abort also cancels an in-flight `/api/info` request, so the wait is bounded by the
   * process stop (about 3 s with the defaults of `stopServer`), not by the request timeout.
   */
  stop(): Promise<void> {
    this.stopPromise ??= this.doStop();
    return this.stopPromise;
  }

  /**
   * The body of {@link stop}, run once. Order matters: mark disposed first (so a detection that
   * arrives now starts nothing and a late start is stopped by its own attempt), then abort the
   * attempt in progress, then stop the running server, then wait for the attempt to clean up
   * its own child. It publishes `stopping` before the first await and `stopped` at the end;
   * `stopQuietly` and the guarded log guarantee that nothing in between can make it reject,
   * which is why the state always reaches `stopped`. VERIFIED by unit tests with fakes and, with
   * real processes, by the test where the log throws during `stop()`.
   */
  private async doStop(): Promise<void> {
    this.disposed = true;
    this.abort?.abort();
    const running = this.running;
    this.running = undefined;
    this.setState({ kind: 'stopping' });
    if (running !== undefined) await this.stopQuietly(running);
    await this.launching?.catch(() => undefined);
    this.setState({ kind: 'stopped' });
  }

  /** Runs one start attempt (plan B, version check, exit watch) and, on failure, the pending retry. */
  private async launch(binaryPath: string, folder: string): Promise<void> {
    const controller = new AbortController();
    this.abort = controller;
    this.pendingPath = undefined;
    this.setState({ kind: 'starting', folder, binaryPath });
    let started: RunningServer | undefined;
    try {
      started = await this.startWithPlanB(binaryPath, folder, controller.signal);
      if (this.disposed) return await this.stopQuietly(started);
      const info = await this.deps.fetchInfo(started.url, started.password, controller.signal);
      if (this.disposed) return await this.stopQuietly(started);
      const check = checkServerVersion(info.version);
      if (check.kind === 'unsupported') {
        await this.stopQuietly(started);
        this.deps.log.error(check.message);
        this.setState({
          kind: 'unavailable',
          reason: 'unsupported-version',
          message: check.message,
        });
      } else {
        if (check.kind === 'warn') this.deps.log.warn(check.message);
        const server = started;
        this.running = server;
        this.setState({
          kind: 'running',
          server: {
            url: server.url,
            password: server.password,
            version: info.version,
            folder,
            binaryPath,
            pid: server.child.pid,
          },
        });
        server.child.once('exit', (code, signal) => {
          this.onChildExit(server, code, signal);
        });
        // The child may have exited while we awaited `/api/info`, before the listener existed.
        if (server.child.exitCode !== null || server.child.signalCode !== null) {
          this.onChildExit(server, server.child.exitCode, server.child.signalCode);
        }
      }
    } catch (error) {
      if (started !== undefined) await this.stopQuietly(started);
      if (!this.disposed) {
        const detail = error instanceof Error ? error.message : String(error);
        this.setState({
          kind: 'unavailable',
          reason: 'start-failed',
          message: `Could not start the opencode server: ${detail}`,
        });
      }
    } finally {
      this.abort = undefined;
    }
    const retry = this.takePending();
    if (
      !this.disposed &&
      this.current.kind === 'running' &&
      retry !== undefined &&
      retry !== binaryPath
    ) {
      this.deps.log.info('binary changed; restart the server to use it (issue #10)');
    }
    if (
      !this.disposed &&
      this.current.kind === 'unavailable' &&
      retry !== undefined &&
      retry !== binaryPath
    ) {
      this.deps.log.info(`retrying with the binary detected meanwhile: ${retry}`);
      await this.launch(retry, folder);
    }
  }

  /** Returns and clears the binary path detected while a start was in progress. */
  private takePending(): string | undefined {
    const path = this.pendingPath;
    this.pendingPath = undefined;
    return path;
  }

  /** Starts with `--port 0`; if the server prints port 0, relaunches once without `--port`. */
  private async startWithPlanB(
    binaryPath: string,
    folder: string,
    signal: AbortSignal,
  ): Promise<RunningServer> {
    const base = { command: binaryPath, folder, log: this.deps.log, signal };
    try {
      return await this.deps.start({ ...base, port: 0 });
    } catch (error) {
      if (!(error instanceof ServerStartError) || error.code !== 'port-zero') throw error;
      this.deps.log.warn('the server printed port 0; relaunching once without --port (plan B)');
      return await this.deps.start({ ...base, port: undefined });
    }
  }

  /** Reacts to the child exiting; ignored when we caused it (stop) or it is no longer current. */
  private onChildExit(
    server: RunningServer,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.disposed || this.running !== server) return;
    this.running = undefined;
    const message = `The opencode server exited unexpectedly (code ${String(code)}, signal ${String(signal)})`;
    this.setState({ kind: 'unavailable', reason: 'exited', message });
  }

  /** Calls the injected `stop` and logs instead of throwing: shutdown must always finish. */
  private async stopQuietly(server: RunningServer): Promise<void> {
    try {
      await this.deps.stop(server);
    } catch (error) {
      this.deps.log.error(
        `stopping the server failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Publishes `next` as the current state and notifies every listener.
   *
   * Each listener runs in its own try/catch so one that throws affects neither the others nor
   * the transition, and the error report itself goes through the guarded log, which cannot
   * throw: `setState` is called from `doStop`, which must never reject. Repeats of the same
   * kind are notified too. VERIFIED by the unit tests on listeners and on the throwing log.
   */
  private setState(next: ServerState): void {
    this.current = next;
    for (const listener of [...this.listeners]) {
      try {
        listener(next);
      } catch (error) {
        this.deps.log.error(
          `a server state listener threw: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
