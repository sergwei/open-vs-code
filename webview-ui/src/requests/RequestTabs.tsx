import * as l10n from '@vscode/l10n';
import { createEffect, createMemo, For, on, Show } from 'solid-js';
import { QuestionIcon, ShieldIcon } from '../chat/icons';
import { tabKeyTarget } from './activeTab';

/** One tab of the request dock: the request it stands for and the words that name it. */
export interface RequestTabEntry {
  id: string;
  kind: 'permission' | 'form';
  /** Visible text: "Permission", "Question" or "Form". */
  label: string;
  /** Tooltip: what the request is about, plus the session it comes from when it is not the open one. */
  detail: string;
}

/**
 * The row of tabs above the active request of the dock (plan `E3-request-tabs`): one tab per
 * pending request (icon and label, the active one underlined) and the "N of M" counter on the right.
 * Purely presentational: the dock owns which tab is active and the panels the tabs control.
 *
 * Why it looks like this:
 * - The labels are always whole, never cut with an ellipsis (decision of Sergio, 07/11/2026): when
 *   the tabs do not fit, ONLY the tab list scrolls horizontally, and the counter sits outside that
 *   scroller so it is never pushed out of the box. Activating a tab scrolls it into view
 *   (VERIFIED by keyboard only, R8; HYPOTHESIS when a request arrives or `ui.focus` activates it: see below).
 * - Arrows (with wrap-around), Home and End move the focus AND activate (the panels all exist, the
 *   inactive ones only `hidden`, so activation is free); Escape hands the focus back to the prompt,
 *   like the cards do, and never rejects anything. The tabs only select: they cannot approve.
 * - The tabs carry `data-request-tab`, not `data-request-id`, which the cards own (`cardOf`, the
 *   dock's focus tracking and the tests look it up).
 * - The counter is `aria-hidden`: the tab list already gives the position. HYPOTHESIS: there was no
 *   screen reader to confirm that "tab 2 of 3" is announced; check with one.
 * VERIFIED by `RequestDock.test.tsx` in jsdom (roles, `aria-selected`, roving tabindex, keys).
 * VERIFIED in a real VS Code 1.145.2 (Windows 11, `--steps 43` of 07/11/2026), which jsdom cannot lay out:
 * "R8 at 300 px, End on the keyboard makes the last tab visible by itself: the list scrolls (true),
 * the last tab was outside it after Home (true) and inside it after End (true)" (by KEYBOARD only:
 * there `focus()` also scrolls natively in Chromium, so this check does not isolate the effect
 * below);
 * "M3 at compact (bar 170 px), dark: every label is whole (Permission [by scrolling], Permission
 * [by scrolling], Question [by scrolling]), none cut with an ellipsis, and every tab is visible or
 * reachable by scrolling its list", "M2 at compact (bar 170 px), dark: the counter "3 of 3" is whole
 * and inside the box" and "M4 at 300 (bar 300 px), dark: contrast >= 4.5 for the active label
 * 10.15, an inactive one 10.15 and the counter 6.01"; the keys by "R4 End goes to the last tab" and
 * "R4 Escape on the tab row puts the focus back in the prompt box".
 */
export function RequestTabs(props: {
  entries: readonly RequestTabEntry[];
  activeId: string | undefined;
  /** Prefix of the element ids, so `aria-controls` / `aria-labelledby` pair with the dock's panels. */
  idBase: string;
  onSelect(id: string): void;
  /** Escape was pressed on the tab list: the dock moves the focus to the prompt. */
  onEscape(): void;
}) {
  let list: HTMLDivElement | undefined;
  const entryIds = createMemo(() => props.entries.map((entry) => entry.id));

  /** The tab button of request `id`. */
  const tabOf = (id: string): HTMLElement | undefined =>
    [...(list?.querySelectorAll<HTMLElement>('[data-request-tab]') ?? [])].find(
      (element) => element.dataset['requestTab'] === id,
    );

  // Whoever activates a tab, the active tab is brought into view: the list may be scrolled, with
  // labels that are never shortened. By keyboard this is VERIFIED (R8, above; `focus()` scrolls
  // too). HYPOTHESIS: a tab activated by the arrival of a request or by `ui.focus`, which
  // is not focused, ends up in view thanks to this effect alone; it would be checked in R3 at 300
  // px, with the just-arrived tab inside the list rectangle without touching the keyboard.
  createEffect(
    on(
      () => props.activeId,
      (id) => {
        if (id !== undefined) tabOf(id)?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
      },
    ),
  );

  /** Activates tab `id` and moves the focus to it (outside any effect: the DOM is already current). */
  const select = (id: string): void => {
    props.onSelect(id);
    tabOf(id)?.focus();
  };

  return (
    <div class="request-tabs-row">
      <div
        class="request-tabs"
        role="tablist"
        aria-label={l10n.t('Pending requests')}
        ref={(element) => {
          list = element;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onEscape();
            return;
          }
          const from = (event.target as HTMLElement).closest<HTMLElement>('[data-request-tab]');
          const index = props.entries.findIndex(
            (entry) => entry.id === from?.dataset['requestTab'],
          );
          if (index < 0) return;
          const target = tabKeyTarget(event.key, index, props.entries.length);
          const next = target === undefined ? undefined : props.entries[target];
          if (next === undefined) return;
          event.preventDefault();
          select(next.id);
        }}
      >
        {/* Keyed by the id string, not by the entry object: the dock builds new entry objects
            whenever any request changes, and keying by them would recreate every button (the
            focused tab and the scroll of the list included). */}
        <For each={entryIds()}>
          {(id) => {
            const entry = createMemo(() => props.entries.find((candidate) => candidate.id === id));
            return (
              <button
                type="button"
                role="tab"
                class="request-tab"
                id={`${props.idBase}-tab-${id}`}
                aria-controls={`${props.idBase}-panel-${id}`}
                aria-selected={props.activeId === id}
                tabindex={props.activeId === id ? 0 : -1}
                data-request-tab={id}
                title={entry()?.detail}
                onClick={() => {
                  select(id);
                }}
              >
                <Show when={entry()?.kind === 'permission'} fallback={<QuestionIcon />}>
                  <ShieldIcon />
                </Show>
                <span class="request-tab-label">{entry()?.label}</span>
              </button>
            );
          }}
        </For>
      </div>
      <span class="request-counter" aria-hidden="true">
        {l10n.t(
          '{0} of {1}',
          props.entries.findIndex((entry) => entry.id === props.activeId) + 1,
          props.entries.length,
        )}
      </span>
    </div>
  );
}
