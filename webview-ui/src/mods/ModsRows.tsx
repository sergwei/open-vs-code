import * as l10n from '@vscode/l10n';
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import type { ModEntry, ModsListing } from '../../../src/shared/model';

/**
 * How long a row stays `aria-busy` waiting for the listing that answers its switch. Our choice, not
 * measured: a failure of the host (a notice, e.g. the list could not be saved) sends no new listing,
 * so without a limit the row would stay blocked for good. The host publishes the new listing right
 * after it saved the list, BEFORE it stops or starts the Worker, so the normal wait is short; what
 * can stretch it is a load or another toggle queued ahead in the host. 5 s covers a normal queue and
 * is short enough that a retry is not a long wait. There is one timer per {@link createModsBusy}:
 * pressing a second switch restarts the limit of the first (harmless).
 */
export const BUSY_LIMIT_MS = 5000;

/** True when the switch of `mod` reads "on": everything but the ones the user turned off. */
export function isOn(mod: ModEntry): boolean {
  return mod.state !== 'disabled';
}

/** The state line under a mod's description, or `undefined` when there is nothing to add. */
function stateLine(mod: ModEntry): string | undefined {
  if (mod.state === 'starting') return l10n.t('Starting…');
  if (mod.state === 'failed') return mod.error ?? l10n.t('Could not start');
  return undefined;
}

/**
 * The ids a switch is described by: the mod's description and its state line (starting, the error
 * of a failed mod), each only when it is drawn, so a screen reader reads them with the switch.
 */
function describedBy(mod: ModEntry): string | undefined {
  const ids = [
    mod.description ? `mods-desc-${mod.id}` : undefined,
    stateLine(mod) !== undefined ? `mods-state-${mod.id}` : undefined,
  ].filter((id) => id !== undefined);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/** The busy marks of the rows of one {@link ModsRows}: which mods wait for the host's answer. */
export interface ModsBusy {
  has(modId: string): boolean;
  /** Marks `modId` busy and (re)starts the {@link BUSY_LIMIT_MS} limit. */
  start(modId: string): void;
}

/**
 * Creates the busy marks for one list of mods (the chat popover and the Settings section each have
 * their own). A mark is cleared by ANY change of the id and state of the listed mods, which is the
 * host's answer (a state we did not ask for also ends the wait, which is harmless: the next click
 * is simply allowed), or after {@link BUSY_LIMIT_MS}. Extracted from `ModsMenu` so both places
 * keep ONE semantics for the switch. VERIFIED for the popover by "a click calls onToggle with the
 * opposite and leaves the row busy until the next listing" and "frees a busy row after the limit
 * when the host never answers" of `ModsMenu.test.tsx` (fabricated listings, vitest, jsdom). The
 * Settings section is covered by the same two behaviours in `ModsSection.test.tsx`.
 */
export function createModsBusy(listing: () => ModsListing): ModsBusy {
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    setBusy(new Set<string>());
  };
  createEffect(
    on(
      () =>
        listing()
          .mods.map((mod) => `${mod.id}:${mod.state}`)
          .join('|'),
      clear,
      {
        defer: true,
      },
    ),
  );
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
  return {
    has: (modId) => busy().has(modId),
    start: (modId) => {
      setBusy(new Set([...busy(), modId]));
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(clear, BUSY_LIMIT_MS);
    },
  };
}

