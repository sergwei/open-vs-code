// Protects the controller's side of the home view that #190 does not cover (E9-sidebar-home, issue
// #187): `composeFromHome` hands the tab a compose with `send: true`, and `revertBoundaryOf` has no
// boundary for a session no pane shows. The activity registry, `stopSession` and
// `interruptSessions` are covered by `chatController.activity.test.ts` (#190).
//
// Provenance: a small FABRICATED client (cast to `ChatApi` because only the calls these cases reach
// exist), like `chatController.workMode.test.ts`. Nothing here talks to a real opencode. The same
// flow against the synthetic server is `test/integration/fakeServer.test.ts`.
import type { SessionInfo, V2Event } from '@opencode/client';
import { describe, expect, it } from 'vitest';
import type { HostToWebview } from '../shared/protocol';
import { ChatController, type ChatControllerDeps } from './chatController';
import type { EventStreamOptions } from './eventStream';
import type { ChatApi } from './opencodeClient';
import { noSetup } from './test-fixtures/noSetup';

const SERVER = {
  url: 'http://127.0.0.1:43211',
  password: 'pw-secret-1',
  version: '2.0.32',
  folder: 'C:\\work',
  binaryPath: 'opencode.exe',
  pid: 1,
  source: 'spawned' as const,
};
/** Parses a JSON literal as the wire type `T` (FABRICATED server data, not checked). */
const wire = <T>(json: string): T => JSON.parse(json) as T;
const LOCATION = wire<{ directory: string }>('{"directory":"C:\\\\work"}');
/** A minimal root `SessionInfo` with the id `id` (FABRICATED). */
const row = (id: string): SessionInfo =>
  wire<SessionInfo>(
    JSON.stringify({
      id,
      projectID: 'p',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      location: { directory: 'C:\\work' },
    }),
  );

/**
 * A controller over a fabricated client with one primary pane, plus what it logged and posted.
 * Provenance: hand-made rows; it proves routing, not the server's answers.
 */
function setup() {
  const api = {
    event: {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      }),
    },
    session: {
      list: () => Promise.resolve({ data: [row('ses_a')], cursor: {} }),
      active: () => Promise.resolve({}),
      get: ({ sessionID }: { sessionID: string }) => Promise.resolve(row(sessionID)),
      diff: () => Promise.resolve([]),
    },
    message: { list: () => Promise.resolve({ data: [], cursor: {} }) },
    model: {
      list: () => Promise.resolve({ location: LOCATION, data: [] }),
      default: () => Promise.resolve({ location: LOCATION, data: null }),
    },
    provider: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    agent: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    form: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    permission: {
      request: { list: () => Promise.resolve({ location: LOCATION, data: [] }) },
    },
  } as unknown as ChatApi;
  const logs: string[] = [];
  const deps: ChatControllerDeps = {
    createClient: () => api,
    editor: {
      open: () => Promise.resolve(),
      editorContext: () => Promise.resolve({ refs: [], ranged: 0, unsaved: false }),
      insert: () => Promise.resolve(),
      newFile: () => Promise.resolve(),
      copy: () => Promise.resolve(),
      pickFiles: () => Promise.resolve([]),
      droppedFiles: () =>
        Promise.resolve({ refs: [], skipped: { folders: 0, outside: 0, remote: 0, missing: 0 } }),
      openDiff: () => Promise.resolve('diff'),
    },
    log: {
      info: (m) => logs.push(`info: ${m}`),
      warn: (m) => logs.push(`warn: ${m}`),
      error: (m) => logs.push(`error: ${m}`),
      debug: (m) => logs.push(`debug: ${m}`),
    },
    memory: { get: () => undefined, set: () => Promise.resolve() },
    attention: { update: () => undefined },
    savedPermissions: { pickToRevoke: () => Promise.resolve([]) },
    sessions: {
      confirmDelete: () => Promise.resolve(true),
      confirmRevertDiscard: () => Promise.resolve(true),
    },
    preferences: {
      defaultModel: () => undefined,
      lastModel: () => undefined,
      setLastModel: () => Promise.resolve(),
    },
    server: { restart: () => undefined, showLogs: () => undefined },
    setup: noSetup,
    ui: { setChatFocused: () => undefined, focusView: () => undefined },
    runStream: ((streamOptions: EventStreamOptions<V2Event>) =>
      new Promise<void>((resolve) => {
        streamOptions.signal.addEventListener('abort', () => resolve(), { once: true });
      })) as ChatControllerDeps['runStream'],
  };
  const controller = new ChatController(deps);
  const posted: HostToWebview[] = [];
  const pane = controller.attachPane({ post: (m) => posted.push(m), primary: true });
  controller.onServerState({ kind: 'running', server: SERVER });
  return { controller, pane, posted, logs };
}

describe('composeFromHome', () => {
  it('composeFromHome composes with send true and refuses a blank text and a missing pane', () => {
    const t = setup();
    expect(t.controller.composeFromHome(t.pane.id, 'Build the thing')).toEqual({
      status: 'composed',
    });
    expect(t.posted).toContainEqual({
      type: 'prompt.compose',
      text: 'Build the thing',
      files: [],
      send: true,
    });
    expect(t.logs).toContain('info: home composed a prompt');
    expect(t.logs.join(' | ')).not.toContain('Build the thing');
    expect(t.controller.composeFromHome(t.pane.id, '   ')).toMatchObject({
      status: 'rejected',
      error: { code: 'ComposeRefused' },
    });
    expect(t.controller.composeFromHome(999, 'x')).toMatchObject({ status: 'rejected' });
  });
});

describe('revertBoundaryOf', () => {
  it('is undefined for a session no pane shows or that has no revert prepared', async () => {
    const t = setup();
    expect(t.controller.revertBoundaryOf('ses_a')).toBeUndefined();
    await t.controller.handle(t.pane.id, {
      type: 'session.open',
      requestId: 'o',
      sessionID: 'ses_a',
    });
    expect(t.controller.revertBoundaryOf('ses_a')).toBeUndefined();
  });
});
