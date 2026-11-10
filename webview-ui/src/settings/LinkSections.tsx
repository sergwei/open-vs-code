import * as l10n from '@vscode/l10n';
import type { SettingsAction, SettingsSettingKey } from '../../../src/shared/settingsProtocol';
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
 * The Advanced section (issue #186, PR3): the settings that decide which opencode is used
 * (`opencodePath` and `serverUrl`, both only openable here: they are machine-wide), the server
 * password (Set and Forget, the existing commands: the password is asked in a native InputBox and
 * never passes through the webview), the saved permissions (Manage), the decision about the plugins
 * of this folder (Forget) and the two footer actions as rows. The shell of opencode is NOT here
 * (decision P3 of E10-settings-sections).
 * VERIFIED in jsdom by "sends each action of Advanced in order" and "opens the two machine settings
 * from Advanced" of `LinkSections.test.tsx` (each button sends its message; fabricated state).
 * UNVERIFIED in a real host: what each command does when pressed from the tab (step 53 presses
 * only Forget password).
 */
export function AdvancedSection(props: { send: SendSettings }) {
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
