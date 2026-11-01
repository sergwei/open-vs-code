// The sign-in flows of the OpenCode Settings tab (issue #128, E10): connect a provider with an API
// key, an OAuth login (`auto` or `code`) or an external method, and remove a credential. Pure host
// code: every dialog goes through the injected {@link AuthUi}, so the flow is tested without VS Code
// (`providerAuthUi.ts` is the `vscode` implementation).
//
// Security (architecture rule 1, plan section 3): the API key and the OAuth code live in local
// variables of this module for the length of one call. They come from a native masked InputBox
// (`askSecret`/`askCode`), are never part of a message to the webview, never stored and never
// logged; neither is any server `message`. The log carries the integration id, the kind of method,
// the host of a sign-in link and an error CODE.

import type { ChatApi } from './opencodeClient';
import type { ServerLog } from './opencodeServer';
import type { FieldRow, IntegrationRow, MethodRow } from './serverConfig';
import { MAX_TEXT, firstLine } from './serverConfig';
import type { ErrorSecrets } from './wireMapping';
import { sanitizeText, toErrorInfo } from './wireMapping';
import type { AuthAttemptView } from '../shared/settingsProtocol';

/** The client methods the flows use: the writes of {@link ChatApi}. */
export type ProviderAuthApi = {
  integration: Pick<ChatApi['integration'], 'connect' | 'oauth'>;
  credential: ChatApi['credential'];
};

/** What the progress notification shows while an OAuth login waits. */
export interface AuthProgressView {
  title: string;
  /** The server's instructions, already stripped of `[ ] ( )` and cut (see {@link cleanInstructions}). */
  instructions: string;
  /** The device code found in the instructions, if any (for "Copy code"). */
  code?: string;
}

/** The notification handle: `dispose` closes it, `update` changes its text. */
export interface AuthProgressHandle {
  update(view: AuthProgressView): void;
  dispose(): void;
}

/**
 * The dialogs the flows need. Implemented by `providerAuthUi.ts` (native VS Code) and by fakes in
 * tests. None of them may log what it receives or returns.
 */
export interface AuthUi {
  /**
   * A native masked input for the API key; `undefined` when the user dismissed it. `signal`
   * aborts when the attempt is cancelled elsewhere (the card), and the box must close then.
   */
  askSecret(prompt: {
    title: string;
    placeholder?: string;
    signal: AbortSignal;
  }): Promise<string | undefined>;
  /** A native input for an OAuth code; `signal` aborts when the attempt is cancelled elsewhere. */
  askCode(prompt: {
    title: string;
    placeholder?: string;
    signal: AbortSignal;
  }): Promise<string | undefined>;
  /** Opens `url` in the browser; false when it could not. Only ever called with an allowed URL. */
  openExternal(url: string): Promise<boolean>;
  /** Shows the cancellable notification; `onCancel` is its Cancel button. */
  progress(view: AuthProgressView, onCancel: () => void): AuthProgressHandle;
  /** A native modal; true when the user chose `action`. */
  confirm(prompt: { message: string; action: string }): Promise<boolean>;
  /** Puts `text` on the clipboard (the device code of "Copy code"). */
  copy(text: string): Promise<void>;
}

/** How a connect ended. `message` is safe to show: scrubbed, one line, without the key. */
export type AuthResult =
  | { kind: 'connected' }
  | { kind: 'cancelled' }
  | { kind: 'expired' }
  | { kind: 'failed'; message: string }
  | { kind: 'unsupported'; message: string };

/** How a removal ended. */
export type RemoveResult =
  { kind: 'removed' } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

/** Options that tests and the fake/visual mode change. */
export interface ProviderAuthOptions {
  /** Poll period of an `auto` attempt (ms). Upstream polls every 1000 ms (`connect/controller.ts`). */
  pollMs?: number;
  /**
   * Also open `http:` links whose host is loopback. OFF by default: only `https:` is opened. The
   * fake server's approval page is `http://127.0.0.1:<port>/…`, so the test launch turns it on.
   */
  allowLoopbackHttp?: boolean;
  /** Clock, for the attempt's own expiry. */
  now?: () => number;
}

