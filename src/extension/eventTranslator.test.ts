// Protects against the regressions the planner's spike with a REAL opencode 2.0.32 (Windows 11,
// 2026-10-20) showed to be easy to cause:
//   - a busy/idle indicator driven by `session.status` (the server never publishes it; the state
//     comes from `session.execution.*`);
//   - a missing user message (it appears only on `session.inbox.delivered`);
//   - deltas written to the wrong block, because `text.started` arrives BEFORE `reasoning.ended`
//     and `ordinal` is per type, not a position;
//   - a snapshot and a stream that disagree on block ids.
//
// Provenance of the data: the event ORDER and payload fields below were copied from the spike's
// recording (`inbox.enqueued -> execution.started -> step.started -> reasoning.started ->
// reasoning.delta x2 -> text.started -> reasoning.ended -> text.delta -> text.ended ->
// step.ended -> execution.succeeded`, and `execution.failed` with `provider.no-route`); ids,
// texts and timestamps are made up. The tool, permission, form and retry events come from the
// TYPES only. These tests confirm OUR translation logic, not the contract with the server.
import type { SessionMessageInfo, V2Event } from '@opencode/client';
import { describe, expect, it } from 'vitest';
import type { HostToWebview } from '../shared/protocol';
import { createEventTranslator } from './eventTranslator';
import { toMessage } from './wireMapping';

const SES = 'ses_1';
const USER = 'msg_u';
const ASSISTANT = 'msg_a';

let counter = 0;

/** Builds an event the way it travels on the wire (JSON round trip), typed as the client types it. */
function ev(type: string, data: object, created = 1000): V2Event {
  counter += 1;
  return JSON.parse(
    JSON.stringify({ id: `evt_${String(counter)}`, created, type, data }),
  ) as V2Event;
}

/** Feeds events in order and returns everything the translator emitted. */
function run(translator: ReturnType<typeof createEventTranslator>, events: V2Event[]) {
  return events.flatMap((event) => translator.translate(event));
}

/** The recorded order of a successful turn with one reasoning and one text block. */
function okTurn(): V2Event[] {
  const a = { sessionID: SES, assistantMessageID: ASSISTANT };
  return [
    ev('session.inbox.enqueued', {
      sessionID: SES,
      inboxID: USER,
      item: {
        type: 'user',
        payload: { text: 'Reply with exactly: hello there' },
        delivery: 'queue',
      },
    }),
    ev('session.execution.started', { sessionID: SES }),
    ev('session.inbox.delivered', { sessionID: SES, inboxID: USER }, 1100),
    ev('session.step.started', {
      ...a,
      agent: 'build',
      model: { id: 'big-pickle', providerID: 'opencode' },
      started: 1200,
    }),
    ev('session.reasoning.started', { ...a, ordinal: 0 }),
    ev('session.reasoning.delta', { ...a, ordinal: 0, delta: 'think ' }),
    ev('session.reasoning.delta', { ...a, ordinal: 0, delta: 'hard' }),
    ev('session.text.started', { ...a, ordinal: 0 }),
    ev('session.reasoning.ended', { ...a, ordinal: 0, text: 'think hard' }),
    ev('session.text.delta', { ...a, ordinal: 0, delta: 'hello ' }),
    ev('session.text.delta', { ...a, ordinal: 0, delta: 'there' }),
    ev('session.text.ended', { ...a, ordinal: 0, text: 'hello there' }),
    ev('session.step.ended', {
      ...a,
      finish: 'stop',
      cost: 0,
      tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 0, write: 0 } },
    }),
    ev('session.execution.succeeded', { sessionID: SES }),
  ];
}

/** The `type` of each emitted message, for order assertions. */
const types = (messages: HostToWebview[]): string[] => messages.map((m) => m.type);

