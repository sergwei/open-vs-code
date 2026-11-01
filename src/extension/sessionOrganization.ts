// How the user organizes the root sessions of the served folder in the native Sessions tree (plan
// E9-sessions-organize): folders with subfolders, pinned and archived sessions. Pure: no `vscode`, no
// I/O. The VS Code glue keeps one {@link SessionOrganization} per served folder in `workspaceState`
// (decision Q1=1), hands it to the tree model (`sessionTree.ts`) and replaces it with the value an
// operation here returns.
//
// Every operation is immutable: it returns a NEW organization and never touches the one it got, so
// the glue can compare, queue and persist snapshots without aliasing. An operation that cannot be
// applied returns `{ ok: false, reason }` instead of throwing: the callers are command handlers
// that turn the reason into an input-box error.
//
// Why this lives outside the server (Q1=1): `session.update({ metadata })` of opencode 2.0.32
// replaces the whole metadata object and raises `time_updated` (the session would jump to "Today"),
// and the folder names would need another home anyway. The price, accepted in Q2=a: the data hangs
// from the `workspaceStorage` of VS Code and is lost if the project folder moves.

/** The identifier of a folder; chosen by the glue (`crypto.randomUUID`), opaque here. */
export type FolderID = string;

/** One folder; `parent` is absent for a top-level folder. */
export interface OrganizationFolder {
  name: string;
  parent?: FolderID;
}

/**
 * The organization of one served folder. `placement` maps a session id to the folder that holds it
 * (absent = "No Folder"); `pinned` and `archived` map a session id to the epoch milliseconds at
 * which the user did it. Only ROOT sessions are organized (the tree has no rows for children).
 */
export interface SessionOrganization {
  version: 1;
  folders: Record<FolderID, OrganizationFolder>;
  placement: Record<string, FolderID>;
  pinned: Record<string, number>;
  archived: Record<string, number>;
}

/** Why an operation could not be applied. */
export type OrganizationProblem = 'length' | 'duplicate' | 'missingFolder' | 'cycle';

/** The outcome of an operation: the new organization, or the reason it was refused. */
export type OrganizationResult =
  { ok: true; org: SessionOrganization } | { ok: false; reason: OrganizationProblem };

/**
 * Longest folder name, in code points. Own choice (plan E9-sessions-organize §6): it fits the
 * sidebar without the name losing its end to an ellipsis in the common case; nobody measured it.
 */
export const MAX_FOLDER_NAME_LENGTH = 80;

/** Whether `record` has `key` as its OWN property: a session id such as `constructor` is just a key. */
function has(record: object, key: string): boolean {
  return Object.hasOwn(record, key);
}

/** Looks up an own property of a map, else `undefined` (never the prototype's). */
function lookup<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return has(record, key) ? record[key] : undefined;
}

/** A plain-object type guard for the validation of data read from disk. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An organization with nothing in it. */
export function emptyOrganization(): SessionOrganization {
  return { version: 1, folders: {}, placement: {}, pinned: {}, archived: {} };
}

/** A copy of `org` that shares nothing with it, ready to be mutated by the operation that made it. */
function copy(org: SessionOrganization): SessionOrganization {
  return {
    version: 1,
    folders: Object.fromEntries(
      Object.entries(org.folders).map(([id, folder]) => [id, { ...folder }]),
    ),
    placement: { ...org.placement },
    pinned: { ...org.pinned },
    archived: { ...org.archived },
  };
}

/** The name as it will be stored: trimmed, 1..{@link MAX_FOLDER_NAME_LENGTH} code points, else `undefined`. */
export function normalizeFolderName(name: string): string | undefined {
  const trimmed = name.trim();
  const length = Array.from(trimmed).length;
  return length >= 1 && length <= MAX_FOLDER_NAME_LENGTH ? trimmed : undefined;
}

/** Whether `org` knows the folder. */
export function hasFolder(org: SessionOrganization, id: FolderID): boolean {
  return has(org.folders, id);
}

