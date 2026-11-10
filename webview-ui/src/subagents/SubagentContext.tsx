/**
 * What the tool cards and the bar of the subagent monitor (issue #189) read and do, behind one Solid
 * context so `MessageList` and `PartView` carry no extra props: `App` creates the monitor from the
 * store and provides it; a component that is rendered without a provider (most card tests) gets
 * `undefined` and draws the card it always drew.
 */
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
} from 'solid-js';
import type { Part, SessionSummary, SubagentActivity } from '../../../src/shared/model';
import type { ChatStore, FocusTarget } from '../store/chatStore';
import { childrenOf } from '../sessions/lineage';
import { childForTool, childState, type ChildState } from './subagentView';

/** One active child of the open session, as the bar lists it. */
export interface ActiveChild {
  row: SessionSummary;
  /** `working` or `waiting`: the bar lists no other state. */
  state: 'working' | 'waiting';
  activity: SubagentActivity | undefined;
}

/** What the monitor asks of `App`: the two actions that talk to the host. */
export interface SubagentActions {
  /** Opens the child as a session (the `session.open` of the sessions list). */
  open(childID: string): void;
  /**
   * Sends one `subagent.stop` for `parentID`: `childID` set stops that child, unset stops every
   * running child. `ids` are the children it concerns, so the caller can mark them as stopping.
   */
  stop(parentID: string, ids: string[], childID: string | undefined): void;
}

/** The reads and actions of the monitor. Every read is reactive (call it inside JSX or a memo). */
export interface SubagentMonitor {
  /** The child session the `subagent` tool block `part` belongs to (`childForTool`), if any. */
  childOf(part: Part): SessionSummary | undefined;
  /** The host's digest of a child, once it sent one. */
  activity(childID: string): SubagentActivity | undefined;
  /** The state of a child; `parentError` is the error text of its parent's tool block, if it failed. */
  stateOf(childID: string, parentError?: string): ChildState;
  /** The children of the open session that work or wait, oldest first. */
  active(): ActiveChild[];
  /**
   * The ids of {@link active}, in the same order. A NEW array only when the list of ids changes
   * (not when a child's state or digest does), so a keyed list built from it keeps its rows, and
   * the focus inside them, while data arrives; each row then reads {@link session},
   * {@link stateOf} and {@link activity} by id.
   */
  activeIds(): string[];
  /** The row of the child session in the store. */
  session(childID: string): SessionSummary | undefined;
  /** The permission or form of a child that waits for the user, in the shape the dock focuses. */
  waitingTarget(childID: string): FocusTarget | undefined;
  /** True while a `subagent.stop` for this child is in flight and the child still runs. */
  stopping(childID: string): boolean;
  /** `Date.now()` refreshed every second while some child is active; frozen otherwise. */
  now(): number;
  open(childID: string): void;
  /** Stops one child, or every active child when `childID` is omitted. Ignores a child already stopping. */
  stop(childID?: string): void;
  /** Asks the dock to focus the request the child waits on. Never focuses by itself. */
  answer(childID: string): void;
}

const Context = createContext<SubagentMonitor>();

/** The nearest provided monitor, or `undefined` outside `App` (a card then renders without live state). */
export function useSubagents(): SubagentMonitor | undefined {
  return useContext(Context);
}

/** The provider `App` wraps around its tree. */
export const SubagentProvider = Context.Provider;

/**
 * Builds the monitor over the store. Must run inside a reactive root (the component `App`): it owns
 * the one-second interval, which exists ONLY while some child is active (a signal cannot tick
 * for free) and is cleared when the last one stops or the root is disposed.
 *
 * `now()` feeds the elapsed time of the rows; the components render it `aria-hidden` and outside any
 * live region, so a tick announces nothing. Children "active" means `childState` is `working` or
 * `waiting`, with no parent error (the bar does not read the parent's failure blocks).
 *
 * Issue #200: a child exists (`session.created`) before its first `session.execution.*`, and in that
 * gap it has no status, so it would read `done` and the bar would blink away mid-turn (seen in the
 * fake's event timeline: creation to start took 517 ms with a sibling already finished). The
 * `startingIds` memo marks as `starting` the children linked (`childForTool`) to a `subagent` block
 * of the open session that is still `running`, but only while the open session is `busy` or `retry`
 * (a block left `running` after the parent was interrupted must not pin the bar). It reads `type`,
 * `name`, `state.status` and the link, never `text`, so a streamed delta does not re-run it
 * (HYPOTHESIS from the solid-webview store rules, not measured).
 *
 * Known limit (decision of Sergio, 10/11/2026): without metadata `childForTool` pairs a block with a
 * child by title and agent, so an older child with the same description and agent (after a reload,
 * say) can read `working` with a Stop button while the new block starts. The window is short and
 * Stop on an inactive child is harmless.
 * VERIFIED by `SubagentBar.test.tsx` "ticks the elapsed time once a second while a child works and
 * stops the interval when none does" (fake timers, fabricated store data), and by "keeps the bar
 * while a child is created but has not started (#200 sequence)", "has no bar for a starting child
 * when the parent is idle" and "has no bar for a child whose subagent block completed" (fabricated
 * store data).
 */
