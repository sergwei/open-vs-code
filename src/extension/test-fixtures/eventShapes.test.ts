import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, stopServer, type RunningServer, type ServerLog } from '../opencodeServer';
import {
  diffShapes,
  formatDiff,
  isTurnEvent,
  shapesOf,
  type AllowEntry,
  type EventShapes,
} from './eventShapes';
import { clientFor, recordTurn } from './turnRecording';

/**
 * Protects the LOGIC of the event-shape check: how events are reduced to shapes, how two
 * recordings are compared, how the allow list and the output behave. Every event here is
 * FABRICATED by the test (or comes from the synthetic fixture), so a pass says nothing about what a
 * real opencode emits: that is what `npm run test:event-shapes` is for, and it can only run with a
 * model. The last case is the pipeline end to end with no model: two processes of the synthetic
 * server play the same turn and must give the same shapes, and removing one field from one
 * recording must show as exactly one line.
 */

const envelope = { id: 'evt_1', created: 1 };

describe('shapesOf', () => {
  it('lists the path and the type of every value, envelope included', () => {
    const shapes = shapesOf([
      {
        ...envelope,
        type: 'session.text.ended',
        data: { sessionID: 's', ordinal: 0, text: 'x' },
        durable: { aggregateID: 's', seq: 1, version: 1 },
      },
    ]);
    expect(shapes['session.text.ended']).toEqual({
      created: { types: ['number'], optional: false },
      data: { types: ['object'], optional: false },
      'data.ordinal': { types: ['number'], optional: false },
      'data.sessionID': { types: ['string'], optional: false },
      'data.text': { types: ['string'], optional: false },
      durable: { types: ['object'], optional: false },
      'durable.aggregateID': { types: ['string'], optional: false },
      'durable.seq': { types: ['number'], optional: false },
      'durable.version': { types: ['number'], optional: false },
      id: { types: ['string'], optional: false },
      type: { types: ['string'], optional: false },
    });
  });

  it('merges occurrences: a key missing from one is optional, differing types are both kept', () => {
    const shapes = shapesOf([
      { ...envelope, type: 'session.step.ended', data: { cost: 0, finish: 'stop' } },
      { ...envelope, type: 'session.step.ended', data: { cost: null } },
    ]);
    const shape = shapes['session.step.ended'] ?? {};
    expect(shape['data.finish']).toEqual({ types: ['string'], optional: true });
    expect(shape['data.cost']).toEqual({ types: ['null', 'number'], optional: false });
  });

  it('groups the objects of an array by their type, so message blocks keep their own keys', () => {
    const shapes = shapesOf([
      {
        ...envelope,
        type: 'session.step.ended',
        data: {
          content: [
            { type: 'text', text: 'a' },
            { type: 'tool', id: 'call', name: 'read' },
          ],
        },
      },
    ]);
    const shape = shapes['session.step.ended'] ?? {};
    expect(Object.keys(shape)).toEqual(
      expect.arrayContaining([
        'data.content',
        'data.content[type=text].text',
        'data.content[type=tool].id',
        'data.content[type=tool].name',
      ]),
    );
    expect(shape['data.content[type=text].id']).toBeUndefined();
  });

  it('keeps the four states of a tool block apart by their status', () => {
    const shapes = shapesOf([
      {
        ...envelope,
        type: 'session.tool.success',
        data: { state: { status: 'completed', content: [] } },
      },
      {
        ...envelope,
        type: 'session.tool.success',
        data: { state: { status: 'error', error: { type: 'x', message: 'm' } } },
      },
    ]);
    expect(Object.keys(shapes['session.tool.success'] ?? {})).toEqual(
      expect.arrayContaining([
        'data.state[status=completed].content',
        'data.state[status=error].error.message',
      ]),
    );
  });

  it('skips events that are not part of a turn and values that have no type', () => {
    expect(
      shapesOf([
        { ...envelope, type: 'models.dev.refreshed', data: {} },
        { ...envelope, data: {} },
        'not an event',
        null,
      ]),
    ).toEqual({});
    expect(isTurnEvent('server.connected')).toBe(true);
    expect(isTurnEvent('permission.asked')).toBe(true);
    expect(isTurnEvent('form.created')).toBe(true);
    expect(isTurnEvent('project.updated')).toBe(false);
  });
});

