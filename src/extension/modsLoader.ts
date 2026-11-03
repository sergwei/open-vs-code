// The serialized "discover and start the mods" loop of `modsLifecycle.ts`, plus the flag that makes
// every log write a no-op once the extension is shutting down (E10-mods-hardening, plan Engram
// #1863 section 2b, decision "symlink-y-apagado" option 1). PURE: no `vscode` import, so Vitest
// drives it with a fabricated host and fabricated discovery (`modsLoader.test.ts`).
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

import type { DiscoveryProblem, DiscoveryResult } from './modDiscovery';
import type { ModHost } from './modHost';

/** What {@link createModsLoader} needs from the rest of the extension. */
export interface ModsLoaderDeps {
  /** Reads the `openVsCode.mods.enabled` switch. */
  readEnabled(): boolean;
  /** Finds the mods on disk; may reject (the loader logs it and goes on). */
  discover(): Promise<DiscoveryResult>;
  /** Only the two methods the loader calls, so a test can fabricate them. */
  host: Pick<ModHost, 'reload' | 'dispose'>;
  /** The main log. Never called after `dispose`. */
  log: (level: 'info' | 'warn' | 'error', text: string) => void;
}

/** What {@link createModsLoader} gives back. */
export interface ModsLoader {
  /**
   * Discovers and starts the mods, or stops them all when the switch is off. Loads run one after
   * another (a reload while one runs waits for it), so two quick setting changes cannot leave two
   * generations of Workers. Never rejects: a load that fails is logged (unless disposed) and the
   * next one still runs. Does nothing, logs nothing and creates no Worker once disposed.
   */
  load: () => Promise<void>;
  /** The folders the last load refused, for Manage Mods and the test state command. */
  problems(): readonly DiscoveryProblem[];
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
 * (`.catch` on the chain), so a `log` that throws cannot block later loads.
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
 */
export function createModsLoader(deps: ModsLoaderDeps): ModsLoader {
  let disposed = false;
  let problems: readonly DiscoveryProblem[] = [];
  const guard = <A extends unknown[]>(write: (...args: A) => void): ((...args: A) => void) => {
    return (...args) => {
      if (!disposed) write(...args);
    };
  };
  const log = guard(deps.log);

  const run = async (): Promise<void> => {
    if (disposed) return;
    try {
      if (!deps.readEnabled()) {
        problems = [];
        await deps.host.reload([]);
        log('info', 'mods are turned off (openVsCode.mods.enabled)');
        return;
      }
      const found = await deps.discover();
      if (disposed) return;
      problems = found.problems;
      for (const problem of found.problems) {
        log('warn', `mod folder ${problem.folder} skipped: ${problem.reason}`);
      }
      await deps.host.reload(found.mods);
    } catch (error) {
      if (disposed) return;
      log(
        'error',
        `could not load mods: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  let chain: Promise<void> = Promise.resolve();
  return {
    load: () => {
      chain = chain.then(run).catch(() => undefined);
      return chain;
    },
    problems: () => problems,
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
