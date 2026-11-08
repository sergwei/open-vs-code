import * as l10n from '@vscode/l10n';
import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import type { Part } from '../../../src/shared/model';
import { subagentOf } from '../sessions/lineage';
import { useSubagents } from '../subagents/SubagentContext';
import {
  failureReason,
  formatElapsed,
  summaryLine,
  toolPartOf,
  toolsText,
} from '../subagents/subagentView';
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
 * 22/10/2026, the run of 13:59:27-14:05; the extension's OpenCode.log has the step-15 prompts at
 * 14:04:11.728-14:04:17.265 and 14:04:37.157-14:04:38.484), with the checks of that step: "every
 * tool card is folded by default (aria-expanded=false, no .tool-body in the DOM)"; for each of
 * shell, read, edit and grep "Shift+Tab from the prompt box reaches the X toggle", "...with a
 * visible focus ring", "Enter opens the X card and its body appears", "opening the card adds no
 * child to the log (6 -> 6)" and "Space closes the X card and removes its body"; `the header of
 * the last card (data-tool="edit") is still in view after unfolding it (true)` (the tagged card is
 * the LAST one, an edit, printed by the check; it shows the header was in view, not that
 * `scrollIntoView` moved anything). The failed card of a read of a missing file: the checks "the
 * failed read card says "failed" with the error tone", "the failed card shows the first line of the
 * error in its header", "the failed card is folded by default", "the failed header fits inside its
 * toggle, nothing runs over the Open link (overflow 0 px)", and "the error-toned "failed" word has
 * text contrast >= 4.5 in light|dark|hc-dark|hc-light" (8.68, 8.03, 21.00, 14.55). The header-text
 * contrast (title, argument, status, result) was >= 4.5 in the four themes (lowest 5.47, status in
 * hc-light). Two defects only a real run showed were fixed in `index.css`: the bare
 * `errorForeground` of the chip measured 3.16 in light, and a long error line ran over the "Open"
 * link in the side bar (seen in a capture of the first run). NOT observed: a
 * screen reader; whether `scrollIntoView` is needed or moves anything; a card in `running`,
 * `awaiting`, `rejected` or `stopped` state in a real run; macOS and Linux.
 *
 * Subagent monitor (issue #189). Inside a `SubagentProvider`, a `subagent` block whose child session
 * is known (`monitor.childOf`: the block's own link, else title + agent) gets two things. While the
 * CHILD works or waits (its state, not the tool's: with `background: true` the tool is `completed`
 * at once) a live section sits under the header: state word, current tool, elapsed time
 * (`aria-hidden`), tool count, the last tools and a Stop button; it has `aria-live="off"` because
 * the message list is a live log. Once the child is over the section is gone and the header's
 * result becomes the summary ("Finished · 3 tools · $0.02", "Failed: <reason>", "Stopped"), also
 * in the toggle's accessible name, which still starts with "Subagent". With a summary the tool's
 * own status word ("done", "failed"...) and its separator are NOT drawn nor named (decision of
 * Sergio, reconciliation W4: a stopped child is a ToolFailure of the parent, so the word read
 * "failed · Stopped"); the summary is the status. Open stays the
 * `.subagent-link` of the header, now also for a child found by title + agent. Stop is
 * `aria-disabled` while its request is in flight, never `disabled`, so the focus does not fall to
 * the body. Without a provider the card is the old one.
 * VERIFIED by the `subagent monitor` cases of `ToolCard.test.tsx` (jsdom, fabricated store data and
 * messages). VERIFIED in a real VS Code 1.145.2 on Windows 11 (08/11/2026, the complete
 * `test:visual` run on this final tree: no FAIL in step 51 or in the checks quoted here; its only
 * FAILs are in the mods popover of step 45, #195, which passed twice alone right after): "A's card is live with Stop, Open and 1 to 3 latest tools, and B's card says waiting", "the
 * card of A folds into "Stopped"", "the cards fold into Finished, Stopped and Failed", "the card
 * labels still start with "Subagent"". VERIFIED in the same complete run: "a folded card draws no tool
 * status word beside its summary", "side bar 300 px: the folded card of B reads "Finished · N
 * tools · cost" ("Finished · 1 tool · $0.01")", "side bar 300 px, hc-light: the folded card is
 * inside the document (true), no sideways overflow (0 px), no style attribute (0), title and
 * summary contrast >= 4.5 (min 5.47 over 2 texts)" (the four themes), and "chat tab: the folded
 * card of B reads "Finished · N tools · cost"" with "chat tab, dark: the folded card is inside the
 * document". The 150 px cell was measured at 170 px (the workbench minimum).
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
  const monitor = useSubagents();
  const child = createMemo(() => monitor?.childOf(props.part));
  // The session the Open button points at: the block's own link, else the child found by title + agent.
  const target = createMemo(() => {
    const linked = link();
    if (linked !== undefined)
      return { sessionID: linked.sessionID, description: linked.description };
    const row = child();
    return row === undefined ? undefined : { sessionID: row.id, description: row.title };
  });
  const parentError = (): string | undefined =>
    props.part.state.status === 'error' ? props.part.state.error.message : undefined;
  const childState = createMemo(() => {
    const row = child();
    return row === undefined ? undefined : monitor?.stateOf(row.id, parentError());
  });
  const live = (): boolean => childState() === 'working' || childState() === 'waiting';
  const activity = createMemo(() => {
    const row = child();
    return row === undefined ? undefined : monitor?.activity(row.id);
  });
  // Replaces the header's result once the child is over; never while the tool itself still runs.
  const finished = createMemo(() => {
    const row = child();
    const state = childState();
    const status = summary().status.status;
    if (row === undefined || state === undefined || status === 'running' || status === 'awaiting') {
      return undefined;
    }
    const error = parentError();
    return summaryLine({
      state,
      toolCount: activity()?.toolCount ?? 0,
      ...(activity()?.partial === true ? { partial: true } : {}),
      ...(row.usage === undefined ? {} : { cost: row.usage.cost }),
      ...(state === 'failed' && error !== undefined ? { reason: failureReason(error) } : {}),
    });
  });
  const result = (): string | undefined => finished() ?? summary().result;
  // The same name `toolSummary` builds, with the summary in place of the server's result.
  const label = (): string => {
    if (finished() === undefined) return summary().name;
    const subject = [summary().verb, summary().arg, summary().detail]
      .filter((piece): piece is string => piece !== undefined)
      .join(' ');
    return [subject, finished()]
      .filter((piece): piece is string => piece !== undefined && piece !== '')
      .join(' · ');
  };
  const current = () => activity()?.recent.at(-1);

  return (
    <div
      classList={{ 'tool-card': true, 'part-subagent': target() !== undefined }}
      data-tool={props.part.name}
      data-status={summary().status.status}
    >
      <div class="tool-header">
        <button
          type="button"
          class="tool-toggle"
          aria-expanded={open() ? 'true' : 'false'}
          aria-controls={open() ? bodyId : undefined}
          aria-label={label()}
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
          <Show when={finished() === undefined}>
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
          </Show>
          <Show when={result()}>
            {(text) => (
              <>
                <span class="tool-sep" aria-hidden="true">
                  ·
                </span>
                <span class="tool-result">{text()}</span>
              </>
            )}
          </Show>
        </button>
        <Show when={summary().open}>
          {(target) => <PathLink path={target().path} line={target().line} text={l10n.t('Open')} />}
        </Show>
        <Show when={target()}>
          {(session) => (
            <button
              type="button"
              class="secondary subagent-link"
              aria-label={
                session().description === undefined || session().description === ''
                  ? l10n.t('Open subagent session')
                  : l10n.t('Open subagent session {0}', session().description ?? '')
              }
              onClick={() => {
                props.onOpenSession(session().sessionID);
              }}
            >
              {l10n.t('Open subagent session')}
            </button>
          )}
        </Show>
      </div>
      <Show when={live() ? child() : undefined}>
        {(row) => (
          <div class="subagent-live" data-state={childState()} aria-live="off">
            <p class="subagent-live-line">
              <span class="subagent-state">
                {childState() === 'waiting' ? l10n.t('Waiting for your answer') : l10n.t('Working')}
              </span>
              <Show when={current()}>
                {(tool) => (
                  <span class="subagent-current">
                    {toolSummary(toolPartOf(tool()), false).name}
                  </span>
                )}
              </Show>
              <Show when={activity()?.since}>
                {(since) => (
                  <span class="subagent-elapsed" aria-hidden="true">
                    {formatElapsed((monitor?.now() ?? since()) - since())}
                  </span>
                )}
              </Show>
              <Show when={toolsText(activity()?.toolCount ?? 0, activity()?.partial)}>
                {(count) => <span class="subagent-count">{count()}</span>}
              </Show>
            </p>
            <Show when={(activity()?.recent.length ?? 0) > 0}>
              <ul class="subagent-tools" role="list" aria-label={l10n.t('Latest tools')}>
                <For each={activity()?.recent ?? []}>
                  {(tool) => <li>{toolSummary(toolPartOf(tool), false).name}</li>}
                </For>
              </ul>
            </Show>
            <button
              type="button"
              class="secondary subagent-stop"
              aria-disabled={monitor?.stopping(row().id) === true ? 'true' : undefined}
              aria-label={
                row().title === undefined || row().title === ''
                  ? l10n.t('Stop subagent')
                  : l10n.t('Stop {0}', row().title ?? '')
              }
              onClick={() => {
                monitor?.stop(row().id);
              }}
            >
              {monitor?.stopping(row().id) === true ? l10n.t('Stopping…') : l10n.t('Stop')}
            </button>
          </div>
        )}
      </Show>
      <Show when={open()}>
        <div id={bodyId} class="tool-body" aria-live="off">
          <ToolBody part={props.part} />
        </div>
      </Show>
    </div>
  );
}
