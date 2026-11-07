// Tests of the pure state of the work mode (E3-work-mode). Every input is fabricated: they protect
// the decision logic (chains, exceptions, bounds), not what a real server emits or asks.

import { describe, expect, it } from 'vitest';
import { createWorkModes, keepsForUser, MAX_ANSWERED_IDS, AUTO_RETRY_DELAYS_MS } from './workMode';

const ask = (action: string, ...resources: string[]) => ({ id: 'p1', action, resources });

describe('keepsForUser', () => {
  /**
   * Protects: Auto must not read the secrets of decision `secretos-y-borrados` (env files and the
   * common key and credential files), go outside the project (`external_directory`, which the
   * earlier decision approved) or answer a `doom_loop`.
   */
  it('keeps secrets, external_directory and doom_loop for the user', () => {
    for (const resource of [
      '.env',
      'config/.env.local',
      'C:\\ws\\.ENV',
      'a.env.d/x',
      '.env.production',
      '.envrc',
      'project/.envrc',
      '/home/me/.kube/config',
      '/home/me/.config/gh/hosts.yml',
      'id_rsa',
      '/home/me/.ssh/id_ed25519',
      'id_ecdsa.pub',
      'id_dsa',
      'certs/server.pem',
      'server.KEY',
      'store.p12',
      'store.pfx',
      'credentials.json',
      'credentials-prod.json',
      '.npmrc',
      '.pypirc',
      '.netrc',
      '.git-credentials',
      'C:\\Users\\me\\.aws\\credentials',
      '/home/me/.docker/config.json',
      'vault.kdbx',
    ]) {
      expect(keepsForUser(ask('read', resource)), resource).toBe(true);
    }
    expect(keepsForUser(ask('read', 'src/a.ts', '.env'))).toBe(true);
    expect(keepsForUser(ask('doom_loop'))).toBe(true);
    expect(keepsForUser(ask('external_directory', '/home/x/*'))).toBe(true);
  });

  /** Protects: the exceptions stay narrow; `.env.example` is the allowed one and a plain config is not a secret. */
  it('approves what is none of those', () => {
    for (const a of [
      ask('read', 'src/a.ts'),
      ask('read', '.env.example'),
      ask('read', 'config/.env.example'),
      ask('read', 'environment.ts'),
      ask('read', 'package.json'),
      ask('read', 'config.json'),
      ask('read', 'keys.txt'),
      ask('edit', '.env'),
    ]) {
      expect(keepsForUser(a), `${a.action} ${a.resources.join(' ')}`).toBe(false);
    }
  });
});

describe('keepsForUser: shell and edit (nunca-destructivo)', () => {
  /** Protects: Auto must never approve a destructive command, whichever resource of the request holds it. */
  it('keeps destructive shell commands for the user, any resource of the request', () => {
    expect(keepsForUser(ask('shell', 'rm -rf build'))).toBe(true);
    expect(keepsForUser(ask('shell', 'ls', 'git reset --hard'))).toBe(true);
    expect(keepsForUser(ask('shell', 'bash -c "ls"'))).toBe(true);
    expect(keepsForUser(ask('shell', 'npm test'))).toBe(false);
    expect(keepsForUser(ask('shell', 'git status', 'echo rm -rf x'))).toBe(false);
  });

  /** Protects: a secret named as an argument of a shell command asks (decision `secretos-y-borrados` 1 and 3). */
  it('keeps destructive shell commands and shell secrets for the user, any resource of the request', () => {
    for (const command of ['cat .env', 'type .env', 'Get-Content .env', 'cat ~/.ssh/id_rsa']) {
      expect(keepsForUser(ask('shell', 'ls', command)), command).toBe(true);
    }
    expect(keepsForUser(ask('shell', 'cat .env.example'))).toBe(false);
  });

  /**
   * Protects: Auto fails CLOSED on a deletion (decision `secretos-y-borrados` 2): a delete, a Move,
   * a status or a `files` shape it does not know, all ask; the shapes of `edit`, `write` and a
   * patch that adds or modifies (read in the v2.0.32 tag) are approved. Fabricated metadata.
   */
  it('keeps an edit that deletes, moves or has an unknown shape and approves one that creates or modifies', () => {
    const edit = (metadata?: { [key: string]: unknown }, ...resources: string[]) => ({
      ...ask('edit', ...(resources.length > 0 ? resources : ['src/a.ts'])),
      ...(metadata === undefined ? {} : { metadata }),
    });
    // A Move to: two resources (the original and the target), one entry with status `modified`.
    expect(
      keepsForUser(edit({ files: [{ file: 'b', status: 'modified' }] }, 'src/a.ts', 'src/b.ts')),
    ).toBe(true);
    expect(keepsForUser(edit({ files: [{ file: 'a', status: 'renamed' }] }))).toBe(true);
    expect(keepsForUser(edit({ files: [{ file: 'a' }] }))).toBe(true);
    expect(keepsForUser(edit({ files: ['a'] }))).toBe(true);
    expect(keepsForUser(edit({ files: [] }))).toBe(true);
    expect(keepsForUser(edit({ diff: '--- a' }))).toBe(true);
    expect(keepsForUser(edit({}))).toBe(false);
    expect(
      keepsForUser(
        edit(
          {
            files: [
              { file: 'a', status: 'modified' },
              { file: 'b', status: 'added' },
            ],
          },
          'src/a.ts',
          'src/b.ts',
        ),
      ),
    ).toBe(false);
    expect(keepsForUser(edit({ files: [{ file: 'a', status: 'deleted' }] }))).toBe(true);
    expect(
      keepsForUser(
        edit({
          files: [
            { file: 'a', status: 'modified' },
            { file: 'b', status: 'deleted' },
          ],
        }),
      ),
    ).toBe(true);
    expect(keepsForUser(edit({ files: [{ file: 'a', status: 'added' }] }))).toBe(false);
    expect(keepsForUser(edit({ files: [{ file: 'a', status: 'modified' }] }))).toBe(false);
    expect(keepsForUser(edit())).toBe(false);
    expect(keepsForUser(edit({ files: 'deleted' }))).toBe(true); // was approved before the fix of W2
  });
});

