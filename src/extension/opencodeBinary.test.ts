import { chmod, copyFile, link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPENCODE_PATH_SETTING } from './ids';
import {
  describeDetection,
  detectOpencodeBinary,
  findOnPath,
  nodeDeps,
  parseOpencodeVersion,
  resolveCmdShim,
  type BinaryDeps,
  type VersionRun,
} from './opencodeBinary';

// Protects issue #7 (binary detection) from regressions in version parsing, PATH/PATHEXT
// lookup, shim resolution and result selection.
//
// SYNTHETIC: sections 1-6 use fake filesystems and fake `--version` outputs written by hand,
// including the cmd-shim text (copied from the generator in npm/cmd-shim `lib/index.js`,
// read 2026-10-20, not from a real install). They prove our logic, NOT that a real opencode
// prints these strings or that a real npm shim looks like this. opencode is not installed on
// the development machine. Sections 7-9 run real child processes, but the "binary" is
// node.exe or an sh script standing in for opencode. Shim fixtures are inline strings with
// explicit \r\n because .gitattributes (eol=lf) would rewrite a fixture file.

/** Real-looking cmd-shim for a bin without shebang (what @opencode/cli gets). */
const OPENCODE_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  '"%dp0%\\node_modules\\@opencode\\cli\\bin\\opencode.exe"   %*',
  '',
].join('\r\n');

/** cmd-shim for a bin with a node shebang: must NOT resolve to the node.exe it probes. */
const NODE_SHEBANG_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\x\\x.js" %*',
  '',
].join('\r\n');

interface FakeOptions {
  platform: NodeJS.Platform;
  path?: string;
  pathext?: string;
  files?: string[];
  executable?: string[];
  texts?: Record<string, string>;
  versions?: Record<string, VersionRun>;
}

/** Builds fake dependencies and records which binaries got executed. */
function fakeDeps(options: FakeOptions): { deps: BinaryDeps; ran: string[] } {
  const files = new Set(options.files ?? []);
  const executable = new Set(options.executable ?? []);
  const ran: string[] = [];
  const deps: BinaryDeps = {
    platform: options.platform,
    env: { PATH: options.path, PATHEXT: options.pathext },
    isFile: (p) => Promise.resolve(files.has(p)),
    isExecutable: (p) => Promise.resolve(executable.has(p)),
    readText: (p) => {
      const text = options.texts?.[p];
      return text === undefined ? Promise.reject(new Error(`ENOENT ${p}`)) : Promise.resolve(text);
    },
    runVersion: (p) => {
      ran.push(p);
      return Promise.resolve(options.versions?.[p] ?? { ok: false, detail: 'not faked' });
    },
  };
  return { deps, ran };
}

/** Shorthand for a successful `--version` run printing `stdout`. */
const ok = (stdout: string): VersionRun => ({ ok: true, stdout });

describe('parseOpencodeVersion', () => {
  it('reads the v2 format', () => {
    expect(parseOpencodeVersion('opencode v2.0.32\n')).toEqual({ version: '2.0.32', major: 2 });
  });
  it('reads the bare v1 format', () => {
    expect(parseOpencodeVersion('1.19.3')).toEqual({ version: '1.19.3', major: 1 });
  });
  it('strips ANSI colour codes', () => {
    expect(parseOpencodeVersion('\x1b[1mopencode\x1b[0m v\x1b[32m2.0.32\x1b[0m')?.major).toBe(2);
  });
  it('returns undefined for a local build', () => {
    expect(parseOpencodeVersion('local')).toBeUndefined();
  });
  it('ignores pre-release suffixes and CRLF', () => {
    expect(parseOpencodeVersion('2.1.0-beta.1\r\n')).toEqual({ version: '2.1.0', major: 2 });
  });
});