/** How long past `expires` an attempt is still asked about, before it is declared expired (ms). */
const EXPIRY_GRACE_MS = 5000;
/** Consecutive failed `status` reads tolerated before the login is declared failed. */
const MAX_STATUS_ERRORS = 3;
/** Longest instructions text kept. */
const MAX_INSTRUCTIONS = 500;
const DEVICE_CODE = /code:\s*([A-Z0-9-]{4,})/i;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The message for a method the tab cannot drive: upstream's terminal login covers it. */
export function unsupportedMessage(name: string): string {
  return `Use \`opencode auth login\` in a terminal for ${name}`;
}

/**
 * The server's login instructions made safe to show in a notification and as plain text: control
 * characters become spaces, `[ ] ( )` are removed (VS Code links `[x](command:…)` in notification
 * text: `vscode-extension` section 7) and the result is cut to {@link MAX_INSTRUCTIONS}.
 */
export function cleanInstructions(text: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed.
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[[\]()]/g, '');
  const trimmed = flat.replace(/\s+/g, ' ').trim();
  return trimmed.length <= MAX_INSTRUCTIONS
    ? trimmed
    : `${trimmed.slice(0, MAX_INSTRUCTIONS - 1)}…`;
}

/** The device code in the instructions (`Enter code: ABCD-1234`), or `undefined`. */
export function extractDeviceCode(instructions: string): string | undefined {
  return DEVICE_CODE.exec(instructions)?.[1];
}

/** The method numbered `index`; `undefined` when there is none (an integration with no method has none). */
function resolveMethod(row: IntegrationRow, index: number): MethodRow | undefined {
  return row.methods.find((method) => method.index === index);
}

/**
 * Walks the form of a method and builds the `answer` to send. A field is ACTIVE when every `when`
 * rule holds against the values chosen so far (earlier fields; the value is the user's or the
 * default); an inactive field is skipped, even if `required`. An active field takes the user's
 * value or its default; a value outside `options` is refused; an active `required` field with no
 * value is refused. Blank optional fields are left out. Answers for keys that are not in the form
 * are never copied (the controller already drops them; this is the second wall).
 */
export function buildAnswer(
  fields: readonly FieldRow[],
  given: Readonly<Record<string, string>>,
): { ok: true; answer: Record<string, string> } | { ok: false; message: string } {
  const values = new Map<string, string>();
  const answer: Record<string, string> = {};
  for (const field of fields) {
    const active = (field.when ?? []).every((rule) => {
      const actual = values.get(rule.key);
      return rule.op === 'eq' ? actual === rule.value : actual !== rule.value;
    });
    if (!active) continue;
    const label = field.title ?? field.key;
    const own = Object.hasOwn(given, field.key) ? given[field.key] : undefined;
    const raw = own !== undefined && own.trim() !== '' ? own.trim() : field.default;
    if (raw === undefined || raw === '') {
      if (field.required) return { ok: false, message: `${label} is required` };
      continue;
    }
    if (field.options !== undefined && !field.options.some((option) => option.value === raw)) {
      return { ok: false, message: `${label} is not one of the available options` };
    }
    values.set(field.key, raw);
    answer[field.key] = raw;
  }
  return { ok: true, answer };
}

/** The sign-in in progress: identity of the object is the "generation" every await compares. */
interface ActiveAttempt {
  integrationID: string;
  view: AuthAttemptView;
  attemptID?: string;
  abort: AbortController;
  handle?: AuthProgressHandle;
  api: ProviderAuthApi;
}

