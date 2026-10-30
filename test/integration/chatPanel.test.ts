// Chat in editor tabs suite (issue #77, `openVsCode.chatLocation` = `editor`).
//
// Protects against: the editor-tab surface silently not working in a real VS Code while the unit
// tests (fabricated registries and fake surfaces) pass: the setting not reaching the host, New
// Session not opening one tab per call, Open Chat opening a second tab instead of revealing the
// first, a tab whose document never says `ready` (CSP, bundle path), a closed tab leaving its pane
// behind, and the decision of Sergio (Q4, 29/10/2026) that going back to `sidebar` leaves the tabs
// open and the side-bar view working.
//
// This is the `main` configuration: no folder, so no server and every tab is lazy. Cases that
// need a session (a tab opened for the session of the side bar, the dedupe with a served session)
// are in `fakeServer.test.ts`. What is INSIDE a tab (render, title text, scroll after being hidden)
// is out of reach of the test API and is covered by `test:visual` step 27.
//
// The last group of cases drives the palette and menu commands in `editor` mode with a tab open
// (Focus Prompt to the chat and to the editor, Stop Response, Add to OpenCode Chat from the editor
// and from the Explorer, Manage Saved Permissions) and the `openVsCode.chatFocused` reset. They read
// the extension log, because the test API cannot see inside a tab. With no folder served the two
// Add entries are REFUSED (`OutsideWorkspace`), which still proves the command reached the pane of
// the tab. The chips those entries give with a folder served are NOT observed in `editor` mode:
// the cases of `fakeServer.test.ts` that produce chips run in `sidebar` mode, and C7 of
// `test:visual` step 27 is the tab's own Add selection button, not the menu entry.
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  ADD_SELECTION_TO_CHAT_COMMAND_ID,
  ADD_TO_CHAT_COMMAND_ID,
  FOCUS_PROMPT_COMMAND_ID,
  INJECT_WEBVIEW_MESSAGE_COMMAND_ID,
  MANAGE_PERMISSIONS_COMMAND_ID,
  NEW_SESSION_COMMAND_ID,
  OPEN_CHAT_COMMAND_ID,
  OPEN_SESSION_COMMAND_ID,
  STOP_RESPONSE_COMMAND_ID,
  VIEW_CONTAINER_ID,
} from '../../src/extension/ids';
import { openLogCursor, type LogCursor } from './support/extensionLog';
import {
  chatTabs,
  restoreChatLocation,
  setChatLocation,
  waitForChatTabs,
} from './support/chatLocation';

const EXTENSION_ID = 'sergwei.open-vs-code';
// Our own margins: a document needs well under a second to say `ready`; absence is asserted after
// this pause (vscode-extension skill, section 11).
const READY_WAIT_MS = 8000;
const SETTLE_MS = 1500;

/** Counts the occurrences of `text` in what the log gained since its mark. */
function countOf(log: LogCursor, text: string): number {
  return log.added().split(text).length - 1;
}

