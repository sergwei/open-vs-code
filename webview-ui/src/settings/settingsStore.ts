// The store of the OpenCode Settings tab (issue #128, E10): applies the host's `settings.state` and
// queues its `settings.notice`. Logic only, no DOM, so it is tested without rendering.
import * as l10n from '@vscode/l10n';
import { batch } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { ConnectionState } from '../../../src/shared/protocol';
import type {
  AuthAttemptView,
  SettingsHostToWebview,
  SettingsNotice,
  SettingsState,
} from '../../../src/shared/settingsProtocol';

/** What the store holds: the last `settings.state` and the notices not yet announced. */
export interface SettingsStoreState {
  /** False until the first `settings.state`: the tab says "Loading" instead of "no providers". */
  received: boolean;
  connection: ConnectionState;
  folder: string;
  serverVersion: string | undefined;
  /** `vscode.env.remoteName` of the host; `undefined` in a local window (no remote hint then). */
  remote: string | undefined;
  providers: SettingsState['providers'];
  models: SettingsState['models'];
  preference: SettingsState['preference'];
  general: SettingsState['general'];
  /** The mods listing; `undefined` when the host has no mods half (not "no mods"). */
  mods: SettingsState['mods'];
  /** The shell of opencode (issue #205); not read yet until the host says `loaded`. */
  shell: SettingsState['shell'];
  mcp: SettingsState['mcp'];
  attempt: AuthAttemptView | undefined;
  /** One-shot messages, oldest first; the consumer drains them with `drainNotices`. */
  notices: SettingsNotice[];
}

/** The store and its two operations. */
export interface SettingsStore {
  state: SettingsStoreState;
  /** Applies one host message. */
  apply(message: SettingsHostToWebview): void;
  /** Returns the queued notices in order and empties the queue. */
  drainNotices(): SettingsNotice[];
}

/**
 * Creates the store.
 *
 * A `settings.state` is a full snapshot, so it enters with `reconcile` keyed by `id` (providers)
 * and `name` (MCP servers), merging: the row objects keep their identity, so `<For>` keeps their
 * DOM (and the field the user is typing in) while the host refreshes the list. A `settings.notice`
 * is NOT state but an order, so it goes to a queue that the consumer drains in order: a single
 * `{ notice }` field would lose the second of two notices that arrive in the same batch
 * (solid-webview section 3). Since issue #186 the state also carries `models` and `preference`:
 * the model rows are REPLACED whole (not reconciled by `id`, because a catalog id repeats across
 * providers, so a key by `id` would merge two models into one), `serverDefault` disappears when the
 * host stops sending it, and `preference` is reconciled in place. PR3 adds `general` (reconciled in
 * place) and `mods` (the listing: its `mods` rows reconciled by `id` so a row keeps its DOM, its
 * `skipped` folders replaced, and `undefined` again when the host stops sending it; VERIFIED by the
 * "mods" cases of `settingsStore.test.ts`, fabricated). Issue #205 adds `shell`: its fields are
 * copied one by one and its `options` reconciled in place by `value`, so the select keeps its DOM;
 * VERIFIED by "keeps the shell options and their DOM across states" of `settingsStore.test.ts`
 * (fabricated). VERIFIED by `settingsStore.test.ts`
 * (fabricated messages: it proves identity, order and, in "keeps two models that share an id across
 * providers, and drops a default the host stops sending", that two providers' models with the same
 * id stay two rows; not what the real host sends).
 */
