// The chat brain of the extension host (issues #9/#14): owns the opencode client, the SSE loop,
// the snapshot, the open session and the answers to the webview. Pure: no `vscode` import. The
// VS Code side (`chatViewProvider.ts`, `chatLifecycle.ts`) only moves messages in and out.
//
// Flow: `onServerState(running)` -> client + `runEventStream`; each `server.connected` and each
// `location.shutdown` -> `resync()` (REST snapshot, because the stream has no replay); every
// other event -> `eventTranslator` -> `post`. Errors reaching the webview always go through
// `toErrorInfo` with the server URL and password as secrets (architecture rule 1).
//
// The info lines of the log are STABLE on purpose: the opt-in integration test waits for them
// (`webview ready`, `event stream connected`, `snapshot sent`, `prompt accepted for`,
// `turn finished`, `abort requested for <sid> (interrupted: <bool>)`, and from phase 3
// `permission asked <id> for <sid> (<action>)`, `permission <id> resolved: <decision>`,
// `form asked <id> for <sid>`, `form <id> resolved: answered|cancelled`,
// `permission reply sent for <id> (<decision>)`, `form reply sent for <id>`,
// `form cancel sent for <id>`, and from E3-resolved-history `resolution recorded <id>
// (<decision|outcome>)`). Never log the password or a token, nor the RESOURCES of a
// permission (they can be shell commands with secrets) nor the text of an answer.
//
// Phase 3 (issues #18/#44/#19/#10): permissions and forms belong to the location, so the snapshot
// reads them with `permission.request.list()` / `form.list()` and the stream forwards every
// session's; a host-side registry (`pendingRequests.ts`) feeds the badge and the notifications
// (`deps.attention`); replies, cancels and the saved-permissions manager call the client.
//
// E3-resolved-history (issues #56/#18): a second host-side memory (`requestResolutions.ts`) turns
// each `*.resolved` into a `RequestResolution` that travels with the message and, for the open
// session, inside every snapshot. Unlike the pending registry it is NOT emptied when the stream
// stops: it must survive a reconnection, a hidden view and Restart Server.
//
// E4-session-management (issue #20): the session list the webview browses (`sessions.query` ->
// `sessions.page`, with search and paging on the server and the cursor kept here), rename and
// delete (the delete is confirmed by the HOST with a native modal), and the open session being
// deleted (by us or by another client): the host forgets it, memory included. New log lines, also
// stable: `sessions page (<n>, more: <bool>)`, `session renamed <id>` (never the title),
// `session deleted <id>`, `session delete cancelled <id>`, `open session deleted <id>`. Neither
// titles nor search texts are logged: they are the user's words.

import type { V2Event } from '@opencode/client';
import type { ErrorInfo, SessionStatus, SessionSummary } from '../shared/model';
import {
  dispatch,
  MAX_SESSION_TITLE_LENGTH,
  type AttachmentRef,
  type ConnectionState,
  type HostToWebview,
  type OpenSession,
  type PendingAsks,
  type Sender,
  type Snapshot,
  type WebviewToHost,
} from '../shared/protocol';
import { createEventTranslator, type EventTranslator } from './eventTranslator';
import { runEventStream, type StreamState } from './eventStream';
import type { ChatApi } from './opencodeClient';
import { safeLog, type ServerLog } from './opencodeServer';
import { createPendingRequests, type PendingSummary } from './pendingRequests';
import { createRequestResolutions } from './requestResolutions';
import type { RunningServerInfo, ServerState } from './serverManager';
import { createSessionBrowser } from './sessionBrowser';
import {
  toErrorInfo,
  toFormAsk,
  toMessage,
  toPermissionAsk,
  toSessionSummary,
  toStructuredErrorInfo,
  type ErrorSecrets,
} from './wireMapping';

/** How many sessions the snapshot asks for (the API default is 50; ours, kept explicit). */
const SESSION_LIMIT = 50;

/** How many messages of the open session the snapshot asks for (the API maximum is 200). */
const MESSAGE_LIMIT = 200;

/**
 * Where the controller keeps the id of the last session this extension opened IN EACH FOLDER
 * (workspaceState, phase 3). Per folder because a session lives in its location: with a multi-root
 * window and a server that serves one folder at a time, a single remembered id would point at a
 * session of another folder after switching.
 */
export interface SessionMemory {
  get(folder: string): string | undefined;
  set(folder: string, sessionID: string | undefined): Promise<void>;
}

/** A rule stored by "Always", as the saved-permissions manager lists it. */
export interface SavedPermission {
  id: string;
  action: string;
  resource: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/**
 * The attention feature as the controller sees it (issue #19, implemented in `attention.ts`):
 * told the whole set of pending requests every time it changes, and with `[]` when the server
 * goes away. It decides by itself whether the view is visible.
 */
export interface AttentionSink {
  update(requests: readonly PendingSummary[]): void;
}

/** What the controller needs from the VS Code side to manage the server (issue #10). */
export interface ServerCommands {
  /** Restarts the server; fire and forget (the outcome is the connection state). */
  restart(): void;
  /** Shows the OpenCode output channel. */
  showLogs(): void;
}

/** Where `ui.focus` points: a pending request of any session. */
export type FocusTarget = Extract<HostToWebview, { type: 'ui.focus' }>['target'];

/**
 * How long a focus request waits for a webview that was still loading. Our own choice: long enough
 * for a document to load and send `ready`, short enough that a late `ready` (the user hid and
 * showed the view minutes later) does not steal the focus to a request long gone.
 */
export const FOCUS_REQUEST_TTL_MS = 10_000;

/**
 * What the webview may ask the editor to do (issues #13/#15). Implemented in
 * `editorActions.ts` (the only side that imports `vscode`); the controller stays pure. Every
 * method rejects with an `Error` whose `name` is a stable code (`NoWorkspace`, `OutsideWorkspace`,
 * `NoActiveEditor`...) and whose message is fit for the user: the controller turns it into a
 * `notice`. The text to copy or insert is never logged.
 */
export interface EditorActions {
  /** Opens `path` (relative to the served folder, absolute or `file://`) at a 1-based position. */
  open(path: string, line?: number, column?: number): Promise<void>;
  /** Replaces every selection of the active editor with `text`. */
  insert(text: string): Promise<void>;
  /** Opens an untitled document with `text`; `language` is a VS Code language id. */
  newFile(text: string, language?: string): Promise<void>;
  /** Puts `text` on the system clipboard. */
  copy(text: string): Promise<void>;
  /** Shows the file picker; the returned `uri`s are the only ones `prompt.send` will accept. */
  pickFiles(): Promise<AttachmentRef[]>;
}

/** External effects of the controller, injected so tests need no VS Code, network or processes. */
export interface ChatControllerDeps {
  createClient(server: RunningServerInfo): ChatApi;
  /** Publishes to the webview; the provider drops what it cannot deliver (not ready or hidden). */
  post: Sender<HostToWebview>;
  log: ServerLog;
  memory: SessionMemory;
  editor: EditorActions;
  attention: AttentionSink;
  /** The QuickPick that picks which saved permissions to revoke; resolves with their ids. */
  savedPermissions: { pickToRevoke(items: SavedPermission[]): Promise<string[]> };
  /**
   * The native modal that confirms deleting a session (issue #20); resolves `true` only on
   * "Delete". `title` comes from the server (`session.get`), `running` from `session.active()`.
   */
  sessions: { confirmDelete(info: { title: string; running: boolean }): Promise<boolean> };
  server: ServerCommands;
  /** The SSE loop; replaced in tests. */
  runStream?: typeof runEventStream;
}

/** The `_tag` of a thrown server error body, or `undefined` when it is not one. */
function tagOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const tag = (error as { _tag?: unknown })._tag;
  return typeof tag === 'string' ? tag : undefined;
}

