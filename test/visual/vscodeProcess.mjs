// Launches and tears down the VS Code instance that `test/visual/run.mjs` drives over CDP.
//
// Why a private instance: the run needs `--remote-debugging-port`, an isolated profile and a known
// settings.json (theme, opencode path), and must not touch the developer's own VS Code or
// `settings.json`. Everything lives under `.vscode-test/visual/` (ignored by git) and a temporary
// workspace folder created here.
//
// VERIFIED (Windows 11, VS Code 1.142.0, Node 24, 20/10/2026): this launch recipe is the one the
// manual CDP driver of that day used (Engram #934). POSIX launch and kill paths are UNVERIFIED.
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** Asks the OS for a free TCP port by binding port 0, then releases it (small race, accepted). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {net.AddressInfo} */ (server.address());
      server.close(() => resolve(port));
    });
  });
}

/**
 * Environment for the child: the parent's, minus the variables a process that descends from a VS
 * Code extension host carries. `ELECTRON_RUN_AS_NODE=1` would turn `Code.exe` into plain Node
 * (exit code 9, see `.vscode-test.mjs`), and `VSCODE_*` could attach it to the parent.
 *
 * It also points opencode's data, state and cache directories inside `xdgRoot`
 * (`XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`), so the run does not write sessions and
 * projects into the developer's real `~/.local/share/opencode`. The variables go in the env of
 * VS Code, not of the extension: the extension host inherits it and `opencode serve` inherits the
 * host's (`buildServeEnv` copies `process.env`), so production code is unchanged. VERIFIED on
 * Windows 11 with opencode 2.0.32 (20/10/2026): with these variables a fresh `opencode.db`
 * appeared under `xdgRoot/data/opencode` and the modification time of the real
 * `~/.local/share/opencode/opencode.db*` did not change, and the free default model answered
 * without `XDG_CONFIG_HOME`. POSIX UNVERIFIED.
 */
function cleanEnv(xdgRoot) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(env)) if (key.startsWith('VSCODE_')) delete env[key];
  env.XDG_DATA_HOME = path.join(xdgRoot, 'data');
  env.XDG_STATE_HOME = path.join(xdgRoot, 'state');
  env.XDG_CACHE_HOME = path.join(xdgRoot, 'cache');
  return env;
}

/** Writes (merges into) the profile's `settings.json`; returns its path. */
export function writeSettings(userDataDir, patch) {
  const file = path.join(userDataDir, 'User', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...current, ...patch }, null, 2));
  return file;
}

/**
 * Creates the temporary workspace the run opens: `src/sample.ts` (30 lines, so a link to line 20
 * is meaningful) and a `.env` whose read makes opencode ask for a permission. The content is
 * dummy; nothing here is a real secret. Returns the folder.
 */
export function createWorkspace() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'open-vs-code-visual-'));
  fs.mkdirSync(path.join(folder, 'src'));
  const lines = ['// Sample file for the visual test run.'];
  for (let line = 2; line <= 30; line++) {
    lines.push(
      line === 20
        ? 'export function greet(name: string): string { return `Hello, ${name}!`; }'
        : `export const value${String(line)} = ${String(line)};`,
    );
  }
  fs.writeFileSync(path.join(folder, 'src', 'sample.ts'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(folder, '.env'), 'API_KEY=dummy-value-not-a-secret\n');
  return folder;
}

/**
 * Starts VS Code with the extension under development, an isolated profile and a CDP port.
 *
 * Uses the same `stable` build that `@vscode/test-electron` caches in `.vscode-test/` for the
 * integration suite (downloaded on the first run). `--disable-extensions` is required (with the
 * user's extensions the extension host crashed on Windows, Engram 851) and still loads the
 * extension under development. `--disable-workspace-trust` because the extension does not
 * activate in Restricted Mode. The profile, the extensions dir and the opencode data dir
 * (`opencode-xdg`, see {@link cleanEnv}) are wiped at start so every run begins from the same
 * state.
 *
 * Returns `{ port, pid, stop }`; `stop()` kills the whole process tree (the server child of the
 * extension host included) and waits until the main process is gone.
 */
export async function startVSCode({ repoRoot, workDir, workspace, opencodePath }) {
  const executable = await downloadAndUnzipVSCode('stable');
  const userDataDir = path.join(workDir, 'user-data');
  const extensionsDir = path.join(workDir, 'extensions');
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(extensionsDir, { recursive: true, force: true });
  const xdgRoot = path.join(workDir, 'opencode-xdg');
  fs.rmSync(xdgRoot, { recursive: true, force: true });
  writeSettings(userDataDir, {
    'openVsCode.opencodePath': opencodePath,
    'workbench.startupEditor': 'none',
    'workbench.colorTheme': 'Default Dark Modern',
    'security.workspace.trust.enabled': false,
    'update.mode': 'none',
    'extensions.autoUpdate': false,
    'telemetry.telemetryLevel': 'off',
    // Issue #20 (step 9): the confirmation of a session delete is a MODAL dialog of the workbench.
    // With the native style it is an Electron message box that CDP cannot see or click; the custom
    // style draws it in the DOM (`.monaco-dialog-box`), which Playwright can press. VERIFIED on
    // Windows 11 (21/10/2026): step 9 of `npm run test:visual` found the dialog in the DOM and
    // pressed Cancel and Delete with this setting. UNVERIFIED on macOS and Linux.
    'window.dialogStyle': 'custom',
  });
  const port = await freePort();
  const detached = process.platform !== 'win32'; // own process group, to kill the tree on POSIX
  const child = spawn(
    executable,
    [
      workspace,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--disable-extensions',
      `--extensionDevelopmentPath=${repoRoot}`,
      '--disable-workspace-trust',
      '--skip-release-notes',
      '--skip-welcome',
      `--remote-debugging-port=${String(port)}`,
    ],
    { env: cleanEnv(xdgRoot), stdio: 'ignore', detached, shell: false },
  );
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const pid = child.pid;

  const stop = async () => {
    if (pid === undefined || child.exitCode !== null) return;
    if (process.platform === 'win32') {
      // Absolute path, like the extension does: a `taskkill` planted in PATH is not picked up.
      const taskkill = path.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'taskkill.exe',
      );
      spawnSync(taskkill, ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  };
  return { port, pid, stop, userDataDir, xdgRoot, exited };
}