/**
 * The body of the mods list, shared by the prompt-bar popover and the Settings section: the note
 * "Mods are turned off" with its link (only when `listing.enabled` is false), one row per mod with
 * its switch, one row per skipped folder, and the footer that says where the choice is kept.
 *
 * Presentational: it never writes anything. A click calls `onToggle(modId, enabled)` unless the
 * global switch is off or the row is busy; the row is `aria-busy` and the switch `aria-disabled`
 * (never `disabled`: the focus would fall to the body, `solid-webview` section 7) until the
 * listing changes. The switch reads "on" for every state but `disabled`. Each mod row carries
 * `data-mod-id`; only with `focusableRows` (the Settings section passes it) it also carries
 * `tabindex="-1"` so a jump of the tab (an attention item, a search result) can focus it. The
 * popover does not pass it, so its rows have no tabindex, as before the extraction (tested in
 * `ModsMenu.test.tsx`; see below for the real VS Code). Fragments, not a wrapper: the parent
 * decides the layout (the popover is a flex column with a gap). All texts come from `mod.json` or
 * the Worker and are rendered as text.
 *
 * VERIFIED in the popover by `ModsMenu.test.tsx` "shows switches by role and aria-checked, and a
 * state line for starting and failed" and "with the global switch off: notice, aria-disabled
 * switches, Open Settings, no toggle" (fabricated listings, vitest, jsdom). VERIFIED in a real VS
 * Code 1.145.3 on Windows 11 (10/11/2026, `test:visual`): the popover, step 45 "ok   a click opens
 * the popover with the focus on the first switch (hello-station), three mod rows and the skipped
 * folder (…)"; the tab, step 53 "ok   the Mods section lists quiet and throws (failed) and the
 * skipped folder". NOT observed: the absence of `tabindex` on the popover rows as a look.
 */
export function ModsRows(props: {
  listing: ModsListing;
  busy: ModsBusy;
  /** Gives each mod row `tabindex="-1"` so it can be focused by code (Settings only). */
  focusableRows?: boolean;
  onToggle(modId: string, enabled: boolean): void;
  onOpenSettings(): void;
}) {
  const toggle = (mod: ModEntry): void => {
    if (!props.listing.enabled || props.busy.has(mod.id)) return;
    props.busy.start(mod.id);
    props.onToggle(mod.id, !isOn(mod));
  };
  return (
    <>
      <Show when={!props.listing.enabled}>
        <div class="mods-off" role="note">
          <span>
            {l10n.t('Mods are turned off. Turn them on in the settings to use the switches.')}
          </span>
          <button
            type="button"
            class="mods-link"
            onClick={() => {
              props.onOpenSettings();
            }}
          >
            {l10n.t('Open Settings')}
          </button>
        </div>
      </Show>
      <For each={props.listing.mods}>
        {(mod) => (
          <div
            class="mods-row"
            data-mod-id={mod.id}
            tabindex={props.focusableRows ? '-1' : undefined}
            aria-busy={props.busy.has(mod.id) ? 'true' : undefined}
          >
            <div class="mods-text">
              <span class="mods-name">
                {mod.name} <span class="mods-version">{mod.version}</span>
              </span>
              <Show when={mod.description}>
                <span class="mods-description" id={`mods-desc-${mod.id}`}>
                  {mod.description}
                </span>
              </Show>
              <Show when={stateLine(mod)}>
                {(line) => (
                  <span class="mods-state" id={`mods-state-${mod.id}`} data-state={mod.state}>
                    {line()}
                  </span>
                )}
              </Show>
            </div>
            <button
              type="button"
              role="switch"
              class="mods-switch"
              aria-label={mod.name}
              aria-describedby={describedBy(mod)}
              aria-checked={isOn(mod)}
              aria-disabled={!props.listing.enabled || props.busy.has(mod.id) ? 'true' : undefined}
              onClick={() => {
                toggle(mod);
              }}
            />
          </div>
        )}
      </For>
      <For each={props.listing.skipped}>
        {(skipped) => (
          <div class="mods-row mods-skipped" data-skipped={skipped.folder}>
            <div class="mods-text">
              <span class="mods-name">{skipped.folder}</span>
              <span class="mods-state" data-state="skipped">
                {l10n.t('Skipped: {0}', skipped.reason)}
              </span>
            </div>
          </div>
        )}
      </For>
      <p class="mods-footer">
        {props.listing.persisted
          ? l10n.t('Each switch starts or stops only that mod. Saved for this workspace.')
          : l10n.t('No folder open: these choices last until you close this window')}
      </p>
    </>
  );
}
