/**
 * The contract between the two sides that handle the state of a chat tab across a Reload Window
 * (issue #77): the webview WRITES the id of the session it shows into its own `setState`, and the
 * extension host READS it back when VS Code hands the state to the panel serializer. It lives in
 * `src/shared` because both sides must agree on the field name and on what a valid value is, and
 * neither may import the other. It is not a protocol message: the state travels inside VS Code's
 * own persistence, next to the draft.
 */

/** Name of the field of the persisted webview state that holds the session shown by the tab. */
export const TAB_SESSION_FIELD = 'sessionID';

/** Longest session id accepted. Our own cap: a corrupt state must not bind a pane to a huge string. */
export const MAX_TAB_SESSION_ID_LENGTH = 200;

/**
 * Reads the session id out of a persisted webview state of unknown shape. Returns it when the
 * field is a non-empty string of at most {@link MAX_TAB_SESSION_ID_LENGTH} characters, otherwise
 * `undefined`; never throws, because the state may be absent, or the shape of another version.
 * VERIFIED by `tabState.test.ts` with fabricated states. VERIFIED that VS Code returns the last
 * `setState` to the serializer after a real Reload Window (`npm run test:visual`, full run, Windows
 * 11, VS Code 1.144.0, 29/10/2026): "R2 A comes back active: title \"Tab28A: Reply with exactly:
 * alpha28. Do\", 2 blocks, draft \"draft28-A\", kind vscode-dark" (the tab restored its session, so
 * the id came through this reader) and "R4 C comes back lazy: title \"Untitled session\", 0 blocks,
 * draft \"draft28-C\"" (a tab with no session, not deserialized until it is opened after the Reload,
 * keeps its draft).
 * Not observed: a state written by another version of the extension.
 */
export function readPersistedSessionID(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = (raw as Record<string, unknown>)[TAB_SESSION_FIELD];
  if (typeof value !== 'string' || value === '') return undefined;
  return value.length <= MAX_TAB_SESSION_ID_LENGTH ? value : undefined;
}
