/**
 * The three tabs of the chat panel (issue #188, plan `E2-chat-panel-tabs`): which ones exist, in the
 * order they are drawn, and how a stored value is validated. Pure: no DOM and no Solid, so
 * `uiState.ts` (which persists the choice) and the component share it without importing JSX.
 */

/** Tabs in drawing order: the conversation, the files the session changed, and its settings. */
export const PANEL_TABS = ['chat', 'changes', 'session'] as const;

/** One of {@link PANEL_TABS}. */
export type PanelTab = (typeof PANEL_TABS)[number];

/**
 * True when `value` is the id of a tab. Used on what `getState` returns, which may hold the shape
 * of another version of the extension, so anything else falls back to the chat tab.
 */
export function isPanelTab(value: unknown): value is PanelTab {
  return typeof value === 'string' && (PANEL_TABS as readonly string[]).includes(value);
}
