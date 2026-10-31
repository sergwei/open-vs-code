// Text of the status bar item that shows the state of the opencode server and its model (issue
// #124). Pure: no `vscode` import, so Vitest pins every text. `chatLifecycle.ts` owns the real
// item and feeds it through the `ServerStatusSink` of the chat controller.

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
 * `circle-slash` and `error` are HYPOTHESIS until a capture shows them.
 */
export function describeServerStatus(
  connection: ConnectionState,
  catalog: Catalog | undefined,
): ServerStatus {
  const model = statusModelLabel(catalog);
  const open = 'Click to open the chat.';
  const make = (icon: string, label: string, detail: string, error = false): ServerStatus => ({
    text: `$(${icon}) ${label}`,
    tooltip: `${detail}\n${open}`,
    ariaLabel: `${label}. ${open}`,
    error,
  });
  switch (connection.state) {
    case 'connected': {
      const version = `OpenCode server running (opencode ${connection.serverVersion}).`;
      return make(
        'check',
        model === undefined ? 'OpenCode' : `OpenCode: ${model}`,
        model === undefined ? version : `${version}\nModel: ${model}`,
      );
    }
    case 'starting':
    case 'reconnecting':
      return make(
        'loading~spin',
        'OpenCode',
        connection.state === 'starting' ? 'Starting the server.' : 'Reconnecting to the server.',
      );
    case 'not-started':
      return make(
        'circle-outline',
        'OpenCode: not started',
        'The server is not started (openVsCode.autoStart is off).',
      );
    case 'unavailable':
      return make('error', 'OpenCode: unavailable', 'The server is not available.', true);
    case 'stopped':
      return make('circle-slash', 'OpenCode: stopped', 'The server is stopped.');
  }
}
