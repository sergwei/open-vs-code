// Bootstrap that runs INSIDE a mod's `worker_threads.Worker` (E10-mods, plan Engram #1765 sections
// 3.2 and 3.5). The esbuild entry `dist/modWorker.js` is this file; `src/extension/modHost.ts`
// starts one Worker per mod on it (decision P2=1).
//
// What it does: waits for `init`, `import()`s the mod's entry (ESM or CJS), builds the `station`
// object over `parentPort`, calls `activate(station)`, and from then on routes events, commands,
// pings and toast answers. Every call into mod code is wrapped: a throw or a rejected promise
// becomes a `log` error line, never a dead Worker. `uncaughtException` / `unhandledRejection` are
// reported as `error` messages for the same reason.
//
// Boundaries: no `vscode` and no `@opencode/client` here (ESLint forbids both outside
// `src/extension`; VERIFIED by mutation, 02/11/2026: adding `import 'vscode'` to this file made
// `eslint` fail with "'vscode' import is restricted from being used"), so a mod cannot reach them
// through this file. The module is NOT a sandbox: the mod has Node and the user's permissions.

import { parentPort, type MessagePort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import type {
  Disposable,
  ModCommand,
  ModEvent,
  ModEventOf,
  ModEventType,
  ModInfo,
  ModJson,
  ModPanel,
  PanelOptions,
  StationModApi,
} from './api';
import {
  COMMAND_NAME_PATTERN,
  MAX_COMMANDS_PER_MOD,
  MAX_LOG_TEXT,
  MAX_PANELS_PER_MOD,
  isHostToWorker,
  isWorkerToHost,
  type HostToWorker,
  type LogLevel,
  type WorkerToHost,
} from './wire';

type AnyFunction = (this: unknown, ...args: unknown[]) => unknown;

/** Handlers of one open panel (E10-mods phase 4). */
interface PanelEntry {
  messageHandlers: Set<(data: ModJson) => void>;
  closeHandlers: Set<() => void>;
}

/** Text of a thrown value, cut to what the wire accepts. */
function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text === '' ? '(no message)' : text.slice(0, MAX_LOG_TEXT);
}

/** `owner[key]` if it is a function, else `undefined`. */
function pickFunction(owner: unknown, key: string): AnyFunction | undefined {
  if (typeof owner !== 'object' && typeof owner !== 'function') return undefined;
  if (owner === null) return undefined;
  const value: unknown = (owner as Record<string, unknown>)[key];
  return typeof value === 'function' ? (value as AnyFunction) : undefined;
}

/**
 * The object that carries `activate`: the module itself (ESM named export, or a CJS module whose
 * keys `import()` detected) or its `default` (a CJS `module.exports = { activate }`, which
 * `import()` hands over as `default`). `undefined` when neither has it.
 */
function findModuleApi(loaded: unknown): unknown {
  if (pickFunction(loaded, 'activate') !== undefined) return loaded;
  const fallback = (loaded as { default?: unknown } | null)?.default;
  return pickFunction(fallback, 'activate') !== undefined ? fallback : undefined;
}

/**
 * Wires the Worker to `port`: installs the message router and the crash reporters, and returns.
 * Nothing runs until the host sends `init`.
 *
 * A message that fails {@link isHostToWorker} is dropped silently (it can only come from our own
 * host). Handlers of one event type run in registration order, each isolated from the others.
 * Fire-and-forget: the return value of an event handler is awaited only to catch its rejection.
 * VERIFIED by `modHost.test.ts` with a real Worker built from this file (Windows 11,
 * 02/11/2026): "delivers events to a mod that works and lists its commands", "keeps a mod
 * active when a handler throws or rejects, and logs it" and "marks a mod failed when activate
 * throws, and the other mod keeps working".
 */
