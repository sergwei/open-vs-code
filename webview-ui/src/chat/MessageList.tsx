import {
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import type {
  Catalog,
  FormAsk,
  MessageInfo,
  Part,
  PermissionAsk,
  RequestResolution,
} from '../../../src/shared/model';
import { RequestOutcome } from '../requests/RequestOutcome';
import {
  byToolPart,
  outcomeView,
  toolOutcomeViews,
  unanchoredByMessage,
  type OutcomeView,
} from '../requests/resolutionPlacement';
import { replyMeta } from '../selectors/selection';
import type { OpenView } from '../store/chatStore';
import { isStopError } from '../store/activity';
import { AttachmentOpenButton } from './AttachmentOpenButton';
import { PartView } from './PartView';

type AssistantMessage = Extract<MessageInfo, { kind: 'assistant' }>;
export type UserMessage = Extract<MessageInfo, { kind: 'user' }>;

/**
 * How many characters of a message go into the name of its "Fork from here" button. 60 is long
 * enough to tell two prompts of the same conversation apart (they usually differ in the first
 * words) and short enough that a screen reader does not read a whole paragraph per button. A
 * judgement call, not measured: UNVERIFIED with a real screen reader.
 */
const FORK_LABEL_CHARS = 60;

/**
 * Accessible name of the fork button of `message`: "Fork from here: " plus its first
 * {@link FORK_LABEL_CHARS} characters with whitespace collapsed (an ellipsis when cut), or just
 * "Fork from here" for a message that is only attachments.
 */
function forkLabel(message: UserMessage): string {
  const flat = message.text.replace(/\s+/g, ' ').trim();
  if (flat === '') return 'Fork from here';
  const cut = flat.length > FORK_LABEL_CHARS ? `${flat.slice(0, FORK_LABEL_CHARS)}…` : flat;
  return `Fork from here: ${cut}`;
}

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
 *
 * Answered requests (E3-resolved-history, issues #56/#18): `resolutions` are the host's records for
 * the open session. Under each tool block go the lines of the records that name it, completed with
 * what the block itself says (`toolOutcomeViews`, which also reads a rejection or an answer from a
 * block that has no record, e.g. after a Reload Window); a record without a tool block in this
 * history goes at the end of the latest user/assistant message before it was answered, NESTED in
 * that message's `article` so `[role="log"] > *` (counted by `test:visual`) does not change. The
 * lines never move the focus nor carry a role: the log region announces their insertion.
 *
 * Issues #28/#29: the attachment chips of a USER message are buttons that open the file in the
 * editor (`AttachmentOpenButton`, `editor.open` with the `file:` URL, at the start of its line
 * range) whenever the host kept a `file:` URL for them, so they work after a resync or a Reload
 * Window too; a chip with no such URL is plain text, as before.
 *
 * Issue #21: every USER message ends with an action bar holding "Fork from here" (decision of
 * Sergio, 21/10/2026: user messages only, a text button, shown on hover and on focus within). The
 * bar is hidden with opacity, not `display: none`, so Tab still reaches the button and focusing it
 * shows the bar. The accessible name carries the start of the message (a column of identical
 * "Fork from here" says nothing) and `aria-live="off"` on the bar keeps the log region from reading
 * it out with every new message (HYPOTHESIS: not tried with a screen reader). While `forkDisabled`
 * the button is `aria-disabled` and the click is ignored, never `disabled`, so the focus stays on
 * it. `onOpenSession` is for the subagent links of the tool blocks.
 *
 * Issue #26: each tool block is a collapsible card (`ToolCard`). `requests` is the store's pending
 * permissions and forms; the tool a request names (`tool.partID`) is told it is waiting for
 * approval. Cards stay folded: a card that opens, or a request that appears, adds no child to the
 * log and never moves the focus.
 *
 * Issues #23/#24: every ASSISTANT message starts with a muted line "Agent · model" ("Plan · GLM-5.3
 * Flash Free", from `session.step.started`, named through `catalog`). It took over what the header
 * marker used to show and is the visible proof of what actually answered (decision of 21/10/2026,
 * Engram #1012). It is plain text inside the message's `article`, so it adds no child to the log.
 */
export function MessageList(props: {
  open: OpenView;
  /** Names the agent and model of each reply; ids are shown for the ones it does not know. */
  catalog: Catalog | undefined;
  resolutions: { readonly [requestId: string]: RequestResolution };
  /** Pending permissions and forms; the tool each one names shows "waiting for approval". */
  requests: { readonly permissions: readonly PermissionAsk[]; readonly forms: readonly FormAsk[] };
  busy: boolean;
  canRetry: boolean;
  forkDisabled: boolean;
  onRetry(): void;
  onFork(message: UserMessage): void;
  onOpenSession(sessionID: string): void;
}) {
  let list: HTMLDivElement | undefined;
  const [stick, setStick] = createSignal(true);

  const records = createMemo(() => Object.values(props.resolutions));
  const byTool = createMemo(() => byToolPart(records()));
  const unanchored = createMemo(() =>
    unanchoredByMessage(props.open.messages, props.open.parts, records()),
  );
  /** Ids of the tool blocks that a pending permission or form points at (`tool.partID`). */
  const awaitingTools = createMemo(() => {
    const ids = new Set<string>();
    for (const ask of props.requests.permissions) {
      if (ask.tool !== undefined) ids.add(ask.tool.partID);
    }
    for (const ask of props.requests.forms) {
      if (ask.tool !== undefined) ids.add(ask.tool.partID);
    }
    return ids;
  });
  /** Lines under a tool block; none for text and reasoning. */
  const outcomesOf = (part: Part): OutcomeView[] =>
    part.type === 'tool' ? toolOutcomeViews(part, byTool().get(part.id) ?? []) : [];
  /** Lines at the end of message `id`, for records with no tool block in this history. */
  const looseOutcomes = (id: string): OutcomeView[] =>
    (unanchored().get(id) ?? []).flatMap((record) => {
      const view = outcomeView(record, undefined, '');
      return view === undefined ? [] : [view];
    });

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
                            {(file) => (
                              <li class="chip">
                                <AttachmentOpenButton
                                  name={file.name ?? file.uri ?? file.mime}
                                  uri={file.uri}
                                />
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                      <For each={looseOutcomes(user().id)}>
                        {(view) => <RequestOutcome view={view} />}
                      </For>
                      <div class="message-actions" aria-live="off">
                        <button
                          type="button"
                          class="secondary message-action"
                          aria-label={forkLabel(user())}
                          aria-disabled={props.forkDisabled ? 'true' : undefined}
                          onClick={() => {
                            if (!props.forkDisabled) props.onFork(user());
                          }}
                        >
                          Fork from here
                        </button>
                      </div>
                    </article>
                  )}
                </Match>
                <Match when={asAssistant(message)}>
                  {(assistant) => (
                    <article
                      class="message message-assistant"
                      aria-busy={props.busy && isLast(assistant().id)}
                    >
                      <div class="message-meta">
                        {replyMeta(props.catalog, assistant().agent, assistant().model)}
                      </div>
                      <For each={props.open.parts[assistant().id] ?? []}>
                        {(part) => (
                          <PartView
                            part={part}
                            live={isLive(assistant())}
                            outcomes={outcomesOf(part)}
                            awaiting={awaitingTools().has(part.id)}
                            onOpenSession={(sessionID) => {
                              props.onOpenSession(sessionID);
                            }}
                          />
                        )}
                      </For>
                      <For each={looseOutcomes(assistant().id)}>
                        {(view) => <RequestOutcome view={view} />}
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
