// The VS Code side of organizing sessions (plan E9-sessions-organize): the eleven commands of the
// Sessions tree (folders, move, pin, archive, filters), the drop of a drag, and the glue between the
// pure organization (`sessionOrganization.ts`), its storage (`organizationStore.ts`), the tree model
// (`sessionTree.ts`) and the view (`sessionsView.ts`). It lives apart from `chatLifecycle.ts`
// (already 1.3k lines) and is only wired there.
//
// The organization belongs to the folder the server serves. `use` loads it when the first page of a
// folder arrives; every change goes to memory first (the tree repaints at once) and then to
// `workspaceState` through the serial queue of the store. The commands do nothing outside the
// `editor` mode (the Sessions tree is not shown in `sidebar`, and no command may act there).

import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { SessionSummary } from '../shared/model';
import { sessionLabel } from '../shared/sessionLabel';
import {
  ARCHIVE_SESSION_COMMAND_ID,
  CLEAR_FILTERS_COMMAND_ID,
  DELETE_FOLDER_COMMAND_ID,
  FILTER_SESSIONS_COMMAND_ID,
  MOVE_TO_FOLDER_COMMAND_ID,
  NEW_FOLDER_COMMAND_ID,
  NEW_SUBFOLDER_COMMAND_ID,
  PIN_SESSION_COMMAND_ID,
  RENAME_FOLDER_COMMAND_ID,
  SESSION_ORGANIZATION_KEY,
  UNARCHIVE_SESSION_COMMAND_ID,
  UNPIN_SESSION_COMMAND_ID,
} from './ids';
import type { ServerLog } from './opencodeServer';
import { createOrganizationStore, type MementoLike } from './organizationStore';
import {
  applyDrop,
  archiveSessions,
  createFolder,
  deleteFolder,
  folderContents,
  folderNameProblem,
  folderOf,
  folderPath,
  hasFolder,
  isArchived,
  MAX_FOLDER_NAME_LENGTH,
  moveSessions,
  pinSessions,
  pruneSessions,
  renameFolder,
  unarchiveSessions,
  unpinSessions,
  type FolderID,
  type OrganizationProblem,
  type OrganizationResult,
  type SessionDrag,
  type SessionDropTarget,
  type SessionOrganization,
} from './sessionOrganization';
import type { SessionTree, SessionTreeFilters, SessionTreePage } from './sessionTree';
import {
  askFolderName,
  confirmFolderDelete,
  pickFilters,
  pickFolder,
  type FolderChoice,
} from './sessionUi';
import type { SessionsView } from './sessionsView';

/**
 * Answers the NEXT dialogs of these commands without showing them (the integration tests cannot
 * operate a QuickPick, an input box or a modal). Filled only by the Test-mode command of
 * `chatLifecycle.ts`; each key is read once and then deleted. `null` cancels the dialog.
 */
export interface OrganizeAnswers {
  folderName?: string | null;
  /** `'none'`, `'new'`, or the path of the folder to pick (`['Spikes', 'SSE']`). */
  pickFolder?: null | 'none' | 'new' | string[];
  confirmFolderDelete?: boolean;
  /** Which filters to turn on: any of `running`, `needsInput`, `tab`; `null` cancels the picker. */
  filters?: string[] | null;
}

/** What {@link registerSessionsOrganize} needs from the wiring. */
export interface SessionsOrganizeOptions {
  /** `context.workspaceState` (anything shaped like a Memento). */
  memento: MementoLike;
  tree: SessionTree;
  view: Pick<SessionsView, 'refresh' | 'selectedSessions' | 'selectedFolders'>;
  log: ServerLog;
  /** Whether the Sessions tree is in use (`chatLocation` = `editor`); read on every call. */
  editorMode(): boolean;
  /**
   * Reads organized sessions the first page did not bring (`ChatController.readSessions`):
   * `found` are root rows to adopt, `missing` the ids the server says do not exist.
   */
  readSessions(ids: readonly string[]): Promise<{ found: SessionSummary[]; missing: string[] }>;
  /** Pre-set dialog answers, shared with the Test-mode command; empty outside tests. */
  answers: OrganizeAnswers;
}

