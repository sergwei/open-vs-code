// Protects the "Changed files" logic of the host (issue #31) against its quiet failure modes: an
// original text rebuilt wrong (a missing newline, CRLF turned into LF, a context-limited patch
// accepted as the whole file), a path from the server that escapes the served folder and becomes
// openable, a list that is published for a session that is no longer open or a server that is gone,
// and a burst of step events that costs a request each.
//
// Provenance of the data: ALL FABRICATED by hand. The patches follow the unified-diff format as
// READ in `vcs/git.ts` and `vcs/patch.ts` @843a6c51 (`git diff --unified=N --no-renames`, paths
// without `a/ b/` in the `file` field), the rows follow `FileDiffInfo` of `@opencode/client@2.0.32`
// and the fake client only answers what the module asks. A pass confirms our logic, NOT that a real
// server produces these patches; the spike with a model (see the implementation notes of the
// issue) is what would compare them. `path.win32` and `path.posix` are injected so both flavours
// run on any OS.
import type { FileDiffInfo, SessionDiffInput } from '@opencode/client';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostToWebview } from '../shared/protocol';
import type { ChatApi } from './opencodeClient';
import {
  createSessionDiffs,
  diffRoot,
  originalFromPatch,
  toEntries,
  type SessionDiffsDeps,
} from './sessionDiff';

/** A patch as git prints it: the header, then the given hunk lines, ending in a newline. */
const patch = (...lines: string[]): string =>
  [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    ...lines,
    '',
  ].join('\n');

/** The fields `originalFromPatch` reads, with counts that do not matter unless a test says so. */
const modified = (
  text: string,
  extra: Partial<FileDiffInfo> = {},
): Pick<FileDiffInfo, 'patch' | 'additions' | 'deletions' | 'status'> => ({
  patch: text,
  additions: 1,
  deletions: 1,
  status: 'modified',
  ...extra,
});

describe('originalFromPatch', () => {
  it('rebuilds the old text of a modified file from the context and removed lines', () => {
    const text = patch('@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three');
    expect(originalFromPatch(modified(text))).toBe('one\ntwo\nthree\n');
  });

  it('gives the empty text for an added file, whatever the patch says', () => {
    const text = patch('@@ -0,0 +1,2 @@', '+a', '+b');
    expect(originalFromPatch({ patch: text, additions: 2, deletions: 0, status: 'added' })).toBe(
      '',
    );
    expect(originalFromPatch({ patch: '', additions: 0, deletions: 0, status: 'added' })).toBe('');
  });

  it('gives every line of a deleted file', () => {
    const text = patch('@@ -1,2 +0,0 @@', '-a', '-b');
    expect(originalFromPatch({ patch: text, additions: 0, deletions: 2, status: 'deleted' })).toBe(
      'a\nb\n',
    );
  });

  it('keeps a missing final newline of the OLD side', () => {
    const text = patch('@@ -1 +1 @@', '-foo', '\\ No newline at end of file', '+foo');
    expect(originalFromPatch(modified(text))).toBe('foo');
  });

  it('ignores a missing final newline that only the NEW side has', () => {
    const text = patch('@@ -1 +1 @@', '-foo', '+foo', '\\ No newline at end of file');
    expect(originalFromPatch(modified(text))).toBe('foo\n');
  });

  it('keeps a missing final newline that both sides share (a context line)', () => {
    const text = patch('@@ -1,2 +1,2 @@', '-a', '+A', ' b', '\\ No newline at end of file');
    expect(originalFromPatch(modified(text))).toBe('a\nb');
  });

  it('keeps the carriage returns of a CRLF file', () => {
    const text = patch('@@ -1,3 +1,3 @@', ' one\r', '-two\r', '+TWO\r', ' three\r');
    expect(originalFromPatch(modified(text))).toBe('one\r\ntwo\r\nthree\r\n');
  });

  it('treats a bare empty line inside a hunk as an empty context line', () => {
    // Some tools strip the single space of an empty context line.
    const text = patch('@@ -1,3 +1,3 @@', ' a', '', '-b', '+B');
    expect(originalFromPatch(modified(text))).toBe('a\n\nb\n');
  });

  it('refuses a binary (empty patch)', () => {
    expect(originalFromPatch({ patch: '', additions: 0, deletions: 0, status: 'modified' })).toBe(
      undefined,
    );
  });

  it('refuses a patch cut for size: a header with no hunks but real counts', () => {
    expect(originalFromPatch(modified(patch()))).toBeUndefined();
  });

  it('gives the empty text for a header with no hunks and no counts (an empty file)', () => {
    const empty = { patch: patch(), additions: 0, deletions: 0, status: 'modified' } as const;
    expect(originalFromPatch(empty)).toBe('');
  });

  it('refuses a context-limited patch: its first hunk does not start at line 1', () => {
    const text = patch('@@ -10,3 +10,3 @@', ' x', '-y', '+Y', ' z');
    expect(originalFromPatch(modified(text))).toBeUndefined();
  });

  it('refuses a patch whose second hunk leaves a gap after the first', () => {
    const text = patch('@@ -1,2 +1,2 @@', ' a', '-b', '+B', '@@ -9,2 +9,2 @@', ' i', '-j', '+J');
    expect(originalFromPatch(modified(text))).toBeUndefined();
  });

  it('refuses a hunk whose body does not hold the lines its header announces', () => {
    const text = patch('@@ -1,3 +1,3 @@', ' one', '-two', '+TWO');
    expect(originalFromPatch(modified(text))).toBeUndefined();
  });

  it('refuses a body line with an unknown marker', () => {
    const text = patch('@@ -1,2 +1,2 @@', ' one', '?two');
    expect(originalFromPatch(modified(text))).toBeUndefined();
  });
});

