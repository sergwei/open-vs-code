import * as l10n from '@vscode/l10n';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { WorkMode } from '../../../src/shared/model';
import { dismissOutside } from '../selectors/dismissOutside';
import { BoltIcon, PersonIcon } from './icons';

/** `id` of the menu, referenced by the `aria-controls` of the pill. One prompt per document. */
const MENU_ID = 'work-mode-menu';

/** Marks the pill so a pointer-down on it is not read as "outside" (see `dismissOutside`). */
const TRIGGER_SELECTOR = '[data-work-mode-trigger]';

/** The two modes in the order the menu lists them. */
const MODES: readonly WorkMode[] = ['manual', 'auto'];

/** Short name of a mode ("Manual" / "Auto"), translated on each render. */
function modeLabel(mode: WorkMode): string {
  return mode === 'auto' ? l10n.t('Auto') : l10n.t('Manual');
}

/**
 * What a mode does, for the menu. The Auto text lists the five things the host
 * does not approve for the user when it recognises them (decisions of Sergio, 07/11/2026: reading
 * secrets, going outside the project, deleting, destructive shell commands, publishing or pushing;
 * `keepsForUser` in `workMode.ts` is the list, and the shell check is a heuristic blacklist, hence
 * "those it recognises as") and says that the agent's questions still arrive; no text promises
 * "never".
 */
function modeHint(mode: WorkMode): string {
  return mode === 'auto'
    ? l10n.t(
        "Approves opencode's permission requests for you, except those it recognises as reading secrets, going outside the project, deleting, destructive commands or publishing or pushing. The agent's questions still reach you.",
      )
    : l10n.t("Asks whenever opencode's permission rules ask.");
}

/**
 * The work-mode pill of the prompt bar (E3-work-mode), left of Send: a person icon and "Manual", or
 * a bolt and "Auto", and a two-option menu to switch. The host owns the mode; this component only
 * shows `mode` and calls `onSelect` (the parent posts `workMode.set`), so a click never assumes its
 * own outcome: the pill changes when the next `workMode.state` arrives.
 *
 * Same menu-button pattern as `PlusMenu`, but the items are `role="menuitemradio"` with
 * `aria-checked`, each with a description. Opening puts the focus on the checked item; arrows wrap,
 * Home/End jump, Enter/Space choose (the native button click). Escape closes with
 * `preventDefault` + `stopPropagation` (the prompt box stops the turn on Escape while busy) and
 * returns the focus to the pill; Tab closes and lets the focus move on; a pointer-down outside, the
 * focus leaving or the window blurring close without moving the focus. Shift+Tab is never
 * intercepted (WCAG 2.1.2), and there is no shortcut hint: the toggle lives in the command palette
 * (decision 6 of Sergio). Without a connection the pill and items are `aria-disabled`, never
 * `disabled`. Under 200 px only the icon stays (CSS); the accessible name "Work mode: Auto" does not
 * change. Choosing the mode already set only closes the menu.
 * VERIFIED by `WorkModeMenu.test.tsx` in jsdom (ARIA, keys, `document.activeElement`, Escape spy on
 * `window`). VERIFIED on Windows 11, VS Code 1.145.2 (07/11/2026) by `test:visual` step 44 with the
 * real mouse and keyboard: "Escape closes the menu and returns the focus to the pill", "Escape on
 * the open menu closes it and does NOT stop the running turn", "Shift+Tab from the prompt moves the
 * focus to an element before it", "Tab from the prompt reaches the pill before Send", and, in the
 * four themes at 300 px, wide and under 200 px, "the pill text has contrast >= 4.5", "the bolt icon
 * has contrast >= 3 against the pill" and "only the icon shows and the accessible name stays". The
 * first design (a bolt in `--vscode-editorWarning-foreground`) measured 2.47:1 in Default Light
 * Modern and was replaced by a warning border (see `index.css`). macOS, Linux and a screen reader
 * were not observed.
 */
