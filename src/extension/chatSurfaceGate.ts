/**
 * How long a native failure notification waits for the chat to become ready before it is shown.
 *
 * E2 (issue #87, decision P-A=1 of Sergio, 28/10/2026). 3 s was chosen by the planner as a margin
 * over the gap between the failure and `webview ready`. VERIFIED on Windows 11, VS Code 1.144.0
 * (28/10/2026), full `npm run test:visual` (exit 0): the log line "binary detection: native
 * notification withheld: the chat showed the problem 255 ms later" on a warm start. The gap
 * itself is about 202 ms: it is read from the timestamps of the same log, "binary detection:
 * setting …: invalid" at 19:30:55.355 and "webview ready" at 19:30:55.557. It differs from the
 * logged 255 ms; why (where the logged wait starts) was not checked. HYPOTHESIS: that 3 s also
 * covers a cold first load on a slow machine; it would be checked by timing "Chat view resolved" to "webview ready" on a cold profile. Cost
 * accepted by Sergio: with the view closed the notification arrives this much later than before.
 */
export const CHAT_SHOW_GRACE_MS = 3000;

/**
 * Lets the notification code ask "is the chat on screen and able to show the problem?" without
 * knowing the chat (no `vscode` here, so it is unit-tested).
 *
 * E2 (issue #85, decision P3=2 of Sergio, 27/10/2026): the setup guide and the error card already
 * say what failed and offer the buttons, so a native notification with the same buttons only
 * duplicates them while the chat is showing. The server lifecycle and the binary detection are
 * registered BEFORE the chat, hence a gate that starts closed and is wired later.
 * Issue #87 adds {@link ChatSurfaceGate.changed} and {@link ChatSurfaceGate.whenShowing}: a
 * failure can happen before the chat's `ready`, so the notification waits a grace period for it.
 */
export interface ChatSurfaceGate {
  /** Called once by `registerChat`: `showing` is true while a webview is visible AND has sent `ready`. */
  attach(showing: () => boolean): void;
  /** True only when a chat surface is attached and is showing; false before `attach`. */
  isShowing(): boolean;
  /** The chat may have started showing (its `ready` arrived): wakes the pending `whenShowing`. */
  changed(): void;
  /**
   * Resolves `true` as soon as the chat is showing (at once if it already is), `false` after
   * `ms` milliseconds without it. Woken only by {@link ChatSurfaceGate.changed}, no polling; the
   * timer and the waiter are always cleared when it resolves.
   */
  whenShowing(ms: number): Promise<boolean>;
}

/** Creates a gate that reports "not showing" until {@link ChatSurfaceGate.attach} is called. */
export function createChatSurfaceGate(): ChatSurfaceGate {
  let showing: () => boolean = () => false;
  const waiters = new Set<(shown: boolean) => void>();
  return {
    attach(next) {
      showing = next;
    },
    isShowing: () => showing(),
    changed() {
      if (!showing()) return;
      for (const wake of [...waiters]) wake(true);
    },
    whenShowing(ms) {
      if (showing()) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const wake = (shown: boolean): void => {
          clearTimeout(timer);
          waiters.delete(wake);
          resolve(shown);
        };
        const timer = setTimeout(() => {
          wake(false);
        }, ms);
        waiters.add(wake);
      });
    },
  };
}

/** What {@link notifyUnlessChatShows} needs to decide; every field is a seam for the unit test. */
export interface NotifyUnlessChatShowsOptions {
  /** The gate to wait on; `undefined` (no chat registered) means nothing can show the problem. */
  gate: Pick<ChatSurfaceGate, 'isShowing' | 'whenShowing'> | undefined;
  /** True when the chat shows THIS problem itself (a card or the guide), evaluated again after the wait. */
  showsProblem: () => boolean;
  /** False when a newer result or transition replaced the one that triggered the call. */
  stillCurrent: () => boolean;
  /** Longest wait for the chat's `ready`, in ms ({@link CHAT_SHOW_GRACE_MS}). */
  graceMs: number;
  /** Shows the native notification; called at most once. */
  notify: () => void;
  /** Optional log line: says whether the notification was withheld or shown, never paths or secrets. */
  log?: (message: string) => void;
}

/**
 * Shows the native notification unless the chat shows the failure itself; resolves to whether it
 * was shown.
 *
 * The race (issue #87): the failure can happen while the chat is still resolving (the binary
 * detection takes milliseconds, `ready` more). So if the chat is not showing yet, this waits up to
 * `graceMs` for `ready` ({@link ChatSurfaceGate.whenShowing}), then decides: a result that is no
 * longer current ({@link NotifyUnlessChatShowsOptions.stillCurrent}) shows nothing, a chat that now
 * shows the problem shows nothing, anything else notifies once. A chat that is showing but whose
 * state does not display this problem (`showsProblem` false) notifies at once, without waiting. The
 * wait never loses a failure: when it expires the notification is shown (a duplicate at worst if
 * the chat paints it right after). The opposite error (suppressing while the webview will not
 * paint it) cannot happen through this gate because `isShowing` requires `ready`, which the host
 * resets whenever the view hides (`chatViewProvider.ts`). HYPOTHESIS for the window between `ready`
 * being true and the view being destroyed without a visibility event: not observed.
 * VERIFIED by `chatSurfaceGate.test.ts` (fake timers) for the decision only: "shows the
 * notification once, exactly when the grace period ends without a ready" and "shows nothing when
 * the chat becomes ready within the grace period"; with `CHAT_SHOW_GRACE_MS` at 0, 3 of the 9
 * tests failed (28/10/2026). In a real window (Windows 11, VS Code 1.144.0, 28/10/2026, full
 * `npm run test:visual`, exit 0): "ok no native OpenCode warning appears while the setup guide is
 * shown (center read: true; [])" and the log line "withheld: the chat showed the problem 255 ms
 * later". The mutation (FAIL with the grace period at 0) ran with `--steps 0` on the phase 1
 * tree, before the check required a readable center, and was not re-run. The branch "view closed, the notification appears after the grace
 * period" is UNVERIFIED in a real window (only unit-tested).
 */
export async function notifyUnlessChatShows(
  options: NotifyUnlessChatShowsOptions,
): Promise<boolean> {
  const { gate, showsProblem, stillCurrent, graceMs, notify, log } = options;
  if (showsProblem()) {
    log?.('native notification withheld: the chat shows the problem');
    return false;
  }
  if (gate !== undefined && !gate.isShowing()) {
    const startedAt = Date.now();
    await gate.whenShowing(graceMs);
    if (!stillCurrent()) {
      log?.('native notification dropped: a newer result replaced it');
      return false;
    }
    if (showsProblem()) {
      log?.(
        `native notification withheld: the chat showed the problem ${String(Date.now() - startedAt)} ms later`,
      );
      return false;
    }
    log?.('native notification shown (chat not showing the problem after the wait)');
  } else if (!stillCurrent()) {
    return false;
  }
  notify();
  return true;
}