describe('diffShapes', () => {
  const turn = (data: object, extra: object = {}): EventShapes =>
    shapesOf([{ ...envelope, type: 'session.step.ended', data, ...extra }]);

  it('reports nothing for equal shapes', () => {
    expect(diffShapes(turn({ cost: 0 }), turn({ cost: 1 })).diffs).toEqual([]);
  });

  it('reports a path only the real one has, and one only the fake has', () => {
    const result = diffShapes(turn({ cost: 0, tokens: { input: 1 } }), turn({ cost: 0, extra: 1 }));
    expect(result.diffs.map((diff) => `${diff.kind} ${diff.path ?? ''}`)).toEqual([
      'path-only-fake data.extra',
      'path-only-real data.tokens',
      'path-only-real data.tokens.input',
    ]);
  });

  it('reports a type change and an optional change', () => {
    const real = shapesOf([
      { ...envelope, type: 'session.step.ended', data: { cost: 0, finish: 'stop' } },
      { ...envelope, type: 'session.step.ended', data: { cost: 0 } },
    ]);
    const fake = turn({ cost: '0', finish: 'stop' });
    const kinds = diffShapes(real, fake).diffs.map((diff) => `${diff.kind} ${diff.path ?? ''}`);
    expect(kinds).toEqual(['type-mismatch data.cost', 'optional-mismatch data.finish']);
  });

  it('reports an event only one side has', () => {
    const real = shapesOf([{ ...envelope, type: 'session.tool.called', data: {} }]);
    const result = diffShapes(real, {});
    expect(result.diffs).toEqual([{ event: 'session.tool.called', kind: 'event-only-real' }]);
    expect(diffShapes({}, real).diffs).toEqual([
      { event: 'session.tool.called', kind: 'event-only-fake' },
    ]);
  });

  it('moves an allowed difference to accepted and flags an entry that matches nothing as stale', () => {
    const allow: AllowEntry[] = [
      { event: 'session.step.ended', path: 'data.tokens', kind: 'path-only-real', reason: 'a' },
      { event: 'session.step.ended', kind: 'path-only-real', reason: 'any path of this event' },
      { event: 'session.gone', kind: 'event-only-real', reason: 'was excused once' },
    ];
    const result = diffShapes(turn({ cost: 0, tokens: { input: 1 } }), turn({ cost: 0 }), allow);
    expect(result.diffs).toEqual([]);
    expect(result.accepted.map((diff) => diff.path)).toEqual(['data.tokens', 'data.tokens.input']);
    expect(result.stale.map((entry) => entry.event)).toEqual(['session.gone']);
  });

  it('lets a `.*` path entry cover the path and everything under it, on any event', () => {
    const real = shapesOf([
      {
        ...envelope,
        type: 'session.step.ended',
        data: {},
        location: { region: 'x', deep: { a: 1 } },
      },
      { ...envelope, type: 'session.text.ended', data: {}, location: { region: 'y' } },
      { ...envelope, type: 'session.text.ended', data: {}, locations: 1 },
    ]);
    const fake = shapesOf([
      { ...envelope, type: 'session.step.ended', data: {} },
      { ...envelope, type: 'session.text.ended', data: {} },
    ]);
    const allow: AllowEntry[] = [
      { path: 'location.*', kind: 'path-only-real', reason: 'envelope' },
    ];
    const result = diffShapes(real, fake, allow);
    // `location` itself and `location.deep.a` are covered on both events; `locations` is another
    // key, so the prefix does not excuse it.
    expect(result.accepted.map((diff) => `${diff.event} ${diff.path ?? ''}`)).toEqual([
      'session.step.ended location',
      'session.step.ended location.deep',
      'session.step.ended location.deep.a',
      'session.step.ended location.region',
      'session.text.ended location',
      'session.text.ended location.region',
    ]);
    expect(result.diffs.map((diff) => `${diff.event} ${diff.kind} ${diff.path ?? ''}`)).toEqual([
      'session.text.ended path-only-real locations',
    ]);
    expect(result.stale).toEqual([]);
  });

  it('flags a prefix entry as stale when nothing under the prefix differs any more', () => {
    const same = shapesOf([{ ...envelope, type: 'session.step.ended', data: { cost: 0 } }]);
    const allow: AllowEntry[] = [
      { path: 'location.*', kind: 'path-only-real', reason: 'envelope' },
      {
        event: 'session.step.ended',
        path: 'data.*',
        kind: 'path-only-real',
        reason: 'other event',
      },
    ];
    const result = diffShapes(same, same, allow);
    expect(result.diffs).toEqual([]);
    expect(result.stale.map((entry) => entry.path)).toEqual(['location.*', 'data.*']);
    expect(formatDiff(result)).toContain(
      'stale allow entry (nothing matches it any more): (any event) path-only-real location.* - envelope',
    );
  });
});

