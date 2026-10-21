import {
  createSignal,
  ErrorBoundary,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import type { MessageInfo } from '../../../src/shared/model';
import type { OpenView } from '../store/chatStore';
import { isStopError } from '../store/activity';
import { PartView } from './PartView';

type AssistantMessage = Extract<MessageInfo, { kind: 'assistant' }>;

/** How close to the bottom (px) still counts as "at the bottom". Our own figure: about a line. */
const STICK_THRESHOLD_PX = 24;

/**
 * Narrowing helpers for `<Match when>`: the message itself when it has that `kind`, else
 * `undefined`. Written as functions because a Solid component runs once and a `kind` check in
 * the body would freeze.
 */
const asUser = (message: MessageInfo) => (message.kind === 'user' ? message : undefined);
const asAssistant = (message: MessageInfo): AssistantMessage | undefined =>
  message.kind === 'assistant' ? message : undefined;
const asNotice = (message: MessageInfo) => (message.kind === 'notice' ? message : undefined);

/** True when the user asked for less motion (OS setting or VS Code's `workbench.reduceMotion`). */
function prefersReducedMotion(): boolean {
  const media =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return media || document.body.classList.contains('vscode-reduce-motion');
}

/**
 * The conversation: a `role="log"` region with one block per message and, for the assistant,
 * one per content part, that follows the end while the user has not scrolled up.
 *
 * `<For>` iterates the store's own objects, so a message or part that is updated in place keeps
 * its DOM (the store reconciles instead of replacing). `aria-busy` is set on the last assistant
 * message while the session is busy, the pattern of the solid-webview skill §7 to avoid
 * announcing every token (HYPOTHESIS: screen readers honor it; not tested with one). A message
 * is `live` (its Markdown is re-rendered only at the tail) while the session is busy, it is the
 * last assistant message and it has no `completedAt`. Each message sits in its own
 * `<ErrorBoundary>` so one that fails to render does not blank the chat.
 *
 * Following the end: `stick` is true while the scroll position is within
 * {@link STICK_THRESHOLD_PX} of the bottom, and a `MutationObserver` on the list scrolls down
 * after every change when it is. Following is instant on purpose: a smooth scroll fires `scroll`
 * events from the middle of the animation, which would read as "the user left the bottom" and
 * stop the follow. Only the "Jump to latest" button scrolls smoothly, and not under reduced
 * motion. An error of the assistant message shows in line, with Retry on the last message only.
 * When that error is `aborted` (`isStopError`: a step cut short by Stop, a Reject or a closing
 * location) the block is the neutral "Stopped" note instead (no red, no `role="alert"`; the
 * server's text "Step interrupted" is not shown), and it keeps the same secondary Retry so the
 * cut prompt can be re-run in one click. Any other error stays the red alert with its code.
 * VERIFIED by `App.test.tsx` for the rendering; the scrolling is UNVERIFIED (jsdom has no layout):
 * check it with the F5 (points 2 and 6).
 */
export function MessageList(props: {
  open: OpenView;
  busy: boolean;
  canRetry: boolean;
  onRetry(): void;
}) {
  let list: HTMLDivElement | undefined;
  const [stick, setStick] = createSignal(true);

  const isLast = (id: string): boolean =>
    props.open.messages[props.open.messages.length - 1]?.id === id;
  const isLive = (message: AssistantMessage): boolean =>
    props.busy && isLast(message.id) && message.completedAt === undefined;

  const atBottom = (element: HTMLElement): boolean =>
    element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_THRESHOLD_PX;

  onMount(() => {
    const element = list;
    if (element === undefined) return;
    const observer = new MutationObserver(() => {
      if (stick()) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    element.scrollTop = element.scrollHeight;
    onCleanup(() => observer.disconnect());
  });

  // True while the smooth scroll of "Jump to latest" runs: its intermediate `scroll` events must
  // not be read as "the user left the bottom". Cleared on `scrollend`, on reaching the bottom, or
  // by the safety timer (a browser without `scrollend`, or an animation that never fires it).
  let programmatic = false;
  let programmaticTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (programmaticTimer !== undefined) clearTimeout(programmaticTimer);
  });
  const endProgrammatic = (element: HTMLElement): void => {
    programmatic = false;
    if (programmaticTimer !== undefined) clearTimeout(programmaticTimer);
    programmaticTimer = undefined;
    setStick(atBottom(element));
  };

  /**
   * Scrolls to the end and resumes following. With motion allowed the scroll is smooth and
   * `scroll` events are ignored until it ends (see `programmatic`); under reduced motion it is
   * instant. The 1000 ms safety timer is our own figure (a smooth scroll over a long chat takes
   * a few hundred ms). UNVERIFIED in a real webview: jsdom has no layout (F5 point 2).
   */
  const jumpToLatest = (): void => {
    const element = list;
    if (element === undefined) return;
    setStick(true);
    if (prefersReducedMotion()) {
      element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
      return;
    }
    programmatic = true;
    if (programmaticTimer !== undefined) clearTimeout(programmaticTimer);
    programmaticTimer = setTimeout(() => {
      endProgrammatic(element);
    }, 1000);
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div class="message-list-wrapper">
      <div
        class="message-list"
        role="log"
        aria-label="Conversation"
        ref={(element) => {
          list = element;
        }}
        onScroll={(event) => {
          if (programmatic) {
            if (atBottom(event.currentTarget)) endProgrammatic(event.currentTarget);
            return;
          }
          setStick(atBottom(event.currentTarget));
        }}
        on:scrollend={(event) => {
          if (programmatic) endProgrammatic(event.currentTarget);
        }}
      >
        <For each={props.open.messages}>
          {(message) => (
            <ErrorBoundary
              fallback={<div class="message-error">This message could not be displayed.</div>}
            >
              <Switch>
                <Match when={asUser(message)}>
                  {(user) => (
                    <article class="message message-user">
                      <div class="part-text">{user().text}</div>
                      <Show when={user().files.length > 0}>
                        <ul class="message-files" aria-label="Attached files">
                          <For each={user().files}>
                            {(file) => <li class="chip">{file.name ?? file.uri ?? file.mime}</li>}
                          </For>
                        </ul>
                      </Show>
                    </article>
                  )}
                </Match>
                <Match when={asAssistant(message)}>
                  {(assistant) => (
                    <article
                      class="message message-assistant"
                      aria-busy={props.busy && isLast(assistant().id)}
                    >
                      <For each={props.open.parts[assistant().id] ?? []}>
                        {(part) => <PartView part={part} live={isLive(assistant())} />}
                      </For>
                      <Show when={assistant().error}>
                        {(error) => (
                          <div
                            classList={{
                              alert: !isStopError(error()),
                              'alert-error': !isStopError(error()),
                              'stopped-note': isStopError(error()),
                            }}
                            role={isStopError(error()) ? undefined : 'alert'}
                          >
                            <span class="alert-text">
                              {isStopError(error())
                                ? 'Stopped'
                                : `Error (${error().code}): ${error().message}`}
                            </span>
                            <Show when={isLast(assistant().id) && props.canRetry && !props.busy}>
                              <button
                                type="button"
                                class="secondary"
                                onClick={() => props.onRetry()}
                              >
                                Retry
                              </button>
                            </Show>
                          </div>
                        )}
                      </Show>
                    </article>
                  )}
                </Match>
                <Match when={asNotice(message)}>
                  {(notice) => <div class="message-notice">{notice().text}</div>}
                </Match>
              </Switch>
            </ErrorBoundary>
          )}
        </For>
      </div>
      <Show when={!stick()}>
        <button type="button" class="secondary jump-latest" onClick={jumpToLatest}>
          Jump to latest
        </button>
      </Show>
    </div>
  );
}
