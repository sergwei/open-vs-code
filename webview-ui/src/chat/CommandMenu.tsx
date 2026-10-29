import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { CommandOption } from '../../../src/shared/model';
import { dismissOutside } from '../selectors/dismissOutside';
import { COMMAND_STATUS_TEXT, commandStatus, type CommandStatus } from './CommandPopup';
import { SlashIcon } from './icons';

/** `id` of the menu, referenced by the `aria-controls` of the button. One prompt per document. */
const MENU_ID = 'command-menu';

/** Marks the button so a pointer-down on it is not read as "outside" (see `dismissOutside`). */
const TRIGGER_SELECTOR = '[data-command-trigger]';

/**
 * The "/" button of the prompt bar and its menu of the server's slash commands (issue #33,
 * decisions P1=1 and P6=1 of Sergio, 28/10/2026, Engram #1416). It stands right of the "+" and is
 * its twin: same WAI-ARIA menu button (see {@link PlusMenu}), same classes, same keys. The trigger
 * has `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`; the menu is `role="menu"` with a
 * `role="menuitem"` button per command in a roving tab stop. Opening with the mouse or
 * Enter/Space focuses the first item; ArrowDown/ArrowUp on the closed trigger open it on the
 * first/last. Arrows wrap, Home/End jump. Escape closes with `preventDefault` + `stopPropagation`
 * (the prompt box stops the turn on Escape while busy) and gives the focus back to the trigger; Tab
 * closes and lets the focus move on; a pointer-down outside, the focus leaving or the window
 * blurring close without moving the focus. Without a connection the trigger and the items are
 * `aria-disabled`, never `disabled` (lesson #981). There is no search box (decision P6=1): a long
 * list scrolls (`max-height`) and typing `/` filters.
 * Each row is `/name` and the description (ellipsis, whole in `title`). Choosing one closes the
 * menu and calls `onPick(name)`; the parent writes `/name ` into the draft and moves the focus to
 * the prompt box, so this menu does not restore it to the trigger. Without commands the menu holds
 * ONE `role="menuitem"` with `aria-disabled="true"` that says why ("Loading commands…" when no
 * catalog arrived yet, "Commands could not be loaded" for a catalog without the list, "No commands
 * available" for an empty one; decision of Sergio, Engram #1425): it takes the focus so a screen
 * reader announces it, Enter and a click do nothing, Escape gives the focus back to the button.
 * VERIFIED by `CommandMenu.test.tsx` in jsdom with `document.activeElement`, and in a real VS Code
 * (Windows 11, VS Code 1.144.0, 28/10/2026) by the `test:visual` checks "C1 the menu opens inside
 * the view with the four commands" and "C4 Escape closes the menu and returns the focus to the "/"
 * button" (the first in the four themes and three widths: 12 `ok` lines; a full run of 28/10/2026
 * ended with 1193 `ok`, 0 FAIL). UNVERIFIED: a screen reader, and the three state items in a real
 * window (the fake server always answers the catalog with commands).
 */
export function CommandMenu(props: {
  /** The catalog's commands; `undefined` when they could not be read (or the catalog is loading). */
  commands: readonly CommandOption[] | undefined;
  /** True while the catalog has not arrived: an absent list then means "loading", not "failed". */
  loading?: boolean;
  /** True when there is no connection: the button and the items stay focusable but do nothing. */
  disabled: boolean;
  onPick(name: string): void;
  /** Hands the parent a function that closes the menu without touching the focus. */
  onCloseReady?(close: () => void): void;
}) {
  const [open, setOpen] = createSignal(false);
  /** `list` when there are commands to pick; otherwise which state the single disabled item names. */
  const status = () => commandStatus('', props.commands, props.loading);
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;
  props.onCloseReady?.(() => {
    setOpen(false);
  });

  const items = (): HTMLButtonElement[] => [
    ...(menu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []),
  ];

  /** Closes the menu; `restoreFocus` puts the focus back on the "/" button. */
  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) trigger?.focus();
  };

  /** Opens the menu and focuses the first (or last) item, when there is one. */
  const openMenu = (last: boolean): void => {
    setOpen(true);
    const list = items();
    (last ? list[list.length - 1] : list[0])?.focus();
  };

  const run = (name: string): void => {
    if (props.disabled) return;
    close(false);
    props.onPick(name);
  };

  const onTriggerKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && open()) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab' && open()) {
      close(false);
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
        // The default action then moves on from the trigger, so the focus never drops to the page.
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
  // target; a menu left open there is an orphan (same reason as the "+" menu).
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
    <div class="plus-wrap">
      <button
        type="button"
        class="secondary plus-trigger"
        data-command-trigger
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-controls={MENU_ID}
        aria-disabled={props.disabled ? 'true' : undefined}
        aria-label="Commands"
        title="Run a slash command"
        ref={(element) => {
          trigger = element;
        }}
        onKeyDown={onTriggerKeyDown}
        onClick={() => {
          // `aria-disabled`, not `disabled` (see the header): the click is simply ignored.
          if (props.disabled) return;
          if (open()) close(false);
          else openMenu(false);
        }}
      >
        <SlashIcon />
      </button>
      <Show when={open()}>
        <div
          id={MENU_ID}
          class="plus-menu command-menu"
          role="menu"
          aria-label="Slash commands"
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
          <Show
            when={status() === 'list' && props.commands}
            fallback={
              // The state as the ONLY menuitem, so a screen reader announces it and the focus has
              // somewhere to be (a menu without items says nothing). Enter and click do nothing.
              <button
                type="button"
                role="menuitem"
                class="plus-item command-item command-menu-status"
                tabIndex={0}
                aria-disabled="true"
              >
                {COMMAND_STATUS_TEXT[status() as Exclude<CommandStatus, 'list'>]}
              </button>
            }
          >
            {(list) => (
              <For each={list()}>
                {(command, index) => (
                  <button
                    type="button"
                    role="menuitem"
                    class="plus-item command-item"
                    tabIndex={index() === 0 ? 0 : -1}
                    aria-disabled={props.disabled ? 'true' : undefined}
                    title={command.description}
                    onClick={() => {
                      run(command.name);
                    }}
                  >
                    <span class="command-name">{`/${command.name}`}</span>
                    <span class="command-description">{command.description}</span>
                  </button>
                )}
              </For>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