describe('formatDiff', () => {
  it('groups by event, sorts by path and writes one line per difference, with the counts first', () => {
    const real = shapesOf([
      { ...envelope, type: 'session.tool.called', data: { id: 'c', executed: false } },
      { ...envelope, type: 'session.text.ended', data: { text: 'x' } },
    ]);
    const fake = shapesOf([
      { ...envelope, type: 'session.tool.called', data: { id: 'c' } },
      { ...envelope, type: 'session.text.ended', data: { text: 'x' } },
    ]);
    const text = formatDiff(diffShapes(real, fake));
    expect(text).toBe(
      [
        'event shapes: 1 difference(s), 0 accepted, 0 stale allow entries',
        '',
        'session.tool.called',
        '  data.executed  path-only-real  real=boolean fake=-',
        '',
      ].join('\n'),
    );
  });

  it('is identical for the same input twice', () => {
    const real = shapesOf([{ ...envelope, type: 'session.tool.called', data: { a: 1, b: 2 } }]);
    expect(formatDiff(diffShapes(real, {}))).toBe(formatDiff(diffShapes(real, {})));
  });
});

const FIXTURE = fileURLToPath(new URL('./fake-opencode.mjs', import.meta.url));
const quiet: ServerLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};
const servers: RunningServer[] = [];
const folders: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await stopServer(server.child, quiet);
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

/** Starts the synthetic server and plays one permission-asking turn against it. */
async function playTurn(): Promise<EventShapes> {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'ovsc-shapes-'));
  folders.push(folder);
  const server = await startServer({
    command: process.execPath,
    prefixArgs: [FIXTURE],
    folder,
    port: 0,
    log: quiet,
    baseEnv: { ...process.env, FAKE_OPENCODE_MODE: 'ok' },
  });
  servers.push(server);
  const client = clientFor(server, folder);
  const { recording } = await recordTurn({
    client,
    prompt: 'Use the read tool to read .env. ASK_PERMISSION',
    timeoutMs: 15_000,
    titleWaitMs: 5_000,
  });
  expect(recording.outcome).toBe('succeeded');
  expect(recording.permissionAnswered).toBe(true);
  return shapesOf(recording.events);
}

describe('the pipeline against two processes of the synthetic server', () => {
  it('gives no difference for the same turn, and one line when a field is taken out of one side', async () => {
    const [first, second] = [await playTurn(), await playTurn()];
    expect(Object.keys(first)).toEqual(
      expect.arrayContaining([
        'server.connected',
        'session.created',
        'session.inbox.enqueued',
        'session.tool.called',
        'permission.asked',
        'session.tool.success',
        'session.step.ended',
        'session.text.ended',
        'session.execution.succeeded',
      ]),
    );
    expect(diffShapes(first, second).diffs).toEqual([]);

    // Mutation: the second recording loses `data.action` of the permission request.
    const mutated: EventShapes = structuredClone(second);
    const shape = mutated['permission.asked'];
    if (shape === undefined) throw new Error('no permission.asked recorded');
    delete shape['data.action'];
    const result = diffShapes(first, mutated);
    expect(result.diffs.map((diff) => `${diff.event} ${diff.kind} ${diff.path ?? ''}`)).toEqual([
      'permission.asked path-only-real data.action',
    ]);
  }, 60_000);
});
