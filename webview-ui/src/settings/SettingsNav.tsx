import * as l10n from '@vscode/l10n';
import { For, Show } from 'solid-js';
import { plural } from '../../../src/shared/l10n';
import { sectionLabels } from './settingsSearch';
import { SETTINGS_SECTIONS, type SettingsSection } from './settingsUiState';

/** The number next to one section: how many, in which tone, and the words a screen reader says. */
export interface NavBadge {
  count: number;
  tone: 'neutral' | 'warning';
  spoken: string;
}

/**
 * The badges of the navigation (issue #186): Providers shows how many are connected (neutral) and
 * MCP servers how many need attention (warning); both only when above zero. `connected` is
 * `undefined` until the providers were read, so no "0" is invented while loading. PR3 adds Mods
 * with `activeMods`, the number of mods in the state `active` (the same "N active" as the button
 * of the chat), neutral and only above zero; it is `undefined`/absent when the host sent no mods.
 * VERIFIED by "puts a number in the navigation: connected providers, MCP servers needing
 * attention and active mods" of `SettingsApp.test.tsx` (fabricated state, spoken text included).
 */
export function navBadges(input: {
  connected: number | undefined;
  mcpAttention: number;
  activeMods?: number;
}): Partial<Record<SettingsSection, NavBadge>> {
  const badges: Partial<Record<SettingsSection, NavBadge>> = {};
  if (input.activeMods !== undefined && input.activeMods > 0) {
    badges.mods = {
      count: input.activeMods,
      tone: 'neutral',
      spoken: plural(
        input.activeMods,
        l10n.t('{0} mod active', input.activeMods),
        l10n.t('{0} mods active', input.activeMods),
      ),
    };
  }
  if (input.connected !== undefined && input.connected > 0) {
    badges.providers = {
      count: input.connected,
      tone: 'neutral',
      spoken: plural(
        input.connected,
        l10n.t('{0} provider connected', input.connected),
        l10n.t('{0} providers connected', input.connected),
      ),
    };
  }
  if (input.mcpAttention > 0) {
    badges.mcp = {
      count: input.mcpAttention,
      tone: 'warning',
      spoken: plural(
        input.mcpAttention,
        l10n.t('{0} needs attention', input.mcpAttention),
        l10n.t('{0} need attention', input.mcpAttention),
      ),
    };
  }
  return badges;
}

/**
 * The navigation between the seven sections (issue #186): a `role="tablist"` whose tabs control
 * the panels of `SettingsApp`, vertical beside the content and a horizontal strip when the tab is
 * narrow (`horizontal` is what `aria-orientation` says; CSS lays it out).
 *
 * Roving tabindex: only the selected tab is in the Tab order. Because the layout changes with the
 * width and a screen reader's expectation with it, ArrowUp and ArrowDown, ArrowLeft and ArrowRight
 * all work in BOTH layouts (previous or next, wrapping), and Home and End go to the ends; every
 * move also selects (the panels are cheap) and takes the focus. VERIFIED in jsdom by
 * `SettingsApp.test.tsx` with a fabricated state: "moves and activates with the arrows of both axes,
 * wrapping, Home and End, taking the focus" (roving tabindex included), "puts a number in the
 * navigation: connected providers, and MCP servers needing attention" (the spoken text included) and
 * "says vertical or horizontal by the width of the tab" (a stubbed ResizeObserver). VERIFIED in a
 * real VS Code 1.145.2 on Windows 11 (the full `npm run test:visual` of 08/11/2026 on the final
 * tree, "all visual checks passed", step
 * "46 OpenCode Settings: header, navigation and search (E10-settings-redesign)"): "ok
 * H2 1080 px (root 1046), dark: the navigation is vertical (a column beside the content), seven
 * sections, numbers Providers 2 and MCP 2 …", "ok   H2 300 px (root 250), dark: the navigation is
 * horizontal (a strip that scrolls, above the content, the open tab inside it) …" (four widths, four
 * themes) and "ok   H2 300 px: the open tab takes the keyboard focus and draws an outline
 * ({"active":true,"outline":"solid 0.8px","focusVisible":true})" (dark only). NOT observed: the strip
 * scrolled by the mouse wheel, the outline in the other three themes.
 */
export function SettingsNav(props: {
  section: SettingsSection;
  horizontal: boolean;
  badges: Partial<Record<SettingsSection, NavBadge>>;
  onSelect(section: SettingsSection): void;
}) {
  const labels = sectionLabels();
  const elements: Partial<Record<SettingsSection, HTMLButtonElement>> = {};

  const move = (event: KeyboardEvent): void => {
    const count = SETTINGS_SECTIONS.length;
    const index = SETTINGS_SECTIONS.indexOf(props.section);
    let next: number | undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % count;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      next = (index - 1 + count) % count;
    } else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    const target = next === undefined ? undefined : SETTINGS_SECTIONS[next];
    if (target === undefined) return;
    event.preventDefault();
    props.onSelect(target);
    elements[target]?.focus();
  };

  return (
    <div
      class="settings-nav"
      role="tablist"
      aria-label={l10n.t('Settings sections')}
      aria-orientation={props.horizontal ? 'horizontal' : 'vertical'}
      onKeyDown={move}
    >
      <For each={SETTINGS_SECTIONS}>
        {(section) => (
          <button
            type="button"
            role="tab"
            class="settings-tab"
            id={`settings-tab-${section}`}
            aria-selected={props.section === section}
            aria-controls={`settings-panel-${section}`}
            tabindex={props.section === section ? 0 : -1}
            ref={(element) => {
              elements[section] = element;
            }}
            onClick={() => {
              props.onSelect(section);
            }}
          >
            <span class="settings-tab-label">{labels[section]}</span>
            <Show when={props.badges[section]}>
              {(badge) => (
                <>
                  <span class="settings-badge" data-tone={badge().tone} aria-hidden="true">
                    {badge().count}
                  </span>
                  <span class="visually-hidden">{badge().spoken}</span>
                </>
              )}
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
