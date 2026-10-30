// Pure bookkeeping for one race of the chat tabs (issue #77, E3, review 1 W3): the focus a tab asks
// for is given AFTER its document loads (`flushUiCommands` -> `focusView` -> `revealSurface`), tens
// to hundreds of milliseconds after the click that asked for it. With a Sessions tree where clicking
// two rows within a second is normal, that late reveal would pull the first tab in front of the
// second one the user had already chosen. No `vscode`, no I/O, so Vitest drives it with plain calls.

/**
 * Orders the reveals of chat surfaces so a late "give the focus" can tell it was overtaken.
 *
 * A logical clock ticks on every reveal asked by someone and on every focus request queued for a
 * surface. When the document of surface A is ready, its focus request still stands unless ANOTHER
 * surface was revealed after A's request was queued. A reveal of A itself, asked by someone, resets
 * A's request: it is fresher than the one that was waiting. The late reveal made by the focus
 * itself is NOT noted (it would overtake the requests of the surfaces still loading).
 *
 * KNOWN LIMITATION (review 2, W2, decided 30/10/2026): only the reveals made by OUR code are
 * noted. A manual click on a tab of the tab strip (or on a text editor) after a row click is not
 * seen, so the late reveal of the row's tab can still steal the front from it.
 *
 * VERIFIED by `revealOrder.test.ts` (Vitest, Windows 11, 29/10/2026): "drops the late focus of a tab
 * when another one was revealed after it was queued" and the cases around it. UNVERIFIED end to end:
 * in the full `test:visual` run the late reveal of the first tab came BEFORE the click on the second
 * one, so no focus was dropped, and the "B1 a second click…" check passes with or without
 * `RevealOrder`. To see it, log a dropped focus while two rows are clicked with no pause.
 */
export class RevealOrder {
  private clock = 0;
  private readonly revealedAt = new Map<number, number>();
  private readonly focusQueuedAt = new Map<number, number>();

  /** Someone revealed surface `paneId` on purpose; its own waiting focus request, if any, is void. */
  noteReveal(paneId: number): void {
    this.revealedAt.set(paneId, ++this.clock);
    this.focusQueuedAt.delete(paneId);
  }

  /** A focus request for `paneId` was queued (it will be answered when its document is ready). */
  queueFocus(paneId: number): void {
    this.focusQueuedAt.set(paneId, ++this.clock);
  }

  /**
   * Whether the focus request of `paneId` may still reveal its surface. `false` only when it was
   * queued and another surface was revealed after that; a surface with no queued request (a focus
   * asked by a compose or by the setup) is always allowed, as before.
   */
  focusStillWanted(paneId: number): boolean {
    const queued = this.focusQueuedAt.get(paneId);
    if (queued === undefined) return true;
    for (const [id, at] of this.revealedAt) {
      if (id !== paneId && at > queued) return false;
    }
    return true;
  }

  /** Forgets a surface that no longer exists. */
  forget(paneId: number): void {
    this.revealedAt.delete(paneId);
    this.focusQueuedAt.delete(paneId);
  }
}
