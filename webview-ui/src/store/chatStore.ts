/**
 * Reactive store of the chat (issue #14): turns the host-to-webview protocol into Solid state.
 *
 * PURE with respect to VS Code: it never calls `acquireVsCodeApi` and imports nothing from the
 * host, so Vitest drives it without DOM. `apply` is exhaustive over `HostToWebview` through
 * `dispatch` + `Handlers`, so a new protocol message cannot be forgotten.
 *
 * Why it is written this way (skill solid-webview §2, §3):
 *  - `<For>` decides by object identity, so a message or part that changes must keep its object:
 *    `part.upserted` and `message.upserted` reconcile into the existing object, and `part.delta`
 *    appends to the leaf (`text` / `state.input`) through `produce`. Replacing the object would
 *    destroy and rebuild its DOM on every token.
 *  - Positions of messages and parts are kept in plain `Map` indexes OUTSIDE the store (O(1),
 *    not reactive), rebuilt on `snapshot` and on removals. A stale index would write into the
 *    wrong part, hence `rebuildIndexes`.
 *  - A delta for an unknown message or block is dropped: deltas are not idempotent, the next
 *    `*.upserted` from the host repairs the block.
 *  - Phase 2 (issues #13/#16) adds the attachments chosen with Attach (`draftFiles`, no two with
 *    the same `uri`, filled by `attachments.picked`) and dismissible notices; a notice born from a
 *    failed request carries its `requestId`, so the UI can restore the unsent prompt.
 *  - Phase 3 (issues #18/#44) adds the pending requests of the WHOLE location (`requests`, not
 *    tied to the open session: a subagent asks from its own session), the one-line results that
 *    stay after a request is answered (`resolved`, at most {@link MAX_RESOLVED}, cleared on the next
 *    prompt), the cards waiting for the server's answer (`replying`, by ask id) with the error of
 *    the last failed answer (`requestErrors`), and the pending `ui.focus` target. A request leaves
 *    the store only through `*.resolved` or a snapshot that no longer lists it.
 * VERIFIED by `chatStore.test.ts` with fabricated messages (confirms this logic, not the host
 * contract). UNVERIFIED in a real webview until the F5 of issue #14.
 */
import { batch } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import type {
  ErrorInfo,
  FormAsk,
  MessageInfo,
  Part,
  PermissionAsk,
  SessionStatus,
  SessionSummary,
} from '../../../src/shared/model';
import {
  dispatch,
  type AttachmentRef,
  type ConnectionState,
  type Handlers,
  type HostToWebview,
} from '../../../src/shared/protocol';
import { describeRequest, outcomeLabel } from '../requests/permissionText';

/** Most one-line results kept after requests are answered. Our own choice for a narrow view. */
export const MAX_RESOLVED = 5;

/** Error codes that mean "that request is no longer pending": the user is told even with the card gone. */
const STALE_REQUEST_CODES = new Set([
  'PermissionNotFoundError',
  'FormNotFoundError',
  'FormAlreadySettledError',
  'RequestNotPending', // raised by the host when its own registry does not know the request
]);

/** Where `ui.focus` points. */
export type FocusTarget = Extract<HostToWebview, { type: 'ui.focus' }>['target'];

/** The line that stays after a request is answered, e.g. "Allowed once: Read .env". */
export interface ResolvedRequest {
  /** The request id; unique, used as the list key. */
  id: string;
  /** Wording of the outcome ("Allowed once", "Rejected", "Answered", "Dismissed"). */
  outcome: string;
  /** What was asked ("Read .env", the form title). */
  label: string;
}

/** Most notices kept; older ones are dropped first. Our own choice for a one-line UI. */
export const MAX_NOTICES = 5;

/**
 * A message for the user raised by the host (`notice`) or by a failed request. `requestId` is set
 * only for the second kind: it lets the UI restore the draft of a prompt that failed to send.
 */
export interface Notice {
  id: number;
  level: 'info' | 'warning' | 'error';
  error: ErrorInfo;
  requestId?: string;
}

/** The session being shown. `sessionID` is `undefined` before the first prompt creates one. */
export interface OpenView {
  sessionID: string | undefined;
  messages: MessageInfo[];
  parts: { [messageID: string]: Part[] };
}