/** True when the thrown value is the server's `SessionNotFoundError` body (`_tag`), not an Error. */
function isSessionNotFound(error: unknown): boolean {
  return tagOf(error) === 'SessionNotFoundError';
}

/**
 * True when a reply failed because the request is no longer pending (someone else answered it, or
 * it died): the snapshot, not our view, tells the truth then. `FormInvalidAnswerError` is NOT in
 * the list: the request is still pending and the card must show what to fix. Tags read in
 * `types.d.ts` of `@opencode/client@2.0.32` (L3549-3610); not provoked against a real server.
 */
function isStaleRequest(error: unknown): boolean {
  const tag = tagOf(error);
  return (
    tag === 'PermissionNotFoundError' ||
    tag === 'FormNotFoundError' ||
    tag === 'FormAlreadySettledError' ||
    tag === 'RequestNotPending' // ours: the host's registry did not know the request
  );
}

/** Snapshot with no sessions, sent when there is no server to ask. */
const EMPTY_SNAPSHOT: Snapshot = {
  sessions: [],
  statuses: {},
  requests: { permissions: [], forms: [] },
  resolutions: [],
};

/**
 * Coordinates the opencode client, the event stream and the webview.
 *
 * Decisions (plan `E2-mvp-prototype/plan-fase1`): the open session is the last one this extension
 * created or opened, kept in `workspaceState` (alternative discarded: the most recent of
 * `session.list`, which could drop a prompt into a session of the TUI); with none, the first
 * prompt creates one. `prompt.send` always goes with the delivery the webview chose (the UI sends
 * `queue`). A resync started while another one is in flight wins: only the newest publishes.
 * Phase 2 (`plan-fase2`) added abort, the editor actions behind `deps.editor` and attachments
 * restricted to what the picker emitted; it did not touch `resync`, `onEvent` or the translator.
 * Phase 3 (`plan-fase3`) adds, in this class: permission replies and form replies/cancels; the
 * pending requests of the LOCATION (snapshot and stream) and their registry for the badge and the
 * notifications; the cure for the one thing the server never publishes (an interrupt deletes a
 * pending permission WITHOUT `permission.replied`, read in `permission.ts@v2.0.32` L247-258, so an
 * `interrupted`/`failed` of a session that had requests triggers a resync); the saved-permissions
 * manager; `focusRequest`; restart/log commands; and the remembered session PER FOLDER.
 * Issue #20 (`E4-session-management`, plan Engram #977, decisions #978) adds the session list,
 * rename and delete, and makes "New session" LAZY: it creates nothing on the server, it only makes
 * the controller forget the open session, and the first prompt creates one through `sendPrompt`.
 * Deleting the open session leaves NO session open (alternative discarded: open the newest one,
 * which could drop the next prompt into a session of the TUI; same reasoning as the remembered
 * session above).
 * VERIFIED with a fake client (unit tests) and against a synthetic HTTP/SSE server
 * (`chatController.e2e.test.ts`, real client and stream loop). The permission and question flows
 * against a real opencode are exercised only by the opt-in `realOpencode.test.ts` (see its
 * header for what a run observed); POSIX UNVERIFIED.
 */
export class ChatController {
  private readonly log: ServerLog;
  private readonly runStream: typeof runEventStream;
  private server: RunningServerInfo | undefined;
  private client: ChatApi | undefined;
  private translator: EventTranslator = createEventTranslator();
  private streamAbort: AbortController | undefined;
  private connection: ConnectionState = { state: 'starting' };
  /** Open session of the SERVED folder; read from the memory when a server comes up. */
  private open: string | undefined;
  /** `uri`s emitted by the file picker; `prompt.send` accepts no other attachment. */
  private readonly pickedUris = new Set<string>();
  private readonly pending = createPendingRequests();
  /**
   * What the user answered, kept for the history (E3-resolved-history). Created ONCE for the life of
   * the controller and never emptied by `stopStream`/`onServerState`: that is what makes the lines
   * survive Restart Server (the controller is not recreated, only the client).
   */
  private readonly resolutions = createRequestResolutions({ now: () => Date.now() });
  /**
   * Requests the stream announced or resolved while a resync was reading REST, so the snapshot can
   * be completed with them (same problem and cure as `translator.mergeLive` for messages: the
   * webview REPLACES its requests with the snapshot). Only filled while a resync is in flight, so
   * it stays bounded.
   */
  private readonly live = {
    permissions: new Map<string, PendingAsks['permissions'][number]>(),
    forms: new Map<string, PendingAsks['forms'][number]>(),
    gone: new Set<string>(),
    /** Sessions deleted during the reads: their requests in the REST lists are already dead. */
    removed: new Set<string>(),
  };
  private resyncing = 0;
  /** Paging state of the session list; owns the cursor, which never leaves the host. */
  private readonly browser = createSessionBrowser();
  /**
   * Sessions this controller is deleting, so the `session.removed` that comes back is not
   * announced as "deleted elsewhere". The id only lives for the duration of `deleteSession`: it
   * leaves the set when the FIRST `session.removed` for it is consumed by `onSessionRemoved` (the
   * server's, which arrives before the HTTP answer, or the one the controller publishes itself
   * after the 204 when the stream is down), or when the call fails. So the set never grows and
   * needs no bound.
   */
  private readonly deleting = new Set<string>();
  /** A focus request the webview may have missed, repeated after its next snapshot. */
  private focusRequested: { target: FocusTarget; at: number } | undefined;
  private generation = 0;
  private disposed = false;

  constructor(private readonly deps: ChatControllerDeps) {
    this.log = safeLog(deps.log);
    this.runStream = deps.runStream ?? runEventStream;
  }

  /** URL and password of the current server, for scrubbing error texts. */
  private get secrets(): ErrorSecrets {
    return this.server === undefined
      ? {}
      : { url: this.server.url, password: this.server.password };
  }

  /** Posts, never throwing: a failing sender must not break the stream or a request. */
  private post(message: HostToWebview): void {
    try {
      this.deps.post(message);
    } catch (error) {
      this.log.error(`posting to the webview failed: ${String(error)}`);
    }
  }

  /** Changes the connection state and tells the webview. */
  private setConnection(connection: ConnectionState): void {
    this.connection = connection;
    this.post({ type: 'connection.state', connection });
  }

  /**
   * Reacts to the server manager: `running` starts the client and the event stream; any other
   * state stops the stream (so a `stop` never causes reconnection attempts) and is mirrored as
   * a `ConnectionState`. Re-entering `running` with the same URL and password is a no-op.
   *
   * Phase 3: a new server reads the session remembered for ITS folder (`memory.get(folder)`);
   * `restarting` looks like `starting` to the webview; an `unavailable` that still has a restart
   * scheduled (`retryInMs`) is `reconnecting` with its attempt number, so the banner says
   * "Reconnecting (n)" instead of an error the manager is already healing. Leaving `running` drops
   * the pending requests (they died with the server) and clears the badge.
   */
  onServerState(state: ServerState): void {
    if (this.disposed) return;
    switch (state.kind) {
      case 'running': {
        const next = state.server;
        if (
          this.server !== undefined &&
          this.server.url === next.url &&
          this.server.password === next.password
        ) {
          return;
        }
        this.stopStream();
        this.server = next;
        this.client = this.deps.createClient(next);
        this.open = this.deps.memory.get(next.folder);
        this.translator = createEventTranslator(this.secrets);
        this.translator.setOpen(this.open);
        this.setConnection({ state: 'starting' });
        this.startStream(this.client);
        return;
      }
      case 'idle':
      case 'starting':
      case 'restarting':
        this.stopStream();
        this.setConnection({ state: 'starting' });
        return;
      case 'unavailable':
        this.stopStream();
        if (state.retryInMs !== undefined) {
          this.setConnection({
            state: 'reconnecting',
            attempt: state.attempt ?? 1,
            error: { code: state.reason, message: state.message },
          });
          return;
        }
        this.setConnection({
          state: 'unavailable',
          reason: state.reason,
          error: { code: state.reason, message: state.message },
        });
        return;
      case 'stopping':
      case 'stopped':
        this.stopStream();
        this.setConnection({ state: 'stopped' });
        return;
    }
  }

