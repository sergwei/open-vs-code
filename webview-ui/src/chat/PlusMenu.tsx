import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { dismissOutside } from '../selectors/dismissOutside';
import { PlusIcon } from './icons';

/** `id` of the menu, referenced by the `aria-controls` of the "+" button. One prompt per document. */
const MENU_ID = 'plus-menu';

/** Marks the "+" button so a pointer-down on it is not read as "outside" (see `dismissOutside`). */
const TRIGGER_SELECTOR = '[data-plus-trigger]';

/** The four actions of the menu, in the order they are listed (decision P11=1 for the image one). */
type Action = 'selection' | 'file' | 'image' | 'mention';

const ITEMS: readonly { action: Action; label: string; hint?: string }[] = [
  {
    action: 'selection',
    label: 'Add selection',
    hint: 'Add the selected lines of the active editor, or the whole file when nothing is selected',
  },
  { action: 'file', label: 'Attach file…', hint: 'Hold Shift to drop files from the Explorer' },
  { action: 'image', label: 'Attach image…' },
  { action: 'mention', label: 'Mention a file' },
];

/**
 * The "+" button of the prompt bar and its menu (E2, issue #85, phase 4): Add selection, Attach
 * file…, Attach image… and Mention a file. It replaces the two loose text buttons "Add selection"
 * and "Attach", which stood where this one stands (decision of Sergio on the sketch D3).
 *
 * WAI-ARIA menu button: the trigger has `aria-haspopup="menu"`, `aria-expanded` and
 * `aria-controls`; the menu is `role="menu"` with `role="menuitem"` buttons in a roving tab stop.
 * Opening with the mouse or Enter/Space puts the focus on the first item; ArrowDown/ArrowUp on the
 * closed trigger open it on the first/last item. Arrows wrap, Home/End jump, Enter/Space activate
 * (the native button click). Escape closes with `preventDefault` + `stopPropagation` (the prompt
 * box stops the turn on Escape while busy) and returns the focus to the trigger; Tab closes and
 * lets the focus move on from the trigger; a pointer-down outside closes without moving the focus,
 * and so does the focus leaving for another element or the window losing the focus (a shortcut of
 * issue #35 that takes the focus must not leave an orphan menu). Without a connection the trigger and the items are
 * `aria-disabled`, never `disabled` (a disabled button that holds the focus throws it onto the
 * page, lesson #981), and the parent can close it through `onCloseReady` when it moves the focus by
 * code (a shortcut of issue #35 while the webview document does not own the focus fires no
 * `focusout`). No shortcut hint is shown (decision P16=1: Add selection has no shortcut).
 * Choosing an item closes the menu and then calls the matching callback; the focus goes back to
 * the trigger except for "Mention a file", whose callback moves it to the prompt box itself.
 * VERIFIED on Windows 11, VS Code 1.143.1 (27/10/2026) by `npm run test:visual`: "Enter opens the
 * menu with its four items and the focus on the first", "Escape closes the menu and returns the
 * focus to the button", "Tab closes the menu and the focus does not fall to the page", "Control+Alt+P
 * with the "+" menu open moves the focus to the editor and closes the menu" and, at compact (bar
 * 170 px), "the menu opens inside the view". macOS, Linux and a screen reader were not observed;
 * `PlusMenu.test.tsx` covers the keys and ARIA in jsdom with `document.activeElement`.
 */
export function PlusMenu(props: {
  /** True when there is no connection: the button and the items stay focusable but do nothing. */
  disabled: boolean;
  onAddSelection(): void;
  onAttachFile(): void;
  onAttachImage(): void;
  onMention(): void;
  /**
   * Hands the parent a function that closes the menu without touching the focus. The parent calls it
   * when it moves the focus itself (a shortcut of issue #35): the webview document may not own the
   * focus at that moment, and then the browser fires no `focusout`, so the menu would stay open.
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
    ...(menu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []),
  ];

  /** Closes the menu; `restoreFocus` puts the focus back on the "+" button. */
  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) trigger?.focus();
  };

  /** Opens the menu and focuses the first (or last) item; the items exist as soon as Solid renders. */
  const openMenu = (last: boolean): void => {
    setOpen(true);
    const list = items();
    (last ? list[list.length - 1] : list[0])?.focus();
  };

  const run = (action: Action): void => {
    if (props.disabled) return;
    close(action !== 'mention');
    if (action === 'selection') props.onAddSelection();
    else if (action === 'file') props.onAttachFile();
    else if (action === 'image') props.onAttachImage();
    else props.onMention();
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

  // The focus leaving the webview altogether (a shortcut of issue #35 that sends it to the editor, a
  // click in the workbench) fires `blur` on the window but no `focusout` with a target, which the
  // handler on the menu ignores on purpose: a menu left open there is an orphan.
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
        data-plus-trigger
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-controls={MENU_ID}
        aria-disabled={props.disabled ? 'true' : undefined}
        aria-label="Add context"
        title="Add context: selection, files, images or a mention"
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
        <PlusIcon />
      </button>
      <Show when={open()}>
        <div
          id={MENU_ID}
          class="plus-menu"
          role="menu"
          aria-label="Add context"
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
          <For each={ITEMS}>
            {(item, index) => (
              <button
                type="button"
                role="menuitem"
                class="plus-item"
                tabIndex={index() === 0 ? 0 : -1}
                aria-disabled={props.disabled ? 'true' : undefined}
                title={item.hint}
                onClick={() => {
                  run(item.action);
                }}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
