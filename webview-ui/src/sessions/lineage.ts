/**
 * Pure helpers for the relations between sessions (issue #21): which subagent session a `subagent`
 * tool block points at, and which sessions are the children of the open one. No DOM and no Solid,
 * so Vitest drives them with plain objects.
 */
import type { JsonValue, Part, SessionSummary } from '../../../src/shared/model';

/** The session a `subagent` tool block points at, with what the link text needs. */
export interface SubagentLink {
  sessionID: string;
  agent?: string;
  description?: string;
  /** True while the child still runs (`metadata.status` is `running`). */
  running: boolean;
}

/** The string under `key` of a JSON object, or `undefined` when it is missing or not a string. */
function stringAt(object: { readonly [key: string]: JsonValue } | undefined, key: string) {
  const value = object?.[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * The subagent session a tool block links to, or `undefined` when it has none.
 *
 * The rule is upstream's (`stream-v2.subagent.ts` of opencode 2.0.32, read): the tool is named
 * `subagent` and its `metadata.sessionID` is a string starting with `ses` while `metadata.status`
 * is `running` or `completed`. The metadata arrives with the volatile `session.tool.progress` and
 * with `session.tool.success`; a block that is still being reloaded (REST gives `metadata: {}` for
 * a running tool, HYPOTHESIS read in `message-updater.ts`) or that failed has none, and then the
 * "Subagent sessions" list of the header is the way in. `agent` and `description` come from the
 * tool input and are only labels. VERIFIED against a real opencode 2.0.32 for the event order and
 * the metadata shape by the planner spike (Windows 11, 21/10/2026); the tests use fabricated blocks.
 */
export function subagentOf(part: Part): SubagentLink | undefined {
  if (part.type !== 'tool' || part.name !== 'subagent') return undefined;
  if (part.state.status === 'streaming') return undefined;
  const metadata = part.state.metadata;
  const sessionID = stringAt(metadata, 'sessionID');
  const status = stringAt(metadata, 'status');
  if (sessionID === undefined || !sessionID.startsWith('ses')) return undefined;
  if (status !== 'running' && status !== 'completed') return undefined;
  const link: SubagentLink = { sessionID, running: status === 'running' };
  const agent = stringAt(part.state.input, 'agent');
  if (agent !== undefined) link.agent = agent;
  const description = stringAt(part.state.input, 'description');
  if (description !== undefined) link.description = description;
  return link;
}

/**
 * The rows whose `parentID` is `parentID`, oldest first. The list of sessions shows only roots, so
 * the children of the open session come from `sessions` (the store's map of every row the host
 * has sent, which holds them because the snapshot brings the open session's children).
 */
export function childrenOf(
  sessions: { readonly [sessionID: string]: SessionSummary },
  parentID: string,
): SessionSummary[] {
  return Object.values(sessions)
    .filter((row) => row.parentID === parentID)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}
