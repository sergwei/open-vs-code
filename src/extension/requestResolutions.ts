// Host-side memory of the requests the user already answered (issues #56/#18). Pure: no `vscode`,
// no I/O. opencode v2.0.32 forgets a permission the moment it is answered and keeps a form for ten
// minutes in memory (read in `permission.ts` and `form.ts@843a6c51`), so the exact decision ("Allowed
// once" against "Always allowed") exists only for whoever saw the `*.resolved` event. This module
// is that witness: it remembers the `*.asked` messages while they are pending and, when the matching
// `*.resolved` comes, builds the `RequestResolution` the webview files in the history.
//
// It lives in the host, not in the webview, because the webview document dies every time the view is
// hidden and on every Reload Window, while the host survives reconnection, a hidden view and
// Restart Server. It is NOT persisted (decision of Sergio, 21/10/2026, Engram
// `E3-resolved-history/decisions/reload-y-subagentes`): after a Reload Window only what the tool
// block itself says remains (`toolOutcome.ts` in the webview).

import type { FormAsk, PermissionAsk, RequestResolution } from '../shared/model';
import type { HostToWebview } from '../shared/protocol';

/**
 * Most resolutions kept per session. Our own choice, equal to the 200 messages a snapshot asks
 * for: an older answered request has no tool block in the history to hang from.
 */
export const MAX_RESOLUTIONS_PER_SESSION = 200;

/** Most sessions with resolutions kept; the least recently touched one is dropped first. Our own choice. */
export const MAX_RESOLUTION_SESSIONS = 50;

/** Which kind of request a reply was sent for. */
export type RequestKind = 'permission' | 'form';

/** The memory returned by {@link createRequestResolutions}. */
export interface RequestResolutions {
  /**
   * REPLACES the remembered pending requests with the ones of the snapshot (the same contract as
   * `pending.replaceAll`), so one asked before this host saw its `*.asked` event can still be
   * resolved into a record, and one the server deleted without a `*.replied` (opencode 2.0.32 does
   * it when a session is interrupted) is forgotten instead of lingering. The snapshot must already
   * include the asks the stream delivered meanwhile (`completeWithLive`), or they would be dropped.
   * Idempotent. The resolutions already stored are NOT touched.
   */
  rememberAsks(permissions: readonly PermissionAsk[], forms: readonly FormAsk[]): void;
  /**
   * Feeds one protocol message. A `*.asked` is remembered and returns `undefined`; a `*.resolved`
   * of a remembered request returns its {@link RequestResolution} (and stores it for
   * {@link RequestResolutions.forSession}); a `*.resolved` of an unknown request, and any other
   * message, return `undefined`.
   */
  observe(message: HostToWebview): RequestResolution | undefined;
  /**
   * Flags that the reply being sent for `id` carries a message (a rejection with feedback, or a
   * dismissed form with a note). Call it BEFORE sending the reply: the `*.resolved` event can
   * arrive before the reply's HTTP answer.
   */
  markReplied(kind: RequestKind, id: string): void;
  /** Undoes {@link RequestResolutions.markReplied} when the reply failed and the request stays pending. */
  unmark(kind: RequestKind, id: string): void;
  /** Resolutions of `sessionID`, oldest first (a copy). */
  forSession(sessionID: string): RequestResolution[];
  /**
   * Forgets the pending requests remembered, NOT the resolutions: the pending ones died with the
   * server, the answered ones are history and stay.
   */
  forgetAsks(): void;
}

/** What {@link createRequestResolutions} needs from the outside. */
export interface RequestResolutionsOptions {
  /** Epoch milliseconds; injected so tests control the clock. */
  now(): number;
  maxPerSession?: number;
  maxSessions?: number;
}

/**
 * Key of a request in the `replied` set: the kind is part of it so a permission and a form can
 * never collide. HYPOTHESIS: ids are unique across kinds on the server (prefixes `per_` / `frm_`
 * seen in real rows, not checked in the server code); the kind makes it irrelevant either way.
 */