describe('a successful turn (recorded order)', () => {
  it('emits busy, the user message on delivered, the assistant on step.started and idle at the end', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    const out = run(t, okTurn());
    expect(out[0]).toEqual({ type: 'session.status', sessionID: SES, status: { type: 'busy' } });
    expect(out[1]).toMatchObject({
      type: 'message.upserted',
      message: { kind: 'user', id: USER, text: 'Reply with exactly: hello there', createdAt: 1100 },
    });
    expect(out[2]).toMatchObject({
      type: 'message.upserted',
      message: { kind: 'assistant', id: ASSISTANT, agent: 'build' },
    });
    expect(out.at(-1)).toEqual({
      type: 'session.status',
      sessionID: SES,
      status: { type: 'idle' },
    });
  });

  it('routes deltas to the right block although text.started precedes reasoning.ended', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    const out = run(t, okTurn());
    const deltas = out.filter((m) => m.type === 'part.delta');
    expect(deltas.map((m) => (m.type === 'part.delta' ? [m.partID, m.delta] : []))).toEqual([
      [`${ASSISTANT}#0`, 'think '],
      [`${ASSISTANT}#0`, 'hard'],
      [`${ASSISTANT}#1`, 'hello '],
      [`${ASSISTANT}#1`, 'there'],
    ]);
  });

  it('upserts the complete block on every *.ended so a lost delta heals', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    const out = run(t, okTurn());
    const upserts = out.filter((m) => m.type === 'part.upserted');
    expect(upserts.map((m) => (m.type === 'part.upserted' ? m.part : undefined))).toEqual([
      { type: 'reasoning', id: `${ASSISTANT}#0`, text: '', completed: false },
      { type: 'text', id: `${ASSISTANT}#1`, text: '' },
      { type: 'reasoning', id: `${ASSISTANT}#0`, text: 'think hard', completed: true },
      { type: 'text', id: `${ASSISTANT}#1`, text: 'hello there' },
    ]);
  });

  it('puts cost, tokens and finish on the assistant at step.ended', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    const out = run(t, okTurn());
    const last = out.filter((m) => m.type === 'message.upserted').at(-1);
    expect(last).toMatchObject({
      message: { kind: 'assistant', finish: 'stop', tokens: { input: 1, output: 2, reasoning: 3 } },
    });
  });
});

describe('a failed turn (recorded)', () => {
  it('turns execution.failed into an error status carrying the typed error', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    const out = run(t, [
      ev('session.execution.started', { sessionID: SES }),
      ev('session.execution.failed', {
        sessionID: SES,
        error: { type: 'provider.no-route', message: 'Model unavailable: nope/does-not-exist' },
      }),
    ]);
    expect(out[1]).toEqual({
      type: 'session.status',
      sessionID: SES,
      status: {
        type: 'error',
        error: { code: 'provider.no-route', message: 'Model unavailable: nope/does-not-exist' },
      },
    });
  });

  it('goes back to busy on the next execution.started', () => {
    const t = createEventTranslator();
    const out = run(t, [
      ev('session.execution.failed', { sessionID: SES, error: { type: 'x', message: 'y' } }),
      ev('session.execution.started', { sessionID: SES }),
    ]);
    expect(out.at(-1)).toMatchObject({ status: { type: 'busy' } });
  });
});

describe('what is ignored or scoped', () => {
  it('does not forward messages of a session that is not open, but forwards its status', () => {
    const t = createEventTranslator();
    t.setOpen('ses_other');
    const out = run(t, okTurn());
    expect(types(out)).toEqual(['session.status', 'session.status']);
  });

  it('drops a delta for an unknown message', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    expect(
      t.translate(
        ev('session.text.delta', {
          sessionID: SES,
          assistantMessageID: 'msg_ghost',
          ordinal: 0,
          delta: 'x',
        }),
      ),
    ).toEqual([]);
  });

  it('ignores session.status and session.idle and unknown types', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    expect(t.translate(ev('session.status', { sessionID: SES, status: { type: 'busy' } }))).toEqual(
      [],
    );
    expect(t.translate(ev('session.idle', { sessionID: SES }))).toEqual([]);
    expect(t.translate(ev('something.new', {}))).toEqual([]);
  });

  it('does not emit the user message when delivered arrives without a remembered enqueued', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    expect(
      t.translate(ev('session.inbox.delivered', { sessionID: SES, inboxID: 'msg_x' })),
    ).toEqual([]);
  });
});

