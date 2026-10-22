// State machine that decides WHEN to start, stop and restart the opencode server (issues #8, #10).
// Pure: no `vscode` import and no real process work, both injected through `ServerManagerDeps`,
// so Vitest drives it with fakes. The process mechanics live in `opencodeServer.ts` and the VS
// Code wiring in `serverLifecycle.ts`. Issue #9 (SDK client + SSE) consumes `state` and
// `onDidChangeState`.
//
// Phase 3 (issue #10) adds: `restart(reason)`, automatic restart after a crash with a backoff and
// a cap, restart when the binary or the served folder changes under a running server, the choice
// of the folder to serve in a multi-root window, and a stop that also cancels the backoff timer.
// The timer and the clock are injected (`schedule`, `now`) so the tests need no real waiting.
//
// Issue #11 adds a second kind of server: one that somebody else runs. The manager follows a
// `ServerTarget` (`spawn` = launch our own, the default; `external` = connect to a URL with a
// password; `external-invalid` = the setting is wrong). The external path never starts a process:
// it checks `GET /api/info` and goes to `running`, and an unreachable server stays
// `unavailable/unreachable` until the user retries (decision of Sergio, 2026-10-22, Engram
// `E1-external-server/decisions/no-auto-retry`).

import {
  describeExternalFailure,
  describeFailureCause,
  sameTarget,
  type ServerTarget,
} from './externalServer';
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

/**
 * Delays before each automatic restart after the server died: 1 s, 5 s, 15 s, then it gives up.
 * Our own choice (plan `E2-mvp-prototype/plan-fase3`), not taken from opencode: short enough that
 * a one-off crash is invisible, long enough not to spin a server that dies on boot (3 attempts in
 * about 21 s).
 */
export const AUTO_RESTART_DELAYS_MS: readonly number[] = [1000, 5000, 15000];

/**
 * A server that stays up this long is considered healthy again: the next crash starts the backoff
 * from the first delay. Our own choice (120 s), measured when the process exits.
 */
export const STABLE_RUN_MS = 120_000;

/**
 * What a consumer (issue #9) needs to talk to a running server. `source` says who owns the
 * process: `spawned` is ours (`binaryPath` is the executable, `pid` its pid) and `external` is
 * somebody else's (`binaryPath` is `undefined`, `pid` is the one `/api/info` reported). The
 * password stays in the host: it is never sent to the webview (architecture rule 1).
 */
export interface RunningServerInfo {
  url: string;
  password: string;
  version: string;
  folder: string;
  binaryPath: string | undefined;
  pid: number | undefined;
  source: 'spawned' | 'external';
}

/**
 * Why the server is not available. The first four match `ConnectionState` in `src/shared`
 * on purpose (issues #9/#14 map them); `exited` is new: the server died while running. Issue #11
 * adds the three of the external mode: `unreachable` (nobody answers), `unauthorized` (no password
 * stored, or the server rejected it) and `invalid-url` (the setting is not a usable address).
 */
export type UnavailableReason =
  | 'no-workspace'
  | 'binary-missing'
  | 'unsupported-version'
  | 'start-failed'
  | 'exited'
  | 'unreachable'
  | 'unauthorized'
  | 'invalid-url';

/** Why a restart happens; it ends up in the log line `restarting the server (<reason>)`. */
export type RestartReason =
  'command' | 'binary-changed' | 'folder-changed' | 'crash' | 'target-changed';

/**
 * Lifecycle of the single server. `stopped` is final. `restarting` covers the stop of the old
 * process and the wait for its start attempt to settle; the new attempt then goes through
 * `starting` (own process) or `connecting` (external server, issue #11). An `unavailable/exited`
 * with `retryInMs` is NOT final: a restart is scheduled (`attempt` is 1-based); without it the
 * manager gave up.
 */
export type ServerState =
  | { kind: 'idle' }
  | { kind: 'starting'; folder: string; binaryPath: string }
  | { kind: 'connecting'; folder: string; url: string }
  | { kind: 'running'; server: RunningServerInfo }
  | { kind: 'restarting'; reason: RestartReason }
  | {
      kind: 'unavailable';
      reason: UnavailableReason;
      message: string;
      retryInMs?: number;
      attempt?: number;
    }
  | { kind: 'stopping' }
  | { kind: 'stopped' };

