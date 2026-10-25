// Protects the multi-session half of the translator added for the chat in several surfaces (issue
// #77, phase 1 of `E9-chat-editor-tabs`): two tracked sessions streaming at once must each get
// their own `message.*` / `part.*`; the REST seed of one must not prune what the stream built for
// the other; untracking a session must forget only that one; and two resyncs that overlap must not
// erase each other's overlay of statuses and totals (R2 of the plan: with the old global
// `beginResync()` clear, the first resync published a stale `busy` and Send stayed blocked).
//
// Provenance: FABRICATED sequences in the shapes of `eventTranslator.test.ts` (themselves copied
// from the planner's recording of a real opencode 2.0.32, Windows 11, 2026-10-20). They confirm
// OUR bookkeeping per session; that the real server interleaves two sessions this way is not
// observed here (the e2e case "streams two prompts at once, each pane receiving only the content
// of its own session" runs it against the synthetic server only).
import type { SessionMessageInfo, V2Event } from '@opencode/client';
import { describe, expect, it } from 'vitest';
import { createEventTranslator } from './eventTranslator';

const A = 'ses_a';
const B = 'ses_b';

let counter = 0;

/** Builds an event the way it travels on the wire (JSON round trip), typed as the client types it. */
function ev(type: string, data: object, created = 1000): V2Event {
  counter += 1;
  return JSON.parse(
    JSON.stringify({ id: `evt_${String(counter)}`, created, type, data }),
  ) as V2Event;
}

/** The first events of an assistant message with one text block growing by `delta`. */
function streaming(sessionID: string, messageID: string, delta: string): V2Event[] {
  const a = { sessionID, assistantMessageID: messageID };
  return [
    ev('session.step.started', {
      ...a,
      agent: 'build',
      model: { id: 'm', providerID: 'p' },
      started: 5,
    }),
    ev('session.text.started', { ...a, ordinal: 0 }),
    ev('session.text.delta', { ...a, ordinal: 0, delta }),
  ];
}

/** A REST assistant message with one text block. */
const rest = (id: string, created: number): SessionMessageInfo =>
  JSON.parse(`{
    "id": "${id}", "type": "assistant", "agent": "build",
    "model": {"id": "m", "providerID": "p"}, "time": {"created": ${String(created)}, "completed": ${String(created + 1)}},
    "content": [{"type": "text", "text": "x"}]
  }`) as SessionMessageInfo;

describe('two tracked sessions', () => {
  it('give each its own parts and deltas, addressed to its own session', () => {
    const t = createEventTranslator();
    t.setTracked([A, B]);
    const out = [...streaming(A, 'msg_a1', 'alpha'), ...streaming(B, 'msg_b1', 'beta')].flatMap(
      (event) => t.translate(event),
    );
    const deltas = out.filter((m) => m.type === 'part.delta');
    expect(deltas).toMatchObject([
      { sessionID: A, messageID: 'msg_a1', delta: 'alpha' },
      { sessionID: B, messageID: 'msg_b1', delta: 'beta' },
    ]);
  });

  it('drops the deltas of a session that is not tracked', () => {
    const t = createEventTranslator();
    t.setTracked([A]);
    const out = streaming(B, 'msg_b1', 'beta').flatMap((event) => t.translate(event));
    expect(out).toEqual([]);
  });

  it('does not prune the in-flight message of B when A is seeded from REST', () => {
    const t = createEventTranslator();
    t.setTracked([A, B]);
    streaming(B, 'msg_b1', 'beta').forEach((event) => t.translate(event));
    // REST of A lists a message of A only; B's message (born in the stream) is not REST's to judge.
    t.seed({ sessions: [], messages: [rest('msg_a0', 10)], sessionID: A, merge: true });
    const merged = t.mergeLive({ sessionID: B, messages: [], parts: {} });
    expect(merged.messages.map((m) => m.id)).toEqual(['msg_b1']);
    // And A's snapshot does not get B's message.
    const mergedA = t.mergeLive({ sessionID: A, messages: [], parts: {} });
    expect(mergedA.messages.map((m) => m.id)).toEqual(['msg_a0']);
  });

  it('forgets only the untracked session when setTracked drops B', () => {
    const t = createEventTranslator();
    t.setTracked([A, B]);
    streaming(A, 'msg_a1', 'alpha').forEach((event) => t.translate(event));
    streaming(B, 'msg_b1', 'beta').forEach((event) => t.translate(event));
    t.setTracked([A]);
    expect(t.mergeLive({ sessionID: B, messages: [], parts: {} }).messages).toEqual([]);
    expect(
      t.mergeLive({ sessionID: A, messages: [], parts: {} }).messages.map((m) => m.id),
    ).toEqual(['msg_a1']);
    // A kept its tracker: the next delta still lands.
    const out = t.translate(
      ev('session.text.delta', {
        sessionID: A,
        assistantMessageID: 'msg_a1',
        ordinal: 0,
        delta: '!',
      }),
    );
    expect(out).toMatchObject([{ type: 'part.delta', sessionID: A, delta: '!' }]);
  });

  it('forgetFrom with a session leaves the other session untouched', () => {
    const t = createEventTranslator();
    t.setTracked([A, B]);
    streaming(A, 'msg_5', 'alpha').forEach((event) => t.translate(event));
    streaming(B, 'msg_7', 'beta').forEach((event) => t.translate(event));
    t.forgetFrom('msg_1', A);
    expect(t.mergeLive({ sessionID: A, messages: [], parts: {} }).messages).toEqual([]);
    expect(
      t.mergeLive({ sessionID: B, messages: [], parts: {} }).messages.map((m) => m.id),
    ).toEqual(['msg_7']);
  });
});

describe('overlapping resyncs (R2)', () => {
  it('keeps the idle that arrived after the first resync began although a second one began later', () => {
    const t = createEventTranslator();
    const first = t.beginResync();
    t.translate(ev('session.execution.succeeded', { sessionID: A }));
    const second = t.beginResync(); // the old global clear erased the idle here
    expect(t.mergeStatuses({ [A]: { type: 'busy' } }, first)).toEqual({ [A]: { type: 'idle' } });
    // The second resync began after the idle: its REST read already knows, nothing to overlay.
    expect(t.mergeStatuses({ [A]: { type: 'busy' } }, second)).toEqual({ [A]: { type: 'busy' } });
  });

  it('keeps the totals that arrived after the first resync began for the first one only', () => {
    const t = createEventTranslator();
    t.seed({ sessions: [{ id: A, createdAt: 1, updatedAt: 2 }], messages: [] });
    const first = t.beginResync();
    t.translate(
      ev('session.usage.updated', {
        sessionID: A,
        cost: 1,
        tokens: { input: 9, output: 9, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    );
    const second = t.beginResync();
    const rows = [{ id: A, createdAt: 1, updatedAt: 2 }];
    expect(t.mergeUsage(rows, first)[0]?.usage?.cost).toBe(1);
    expect(t.mergeUsage(rows, second)).toBe(rows);
  });

  it('without a token the newest resync is used, as before', () => {
    const t = createEventTranslator();
    t.beginResync();
    t.translate(ev('session.execution.succeeded', { sessionID: A }));
    expect(t.mergeStatuses({ [A]: { type: 'busy' } })).toEqual({ [A]: { type: 'idle' } });
  });
});
