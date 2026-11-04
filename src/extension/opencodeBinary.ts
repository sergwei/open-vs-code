// Finds a usable opencode v2 executable (issue #7). Pure logic: no `vscode` import, so it is
// unit-testable and the Windows/POSIX branches can be exercised on any OS by passing the
// platform in. The VS Code side (setting, log, notifications) lives in `binaryDetection.ts`.

import * as l10n from '@vscode/l10n';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { BinaryCheck, BinaryDiagnosis } from '../shared/protocol';
import { bothTexts, inEnglish, type BothTexts } from './l10nEnglish';

/** Where the chosen executable came from. */
export type BinarySource = 'setting' | 'opencode2' | 'opencode';

/** Result of running `<binary> --version`; failures carry text for the log, never throw. */
export type VersionRun =
  { ok: true; stdout: string } | { ok: false; detail: string; logDetail?: string };

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

/**
 * One candidate that was looked at, for the log and, since E2 (issue #85), for the chat's setup
 * guide through {@link diagnoseDetection}. `label` and `outcome` are closed unions (they were
 * plain strings) so the diagnosis crosses to the webview without a cast; every value is one
 * `detectOpencodeBinary` pushes itself.
 */
export interface DetectionAttempt {
  label: BinarySource;
  path?: string;
  outcome:
    | 'invalid'
    | 'not-on-path'
    | 'skipped'
    | 'duplicate'
    | 'run-failed'
    | 'unknown-version'
    | 'ok'
    | 'unsupported';
  /** In the language of VS Code: what the chat's setup guide prints. */
  detail: string;
  /** The same text in English: what the OutputChannel prints. */
  logDetail: string;
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
  | {
      kind: 'invalid-setting';
      value: string;
      /** In the language of VS Code, for the user. */
      reason: string;
      /** The same reason in English, for the log. */
      logReason: string;
      attempts: DetectionAttempt[];
    };

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
 * Returns the first hit (same semantics as the user's terminal) plus notes about candidates that
 * were skipped, in the language of VS Code (`notes`) and in English for the log (`logNotes`, same
 * order and length). Empty and relative PATH entries are ignored, since a
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
): Promise<{ path?: string; notes: string[]; logNotes: string[] }> {
  const win = deps.platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const notes: string[] = [];
  const logNotes: string[] = [];
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
        if (await deps.isExecutable(candidate)) return { path: candidate, notes, logNotes };
        const note = bothTexts(() => l10n.t('{0} is not executable', candidate));
        notes.push(note.message);
        logNotes.push(note.logMessage);
        continue;
      }
      const lower = ext.toLowerCase();
      if (lower === '.exe' || lower === '.com') return { path: candidate, notes, logNotes };
      if (lower === '.cmd' || lower === '.bat') {
        const resolved = await resolveShimFile(candidate, deps);
        if (resolved !== undefined) return { path: resolved, notes, logNotes };
        const note = bothTexts(() =>
          l10n.t('{0} is a shim without a resolvable .exe; discarded', candidate),
        );
        notes.push(note.message);
        logNotes.push(note.logMessage);
      }
    }
  }
  return { notes, logNotes };
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
 * injected `deps`; nothing is cached. Every text it stores is written twice with `bothTexts`: the
 * `detail` of each attempt and the `reason` of an invalid setting in the language of VS Code (the
 * chat's setup guide and the warning print them), and their `logDetail` / `logReason` in English
 * (the OutputChannel prints those). VERIFIED by `opencodeBinary.test.ts` ("keeps a Spanish detail
 * for the user and an English logDetail for the log" and "describes an invalid setting in Spanish
 * for the user and in English for the log"); only the `not-on-path` attempt and the `invalid-setting`
 * reason are exercised in Spanish, the other twins are written the same way.
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
    const invalid = (text: BothTexts): DetectionResult => {
      attempts.push({
        label: 'setting',
        path: value,
        outcome: 'invalid',
        detail: text.message,
        logDetail: text.logMessage,
      });
      return {
        kind: 'invalid-setting',
        value,
        reason: text.message,
        logReason: text.logMessage,
        attempts,
      };
    };
    if (!p.isAbsolute(value)) return invalid(bothTexts(() => l10n.t('the path is not absolute')));
    if (!(await deps.isFile(value)))
      return invalid(bothTexts(() => l10n.t('the file does not exist')));
    let target = value;
    if (deps.platform === 'win32' && /\.(cmd|bat)$/i.test(value)) {
      const resolved = await resolveShimFile(value, deps);
      if (resolved === undefined)
        return invalid(
          bothTexts(() =>
            l10n.t('a .cmd/.bat shim cannot be launched; point to the .exe behind it'),
          ),
        );
      target = resolved;
    }
    candidates.push({ source: 'setting', path: target });
  } else {
    for (const name of ['opencode2', 'opencode'] as const) {
      const found = await findOnPath(name, deps);
      found.notes.forEach((note, i) =>
        attempts.push({
          label: name,
          outcome: 'skipped',
          detail: note,
          logDetail: found.logNotes[i] ?? note,
        }),
      );
      if (found.path === undefined) {
        const text = bothTexts(() => l10n.t('no {0} in PATH', name));
        attempts.push({
          label: name,
          outcome: 'not-on-path',
          detail: text.message,
          logDetail: text.logMessage,
        });
      } else if (candidates.some((c) => c.path === found.path)) {
        const text = bothTexts(() => l10n.t('same file as an earlier candidate'));
        attempts.push({
          label: name,
          path: found.path,
          outcome: 'duplicate',
          detail: text.message,
          logDetail: text.logMessage,
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
        logDetail: run.logDetail ?? run.detail,
      });
      continue;
    }
    const parsed = parseOpencodeVersion(run.stdout);
    if (parsed === undefined) {
      const output = run.stdout.trim();
      const text = bothTexts(() => l10n.t('no x.y.z in output: {0}', JSON.stringify(output)));
      attempts.push({
        label: candidate.source,
        path: candidate.path,
        outcome: 'unknown-version',
        detail: text.message,
        logDetail: text.logMessage,
      });
      firstUnknown ??= { binary: { path: candidate.path, source: candidate.source }, output };
    } else if (parsed.major === 2) {
      const text = bothTexts(() => l10n.t('version {0}', parsed.version));
      attempts.push({
        label: candidate.source,
        path: candidate.path,
        outcome: 'ok',
        detail: text.message,
        logDetail: text.logMessage,
      });
      return {
        kind: 'ok',
        binary: { path: candidate.path, source: candidate.source, version: parsed.version },
        attempts,
      };
    } else {
      const text = bothTexts(() => l10n.t('version {0}, major {1}', parsed.version, parsed.major));
      attempts.push({
        label: candidate.source,
        path: candidate.path,
        outcome: 'unsupported',
        detail: text.message,
        logDetail: text.logMessage,
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
    const text = bothTexts(() =>
      l10n.t('the configured binary could not be run (see the log for details)'),
    );
    return {
      kind: 'invalid-setting',
      value: options.settingPath,
      reason: text.message,
      logReason: text.logMessage,
      attempts,
    };
  }
  return { kind: 'not-found', attempts };
}

/**
 * Turns a detection result into the log level, user-facing text and kind of notification.
 *
 * User text is built here, in the language of VS Code through `l10n.t` (English when no catalog is
 * loaded, which is what the tests pin). The log does NOT get this translated text: its callers use
 * {@link describeDetectionForLog}, which runs this function again through `inEnglish` with the
 * English `logReason` of an invalid setting (the `reason` is translated when the detection runs, so
 * a second evaluation alone would not turn it back; decision of Sergio, E11-i18n: logs stay in
 * English), so the function stays the only place with the message literals. v1 gets a plain
 * "requires v2" warning with no install guidance and no compatibility mode (Sergio's
 * decision, Engram 848). A successful detection only logs. VERIFIED by unit tests; how the
 * texts look in VS Code is UNVERIFIED until Sergio runs F5.
 */
export function describeDetection(result: DetectionResult): DetectionDescription {
  switch (result.kind) {
    case 'ok':
      return {
        level: 'info',
        message: l10n.t(
          'Using opencode {0} at {1} ({2}).',
          result.binary.version,
          result.binary.path,
          result.binary.source,
        ),
        notify: 'none',
      };
    case 'unknown-version':
      return {
        level: 'warn',
        message: l10n.t(
          'Could not read the version of the opencode binary at {0} (output: {1}). Continuing anyway; open-vs-code requires opencode v2.',
          result.binary.path,
          JSON.stringify(result.output),
        ),
        notify: 'plain',
      };
    case 'unsupported':
      return {
        level: 'warn',
        message: l10n.t(
          'open-vs-code requires opencode v2 (found {0} at {1}).',
          result.binary.version,
          result.binary.path,
        ),
        notify: 'plain',
      };
    case 'invalid-setting':
      return {
        level: 'warn',
        message: l10n.t(
          'The setting openVsCode.opencodePath is invalid: {0} ({1}).',
          result.reason,
          result.value,
        ),
        notify: 'actions',
      };
    case 'not-found':
      return {
        level: 'warn',
        message: l10n.t(
          'No usable opencode v2 binary was found. Set openVsCode.opencodePath or put opencode on your PATH.',
        ),
        notify: 'actions',
      };
  }
}

/**
 * The {@link describeDetection} text for the OutputChannel: always English, whatever the language
 * of VS Code. An invalid setting carries its reason in both languages, so the English one is
 * swapped in before the second evaluation.
 * VERIFIED by `opencodeBinary.test.ts` ("describes an invalid setting in Spanish for the user and
 * in English for the log").
 */
export function describeDetectionForLog(result: DetectionResult): DetectionDescription {
  const forLog =
    result.kind === 'invalid-setting' ? { ...result, reason: result.logReason } : result;
  return inEnglish(() => describeDetection(forLog));
}

/** Longest `detail` the diagnosis carries: the same 300-character cap `nodeDeps` puts on stderr. */
const MAX_CHECK_DETAIL = 300;

/**
 * Turns the attempts of a failed detection into the {@link BinaryDiagnosis} the chat shows, so the
 * setup guide can say what was searched and where (E2, issue #85, plan section 5).
 *
 * Pure. `settingPath` is the trimmed `openVsCode.opencodePath` the caller knows was set; when it
 * is empty but an attempt came from the setting (`label === 'setting'`, e.g. a setting that points
 * at an opencode v1, which the caller does not report as `invalid-setting`), that attempt's path
 * is used instead, so the guide never says the setting "is not set" while listing its value. It is
 * omitted only when neither exists. Every attempt becomes one check in the same order;
 * `detail` is cut to 300 characters (the cap `nodeDeps` already applies to stderr, so nothing
 * normally changes). Paths and details are text for the webview to print, never markup, and they
 * carry no port or password (architecture rule 1). `result.kind` does not change the output: the
 * attempts already hold what each kind was decided from.
 * VERIFIED by unit tests with literal attempts (synthetic, not a real detection). VERIFIED on
 * Windows 11 with VS Code 1.143.1 (27/10/2026): the visual check "step 1 says which
 * openVsCode.opencodePath value was searched (the missing file)" passed with a real detection of a
 * missing setting file. Not observed in a real window: a setting that points at a v1 binary.
 */
export function diagnoseDetection(result: DetectionResult, settingPath: string): BinaryDiagnosis {
  const checks: BinaryCheck[] = result.attempts.map((attempt) => ({
    source: attempt.label,
    ...(attempt.path === undefined ? {} : { path: attempt.path }),
    outcome: attempt.outcome,
    detail:
      attempt.detail.length > MAX_CHECK_DETAIL
        ? attempt.detail.slice(0, MAX_CHECK_DETAIL)
        : attempt.detail,
  }));
  const fromAttempt = result.attempts.find((a) => a.label === 'setting' && a.path !== undefined);
  const effective = settingPath !== '' ? settingPath : (fromAttempt?.path ?? '');
  return { ...(effective === '' ? {} : { settingPath: effective }), checks };
}

/**
 * Builds the real dependencies: `process`, `node:fs` and `execFile`.
 *
 * `execFile` runs with `shell: false`, an argument array and `windowsHide`, so nothing goes
 * through cmd.exe. `process.env` is case-insensitive on Windows, so `PATH`/`PATHEXT` work
 * whatever their spelling there (HYPOTHESIS, read in the Node docs and not executed, process.env, 2026-10-20).
 * `runVersion` never rejects: exit codes, ENOENT, EACCES/ENOEXEC and timeouts become
 * `{ ok: false, detail, logDetail }` with the stderr (first 300 chars): `detail` in the language of
 * VS Code, `logDetail` its English twin for the log.
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
            const extra = stderr.trim().slice(0, 300);
            // One producer evaluated twice (user language, English for the log). `killed` is also
            // true when maxBuffer is exceeded, so check that code first.
            const text = bothTexts(() => {
              const reason =
                error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                  ? l10n.t('output exceeded maxBuffer')
                  : error.killed
                    ? l10n.t('timed out after {0} ms', VERSION_TIMEOUT_MS)
                    : error.message;
              return extra === '' ? reason : l10n.t('{0}; stderr: {1}', reason, extra);
            });
            resolve({ ok: false, detail: text.message, logDetail: text.logMessage });
          },
        );
      }),
  };
}
