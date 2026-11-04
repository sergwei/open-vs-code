// Spanish suite (E11-i18n), label `locale-es`.
//
// Protects against: the extension only working in English while the tests that compare English
// texts all pass: a manifest whose `%key%` titles are not replaced by `package.nls.es.json`, a host
// whose `l10n/bundle.l10n.es.json` is never loaded (a missing `"l10n"` in `package.json`, a boot that
// runs after other modules), and a profile that silently starts in English (the pack not set up).
// The profile is the one `.vscode-test.mjs` builds for this label: the MS-CEINTL Spanish pack in a
// private extensions dir, registered by one throw-away window, then `--locale=es`.
//
// Spike result (04/11/2026, Windows 11, VS Code 1.145.0): `--install-extension` alone leaves VS Code
// in English because it does not write `languagepacks.json`; a first window with the pack installed
// and extensions enabled does, and the next launch resolves `es`. `test/visual/languagePack.mjs`
// does both steps; `--disable-extensions` is fine in the real run (our extension still loads). The
// order the plan listed (drop `--disable-extensions`, warm-up launch, `argv.json`) stopped at the
// second: the warm-up was enough, `argv.json` was not tried.
//
// Provenance: the real VS Code, the real language pack and the real extension; nothing fabricated.
// Expected texts are read from `package.nls.es.json` and `l10n/bundle.l10n.es.json`, never typed
// here, so a corrected translation does not break the suite. Out of scope: what is INSIDE a webview
// (looked at by `test:visual` step 42).
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { openLogFromStart } from './support/extensionLog';

const EXTENSION_ID = 'sergwei.open-vs-code';
const SHOW_LOGS_COMMAND = 'openVsCode.showLogs';

/** The repository root, from the compiled suite (`out/test/integration/*.js`). */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Reads a JSON catalog of the repository as a string map. */
function readCatalog(relative: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8')) as Record<
    string,
    string
  >;
}

describe('locale es (Spanish VS Code with the language pack)', function () {
  this.timeout(30_000);

  before(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
  });

  /**
   * The window really runs in Spanish.
   *
   * Protects the premise of the whole suite: without the pack VS Code resolves `en` whatever
   * `--locale` says, and every other case would compare Spanish text with English text. The
   * counterpart in the other labels is the guard of `activation.test.ts`.
   */
  it('runs in a Spanish VS Code', () => {
    assert.strictEqual(
      vscode.env.language,
      'es',
      `vscode.env.language is "${vscode.env.language}": the Spanish language pack was not picked up ` +
        '(see test/visual/languagePack.mjs and .vscode-test.mjs, label locale-es).',
    );
  });

  /**
   * The manifest title of Show Logs is the Spanish one of `package.nls.es.json`.
   *
   * Protects the `%command.showLogs.title%` indirection and the file naming: a title that stays
   * `%command.showLogs.title%` or English means VS Code did not find or read the catalog. The
   * expected value is the catalog's own, so the case follows a corrected translation, and it must
   * differ from the English base (otherwise the case could not tell the two apart).
   */
  it('reads the manifest title of Show Logs in Spanish', () => {
    const spanish = readCatalog('package.nls.es.json')['command.showLogs.title'];
    const english = readCatalog('package.nls.json')['command.showLogs.title'];
    assert.ok(spanish !== undefined && english !== undefined);
    assert.notStrictEqual(spanish, english, 'the Spanish and the English title must differ');
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    // A localized title reaches `packageJSON` as `{ value, original }`, an English one as a string
    // (seen in the first run of this case, which compared the object with the string).
    const commands = (
      extension.packageJSON as {
        contributes: {
          commands: { command: string; title: string | { value: string; original: string } }[];
        };
      }
    ).contributes.commands;
    const title = commands.find((entry) => entry.command === SHOW_LOGS_COMMAND)?.title;
    assert.strictEqual(typeof title === 'string' ? title : title?.value, spanish);
  });

  /**
   * Every command title and the description of a setting reach VS Code in Spanish.
   *
   * Protects the whole manifest indirection of E11-i18n phase 3: each `%command.<id>.title%` of
   * `package.json` must come out as the value of `package.nls.es.json`, and so must the
   * `markdownDescription` of `openVsCode.serverUrl` (the one with `#id#` links and backticks, the
   * most fragile text to translate). Keys are read from the repository's `package.json` and values
   * from the catalog, never typed here. Requires the Spanish value to differ from the English one for
   * the setting, so the case cannot pass on an untranslated catalog. A localized text may reach
   * `packageJSON` as a string or as `{ value, original }` (seen for titles in the first run of the
   * Show Logs case above), so both are read. Every command title is compared (not a sample).
   */
  it('reads the title of every command and the description of a setting in Spanish', () => {
    const spanish = readCatalog('package.nls.es.json');
    const english = readCatalog('package.nls.json');
    type Localized = string | { value: string; original: string } | undefined;
    const textOf = (value: Localized): string | undefined =>
      typeof value === 'string' ? value : value?.value;
    interface Contributes {
      commands: { command: string; title: Localized }[];
      configuration: { properties: Record<string, { markdownDescription?: Localized }> };
    }
    const keyOf = (text: string): string | undefined => /^%([\w.-]+)%$/.exec(text)?.[1];
    const raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      contributes: Contributes;
    };
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    const live = (extension.packageJSON as { contributes: Contributes }).contributes;
    let compared = 0;
    for (const command of raw.contributes.commands) {
      const key = typeof command.title === 'string' ? keyOf(command.title) : undefined;
      assert.ok(key, `the title of ${command.command} is not a %key%`);
      const shown = textOf(live.commands.find((entry) => entry.command === command.command)?.title);
      assert.strictEqual(shown, spanish[key], `title of ${command.command}`);
      compared += 1;
    }
    assert.ok(compared >= 36, `only ${String(compared)} command titles were compared`);
    const settingId = 'openVsCode.serverUrl';
    const rawText = raw.contributes.configuration.properties[settingId]?.markdownDescription;
    const settingKey = typeof rawText === 'string' ? keyOf(rawText) : undefined;
    assert.ok(settingKey, `${settingId} markdownDescription is not a %key%`);
    assert.notStrictEqual(spanish[settingKey], english[settingKey]);
    assert.strictEqual(
      textOf(live.configuration.properties[settingId]?.markdownDescription),
      spanish[settingKey],
    );
  });

  /**
   * The host loaded the Spanish bundle: the log says `es` and a non-zero number of keys.
   *
   * Protects the wiring of `l10nBoot.ts` and `"l10n": "./l10n"` in `package.json` (without it VS
   * Code loads no bundle and the line reads `bundle none`). The key count is compared with the
   * entries of `l10n/bundle.l10n.es.json` of the repository. The line is written once at
   * activation, which `before` waited for, so the cursor starts at the beginning of the file.
   */
  it('logs the host locale es with the loaded bundle', async () => {
    const keys = Object.keys(readCatalog('l10n/bundle.l10n.es.json')).length;
    assert.ok(keys > 0, 'l10n/bundle.l10n.es.json has no keys');
    const log = await openLogFromStart();
    await log.waitFor(`l10n: locale es, bundle ${String(keys)} keys`, 8000);
  });
});
