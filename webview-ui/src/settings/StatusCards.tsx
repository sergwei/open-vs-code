import * as l10n from '@vscode/l10n';
import { For, Show } from 'solid-js';
import { plural } from '../../../src/shared/l10n';
import type { SendSettings } from './ProviderCard';
import type { SettingsStoreState } from './settingsStore';
import type { SettingsSection } from './settingsUiState';

/** One card of the header: the section it opens, its two lines and whether it is in trouble. */
interface Card {
  id: 'server' | 'providers' | 'model' | 'mcp';
  section: SettingsSection;
  label: string;
  value: string;
  /** A second line under the value, when there is something more to say. */
  note?: string;
  warning: boolean;
}

/**
 * The four cards, from the state: Server, Providers, Default model and MCP servers. Each value is a
 * whole sentence (a count, a name, "Loading…"), never a fragment glued to another, so a language
 * can order it as it needs. `mcpAttention` is how many MCP servers need attention, from
 * `attention.ts`: more than zero turns the MCP card amber and adds a line that says so in words
 * (colour is never the only signal). The Default model card says "Ignored: X" only for a value the
 * host judged `invalid`, or `unavailable` once the models are read (`loaded`, not `failed`); while
 * they load or if reading failed it shows the value, because the host has no rows to judge against.
 * VERIFIED in jsdom (fabricated state), one check per branch of `SettingsApp.test.tsx`: "does not
 * call the default model ignored while the models load" and "does not call the default model
 * ignored when reading the models failed".
 */
function cardsOf(state: SettingsStoreState, mcpAttention: number): Card[] {
  const connectedProviders = state.providers.rows.filter(
    (row) => row.connections.length > 0,
  ).length;
  let providers: string;
  if (state.providers.failed && !state.providers.loaded) providers = l10n.t('Could not read');
  else if (!state.providers.loaded) providers = l10n.t('Loading…');
  else {
    providers = plural(
      connectedProviders,
      l10n.t('{0} provider connected', connectedProviders),
      l10n.t('{0} providers connected', connectedProviders),
    );
  }

  const preferred = state.models.rows.find(
    (model) => `${model.providerID}/${model.id}` === state.preference.value,
  );
  let model: string;
  switch (state.preference.status) {
    case 'applied':
      model = preferred?.name ?? state.preference.value;
      break;
    case 'unavailable':
      // "Unavailable" is judged against the model rows; before they are read (or when reading
      // failed) the host has none, so the card shows the value instead of claiming it is ignored.
      model =
        state.models.loaded && !state.models.failed
          ? l10n.t('Ignored: {0}', state.preference.value)
          : state.preference.value;
      break;
    case 'invalid':
      model = l10n.t('Ignored: {0}', state.preference.value);
      break;
    case 'none':
      model =
        state.models.serverDefault === undefined
          ? l10n.t('Chosen by opencode')
          : l10n.t('Chosen by opencode: {0}', state.models.serverDefault.name);
      break;
  }

  const servers = state.mcp.servers;
  const active = servers.filter((server) => server.status === 'connected').length;
  let mcp: string;
  if (state.mcp.failed && !state.mcp.loaded) mcp = l10n.t('Could not read');
  else if (!state.mcp.loaded || state.mcp.pendingFirstRead) mcp = l10n.t('Loading…');
  else if (servers.length === 0) mcp = l10n.t('None configured');
  else mcp = l10n.t('{0} of {1} active', active, servers.length);

  const version = state.serverVersion;
  return [
    {
      id: 'server',
      section: 'general',
      label: l10n.t('Server'),
      value: version === undefined ? l10n.t('Connected') : l10n.t('Connected · v{0}', version),
      warning: false,
    },
    {
      id: 'providers',
      section: 'providers',
      label: l10n.t('Providers'),
      value: providers,
      warning: false,
    },
    {
      id: 'model',
      section: 'models',
      label: l10n.t('Default model'),
      value: model,
      warning: false,
    },
    {
      id: 'mcp',
      section: 'mcp',
      label: l10n.t('MCP servers'),
      value: mcp,
      ...(mcpAttention > 0
        ? {
            note: plural(
              mcpAttention,
              l10n.t('{0} needs attention', mcpAttention),
              l10n.t('{0} need attention', mcpAttention),
            ),
          }
        : {}),
      warning: mcpAttention > 0,
    },
  ];
}

/**
 * The four status cards of the header (issue #186): each one is a button that opens its section,
 * and the card of the section that is open carries `aria-current="true"`. The title button is the
 * only primary control; the secondary buttons (Restart server and Show logs on the Server card) sit
 * beside it, never inside it, so there are no nested buttons, and CSS stretches the title button
 * over the whole card (`::after`) so the card is one big target. The secondary buttons are hidden
 * by CSS below 600 px (the card keeps its title button).
 *
 * VERIFIED in jsdom by `SettingsApp.test.tsx` with fabricated states: "opens on General the first
 * time, with the four header cards and the seven sections" (the four labels and values), "a card
 * opens its section and carries aria-current, with no nested buttons" (the secondary buttons are
 * siblings of the title button) and "turns the MCP card amber and says it in words when servers need
 * attention". VERIFIED in a real VS Code 1.145.2 on Windows 11 (the full `npm run test:visual` of
 * 08/11/2026 on the final tree, "all visual checks passed", step
 * "46 OpenCode Settings: header, navigation and search (E10-settings-redesign)"): the contrast of
 * every card text in four themes at four widths ("ok   H1 660
 * px (tab 660, root 626), light: the header has the title, the search and the four cards in 2 row(s)
 * (expected 2), every card text inside its card (true) … min contrast 6.31 over 16 texts") and the
 * click on the card, "ok   H1 the Providers card opens Providers and is the one marked". NOT
 * observed: a click on the secondary buttons of the Server card, the stretched target by a click
 * outside the title text, macOS, Linux.
 */
export function StatusCards(props: {
  state: SettingsStoreState;
  section: SettingsSection;
  mcpAttention: number;
  onSelect(section: SettingsSection): void;
  send: SendSettings;
}) {
  const cards = () => cardsOf(props.state, props.mcpAttention);
  return (
    <div class="status-cards" role="group" aria-label={l10n.t('Overview')}>
      <For each={cards()}>
        {(card) => (
          <div
            class="status-card"
            data-card={card.id}
            data-tone={card.warning ? 'warning' : undefined}
          >
            <button
              type="button"
              class="status-card-main"
              aria-current={props.section === card.section ? 'true' : undefined}
              onClick={() => {
                props.onSelect(card.section);
              }}
            >
              <span class="status-card-label">{card.label}</span>
              <span class="status-card-value">{card.value}</span>
              <Show when={card.note}>
                {(note) => <span class="status-card-note">{note()}</span>}
              </Show>
            </button>
            <Show when={card.id === 'server'}>
              <div class="status-card-actions">
                <button
                  type="button"
                  class="link-button"
                  onClick={() => {
                    props.send({ type: 'settings.action', action: 'restart' });
                  }}
                >
                  {l10n.t('Restart server')}
                </button>
                <button
                  type="button"
                  class="link-button"
                  onClick={() => {
                    props.send({ type: 'settings.action', action: 'logs' });
                  }}
                >
                  {l10n.t('Show logs')}
                </button>
              </div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