/** Waits until `text` appears at least `times` times in the lines added since the mark. */
async function waitForCount(log: LogCursor, text: string, times: number): Promise<void> {
  const deadline = Date.now() + READY_WAIT_MS;
  while (countOf(log, text) < times) {
    if (Date.now() >= deadline) {
      assert.fail(`expected ${String(times)} x ${text}; log:\n${log.added()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Temp folders of the cases that open a file, removed after each case. */
const tempDirs: string[] = [];

/** Writes a four-line file under `os.tmpdir()`, opens it in `column` and returns it. */
async function openTempFile(column?: vscode.ViewColumn): Promise<vscode.TextEditor> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ovsc-chatpanel-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'sample.ts');
  await fs.writeFile(file, 'one\ntwo\nthree\nfour\n');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  return vscode.window.showTextDocument(document, column);
}

/** Pauses for `ms`; used for margins before asserting an absence. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Puts the host in `editor` mode with ONE tab whose document has said `ready`, lets the focus
 * request of the new tab settle, and returns a log cursor marked after all that.
 */
async function openOneTab(): Promise<LogCursor> {
  const log = await openLogCursor();
  await setChatLocation('editor', log);
  await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
  await waitForChatTabs(1);
  await log.waitFor('webview ready', READY_WAIT_MS);
  await pause(SETTLE_MS);
  log.mark();
  return log;
}

describe('chat in editor tabs', function () {
  this.timeout(30_000);

  before(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
  });

  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await restoreChatLocation(await openLogCursor());
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  /**
   * New Session opens one NEW lazy tab per call, each with its own pane and its own document.
   *
   * Protects the setting reaching the host, `ChatPanels.open`, the HTML of a panel under the CSP
   * and the guard of its messages: each tab must say `webview ready`, and no bundle file may be
   * reported missing nor a message rejected. The label is the empty-session title (decision Q6=1).
   */
  it('opens one tab per New Session, each with a ready document', async () => {
    const log = await openLogCursor();
    await setChatLocation('editor', log);
    await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
    await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
    await waitForChatTabs(2);
    await waitForCount(log, 'chat tab created (pane', 2);
    await waitForCount(log, 'webview ready', 2);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    log.assertAbsent('Webview bundle file missing');
    log.assertAbsent('rejected a message from the webview');
    assert.deepStrictEqual(
      chatTabs().map((tab) => tab.label),
      ['Untitled session', 'Untitled session'],
    );
  });

  /**
   * Open Chat with a tab already open reveals it: it never opens a second one.
   *
   * Protects `ChatTabs.commandTarget` and `ChatPanels.reveal` end to end. The absence of a second
   * `created` line is asserted after a pause.
   */
  it('reveals the existing tab on Open Chat instead of opening another', async () => {
    const log = await openLogCursor();
    await setChatLocation('editor', log);
    await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
    await waitForChatTabs(1);
    await vscode.commands.executeCommand(OPEN_CHAT_COMMAND_ID);
    await log.waitFor('chat tab revealed (pane', READY_WAIT_MS);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    assert.strictEqual(countOf(log, 'chat tab created (pane'), 1, `log:\n${log.added()}`);
    assert.strictEqual(chatTabs().length, 1);
  });

  /**
   * Open Chat with NO tab opens one (the last session of the folder, or a lazy one).
   *
   * Protects the rule that a command in `editor` mode never reveals a view that is hidden by its
   * `when`: with nothing open it creates the tab.
   */
  it('opens a tab on Open Chat when none is open', async () => {
    const log = await openLogCursor();
    await setChatLocation('editor', log);
    await vscode.commands.executeCommand(OPEN_CHAT_COMMAND_ID);
    await waitForChatTabs(1);
    await log.waitFor('chat tab created (pane', READY_WAIT_MS);
  });

  /**
   * The internal open command of the Sessions tree (issue #77, E3) in the `main` configuration (no
   * folder, so no server and no session can be bound; the cases with real sessions are in
   * `fakeServer.test.ts`).
   *
   * Protects: the command doing NOTHING in `sidebar` mode (the tree is hidden there), opening a tab
   * in `editor` mode, and a second call adopting the EMPTY tab it just opened instead of opening
   * another (`chat tab revealed`, no second `created`), which is the adoption rule of decision
   * Q3=1; an unusable argument is refused. A margin of 1.5 s precedes each absence.
   */
  it('opens a tab for a session only in editor mode, and adopts the empty tab the second time', async () => {
    const log = await openLogCursor();
    await vscode.commands.executeCommand(OPEN_SESSION_COMMAND_ID, 'ses_none');
    await pause(SETTLE_MS);
    log.assertAbsent('chat tab created (pane');
    assert.strictEqual(chatTabs().length, 0);

    await setChatLocation('editor', log);
    await vscode.commands.executeCommand(OPEN_SESSION_COMMAND_ID, 'ses_none');
    await waitForChatTabs(1);
    await log.waitFor('chat tab created (pane', READY_WAIT_MS);
    await pause(SETTLE_MS);

    log.mark();
    await vscode.commands.executeCommand(OPEN_SESSION_COMMAND_ID, 'ses_none');
    await log.waitFor('chat tab revealed (pane', READY_WAIT_MS);
    await pause(SETTLE_MS);
    log.assertAbsent('chat tab created (pane');
    assert.strictEqual(chatTabs().length, 1);

    await vscode.commands.executeCommand(OPEN_SESSION_COMMAND_ID, { not: 'a session' });
    await log.waitFor(`${OPEN_SESSION_COMMAND_ID} rejected: invalid arguments`, READY_WAIT_MS);
  });

  /**
   * Closing a tab is logged and leaves no tab behind.
   *
   * Protects `onDidDispose` -> `detachPane` (a leaked pane would keep receiving publishes).
   * UNVERIFIED here: that the controller really dropped the pane (no log line says it); the unit
   * tests of `detachPane` cover that side.
   */
  it('logs the close of a tab', async () => {
    const log = await openLogCursor();
    await setChatLocation('editor', log);
    await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
    await waitForChatTabs(1);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await waitForChatTabs(0);
    await log.waitFor('chat tab closed (pane', READY_WAIT_MS);
  });

  /**
   * Going back to `sidebar` WITH tabs open (decision Q4 of Sergio): the tabs stay open, the side-bar
   * view resolves and is routed to (a probe injected in `sidebar` mode reaches the view's pane, not
   * a tab), and nothing closes a tab.
   *
   * Protects `applyLocation`: `attachSidebar` after the switch, no `closed` line, the dedupe not
   * hiding the view. The probe is a `webview.log` message, which the host writes as `[webview] …`.
   * VERIFIED in VS Code 1.144.0 on Windows 11 (29/10/2026) that the view is resolved again after
   * its `when` turns true (`Chat view resolved` appears after the switch back).
   */
  it('keeps the tabs open and the side-bar view working when going back to sidebar', async () => {
    const log = await openLogCursor();
    await setChatLocation('editor', log);
    await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
    await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
    await waitForChatTabs(2);
    await setChatLocation('sidebar', log);
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    await log.waitFor('Chat view resolved', READY_WAIT_MS);
    await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
      type: 'webview.log',
      level: 'info',
      message: 'sidebar probe',
    });
    await log.waitFor('[webview] sidebar probe', READY_WAIT_MS);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    assert.strictEqual(chatTabs().length, 2, 'a tab was closed by the change of location');
    log.assertAbsent('chat tab closed (pane');
  });

  /**
   * The side-bar view that was ALREADY open before the setting went to `editor` and back is
   * answered when `sidebar` returns: the host does not wait for a new `ready` that an alive
   * document never sends again.
   *
   * Guards the outcome of F1 of the host review of #77 (`applyLocation` answering the view with
   * `controller.onPaneReady` when `view.provider.canDeliver`): after the way back the view gets a
   * `webview ready` (a snapshot sent) by ONE of two paths, and the case requires one of them. The
   * replay branch writes its own line, `side-bar view already resolved: replaying ready`; a view
   * that resolves again logs `Chat view resolved` and never that line. The path taken is printed.
   * It does NOT prove the replay branch: the race it covers ("view resolved before the setting
   * change, and not resolved again after it") cannot be forced from the API. VERIFIED in VS Code
   * 1.144.0 on Windows 11 (29/10/2026, `npm run test:integration`) that this order does not occur
   * here: a first try that REQUIRED the replay line timed out, and the log showed `chat location
   * changed to sidebar`, `Chat view resolved` and `webview ready`, i.e. the second path. The
   * branch itself stays UNVERIFIED in a real window; only reading the code and the unit tests of
   * the controller back it.
   */
  it('answers an already-open side-bar view when the setting returns to sidebar', async () => {
    const log = await openLogCursor();
    await vscode.commands.executeCommand(`workbench.view.extension.${VIEW_CONTAINER_ID}`);
    // The view may have been resolved by an earlier case, so no `Chat view resolved` line is
    // waited for: the pause lets a first resolve finish before the mark.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    log.mark();
    await setChatLocation('editor', log);
    await setChatLocation('sidebar', log);
    await waitForCount(log, 'webview ready', 1);
    const added = log.added();
    const replayed = added.includes('side-bar view already resolved: replaying ready');
    const resolved = added.includes('Chat view resolved');
    assert.ok(replayed || resolved, `neither path answered the view; log:\n${added}`);
    console.log(`F1 path taken: ${replayed ? 'replay in applyLocation' : 'view resolved again'}`);
  });

  /**
   * Focus Prompt with a tab open and `to: 'chat'` reaches the tab that exists instead of opening
   * another. The call with no argument is not run by this case.
   *
   * Protects `runInChat` in `editor` mode: the log line `ui command prompt.focus:` (sent or kept,
   * both reach the pane of the tab) and the absence of a second `chat tab created` after a margin.
   * What the keyboard does inside the tab is `test:visual` (step 22 and 27).
   */
  it('Focus Prompt reaches the open tab and opens no other', async () => {
    const log = await openOneTab();
    await vscode.commands.executeCommand(FOCUS_PROMPT_COMMAND_ID, { to: 'chat' });
    await log.waitFor('ui command prompt.focus:', READY_WAIT_MS);
    await pause(SETTLE_MS);
    log.assertAbsent('chat tab created (pane');
    assert.strictEqual(chatTabs().length, 1);
  });

  /**
   * Focus Prompt with `to: 'editor'` and a chat tab open moves the focus to the last text editor
   * and sends nothing to the chat.
   *
   * Protects the `showTextDocument` branch of the command (issue #77: the active group may be the
   * chat's own). The file is opened BEFORE the tab so that the tab does not take its column.
   * Reads `activeTextEditor` and the absence of `ui command prompt.focus`. The fixture is a temp
   * file; the keyboard focus itself (DOM) is `test:visual`'s.
   */
  it('Focus Prompt to the editor focuses the last text editor and sends nothing to the chat', async () => {
    const log = await openLogCursor();
    await setChatLocation('editor', log);
    const editor = await openTempFile(vscode.ViewColumn.One);
    await vscode.commands.executeCommand(NEW_SESSION_COMMAND_ID);
    await waitForChatTabs(1);
    await log.waitFor('webview ready', READY_WAIT_MS);
    await pause(SETTLE_MS);
    log.mark();
    await vscode.commands.executeCommand(FOCUS_PROMPT_COMMAND_ID, { to: 'editor' });
    const deadline = Date.now() + READY_WAIT_MS;
    while (
      vscode.window.activeTextEditor?.document.uri.toString() !== editor.document.uri.toString()
    ) {
      if (Date.now() >= deadline) assert.fail('the last text editor did not become the active one');
      await pause(100);
    }
    await pause(SETTLE_MS);
    log.assertAbsent('ui command prompt.focus');
    assert.strictEqual(chatTabs().length, 1);
  });

  /**
   * Stop Response reaches the open tab (nothing to stop with no server, but the command is
   * relayed) and opens no tab of its own.
   *
   * Protects `runInChat('session.stop')` in `editor` mode, which must not create a tab when none
   * is open either; the second half runs it with none open.
   */
  it('Stop Response is relayed to the open tab and never opens one', async () => {
    const log = await openOneTab();
    await vscode.commands.executeCommand(STOP_RESPONSE_COMMAND_ID);
    await log.waitFor('ui command session.stop:', READY_WAIT_MS);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await waitForChatTabs(0);
    await log.waitFor('chat tab closed (pane', READY_WAIT_MS);
    log.mark();
    await vscode.commands.executeCommand(STOP_RESPONSE_COMMAND_ID);
    await pause(SETTLE_MS);
    log.assertAbsent('chat tab created (pane');
    assert.strictEqual(chatTabs().length, 0);
  });

  /**
   * Add to OpenCode Chat from the editor reaches the pane of the open tab.
   *
   * Protects `targetPane` for the editor entries in `editor` mode. The file is a temp file outside
   * any folder and no folder is served, so the host REFUSES it: `context action add: refused
   * (OutsideWorkspace)` is the evidence that the pane received the call, and no second tab was
   * created. The argument is built by hand (the right-click is not drivable here, as in #36). The
   * chip a served folder would produce is not observed in this suite.
   */
  it('Add to OpenCode Chat from the editor reaches the open tab', async () => {
    const editor = await openTempFile(vscode.ViewColumn.One);
    const log = await openOneTab();
    await vscode.commands.executeCommand(ADD_SELECTION_TO_CHAT_COMMAND_ID, editor.document.uri);
    await log.waitFor('context action add: refused (OutsideWorkspace)', READY_WAIT_MS);
    await pause(SETTLE_MS);
    log.assertAbsent('chat tab created (pane');
    assert.strictEqual(chatTabs().length, 1);
  });

  /**
   * Add to OpenCode Chat from the Explorer reaches the pane of the open tab.
   *
   * Same as the editor case with the `(clicked, selected)` pair the Explorer passes, built by hand.
   * The answer is the refusal of the pane (`request menu-N failed: OutsideWorkspace`), because no
   * folder is served.
   */
  it('Add to OpenCode Chat from the Explorer reaches the open tab', async () => {
    const editor = await openTempFile(vscode.ViewColumn.One);
    const log = await openOneTab();
    const uri = editor.document.uri;
    await vscode.commands.executeCommand(ADD_TO_CHAT_COMMAND_ID, uri, [uri]);
    await log.waitFor('failed: OutsideWorkspace', READY_WAIT_MS);
    assert.ok(log.added().includes('request menu-'), `log:\n${log.added()}`);
    await pause(SETTLE_MS);
    log.assertAbsent('chat tab created (pane');
    assert.strictEqual(chatTabs().length, 1);
  });

  /**
   * Manage Saved Permissions with a tab open reaches it and fails nothing; with none open it opens
   * a tab and shows it.
   *
   * Protects `targetPane(false)` + `revealChat` of the command. With no server the pane only
   * answers with a `ServerUnavailable` notice, which the test API cannot read, so what is
   * asserted is the absence of failures and of a second tab. The second half settles the
   * statement of the command's own comment that the tab opened just to host the picker is
   * shown: the new tab must be the active one.
   */
  it('Manage Saved Permissions uses the open tab, or opens and shows one', async () => {
    const log = await openOneTab();
    await vscode.commands.executeCommand(MANAGE_PERMISSIONS_COMMAND_ID);
    await pause(SETTLE_MS);
    log.assertAbsent('chat tab created (pane');
    log.assertAbsent('managing saved permissions failed');
    log.assertAbsent('dropped a');
    assert.strictEqual(chatTabs().length, 1);

    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await waitForChatTabs(0);
    log.mark();
    await vscode.commands.executeCommand(MANAGE_PERMISSIONS_COMMAND_ID);
    await waitForChatTabs(1);
    await log.waitFor('chat tab created (pane', READY_WAIT_MS);
    await pause(SETTLE_MS);
    assert.ok(
      chatTabs().every((tab) => tab.isActive),
      'the tab opened for the picker is not the active one',
    );
    log.assertAbsent('managing saved permissions failed');
  });

  /**
   * `openVsCode.chatFocused` goes back to false when the focused tab is HIDDEN, and when it is
   * CLOSED.
   *
   * Protects `blurHiddenSurfaces` and `detachPane`. The context key cannot be read with the public
   * API (no `getContext` command is exposed), so the case reads the variable that feeds it through
   * the Focus Prompt toggle: with no argument it goes to the editor while the host believes the
   * chat has the focus (no `ui command prompt.focus`) and to the chat when it does not (the line
   * appears). `chat.focusChanged` is injected, as a real focus would send it. LIMIT: a real blur
   * from the iframe would also reset it, so the hide half cannot tell `blurHiddenSurfaces` from a
   * blur the page sent itself; in the close half `detachPane` is almost certainly what resets it
   * (HYPOTHESIS: a blur from a page being disposed was not ruled out).
   */
  it('resets the chat focus when the tab is hidden and when it is closed', async () => {
    const focus = async (focused: boolean): Promise<void> => {
      await vscode.commands.executeCommand(INJECT_WEBVIEW_MESSAGE_COMMAND_ID, {
        type: 'chat.focusChanged',
        focused,
      });
    };
    const log = await openOneTab();
    await focus(true);
    await vscode.commands.executeCommand(FOCUS_PROMPT_COMMAND_ID);
    await pause(SETTLE_MS);
    log.assertAbsent('ui command prompt.focus');

    // Hide: another editor takes the tab's group.
    await focus(true);
    const group = chatTabs()[0]?.group.viewColumn;
    await openTempFile(group);
    await pause(SETTLE_MS);
    log.mark();
    await vscode.commands.executeCommand(FOCUS_PROMPT_COMMAND_ID);
    await log.waitFor('ui command prompt.focus:', READY_WAIT_MS);

    // Close: the focus is true again, then the tab goes away.
    await focus(true);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await waitForChatTabs(0);
    await log.waitFor('chat tab closed (pane', READY_WAIT_MS);
    log.mark();
    await vscode.commands.executeCommand(FOCUS_PROMPT_COMMAND_ID);
    await log.waitFor('chat tab created (pane', READY_WAIT_MS);
  });
});
