// The serialized "discover and start the mods" loop of `modsLifecycle.ts`, plus the flag that makes
// every log write a no-op once the extension is shutting down (E10-mods-hardening, plan Engram
// #1863 section 2b, decision "symlink-y-apagado" option 1), plus the per-mod switch queue
// (E10-mod-toggles, issue #181, plan Engram #1995). PURE: no `vscode` import, so Vitest drives it
// with a fabricated host and fabricated discovery (`modsLoader.test.ts`).
//
// Why it exists: VS Code releases `context.subscriptions` (the "OpenCode Mods" channel among them)
// in the same tick as it calls `deactivate()`, without awaiting what `deactivate()` returns, and a
// released `LogOutputChannel` THROWS `Channel has been closed` on `info`/`warn`/`error`. A load
// that is still awaiting discovery, or a Worker that logs during its 250 ms grace, would then throw
// inside code nobody catches, and a rejected load would also leave the chain rejected forever.
// READ, not run, in VS Code 1.105.0 (`extHostOutput.ts` `validate()` and
// `extHostExtensionService.ts` `_deactivate`): the race itself is UNVERIFIED in a real extension
// host, because an integration suite cannot deactivate the extension in the middle of a run.
//
// A plain flag, not a generation counter (`vscode-extension` section 5, "cancelar-timer-no-cancela-
// await"): a generation is for a cancellation that re-arms (cancel and launch again). Here `dispose`
// is terminal and loads already run one at a time, so no old load competes with a new one. What is
// taken from that lesson is the rule: the flag is read after EVERY `await`, the `catch` included.
//
// Loads and toggles share ONE queue (`chain`), so a toggle never overlaps a load or another toggle,
// and the read-compute-write of the disabled list cannot interleave.

import type { DiscoveredMod, DiscoveryProblem, DiscoveryResult } from './modDiscovery';
import type { ModHost } from './modHost';
import { withToggled } from './modToggles';

/** What {@link createModsLoader} needs from the rest of the extension. */
export interface ModsLoaderDeps {
  /** Reads the `openVsCode.mods.enabled` switch. */
  readEnabled(): boolean;
  /** Finds the mods on disk; may reject (the loader logs it and goes on). */
  discover(): Promise<DiscoveryResult>;
  /** Only the methods the loader calls, so a test can fabricate them. */
  host: Pick<ModHost, 'reload' | 'dispose' | 'stopMod' | 'start'>;
  /** The ids the user switched off in this workspace (a fresh read each call). */
  readDisabled(): readonly string[];
  /** Replaces that list; `undefined` clears it. May reject (the toggle logs it and rejects). */
  writeDisabled(list: string[] | undefined): Promise<void>;
  /** False in a window with no folder, where the list only lasts until the window closes. */
  persisted: boolean;
  /** The main log. Never called after `dispose`. */
  log: (level: 'info' | 'warn' | 'error', text: string) => void;
}

/** One mod found on disk, as far as the listing needs it. */
export interface ModsInventoryMod {
  id: string;
  name: string;
  version: string;
  description?: string;
}

/** What the last discovery found plus the user's switches; the input of the mods listing. */
export interface ModsInventory {
  /** The machine-wide `openVsCode.mods.enabled` switch. */
  enabled: boolean;
  persisted: boolean;
  mods: ModsInventoryMod[];
  skipped: DiscoveryProblem[];
  /** The ids switched off in this workspace. */
  disabled: string[];
}