  /**
   * Aborts the stream and forgets the client and the pending requests; the next `running` creates
   * new ones. The requests die with the server (opencode rejects its pending ones on shutdown), so
   * the registry is emptied and the attention feature told, which closes its notifications.
   * The asks remembered for the resolutions die with them (`forgetAsks`), but the RESOLUTIONS
   * already recorded stay: they are history, and Restart Server must not wipe them.
   */
  private stopStream(): void {
    this.streamAbort?.abort();
    this.streamAbort = undefined;
    this.client = undefined;
    this.server = undefined;
    this.generation++; // a snapshot in flight for the old server must not be published
    this.browser.reset(); // its cursor embeds the old server's query
    this.clearPending();
    this.resolutions.forgetAsks();
  }

  /** Empties the registry of pending requests and tells the attention feature, if it held any. */
  private clearPending(): void {
    if (this.pending.list().length === 0) return;
    this.pending.clear();
    this.deps.attention.update([]);
  }

  /** Launches the reconnecting SSE loop for `client`; it ends when `streamAbort` aborts. */
  private startStream(client: ChatApi): void {
    const controller = new AbortController();
    this.streamAbort = controller;
    const stateOf = (state: StreamState): void => {
      if (controller.signal.aborted) return;
      this.onStreamState(state);
    };
    void this.runStream<V2Event>({
      subscribe: (signal, onActivity) => client.event.subscribe({ signal, onActivity }),
      onEvent: (event) => {
        if (!controller.signal.aborted) this.onEvent(event);
      },
      onState: stateOf,
      onDiagnostic: (message) => {
        this.log.debug(message);
      },
      signal: controller.signal,
    }).catch((error: unknown) => {
      this.log.error(`event stream loop crashed: ${String(error)}`);
    });
  }

  /** Mirrors the loop's phase into the connection state shown to the user. */
  private onStreamState(state: StreamState): void {
    if (state.kind === 'connected' && this.server !== undefined) {
      this.setConnection({ state: 'connected', serverVersion: this.server.version });
    } else if (state.kind === 'reconnecting') {
      this.log.warn(`event stream lost (attempt ${String(state.attempt)}); reconnecting`);
      this.setConnection({
        state: 'reconnecting',
        attempt: state.attempt,
        error: toErrorInfo(state.error, this.secrets),
      });
    }
  }

  /**
   * Handles one stream event: resync on `server.connected`/`location.shutdown`, else translate.
   *
   * Every translated message goes through the registry of pending requests (and the in-flight
   * resync's `live` record); when the set changed, the attention feature is told once per event.
   * It then goes through the memory of answered requests ({@link withResolution}), so a
   * `*.resolved` leaves for the webview already carrying its `resolution`.
   * `session.execution.interrupted` / `.failed` of a session that had pending requests triggers a
   * resync: opencode deletes a pending permission on interrupt WITHOUT publishing
   * `permission.replied` (read in `permission.ts@v2.0.32` L247-258), so the stream alone would
   * leave a card, a badge and a notification for a request that no longer exists. HYPOTHESIS: that
   * the REST read after the event no longer lists it (the deletion could in theory happen after
   * the event); the opt-in suite does not interrupt a pending permission. A resync after
   * `succeeded` is not needed: a turn cannot succeed while a request is pending.
   */
  private onEvent(event: V2Event): void {
    try {
      if (event.type === 'server.connected') {
        this.log.info('event stream connected');
        void this.resync();
        return;
      }
      if (event.type === 'location.shutdown') {
        this.log.info('location shutdown; refreshing the snapshot');
        void this.resync();
        return;
      }
      if (
        event.type === 'session.execution.succeeded' ||
        event.type === 'session.execution.failed' ||
        event.type === 'session.execution.interrupted'
      ) {
        const outcome = event.type.slice('session.execution.'.length);
        let reason = '';
        if (event.type === 'session.execution.failed') {
          const failure = toStructuredErrorInfo(event.data.error, this.secrets);
          reason = ` (${failure.code}: ${failure.message})`;
        }
        this.log.info(`turn finished: ${outcome} for ${event.data.sessionID}${reason}`);
      }
      this.publish(this.translator.translate(event));
      if (
        (event.type === 'session.execution.interrupted' ||
          event.type === 'session.execution.failed') &&
        this.pending.hasSession(event.data.sessionID)
      ) {
        void this.resync();
      }
    } catch (error) {
      this.log.error(`handling event ${event.type} failed: ${String(error)}`);
    }
  }

  /**
   * Sends translated messages to the webview through the host-side bookkeeping: the registry of
   * pending requests (and `live`), the open-session check of {@link onSessionRemoved} and the memory
   * of answered requests; the attention feature is told once if the pending set changed. Used for
   * the events of the stream and for the `session.removed` the controller itself synthesises when
   * a call finds the session gone (self-healing of a stale row).
   */
  private publish(messages: readonly HostToWebview[]): void {
    let changed = false;
    for (const message of messages) {
      if (this.trackRequest(message)) changed = true;
      this.post(this.withResolution(message));
      // After the post: the webview empties its view on `session.removed`, and the notice that may
      // follow explains why.
      if (message.type === 'session.removed') this.onSessionRemoved(message.sessionID);
    }
    if (changed) this.deps.attention.update(this.pending.list());
  }

  /**
   * A session is gone. If it was the open one the controller forgets it, memory included, so the
   * next prompt without `sessionID` creates a session instead of going to a dead one (before this,
   * `this.open` and `workspaceState` pointed at it until a resync got a 404). The webview empties
   * its own view when it receives the same `session.removed`. An info notice says so unless the
   * delete was ours (`deleting`). Idempotent: the second report finds `open` already cleared.
   */
  private onSessionRemoved(sessionID: string): void {
    const ours = this.deleting.delete(sessionID);
    if (sessionID !== this.open) return;
    this.log.info(`open session deleted ${sessionID}`);
    void this.forgetOpen();
    if (!ours) {
      this.post({
        type: 'notice',
        level: 'info',
        error: {
          code: 'SessionDeleted',
          message: 'The open session was deleted outside this view',
        },
      });
    }
  }

  /**
   * Makes the controller forget the open session: field, translator and the per-folder memory.
   * The returned promise never rejects (a failed write is logged); callers that need the memory
   * written before going on await it, the event path does not.
   */
  private async forgetOpen(): Promise<void> {
    this.open = undefined;
    this.translator.setOpen(undefined);
    const folder = this.server?.folder;
    if (folder === undefined) return;
    try {
      await this.deps.memory.set(folder, undefined);
    } catch (error) {
      this.log.warn(`forgetting the remembered session failed: ${String(error)}`);
    }
  }

