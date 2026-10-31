// Default location suite (E5 of #77, `openVsCode.chatLocation` with NO key written).
//
// Protects against: the default of the setting drifting back to `sidebar` (or the views and the
// host disagreeing about it) while every other suite still passes, because their profiles carry
// the `sidebar` baseline (`.vscode-test.mjs`, decision Q2=1 of Sergio, 30/10/2026). This suite is
// the `default-location` configuration: a NEW profile whose `settings.json` is `{}`, no folder,
// no server, and the activation of its window is the FIRST one. Cases: what VS Code registers as
// default; the first activation logging `editor`; the Chat view not resolving until `sidebar` is
// written (the control that makes the absence mean something); New Session opening a tab with
// nothing written; and an unknown value (decision Q1=1) read the same way by the host and by the
// `when` clauses of the views.
//
// Provenance: the real VS Code, the real manifest and the real extension; nothing fabricated. What
// is INSIDE the Sessions view or a tab (DOM) is out of reach of the test API and is looked at by
// `test:visual` (step 25 with the extension installed, and step 31).
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
  CHAT_LOCATION_KEY,
  CONFIG_SECTION,
  NEW_SESSION_COMMAND_ID,
  VIEW_CONTAINER_ID,
} from '../../src/extension/ids';
import { openLogCursor, openLogFromStart } from './support/extensionLog';
import { chatTabs, setChatLocation, waitForChatTabs } from './support/chatLocation';

const EXTENSION_ID = 'sergwei.open-vs-code';
// Our own margins, not VS Code values: a document needs well under a second to say `ready`, and an
// absence is asserted after this pause (vscode-extension skill, section 11).
// All three uses of `SETTLE_MS` precede an `assertAbsent` (tooling/test-speed phase 1 reviewed
// them): an absence cannot be waited for, so the window stays fixed.
const READY_WAIT_MS = 8000;
const SETTLE_MS = 1500;

/** Pauses for `ms`; used for margins before asserting an absence. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('default chat location (no setting written)', function () {
  this.timeout(30_000);

  before(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
  });

  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // `undefined` removes the key: this profile is the one place where "no key" is the baseline.
    await setChatLocation(undefined, await openLogCursor());
  });

  /**
   * VS Code registers `editor` as the default and the profile really has no value written.
   *
   * Protects the `default` of the manifest as the workbench reads it (`settings.test.ts` compares
   * it with the manifest in `main`; this one does it in a profile without the baseline) and that
   * the profile is new: a `globalValue` here would make every other case meaningless.
   */
  it('registers editor as the default, with no value in the profile', () => {
    const inspected = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .inspect<string>(CHAT_LOCATION_KEY);
    assert.strictEqual(inspected?.defaultValue, 'editor');
    assert.strictEqual(inspected.globalValue, undefined);
    assert.strictEqual(inspected.workspaceValue, undefined);
  });

  /**
   * The FIRST activation of a profile without the key starts in `editor`.
   *
   * Protects the host reading the default (`readLocation` in `registerChat`). Reads the log from
   * the start: the line is written once, at activation, before any test could mark the end.
   */
  it('starts in editor on the first activation', async () => {
    const log = await openLogFromStart();
    await log.waitFor('chat location at start: editor', READY_WAIT_MS);
  });

  /**
   * The Chat view does not resolve by default; it does once `sidebar` is written.
   *
   * Protects the `when` clauses of the views against the default (`== sidebar` for the Chat view).
   * The control in the same case proves the absence is not just a container that never opened:
   * the same command, after writing `sidebar`, resolves the view. The absence waits 1.5 s before
   * it is asserted.
   */
  it('does not resolve the Chat view by default, and does after writing sidebar', async () => {
    const log = await openLogCursor();
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    await pause(SETTLE_MS);
    log.assertAbsent('Chat view resolved');
    await setChatLocation('sidebar', log);
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    await log.waitFor('Chat view resolved', READY_WAIT_MS);
  });

  /**
   * New Session with nothing written opens one editor tab whose document says `ready`.
   *
   * Protects the default reaching the commands: in `sidebar` mode the same command would go to the
   * side-bar pane and open no tab.
   */
  it('opens a tab on New Session without anything written', async () => {
    const log = await openLogCursor();
    await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
    await waitForChatTabs(1);
    await log.waitFor('webview ready', READY_WAIT_MS);
    await pause(SETTLE_MS);
    log.assertAbsent('Webview bundle file missing');
  });

  /**
   * A value outside the enum (decision Q1=1) is `editor` for the host AND for the views.
   *
   * Protects the agreement `manifest.test.ts` checks on paper: the host stays in `editor` (no
   * `chat location changed to`, and New Session opens a tab, which `sidebar` would not) and the
   * Chat view stays hidden (`!= sidebar` hides it). VERIFIED: the case passes in the
   * default-location run (Windows 11, VS Code 1.144.0, 30/10/2026, "5 passing"), so
   * `configuration.update` accepts a value outside the enum. Printed title: "reads an unknown value
   * as editor in the host and in the views". UNVERIFIED on macOS and Linux (first CI run on the
   * pull request). The key is removed in a `finally` with a direct `update`,
   * not with `setChatLocation`: the host never logs a change from `panel` to `editor` (both read
   * as `editor`), so that helper would wait for a line that cannot come.
   */
  it('reads an unknown value as editor in the host and in the views', async () => {
    const log = await openLogCursor();
    const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
    try {
      await configuration.update(CHAT_LOCATION_KEY, 'panel', vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
      await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
      await waitForChatTabs(1);
      await pause(SETTLE_MS);
      log.assertAbsent('chat location changed to');
      log.assertAbsent('Chat view resolved');
      assert.strictEqual(chatTabs().length, 1);
    } finally {
      await configuration.update(CHAT_LOCATION_KEY, undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
