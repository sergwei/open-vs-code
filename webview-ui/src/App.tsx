import { createEffect, createMemo, createSignal, on, Show, untrack } from 'solid-js';
import type { AttachmentRef } from '../../src/shared/protocol';
import { EmptyState } from './chat/EmptyState';
import { Header } from './chat/Header';
import { HostContext, type SendToHost } from './chat/hostContext';
import { MessageList, type UserMessage } from './chat/MessageList';
import { nextRequestId, PromptInput } from './chat/PromptInput';
import { createHistory } from './chat/promptHistory';
import { StatusBar } from './chat/StatusBar';
import { RequestDock } from './requests/RequestDock';
import { AgentToggle } from './selectors/AgentToggle';
import { ModelPicker } from './selectors/ModelPicker';
import {
  effectiveAgent,
  effectiveModel,
  selectionToSend,
  type SelectionInput,
} from './selectors/selection';
import { deriveActivity } from './store/activity';
import type { ChatStore } from './store/chatStore';
import type { UiState } from './uiState';

/** Built from its code point: a literal one in the source trips `no-irregular-whitespace`. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** What the last `prompt.send` carried, so a failed send can give the user their text back. */
interface LastSend {
  requestId: string;
  text: string;
  files: AttachmentRef[];
}

/** What the last `session.fork` carried: the text (and known files) to refill the prompt with. */
interface LastFork {
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
 * Issues #23/#24 put the agent switch and the model picker in the prompt row (decision of 21/10/2026,
 * Engram #1012: both in the row, not the header) and make the choice a DRAFT in the store:
 * `sendPrompt` (Send and Retry alike) adds the model and agent the next prompt would use
 * (`selectionToSend`) and the host validates and applies them just before the prompt. Nothing is
 * sent to the host when the user picks. The draft is persisted with the prompt draft, keyed by the
 * open session, and restored into the store at start.
 *
 * Decisions: Send is disabled while the session is busy and Stop takes its place (plan decision
 * 6; `steer`/`queue` while busy is not offered); every prompt goes with `delivery: 'queue'`;
 * Retry resends the text of the last user message of the open session, with the attachments of
 * it that this document picked itself (the host only accepts URIs its picker emitted; HYPOTHESIS
 * that the server echoes the same URI back in the user message, so a mismatch drops the file).
 * The "Stopped" announcement is decided by a flag set when Stop is pressed, so an abort the
 * server refuses and a turn that then ends on its own would still say "Stopped" (accepted).
 * VERIFIED by `App.test.tsx` in jsdom with a fake host; UNVERIFIED in a real webview (themes,
 * focus order, screen reader) until the F5.
 */
export function App(props: { store: ChatStore; send: SendToHost; uiState: UiState }) {
  const state = props.store.state;
  const history = createHistory(props.uiState.history);
  // Attachments pending when the view was last hidden. The host keeps the URIs its picker
  // emitted for as long as it lives, so they are still accepted; if the host restarted, the send
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
  let lastSend: LastSend | undefined;
  const [lastFork, setLastFork] = createSignal<LastFork | undefined>(undefined);
  let stopRequested = false;
  let announcementFlip = false;
  /** Every file picked in this document, to validate what Retry may re-attach. */
  const knownFiles = new Map<string, AttachmentRef>();

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
    for (let index = state.open.messages.length - 1; index >= 0; index--) {
      const message = state.open.messages[index];
      if (message?.kind === 'user') return [];
      if (message?.kind === 'assistant') return state.open.parts[message.id] ?? [];
    }
    return [];
  };
  const activity = createMemo(() =>
    deriveActivity(state.connection, status(), lastAssistantParts()),
  );
  const lastUser = () => {
    for (let index = state.open.messages.length - 1; index >= 0; index--) {
      const message = state.open.messages[index];
      if (message?.kind === 'user') return message;
    }
    return undefined;
  };
  /** True when the newest message is an assistant message with its own error (it has a Retry). */
  const lastMessageHasError = () => {
    const message = state.open.messages[state.open.messages.length - 1];
    return message?.kind === 'assistant' && message.error !== undefined;
  };
  const connected = () => state.connection.state === 'connected';
  const canSend = () => connected() && !busy() && state.pending.length === 0;
  /** What the selectors and the next `prompt.send` read: catalog, open session row and draft. */
  const selectionInput = (): SelectionInput => ({
    catalog: state.catalog,
    hasSession: state.open.sessionID !== undefined,
    row: state.open.sessionID === undefined ? undefined : state.sessions[state.open.sessionID],
    draft: { model: state.selection.model, agent: state.selection.agent },
  });

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
    if (failure === undefined) return;
    if (untrack(draft) === '') setDraft(sent.text);
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

