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
