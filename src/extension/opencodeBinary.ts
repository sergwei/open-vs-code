// Finds a usable opencode v2 executable (issue #7). Pure logic: no `vscode` import, so it is
// unit-testable and the Windows/POSIX branches can be exercised on any OS by passing the
// platform in. The VS Code side (setting, log, notifications) lives in `binaryDetection.ts`.

import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** Where the chosen executable came from. */
export type BinarySource = 'setting' | 'opencode2' | 'opencode';

/** Result of running `<binary> --version`; failures carry text for the log, never throw. */
export type VersionRun = { ok: true; stdout: string } | { ok: false; detail: string };

/**
 * Everything the detection touches in the outside world, injected so tests can use fakes.
 * `env` only needs the two variables the lookup reads.
 */
export interface BinaryDeps {
  platform: NodeJS.Platform;
  env: { PATH?: string | undefined; PATHEXT?: string | undefined };
  isFile(p: string): Promise<boolean>;
  isExecutable(p: string): Promise<boolean>;
  readText(p: string): Promise<string>;
  runVersion(p: string): Promise<VersionRun>;
}

/** One candidate that was looked at, for the log. */
export interface DetectionAttempt {
  label: string;
  path?: string;
  outcome: string;
  detail: string;
}

/** What was chosen. `version` is absent only when the output had no `x.y.z`. */
export interface DetectedBinary {
  path: string;
  source: BinarySource;
  version?: string;
}

/** Discriminated result of {@link detectOpencodeBinary}; `attempts` is always present. */
export type DetectionResult =
  | { kind: 'ok'; binary: DetectedBinary & { version: string }; attempts: DetectionAttempt[] }
  | {
      kind: 'unknown-version';
      binary: DetectedBinary;
      output: string;
      attempts: DetectionAttempt[];
    }
  | {
      kind: 'unsupported';
      binary: DetectedBinary & { version: string };
      attempts: DetectionAttempt[];
    }
  | { kind: 'not-found'; attempts: DetectionAttempt[] }
  | { kind: 'invalid-setting'; value: string; reason: string; attempts: DetectionAttempt[] };

/** How the UI layer should present a result. */
export interface DetectionDescription {
  level: 'info' | 'warn';
  message: string;
  /** `none`: log only. `plain`: warning without buttons. `actions`: warning with Open Settings / Show Logs. */
  notify: 'none' | 'plain' | 'actions';
}

/** Timeout for `--version`: our own choice, not an upstream figure. HYPOTHESIS that 10 s covers a cold first run. */
const VERSION_TIMEOUT_MS = 10_000;

/** Default when PATHEXT is unset; same list cmd.exe falls back to. HYPOTHESIS (Windows docs not re-read). */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * Extracts `x.y.z` from `--version` output and returns it with its major.
 *
 * Strips ANSI colours first and searches the pattern instead of comparing text, because v2
 * prints `opencode v2.0.32` and v1 a bare `1.19.3`. Returns undefined for builds such as
 * `local`. Pre-release suffixes (`2.1.0-beta.1`) are ignored: only the numbers count.
 * VERIFIED by unit tests with literal strings (synthetic); the real v2 output format is
 * HYPOTHESIS until opencode is run (opencode-api skill, section 1).
 */