/** The folders directly inside `parent` (`undefined` = top level), in insertion order. */
export function childFolders(org: SessionOrganization, parent: FolderID | undefined): FolderID[] {
  return Object.entries(org.folders)
    .filter(([, folder]) => folder.parent === parent)
    .map(([id]) => id);
}

/** Every folder under `id`, at any depth, `id` excluded. Safe on a corrupt loop. */
export function descendantFolders(org: SessionOrganization, id: FolderID): FolderID[] {
  const found: FolderID[] = [];
  const seen = new Set<FolderID>([id]);
  const queue: FolderID[] = [id];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const child of childFolders(org, current)) {
      if (seen.has(child)) continue;
      seen.add(child);
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

/** The folder that holds `sessionID`, if it is placed in a folder that still exists. */
export function folderOf(org: SessionOrganization, sessionID: string): FolderID | undefined {
  const folder = lookup(org.placement, sessionID);
  return folder !== undefined && hasFolder(org, folder) ? folder : undefined;
}

/** Whether the user pinned the session and has not archived it (archiving drops the pin). */
export function isPinned(org: SessionOrganization, sessionID: string): boolean {
  return has(org.pinned, sessionID) && !has(org.archived, sessionID);
}

/** Whether the user archived the session. */
export function isArchived(org: SessionOrganization, sessionID: string): boolean {
  return has(org.archived, sessionID);
}

/** The names from the top-level folder down to `id`, e.g. `['Spikes', 'SSE']`; empty if unknown. */
export function folderPath(org: SessionOrganization, id: FolderID): string[] {
  const names: string[] = [];
  const seen = new Set<FolderID>();
  let current: FolderID | undefined = id;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const folder: OrganizationFolder | undefined = lookup(org.folders, current);
    if (folder === undefined) return [];
    names.unshift(folder.name);
    current = folder.parent;
  }
  return names;
}

/** The ids of every session the organization mentions (placed, pinned or archived). */
export function organizedSessionIDs(org: SessionOrganization): string[] {
  return [
    ...new Set([
      ...Object.keys(org.placement),
      ...Object.keys(org.pinned),
      ...Object.keys(org.archived),
    ]),
  ];
}

/** What a folder holds, at any depth: the sessions placed in it and the folders under it. */
export function folderContents(
  org: SessionOrganization,
  id: FolderID,
): { sessions: string[]; subfolders: FolderID[] } {
  const subfolders = descendantFolders(org, id);
  const inside = new Set<FolderID>([id, ...subfolders]);
  const sessions = Object.entries(org.placement)
    .filter(([, folder]) => inside.has(folder))
    .map(([sessionID]) => sessionID);
  return { sessions, subfolders };
}

/**
 * Why `name` cannot be used for a folder inside `parent`, if it cannot: the wrong length, or a
 * sibling that already has it (case-insensitive; `except` is the folder being renamed or moved).
 * The same name in another parent is fine.
 */
export function folderNameProblem(
  org: SessionOrganization,
  name: string,
  parent: FolderID | undefined,
  except?: FolderID,
): 'length' | 'duplicate' | undefined {
  const normalized = normalizeFolderName(name);
  if (normalized === undefined) return 'length';
  const wanted = normalized.toLowerCase();
  const clash = childFolders(org, parent).some(
    (id) => id !== except && lookup(org.folders, id)?.name.toLowerCase() === wanted,
  );
  return clash ? 'duplicate' : undefined;
}

/**
 * Adds a folder `id` named `name` inside `parent` (top level when absent). Refused with `length`,
 * `duplicate` (also when `id` is already taken) or `missingFolder` (the parent does not exist).
 */
export function createFolder(
  org: SessionOrganization,
  id: FolderID,
  name: string,
  parent?: FolderID,
): OrganizationResult {
  if (parent !== undefined && !hasFolder(org, parent))
    return { ok: false, reason: 'missingFolder' };
  if (hasFolder(org, id)) return { ok: false, reason: 'duplicate' };
  const problem = folderNameProblem(org, name, parent);
  const normalized = normalizeFolderName(name);
  if (problem !== undefined || normalized === undefined) {
    return { ok: false, reason: problem ?? 'length' };
  }
  const next = copy(org);
  next.folders[id] = parent === undefined ? { name: normalized } : { name: normalized, parent };
  return { ok: true, org: next };
}