describe('sessions', () => {
  it('upserts on created and, from the mirror, on renamed; removes on deleted', () => {
    const t = createEventTranslator();
    const created = t.translate(
      ev('session.created', { sessionID: SES, slug: 's', version: '2', projectID: 'p' }, 5000),
    );
    expect(created).toEqual([
      { type: 'session.upserted', session: { id: SES, createdAt: 5000, updatedAt: 5000 } },
    ]);
    const renamed = t.translate(ev('session.renamed', { sessionID: SES, title: 'Greeting' }, 6000));
    expect(renamed).toEqual([
      {
        type: 'session.upserted',
        session: { id: SES, title: 'Greeting', createdAt: 5000, updatedAt: 6000 },
      },
    ]);
    expect(t.translate(ev('session.deleted', { sessionID: SES }))).toEqual([
      { type: 'session.removed', sessionID: SES },
    ]);
  });

  // Issues #23/#24. The payload fields (`model`, `previous`, `agent`) are copied from the planner
  // spike's recording of `session.model.selected` / `session.agent.selected` (opencode 2.0.32,
  // Windows 11, 21/10/2026, including `variant: "default"` on a model chosen without a variant);
  // ids and timestamps are made up. These pin OUR translation, not the contract.
  it('mirrors a model and an agent switch into the session row', () => {
    const t = createEventTranslator();
    t.translate(
      ev('session.created', { sessionID: SES, slug: 's', version: '2', projectID: 'p' }, 5000),
    );
    expect(
      t.translate(
        ev(
          'session.model.selected',
          { sessionID: SES, model: { providerID: 'opencode', id: 'glm', variant: 'default' } },
          6000,
        ),
      ),
    ).toEqual([
      {
        type: 'session.upserted',
        session: {
          id: SES,
          createdAt: 5000,
          updatedAt: 6000,
          model: { providerID: 'opencode', id: 'glm' },
        },
      },
    ]);
    expect(
      t.translate(
        ev(
          'session.model.selected',
          { sessionID: SES, model: { providerID: 'opencode', id: 'glm', variant: 'low' } },
          6100,
        ),
      ),
    ).toMatchObject([
      { session: { model: { providerID: 'opencode', id: 'glm', variant: 'low' } } },
    ]);
    expect(
      t.translate(
        ev('session.agent.selected', { sessionID: SES, agent: 'plan', previous: 'build' }, 6200),
      ),
    ).toEqual([
      {
        type: 'session.upserted',
        session: {
          id: SES,
          createdAt: 5000,
          updatedAt: 6200,
          agent: 'plan',
          model: { providerID: 'opencode', id: 'glm', variant: 'low' },
        },
      },
    ]);
  });

  it('cannot rebuild a model or agent switch of a session it never saw', () => {
    const t = createEventTranslator();
    expect(
      t.translate(
        ev('session.model.selected', { sessionID: 'ses_new', model: { providerID: 'p', id: 'm' } }),
      ),
    ).toEqual([]);
    expect(
      t.translate(ev('session.agent.selected', { sessionID: 'ses_new', agent: 'plan' })),
    ).toEqual([]);
  });

  it('cannot rebuild a renamed session it never saw', () => {
    const t = createEventTranslator();
    expect(t.translate(ev('session.renamed', { sessionID: 'ses_new', title: 'T' }))).toEqual([]);
  });

  // Issue #20. The snapshot mirrors only the 50 newest sessions; a page of the session list can show
  // an older one, and its rename must still reach the webview. Fabricated rows.
  it('mirror() lets a rename of a row from a browsed page through, without emptying the mirror', () => {
    const t = createEventTranslator();
    t.seed({ sessions: [{ id: 'ses_snap', createdAt: 1, updatedAt: 2 }], messages: [] });
    t.mirror([{ id: 'ses_old', title: 'Before', createdAt: 3, updatedAt: 4 }]);
    expect(
      t.translate(ev('session.renamed', { sessionID: 'ses_old', title: 'After' }, 9000)),
    ).toEqual([
      {
        type: 'session.upserted',
        session: { id: 'ses_old', title: 'After', createdAt: 3, updatedAt: 9000 },
      },
    ]);
    // The row the snapshot mirrored is still there.
    expect(
      t.translate(ev('session.renamed', { sessionID: 'ses_snap', title: 'S' }, 9100)),
    ).toHaveLength(1);
  });

  it('a later seed() replaces the mirror again, which bounds its size', () => {
    const t = createEventTranslator();
    t.mirror([{ id: 'ses_old', createdAt: 3, updatedAt: 4 }]);
    t.seed({ sessions: [], messages: [] });
    expect(t.translate(ev('session.renamed', { sessionID: 'ses_old', title: 'T' }))).toEqual([]);
  });
});

