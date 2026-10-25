// External server suite (issue #11).
//
// Protects against: the extension launching its own `opencode serve` (or running the binary
// detection) when `openVsCode.serverUrl` is set; the password leaking to the log; and any of the
// failure reasons (no password / wrong password, not opencode v2, nobody listening, invalid
// address) collapsing into one another. It runs inside a real VS Code, with the SecretStorage, the
// settings and the commands of the real extension host.
//
// The "external server" is SYNTHETIC: `fake-opencode.mjs` started by the test itself with a known
// password. It proves the wiring of the extension (setting, secret, `GET /api/info`, state
// machine, log lines, commands); it says nothing about how a real opencode answers. The good
// connection and the 401 against a real opencode 2.0.32 are the last case of the opt-in
// `realOpencode.test.ts`. The refused connection is covered HERE, with a real TCP refusal and the
// extension host's real `fetch`, but against the fixture; against a real opencode it, and the
// timeout, are UNVERIFIED.
//
// Runs only under the `external-server` configuration of `.vscode-test.mjs`: its own profile (the
// secrets and the setting must not outlive a failed run in the profile of `main`), whose
// `settings.json` already holds `openVsCode.serverUrl` (so the very first activation is in
// external mode) and `openVsCode.opencodePath` pointing at a file that does not exist (so going
// back to "launch my own server" can never start a real opencode). The password is stored with the
// test-only command `openVsCode.test.setServerPassword`: a test cannot type into an input box.
// Not covered: the input box itself, the notification and its buttons (no API for either).
import * as assert from 'node:assert';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  CLEAR_SERVER_PASSWORD_COMMAND_ID,
  CONFIG_SECTION,
  DEFAULT_MODEL_KEY,
  RESTART_SERVER_COMMAND_ID,
  SERVER_URL_KEY,
  TEST_SET_SERVER_PASSWORD_COMMAND_ID,
} from '../../src/extension/ids';
import { readUrlLine, waitForExit } from '../../src/extension/opencodeServer';
import { openLogCursor, openLogFromStart, type LogCursor } from './support/extensionLog';

const EXTENSION_ID = 'sergwei.open-vs-code';
// Our own choice: a connection to a local fixture answers in milliseconds; 10 s is margin for a
// loaded CI machine. A test chains at most three waits, below the 60 s Mocha timeout.
const WAIT_MS = 10_000;
// Our own choice: the late reconnection of the Forget race came 20-40 ms after the first
// `unauthorized` (22/10/2026 trace); 2 s is fifty times that, and still below the 60 s timeout.
const SETTLE_MS = 2_000;
const PASSWORD = 'integration-secret-pw';
const NO_LOG = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/** A synthetic opencode started by the test, listening on a port of its own. */
interface FakeServer {
  origin: string;
  child: ChildProcessWithoutNullStreams;
}

/** Fakes started by the cases, so `after` can stop whatever a failed case left behind. */
const started: FakeServer[] = [];

/**
 * Starts `fake-opencode.mjs` as `serve --stdio` with a known password and resolves with its origin.
 *
 * Uses the Node that runs the test runner (`OPEN_VS_CODE_TEST_NODE`): the `process.execPath` of the
 * extension host is Electron. The fixture closes itself after 60 s whatever happens (its own cap).
 * `mode` and `version` become `FAKE_OPENCODE_MODE` / `FAKE_OPENCODE_VERSION`.
 */
async function startFake(
  extensionPath: string,
  options: { password?: string; mode?: string; version?: string } = {},
): Promise<FakeServer> {
  const node = process.env['OPEN_VS_CODE_TEST_NODE'];
  assert.ok(node, 'OPEN_VS_CODE_TEST_NODE is not set; run through `vscode-test`.');
  const fixture = path.join(
    extensionPath,
    'src',
    'extension',
    'test-fixtures',
    'fake-opencode.mjs',
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCODE_PASSWORD: options.password ?? PASSWORD,
  };
  if (options.mode !== undefined) env['FAKE_OPENCODE_MODE'] = options.mode;
  if (options.version !== undefined) env['FAKE_OPENCODE_VERSION'] = options.version;
  const child = spawn(
    node,
    [fixture, 'serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0'],
    { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false },
  );
  child.stderr.resume();
  const origin = await readUrlLine(child.stdout, WAIT_MS, NO_LOG);
  const fake = { origin, child };
  started.push(fake);
  return fake;
}

/** Ends the fake the polite way (closing stdin, like the real server) and waits for it to go. */
async function stopFake(fake: FakeServer): Promise<void> {
  fake.child.stdin.end();
  await waitForExit(fake.child, WAIT_MS);
}

/** Writes `openVsCode.serverUrl` in the user scope of the test profile (`undefined` removes it). */
async function setServerUrl(value: string | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(SERVER_URL_KEY, value, vscode.ConfigurationTarget.Global);
}

/** Stores the password of the server at `origin` through the test-only command. */
async function storePassword(origin: string, password: string): Promise<void> {
  await vscode.commands.executeCommand(TEST_SET_SERVER_PASSWORD_COMMAND_ID, { origin, password });
}

