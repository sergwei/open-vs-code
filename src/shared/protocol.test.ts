/**
 * Unit tests for the host <-> webview protocol guards and helpers (issue #3).
 *
 * Protects against: a guard that silently accepts a malformed webview message (the webview is
 * untrusted input), a union member added without its validator or sample, `dispatch` calling
 * the wrong handler, and positional part ids drifting between snapshot and stream.
 *
 * ALL DATA HERE IS FABRICATED by hand from the types. These tests prove the logic of the
 * guards; they do NOT prove that opencode emits these shapes (that needs a real `opencode
 * serve`, issues #8/#9) nor that VS Code delivers them unchanged (issue #2, F5).
 * Run with `npx vitest run src/shared` (no vitest config or `test` script until issue #4).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  contentPartId,
  dispatch,
  HOST_TO_WEBVIEW_TYPES,
  isHostToWebview,
  isWebviewToHost,
  WEBVIEW_TO_HOST_TYPES,
  type Handlers,
  type HostToWebview,
  type WebviewToHost,
} from './protocol';

type SamplesOf<M extends { type: string }> = { [K in M['type']]: Extract<M, { type: K }> };

const error = { code: 'Boom', message: 'it broke' };
const model = { providerID: 'p', id: 'm' };
const session = { id: 's1', createdAt: 1, updatedAt: 2 };
const permission = { id: 'perm1', sessionID: 's1', action: 'bash', resources: ['ls'], save: [] };
const form = {
  id: 'f1',
  sessionID: 's1',
  title: 'Pick',
  kind: 'question' as const,
  fields: [{ key: 'q0', type: 'string' as const }],
};

/** One valid sample per host-to-webview type; a missing key is a compile error. */
const HOST_SAMPLES: SamplesOf<HostToWebview> = {
  'connection.state': {
    type: 'connection.state',
    connection: { state: 'connected', serverVersion: '2.0.32' },
  },
  snapshot: {
    type: 'snapshot',
    snapshot: {
      sessions: [session],
      statuses: { s1: { type: 'idle' } },
      open: {
        sessionID: 's1',
        messages: [{ kind: 'user', id: 'm1', createdAt: 1, text: 'hi', files: [] }],
        parts: { m1: [{ type: 'text', id: contentPartId('m1', 0), text: 'hi' }] },
        permissions: [permission],
        forms: [form],
      },
    },
  },
  'session.upserted': { type: 'session.upserted', session },
  'session.removed': { type: 'session.removed', sessionID: 's1' },
  'session.status': {
    type: 'session.status',
    sessionID: 's1',
    status: { type: 'retry', attempt: 1, message: 'x', nextAt: 5 },
  },
  'message.upserted': {
    type: 'message.upserted',
    sessionID: 's1',
    message: { kind: 'assistant', id: 'm2', createdAt: 1, agent: 'build', model, error },
  },
  'message.removed': { type: 'message.removed', sessionID: 's1', messageID: 'm2' },
  'part.upserted': {
    type: 'part.upserted',
    sessionID: 's1',
    messageID: 'm2',
    part: {
      type: 'tool',
      id: 't1',
      name: 'bash',
      state: { status: 'running', input: { cmd: 'ls' } },
    },
  },
  'part.delta': {
    type: 'part.delta',
    sessionID: 's1',
    messageID: 'm2',
    partID: 'm2#0',
    field: 'text',
    delta: 'he',
  },
  'permission.asked': { type: 'permission.asked', permission },
  'permission.resolved': {
    type: 'permission.resolved',
    sessionID: 's1',
    permissionID: 'perm1',
    decision: 'once',
  },
  'form.asked': { type: 'form.asked', form },
  'form.resolved': { type: 'form.resolved', sessionID: 's1', formID: 'f1', outcome: 'answered' },
  'request.result': { type: 'request.result', requestId: 'r1' },
  'attachments.picked': {
    type: 'attachments.picked',
    requestId: 'r1',
    files: [{ uri: 'file:///a.ts', name: 'a.ts' }],
  },
  'ui.focus': { type: 'ui.focus', target: { kind: 'permission', sessionID: 's1', id: 'perm1' } },
  notice: { type: 'notice', level: 'warning', error },
};

