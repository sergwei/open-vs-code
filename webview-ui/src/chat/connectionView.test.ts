// Protects the texts and rules of the connection problems (E2, issue #85): which step fails for
// each reason, what the failing step says it searched, the actions each problem offers and the
// latch of the guide (P1=1). Provenance: FABRICATED connection states built from the shapes of
// `src/shared/protocol.ts`; real details of a failed detection come from the host tests of phase 1.
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../../../src/shared/model';
import type { ConnectionState } from '../../../src/shared/protocol';
import { describeProblem, guideSteps, nextGuideLatch } from './connectionView';

type Unavailable = Extract<ConnectionState, { state: 'unavailable' }>;
const failure = (
  reason: Unavailable['reason'],
  message = 'boom',
  binary?: Unavailable['binary'],
): ConnectionState => ({
  state: 'unavailable',
  reason,
  error: { code: reason, message },
  ...(binary === undefined ? {} : { binary }),
});
const catalogWith = (count: number): Catalog => ({
  models: Array.from({ length: count }, (_, i) => ({
    providerID: 'opencode',
    id: `m${String(i)}`,
    name: `M${String(i)}`,
    status: 'active' as const,
    contextLimit: 1000,
    free: true,
    variants: [],
    images: false,
  })),
  providers: [],
  agents: [],
});

describe('guideSteps', () => {
  it('marks step 1 failed with what was searched when the detection found nothing', () => {
    const steps = guideSteps(
      failure('binary-missing', 'not found', {
        checks: [
          { source: 'opencode2', outcome: 'not-on-path', detail: '' },
          { source: 'opencode', outcome: 'not-on-path', detail: '' },
        ],
      }),
      undefined,
    );
    expect(steps.map((s) => [s.id, s.status])).toEqual([
      ['binary', 'failed'],
      ['server', 'waiting'],
      ['model', 'waiting'],
    ]);
    expect(steps[0]?.lines).toEqual([
      'opencode2: not on PATH',
      'opencode: not on PATH',
      'openVsCode.opencodePath is not set.',
    ]);
    expect(steps[0]?.actions.map((a) => a.label)).toEqual(['Choose binary…', 'Install guide']);
  });

  it('names the setting path when it is the file that failed', () => {
    const steps = guideSteps(
      failure('binary-missing', 'bad', {
        settingPath: 'C:\\nope\\opencode.exe',
        checks: [
          { source: 'setting', path: 'C:\\nope\\opencode.exe', outcome: 'invalid', detail: '' },
        ],
      }),
      undefined,
    );
    expect(steps[0]?.lines).toEqual([
      'openVsCode.opencodePath: C:\\nope\\opencode.exe: the file does not exist or cannot be used',
    ]);
  });

  // Protects against the contradiction of review B1: a setting that points at opencode v1 is not
  // "not set". Synthetic states.
  it('does not say the setting is not set when it is the file that is unsupported', () => {
    const steps = guideSteps(
      failure('unsupported-version', 'v1', {
        checks: [
          {
            source: 'setting',
            path: 'C:\\v1\\opencode.exe',
            outcome: 'unsupported',
            detail: 'version 1.19.3',
          },
        ],
      }),
      undefined,
    );
    expect(steps[0]?.lines).toEqual([
      'openVsCode.opencodePath: C:\\v1\\opencode.exe: this is not opencode v2; open-vs-code needs v2 (version 1.19.3)',
    ]);
  });

  it('prints an invalid check detail once, without the generic text', () => {
    const steps = guideSteps(
      failure('binary-missing', 'bad', {
        settingPath: 'C:\\nope\\opencode.exe',
        checks: [
          {
            source: 'setting',
            path: 'C:\\nope\\opencode.exe',
            outcome: 'invalid',
            detail: 'the file does not exist',
          },
        ],
      }),
      undefined,
    );
    expect(steps[0]?.lines).toEqual([
      'openVsCode.opencodePath: C:\\nope\\opencode.exe: the file does not exist',
    ]);
  });

  it('marks step 2 failed for start-failed, with Restart and Show logs, and step 1 done', () => {
    const steps = guideSteps(failure('start-failed', 'it crashed'), undefined);
    expect(steps.map((s) => s.status)).toEqual(['done', 'failed', 'waiting']);
    expect(steps[1]?.lines).toEqual(['it crashed']);
    expect(steps[1]?.actions.map((a) => a.label)).toEqual(['Restart', 'Show logs']);
  });

  it('puts unsupported-version in step 1 with a diagnosis and in step 2 without one', () => {
    const detection = guideSteps(
      failure('unsupported-version', 'v1', {
        checks: [{ source: 'opencode', outcome: 'unsupported', detail: '1.19.3' }],
      }),
      undefined,
    );
    expect(detection[0]?.status).toBe('failed');
    const info = guideSteps(failure('unsupported-version', 'server v1'), undefined);
    expect(info.map((s) => s.status)).toEqual(['done', 'failed', 'waiting']);
  });

  it('shows step 2 running while the server starts after a failure', () => {
    expect(guideSteps({ state: 'starting' }, undefined).map((s) => s.status)).toEqual([
      'done',
      'running',
      'waiting',
    ]);
  });

  it('step 3 is informational: done with models, waiting without, never failed (P2=1)', () => {
    expect(guideSteps({ state: 'starting' }, catalogWith(2))[2]?.status).toBe('done');
    expect(guideSteps(failure('start-failed'), catalogWith(0))[2]?.status).toBe('waiting');
  });

  it('uses "Connect to the server" with Set password, Open settings and Retry for an external server (P14=1)', () => {
    const steps = guideSteps(failure('unauthorized', 'password needed'), undefined);
    expect(steps[0]?.id).toBe('connect');
    expect(steps[0]?.title).toContain('Connect to the server');
    expect(steps[0]?.actions.map((a) => a.label)).toEqual([
      'Set password',
      'Open settings',
      'Retry',
    ]);
    const unreachable = guideSteps(failure('unreachable', 'no route'), undefined);
    expect(unreachable[0]?.actions.map((a) => a.label)).toEqual(['Open settings', 'Retry']);
  });
});