describe('findOnPath (win32, fake filesystem)', () => {
  it('skips ".", empty, quoted-empty and relative entries, unquotes the rest', async () => {
    // path.win32.join('.', 'opencode.EXE') and join('', ...) both give 'opencode.EXE', so that
    // file is what the `.` and `""` entries would hit if the isAbsolute filter were removed.
    const { deps } = fakeDeps({
      platform: 'win32',
      path: '.;;"";relative\\bin;"C:\\Tools"',
      pathext: '.EXE',
      files: ['C:\\Tools\\opencode.EXE', 'relative\\bin\\opencode.EXE', 'opencode.EXE'],
    });
    expect((await findOnPath('opencode', deps)).path).toBe('C:\\Tools\\opencode.EXE');
  });
  it('honours PATHEXT order inside one directory', async () => {
    const { deps } = fakeDeps({
      platform: 'win32',
      path: 'C:\\bin',
      pathext: '.EXE;.CMD',
      files: ['C:\\bin\\opencode.EXE', 'C:\\bin\\opencode.CMD'],
    });
    expect((await findOnPath('opencode', deps)).path).toBe('C:\\bin\\opencode.EXE');
  });
  it('ignores the extensionless sh script npm leaves for Git Bash', async () => {
    const { deps } = fakeDeps({ platform: 'win32', path: 'C:\\bin', files: ['C:\\bin\\opencode'] });
    expect((await findOnPath('opencode', deps)).path).toBeUndefined();
  });
  it('first directory with a hit wins', async () => {
    const { deps } = fakeDeps({
      platform: 'win32',
      path: 'C:\\a;C:\\b',
      pathext: '.EXE',
      files: ['C:\\a\\opencode.EXE', 'C:\\b\\opencode.EXE'],
    });
    expect((await findOnPath('opencode', deps)).path).toBe('C:\\a\\opencode.EXE');
  });
  it('falls back to the default PATHEXT when unset', async () => {
    const { deps } = fakeDeps({
      platform: 'win32',
      path: 'C:\\bin',
      files: ['C:\\bin\\opencode.EXE'],
    });
    expect((await findOnPath('opencode', deps)).path).toBe('C:\\bin\\opencode.EXE');
  });
  it('resolves a .cmd shim to the real .exe', async () => {
    const shim = 'C:\\npm\\opencode2.CMD';
    const exe = 'C:\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe';
    const { deps } = fakeDeps({
      platform: 'win32',
      path: 'C:\\npm',
      pathext: '.CMD',
      files: [shim, exe],
      texts: { [shim]: OPENCODE_SHIM },
    });
    expect((await findOnPath('opencode2', deps)).path).toBe(exe);
  });
  it('discards a shim whose .exe does not exist and keeps searching', async () => {
    const shim = 'C:\\npm\\opencode2.CMD';
    const { deps } = fakeDeps({
      platform: 'win32',
      path: 'C:\\npm;C:\\other',
      pathext: '.CMD',
      files: [shim, 'C:\\other\\opencode2.CMD'],
      texts: { [shim]: OPENCODE_SHIM, 'C:\\other\\opencode2.CMD': NODE_SHEBANG_SHIM },
    });
    const found = await findOnPath('opencode2', deps);
    expect(found.path).toBeUndefined();
    expect(found.notes).toHaveLength(2);
  });
});

describe('findOnPath (posix, fake filesystem)', () => {
  it('skips a file without the execute bit and a directory with that name', async () => {
    const { deps } = fakeDeps({
      platform: 'linux',
      path: '/a:/b:/c',
      files: ['/b/opencode', '/c/opencode'],
      executable: ['/c/opencode'],
    });
    const found = await findOnPath('opencode', deps);
    expect(found.path).toBe('/c/opencode');
    expect(found.notes).toEqual(['/b/opencode is not executable']);
  });
});

