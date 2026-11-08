// What the Quick start view shows and what it may ask for (E9-sidebar-home, issue #187). Pure: no
// `vscode`. `homeView.ts` owns the real webview view and `sidebarHome.ts` wires the sources; this
// file composes the whole `home.state` from them, decides when to post it, and REVALIDATES every
// intention the webview sends against the host's own state (architecture rule 1: the webview is
// untrusted, so a stale or forged "stop" or "reply" does nothing).

import * as l10n from '@vscode/l10n';
import type {
  HomeAction,
  HomeActivity,
  HomeHostToWebview,
  HomeMode,
  HomeRunning,
  HomeState,
  HomeWaiting,
  HomeWebviewToHost,
} from '../shared/homeProtocol';
import { MAX_HOME_LABEL } from '../shared/homeProtocol';
import type { ConnectionState } from '../shared/protocol';
import type { ServerLog } from './opencodeServer';
import type { PendingSummary } from './pendingRequests';
import type { ActivityStep, SessionActivity } from './sessionActivity';

/** Most rows of each list the state carries. Our own choice: the box is a few hundred pixels tall. */
export const MAX_HOME_ROWS = 50;
/** Most MCP pills with a problem. Our own choice. */
export const MAX_HOME_MCP = 20;
/** How far up a parent chain is followed when the lineage does not know the root. Our own choice. */
const MAX_PARENT_HOPS = 16;

/** The read-only sources the state is built from; every read is lazy and never touches the server. */
export interface HomeSources {
  connection(): ConnectionState;
  /** The model a NEW session starts with, in words, or `undefined` while it is unknown. */
  model(): string | undefined;
  /** The MCP servers the host knows, with their status as the server reported it. */
  mcp(): readonly { name: string; status: string }[];
  runningSessions(): readonly string[];
  activityOf(sessionID: string): SessionActivity | undefined;
  /** The root of the lineage, `undefined` while the chain up to a root is incomplete. */
  rootOf(sessionID: string): string | undefined;
  labelOf(sessionID: string): string;
  /** The requests that wait for the user, in order of arrival. */
  pending(): readonly PendingSummary[];
}

/** What an intention does once the host accepted it. */
export interface HomeActions {
  /**
   * Starts a conversation from the box in a NEW tab, in the work mode asked for. Resolves with the
   * outcome; `error` is text for the user.
   */
  start(text: string, mode: HomeMode): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Stops the work of the tree of `rootID`; `false` when the host saw nothing of it running. */
  stop(rootID: string): Promise<boolean>;
  /** Puts the root of the session in a tab and focuses the card of the request. */
  reply(kind: 'permission' | 'form', sessionID: string, id: string): void;
  /** Opens the session in a tab. */
  open(sessionID: string): void;
  action(action: HomeAction): void;
}

/** Everything {@link HomeController} needs. */
export interface HomeControllerDeps extends HomeSources, HomeActions {
  /** Sends to the document; the view drops it when there is none ready. */
  post(message: HomeHostToWebview): void;
  log: ServerLog;
}

/** Removes control characters and cuts server text to {@link MAX_HOME_LABEL} before it is shown. */
function clean(text: string): string {
  return text.replace(/\p{Cc}/gu, ' ').slice(0, MAX_HOME_LABEL);
}

/** The activity step as the protocol words it. */
function activityOf(step: ActivityStep | undefined): HomeActivity | undefined {
  if (step === undefined) return undefined;
  if (step.kind === 'tool') return { kind: 'tool', name: clean(step.name) };
  return { kind: step.kind };
}