// Issue #25. The totals are the ones the planner's spike saw on a real opencode 2.0.32 after one
// turn (Windows 11, 22/10/2026: `usage.updated` = `session.get` = `{input:4951, output:4,
// cache.read:4608}`); the event envelope is built by hand. Protects: (1) usage is not activity, so
// `updatedAt` must not move; (2) a snapshot read BEFORE the event must not overwrite the newer
// totals (`mergeUsage`); (3) a usage event must not be lost for a row that was not mirrored yet.
describe('session usage', () => {
  const tokens = { input: 4951, output: 4, reasoning: 0, cache: { read: 4608, write: 0 } };
  const usage = {
    cost: 0,
    tokens: { input: 4951, output: 4, reasoning: 0, cacheRead: 4608, cacheWrite: 0 },
  };
  const usageEvent = (sessionID: string, cost = 0) =>
    ev('session.usage.updated', { sessionID, cost, tokens }, 7000);

  it('upserts a mirrored row with the new usage and leaves updatedAt alone', () => {
    const t = createEventTranslator();
    t.seed({ sessions: [{ id: SES, title: 'T', createdAt: 1, updatedAt: 2 }], messages: [] });
    expect(t.translate(usageEvent(SES))).toEqual([
      {
        type: 'session.upserted',
        session: { id: SES, title: 'T', createdAt: 1, updatedAt: 2, usage },
      },
    ]);
  });

  it('gives nothing for a row it never mirrored', () => {
    expect(createEventTranslator().translate(usageEvent('ses_new'))).toEqual([]);
  });

  it('keeps the usage in the rows a later rename or model switch emits', () => {
    const t = createEventTranslator();
    t.seed({ sessions: [{ id: SES, createdAt: 1, updatedAt: 2 }], messages: [] });
    t.translate(usageEvent(SES));
    expect(t.translate(ev('session.renamed', { sessionID: SES, title: 'N' }, 8000))).toMatchObject([
      { session: { title: 'N', usage } },
    ]);
    expect(
      t.translate(
        ev('session.model.selected', { sessionID: SES, model: { providerID: 'p', id: 'm' } }, 9000),
      ),
    ).toMatchObject([{ session: { usage } }]);
  });

  it('mergeUsage overlays what the stream said since beginResync, and only that', () => {
    const t = createEventTranslator();
    const stale = {
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const rows = [
      { id: SES, createdAt: 1, updatedAt: 2, usage: stale },
      { id: 'ses_2', createdAt: 1, updatedAt: 2, usage: stale },
    ];
    t.translate(usageEvent(SES)); // before beginResync: forgotten
    t.beginResync();
    expect(t.mergeUsage(rows)).toBe(rows);
    t.translate(usageEvent(SES)); // arrives while REST is being read, for an unmirrored row too
    expect(t.mergeUsage(rows)).toEqual([
      { id: SES, createdAt: 1, updatedAt: 2, usage },
      { id: 'ses_2', createdAt: 1, updatedAt: 2, usage: stale },
    ]);
    t.beginResync();
    expect(t.mergeUsage(rows)).toBe(rows);
  });
});

describe('tools', () => {
  const a = { sessionID: SES, assistantMessageID: ASSISTANT };

  function openWithAssistant() {
    const t = createEventTranslator();
    t.setOpen(SES);
    t.translate(
      ev('session.step.started', {
        ...a,
        agent: 'build',
        model: { id: 'm', providerID: 'p' },
        started: 1,
      }),
    );
    return t;
  }

  it('follows a tool by id from input to success and streams its input as field "input"', () => {
    const t = openWithAssistant();
    const out = run(t, [
      ev('session.tool.input.started', { ...a, id: 'call_1', name: 'read' }),
      ev('session.tool.input.delta', { ...a, id: 'call_1', delta: '{"path":' }),
      ev('session.tool.input.delta', { ...a, id: 'call_1', delta: '"a"}' }),
      ev('session.tool.input.ended', { ...a, id: 'call_1', text: '{"path":"a"}' }),
      ev('session.tool.called', { ...a, id: 'call_1', input: { path: 'a' }, executed: true }),
      ev('session.tool.success', {
        ...a,
        id: 'call_1',
        content: [{ type: 'text', text: 'file body' }],
        executed: true,
      }),
    ]);
    const deltas = out.filter((m) => m.type === 'part.delta');
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ partID: 'call_1', field: 'input', delta: '{"path":' });
    expect(out.at(-1)).toMatchObject({
      type: 'part.upserted',
      part: {
        type: 'tool',
        id: 'call_1',
        name: 'read',
        state: {
          status: 'completed',
          input: { path: 'a' },
          output: [{ type: 'text', text: 'file body' }],
        },
      },
    });
  });

  it('turns tool.failed into an error state', () => {
    const t = openWithAssistant();
    const out = run(t, [
      ev('session.tool.input.started', { ...a, id: 'c', name: 'bash' }),
      ev('session.tool.called', { ...a, id: 'c', input: {}, executed: true }),
      ev('session.tool.failed', {
        ...a,
        id: 'c',
        error: { type: 'tool.error', message: 'exit 1' },
        executed: true,
      }),
    ]);
    expect(out.at(-1)).toMatchObject({
      part: { state: { status: 'error', error: { code: 'tool.error', message: 'exit 1' } } },
    });
  });

  it('counts a tool block in the position counter so the next text gets the next id', () => {
    const t = openWithAssistant();
    const out = run(t, [
      ev('session.tool.input.started', { ...a, id: 'c', name: 'bash' }),
      ev('session.text.started', { ...a, ordinal: 0 }),
    ]);
    expect(out.at(-1)).toMatchObject({ part: { type: 'text', id: `${ASSISTANT}#1` } });
  });
});

