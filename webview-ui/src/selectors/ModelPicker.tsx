import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import type { Catalog, ModelOption, ModelRef } from '../../../src/shared/model';
import { dismissOutside } from './dismissOutside';
import { groupModels, modelLabel, modelMeta, sameModel, type EffectiveModel } from './selection';

/** Built from its code point: a literal one in the source trips `no-irregular-whitespace`. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** `id` of the panel, referenced by the `aria-controls` of the trigger. */
const PANEL_ID = 'model-panel';

/** Marks the trigger so a pointer-down on it is not read as "outside" (see `dismissOutside`). */
const TRIGGER_SELECTOR = '[data-model-trigger]';

/** Key of an option in the roving tab stop: provider and catalog id never contain a newline. */
const keyOf = (model: { providerID: string; id: string }): string =>
  `${model.providerID}\n${model.id}`;

/**
 * The model selector of the prompt row (issue #23): a button that shows the model the next prompt
 * will use and opens a panel with a search box and the catalog grouped by provider.
 *
 * The panel is a `role="dialog"` that is NOT modal and opens UPWARDS over the row (CSS), because the
 * row sits at the bottom of the view. Opening puts the focus in the search box; typing filters the
 * models at once (the list is local, so no debounce). Keyboard: ArrowDown from the box enters the
 * list, ArrowUp/Down/Home/End move between models (roving tabindex: one tab stop), ArrowUp from the
 * first goes back to the box; Enter on the box picks the first match; Enter or a click on a model
 * picks it, closes the panel and returns the focus to the trigger; Escape does the same without
 * picking; a pointer-down outside closes it without moving the focus. Every model is a button with
 * its name and a one-string detail ("Free · 200K context · beta"); the current one carries
 * `aria-current="true"` and the word "Current" in its detail, so the state is not only a colour.
 * A polite live region announces the count ("3 models", "No models match"), alternating a
 * no-break space so a repeat is read again (lesson #918). The trigger is named "Model: <label>"
 * (its visible text is inside the name: WCAG 2.5.3) and uses `aria-disabled`, not `disabled`: it
 * can hold the focus when the connection drops, and a disabled button throws the focus onto the
 * page. Picking does NOT talk to the host: the choice is a draft the prompt carries (decision of
 * 21/10/2026, Engram #1012).
 * VERIFIED by `ModelPicker.test.tsx` in jsdom (focus checked with `document.activeElement`); the
 * look, the upward panel in a narrow side bar and the focus ring are checked by `npm run test:visual`
 * step 11 on Windows; screen readers UNVERIFIED. HYPOTHESIS (review #1015 S2): the "N models" live
 * region lives inside the conditionally rendered panel, so a screen reader may not announce its
 * first text (a region inserted already filled); check with NVDA/VoiceOver, and if it stays silent
 * render the region outside the `Show`. The panel is cut by a very short view
 * (`max-height` + inner scroll): only seen on Windows.
 */
