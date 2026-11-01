// What the OpenCode Settings tab (issue #128, E10) knows about the SERVER'S configuration: the
// integrations (providers and how they authenticate), the MCP servers with their status, and the
// resources and templates they offer. Pure host code (no `vscode`, no I/O of its own): the
// `ChatController` hands it the client of the running server and the stream events that matter
// (`ServerConfigSink`), and a later consumer (the settings controller) reads `snapshot()` and
// listens to `onDidChange`.
//
// Security (architecture rule 1 and the plan's section 3): the rows are built by an ALLOW-LIST, field
// by field, never with a spread. `integration.list` carries no secret, but the objects around it do
// (`provider.list` has `settings.apiKey`, `credential.list` has `value.key/refresh/access`, and a
// provider may have `headers`), and the day a server version adds a field to `IntegrationInfo`
// this mapping must not forward it by accident. `credential.list` is not even part of `ChatApi`.
// The unit test plants a secret in every such place and looks for it in the serialized snapshot.

import type { ErrorSecrets } from './wireMapping';
import { sanitizeText, toErrorInfo } from './wireMapping';
import type { ChatApi } from './opencodeClient';
import type { ServerLog } from './opencodeServer';
import type { ProviderAuthApi } from './providerAuth';

/** The client methods the store reads: a slice of {@link ChatApi}, so a test supplies a small fake. */
export type ServerConfigApi = {
  integration: Pick<ChatApi['integration'], 'list' | 'get'>;
  mcp: ChatApi['mcp'];
};

/** Longest line of server text kept (an error, a label, a description). */
export const MAX_TEXT = 200;
/** Longest URI or URI template kept. */
const MAX_URI = 500;
/** How long an empty first MCP list is shown as "still loading" before it is believed (ms). */
export const MCP_FIRST_READ_GRACE_MS = 2000;

/** A field of the form of a connection method; only `string` fields are supported by the tab. */
export interface FieldRow {
  key: string;
  title?: string;
  description?: string;
  required: boolean;
  placeholder?: string;
  default?: string;
  options?: { value: string; label: string; description?: string }[];
  when?: { key: string; op: 'eq' | 'neq'; value: string }[];
}

/** How an integration can be connected. `index` is the position in the server's `methods` array. */
export interface MethodRow {
  index: number;
  type: 'key' | 'oauth' | 'external';
  /** The method id the OAuth and external routes need; a `key` method has none. */
  id?: string;
  label: string;
  fields: FieldRow[];
  /** False when the form has a field type the tab cannot render (then: use the CLI). */
  supported: boolean;
}

/** What an integration is connected through: a stored credential or an environment variable. */
export type ConnectionRow =
  | {
      kind: 'credential';
      id: string;
      label: string;
      method: 'key' | 'oauth' | 'external';
      needsAuth?: string;
    }
  | { kind: 'env'; name: string; needsAuth?: string };

/** One integration (provider) of the catalog. */
export interface IntegrationRow {
  id: string;
  name: string;
  connections: ConnectionRow[];
  methods: MethodRow[];
}

/** The states `mcp.list` reports. */
export type McpStatusName = 'connected' | 'pending' | 'disabled' | 'failed' | 'needs_auth';

/** One MCP server with the resources and templates the catalog lists for it. */
export interface McpServerRow {
  name: string;
  status: McpStatusName;
  /** First line of the server's error, at most {@link MAX_TEXT} characters, scrubbed. */
  error?: string;
  resources: { name: string; uri: string; description?: string; mimeType?: string }[];
  templates: { name: string; uriTemplate: string; description?: string }[];
}

/** Everything the tab shows about the server's configuration. */
export interface ServerConfigSnapshot {
  /** The epoch given to `attach`; `undefined` when there is no server. */
  epoch: number | undefined;
  integrations: {
    /** True after the first successful read of the current server. */
    loaded: boolean;
    /** True when the last read failed (the rows are then the previous ones). */
    failed: boolean;
    rows: IntegrationRow[];
  };
  mcp: {
    loaded: boolean;
    failed: boolean;
    /**
     * True while an EMPTY first list may still be an artefact: a real server answers `[]` for the
     * first moments and fills it after the first `mcp.status.changed` (the spike saw `[]` at 25 ms
     * and 3 s, full after the first event, about 580 ms). The consumer must not say "no MCP
     * servers" while this is true.
     */
    pendingFirstRead: boolean;
    servers: McpServerRow[];
  };
}