describe('permissions and forms', () => {
  // Phase 3 reversed the phase-1 rule: a subagent asks from its own child session, and a request
  // the webview never hears of leaves the agent waiting with nothing on screen.
  it('forwards them for EVERY session, not only the open one', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    const asked = (sessionID: string) =>
      t.translate(
        ev('permission.asked', { id: 'per_1', sessionID, action: 'edit', resources: ['a'] }),
      );
    expect(asked(SES)).toHaveLength(1);
    expect(asked('ses_child')).toMatchObject([
      { type: 'permission.asked', permission: { sessionID: 'ses_child' } },
    ]);
    expect(
      t.translate(
        ev('permission.replied', { sessionID: 'ses_child', requestID: 'per_1', reply: 'once' }),
      ),
    ).toEqual([
      {
        type: 'permission.resolved',
        sessionID: 'ses_child',
        permissionID: 'per_1',
        decision: 'once',
      },
    ]);
  });

  it('forwards the forms of another session too', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    const out = t.translate(
      ev('form.created', {
        form: { id: 'frm_9', sessionID: 'ses_child', title: 'Q', fields: [] },
      }),
    );
    expect(out).toMatchObject([{ type: 'form.asked', form: { id: 'frm_9' } }]);
    expect(t.translate(ev('form.cancelled', { id: 'frm_9', sessionID: 'ses_child' }))).toEqual([
      { type: 'form.resolved', sessionID: 'ses_child', formID: 'frm_9', outcome: 'cancelled' },
    ]);
  });

  it('maps form.created / replied / cancelled', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    const created = t.translate(
      ev('form.created', {
        form: { id: 'frm_1', sessionID: SES, title: 'Q', fields: [{ key: 'q0', type: 'string' }] },
      }),
    );
    expect(created[0]).toMatchObject({ type: 'form.asked', form: { id: 'frm_1', kind: 'form' } });
    expect(t.translate(ev('form.replied', { id: 'frm_1', sessionID: SES, answer: {} }))).toEqual([
      { type: 'form.resolved', sessionID: SES, formID: 'frm_1', outcome: 'answered' },
    ]);
    expect(t.translate(ev('form.cancelled', { id: 'frm_1', sessionID: SES }))).toEqual([
      { type: 'form.resolved', sessionID: SES, formID: 'frm_1', outcome: 'cancelled' },
    ]);
  });
});

describe('retry', () => {
  it('maps retry.scheduled to a retry status', () => {
    const t = createEventTranslator();
    const out = t.translate(
      ev('session.retry.scheduled', {
        sessionID: SES,
        assistantMessageID: ASSISTANT,
        attempt: 2,
        at: 99,
        error: { type: 'rate-limit', message: 'slow down' },
      }),
    );
    expect(out).toEqual([
      {
        type: 'session.status',
        sessionID: SES,
        status: { type: 'retry', attempt: 2, message: 'slow down', nextAt: 99 },
      },
    ]);
  });
});

