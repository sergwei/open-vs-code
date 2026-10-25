// Settings registration suite (issue #38).
//
// Protects against: a `contributes.configuration` entry that VS Code ignores or registers with
// another default than the manifest declares (the unit test `manifest.test.ts` only reads the
// JSON; this one asks a real VS Code what it registered). Real VS Code, no mocks. Out of scope:
// how the Settings editor renders the entries (`test:visual` step 21) and what each setting does
// (`binaryDetection.test.ts`, `externalServer.test.ts`).
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CONFIG_SECTION } from '../../src/extension/ids';

const EXTENSION_ID = 'sergwei.open-vs-code';
const PREFIX = `${CONFIG_SECTION}.`;

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
