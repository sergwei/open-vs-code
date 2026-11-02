// Messages between the extension host and a mod's Worker (E10-mods, plan Engram #1765 section
// 3.5). Two discriminated unions, each with a guard that enforces the limits. PURE: no `vscode`,
// no I/O. This is NOT the host <-> webview protocol of `src/shared` (the webview never sees these).
//
// Direction of trust: the Worker runs arbitrary user code, so `isWorkerToHost` is the border check
// of the host and every limit lives here, in one place. `isHostToWorker` only protects the
// bootstrap from a malformed message of its own host.

import type { ModEvent, ModJson, ModSeverity } from './api';

/** Longest status band text. Own choice (plan 3.5): one line above the composer at 300 px. */
export const MAX_STATUS_TEXT = 120;
/** Longest status tooltip and toast message. Own choice (plan 3.5). */
export const MAX_TOOLTIP = 500;
export const MAX_TOAST = 500;
/** Most buttons on a toast (the native notification API allows a few; plan 3.5 says 3). */
export const MAX_TOAST_ACTIONS = 3;
/** Longest toast button label. Own choice. */
export const MAX_ACTION_LABEL = 40;
/** Longest command description. Own choice. */
export const MAX_COMMAND_DESCRIPTION = 200;
/** Longest log line and error report from a Worker. Own choice: logs go to one output channel. */
export const MAX_LOG_TEXT = 4000;
/** Longest text a mod can drop into the chat composer. Own choice: far above a prompt typed by hand. */
export const MAX_COMPOSE_TEXT = 20_000;
/** Most commands one mod may register (plan 3.5). */
export const MAX_COMMANDS_PER_MOD = 20;
/** Most mods loaded at once (plan 3.5). */
export const MAX_MODS = 20;
/** Longest args string of a command run. Own choice: same order as a typed `/` line. */
export const MAX_COMMAND_ARGS = 4000;

/** Most panels one mod may have open (plan section 4 F4; own choice: a few tabs, not a flood). */
export const MAX_PANELS_PER_MOD = 3;
/** Longest panel tab title. Own choice. */
export const MAX_PANEL_TITLE = 80;
/** Most scripts, and most stylesheets, one panel may declare. Own choice. */
export const MAX_PANEL_FILES = 16;
/** Longest relative path a panel names. Own choice, far under any OS path limit. */
export const MAX_PANEL_PATH = 200;
/** Largest panel message once serialized, either way: 1 MB (plan section 4 F4). */
export const MAX_PANEL_MESSAGE_BYTES = 1024 * 1024;

/** Names of commands: `<modId>:<name>` is what users see. */
export const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

const SEVERITIES: readonly ModSeverity[] = ['info', 'warning', 'error'];
const LOG_LEVELS = ['info', 'warn', 'error'] as const;
/** Level of a log line from a Worker. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Host -> Worker. `init` is the first message; everything else follows `ready`. */
export type HostToWorker =
  | {
      type: 'init';
      /** Absolute path of the entry file (already proven to lie inside the mod folder). */
      entry: string;
      mod: { id: string; name: string; version: string };
    }
  | { type: 'event'; event: ModEvent }
  | { type: 'command.run'; requestId: string; name: string; args: string; sessionID?: string }
  | { type: 'ping'; n: number }
  | { type: 'toast.result'; requestId: string; action?: string }
  /** A JSON value the page of panel `panelId` sent (already size-checked by the host). */
  | { type: 'panel.message'; panelId: string; data: ModJson }
  /** The user closed the tab of panel `panelId`. */
  | { type: 'panel.closed'; panelId: string }
  | { type: 'deactivate' };

/** Worker -> host. */
export type WorkerToHost =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'log'; level: LogLevel; text: string }
  | { type: 'error'; message: string }
  | { type: 'command.add'; name: string; description?: string }
  | { type: 'command.remove'; name: string }
  | { type: 'command.done'; requestId: string; error?: string }
  | {
      type: 'status.set';
      text: string;
      tooltip?: string;
      severity?: ModSeverity;
      command?: string;
    }
  | { type: 'status.clear' }
  | {
      type: 'toast';
      requestId: string;
      message: string;
      severity?: ModSeverity;
      actions?: string[];
    }
  | { type: 'compose'; text: string; send?: boolean }
  | {
      type: 'panel.open';
      panelId: string;
      title: string;
      /** Paths relative to the mod folder; the host resolves them and refuses any that leave it. */
      html: string;
      scripts?: string[];
      styles?: string[];
    }
  | { type: 'panel.message'; panelId: string; data: ModJson }
  | { type: 'panel.close'; panelId: string }
  | { type: 'pong'; n: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string of 1..max characters. */
function str(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/** `undefined` or a string of 0..max characters. */
function optStr(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= max);
}

function isSeverity(value: unknown): boolean {
  return value === undefined || SEVERITIES.includes(value as ModSeverity);
}

/**
 * True when `value` serializes to JSON of at most {@link MAX_PANEL_MESSAGE_BYTES} bytes.
 *
 * `undefined`, functions and anything `JSON.stringify` throws on (a cycle, a BigInt) are refused.
 * Measured in UTF-8 bytes of the serialization, which is what a webview message costs.
 */
export function isPanelData(value: unknown): value is ModJson {
  try {
    const text = JSON.stringify(value);
    return (
      typeof text === 'string' && new TextEncoder().encode(text).length <= MAX_PANEL_MESSAGE_BYTES
    );
  } catch {
    return false;
  }
}

/**
 * True when `value` is a relative path with one of `extensions`, in the shape the host resolves
 * inside the mod folder: no NUL, no leading separator, no drive letter, no `..` segment. This is
 * the first lock; the host still resolves the real path and refuses one that leaves the folder.
 */
function isPanelPath(value: unknown, extensions: readonly string[]): value is string {
  if (!str(value, MAX_PANEL_PATH) || value.includes('\0')) return false;
  if (/^[\\/]/.test(value) || /^[a-zA-Z]:/.test(value)) return false;
  if (value.split(/[\\/]/).includes('..')) return false;
  const lower = value.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

/** `undefined` or an array of at most {@link MAX_PANEL_FILES} paths with one of `extensions`. */
function isPanelPathList(value: unknown, extensions: readonly string[]): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= MAX_PANEL_FILES &&
      value.every((item) => isPanelPath(item, extensions)))
  );
}