/** Renames a folder; refused with `missingFolder`, `length` or `duplicate` (among its siblings). */
export function renameFolder(
  org: SessionOrganization,
  id: FolderID,
  name: string,
): OrganizationResult {
  const folder = lookup(org.folders, id);
  if (folder === undefined) return { ok: false, reason: 'missingFolder' };
  const problem = folderNameProblem(org, name, folder.parent, id);
  const normalized = normalizeFolderName(name);
  if (problem !== undefined || normalized === undefined) {
    return { ok: false, reason: problem ?? 'length' };
  }
  const next = copy(org);
  next.folders[id] = { ...folder, name: normalized };
  return { ok: true, org: next };
}

/**
 * Deletes a folder and every folder under it (decision Q3b=1); the sessions they held go back to
 * "No Folder" and none is deleted anywhere. Pins and archives are kept. Refused with
 * `missingFolder`. The result lists what was released so the glue can say it.
 */
export function deleteFolder(
  org: SessionOrganization,
  id: FolderID,
):
  | { ok: true; org: SessionOrganization; releasedSessions: string[]; removedFolders: FolderID[] }
  | { ok: false; reason: 'missingFolder' } {
  if (!hasFolder(org, id)) return { ok: false, reason: 'missingFolder' };
  const { sessions, subfolders } = folderContents(org, id);
  const doomed = new Set<FolderID>([id, ...subfolders]);
  const next = copy(org);
  next.folders = Object.fromEntries(
    Object.entries(next.folders).filter(([key]) => !doomed.has(key)),
  );
  next.placement = Object.fromEntries(
    Object.entries(next.placement).filter(([, folder]) => !doomed.has(folder)),
  );
  return { ok: true, org: next, releasedSessions: sessions, removedFolders: [id, ...subfolders] };
}

/**
 * Moves sessions into `folder`, or out of every folder when `folder` is `undefined`. Refused with
 * `missingFolder` when the target does not exist. Moving never changes pins or archives.
 */
export function moveSessions(
  org: SessionOrganization,
  sessionIDs: readonly string[],
  folder: FolderID | undefined,
): OrganizationResult {
  if (folder !== undefined && !hasFolder(org, folder))
    return { ok: false, reason: 'missingFolder' };
  const next = copy(org);
  const moved = new Set(sessionIDs);
  next.placement = Object.fromEntries(
    Object.entries(next.placement).filter(([sessionID]) => !moved.has(sessionID)),
  );
  if (folder !== undefined) for (const sessionID of moved) next.placement[sessionID] = folder;
  return { ok: true, org: next };
}

/**
 * Moves a folder (with everything in it) under `parent`, or to the top level when `undefined`.
 * Refused with `missingFolder`, `cycle` (into itself or one of its descendants) or `duplicate`
 * (a sibling at the destination has its name).
 */
export function moveFolder(
  org: SessionOrganization,
  id: FolderID,
  parent: FolderID | undefined,
): OrganizationResult {
  const folder = lookup(org.folders, id);
  if (folder === undefined || (parent !== undefined && !hasFolder(org, parent))) {
    return { ok: false, reason: 'missingFolder' };
  }
  if (parent !== undefined && (parent === id || descendantFolders(org, id).includes(parent))) {
    return { ok: false, reason: 'cycle' };
  }
  if (folderNameProblem(org, folder.name, parent, id) === 'duplicate') {
    return { ok: false, reason: 'duplicate' };
  }
  const next = copy(org);
  next.folders[id] = parent === undefined ? { name: folder.name } : { name: folder.name, parent };
  return { ok: true, org: next };
}

/** Pins sessions at `now`; one that is archived or already pinned is left as it is. */
export function pinSessions(
  org: SessionOrganization,
  sessionIDs: readonly string[],
  now: number,
): SessionOrganization {
  const next = copy(org);
  for (const sessionID of sessionIDs) {
    if (!has(next.archived, sessionID) && !has(next.pinned, sessionID))
      next.pinned[sessionID] = now;
  }
  return next;
}

