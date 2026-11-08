// Protects the pure rules of the subagent monitor (issue #189): the state of a child (waiting beats
// working beats the finished ones; a `background: true` child is working although its tool block
// completed), the reason of a failure with and without the tool's prefix, "Subagent cancelled" as
// stopped, the elapsed time format, which child a tool block belongs to (and NONE on a tie), and the
// summary line of a finished child.
//
// Provenance: SYNTHETIC. Rows, statuses and tool blocks are built by hand in the shapes of
// `src/shared/model.ts`; the failure and cancellation texts are those READ in `subagent.ts` of
// opencode 2.0.32. Nothing was recorded from a real subagent turn, so these tests confirm OUR
// logic, not what a real server sends.
import { describe, expect, it } from 'vitest';
import type { Part, SessionSummary, SubagentActivity } from '../../../src/shared/model';
import {
  childForTool,
  childState,
  failureReason,
  formatElapsed,
  summaryLine,
  toolPartOf,
  wasCancelled,
} from './subagentView';

const row = (id: string, over: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  parentID: 'ses_p',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const activity = (running: boolean): SubagentActivity => ({
  sessionID: 'ses_c',
  parentID: 'ses_p',
  running,
  toolCount: 0,
  recent: [],
});

const subagentTool = (
  input: Record<string, string>,
  metadata?: Record<string, string>,
): Extract<Part, { type: 'tool' }> => ({
  type: 'tool',
  id: 'call_1',
  name: 'subagent',
  state: { status: 'running', input, ...(metadata === undefined ? {} : { metadata }) },
});

describe('childState', () => {
  it('ranks waiting over working over the finished states', () => {
    const busy = { type: 'busy' } as const;
    expect(childState({ waiting: true, status: busy })).toBe('waiting');
    expect(childState({ waiting: false, status: busy, row: row('c', { outcome: 'failed' }) })).toBe(
      'working',
    );
    expect(childState({ waiting: false, status: { type: 'idle' } })).toBe('done');
  });

  it('counts a retrying child as working', () => {
    expect(
      childState({
        waiting: false,
        status: { type: 'retry', attempt: 1, message: 'x', nextAt: 1 },
      }),
    ).toBe('working');
  });

  it('a background child whose tool already completed is still working', () => {
    // The tool block says `completed` (background returns at once); only the child's status says more.
    expect(childState({ waiting: false, status: { type: 'busy' }, parentError: undefined })).toBe(
      'working',
    );
  });

  it('falls back to the digest running flag only when no status is known', () => {
    expect(childState({ waiting: false, activity: activity(true) })).toBe('working');
    expect(childState({ waiting: false, activity: activity(false) })).toBe('done');
    expect(childState({ waiting: false, status: { type: 'idle' }, activity: activity(true) })).toBe(
      'done',
    );
  });

  it.each([
    [
      'status error',
      { status: { type: 'error' as const, error: { code: 'x', message: 'y' } } },
      'failed',
    ],
    [
      'outcome failed',
      { status: { type: 'idle' as const }, row: row('c', { outcome: 'failed' }) },
      'failed',
    ],
    [
      'parent block failed',
      {
        status: { type: 'idle' as const },
        parentError: 'Subagent failed (sessionID: ses_c): boom',
      },
      'failed',
    ],
    [
      'outcome interrupted',
      { status: { type: 'idle' as const }, row: row('c', { outcome: 'interrupted' }) },
      'stopped',
    ],
    [
      'parent block cancelled',
      { status: { type: 'idle' as const }, parentError: 'Subagent cancelled (sessionID: ses_c)' },
      'stopped',
    ],
    [
      'outcome succeeded',
      { status: { type: 'idle' as const }, row: row('c', { outcome: 'succeeded' }) },
      'done',
    ],
    [
      'an unrelated tool error',
      { status: { type: 'idle' as const }, parentError: 'Permission denied' },
      'done',
    ],
  ])('%s -> %s', (_name, facts, expected) => {
    expect(childState({ waiting: false, ...facts })).toBe(expected);
  });
});

describe('failureReason and wasCancelled', () => {
  it('strips the prefix of the tool and leaves any other text alone', () => {
    expect(failureReason('Subagent failed (sessionID: ses_1): Model unavailable')).toBe(
      'Model unavailable',
    );
    expect(failureReason('Model unavailable')).toBe('Model unavailable');
    expect(failureReason('Subagent failed (sessionID: ses_1):  ')).toBe('');
  });

  it('recognises the cancellation text', () => {
    expect(wasCancelled('Subagent cancelled (sessionID: ses_1)')).toBe(true);
    expect(wasCancelled('Subagent failed (sessionID: ses_1): cancelled')).toBe(false);
  });
});

describe('toolPartOf', () => {
  it('builds a tool part per status, with the error text for a failed call', () => {
    const input = { path: 'src/a.ts' };
    expect(toolPartOf({ id: 't', name: 'read', status: 'running', input }).state).toEqual({
      status: 'running',
      input,
    });
    expect(toolPartOf({ id: 't', name: 'read', status: 'completed', input }).state).toEqual({
      status: 'completed',
      input,
      output: [],
    });
    expect(
      toolPartOf({ id: 't', name: 'read', status: 'error', input, error: 'nope' }).state,
    ).toEqual({
      status: 'error',
      input,
      error: { code: 'tool.execution', message: 'nope' },
    });
    const bare = toolPartOf({ id: 't', name: 'read', status: 'error', input });
    expect(bare.state.status === 'error' && bare.state.error.message).toBe('');
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [1000, '0:01'],
    [65_000, '1:05'],
    [599_999, '9:59'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_725_000, '1:02:05'],
    [-5000, '0:00'],
    [Number.NaN, '0:00'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});

describe('childForTool', () => {
  const input = { agent: 'general', description: 'Say hello', prompt: 'hi' };
  const sessions = {
    ses_c: row('ses_c', { title: 'Say hello', agent: 'general' }),
    ses_other: row('ses_other', { parentID: 'ses_zzz', title: 'Say hello', agent: 'general' }),
  };

  it('uses the link of the block when its row is a child of the open session', () => {
    const part = subagentTool(input, { sessionID: 'ses_c', status: 'running' });
    expect(childForTool(part, sessions, 'ses_p')?.id).toBe('ses_c');
    // A link to a child of ANOTHER session, or to a row not loaded, is no child of this one.
    const foreign = subagentTool(input, { sessionID: 'ses_other', status: 'running' });
    expect(childForTool(foreign, sessions, 'ses_p')).toBeUndefined();
    const missing = subagentTool(input, { sessionID: 'ses_gone', status: 'running' });
    expect(childForTool(missing, sessions, 'ses_p')).toBeUndefined();
  });

  it('falls back to title and agent, and gives none on a tie', () => {
    const part = subagentTool(input);
    expect(childForTool(part, sessions, 'ses_p')?.id).toBe('ses_c');
    const tie = { ...sessions, ses_d: row('ses_d', { title: 'Say hello', agent: 'general' }) };
    expect(childForTool(part, tie, 'ses_p')).toBeUndefined();
    const otherAgent = {
      ses_c: row('ses_c', { title: 'Say hello', agent: 'explore' }),
    };
    expect(childForTool(part, otherAgent, 'ses_p')).toBeUndefined();
  });

  it('gives none for another tool, a missing open session or an input without description', () => {
    const shell: Part = {
      type: 'tool',
      id: 'x',
      name: 'shell',
      state: { status: 'running', input: {} },
    };
    expect(childForTool(shell, sessions, 'ses_p')).toBeUndefined();
    expect(childForTool(subagentTool(input), sessions, undefined)).toBeUndefined();
    expect(childForTool(subagentTool({ agent: 'general' }), sessions, 'ses_p')).toBeUndefined();
  });
});

describe('summaryLine', () => {
  it('builds the summary of a finished, failed and stopped child', () => {
    expect(summaryLine({ state: 'done', toolCount: 3, cost: 0.0123 })).toBe(
      'Finished · 3 tools · $0.01',
    );
    expect(summaryLine({ state: 'done', toolCount: 1 })).toBe('Finished · 1 tool');
    expect(summaryLine({ state: 'done', toolCount: 200, partial: true, cost: 0.5 })).toBe(
      'Finished · 200+ tools · $0.50',
    );
    expect(summaryLine({ state: 'done', toolCount: 0 })).toBe('Finished');
    expect(summaryLine({ state: 'failed', toolCount: 2, reason: 'Model unavailable' })).toBe(
      'Failed: Model unavailable',
    );
    expect(summaryLine({ state: 'failed', toolCount: 2 })).toBe('Failed');
    expect(summaryLine({ state: 'stopped', toolCount: 2 })).toBe('Stopped');
  });

  it('has no summary while the child works or waits', () => {
    expect(summaryLine({ state: 'working', toolCount: 2 })).toBeUndefined();
    expect(summaryLine({ state: 'waiting', toolCount: 2 })).toBeUndefined();
  });
});
