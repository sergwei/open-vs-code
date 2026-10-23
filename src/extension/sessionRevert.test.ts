// Protects the prepared-revert state of the host (issue #32) against: a boundary that is not known
// synchronously (the "Changed files" load that follows an event would not be bounded), the same
// state posted twice, a mapping that finishes after a newer call and overwrites it, a file outside
// the served folder becoming openable, and the "what the revert undid" original being the wrong
// side of the patch. Provenance: FABRICATED `SessionRevert` rows in the unified-patch format READ in
// `vcs/patch.ts` @843a6c51 (complete-file patches, the old side being the text BEFORE the revert),
// with `path.posix` and `path.win32`; no server and no VS Code. The real server's `files` were only
// ever seen empty (`realOpencode.test.ts`).
import path from 'node:path';
import type { FileDiffInfo, SessionRevert } from '@opencode/client';
import { describe, expect, it } from 'vitest';
import type { HostToWebview } from '../shared/protocol';
import { createSessionReverts } from './sessionRevert';

/** A complete-file patch of `a.ts`: the old side is `one\ntwo\n`, the new one `one\nTWO\n`. */
const PATCH =
  'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n';

const row = (file: string, extra: Partial<FileDiffInfo> = {}): FileDiffInfo => ({
  file,
  status: 'modified',
  additions: 1,
  deletions: 1,
  patch: PATCH,
  ...extra,
});

const revertOf = (files: FileDiffInfo[], messageID = 'msg_2'): SessionRevert => ({
  messageID,
  files,
});

/** Builds the module over fakes; `rootFor` can be replaced to hold or break the lookup. */
function build(
  options: {
    served?: string;
    impl?: typeof path.posix;
    rootFor?: (sessionID: string) => Promise<string | undefined>;
    open?: string;
  } = {},
) {
  const served = options.served ?? '/repo';
  const posted: HostToWebview[] = [];
  const logs: string[] = [];
  const state: { open: string | undefined } = { open: options.open ?? 'ses_1' };
  const module = createSessionReverts({
    folder: () => served,
    open: () => state.open,
    rootFor: options.rootFor ?? (() => Promise.resolve(served)),
    post: (message) => posted.push(message),
    log: {
      info: (m) => logs.push(`info: ${m}`),
      warn: (m) => logs.push(`warn: ${m}`),
      error: (m) => logs.push(`error: ${m}`),
      debug: (m) => logs.push(`debug: ${m}`),
    },
    impl: options.impl ?? path.posix,
  });
  return { module, posted, logs, state };
}

const posts = (posted: HostToWebview[]) =>
  posted.flatMap((message) => (message.type === 'session.revert' ? [message] : []));