/** Outcome of choosing the workspace folder to serve. */
export type FolderChoice =
  { folder: string; ignored: string[] } | { reason: 'no-workspace'; message: string };

/** How {@link ServerManager.restart} ended; only `attempted` means a new start was tried. */
export type RestartResult = 'attempted' | 'no-workspace' | 'no-binary' | 'disposed';

/** A timer that can be cancelled; what `ServerManagerDeps.schedule` returns. */
export interface ScheduledTimer {
  cancel(): void;
}

/** External effects of the manager, injected so tests need no processes, network or `vscode`. */
export interface ServerManagerDeps {
  start(options: StartServerOptions): Promise<RunningServer>;
  stop(server: RunningServer): Promise<unknown>;
  /** `signal` is the start attempt's: aborted by `stop()` so an in-flight request ends at once. */
  fetchInfo(url: string, password: string, signal: AbortSignal): Promise<ServerInfo>;
  log: ServerLog;
  /** Runs `fn` once after `ms`. Defaults to `setTimeout`; tests inject a manual scheduler. */
  schedule?: (ms: number, fn: () => void) => ScheduledTimer;
  /** Milliseconds clock. Defaults to `Date.now`; tests inject a manual one. */
  now?: () => number;
}

/** Default timer: a plain `setTimeout`. */
function defaultSchedule(ms: number, fn: () => void): ScheduledTimer {
  const handle = setTimeout(fn, ms);
  return {
    cancel: () => {
      clearTimeout(handle);
    },
  };
}

/** Minimal shape of a VS Code workspace folder, so this module needs no `vscode` import. */
export interface FolderLike {
  uri: { scheme: string; fsPath: string };
  name: string;
}

/**
 * Picks the folder to serve: the `preferred` one (an `fsPath`) if it is still open and on disk,
 * else the first folder on disk.
 *
 * Virtual workspaces (`vscode-vfs`, ...) have no directory to use as `cwd`, so they are skipped;
 * with none on disk there is no workspace. The other folders go to `ignored` for the log. The
 * server serves ONE folder (plan decision: a server per folder was too much for the MVP). Before
 * phase 3 only the first folder was considered, and a virtual first folder meant no workspace.
 * Accepts the structural shape of `vscode.WorkspaceFolder`. VERIFIED by unit tests with literal
 * objects (synthetic).
 */
export function pickWorkspaceFolder(
  folders: readonly FolderLike[] | undefined,
  preferred?: string,
): FolderChoice {
  const first = folders?.[0];
  if (folders === undefined || first === undefined) {
    return { reason: 'no-workspace', message: 'no workspace folder is open' };
  }
  const onDisk = folders.filter((folder) => folder.uri.scheme === 'file');
  const chosen =
    (preferred === undefined
      ? undefined
      : onDisk.find((folder) => folder.uri.fsPath === preferred)) ?? onDisk[0];
  if (chosen === undefined) {
    return {
      reason: 'no-workspace',
      message: `the workspace folder "${first.name}" is not on disk (scheme ${first.uri.scheme})`,
    };
  }
  return {
    folder: chosen.uri.fsPath,
    ignored: folders.filter((folder) => folder !== chosen).map((folder) => folder.uri.fsPath),
  };
}