export function parseOpencodeVersion(
  stdout: string,
): { version: string; major: number } | undefined {
  // eslint-disable-next-line no-control-regex -- ESC is the point: ANSI colour codes
  const plain = stdout.replace(/\x1b\[[0-9;]*m/g, '');
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(plain);
  if (match === null) return undefined;
  return { version: `${match[1]}.${match[2]}.${match[3]}`, major: Number(match[1]) };
}

/**
 * Reads the `.exe` out of an npm-generated `.cmd` shim, or returns undefined.
 *
 * A `.cmd` cannot be spawned without a shell (EINVAL since CVE-2024-27980) and
 * `shell: true` with arguments is deprecated, so the real executable is needed
 * (HYPOTHESIS, read and not executed: nodejs.org child_process docs, "Spawning .bat and .cmd files on Windows", as
 * cited in the opencode-api skill section 1; the EINVAL itself was not reproduced here).
 * For a bin without shebang, cmd-shim writes `"%dp0%\<rel>.exe"   %*` as the last command;
 * the regex is anchored to a line start (so a `REM`/`ECHO` line cannot win) and requires
 * the trailing `%*` so the `IF EXIST "%dp0%\node.exe" (` line that shebang shims contain is
 * not mistaken for it. The capture is joined (not resolved) to the shim's directory, as
 * cmd.exe concatenates `%dp0%` textually: an absolute or UNC capture yields a path that does
 * not exist, which the caller's `isFile` check rejects. Deliberately NOT restricted to stay
 * inside the shim directory, because legitimate `.bin` shims use `%dp0%\..\`.
 * VERIFIED: the exact text of the shim that npm writes for the real @opencode/cli 2.0.32 on
 * Windows 11 (spike on 2026-10-20) is resolved to the existing `.exe`. Read in npm/cmd-shim
 * `lib/index.js` (`writeShim_`, no-shebang branch) and not executed: other cmd-shim versions and
 * the `%~dp0\` variant (assumed for pnpm), HYPOTHESIS. Shims from yarn, bun, scoop or choco
 * are UNVERIFIED: if they do not match, the candidate is discarded.
 */
export function resolveCmdShim(shimPath: string, shimText: string): string | undefined {
  const match = /^\s*"%~?dp0%?\\([^"\r\n]+?\.exe)"\s+%\*/im.exec(shimText);
  if (match === null || match[1] === undefined) return undefined;
  return path.win32.join(path.win32.dirname(shimPath), match[1]);
}

/**
 * Looks `name` up in PATH the way a terminal would, without a shell.
 *
 * Returns the first hit (same semantics as the user's terminal) plus notes for the log
 * about candidates that were skipped. Empty and relative PATH entries are ignored, since a
 * `.` entry would execute something from the current directory. Windows: tries PATHEXT
 * extensions in order, takes `.exe`/`.com` as they are, resolves `.cmd`/`.bat` shims to
 * their `.exe` (discarding the candidate if that fails) and ignores extensionless files
 * (the sh script npm leaves for Git Bash; HYPOTHESIS: cmd-shim's extensionless sh file was
 * not re-read for this, check `lib/index.js` in npm/cmd-shim). POSIX: regular file with the
 * execute bit.
 * VERIFIED only by unit tests with fake filesystems and, on Windows, one real shim test;
 * the POSIX branch with real files runs only on non-Windows hosts (UNVERIFIED on macOS).
 */
export async function findOnPath(
  name: string,
  deps: BinaryDeps,
): Promise<{ path?: string; notes: string[] }> {
  const win = deps.platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const notes: string[] = [];
  const dirs = (deps.env.PATH ?? '')
    .split(win ? ';' : ':')
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter((entry) => entry !== '' && p.isAbsolute(entry));
  const exts = win
    ? (deps.env.PATHEXT || DEFAULT_PATHEXT).split(';').filter((ext) => ext !== '')
    : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = p.join(dir, name + ext);
      if (!(await deps.isFile(candidate))) continue;
      if (!win) {
        if (await deps.isExecutable(candidate)) return { path: candidate, notes };
        notes.push(`${candidate} is not executable`);
        continue;
      }
      const lower = ext.toLowerCase();
      if (lower === '.exe' || lower === '.com') return { path: candidate, notes };
      if (lower === '.cmd' || lower === '.bat') {
        const resolved = await resolveShimFile(candidate, deps);
        if (resolved !== undefined) return { path: resolved, notes };
        notes.push(`${candidate} is a shim without a resolvable .exe; discarded`);
      }
    }
  }
  return { notes };
}

/** Reads a shim and returns its `.exe` only if that file exists; undefined otherwise. */
async function resolveShimFile(shimPath: string, deps: BinaryDeps): Promise<string | undefined> {
  let text: string;
  try {
    text = await deps.readText(shimPath);
  } catch {
    return undefined;
  }
  const exe = resolveCmdShim(shimPath, text);
  if (exe === undefined || !(await deps.isFile(exe))) return undefined;
  return exe;
}

