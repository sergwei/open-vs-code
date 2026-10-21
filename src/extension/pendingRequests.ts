// Registry of the requests (permissions and forms) still waiting for the user, kept by the host
// (issues #18/#44/#19). Pure: no `vscode`, no I/O. The webview keeps its own copy for the cards;
// this one exists because the host must act while the webview is hidden or not even loaded: the
// badge, the notifications and the cures after an event the server never publishes.
//
// It is fed with the PROTOCOL messages the translator already produced (`permission.asked`,
// `permission.resolved`, `form.asked`, `form.resolved`) and with the REST snapshot (`replaceAll`),
// so there is one translation of the wire and one source of truth for "what is pending".

import type { FormAsk, PermissionAsk } from '../shared/model';
import type { HostToWebview } from '../shared/protocol';

/** Longest text of a summary line. Our own choice: a notification is one or two lines of UI. */
export const MAX_SUMMARY_LENGTH = 80;

/**
 * What a notification or the badge needs to know about one pending request. `detail` carries at
 * most the first resource, truncated: a resource can be a shell command with secrets in it, so the
 * full list never leaves the webview card (and nothing here is ever logged).
 */
export type PendingSummary = {
  kind: 'permission' | 'form';
  id: string;
  sessionID: string;
  title: string;
  detail: string;
  /**
   * Permissions only: the request has `save[]` rules, so "always" means something. The host
   * refuses an `always` for one without them (the server would silently treat it as `once`).
   */
  canAlways?: boolean;
};

/** The registry returned by {@link createPendingRequests}. */
export interface PendingRequests {
  /**
   * Updates the registry from one protocol message. Returns `true` when the set of pending ids
   * changed: an unknown `*.asked` adds, a known one is ignored (idempotent: the stream and the
   * snapshot can both announce the same request), a `*.resolved` removes if it was there, a
   * `session.removed` removes every request of that session (issue #20), and any other message
   * type returns `false`.
   */
  apply(message: HostToWebview): boolean;
  /** Replaces everything with the REST snapshot; returns `true` when the set of ids changed. */
  replaceAll(permissions: readonly PermissionAsk[], forms: readonly FormAsk[]): boolean;
  /** Pending requests in order of arrival, permissions and forms interleaved as they came. */
  list(): PendingSummary[];
  /** True when at least one request of `sessionID` is pending. */
  hasSession(sessionID: string): boolean;
  /** The pending request of that kind and id, or `undefined` when the host does not know it. */
  find(kind: PendingSummary['kind'], id: string): PendingSummary | undefined;
  /** Forgets everything (the server went away: its requests died with it). */
  clear(): void;
}

/** Cuts `text` to {@link MAX_SUMMARY_LENGTH} characters, adding an ellipsis when it was longer. */
function truncate(text: string): string {
  return text.length <= MAX_SUMMARY_LENGTH ? text : `${text.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}

/** Summary of a permission: the action, and the first resource with a count of the rest. */
function summarizePermission(ask: PermissionAsk): PendingSummary {
  const [first, ...others] = ask.resources;
  const more = others.length > 0 ? ` (+${String(others.length)} more)` : '';
  return {
    kind: 'permission',
    id: ask.id,
    sessionID: ask.sessionID,
    title: truncate(`Permission requested: ${ask.action}`),
    detail: first === undefined ? '' : truncate(`${first}${more}`),
    canAlways: ask.save.length > 0,
  };
}

/** Summary of a form; the title is the one the server gave it ("Questions" for the question tool). */
function summarizeForm(ask: FormAsk): PendingSummary {
  return {
    kind: 'form',
    id: ask.id,
    sessionID: ask.sessionID,
    title: truncate(ask.kind === 'question' ? 'The agent has a question' : ask.title),
    detail: ask.kind === 'question' ? truncate(ask.title) : '',
  };
}

/**
 * Creates an empty registry. Insertion order is arrival order (a `Map` keeps it), which is the
 * order the notifications and the dock follow. Ids are unique across kinds on the server side
 * (`per_…` and `frm_…`), but the key includes the kind anyway so a collision could not merge them.
 * VERIFIED by `pendingRequests.test.ts` with fabricated messages (logic only, not the contract).
 */
export function createPendingRequests(): PendingRequests {
  const items = new Map<string, PendingSummary>();
  const keyOf = (kind: PendingSummary['kind'], id: string): string => `${kind}:${id}`;

  return {
    apply(message) {
      switch (message.type) {
        case 'permission.asked': {
          const key = keyOf('permission', message.permission.id);
          if (items.has(key)) return false;
          items.set(key, summarizePermission(message.permission));
          return true;
        }
        case 'form.asked': {
          const key = keyOf('form', message.form.id);
          if (items.has(key)) return false;
          items.set(key, summarizeForm(message.form));
          return true;
        }
        case 'permission.resolved':
          return items.delete(keyOf('permission', message.permissionID));
        case 'form.resolved':
          return items.delete(keyOf('form', message.formID));
        case 'session.removed': {
          // Issue #20 / lesson #969: deleting a session interrupts it, and the server removes its
          // pending requests WITHOUT a `*.replied`, so nothing else would ever clear these.
          let removed = false;
          for (const [key, item] of items) {
            if (item.sessionID !== message.sessionID) continue;
            items.delete(key);
            removed = true;
          }
          return removed;
        }
        default:
          return false;
      }
    },

    replaceAll(permissions, forms) {
      const next = new Map<string, PendingSummary>();
      for (const ask of permissions)
        next.set(keyOf('permission', ask.id), summarizePermission(ask));
      for (const ask of forms) next.set(keyOf('form', ask.id), summarizeForm(ask));
      const changed = next.size !== items.size || [...next.keys()].some((key) => !items.has(key));
      items.clear();
      for (const [key, value] of next) items.set(key, value);
      return changed;
    },

    list() {
      return [...items.values()];
    },

    find(kind, id) {
      return items.get(keyOf(kind, id));
    },

    hasSession(sessionID) {
      return [...items.values()].some((item) => item.sessionID === sessionID);
    },

    clear() {
      items.clear();
    },
  };
}
