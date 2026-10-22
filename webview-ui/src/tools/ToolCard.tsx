import { createMemo, createSignal, createUniqueId, Show } from 'solid-js';
import type { Part } from '../../../src/shared/model';
import { subagentOf } from '../sessions/lineage';
import { PathLink } from './PathLink';
import { ToolBody } from './ToolBody';
import { toolSummary } from './toolView';

type ToolPart = Extract<Part, { type: 'tool' }>;

/**
 * One tool call of the conversation as a collapsible card (issue #26).
 *
 * The header is a disclosure button (`aria-expanded`, `aria-controls` only while open) with the
 * verb, the main argument, the status word and a short result, separated by " · " ("Shell npm
 * test · failed · exit 1", decision of Sergio, Engram #1042); its accessible name is that same text
 * as ONE string (lesson #926), and the visible separators are `aria-hidden`. Nothing opens by itself
 * (decision (c) of Sergio, 22/10/2026): a failure is read in the header, a Reject or Stop is shown
 * neutral, and a tool that waits for a permission says "waiting for approval". The body is created
 * only while open (`<Show>`), so a folded card costs one line per update and a streaming tool costs
 * nothing per token (the input JSON is not even parsed until `running`).
 *
 * The open state is a local signal. It survives `part.upserted` (running to completed) because the
 * store reconciles the block in place and `<For>` keeps this component; it is lost if VS Code
 * destroys the webview document (HYPOTHESIS: nobody misses it, the default is folded). Siblings of
 * the toggle, never inside it (a button cannot contain buttons): the path link for read, edit and
 * write, and, for a `subagent` with a child session (`subagentOf`, issue #21), the "Open subagent
 * session" button, which keeps its classes `part-subagent` and `subagent-link` and its name
 * including the description. Focus is never moved by code (lesson #929) and nothing is `disabled`.
 *
 * After opening, the toggle is scrolled into view with `scrollIntoView({block: 'nearest'})` one
 * frame later, because the list follows the end through a microtask and a tall body can push the
 * header out of view. HYPOTHESIS for the need: an earlier story here ("found in a run where a
 * question card squeezed the list, the check failed once") was about the FIRST card, not the last,
 * because the visual check tagged the wrong card (`inDoc` forwards one argument; Engram #1041 C1),
 * so no run ever showed the header leaving the view. To check it, remove the call and rerun step 15.
 *
 * VERIFIED by `ToolCard.test.tsx` and `App.test.tsx` (jsdom: folded by default and absent body,
 * names, state kept across an update, the deferred scroll call). The keyboard is NOT tested in
 * jsdom (it does not turn Enter/Space into a click on a button).
 * VERIFIED in a real VS Code (`test:visual` step 15, Windows 11, VS Code 1.143.0, opencode 2.0.32,
 * 22/10/2026, final run 13:59:27-14:05 whose output is kept in `.vscode-test/visual/run-output.txt`;
 * log `.vscode-test/visual/user-data/logs/20261022T135923/window1/exthost/sergwei.open-vs-code/OpenCode.log`,
 * step-15 prompts 14:04:11.728-14:04:17.265 and 14:04:37.157-14:04:38.484), with the checks of that
 * file: line 306 "every tool card is folded by default (aria-expanded=false, no .tool-body in the
 * DOM)"; for each of shell, read, edit and grep (lines 314-346) "Shift+Tab from the prompt box
 * reaches the X toggle", "...with a visible focus ring", "Enter opens the X card and its body
 * appears", "opening the card adds no child to the log (6 -> 6)" and "Space closes the X card and
 * removes its body"; line 375 `the header of the last card (data-tool="edit") is still in view after
 * unfolding it (true)` (the tagged card is the LAST one, an edit, now printed by the check; it
 * shows the header was in view, not that `scrollIntoView` moved anything). The failed card of a
 * read of a missing file (lines 376-390): "failed" with the error tone, the first error line in the
 * header, folded by default, the header fits its toggle (overflow 0 px) and the "failed" chip has
 * contrast 8.68 (light), 8.03 (dark), 21.00 (hc-dark) and 14.55 (hc-light). The header-text
 * contrast (title, argument, status, result) was >= 4.5 in the four themes (lowest 5.47, status in
 * hc-light, lines 349-374). Two defects only a real run showed were fixed in `index.css`: the bare
 * `errorForeground` of the chip measured 3.16 in light, and a long error line ran over the "Open"
 * link in the side bar (capture `15e-tool-failed-light.png` of the first run). NOT observed: a
 * screen reader; whether `scrollIntoView` is needed or moves anything; a card in `running`,
 * `awaiting`, `rejected` or `stopped` state in a real run; macOS and Linux.
 */
export function ToolCard(props: {
  part: ToolPart;
  /** True while a permission or a question of this tool is pending. */
  awaiting: boolean;
  onOpenSession(sessionID: string): void;
}) {
  const [open, setOpen] = createSignal(false);
  const bodyId = `tool-body-${createUniqueId()}`;
  const summary = createMemo(() => toolSummary(props.part, props.awaiting));
  const link = createMemo(() => subagentOf(props.part));

  return (
    <div
      classList={{ 'tool-card': true, 'part-subagent': link() !== undefined }}
      data-tool={props.part.name}
      data-status={summary().status.status}
    >
      <div class="tool-header">
        <button
          type="button"
          class="tool-toggle"
          aria-expanded={open() ? 'true' : 'false'}
          aria-controls={open() ? bodyId : undefined}
          aria-label={summary().name}
          onClick={(event) => {
            const next = !open();
            setOpen(next);
            if (!next) return;
            // After the frame, not now: the list's MutationObserver scrolls to the bottom in a
            // microtask once the body is mounted, and a tall body would push this header out of
            // view. `nearest` moves nothing when the header is already visible. HYPOTHESIS (not
            // observed; to check, stream a tool into a list where a card was just unfolded and see
            // whether the view is dragged to the end): when it does move, its scroll event also
            // drops "follow the end", so streaming does not drag the user back.
            const toggle = event.currentTarget;
            requestAnimationFrame(() => {
              toggle.scrollIntoView?.({ block: 'nearest' });
            });
          }}
        >
          <span class="tool-chevron" aria-hidden="true" />
          <span class="tool-title">{summary().verb}</span>
          <Show when={summary().arg}>{(arg) => <span class="tool-arg">{arg()}</span>}</Show>
          <Show when={summary().detail}>
            {(detail) => <span class="tool-detail">{detail()}</span>}
          </Show>
          <span class="tool-sep" aria-hidden="true">
            ·
          </span>
          <span
            class="tool-status"
            data-tone={summary().status.tone}
            data-status={summary().status.status}
          >
            {summary().status.label}
          </span>
          <Show when={summary().result}>
            {(result) => (
              <>
                <span class="tool-sep" aria-hidden="true">
                  ·
                </span>
                <span class="tool-result">{result()}</span>
              </>
            )}
          </Show>
        </button>
        <Show when={summary().open}>
          {(target) => <PathLink path={target().path} line={target().line} text="Open" />}
        </Show>
        <Show when={link()}>
          {(child) => (
            <button
              type="button"
              class="secondary subagent-link"
              aria-label={`Open subagent session ${child().description ?? ''}`.trim()}
              onClick={() => {
                props.onOpenSession(child().sessionID);
              }}
            >
              Open subagent session
            </button>
          )}
        </Show>
      </div>
      <Show when={open()}>
        <div id={bodyId} class="tool-body" aria-live="off">
          <ToolBody part={props.part} />
        </div>
      </Show>
    </div>
  );
}
