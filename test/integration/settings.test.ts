// Settings registration suite (issue #38).
//
// Protects against: a `contributes.configuration` entry that VS Code ignores or registers with
// another default than the manifest declares (the unit test `manifest.test.ts` only reads the
// JSON; this one asks a real VS Code what it registered). Real VS Code, no mocks. Out of scope:
// how the Settings editor renders the entries (`test:visual` step 21) and what each setting does
// (`binaryDetection.test.ts`, `externalServer.test.ts`).
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
  AUTO_START_KEY,
  CHAT_LOCATION_KEY,
  CONFIG_SECTION,
  TEST_SETTINGS_MESSAGE_COMMAND_ID,
  TEST_SETTINGS_STATE_COMMAND_ID,
} from '../../src/extension/ids';
import type { SettingsState } from '../../src/shared/settingsProtocol';
import { openLogCursor } from './support/extensionLog';

const EXTENSION_ID = 'sergwei.open-vs-code';
const PREFIX = `${CONFIG_SECTION}.`;

/** The USER (global) value of one setting of this extension, or `undefined` when unset. */
function userValue(key: string): unknown {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).inspect(key)?.globalValue;
}

/** Polls `done` every 100 ms up to `timeoutMs` (our own margin for a slow runner); fails with `what`. */
async function waitUntil(done: () => boolean | Promise<boolean>, what: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await done())) {
    if (Date.now() >= deadline)
      assert.fail(`${what} did not happen within ${String(timeoutMs)} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('contributed settings', () => {
  /**
   * Every property of `contributes.configuration` is registered, and `inspect().defaultValue` is
   * the `default` of the manifest. A key that VS Code did not register has `defaultValue`
   * `undefined`, which the manifest defaults (all `''`) never are: that is what tells registered
   * from not registered. The invented key is the control that proves the difference exists.
   * VERIFIED (Windows 11, VS Code 1.143.1, 25/10/2026): this case, "registers every manifest
   * property with its declared default", passed in the `main` suite, so `inspect` of the invented
   * key gave `undefined`. Not observed on macOS or Linux before the CI run of the PR.
   */
  it('registers every manifest property with its declared default', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);
    const manifest = extension.packageJSON as {
      contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
    };
    const properties = Object.entries(manifest.contributes.configuration.properties);
    assert.ok(properties.length > 0, 'the manifest contributes no settings');
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    assert.strictEqual(config.inspect('notASettingOfThisExtension')?.defaultValue, undefined);
    for (const [id, declared] of properties) {
      assert.ok(id.startsWith(PREFIX), `${id} is outside the ${CONFIG_SECTION} section`);
      assert.deepStrictEqual(
        config.inspect(id.slice(PREFIX.length))?.defaultValue,
        declared.default,
        `${id} is not registered with the default of the manifest`,
      );
    }
  });
});

describe('the General settings of the Settings tab', function () {
  this.timeout(40_000);

  /**
   * Protects PR3 of issue #186: the host writes `chatLocation` and `autoStart` into the USER
   * settings (never the workspace) when the Settings tab asks, the state follows the setting, a key
   * or value outside the two allowed pairs writes nothing (the guard drops it and logs it), and the
   * profile is left as it was found. The messages go through `test.settingsMessage` (the same guard
   * and revalidation as a real webview, NOT a DOM `postMessage`); the controls themselves are
   * judged by `test:visual` steps 47 and 53. The test profile has `chatLocation: sidebar` in its
   * user settings (`.vscode-test.mjs`), so the case switches to `editor` and back, and restores the
   * value it found in a `finally`. VERIFIED on Windows 11, VS Code 1.145.3 (10/11/2026): the `main`
   * label ran it, "the Settings tab writes chatLocation and autoStart to the USER settings, refuses
   * other values and restores (782ms)". UNVERIFIED that VS Code applies the new `chatLocation` to the open chat at once: that
   * is `test:visual` step 27, not asserted here.
   */
  it('the Settings tab writes chatLocation and autoStart to the USER settings, refuses other values and restores', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);
    await extension.activate();
    const send = (message: unknown): Thenable<unknown> =>
      vscode.commands.executeCommand(TEST_SETTINGS_MESSAGE_COMMAND_ID, message);
    const general = async (): Promise<SettingsState['general']> =>
      (await vscode.commands.executeCommand<SettingsState>(TEST_SETTINGS_STATE_COMMAND_ID)).general;
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const found = {
      chatLocation: userValue(CHAT_LOCATION_KEY),
      autoStart: userValue(AUTO_START_KEY),
      opencodePath: userValue('opencodePath'),
    };
    const log = await openLogCursor();
    try {
      await send({ type: 'settings.setSetting', key: 'autoStart', value: false });
      await waitUntil(() => userValue(AUTO_START_KEY) === false, 'autoStart to be written');
      assert.strictEqual((await general()).autoStart.value, false);

      await send({ type: 'settings.setSetting', key: 'chatLocation', value: 'editor' });
      await waitUntil(
        () => userValue(CHAT_LOCATION_KEY) === 'editor',
        'chatLocation to be written',
      );
      assert.strictEqual((await general()).chatLocation.value, 'editor');
      assert.strictEqual(
        config.inspect(CHAT_LOCATION_KEY)?.workspaceValue,
        undefined,
        'the write went to the workspace',
      );

      // Refused: the guard drops each message (a positive line first, then the value is checked).
      log.mark();
      await send({ type: 'settings.setSetting', key: 'autoStart', value: 'no' });
      await send({ type: 'settings.setSetting', key: 'opencodePath', value: 'evil' });
      await send({ type: 'settings.setSetting', key: 'chatLocation', value: 'panel' });
      await log.waitFor('settings message dropped: invalid', 8000);
      assert.strictEqual(userValue(AUTO_START_KEY), false, 'a refused value changed autoStart');
      assert.strictEqual(userValue(CHAT_LOCATION_KEY), 'editor');
      assert.strictEqual(userValue('opencodePath'), found.opencodePath);
    } finally {
      await config.update(CHAT_LOCATION_KEY, found.chatLocation, vscode.ConfigurationTarget.Global);
      await config.update(AUTO_START_KEY, found.autoStart, vscode.ConfigurationTarget.Global);
    }
    assert.strictEqual(userValue(CHAT_LOCATION_KEY), found.chatLocation);
    assert.strictEqual(userValue(AUTO_START_KEY), found.autoStart);
  });
});
