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
import type { ChatLocation } from '../../../src/extension/chatLocation';
import type { LogCursor } from './extensionLog';

/** Our own margin for a slow CI runner, as in the other suites; not a VS Code value. */
const APPLY_WAIT_MS = 8000;

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

/** Waits until the number of chat tabs is `count`; fails with the tabs it did see. */
export async function waitForChatTabs(count: number, timeoutMs = APPLY_WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (chatTabs().length === count) return;
    if (Date.now() >= deadline) {
      assert.fail(
        `expected ${String(count)} chat tab(s), found ${String(chatTabs().length)}: ` +
          JSON.stringify(chatTabs().map((tab) => tab.label)),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Writes the setting in the GLOBAL (user) settings of the isolated test profile and waits for the
 * host to log that it applied it. A value equal to the current one writes nothing and waits for
 * nothing (no change event would come). `undefined` removes the key, i.e. the default `sidebar`.
 * The caller restores the setting in a `finally`.
 */
export async function setChatLocation(
  value: ChatLocation | undefined,
  log: LogCursor,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = configuration.get<string>(CHAT_LOCATION_KEY, 'sidebar');
  const wanted = value ?? 'sidebar';
  await configuration.update(CHAT_LOCATION_KEY, value, vscode.ConfigurationTarget.Global);
  if (current !== wanted) await log.waitFor(`chat location changed to ${wanted}`, APPLY_WAIT_MS);
}
