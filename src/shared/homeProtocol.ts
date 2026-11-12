// The protocol of the Quick start view (`openVsCode.home`, issue #187, E9-sidebar-home), between the
// extension host and its small webview. Its own module with its own two unions, like
// `settingsProtocol.ts`, so the chat validator never accepts a home message and the other way
// round. No `vscode`, no Node.
//
// Architecture rule 1: the webview only sends INTENTIONS (start, stop, reply, open, action, mode,
// model).
// None carries a port, a password or a path, and the host REVALIDATES each against its own state
// (`homeController.ts`): the guard below only checks shape and bounds.

import type { ConnectionState } from './protocol';
import { field, isNonEmptyString, isPlainObject } from './protocol';

/**
 * Longest text one `home.start` may carry. Our own choice: the compose guard of the chat
 * (`isComposeInBounds`) only refuses blank text, so the cap lives here, big enough for a pasted
 * log and small enough that a message is not megabytes.
 */
export const MAX_HOME_TEXT = 20_000;
/** Longest id (request, session, permission) accepted from the webview. Our own choice. */
export const MAX_HOME_ID = 200;
/** Longest title or name the host writes into a row; longer ones are cut. Our own choice. */
export const MAX_HOME_LABEL = 200;

/** Whether the NEXT conversation that starts from the box asks before it acts (`manual`) or not. */
export type HomeMode = 'manual' | 'auto';

/** The actions of the status pills: existing commands, nothing else can be asked. */
export type HomeAction = 'restart' | 'logs' | 'settings';

/** What a running session is doing, in words the webview translates. */
export type HomeActivity =
  { kind: 'thinking' } | { kind: 'writing' } | { kind: 'tool'; name: string };

/** One root session that runs now. */
export interface HomeRunning {
  sessionID: string;
  /** The session title, `''` for an untitled one. */
  title: string;
  /** Epoch ms the execution began, absent when the host only knows it runs (no time is invented). */
  since?: number;
  /** What the root itself is doing now; absent between steps. */
  activity?: HomeActivity;
  /** How many descendants run (subagents), 0 when none. */
  subagents: number;
  /** The most recent running subagent: its agent and what it does; absent without one. */
  child?: { agent?: string; activity?: HomeActivity };
}

/** One request (permission or question) that waits for the user, filed under its ROOT session. */
export interface HomeWaiting {
  kind: 'permission' | 'form';
  /** The session that asked (it can be a subagent); the host revalidates the triple on `home.reply`. */
  sessionID: string;
  id: string;
  /** Title of the root session the request belongs to. */
  title: string;
}

/** The whole state the view draws; the host sends it whole, never a delta. */
export interface HomeState {
  /** The server, as the status pill needs it. `reason` only for `unavailable`. */
  server: { state: ConnectionState['state']; reason?: string };
  /** False when a prompt cannot be started at all (no folder, server unusable). */
  canStart: boolean;
  /** The model the next conversation starts with, absent while the catalog is unknown. */
  model?: string;
  /** True when `model` is the user's choice for the next conversation, false for the default. */
  modelChosen: boolean;
  mode: HomeMode;
  /** MCP servers in `failed` or `needs_auth`; none for a healthy or still loading list. */
  mcp: { name: string; status: 'failed' | 'needs_auth' }[];
  running: HomeRunning[];
  waiting: HomeWaiting[];
}

/** Host to home webview. `home.result` answers a `home.start` or `home.stop` by its `requestId`. */
export type HomeHostToWebview =
  | { type: 'home.state'; state: HomeState }
  | { type: 'home.result'; requestId: string; ok: boolean; error?: string };

/** Home webview to host. */
export type HomeWebviewToHost =
  | { type: 'home.ready' }
  | { type: 'home.start'; requestId: string; text: string }
  | { type: 'home.stop'; requestId: string; sessionID: string }
  | { type: 'home.reply'; kind: 'permission' | 'form'; sessionID: string; id: string }
  | { type: 'home.open'; sessionID: string }
  | { type: 'home.action'; action: HomeAction }
  | { type: 'home.mode'; mode: HomeMode }
  | { type: 'home.model' };

/** True for an id: a non-empty string of at most {@link MAX_HOME_ID} characters. */
function isId(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= MAX_HOME_ID;
}

/** The fields each webview message may have besides `type`, and the check of their values. */
const WEBVIEW_SHAPES: Record<
  HomeWebviewToHost['type'],
  { keys: readonly string[]; valid: (message: Record<string, unknown>) => boolean }
