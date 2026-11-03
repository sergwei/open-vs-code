// Runs mods, one `worker_threads.Worker` each (E10-mods, plan Engram #1765 sections 3.2 and 3.5,
// decision P2=1). No `vscode` import: the VS Code side (phase 2) injects a {@link ModUi} and the
// log sinks, and Vitest drives the class with a REAL Worker (`modHost.test.ts`).
//
// Containment is the whole point. A mod that throws, hangs or exits ends in state `failed` with
// one lifecycle line, and nothing else moves:
//   - throws in `activate` -> the Worker reports `failed`; a throw in a handler or a command is
//     caught inside the Worker (`src/mods/worker.ts`) and only logged;
//   - hangs (`while (true)`) -> the heartbeat: every `heartbeatMs` the host pings; `missedLimit`
//     pings in flight with no `pong` mean the Worker's event loop is blocked, and
//     `worker.terminate()` stops it even inside a synchronous loop (Node docs: "Execution may stop
//     at any point as a result of worker.terminate()"; `@types/node` 22.20.5 `worker_threads.d.ts`);
//   - dies (`process.exit()`, an `error` or `exit` of the Worker) -> `failed`;
//   - never answers a command -> that call rejects after `commandTimeoutMs`; the mod stays active
//     (a really blocked one is caught by the heartbeat).
// There is no automatic restart: the user reloads.
// Panels (phase 4): `panel.open/message/close` from a Worker go to the optional {@link ModPanelUi}
// (`modPanels.ts`) after the wire guard checked paths, titles and the 1 MB cap; the host keeps the
// ids each mod has open (at most {@link MAX_PANELS_PER_MOD}) and closes them all when the mod
// stops, fails or reloads, so a dead mod never leaves a tab behind.
// Flood limits (E10-mods-limits, #155): everything a mod makes the host write to the "OpenCode Mods"
// channel is capped at {@link LOG_LINES_PER_SECOND} (plus at most one "limit reached" line per
// window, which `admit` writes itself and does not count), and the `panel.message` it relays to its
// panels at {@link PANEL_MESSAGES_PER_SECOND}. The cap lives here and not in `worker.ts` because a
// Worker runs arbitrary code and can post to the parent port without going through the bootstrap.
//
// Secrets: a Worker is NOT a sandbox (a mod has Node and the user's permissions), so the only
// guarantee is what the host hands over: the Worker gets an explicit copy of the environment
// without the opencode password variables, `ELECTRON_RUN_AS_NODE` or `VSCODE_*`
// ({@link buildModEnv}), and never the client or the server URL (the messages of `src/mods/wire.ts`
// carry neither).

import { Worker, type WorkerOptions } from 'node:worker_threads';
import type { ModEvent, ModJson, ModSeverity } from '../mods/api';
import { MAX_MOD_COMMAND_ARGS } from '../shared/protocol';
import type { DiscoveredMod } from './modDiscovery';
import {
  MAX_COMMANDS_PER_MOD,
  MAX_PANELS_PER_MOD,
  isWorkerToHost,
  type HostToWorker,
  type LogLevel,
  type WorkerToHost,
} from '../mods/wire';

/** Lifecycle of one mod. `stopped` is a mod that was shut down on purpose. */
export type ModState = 'starting' | 'active' | 'failed' | 'stopped';

/** One mod as the "Manage Mods" list shows it. `error` is set only for `failed`. */
export interface ModStatus {
  id: string;
  name: string;
  version: string;
  state: ModState;
  error?: string;
}

/** A command a mod registered (the `/` menu and the palette list these). */
export interface ModCommandInfo {
  modId: string;
  modName: string;
  name: string;
  description?: string;
}

/** The band entry a mod set; `undefined` means the mod cleared it. */
export interface ModStatusLine {
  text: string;
  tooltip?: string;
  severity?: ModSeverity;
  command?: string;
}

