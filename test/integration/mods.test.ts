// Mods suite (E10-mods, phase 2), label `main`.
//
// Protects against: a mod Worker that cannot start inside the REAL extension host (the plan's main
// risk: microsoft/vscode#88386 reported VS Code hangs with `worker_threads`), a bootstrap missing
// from the bundle, a mod that throws or blocks its event loop taking the host (or the other mods)
// down, and a suite loading the developer's real mods (H8: `OPEN_VS_CODE_MODS_HOME` is set for
// every label by `.vscode-test.mjs`).
//
// How: the three fixtures of `src/extension/test-fixtures/mods/` (a well-behaved mod, one that
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
  TEST_MODS_STATE_COMMAND_ID,
} from '../../src/extension/ids';

const EXTENSION_ID = 'sergwei.open-vs-code';

interface ModsState {
  root: string;
  mods: Array<{ id: string; state: string; error?: string }>;
  commands: Array<{ modId: string; name: string }>;
  problems: Array<{ folder: string; reason: string }>;
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
   * `failed` as hung, while the good one keeps working (its two commands, `hello` and the
   * phase 4 `panel`, are listed; the panel itself is covered by `test:visual` step 39). VERIFIED: "✔ loads the good mod and contains
   * the one that throws and the one that hangs" passed in 2113 ms with both commands listed (label `main`, Windows 11,
   * VS Code 1.144.0, 02/11/2026). macOS and Linux: CI only.
   */
  it('loads the good mod and contains the one that throws and the one that hangs', async () => {
    await vscode.commands.executeCommand(RELOAD_MODS_COMMAND_ID);
    const result = await waitForState(
      (s) => s.mods.length === 3 && s.mods.every((m) => m.state !== 'starting'),
      'the three fixtures to settle',
    );
    assert.strictEqual(path.resolve(result.root), path.resolve(modsHome ?? ''));
    const byId = Object.fromEntries(result.mods.map((m) => [m.id, m]));
    assert.strictEqual(byId['hello-station']?.state, 'active');
    assert.strictEqual(byId['throws']?.state, 'failed');
    assert.match(byId['throws']?.error ?? '', /boom from the throws fixture/);
    assert.strictEqual(byId['hangs']?.state, 'failed');
    assert.match(byId['hangs']?.error ?? '', /^hung:/);
    assert.deepStrictEqual(
      result.commands.map((c) => `${c.modId}:${c.name}`),
      ['hello-station:hello', 'hello-station:panel'],
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

  /** Turning the switch off stops every mod, and a mod command then finds nothing to run. */
  it('stops every mod when openVsCode.mods.enabled is turned off', async () => {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(MODS_ENABLED_KEY, false, vscode.ConfigurationTarget.Global);
    const result = await waitForState((s) => s.mods.length === 0, 'the mods to stop');
    assert.deepStrictEqual(result.commands, []);
  });
});