/**
 * The login flows. One at a time: a second `connect` while one is open answers `failed`.
 *
 * Generation guard: each connect creates an {@link ActiveAttempt}; `cancel` (the notification's
 * button and the card's, possibly both), a new `attach`/`detach` and the end of the flow replace
 * `active`, and every `await` of a flow compares it with its own object, so a late answer of a
 * cancelled flow neither publishes nor polls on. `cancel` is idempotent: with nothing active it
 * does nothing, and a server 404 on the cancel (the attempt is already gone) is ignored.
 *
 * VERIFIED by `providerAuth.test.ts` with fake clients and a fake UI (fabricated data: it proves
 * the flow's logic, not that a real provider's login completes). UNVERIFIED against a real server
 * from this module: the opt-in `real-opencode` suite covers key connect/remove and device-code
 * start/cancel with the full client ("lists integrations without secrets, connects a fake key and
 * removes it" and "starts a device login, reads an https link and cancels it"), and the
 * `fake-server` suite drives this class against the synthetic server with pre-answered dialogs
 * ("completes an OAuth login whose link the test browser approves"). `test:visual` (Windows 11,
 * VS Code 1.144.0, 1/11/2026, synthetic server) adds the native widgets of the flows driven from
 * the real tab, see the header of `createProviderAuthUi`. UNVERIFIED, with no date: a REAL
 * provider's login completing (only its start and cancel run against a real opencode, in the
 * opt-in suite), and the real flow's timing.
 */
export class ProviderAuth {
  private api: ProviderAuthApi | undefined;
  private secrets: ErrorSecrets = {};
  private active: ActiveAttempt | undefined;
  private readonly listeners = new Set<(attempt: AuthAttemptView | undefined) => void>();
  private readonly pollMs: number;
  private readonly allowLoopbackHttp: boolean;
  private readonly now: () => number;

  constructor(
    private readonly log: ServerLog,
    private readonly ui: AuthUi,
    options: ProviderAuthOptions = {},
  ) {
    this.pollMs = options.pollMs ?? 1000;
    this.allowLoopbackHttp = options.allowLoopbackHttp ?? false;
    this.now = options.now ?? Date.now;
  }

  /** Starts using the client of a running server; a flow of the previous one is cancelled. */
  attach(api: ProviderAuthApi, secrets: ErrorSecrets = {}): void {
    void this.cancel();
    this.api = api;
    this.secrets = secrets;
  }

  /** The server is gone: cancels the flow in progress (without calling the dead server). */
  detach(): void {
    const attempt = this.active;
    this.api = undefined;
    this.secrets = {};
    if (attempt === undefined) return;
    this.finish(attempt);
  }

  /** The sign-in in progress as the webview sees it, or `undefined`. */
  attempt(): AuthAttemptView | undefined {
    return this.active === undefined ? undefined : { ...this.active.view };
  }

