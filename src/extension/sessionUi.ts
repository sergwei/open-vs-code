import * as vscode from 'vscode';
import { sanitizeLinkText } from './attentionPolicy';

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
 * does; removing them is free). `running` adds a warning because the server interrupts a busy session before deleting
 * it (VERIFIED by the planner spike against opencode 2.0.32, Windows 11, 21/10/2026).
 * UNVERIFIED in other OSes; on Windows the dialog was clicked by `npm run test:visual` (step 9).
 */
export async function confirmSessionDelete(info: {
  title: string;
  running: boolean;
}): Promise<boolean> {
  const title = sanitizeLinkText(info.title).trim();
  const answer = await vscode.window.showWarningMessage(
    `Delete session “${title === '' ? 'Untitled session' : title}”?`,
    {
      modal: true,
      detail:
        'Its messages and any subagent sessions are deleted from opencode, also for other opencode clients. ' +
        'This cannot be undone.' +
        (info.running ? ' It is running now and will be stopped.' : ''),
    },
    'Delete',
  );
  return answer === 'Delete';
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
 * the same reason as {@link confirmSessionDelete}.
 * VERIFIED by `test:visual` (real VS Code 1.143, Windows 11, synthetic server, 23/10/2026): the
 * checks "a modal dialog of VS Code asks and says it cannot be undone (", "Cancel keeps the revert
 * prepared" and "the history is deleted and the block is gone" passed with real clicks on the
 * dialog. Not observed: macOS/Linux dialogs, a screen reader reading the dialog; the text is ours.
 */
export async function confirmRevertDiscard(): Promise<boolean> {
  const answer = await vscode.window.showWarningMessage(
    'Discard the reverted messages for good?',
    {
      modal: true,
      detail:
        'The messages from the revert point on are deleted from opencode, also for other opencode clients, ' +
        'and Restore can no longer bring them back. The files stay as they are now, and edits you had ' +
        'made by hand to the files the revert restored can no longer be recovered. ' +
        'This cannot be undone.',
    },
    'Discard for good',
  );
  return answer === 'Discard for good';
}
