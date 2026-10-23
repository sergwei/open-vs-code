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
 * VERIFIED in jsdom (`UsageIndicator.test.tsx`, `App.test.tsx`) for the text, the two spans and the
 * updates. HYPOTHESIS for a real screen reader (none was run), for macOS/Linux, for the `high`
 * level (one short turn never reaches it) and for the contrast in the 4 themes after this change:
 * `npm run test:visual` step 17 must be re-run to measure it.
 */
export function UsageIndicator(props: { store: ChatStore }) {
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
        <p class="usage-line" data-level={current().level}>
          <span aria-hidden="true" title={current().name}>
            {current().text}
          </span>
          <span class="visually-hidden">{current().name}</span>
        </p>
      )}
    </Show>
  );
}