describe('resolveCmdShim', () => {
  it('resolves the no-shebang cmd-shim form against the shim directory', () => {
    expect(resolveCmdShim('C:\\npm\\opencode.cmd', OPENCODE_SHIM)).toBe(
      'C:\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe',
    );
  });
  it('does not mistake the node shebang form for an exe shim', () => {
    expect(resolveCmdShim('C:\\npm\\x.cmd', NODE_SHEBANG_SHIM)).toBeUndefined();
  });
  it('returns undefined for garbage', () => {
    expect(resolveCmdShim('C:\\npm\\x.cmd', 'hello\r\nworld')).toBeUndefined();
  });
  it('does not let an embedded absolute path escape the shim directory', () => {
    // cmd.exe concatenates %dp0% textually, so this is `C:\npm\C:\Windows\...`, not calc.exe.
    // Regression for review finding 2 (a probe showed `resolve` returned calc.exe).
    const out = resolveCmdShim(
      'C:\\npm\\opencode.cmd',
      '"%dp0%\\C:\\Windows\\System32\\calc.exe" %*',
    );
    expect(out).not.toBe('C:\\Windows\\System32\\calc.exe');
    expect(out?.startsWith('C:\\npm\\')).toBe(true);
  });
  it('ignores a REM line before the real command', () => {
    const text = ['REM "%dp0%\\evil.exe" %*', '"%dp0%\\real.exe" %*', ''].join('\r\n');
    expect(resolveCmdShim('C:\\npm\\opencode.cmd', text)).toBe('C:\\npm\\real.exe');
  });
  it('accepts the %~dp0\\ variant (HYPOTHESIS: pnpm style)', () => {
    expect(
      resolveCmdShim('C:\\p\\opencode.cmd', '"%~dp0\\node_modules\\o\\bin\\opencode.exe" %*'),
    ).toBe('C:\\p\\node_modules\\o\\bin\\opencode.exe');
  });
});

