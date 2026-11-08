import * as l10n from '@vscode/l10n';
import { For, Show } from 'solid-js';
import { plural } from '../../../src/shared/l10n';
import type { ProviderRow, SettingsConnectionRow } from '../../../src/shared/settingsProtocol';
import type { SendSettings } from './ProviderCard';

/** How one connection reads in the row: the method, or the variable that manages it. */
function connectionLabel(connection: SettingsConnectionRow): string {
  if (connection.kind === 'env') return l10n.t('Managed by {0}', connection.name);
  if (connection.method === 'key') return l10n.t('API key');
  if (connection.method === 'oauth') return l10n.t('Signed in');
  return l10n.t('External');
}

/** "3 models", "1 model", or nothing while the catalog has not been read (`modelCount` absent). */
function modelsLabel(count: number | undefined): string | undefined {
  if (count === undefined) return undefined;
  return plural(count, l10n.t('{0} model', count), l10n.t('{0} models', count));
}

/**
 * One connected provider of the Providers section as a compact row (issue #186, phase 1.3): a
 * monogram, the name, "method · n models", a "Connected" pill and the one action that applies.
 *
 * A connection through a stored credential gets "Disconnect", which only sends `settings.disconnect`
 * (the host asks for the confirmation, as before); a connection through an environment variable gets
 * the text "Managed by VARIABLE" and NO button, because opencode cannot remove a variable and a
 * button that did nothing would lie. A provider with several connections lists one line per
 * connection. The model count comes from the catalog read and is left out while it is unknown, so
 * the row never says "0 models" before the first read. While the host runs an attempt (`busy`) the
 * button is `aria-disabled`, not `disabled`, and ignores the press, so a focus it holds is not
 * thrown to the `body` (solid-webview section 7).
 *
 * The row is an `li` with `data-provider` and `tabindex="-1"` like the card, because `ProvidersSection`
 * focuses the element of the provider the user acted on after an attempt ends, and that element is
 * this row when the attempt ended connected. All texts of the server are rendered as text.
 * VERIFIED in jsdom by `ConnectedProviderRow.test.tsx` (fabricated rows): the Disconnect message,
 * "Managed by" with no button for an environment variable, and the model count absent until known.
 * VERIFIED in a real VS Code 1.145.2 on Windows 11 (7/11/2026, `npm run test:visual -- --steps
 * 35,46,47,48`, synthetic server) at 1080, 620 and 300 px in four themes: "ok   V1 300 px, dark:
 * Connected lists Anthropic (API key, Disconnect) and Google Vertex (Managed by
 * GOOGLE_APPLICATION_CREDENTIALS, no button), each with its monogram and Connected pill …"; and, in
 * step 36 (same day), "ok   V7 pressing Enter connects Azure: it moves to Connected as a row with
 * "API key" and a Disconnect button …" and "ok   F1 after Enter in the key box the Azure card has
 * the focus with the document focused …" (the row takes the focus after the attempt). Those runs
 * were on an EARLIER tree than the current one; the final full `test:visual` of the branch is what
 * covers this tree, and no run of it is claimed here.
 */
export function ConnectedProviderRow(props: {
  row: ProviderRow;
  busy: boolean;
  send: SendSettings;
}) {
  const titleId = (): string => `provider-${props.row.id}-title`;
  return (
    <li
      class="setup-step settings-card provider-row"
      data-status="done"
      data-provider={props.row.id}
      tabindex="-1"
      aria-labelledby={titleId()}
    >
      <span class="provider-monogram" aria-hidden="true">
        {props.row.name.slice(0, 1).toUpperCase()}
      </span>
      <div class="provider-row-body">
        <div class="provider-row-head">
          <p class="step-title" id={titleId()}>
            {props.row.name}
          </p>
          <span class="settings-pill">{l10n.t('Connected')}</span>
        </div>
        <For each={props.row.connections}>
          {(connection, index) => (
            <div class="provider-connection">
              <p class="step-line">
                {[
                  connectionLabel(connection),
                  index() === 0 ? modelsLabel(props.row.modelCount) : undefined,
                ]
                  .filter((part) => part !== undefined)
                  .join(' · ')}
              </p>
              <Show when={connection.needsAuth}>
                {(message) => <p class="step-line">{l10n.t('Needs sign-in: {0}', message())}</p>}
              </Show>
              <Show when={connection.kind === 'credential' ? connection : undefined}>
                {(credential) => (
                  <button
                    type="button"
                    class="secondary"
                    aria-label={l10n.t('Disconnect {0} ({1})', props.row.name, credential().label)}
                    aria-disabled={props.busy ? 'true' : undefined}
                    onClick={() => {
                      if (props.busy) return;
                      props.send({
                        type: 'settings.disconnect',
                        integrationID: props.row.id,
                        credentialID: credential().id,
                      });
                    }}
                  >
                    {l10n.t('Disconnect')}
                  </button>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>
    </li>
  );
}
