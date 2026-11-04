// Tests for `externalServer.ts` (issue #11).
//
// What they protect: which addresses `openVsCode.serverUrl` accepts (loopback only, a bare origin,
// no credential in the URL: Sergio's decision of 2026-10-22), that a password is bound to its
// origin, that an unusable address or a failed connection gets a DISTINCT reason, and that the
// texts that reach the webview carry no URL, port or password. Everything is SYNTHETIC (literal
// strings and hand-built errors): it says nothing about how a real opencode or a real `fetch`
// fails. Against a real server only the good connection and the 401 are covered, by the opt-in
// `realOpencode.test.ts`; the refused connection is covered in a real VS Code by
// `externalServer.test.ts` (integration), against the synthetic fixture. `ForgottenPasswords` is
// the host's guard against VS Code handing back a password right after it was deleted; these
// cases prove its rules with literal values, while the race itself is only reproduced by the
// integration case "Forget Server Password ... stays refused".

import { afterEach, describe, expect, it } from 'vitest';
import {
  describeExternalFailure,
  describeFailureCause,
  failureActionLabel,
  failureActions,
  ForgottenPasswords,
  parseServerUrl,
  sameTarget,
  SERVER_PASSWORD_KEY_PREFIX,
  serverPasswordKey,
  type ServerTarget,
} from './externalServer';
import { fetchServerInfo, ServerInfoError } from './opencodeServer';
import { useEnglish, useSpanish } from './test-fixtures/spanishCatalog';

describe('parseServerUrl', () => {
  it('treats an empty or blank value as "no external server"', () => {
    expect(parseServerUrl('')).toEqual({ kind: 'none' });
    expect(parseServerUrl('   \t ')).toEqual({ kind: 'none' });
  });

  it('accepts http and https on the loopback hosts and normalises to the origin', () => {
    expect(parseServerUrl('http://127.0.0.1:4096')).toEqual({
      kind: 'ok',
      origin: 'http://127.0.0.1:4096',
    });
    expect(parseServerUrl('  http://127.0.0.1:4096/  ')).toEqual({
      kind: 'ok',
      origin: 'http://127.0.0.1:4096',
    });
    expect(parseServerUrl('HTTP://LOCALHOST:4096/')).toEqual({
      kind: 'ok',
      origin: 'http://localhost:4096',
    });
    expect(parseServerUrl('http://[::1]:4096')).toEqual({
      kind: 'ok',
      origin: 'http://[::1]:4096',
    });
    expect(parseServerUrl('https://localhost:8443')).toEqual({
      kind: 'ok',
      origin: 'https://localhost:8443',
    });
    // The default port is dropped by the URL parser: the origin is what travels.
    expect(parseServerUrl('http://127.0.0.1:80')).toEqual({
      kind: 'ok',
      origin: 'http://127.0.0.1',
    });
  });

  it.each([
    ['not a url', 'not a valid URL'],
    ['127.0.0.1:4096', 'not a valid URL'],
    ['localhost:4096', 'must start with http'],
    ['ftp://127.0.0.1:4096', 'must start with http'],
    ['ws://127.0.0.1:4096', 'must start with http'],
    ['http://user:pw@127.0.0.1:4096', 'user name or password'],
    ['http://user@127.0.0.1:4096', 'user name or password'],
    ['http://127.0.0.1:4096/api', 'without a path'],
    ['http://127.0.0.1:4096/?x=1', 'without a path'],
    ['http://127.0.0.1:4096/#frag', 'without a path'],
  ])('rejects %s', (raw, fragment) => {
    const parsed = parseServerUrl(raw);
    expect(parsed.kind).toBe('invalid');
    expect(parsed.kind === 'invalid' ? parsed.message : '').toContain(fragment);
  });

  it.each([
    'http://example.com:4096',
    'http://192.168.1.20:4096',
    'http://10.0.0.5:4096',
    'https://opencode.internal',
    'http://0.0.0.0:4096',
    'http://127.0.0.2:4096',
    'http://[::2]:4096',
    'http://127.0.0.1.evil.test:4096',
    'http://localhost.evil.test:4096',
  ])('rejects the non-loopback host %s with the "this machine" message', (raw) => {
    const parsed = parseServerUrl(raw);
    expect(parsed.kind).toBe('invalid');
    expect(parsed.kind === 'invalid' ? parsed.message : '').toContain('this machine');
  });

  it('never echoes the input in an error message (it may hold a credential)', () => {
    for (const raw of [
      'http://user:s3cret@127.0.0.1:4096',
      'http://s3cret.example.com',
      's3cret',
    ]) {
      const parsed = parseServerUrl(raw);
      expect(parsed.kind).toBe('invalid');
      expect(JSON.stringify(parsed)).not.toContain('s3cret');
    }
  });
});

