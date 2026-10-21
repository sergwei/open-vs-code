import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { Catalog } from '../../../src/shared/model';
import { dismissOutside } from './dismissOutside';
import { agentLabel } from './selection';

/** The two agents that get their own segment; any other selectable agent goes under "More agents". */
const QUICK_AGENTS = ['build', 'plan'] as const;

/** `id` of the "More agents" panel, referenced by the `aria-controls` of its button. */
const MORE_PANEL_ID = 'agent-more-panel';

/** Marks the "More agents" button so a pointer-down on it is not read as "outside". */
const MORE_TRIGGER_SELECTOR = '[data-agent-more-trigger]';

/** "Current · <description>" for an entry of the "More agents" list, as ONE string (lesson #926). */
function agentMeta(description: string | undefined, current: boolean): string {
  return [current ? 'Current' : undefined, description]
    .filter((field): field is string => field !== undefined && field !== '')
    .join(' · ');
}

/**
 * The agent selector of the prompt row (issue #24): a Build | Plan switch that is one click, and a
 * "More agents" button for the custom agents, shown only when the server has any.
 *
 * The switch is a `<fieldset>` of NATIVE radio buttons (`type="radio"`, visually hidden) with a
 * `<label>` as each segment, so arrow keys move between agents and a screen reader hears "Agent,
 * Build, selected, 1 of 2" without hand-written roving. The radios share a `name`; `checked` follows
 * the effective agent. If the effective agent is neither Build nor Plan (a custom one picked from
 * "More agents", or the agent of a subagent session the user opened), it shows as a third checked
 * segment with its name, so what the next prompt will use is never hidden. "More agents" opens a
 * non-modal `role="dialog"` over the row, upwards, listing the custom agents as buttons; picking
 * one closes it and returns the focus to the button, Escape does the same, a pointer-down outside
 * closes it without moving the focus. Without a catalog or a connection everything is
 * `aria-disabled` and the click is cancelled (`preventDefault` reverts a radio), never `disabled`: a
 * control that holds the focus must keep it (lesson of the session picker). Enter on a radio would
 * submit the prompt's <form> (HYPOTHESIS about Chromium's implicit submission: jsdom does not do it,
 * so the test only checks that the keydown is cancelled); it is cancelled here either way.
 * Picking only changes the draft; the host hears it with the next prompt.
 * VERIFIED by `AgentToggle.test.tsx` in jsdom; the look, arrow keys and the focus ring in a real
 * VS Code by `npm run test:visual` step 11 (Windows); screen readers UNVERIFIED. HYPOTHESIS (review
 * #1015 S4): while disconnected the radios are `aria-disabled`, and whether Chromium's arrow-key
 * navigation fires the `click` this component cancels is unknown; if it does not, the shown radio
 * could disagree with the draft until the effective agent changes. Check by pressing the arrows in
 * a real VS Code with the server stopped.
 */
export function AgentToggle(props: {
  catalog: Catalog | undefined;
  /** The agent id the next prompt will use. */
  effective: string | undefined;
  disabled: boolean;
  onSelect(agent: string): void;
}) {
  const [moreOpen, setMoreOpen] = createSignal(false);
  let morePanel: HTMLDivElement | undefined;
  let moreTrigger: HTMLButtonElement | undefined;

  const unusable = () => props.disabled || props.catalog === undefined;
  const quick = createMemo(() =>
    QUICK_AGENTS.filter((id) => props.catalog?.agents.some((agent) => agent.id === id) ?? false),
  );
  /** Selectable agents that have no segment of their own. */
  const more = createMemo(
    () =>
      props.catalog?.agents.filter(
        (agent) => !(QUICK_AGENTS as readonly string[]).includes(agent.id),
      ) ?? [],
  );
  /** The effective agent when it has no quick segment, so it is still shown and checked. */
  const extra = createMemo(() => {
    const id = props.effective;
    return id === undefined || (QUICK_AGENTS as readonly string[]).includes(id) ? undefined : id;
  });

  const closeMore = (restoreFocus: boolean): void => {
    setMoreOpen(false);
    if (restoreFocus) moreTrigger?.focus();
  };

  dismissOutside(
    () => morePanel,
    MORE_TRIGGER_SELECTOR,
    () => {
      closeMore(false);
    },
  );

  createEffect(() => {
    if (unusable()) closeMore(false);
  });

  const choose = (id: string): void => {
    if (unusable()) return;
    props.onSelect(id);
  };

  return (
    <>
      <fieldset
        class="agent-toggle"
        aria-disabled={unusable() ? 'true' : undefined}
        onKeyDown={(event) => {
          // Enter on a radio could submit the prompt's <form>: never let it.
          if (event.key === 'Enter') event.preventDefault();
        }}
      >
        <legend class="visually-hidden">Agent</legend>
        <For each={quick()}>
          {(id) => (
            <>
              <input
                type="radio"
                class="visually-hidden agent-radio"
                name="agent"
                id={`agent-${id}`}
                value={id}
                checked={props.effective === id}
                aria-disabled={unusable() ? 'true' : undefined}
                onClick={(event) => {
                  if (unusable()) event.preventDefault();
                }}
                onChange={() => {
                  choose(id);
                }}
              />
              <label for={`agent-${id}`}>{agentLabel(props.catalog, id)}</label>
            </>
          )}
        </For>
        <Show when={extra()}>
          {(id) => (
            <>
              <input
                type="radio"
                class="visually-hidden agent-radio"
                name="agent"
                id={`agent-${id()}`}
                value={id()}
                checked
                aria-disabled={unusable() ? 'true' : undefined}
                onClick={(event) => {
                  if (unusable()) event.preventDefault();
                }}
              />
              <label for={`agent-${id()}`}>{agentLabel(props.catalog, id())}</label>
            </>
          )}
        </Show>
      </fieldset>
      <Show when={more().length > 0}>
        <button
          type="button"
          class="secondary agent-more"
          data-agent-more-trigger
          aria-haspopup="dialog"
          aria-expanded={moreOpen()}
          aria-controls={MORE_PANEL_ID}
          aria-disabled={unusable() ? 'true' : undefined}
          ref={(element) => {
            moreTrigger = element;
          }}
          onClick={() => {
            if (unusable()) return;
            setMoreOpen(!moreOpen());
          }}
        >
          More agents
        </button>
        <Show when={moreOpen()}>
          <div
            id={MORE_PANEL_ID}
            class="model-panel agent-panel"
            role="dialog"
            aria-label="More agents"
            ref={(element) => {
              morePanel = element;
              queueMicrotask(() => {
                element.querySelector<HTMLButtonElement>('button')?.focus();
              });
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              closeMore(true);
            }}
          >
            <ul class="model-list">
              <For each={more()}>
                {(agent) => (
                  <li>
                    <button
                      type="button"
                      class="model-option"
                      aria-current={props.effective === agent.id ? 'true' : undefined}
                      onClick={() => {
                        choose(agent.id);
                        closeMore(true);
                      }}
                    >
                      <span class="model-name">{agent.name}</span>
                      <Show
                        when={agentMeta(agent.description, props.effective === agent.id) !== ''}
                      >
                        <span class="model-meta">
                          {agentMeta(agent.description, props.effective === agent.id)}
                        </span>
                      </Show>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </Show>
    </>
  );
}
