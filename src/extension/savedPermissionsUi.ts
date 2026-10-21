import * as vscode from 'vscode';
import type { SavedPermission } from './chatController';

/**
 * Lets the user choose which saved permission rules to revoke (issue #18, "Manage saved
 * permissions") and asks for a confirmation before anything is deleted.
 *
 * "Always" in opencode v2 stores a rule per project in its database (e.g. `read *`), so revoking
 * is the only way back; it is shown as a multi-select QuickPick (`label` = `<action> <resource>`,
 * `detail` = when it was saved) followed by a MODAL confirmation, because a rule such as `read *`
 * silently allows reading every file again. Resolves with the ids of the rules to remove; an empty
 * array when the user dismisses the list or declines the confirmation. The labels come from the
 * server and are shown as plain text by VS Code. UNVERIFIED in a real window (F5 point 7); the
 * controller's use of it is unit-tested with a fake.
 */
export async function pickSavedPermissionsToRevoke(
  items: readonly SavedPermission[],
): Promise<string[]> {
  const picks = items.map((item) => ({
    label: `${item.action} ${item.resource}`,
    detail: `Saved ${new Date(item.createdAt).toLocaleString()}`,
    id: item.id,
  }));
  const chosen = await vscode.window.showQuickPick(picks, {
    canPickMany: true,
    title: 'OpenCode: saved permissions of this project',
    placeHolder: 'Select the rules to revoke; OpenCode will ask again for them',
  });
  if (chosen === undefined || chosen.length === 0) return [];
  const answer = await vscode.window.showWarningMessage(
    `Revoke ${String(chosen.length)} saved permission${chosen.length === 1 ? '' : 's'}? OpenCode will ask again before using them.`,
    { modal: true },
    'Revoke',
  );
  return answer === 'Revoke' ? chosen.map((pick) => pick.id) : [];
}
