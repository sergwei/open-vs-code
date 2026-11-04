import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { plural } from '../shared/l10n';
import { MAX_SESSION_TITLE_LENGTH } from '../shared/protocol';
import { sanitizeLinkText } from './attentionPolicy';
import { emptyTitle } from './sessionDisplay';
import type { SessionTreeFilters } from './sessionTree';

/** The destination the user picked in the "Move to Folder…" list. */
export type FolderChoice =
  { kind: 'none' } | { kind: 'new' } | { kind: 'folder'; folderID: string };

/**
 * Asks for the name of a folder (E9-sessions-organize) with an input box that starts with `value`
 * selected. `validate` returns the message to show for a name that cannot be used, or `undefined`
 * (the glue passes `sessionOrganization.ts` rules: 1 to 80 characters, no sibling with the same
 * name). Resolves the typed text (untrimmed: the operation trims it), or `undefined` on Escape.
 * The text is the user's own, so nothing is sanitised. The integration suite answers it through
 * `TEST_SESSION_ANSWERS_COMMAND_ID`; `test:visual` step 34 types in it. VERIFIED by step 34 (Windows
 * 11, VS Code 1.144.0, 1/11/2026, synthetic server): "B1 New Folder… asks "Name of the new folder"
 * and the tree draws Temp34 at the first level before the date groups" and "B11 Rename Folder… asks
 * "New name for the folder" with the current name". NOT observed: the error text of a refused name
 * (Vitest only).
 */
export async function askFolderName(
  prompt: string,
  value: string,
  validate: (text: string) => string | undefined,
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt,
    value,
    valueSelection: [0, value.length],
    validateInput: validate,
  });
}

/**
 * Shows the "Move to Folder…" list: "No Folder", every folder by its full path (`Spikes / SSE`,
 * the caller sorts them) and "New Folder…". `title` names what is moved. Icons go in `iconPath`,
 * never as `$(…)` inside the label, so a folder named `$(trash)` is just text. Resolves the
 * choice, or `undefined` on Escape. The fixed labels and the placeholder go through `l10n.t`; the
 * folder paths are the user's own text and are never translated. VERIFIED by `test:visual` step 34
 * (Windows 11, VS Code 1.144.0, 1/11/2026, a click on the row): "B2 Move to Folder… lists" "No
 * Folder", "Spikes34", "Spikes34 / SSE34" and "New Folder…" under the title "Move “Org34A COSTLY”
 * to". NOT observed: "New Folder…" chosen from this list on screen (the integration suite answers
 * it).
 */
export async function pickFolder(
  title: string,
  folders: readonly { id: string; path: readonly string[] }[],
): Promise<FolderChoice | undefined> {
  interface Item extends vscode.QuickPickItem {
    choice: FolderChoice;
  }
  const items: Item[] = [
    {
      label: l10n.t('No Folder'),
      iconPath: new vscode.ThemeIcon('close'),
      choice: { kind: 'none' },
    },
    ...folders.map((folder): Item => ({
      label: folder.path.join(' / '),
      iconPath: new vscode.ThemeIcon('folder'),
      choice: { kind: 'folder', folderID: folder.id },
    })),
    {
      label: l10n.t('New Folder…'),
      iconPath: new vscode.ThemeIcon('new-folder'),
      choice: { kind: 'new' },
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: l10n.t('Search folders'),
  });
  return picked?.choice;
}

/**
 * Asks to confirm deleting a folder (E9-sessions-organize), with a MODAL native dialog; resolves
 * `true` only on "Delete Folder". The detail says what really happens: the sessions inside (and
 * under its subfolders) go back to "No Folder" and NO session is deleted, so the button is not
 * the scary one of {@link confirmSessionDelete}. The name is the user's own text. The verb agrees
 * with the subject ("Its 1 session goes back", "Its 2 sessions go back"): the first screen of step
 * 34 read "Its 1 session go back". The detail is one whole sentence per case (sessions only, or
 * sessions and subfolders, each count with its own singular and plural), chosen with `plural`, so
 * a translation never glues fragments; the button is compared with its translated label.
 * VERIFIED by `test:visual` step 34 (Windows 11, VS Code 1.144.0, 1/11/2026, a click on its button):
 * "B6 Delete Folder asks in the modal" with the text "Delete folder “Docs34”?" and "No session is
 * deleted.". NOT observed: the subfolder wording on screen (Vitest does not cover it either).
 */
