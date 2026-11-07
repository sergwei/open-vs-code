import * as l10n from '@vscode/l10n';
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { plural } from '../../../src/shared/l10n';
import type { ModEntry, ModsListing } from '../../../src/shared/model';
import type { ModsAction } from '../../../src/shared/protocol';
import { PuzzleIcon } from '../chat/icons';
import { dismissOutside } from '../selectors/dismissOutside';

/** `id` of the dialog, referenced by the `aria-controls` of the button. One prompt per document. */
const DIALOG_ID = 'mods-menu';

/** `id` of the heading that names the dialog (`aria-labelledby`). */
const HEADING_ID = 'mods-menu-heading';

/** Marks the button so a pointer-down on it is not read as "outside" (see `dismissOutside`). */
const TRIGGER_SELECTOR = '[data-mods-trigger]';

/**
 * How long a row stays `aria-busy` waiting for the `mods.state` that answers its switch. Our
 * choice, not measured: a failure of the host (`notice`, e.g. the list could not be saved) sends no
 * `mods.state`, so without a limit the row would stay blocked for good. The host publishes the new
 * listing right after it saved the list, BEFORE it stops or starts the Worker, so the normal wait
 * is short; what can stretch it is a load or another toggle queued ahead in the host. 5 s covers a
 * normal queue and is short enough that a retry is not a long wait. There is one timer for the
 * whole popover: pressing a second switch restarts the limit of the first (harmless).
 */
const BUSY_LIMIT_MS = 5000;

