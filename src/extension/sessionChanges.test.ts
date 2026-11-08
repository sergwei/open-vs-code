// Protects the model of the "Changes of the sessions" view (E9-sidebar-home, issue #187, phase 2)
// against its quiet failure modes: a view that reads the server before anyone expands a row (the
// whole point of decision P2=1), a list that grows past the cap of 20, a session that never shows
// up because it only has files in a subagent, a refresh that is lost or costs a read per event, and
// a path that was never listed becoming openable.
//
// Provenance of the data: ALL FABRICATED by hand. The rows follow `FileDiffInfo` of
// `@opencode/client@2.0.32` and the unified patch format READ in `vcs/patch.ts` @843a6c51, the same
// source `sessionDiff.test.ts` uses; the fake client answers only what `createSessionDiffs` asks
// (`session.get`, `message.list`, `session.diff`). The loader itself is the real one, so a pass
// confirms the WIRING of the view model over it, not that a real server answers these rows. The
// fake-server case "lists the changed files of a session without a tab and opens its native diff"
// of `fakeServer.test.ts` is the run against the synthetic server.
import type { FileDiffInfo, SessionDiffInput } from '@opencode/client';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ChangedFile } from '../shared/model';
import type { ChatApi } from './opencodeClient';
import {
  createSessionChanges,
  describeChanges,
  MAX_CHANGE_SESSIONS,
  type SessionChangesDeps,
} from './sessionChanges';

/** A row of `session.diff` with a complete patch of `old` -> `new` for one line. */
const row = (file: string, extra: Partial<FileDiffInfo> = {}): FileDiffInfo => ({
  file,
  patch: [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '',
  ].join('\n'),
  additions: 1,
  deletions: 1,
  status: 'modified',
  ...extra,
});

/** What a test can change about the fake server and the host state around the model. */
interface World {
  tabs: string[];
  today: string[];
  updated: Record<string, number>;
  /** The rows each session answers; a session not listed answers none. */
  rows: Record<string, FileDiffInfo[]>;
  failure: object | undefined;
  client: object | undefined;
  now: number;
  /** Held back on the `context: 0` read until released, to change the world mid-load. */
  gate: Promise<void> | undefined;
}

/** Builds the model over a fake client; returns it with the world and what the client was asked. */
function build(overrides: Partial<World> = {}) {
  const world: World = {
    tabs: [],
    today: [],
    updated: {},
    rows: {},
    failure: undefined,
    client: undefined,
    now: 1_000,
    gate: undefined,
    ...overrides,
  };
  const asked: string[] = [];
  const diffInputs: SessionDiffInput[] = [];
  const api = {
    session: {
      get: () => Promise.resolve({ subpath: '', location: { directory: '/repo' } }),
      diff: async (input: SessionDiffInput) => {
        asked.push(`diff ${input.sessionID}`);
        diffInputs.push(input);
        if (world.gate !== undefined && input.context === 0) await world.gate;
        if (world.failure !== undefined) {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw world.failure;
        }
        return world.rows[input.sessionID] ?? [];
      },
    },
    message: {
      list: (input: { sessionID: string }) => {
        asked.push(`list ${input.sessionID}`);
        return Promise.resolve({ data: [{ id: 'msg_1' }] });
      },
    },
  };
  world.client ??= api;
  const deps: SessionChangesDeps = {
    client: () => world.client as ChatApi | undefined,
    folder: () => '/repo',
    tabs: () => world.tabs,
    today: () => world.today,
    updatedAt: (sessionID) => world.updated[sessionID],
    titleOf: (sessionID) => `Title ${sessionID}`,
    boundary: () => undefined,
    now: () => world.now,
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
    describe: (error) => ({
      code: (error as { _tag?: string })._tag ?? 'Unknown',
      message: 'scrubbed',
    }),
    impl: path.posix,
  };
  return { model: createSessionChanges(deps), world, asked, diffInputs };
}

