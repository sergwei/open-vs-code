// What every session is doing right now, derived from the event stream (E9-sidebar-home, issue
// #187, and the base of the subagent monitor, issue #189). Pure: no `vscode`, no I/O.
// `ChatController` CREATES and OWNS one registry, feeds it every `V2Event` at the top of `onEvent`
// (before the early returns), tells it which sessions the REST snapshot lists as active, and
// empties it when the server goes; consumers read it through `ChatController.activityOf` and
// `ChatController.onActivity`.
//
// Where each fact comes from (`opencode-api` -> `references/eventos-v2.md`, all durable events):
// busy/idle ONLY from `session.execution.*` (never `session.status`); the agent from
// `session.step.started`; "thinking" / "writing" from `session.reasoning.started` /
// `session.text.started`; the tool from `session.tool.input.started` (the only one that carries the
// NAME; `called`, `success` and `failed` carry only the `id`). Deltas and `tool.progress` are ignored.
//
// The registry is per session, children included: a consumer that wants a root's tree walks
// `childrenOf` (or asks `ChatController.rootOf`); nothing here aggregates, so the home view can fold
// children into their root and the subagent monitor can show each child on its own.

import type { SessionMessageInfo, V2Event } from '@opencode/client';

/** Most sessions remembered; the oldest NOT running one goes first. Own choice (plan #2048). */
export const MAX_ACTIVITY_SESSIONS = 256;
/**
 * Most tool ids remembered per session (for the "same id is not counted twice" rule). Own choice,
 * not measured: far above the tool calls of any one turn we expect, and with the cap of
 * {@link MAX_ACTIVITY_SESSIONS} sessions it bounds the ids at 256 000 short strings (some MB).
 */
export const MAX_TOOL_IDS = 1000;
/** How many of the last tools a session keeps in `tools.recent` (the card shows three). */
export const RECENT_TOOLS = 3;
/** Longest string kept of a tool input value; longer ones are cut. Own choice: only a summary line is drawn. */
export const MAX_INPUT_VALUE_CHARS = 160;

/** What a running session is doing at this moment; a tool wins over thinking or writing. */
export type ActivityStep =
  | { kind: 'thinking'; since: number }
  | { kind: 'writing'; since: number }
  | { kind: 'tool'; id: string; name: string; since: number };

/** How an execution ended; `undefined` while it runs or when it was never seen to end. */
export type ActivityOutcome = 'succeeded' | 'failed' | 'interrupted';

/** The input of a tool call, thinned: only primitives, strings cut to {@link MAX_INPUT_VALUE_CHARS}. */
export type SlimInput = Record<string, string | number | boolean | null>;

/** One tool call of a session as far as the registry knows it. */
export interface ToolRun {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  /** Absent until `tool.called` (or the REST block) brought the input. */
  input?: SlimInput;
  /** The server's message of a failed call. */
  error?: string;
}

/** A read-only copy of what the registry knows of one session. */
export interface SessionActivity {
  sessionID: string;
  /** From `session.created` or {@link SessionActivityRegistry.learn}; absent for a root. */
  parentID?: string;
  running: boolean;
  /**
   * `created` of the `session.execution.started` that began the current execution. Absent when
   * the session is only known to run because the REST snapshot said so: the time is never invented.
   */
  since?: number;
  /** `created` of the event that ended the last execution; absent while running or never seen. */
  endedAt?: number;
  outcome?: ActivityOutcome;
  agent?: string;
  /** What it is doing now; absent between steps and for a session known only from REST. */
  current?: ActivityStep;
  tools: {
    /** Distinct tool ids seen (stream ∪ REST); a lower bound while `partial`. */
    count: number;
    partial: boolean;
    /** The last {@link RECENT_TOOLS}, oldest first. */
    recent: ToolRun[];
  };
}

/** The shape `seedTools` and `learn` need of a REST row. */
export interface LearnedRow {
  id: string;
  parentID?: string | undefined;
}

/** Called with the ids whose entry changed (or went away); consumers coalesce on their side. */
export type ActivityListener = (ids: readonly string[]) => void;

