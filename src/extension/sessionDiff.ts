// The "Changed files" list of the open session and the original side of its diffs (issue #31,
// plan Engram #1150, decisions #1152-#1154). PURE: no `vscode` import; the VS Code side is
// `sessionDiffEditor.ts`, and `chatController.ts` only wires events and messages to this module.
//
// What the server gives (READ in `@opencode/client@2.0.32` and `core/src/session/diff.ts` /
// `vcs/git.ts` @843a6c51, never observed on a turn that edited files): `session.diff` answers the
// files changed in a RANGE OF TURNS, each as `{ file, patch, additions, deletions, status }`, with
// paths relative to the git worktree root (not to the served folder; see `diffRoot` for the
// location the host places them by). Without `context` the patch
// is the complete file, so the ORIGINAL text is rebuilt from it (context and `-` lines) with no
// second request; the list itself is asked with `context: 0` (only the changed lines), which is
// cheap. The range is the whole session: `from` = the first user message, `to` = the last one.
//
// Security (architecture rule 1 and `isWebviewToHost`): the webview names a file by the `path` this
// module gave it, and the host opens it only if THIS module listed it for the open session and it
// resolves inside the served folder. A server that answers `../x` or an absolute path gets that
// row dropped, never opened.

import path from 'node:path';
import type { FileDiffInfo } from '@opencode/client';
import type { ChangedFile, ErrorInfo } from '../shared/model';
import type { HostToWebview } from '../shared/protocol';
import type { ChatApi } from './opencodeClient';
import type { ServerLog } from './opencodeServer';
import { resolveInsideFolder, toAttachmentName, type PathImpl } from './pathPolicy';

/** Matches a unified-diff hunk header: `@@ -a[,b] +c[,d] @@`. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * True when the server gave no text diff for `file`: a binary (`patch: ""`, zero counts) or a file
 * the server cut for size (a header without hunks but with real counts: `emptyPatch` in
 * `vcs/patch.ts@843a6c51`, read). Such a row is listed, but it cannot be opened as a diff.
 * An added or deleted empty file keeps its header and has zero counts, so it is NOT binary.
 * HYPOTHESIS: the two server behaviours are as read; neither was observed on a real server.
 */
function hasNoTextDiff(file: FileDiffInfo): boolean {
  if (file.patch === '') return true;
  return !file.patch.split('\n').some((line) => HUNK_HEADER.test(line)) && fileChanged(file);
}

/** True when the server counted at least one added or deleted line. */
function fileChanged(file: Pick<FileDiffInfo, 'additions' | 'deletions'>): boolean {
  return file.additions > 0 || file.deletions > 0;
}

/**
 * Rebuilds the text a file had BEFORE the change from its COMPLETE patch (no `context` limit):
 * every context and `-` line, in order, each ended by `\n`, honouring `\ No newline at end of file`
 * (it applies to the old side only when the line before it was a context or `-` line) and keeping
 * a `\r` that ends a line, so a CRLF file keeps its line endings.
 *
 * Returns `undefined` when the original cannot be known: an empty patch (binary), a header with no
 * hunks but a changed line count (cut for size), or a patch that is not the whole file (a hunk
 * whose old range does not continue the lines already rebuilt, or whose body does not hold the
 * line count its header announces). An `added` file is always `""`. A patch with no hunks and zero
 * counts (an empty file) is `""`.
 * VERIFIED by `sessionDiff.test.ts` with FABRICATED unified patches (modified, added, deleted,
 * CRLF, no newline on either side, a context-limited patch refused): this checks the logic against
 * the format as READ in `vcs/patch.ts` and `git.ts` @843a6c51, NOT against a patch a real server
 * produced. HYPOTHESIS: the real format (quoted paths, `\ No newline` markers, non-UTF-8 content,
 * autocrlf of the snapshot repository); the spike with a model would settle it.
 */
