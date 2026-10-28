// Palette commands and default keybindings suite (issue #35).
//
// Protects against: a contributed command that is not registered (the palette would list a dead
// entry), a command that cannot reveal the chat from a closed view, and a default key that clashes
// with one VS Code ships. The last one is meant to close "does not collide on macOS and Linux":
// this file runs in the CI matrix of the three systems and each one reads ITS OWN default
// keybindings. VERIFIED by the CI of PR #81 (25/10/2026): the ubuntu-latest job passed the check
// "uses no default key that VS Code already binds to another command", and the macos-latest job
// read the Mac defaults (it failed on `alt+cmd+p`, which led to ACCEPTED_CLASHES). UNVERIFIED on
// macOS that the check passes with that exception until the next CI run.
//
// What this is NOT: it does not see the keys of other extensions (`--disable-extensions`), of the
// desktop environment or of the operating system. Built-in extensions do contribute to the default
// file it reads (a one-off dump listed this extension's own keys), but whether EVERY built-in one
// does is UNVERIFIED. The webview side (what the keys do inside the iframe) lives in `test:visual`.
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
  FOCUS_PROMPT_COMMAND_ID,
  NEW_SESSION_COMMAND_ID,
  OPEN_CHAT_COMMAND_ID,
  STOP_RESPONSE_COMMAND_ID,
} from '../../src/extension/ids';
import { openLogFromStart } from './support/extensionLog';

const EXTENSION_ID = 'sergwei.open-vs-code';

interface ManifestKeybinding {
  command: string;
  key: string;
  mac?: string;
  when?: string;
}

/** One rule of the default `keybindings.json`; only the fields this suite reads. */
interface DefaultRule {
  key?: string;
  command?: string;
  when?: string;
}

/**
 * Normalises a key so `Ctrl+Alt+P` and `alt+ctrl+p` compare equal: lower case, modifiers sorted,
 * the final key last. Chords (`ctrl+k ctrl+c`) keep their parts in order; a clash with a chord
 * is a clash of its first part only when the first part is ours, which no chord of ours is.
 */
function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .split(' ')
    .map((chord) => {
      const parts = chord.split('+');
      const last = parts.pop() ?? '';
      return [...parts.sort(), last].join('+');
    })
    .join(' ');
}

/**
 * Parses the default keybindings document, which is JSON with `//` and block comments and
 * possibly trailing commas. Strips comments only at the start of a line (a `//` inside a `when`
 * string, such as a URL, must survive) and trailing commas, then lets `JSON.parse` decide.
 */
function parseDefaultKeybindings(text: string): DefaultRule[] {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutLines = withoutBlocks
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  const withoutTrailing = withoutLines.replace(/,(\s*[\]}])/g, '$1');
  return JSON.parse(withoutTrailing) as DefaultRule[];
}

/**
 * Reads the default keybindings of this VS Code and operating system.
 *
 * Tries `vscode://defaultsettings/keybindings.json` as a document and, if that throws, the command
 * `workbench.action.openDefaultKeybindingsFile` and the active editor. Rejects with the cause if
 * neither yields a parseable list, so a VS Code that moves it fails loudly instead of "finding no
 * clash". VERIFIED on Windows 11, VS Code 1.143.1, 25/10/2026: the check "uses no default key that
 * VS Code already binds to another command" read more than 100 rules and reported
 * `ctrl+alt+o` (the first default, since replaced by `ctrl+alt+p`) bound to
 * `workbench.action.remote.showMenu`. With `ctrl+alt+p` the same check passed in the same
 * environment (`--label main`, 25 passing, 25/10/2026). Which of the two routes served it was
 * not recorded. A one-off dump of that run (not kept as a check) also listed the rules of this
 * extension itself and `workbench.action.chat.open`, so keys contributed by extensions DO appear.
 */
async function readDefaultKeybindings(): Promise<DefaultRule[]> {
  try {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse('vscode://defaultsettings/keybindings.json'),
    );
    return parseDefaultKeybindings(document.getText());
  } catch (first) {
    await vscode.commands.executeCommand('workbench.action.openDefaultKeybindingsFile');
    const text = vscode.window.activeTextEditor?.document.getText();
    if (text === undefined || text === '') {
      throw new Error('default keybindings not readable', { cause: first });
    }
    return parseDefaultKeybindings(text);
  }
}

