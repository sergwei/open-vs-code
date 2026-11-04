import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Protects the translation catalogs of E11-i18n (H3, H4): `npm test` runs
// `node scripts/l10n.mjs check` on the real repository, so a missing, extra, reordered or
// differently-placeholdered key in a published language, or a base bundle that is out of date with
// the code, turns this file red. The second half runs the same script against a temporary
// directory with an INVENTED language `xx`: it proves that a language is found by its file names
// and that adding one needs no code. The data of the temporary directory is fabricated; the first
// test reads the real files. Precedent: `vsixCheck.test.ts` (it also spawns a script).

const SCRIPT = fileURLToPath(new URL('../../scripts/l10n.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../..', import.meta.url));

/** The wasm parser of `@vscode/l10n-dev` makes the first run slow on a cold machine. */
const SLOW_MS = 60_000;

/** Runs `check` on `root` as a command line, like `npm test` and CI do. */
function check(root: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, 'check', root], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('the real catalogs', () => {
  it('pass `scripts/l10n.mjs check` on the repository', { timeout: SLOW_MS }, () => {
    const result = check(REPO);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('keeps ./l10nBoot as the first import of both entry points', () => {
    // A module that evaluates before the boot would read an unconfigured `@vscode/l10n` and
    // freeze English text in a module-level constant, whatever the language is.
    for (const file of ['src/extension/extension.ts', 'webview-ui/src/index.tsx']) {
      const text = readFileSync(join(REPO, file), 'utf8');
      const first = /^import\s[^;]*?['"]([^'"]+)['"];/m.exec(text);
      expect(first?.[1], file).toBe('./l10nBoot');
    }
  });
});

describe('a language the code has never heard of (xx)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'l10n-check-'));
    mkdirSync(join(dir, 'l10n'));
    write('package.json', { contributes: { commands: [{ title: '%command.hello.title%' }] } });
    write('package.nls.json', { 'command.hello.title': 'Hello' });
    write('l10n/bundle.l10n.json', { 'Hello {0}': 'Hello {0}', Bye: 'Bye' });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Writes a JSON file under the temporary directory. */
  function write(name: string, value: unknown): void {
    writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
  }

  /** Writes a complete `xx` (both catalogs) and lets the test override one half. */
  function writeXx(
    overrides: { nls?: Record<string, string> | null; bundle?: Record<string, string> | null } = {},
  ): void {
    const nls = overrides.nls === undefined ? { 'command.hello.title': 'Hola xx' } : overrides.nls;
    const bundle =
      overrides.bundle === undefined
        ? { 'Hello {0}': 'Hola xx {0}', Bye: 'Adeu xx' }
        : overrides.bundle;
    if (nls !== null) write('package.nls.xx.json', nls);
    if (bundle !== null) write('l10n/bundle.l10n.xx.json', bundle);
  }

  it('passes when it is complete', () => {
    writeXx();
    const result = check(dir);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('passes with no language at all (only the English base)', () => {
    expect(check(dir).status).toBe(0);
  });

  it('fails when a bundle key is missing', () => {
    writeXx({ bundle: { 'Hello {0}': 'Hola xx {0}' } });
    const result = check(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing key "Bye"');
  });

  it('fails when a bundle has a key the base does not', () => {
    writeXx({ bundle: { 'Hello {0}': 'Hola xx {0}', Bye: 'Adeu xx', Extra: 'Extra xx' } });
    const result = check(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('extra key "Extra"');
  });

  it('fails when the keys are in another order than the base', () => {
    writeXx({ bundle: { Bye: 'Adeu xx', 'Hello {0}': 'Hola xx {0}' } });
    const result = check(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not in the order');
  });

  it('fails when a placeholder changes or disappears', () => {
    writeXx({ bundle: { 'Hello {0}': 'Hola xx {1}', Bye: 'Adeu xx' } });
    const changed = check(dir);
    expect(changed.status).toBe(1);
    expect(changed.stderr).toContain('placeholders or links differ');

    writeXx({ bundle: { 'Hello {0}': 'Hola xx', Bye: 'Adeu xx' } });
    expect(check(dir).status).toBe(1);
  });

  it('fails when a value is empty', () => {
    writeXx({ bundle: { 'Hello {0}': 'Hola xx {0}', Bye: ' ' } });
    expect(check(dir).status).toBe(1);
  });

  it('fails when only the manifest half exists, and when only the bundle half exists', () => {
    writeXx({ bundle: null });
    const manifestOnly = check(dir);
    expect(manifestOnly.status).toBe(1);
    expect(manifestOnly.stderr).toContain('package.nls.xx.json has no l10n/bundle.l10n.xx.json');

    rmSync(join(dir, 'package.nls.xx.json'));
    writeXx({ nls: null });
    const bundleOnly = check(dir);
    expect(bundleOnly.status).toBe(1);
    expect(bundleOnly.stderr).toContain('l10n/bundle.l10n.xx.json has no package.nls.xx.json');
  });

  it('fails when the manifest catalog loses a key, or keeps an orphan one', () => {
    writeXx({ nls: {} });
    const missing = check(dir);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('missing key "command.hello.title"');

    writeXx({ nls: { 'command.hello.title': 'Hola xx', orphan: 'x' } });
    expect(check(dir).status).toBe(1);

    writeXx();
    write('package.nls.json', { 'command.hello.title': 'Hello', orphan: 'x' });
    const orphan = check(dir);
    expect(orphan.status).toBe(1);
    expect(orphan.stderr).toContain('key "orphan" is not used by package.json');
  });

  it('fails when a welcome link is edited in a translation', () => {
    write('package.json', { contributes: { x: '%welcome%' } });
    write('package.nls.json', { welcome: 'Go\n[Open](command:openVsCode.openChat)' });
    writeXx({ nls: { welcome: 'Ir\n[Abrir](command:openVsCode.otherChat)' } });
    // The bundle half of xx has two keys the base also has, so only the link can fail.
    const result = check(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('package.nls.xx.json: placeholders or links differ');
  });

  it('rejects an uppercase language id', () => {
    write('package.nls.XX.json', { 'command.hello.title': 'Hola' });
    const result = check(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must be lowercase');
  });

  it(
    'fails when the base bundle is out of date with the sources, and passes once it is not',
    () => {
      mkdirSync(join(dir, 'src', 'extension'), { recursive: true });
      writeFileSync(
        join(dir, 'src', 'extension', 'a.ts'),
        "import * as l10n from '@vscode/l10n';\nexport const a = l10n.t('Hello {0}', 1);\nexport const b = l10n.t('Bye');\nexport const c = l10n.t('Brand new');\n",
      );
      const stale = check(dir);
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain('not up to date');

      write('l10n/bundle.l10n.json', {
        'Hello {0}': 'Hello {0}',
        Bye: 'Bye',
        'Brand new': 'Brand new',
      });
      const fresh = check(dir);
      expect(fresh.stderr).toBe('');
      expect(fresh.status).toBe(0);
    },
    SLOW_MS,
  );
});
