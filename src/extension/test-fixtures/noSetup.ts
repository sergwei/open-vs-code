import type { SetupCommands } from '../chatController';

/** A {@link SetupCommands} whose every command is a no-op (a cancelled dialog, an unset path). */
export const noSetup: SetupCommands = {
  pickBinary: () => Promise.resolve(undefined),
  currentBinaryPath: () => '',
  writeBinaryPath: () => Promise.resolve(),
  redetectBinary: () => undefined,
  openBinarySettings: () => undefined,
  openServerSettings: () => undefined,
  setServerPassword: () => undefined,
  openInstallGuide: () => undefined,
  openFolder: () => undefined,
};
