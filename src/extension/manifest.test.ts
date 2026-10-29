import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ids from './ids';

interface Manifest {
  engines: { vscode: string };
  devDependencies: Record<string, string>;
  capabilities?: { untrustedWorkspaces?: { supported?: unknown; description?: string } };
  contributes: {
    viewsContainers: { activitybar: { id: string }[] };
    views: Record<string, { id: string }[]>;
    commands: { command: string; title?: string; category?: string }[];
    configuration: {
      properties: Record<
        string,
        {
          type?: string;
          default?: unknown;
          scope?: string;
          order?: number;
          markdownDescription?: string;
        }
      >;
    };
  };
}

/**
 * Reads and parses a JSON file relative to this test file.
 *
 * The result is asserted to `T` (not validated): these tests read the repository's own
 * package.json, and a missing field makes the test fail loudly with a TypeError, which is the
 * wanted outcome. VERIFIED on Windows 11 with `npm test` (Vitest, `node` environment, 9 tests
 * passed, 2026-10-20): `import.meta.url` is a `file:` URL and the relative paths resolve.
 * Other operating systems UNVERIFIED.
 */
function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as T;
}

const manifest = readJson<Manifest>('../../package.json');
const idValues: string[] = Object.values(ids);

/**
 * Protects against renaming an id on one side only (ids.ts vs `contributes`), which fails
 * silently at runtime: the command does not exist, or the view reports "no data provider".
 * Also forces issues #2 and #7 to add a constant for each contribution they add.
 * The data is the REAL package.json, not a fabricated fixture.
 */
describe('ids.ts matches package.json contributes', () => {
  it('declares the view container id', () => {
    const containers = manifest.contributes.viewsContainers.activitybar.map((c) => c.id);
    expect(containers).toContain(ids.VIEW_CONTAINER_ID);
  });

  it('declares the chat view inside the container', () => {
    const views = manifest.contributes.views[ids.VIEW_CONTAINER_ID] ?? [];
    expect(views.map((v) => v.id)).toContain(ids.CHAT_VIEW_ID);
  });

  it('declares the show-logs command', () => {
    const commands = manifest.contributes.commands.map((c) => c.command);
    expect(commands).toContain(ids.SHOW_LOGS_COMMAND_ID);
  });

  it('declares the phase 3 commands (restart, select folder, manage permissions)', () => {
    const commands = manifest.contributes.commands.map((c) => c.command);
    expect(commands).toContain(ids.RESTART_SERVER_COMMAND_ID);
    expect(commands).toContain(ids.SELECT_FOLDER_COMMAND_ID);
    expect(commands).toContain(ids.MANAGE_PERMISSIONS_COMMAND_ID);
  });

  // Issue #33 (decision of Sergio, 28/10/2026): opencode can run what the project defines, for
  // example a slash command with !`cmd`, with the permissions of the user, so the extension is not
  // loaded in Restricted Mode. The real behaviour of the declaration is `test:visual` step 25; this
  // only keeps the manifest from losing it. Reading the real package.json, not a fixture.
  it('declares that untrusted workspaces are not supported, and says why', () => {
    const declared = manifest.capabilities?.untrustedWorkspaces;
    expect(declared?.supported).toBe(false);
    expect(declared?.description).toMatch(/commands/i);
  });

  it('does NOT contribute the internal commands (they take link arguments)', () => {
    const commands = manifest.contributes.commands.map((c) => c.command);
    expect(commands).not.toContain(ids.SHOW_REQUEST_COMMAND_ID);
    expect(commands).not.toContain(ids.REPLY_PERMISSION_COMMAND_ID);
  });

  // Issue #23. Scope `window` (user and workspace), unlike the executable path: the value can only
  // pick among models the server already offers, and a workspace in Restricted Mode never reaches
  // this extension (it declares `untrustedWorkspaces.supported: false`, issue #33).
  it('declares the default-model setting with its id, type, default and scope', () => {
    const setting = manifest.contributes.configuration.properties[ids.DEFAULT_MODEL_SETTING];
    expect(ids.DEFAULT_MODEL_SETTING).toBe(`${ids.CONFIG_SECTION}.${ids.DEFAULT_MODEL_KEY}`);
    expect(setting).toMatchObject({ type: 'string', default: '', scope: 'window' });
  });

  // Issue #11. Scope `machine`, like the executable path: a `.vscode/settings.json` of a cloned
  // repository must not be able to point the prompts and the code of the user at another server.
  // The password commands are contributed; the one that stores a password without the input box
  // (test mode only) must NOT be.
  it('declares the external-server setting (scope machine) and its password commands', () => {
    const setting = manifest.contributes.configuration.properties[ids.SERVER_URL_SETTING];
    expect(ids.SERVER_URL_SETTING).toBe(`${ids.CONFIG_SECTION}.${ids.SERVER_URL_KEY}`);
    expect(setting).toMatchObject({ type: 'string', default: '', scope: 'machine' });
    const commands = manifest.contributes.commands.map((c) => c.command);
    expect(commands).toContain(ids.SET_SERVER_PASSWORD_COMMAND_ID);
    expect(commands).toContain(ids.CLEAR_SERVER_PASSWORD_COMMAND_ID);
    expect(commands).not.toContain(ids.TEST_SET_SERVER_PASSWORD_COMMAND_ID);
  });

  it('has a constant for every contributed command', () => {
    const missing = manifest.contributes.commands
      .map((c) => c.command)
      .filter((command) => !idValues.includes(command));
    expect(missing).toEqual([]);
  });

  it('has a constant for every contributed view and view container', () => {
    const contributed = [
      ...manifest.contributes.viewsContainers.activitybar.map((c) => c.id),
      ...Object.values(manifest.contributes.views).flatMap((views) => views.map((v) => v.id)),
    ];
    const missing = contributed.filter((id) => !idValues.includes(id));
    expect(missing).toEqual([]);
  });
});

