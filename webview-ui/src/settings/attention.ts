// What "Needs attention" lists in General (issue #186, decision P5): a pure function over the
// store's state, so the list, the amber MCP card and the numbers of the navigation all come from the
// same place and are tested without a DOM.
import * as l10n from '@vscode/l10n';
import type { SettingsStoreState } from './settingsStore';
import type { SettingsSection } from './settingsUiState';

/** Where an item comes from; each kind is one source of trouble. */
export type AttentionKind =
  'providerNeedsAuth' | 'mcpFailed' | 'mcpNeedsAuth' | 'modFailed' | 'modelIgnored';

/** One thing the user should look at, with the place to jump to. */
export interface AttentionItem {
  /** Stable and unique within one list (`<kind>:<subject>`), usable as a `<For>` key. */
  id: string;
  kind: AttentionKind;
  /** The sentence shown, already translated. */
  text: string;
  /** The section that holds the thing. */
  section: SettingsSection;
  /** Value of `data-provider`, `data-server` or `data-mod-id` of the row to focus, when there is one. */
  anchor?: { attribute: 'data-provider' | 'data-server' | 'data-mod-id'; value: string };
}

/** The slice of the store {@link attentionItems} reads. */
export type AttentionInput = Pick<
  SettingsStoreState,
  'providers' | 'models' | 'preference' | 'mcp'
> & { mods?: SettingsStoreState['mods'] };

/**
 * Lists what needs attention, in this order: providers whose connection says it needs sign-in, MCP
 * servers that failed or need sign-in, mods that failed to start, and an ignored default-model
 * setting. One item per subject (a provider with two connections that both need auth is one item).
 *
 * The default-model item exists only once the models were read and the read did not fail:
 * `preference.status` is judged against the rows the host holds, so before that `unavailable`
 * would be an artefact. An MCP list that is empty because it is still loading
 * (`pendingFirstRead`) has no servers, so it adds nothing. A mod in the state `failed` is an item
 * (named by the mod's name, jumping to its row by `data-mod-id`); `starting`, `stopped` and
 * `disabled` are not trouble, and a missing `mods` adds nothing. There is NO item for the server
 * being down: the tab shows only the connection card while it is not connected, so that item was
 * unreachable (decision P1 of E10-settings-sections, which removed `serverDown`).
 * VERIFIED by `attention.test.ts` with fabricated states (one item per source, none for a healthy
 * one); how often a real server produces each source is not measured.
 */
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
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
  for (const mod of input.mods?.mods ?? []) {
    if (mod.state === 'failed') {
      items.push({
        id: `modFailed:${mod.id}`,
        kind: 'modFailed',
        text: l10n.t('The mod {0} could not start', mod.name),
        section: 'mods',
        anchor: { attribute: 'data-mod-id', value: mod.id },
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
