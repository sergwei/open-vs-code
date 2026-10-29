import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from 'solid-js';
import {
  isComposeInBounds,
  MAX_DROPPED_ITEMS,
  MAX_DROPPED_URI_LENGTH,
  type AttachmentRef,
} from '../../src/shared/protocol';
import { RevertBanner } from './changes/RevertBanner';
import { splitAtRevert } from './changes/revertView';
import { ConnectionCard } from './chat/ConnectionCard';
import { describeProblem, nextGuideLatch } from './chat/connectionView';
import { EmptyState } from './chat/EmptyState';
import { SetupGuide } from './chat/SetupGuide';
import { Header } from './chat/Header';
import type { DropContent } from './chat/dropData';
import { HostContext, type SendToHost } from './chat/hostContext';
import { readImage } from './chat/imageFile';
import { mentionsFor } from './chat/mentionQuery';
import { MessageList, type UserMessage } from './chat/MessageList';
import { nextRequestId, PromptInput } from './chat/PromptInput';
import { createHistory } from './chat/promptHistory';
import { parseCommand } from './chat/slashCommand';
import { StatusBar } from './chat/StatusBar';
import { RequestDock } from './requests/RequestDock';
import { AgentModelMenu } from './selectors/AgentModelMenu';
import {
  effectiveAgent,
  effectiveModel,
  selectionToSend,
  variantChoices,
  withVariant,
  type SelectionInput,
} from './selectors/selection';
import { deriveActivity } from './store/activity';
import type { ChatStore } from './store/chatStore';
import type { UiState } from './uiState';

/** Built from its code point: a literal one in the source trips `no-irregular-whitespace`. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * How long typing must pause before the `@` popup asks the host for files. Our choice (issue #28,
 * plan Engram #1059): short enough to feel immediate, long enough that typing `@sample` costs one
 * request, not six. Not measured with a real user; the host answers in 2-9 ms once the index is
 * warm and about 1.3 s the first time (planner spike, real opencode 2.0.32).
 */
export const FILE_SEARCH_DEBOUNCE_MS = 150;

/** What the last `prompt.send` carried, so a failed send can give the user their text back. */
interface LastSend {
  requestId: string;
  text: string;
  files: AttachmentRef[];
  /** True for a `prompt.compose` of the host: a failure then appends the text, see {@link runCompose}. */
  compose?: boolean;
}

/** What the last `session.fork` carried: the text (and known files) to refill the prompt with. */
interface LastFork {
  requestId: string;
  text: string;
  files: AttachmentRef[];
}

/** What the last `session.revert.stage` carried: the text (and known files) to refill the prompt with. */
interface LastRevert {
  requestId: string;
  text: string;
  files: AttachmentRef[];
}

