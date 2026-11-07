// Work mode of the sessions (E3-work-mode): "Manual" leaves the permission requests of opencode to
// its own rules (a card when they ask), "Auto" makes the HOST answer `once` by itself. Pure: no
// `vscode`, no I/O, no timers. `ChatController` wires it to the stream; this module only keeps the
// state and takes the decisions, so they can be tested without a server.
//
// Decisions of Sergio (07/11/2026, Engram `e3-work-mode/decisions/seis-preguntas`): the mode is per
// session and lives in the memory of the host (a new session and a reload start in Manual); a
// subagent follows the mode of its root; Auto answers `once`, never `always` (which would write a
// rule into the database of opencode, `permission.ts@843a6c51`); and Auto still asks for what
// `keepsForUser` lists (secrets, outside the project, deletions, destructive commands, `doom_loop`).
// Upstream does the same on the client side: the TUI and the app
// answer `once` to every `permission.asked` of the session and its descendants and retry twice
// (`packages/app/src/session/requests/auto-approve.ts@843a6c51`, read, not run).

import type { WorkMode } from '../shared/model';
import { commandNeedsAsk } from './destructiveCommand';
import { isSecretPath } from './secretPaths';

/**
 * Pause before each retry of a failed auto-approve: one second, then two. Taken from upstream's
 * auto-approve (`auto-approve.ts@843a6c51`, read, not run); a third failure shows the card.
 */
export const AUTO_RETRY_DELAYS_MS: readonly number[] = [1000, 2000];

/**
 * Most request ids remembered as answered or failed. Taken from the 1000 ids upstream's auto-approve
 * remembers; older ones are forgotten first (a request answered long ago is gone from the server).
 */
export const MAX_ANSWERED_IDS = 1000;

/** The part of a permission request the policy reads. */
export interface AutoAsk {
  id: string;
  action: string;
  resources: readonly string[];
  /** The request's `metadata` as the wire sends it; only `edit` reads it (`files[].status`). */
  metadata?: { [key: string]: unknown };
}

/**
 * True when an `edit` request may delete or move a file, or has a shape this code does not know, so
 * it must ask (decision `secretos-y-borrados` (2): fail closed). The shapes read in
 * `tool/plugin/{edit,write,patch}.ts` of `anomalyco/opencode@843a6c51` (read, not run against a real
 * server): `edit` sends no metadata or `{ files: [preview] }`, `write` sends `{ files: [preview] }`
 * and `patch` sends `{ filepath, diff, files }` with one `FileDiffInfo` per changed file, whose
 * `status` is `added`, `deleted` or `modified` (`patchFile`, L321-333). Approved only when `files` is
 * absent in a request with no `diff`, or is an array of objects that are all `added` or `modified`
 * and no fewer than the resources: a patch with `*** Move to:` has TWO resources for ONE entry (the
 * original, which it deletes, and the target) and a status of `modified` (L196-205 and L225-235).
 * Anything else (a `deleted`, another status, a `files` that is not an array, a `diff` with no
 * `files`) asks.
 */
function editNeedsAsk(ask: Pick<AutoAsk, 'resources' | 'metadata'>): boolean {
  const metadata = ask.metadata;
  if (metadata === undefined) return false;
  const files = metadata.files;
  if (files === undefined) return metadata.diff !== undefined;
  if (!Array.isArray(files) || files.length < ask.resources.length) return true;
  return files.some((file: unknown) => {
    if (typeof file !== 'object' || file === null) return true;
    const status = (file as { status?: unknown }).status;
    return status !== 'added' && status !== 'modified';
  });
}

/**
 * True when Auto must NOT answer `ask` and a person has to. Decisions of Sergio, 07/11/2026 (Engram
 * `e3-work-mode/decisions/{seis-preguntas,nunca-destructivo,secretos-y-borrados}` and the later
 * ones on the shell blacklist): Auto does not approve on the user's behalf what it recognises as
 * - reading a secret: a `read` with any resource that {@link isSecretPath} names (the env files of
 *   opencode's default rule plus keys and credentials), and a `shell` command with such an argument;
 * - going outside the project: `external_directory`;
 * - a destructive or unclassifiable shell command ({@link commandNeedsAsk}; each resource is one
 *   command), and an `edit` that deletes, moves or has an unknown shape ({@link editNeedsAsk});
 * - `doom_loop`.
 * The shell test is a HEURISTIC and what opencode's own configuration allows without asking never
 * reaches Auto at all (see `destructiveCommand.ts`). `doom_loop` is HYPOTHESIS: in 2.0.32 nobody
 * was found to emit it (search of the tag, 07/11/2026); if it never arrives the clause is inert.
 * That a `shell` request carries its commands in `resources` is read in `tool/plugin/shell.ts`
 * L138-146 (tag 843a6c51), and that `external_directory` is the action name for access outside the
 * project in `file-access.ts` L130-160; neither was seen on a real server.
 * VERIFIED by `workMode.test.ts` "keeps secrets, external_directory and doom_loop for the user",
 * "approves what is none of those", "keeps destructive shell commands and shell secrets for the
 * user, any resource of the request" and "keeps an edit that deletes, moves or has an unknown shape
 * and approves one that creates or modifies" (fabricated asks: they pin the criterion, not what the
 * server emits).
 */
