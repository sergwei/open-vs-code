/**
 * Helpers for the tests of the subagent monitor (issue #189). Not part of the bundle: only
 * `*.test.tsx` files import it. Everything it builds is FABRICATED: a real `createChatStore` fed
 * with host messages in the shape the plan describes, never a recorded stream.
 */
import { createRoot, type JSX } from 'solid-js';
import type {
  FormAsk,
  Part,
  PermissionAsk,
  SessionStatus,
  SessionSummary,
  SubagentActivity,
  SubagentTool,
} from '../../../src/shared/model';
import type { WebviewToHost } from '../../../src/shared/protocol';
import { createChatStore, type ChatStore } from '../store/chatStore';
import { mount, type Mounted } from '../testing';
import { createSubagentMonitor, SubagentProvider } from './SubagentContext';

/** The open session of every fixture. */
export const PARENT = 'ses_parent';

/** What a test mounted: the store to feed, the component's container and what the monitor did. */
export interface MonitorMount extends Mounted {
  store: ChatStore;
  /** The sessions the monitor asked to open. */
  opened: string[];
  /** The `subagent.stop` messages the stop action sent (the way `App` builds them). */
  stops: WebviewToHost[];
}

/**
 * Mounts `view` under a monitor over a fresh store that has `PARENT` open. The stop action does
 * what `App.stopSubagent` does (mark the children as stopping, send one message), because `App` is
 * not mounted here; `App.test.tsx` covers that function itself.
 */
export function mountWithMonitor(view: () => JSX.Element): MonitorMount {
  const opened: string[] = [];
  const stops: WebviewToHost[] = [];
  // The store is built and fed OUTSIDE the mounted view: `apply` reads state before it writes, and
  // inside the render's tracking scope that read-then-write re-runs the view forever (seen: the
  // first version of this helper hung the worker until it ran out of memory).
  const store = createRoot(() => createChatStore());
  store.apply({
    type: 'snapshot',
    snapshot: {
      sessions: [{ id: PARENT, createdAt: 1, updatedAt: 1 }],
      statuses: { [PARENT]: { type: 'busy' } },
      open: { sessionID: PARENT, messages: [], parts: {} },
      requests: { permissions: [], forms: [] },
      resolutions: [],
    },
  });
  const mounted = mount(() => {
    const monitor = createSubagentMonitor(store, {
      open: (id) => {
        opened.push(id);
      },
      stop: (parentID, ids, childID) => {
        const requestId = `stop_${String(stops.length + 1)}`;
        store.beginStop(ids, requestId);
        stops.push({
          type: 'subagent.stop',
          requestId,
          parentID,
          ...(childID === undefined ? {} : { sessionID: childID }),
        });
      },
    });
    return <SubagentProvider value={monitor}>{view()}</SubagentProvider>;
  });
  return { ...mounted, store, opened, stops };
}

/**
 * Adds a child of `PARENT` to the store with its status and, optionally, its digest. `status`
 * defaults to `busy`; `null` applies none, which is a child that exists (`session.created`) but has
 * not started (issue #200). FABRICATED.
 */
export function addChild(
  store: ChatStore,
  id: string,
  options: {
    title?: string;
    agent?: string;
    status?: SessionStatus | null;
    outcome?: SessionSummary['outcome'];
    cost?: number;
    activity?: Partial<SubagentActivity>;
    createdAt?: number;
  } = {},
): void {
  store.apply({
    type: 'session.upserted',
    session: {
      id,
      parentID: PARENT,
      title: options.title ?? `task ${id}`,
      agent: options.agent ?? 'general',
      createdAt: options.createdAt ?? 2,
      updatedAt: 2,
      ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
      ...(options.cost === undefined
        ? {}
        : {
            usage: {
              cost: options.cost,
              tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
            },
          }),
    },
  });
  if (options.status !== null) {
    store.apply({
      type: 'session.status',
      sessionID: id,
      status: options.status ?? { type: 'busy' },
    });
  }
  if (options.activity !== undefined) {
    store.apply({
      type: 'subagent.activity',
      sessionID: PARENT,
      activity: {
        sessionID: id,
        parentID: PARENT,
        running: true,
        toolCount: 0,
        recent: [],
        ...options.activity,
      },
    });
  }
}

/**
 * Upserts the `subagent` tool block of `PARENT` that created `childID` (or, with no `childID`, a
 * block with no link, as REST gives a running tool after a resync). `running` carries
 * `metadata {sessionID, status: 'running'}` the way `session.tool.progress` does; `completed` and
 * `error` carry the finished shapes. FABRICATED: the block shapes follow `lineage.ts`, nothing was
 * recorded from a real subagent turn.
 */
export function addSubagentBlock(
  store: ChatStore,
  options: {
    messageID: string;
    toolID: string;
    childID?: string;
    status: 'running' | 'completed' | 'error';
    description?: string;
    agent?: string;
  },
): void {
  const input = {
    description: options.description ?? 'task',
    agent: options.agent ?? 'general',
  };
  const metadata =
    options.childID === undefined
      ? {}
      : {
          metadata: {
            sessionID: options.childID,
            status: options.status === 'running' ? 'running' : 'completed',
          },
        };
  const state: Extract<Part, { type: 'tool' }>['state'] =
    options.status === 'running'
      ? { status: 'running', input, ...metadata }
      : options.status === 'completed'
        ? { status: 'completed', input, output: [], ...metadata }
        : {
            status: 'error',
            input,
            error: { code: 'tool.execution', message: 'Subagent failed' },
            ...metadata,
          };
  store.apply({
    type: 'part.upserted',
    sessionID: PARENT,
    messageID: options.messageID,
    part: { type: 'tool', id: options.toolID, name: 'subagent', state },
  });
}

/** A digest tool call. */
export function digestTool(
  id: string,
  status: SubagentTool['status'] = 'completed',
  path = 'src/a.ts',
): SubagentTool {
  return { id, name: 'read', status, input: { path } };
}

/** A pending permission of `sessionID`. */
export function permissionOf(sessionID: string, id = 'per_1'): PermissionAsk {
  return { id, sessionID, action: 'bash', resources: ['npm test'], save: [] };
}

/** A pending question of `sessionID`. */
export function formOf(sessionID: string, id = 'frm_1'): FormAsk {
  return { id, sessionID, title: 'Which one?', kind: 'question', fields: [] };
}