describe('palette commands and keybindings', () => {
  const contributed = (): ManifestKeybinding[] => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    const packageJson = extension?.packageJSON as
      { contributes?: { keybindings?: ManifestKeybinding[] } } | undefined;
    return packageJson?.contributes?.keybindings ?? [];
  };

  before(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
  });

  /** The four commands are registered, not just listed in the manifest. */
  it('registers the four palette commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      OPEN_CHAT_COMMAND_ID,
      FOCUS_PROMPT_COMMAND_ID,
      NEW_SESSION_COMMAND_ID,
      STOP_RESPONSE_COMMAND_ID,
    ]) {
      assert.ok(commands.includes(id), `${id} is not registered`);
    }
  });

  /**
   * Focus Prompt with the chat never opened resolves the view and its document says `ready`.
   * Protects the reveal step (`openVsCode.chat.focus`, a command VS Code generates) of every
   * palette command. 8000 ms is our own choice (margin for a slow CI), not a VS Code value.
   */
  it('Focus Prompt reveals a chat that was closed', async () => {
    const log = await openLogFromStart();
    await vscode.commands.executeCommand(FOCUS_PROMPT_COMMAND_ID);
    await log.waitFor('Chat view resolved', 8000);
    await log.waitFor('webview ready', 8000);
  });

  /**
   * Default rules that share a key with ours and are accepted on purpose: key → command → the
   * exact `when` the default rule must still have. The check ignores `when` (it can only err
   * towards a false clash); an entry passes only while VS Code keeps that same `when`, so a change
   * of context in VS Code fails here instead of slipping through. Decision of Sergio, 25/10/2026,
   * to keep Cmd+Alt+P on macOS with this exception.
   * VERIFIED by the macos-latest CI job of PR #81 (25/10/2026): VS Code binds `alt+cmd+p` to these
   * three commands on macOS. The `when` values were READ in the bundle of VS Code 1.143.1 (Windows
   * build, its `mac` key 2606), not executed: `editorFocus`, `searchViewletFocus`, `inKeybindings`.
   * `editorFocus` is NOT disjoint from the `when` of our key to the chat (`editorTextFocus`, issue #92):
   * with the caret in editor text both rules apply, and VS Code runs only the winning one.
   * HYPOTHESIS that the extension rule wins there (contributed keybindings weigh more than
   * built-in ones), so Cmd+Alt+P is Focus Prompt in editor text and Preserve Case in the find
   * input, where our `when` is false. UNVERIFIED on a real Mac: pressing Cmd+Alt+P in each place
   * would settle it.
   */
  const ACCEPTED_CLASHES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    'alt+cmd+p': {
      togglePreserveCase: 'editorFocus',
      toggleSearchPreserveCase: 'searchViewletFocus',
      'keybindings.editor.toggleSortByPrecedence': 'inKeybindings',
    },
  };

  /**
   * True only for an entry of {@link ACCEPTED_CLASHES} whose recorded `when` is the rule's own: an
   * unknown command, or a rule with no `when` or another one, is never accepted (a missing entry
   * must not compare equal to a missing `when`).
   */
  const isAcceptedClash = (key: string, rule: DefaultRule): boolean => {
    const expected = rule.command === undefined ? undefined : ACCEPTED_CLASHES[key]?.[rule.command];
    return expected !== undefined && expected === rule.when?.trim();
  };

  /**
   * No default key may equal a key VS Code binds to ANOTHER command on this operating system,
   * except the rules of {@link ACCEPTED_CLASHES} while they keep their recorded `when`. A key
   * that VS Code binds to one of ours (impossible today) would pass.
   */
  it('uses no default key that VS Code already binds to another command', async () => {
    const ours = new Set([FOCUS_PROMPT_COMMAND_ID, NEW_SESSION_COMMAND_ID]);
    const rules = await readDefaultKeybindings();
    assert.ok(rules.length > 100, `only ${String(rules.length)} default rules were read`);
    for (const binding of contributed()) {
      const key = normalizeKey(process.platform === 'darwin' ? (binding.mac ?? '') : binding.key);
      assert.notStrictEqual(key, '', `${binding.command} has no key for ${process.platform}`);
      const clashes = rules.filter(
        (rule) =>
          rule.key !== undefined &&
          normalizeKey(rule.key) === key &&
          rule.command !== undefined &&
          !ours.has(rule.command.replace(/^-/, '')) &&
          !isAcceptedClash(key, rule),
      );
      assert.deepStrictEqual(
        clashes,
        [],
        `${key} (${binding.command}) is already bound by VS Code`,
      );
    }
  });
});
