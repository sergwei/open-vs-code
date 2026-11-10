// Mods suite (E10-mods, phase 2), label `main`.
//
// Protects against: a mod Worker that cannot start inside the REAL extension host (the plan's main
// risk: microsoft/vscode#88386 reported VS Code hangs with `worker_threads`), a bootstrap missing
// from the bundle, a mod that throws or blocks its event loop taking the host (or the other mods)
// down, and a suite loading the developer's real mods (H8: `OPEN_VS_CODE_MODS_HOME` is set for
// every label by `.vscode-test.mjs`).
//
// How: the four fixtures of `src/extension/test-fixtures/mods/` (a well-behaved mod, `quiet` (a
// counter in memory, E10-mod-toggles), one that
// throws in `activate`, one that spins forever) are copied into the seeded mods root, then
// "OpenCode: Reload Mods" discovers them and the uncontributed test command reads the state. The
// well-behaved mod proves its command ran INSIDE the Worker by writing a sentinel file.
// The heartbeat is 500 ms under `ExtensionMode.Test` (see `modsLifecycle.ts`), so the spinning mod
// is declared hung in about 2 s.
//
// What this is NOT: it does not run a turn (the `main` label has no fake server; the event
// mapping is covered by `chatController.e2e.test.ts` against the synthetic server) and it runs
// on the OS of whoever launches it: macOS and Linux are only the CI.
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  CONFIG_SECTION,
  MODS_ENABLED_KEY,
  RELOAD_MODS_COMMAND_ID,
  RUN_MOD_COMMAND_ID,
  TEST_MOD_TOGGLE_COMMAND_ID,
  TEST_MODS_STATE_COMMAND_ID,
  TEST_SETTINGS_MESSAGE_COMMAND_ID,
  TEST_SETTINGS_STATE_COMMAND_ID,
} from '../../src/extension/ids';
import type { SettingsState } from '../../src/shared/settingsProtocol';
import { openLogCursor } from './support/extensionLog';

const EXTENSION_ID = 'sergwei.open-vs-code';

interface ModsState {
  root: string;
  mods: Array<{ id: string; state: string; error?: string }>;
  commands: Array<{ modId: string; name: string }>;
  problems: Array<{ folder: string; reason: string }>;
  /** The listing of the popover (E10-mod-toggles): every mod found, with its on/off state. */
  listing: {
    enabled: boolean;
    persisted: boolean;
    mods: Array<{ id: string; enabled: boolean; state: string }>;
    skipped: Array<{ folder: string; reason: string }>;
  };
}

/** The `state` of one mod in the listing of `s`, or `undefined` when the listing does not have it. */
const listed = (s: ModsState, id: string): string | undefined =>
  s.listing.mods.find((m) => m.id === id)?.state;

/** Switches one mod through the test-only command (the same path as the popover's switch). */
async function toggleMod(modId: string, enabled: boolean): Promise<void> {
  await vscode.commands.executeCommand(TEST_MOD_TOGGLE_COMMAND_ID, modId, enabled);
}

/** Reads the state through the test-only command. */
async function state(): Promise<ModsState> {
  return await vscode.commands.executeCommand<ModsState>(TEST_MODS_STATE_COMMAND_ID);
}

/** Polls the mods state until `check` holds; fails with the last state so a failure is readable. */
async function waitForState(check: (s: ModsState) => boolean, what: string): Promise<ModsState> {
  const deadline = Date.now() + 12_000;
  let last = await state();
  while (!check(last)) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}; state: ${JSON.stringify(last)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = await state();
  }
  return last;
}

