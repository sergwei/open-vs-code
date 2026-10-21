// Creates the `@opencode/client` instance the host uses to talk to the server it spawned
// (issue #9). Architecture rule 1: this module, like every importer of the client, lives in
// `src/extension/**`; the webview never sees the URL, the port or the password.
//
// The client package is ESM-only (exports only the `import` condition) and the host is bundled
// to CommonJS by esbuild. VERIFIED (2026-10-20, Windows 11, esbuild 0.28.2): a bundle of
// `OpenCode.make(...)` with `--platform=node --format=cjs --target=node22` has no external
// imports (63 587 bytes, no `effect` and no `@opencode/*` left to require) and ran under Node 24.

import { OpenCode } from '@opencode/client';
import type {
  FormListInput,
  FormListOutput,
  MessageListInput,
  PermissionReplyInput,
  PermissionRequestListInput,
  PermissionRequestListOutput,
  PermissionSavedInfo,
  PermissionSavedListInput,
  PermissionSavedRemoveInput,
  SessionActive,
  SessionCreateInput,
  SessionFormCancelInput,
  SessionFormReplyInput,
  SessionGetInput,
  SessionInboxUser,
  SessionInfo,
  SessionInterruptInput,
  SessionInterruptResponse,
  SessionListInput,
  SessionMessagesResponse,
  SessionPromptInput,
  SessionRemoveInput,
  SessionsResponse,
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
    prompt(input: SessionPromptInput): Promise<SessionInboxUser>;
    /**
     * `POST /api/session/:id/interrupt` (issue #16). Unlike `list`/`message.list`, the answer is
     * NOT wrapped in `{data}`: `{ interrupted }` comes bare (read in the client chunk and in
     * `packages/protocol/src/groups/session.ts@843a6c51`). VERIFIED against a real opencode 2.0.32
     * (Windows 11, 20/10/2026, opt-in `realOpencode.test.ts`): `OpenCode.log` showed `abort
     * requested for ses_... (interrupted: true)` followed by `turn finished: interrupted`, so the
     * bare body was read correctly. POSIX UNVERIFIED.
     */
    interrupt(input: SessionInterruptInput): Promise<SessionInterruptResponse>;
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
