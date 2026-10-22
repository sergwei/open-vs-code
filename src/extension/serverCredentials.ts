import * as vscode from 'vscode';
import {
  CLEAR_SERVER_PASSWORD_COMMAND_ID,
  CONFIG_SECTION,
  SERVER_URL_KEY,
  SERVER_URL_SETTING,
  SET_SERVER_PASSWORD_COMMAND_ID,
  TEST_SET_SERVER_PASSWORD_COMMAND_ID,
} from './ids';
import {
  ForgottenPasswords,
  parseServerUrl,
  SERVER_PASSWORD_KEY_PREFIX,
  serverPasswordKey,
  type ServerTarget,
} from './externalServer';
import type { ServerLog } from './opencodeServer';

const OPEN_SETTINGS = 'Open Settings';

/** Raw value of `openVsCode.serverUrl`, as the user wrote it. */
function readServerUrlSetting(): string {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(SERVER_URL_KEY, '');
}

/**
 * Reads what the server manager should follow: the `openVsCode.serverUrl` setting and, when it
 * is a usable address, the password stored for that origin.
 *
 * Empty setting -> `spawn`; unusable -> `external-invalid` with the fixed message of
 * `parseServerUrl`; usable -> `external` with the password from `context.secrets` (`undefined`
 * when none is stored, which the manager reports as `unauthorized` without a request). A
 * `secrets.get` that rejects is logged and treated as "no password": the target must always
 * resolve, or the manager would wait forever. The password never reaches a log line.
 * A password read for an origin in `forgotten` is ignored (see {@link ForgottenPasswords} for
 * the VS Code behaviour that needs it) and the stale copy is deleted again, with a warning line;
 * the delete is expected to raise one more read, which finds nothing, so it settles.
 * VERIFIED on Windows 11, VS Code 1.143.0, 22/10/2026 (external-server integration suite): the
 * warning "a forgotten server password came back from the secret storage; ignoring and deleting
 * it" is logged once and the state stays `unauthorized`. HYPOTHESIS: which event triggers that
 * last read (a `secrets.onDidChange` for our own delete, like the one noted on
 * {@link registerServerCredentials}); to check, log the event keys around a Forget.
 * UNVERIFIED in a real VS Code with a locked or missing OS keychain (Linux without a keyring):
 * `get` may reject or hang there; check on a Linux machine without `gnome-keyring`.
 */