// Review BLOCKER of 2026-10-20: a snapshot's REST reads happen BEFORE `seed`, so events that the
// stream processed in between must survive it. Fabricated sequences (shapes as in `okTurn`).
describe('seed merges instead of emptying (review BLOCKER)', () => {
  const a = { sessionID: SES, assistantMessageID: ASSISTANT };
  const empty = { sessions: [], messages: [] };

  it('keeps routing a message in flight when a snapshot read before it is seeded', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    t.translate(
      ev('session.step.started', {
        ...a,
        agent: 'build',
        model: { id: 'm', providerID: 'p' },
        started: 1,
      }),
    );
    t.translate(ev('session.reasoning.started', { ...a, ordinal: 0 }));
    t.seed(empty); // REST was read before step.started
    const out = run(t, [
      ev('session.text.started', { ...a, ordinal: 0 }),
      ev('session.text.delta', { ...a, ordinal: 0, delta: 'hi' }),
      ev('session.text.ended', { ...a, ordinal: 0, text: 'hi' }),
      ev('session.step.ended', {
        ...a,
        finish: 'stop',
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    ]);
    expect(types(out)).toEqual([
      'part.upserted',
      'part.delta',
      'part.upserted',
      'message.upserted',
    ]);
    expect(out[0]).toMatchObject({ part: { id: `${ASSISTANT}#1` } });
  });

  it('still emits the user message when seed lands between enqueued and delivered', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    t.translate(
      ev('session.inbox.enqueued', {
        sessionID: SES,
        inboxID: USER,
        item: { type: 'user', payload: { text: 'hello' }, delivery: 'queue' },
      }),
    );
    t.seed(empty);
    expect(t.translate(ev('session.inbox.delivered', { sessionID: SES, inboxID: USER }))).toEqual([
      expect.objectContaining({ type: 'message.upserted' }),
    ]);
  });

  it('mergeLive adds the in-flight messages and their accumulated blocks to a snapshot', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    t.translate(
      ev('session.inbox.enqueued', {
        sessionID: SES,
        inboxID: USER,
        item: { type: 'user', payload: { text: 'hello' }, delivery: 'queue' },
      }),
    );
    run(t, [
      ev('session.inbox.delivered', { sessionID: SES, inboxID: USER }, 1100),
      ev('session.step.started', {
        ...a,
        agent: 'build',
        model: { id: 'm', providerID: 'p' },
        started: 1200,
      }),
      ev('session.reasoning.started', { ...a, ordinal: 0 }),
      ev('session.reasoning.delta', { ...a, ordinal: 0, delta: 'th' }),
      ev('session.text.started', { ...a, ordinal: 0 }),
      ev('session.text.delta', { ...a, ordinal: 0, delta: 'par' }),
    ]);
    t.seed(empty);
    const merged = t.mergeLive({ sessionID: SES, messages: [], parts: {} });
    expect(merged.messages.map((m) => m.id)).toEqual([USER, ASSISTANT]);
    expect(merged.parts[ASSISTANT]).toEqual([
      { type: 'reasoning', id: `${ASSISTANT}#0`, text: 'th', completed: false },
      { type: 'text', id: `${ASSISTANT}#1`, text: 'par' },
    ]);
  });

  it('mergeLive returns the snapshot untouched when REST already has everything', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    const rest = JSON.parse(`{
      "id": "${ASSISTANT}", "type": "assistant", "agent": "build",
      "model": {"id": "m", "providerID": "p"}, "time": {"created": 1, "completed": 2},
      "content": [{"type": "text", "text": "done"}]
    }`) as SessionMessageInfo;
    t.seed({ sessions: [], messages: [rest] });
    const snapshot = {
      sessionID: SES,
      messages: [
        {
          kind: 'assistant' as const,
          id: ASSISTANT,
          createdAt: 1,
          agent: 'build',
          model: { providerID: 'p', id: 'm' },
        },
      ],
      parts: { [ASSISTANT]: [{ type: 'text' as const, id: `${ASSISTANT}#0`, text: 'done' }] },
    };
    expect(t.mergeLive(snapshot)).toBe(snapshot);
  });
});