export async function confirmFolderDelete(info: {
  name: string;
  sessions: number;
  subfolders: number;
}): Promise<boolean> {
  const { sessions, subfolders } = info;
  const detail =
    subfolders === 0
      ? plural(
          sessions,
          l10n.t('Its {0} session goes back to No Folder. No session is deleted.', sessions),
          l10n.t('Its {0} sessions go back to No Folder. No session is deleted.', sessions),
        )
      : plural(
          subfolders,
          plural(
            sessions,
            l10n.t(
              'Its {0} session and {1} subfolder go back to No Folder. No session is deleted.',
              sessions,
              subfolders,
            ),
            l10n.t(
              'Its {0} sessions and {1} subfolder go back to No Folder. No session is deleted.',
              sessions,
              subfolders,
            ),
          ),
          plural(
            sessions,
            l10n.t(
              'Its {0} session and {1} subfolders go back to No Folder. No session is deleted.',
              sessions,
              subfolders,
            ),
            l10n.t(
              'Its {0} sessions and {1} subfolders go back to No Folder. No session is deleted.',
              sessions,
              subfolders,
            ),
          ),
        );
  const button = l10n.t('Delete Folder');
  const answer = await vscode.window.showWarningMessage(
    l10n.t('Delete folder “{0}”?', info.name),
    { modal: true, detail },
    button,
  );
  return answer === button;
}

/**
 * Shows the multiple-choice filter list of the Sessions view with the current filters ticked.
 * Resolves the new filters (the ticked ones are ORed by the tree; none ticked clears them), or
 * `undefined` on Escape, which leaves the filters as they are. Labels, title and placeholder go
 * through `l10n.t`. VERIFIED by `test:visual` step 34 (Windows 11, VS Code 1.144.0, 1/11/2026,
 * real clicks on the rows and Enter, BEFORE the labels were translated): "B8 the Open in a tab
 * filter leaves the session with a tab" and "V2 Default Dark Modern: without a filter the view has no
 * Clear Filters". HYPOTHESIS: the answer is read from each item's `key`, never from its label, so
 * a translated label cannot change the filters (read from the code; no test runs the picker with
 * a Spanish label: that would need a test in a Spanish VS Code to pick a filter, and none
 * exists). NOT observed: the keyboard path of the picker (Space to tick).
 */
export async function pickFilters(
  current: SessionTreeFilters,
): Promise<SessionTreeFilters | undefined> {
  interface Item extends vscode.QuickPickItem {
    key: keyof SessionTreeFilters;
  }
  const items: Item[] = [
    { label: l10n.t('Running'), key: 'running', picked: current.running },
    { label: l10n.t('Needs input'), key: 'needsInput', picked: current.needsInput },
    { label: l10n.t('Open in a tab'), key: 'tab', picked: current.tab },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: l10n.t('Filter Sessions'),
    placeHolder: l10n.t('Show only the sessions that are…'),
    canPickMany: true,
  });
  if (picked === undefined) return undefined;
  const keys = new Set(picked.map((item) => item.key));
  return { running: keys.has('running'), needsInput: keys.has('needsInput'), tab: keys.has('tab') };
}

/**
 * Asks for the new title of a session (issue #77, E3: Rename of the native Sessions tree) with an
 * input box that starts with `current` selected, so typing replaces it. Resolves the typed text, or
 * `undefined` when the user cancels (Escape).
 *
 * The validation mirrors what `ChatController.renameSessionById` enforces (trimmed, 1 to
 * {@link MAX_SESSION_TITLE_LENGTH} characters), so the box refuses what the host would reject; the
 * host re-checks anyway because it does not trust its callers. The text is the user's own, not the
 * server's, so nothing is sanitised. The prompt and the validation message go through `l10n.t`.
 * VERIFIED by a full `test:visual` (Windows 11, VS Code 1.144.0,
 * 30/10/2026, 0 FAIL): "ok   B2 Rename on the row asks "New title for the session" with the
 * current title ("Tab29A: SEED_SESSIONS reply with exactly"), and the row and the tab then read
 * Renamed29 (row true, tab true)". Not observed: the validation messages on screen.
 */
