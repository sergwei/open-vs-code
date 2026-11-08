// The model behind the native "Changes of the sessions" view (E9-sidebar-home, issue #187, phase 2,
// decision P2=1 of Sergio). PURE: no `vscode` import; the tree is `changesView.ts` and the wiring is
// `sidebarHome.ts`.
//
// Which sessions it lists (our choice, cap 20, newest first): the roots that have a chat tab, the
// roots whose steps changed files in THIS window (`touch`, fed by the controller) and the roots of
// the "Today" group of the Sessions tree. Their files are NOT read until the user expands one
// (`ensureLoaded`), so showing the view costs no request. A session's files are loaded by the very
// holder the chat tab uses (`createSessionDiffs`, `sessionDiff.ts`), one instance per expanded
// session with `open` fixed to that session: the list, the whitelist of openable paths, the original
// text of every file and the coalescing of refreshes are therefore the tab's, not a copy of them.

import * as l10n from '@vscode/l10n';
import type { ChangedFile, ErrorInfo } from '../shared/model';
import { plural } from '../shared/l10n';
import type { ChatApi } from './opencodeClient';
import type { ServerLog } from './opencodeServer';
import type { PathImpl } from './pathPolicy';
import {
  codedError,
  createSessionDiffs,
  type SessionDiffs,
  type TargetResult,
} from './sessionDiff';

/** Most sessions the view lists. Our own choice (decision P2=1): a screenful, never the whole history. */
export const MAX_CHANGE_SESSIONS = 20;

/** What the view needs from the outside; every read is lazy so a server change is always seen. */
export interface SessionChangesDeps {
  /** The client of the current server, or `undefined` without one. */
  client(): ChatApi | undefined;
  /** The folder the server serves, or `undefined` without a server. */
  folder(): string | undefined;
  /** The root sessions that have a chat tab right now. */
  tabs(): readonly string[];
  /** The root sessions of the "Today" group of the Sessions tree. */
  today(): readonly string[];
  /** When a root was last active (epoch ms), or `undefined` if the Sessions tree does not hold it. */
  updatedAt(sessionID: string): number | undefined;
  /** The title to show for a root; `''` when it has none. */
  titleOf(sessionID: string): string;
  /** The boundary of the revert prepared in the tab of `sessionID`, if a tab shows one. */
  boundary(sessionID: string): string | undefined;
  /** Epoch ms "now"; tests inject it. */
  now(): number;
  log: ServerLog;
  /** Turns a thrown value into the scrubbed error shown to the user (`toErrorInfo`). */
  describe(error: unknown): ErrorInfo;
  /** Path flavour; `path.win32` / `path.posix` in tests. */
  impl?: PathImpl;
}

/** One listed session as the tree draws it. `files` is `undefined` until it was expanded and read. */
export interface ChangesSession {
  sessionID: string;
  title: string;
  files: readonly ChangedFile[] | undefined;
  /** The scrubbed error of the last failed read; the files shown are the last good ones. */
  error: ErrorInfo | undefined;
}

/** The model returned by {@link createSessionChanges}. */
export interface SessionChanges {
  /** The sessions to list now, newest first, at most {@link MAX_CHANGE_SESSIONS}. */
  sessions(): ChangesSession[];
  /**
   * Reads the files of `sessionID` the first time (the expansion of its row) and resolves when the
   * list is held; later calls resolve at once. Never rejects: a failure is `ChangesSession.error`.
   * Without a server it resolves WITHOUT marking the session loaded, so the next expansion asks again.
   */
  ensureLoaded(sessionID: string): Promise<void>;
  /**
   * A step of `sessionID` (a root) ended or failed with files: the session is listed from now on
   * and, if it was already expanded, its list is read again (`SessionDiffs` coalesces the burst).
   */
  touch(sessionID: string): void;
  /** Reloads every session that was expanded (the refresh button). */
  refresh(): void;
  /** The list of candidates may have changed (a tab opened or closed, the Sessions tree moved): repaint. */
  listChanged(): void;
  /** Whitelist check for the open request of a file row; see `SessionDiffs.target`. */
  target(sessionID: string, path: string): TargetResult;
  /** The text `path` had before the session changed it; rejects with `DiffNotListed` if not listed. */
  original(sessionID: string, path: string): Promise<string>;
  /** How many files the held list of `sessionID` has, or `undefined` when none is held (memory only). */
  count(sessionID: string): number | undefined;
  /** The session was deleted: forgets it. */
  forget(sessionID: string): void;
  /** The server went away: forgets everything. */
  reset(): void;
  /** Calls `listener` whenever what the tree shows may have changed; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  /** Calls `listener` when the originals of a session may have moved; returns the unsubscribe. */
  onRenewed(listener: (sessionID: string) => void): () => void;
}

