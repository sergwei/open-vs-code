import { describe, expect, it } from 'vitest';
import {
  createSessionLineage,
  MAX_KNOWN_SESSIONS,
  MAX_LINEAGE_DEPTH,
  type LineageRow,
} from './sessionLineage';

/**
 * Protects the registry that decides which chat tab shows a request (issue #77, E4). Every row is
 * fabricated: this proves the walk, the caps and the "a parent is never forgotten" rule, not that
 * opencode sends `parentID` that way (VERIFIED for `session.created` by the spike of #21, 2.0.32).
 */
function row(id: string, parentID?: string, title?: string): LineageRow {
  return {
    id,
    ...(parentID === undefined ? {} : { parentID }),
    ...(title === undefined ? {} : { title }),
  };
}

describe('createSessionLineage', () => {
  it('walks a chain of three levels up to the known root', () => {
    const lineage = createSessionLineage();
    lineage.learn([row('root'), row('child', 'root'), row('grand', 'child')]);
    expect(lineage.chain('grand')).toEqual(['grand', 'child', 'root']);
    expect(lineage.rootOf('grand')).toBe('root');
    expect(lineage.rootOf('root')).toBe('root');
    expect(lineage.unresolved('grand')).toBeUndefined();
  });

  it('tells a known root from an unknown parent and names the row that is missing', () => {
    const lineage = createSessionLineage();
    lineage.learn([row('grand', 'child')]);
    expect(lineage.walk('grand')).toEqual({ ids: ['grand', 'child'], end: 'unknown' });
    expect(lineage.rootOf('grand')).toBeUndefined();
    expect(lineage.unresolved('grand')).toBe('child');
    lineage.learn([row('child', 'root')]);
    expect(lineage.unresolved('grand')).toBe('root');
    lineage.learn([row('root')]);
    expect(lineage.rootOf('grand')).toBe('root');
  });

  it('knows nothing of a session it never saw', () => {
    const lineage = createSessionLineage();
    expect(lineage.walk('x')).toEqual({ ids: ['x'], end: 'unknown' });
    expect(lineage.rootOf('x')).toBeUndefined();
    expect(lineage.unresolved('x')).toBe('x');
    expect(lineage.titleOf('x')).toBeUndefined();
  });

  it('does not hang on a cycle and gives up on it', () => {
    const lineage = createSessionLineage();
    lineage.learn([row('a', 'b'), row('b', 'a'), row('self', 'self')]);
    expect(lineage.walk('a')).toEqual({ ids: ['a', 'b'], end: 'cycle' });
    expect(lineage.rootOf('a')).toBeUndefined();
    expect(lineage.unresolved('a')).toBeUndefined();
    expect(lineage.walk('self').end).toBe('cycle');
  });

  it('stops at the depth cap', () => {
    const lineage = createSessionLineage();
    const rows: LineageRow[] = [row('s0')];
    for (let level = 1; level <= MAX_LINEAGE_DEPTH + 2; level += 1) {
      rows.push(row(`s${String(level)}`, `s${String(level - 1)}`));
    }
    lineage.learn(rows);
    const found = lineage.walk(`s${String(MAX_LINEAGE_DEPTH + 2)}`);
    expect(found.end).toBe('cap');
    expect(found.ids).toHaveLength(MAX_LINEAGE_DEPTH);
    expect(lineage.rootOf(`s${String(MAX_LINEAGE_DEPTH + 2)}`)).toBeUndefined();
  });

  it('breaks the chain at a forgotten intermediate session', () => {
    const lineage = createSessionLineage();
    lineage.learn([row('root'), row('child', 'root'), row('grand', 'child')]);
    lineage.forget('child');
    expect(lineage.walk('grand')).toEqual({ ids: ['grand', 'child'], end: 'unknown' });
    expect(lineage.unresolved('grand')).toBe('child');
  });

  it('never turns a known parent back into a root when a partial row arrives', () => {
    const lineage = createSessionLineage();
    lineage.learn([row('root'), row('child', 'root', 'Explore')]);
    expect(lineage.learn([row('child')])).toBe(false);
    expect(lineage.chain('child')).toEqual(['child', 'root']);
    expect(lineage.titleOf('child')).toBe('Explore');
  });

  it('reports whether a call taught it something', () => {
    const lineage = createSessionLineage();
    expect(lineage.learn([row('a', undefined, 'One')])).toBe(true);
    expect(lineage.learn([row('a', undefined, 'One')])).toBe(false);
    expect(lineage.learn([row('a', undefined, 'Two')])).toBe(true);
    expect(lineage.titleOf('a')).toBe('Two');
  });

  it('forgets the least recently learned beyond the cap', () => {
    const lineage = createSessionLineage();
    lineage.learn([row('first')]);
    const rows: LineageRow[] = [];
    for (let index = 0; index < MAX_KNOWN_SESSIONS - 1; index += 1) {
      rows.push(row(`s${String(index)}`));
    }
    lineage.learn(rows);
    lineage.learn([row('first')]); // refreshed: it is now the newest
    lineage.learn([row('extra')]);
    expect(lineage.walk('first').end).toBe('root');
    expect(lineage.walk('s0').end).toBe('unknown');
    expect(lineage.walk('extra').end).toBe('root');
  });

  it('clear forgets everything', () => {
    const lineage = createSessionLineage();
    lineage.learn([row('a')]);
    lineage.clear();
    expect(lineage.walk('a').end).toBe('unknown');
  });
});
