// Tests for `modsLoader.ts` (E10-mods-hardening).
//
// What they protect: that a load or a log write that arrives after `ModsRegistration.dispose()`
// writes to no channel, rejects nothing and creates no Worker, and that a load that fails does not
// block the next ones (a rejected chain stayed rejected forever before). The cases come from the
// plan (Engram #1863 section 2b), not from a failure seen in a real extension host.
// The host and the discovery are FABRICATED with promises the test resolves by hand: this proves
// the guard logic, not VS Code's disposal order (read in VS Code 1.105.0, never run).

import { describe, expect, it } from 'vitest';
import type { DiscoveryResult } from './modDiscovery';
import { createModsLoader } from './modsLoader';

/** A promise the test settles by hand. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const PROBLEMS: DiscoveryResult = {
  root: '/mods',
  mods: [],
  problems: [{ folder: 'broken', reason: 'no mod.json' }],
};

/** A loader over a fabricated host; `calls` records what reached the host and the log. */
function setup(options: { enabled?: boolean } = {}) {
  const calls = { discover: 0, reload: [] as unknown[], dispose: 0, logs: [] as string[] };
  const discoveries: ReturnType<typeof deferred<DiscoveryResult>>[] = [];
  const reloads: ReturnType<typeof deferred<void>>[] = [];
  let logThrows = 0;
  const loader = createModsLoader({
    readEnabled: () => options.enabled ?? true,
    discover: () => {
      calls.discover += 1;
      const next = deferred<DiscoveryResult>();
      discoveries.push(next);
      return next.promise;
    },
    host: {
      reload: (mods) => {
        calls.reload.push(mods);
        const next = deferred<void>();
        reloads.push(next);
        return next.promise;
      },
      dispose: () => {
        calls.dispose += 1;
        return Promise.resolve();
      },
    },
    log: (level, text) => {
      if (logThrows > 0) {
        logThrows -= 1;
        throw new Error('Channel has been closed');
      }
      calls.logs.push(`${level}: ${text}`);
    },
  });
  return {
    loader,
    calls,
    discoveries,
    reloads,
    /** The next `times` writes throw, like a released channel. */
    makeLogThrow: (times: number) => {
      logThrows = times;
    },
  };
}

/** Lets the pending microtasks of the loader run. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createModsLoader', () => {
  it('T1: a discovery that ends after dispose logs nothing and starts nothing', async () => {
    const t = setup();
    const load = t.loader.load();
    await tick();
    const disposing = t.loader.dispose();
    t.discoveries[0]?.resolve(PROBLEMS);
    await load;
    await disposing;
    expect(t.calls.logs).toEqual([]);
    expect(t.calls.reload).toEqual([]);
  });

  it('T2: a stop that ends after dispose does not log "mods are turned off"', async () => {
    const t = setup({ enabled: false });
    const load = t.loader.load();
    await tick();
    const disposing = t.loader.dispose();
    t.reloads[0]?.resolve();
    await load;
    await disposing;
    expect(t.calls.reload).toEqual([[]]);
    expect(t.calls.logs).toEqual([]);
  });

  it('T3: a discovery that fails after dispose logs no error and does not reject', async () => {
    const t = setup();
    const load = t.loader.load();
    await tick();
    const disposing = t.loader.dispose();
    t.discoveries[0]?.reject(new Error('EACCES'));
    await expect(load).resolves.toBeUndefined();
    await disposing;
    expect(t.calls.logs).toEqual([]);
  });

  it('T4: a load queued behind another never discovers once disposed', async () => {
    const t = setup();
    const first = t.loader.load();
    const second = t.loader.load();
    await tick();
    const disposing = t.loader.dispose();
    t.discoveries[0]?.resolve(PROBLEMS);
    await Promise.all([first, second, disposing]);
    expect(t.calls.discover).toBe(1);
    expect(t.calls.logs).toEqual([]);
  });

  it('T5: a load whose logs throw (the warn and the error line) does not break the chain', async () => {
    const t = setup();
    t.makeLogThrow(2);
    const first = t.loader.load();
    await tick();
    t.discoveries[0]?.resolve(PROBLEMS); // the warn throws, the catch's error line throws too
    await expect(first).resolves.toBeUndefined();
    const second = t.loader.load();
    await tick();
    expect(t.calls.discover).toBe(2);
    t.discoveries[1]?.resolve({ root: '/mods', mods: [], problems: [] });
    await tick();
    t.reloads[0]?.resolve();
    await second;
  });

  it('T6: guard calls the writer before dispose and not after', async () => {
    const t = setup();
    const written: string[] = [];
    const write = t.loader.guard((text: string) => {
      written.push(text);
    });
    write('before');
    expect(t.loader.disposed).toBe(false);
    await t.loader.dispose();
    write('after');
    expect(t.loader.disposed).toBe(true);
    expect(written).toEqual(['before']);
  });

  it('T7: the normal path logs the problems, starts the mods and exposes the problems', async () => {
    const t = setup();
    const load = t.loader.load();
    await tick();
    t.discoveries[0]?.resolve(PROBLEMS);
    await tick();
    t.reloads[0]?.resolve();
    await load;
    expect(t.calls.logs).toEqual(['warn: mod folder broken skipped: no mod.json']);
    expect(t.calls.reload).toEqual([PROBLEMS.mods]);
    expect(t.loader.problems()).toEqual(PROBLEMS.problems);
  });
});