export function createSettingsStore(): SettingsStore {
  const [state, setState] = createStore<SettingsStoreState>({
    received: false,
    connection: { state: 'not-started', reason: 'auto-start-off' },
    folder: '',
    serverVersion: undefined,
    remote: undefined,
    providers: { loaded: false, failed: false, rows: [] },
    models: { loaded: false, failed: false, rows: [], serverDefault: undefined },
    preference: { value: '', status: 'none', workspaceOverride: false },
    general: {
      chatLocation: { value: 'editor', workspaceOverride: false },
      autoStart: { value: true, workspaceOverride: false },
    },
    mods: undefined,
    shell: {
      loaded: false,
      failed: false,
      writing: false,
      current: '',
      overridden: false,
      options: [],
    },
    mcp: { loaded: false, failed: false, pendingFirstRead: true, servers: [] },
    attempt: undefined,
    notices: [],
  });
  return {
    state,
    apply(message) {
      if (message.type === 'settings.notice') {
        setState('notices', state.notices.length, message.notice);
        return;
      }
      const next = message.state;
      batch(() => {
        setState('received', true);
        setState('connection', reconcile(next.connection));
        setState('folder', next.folder);
        setState('serverVersion', next.serverVersion);
        setState('remote', next.remote);
        setState('providers', 'loaded', next.providers.loaded);
        setState('providers', 'failed', next.providers.failed);
        setState('providers', 'rows', reconcile(next.providers.rows, { key: 'id', merge: true }));
        setState('models', 'loaded', next.models.loaded);
        setState('models', 'failed', next.models.failed);
        // Plain replace, not `reconcile` by `id`: a catalog id repeats across providers.
        setState('models', 'rows', next.models.rows);
        setState('models', 'serverDefault', next.models.serverDefault);
        setState('preference', reconcile(next.preference));
        setState('general', reconcile(next.general));
        if (next.mods === undefined) {
          setState('mods', undefined);
        } else if (state.mods === undefined) {
          setState('mods', structuredClone(next.mods));
        } else {
          setState('mods', 'enabled', next.mods.enabled);
          setState('mods', 'persisted', next.mods.persisted);
          // By `id`, merging: the row of a mod keeps its DOM (and the focus of its switch) while
          // the listing refreshes. The skipped folders have no identity to keep: replaced.
          setState('mods', 'mods', reconcile(next.mods.mods, { key: 'id', merge: true }));
          setState('mods', 'skipped', next.mods.skipped);
        }
        // In place, the options by `value`: the select keeps its DOM (and its focus) across states.
        setState('shell', 'loaded', next.shell.loaded);
        setState('shell', 'failed', next.shell.failed);
        setState('shell', 'writing', next.shell.writing);
        setState('shell', 'current', next.shell.current);
        setState('shell', 'overridden', next.shell.overridden);
        setState('shell', 'options', reconcile(next.shell.options, { key: 'value', merge: true }));
        setState('mcp', 'loaded', next.mcp.loaded);
        setState('mcp', 'failed', next.mcp.failed);
        setState('mcp', 'pendingFirstRead', next.mcp.pendingFirstRead);
        setState('mcp', 'servers', reconcile(next.mcp.servers, { key: 'name', merge: true }));
        if (next.attempt === undefined) {
          setState('attempt', undefined);
        } else {
          setState('attempt', reconcile(next.attempt));
        }
      });
    },
    drainNotices() {
      const drained = state.notices.map((notice) => ({ ...notice }));
      if (drained.length > 0) setState('notices', []);
      return drained;
    },
  };
}

/**
 * The sentence the live region says for a notice. `name` is the provider's display name (the
 * caller looks it up; the id is the fallback). The `message` of the host is appended for the
 * kinds where it explains a problem (`failed`, `unsupported`, `modelRefused` and `mcpFailed`), as
 * plain text. `modelRefused` is a default-model request that was refused or not saved: it names no
 * provider and never says "Sign-in" (VERIFIED by the check "words a refused model without
 * mentioning sign-in" of `settingsStore.test.ts`, fabricated notice, vitest, Windows 11,
 * 08/11/2026). `settingFailed` (a General setting could not be saved) and `modFailed` (a mod
 * switch was refused) say the setting or the mod "was not changed" and append the host's fixed
 * `message`; VERIFIED by "words the General setting and mod notices" of `settingsStore.test.ts`
 * (fabricated notices, vitest). `shellFailed` (the shell of opencode was refused or not written,
 * issue #205) says "The shell was not changed." plus the host's `message`; VERIFIED by
 * "words the shell notice" of `settingsStore.test.ts` (fabricated notice, vitest). The three `mcp*` kinds (issue #186, PR2) are the answer to a Connect, Disconnect or
 * Retry of an MCP server and name it by `name` (the caller passes the server's name, never the
 * `mcp_...` id): `mcpFailed` says the server "could not be changed" because it covers a refused
 * request, a failed disconnect and a connect that ended failed alike, and the `message` tells which.
 * VERIFIED by "words the three MCP notices with the server's name" of `settingsStore.test.ts`
 * (fabricated notices, vitest, Windows 11, 10/11/2026).
 */
export function noticeText(notice: SettingsNotice, name: string): string {
  const detail = notice.message === undefined || notice.message === '' ? '' : ` ${notice.message}`;
  switch (notice.kind) {
    case 'connected':
      return l10n.t('Connected to {0}.', name);
    case 'removed':
      return l10n.t('Removed the connection to {0}.', name);
    case 'failed':
      return `${l10n.t('Sign-in to {0} failed.', name)}${detail}`;
    case 'expired':
      return l10n.t('Sign-in to {0} expired.', name);
    case 'cancelled':
      return l10n.t('Sign-in to {0} was cancelled.', name);
    case 'modelRefused':
      return `${l10n.t('The default model was not changed.')}${detail}`;
    case 'mcpConnected':
      return l10n.t('Connected to {0}.', name);
    case 'mcpDisconnected':
      return l10n.t('Disconnected from {0}.', name);
    case 'mcpFailed':
      return `${l10n.t('{0} could not be changed.', name)}${detail}`;
    case 'settingFailed':
      return `${l10n.t('The setting was not changed.')}${detail}`;
    case 'modFailed':
      return `${l10n.t('The mod was not changed.')}${detail}`;
    case 'shellFailed':
      return `${l10n.t('The shell was not changed.')}${detail}`;
    case 'unsupported':
      return `${l10n.t('{0} cannot be set up here. Use opencode auth login in a terminal.', name)}${detail}`;
  }
}
