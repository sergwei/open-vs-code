// The protocol of the OpenCode Settings tab (issue #128, E10), between the extension host and the
// settings webview. It lives in its own module, with its own two discriminated unions, so that the
// validator of the chat does not accept settings messages and the other way round (decision P4,
// Engram `e10-config-views/decisions/plan-b-p1-p4`). No `vscode`, no Node.
//
// Security (architecture rule 1 and the plan's section 3): NO message carries a key, a token or a
// code. The API key and the OAuth code are asked with a native `InputBox` in the host. The
// validators of the webview side reject unknown properties, so a message with `key`, `apiKey` or
// `secret` never gets through even if a future webview bug put one there.

import type { ModsListing } from './model';
import type { ConnectionState } from './protocol';
import { field, isNonEmptyString, isPlainObject, MOD_ID_PATTERN } from './protocol';

/** Longest id (integration, credential, field key) accepted from the webview. */
export const MAX_SETTINGS_ID = 200;
/** Most answers (form fields) one `settings.connect` may carry. */
export const MAX_SETTINGS_ANSWERS = 20;
/** Longest answer value accepted from the webview. */
export const MAX_SETTINGS_VALUE = 2000;
/** Largest method index accepted; real integrations have fewer than 10 methods. */
export const MAX_SETTINGS_METHOD_INDEX = 100;

/** A field of the form of a connection method; only `string` fields are supported by the tab. */
export interface SettingsFieldRow {
  key: string;
  title?: string;
  description?: string;
  required: boolean;
  placeholder?: string;
  default?: string;
  options?: { value: string; label: string; description?: string }[];
  when?: { key: string; op: 'eq' | 'neq'; value: string }[];
}

/** How an integration can be connected; `index` is the position in the server's `methods`. */
export interface SettingsMethodRow {
  index: number;
  type: 'key' | 'oauth' | 'external';
  /** The method id OAuth and external need; a `key` method has none. */
  id?: string;
  label: string;
  fields: SettingsFieldRow[];
  /** False when the form has a field the tab cannot render: then the tab says "use the CLI". */
  supported: boolean;
}

/** What an integration is connected through: a stored credential or an environment variable. */
export type SettingsConnectionRow =
  | {
      kind: 'credential';
      id: string;
      label: string;
      method: 'key' | 'oauth' | 'external';
      needsAuth?: string;
    }
  | { kind: 'env'; name: string; needsAuth?: string };

/** One provider (an `integration` of the server). */
export interface ProviderRow {
  id: string;
  name: string;
  connections: SettingsConnectionRow[];
  methods: SettingsMethodRow[];
  /**
   * How many models of the catalog this provider offers; ABSENT while the model list has not been
   * read (the webview must not say "0 models" then).
   */
  modelCount?: number;
}

/** One model of the server's catalog, as the default-model picker lists it. */
export interface SettingsModelRow {
  providerID: string;
  /** The catalog id (`ModelInfo.id`); `providerID/id` is what `openVsCode.defaultModel` holds. */
  id: string;
  name: string;
  providerName: string;
}

/**
 * Where `openVsCode.defaultModel` stands against the catalog the host holds: `none` (blank),
 * `applied` (written `provider/model` and offered), `invalid` (not written `provider/model`) and
 * `unavailable` (well written, but the catalog does not offer it). `unavailable` is computed against
 * the rows held NOW, so it only means something once `models.loaded` is true.
 */
export type SettingsPreferenceStatus = 'none' | 'applied' | 'invalid' | 'unavailable';

/** The `openVsCode.defaultModel` setting as the picker needs it. */
export interface SettingsPreference {
  /** The effective text of the setting (`provider/model`), or `''` when unset. */
  value: string;
  status: SettingsPreferenceStatus;
  /** True when the workspace or the folder has its own value, which hides the user's one. */
  workspaceOverride: boolean;
}

/** The settings of this extension the tab may open in the native Settings editor. */
export type SettingsSettingKey =
  'opencodePath' | 'serverUrl' | 'defaultModel' | 'chatLocation' | 'autoStart' | 'mods.enabled';

/** The closed list behind {@link SettingsSettingKey}; the host revalidates against it. */
export const SETTINGS_SETTING_KEYS: readonly SettingsSettingKey[] = [
  'opencodePath',
  'serverUrl',
  'defaultModel',
  'chatLocation',
  'autoStart',
  'mods.enabled',
];