describe('createSessionReverts', () => {
  it('maps the files of a revert and publishes them once', async () => {
    const { module, posted } = build();
    const revert = revertOf([row('a.ts'), row('src/b.ts', { status: 'added' })]);
    const state = await module.apply('ses_1', revert, { post: true });
    expect(state).toEqual({
      messageID: 'msg_2',
      files: [
        {
          path: 'a.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
          binary: false,
          tooLarge: false,
        },
        {
          path: 'src/b.ts',
          status: 'added',
          additions: 1,
          deletions: 1,
          binary: false,
          tooLarge: false,
        },
      ],
    });
    expect(posts(posted)).toEqual([{ type: 'session.revert', sessionID: 'ses_1', revert: state }]);
    // The same state again (the staged event after the answer of `stage`) says nothing.
    await module.apply('ses_1', revert, { post: true });
    expect(posts(posted)).toHaveLength(1);
  });

  it('knows the boundary at once, before the files are placed', async () => {
    let release: (root: string) => void = () => undefined;
    const { module } = build({
      rootFor: () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    });
    const pending = module.apply('ses_1', revertOf([row('a.ts')], 'msg_7'), { post: true });
    expect(module.boundary('ses_1')).toBe('msg_7');
    expect(module.boundary('ses_other')).toBeUndefined();
    release('/repo');
    await pending;
    expect(module.boundary('ses_1')).toBe('msg_7');
  });

  it('posts an absent revert once when it goes away, and nothing when there never was one', async () => {
    const { module, posted } = build();
    await module.apply('ses_1', undefined, { post: true });
    expect(posts(posted)).toEqual([]);
    await module.apply('ses_1', revertOf([]), { post: true });
    await module.apply('ses_1', undefined, { post: true });
    await module.apply('ses_1', undefined, { post: true });
    expect(posts(posted)).toEqual([
      { type: 'session.revert', sessionID: 'ses_1', revert: { messageID: 'msg_2', files: [] } },
      { type: 'session.revert', sessionID: 'ses_1' },
    ]);
    expect(module.boundary('ses_1')).toBeUndefined();
  });

  it('records what a snapshot carries without posting it, and posts only a different state after', async () => {
    const { module, posted } = build();
    const carried = await module.apply('ses_1', revertOf([row('a.ts')]), { post: false });
    expect(posted).toEqual([]);
    // Same state: nothing. A newer one applied while the snapshot was built: posted.
    module.resend('ses_1', carried);
    expect(posted).toEqual([]);
    await module.apply('ses_1', undefined, { post: true });
    expect(posts(posted)).toEqual([{ type: 'session.revert', sessionID: 'ses_1' }]);
    module.resend('ses_1', carried);
    expect(posts(posted)).toHaveLength(2);
    expect(posts(posted)[1]).toEqual({ type: 'session.revert', sessionID: 'ses_1' });
  });

  it('lets the newest call win when an older mapping finishes after it', async () => {
    const releases: Array<(root: string) => void> = [];
    const { module, posted } = build({
      rootFor: () =>
        new Promise<string>((resolve) => {
          releases.push(resolve);
        }),
    });
    const first = module.apply('ses_1', revertOf([row('a.ts')]), { post: true });
    const second = module.apply('ses_1', undefined, { post: true });
    releases[0]?.('/repo');
    expect(await first).toBeUndefined();
    expect(await second).toBeUndefined();
    expect(posts(posted)).toEqual([]);
    expect(module.boundary('ses_1')).toBeUndefined();
  });

  it('does not publish a mapping cut off by reset, or for a session that is not open', async () => {
    let release: (root: string) => void = () => undefined;
    const { module, posted, state } = build({
      rootFor: () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    });
    const pending = module.apply('ses_1', revertOf([row('a.ts')]), { post: true });
    module.reset();
    release('/repo');
    expect(await pending).toBeUndefined();
    expect(posted).toEqual([]);
    state.open = 'ses_2';
    expect(await module.apply('ses_1', revertOf([row('a.ts')]), { post: true })).toBeUndefined();
    expect(module.boundary('ses_1')).toBeUndefined();
  });

  it('keeps the revert, with no files, when the folder cannot be placed', async () => {
    const { module, logs } = build({ rootFor: () => Promise.reject(new Error('boom')) });
    const state = await module.apply('ses_1', revertOf([row('a.ts')]), { post: true });
    expect(state).toEqual({ messageID: 'msg_2', files: [] });
    expect(logs.some((line) => line.startsWith('warn: revert files could not be placed'))).toBe(
      true,
    );
    // A root that is unknown drops every row instead.
    const unknown = build({ rootFor: () => Promise.resolve(undefined) });
    expect(
      (await unknown.module.apply('ses_1', revertOf([row('a.ts')]), { post: true }))?.files,
    ).toEqual([]);
  });

  it('drops a row outside the served folder, absolute, or with a NUL, and never lists it', async () => {
    const { module, logs } = build();
    const state = await module.apply(
      'ses_1',
      revertOf([row('../outside.ts'), row('/etc/passwd'), row('x\0.ts'), row('ok.ts')]),
      { post: true },
    );
    expect(state?.files.map((file) => file.path)).toEqual(['ok.ts']);
    expect(logs).toContain('debug: revert: 3 file(s) outside the folder');
    expect(module.target('ses_1', '../outside.ts')).toEqual({ ok: false, reason: 'not listed' });
    expect(logs.join('\n')).not.toContain('passwd');
  });

  it('places a win32 path by the root and shows it with /', async () => {
    const { module } = build({
      served: 'C:\\repo',
      impl: path.win32,
      rootFor: () => Promise.resolve('C:\\repo'),
    });
    const state = await module.apply('ses_1', revertOf([row('src/a.ts')]), { post: true });
    expect(state?.files.map((file) => file.path)).toEqual(['src/a.ts']);
    const target = module.target('ses_1', 'src/a.ts');
    expect(target).toMatchObject({ ok: true, target: { absolute: 'C:\\repo\\src\\a.ts' } });
  });

  it('whitelists the listed paths of the open session, as targets of the reverted side', async () => {
    const { module, state } = build();
    await module.apply(
      'ses_1',
      revertOf([row('a.ts'), row('logo.png', { patch: '', additions: 0, deletions: 0 })]),
      {
        post: true,
      },
    );
    expect(module.target('ses_1', 'a.ts')).toEqual({
      ok: true,
      target: {
        sessionID: 'ses_1',
        path: 'a.ts',
        absolute: '/repo/a.ts',
        status: 'modified',
        binary: false,
        side: 'reverted',
      },
    });
    expect(module.target('ses_1', 'logo.png')).toMatchObject({
      ok: true,
      target: { binary: true },
    });
    expect(module.target('ses_1', 'never.ts')).toEqual({ ok: false, reason: 'not listed' });
    expect(module.target('ses_other', 'a.ts')).toEqual({ ok: false, reason: 'session not open' });
    state.open = 'ses_2';
    expect(module.target('ses_1', 'a.ts')).toEqual({ ok: false, reason: 'session not open' });
  });

  it('gives the text before the revert: the OLD side of the patch', async () => {
    const { module } = build();
    await module.apply(
      'ses_1',
      revertOf([
        row('a.ts'),
        row('made.ts', { status: 'added' }),
        row('logo.png', { patch: '', additions: 0, deletions: 0 }),
      ]),
      { post: true },
    );
    expect(await module.original('ses_1', 'a.ts')).toBe('one\ntwo\n');
    expect(await module.original('ses_1', 'made.ts')).toBe('');
    await expect(module.original('ses_1', 'logo.png')).rejects.toMatchObject({
      name: 'NoTextDiff',
    });
    await expect(module.original('ses_1', 'never.ts')).rejects.toMatchObject({
      name: 'DiffNotListed',
    });
  });

  it('forgets a session, and everything on reset', async () => {
    const { module } = build();
    await module.apply('ses_1', revertOf([row('a.ts')]), { post: true });
    module.forget('ses_1');
    expect(module.boundary('ses_1')).toBeUndefined();
    expect(module.target('ses_1', 'a.ts')).toEqual({ ok: false, reason: 'session not open' });
    await module.apply('ses_1', revertOf([row('a.ts')]), { post: true });
    module.reset();
    expect(module.state('ses_1')).toBeUndefined();
    expect(module.boundary('ses_1')).toBeUndefined();
  });
});