export async function readServerTarget(
  context: vscode.ExtensionContext,
  log: ServerLog,
  forgotten: ForgottenPasswords,
): Promise<ServerTarget> {
  const parsed = parseServerUrl(readServerUrlSetting());
  if (parsed.kind === 'none') return { kind: 'spawn' };
  if (parsed.kind === 'invalid') return { kind: 'external-invalid', message: parsed.message };
  const key = serverPasswordKey(parsed.origin);
  let stored: string | undefined;
  try {
    stored = await context.secrets.get(key);
  } catch (error) {
    log.error(
      `could not read the server password: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const { password, stale } = forgotten.resolve(parsed.origin, stored);
  if (stale) {
    log.warn(
      'a forgotten server password came back from the secret storage; ignoring and deleting it',
    );
    try {
      await context.secrets.delete(key);
    } catch (error) {
      log.error(
        `could not delete the stale server password: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { kind: 'external', url: parsed.origin, password };
}

/**
 * Registers the password commands and the listeners that make the target follow the setting and
 * the stored password without reloading the window (issue #11).
 *
 * Commands: "OpenCode: Set Server Password" (an input box with `password: true`; needs a usable
 * `openVsCode.serverUrl` first, else it points the user at the setting) and "OpenCode: Forget
 * Server Password" (deletes the password of the configured origin, or, if the setting is
 * empty or unusable, every stored one: a leftover from an old URL must be removable). Forget is
 * not interactive on purpose, so the integration suite can call it. Under
 * `ExtensionMode.Test` a third, uncontributed command stores a password directly, because a test
 * cannot type into an input box; the `if` below is what keeps it out of production.
 *
 * `onChange` is called after every store or delete (directly, because that `secrets.onDidChange`
 * fires for our own writes in the same window is HYPOTHESIS: the docs only say "when a secret is
 * stored or deleted") and from the listeners on the setting and on `secrets.onDidChange`; the
 * caller must tolerate repeated calls (an equal target is a no-op in the manager). The password
 * is never logged, never put in a title or a notification, and never goes near the webview.
 * `forgotten` is shared with {@link readServerTarget}: Forget marks the origins it deletes, and
 * every Set (the command or the test-only one) lifts the mark of its origin BEFORE storing, so
 * the read that the store triggers is not discarded. The mark is what keeps a Forget made soon
 * after a Set from being undone by VS Code (see {@link ForgottenPasswords}).
 * UNVERIFIED in a real window: the input box itself (a human or `test:visual` must look at it),
 * and which exact keys the secret store lists in `keys()` for another window.
 */
export function registerServerCredentials(
  context: vscode.ExtensionContext,
  log: ServerLog,
  onChange: () => void,
  forgotten: ForgottenPasswords,
): void {
  const store = async (origin: string, password: string): Promise<void> => {
    forgotten.allow(origin);
    await context.secrets.store(serverPasswordKey(origin), password);
    log.info('server password stored');
    onChange();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(SET_SERVER_PASSWORD_COMMAND_ID, async () => {
      const parsed = parseServerUrl(readServerUrlSetting());
      if (parsed.kind !== 'ok') {
        const message =
          parsed.kind === 'invalid'
            ? parsed.message
            : 'Set openVsCode.serverUrl to the address of the server first.';
        const choice = await vscode.window.showWarningMessage(message, OPEN_SETTINGS);
        if (choice === OPEN_SETTINGS) {
          await vscode.commands.executeCommand('workbench.action.openSettings', SERVER_URL_SETTING);
        }
        return;
      }
      const password = await vscode.window.showInputBox({
        title: 'OpenCode: server password',
        prompt: 'Password of the opencode server. The user name is always "opencode".',
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) =>
          value.length === 0 ? 'The password cannot be empty.' : undefined,
      });
      if (password === undefined) return; // cancelled: nothing changes
      await store(parsed.origin, password);
    }),

    vscode.commands.registerCommand(CLEAR_SERVER_PASSWORD_COMMAND_ID, async () => {
      const parsed = parseServerUrl(readServerUrlSetting());
      const keys =
        parsed.kind === 'ok'
          ? [serverPasswordKey(parsed.origin)]
          : (await context.secrets.keys()).filter((key) =>
              key.startsWith(SERVER_PASSWORD_KEY_PREFIX),
            );
      for (const key of keys) {
        // Mark first: a read that starts while the delete is in flight must already be ignored.
        forgotten.forget(key.slice(SERVER_PASSWORD_KEY_PREFIX.length));
        await context.secrets.delete(key);
      }
      log.info(`server password removed (${String(keys.length)} key(s))`);
      void vscode.window.showInformationMessage(
        keys.length === 0
          ? 'OpenCode: there was no stored server password.'
          : `OpenCode: removed ${String(keys.length)} stored server ${
              keys.length === 1 ? 'password' : 'passwords'
            }.`,
      );
      onChange();
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SERVER_URL_SETTING)) onChange();
    }),
    context.secrets.onDidChange((event) => {
      if (event.key.startsWith(SERVER_PASSWORD_KEY_PREFIX)) onChange();
    }),
  );

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        TEST_SET_SERVER_PASSWORD_COMMAND_ID,
        async (args: unknown) => {
          if (
            typeof args !== 'object' ||
            args === null ||
            !('origin' in args) ||
            !('password' in args) ||
            typeof args.origin !== 'string' ||
            typeof args.password !== 'string'
          ) {
            throw new Error('expected { origin: string, password: string }');
          }
          await store(args.origin, args.password);
        },
      ),
    );
  }
}