  /**
   * Feeds one translated message to the memory of answered requests. For a `permission.resolved`
   * or `form.resolved` of a request it knew, returns the message with its `resolution` attached
   * (and writes the stable line `resolution recorded <id> (<decision|outcome>)`: ids and decision
   * only, never resources, answers or feedback); any other message comes back unchanged.
   */
  private withResolution(message: HostToWebview): HostToWebview {
    const resolution = this.resolutions.observe(message);
    if (resolution === undefined) return message;
    if (message.type === 'permission.resolved' && resolution.kind === 'permission') {
      this.log.info(`resolution recorded ${resolution.id} (${resolution.decision})`);
      return { ...message, resolution };
    }
    if (message.type === 'form.resolved' && resolution.kind === 'form') {
      this.log.info(`resolution recorded ${resolution.id} (${resolution.outcome})`);
      return { ...message, resolution };
    }
    return message;
  }

  /**
   * Feeds one translated message to the registry of pending requests, writes the stable log line
   * for it and, while a resync is reading REST, remembers it in `live`. Returns `true` when the
   * set of pending requests changed (so the attention feature must be told). Logs the ids and the
   * action only, never the resources.
   */
  private trackRequest(message: HostToWebview): boolean {
    const changed = this.pending.apply(message);
    const recording = this.resyncing > 0;
    switch (message.type) {
      case 'permission.asked': {
        const { id, sessionID, action } = message.permission;
        if (recording) {
          this.live.permissions.set(id, message.permission);
          this.live.gone.delete(`permission:${id}`);
        }
        if (changed) this.log.info(`permission asked ${id} for ${sessionID} (${action})`);
        return changed;
      }
      case 'permission.resolved':
        if (recording) {
          this.live.permissions.delete(message.permissionID);
          this.live.gone.add(`permission:${message.permissionID}`);
        }
        this.log.info(`permission ${message.permissionID} resolved: ${message.decision}`);
        return changed;
      case 'form.asked':
        if (recording) {
          this.live.forms.set(message.form.id, message.form);
          this.live.gone.delete(`form:${message.form.id}`);
        }
        if (changed) this.log.info(`form asked ${message.form.id} for ${message.form.sessionID}`);
        return changed;
      case 'form.resolved':
        if (recording) {
          this.live.forms.delete(message.formID);
          this.live.gone.add(`form:${message.formID}`);
        }
        this.log.info(`form ${message.formID} resolved: ${message.outcome}`);
        return changed;
      case 'session.removed':
        // Lesson #969: a record of the host must not inherit requests of a session that is gone.
        // The ones `live` holds would otherwise be re-added to a snapshot that is being built.
        if (recording) {
          this.live.removed.add(message.sessionID);
          for (const [id, ask] of this.live.permissions) {
            if (ask.sessionID === message.sessionID) this.live.permissions.delete(id);
          }
          for (const [id, ask] of this.live.forms) {
            if (ask.sessionID === message.sessionID) this.live.forms.delete(id);
          }
        }
        return changed;
      default:
        return false;
    }
  }

  /**
   * The webview loaded (it sends `ready` on every document load): publishes the connection state
   * and a fresh snapshot, or an empty one when there is no server yet. Anything posted earlier was
   * dropped by the provider, so this is the only way a new document gets its state. If a
   * `focusRequest` is waiting (an "Open chat" click that had to load the document first, so its
   * first `ui.focus` went nowhere) it is sent again after the snapshot, as long as it is fresher
   * than {@link FOCUS_REQUEST_TTL_MS}.
   */
  async onWebviewReady(): Promise<void> {
    this.log.info('webview ready');
    this.post({ type: 'connection.state', connection: this.connection });
    if (this.client === undefined) {
      this.post({ type: 'snapshot', snapshot: EMPTY_SNAPSHOT });
      return;
    }
    await this.resync();
    const requested = this.focusRequested;
    this.focusRequested = undefined;
    if (requested !== undefined && Date.now() - requested.at <= FOCUS_REQUEST_TTL_MS) {
      this.post({ type: 'ui.focus', target: requested.target });
    }
  }

  /**
   * Asks the webview to bring a pending request into view (the "Open chat" link of an attention
   * notification, issue #19). Sends `ui.focus` now and keeps the target for the next `ready`:
   * revealing a hidden view loads a NEW document, the message sent before it exists is dropped by
   * the provider, and the snapshot that follows its `ready` is what makes the card exist.
   */
  focusRequest(target: FocusTarget): void {
    this.focusRequested = { target, at: Date.now() };
    this.post({ type: 'ui.focus', target });
  }

