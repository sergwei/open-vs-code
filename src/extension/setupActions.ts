// The VS Code side of the buttons of the setup guide and the error card (E2, issue #85): choose
// the opencode binary, open the settings, set the server password, open the install page and open
// a folder. The controller (`chatController.ts`) stays free of `vscode` and receives this object
// through `ChatControllerDeps.setup`. It has no unit test (it imports `vscode`, which is not in
// `node_modules`): `test:visual` drives "Choose binary…" with the simple file dialog (see the
// header of `createSetupActions` for what was and was not observed).

import * as vscode from 'vscode';
import type { SetupCommands } from './chatController';
import {
  CONFIG_SECTION,
  INSTALL_GUIDE_URL,
  OPENCODE_PATH_KEY,
  OPENCODE_PATH_SETTING,
  SERVER_URL_SETTING,
  SET_SERVER_PASSWORD_COMMAND_ID,
} from './ids';

/**
 * Filters of the "Choose binary" dialog on Windows: executables first, "All files" so a shim or an
 * unusual name is never blocked (the detection decides whether it works).
 */
const WINDOWS_BINARY_FILTERS: { [name: string]: string[] } = {
  Executables: ['exe', 'cmd', 'bat'],
  'All files': ['*'],
};

/**
 * Builds the {@link SetupCommands} over the real VS Code API.
 *
 * Issue #86 split "Choose binary…" in four so the controller owns the order: `pickBinary` shows
 * `showOpenDialog` (one file, filters ONLY on Windows: a POSIX binary has no extension, so a
 * filter would hide it) and returns the path or `undefined` on cancel; `currentBinaryPath` reads
 * the trimmed setting; `writeBinaryPath` writes it to `openVsCode.opencodePath` with
 * `ConfigurationTarget.Global`, because the setting has scope `machine` and the docs say such a
 * setting "can be set only in user settings or only in remote settings" (quoted from the
 * contribution-points page as the planner read it on 27/10/2026, not re-read here; the write
 * itself is VERIFIED below for a local window); `redetectBinary` calls the `redetect` handed in
 * (the `start` of `binaryDetection.ts`, read lazily because that detection is registered AFTER
 * the chat), which the controller uses when the pick equals the current value (that write would
 * fire no change event). None validates the file: the detection is the single place that judges a
 * binary. A rejected `update` propagates, and the controller shows it as a `warning` notice.
 * `openBinarySettings` and `openServerSettings` run `workbench.action.openSettings` with the
 * setting id as the query (HYPOTHESIS, as in `binaryDetection.ts`: it filters by id).
 * `setServerPassword` runs the existing command; `openInstallGuide` opens the npm page of
 * `@opencode/cli` in the browser (decision P4) and `openFolder` runs
 * `workbench.action.files.openFolder` (decision P15).
 * VERIFIED for the dialog and the Global write (the former `chooseBinary`) on Windows 11, VS Code
 * 1.143.1 (27/10/2026): the visual checks "Choose binary… is pressed with the real mouse" and "Choose
 * binary… through the real file dialog wrote the setting and step 1 is done" (the simple file
 * dialog, a local window). UNVERIFIED, never driven in a real window: `openBinarySettings`,
 * `openServerSettings`, `setServerPassword`, `openInstallGuide` and `openFolder` (they open
 * native or external UI the run does not click), Global ending in the remote settings of a remote
 * window (HYPOTHESIS), and macOS and Linux dialogs.
 */
export function createSetupActions(redetect: () => void = () => undefined): SetupCommands {
  return {
    async pickBinary() {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: 'Use this binary',
        title: 'Choose the opencode v2 binary',
        ...(process.platform === 'win32' ? { filters: WINDOWS_BINARY_FILTERS } : {}),
      });
      return picked?.[0]?.fsPath;
    },
    currentBinaryPath() {
      return vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<string>(OPENCODE_PATH_KEY, '')
        .trim();
    },
    async writeBinaryPath(path) {
      await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update(OPENCODE_PATH_KEY, path, vscode.ConfigurationTarget.Global);
    },
    redetectBinary() {
      redetect();
    },
    openBinarySettings() {
      void vscode.commands.executeCommand('workbench.action.openSettings', OPENCODE_PATH_SETTING);
    },
    openServerSettings() {
      void vscode.commands.executeCommand('workbench.action.openSettings', SERVER_URL_SETTING);
    },
    setServerPassword() {
      void vscode.commands.executeCommand(SET_SERVER_PASSWORD_COMMAND_ID);
    },
    openInstallGuide() {
      void vscode.env.openExternal(vscode.Uri.parse(INSTALL_GUIDE_URL));
    },
    openFolder() {
      void vscode.commands.executeCommand('workbench.action.files.openFolder');
    },
  };
}
