import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RunningServer, StartServerOptions } from './opencodeServer';
import {
  launchCommandFor,
  launchModesOf,
  TEST_NODE_ENV,
  testLaunchFrom,
  VISUAL_FAKE_ENV,
  wrapStartServer,
} from './testLaunch';

/**
 * Protects the seam of issue #41 from leaking into production: a `.mjs` is only run through Node
 * when `OPEN_VS_CODE_TEST_NODE` is an absolute path AND the host is in test mode, or in
 * development mode with the explicit `OPEN_VS_CODE_VISUAL_FAKE=1` (the opt-in of `test:visual`).
 * A regression here would either break the `fake-server` suite or the visual run or, worse, make
 * a normal install or a plain F5 treat a script as a binary. Inputs are synthetic strings (no
 * process is spawned); the real spawn is covered by the `fake-server` integration suite.
 */
const NODE = path.resolve('/opt/node/bin/node');
const FAKE = path.resolve('/repo/fake-opencode.mjs');

const TEST = { test: true, development: false };
const DEVELOPMENT = { test: false, development: true };
const PRODUCTION = { test: false, development: false };

describe('testLaunchFrom', () => {
  it('is on in test mode with an absolute node path', () => {
    expect(testLaunchFrom(TEST, { [TEST_NODE_ENV]: NODE })).toEqual({ nodePath: NODE });
  });

  it('is off in production, even with every variable set', () => {
    expect(
      testLaunchFrom(PRODUCTION, { [TEST_NODE_ENV]: NODE, [VISUAL_FAKE_ENV]: '1' }),
    ).toBeUndefined();
  });

  it('is off in test mode without the variable', () => {
    expect(testLaunchFrom(TEST, {})).toBeUndefined();
  });

  it('treats an empty or relative value as unset', () => {
    expect(testLaunchFrom(TEST, { [TEST_NODE_ENV]: '' })).toBeUndefined();
    expect(testLaunchFrom(TEST, { [TEST_NODE_ENV]: 'node' })).toBeUndefined();
    expect(
      testLaunchFrom(DEVELOPMENT, { [TEST_NODE_ENV]: 'node', [VISUAL_FAKE_ENV]: '1' }),
    ).toBeUndefined();
  });

  it('is on in development only with BOTH variables', () => {
    expect(testLaunchFrom(DEVELOPMENT, { [TEST_NODE_ENV]: NODE, [VISUAL_FAKE_ENV]: '1' })).toEqual({
      nodePath: NODE,
    });
  });

  it('is off in development with only one of the two variables (a plain F5)', () => {
    expect(testLaunchFrom(DEVELOPMENT, { [TEST_NODE_ENV]: NODE })).toBeUndefined();
    expect(testLaunchFrom(DEVELOPMENT, { [VISUAL_FAKE_ENV]: '1' })).toBeUndefined();
  });

  it('counts only the exact value 1 as the development opt-in', () => {
    for (const value of ['', '0', 'true', 'yes']) {
      expect(
        testLaunchFrom(DEVELOPMENT, { [TEST_NODE_ENV]: NODE, [VISUAL_FAKE_ENV]: value }),
      ).toBeUndefined();
    }
  });
});

describe('launchModesOf', () => {
  it('maps the three ExtensionMode numbers to flags', () => {
    expect(launchModesOf(3, 3, 2)).toEqual(TEST);
    expect(launchModesOf(2, 3, 2)).toEqual(DEVELOPMENT);
    expect(launchModesOf(1, 3, 2)).toEqual(PRODUCTION);
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
