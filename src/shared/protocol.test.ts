/**
 * Unit tests for the host <-> webview protocol guards and helpers (issue #3).
 *
 * Protects against: a guard that silently accepts a malformed webview message (the webview is
 * untrusted input), a union member added without its validator or sample, `dispatch` calling
 * the wrong handler, and positional part ids drifting between snapshot and stream.
 *
 * E3-resolved-history (#56/#18): the samples also carry `Snapshot.resolutions` and the optional
 * `resolution` of `*.resolved`; `isHostToWebview` is shallow, so they only need to stay accepted.
 *
 * E4-session-management (#20): samples and bounds for `sessions.query`, `session.rename`,
 * `session.delete` and `sessions.page`.
 *
 * E7-session-diff (#31): samples for `session.diff` and `session.diff.open`, and the bounds of the
 * path the webview may name (non-empty, no NUL, at most `MAX_DIFF_PATH_LENGTH`); whether the host
 * lists that path is the handler's check, tested in `chatController.test.ts`.
 *
 * ALL DATA HERE IS FABRICATED by hand from the types. These tests prove the logic of the
 * guards; they do NOT prove that opencode emits these shapes (that needs a real `opencode
 * serve`, issues #8/#9) nor that VS Code delivers them unchanged (issue #2, F5).
 * Run with `npx vitest run src/shared` (no vitest config or `test` script until issue #4).
 */
import { describe, expect, it, vi } from 'vitest';
import type { RequestResolution } from './model';
import {
  contentPartId,
  dispatch,
  HOST_TO_WEBVIEW_TYPES,
  isHostToWebview,
  isWebviewToHost,
  MAX_DIFF_PATH_LENGTH,
  MAX_DROPPED_ITEMS,
  MAX_DROPPED_URI_LENGTH,
  MAX_COMMAND_NAME_LENGTH,
  MAX_FILE_SEARCH_LENGTH,
  MAX_IMAGE_BASE64_LENGTH,
  MAX_SESSION_SEARCH_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
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

const permissionResolution: RequestResolution = {
  kind: 'permission',
  id: 'perm1',
  sessionID: 's1',
  tool: { messageID: 'm2', partID: 'call_1' },
  at: 1_700_000_000_000,
  decision: 'once',
  action: 'bash',
  resource: 'ls',
  withFeedback: false,
};
const formResolution: RequestResolution = {
  kind: 'form',
  id: 'f1',
  sessionID: 's1',
  at: 1_700_000_000_500,
  outcome: 'answered',
  formKind: 'question',
  title: 'Pick',
  withMessage: false,
};

/** One valid sample per host-to-webview type; a missing key is a compile error. */
const HOST_SAMPLES: SamplesOf<HostToWebview> = {
  'connection.state': {
    type: 'connection.state',
    connection: { state: 'connected', serverVersion: '2.0.32' },
  },
  catalog: {
    type: 'catalog',
    catalog: {
      models: [
        {
          providerID: 'p',
          id: 'm',
          name: 'M',
          status: 'active',
          contextLimit: 200_000,
          free: true,
          variants: [],
          images: true,
        },
      ],
      providers: [{ id: 'p', name: 'P' }],
      agents: [{ id: 'build', name: 'Build' }],
      serverDefault: model,
      defaultAgent: 'build',
      preferredModel: model,
    },
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
      },
      // Phase 3: pending requests are per location, not per open session.
      requests: { permissions: [permission], forms: [form] },
      // E3-resolved-history: the host's records of the open session's answered requests.
      resolutions: [permissionResolution, formResolution],
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
    resolution: permissionResolution,
  },
  'form.asked': { type: 'form.asked', form },
  'form.resolved': {
    type: 'form.resolved',
    sessionID: 's1',
    formID: 'f1',
    outcome: 'answered',
    resolution: formResolution,
  },
  'request.result': { type: 'request.result', requestId: 'r1' },
  'sessions.page': {
    type: 'sessions.page',
    requestId: 'r1',
    search: 'beta',
    sessions: [session],
    append: false,
    hasMore: true,
  },
  'attachments.picked': {
    type: 'attachments.picked',
    requestId: 'r1',
    files: [{ uri: 'file:///a.ts', name: 'a.ts' }],
  },
  'files.found': {
    type: 'files.found',
    requestId: 'r1',
    query: 'a',
    files: [{ uri: 'file:///ws/src/a.ts', name: 'src/a.ts' }],
  },
  'ui.focus': { type: 'ui.focus', target: { kind: 'permission', sessionID: 's1', id: 'perm1' } },
  'ui.command': { type: 'ui.command', command: 'session.stop' },
  'session.diff': {
    type: 'session.diff',
    sessionID: 's1',
    files: [
      {
        path: 'src/a.ts',
        status: 'modified',
        additions: 2,
        deletions: 1,
        binary: false,
        tooLarge: false,
      },
    ],
  },
  'session.revert': {
    type: 'session.revert',
    sessionID: 's1',
    revert: {
      messageID: 'msg_1',
      files: [
        {
          path: 'src/a.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
          binary: false,
          tooLarge: false,
        },
      ],
    },
  },
  notice: { type: 'notice', level: 'warning', error },
  'setup.binary': { type: 'setup.binary', outcome: 'chosen', path: '/opt/opencode' },
};

