// The prepared revert of the open session (issue #32, plan Engram #1173, decisions #1174). PURE: no
// `vscode` import; the VS Code side is `sessionDiffEditor.ts` and `chatController.ts` only wires
// events and webview messages to this module, like it does for `sessionDiff.ts`.
//
// What the server gives (READ in `@opencode/client@2.0.32` and `core/src/session/revert.ts` @843a6c51,
// and observed on a `shell` message without a model): `session.revert.stage` answers a
// `SessionRevert { messageID, files? }` and the same object is `SessionInfo.revert` from then on,
// until `clear` or `commit`. `files` is the diff from the disk BEFORE the revert to the disk AFTER it,
// one complete-file patch per file (no `context`), paths relative to the same root as
// `session.diff`. So the OLD side of each patch is the text the file had before the revert, which is
// what the "what was undone" diff shows on its left.
//
// This module keeps the state the host needs from it: the boundary message (read synchronously by
// `sessionDiff.ts` to bound the "Changed files" list), the files as the webview sees them, and the
// whitelist plus patches behind `session.revert.open`. It also decides what the webview is told
// (`session.revert`) without repeating what it already holds.
//
// Security (architecture rule 1 and `isWebviewToHost`): like `sessionDiff.ts`, the webview names a
// file by the `path` this module gave it, and the host opens it only if THIS module listed it for
// the open session; a row whose path is absolute or leaves the served folder is dropped.

import path from 'node:path';
import type { FileDiffInfo, SessionRevert } from '@opencode/client';
import type { RevertState } from '../shared/model';
import type { HostToWebview } from '../shared/protocol';
import type { ServerLog } from './opencodeServer';
import type { PathImpl } from './pathPolicy';
import {
  codedError,
  originalFromPatch,
  toEntries,
  type DiffEntry,
  type DiffTarget,
  type TargetResult,
} from './sessionDiff';

/** External effects of {@link createSessionReverts}, injected so tests need no client or VS Code. */
export interface SessionRevertsDeps {
  /** The folder the server serves, or `undefined` without a server. */
  folder(): string | undefined;
  /** The open session of the chat; only its revert is kept. */
  open(): string | undefined;
  /** The root the server's paths are relative to (`SessionDiffs.rootFor`); may reject. */
  rootFor(sessionID: string): Promise<string | undefined>;
  post(message: HostToWebview): void;
  log: ServerLog;
  /** Path flavour; `path.win32` / `path.posix` in tests. */
  impl?: PathImpl;
}

/** The prepared revert of the open session; see {@link createSessionReverts}. */
export interface SessionReverts {
  /**
   * The id of the message the revert of `sessionID` starts at, or `undefined` without one. Set
   * SYNCHRONOUSLY by {@link SessionReverts.apply}, before the files are mapped, because the
   * "Changed files" load that follows an event reads it at once.
   */
  boundary(sessionID: string): string | undefined;
  /**
   * Takes `revert` (the answer of `stage`, the `revert` of a `session.revert.staged` event or of a
   * session row; `undefined` = none) as the revert of the open `sessionID`. Resolves the state the
   * webview should hold, or `undefined` when there is none, when it was superseded by a newer call
   * or by `reset`, or when `sessionID` is not the open session. With `post: true` it also tells
   * the webview as `session.revert`, unless it already holds exactly that; with `post: false` the
   * caller puts the state in a snapshot and the module only records that the webview holds it.
   * Never rejects: a failure to place the files leaves the revert with no files (the history is
   * still hidden) and logs a warning.
   */
  apply(
    sessionID: string,
    revert: SessionRevert | undefined,
    options: { post: boolean },
  ): Promise<RevertState | undefined>;
  /** The state already mapped for the open `sessionID`, or `undefined` (none, or still mapping). */
  state(sessionID: string): RevertState | undefined;
  /**
   * After a snapshot that carried `included` (what its row said): posts `session.revert` if the
   * state the host holds now is another one, because an event applied while the snapshot was being
   * built is newer than the REST read. Posts nothing when they agree.
   */
  resend(sessionID: string, included: RevertState | undefined): void;
  /** Whitelist check: the target of `path` if it is a file of the revert of the open `sessionID`. */
  target(sessionID: string, path: string): TargetResult;
  /** The text `path` had before the revert undid the session's changes; rejects when unknown. */
  original(sessionID: string, path: string): Promise<string>;
  /** Forgets everything held for `sessionID` (it was deleted, or its revert was committed). */
  forget(sessionID: string): void;
  /** Forgets everything and cuts off the mapping in flight (the server went away). */
  reset(): void;
}

/** What is kept for the revert of one session once its files are mapped. */
interface Held {
  sessionID: string;
  state: RevertState;
  rows: Map<string, { entry: DiffEntry; row: FileDiffInfo }>;
}

/** The comparable form of what the webview shows for a revert; `none` when there is no revert. */
function stateKey(state: RevertState | undefined): string {
  return state === undefined ? 'none' : JSON.stringify(state);
}