export function createSubagentMonitor(store: ChatStore, actions: SubagentActions): SubagentMonitor {
  const state = store.state;
  const waitingTarget = (childID: string): FocusTarget | undefined => {
    const permission = state.requests.permissions.find((ask) => ask.sessionID === childID);
    if (permission !== undefined) {
      return { kind: 'permission', sessionID: childID, id: permission.id };
    }
    const form = state.requests.forms.find((ask) => ask.sessionID === childID);
    return form === undefined ? undefined : { kind: 'form', sessionID: childID, id: form.id };
  };
  const startingIds = createMemo(
    (): ReadonlySet<string> => {
      const result = new Set<string>();
      const openID = state.open.sessionID;
      if (openID === undefined) return result;
      const parentType = state.statuses[openID]?.type;
      if (parentType !== 'busy' && parentType !== 'retry') return result;
      for (const parts of Object.values(state.open.parts)) {
        for (const part of parts) {
          if (part.type !== 'tool' || part.name !== 'subagent') continue;
          if (part.state.status !== 'running') continue;
          const child = childForTool(part, state.sessions, openID);
          if (child !== undefined) result.add(child.id);
        }
      }
      return result;
    },
    new Set<string>(),
    {
      equals: (previous, next) =>
        previous.size === next.size && [...next].every((id) => previous.has(id)),
    },
  );
  const stateOf = (childID: string, parentError?: string): ChildState =>
    childState({
      row: state.sessions[childID],
      status: state.statuses[childID],
      activity: state.subagents[childID],
      waiting: waitingTarget(childID) !== undefined,
      starting: startingIds().has(childID),
      ...(parentError === undefined ? {} : { parentError }),
    });
  const active = createMemo((): ActiveChild[] => {
    const openID = state.open.sessionID;
    if (openID === undefined) return [];
    const result: ActiveChild[] = [];
    for (const row of childrenOf(state.sessions, openID)) {
      const current = stateOf(row.id);
      if (current === 'working' || current === 'waiting') {
        result.push({ row, state: current, activity: state.subagents[row.id] });
      }
    }
    return result;
  });
  const activeIds = createMemo(() => active().map((child) => child.row.id), [] as string[], {
    equals: (previous, next) =>
      previous.length === next.length && previous.every((id, index) => id === next[index]),
  });
  const anyActive = createMemo(() => active().length > 0);

  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (!anyActive()) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    onCleanup(() => {
      clearInterval(timer);
    });
  });

  const stopping = (childID: string): boolean => {
    if (state.stopping[childID] === undefined) return false;
    const current = stateOf(childID);
    return current === 'working' || current === 'waiting';
  };

  return {
    childOf: (part) => childForTool(part, state.sessions, state.open.sessionID),
    activity: (childID) => state.subagents[childID],
    stateOf,
    active: () => active(),
    activeIds,
    session: (childID) => state.sessions[childID],
    waitingTarget,
    stopping,
    now,
    open: (childID) => {
      actions.open(childID);
    },
    stop: (childID) => {
      const parentID = state.open.sessionID;
      if (parentID === undefined) return;
      const ids =
        childID === undefined
          ? active()
              .map((child) => child.row.id)
              .filter((id) => !stopping(id))
          : stopping(childID)
            ? []
            : [childID];
      if (ids.length === 0) return;
      actions.stop(parentID, ids, childID);
    },
    answer: (childID) => {
      const target = waitingTarget(childID);
      if (target !== undefined) store.requestFocus(target);
    },
  };
}