export function originalFromPatch(
  file: Pick<FileDiffInfo, 'patch' | 'additions' | 'deletions' | 'status'>,
): string | undefined {
  if (file.status === 'added') return '';
  if (file.patch === '') return undefined;
  const lines = file.patch.split('\n');
  // A patch ends with `\n`: the last element is the empty string after it, not a context line.
  if (lines[lines.length - 1] === '') lines.pop();
  const first = lines.findIndex((line) => HUNK_HEADER.test(line));
  if (first === -1) return fileChanged(file) ? undefined : '';
  const original: string[] = [];
  let noNewline = false;
  let previous: ' ' | '-' | '+' | undefined;
  let announced = 0;
  let hunkStart = 0;
  // True when the current hunk gave exactly the number of old lines its header announced.
  const closeHunk = (): boolean => original.length - hunkStart === announced;
  for (const line of lines.slice(first)) {
    const header = HUNK_HEADER.exec(line);
    if (header !== null) {
      if (previous !== undefined && !closeHunk()) return undefined;
      const start = Number(header[1]);
      announced = header[2] === undefined ? 1 : Number(header[2]);
      // The old range must continue exactly what was rebuilt: a gap means a context-limited patch.
      if (announced === 0 ? start !== original.length : start !== original.length + 1) {
        return undefined;
      }
      hunkStart = original.length;
      previous = undefined;
      continue;
    }
    const marker = line.startsWith('\\') ? '\\' : line === '' ? ' ' : line[0];
    if (marker === '\\') {
      if (previous === ' ' || previous === '-') noNewline = true;
      continue;
    }
    if (marker === ' ' || marker === '-') {
      original.push(line.slice(1));
      noNewline = false;
      previous = marker;
    } else if (marker === '+') {
      previous = '+';
    } else {
      return undefined;
    }
  }
  if (!closeHunk()) return undefined;
  const text = original.map((line) => `${line}\n`).join('');
  return noNewline ? text.slice(0, -1) : text;
}

/**
 * The folder the server's paths are relative to: the session's LOCATION directory (`directory`)
 * moved up as many levels as `subpath` has segments (`SessionInfo.subpath` = the location relative
 * to the project directory; absent when they coincide). Returns `undefined` when `subpath` has a
 * `..` segment or does not match the end of `directory` (the server and the host disagree about
 * where the folder is, e.g. through a symlink): then no path of the list can be trusted. The
 * comparison ignores case on win32. Lexical, like {@link resolveInsideFolder}.
 * Why the location and its subpath, not the served folder alone: VERIFIED against a real opencode
 * 2.0.32 (Windows 11, 23/10/2026) by the case "reports the subpath of a session served from a
 * subfolder of a repository" of `realOpencode.test.ts`: a server started in `<repo>/src` reports
 * `location.directory` = `<repo>/src` and `subpath` = `src`, so this function gives `<repo>`.
 * HYPOTHESIS: that the paths of `session.diff` start at that root (no real turn that edited files
 * was observed) and that a worktree or a symlinked folder behave the same.
 */
export function diffRoot(
  directory: string,
  subpath: string | undefined,
  impl: PathImpl = path,
): string | undefined {
  const segments = (subpath ?? '').split(/[\\/]/).filter((part) => part !== '' && part !== '.');
  if (segments.includes('..')) return undefined;
  if (segments.length === 0) return directory;
  const root = impl.resolve(directory, ...segments.map(() => '..'));
  const tail = impl
    .relative(root, directory)
    .split(impl.sep)
    .filter((part) => part !== '');
  const same = (a: string, b: string): boolean =>
    impl.sep === '\\' ? a.toLowerCase() === b.toLowerCase() : a === b;
  const matches =
    tail.length === segments.length && tail.every((part, i) => same(part, segments[i] ?? ''));
  return matches ? root : undefined;
}

/**
 * One listed file with what the host needs and the webview must not hold: the absolute path
 * (what VS Code opens) and the server's own spelling (`raw`, the key into a full patch).
 */
export interface DiffEntry {
  file: ChangedFile;
  absolute: string;
  raw: string;
}