/**
 * Creates the holder of the prepared-revert state of the controller.
 *
 * Why it exists apart from the controller: `chatController.ts` is already 2.5k lines, and this has
 * its own whitelist, its own ordering rule (the boundary is visible at once, the files a moment
 * later) and its own "do not repeat" memory. Why the webview learns it in two ways: inside the
 * snapshot (`apply` with `post: false`, so hiding the messages is atomic with the messages) and as
 * `session.revert` while the session stays open.
 *
 * Ordering: every `apply` bumps a generation and sets the boundary before awaiting `rootFor`; a
 * mapping that finishes after a newer `apply` or a `reset` publishes nothing. A `clear` and a stage
 * that arrive back to back therefore end in the state of the LAST call, whatever the order in
 * which the root lookups return. What was last given to the webview is remembered (`posted`), and a
 * session switch counts as "the webview shows nothing", because it empties its view then.
 * Log lines (stable, ids and counts only, never a path): `revert: <n> file(s) outside the folder`
 * at `debug`, `revert files could not be placed: <reason>` at `warn`.
 * VERIFIED by `sessionRevert.test.ts` with fabricated rows and `path.win32` / `path.posix`
 * ("maps the files of a revert and publishes them once" and the cases around it, Windows 11,
 * 23/10/2026); the contract with a real server beyond an empty `files` is UNVERIFIED.
 */
export function createSessionReverts(deps: SessionRevertsDeps): SessionReverts {
  const impl = deps.impl ?? path;
  // The boundary of the newest `apply`, set before its files are mapped.
  let current: { sessionID: string; messageID: string } | undefined;
  let held: Held | undefined;
  let posted: { sessionID: string; key: string } | undefined;
  let generation = 0;

  /** Builds the state of `revert` for the open `sessionID`. */
  const map = async (
    sessionID: string,
    revert: SessionRevert,
  ): Promise<{ state: RevertState; rows: Held['rows'] }> => {
    const rows: Held['rows'] = new Map();
    const served = deps.folder();
    const given = revert.files ?? [];
    if (given.length === 0 || served === undefined) {
      return { state: { messageID: revert.messageID, files: [] }, rows };
    }
    let root: string | undefined;
    try {
      root = await deps.rootFor(sessionID);
    } catch (error) {
      deps.log.warn(`revert files could not be placed: ${String(error)}`);
    }
    const { entries, dropped } = toEntries(given, served, root, impl);
    if (dropped > 0) deps.log.debug(`revert: ${String(dropped)} file(s) outside the folder`);
    const byRaw = new Map(given.map((row) => [row.file, row]));
    for (const entry of entries) {
      const row = byRaw.get(entry.raw);
      if (row !== undefined) rows.set(entry.file.path, { entry, row });
    }
    return {
      state: { messageID: revert.messageID, files: entries.map((entry) => entry.file) },
      rows,
    };
  };

  return {
    boundary(sessionID) {
      return current?.sessionID === sessionID ? current.messageID : undefined;
    },

    async apply(sessionID, revert, options) {
      if (deps.open() !== sessionID) return undefined;
      const mine = ++generation;
      if (revert === undefined) {
        current = undefined;
        held = undefined;
      } else {
        current = { sessionID, messageID: revert.messageID };
      }
      const mapped = revert === undefined ? undefined : await map(sessionID, revert);
      if (mine !== generation || deps.open() !== sessionID) return undefined;
      held =
        mapped === undefined ? undefined : { sessionID, state: mapped.state, rows: mapped.rows };
      const state = mapped?.state;
      const key = stateKey(state);
      // Another session's revert never counts as "already shown": the webview empties on a switch.
      const shown = posted?.sessionID === sessionID ? posted.key : stateKey(undefined);
      posted = { sessionID, key };
      if (options.post && shown !== key) {
        deps.post({
          type: 'session.revert',
          sessionID,
          ...(state === undefined ? {} : { revert: state }),
        });
      }
      return state;
    },

    state(sessionID) {
      return deps.open() === sessionID && held?.sessionID === sessionID ? held.state : undefined;
    },

    resend(sessionID, included) {
      if (deps.open() !== sessionID) return;
      const now = held?.sessionID === sessionID ? held.state : undefined;
      const key = stateKey(now);
      if (key === stateKey(included)) return;
      posted = { sessionID, key };
      deps.post({
        type: 'session.revert',
        sessionID,
        ...(now === undefined ? {} : { revert: now }),
      });
    },

    target(sessionID, shown) {
      if (deps.open() !== sessionID || held?.sessionID !== sessionID) {
        return { ok: false, reason: 'session not open' };
      }
      const found = held.rows.get(shown);
      if (found === undefined) return { ok: false, reason: 'not listed' };
      const target: DiffTarget = {
        sessionID,
        path: shown,
        absolute: found.entry.absolute,
        status: found.entry.file.status,
        binary: found.entry.file.binary || found.entry.file.tooLarge,
        side: 'reverted',
      };
      return { ok: true, target };
    },

    original(sessionID, shown) {
      const checked = this.target(sessionID, shown);
      const found = checked.ok ? held?.rows.get(shown) : undefined;
      if (found === undefined) {
        return Promise.reject(
          codedError('DiffNotListed', 'That file is not among the files of the revert'),
        );
      }
      const text = originalFromPatch(found.row);
      if (text === undefined) {
        return Promise.reject(
          codedError('NoTextDiff', 'The server has no text diff for this file'),
        );
      }
      return Promise.resolve(text);
    },

    forget(sessionID) {
      if (current?.sessionID === sessionID) current = undefined;
      if (held?.sessionID === sessionID) held = undefined;
      if (posted?.sessionID === sessionID) posted = undefined;
      generation += 1;
    },

    reset() {
      generation += 1;
      current = undefined;
      held = undefined;
      posted = undefined;
    },
  };
}
