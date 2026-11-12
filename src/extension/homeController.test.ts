// Protects the Quick start controller (E9-sidebar-home, #187): a COMPLETE state after `ready`, one
// post per burst and none when nothing the webview draws changed, MCP pills only for a real problem,
// and the REVALIDATION of every intention against the host's own state (rule 1: the webview is
// untrusted, a stale or forged stop/reply/open does nothing, a double Enter opens one tab).
// Provenance: fabricated sources and actions, no server and no VS Code; the real wiring is the
// `fake-server` suite and `test:visual` step 50.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeHostToWebview, HomeMode, HomeState } from '../shared/homeProtocol';
import type { Catalog, ModelOption, ModelRef } from '../shared/model';
import type { ConnectionState } from '../shared/protocol';
import { HomeController, type HomeControllerDeps } from './homeController';
import type { PendingSummary } from './pendingRequests';
import type { SessionActivity } from './sessionActivity';

/** A running `SessionActivity` of `sessionID` with no tools; FABRICATED, `patch` overrides fields. */
function activity(sessionID: string, patch: Partial<SessionActivity> = {}): SessionActivity {
  return {
    sessionID,
    running: true,
    tools: { count: 0, partial: false, recent: [] },
    ...patch,
  };
}

/** A catalog entry of provider `opencode`; FABRICATED. */
function option(id: string, name: string): ModelOption {
  return {
    providerID: 'opencode',
    id,
    name,
    status: 'active',
    contextLimit: 200_000,
    free: true,
    variants: [],
    images: false,
  };
}

const BIG: ModelRef = { providerID: 'opencode', id: 'big' };
const OTHER: ModelRef = { providerID: 'opencode', id: 'other' };

/** A catalog with two models whose server default is `Big Pickle`; FABRICATED. */
function catalogOf(
  serverDefault: ModelRef = BIG,
  ids: readonly string[] = ['big', 'other'],
): Catalog {
  const names: Record<string, string> = { big: 'Big Pickle', other: 'Other' };
  return {
    models: ids.map((id) => option(id, names[id] ?? id)),
    providers: [{ id: 'opencode', name: 'OpenCode' }],
    agents: [],
    serverDefault,
  };
}

interface Rig {
  controller: HomeController;
  posted: HomeHostToWebview[];
  calls: string[];
  sources: {
    connection: ConnectionState;
    catalog: Catalog | undefined;
    mcp: { name: string; status: string }[];
    running: string[];
    activities: Record<string, SessionActivity>;
    roots: Record<string, string>;
    pending: PendingSummary[];
  };
  release: (outcome: { ok: true } | { ok: false; error: string }) => void;
  startedModes: HomeMode[];
  /** The model each start received (`undefined` when none was chosen). */
  startedModels: (ModelRef | undefined)[];
  /** What each opening of the picker was told was current. */
  pickerCurrents: (ModelRef | undefined)[];
  /** Answers the picker that is open now (`undefined` = the user cancelled). */
  answerPick: (ref: ModelRef | undefined) => void;
  /** The messages the controller passed to `log.warn`, in order. */
  warnings: string[];
}