/**
 * Root component of the chat webview (issues #12, #13, #16, #17, #18, #44): header, conversation
 * (or the empty state), the dock of pending requests, status strip and prompt box.
 *
 * It receives the store, the sender and the persisted UI state instead of importing them, so it
 * renders in tests with a fake host. It owns the cross-component behaviour: the draft and the
 * history and the attachments chosen but not sent (all persisted through `uiState`, so they
 * survive the view being hidden), Send / Stop / Retry / Attach / New session, restoring the text
 * and attachments when a send fails (only the text when the failure is `AttachmentRejected`: the
 * host refused those files, so putting them back would fail again), and the text announced to
 * screen readers when a turn ends. The sender reaches deeper components through `HostContext`. Phase 3 mounts the
 * `RequestDock` between the conversation and the status strip (it needs only the store, whether
 * the draft has text, and the prompt's `focus`) and clears the dock's one-line results (those of
 * other sessions' requests) whenever a prompt is sent. The answered requests of the open session
 * are not in the dock: `MessageList` shows them under their tool (E3-resolved-history), so sending
 * a prompt does not erase them.
 *
 * Issue #61 (reasoning variant), now the Reasoning section of the {@link AgentModelMenu}: its choices
 * come from the effective model (`variantChoices`), and picking one stores the effective model
 * reference with that variant as the draft (`withVariant`), so `selectionToSend` carries it with
 * the next prompt.
 *
 * E2 (issue #85, phase 2): a failure of the server with no conversation shows the {@link SetupGuide}
 * instead of the whole view (P1=1: latched through the next `starting` until `connected`, see
 * `nextGuideLatch`); with a conversation the {@link ConnectionCard} sits at the end of the log; with
 * neither (reconnecting, or no folder) the card takes the place of the empty state. While there
 * is no connection the prompt box stays editable with the placeholder "Waiting for opencode…"
 * (P5=2). `.app` carries `data-connection` (the state) for the tests and is a size container for
 * the CSS. VERIFIED in jsdom by `App.test.tsx` ("setup guide and connection card").
 *
 * Issue #20 adds the session list to the header (open, search, rename, delete; the host confirms a
 * delete) and makes New session lazy. Deleting the open session leaves the view empty (the store
 * does it on `session.removed`); the focus is not moved, because the user is inside the list.
 *
 * Issue #21 adds "Fork from here" on user messages (`forkFrom`): the host forks the session before
 * that message and opens the fork; when its `request.result` arrives without an error the prompt is
 * refilled with the message text, but ONLY if the draft is empty (never over what the user was
 * typing), together with the attachments of that message this document picked itself (the same
 * rule as Retry), and gets the focus. A failure leaves everything as it was and the notice says
 * why. While the fork is in flight the buttons are `aria-disabled` and Send is blocked by the
 * pending request, so a prompt cannot go to the old session in the middle of the switch. It also
 * hands `openSession` to the subagent links of the conversation.
 *
 * Issues #23/#24, since E2 (#85, phase 3) ONE combined chip "agent · model ▾" in the prompt bar
 * (decision of 21/10/2026, Engram #1012: in the bar, not the header), make the choice a DRAFT in the store:
 * `sendPrompt` (Send and Retry alike) adds the model and agent the next prompt would use
 * (`selectionToSend`) and the host validates and applies them just before the prompt. Nothing is
 * sent to the host when the user picks. The draft is persisted with the prompt draft, keyed by the
 * open session, and restored into the store at start.
 *
 * Issues #28/#29 (decisions Q1-Q4 of Sergio, 22/10/2026, Engram #1064/#1065): the `@` popup's
 * search is debounced here ({@link FILE_SEARCH_DEBOUNCE_MS}; the timer dies with the component and
 * with a closed popup) and goes to the host as `files.search`, outside `pending`, so Send stays
 * usable; the store keeps the answer to the last request. Picking a result adds the chip (the
 * text `@name` is written by `PromptInput`). On send, each file is paired with the offsets of its
 * `@name` in the text that goes out (`mentionsFor`); the file travels without a mention when the
 * user deleted the text, and a typed `@name` without its chip is plain text. "Add selection" asks
 * the host for the active file or selection (`attachments.fromEditor`, the answer reuses
 * `attachments.picked`). The search is forgotten when a prompt is sent or the open session changes.
 *
 * Issue #33 (slash commands, decisions of Sergio 28/10/2026, Engram #1416): {@link submit} looks
 * the sent text up in the catalog's commands (`parseCommand`, the webview parses and the host
 * revalidates the name). A listed `/name args` goes as `prompt.send` with `command: name` and
 * `text: args`, and its files WITHOUT `mention` (the template rewrites the text, P9=1); a name that
 * is not listed, or no catalog list at all, goes as a normal prompt with the full text (P4=1).
 * `lastSend.text` and the history keep the FULL typed text (`/name args`), so a failed send gives
 * the draft back as it was typed. Retry resends the stored message text as a normal prompt: the
 * server keeps the expanded template, not the command (P8=1, a known limit). The catalog's
 * `commands` reach the prompt box as they are (absent stays absent). VERIFIED by `App.test.tsx`
 * in jsdom with a fake host, and in a real window (Windows 11, VS Code 1.144.0, 28/10/2026) by the
 * `test:visual` check "C4 the turn of /hello Ana ends" (the command runs end to end against the
 * synthetic server).
 *
 * Issue #31: the header shows the "Changed files" list of the open session, and `openChangedFile`
 * turns a click on a row into `session.diff.open` for the open session (no `requestId`).
 *
 * Issue #32 (decisions of Sergio, 23/10/2026, Engram #1174): "Revert from here" on user messages
 * asks the host to prepare a revert (`revertFrom`, `session.revert.stage`); while one is prepared
 * the conversation is drawn WITHOUT the messages from its boundary on (`splitAtRevert`; the store
 * keeps them, so Restore is instant) and the {@link RevertBanner} sits between the conversation
 * and the request dock with the files it changed and two buttons: Restore (`session.revert.clear`)
 * and Discard for good (`session.revert.commit`, which the HOST confirms with a native modal).
 * Retry, the activity line and the context indicator read the visible messages, not the hidden
 * ones. When the stage succeeds the prompt is refilled with the text of that message, ONLY if the
 * draft is empty (the same rule as the fork), and gets the focus. While a revert request is in
 * flight, or the session is busy, the revert buttons are `aria-disabled`.
 *
 * Issue #35: a `ui.command` from the host (palette or keys) runs the code of the matching button
 * (`prompt.focus`, `session.new` -> {@link newSession}, `session.stop` -> {@link stop}); Stop with
 * no running turn raises the info notice "No response is running" instead of doing nothing. The
 * window's `focus`/`blur` and its value at mount go to the host as `chat.focusChanged`.
 *
 * Issue #36: a `prompt.compose` from the host (Explain / Fix of the editor and Explorer menus) is
 * carried out by {@link runCompose}: sent with the Send code, or put in the prompt box when that is
 * not possible (decisions of Sergio, 29/10/2026, Engram `E9-context-menus/decisions/p1-p13-t1-t4`).
 *
 * Decisions: Send is disabled while the session is busy and Stop takes its place (plan decision
 * 6; `steer`/`queue` while busy is not offered); every prompt goes with `delivery: 'queue'`;
 * Retry resends the text of the last user message of the open session, with the attachments of
 * it that this document picked itself (the host only accepts URIs it emitted; the planner's spike
 * against a real opencode 2.0.32 saw the stored `source.uri` keep the URL as sent, query included,
 * so the echoed URI matches; HYPOTHESIS for messages read back through `message.list`, and the
 * mention is computed again from the resent text).
 * The "Stopped" announcement is decided by a flag set when Stop is pressed, so an abort the
 * server refuses and a turn that then ends on its own would still say "Stopped" (accepted).
 * VERIFIED by `App.test.tsx` in jsdom with a fake host; UNVERIFIED in a real webview (themes,
 * focus order, screen reader) until the F5.
 */