/** Removes the pin of the sessions. */
export function unpinSessions(
  org: SessionOrganization,
  sessionIDs: readonly string[],
): SessionOrganization {
  const next = copy(org);
  const drop = new Set(sessionIDs);
  next.pinned = Object.fromEntries(Object.entries(next.pinned).filter(([id]) => !drop.has(id)));
  return next;
}

/**
 * Archives sessions at `now` (an already archived one keeps its date). Archiving drops the pin and
 * KEEPS the folder, so unarchiving puts the session back where it was (decision Q6=1).
 */
export function archiveSessions(
  org: SessionOrganization,
  sessionIDs: readonly string[],
  now: number,
): SessionOrganization {
  const next = unpinSessions(org, sessionIDs);
  for (const sessionID of sessionIDs) {
    if (!has(next.archived, sessionID)) next.archived[sessionID] = now;
  }
  return next;
}

/** Brings sessions back from the archive; their folder was never dropped. The pin does not return. */
export function unarchiveSessions(
  org: SessionOrganization,
  sessionIDs: readonly string[],
): SessionOrganization {
  const next = copy(org);
  const drop = new Set(sessionIDs);
  next.archived = Object.fromEntries(Object.entries(next.archived).filter(([id]) => !drop.has(id)));
  return next;
}

/**
 * Forgets sessions that no longer exist on the server (deleted here or by another client): their
 * placement, pin and archive entry. Nothing is deleted anywhere else. Returns the same object when
 * there was nothing to forget, so the glue can skip the write.
 */
export function pruneSessions(
  org: SessionOrganization,
  sessionIDs: Iterable<string>,
): SessionOrganization {
  const gone = new Set(sessionIDs);
  const known = new Set(organizedSessionIDs(org));
  if (![...gone].some((id) => known.has(id))) return org;
  const keep = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([id]) => !gone.has(id)));
  return {
    version: 1,
    folders: copy(org).folders,
    placement: keep(org.placement),
    pinned: keep(org.pinned),
    archived: keep(org.archived),
  };
}

/** What a drag of the Sessions tree carries: the ids of the sessions and of the folders dragged. */
export interface SessionDrag {
  sessions: string[];
  folders: string[];
}

/**
 * Where a drop lands, already reduced from the node under the pointer: `none` = "No Folder" (the
 * empty space, a date group, "Show more"), `folder` = inside that folder (also a session that sits
 * in a folder), `pinned` and `archived` = those sections (also a session that sits in them).
 */
export type SessionDropTarget =
  | { kind: 'none' }
  | { kind: 'folder'; folderID: FolderID }
  | { kind: 'pinned' }
  | { kind: 'archived' };

/**
 * Applies a drop of the Sessions tree to `org`: the sessions are placed in the folder (or out of
 * every folder), pinned or archived according to where they landed, and the folders are moved under
 * the target folder or to the top level. Folders can only land on a folder or on "No Folder"; on
 * "Pinned" or "Archived" they are left alone. Returns the new organization and the reasons any
 * folder move was refused (`cycle` for a folder dropped on itself or a descendant, `duplicate`
 * for a name already taken at the destination); the sessions of the same drop are still applied.
 * A pin on an archived session is ignored, as {@link pinSessions} says; no drop unarchives.
 * VERIFIED (Vitest, Windows 11, 01/11/2026) by the case of `sessionOrganization.test.ts`
 * "applies a drop: sessions by target, folders under the target, cycles refused", with fabricated
 * organizations: it proves the rules, not the gesture (`test:visual` step 34).
 */