/** One valid sample per webview-to-host type; a missing key is a compile error. */
const WEBVIEW_SAMPLES: SamplesOf<WebviewToHost> = {
  ready: { type: 'ready' },
  'session.new': { type: 'session.new', requestId: 'r1' },
  'session.open': { type: 'session.open', requestId: 'r1', sessionID: 's1' },
  'prompt.send': {
    type: 'prompt.send',
    requestId: 'r1',
    sessionID: 's1',
    text: 'hello',
    delivery: 'queue',
    files: [{ uri: 'file:///a.ts', name: 'a.ts' }],
  },
  'session.abort': { type: 'session.abort', requestId: 'r1', sessionID: 's1' },
  'permission.reply': {
    type: 'permission.reply',
    requestId: 'r1',
    sessionID: 's1',
    permissionID: 'perm1',
    decision: 'reject',
    message: 'no',
  },
  'form.reply': {
    type: 'form.reply',
    requestId: 'r1',
    sessionID: 's1',
    formID: 'f1',
    answer: { q0: 'A', q1: ['a', 'b'], q2: true, q3: 3 },
  },
  'form.cancel': { type: 'form.cancel', requestId: 'r1', sessionID: 's1', formID: 'f1' },
  'attachments.pick': { type: 'attachments.pick', requestId: 'r1' },
  'permissions.manage': { type: 'permissions.manage' },
  'editor.open': { type: 'editor.open', path: 'src/a.ts', line: 3, column: 1 },
  'editor.insert': { type: 'editor.insert', text: 'x' },
  'editor.newFile': { type: 'editor.newFile', text: 'x', language: 'ts' },
  'clipboard.write': { type: 'clipboard.write', text: 'x' },
  'webview.log': { type: 'webview.log', level: 'warn', message: 'm' },
};

describe('sample coverage', () => {
  it('lists the type constants exactly as the samples, without duplicates', () => {
    expect([...HOST_TO_WEBVIEW_TYPES].sort()).toEqual(Object.keys(HOST_SAMPLES).sort());
    expect([...WEBVIEW_TO_HOST_TYPES].sort()).toEqual(Object.keys(WEBVIEW_SAMPLES).sort());
    expect(new Set(HOST_TO_WEBVIEW_TYPES).size).toBe(HOST_TO_WEBVIEW_TYPES.length);
    expect(new Set(WEBVIEW_TO_HOST_TYPES).size).toBe(WEBVIEW_TO_HOST_TYPES.length);
  });

  it('survives a JSON round trip unchanged (what postMessage does)', () => {
    for (const sample of [...Object.values(HOST_SAMPLES), ...Object.values(WEBVIEW_SAMPLES)]) {
      expect(JSON.parse(JSON.stringify(sample))).toEqual(sample);
    }
  });
});