  /** Calls `listener` whenever {@link attempt} changes; returns the function that stops it. */
  onDidChangeAttempt(listener: (attempt: AuthAttemptView | undefined) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Connects `row` with its method number `methodIndex` and the form `answer` (no key in it).
   *
   * Picks the method (an integration with no method is refused as unknown: the tab offers nothing
   * for it), refuses an unknown index or
   * a method whose form the tab cannot render (`unsupported`: "Use `opencode auth login` in a
   * terminal for <name>"), walks the form with {@link buildAnswer}, then runs the flow of the
   * method type. Resolves with how it ended; it does not throw. The caller turns the result into a
   * notice.
   */
  async connect(
    row: IntegrationRow,
    methodIndex: number,
    answer: Readonly<Record<string, string>>,
  ): Promise<AuthResult> {
    const api = this.api;
    if (api === undefined) return { kind: 'failed', message: 'The opencode server is not running' };
    if (this.active !== undefined) {
      return { kind: 'failed', message: 'Another sign-in is already in progress' };
    }
    const method = resolveMethod(row, methodIndex);
    if (method === undefined) return { kind: 'failed', message: `Unknown method for ${row.name}` };
    if (!method.supported) return { kind: 'unsupported', message: unsupportedMessage(row.name) };
    const built = buildAnswer(method.fields, answer);
    if (!built.ok) return { kind: 'failed', message: built.message };

    const attempt: ActiveAttempt = {
      integrationID: row.id,
      view: { integrationID: row.id, phase: 'starting' },
      abort: new AbortController(),
      api,
    };
    this.active = attempt;
    this.publish();
    try {
      if (method.type === 'key') return await this.connectKey(attempt, row, built.answer);
      if (method.type === 'external')
        return await this.connectExternal(attempt, row, method, built.answer);
      return await this.connectOauth(attempt, row, method, built.answer);
    } finally {
      this.finish(attempt);
    }
  }

  /**
   * Cancels the sign-in in progress, from either button. With nothing in progress it does nothing,
   * so asking twice is harmless; the server's cancel is best effort and its 404 (already gone) is
   * ignored. The flow that was waiting resolves `cancelled`.
   */
  async cancel(): Promise<void> {
    const attempt = this.active;
    if (attempt === undefined) return;
    this.finish(attempt);
    if (attempt.attemptID !== undefined) await this.serverCancel(attempt, attempt.attemptID);
  }

  /** Copies the device code of the sign-in in progress, if it is for `integrationID` and has one. */
  async copyCode(integrationID: string): Promise<boolean> {
    const view = this.active?.view;
    if (view?.integrationID !== integrationID || view.code === undefined) return false;
    await this.ui.copy(view.code);
    return true;
  }

  /**
   * Removes one stored credential of `row` after a native confirmation. `credentialID` must be one
   * of `row.connections`: anything else is refused without calling the server (a broken webview
   * must not delete credentials it does not know). Never throws.
   */
  async disconnect(row: IntegrationRow, credentialID: string): Promise<RemoveResult> {
    const api = this.api;
    if (api === undefined) return { kind: 'failed', message: 'The opencode server is not running' };
    const connection = row.connections.find(
      (candidate) => candidate.kind === 'credential' && candidate.id === credentialID,
    );
    if (connection?.kind !== 'credential') {
      return { kind: 'failed', message: `Unknown credential for ${row.name}` };
    }
    const confirmed = await this.ui.confirm({
      message: `Remove the "${connection.label}" credential of ${row.name}? opencode stores it for all your projects.`,
      action: 'Remove',
    });
    if (!confirmed) return { kind: 'cancelled' };
    try {
      await api.credential.remove({ credentialID });
    } catch (error) {
      this.log.warn(`provider remove failed: ${row.id}: ${this.codeOf(error)}`);
      return { kind: 'failed', message: this.messageOf(error) };
    }
    this.log.info(`provider credential removed: ${row.id}`);
    return { kind: 'removed' };
  }

  /** API key flow: native masked input, then `connect.key`. Blank keys never reach the server. */
  private async connectKey(
    attempt: ActiveAttempt,
    row: IntegrationRow,
    answer: Record<string, string>,
  ): Promise<AuthResult> {
    const secret = await this.ui.askSecret({
      title: `API key for ${row.name}`,
      placeholder: 'Paste the API key',
      signal: attempt.abort.signal,
    });
    if (this.active !== attempt || secret === undefined) return { kind: 'cancelled' };
    const key = secret.trim();
    if (key === '') return { kind: 'failed', message: 'The API key is empty' };
    try {
      await attempt.api.integration.connect.key({
        integrationID: row.id,
        key,
        ...(Object.keys(answer).length > 0 ? { answer } : {}),
      });
    } catch (error) {
      return this.failure(row, 'key', error, [key]);
    }
    this.log.info(`provider connected: ${row.id} (key)`);
    return { kind: 'connected' };
  }

  /** External method flow (e.g. an AWS profile): `connect.external` with the form answers. */
  private async connectExternal(
    attempt: ActiveAttempt,
    row: IntegrationRow,
    method: MethodRow,
    answer: Record<string, string>,
  ): Promise<AuthResult> {
    if (method.id === undefined) {
      return { kind: 'failed', message: `Unknown method for ${row.name}` };
    }
    try {
      await attempt.api.integration.connect.external({
        integrationID: row.id,
        methodID: method.id,
        ...(Object.keys(answer).length > 0 ? { answer } : {}),
      });
    } catch (error) {
      return this.failure(row, 'external', error, []);
    }
    this.log.info(`provider connected: ${row.id} (external)`);
    return { kind: 'connected' };
  }

  /**
   * OAuth flow. `oauth.connect` returns the link, the instructions and the mode. The link is opened
   * at once (only `https:`, or loopback `http:` when allowed) and the cancellable notification
   * shows the instructions. `auto` polls `oauth.status` every `pollMs`; `code` asks the code in a
   * native input and sends it with `oauth.complete`.
   */
  private async connectOauth(
    attempt: ActiveAttempt,
    row: IntegrationRow,
    method: MethodRow,
    answer: Record<string, string>,
  ): Promise<AuthResult> {
    if (method.id === undefined) {
      return { kind: 'failed', message: `Unknown method for ${row.name}` };
    }
    let started;
    try {
      started = (
        await attempt.api.integration.oauth.connect({
          integrationID: row.id,
          methodID: method.id,
          ...(Object.keys(answer).length > 0 ? { answer } : {}),
        })
      ).data;
    } catch (error) {
      return this.failure(row, 'oauth', error, []);
    }
    attempt.attemptID = started.attemptID;
    if (this.active !== attempt) {
      // Cancelled while the server was creating the attempt: it exists there, so cancel it.
      await this.serverCancel(attempt, started.attemptID);
      return { kind: 'cancelled' };
    }

    const host = this.openableHost(started.url);
    if (host === undefined) {
      this.log.warn(`provider sign-in refused: ${row.id} (link is not https)`);
      this.finish(attempt);
      await this.serverCancel(attempt, started.attemptID);
      return {
        kind: 'failed',
        message: 'The sign-in link is not a secure (https) address; it was not opened',
      };
    }
    const instructions = cleanInstructions(started.instructions);
    const code = extractDeviceCode(instructions);
    attempt.view = {
      integrationID: row.id,
      phase: 'waiting',
      instructions,
      ...(code === undefined ? {} : { code }),
    };
    const view: AuthProgressView = {
      title: `Sign in to ${row.name}`,
      instructions,
      ...(code === undefined ? {} : { code }),
    };
    attempt.handle = this.ui.progress(view, () => void this.cancel());
    this.publish();
    const opened = await this.ui.openExternal(started.url);
    this.log.info(
      `provider sign-in started: ${row.id} (${started.mode}, ${host}, opened: ${String(opened)})`,
    );
    if (this.active !== attempt) return { kind: 'cancelled' };

    return started.mode === 'code'
      ? this.finishWithCode(attempt, row, started.attemptID)
      : this.pollStatus(attempt, row, started.attemptID, started.time.expires);
  }

  /** `code` mode: asks the code, then `oauth.complete`. A dismissed input cancels the attempt. */
  private async finishWithCode(
    attempt: ActiveAttempt,
    row: IntegrationRow,
    attemptID: string,
  ): Promise<AuthResult> {
    const code = await this.ui.askCode({
      title: `Code for ${row.name}`,
      placeholder: 'Paste the code from the browser',
      signal: attempt.abort.signal,
    });
    if (this.active !== attempt) return { kind: 'cancelled' };
    if (code === undefined || code.trim() === '') {
      await this.cancel();
      return { kind: 'cancelled' };
    }
    attempt.view = { ...attempt.view, phase: 'finishing' };
    this.publish();
    try {
      await attempt.api.integration.oauth.complete({
        integrationID: row.id,
        attemptID,
        code: code.trim(),
      });
    } catch (error) {
      if (this.active !== attempt) return { kind: 'cancelled' };
      const result = this.failure(row, 'oauth', error, [code.trim()]);
      this.finish(attempt);
      await this.serverCancel(attempt, attemptID);
      return result;
    }
    this.log.info(`provider connected: ${row.id} (oauth)`);
    return { kind: 'connected' };
  }

  /** `auto` mode: polls `oauth.status` until it is no longer pending, or the attempt is replaced. */
  private async pollStatus(
    attempt: ActiveAttempt,
    row: IntegrationRow,
    attemptID: string,
    expires: number,
  ): Promise<AuthResult> {
    let errors = 0;
    for (;;) {
      await this.sleep(this.pollMs, attempt.abort.signal);
      if (this.active !== attempt) return { kind: 'cancelled' };
      let status;
      try {
        status = (await attempt.api.integration.oauth.status({ integrationID: row.id, attemptID }))
          .data;
      } catch (error) {
        if (this.active !== attempt) return { kind: 'cancelled' };
        errors++;
        if (errors >= MAX_STATUS_ERRORS) return this.failure(row, 'oauth', error, []);
        continue;
      }
      if (this.active !== attempt) return { kind: 'cancelled' };
      errors = 0;
      if (status.status === 'complete') {
        this.log.info(`provider connected: ${row.id} (oauth)`);
        return { kind: 'connected' };
      }
      if (status.status === 'failed') {
        this.log.warn(`provider sign-in failed: ${row.id} (oauth): reported by the server`);
        return {
          kind: 'failed',
          message: firstLine(sanitizeText(status.message, this.secrets), MAX_TEXT),
        };
      }
      if (status.status === 'expired' || this.now() > expires + EXPIRY_GRACE_MS) {
        this.log.info(`provider sign-in expired: ${row.id}`);
        return { kind: 'expired' };
      }
    }
  }

  /** Waits `ms`, or less if `signal` aborts (a Cancel ends the wait at once); the timer is unref'd. */
  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      timer.unref();
      signal.addEventListener('abort', done, { once: true });
      function done(): void {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      }
    });
  }

  /** The host of `url` when it may be opened, else `undefined`: `https:`, or loopback `http:` if allowed. */
  private openableHost(url: string): string | undefined {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return undefined;
    }
    if (parsed.protocol === 'https:') return parsed.host;
    if (
      this.allowLoopbackHttp &&
      parsed.protocol === 'http:' &&
      LOOPBACK_HOSTS.has(parsed.hostname)
    ) {
      return parsed.host;
    }
    return undefined;
  }

  /**
   * Ends `attempt` locally: closes the notification and the code or API key input (aborting the
   * signal is what closes the InputBox), clears it if still current.
   */
  private finish(attempt: ActiveAttempt): void {
    attempt.abort.abort();
    attempt.handle?.dispose();
    attempt.handle = undefined;
    if (this.active === attempt) {
      this.active = undefined;
      this.publish();
    }
  }

  /** Best-effort server cancel; a 404 (already gone) and any other error are ignored. */
  private async serverCancel(attempt: ActiveAttempt, attemptID: string): Promise<void> {
    try {
      await attempt.api.integration.oauth.cancel({
        integrationID: attempt.integrationID,
        attemptID,
      });
    } catch (error) {
      this.log.debug(
        `provider sign-in cancel ignored: ${attempt.integrationID}: ${this.codeOf(error)}`,
      );
    }
  }

  /** Tells the listeners the attempt changed; one that throws does not stop the others. */
  private publish(): void {
    const view = this.attempt();
    for (const listener of [...this.listeners]) {
      try {
        listener(view);
      } catch {
        // A listener must not break the flow.
      }
    }
  }

  /** The error code for the log: never the message. */
  private codeOf(error: unknown): string {
    return toErrorInfo(error, this.secrets).code;
  }

  /** A one-line message safe to show: scrubbed of the server URL, password and `hidden` strings. */
  private messageOf(error: unknown, hidden: readonly string[] = []): string {
    let message = sanitizeText(toErrorInfo(error, this.secrets).message, this.secrets);
    for (const value of hidden) {
      if (value !== '') message = message.split(value).join('…');
    }
    return firstLine(message, MAX_TEXT);
  }

  /** Logs one `warn` line (code only) and builds the `failed` result. */
  private failure(
    row: IntegrationRow,
    kind: 'key' | 'oauth' | 'external',
    error: unknown,
    hidden: readonly string[],
  ): AuthResult {
    this.log.warn(`provider connect failed: ${row.id} (${kind}): ${this.codeOf(error)}`);
    return { kind: 'failed', message: this.messageOf(error, hidden) };
  }
}
