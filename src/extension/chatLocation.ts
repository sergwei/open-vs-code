// Where the chat lives (issue #77): the side-bar view or one editor tab per session. Pure: no
// `vscode` import, so the rules of a change of location are tested without a window.

/** The two places the chat can live; the values of the `openVsCode.chatLocation` setting. */
export type ChatLocation = 'sidebar' | 'editor';

/** Used when the setting is absent or holds anything else. */
export const DEFAULT_CHAT_LOCATION: ChatLocation = 'sidebar';

/**
 * Reads the raw value of the `openVsCode.chatLocation` setting. Anything that is not exactly
 * `'sidebar'` or `'editor'` (absent, another type, a typo, a value of a future version) reads as
 * {@link DEFAULT_CHAT_LOCATION}: a bad setting must not leave the chat without a home.
 * VERIFIED by `chatLocation.test.ts` with fabricated values (no VS Code involved).
 */
export function readChatLocation(raw: unknown): ChatLocation {
  return raw === 'editor' || raw === 'sidebar' ? raw : DEFAULT_CHAT_LOCATION;
}

/** What {@link planLocationSwitch} knows about an open editor tab. */
export interface TabSnapshot {
  paneId: number;
  /** The session the tab shows, or `undefined` for a lazy tab. */
  sessionID: string | undefined;
}

/** The state a change of location starts from. */
export interface LocationState {
  /** The session the side-bar pane shows now (only meaningful when leaving `sidebar`). */
  sidebarSession: string | undefined;
  /** The session remembered for the served folder (only used when arriving at `sidebar`). */
  rememberedSession: string | undefined;
  /** The tabs that are open, in any order; leftovers of `editor` mode count too. */
  tabs: readonly TabSnapshot[];
}

/**
 * One step of a change of location, for the VS Code side to carry out in order:
 * `detachSidebar` stops tracking the side-bar pane (it only exists in `sidebar` mode);
 * `openTab` creates a tab, with `sessionID` or lazy when it is `undefined`;
 * `revealTab` brings an existing tab forward instead of duplicating its session;
 * `attachSidebar` creates the side-bar pane, giving it `sessionID` or leaving it lazy.
 */
export type LocationAction =
  | { kind: 'detachSidebar' }
  | { kind: 'openTab'; sessionID: string | undefined }
  | { kind: 'revealTab'; paneId: number }
  | { kind: 'attachSidebar'; sessionID: string | undefined };

/**
 * Plans what changing the setting from `from` to `to` does. Decision of Sergio (29/10/2026,
 * issue #77, Q4):
 *
 * - `sidebar` to `editor`: the side-bar pane is detached and, if it showed a session, a tab opens
 *   with it right away (or the tab that already shows it is revealed; one session is never in two
 *   places). With no session nothing opens: the user gets a tab from New Session or Open Chat.
 * - `editor` to `sidebar`: NO tab is closed. They stay open and working, and it is the user who closes
 *   them. The side-bar pane is attached and receives the session remembered for the folder only
 *   if no tab shows it; otherwise it starts lazy, so the same session is not in two surfaces.
 * - Same location: no actions.
 *
 * The draft of a prompt lives in each document and does not travel between surfaces; that is the
 * cost of the switch and is not planned here.
 * VERIFIED by `chatLocation.test.ts` with fabricated states; not observed in a real window.
 */
export function planLocationSwitch(
  from: ChatLocation,
  to: ChatLocation,
  state: LocationState,
): LocationAction[] {
  if (from === to) return [];
  if (to === 'editor') {
    const actions: LocationAction[] = [{ kind: 'detachSidebar' }];
    const session = state.sidebarSession;
    if (session === undefined) return actions;
    const existing = state.tabs.find((tab) => tab.sessionID === session);
    actions.push(
      existing === undefined
        ? { kind: 'openTab', sessionID: session }
        : { kind: 'revealTab', paneId: existing.paneId },
    );
    return actions;
  }
  const remembered = state.rememberedSession;
  const shownByATab =
    remembered !== undefined && state.tabs.some((tab) => tab.sessionID === remembered);
  return [{ kind: 'attachSidebar', sessionID: shownByATab ? undefined : remembered }];
}
