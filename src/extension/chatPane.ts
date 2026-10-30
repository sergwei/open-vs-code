// The per-surface half of the chat host (issue #77, phase 1 of `E9-chat-editor-tabs`): everything
// `ChatController` used to keep as "THE webview" and now keeps once per chat surface. Pure: no
// `vscode` import, so a unit test can build as many panes as it likes.
//
// A pane is one place the chat is drawn (today the side-bar view; from phase 2 one editor tab per
// session). What belongs to the LOCATION (server, client, stream, catalog, pending requests,
// resolutions, attachment whitelists, translator) stays in `ChatController`; what belongs to ONE
// surface lives here: which session it shows, whether a post can reach it, the chips and
// `ui.command`s waiting for a document that is not there, the focus request it may have missed, the
// generation of its snapshots, its file search and session-list cursor, and its own "Changed files"
// and revert state.

import type { HostToWebview, Sender, UiCommand } from '../shared/protocol';
import type { ServerLog } from './opencodeServer';
import type { SessionBrowser } from './sessionBrowser';
import { createSessionBrowser } from './sessionBrowser';
import type { SessionDiffs } from './sessionDiff';
import type { SessionReverts } from './sessionRevert';

/** Where `ui.focus` points: a pending request of any session. */
export type FocusTarget = Extract<HostToWebview, { type: 'ui.focus' }>['target'];

/**
 * How long a focus request or a kept `ui.command` waits for a webview that was still loading. Our
 * own choice: long enough for a document to load and send `ready`, short enough that a late `ready`
 * (the user hid and showed the view minutes later) does not steal the focus to a request long gone.
 */
export const FOCUS_REQUEST_TTL_MS = 10_000;

/** Most messages of "Add to OpenCode Chat" kept for a hidden chat (issue #30); our choice, a few clicks' worth. */
export const MAX_KEPT_MENU_MESSAGES = 64;

/**
 * Most `prompt.compose` a hidden pane keeps (issue #36). Our choice: each is a deliberate menu
 * click, so a handful is plenty, and the oldest goes first like the chips of
 * {@link MAX_KEPT_MENU_MESSAGES}.
 */
export const MAX_KEPT_COMPOSES = 8;

/** The `prompt.compose` variant of {@link HostToWebview}. */
export type ComposeMessage = Extract<HostToWebview, { type: 'prompt.compose' }>;

/**
 * What the VS Code side gives the host for one chat surface. `post` may drop what it cannot
 * deliver (document not ready, surface hidden); `canDeliver` says whether it would deliver now,
 * and its absence means "always" (tests that do not model a hidden view).
 */
export interface PaneSurface {
  post: Sender<HostToWebview>;
  canDeliver?: () => boolean;
  /**
   * True for the surface that gets the remembered session when a server for a NEW folder starts
   * (the side-bar view); absent for the others (tabs). With no primary surface, the one attached
   * first gets it.
   */
  primary?: boolean;
  /**
   * True for a chat TAB (issue #77 E4): its dock shows only the requests of its own session and of
   * that session's subagent lineage, and the rest are notified natively. Absent means every
   * request of the location, which is what the side-bar view shows (decision Q3=1) and what every
   * test with a fabricated surface keeps getting.
   */
  ownRequestsOnly?: boolean;
}

/** Who a host message is for; see {@link routeOf}. */
export type MessageRoute = 'session' | 'all' | 'origin' | 'request';

/**
 * Says where a host-to-webview message must go when there is more than one pane.
 *
 * `session`: the content of one session (`message.*`, `part.*`, `session.diff`, `session.revert`),
 * only for the panes showing it. `origin`: an answer to something one pane asked (`request.result`,
 * `sessions.page`, `attachments.picked`, `files.found`, `ui.focus`, `ui.command`,
 * `prompt.compose` (issue #36: the prompt of one menu action goes to the one pane it was aimed
 * at, or two panes would send it twice), `snapshot`,
 * `setup.binary` of issue #86: the answer of the file dialog one pane opened), only for that pane; broadcasting a `request.result` would close a request with the same id in another
 * pane (ids are a per-document counter). `request` (issue #77 E4): a NEW `permission.asked` or
 * `form.asked`, for the panes that display it (`ChatController.displays`: a tab shows its own
 * session's requests and its subagents', the side-bar view shows every one). Their `*.resolved`
 * stay `all`: the store ignores a resolution it does not know, so sending it to a pane that never
 * got the ask is harmless and a pane that changed session meanwhile still clears the card.
 * Everything else (`connection.state`, `catalog`, `session.upserted|removed|status`,
 * `permission.resolved`, `form.resolved`, `notice`) belongs to the location and goes to all of
 * them. A `notice` caused by one pane's request is posted to that pane directly and never goes
 * through here.
 */