/** Everything the UI reads. */
export interface ChatState {
  connection: ConnectionState;
  sessions: { [sessionID: string]: SessionSummary };
  statuses: { [sessionID: string]: SessionStatus };
  open: OpenView;
  /** Pending permissions and forms of ANY session of the location, in order of arrival. */
  requests: { permissions: PermissionAsk[]; forms: FormAsk[] };
  /** Results of answered requests, oldest first, until the next prompt is sent. */
  resolved: ResolvedRequest[];
  /** Ask id -> `requestId` of the reply or cancel in flight; the card shows "Sending…" and locks. */
  replying: { [askId: string]: string };
  /** Ask id -> the error the server gave to the last reply, shown inside the card. */
  requestErrors: { [askId: string]: ErrorInfo };
  /** A `ui.focus` the dock has not carried out yet (the card may not exist yet). */
  focusTarget: FocusTarget | undefined;
  /** `requestId`s sent and not answered yet; the input stays disabled while any is in flight. */
  pending: string[];
  notices: Notice[];
  /** Files chosen with Attach and not sent yet; no two share a `uri`. */
  draftFiles: AttachmentRef[];
}

/** What {@link createChatStore} returns. */
export interface ChatStore {
  state: ChatState;
  /** Applies one host message. Call it inside `batch` when applying several. */
  apply: (message: HostToWebview) => void;
  /** Marks `requestId` as in flight, until a `request.result` with that id arrives. */
  begin: (requestId: string) => void;
  /** Removes the notice with that id (the user dismissed it). */
  dismissNotice: (id: number) => void;
  /** Adds files to the draft attachments, skipping any `uri` already there. */
  addDraftFiles: (files: readonly AttachmentRef[]) => void;
  /** Removes one draft attachment (the chip's remove button). */
  removeDraftFile: (uri: string) => void;
  /** Returns the draft attachments and empties the list (the prompt is being sent). */
  takeDraftFiles: () => AttachmentRef[];
  /**
   * Marks the card of `askId` as waiting for the server (reply or cancel with `requestId`) and
   * forgets its previous error. The mark goes away with the request's `*.resolved` or with a
   * `request.result` that carries an error (stored in `requestErrors`).
   */
  beginReply: (askId: string, requestId: string) => void;
  /** Forgets the one-line results of answered requests (a new prompt starts a new turn). */
  clearResolved: () => void;
  /** Forgets the pending `ui.focus` target (the dock carried it out). */
  clearFocusTarget: () => void;
}

/** Empty open view: no session yet. */
function emptyOpen(): OpenView {
  return { sessionID: undefined, messages: [], parts: {} };
}

/**
 * Creates the store. Call it inside a reactive root (or `createRoot` in tests) so the signals
 * it creates have an owner.
 */
