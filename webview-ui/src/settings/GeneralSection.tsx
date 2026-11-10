import * as l10n from '@vscode/l10n';
import { createEffect, For, Show } from 'solid-js';
import type { AttentionItem } from './attention';
import type { SendSettings } from './ProviderCard';
import type { SettingsStoreState } from './settingsStore';

/**
 * The General section (issue #186, phase 1.2): "Needs attention" (only when there is something),
 * the server (state, version, folder, remote) with Restart server and Show logs, and, since PR3,
 * two controls in line for `chatLocation` (a select: Editor tabs / Side bar) and `autoStart` (a
 * switch). Both write the USER setting through `settings.setSetting`; neither is optimistic: the
 * select goes back to the value of the state right after the pick (the message is already sent)
 * and again after every state, and the switch reads
 * `aria-checked` from the state, so a write the host refuses or that a workspace value hides is
 * not shown as saved. When the workspace or the folder has its own value a hint says it hides the
 * one chosen here and offers "Open setting". The switch is never `disabled` and reuses the
 * `mods-switch` styling, whose contrast was measured in four themes for the mods popover.
 * Turning `autoStart` off does not stop a running server (`serverManager.ts` `setAutoStart`), and
 * the description says so.
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
 * (true), no sideways overflow (0 px) …" (that wording is the one of that run: the check now names
 * the select and the switch instead of the two rows), and the jump: "ok   G1 the item opens MCP
 * servers and focuses the card of "linear"". That run was BEFORE the two controls. VERIFIED with them in a real
 * VS Code 1.145.3 on Windows 11 (10/11/2026, full `test:visual`, whose only FAIL was in step 25,
 * unrelated): step 47 "ok   G1 1080 px (1080), light: General lists "Needs attention" with
 * ["mcpFailed","mcpNeedsAuth"], the server facts, the chat location select and the automatic start
 * switch (controls true), all inside the document (true), no sideways overflow (0 px), no style
 * attribute (0) …" (also dark, hc-dark, hc-light and at 300 px) and step 53 "ok   B2 the switch of
 * the automatic start writes openVsCode.autoStart false in the user settings (false) and the switch
 * follows the state (aria-checked false: true)". NOT observed: a screen reader. VERIFIED in jsdom by `GeneralSection.test.tsx`: "the select and the switch send the exact
 * message", "puts the select back to the state value, never optimistic" and "shows the workspace
 * hint of each setting and opens it" (fabricated state). NOT observed: macOS, Linux.
 */
export function GeneralSection(props: {
  state: SettingsStoreState;
  items: readonly AttentionItem[];
  onJump(item: AttentionItem): void;
  send: SendSettings;
}) {
  const autoStartTitle = l10n.t('Start the server automatically');
  let select: HTMLSelectElement | undefined;
  // Follows the host, never the pick: after every state the select shows what the setting holds
  // (a write the host refuses, or a workspace value, must not leave a value that is not the saved one).
  createEffect(() => {
    const wanted = props.state.general.chatLocation.value;
    if (select !== undefined) select.value = wanted;
  });
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
        <div class="link-row settings-control" role="group" aria-label={l10n.t('Chat location')}>
          <div class="link-row-text">
            <label class="link-row-title" for="settings-chat-location">
              {l10n.t('Chat location')}
            </label>
            <p class="settings-hint">
              {l10n.t('Editor tabs, one per session, or one chat in the side bar.')}
            </p>
            <Show when={props.state.general.chatLocation.workspaceOverride}>
              <OverrideHint settingKey="chatLocation" send={props.send} />
            </Show>
          </div>
          <select
            id="settings-chat-location"
            class="settings-input settings-select"
            ref={(element) => {
              select = element;
            }}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === 'editor' || value === 'sidebar') {
                props.send({ type: 'settings.setSetting', key: 'chatLocation', value });
              }
              // Not optimistic: the select returns to what the setting holds NOW, and moves to the
              // pick only when the host's next state says it was written. The effect above cannot
              // do it alone: a state with the same value (a refused write) does not re-run it.
              event.currentTarget.value = props.state.general.chatLocation.value;
            }}
          >
            <option value="editor" selected={props.state.general.chatLocation.value === 'editor'}>
              {l10n.t('Editor tabs')}
            </option>
            <option value="sidebar" selected={props.state.general.chatLocation.value === 'sidebar'}>
              {l10n.t('Side bar')}
            </option>
          </select>
        </div>
        <div class="link-row settings-control" role="group" aria-label={autoStartTitle}>
          <div class="link-row-text">
            <p class="link-row-title" id="settings-auto-start-title">
              {autoStartTitle}
            </p>
            <p class="settings-hint" id="settings-auto-start-hint">
              {l10n.t(
                'Launch opencode when the window starts. Turning it off does not stop a server that is already running.',
              )}
            </p>
            <Show when={props.state.general.autoStart.workspaceOverride}>
              <OverrideHint settingKey="autoStart" send={props.send} />
            </Show>
          </div>
          <button
            type="button"
            role="switch"
            class="mods-switch"
            aria-labelledby="settings-auto-start-title"
            aria-describedby="settings-auto-start-hint"
            aria-checked={props.state.general.autoStart.value}
            onClick={() => {
              props.send({
                type: 'settings.setSetting',
                key: 'autoStart',
                value: !props.state.general.autoStart.value,
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** "This workspace has its own value" with the button that opens the setting; shared by both controls. */
function OverrideHint(props: { settingKey: 'chatLocation' | 'autoStart'; send: SendSettings }) {
  return (
    <p class="settings-hint" data-hint="workspace" data-setting={props.settingKey}>
      {l10n.t('This workspace sets its own value, which hides the one chosen here.')}{' '}
      <button
        type="button"
        class="link-button"
        onClick={() => {
          props.send({ type: 'settings.openSetting', key: props.settingKey });
        }}
      >
        {l10n.t('Open setting')}
      </button>
    </p>
  );
}