describe('detectOpencodeBinary', () => {
  const base = {
    platform: 'linux' as const,
    path: '/bin',
    files: ['/bin/opencode2', '/bin/opencode'],
    executable: ['/bin/opencode2', '/bin/opencode'],
  };

  it('opencode2 with v2 wins and opencode is never executed', async () => {
    const { deps, ran } = fakeDeps({
      ...base,
      versions: {
        '/bin/opencode2': ok('opencode v2.0.32'),
        '/bin/opencode': ok('opencode v2.0.32'),
      },
    });
    const result = await detectOpencodeBinary({ settingPath: '' }, deps);
    expect(result.kind).toBe('ok');
    expect(ran).toEqual(['/bin/opencode2']);
  });
  it('reports v1 as unsupported', async () => {
    const { deps } = fakeDeps({
      platform: 'linux',
      path: '/bin',
      files: ['/bin/opencode'],
      executable: ['/bin/opencode'],
      versions: { '/bin/opencode': ok('1.19.3') },
    });
    const result = await detectOpencodeBinary({ settingPath: '' }, deps);
    expect(result).toMatchObject({
      kind: 'unsupported',
      binary: { version: '1.19.3', source: 'opencode' },
    });
  });
  it('reports not-found when nothing is on PATH', async () => {
    const { deps } = fakeDeps({ platform: 'linux', path: '/bin' });
    const result = await detectOpencodeBinary({ settingPath: '' }, deps);
    expect(result.kind).toBe('not-found');
    expect(result.attempts.map((a) => a.outcome)).toEqual(['not-on-path', 'not-on-path']);
  });
  it('skips a broken opencode2 (npm --ignore-scripts placeholder) and tries opencode', async () => {
    const { deps } = fakeDeps({
      ...base,
      versions: {
        '/bin/opencode2': {
          ok: false,
          detail: "Error: @opencode/cli's postinstall script was not run.",
        },
        '/bin/opencode': ok('opencode v2.0.32'),
      },
    });
    const result = await detectOpencodeBinary({ settingPath: '' }, deps);
    expect(result).toMatchObject({ kind: 'ok', binary: { source: 'opencode' } });
    expect(result.attempts[0]?.outcome).toBe('run-failed');
  });
  it('accepts an unparseable version with a warning', async () => {
    const { deps } = fakeDeps({
      ...base,
      versions: { '/bin/opencode2': ok('local'), '/bin/opencode': ok('1.19.3') },
    });
    const result = await detectOpencodeBinary({ settingPath: '' }, deps);
    expect(result).toMatchObject({ kind: 'unknown-version', output: 'local' });
  });
  it('prefers a later major 2 over an earlier unknown version', async () => {
    const { deps } = fakeDeps({
      ...base,
      versions: { '/bin/opencode2': ok('local'), '/bin/opencode': ok('2.0.1') },
    });
    expect((await detectOpencodeBinary({ settingPath: '' }, deps)).kind).toBe('ok');
  });
  it('treats major 3 as unsupported', async () => {
    const { deps } = fakeDeps({ ...base, versions: { '/bin/opencode2': ok('3.0.0') } });
    expect((await detectOpencodeBinary({ settingPath: '' }, deps)).kind).toBe('unsupported');
  });
  it('with a setting, tries only that path and ignores PATH', async () => {
    const { deps, ran } = fakeDeps({
      ...base,
      files: [...base.files, '/opt/oc'],
      versions: { '/opt/oc': ok('2.0.32'), '/bin/opencode2': ok('2.0.32') },
    });
    const result = await detectOpencodeBinary({ settingPath: '/opt/oc' }, deps);
    expect(result).toMatchObject({ kind: 'ok', binary: { source: 'setting', path: '/opt/oc' } });
    expect(ran).toEqual(['/opt/oc']);
  });
  it('rejects a relative setting', async () => {
    const { deps } = fakeDeps(base);
    expect(await detectOpencodeBinary({ settingPath: 'bin/opencode' }, deps)).toMatchObject({
      kind: 'invalid-setting',
      reason: 'the path is not absolute',
    });
  });
  it('reports a setting whose binary cannot run as invalid-setting, not not-found', async () => {
    const { deps } = fakeDeps({
      ...base,
      files: [...base.files, '/opt/oc'],
      versions: { '/opt/oc': { ok: false, detail: 'exit 1' } },
    });
    const result = await detectOpencodeBinary({ settingPath: '/opt/oc' }, deps);
    expect(result).toMatchObject({ kind: 'invalid-setting', value: '/opt/oc' });
    expect(describeDetection(result).message).not.toMatch(/Set openVsCode\.opencodePath/);
  });
  it('rejects a setting that does not exist', async () => {
    const { deps } = fakeDeps(base);
    expect((await detectOpencodeBinary({ settingPath: '/nope' }, deps)).kind).toBe(
      'invalid-setting',
    );
  });
  it('resolves a .cmd setting on win32 and rejects an unresolvable one', async () => {
    const shim = 'C:\\npm\\opencode.cmd';
    const exe = 'C:\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe';
    const good = fakeDeps({
      platform: 'win32',
      files: [shim, exe],
      texts: { [shim]: OPENCODE_SHIM },
      versions: { [exe]: ok('opencode v2.0.32') },
    });
    expect(await detectOpencodeBinary({ settingPath: shim }, good.deps)).toMatchObject({
      kind: 'ok',
      binary: { path: exe },
    });
    const bad = fakeDeps({
      platform: 'win32',
      files: [shim],
      texts: { [shim]: NODE_SHEBANG_SHIM },
    });
    expect((await detectOpencodeBinary({ settingPath: shim }, bad.deps)).kind).toBe(
      'invalid-setting',
    );
  });
  it('does not execute the same file twice when both names point to it', async () => {
    const { deps, ran } = fakeDeps({
      platform: 'win32',
      path: 'C:\\npm',
      pathext: '.CMD',
      files: [
        'C:\\npm\\opencode.CMD',
        'C:\\npm\\opencode2.CMD',
        'C:\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe',
      ],
      texts: { 'C:\\npm\\opencode.CMD': OPENCODE_SHIM, 'C:\\npm\\opencode2.CMD': OPENCODE_SHIM },
      versions: { 'C:\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe': ok('1.0.0') },
    });
    await detectOpencodeBinary({ settingPath: '' }, deps);
    expect(ran).toHaveLength(1);
  });
});