/** One valid sample per webview-to-host type; a missing key is a compile error. */
const WEBVIEW_SAMPLES: SamplesOf<WebviewToHost> = {
  ready: { type: 'ready' },
  'session.new': { type: 'session.new', requestId: 'r1' },
  'session.open': { type: 'session.open', requestId: 'r1', sessionID: 's1' },
  'sessions.query': { type: 'sessions.query', requestId: 'r1', search: 'beta', more: false },
  'session.rename': {
    type: 'session.rename',
    requestId: 'r1',
    sessionID: 's1',
    title: 'A new title',
  },
  'session.delete': { type: 'session.delete', requestId: 'r1', sessionID: 's1' },
  'session.fork': { type: 'session.fork', requestId: 'r1', sessionID: 's1', messageID: 'm1' },
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
  'attachments.fromEditor': { type: 'attachments.fromEditor', requestId: 'r1' },
  'attachments.drop': { type: 'attachments.drop', requestId: 'r1', uris: ['file:///c%3A/ws/a.ts'] },
  'attachments.image': {
    type: 'attachments.image',
    requestId: 'r1',
    mime: 'image/png',
    data: 'AA==',
  },
  'attachments.forget': { type: 'attachments.forget', uri: 'pasted-image:1' },
  'files.search': { type: 'files.search', requestId: 'r1', query: 'prompt' },
  'permissions.manage': { type: 'permissions.manage' },
  'server.restart': { type: 'server.restart' },
  'logs.show': { type: 'logs.show' },
  'setup.action': { type: 'setup.action', action: 'binary.choose' },
  'editor.open': { type: 'editor.open', path: 'src/a.ts', line: 3, column: 1 },
  'session.diff.open': { type: 'session.diff.open', sessionID: 's1', path: 'src/a.ts' },
  'session.revert.stage': {
    type: 'session.revert.stage',
    requestId: 'r1',
    sessionID: 's1',
    messageID: 'msg_1',
  },
  'session.revert.clear': { type: 'session.revert.clear', requestId: 'r1', sessionID: 's1' },
  'session.revert.commit': { type: 'session.revert.commit', requestId: 'r1', sessionID: 's1' },
  'session.revert.open': { type: 'session.revert.open', sessionID: 's1', path: 'src/a.ts' },
  'editor.insert': { type: 'editor.insert', text: 'x' },
  'editor.newFile': { type: 'editor.newFile', text: 'x', language: 'ts' },
  'clipboard.write': { type: 'clipboard.write', text: 'x' },
  'webview.log': { type: 'webview.log', level: 'warn', message: 'm' },
  'chat.focusChanged': { type: 'chat.focusChanged', focused: true },
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

  // E2 (issue #85, decisions P4/P11/P14/P15). Fabricated messages: they pin the guard, not how the
  // host reacts to each action.
  it('accepts each setup.action of the closed list and rejects anything else', () => {
    for (const action of [
      'binary.choose',
      'binary.settings',
      'server.settings',
      'server.password',
      'install.guide',
      'folder.open',
    ]) {
      expect(isWebviewToHost({ type: 'setup.action', action }), action).toBe(true);
    }
    for (const action of ['rm -rf', '', 'toString', 'binary.choose ', 7, undefined, null]) {
      expect(isWebviewToHost({ type: 'setup.action', action }), String(action)).toBe(false);
    }
    expect(isWebviewToHost({ type: 'setup.action' })).toBe(false);
  });

  it('accepts attachments.pick with no kind, file or image, and rejects another kind', () => {
    const pick = { type: 'attachments.pick', requestId: 'r1' };
    expect(isWebviewToHost(pick)).toBe(true);
    expect(isWebviewToHost({ ...pick, kind: 'file' })).toBe(true);
    expect(isWebviewToHost({ ...pick, kind: 'image' })).toBe(true);
    expect(isWebviewToHost({ ...pick, kind: 'folder' })).toBe(false);
    expect(isWebviewToHost({ ...pick, kind: 1 })).toBe(false);
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

  // Issues #23/#24. Fabricated messages: they pin the guard. That the SERVER accepts any model or
  // agent (and only fails the next turn) was seen in the planner spike against opencode 2.0.32
  // (Windows 11, 21/10/2026); this is why the host re-validates against its catalog.
  it('validates the optional model and agent of prompt.send', () => {
    const base = WEBVIEW_SAMPLES['prompt.send'];
    expect(isWebviewToHost({ ...base, model: { providerID: 'p', id: 'm' }, agent: 'plan' })).toBe(
      true,
    );
    expect(isWebviewToHost({ ...base, model: { providerID: 'p', id: 'm', variant: 'high' } })).toBe(
      true,
    );
    const bad: unknown[] = [
      { ...base, model: { providerID: 'p' } },
      { ...base, model: { id: 'm' } },
      { ...base, model: { providerID: '', id: 'm' } },
      { ...base, model: { providerID: 'p', id: '' } },
      { ...base, model: { providerID: 'p', id: 'm', variant: '' } },
      { ...base, model: { providerID: 'p', id: 'm', variant: 3 } },
      { ...base, model: [{ providerID: 'p', id: 'm' }] },
      { ...base, model: 'p/m' },
      { ...base, model: null },
      { ...base, agent: '' },
      { ...base, agent: 3 },
    ];
    for (const value of bad) {
      expect(isWebviewToHost(value), JSON.stringify(value)).toBe(false);
    }
  });

  // Issue #33. Fabricated messages pinning the guard: a command alone is a whole prompt, and the
  // name is checked for shape only (that the host lists it is the controller's check).
  it('validates the optional command of prompt.send', () => {
    const base = WEBVIEW_SAMPLES['prompt.send'];
    const empty = { ...base, text: '', files: [] };
    expect(isWebviewToHost({ ...empty, command: 'init' })).toBe(true);
    expect(isWebviewToHost({ ...empty, command: 'docs/my cmd' })).toBe(true);
    expect(isWebviewToHost({ ...empty, command: 'docs:search', text: 'a b' })).toBe(true);
    expect(isWebviewToHost({ ...empty, command: 'x'.repeat(MAX_COMMAND_NAME_LENGTH) })).toBe(true);
    const bad: unknown[] = [
      { ...empty, command: '' },
      { ...empty, command: '  x' },
      { ...empty, command: 'x ' },
      { ...empty, command: 'a\0b' },
      { ...empty, command: 'x'.repeat(MAX_COMMAND_NAME_LENGTH + 1) },
      { ...empty, command: 3 },
      { ...empty, command: null },
      { ...empty, command: ['init'] },
      // Without a command, blank text and no files is still not a prompt.
      empty,
    ];
    for (const value of bad) {
      expect(isWebviewToHost(value), JSON.stringify(value)).toBe(false);
    }
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
      'session.rename',
      'session.delete',
      'session.fork',
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

  // Issue #20. Fabricated messages: they pin the guard, not what the server does with a title.
  // The blank-title case matters: the server answers `title: ""` by running the LLM title
  // generator instead of clearing the title (VERIFIED by the planner spike, opencode 2.0.32).
  it('bounds the session list and rename messages (issue #20)', () => {
    const query = WEBVIEW_SAMPLES['sessions.query'];
    const rename = WEBVIEW_SAMPLES['session.rename'];
    expect(isWebviewToHost({ ...query, search: '' })).toBe(true);
    expect(isWebviewToHost({ ...query, search: 'x'.repeat(MAX_SESSION_SEARCH_LENGTH) })).toBe(true);
    expect(isWebviewToHost({ ...query, search: 'x'.repeat(MAX_SESSION_SEARCH_LENGTH + 1) })).toBe(
      false,
    );
    expect(isWebviewToHost({ ...query, search: 3 })).toBe(false);
    expect(isWebviewToHost({ ...query, more: 'yes' })).toBe(false);
    expect(isWebviewToHost({ ...query, more: 1 })).toBe(false);
    expect(isWebviewToHost({ ...rename, title: '   ' })).toBe(false);
    expect(isWebviewToHost({ ...rename, title: '' })).toBe(false);
    expect(isWebviewToHost({ ...rename, title: 5 })).toBe(false);
    expect(isWebviewToHost({ ...rename, title: 'x'.repeat(MAX_SESSION_TITLE_LENGTH) })).toBe(true);
    expect(isWebviewToHost({ ...rename, title: 'x'.repeat(MAX_SESSION_TITLE_LENGTH + 1) })).toBe(
      false,
    );
    // Padding does not count: the host trims before storing.
    expect(
      isWebviewToHost({ ...rename, title: `  ${'x'.repeat(MAX_SESSION_TITLE_LENGTH)}  ` }),
    ).toBe(true);
    expect(isWebviewToHost({ ...WEBVIEW_SAMPLES['session.delete'], sessionID: '' })).toBe(false);
  });

  // Issue #21. Fabricated messages: they pin the guard; what the server does with a bad
  // `messageID` (MessageNotFoundError) was seen in the planner spike, not here.
  it('requires non-empty string ids on session.fork (issue #21)', () => {
    const fork = WEBVIEW_SAMPLES['session.fork'];
    expect(isWebviewToHost(fork)).toBe(true);
    expect(isWebviewToHost({ ...fork, messageID: '' })).toBe(false);
    expect(isWebviewToHost({ ...fork, sessionID: '' })).toBe(false);
    expect(isWebviewToHost({ ...fork, requestId: '' })).toBe(false);
    expect(isWebviewToHost({ ...fork, messageID: 7 })).toBe(false);
  });

  // Issues #28/#29. Fabricated messages: they pin the guard. An empty query is refused because the
  // real server answers `data: []` to it (planner spike, opencode 2.0.32), so it would only cost a
  // round trip; the length cap is our own choice.
  it('bounds files.search and validates attachments.fromEditor (issues #28/#29)', () => {
    const search = WEBVIEW_SAMPLES['files.search'];
    expect(isWebviewToHost(search)).toBe(true);
    expect(isWebviewToHost({ ...search, query: '' })).toBe(false);
    expect(isWebviewToHost({ ...search, query: 'x'.repeat(MAX_FILE_SEARCH_LENGTH) })).toBe(true);
    expect(isWebviewToHost({ ...search, query: 'x'.repeat(MAX_FILE_SEARCH_LENGTH + 1) })).toBe(
      false,
    );
    expect(isWebviewToHost({ ...search, query: 3 })).toBe(false);
    expect(isWebviewToHost({ ...search, requestId: '' })).toBe(false);
    expect(isWebviewToHost({ type: 'files.search', query: 'a' })).toBe(false);
    expect(isWebviewToHost({ type: 'attachments.fromEditor' })).toBe(false);
    expect(isWebviewToHost({ type: 'attachments.fromEditor', requestId: '' })).toBe(false);
  });

  // Issue #30. Fabricated messages: they pin the guard of the two entries that carry untrusted
  // strings or bytes from the webview. The caps are our choice (see the constants).
  it('bounds attachments.drop and attachments.image (issue #30)', () => {
    const drop = WEBVIEW_SAMPLES['attachments.drop'];
    expect(isWebviewToHost(drop)).toBe(true);
    expect(isWebviewToHost({ ...drop, uris: [] })).toBe(false);
    expect(isWebviewToHost({ ...drop, uris: Array(MAX_DROPPED_ITEMS).fill('file:///a') })).toBe(
      true,
    );
    expect(isWebviewToHost({ ...drop, uris: Array(MAX_DROPPED_ITEMS + 1).fill('file:///a') })).toBe(
      false,
    );
    expect(isWebviewToHost({ ...drop, uris: [''] })).toBe(false);
    expect(isWebviewToHost({ ...drop, uris: ['file:///a\0b'] })).toBe(false);
    expect(isWebviewToHost({ ...drop, uris: ['x'.repeat(MAX_DROPPED_URI_LENGTH + 1)] })).toBe(
      false,
    );
    expect(isWebviewToHost({ ...drop, uris: 'file:///a' })).toBe(false);
    const image = WEBVIEW_SAMPLES['attachments.image'];
    expect(isWebviewToHost(image)).toBe(true);
    expect(isWebviewToHost({ ...image, mime: 'image/bmp' })).toBe(false);
    expect(isWebviewToHost({ ...image, data: '' })).toBe(false);
    expect(isWebviewToHost({ ...image, data: 'A'.repeat(MAX_IMAGE_BASE64_LENGTH + 1) })).toBe(
      false,
    );
    expect(isWebviewToHost({ ...image, requestId: '' })).toBe(false);
    const forget = WEBVIEW_SAMPLES['attachments.forget'];
    expect(isWebviewToHost(forget)).toBe(true);
    expect(isWebviewToHost({ ...forget, uri: '' })).toBe(false);
    expect(isWebviewToHost({ ...forget, uri: 'x'.repeat(MAX_DROPPED_URI_LENGTH + 1) })).toBe(false);
    expect(isWebviewToHost({ type: 'attachments.forget' })).toBe(false);
  });

  // Issue #28 (decision Q1). Fabricated messages: they pin the guard. Whether the text matches the
  // offsets is not checkable here (the guard does not see the prompt text) and is the host's job.
  it('accepts a well-formed mention on a prompt file and rejects malformed ones', () => {
    const base = WEBVIEW_SAMPLES['prompt.send'];
    const file = { uri: 'file:///a.ts', name: 'a.ts' };
    const withMention = (mention: unknown) => ({ ...base, files: [{ ...file, mention }] });
    expect(isWebviewToHost(withMention({ start: 0, end: 5, text: '@a.ts' }))).toBe(true);
    expect(isWebviewToHost(withMention(undefined))).toBe(true);
    const bad: unknown[] = [
      { start: -1, end: 5, text: '@a.ts' },
      { start: 5, end: 4, text: '@a.ts' },
      { start: 0.5, end: 5, text: '@a.ts' },
      { start: 0, end: 5, text: '' },
      { start: 0, end: 5 },
      { start: '0', end: 5, text: '@a.ts' },
      { start: 0, end: Number.MAX_SAFE_INTEGER + 1, text: '@a.ts' },
      '@a.ts',
      null,
      [],
    ];
    for (const mention of bad) {
      expect(isWebviewToHost(withMention(mention)), JSON.stringify(mention)).toBe(false);
    }
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

  it('accepts a session.diff.open path of exactly the maximum length', () => {
    const base = WEBVIEW_SAMPLES['session.diff.open'];
    expect(isWebviewToHost({ ...base, path: 'a'.repeat(MAX_DIFF_PATH_LENGTH) })).toBe(true);
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
      // Issue #35: the focus flag must be a real boolean, not a string or absent.
      { ...WEBVIEW_SAMPLES['chat.focusChanged'], focused: 'true' },
      { type: 'chat.focusChanged' },
      { ...WEBVIEW_SAMPLES['editor.open'], line: -1 },
      { ...WEBVIEW_SAMPLES['editor.open'], line: 0 },
      { ...WEBVIEW_SAMPLES['editor.open'], line: 1.5 },
      { ...WEBVIEW_SAMPLES['editor.open'], column: '2' },
      { ...WEBVIEW_SAMPLES['editor.open'], path: '' },
      // Issue #31: an empty session or path, a NUL, a path over the cap and a non-string path.
      { ...WEBVIEW_SAMPLES['session.diff.open'], sessionID: '' },
      { ...WEBVIEW_SAMPLES['session.diff.open'], path: '' },
      { ...WEBVIEW_SAMPLES['session.diff.open'], path: 'src/a\0.ts' },
      { ...WEBVIEW_SAMPLES['session.diff.open'], path: 'a'.repeat(MAX_DIFF_PATH_LENGTH + 1) },
      { ...WEBVIEW_SAMPLES['session.diff.open'], path: 3 },
      // Issue #32: the three revert requests need a request id and a session; stage a message too;
      // the open message has the shape rules of `session.diff.open`.
      { ...WEBVIEW_SAMPLES['session.revert.stage'], requestId: '' },
      { ...WEBVIEW_SAMPLES['session.revert.stage'], sessionID: '' },
      { ...WEBVIEW_SAMPLES['session.revert.stage'], messageID: '' },
      { ...WEBVIEW_SAMPLES['session.revert.stage'], messageID: 3 },
      { ...WEBVIEW_SAMPLES['session.revert.clear'], requestId: '' },
      { ...WEBVIEW_SAMPLES['session.revert.clear'], sessionID: '' },
      { ...WEBVIEW_SAMPLES['session.revert.commit'], requestId: '' },
      { ...WEBVIEW_SAMPLES['session.revert.commit'], sessionID: '' },
      { ...WEBVIEW_SAMPLES['session.revert.open'], sessionID: '' },
      { ...WEBVIEW_SAMPLES['session.revert.open'], path: '' },
      { ...WEBVIEW_SAMPLES['session.revert.open'], path: 'src/a\0.ts' },
      { ...WEBVIEW_SAMPLES['session.revert.open'], path: 'a'.repeat(MAX_DIFF_PATH_LENGTH + 1) },
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

  // Issue #14 widened two shapes: a session status can carry an error, and the connection can be
  // unavailable because the server exited. Fabricated messages; the guard is shallow, so this
  // only pins that the new `type` payloads still pass it.
  it('accepts a session.status with an error and an unavailable/exited connection', () => {
    expect(
      isHostToWebview({
        type: 'session.status',
        sessionID: 's',
        status: { type: 'error', error: { code: 'provider.no-route', message: 'nope' } },
      }),
    ).toBe(true);
    expect(
      isHostToWebview({
        type: 'connection.state',
        connection: {
          state: 'unavailable',
          reason: 'exited',
          error: { code: 'exited', message: 'gone' },
        },
      }),
    ).toBe(true);
  });

  // Issue #11: the three reasons of the external-server mode. The guard does not look at `reason`
  // (shallow), so this pins that they pass and, through the type, that `ConnectionState` has them.
  it('accepts an unavailable connection with each external-server reason', () => {
    for (const reason of ['unreachable', 'unauthorized', 'invalid-url'] as const) {
      const message: HostToWebview = {
        type: 'connection.state',
        connection: { state: 'unavailable', reason, error: { code: reason, message: 'x' } },
      };
      expect(isHostToWebview(message)).toBe(true);
    }
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

  // The real invariant (REST snapshot index == stream counter) needs the host adapter; it is
  // tested in `src/extension/eventTranslator.test.ts` (issue #14). A test over contentPartId
  // alone would compare the function with itself and could not fail, so there is none here.
});
