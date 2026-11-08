import * as l10n from '@vscode/l10n';
import type { SettingsSettingKey } from '../../../src/shared/settingsProtocol';
import type { SendSettings } from './ProviderCard';

/**
 * One row of a section that has no data yet (issue #186, phase 1.2): a title, a sentence that says
 * what the thing does, and one button. The row is a `role="group"` named by its title, so a screen
 * reader says which row a button belongs to; the button's own name carries the title too.
 */
export function LinkRow(props: {
  title: string;
  description: string;
  buttonLabel: string;
  onClick(): void;
}) {
  return (
    <div class="link-row" role="group" aria-label={props.title}>
      <div class="link-row-text">
        <p class="link-row-title">{props.title}</p>
        <p class="settings-hint">{props.description}</p>
      </div>
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
 * The Mods section (issue #186, phase 1.2): one row that opens `openVsCode.mods.enabled`. The list
 * of mods with a switch each comes with PR3; until then the section links instead of staying empty.
 * VERIFIED in jsdom by "Mods opens openVsCode.mods.enabled and sends nothing before the click" of
 * `LinkSections.test.tsx` (the button sends exactly `settings.openSetting` with `mods.enabled`).
 */
export function ModsSection(props: { send: SendSettings }) {
  return (
    <div class="settings-links">
      <SettingLinkRow
        title={l10n.t('Enable mods')}
        description={l10n.t(
          'A mod is JavaScript that runs with your user’s permissions, in its own worker thread. Turn this off to load none.',
        )}
        settingKey="mods.enabled"
        send={props.send}
      />
    </div>
  );
}

/**
 * The Work mode section (issue #186, phase 1.2): text only. The mode is per session and lives in
 * memory (decision `e3-work-mode/decisions/seis-preguntas`), so there is no setting to open and no
 * default to choose; the section says how it works and where to switch it. The command is named,
 * not linked: a link would need a new action in the protocol, which PR3 adds.
 * VERIFIED in jsdom by "Work mode is text only: the sentences are there and there is no button" of
 * `LinkSections.test.tsx` (the first paragraph and the command name are on screen, no button).
 */
export function WorkModeSection() {
  return (
    <div class="settings-links">
      <p class="settings-hint">
        {l10n.t(
          'Manual asks before each action. Auto lets the agent go on by itself, and still asks about secrets, files outside the project, deleting or moving files, destructive commands and loops.',
        )}
      </p>
      <p class="settings-hint">
        {l10n.t(
          'The mode belongs to one session and is not kept when you close it. Switch it from the prompt row or with the command Toggle Work Mode.',
        )}
      </p>
    </div>
  );
}

/**
 * The Advanced section (issue #186, phase 1.2): the settings that decide which opencode is used
 * (`opencodePath` and `serverUrl`, both only openable here: they are machine-wide), and the two
 * footer actions as rows. The shell of opencode and the commands for the server password come with
 * PR3.
 * VERIFIED in jsdom by "Advanced opens the two machine settings and runs the two footer actions" of
 * `LinkSections.test.tsx` (each button sends its message, in order).
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
        title={l10n.t('Log')}
        description={l10n.t('What the extension did, without anything you typed.')}
        buttonLabel={l10n.t('Show logs')}
        onClick={() => {
          props.send({ type: 'settings.action', action: 'logs' });
        }}
      />
      <LinkRow
        title={l10n.t('All extension settings')}
        description={l10n.t('Every setting of OpenCode in the Settings editor.')}
        buttonLabel={l10n.t('Open settings')}
        onClick={() => {
          props.send({ type: 'settings.action', action: 'extensionSettings' });
        }}
      />
    </div>
  );
}