/**
 * Finds the opencode v2 executable to use (issue #7).
 *
 * With `settingPath` set, only that path is tried and PATH is never consulted (an explicit
 * choice must not silently fall back). Otherwise `opencode2` then `opencode` are looked up
 * in PATH, because npm installs both names while brew's `opencode-v2` installs only
 * `opencode` (VERIFIED: `npm view @opencode/cli@2.0.32 bin` and `opencode-v2.rb` in
 * anomalyco/homebrew-tap, read 2026-10-20 per the opencode-api skill section 1; no install
 * was run). Every distinct candidate is executed with `--version` until one has major 2;
 * that one wins. Failing that, the first unparseable version is accepted with a warning
 * (`unknown-version`), then the first other major is reported as `unsupported`, else
 * `not-found`. A candidate that exits non-zero, times out or cannot run (for example the
 * placeholder `npm i --ignore-scripts` leaves) is recorded and skipped. A relative or
 * missing setting yields `invalid-setting`, and so does a setting whose binary exists but
 * cannot be run (the text must not tell the user to set what is already set). Never throws and has no side effects beyond the
 * injected `deps`; nothing is cached.
 * VERIFIED with fake dependencies and, on this Windows host, real child processes
 * (`node.exe` standing in for opencode). VERIFIED against a real opencode 2.0.32 install (npm
 * @opencode/cli, Windows 11, spike on 2026-10-20): detection through `opencode2` on PATH and
 * the resolution of its npm shim to the `.exe`. UNVERIFIED on macOS/Linux and for installs
 * other than npm.
 */
export async function detectOpencodeBinary(
  options: { settingPath: string },
  deps: BinaryDeps,
): Promise<DetectionResult> {
  const attempts: DetectionAttempt[] = [];
  const candidates: { source: BinarySource; path: string }[] = [];
  const p = deps.platform === 'win32' ? path.win32 : path.posix;

  if (options.settingPath !== '') {
    const value = options.settingPath;
    const invalid = (reason: string): DetectionResult => {
      attempts.push({ label: 'setting', path: value, outcome: 'invalid', detail: reason });
      return { kind: 'invalid-setting', value, reason, attempts };
    };
    if (!p.isAbsolute(value)) return invalid('the path is not absolute');
    if (!(await deps.isFile(value))) return invalid('the file does not exist');
    let target = value;
    if (deps.platform === 'win32' && /\.(cmd|bat)$/i.test(value)) {
      const resolved = await resolveShimFile(value, deps);
      if (resolved === undefined)
        return invalid('a .cmd/.bat shim cannot be launched; point to the .exe behind it');
      target = resolved;
    }
    candidates.push({ source: 'setting', path: target });
  } else {
    for (const name of ['opencode2', 'opencode'] as const) {
      const found = await findOnPath(name, deps);
      for (const note of found.notes)
        attempts.push({ label: name, outcome: 'skipped', detail: note });
      if (found.path === undefined) {
        attempts.push({ label: name, outcome: 'not-on-path', detail: `no ${name} in PATH` });
      } else if (candidates.some((c) => c.path === found.path)) {
        attempts.push({
          label: name,
          path: found.path,
          outcome: 'duplicate',
          detail: 'same file as an earlier candidate',
        });
      } else {
        candidates.push({ source: name, path: found.path });
      }
    }
  }

  let firstUnknown: { binary: DetectedBinary; output: string } | undefined;
  let firstUnsupported: (DetectedBinary & { version: string }) | undefined;

  for (const candidate of candidates) {
    const run = await deps.runVersion(candidate.path);
    if (!run.ok) {
      attempts.push({
        label: candidate.source,
        path: candidate.path,
        outcome: 'run-failed',
        detail: run.detail,
      });
      continue;
    }
    const parsed = parseOpencodeVersion(run.stdout);
    if (parsed === undefined) {
      const output = run.stdout.trim();
      attempts.push({
        label: candidate.source,
        path: candidate.path,
        outcome: 'unknown-version',
        detail: `no x.y.z in output: ${JSON.stringify(output)}`,
      });
      firstUnknown ??= { binary: { path: candidate.path, source: candidate.source }, output };
    } else if (parsed.major === 2) {
      attempts.push({
        label: candidate.source,
        path: candidate.path,
        outcome: 'ok',
        detail: `version ${parsed.version}`,
      });
      return {
        kind: 'ok',
        binary: { path: candidate.path, source: candidate.source, version: parsed.version },
        attempts,
      };
    } else {
      attempts.push({
        label: candidate.source,
        path: candidate.path,
        outcome: 'unsupported',
        detail: `version ${parsed.version}, major ${parsed.major}`,
      });
      firstUnsupported ??= {
        path: candidate.path,
        source: candidate.source,
        version: parsed.version,
      };
    }
  }

  if (firstUnknown !== undefined) return { kind: 'unknown-version', ...firstUnknown, attempts };
  if (firstUnsupported !== undefined)
    return { kind: 'unsupported', binary: firstUnsupported, attempts };
  if (options.settingPath !== '') {
    return {
      kind: 'invalid-setting',
      value: options.settingPath,
      reason: 'the configured binary could not be run (see the log for details)',
      attempts,
    };
  }
  return { kind: 'not-found', attempts };
}