/** What the tab may ask of one MCP server's connection. */
export type SettingsMcpOp = 'connect' | 'disconnect';

/**
 * One MCP server with its resources and templates. Since issue #186 (PR2) the tab can connect,
 * disconnect and sign in to it; the host revalidates every such request against its own snapshot.
 */
export interface SettingsMcpServerRow {
  name: string;
  status: 'connected' | 'pending' | 'disabled' | 'failed' | 'needs_auth';
  /** First line of the server's error (at most 200 characters), scrubbed; shown in the row. */
  error?: string;
  /**
   * The whole error (at most 20 lines and 2000 characters, scrubbed, CRLF read as line breaks) that
   * "Show details" unfolds. ABSENT when the error is one line or the server has none.
   */
  detail?: string;
  /**
   * The id of the integration the server registered for its OAuth sign-in (`mcp_` + hash), only when
   * it matches a row of the integration list marked `source: 'mcp'`. The webview compares it with
   * `state.attempt.integrationID` to show the sign-in in progress on this row.
   */
  integrationID?: string;
  /**
   * True when "Sign in" can work: the server needs auth, its integration is known and has an OAuth
   * method the tab can run. Computed by the host; the webview never guesses it.
   */
  canSignIn: boolean;
  resources: { name: string; uri: string; description?: string; mimeType?: string }[];
  templates: { name: string; uriTemplate: string; description?: string }[];
}

/** The two settings of the General section the tab writes itself (issue #186, PR3). */
export type SettingsWritableKey = 'chatLocation' | 'autoStart';

/** Where the chat opens, as `openVsCode.chatLocation` holds it. */
export type SettingsChatLocation = 'editor' | 'sidebar';

/** The values of the General section as the host reads them, with the workspace-override hint. */
export interface SettingsGeneral {
  chatLocation: { value: SettingsChatLocation; workspaceOverride: boolean };
  autoStart: { value: boolean; workspaceOverride: boolean };
}

/** The sign-in in progress, if any. `code` is the device code to copy, never a key. */
export interface AuthAttemptView {
  integrationID: string;
  phase: 'starting' | 'waiting' | 'finishing';
  instructions?: string;
  code?: string;
}

/** Everything the tab shows; the host sends it whole on every `ready` and on every change. */
export interface SettingsState {
  connection: ConnectionState;
  /** Basename of the served folder. */
  folder: string;
  serverVersion?: string;
  /**
   * `vscode.env.remoteName` when the window is remote (`ssh-remote`, `wsl`...). ABSENT means a
   * local window, and the card shows no remote hint then.
   */
  remote?: string;
  providers: { loaded: boolean; failed: boolean; rows: ProviderRow[] };
  models: {
    loaded: boolean;
    failed: boolean;
    rows: SettingsModelRow[];
    /** The model opencode itself proposes (`model.default`); ABSENT when it names none. */
    serverDefault?: { providerID: string; id: string; name: string };
  };
  preference: SettingsPreference;
  /** `openVsCode.chatLocation` and `openVsCode.autoStart`, which the General section edits. */
  general: SettingsGeneral;
  /**
   * The mods of this workspace (the same listing as the chat's mods popover). ABSENT when the host
   * has no mods half (the section says so instead of claiming there are no mods).
   */
  mods?: ModsListing;
  mcp: {
    loaded: boolean;
    failed: boolean;
    /** True while an empty first list may be an artefact: do not say "no MCP servers" yet. */
    pendingFirstRead: boolean;
    servers: SettingsMcpServerRow[];
  };
  attempt?: AuthAttemptView;
}

/** A one-shot message ("Connected to X", "Sign-in expired"); never carries a secret. */
export interface SettingsNotice {
  /** The integration the notice is about; `''` for the three `mcp*` kinds and an unparsed model. */
  integrationID: string;
  kind:
    | 'connected'
    | 'removed'
    | 'failed'
    | 'expired'
    | 'cancelled'
    | 'unsupported'
    /** A default-model request was refused or could not be saved; says nothing about sign-in. */
    | 'modelRefused'
    /** An MCP server is connected / disconnected / could not be connected after a tab request. */
    | 'mcpConnected'
    | 'mcpDisconnected'
    | 'mcpFailed'
    /** A General setting could not be saved; the message is a fixed text, never the value. */
    | 'settingFailed'
    /** A mod switch was refused or failed; the message is a fixed text. */
    | 'modFailed';
  message?: string;
  /** The MCP server's name, for the three `mcp*` kinds (the `mcp_...` id is no name to read out). */
  server?: string;
}

