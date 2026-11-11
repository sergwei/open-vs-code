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
// The same holds for the MODEL catalog (issue #186): `model.list` and `provider.list` carry
// `headers`, `body` and `settings` that may hold keys, so a model row is only `{id, providerID,
// name}` plus the provider's `{id, name, integrationID}`, read field by field.

import * as l10n from '@vscode/l10n';
import type { ErrorSecrets } from './wireMapping';
import { logTextOf, sanitizeText, toErrorInfo } from './wireMapping';
import type { ChatApi } from './opencodeClient';
import type { ServerLog } from './opencodeServer';
import type { ProviderAuthApi } from './providerAuth';
import { MAX_SETTINGS_VALUE } from '../shared/settingsProtocol';

/** The client methods the store reads: a slice of {@link ChatApi}, so a test supplies a small fake. */
export type ServerConfigApi = {
  integration: Pick<ChatApi['integration'], 'list' | 'get'>;
  mcp: ChatApi['mcp'];
  /** `config.get` and `config.shells`, the reads of the shell row (issue #205). */
  config: ChatApi['config'];
  /**
   * The MCP writes, which live under `client.experimental.mcp` since 2.2 (issue #191), and the
   * shell write `client.experimental.config.update` (issue #205).
   */
  experimental: Pick<ChatApi['experimental'], 'mcp' | 'config'>;
  /** The catalog reads of the model picker (issue #186): `model.list`, `model.default`. */
  model: ChatApi['model'];
  /** `provider.list`, for the provider names and the link provider to integration. */
  provider: ChatApi['provider'];
};

/** Longest line of server text kept (an error, a label, a description). */
export const MAX_TEXT = 200;
/** Longest URI or URI template kept. */
const MAX_URI = 500;
/** Most lines of an MCP error the "Show details" text keeps (chosen by Sergio, issue #186 PR2). */
export const MAX_DETAIL_LINES = 20;
/** Most characters of an MCP error the "Show details" text keeps (same decision as above). */
export const MAX_DETAIL = 2000;
/** How long an empty first MCP list is shown as "still loading" before it is believed (ms). */
export const MCP_FIRST_READ_GRACE_MS = 2000;
/**
 * How long {@link ServerConfig.shellAction} waits for the `config.updated` that follows its write
 * before it re-reads anyway (ms). Chosen by the planner of issue #205 as 2-3 times the 173-575 ms
 * the real 2.2.7 server took to converge (Windows 11, 11/11/2026): the 204 comes BEFORE the reload,
 * and a patch that changes nothing publishes no event at all.
 */
export const SHELL_SETTLE_MS = 1500;

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
  /**
   * `'mcp'` when the server says this integration belongs to a remote MCP server
   * (`metadata.source === 'mcp'`, plan #2037 section 2); ABSENT otherwise. The Providers list leaves
   * these out, because they are signed in from the MCP section.
   */
  source?: 'mcp';
}

/** One model of the catalog with the name of its provider (issue #186). */
export interface ModelRow {
  providerID: string;
  id: string;
  name: string;
  providerName: string;
  /** The integration the provider belongs to (`ProviderInfo.integrationID`), if it says so. */
  integrationID?: string;
}

/** The states `mcp.list` reports. */
export type McpStatusName = 'connected' | 'pending' | 'disabled' | 'failed' | 'needs_auth';

/** One MCP server with the resources and templates the catalog lists for it. */
export interface McpServerRow {
  name: string;
  status: McpStatusName;
  /** First line of the server's error, at most {@link MAX_TEXT} characters, scrubbed. */
  error?: string;
  /**
   * The whole error, scrubbed, at most {@link MAX_DETAIL_LINES} lines and {@link MAX_DETAIL}
   * characters (see {@link detailText}); ABSENT when it says nothing the first line does not.
   */
  detail?: string;
  /** `McpServer.integrationID` as the server sent it: the OAuth integration, for remote servers. */
  integrationID?: string;
  resources: { name: string; uri: string; description?: string; mimeType?: string }[];
  templates: { name: string; uriTemplate: string; description?: string }[];
}

/** What {@link ServerConfig.mcpAction} resolves: it worked, or why it did not. */
export type McpActionResult =
  { kind: 'done' } | { kind: 'failed'; message: string; notFound: boolean };

