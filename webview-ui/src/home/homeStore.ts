/**
 * What the Quick start document holds from the host (issue #187): the latest complete `home.state`
 * and a listener for the results of `home.start` and `home.stop`.
 *
 * The state arrives whole, never as a delta, but the three lists a row can be focused in (running,
 * waiting, MCP pills) are ALSO kept in a store and applied with `reconcile` by key, so a new state
 * with the same sessionID, `kind:id` or name keeps the SAME row object and `<For>` keeps the same DOM
 * element: a state posted on every tool start of a running session must not drop the keyboard focus
 * from "Stop" (review of E9-sidebar-home, B1).
 */
import { createSignal, type Accessor } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type {
  HomeHostToWebview,
  HomeRunning,
  HomeState,
  HomeWaiting,
} from '../../../src/shared/homeProtocol';

/** A `home.result`, as the component sees it. */
export interface HomeResult {
  requestId: string;
  ok: boolean;
  error?: string;
}

/** A waiting row with its stable key (`kind:id`), which `reconcile` matches rows by. */
export type HomeWaitingRow = HomeWaiting & { key: string };

/** The lists of the state, with identities that survive a new state; see the file header. */
export interface HomeLists {
  running: HomeRunning[];
  waiting: HomeWaitingRow[];
  mcp: HomeState['mcp'];
}

/** The reactive view of what the host sent. */
export interface HomeStore {
  /** The last complete state; `undefined` until the first `home.state` (the host answers `ready`). */
  state: Accessor<HomeState | undefined>;
  /** The lists of the last state with stable row identities (running by sessionID, waiting by `kind:id`, MCP by name). */
  lists: HomeLists;
  /** Applies one host message; `home.result` goes to the listeners in the order it arrived. */
  apply(message: HomeHostToWebview): void;
  /** Subscribes to results; returns the function that unsubscribes. */
  onResult(listener: (result: HomeResult) => void): () => void;
}

/**
 * Creates the store; call it inside a root (see `index.tsx`).
 * VERIFIED by `HomeApp.test.tsx` "keeps the same Stop, Reply and pill elements, and the focus,
 * across a new state of the same rows" (jsdom, fabricated states, 08/11/2026).
 */
export function createHomeStore(): HomeStore {
  const [state, setState] = createSignal<HomeState | undefined>();
  const [lists, setLists] = createStore<HomeLists>({ running: [], waiting: [], mcp: [] });
  const listeners = new Set<(result: HomeResult) => void>();
  return {
    state,
    lists,
    apply: (message) => {
      if (message.type === 'home.state') {
        setLists('running', reconcile(message.state.running, { key: 'sessionID', merge: true }));
        setLists(
          'waiting',
          reconcile(
            message.state.waiting.map((row) => ({ ...row, key: `${row.kind}:${row.id}` })),
            { key: 'key', merge: true },
          ),
        );
        setLists('mcp', reconcile(message.state.mcp, { key: 'name', merge: true }));
        setState(message.state);
        return;
      }
      const result: HomeResult = {
        requestId: message.requestId,
        ok: message.ok,
        ...(message.error === undefined ? {} : { error: message.error }),
      };
      for (const listener of [...listeners]) listener(result);
    },
    onResult: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
