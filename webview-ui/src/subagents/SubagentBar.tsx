import * as l10n from '@vscode/l10n';
import { createEffect, createMemo, createSignal, createUniqueId, For, on, Show } from 'solid-js';
import { toolSummary } from '../tools/toolView';
import { useSubagents, type ActiveChild } from './SubagentContext';
import { formatElapsed, toolPartOf, toolsText } from './subagentView';

/**
 * The strip between the request dock and the status bar that says what the subagents of the open
 * session are doing right now (issue #189, design A of the plan, decisions P2 and P3 of Sergio).
 *
 * It exists ONLY while some child works or waits (P3 = 1: it is live state, so it takes no room
 * once everything finished and the folded cards of the conversation keep the result), and N counts
 * those active children. The header is one disclosure button whose text is ONE string ("Subagents
 * · 2 · 1 working · 1 waiting for your answer", lesson #926), with `aria-expanded` and
 * `aria-controls` only while open. Open, it lists one row per child (agent, task, current tool,
 * elapsed time) with Open, Stop and, only when the child waits on a permission or form, Answer, and
 * a "Stop all" that sends ONE `subagent.stop` without `sessionID` (the parent is never stopped).
 *
 * Rows have a STABLE identity: the list is keyed by child id (`activeIds`, which changes only when
 * the set of children does) and each row reads its row, state and digest by id, so a state change,
 * a permission or a first digest of ANOTHER child never recreates a row and the focus on its
 * buttons stays (review B1 of 08/11/2026: the first version iterated freshly built objects and
 * every change dropped the focus to the body). When what had the focus inside the bar disappears (a
 * row whose child ended, or the whole bar after "Stop all") and the document still has the focus,
 * `focusInput` returns it to the prompt, like the request dock does; with no `focusInput` (tests)
 * nothing moves.
 *
 * Answer only asks the dock to focus the card (`store.requestFocus`); the dock keeps its guards, so
 * the focus is never moved by data arriving, and the card, never a button that approves, is what
 * gets it. Stop and Stop all are `aria-disabled` while their request is in flight (never
 * `disabled`, solid-webview §7). The elapsed time is `aria-hidden` and the strip is no live region,
 * so the one-second tick announces nothing. The list of the header ("Subagent sessions") stays (P2 = 1).
 * Without a provider it draws nothing.
 *
 * VERIFIED by `SubagentBar.test.tsx` (jsdom, fabricated store data: hidden without active children,
 * the one-string summary, aria wiring, rows, Answer only when waiting and its `requestFocus`, one
 * `subagent.stop` for Stop all, no focus change when a child arrives, the focus on "Stop One"
 * surviving a permission, a retry and a first digest of another child, the focus returning to the
 * prompt when its row or the whole bar goes, no `style`).
 * VERIFIED in a real VS Code 1.145.2 on Windows 11 (08/11/2026, the complete `test:visual` run of
 * this tree: step 51 has no FAIL; its only FAILs are 4 checks of step 45, the mods popover, #195,
 * which also fails intermittently on main). The ok lines of step 51 that cover this bar, quoted up to the values
 * in parentheses: "first round: the bar list is open", "the bar lists A working and B waiting",
 * "the header is one string with the counts", "each row has its Stop and only the waiting one has
 * Answer", "the data that arrived did not move the focus into the bar or the live cards", "Stop on
 * the row of A is pressed", "A leaves the bar after Stop", "Stop all empties the bar", and for
 * layout and contrast "the monitor at 300 (bar 300 px), dark: text contrast >= 4.5", "the monitor
 * at wide (bar 900 px), light: no sideways overflow", "the monitor in a chat tab, hc-light: text
 * contrast >= 4.5". The "150 px" cell was measured at 170 px, the narrowest the workbench allows
 * (the step prints a warn and judges it as "narrow"). UNVERIFIED in a real VS Code: the focus
 * returning to the prompt when a row or the whole bar goes away (no check of `test:visual` reads
 * it; only the jsdom test above does), and macOS and Linux.
 */