describe('diffRoot', () => {
  it('is the location directory itself when the server sends no subpath', () => {
    expect(diffRoot('C:\\repo', undefined, path.win32)).toBe('C:\\repo');
    expect(diffRoot('/repo', '', path.posix)).toBe('/repo');
  });

  it('goes up as many levels as the subpath has segments', () => {
    expect(diffRoot('/repo/packages/app', 'packages/app', path.posix)).toBe('/repo');
    expect(diffRoot('/repo/sub', 'sub', path.posix)).toBe('/repo');
    expect(diffRoot('C:\\repo\\packages\\app', 'packages/app', path.win32)).toBe('C:\\repo');
  });

  it('ignores case on win32 only', () => {
    expect(diffRoot('C:\\Repo\\Sub', 'sub', path.win32)).toBe('C:\\Repo');
    expect(diffRoot('/Repo/Sub', 'sub', path.posix)).toBeUndefined();
  });

  it('refuses a subpath with .. or one that is not the end of the location directory', () => {
    expect(diffRoot('/repo/sub', '../x', path.posix)).toBeUndefined();
    expect(diffRoot('/repo/sub', 'other', path.posix)).toBeUndefined();
    expect(diffRoot('/repo/sub', 'a/sub', path.posix)).toBeUndefined();
  });
});

const row = (
  file: string,
  status: FileDiffInfo['status'] = 'modified',
  extra: Partial<FileDiffInfo> = {},
): FileDiffInfo => ({
  file,
  status,
  additions: 1,
  deletions: 1,
  patch: patch('@@ -1 +1 @@', '-a', '+b'),
  ...extra,
});