// Review round 2 (2026-10-20): `mergeLive` must not bring back messages REST stopped listing, the
// status must not be overwritten by a stale REST `busy`, and on a tie the longer text wins.
// Fabricated REST messages; the logic is ours, not the server's contract.
describe('pruning, statuses and ties (review round 2)', () => {
  /** A REST assistant message `id` created at `created` with one text block. */
  const restAssistant = (id: string, created: number, textValue = 'x'): SessionMessageInfo =>
    JSON.parse(`{
      "id": "${id}", "type": "assistant", "agent": "build",
      "model": {"id": "m", "providerID": "p"}, "time": {"created": ${String(created)}, "completed": ${String(created + 1)}},
      "content": [{"type": "text", "text": "${textValue}"}]
    }`) as SessionMessageInfo;
  const emptyOpen = { sessionID: SES, messages: [], parts: {} };

  it('does not bring back a message that left the REST window (probe: [old, m2] then [m2, m3])', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    t.seed({ sessions: [], messages: [restAssistant('m_old', 10), restAssistant('m2', 20)] });
    t.seed({ sessions: [], messages: [restAssistant('m2', 20), restAssistant('m3', 30)] });
    const snapshot = {
      ...emptyOpen,
      messages: ['m2', 'm3'].map((id, i) => ({
        kind: 'assistant' as const,
        id,
        createdAt: 20 + 10 * i,
        agent: 'build',
        model: { providerID: 'p', id: 'm' },
      })),
      parts: {
        m2: [{ type: 'text' as const, id: 'm2#0', text: 'x' }],
        m3: [{ type: 'text' as const, id: 'm3#0', text: 'x' }],
      },
    };
    expect(t.mergeLive(snapshot).messages.map((m) => m.id)).toEqual(['m2', 'm3']);
  });

  it('does not bring back a message REST listed once and then stopped listing, even if newer (probe 3b)', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    t.seed({ sessions: [], messages: [restAssistant('m2', 5), restAssistant('m3', 9)] });
    t.seed({ sessions: [], messages: [restAssistant('m2', 5)] }); // m3 was deleted on the server
    const snapshot = {
      ...emptyOpen,
      messages: [
        {
          kind: 'assistant' as const,
          id: 'm2',
          createdAt: 5,
          agent: 'build',
          model: { providerID: 'p', id: 'm' },
        },
      ],
      parts: { m2: [{ type: 'text' as const, id: 'm2#0', text: 'x' }] },
    };
    expect(t.mergeLive(snapshot).messages.map((m) => m.id)).toEqual(['m2']);
  });

  it('still brings back a message newer than everything REST returned', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    t.translate(
      ev('session.step.started', {
        sessionID: SES,
        assistantMessageID: 'm_live',
        agent: 'build',
        model: { id: 'm', providerID: 'p' },
        started: 99,
      }),
    );
    t.seed({ sessions: [], messages: [restAssistant('m2', 20)] });
    // The controller's snapshot always holds what REST listed (here m2).
    const snapshot = {
      ...emptyOpen,
      messages: [
        {
          kind: 'assistant' as const,
          id: 'm2',
          createdAt: 20,
          agent: 'build',
          model: { providerID: 'p', id: 'm' },
        },
      ],
      parts: { m2: [{ type: 'text' as const, id: 'm2#0', text: 'x' }] },
    };
    expect(t.mergeLive(snapshot).messages.map((m) => m.id)).toEqual(['m2', 'm_live']);
  });

  it('lets the stream status win over a stale REST busy', () => {
    const t = createEventTranslator();
    t.beginResync();
    t.translate(ev('session.execution.succeeded', { sessionID: SES }));
    expect(t.mergeStatuses({ [SES]: { type: 'busy' }, other: { type: 'busy' } })).toEqual({
      [SES]: { type: 'idle' },
      other: { type: 'busy' },
    });
    t.beginResync(); // a new resync forgets what the previous one saw
    expect(t.mergeStatuses({ [SES]: { type: 'busy' } })).toEqual({ [SES]: { type: 'busy' } });
  });

  it('keeps the longer text of each block when REST and the stream have the same blocks', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    const a = { sessionID: SES, assistantMessageID: 'm1' };
    run(t, [
      ev('session.step.started', {
        ...a,
        agent: 'build',
        model: { id: 'm', providerID: 'p' },
        started: 5,
      }),
      ev('session.text.started', { ...a, ordinal: 0 }),
      ev('session.text.delta', { ...a, ordinal: 0, delta: 'ab' }),
    ]);
    t.seed({ sessions: [], messages: [restAssistant('m1', 5, 'a')] });
    const rest = {
      ...emptyOpen,
      messages: [
        {
          kind: 'assistant' as const,
          id: 'm1',
          createdAt: 5,
          agent: 'build',
          model: { providerID: 'p', id: 'm' },
        },
      ],
      parts: { m1: [{ type: 'text' as const, id: 'm1#0', text: 'a' }] },
    };
    expect(t.mergeLive(rest).parts['m1']).toEqual([{ type: 'text', id: 'm1#0', text: 'ab' }]);
  });
});

