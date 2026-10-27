/**
 * Lets the notification code ask "is the chat on screen and able to show the problem?" without
 * knowing the chat (no `vscode` here, so it is unit-tested).
 *
 * E2 (issue #85, decision P3=2 of Sergio, 27/10/2026): the setup guide and the error card already
 * say what failed and offer the buttons, so a native notification with the same buttons only
 * duplicates them while the chat is showing. The server lifecycle and the binary detection are
 * registered BEFORE the chat, hence a gate that starts closed and is wired later.
 */
export interface ChatSurfaceGate {
  /** Called once by `registerChat`: `showing` is true while a webview is visible AND has sent `ready`. */
  attach(showing: () => boolean): void;
  /** True only when a chat surface is attached and is showing; false before `attach`. */
  isShowing(): boolean;
}

/** Creates a gate that reports "not showing" until {@link ChatSurfaceGate.attach} is called. */
export function createChatSurfaceGate(): ChatSurfaceGate {
  let showing: () => boolean = () => false;
  return {
    attach(next) {
      showing = next;
    },
    isShowing: () => showing(),
  };
}

/**
 * Runs `notify` unless `chatShowsProblem()` says the chat is already showing the failure; returns
 * whether it ran.
 *
 * The race it guards: the chat may be hidden, or visible but not yet `ready`, at the instant the
 * failure happens. Then the answer is false and the native notification appears (a duplicate at
 * worst, never a lost failure); a chat that becomes ready later receives the connection state in
 * its snapshot. The opposite error (suppressing while the webview will not paint it) cannot
 * happen through this gate because `showing` requires `ready`, which the host resets whenever the
 * view hides (`chatViewProvider.ts`). HYPOTHESIS for the window between `ready` being true and the
 * view being destroyed without a visibility event: not observed.
 * VERIFIED by `chatSurfaceGate.test.ts` for the decision only; the real notification being
 * silenced in a VS Code window is UNVERIFIED.
 */
export function notifyUnlessChatShows(
  chatShowsProblem: () => boolean,
  notify: () => void,
): boolean {
  if (chatShowsProblem()) return false;
  notify();
  return true;
}