export function routeOf(message: HostToWebview): MessageRoute {
  switch (message.type) {
    case 'message.upserted':
    case 'message.removed':
    case 'part.upserted':
    case 'part.delta':
    case 'session.diff':
    case 'session.revert':
      return 'session';
    case 'request.result':
    case 'sessions.page':
    case 'attachments.picked':
    case 'files.found':
    case 'ui.focus':
    case 'ui.command':
    case 'prompt.compose':
    case 'snapshot':
    case 'setup.binary':
      return 'origin';
    case 'connection.state':
    case 'catalog':
    case 'session.upserted':
    case 'session.removed':
    case 'session.status':
    case 'permission.resolved':
    case 'form.resolved':
    case 'notice':
      return 'all';
    case 'permission.asked':
    case 'form.asked':
      return 'request';
    default:
      // A new HostToWebview variant makes this line a type error until it is classified above,
      // instead of being broadcast to every pane by default.
      return message satisfies never;
  }
}

/**
 * What a pane needs the controller to build for it: its own "Changed files" holder and revert
 * holder, which read the controller's client and folder but this pane's open session and post.
 */
export type PaneHolders = (pane: ChatPane) => { diffs: SessionDiffs; reverts: SessionReverts };

/**
 * State and delivery rules of ONE chat surface.
 *
 * Why a class apart from the controller: the controller used to hold one `open`, one
 * `focusRequested`, one queue of chips, one `generation`, and ONE `SessionDiffs`/`SessionReverts`,
 * all of which assume a single webview. Two tabs need two of each, and sharing them would make a
 * snapshot of one tab stale-check against the other, or a chip land in the wrong tab. The holders
 * are built by the controller (they need its client) through {@link PaneHolders}, with `open:
 * () => pane.sessionID` and `post: pane.post`, so `sessionDiff.ts` and `sessionRevert.ts` did not
 * change.
 * VERIFIED (Windows 11, 25/10/2026, fake surface) by the `chatPane.test.ts` checks "keeps a
 * command once, sends it after ready and says it posted" and "forgets the oldest beyond the cap",
 * and by the `chatController.panes.test.ts` check "binds the new session to its pane only". Not
 * observed with two panes in a real VS Code at the level of this class; the integration case "opens
 * the diff beside a chat tab, and serves prompts and session.open from tabs" (Windows 11, 29/10/2026)
 * ran two tab panes end to end.
 */
export class ChatPane {
  /** The session this surface shows, or `undefined` (nothing open: the next prompt creates one). */
  sessionID: string | undefined;
  /** A focus request the webview may have missed, repeated after its next snapshot. */
  focusRequested: { target: FocusTarget; at: number } | undefined;
  /**
   * Bumped by every resync that targets this pane and when the server goes away: a snapshot built
   * under an older value is stale and is not published.
   */
  generation = 0;
  /**
   * Counts the `session.revert.staged` / `.cleared` events and the revert calls the host made for
   * this pane's session. A snapshot compares it with the value at its start: if it moved, the REST
   * row is older than what the host already knows about the revert (issue #32).
   */
  revertEvents = 0;
  /** The file search in flight for this pane; a newer one or `stopStream` aborts it. */
  fileSearch: AbortController | undefined;
  /** Paging state of this pane's session list; owns the cursor, which never leaves the host. */
  readonly browser: SessionBrowser = createSessionBrowser();
  /** The "Changed files" list of this pane's session and the originals of its diffs (issue #31). */
  readonly diffs: SessionDiffs;
  /** The prepared revert of this pane's session and the files behind its banner (issue #32). */
  readonly reverts: SessionReverts;
  /** Releases the `onRenewed` subscription the controller made on {@link diffs}. */
  releaseDiffs: (() => void) | undefined;

  /**
   * Answers of "Add to OpenCode Chat" that the webview could not receive because the surface was
   * hidden (a hidden view loses its document; the chips live only in the webview). Published after
   * the snapshot of the next `ready`; capped at {@link MAX_KEPT_MENU_MESSAGES}.
   */
  private undeliveredMenu: HostToWebview[] = [];
  /** `ui.command`s the webview could not receive yet; see {@link runUiCommand}. */
  private keptUiCommands: Array<{ command: UiCommand; at: number }> = [];
  /** `prompt.compose`s the webview could not receive yet; see {@link compose}. */
  private keptComposes: Array<{ message: ComposeMessage; at: number }> = [];

