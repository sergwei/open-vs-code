import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { Catalog, ModelOption, ModelRef } from '../../../src/shared/model';
import type { ConnectionState } from '../../../src/shared/protocol';
import { ChevronIcon } from '../chat/icons';
import { dismissOutside } from './dismissOutside';
import {
  agentChoices,
  agentMeta,
  chipLabel,
  groupModels,
  modelMeta,
  pickModel,
  sameModel,
  type AgentChoice,
  type EffectiveModel,
  type VariantChoices,
} from './selection';

/** Built from its code point: a literal one in the source trips `no-irregular-whitespace`. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** `id` of the panel, referenced by the `aria-controls` of the chip. */
const PANEL_ID = 'agent-model-panel';

/** Marks the chip so a pointer-down on it is not read as "outside" (see `dismissOutside`). */
const TRIGGER_SELECTOR = '[data-chip]';

/** The status words of the connection dot, so the colour is never the only signal (decision P10=1). */
const CONNECTION_TEXT: Record<ConnectionState['state'], string> = {
  starting: 'Starting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  unavailable: 'Unavailable',
  stopped: 'Stopped',
};

/** Key of a model in the roving tab stop: provider and catalog id never contain a newline. */
const keyOf = (model: { providerID: string; id: string }): string =>
  `${model.providerID}\n${model.id}`;

/** One row of the Reasoning column: "Default" (no value), a variant of the catalog, or the missing one. */
type VariantEntry = {
  value: string | undefined;
  label: string;
  current: boolean;
  missing: boolean;
};

/**
 * A roving tab stop over a list of keys: the last focused row if it is still listed, else the
 * current one, else the first. One tab stop per list; `reset` forgets the last focused row.
 */
function createRoving(keys: () => string[], current: () => string | undefined) {
  const [active, setActive] = createSignal<string | undefined>();
  const tabbable = createMemo(() => {
    const list = keys();
    const wanted = active();
    if (wanted !== undefined && list.includes(wanted)) return wanted;
    const now = current();
    if (now !== undefined && list.includes(now)) return now;
    return list[0];
  });
  return {
    tabbable,
    focused: (key: string) => {
      setActive(key);
    },
    reset: () => {
      setActive(undefined);
    },
  };
}

/**
 * The combined chip of the prompt bar (E2, issue #85, phase 3): ONE button, "Build · GLM-5.3-Flash
 * Free · low ▾", that shows what the next prompt will use and opens a panel with the Agent and
 * Model columns and, only when the effective model lists variants, a Reasoning section INSIDE the
 * Model column under its list (decision of Sergio, 27/10/2026, as sketch D3; phase 3 had it across
 * the full width under both columns, so with the columns stacked under 360 px it still comes after
 * the model list). It
 * replaces the old `AgentToggle`, `ModelPicker` and `VariantPicker`; the search, the provider groups,
 * the roving tab stops and the live region are the `ModelPicker` ones MOVED here, and the Reasoning
 * rows are the `VariantPicker` ones.
 *
 * The panel is a `role="dialog"` that is NOT modal and opens UPWARDS over the bar (CSS `.model-panel`).
 * Opening puts the focus on the current agent (else the search box). Each list is its own roving
 * group: ArrowUp/Down/Home/End move inside it (one tab stop per list, Tab walks between lists), the
 * model list is entered from the search box with ArrowDown and left back to it with ArrowUp from the
 * first row. Enter on the box picks the first match and never submits the prompt's form. Choosing
 * ANYTHING closes the panel and returns the focus to the chip (decision P6=1, Engram #1300); Escape
 * does the same without choosing, with `preventDefault` and `stopPropagation` (the prompt box stops
 * the turn on Escape while busy); a pointer-down outside closes it without moving the focus, and so
 * does the focus leaving for another element of the page, the window losing the focus, or the
 * parent moving the focus by code (`onCloseReady`, as the "+" menu). The current row of each list carries
 * `aria-current="true"` and the word "Current", not only a colour. What is in use but the catalog
 * does not offer (an agent of a subagent session, a retired model, a variant no longer listed)
 * shows first in its list as "<name> (unavailable)", current and not pickable (decision P7=1):
 * choosing it just closes the panel, and Send stays allowed (the host refuses with a notice).
 *
 * The chip has `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls` and the name "Agent and
 * model: <text> (<connection>)", whose first part is the visible text (WCAG 2.5.3). The dot is a
 * decorative element: the connection state (Connected, Starting, Reconnecting, Unavailable, Stopped)
 * is in the name and in the tooltip (decision P10=1). It uses `aria-disabled`, not `disabled`: it can
 * hold the focus when the connection drops, and a disabled button throws the focus onto the page.
 * Picking does NOT talk to the host: it is a draft the prompt carries (decision of 21/10/2026,
 * Engram #1012); the same model keeps its variant, any other starts on Default (Engram #1021).
 * A panel left open when the connection drops closes and keeps the focus only if it was inside it.
 * VERIFIED by `AgentModelMenu.test.tsx` in jsdom on Windows 11 (27/10/2026, `npm test` green; focus
 * checked with `document.activeElement`): "Escape closes without picking, returns the focus to the
 * chip and is not left to the prompt", "Enter in the box picks the first match, closes, returns the
 * focus and never submits the form", "the focus moving to another element of the page closes the
 * panel", "picking the model already in use keeps its variant, picking another starts on Default"
 * (fabricated catalog, so they prove the wiring, not the server). VERIFIED on Windows 11 with
 * VS Code 1.143.1 (27/10/2026) by `npm run test:visual`: "the columns are stacked at 274 px of
 * container (stacked only under 360)", "the panel is inside the view (top 257)", "Tab from the
 * prompt reaches the chip" and "the focused chip shows a ring". The two-column layout is VERIFIED
 * the same way (27/10/2026, Windows 11, VS Code 1.143.1) in the four themes: "at wide (bar 900
 * px), dark: the chip panel has the Agent and Model columns side by side", "…Reasoning is inside
 * the Model column, under the model list", "…the chip panel fits the view and the page does not
 * scroll sideways" and "…Escape closes the chip panel and the focus returns to the chip". Screen
 * readers, macOS and Linux UNVERIFIED. HYPOTHESIS (review #1015 S2, inherited): the "N models" live region lives in
 * the conditionally rendered panel, so a screen reader may not announce its first text.
 */
