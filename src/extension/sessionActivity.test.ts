// Protects the activity registry (E9-sidebar-home, issue #187; base of #189): busy and idle come
// only from `session.execution.*`, the current step and the tools from the step, reasoning, text
// and tool events (by tool id), a child is its own entry with its parent, the REST photo never
// overrules the stream, a tool is counted once whatever its source, and the memory is bounded.
//
// Provenance: SYNTHETIC events. Their shapes (`session.execution.started { sessionID }`,
// `session.tool.input.started { id, name }`, `session.tool.called`, `.success`, `.failed`, the
// envelope's `created`) follow `references/eventos-v2.md` and the `types.d.ts` of
// `@opencode/client@2.0.32`; none was recorded from a running server, so this proves the registry's
// logic, not that opencode emits these events in this order.
import type { SessionMessageInfo, V2Event } from '@opencode/client';
import { describe, expect, it } from 'vitest';
import {
  createSessionActivity,
  MAX_ACTIVITY_SESSIONS,
  MAX_INPUT_VALUE_CHARS,
  slimInput,
} from './sessionActivity';

const wire = <T>(json: string): T => JSON.parse(json) as T;
const event = (type: string, data: object, created = 100): V2Event =>
  wire<V2Event>(JSON.stringify({ id: `evt_${type}`, created, type, data }));
const started = (sessionID: string, created = 100): V2Event =>
  event('session.execution.started', { sessionID }, created);
const toolStart = (sessionID: string, id: string, name: string, created = 110): V2Event =>
  event(
    'session.tool.input.started',
    { sessionID, assistantMessageID: 'msg_1', id, name },
    created,
  );
const toolDone = (sessionID: string, id: string, type = 'session.tool.success'): V2Event =>
  event(type, {
    sessionID,
    assistantMessageID: 'msg_1',
    id,
    content: [],
    executed: true,
    error: { type: 'x', message: 'it broke' },
  });
const assistant = (tools: Array<{ id: string; name: string; at: number }>): SessionMessageInfo =>
  wire<SessionMessageInfo>(
    JSON.stringify({
      id: 'msg_a',
      type: 'assistant',
      content: tools.map((tool) => ({
        type: 'tool',
        id: tool.id,
        name: tool.name,
        state: {
          status: 'completed',
          input: { path: 'a.ts' },
          content: [{ type: 'text', text: 'x' }],
        },
        time: { created: tool.at },
      })),
    }),
  );

