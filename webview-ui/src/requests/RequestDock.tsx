import { createEffect, createMemo, createSignal, For, on, Show, untrack } from 'solid-js';
import type { FormAsk, PermissionAsk } from '../../../src/shared/model';
import { useSend } from '../chat/hostContext';
import { nextRequestId } from '../chat/PromptInput';
import type { ChatStore } from '../store/chatStore';
import { FormCard } from './FormCard';
import { PermissionCard, type RequestOrigin } from './PermissionCard';
import { describeRequest } from './permissionText';

/** Built from its code point: a literal one in the source trips `no-irregular-whitespace`. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** One pending request, permission or form, as the dock lists it. */
type Ask = { kind: 'permission'; ask: PermissionAsk } | { kind: 'form'; ask: FormAsk };

/**
 * The dock of pending requests (issues #18/#44), fixed between the conversation and the prompt box.
 *
 * Shows every pending request the host sent this surface (it does not filter: since issue #77 E4
 * the HOST decides, so the side-bar view gets every request of the location and a chat tab only
 * those of its session and its subagent lineage; not only the open session's, a subagent asks
 * from its own session), permissions first because they block a tool, then forms, each group in order
 * of arrival; a request of another session says which session it comes from, with an "Open
 * session" button when that is a top-level session. Under the cards, the one-line results of the
 * requests of OTHER sessions (or unknown to the host) answered since the last prompt ("Allowed
 * once: Read .env"). Since E3-resolved-history the answers of the open session are not here: they
 * hang under their tool in the conversation (`MessageList`), and the store adds no dock line for
 * them (decision of Sergio, 21/10/2026: the dock line stays for subagents' requests because their
 * history is not on screen). The dock lives above the input so a pending card is always visible
 * without scrolling.
 *
 * Accessibility and focus (plan `E2-mvp-prototype/plan-fase3`): its own `aria-live="polite"` region
 * announces each new request ("Permission requested: Read .env", "Question from the agent"),
 * alternating a trailing no-break space so the same text twice is announced again (lesson #918).
 * When a request arrives the focus goes to its CARD (a `section` with `tabindex="-1"` and an
 * accessible name, so a screen reader announces the group), never to a button, UNLESS the user is
 * typing in the prompt (it has text) or is inside another card; then the announcement is enough.
 * Decision of the coordinator after the review (B1, Engram `decisions-foco-permiso`): the first
 * version focused "Allow once", and with an empty prompt a Space or Enter meant for a sentence
 * would have approved a permission. The plan said "unless the focus is in the textarea", but the
 * prompt box takes the focus right after every send, so that rule would almost never move it;
 * "has text" keeps the intent (do not steal focus while typing). Nor does it focus a card while its
 * webview document does not have the focus (`document.hasFocus()` false: a chat tab visible in a
 * group the user is not in, the side bar chat visible but not focused, or a VS Code window that
 * lost the focus), because that focus made VS Code activate the tab (decision of Sergio,
 * 30/10/2026, from `test:visual` step 30 D4); the announcement and the host's notification cover it.
 * VERIFIED in a real VS Code 1.144.0 (Windows 11, `test:visual` step 30 D4, 30/10/2026): without the
 * `hasFocus` guard the message was "1 s later the editor in front is "Tab30B: …" and "attention:
 * closed (visible)" was logged 1 time(s)", and with it "3 s later the editor in front is still
 * "Tab30A: …", the notification is still there and "attention: closed (visible)" was logged 0
 * time(s)"; the `ui.focus` branch below is seen by D2, "card focused true".
 * Accepted consequence (Sergio): with the side bar chat visible but not focused, a new request
 * shows its card and the badge, and neither moves the focus nor raises a notification.
 * `ui.focus` always focuses the card (and scrolls it into view),
 * waiting for the card to exist if the snapshot has not brought it yet. When the card that had the
 * focus is resolved, the focus returns to the prompt (`focusInput`). Escape inside a card also
 * returns it there, and never rejects.
 * VERIFIED by `RequestDock.test.tsx` in jsdom (order, focus rules, announcement, origin label).
 * UNVERIFIED: how the focus and the announcements feel with a real screen reader, a VS Code window
 * that lost the system focus, and macOS/Linux.
 */