  /**
   * `id` is unique among the panes of one controller. `build` makes the holders once the pane
   * exists, because they close over it.
   */
  constructor(
    readonly id: number,
    private readonly surface: PaneSurface,
    private readonly log: ServerLog,
    build: PaneHolders,
  ) {
    const holders = build(this);
    this.diffs = holders.diffs;
    this.reverts = holders.reverts;
  }

  /** True when the surface asked to receive the remembered session first ({@link PaneSurface.primary}). */
  get primary(): boolean {
    return this.surface.primary === true;
  }

  /** True when the surface shows only its own session's requests ({@link PaneSurface.ownRequestsOnly}). */
  get ownRequestsOnly(): boolean {
    return this.surface.ownRequestsOnly === true;
  }

  /** True while a {@link post} would reach the webview (`surface.canDeliver`, absent meaning always). */
  deliverable(): boolean {
    return this.surface.canDeliver === undefined || this.surface.canDeliver();
  }

  /** Posts, never throwing: a failing sender must not break the stream or a request. */
  post(message: HostToWebview): void {
    try {
      this.surface.post(message);
    } catch (error) {
      this.log.error(`posting to the webview failed: ${String(error)}`);
    }
  }

  /**
   * Posts a message of "Add to OpenCode Chat": delivered now if the webview can take it, else kept
   * for {@link flushUndeliveredMenu} (called when the next document says `ready`).
   */
  postOrKeep(message: HostToWebview): void {
    if (this.deliverable()) {
      this.post(message);
      return;
    }
    this.undeliveredMenu.push(message);
    if (this.undeliveredMenu.length > MAX_KEPT_MENU_MESSAGES) this.undeliveredMenu.shift();
  }

  /**
   * Publishes what {@link postOrKeep} kept, after the snapshot of a `ready`. It goes through
   * {@link postOrKeep} again: the view may have been hidden during the `await` of the resync, and
   * a plain `post` would then drop the chips for good (review-2 of 23/10/2026, W7). VERIFIED by
   * the unit test "keeps the Explorer command chips when the chat hides again before they go out"
   * (fake view, 23/10/2026, Windows 11). Not observed in a real VS Code: the window is narrow.
   */
  flushUndeliveredMenu(): void {
    const kept = this.undeliveredMenu;
    this.undeliveredMenu = [];
    for (const message of kept) this.postOrKeep(message);
  }

  /**
   * Relays a palette or keyboard command to the webview as `ui.command` (issue #35), which runs
   * the same code as the matching button. With the webview able to take it, it goes out now and
   * is NOT kept: unlike a focus request, repeating it after the next `ready` would run New
   * Session or Stop a second time. With the view hidden (revealing it loads a new document and a
   * message sent before its `ready` is dropped) it is kept at most once per command, and
   * {@link flushUiCommands} sends it after the snapshot, the catalog and any `ui.focus` of that
   * `ready`, as long as it is younger than {@link FOCUS_REQUEST_TTL_MS}. A command already waiting
   * is not queued twice.
   * Moved here from `ChatController` in phase 1 of #77. VERIFIED against a real VS Code (Windows
   * 11, 25/10/2026) on the code BEFORE the move: with the chat hidden by Ctrl+B the log shows `ui
   * command prompt.focus: kept for the next ready`, then `webview ready`, then `ui command
   * prompt.focus: sent after ready`, and the `test:visual` step 22 check "and a real keystroke
   * typed right after lands in the prompt box" passed. On the moved code (this tree) step 22 was
   * seen failing in 2 of 3 `test:visual` runs; the cause is UNVERIFIED (not explained by the diff
   * when read; a baseline of the pre-move commit run several times would tell). Not observed: a
   * kept `session.new` or `session.stop` in a real window (unit tests only).
   */
  runUiCommand(command: UiCommand): void {
    if (this.deliverable()) {
      this.log.info(`ui command ${command}: sent`);
      this.post({ type: 'ui.command', command });
      return;
    }
    this.log.info(`ui command ${command}: kept for the next ready`);
    this.keepUiCommand(command, Date.now());
  }

  /**
   * Queues `command` unless it already waits; `at` is when the user asked, not when it was re-kept.
   * No size cap: one entry per {@link UiCommand} at most, so the queue is bounded by the union.
   */
  private keepUiCommand(command: UiCommand, at: number): void {
    if (this.keptUiCommands.some((kept) => kept.command === command)) return;
    this.keptUiCommands.push({ command, at });
  }

