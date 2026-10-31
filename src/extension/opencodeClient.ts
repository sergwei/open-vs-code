// Creates the `@opencode/client` instance the host uses to talk to the server it spawned
// or, with `openVsCode.serverUrl` set, to the external one it connected to (issues #9, #11). Architecture rule 1: this module, like every importer of the client, lives in
// `src/extension/**`; the webview never sees the URL, the port or the password.
//
// The client package is ESM-only (exports only the `import` condition) and the host is bundled
// to CommonJS by esbuild. VERIFIED (2026-10-20, Windows 11, esbuild 0.28.2): a bundle of
// `OpenCode.make(...)` with `--platform=node --format=cjs --target=node22` has no external
// imports (63 587 bytes, no `effect` and no `@opencode/*` left to require) and ran under Node 24.

import { OpenCode } from '@opencode/client';
import type {
  AgentListInput,
  AgentListOutput,
  CommandListInput,
  CommandListOutput,
  FileDiffInfo,
  FileFindInput,
  FileFindOutput,
  FormListInput,
  FormListOutput,
  MessageListInput,
  ModelDefaultInput,
  ModelDefaultOutput,
  ModelListInput,
  ModelListOutput,
  PermissionReplyInput,
  PermissionRequestListInput,
  PermissionRequestListOutput,
  PermissionSavedInfo,
  PermissionSavedListInput,
  PermissionSavedRemoveInput,
  ProviderListInput,
  ProviderListOutput,
  SessionActive,
  SessionCommandInput,
  SessionCompactInput,
  SessionCreateInput,
  SessionDiffInput,
  SessionFormCancelInput,
  SessionForkInput,
  SessionFormReplyInput,
  SessionGetInput,
  SessionInboxCompaction,
  SessionInboxUser,
  SessionInfo,
  SessionInterruptInput,
  SessionInterruptResponse,
  SessionListInput,
  SessionMessageGetInput,
  SessionMessageInfo,
  SessionMessagesResponse,
  SessionPromptInput,
  SessionRemoveInput,
  SessionRevert,
  SessionRevertClearInput,
  SessionRevertCommitInput,
  SessionRevertStageInput,
  SessionsResponse,
  SessionSwitchAgentInput,
  SessionSwitchModelInput,
  SessionUpdateInput,
  V2Event,
} from '@opencode/client';
import { basicAuthHeader } from './opencodeServer';
import type { RunningServerInfo } from './serverManager';

/**
 * The slice of the client the chat controller uses. Injecting this narrow shape (instead of the
 * whole client) lets unit tests supply a small fake; the real client satisfies it structurally,
 * which the return type of {@link createOpencodeClient} enforces at compile time.
 */