/**
 * Composes `home.state`, posts it when it changed, and answers the webview's intentions.
 *
 * Posting: the host always sends the WHOLE state. {@link changed} coalesces a burst into one post
 * on the next task (an event stream calls it many times a second) and skips the post when the
 * serialized state equals the last one sent, ERROR-bearing results included: `home.result` is a
 * separate message and is never suppressed. {@link onReady} resets the memory and sends at once,
 * because a new document knows nothing. Nothing is posted while no document is ready.
 *
 * Revalidation (each refusal is logged with a stable line and an id at most, never text):
 * `home.stop` only for a root this host sees running now; `home.reply` only for a request in its
 * own pending list, matched on kind, session and id; `home.open` only for a session the state lists
 * as running; `home.start` one at a time (a second Enter while a tab is being opened is refused, so
 * a double press cannot open two tabs). Mode: the host holds the work mode of the NEXT conversation
 * from the box (default manual, not persisted).
 * VERIFIED by `homeController.test.ts` (fabricated sources: complete state after ready, one post per
 * burst, no post when the key is unchanged, MCP pills, each revalidation and the in-flight start).
 */
export class HomeController {
  private ready = false;
  private mode: HomeMode = 'manual';
  private lastKey: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private starting = false;

  constructor(private readonly deps: HomeControllerDeps) {}

  /** The root a session belongs to: the lineage's, else its own parents as the registry knows them. */
  private rootFor(sessionID: string): string {
    const known = this.deps.rootOf(sessionID);
    if (known !== undefined) return known;
    let current = sessionID;
    for (let hop = 0; hop < MAX_PARENT_HOPS; hop += 1) {
      const parent = this.deps.activityOf(current)?.parentID;
      if (parent === undefined) break;
      current = parent;
    }
    return current;
  }

  /**
   * The whole state as of now. Running rows are the ROOTS that run or have a running descendant,
   * the oldest execution first (rows with no known start last); a running child never gets a row of
   * its own, it is counted and described inside its root's row.
   */
  buildState(): HomeState {
    const connection = this.deps.connection();
    const running = new Map<string, { own?: SessionActivity; children: SessionActivity[] }>();
    for (const id of this.deps.runningSessions()) {
      const activity = this.deps.activityOf(id);
      const root = this.rootFor(id);
      const entry = running.get(root) ?? { children: [] };
      if (activity !== undefined) {
        if (id === root) entry.own = activity;
        else entry.children.push(activity);
      }
      // A running session the registry has no entry for still counts as running its root.
      running.set(root, entry);
    }
    const rows: HomeRunning[] = [...running.entries()]
      .map(([sessionID, entry]) => {
        const newest = [...entry.children].sort(
          (a, b) => (b.since ?? 0) - (a.since ?? 0) || a.sessionID.localeCompare(b.sessionID),
        )[0];
        const childActivity = activityOf(newest?.current);
        const row: HomeRunning = {
          sessionID,
          title: clean(this.deps.labelOf(sessionID)),
          subagents: entry.children.length,
        };
        if (entry.own?.since !== undefined) row.since = entry.own.since;
        const own = activityOf(entry.own?.current);
        if (own !== undefined) row.activity = own;
        if (newest !== undefined) {
          row.child = {
            ...(newest.agent === undefined ? {} : { agent: clean(newest.agent) }),
            ...(childActivity === undefined ? {} : { activity: childActivity }),
          };
        }
        return row;
      })
      .sort(
        (a, b) =>
          (a.since ?? Number.MAX_SAFE_INTEGER) - (b.since ?? Number.MAX_SAFE_INTEGER) ||
          a.sessionID.localeCompare(b.sessionID),
      )
      .slice(0, MAX_HOME_ROWS);
    const waiting: HomeWaiting[] = this.deps
      .pending()
      .slice(0, MAX_HOME_ROWS)
      .map((request) => ({
        kind: request.kind,
        sessionID: request.sessionID,
        id: request.id,
        title: clean(this.deps.labelOf(this.rootFor(request.sessionID))),
      }));
    const mcp: HomeState['mcp'] = [];
    for (const server of this.deps.mcp()) {
      if (server.status === 'failed' || server.status === 'needs_auth') {
        mcp.push({ name: clean(server.name), status: server.status });
      }
    }
    mcp.length = Math.min(mcp.length, MAX_HOME_MCP);
    const model = this.deps.model();
    const reason =
      connection.state === 'unavailable' || connection.state === 'not-started'
        ? connection.reason
        : undefined;
    return {
      server: { state: connection.state, ...(reason === undefined ? {} : { reason }) },
      canStart: connection.state !== 'unavailable',
      ...(model === undefined ? {} : { model: clean(model) }),
      mode: this.mode,
      mcp,
      running: rows,
      waiting,
    };
  }

