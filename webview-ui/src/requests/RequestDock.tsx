import * as l10n from '@vscode/l10n';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  on,
  Show,
  untrack,
} from 'solid-js';
import type { FormAsk, PermissionAsk } from '../../../src/shared/model';
import { useSend } from '../chat/hostContext';
import { nextRequestId } from '../chat/PromptInput';
import type { ChatStore } from '../store/chatStore';
import { FormCard } from './FormCard';
import { PermissionCard, type RequestOrigin } from './PermissionCard';
import { describeRequest } from './permissionText';
import { RequestTabs, type RequestTabEntry } from './RequestTabs';
import { resolveActive } from './activeTab';

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
 *
 * Tabs (plan `E3-request-tabs`): the requests share ONE box (`.request-box`). With a single request
 * the box holds just its card, looking as it always did (D1: a lone tab is noise, and a screen
 * reader would announce "tab 1 of 1"). With two or more, a row of tabs (`RequestTabs`) sits on top
 * and only the active request's panel is visible. Design choices:
 * - Every card stays mounted and the inactive panels are only `hidden` (D2, as the settings panels
 *   do): rendering just the active one would throw away a half-filled form, the text of "Reject
 *   with feedback" or an open "Always" panel on each tab change.
 * - The active tab is an id, not an index (D3, `resolveActive`): a permission that arrives is
 *   inserted before the forms and must not move the tab the user is reading. When the active
 *   request is resolved, the tab in its position takes over (D4); the FOCUS still follows the rule
 *   above (back to the prompt), it does not jump to the next card.
 * - A new request's tab becomes the active one only when the dock is about to focus its card (D6,
 *   decision of Sergio, 07/11/2026): not while typing, not with the focus inside the dock, not when
 *   the document has no focus. Otherwise the active tab stays, the new tab appears and the live
 *   region announces it. `ui.focus` is an explicit action ("Open chat"), so it always activates.
 * - Focus after activation goes through a SECOND effect (`focusRequest`, D7): inside the effect
 *   that writes the active id the panel is still `hidden`, and in Chromium `focus()` on a
 *   `display: none` element does nothing (jsdom does not notice). VERIFIED by a probe on solid-js
 *   1.9.17 (07/11/2026, Engram `leccion/solid-webview/foco-tras-escritura-en-efecto`): right after
 *   the write inside an effect `hidden` is still set, and the second effect sees it removed;
 *   `RequestDock.test.tsx` spies on `focus()` to check `hidden` at the moment of the call.
 * - The dock tracks the focus on the cards AND on the tabs (D9): if what had the focus disappears
 *   (a resolved card, a vanished tab, the tab row unmounting when only one request is left), and
 *   the document has the focus, it returns to the prompt instead of falling to the body. A list
 *   change that leaves what had the focus in place never moves it.
 * VERIFIED in a real VS Code 1.145.2 (Windows 11, `--steps 43` of 07/11/2026): "R3 the focus is on
 * the card of the question, inside the panel that is visible (not on a hidden one)", "R2 the hidden
 * panel of the first request still names its session and offers "Open session"", "R7 the focus
 * went back to the prompt box, not to the next card" and "R7 one request left: the tab row is gone
 * and the box holds only the first card". The horizontal scroll and the whole labels: "M3 at 300
 * (bar 300 px), dark: every label is whole (Permission [by scrolling], Permission, Question), none
 * cut with an ellipsis, and every tab is visible or reachable by scrolling its list".
 * UNVERIFIED: a screen reader, macOS and Linux.
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
  /** True when the last focus inside the dock was on a tab (its row unmounts below two requests). */
  let focusedOnTab = false;
  /** True between asking to focus a card and the effect that does it (see `focusRequest`). */
  let focusPending = false;
  let seen = new Set<string>();
  let flip = false;
  const [announcement, setAnnouncement] = createSignal('');

  /** Permissions first, then forms; each group keeps the order the host sent. */
  const asks = createMemo<Ask[]>(() => [
    ...state.requests.permissions.map((ask): Ask => ({ kind: 'permission', ask })),
    ...state.requests.forms.map((ask): Ask => ({ kind: 'form', ask })),
  ]);
  const ids = createMemo(() => asks().map((entry) => entry.ask.id));
  const idBase = createUniqueId();
  const tabbed = () => asks().length > 1;

  // The request somebody asked to show (a tab chosen, a card focused) and the pending order to
  // focus a card once its panel is visible (D7).
  const [requested, setRequested] = createSignal<string | undefined>(undefined);
  const [focusRequest, setFocusRequest] = createSignal<{ id: string; scroll: boolean }>();

  /** The active request id, with the list it was computed against (`resolveActive` needs both). */
  const activeState = createMemo<{ ids: string[]; id: string | undefined }>(
    (previous) => ({
      ids: ids(),
      id: resolveActive(previous.ids, ids(), previous.id, requested()),
    }),
    { ids: [], id: undefined },
  );
  const active = () => activeState().id;

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
        ? l10n.t('{0} requests from the agent', fresh.length)
        : first.kind === 'permission'
          ? l10n.t('Permission requested: {0}', describeRequest(first.ask))
          : first.ask.kind === 'question'
            ? l10n.t('Question from the agent')
            : l10n.t('Form from the agent: {0}', first.ask.title);
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
      // review: that approved a permission nobody decided). Its tab becomes the active one first,
      // and the focus waits for the effect below, once the panel is no longer `hidden` (D6, D7).
      focusPending = true;
      setRequested(first.ask.id);
      setFocusRequest({ id: first.ask.id, scroll: false });
    });
  });

  // `ui.focus`: show the request (its tab too), bring the card into view and focus it, as soon as
  // it exists. An explicit action of the user, so the arrival guards do not apply.
  createEffect(() => {
    const target = state.focusTarget;
    asks(); // re-run when a snapshot brings the card
    if (target === undefined) return;
    if (cardOf(target.id) === undefined) return;
    focusPending = true;
    setRequested(target.id);
    setFocusRequest({ id: target.id, scroll: true });
    props.store.clearFocusTarget();
  });

  // Focuses the card of the last order. A separate effect on purpose (D7): when the order is
  // written the panel of an inactive tab is still `hidden`, and `focus()` on it would do nothing.
  createEffect(
    on(
      focusRequest,
      (order) => {
        focusPending = false;
        if (order === undefined) return;
        const card = cardOf(order.id);
        if (order.scroll) card?.scrollIntoView?.({ block: 'nearest' });
        card?.focus();
      },
      { defer: true },
    ),
  );

  // What had the focus (a card or a tab) is gone, or the tab row was unmounted under it when only
  // one request was left: give the focus back to the prompt instead of letting it fall to the body.
  // Only then: a list that changes while what had the focus is still there (a request of another
  // session answered, a new one arriving) never moves it, and neither does a document without the
  // focus (`textarea.focus()` there would make VS Code activate the tab, step 30 D4).
  createEffect(
    on(ids, (current) => {
      // A card is about to be focused (its effect may run after this one): not a lost focus.
      if (focusedAsk === undefined || focusPending) return;
      const gone = !current.includes(focusedAsk) || (focusedOnTab && current.length < 2);
      if (!gone) return;
      // What had the focus is gone whatever happens next: forget it BEFORE the checks, so a later,
      // unrelated list change cannot act on a stale record.
      focusedAsk = undefined;
      focusedOnTab = false;
      if (!document.hasFocus()) return;
      const focused = document.activeElement;
      if (focused !== null && focused !== document.body) return;
      props.focusInput();
    }),
  );

  /** One tab per request, in the order of the cards. */
  const tabEntries = createMemo<RequestTabEntry[]>(() =>
    asks().map((entry) => {
      const origin = originOf(entry.ask.sessionID);
      const about = entry.kind === 'permission' ? describeRequest(entry.ask) : entry.ask.title;
      return {
        id: entry.ask.id,
        kind: entry.kind,
        label:
          entry.kind === 'permission'
            ? l10n.t('Permission')
            : entry.ask.kind === 'question'
              ? l10n.t('Question')
              : l10n.t('Form'),
        detail:
          origin === undefined ? about : `${about} (${l10n.t('From session “{0}”', origin.title)})`,
      };
    }),
  );

  /** Panel attributes of the card of request `id`; a tabpanel without a tab list is invalid ARIA. */
  const panelProps = (id: string) => ({
    id: tabbed() ? `${idBase}-panel-${id}` : undefined,
    role: tabbed() ? ('tabpanel' as const) : undefined,
    'aria-labelledby': tabbed() ? `${idBase}-tab-${id}` : undefined,
    hidden: tabbed() && active() !== id,
  });

  return (
    <>
      <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement()}
      </div>
      <Show when={asks().length > 0 || state.resolved.length > 0}>
        <div
          class="request-dock"
          role="region"
          aria-label={l10n.t('Requests from the agent')}
          ref={(element) => {
            dock = element;
          }}
          onFocusIn={(event) => {
            // A card, or a tab (`data-request-tab` holds the id of its request, D9).
            const target = (event.target as HTMLElement).closest<HTMLElement>(
              '[data-request-id],[data-request-tab]',
            );
            focusedAsk = target?.dataset['requestId'] ?? target?.dataset['requestTab'];
            focusedOnTab = target?.dataset['requestTab'] !== undefined;
          }}
        >
          <Show when={asks().length > 0}>
            <div class="request-box">
              <Show when={tabbed()}>
                <RequestTabs
                  entries={tabEntries()}
                  activeId={active()}
                  idBase={idBase}
                  onSelect={(id) => {
                    setRequested(id);
                  }}
                  onEscape={() => {
                    props.focusInput();
                  }}
                />
              </Show>
              <For each={state.requests.permissions}>
                {(ask) => (
                  <div
                    class="request-panel"
                    id={panelProps(ask.id).id}
                    role={panelProps(ask.id).role}
                    aria-labelledby={panelProps(ask.id)['aria-labelledby']}
                    hidden={panelProps(ask.id).hidden}
                  >
                    <PermissionCard
                      ask={ask}
                      sameSessionCount={
                        state.requests.permissions.filter(
                          (other) => other.sessionID === ask.sessionID,
                        ).length
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
                  </div>
                )}
              </For>
              <For each={state.requests.forms}>
                {(ask) => (
                  <div
                    class="request-panel"
                    id={panelProps(ask.id).id}
                    role={panelProps(ask.id).role}
                    aria-labelledby={panelProps(ask.id)['aria-labelledby']}
                    hidden={panelProps(ask.id).hidden}
                  >
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
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={state.resolved.length > 0}>
            <ul class="request-results" aria-label={l10n.t('Answered requests')}>
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