/** Host to settings webview. */
export type SettingsHostToWebview =
  | { type: 'settings.state'; state: SettingsState }
  | { type: 'settings.notice'; notice: SettingsNotice };

/**
 * The closed list of actions the webview may ask the host for (existing commands; the host maps
 * each to its command id in `SETTINGS_ACTION_COMMANDS`). `toggleWorkMode` is NOT in it on purpose
 * (decision P2 of E10-settings-sections): from the Settings tab it would flip a session the user
 * does not see; the Work mode section only offers `openChat`.
 */
export const SETTINGS_ACTIONS = [
  'logs',
  'extensionSettings',
  'restart',
  'reloadMods',
  'openModsFolder',
  'setServerPassword',
  'clearServerPassword',
  'managePermissions',
  'forgetPluginDecision',
  'openChat',
] as const;

/** One of the {@link SETTINGS_ACTIONS}. */
export type SettingsAction = (typeof SETTINGS_ACTIONS)[number];

/** Settings webview to host. No variant has a field for a key, a token or a code. */
export type SettingsWebviewToHost =
  | { type: 'settings.ready' }
  | { type: 'settings.refresh' }
  | {
      type: 'settings.connect';
      integrationID: string;
      /** Index into `ProviderRow.methods[].index`. */
      method: number;
      /** Answers of the method's form, by field key. Never the API key. */
      answer: Record<string, string>;
    }
  | { type: 'settings.cancel'; integrationID: string }
  | { type: 'settings.copyCode'; integrationID: string }
  | { type: 'settings.disconnect'; integrationID: string; credentialID: string }
  | { type: 'settings.action'; action: SettingsAction }
  /** `''` clears the setting; otherwise `provider/model`, revalidated against the catalog. */
  | { type: 'settings.setDefaultModel'; model: string }
  | { type: 'settings.openSetting'; key: SettingsSettingKey }
  /** Connect or disconnect one MCP server of the snapshot; never add or remove (decision P6). */
  | { type: 'settings.mcp'; server: string; op: SettingsMcpOp }
  /** Start the OAuth sign-in of a `needs_auth` MCP server through its integration. */
  | { type: 'settings.mcpSignIn'; server: string }
  /** Writes ONE of the two General settings (user scope); the host revalidates the value. */
  | { type: 'settings.setSetting'; key: 'chatLocation'; value: SettingsChatLocation }
  | { type: 'settings.setSetting'; key: 'autoStart'; value: boolean }
  /** Switches one mod on or off for this workspace; the host checks the id against its listing. */
  | { type: 'settings.modToggle'; modId: string; enabled: boolean };

/** True for a non-empty string of at most {@link MAX_SETTINGS_ID} characters. */
function isId(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= MAX_SETTINGS_ID;
}

/**
 * True for a flat map of at most {@link MAX_SETTINGS_ANSWERS} entries, keys 1..{@link MAX_SETTINGS_ID}
 * characters and string values up to {@link MAX_SETTINGS_VALUE}. Values other than strings are
 * refused (the tab only has `string` fields). The own-key check keeps a `__proto__` entry of a
 * parsed JSON from being read as anything else.
 */
function isAnswerMap(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > MAX_SETTINGS_ANSWERS) return false;
  return keys.every((key) => {
    const entry = field(value, key);
    return (
      key.length >= 1 &&
      key.length <= MAX_SETTINGS_ID &&
      typeof entry === 'string' &&
      entry.length <= MAX_SETTINGS_VALUE
    );
  });
}

/** True for a method index: a safe integer in `0..MAX_SETTINGS_METHOD_INDEX`. */
function isMethodIndex(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_SETTINGS_METHOD_INDEX
  );
}

/** True for one of the {@link SETTINGS_ACTIONS}. */
function isSettingsAction(value: unknown): value is SettingsAction {
  return SETTINGS_ACTIONS.some((action) => action === value);
}

/**
 * True for a `settings.setSetting` payload: EXACTLY `chatLocation` with `editor` or `sidebar`, or
 * `autoStart` with a boolean. Any other key (`opencodePath`, `serverUrl`, `defaultModel`...) or a
 * value of the other key's type is refused.
 */