/** What {@link createModsLoader} gives back. */
export interface ModsLoader {
  /**
   * Discovers the mods (also when the global switch is off, so the listing still shows them) and
   * starts those not switched off in this workspace, or, with the global switch off, stops them
   * all and starts none. Loads run one after
   * another (a reload while one runs waits for it), so two quick setting changes cannot leave two
   * generations of Workers. Never rejects: a load that fails is logged (unless disposed) and the
   * next one still runs. Does nothing, logs nothing and creates no Worker once disposed.
   */
  load: () => Promise<void>;
  /**
   * Switches ONE mod on or off for this workspace: writes the list, tells the listeners, and, with
   * the global switch on, stops (`stopMod`) or starts (`start([mod])`) only that mod. Queued behind
   * any load or toggle in progress. Rejects ONLY when `writeDisabled` fails (the choice was not
   * saved, so the caller must tell the user; the chain stays usable); a failure of the stop or
   * start afterwards is logged and resolves. Resolves quietly after dispose.
   */
  toggle: (id: string, enabled: boolean) => Promise<void>;
  /** The folders the last load refused, for Manage Mods and the test state command. */
  problems(): readonly DiscoveryProblem[];
  /** The last discovery and the switches, read fresh; empty before the first discovery ends. */
  inventory(): ModsInventory;
  /** Subscribes to changes of {@link ModsLoader.inventory}; returns the unsubscribe. */
  onDidChange(listener: () => void): { dispose(): void };
  /** True from the first instant of {@link ModsLoader.dispose}. */
  readonly disposed: boolean;
  /**
   * Wraps a log writer so it does nothing once disposed. Use it for every writer of a channel that
   * is released on deactivate, not only the loader's own: the mods channel (VS Code releases it
   * with the subscriptions) and the main log (released in the `finally` of `deactivate`).
   */
  guard<A extends unknown[]>(write: (...args: A) => void): (...args: A) => void;
  /** Sets the flag synchronously, then waits for `host.dispose()` (graceful stop of every Worker). */
  dispose(): Promise<void>;
}

/**
 * Builds the loader.
 *
 * `run` reads the flag before it starts, after `discover` (it would otherwise log the problems and
 * call `reload`) and in the `catch`; the `log` that follows `reload([])` needs no check of its own
 * because every `log` goes through {@link ModsLoader.guard}. The chain recovers from a rejection
 * (`.catch` on the chain), so a `log` that throws cannot block later loads. `run` ALWAYS
 * discovers, also with the global switch off (it only reads `mod.json`, never runs code), publishes
 * the result to {@link ModsLoader.onDidChange} BEFORE `host.reload` so the listing is already fresh
 * when `reload` emits, and hands `reload` only the mods that are not in the disabled list (or none,
 * with the global switch off). `toggle` reads the flag after `writeDisabled` and again in its
 * `catch`. A failed `writeDisabled` is logged and REJECTS the toggle (the controller then answers
 * a `notice` to the panel that asked; VERIFIED by "a toggle whose write rejects logs the failure,
 * rejects, and leaves the queue usable", fabricated host); a failure of `stopMod` or `start` is
 * only logged. Once the list is saved it logs `mod <id> switched on|off in this workspace|window`
 * (a window with no folder says `window`; VERIFIED by "a toggle off stops only that mod, and a
 * toggle on starts only that one" and "a toggle in a window with no folder logs "in this
 * window"", fabricated host; the second went red with the `window` branch changed to
 * `workspace`, then the change was reverted). `load` never rejects.
 * VERIFIED (Windows 11, Vitest, 03/11/2026, fabricated host and discovery: it proves the guard
 * logic, not VS Code's disposal order) by mutation. Without the check after `discover`, the tests
 * "T1: a discovery that ends after dispose logs nothing and starts nothing" and "T4: a load queued
 * behind another never discovers once disposed" fail (by timeout: the fake `reload` never
 * settles). With the `catch` writing through `deps.log`, "T3: a discovery that fails after dispose
 * logs no error and does not reject" fails. Without the chain's `.catch`, "T5: a load whose logs
 * throw (the warn and the error line) does not break the chain" fails. With `guard` not reading
 * the flag, "T6: guard calls the writer before dispose and not after" and "T2: a stop that ends
 * after dispose does not log "mods are turned off"" fail. A check after `reload([])` was tried and
 * removed: its mutation turned no test red, since the guarded `log` already covers it.
 * VERIFIED for the toggles (Windows 11, Vitest, 07/11/2026, same fabricated host) by mutation, each
 * applied, seen red and reverted: L1 without chaining `toggle` on `chain` fails "L1: a toggle
 * queued behind a load runs after it"; L3 without the flag read after `writeDisabled` fails "L3: a
 * toggle whose write ends after dispose stops and starts nothing"; L4 without the `readEnabled`
 * check fails "L4: a toggle with mods turned off writes the list, notifies and touches no Worker";
 * L8 publishing after `reload` fails "L8: the listing is published before reload emits". The
 * ordering of L2 and the discovery rules of L5-L7 are covered by their own cases, not by a mutation.
 */