export function applyDrop(
  org: SessionOrganization,
  drag: SessionDrag,
  target: SessionDropTarget,
  now: number,
): { org: SessionOrganization; refused: OrganizationProblem[] } {
  let next = org;
  const refused: OrganizationProblem[] = [];
  const step = (result: OrganizationResult): void => {
    if (result.ok) next = result.org;
    else refused.push(result.reason);
  };
  if (drag.sessions.length > 0) {
    switch (target.kind) {
      case 'none':
        step(moveSessions(next, drag.sessions, undefined));
        break;
      case 'folder':
        step(moveSessions(next, drag.sessions, target.folderID));
        break;
      case 'pinned':
        next = pinSessions(next, drag.sessions, now);
        break;
      case 'archived':
        next = archiveSessions(next, drag.sessions, now);
        break;
    }
  }
  if (target.kind === 'none' || target.kind === 'folder') {
    const parent = target.kind === 'folder' ? target.folderID : undefined;
    for (const folderID of drag.folders) step(moveFolder(next, folderID, parent));
  }
  return { org: next, refused };
}

/** What {@link validateOrganization} read: the usable part and how much was thrown away. */
export interface ValidatedOrganization {
  org: SessionOrganization;
  /** Entries dropped because they were malformed or pointed at something that does not exist. */
  discarded: number;
  /** Set when the whole value was unusable (`notObject`, or a `version` this code does not know). */
  problem?: 'notObject' | 'version';
}

/**
 * Turns whatever `workspaceState` returned into a usable organization; never throws. A value that
 * is not an object, or whose `version` is not 1, gives an empty organization and a `problem` for
 * the log. Inside a valid one: a folder with a bad name or whose parent chain does not reach the
 * top (missing parent, loop) is dropped together with the folders under it, a placement into a
 * folder that did not survive is dropped, and a pin or archive date that is not a finite number is
 * dropped; `discarded` counts them. Duplicate sibling names are NOT enforced on load, so that a
 * hand-edited file loses nothing for a cosmetic reason.
 * UNVERIFIED against a real `workspaceState` file written by an older build: there is none yet;
 * the cases of `sessionOrganization.test.ts` are fabricated.
 */
export function validateOrganization(raw: unknown): ValidatedOrganization {
  if (!isRecord(raw)) return { org: emptyOrganization(), discarded: 0, problem: 'notObject' };
  if (raw['version'] !== 1) return { org: emptyOrganization(), discarded: 0, problem: 'version' };
  let discarded = 0;

  const rawFolders = isRecord(raw['folders']) ? raw['folders'] : {};
  const entries = new Map<FolderID, OrganizationFolder>();
  for (const [id, value] of Object.entries(rawFolders)) {
    const name = isRecord(value) && typeof value['name'] === 'string' ? value['name'] : undefined;
    const normalized = name === undefined ? undefined : normalizeFolderName(name);
    const parent =
      isRecord(value) && typeof value['parent'] === 'string' ? value['parent'] : undefined;
    if (
      normalized === undefined ||
      (isRecord(value) && value['parent'] !== undefined && parent === undefined)
    ) {
      discarded += 1;
      continue;
    }
    entries.set(id, parent === undefined ? { name: normalized } : { name: normalized, parent });
  }
  const reaches = (start: FolderID): boolean => {
    const seen = new Set<FolderID>();
    let current: FolderID | undefined = start;
    while (current !== undefined) {
      if (seen.has(current)) return false;
      seen.add(current);
      const folder: OrganizationFolder | undefined = entries.get(current);
      if (folder === undefined) return false;
      current = folder.parent;
    }
    return true;
  };
  const folders: Record<FolderID, OrganizationFolder> = {};
  for (const [id, folder] of entries) {
    if (reaches(id)) folders[id] = folder;
    else discarded += 1;
  }

  const placement: Record<string, FolderID> = {};
  if (isRecord(raw['placement'])) {
    for (const [sessionID, folder] of Object.entries(raw['placement'])) {
      if (typeof folder === 'string' && has(folders, folder)) placement[sessionID] = folder;
      else discarded += 1;
    }
  }
  const dates = (value: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (!isRecord(value)) return out;
    for (const [sessionID, when] of Object.entries(value)) {
      if (typeof when === 'number' && Number.isFinite(when)) out[sessionID] = when;
      else discarded += 1;
    }
    return out;
  };
  const pinned = dates(raw['pinned']);
  const archived = dates(raw['archived']);
  return { org: { version: 1, folders, placement, pinned, archived }, discarded };
}
