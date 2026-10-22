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
 *  - E3-resolved-history (issues #56/#18) adds `resolutions`: the host's record of each answered
 *    request of the OPEN session, by request id, which the conversation hangs under the tool that
 *    asked. A `*.resolved` of the open session that carries its record goes there and adds NO line
 *    to `resolved`; one of another session (a subagent) or without a record keeps the dock line
 *    until the next prompt (decision of Sergio, 21/10/2026). A snapshot replaces `resolutions`.
 *  - E4-session-management (issue #20) adds the rows of the session list (`browser`, filled by
 *    `sessions.page` and kept in step by `session.upserted` / `session.removed`) and the rename /
 *    delete in flight (`sessionOps`). Neither goes through `pending`: a list query or a rename must
 *    not disable Send. A page is accepted only if it answers the LAST query (`browser.requestId`),
 *    so typing quickly cannot show the rows of an older search. `session.removed` also drops the
 *    request cards of that session: the server deletes its pending requests WITHOUT a `*.replied`.
 *  - E5-model-agent-selectors (issues #23/#24) adds the `catalog` (models, providers, selectable
 *    agents, replaced whole by each `catalog` message) and the user's `selection` DRAFT: the model
 *    and agent picked for the NEXT prompt. The draft belongs to one session (`selection.sessionID`,
 *    `undefined` before the first prompt creates it) and is emptied whenever a snapshot or a removal
 *    changes which session is open; a snapshot that keeps the same open session leaves it alone.
 *    Nothing is sent to the host when the user picks: `prompt.send` carries the choice (decision of
 *    21/10/2026, Engram #1012). Alternative discarded: keep it only in the server's session.
 *  - E7-file-context (issue #28) adds `fileSearch`, the results of the `@` popup. Like the session
 *    list it stays OUT of `pending` (a keystroke must not disable Send) and accepts only the answer
 *    to the LAST request (`fileSearch.requestId`), so a slow answer to an old query cannot replace
 *    a newer one. `files.found` carries its own error, shown by the popup, not as a notice.
 *  - E5-context-usage (issue #25) adds nothing to the reducers: the accumulated usage rides in
 *    `SessionSummary.usage` (`session.upserted` reconciles it into the same row object) and the
 *    compaction boundary in `OpenView.compactedAt` (copied by `snapshot`, cleared when a snapshot
 *    brings none). The context itself is computed from the messages by `chat/usage.ts`.
 * VERIFIED by `chatStore.test.ts` with fabricated messages (confirms this logic, not the host
 * contract). UNVERIFIED in a real webview until the F5 of issue #14.
 */
import { batch } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import type {
  Catalog,
  ErrorInfo,
  FormAsk,
  MessageInfo,
  ModelRef,
  Part,
  PermissionAsk,
  RequestResolution,
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
import { applyPage, removeRow, upsertRow } from '../sessions/browserRows';

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

/**
 * The dock line that stays after a request is answered, e.g. "Allowed once: Read .env". Since
 * E3-resolved-history it is used only for requests of OTHER sessions (a subagent's) and for ones the
 * host had no record of; those of the open session live in `ChatState.resolutions` and show in the
 * conversation. Cleared by the next prompt.
 */
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

/**
 * The session being shown. `sessionID` is `undefined` before the first prompt creates one.
 * `compactedAt` (issue #25) is the boundary of the last completed compaction, copied from the
 * snapshot and absent when there is none; only a snapshot changes it.
 */
export interface OpenView {
  sessionID: string | undefined;
  messages: MessageInfo[];
  parts: { [messageID: string]: Part[] };
  compactedAt?: number;
}

/**
 * The session list the picker shows: root sessions of the folder, newest activity first, for the
 * current `search`. `loaded` is false until the first page of this document arrives, so events
 * cannot fill a list nobody asked for; `loading` is true between a query and its answer.
 */
export interface SessionBrowserState {
  search: string;
  rows: SessionSummary[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  /** `requestId` of the newest query; only its page is accepted. */
  requestId: string | undefined;
}

/**
 * The results of the `@` popup. `query` is the text they answer (or, while `loading`, the text
 * being asked), `files` the host's references for it, `error` why the search failed. `requestId`
 * is the newest request; only its answer is accepted. `files` keeps the previous results while a
 * newer search is in flight, so the list does not flash empty on every pause in typing.
 */
export interface FileSearchState {
  requestId: string | undefined;
  query: string;
  files: AttachmentRef[];
  loading: boolean;
  error: ErrorInfo | undefined;
}

/** A rename or delete of one session waiting for the host, with the request that will end it. */
export interface SessionOp {
  op: 'renaming' | 'deleting';
  requestId: string;
}

/**
 * The model and agent the user picked for the next prompt (issues #23/#24). `sessionID` is the
 * session that was open when they picked, `undefined` for a session not created yet; a field left
 * `undefined` means "nothing picked", and the selectors fall back to the session and the catalog.
 */
export interface SelectionDraft {
  sessionID: string | undefined;
  model: ModelRef | undefined;
  agent: string | undefined;
}

/** Everything the UI reads. */
export interface ChatState {
  connection: ConnectionState;
  /** Models, providers and selectable agents of the server; `undefined` until the host sends it. */
  catalog: Catalog | undefined;
  /** The unsent model/agent choice. See {@link SelectionDraft}. */
  selection: SelectionDraft;
  sessions: { [sessionID: string]: SessionSummary };
  statuses: { [sessionID: string]: SessionStatus };
  /** The session list of the picker (issue #20). */
  browser: SessionBrowserState;
  /** Renames and deletes in flight, by session id. */
  sessionOps: { [sessionID: string]: SessionOp };
  /** The `@` popup's results (issue #28). */
  fileSearch: FileSearchState;
  open: OpenView;
  /** Pending permissions and forms of ANY session of the location, in order of arrival. */
  requests: { permissions: PermissionAsk[]; forms: FormAsk[] };
  /**
   * Dock lines of answered requests of other sessions (or unknown to the host), oldest first,
   * until the next prompt is sent. See {@link ResolvedRequest}.
   */
  resolved: ResolvedRequest[];
  /**
   * The host's record of each answered request of the OPEN session, by request id. Persistent for
   * the life of the document and NOT cleared by a prompt: they are history. Replaced by a
   * snapshot, emptied when the open session is removed.
   */
  resolutions: { [requestId: string]: RequestResolution };
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
  /**
   * Starts a session-list query: remembers `search` and `requestId` as the newest (a page for any
   * other id is ignored) and shows "loading". Does NOT touch `pending`, so Send stays usable.
   */
  beginQuery: (requestId: string, search: string) => void;
  /**
   * Marks `sessionID` as being renamed or deleted until the `request.result` of `requestId`
   * arrives. Does NOT touch `pending`.
   */
  beginSessionOp: (sessionID: string, op: SessionOp['op'], requestId: string) => void;
  /**
   * Starts a file search (issue #28): `requestId` becomes the only one whose `files.found` is
   * accepted and the popup shows "searching" for `query`. Does NOT touch `pending`, so Send stays
   * usable; the previous results stay until the answer arrives.
   */
  beginFileSearch: (requestId: string, query: string) => void;
  /**
   * Forgets the results and the request in flight: whatever answer arrives later is ignored. Called
   * when the popup closes, when the prompt is sent and when the open session changes.
   */
  clearFileSearch: () => void;
  /** Removes the notice with that id (the user dismissed it). */
  dismissNotice: (id: number) => void;
  /** Adds files to the draft attachments, skipping any `uri` already there. */
  addDraftFiles: (files: readonly AttachmentRef[]) => void;
  /** Removes one draft attachment (the chip's remove button). */
  removeDraftFile: (uri: string) => void;
  /**
   * Returns the draft attachments and empties the list (the prompt is being sent).
   *
   * The result is PLAIN `{uri, name}` copies, never the store's own elements: those are Proxies
   * and `postMessage` throws `DataCloneError` on a Proxy (the same mechanism that hit the model
   * pick). VERIFIED with a probe on solid-js/store (browser build) in review #1015, and by the
   * `structuredClone` cases in `App.test.tsx` (mutation-checked); a real VS Code is exercised by
   * the attach step of `test:visual`.
   */
  takeDraftFiles: () => AttachmentRef[];
  /**
   * Marks the card of `askId` as waiting for the server (reply or cancel with `requestId`) and
   * forgets its previous error. The mark goes away with the request's `*.resolved` or with a
   * `request.result` that carries an error (stored in `requestErrors`).
   */
  beginReply: (askId: string, requestId: string) => void;
  /**
   * Forgets the dock lines of answered requests (a new prompt starts a new turn). Touches ONLY
   * `resolved`: the answered requests in the conversation (`resolutions`) are history and stay.
   */
  clearResolved: () => void;
  /** Forgets the pending `ui.focus` target (the dock carried it out). */
  clearFocusTarget: () => void;
  /** Picks the model for the next prompt of the open session (no message goes to the host). */
  selectModel: (model: ModelRef) => void;
  /** Picks the agent for the next prompt of the open session (no message goes to the host). */
  selectAgent: (agent: string) => void;
  /**
   * Puts back the draft persisted before the view was hidden. It survives only if the first
   * snapshot opens the same session it belonged to (otherwise the snapshot empties it).
   */
  restoreSelection: (saved: SelectionDraft) => void;
}

/** No search: no request to wait for, no results. */
function emptyFileSearch(): FileSearchState {
  return { requestId: undefined, query: '', files: [], loading: false, error: undefined };
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
    catalog: undefined,
    selection: { sessionID: undefined, model: undefined, agent: undefined },
    sessions: {},
    statuses: {},
    browser: {
      search: '',
      rows: [],
      hasMore: false,
      loading: false,
      loaded: false,
      requestId: undefined,
    },
    sessionOps: {},
    fileSearch: emptyFileSearch(),
    open: emptyOpen(),
    requests: { permissions: [], forms: [] },
    resolved: [],
    resolutions: {},
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

  /** Empties the draft unless it belongs to `sessionID` (the session that is open now). */
  const dropForeignSelection = (sessionID: string | undefined): void => {
    if (state.selection.sessionID === sessionID) return;
    setState('selection', { sessionID, model: undefined, agent: undefined });
  };

  const handlers: Handlers<HostToWebview> = {
    catalog: (m) => {
      setState('catalog', m.catalog);
    },

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
            : {
                sessionID: open.sessionID,
                messages: open.messages,
                parts: open.parts,
                ...(open.compactedAt === undefined ? {} : { compactedAt: open.compactedAt }),
              },
          { key: 'id' },
        ),
      );
      rebuildIndexes();
      dropForeignSelection(open?.sessionID);
      setState(
        'resolutions',
        reconcile(Object.fromEntries(snapshot.resolutions.map((entry) => [entry.id, entry]))),
      );
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
      batch(() => {
        setState('sessions', m.session.id, reconcile(m.session));
        // A list nobody has asked for yet is not filled by events (it would show a partial list
        // that looks complete); once loaded they keep it in step.
        if (state.browser.loaded) {
          setState(
            'browser',
            'rows',
            reconcile(upsertRow(state.browser.rows, m.session, state.browser.search), {
              key: 'id',
            }),
          );
        }
      });
    },

    'session.removed': (m) => {
      batch(() => {
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
        setState(
          'browser',
          'rows',
          reconcile(removeRow(state.browser.rows, m.sessionID), { key: 'id' }),
        );
        setState(
          'sessionOps',
          produce((ops) => {
            delete ops[m.sessionID];
          }),
        );
        // The server deletes the pending requests of a deleted session WITHOUT a `*.replied`
        // (lesson #969), so their cards would stay with buttons that can only fail.
        const goneAsks = [
          ...state.requests.permissions.filter((ask) => ask.sessionID === m.sessionID),
          ...state.requests.forms.filter((ask) => ask.sessionID === m.sessionID),
        ];
        if (goneAsks.length > 0) {
          setState('requests', 'permissions', (asks) =>
            asks.filter((ask) => ask.sessionID !== m.sessionID),
          );
          setState('requests', 'forms', (asks) =>
            asks.filter((ask) => ask.sessionID !== m.sessionID),
          );
          for (const ask of goneAsks) forgetAsk(ask.id);
          const target = state.focusTarget;
          if (target !== undefined && target.sessionID === m.sessionID) {
            setState('focusTarget', undefined);
          }
        }
        if (isOpen(m.sessionID)) {
          setState('open', reconcile(emptyOpen(), { key: 'id' }));
          setState('resolutions', reconcile({}));
          rebuildIndexes();
          dropForeignSelection(undefined);
        }
      });
    },

    'sessions.page': (m) => {
      // Only the answer to the newest query counts: typing fast leaves older ones in flight.
      if (m.requestId !== state.browser.requestId) return;
      batch(() => {
        setState('browser', 'rows', reconcile(applyPage(state.browser.rows, m), { key: 'id' }));
        setState('browser', { hasMore: m.hasMore, loading: false, loaded: true });
      });
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
        if (m.resolution !== undefined && isOpen(m.sessionID)) {
          setState('resolutions', m.resolution.id, m.resolution);
        } else if (ask !== undefined) {
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
        if (m.resolution !== undefined && isOpen(m.sessionID)) {
          setState('resolutions', m.resolution.id, m.resolution);
        } else if (ask !== undefined) {
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
        // Issue #20: the end of a list query or of a rename/delete. The page itself arrives in
        // `sessions.page`; this only unlocks what was waiting (a failure included).
        if (m.requestId === state.browser.requestId) setState('browser', 'loading', false);
        const opSession = Object.keys(state.sessionOps).find(
          (id) => state.sessionOps[id]?.requestId === m.requestId,
        );
        if (opSession !== undefined) {
          setState(
            'sessionOps',
            produce((ops) => {
              delete ops[opSession];
            }),
          );
        }
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

    'files.found': (m) => {
      // Only the answer to the newest search counts: typing leaves older ones in flight.
      if (m.requestId !== state.fileSearch.requestId) return;
      setState('fileSearch', {
        query: m.query,
        // Plain copies: the elements are read back into `postMessage` (a chip), and a store Proxy
        // cannot be structured-cloned.
        files: m.files.map((file) => ({ uri: file.uri, name: file.name })),
        loading: false,
        error: m.error,
      });
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
    beginQuery: (requestId, search) => {
      setState('browser', { search, requestId, loading: true });
    },
    beginSessionOp: (sessionID, op, requestId) => {
      setState('sessionOps', sessionID, { op, requestId });
    },
    beginFileSearch: (requestId, query) => {
      setState('fileSearch', { requestId, query, loading: true, error: undefined });
    },
    clearFileSearch: () => {
      setState('fileSearch', emptyFileSearch());
    },
    dismissNotice: (id) => {
      setState('notices', (notices) => notices.filter((notice) => notice.id !== id));
    },
    addDraftFiles,
    removeDraftFile: (uri) => {
      setState('draftFiles', (files) => files.filter((file) => file.uri !== uri));
    },
    takeDraftFiles: () => {
      // Plain copies, not the store's own elements: those are Proxies and `postMessage` cannot
      // structured-clone a Proxy (DataCloneError).
      const taken = state.draftFiles.map((file) => ({ uri: file.uri, name: file.name }));
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
    selectModel: (model) => {
      setState('selection', { sessionID: state.open.sessionID, model });
    },
    selectAgent: (agent) => {
      setState('selection', { sessionID: state.open.sessionID, agent });
    },
    restoreSelection: (saved) => {
      setState('selection', {
        sessionID: saved.sessionID,
        model: saved.model,
        agent: saved.agent,
      });
    },
  };
}
