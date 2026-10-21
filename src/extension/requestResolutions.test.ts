// Protects the host's memory of answered requests (E3-resolved-history, issues #56/#18) from: a
// decision attributed to the wrong request (a cascade of rejects, an "always" that approves others),
// feedback flagged on a request that never had it, an answer or a feedback text leaking into the
// record (a form may carry credentials), and a memory that grows without bound.
//
// ALL DATA HERE IS FABRICATED from the protocol types: the tests prove the logic of the memory,
// not that opencode sends these messages (the message shapes were seen in the logs of a real
// opencode 2.0.32 run, Windows 11, 21/10/2026; the e2e suite exercises the full path against the
// synthetic server).
import { describe, expect, it } from 'vitest';
import type { FormAsk, PermissionAsk } from '../shared/model';
import { createRequestResolutions } from './requestResolutions';

const permission = (id: string, extra: Partial<PermissionAsk> = {}): PermissionAsk => ({
  id,
  sessionID: 'ses_1',
  action: 'read',
  resources: ['.env', 'other'],
  save: ['*'],
  tool: { messageID: 'msg_1', partID: 'call_1' },
  ...extra,
});

const question = (id: string, extra: Partial<FormAsk> = {}): FormAsk => ({
  id,
  sessionID: 'ses_1',
  title: 'Questions',
  kind: 'question',
  tool: { messageID: 'msg_1', partID: 'call_2' },
  fields: [],
  ...extra,
});

function setup(options: { maxPerSession?: number; maxSessions?: number } = {}) {
  let clock = 1000;
  const memory = createRequestResolutions({ now: () => clock++, ...options });
  return { memory };
}