/**
 * Describes a state for the log: level and text. Texts are built here, in English, so tests can
 * pin them (same idea as `describeDetection`). The ready line carries url, version and pid and
 * never the password. The restart lines are STABLE: the opt-in integration test waits for
 * `restarting the server (<reason>)` and `server exited unexpectedly; restarting in <s> s
 * (attempt <i> of 3)`. VERIFIED by unit tests; the lines in a real VS Code were seen by the
 * opt-in `realOpencode.test.ts` (see its header for the run).
 *
 * The external-server lines (issue #11) are `connecting to the external server at <url> for
 * <folder>` and `connected to the external server at <url> (opencode <v>)`. The second is NOT
 * `server ready at ...` on purpose: `realOpencode.test.ts` counts those lines with a regex to
 * know how many servers WE started. The log is the one place the URL may appear; the unit tests
 * pin both lines, and the integration suite `externalServer.test.ts` waits for them in a real VS
 * Code.
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
    case 'connecting':
      return {
        level: 'info',
        message: `connecting to the external server at ${state.url} for ${state.folder}`,
      };
    case 'running': {
      const s = state.server;
      if (s.source === 'external') {
        return {
          level: 'info',
          message: `connected to the external server at ${s.url} (opencode ${s.version})`,
        };
      }
      return {
        level: 'info',
        message: `server ready at ${s.url} (opencode ${s.version}, pid ${String(s.pid)})`,
      };
    }
    case 'restarting':
      return { level: 'info', message: `restarting the server (${state.reason})` };
    case 'unavailable': {
      if (state.retryInMs !== undefined) {
        return {
          level: 'warn',
          message: `server exited unexpectedly; restarting in ${String(state.retryInMs / 1000)} s (attempt ${String(state.attempt ?? 0)} of ${String(AUTO_RESTART_DELAYS_MS.length)})`,
        };
      }
      const level =
        state.reason === 'start-failed' ||
        state.reason === 'exited' ||
        state.reason === 'unreachable'
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
 * `undefined`. Only a transition from `starting`, `connecting` or `running` into start-failed,
 * exited or unsupported-version notifies: detection problems and a missing workspace were already
 * reported (issue #7) or are not an error. An `unavailable` that still has a restart scheduled
 * (`retryInMs`) is silent: only the moment the manager gives up is worth a notification (phase 3,
 * so a one-off crash that heals itself never pops up). The three reasons of the external mode
 * (`unreachable`, `unauthorized`, `invalid-url`; issue #11) notify whatever the previous state
 * was: they only come from a connection the user asked for (setting, password or Retry), a
 * wrong password can follow another one, and an invalid URL never goes through `connecting`.
 * VERIFIED by unit tests.
 */