function startWorker(port: MessagePort): void {
  const handlers = new Map<string, Set<(event: ModEvent) => void | Promise<void>>>();
  const commands = new Map<string, ModCommand>();
  const toasts = new Map<string, (action: string | undefined) => void>();
  let modInfo: ModInfo | undefined;
  let moduleApi: unknown;
  let cleanup: (() => void | Promise<void>) | undefined;
  let nextToast = 0;
  let nextPanel = 0;
  const panels = new Map<string, PanelEntry>();

  /** Sends `message` to the host; throws a `TypeError` when it breaks a limit of the wire. */
  const post = (message: WorkerToHost): void => {
    // Widened to `unknown`: the guard would narrow the failing branch to `never`.
    const candidate: unknown = message;
    if (!isWorkerToHost(candidate)) {
      throw new TypeError(`invalid or oversized "${message.type}" message (see the API limits)`);
    }
    port.postMessage(message);
  };

  /** Like {@link post} for the Worker's own reports, which must never throw. */
  const report = (message: WorkerToHost): void => {
    try {
      post(message);
    } catch {
      // Nothing left to tell the host with.
    }
  };

  const log = (level: LogLevel, text: string): void => {
    report({ type: 'log', level, text: text === '' ? '(empty)' : text.slice(0, MAX_LOG_TEXT) });
  };

  /** Runs `fn` (sync or async); a throw or a rejection is logged as `<label> threw: …`. */
  const guarded = async (label: string, fn: () => unknown): Promise<void> => {
    try {
      await fn();
    } catch (error) {
      log('error', `${label} threw: ${describeError(error)}`);
    }
  };

  /**
   * Opens a panel: checks the per-mod cap, posts `panel.open` (which throws on a bad option, and
   * then nothing is registered) and returns the handle. `finish` is the single exit: it runs the
   * close handlers once, whether the user closed the tab (`panel.closed`) or the mod called
   * `dispose()` (which also tells the host with `panel.close`).
   */
  const openPanel = (options: PanelOptions): ModPanel => {
    if (panels.size >= MAX_PANELS_PER_MOD) {
      throw new TypeError(`a mod can have at most ${MAX_PANELS_PER_MOD} panels open`);
    }
    const panelId = `p${nextPanel + 1}`;
    post({
      type: 'panel.open',
      panelId,
      title: options.title,
      html: options.html,
      ...(options.scripts !== undefined ? { scripts: options.scripts } : {}),
      ...(options.styles !== undefined ? { styles: options.styles } : {}),
    });
    nextPanel += 1; // only after `post` accepted the options, so a refused open burns no id
    const entry: PanelEntry = { messageHandlers: new Set(), closeHandlers: new Set() };
    panels.set(panelId, entry);
    return {
      postMessage: (data) => {
        if (panels.get(panelId) === entry) post({ type: 'panel.message', panelId, data });
      },
      onMessage: (handler) => {
        entry.messageHandlers.add(handler);
        return disposable(() => entry.messageHandlers.delete(handler));
      },
      onDidClose: (handler) => {
        entry.closeHandlers.add(handler);
        return disposable(() => entry.closeHandlers.delete(handler));
      },
      dispose: () => {
        if (panels.get(panelId) !== entry) return;
        report({ type: 'panel.close', panelId });
        finishPanel(panelId);
      },
    };
  };

  /** Forgets panel `panelId` and runs its close handlers once, each isolated. No-op if unknown. */
  const finishPanel = (panelId: string): void => {
    const entry = panels.get(panelId);
    if (entry === undefined) return;
    panels.delete(panelId);
    for (const handler of entry.closeHandlers) void guarded('panel close handler', handler);
  };

  const disposable = (dispose: () => void): Disposable => {
    let done = false;
    return {
      dispose: () => {
        if (done) return;
        done = true;
        dispose();
      },
    };
  };

  const createStation = (mod: ModInfo): StationModApi => ({
    apiVersion: 1,
    mod: Object.freeze({ ...mod }),
    log: {
      info: (text) => log('info', String(text)),
      warn: (text) => log('warn', String(text)),
      error: (text) => log('error', String(text)),
    },
    events: {
      on: <T extends ModEventType>(
        type: T,
        handler: (event: ModEventOf<T>) => void | Promise<void>,
      ): Disposable => {
        const set = handlers.get(type) ?? new Set();
        const wrapped = handler as (event: ModEvent) => void | Promise<void>;
        set.add(wrapped);
        handlers.set(type, set);
        return disposable(() => set.delete(wrapped));
      },
    },
    commands: {
      register: (command) => {
        if (!COMMAND_NAME_PATTERN.test(command.name)) {
          throw new TypeError('command name must match ^[a-z0-9][a-z0-9-]{0,47}$');
        }
        if (commands.has(command.name)) {
          throw new TypeError(`command "${command.name}" is already registered`);
        }
        if (commands.size >= MAX_COMMANDS_PER_MOD) {
          throw new TypeError(`a mod can register at most ${MAX_COMMANDS_PER_MOD} commands`);
        }
        post({
          type: 'command.add',
          name: command.name,
          ...(command.description !== undefined ? { description: command.description } : {}),
        });
        commands.set(command.name, command);
        return disposable(() => {
          commands.delete(command.name);
          report({ type: 'command.remove', name: command.name });
        });
      },
    },
    ui: {
      status: {
        set: (options) => {
          post({
            type: 'status.set',
            text: options.text,
            ...(options.tooltip !== undefined ? { tooltip: options.tooltip } : {}),
            ...(options.severity !== undefined ? { severity: options.severity } : {}),
            ...(options.command !== undefined ? { command: options.command } : {}),
          });
        },
        clear: () => post({ type: 'status.clear' }),
      },
      toast: (options) =>
        new Promise<string | undefined>((resolve, reject) => {
          const requestId = `t${(nextToast += 1)}`;
          toasts.set(requestId, resolve);
          try {
            post({
              type: 'toast',
              requestId,
              message: options.message,
              ...(options.severity !== undefined ? { severity: options.severity } : {}),
              ...(options.actions !== undefined ? { actions: options.actions } : {}),
            });
          } catch (error) {
            toasts.delete(requestId);
            reject(error instanceof Error ? error : new Error(describeError(error)));
          }
        }),
      panel: { open: openPanel },
    },
    chat: {
      compose: (options) =>
        post({
          type: 'compose',
          text: options.text,
          ...(options.send !== undefined ? { send: options.send } : {}),
        }),
    },
  });

  const init = async (message: Extract<HostToWorker, { type: 'init' }>): Promise<void> => {
    try {
      modInfo = message.mod;
      // `pathToFileURL`: a bare Windows path (`C:\…`) is not a valid import specifier.
      const loaded: unknown = await import(pathToFileURL(message.entry).href);
      moduleApi = findModuleApi(loaded);
      const activate = pickFunction(moduleApi, 'activate');
      if (activate === undefined) throw new Error('the entry file exports no activate() function');
      const result = await activate.call(moduleApi, createStation(modInfo));
      if (typeof result === 'function') cleanup = result as () => void | Promise<void>;
      post({ type: 'ready' });
    } catch (error) {
      report({ type: 'failed', message: describeError(error) });
    }
  };

  const runCommand = async (
    message: Extract<HostToWorker, { type: 'command.run' }>,
  ): Promise<void> => {
    const command = commands.get(message.name);
    if (command === undefined) {
      report({ type: 'command.done', requestId: message.requestId, error: 'unknown command' });
      return;
    }
    try {
      await command.run({
        args: message.args,
        ...(message.sessionID !== undefined ? { sessionID: message.sessionID } : {}),
      });
      report({ type: 'command.done', requestId: message.requestId });
    } catch (error) {
      report({ type: 'command.done', requestId: message.requestId, error: describeError(error) });
    }
  };

  const deactivate = async (): Promise<void> => {
    if (cleanup !== undefined) await guarded('cleanup', cleanup);
    const hook = pickFunction(moduleApi, 'deactivate');
    if (hook !== undefined) await guarded('deactivate()', () => hook.call(moduleApi));
    handlers.clear();
    commands.clear();
    panels.clear();
  };

  port.on('message', (raw: unknown) => {
    if (!isHostToWorker(raw)) return;
    switch (raw.type) {
      case 'init':
        void init(raw);
        break;
      case 'ping':
        report({ type: 'pong', n: raw.n });
        break;
      case 'event': {
        const event = raw.event;
        for (const handler of handlers.get(event.type) ?? []) {
          void guarded(`handler for ${event.type}`, () => handler(event));
        }
        break;
      }
      case 'command.run':
        void runCommand(raw);
        break;
      case 'toast.result': {
        const resolve = toasts.get(raw.requestId);
        toasts.delete(raw.requestId);
        resolve?.(raw.action);
        break;
      }
      case 'panel.message': {
        const entry = panels.get(raw.panelId);
        const data = raw.data;
        for (const handler of entry?.messageHandlers ?? []) {
          void guarded('panel message handler', () => handler(data));
        }
        break;
      }
      case 'panel.closed':
        finishPanel(raw.panelId);
        break;
      case 'deactivate':
        void deactivate();
        break;
    }
  });

  process.on('uncaughtException', (error) => {
    report({ type: 'error', message: `uncaught exception: ${describeError(error)}` });
  });
  process.on('unhandledRejection', (reason) => {
    report({ type: 'error', message: `unhandled rejection: ${describeError(reason)}` });
  });
}

if (parentPort !== null) startWorker(parentPort);