export function SubagentBar(props: { focusInput?: () => void }) {
  const monitor = useSubagents();
  const [open, setOpen] = createSignal(false);
  const panelId = `subagent-bar-${createUniqueId()}`;
  const active = (): ActiveChild[] => monitor?.active() ?? [];
  const ids = (): string[] => monitor?.activeIds() ?? [];
  const summary = createMemo(() => {
    const children = active();
    const waiting = children.filter((child) => child.state === 'waiting').length;
    const working = children.length - waiting;
    const pieces = [l10n.t('Subagents · {0}', children.length)];
    if (working > 0) pieces.push(l10n.t('{0} working', working));
    if (waiting > 0) pieces.push(l10n.t('{0} waiting for your answer', waiting));
    return pieces.join(' · ');
  });
  const allStopping = (): boolean =>
    active().length > 0 && active().every((child) => monitor?.stopping(child.row.id) === true);

  // Focus bookkeeping (W4): `inside` is true from a focus inside the bar until the focus is seen
  // elsewhere; removing the focused element fires no focusout we can rely on, so the effect below
  // is what notices it is gone.
  let section: HTMLElement | undefined;
  let inside = false;
  createEffect(
    on(ids, () => {
      if (!inside) return;
      const focused = document.activeElement;
      if (section?.isConnected === true && section.contains(focused)) return;
      inside = false;
      if (!document.hasFocus()) return;
      if (focused !== null && focused !== document.body) return;
      props.focusInput?.();
    }),
  );

  return (
    <Show when={monitor !== undefined && ids().length > 0}>
      <section
        class="subagent-bar"
        aria-label={l10n.t('Subagents')}
        ref={(element) => {
          section = element;
        }}
        onFocusIn={() => {
          inside = true;
        }}
        onFocusOut={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && !event.currentTarget.contains(next)) inside = false;
        }}
      >
        <button
          type="button"
          class="subagent-bar-toggle"
          aria-expanded={open() ? 'true' : 'false'}
          aria-controls={open() ? panelId : undefined}
          onClick={() => {
            setOpen(!open());
          }}
        >
          <span class="tool-chevron" aria-hidden="true" />
          {summary()}
        </button>
        <Show when={open()}>
          <div id={panelId} class="subagent-bar-panel">
            <ul class="subagent-rows" role="list">
              <For each={ids()}>{(id) => <SubagentRow id={id} />}</For>
            </ul>
            <button
              type="button"
              class="secondary subagent-stop-all"
              aria-disabled={allStopping() ? 'true' : undefined}
              onClick={() => {
                monitor?.stop();
              }}
            >
              {allStopping() ? l10n.t('Stopping…') : l10n.t('Stop all')}
            </button>
          </div>
        </Show>
      </section>
    </Show>
  );
}

/**
 * One child of the bar, keyed by its id. The buttons carry the task in their accessible name
 * ("Stop <task>"), so a list of three Stops is not three identical names. The current tool is the
 * normal tool summary of the last tool of the digest (no second tool mapping). The row, the state
 * and the digest are read from the monitor on each use, so they update in place: the `li` and its
 * buttons are created once per child id, which is what keeps the focus (see {@link SubagentBar}).
 */
function SubagentRow(props: { id: string }) {
  const monitor = useSubagents();
  const row = () => monitor?.session(props.id);
  const activity = () => monitor?.activity(props.id);
  const waiting = (): boolean => monitor?.stateOf(props.id) === 'waiting';
  const task = (): string => row()?.title ?? '';
  // Literal keys on purpose: `l10n:export` only finds `l10n.t('…')` with a string literal.
  const openName = (): string =>
    task() === '' ? l10n.t('Open subagent session') : l10n.t('Open subagent session {0}', task());
  const answerName = (): string =>
    task() === '' ? l10n.t('Answer') : l10n.t('Answer {0}', task());
  const stopName = (): string =>
    task() === '' ? l10n.t('Stop subagent') : l10n.t('Stop {0}', task());
  const tool = () => activity()?.recent.at(-1);
  const stopping = (): boolean => monitor?.stopping(props.id) === true;

  return (
    <li class="subagent-row" data-state={waiting() ? 'waiting' : 'working'}>
      <div class="subagent-row-info">
        <Show when={row()?.agent}>{(agent) => <span class="subagent-agent">{agent()}</span>}</Show>
        <span class="subagent-task">{task()}</span>
        <Show when={tool()}>
          {(current) => (
            <span class="subagent-current">{toolSummary(toolPartOf(current()), false).name}</span>
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
        <Show when={waiting()}>
          <span class="subagent-state">{l10n.t('Waiting for your answer')}</span>
        </Show>
      </div>
      <div class="subagent-actions">
        <button
          type="button"
          class="secondary"
          aria-label={openName()}
          onClick={() => {
            monitor?.open(props.id);
          }}
        >
          {l10n.t('Open')}
        </button>
        <Show when={waiting()}>
          <button
            type="button"
            class="secondary"
            aria-label={answerName()}
            onClick={() => {
              monitor?.answer(props.id);
            }}
          >
            {l10n.t('Answer')}
          </button>
        </Show>
        <button
          type="button"
          class="secondary"
          aria-disabled={stopping() ? 'true' : undefined}
          aria-label={stopName()}
          onClick={() => {
            monitor?.stop(props.id);
          }}
        >
          {stopping() ? l10n.t('Stopping…') : l10n.t('Stop')}
        </button>
      </div>
    </li>
  );
}