export function App(props: { store: ChatStore; send: SendToHost; uiState: UiState }) {
  const state = props.store.state;
  const history = createHistory(props.uiState.history);
  // Attachments pending when the view was last hidden. The host keeps the URIs it emitted (picker,
  // editor, search results up to a cap) for as long as it lives, so they are still accepted; if the host restarted, the send
  // fails with AttachmentRejected and the user removes the chip.
  props.store.addDraftFiles(props.uiState.files);
  props.store.restoreSelection({
    sessionID: props.uiState.selection.sessionID,
    model: props.uiState.selection.model,
    agent: props.uiState.selection.agent,
  });
  const [draft, setDraft] = createSignal(props.uiState.draft);
  const [announcement, setAnnouncement] = createSignal('');
  let focusInput: (() => void) | undefined;
  /** Closes the panel of the agent and model chip; set by the chip itself (review W1). */
  let closeChipPanel: (() => void) | undefined;
  let lastSend: LastSend | undefined;
  const [lastFork, setLastFork] = createSignal<LastFork | undefined>(undefined);
  const [lastRevert, setLastRevert] = createSignal<LastRevert | undefined>(undefined);
  /** `requestId` of a clear or commit in flight (the stage has its own, in `lastRevert`). */
  const [revertRequest, setRevertRequest] = createSignal<string | undefined>(undefined);
  let stopRequested = false;
  let announcementFlip = false;
  /** Every file picked in this document, to validate what Retry may re-attach. */
  const knownFiles = new Map<string, AttachmentRef>();

  // The conversation without the messages a prepared revert hides (issue #32).
  const split = createMemo(() => splitAtRevert(state.open.messages, state.open.revert));
  const messages = () => split().visible;

  const status = () =>
    state.open.sessionID === undefined ? undefined : state.statuses[state.open.sessionID];
  const busy = () => {
    const current = status();
    return current?.type === 'busy' || current?.type === 'retry';
  };
  /**
   * Parts of the assistant message of the CURRENT turn: the newest assistant message, but only
   * if no user message came after it. Right after sending, the previous answer still ends the
   * list; reading it would show "Writing" (or a stale "Running <tool>" after an interrupted turn)
   * until the new assistant message exists, so the activity then falls back to the session status.
   */
  const lastAssistantParts = () => {
    const shown = messages();
    for (let index = shown.length - 1; index >= 0; index--) {
      const message = shown[index];
      if (message?.kind === 'user') return [];
      if (message?.kind === 'assistant') return state.open.parts[message.id] ?? [];
    }
    return [];
  };
  const activity = createMemo(() =>
    deriveActivity(state.connection, status(), lastAssistantParts()),
  );
  const lastUser = () => {
    const shown = messages();
    for (let index = shown.length - 1; index >= 0; index--) {
      const message = shown[index];
      if (message?.kind === 'user') return message;
    }
    return undefined;
  };
  /** True when the newest message is an assistant message with its own error (it has a Retry). */
  const lastMessageHasError = () => {
    const shown = messages();
    const message = shown[shown.length - 1];
    return message?.kind === 'assistant' && message.error !== undefined;
  };
  const connected = () => state.connection.state === 'connected';
  // E2 (issue #85): the setup guide replaces the view after a failure with no conversation behind
  // it (P1=1) and stays through the next `starting` until `connected`. The memo keeps the previous
  // answer in `guide` because `nextGuideLatch` needs it for the in-between states.
  let guide = false;
  const guideVisible = createMemo(() => {
    guide = nextGuideLatch(guide, state.connection, state.open.messages.length > 0);
    return guide;
  });
  /** The card of the current connection problem, if any (inside the conversation or in its place). */
  const problem = createMemo(() => describeProblem(state.connection));
  const canSend = () => connected() && !busy() && state.pending.length === 0;
  /** What the selectors and the next `prompt.send` read: catalog, open session row and draft. */
  const selectionInput = (): SelectionInput => ({
    catalog: state.catalog,
    hasSession: state.open.sessionID !== undefined,
    row: state.open.sessionID === undefined ? undefined : state.sessions[state.open.sessionID],
    draft: { model: state.selection.model, agent: state.selection.agent },
  });

  /**
   * Puts `text` in the prompt box without losing what is there: a blank box is replaced, otherwise
   * `text` goes on a new last line (P6). Chips are the caller's business.
   */
  const putInDraft = (text: string): void => {
    const current = untrack(draft);
    if (current.trim() === '') setDraft(text);
    else setDraft(`${current.endsWith('\n') ? current : `${current}\n`}${text}`);
  };

  /** Saves the draft, the history, the pending attachments and the model/agent draft; also tracked as an effect. */
  const persist = (): void => {
    const picked = state.selection;
    // Only a real pick is worth keeping: a bare session id says nothing the snapshot will not.
    const hasPick = picked.model !== undefined || picked.agent !== undefined;
    props.uiState.save({
      draft: draft(),
      history: history.entries(),
      files: state.draftFiles.map((file) => ({ uri: file.uri, name: file.name })),
      ...(hasPick
        ? {
            selection: {
              ...(picked.sessionID === undefined ? {} : { sessionID: picked.sessionID }),
              ...(picked.model === undefined ? {} : { model: { ...picked.model } }),
              ...(picked.agent === undefined ? {} : { agent: picked.agent }),
            },
          }
        : {}),
    });
  };
  createEffect(persist);

  // Plain copies: Retry and fork put these in a `postMessage`, which cannot clone a store Proxy.
  createEffect(() => {
    for (const file of state.draftFiles)
      knownFiles.set(file.uri, { uri: file.uri, name: file.name });
  });

  // A failed `prompt.send` gives the text and the attachments back. It reads `pending` and
  // `notices` BEFORE the early return so the effect keeps both as dependencies; the store applies
  // `request.result` in one batch, so the two never show half updated.
  createEffect(() => {
    const pending = state.pending.slice();
    const notices = state.notices.slice();
    const sent = lastSend;
    if (sent === undefined || pending.includes(sent.requestId)) return;
    lastSend = undefined;
    const failure = notices.find((notice) => notice.requestId === sent.requestId);
    // The thumbnails of the sent images are freed once the chips will not come back: after an
    // accepted send, or when the host refused the files (a failure with other cause restores the
    // chips, which still need their thumbnail).
    if (failure === undefined || failure.error.code === 'AttachmentRejected') {
      props.store.releaseThumbs(sent.files.map((file) => file.uri));
    }
    if (failure === undefined) return;
    // A compose left the user's own draft alone, so on failure its text is ADDED to what the user
    // has written (W2=1, Sergio 29/10/2026); a normal send emptied the box, so only an empty one
    // gets the text back.
    if (sent.compose === true) putInDraft(sent.text);
    else if (untrack(draft) === '') setDraft(sent.text);
    // An AttachmentRejected means the host refused those very files (it does not know their
    // URIs, e.g. after it restarted): putting the chips back would make the next send fail the
    // same way, so only the text comes back and the user attaches again.
    if (failure.error.code !== 'AttachmentRejected') props.store.addDraftFiles(sent.files);
    focusInput?.();
  });

  /** True while a fork waits for its result, or when there is no host to ask. */
  const forkDisabled = () => {
    const fork = lastFork();
    return !connected() || (fork !== undefined && state.pending.includes(fork.requestId));
  };

  // A finished fork refills the prompt (only an empty draft) and focuses it. Reads `pending` and
  // `notices` BEFORE the early return, like the effect above, so both stay dependencies.
  createEffect(() => {
    const pending = state.pending.slice();
    const notices = state.notices.slice();
    const fork = lastFork();
    if (fork === undefined || pending.includes(fork.requestId)) return;
    setLastFork(undefined);
    if (notices.some((notice) => notice.requestId === fork.requestId)) return;
    if (untrack(draft).trim() === '') {
      setDraft(fork.text);
      props.store.addDraftFiles(fork.files);
    }
    focusInput?.();
  });

  /**
   * True while a revert request waits for the host, when the session is busy (the server refuses
   * a revert then) or when there is no host to ask. Reads `pending` so it stays reactive.
   */
  const revertDisabled = () => {
    const inFlight = lastRevert()?.requestId ?? revertRequest();
    return !connected() || busy() || (inFlight !== undefined && state.pending.includes(inFlight));
  };

  // A prepared revert gives the text of its message back to the prompt (only an empty draft) and
  // focuses it. Reads `pending` and `notices` BEFORE the early return, like the fork effect.
  createEffect(() => {
    const pending = state.pending.slice();
    const notices = state.notices.slice();
    const revert = lastRevert();
    if (revert === undefined || pending.includes(revert.requestId)) return;
    setLastRevert(undefined);
    if (notices.some((notice) => notice.requestId === revert.requestId)) return;
    if (untrack(draft).trim() === '') {
      setDraft(revert.text);
      props.store.addDraftFiles(revert.files);
    }
    focusInput?.();
  });

  // A finished Restore or Discard for good (no notice) focuses the prompt: the button that had the
  // focus lives in the banner, which unmounts when the revert goes away. Same reads as above.
  createEffect(() => {
    const pending = state.pending.slice();
    const notices = state.notices.slice();
    const requestId = revertRequest();
    if (requestId === undefined || pending.includes(requestId)) return;
    setRevertRequest(undefined);
    if (notices.some((notice) => notice.requestId === requestId)) return;
    focusInput?.();
  });

  // The live region announces when a turn closes, never every token (solid-webview skill §7).
  createEffect(
    on(
      () => status()?.type,
      (current, previous) => {
        if (previous !== 'busy' && previous !== 'retry') return;
        let text: string | undefined;
        if (current === 'idle') text = stopRequested ? 'Stopped' : 'Response complete';
        const session = status();
        if (current === 'error' && session?.type === 'error') {
          // A status error is always announced as an error, `aborted` included (see isStopError).
          text = `Error: ${session.error.message}`;
        }
        if (text === undefined) return;
        stopRequested = false;
        // The same text twice is not announced again by a live region; alternate a trailing
        // no-break space so the node's content really changes.
        announcementFlip = !announcementFlip;
        setAnnouncement(announcementFlip ? text : `${text}${NO_BREAK_SPACE}`);
      },
    ),
  );

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (searchTimer !== undefined) clearTimeout(searchTimer);
  });

  /** Cancels the pending debounce and forgets the results: a late answer is then ignored. */
  const clearFileSearch = (): void => {
    if (searchTimer !== undefined) clearTimeout(searchTimer);
    searchTimer = undefined;
    props.store.clearFileSearch();
  };

  /**
   * The `@` popup asks for `query` (or reports it closed with `undefined`). A closed popup and the
   * bare `@` (empty query) forget everything; otherwise the request goes out once typing pauses
   * ({@link FILE_SEARCH_DEBOUNCE_MS}), with its own id so only its answer is accepted.
   */
  const searchFiles = (query: string | undefined): void => {
    if (query === undefined || query === '') {
      clearFileSearch();
      return;
    }
    if (searchTimer !== undefined) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = undefined;
      const requestId = nextRequestId();
      props.store.beginFileSearch(requestId, query);
      props.send({ type: 'files.search', requestId, query });
    }, FILE_SEARCH_DEBOUNCE_MS);
  };

  // The results belong to the conversation the user was typing in.
  createEffect(on(() => state.open.sessionID, clearFileSearch, { defer: true }));

  /**
   * Sends a prompt and starts waiting for its result. With `command` (issue #33) the host runs that
   * server command: `text` stays the full typed text for `lastSend` (what a failure gives back)
   * while the message carries only the arguments, and the files go without `mention`. With
   * `fromCompose` (a `prompt.compose` of the host) a failure appends the text to the user's draft
   * instead of restoring it only into an empty box.
   */
  const sendPrompt = (
    text: string,
    files: AttachmentRef[],
    command?: { name: string; args: string },
    fromCompose = false,
  ): void => {
    const requestId = nextRequestId();
    lastSend = { requestId, text, files, ...(fromCompose ? { compose: true } : {}) };
    // Only the dock lines of other sessions' requests go; the answers of the open session are
    // history in the conversation (`state.resolutions`) and stay.
    props.store.clearResolved();
    props.store.begin(requestId);
    clearFileSearch();
    props.send({
      type: 'prompt.send',
      requestId,
      ...(state.open.sessionID === undefined ? {} : { sessionID: state.open.sessionID }),
      ...(command === undefined ? { text } : { command: command.name, text: command.args }),
      delivery: 'queue',
      // `lastSend.files` stays the plain refs: a failed send puts those back as chips.
      files:
        command === undefined
          ? mentionsFor(text, files)
          : files.map((file) => ({ uri: file.uri, name: file.name })),
      ...selectionToSend(selectionInput()),
    });
    focusInput?.();
  };

  /**
   * Sends the draft (and pending attachments) if sending is allowed; blank drafts are ignored. A
   * draft that starts with a listed `/command` runs it (issue #33, see the header of {@link App}).
   */
  const submit = (): void => {
    const text = draft().trim();
    if (!canSend() || (text === '' && state.draftFiles.length === 0)) return;
    const command = parseCommand(text, state.catalog?.commands);
    const files = props.store.takeDraftFiles();
    history.push(text);
    setDraft('');
    persist();
    sendPrompt(text, files, command);
  };

  /** Interrupts the running turn; the session goes idle when the host relays the event. */
  const stop = (): void => {
    const sessionID = state.open.sessionID;
    if (sessionID === undefined || !busy()) return;
    const requestId = nextRequestId();
    stopRequested = true;
    props.store.begin(requestId);
    props.send({ type: 'session.abort', requestId, sessionID });
    focusInput?.();
  };

  /** Resends the last user message of the open session (there is no retry endpoint in v2). */
  const retry = (): void => {
    const message = lastUser();
    if (message === undefined || !canSend()) return;
    const files: AttachmentRef[] = [];
    for (const file of message.files) {
      const known = file.uri === undefined ? undefined : knownFiles.get(file.uri);
      if (known !== undefined) files.push(known);
    }
    sendPrompt(message.text, files);
  };

  /**
   * Asks the host to show the file picker ("Attach file…" and, with `kind: 'image'`, "Attach
   * image…" of the "+" menu, decision P11=1); the files arrive as `attachments.picked`.
   */
  const attach = (kind: 'file' | 'image' = 'file'): void => {
    const requestId = nextRequestId();
    props.store.begin(requestId);
    props.send(
      kind === 'image'
        ? { type: 'attachments.pick', requestId, kind }
        : { type: 'attachments.pick', requestId },
    );
  };

  /**
   * "Add selection" (issue #29): asks the host for the active file, or each non-empty selection of
   * it with its line range. The files arrive as `attachments.picked`, like Attach, and a problem
   * (no editor, a file not on disk) comes back as a notice through the `request.result`.
   */
  const addSelection = (): void => {
    if (!connected()) return;
    const requestId = nextRequestId();
    props.store.begin(requestId);
    props.send({ type: 'attachments.fromEditor', requestId });
  };

  /**
   * Removes a chip, frees the thumbnail of a pasted image, if it had one, and tells the host to
   * forget that image (`attachments.forget`, decision of 23/10/2026; the host ignores any other uri).
   */
  const removeFile = (uri: string): void => {
    props.store.releaseThumbs([uri]);
    props.store.removeDraftFile(uri);
    if (uri.startsWith('pasted-image:')) props.send({ type: 'attachments.forget', uri });
  };

  /**
   * Pasted images, and images dropped from the OS (issue #30). Each one is checked here (type and
   * size, no round trip for a refusal), read as base64 and sent in its own `attachments.image`
   * with a thumbnail waiting for the chip the host answers with (decision Q4 of Sergio). A model
   * that does not read images gets one warning, but the images are still attached (decision Q5:
   * the server tells the model it cannot read them). The bytes are copied into the message and
   * not kept here.
   */
  const addImages = (files: File[]): void => {
    if (!connected()) return;
    const model = effectiveModel(selectionInput())?.option;
    if (model !== undefined && !model.images) {
      props.store.notify('warning', {
        code: 'ModelCannotReadImages',
        message: 'The selected model cannot read images: it will be told so',
      });
    }
    for (const file of files) {
      void readImage(file).then((read) => {
        if (!read.ok) {
          props.store.notify('warning', { code: 'ImageRefused', message: read.message });
          return;
        }
        const requestId = nextRequestId();
        props.store.begin(requestId);
        props.store.expectThumb(requestId, URL.createObjectURL(file));
        props.send({ type: 'attachments.image', requestId, mime: read.mime, data: read.data });
      });
    }
  };

  /**
   * Something was dropped on the prompt box (issue #30). URIs from the Explorer go to the host,
   * which decides what may be attached; files from the OS have no path in a webview, so images
   * are treated as a paste and anything else gets the hint (decision Q6 of Sergio).
   */
  const dropped = (content: DropContent): void => {
    if (!connected() || content.kind === 'none') return;
    if (content.kind === 'uris') {
      // The host validator drops a whole `attachments.drop` that has an empty, NUL-carrying or too
      // long URI, or more than the cap, and a dropped message gets NO `request.result`: the request
      // would stay pending and lock Send (review of 23/10/2026, B1). So only what it accepts goes.
      const uris = content.uris
        .filter((uri) => uri !== '' && uri.length <= MAX_DROPPED_URI_LENGTH && !uri.includes('\0'))
        .slice(0, MAX_DROPPED_ITEMS);
      if (uris.length === 0) {
        props.store.notify('warning', {
          code: 'DropNotSupported',
          message: 'None of the dropped items could be attached',
        });
        return;
      }
      const requestId = nextRequestId();
      props.store.begin(requestId);
      props.send({ type: 'attachments.drop', requestId, uris });
      return;
    }
    const images = content.files.filter((file) => file.type.startsWith('image/'));
    if (images.length > 0) addImages(images);
    if (images.length < content.files.length) {
      props.store.notify('warning', {
        code: 'DropNotSupported',
        message: 'Drop files from the VS Code Explorer, or use the + menu',
      });
    }
  };

  /**
   * "New session" is LAZY (issue #20, decision of 21/10/2026): the host creates nothing, it only
   * forgets the open session, and the snapshot that follows empties the view; the first prompt then
   * creates the session. The input gets the focus so the user can start typing at once.
   */
  const newSession = (): void => {
    const requestId = nextRequestId();
    props.store.begin(requestId);
    props.send({ type: 'session.new', requestId });
    focusInput?.();
  };

  // Host commands (palette and keys, issue #35) run the code of the matching button, so every
  // invariant of the button holds: Send locked while the request is in flight, "Stopped" announced.
  // `New Session` is ignored while disconnected, like its disabled button; `Stop Response` with no
  // turn running says so instead of staying silent, because from the palette nothing else tells
  // the user the command did anything. It reads the queue length BEFORE any early return so the
  // effect keeps it as its dependency, then takes the WHOLE queue and runs it in order: several
  // commands can land in one frame (Stop and Focus Prompt kept for the same `ready`), and each must
  // run. New Session also closes the session list, as its button does.
  const [closePickerRequest, setClosePickerRequest] = createSignal(0);
  createEffect(() => {
    if (state.uiCommands.length === 0) return;
    untrack(() => {
      for (const command of props.store.takeUiCommands()) {
        switch (command) {
          case 'prompt.focus':
            focusInput?.();
            break;
          case 'session.new':
            setClosePickerRequest((count) => count + 1);
            if (connected()) newSession();
            else focusInput?.();
            break;
          case 'session.stop':
            if (busy()) stop();
            else
              props.store.notify('info', {
                code: 'NothingToStop',
                message: 'No response is running',
              });
            break;
        }
      }
    });
  });

  /**
   * Carries out one `prompt.compose` (issue #36, decisions P5/P6/P9/P12 of Sergio, 29/10/2026).
   *
   * With `send` and room to send ({@link canSend}) it goes through {@link sendPrompt}, the code of
   * Send and Retry, so the chosen model and agent, `lastSend` and the restore-on-failure apply, and
   * the user's draft and chips are left alone. Otherwise (`send` false: the host asks for a review,
   * as with a buffer with unsaved changes or a message that waited too long; or not connected; or
   * a request in flight or a busy session) the text goes to the prompt box: an empty draft is
   * replaced, a draft with text gets it on a new last line, and the chips are added without
   * duplicates, so nothing the user wrote is lost. A `send` that had to fall back says why in a
   * notice of its own; one the host asked to be a draft (`send` false) adds none here because the
   * HOST sent its own notice: `UnsavedChanges`, or `ComposeExpired` ("The prompt waited too
   * long: it is in the box") when it waited in a hidden pane past the TTL. If a compose that WAS
   * sent fails, the failure effect appends its text to the draft the same way (W2). A message out
   * of bounds ({@link isComposeInBounds}) is refused here, BEFORE `begin`: the host would drop its
   * `prompt.send` without a `request.result` and Send would stay locked.
   * VERIFIED by `App.test.tsx` "prompt.compose" (jsdom, fabricated host messages, 29/10/2026).
   * VERIFIED in a real window (`npm run test:visual`, Windows 11, VS Code 1.144.0, 29/10/2026,
   * full run): "C3 the draft the user was writing is untouched ("my draft", 0 chips)", "C6 while
   * a turn runs, Fix goes to the prompt box with its text and its chip and sends nothing", "C6 the
   * notice says "OpenCode is busy: the prompt is in the box"" and "C6 the prompt box has the
   * focus". UNVERIFIED in a real window: the not-connected fallback, a failed compose send (W2)
   * and the out-of-bounds refusal (only jsdom runs them).
   */
  const runCompose = (compose: { text: string; files: AttachmentRef[]; send: boolean }): void => {
    if (!isComposeInBounds(compose)) {
      props.store.notify('warning', {
        code: 'ComposeRefused',
        message: 'The prompt from the context menu could not be used',
      });
      return;
    }
    if (compose.send && canSend()) {
      sendPrompt(compose.text, compose.files, undefined, true);
      return;
    }
    putInDraft(compose.text);
    props.store.addDraftFiles(compose.files);
    if (compose.send) {
      props.store.notify('info', {
        code: 'ComposeInDraft',
        message: connected()
          ? 'OpenCode is busy: the prompt is in the box'
          : 'OpenCode is not connected yet: the prompt is in the box',
      });
    }
    focusInput?.();
  };

  // `prompt.compose` queue (issue #36): reads the length BEFORE the early return so the effect keeps
  // it as its dependency, then takes the WHOLE queue and runs it in order. Two composes in one
  // frame are two runs: the first may begin a request, which makes the second fall to the draft.
  createEffect(() => {
    if (state.composes.length === 0) return;
    untrack(() => {
      for (const compose of props.store.takeComposes()) runCompose(compose);
    });
  });

  // Tells the host whether this document has the keyboard focus (issue #35): it mirrors it into the
  // `openVsCode.chatFocused` context key for the keybindings. The initial value goes out now
  // because a document opened by a command may already hold the focus and fire no `focus` event.
  const sendFocus = (focused: boolean) => () => {
    props.send({ type: 'chat.focusChanged', focused });
  };
  const onWindowFocus = sendFocus(true);
  const onWindowBlur = sendFocus(false);
  window.addEventListener('focus', onWindowFocus);
  window.addEventListener('blur', onWindowBlur);
  onCleanup(() => {
    window.removeEventListener('focus', onWindowFocus);
    window.removeEventListener('blur', onWindowBlur);
  });
  props.send({ type: 'chat.focusChanged', focused: document.hasFocus() });

  /**
   * Asks the host to fork the open session before `message` (a user message). The text and the
   * attachments it carried that this document knows are kept for the refill once the host answers
   * (see the effect above). Does nothing without an open session, without a connection or while
   * another fork is in flight.
   */
  const forkFrom = (message: UserMessage): void => {
    const sessionID = state.open.sessionID;
    if (sessionID === undefined || forkDisabled()) return;
    const files: AttachmentRef[] = [];
    for (const file of message.files) {
      const known = file.uri === undefined ? undefined : knownFiles.get(file.uri);
      if (known !== undefined) files.push(known);
    }
    const requestId = nextRequestId();
    // `begin` BEFORE `setLastFork`: the click handler is not batched, so the effect that refills
    // the prompt runs as soon as `lastFork` is set and must already find the request pending
    // (caught by the first run of its test: the prompt was refilled before the host answered).
    props.store.begin(requestId);
    setLastFork({ requestId, text: message.text, files });
    props.send({ type: 'session.fork', requestId, sessionID, messageID: message.id });
  };

  /**
   * Asks the host to prepare a revert from `message` (a user message): the history from it on is
   * hidden and the files the agent touched after it are put back on disk. The text and the known
   * attachments of the message are kept to refill the prompt once the host answers (see the effect
   * above). Does nothing without an open session or while {@link revertDisabled}.
   */
  const revertFrom = (message: UserMessage): void => {
    const sessionID = state.open.sessionID;
    if (sessionID === undefined || revertDisabled()) return;
    const files: AttachmentRef[] = [];
    for (const file of message.files) {
      const known = file.uri === undefined ? undefined : knownFiles.get(file.uri);
      if (known !== undefined) files.push(known);
    }
    const requestId = nextRequestId();
    // `begin` BEFORE `setLastRevert`, for the reason given in `forkFrom`.
    props.store.begin(requestId);
    setLastRevert({ requestId, text: message.text, files });
    props.send({ type: 'session.revert.stage', requestId, sessionID, messageID: message.id });
  };

  /**
   * "Restore" or "Discard for good" of the revert block: one request, the host does the rest.
   * When it finishes without a notice the prompt gets the focus (see the effect above), because
   * the banner that held it disappears. Cancelling the "Discard for good" modal also finishes
   * without a notice, so the focus moves to the prompt while the block stays: accepted, harmless
   * (review-2 of E7-message-revert). Does nothing while {@link revertDisabled}.
   */
  const finishRevert = (type: 'session.revert.clear' | 'session.revert.commit'): void => {
    const sessionID = state.open.sessionID;
    if (sessionID === undefined || revertDisabled()) return;
    const requestId = nextRequestId();
    props.store.begin(requestId);
    setRevertRequest(requestId);
    props.send({ type, requestId, sessionID });
  };

  /** Opens the diff of what the revert undid in one file of the revert block. */
  const openRevertedFile = (path: string): void => {
    const sessionID = state.open.sessionID;
    if (sessionID === undefined) return;
    props.send({ type: 'session.revert.open', sessionID, path });
  };

  /** Opens a session chosen in the session list (the same message the request dock uses). */
  const openSession = (sessionID: string): void => {
    const requestId = nextRequestId();
    props.store.begin(requestId);
    props.send({ type: 'session.open', requestId, sessionID });
    focusInput?.();
  };

  /**
   * Asks the host to open the diff of a row of "Changed files" (issue #31). The host opens it only
   * if it listed that path for the open session, so a stale click costs a notice, nothing more.
   * No `requestId`: like `editor.open`, a failure comes back as a notice.
   */
  const openChangedFile = (path: string): void => {
    const sessionID = state.open.sessionID;
    if (sessionID === undefined) return;
    props.send({ type: 'session.diff.open', sessionID, path });
  };

  return (
    <HostContext.Provider value={props.send}>
      <div class="app" data-connection={state.connection.state}>
        <Show
          when={!guideVisible()}
          fallback={
            <SetupGuide
              connection={state.connection}
              catalog={state.catalog}
              binaryCheck={state.binaryCheck}
              onChoose={props.store.beginBinaryChoice}
            />
          }
        >
          <Header
            store={props.store}
            onNewSession={newSession}
            closePickerRequest={closePickerRequest()}
            onOpenSession={openSession}
            onOpenChangedFile={openChangedFile}
          />
          <main class="chat-main">
            <Show
              when={state.open.messages.length > 0}
              fallback={
                <Show
                  when={problem()}
                  fallback={
                    <EmptyState
                      onPick={(text) => {
                        setDraft(text);
                        focusInput?.();
                      }}
                    />
                  }
                >
                  {(current) => <ConnectionCard problem={current()} />}
                </Show>
              }
            >
              <MessageList
                open={state.open}
                messages={messages()}
                catalog={state.catalog}
                resolutions={state.resolutions}
                requests={state.requests}
                busy={busy()}
                canRetry={lastUser() !== undefined}
                forkDisabled={forkDisabled()}
                revertDisabled={revertDisabled()}
                onRetry={retry}
                onFork={forkFrom}
                onRevert={revertFrom}
                onOpenSession={openSession}
                trailing={
                  <Show when={problem()}>
                    {(current) => <ConnectionCard problem={current()} />}
                  </Show>
                }
              />
            </Show>
          </main>
          <Show when={state.open.revert}>
            {(revert) => (
              <RevertBanner
                revert={revert()}
                split={split()}
                disabled={revertDisabled()}
                onRestore={() => {
                  finishRevert('session.revert.clear');
                }}
                onDiscard={() => {
                  finishRevert('session.revert.commit');
                }}
                onOpenFile={openRevertedFile}
              />
            )}
          </Show>
          <RequestDock
            store={props.store}
            typing={draft().trim() !== ''}
            focusInput={() => {
              focusInput?.();
            }}
          />
          <StatusBar
            state={state}
            activity={activity()}
            announcement={announcement()}
            canRetry={lastUser() !== undefined && canSend() && !lastMessageHasError()}
            onRetry={retry}
            onDismiss={props.store.dismissNotice}
          />
          <PromptInput
            draft={draft()}
            onDraft={(text) => {
              setDraft(text);
            }}
            history={history}
            files={state.draftFiles}
            busy={busy()}
            waiting={!connected()}
            sendDisabled={!canSend()}
            attachDisabled={!connected()}
            commands={state.catalog?.commands}
            commandsLoading={state.catalog === undefined}
            commandsDisabled={!connected()}
            fileSearch={state.fileSearch}
            onMentionQuery={searchFiles}
            onMentionPick={(file) => {
              // Plain copy: the chip is read back into a `postMessage` when the prompt is sent.
              props.store.addDraftFiles([{ uri: file.uri, name: file.name }]);
              clearFileSearch();
            }}
            onSubmit={submit}
            onStop={stop}
            onAttach={() => {
              attach('file');
            }}
            onAttachImage={() => {
              attach('image');
            }}
            onAddSelection={addSelection}
            onRemoveFile={removeFile}
            onDrop={dropped}
            onPasteImages={addImages}
            thumbs={state.thumbs}
            onFocusReady={(focus) => {
              // Same rule as the "+" menu: the focus moving by code closes the chip's panel too.
              focusInput = () => {
                closeChipPanel?.();
                focus();
              };
            }}
            selectors={
              <AgentModelMenu
                onCloseReady={(close) => {
                  closeChipPanel = close;
                }}
                catalog={state.catalog}
                agent={effectiveAgent(selectionInput())}
                model={effectiveModel(selectionInput())}
                variants={variantChoices(effectiveModel(selectionInput()))}
                connection={state.connection.state}
                disabled={!connected()}
                onSelectAgent={props.store.selectAgent}
                onSelectModel={props.store.selectModel}
                onSelectVariant={(variant) => {
                  const effective = effectiveModel(selectionInput());
                  if (effective !== undefined) {
                    props.store.selectModel(withVariant(effective.ref, variant));
                  }
                }}
              />
            }
          />
        </Show>
      </div>
    </HostContext.Provider>
  );
}
