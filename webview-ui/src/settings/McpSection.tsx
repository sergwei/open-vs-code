import * as l10n from '@vscode/l10n';
import { For, Show } from 'solid-js';
import { plural } from '../../../src/shared/l10n';
import type { SettingsMcpServerRow, SettingsState } from '../../../src/shared/settingsProtocol';
import { CheckIcon, CrossIcon, WarningIcon, WaitingIcon } from '../chat/icons';

/** The word that says the state of a server, so it never depends on colour or icon alone. */
/**
 * The status as a word, in the interface language. A function, not a table built at module level,
 * so the texts follow the locale set at start-up.
 */
function statusWord(status: SettingsMcpServerRow['status']): string {
  switch (status) {
    case 'connected':
      return l10n.t('connected');
    case 'pending':
      return l10n.t('connecting');
    case 'disabled':
      return l10n.t('disabled');
    case 'failed':
      return l10n.t('failed');
    case 'needs_auth':
      return l10n.t('needs sign-in');
  }
}

/** The `data-status` of the step styles for a server status. */
const STATUS_TONE: Record<SettingsMcpServerRow['status'], string> = {
  connected: 'done',
  pending: 'running',
  disabled: 'waiting',
  failed: 'failed',
  needs_auth: 'attention',
};

/** "2 resources · 1 template", or an empty string when there is neither. */
export function countsText(server: SettingsMcpServerRow): string {
  const parts: string[] = [];
  const resources = server.resources.length;
  const templates = server.templates.length;
  if (resources > 0) {
    parts.push(
      plural(resources, l10n.t('{0} resource', resources), l10n.t('{0} resources', resources)),
    );
  }
  if (templates > 0) {
    parts.push(
      plural(templates, l10n.t('{0} template', templates), l10n.t('{0} templates', templates)),
    );
  }
  return parts.join(' · ');
}

/**
 * The MCP servers tab (issue #128, E10), read only: one card per server with its state in words
 * and a mark, the first line of the error of a failed one, and the resources and templates of a
 * connected one. Servers come from `mcp.servers` in `opencode.json`; this tab never starts, stops
 * or signs in to one (decision of plan B: read only plus Refresh), and says so for `needs_auth`.
 *
 * An empty list is NOT "no servers" until the host says the first read is over
 * (`pendingFirstRead` false): v2 answers `[]` for a while after the start and fills the list with
 * the first `mcp.status.changed` (planner spike, 01/11/2026, opencode 2.0.32). All texts of the
 * server (names, errors, URIs) are rendered as text. VERIFIED by `McpSection.test.tsx` (jsdom,
 * fabricated rows) and in a real VS Code 1.144.0 on Windows 11 (1/11/2026, `npm run test:visual --
 * --group config`, synthetic server): "ok   V2 620 px, hc-light: docs connected with 2 resources
 * and 1 template, broken failed with the first line of its error (200 chars, one line), off
 * disabled, linear needs sign-in, nothing outside the document, no overflow (0 px), no style
 * attribute (0), min contrast …" at 1080, 620 and 300 px in the four themes, and "ok   V4 after a
 * prompt with MCPFLIP the open tab shows broken as connected with a status.md resource, in the same
 * document". NOT observed: the "Reading the MCP servers…" and "No MCP servers are configured." lines
 * (the fixture is never empty for long enough to be read; jsdom only).
 */
export function McpSection(props: { mcp: SettingsState['mcp'] }) {
  return (
    <div class="settings-mcp">
      <Show when={props.mcp.servers.length === 0}>
        <p class="settings-empty" role="status">
          <Show
            when={props.mcp.failed}
            fallback={
              <Show
                when={props.mcp.loaded && !props.mcp.pendingFirstRead}
                fallback={
                  <>
                    <span class="spinner" aria-hidden="true" />
                    {` ${l10n.t('Reading the MCP servers…')}`}
                  </>
                }
              >
                {l10n.t('No MCP servers are configured.')}
              </Show>
            }
          >
            {l10n.t('Could not read the MCP servers from the server. Try Refresh.')}
          </Show>
        </p>
      </Show>
      <Show when={props.mcp.servers.length > 0}>
        <ul class="setup-steps" role="list">
          <For each={props.mcp.servers}>
            {(server) => (
              <li
                class="setup-step settings-card"
                data-status={STATUS_TONE[server.status]}
                data-server={server.name}
              >
                <span class="step-mark settings-mark">
                  <Show when={server.status === 'connected'}>
                    <CheckIcon />
                  </Show>
                  <Show when={server.status === 'failed'}>
                    <CrossIcon />
                  </Show>
                  <Show when={server.status === 'disabled'}>
                    <WaitingIcon />
                  </Show>
                  <Show when={server.status === 'needs_auth'}>
                    <WarningIcon />
                  </Show>
                  <Show when={server.status === 'pending'}>
                    <span class="spinner" aria-hidden="true" />
                  </Show>
                </span>
                <div class="step-body">
                  <p class="step-title">
                    {server.name}
                    <span class="step-status">{` — ${statusWord(server.status)}`}</span>
                  </p>
                  <Show when={server.error}>
                    {(error) => <p class="step-line settings-error">{error()}</p>}
                  </Show>
                  <Show when={server.status === 'needs_auth'}>
                    <p class="step-line">
                      {l10n.t('Sign in with the opencode CLI; this view is read-only.')}
                    </p>
                  </Show>
                  <Show when={countsText(server) !== ''}>
                    <p class="step-line step-status">{countsText(server)}</p>
                  </Show>
                  <Show when={server.resources.length > 0}>
                    <ul
                      class="settings-resources"
                      aria-label={l10n.t('Resources of {0}', server.name)}
                    >
                      <For each={server.resources}>
                        {(resource) => (
                          <li title={resource.description}>
                            <span class="settings-res-name">{resource.name}</span>
                            <span class="step-status">
                              {` ${resource.mimeType ?? resource.uri}`}
                            </span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                  <Show when={server.templates.length > 0}>
                    <ul
                      class="settings-resources"
                      aria-label={l10n.t('Templates of {0}', server.name)}
                    >
                      <For each={server.templates}>
                        {(template) => (
                          <li title={template.description}>
                            <span class="settings-res-name">{template.name}</span>
                            <span class="step-status">{` ${template.uriTemplate}`}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <p class="settings-hint">{l10n.t('Servers come from mcp.servers in opencode.json.')}</p>
    </div>
  );
}