/** What the VS Code side provides for the UI calls of a mod. */
export interface ModUi {
  status(modId: string, line: ModStatusLine | undefined): void;
  /** Shows a native notification; resolves with the pressed button, or `undefined`. */
  toast(
    modId: string,
    toast: { message: string; severity?: ModSeverity; actions?: string[] },
  ): Promise<string | undefined>;
  compose(modId: string, request: { text: string; send?: boolean }): void;
}

/** What a mod asked `station.ui.panel.open` for; paths are relative to {@link ModPanelRequest.dir}. */
export interface ModPanelRequest {
  /** Real path of the mod folder: the only place the panel may read from. */
  dir: string;
  title: string;
  html: string;
  scripts: string[];
  styles: string[];
}

/**
 * What the VS Code side provides for the panels of mods (`modPanels.ts`). The host has already
 * validated the messages and capped the panels per mod. `close` is called when the mod closes a
 * panel and, for each panel it still had open, when the mod stops or fails.
 */
export interface ModPanelUi {
  open(modId: string, panelId: string, request: ModPanelRequest): void;
  message(modId: string, panelId: string, data: ModJson): void;
  close(modId: string, panelId: string): void;
}

/** The part of `Worker` the host uses; tests can inject a fake. */
export interface WorkerLike {
  postMessage(value: unknown): void;
  terminate(): Promise<number>;
  on(event: 'message', listener: (value: unknown) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (exitCode: number) => void): this;
}

/** Creates the Worker for a mod; the default is `new Worker(file, options)`. */
export type WorkerFactory = (file: string, options: WorkerOptions) => WorkerLike;

/** Everything {@link ModHost} needs. Times are in milliseconds. */
export interface ModHostOptions {
  /** Absolute path of the bundled bootstrap (`dist/modWorker.js`). */
  workerFile: string;
  ui: ModUi;
  /** Panels of mods; without it every `panel.open` is refused with a `warn`. */
  panels?: ModPanelUi;
  /** Lines about the life of a mod (`mod x loaded`, `mod x failed: …`) for the main log. */
  logLifecycle(text: string): void;
  /** What a mod itself logs, for the "OpenCode Mods" channel. */
  logMod(modId: string, level: LogLevel, text: string): void;
  createWorker?: WorkerFactory;
  /** Environment to filter for the Workers; defaults to `process.env`. */
  baseEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Ping period. Default 5000 (plan 3.2). */
  heartbeatMs?: number;
  /** Pings in flight that mean "hung". Default 3 (plan 3.2). */
  missedLimit?: number;
  /** How long `activate` may take. Default 30 000, the same as a command (own choice). */
  activateTimeoutMs?: number;
  /** How long a command may take. Default 30 000 (plan 3.5). */
  commandTimeoutMs?: number;
  /** Grace a mod gets to run `deactivate` before its Worker is terminated. Default 250 (own choice). */
  deactivateGraceMs?: number;
  /** V8 old-generation cap per Worker. Default 256 (plan 3.2: HYPOTHESIS that it suffices). */
  maxOldGenerationSizeMb?: number;
}

/** Minimum gap between two band updates of one mod (plan 3.5: at most 10 per second). */
const STATUS_MIN_GAP_MS = 100;
/** Minimum gap between two toasts of one mod (plan 3.5: one every 2 seconds). */
const TOAST_MIN_GAP_MS = 2000;
/**
 * Most lines per second one mod may add to the "OpenCode Mods" channel (E10-mods-limits, #155).
 * Own choice: enough for a long stack trace written line by line, far above what a person reads.
 * Counts `log`, `error` and the host's own `warn` lines about the mod.
 */
const LOG_LINES_PER_SECOND = 50;
/**
 * Most `panel.message` per second one mod may send to its panels, all panels together
 * (E10-mods-limits, #155). Own choice: half a 60 Hz refresh, plenty for a live progress view, and
 * with the 1 MB cap per message it bounds the worst case towards the webview.
 */