describe('createWorkModes', () => {
  it('follows the root through the chain and lets a session override it', () => {
    const modes = createWorkModes();
    modes.setSession('root', 'auto');
    expect(modes.modeFor(['child', 'root'])).toBe('auto');
    expect(modes.modeFor(['grandchild', 'child', 'root'])).toBe('auto');
    modes.setSession('child', 'manual');
    expect(modes.modeFor(['child', 'root'])).toBe('manual');
    expect(modes.modeFor(['other', 'root'])).toBe('auto');
  });

  it('treats an incomplete chain and an unset session as manual', () => {
    const modes = createWorkModes();
    modes.setSession('root', 'auto');
    expect(modes.modeFor(undefined)).toBe('manual');
    expect(modes.modeFor(['s9'])).toBe('manual');
    expect(modes.shouldAutoApprove(ask('edit', 'a'), undefined)).toBe(false);
  });

  it('auto-approves only in auto mode and not for a request kept for the user', () => {
    const modes = createWorkModes();
    expect(modes.shouldAutoApprove(ask('edit', 'a'), ['s1'])).toBe(false);
    modes.setSession('s1', 'auto');
    expect(modes.shouldAutoApprove(ask('edit', 'a'), ['s1'])).toBe(true);
    expect(modes.shouldAutoApprove(ask('read', '.env'), ['s1'])).toBe(false);
    expect(modes.shouldAutoApprove(ask('edit', 'a'), ['sub', 's1'])).toBe(true);
  });

  it('forgets the mode of a removed session', () => {
    const modes = createWorkModes();
    modes.setSession('s1', 'auto');
    modes.forgetSession('s1');
    expect(modes.modeFor(['s1'])).toBe('manual');
  });

  it('hands the draft of a pane to its first session once', () => {
    const modes = createWorkModes();
    expect(modes.draftOf(3)).toBe('manual');
    modes.setDraft(3, 'auto');
    expect(modes.draftOf(3)).toBe('auto');
    expect(modes.takeDraft(3)).toBe('auto');
    expect(modes.takeDraft(3)).toBeUndefined();
    expect(modes.draftOf(3)).toBe('manual');
    modes.setDraft(4, 'auto');
    modes.forgetPane(4);
    expect(modes.draftOf(4)).toBe('manual');
  });

  it('claims an id once, lets a failed one be claimed again and a released one too', () => {
    const modes = createWorkModes();
    expect(modes.claim('p1')).toBe(true);
    expect(modes.claim('p1')).toBe(false);
    modes.fail('p1');
    expect(modes.isFailed('p1')).toBe(true);
    expect(modes.claim('p1')).toBe(true);
    expect(modes.isFailed('p1')).toBe(false);
    modes.release('p1');
    expect(modes.claim('p1')).toBe(true);
  });

  it('remembers at most MAX_ANSWERED_IDS claimed ids, forgetting the oldest', () => {
    const modes = createWorkModes();
    for (let i = 0; i < MAX_ANSWERED_IDS + 5; i += 1) modes.claim(`p${i}`);
    expect(modes.claim('p0')).toBe(true); // forgotten, so claimable again
    expect(modes.claim(`p${MAX_ANSWERED_IDS + 4}`)).toBe(false); // newest still remembered
  });

  it('retries twice, after one and two seconds', () => {
    expect(AUTO_RETRY_DELAYS_MS).toEqual([1000, 2000]);
  });
});
