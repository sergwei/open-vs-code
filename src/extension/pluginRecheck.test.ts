// Tests of the plugin re-check of issue #158. SYNTHETIC: a fake timer and fake `check`, `restart`
// and `isRunning`; they pin the timing and cancellation rules of `pluginRecheck.ts`, not that VS
// Code raises file events nor that opencode ignores the new plugin (the `project-plugins` and
// `real-opencode` integration cases are for that).

import { describe, expect, it, vi } from 'vitest';
import type { ServerLog } from './opencodeServer';
import { createPluginRecheck } from './pluginRecheck';

const FOLDER = '/work/project';

/** A controllable `check`: each call waits until the test settles it. */
function manualCheck() {
  const pending: Array<{ resolve(value: boolean): void; reject(error: Error): void }> = [];
  const check = vi.fn(
    (_folder: string) =>
      new Promise<boolean>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { check, pending };
}

/** Builds the re-check over fakes; `fire()` runs the timers that were not cancelled. */
function harness(overrides: { check?: (folder: string) => Promise<boolean>; running?: boolean }) {
  const timers: Array<{ run: () => void; cancelled: boolean }> = [];
  const lines: string[] = [];
  const log: ServerLog = {
    info: (m) => lines.push(`info ${m}`),
    warn: (m) => lines.push(`warn ${m}`),
    error: (m) => lines.push(`error ${m}`),
    debug: () => undefined,
  };
  const restart = vi.fn(() => Promise.resolve('attempted'));
  const check = vi.fn(overrides.check ?? (() => Promise.resolve(false)));
  const isRunning = vi.fn((_folder: string) => overrides.running ?? true);
  const recheck = createPluginRecheck({
    check,
    restart,
    isRunning,
    log,
    schedule: (run) => {
      const timer = { run, cancelled: false };
      timers.push(timer);
      return {
        cancel: () => {
          timer.cancelled = true;
        },
      };
    },
  });
  const fire = (): void => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run();
  };
  return { recheck, check, restart, isRunning, lines, fire, timers };
}

/** Lets the promise continuations of the module run. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('createPluginRecheck', () => {
  /** r1: the check on `start` finds plugins to review, so the server restarts with the logged reason. */
  it('start with a folder that needs review restarts it', async () => {
    const h = harness({ check: () => Promise.resolve(true) });
    h.recheck.start(FOLDER);
    await flush();
    expect(h.check).toHaveBeenCalledWith(FOLDER);
    expect(h.restart).toHaveBeenCalledTimes(1);
    expect(h.lines).toContain(
      `warn project plugins changed while the server runs in ${FOLDER}; restarting so they are reviewed (opencode's file watcher is off, so it has not loaded them)`,
    );
  });

  /** r2: nothing to review (allowed, or no plugins) never restarts. */
  it('start with a folder that needs no review does not restart', async () => {
    const h = harness({ check: () => Promise.resolve(false) });
    h.recheck.start(FOLDER);
    await flush();
    expect(h.check).toHaveBeenCalledTimes(1);
    expect(h.restart).not.toHaveBeenCalled();
  });

  /** r3: a burst of file events is one check, run when the timer fires. */
  it('five pokes in a burst make one check', async () => {
    const h = harness({});
    h.recheck.start(FOLDER);
    await flush();
    h.check.mockClear();
    for (let i = 0; i < 5; i += 1) h.recheck.poke();
    h.fire();
    await flush();
    expect(h.check).toHaveBeenCalledTimes(1);
  });

  /** r4: `stop` before the timer fires means the check never happens. */
  it('stop with the timer pending runs no check', async () => {
    const h = harness({});
    h.recheck.start(FOLDER);
    await flush();
    h.check.mockClear();
    h.recheck.poke();
    h.recheck.stop();
    h.fire();
    await flush();
    expect(h.check).not.toHaveBeenCalled();
  });

  /**
   * r5: the check already left when `stop` ran (a timer cannot cancel it), and its answer arrives
   * later. Protects the generation comparison after the `await`: without it the restart goes out
   * for a server that is no longer the one that was looked at. Mutation (see the report of the
   * implementation): removing the comparison turns this case red.
   */
  it('stop during a check that then says yes does not restart', async () => {
    const { check, pending } = manualCheck();
    const h = harness({ check });
    h.recheck.start(FOLDER);
    await flush();
    expect(pending).toHaveLength(1);
    h.recheck.stop();
    pending[0]?.resolve(true);
    await flush();
    expect(h.restart).not.toHaveBeenCalled();
    expect(h.lines).toEqual([]);
  });

  /** r6: the server stopped running while the folder was being scanned, so nothing restarts it. */
  it('a server that stopped running during the check is not restarted', async () => {
    const h = harness({ check: () => Promise.resolve(true), running: false });
    h.recheck.start(FOLDER);
    await flush();
    expect(h.isRunning).toHaveBeenCalledWith(FOLDER);
    expect(h.restart).not.toHaveBeenCalled();
  });

  /** r7: pokes while a check runs leave one repeat, which sees the later state of the folder. */
  it('a poke during a check makes exactly one repeat', async () => {
    const { check, pending } = manualCheck();
    const h = harness({ check });
    h.recheck.start(FOLDER);
    await flush();
    h.recheck.poke();
    h.recheck.poke();
    h.recheck.poke();
    expect(h.timers).toHaveLength(0);
    pending[0]?.resolve(false);
    await flush();
    expect(check).toHaveBeenCalledTimes(2);
    pending[1]?.resolve(false);
    await flush();
    expect(check).toHaveBeenCalledTimes(2);
  });

  /** r8: a scan that throws fails closed: it is logged and the server restarts to be reviewed. */
  it('a check that fails is logged and restarts', async () => {
    const h = harness({ check: () => Promise.reject(new Error('EACCES')) });
    h.recheck.start(FOLDER);
    await flush();
    expect(h.lines.some((line) => line.startsWith('error ') && line.includes('EACCES'))).toBe(true);
    expect(h.restart).toHaveBeenCalledTimes(1);
  });
});