export function describeServerFailure(
  previous: ServerState,
  next: ServerState,
): string | undefined {
  if (next.kind !== 'unavailable') return undefined;
  if (next.retryInMs !== undefined) return undefined;
  if (
    next.reason === 'unreachable' ||
    next.reason === 'unauthorized' ||
    next.reason === 'invalid-url'
  ) {
    return next.message;
  }
  if (
    previous.kind !== 'starting' &&
    previous.kind !== 'connecting' &&
    previous.kind !== 'running'
  ) {
    return undefined;
  }
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
 * Owns the one server of this window: reacts to binary detections, restarts it on request, after
 * a crash and when its binary or folder changes.
 *
 * Rules: a usable detection (`ok`/`unknown-version`) starts the server when idle or unavailable,
 * so fixing the setting from the issue #7 notification brings it up without reloading; with a
 * server already running, a different path restarts it (reason `binary-changed`; this cuts a turn
 * in flight, accepted: the detection only runs on activation and on a settings change, so it is
 * always a change the user made); a detection that arrives during `starting` is remembered, and
 * if that attempt ends running with another binary it restarts, if it fails the other binary is
 * tried once. If the server prints port 0 it is relaunched once without `--port` (plan B,
 * Engram 841).
 *
 * `restart(reason)` is serialized (a call during a restart returns the same Promise), aborts a
 * start in progress, stops the running server and launches again with the last usable binary and
 * the current folder. A child that exits on its own becomes `unavailable/exited` with `retryInMs`
 * and a timer; after {@link AUTO_RESTART_DELAYS_MS} attempts it gives up (no `retryInMs`). The
 * counter resets when the server lived {@link STABLE_RUN_MS} or when the user restarts it. A
 * restart that fails to START is not retried: that is configuration, not a crash.
 *
 * External target (issue #11, {@link setTarget}): the manager follows a `ServerTarget`. With an
 * `external` one it never launches a process: with a stored password it publishes `connecting` and asks
 * `GET /api/info` (no password = `unauthorized`, an unusable address = `invalid-url`, both
 * published directly, without `connecting` and without touching the network), then checks
 * the major version and goes `running` with `source: 'external'`. Binary detections are only
 * remembered (so going back to `spawn` can use them), `restart()` reconnects instead of
 * answering `no-binary`, and there is no child, hence no exit watch, no crash backoff and no kill.
 * A failure is `unreachable` / `unauthorized` / `unsupported-version` / `invalid-url` and stays
 * that way until the user retries or changes the setting or the password: NO automatic retry
 * (Sergio's decision). A server that goes away AFTER connecting is not noticed here: the event
 * stream of the chat shows "Reconnecting", and Restart Server (reconnect) re-checks it. The
 * messages that reach the webview carry no URL, port or raw cause (see `describeExternalFailure`).
 *
 * `stop()` is idempotent and final: afterwards no detection or timer starts anything; it also
 * cancels the backoff timer and waits for a restart in flight. The injected log is wrapped with
 * `safeLog`, so a log that throws (a closed channel) can never interrupt a transition or the stop.
 * VERIFIED with fake dependencies (unit tests, injected scheduler and clock) and, for the process
 * side, against the synthetic fixture. The process functions it is wired to were VERIFIED
 * against the real opencode 2.0.32 on Windows 11 (npm @opencode/cli, spike on 2026-10-20: start,
 * `/api/info`, version check and stop end to end, `--port 0` giving the real port). VERIFIED
 * inside VS Code 1.142.0 on Windows 11 (opt-in `realOpencode.test.ts`, 2026-10-20, two runs): a
 * `restart('command')` gave a new pid, the stream reconnected and the old pid was gone
 * (`kill(pid, 0)` threw `ESRCH`), and a server killed from outside was restarted after the first
 * 1 s backoff. NOT exercised against a real server: the 5 s and 15 s steps, the give-up, the
 * binary change and the folder change (unit tests with fakes only); POSIX UNVERIFIED. The
 * external target is VERIFIED with fakes (unit tests) and, in a real VS Code against the
 * synthetic fixture, by `externalServer.test.ts`; see the external case of `realOpencode.test.ts`
 * for the real opencode.
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
  /** The last binary a detection accepted; the restart launches this one. */
  private lastUsablePath: string | undefined;
  private restartPromise: Promise<RestartResult> | undefined;
  /** What the manager follows: its own server (default) or an external one. See {@link setTarget}. */
  private target: ServerTarget = { kind: 'spawn' };
  /**
   * Target, binary (spawn only) and folder the restart in flight launched with; compared after it
   * to catch a change that arrived meanwhile.
   */
  private lastLaunch:
    { target: ServerTarget; binaryPath: string | undefined; folder: string } | undefined;
  private retryTimer: ScheduledTimer | undefined;
  /** Automatic restarts used since the server last proved stable (or the user restarted it). */
  private crashAttempts = 0;
  /** `now()` when the current server reached `running`, to tell a stable run from a boot loop. */
  private runningSince: number | undefined;
  private readonly deps: ServerManagerDeps;
  private readonly schedule: (ms: number, fn: () => void) => ScheduledTimer;
  private readonly now: () => number;

  constructor(deps: ServerManagerDeps) {
    this.deps = { ...deps, log: safeLog(deps.log) };
    this.schedule = deps.schedule ?? defaultSchedule;
    this.now = deps.now ?? Date.now;
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
   * Sets the folder to serve and logs `serving folder <path>`. Call it before the first
   * detection, and again whenever the choice changes (a folder removed or picked by the user).
   * A `no-workspace` choice stops whatever runs and moves to `unavailable/no-workspace`; a
   * different folder than before restarts the server (reason `folder-changed`) once a binary is
   * known (or an external target is set), and the first call, made before any detection, just
   * records it. Extra folders are logged as not served.
   */
  setFolder(choice: FolderChoice): void {
    const previous = this.folderChoice;
    this.folderChoice = choice;
    const kind = this.current.kind;
    if ('reason' in choice) {
      if (
        kind === 'running' ||
        kind === 'starting' ||
        kind === 'connecting' ||
        kind === 'restarting'
      ) {
        void this.restart('folder-changed');
      } else {
        this.cancelRetryTimer();
        this.setState({ kind: 'unavailable', reason: 'no-workspace', message: choice.message });
      }
      return;
    }
    this.deps.log.info(`serving folder ${choice.folder}`);
    if (choice.ignored.length > 0) {
      this.deps.log.info(`other workspace folders are not served: ${choice.ignored.join(', ')}`);
    }
    const unchanged =
      previous !== undefined && !('reason' in previous) && previous.folder === choice.folder;
    const canLaunch = this.lastUsablePath !== undefined || this.target.kind !== 'spawn';
    if (!unchanged && canLaunch && !this.disposed) {
      void this.restart('folder-changed');
    }
  }

  /**
   * Chooses what the manager follows: launch its own server (`spawn`, the default) or connect to
   * an external one (issue #11). Idempotent: an equal target (same URL AND password) does nothing.
   *
   * A change restarts with reason `target-changed`, which stops whatever was running (a child we
   * spawned is stopped, a connection in flight is aborted) and then connects or launches as the
   * new target says. Two shortcuts: before anything was ever started (state `idle`) an external
   * target connects at once without the `restarting` step, and a `spawn` target does nothing,
   * since the binary detection launches it; and with no folder chosen yet only the target is
   * recorded, because `setFolder` starts the connection when a folder arrives. Call it from the
   * lifecycle whenever the setting or the password changes. VERIFIED with fakes (unit tests).
   */
  setTarget(target: ServerTarget): void {
    if (this.disposed || sameTarget(this.target, target)) return;
    this.target = target;
    const choice = this.folderChoice;
    if (choice === undefined || 'reason' in choice) return;
    if (this.current.kind === 'idle') {
      if (target.kind !== 'spawn') this.launching = this.connect(target, choice.folder);
      return;
    }
    void this.restart('target-changed');
  }

  /**
   * Reacts to a detection result from `registerBinaryDetection`. Never throws; failures end in
   * an `unavailable` state and the log. A usable result is remembered as the binary the next
   * restart uses, even when it cannot be launched right now. With an external target (issue #11)
   * a detection launches nothing and changes no state: a usable path is only remembered, so a
   * later switch back to `spawn` can use it, and a missing binary is not an error.
   */
  onDetection(result: DetectionResult): void {
    if (this.disposed) return;
    const usable = result.kind === 'ok' || result.kind === 'unknown-version';
    const kind = this.current.kind;

    if (usable) {
      const binaryPath = result.binary.path;
      this.lastUsablePath = binaryPath;
      if (this.target.kind !== 'spawn') return;
      if (this.folderChoice === undefined || 'reason' in this.folderChoice) return;
      if (kind === 'idle' || kind === 'unavailable') {
        // A detection is a user action: it overrides a pending backoff and clears the counter.
        this.cancelRetryTimer();
        this.crashAttempts = 0;
        this.launching = this.launch(binaryPath, this.folderChoice.folder);
      } else if (kind === 'starting') {
        this.pendingPath = binaryPath;
      } else if (this.current.kind === 'running' && binaryPath !== this.current.server.binaryPath) {
        void this.restart('binary-changed');
      }
      // `restarting`: the relaunch reads `lastUsablePath`, already updated above.
      return;
    }

    if (this.target.kind !== 'spawn') return;
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
   * Stops the current server and starts another with the last usable binary and the current
   * folder. Serialized: while a restart is in flight every call returns that same Promise.
   *
   * Aborts a start in progress (it kills its own child), stops the running server with the
   * injected `stop`, waits for the attempt to settle and launches again; the states are
   * `restarting` (with the reason) and then the usual `starting` / `running`. The Promise never
   * rejects. Resolves `no-binary` when no detection accepted a binary yet, `no-workspace` for a
   * `command` restart with no folder, `disposed` after `stop()`, else `attempted` (the new start
   * may still fail; that shows in the state). A user-made restart (any reason but `crash`)
   * resets the automatic-restart counter. With an external target it RECONNECTS instead of
   * launching (and never answers `no-binary`, since no binary is needed); a `target-changed`
   * restart back to `spawn` with no known binary ends in `idle` and answers `no-binary`, the next
   * detection launches. VERIFIED with fakes (unit tests); against a real
   * opencode only by the opt-in integration suite on Windows.
   */
  restart(reason: RestartReason): Promise<RestartResult> {
    if (this.disposed) return Promise.resolve('disposed');
    if (this.restartPromise !== undefined) return this.restartPromise;
    // The folder is checked first: in a window with no folder, "open a folder" is the useful
    // answer whether or not a binary was detected.
    const choice = this.folderChoice;
    if (reason === 'command' && (choice === undefined || 'reason' in choice)) {
      this.deps.log.info('restart ignored: no workspace folder to serve');
      return Promise.resolve('no-workspace');
    }
    if (
      this.target.kind === 'spawn' &&
      reason !== 'target-changed' &&
      this.lastUsablePath === undefined
    ) {
      this.deps.log.info('restart ignored: no usable opencode binary has been detected yet');
      return Promise.resolve('no-binary');
    }
    const promise = this.doRestart(reason).finally(() => {
      if (this.restartPromise === promise) this.restartPromise = undefined;
    });
    this.restartPromise = promise;
    return promise;
  }

  /**
   * The body of {@link restart}, run once per restart. Order matters: cancel the backoff timer,
   * abort a start in progress, take the running server out (so its `exit` is ignored), publish
   * `restarting` BEFORE the first await, stop the old process, wait for an aborted attempt to
   * clean up its child, and only then launch (a `spawn` target) or connect (an external one),
   * unless `stop()` ran meanwhile. It loops: after a pass that did launch or connect, it compares
   * what that pass used with what is current (folder, target, binary) and, if a change was
   * coalesced into the restart meanwhile, runs another pass with the matching reason
   * (`folder-changed`, `target-changed`, `binary-changed`); otherwise it returns the result of the
   * last pass. VERIFIED by the unit tests of `serverManager.test.ts` with synthetic changes.
   */
  private async doRestart(reason: RestartReason): Promise<RestartResult> {
    let current = reason;
    for (;;) {
      this.lastLaunch = undefined;
      const result = await this.restartOnce(current);
      const used = this.lastLaunch as
        { target: ServerTarget; binaryPath: string | undefined; folder: string } | undefined;
      if (result !== 'attempted' || this.disposed || used === undefined) return result;
      // A folder, target or binary change that arrived while this restart was already launching
      // was coalesced into it (W1 of the review) and would be lost: the server runs what was read
      // BEFORE the change. Restart once more with the values that are current now. The binary
      // only matters to a `spawn` launch.
      const choice = this.folderChoice;
      const folderNow = choice !== undefined && 'folder' in choice ? choice.folder : undefined;
      if (folderNow !== undefined && folderNow !== used.folder) current = 'folder-changed';
      else if (!sameTarget(used.target, this.target)) current = 'target-changed';
      else if (
        this.target.kind === 'spawn' &&
        this.lastUsablePath !== undefined &&
        this.lastUsablePath !== used.binaryPath
      ) {
        current = 'binary-changed';
      } else return result;
    }
  }

  /**
   * One pass of {@link doRestart}: stops, waits and launches (or, with an external target,
   * connects) once, remembering in `lastLaunch` which target, binary and folder it used.
   */
  private async restartOnce(reason: RestartReason): Promise<RestartResult> {
    this.cancelRetryTimer();
    if (reason !== 'crash') this.crashAttempts = 0;
    this.abort?.abort();
    const running = this.running;
    this.running = undefined;
    this.runningSince = undefined;
    this.setState({ kind: 'restarting', reason });
    if (running !== undefined) await this.stopQuietly(running);
    await this.launching?.catch(() => undefined);
    if (this.disposed) return 'disposed';
    const choice = this.folderChoice;
    const binaryPath = this.lastUsablePath;
    if (choice === undefined || 'reason' in choice) {
      this.setState({
        kind: 'unavailable',
        reason: 'no-workspace',
        message: choice === undefined ? 'no workspace folder is open' : choice.message,
      });
      return 'no-workspace';
    }
    const target = this.target;
    if (target.kind !== 'spawn') {
      this.lastLaunch = { target, binaryPath: undefined, folder: choice.folder };
      this.launching = this.connect(target, choice.folder);
      await this.launching;
      return 'attempted';
    }
    if (binaryPath === undefined) {
      // Back to `spawn` with nothing detected yet: wait in `idle`; the next detection launches.
      this.setState({ kind: 'idle' });
      return 'no-binary';
    }
    this.lastLaunch = { target, binaryPath, folder: choice.folder };
    this.launching = this.launch(binaryPath, choice.folder);
    await this.launching;
    return 'attempted';
  }

  /**
   * Stops the server and makes the manager inert. Idempotent: every call returns the same
   * Promise. Cancels the backoff timer, aborts a start in progress and waits for it to settle
   * (it kills its own child), asks the injected `stop` to end a running one, waits for a restart
   * in flight and always resolves, ending in `stopped`. The abort also cancels an in-flight
   * `/api/info` request, so the wait is bounded by the process stop (about 3 s with the defaults
   * of `stopServer`), not by the request timeout.
   */
  stop(): Promise<void> {
    this.stopPromise ??= this.doStop();
    return this.stopPromise;
  }

  /**
   * The body of {@link stop}, run once. Order matters: mark disposed first (so a detection that
   * arrives now starts nothing and a late start is stopped by its own attempt), cancel the timer
   * (a pending crash restart must never launch after a stop), then abort the attempt in
   * progress, then stop the running server, then wait for the attempt and for a restart in flight
   * to clean up. It publishes `stopping` before the first await and `stopped` at the end;
   * `stopQuietly` and the guarded log guarantee that nothing in between can make it reject,
   * which is why the state always reaches `stopped`. VERIFIED by unit tests with fakes and, with
   * real processes, by the test where the log throws during `stop()`.
   */
  private async doStop(): Promise<void> {
    this.disposed = true;
    this.cancelRetryTimer();
    this.abort?.abort();
    const running = this.running;
    this.running = undefined;
    this.setState({ kind: 'stopping' });
    if (running !== undefined) await this.stopQuietly(running);
    await this.launching?.catch(() => undefined);
    await this.restartPromise?.catch(() => undefined);
    this.setState({ kind: 'stopped' });
  }

  /** Cancels the pending crash-restart timer, if any. */
  private cancelRetryTimer(): void {
    this.retryTimer?.cancel();
    this.retryTimer = undefined;
  }

  /**
   * Runs one start attempt (plan B, version check, exit watch) and, on failure, the pending retry.
   *
   * An attempt aborted by `stop()` or by `restart()` is cleaned up silently: it stops its own
   * child and publishes nothing, otherwise a restart would flash a spurious `start-failed` (and
   * its error notification) between `restarting` and `starting`.
   */
  private async launch(binaryPath: string, folder: string): Promise<void> {
    const controller = new AbortController();
    this.abort = controller;
    this.pendingPath = undefined;
    this.setState({ kind: 'starting', folder, binaryPath });
    let started: RunningServer | undefined;
    try {
      started = await this.startWithPlanB(binaryPath, folder, controller.signal);
      if (this.disposed || controller.signal.aborted) return await this.stopQuietly(started);
      const info = await this.deps.fetchInfo(started.url, started.password, controller.signal);
      if (this.disposed || controller.signal.aborted) return await this.stopQuietly(started);
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
        this.runningSince = this.now();
        this.setState({
          kind: 'running',
          server: {
            url: server.url,
            password: server.password,
            version: info.version,
            folder,
            binaryPath,
            pid: server.child.pid,
            source: 'spawned',
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
      if (!this.disposed && !controller.signal.aborted) {
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
      // Not awaited: the restart waits for THIS launch to settle, so awaiting it here would
      // deadlock. `lastUsablePath` already holds `retry`.
      void this.restart('binary-changed');
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

  /**
   * Connects to an external server (issue #11): the counterpart of {@link launch} that starts no
   * process.
   *
   * `external-invalid` goes straight to `unavailable/invalid-url` and a target with no stored
   * password to `unavailable/unauthorized` WITHOUT a request (a v2 server always has a password,
   * so asking without one is a guaranteed 401; VERIFIED by reading `server-process.ts@843a6c51`
   * on 2026-10-22). Otherwise it publishes `connecting`, asks `GET /api/info` through the
   * injected `fetchInfo` and judges the major version like {@link launch}: a 1.x server is
   * `unsupported-version`, another minor only warns. A failed request goes through
   * `describeExternalFailure` (reason and webview-safe text) and the full cause, with the URL,
   * to the log. The attempt is cancelled by `stop()` and by a restart through `abort`; a
   * cancelled attempt publishes nothing, so a restart never flashes a spurious failure. It never
   * rejects and never retries by itself. There is no child: `running` stays `undefined`, so
   * there is no exit watch and nothing to kill. VERIFIED with fakes (unit tests) and against the
   * synthetic fixture in a real VS Code (`externalServer.test.ts`); the real opencode only by the
   * opt-in external case of `realOpencode.test.ts`.
   */
  private async connect(target: ServerTarget, folder: string): Promise<void> {
    this.pendingPath = undefined;
    if (target.kind === 'external-invalid') {
      this.setState({ kind: 'unavailable', reason: 'invalid-url', message: target.message });
      return;
    }
    if (target.kind !== 'external') return;
    if (target.password === undefined) {
      this.setState({
        kind: 'unavailable',
        reason: 'unauthorized',
        message:
          'No password is stored for the external opencode server. Run "OpenCode: Set Server Password".',
      });
      return;
    }
    const controller = new AbortController();
    this.abort = controller;
    this.setState({ kind: 'connecting', folder, url: target.url });
    try {
      const info = await this.deps.fetchInfo(target.url, target.password, controller.signal);
      if (this.disposed || controller.signal.aborted) return;
      const check = checkServerVersion(info.version);
      if (check.kind === 'unsupported') {
        this.deps.log.error(check.message);
        this.setState({
          kind: 'unavailable',
          reason: 'unsupported-version',
          message: check.message,
        });
        return;
      }
      if (check.kind === 'warn') this.deps.log.warn(check.message);
      this.setState({
        kind: 'running',
        server: {
          url: target.url,
          password: target.password,
          version: info.version,
          folder,
          binaryPath: undefined,
          pid: info.pid,
          source: 'external',
        },
      });
    } catch (error) {
      if (this.disposed || controller.signal.aborted) return;
      const failure = describeExternalFailure(error);
      this.deps.log.error(
        `could not connect to the external server at ${target.url}: ${describeFailureCause(error)}`,
      );
      this.setState({ kind: 'unavailable', reason: failure.reason, message: failure.message });
    } finally {
      if (this.abort === controller) this.abort = undefined;
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

  /**
   * Reacts to the child exiting; ignored when we caused it (stop, restart) or it is no longer
   * current. An unexpected exit schedules an automatic restart: the delay is the next of
   * {@link AUTO_RESTART_DELAYS_MS}, the counter starts over when the server had run for
   * {@link STABLE_RUN_MS}, and once the delays run out the manager logs that it gives up and
   * stays `unavailable/exited` without `retryInMs` (which is what raises the notification).
   */
  private onChildExit(
    server: RunningServer,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.disposed || this.running !== server) return;
    this.running = undefined;
    const lived = this.runningSince === undefined ? 0 : this.now() - this.runningSince;
    this.runningSince = undefined;
    if (lived >= STABLE_RUN_MS) this.crashAttempts = 0;
    const message = `The opencode server exited unexpectedly (code ${String(code)}, signal ${String(signal)})`;
    const delay = AUTO_RESTART_DELAYS_MS[this.crashAttempts];
    if (delay === undefined) {
      this.deps.log.error(
        `giving up restarting the server after ${String(AUTO_RESTART_DELAYS_MS.length)} attempts`,
      );
      this.setState({ kind: 'unavailable', reason: 'exited', message });
      return;
    }
    this.crashAttempts += 1;
    this.setState({
      kind: 'unavailable',
      reason: 'exited',
      message,
      retryInMs: delay,
      attempt: this.crashAttempts,
    });
    this.retryTimer = this.schedule(delay, () => {
      this.retryTimer = undefined;
      void this.restart('crash');
    });
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