/** The registry returned by {@link createSessionActivity}. */
export interface SessionActivityRegistry {
  /** Feeds one stream event. Unknown event types and sessions are ignored. */
  observe(event: V2Event): void;
  /**
   * The stamp to take BEFORE a REST read of `session.active()` and hand back to {@link running}:
   * an event that arrives while the read is in flight is newer than the photo and must win.
   */
  mark(): number;
  /**
   * Applies `session.active()` of a full resync read at `mark`: lists the ids REST says run.
   * Keeps what the stream knows of those already running, adds the others WITHOUT `since`, and
   * stops the ones REST does not list unless the stream started them after `mark`; a session whose
   * execution ENDED after `mark` is not resurrected by the (older) photo. Stopping by the photo
   * counts as an end too (it advances the tick), so a still OLDER photo that arrives later, from an
   * overlapping resync, cannot bring the session back either.
   */
  running(ids: Iterable<string>, mark: number): void;
  /** Learns parents from REST rows (only rows with a parent create an entry). */
  learn(rows: Iterable<LearnedRow>): void;
  /**
   * Merges the tool blocks of REST `messages` of `sessionID` into its tool list without counting an
   * id the stream already counted. `partial` says the page was cut (200 messages): the count is a
   * lower bound. Needs no running session: it is how a child that ended before the tab opened gets
   * its count. Seeding nothing (no new tool, and `partial` already known) creates no entry and
   * notifies nobody.
   */
  seedTools(
    sessionID: string,
    messages: readonly SessionMessageInfo[],
    options: { partial: boolean },
  ): void;
  get(sessionID: string): SessionActivity | undefined;
  /** Ids of the sessions running now, in no particular order. */
  runningIds(): string[];
  /** Ids of the sessions whose `parentID` is `parentID` (running or not). */
  childrenOf(parentID: string): string[];
  /** Subscribes; returns the function that unsubscribes. */
  onChange(listener: ActivityListener): () => void;
  /** Forgets everything (the server went); listeners get every id that was known. */
  reset(): void;
}

interface Entry {
  id: string;
  parentID?: string;
  running: boolean;
  since?: number;
  endedAt?: number;
  outcome?: ActivityOutcome;
  agent?: string;
  phase?: { kind: 'thinking' | 'writing'; since: number };
  /** Tools started and not closed yet, in order of start (the last is the one shown). */
  open: Map<string, { name: string; since: number }>;
  toolIds: Set<string>;
  count: number;
  partial: boolean;
  recent: ToolRun[];
  /** Tick of the last start / end seen, to arbitrate against a REST photo (see `mark`). */
  startTick: number;
  endTick: number;
}

/**
 * Thins a tool input to primitives and short strings; `undefined` when `input` is not an object or
 * nothing primitive is left of it (an object of only objects and arrays), so no caller shows an
 * empty summary. Each string goes through `clean` BEFORE it is cut: a secret that straddled the
 * cut would keep its prefix, because a scrubber needs the whole secret to match it (probed on
 * 07/11/2026 with a password across the 160th character). Without `clean`, strings are kept as is.
 */
export function slimInput(
  input: unknown,
  clean: (text: string) => string = (text) => text,
): SlimInput | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const slim: SlimInput = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') {
      const whole = clean(value);
      slim[key] =
        whole.length > MAX_INPUT_VALUE_CHARS ? whole.slice(0, MAX_INPUT_VALUE_CHARS) : whole;
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      slim[key] = value;
    }
  }
  return Object.keys(slim).length === 0 ? undefined : slim;
}

