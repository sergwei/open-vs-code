import * as l10n from '@vscode/l10n';
import { createEffect, createMemo, For, Show } from 'solid-js';
import type { SettingsModelRow } from '../../../src/shared/settingsProtocol';
import type { SendSettings } from './ProviderCard';
import type { SettingsStoreState } from './settingsStore';

/** The models of one provider, in the order the catalog lists them. */
interface ModelGroup {
  providerID: string;
  providerName: string;
  models: SettingsModelRow[];
}

/** Groups `rows` by provider keeping the first-seen order of both providers and models. */
function groupByProvider(rows: readonly SettingsModelRow[]): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const row of rows) {
    let group = groups.find((candidate) => candidate.providerID === row.providerID);
    if (group === undefined) {
      group = { providerID: row.providerID, providerName: row.providerName, models: [] };
      groups.push(group);
    }
    group.models.push(row);
  }
  return groups;
}

/**
 * The Models section (issue #186, phase 1.3): the default model of NEW chats, and, read only, the
 * model opencode itself proposes.
 *
 * The select writes `openVsCode.defaultModel` in the USER settings through the host
 * (`settings.setDefaultModel`, decision P3 of E10-settings-redesign); nothing writes a file of
 * opencode. It lists the models of the connected providers grouped by provider, plus "None", which
 * sends `''` and clears the setting. The select is NOT written optimistically: it sends the exact
 * `provider/model` text and only follows the state the host sends back (an effect re-syncs it to
 * `preference.value` whenever the state changes), so a value the host refuses is not shown as
 * saved once the next state arrives. A value of the setting that the catalog does not offer (or
 * that is not written `provider/model`) stays selectable as its own entry marked unavailable, so
 * the select never silently shows another model than the one the setting holds, and a sentence says
 * it is being ignored. When the workspace has its own value a hint says it hides this one and
 * offers to open the setting. The "small model" has no row: opencode 2 chooses it by itself
 * (decision P2: a line says so).
 *
 * The row "Default model of opencode" is `model.default` of the server, which is the model of the
 * highest-priority config document if that model is enabled, or else the first text model.
 * HYPOTHESIS: how a new chat chooses between the setting, the last used model and this one is that
 * order (setting, then last used, then opencode's), read in `modelPreference.ts`, not re-run here.
 * VERIFIED in jsdom by `ModelsSection.test.tsx` with fabricated state: the select lists the models
 * grouped by provider, sends the exact value, "None" sends the empty text, nothing is sent without
 * a change, the ignored value stays selectable, and the workspace hint opens the setting.
 * VERIFIED in a real VS Code 1.145.2 on Windows 11 (the full `npm run test:visual` of 08/11/2026 on
 * the final tree, "all visual checks passed", step
 * "47 OpenCode Settings: Models and General (E10-settings-redesign)", synthetic server): "ok   M1
 * choosing a model writes openVsCode.defaultModel in the user settings and the select follows the
 * state (select "opencode/big-pickle", user settings "opencode/big-pickle")" (the change is the
 * ArrowDown key; when it does not reach the select, step 47 logs "M1 the select was changed by
 * script, not by the keyboard", a line the full run does not have), "ok   M1 a workspace value
 * of the setting shows the workspace hint" and, at 1080 and 300 px in four themes, "ok   M2 300 px
 * (300), hc-light: the select, the row of opencode and the workspace hint with its button are
 * inside the document ([true,true,true,true]) …". The `fake-server` case "sets the default model
 * from the Settings tab and the chat proposes it" (62 passing, 7/11/2026) shows the host writing the
 * setting once, refusing `ghost/model` and clearing it; "the chat proposes it" there is the log line
 * `new chats propose <model>`, not the catalog the webview receives. NOT observed: the "ignored"
 * hint and the "Open setting" button pressed in a real VS Code (jsdom only).
 */