export function ModelPicker(props: {
  catalog: Catalog | undefined;
  effective: EffectiveModel | undefined;
  /** True when there is no connection: the trigger stays focusable but does nothing. */
  disabled: boolean;
  onSelect(model: ModelRef): void;
}) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [announcement, setAnnouncement] = createSignal('');
  const [activeKey, setActiveKey] = createSignal<string | undefined>();
  let panel: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  let flip = false;

  const unusable = () => props.disabled || props.catalog === undefined;
  const groups = createMemo(() => groupModels(props.catalog, search()));
  const total = createMemo(() => groups().reduce((sum, group) => sum + group.models.length, 0));
  const currentKey = () => (props.effective === undefined ? undefined : keyOf(props.effective.ref));

  /** The option that is the tab stop: the last focused, else the current model, else the first. */
  const tabbableKey = createMemo(() => {
    const keys = groups().flatMap((group) => group.models.map(keyOf));
    const wanted = activeKey();
    if (wanted !== undefined && keys.includes(wanted)) return wanted;
    const current = currentKey();
    if (current !== undefined && keys.includes(current)) return current;
    return keys[0];
  });

  /** The text of the trigger: the model's name, plus why it is not an ordinary pick. */
  const label = createMemo(() => {
    const effective = props.effective;
    if (effective === undefined) return 'Model';
    let text = modelLabel(effective.ref, effective.option);
    if (effective.ref.variant !== undefined) text = `${text} · ${effective.ref.variant}`;
    if (effective.option === undefined) return `${text} (unavailable)`;
    if (effective.source === 'default') return `${text} (default)`;
    return text;
  });

  const options = (): HTMLButtonElement[] => [
    ...(panel?.querySelectorAll<HTMLButtonElement>('button.model-option') ?? []),
  ];

  const announce = (text: string): void => {
    flip = !flip;
    setAnnouncement(flip ? text : `${text}${NO_BREAK_SPACE}`);
  };

  /** Closes the panel; `restoreFocus` puts the focus back on the trigger. */
  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    setSearch('');
    if (restoreFocus) trigger?.focus();
  };

  const pick = (option: ModelOption): void => {
    props.onSelect({ providerID: option.providerID, id: option.id });
    close(true);
  };

  const focusOption = (index: number): void => {
    const buttons = options();
    if (index < 0) {
      searchInput?.focus();
      return;
    }
    buttons[Math.min(index, buttons.length - 1)]?.focus();
  };

  const onListKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains('model-option')) {
      return;
    }
    const buttons = options();
    const index = buttons.indexOf(target);
    if (event.key === 'ArrowDown') focusOption(index + 1);
    else if (event.key === 'ArrowUp') focusOption(index - 1);
    else if (event.key === 'Home') focusOption(0);
    else if (event.key === 'End') focusOption(buttons.length - 1);
    else return;
    event.preventDefault();
  };

  const onSearchKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const stop = options().find((button) => button.tabIndex === 0);
      (stop ?? options()[0])?.focus();
    } else if (event.key === 'Enter') {
      // The box lives inside the prompt's <form>: Enter must not send the prompt. It picks the
      // first match instead.
      event.preventDefault();
      const first = groups()[0]?.models[0];
      if (first !== undefined) pick(first);
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation(); // the prompt box stops the turn on Escape while busy
    close(true);
  };

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

  // A panel left open when the connection drops (or the catalog goes) closes.
  createEffect(() => {
    if (unusable()) close(false);
  });

  return (
    <>
      <button
        type="button"
        class="secondary model-trigger"
        data-model-trigger
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={PANEL_ID}
        aria-disabled={unusable() ? 'true' : undefined}
        aria-label={`Model: ${label()}`}
        ref={(element) => {
          trigger = element;
        }}
        onClick={() => {
          // `aria-disabled`, not `disabled` (see the header): the click is simply ignored.
          if (unusable()) return;
          if (open()) {
            close(false);
            return;
          }
          // Solid renders the panel synchronously here, so the box already exists.
          setOpen(true);
          searchInput?.focus();
        }}
      >
        {label()}
      </button>
      <Show when={open()}>
        <div
          id={PANEL_ID}
          class="model-panel"
          role="dialog"
          aria-label="Choose a model"
          ref={(element) => {
            panel = element;
          }}
          onKeyDown={onPanelKeyDown}
        >
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
          <div class="model-groups" onKeyDown={onListKeyDown}>
            <For each={groups()}>
              {(group) => (
                <section class="model-group" aria-label={group.provider.name}>
                  <h3 class="session-group-title">{group.provider.name}</h3>
                  <ul class="model-list">
                    <For each={group.models}>
                      {(model) => {
                        const isCurrent = () =>
                          props.effective !== undefined &&
                          sameModel(
                            { providerID: model.providerID, id: model.id },
                            { ...props.effective.ref, variant: undefined },
                          );
                        return (
                          <li>
                            <button
                              type="button"
                              class="model-option"
                              data-model={`${model.providerID}/${model.id}`}
                              tabindex={tabbableKey() === keyOf(model) ? 0 : -1}
                              aria-current={isCurrent() ? 'true' : undefined}
                              onFocus={() => {
                                setActiveKey(keyOf(model));
                              }}
                              onClick={() => {
                                pick(model);
                              }}
                            >
                              <span class="model-name">{model.name}</span>
                              <span class="model-meta">
                                {isCurrent() ? `Current · ${modelMeta(model)}` : modelMeta(model)}
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
        </div>
      </Show>
    </>
  );
}