  /**
   * Sends what {@link runUiCommand} kept, in the order asked, dropping what is older than
   * {@link FOCUS_REQUEST_TTL_MS}. Each goes through the same gate as a fresh command, so a view
   * hidden again during the resync keeps it instead of losing it (same trap as
   * {@link flushUndeliveredMenu}). Returns `true` when at least one went out: the caller then asks
   * the VS Code side to hand the keyboard to the iframe again.
   * HYPOTHESIS (see `registerChat`): the focus given by the reveal landed on an iframe whose
   * document did not exist yet. Seen once in a `test:visual` step 22 run WITHOUT the second focus
   * (the new document had `hasFocus()` false); that run is not a check, and the run without
   * `focusView` was not repeated to prove it is needed.
   */
  flushUiCommands(): boolean {
    const kept = this.keptUiCommands;
    this.keptUiCommands = [];
    const now = Date.now();
    let posted = false;
    for (const { command, at } of kept) {
      if (now - at > FOCUS_REQUEST_TTL_MS) continue;
      if (this.deliverable()) {
        this.log.info(`ui command ${command}: sent after ready`);
        this.post({ type: 'ui.command', command });
        posted = true;
      } else {
        this.keepUiCommand(command, at);
      }
    }
    return posted;
  }

  /**
   * Hands the webview a prompt written by the host (`prompt.compose`, issue #36). With the webview
   * able to take it, it goes out now. With the view hidden (revealing it loads a new document and a
   * message sent before its `ready` is dropped) it is kept, at most {@link MAX_KEPT_COMPOSES} (the
   * oldest is forgotten first), and {@link flushComposes} sends it after the snapshot of the next
   * `ready`. Unlike a `ui.command`, equal ones are NOT merged: two Explain clicks on different
   * files are two prompts.
   * VERIFIED in a real hidden view (`npm run test:visual`, Windows 11, VS Code 1.144.0,
   * 29/10/2026, full run): with the Explorer shown in the side bar, the chat view hidden, "C5 the
   * chat that was hidden when the command ran sends "Explain what @… and @… do."" and "C5 the sent
   * message carries two chips, one per file", read in the DOM of the new document. Not observed:
   * the TTL expiring in a real window (only the unit tests run it).
   */
  compose(message: ComposeMessage): void {
    if (this.deliverable()) {
      this.log.info(`compose: sent (send=${String(message.send)})`);
      this.post(message);
      return;
    }
    this.log.info('compose: kept for the next ready');
    this.keepCompose(message, Date.now());
  }

  /** Queues `message`; `at` is when the user asked, not when it was re-kept. Drops the oldest beyond the cap. */
  private keepCompose(message: ComposeMessage, at: number): void {
    this.keptComposes.push({ message, at });
    if (this.keptComposes.length > MAX_KEPT_COMPOSES) this.keptComposes.shift();
  }

  /**
   * Sends what {@link compose} kept, in the order asked, after the snapshot of a `ready`. One older
   * than {@link FOCUS_REQUEST_TTL_MS} is NOT dropped: a menu click must not vanish, but sending it
   * minutes later would surprise (a turn that spends quota with nobody watching), so it is posted
   * with `send` false and ends up in the prompt box, followed by a `ComposeExpired` info notice
   * ("The prompt waited too long: it is in the box", decision W1=1 of Sergio, 29/10/2026) so the
   * text does not appear unexplained; one that was already a draft (`send` false) gets no such
   * notice. Each goes through the same gate as a fresh one: a view hidden again during the resync
   * keeps it, with its original time. Returns `true` when at least one went out, so the caller can
   * hand the keyboard to the iframe again.
   * VERIFIED by `chatPane.test.ts` "delivers a compose older than the TTL as a draft instead of
   * dropping it, with a notice" and "adds no expiry notice to an old compose that was already a draft" (fake
   * surface and fake clock, 29/10/2026). Not observed: the TTL expiring in a real window.
   */
  flushComposes(): boolean {
    const kept = this.keptComposes;
    this.keptComposes = [];
    const now = Date.now();
    let posted = false;
    for (const { message, at } of kept) {
      if (!this.deliverable()) {
        this.keepCompose(message, at);
        continue;
      }
      const stale = now - at > FOCUS_REQUEST_TTL_MS;
      this.log.info(`compose: sent after ready (send=${String(message.send && !stale)})`);
      this.post(stale ? { ...message, send: false } : message);
      if (stale && message.send) {
        this.post({
          type: 'notice',
          level: 'info',
          error: {
            code: 'ComposeExpired',
            message: 'The prompt waited too long: it is in the box',
          },
        });
      }
      posted = true;
    }
    return posted;
  }
}
