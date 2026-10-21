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