// Issue #86. Provenance: FABRICATED states; the real flow is `test:visual` step 0.
describe('guideSteps with binaryCheck (issue #86)', () => {
  const missing = failure('binary-missing', 'not found');

  it('turns step 1 into one Checking line, keeps step 2 waiting and Install guide active', () => {
    const steps = guideSteps(missing, undefined, { kind: 'checking', path: '/opt/oc' });
    expect(steps.map((s) => [s.id, s.status])).toEqual([
      ['binary', 'checking'],
      ['server', 'waiting'],
      ['model', 'waiting'],
    ]);
    expect(steps[0]?.lines).toEqual(['Checking /opt/oc…']);
    expect(steps[0]?.actions.map((a) => [a.label, a.disabled === true])).toEqual([
      ['Choose binary…', true],
      ['Install guide', false],
    ]);
  });

  it('keeps the failure but makes Choose binary… busy while the dialog is open', () => {
    const steps = guideSteps(missing, undefined, { kind: 'choosing' });
    expect(steps[0]?.status).toBe('failed');
    expect(steps[0]?.actions[0]?.disabled).toBe(true);
    expect(guideSteps(missing, undefined)[0]?.actions[0]?.disabled).toBeUndefined();
  });

  it('does not hide a success or touch an external-server guide', () => {
    const checking = { kind: 'checking', path: '/opt/oc' } as const;
    expect(guideSteps({ state: 'starting' }, undefined, checking)[0]?.status).toBe('done');
    expect(guideSteps(failure('unreachable', 'no route'), undefined, checking)[0]?.id).toBe(
      'connect',
    );
  });
});

describe('describeProblem', () => {
  it.each([
    ['exited', 'opencode stopped', ['Restart', 'Show logs']],
    ['start-failed', 'opencode could not start', ['Restart', 'Show logs']],
    ['unsupported-version', 'This opencode is not supported', ['Choose binary…', 'Show logs']],
    ['binary-missing', 'opencode was not found', ['Choose binary…', 'Show logs']],
    ['unreachable', 'Cannot reach the opencode server', ['Retry', 'Open settings', 'Show logs']],
    ['unauthorized', 'The server needs a password', ['Set password', 'Show logs']],
    ['invalid-url', 'The server address is not valid', ['Open settings']],
    ['no-workspace', 'Open a folder to start', ['Open folder']],
  ] as const)('%s -> "%s"', (reason, title, labels) => {
    const view = describeProblem(failure(reason));
    expect(view?.title).toBe(title);
    expect(view?.role).toBe('alert');
    expect(view?.actions.map((a) => a.label)).toEqual(labels);
  });

  it('describes reconnecting as a neutral status with only Show logs, and others as none', () => {
    const view = describeProblem({ state: 'reconnecting', attempt: 3 });
    expect(view?.title).toBe('Reconnecting to opencode (attempt 3)…');
    expect(view?.role).toBe('status');
    expect(view?.actions.map((a) => a.label)).toEqual(['Show logs']);
    expect(describeProblem({ state: 'starting' })).toBeUndefined();
    expect(describeProblem({ state: 'connected', serverVersion: '2' })).toBeUndefined();
  });

  it('the exited card says the conversation is kept, not the raw server text', () => {
    expect(describeProblem(failure('exited', 'code 1'))?.cause).toBe(
      'The server exited unexpectedly. Your conversation is kept.',
    );
  });
});

describe('nextGuideLatch', () => {
  it('turns on at unavailable without conversation, holds through starting, off at connected', () => {
    let latch = nextGuideLatch(false, failure('start-failed'), false);
    expect(latch).toBe(true);
    latch = nextGuideLatch(latch, { state: 'starting' }, false);
    expect(latch).toBe(true);
    latch = nextGuideLatch(latch, { state: 'connected', serverVersion: '2' }, false);
    expect(latch).toBe(false);
  });

  it('a normal start never turns it on', () => {
    expect(nextGuideLatch(false, { state: 'starting' }, false)).toBe(false);
  });

  it('a conversation, or the folder problem, never shows it', () => {
    expect(nextGuideLatch(true, failure('exited'), true)).toBe(false);
    expect(nextGuideLatch(false, failure('no-workspace'), false)).toBe(false);
  });
});