function isSettingPair(message: Record<string, unknown>): boolean {
  const key = field(message, 'key');
  const value = field(message, 'value');
  if (key === 'chatLocation') return value === 'editor' || value === 'sidebar';
  if (key === 'autoStart') return typeof value === 'boolean';
  return false;
}

/** True for a key of the closed {@link SETTINGS_SETTING_KEYS} list. */
function isSettingKey(value: unknown): value is SettingsSettingKey {
  return SETTINGS_SETTING_KEYS.some((key) => key === value);
}

/**
 * True for the text of a default-model request: a string that is empty (clear the setting) or at
 * most `2 * MAX_SETTINGS_ID + 1` characters (`provider/model`, each half an id).
 */
function isModelText(value: unknown): boolean {
  return typeof value === 'string' && value.length <= 2 * MAX_SETTINGS_ID + 1;
}

/** True for one of the two MCP operations the tab may ask for. */
function isMcpOp(value: unknown): value is SettingsMcpOp {
  return value === 'connect' || value === 'disconnect';
}

/** The fields each webview message may have besides `type`, and the check of their values. */
const WEBVIEW_SHAPES: Record<
  SettingsWebviewToHost['type'],
  { keys: readonly string[]; valid: (message: Record<string, unknown>) => boolean }
> = {
  'settings.ready': { keys: [], valid: () => true },
  'settings.refresh': { keys: [], valid: () => true },
  'settings.connect': {
    keys: ['integrationID', 'method', 'answer'],
    valid: (m) =>
      isId(field(m, 'integrationID')) &&
      isMethodIndex(field(m, 'method')) &&
      isAnswerMap(field(m, 'answer')),
  },
  'settings.cancel': { keys: ['integrationID'], valid: (m) => isId(field(m, 'integrationID')) },
  'settings.copyCode': { keys: ['integrationID'], valid: (m) => isId(field(m, 'integrationID')) },
  'settings.disconnect': {
    keys: ['integrationID', 'credentialID'],
    valid: (m) => isId(field(m, 'integrationID')) && isId(field(m, 'credentialID')),
  },
  'settings.action': { keys: ['action'], valid: (m) => isSettingsAction(field(m, 'action')) },
  'settings.setDefaultModel': { keys: ['model'], valid: (m) => isModelText(field(m, 'model')) },
  'settings.openSetting': { keys: ['key'], valid: (m) => isSettingKey(field(m, 'key')) },
  'settings.mcp': {
    keys: ['server', 'op'],
    valid: (m) => isId(field(m, 'server')) && isMcpOp(field(m, 'op')),
  },
  'settings.mcpSignIn': { keys: ['server'], valid: (m) => isId(field(m, 'server')) },
  'settings.setSetting': { keys: ['key', 'value'], valid: isSettingPair },
  'settings.modToggle': {
    keys: ['modId', 'enabled'],
    valid: (m) => {
      const modId = field(m, 'modId');
      return (
        typeof modId === 'string' &&
        MOD_ID_PATTERN.test(modId) &&
        typeof field(m, 'enabled') === 'boolean'
      );
    },
  },
};