describe('serverPasswordKey', () => {
  it('binds the key to the origin, so a new host never receives an old password', () => {
    expect(serverPasswordKey('http://127.0.0.1:4096')).toBe(
      `${SERVER_PASSWORD_KEY_PREFIX}http://127.0.0.1:4096`,
    );
    expect(serverPasswordKey('http://127.0.0.1:4096')).not.toBe(
      serverPasswordKey('http://127.0.0.1:4097'),
    );
  });
});

describe('sameTarget', () => {
  const ext = (password: string | undefined, url = 'http://127.0.0.1:1'): ServerTarget => ({
    kind: 'external',
    url,
    password,
  });
  it('compares kind, URL and password; a new password is a different target', () => {
    expect(sameTarget({ kind: 'spawn' }, { kind: 'spawn' })).toBe(true);
    expect(sameTarget({ kind: 'spawn' }, ext('a'))).toBe(false);
    expect(sameTarget(ext('a'), ext('a'))).toBe(true);
    expect(sameTarget(ext('a'), ext('b'))).toBe(false);
    expect(sameTarget(ext('a'), ext(undefined))).toBe(false);
    expect(sameTarget(ext('a'), ext('a', 'http://127.0.0.1:2'))).toBe(false);
    expect(
      sameTarget(
        { kind: 'external-invalid', message: 'x' },
        { kind: 'external-invalid', message: 'x' },
      ),
    ).toBe(true);
    expect(
      sameTarget(
        { kind: 'external-invalid', message: 'x' },
        { kind: 'external-invalid', message: 'y' },
      ),
    ).toBe(false);
    expect(sameTarget({ kind: 'external-invalid', message: 'x' }, { kind: 'spawn' })).toBe(false);
  });
});

describe('describeExternalFailure', () => {
  /** A refused connection as Node's `fetch` reports it: TypeError("fetch failed") with a coded cause. */
  const refused = (code: string): ServerInfoError => {
    const inner = Object.assign(new Error('connect refused 127.0.0.1:4096'), { code });
    const outer = new TypeError('fetch failed', { cause: inner });
    return new ServerInfoError('transport', 'GET /api/info failed: fetch failed', undefined, {
      cause: outer,
    });
  };

  it('maps each way of failing to its own reason', () => {
    expect(describeExternalFailure(refused('ECONNREFUSED'))).toMatchObject({
      reason: 'unreachable',
      message: expect.stringContaining('(ECONNREFUSED)') as string,
    });
    expect(describeExternalFailure(refused('ENOTFOUND')).message).toContain('(ENOTFOUND)');
    expect(describeExternalFailure(new ServerInfoError('unauthorized', 'x', 401)).reason).toBe(
      'unauthorized',
    );
    expect(describeExternalFailure(new ServerInfoError('http-status', 'x', 404)).reason).toBe(
      'unsupported-version',
    );
    expect(describeExternalFailure(new ServerInfoError('malformed', 'x')).reason).toBe(
      'unsupported-version',
    );
    expect(describeExternalFailure(new ServerInfoError('http-status', 'x', 503))).toMatchObject({
      reason: 'unreachable',
      message: expect.stringContaining('HTTP 503') as string,
    });
    expect(describeExternalFailure(new Error('boom')).reason).toBe('unreachable');
  });

  it('reports a timeout as "timeout" and drops a code that does not look like an errno', () => {
    const timeout = new ServerInfoError('transport', 'x', undefined, {
      cause: Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }),
    });
    expect(describeExternalFailure(timeout).message).toContain('(timeout)');
    const odd = new ServerInfoError('transport', 'x', undefined, {
      cause: Object.assign(new Error('x'), { code: 'http://evil.test [x](command:y)' }),
    });
    const message = describeExternalFailure(odd).message;
    expect(message).not.toContain('evil');
    expect(message).not.toContain('(');
  });

  it('puts no URL, port or password in any message that reaches the webview', () => {
    const errors = [
      refused('ECONNREFUSED'),
      new ServerInfoError('unauthorized', 'GET http://127.0.0.1:4096 pw-secret', 401),
      new ServerInfoError('http-status', 'GET http://127.0.0.1:4096 pw-secret', 404),
      new ServerInfoError('http-status', 'GET http://127.0.0.1:4096 pw-secret', 503),
      new ServerInfoError('malformed', 'GET http://127.0.0.1:4096 pw-secret'),
    ];
    for (const error of errors) {
      const { message } = describeExternalFailure(error);
      expect(message).not.toMatch(/127\.0\.0\.1|4096|pw-secret|http:\/\//);
    }
  });
});