/** True when the switch of `mod` reads "on": everything but the ones the user turned off. */
function isOn(mod: ModEntry): boolean {
  return mod.state !== 'disabled';
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

/** The state line under a mod's description, or `undefined` when there is nothing to add. */
function stateLine(mod: ModEntry): string | undefined {
  if (mod.state === 'starting') return l10n.t('Starting…');
  if (mod.state === 'failed') return mod.error ?? l10n.t('Could not start');
  return undefined;
}

/**
 * The mods button of the prompt bar (a puzzle piece and a count of the active mods) and its
 * popover with one switch per mod (E10-mod-toggles, issue #181, design A of Sergio). The host owns
 * the list: this component only shows `listing` and calls `onToggle` / `onAction` (the parent posts
 * `mod.toggle` / `mods.action`), so a click never assumes its own outcome: the switch changes when
 * the next `mods.state` arrives, and meanwhile its row is `aria-busy` and the switch `aria-disabled`
 * (at most {@link BUSY_LIMIT_MS}, in case the host answers with a `notice` only).
 *
 * It renders nothing when the listing has no mod and no skipped folder (decision C1). The button
 * is `aria-haspopup="dialog"`, not a menu: the popover holds switches with a description and two
 * link-buttons, and is non-modal. Its accessible name is "Mods: N active" (the badge is
 * `aria-hidden` and shown only for N > 0). Opening puts the focus on the first switch, or on
 * "Open folder" when there is none. Escape closes with `preventDefault` + `stopPropagation` (the
 * prompt box stops the turn on Escape while busy) and returns the focus to the button; Tab out of
 * the dialog, a pointer-down outside and the window blurring close without moving the focus. With
 * `listing.enabled` false (decision D1) the rows stay listed, the switches are `aria-disabled`, the
 * popover says the mods are off and offers "Open Settings"; the webview never writes that setting.
 * Nothing here uses `disabled`, and nothing depends on a server connection (lesson of #155).
 * The footer says where the choice is kept: this workspace, or this window when `persisted` is
 * false (decision of Sergio, 07/11/2026, Engram #1997).
 * VERIFIED by `ModsMenu.test.tsx` in jsdom (wiring, fabricated listings) and on Windows 11, VS Code
 * 1.145.2 (07/11/2026) by `test:visual` step 45 with the real mouse and keyboard: "a click opens
 * the popover with the focus on the first switch", "the switch of hello-station reads off" (real
 * mouse), "Escape with the popover open closes it and does NOT stop the running turn", "with
 * openVsCode.mods.enabled off the popover lists the mods with aria-disabled switches" and the
 * matrix cells (6 components x wide, 300 px and under 200 px x the four themes), e.g. "row with the
 * switch off at 300 (bar 300 px), hc-light: inside the view, no sideways overflow, text whole".
 * The off switch first drew its outline in `--vscode-checkbox-border` and measured 1.57:1 in
 * Default Light Modern (see `index.css`). The keyboard path (Tab to a switch, then Space) is NOT
 * cited as verified: step 45 failed on it three times, never reproduced on demand. (1) The popover
 * was closed when the Tab arrived (cause unknown, `hasFocus` was not printed yet; HYPOTHESIS: the
 * window lost the system focus and the `window` blur closed it, as designed). (2) The document had
 * no focus when the popover was opened (the check printed that the document had no focus; HYPOTHESIS:
 * the panel tab just opened took the system focus, lost about 700 ms after the panel opened in 5 of
 * 10 runs; `openByMouse` now refocuses the chat first). (3) The Tab reached quiet with the popover open and
 * the focus in the document, but Space did not turn it off within 20 s (cause NOT proven). Later
 * runs passed; the check now reads the state right after the key and the host logs
 * `mod <id> switched on|off in this workspace|window`, to tell "the key never arrived" from "the host did
 * not answer". Detail in Engram `E10-mod-toggles/implementation-fix`.
 * The button's name has a singular and a plural key (Spanish "1 activo" / "2 activos"), VERIFIED
 * by `ModsMenu.test.tsx` "reads the shipped Spanish catalog" and "uses the singular in Spanish for
 * one active mod"; each switch is `aria-describedby` its description and state line. macOS, Linux
 * and a screen reader were not observed.
 */
export function ModsMenu(props: {
  listing: ModsListing;
  onToggle(modId: string, enabled: boolean): void;
  onAction(action: ModsAction): void;
  /**
   * Hands the parent a function that closes the popover without touching the focus, for when the
   * parent moves the focus by code (the webview document may not own it, so no `focusout` fires).
   */
  onCloseReady?(close: () => void): void;
}) {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set());
  let trigger: HTMLButtonElement | undefined;
  let dialog: HTMLDivElement | undefined;
  let busyTimer: ReturnType<typeof setTimeout> | undefined;
  props.onCloseReady?.(() => {
    setOpen(false);
  });

  const activeCount = (): number =>
    props.listing.mods.filter((mod) => mod.state === 'active').length;
  const visible = (): boolean => props.listing.mods.length > 0 || props.listing.skipped.length > 0;
  // Two catalog keys (the comment tells them apart: the English text is the same), so Spanish can
  // say "1 activo" and "2 activos" (review W3); `plural` follows the CLDR rule of the language.
  const label = (): string =>
    plural(
      activeCount(),
      l10n.t({
        message: 'Mods: {0} active',
        args: [activeCount()],
        comment: ['Name of the mods button, exactly one mod active'],
      }),
      l10n.t({
        message: 'Mods: {0} active',
        args: [activeCount()],
        comment: ['Name of the mods button, none or several active'],
      }),
    );

  /** The control that takes the focus on open: the first switch, else the first button. */
  const firstFocusable = (): HTMLElement | null | undefined =>
    dialog?.querySelector<HTMLElement>('button[role="switch"]') ??
    dialog?.querySelector<HTMLElement>('button');

  const clearBusy = (): void => {
    if (busyTimer !== undefined) clearTimeout(busyTimer);
    busyTimer = undefined;
    setBusy(new Set<string>());
  };
  // Any change of the listing is the host's answer: unblock the rows (a state we did not ask for
  // also ends the wait, which is harmless: the next click is simply allowed).
  createEffect(
    on(() => props.listing.mods.map((mod) => `${mod.id}:${mod.state}`).join('|'), clearBusy, {
      defer: true,
    }),
  );
  onCleanup(() => {
    if (busyTimer !== undefined) clearTimeout(busyTimer);
  });

  /** Closes the popover; `restoreFocus` puts the focus back on the button. */
  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) trigger?.focus();
  };

  const openDialog = (): void => {
    setOpen(true);
    firstFocusable()?.focus();
  };

  const toggle = (mod: ModEntry): void => {
    if (!props.listing.enabled || busy().has(mod.id)) return;
    setBusy(new Set([...busy(), mod.id]));
    if (busyTimer !== undefined) clearTimeout(busyTimer);
    busyTimer = setTimeout(clearBusy, BUSY_LIMIT_MS);
    props.onToggle(mod.id, !isOn(mod));
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && open()) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  // The focus leaving the webview altogether fires `blur` on the window but no `focusout` with a
  // target; a popover left open there would be an orphan (same reasoning as `WorkModeMenu`).
  const onWindowBlur = (): void => {
    if (open()) close(false);
  };
  onMount(() => {
    window.addEventListener('blur', onWindowBlur);
  });
  onCleanup(() => {
    window.removeEventListener('blur', onWindowBlur);
  });

  dismissOutside(
    () => dialog,
    TRIGGER_SELECTOR,
    () => {
      close(false);
    },
  );

  return (
    <Show when={visible()}>
      <div class="plus-wrap mods-wrap">
        <button
          type="button"
          class="secondary plus-trigger mods-trigger"
          data-mods-trigger
          aria-haspopup="dialog"
          aria-expanded={open()}
          aria-controls={DIALOG_ID}
          aria-label={label()}
          title={label()}
          ref={(element) => {
            trigger = element;
          }}
          onKeyDown={onKeyDown}
          onClick={() => {
            if (open()) close(false);
            else openDialog();
          }}
        >
          <PuzzleIcon />
          <Show when={activeCount() > 0}>
            <span class="mods-badge" aria-hidden="true">
              {activeCount()}
            </span>
          </Show>
        </button>
        <Show when={open()}>
          <div
            id={DIALOG_ID}
            class="plus-menu mods-popover"
            role="dialog"
            aria-labelledby={HEADING_ID}
            ref={(element) => {
              dialog = element;
            }}
            onKeyDown={onKeyDown}
            onFocusOut={(event) => {
              const next = event.relatedTarget;
              if (!(next instanceof Node) || dialog?.contains(next) || trigger?.contains(next))
                return;
              close(false);
            }}
          >
            <div class="mods-header">
              <span id={HEADING_ID} class="mods-title">
                {l10n.t('Mods')}
              </span>
              <button
                type="button"
                class="mods-link"
                onClick={() => {
                  props.onAction('openFolder');
                }}
              >
                {l10n.t('Open folder')}
              </button>
            </div>
            <Show when={!props.listing.enabled}>
              <div class="mods-off" role="note">
                <span>
                  {l10n.t('Mods are turned off. Turn them on in the settings to use the switches.')}
                </span>
                <button
                  type="button"
                  class="mods-link"
                  onClick={() => {
                    props.onAction('openSettings');
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
                  aria-busy={busy().has(mod.id) ? 'true' : undefined}
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
                    aria-disabled={
                      !props.listing.enabled || busy().has(mod.id) ? 'true' : undefined
                    }
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
          </div>
        </Show>
      </div>
    </Show>
  );
}
