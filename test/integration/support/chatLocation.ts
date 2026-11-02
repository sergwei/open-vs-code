// Helpers for the suites that put the chat in editor tabs (issue #77): write the
// `openVsCode.chatLocation` setting and wait for the host to apply it, and read the chat tabs of the
// workbench. They only use the public API and the extension log; nothing here knows the controller.
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
  CHAT_LOCATION_KEY,
  CHAT_PANEL_VIEW_TYPE,
  CONFIG_SECTION,
} from '../../../src/extension/ids';
import { readChatLocation, type ChatLocation } from '../../../src/extension/chatLocation';
import type { LogCursor } from './extensionLog';

/** Our own margin for a slow CI runner, as in the other suites; not a VS Code value. */
const APPLY_WAIT_MS = 8000;

/**
 * The location that `.vscode-test.mjs` writes into the `settings.json` of the four isolated
 * profiles that run the existing suites (E5 of #77, decision Q2=1 of Sergio, 30/10/2026). Since the
 * default of the setting is `editor`, the ~95 cases written for the side bar would otherwise start
 * in the wrong mode. The default itself is checked by the `default-location` suite, whose profile
 * does NOT carry this key. Keep it equal to `TEST_CHAT_LOCATION` in `.vscode-test.mjs` (a plain
 * `.mjs` that cannot import this file); `src/extension/testConfig.test.ts` fails if they differ.
 */
export const TEST_BASELINE_CHAT_LOCATION: ChatLocation = 'sidebar';

/** The chat tabs the workbench shows, in every group. */
export function chatTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputWebview &&
        // VS Code may prefix the view type (HYPOTHESIS), hence `endsWith`.
        tab.input.viewType.endsWith(CHAT_PANEL_VIEW_TYPE),
    );
}

/**
 * Dumps every editor group and its tabs as one line of text, for failure messages of the cases
 * that wait on a chat tab (issue #141: a tab whose document never said `ready` on macOS, with
 * nothing in the CI logs to say where the tabs were).
 *
 * Per group: its `viewColumn`, whether it is the active group, and per tab its label, whether it
 * is the active tab of its group and its kind (`chat` for our webview type, `webview` for another
 * one, `other` for anything else). Uses only the public `tabGroups` API. The text is for people:
 * nothing parses it.
 * VERIFIED (Windows 11, VS Code 1.144.0, 02/11/2026) by a one-off mutation of the case "opens one
 * tab per New Session, each with a ready document" (waiting for 3 `webview ready`), whose failure
 * read: `layout: group column=1 (active): ["Untitled session"(chat), "Untitled session"(chat,active)]`.
 * NOT observed: the layout of a real #141 failure on macOS, nor the `waitForChatTabs` message path.
 */
export function describeChatLayout(): string {
  const groups = vscode.window.tabGroups.all.map((group) => {
    const tabs = group.tabs.map((tab) => {
      const kind =
        tab.input instanceof vscode.TabInputWebview
          ? tab.input.viewType.endsWith(CHAT_PANEL_VIEW_TYPE)
            ? 'chat'
            : 'webview'
          : 'other';
      return `${JSON.stringify(tab.label)}(${kind}${tab.isActive ? ',active' : ''})`;
    });
    return `group column=${String(group.viewColumn)}${group.isActive ? ' (active)' : ''}: [${tabs.join(', ')}]`;
  });
  return groups.join('; ');
}

/**
 * Waits until the number of chat tabs is `count`; on timeout fails with the tabs it did see and
 * the layout of the groups ({@link describeChatLayout}).
 */
export async function waitForChatTabs(count: number, timeoutMs = APPLY_WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (chatTabs().length === count) return;
    if (Date.now() >= deadline) {
      assert.fail(
        `expected ${String(count)} chat tab(s), found ${String(chatTabs().length)}: ` +
          JSON.stringify(chatTabs().map((tab) => tab.label)) +
          `; layout: ${describeChatLayout()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Writes the setting in the GLOBAL (user) settings of the isolated test profile and waits for the
 * host to log that it applied it. It waits only when the location the host reads
 * (`readChatLocation`) changes: raw values that read the same (an unknown value and `editor`) log
 * nothing, so comparing them raw would wait for a line that never comes. `undefined` removes the
 * key, i.e. the DEFAULT of the manifest (`editor` since E5; read from `inspect`, not hard-coded,
 * so it follows the manifest).
 * The profiles of the existing suites carry the `sidebar` baseline (see
 * {@link TEST_BASELINE_CHAT_LOCATION}), and removing the key would drop it: those suites restore
 * with {@link restoreChatLocation}. Only the `default-location` suite removes the key.
 * The caller restores the setting in a `finally`.
 */
export async function setChatLocation(
  value: ChatLocation | undefined,
  log: LogCursor,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = readChatLocation(configuration.get<string>(CHAT_LOCATION_KEY));
  const wanted = readChatLocation(
    value ?? configuration.inspect<string>(CHAT_LOCATION_KEY)?.defaultValue,
  );
  await configuration.update(CHAT_LOCATION_KEY, value, vscode.ConfigurationTarget.Global);
  if (current !== wanted) await log.waitFor(`chat location changed to ${wanted}`, APPLY_WAIT_MS);
}

/**
 * Puts the setting back to the baseline of the isolated profile, `sidebar`, which is what the
 * suites other than `default-location` assume between cases. Replaces the old
 * `setChatLocation(undefined, …)` of the afterEach/finally blocks, which meant "back to the
 * default" when the default was `sidebar` and would now mean `editor`.
 * VERIFIED indirectly (Windows 11, VS Code 1.144.0, 30/10/2026): the `fake-server` configuration,
 * whose 44 cases use it in three `afterEach` hooks and one `finally`, and `main` (chatPanel), all
 * ended with "passing" and exit code 0. No case asserts the helper on its own; macOS and Linux
 * UNVERIFIED until the CI runs it.
 */
export async function restoreChatLocation(log: LogCursor): Promise<void> {
  await setChatLocation(TEST_BASELINE_CHAT_LOCATION, log);
}