export function AgentModelMenu(props: {
  catalog: Catalog | undefined;
  /** The agent id the next prompt will use. */
  agent: string | undefined;
  /** The model (and variant) the next prompt will use. */
  model: EffectiveModel | undefined;
  /** What the Reasoning section shows; hidden when `visible` is false. */
  variants: VariantChoices;
  /** The state of the server connection, for the dot of the chip. */
  connection: ConnectionState['state'];
  /** True when there is no connection: the chip stays focusable but does nothing. */
  disabled: boolean;
  onSelectAgent(agent: string): void;
  onSelectModel(model: ModelRef): void;
  onSelectVariant(variant: string | undefined): void;
  /**
   * Hands the parent a function that closes the panel without touching the focus, for when it moves
   * the focus by code (a shortcut of issue #35): the webview document may not own the focus then, so
   * the browser fires no `focusout` and the panel would stay open over the box.
   */
  onCloseReady?(close: () => void): void;
}) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [announcement, setAnnouncement] = createSignal('');
  let panel: HTMLDivElement | undefined;
  let chip: HTMLButtonElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  let flip = false;

  const unusable = () => props.disabled || props.catalog === undefined;
  const label = createMemo(() => chipLabel(props.catalog, props.agent, props.model));
  const status = () => CONNECTION_TEXT[props.connection];
  const chipName = () => `Agent and model: ${label()} (${status()})`;

  const agents = createMemo(() => agentChoices(props.catalog, props.agent));
  const groups = createMemo(() => groupModels(props.catalog, search()));
  const total = createMemo(() => groups().reduce((sum, group) => sum + group.models.length, 0));
  /** The model in use when the catalog no longer offers it: first in its list, not pickable. */
  const missingModel = () =>
    props.model !== undefined && props.model.option === undefined && search() === ''
      ? props.model.ref
      : undefined;
  const variantEntries = createMemo<VariantEntry[]>(() => {
    const { options, current, missing } = props.variants;
    const list: VariantEntry[] = [
      { value: undefined, label: 'Default', current: current === undefined, missing: false },
      ...options.map((id) => ({ value: id, label: id, current: current === id, missing: false })),
    ];
    if (missing !== undefined) {
      list.push({
        value: missing,
        label: `${missing} (unavailable)`,
        current: true,
        missing: true,
      });
    }
    return list;
  });

  const agentStop = createRoving(
    () => agents().map((choice) => choice.id),
    () => agents().find((choice) => choice.current)?.id,
  );
  const modelStop = createRoving(
    () => {
      const missing = missingModel();
      const keys = groups().flatMap((group) => group.models.map(keyOf));
      return missing === undefined ? keys : [keyOf(missing), ...keys];
    },
    () => (props.model === undefined ? undefined : keyOf(props.model.ref)),
  );
  const variantStop = createRoving(
    () => variantEntries().map((entry) => entry.value ?? 'default'),
    () => variantEntries().find((entry) => entry.current)?.value ?? 'default',
  );

  const rows = (selector: string): HTMLButtonElement[] => [
    ...(panel?.querySelectorAll<HTMLButtonElement>(`${selector} button.model-option`) ?? []),
  ];

  const announce = (text: string): void => {
    flip = !flip;
    setAnnouncement(flip ? text : `${text}${NO_BREAK_SPACE}`);
  };

  /** Closes the panel; `restoreFocus` puts the focus back on the chip. */
  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    setSearch('');
    agentStop.reset();
    modelStop.reset();
    variantStop.reset();
    if (restoreFocus) chip?.focus();
  };

  const pickAgent = (choice: AgentChoice): void => {
    // The unavailable agent is already the one in use: picking it again changes nothing.
    if (!choice.unavailable) props.onSelectAgent(choice.id);
    close(true);
  };

  const pickModelOption = (option: { providerID: string; id: string }): void => {
    props.onSelectModel(pickModel(props.model, option));
    close(true);
  };

  const pickVariant = (entry: VariantEntry): void => {
    // The missing variant is already the one in use: picking it again changes nothing.
    if (!entry.missing) props.onSelectVariant(entry.value);
    close(true);
  };

  /** Arrows, Home and End inside the list the focused row belongs to (no wrapping). */
  const onListKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains('model-option')) {
      return;
    }
    const group = target.closest<HTMLElement>('[data-group]');
    if (group === null) return;
    const name = group.dataset['group'] ?? '';
    const buttons = rows(
      name === 'model' ? '[data-group="model"] .model-groups' : `[data-group="${name}"]`,
    );
    const index = buttons.indexOf(target);
    const go = (next: number): void => {
      if (next < 0 && group.dataset['group'] === 'model') searchInput?.focus();
      else buttons[Math.min(Math.max(next, 0), buttons.length - 1)]?.focus();
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(buttons.length - 1);
    else return;
    event.preventDefault();
  };

  const onSearchKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const list = rows('[data-group="model"] .model-groups');
      (list.find((button) => button.tabIndex === 0) ?? list[0])?.focus();
    } else if (event.key === 'Enter') {
      // The box lives inside the prompt's <form>: Enter must not send the prompt. It picks the
      // first match instead.
      event.preventDefault();
      const first = groups()[0]?.models[0];
      if (first !== undefined) pickModelOption(first);
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation(); // the prompt box stops the turn on Escape while busy
    close(true);
  };

  props.onCloseReady?.(() => {
    close(false);
  });

  // The window losing the focus (a shortcut of issue #35 that sends it to the editor, a click in the
  // workbench) fires `blur` on the window and no `focusout` with a target, which the panel's handler
  // ignores on purpose: a panel left open there is an orphan. Same rule as the "+" menu.
  const onWindowBlur = (): void => {
    if (open()) close(false);
  };
  onMount(() => {
    window.addEventListener('blur', onWindowBlur);
  });
  onCleanup(() => {
    window.removeEventListener('blur', onWindowBlur);
  });

  dismissOutside(
    () => panel,
    TRIGGER_SELECTOR,
    () => {
      close(false);
    },
  );

  // The count is announced while the panel is open, on every change of the result.
  createEffect(
    on(
      () => [open(), total(), search()] as const,
      ([isOpen, count]) => {
        if (!isOpen) return;
        announce(
          count === 0 ? 'No models match' : `${String(count)} model${count === 1 ? '' : 's'}`,
        );
      },
    ),
  );

  // A panel left open when the connection drops (or the catalog goes) closes. The focus goes back to
  // the chip only if it sat inside the panel, which is about to be unmounted.
  createEffect(() => {
    if (unusable()) close(panel?.contains(document.activeElement) === true);
  });

  return (
    <>
      <button
        type="button"
        class="secondary agent-model-chip"
        data-chip
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={PANEL_ID}
        aria-disabled={unusable() ? 'true' : undefined}
        aria-label={chipName()}
        title={chipName()}
        ref={(element) => {
          chip = element;
        }}
        onClick={() => {
          // `aria-disabled`, not `disabled` (see the header): the click is simply ignored.
          if (unusable()) return;
          if (open()) {
            close(false);
            return;
          }
          // Solid renders the panel synchronously here, so its rows already exist.
          setOpen(true);
          const start = rows('[data-group="agent"]').find((b) => b.tabIndex === 0);
          (start ?? searchInput)?.focus();
        }}
      >
        <span class="conn-dot" data-state={props.connection} aria-hidden="true" />
        <span class="chip-text">{label()}</span>
        <ChevronIcon />
      </button>
      <Show when={open()}>
        <div
          id={PANEL_ID}
          class="model-panel agent-model-panel"
          role="dialog"
          aria-label="Choose agent and model"
          ref={(element) => {
            panel = element;
          }}
          onKeyDown={onPanelKeyDown}
          onFocusOut={(event) => {
            // Focus moving to another element of the page closes the panel (a shortcut of #35 can
            // take it). A null target (the window lost focus, or a click on dead space) does not.
            const next = event.relatedTarget;
            if (next instanceof Node && !event.currentTarget.contains(next) && next !== chip) {
              close(false);
            }
          }}
        >
          <div class="menu-columns" onKeyDown={onListKeyDown}>
            <section class="menu-column" data-group="agent" aria-label="Agent">
              <h3 class="session-group-title">Agent</h3>
              <ul class="model-list">
                <For each={agents()}>
                  {(choice) => (
                    <li>
                      <button
                        type="button"
                        class="model-option"
                        data-agent={choice.id}
                        tabindex={agentStop.tabbable() === choice.id ? 0 : -1}
                        aria-current={choice.current ? 'true' : undefined}
                        aria-disabled={choice.unavailable ? 'true' : undefined}
                        onFocus={() => {
                          agentStop.focused(choice.id);
                        }}
                        onClick={() => {
                          pickAgent(choice);
                        }}
                      >
                        <span class="model-name">{choice.name}</span>
                        <Show when={agentMeta(choice) !== ''}>
                          <span class="model-meta">{agentMeta(choice)}</span>
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </section>
            <section class="menu-column" data-group="model" aria-label="Model">
              <h3 class="session-group-title">Model</h3>
              <input
                type="search"
                class="session-search"
                aria-label="Search models"
                placeholder="Search models"
                ref={(element) => {
                  searchInput = element;
                }}
                onInput={(event) => {
                  setSearch(event.currentTarget.value);
                }}
                onKeyDown={onSearchKeyDown}
              />
              <div class="visually-hidden" role="status" aria-live="polite">
                {announcement()}
              </div>
              <Show when={total() === 0}>
                <p class="session-status">No models match</p>
              </Show>
              <div class="model-groups">
                <Show when={missingModel()}>
                  {(missing) => (
                    <ul class="model-list">
                      <li>
                        <button
                          type="button"
                          class="model-option"
                          data-model-unavailable
                          tabindex={modelStop.tabbable() === keyOf(missing()) ? 0 : -1}
                          aria-current="true"
                          aria-disabled="true"
                          onFocus={() => {
                            modelStop.focused(keyOf(missing()));
                          }}
                          onClick={() => {
                            close(true);
                          }}
                        >
                          <span class="model-name">{`${missing().providerID}/${missing().id} (unavailable)`}</span>
                          <span class="model-meta">Current</span>
                        </button>
                      </li>
                    </ul>
                  )}
                </Show>
                <For each={groups()}>
                  {(group) => (
                    <section class="model-group" aria-label={group.provider.name}>
                      <h3 class="session-group-title">{group.provider.name}</h3>
                      <ul class="model-list">
                        <For each={group.models}>
                          {(model: ModelOption) => {
                            const isCurrent = () =>
                              props.model !== undefined &&
                              sameModel(
                                { providerID: model.providerID, id: model.id },
                                { ...props.model.ref, variant: undefined },
                              );
                            return (
                              <li>
                                <button
                                  type="button"
                                  class="model-option"
                                  data-model={`${model.providerID}/${model.id}`}
                                  tabindex={modelStop.tabbable() === keyOf(model) ? 0 : -1}
                                  aria-current={isCurrent() ? 'true' : undefined}
                                  onFocus={() => {
                                    modelStop.focused(keyOf(model));
                                  }}
                                  onClick={() => {
                                    pickModelOption(model);
                                  }}
                                >
                                  <span class="model-name">{model.name}</span>
                                  <span class="model-meta">
                                    {isCurrent()
                                      ? `Current · ${modelMeta(model)}`
                                      : modelMeta(model)}
                                  </span>
                                </button>
                              </li>
                            );
                          }}
                        </For>
                      </ul>
                    </section>
                  )}
                </For>
              </div>
              <Show when={props.variants.visible}>
                <section class="menu-reasoning" data-group="variant" aria-label="Reasoning">
                  <h3 class="session-group-title">Reasoning</h3>
                  <ul class="model-list">
                    <For each={variantEntries()}>
                      {(entry) => (
                        <li>
                          <button
                            type="button"
                            class="model-option"
                            data-variant={entry.value ?? 'default'}
                            tabindex={
                              variantStop.tabbable() === (entry.value ?? 'default') ? 0 : -1
                            }
                            aria-current={entry.current ? 'true' : undefined}
                            aria-disabled={entry.missing ? 'true' : undefined}
                            onFocus={() => {
                              variantStop.focused(entry.value ?? 'default');
                            }}
                            onClick={() => {
                              pickVariant(entry);
                            }}
                          >
                            <span class="model-name">{entry.label}</span>
                            <Show when={entry.current}>
                              <span class="model-meta">Current</span>
                            </Show>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              </Show>
            </section>
          </div>
        </div>
      </Show>
    </>
  );
}