describe('permissions', () => {
  it('turns asked + resolved into a record with the tool, the action and the FIRST resource', () => {
    const { memory } = setup();
    expect(memory.observe({ type: 'permission.asked', permission: permission('per_1') })).toBe(
      undefined,
    );
    const record = memory.observe({
      type: 'permission.resolved',
      sessionID: 'ses_1',
      permissionID: 'per_1',
      decision: 'once',
    });
    expect(record).toEqual({
      kind: 'permission',
      id: 'per_1',
      sessionID: 'ses_1',
      tool: { messageID: 'msg_1', partID: 'call_1' },
      at: 1000,
      decision: 'once',
      action: 'read',
      resource: '.env',
      withFeedback: false,
    });
    expect(memory.forSession('ses_1')).toEqual([record]);
  });

  it('returns nothing for a request it never saw asked', () => {
    const { memory } = setup();
    expect(
      memory.observe({
        type: 'permission.resolved',
        sessionID: 'ses_1',
        permissionID: 'per_x',
        decision: 'once',
      }),
    ).toBeUndefined();
    expect(memory.forSession('ses_1')).toEqual([]);
  });

  it('keeps a record per request when a reject cascades over several pending ones', () => {
    const { memory } = setup();
    for (const id of ['per_1', 'per_2', 'per_3']) {
      memory.observe({ type: 'permission.asked', permission: permission(id) });
    }
    for (const id of ['per_1', 'per_2', 'per_3']) {
      memory.observe({
        type: 'permission.resolved',
        sessionID: 'ses_1',
        permissionID: id,
        decision: 'reject',
      });
    }
    expect(
      memory.forSession('ses_1').map((r) => (r.kind === 'permission' ? r.decision : '')),
    ).toEqual(['reject', 'reject', 'reject']);
  });

  it('records an "always" that approves other pending requests as what the server published for each', () => {
    const { memory } = setup();
    memory.observe({ type: 'permission.asked', permission: permission('per_1') });
    memory.observe({ type: 'permission.asked', permission: permission('per_2') });
    memory.observe({
      type: 'permission.resolved',
      sessionID: 'ses_1',
      permissionID: 'per_1',
      decision: 'always',
    });
    memory.observe({
      type: 'permission.resolved',
      sessionID: 'ses_1',
      permissionID: 'per_2',
      decision: 'once',
    });
    expect(memory.forSession('ses_1')).toMatchObject([
      { id: 'per_1', decision: 'always' },
      { id: 'per_2', decision: 'once' },
    ]);
  });

  it('flags feedback only on the request that was replied with a message, and only when rejected', () => {
    const { memory } = setup();
    memory.observe({ type: 'permission.asked', permission: permission('per_1') });
    memory.observe({ type: 'permission.asked', permission: permission('per_2') });
    memory.markReplied('permission', 'per_1');
    for (const id of ['per_1', 'per_2']) {
      memory.observe({
        type: 'permission.resolved',
        sessionID: 'ses_1',
        permissionID: id,
        decision: 'reject',
      });
    }
    expect(memory.forSession('ses_1')).toMatchObject([
      { id: 'per_1', withFeedback: true },
      { id: 'per_2', withFeedback: false },
    ]);
  });

  it('forgets the flag when the reply failed (unmark), so a later cascade is not "with feedback"', () => {
    const { memory } = setup();
    memory.observe({ type: 'permission.asked', permission: permission('per_1') });
    memory.markReplied('permission', 'per_1');
    memory.unmark('permission', 'per_1');
    memory.observe({
      type: 'permission.resolved',
      sessionID: 'ses_1',
      permissionID: 'per_1',
      decision: 'reject',
    });
    expect(memory.forSession('ses_1')).toMatchObject([{ withFeedback: false }]);
  });

  it('can resolve a request that only came from the snapshot (rememberAsks)', () => {
    const { memory } = setup();
    memory.rememberAsks([permission('per_9')], [question('frm_9')]);
    expect(
      memory.observe({
        type: 'permission.resolved',
        sessionID: 'ses_1',
        permissionID: 'per_9',
        decision: 'once',
      }),
    ).toMatchObject({ id: 'per_9' });
    expect(
      memory.observe({
        type: 'form.resolved',
        sessionID: 'ses_1',
        formID: 'frm_9',
        outcome: 'answered',
      }),
    ).toMatchObject({ id: 'frm_9' });
  });

  /**
   * Protects against the memory keeping an ask the server deleted without a `*.replied`
   * (opencode 2.0.32 interrupt, read in `permission.ts`). Fabricated messages: proves the
   * replace contract of `rememberAsks`, not the server behaviour.
   */
  it('forgets an ask that is missing from a later snapshot, and keeps stored records', () => {
    const { memory } = setup();
    memory.observe({ type: 'permission.asked', permission: permission('per_1') });
    memory.observe({ type: 'permission.asked', permission: permission('per_2') });
    memory.observe({
      type: 'permission.resolved',
      sessionID: 'ses_1',
      permissionID: 'per_2',
      decision: 'once',
    });
    memory.rememberAsks([], []);
    expect(
      memory.observe({
        type: 'permission.resolved',
        sessionID: 'ses_1',
        permissionID: 'per_1',
        decision: 'once',
      }),
    ).toBe(undefined);
    expect(memory.forSession('ses_1')).toMatchObject([{ id: 'per_2' }]);
  });
});

