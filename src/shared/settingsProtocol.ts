// The protocol of the OpenCode Settings tab (issue #128, E10), between the extension host and the
// settings webview. It lives in its own module, with its own two discriminated unions, so that the
// validator of the chat does not accept settings messages and the other way round (decision P4,
// Engram `e10-config-views/decisions/plan-b-p1-p4`). No `vscode`, no Node.
//
// Security (architecture rule 1 and the plan's section 3): NO message carries a key, a token or a
// code. The API key and the OAuth code are asked with a native `InputBox` in the host. The
// validators of the webview side reject unknown properties, so a message with `key`, `apiKey` or
// `secret` never gets through even if a future webview bug put one there.

import type { ConnectionState } from './protocol';
import { field, isNonEmptyString, isPlainObject } from './protocol';

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
}

/** One MCP server with its resources and templates (read only). */
export interface SettingsMcpServerRow {
  name: string;
  status: 'connected' | 'pending' | 'disabled' | 'failed' | 'needs_auth';
  error?: string;
  resources: { name: string; uri: string; description?: string; mimeType?: string }[];
  templates: { name: string; uriTemplate: string; description?: string }[];
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
  providers: { loaded: boolean; failed: boolean; rows: ProviderRow[] };
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
  integrationID: string;
  kind: 'connected' | 'removed' | 'failed' | 'expired' | 'cancelled' | 'unsupported';
  message?: string;
}

/** Host to settings webview. */
export type SettingsHostToWebview =
  | { type: 'settings.state'; state: SettingsState }
  | { type: 'settings.notice'; notice: SettingsNotice };

/** The footer actions the webview may ask the host for (existing commands). */
export type SettingsAction = 'logs' | 'extensionSettings' | 'restart';

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
  | { type: 'settings.action'; action: SettingsAction };

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

/** True for one of the three footer actions. */
function isSettingsAction(value: unknown): value is SettingsAction {
  return value === 'logs' || value === 'extensionSettings' || value === 'restart';
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
};

/**
 * Guard for messages arriving at the host from the settings webview, which is untrusted input.
 *
 * Accepts only a plain object whose `type` is one of the seven known ones, whose own properties
 * are EXACTLY `type` plus the ones that type declares (so a `key`, `apiKey` or `secret` makes it
 * fail, as does any other extra field), and whose values pass the bounds above: ids up to 200
 * characters, a method index up to 100, at most 20 answers of at most 2000 characters. Never
 * throws: a throwing getter or a hostile object yields `false`. Whether the integration or method
 * exists is NOT checked here; `settingsController.ts` revalidates against the server's snapshot.
 *
 * VERIFIED by `settingsProtocol.test.ts` with fabricated messages (a message with `key`, `apiKey`
 * or `secret` is rejected; Windows 11, vitest) and, through `test.settingsMessage` (the same guard,
 * not a DOM `postMessage`), by the `fake-server` case "removes a credential only after a yes, and
 * refuses one of another provider". VERIFIED from the real DOM in a real VS Code 1.144.0 on Windows
 * 11 (1/11/2026, `npm run test:visual -- --group config`, against the synthetic server): messages
 * posted by mouse clicks in the tab passed this guard and did their work, "ok   W1 Cancel in the
 * card closes the native InputBox (closed true) and the card goes back to Add a provider …", "ok
 * V9 confirming the modal removes the credential: Azure is back in Add a provider with no Remove
 * button …" and "ok   V8 Copy code in the card puts ABCD-1234 on the clipboard …".
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