/**
 * Protects the default keybindings (issue #35) against the mistakes a `when` clause and a key
 * choice let through: a binding for a command nobody contributed (it would not show up by name in
 * Keyboard Shortcuts), a binding without `mac` or `when` (it would fire everywhere, or with the
 * wrong modifier), and a key that is already taken by a key the webview handles itself (the iframe
 * forwards every keydown to the workbench, so the command would run on top of the webview's own
 * handler) or by Claude Code or the official opencode extension.
 * Provenance: the data are the REAL package.json. The deny list is copied from the docs read on
 * 25/10/2026 (Claude Code: https://code.claude.com/docs/en/vs-code; opencode:
 * `sdks/vscode/package.json` on `dev`); it is a list written by hand, not a live check. The check
 * against the default keybindings of VS Code itself runs in `test/integration/commands.test.ts`.
 */
describe('keybindings in package.json', () => {
  interface Binding {
    command: string;
    key: string;
    mac?: string;
    when?: string;
    args?: unknown;
  }
  const bindings = readJson<{ contributes: { keybindings?: Binding[] } }>('../../package.json')
    .contributes.keybindings;
  const list = bindings ?? [];
  const contributed = manifest.contributes.commands.map((c) => c.command);
  const DENIED = [
    'escape',
    'enter',
    'tab',
    'ctrl+v',
    'cmd+v',
    'ctrl+escape',
    'cmd+escape',
    'ctrl+shift+escape',
    'cmd+shift+escape',
    'alt+k',
    'ctrl+alt+k',
    'cmd+alt+k',
    'ctrl+alt+f',
    'ctrl+shift+t',
    'cmd+shift+t',
    'ctrl+alt+i',
    'ctrl+i',
    'cmd+i',
  ];

  it('declares the shortcuts of Focus Prompt (two, one per direction) and New Session', () => {
    expect(list.map((b) => b.command).sort()).toEqual(
      [ids.FOCUS_PROMPT_COMMAND_ID, ids.FOCUS_PROMPT_COMMAND_ID, ids.NEW_SESSION_COMMAND_ID].sort(),
    );
  });

  // Issue #92: the key from editor text must not depend on `openVsCode.chatFocused`, which lags
  // the real focus (it comes from the webview by postMessage). The two `when` clauses must also be
  // disjoint, or VS Code would pick one of the two directions by rule order.
  it('sends Focus Prompt to the chat from editor text and to the editor only from the chat', () => {
    const focus = list.filter((b) => b.command === ids.FOCUS_PROMPT_COMMAND_ID);
    expect(focus.map((b) => [b.when, b.args])).toEqual([
      ['editorTextFocus', { to: 'chat' }],
      [`${ids.CHAT_FOCUSED_CONTEXT_KEY} && !editorTextFocus`, { to: 'editor' }],
    ]);
    expect(new Set(focus.map((b) => `${b.key}|${b.mac ?? ''}`)).size).toBe(1);
  });

  it('binds only contributed commands, each with key, mac and a non-empty when', () => {
    for (const binding of list) {
      expect(contributed, binding.command).toContain(binding.command);
      expect(binding.key, binding.command).not.toBe('');
      expect(binding.mac ?? '', binding.command).not.toBe('');
      expect((binding.when ?? '').trim(), binding.command).not.toBe('');
    }
  });

  // Both sides are normalised (lower case, modifiers sorted, key last) so `alt+ctrl+k` does not
  // slip past `ctrl+alt+k`.
  it('uses no key on the deny list', () => {
    const normalize = (key: string): string => {
      const parts = key.toLowerCase().split('+');
      const last = parts.pop() ?? '';
      return [...parts.sort(), last].join('+');
    };
    const denied = DENIED.map(normalize);
    const used = list.flatMap((b) => [b.key, b.mac ?? '']).map(normalize);
    expect(used.filter((k) => denied.includes(k))).toEqual([]);
  });

  it('declares the four palette commands with their constants', () => {
    for (const id of [
      ids.OPEN_CHAT_COMMAND_ID,
      ids.FOCUS_PROMPT_COMMAND_ID,
      ids.NEW_SESSION_COMMAND_ID,
      ids.STOP_RESPONSE_COMMAND_ID,
    ]) {
      expect(contributed).toContain(id);
    }
  });
});