/**
 * True when `value` is a well-formed message from a Worker, limits included.
 *
 * A message with an unknown `type`, a missing field, a text over its limit (status 120, tooltip
 * and toast 500, 3 toast actions, command names `^[a-z0-9][a-z0-9-]{0,47}$`, a panel title of 80,
 * panel paths that are not relative, inside-looking files of the right extension, and panel data
 * over 1 MB) or an extra-large log is rejected as a whole, never truncated: the host logs and
 * ignores it. VERIFIED by
 * `wire.test.ts` (each limit exactly at the cap and one over, Windows 11, 02/11/2026) with
 * fabricated messages; what a real Worker sends is covered by `modHost.test.ts`.
 */
export function isWorkerToHost(value: unknown): value is WorkerToHost {
  if (!isRecord(value) || typeof value['type'] !== 'string') return false;
  const v = value;
  switch (v['type']) {
    case 'ready':
    case 'status.clear':
      return true;
    case 'failed':
    case 'error':
      return str(v['message'], MAX_LOG_TEXT);
    case 'log':
      return LOG_LEVELS.includes(v['level'] as LogLevel) && str(v['text'], MAX_LOG_TEXT);
    case 'command.add':
      return (
        typeof v['name'] === 'string' &&
        COMMAND_NAME_PATTERN.test(v['name']) &&
        optStr(v['description'], MAX_COMMAND_DESCRIPTION)
      );
    case 'command.remove':
      return typeof v['name'] === 'string' && COMMAND_NAME_PATTERN.test(v['name']);
    case 'command.done':
      return str(v['requestId'], 100) && optStr(v['error'], MAX_LOG_TEXT);
    case 'status.set':
      return (
        str(v['text'], MAX_STATUS_TEXT) &&
        optStr(v['tooltip'], MAX_TOOLTIP) &&
        isSeverity(v['severity']) &&
        (v['command'] === undefined ||
          (typeof v['command'] === 'string' && COMMAND_NAME_PATTERN.test(v['command'])))
      );
    case 'toast': {
      const actions = v['actions'];
      return (
        str(v['requestId'], 100) &&
        str(v['message'], MAX_TOAST) &&
        isSeverity(v['severity']) &&
        (actions === undefined ||
          (Array.isArray(actions) &&
            actions.length <= MAX_TOAST_ACTIONS &&
            actions.every((a) => str(a, MAX_ACTION_LABEL))))
      );
    }
    case 'compose':
      return (
        str(v['text'], MAX_COMPOSE_TEXT) &&
        (v['send'] === undefined || typeof v['send'] === 'boolean')
      );
    case 'panel.open':
      return (
        str(v['panelId'], 100) &&
        str(v['title'], MAX_PANEL_TITLE) &&
        isPanelPath(v['html'], ['.html', '.htm']) &&
        isPanelPathList(v['scripts'], ['.js', '.mjs']) &&
        isPanelPathList(v['styles'], ['.css'])
      );
    case 'panel.message':
      return str(v['panelId'], 100) && isPanelData(v['data']);
    case 'panel.close':
      return str(v['panelId'], 100);
    case 'pong':
      return typeof v['n'] === 'number' && Number.isInteger(v['n']);
    default:
      return false;
  }
}

/**
 * True when `value` is a well-formed message from the host (what the bootstrap checks before it
 * acts). The `event` payload is only checked for its `type`: the host builds it from
 * `modEvents.ts`, and a mod handler gets whatever fields it has.
 */
export function isHostToWorker(value: unknown): value is HostToWorker {
  if (!isRecord(value) || typeof value['type'] !== 'string') return false;
  const v = value;
  switch (v['type']) {
    case 'init': {
      const mod = v['mod'];
      return (
        typeof v['entry'] === 'string' &&
        v['entry'] !== '' &&
        isRecord(mod) &&
        typeof mod['id'] === 'string' &&
        typeof mod['name'] === 'string' &&
        typeof mod['version'] === 'string'
      );
    }
    case 'event':
      return isRecord(v['event']) && typeof v['event']['type'] === 'string';
    case 'command.run':
      return (
        str(v['requestId'], 100) &&
        typeof v['name'] === 'string' &&
        typeof v['args'] === 'string' &&
        (v['sessionID'] === undefined || typeof v['sessionID'] === 'string')
      );
    case 'ping':
      return typeof v['n'] === 'number';
    case 'toast.result':
      return (
        str(v['requestId'], 100) && (v['action'] === undefined || typeof v['action'] === 'string')
      );
    case 'panel.message':
      return str(v['panelId'], 100) && isPanelData(v['data']);
    case 'panel.closed':
      return str(v['panelId'], 100);
    case 'deactivate':
      return true;
    default:
      return false;
  }
}
