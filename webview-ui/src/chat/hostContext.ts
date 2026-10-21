/**
 * How components reach the host without importing `../vscode` (issue #15): `App` provides the
 * sender, and a component calls {@link useSend}. Tests provide a recording function, so no
 * `acquireVsCodeApi` mock is needed.
 */
import { createContext, useContext } from 'solid-js';
import type { WebviewToHost } from '../../../src/shared/protocol';

/** Function that posts one typed message to the extension host. */
export type SendToHost = (message: WebviewToHost) => void;

export const HostContext = createContext<SendToHost>();

/**
 * Returns the sender provided by the nearest `HostContext.Provider`.
 *
 * Throws when there is none: a component that needs the host and is rendered without one is a
 * wiring bug, and a silent no-op would hide it (the Copy button would just do nothing).
 */
export function useSend(): SendToHost {
  const send = useContext(HostContext);
  if (send === undefined) throw new Error('useSend() needs a HostContext.Provider above it');
  return send;
}