/** What {@link ServerConfig.shellAction} resolves: it worked, or why it did not. */
export type ShellActionResult = { kind: 'done' } | { kind: 'failed'; message: string };

/** One choice of the shell select: `value` is what is written (and what `current` holds). */
export interface ShellOptionRow {
  /** The shell name, or its path when two shells share a name; exactly what the PATCH carries. */
  value: string;
  /** What the select shows: the same as `value`, so two shells of one name show their paths. */
  name: string;
  /** True when opencode says the shell is not acceptable for the agent's commands (fish, nu). */
  terminalOnly: boolean;
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
  models: {
    loaded: boolean;
    /** True when the last read failed (the rows are then the previous ones). */
    failed: boolean;
    rows: ModelRow[];
    /** What `model.default` answered; ABSENT when it answered `null` or nothing was read. */
    serverDefault?: { providerID: string; id: string; name: string };
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
  /** The shell of opencode (issue #205), read with `config.get` and `config.shells`. */
  shell: {
    loaded: boolean;
    /** True when the last read failed (the other fields are then the previous ones). */
    failed: boolean;
    /** True from the PATCH until the re-read that follows it ends. */
    writing: boolean;
    /** The shell the global config document holds; `''` for Automatic. */
    current: string;
    /** True when a later config document (project, organization) holds another shell that wins. */
    overridden: boolean;
    options: ShellOptionRow[];
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

/**
 * The whole of `text` for "Show details": CR, LF and CRLF are line breaks, the lines lose their
 * trailing blanks, blank lines at both ends go, and it is cut to `maxLines` lines and `max`
 * characters (the last one is `…` when anything was cut). The caller scrubs `text` BEFORE this (a
 * secret cut in half would escape {@link sanitizeText}), so the result is as safe as its input.
 * VERIFIED by "keeps the whole error as a scrubbed, bounded detail" of `serverConfig.test.ts`
 * (fabricated CRLF text, vitest, Windows 11). A real server's stderr was not inspected beyond the
 * `\r\n`-separated text the planner spike saw (01/11/2026).
 */
export function detailText(
  text: string,
  maxLines: number = MAX_DETAIL_LINES,
  max: number = MAX_DETAIL,
): string {
  const lines = text.split(/\r\n|\r|\n/).map((line) => line.trimEnd());
  while (lines.length > 0 && lines[0]?.trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
  const cutLines = lines.length > maxLines;
  const joined = lines.slice(0, maxLines).join('\n');
  if (joined.length > max || (cutLines && joined.length + 1 > max)) {
    return `${joined.slice(0, max - 1)}…`;
  }
  return cutLines ? `${joined}…` : joined;
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
 * are dropped on purpose, except that `metadata.source === 'mcp'` is kept as `source: 'mcp'` (and
 * nothing else of `metadata`). VERIFIED by unit tests with a planted secret (fabricated data); the
 * shapes follow the types of `@opencode/client` 2.0.32 and the planner spike. HYPOTHESIS that a real
 * server marks its MCP integrations that way: read in `core/src/mcp/index.ts` L173-213 of the
 * 2.0.32 tag, never listed from a running server (the PR2 real-opencode case will).
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
        label: method.label === undefined ? l10n.t('API key') : firstLine(method.label),
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
  const row: IntegrationRow = { id: info.id, name: firstLine(info.name), connections, methods };
  if (info.metadata?.source === 'mcp') row.source = 'mcp';
  return row;
}

/**
 * Joins `model.list` and `provider.list` into rows, field by field: the model keeps `id`,
 * `providerID` and `name`, the provider only `name` and `integrationID` (the rest, `headers`, `body`
 * and `settings` included, may hold keys and is never read). A model whose provider is not in the
 * list takes the provider id as its provider name. Order is the server's.
 * VERIFIED on Windows 11 (08/11/2026, vitest, FABRICATED `ModelInfo` and `ProviderInfo` with
 * planted secrets): the check "keeps no planted secret from model.list or provider.list in a serialized
 * snapshot" of `serverConfig.test.ts`. A real server's payload was not inspected.
 */
export function toModelRows(
  models: Awaited<ReturnType<ServerConfigApi['model']['list']>>['data'],
  providers: Awaited<ReturnType<ServerConfigApi['provider']['list']>>['data'],
): ModelRow[] {
  const byId = new Map<string, { name: string; integrationID?: string }>();
  for (const provider of providers) {
    const entry: { name: string; integrationID?: string } = { name: firstLine(provider.name) };
    if (provider.integrationID !== undefined) entry.integrationID = provider.integrationID;
    byId.set(provider.id, entry);
  }
  return models.map((model) => {
    const provider = byId.get(model.providerID);
    const row: ModelRow = {
      providerID: model.providerID,
      id: model.id,
      name: firstLine(model.name),
      providerName: provider?.name ?? model.providerID,
    };
    if (provider?.integrationID !== undefined) row.integrationID = provider.integrationID;
    return row;
  });
}

/**
 * One `McpServer` of the wire reduced to the fields kept. A `failed` or `needs_auth` error is
 * scrubbed ONCE ({@link sanitizeText}) and then cut two ways: `error` is its first line (at most
 * {@link MAX_TEXT}) and `detail` the bounded whole ({@link detailText}), present only when it
 * adds something to the first line. The `integrationID` is kept as sent; whether it names a real
 * integration is for the controller to judge against the integration rows.
 */
function toMcpStatus(
  server: Awaited<ReturnType<ServerConfigApi['mcp']['list']>>['data'][number],
  secrets: ErrorSecrets,
): { status: McpStatusName; error?: string; detail?: string; integrationID?: string } {
  const state = server.status;
  const integration =
    server.integrationID === undefined ? {} : { integrationID: firstLine(server.integrationID) };
  switch (state.status) {
    case 'connected':
    case 'pending':
    case 'disabled':
      return { status: state.status, ...integration };
    case 'failed':
    case 'needs_auth': {
      const clean = sanitizeText(state.error, secrets);
      const error = firstLine(clean);
      const detail = detailText(clean);
      return {
        status: state.status,
        error,
        ...(detail === error ? {} : { detail }),
        ...integration,
      };
    }
    default:
      // A status a newer server may add: shown as pending rather than invented (HYPOTHESIS).
      return { status: 'pending', ...integration };
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

/** A shell name or path that can travel back to the host unchanged: a string of 1..2000 characters. */
function isShellText(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= MAX_SETTINGS_VALUE;
}

/**
 * Reduces `config.get` and `config.shells` to what the shell row needs, by allow-list: ONLY
 * `info.shell` of a document is read (the rest of `info` holds provider keys, MCP headers and the
 * user name) and each option keeps `path`, `name` and `acceptable` (an `env` or any other extra
 * field of a shell is never read).
 *
 * `current` is the LAST `info.shell` among the documents BEFORE the first `directory` entry (the
 * global group; upstream's rule, `packages/app/src/settings/general/controllers.ts` @ v2.2.7), `''`
 * when none holds one. `overridden` is true when a document AFTER that directory (a project one, or
 * a managed or inline one) holds a different shell, because it wins in the effective config while
 * `current` only says what was written to the global file. Options: the `value` is the shell's name,
 * or its path when two shells share a name, and `terminalOnly` is `!acceptable`; a shell whose
 * name or path is not a string of 1..2000 characters is DROPPED, not cut, because the value has to
 * come back exact (the protocol refuses longer ones). A `current` that no option offers is added as
 * an option of its own, so the select can always show what the config holds.
 * VERIFIED by the checks of "the shell of opencode" in `serverConfig.test.ts` (fabricated entries
 * and shells, vitest, Windows 11, 11/11/2026). The order of the entries (global document, then its
 * directory, an inline document after it) was seen on a real 2.2.7 server by the planner of #205
 * (11/11/2026); this function was not run against one.
 */
export function toShellState(
  entries: Awaited<ReturnType<ServerConfigApi['config']['get']>>,
  shells: Awaited<ReturnType<ServerConfigApi['config']['shells']>>,
): { current: string; overridden: boolean; options: ShellOptionRow[] } {
  let current = '';
  let seenDirectory = false;
  const later: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'directory') {
      seenDirectory = true;
      continue;
    }
    const shell: unknown = entry.info.shell;
    if (!isShellText(shell)) continue;
    if (seenDirectory) later.push(shell);
    else current = shell;
  }
  const usable = shells.filter((shell) => isShellText(shell.path) && isShellText(shell.name));
  const perName = new Map<string, number>();
  for (const shell of usable) perName.set(shell.name, (perName.get(shell.name) ?? 0) + 1);
  const options: ShellOptionRow[] = [];
  for (const shell of usable) {
    const value = (perName.get(shell.name) ?? 0) > 1 ? shell.path : shell.name;
    if (options.some((option) => option.value === value)) continue;
    options.push({ value, name: value, terminalOnly: shell.acceptable !== true });
  }
  if (current !== '' && !options.some((option) => option.value === current)) {
    options.push({ value: current, name: current, terminalOnly: false });
  }
  return { current, overridden: later.some((shell) => shell !== current), options };
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
 * The store: five coalesced reads (integrations, models, MCP list, MCP resource catalog, and the
 * shell of opencode) of the
 * server attached, each REPLACING its rows whole (an integration or server that left must disappear),
 * and a snapshot to read them. A failed read keeps the previous rows, sets `failed` and logs one
 * `warn` line; a read for a server that went away meanwhile is dropped (generation check). Since
 * issue #186 (PR2) it also WRITES: {@link ServerConfig.mcpAction} connects or
 * disconnects an MCP server at runtime and then re-reads the list; since issue #205
 * {@link ServerConfig.shellAction} writes the shell into the GLOBAL opencode config and re-reads
 * it once the server has reloaded.
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

  private models: ModelRow[] = [];
  private serverDefault: { providerID: string; id: string; name: string } | undefined;
  private modelsLoaded = false;
  private modelsFailed = false;

  private mcpList: {
    name: string;
    status: McpStatusName;
    error?: string;
    detail?: string;
    integrationID?: string;
  }[] = [];
  private catalog: McpCatalogRows = { resources: new Map(), templates: new Map() };
  private mcpLoaded = false;
  private mcpFailed = false;
  /** True once an `mcp.status.changed` arrived, or the grace period of the first list ended. */
  private mcpSettled = false;
  private mcpEventSeen = false;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;

  private shell: { current: string; overridden: boolean; options: ShellOptionRow[] } = {
    current: '',
    overridden: false,
    options: [],
  };
  private shellLoaded = false;
  private shellFailed = false;
  private shellWriting = false;
  /** Set by {@link ServerConfig.shellAction} while it waits for `config.updated`; see `event`. */
  private shellWaiter: (() => void) | undefined;

  private readonly shellRead = new CoalescedRead(
    () => this.generation,
    (generation) => this.readShell(generation),
  );
  private readonly integrationRead = new CoalescedRead(
    () => this.generation,
    (generation) => this.readIntegrations(generation),
  );
  private readonly modelRead = new CoalescedRead(
    () => this.generation,
    (generation) => this.readModels(generation),
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
      if (server.detail !== undefined) row.detail = server.detail;
      if (server.integrationID !== undefined) row.integrationID = server.integrationID;
      return row;
    });
    return {
      epoch: this.epoch,
      integrations: {
        loaded: this.integrationsLoaded,
        failed: this.integrationsFailed,
        rows: this.integrations,
      },
      models: {
        loaded: this.modelsLoaded,
        failed: this.modelsFailed,
        rows: this.models,
        ...(this.serverDefault === undefined ? {} : { serverDefault: this.serverDefault }),
      },
      mcp: {
        loaded: this.mcpLoaded,
        failed: this.mcpFailed,
        pendingFirstRead: this.mcpLoaded && !this.mcpSettled && servers.length === 0,
        servers,
      },
      shell: {
        loaded: this.shellLoaded,
        failed: this.shellFailed,
        writing: this.shellWriting,
        current: this.shell.current,
        overridden: this.shell.overridden,
        options: this.shell.options,
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
   * `credential.switched` re-read the integrations AND the models (a new credential makes a
   * provider available, so its models appear: HYPOTHESIS, the opt-in suite never changed a
   * credential); `model.updated` and `provider.updated` re-read only the models
   * (names read in the client types of 2.0.32, never seen on a real stream); `config.updated`
   * re-reads the models AND the shell, except that a shell write waiting for this very event
   * ({@link ServerConfig.shellAction}) is released instead and does its own read (the event is
   * seen on a real 2.2.7 server, about 200 ms after the PATCH: planner of #205, 11/11/2026);
   * `mcp.status.changed` re-reads the list AND the resource catalog, and
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
        void this.modelRead.request();
        return;
      case 'model.updated':
      case 'provider.updated':
        void this.modelRead.request();
        return;
      case 'config.updated': {
        void this.modelRead.request();
        // A shell write in flight is waiting for this event to read the new value: it does the
        // read itself. Otherwise the event came from elsewhere (the TUI, a file) and is read here.
        const waiter = this.shellWaiter;
        if (waiter === undefined) void this.shellRead.request();
        else waiter();
        return;
      }
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

  /** Re-reads the five sources (the Refresh button); resolves when all are done, never rejects. */
  async reloadAll(): Promise<void> {
    await Promise.all([
      this.integrationRead.request(),
      this.modelRead.request(),
      this.mcpRead.request(),
      this.catalogRead.request(),
      this.shellRead.request(),
    ]);
  }

  /**
   * Drops the server and everything read from it, cancels the grace timer and releases a shell
   * write that is waiting for `config.updated` (it then sees the new generation and gives up).
   */
  private forget(): void {
    this.generation++;
    this.api = undefined;
    this.epoch = undefined;
    this.secrets = {};
    this.integrationRead.reset();
    this.modelRead.reset();
    this.mcpRead.reset();
    this.catalogRead.reset();
    this.shellRead.reset();
    // Releases a shell write that is still waiting; it sees the new generation and gives up.
    this.shellWaiter?.();
    this.shell = { current: '', overridden: false, options: [] };
    this.shellLoaded = false;
    this.shellFailed = false;
    this.shellWriting = false;
    this.integrations = [];
    this.integrationsLoaded = false;
    this.integrationsFailed = false;
    this.models = [];
    this.serverDefault = undefined;
    this.modelsLoaded = false;
    this.modelsFailed = false;
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
    this.log.warn(`${what} failed: ${info.code}: ${logTextOf(info)}`);
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
   * One read of `model.list`, `model.default` and `provider.list` for `generation`, all or nothing:
   * if one fails the previous rows stay and `failed` is set. The rows come from {@link toModelRows}
   * and the default is cut to `{providerID, id, name}`, so no `headers`, `body` or `settings` of
   * either list reaches the snapshot.
   * VERIFIED on Windows 11 (08/11/2026, vitest, FABRICATED payloads with planted secrets): the
   * check "keeps no planted secret from model.list or provider.list in a serialized snapshot" of
   * `serverConfig.test.ts` (the `describe` "the model catalog") goes through this method. A real
   * server's payload was not inspected.
   */
  private async readModels(generation: number): Promise<void> {
    const api = this.api;
    if (api === undefined) return;
    try {
      const [models, fallback, providers] = await Promise.all([
        api.model.list(),
        api.model.default(),
        api.provider.list(),
      ]);
      if (generation !== this.generation) return;
      this.models = toModelRows(models.data, providers.data);
      const chosen = fallback.data;
      this.serverDefault =
        chosen === null
          ? undefined
          : { providerID: chosen.providerID, id: chosen.id, name: firstLine(chosen.name) };
      this.modelsLoaded = true;
      this.modelsFailed = false;
    } catch (error) {
      if (generation !== this.generation) return;
      this.modelsFailed = true;
      this.warnFailed('model list', error);
    }
    this.notify();
  }

  /**
   * Connects or disconnects the MCP server `server` of the running opencode, at runtime only (the
   * server forgets it on restart; nothing is written to `opencode.json`), and reads the list again
   * before it resolves, so the caller judges the state AFTER the change and no optimistic row is
   * ever shown. The caller has already checked that the server exists in the snapshot and that
   * the state allows `op`; this method does not.
   *
   * Resolves `{ kind: 'done' }` once the 204 came back AND the re-read ended (a read that fails
   * still resolves: it flags `mcp.failed` as always), or `{ kind: 'failed', message, notFound }`
   * with the scrubbed message of the error when there is no server, the server changed meanwhile,
   * or the call threw; `notFound` is true for `McpServerNotFoundError` (the server left the config
   * since the last read). Never throws. Writes one `info` line `mcp <op>: <server>` or one `warn`
   * line `mcp <op> failed: <server>: <code>`, never the message of the error; EXCEPT when there is
   * no server (no `api`) or it was restarted during the call (the generation changed): both return
   * `failed` and write no line. Calls `client.experimental.mcp.connect/disconnect`, the 2.2 names
   * (the old `mcp.*` ones are deprecated aliases; same routes, issue #191).
   *
   * VERIFIED that the 204 of connect arrives only after the handshake of a LOCAL server, so the
   * re-read sees `connected` and not `pending`: the case "registers the integration of a remote
   * MCP server and connects and disconnects a local one" of `realOpencode.test.ts` printed
   * `mcp.connect: connected at return: true` (Windows 11, 10/11/2026, an opencode 2.2.5
   * executable, not the pinned 2.0.32). HYPOTHESIS for a remote server (a slow handshake or a
   * `failed` outcome was not run). The unit side is VERIFIED only against the fabricated client of
   * "the MCP actions" in `serverConfig.test.ts` (Windows 11, vitest).
   */
  async mcpAction(server: string, op: 'connect' | 'disconnect'): Promise<McpActionResult> {
    const api = this.api;
    if (api === undefined) {
      return {
        kind: 'failed',
        message: l10n.t('The opencode server is not running'),
        notFound: false,
      };
    }
    const generation = this.generation;
    try {
      if (op === 'connect') await api.experimental.mcp.connect({ server });
      else await api.experimental.mcp.disconnect({ server });
    } catch (error) {
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`mcp ${op} failed: ${server}: ${info.code}`);
      return {
        kind: 'failed',
        message: info.message,
        notFound: info.code === 'McpServerNotFoundError',
      };
    }
    if (generation !== this.generation) {
      return {
        kind: 'failed',
        message: l10n.t('The opencode server is not running'),
        notFound: false,
      };
    }
    this.log.info(`mcp ${op}: ${server}`);
    await this.mcpRead.request();
    return { kind: 'done' };
  }

  /**
   * One read of `config.get` and `config.shells` for `generation`, all or nothing: if one fails the
   * previous state stays and `failed` is set. {@link toShellState} reduces both by allow-list, so
   * nothing of a document but its `shell` reaches the snapshot.
   * VERIFIED by the "the shell of opencode" checks of `serverConfig.test.ts` (fabricated payloads
   * with planted secrets, vitest, Windows 11, 11/11/2026); a real server's payload was seen only by
   * the planner of #205.
   */
  private async readShell(generation: number): Promise<void> {
    const api = this.api;
    if (api === undefined) return;
    try {
      const [entries, shells] = await Promise.all([api.config.get(), api.config.shells()]);
      if (generation !== this.generation) return;
      this.shell = toShellState(entries, shells);
      this.shellLoaded = true;
      this.shellFailed = false;
    } catch (error) {
      if (generation !== this.generation) return;
      this.shellFailed = true;
      this.warnFailed('shell read', error);
    }
    this.notify();
  }

  /**
   * Sets the shell of opencode (`''` removes it, so opencode picks one) by patching the GLOBAL
   * opencode config with `client.experimental.config.update`, then waits for the server to reload
   * and reads the shell again, so the caller judges the state AFTER the change (no optimistic
   * value). The caller has already checked `value` against the options of the snapshot; this
   * method does not.
   *
   * The 204 answers BEFORE the reload: a `config.get` right after it returns the old value, so the
   * re-read waits for the next `config.updated` (see {@link ServerConfig.event}) or, at most,
   * {@link SHELL_SETTLE_MS} after the 204, and then goes on either way: a patch that changes
   * nothing publishes no event, and on a very slow machine the re-read can still see the old
   * value (the `config.updated` that arrives later corrects it). `snapshot().shell.writing` is
   * true from the call until the re-read ends. The waiter is installed BEFORE the write, because
   * the event may arrive before the 204. Any `config.updated` (the TUI, a file watcher) between
   * installing the waiter and the reload also releases the wait early, so the re-read may still see
   * the old value; the later real `config.updated` goes to the plain read and corrects it.
   *
   * Resolves `{ kind: 'done' }` once the re-read ended (a read that fails still resolves: it sets
   * `shell.failed`), or `{ kind: 'failed', message }` with the scrubbed message of the error when
   * the write threw, there is no server, or the server was replaced meanwhile. Never throws.
   * Writes one `info` line `shell set` or one `warn` line `shell set failed: <code>`, never the
   * value (a path may carry the user name); the no-server and replaced-server returns write none.
   * VERIFIED by the "shell actions" checks of `serverConfig.test.ts` (fake client, vitest, Windows
   * 11, 11/11/2026): one PATCH with `{ shell: null }` for `''` and `{ shell: value }` otherwise,
   * "does not re-read before config.updated", the re-read on the event, the re-read after
   * SHELL_SETTLE_MS without one, `writing` true during and false after, a failure with its code
   * and no value in the log, and a replaced server giving up silently. The write against a real
   * server was observed only by the planner of #205 (2.2.7, Windows 11, 11/11/2026, isolated
   * config dir); no test of this repository writes a real opencode config.
   */
  async shellAction(value: string): Promise<ShellActionResult> {
    const api = this.api;
    if (api === undefined) {
      return { kind: 'failed', message: l10n.t('The opencode server is not running') };
    }
    const generation = this.generation;
    let arrived = false;
    let wake: () => void = () => undefined;
    const event = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const waiter = (): void => {
      arrived = true;
      this.clearShellWaiter(waiter);
      wake();
    };
    this.shellWaiter = waiter;
    this.shellWriting = true;
    this.notify();
    const done = (): void => {
      if (generation !== this.generation) return;
      this.shellWriting = false;
      this.notify();
    };
    try {
      await api.experimental.config.update({ shell: value === '' ? null : value });
    } catch (error) {
      this.clearShellWaiter(waiter);
      done();
      if (generation !== this.generation) {
        return { kind: 'failed', message: l10n.t('The opencode server is not running') };
      }
      const info = toErrorInfo(error, this.secrets);
      this.log.warn(`shell set failed: ${info.code}`);
      return { kind: 'failed', message: info.message };
    }
    if (!arrived) {
      const timer = setTimeout(wake, SHELL_SETTLE_MS);
      timer.unref();
      await event;
      clearTimeout(timer);
    }
    this.clearShellWaiter(waiter);
    if (generation !== this.generation) {
      return { kind: 'failed', message: l10n.t('The opencode server is not running') };
    }
    this.log.info('shell set');
    await this.shellRead.request();
    done();
    return { kind: 'done' };
  }

  /**
   * Clears the pending shell waiter only if it is still `waiter`.
   *
   * A write on a replaced server may settle after a newer `shellAction` installed its own waiter;
   * clearing unconditionally would send the newer write's `config.updated` to the plain read and
   * make it sleep the whole SHELL_SETTLE_MS. VERIFIED by the "does not clear the waiter of a newer
   * write" check of `serverConfig.test.ts` (fake client, vitest, Windows 11, 11/11/2026).
   */
  private clearShellWaiter(waiter: () => void): void {
    if (this.shellWaiter === waiter) this.shellWaiter = undefined;
  }

  /**
   * One read of `mcp.list` for `generation`. `afterEvent` is sampled BEFORE the request: only a
   * read that started after an `mcp.status.changed` may believe an empty list. The grace timer
   * (one per attach) covers a server with no MCP servers at all, which never sends the event.
   * Each row keeps the `integrationID` and the whole error ({@link detailText}) the server sent.
   * When a server names an integration the integration rows do not have (and they were already
   * read once), the integrations are read again: the server registers the `mcp_...` integration
   * with its MCP state, and a list read just before that would leave "Sign in" without its row.
   * VERIFIED that a remote server's `mcp_...` integration (`metadata.source === 'mcp'`, an oauth
   * method) is in `integration.list` of a running server and that `mcp.list` gives the server the
   * same `integrationID`: the case "registers the integration of a remote MCP server and connects
   * and disconnects a local one" of `realOpencode.test.ts` passed (Windows 11, 10/11/2026, an
   * opencode 2.2.5 executable, not the pinned 2.0.32). That case polls up to 30 s, so whether the
   * integration is there in the FIRST read stays HYPOTHESIS; that is what the re-read covers.
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
      if (
        this.integrationsLoaded &&
        this.mcpList.some(
          (server) =>
            server.integrationID !== undefined &&
            !this.integrations.some((row) => row.id === server.integrationID),
        )
      ) {
        void this.integrationRead.request();
      }
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