/** Points the extension at `fake` with `password` and waits for the connection to be tried. */
async function connectTo(fake: FakeServer, password = PASSWORD): Promise<void> {
  // Password first: with the setting still on the old address the new key changes nothing.
  await storePassword(fake.origin, password);
  await setServerUrl(fake.origin);
}

describe('external server', function () {
  let extensionPath: string;
  let log: LogCursor;

  before(async function () {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(
      folder,
      'no workspace folder is open: run with the `external-server` configuration of .vscode-test.mjs',
    );
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);
    extensionPath = extension.extensionPath;
    // A run that died halfway may have left the probe file of the workspace-settings case.
    await vscode.workspace.fs
      .delete(vscode.Uri.joinPath(vscode.Uri.file(folder), '.vscode'), {
        recursive: true,
        useTrash: false,
      })
      .then(undefined, () => undefined);
    await extension.activate();
  });

  beforeEach(async () => {
    log = await openLogCursor();
  });

  after(async () => {
    for (const fake of started) {
      if (fake.child.exitCode === null) await stopFake(fake);
    }
    await setServerUrl(undefined);
    await vscode.commands.executeCommand(CLEAR_SERVER_PASSWORD_COMMAND_ID);
  });

  /**
   * With the setting present from the very first activation and no password stored, nothing is
   * launched, the binary detection does not run (and does not warn about a missing binary), and
   * the state is `unauthorized` without a request (there was nobody to ask: port 9 is the
   * discard port).
   */
  it('does not launch a server nor detect a binary when serverUrl is set', async () => {
    const fromStart = await openLogFromStart();
    await fromStart.waitFor('server not available (unauthorized)', WAIT_MS);
    const text = fromStart.added();
    assert.ok(
      text.includes('binary detection skipped: openVsCode.serverUrl is set'),
      `the detection was not skipped; log:\n${text}`,
    );
    for (const forbidden of ['launching:', 'starting the server for', 'binary detection: ']) {
      assert.ok(!text.includes(forbidden), `unexpected "${forbidden}" in the log:\n${text}`);
    }
  });

  /**
   * The happy path: with the password stored and the setting on the fixture's address the
   * extension checks `/api/info`, reports the connection, opens the event stream and sends the
   * snapshot, and the password appears nowhere in the log.
   */
  it('connects to a running server, then the chat works as usual', async () => {
    const fake = await startFake(extensionPath);
    log.mark();
    await connectTo(fake);
    await log.waitFor(`connecting to the external server at ${fake.origin}`, WAIT_MS);
    await log.waitFor(
      `connected to the external server at ${fake.origin} (opencode 2.0.32)`,
      WAIT_MS,
    );
    await log.waitFor('event stream connected', WAIT_MS);
    await log.waitFor('snapshot sent (', WAIT_MS);
    log.assertAbsent('launching:');
    log.assertAbsent('starting the server for');
    const whole = (await openLogFromStart()).added();
    assert.ok(!whole.includes(PASSWORD), 'the password is in the log');
    await stopFake(fake);
  });

  /** A password the server rejects is `unauthorized`, and the wrong password is not logged. */
  it('reports a wrong password as unauthorized', async () => {
    const fake = await startFake(extensionPath);
    log.mark();
    await connectTo(fake, 'not-the-password');
    await log.waitFor('server not available (unauthorized)', WAIT_MS);
    log.assertAbsent('not-the-password');
    await stopFake(fake);
  });

  /** A v1 server and a server that is not opencode at all are both `unsupported-version`. */
  it('reports a 1.x server and a server without /api/info as unsupported-version', async () => {
    const old = await startFake(extensionPath, { version: '1.19.3' });
    log.mark();
    await connectTo(old);
    await log.waitFor('server not available (unsupported-version)', WAIT_MS);
    await stopFake(old);

    const other = await startFake(extensionPath, { mode: 'no-info' });
    log.mark();
    await connectTo(other);
    await log.waitFor('server not available (unsupported-version)', WAIT_MS);
    await stopFake(other);
  });

  /**
   * A server that went away is `unreachable`, Restart Server reconnects (it does not launch
   * anything), and there is no automatic retry.
   */
  it('reports a stopped server as unreachable and never launches one on restart', async () => {
    const fake = await startFake(extensionPath);
    log.mark();
    await connectTo(fake);
    await log.waitFor('connected to the external server at ', WAIT_MS);
    await stopFake(fake);

    log.mark();
    await vscode.commands.executeCommand(RESTART_SERVER_COMMAND_ID);
    await log.waitFor('restarting the server (command)', WAIT_MS);
    await log.waitFor('connecting to the external server at ', WAIT_MS);
    await log.waitFor('server not available (unreachable)', WAIT_MS);
    log.assertAbsent('launching:');
    // No automatic retry: a second connection attempt would log `connecting` again.
    log.mark();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    log.assertAbsent('connecting to the external server');
  });

  /** An address that is not loopback is `invalid-url`, with no request made. */
  it('reports an address that is not on this machine as invalid-url', async () => {
    log.mark();
    await setServerUrl('http://example.com:4096');
    await log.waitFor('server not available (invalid-url)', WAIT_MS);
    log.assertAbsent('connecting to the external server');
  });

  /**
   * Forgetting the password makes the connection `unauthorized`, and it STAYS so.
   *
   * Protects against the race seen in the first version of this suite (review of #11, C2): the
   * Forget comes ~200 ms after the Set, VS Code hands the deleted password back to the next read,
   * and the extension reconnected ~30 ms after reporting `unauthorized`. A `waitFor` of the
   * `unauthorized` line passed anyway, because the line was written; so after it the case waits
   * `SETTLE_MS` and checks that no connection came back and that the last state line of the log is
   * `unauthorized`. The short Set-to-Forget gap is deliberate: it is what triggers the race.
   * VERIFIED in a real VS Code 1.143.0 on Windows 11 (22/10/2026): with the fix removed this case
   * fails on the "connected to the external server" line; with it, it passes.
   */
  it('Forget Server Password removes the secret and the connection stays refused', async () => {
    const fake = await startFake(extensionPath);
    log.mark();
    await connectTo(fake);
    await log.waitFor('connected to the external server at ', WAIT_MS);
    log.mark();
    await vscode.commands.executeCommand(CLEAR_SERVER_PASSWORD_COMMAND_ID);
    await log.waitFor('server password removed (1 key(s))', WAIT_MS);
    await log.waitFor('server not available (unauthorized)', WAIT_MS);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    log.assertAbsent('connected to the external server');
    const states = log
      .added()
      .split('\n')
      .filter((line) =>
        /server not available \(|connected to the external server|connecting to the external server/.test(
          line,
        ),
      );
    const last = states[states.length - 1] ?? '(no state line)';
    assert.ok(
      last.includes('server not available (unauthorized)'),
      `the last state line is not unauthorized: ${last}\nlog:\n${log.added()}`,
    );
    await stopFake(fake);
  });

  /**
   * Emptying the setting goes back to "launch my own server": the binary detection runs again
   * (against the nonexistent path of the profile, so it cannot start anything real).
   */
  it('re-runs the binary detection when serverUrl is emptied', async () => {
    log.mark();
    await setServerUrl(undefined);
    await log.waitFor('binary detection: setting ', WAIT_MS);
    log.assertAbsent('launching:');
  });

  /**
   * A workspace cannot set `openVsCode.serverUrl` (issue #38; the scope is `machine`, issue #11).
   *
   * Protects against dropping `"scope": "machine"` from the manifest, which would let the
   * `.vscode/settings.json` of a cloned repository point the prompts and the code of the user at
   * another server. Two doors are closed: the API refuses to write the setting in the Workspace
   * scope, and a `.vscode/settings.json` that already carries it (what a clone brings) is ignored.
   * The file also sets `openVsCode.defaultModel` (scope `window`) as a positive control: once the
   * model is read, the file has been read, so "serverUrl did not change" is not an empty result.
   * After that, `SETTLE_MS` and an `assertAbsent` of the connection to the address of the file
   * (lesson: a final state, not a transitional one). The file is removed at the start and in a
   * `finally`. The Settings editor's own view is `test:visual` step 21.
   */
  it('ignores openVsCode.serverUrl written by the workspace (scope machine)', async function () {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(folder, 'no workspace folder is open');
    const vscodeDir = vscode.Uri.joinPath(folder, '.vscode');
    const settingsFile = vscode.Uri.joinPath(vscodeDir, 'settings.json');
    const config = () => vscode.workspace.getConfiguration(CONFIG_SECTION);
    const probeUrl = 'http://127.0.0.1:1';
    const removeVscodeDir = () =>
      vscode.workspace.fs.delete(vscodeDir, { recursive: true, useTrash: false });

    await removeVscodeDir().then(undefined, () => undefined);
    await assert.rejects(
      Promise.resolve(
        config().update(SERVER_URL_KEY, probeUrl, vscode.ConfigurationTarget.Workspace),
      ),
      'writing a machine-scoped setting in the Workspace scope should be refused',
    );
    const before = config().get<string>(SERVER_URL_KEY);
    log.mark();
    try {
      await vscode.workspace.fs.createDirectory(vscodeDir);
      const content = JSON.stringify({
        [`${CONFIG_SECTION}.${SERVER_URL_KEY}`]: probeUrl,
        [`${CONFIG_SECTION}.${DEFAULT_MODEL_KEY}`]: 'probe/model',
      });
      await vscode.workspace.fs.writeFile(settingsFile, new TextEncoder().encode(content));
      const deadline = Date.now() + WAIT_MS;
      while (config().get<string>(DEFAULT_MODEL_KEY) !== 'probe/model') {
        assert.ok(Date.now() < deadline, 'the workspace settings.json was never read');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      assert.strictEqual(config().get<string>(SERVER_URL_KEY), before);
      log.assertAbsent(`connecting to the external server at ${probeUrl}`);
    } finally {
      await removeVscodeDir().then(undefined, () => undefined);
      const deadline = Date.now() + WAIT_MS;
      while (config().get<string>(DEFAULT_MODEL_KEY) === 'probe/model' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });
});
