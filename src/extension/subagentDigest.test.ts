// Protects the wire shape of the digest of a subagent child (issue #189): absent optionals stay
// out, `recent` is copied and capped to the last three, `partial` travels only when true, and a
// root session has no digest. The slimming of tool inputs and the tool counting are tested with
// the registry in `sessionActivity.test.ts`.
//
// Provenance: SYNTHETIC. The entries are built by hand; nothing here was recorded from a real
// subagent turn, so these tests confirm OUR logic, not what a real server sends.
import { describe, expect, it } from 'vitest';
import type { SubagentTool } from '../shared/model';
import { toSubagentActivity, type SubagentEntry } from './subagentDigest';

describe('toSubagentActivity', () => {
  const tool = (id: string): SubagentTool => ({
    id,
    name: 'read',
    status: 'completed',
    input: { path: 'a' },
  });
  const entry = (over: Partial<SubagentEntry> = {}): SubagentEntry => ({
    sessionID: 'c1',
    parentID: 'p1',
    running: true,
    tools: { count: 2, recent: [tool('t1'), tool('t2')] },
    ...over,
  });

  it('omits absent optionals and copies the recent list', () => {
    const source = entry();
    const activity = toSubagentActivity(source);
    expect(activity).toEqual({
      sessionID: 'c1',
      parentID: 'p1',
      running: true,
      toolCount: 2,
      recent: [tool('t1'), tool('t2')],
    });
    expect(activity).not.toHaveProperty('since');
    expect(activity).not.toHaveProperty('endedAt');
    expect(activity).not.toHaveProperty('partial');
    expect(activity?.recent).not.toBe(source.tools.recent);
    expect(activity?.recent[0]).not.toBe(source.tools.recent[0]);
  });

  it('carries since, endedAt and partial (only when true) and caps recent to the last three', () => {
    const activity = toSubagentActivity(
      entry({
        running: false,
        since: 10,
        endedAt: 20,
        partial: true,
        tools: { count: 200, recent: ['a', 'b', 'c', 'd'].map(tool) },
      }),
    );
    expect(activity).toMatchObject({ running: false, since: 10, endedAt: 20, partial: true });
    expect(activity?.recent.map((t) => t.id)).toEqual(['b', 'c', 'd']);
    expect(toSubagentActivity(entry({ partial: false }))).not.toHaveProperty('partial');
  });

  it('gives nothing for a session with no parent', () => {
    expect(
      toSubagentActivity({ sessionID: 'r', running: true, tools: { count: 0, recent: [] } }),
    ).toBeUndefined();
  });
});
