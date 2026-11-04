// Text of the status bar item that shows the state of the opencode server and its model (issue
// #124). Pure: no `vscode` import, so Vitest pins every text. `chatLifecycle.ts` owns the real
// item and feeds it through the `ServerStatusSink` of the chat controller.

import * as l10n from '@vscode/l10n';
import type { Catalog } from '../shared/model';
import type { ConnectionState } from '../shared/protocol';

/** What the status bar item shows: label (with a codicon), hover text and screen-reader label. */
export interface ServerStatus {
  text: string;
  tooltip: string;
  ariaLabel: string;
  /** True for a state that deserves the error background of the status bar. */
  error: boolean;
}

/**
 * The model a NEW session would start with: the host's preferred one, else the server default,
 * written with its catalog name, or `provider/id` when the catalog does not list it. `undefined`
 * without a catalog or when neither is known. `$(` is removed from the name so a server-provided
 * name cannot inject a codicon into the label.
 */
export function statusModelLabel(catalog: Catalog | undefined): string | undefined {
  const ref = catalog?.preferredModel ?? catalog?.serverDefault;
  if (catalog === undefined || ref === undefined) return undefined;
  const listed = catalog.models.find(
    (model) => model.providerID === ref.providerID && model.id === ref.id,
  );
  return (listed?.name ?? `${ref.providerID}/${ref.id}`).replaceAll('$(', '');
}

/**
 * Describes the item for a connection state and the held catalog. The tooltip is plain text (a
 * `MarkdownString` would let a model name format it) and never carries a URL or a port. The
 * codicon names: `circle-outline` and `check` are VERIFIED rendered (the main thread inspected
 * the `test:visual` captures 32a-not-started and 32b-started on Windows 11, 31/10/2026: the status
 * bar read "○ OpenCode: not started" and "✓ OpenCode: Big Pickle"); `loading~spin`,
 * `circle-slash` and `error` are HYPOTHESIS until a capture shows them. Every text goes through
 * `l10n.t` when the function runs (the brand `OpenCode` alone stays literal), so the item follows
 * the language of the host; the layout (icon, line break, `label. hint` for the screen reader)
 * stays in code.
 */
export function describeServerStatus(
  connection: ConnectionState,
  catalog: Catalog | undefined,
): ServerStatus {
  const model = statusModelLabel(catalog);
  const open = l10n.t('Click to open the chat.');
  const make = (icon: string, label: string, detail: string, error = false): ServerStatus => ({
    text: `$(${icon}) ${label}`,
    tooltip: `${detail}\n${open}`,
    ariaLabel: `${label}. ${open}`,
    error,
  });
  switch (connection.state) {
    case 'connected': {
      const version = l10n.t('OpenCode server running (opencode {0}).', connection.serverVersion);
      return make(
        'check',
        model === undefined ? 'OpenCode' : l10n.t('OpenCode: {0}', model),
        model === undefined ? version : `${version}\n${l10n.t('Model: {0}', model)}`,
      );
    }
    case 'starting':
    case 'reconnecting':
      return make(
        'loading~spin',
        'OpenCode',
        connection.state === 'starting'
          ? l10n.t('Starting the server.')
          : l10n.t('Reconnecting to the server.'),
      );
    case 'not-started':
      return make(
        'circle-outline',
        l10n.t('OpenCode: not started'),
        connection.reason === 'project-plugins'
          ? l10n.t(
              'The server is not started: this folder has opencode plugins that have not been allowed.',
            )
          : l10n.t('The server is not started (openVsCode.autoStart is off).'),
      );
    case 'unavailable':
      return make(
        'error',
        l10n.t('OpenCode: unavailable'),
        l10n.t('The server is not available.'),
        true,
      );
    case 'stopped':
      return make('circle-slash', l10n.t('OpenCode: stopped'), l10n.t('The server is stopped.'));
  }
}