/**
 * Maps the server's rows to entries, resolving each path. A row whose path is absolute, has a
 * `NUL`, or does not end up inside `served` is DROPPED and counted in `dropped` (never listed, so
 * never openable); duplicates keep the first. The `path` of the entry is relative to `served` with
 * `/` separators. Sorted by `path` for a stable list. `root` comes from {@link diffRoot}; when it
 * is `undefined` every row is dropped.
 * VERIFIED by `sessionDiff.test.ts` with `path.win32` and `path.posix` (fabricated rows, run on
 * Windows 11): `../x`, an absolute path, another drive and a `NUL` are dropped.
 */
export function toEntries(
  rows: readonly FileDiffInfo[],
  served: string,
  root: string | undefined,
  impl: PathImpl = path,
): { entries: DiffEntry[]; dropped: number } {
  const byPath = new Map<string, DiffEntry>();
  let dropped = 0;
  for (const row of rows) {
    const absolute =
      root === undefined || row.file === '' || impl.isAbsolute(row.file) || row.file.includes('\0')
        ? undefined
        : resolveInsideFolder(served, impl.resolve(root, row.file), impl);
    if (absolute === undefined) {
      dropped += 1;
      continue;
    }
    const shown = toAttachmentName(served, absolute, impl);
    if (byPath.has(shown)) continue;
    byPath.set(shown, {
      absolute,
      raw: row.file,
      file: {
        path: shown,
        status: row.status,
        additions: row.additions,
        deletions: row.deletions,
        binary: hasNoTextDiff(row),
      },
    });
  }
  const entries = [...byPath.values()].sort((a, b) =>
    a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0,
  );
  return { entries, dropped };
}

/** What the editor side needs to open one listed file (see `EditorActions.openDiff`). */
export interface DiffTarget {
  sessionID: string;
  /** The listed path (relative to the served folder, `/` separators): the key of the original. */
  path: string;
  /** Where the file is (or was) on disk. */
  absolute: string;
  status: ChangedFile['status'];
  binary: boolean;
}

/** Why {@link SessionDiffs.target} refused: the session is not the open one, or the path was not listed. */
export type DiffRefusal = 'session not open' | 'not listed';

/** Answer of {@link SessionDiffs.target}. */
export type TargetResult = { ok: true; target: DiffTarget } | { ok: false; reason: DiffRefusal };

/** The range of turns the list covers (`from`/`to` of `session.diff`, both user message ids). */
interface DiffRange {
  from: string;
  to?: string;
}

/** The last list published for a session: what the webview shows and the whitelist of the host. */
interface Listing {
  sessionID: string;
  range: DiffRange | undefined;
  entries: Map<string, DiffEntry>;
  files: ChangedFile[];
}

/** External effects of {@link createSessionDiffs}, injected so tests need no client or VS Code. */
export interface SessionDiffsDeps {
  /** The client of the current server, or `undefined` without one. */
  client(): ChatApi | undefined;
  /** The folder the server serves, or `undefined` without a server. */
  folder(): string | undefined;
  /** The open session of the chat; only its list is loaded and published. */
  open(): string | undefined;
  post(message: HostToWebview): void;
  log: ServerLog;
  /** Turns a thrown value into the scrubbed error shown to the user (`toErrorInfo`). */
  describe(error: unknown): ErrorInfo;
  /** Path flavour; `path.win32` / `path.posix` in tests. */
  impl?: PathImpl;
}