/** The handle returned by {@link registerSessionsOrganize}. */
export interface SessionsOrganize {
  /** The registered commands; dispose with the rest. */
  disposable: vscode.Disposable;
  /**
   * Loads the organization of the folder the server serves and gives it to the tree. Returns
   * whether the tree's projection changed; the caller repaints. Calling it again for the folder
   * already in use does nothing.
   */
  use(folder: string): boolean;
  /**
   * After a full read of the first page: forgets organized sessions that are gone (the ones the
   * page lacks AND the tree does not hold, if the page was the whole list, since a session that
   * came by an event after the page is alive; otherwise only the ones the server answers 404 for) and adopts
   * the organized ones the page did not bring. Fire and forget; never throws. Does nothing in
   * `sidebar` mode.
   */
  reconcile(page: Pick<SessionTreePage, 'rows' | 'hasMore'>): void;
  /** Forgets sessions that were deleted (here or by another client). Returns whether anything changed. */
  forget(sessionIDs: readonly string[]): boolean;
  /** Applies the drop of a drag; see {@link applyDrop} for the rules. */
  drop(drag: SessionDrag, target: SessionDropTarget): void;
  /** `Archived` or the folder path of a session the user organized, else `undefined` (for the search). */
  placeOf(sessionID: string): string | undefined;
  /** Waits for the writes and returns what the memento holds for the folder in use (Test command). */
  stored(): Promise<{ folder: string | undefined; stored: unknown }>;
}

/** The id of a session out of a tree argument: a node (`kind: 'session'`) or a bare id string. */
export function sessionIDOf(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { kind, sessionID } = raw as Record<string, unknown>;
  return kind === 'session' && typeof sessionID === 'string' && sessionID.length > 0
    ? sessionID
    : undefined;
}

/** The id of a folder out of a tree argument: a node (`kind: 'folder'`) or a bare id string. */
function folderIDOf(raw: unknown): FolderID | undefined {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { kind, folderID } = raw as Record<string, unknown>;
  return kind === 'folder' && typeof folderID === 'string' && folderID.length > 0
    ? folderID
    : undefined;
}

/** The text of the input-box error or of the warning for an operation that was refused. */
function problemText(problem: OrganizationProblem): string {
  switch (problem) {
    case 'length':
      return `A folder name needs 1 to ${String(MAX_FOLDER_NAME_LENGTH)} characters`;
    case 'duplicate':
      return 'A folder with this name already exists here';
    case 'missingFolder':
      return 'That folder no longer exists';
    case 'cycle':
      return 'A folder cannot go inside itself or one of its subfolders';
  }
}

/**
 * Registers the organizing commands and returns the handle the wiring calls from the controller's
 * sink. Commands, all `editor`-mode only and silent otherwise: New Folder… / New Subfolder… /
 * Rename Folder… / Delete Folder / Move to Folder… / Pin / Unpin / Archive / Unarchive / Filter
 * Sessions… / Clear Filters. The ones that need a served folder do nothing before the first page.
 *
 * A session command acts on the row that was clicked AND, if that row is part of the selection
 * (`canSelectMany`), on the whole selection: VS Code passes `(clicked, selected)`; from the palette
 * or with a bare id it acts on the selection or on that id. Rename and Delete Session are NOT
 * these: they keep acting on the clicked row only (risk R5, `chatLifecycle.ts`). The folder
 * commands take the clicked folder, else the one folder selected. Moving an archived session only
 * changes its folder (it stays in "Archived" until unarchived). A refused operation (name taken,
 * folder gone) is a native warning. Logs the stable line `sessions organization: F folders, P
 * pinned, A archived, M placed` whenever the counts change (also after loading and after
 * forgetting deleted sessions).
 * VERIFIED by `test:visual` step 34 (E9-sessions-organize; Windows 11, VS Code 1.144.0, 1/11/2026,
 * synthetic server, real clicks and a real drag, 0 FAIL): "V4 the context menu of a folder lists
 * New Subfolder…, Rename Folder… and Delete Folder in that order", "V3 the context menu of a pinned
 * session offers Unpin and not Pin, so VS Code evaluates the look-ahead of the when clause", "B4 Pin
 * puts Org34B under Pinned", "B5 Archive takes Org34A out of its folder into Archived" and "B6 Delete
 * Folder asks in the modal". The integration cases drive the commands with
 * `TEST_SESSION_ANSWERS_COMMAND_ID`. NOT observed: Pin or Archive on several selected rows with the
 * mouse, macOS and Linux.
 */