describe('mods', function () {
  // The worker start and the hang detection take a few seconds; Mocha's 20 s default is too tight
  // for the three cases below on a slow CI.
  this.timeout(40_000);

  const modsHome = process.env['OPEN_VS_CODE_MODS_HOME'];
  let sentinelDir = '';

  before(async () => {
    assert.ok(
      modsHome,
      'OPEN_VS_CODE_MODS_HOME is not set: .vscode-test.mjs must set it for every label',
    );
    sentinelDir = path.join(modsHome, '..', 'mods-sentinel');
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();
    const fixtures = path.join(
      extension.extensionPath,
      'src',
      'extension',
      'test-fixtures',
      'mods',
    );
    fs.rmSync(modsHome, { recursive: true, force: true });
    fs.rmSync(sentinelDir, { recursive: true, force: true });
    fs.cpSync(fixtures, modsHome, { recursive: true });
  });

  after(async () => {
    // Put back what the toggle cases may have left off (workspace storage is in memory here, but a
    // later suite of the same window would still see it).
    await toggleMod('hello-station', true).catch(() => undefined);
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(MODS_ENABLED_KEY, undefined, vscode.ConfigurationTarget.Global);
    if (modsHome !== undefined) {
      fs.rmSync(modsHome, { recursive: true, force: true });
      fs.rmSync(sentinelDir, { recursive: true, force: true });
    }
    await vscode.commands.executeCommand(RELOAD_MODS_COMMAND_ID);
  });

  /**
   * The seeded root is the only one read (H8), a good mod becomes active with its command, a mod
   * that throws in `activate` is `failed` with its message, and one that spins forever is
   * `failed` as hung, while the good one keeps working (its three commands, `hello`, the
   * phase 4 `panel` and the #169 `compose`, are listed, then `quiet:count`; the panel itself is
   * covered by `test:visual` step 39), and the fourth fixture, `quiet`, is `active` too.
   * VERIFIED by this case, which passed with the four commands listed (label `main`,
   * Windows 11, VS Code 1.145.2, 07/11/2026). macOS and Linux: CI only.
   */
  it('loads the good mod and contains the one that throws and the one that hangs', async () => {
    await vscode.commands.executeCommand(RELOAD_MODS_COMMAND_ID);
    const result = await waitForState(
      (s) => s.mods.length === 4 && s.mods.every((m) => m.state !== 'starting'),
      'the four fixtures to settle',
    );
    assert.strictEqual(path.resolve(result.root), path.resolve(modsHome ?? ''));
    const byId = Object.fromEntries(result.mods.map((m) => [m.id, m]));
    assert.strictEqual(byId['hello-station']?.state, 'active');
    assert.strictEqual(byId['throws']?.state, 'failed');
    assert.match(byId['throws']?.error ?? '', /boom from the throws fixture/);
    assert.strictEqual(byId['hangs']?.state, 'failed');
    assert.match(byId['hangs']?.error ?? '', /^hung:/);
    assert.strictEqual(byId['quiet']?.state, 'active');
    assert.deepStrictEqual(
      result.commands.map((c) => `${c.modId}:${c.name}`),
      ['hello-station:hello', 'hello-station:panel', 'hello-station:compose', 'quiet:count'],
    );
  });

  /** The command of the good mod runs in its Worker, after the others failed (nothing else moved). */
  it('runs the command of the good mod inside its Worker', async () => {
    await vscode.commands.executeCommand(RUN_MOD_COMMAND_ID, {
      modId: 'hello-station',
      name: 'hello',
      args: 'from-the-test',
    });
    const sentinel = path.join(sentinelDir, 'hello.ran');
    assert.ok(fs.existsSync(sentinel), 'the sentinel file was not written by the command');
    assert.match(fs.readFileSync(sentinel, 'utf8'), /args=from-the-test/);
  });

  /**
   * Turning ONE mod off stops only that mod: `quiet` keeps its Worker, which a counter held in its
   * memory proves (`count=1` before, `count=2` after; a restarted Worker would say `count=1`).
   * `hello-station` leaves the host's statuses and its commands, shows as `disabled` in the listing,
   * and comes back `active` when switched on. VERIFIED by this case, which passed (label
   * `main`, Windows 11, VS Code 1.145.2, 07/11/2026). Not observed: the `count=2` assertion going
   * red after a restart of `quiet` (that mutation was not run).
   */
  it('turning one mod off stops only that mod: the other keeps its in-memory state', async () => {
    const countFile = path.join(sentinelDir, 'quiet.count');
    await vscode.commands.executeCommand(RUN_MOD_COMMAND_ID, {
      modId: 'quiet',
      name: 'count',
      args: '',
    });
    assert.match(fs.readFileSync(countFile, 'utf8'), /^count=1$/m);

    await toggleMod('hello-station', false);
    const off = await waitForState(
      (s) =>
        listed(s, 'hello-station') === 'disabled' && !s.mods.some((m) => m.id === 'hello-station'),
      'hello-station to be switched off',
    );
    assert.ok(!off.commands.some((c) => c.modId === 'hello-station'), 'its commands are gone');
    assert.strictEqual(listed(off, 'quiet'), 'active');
    assert.ok(off.commands.some((c) => c.modId === 'quiet'));

    await toggleMod('hello-station', true);
    await waitForState(
      (s) => listed(s, 'hello-station') === 'active',
      'hello-station to start again',
    );

    await vscode.commands.executeCommand(RUN_MOD_COMMAND_ID, {
      modId: 'quiet',
      name: 'count',
      args: '',
    });
    assert.match(fs.readFileSync(countFile, 'utf8'), /^count=2$/m);
  });

  /**
   * A mod switched off stays off through "Reload Mods" and through turning `mods.enabled` off and
   * on: the listing keeps it `disabled` (and, with the global switch off, still lists the others as
   * `stopped` with `enabled: false` reported). Workspace storage is in memory in this suite, so
   * what survives a window reload is measured only by `test:visual` step 45, whose check "after
   * Reload Window hello-station is still off (switch false, no band, no new "loaded" line) and quiet
   * started again" passed on Windows 11, VS Code 1.145.2 (07/11/2026). VERIFIED by this case, which passed (label `main`, Windows 11, VS Code
   * 1.145.2, 07/11/2026).
   */
  it('Reload Mods and turning mods.enabled off and on keep a disabled mod off in this workspace', async () => {
    await toggleMod('hello-station', false);
    await vscode.commands.executeCommand(RELOAD_MODS_COMMAND_ID);
    const reloaded = await waitForState(
      (s) => listed(s, 'quiet') === 'active' && listed(s, 'hangs') === 'failed',
      'the reload to settle',
    );
    assert.strictEqual(listed(reloaded, 'hello-station'), 'disabled');
    assert.ok(!reloaded.mods.some((m) => m.id === 'hello-station'));

    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    await config.update(MODS_ENABLED_KEY, false, vscode.ConfigurationTarget.Global);
    const globalOff = await waitForState(
      (s) => !s.listing.enabled && s.mods.length === 0 && listed(s, 'quiet') === 'stopped',
      'the mods to stop and the listing to say so',
    );
    assert.strictEqual(listed(globalOff, 'hello-station'), 'disabled');

    await config.update(MODS_ENABLED_KEY, undefined, vscode.ConfigurationTarget.Global);
    const globalOn = await waitForState(
      (s) => s.listing.enabled && listed(s, 'quiet') === 'active',
      'the mods to start again',
    );
    assert.strictEqual(listed(globalOn, 'hello-station'), 'disabled');
    assert.ok(!globalOn.mods.some((m) => m.id === 'hello-station'));

    await toggleMod('hello-station', true);
    await waitForState(
      (s) => listed(s, 'hello-station') === 'active',
      'hello-station to start again',
    );
  });

  /** An id the last discovery never listed is refused, and the listing is the same afterwards. */
  it('an unknown id is refused and writes nothing', async () => {
    const before = (await state()).listing;
    await assert.rejects(toggleMod('no-such-mod', false), /was not found in the mods folder/);
    await assert.rejects(
      Promise.resolve(vscode.commands.executeCommand(TEST_MOD_TOGGLE_COMMAND_ID, 'quiet', 'false')),
      /expected \(modId: string, enabled: boolean\)/,
    );
    assert.deepStrictEqual((await state()).listing, before);
    assert.strictEqual(listed(await state(), 'quiet'), 'active');
  });

  /**
   * The Settings tab's switch (PR3 of issue #186) goes through the same `ModsChat.toggle` as the
   * popover: `settings.state` carries the listing and follows it, only that Worker stops (`quiet`
   * keeps `active`), and the mod comes back on. The message goes through `test.settingsMessage`
   * (the real guard and revalidation, not a DOM `postMessage`). A `finally` turns the mod back on
   * whatever failed, so a failing assertion does not leave it disabled for the later cases.
   * VERIFIED on Windows 11, VS Code 1.145.3 (10/11/2026): the `main` label ran it, "switches a mod
   * off and on from the Settings tab: settings.state follows and only that Worker stops (373ms)".
   */
  it('switches a mod off and on from the Settings tab: settings.state follows and only that Worker stops', async () => {
    const settingsMods = async () =>
      (await vscode.commands.executeCommand<SettingsState>(TEST_SETTINGS_STATE_COMMAND_ID)).mods;
    const stateOf = async (id: string): Promise<string | undefined> =>
      (await settingsMods())?.mods.find((m) => m.id === id)?.state;
    const sendToggle = (enabled: boolean): Thenable<unknown> =>
      vscode.commands.executeCommand(TEST_SETTINGS_MESSAGE_COMMAND_ID, {
        type: 'settings.modToggle',
        modId: 'hello-station',
        enabled,
      });
    try {
      await sendToggle(false);
      await waitForState((s) => listed(s, 'hello-station') === 'disabled', 'the mod to switch off');
      assert.strictEqual(await stateOf('hello-station'), 'disabled');
      assert.strictEqual(await stateOf('quiet'), 'active');
      await sendToggle(true);
      await waitForState((s) => listed(s, 'hello-station') === 'active', 'the mod to switch on');
      assert.strictEqual(await stateOf('hello-station'), 'active');
    } finally {
      // Whatever failed above, the mod goes back on so later cases of the suite find it active.
      await sendToggle(true);
      await waitForState((s) => listed(s, 'hello-station') === 'active', 'the mod to be back on');
    }
  });

  /** An id the last discovery never listed is refused from the Settings tab too: a log line, no change. */
  it('refuses an unknown mod id from the Settings tab and writes nothing', async () => {
    const before = (await state()).listing;
    const log = await openLogCursor();
    await vscode.commands.executeCommand(TEST_SETTINGS_MESSAGE_COMMAND_ID, {
      type: 'settings.modToggle',
      modId: 'no-such-mod',
      enabled: false,
    });
    await log.waitFor('settings request failed: settings.modToggle', 8000);
    assert.deepStrictEqual((await state()).listing, before);
  });

  /** Turning the switch off stops every mod, and a mod command then finds nothing to run. */
  it('stops every mod when openVsCode.mods.enabled is turned off', async () => {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(MODS_ENABLED_KEY, false, vscode.ConfigurationTarget.Global);
    const result = await waitForState((s) => s.mods.length === 0, 'the mods to stop');
    assert.deepStrictEqual(result.commands, []);
  });
});
