import * as l10n from '@vscode/l10n';
import { createMemo, Show } from 'solid-js';
import { splitAtRevert } from '../changes/revertView';
import type { ChatStore } from '../store/chatStore';
import { contextUsage, describeUsage, sessionCost } from './usage';

/**
 * The dimmed line under the session title (issue #25): "Context 9K / 200K (5%) · $0.02".
 *
 * Placement is Sergio's choice of 22/10/2026 (Engram #1097): under the title in the header, not in
 * the status row (the recommended option). Nothing is drawn without an open session or without
 * usage; without the model's limit the "/ 200K (5%)" part is omitted. All the figures come from
 * {@link describeUsage} over the store, as memos, so it updates when a step ends
 * (`message.upserted` with tokens) or the totals change (`session.upserted` with `usage`) and no
 * resync is needed. The context figure is measured over the messages a prepared revert leaves
 * visible (`splitAtRevert(...).visible`, issue #32), because the hidden ones are not in the model's
 * context any more; the cost is the session's, untouched.
 *
 * Accessibility (Sergio's decision of 22/10/2026, Engram #1115): a plain `<p>` holding two spans.
 * The visible shorthand is `aria-hidden="true"` and carries the tooltip (`title`, harmless there
 * because an aria-hidden node is not exposed, so nothing is read twice); a `visually-hidden` span
 * holds the full sentence with exact figures (and "including subagents" when a child session is
 * summed), which is what a screen reader reads, as normal text. No `role="img"`. It is NOT a live
 * region: a line that changes at the end of every step would interrupt the user each time.
 * `data-level="high"` (from 80 %) adds a warning border; the text keeps the foreground colour and
 * still says the percentage (skill solid-webview §6: no error colour as text on the sidebar). No
 * `style` attribute (the visual test fails on one).
 * Issue #188 (decision P2=1 of Sergio, 12/11/2026, Engram `E2-chat-panel-tabs/decisions/p1-p2`):
 * the line stays under the header in all three tabs, and from the `high` level (80 %) a "Compact"
 * button follows it as the next sibling in the header area, OUTSIDE the `<p>` (so the sentence a
 * screen reader gets from the line, its tag and its place under the title stay as they were), when
 * the parent passes `onCompact`: that button IS the warning of a nearly full context (criterion 7).
 * It is `aria-disabled` while `compactDisabled`, so it keeps the focus.
 * VERIFIED in jsdom by `UsageIndicator.test.tsx` ("shows Compact only from the high level and
 * runs the callback", "does not call it while disabled").
 * VERIFIED in jsdom (`UsageIndicator.test.tsx`, `App.test.tsx`) for the text, the two spans and the
 * updates. VERIFIED in a real VS Code (Windows 11, VS Code 1.146.0, 12/11/2026) for the `high`
 * level and its Compact on the Chat tab by `test:visual` step 55: "S3 criterion 7: on the Chat tab
 * the context line is at the high level, says 86 % and has a visible Compact" (the NEAR_FULL
 * trigger of the fixture is INVENTED). HYPOTHESIS for a real screen reader (none was run) and for
 * macOS/Linux; step 17 measures the contrast of the line itself in the 4 themes.
 */
export function UsageIndicator(props: {
  store: ChatStore;
  /** Compacts the session; the button below is drawn only when this is given. */
  onCompact?: () => void;
  /** The button is `aria-disabled` (it keeps the focus) while a request is in flight or there is no host. */
  compactDisabled?: boolean;
}) {
  const state = props.store.state;
  const view = createMemo(() => {
    const id = state.open.sessionID;
    if (id === undefined) return undefined;
    // Issue #32: the messages a prepared revert hides are not in the model's context any more.
    const shown = splitAtRevert(state.open.messages, state.open.revert).visible;
    const context = contextUsage(shown, state.open.compactedAt, state.catalog);
    return describeUsage(
      context,
      sessionCost(state.sessions, id),
      state.catalog,
      state.sessions[id]?.model,
    );
  });
  return (
    <Show when={view()}>
      {(current) => (
        <>
          <p class="usage-line" data-level={current().level}>
            <span aria-hidden="true" title={current().name}>
              {current().text}
            </span>
            <span class="visually-hidden">{current().name}</span>
          </p>
          <Show when={current().level === 'high' && props.onCompact}>
            {(compact) => (
              <button
                type="button"
                class="secondary usage-compact"
                aria-disabled={props.compactDisabled === true}
                onClick={() => {
                  if (props.compactDisabled !== true) compact()();
                }}
              >
                {l10n.t('Compact')}
              </button>
            )}
          </Show>
        </>
      )}
    </Show>
  );
}