export function keepsForUser(ask: Pick<AutoAsk, 'action' | 'resources' | 'metadata'>): boolean {
  if (ask.action === 'doom_loop' || ask.action === 'external_directory') return true;
  if (ask.action === 'read') return ask.resources.some(isSecretPath);
  if (ask.action === 'shell') return ask.resources.some(commandNeedsAsk);
  if (ask.action === 'edit') return editNeedsAsk(ask);
  return false;
}

/** The state returned by {@link createWorkModes}. */
export interface WorkModes {
  /**
   * The effective mode for a session whose chain (the session first, then its ancestors up to the
   * root) is `chain`: the first entry that has a mode of its own wins, so a subagent follows its root
   * unless it was set itself. `undefined` (the chain does not reach a known root yet) and a chain
   * with no mode are `manual`: the safe answer while the lineage is incomplete.
   */
  modeFor(chain: readonly string[] | undefined): WorkMode;
  /** Gives `sessionID` its own mode. */
  setSession(sessionID: string, mode: WorkMode): void;
  /** Forgets the mode of a deleted session. */
  forgetSession(sessionID: string): void;
  /** The mode the pane that shows no session yet would give its first session (`manual` if none). */
  draftOf(paneId: number): WorkMode;
  /** Sets the draft of a pane with no session. */
  setDraft(paneId: number, mode: WorkMode): void;
  /**
   * Returns and clears the draft of `paneId`, or `undefined` when it has none: called when the
   * pane's first prompt creates its session, which then inherits it.
   */
  takeDraft(paneId: number): WorkMode | undefined;
  /** Forgets the draft of a pane that went away. */
  forgetPane(paneId: number): void;
  /**
   * True when the host must answer `ask` itself: the mode for `chain` is `auto` and
   * {@link keepsForUser} is false. A request of a session with an incomplete chain is never auto.
   */
  shouldAutoApprove(ask: AutoAsk, chain: readonly string[] | undefined): boolean;
  /**
   * Takes the request `id` for an auto-approve. `false` when one is already in flight or already
   * answered (so a duplicate event, a resync and a sweep cannot answer twice); `true` otherwise,
   * including a request that failed before (an explicit new attempt).
   */
  claim(id: string): boolean;
  /** Marks `id` as failed after the retries: it is shown as a normal card and not auto-approved again. */
  fail(id: string): void;
  /** True when {@link WorkModes.fail} was called for `id` and no later claim reset it. */
  isFailed(id: string): boolean;
  /** Gives `id` back so it can be claimed again (the attempt did not happen). */
  release(id: string): void;
}

/**
 * Creates an empty state. The claimed ids are bounded by {@link MAX_ANSWERED_IDS} (oldest first).
 * Sessions and drafts are small and are removed with their session or pane.
 * VERIFIED by `workMode.test.ts` with fabricated chains and ids (logic only).
 */
export function createWorkModes(): WorkModes {
  const sessions = new Map<string, WorkMode>();
  const drafts = new Map<number, WorkMode>();
  /** Insertion order is age order. `inflight` also stands for "answered". */
  const claimed = new Map<string, 'inflight' | 'failed'>();

  const modeFor = (chain: readonly string[] | undefined): WorkMode => {
    if (chain === undefined) return 'manual';
    for (const id of chain) {
      const own = sessions.get(id);
      if (own !== undefined) return own;
    }
    return 'manual';
  };

  return {
    modeFor,
    setSession: (sessionID, mode) => void sessions.set(sessionID, mode),
    forgetSession: (sessionID) => void sessions.delete(sessionID),
    draftOf: (paneId) => drafts.get(paneId) ?? 'manual',
    setDraft: (paneId, mode) => void drafts.set(paneId, mode),
    takeDraft(paneId) {
      const draft = drafts.get(paneId);
      drafts.delete(paneId);
      return draft;
    },
    forgetPane: (paneId) => void drafts.delete(paneId),
    shouldAutoApprove: (ask, chain) => modeFor(chain) === 'auto' && !keepsForUser(ask),
    claim(id) {
      const state = claimed.get(id);
      if (state === 'inflight') return false;
      claimed.delete(id);
      claimed.set(id, 'inflight');
      while (claimed.size > MAX_ANSWERED_IDS) {
        const oldest = claimed.keys().next();
        if (oldest.done === true) break;
        claimed.delete(oldest.value);
      }
      return true;
    },
    fail: (id) => void claimed.set(id, 'failed'),
    isFailed: (id) => claimed.get(id) === 'failed',
    release: (id) => void claimed.delete(id),
  };
}
