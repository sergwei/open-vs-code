// Pure logic for connecting to an opencode server that someone else runs (issue #11): parsing and
// normalising `openVsCode.serverUrl`, the SecretStorage key of its password, the "target" the
// `ServerManager` follows, and the user-facing text of each way the connection can fail. No
// `vscode` import and no I/O, so Vitest drives all of it. The VS Code wiring (setting, commands,
// SecretStorage) lives in `serverCredentials.ts`; the state machine in `serverManager.ts`.

import { ServerInfoError } from './opencodeServer';
import type { UnavailableReason } from './serverManager';

/**
 * Prefix of the SecretStorage key that holds the password of an external server. The full key is
 * this prefix plus the URL origin, so a password is only ever sent to the origin it was stored for.
 */
export const SERVER_PASSWORD_KEY_PREFIX = 'openVsCode.serverPassword:';

/**
 * Hosts `openVsCode.serverUrl` may name. Decision of Sergio (2026-10-22, Engram
 * `E1-external-server/decisions/loopback-only`): only loopback, so the Basic credential never
 * leaves the machine and the paths of the local workspace match the server's (VS Code Remote runs
 * the extension host on the remote machine, so it is loopback there too). `localhost` is allowed
 * here, unlike `LOOPBACK_HOSTS` in `opencodeServer.ts`, because the user types this one. A URL
 * parser lower-cases the host and keeps IPv6 in brackets.
 */
const ALLOWED_HOSTS: readonly string[] = ['127.0.0.1', '[::1]', 'localhost'];

/** What the extension follows: launch its own server, or connect to one that is already running. */
export type ServerTarget =
  | { kind: 'spawn' }
  | { kind: 'external'; url: string; password: string | undefined }
  | { kind: 'external-invalid'; message: string };

/** Result of {@link parseServerUrl}. */
export type ParsedServerUrl =
  { kind: 'none' } | { kind: 'ok'; origin: string } | { kind: 'invalid'; message: string };

/**
 * Interprets the value of `openVsCode.serverUrl`.
 *
 * Empty or whitespace means "no external server" (`none`). Otherwise it must be a bare origin:
 * `http:` or `https:`, a loopback host (`127.0.0.1`, `[::1]`, `localhost`), no `user:pass@` (the
 * credential lives only in SecretStorage, and the URL ends up in the log), no path other than `/`,
 * no query and no fragment. `ok` carries `new URL(raw).origin`, so `HTTP://LOCALHOST:4096/`
 * becomes `http://localhost:4096`. The `invalid` messages are fixed texts that never echo the
 * input: they reach the webview and a notification, and a user could have typed a credential.
 * VERIFIED by unit tests (synthetic inputs); how a real server answers on `localhost` in Windows
 * (which resolves to `::1` first, opencode listens on `127.0.0.1`) is UNVERIFIED: check with
 * `openVsCode.serverUrl` set to `http://localhost:<port>`.
 */
export function parseServerUrl(raw: string): ParsedServerUrl {
  const text = raw.trim();
  if (text === '') return { kind: 'none' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return {
      kind: 'invalid',
      message: 'openVsCode.serverUrl is not a valid URL; write it like http://127.0.0.1:4096.',
    };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      kind: 'invalid',
      message: 'openVsCode.serverUrl must start with http:// or https://.',
    };
  }
  if (url.username !== '' || url.password !== '') {
    return {
      kind: 'invalid',
      message:
        'openVsCode.serverUrl must not contain a user name or password; run "OpenCode: Set Server Password" instead.',
    };
  }
  if (!ALLOWED_HOSTS.includes(url.hostname)) {
    return {
      kind: 'invalid',
      message:
        'openVsCode.serverUrl must point to this machine (127.0.0.1, [::1] or localhost); other hosts are not supported.',
    };
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return {
      kind: 'invalid',
      message: 'openVsCode.serverUrl must be just the address, without a path, query or fragment.',
    };
  }
  return { kind: 'ok', origin: url.origin };
}

/** SecretStorage key of the password for the server at `origin` (see {@link SERVER_PASSWORD_KEY_PREFIX}). */
export function serverPasswordKey(origin: string): string {
  return `${SERVER_PASSWORD_KEY_PREFIX}${origin}`;
}