describe('describeFailureCause', () => {
  it('follows the cause chain, with the codes, for the log', () => {
    const inner = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const error = new ServerInfoError(
      'transport',
      'GET /api/info failed: fetch failed',
      undefined,
      {
        cause: new TypeError('fetch failed', { cause: inner }),
      },
    );
    expect(describeFailureCause(error)).toBe(
      'GET /api/info failed: fetch failed <- fetch failed <- connect ECONNREFUSED [ECONNREFUSED]',
    );
    expect(describeFailureCause('plain')).toBe('plain');
  });

  // Protects the decision of Sergio on the E11-i18n review (logs stay in English). SYNTHETIC: a
  // fake `fetch` answering a body that is not JSON; the Spanish text comes from the shipped catalog.
  it('logs the English text of a malformed answer while the Spanish catalog is on', async () => {
    useSpanish();
    try {
      const notJson = (): Promise<Response> => Promise.resolve(new Response('<html>'));
      const error: unknown = await fetchServerInfo('http://127.0.0.1:1', 'pw', notJson).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ServerInfoError);
      expect((error as ServerInfoError).message).not.toBe(
        'GET /api/info returned a body that is not JSON',
      );
      expect(describeFailureCause(error)).toBe('GET /api/info returned a body that is not JSON');
    } finally {
      useEnglish();
    }
  });
});

describe('failureActions', () => {
  it('offers the button that fixes each reason, and Show Logs last', () => {
    expect(failureActions('unauthorized')).toEqual(['Set Password', 'Show Logs']);
    expect(failureActions('invalid-url')).toEqual(['Open Settings', 'Show Logs']);
    expect(failureActions('unreachable')).toEqual(['Retry', 'Open Settings', 'Show Logs']);
    for (const reason of ['start-failed', 'exited', 'unsupported-version'] as const) {
      expect(failureActions(reason)).toEqual(['Restart Server', 'Show Logs']);
    }
  });
});

// Protects the translated failure buttons (E11-i18n): the notification shows
// `failureActionLabel` and maps the answer back to the key, so a label that drifted from its key
// would run the wrong action. Provenance: literal keys; the Spanish text is read from
// `l10n/bundle.l10n.es.json`, not copied here. SYNTHETIC: it says nothing about how VS Code draws
// the buttons.
describe('failureActionLabel', () => {
  afterEach(useEnglish);

  it('writes each failure button in Spanish and in English', () => {
    const keys = ['Set Password', 'Open Settings', 'Retry', 'Restart Server', 'Show Logs'] as const;
    expect(keys.map(failureActionLabel)).toEqual([...keys]);
    useSpanish();
    expect(keys.map(failureActionLabel)).toEqual([
      'Establecer contraseña',
      'Abrir configuración',
      'Reintentar',
      'Reiniciar servidor',
      'Mostrar registros',
    ]);
    useEnglish();
    expect(failureActionLabel('Retry')).toBe('Retry');
  });
});

describe('ForgottenPasswords', () => {
  const A = 'http://127.0.0.1:4096';
  const B = 'http://127.0.0.1:4097';

  it('passes a stored password through while nothing was forgotten', () => {
    const forgotten = new ForgottenPasswords();
    expect(forgotten.resolve(A, 'pw')).toEqual({ password: 'pw', stale: false });
    expect(forgotten.resolve(A, undefined)).toEqual({ password: undefined, stale: false });
    expect(forgotten.resolve(A, '')).toEqual({ password: undefined, stale: false });
  });

  it('ignores a password read for a forgotten origin and flags the copy as stale', () => {
    const forgotten = new ForgottenPasswords();
    forgotten.forget(A);
    expect(forgotten.resolve(A, 'deleted-pw')).toEqual({ password: undefined, stale: true });
  });

  it('is not stale when a forgotten origin reads back nothing, and spares other origins', () => {
    const forgotten = new ForgottenPasswords();
    forgotten.forget(A);
    expect(forgotten.resolve(A, undefined)).toEqual({ password: undefined, stale: false });
    expect(forgotten.resolve(A, '')).toEqual({ password: undefined, stale: false });
    expect(forgotten.resolve(B, 'other-pw')).toEqual({ password: 'other-pw', stale: false });
  });

  it('uses the password again once a new one is set for the origin', () => {
    const forgotten = new ForgottenPasswords();
    forgotten.forget(A);
    forgotten.allow(A);
    expect(forgotten.resolve(A, 'new-pw')).toEqual({ password: 'new-pw', stale: false });
  });

  it('allow on an origin that was never forgotten changes nothing', () => {
    const forgotten = new ForgottenPasswords();
    forgotten.allow(A);
    expect(forgotten.resolve(A, 'pw')).toEqual({ password: 'pw', stale: false });
  });
});
