import * as l10n from '@vscode/l10n';
import { createEffect, createSignal, For, Show } from 'solid-js';
import type {
  SettingsAction,
  SettingsSettingKey,
  SettingsState,
} from '../../../src/shared/settingsProtocol';
import type { SendSettings } from './ProviderCard';

/**
 * One row of a section that links to something instead of holding a control (issue #186): a title,
 * a sentence that says what the thing does, and one button, or two when `secondary` is given (the
 * server password has Set and Forget). The row is a `role="group"` named by its title, so a screen
 * reader says which row a button belongs to; each button's own name carries the title too.
 * VERIFIED by "sends each action of Advanced in order" of `LinkSections.test.tsx` (the two buttons
 * of the password row included; fabricated state, jsdom).
 */
export function LinkRow(props: {
  title: string;
  description: string;
  buttonLabel: string;
  onClick(): void;
  secondary?: { buttonLabel: string; onClick(): void };
}) {
  return (
    <div class="link-row" role="group" aria-label={props.title}>
      <div class="link-row-text">
        <p class="link-row-title">{props.title}</p>
        <p class="settings-hint">{props.description}</p>
      </div>
      <div class="link-row-actions">
        <button
          type="button"
          class="secondary"
          aria-label={`${props.buttonLabel}: ${props.title}`}
          onClick={() => {
            props.onClick();
          }}
        >
          {props.buttonLabel}
        </button>
        {props.secondary !== undefined && (
          <button
            type="button"
            class="secondary"
            aria-label={`${props.secondary.buttonLabel}: ${props.title}`}
            onClick={() => {
              props.secondary?.onClick();
            }}
          >
            {props.secondary.buttonLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** A row that opens one native setting of the extension (the closed list of the protocol). */
export function SettingLinkRow(props: {
  title: string;
  description: string;
  settingKey: SettingsSettingKey;
  send: SendSettings;
}) {
  return (
    <LinkRow
      title={props.title}
      description={props.description}
      buttonLabel={l10n.t('Open setting')}
      onClick={() => {
        props.send({ type: 'settings.openSetting', key: props.settingKey });
      }}
    />
  );
}

/**
 * The Work mode section (issue #186, PR3, decision P2 of E10-settings-sections): the text that
 * says how Manual and Auto work, and ONE button, "Open chat". There is NO switch here on purpose:
 * the mode belongs to one session, and `Toggle Work Mode` from this tab would act on the active or
 * most recent chat tab, which the user is not looking at (Auto answers `once` to permissions). The
 * chat shows the mode and changes it. The button sends the `openChat` action.
 * VERIFIED in jsdom by "Work mode explains Manual and Auto and offers only Open chat" of
 * `LinkSections.test.tsx` (the sentences are there, the only button sends `openChat`, and there is
 * no switch). VERIFIED in a real VS Code (Windows 11, 1.145.3, 10/11/2026, `test:visual` step 53)
 * for the layout: "ok   L3 workMode at 1080 px (tab 1080), light: every row and control inside the
 * document (true), counts {"buttons":1} (expected {"buttons":1}), switches none (each >= 3), no
 * sideways overflow (0 px), no style attribute (0), min contrast 8.89 over 3 texts" (also the other
 * themes and widths). NOT observed: pressing the button.
 */
export function WorkModeSection(props: { send: SendSettings }) {
  return (
    <div class="settings-links">
      <p class="settings-hint">
        {l10n.t(
          'Manual asks before each action. Auto lets the agent go on by itself, and still asks about secrets, files outside the project, deleting or moving files, destructive commands and loops.',
        )}
      </p>
      <p class="settings-hint">
        {l10n.t(
          'The mode belongs to one session and is not kept when you close it. You see it and change it in the chat, in the prompt row or with the command Toggle Work Mode.',
        )}
      </p>
      <LinkRow
        title={l10n.t('Work mode of a chat')}
        description={l10n.t('Open the chat to see the mode of its session and to change it.')}
        buttonLabel={l10n.t('Open chat')}
        onClick={() => {
          props.send({ type: 'settings.action', action: 'openChat' });
        }}
      />
    </div>
  );
}

/** Sends one of the closed {@link SettingsAction}s. */
function act(send: SendSettings, action: SettingsAction): void {
  send({ type: 'settings.action', action });
}

/**
 * The "opencode shell" row of Advanced (issue #205, decisions P1-P3 of E10-settings-shell): a
 * labelled select with Automatic and the shells the server offers, in the same row layout as the
 * General selects. The choice is NOT optimistic and NOT written here: the select reports the pick
 * with `settings.setShell`, and shows the saved shell again at once; while the host writes and reads
 * back (`shell.writing`) it shows the pick with `aria-busy` and `aria-disabled` (never `disabled`,
 * which would drop the focus) and ignores new picks, then returns to `shell.current`, so a refused
 * or failed write ends on the real shell even when its value did not change. Before the first read
 * it says so, and when the read failed it says so and names the saved shell, with no select. The
 * hint tells that the shell is saved in the GLOBAL opencode config, and, when `shell.overridden`, that
 * another config document hides it. The select carries `data-setting="shell"`, the anchor of the
 * search entry.
 * VERIFIED in jsdom by the "shell row" checks of `LinkSections.test.tsx` (options, one message per
 * pick, the busy state, the return to the saved shell, loading, failed and the override hint;
 * fabricated state). VERIFIED in a real VS Code against the fake server by `test:visual --steps 53`
 * (Windows 11, 11/11/2026, "all visual checks passed", twice): "ok   L4 advanced at <w> px ...
 * counts {"buttons":8,"rows":8,"selects":1,"hints":1}" in the 12 cells (3 widths x light, dark,
 * hc-dark, hc-light), "ok   B6 choosing a shell sends one write to the server (1 line(s)
 * {"fake":"config"}) and the select settles on "/usr/bin/bash", not busy" and "ok   B6 choosing
 * Automatic again writes once more (2 line(s) in total) and the select reads Automatic". NOT
 * covered there: `aria-busy` DURING the write (the check sees only "not busy" after it), the
 * loading and failed states, a refused pick, and a real server (the fake answers).
 */
function ShellRow(props: { state: SettingsState; send: SendSettings }) {
  const title = l10n.t('opencode shell');
  let select: HTMLSelectElement | undefined;
  // The last pick, shown only while the host writes it.
  const [picked, setPicked] = createSignal<string | undefined>(undefined);
  const shown = (): string =>
    props.state.shell.writing ? (picked() ?? props.state.shell.current) : props.state.shell.current;
  // Moves the select to `shown()` once the options exist (the effect also reads their count).
  createEffect(() => {
    const value = shown();
    void props.state.shell.options.length;
    if (select !== undefined) select.value = value;
  });
  const optionLabel = (name: string, terminalOnly: boolean): string =>
    terminalOnly ? l10n.t('{0} (terminal only)', name) : name;
  return (
    <div class="link-row settings-control" role="group" aria-label={title}>
      <div class="link-row-text">
        <label class="link-row-title" for="settings-shell">
          {title}
        </label>
        <p class="settings-hint">
          {l10n.t(
            "The shell opencode uses for its terminal and for the agent's commands. Saved in your global opencode config (opencode.jsonc in your user folder), so it also applies to the terminal UI and every folder.",
          )}
        </p>
        <Show when={props.state.shell.overridden}>
          <p class="settings-hint" data-hint="shell-override">
            {l10n.t(
              'Another opencode config (the one of this folder, or one from your organization) sets its own shell, which hides the one chosen here.',
            )}
          </p>
        </Show>
        <Show when={!props.state.shell.loaded && !props.state.shell.failed}>
          <p class="settings-hint">{l10n.t('Reading the shells…')}</p>
        </Show>
        <Show when={props.state.shell.failed}>
          <p class="settings-hint">
            {l10n.t('The shells could not be read.')}
            {props.state.shell.current === '' ? '' : ` ${props.state.shell.current}`}
          </p>
        </Show>
      </div>
      <Show when={props.state.shell.loaded && !props.state.shell.failed}>
        <select
          id="settings-shell"
          class="settings-input settings-select"
          data-setting="shell"
          aria-busy={props.state.shell.writing ? 'true' : undefined}
          aria-disabled={props.state.shell.writing ? 'true' : undefined}
          ref={(element) => {
            select = element;
          }}
          onChange={(event) => {
            const target = event.currentTarget;
            const value = target.value;
            if (!props.state.shell.writing) {
              setPicked(value);
              props.send({ type: 'settings.setShell', shell: value });
            }
            // Not optimistic: back to what the host holds NOW (the pick while it writes). A refusal
            // that changes nothing sends no new state, so only this line can undo the pick.
            target.value = shown();
          }}
        >
          <option value="" selected={shown() === ''}>
            {l10n.t('Automatic')}
          </option>
          <For each={props.state.shell.options}>
            {(option) => (
              <option value={option.value} selected={shown() === option.value}>
                {optionLabel(option.name, option.terminalOnly)}
              </option>
            )}
          </For>
        </select>
      </Show>
    </div>
  );
}

/**
 * The Advanced section (issue #186, PR3; the shell row, issue #205): the settings that decide which
 * opencode is used (`opencodePath` and `serverUrl`, both only openable here: they are machine-wide),
 * the server password (Set and Forget, the existing commands: the password is asked in a native
 * InputBox and never passes through the webview), the saved permissions (Manage), the decision about
 * the plugins of this folder (Forget), the shell of opencode (a select, {@link ShellRow}, after the
 * plugins row and before the log) and the two footer actions as rows.
 * VERIFIED in jsdom by "sends each action of Advanced in order" and "opens the two machine settings
 * from Advanced" of `LinkSections.test.tsx` (each button sends its message; fabricated state).
 * UNVERIFIED in a real host: what each command does when pressed from the tab (step 53 presses
 * only Forget password).
 */
export function AdvancedSection(props: { state: SettingsState; send: SendSettings }) {
  return (
    <div class="settings-links">
      <SettingLinkRow
        title={l10n.t('opencode executable path')}
        description={l10n.t(
          'Which opencode v2 the extension launches. Leave it empty to search the PATH.',
        )}
        settingKey="opencodePath"
        send={props.send}
      />
      <SettingLinkRow
        title={l10n.t('External server URL')}
        description={l10n.t(
          'Use an opencode server that is already running on this machine instead of launching one.',
        )}
        settingKey="serverUrl"
        send={props.send}
      />
      <LinkRow
        title={l10n.t('Server password')}
        description={l10n.t(
          'Only for an external server. Kept in the VS Code secret storage, never in the settings.',
        )}
        buttonLabel={l10n.t('Set password')}
        onClick={() => {
          act(props.send, 'setServerPassword');
        }}
        secondary={{
          buttonLabel: l10n.t('Forget password'),
          onClick: () => {
            act(props.send, 'clearServerPassword');
          },
        }}
      />
      <LinkRow
        title={l10n.t('Saved permissions')}
        description={l10n.t('The permissions you chose to always allow. Pick the ones to revoke.')}
        buttonLabel={l10n.t('Manage')}
        onClick={() => {
          act(props.send, 'managePermissions');
        }}
      />
      <LinkRow
        title={l10n.t('Plugins of this folder')}
        description={l10n.t(
          'Forget your decision about running the plugins this folder asks for, to be asked again.',
        )}
        buttonLabel={l10n.t('Forget decision')}
        onClick={() => {
          act(props.send, 'forgetPluginDecision');
        }}
      />
      <ShellRow state={props.state} send={props.send} />
      <LinkRow
        title={l10n.t('Log')}
        description={l10n.t('What the extension did, without anything you typed.')}
        buttonLabel={l10n.t('Show logs')}
        onClick={() => {
          act(props.send, 'logs');
        }}
      />
      <LinkRow
        title={l10n.t('All extension settings')}
        description={l10n.t('Every setting of OpenCode in the Settings editor.')}
        buttonLabel={l10n.t('Open settings')}
        onClick={() => {
          act(props.send, 'extensionSettings');
        }}
      />
    </div>
  );
}
