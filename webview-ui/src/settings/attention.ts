// What "Needs attention" lists in General (issue #186, decision P5): a pure function over the
// store's state, so the list, the amber MCP card and the numbers of the navigation all come from the
// same place and are tested without a DOM.
import * as l10n from '@vscode/l10n';
import type { SettingsStoreState } from './settingsStore';
import type { SettingsSection } from './settingsUiState';

/** Where an item comes from; each kind is one source of trouble. */
export type AttentionKind =
  'serverDown' | 'providerNeedsAuth' | 'mcpFailed' | 'mcpNeedsAuth' | 'modelIgnored';

/** One thing the user should look at, with the place to jump to. */
export interface AttentionItem {
  /** Stable and unique within one list (`<kind>:<subject>`), usable as a `<For>` key. */
  id: string;
  kind: AttentionKind;
  /** The sentence shown, already translated. */
  text: string;
  /** The section that holds the thing. */
  section: SettingsSection;
  /** Value of `data-provider` or `data-server` of the row to focus, when there is one. */
  anchor?: { attribute: 'data-provider' | 'data-server'; value: string };
}

/** The slice of the store {@link attentionItems} reads. */
export type AttentionInput = Pick<
  SettingsStoreState,
  'connection' | 'providers' | 'models' | 'preference' | 'mcp'
>;

/**
 * Lists what needs attention, in this order: the server being down, providers whose connection
 * says it needs sign-in, MCP servers that failed or need sign-in, and an ignored default-model
 * setting. One item per subject (a provider with two connections that both need auth is one item).
 *
 * The default-model item exists only once the models were read and the read did not fail:
 * `preference.status` is judged against the rows the host holds, so before that `unavailable`
 * would be an artefact. An MCP list that is empty because it is still loading
 * (`pendingFirstRead`) has no servers, so it adds nothing. `serverDown` covers `unavailable`,
 * `stopped` and `reconnecting`; `not-started` and `starting` are normal states and are not trouble.
 * VERIFIED by `attention.test.ts` with fabricated states (one item per source, none for a healthy
 * one); how often a real server produces each source is not measured.
 */
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const connection = input.connection.state;
  if (connection === 'unavailable' || connection === 'stopped' || connection === 'reconnecting') {
    items.push({
      id: 'serverDown:server',
      kind: 'serverDown',
      text:
        connection === 'reconnecting'
          ? l10n.t('The connection to the opencode server was lost')
          : l10n.t('The opencode server is not running'),
      section: 'general',
    });
  }
  for (const row of input.providers.rows) {
    if (row.connections.some((connectionRow) => connectionRow.needsAuth !== undefined)) {
      items.push({
        id: `providerNeedsAuth:${row.id}`,
        kind: 'providerNeedsAuth',
        text: l10n.t('{0} needs you to sign in again', row.name),
        section: 'providers',
        anchor: { attribute: 'data-provider', value: row.id },
      });
    }
  }
  for (const server of input.mcp.servers) {
    if (server.status === 'failed') {
      items.push({
        id: `mcpFailed:${server.name}`,
        kind: 'mcpFailed',
        text: l10n.t('The MCP server {0} failed', server.name),
        section: 'mcp',
        anchor: { attribute: 'data-server', value: server.name },
      });
    } else if (server.status === 'needs_auth') {
      items.push({
        id: `mcpNeedsAuth:${server.name}`,
        kind: 'mcpNeedsAuth',
        text: l10n.t('The MCP server {0} needs you to sign in', server.name),
        section: 'mcp',
        anchor: { attribute: 'data-server', value: server.name },
      });
    }
  }
  const status = input.preference.status;
  if (
    input.models.loaded &&
    !input.models.failed &&
    (status === 'invalid' || status === 'unavailable')
  ) {
    items.push({
      id: 'modelIgnored:preference',
      kind: 'modelIgnored',
      text: l10n.t('The default model {0} is being ignored', input.preference.value),
      section: 'models',
    });
  }
  return items;
}

/** How many items point at each section, for the numbers of the navigation. */
export function attentionBySection(
  items: readonly AttentionItem[],
): Partial<Record<SettingsSection, number>> {
  const counts: Partial<Record<SettingsSection, number>> = {};
  for (const item of items) counts[item.section] = (counts[item.section] ?? 0) + 1;
  return counts;
}