export interface ChatApi {
  event: {
    subscribe(options?: {
      readonly signal?: AbortSignal;
      readonly onActivity?: () => void;
    }): AsyncIterable<V2Event>;
  };
  session: {
    list(input?: SessionListInput): Promise<SessionsResponse>;
    active(): Promise<{ [sessionID: string]: SessionActive }>;
    create(input?: SessionCreateInput): Promise<SessionInfo>;
    get(input: SessionGetInput): Promise<SessionInfo>;
    /**
     * `PATCH /api/session/:id` (issue #20): 204, empty body. A non-blank `title` publishes
     * `session.renamed` and bumps `time.updated`; a BLANK one does not clear it, it makes the
     * server run the LLM title generator, so the controller never sends one. An unknown session
     * throws `SessionNotFoundError`. VERIFIED by the planner spike against opencode 2.0.32
     * (Windows 11, 21/10/2026, node + `@opencode/client`).
     */
    update(input: SessionUpdateInput): Promise<void>;
    /**
     * `DELETE /api/session/:id` (issue #20): 204. Deletes the session AND its child sessions,
     * interrupting it first if it is busy (no `SessionBusyError`); publishes
     * `session.execution.interrupted`, a `session.deleted` per child and then the parent's, all
     * BEFORE the HTTP answer. VERIFIED by the planner spike (busy session with one child),
     * Windows 11, opencode 2.0.32, 21/10/2026.
     */
    remove(input: SessionRemoveInput): Promise<void>;
    /**
     * `POST /api/session/:id/fork` (issue #21): copies the settled history into a NEW session and
     * returns it. `before` is a message id: the copy stops right before it (a user message gives
     * "ask again from here"); without it the whole history is copied. The fork is a ROOT session
     * (no `parentID`, `fork.sessionID` = the original) and the only event is the durable
     * `session.forked`: there is NO `session.created`. A session with no messages and no `before`
     * throws `InvalidRequestError`; an unknown `before` throws `MessageNotFoundError`. VERIFIED by
     * the planner spike against opencode 2.0.32 (Windows 11, 21/10/2026).
     */
    fork(input: SessionForkInput): Promise<SessionInfo>;
    prompt(input: SessionPromptInput): Promise<SessionInboxUser>;
    /**
     * `POST /api/session/:id/command` (issue #33): runs a slash command. 204, empty body: unlike
     * `prompt` it returns nothing, and the turn arrives through the stream like any other (a
     * command ends in `session.prompt` with the template expanded, `core/src/session/command.ts`
     * at 843a6c51, read). `text` holds only the arguments. `delivery` defaults to `steer` here too,
     * so the controller always sends `queue`. An unknown name throws `CommandNotFoundError` (404,
     * `{ _tag, command, message }`), an unknown session `SessionNotFoundError` and a failing
     * template (a `!` shell line, MCP) `CommandExecutionError` (500). Read in the client types of
     * 2.0.32 and `protocol/src/groups/session.ts`. VERIFIED against a real opencode 2.0.32 (Windows
     * 11, 28/10/2026) only for the unknown name: the case "lists the project commands and refuses an
     * unknown one with CommandNotFoundError" of `realOpencode.test.ts` passed. The 204 and the
     * `CommandExecutionError` of a real command are UNVERIFIED (running one spends quota).
     */
    command(input: SessionCommandInput): Promise<void>;
    /**
     * `POST /api/session/:id/model` (issue #23): 204, empty body. The server DOES NOT validate: an
     * unknown model answers 204 and is stored; the next turn then fails BEFORE delivering the prompt
     * (`session.execution.failed`, `provider.no-route`), and that prompt stays in the inbox and is
     * redelivered with the next good run. So the host checks its catalog first. It deduplicates
     * (the same model again publishes nothing); otherwise it publishes the durable
     * `session.model.selected`, adds a `model-switched` message and bumps `time.updated`. The
     * model's `id` is the CATALOG id (`ModelInfo.id`). VERIFIED by the planner spike against
     * opencode 2.0.32 (Windows 11, 21/10/2026, node + `@opencode/client`).
     */
    switchModel(input: SessionSwitchModelInput): Promise<void>;
    /**
     * `POST /api/session/:id/agent` (issue #24): 204. Same lack of validation as `switchModel`
     * (an unknown agent fails the next turn with `Agent not found`), but it does NOT deduplicate:
     * it publishes `session.agent.selected` every time, and switching to or from `plan` queues a
     * synthetic reminder. So the host only calls it when the agent really changes. VERIFIED by the
     * same spike.
     */
    switchAgent(input: SessionSwitchAgentInput): Promise<void>;
    /**
     * `POST /api/session/:id/interrupt` (issue #16). Unlike `list`/`message.list`, the answer is
     * NOT wrapped in `{data}`: `{ interrupted }` comes bare (read in the client chunk and in
     * `packages/protocol/src/groups/session.ts@843a6c51`). VERIFIED against a real opencode 2.0.32
     * (Windows 11, 20/10/2026, opt-in `realOpencode.test.ts`): `OpenCode.log` showed `abort
     * requested for ses_... (interrupted: true)` followed by `turn finished: interrupted`, so the
     * bare body was read correctly. POSIX UNVERIFIED.
     */
    interrupt(input: SessionInterruptInput): Promise<SessionInterruptResponse>;
    /**
     * `POST /api/session/:id/compact` (issue #125): admits a manual compaction into the inbox and
     * answers with that item (its `id` is the `inputID` of the `session.compaction.*` events and
     * the id of the REST `compaction` message). The summary is made afterwards, so the progress
     * comes through the stream. Read in `client.d.ts` and `types.d.ts` of 2.0.32 and in the tag's
     * `solid-compaction.test.ts`; UNVERIFIED against a running server except through the
     * synthetic fixture (the opt-in `realOpencode.test.ts` does not call it).
     */
    compact(input: SessionCompactInput): Promise<SessionInboxCompaction>;
    /**
     * `GET /api/session/:id/diff?from=&to=&context=` (issue #31): the files changed in a RANGE OF
     * TURNS, not "the session". The answer is the bare `FileDiffInfo[]` (the client unwraps
     * `{data}`: `client.d.ts` of 2.0.32 types it `Promise<FileDiffInfo[]>`). Without `from` it is
     * the turn of the LAST user message; `from` is a user message whose turn is diffed and `to` a
     * later user message that extends the range; a non-user id is `InvalidRequestError`. Without
     * `context` every patch is the COMPLETE file (the host rebuilds the original from it); with
     * `context: 0` only the changed lines. A binary has `patch: ""` and zero counts. Paths are
     * relative to the git worktree root, not to the served folder. Outside a git repository the
     * answer is `[]`. READ in `packages/core/src/session/diff.ts` and `vcs/git.ts` at 843a6c51 and
     * in the client types; HYPOTHESIS for every behaviour listed except these, VERIFIED against a
     * real opencode 2.0.32 (Windows 11, 23/10/2026, no model turn) by the case "reads user messages
     * and diffs a session that changed nothing" of `realOpencode.test.ts`: a session with no changes
     * answers `[]` with and without `context` (even with no user message at all), an unknown or
     * inbox-only `from` throws `MessageNotFoundError` and an unknown session `SessionNotFoundError`.
     * No turn that edited files was observed.
     */
    diff(input: SessionDiffInput): Promise<FileDiffInfo[]>;
    /**
     * The revert of a session (issue #32). `stage` is `POST /api/session/:id/revert/stage` with
     * `{ messageID, files? }`: it moves the history boundary AND, unless `files: false`, puts back
     * on disk the files the agent touched after that message, answering the `SessionRevert`
     * (`messageID`, `files` = the diff the move made, empty outside a git repository). `files` is a
     * BOOLEAN in v2, not a list of paths as the issue text said (that is v1). Staging again moves
     * the boundary. `clear` is `DELETE /api/session/:id/revert` (rewrites the files from the saved
     * original and wakes the session, so a call right after it can be `SessionBusyError`) and
     * `commit` is `POST /api/session/:id/revert/commit` (deletes the history from the boundary,
     * the boundary message included; touches no file; irreversible). Both do nothing, with no
     * event, when no revert is staged. All three throw `SessionBusyError` while a turn runs;
     * `stage` also `MessageNotFoundError` and `UnknownError` (a failed snapshot).
     * Read in `protocol/src/groups/session.ts` and `core/src/session/revert.ts` @843a6c51 and in
     * the client types; observed against a real opencode 2.0.32 (Windows 11, 23/10/2026, a `shell`
     * message, no model) by the case "stages, clears and commits a revert on a shell message" of
     * `realOpencode.test.ts`, whose files list was always empty (no git repository snapshot).
     */
    revert: {
      stage(input: SessionRevertStageInput): Promise<SessionRevert>;
      clear(input: SessionRevertClearInput): Promise<void>;
      commit(input: SessionRevertCommitInput): Promise<void>;
    };
    /**
     * `GET /api/session/:sid/message/:mid` (issue #32): one message, to check that a revert starts
     * at a USER message before anything is rewritten on disk. An unknown id throws
     * `MessageNotFoundError`. Only the `type` is used here.
     */
    message: { get(input: SessionMessageGetInput): Promise<SessionMessageInfo> };
    form: {
      /** `POST /api/session/:sid/form/:fid/reply` (issue #44): 204, empty body. */
      reply(input: SessionFormReplyInput): Promise<void>;
      /**
       * `DELETE /api/session/:sid/form/:fid?message=` (issue #44): 204. Cancel is a DELETE, not a
       * POST (client chunk `shared-events-hqeq47hr.js` L584-590 of 2.0.32, read).
       */
      cancel(input: SessionFormCancelInput): Promise<void>;
    };
  };
  message: { list(input: MessageListInput): Promise<SessionMessagesResponse> };
  /**
   * Catalog reads (issues #23/#24). All three answers are `{ location, data }` and the client does
   * NOT unwrap them (like `form.list`); in particular `model.default()` is `{ data: ModelInfo | null }`,
   * not a bare model. `model.list` only holds ENABLED models of AVAILABLE providers. VERIFIED by
   * the planner spike against opencode 2.0.32 (Windows 11, 21/10/2026).
   */
  model: {
    list(input?: ModelListInput): Promise<ModelListOutput>;
    default(input?: ModelDefaultInput): Promise<ModelDefaultOutput>;
  };
  provider: { list(input?: ProviderListInput): Promise<ProviderListOutput> };
  agent: { list(input?: AgentListInput): Promise<AgentListOutput> };
  /**
   * `GET /api/command` (issue #33): the slash commands (built-in `init` and `review`, the project's
   * and the user's command files, one per MCP prompt). The answer is `{ location, data }` and the
   * client does NOT unwrap it, like the other catalog reads. Each entry is only `{ name,
   * description? }`. VERIFIED against a real opencode 2.0.32 (Windows 11, 28/10/2026): the case
   * "lists the project commands and refuses an unknown one with CommandNotFoundError" of
   * `realOpencode.test.ts` passed, so `init`, `review` and a `.opencode/command/hello.md` file are
   * listed with their descriptions. GOTCHA from the same run (it printed `command.list: first
   * answer empty: true`): the FIRST call on a server that has just started answers `data: []`
   * while the location loads, and the next one the full list, so an empty list is not proof that
   * the server has no commands.
   */
  command: { list(input?: CommandListInput): Promise<CommandListOutput> };
  /**
   * File search of the @ mentions (issue #28). `find` is `GET /api/fs/find` (the `/find/file` of
   * the issue text is v1); the answer is `{location, data}` UNWRAPPED, `data` holding
   * `{path, type}` entries. `signal` aborts the request (a newer keystroke supersedes it).
   * VERIFIED by the planner spike against a real opencode 2.0.32 (Windows 11, 22/10/2026, `fetch`
   * with Basic auth and `x-opencode-directory`): the match is a case-insensitive fuzzy one
   * (`promptinput` found `webview-ui/src/chat/PromptInput.tsx`), git-ignored paths are left out,
   * an EMPTY query answers `data: []`, files come with `/` but directories end in `\` on Windows
   * (mixed separators), and the first call took 1313 ms (ripgrep scan) and the next ones 2-9 ms.
   * POSIX (another search backend) UNVERIFIED: the host normalises every path it gets.
   */
  file: {
    find(
      input: FileFindInput,
      options?: { readonly signal?: AbortSignal },
    ): Promise<FileFindOutput>;
  };
  /** Pending requests of the whole location: both lists return `{location, data}` UNWRAPPED. */
  form: { list(input?: FormListInput): Promise<FormListOutput> };
  permission: {
    /** `POST /api/session/:sid/permission/:rid/reply` (issue #18): 204, empty body. */
    reply(input: PermissionReplyInput): Promise<void>;
    request: {
      /** `GET /api/permission/request`: every pending request of the location, all sessions. */
      list(input?: PermissionRequestListInput): Promise<PermissionRequestListOutput>;
    };
    saved: {
      /** `GET /api/permission/saved`: the rules "Always" stored for the project (`.data` unwrapped). */
      list(input?: PermissionSavedListInput): Promise<PermissionSavedInfo[]>;
      /** `DELETE /api/permission/saved/:id`: revokes one stored rule. */
      remove(input: PermissionSavedRemoveInput): Promise<void>;
    };
  };
}

/**
 * Builds the client for a running server: Basic auth (fixed user `opencode`) and the workspace
 * folder in `x-opencode-directory`, URL-encoded because the server decodes it with
 * `decodeURIComponent` (`location.ts:71-79@v2.0.32`, read).
 *
 * VERIFIED against a real opencode 2.0.32 (Windows 11, 2026-10-20, planner spike): that header
 * alone made `POST /api/session` create the session in the folder, and the encoded Windows path
 * (`C:\...`) was accepted. POSIX paths are UNVERIFIED. The password only travels in the header.
 */
export function createOpencodeClient(server: RunningServerInfo): ChatApi {
  return OpenCode.make({
    baseUrl: server.url,
    headers: {
      Authorization: basicAuthHeader(server.password),
      'x-opencode-directory': encodeURIComponent(server.folder),
    },
  });
}