/**
 * Guard for messages arriving at the host from the settings webview, which is untrusted input.
 *
 * Accepts only a plain object whose `type` is one of the thirteen known ones, whose own properties
 * are EXACTLY `type` plus the ones that type declares (so a `apiKey` or `secret` makes it fail, as
 * does any other extra field; `settings.openSetting` DOES declare a `key`, which must be one of
 * {@link SETTINGS_SETTING_KEYS}, never free text; `settings.mcp` declares `server` and an `op` that
 * is `connect` or `disconnect`, so an `add` or `remove` never gets through), and whose values pass
 * the bounds above. Since PR3 of issue #186: `settings.action` takes only the ten names of
 * {@link SETTINGS_ACTIONS} (never a free command id, never `toggleWorkMode`); `settings.setSetting`
 * takes exactly `chatLocation` with `editor` or `sidebar`, or `autoStart` with a boolean, and
 * nothing else; `settings.modToggle` takes a `modId` that matches `MOD_ID_PATTERN` and a boolean
 * `enabled`. VERIFIED in a real host (Windows 11, VS Code 1.145.3, 10/11/2026) for the accepted
 * messages by the `main` integration cases "the Settings tab writes chatLocation and autoStart to
 * the USER settings, refuses other values and restores" and "refuses an unknown mod id from the
 * Settings tab and writes nothing" (both passing, through the real guard). Ids (an MCP
 * `server` name included) up
 * to 200 characters, a method index up to 100, at most 20 answers of at most 2000 characters, a
 * default-model text of at most 401 characters (empty allowed: it clears the setting). Never
 * throws: a throwing getter or a hostile object yields `false`. Whether the integration or method
 * exists is NOT checked here; `settingsController.ts` revalidates against the server's snapshot.
 *
 * VERIFIED by "takes a connect or disconnect of an MCP server and a sign-in, and nothing else" of
 * `settingsProtocol.test.ts` (fabricated messages, vitest, Windows 11, 10/11/2026): `settings.mcp`
 * with `add`, `remove`, an empty or 201-character `server`, or an extra `config`, `key`, `apiKey`,
 * `secret` or `add` is rejected, and `settings.mcpSignIn` with a `key`, a `secret` or an
 * `integrationID` is rejected. Through `test.settingsMessage` (the same guard, not a DOM
 * `postMessage`) the `fake-server` cases "disconnects and reconnects an MCP server from the
 * Settings tab" and "signs in to an MCP server through its integration" had it accept both
 * messages (Windows 11, VS Code, 10/11/2026). From the real DOM, VERIFIED in `test:visual` step 52
 * (VS Code 1.145.2, Windows 11, 10/11/2026): the buttons of the real webview posted both messages
 * and the host did the work, "ok   F1 Disconnect of docs: its row goes to disabled with [Connect]
 * and no resources, the busy mark showed while it waited (true), the MCP card says "0 of 4 active"
 * and the live region says "Disconnected from docs."" and "ok   F3 Sign in of linear: the attempt
 * showed in its row with [Cancel] (true), the approval connects it [Disconnect] with no attempt
 * left, the MCP card says "2 of 4 active", the live region says "Connected to linear." (the
 * server's name, not mcp_...) and Providers has no mcp_ row (0)". VERIFIED by `settingsProtocol.test.ts` with fabricated messages (a message with `key`, `apiKey`
 * or `secret` is rejected on `settings.ready`, `settings.connect`, `settings.cancel` and
 * `settings.setDefaultModel`; `settings.openSetting` accepts a `key` only from the closed list, and
 * rejects `apiKey` and `secret`; Windows 11, vitest, 07/11/2026) and, through `test.settingsMessage` (the same guard,
 * not a DOM `postMessage`), by the `fake-server` case "removes a credential only after a yes, and
 * refuses one of another provider". VERIFIED from the real DOM in a real VS Code 1.144.0 on Windows
 * 11 (1/11/2026, `npm run test:visual -- --group config`, against the synthetic server): messages
 * posted by mouse clicks in the tab passed this guard and did their work, "ok   W1 Cancel in the
 * card closes the native InputBox (closed true) and the card goes back to Add a provider …", "ok
 * V9 confirming the modal removes the credential: Azure is back in Add a provider with no
 * Disconnect button …" (the text of 7/11/2026, `--steps 36`; it said "Remove" before the redesign
 * of issue #186) and "ok   V8 Copy code in the card puts ABCD-1234 on the clipboard …".
 * The `--steps 36` run of 7/11/2026 was on an EARLIER tree than this one (the search box, the CSS
 * and the review fixes came after it); the final full `test:visual` of the branch is what covers
 * this tree, and no run of it is claimed here.
 */
export function isSettingsWebviewToHost(value: unknown): value is SettingsWebviewToHost {
  try {
    if (!isPlainObject(value)) return false;
    const type = field(value, 'type');
    if (typeof type !== 'string' || !Object.hasOwn(WEBVIEW_SHAPES, type)) return false;
    const shape = WEBVIEW_SHAPES[type as SettingsWebviewToHost['type']];
    const allowed = new Set<string>(['type', ...shape.keys]);
    if (!Object.keys(value).every((key) => allowed.has(key))) return false;
    return shape.keys.every((key) => Object.hasOwn(value, key)) && shape.valid(value);
  } catch {
    return false;
  }
}

/**
 * Shallow guard for messages arriving at the settings webview from the host: a plain object with
 * one of the two known `type`s. Shallow on purpose, like `isHostToWebview`: the host is our own
 * typed code, and the state is rendered as text, never as HTML.
 */
export function isSettingsHostToWebview(value: unknown): value is SettingsHostToWebview {
  if (!isPlainObject(value)) return false;
  const type = field(value, 'type');
  return type === 'settings.state' || type === 'settings.notice';
}
