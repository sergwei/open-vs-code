import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { dismissOutside } from './dismissOutside';
import type { VariantChoices } from './selection';

/** `id` of the panel, referenced by the `aria-controls` of the trigger. */
const PANEL_ID = 'variant-panel';

/** Marks the trigger so a pointer-down on it is not read as "outside" (see `dismissOutside`). */
const TRIGGER_SELECTOR = '[data-variant-trigger]';

/** One row of the panel: "Default" (no value), a variant of the catalog, or the missing one. */
type Entry = { value: string | undefined; label: string; current: boolean; missing: boolean };

/**
 * The reasoning-variant control of the prompt row (issue #61): a button, right after the model
 * button, that shows the level the next prompt will use ("Reasoning: Default", "Reasoning: low")
 * and opens a panel with "Default" and the variants the effective model lists.
 *
 * It renders NOTHING when `choices.visible` is false (a model without variants and no variant to
 * show). The panel is the same pattern as the model panel and "More agents": a non-modal
 * `role="dialog"` that opens UPWARDS over the row (the `model-panel` CSS), a list of buttons with
 * the current one marked by `aria-current="true"` and the word "Current" (not only a colour), the
 * focus moving to the current entry on open, ArrowUp/Down/Home/End between entries (roving
 * tabindex: one tab stop), Enter or a click picks, closes and returns the focus to the trigger,
 * Escape does the same without picking, and a pointer-down outside closes it without moving the
 * focus (`dismissOutside`). A native `<select>` was rejected (decision of Sergio, 22/10/2026,
 * Engram #1021): its drop-down is not DOM, so CDP captures miss it, and `aria-disabled` cannot stop
 * it from changing. A variant that is set but not listed (set from the TUI, or retired from the
 * catalog) shows as "<id> (unavailable)" and as a current entry that cannot be picked again, so the
 * user sees why the host would refuse the send until another level is chosen.
 * The trigger text contains its accessible name (WCAG 2.5.3, no `aria-label` needed) and uses
 * `aria-disabled`, not `disabled`: it can hold the focus when the connection drops. Picking calls
 * `onSelect` with the id, or `undefined` for Default; it never talks to the host.
 * A panel closed because the connection dropped returns the focus to the trigger only if the focus
 * was inside the panel; otherwise the focus is left where it was. VERIFIED by
 * `VariantPicker.test.tsx` in jsdom (focus checked with `document.activeElement`). When the control
 * goes away (`choices.visible` turns false) the trigger is unmounted together with the panel, so
 * there is no trigger to go back to and the focus falls to the body. VERIFIED by the review-2 probe
 * (22/10/2026, jsdom, test injected in memory: open, focus inside the panel, `visible: false` gave
 * `trigger === null` and `document.activeElement === BODY`). Not pinned by a committed test.
 * VERIFIED on Windows 11, VS Code 1.143.0, on 22/10/2026 ~09:56 by `npm run test:visual` step 14
 * on the final tree (real mouse, four themes, focus ring; the check "the reopened session shows
 * the variant the SERVER stored ("Reasoning: low")" passed, and the run is recorded in the header
 * of `test/visual/run.mjs`). NOT observed: screen readers, macOS
 * and Linux (UNVERIFIED).
 */
export function VariantPicker(props: {
  choices: VariantChoices;
  /** True with no connection or no catalog: the trigger stays focusable but does nothing. */
  disabled: boolean;
  onSelect(variant: string | undefined): void;
}) {
  const [open, setOpen] = createSignal(false);
  let panel: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;

  const entries = createMemo<Entry[]>(() => {
    const { options, current, missing } = props.choices;
    const list: Entry[] = [
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
  const currentLabel = () => entries().find((entry) => entry.current)?.label ?? 'Default';
  const tabbable = () => entries().findIndex((entry) => entry.current);

  const buttons = (): HTMLButtonElement[] => [
    ...(panel?.querySelectorAll<HTMLButtonElement>('button.model-option') ?? []),
  ];

  /** Closes the panel; `restoreFocus` puts the focus back on the trigger. */
  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) trigger?.focus();
  };

  const pick = (entry: Entry): void => {
    // The missing variant is already the one in use: picking it again changes nothing.
    if (!entry.missing) props.onSelect(entry.value);
    close(true);
  };

  const onListKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const list = buttons();
    const index = list.indexOf(target);
    if (event.key === 'ArrowDown') list[Math.min(index + 1, list.length - 1)]?.focus();
    else if (event.key === 'ArrowUp') list[Math.max(index - 1, 0)]?.focus();
    else if (event.key === 'Home') list[0]?.focus();
    else if (event.key === 'End') list[list.length - 1]?.focus();
    else return;
    event.preventDefault();
  };

  dismissOutside(
    () => panel,
    TRIGGER_SELECTOR,
    () => {
      close(false);
    },
  );

  // A panel left open when the connection drops, or when the control disappears, closes. On a
  // disconnect the focus sits on a panel entry (it moves there on open) that is about to be
  // unmounted, so it goes back to the trigger, which stays mounted. When the control disappears the
  // trigger is unmounted with it, the detached trigger cannot take the focus and the focus falls to
  // the body.
  createEffect(() => {
    if (props.disabled || !props.choices.visible) {
      close(panel?.contains(document.activeElement) === true);
    }
  });

  return (
    <Show when={props.choices.visible}>
      <button
        type="button"
        class="secondary variant-trigger"
        data-variant-trigger
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={PANEL_ID}
        aria-disabled={props.disabled ? 'true' : undefined}
        ref={(element) => {
          trigger = element;
        }}
        onClick={() => {
          // `aria-disabled`, not `disabled` (see the header): the click is simply ignored.
          if (props.disabled) return;
          setOpen(!open());
        }}
      >
        {`Reasoning: ${currentLabel()}`}
      </button>
      <Show when={open()}>
        <div
          id={PANEL_ID}
          class="model-panel variant-panel"
          role="dialog"
          aria-label="Choose a reasoning level"
          ref={(element) => {
            panel = element;
            queueMicrotask(() => {
              buttons()[Math.max(tabbable(), 0)]?.focus();
            });
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation(); // the prompt box stops the turn on Escape while busy
            close(true);
          }}
        >
          <ul class="model-list" onKeyDown={onListKeyDown}>
            <For each={entries()}>
              {(entry, index) => (
                <li>
                  <button
                    type="button"
                    class="model-option"
                    data-variant={entry.value ?? 'default'}
                    tabindex={index() === tabbable() ? 0 : -1}
                    aria-current={entry.current ? 'true' : undefined}
                    onClick={() => {
                      pick(entry);
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
        </div>
      </Show>
    </Show>
  );
}