> = {
  'home.ready': { keys: [], valid: () => true },
  'home.start': {
    keys: ['requestId', 'text'],
    valid: (m) => {
      const text = field(m, 'text');
      return (
        isId(field(m, 'requestId')) &&
        typeof text === 'string' &&
        text.trim().length > 0 &&
        text.length <= MAX_HOME_TEXT
      );
    },
  },
  'home.stop': {
    keys: ['requestId', 'sessionID'],
    valid: (m) => isId(field(m, 'requestId')) && isId(field(m, 'sessionID')),
  },
  'home.reply': {
    keys: ['kind', 'sessionID', 'id'],
    valid: (m) => {
      const kind = field(m, 'kind');
      return (
        (kind === 'permission' || kind === 'form') &&
        isId(field(m, 'sessionID')) &&
        isId(field(m, 'id'))
      );
    },
  },
  'home.open': { keys: ['sessionID'], valid: (m) => isId(field(m, 'sessionID')) },
  'home.action': {
    keys: ['action'],
    valid: (m) => {
      const action = field(m, 'action');
      return action === 'restart' || action === 'logs' || action === 'settings';
    },
  },
  'home.mode': {
    keys: ['mode'],
    valid: (m) => {
      const mode = field(m, 'mode');
      return mode === 'manual' || mode === 'auto';
    },
  },
  // No fields on purpose: the webview only says "open the picker"; the host builds the list from its
  // own catalog and revalidates the answer, so the webview never names a model.
  'home.model': { keys: [], valid: () => true },
};

/**
 * Guard for messages arriving at the host from the home webview, which is untrusted input.
 *
 * Accepts only a plain object whose `type` is one of the eight known ones (`home.model` takes no
 * field), whose own properties
 * are EXACTLY `type` plus the ones that type declares (so a `password`, `port` or any other extra
 * field makes it fail), and whose values pass the bounds above: ids up to 200 characters, a start
 * text that is not blank and has at most 20 000. Never throws: a hostile object or a throwing
 * getter gives `false`. Whether a session is running or a request pending is NOT checked here;
 * `homeController.ts` revalidates against the host's own state.
 * VERIFIED by `homeProtocol.test.ts` with fabricated messages (each message of the union, blank and
 * oversized text, extra fields, a throwing getter; Windows 11, Vitest). VERIFIED from a real DOM
 * `postMessage` by step 50 in the full run of E9-sidebar-home on its final tree (Windows 11, VS
 * Code 1.145.2, 08/11/2026, "all visual checks passed"): "ok   F1 Enter opened
 * exactly one new tab with one accepted prompt and cleared the box" and "ok   F3 with Auto in the
 * strip the new conversation logged "work mode auto for ses_…" and a second tab". VERIFIED for
 * `home.model` from a real DOM click by two `--steps 43,50,51` runs of E9-home-model-picker
 * (Windows 11, VS Code 1.146.0, 12/11/2026, "all visual checks passed"): "ok   P1 picking
 * "GLM-5.3-Flash Free" in the picker puts it in the pill with data-chosen="true" and opens no
 * OpenCode Settings tab" and "ok   F8 the MCP pill opens the OpenCode Settings tab, once (1 tab)".
 */
export function isHomeWebviewToHost(value: unknown): value is HomeWebviewToHost {
  try {
    if (!isPlainObject(value)) return false;
    const type = field(value, 'type');
    if (typeof type !== 'string' || !Object.hasOwn(WEBVIEW_SHAPES, type)) return false;
    const shape = WEBVIEW_SHAPES[type as HomeWebviewToHost['type']];
    const allowed = new Set<string>(['type', ...shape.keys]);
    if (!Object.keys(value).every((key) => allowed.has(key))) return false;
    return shape.keys.every((key) => Object.hasOwn(value, key)) && shape.valid(value);
  } catch {
    return false;
  }
}

/**
 * Shallow guard for messages arriving at the home webview from the host: a plain object with one
 * of the two known `type`s. Shallow on purpose, like `isSettingsHostToWebview`: the host is our
 * own typed code and the state is rendered as text, never as HTML.
 */
export function isHomeHostToWebview(value: unknown): value is HomeHostToWebview {
  if (!isPlainObject(value)) return false;
  const type = field(value, 'type');
  return type === 'home.state' || type === 'home.result';
}
