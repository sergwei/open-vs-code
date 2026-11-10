import * as l10n from '@vscode/l10n';
import { Show } from 'solid-js';
import type { ModsListing } from '../../../src/shared/model';
import { createModsBusy, ModsRows } from '../mods/ModsRows';
import { SettingLinkRow } from './LinkSections';
import type { SendSettings } from './ProviderCard';
import type { SettingsStoreState } from './settingsStore';

/** The list of mods and its switches; a child so `createModsBusy` always has a listing to watch. */
function ModsList(props: { listing: ModsListing; send: SendSettings }) {
  const busy = createModsBusy(() => props.listing);
  const empty = (): boolean =>
    props.listing.mods.length === 0 && props.listing.skipped.length === 0;
  return (
    <>
      <Show
        when={!empty()}
        fallback={
          <p class="settings-hint" role="status">
            {l10n.t(
              'No mods were found. Put a folder with a mod.json in the mods folder, then reload.',
            )}
          </p>
        }
      >
        <div class="settings-mods-list">
          <ModsRows
            listing={props.listing}
            busy={busy}
            focusableRows
            onToggle={(modId, enabled) => {
              props.send({ type: 'settings.modToggle', modId, enabled });
            }}
            onOpenSettings={() => {
              props.send({ type: 'settings.openSetting', key: 'mods.enabled' });
            }}
          />
        </div>
      </Show>
    </>
  );
}

/**
 * The Mods section (issue #186, PR3): the mods of this workspace with one switch each, the same
 * rows as the popover of the chat (`ModsRows`), "Reload mods" and "Open folder", and a row that
 * opens `openVsCode.mods.enabled` (machine-wide: the tab never writes it).
 *
 * The switch is `settings.modToggle`; the host does what `mod.toggle` of the chat does and the row
 * follows the next `settings.state` (busy meanwhile, at most 5 s). A failed mod shows its error in
 * the row and is listed in "Needs attention". Without a mods half (`state.mods` undefined) the
 * section says the mods are not available instead of claiming there are none; with the list empty
 * it says none were found. Nothing here depends on the server being connected, but the tab only
 * shows its sections while it is (decision P1 of E10-settings-sections).
 * VERIFIED in jsdom by `ModsSection.test.tsx` (fabricated listings): the rows and their states, the
 * switch sends `settings.modToggle`, a busy row until the listing changes or 5 s, the off note with
 * Open Settings, the empty and the absent cases. VERIFIED in a real VS Code (Windows 11, 1.145.3,
 * 10/11/2026, `test:visual` step 53): "ok   the Mods section lists quiet and throws (failed) and the
 * skipped folder", "ok   B1 the switch of quiet turns it off: aria-checked false, the host logged
 * "mod quiet switched off in this workspace" and the badge of Mods is gone (null)" and "ok   B5 with
 * openVsCode.mods.enabled off Mods shows the note, its switches are aria-disabled and pressing one
 * switches nothing". NOT observed: the 5 s busy timeout, the empty and the absent cases, a screen
 * reader, macOS, Linux. UNVERIFIED.
 */
export function ModsSection(props: { state: SettingsStoreState; send: SendSettings }) {
  return (
    <div class="settings-links settings-mods">
      <p class="settings-hint">
        {l10n.t(
          'A mod is JavaScript that runs with your user’s permissions, in its own worker thread. Turn the mods off to load none.',
        )}
      </p>
      <div class="settings-mods-actions">
        <button
          type="button"
          class="secondary"
          onClick={() => {
            props.send({ type: 'settings.action', action: 'reloadMods' });
          }}
        >
          {l10n.t('Reload mods')}
        </button>
        <button
          type="button"
          class="secondary"
          onClick={() => {
            props.send({ type: 'settings.action', action: 'openModsFolder' });
          }}
        >
          {l10n.t('Open folder')}
        </button>
      </div>
      <Show
        when={props.state.mods}
        fallback={
          <p class="settings-hint" role="status">
            {l10n.t('Mods are not available.')}
          </p>
        }
      >
        {(listing) => <ModsList listing={listing()} send={props.send} />}
      </Show>
      <SettingLinkRow
        title={l10n.t('Enable mods')}
        description={l10n.t(
          'The global switch, for all your windows. Turn it off to load no mod at all.',
        )}
        settingKey="mods.enabled"
        send={props.send}
      />
    </div>
  );
}