/**
 * Origins whose password the user asked to forget, until the next password is set for them.
 *
 * Why it exists (issue #11, decision of Sergio, Engram `E1-external-server/decisions/forget-race`):
 * right after a Set, a Forget could be undone by VS Code. VERIFIED with `--log trace` in the
 * integration suite (VS Code 1.143.0, Windows 11, 22/10/2026, two runs): with the Forget 200 ms
 * after the Set, the renderer logs `deleted secret for key` and, 4 ms later, a
 * `Notifying change in value for secret` that no `storing encrypted secret` or `deleting secret`
 * of ours explains; the `secrets.onDidChange` it raises makes the extension read again, and that
 * read decrypts the value that had just been deleted (`Password found`) and the extension
 * reconnected with it. The two reads made while the delete was still in flight (ours) correctly
 * saw nothing. With 8 s between Set and Forget (one run) the secret stayed deleted. HYPOTHESIS
 * for the mechanism: a late echo of the earlier write through the application storage of the
 * workbench puts the stale value back; the storage layer is not traced, so confirming it needs
 * VS Code's storage logs. Either way the extension cannot order it away: the delete had finished
 * before the bad read started.
 *
 * So the host remembers the Forget and enforces it: {@link ForgottenPasswords.resolve} drops a
 * password read for a forgotten origin and tells the caller the stored copy is stale so it can
 * delete it again. {@link ForgottenPasswords.allow} (a new Set from our command, or from the
 * test-only one) lifts it. State lives for the session only: after a reload a password that was
 * restored is used again. UNVERIFIED: a password stored from ANOTHER window (not through our
 * command) for a forgotten origin is ignored until this window stores one; check with two windows.
 */
export class ForgottenPasswords {
  private readonly origins = new Set<string>();

  /** Marks `origin` as forgotten: any password read for it is ignored from now on. */
  forget(origin: string): void {
    this.origins.add(origin);
  }

  /** Lifts the mark of `origin`: the user has just stored a new password for it. */
  allow(origin: string): void {
    this.origins.delete(origin);
  }

  /**
   * Decides what to use of `stored`, the password SecretStorage returned for `origin`.
   *
   * Returns `password` (`undefined` when there is none, it is empty, or the origin is forgotten)
   * and `stale`, true only when the origin is forgotten yet a value came back, i.e. the copy that
   * should be deleted again.
   */
  resolve(
    origin: string,
    stored: string | undefined,
  ): { password: string | undefined; stale: boolean } {
    const present = stored !== undefined && stored !== '';
    if (this.origins.has(origin)) return { password: undefined, stale: present };
    return { password: present ? stored : undefined, stale: false };
  }
}

/**
 * Whether two targets are the same connection. A different password counts as different, so a
 * new password reconnects; two `external-invalid` with the same message are the same.
 */
export function sameTarget(a: ServerTarget, b: ServerTarget): boolean {
  if (a.kind === 'spawn') return b.kind === 'spawn';
  if (a.kind === 'external') {
    return b.kind === 'external' && a.url === b.url && a.password === b.password;
  }
  return b.kind === 'external-invalid' && a.message === b.message;
}

/** Why a connection to an external server failed, in the manager's vocabulary. */
export interface ExternalFailure {
  reason: Extract<UnavailableReason, 'unreachable' | 'unauthorized' | 'unsupported-version'>;
  message: string;
}

/** Shared text of "the other end is not an opencode v2 server". */
const NOT_OPENCODE_V2 =
  'The server at openVsCode.serverUrl did not answer GET /api/info like opencode v2.';

/** A code worth showing the user (`ECONNREFUSED`, `ENOTFOUND`...); anything odd is dropped. */
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,39}$/;

/**
 * Finds a short error code in `error` or its `cause` chain: a string `code` that looks like an
 * errno (`ECONNREFUSED`) or `timeout` for a `TimeoutError`. `undefined` when there is none.
 */
function transportCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    if ('code' in current && typeof current.code === 'string' && SAFE_CODE.test(current.code)) {
      return current.code;
    }
    if ('name' in current && current.name === 'TimeoutError') return 'timeout';
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

