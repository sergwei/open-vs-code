// Protects the three properties the streaming UI depends on:
//  1. a `part.delta` APPENDS to the leaf and keeps the object identity of the part, because
//     `<For>` decides by identity and a replaced object would rebuild its DOM on every token
//     (skill solid-webview §2, §8);
//  2. a delta for an unknown block is dropped instead of inventing one;
//  3. the store is reactive in this environment (HYPOTHESIS: a Solid server build would pass the
//     other tests and still never re-run an effect; not run. The browser dev build IS the one
//     loaded here, seen in a stack trace: `node_modules/solid-js/dist/dev.js`).
//
// E4-session-management (#20), at the end: a session-list page counts only for the newest query,
// queries and renames/deletes never touch `pending` (Send stays usable), events keep a loaded list
// in step, and a removed session takes its request cards with it.
//
// Provenance of the data: messages FABRICATED by hand in the shape of the protocol of
// `src/shared`. They confirm the reducer's logic, not what the host actually sends: that is
// protected by the host tests and the opt-in integration suite.
import { createEffect, createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { MessageInfo, Part, RequestResolution } from '../../../src/shared/model';
import { createChatStore, MAX_NOTICES, MAX_RESOLVED, type ChatStore } from './chatStore';

const SES = 'ses_1';
const assistant: MessageInfo = {
  kind: 'assistant',
  id: 'msg_a',
  createdAt: 1,
  agent: 'build',
  model: { providerID: 'opencode', id: 'big-pickle' },
};
/** A text part of `assistant` at position 0 with the given content. */
const text = (value: string): Part => ({ type: 'text', id: 'msg_a#0', text: value });

/** Snapshot with `SES` open and empty. */
function openSnapshot() {
  return {
    sessions: [{ id: SES, createdAt: 1, updatedAt: 1 }],
    statuses: { [SES]: { type: 'idle' as const } },
    open: { sessionID: SES, messages: [], parts: {} },
    requests: { permissions: [], forms: [] },
    resolutions: [] as RequestResolution[],
  };
}

/** Runs `body` inside a reactive root with a fresh store whose open session is `SES`. */
function withStore(body: (store: ChatStore) => void): void {
  createRoot((dispose) => {
    const store = createChatStore();
    store.apply({ type: 'snapshot', snapshot: openSnapshot() });
    try {
      body(store);
    } finally {
      dispose();
    }
  });
}

describe('snapshot', () => {
  it('replaces the sessions, statuses and open session', () => {
    withStore((store) => {
      store.apply({
        type: 'snapshot',
        snapshot: {
          sessions: [{ id: 'ses_2', createdAt: 5, updatedAt: 6 }],
          statuses: { ses_2: { type: 'busy' } },
          open: {
            sessionID: 'ses_2',
            messages: [assistant],
            parts: { msg_a: [text('hi')] },
          },
          requests: { permissions: [], forms: [] },
          resolutions: [],
        },
      });
      expect(Object.keys(store.state.sessions)).toEqual(['ses_2']);
      expect(store.state.statuses['ses_2']).toEqual({ type: 'busy' });
      expect(store.state.open.sessionID).toBe('ses_2');
      expect(store.state.open.parts['msg_a']?.[0]).toMatchObject({ text: 'hi' });
    });
  });

  it('keeps the identity of a message that is in both snapshots', () => {
    withStore((store) => {
      const snapshot = (value: string) => ({
        type: 'snapshot' as const,
        snapshot: {
          sessions: [],
          statuses: {},
          open: {
            sessionID: SES,
            messages: [assistant],
            parts: { msg_a: [text(value)] },
          },
          requests: { permissions: [], forms: [] },
          resolutions: [],
        },
      });
      store.apply(snapshot('one'));
      const before = store.state.open.parts['msg_a']?.[0];
      store.apply(snapshot('one two'));
      expect(store.state.open.parts['msg_a']?.[0]).toBe(before);
      expect(before).toMatchObject({ text: 'one two' });
    });
  });

  // Issue #25: the compaction boundary travels in the snapshot only; a snapshot without it must
  // clear the old one (the reconcile of `open` removes the key).
  it('stores compactedAt from the snapshot and clears it when the next one has none', () => {
    withStore((store) => {
      const snapshot = (compactedAt?: number) => ({
        type: 'snapshot' as const,
        snapshot: {
          ...openSnapshot(),
          open: {
            sessionID: SES,
            messages: [],
            parts: {},
            ...(compactedAt ? { compactedAt } : {}),
          },
        },
      });
      store.apply(snapshot(500));
      expect(store.state.open.compactedAt).toBe(500);
      store.apply(snapshot());
      expect(store.state.open.compactedAt).toBeUndefined();
    });
  });

  it('keeps the identity of a session row when session.upserted brings new usage', () => {
    withStore((store) => {
      const usage = (input: number) => ({
        cost: 0.1,
        tokens: { input, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      });
      store.apply({
        type: 'session.upserted',
        session: { id: SES, createdAt: 1, updatedAt: 1, usage: usage(10) },
      });
      const row = store.state.sessions[SES];
      store.apply({
        type: 'session.upserted',
        session: { id: SES, createdAt: 1, updatedAt: 1, usage: usage(20) },
      });
      expect(store.state.sessions[SES]).toBe(row);
      expect(store.state.sessions[SES]?.usage?.tokens.input).toBe(20);
    });
  });

  it('goes back to an empty open view when the snapshot has none', () => {
    withStore((store) => {
      store.apply({
        type: 'snapshot',
        snapshot: {
          sessions: [],
          statuses: {},
          requests: { permissions: [], forms: [] },
          resolutions: [],
        },
      });
      expect(store.state.open.sessionID).toBeUndefined();
      expect(store.state.open.messages).toEqual([]);
    });
  });
});

describe('part deltas', () => {
  it('appends to the text and keeps the identity of the part object', () => {
    withStore((store) => {
      store.apply({ type: 'message.upserted', sessionID: SES, message: assistant });
      store.apply({ type: 'part.upserted', sessionID: SES, messageID: 'msg_a', part: text('') });
      const before = store.state.open.parts['msg_a']?.[0];
      const list = store.state.open.parts['msg_a'];
      store.apply({
        type: 'part.delta',
        sessionID: SES,
        messageID: 'msg_a',
        partID: 'msg_a#0',
        field: 'text',
        delta: 'Hel',
      });
      store.apply({
        type: 'part.delta',
        sessionID: SES,
        messageID: 'msg_a',
        partID: 'msg_a#0',
        field: 'text',
        delta: 'lo',
      });
      expect(store.state.open.parts['msg_a']?.[0]).toMatchObject({ text: 'Hello' });
      expect(store.state.open.parts['msg_a']?.[0]).toBe(before);
      expect(store.state.open.parts['msg_a']).toBe(list); // the array is not replaced either
    });
  });

  it('keeps the identity of a part replaced by its upsert and swaps its text', () => {
    withStore((store) => {
      store.apply({ type: 'message.upserted', sessionID: SES, message: assistant });
      store.apply({ type: 'part.upserted', sessionID: SES, messageID: 'msg_a', part: text('par') });
      const before = store.state.open.parts['msg_a']?.[0];
      store.apply({
        type: 'part.upserted',
        sessionID: SES,
        messageID: 'msg_a',
        part: text('partial done'),
      });
      expect(store.state.open.parts['msg_a']?.[0]).toBe(before);
      expect(before).toMatchObject({ text: 'partial done' });
    });
  });

  it('appends a streaming tool input through field "input"', () => {
    withStore((store) => {
      store.apply({ type: 'message.upserted', sessionID: SES, message: assistant });
      store.apply({
        type: 'part.upserted',
        sessionID: SES,
        messageID: 'msg_a',
        part: {
          type: 'tool',
          id: 'call_1',
          name: 'read',
          state: { status: 'streaming', input: '{"p' },
        },
      });
      store.apply({
        type: 'part.delta',
        sessionID: SES,
        messageID: 'msg_a',
        partID: 'call_1',
        field: 'input',
        delta: 'ath"}',
      });
      expect(store.state.open.parts['msg_a']?.[0]).toMatchObject({
        state: { status: 'streaming', input: '{"path"}' },
      });
    });
  });

  it('drops a delta for an unknown block and for another session', () => {
    withStore((store) => {
      store.apply({
        type: 'part.delta',
        sessionID: SES,
        messageID: 'msg_ghost',
        partID: 'msg_ghost#0',
        field: 'text',
        delta: 'x',
      });
      store.apply({
        type: 'part.delta',
        sessionID: 'ses_other',
        messageID: 'msg_a',
        partID: 'msg_a#0',
        field: 'text',
        delta: 'x',
      });
      expect(store.state.open.parts).toEqual({});
    });
  });

  it('re-runs an effect that reads the streamed text (browser build of solid-js)', () => {
    // The effect only starts once `createRoot` returns, so the deltas are applied afterwards.
    // HYPOTHESIS: with the SERVER build of solid-js loaded, effects would never re-run and
    // `seen` would stay at one entry (not run; the browser dev build is what loads here).
    const seen: string[] = [];
    let store: ChatStore | undefined;
    const dispose = createRoot((disposeRoot) => {
      store = createChatStore();
      store.apply({ type: 'snapshot', snapshot: openSnapshot() });
      store.apply({ type: 'message.upserted', sessionID: SES, message: assistant });
      store.apply({ type: 'part.upserted', sessionID: SES, messageID: 'msg_a', part: text('') });
      const current = store;
      createEffect(() => {
        const part = current.state.open.parts['msg_a']?.[0];
        seen.push(part?.type === 'text' ? part.text : '');
      });
      return disposeRoot;
    });
    const delta = (value: string) =>
      store?.apply({
        type: 'part.delta',
        sessionID: SES,
        messageID: 'msg_a',
        partID: 'msg_a#0',
        field: 'text',
        delta: value,
      });
    delta('a');
    delta('b');
    dispose();
    expect(seen).toEqual(['', 'a', 'ab']);
  });
});

describe('messages and status', () => {
  it('replaces a message in place and appends a new one', () => {
    withStore((store) => {
      store.apply({ type: 'message.upserted', sessionID: SES, message: assistant });
      const before = store.state.open.messages[0];
      store.apply({
        type: 'message.upserted',
        sessionID: SES,
        message: { ...assistant, completedAt: 9, finish: 'stop' },
      });
      store.apply({
        type: 'message.upserted',
        sessionID: SES,
        message: { kind: 'user', id: 'msg_u', createdAt: 2, text: 'hi', files: [] },
      });
      expect(store.state.open.messages).toHaveLength(2);
      expect(store.state.open.messages[0]).toBe(before);
      expect(before).toMatchObject({ finish: 'stop' });
    });
  });

  it('goes from error back to busy without keeping the old error', () => {
    withStore((store) => {
      store.apply({
        type: 'session.status',
        sessionID: SES,
        status: { type: 'error', error: { code: 'x', message: 'y' } },
      });
      store.apply({ type: 'session.status', sessionID: SES, status: { type: 'busy' } });
      expect(store.state.statuses[SES]).toEqual({ type: 'busy' });
    });
  });

  it('removes the open session and empties the view when it is deleted', () => {
    withStore((store) => {
      store.apply({ type: 'session.removed', sessionID: SES });
      expect(store.state.sessions[SES]).toBeUndefined();
      expect(store.state.open.sessionID).toBeUndefined();
    });
  });
});

describe('requests and notices', () => {
  it('tracks pending requests and clears them on request.result', () => {
    withStore((store) => {
      store.begin('r1');
      expect(store.state.pending).toEqual(['r1']);
      store.apply({ type: 'request.result', requestId: 'r1' });
      expect(store.state.pending).toEqual([]);
      expect(store.state.notices).toEqual([]);
    });
  });

  it('turns a request.result with an error into a notice', () => {
    withStore((store) => {
      store.begin('r1');
      store.apply({
        type: 'request.result',
        requestId: 'r1',
        error: { code: 'NotImplemented', message: 'nope' },
      });
      expect(store.state.pending).toEqual([]);
      expect(store.state.notices[0]).toMatchObject({
        level: 'error',
        error: { code: 'NotImplemented' },
      });
    });
  });

  it('keeps at most MAX_NOTICES notices, dropping the oldest', () => {
    withStore((store) => {
      for (let i = 0; i < MAX_NOTICES + 3; i += 1) {
        store.apply({
          type: 'notice',
          level: 'warning',
          error: { code: 'c', message: `m${String(i)}` },
        });
      }
      expect(store.state.notices).toHaveLength(MAX_NOTICES);
      expect(store.state.notices[0]?.error.message).toBe('m3');
    });
  });
});

// Phase 3 (issues #18/#44): the pending requests of the whole location. Fabricated messages: they
// confirm the reducer, not what the host sends.
describe('requests', () => {
  const permission = (id: string, sessionID = SES) => ({
    id,
    sessionID,
    action: 'read',
    resources: ['.env'],
    save: ['*'],
  });
  const question = (id: string, sessionID = SES) => ({
    id,
    sessionID,
    title: 'Questions',
    kind: 'question' as const,
    fields: [],
  });
  const resolve = (
    store: ChatStore,
    id: string,
    decision: 'once' | 'always' | 'reject' = 'once',
  ) => {
    store.apply({ type: 'permission.resolved', sessionID: SES, permissionID: id, decision });
  };

  it('stores the requests of ANY session, in order, without duplicates', () => {
    withStore((store) => {
      store.apply({ type: 'permission.asked', permission: permission('per_1') });
      store.apply({ type: 'permission.asked', permission: permission('per_2', 'ses_child') });
      store.apply({ type: 'permission.asked', permission: permission('per_1') });
      store.apply({ type: 'form.asked', form: question('frm_1', 'ses_child') });
      store.apply({ type: 'form.asked', form: question('frm_1', 'ses_child') });
      expect(store.state.requests.permissions.map((p) => p.id)).toEqual(['per_1', 'per_2']);
      expect(store.state.requests.forms.map((f) => f.id)).toEqual(['frm_1']);
    });
  });

  it('a snapshot replaces the set, keeps the identity of what stays and forgets the card state of what left', () => {
    withStore((store) => {
      store.apply({ type: 'permission.asked', permission: permission('per_1') });
      store.apply({ type: 'permission.asked', permission: permission('per_2') });
      const kept = store.state.requests.permissions[0];
      store.beginReply('per_2', 'r1');
      store.apply({
        type: 'snapshot',
        snapshot: {
          ...openSnapshot(),
          requests: { permissions: [permission('per_1')], forms: [question('frm_9')] },
        },
      });
      expect(store.state.requests.permissions.map((p) => p.id)).toEqual(['per_1']);
      expect(store.state.requests.permissions[0]).toBe(kept);
      expect(store.state.requests.forms.map((f) => f.id)).toEqual(['frm_9']);
      expect(store.state.replying).toEqual({});
    });
  });

  it('resolving removes the card and leaves a result line with the wording and the label', () => {
    withStore((store) => {
      store.apply({ type: 'permission.asked', permission: permission('per_1') });
      resolve(store, 'per_1', 'once');
      expect(store.state.requests.permissions).toEqual([]);
      expect(store.state.resolved).toEqual([
        { id: 'per_1', outcome: 'Allowed once', label: 'Read .env' },
      ]);
      store.apply({ type: 'form.asked', form: question('frm_1') });
      store.apply({ type: 'form.resolved', sessionID: SES, formID: 'frm_1', outcome: 'cancelled' });
      expect(store.state.resolved.at(-1)).toEqual({
        id: 'frm_1',
        outcome: 'Dismissed',
        label: 'Question from the agent',
      });
    });
  });

  // E3-resolved-history (issues #56/#18). FABRICATED host messages.
  describe('resolutions', () => {
    const record = (
      id: string,
      sessionID = SES,
      decision: 'once' | 'always' | 'reject' = 'once',
    ): RequestResolution => ({
      kind: 'permission',
      id,
      sessionID,
      tool: { messageID: 'msg_a', partID: 'call_1' },
      at: 5,
      decision,
      action: 'read',
      resource: '.env',
      withFeedback: false,
    });

    it('a resolved request of the OPEN session with a record goes to resolutions and adds no dock line', () => {
      withStore((store) => {
        store.apply({ type: 'permission.asked', permission: permission('per_1') });
        store.apply({
          type: 'permission.resolved',
          sessionID: SES,
          permissionID: 'per_1',
          decision: 'once',
          resolution: record('per_1'),
        });
        expect(store.state.requests.permissions).toEqual([]);
        expect(store.state.resolved).toEqual([]);
        expect(store.state.resolutions['per_1']).toMatchObject({ id: 'per_1', decision: 'once' });
      });
    });

    it('a resolved form of the open session behaves the same', () => {
      withStore((store) => {
        store.apply({ type: 'form.asked', form: question('frm_1') });
        store.apply({
          type: 'form.resolved',
          sessionID: SES,
          formID: 'frm_1',
          outcome: 'answered',
          resolution: {
            kind: 'form',
            id: 'frm_1',
            sessionID: SES,
            at: 5,
            outcome: 'answered',
            formKind: 'question',
            title: 'Questions',
            withMessage: false,
          },
        });
        expect(store.state.resolved).toEqual([]);
        expect(store.state.resolutions['frm_1']).toMatchObject({ kind: 'form' });
      });
    });

    it('a request of ANOTHER session keeps the dock line and stores no record', () => {
      withStore((store) => {
        store.apply({ type: 'permission.asked', permission: permission('per_c', 'ses_child') });
        store.apply({
          type: 'permission.resolved',
          sessionID: 'ses_child',
          permissionID: 'per_c',
          decision: 'reject',
          resolution: record('per_c', 'ses_child', 'reject'),
        });
        expect(store.state.resolved).toEqual([
          { id: 'per_c', outcome: 'Rejected', label: 'Read .env' },
        ]);
        expect(store.state.resolutions).toEqual({});
      });
    });

    it('a resolved message with no record falls back to the dock line, even for the open session', () => {
      withStore((store) => {
        store.apply({ type: 'permission.asked', permission: permission('per_1') });
        resolve(store, 'per_1', 'once');
        expect(store.state.resolved).toHaveLength(1);
        expect(store.state.resolutions).toEqual({});
      });
    });

    it('clearResolved empties the dock lines and NEVER the records (they are history)', () => {
      withStore((store) => {
        store.apply({ type: 'permission.asked', permission: permission('per_1') });
        store.apply({
          type: 'permission.resolved',
          sessionID: SES,
          permissionID: 'per_1',
          decision: 'once',
          resolution: record('per_1'),
        });
        store.apply({ type: 'permission.asked', permission: permission('per_c', 'ses_child') });
        resolve(store, 'per_c');
        store.clearResolved();
        expect(store.state.resolved).toEqual([]);
        expect(Object.keys(store.state.resolutions)).toEqual(['per_1']);
      });
    });

    it('a snapshot replaces the records, and a snapshot without records empties them', () => {
      withStore((store) => {
        store.apply({
          type: 'snapshot',
          snapshot: { ...openSnapshot(), resolutions: [record('per_1'), record('per_2')] },
        });
        expect(Object.keys(store.state.resolutions)).toEqual(['per_1', 'per_2']);
        store.apply({
          type: 'snapshot',
          snapshot: { ...openSnapshot(), resolutions: [record('per_2')] },
        });
        expect(Object.keys(store.state.resolutions)).toEqual(['per_2']);
        store.apply({ type: 'snapshot', snapshot: openSnapshot() });
        expect(store.state.resolutions).toEqual({});
      });
    });

    it('removing the open session empties the records', () => {
      withStore((store) => {
        store.apply({
          type: 'snapshot',
          snapshot: { ...openSnapshot(), resolutions: [record('per_1')] },
        });
        store.apply({ type: 'session.removed', sessionID: SES });
        expect(store.state.resolutions).toEqual({});
      });
    });
  });

  it('resolving a request it never had adds no result line', () => {
    withStore((store) => {
      resolve(store, 'per_unknown');
      expect(store.state.resolved).toEqual([]);
    });
  });

  it('keeps at most MAX_RESOLVED lines and clearResolved empties them', () => {
    withStore((store) => {
      for (let i = 0; i < MAX_RESOLVED + 2; i += 1) {
        store.apply({ type: 'permission.asked', permission: permission(`per_${String(i)}`) });
        resolve(store, `per_${String(i)}`);
      }
      expect(store.state.resolved).toHaveLength(MAX_RESOLVED);
      expect(store.state.resolved[0]?.id).toBe('per_2');
      store.clearResolved();
      expect(store.state.resolved).toEqual([]);
    });
  });

  it('beginReply marks the card in flight without locking the prompt; resolving clears the mark', () => {
    withStore((store) => {
      store.apply({ type: 'permission.asked', permission: permission('per_1') });
      store.beginReply('per_1', 'r1');
      expect(store.state.replying).toEqual({ per_1: 'r1' });
      expect(store.state.pending).toEqual([]);
      resolve(store, 'per_1');
      expect(store.state.replying).toEqual({});
    });
  });

  it('an error result of a card reply lands in requestErrors, not in a notice, and unlocks the card', () => {
    withStore((store) => {
      store.apply({ type: 'form.asked', form: question('frm_1') });
      store.beginReply('frm_1', 'r1');
      store.apply({
        type: 'request.result',
        requestId: 'r1',
        error: { code: 'FormInvalidAnswerError', message: 'q0 is required' },
      });
      expect(store.state.replying).toEqual({});
      expect(store.state.requestErrors['frm_1']).toEqual({
        code: 'FormInvalidAnswerError',
        message: 'q0 is required',
      });
      expect(store.state.notices).toEqual([]);
      // Trying again forgets the old error.
      store.beginReply('frm_1', 'r2');
      expect(store.state.requestErrors).toEqual({});
    });
  });

  it('a stale-request error is ALSO a notice, because the card is about to vanish', () => {
    withStore((store) => {
      store.apply({ type: 'permission.asked', permission: permission('per_1') });
      store.beginReply('per_1', 'r1');
      store.apply({
        type: 'request.result',
        requestId: 'r1',
        error: { code: 'PermissionNotFoundError', message: 'gone' },
      });
      expect(store.state.notices.map((n) => n.error.code)).toEqual(['PermissionNotFoundError']);
    });
  });

  it('a success result keeps the card locked until it is resolved or the next snapshot (W6)', () => {
    withStore((store) => {
      store.apply({ type: 'permission.asked', permission: permission('per_1') });
      store.beginReply('per_1', 'r1');
      store.apply({ type: 'request.result', requestId: 'r1' });
      expect(store.state.replying).toEqual({ per_1: 'r1' });
      expect(store.state.requestErrors).toEqual({});
      resolve(store, 'per_1');
      expect(store.state.replying).toEqual({});

      store.apply({ type: 'permission.asked', permission: permission('per_2') });
      store.beginReply('per_2', 'r2');
      store.apply({ type: 'request.result', requestId: 'r2' });
      store.apply({
        type: 'snapshot',
        snapshot: {
          ...openSnapshot(),
          requests: { permissions: [permission('per_2')], forms: [] },
        },
      });
      expect(store.state.replying).toEqual({});
    });
  });

  it('drops the requests when the connection goes to starting, unavailable or stopped, not on reconnecting (W2)', () => {
    withStore((store) => {
      store.apply({ type: 'permission.asked', permission: permission('per_1') });
      store.apply({ type: 'connection.state', connection: { state: 'reconnecting', attempt: 1 } });
      expect(store.state.requests.permissions).toHaveLength(1);
      for (const connection of [
        { state: 'starting' },
        { state: 'stopped' },
        {
          state: 'unavailable',
          reason: 'exited',
          error: { code: 'exited', message: 'gone' },
        },
      ] as const) {
        store.apply({ type: 'permission.asked', permission: permission('per_1') });
        store.beginReply('per_1', 'r1');
        store.apply({ type: 'connection.state', connection });
        expect(store.state.requests).toEqual({ permissions: [], forms: [] });
        expect(store.state.replying).toEqual({});
      }
    });
  });

  it('forgets a ui.focus whose request the snapshot does not list (S4)', () => {
    withStore((store) => {
      store.apply({
        type: 'ui.focus',
        target: { kind: 'permission', sessionID: SES, id: 'per_9' },
      });
      store.apply({ type: 'snapshot', snapshot: openSnapshot() });
      expect(store.state.focusTarget).toBeUndefined();
    });
  });

  it('ui.focus stores the target until it is cleared', () => {
    withStore((store) => {
      const target = { kind: 'permission', sessionID: SES, id: 'per_1' } as const;
      store.apply({ type: 'ui.focus', target });
      expect(store.state.focusTarget).toEqual(target);
      store.clearFocusTarget();
      expect(store.state.focusTarget).toBeUndefined();
    });
  });

  it('removing the open session does not touch the pending requests of other sessions', () => {
    withStore((store) => {
      store.apply({ type: 'permission.asked', permission: permission('per_1', 'ses_child') });
      store.apply({ type: 'session.removed', sessionID: SES });
      expect(store.state.requests.permissions.map((p) => p.id)).toEqual(['per_1']);
    });
  });
});

describe('connection', () => {
  it('stores the connection state', () => {
    withStore((store) => {
      store.apply({ type: 'connection.state', connection: { state: 'reconnecting', attempt: 2 } });
      expect(store.state.connection).toEqual({ state: 'reconnecting', attempt: 2 });
      store.apply({
        type: 'connection.state',
        connection: { state: 'connected', serverVersion: '2.0.32' },
      });
      expect(store.state.connection).toEqual({ state: 'connected', serverVersion: '2.0.32' });
    });
  });
});

// Phase 2 (issues #13/#16): attachments chosen with Attach, dismissible notices and the
// `requestId` that lets the UI give an unsent prompt back. Data fabricated like the rest.
describe('attachments and notices (phase 2)', () => {
  const a = { uri: 'file:///a.ts', name: 'a.ts' };
  const b = { uri: 'file:///b.ts', name: 'b.ts' };

  it('collects picked files without duplicating a uri, removes one and takes them all', () => {
    withStore((store) => {
      store.apply({ type: 'attachments.picked', requestId: 'p1', files: [a, b, a] });
      store.apply({ type: 'attachments.picked', requestId: 'p2', files: [a] });
      expect(store.state.draftFiles).toEqual([a, b]);
      store.removeDraftFile(a.uri);
      expect(store.state.draftFiles).toEqual([b]);
      expect(store.takeDraftFiles()).toEqual([b]);
      expect(store.state.draftFiles).toEqual([]);
    });
  });

  it('keeps the requestId of a failed request on its notice, and none on a host notice', () => {
    withStore((store) => {
      store.apply({
        type: 'request.result',
        requestId: 'r7',
        error: { code: 'AttachmentRejected', message: 'no' },
      });
      store.apply({
        type: 'notice',
        level: 'warning',
        error: { code: 'NoActiveEditor', message: 'Open a file' },
      });
      expect(store.state.notices[0]).toMatchObject({ level: 'error', requestId: 'r7' });
      expect(store.state.notices[1]?.requestId).toBeUndefined();
    });
  });

  it('dismisses a notice by id', () => {
    withStore((store) => {
      store.apply({ type: 'notice', level: 'info', error: { code: 'A', message: 'one' } });
      store.apply({ type: 'notice', level: 'info', error: { code: 'B', message: 'two' } });
      const first = store.state.notices[0];
      if (first === undefined) throw new Error('no notice');
      store.dismissNotice(first.id);
      expect(store.state.notices.map((n) => n.error.message)).toEqual(['two']);
    });
  });

  it('clears the request and creates its notice in one step', () => {
    // Effects run when the root returns (lesson #906), so the writes go after it.
    const { store, seen, dispose } = createRoot((dispose) => {
      const store = createChatStore();
      store.begin('r1');
      const seen: Array<{ pending: number; notices: number }> = [];
      createEffect(() => {
        seen.push({ pending: store.state.pending.length, notices: store.state.notices.length });
      });
      return { store, seen, dispose };
    });
    store.apply({ type: 'request.result', requestId: 'r1', error: { code: 'X', message: 'y' } });
    dispose();
    expect(seen).toEqual([
      { pending: 1, notices: 0 },
      { pending: 0, notices: 1 },
    ]);
  });
});

// E4-session-management (issue #20). Fabricated messages: they prove the reducer, not the host.
describe('the session list (issue #20)', () => {
  const permission = (id: string, sessionID: string) => ({
    id,
    sessionID,
    action: 'read',
    resources: ['.env'],
    save: [],
  });
  const summary = (id: string, updatedAt: number, title?: string) => ({
    id,
    createdAt: 0,
    updatedAt,
    ...(title === undefined ? {} : { title }),
  });
  const page = (requestId: string, sessions: ReturnType<typeof summary>[], extra = {}) =>
    ({
      type: 'sessions.page',
      requestId,
      search: '',
      sessions,
      append: false,
      hasMore: false,
      ...extra,
    }) as const;

  it('shows loading until the page of the NEWEST query arrives, and ignores an older one', () => {
    withStore((store) => {
      store.beginQuery('q1', 'a');
      store.beginQuery('q2', 'ab');
      expect(store.state.browser).toMatchObject({ search: 'ab', loading: true, loaded: false });
      store.apply(page('q1', [summary('old', 1)]));
      expect(store.state.browser.rows).toEqual([]);
      expect(store.state.browser.loading).toBe(true);
      store.apply(page('q2', [summary('new', 2)], { hasMore: true }));
      expect(store.state.browser.rows.map((r) => r.id)).toEqual(['new']);
      expect(store.state.browser).toMatchObject({ loading: false, loaded: true, hasMore: true });
    });
  });

  it('a query and its result never touch `pending`, so Send stays usable', () => {
    withStore((store) => {
      store.beginQuery('q1', '');
      expect(store.state.pending).toEqual([]);
      store.apply({ type: 'request.result', requestId: 'q1' });
      expect(store.state.pending).toEqual([]);
    });
  });

  it('request.result closes loading when the query failed, and raises the error as a notice', () => {
    withStore((store) => {
      store.beginQuery('q1', '');
      store.apply({ type: 'request.result', requestId: 'q1', error: { code: 'X', message: 'no' } });
      expect(store.state.browser.loading).toBe(false);
      expect(store.state.notices.map((n) => n.error.code)).toEqual(['X']);
    });
  });

  it('appends a page without duplicating, keeping the identity of the rows that stay', () => {
    withStore((store) => {
      store.beginQuery('q1', '');
      store.apply(page('q1', [summary('a', 3), summary('b', 2)]));
      const before = store.state.browser.rows[0];
      store.beginQuery('q2', '');
      store.apply(page('q2', [summary('b', 2), summary('c', 1)], { append: true }));
      expect(store.state.browser.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
      expect(store.state.browser.rows[0]).toBe(before);
    });
  });

  it('events keep a LOADED list in step: a rename moves the row up, a delete removes it, a child never enters', () => {
    withStore((store) => {
      store.apply({ type: 'session.upserted', session: summary('early', 5, 'early') });
      expect(store.state.browser.rows).toEqual([]); // nobody asked for the list yet
      store.beginQuery('q1', '');
      store.apply(page('q1', [summary('a', 3), summary('b', 2)]));
      store.apply({ type: 'session.upserted', session: summary('b', 9, 'renamed') });
      expect(store.state.browser.rows.map((r) => r.id)).toEqual(['b', 'a']);
      expect(store.state.sessions['b']?.title).toBe('renamed');
      store.apply({
        type: 'session.upserted',
        session: { ...summary('kid', 10, 'sub'), parentID: 'a' },
      });
      expect(store.state.browser.rows.map((r) => r.id)).toEqual(['b', 'a']);
      store.apply({ type: 'session.removed', sessionID: 'a' });
      expect(store.state.browser.rows.map((r) => r.id)).toEqual(['b']);
      expect(store.state.sessions['a']).toBeUndefined();
    });
  });

  it('a rename or delete in flight locks its row until the result of THAT request', () => {
    withStore((store) => {
      store.beginSessionOp('a', 'renaming', 'r1');
      store.beginSessionOp('b', 'deleting', 'r2');
      expect(store.state.pending).toEqual([]);
      store.apply({ type: 'request.result', requestId: 'r1' });
      expect(store.state.sessionOps).toEqual({ b: { op: 'deleting', requestId: 'r2' } });
      // A declined delete answers success without removing anything: the row unlocks.
      store.apply({ type: 'request.result', requestId: 'r2' });
      expect(store.state.sessionOps).toEqual({});
    });
  });

  it('removing a session drops its in-flight op, its cards and their state, and the open view', () => {
    withStore((store) => {
      store.beginSessionOp(SES, 'deleting', 'r1');
      store.apply({ type: 'permission.asked', permission: permission('per_1', SES) });
      store.apply({ type: 'permission.asked', permission: permission('per_2', 'ses_other') });
      store.apply({
        type: 'form.asked',
        form: { id: 'frm_1', sessionID: SES, title: 'Q', kind: 'question', fields: [] },
      });
      store.beginReply('per_1', 'rep1');
      store.apply({
        type: 'ui.focus',
        target: { kind: 'permission', sessionID: SES, id: 'per_1' },
      });
      store.apply({ type: 'session.removed', sessionID: SES });
      expect(store.state.requests.permissions.map((p) => p.id)).toEqual(['per_2']);
      expect(store.state.requests.forms).toEqual([]);
      expect(store.state.replying).toEqual({});
      expect(store.state.sessionOps).toEqual({});
      expect(store.state.focusTarget).toBeUndefined();
      expect(store.state.open.sessionID).toBeUndefined();
    });
  });
});

// E5 / issues #23 and #24. FABRICATED catalog and snapshots. Protects: a catalog that merges with the
// old one instead of replacing it (a model that left would stay pickable); a draft that leaks into
// another session (the next prompt would switch THAT session to the model chosen for this one) or
// that a harmless snapshot of the same session wipes (the user's pick vanishing while typing).
describe('catalog and selection draft (issues #23/#24)', () => {
  const catalog = (ids: string[]) => ({
    models: ids.map((id) => ({
      providerID: 'opencode',
      id,
      name: id,
      status: 'active' as const,
      contextLimit: 1,
      free: true,
      variants: [],
    })),
    providers: [{ id: 'opencode', name: 'OpenCode' }],
    agents: [{ id: 'build', name: 'Build' }],
  });
  const GLM = { providerID: 'opencode', id: 'glm' };

  it('starts with no catalog and REPLACES it whole on every catalog message', () => {
    withStore((store) => {
      expect(store.state.catalog).toBeUndefined();
      store.apply({ type: 'catalog', catalog: catalog(['a', 'b']) });
      expect(store.state.catalog?.models.map((m) => m.id)).toEqual(['a', 'b']);
      store.apply({ type: 'catalog', catalog: catalog(['c']) });
      expect(store.state.catalog?.models.map((m) => m.id)).toEqual(['c']);
    });
  });

  it('picking records the draft against the open session and sends nothing', () => {
    withStore((store) => {
      store.selectModel(GLM);
      store.selectAgent('plan');
      expect(store.state.selection).toEqual({ sessionID: SES, model: GLM, agent: 'plan' });
    });
  });

  it('a snapshot of the SAME session keeps the draft; another session, or none, empties it', () => {
    withStore((store) => {
      store.selectModel(GLM);
      store.apply({ type: 'snapshot', snapshot: openSnapshot() });
      expect(store.state.selection.model).toEqual(GLM);

      store.apply({
        type: 'snapshot',
        snapshot: { ...openSnapshot(), open: { sessionID: 'ses_2', messages: [], parts: {} } },
      });
      expect(store.state.selection).toEqual({
        sessionID: 'ses_2',
        model: undefined,
        agent: undefined,
      });

      store.selectAgent('plan');
      store.apply({
        type: 'snapshot',
        snapshot: {
          sessions: [],
          statuses: {},
          requests: { permissions: [], forms: [] },
          resolutions: [],
        },
      });
      expect(store.state.selection.agent).toBeUndefined();
      expect(store.state.selection.sessionID).toBeUndefined();
    });
  });

  it('a draft made before the session exists is emptied when the first prompt opens it', () => {
    createRoot((dispose) => {
      const store = createChatStore();
      store.selectAgent('plan');
      expect(store.state.selection).toEqual({ sessionID: undefined, agent: 'plan' });
      store.apply({ type: 'snapshot', snapshot: openSnapshot() });
      expect(store.state.selection.agent).toBeUndefined();
      expect(store.state.selection.sessionID).toBe(SES);
      dispose();
    });
  });

  it('removing the open session empties the draft', () => {
    withStore((store) => {
      store.selectModel(GLM);
      store.apply({ type: 'session.removed', sessionID: SES });
      expect(store.state.selection.model).toBeUndefined();
    });
  });

  it('a restored draft survives only if the first snapshot opens the session it belonged to', () => {
    createRoot((dispose) => {
      const kept = createChatStore();
      kept.restoreSelection({ sessionID: SES, model: GLM, agent: 'plan' });
      kept.apply({ type: 'snapshot', snapshot: openSnapshot() });
      expect(kept.state.selection).toEqual({ sessionID: SES, model: GLM, agent: 'plan' });

      const dropped = createChatStore();
      dropped.restoreSelection({ sessionID: 'ses_old', model: GLM, agent: 'plan' });
      dropped.apply({ type: 'snapshot', snapshot: openSnapshot() });
      expect(dropped.state.selection.model).toBeUndefined();
      expect(dropped.state.selection.agent).toBeUndefined();
      dispose();
    });
  });

  it('a session.upserted with a new model updates the row the selectors read', () => {
    withStore((store) => {
      store.apply({
        type: 'session.upserted',
        session: { id: SES, createdAt: 1, updatedAt: 9, model: GLM, agent: 'plan' },
      });
      expect(store.state.sessions[SES]).toMatchObject({ model: GLM, agent: 'plan' });
    });
  });
});

// E7-file-context (#28). Protects: the popup shows only the answer to the LAST search (typing leaves
// older ones in flight), a search never touches `pending` (a keystroke must not disable Send),
// and the results are plain copies (a store Proxy would throw DataCloneError in `postMessage`).
describe('file search (issue #28)', () => {
  const found = (requestId: string, query: string, names: string[]) =>
    ({
      type: 'files.found' as const,
      requestId,
      query,
      files: names.map((name) => ({ uri: `file:///ws/${name}`, name })),
    }) satisfies Parameters<ChatStore['apply']>[0];

  it('accepts only the answer to the newest request', () => {
    withStore((store) => {
      store.beginFileSearch('f1', 'a');
      store.beginFileSearch('f2', 'ab');
      store.apply(found('f1', 'a', ['old.ts']));
      expect(store.state.fileSearch.files).toEqual([]);
      expect(store.state.fileSearch.loading).toBe(true);
      store.apply(found('f2', 'ab', ['new.ts']));
      expect(store.state.fileSearch).toMatchObject({
        query: 'ab',
        loading: false,
        files: [{ name: 'new.ts' }],
      });
    });
  });

  it('never touches pending and keeps the previous results while a newer search runs', () => {
    withStore((store) => {
      store.beginFileSearch('f1', 'a');
      store.apply(found('f1', 'a', ['a.ts']));
      store.beginFileSearch('f2', 'ab');
      expect(store.state.pending).toEqual([]);
      expect(store.state.fileSearch.files).toHaveLength(1);
      expect(store.state.fileSearch).toMatchObject({ query: 'ab', loading: true });
    });
  });

  it('keeps the error of a failed search and clears it on the next one', () => {
    withStore((store) => {
      store.beginFileSearch('f1', 'a');
      store.apply({
        type: 'files.found',
        requestId: 'f1',
        query: 'a',
        files: [],
        error: { code: 'ServerUnavailable', message: 'down' },
      });
      expect(store.state.fileSearch.error).toEqual({ code: 'ServerUnavailable', message: 'down' });
      store.beginFileSearch('f2', 'ab');
      expect(store.state.fileSearch.error).toBeUndefined();
    });
  });

  it('ignores every answer after the search was cleared', () => {
    withStore((store) => {
      store.beginFileSearch('f1', 'a');
      store.clearFileSearch();
      store.apply(found('f1', 'a', ['late.ts']));
      expect(store.state.fileSearch).toEqual({
        requestId: undefined,
        query: '',
        files: [],
        loading: false,
        error: undefined,
      });
    });
  });

  it('stores structured-cloneable copies of the results', () => {
    withStore((store) => {
      store.beginFileSearch('f1', 'a');
      const message = found('f1', 'a', ['a.ts']);
      store.apply(message);
      const stored = store.state.fileSearch.files[0];
      expect(stored).toBeDefined();
      expect(stored).not.toBe(message.files[0]);
      const plain = { uri: stored?.uri, name: stored?.name };
      expect(() => structuredClone(plain)).not.toThrow();
    });
  });
});

// E7-session-diff (issue #31): the "Changed files" list. Protects: only the open session's list is
// kept (the host may finish a load for a session the user just left), the list belongs to ONE
// session (a snapshot that opens another one, a removal or a stopped server empties it), and a
// row keeps its object while its counts change (`<For>` would rebuild its DOM otherwise).
// Provenance: messages FABRICATED by hand in the shape of the protocol.
describe('changed files (issue #31)', () => {
  const file = (path: string, additions = 1) => ({
    path,
    status: 'modified' as const,
    additions,
    deletions: 0,
    binary: false,
    tooLarge: false,
  });
  const list = (sessionID: string, files: ReturnType<typeof file>[]) => ({
    type: 'session.diff' as const,
    sessionID,
    files,
  });

  it('keeps the list of the open session', () => {
    withStore((store) => {
      store.apply(list(SES, [file('src/a.ts'), file('src/b.ts')]));
      expect(store.state.diff.sessionID).toBe(SES);
      expect(store.state.diff.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
      expect(store.state.diff.error).toBeUndefined();
    });
  });

  it('drops a list for a session that is not the open one', () => {
    withStore((store) => {
      store.apply(list('ses_other', [file('src/a.ts')]));
      expect(store.state.diff).toEqual({ sessionID: undefined, files: [], error: undefined });
    });
  });

  it('replaces the whole list, and keeps the row object of a path whose counts changed', () => {
    withStore((store) => {
      store.apply(list(SES, [file('src/a.ts'), file('src/b.ts')]));
      const before = store.state.diff.files[0];
      store.apply(list(SES, [file('src/a.ts', 9)]));
      expect(store.state.diff.files).toHaveLength(1);
      expect(store.state.diff.files[0]).toBe(before);
      expect(store.state.diff.files[0]?.additions).toBe(9);
    });
  });

  it('shows an empty list as empty, and keeps the last rows with an error', () => {
    withStore((store) => {
      store.apply(list(SES, [file('src/a.ts')]));
      store.apply({
        ...list(SES, [file('src/a.ts')]),
        error: { code: 'Boom', message: 'it broke' },
      });
      expect(store.state.diff.error).toEqual({ code: 'Boom', message: 'it broke' });
      store.apply(list(SES, []));
      expect(store.state.diff.files).toEqual([]);
      expect(store.state.diff.error).toBeUndefined();
    });
  });

  it('keeps the list across a snapshot of the same open session', () => {
    withStore((store) => {
      store.apply(list(SES, [file('src/a.ts')]));
      store.apply({ type: 'snapshot', snapshot: openSnapshot() });
      expect(store.state.diff.files.map((f) => f.path)).toEqual(['src/a.ts']);
    });
  });

  it('empties the list when a snapshot opens another session or none', () => {
    withStore((store) => {
      store.apply(list(SES, [file('src/a.ts')]));
      store.apply({
        type: 'snapshot',
        snapshot: { ...openSnapshot(), open: { sessionID: 'ses_2', messages: [], parts: {} } },
      });
      expect(store.state.diff).toEqual({ sessionID: undefined, files: [], error: undefined });
      store.apply(list('ses_2', [file('src/b.ts')]));
      const { open: _none, ...withoutOpen } = openSnapshot();
      store.apply({ type: 'snapshot', snapshot: withoutOpen });
      expect(store.state.diff.files).toEqual([]);
    });
  });

  it('does not mix the rows of two sessions that share a path', () => {
    withStore((store) => {
      store.apply(list(SES, [file('src/a.ts', 3)]));
      const before = store.state.diff.files[0];
      store.apply({
        type: 'snapshot',
        snapshot: { ...openSnapshot(), open: { sessionID: 'ses_2', messages: [], parts: {} } },
      });
      store.apply(list('ses_2', [file('src/a.ts', 8)]));
      expect(store.state.diff.sessionID).toBe('ses_2');
      expect(store.state.diff.files[0]?.additions).toBe(8);
      expect(store.state.diff.files[0]).not.toBe(before);
    });
  });

  it('empties the list when the open session is removed', () => {
    withStore((store) => {
      store.apply(list(SES, [file('src/a.ts')]));
      store.apply({ type: 'session.removed', sessionID: SES });
      expect(store.state.diff.files).toEqual([]);
    });
  });

  it('keeps it when ANOTHER session is removed', () => {
    withStore((store) => {
      store.apply(list(SES, [file('src/a.ts')]));
      store.apply({ type: 'session.removed', sessionID: 'ses_other' });
      expect(store.state.diff.files).toHaveLength(1);
    });
  });

  it('empties the list when the server is starting, unavailable or stopped', () => {
    for (const connection of [
      { state: 'starting' },
      { state: 'stopped' },
      {
        state: 'unavailable',
        reason: 'exited',
        error: { code: 'exited', message: 'gone' },
      },
    ] as const) {
      withStore((store) => {
        store.apply(list(SES, [file('src/a.ts')]));
        store.apply({ type: 'connection.state', connection });
        expect(store.state.diff.files, connection.state).toEqual([]);
      });
    }
  });

  it('keeps it while reconnecting (the same server is still there)', () => {
    withStore((store) => {
      store.apply(list(SES, [file('src/a.ts')]));
      store.apply({ type: 'connection.state', connection: { state: 'reconnecting', attempt: 1 } });
      expect(store.state.diff.files).toHaveLength(1);
    });
  });
});

// Issue #32: the prepared revert of the open session lives in `open.revert`. It comes with the
// snapshot (so hiding is atomic with the messages) or as `session.revert`, which REPLACES it and
// only counts for the open session; a snapshot without it clears it. The store never deletes the
// reverted messages (Restore is instant). Provenance: messages FABRICATED by hand in the shape of
// the protocol.
describe('prepared revert (issue #32)', () => {
  const file = (path: string, additions = 1) => ({
    path,
    status: 'modified' as const,
    additions,
    deletions: 0,
    binary: false,
    tooLarge: false,
  });
  const revert = (messageID: string, ...files: ReturnType<typeof file>[]) => ({
    type: 'session.revert' as const,
    sessionID: SES,
    revert: { messageID, files },
  });

  it('keeps the revert of the open session, and clears it on an absent one', () => {
    withStore((store) => {
      store.apply({ type: 'snapshot', snapshot: openSnapshot() });
      store.apply(revert('m3', file('src/a.ts')));
      expect(store.state.open.revert?.messageID).toBe('m3');
      expect(store.state.open.revert?.files.map((f) => f.path)).toEqual(['src/a.ts']);
      store.apply({ type: 'session.revert', sessionID: SES });
      expect(store.state.open.revert).toBeUndefined();
    });
  });

  it('ignores the revert of a session that is not the open one', () => {
    withStore((store) => {
      store.apply({ type: 'snapshot', snapshot: openSnapshot() });
      store.apply({ ...revert('m3'), sessionID: 'ses_other' });
      expect(store.state.open.revert).toBeUndefined();
    });
  });

  it('takes the revert from the snapshot, and a snapshot without one clears it', () => {
    withStore((store) => {
      const open = openSnapshot().open;
      store.apply({
        type: 'snapshot',
        snapshot: {
          ...openSnapshot(),
          open: { ...open, sessionID: SES, revert: { messageID: 'm3', files: [] } },
        },
      });
      expect(store.state.open.revert).toEqual({ messageID: 'm3', files: [] });
      store.apply({ type: 'snapshot', snapshot: openSnapshot() });
      expect(store.state.open.revert).toBeUndefined();
    });
  });

  it('keeps the rows that did not change when the same boundary is reported again', () => {
    withStore((store) => {
      store.apply({ type: 'snapshot', snapshot: openSnapshot() });
      store.apply(revert('m3', file('src/a.ts', 1)));
      const before = store.state.open.revert?.files[0];
      store.apply(revert('m3', file('src/a.ts', 5)));
      expect(store.state.open.revert?.files[0]).toBe(before);
      expect(store.state.open.revert?.files[0]?.additions).toBe(5);
      // Another boundary replaces the whole state.
      store.apply(revert('m1', file('src/a.ts', 7)));
      expect(store.state.open.revert?.messageID).toBe('m1');
      expect(store.state.open.revert?.files[0]).not.toBe(before);
    });
  });

  it('forgets it when another session opens or the open one is removed', () => {
    withStore((store) => {
      store.apply({ type: 'snapshot', snapshot: openSnapshot() });
      store.apply(revert('m3'));
      store.apply({
        type: 'snapshot',
        snapshot: { ...openSnapshot(), open: { sessionID: 'ses_2', messages: [], parts: {} } },
      });
      expect(store.state.open.revert).toBeUndefined();
      store.apply({ type: 'snapshot', snapshot: openSnapshot() });
      store.apply(revert('m3'));
      store.apply({ type: 'session.removed', sessionID: SES });
      expect(store.state.open.revert).toBeUndefined();
    });
  });
});