function keyOf(kind: RequestKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Creates an empty memory.
 *
 * Bounds: {@link MAX_RESOLUTIONS_PER_SESSION} per session and {@link MAX_RESOLUTION_SESSIONS}
 * sessions (least recently touched first), so a long day cannot grow it without limit. The
 * remembered pending asks are pruned on every snapshot (`rememberAsks` replaces them, which also
 * covers the asks opencode 2.0.32 deletes on interrupt without publishing `*.replied`), and all
 * dropped with `forgetAsks` when the stream stops. Between two snapshots they can only grow by the
 * `*.asked` events seen. A `*.resolved` of an ask no longer remembered yields no record. A record
 * keeps the action and the FIRST resource only (the card shows the same) and never a form answer
 * or the text of a rejection; nothing here is logged. VERIFIED by `requestResolutions.test.ts`
 * with fabricated messages (logic only, not the contract); the shapes of the messages it consumes
 * were seen against a real opencode 2.0.32 (Windows 11, `test:visual`, 21/10/2026).
 */
export function createRequestResolutions(options: RequestResolutionsOptions): RequestResolutions {
  const maxPerSession = options.maxPerSession ?? MAX_RESOLUTIONS_PER_SESSION;
  const maxSessions = options.maxSessions ?? MAX_RESOLUTION_SESSIONS;
  const permissionAsks = new Map<string, PermissionAsk>();
  const formAsks = new Map<string, FormAsk>();
  const replied = new Set<string>();
  /** Insertion order is recency order: a touched session is deleted and set again. */
  const bySession = new Map<string, RequestResolution[]>();

  /** Stores a resolution, evicting the oldest of its session and the least recent session. */
  const store = (resolution: RequestResolution): void => {
    const list = bySession.get(resolution.sessionID) ?? [];
    bySession.delete(resolution.sessionID);
    list.push(resolution);
    while (list.length > maxPerSession) list.shift();
    bySession.set(resolution.sessionID, list);
    while (bySession.size > maxSessions) {
      const oldest = bySession.keys().next();
      if (oldest.done === true) break;
      bySession.delete(oldest.value);
    }
  };

  return {
    rememberAsks(permissions, forms) {
      permissionAsks.clear();
      formAsks.clear();
      for (const ask of permissions) permissionAsks.set(ask.id, ask);
      for (const ask of forms) formAsks.set(ask.id, ask);
    },

    observe(message) {
      switch (message.type) {
        case 'permission.asked':
          permissionAsks.set(message.permission.id, message.permission);
          return undefined;
        case 'form.asked':
          formAsks.set(message.form.id, message.form);
          return undefined;
        case 'permission.resolved': {
          const ask = permissionAsks.get(message.permissionID);
          if (ask === undefined) return undefined;
          permissionAsks.delete(ask.id);
          const flag = keyOf('permission', ask.id);
          const withFeedback = replied.delete(flag) && message.decision === 'reject';
          const first = ask.resources[0];
          const resolution: RequestResolution = {
            kind: 'permission',
            id: ask.id,
            sessionID: ask.sessionID,
            ...(ask.tool === undefined ? {} : { tool: ask.tool }),
            at: options.now(),
            decision: message.decision,
            action: ask.action,
            ...(first === undefined ? {} : { resource: first }),
            withFeedback,
          };
          store(resolution);
          return resolution;
        }
        case 'form.resolved': {
          const ask = formAsks.get(message.formID);
          if (ask === undefined) return undefined;
          formAsks.delete(ask.id);
          const flag = keyOf('form', ask.id);
          const withMessage = replied.delete(flag) && message.outcome === 'cancelled';
          const resolution: RequestResolution = {
            kind: 'form',
            id: ask.id,
            sessionID: ask.sessionID,
            ...(ask.tool === undefined ? {} : { tool: ask.tool }),
            at: options.now(),
            outcome: message.outcome,
            formKind: ask.kind,
            title: ask.title,
            withMessage,
          };
          store(resolution);
          return resolution;
        }
        default:
          return undefined;
      }
    },

    markReplied(kind, id) {
      replied.add(keyOf(kind, id));
    },

    unmark(kind, id) {
      replied.delete(keyOf(kind, id));
    },

    forSession(sessionID) {
      return [...(bySession.get(sessionID) ?? [])];
    },

    forgetAsks() {
      permissionAsks.clear();
      formAsks.clear();
      replied.clear();
    },
  };
}
