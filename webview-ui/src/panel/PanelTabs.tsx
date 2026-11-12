import * as l10n from '@vscode/l10n';
import { For, Show } from 'solid-js';
import { tabKeyTarget } from '../requests/activeTab';
import { PANEL_TABS, type PanelTab } from './panelTab';

/** The visible word of a tab, in the interface language (a function so it follows the locale). */
function tabLabel(tab: PanelTab): string {
  switch (tab) {
    case 'chat':
      return l10n.t('Chat');
    case 'changes':
      return l10n.t('Changes');
    case 'session':
      return l10n.t('Session');
  }
}

/** `id` of the tab button of `tab`; the panel it controls is {@link panelId}. */
export function tabId(tab: PanelTab): string {
  return `panel-tab-${tab}`;
}

/** `id` of the panel `tab` controls, for `aria-controls` / `aria-labelledby`. */
export function panelId(tab: PanelTab): string {
  return `panel-${tab}`;
}

/**
 * The row of tabs Chat · Changes · Session under the header (issue #188, phase 3). Presentational:
 * `App` owns which tab is active and the panels the tabs control.
 *
 * The accessible pattern is the WAI-ARIA tabs one, copied from `RequestTabs`: a `tablist` of
 * `role="tab"` buttons with `aria-selected`, `aria-controls` and a roving tabindex (only the active
 * tab is in the Tab order); Left/Right wrap around and Home/End jump to the ends (`tabKeyTarget`),
 * and every move also ACTIVATES the tab, because the panels all exist and a hidden one costs nothing
 * to show. Escape is not handled: unlike the request tabs, nothing here is a pending decision.
 * The badges are words, not colour: "working" on Chat while a turn runs (`working`) and the number
 * of changed files on Changes when there is any (`changedCount`). They sit INSIDE the button, so the
 * tab's accessible name reads "Chat working" / "Changes 3".
 * VERIFIED in jsdom by `PanelTabs.test.tsx` (roles, `aria-selected`, roving tabindex, keys, badges).
 * VERIFIED in a real VS Code (Windows 11, VS Code 1.146.0, 12/11/2026) by `test:visual` step 54:
 * "T1 ArrowRight selects and focuses panel-tab-changes and no other tab is selected" (and End,
 * ArrowLeft, Home, the wrap), "T1 after Home only Chat is in the Tab order" and "T4 the Chat tab
 * shows the "working" badge during the turn"; and by step 55: "W1 at 300 px the tabs, the chip, the
 * footer and the buttons fit the document with no style attribute", "C2/C3 chat in dark the
 * tabActive text has contrast >= 4.5" (and the same for tabInactive and the badge in the four
 * themes) and "S1 the Changes tab shows 4 files and its badge says 4". NOT observed: macOS, Linux.
 */
export function PanelTabs(props: {
  active: PanelTab;
  onSelect(tab: PanelTab): void;
  /** A turn is running: Chat shows the "working" badge. */
  working: boolean;
  /** Files the open session changed; the badge shows only a positive number. */
  changedCount: number;
}) {
  const buttons = new Map<PanelTab, HTMLButtonElement>();

  /** Activates `tab` and moves the focus to its button (outside any effect: the DOM is current). */
  const select = (tab: PanelTab): void => {
    props.onSelect(tab);
    buttons.get(tab)?.focus();
  };

  return (
    <div
      class="panel-tabs"
      role="tablist"
      aria-label={l10n.t('Chat panel')}
      onKeyDown={(event) => {
        const from = (event.target as HTMLElement).closest<HTMLElement>('[data-panel-tab]');
        const index = PANEL_TABS.findIndex((tab) => tab === from?.dataset['panelTab']);
        if (index < 0) return;
        const target = tabKeyTarget(event.key, index, PANEL_TABS.length);
        const next = target === undefined ? undefined : PANEL_TABS[target];
        if (next === undefined) return;
        event.preventDefault();
        select(next);
      }}
    >
      <For each={PANEL_TABS}>
        {(tab) => (
          <button
            type="button"
            role="tab"
            class="panel-tab"
            id={tabId(tab)}
            aria-controls={panelId(tab)}
            aria-selected={props.active === tab}
            tabindex={props.active === tab ? 0 : -1}
            data-panel-tab={tab}
            ref={(element) => {
              buttons.set(tab, element);
            }}
            onClick={() => {
              select(tab);
            }}
          >
            <span class="panel-tab-label">{tabLabel(tab)}</span>
            <Show when={tab === 'chat' && props.working}>
              <span class="panel-tab-badge" data-badge="working">
                {l10n.t('working')}
              </span>
            </Show>
            <Show when={tab === 'changes' && props.changedCount > 0}>
              <span class="panel-tab-badge" data-badge="count">
                {props.changedCount}
              </span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