describe('describeDetection', () => {
  const binary = { path: '/bin/oc', source: 'opencode' as const, version: '1.19.3' };
  it('ok only logs', () => {
    expect(
      describeDetection({ kind: 'ok', binary: { ...binary, version: '2.0.32' }, attempts: [] })
        .notify,
    ).toBe('none');
  });
  it('v1 says v2 is required and gives no install guidance', () => {
    const d = describeDetection({ kind: 'unsupported', binary, attempts: [] });
    expect(d).toMatchObject({ level: 'warn', notify: 'plain' });
    expect(d.message).toContain('requires opencode v2 (found 1.19.3 at /bin/oc)');
    expect(d.message).not.toMatch(/npm|brew|install|curl/i);
  });
  it('unknown version warns without actions', () => {
    expect(
      describeDetection({ kind: 'unknown-version', binary, output: 'local', attempts: [] }).notify,
    ).toBe('plain');
  });
  it('not-found and invalid-setting offer the buttons', () => {
    expect(describeDetection({ kind: 'not-found', attempts: [] }).notify).toBe('actions');
    expect(
      describeDetection({ kind: 'invalid-setting', value: 'x', reason: 'r', attempts: [] }).notify,
    ).toBe('actions');
  });
});

describe('package.json contract', () => {
  it('declares the opencodePath setting with machine scope and empty default', () => {
    const file = fileURLToPath(new URL('../../package.json', import.meta.url));
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
      contributes: {
        configuration: { properties: Record<string, { scope?: string; default?: unknown }> };
      };
    };
    const property = manifest.contributes.configuration.properties[OPENCODE_PATH_SETTING];
    expect(property).toMatchObject({ scope: 'machine', default: '' });
  });
});

describe('nodeDeps with real processes (node stands in for opencode)', () => {
  it('runVersion executes a real binary without a shell', async () => {
    const run = await nodeDeps().runVersion(process.execPath);
    expect(run.ok).toBe(true);
    if (run.ok)
      expect(parseOpencodeVersion(run.stdout)?.major).toBe(
        Number(process.versions.node.split('.')[0]),
      );
  });
  it('runVersion reports a missing binary instead of throwing', async () => {
    const run = await nodeDeps().runVersion(path.join(tmpdir(), 'definitely-not-here-opencode'));
    expect(run.ok).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'finds an executable sh script on PATH (POSIX only)',
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'ovc-posix-'));
      try {
        const script = path.join(dir, 'opencode2');
        await writeFile(script, "#!/bin/sh\nprintf '\\033[1mopencode\\033[0m v2.0.32\\n'\n");
        await chmod(script, 0o755);
        await writeFile(path.join(dir, 'opencode'), '#!/bin/sh\necho 1.0.0\n');
        await chmod(path.join(dir, 'opencode'), 0o644);
        const result = await detectOpencodeBinary(
          { settingPath: '' },
          { ...nodeDeps(), env: { PATH: dir } },
        );
        expect(result).toMatchObject({ kind: 'ok', binary: { path: script, version: '2.0.32' } });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === 'win32')(
    'resolves a real .cmd shim to an .exe end to end (Windows only)',
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'ovc-win-'));
      try {
        const binDir = path.join(dir, 'node_modules', '@opencode', 'cli', 'bin');
        await mkdir(binDir, { recursive: true });
        const exe = path.join(binDir, 'opencode.exe');
        await link(process.execPath, exe).catch(() => copyFile(process.execPath, exe));
        await writeFile(path.join(dir, 'opencode2.cmd'), OPENCODE_SHIM);
        const result = await detectOpencodeBinary(
          { settingPath: '' },
          { ...nodeDeps(), env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' } },
        );
        expect(result.kind).toBe('unsupported');
        if (result.kind === 'unsupported') {
          expect(result.binary.path.toLowerCase()).toBe(exe.toLowerCase());
          expect(result.binary.source).toBe('opencode2');
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
