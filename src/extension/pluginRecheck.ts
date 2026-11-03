// Re-checks the plugins of the served folder while the server runs (issue #158) and restarts the
// server when they need the user's review. Pure: no `vscode` import. `pluginConsentUi.ts`
// (`watchServedPlugins`) owns the file watcher and the manager and feeds this with `start` /
// `poke` / `stop`; the scan, the stored decision and the restart come in as callbacks, so the
// timing rules below are tested with a fake clock (`pluginRecheck.test.ts`).

import type { ServerLog } from './opencodeServer';

/** How long a burst of file events is allowed to settle before the folder is scanned (ms). */
export const RECHECK_DEBOUNCE_MS = 300;

/** What {@link createPluginRecheck} needs from the rest of the extension. */
export interface PluginRecheckOptions {
  /** Scans the folder and says whether its plugins need the user's review (`needsReview`). */
  check(folder: string): Promise<boolean>;
  /** `manager.restart('plugins-changed')`: goes through the launch guard as `userAsked: false`. */
  restart(): Promise<unknown>;
  /** True while the manager still has `folder`'s own server running. */
  isRunning(folder: string): boolean;
  log: ServerLog;
  /** Timer seam for tests: runs `run` once after `ms` unless the returned handle is cancelled. */
  schedule?: (run: () => void, ms: number) => { cancel(): void };
  debounceMs?: number;
}

/** The three calls of the re-check; `start` and `stop` bracket one `running` period of a server. */
export interface PluginRecheck {
  /** Begins a period for `folder` and checks at once (a plugin may have arrived during `starting`). */
  start(folder: string): void;
  /** A file event in the folder: checks once the burst is over, or once more after a check in flight. */
  poke(): void;
  /** Ends the period: cancels the timer and makes every check still in flight inert. */
  stop(): void;
}

/**
 * Builds the re-check: after `start(folder)` and after each `poke()` it asks `check(folder)` and,
 * if the plugins need review and the server is still running, logs why and calls `restart()`.
 *
 * Why it restarts instead of only asking: opencode runs with its file watcher off
 * (`buildServeEnv`, #158), so a plugin that arrived has NOT been loaded and the restart, which goes
 * through the consent guard of #153 with `userAsked: false`, is the moment the user is asked. A
 * `check` that rejects counts as "needs review" (fails closed, logged): the restart then scans
 * again on its own and is the one that decides.
 *
 * Timing rules: pokes inside `debounceMs` of each other make one check; a poke while a check runs
 * leaves exactly one repeat, however many arrive (the folder may have changed after the scan
 * started); `stop()` cancels the timer AND bumps a generation counter that every continuation
 * compares after each `await`, because `clearTimeout` does not cancel a check that already left
 * (vscode-extension skill, section 5): without the counter a check in flight at `stop()` would
 * still restart a server that is no longer the one it looked at. A restart is attempted only if
 * `isRunning(folder)` is still true after the check.
 *
 * The 300 ms debounce is our own choice (HYPOTHESIS: no measurement behind it; the integration
 * case I3 only needs it to be well under its 15 s wait). VERIFIED by `pluginRecheck.test.ts`, with
 * a fake timer and fake callbacks (synthetic: it proves the timing rules, not that VS Code raises
 * the events): the checks "start with a folder that needs review restarts it", "five pokes in a
 * burst make one check", "stop with the timer pending runs no check", "stop during a check that
 * then says yes does not restart" (fails when the generation comparison is removed), "a poke during
 * a check makes exactly one repeat" and "a check that fails is logged and restarts".
 */
export function createPluginRecheck(options: PluginRecheckOptions): PluginRecheck {
  const debounceMs = options.debounceMs ?? RECHECK_DEBOUNCE_MS;
  const schedule =
    options.schedule ??
    ((run: () => void, ms: number) => {
      const handle = setTimeout(run, ms);
      return { cancel: () => clearTimeout(handle) };
    });
  let folder: string | undefined;
  let generation = 0;
  let timer: { cancel(): void } | undefined;
  let inFlight = false;
  let repeat = false;

  const cancelTimer = (): void => {
    timer?.cancel();
    timer = undefined;
  };

  const run = async (forFolder: string, gen: number): Promise<void> => {
    inFlight = true;
    let needsReview: boolean;
    try {
      needsReview = await options.check(forFolder);
    } catch (error) {
      if (gen !== generation) return;
      options.log.error(
        `checking the plugins of ${forFolder} failed (${error instanceof Error ? error.message : String(error)}); restarting so they are reviewed`,
      );
      needsReview = true;
    }
    if (gen !== generation) return;
    inFlight = false;
    if (needsReview) {
      repeat = false;
      if (!options.isRunning(forFolder)) return;
      options.log.warn(
        `project plugins changed while the server runs in ${forFolder}; restarting so they are reviewed (opencode's file watcher is off, so it has not loaded them)`,
      );
      try {
        await options.restart();
      } catch (error) {
        options.log.error(
          `restart for the changed plugins failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }
    if (repeat) {
      repeat = false;
      await run(forFolder, gen);
    }
  };

  return {
    start(next) {
      generation += 1;
      cancelTimer();
      inFlight = false;
      repeat = false;
      folder = next;
      void run(next, generation);
    },
    poke() {
      if (folder === undefined) return;
      if (inFlight) {
        repeat = true;
        return;
      }
      cancelTimer();
      const forFolder = folder;
      const gen = generation;
      timer = schedule(() => {
        timer = undefined;
        if (gen === generation) void run(forFolder, gen);
      }, debounceMs);
    },
    stop() {
      generation += 1;
      cancelTimer();
      inFlight = false;
      repeat = false;
      folder = undefined;
    },
  };
}