describe('toEntries', () => {
  it('lists the rows relative to the served folder, sorted, with /', () => {
    const { entries, dropped } = toEntries(
      [row('src/b.ts'), row('src/a.ts', 'added')],
      '/repo',
      '/repo',
      path.posix,
    );
    expect(dropped).toBe(0);
    expect(entries.map((entry) => entry.file.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(entries[0]).toMatchObject({
      absolute: '/repo/src/a.ts',
      raw: 'src/a.ts',
      file: { status: 'added', additions: 1, deletions: 1, binary: false },
    });
  });

  it('shows win32 paths with / and keeps the absolute one native', () => {
    const { entries } = toEntries([row('src/a.ts')], 'C:\\repo', 'C:\\repo', path.win32);
    expect(entries[0]?.file.path).toBe('src/a.ts');
    expect(entries[0]?.absolute).toBe('C:\\repo\\src\\a.ts');
  });

  it('places the rows by the project root and shows them relative to the served subfolder', () => {
    const { entries, dropped } = toEntries(
      [row('sub/x.ts'), row('other/y.ts')],
      '/repo/sub',
      '/repo',
      path.posix,
    );
    expect(entries.map((entry) => entry.file.path)).toEqual(['x.ts']);
    expect(entries[0]?.absolute).toBe('/repo/sub/x.ts');
    expect(dropped).toBe(1);
  });

  it('drops a row that escapes the folder, is absolute, empty or has a NUL', () => {
    const rows = [
      row('../secret.ts'),
      row('src/../../secret.ts'),
      row('/etc/passwd'),
      row(''),
      row('src/a\0.ts'),
      row('src/ok.ts'),
    ];
    const { entries, dropped } = toEntries(rows, '/repo', '/repo', path.posix);
    expect(entries.map((entry) => entry.file.path)).toEqual(['src/ok.ts']);
    expect(dropped).toBe(5);
  });

  it('drops absolute paths of another drive on win32', () => {
    const { entries, dropped } = toEntries(
      [row('D:\\other\\x.ts'), row('..\\up.ts'), row('src\\ok.ts')],
      'C:\\repo',
      'C:\\repo',
      path.win32,
    );
    expect(entries.map((entry) => entry.file.path)).toEqual(['src/ok.ts']);
    expect(dropped).toBe(2);
  });

  it('drops everything when the root is unknown', () => {
    const { entries, dropped } = toEntries([row('a.ts')], '/repo', undefined, path.posix);
    expect(entries).toEqual([]);
    expect(dropped).toBe(1);
  });

  it('keeps the first of two rows for the same path', () => {
    const { entries } = toEntries(
      [row('a.ts', 'modified', { additions: 7 }), row('a.ts', 'modified', { additions: 9 })],
      '/repo',
      '/repo',
      path.posix,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.file.additions).toBe(7);
  });

  it('marks a file without a text diff: an empty patch, or a header cut for size', () => {
    const { entries } = toEntries(
      [
        row('logo.png', 'added', { patch: '', additions: 0, deletions: 0 }),
        row('big.sql', 'modified', { patch: patch(), additions: 900, deletions: 3 }),
        row('empty.txt', 'added', { patch: patch(), additions: 0, deletions: 0 }),
        row('text.ts'),
      ],
      '/repo',
      '/repo',
      path.posix,
    );
    const binary = Object.fromEntries(entries.map((entry) => [entry.file.path, entry.file.binary]));
    expect(binary).toEqual({
      'big.sql': true,
      'empty.txt': false,
      'logo.png': true,
      'text.ts': false,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// createSessionDiffs
// ---------------------------------------------------------------------------------------------

/** What a test can change about the fake server and the controller state around the module. */
interface Scenario {
  users: string[];
  rows: FileDiffInfo[];
  subpath: string;
  /** `location.directory` the session reports; the served folder when absent. */
  location: string | undefined;
  /** Held back until the test calls `release()`: lets a test change the world mid-load. */
  gate: Promise<void> | undefined;
  /** Held back on the `asc` read of the first user message, before anything is cached. */
  listGate: Promise<void> | undefined;
  failure: object | undefined;
}

/** Builds the module over a fake client; returns the module, what it did and the knobs. */
function build(overrides: Partial<Scenario> = {}, served = '/repo') {
  const scenario: Scenario = {
    users: ['msg_1'],
    rows: [row('src/a.ts')],
    subpath: '',
    location: undefined,
    gate: undefined,
    listGate: undefined,
    failure: undefined,
    ...overrides,
  };
  const diffs: SessionDiffInput[] = [];
  const reads: string[] = [];
  const posted: HostToWebview[] = [];
  const logs: string[] = [];
  const state: {
    open: string | undefined;
    client: object | undefined;
    folder: string | undefined;
  } = { open: 'ses_1', client: {}, folder: served };
  const api = {
    session: {
      get: () => {
        reads.push('session.get');
        return Promise.resolve({
          subpath: scenario.subpath,
          location: { directory: scenario.location ?? served },
        });
      },
      diff: async (input: SessionDiffInput) => {
        diffs.push(input);
        // Only the list (`context: 0`) waits: a complete-patch read during a load must not.
        if (scenario.gate !== undefined && input.context === 0) await scenario.gate;
        if (scenario.failure !== undefined) {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw scenario.failure;
        }
        return scenario.rows;
      },
    },
    message: {
      list: async (input: { order?: string; type?: string; limit?: number }) => {
        reads.push(`message.list ${input.type ?? ''} ${input.order ?? ''} ${String(input.limit)}`);
        if (scenario.listGate !== undefined && input.order === 'asc') await scenario.listGate;
        const ordered = input.order === 'desc' ? [...scenario.users].reverse() : scenario.users;
        return { data: ordered.slice(0, input.limit).map((id) => ({ id })) };
      },
    },
  };
  state.client = api;
  const deps: SessionDiffsDeps = {
    client: () => state.client as ChatApi | undefined,
    folder: () => state.folder,
    open: () => state.open,
    post: (message) => posted.push(message),
    log: {
      info: (m) => logs.push(`info: ${m}`),
      warn: (m) => logs.push(`warn: ${m}`),
      error: (m) => logs.push(`error: ${m}`),
      debug: (m) => logs.push(`debug: ${m}`),
    },
    describe: (error) => ({
      code: (error as { _tag?: string })._tag ?? 'Unknown',
      message: 'scrubbed',
    }),
    impl: path.posix,
  };
  return { module: createSessionDiffs(deps), scenario, diffs, reads, posted, logs, state };
}

/** The `session.diff` messages posted so far. */
const lists = (posted: HostToWebview[]) =>
  posted.flatMap((message) => (message.type === 'session.diff' ? [message] : []));

describe('createSessionDiffs: loading the list', () => {
  it('reads the range of the whole session and publishes the files with context 0', async () => {
    const { module, diffs, reads, posted, logs } = build({ users: ['msg_1', 'msg_2', 'msg_3'] });
    await module.request('ses_1');
    expect(reads).toEqual(['message.list user asc 1', 'message.list user desc 1', 'session.get']);
    expect(diffs).toEqual([{ sessionID: 'ses_1', from: 'msg_1', to: 'msg_3', context: 0 }]);
    expect(lists(posted)).toEqual([
      {
        type: 'session.diff',
        sessionID: 'ses_1',
        files: [
          { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 1, binary: false },
        ],
      },
    ]);
    expect(logs).toContain('info: session diff: 1 files for ses_1');
  });

  it('leaves out `to` when the session has a single user message', async () => {
    const { module, diffs } = build({ users: ['msg_1'] });
    await module.request('ses_1');
    expect(diffs).toEqual([{ sessionID: 'ses_1', from: 'msg_1', context: 0 }]);
  });

  it('asks nothing and says nothing for a session with no user message', async () => {
    const { module, diffs, posted } = build({ users: [] });
    await module.request('ses_1');
    expect(diffs).toEqual([]);
    expect(posted).toEqual([]);
  });

  it('does not read the session (for its subpath) when nothing changed', async () => {
    const { module, reads } = build({ rows: [] });
    await module.request('ses_1');
    expect(reads).not.toContain('session.get');
  });

  it('caches the subpath and the first user message across loads', async () => {
    const { module, reads } = build();
    await module.request('ses_1');
    await module.request('ses_1');
    expect(reads.filter((read) => read === 'session.get')).toHaveLength(1);
    expect(reads.filter((read) => read === 'message.list user asc 1')).toHaveLength(1);
    expect(reads.filter((read) => read === 'message.list user desc 1')).toHaveLength(2);
  });

  it('forgets the cached first message when a revert was committed', async () => {
    const { module, reads } = build();
    await module.request('ses_1');
    module.forgetRange('ses_1');
    await module.request('ses_1');
    expect(reads.filter((read) => read === 'message.list user asc 1')).toHaveLength(2);
  });

  it('places the rows by the location the server reports, not by the served folder', async () => {
    // A location at the repository root with no subpath is a shape NOT observed: the real server
    // (2.0.32, `realOpencode.test.ts`) reports the subfolder plus a subpath, see `diffRoot`. Kept
    // to prove that the rows outside the served folder are dropped whatever the location says.
    const { module, posted } = build(
      { location: '/repo', rows: [row('sub/x.ts'), row('elsewhere/y.ts')] },
      '/repo/sub',
    );
    await module.request('ses_1');
    expect(lists(posted)[0]?.files.map((file) => file.path)).toEqual(['x.ts']);
  });

  it('goes up from the location by the subpath it reports', async () => {
    const { module, posted } = build(
      { location: '/repo/sub', subpath: 'sub', rows: [row('sub/x.ts'), row('elsewhere/y.ts')] },
      '/repo/sub',
    );
    await module.request('ses_1');
    expect(lists(posted)[0]?.files.map((file) => file.path)).toEqual(['x.ts']);
  });

  it('lists nothing when the subpath contradicts the location', async () => {
    const { module, posted } = build(
      { location: '/repo/sub', subpath: 'other', rows: [row('sub/x.ts')] },
      '/repo/sub',
    );
    await module.request('ses_1');
    expect(lists(posted)).toEqual([]);
  });

  it('does not post a list that did not change, and posts the next one that did', async () => {
    const { module, scenario, posted } = build();
    await module.request('ses_1');
    await module.request('ses_1');
    expect(lists(posted)).toHaveLength(1);
    scenario.rows = [row('src/a.ts', 'modified', { additions: 5 })];
    await module.request('ses_1');
    expect(lists(posted)).toHaveLength(2);
    scenario.rows = [];
    await module.request('ses_1');
    expect(lists(posted).at(-1)?.files).toEqual([]);
  });

  it('turns a burst of requests into at most one more load', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { module, diffs } = build({ gate });
    const runs = [1, 2, 3, 4, 5].map(() => module.request('ses_1'));
    release();
    await Promise.all(runs);
    expect(diffs.length).toBeLessThanOrEqual(2);
    expect(diffs.length).toBeGreaterThanOrEqual(1);
  });

  it('does not publish a load whose server went away meanwhile (reset)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { module, posted } = build({ gate });
    const run = module.request('ses_1');
    await Promise.resolve();
    module.reset();
    release();
    await run;
    expect(posted).toEqual([]);
  });

  it('does not publish a load for a session that is no longer open', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { module, posted, state } = build({ gate });
    const run = module.request('ses_1');
    await Promise.resolve();
    state.open = 'ses_2';
    release();
    await run;
    expect(posted).toEqual([]);
  });

  it('loads nothing without a client, a folder or the session open', async () => {
    const closed = build();
    closed.state.open = 'ses_other';
    await closed.module.request('ses_1');
    const noClient = build();
    noClient.state.client = undefined;
    await noClient.module.request('ses_1');
    const noFolder = build();
    noFolder.state.folder = undefined;
    await noFolder.module.request('ses_1');
    for (const run of [closed, noClient, noFolder]) {
      expect(run.diffs).toEqual([]);
      expect(run.posted).toEqual([]);
    }
  });

  it('keeps the previous list and posts the scrubbed error when a load fails', async () => {
    const { module, scenario, posted, logs } = build();
    await module.request('ses_1');
    scenario.failure = { _tag: 'InvalidRequestError', message: 'http://127.0.0.1:1/secret' };
    await module.request('ses_1');
    const last = lists(posted).at(-1);
    expect(last?.files.map((file) => file.path)).toEqual(['src/a.ts']);
    expect(last?.error).toEqual({ code: 'InvalidRequestError', message: 'scrubbed' });
    expect(logs).toContain('warn: session diff failed: InvalidRequestError');
  });

  it('clears the error when a later load succeeds with the same list', async () => {
    // Regression of review #1157 B1: the identical list was not posted again, so "Could not
    // refresh the list" stayed on screen after the load recovered.
    const { module, scenario, posted } = build();
    await module.request('ses_1');
    scenario.failure = { _tag: 'InvalidRequestError' };
    await module.request('ses_1');
    await module.request('ses_1');
    expect(lists(posted)).toHaveLength(2);
    scenario.failure = undefined;
    await module.request('ses_1');
    const sent = lists(posted);
    expect(sent).toHaveLength(3);
    expect(sent[2]?.error).toBeUndefined();
    expect(sent[2]?.files.map((file) => file.path)).toEqual(['src/a.ts']);
    await module.request('ses_1');
    expect(lists(posted)).toHaveLength(3);
  });

  it('does not let a load cut off by reset refill the caches', async () => {
    // Regression of review #1157 W5: the first user message read by a stale load was cached after
    // reset() had cleared it.
    let release: () => void = () => undefined;
    const listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { module, reads } = build({ listGate });
    const run = module.request('ses_1');
    await Promise.resolve();
    module.reset();
    release();
    await run;
    await module.request('ses_1');
    expect(reads.filter((read) => read === 'message.list user asc 1')).toHaveLength(2);
  });

  it('tells the subscribers when the list or the start of the range changed, not otherwise', async () => {
    const { module, scenario } = build();
    const renewed: string[] = [];
    const off = module.onRenewed((sessionID) => renewed.push(sessionID));
    await module.request('ses_1');
    await module.request('ses_1');
    expect(renewed).toEqual([]);
    scenario.rows = [row('src/a.ts'), row('src/b.ts')];
    await module.request('ses_1');
    expect(renewed).toEqual(['ses_1']);
    scenario.users = ['msg_9'];
    module.forgetRange('ses_1');
    await module.request('ses_1');
    expect(renewed).toEqual(['ses_1', 'ses_1']);
    off();
    scenario.rows = [];
    await module.request('ses_1');
    expect(renewed).toHaveLength(2);
  });

  it('is silent when the session no longer exists', async () => {
    const { module, posted } = build({ failure: { _tag: 'SessionNotFoundError' } });
    await module.request('ses_1');
    expect(posted).toEqual([]);
  });

  it('sends the held list again on request, but not an empty one', async () => {
    const { module, scenario, posted } = build();
    await module.request('ses_1');
    module.resend('ses_1');
    module.resend('ses_other');
    expect(lists(posted)).toHaveLength(2);
    scenario.rows = [];
    await module.request('ses_1');
    module.resend('ses_1');
    expect(lists(posted)).toHaveLength(3);
  });

  it('forgets a deleted session, and everything on reset', async () => {
    const { module, reads } = build();
    await module.request('ses_1');
    module.forget('ses_1');
    module.resend('ses_1');
    expect(module.target('ses_1', 'src/a.ts')).toEqual({ ok: false, reason: 'session not open' });
    await module.request('ses_1');
    expect(reads.filter((read) => read === 'session.get')).toHaveLength(2);
    module.reset();
    expect(module.target('ses_1', 'src/a.ts')).toEqual({ ok: false, reason: 'session not open' });
  });
});

describe('createSessionDiffs: what may be opened', () => {
  it('accepts a listed path of the open session, with the absolute path', async () => {
    const { module } = build({ rows: [row('src/a.ts', 'deleted')] });
    await module.request('ses_1');
    expect(module.target('ses_1', 'src/a.ts')).toEqual({
      ok: true,
      target: {
        sessionID: 'ses_1',
        path: 'src/a.ts',
        absolute: '/repo/src/a.ts',
        status: 'deleted',
        binary: false,
      },
    });
  });

  it('refuses a path that was not listed, including ones that escape the folder', async () => {
    const { module } = build({ rows: [row('../secret.ts'), row('src/a.ts')] });
    await module.request('ses_1');
    for (const wanted of ['../secret.ts', '/etc/passwd', 'src/b.ts', 'src/a.ts/', '']) {
      expect(module.target('ses_1', wanted), wanted).toEqual({ ok: false, reason: 'not listed' });
    }
  });

  it('refuses a listed path of another session or of a session that is not the open one', async () => {
    const { module, state } = build();
    await module.request('ses_1');
    expect(module.target('ses_2', 'src/a.ts')).toEqual({ ok: false, reason: 'session not open' });
    state.open = 'ses_2';
    expect(module.target('ses_1', 'src/a.ts')).toEqual({ ok: false, reason: 'session not open' });
  });
});

describe('createSessionDiffs: the original text', () => {
  const FULL = patch('@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three');

  it('asks the complete patch once, rebuilds the original and reuses it', async () => {
    const { module, scenario, diffs } = build({ users: ['msg_1', 'msg_2'] });
    scenario.rows = [row('src/a.ts', 'modified', { patch: FULL })];
    await module.request('ses_1');
    expect(await module.original('ses_1', 'src/a.ts')).toBe('one\ntwo\nthree\n');
    expect(await module.original('ses_1', 'src/a.ts')).toBe('one\ntwo\nthree\n');
    expect(diffs).toHaveLength(2);
    expect(diffs[1]).toEqual({ sessionID: 'ses_1', from: 'msg_1', to: 'msg_2' });
  });

  it('asks again after a new request (a change signal), not before', async () => {
    const { module, scenario, diffs } = build();
    scenario.rows = [row('src/a.ts', 'modified', { patch: FULL })];
    await module.request('ses_1');
    await module.original('ses_1', 'src/a.ts');
    await module.request('ses_1');
    await module.original('ses_1', 'src/a.ts');
    expect(diffs.filter((input) => input.context === undefined)).toHaveLength(2);
  });

  it('shares one request between two opens at the same time', async () => {
    const { module, scenario, diffs } = build();
    scenario.rows = [
      row('src/a.ts', 'modified', { patch: FULL }),
      row('src/b.ts', 'modified', { patch: FULL }),
    ];
    await module.request('ses_1');
    await Promise.all([module.original('ses_1', 'src/a.ts'), module.original('ses_1', 'src/b.ts')]);
    expect(diffs.filter((input) => input.context === undefined)).toHaveLength(1);
  });

  it('gives the empty text of an added file without asking for the patch', async () => {
    const { module, scenario, diffs } = build();
    scenario.rows = [row('src/new.ts', 'added')];
    await module.request('ses_1');
    expect(await module.original('ses_1', 'src/new.ts')).toBe('');
    expect(diffs).toHaveLength(1);
  });

  it('does not serve a patch set fetched during a load to the list that load publishes', async () => {
    // Regression of review #1157 W1: a file opened while a load ran cached the OLD range's
    // patches, and a file the new list added then failed with NoTextDiff.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { module, scenario } = build();
    scenario.rows = [row('src/a.ts', 'modified', { patch: FULL })];
    await module.request('ses_1');
    scenario.gate = gate;
    const run = module.request('ses_1');
    await Promise.resolve();
    expect(await module.original('ses_1', 'src/a.ts')).toBe('one\ntwo\nthree\n');
    scenario.rows = [
      row('src/a.ts', 'modified', { patch: FULL }),
      row('src/b.ts', 'modified', { patch: FULL }),
    ];
    release();
    await run;
    expect(await module.original('ses_1', 'src/b.ts')).toBe('one\ntwo\nthree\n');
  });

  it('rejects with NoTextDiff when the server sent no text for the file', async () => {
    const { module, scenario } = build();
    scenario.rows = [row('logo.png', 'modified', { patch: '', additions: 0, deletions: 0 })];
    await module.request('ses_1');
    await expect(module.original('ses_1', 'logo.png')).rejects.toMatchObject({
      name: 'NoTextDiff',
    });
  });

  it('rejects with DiffNotListed for a path that is not listed', async () => {
    const { module } = build();
    await module.request('ses_1');
    await expect(module.original('ses_1', '../x')).rejects.toMatchObject({
      name: 'DiffNotListed',
    });
  });

  it('does not keep a failed read: the next open asks again', async () => {
    const { module, scenario, diffs } = build();
    scenario.rows = [row('src/a.ts', 'modified', { patch: FULL })];
    await module.request('ses_1');
    scenario.failure = { _tag: 'InvalidRequestError' };
    await expect(module.original('ses_1', 'src/a.ts')).rejects.toBeDefined();
    scenario.failure = undefined;
    expect(await module.original('ses_1', 'src/a.ts')).toBe('one\ntwo\nthree\n');
    expect(diffs.filter((input) => input.context === undefined)).toHaveLength(2);
  });
});
