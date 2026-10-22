import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RunningServer, StartServerOptions } from './opencodeServer';
import { launchCommandFor, TEST_NODE_ENV, testLaunchFrom, wrapStartServer } from './testLaunch';

/**
 * Protects the Test-mode seam of issue #41 from leaking into production: a `.mjs` is only run
 * through Node when BOTH the extension host is in test mode and `OPEN_VS_CODE_TEST_NODE` is an
 * absolute path. A regression here would either break the `fake-server` suite or, worse, make a
 * normal install treat a script as a binary. Inputs are synthetic strings (no process is spawned);
 * the real spawn is covered by the `fake-server` integration suite.
 */
const NODE = path.resolve('/opt/node/bin/node');
const FAKE = path.resolve('/repo/fake-opencode.mjs');

describe('testLaunchFrom', () => {
  it('is on only in test mode with an absolute node path', () => {
    expect(testLaunchFrom(true, { [TEST_NODE_ENV]: NODE })).toEqual({ nodePath: NODE });
  });

  it('is off outside test mode, even with the variable set', () => {
    expect(testLaunchFrom(false, { [TEST_NODE_ENV]: NODE })).toBeUndefined();
  });

  it('is off in test mode without the variable', () => {
    expect(testLaunchFrom(true, {})).toBeUndefined();
  });

  it('treats an empty or relative value as unset', () => {
    expect(testLaunchFrom(true, { [TEST_NODE_ENV]: '' })).toBeUndefined();
    expect(testLaunchFrom(true, { [TEST_NODE_ENV]: 'node' })).toBeUndefined();
  });
});

describe('launchCommandFor', () => {
  it('runs a .mjs through node when the seam is on', () => {
    const launch = launchCommandFor({ nodePath: NODE });
    expect(launch(FAKE)).toEqual({ command: NODE, args: [FAKE] });
    expect(launch('/repo/FAKE.MJS')).toEqual({ command: NODE, args: ['/repo/FAKE.MJS'] });
  });

  it('leaves an .exe and an extensionless path alone', () => {
    const launch = launchCommandFor({ nodePath: NODE });
    expect(launch('C:\\bin\\opencode.exe')).toEqual({ command: 'C:\\bin\\opencode.exe', args: [] });
    expect(launch('/usr/bin/opencode')).toEqual({ command: '/usr/bin/opencode', args: [] });
  });

  it('is the identity for a .mjs when the seam is off', () => {
    expect(launchCommandFor(undefined)(FAKE)).toEqual({ command: FAKE, args: [] });
  });
});

describe('wrapStartServer', () => {
  const options = (command: string, prefixArgs?: string[]): StartServerOptions => ({
    command,
    ...(prefixArgs === undefined ? {} : { prefixArgs }),
    folder: '/work',
    port: 0,
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
  });
  const server = {} as RunningServer;

  it('returns the very same function when the seam is off', () => {
    const start = vi.fn(() => Promise.resolve(server));
    expect(wrapStartServer(start, undefined)).toBe(start);
  });

  it('starts a .mjs as node <mjs>, keeping prefix args after the script', async () => {
    const start = vi.fn((_: StartServerOptions) => Promise.resolve(server));
    await wrapStartServer(start, { nodePath: NODE })(options(FAKE, ['--x']));
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0]).toMatchObject({
      command: NODE,
      prefixArgs: [FAKE, '--x'],
      folder: '/work',
    });
  });

  it('passes a non-script command through untouched', async () => {
    const start = vi.fn((_: StartServerOptions) => Promise.resolve(server));
    const given = options('C:\\bin\\opencode.exe');
    await wrapStartServer(start, { nodePath: NODE })(given);
    expect(start.mock.calls[0]?.[0]).toBe(given);
  });
});