  /** Sends a prompt and starts waiting for its result. */
  const sendPrompt = (text: string, files: AttachmentRef[]): void => {
    const requestId = nextRequestId();
    lastSend = { requestId, text, files };
    // Only the dock lines of other sessions' requests go; the answers of the open session are
    // history in the conversation (`state.resolutions`) and stay.
    props.store.clearResolved();
    props.store.begin(requestId);
    props.send({
      type: 'prompt.send',
      requestId,
      ...(state.open.sessionID === undefined ? {} : { sessionID: state.open.sessionID }),
      text,
      delivery: 'queue',
      files,
      ...selectionToSend(selectionInput()),
    });
    focusInput?.();
  };

  /** Sends the draft (and pending attachments) if sending is allowed; blank drafts are ignored. */
  const submit = (): void => {
    const text = draft().trim();
    if (!canSend() || (text === '' && state.draftFiles.length === 0)) return;
    const files = props.store.takeDraftFiles();
    history.push(text);
    setDraft('');
    persist();
    sendPrompt(text, files);
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

  /** Asks the host to show the file picker; the files arrive as `attachments.picked`. */
  const attach = (): void => {
    const requestId = nextRequestId();
    props.store.begin(requestId);
    props.send({ type: 'attachments.pick', requestId });
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

  /** Opens a session chosen in the session list (the same message the request dock uses). */
  const openSession = (sessionID: string): void => {
    const requestId = nextRequestId();
    props.store.begin(requestId);
    props.send({ type: 'session.open', requestId, sessionID });
    focusInput?.();
  };

  return (
    <HostContext.Provider value={props.send}>
      <div class="app">
        <Header store={props.store} onNewSession={newSession} onOpenSession={openSession} />
        <main class="chat-main">
          <Show
            when={state.open.messages.length > 0}
            fallback={
              <EmptyState
                onPick={(text) => {
                  setDraft(text);
                  focusInput?.();
                }}
              />
            }
          >
            <MessageList
              open={state.open}
              catalog={state.catalog}
              resolutions={state.resolutions}
              busy={busy()}
              canRetry={lastUser() !== undefined}
              forkDisabled={forkDisabled()}
              onRetry={retry}
              onFork={forkFrom}
              onOpenSession={openSession}
            />
          </Show>
        </main>
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
          sendDisabled={!canSend()}
          attachDisabled={!connected()}
          onSubmit={submit}
          onStop={stop}
          onAttach={attach}
          onRemoveFile={props.store.removeDraftFile}
          onFocusReady={(focus) => {
            focusInput = focus;
          }}
          selectors={
            <>
              <AgentToggle
                catalog={state.catalog}
                effective={effectiveAgent(selectionInput())}
                disabled={!connected()}
                onSelect={props.store.selectAgent}
              />
              <ModelPicker
                catalog={state.catalog}
                effective={effectiveModel(selectionInput())}
                disabled={!connected()}
                onSelect={props.store.selectModel}
              />
            </>
          }
        />
      </div>
    </HostContext.Provider>
  );
}