  /** The document loaded: the new document knows nothing, so the whole state goes out now. */
  onReady(): void {
    this.ready = true;
    this.cancelTimer();
    this.send(true);
  }

  /** The document is gone (hidden, disposed): post nothing until the next `ready`. */
  onClosed(): void {
    this.ready = false;
    this.cancelTimer();
  }

  /** Something the state is made of may have changed; posts once on the next task if it did. */
  changed(): void {
    if (!this.ready || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.send(false);
    }, 0);
  }

  /** Cancels a pending post (the view is being disposed). */
  dispose(): void {
    this.ready = false;
    this.cancelTimer();
  }

  /**
   * Handles one message that passed `isHomeWebviewToHost` (`home.ready` is {@link onReady}'s).
   * Never throws: the failure of an action becomes a `home.result` with the text for the user.
   */
  async onMessage(message: HomeWebviewToHost): Promise<void> {
    switch (message.type) {
      case 'home.ready':
        this.onReady();
        return;
      case 'home.mode':
        this.mode = message.mode;
        this.changed();
        return;
      case 'home.action':
        this.deps.action(message.action);
        return;
      case 'home.open': {
        const listed = this.buildState().running.some((row) => row.sessionID === message.sessionID);
        if (!listed) {
          this.deps.log.warn('home refused to open a session it does not list');
          return;
        }
        this.deps.open(message.sessionID);
        return;
      }
      case 'home.reply': {
        const known = this.deps
          .pending()
          .some(
            (request) =>
              request.kind === message.kind &&
              request.sessionID === message.sessionID &&
              request.id === message.id,
          );
        if (!known) {
          this.deps.log.warn('home refused to answer a request that is not pending');
          return;
        }
        this.deps.reply(message.kind, message.sessionID, message.id);
        return;
      }
      case 'home.stop': {
        const listed = this.buildState().running.some((row) => row.sessionID === message.sessionID);
        if (!listed) {
          this.deps.log.warn('home refused to stop a session that is not running');
          this.result(message.requestId, false, l10n.t('That session is not running anymore'));
          return;
        }
        let stopped: boolean;
        try {
          stopped = await this.deps.stop(message.sessionID);
        } catch {
          stopped = false;
        }
        this.result(
          message.requestId,
          stopped,
          stopped ? undefined : l10n.t('That session is not running anymore'),
        );
        return;
      }
      case 'home.start': {
        if (this.starting) {
          this.deps.log.warn('home refused a second start while one is in progress');
          this.result(message.requestId, false, l10n.t('A conversation is already being started'));
          return;
        }
        this.starting = true;
        try {
          const outcome = await this.deps.start(message.text, this.mode);
          this.result(message.requestId, outcome.ok, outcome.ok ? undefined : outcome.error);
        } catch {
          this.result(message.requestId, false, l10n.t('The conversation could not be started'));
        } finally {
          this.starting = false;
        }
        return;
      }
    }
  }

  /** Answers a `home.start` or `home.stop` by its `requestId`; `error` is already user-facing text. */
  private result(requestId: string, ok: boolean, error?: string): void {
    this.deps.post({
      type: 'home.result',
      requestId,
      ok,
      ...(error === undefined ? {} : { error }),
    });
  }

  /** Posts the state; with `force` even when it equals the last one sent (a new document). */
  private send(force: boolean): void {
    const state = this.buildState();
    const key = JSON.stringify(state);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.deps.post({ type: 'home.state', state });
  }

  /** Cancels the pending coalescing timer, if any; safe to call twice. */
  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