describe('createSessionActivity', () => {
  it('takes busy and idle only from the execution events, with since and the outcome', () => {
    const registry = createSessionActivity();
    registry.observe(started('ses_a', 100));
    expect(registry.get('ses_a')).toMatchObject({ running: true, since: 100 });
    expect(registry.runningIds()).toEqual(['ses_a']);
    registry.observe(event('session.status', { sessionID: 'ses_a', status: 'idle' }));
    expect(registry.get('ses_a')?.running).toBe(true);
    registry.observe(event('session.execution.succeeded', { sessionID: 'ses_a' }, 150));
    expect(registry.get('ses_a')).toMatchObject({
      running: false,
      endedAt: 150,
      outcome: 'succeeded',
    });
    for (const outcome of ['failed', 'interrupted'] as const) {
      registry.observe(started('ses_a', 200));
      registry.observe(event(`session.execution.${outcome}`, { sessionID: 'ses_a' }, 210));
      expect(registry.get('ses_a')).toMatchObject({ running: false, outcome });
    }
    expect(registry.runningIds()).toEqual([]);
  });

  it('follows a tool from its start to its success or failure by id, with the name', () => {
    const registry = createSessionActivity();
    registry.observe(started('ses_a'));
    registry.observe(toolStart('ses_a', 'call_1', 'read', 111));
    expect(registry.get('ses_a')?.current).toEqual({
      kind: 'tool',
      id: 'call_1',
      name: 'read',
      since: 111,
    });
    registry.observe(
      event('session.tool.called', {
        sessionID: 'ses_a',
        id: 'call_1',
        input: { path: 'a.ts', big: 'x'.repeat(500), nested: { a: 1 }, list: [1] },
        executed: true,
      }),
    );
    const input = registry.get('ses_a')?.tools.recent[0]?.input;
    expect(input).toEqual({ path: 'a.ts', big: 'x'.repeat(MAX_INPUT_VALUE_CHARS) });
    registry.observe(toolDone('ses_a', 'call_1'));
    expect(registry.get('ses_a')?.current).toBeUndefined();
    expect(registry.get('ses_a')?.tools).toMatchObject({
      count: 1,
      recent: [{ id: 'call_1', name: 'read', status: 'completed' }],
    });
    registry.observe(toolStart('ses_a', 'call_2', 'edit'));
    registry.observe(toolDone('ses_a', 'call_2', 'session.tool.failed'));
    expect(registry.get('ses_a')?.tools.recent[1]).toMatchObject({
      status: 'error',
      error: 'it broke',
    });
  });

  it('shows the latest open tool while several run and falls back when it closes', () => {
    const registry = createSessionActivity();
    registry.observe(started('ses_a'));
    registry.observe(toolStart('ses_a', 'c1', 'read', 111));
    registry.observe(toolStart('ses_a', 'c2', 'grep', 112));
    expect(registry.get('ses_a')?.current).toMatchObject({ id: 'c2' });
    registry.observe(toolDone('ses_a', 'c2'));
    expect(registry.get('ses_a')?.current).toMatchObject({ id: 'c1' });
  });

  it('says thinking or writing, clears them on a tool or a new step, and keeps the agent', () => {
    const registry = createSessionActivity();
    registry.observe(started('ses_a'));
    registry.observe(
      event('session.step.started', {
        sessionID: 'ses_a',
        assistantMessageID: 'm',
        agent: 'build',
        model: { id: 'x', providerID: 'y' },
        started: 1,
      }),
    );
    registry.observe(event('session.reasoning.started', { sessionID: 'ses_a' }, 120));
    expect(registry.get('ses_a')).toMatchObject({
      agent: 'build',
      current: { kind: 'thinking', since: 120 },
    });
    registry.observe(event('session.text.started', { sessionID: 'ses_a' }, 130));
    expect(registry.get('ses_a')?.current).toEqual({ kind: 'writing', since: 130 });
    registry.observe(toolStart('ses_a', 'c1', 'read'));
    registry.observe(toolDone('ses_a', 'c1'));
    expect(registry.get('ses_a')?.current).toBeUndefined();
    expect(registry.get('ses_a')?.agent).toBe('build');
  });

  it('ignores the events of a session that is not known to run', () => {
    const registry = createSessionActivity();
    registry.observe(toolStart('ses_x', 'c1', 'read'));
    registry.observe(event('session.reasoning.started', { sessionID: 'ses_x' }));
    expect(registry.get('ses_x')).toBeUndefined();
  });

  it('keeps a child on its own with its parent, in the foreground and in the background', () => {
    const registry = createSessionActivity();
    registry.observe(started('ses_root', 100));
    registry.observe(event('session.created', { sessionID: 'ses_kid', parentID: 'ses_root' }));
    registry.observe(event('session.created', { sessionID: 'ses_bg', parentID: 'ses_root' }));
    registry.observe(started('ses_kid', 101));
    registry.observe(toolStart('ses_kid', 'k1', 'grep'));
    // The foreground child ends with its parent's tool; the background child keeps going after the
    // root ended.
    registry.observe(started('ses_bg', 102));
    registry.observe(event('session.execution.succeeded', { sessionID: 'ses_root' }, 200));
    expect(registry.childrenOf('ses_root').sort()).toEqual(['ses_bg', 'ses_kid']);
    expect(registry.get('ses_kid')).toMatchObject({
      parentID: 'ses_root',
      running: true,
      current: { kind: 'tool', name: 'grep' },
    });
    expect(registry.get('ses_root')?.current).toBeUndefined();
    expect(registry.runningIds().sort()).toEqual(['ses_bg', 'ses_kid']);
    registry.learn([{ id: 'ses_old', parentID: 'ses_root' }, { id: 'ses_plain' }]);
    expect(registry.childrenOf('ses_root')).toContain('ses_old');
    expect(registry.get('ses_plain')).toBeUndefined();
  });

  it('counts a tool once whether it came from the stream or from REST, and marks a cut page', () => {
    const registry = createSessionActivity();
    registry.observe(started('ses_kid'));
    registry.observe(toolStart('ses_kid', 'k2', 'edit', 111));
    registry.seedTools(
      'ses_kid',
      [
        assistant([
          { id: 'k1', name: 'read', at: 50 },
          { id: 'k2', name: 'edit', at: 60 },
          { id: 'k0', name: 'glob', at: 40 },
        ]),
      ],
      { partial: false },
    );
    const tools = registry.get('ses_kid')?.tools;
    expect(tools?.count).toBe(3);
    expect(tools?.partial).toBe(false);
    // REST goes in front of what the stream added, oldest first, capped at three.
    expect(tools?.recent.map((run) => run.id)).toEqual(['k0', 'k1', 'k2']);
    expect(tools?.recent[0]?.input).toEqual({ path: 'a.ts' });
    registry.seedTools('ses_kid', [assistant([{ id: 'k1', name: 'read', at: 50 }])], {
      partial: true,
    });
    expect(registry.get('ses_kid')?.tools).toMatchObject({ count: 3, partial: true });
  });

  it('seeds a child that ended before the tab opened, with no running state', () => {
    const registry = createSessionActivity();
    registry.seedTools('ses_done', [assistant([{ id: 'a', name: 'read', at: 1 }])], {
      partial: false,
    });
    expect(registry.get('ses_done')).toMatchObject({ running: false, tools: { count: 1 } });
  });

  it('running() adds what REST lists without inventing a time and prunes what it does not', () => {
    const registry = createSessionActivity();
    registry.observe(started('ses_a', 100));
    registry.observe(toolStart('ses_a', 'c1', 'read'));
    registry.observe(started('ses_b', 100));
    const mark = registry.mark();
    registry.running(['ses_a', 'ses_c'], mark);
    expect(registry.get('ses_a')?.current).toMatchObject({ name: 'read' });
    expect(registry.get('ses_b')?.running).toBe(false);
    expect(registry.get('ses_c')).toMatchObject({ running: true });
    expect(registry.get('ses_c')?.since).toBeUndefined();
  });

  it('running keeps an execution that started after the read and does not resurrect one that ended after it', () => {
    const registry = createSessionActivity();
    registry.observe(started('ses_old', 100));
    const mark = registry.mark(); // the read begins here
    registry.observe(started('ses_new', 300)); // starts while the read is in flight
    registry.observe(event('session.execution.succeeded', { sessionID: 'ses_old' }, 310));
    // The photo was taken before both: it lists ses_old (stale) and not ses_new.
    registry.running(['ses_old'], mark);
    expect(registry.get('ses_new')?.running).toBe(true);
    expect(registry.get('ses_old')?.running).toBe(false);
  });

  /**
   * Two full resyncs that overlap and answer out of order: the newer photo stops the session, then
   * the older one (taken before it started) lists it. Protects the stop-by-photo from being undone.
   * Provenance: fabricated marks and events (the order is the one reviewer probed on 07/11/2026).
   */
  it('running does not resurrect a session a newer photo stopped when an older photo arrives late', () => {
    const registry = createSessionActivity();
    const older = registry.mark();
    registry.observe(started('ses_z', 100));
    const newer = registry.mark();
    registry.running([], newer); // the newer photo does not list it: stopped
    expect(registry.get('ses_z')?.running).toBe(false);
    registry.running(['ses_z'], older); // the older one arrives last
    expect(registry.get('ses_z')?.running).toBe(false);
  });

  /** Seeding with nothing to add must leave no entry and tell no listener (fabricated messages). */
  it('seedTools with nothing to seed creates no entry and does not notify', () => {
    const registry = createSessionActivity();
    const heard: string[][] = [];
    registry.onChange((ids) => heard.push([...ids]));
    registry.seedTools('ses_none', [], { partial: false });
    expect(registry.get('ses_none')).toBeUndefined();
    registry.seedTools('ses_cut', [], { partial: true });
    expect(registry.get('ses_cut')?.tools).toMatchObject({ count: 0, partial: true });
    registry.seedTools('ses_cut', [], { partial: true });
    expect(heard).toEqual([['ses_cut']]);
    registry.seedTools('ses_two', [assistant([{ id: 'a', name: 'read', at: 1 }])], {
      partial: false,
    });
    expect(registry.get('ses_two')?.tools.recent.map((run) => run.id)).toEqual(['a']);
  });

  it('forgets a deleted session, bounds its memory and empties on reset telling the listeners', () => {
    const registry = createSessionActivity();
    const heard: string[][] = [];
    const off = registry.onChange((ids) => heard.push([...ids]));
    registry.observe(started('ses_a'));
    registry.observe(event('session.deleted', { sessionID: 'ses_a' }));
    expect(registry.get('ses_a')).toBeUndefined();
    expect(heard).toEqual([['ses_a'], ['ses_a']]);
    for (let n = 0; n < MAX_ACTIVITY_SESSIONS; n++) registry.observe(started(`s${String(n)}`));
    registry.observe(event('session.execution.succeeded', { sessionID: 's5' }));
    registry.observe(started('late'));
    // One over the cap: the finished one goes, not the oldest running one.
    expect(registry.get('s5')).toBeUndefined();
    expect(registry.get('s0')?.running).toBe(true);
    expect(registry.get('late')?.running).toBe(true);
    expect(registry.runningIds().length).toBe(MAX_ACTIVITY_SESSIONS);
    heard.length = 0;
    registry.reset();
    expect(registry.runningIds()).toEqual([]);
    expect(heard[0]?.length).toBe(MAX_ACTIVITY_SESSIONS);
    off();
    heard.length = 0;
    registry.observe(started('after'));
    expect(heard).toEqual([]);
  });
});

describe('slimInput', () => {
  it('keeps primitives, cuts long strings and drops objects, arrays and non-objects', () => {
    expect(slimInput({ a: 1, b: true, c: null, d: [1], e: { f: 1 }, g: 'ok' })).toEqual({
      a: 1,
      b: true,
      c: null,
      g: 'ok',
    });
    expect(slimInput('text')).toBeUndefined();
    expect(slimInput([1])).toBeUndefined();
    expect(slimInput(null)).toBeUndefined();
    // Nothing primitive left: no empty summary.
    expect(slimInput({ a: { b: 1 }, c: [1] })).toBeUndefined();
    expect(slimInput({})).toBeUndefined();
  });
});