/** The totals of a list of files, for the row of its session. */
export function totalsOf(files: readonly ChangedFile[]): {
  count: number;
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { count: files.length, additions, deletions };
}

/**
 * The description of a session row once its files are known: `N files · +a −d` (`N file` for one).
 * The two counts are the server's, summed; a binary contributes zero.
 * VERIFIED by `sessionChanges.test.ts` "describes a session by its file count and its totals"
 * (Vitest, Windows 11, 07/11/2026): one file, two files and none, with the singular and the plural.
 */
export function describeChanges(files: readonly ChangedFile[]): string {
  const { count, additions, deletions } = totalsOf(files);
  return plural(
    count,
    l10n.t('{0} file · +{1} −{2}', count, additions, deletions),
    l10n.t('{0} files · +{1} −{2}', count, additions, deletions),
  );
}

/** The state of one expanded (or being expanded) session. */
interface Entry {
  diffs: SessionDiffs;
  files: readonly ChangedFile[] | undefined;
  error: ErrorInfo | undefined;
  loaded: boolean;
  loading: Promise<void> | undefined;
}

/**
 * Creates the model of the Changes view.
 *
 * Why one `SessionDiffs` per session (and not one shared instance): the holder keeps a SINGLE
 * listing and decides staleness by "is this still the open session"; giving each session its own
 * with a constant `open` reuses all of it unchanged (copying the loader to make it multi-session was
 * not worth a second copy of the whitelist and the originals). Its
 * `post` is captured here instead of reaching a webview: a `session.diff` message sets the files
 * and the error of the entry. A load that finds an empty list posts nothing, so after a load that
 * returned the session is marked loaded with `[]` if nothing was posted.
 * `touch` on a session whose first read is still in flight asks for one more read (coalesced by
 * the holder), because the event may postdate the files that read returns.
 * Entries are never pruned while the server lives: they only exist for sessions the user expanded
 * (a handful), and a diff tab that outlives its row still needs the original of its left side.
 * The revert boundary comes from the tab that shows the session; a session with no tab has none, so
 * its range is the whole session (UNVERIFIED against a real revert: the case is only reachable by
 * preparing a revert in a tab and closing it, which no check does).
 * Log lines (stable, ids and counts only): `session diff: <n> files for <sid>` comes from the
 * holder; this module adds none.
 * VERIFIED by `sessionChanges.test.ts` with a fabricated client (which sessions, the cap, lazy
 * loading, refresh by touch, forget). VERIFIED against the synthetic server (Windows 11, VS Code
 * 1.145.2, 08/11/2026, `npm run test:integration -- --label fake-server`, 69 passing): "lists the
 * changed files of a session without a tab and opens its native diff" (the real holder read four
 * files on expansion and the diff opened with its left side served). Not observed: a refresh by
 * `touch` in a real window (unit only), and any real server beyond what the opt-in
 * `realOpencode.test.ts` records for `session.diff`.
 */