describe('snapshot and stream agree on block ids', () => {
  it('gives the same part ids through REST mapping as through the event stream', () => {
    const t = createEventTranslator();
    t.setOpen(SES);
    const streamed = run(t, okTurn())
      .filter((m) => m.type === 'part.upserted')
      .map((m) => (m.type === 'part.upserted' ? m.part.id : ''));
    const rest = JSON.parse(`{
      "id": "${ASSISTANT}", "type": "assistant", "agent": "build",
      "model": {"id": "big-pickle", "providerID": "opencode"}, "time": {"created": 1, "completed": 2},
      "content": [
        {"type": "reasoning", "text": "think hard", "time": {"created": 1, "completed": 2}},
        {"type": "text", "text": "hello there"}
      ]
    }`) as SessionMessageInfo;
    const restIds = toMessage(rest, {})?.parts.map((p) => p.id);
    expect([...new Set(streamed)]).toEqual(restIds);
  });
});

describe('seed from a REST snapshot', () => {
  it('continues the position counter after the blocks already in content[]', () => {
    const t = createEventTranslator();
    const rest = JSON.parse(`{
      "id": "${ASSISTANT}", "type": "assistant", "agent": "build",
      "model": {"id": "m", "providerID": "p"}, "time": {"created": 1, "completed": 2},
      "content": [
        {"type": "reasoning", "text": "r", "time": {"created": 1, "completed": 2}},
        {"type": "text", "text": "t"}
      ]
    }`) as SessionMessageInfo;
    t.setOpen(SES);
    t.seed({ sessions: [], messages: [rest] });
    const out = t.translate(
      ev('session.text.started', { sessionID: SES, assistantMessageID: ASSISTANT, ordinal: 1 }),
    );
    expect(out).toEqual([
      {
        type: 'part.upserted',
        sessionID: SES,
        messageID: ASSISTANT,
        part: { type: 'text', id: `${ASSISTANT}#2`, text: '' },
      },
    ]);
  });

  it('points text deltas at the last seeded text block', () => {
    const t = createEventTranslator();
    const rest = JSON.parse(`{
      "id": "${ASSISTANT}", "type": "assistant", "agent": "build",
      "model": {"id": "m", "providerID": "p"}, "time": {"created": 1},
      "content": [{"type": "reasoning", "text": "r", "time": {"created": 1, "completed": 2}},
                  {"type": "text", "text": "par"}]
    }`) as SessionMessageInfo;
    t.setOpen(SES);
    t.seed({ sessions: [], messages: [rest] });
    const out = t.translate(
      ev('session.text.delta', {
        sessionID: SES,
        assistantMessageID: ASSISTANT,
        ordinal: 0,
        delta: 'tial',
      }),
    );
    expect(out[0]).toMatchObject({ type: 'part.delta', partID: `${ASSISTANT}#1`, delta: 'tial' });
  });
});

describe('secrets in error texts', () => {
  it('scrubs the server url from a failed execution before it reaches the webview', () => {
    const t = createEventTranslator({ url: 'http://127.0.0.1:43211', password: 'pw-12345' });
    const out = t.translate(
      ev('session.execution.failed', {
        sessionID: SES,
        error: {
          type: 'transport',
          message: 'could not reach http://127.0.0.1:43211 with pw-12345',
        },
      }),
    );
    expect(JSON.stringify(out)).not.toContain('43211');
    expect(JSON.stringify(out)).not.toContain('pw-12345');
  });
});
