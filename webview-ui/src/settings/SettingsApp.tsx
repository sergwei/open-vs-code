import * as l10n from '@vscode/l10n';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { WarningIcon } from '../chat/icons';
import { attentionBySection, attentionItems, type AttentionItem } from './attention';
import { GeneralSection } from './GeneralSection';
import { AdvancedSection, ModsSection, WorkModeSection } from './LinkSections';
import { McpSection } from './McpSection';
import { ModelsSection } from './ModelsSection';
import type { SendSettings } from './ProviderCard';
import { ProvidersSection } from './ProvidersSection';
import { navBadges, SettingsNav } from './SettingsNav';
import { SettingsSearch } from './SearchBox';
import { buildSearchIndex, sectionLabels, type SearchEntry } from './settingsSearch';
import { noticeText, type SettingsStore } from './settingsStore';
import { SETTINGS_SECTIONS, type SettingsSection, type SettingsUi } from './settingsUiState';
import { StatusCards } from './StatusCards';

/** Built from its code point: a literal one in the source trips `no-irregular-whitespace`. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * Below this width of the tab (px) the navigation is a horizontal strip. Same number as the
 * `@container` rules of `index.css` (600 px, decision P4 of E10-settings-redesign); the script
 * needs it only for `aria-orientation`, the layout itself is CSS.
 */
const NARROW_PX = 600;

/** Where a jump wants the focus: the panel of `section`, and a row of it when `anchor` is given. */
interface FocusRequest {
  section: SettingsSection;
  anchor?: { attribute: string; value: string };
}

/**
 * The OpenCode Settings tab (issue #128, E10; redesigned by issue #186 as the "Fusion"): a header
 * (title, subtitle, the global search, Refresh and four status cards), under it the navigation
 * between seven sections and the panel of the one that is open, and a footer with "Show logs" and
 * "Extension settings".
 *
 * What it shows depends on the host's state: before the first `settings.state` it says "Loading";
 * while the server is not connected it shows a card with what happened (and Restart server when
 * that can help) instead of the search, the cards and the sections; connected, it shows everything.
 * The seven panels are all in the document (the inactive ones `hidden`), so Providers keeps its
 * open card and what is typed in it while another section is shown.
 *
 * Layout: the root is a size container. At 900 px and more the navigation is a side column and the
 * four cards are one row; from 600 to 899 px the side column is narrower and the cards are 2x2;
 * below 600 px the same navigation is a horizontal strip that scrolls and the cards lose their
 * secondary buttons; below 360 px the cards are four compact rows (decision P4). Only CSS changes
 * the layout; the script measures the width once (ResizeObserver) so `aria-orientation` says the
 * truth, and the arrow keys work in both axes whatever the layout.
 *
 * "Needs attention" (decision P5) comes from `attention.ts`: its items are listed in General, the
 * MCP card turns amber and the navigation shows the numbers. A jump (an attention item, a search
 * result, a card) opens the section, and for an item or result with a row it focuses that row (a
 * `[data-provider]` or `[data-server]` card); with no row it focuses the section heading. The
 * focus is requested through a signal and served by a second effect, so it runs after the DOM
 * shows the new section (`solid-webview` section 1). A card opens its section without moving the
 * focus. A search result for a provider that is NOT connected has no row, so the jump first expands
 * its card under "+ Add provider" (what picking it there does) and the focus lands on that card.
 * VERIFIED in jsdom by "focuses the card of a provider that is not connected when the search
 * jumps to it" of `SettingsApp.test.tsx`.
 *
 * Accessibility: the navigation is a `role="tablist"` with a roving tabindex; a hidden
 * `role="status"` region announces the host's one-shot notices ("Connected to X", "Sign-in
 * expired") in the order they arrived, and alternates a trailing no-break space so the same text
 * twice is announced twice (solid-webview section 7). The component moves the focus only after a
 * jump the user asked for. Colours and sizes are in `index.css` (`--vscode-*` only, no inline
 * style).
 *
 * VERIFIED in jsdom by `SettingsApp.test.tsx` with fabricated state: "opens on General the first
 * time, with the four header cards and the seven sections", "moves and activates with the arrows
 * of both axes, wrapping, Home and End, taking the focus", "jumps from an attention item to its
 * row and takes the focus there" and "announces notices of the same batch in order and again when
 * the text repeats". VERIFIED in a real VS Code 1.145.2 on Windows 11 (the full `npm run
 * test:visual` of 08/11/2026 on the final tree, "all visual checks passed", step
 * "46 OpenCode Settings: header, navigation and search (E10-settings-redesign)", synthetic server)
 * at four widths and in four themes: "ok
 * H1 300 px …, hc-light: the header has the title, the search and the four cards in 4 row(s)
 * (expected 4), every card text inside its card (true), no sideways overflow (0 px) …" and "ok   H2
 * 300 px (root 250), dark: the navigation is horizontal (a strip that scrolls, above the content,
 * the open tab inside it) …", which also proved `aria-orientation` follows the width through the
 * ResizeObserver of a real iframe. The first run of that cell FAILED ("direction column" at 520
 * and 300 px): in `index.css` the navigation rules came after the container queries that turn it
 * into a strip, and the later rule won; they now come before. NOT observed: the strip scrolling
 * with the mouse wheel, a screen reader, macOS, Linux.
 */