  /**
   * Reads the state of the server by REST and publishes it as one `snapshot`.
   *
   * Asks for the session list (the 50 newest; the open session's row is added by `session.get`
   * when it is older than those), the active sessions, the pending permissions and forms of the
   * whole LOCATION (`permission.request.list()` and `form.list()`, whose `{location, data}` answer
   * is NOT unwrapped by the client, unlike `permission.saved.list`) and, when a session is open,
   * its messages. The newest call wins: if another resync (or a server change) started
   * meanwhile, this result is dropped. A remembered session that no longer exists is forgotten
   * and the snapshot goes out with no open session. The requests are completed with those the
   * stream announced or resolved during the reads (`live`), then become the registry's content.
   * The snapshot also carries `resolutions`: the answered requests of the OPEN session that the
   * host remembers (E3-resolved-history), read at publication time so a `*.resolved` that arrived
   * during the REST reads is included; they come from memory, not from REST.
   *
   * The REST reads are older than the stream by the time they are published, so the snapshot is
   * reconciled with it in three steps: `translator.beginResync()` before the reads;
   * `translator.seed()` (merges REST messages with what the stream built, prunes what REST no
   * longer lists) and `translator.mergeLive()` (adds in-flight messages and longer block text)
   * right before posting; and `translator.mergeStatuses()` so that a `busy`/`idle`/`error` the
   * stream derived since the resync began wins over the REST one. Without these the webview,
   * which replaces its state with the snapshot, would lose a message in flight or stay on
   * "Working…" with Send disabled.
   * If the open session is deleted while its messages are being read (`this.open` no longer is the
   * id the reads started with), the snapshot goes out with NO open session, and the rows and
   * statuses of sessions deleted meanwhile (`live.removed`) are left out (review W1 of #20).
   * REST status of the open session: `busy` if listed as active; else `error` when its newest
   * message is an `idle` with outcome `failed` (scrubbed); else `idle`.
   * VERIFIED shapes against a real opencode 2.0.32 (planner spike, Windows 11, 2026-10-20).
   * VERIFIED (Windows 11, VS Code 1.142.0, 2026-10-20, opt-in `realOpencode.test.ts`, two runs):
   * `permission.request.list()` and `form.list()` are accepted by the real server and the
   * snapshots of the run were sent (`snapshot sent`, no `snapshot failed`). UNVERIFIED: the shape
   * of a NON-EMPTY list from a real server, because no snapshot was taken while a request was
   * pending (the synthetic fixture covers that shape, which is only as good as its reading of
   * the types).
   */
  async resync(): Promise<void> {
    const client = this.client;
    const server = this.server;
    if (client === undefined || server === undefined) return;
    const generation = ++this.generation;
    // Statuses the stream derives from here on override the (older) REST ones at publication.
    this.translator.beginResync();
    if (this.resyncing === 0) {
      this.live.permissions.clear();
      this.live.forms.clear();
      this.live.gone.clear();
      this.live.removed.clear();
    }
    this.resyncing += 1;
    try {
      const [list, active, permissionList, formList] = await Promise.all([
        client.session.list({ directory: server.folder, order: 'desc', limit: SESSION_LIMIT }),
        client.session.active(),
        client.permission.request.list(),
        client.form.list(),
      ]);
      const sessions: SessionSummary[] = list.data.map(toSessionSummary);
      const statuses: { [sessionID: string]: SessionStatus } = {};
      for (const id of Object.keys(active)) statuses[id] = { type: 'busy' };
      const restRequests: PendingAsks = {
        permissions: permissionList.data.map(toPermissionAsk),
        forms: formList.data.map(toFormAsk),
      };

      let open: OpenSession | undefined;
      let rawMessages: Awaited<ReturnType<ChatApi['message']['list']>>['data'] = [];
      const openID = this.open;
      if (openID !== undefined) {
        try {
          const messages = await client.message.list({
            sessionID: openID,
            order: 'desc',
            limit: MESSAGE_LIMIT,
          });
          rawMessages = [...messages.data].reverse(); // REST returned newest first
          open = { sessionID: openID, messages: [], parts: {} };
          for (const raw of rawMessages) {
            const mapped = toMessage(raw, this.secrets);
            if (mapped === undefined) continue;
            open.messages.push(mapped.message);
            if (mapped.parts.length > 0) open.parts[mapped.message.id] = mapped.parts;
          }
          if (!sessions.some((row) => row.id === openID)) {
            // Issue #20: a session opened from the list can be older than the 50 newest, and the
            // header takes its title from `sessions`; without the row it read "Untitled session".
            // Cosmetic, so a failure here must not fail the snapshot.
            try {
              sessions.push(toSessionSummary(await client.session.get({ sessionID: openID })));
            } catch (error) {
              this.log.debug(`could not read the open session row: ${String(error)}`);
            }
          }
          if (statuses[openID] === undefined) {
            const newest = messages.data[0];
            statuses[openID] =
              newest?.type === 'idle' && newest.outcome === 'failed' && newest.error !== undefined
                ? { type: 'error', error: toStructuredErrorInfo(newest.error, this.secrets) }
                : { type: 'idle' };
          }
        } catch (error) {
          if (!isSessionNotFound(error)) throw error;
          this.log.warn(`remembered session ${openID} no longer exists; forgetting it`);
          this.open = undefined;
          await this.deps.memory.set(server.folder, undefined);
        }
      }
      if (generation !== this.generation || this.disposed) return;
      // Issue #20, review W1: the open session can be deleted (by another client, or by us) WHILE
      // `message.list` was in flight and the server answered before deleting. `onSessionRemoved`
      // already cleared `this.open`; publishing the local `open` would show the dead session again
      // while the host believes there is none. The same goes for the rows the stream reported gone.
      if (openID !== undefined && this.open !== openID) {
        open = undefined;
        rawMessages = [];
      }
      for (const id of this.live.removed) delete statuses[id];
      const rows = sessions.filter((row) => !this.live.removed.has(row.id));
      this.translator.setOpen(this.open);
      this.translator.seed({ sessions: rows, messages: rawMessages });
      const requests = this.completeWithLive(restRequests);
      if (this.pending.replaceAll(requests.permissions, requests.forms)) {
        this.deps.attention.update(this.pending.list());
      }
      // So a request first seen here (asked before this host connected) can still be resolved
      // into a record when its `*.resolved` arrives.
      this.resolutions.rememberAsks(requests.permissions, requests.forms);
      // The webview replaces its state with the snapshot, and the stream may have produced
      // messages after the REST reads: complete the snapshot with them (review BLOCKER). The
      // statuses need the same care in the other direction: `session.active()` can say `busy`
      // and a `session.execution.succeeded` arrive before we publish; the stream already sent
      // `idle`, so the stale `busy` would overwrite it and nothing would ever correct it (Send
      // stays disabled while busy). `mergeStatuses` lets what the stream said since the resync
      // began win over what REST said.
      const complete = open === undefined ? undefined : this.translator.mergeLive(open);
      this.post({
        type: 'snapshot',
        snapshot: {
          sessions: rows,
          statuses: this.translator.mergeStatuses(statuses),
          ...(complete ? { open: complete } : {}),
          requests,
          resolutions: this.open === undefined ? [] : this.resolutions.forSession(this.open),
        },
      });
      this.log.info(`snapshot sent (${String(rows.length)} sessions, open ${this.open ?? 'none'})`);
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      const info = toErrorInfo(error, this.secrets);
      if (info.code === 'Transport') {
        // The server is unreachable (it died or is restarting): the connection banner already
        // says so, and a notice on top would only be noise (W4 of the review; seen in the log
        // of the real-opencode run when the test killed the server mid-snapshot).
        this.log.warn(`snapshot failed (server unreachable): ${info.message}`);
        return;
      }
      this.log.error(`snapshot failed: ${info.code}: ${info.message}`);
      this.post({ type: 'notice', level: 'error', error: info });
    } finally {
      this.resyncing -= 1;
    }
  }

  /**
   * Completes the REST requests with what the stream said while they were being read: an ask the
   * stream announced and REST did not list is added (REST was read before it existed); one the
   * stream resolved is removed (REST was read before it was answered). Order: REST first, then
   * the late arrivals. Same reasoning as `translator.mergeLive` for messages; the snapshot
   * REPLACES the webview's requests, so without this a card would vanish for a moment (or an
   * answered one come back) whenever a resync overlaps a request. Requests of a session the stream
   * reported deleted meanwhile (`live.removed`) are dropped too (issue #20).
   */
  private completeWithLive(rest: PendingAsks): PendingAsks {
    const permissions = rest.permissions.filter(
      (ask) => !this.live.gone.has(`permission:${ask.id}`) && !this.live.removed.has(ask.sessionID),
    );
    const forms = rest.forms.filter(
      (ask) => !this.live.gone.has(`form:${ask.id}`) && !this.live.removed.has(ask.sessionID),
    );
    for (const ask of this.live.permissions.values()) {
      if (!permissions.some((known) => known.id === ask.id)) permissions.push(ask);
    }
    for (const ask of this.live.forms.values()) {
      if (!forms.some((known) => known.id === ask.id)) forms.push(ask);
    }
    return { permissions, forms };
  }

  /** Remembers `sessionID` as the open one (for the served folder) and publishes its history. */
  private async openSession(sessionID: string): Promise<void> {
    this.open = sessionID;
    if (this.server !== undefined) await this.deps.memory.set(this.server.folder, sessionID);
    this.translator.setOpen(sessionID);
    await this.resync();
  }

  /** Posts the outcome of a request: success, or the scrubbed error. */
  private result(requestId: string, error?: unknown): void {
    if (error === undefined) {
      this.post({ type: 'request.result', requestId });
      return;
    }
    const info: ErrorInfo = toErrorInfo(error, this.secrets);
    this.log.warn(`request ${requestId} failed: ${info.code}: ${info.message}`);
    this.post({ type: 'request.result', requestId, error: info });
  }

  /**
   * `session.abort` (issue #16): interrupts the running turn of `sessionID`.
   *
   * Calls `session.interrupt` without `resume`: with this UI Send is disabled while busy, so
   * there are no queued prompts to resume (alternative `resume: true` only makes sense with
   * steering). The session goes idle through the `session.execution.interrupted` event the
   * translator already handles, not through this answer. `interrupted: false` means the server
   * had nothing of its own to interrupt (idle session, or a turn owned by another opencode
   * process), so the webview's "busy" may be stale: `resync()` heals it. The v1 route
   * `/session/:id/abort` that issue #16 cites does not exist in v2. The log line is stable (see
   * the header). VERIFIED against a real opencode 2.0.32 on Windows 11 (20/10/2026, opt-in
   * `realOpencode.test.ts`): a 400-number prompt interrupted 1.5 s in logged `abort requested for
   * ses_... (interrupted: true)` and then `turn finished: interrupted`, so the route, the bare
   * body and the event are as read. The `interrupted: false` path is only exercised against the
   * synthetic fixture (`chatController.e2e.test.ts`). POSIX UNVERIFIED.
   */
  private async abort(requestId: string, sessionID: string): Promise<void> {
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
    try {
      const { interrupted } = await client.session.interrupt({ sessionID });
      this.log.info(`abort requested for ${sessionID} (interrupted: ${String(interrupted)})`);
      this.result(requestId);
      if (!interrupted) await this.resync();
    } catch (error) {
      this.result(requestId, error);
    }
  }