/**
 * Builds an empty registry.
 *
 * Why `mark`/`running` instead of "replace the set with REST": the snapshot is a photo of when it
 * was READ, and the stream keeps writing while the read is in flight (`opencode-api` §4, "El
 * snapshot"): an execution that started after the read must not be stopped by the photo, and one
 * that ended after it must not come back. Both are decided with a counter of starts and ends.
 * VERIFIED by `sessionActivity.test.ts` ("running keeps an execution that started after the read
 * and does not resurrect one that ended after it", fabricated events, Windows 11, 07/11/2026).
 * HYPOTHESIS: that a real `session.active()` lists child sessions too (the fake lists everything
 * that runs); with real opencode only the opt-in suite could tell.
 * A listener that throws is reported to `onListenerError` and never escapes, and the other
 * listeners still run. VERIFIED by `chatController.activity.test.ts` ("sees the events of a turn,
 * and a throwing listener does not stop the chat": a second listener registered after the throwing
 * one is still called, and the chat still gets the event; fabricated events, Windows 11,
 * 07/11/2026). That the snapshot (`running`, `learn`) and the teardown (`reset`) are not cut by a
 * throwing listener either is HYPOTHESIS: they share `notify`, but no test throws from a listener
 * on those paths; a listener that throws during `running` and `reset` would show it.
 * `clean` scrubs the server's text (a failed tool's error, the strings of a tool input, the agent
 * and the tool name) BEFORE the registry stores it; it is called each time with no copy kept, so
 * the owner can read the CURRENT secrets inside it (they change with the server). The default
 * keeps the text as is. VERIFIED by `chatController.activity.test.ts` "activityOf keeps the
 * password out of the registry when it crosses the 160-character cut" and "... the loopback URL
 * ..." (the secret straddles index 160, pinned by the test; with `slimInput` cutting BEFORE
 * `clean` both went red, restored green; planted secrets, fabricated events, Windows 11,
 * 08/11/2026), and "activityOf scrubs the password out of an agent and a tool name". Not covered:
 * the `error` of a tool block read by `seedTools`, and the input strings of `seedTools`, go through
 * the same `clean` but no test plants a secret in a REST block.
 */
