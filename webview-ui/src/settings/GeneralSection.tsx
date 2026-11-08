import * as l10n from '@vscode/l10n';
import { For, Show } from 'solid-js';
import type { AttentionItem } from './attention';
import { SettingLinkRow } from './LinkSections';
import type { SendSettings } from './ProviderCard';
import type { SettingsStoreState } from './settingsStore';

/**
 * The General section (issue #186, phase 1.2): "Needs attention" (only when there is something),
 * the server (state, version, folder, remote) with Restart server and Show logs, and two rows that
 * open the chat settings in the native editor.
 *
 * "Needs attention" is a list of buttons: each one calls `onJump` with its item, and the app opens
 * the section and focuses the row. It sits first because it is the reason the tab was opened when
 * something is wrong. The amber tone is the border and the background of the card, never the text
 * (`solid-webview` section 6). The inline controls for `chatLocation` and `autoStart` come with
 * PR3; here they are links to the native setting.
 *
 * VERIFIED in jsdom by `SettingsApp.test.tsx` with a fabricated state: "lists what needs attention
 * in General only when something does, and jumps to the row with the focus" (the card appears only
 * with items, each item jumps with its own data) and "shows Server facts in General and sends
 * Restart server and Show logs from there". VERIFIED in a real VS Code 1.145.2 on Windows 11
 * (the full `npm run test:visual` of 08/11/2026 on the final tree, "all visual checks passed", step
 * "47 OpenCode Settings: Models and General (E10-settings-redesign)", synthetic server) at 1080 and
 * 300 px in four themes: "ok   G1 300 px (300), light: General lists "Needs attention" with
 * ["mcpFailed","mcpNeedsAuth"], the server facts and the two chat rows, all inside the document
 * (true), no sideways overflow (0 px) …", and the jump: "ok   G1 the item opens MCP servers and
 * focuses the card of "linear"". NOT observed: the rows' buttons pressed (they open the Settings
 * editor), macOS, Linux.
 */
export function GeneralSection(props: {
  state: SettingsStoreState;
  items: readonly AttentionItem[];
  onJump(item: AttentionItem): void;
  send: SendSettings;
}) {
  return (
    <div class="settings-general">
      <Show when={props.items.length > 0}>
        <section class="attention-card" aria-labelledby="settings-attention-title">
          <h3 class="attention-title" id="settings-attention-title">
            {l10n.t('Needs attention')}
          </h3>
          <ul class="attention-list">
            <For each={props.items}>
              {(item) => (
                <li>
                  <button
                    type="button"
                    class="link-button attention-item"
                    data-kind={item.kind}
                    onClick={() => {
                      props.onJump(item);
                    }}
                  >
                    {item.text}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <section class="settings-facts" aria-label={l10n.t('Server')}>
        <dl class="facts">
          <div class="fact">
            <dt>{l10n.t('Status')}</dt>
            <dd>{l10n.t('Connected')}</dd>
          </div>
          <Show when={props.state.serverVersion}>
            {(version) => (
              <div class="fact">
                <dt>{l10n.t('Version')}</dt>
                <dd>{`v${version()}`}</dd>
              </div>
            )}
          </Show>
          <Show when={props.state.folder !== ''}>
            <div class="fact">
              <dt>{l10n.t('Folder')}</dt>
              <dd>{props.state.folder}</dd>
            </div>
          </Show>
          <Show when={props.state.remote}>
            {(remote) => (
              <div class="fact">
                <dt>{l10n.t('Remote')}</dt>
                <dd>{remote()}</dd>
              </div>
            )}
          </Show>
        </dl>
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
          <button
            type="button"
            class="secondary"
            onClick={() => {
              props.send({ type: 'settings.action', action: 'logs' });
            }}
          >
            {l10n.t('Show logs')}
          </button>
        </div>
      </section>

      <div class="settings-links">
        <SettingLinkRow
          title={l10n.t('Chat location')}
          description={l10n.t('Editor tabs, one per session, or one chat in the side bar.')}
          settingKey="chatLocation"
          send={props.send}
        />
        <SettingLinkRow
          title={l10n.t('Start the server automatically')}
          description={l10n.t('Launch opencode when the window starts.')}
          settingKey="autoStart"
          send={props.send}
        />
      </div>
    </div>
  );
}