export function SettingsApp(props: { store: SettingsStore; send: SendSettings; ui: SettingsUi }) {
  const state = props.store.state;
  const labels = sectionLabels();
  const [announcement, setAnnouncement] = createSignal('');
  const [horizontal, setHorizontal] = createSignal(false);
  const [focusRequest, setFocusRequest] = createSignal<FocusRequest | undefined>(undefined);
  let flip = false;
  let root: HTMLDivElement | undefined;

  // Drain the queue of notices in order whenever it grows; the queue is emptied by the drain.
  createEffect(
    on(
      () => state.notices.length,
      (length) => {
        if (length === 0) return;
        const texts = props.store.drainNotices().map((notice) => {
          const row = state.providers.rows.find(
            (candidate) => candidate.id === notice.integrationID,
          );
          return noticeText(notice, row?.name ?? notice.integrationID);
        });
        flip = !flip;
        const text = texts.join(' ');
        setAnnouncement(flip ? text : `${text}${NO_BREAK_SPACE}`);
      },
    ),
  );

  // The width of the tab decides only `aria-orientation`; jsdom has no ResizeObserver.
  onMount(() => {
    if (root === undefined || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setHorizontal(width < NARROW_PX);
    });
    observer.observe(root);
    onCleanup(() => {
      observer.disconnect();
    });
  });

  // Serves a jump's focus request after the DOM shows the section it opened.
  createEffect(
    on(
      focusRequest,
      (request) => {
        if (request === undefined || root === undefined) return;
        const panel = root.querySelector<HTMLElement>(`#settings-panel-${request.section}`);
        if (panel === null) return;
        const { anchor } = request;
        const row =
          anchor === undefined
            ? undefined
            : Array.from(panel.querySelectorAll<HTMLElement>(`[${anchor.attribute}]`)).find(
                (element) => element.getAttribute(anchor.attribute) === anchor.value,
              );
        (row ?? panel.querySelector<HTMLElement>('.settings-section-title'))?.focus();
      },
      { defer: true },
    ),
  );

  const items = createMemo(() => attentionItems(state));
  const counts = createMemo(() => attentionBySection(items()));
  const badges = createMemo(() =>
    navBadges({
      connected: state.providers.loaded
        ? state.providers.rows.filter((row) => row.connections.length > 0).length
        : undefined,
      mcpAttention: counts().mcp ?? 0,
    }),
  );
  const index = createMemo(() => buildSearchIndex(state));

  /** Opens `section` and, when asked, focuses its heading or the row `anchor` names. */
  const jump = (section: SettingsSection, anchor?: FocusRequest['anchor']): void => {
    props.ui.setSection(section);
    setFocusRequest(anchor === undefined ? { section } : { section, anchor });
  };

  /**
   * Runs the search result `entry`: a jump opens its section and focuses its target, a setting asks
   * the host to open it, an action is sent as is. A jump to a provider that is not connected expands
   * its card first, because that card exists only once expanded. VERIFIED in jsdom (fabricated
   * state) by "focuses the card of a provider that is not connected when the search jumps to it" of
   * `SettingsApp.test.tsx`; the setting and action branches by the Enter checks next to it.
   */
  const choose = (entry: SearchEntry): void => {
    const target = entry.target;
    if (target.kind === 'jump') {
      // A provider that is not connected has no row: its card only exists once expanded under
      // "+ Add provider" (the same as picking it there), so expand it first to have a focus target.
      const anchor = target.anchor;
      if (
        anchor?.attribute === 'data-provider' &&
        state.providers.rows.some((row) => row.id === anchor.value && row.connections.length === 0)
      ) {
        props.ui.setExpanded(anchor.value);
      }
      jump(target.section, target.anchor);
    } else if (target.kind === 'setting') {
      props.send({ type: 'settings.openSetting', key: target.key });
    } else props.send({ type: 'settings.action', action: target.action });
  };

  /** Opens the section of a "Needs attention" item and focuses the row it names. */
  const jumpToItem = (item: AttentionItem): void => {
    jump(item.section, item.anchor);
  };

  const subtitle = (): string => {
    // Four whole sentences (with/without version and folder), never fragments glued together.
    const version = state.serverVersion;
    if (version === undefined) {
      return state.folder === ''
        ? l10n.t('Settings of the opencode server.')
        : l10n.t('Settings of the opencode server for {0}.', state.folder);
    }
    return state.folder === ''
      ? l10n.t('Settings of the opencode v{0} server.', version)
      : l10n.t('Settings of the opencode v{0} server for {1}.', version, state.folder);
  };

  return (
    <div
      class="settings-root"
      ref={(element) => {
        root = element;
      }}
    >
      <div class="settings-shell">
        <header class="settings-header">
          <div class="settings-heading-block">
            <h1 class="settings-title">{l10n.t('OpenCode settings')}</h1>
            <p class="settings-subtitle">{subtitle()}</p>
          </div>
          <Show when={state.received && state.connection.state === 'connected'}>
            <div class="settings-header-tools">
              <SettingsSearch entries={index} onChoose={choose} />
              <button
                type="button"
                class="secondary"
                onClick={() => {
                  props.send({ type: 'settings.refresh' });
                }}
              >
                {l10n.t('Refresh')}
              </button>
            </div>
          </Show>
        </header>

        <Switch>
          <Match when={!state.received}>
            <p class="settings-empty" role="status">
              <span class="spinner" aria-hidden="true" />
              {` ${l10n.t('Loading…')}`}
            </p>
          </Match>
          <Match when={state.connection.state !== 'connected'}>
            <section
              class="connection-card"
              classList={{
                'connection-card-neutral':
                  state.connection.state !== 'unavailable' && state.connection.state !== 'stopped',
              }}
              data-state={state.connection.state}
              aria-labelledby="settings-connection-title"
            >
              <span class="card-icon">
                <WarningIcon />
              </span>
              <div class="card-text">
                <p class="card-title" id="settings-connection-title">
                  <Switch>
                    <Match when={state.connection.state === 'not-started'}>
                      {l10n.t('The opencode server has not started yet.')}
                    </Match>
                    <Match when={state.connection.state === 'starting'}>
                      {l10n.t('Starting the opencode server…')}
                    </Match>
                    <Match when={state.connection.state === 'reconnecting'}>
                      {l10n.t('The connection to the opencode server was lost. Reconnecting…')}
                    </Match>
                    <Match when={state.connection.state === 'stopped'}>
                      {l10n.t('The opencode server is stopped.')}
                    </Match>
                    <Match when={true}>{l10n.t('The opencode server is not available.')}</Match>
                  </Switch>
                </p>
                <p class="card-cause">
                  {l10n.t('Providers and MCP servers show up once it is running.')}
                </p>
              </div>
              <Show
                when={
                  state.connection.state === 'unavailable' || state.connection.state === 'stopped'
                }
              >
                <div class="card-actions">
                  <button
                    type="button"
                    class="secondary"
                    onClick={() => {
                      props.send({ type: 'settings.action', action: 'restart' });
                    }}
                  >
                    {l10n.t('Restart server')}
                  </button>
                </div>
              </Show>
            </section>
          </Match>
          <Match when={true}>
            <StatusCards
              state={state}
              section={props.ui.section()}
              mcpAttention={counts().mcp ?? 0}
              onSelect={(section) => {
                props.ui.setSection(section);
              }}
              send={props.send}
            />
            <div class="settings-body">
              <SettingsNav
                section={props.ui.section()}
                horizontal={horizontal()}
                badges={badges()}
                onSelect={(section) => {
                  props.ui.setSection(section);
                }}
              />
              <div class="settings-content">
                <For each={SETTINGS_SECTIONS}>
                  {(section) => (
                    <div
                      role="tabpanel"
                      class="settings-panel"
                      id={`settings-panel-${section}`}
                      aria-labelledby={`settings-tab-${section}`}
                      hidden={props.ui.section() !== section}
                    >
                      <h2 class="settings-section-title" tabindex="-1">
                        {labels[section]}
                      </h2>
                      <Switch>
                        <Match when={section === 'general'}>
                          <GeneralSection
                            state={state}
                            items={items()}
                            onJump={jumpToItem}
                            send={props.send}
                          />
                        </Match>
                        <Match when={section === 'providers'}>
                          <ProvidersSection state={state} ui={props.ui} send={props.send} />
                        </Match>
                        <Match when={section === 'models'}>
                          <ModelsSection state={state} send={props.send} />
                        </Match>
                        <Match when={section === 'mcp'}>
                          <McpSection mcp={state.mcp} />
                        </Match>
                        <Match when={section === 'mods'}>
                          <ModsSection send={props.send} />
                        </Match>
                        <Match when={section === 'workMode'}>
                          <WorkModeSection />
                        </Match>
                        <Match when={section === 'advanced'}>
                          <AdvancedSection send={props.send} />
                        </Match>
                      </Switch>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Match>
        </Switch>

        <p class="setup-footer settings-footer">
          <button
            type="button"
            class="link-button"
            onClick={() => {
              props.send({ type: 'settings.action', action: 'logs' });
            }}
          >
            {l10n.t('Show logs')}
          </button>
          {' · '}
          <button
            type="button"
            class="link-button"
            onClick={() => {
              props.send({ type: 'settings.action', action: 'extensionSettings' });
            }}
          >
            {l10n.t('Extension settings')}
          </button>
        </p>
        <div class="visually-hidden" role="status" aria-live="polite">
          {announcement()}
        </div>
      </div>
    </div>
  );
}