export function createSessionActivity(
  onListenerError: (error: unknown) => void = () => undefined,
  clean: (text: string) => string = (text) => text,
): SessionActivityRegistry {
  // Insertion order is recency: touching an entry moves it to the end.
  const entries = new Map<string, Entry>();
  const listeners = new Set<ActivityListener>();
  let tick = 0;

  // Every listener is called even if an earlier one throws, and a throw never escapes: `observe`,
  // `running` and `reset` sit on the chat's own paths (the stream, the snapshot, the teardown).
  const notify = (ids: readonly string[]): void => {
    if (ids.length === 0) return;
    for (const listener of [...listeners]) {
      try {
        listener(ids);
      } catch (error) {
        onListenerError(error);
      }
    }
  };

  /** An empty, not yet stored entry for `id`. */
  const blank = (id: string): Entry => ({
    id,
    running: false,
    open: new Map(),
    toolIds: new Set(),
    count: 0,
    partial: false,
    recent: [],
    startTick: 0,
    endTick: 0,
  });

  /** The entry of `id`, created if needed, moved to the most recent place; evicts over the cap. */
  const touch = (id: string): Entry => {
    const known = entries.get(id);
    const entry = known ?? blank(id);
    entries.delete(id);
    entries.set(id, entry);
    if (entries.size > MAX_ACTIVITY_SESSIONS) {
      let victim: string | undefined;
      for (const [key, candidate] of entries) {
        if (key !== id && !candidate.running) {
          victim = key;
          break;
        }
      }
      victim ??= entries.keys().next().value;
      if (victim !== undefined && victim !== id) entries.delete(victim);
    }
    return entry;
  };

  /**
   * Marks `entry` as running from `at` (`undefined` when only REST said so: the time is never
   * invented) and clears what belonged to the previous execution. Advances `tick` and stamps
   * `startTick` so {@link running} can tell a start newer than a REST photo from an older one.
   */
  const start = (entry: Entry, at: number | undefined): void => {
    tick += 1;
    entry.running = true;
    entry.startTick = tick;
    if (at === undefined) delete entry.since;
    else entry.since = at;
    delete entry.endedAt;
    delete entry.outcome;
    delete entry.phase;
    entry.open.clear();
  };

  /**
   * Marks `entry` as ended at `at` with `outcome`. Advances `tick` and stamps `endTick`, which is
   * what stops an older REST photo from bringing the execution back. A tool still open is marked
   * `error`: its `success` or `failed` can no longer arrive.
   */
  const end = (entry: Entry, at: number, outcome: ActivityOutcome): void => {
    tick += 1;
    entry.running = false;
    entry.endTick = tick;
    entry.endedAt = at;
    entry.outcome = outcome;
    delete entry.phase;
    entry.open.clear();
    // A call still open when the execution ended will never close.
    for (const run of entry.recent) if (run.status === 'running') run.status = 'error';
  };

  /** Registers a tool the first time its id is seen; returns its run, or the known one. */
  const openTool = (entry: Entry, id: string, name: string): ToolRun => {
    const known = entry.recent.find((run) => run.id === id);
    if (known !== undefined) return known;
    if (!entry.toolIds.has(id)) {
      entry.toolIds.add(id);
      entry.count += 1;
      if (entry.toolIds.size > MAX_TOOL_IDS) {
        const oldest = entry.toolIds.values().next().value;
        if (oldest !== undefined) entry.toolIds.delete(oldest);
      }
    }
    const run: ToolRun = { id, name, status: 'running' };
    entry.recent.push(run);
    if (entry.recent.length > RECENT_TOOLS)
      entry.recent.splice(0, entry.recent.length - RECENT_TOOLS);
    return run;
  };

  /**
   * Closes tool `id` with `status` (and the server's `error` text for a failure). A call that
   * `recent` no longer holds (pushed out by newer ones) is only dropped from `open`: it stays
   * counted, there is just no run left to update.
   */
  const closeTool = (entry: Entry, id: string, status: 'completed' | 'error', error?: string) => {
    entry.open.delete(id);
    const run = entry.recent.find((candidate) => candidate.id === id);
    if (run === undefined) return;
    run.status = status;
    if (error !== undefined) run.error = error;
  };

  /**
   * Applies one stream event and notifies the ids it changed. Executions start and end for any
   * session; step, text, reasoning and tool events only touch a session this registry already
   * sees running (`tool.called`, `success` and `failed` also need the tool to be known), so a late
   * event of an ended session changes nothing.
   */
  const observe = (event: V2Event): void => {
    switch (event.type) {
      case 'session.created': {
        const { sessionID, parentID } = event.data;
        if (parentID === undefined) return;
        const entry = touch(sessionID);
        if (entry.parentID === parentID) return;
        entry.parentID = parentID;
        notify([sessionID]);
        return;
      }
      case 'session.deleted': {
        if (entries.delete(event.data.sessionID)) notify([event.data.sessionID]);
        return;
      }
      case 'session.execution.started': {
        const entry = touch(event.data.sessionID);
        start(entry, event.created);
        notify([entry.id]);
        return;
      }
      case 'session.execution.succeeded':
      case 'session.execution.failed':
      case 'session.execution.interrupted': {
        const entry = touch(event.data.sessionID);
        const outcome = event.type.slice('session.execution.'.length) as ActivityOutcome;
        end(entry, event.created, outcome);
        notify([entry.id]);
        return;
      }
      default:
        break;
    }
    // The rest only matters for a session whose execution this registry knows is running.
    switch (event.type) {
      case 'session.step.started': {
        const entry = entries.get(event.data.sessionID);
        if (entry === undefined || !entry.running) return;
        entry.agent = clean(event.data.agent);
        delete entry.phase;
        notify([entry.id]);
        return;
      }
      case 'session.reasoning.started':
      case 'session.text.started': {
        const entry = entries.get(event.data.sessionID);
        if (entry === undefined || !entry.running) return;
        entry.phase = {
          kind: event.type === 'session.reasoning.started' ? 'thinking' : 'writing',
          since: event.created,
        };
        notify([entry.id]);
        return;
      }
      case 'session.tool.input.started': {
        const entry = entries.get(event.data.sessionID);
        if (entry === undefined || !entry.running) return;
        const name = clean(event.data.name);
        openTool(entry, event.data.id, name);
        entry.open.delete(event.data.id);
        entry.open.set(event.data.id, { name, since: event.created });
        delete entry.phase;
        notify([entry.id]);
        return;
      }
      case 'session.tool.called': {
        const entry = entries.get(event.data.sessionID);
        if (entry === undefined) return;
        const run = entry.recent.find((candidate) => candidate.id === event.data.id);
        if (run === undefined) return; // no name without `input.started`: nothing worth showing
        const input = slimInput(event.data.input, clean);
        if (input !== undefined) run.input = input;
        notify([entry.id]);
        return;
      }
      case 'session.tool.success':
      case 'session.tool.failed': {
        const entry = entries.get(event.data.sessionID);
        if (entry === undefined) return;
        if (event.type === 'session.tool.success') closeTool(entry, event.data.id, 'completed');
        else closeTool(entry, event.data.id, 'error', clean(event.data.error.message));
        notify([entry.id]);
        return;
      }
      default:
        return;
    }
  };

  return {
    observe,
    mark: () => tick,
    running(ids, mark) {
      const listed = new Set(ids);
      const changed: string[] = [];
      for (const id of listed) {
        const known = entries.get(id);
        if (known?.running === true) continue;
        if (known !== undefined && known.endTick > mark) continue; // ended after the photo
        const entry = touch(id);
        start(entry, undefined);
        changed.push(id);
      }
      for (const [id, entry] of entries) {
        if (!entry.running || listed.has(id) || entry.startTick > mark) continue;
        entry.running = false;
        tick += 1; // an end like any other: an older photo arriving later must not resurrect it
        entry.endTick = tick;
        delete entry.since;
        delete entry.phase;
        entry.open.clear();
        changed.push(id);
      }
      notify(changed);
    },
    learn(rows) {
      const changed: string[] = [];
      for (const row of rows) {
        if (row.parentID === undefined) continue;
        const entry = entries.get(row.id) ?? touch(row.id);
        if (entry.parentID === row.parentID) continue;
        entry.parentID = row.parentID;
        changed.push(row.id);
      }
      notify(changed);
    },
    seedTools(sessionID, messages, options) {
      // Nothing to seed must leave no trace: a scratch entry stands in until something is found.
      const known = entries.get(sessionID);
      const entry = known ?? blank(sessionID);
      const seeded: Array<{ at: number; run: ToolRun }> = [];
      for (const message of messages) {
        if (message.type !== 'assistant') continue;
        for (const block of message.content) {
          if (block.type !== 'tool' || entry.toolIds.has(block.id)) continue;
          entry.toolIds.add(block.id);
          entry.count += 1;
          const state = block.state;
          const run: ToolRun = {
            id: block.id,
            name: clean(block.name),
            status:
              state.status === 'completed'
                ? 'completed'
                : state.status === 'error'
                  ? 'error'
                  : 'running',
          };
          if (state.status !== 'streaming') {
            const input = slimInput(state.input, clean);
            if (input !== undefined) run.input = input;
          }
          if (state.status === 'error') run.error = clean(state.error.message);
          seeded.push({ at: block.time.created, run });
        }
      }
      const partialChanged = options.partial && !entry.partial;
      if (partialChanged) entry.partial = true;
      if (seeded.length === 0 && !partialChanged) return;
      const stored = known ?? Object.assign(touch(sessionID), entry);
      seeded.sort((a, b) => a.at - b.at);
      // REST is older than what the stream added since: it goes in front.
      stored.recent = [...seeded.map((item) => item.run), ...stored.recent].slice(-RECENT_TOOLS);
      notify([sessionID]);
    },
    get(sessionID) {
      const entry = entries.get(sessionID);
      if (entry === undefined) return undefined;
      let current: ActivityStep | undefined;
      const lastOpen = [...entry.open].at(-1);
      if (lastOpen !== undefined) {
        current = {
          kind: 'tool',
          id: lastOpen[0],
          name: lastOpen[1].name,
          since: lastOpen[1].since,
        };
      } else if (entry.phase !== undefined) {
        current = { ...entry.phase };
      }
      return {
        sessionID,
        ...(entry.parentID === undefined ? {} : { parentID: entry.parentID }),
        running: entry.running,
        ...(entry.since === undefined ? {} : { since: entry.since }),
        ...(entry.endedAt === undefined ? {} : { endedAt: entry.endedAt }),
        ...(entry.outcome === undefined ? {} : { outcome: entry.outcome }),
        ...(entry.agent === undefined ? {} : { agent: entry.agent }),
        ...(current === undefined ? {} : { current }),
        tools: {
          count: entry.count,
          partial: entry.partial,
          recent: entry.recent.map((run) => ({ ...run })),
        },
      };
    },
    runningIds: () => [...entries.values()].filter((entry) => entry.running).map((e) => e.id),
    childrenOf: (parentID) =>
      [...entries.values()].filter((entry) => entry.parentID === parentID).map((e) => e.id),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      const ids = [...entries.keys()];
      entries.clear();
      notify(ids);
    },
  };
}
