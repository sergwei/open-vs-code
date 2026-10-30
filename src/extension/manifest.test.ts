import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAT_LOCATION, readChatLocation } from './chatLocation';
import * as ids from './ids';

interface Manifest {
  engines: { vscode: string };
  activationEvents: string[];
  devDependencies: Record<string, string>;
  capabilities?: { untrustedWorkspaces?: { supported?: unknown; description?: string } };
  contributes: {
    viewsContainers: { activitybar: { id: string }[] };
    views: Record<string, { id: string; name?: string; when?: string }[]>;
    viewsWelcome?: { view: string; contents: string; when?: string }[];
    commands: { command: string; title?: string; category?: string; icon?: string }[];
    menus?: Record<string, { command: string; group?: string; when?: string }[]>;
    configuration: {
      properties: Record<
        string,
        {
          type?: string;
          enum?: string[];
          enumDescriptions?: string[];
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

  // E3 (issue #77, Q4=1): F2 and Delete only while the Sessions tree has the focus, and not while a
  // text box of the tree (its type-to-find widget) has it: Delete there must erase a character, not
  // open the delete modal (W3 of review 1; the built-in Explorer rules carry the same `!inputFocus`).
  it('declares the shortcuts of Focus Prompt (two, one per direction), New Session, Rename and Delete', () => {
    expect(list.map((b) => b.command).sort()).toEqual(
      [
        ids.FOCUS_PROMPT_COMMAND_ID,
        ids.FOCUS_PROMPT_COMMAND_ID,
        ids.NEW_SESSION_COMMAND_ID,
        ids.RENAME_SESSION_COMMAND_ID,
        ids.DELETE_SESSION_COMMAND_ID,
      ].sort(),
    );
    for (const id of [ids.RENAME_SESSION_COMMAND_ID, ids.DELETE_SESSION_COMMAND_ID]) {
      expect(list.find((b) => b.command === id)?.when, id).toBe(
        `focusedView == ${ids.SESSIONS_VIEW_ID} && !inputFocus`,
      );
    }
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
 * Protects the context-menu entries of issue #36 (decisions P1, P2, P2b and T2 of Sergio,
 * 29/10/2026): the four commands with their constants and titles, the editor entries in their own
 * ordered group, the extra Explorer entry next to the existing one, `resourceScheme == file` on
 * every entry (so untitled, `git:` and `output:` documents never show them) and the palette
 * (editor commands visible, the Explorer ones hidden because they need the Explorer's arguments).
 * The data is the REAL package.json. How VS Code RENDERS the menus is not covered here: that is
 * the `test:visual` checks "C1 the editor right-click menu lists "Add to OpenCode Chat", "Explain with
 * OpenCode" and "Fix with OpenCode" in that order" and "C2 the Explorer
 * right-click menu lists "Add to OpenCode Chat" then "Explain with OpenCode" and no Fix".
 */
describe('context menus (issue #36)', () => {
  const menus = manifest.contributes.menus ?? {};
  const entries = (menu: string): { command: string; group?: string; when?: string }[] =>
    menus[menu] ?? [];
  const titleOf = (id: string): string | undefined =>
    manifest.contributes.commands.find((c) => c.command === id)?.title;

  it('contributes the four commands with the approved titles and no category', () => {
    const wanted: [string, string][] = [
      [ids.ADD_SELECTION_TO_CHAT_COMMAND_ID, 'Add to OpenCode Chat'],
      [ids.EXPLAIN_SELECTION_COMMAND_ID, 'Explain with OpenCode'],
      [ids.FIX_SELECTION_COMMAND_ID, 'Fix with OpenCode'],
      [ids.EXPLAIN_FILES_COMMAND_ID, 'Explain with OpenCode'],
    ];
    for (const [id, title] of wanted) {
      const command = manifest.contributes.commands.find((c) => c.command === id);
      expect(command?.title, id).toBe(title);
      expect(command?.category, id).toBeUndefined();
    }
    expect(titleOf(ids.ADD_TO_CHAT_COMMAND_ID)).toBe('Add to OpenCode Chat');
  });

  it('puts Add, Explain and Fix in their own editor group, in that order', () => {
    expect(entries('editor/context').map((e) => [e.command, e.group])).toEqual([
      [ids.ADD_SELECTION_TO_CHAT_COMMAND_ID, 'openVsCode@1'],
      [ids.EXPLAIN_SELECTION_COMMAND_ID, 'openVsCode@2'],
      [ids.FIX_SELECTION_COMMAND_ID, 'openVsCode@3'],
    ]);
  });

  it('adds Explain next to Add in the Explorer menu, with no Fix', () => {
    expect(entries('explorer/context').map((e) => [e.command, e.group])).toEqual([
      [ids.ADD_TO_CHAT_COMMAND_ID, '6_copypath@99'],
      [ids.EXPLAIN_FILES_COMMAND_ID, '6_copypath@100'],
    ]);
  });

  it('shows every entry only for documents that live on disk', () => {
    for (const entry of [...entries('editor/context'), ...entries('explorer/context')]) {
      expect(entry.when, entry.command).toBe('resourceScheme == file');
    }
  });

  it('hides from the palette the Explorer commands and leaves the editor ones visible', () => {
    const hidden = entries('commandPalette')
      .filter((e) => e.when === 'false')
      .map((e) => e.command);
    // Rename and Delete (E3) also need a tree row and are hidden the same way.
    expect(hidden.sort()).toEqual(
      [
        ids.ADD_TO_CHAT_COMMAND_ID,
        ids.EXPLAIN_FILES_COMMAND_ID,
        ids.RENAME_SESSION_COMMAND_ID,
        ids.DELETE_SESSION_COMMAND_ID,
      ].sort(),
    );
    const palette = entries('commandPalette').map((e) => e.command);
    for (const id of [
      ids.ADD_SELECTION_TO_CHAT_COMMAND_ID,
      ids.EXPLAIN_SELECTION_COMMAND_ID,
      ids.FIX_SELECTION_COMMAND_ID,
    ]) {
      expect(palette).not.toContain(id);
    }
  });
});

/**
 * Protects the activation of the extension by a restored chat tab (issue #77): without
 * `onWebviewPanel:<viewType>` VS Code never calls the panel serializer after Reload Window (it is
 * not implicit, `vscode-extension` skill section 1) and the tabs come back as blank pages. The data
 * is the REAL package.json. That VS Code does activate the extension for a revived tab is not
 * checked here. VERIFIED in a real window (`npm run test:visual`, full run, Windows 11, VS Code
 * 1.144.0, 29/10/2026): "the serializer restored 4 tabs (log lines \"chat tab restored (pane N)\"),
 * none skipped" after Reload Window. Not isolated: that run does not remove the activation event
 * to see the tabs fail, so it shows the tabs come back, not that this event is what wakes the host.
 */
describe('activation by a restored chat tab (issue #77)', () => {
  it('activates on the chat panel view type and on nothing else', () => {
    expect(manifest.activationEvents).toEqual([`onWebviewPanel:${ids.CHAT_PANEL_VIEW_TYPE}`]);
  });
});

/**
 * Protects the manifest side of the chat location (issue #77, decisions Q2=1, Q3=1, Q9=1 and T1=1
 * of Sergio, 29/10/2026): the setting with its values and default, the two views excluded from each
 * other by `when` on `config.openVsCode.chatLocation`, one welcome of the Sessions view per state
 * with the texts of the approved sketch and commands that exist, the row menu of E3 (Rename,
 * Delete), the palette entries and the title buttons. The data is the REAL package.json. What VS
 * Code DOES with those `when` clauses is not checked here. VERIFIED only for
 * the chat view, by `chatPanel.test.ts` "keeps the tabs open and the side-bar view working when
 * going back to sidebar" (Windows 11, VS Code 1.144.0, 29/10/2026): `Chat view resolved` appears
 * after the setting goes back to `sidebar`. HYPOTHESIS for the Sessions view (that it shows with
 * its welcome in `editor` mode) from this file alone: `test:visual` step 27 looks at it on screen.
 */
describe('chat location (issue #77)', () => {
  const views = manifest.contributes.views[ids.VIEW_CONTAINER_ID] ?? [];
  const commandIds = manifest.contributes.commands.map((c) => c.command);
  const welcome = manifest.contributes.viewsWelcome ?? [];
  const sessionsWelcomes = welcome.filter((w) => w.view === ids.SESSIONS_VIEW_ID);

  it('declares the setting with both values, descriptions, default editor and order 4', () => {
    const setting = manifest.contributes.configuration.properties[ids.CHAT_LOCATION_SETTING];
    expect(ids.CHAT_LOCATION_SETTING).toBe(`${ids.CONFIG_SECTION}.${ids.CHAT_LOCATION_KEY}`);
    expect(setting).toMatchObject({
      type: 'string',
      enum: ['sidebar', 'editor'],
      default: 'editor',
      scope: 'window',
      order: 4,
    });
    expect(setting?.enumDescriptions).toHaveLength(2);
  });

  it('shows the chat view only for sidebar, and the Sessions view for anything else', () => {
    const chat = views.find((v) => v.id === ids.CHAT_VIEW_ID);
    const sessions = views.find((v) => v.id === ids.SESSIONS_VIEW_ID);
    expect(chat?.when).toBe(`config.${ids.CHAT_LOCATION_SETTING} == sidebar`);
    expect(sessions?.when).toBe(`config.${ids.CHAT_LOCATION_SETTING} != sidebar`);
  });

  // E5 (decision Q1=1 of Sergio, 30/10/2026): one rule, "the side bar only if `sidebar` is written".
  // Provenance: the REAL manifest and the real host function, fabricated unknown values; what VS
  // Code does with an unknown value in a `when` is checked by `defaultLocation.test.ts`.
  it('agrees: the host fallback, the manifest default and the view `when` clauses', () => {
    const setting = manifest.contributes.configuration.properties[ids.CHAT_LOCATION_SETTING];
    expect(DEFAULT_CHAT_LOCATION).toBe(setting?.default);
    for (const raw of [undefined, 'panel', 'Editor', 42]) {
      expect(readChatLocation(raw), String(raw)).toBe(setting?.default);
    }
    expect(readChatLocation('sidebar')).toBe('sidebar');
    const clauses = [
      views.find((v) => v.id === ids.CHAT_VIEW_ID)?.when,
      views.find((v) => v.id === ids.SESSIONS_VIEW_ID)?.when,
      (manifest.contributes.menus?.['commandPalette'] ?? []).find(
        (e) => e.command === ids.SEARCH_SESSIONS_COMMAND_ID,
      )?.when,
    ];
    // None of them tests for `editor`: only the literal `sidebar` decides, as in `readChatLocation`.
    for (const clause of clauses) expect(clause).toMatch(/chatLocation (==|!=) sidebar$/);
  });

  // E3 (issue #77, Q9=1 and Q10=1): one welcome per state of `SESSIONS_STATE_CONTEXT_KEY`, with the
  // exact texts of the approved sketch; the line of E1 "To keep the chat here…" is gone. Buttons
  // may point at a built-in command (Open Folder), so only our own ids must be contributed.
  it('gives the Sessions view one welcome per state, with the approved texts and live buttons', () => {
    const byState = (state: string): string =>
      sessionsWelcomes.find((w) => w.when === `${ids.SESSIONS_STATE_CONTEXT_KEY} == ${state}`)
        ?.contents ?? '';
    expect(sessionsWelcomes).toHaveLength(3);
    expect(byState('ready')).toBe(
      'No sessions in this folder yet.\n[New Session](command:openVsCode.newSession)\n[Open Settings](command:openVsCode.openSettings)',
    );
    expect(byState('offline')).toBe(
      'OpenCode is not running for this folder.\n[Open Chat](command:openVsCode.openChat)\n[Show Logs](command:openVsCode.showLogs)',
    );
    expect(byState('noFolder')).toBe(
      'Open a folder to see its OpenCode sessions.\n[Open Folder](command:workbench.action.files.openFolder)',
    );
    for (const entry of sessionsWelcomes) {
      expect(entry.contents).not.toContain('To keep the chat here');
      for (const [, command] of entry.contents.matchAll(/\(command:([\w.]+)\)/g)) {
        if (command?.startsWith('openVsCode.')) expect(commandIds, command).toContain(command);
      }
    }
  });

  // E3: every command of the row menu exists, has a constant, and is offered only on session rows
  // (`viewItem` comes from `contextValue` of `sessionTree.ts`); the palette hides Rename and Delete
  // and shows Search only in `editor` mode, so `sidebar` mode gains no visible command.
  it('offers Rename and Delete on session rows only, and Search only in editor mode', () => {
    const rowMenu = manifest.contributes.menus?.['view/item/context'] ?? [];
    expect(rowMenu.length).toBeGreaterThan(0);
    for (const entry of rowMenu) {
      expect(commandIds, entry.command).toContain(entry.command);
      expect(idValues, entry.command).toContain(entry.command);
      expect(entry.when, entry.command).toContain(`view == ${ids.SESSIONS_VIEW_ID}`);
      expect(entry.when, entry.command).toContain('viewItem =~ /\\bsession\\b/');
    }
    expect(rowMenu.filter((e) => e.group?.startsWith('inline')).map((e) => e.command)).toEqual([
      ids.RENAME_SESSION_COMMAND_ID,
      ids.DELETE_SESSION_COMMAND_ID,
    ]);
    const palette = manifest.contributes.menus?.['commandPalette'] ?? [];
    const whenOf = (id: string): string | undefined => palette.find((e) => e.command === id)?.when;
    expect(whenOf(ids.RENAME_SESSION_COMMAND_ID)).toBe('false');
    expect(whenOf(ids.DELETE_SESSION_COMMAND_ID)).toBe('false');
    expect(whenOf(ids.SEARCH_SESSIONS_COMMAND_ID)).toBe(
      `config.${ids.CHAT_LOCATION_SETTING} != sidebar`,
    );
  });

  it('keeps the open and show-more commands internal and puts Search after New Session', () => {
    expect(commandIds).not.toContain(ids.OPEN_SESSION_COMMAND_ID);
    expect(commandIds).not.toContain(ids.SHOW_MORE_SESSIONS_COMMAND_ID);
    expect(commandIds).not.toContain(ids.TEST_SESSION_ANSWERS_COMMAND_ID);
    const title = (manifest.contributes.menus?.['view/title'] ?? []).filter(
      (e) => e.when === `view == ${ids.SESSIONS_VIEW_ID}`,
    );
    const order = (id: string): string | undefined => title.find((e) => e.command === id)?.group;
    expect(order(ids.NEW_SESSION_COMMAND_ID)).toBe('navigation@1');
    expect(order(ids.SEARCH_SESSIONS_COMMAND_ID)).toBe('navigation@2');
    expect(order(ids.OPEN_SETTINGS_COMMAND_ID)).toBe('navigation@3');
    expect(order(ids.RESTART_SERVER_COMMAND_ID)).toBe('9_server');
  });

  it('points every welcome at a contributed view', () => {
    const viewIds = Object.values(manifest.contributes.views).flatMap((list) =>
      list.map((v) => v.id),
    );
    for (const entry of welcome) expect(viewIds).toContain(entry.view);
  });

  it('puts New Session and Open Settings on the Sessions view title, Restart Server in the overflow', () => {
    const title = (manifest.contributes.menus?.['view/title'] ?? []).filter(
      (e) => e.when === `view == ${ids.SESSIONS_VIEW_ID}`,
    );
    const group = (id: string): string | undefined => title.find((e) => e.command === id)?.group;
    expect(group(ids.NEW_SESSION_COMMAND_ID)).toMatch(/^navigation/);
    expect(group(ids.OPEN_SETTINGS_COMMAND_ID)).toMatch(/^navigation/);
    expect(group(ids.RESTART_SERVER_COMMAND_ID)).not.toMatch(/^navigation/);
    for (const entry of manifest.contributes.menus?.['view/title'] ?? []) {
      expect(commandIds).toContain(entry.command);
    }
  });

  it('gives the title buttons their icons and declares Open Settings', () => {
    const icon = (id: string): string | undefined =>
      manifest.contributes.commands.find((c) => c.command === id)?.icon;
    expect(icon(ids.NEW_SESSION_COMMAND_ID)).toBe('$(add)');
    expect(icon(ids.OPEN_SETTINGS_COMMAND_ID)).toBe('$(gear)');
    expect(ids.OPEN_SETTINGS_COMMAND_ID).toBe('openVsCode.openSettings');
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
