import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { plural } from '../shared/l10n';
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
 * server and are shown as plain text by VS Code. The title, the placeholder, the "Saved" detail
 * (with the date in the language of VS Code) and the confirmation (singular or plural, and its
 * button compared by its translated label) go through `l10n.t`. UNVERIFIED in a real window (F5 point 7); the
 * controller's use of it is unit-tested with a fake.
 */
export async function pickSavedPermissionsToRevoke(
  items: readonly SavedPermission[],
): Promise<string[]> {
  const picks = items.map((item) => ({
    label: `${item.action} ${item.resource}`,
    detail: l10n.t('Saved {0}', new Date(item.createdAt).toLocaleString(vscode.env.language)),
    id: item.id,
  }));
  const chosen = await vscode.window.showQuickPick(picks, {
    canPickMany: true,
    title: l10n.t('OpenCode: saved permissions of this project'),
    placeHolder: l10n.t('Select the rules to revoke; OpenCode will ask again for them'),
  });
  if (chosen === undefined || chosen.length === 0) return [];
  const button = l10n.t('Revoke');
  const answer = await vscode.window.showWarningMessage(
    plural(
      chosen.length,
      l10n.t(
        'Revoke {0} saved permission? OpenCode will ask again before using it.',
        chosen.length,
      ),
      l10n.t(
        'Revoke {0} saved permissions? OpenCode will ask again before using them.',
        chosen.length,
      ),
    ),
    { modal: true },
    button,
  );
  return answer === button ? chosen.map((pick) => pick.id) : [];
}