describe('isWebviewToHost', () => {
  it('accepts every valid sample', () => {
    for (const sample of Object.values(WEBVIEW_SAMPLES)) {
      expect(isWebviewToHost(sample), sample.type).toBe(true);
    }
  });

  it('accepts prompt.send without sessionID (the host creates the session)', () => {
    expect(
      isWebviewToHost({
        type: 'prompt.send',
        requestId: 'r',
        text: 'x',
        delivery: 'steer',
        files: [],
      }),
    ).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['string', 'ready'],
    ['JSON string', '{"type":"ready"}'],
    ['number', 7],
    ['array', [{ type: 'ready' }]],
    ['no type', {}],
    ['unknown type', { type: 'nope' }],
    ['non-string type', { type: 3 }],
    ['inherited key as type', { type: 'toString' }],
    ['prototype key as type', { type: '__proto__' }],
  ])('rejects a non-message: %s', (_name, value) => {
    expect(isWebviewToHost(value)).toBe(false);
  });

  it('rejects each message with a required field removed, and accepts it without the optional ones', () => {
    // Optional keys PER TYPE: a global set would hide a required `sessionID` (session.open, ...).
    const optionalByType: { [type: string]: string[] } = {
      'prompt.send': ['sessionID'],
      'permission.reply': ['message'],
      'form.cancel': ['message'],
      'editor.open': ['line', 'column'],
      'editor.newFile': ['language'],
    };
    for (const sample of Object.values(WEBVIEW_SAMPLES)) {
      const optional = optionalByType[sample.type] ?? [];
      for (const key of Object.keys(sample)) {
        if (key === 'type') continue;
        const { [key]: _removed, ...rest } = sample as Record<string, unknown>;
        expect(isWebviewToHost(rest), `${sample.type} without ${key}`).toBe(optional.includes(key));
      }
    }
    // Explicit cases for the ones the review found untested.
    for (const type of [
      'session.open',
      'session.abort',
      'permission.reply',
      'form.reply',
      'form.cancel',
    ] as const) {
      const { sessionID: _removed, ...rest } = WEBVIEW_SAMPLES[type];
      expect(isWebviewToHost(rest), `${type} without sessionID`).toBe(false);
    }
  });

  it('rejects an empty prompt but accepts text or files alone, and an empty clipboard write', () => {
    const base = WEBVIEW_SAMPLES['prompt.send'];
    const file = { uri: 'file:///a.ts', name: 'a.ts' };
    expect(isWebviewToHost({ ...base, text: '', files: [] })).toBe(false);
    expect(isWebviewToHost({ ...base, text: '  \n\t ', files: [] })).toBe(false);
    expect(isWebviewToHost({ ...base, text: '', files: [file] })).toBe(true);
    expect(isWebviewToHost({ ...base, text: 'hi', files: [] })).toBe(true);
    expect(
      isWebviewToHost({ ...base, text: 'hi', files: [{ uri: 'file:///a.ts', name: '' }] }),
    ).toBe(false);
    expect(isWebviewToHost({ type: 'clipboard.write', text: '' })).toBe(true);
  });

  it('bounds editor.open line and column to safe integers >= 1', () => {
    const base = WEBVIEW_SAMPLES['editor.open'];
    for (const bad of [
      1e308,
      2 ** 60,
      Number.MAX_SAFE_INTEGER + 1,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ]) {
      expect(isWebviewToHost({ ...base, line: bad }), `line ${bad}`).toBe(false);
      expect(isWebviewToHost({ ...base, column: bad }), `column ${bad}`).toBe(false);
    }
    expect(isWebviewToHost({ ...base, line: Number.MAX_SAFE_INTEGER, column: 1 })).toBe(true);
  });

  it('only trusts plain objects and own properties', () => {
    const reply = WEBVIEW_SAMPLES['session.open'];
    // Everything read through the prototype chain must be ignored.
    expect(isWebviewToHost(Object.create({ type: 'ready' }))).toBe(false);
    expect(isWebviewToHost(Object.create(reply))).toBe(false);
    const { requestId: _removed, ...withoutRequestId } = reply;
    expect(
      isWebviewToHost(Object.assign(Object.create({ requestId: 'r1' }), withoutRequestId)),
    ).toBe(false);
    expect(isWebviewToHost(Object.assign(Object.create(null), reply))).toBe(true);
    class Message {
      type = 'ready';
    }
    expect(isWebviewToHost(new Message())).toBe(false);
  });

  it('rejects sparse arrays and non-plain objects inside a message', () => {
    const send = WEBVIEW_SAMPLES['prompt.send'];
    /* eslint-disable no-sparse-arrays -- the holes are the point of these three cases */
    expect(isWebviewToHost({ ...send, text: '', files: [,] })).toBe(false);
    expect(
      isWebviewToHost({
        ...send,
        files: [{ uri: 'file:///a', name: 'a' }, , { uri: 'file:///b', name: 'b' }],
      }),
    ).toBe(false);
    expect(
      isWebviewToHost({ ...WEBVIEW_SAMPLES['form.reply'], answer: { q0: ['a', , 'b'] } }),
    ).toBe(false);
    /* eslint-enable no-sparse-arrays */
    expect(isWebviewToHost({ ...WEBVIEW_SAMPLES['form.reply'], answer: new Date() })).toBe(false);
    expect(
      isWebviewToHost({ ...WEBVIEW_SAMPLES['form.reply'], answer: new Map([['q0', 'a']]) }),
    ).toBe(false);
    expect(isWebviewToHost({ ...WEBVIEW_SAMPLES['form.reply'], answer: { q0: new Date() } })).toBe(
      false,
    );
  });

  it('returns false, not an exception, when a getter throws', () => {
    const hostile = {
      type: 'session.open',
      requestId: 'r1',
      get sessionID(): string {
        throw new Error('boom');
      },
    };
    expect(isWebviewToHost(hostile)).toBe(false);
    const hostileType = {
      get type(): string {
        throw new Error('boom');
      },
    };
    expect(isWebviewToHost(hostileType)).toBe(false);
  });

  it('rejects wrong field types, bad enums and bad lists', () => {
    const base = WEBVIEW_SAMPLES['prompt.send'];
    const reply = WEBVIEW_SAMPLES['permission.reply'];
    const cases: unknown[] = [
      { ...base, text: 5 },
      { ...base, delivery: 'later' },
      { ...base, requestId: '' },
      { ...base, sessionID: '' },
      { ...base, files: [{ uri: 'file:///a' }] },
      { ...base, files: [{ uri: '', name: 'a' }] },
      { ...base, files: 'none' },
      { ...reply, decision: 'maybe' },
      { ...reply, message: 3 },
      { ...WEBVIEW_SAMPLES['webview.log'], level: 'debug' },
      { ...WEBVIEW_SAMPLES['editor.open'], line: -1 },
      { ...WEBVIEW_SAMPLES['editor.open'], line: 0 },
      { ...WEBVIEW_SAMPLES['editor.open'], line: 1.5 },
      { ...WEBVIEW_SAMPLES['editor.open'], column: '2' },
      { ...WEBVIEW_SAMPLES['editor.open'], path: '' },
      { ...WEBVIEW_SAMPLES['form.reply'], answer: { q0: { nested: 'x' } } },
      { ...WEBVIEW_SAMPLES['form.reply'], answer: { q0: [1, 2] } },
      { ...WEBVIEW_SAMPLES['form.reply'], answer: { q0: Number.NaN } },
      { ...WEBVIEW_SAMPLES['form.reply'], answer: ['a'] },
      { ...WEBVIEW_SAMPLES['form.reply'], answer: null },
    ];
    for (const value of cases) {
      expect(isWebviewToHost(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('isHostToWebview', () => {
  it('accepts every valid sample', () => {
    for (const sample of Object.values(HOST_SAMPLES)) {
      expect(isHostToWebview(sample), sample.type).toBe(true);
    }
  });

  it.each([
    ['null', null],
    ['string', 'snapshot'],
    ['array', []],
    ['no type', {}],
    ['unknown type', { type: 'nope' }],
    ['inherited key as type', { type: 'constructor' }],
  ])('rejects: %s', (_name, value) => {
    expect(isHostToWebview(value)).toBe(false);
  });

  it('is deliberately shallow: accepts a part.delta without delta', () => {
    // Documents the trade-off recorded in the guard header; change it only as a decision.
    expect(isHostToWebview({ type: 'part.delta' })).toBe(true);
  });
});

describe('dispatch', () => {
  it('calls only the handler of the message type, with that message', () => {
    const handlers = Object.fromEntries(
      HOST_TO_WEBVIEW_TYPES.map((type) => [type, vi.fn()]),
    ) as unknown as Handlers<HostToWebview>;
    const message = HOST_SAMPLES['session.removed'];

    dispatch(message, handlers);

    const removed = handlers['session.removed'] as unknown as ReturnType<typeof vi.fn>;
    expect(removed).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith(message);
    for (const type of HOST_TO_WEBVIEW_TYPES) {
      if (type === 'session.removed') continue;
      expect(handlers[type] as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    }
  });

  it('rejects incomplete handlers at compile time (checked by tsc, not by vitest)', () => {
    // @ts-expect-error -- a Handlers object missing every other type must not type-check
    const incomplete: Handlers<WebviewToHost> = { ready: () => undefined };
    expect(typeof incomplete.ready).toBe('function');
  });
});

describe('contentPartId', () => {
  it('is deterministic and differs by index and by message', () => {
    expect(contentPartId('m1', 0)).toBe(contentPartId('m1', 0));
    expect(contentPartId('m1', 0)).not.toBe(contentPartId('m1', 1));
    expect(contentPartId('m1', 0)).not.toBe(contentPartId('m2', 0));
    expect(contentPartId('m1', 2)).toBe('m1#2');
  });

  // The real invariant (REST snapshot index == stream counter) needs the host adapter, which
  // does not exist yet; its test belongs to issue #14. A test over contentPartId alone would
  // compare the function with itself and could not fail, so there is none here.
});