/**
 * Where the `ChatController` reports the server and its config events. Optional on the controller:
 * without it the controller does exactly what it did before this tab existed. Every method must be
 * cheap and must not throw.
 */
export interface ServerConfigSink {
  /**
   * A client for a running server; `secrets` scrub the texts the server writes (errors). The
   * argument is wide enough for the sign-in flows too ({@link ProviderAuthApi}), because
   * `chatLifecycle.ts` fans one `attach` out to the store AND to `ProviderAuth` (issue #128);
   * {@link ServerConfig} itself only needs {@link ServerConfigApi}.
   */
  attach(api: ServerConfigApi & ProviderAuthApi, epoch: number, secrets?: ErrorSecrets): void;
  /** The server is gone (stop, restart, another folder): forget everything it described. */
  detach(): void;
  /** One stream event, any type; the sink picks the ones it follows. */
  event(type: string): void;
}

/**
 * The first line of `text` that is not blank, cut to `max` characters (the last one is `…` when
 * it was cut). CRLF, CR and LF all separate lines: the spike saw a `failed` error that was the
 * whole stderr of the MCP process with `\r\n` between lines.
 */
export function firstLine(text: string, max: number = MAX_TEXT): string {
  const line =
    text
      .split(/\r\n|\r|\n/)
      .map((part) => part.trim())
      .find((part) => part !== '') ?? '';
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/** Narrow shape of the form fields read here, so the mapper never touches the rest of them. */
type WireMethod = Awaited<
  ReturnType<ServerConfigApi['integration']['list']>
>['data'][number]['methods'][number];

/**
 * Maps the form of a method to its supported (string) fields, field by field. Hidden fields are
 * left out (nothing to ask the user; HYPOTHESIS that a hidden field never needs an answer: the
 * spike saw none). `supported` is false when any visible field is not a `string`.
 */
function toFields(method: WireMethod): { fields: FieldRow[]; supported: boolean } {
  if (method.type === 'env' || method.type === 'command' || method.form === undefined) {
    return { fields: [], supported: true };
  }
  const fields: FieldRow[] = [];
  let supported = true;
  for (const field of method.form) {
    if (field.type !== 'string') {
      supported = false;
      continue;
    }
    if (field.hidden === true) continue;
    const row: FieldRow = { key: firstLine(field.key), required: field.required === true };
    if (field.title !== undefined) row.title = firstLine(field.title);
    if (field.description !== undefined) row.description = firstLine(field.description);
    if (field.placeholder !== undefined) row.placeholder = firstLine(field.placeholder);
    if (field.default !== undefined) row.default = firstLine(field.default);
    if (field.options !== undefined) {
      row.options = field.options.map((option) => {
        const mapped: { value: string; label: string; description?: string } = {
          value: firstLine(option.value),
          label: firstLine(option.label),
        };
        if (option.description !== undefined) mapped.description = firstLine(option.description);
        return mapped;
      });
    }
    if (field.when !== undefined) {
      row.when = field.when.map((rule) => ({
        key: firstLine(rule.key),
        op: rule.op,
        value: String(rule.value),
      }));
    }
    fields.push(row);
  }
  return { fields, supported };
}

/**
 * Maps one `IntegrationInfo` by allow-list: id, name, connections (credential: id, label, method,
 * and the message of a `needs_auth` status; env: variable name) and the `key`, `oauth` and
 * `external` methods with their string fields. `env` and `command` methods are not rows (an env
 * connection already says it). `metadata`, the status `url`, and anything else the server may add
 * are dropped on purpose. VERIFIED by unit tests with a planted secret (fabricated data); the
 * shapes follow the types of `@opencode/client` 2.0.32 and the planner spike.
 */
export function toIntegrationRow(
  info: Awaited<ReturnType<ServerConfigApi['integration']['get']>>['data'],
): IntegrationRow {
  const connections: ConnectionRow[] = info.connections.map((connection) => {
    const needsAuth =
      connection.status === undefined ? undefined : firstLine(connection.status.message);
    if (connection.type === 'env') {
      const row: ConnectionRow = { kind: 'env', name: firstLine(connection.name) };
      if (needsAuth !== undefined) row.needsAuth = needsAuth;
      return row;
    }
    const row: ConnectionRow = {
      kind: 'credential',
      id: connection.id,
      label: firstLine(connection.label),
      method: connection.method,
    };
    if (needsAuth !== undefined) row.needsAuth = needsAuth;
    return row;
  });
  const methods: MethodRow[] = [];
  info.methods.forEach((method, index) => {
    if (method.type === 'key') {
      const { fields, supported } = toFields(method);
      methods.push({
        index,
        type: 'key',
        label: method.label === undefined ? 'API key' : firstLine(method.label),
        fields,
        supported,
      });
    } else if (method.type === 'oauth' || method.type === 'external') {
      const { fields, supported } = toFields(method);
      methods.push({
        index,
        type: method.type,
        id: method.id,
        label: firstLine(method.label),
        fields,
        supported,
      });
    }
  });
  return { id: info.id, name: firstLine(info.name), connections, methods };
}

/** One `McpServer` of the wire reduced to the fields kept, with the error scrubbed and cut. */
function toMcpStatus(
  server: Awaited<ReturnType<ServerConfigApi['mcp']['list']>>['data'][number],
  secrets: ErrorSecrets,
): { status: McpStatusName; error?: string } {
  const state = server.status;
  switch (state.status) {
    case 'connected':
    case 'pending':
    case 'disabled':
      return { status: state.status };
    case 'failed':
    case 'needs_auth':
      return { status: state.status, error: firstLine(sanitizeText(state.error, secrets)) };
    default:
      // A status a newer server may add: shown as pending rather than invented (HYPOTHESIS).
      return { status: 'pending' };
  }
}

/** The resources and templates of the catalog, kept by allow-list and grouped by server name. */
export interface McpCatalogRows {
  resources: Map<string, McpServerRow['resources']>;
  templates: Map<string, McpServerRow['templates']>;
}

/** Groups the wire catalog by server, field by field (the `server` key is the group, not a field). */
export function toMcpCatalogRows(
  catalog: Awaited<ReturnType<ServerConfigApi['mcp']['resource']['catalog']>>['data'],
): McpCatalogRows {
  const resources = new Map<string, McpServerRow['resources']>();
  const templates = new Map<string, McpServerRow['templates']>();
  for (const resource of catalog.resources) {
    const row: McpServerRow['resources'][number] = {
      name: firstLine(resource.name),
      uri: firstLine(resource.uri, MAX_URI),
    };
    if (resource.description !== undefined) row.description = firstLine(resource.description);
    if (resource.mimeType !== undefined) row.mimeType = firstLine(resource.mimeType);
    const list = resources.get(resource.server) ?? [];
    list.push(row);
    resources.set(resource.server, list);
  }
  for (const template of catalog.templates) {
    const row: McpServerRow['templates'][number] = {
      name: firstLine(template.name),
      uriTemplate: firstLine(template.uriTemplate, MAX_URI),
    };
    if (template.description !== undefined) row.description = firstLine(template.description);
    const list = templates.get(template.server) ?? [];
    list.push(row);
    templates.set(template.server, list);
  }
  return { resources, templates };
}

/**
 * One read that never runs twice at once: a request while it is in flight marks it dirty, so the
 * running one repeats ONCE when it ends and every caller shares the promise (the pattern of
 * `ChatController.loadCatalog`). `current()` is the owner's generation: a loop whose generation
 * went stale stops, and `reset()` forgets a run in flight without waiting for it.
 */
class CoalescedRead {
  private run: Promise<void> | undefined;
  private dirty = false;
  /** Bumped by `reset`: the loop of an older serial must not clear the run of a newer one. */
  private serial = 0;

  constructor(
    private readonly current: () => number,
    private readonly once: (generation: number) => Promise<void>,
  ) {}

  /** Starts a read, or marks the running one dirty; resolves when this read and its repeat end. */
  request(): Promise<void> {
    if (this.run !== undefined) {
      this.dirty = true;
      return this.run;
    }
    const run = this.loop(this.current());
    this.run = run;
    return run;
  }

  /** Forgets the run in flight (its loop stops at the next generation check). */
  reset(): void {
    this.serial++;
    this.run = undefined;
    this.dirty = false;
  }

  /**
   * Reads once, and once more per request made meanwhile, while `generation` is still current.
   * The run is cleared in the same synchronous step that decides not to repeat (not in a `.finally`
   * callback, a microtask later): a request that lands in that gap would otherwise mark a loop that
   * has already ended as dirty and be lost. The first `await` always yields, so `request` has
   * stored `this.run` before this code can reach the `finally`.
   */
  private async loop(generation: number): Promise<void> {
    const serial = this.serial;
    try {
      do {
        this.dirty = false;
        await this.once(generation);
      } while (this.dirty && generation === this.current() && serial === this.serial);
    } finally {
      if (serial === this.serial) this.run = undefined;
    }
  }
}

/**
 * The store: three coalesced reads (integrations, MCP list, MCP resource catalog) of the server
 * attached, each REPLACING its rows whole (an integration or server that left must disappear),
 * and a snapshot to read them. A failed read keeps the previous rows, sets `failed` and logs one
 * `warn` line; a read for a server that went away meanwhile is dropped (generation check).
 *
 * VERIFIED by unit tests with fake clients (coalescing, replacement, stale generation, the
 * pending-first-read rule, the allow-list with a planted secret, the catalog re-read on a status
 * change). Against a real opencode 2.0.32 the opt-in `real-opencode` suite reads the routes with
 * the full client directly (its Settings API cases: "lists integrations without secrets, connects
 * a fake key and removes it" and "lists an MCP server of the config with its resource"), NOT
 * through this class. The `fake-server` suite drives this class against the synthetic server:
 * "lists the MCP servers and follows MCPFLIP in the state and in the log". `test:visual` runs
 * against the SYNTHETIC server too, so what it adds is the tab in a real VS Code following the
 * fake's stream through this class (Windows 11, VS Code 1.144.0, 1/11/2026): "ok   V4 after a
 * prompt with MCPFLIP the open tab shows broken as connected with a status.md resource, in the same
 * document". UNVERIFIED, with no date (no suite can show it without a model that talks to a real
 * opencode and an MCP server that changes by itself): the events of a REAL opencode stream reaching
 * this class; the event names and shapes are the spike's and the fake's emission order is invented.
 */
export class ServerConfig implements ServerConfigSink {
  private api: ServerConfigApi | undefined;
  private epoch: number | undefined;
  private secrets: ErrorSecrets = {};
  /** Bumped by every attach and detach: a read that started under another one is dropped. */
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  private integrations: IntegrationRow[] = [];
  private integrationsLoaded = false;
  private integrationsFailed = false;

  private mcpList: { name: string; status: McpStatusName; error?: string }[] = [];
  private catalog: McpCatalogRows = { resources: new Map(), templates: new Map() };
  private mcpLoaded = false;
  private mcpFailed = false;
  /** True once an `mcp.status.changed` arrived, or the grace period of the first list ended. */
  private mcpSettled = false;
  private mcpEventSeen = false;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly integrationRead = new CoalescedRead(
    () => this.generation,
    (generation) => this.readIntegrations(generation),
  );
  private readonly mcpRead = new CoalescedRead(
    () => this.generation,
    (generation) => this.readMcp(generation),
  );
  private readonly catalogRead = new CoalescedRead(
    () => this.generation,
    (generation) => this.readCatalog(generation),
  );

  constructor(private readonly log: ServerLog) {}

  /** The current rows; a fresh copy of the state, safe to keep. */
  snapshot(): ServerConfigSnapshot {
    const servers: McpServerRow[] = this.mcpList.map((server) => {
      const row: McpServerRow = {
        name: server.name,
        status: server.status,
        resources: this.catalog.resources.get(server.name) ?? [],
        templates: this.catalog.templates.get(server.name) ?? [],
      };
      if (server.error !== undefined) row.error = server.error;
      return row;
    });
    return {
      epoch: this.epoch,
      integrations: {
        loaded: this.integrationsLoaded,
        failed: this.integrationsFailed,
        rows: this.integrations,
      },
      mcp: {
        loaded: this.mcpLoaded,
        failed: this.mcpFailed,
        pendingFirstRead: this.mcpLoaded && !this.mcpSettled && servers.length === 0,
        servers,
      },
    };
  }

  /** Calls `listener` after every change of the snapshot; returns the function that stops it. */
  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Starts following a server: forgets the previous one and stores the client, the `epoch` the
   * snapshot reports and the `secrets` that scrub server text. Reads nothing: the first read is
   * triggered by that server's `server.connected` (the stream has no replay).
   */
  attach(api: ServerConfigApi, epoch: number, secrets: ErrorSecrets = {}): void {
    this.forget();
    this.api = api;
    this.epoch = epoch;
    this.secrets = secrets;
    this.notify();
  }

  /** Forgets the server and all it described; tells the listeners only if there was a server. */
  detach(): void {
    const had = this.api !== undefined;
    this.forget();
    if (had) this.notify();
  }

  /**
   * Routes one stream event. `server.connected` and `location.shutdown` re-read everything (the
   * stream has no replay: `opencode-api` section 4); `integration.updated`, `credential.updated` and
   * `credential.switched` re-read the integrations (`provider.updated` and `model.updated` are
   * their consequence and are left to the chat catalog; HYPOTHESIS, the opt-in suite never changed
   * a credential); `mcp.status.changed` re-reads the list AND the resource catalog, and
   * `mcp.resources.changed` only the catalog. The catalog is re-read on a status change too as a
   * defence: upstream 843a6c5 (`packages/core/src/mcp/index.ts` L463-465) publishes
   * `ResourcesChanged` when a server connects, but no test follows that event end to end against
   * a real opencode, so a version that stopped emitting it would leave the catalog stale. Both
   * reads are coalesced ({@link CoalescedRead}), so a burst costs at most one read in flight plus
   * one repeat each (not one read per event, and not a single read either).
   * Names read in the client types of 2.0.32; the two `mcp.*` events were seen in the spike.
   * VERIFIED by "re-reads the resource catalog on a status change alone, at most twice per burst"
   * of `serverConfig.test.ts` (fake client, fabricated events: it waits for the read queue to
   * drain and expects 2 reads of each source for a burst of 3 events).
   */
  event(type: string): void {
    switch (type) {
      case 'server.connected':
      case 'location.shutdown':
        void this.reloadAll();
        return;
      case 'integration.updated':
      case 'credential.updated':
      case 'credential.switched':
        void this.integrationRead.request();
        return;
      case 'mcp.status.changed':
        this.mcpEventSeen = true;
        void this.mcpRead.request();
        void this.catalogRead.request();
        return;
      case 'mcp.resources.changed':
        void this.catalogRead.request();
        return;
      default:
        return;
    }
  }

  /** Re-reads the three sources (the Refresh button); resolves when all are done, never rejects. */
  async reloadAll(): Promise<void> {
    await Promise.all([
      this.integrationRead.request(),
      this.mcpRead.request(),
      this.catalogRead.request(),
    ]);
  }

  /** Drops the server and everything read from it, and cancels the grace timer. */
  private forget(): void {
    this.generation++;
    this.api = undefined;
    this.epoch = undefined;
    this.secrets = {};
    this.integrationRead.reset();
    this.mcpRead.reset();
    this.catalogRead.reset();
    this.integrations = [];
    this.integrationsLoaded = false;
    this.integrationsFailed = false;
    this.mcpList = [];
    this.catalog = { resources: new Map(), templates: new Map() };
    this.mcpLoaded = false;
    this.mcpFailed = false;
    this.mcpSettled = false;
    this.mcpEventSeen = false;
    if (this.graceTimer !== undefined) clearTimeout(this.graceTimer);
    this.graceTimer = undefined;
  }

  /** Tells every listener the snapshot changed; one that throws does not stop the others. */
  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A listener must not break the store.
      }
    }
  }

  /**
   * Writes the stable line `server config loaded (<i> integrations, <c> connected, <m> mcp servers,
   * <r> resources)`, with counts only (an integration is "connected" when it has a connection).
   * The `MCPFLIP` case of `fakeServer.test.ts` waits for it in the log; it names nothing a user
   * typed.
   */
  private logLoaded(): void {
    const connected = this.integrations.filter((row) => row.connections.length > 0).length;
    const resources = [...this.catalog.resources.values()].reduce(
      (sum, rows) => sum + rows.length,
      0,
    );
    this.log.info(
      `server config loaded (${String(this.integrations.length)} integrations, ${String(connected)} connected, ${String(this.mcpList.length)} mcp servers, ${String(resources)} resources)`,
    );
  }

  /** One `warn` line `<what> failed: <code>: <message>`, the message scrubbed of URL and password. */
  private warnFailed(what: string, error: unknown): void {
    const info = toErrorInfo(error, this.secrets);
    this.log.warn(`${what} failed: ${info.code}: ${info.message}`);
  }

  /** One read of `integration.list` for `generation`; a failure keeps the previous rows. */
  private async readIntegrations(generation: number): Promise<void> {
    const api = this.api;
    if (api === undefined) return;
    try {
      const answer = await api.integration.list();
      if (generation !== this.generation) return;
      this.integrations = answer.data.map(toIntegrationRow);
      this.integrationsLoaded = true;
      this.integrationsFailed = false;
      this.logLoaded();
    } catch (error) {
      if (generation !== this.generation) return;
      this.integrationsFailed = true;
      this.warnFailed('integration list', error);
    }
    this.notify();
  }

  /**
   * One read of `mcp.list` for `generation`. `afterEvent` is sampled BEFORE the request: only a
   * read that started after an `mcp.status.changed` may believe an empty list. The grace timer
   * (one per attach) covers a server with no MCP servers at all, which never sends the event.
   */
  private async readMcp(generation: number): Promise<void> {
    const api = this.api;
    if (api === undefined) return;
    const afterEvent = this.mcpEventSeen;
    try {
      const answer = await api.mcp.list();
      if (generation !== this.generation) return;
      this.mcpList = answer.data.map((server) => ({
        name: firstLine(server.name),
        ...toMcpStatus(server, this.secrets),
      }));
      this.mcpLoaded = true;
      this.mcpFailed = false;
      // An empty list is believed once it was read after an `mcp.status.changed`, when something
      // came in it, or when the grace period ends (see `ServerConfigSnapshot.mcp.pendingFirstRead`).
      if (afterEvent || this.mcpList.length > 0) this.mcpSettled = true;
      if (!this.mcpSettled && this.graceTimer === undefined) {
        this.graceTimer = setTimeout(() => {
          this.graceTimer = undefined;
          if (generation !== this.generation) return;
          this.mcpSettled = true;
          this.notify();
        }, MCP_FIRST_READ_GRACE_MS);
        this.graceTimer.unref();
      }
      this.logLoaded();
    } catch (error) {
      if (generation !== this.generation) return;
      this.mcpFailed = true;
      this.warnFailed('mcp list', error);
    }
    this.notify();
  }

  /** One read of `mcp.resource.catalog` for `generation`; a failure keeps the previous catalog. */
  private async readCatalog(generation: number): Promise<void> {
    const api = this.api;
    if (api === undefined) return;
    try {
      const answer = await api.mcp.resource.catalog();
      if (generation !== this.generation) return;
      this.catalog = toMcpCatalogRows(answer.data);
      this.logLoaded();
    } catch (error) {
      if (generation !== this.generation) return;
      this.warnFailed('mcp resource catalog', error);
    }
    this.notify();
  }
}
