// Test double of `ChatControllerDeps.setup` for the suites that never press a setup button (E2,
// issue #85): every command does nothing. `chatController.test.ts` has its own recording version.

import type { SetupCommands } from '../chatController';

/** A {@link SetupCommands} whose every command is a no-op. */
export const noSetup: SetupCommands = {
  chooseBinary: () => Promise.resolve(),
  openBinarySettings: () => undefined,
  openServerSettings: () => undefined,
  setServerPassword: () => undefined,
  openInstallGuide: () => undefined,
  openFolder: () => undefined,
};