/** The list and the originals of the open session; see {@link createSessionDiffs}. */
export interface SessionDiffs {
  /**
   * Reloads the list of `sessionID` and publishes it as `session.diff`. Calls that arrive while a
   * load runs cost at most one more load (the burst of a turn's steps). Never rejects.
   */
  request(sessionID: string): Promise<void>;
  /**
   * Posts the list already held for `sessionID` when it has files (after a snapshot, for a webview
   * document that starts empty). A load that finds the list unchanged posts nothing.
   */
  resend(sessionID: string): void;
  /** Whitelist check: the target of `path` if it was listed for the open `sessionID`. */
  target(sessionID: string, path: string): TargetResult;
  /** The text `path` had before the session changed it; rejects when it is not listed or unknowable. */
  original(sessionID: string, path: string): Promise<string>;
  /** Forgets everything held for `sessionID` (it was deleted). */
  forget(sessionID: string): void;
  /** Forgets the cached first message of `sessionID` (a revert was committed: the range moved). */
  forgetRange(sessionID: string): void;
  /** Forgets everything and cuts off the load in flight (the server went away). */
  reset(): void;
  /**
   * Subscribes to "the originals of `sessionID` may have changed": fired after a load that replaced
   * a list with a different one or moved the start of the range (a committed revert). Returns the
   * unsubscribe function. The content provider re-reads its open documents on it.
   */
  onRenewed(listener: (sessionID: string) => void): () => void;
}

/** The comparable form of what the webview shows: the files and, if any, the refresh error. */
function postedKey(files: readonly ChangedFile[], error?: ErrorInfo): string {
  return JSON.stringify({ files, error });
}

/** Error with a stable `name` code, like the ones the editor side throws. */
function codedError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = code;
  return error;
}

/**
 * Creates the holder of the "Changed files" state of the controller.
 *
 * Why it exists apart from the controller: `chatController.ts` is already 2.4k lines, and this has
 * its own cache, whitelist and coalescing. Why the HOST pushes the list (no on-demand request): the
 * collapsed summary must show N before anyone opens anything, and #32 needs the list without
 * opening a diff. A load costs two `message.list` reads of one user message each (the first is
 * cached per session), one `session.diff` with `context: 0` and, only when it returned files, a
 * `session.get` (once per session, for the location that places the paths); the complete patches
 * are asked only when a file is opened, once per generation (every `request` starts a new one) and
 * per listing (a patch set fetched while a load was running is not reused for the list that load
 * publishes, because its range may differ).
 * What was last posted (files AND error) is remembered: the same files with the same error state
 * are not posted again, but a successful load after a failed one posts the files without the
 * error, so the webview clears "Could not refresh the list". `onRenewed` tells the content
 * provider when open originals may be stale.
 *
 * Coalescing is the one of `loadCatalog`: a `request` during a load marks it dirty and shares its
 * promise. A load whose server changed (`reset`) or whose session is no longer the open one does
 * not publish. A failed load keeps the previous list and posts it with the scrubbed `error`;
 * `SessionNotFoundError` is silent (the removal event heals it). Log lines (stable, ids and counts
 * only, never a path): `session diff: <n> files for <sid>`, `session diff failed: <code>`.
 * VERIFIED by `sessionDiff.test.ts` with a fake client (single flight, stale loads, whitelist);
 * the contract with a real server is UNVERIFIED beyond what `realOpencode.test.ts` records.
 */