export function createChatStore(): ChatStore {
  const [state, setState] = createStore<ChatState>({
    connection: { state: 'starting' },
    sessions: {},
    statuses: {},
    open: emptyOpen(),
    requests: { permissions: [], forms: [] },
    resolved: [],
    replying: {},
    requestErrors: {},
    focusTarget: undefined,
    pending: [],
    notices: [],
    draftFiles: [],
  });

  // Non-reactive indexes: message id -> position, and message id -> part id -> position.
  let messageIndex = new Map<string, number>();
  let partIndex = new Map<string, Map<string, number>>();
  let noticeCounter = 0;

  /** Rebuilds both indexes from the current store contents. */
  const rebuildIndexes = (): void => {
    messageIndex = new Map(state.open.messages.map((message, index) => [message.id, index]));
    partIndex = new Map(
      Object.entries(state.open.parts).map(([messageID, parts]) => [
        messageID,
        new Map(parts.map((part, index) => [part.id, index])),
      ]),
    );
  };

  /** True when `sessionID` is the session being shown. */
  const isOpen = (sessionID: string): boolean => state.open.sessionID === sessionID;

  const addNotice = (level: Notice['level'], error: ErrorInfo, requestId?: string): void => {
    const notice: Notice = {
      id: ++noticeCounter,
      level,
      error,
      ...(requestId === undefined ? {} : { requestId }),
    };
    setState('notices', (notices) => [...notices, notice].slice(-MAX_NOTICES));
  };

  const addDraftFiles = (files: readonly AttachmentRef[]): void => {
    const known = new Set(state.draftFiles.map((file) => file.uri));
    const fresh: AttachmentRef[] = [];
    for (const file of files) {
      if (known.has(file.uri)) continue;
      known.add(file.uri);
      fresh.push(file);
    }
    if (fresh.length > 0) setState('draftFiles', (current) => [...current, ...fresh]);
  };

  /** Forgets the in-flight mark and the error of a card that is going away. */
  const forgetAsk = (askId: string): void => {
    setState(
      'replying',
      produce((replying) => {
        delete replying[askId];
      }),
    );
    setState(
      'requestErrors',
      produce((errors) => {
        delete errors[askId];
      }),
    );
  };

  /** Appends a result line, dropping the oldest beyond {@link MAX_RESOLVED}. */
  const addResolved = (line: ResolvedRequest): void => {
    setState('resolved', (lines) =>
      [...lines.filter((existing) => existing.id !== line.id), line].slice(-MAX_RESOLVED),
    );
  };

  const handlers: Handlers<HostToWebview> = {
    'connection.state': (m) => {
      batch(() => {
        setState('connection', reconcile(m.connection));
        // The requests of a server that is starting, gone or stopped died with it; their cards
        // would keep live buttons that only answer ServerUnavailable (W2 of the review). Not on
        // `reconnecting`: that is also the SSE loop retrying against a server that is still up,
        // and its next snapshot replaces the set anyway.
        const state = m.connection.state;
        if (state === 'starting' || state === 'unavailable' || state === 'stopped') {
          setState('requests', { permissions: [], forms: [] });
          setState('replying', reconcile({}));
          setState('requestErrors', reconcile({}));
        }
      });
    },

    snapshot: (m) => {
      const { snapshot } = m;
      setState(
        'sessions',
        reconcile(Object.fromEntries(snapshot.sessions.map((session) => [session.id, session]))),
      );
      setState('statuses', reconcile(snapshot.statuses));
      const open = snapshot.open;
      setState(
        'open',
        reconcile(
          open === undefined
            ? emptyOpen()
            : { sessionID: open.sessionID, messages: open.messages, parts: open.parts },
          { key: 'id' },
        ),
      );
      rebuildIndexes();
      // The snapshot is the whole pending set: what it no longer lists is gone, so its card state
      // (in flight, error) must not outlive it.
      const alive = new Set([
        ...snapshot.requests.permissions.map((ask) => ask.id),
        ...snapshot.requests.forms.map((ask) => ask.id),
      ]);
      setState('requests', reconcile(snapshot.requests, { key: 'id' }));
      for (const askId of [...Object.keys(state.replying), ...Object.keys(state.requestErrors)]) {
        if (!alive.has(askId)) forgetAsk(askId);
      }
      // A snapshot also ends the lock of an answer the server accepted (see `request.result`).
      setState('replying', reconcile({}));
      // A `ui.focus` for a request this snapshot does not list will never find its card (S4).
      const target = state.focusTarget;
      if (target !== undefined && !alive.has(target.id)) setState('focusTarget', undefined);
    },

    'session.upserted': (m) => {
      setState('sessions', m.session.id, reconcile(m.session));
    },

    'session.removed': (m) => {
      setState(
        'sessions',
        produce((sessions) => {
          delete sessions[m.sessionID];
        }),
      );
      setState(
        'statuses',
        produce((statuses) => {
          delete statuses[m.sessionID];
        }),
      );
      if (isOpen(m.sessionID)) {
        setState('open', reconcile(emptyOpen(), { key: 'id' }));
        rebuildIndexes();
      }
    },

    'session.status': (m) => {
      setState('statuses', m.sessionID, reconcile(m.status));
    },

    'message.upserted': (m) => {
      if (!isOpen(m.sessionID)) return;
      const index = messageIndex.get(m.message.id);
      if (index !== undefined) {
        setState('open', 'messages', index, reconcile(m.message));
        return;
      }
      const next = state.open.messages.length;
      setState('open', 'messages', next, m.message);
      messageIndex.set(m.message.id, next);
    },

    'message.removed': (m) => {
      if (!isOpen(m.sessionID)) return;
      setState('open', 'messages', (messages) =>
        messages.filter((message) => message.id !== m.messageID),
      );
      setState(
        'open',
        'parts',
        produce((parts) => {
          delete parts[m.messageID];
        }),
      );
      rebuildIndexes();
    },

    'part.upserted': (m) => {
      if (!isOpen(m.sessionID)) return;
      if (state.open.parts[m.messageID] === undefined) {
        setState('open', 'parts', m.messageID, []);
        partIndex.set(m.messageID, new Map());
      }
      const index = partIndex.get(m.messageID)?.get(m.part.id);
      if (index !== undefined) {
        setState('open', 'parts', m.messageID, index, reconcile(m.part));
        return;
      }
      const next = state.open.parts[m.messageID]?.length ?? 0;
      setState('open', 'parts', m.messageID, next, m.part);
      let positions = partIndex.get(m.messageID);
      if (positions === undefined) {
        positions = new Map();
        partIndex.set(m.messageID, positions);
      }
      positions.set(m.part.id, next);
    },

    'part.delta': (m) => {
      if (!isOpen(m.sessionID)) return;
      const index = partIndex.get(m.messageID)?.get(m.partID);
      if (index === undefined) return;
      setState(
        'open',
        'parts',
        m.messageID,
        index,
        produce((part) => {
          if (m.field === 'text') {
            if (part.type === 'text' || part.type === 'reasoning') part.text += m.delta;
          } else if (part.type === 'tool' && part.state.status === 'streaming') {
            part.state.input += m.delta;
          }
        }),
      );
    },

    // Requests are NOT filtered by session: a subagent asks from its own child session.
    'permission.asked': (m) => {
      if (state.requests.permissions.some((ask) => ask.id === m.permission.id)) return;
      setState('requests', 'permissions', state.requests.permissions.length, m.permission);
    },

    'permission.resolved': (m) => {
      batch(() => {
        const ask = state.requests.permissions.find((known) => known.id === m.permissionID);
        if (ask !== undefined) {
          addResolved({
            id: ask.id,
            outcome: outcomeLabel(m.decision),
            label: describeRequest(ask),
          });
        }
        setState('requests', 'permissions', (asks) =>
          asks.filter((known) => known.id !== m.permissionID),
        );
        forgetAsk(m.permissionID);
      });
    },

    'form.asked': (m) => {
      if (state.requests.forms.some((ask) => ask.id === m.form.id)) return;
      setState('requests', 'forms', state.requests.forms.length, m.form);
    },

    'form.resolved': (m) => {
      batch(() => {
        const ask = state.requests.forms.find((known) => known.id === m.formID);
        if (ask !== undefined) {
          addResolved({
            id: ask.id,
            outcome: m.outcome === 'answered' ? 'Answered' : 'Dismissed',
            label: ask.kind === 'question' ? 'Question from the agent' : ask.title,
          });
        }
        setState('requests', 'forms', (asks) => asks.filter((known) => known.id !== m.formID));
        forgetAsk(m.formID);
      });
    },

    'request.result': (m) => {
      // One batch: a reader (the restore of an unsent prompt) must never see the request gone
      // from `pending` before its failure notice exists.
      batch(() => {
        setState('pending', (pending) => pending.filter((id) => id !== m.requestId));
        const askId = Object.keys(state.replying).find((id) => state.replying[id] === m.requestId);
        if (askId !== undefined) {
          // The answer of a card: the card shows its own error, so no notice, except when the
          // request is gone (nothing on screen would tell the user why nothing happened).
          // On SUCCESS the card stays locked: the server accepted the answer, and the card goes
          // away with `*.resolved` (about 10-17 ms later in the real logs) or at the next
          // snapshot; unlocking it here allowed a second click that was answered NotFound (W6).
          if (m.error !== undefined) {
            setState(
              'replying',
              produce((replying) => {
                delete replying[askId];
              }),
            );
            setState('requestErrors', askId, m.error);
            if (STALE_REQUEST_CODES.has(m.error.code)) addNotice('error', m.error);
          }
          return;
        }
        if (m.error !== undefined) addNotice('error', m.error, m.requestId);
      });
    },

    'attachments.picked': (m) => {
      addDraftFiles(m.files);
    },

    'ui.focus': (m) => {
      setState('focusTarget', m.target);
    },

    notice: (m) => {
      addNotice(m.level, m.error);
    },
  };

  return {
    state,
    apply: (message) => {
      dispatch(message, handlers);
    },
    begin: (requestId) => {
      setState('pending', (pending) => [...pending, requestId]);
    },
    dismissNotice: (id) => {
      setState('notices', (notices) => notices.filter((notice) => notice.id !== id));
    },
    addDraftFiles,
    removeDraftFile: (uri) => {
      setState('draftFiles', (files) => files.filter((file) => file.uri !== uri));
    },
    takeDraftFiles: () => {
      const taken = [...state.draftFiles];
      setState('draftFiles', []);
      return taken;
    },
    beginReply: (askId, requestId) => {
      batch(() => {
        setState(
          'requestErrors',
          produce((errors) => {
            delete errors[askId];
          }),
        );
        // Not added to `pending`: answering a card must not lock the prompt box.
        setState('replying', askId, requestId);
      });
    },
    clearResolved: () => {
      setState('resolved', []);
    },
    clearFocusTarget: () => {
      setState('focusTarget', undefined);
    },
  };
}
