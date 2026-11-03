// Tests for `modPanelPolicy.ts` (E10-mods-hardening).
//
// What they protect: that a file a mod DECLARES for its panel cannot leave the mod folder, not even
// through a symlink or a junction (`resolveModFile` was never exercised with a link before), and
// that the warning about dropped page messages is gated to one per window. They use REAL temporary
// folders, created and removed by each test, like `modDiscovery.test.ts`; the links are built by
// the test, not copied from a real mod. R1 needs no privilege on Windows (a junction); R2 is
// skipped when the OS refuses a file symlink.

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWarnGate, resolveModFile } from './modPanelPolicy';

let base: string;
let dir: string;
let outside: string;

beforeEach(async () => {
  // realpath: `resolveModFile` needs a `dir` that is already real (as `DiscoveredMod.dir` is). On
  // macOS os.tmpdir() sits under the /var symlink and on Windows runners it has an 8.3 name.
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ovsc-panel-')));
  dir = path.join(base, 'mod');
  outside = path.join(base, 'outside');
  await mkdir(dir);
  await mkdir(outside);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('resolveModFile', () => {
  it('R1: refuses a declared file under a junction that leaves the folder', async () => {
    await writeFile(path.join(outside, 'panel.html'), '<p>secret</p>');
    await symlink(outside, path.join(dir, 'link'), 'junction');
    await expect(resolveModFile(dir, 'link/panel.html')).rejects.toThrow(
      'is outside the mod folder',
    );
  });

  it('R2: refuses a declared file that is a link to a file outside the folder', async (ctx) => {
    await writeFile(path.join(outside, 'panel.html'), '<p>secret</p>');
    try {
      await symlink(path.join(outside, 'panel.html'), path.join(dir, 'panel.html'), 'file');
    } catch {
      // Windows without the symlink privilege (or Developer Mode): cannot build the case here.
      ctx.skip();
    }
    await expect(resolveModFile(dir, 'panel.html')).rejects.toThrow('is outside the mod folder');
  });

  it('R3: accepts a link that stays inside the folder and returns the real path', async () => {
    await mkdir(path.join(dir, 'real'));
    const target = path.join(dir, 'real', 'panel.html');
    await writeFile(target, '<p>ok</p>');
    await symlink(path.join(dir, 'real'), path.join(dir, 'alias'), 'junction');
    const resolved = await resolveModFile(dir, 'alias/panel.html');
    expect(path.normalize(resolved).toLowerCase()).toBe(path.normalize(target).toLowerCase());
  });

  it('R4: refuses a file larger than 1 MB', async () => {
    await writeFile(path.join(dir, 'big.js'), Buffer.alloc(1_048_577));
    await expect(resolveModFile(dir, 'big.js')).rejects.toThrow('is larger than 1 MB');
  });

  it('R5: refuses ".." and an absolute path outside the folder', async () => {
    await writeFile(path.join(outside, 'x.js'), '');
    await expect(resolveModFile(dir, '../outside/x.js')).rejects.toThrow(
      'is outside the mod folder',
    );
    await expect(resolveModFile(dir, path.join(outside, 'x.js'))).rejects.toThrow(
      'is outside the mod folder',
    );
  });
});

describe('createWarnGate', () => {
  it('W1: lets the first event through', () => {
    const gate = createWarnGate(1000, () => 5000);
    expect(gate()).toBe(true);
  });

  it('W2: blocks every event until 999 ms after the last one let through', () => {
    let clock = 5000;
    const gate = createWarnGate(1000, () => clock);
    expect(gate()).toBe(true);
    clock = 5001;
    expect(gate()).toBe(false);
    clock = 5999;
    expect(gate()).toBe(false);
  });

  it('W3: lets one through again at 1000 ms and starts a new window from there', () => {
    let clock = 5000;
    const gate = createWarnGate(1000, () => clock);
    expect(gate()).toBe(true);
    clock = 6000;
    expect(gate()).toBe(true);
    clock = 6999;
    expect(gate()).toBe(false);
  });
});