/**
 * Protects the rule "@types/vscode must not be newer than engines.vscode". It mirrors
 * `validateVSCodeTypesCompatibility` in vsce (src/validation.ts), which compares only
 * major.minor of the DECLARED specs; vsce does NOT look at the installed version. The last test
 * covers that gap: with a caret spec vsce would pass while npm installs a newer typings
 * package, and the code could use an API the engine does not guarantee.
 * The data is the REAL package.json and node_modules, not fabricated.
 * The vsce behaviour is from reading its source (HYPOTHESIS until a packaging run, issue #5).
 */
describe('@types/vscode versus engines.vscode', () => {
  const declared = manifest.devDependencies['@types/vscode'] ?? '';
  const engine = manifest.engines.vscode;

  /**
   * Extracts `[major, minor]` from a spec such as `1.105.0` or `^1.105.0`.
   *
   * Throws `Error('Unexpected version spec: …')` for anything else (ranges, tags, `~`), so a
   * new spec style fails the test loudly instead of being compared as NaN.
   */
  function majorMinor(spec: string): [number, number] {
    const match = /^\^?(\d+)\.(\d+)\.\d+$/.exec(spec);
    if (!match) throw new Error(`Unexpected version spec: ${spec}`);
    return [Number(match[1]), Number(match[2])];
  }

  it('pins @types/vscode to an exact version', () => {
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('declares engines.vscode as a caret range', () => {
    expect(engine).toMatch(/^\^\d+\.\d+\.\d+$/);
  });

  it('is not newer than engines.vscode (major.minor)', () => {
    const [typesMajor, typesMinor] = majorMinor(declared);
    const [engineMajor, engineMinor] = majorMinor(engine);
    const typesIsNewer =
      typesMajor > engineMajor || (typesMajor === engineMajor && typesMinor > engineMinor);
    expect(typesIsNewer).toBe(false);
  });

  it('has the declared version installed', () => {
    const installed = readJson<{ version: string }>(
      '../../node_modules/@types/vscode/package.json',
    );
    expect(installed.version).toBe(declared);
  });
});

/**
 * Protects the contributed settings (issue #38) from drifting between `ids.ts`, the manifest and
 * the descriptions the Settings editor renders. Six tests, each defending against one regression:
 * renaming a setting on one side only (the constant and the manifest disagree and nothing fails
 * at runtime); a setting without type, default, explicit scope or description; two settings
 * sharing an `order` (the editor then picks the order itself); a `#id#` link written without
 * both backticks (`` `#id#` ``; bare, the editor showed the literal text, see the note on that
 * test); a `` `#id#` `` link to a setting that does not exist (HYPOTHESIS: the editor would not
 * paint a working link; never rendered, it would take a broken id in a `test:visual` run); and a
 * `**OpenCode: X**` command quoted in a description that was renamed or removed (issue #35 may
 * rename commands).
 * The data is the REAL package.json, not a fabricated fixture. How the Settings editor RENDERS
 * the descriptions is not covered here: that is `test:visual` step 21, which sees only the good
 * backtick form.
 */
describe('contributes.configuration', () => {
  const properties = manifest.contributes.configuration.properties;
  const entries = Object.entries(properties);

  it('has a constant in ids.ts for every contributed setting', () => {
    const missing = Object.keys(properties).filter((id) => !idValues.includes(id));
    expect(missing).toEqual([]);
  });

  it('gives every setting a type, a default, an explicit scope and a description', () => {
    const incomplete = entries
      .filter(
        ([, s]) =>
          s.type === undefined ||
          s.default === undefined ||
          s.scope === undefined ||
          (s.markdownDescription ?? '').trim() === '',
      )
      .map(([id]) => id);
    expect(incomplete).toEqual([]);
  });

  it('gives every setting a distinct integer order', () => {
    const orders = entries.map(([, s]) => s.order);
    expect(orders.every((o) => Number.isInteger(o))).toBe(true);
    expect(new Set(orders).size).toBe(orders.length);
  });

  // VERIFIED once by hand over CDP (VS Code 1.143.1, Windows 11, 2026-10-25), not a check of
  // `test:visual`: with the bare form the Settings editor showed the literal text and 0 links.
  // Step 21 only checks the backtick form ("the #id# link of the first setting is painted as a
  // link"). A link with a single backtick is also rejected: both backticks or none.
  it('writes every #id# link between backticks', () => {
    const bare = entries.flatMap(([id, s]) =>
      [...(s.markdownDescription ?? '').matchAll(/`?#[\w.]+#`?/g)]
        .filter((m) => !(m[0].startsWith('`') && m[0].endsWith('`')))
        .map((m) => `${id}: ${m[0]}`),
    );
    expect(bare).toEqual([]);
  });

  it('links (#id#) only to settings that exist', () => {
    const broken = entries.flatMap(([id, s]) =>
      [...(s.markdownDescription ?? '').matchAll(/`#([\w.]+)#`/g)]
        .map((m) => m[1] ?? '')
        .filter((target) => !(target in properties))
        .map((target) => `${id} -> ${target}`),
    );
    expect(broken).toEqual([]);
  });

  it('quotes (**OpenCode: X**) only commands that are contributed with that title', () => {
    const titles = manifest.contributes.commands
      .filter((c) => c.category === 'OpenCode')
      .map((c) => c.title);
    const unknown = entries.flatMap(([id, s]) =>
      [...(s.markdownDescription ?? '').matchAll(/\*\*OpenCode: ([^*]+)\*\*/g)]
        .map((m) => m[1] ?? '')
        .filter((title) => !titles.includes(title))
        .map((title) => `${id} -> ${title}`),
    );
    expect(unknown).toEqual([]);
  });
});