describe('createSessionChanges: which sessions it lists', () => {
  it('lists the sessions with a tab, the touched ones and those of Today, newest first, without repeats', () => {
    const { model, world } = build({
      tabs: ['ses_a', 'ses_b'],
      today: ['ses_b', 'ses_c'],
      updated: { ses_a: 100, ses_b: 300, ses_c: 200 },
    });
    world.now = 250;
    model.touch('ses_d');
    // ses_d was touched at 250, so it sits between ses_c (200) and ses_b (300).
    expect(model.sessions().map((s) => s.sessionID)).toEqual(['ses_b', 'ses_d', 'ses_c', 'ses_a']);
  });

  it('cuts the list at the cap', () => {
    const today = Array.from({ length: MAX_CHANGE_SESSIONS + 5 }, (_, i) => `ses_${String(i)}`);
    const updated = Object.fromEntries(today.map((id, i) => [id, i]));
    const { model } = build({ today, updated });
    const listed = model.sessions();
    expect(listed).toHaveLength(MAX_CHANGE_SESSIONS);
    // The newest are kept: the highest `updated` values are the last ids.
    expect(listed[0]?.sessionID).toBe(`ses_${String(MAX_CHANGE_SESSIONS + 4)}`);
  });

  it('reads nothing from the server until a row is expanded', () => {
    const { model, asked } = build({ tabs: ['ses_a'], today: ['ses_b'] });
    model.sessions();
    model.touch('ses_c');
    model.listChanged();
    expect(asked).toEqual([]);
    expect(model.sessions().every((s) => s.files === undefined)).toBe(true);
  });

  it('gives a session its own title, from the host', () => {
    const { model } = build({ tabs: ['ses_a'] });
    expect(model.sessions()[0]?.title).toBe('Title ses_a');
  });
});

describe('createSessionChanges: loading the files of a session', () => {
  it('reads once on the first expansion and keeps the answer for the next one', async () => {
    const { model, asked } = build({ today: ['ses_a'], rows: { ses_a: [row('src/a.ts')] } });
    await model.ensureLoaded('ses_a');
    const reads = asked.length;
    await model.ensureLoaded('ses_a');
    expect(asked).toHaveLength(reads);
    const files = model.sessions()[0]?.files as ChangedFile[];
    expect(files.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(model.count('ses_a')).toBe(1);
  });

  it('says "no files" with an empty list, not "not read yet"', async () => {
    const { model } = build({ today: ['ses_a'] });
    expect(model.sessions()[0]?.files).toBeUndefined();
    await model.ensureLoaded('ses_a');
    expect(model.sessions()[0]?.files).toEqual([]);
  });

  it('shares one read between two expansions that overlap', async () => {
    const { model, asked } = build({ today: ['ses_a'], rows: { ses_a: [row('src/a.ts')] } });
    await Promise.all([model.ensureLoaded('ses_a'), model.ensureLoaded('ses_a')]);
    expect(asked.filter((line) => line === 'diff ses_a')).toHaveLength(1);
  });

  it('does not mark a session loaded when there is no server, so the next expansion asks again', async () => {
    const { model, world, asked } = build({ today: ['ses_a'], rows: { ses_a: [row('src/a.ts')] } });
    const api = world.client;
    world.client = undefined;
    await model.ensureLoaded('ses_a');
    expect(model.sessions()[0]?.files).toBeUndefined();
    world.client = api;
    await model.ensureLoaded('ses_a');
    expect(asked).toContain('diff ses_a');
    expect(model.sessions()[0]?.files).toHaveLength(1);
  });

  it('keeps the scrubbed error of a failed read and shows no files', async () => {
    const { model } = build({ today: ['ses_a'], failure: { _tag: 'Boom' } });
    await model.ensureLoaded('ses_a');
    const session = model.sessions()[0];
    expect(session?.error).toEqual({ code: 'Boom', message: 'scrubbed' });
    expect(session?.files).toEqual([]);
  });
});

describe('createSessionChanges: refreshing on a step with files', () => {
  it('re-reads an expanded session when it is touched, and not one nobody expanded', async () => {
    const { model, asked } = build({
      today: ['ses_a', 'ses_b'],
      rows: { ses_a: [row('src/a.ts')], ses_b: [row('src/b.ts')] },
    });
    await model.ensureLoaded('ses_a');
    const before = asked.filter((line) => line === 'diff ses_a').length;
    model.touch('ses_a');
    model.touch('ses_b');
    await vi.waitFor(() => {
      expect(asked.filter((line) => line === 'diff ses_a').length).toBeGreaterThan(before);
    });
    expect(asked).not.toContain('diff ses_b');
  });

  it('shows the new files after the refresh and tells the view', async () => {
    const { model, world } = build({ today: ['ses_a'], rows: { ses_a: [row('src/a.ts')] } });
    await model.ensureLoaded('ses_a');
    const changes = vi.fn();
    model.onChange(changes);
    world.rows['ses_a'] = [row('src/a.ts'), row('src/new.ts', { status: 'added' })];
    model.touch('ses_a');
    await vi.waitFor(() => {
      expect(model.sessions()[0]?.files?.map((f) => f.path)).toEqual(['src/a.ts', 'src/new.ts']);
    });
    expect(changes).toHaveBeenCalled();
  });

  it('asks once more when a step lands while the first read is in flight', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { model, asked, world } = build({
      today: ['ses_a'],
      rows: { ses_a: [row('src/a.ts')] },
      gate,
    });
    const loading = model.ensureLoaded('ses_a');
    await vi.waitFor(() => {
      expect(asked).toContain('diff ses_a');
    });
    world.rows['ses_a'] = [row('src/a.ts'), row('src/late.ts')];
    model.touch('ses_a');
    release();
    await loading;
    await vi.waitFor(() => {
      expect(model.sessions()[0]?.files?.map((f) => f.path)).toEqual(['src/a.ts', 'src/late.ts']);
    });
  });
});

