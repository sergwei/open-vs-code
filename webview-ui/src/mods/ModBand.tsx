import * as l10n from '@vscode/l10n';
import { For, Show } from 'solid-js';
import type { ModBand } from '../../../src/shared/model';

/**
 * The short name of a qualified `<modId>:<command>`: what the band's button shows. A name with no
 * `:` (never produced by the host, which always qualifies) is returned as it is.
 */
export function shortCommandName(qualified: string): string {
  const colon = qualified.indexOf(':');
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

/**
 * The status bands mods pinned above the composer (E10-mods, phase 3): one row per mod with the
 * mod's name, its text and, when the mod gave a `command`, a button that runs it.
 *
 * Everything a mod controls is printed as TEXT (`{band.text}`, the `title` attribute for the
 * tooltip): a `<b>` in a band is shown as the characters `<b>`, never as markup, and nothing here
 * uses `innerHTML` or a `style` attribute (a mod is user-installed code, but the band is still
 * input from another program). The severity is only the left border (`data-severity`), never a text
 * colour (lesson: error red as text on the sidebar fails contrast). The button has an `aria-label`
 * naming the command and the mod, and is `aria-disabled` rather than `disabled` while a request is in
 * flight so it keeps the focus (skill solid-webview §7). Nothing renders when there are no bands.
 *
 * PRESENTATIONAL: it knows nothing about the store or the host; `App` passes `onRun`, which sends
 * `mod.command.run`. Lives outside the `role="log"` list, like the revert banner.
 * VERIFIED in jsdom by `ModBand.test.tsx` with fabricated bands ("prints markup from a mod as text
 * and puts the tooltip in a title attribute", "gives the button an aria-label and calls back with
 * the qualified command", "is aria-disabled, not disabled, and ignores the click while disabled";
 * 02/11/2026). VERIFIED in a real VS Code 1.144.0 on Windows 11 (02/11/2026, the final full
 * `test:visual` run, synthetic server): "ok   at 300 (bar 300 px), hc-light: M3 the name, the text
 * and the button of the band have contrast >= 4.5 (name 14.55, text 14.55, button 14.55)" and the
 * same check in the other three themes and at 900 px, plus "ok   M2 the band prints the HTML of the
 * mod as text (no b, i, img or a element), the tooltip is a title and the severity is info". Not
 * observed on macOS or Linux, or with a `warning` or `error` band in a real window.
 */
export function ModBands(props: {
  bands: readonly ModBand[];
  disabled: boolean;
  onRun: (command: string) => void;
}) {
  return (
    <Show when={props.bands.length > 0}>
      <section class="mod-bands" aria-label={l10n.t('Mod status')}>
        <For each={props.bands}>
          {(band) => (
            <div
              class="mod-band"
              data-mod={band.modId}
              data-severity={band.severity}
              title={band.tooltip}
            >
              <span class="mod-band-name">{band.modName}</span>
              <span class="mod-band-text">{band.text}</span>
              <Show when={band.command}>
                {(command) => (
                  <button
                    type="button"
                    class="secondary mod-band-action"
                    aria-label={l10n.t('Run {0} ({1})', shortCommandName(command()), band.modName)}
                    aria-disabled={props.disabled ? 'true' : undefined}
                    onClick={() => {
                      if (!props.disabled) props.onRun(command());
                    }}
                  >
                    {shortCommandName(command())}
                  </button>
                )}
              </Show>
            </div>
          )}
        </For>
      </section>
    </Show>
  );
}
