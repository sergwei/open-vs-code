// Tests for `modsLoader.ts` (E10-mods-hardening; the per-mod switch of E10-mod-toggles, issue #181).
//
// What they protect: that a load or a log write that arrives after `ModsRegistration.dispose()`
// writes to no channel, rejects nothing and creates no Worker, and that a load that fails does not
// block the next ones (a rejected chain stayed rejected forever before). The cases come from the
// plan (Engram #1863 section 2b), not from a failure seen in a real extension host. L1-L8 (plan
// Engram #1995 section 6) protect the per-mod switch: a toggle never overlaps a load, a disabled
// mod is discovered but never started, and the listing is fresh before `reload` emits.
// The host and the discovery are FABRICATED with promises the test resolves by hand: this proves
// the guard logic, not VS Code's disposal order (read in VS Code 1.105.0, never run).
// MUTATIONS of L1, L3, L4 and L8 are listed in the header of `createModsLoader`.

import { describe, expect, it } from 'vitest';
import type { DiscoveredMod, DiscoveryResult } from './modDiscovery';
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

const mod = (id: string): DiscoveredMod => ({
  manifest: { id, name: id.toUpperCase(), version: '1.0.0', apiVersion: 1, main: 'i.mjs' },
  dir: `/mods/${id}`,
  entry: `/mods/${id}/i.mjs`,
});
const MOD_A = mod('a');
const MOD_B = mod('b');
const TWO_MODS: DiscoveryResult = { root: '/mods', mods: [MOD_A, MOD_B], problems: [] };