export function ModelsSection(props: { state: SettingsStoreState; send: SendSettings }) {
  const groups = createMemo(() => groupByProvider(props.state.models.rows));
  const value = (): string => props.state.preference.value;
  // True when the setting holds text that is not one of the listed models.
  const orphan = (): boolean =>
    value() !== '' &&
    !props.state.models.rows.some((row) => `${row.providerID}/${row.id}` === value());
  const ignored = (): boolean =>
    props.state.preference.status === 'invalid' ||
    (props.state.preference.status === 'unavailable' && props.state.models.loaded);
  let select: HTMLSelectElement | undefined;
  // Follows the host: after every state (and whenever the options change) the select shows what
  // the setting holds, not what the user last picked.
  createEffect(() => {
    const wanted = value();
    void groups();
    if (select !== undefined) select.value = wanted;
  });
  const serverDefaultText = (): string | undefined => {
    const model = props.state.models.serverDefault;
    if (model === undefined) return undefined;
    const row = props.state.models.rows.find(
      (candidate) => candidate.providerID === model.providerID && candidate.id === model.id,
    );
    return `${row?.providerName ?? model.providerID} · ${model.name}`;
  };

  return (
    <div class="settings-links">
      <div class="link-row" role="group" aria-label={l10n.t('Default model of new chats')}>
        <div class="link-row-text">
          <label class="link-row-title" for="settings-default-model">
            {l10n.t('Default model of new chats')}
          </label>
          <p class="settings-hint">
            {l10n.t('New chats start with this model. Chats already open keep theirs.')}
          </p>
          <Show
            when={props.state.models.loaded}
            fallback={
              <p class="settings-hint" role="status">
                {props.state.models.failed
                  ? l10n.t('Could not read the models from the server. Try Refresh.')
                  : l10n.t('Loading the models…')}
              </p>
            }
          >
            <select
              id="settings-default-model"
              class="settings-input"
              ref={(element) => {
                select = element;
              }}
              onChange={(event) => {
                props.send({ type: 'settings.setDefaultModel', model: event.currentTarget.value });
              }}
            >
              <option value="" selected={value() === ''}>
                {l10n.t('None: the last used model, or the one of opencode')}
              </option>
              <Show when={orphan()}>
                <option value={value()} selected>
                  {l10n.t('{0} (not available)', value())}
                </option>
              </Show>
              <For each={groups()}>
                {(group) => (
                  <optgroup label={group.providerName}>
                    <For each={group.models}>
                      {(model) => (
                        <option
                          value={`${model.providerID}/${model.id}`}
                          selected={`${model.providerID}/${model.id}` === value()}
                        >
                          {model.name}
                        </option>
                      )}
                    </For>
                  </optgroup>
                )}
              </For>
            </select>
          </Show>
          <Show when={ignored()}>
            <p class="settings-hint" role="status" data-hint="ignored">
              {l10n.t(
                'New chats ignore the saved model {0}: it is not written as provider/model, or no connected provider offers it.',
                value(),
              )}
            </p>
          </Show>
          <Show when={props.state.preference.workspaceOverride}>
            <p class="settings-hint" data-hint="workspace">
              {l10n.t(
                'This workspace sets its own default model, which hides the one chosen here.',
              )}{' '}
              <button
                type="button"
                class="link-button"
                onClick={() => {
                  props.send({ type: 'settings.openSetting', key: 'defaultModel' });
                }}
              >
                {l10n.t('Open setting')}
              </button>
            </p>
          </Show>
        </div>
      </div>
      <div class="link-row" role="group" aria-label={l10n.t('Default model of opencode')}>
        <div class="link-row-text">
          <p class="link-row-title">{l10n.t('Default model of opencode')}</p>
          <p class="settings-hint" data-field="server-default">
            {serverDefaultText() ?? l10n.t('opencode names none yet.')}
          </p>
          <p class="settings-hint">
            {l10n.t(
              'It comes from the opencode configuration and applies when no default is set above.',
            )}
          </p>
        </div>
      </div>
      <p class="settings-hint">
        {l10n.t('opencode 2 picks the small model for titles and summaries by itself.')}
      </p>
    </div>
  );
}