describe('createSessionChanges: what may be opened', () => {
  it('opens only a path the loader listed for that session', async () => {
    const { model } = build({ today: ['ses_a'], rows: { ses_a: [row('src/a.ts')] } });
    expect(model.target('ses_a', 'src/a.ts')).toEqual({ ok: false, reason: 'not listed' });
    await model.ensureLoaded('ses_a');
    const listed = model.target('ses_a', 'src/a.ts');
    expect(listed.ok && listed.target.absolute).toBe('/repo/src/a.ts');
    expect(model.target('ses_a', '../secret.ts')).toEqual({ ok: false, reason: 'not listed' });
    expect(model.target('ses_b', 'src/a.ts')).toEqual({ ok: false, reason: 'not listed' });
  });

  it('serves the original of a listed file, and refuses one that was not listed', async () => {
    const { model } = build({ today: ['ses_a'], rows: { ses_a: [row('src/a.ts')] } });
    await model.ensureLoaded('ses_a');
    await expect(model.original('ses_a', 'src/a.ts')).resolves.toBe('old\n');
    await expect(model.original('ses_a', 'src/other.ts')).rejects.toMatchObject({
      name: 'DiffNotListed',
    });
    await expect(model.original('ses_zzz', 'src/a.ts')).rejects.toMatchObject({
      name: 'DiffNotListed',
    });
  });
});

describe('createSessionChanges: forgetting', () => {
  it('forgets a deleted session: it stops being a candidate once nothing else lists it', async () => {
    const { model, world } = build({ rows: { ses_a: [row('src/a.ts')] } });
    model.touch('ses_a');
    await model.ensureLoaded('ses_a');
    model.forget('ses_a');
    expect(model.sessions()).toEqual([]);
    expect(model.count('ses_a')).toBeUndefined();
    expect(model.target('ses_a', 'src/a.ts')).toEqual({ ok: false, reason: 'not listed' });
    expect(world.tabs).toEqual([]);
  });

  it('drops everything when the server goes away, and a read cut off by it publishes nothing', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { model } = build({ today: ['ses_a'], rows: { ses_a: [row('src/a.ts')] }, gate });
    const loading = model.ensureLoaded('ses_a');
    model.reset();
    release();
    await loading;
    // The entry died with the reset: the session is a candidate again (Today) but not loaded.
    expect(model.sessions()[0]?.files).toBeUndefined();
    expect(model.count('ses_a')).toBeUndefined();
  });
});

describe('describeChanges', () => {
  const file = (additions: number, deletions: number): ChangedFile => ({
    path: 'a.ts',
    status: 'modified',
    additions,
    deletions,
    binary: false,
    tooLarge: false,
  });

  it('describes a session by its file count and its totals', () => {
    expect(describeChanges([file(1, 1)])).toBe('1 file · +1 −1');
    expect(describeChanges([file(2, 0), file(3, 4)])).toBe('2 files · +5 −4');
    expect(describeChanges([])).toBe('0 files · +0 −0');
  });
});