export function registerSessionsOrganize(options: SessionsOrganizeOptions): SessionsOrganize {
  const { tree, view, log, answers } = options;
  const store = createOrganizationStore({
    memento: options.memento,
    key: SESSION_ORGANIZATION_KEY,
    log: { warn: (message) => log.warn(message) },
  });
  let lastLine = '';
  let reconcileTicket = 0;

  /** Says what the user holds, once per distinct set of counts. */
  const announce = (org: SessionOrganization): void => {
    const line = `sessions organization: ${String(Object.keys(org.folders).length)} folders, ${String(Object.keys(org.pinned).length)} pinned, ${String(Object.keys(org.archived).length)} archived, ${String(Object.keys(org.placement).length)} placed`;
    if (line === lastLine) return;
    lastLine = line;
    log.info(line);
  };

  /** Makes `next` the organization: memory, queue, tree, repaint, log. */
  const apply = (next: SessionOrganization): boolean => {
    if (!store.set(next)) return false;
    tree.setOrganization(next);
    view.refresh();
    announce(next);
    return true;
  };

  /**
   * Like {@link apply}, but does nothing when `next` equals what is held. Pin, Unpin, Archive and
   * Unarchive build a fresh copy every time, so without this a Pin on a pinned session would still
   * write `workspaceState`. Equality is the JSON of the two, which is exact for this plain data.
   * UNVERIFIED: no test presses Pin twice and counts the writes.
   */
  const applyIfChanged = (next: SessionOrganization): boolean =>
    JSON.stringify(next) !== JSON.stringify(store.current()) && apply(next);

  /** Applies a result that may have been refused; a refusal is a native warning. */
  const applyResult = (result: OrganizationResult): boolean => {
    if (result.ok) return apply(result.org);
    void vscode.window.showWarningMessage(`OpenCode: ${problemText(result.reason)}`);
    return false;
  };

  /** One-shot test answer for `key`, if the Test command set one. */
  const takeAnswer = <K extends keyof OrganizeAnswers>(
    key: K,
  ): { value: OrganizeAnswers[K] } | undefined => {
    if (!Object.hasOwn(answers, key)) return undefined;
    const value = answers[key];
    delete answers[key];
    return { value };
  };

  /** The sessions a command acts on, from VS Code's `(clicked, selected)` arguments. */
  const targetSessions = (clicked: unknown, selected: unknown): string[] => {
    const own = sessionIDOf(clicked);
    const picked = view.selectedSessions().map((node) => node.sessionID);
    if (own === undefined) return [...new Set(picked)];
    const chosen = Array.isArray(selected)
      ? (selected as unknown[]).flatMap((item) => sessionIDOf(item) ?? [])
      : picked;
    return chosen.includes(own) ? [...new Set(chosen)] : [own];
  };

  /** The folder a command acts on: the clicked one, else the single selected one, if it exists. */
  const targetFolder = (clicked: unknown): FolderID | undefined => {
    const own = folderIDOf(clicked) ?? view.selectedFolders()[0]?.folderID;
    return own !== undefined && hasFolder(store.current(), own) ? own : undefined;
  };

  /** Asks for a folder name (or takes the test answer); `undefined` = cancelled. */
  const askName = async (
    prompt: string,
    value: string,
    parent: FolderID | undefined,
    except?: FolderID,
  ): Promise<string | undefined> => {
    const answer = takeAnswer('folderName');
    if (answer !== undefined) return answer.value ?? undefined;
    return askFolderName(prompt, value, (text) => {
      const problem = folderNameProblem(store.current(), text, parent, except);
      return problem === undefined ? undefined : problemText(problem);
    });
  };

  /** Creates a folder after asking its name; resolves its id, or `undefined` if cancelled/refused. */
  const newFolder = async (parent: FolderID | undefined): Promise<FolderID | undefined> => {
    const name = await askName(
      parent === undefined ? 'Name of the new folder' : 'Name of the new subfolder',
      '',
      parent,
    );
    if (name === undefined) return undefined;
    const id = randomUUID();
    return applyResult(createFolder(store.current(), id, name, parent)) ? id : undefined;
  };

  /** Every folder with its path, sorted by path, for the "Move to Folder…" list. */
  const folderChoices = (): { id: FolderID; path: string[] }[] =>
    Object.keys(store.current().folders)
      .map((id) => ({ id, path: folderPath(store.current(), id) }))
      .filter((entry) => entry.path.length > 0)
      .sort((a, b) => a.path.join(' / ').localeCompare(b.path.join(' / ')));

  /**
   * The destination of "Move to Folder…": `{ folderID }` (`undefined` = No Folder), or `undefined`
   * when the user cancelled, the test answer names a folder that does not exist, or the name of
   * the new folder was cancelled or refused.
   */
  const chooseFolder = async (
    title: string,
  ): Promise<{ folderID: FolderID | undefined } | undefined> => {
    const choices = folderChoices();
    let choice: FolderChoice | undefined;
    const answer = takeAnswer('pickFolder');
    if (answer === undefined) {
      choice = await pickFolder(title, choices);
    } else if (answer.value === 'none') {
      choice = { kind: 'none' };
    } else if (answer.value === 'new') {
      choice = { kind: 'new' };
    } else if (Array.isArray(answer.value)) {
      const wanted = answer.value.join(' / ');
      const found = choices.find((entry) => entry.path.join(' / ') === wanted);
      choice = found === undefined ? undefined : { kind: 'folder', folderID: found.id };
    }
    if (choice === undefined) return undefined;
    if (choice.kind === 'none') return { folderID: undefined };
    if (choice.kind === 'folder') return { folderID: choice.folderID };
    const created = await newFolder(undefined);
    return created === undefined ? undefined : { folderID: created };
  };

  /** Registers a command that does nothing unless the tree is in use and a folder is served. */
  const guarded = (id: string, handler: (...args: unknown[]) => unknown): vscode.Disposable =>
    vscode.commands.registerCommand(id, (...args: unknown[]) => {
      if (!options.editorMode() || store.folder() === undefined) return undefined;
      return handler(...args);
    });

  const commands: vscode.Disposable[] = [
    guarded(NEW_FOLDER_COMMAND_ID, () => newFolder(undefined)),
    guarded(NEW_SUBFOLDER_COMMAND_ID, (clicked) => {
      const parent = targetFolder(clicked);
      return parent === undefined ? undefined : newFolder(parent);
    }),
    guarded(RENAME_FOLDER_COMMAND_ID, async (clicked) => {
      const id = targetFolder(clicked);
      const folder = id === undefined ? undefined : store.current().folders[id];
      if (id === undefined || folder === undefined) return;
      const name = await askName('New name for the folder', folder.name, folder.parent, id);
      if (name !== undefined) applyResult(renameFolder(store.current(), id, name));
    }),
    guarded(DELETE_FOLDER_COMMAND_ID, async (clicked) => {
      const id = targetFolder(clicked);
      const folder = id === undefined ? undefined : store.current().folders[id];
      if (id === undefined || folder === undefined) return;
      const contents = folderContents(store.current(), id);
      const answer = takeAnswer('confirmFolderDelete');
      const confirmed =
        answer !== undefined
          ? answer.value === true
          : await confirmFolderDelete({
              name: folder.name,
              sessions: contents.sessions.length,
              subfolders: contents.subfolders.length,
            });
      if (!confirmed) {
        log.info(`folder delete cancelled ${id}`);
        return;
      }
      const result = deleteFolder(store.current(), id);
      if (result.ok) apply(result.org);
      else void vscode.window.showWarningMessage(`OpenCode: ${problemText(result.reason)}`);
    }),
    guarded(MOVE_TO_FOLDER_COMMAND_ID, async (clicked, selected) => {
      const ids = targetSessions(clicked, selected);
      const first = ids[0];
      if (first === undefined) return;
      const row = tree.rowOf(first);
      const title =
        ids.length === 1 && row !== undefined
          ? `Move “${sessionLabel(row)}” to`
          : `Move ${String(ids.length)} sessions to`;
      const chosen = await chooseFolder(title);
      if (chosen !== undefined) applyResult(moveSessions(store.current(), ids, chosen.folderID));
    }),
    guarded(PIN_SESSION_COMMAND_ID, (clicked, selected) => {
      applyIfChanged(pinSessions(store.current(), targetSessions(clicked, selected), Date.now()));
    }),
    guarded(UNPIN_SESSION_COMMAND_ID, (clicked, selected) => {
      applyIfChanged(unpinSessions(store.current(), targetSessions(clicked, selected)));
    }),
    guarded(ARCHIVE_SESSION_COMMAND_ID, (clicked, selected) => {
      applyIfChanged(
        archiveSessions(store.current(), targetSessions(clicked, selected), Date.now()),
      );
    }),
    guarded(UNARCHIVE_SESSION_COMMAND_ID, (clicked, selected) => {
      applyIfChanged(unarchiveSessions(store.current(), targetSessions(clicked, selected)));
    }),
    vscode.commands.registerCommand(FILTER_SESSIONS_COMMAND_ID, async () => {
      if (!options.editorMode()) return;
      const answer = takeAnswer('filters');
      let next: SessionTreeFilters | undefined;
      if (answer === undefined) {
        next = await pickFilters(tree.filters());
      } else if (answer.value !== null && answer.value !== undefined) {
        next = {
          running: answer.value.includes('running'),
          needsInput: answer.value.includes('needsInput'),
          tab: answer.value.includes('tab'),
        };
      }
      if (next !== undefined && tree.setFilters(next)) view.refresh();
    }),
    vscode.commands.registerCommand(CLEAR_FILTERS_COMMAND_ID, () => {
      if (!options.editorMode()) return;
      if (tree.setFilters({ running: false, needsInput: false, tab: false })) view.refresh();
    }),
  ];

  /** Forgets `ids` in the organization: memory, queue, tree. Returns whether it held any of them. */
  const forget = (ids: readonly string[]): boolean => {
    if (ids.length === 0 || store.folder() === undefined) return false;
    return apply(pruneSessions(store.current(), ids));
  };

  return {
    disposable: vscode.Disposable.from(...commands),

    use(folder) {
      if (store.folder() === folder) return false;
      reconcileTicket += 1;
      const org = store.use(folder);
      announce(org);
      return tree.setOrganization(org);
    },

    reconcile(page) {
      if (!options.editorMode() || store.folder() === undefined) return;
      const { deleted, toRead } = tree.orphans(page);
      forget(deleted);
      if (toRead.length === 0) return;
      reconcileTicket += 1;
      const ticket = reconcileTicket;
      void options
        .readSessions(toRead)
        .then(({ found, missing }) => {
          // A newer page or another served folder made this answer stale; drop it whole.
          if (ticket !== reconcileTicket || !options.editorMode()) return;
          if (tree.adopt(found)) view.refresh();
          forget(missing);
        })
        .catch((error: unknown) => {
          log.warn(`reading the organized sessions failed: ${String(error)}`);
        });
    },

    forget,

    drop(drag, target) {
      if (!options.editorMode() || store.folder() === undefined) return;
      const { org, refused } = applyDrop(store.current(), drag, target, Date.now());
      for (const reason of refused) log.info(`sessions drop refused: ${reason}`);
      apply(org);
    },

    placeOf(sessionID) {
      const org = store.current();
      if (isArchived(org, sessionID)) return 'Archived';
      const where = folderOf(org, sessionID);
      return where === undefined ? undefined : folderPath(org, where).join(' / ');
    },

    stored: async () => {
      await store.flush();
      const folder = store.folder();
      const all: unknown = options.memento.get(SESSION_ORGANIZATION_KEY);
      const entry =
        folder !== undefined &&
        typeof all === 'object' &&
        all !== null &&
        Object.hasOwn(all, folder)
          ? (all as Record<string, unknown>)[folder]
          : undefined;
      return {
        folder,
        stored: entry === undefined ? undefined : (JSON.parse(JSON.stringify(entry)) as unknown),
      };
    },
  };
}
