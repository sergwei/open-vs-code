// Pure digest of what the host knows about a subagent child session (E2-subagent-monitor, issue
// #189): the `SubagentActivity` the webview gets. No `vscode` import and no runtime import of the
// client.
//
// Why a digest and not the raw child stream: forwarding every `part.*` of every child would need a
// second message tree in the webview and the text deltas of N children through `postMessage`. The
// webview only needs the state, the current tool, the last three and the number (plan Engram #2048).
//
// The tool counting, the slimming of tool inputs (`slimInput`, `MAX_INPUT_VALUE_CHARS`) and the
// secret scrubbing live in `sessionActivity.ts`, the registry that production feeds; this file only
// shapes one registry entry for the wire.

import type { SubagentActivity, SubagentTool } from '../shared/model';
import { RECENT_TOOLS } from './sessionActivity';

/**
 * What the registry knows of one child, as far as {@link toSubagentActivity} needs it. Declared
 * here, not imported from the registry, so the digest stays pure and testable on its own; the
 * controller adapts the registry's entry to it. `parentID` absent means the session is a root.
 */
export interface SubagentEntry {
  sessionID: string;
  parentID?: string;
  running: boolean;
  since?: number;
  endedAt?: number;
  tools: { count: number; recent: readonly SubagentTool[] };
  partial?: boolean;
}

/**
 * Builds the `SubagentActivity` the webview gets for one child, or `undefined` for a session with
 * no `parentID` (a root has no digest).
 *
 * Copies `recent` (the last {@link RECENT_TOOLS}, oldest first) so the registry's array is never
 * shared with a posted message, and leaves out `since`, `endedAt` and `partial` unless they hold a
 * value (`partial` only when true), because the shared type is strict about optional keys.
 * VERIFIED by `subagentDigest.test.ts` "omits absent optionals and copies the recent list".
 */
export function toSubagentActivity(entry: SubagentEntry): SubagentActivity | undefined {
  if (entry.parentID === undefined) return undefined;
  return {
    sessionID: entry.sessionID,
    parentID: entry.parentID,
    running: entry.running,
    ...(entry.since === undefined ? {} : { since: entry.since }),
    ...(entry.endedAt === undefined ? {} : { endedAt: entry.endedAt }),
    toolCount: entry.tools.count,
    ...(entry.partial === true ? { partial: true } : {}),
    recent: entry.tools.recent
      .slice(-RECENT_TOOLS)
      .map((tool) => ({ ...tool, input: { ...tool.input } })),
  };
}