export function createSessionDiffs(deps: SessionDiffsDeps): SessionDiffs {
  const impl = deps.impl ?? path;
  const places = new Map<string, { directory: string; subpath: string }>();
  const firsts = new Map<string, string>();
  let listing: Listing | undefined;
  let posted: { sessionID: string; key: string } | undefined;
  const listeners = new Set<(sessionID: string) => void>();
  let epoch = 0;
  let generation = 0;
  let run: Promise<void> | undefined;
  let dirty = false;
  let wanted = '';
  let full:
    | {
        generation: number;
        sessionID: string;
        listing: Listing;
        patches: Promise<Map<string, FileDiffInfo>>;
      }
    | undefined;

  /** True when a load that started for (`client`, `sessionID`, `at`) must not publish any more. */
  const stale = (client: ChatApi, sessionID: string, at: number): boolean =>
    at !== epoch || deps.client() !== client || deps.open() !== sessionID;

  /**
   * Where the session lives on the server: its location directory and its `subpath` (`''` when the
   * server sends none), cached per session. They place the paths of the rows, see {@link diffRoot}.
   * A read cut off by `reset()` (stale) is returned but not cached, so it cannot refill the cache
   * `reset()` just cleared.
   */
  const placeOf = async (
    client: ChatApi,
    sessionID: string,
    at: number,
  ): Promise<{ directory: string; subpath: string }> => {
    const known = places.get(sessionID);
    if (known !== undefined) return known;
    const info = await client.session.get({ sessionID });
    const place = { directory: info.location.directory, subpath: info.subpath ?? '' };
    if (!stale(client, sessionID, at)) places.set(sessionID, place);
    return place;
  };

  /**
   * First and last user message of the session as the `from`/`to` of `session.diff`; `undefined`
   * when it has no user message. `to` is left out when both are the same message. The first one is
   * cached only if the load is not stale (same reason as {@link placeOf}).
   * HYPOTHESIS: that `message.list({ type: 'user' })` filters on a real server. The contract case
   * of `realOpencode.test.ts` only shows the `type` filter is ACCEPTED and answers `{data, cursor}`
   * on a history with no user message; that it filters needs a delivered turn (a model). Also
   * HYPOTHESIS: that `from === to` would be accepted (not relied on).
   */
  const rangeOf = async (
    client: ChatApi,
    sessionID: string,
    at: number,
  ): Promise<DiffRange | undefined> => {
    let first = firsts.get(sessionID);
    if (first === undefined) {
      const page = await client.message.list({ sessionID, type: 'user', order: 'asc', limit: 1 });
      first = page.data[0]?.id;
      if (first === undefined) return undefined;
      if (!stale(client, sessionID, at)) firsts.set(sessionID, first);
    }
    const newest = await client.message.list({ sessionID, type: 'user', order: 'desc', limit: 1 });
    const last = newest.data[0]?.id ?? first;
    return last === first ? { from: first } : { from: first, to: last };
  };

  /** One load: reads, resolves paths, replaces `listing` and posts it. */
  const load = async (sessionID: string, at: number): Promise<void> => {
    const client = deps.client();
    const served = deps.folder();
    if (client === undefined || served === undefined || deps.open() !== sessionID) return;
    try {
      const range = await rangeOf(client, sessionID, at);
      const rows =
        range === undefined
          ? []
          : await client.session.diff({
              sessionID,
              from: range.from,
              ...(range.to === undefined ? {} : { to: range.to }),
              context: 0,
            });
      // The location is only needed to place the rows, so a session that changed nothing (the
      // usual case) costs no `session.get`.
      const place = rows.length === 0 ? undefined : await placeOf(client, sessionID, at);
      if (stale(client, sessionID, at)) return;
      const root = place === undefined ? served : diffRoot(place.directory, place.subpath, impl);
      const { entries, dropped } = toEntries(rows, served, root, impl);
      if (dropped > 0)
        deps.log.debug(`session diff: ${String(dropped)} file(s) outside the folder`);
      const previous = listing?.sessionID === sessionID ? listing : undefined;
      const files = entries.map((entry) => entry.file);
      listing = {
        sessionID,
        range,
        entries: new Map(entries.map((entry) => [entry.file.path, entry])),
        files,
      };
      const key = postedKey(files);
      // Another session's list never counts as "already shown": the webview empties on a switch.
      const shown = posted?.sessionID === sessionID ? posted.key : postedKey([]);
      posted = { sessionID, key };
      // The originals may have moved when the list or the start of the range changed (a committed
      // revert moves the start); the content provider re-reads its open documents.
      if (
        previous !== undefined &&
        (previous.range?.from !== range?.from || postedKey(previous.files) !== key)
      ) {
        for (const listener of listeners) listener(sessionID);
      }
      // Nothing is said when the webview already holds this very state, error included (it keeps
      // the list across snapshots of the same session); a successful load after a failed one DOES
      // post, to clear the error.
      if (shown === key) return;
      deps.log.info(`session diff: ${String(files.length)} files for ${sessionID}`);
      deps.post({ type: 'session.diff', sessionID, files });
    } catch (error) {
      if (stale(client, sessionID, at)) return;
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { _tag?: unknown })._tag === 'SessionNotFoundError'
      ) {
        return;
      }
      const info = deps.describe(error);
      deps.log.warn(`session diff failed: ${info.code}`);
      const files = listing?.sessionID === sessionID ? listing.files : [];
      const key = postedKey(files, info);
      if (posted?.sessionID === sessionID && posted.key === key) return;
      posted = { sessionID, key };
      deps.post({ type: 'session.diff', sessionID, files, error: info });
    }
  };

  /** Loads, and once more per `dirty` raised meanwhile, while the server of `at` holds. */
  const repeat = async (at: number): Promise<void> => {
    do {
      dirty = false;
      await load(wanted, at);
    } while (dirty && at === epoch);
  };

  /** Complete patches of the listing's range, once per generation; shared by concurrent opens. */
  const patchesOf = (current: Listing): Promise<Map<string, FileDiffInfo>> => {
    // Keyed on the listing too: a set fetched while a load ran has the OLD range, and must not
    // serve the list that load publishes.
    if (full?.generation === generation && full.listing === current) return full.patches;
    const client = deps.client();
    if (client === undefined || current.range === undefined) {
      return Promise.reject(codedError('ServerUnavailable', 'The opencode server is not running'));
    }
    const patches = client.session
      .diff({
        sessionID: current.sessionID,
        from: current.range.from,
        ...(current.range.to === undefined ? {} : { to: current.range.to }),
      })
      .then((rows) => new Map(rows.map((row) => [row.file, row])));
    const mine = { generation, sessionID: current.sessionID, listing: current, patches };
    full = mine;
    // A failed read must not stay cached: the next open asks again.
    void patches.catch(() => {
      if (full === mine) full = undefined;
    });
    return patches;
  };

  /** The whitelist check; see {@link SessionDiffs.target}. */
  const target = (sessionID: string, shown: string): TargetResult => {
    if (deps.open() !== sessionID || listing?.sessionID !== sessionID) {
      return { ok: false, reason: 'session not open' };
    }
    const entry = listing.entries.get(shown);
    if (entry === undefined) return { ok: false, reason: 'not listed' };
    return {
      ok: true,
      target: {
        sessionID,
        path: shown,
        absolute: entry.absolute,
        status: entry.file.status,
        binary: entry.file.binary,
      },
    };
  };

  return {
    request(sessionID) {
      generation += 1;
      wanted = sessionID;
      if (run !== undefined) {
        dirty = true;
        return run;
      }
      const at = epoch;
      const mine: Promise<void> = repeat(at).finally(() => {
        if (run === mine) run = undefined;
      });
      run = mine;
      return mine;
    },

    resend(sessionID) {
      if (listing?.sessionID !== sessionID || listing.files.length === 0) return;
      posted = { sessionID, key: postedKey(listing.files) };
      deps.post({ type: 'session.diff', sessionID, files: listing.files });
    },

    target,

    async original(sessionID, shown) {
      const checked = target(sessionID, shown);
      if (!checked.ok) {
        throw codedError('DiffNotListed', 'That file is not in the changed files of this session');
      }
      if (checked.target.status === 'added') return '';
      const current = listing;
      const entry = current?.entries.get(shown);
      if (current === undefined || entry === undefined) {
        throw codedError('DiffNotListed', 'That file is not in the changed files of this session');
      }
      const row = (await patchesOf(current)).get(entry.raw);
      const text = row === undefined ? undefined : originalFromPatch(row);
      if (text === undefined) {
        throw codedError('NoTextDiff', 'The server has no text diff for this file');
      }
      return text;
    },

    forget(sessionID) {
      places.delete(sessionID);
      firsts.delete(sessionID);
      if (listing?.sessionID === sessionID) listing = undefined;
      if (posted?.sessionID === sessionID) posted = undefined;
      if (full?.sessionID === sessionID) full = undefined;
    },

    forgetRange(sessionID) {
      firsts.delete(sessionID);
    },

    reset() {
      epoch += 1;
      generation += 1;
      run = undefined;
      dirty = false;
      listing = undefined;
      posted = undefined;
      full = undefined;
      places.clear();
      firsts.clear();
    },

    onRenewed(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