  /**
   * Runs one editor-side action. These webview messages have no `requestId`, so a failure is
   * reported as a `warning` notice (scrubbed like every error text) and a `warn` log line; it
   * never throws.
   */
  private async editorAction(type: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`${type} failed: ${info.code}: ${info.message}`);
      this.post({ type: 'notice', level: 'warning', error: info });
    }
  }

  /**
   * `attachments.pick`: shows the picker and answers with the files. Their `uri`s are remembered
   * in `pickedUris`: the webview is untrusted, and the server would read any `file://` it is
   * given and send it to the model provider, so `prompt.send` accepts only what came from here.
   * A cancelled dialog is an empty list, not an error.
   */
  private async pickAttachments(requestId: string): Promise<void> {
    try {
      const files = await this.deps.editor.pickFiles();
      for (const file of files) this.pickedUris.add(file.uri);
      this.post({ type: 'attachments.picked', requestId, files });
      this.result(requestId);
    } catch (error) {
      this.result(requestId, error);
    }
  }

  /**
   * Sends the permission decision. Throws what the client throws (the server's error body) or the
   * `ServerUnavailable` body; callers turn it into a `request.result` or a return value.
   *
   * The `message` travels only with `reject` and only when it has text: the server uses it as the
   * correction the model sees (`CorrectedError`, the turn goes on), and an empty one would turn a
   * plain rejection into a "correction" with no content. `once` and `always` take no message.
   * A rejection with feedback is flagged in the memory of answered requests before the call (and
   * unflagged if the call fails), so the record says `withFeedback`; the text itself is not kept.
   * `requestID` is the permission id (`POST /api/session/:sid/permission/:rid/reply`, 204).
   * VERIFIED against a real opencode 2.0.32 (Windows 11, VS Code 1.142.0, 2026-10-20, opt-in
   * `realOpencode.test.ts`, two runs): `once` and a bare `reject` were accepted for a `read` of
   * `.env`; after `once` the turn ended `succeeded`, and after a bare `reject` it ended
   * `interrupted` (the model does NOT go on without a message). A `reject` with a message was
   * not sent to a real server. `always` is never sent by any automated test (it writes a rule
   * into the user's opencode database).
   */
  private async sendPermissionReply(
    sessionID: string,
    permissionID: string,
    decision: Extract<WebviewToHost, { type: 'permission.reply' }>['decision'],
    message?: string,
  ): Promise<void> {
    const client = this.client;
    // Thrown as a plain `{_tag, message}` body on purpose: it is what the real client throws for a
    // server error, and `toErrorInfo` reads both shapes the same way.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (client === undefined) throw unavailable();
    const problem = this.checkPending('permission', permissionID, sessionID, decision === 'always');
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (problem !== undefined) throw problem;
    const feedback =
      decision === 'reject' && message !== undefined && message.trim() !== '' ? message : undefined;
    // Marked BEFORE the call: the `permission.resolved` event can reach us before the HTTP answer.
    if (feedback !== undefined) this.resolutions.markReplied('permission', permissionID);
    try {
      await client.permission.reply({
        sessionID,
        requestID: permissionID,
        decision,
        ...(feedback === undefined ? {} : { message: feedback }),
      });
    } catch (error) {
      if (feedback !== undefined) this.resolutions.unmark('permission', permissionID);
      throw error;
    }
    this.log.info(`permission reply sent for ${permissionID} (${decision})`);
  }

  /** `permission.reply`: answers the request; never throws, the outcome is a `request.result`. */
  private async answerPermission(
    message: Extract<WebviewToHost, { type: 'permission.reply' }>,
  ): Promise<void> {
    try {
      await this.sendPermissionReply(
        message.sessionID,
        message.permissionID,
        message.decision,
        message.message,
      );
      this.result(message.requestId);
    } catch (error) {
      this.result(message.requestId, error);
      await this.healIfStale(error);
    }
  }

  /**
   * Answers a pending permission without a `requestId` (the "Allow once" / "Reject" links of an
   * attention notification, issue #19). Resolves with the scrubbed error, or `undefined` on
   * success; never rejects. A request that is gone resyncs, as for the webview's own replies.
   */
  async replyPermission(
    sessionID: string,
    permissionID: string,
    decision: 'once' | 'reject',
  ): Promise<ErrorInfo | undefined> {
    try {
      await this.sendPermissionReply(sessionID, permissionID, decision);
      return undefined;
    } catch (error) {
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`permission reply for ${permissionID} failed: ${info.code}: ${info.message}`);
      await this.healIfStale(error);
      return info;
    }
  }

  /**
   * `form.reply`: sends the answer of a question/form (`POST .../form/:fid/reply`, 204). A
   * `FormInvalidAnswerError` comes back as the error of the `request.result` and the form stays
   * open for the user to fix; a form that is already gone resyncs. The answer text is never logged.
   * VERIFIED against a real opencode 2.0.32 (Windows 11, VS Code 1.142.0, 2026-10-20, opt-in
   * `realOpencode.test.ts`): the `question` tool raised a form, the session waited (no turn end
   * in the 3 s after it), `{ q0: "A" }` (a plain string) was accepted and the turn then ended
   * `succeeded`. A `FormInvalidAnswerError` and `form.cancel` were never provoked on a real server.
   */
  private async answerForm(message: Extract<WebviewToHost, { type: 'form.reply' }>): Promise<void> {
    const client = this.client;
    if (client === undefined) return this.result(message.requestId, unavailable());
    const problem = this.checkPending('form', message.formID, message.sessionID);
    if (problem !== undefined) {
      this.result(message.requestId, problem);
      return this.healIfStale(problem);
    }
    try {
      await client.session.form.reply({
        sessionID: message.sessionID,
        formID: message.formID,
        answer: message.answer,
      });
      this.log.info(`form reply sent for ${message.formID}`);
      this.result(message.requestId);
    } catch (error) {
      this.result(message.requestId, error);
      await this.healIfStale(error);
    }
  }

  /**
   * `form.cancel`: dismisses a form (`DELETE .../form/:fid?message=`, 204). Without a message the
   * model STOPS (`CancelledError`); with one it goes on and reads it as feedback (read in
   * `question.ts@v2.0.32`; the real-server run of the opt-in suite does not cancel a question).
   * A blank message is dropped so "Dismiss" can never turn into an empty correction. A non-blank
   * one is flagged in the memory of answered requests (`withMessage`), like a rejection's feedback.
   */
  private async cancelForm(
    message: Extract<WebviewToHost, { type: 'form.cancel' }>,
  ): Promise<void> {
    const client = this.client;
    if (client === undefined) return this.result(message.requestId, unavailable());
    const problem = this.checkPending('form', message.formID, message.sessionID);
    if (problem !== undefined) {
      this.result(message.requestId, problem);
      return this.healIfStale(problem);
    }
    const note =
      message.message !== undefined && message.message.trim() !== '' ? message.message : undefined;
    // Marked BEFORE the call, as in `sendPermissionReply`.
    if (note !== undefined) this.resolutions.markReplied('form', message.formID);
    try {
      await client.session.form.cancel({
        sessionID: message.sessionID,
        formID: message.formID,
        ...(note === undefined ? {} : { message: note }),
      });
      this.log.info(`form cancel sent for ${message.formID}`);
      this.result(message.requestId);
    } catch (error) {
      if (note !== undefined) this.resolutions.unmark('form', message.formID);
      this.result(message.requestId, error);
      await this.healIfStale(error);
    }
  }

  /**
   * Checks an answer from the webview (or from a notification link) against the host's own
   * registry of pending requests: the request must be pending, belong to the `sessionID` given,
   * and for an `always` have `save[]` rules (opencode treats an `always` without them as `once`,
   * so allowing it would let the UI say one thing and the server do another). Returns the error
   * body to answer with, or `undefined` when it is fine. The webview is untrusted input (same
   * reasoning as `pickedUris`); today the server would also refuse an unknown id with a 404, so
   * this is defence in depth, not a fix for a reachable bug. `RequestNotPending` is treated as
   * stale and resyncs, because the usual cause is a registry that is behind or ahead of the
   * webview.
   */
  private checkPending(
    kind: PendingSummary['kind'],
    id: string,
    sessionID: string,
    always = false,
  ): { _tag: string; message: string } | undefined {
    const known = this.pending.find(kind, id);
    if (known?.sessionID !== sessionID) {
      return {
        _tag: 'RequestNotPending',
        message: 'That request is no longer waiting for an answer',
      };
    }
    if (always && known.canAlways !== true) {
      return {
        _tag: 'AlwaysNotAvailable',
        message: 'This request has no rules to save, so “always” is not available',
      };
    }
    return undefined;
  }

  /** Resyncs when `error` says the request is no longer pending (see {@link isStaleRequest}). */
  private async healIfStale(error: unknown): Promise<void> {
    if (isStaleRequest(error)) await this.resync();
  }

  /**
   * `permissions.manage`: lists the rules "Always" stored for the project, lets the user pick
   * which to revoke (`deps.savedPermissions`, which also asks for confirmation) and removes them
   * one by one. Reports the result as an info `notice`; a failure is a `warning` notice and a
   * `warn` log line. Stops at the first failed removal, so the count in the message is what really
   * went away. The rules' resources are never logged.
   */
  private async manageSavedPermissions(): Promise<void> {
    const client = this.client;
    if (client === undefined) {
      this.post({
        type: 'notice',
        level: 'warning',
        error: { code: 'ServerUnavailable', message: unavailable().message },
      });
      return;
    }
    let removed = 0;
    try {
      const saved = await client.permission.saved.list();
      if (saved.length === 0) {
        this.post({
          type: 'notice',
          level: 'info',
          error: { code: 'NoSavedPermissions', message: 'This project has no saved permissions' },
        });
        return;
      }
      const ids = await this.deps.savedPermissions.pickToRevoke(
        saved.map((rule) => ({
          id: rule.id,
          action: rule.action,
          resource: rule.resource,
          createdAt: rule.time.created,
        })),
      );
      for (const id of ids) {
        await client.permission.saved.remove({ id });
        removed += 1;
      }
      if (removed > 0) {
        this.log.info(`revoked ${String(removed)} saved permission(s)`);
        this.post({
          type: 'notice',
          level: 'info',
          error: {
            code: 'SavedPermissionsRevoked',
            message: `Revoked ${String(removed)} saved permission(s)`,
          },
        });
      }
    } catch (error) {
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(
        `managing saved permissions failed after ${String(removed)} removal(s): ${info.code}: ${info.message}`,
      );
      this.post({ type: 'notice', level: 'warning', error: info });
    }
  }

  /**
   * Handles one VALIDATED webview message (the caller ran `isWebviewToHost`).
   *
   * `prompt.send` creates a session when none is open, then calls `session.prompt` with the
   * delivery the webview chose and the attachments the file picker emitted. `session.new` (lazy)
   * and `session.open` change the open session. `session.abort` interrupts the turn (issue #16).
   * Issue #20: `sessions.query`, `session.rename` and `session.delete` serve the session list.
   * `editor.*`, `clipboard.write` and `attachments.pick` go to `deps.editor` and never need the
   * server; a failure becomes a `warning` notice (those messages carry no `requestId`).
   * Phase 3: `permission.reply`, `form.reply` and `form.cancel` call the server (a reply that fails
   * because the request is gone also resyncs, since the snapshot tells the truth);
   * `permissions.manage` runs the saved-permissions manager; `server.restart` and `logs.show` go
   * to `deps.server`.
   */
  handle(message: WebviewToHost): Promise<void> {
    return this.run(message);
  }

  /** Dispatch body of {@link handle}; kept apart so `dispatch` can return a Promise. */
  private async run(message: WebviewToHost): Promise<void> {
    const pending: Promise<void>[] = [];
    dispatch<WebviewToHost>(message, {
      ready: () => {
        pending.push(this.onWebviewReady());
      },
      'session.new': (m) => {
        pending.push(this.newSession(m.requestId));
      },
      'session.open': (m) => {
        pending.push(this.openRequested(m.requestId, m.sessionID));
      },
      'sessions.query': (m) => {
        pending.push(this.querySessions(m));
      },
      'session.rename': (m) => {
        pending.push(this.renameSession(m));
      },
      'session.delete': (m) => {
        pending.push(this.deleteSession(m));
      },
      'prompt.send': (m) => {
        pending.push(this.sendPrompt(m));
      },
      'session.abort': (m) => {
        pending.push(this.abort(m.requestId, m.sessionID));
      },
      'permission.reply': (m) => {
        pending.push(this.answerPermission(m));
      },
      'form.reply': (m) => {
        pending.push(this.answerForm(m));
      },
      'form.cancel': (m) => {
        pending.push(this.cancelForm(m));
      },
      'attachments.pick': (m) => {
        pending.push(this.pickAttachments(m.requestId));
      },
      'permissions.manage': () => {
        pending.push(this.manageSavedPermissions());
      },
      'server.restart': () => {
        this.deps.server.restart();
      },
      'logs.show': () => {
        this.deps.server.showLogs();
      },
      'editor.open': (m) => {
        pending.push(
          this.editorAction(m.type, () => this.deps.editor.open(m.path, m.line, m.column)),
        );
      },
      'editor.insert': (m) => {
        pending.push(this.editorAction(m.type, () => this.deps.editor.insert(m.text)));
      },
      'editor.newFile': (m) => {
        pending.push(this.editorAction(m.type, () => this.deps.editor.newFile(m.text, m.language)));
      },
      'clipboard.write': (m) => {
        pending.push(this.editorAction(m.type, () => this.deps.editor.copy(m.text)));
      },
      'webview.log': (m) => {
        this.log[m.level === 'warn' ? 'warn' : m.level === 'error' ? 'error' : 'info'](
          `[webview] ${m.message}`,
        );
      },
    });
    await Promise.all(pending);
  }

  /**
   * `session.new`, LAZY (issue #20, decision of Sergio 21/10/2026): creates nothing. It forgets the
   * open session (field, translator and per-folder memory) and resyncs, so the webview receives a
   * snapshot with no open session and shows the empty view; the first `prompt.send` without a
   * `sessionID` then creates the session through the path `sendPrompt` already has. Before this it
   * did `POST /api/session` on every click, leaving an empty "Untitled session" in the list (and
   * in the database the TUI shares). The session has no id until that first prompt. Still needs a
   * running server: the snapshot is how the webview learns it, and the button is disabled without
   * one.
   */
  private async newSession(requestId: string): Promise<void> {
    if (this.client === undefined) return this.result(requestId, unavailable());
    try {
      await this.forgetOpen();
      await this.resync();
      this.result(requestId);
    } catch (error) {
      this.result(requestId, error);
    }
  }

  /**
   * `session.open`: checks the session exists, then opens it. A `SessionNotFoundError` means the
   * row the user clicked is stale (deleted by another client, or an event was lost), so it is also
   * reported as `session.removed` to heal the list.
   */
  private async openRequested(requestId: string, sessionID: string): Promise<void> {
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
    try {
      await client.session.get({ sessionID });
      await this.openSession(sessionID);
      this.result(requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(requestId, error);
    }
  }

  /** Tells the webview (and the bookkeeping) that `sessionID` is gone when `error` says it is. */
  private healMissing(error: unknown, sessionID: string): void {
    if (isSessionNotFound(error)) this.publish([{ type: 'session.removed', sessionID }]);
  }

  /**
   * `sessions.query`: one page of the root sessions of the served folder, newest activity first,
   * optionally filtered by title ON THE SERVER (so it finds sessions older than any loaded page).
   * The cursor lives in {@link createSessionBrowser}; the page is mirrored in the translator so a
   * later `session.renamed` of one of its rows reaches the webview. The answer is `sessions.page`
   * followed by the `request.result` (the webview does NOT mark these as a pending send). An
   * `InvalidCursorError` resets the browser, so the next "more" starts again. If the server
   * changed while the page was in flight the page is dropped and the request answers
   * `ServerUnavailable`, so the webview never stays waiting. Logs the row count,
   * never the search text. VERIFIED against the synthetic server (`chatController.e2e.test.ts`,
   * real client); the real server's `search`, `parentID: null` and cursor were checked by the
   * planner spike only (Windows 11, opencode 2.0.32, 21/10/2026).
   */
  private async querySessions(
    message: Extract<WebviewToHost, { type: 'sessions.query' }>,
  ): Promise<void> {
    const { requestId } = message;
    const client = this.client;
    const server = this.server;
    if (client === undefined || server === undefined) {
      return this.result(requestId, unavailable());
    }
    try {
      const query = this.browser.query(message.search, message.more, server.folder);
      const answer = await client.session.list(query.input);
      // The server changed while we waited: the page belongs to another server, but the webview
      // must still hear back or its list stays "loading" (review S3).
      if (client !== this.client) return this.result(requestId, unavailable());
      const page = query.accept(answer);
      this.translator.mirror(page.rows);
      this.post({
        type: 'sessions.page',
        requestId,
        search: message.search,
        sessions: page.rows,
        append: page.append,
        hasMore: page.hasMore,
      });
      this.log.info(`sessions page (${String(page.rows.length)}, more: ${String(message.more)})`);
      this.result(requestId);
    } catch (error) {
      if (tagOf(error) === 'InvalidCursorError') this.browser.reset();
      this.result(requestId, error);
    }
  }

  /**
   * `session.rename`: trims the title and re-checks it (the webview already did, but it is
   * untrusted, and a BLANK title would make the server run the LLM title generator instead of
   * clearing it: VERIFIED by the planner spike). The visible result is the `session.renamed` event
   * the server publishes (translated to `session.upserted`, also when another client renames);
   * this only answers with a `request.result`. A session that no longer exists is reported as
   * `session.removed`. Logs the id, never the title.
   */
  private async renameSession(
    message: Extract<WebviewToHost, { type: 'session.rename' }>,
  ): Promise<void> {
    const { requestId, sessionID } = message;
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
    const title = message.title.trim();
    if (title === '' || title.length > MAX_SESSION_TITLE_LENGTH) {
      return this.result(requestId, {
        _tag: 'InvalidTitle',
        message: `A session title needs 1 to ${String(MAX_SESSION_TITLE_LENGTH)} characters`,
      });
    }
    try {
      await client.session.update({ sessionID, title });
      this.log.info(`session renamed ${sessionID}`);
      this.result(requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(requestId, error);
    }
  }

  /**
   * `session.delete`: asks the user through `deps.sessions.confirmDelete` (a native modal) and only
   * on "Delete" calls `DELETE /api/session/:id`. The host asks, not the webview: see
   * `sessionUi.ts`. The title shown comes from `session.get` and "running" from
   * `session.active()` at this moment, never from the webview's message, so the dialog cannot be
   * made to say something else. The id is put in `deleting` BEFORE the call, because the
   * `session.removed` events arrive before the HTTP answer (VERIFIED by the planner spike, all
   * within the same millisecond) and must not be announced as a delete by someone else. A
   * declined dialog is a success without error. The server deletes the child sessions too and
   * interrupts a busy one first; the events do the rest (`onSessionRemoved`, pending requests,
   * resolutions). If the stream is down no event comes, so after a successful call the controller
   * reports the removal itself (idempotent: the real event, if it arrives, finds nothing left to
   * do). Logs ids only.
   */
  private async deleteSession(
    message: Extract<WebviewToHost, { type: 'session.delete' }>,
  ): Promise<void> {
    const { requestId, sessionID } = message;
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
    try {
      const [info, active] = await Promise.all([
        client.session.get({ sessionID }),
        client.session.active(),
      ]);
      const confirmed = await this.deps.sessions.confirmDelete({
        title: info.title ?? '',
        running: Object.hasOwn(active, sessionID),
      });
      if (!confirmed) {
        this.log.info(`session delete cancelled ${sessionID}`);
        return this.result(requestId);
      }
      this.deleting.add(sessionID);
      try {
        await client.session.remove({ sessionID });
      } catch (error) {
        this.deleting.delete(sessionID);
        throw error;
      }
      this.log.info(`session deleted ${sessionID}`);
      this.publish([{ type: 'session.removed', sessionID }]);
      this.result(requestId);
    } catch (error) {
      this.healMissing(error, sessionID);
      this.result(requestId, error);
    }
  }

  /**
   * `prompt.send`: see {@link handle}. Never throws; the outcome goes out as `request.result`.
   * Every `files[].uri` must be in `pickedUris`, else the whole prompt is refused with
   * `AttachmentRejected` before touching the server (the attachment name is not trusted either,
   * but it is only a label).
   */
  private async sendPrompt(
    message: Extract<WebviewToHost, { type: 'prompt.send' }>,
  ): Promise<void> {
    const { requestId } = message;
    const client = this.client;
    if (client === undefined) return this.result(requestId, unavailable());
    if (message.files.some((file) => !this.pickedUris.has(file.uri))) {
      this.log.warn(`prompt ${requestId} rejected: an attachment was not emitted by the picker`);
      return this.result(requestId, {
        _tag: 'AttachmentRejected',
        message: 'Only files chosen with the Attach button can be sent',
      });
    }
    try {
      let sessionID = message.sessionID ?? this.open;
      if (sessionID === undefined) {
        sessionID = (await client.session.create({})).id;
        await this.openSession(sessionID);
      } else if (sessionID !== this.open) {
        await this.openSession(sessionID);
      }
      await client.session.prompt({
        sessionID,
        text: message.text,
        delivery: message.delivery,
        ...(message.files.length > 0
          ? { files: message.files.map((file) => ({ uri: file.uri, name: file.name })) }
          : {}),
      });
      this.log.info(`prompt accepted for ${sessionID}`);
      this.result(requestId);
    } catch (error) {
      this.result(requestId, error);
    }
  }

  /**
   * Stops the stream and makes the controller inert. Synchronous: the abort does not wait. Tells
   * the attention feature there is nothing pending any more (it closes its notifications), even
   * when the registry was already empty.
   */
  dispose(): void {
    this.disposed = true;
    this.stopStream();
    this.deps.attention.update([]);
  }
}

/** Error body for a request that arrives while there is no running server. */
function unavailable(): { _tag: string; message: string } {
  return { _tag: 'ServerUnavailable', message: 'The opencode server is not running' };
}
