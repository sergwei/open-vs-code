// Protects the host's registry of pending requests (issues #18/#44/#19): the badge, the
// notifications and the cure after an interrupt all read it, so a request that is never added, is
// added twice, or is never removed would show a wrong badge or a notification that never closes.
// Also protects that a summary never carries the full list of resources (they can be shell
// commands with secrets in them) and is bounded for a notification.
//
// Provenance of the data: FABRICATED protocol messages. They confirm the registry's logic, not the
// events a real opencode sends (the opt-in `realOpencode.test.ts` covers that).
import { describe, expect, it } from 'vitest';
import type { FormAsk, PermissionAsk } from '../shared/model';
import { createPendingRequests, MAX_SUMMARY_LENGTH } from './pendingRequests';

const permission = (id: string, sessionID = 'ses_1', resources = ['.env']): PermissionAsk => ({
  id,
  sessionID,
  action: 'read',
  resources,
  save: ['*'],
});
const form = (id: string, sessionID = 'ses_1', kind: FormAsk['kind'] = 'question'): FormAsk => ({
  id,
  sessionID,
  title: 'Questions',
  kind,
  fields: [],
});

describe('apply', () => {
  it('adds on asked, is idempotent on a repeat, and removes on resolved', () => {
    const pending = createPendingRequests();
    expect(pending.apply({ type: 'permission.asked', permission: permission('per_1') })).toBe(true);
    expect(pending.apply({ type: 'permission.asked', permission: permission('per_1') })).toBe(
      false,
    );
    expect(pending.apply({ type: 'form.asked', form: form('frm_1') })).toBe(true);
    expect(pending.list().map((item) => item.id)).toEqual(['per_1', 'frm_1']);
    expect(
      pending.apply({
        type: 'permission.resolved',
        sessionID: 'ses_1',
        permissionID: 'per_1',
        decision: 'once',
      }),
    ).toBe(true);
    expect(
      pending.apply({
        type: 'form.resolved',
        sessionID: 'ses_1',
        formID: 'frm_1',
        outcome: 'cancelled',
      }),
    ).toBe(true);
    expect(pending.list()).toEqual([]);
  });

  it('reports no change for an id it never had and for unrelated messages', () => {
    const pending = createPendingRequests();
    expect(
      pending.apply({
        type: 'permission.resolved',
        sessionID: 'ses_1',
        permissionID: 'per_x',
        decision: 'reject',
      }),
    ).toBe(false);
    expect(pending.apply({ type: 'session.removed', sessionID: 'ses_1' })).toBe(false);
  });

  it('keeps requests of several sessions apart and answers hasSession', () => {
    const pending = createPendingRequests();
    pending.apply({ type: 'permission.asked', permission: permission('per_1', 'ses_1') });
    pending.apply({ type: 'permission.asked', permission: permission('per_2', 'ses_child') });
    expect(pending.hasSession('ses_1')).toBe(true);
    expect(pending.hasSession('ses_child')).toBe(true);
    expect(pending.hasSession('ses_other')).toBe(false);
    pending.apply({
      type: 'permission.resolved',
      sessionID: 'ses_child',
      permissionID: 'per_2',
      decision: 'reject',
    });
    expect(pending.hasSession('ses_child')).toBe(false);
  });
});

describe('find and canAlways', () => {
  it('finds a request by kind and id, and knows whether always is meaningful', () => {
    const pending = createPendingRequests();
    pending.replaceAll(
      [permission('per_1'), { ...permission('per_2'), save: [] }],
      [form('frm_1')],
    );
    expect(pending.find('permission', 'per_1')).toMatchObject({
      sessionID: 'ses_1',
      canAlways: true,
    });
    expect(pending.find('permission', 'per_2')?.canAlways).toBe(false);
    expect(pending.find('form', 'frm_1')).toMatchObject({ kind: 'form' });
    expect(pending.find('form', 'per_1')).toBeUndefined();
    expect(pending.find('permission', 'nope')).toBeUndefined();
  });
});

describe('replaceAll and clear', () => {
  it('replaces the set and says whether the ids changed', () => {
    const pending = createPendingRequests();
    expect(pending.replaceAll([permission('per_1')], [form('frm_1')])).toBe(true);
    expect(pending.replaceAll([permission('per_1')], [form('frm_1')])).toBe(false);
    expect(pending.replaceAll([], [form('frm_1')])).toBe(true);
    expect(pending.list().map((item) => item.id)).toEqual(['frm_1']);
  });

  it('clear forgets everything', () => {
    const pending = createPendingRequests();
    pending.replaceAll([permission('per_1')], []);
    pending.clear();
    expect(pending.list()).toEqual([]);
    expect(pending.hasSession('ses_1')).toBe(false);
  });
});

describe('summaries', () => {
  it('names the action and only the first resource, with a count of the rest', () => {
    const pending = createPendingRequests();
    pending.replaceAll([permission('per_1', 'ses_1', ['.env', 'secrets/a', 'secrets/b'])], []);
    const [item] = pending.list();
    expect(item).toMatchObject({ kind: 'permission', id: 'per_1', sessionID: 'ses_1' });
    expect(item?.title).toBe('Permission requested: read');
    expect(item?.detail).toBe('.env (+2 more)');
    expect(item?.detail).not.toContain('secrets');
  });

  // Issue #20 / lesson #969: opencode deletes the pending requests of a deleted session WITHOUT a
  // `*.replied`, so `session.removed` is the only signal. Fabricated messages.
  it('drops every request of a removed session and keeps the others', () => {
    const pending = createPendingRequests();
    pending.replaceAll(
      [permission('per_1', 'ses_gone'), permission('per_2', 'ses_kept')],
      [form('frm_1', 'ses_gone'), form('frm_2', 'ses_kept')],
    );
    expect(pending.apply({ type: 'session.removed', sessionID: 'ses_gone' })).toBe(true);
    expect(pending.list().map((item) => item.id)).toEqual(['per_2', 'frm_2']);
    expect(pending.hasSession('ses_gone')).toBe(false);
    // Nothing left of that session: no change to report.
    expect(pending.apply({ type: 'session.removed', sessionID: 'ses_gone' })).toBe(false);
  });

  it('truncates a long resource (a shell command) to the bound', () => {
    const pending = createPendingRequests();
    const command = `curl -H "Authorization: ${'x'.repeat(300)}" https://example.test`;
    pending.replaceAll([permission('per_1', 'ses_1', [command])], []);
    const detail = pending.list()[0]?.detail ?? '';
    expect(detail.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
    expect(detail.endsWith('…')).toBe(true);
  });

  it('describes a question form as a question and a plain form by its title', () => {
    const pending = createPendingRequests();
    pending.replaceAll([], [form('frm_q', 'ses_1', 'question'), form('frm_f', 'ses_1', 'form')]);
    expect(pending.list().map((item) => item.title)).toEqual([
      'The agent has a question',
      'Questions',
    ]);
  });
});