export function createModsLoader(deps: ModsLoaderDeps): ModsLoader {
  let disposed = false;
  let discovered: DiscoveryResult | undefined;
  const listeners = new Set<() => void>();
  const guard = <A extends unknown[]>(write: (...args: A) => void): ((...args: A) => void) => {
    return (...args) => {
      if (!disposed) write(...args);
    };
  };
  const log = guard(deps.log);
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const run = async (): Promise<void> => {
    if (disposed) return;
    try {
      const found = await deps.discover();
      if (disposed) return;
      discovered = found;
      notify();
      for (const problem of found.problems) {
        log('warn', `mod folder ${problem.folder} skipped: ${problem.reason}`);
      }
      if (!deps.readEnabled()) {
        await deps.host.reload([]);
        log('info', 'mods are turned off (openVsCode.mods.enabled)');
        return;
      }
      const off = new Set(deps.readDisabled());
      await deps.host.reload(found.mods.filter((mod) => !off.has(mod.manifest.id)));
    } catch (error) {
      if (disposed) return;
      log(
        'error',
        `could not load mods: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const runToggle = async (id: string, enabled: boolean): Promise<void> => {
    if (disposed) return;
    try {
      await deps.writeDisabled(withToggled(deps.readDisabled(), id, enabled));
    } catch (error) {
      if (disposed) return;
      log(
        'error',
        `could not switch mod ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    try {
      if (disposed) return;
      // A stable line (no paths) so a test can tell "the switch reached the host" from "the host
      // never answered" (review 2, W-A).
      log(
        'info',
        `mod ${id} switched ${enabled ? 'on' : 'off'} in this ${deps.persisted ? 'workspace' : 'window'}`,
      );
      notify();
      if (!deps.readEnabled()) return;
      if (!enabled) {
        await deps.host.stopMod(id);
        return;
      }
      const mod: DiscoveredMod | undefined = discovered?.mods.find((m) => m.manifest.id === id);
      if (mod === undefined) {
        log('warn', `mod ${id} is no longer in the mods folder; Reload Mods picks up the change`);
        return;
      }
      deps.host.start([mod]);
    } catch (error) {
      if (disposed) return;
      log(
        'error',
        `could not switch mod ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  let chain: Promise<void> = Promise.resolve();
  // The chain itself never rejects; the caller gets the work's own promise.
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    const result = chain.then(work);
    chain = result.catch(() => undefined);
    return result;
  };
  return {
    load: () => enqueue(run).catch(() => undefined),
    toggle: (id, enabled) => enqueue(() => runToggle(id, enabled)),
    problems: () => discovered?.problems ?? [],
    inventory: () => ({
      enabled: deps.readEnabled(),
      persisted: deps.persisted,
      mods: (discovered?.mods ?? []).map(({ manifest }) => ({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        ...(manifest.description !== undefined ? { description: manifest.description } : {}),
      })),
      skipped: [...(discovered?.problems ?? [])],
      disabled: [...deps.readDisabled()],
    }),
    onDidChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    get disposed() {
      return disposed;
    },
    guard,
    dispose: async () => {
      disposed = true;
      await deps.host.dispose();
    },
  };
}
