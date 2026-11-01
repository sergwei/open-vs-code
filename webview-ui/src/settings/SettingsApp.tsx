import { createEffect, createSignal, For, Match, on, Show, Switch } from 'solid-js';
import { WarningIcon } from '../chat/icons';
import { McpSection } from './McpSection';
import type { SendSettings } from './ProviderCard';
import { ProvidersSection } from './ProvidersSection';
import { noticeText, type SettingsStore } from './settingsStore';
import type { SettingsTab, SettingsUi } from './settingsUiState';

/** Built from its code point: a literal one in the source trips `no-irregular-whitespace`. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** The tabs, in order. */
const TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'mcp', label: 'MCP servers' },
];

/**
 * The OpenCode Settings tab (issue #128, E10; decisions P2=1 and P3=1 of plan B): a centered column
 * of 380 px (the whole width when narrow) with the title, two tabs (Providers, MCP servers), a
 * Refresh button, the active panel and a footer with "Show logs" and "Extension settings".
 *
 * What it shows depends on the host's state: before the first `settings.state` it says "Loading";
 * while the server is not connected it shows a card with what happened (and Restart server when
 * that can help) instead of the panels; connected, it shows the tabs. The panels are both in the
 * document (the inactive one `hidden`) so each keeps its state.
 *
 * Accessibility: the tabs are a `role="tablist"` with a roving tabindex (Arrow keys, Home, End
 * move AND activate, since the panels are cheap); a hidden `role="status"` region announces the
 * host's one-shot notices ("Connected to X", "Sign-in expired") in the order they arrived, and
 * alternates a trailing no-break space so the same text twice is announced twice (solid-webview
 * section 7). The component never moves the focus on its own except as the cards do. Colours and
 * sizes are in `index.css` (`--vscode-*` only, no inline style).
 *
 * VERIFIED by `SettingsApp.test.tsx` (jsdom, fabricated state: loading, empty, not connected, tabs
 * with the keyboard, notices in order) and, in a real VS Code 1.144.0 on Windows 11 (1/11/2026,
 * `npm run test:visual -- --group config`, synthetic server), by "ok   V1 300 px, hc-light:
 * Connected lists Anthropic (API key, Remove) and Google Vertex …" and "ok   V5 300 px (300), High
 * Contrast Light: with the server down the tab says "The opencode server is not available.", offers
 * Restart server …" (three widths, four themes for V1, two for V5). UNVERIFIED: a screen reader, and
 * the "Loading…" line (a transient the harness cannot hold).
 */
export function SettingsApp(props: { store: SettingsStore; send: SendSettings; ui: SettingsUi }) {
  const state = props.store.state;
  const [announcement, setAnnouncement] = createSignal('');
  let flip = false;
  const tabElements: Partial<Record<SettingsTab, HTMLButtonElement>> = {};

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

  const select = (tab: SettingsTab, focus: boolean): void => {
    props.ui.setTab(tab);
    if (focus) tabElements[tab]?.focus();
  };

  const onTabKey = (event: KeyboardEvent): void => {
    const index = TABS.findIndex((tab) => tab.id === props.ui.tab());
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    const target = next === undefined ? undefined : TABS[next];
    if (target === undefined) return;
    event.preventDefault();
    select(target.id, true);
  };

  const subtitle = (): string => {
    const version = state.serverVersion === undefined ? '' : ` v${state.serverVersion}`;
    const folder = state.folder === '' ? '' : ` for ${state.folder}`;
    return `Providers and MCP servers of the opencode${version} server${folder}.`;
  };

  return (
    <div class="settings-root">
      <div class="settings-column">
        <header class="settings-header">
          <h1 class="settings-title">OpenCode settings</h1>
          <p class="settings-subtitle">{subtitle()}</p>
        </header>

        <Switch>
          <Match when={!state.received}>
            <p class="settings-empty" role="status">
              <span class="spinner" aria-hidden="true" />
              {' Loading…'}
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
                      The opencode server has not started yet.
                    </Match>
                    <Match when={state.connection.state === 'starting'}>
                      Starting the opencode server…
                    </Match>
                    <Match when={state.connection.state === 'reconnecting'}>
                      The connection to the opencode server was lost. Reconnecting…
                    </Match>
                    <Match when={state.connection.state === 'stopped'}>
                      The opencode server is stopped.
                    </Match>
                    <Match when={true}>The opencode server is not available.</Match>
                  </Switch>
                </p>
                <p class="card-cause">Providers and MCP servers show up once it is running.</p>
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
                    Restart server
                  </button>
                </div>
              </Show>
            </section>
          </Match>
          <Match when={true}>
            <div class="settings-toolbar">
              <div
                class="settings-tabs"
                role="tablist"
                aria-label="Settings sections"
                onKeyDown={onTabKey}
              >
                <For each={TABS}>
                  {(tab) => (
                    <button
                      type="button"
                      role="tab"
                      class="settings-tab"
                      id={`settings-tab-${tab.id}`}
                      aria-selected={props.ui.tab() === tab.id}
                      aria-controls={`settings-panel-${tab.id}`}
                      tabindex={props.ui.tab() === tab.id ? 0 : -1}
                      ref={(element) => {
                        tabElements[tab.id] = element;
                      }}
                      onClick={() => {
                        select(tab.id, false);
                      }}
                    >
                      {tab.label}
                    </button>
                  )}
                </For>
              </div>
              <button
                type="button"
                class="secondary"
                onClick={() => {
                  props.send({ type: 'settings.refresh' });
                }}
              >
                Refresh
              </button>
            </div>
            <div
              role="tabpanel"
              class="settings-panel"
              id="settings-panel-providers"
              aria-labelledby="settings-tab-providers"
              hidden={props.ui.tab() !== 'providers'}
            >
              <ProvidersSection state={state} ui={props.ui} send={props.send} />
            </div>
            <div
              role="tabpanel"
              class="settings-panel"
              id="settings-panel-mcp"
              aria-labelledby="settings-tab-mcp"
              hidden={props.ui.tab() !== 'mcp'}
            >
              <McpSection mcp={state.mcp} />
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
            Show logs
          </button>
          {' · '}
          <button
            type="button"
            class="link-button"
            onClick={() => {
              props.send({ type: 'settings.action', action: 'extensionSettings' });
            }}
          >
            Extension settings
          </button>
        </p>
        <div class="visually-hidden" role="status" aria-live="polite">
          {announcement()}
        </div>
      </div>
    </div>
  );
}
