// Binary detection suite (issue #41).
//
// Protects against: the config listener of `binaryDetection.ts` not re-running detection when
// `openVsCode.opencodePath` changes, and the user-facing log messages of `describeDetection`
// changing without notice. These are the scenarios of the manual F5 check of issue #7, run in a
// real VS Code. The setting is written with the API into the isolated profile
// (`.vscode-test/user-data`), never into the user's own settings.json.
// The "opencode" is the Node that runs the tests (answers `--version` with a v24 number), or a
// shell script on POSIX; no real opencode is installed (decision of Sergio: real server stays
// UNVERIFIED). Out of scope: the notification and its buttons (no API reads notifications).
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CONFIG_SECTION, OPENCODE_PATH_KEY, OPENCODE_PATH_SETTING } from '../../src/extension/ids';
import { openLogCursor, type LogCursor } from './support/extensionLog';

const EXTENSION_ID = 'sergwei.open-vs-code';
// Our own choice: detection runs `node --version` (observed well under a second locally, not measured on
// CI); 8 s leaves margin. Two waits chain in one test (16 s), which must stay below the Mocha
// timeout of 20 s in `.vscode-test.mjs`, so the helper's diagnostic wins over Mocha's.
const WAIT_MS = 8000;

/**
 * Writes `openVsCode.opencodePath` in the global (user) scope of the test profile.
 *
 * HYPOTHESIS: a `scope: machine` setting accepts `ConfigurationTarget.Global`; if VS Code
 * refuses, `update` rejects and every test here fails at this call (plan B: write the profile's
 * settings.json before activation).
 */
async function setPath(value: string | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(OPENCODE_PATH_KEY, value, vscode.ConfigurationTarget.Global);
}

/**
 * Returns the Node binary the runner uses, set by `.vscode-test.mjs`.
 */
function fakeNode(): string {
  const node = process.env['OPEN_VS_CODE_TEST_NODE'];
  assert.ok(node, 'OPEN_VS_CODE_TEST_NODE is not set; run through `vscode-test`.');
  return node;
}

describe('binary detection', () => {
  let log: LogCursor;
  const tempDirs: string[] = [];

  before(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);
    await extension.activate();
    await setPath(undefined);
  });

  beforeEach(async () => {
    log = await openLogCursor();
  });

  afterEach(async () => {
    await setPath(undefined);
  });

  after(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A binary that is not v2 is reported as unsupported with its version and path.
   */
  it('reports a non-v2 binary as unsupported', async () => {
    const node = fakeNode();
    log.mark();
    await setPath(node);
    await log.waitFor('open-vs-code requires opencode v2 (found ', WAIT_MS);
    await log.waitFor(` at ${node}).`, WAIT_MS);
  });

  /**
   * A relative path in the setting is invalid.
   */
  it('rejects a relative path', async () => {
    log.mark();
    await setPath('opencode');
    await log.waitFor(
      `The setting ${OPENCODE_PATH_SETTING} is invalid: the path is not absolute (opencode).`,
      WAIT_MS,
    );
  });

  /**
   * An absolute path to a file that does not exist is invalid.
   */
  it('rejects a missing file', async () => {
    const missing = path.join(os.tmpdir(), 'open-vs-code-no-such-opencode');
    log.mark();
    await setPath(missing);
    await log.waitFor(
      `The setting ${OPENCODE_PATH_SETTING} is invalid: the file does not exist (${missing}).`,
      WAIT_MS,
    );
  });

  /**
   * A v2 binary is accepted. POSIX only: on Windows detection accepts only `.exe` files and a
   * script cannot stand in for one. UNVERIFIED until the CI matrix runs it on Linux/macOS.
   */
  it('accepts a v2 binary (POSIX)', async function () {
    if (process.platform === 'win32') this.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-vs-code-fake-'));
    tempDirs.push(dir);
    const script = path.join(dir, 'opencode');
    fs.writeFileSync(script, '#!/bin/sh\necho "opencode v2.0.32"\n');
    fs.chmodSync(script, 0o755);
    log.mark();
    await setPath(script);
    await log.waitFor(`Using opencode 2.0.32 at ${script} (setting).`, WAIT_MS);
  });

  /**
   * Clearing the setting re-runs detection without reloading the window. The outcome depends on
   * the PATH of the machine, so only the `binary detection:` line is awaited.
   */
  it('re-detects when the setting is cleared', async () => {
    await setPath('opencode');
    await log.waitFor('is invalid', WAIT_MS);
    log.mark();
    await setPath(undefined);
    await log.waitFor('binary detection:', WAIT_MS);
  });
});
