// Pure logic of the tabs of the request dock (plan `E3-request-tabs`): which tab is active after the
// list of pending requests changes, and where a key press moves inside the tab row. No DOM and no
// `vscode`, so the rules are tested with fabricated ids.

/**
 * Decides which request is the active tab after the pending list changed.
 *
 * Rules, in order: the request somebody explicitly asked for (`requested`: a click, an arrow key,
 * `ui.focus` or the arrival of a request the dock focuses) wins while it is still pending; else the
 * previous active tab stays, BY ID and not by index, because a new permission is inserted before
 * the forms and would otherwise move the active tab under the user (D3); else the active request
 * was resolved and the tab that now sits in its position takes over (the next one, or the new last
 * one when it was the last: D4), which also covers a cascading reject that removes several at
 * once; else the first one. An empty list has no active tab.
 * VERIFIED by `activeTab.test.ts` (fabricated ids): every rule above has its case.
 */
export function resolveActive(
  previousIds: readonly string[],
  currentIds: readonly string[],
  previousActive: string | undefined,
  requested: string | undefined,
): string | undefined {
  if (currentIds.length === 0) return undefined;
  if (requested !== undefined && currentIds.includes(requested)) return requested;
  if (previousActive !== undefined && currentIds.includes(previousActive)) return previousActive;
  const position = previousActive === undefined ? -1 : previousIds.indexOf(previousActive);
  if (position >= 0) return currentIds[Math.min(position, currentIds.length - 1)];
  return currentIds[0];
}

/**
 * Index the focus moves to when `key` is pressed on the tab at `index` of `count` tabs, or
 * `undefined` when the key is not a tab-row key (the caller then leaves the event alone).
 *
 * Arrows wrap around at both ends and Home/End jump to the extremes, as the WAI-ARIA tabs pattern
 * asks. VERIFIED in a real VS Code (Windows 11, `--steps 43` of 07/11/2026): "R4 ArrowRight on
 * the last tab wraps to the first" and "R4 Home goes to the first tab". HYPOTHESIS: no screen
 * reader was available to hear the result.
 */
export function tabKeyTarget(key: string, index: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