describe('forms', () => {
  it('separates a question from a generic form and keeps the title', () => {
    const { memory } = setup();
    memory.observe({ type: 'form.asked', form: question('frm_1') });
    memory.observe({
      type: 'form.asked',
      form: question('frm_2', { kind: 'form', title: 'Sign in', tool: undefined }),
    });
    memory.observe({
      type: 'form.resolved',
      sessionID: 'ses_1',
      formID: 'frm_1',
      outcome: 'answered',
    });
    memory.observe({
      type: 'form.resolved',
      sessionID: 'ses_1',
      formID: 'frm_2',
      outcome: 'cancelled',
    });
    expect(memory.forSession('ses_1')).toEqual([
      {
        kind: 'form',
        id: 'frm_1',
        sessionID: 'ses_1',
        tool: { messageID: 'msg_1', partID: 'call_2' },
        at: 1000,
        outcome: 'answered',
        formKind: 'question',
        title: 'Questions',
        withMessage: false,
      },
      {
        kind: 'form',
        id: 'frm_2',
        sessionID: 'ses_1',
        at: 1001,
        outcome: 'cancelled',
        formKind: 'form',
        title: 'Sign in',
        withMessage: false,
      },
    ]);
  });

  it('flags withMessage only for a cancel that carried a note', () => {
    const { memory } = setup();
    memory.observe({ type: 'form.asked', form: question('frm_1') });
    memory.markReplied('form', 'frm_1');
    memory.observe({
      type: 'form.resolved',
      sessionID: 'ses_1',
      formID: 'frm_1',
      outcome: 'cancelled',
    });
    expect(memory.forSession('ses_1')).toMatchObject([{ withMessage: true }]);
  });

  it('never keeps what was answered: the record has no answer field and no field value from the form', () => {
    const { memory } = setup();
    memory.observe({
      type: 'form.asked',
      form: question('frm_1', {
        fields: [{ key: 'token', type: 'string', title: 'API key' }],
      }),
    });
    memory.observe({
      type: 'form.resolved',
      sessionID: 'ses_1',
      formID: 'frm_1',
      outcome: 'answered',
    });
    const [record] = memory.forSession('ses_1');
    expect(Object.keys(record ?? {}).sort()).toEqual(
      [
        'at',
        'formKind',
        'id',
        'kind',
        'outcome',
        'sessionID',
        'title',
        'tool',
        'withMessage',
      ].sort(),
    );
    expect(JSON.stringify(record)).not.toContain('token');
  });
});

describe('bounds and lifetime', () => {
  it('keeps only the newest records of a session', () => {
    const { memory } = setup({ maxPerSession: 2 });
    for (const id of ['per_1', 'per_2', 'per_3']) {
      memory.observe({ type: 'permission.asked', permission: permission(id) });
      memory.observe({
        type: 'permission.resolved',
        sessionID: 'ses_1',
        permissionID: id,
        decision: 'once',
      });
    }
    expect(memory.forSession('ses_1').map((r) => r.id)).toEqual(['per_2', 'per_3']);
  });

  it('drops the least recently touched session when there are too many', () => {
    const { memory } = setup({ maxSessions: 2 });
    for (const [id, sessionID] of [
      ['per_1', 'ses_a'],
      ['per_2', 'ses_b'],
      ['per_3', 'ses_a'], // touches ses_a again, so ses_b is now the oldest
      ['per_4', 'ses_c'],
    ] as const) {
      memory.observe({ type: 'permission.asked', permission: permission(id, { sessionID }) });
      memory.observe({
        type: 'permission.resolved',
        sessionID,
        permissionID: id,
        decision: 'once',
      });
    }
    expect(memory.forSession('ses_b')).toEqual([]);
    expect(memory.forSession('ses_a').map((r) => r.id)).toEqual(['per_1', 'per_3']);
    expect(memory.forSession('ses_c').map((r) => r.id)).toEqual(['per_4']);
  });

  it('forgetAsks drops the pending asks but keeps the records (history survives a server restart)', () => {
    const { memory } = setup();
    memory.observe({ type: 'permission.asked', permission: permission('per_1') });
    memory.observe({ type: 'permission.asked', permission: permission('per_2') });
    memory.observe({
      type: 'permission.resolved',
      sessionID: 'ses_1',
      permissionID: 'per_1',
      decision: 'once',
    });
    memory.forgetAsks();
    expect(
      memory.observe({
        type: 'permission.resolved',
        sessionID: 'ses_1',
        permissionID: 'per_2',
        decision: 'once',
      }),
    ).toBeUndefined();
    expect(memory.forSession('ses_1').map((r) => r.id)).toEqual(['per_1']);
  });

  it('forSession returns a copy', () => {
    const { memory } = setup();
    memory.observe({ type: 'permission.asked', permission: permission('per_1') });
    memory.observe({
      type: 'permission.resolved',
      sessionID: 'ses_1',
      permissionID: 'per_1',
      decision: 'once',
    });
    memory.forSession('ses_1').pop();
    expect(memory.forSession('ses_1')).toHaveLength(1);
  });

  it('ignores every other message', () => {
    const { memory } = setup();
    expect(memory.observe({ type: 'session.removed', sessionID: 'ses_1' })).toBeUndefined();
  });
});