const PANEL_MESSAGES_PER_SECOND = 30;
/** Length of the fixed window both flood limits count in. */
const RATE_WINDOW_MS = 1000;

/** Fixed one-second window of a flood limit: how many were let through, and whether it warned already. */
interface RateWindow {
  start: number;
  count: number;
  warned: boolean;
}

/** A window that is expired for any `Date.now()`, so the first call opens a fresh one. */
const newRateWindow = (): RateWindow => ({
  start: Number.NEGATIVE_INFINITY,
  count: 0,
  warned: false,
});

interface ModRecord {
  mod: DiscoveredMod;
  state: ModState;
  error?: string;
  worker?: WorkerLike;
  heartbeat?: NodeJS.Timeout;
  activateTimer?: NodeJS.Timeout;
  outstandingPings: number;
  pingN: number;
  commands: Map<string, string | undefined>;
  pendingCommands: Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >;
  nextRequest: number;
  statusLastAt: number;
  statusPending?: { line: ModStatusLine | undefined };
  statusTimer?: NodeJS.Timeout;
  hasStatus: boolean;
  lastToastAt: number;
  /** Ids of the panels this mod has open. */
  panels: Set<string>;
  /** Window of {@link LOG_LINES_PER_SECOND}. */
  logWindow: RateWindow;
  /** Window of {@link PANEL_MESSAGES_PER_SECOND}. */
  panelWindow: RateWindow;
}

/**
 * Copy of `baseEnv` for a mod's Worker: no `OPENCODE_PASSWORD`, `OPENCODE_SERVER_PASSWORD`,
 * `ELECTRON_RUN_AS_NODE` or `VSCODE_*`. On win32 the names are matched ignoring case, because a
 * Worker's env copy is case-sensitive there (`worker_threads.d.ts`: `env` option) while Windows
 * itself is not. Does not mutate `baseEnv`; entries with an `undefined` value are dropped.
 * VERIFIED by `modHost.test.ts` "hands the Worker an environment without the opencode password":
 * a mod printed what its own `process.env` held (Windows 11, 02/11/2026); the POSIX spelling
 * (exact match) is UNVERIFIED until the CI.
 */