export async function askSessionTitle(current: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: l10n.t('New title for the session'),
    value: current,
    valueSelection: [0, current.length],
    validateInput: (text) => {
      const length = text.trim().length;
      return length >= 1 && length <= MAX_SESSION_TITLE_LENGTH
        ? undefined
        : l10n.t('A session title needs 1 to {0} characters', MAX_SESSION_TITLE_LENGTH);
    },
  });
}

/**
 * Asks the user to confirm deleting a session (issue #20), with a MODAL native dialog; resolves
 * `true` only when they press "Delete" (Escape, the close button and clicking away are `false`).
 *
 * The host shows it, not the webview, on purpose: a delete is irreversible and also reaches every
 * other opencode client of the same database (the TUI), and the webview renders LLM markdown, so
 * the side that is the policy boundary must be the one that authorises it (alternative discarded:
 * an in-page confirmation, which an injected script could click). The title comes from the host's
 * `session.get`, read by the host at that moment (never the mirror, never the webview's message), and
 * `[ ] ( )` are removed in case a dialog links text like the notifications do (HYPOTHESIS that it
 * does; removing them is free). A session with no title is shown as the translated
 * {@link emptyTitle}, and the button is compared with its translated label. `running` adds a warning because the server interrupts a busy session before deleting
 * it (VERIFIED by the planner spike against opencode 2.0.32, Windows 11, 21/10/2026).
 * UNVERIFIED in other OSes; on Windows the dialog was clicked by `npm run test:visual` (step 9).
 */
export async function confirmSessionDelete(info: {
  title: string;
  running: boolean;
}): Promise<boolean> {
  const title = sanitizeLinkText(info.title).trim();
  const button = l10n.t('Delete');
  const answer = await vscode.window.showWarningMessage(
    l10n.t('Delete session “{0}”?', title === '' ? emptyTitle() : title),
    {
      modal: true,
      detail: info.running
        ? l10n.t(
            'Its messages and any subagent sessions are deleted from opencode, also for other opencode clients. This cannot be undone. It is running now and will be stopped.',
          )
        : l10n.t(
            'Its messages and any subagent sessions are deleted from opencode, also for other opencode clients. This cannot be undone.',
          ),
    },
    button,
  );
  return answer === button;
}

/**
 * Asks the user to confirm "Discard for good" on a prepared revert (issue #32, decision of Sergio
 * 23/10/2026: the only confirmation of the feature), with a MODAL native dialog; resolves `true`
 * only on the "Discard for good" button (Escape, the close button and clicking away are `false`).
 *
 * The step that cannot be undone is the commit, not the prepare: the server then deletes the
 * history from the boundary on (the boundary message included), for every opencode client of the
 * same database, and nothing can bring it back (read in `core/src/session/revert.ts` @843a6c51 and
 * observed on a `shell` message: after `commit` the message was gone and a later `clear` brought
 * nothing back). The files stay as the revert left them, and the copy the server kept when
 * preparing is dropped, so edits made by hand to the restored files can no longer be recovered:
 * the dialog says so (decision of Sergio 23/10/2026). The host shows it, not the webview, for
 * the same reason as {@link confirmSessionDelete}. The button is compared with its translated
 * label, so the answer is right in any language.
 * VERIFIED by `test:visual` (real VS Code 1.143, Windows 11, synthetic server, 23/10/2026): the
 * checks "a modal dialog of VS Code asks and says it cannot be undone (", "Cancel keeps the revert
 * prepared" and "the history is deleted and the block is gone" passed with real clicks on the
 * dialog. Not observed: macOS/Linux dialogs, a screen reader reading the dialog; the text is ours.
 */
export async function confirmRevertDiscard(): Promise<boolean> {
  const button = l10n.t('Discard for good');
  const answer = await vscode.window.showWarningMessage(
    l10n.t('Discard the reverted messages for good?'),
    {
      modal: true,
      detail: l10n.t(
        'The messages from the revert point on are deleted from opencode, also for other opencode clients, and Restore can no longer bring them back. The files stay as they are now, and edits you had made by hand to the files the revert restored can no longer be recovered. This cannot be undone.',
      ),
    },
    button,
  );
  return answer === button;
}