export function createSessionChanges(deps: SessionChangesDeps): SessionChanges {
  const entries = new Map<string, Entry>();
  const touched = new Map<string, number>();
  const changeListeners = new Set<() => void>();
  const renewedListeners = new Set<(sessionID: string) => void>();
  const releases = new Map<string, () => void>();

  const notify = (): void => {
    for (const listener of changeListeners) listener();
  };

  /** The entry of `sessionID`, built on first use with its own holder. */
  const entryOf = (sessionID: string): Entry => {
    const known = entries.get(sessionID);
    if (known !== undefined) return known;
    const entry: Entry = {
      diffs: createSessionDiffs({
        client: () => deps.client(),
        folder: () => deps.folder(),
        open: () => sessionID,
        boundary: (id) => deps.boundary(id),
        post: (message) => {
          if (message.type !== 'session.diff' || message.sessionID !== sessionID) return;
          entry.files = message.files;
          entry.error = message.error;
          notify();
        },
        log: deps.log,
        describe: (error) => deps.describe(error),
        ...(deps.impl === undefined ? {} : { impl: deps.impl }),
      }),
      files: undefined,
      error: undefined,
      loaded: false,
      loading: undefined,
    };
    releases.set(
      sessionID,
      entry.diffs.onRenewed((id) => {
        for (const listener of renewedListeners) listener(id);
      }),
    );
    entries.set(sessionID, entry);
    return entry;
  };

  /** Recency of a candidate: the later of "touched in this window" and the Sessions tree's own time. */
  const recency = (sessionID: string): number =>
    Math.max(touched.get(sessionID) ?? 0, deps.updatedAt(sessionID) ?? 0);

  return {
    sessions() {
      const candidates = new Set<string>([...deps.tabs(), ...touched.keys(), ...deps.today()]);
      return [...candidates]
        .sort((a, b) => recency(b) - recency(a) || (a < b ? 1 : -1))
        .slice(0, MAX_CHANGE_SESSIONS)
        .map((sessionID) => {
          const entry = entries.get(sessionID);
          return {
            sessionID,
            title: deps.titleOf(sessionID),
            files: entry?.loaded === true ? (entry.files ?? []) : undefined,
            error: entry?.error,
          };
        });
    },

    ensureLoaded(sessionID) {
      const entry = entryOf(sessionID);
      if (entry.loaded) return Promise.resolve();
      if (entry.loading !== undefined) return entry.loading;
      if (deps.client() === undefined) return Promise.resolve();
      const mine = entry.diffs.request(sessionID).then(() => {
        // A server that went away mid-load (`reset`) dropped the entry: do not resurrect it.
        if (entries.get(sessionID) !== entry) return;
        entry.loaded = true;
        entry.loading = undefined;
        notify();
      });
      entry.loading = mine;
      return mine;
    },

    touch(sessionID) {
      touched.set(sessionID, deps.now());
      const entry = entries.get(sessionID);
      // A read already in flight is asked once more too: the event may postdate what it reads.
      if (entry !== undefined && (entry.loaded || entry.loading !== undefined)) {
        void entry.diffs.request(sessionID);
      }
      notify();
    },

    refresh() {
      for (const [sessionID, entry] of entries) {
        if (entry.loaded) void entry.diffs.request(sessionID);
      }
      notify();
    },

    listChanged: notify,

    target(sessionID, path) {
      const entry = entries.get(sessionID);
      return entry === undefined
        ? { ok: false, reason: 'not listed' }
        : entry.diffs.target(sessionID, path);
    },

    original(sessionID, path) {
      const entry = entries.get(sessionID);
      if (entry === undefined) {
        return Promise.reject(
          codedError('DiffNotListed', () =>
            l10n.t('That file is not in the changed files of this session'),
          ),
        );
      }
      return entry.diffs.original(sessionID, path);
    },

    count: (sessionID) => entries.get(sessionID)?.diffs.count(sessionID),

    forget(sessionID) {
      const entry = entries.get(sessionID);
      if (entry !== undefined) {
        entry.diffs.forget(sessionID);
        releases.get(sessionID)?.();
        releases.delete(sessionID);
        entries.delete(sessionID);
      }
      touched.delete(sessionID);
      notify();
    },

    reset() {
      for (const entry of entries.values()) entry.diffs.reset();
      for (const release of releases.values()) release();
      releases.clear();
      entries.clear();
      touched.clear();
      notify();
    },

    onChange(listener) {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },

    onRenewed(listener) {
      renewedListeners.add(listener);
      return () => {
        renewedListeners.delete(listener);
      };
    },
  };
}