export function buildModEnv(
  baseEnv: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    const name = platform === 'win32' ? key.toUpperCase() : key;
    if (
      name === 'OPENCODE_PASSWORD' ||
      name === 'OPENCODE_SERVER_PASSWORD' ||
      name === 'ELECTRON_RUN_AS_NODE' ||
      name.startsWith('VSCODE_')
    ) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

/** Owns the Workers of all mods and the state the rest of the extension reads. */
export class ModHost {
  private readonly records = new Map<string, ModRecord>();
  /** Set by {@link ModHost.dispose}; from then on no Worker is created. */
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly heartbeatMs: number;
  private readonly missedLimit: number;
  private readonly activateTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly deactivateGraceMs: number;
  private readonly createWorker: WorkerFactory;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly options: ModHostOptions) {
    this.heartbeatMs = options.heartbeatMs ?? 5000;
    this.missedLimit = options.missedLimit ?? 3;
    this.activateTimeoutMs = options.activateTimeoutMs ?? 30_000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
    this.deactivateGraceMs = options.deactivateGraceMs ?? 250;
    this.platform = options.platform ?? process.platform;
    this.createWorker =
      options.createWorker ?? ((file, workerOptions) => new Worker(file, workerOptions));
  }

  /** Subscribes to any change of a mod's state, commands or the set of mods; returns the unsubscribe. */
  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  /** State of every mod started so far, in start order. */
  statuses(): ModStatus[] {
    return [...this.records.values()].map((rec) => {
      const status: ModStatus = {
        id: rec.mod.manifest.id,
        name: rec.mod.manifest.name,
        version: rec.mod.manifest.version,
        state: rec.state,
      };
      if (rec.error !== undefined) status.error = rec.error;
      return status;
    });
  }

  /** Commands of the mods that are `active` (a failed mod has none). */
  commands(): ModCommandInfo[] {
    const result: ModCommandInfo[] = [];
    for (const rec of this.records.values()) {
      if (rec.state !== 'active') continue;
      for (const [name, description] of rec.commands) {
        const info: ModCommandInfo = {
          modId: rec.mod.manifest.id,
          modName: rec.mod.manifest.name,
          name,
        };
        if (description !== undefined) info.description = description;
        result.push(info);
      }
    }
    return result;
  }

  /**
   * Starts a Worker per mod. A mod whose id is already running is skipped. Returns at once: each
   * mod becomes `active` (or `failed`) later and {@link ModHost.onDidChange} says when. Does
   * nothing after {@link ModHost.dispose}.
   */
  start(mods: readonly DiscoveredMod[]): void {
    if (this.disposed) return;
    for (const mod of mods) {
      const existing = this.records.get(mod.manifest.id);
      if (existing !== undefined && existing.state !== 'stopped' && existing.state !== 'failed') {
        continue;
      }
      this.spawn(mod);
    }
    this.emitChange();
  }

  /**
   * Hands `event` to every `active` mod, fire and forget (the handler's return value is ignored
   * and a mod that was down does not get what it missed).
   */
  dispatch(event: ModEvent): void {
    for (const rec of this.records.values()) {
      if (rec.state === 'active') this.post(rec, { type: 'event', event });
    }
  }

  /**
   * Runs the command `name` of mod `modId`.
   *
   * Rejects when the mod is not `active`, has no such command, `args` is longer than
   * {@link MAX_MOD_COMMAND_ARGS} (nothing is posted to the Worker; this is the one cap, so it also
   * covers the palette, which hands `args` over unmeasured), the handler throws (with its
   * message), or `commandTimeoutMs` passes with no answer. A timeout does not fail the mod.
   * VERIFIED by `modHost.test.ts` "runs a command and rejects with its error" and "rejects a
   * command that never answers" with a real Worker (Windows 11, 02/11/2026).
   * VERIFIED for the args cap by `modHost.test.ts` "rejects command args longer than
   * MAX_MOD_COMMAND_ARGS and posts nothing" (fake Worker, Windows 11, 03/11/2026); not observed
   * through the palette in a real VS Code.
   */
  runCommand(modId: string, name: string, args: string, sessionID?: string): Promise<void> {
    const rec = this.records.get(modId);
    if (rec === undefined || rec.state !== 'active') {
      return Promise.reject(new Error(`mod "${modId}" is not running`));
    }
    if (!rec.commands.has(name)) {
      return Promise.reject(new Error(`mod "${modId}" has no command "${name}"`));
    }
    if (args.length > MAX_MOD_COMMAND_ARGS) {
      return Promise.reject(
        new Error(
          `arguments of "${name}" are too long (at most ${MAX_MOD_COMMAND_ARGS} characters)`,
        ),
      );
    }
    const requestId = `c${(rec.nextRequest += 1)}`;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        rec.pendingCommands.delete(requestId);
        reject(new Error(`command "${name}" of mod "${modId}" timed out`));
      }, this.commandTimeoutMs);
      timer.unref();
      rec.pendingCommands.set(requestId, { resolve, reject, timer });
      this.post(rec, {
        type: 'command.run',
        requestId,
        name,
        args,
        ...(sessionID !== undefined ? { sessionID } : {}),
      });
    });
  }

  /**
   * Stops every mod (graceful `deactivate`, then `terminate`) and starts `mods` from scratch.
   * A no-op once the host is disposed, also when `dispose` happens while this call is waiting for
   * `stopAll` (a load that was in flight when the extension deactivated): otherwise it would
   * start Workers on a host nobody is going to stop.
   * VERIFIED by `modHost.test.ts` "a reload that was waiting when dispose came creates no Worker".
   */
  async reload(mods: readonly DiscoveredMod[]): Promise<void> {
    if (this.disposed) return;
    await this.stopAll();
    if (this.disposed) return;
    this.records.clear();
    this.start(mods);
  }

  /**
   * Stops every mod and leaves no Worker alive. The host cannot be used afterwards: the flag is
   * set before anything is awaited, so {@link ModHost.start} and {@link ModHost.reload} do nothing
   * from then on, including a load that was already in flight.
   * VERIFIED by `modHost.test.ts` "start and reload after dispose create no Worker" and "a reload
   * that was waiting when dispose came creates no Worker" (fake factory).
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stopAll();
    this.listeners.clear();
  }

  /** Tells every {@link ModHost.onDidChange} listener; iterates a copy so a listener may unsubscribe. */
  private emitChange(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Creates the record and the Worker of one mod, starts the activate timer and the heartbeat
   * (both from the first instant, so an `activate()` that blocks before it ever answers is
   * caught too) and posts `init`. A factory that throws leaves the mod `failed`, not the host.
   * Timers are `unref`ed: a forgotten mod never keeps the process alive.
   */
  private spawn(mod: DiscoveredMod): void {
    const { id } = mod.manifest;
    const rec: ModRecord = {
      mod,
      state: 'starting',
      outstandingPings: 0,
      pingN: 0,
      commands: new Map(),
      pendingCommands: new Map(),
      nextRequest: 0,
      statusLastAt: 0,
      hasStatus: false,
      lastToastAt: 0,
      panels: new Set(),
      logWindow: newRateWindow(),
      panelWindow: newRateWindow(),
    };
    this.records.set(id, rec);
    try {
      const worker = this.createWorker(this.options.workerFile, {
        env: buildModEnv(this.options.baseEnv ?? process.env, this.platform),
        resourceLimits: { maxOldGenerationSizeMb: this.options.maxOldGenerationSizeMb ?? 256 },
      });
      rec.worker = worker;
      worker.on('message', (value) => this.onMessage(rec, value));
      worker.on('error', (error) => this.fail(rec, `worker error: ${error.message}`));
      worker.on('exit', (code) => {
        if (rec.state === 'starting' || rec.state === 'active') {
          this.fail(rec, `worker exited with code ${code}`);
        }
      });
    } catch (error) {
      this.fail(
        rec,
        `could not start the worker: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    rec.activateTimer = setTimeout(() => {
      this.fail(rec, `activate() did not finish within ${this.activateTimeoutMs} ms`);
    }, this.activateTimeoutMs);
    rec.activateTimer.unref();
    rec.heartbeat = setInterval(() => this.tick(rec), this.heartbeatMs);
    rec.heartbeat.unref();
    this.post(rec, {
      type: 'init',
      entry: mod.entry,
      mod: { id, name: mod.manifest.name, version: mod.manifest.version },
    });
  }

  /** One heartbeat: fail the mod if `missedLimit` pings are unanswered, else send the next. */
  private tick(rec: ModRecord): void {
    if (rec.state !== 'starting' && rec.state !== 'active') return;
    if (rec.outstandingPings >= this.missedLimit) {
      const seconds = Math.round((this.heartbeatMs * this.missedLimit) / 100) / 10;
      this.fail(rec, `hung: no answer to ${this.missedLimit} heartbeats (${seconds} s)`);
      return;
    }
    rec.outstandingPings += 1;
    rec.pingN += 1;
    this.post(rec, { type: 'ping', n: rec.pingN });
  }

  /** Sends to the Worker; a Worker that is already gone is not an error here (its `exit` reports it). */
  private post(rec: ModRecord, message: HostToWorker): void {
    try {
      rec.worker?.postMessage(message);
    } catch {
      // A Worker already gone: its `exit` handler reports it.
    }
  }

  /**
   * Fixed-window flood limit: lets through at most `max` calls per {@link RATE_WINDOW_MS} and
   * answers `false` for the rest. The first drop of a window writes ONE `warn` saying `what` was
   * dropped, straight to `logMod` (that line is not counted, or the limit could not speak). Dropped,
   * not coalesced: a log line is not a state, and a panel payload is opaque to the host.
   * A window can let up to twice the cap through around its edge (accepted: no token bucket).
   * Uses `Date.now()` like {@link ModHost.showToast}, so a backwards clock jump keeps the window
   * open longer (HYPOTHESIS, not reproduced).
   */
  private admit(rec: ModRecord, win: RateWindow, max: number, what: string): boolean {
    const now = Date.now();
    if (now - win.start >= RATE_WINDOW_MS) {
      win.start = now;
      win.count = 0;
      win.warned = false;
    }
    if (win.count < max) {
      win.count += 1;
      return true;
    }
    if (!win.warned) {
      win.warned = true;
      this.options.logMod(
        rec.mod.manifest.id,
        'warn',
        `${what} dropped: more than ${max} per second, the rest of this second is discarded`,
      );
    }
    return false;
  }

  /**
   * Writes a line to the mod's log channel, counted against {@link LOG_LINES_PER_SECOND}. Every host
   * write about what the mod sends goes through here except the one "limit reached" line per window
   * that `admit` writes directly.
   */
  private log(rec: ModRecord, level: LogLevel, text: string): void {
    if (this.admit(rec, rec.logWindow, LOG_LINES_PER_SECOND, 'log lines')) {
      this.options.logMod(rec.mod.manifest.id, level, text);
    }
  }

  /**
   * Border of the host: drops anything from a mod that is not running, and anything that fails
   * {@link isWorkerToHost} (one `warn` in the mod's log, counted in the log limit). Everything
   * valid goes to `handle`.
   */
  private onMessage(rec: ModRecord, value: unknown): void {
    if (rec.state !== 'starting' && rec.state !== 'active') return;
    if (!isWorkerToHost(value)) {
      this.log(rec, 'warn', 'ignored an invalid message from the mod worker');
      return;
    }
    this.handle(rec, value);
  }

  /**
   * Acts on one validated message: `ready` makes the mod `active`, `failed` fails it, `pong`
   * resets the heartbeat, `command.*` keep the command table and settle pending runs, and the UI
   * messages go to {@link ModUi} (status coalesced, toast rate-limited, log lines and
   * `panel.message` flood-limited). Commands registered during `activate` are accepted before
   * `ready`.
   */
  private handle(rec: ModRecord, message: WorkerToHost): void {
    const id = rec.mod.manifest.id;
    switch (message.type) {
      case 'ready':
        if (rec.state !== 'starting') return;
        rec.state = 'active';
        clearTimeout(rec.activateTimer);
        this.options.logLifecycle(`mod ${id} loaded`);
        this.emitChange();
        return;
      case 'failed':
        this.fail(rec, message.message);
        return;
      case 'log':
        this.log(rec, message.level, message.text);
        return;
      case 'error':
        this.log(rec, 'error', message.message);
        return;
      case 'pong':
        rec.outstandingPings = 0;
        return;
      case 'command.add':
        if (rec.commands.size >= MAX_COMMANDS_PER_MOD && !rec.commands.has(message.name)) {
          this.log(rec, 'warn', `command "${message.name}" ignored: too many commands`);
          return;
        }
        rec.commands.set(message.name, message.description);
        this.emitChange();
        return;
      case 'command.remove':
        if (rec.commands.delete(message.name)) this.emitChange();
        return;
      case 'command.done': {
        const pending = rec.pendingCommands.get(message.requestId);
        if (pending === undefined) return;
        rec.pendingCommands.delete(message.requestId);
        clearTimeout(pending.timer);
        if (message.error === undefined) pending.resolve();
        else pending.reject(new Error(message.error));
        return;
      }
      case 'status.set': {
        const line: ModStatusLine = { text: message.text };
        if (message.tooltip !== undefined) line.tooltip = message.tooltip;
        if (message.severity !== undefined) line.severity = message.severity;
        if (message.command !== undefined) line.command = message.command;
        this.setStatus(rec, line);
        return;
      }
      case 'status.clear':
        this.setStatus(rec, undefined);
        return;
      case 'toast':
        this.showToast(rec, message);
        return;
      case 'compose':
        this.options.ui.compose(id, {
          text: message.text,
          ...(message.send !== undefined ? { send: message.send } : {}),
        });
        return;
      case 'panel.open':
        this.openPanel(rec, message);
        return;
      case 'panel.message':
        if (
          rec.panels.has(message.panelId) &&
          this.admit(rec, rec.panelWindow, PANEL_MESSAGES_PER_SECOND, 'panel messages')
        ) {
          this.options.panels?.message(id, message.panelId, message.data);
        }
        return;
      case 'panel.close':
        if (rec.panels.delete(message.panelId)) this.options.panels?.close(id, message.panelId);
        return;
    }
  }

  /**
   * Opens a panel for a mod, or refuses it: with no panel UI, past {@link MAX_PANELS_PER_MOD} or
   * with an id already in use, the host logs a `warn` and answers `panel.closed` so the mod's
   * handle behaves as a closed panel instead of waiting forever.
   */
  private openPanel(rec: ModRecord, message: Extract<WorkerToHost, { type: 'panel.open' }>): void {
    const id = rec.mod.manifest.id;
    const panels = this.options.panels;
    if (
      panels === undefined ||
      rec.panels.size >= MAX_PANELS_PER_MOD ||
      rec.panels.has(message.panelId)
    ) {
      this.log(rec, 'warn', 'panel refused: no panel support or too many panels open');
      this.post(rec, { type: 'panel.closed', panelId: message.panelId });
      return;
    }
    rec.panels.add(message.panelId);
    panels.open(id, message.panelId, {
      dir: rec.mod.dir,
      title: message.title,
      html: message.html,
      scripts: message.scripts ?? [],
      styles: message.styles ?? [],
    });
  }

  /** Relays a JSON value from the page of a panel to its mod; ignored for a panel the mod does not have open. */
  panelMessage(modId: string, panelId: string, data: ModJson): void {
    const rec = this.records.get(modId);
    if (rec?.state === 'active' && rec.panels.has(panelId)) {
      this.post(rec, { type: 'panel.message', panelId, data });
    }
  }

  /** Tells a mod that the user closed the tab of one of its panels. */
  panelClosed(modId: string, panelId: string): void {
    const rec = this.records.get(modId);
    if (rec === undefined || !rec.panels.delete(panelId)) return;
    if (rec.state === 'active') this.post(rec, { type: 'panel.closed', panelId });
  }

  /**
   * Passes a band update on, at most one per {@link STATUS_MIN_GAP_MS}: updates that arrive
   * sooner are coalesced and only the latest goes out when the gap has passed (plan 3.5).
   */
  private setStatus(rec: ModRecord, line: ModStatusLine | undefined): void {
    const elapsed = Date.now() - rec.statusLastAt;
    if (elapsed >= STATUS_MIN_GAP_MS && rec.statusTimer === undefined) {
      this.emitStatus(rec, line);
      return;
    }
    rec.statusPending = { line };
    if (rec.statusTimer !== undefined) return;
    rec.statusTimer = setTimeout(
      () => {
        rec.statusTimer = undefined;
        const pending = rec.statusPending;
        rec.statusPending = undefined;
        if (pending !== undefined && (rec.state === 'active' || rec.state === 'starting')) {
          this.emitStatus(rec, pending.line);
        }
      },
      Math.max(0, STATUS_MIN_GAP_MS - elapsed),
    );
    rec.statusTimer.unref();
  }

  /** Records the time and whether a band is showing (so a failure can clear it), then calls the UI. */
  private emitStatus(rec: ModRecord, line: ModStatusLine | undefined): void {
    rec.statusLastAt = Date.now();
    rec.hasStatus = line !== undefined;
    this.options.ui.status(rec.mod.manifest.id, line);
  }

  /** One toast per {@link TOAST_MIN_GAP_MS} per mod; the rest are dropped with a `warn` and answered `undefined`. */
  private showToast(rec: ModRecord, message: Extract<WorkerToHost, { type: 'toast' }>): void {
    const id = rec.mod.manifest.id;
    const now = Date.now();
    if (rec.lastToastAt !== 0 && now - rec.lastToastAt < TOAST_MIN_GAP_MS) {
      this.log(rec, 'warn', 'toast dropped: at most one every 2 seconds');
      this.post(rec, { type: 'toast.result', requestId: message.requestId });
      return;
    }
    rec.lastToastAt = now;
    const answer = (action: string | undefined): void => {
      this.post(rec, {
        type: 'toast.result',
        requestId: message.requestId,
        ...(action !== undefined ? { action } : {}),
      });
    };
    this.options.ui
      .toast(id, {
        message: message.message,
        ...(message.severity !== undefined ? { severity: message.severity } : {}),
        ...(message.actions !== undefined ? { actions: message.actions } : {}),
      })
      .then(answer, () => answer(undefined));
  }

  /** Releases the timers, pending commands and band of a mod that is no longer running. */
  private release(rec: ModRecord): void {
    clearInterval(rec.heartbeat);
    clearTimeout(rec.activateTimer);
    clearTimeout(rec.statusTimer);
    rec.statusTimer = undefined;
    rec.statusPending = undefined;
    for (const pending of rec.pendingCommands.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`mod "${rec.mod.manifest.id}" stopped`));
    }
    rec.pendingCommands.clear();
    rec.commands.clear();
    for (const panelId of rec.panels) this.options.panels?.close(rec.mod.manifest.id, panelId);
    rec.panels.clear();
    if (rec.hasStatus) {
      rec.hasStatus = false;
      this.options.ui.status(rec.mod.manifest.id, undefined);
    }
  }

  /** Marks the mod `failed` once, logs one lifecycle line and terminates its Worker. */
  private fail(rec: ModRecord, reason: string): void {
    if (rec.state === 'failed' || rec.state === 'stopped') return;
    rec.state = 'failed';
    rec.error = reason;
    this.release(rec);
    this.options.logLifecycle(`mod ${rec.mod.manifest.id} failed: ${reason}`);
    void this.terminate(rec);
    this.emitChange();
  }

  /** Terminates the Worker; resolves once it is done and never rejects (a dead Worker is fine). */
  private terminate(rec: ModRecord): Promise<void> {
    const worker = rec.worker;
    if (worker === undefined) return Promise.resolve();
    return worker.terminate().then(
      () => undefined,
      () => undefined,
    );
  }

  /**
   * Posts `deactivate` to every running mod, waits `deactivateGraceMs` once (only if some mod is
   * `active`; it waits that long, then goes on whether or not the hooks finished), marks them
   * `stopped` and terminates every Worker. Records are kept so the list still shows `stopped`.
   */
  private async stopAll(): Promise<void> {
    const running = [...this.records.values()].filter(
      (rec) => rec.state === 'starting' || rec.state === 'active',
    );
    for (const rec of running) this.post(rec, { type: 'deactivate' });
    if (running.some((rec) => rec.state === 'active') && this.deactivateGraceMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.deactivateGraceMs));
    }
    await Promise.all(
      [...this.records.values()].map((rec) => {
        if (rec.state === 'starting' || rec.state === 'active') {
          rec.state = 'stopped';
          this.release(rec);
        }
        return this.terminate(rec);
      }),
    );
    this.emitChange();
  }
}