/**
 * Turns a detection result into the log level, user-facing text and kind of notification.
 *
 * User text is built here, in English (public repo), so tests can pin it. v1 gets a plain
 * "requires v2" warning with no install guidance and no compatibility mode (Sergio's
 * decision, Engram 848). A successful detection only logs. VERIFIED by unit tests; how the
 * texts look in VS Code is UNVERIFIED until Sergio runs F5.
 */
export function describeDetection(result: DetectionResult): DetectionDescription {
  switch (result.kind) {
    case 'ok':
      return {
        level: 'info',
        message: `Using opencode ${result.binary.version} at ${result.binary.path} (${result.binary.source}).`,
        notify: 'none',
      };
    case 'unknown-version':
      return {
        level: 'warn',
        message: `Could not read the version of the opencode binary at ${result.binary.path} (output: ${JSON.stringify(result.output)}). Continuing anyway; open-vs-code requires opencode v2.`,
        notify: 'plain',
      };
    case 'unsupported':
      return {
        level: 'warn',
        message: `open-vs-code requires opencode v2 (found ${result.binary.version} at ${result.binary.path}).`,
        notify: 'plain',
      };
    case 'invalid-setting':
      return {
        level: 'warn',
        message: `The setting openVsCode.opencodePath is invalid: ${result.reason} (${result.value}).`,
        notify: 'actions',
      };
    case 'not-found':
      return {
        level: 'warn',
        message:
          'No usable opencode v2 binary was found. Set openVsCode.opencodePath or put opencode on your PATH.',
        notify: 'actions',
      };
  }
}

/**
 * Builds the real dependencies: `process`, `node:fs` and `execFile`.
 *
 * `execFile` runs with `shell: false`, an argument array and `windowsHide`, so nothing goes
 * through cmd.exe. `process.env` is case-insensitive on Windows, so `PATH`/`PATHEXT` work
 * whatever their spelling there (HYPOTHESIS, read in the Node docs and not executed, process.env, 2026-10-20).
 * `runVersion` never rejects: exit codes, ENOENT, EACCES/ENOEXEC and timeouts become
 * `{ ok: false, detail }` with the stderr (first 300 chars) for the log.
 * VERIFIED on Windows 11 by a test that runs `node --version` through it; POSIX UNVERIFIED.
 *
 * `launchFor` (issue #41) maps the path to the command that really runs; the default is the path
 * itself with no extra args, i.e. the behaviour above. Only the seam of `testLaunch.ts` (test
 * hosts, and the visual run's explicit opt-in) passes something else (a `.mjs` stand-in run
 * through Node); `--version` is appended after the args it returns.
 */
export function nodeDeps(
  launchFor: (p: string) => { command: string; args: string[] } = (p) => ({
    command: p,
    args: [],
  }),
): BinaryDeps {
  return {
    platform: process.platform,
    env: { PATH: process.env['PATH'], PATHEXT: process.env['PATHEXT'] },
    isFile: async (p) => {
      try {
        return (await stat(p)).isFile();
      } catch {
        return false;
      }
    },
    isExecutable: async (p) => {
      try {
        await access(p, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    readText: (p) => readFile(p, 'utf8'),
    runVersion: (p) =>
      new Promise<VersionRun>((resolve) => {
        const { command, args } = launchFor(p);
        execFile(
          command,
          [...args, '--version'],
          { timeout: VERSION_TIMEOUT_MS, windowsHide: true, shell: false, encoding: 'utf8' },
          (error, stdout, stderr) => {
            if (error === null) {
              resolve({ ok: true, stdout });
              return;
            }
            // `killed` is also true when maxBuffer is exceeded, so check that code first.
            const reason =
              error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                ? 'output exceeded maxBuffer'
                : error.killed
                  ? `timed out after ${VERSION_TIMEOUT_MS} ms`
                  : error.message;
            const extra = stderr.trim().slice(0, 300);
            resolve({ ok: false, detail: extra === '' ? reason : `${reason}; stderr: ${extra}` });
          },
        );
      }),
  };
}