/** A loader over a fabricated host; `calls` records what reached the host and the log. */
function setup(
  options: {
    enabled?: boolean;
    disabled?: string[];
    holdWrites?: boolean;
    /** False models a window with no folder; the default is a workspace. */
    persisted?: boolean;
  } = {},
) {
  const calls = {
    discover: 0,
    reload: [] as unknown[],
    dispose: 0,
    stopMod: [] as string[],
    start: [] as unknown[],
    writes: [] as Array<string[] | undefined>,
    logs: [] as string[],
  };
  const discoveries: ReturnType<typeof deferred<DiscoveryResult>>[] = [];
  const reloads: ReturnType<typeof deferred<void>>[] = [];
  const writeGates: ReturnType<typeof deferred<void>>[] = [];
  let disabled = options.disabled ?? [];
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
      stopMod: (id) => {
        calls.stopMod.push(id);
        return Promise.resolve();
      },
      start: (mods) => {
        calls.start.push(mods);
      },
    },
    readDisabled: () => disabled,
    writeDisabled: (list) => {
      calls.writes.push(list);
      disabled = list ?? [];
      if (options.holdWrites !== true) return Promise.resolve();
      const gate = deferred<void>();
      writeGates.push(gate);
      return gate.promise;
    },
    persisted: options.persisted ?? true,
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
    writeGates,
    /** The next `times` writes throw, like a released channel. */
    makeLogThrow: (times: number) => {
      logThrows = times;
    },
    /** Runs a whole load: resolves the discovery with `found` and then the reload. */
    async finishLoad(found: DiscoveryResult, index = 0): Promise<void> {
      await tick();
      discoveries[index]?.resolve(found);
      await tick();
      reloads[index]?.resolve();
      await tick();
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
    t.discoveries[0]?.resolve({ root: '/mods', mods: [], problems: [] });
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

describe('createModsLoader: the per-mod switch', () => {
  it('L1: a toggle queued behind a load runs after it', async () => {
    const t = setup();
    const load = t.loader.load();
    const toggle = t.loader.toggle('a', false);
    await tick();
    t.discoveries[0]?.resolve(TWO_MODS);
    await tick();
    // The load is stuck in `reload`: the toggle must not have written or stopped anything yet.
    expect(t.calls.writes).toEqual([]);
    expect(t.calls.stopMod).toEqual([]);
    t.reloads[0]?.resolve();
    await Promise.all([load, toggle]);
    expect(t.calls.writes).toEqual([['a']]);
    expect(t.calls.stopMod).toEqual(['a']);
  });

  it('L2: a load queued behind a toggle reads the new disabled list', async () => {
    const t = setup({ holdWrites: true });
    const first = t.loader.load();
    await t.finishLoad(TWO_MODS);
    await first;
    const toggle = t.loader.toggle('a', false);
    const load = t.loader.load();
    await tick();
    t.writeGates[0]?.resolve();
    await toggle;
    await tick();
    t.discoveries[1]?.resolve(TWO_MODS);
    await tick();
    t.reloads[1]?.resolve();
    await load;
    expect(t.calls.reload[1]).toEqual([MOD_B]);
  });

  it('a toggle off stops only that mod, and a toggle on starts only that one', async () => {
    const t = setup();
    const first = t.loader.load();
    await t.finishLoad(TWO_MODS);
    await first;
    await t.loader.toggle('a', false);
    expect(t.calls.stopMod).toEqual(['a']);
    expect(t.calls.reload).toHaveLength(1);
    expect(t.loader.inventory().disabled).toEqual(['a']);
    await t.loader.toggle('a', true);
    expect(t.calls.start).toEqual([[MOD_A]]);
    expect(t.calls.stopMod).toEqual(['a']);
    expect(t.calls.writes).toEqual([['a'], undefined]);
    expect(t.calls.reload).toHaveLength(1);
    expect(t.calls.logs).toEqual([
      'info: mod a switched off in this workspace',
      'info: mod a switched on in this workspace',
    ]);
  });

  it('L3: a toggle whose write ends after dispose stops and starts nothing', async () => {
    const t = setup({ holdWrites: true });
    const first = t.loader.load();
    await t.finishLoad(TWO_MODS);
    await first;
    let notified = 0;
    t.loader.onDidChange(() => {
      notified += 1;
    });
    const off = t.loader.toggle('a', false);
    await tick();
    const disposing = t.loader.dispose();
    t.writeGates[0]?.resolve();
    await Promise.all([off, disposing]);
    expect(notified).toBe(0);
    expect(t.calls.stopMod).toEqual([]);
    expect(t.calls.start).toEqual([]);
    expect(t.calls.logs).toEqual([]);
  });

  it('L4: a toggle with mods turned off writes the list, notifies and touches no Worker', async () => {
    const t = setup({ enabled: false });
    const first = t.loader.load();
    await t.finishLoad(TWO_MODS);
    await first;
    let notified = 0;
    t.loader.onDidChange(() => {
      notified += 1;
    });
    await t.loader.toggle('a', false);
    await t.loader.toggle('a', true);
    expect(t.calls.writes).toEqual([['a'], undefined]);
    expect(notified).toBe(2);
    expect(t.calls.stopMod).toEqual([]);
    expect(t.calls.start).toEqual([]);
    expect(t.calls.reload).toEqual([[]]);
  });

  // Review delta C-1: a window with no folder (`persisted: false`) must say "window", not
  // "workspace", in the line a test of `test:visual` greps. FABRICATED host.
  it('a toggle in a window with no folder logs "in this window"', async () => {
    const t = setup({ persisted: false });
    const first = t.loader.load();
    await t.finishLoad(TWO_MODS);
    await first;
    await t.loader.toggle('a', false);
    expect(t.calls.logs).toEqual(['info: mod a switched off in this window']);
  });

  it('L5: enabling an id that is no longer discovered warns and starts nothing', async () => {
    const t = setup({ disabled: ['gone'] });
    const first = t.loader.load();
    await t.finishLoad(TWO_MODS);
    await first;
    await t.loader.toggle('gone', true);
    expect(t.calls.writes).toEqual([undefined]);
    expect(t.calls.start).toEqual([]);
    expect(t.calls.logs).toEqual([
      'info: mod gone switched on in this workspace',
      'warn: mod gone is no longer in the mods folder; Reload Mods picks up the change',
    ]);
  });

  it('L6: a disabled id is discovered but not handed to reload; the listing keeps it', async () => {
    const t = setup({ disabled: ['a'] });
    const load = t.loader.load();
    await t.finishLoad(TWO_MODS);
    await load;
    expect(t.calls.reload).toEqual([[MOD_B]]);
    const inventory = t.loader.inventory();
    expect(inventory.mods.map((m) => m.id)).toEqual(['a', 'b']);
    expect(inventory.disabled).toEqual(['a']);
  });

  it('L7: with mods turned off it still discovers, reloads [] and lists enabled=false', async () => {
    const t = setup({ enabled: false });
    const load = t.loader.load();
    await t.finishLoad({ ...TWO_MODS, problems: PROBLEMS.problems });
    await load;
    expect(t.calls.discover).toBe(1);
    expect(t.calls.reload).toEqual([[]]);
    const inventory = t.loader.inventory();
    expect(inventory.enabled).toBe(false);
    expect(inventory.mods.map((m) => m.id)).toEqual(['a', 'b']);
    expect(inventory.skipped).toEqual(PROBLEMS.problems);
    expect(t.calls.logs).toContain('info: mods are turned off (openVsCode.mods.enabled)');
  });

  it('L8: the listing is published before reload emits', async () => {
    const t = setup();
    const seen: Array<{ reloads: number; mods: string[] }> = [];
    t.loader.onDidChange(() => {
      seen.push({
        reloads: t.calls.reload.length,
        mods: t.loader.inventory().mods.map((m) => m.id),
      });
    });
    const load = t.loader.load();
    await tick();
    t.discoveries[0]?.resolve(TWO_MODS);
    await tick();
    expect(seen).toEqual([{ reloads: 0, mods: ['a', 'b'] }]);
    t.reloads[0]?.resolve();
    await load;
  });

  // S7 of the review (07/11/2026): a failed write must reach the caller, so the controller can send
  // a `notice` to the panel that asked. FABRICATED host whose write rejects.
  it('a toggle whose write rejects logs the failure, rejects, and leaves the queue usable', async () => {
    const t = setup();
    const first = t.loader.load();
    await t.finishLoad(TWO_MODS);
    await first;
    const broken = createModsLoader({
      readEnabled: () => true,
      discover: () => Promise.resolve(TWO_MODS),
      host: {
        reload: () => Promise.resolve(),
        dispose: () => Promise.resolve(),
        stopMod: () => Promise.resolve(),
        start: () => undefined,
      },
      readDisabled: () => [],
      writeDisabled: () => Promise.reject(new Error('disk full')),
      persisted: true,
      log: (level, text) => {
        t.calls.logs.push(`${level}: ${text}`);
      },
    });
    await expect(broken.toggle('a', false)).rejects.toThrow('disk full');
    expect(t.calls.logs).toEqual(['error: could not switch mod a: disk full']);
    await expect(broken.load()).resolves.toBeUndefined();
  });
});
