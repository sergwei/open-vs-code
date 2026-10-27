import { onCleanup, onMount } from 'solid-js';

/**
 * Closes a non-modal panel when the pointer goes down anywhere outside it (issues #23/#24), the
 * same rule as `SessionPicker`: the click that lands on the panel's own trigger is ignored because
 * the trigger toggles the panel by itself (closing here too would reopen it), and the focus is NOT
 * moved, since the user already chose where to go. Registers a capture-phase `pointerdown` listener
 * on mount and removes it on cleanup, so call it from the panel's component body.
 * VERIFIED by `AgentModelMenu.test.tsx` in jsdom (a `pointerdown` event is dispatched by hand: the
 * check "a pointer-down outside closes the panel and does not move the focus"), and for the model
 * panel of the old picker in a real VS Code 1.143.0 on Windows 11 (run of 21/10/2026): `test:visual`
 * step 11 opened the panel, pressed the prompt box with the real mouse and asserted that the panel
 * closed, the model stayed and the focus stayed in the prompt box. VERIFIED for the combined chip
 * panel in VS Code 1.143.1 on Windows 11 (27/10/2026) by the visual checks "a press outside closes
 * the panel and keeps the model" and "a press outside closes the panel and keeps the variant".
 * UNVERIFIED on macOS and Linux.
 */
export function dismissOutside(
  panel: () => HTMLElement | undefined,
  triggerSelector: string,
  close: () => void,
): void {
  const onPointer = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Node) || panel()?.contains(target)) return;
    if (target instanceof Element && target.closest(triggerSelector) !== null) return;
    close();
  };
  onMount(() => {
    document.addEventListener('pointerdown', onPointer, true);
  });
  onCleanup(() => {
    document.removeEventListener('pointerdown', onPointer, true);
  });
}