/**
 * Turns a failure of `GET /api/info` against an external server into a reason and a text for the
 * user.
 *
 * The text goes to the webview banner (the manager copies `message` into the connection state),
 * so it carries NO URL, port, password or raw cause: only a short errno-like code for a transport
 * failure. The full cause and the URL are for the log (see {@link describeFailureCause}).
 * Mapping: transport -> `unreachable`; 401 -> `unauthorized`; 404 or a body that is not opencode's
 * (`malformed`) -> `unsupported-version` ("did not answer like opencode v2"); another HTTP status
 * -> `unreachable` with the status; anything that is not a {@link ServerInfoError} -> a generic
 * `unreachable`. VERIFIED by unit tests (synthetic errors). VERIFIED against a real opencode
 * 2.0.32 for the 401 only: the external case of the opt-in `realOpencode.test.ts` saw the
 * `unauthorized` state after a wrong password. The refused connection was seen in a real VS Code
 * 1.143.0 on Windows 11 (22/10/2026) in `externalServer.test.ts` ("reports a stopped server as
 * unreachable..."), against the synthetic fixture after it exited, so the TCP refusal and the
 * extension host's `fetch` were real: log line "could not connect to the external server at ...:
 * GET /api/info failed: fetch failed <- fetch failed <- connect ECONNREFUSED 127.0.0.1:<port>
 * [ECONNREFUSED]" and state "server not available (unreachable)". NOT observed against a real
 * opencode: the refused connection and the timeout (UNVERIFIED).
 */
export function describeExternalFailure(error: unknown): ExternalFailure {
  if (!(error instanceof ServerInfoError)) {
    return { reason: 'unreachable', message: 'Could not connect to the external opencode server.' };
  }
  switch (error.kind) {
    case 'unauthorized':
      return {
        reason: 'unauthorized',
        message:
          'The external opencode server rejected the password. Run "OpenCode: Set Server Password" with the right one.',
      };
    case 'transport': {
      const code = transportCode(error);
      const detail = code === undefined ? '' : ` (${code})`;
      return {
        reason: 'unreachable',
        message: `Could not reach the external opencode server${detail}. Start it, then retry.`,
      };
    }
    case 'malformed':
      return { reason: 'unsupported-version', message: NOT_OPENCODE_V2 };
    case 'http-status':
      if (error.status === 404) return { reason: 'unsupported-version', message: NOT_OPENCODE_V2 };
      return {
        reason: 'unreachable',
        message: `The external opencode server answered HTTP ${String(error.status)} to GET /api/info.`,
      };
  }
}

/**
 * The text for the LOG about a failed connection: the error message and the messages of its
 * `cause` chain, which is where `fetch` puts `ECONNREFUSED` and friends. Never reaches the
 * webview. The messages of {@link ServerInfoError} do not contain the password.
 */
export function describeFailureCause(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    if (current instanceof Error) {
      const code =
        'code' in current && typeof current.code === 'string' ? ` [${current.code}]` : '';
      parts.push(`${current.message}${code}`);
      current = current.cause;
    } else {
      parts.push(typeof current === 'string' ? current : typeof current);
      break;
    }
  }
  return parts.join(' <- ');
}

/** Label of a button on the failure notification; the lifecycle maps each to a command. */
export type FailureAction =
  'Set Password' | 'Open Settings' | 'Retry' | 'Restart Server' | 'Show Logs';

/**
 * Buttons for the error notification of an `unavailable` reason.
 *
 * `unauthorized` needs the password (Set Password); `invalid-url` needs the setting (Open
 * Settings); `unreachable` is "start the server and try again" (Retry) or fix the address (Open
 * Settings). Everything else keeps what the notification always had: Restart Server and Show
 * Logs. Show Logs is always last. VERIFIED by unit tests; how the notification looks is
 * UNVERIFIED (no test API for it).
 */
export function failureActions(reason: UnavailableReason): FailureAction[] {
  switch (reason) {
    case 'unauthorized':
      return ['Set Password', 'Show Logs'];
    case 'invalid-url':
      return ['Open Settings', 'Show Logs'];
    case 'unreachable':
      return ['Retry', 'Open Settings', 'Show Logs'];
    default:
      return ['Restart Server', 'Show Logs'];
  }
}