export function RequestDock(props: {
  store: ChatStore;
  /** True while the prompt box has text: the user is typing, so the dock must not take the focus. */
  typing: boolean;
  /** Moves the focus to the prompt box. */
  focusInput(): void;
}) {
  const state = props.store.state;
  const send = useSend();
  let dock: HTMLDivElement | undefined;
  let focusedAsk: string | undefined;
  let seen = new Set<string>();
  let flip = false;
  const [announcement, setAnnouncement] = createSignal('');

  /** Permissions first, then forms; each group keeps the order the host sent. */
  const asks = createMemo<Ask[]>(() => [
    ...state.requests.permissions.map((ask): Ask => ({ kind: 'permission', ask })),
    ...state.requests.forms.map((ask): Ask => ({ kind: 'form', ask })),
  ]);
  const ids = createMemo(() => asks().map((entry) => entry.ask.id));

  /** The card element of request `id`, if it is rendered. */
  const cardOf = (id: string): HTMLElement | undefined =>
    [...(dock?.querySelectorAll<HTMLElement>('[data-request-id]') ?? [])].find(
      (element) => element.dataset['requestId'] === id,
    );

  /** Label of the session a request comes from, or `undefined` when it is the open one. */
  const originOf = (sessionID: string): RequestOrigin | undefined => {
    if (sessionID === state.open.sessionID) return undefined;
    const session = state.sessions[sessionID];
    const origin: RequestOrigin = { title: session?.title ?? sessionID };
    if (session !== undefined && session.parentID === undefined) {
      origin.onOpen = () => {
        const requestId = nextRequestId();
        props.store.begin(requestId);
        send({ type: 'session.open', requestId, sessionID });
      };
    }
    return origin;
  };

  /** Name of the tool that raised a request, when its block is in the open session. */
  const toolNameOf = (ask: PermissionAsk): string | undefined => {
    if (ask.tool === undefined) return undefined;
    const part = state.open.parts[ask.tool.messageID]?.find(
      (block) => block.id === ask.tool?.partID,
    );
    return part?.type === 'tool' ? part.name : undefined;
  };

  /** Marks the card of `askId` as waiting for the answer of request `requestId`. */
  const sent = (askId: string, requestId: string): void => {
    props.store.beginReply(askId, requestId);
  };

  // New requests: announce them and, when the user is not busy writing, focus the card.
  createEffect(() => {
    const current = asks();
    const fresh = current.filter((entry) => !seen.has(entry.ask.id));
    seen = new Set(current.map((entry) => entry.ask.id));
    const first = fresh[0];
    if (first === undefined) return;
    const text =
      fresh.length > 1
        ? `${String(fresh.length)} requests from the agent`
        : first.kind === 'permission'
          ? `Permission requested: ${describeRequest(first.ask)}`
          : first.ask.kind === 'question'
            ? 'Question from the agent'
            : `Form from the agent: ${first.ask.title}`;
    flip = !flip;
    setAnnouncement(flip ? text : `${text}${NO_BREAK_SPACE}`);

    // `typing` is read untracked: the effect must not run again when the user types.
    untrack(() => {
      const active = document.activeElement;
      const inPrompt = active instanceof HTMLElement && active.closest('.prompt') !== null;
      const inDock = active instanceof HTMLElement && dock?.contains(active) === true;
      // A document that does not have the focus is a chat tab in a group the user is not in, the
      // side bar chat visible but not focused, or a window without focus:
      // `focus()` inside it would make VS Code activate that tab and pull the user out of the one
      // they are using (and close the notification of the request, `test:visual` step 30 D4).
      if ((inPrompt && props.typing) || inDock || !document.hasFocus()) return;
      // The card itself, never a button: with the prompt empty the user may be about to type, and
      // a focused button would take the letters and be pressed by Space or Enter (B1 of the
      // review: that approved a permission nobody decided).
      cardOf(first.ask.id)?.focus();
    });
  });

  // `ui.focus`: bring the card into view and focus it, as soon as it exists.
  createEffect(() => {
    const target = state.focusTarget;
    asks(); // re-run when a snapshot brings the card
    if (target === undefined) return;
    const card = cardOf(target.id);
    if (card === undefined) return;
    card.scrollIntoView?.({ block: 'nearest' });
    card.focus();
    props.store.clearFocusTarget();
  });

  // The card that had the focus was resolved: give the focus back to the prompt.
  createEffect(
    on(ids, (current) => {
      if (focusedAsk === undefined || current.includes(focusedAsk)) return;
      focusedAsk = undefined;
      const active = document.activeElement;
      if (active === null || active === document.body) props.focusInput();
    }),
  );

  return (
    <>
      <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement()}
      </div>
      <Show when={asks().length > 0 || state.resolved.length > 0}>
        <div
          class="request-dock"
          role="region"
          aria-label="Requests from the agent"
          ref={(element) => {
            dock = element;
          }}
          onFocusIn={(event) => {
            const card = (event.target as HTMLElement).closest<HTMLElement>('[data-request-id]');
            focusedAsk = card?.dataset['requestId'];
          }}
        >
          <For each={state.requests.permissions}>
            {(ask) => (
              <PermissionCard
                ask={ask}
                sameSessionCount={
                  state.requests.permissions.filter((other) => other.sessionID === ask.sessionID)
                    .length
                }
                toolName={toolNameOf(ask)}
                origin={originOf(ask.sessionID)}
                replying={state.replying[ask.id] !== undefined}
                error={state.requestErrors[ask.id]}
                onSent={(requestId) => {
                  sent(ask.id, requestId);
                }}
                onEscape={() => {
                  props.focusInput();
                }}
              />
            )}
          </For>
          <For each={state.requests.forms}>
            {(ask) => (
              <FormCard
                ask={ask}
                origin={originOf(ask.sessionID)}
                replying={state.replying[ask.id] !== undefined}
                error={state.requestErrors[ask.id]}
                onSent={(requestId) => {
                  sent(ask.id, requestId);
                }}
                onEscape={() => {
                  props.focusInput();
                }}
              />
            )}
          </For>
          <Show when={state.resolved.length > 0}>
            <ul class="request-results" aria-label="Answered requests">
              <For each={state.resolved}>
                {(line) => (
                  <li>
                    {line.outcome}: {line.label}
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Show>
    </>
  );
}
