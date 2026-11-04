// Prepares a VS Code profile that really starts in another language (E11-i18n).
//
// Shared by `.vscode-test.mjs` (label `locale-es`) and `vscodeProcess.mjs` (`startVSCode` with
// `locale`). It lives in `test/visual/` because the fingerprint of `test:visual` hashes the files of
// that folder, and a change here changes what the step 42 window shows.
//
// Why a spike was needed (04/11/2026): `--locale=es` alone leaves VS Code in English, because the
// main process resolves the language from `<user data dir>/languagepacks.json`, and that file is NOT
// written by `--install-extension`; it appears when a window starts with the pack installed and
// extensions enabled, and only the NEXT launch then resolves `es`. So the recipe is: install the
// pack with the VS Code CLI into a private extensions dir, start one throw-away window on a private
// user data dir until `languagepacks.json` exists, kill it, and reuse that file.

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** The Marketplace id of the Spanish language pack (publisher MS-CEINTL, version 1.131 at the time). */
export const LANGUAGE_PACK_ES = 'ms-ceintl.vscode-language-pack-es';

/** The language packs the suites know, by locale: the Marketplace id that provides each. */
export const LANGUAGE_PACKS = { es: LANGUAGE_PACK_ES };

/** The environment of a child that must behave as a plain VS Code (no parent extension host). */
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(env)) if (key.startsWith('VSCODE_')) delete env[key];
  return { ...env, ...extra };
}

/**
 * Finds the `cli.js` that `code --install-extension` runs, so that the install never goes through
 * the `.cmd` shim (the repository never launches a `.cmd`). Looks next to the executable, one hash
 * folder below it (the Windows and Linux archives of 1.145.0 keep `resources/` under a commit
 * folder) and in the macOS bundle. Returns `undefined` when none exists.
 * VERIFIED on Windows 11, VS Code 1.145.0 (04/11/2026): `<root>/a717861c07/resources/app/out/cli.js`
 * installed the pack ("was successfully installed"). macOS and Linux layouts UNVERIFIED.
 */
export function findCliScript(executable) {
  const root = path.dirname(executable);
  const candidates = [
    path.join(root, 'resources', 'app', 'out', 'cli.js'),
    path.join(root, '..', 'Resources', 'app', 'out', 'cli.js'),
  ];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.push(path.join(root, entry.name, 'resources', 'app', 'out', 'cli.js'));
      }
    }
  } catch {
    // an unreadable folder just leaves the fixed candidates
  }
  return candidates.find((candidate) => fs.existsSync(candidate));
}

/** Whether `<extensionsDir>/extensions.json` lists the extension `id`. */
function hasExtension(extensionsDir, id) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(extensionsDir, 'extensions.json'), 'utf8'));
    return list.some((entry) => entry?.identifier?.id?.toLowerCase() === id.toLowerCase());
  } catch {
    return false;
  }
}

/** Kills a VS Code process tree: `taskkill /T` by absolute path on Windows, the group elsewhere. */
function killTree(child) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    spawnSync(taskkill, ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/**
 * Makes `userDataDir` + `extensionsDir` a profile in which VS Code resolves `locale` on its next
 * start, and returns the path of the `languagepacks.json` that proves it.
 *
 * Idempotent and cached: when the extensions dir already lists `packId` and the user data dir
 * already holds a `languagepacks.json` with an entry for `locale`, it does nothing (the cache of
 * `.vscode-test/` between runs). Otherwise it (1) installs the pack with the CLI (`cli.js` under
 * `ELECTRON_RUN_AS_NODE`, `shell: false`), (2) starts a throw-away window with both dirs, no
 * folder and extensions enabled, polls up to `warmupTimeoutMs` for the file and kills the tree.
 * Throws with the CLI output, the spawn error of the warm-up window or a timeout message, so a
 * failure reads as "the pack could not be set up", never as a silent English run. `executable` is the VS Code that will run the tests
 * (`downloadAndUnzipVSCode('stable')`), the same build for the install, the warm-up and the run.
 * VERIFIED by hand on Windows 11, VS Code 1.145.0 (04/11/2026, spike): after the CLI install there
 * was no `languagepacks.json`; after a launch without `--disable-extensions` there was, and a
 * second launch with `--locale=es --disable-extensions` reported `<html lang="es">` and a Spanish
 * label ("Modificador de vista activa") over CDP. The same launch with the file but not warmed up
 * (the first one) reported `en`. macOS and Linux UNVERIFIED.
 */
export async function prepareLanguagePack({
  executable,
  userDataDir,
  extensionsDir,
  packId,
  locale,
  warmupTimeoutMs = 90_000,
}) {
  const packsFile = path.join(userDataDir, 'languagepacks.json');
  const registered = () => {
    try {
      return locale in JSON.parse(fs.readFileSync(packsFile, 'utf8'));
    } catch {
      return false;
    }
  };
  if (registered() && hasExtension(extensionsDir, packId)) return packsFile;

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });
  if (!hasExtension(extensionsDir, packId)) {
    const cli = findCliScript(executable);
    if (cli === undefined) throw new Error(`no VS Code cli.js found next to ${executable}`);
    const run = spawnSync(
      executable,
      [
        cli,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        '--install-extension',
        packId,
      ],
      {
        env: cleanEnv({ ELECTRON_RUN_AS_NODE: '1' }),
        encoding: 'utf8',
        shell: false,
        timeout: 170_000,
      },
    );
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    if (run.status !== 0 || !hasExtension(extensionsDir, packId)) {
      throw new Error(`could not install ${packId} (exit ${String(run.status)}): ${output}`);
    }
  }

  const workspace = path.join(userDataDir, 'warmup-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const child = spawn(
    executable,
    [
      workspace,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--password-store=basic',
    ],
    { env: cleanEnv(), stdio: 'ignore', detached: process.platform !== 'win32', shell: false },
  );
  // Without a listener, an `error` event (ENOENT, EACCES) would be thrown as an uncaught exception;
  // with it, the loop below fails with the cause instead.
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  try {
    const deadline = Date.now() + warmupTimeoutMs;
    while (!registered()) {
      if (spawnError !== undefined) {
        throw new Error(
          `could not start the warm-up window of ${executable}: ${spawnError.message}`,
        );
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `${packsFile} has no "${locale}" entry ${String(warmupTimeoutMs)} ms after the warm-up window started`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    killTree(child);
    // Up to 10 s for the main process to be gone, so the next launch finds its files unlocked.
    if (child.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
  }
  return packsFile;
}

/**
 * {@link prepareLanguagePack} for the stable VS Code that `@vscode/test-electron` caches in
 * `.vscode-test/` (downloaded on the first call), the build the suites run.
 */
export async function prepareLanguagePackForStable(options) {
  const executable = await downloadAndUnzipVSCode('stable');
  return prepareLanguagePack({ executable, ...options });
}