export function WorkModeMenu(props: {
  mode: WorkMode;
  /** True when there is no connection: the pill and the items stay focusable but do nothing. */
  disabled: boolean;
  onSelect(mode: WorkMode): void;
  /**
   * Hands the parent a function that closes the menu without touching the focus, for when the
   * parent moves the focus by code (the webview document may not own it, so no `focusout` fires).
   */
  onCloseReady?(close: () => void): void;
}) {
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;
  props.onCloseReady?.(() => {
    setOpen(false);
  });

  const items = (): HTMLButtonElement[] => [
    ...(menu?.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]') ?? []),
  ];

  /** Closes the menu; `restoreFocus` puts the focus back on the pill. */
  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) trigger?.focus();
  };

  /** Opens the menu with the focus on the checked item (or the last one for ArrowUp). */
  const openMenu = (last: boolean): void => {
    setOpen(true);
    const list = items();
    (last ? list[list.length - 1] : list[MODES.indexOf(props.mode)])?.focus();
  };

  const choose = (mode: WorkMode): void => {
    if (props.disabled) return;
    close(true);
    if (mode !== props.mode) props.onSelect(mode);
  };

  const onTriggerKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && open()) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !props.disabled) {
      event.preventDefault();
      if (open()) {
        const list = items();
        (event.key === 'ArrowDown' ? list[0] : list[list.length - 1])?.focus();
      } else {
        openMenu(event.key === 'ArrowUp');
      }
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent): void => {
    const list = items();
    const index = list.findIndex((item) => item === document.activeElement);
    const go = (next: number): void => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        // The default action then moves on from the pill (backwards too), so the focus never
        // drops to the page and Shift+Tab is not trapped.
        close(true);
        break;
      case 'ArrowDown':
        go(index + 1);
        break;
      case 'ArrowUp':
        go(index < 0 ? list.length - 1 : index - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(list.length - 1);
        break;
      default:
    }
  };

  // The focus leaving the webview altogether fires `blur` on the window but no `focusout` with a
  // target; a menu left open there would be an orphan (same reasoning as `PlusMenu`).
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
    () => menu,
    TRIGGER_SELECTOR,
    () => {
      close(false);
    },
  );

  return (
    <div class="plus-wrap work-mode-wrap">
      <button
        type="button"
        class="secondary work-mode-pill"
        data-work-mode-trigger
        data-mode={props.mode}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-controls={MENU_ID}
        aria-disabled={props.disabled ? 'true' : undefined}
        aria-label={l10n.t('Work mode: {0}', modeLabel(props.mode))}
        title={l10n.t('Work mode: {0}', modeLabel(props.mode))}
        ref={(element) => {
          trigger = element;
        }}
        onKeyDown={onTriggerKeyDown}
        onClick={() => {
          // `aria-disabled`, not `disabled` (lesson #981): the click is simply ignored.
          if (props.disabled) return;
          if (open()) close(false);
          else openMenu(false);
        }}
      >
        <span class="work-mode-icon">
          <Show when={props.mode === 'auto'} fallback={<PersonIcon />}>
            <BoltIcon />
          </Show>
        </span>
        <span class="work-mode-text">{modeLabel(props.mode)}</span>
      </button>
      <Show when={open()}>
        <div
          id={MENU_ID}
          class="plus-menu work-mode-menu"
          role="menu"
          aria-label={l10n.t('Work mode')}
          ref={(element) => {
            menu = element;
          }}
          onKeyDown={onMenuKeyDown}
          onFocusOut={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || menu?.contains(next) || trigger?.contains(next)) return;
            close(false);
          }}
        >
          <For each={MODES}>
            {(mode) => (
              <button
                type="button"
                role="menuitemradio"
                class="plus-item work-mode-item"
                tabIndex={mode === props.mode ? 0 : -1}
                aria-checked={mode === props.mode}
                aria-disabled={props.disabled ? 'true' : undefined}
                onClick={() => {
                  choose(mode);
                }}
              >
                <span class="work-mode-item-label">{modeLabel(mode)}</span>
                <span class="work-mode-item-hint">{modeHint(mode)}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