/** A controller over hand-written sources and a recorder of what it posts and calls; no VS Code. */
function rig(): Rig {
  const posted: HomeHostToWebview[] = [];
  const calls: string[] = [];
  const startedModes: HomeMode[] = [];
  const startedModels: (ModelRef | undefined)[] = [];
  const pickerCurrents: (ModelRef | undefined)[] = [];
  const warnings: string[] = [];
  let answerPick: Rig['answerPick'] = () => undefined;
  const sources: Rig['sources'] = {
    connection: { state: 'connected', serverVersion: '2.0.32' },
    catalog: catalogOf(),
    mcp: [],
    running: [],
    activities: {},
    roots: {},
    pending: [],
  };
  let release: Rig['release'] = () => undefined;
  const deps: HomeControllerDeps = {
    connection: () => sources.connection,
    catalog: () => sources.catalog,
    mcp: () => sources.mcp,
    runningSessions: () => sources.running,
    activityOf: (id) => sources.activities[id],
    rootOf: (id) => sources.roots[id] ?? id,
    labelOf: (id) => `title of ${id}`,
    pending: () => sources.pending,
    post: (message) => posted.push(message),
    log: {
      info: vi.fn(),
      warn: (line: string) => warnings.push(line),
      error: vi.fn(),
    } as unknown as HomeControllerDeps['log'],
    start: (_text, mode, model) => {
      calls.push('start');
      startedModes.push(mode);
      startedModels.push(model);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    pickModel: (current) => {
      calls.push('pick');
      pickerCurrents.push(current);
      return new Promise((resolve) => {
        answerPick = resolve;
      });
    },
    stop: (id) => {
      calls.push(`stop ${id}`);
      return Promise.resolve(true);
    },
    reply: (kind, sessionID, id) => calls.push(`reply ${kind} ${sessionID} ${id}`),
    open: (id) => calls.push(`open ${id}`),
    action: (action) => calls.push(`action ${action}`),
  };
  return {
    controller: new HomeController(deps),
    posted,
    calls,
    sources,
    release: (outcome) => release(outcome),
    startedModes,
    startedModels,
    pickerCurrents,
    answerPick: (ref) => answerPick(ref),
    warnings,
  };
}

/** The `home.state` payloads the rig recorded, in order. */
function states(r: Rig): HomeState[] {
  return r.posted.flatMap((m) => (m.type === 'home.state' ? [m.state] : []));
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('HomeController state', () => {
  it('sends the whole state at once on ready, and nothing before it', async () => {
    const r = rig();
    r.controller.changed();
    await vi.runAllTimersAsync();
    expect(r.posted).toEqual([]);
    r.sources.running = ['ses_1'];
    r.sources.activities.ses_1 = activity('ses_1', {
      since: 1000,
      current: { kind: 'tool', id: 't', name: 'bash', since: 1000 },
    });
    r.controller.onReady();
    expect(states(r)).toEqual([
      {
        server: { state: 'connected' },
        canStart: true,
        model: 'Big Pickle',
        modelChosen: false,
        mode: 'manual',
        mcp: [],
        running: [
          {
            sessionID: 'ses_1',
            title: 'title of ses_1',
            since: 1000,
            activity: { kind: 'tool', name: 'bash' },
            subagents: 0,
          },
        ],
        waiting: [],
      },
    ]);
  });

  it('posts once per burst and not at all when the state is unchanged, then again on a new ready', async () => {
    const r = rig();
    r.controller.onReady();
    r.posted.length = 0;
    r.controller.changed();
    r.controller.changed();
    r.controller.changed();
    await vi.runAllTimersAsync();
    expect(r.posted).toEqual([]); // nothing the box draws changed
    r.sources.catalog = catalogOf(OTHER);
    r.controller.changed();
    r.controller.changed();
    await vi.runAllTimersAsync();
    expect(states(r).map((s) => s.model)).toEqual(['Other']);
    r.controller.onReady(); // a new document: whole state again, equal or not
    expect(states(r)).toHaveLength(2);
  });

  it('posts nothing after the document closed', async () => {
    const r = rig();
    r.controller.onReady();
    r.controller.onClosed();
    r.posted.length = 0;
    r.sources.catalog = catalogOf(OTHER);
    r.controller.changed();
    await vi.runAllTimersAsync();
    expect(r.posted).toEqual([]);
  });

  it('marks only failed or needs_auth MCP servers, never a loading or healthy list', () => {
    const r = rig();
    r.sources.mcp = [
      { name: 'ok', status: 'connected' },
      { name: 'wait', status: 'pending' },
      { name: 'off', status: 'disabled' },
      { name: 'broken', status: 'failed' },
      { name: 'login', status: 'needs_auth' },
    ];
    expect(r.controller.buildState().mcp).toEqual([
      { name: 'broken', status: 'failed' },
      { name: 'login', status: 'needs_auth' },
    ]);
    r.sources.mcp = [];
    expect(r.controller.buildState().mcp).toEqual([]);
  });

  it('folds a running subagent into its root row and files a request under its root', () => {
    const r = rig();
    r.sources.running = ['root', 'child'];
    r.sources.roots = { child: 'root', root: 'root' };
    r.sources.activities = {
      root: activity('root', { since: 10, current: { kind: 'thinking', since: 10 } }),
      child: activity('child', {
        parentID: 'root',
        since: 20,
        agent: 'explore',
        current: { kind: 'writing', since: 20 },
      }),
    };
    r.sources.pending = [
      { kind: 'permission', id: 'per_1', sessionID: 'child', title: 't', detail: '' },
    ];
    const state = r.controller.buildState();
    expect(state.running).toEqual([
      {
        sessionID: 'root',
        title: 'title of root',
        since: 10,
        activity: { kind: 'thinking' },
        subagents: 1,
        child: { agent: 'explore', activity: { kind: 'writing' } },
      },
    ]);
    expect(state.waiting).toEqual([
      { kind: 'permission', sessionID: 'child', id: 'per_1', title: 'title of root' },
    ]);
  });

  it('does not invent a time or an activity for a session only REST says runs', () => {
    const r = rig();
    r.sources.running = ['ses_1'];
    expect(r.controller.buildState().running).toEqual([
      { sessionID: 'ses_1', title: 'title of ses_1', subagents: 0 },
    ]);
  });

  it('cannot start while the server is unavailable but can while it is not started', () => {
    const r = rig();
    r.sources.connection = { state: 'not-started', reason: 'auto-start-off' };
    expect(r.controller.buildState().canStart).toBe(true);
    r.sources.connection = {
      state: 'unavailable',
      reason: 'no-workspace',
      error: { code: 'x', message: 'm' },
    };
    const state = r.controller.buildState();
    expect(state.canStart).toBe(false);
    expect(state.server).toEqual({ state: 'unavailable', reason: 'no-workspace' });
  });
});

describe('HomeController intentions are revalidated', () => {
  it('stops only a root the host sees running, and answers the refusal', async () => {
    const r = rig();
    r.sources.running = ['ses_1'];
    await r.controller.onMessage({ type: 'home.stop', requestId: 'a', sessionID: 'forged' });
    expect(r.calls).toEqual([]);
    expect(r.posted).toMatchObject([{ type: 'home.result', requestId: 'a', ok: false }]);
    await r.controller.onMessage({ type: 'home.stop', requestId: 'b', sessionID: 'ses_1' });
    expect(r.calls).toEqual(['stop ses_1']);
    expect(r.posted[1]).toEqual({ type: 'home.result', requestId: 'b', ok: true });
  });

  it('answers a request only if it is in the host pending list (kind, session and id)', async () => {
    const r = rig();
    r.sources.pending = [
      { kind: 'permission', id: 'per_1', sessionID: 's', title: '', detail: '' },
    ];
    await r.controller.onMessage({ type: 'home.reply', kind: 'form', sessionID: 's', id: 'per_1' });
    await r.controller.onMessage({
      type: 'home.reply',
      kind: 'permission',
      sessionID: 'x',
      id: 'per_1',
    });
    await r.controller.onMessage({
      type: 'home.reply',
      kind: 'permission',
      sessionID: 's',
      id: 'nope',
    });
    expect(r.calls).toEqual([]);
    await r.controller.onMessage({
      type: 'home.reply',
      kind: 'permission',
      sessionID: 's',
      id: 'per_1',
    });
    expect(r.calls).toEqual(['reply permission s per_1']);
  });

  it('opens only a session the state lists as running', async () => {
    const r = rig();
    r.sources.running = ['ses_1'];
    await r.controller.onMessage({ type: 'home.open', sessionID: 'other' });
    expect(r.calls).toEqual([]);
    await r.controller.onMessage({ type: 'home.open', sessionID: 'ses_1' });
    expect(r.calls).toEqual(['open ses_1']);
  });

  it('refuses a second start while one is in flight, and passes Auto to the start', async () => {
    const r = rig();
    await r.controller.onMessage({ type: 'home.mode', mode: 'auto' });
    const first = r.controller.onMessage({ type: 'home.start', requestId: 'a', text: 'hi' });
    await r.controller.onMessage({ type: 'home.start', requestId: 'b', text: 'hi' });
    expect(r.calls).toEqual(['start']);
    expect(r.startedModes).toEqual(['auto']);
    expect(r.posted).toMatchObject([{ requestId: 'b', ok: false }]);
    r.release({ ok: true });
    await first;
    expect(r.posted[1]).toEqual({ type: 'home.result', requestId: 'a', ok: true });
    // Once it finished, the next one goes through.
    const again = r.controller.onMessage({ type: 'home.start', requestId: 'c', text: 'x' });
    r.release({ ok: false, error: 'nope' });
    await again;
    expect(r.calls).toEqual(['start', 'start']);
    expect(r.posted[2]).toEqual({ type: 'home.result', requestId: 'c', ok: false, error: 'nope' });
  });

  it('forwards a pill action and a mode change, and the mode shows in the next state', async () => {
    const r = rig();
    r.controller.onReady();
    await r.controller.onMessage({ type: 'home.action', action: 'logs' });
    await r.controller.onMessage({ type: 'home.mode', mode: 'auto' });
    await vi.runAllTimersAsync();
    expect(r.calls).toEqual(['action logs']);
    expect(states(r).at(-1)?.mode).toBe('auto');
  });
});

// Issue #223: the model pill asks the host for a picker over ITS catalog; the pick is revalidated, is
// the model of the next conversations from the box, is kept after a start (decision of Sergio,
// 12/11/2026) and is dropped only when the catalog stops listing it. FABRICATED catalog and picker.
describe('HomeController model picker', () => {
  /** Sends `home.model`, lets the picker answer `ref`, and waits for the controller to finish. */
  async function pick(r: Rig, ref: ModelRef | undefined): Promise<void> {
    const done = r.controller.onMessage({ type: 'home.model' });
    r.answerPick(ref);
    await done;
  }

  it('home.model asks the picker with the current choice and the next state shows the chosen model', async () => {
    const r = rig();
    r.controller.onReady();
    await pick(r, OTHER);
    await vi.runAllTimersAsync();
    expect(r.pickerCurrents).toEqual([undefined]);
    expect(states(r).at(-1)).toMatchObject({ model: 'Other', modelChosen: true });
    await pick(r, BIG);
    expect(r.pickerCurrents).toEqual([undefined, OTHER]); // the second opening marks the choice
  });

  it('a cancelled pick changes nothing', async () => {
    const r = rig();
    r.controller.onReady();
    r.posted.length = 0;
    await pick(r, undefined);
    await vi.runAllTimersAsync();
    expect(r.posted).toEqual([]);
    expect(r.controller.buildState()).toMatchObject({ model: 'Big Pickle', modelChosen: false });
  });

  it('a pick outside the catalog is refused with a log line', async () => {
    const r = rig();
    await pick(r, { providerID: 'opencode', id: 'forged' });
    expect(r.controller.buildState().modelChosen).toBe(false);
    expect(r.warnings).toContain('home model pick refused: not in the catalog');
  });

  it('a second home.model while the picker is open does not open another', async () => {
    const r = rig();
    const first = r.controller.onMessage({ type: 'home.model' });
    await r.controller.onMessage({ type: 'home.model' });
    expect(r.calls).toEqual(['pick']);
    r.answerPick(undefined);
    await first;
    // Once it closed, the next one opens.
    const again = r.controller.onMessage({ type: 'home.model' });
    r.answerPick(undefined);
    await again;
    expect(r.calls).toEqual(['pick', 'pick']);
  });

  it('no catalog: home.model does nothing', async () => {
    const r = rig();
    r.sources.catalog = undefined;
    await r.controller.onMessage({ type: 'home.model' });
    expect(r.calls).toEqual([]);
  });

  it('start passes the chosen model and keeps it for the next start', async () => {
    const r = rig();
    await pick(r, OTHER);
    const first = r.controller.onMessage({ type: 'home.start', requestId: 'a', text: 'hi' });
    r.release({ ok: true });
    await first;
    expect(r.startedModels).toEqual([OTHER]);
    expect(r.controller.buildState()).toMatchObject({ model: 'Other', modelChosen: true });
    const second = r.controller.onMessage({ type: 'home.start', requestId: 'b', text: 'hi' });
    r.release({ ok: false, error: 'nope' });
    await second;
    expect(r.startedModels).toEqual([OTHER, OTHER]);
  });

  it('a start without a choice passes no model', async () => {
    const r = rig();
    const start = r.controller.onMessage({ type: 'home.start', requestId: 'a', text: 'hi' });
    r.release({ ok: true });
    await start;
    expect(r.startedModels).toEqual([undefined]);
  });

  it('a choice that left the catalog is dropped: the state shows the default and start passes none', async () => {
    const r = rig();
    await pick(r, OTHER);
    r.sources.catalog = catalogOf(BIG, ['big']);
    expect(r.controller.buildState()).toMatchObject({ model: 'Big Pickle', modelChosen: false });
    const start = r.controller.onMessage({ type: 'home.start', requestId: 'a', text: 'hi' });
    r.release({ ok: true });
    await start;
    expect(r.startedModels).toEqual([undefined]);
    expect(r.warnings).toContain('home model choice dropped: not in the catalog');
    // It stays dropped even if the model comes back: the choice is gone, not suspended.
    r.sources.catalog = catalogOf();
    expect(r.controller.buildState().modelChosen).toBe(false);
  });

  it('a start while there is no catalog passes none but keeps the choice, and logs no drop', async () => {
    // Guards review W1 of #223: a reconnecting server has no catalog, and that is not "the model
    // left the catalog". FABRICATED sources.
    const r = rig();
    await pick(r, OTHER);
    r.sources.catalog = undefined;
    const start = r.controller.onMessage({ type: 'home.start', requestId: 'a', text: 'hi' });
    r.release({ ok: true });
    await start;
    expect(r.startedModels).toEqual([undefined]);
    expect(r.warnings).not.toContain('home model choice dropped: not in the catalog');
    r.sources.catalog = catalogOf();
    expect(r.controller.buildState()).toMatchObject({ model: 'Other', modelChosen: true });
  });
});
