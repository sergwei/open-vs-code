// Protects the model of the native Sessions tree (issue #77, delivery E3) from the bugs a list that
// follows a live server falls into: a reconnection that wipes the rows the user loaded with "Show
// more" (the guard against resurrecting one deleted meanwhile lives in chatController.test.ts), a sub-agent session turning into a row, a
// request of a child that nobody sees on its root, a repaint for every usage tick of a streaming
// turn, a "Today" group that never turns into "Yesterday", and a description that puts the time
// before the state (the state comes first so that, when the title leaves room for a description at
// all, the state is what shows; with a long title VS Code hides the whole description). Plan
// E9-sessions-organize adds: the order of sections, folders and dates (a session has one home), the
// "Needs attention" shortcut that leaves the home row in place, OR filters, `adopt`/`orphans` for
// organized sessions outside the page, and a tooltip (cost, tokens, changed files, folder) that is
// outside the projection so a usage tick repaints nothing.
//
// Provenance: FABRICATED rows and events shaped like the protocol's (`SessionSummary`,
// `session.upserted|removed|status`). They prove the logic of the model; that a real server sends
// those events with those shapes is what `chatController.e2e.test.ts` (synthetic HTTP/SSE server)
// and the opt-in real-opencode suite check, not this file. Dates are built from LOCAL components
// and the locale is fixed (`de-DE`, 24-hour clock), so the expected texts do not depend on the
// machine. The deliberately fixed `NOW` is Wednesday 21 Oct 2026, 15:30.
import { describe, expect, it } from 'vitest';
import type { SessionStatus, SessionSummary } from '../shared/model';
import {
  archiveSessions,
  createFolder,
  emptyOrganization,
  moveSessions,
  pinSessions,
  type SessionOrganization,
} from './sessionOrganization';
import {
  createSessionTree,
  msUntilNextLocalMidnight,
  type SessionTreeGroup,
  type SessionTreeNode,
  type SessionTreeSession,
} from './sessionTree';

const NOW = new Date(2026, 9, 21, 15, 30).getTime();
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 9, day, hour, minute).getTime();

const row = (
  id: string,
  updatedAt: number,
  extra: Partial<SessionSummary> = {},
): SessionSummary => ({
  id,
  createdAt: updatedAt - 1000,
  updatedAt,
  title: `Title ${id}`,
  ...extra,
});

const BUSY: SessionStatus = { type: 'busy' };
const FAILED: SessionStatus = { type: 'error', error: { code: 'X', message: 'boom' } };

/** A model already loaded with `rows` (and the options of the file). */
function loaded(
  rows: SessionSummary[],
  extra: { statuses?: Record<string, SessionStatus>; hasMore?: boolean; folder?: string } = {},
) {
  const tree = createSessionTree({ now: () => NOW, locale: 'de-DE' });
  tree.setOnline(true);
  tree.reset({
    folder: extra.folder ?? 'C:\\work',
    rows,
    statuses: extra.statuses ?? {},
    hasMore: extra.hasMore ?? false,
  });
  return tree;
}

/** Every session row of a projection, shortcuts included, flattened in display order. */
const everySession = (nodes: readonly SessionTreeNode[]): SessionTreeSession[] =>
  nodes.flatMap((node) => {
    if (node.kind === 'session') return [node];
    return node.kind === 'group' || node.kind === 'section' || node.kind === 'folder'
      ? everySession(node.children)
      : [];
  });
/** The HOME rows only (the "Needs attention" duplicates left out), in display order. */
const sessions = (nodes: SessionTreeNode[]): SessionTreeSession[] =>
  everySession(nodes).filter((node) => !node.shortcut);
/** The ids of a list of nodes, to compare orders. */
const sessionIDsOf = (nodes: readonly SessionTreeNode[]): string[] =>
  everySession(nodes).map((node) => node.sessionID);
const ids = (tree: ReturnType<typeof loaded>): string[] =>
  sessions(tree.project()).map((node) => node.sessionID);
const only = (tree: ReturnType<typeof loaded>, id: string): SessionTreeSession => {
  const found = sessions(tree.project()).find((node) => node.sessionID === id);
  if (found === undefined) throw new Error(`no row ${id}`);
  return found;
};

describe('load state', () => {
  it('is offline and empty until the server is reachable, loading until the first page', () => {
    const tree = createSessionTree({ now: () => NOW });
    expect(tree.load()).toBe('offline');
    expect(tree.project()).toEqual([]);
    expect(tree.setOnline(true)).toBe(true);
    expect(tree.load()).toBe('loading');
    expect(tree.project()).toEqual([]);
  });

  it('is ready with no rows after an empty first page (the empty welcome, not "loading")', () => {
    const tree = loaded([]);
    expect(tree.load()).toBe('ready');
    expect(tree.project()).toEqual([]);
    expect(tree.summary()).toEqual({ rows: 0, more: false });
  });

  it('empties the rows when the server goes away and ignores events until it is back', () => {
    const tree = loaded([row('a', at(21, 9))], { statuses: { a: BUSY } });
    tree.setOnline(false);
    expect(tree.load()).toBe('offline');
    expect(tree.project()).toEqual([]);
    expect(tree.event({ type: 'session.upserted', session: row('b', at(21, 10)) })).toBe(false);
    tree.setOnline(true);
    tree.reset({ folder: 'C:\\work', rows: [row('a', at(21, 9))], statuses: {}, hasMore: false });
    expect(only(tree, 'a').state).toBe('idle');
    expect(ids(tree)).toEqual(['a']);
  });
});

describe('a first page that could not be read', () => {
  // W1 of review 1 (decided by Sergio): the tree must not stay "loading" forever.
  it('is failed with no rows, ignores events, and a later reset recovers it', () => {
    const tree = loaded([row('a', at(21, 9))], { statuses: { a: BUSY } });
    expect(tree.fail()).toBe(true);
    expect(tree.load()).toBe('failed');
    expect(tree.project()).toEqual([]);
    expect(tree.summary()).toEqual({ rows: 0, more: false });
    expect(tree.event({ type: 'session.upserted', session: row('b', at(21, 10)) })).toBe(false);
    expect(tree.fail()).toBe(false);
    tree.reset({ folder: 'C:\\work', rows: [row('a', at(21, 9))], statuses: {}, hasMore: false });
    expect(tree.load()).toBe('ready');
    expect(ids(tree)).toEqual(['a']);
  });
});

describe('groups and rows', () => {
  it('files the rows in date groups, newest first, and adds "Show more sessions" only while there is more', () => {
    const rows = [
      row('today', at(21, 14, 32)),
      row('yesterday', at(20, 10)),
      row('week', at(16, 9)),
      row('old', new Date(2026, 8, 1).getTime()),
    ];
    const tree = loaded(rows, { hasMore: true });
    const nodes = tree.project();
    expect(nodes.map((n) => n.kind)).toEqual(['group', 'group', 'group', 'group', 'more']);
    const groups = nodes.filter((n): n is SessionTreeGroup => n.kind === 'group');
    expect(groups.map((g) => [g.label, g.children.map((c) => c.sessionID)])).toEqual([
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
      ['Previous 7 days', ['week']],
      ['Older', ['old']],
    ]);
    expect(nodes.at(-1)).toEqual({ kind: 'more', id: 'more', label: 'Show more sessions' });
    expect(
      loaded(rows, { hasMore: false })
        .project()
        .some((n) => n.kind === 'more'),
    ).toBe(false);
  });

  it('labels a session without a title "Untitled session"', () => {
    const tree = loaded([{ id: 'a', createdAt: 1, updatedAt: at(21, 9) }]);
    expect(only(tree, 'a').label).toBe('Untitled session');
  });

  it('puts the state words first and the time last, with only the ones that apply', () => {
    const tree = loaded(
      [
        row('plain', at(21, 9, 12)),
        row('both', at(21, 14, 32), { forkOf: 'x' }),
        row('fail', at(21, 10, 2)),
      ],
      { statuses: { both: BUSY, fail: FAILED } },
    );
    tree.setTabs(['both']);
    tree.setPending([{ sessionID: 'both' }]);
    expect(only(tree, 'plain').description).toBe('09:12');
    expect(only(tree, 'both').description).toBe('Needs input · Running · Tab · Fork · 14:32');
    expect(only(tree, 'fail').description).toBe('Failed · 10:02');
    expect(only(tree, 'both').accessibilityLabel).toBe(
      'Title both, Needs input, Running, Tab, Fork, 14:32',
    );
  });

  it('draws the most urgent state: needs input over running over failed over idle', () => {
    const tree = loaded([row('a', at(21, 9)), row('b', at(21, 8)), row('c', at(21, 7))], {
      statuses: { a: BUSY, b: FAILED },
    });
    expect(only(tree, 'c').icon).toEqual({ id: 'comment-discussion' });
    expect(only(tree, 'b').icon).toEqual({ id: 'error', color: 'list.errorForeground' });
    expect(only(tree, 'a').icon).toEqual({ id: 'loading~spin', color: 'charts.blue' });
    tree.setPending([{ sessionID: 'a' }]);
    expect(only(tree, 'a').icon).toEqual({ id: 'bell-dot', color: 'list.warningForeground' });
    expect(only(tree, 'a').state).toBe('needsInput');
  });

  it('builds the context value from running, tab and needs input, in that order', () => {
    const tree = loaded([row('a', at(21, 9)), row('b', at(21, 8))], { statuses: { a: BUSY } });
    expect(only(tree, 'b').contextValue).toBe('session');
    tree.setTabs(['a']);
    expect(only(tree, 'a').contextValue).toBe('session;running;tab');
    tree.setPending([{ sessionID: 'a' }]);
    expect(only(tree, 'a').contextValue).toBe('session;running;tab;needsInput');
  });

  it('writes the tooltip as plain lines: title, state, dates, agent and model', () => {
    const tree = loaded(
      [
        row('a', at(21, 14, 32), {
          agent: 'build',
          model: { providerID: 'anthropic', id: 'claude-sonnet-4-5' },
        }),
      ],
      { statuses: { a: BUSY } },
    );
    tree.setTabs(['a']);
    const lines = (tree.tooltipOf('a') ?? '').split('\n');
    expect(lines[0]).toBe('Title a');
    expect(lines[1]).toBe('Running · open in a tab');
    expect(lines[2]).toMatch(/^Last activity: .*14:32/u);
    expect(lines[3]).toMatch(/^Created: /u);
    expect(lines[4]).toBe('build · anthropic/claude-sonnet-4-5');
    expect(lines).toHaveLength(5); // no usage, no changed files, no folder: no such lines
    expect(tree.tooltipOf('ghost')).toBeUndefined();
  });
});

const USAGE = {
  cost: 1234.5,
  tokens: { input: 182340, output: 4210, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
};

describe('tooltip: usage, changed files and folder', () => {
  it('writes cost and tokens with the number format of the locale, only when the row has usage', () => {
    const tree = loaded([row('a', at(21, 9), { usage: USAGE }), row('b', at(21, 8))]);
    const lines = (tree.tooltipOf('a') ?? '').split('\n');
    expect(lines.at(-1)).toBe('Cost: 1.234,50 $ · Tokens: 182.340 in · 4.210 out');
    expect(tree.tooltipOf('b')).not.toContain('Cost');
    expect(tree.tooltipOf('a', 'en-US')).toContain(
      'Cost: $1,234.50 · Tokens: 182,340 in · 4,210 out',
    );
  });

  it('keeps four decimals for a cost under one cent so it does not read as zero', () => {
    const cheap = { ...USAGE, cost: 0.0042 };
    const tree = loaded([row('a', at(21, 9), { usage: cheap })]);
    expect(tree.tooltipOf('a', 'en-US')).toContain('Cost: $0.0042');
  });

  it('adds the changed files only when the caller knows the count, zero included', () => {
    const tree = loaded([row('a', at(21, 9))]);
    expect(tree.tooltipOf('a')).not.toContain('Changed files');
    expect(tree.tooltipOf('a', undefined, 3)).toContain('\nChanged files: 3');
    expect(tree.tooltipOf('a', undefined, 0)).toContain('\nChanged files: 0');
  });

  it('names the folder path of a placed session and nothing for a loose one', () => {
    const tree = loaded([row('a', at(21, 9)), row('b', at(21, 8))]);
    tree.setOrganization(organize());
    expect((tree.tooltipOf('a') ?? '').split('\n').at(-1)).toBe('Folder: Spikes / SSE');
    expect(tree.tooltipOf('b')).not.toContain('Folder');
  });
});

/** Spikes > SSE holding `a`; Docs empty. */
function organize(extra: (org: SessionOrganization) => SessionOrganization = (o) => o) {
  let org = emptyOrganization();
  for (const [id, name, parent] of [
    ['spikes', 'Spikes', undefined],
    ['sse', 'SSE', 'spikes'],
    ['docs', 'Docs', undefined],
  ] as const) {
    const made = createFolder(org, id, name, parent);
    if (!made.ok) throw new Error('fixture refused');
    org = made.org;
  }
  const moved = moveSessions(org, ['a'], 'sse');
  if (!moved.ok) throw new Error('fixture refused');
  return extra(moved.org);
}

/** Top-level nodes as `kind:label` strings, to read the order of the sections. */
const outline = (tree: ReturnType<typeof loaded>): string[] =>
  tree.project().map((node) => (node.kind === 'more' ? 'more' : `${node.kind}:${node.label}`));

describe('sections, folders and order', () => {
  it('orders needs attention, pinned, folders (alphabetical), dates, more and archived', () => {
    const tree = loaded(
      [
        row('a', at(21, 14)),
        row('run', at(21, 13)),
        row('pin', at(21, 12)),
        row('loose', at(21, 11)),
        row('old', at(20, 11)),
        row('arch', at(21, 10)),
      ],
      { statuses: { run: BUSY }, hasMore: true },
    );
    tree.setOrganization(
      organize((org) => archiveSessions(pinSessions(org, ['pin'], 1), ['arch'], 2)),
    );
    expect(outline(tree)).toEqual([
      'section:Needs attention',
      'section:Pinned',
      'folder:Docs',
      'folder:Spikes',
      'group:Today',
      'group:Yesterday',
      'more',
      'section:Archived',
    ]);
  });

  it('files a session in its folder only, not also under its date; subfolders come first', () => {
    const tree = loaded([row('a', at(21, 14)), row('s', at(21, 13)), row('loose', at(21, 11))]);
    tree.setOrganization(
      organize((org) => {
        const moved = moveSessions(org, ['s'], 'spikes');
        if (!moved.ok) throw new Error('fixture refused');
        return moved.org;
      }),
    );
    const nodes = tree.project();
    const spikes = nodes.find((n) => n.kind === 'folder' && n.folderID === 'spikes');
    if (spikes?.kind !== 'folder') throw new Error('no Spikes');
    expect(spikes.description).toBe('2');
    expect(spikes.children.map((c) => c.kind)).toEqual(['folder', 'session']);
    const group = nodes.find((n) => n.kind === 'group');
    expect(group?.kind === 'group' ? group.children.map((c) => c.sessionID) : []).toEqual([
      'loose',
    ]);
    expect(ids(tree)).toEqual(['a', 's', 'loose']); // every session exactly once
    expect(only(tree, 'a').contextValue).toBe('session;foldered');
    expect(only(tree, 'loose').contextValue).toBe('session');
  });

  it('shows an empty folder with a zero, and sorts folders with the locale', () => {
    const tree = loaded([row('a', at(21, 14))]);
    tree.setOrganization(organize());
    const docs = tree.project().find((n) => n.kind === 'folder' && n.label === 'Docs');
    expect(docs?.kind === 'folder' ? docs.description : '').toBe('0');
  });

  it('pinned goes by activity and leaves its folder; archived leaves folders and dates', () => {
    const tree = loaded([row('a', at(21, 9)), row('b', at(21, 12)), row('c', at(21, 10))]);
    tree.setOrganization(organize((org) => pinSessions(pinSessions(org, ['a'], 5), ['b'], 6)));
    const pinned = tree.project().find((n) => n.kind === 'section' && n.section === 'pinned');
    expect(pinned?.kind === 'section' ? pinned.children.map((c) => c.sessionID) : []).toEqual([
      'b',
      'a',
    ]);
    expect(only(tree, 'a').contextValue).toBe('session;pinned;foldered');
    const spikes = tree.project().find((n) => n.kind === 'folder' && n.folderID === 'spikes');
    expect(spikes?.kind === 'folder' ? spikes.description : '').toBe('0'); // `a` is in Pinned
  });

  it('puts an archived session only in Archived, collapsed last, and gives it its context value', () => {
    const tree = loaded([row('a', at(21, 9)), row('b', at(21, 8))]);
    tree.setOrganization(organize((org) => archiveSessions(org, ['a'], 5)));
    const nodes = tree.project();
    const last = nodes.at(-1);
    expect(last?.kind === 'section' ? [last.section, last.description] : []).toEqual([
      'archived',
      '1',
    ]);
    expect(only(tree, 'a').contextValue).toBe('session;archived;foldered');
    const spikes = nodes.find((n) => n.kind === 'folder' && n.folderID === 'spikes');
    expect(spikes?.kind === 'folder' ? spikes.description : '').toBe('0');
    // unarchiving puts it back in its folder
    tree.setOrganization(organize());
    expect(tree.project().at(-1)?.kind).not.toBe('section');
  });

  it('survives a placement into a folder that no longer exists and a corrupt folder loop', () => {
    const tree = loaded([row('a', at(21, 9))]);
    tree.setOrganization({
      version: 1,
      folders: { x: { name: 'X', parent: 'y' }, y: { name: 'Y', parent: 'x' } },
      placement: { a: 'ghost' },
      pinned: {},
      archived: {},
    });
    expect(ids(tree)).toEqual(['a']); // falls back to its date group
    expect(outline(tree)).toEqual(['group:Today']);
  });
});

describe('needs attention', () => {
  it('lists running and waiting sessions as shortcuts while the home row stays put', () => {
    const tree = loaded(
      [
        row('run', at(21, 14)),
        row('ask', at(21, 13)),
        row('fail', at(21, 12)),
        row('idle', at(21, 11)),
      ],
      { statuses: { run: BUSY, fail: FAILED } },
    );
    tree.setPending([{ sessionID: 'ask' }]);
    const nodes = tree.project();
    const section = nodes[0];
    if (section?.kind !== 'section') throw new Error('no section');
    expect(section.label).toBe('Needs attention');
    expect(section.description).toBe('2');
    expect(section.children.map((c) => [c.id, c.shortcut, c.group])).toEqual([
      ['attention:run', true, undefined],
      ['attention:ask', true, undefined],
    ]);
    expect(sessionIDsOf(nodes)).toEqual(['run', 'ask', 'run', 'ask', 'fail', 'idle']);
    expect(ids(tree)).toEqual(['run', 'ask', 'fail', 'idle']); // the homes, "Failed" not promoted
    expect(only(tree, 'run').id).toBe('session:run');
  });

  it('marks the root when a request belongs to a child, and keeps an archived one visible', () => {
    const tree = loaded([row('root', at(21, 12)), row('arch', at(21, 11))]);
    tree.event({ type: 'session.upserted', session: row('kid', at(21, 12), { parentID: 'root' }) });
    tree.setPending([{ sessionID: 'kid' }, { sessionID: 'arch' }]);
    tree.setOrganization(archiveSessions(emptyOrganization(), ['arch'], 1));
    const section = tree.project()[0];
    expect(section?.kind === 'section' ? section.children.map((c) => c.id) : []).toEqual([
      'attention:root',
      'attention:arch',
    ]);
    expect(tree.project().at(-1)?.kind).toBe('section'); // and still listed in Archived
  });

  it('has no section when nothing runs or waits', () => {
    const tree = loaded([row('a', at(21, 12))]);
    expect(outline(tree)).toEqual(['group:Today']);
    tree.event({ type: 'session.status', sessionID: 'a', status: BUSY });
    expect(outline(tree)).toEqual(['section:Needs attention', 'group:Today']);
    tree.event({ type: 'session.status', sessionID: 'a', status: { type: 'idle' } });
    expect(outline(tree)).toEqual(['group:Today']);
  });
});

describe('filters', () => {
  const ALL = { running: false, needsInput: false, tab: false };

  /** run (busy), ask (request), tab (open tab), idle; a folder `Docs` with `idle` and an empty `Empty`. */
  function filterable() {
    const tree = loaded(
      [
        row('run', at(21, 14)),
        row('ask', at(21, 13)),
        row('tab', at(21, 12)),
        row('idle', at(21, 11)),
      ],
      { statuses: { run: BUSY } },
    );
    tree.setPending([{ sessionID: 'ask' }]);
    tree.setTabs(['tab']);
    let org = emptyOrganization();
    for (const [id, name] of [
      ['docs', 'Docs'],
      ['empty', 'Empty'],
    ] as const) {
      const made = createFolder(org, id, name);
      if (!made.ok) throw new Error('fixture refused');
      org = made.org;
    }
    const moved = moveSessions(org, ['idle'], 'docs');
    if (!moved.ok) throw new Error('fixture refused');
    tree.setOrganization(moved.org);
    return tree;
  }

  it('combines the filters that are on with OR and says what it filters', () => {
    const tree = filterable();
    expect(tree.filterDescription()).toBeUndefined();
    expect(tree.setFilters({ ...ALL, running: true })).toBe(true);
    expect(ids(tree)).toEqual(['run']);
    expect(tree.filterDescription()).toBe('Filtered: Running');
    tree.setFilters({ running: true, needsInput: true, tab: true });
    expect(ids(tree)).toEqual(['run', 'ask', 'tab']);
    expect(tree.filterDescription()).toBe('Filtered: Running · Needs input · Open in a tab');
    tree.setFilters({ ...ALL, tab: true });
    expect(tree.filterDescription()).toBe('Filtered: Open in a tab');
    expect(tree.filters()).toEqual({ ...ALL, tab: true });
  });

  it('hides folders with nothing that matches while filtering, and shows them all again after', () => {
    const tree = filterable();
    expect(outline(tree)).toContain('folder:Empty');
    tree.setFilters({ ...ALL, running: true });
    expect(outline(tree)).toEqual(['section:Needs attention', 'group:Today']);
    expect(tree.setFilters({ ...ALL })).toBe(true);
    expect(outline(tree)).toContain('folder:Empty');
    expect(outline(tree)).toContain('folder:Docs');
  });

  it('reports a filter with no match as filteredEmpty, but not an empty tree or no filter', () => {
    const tree = filterable();
    expect(tree.filteredEmpty()).toBe(false);
    tree.setFilters({ ...ALL, running: true });
    expect(tree.filteredEmpty()).toBe(false);
    tree.event({ type: 'session.status', sessionID: 'run', status: { type: 'idle' } });
    expect(tree.filteredEmpty()).toBe(true);
    expect(tree.project().some((n) => n.kind === 'group')).toBe(false);
    expect(loaded([]).filteredEmpty()).toBe(false);
    const empty = loaded([]);
    empty.setFilters({ ...ALL, running: true });
    expect(empty.filteredEmpty()).toBe(false); // no rows at all: the plain empty welcome applies
  });
});

describe('adopt and orphans', () => {
  it('keeps adopted sessions across a reset while they are older than the page', () => {
    const tree = loaded([row('n1', at(21, 12))], { hasMore: true });
    expect(tree.adopt([row('old', at(1, 12)), row('kid', at(1, 13), { parentID: 'n1' })])).toBe(
      true,
    );
    expect(ids(tree)).toEqual(['n1', 'old']);
    expect(tree.summary()).toEqual({ rows: 2, more: true }); // "more" is untouched
    tree.reset({ folder: 'C:\\work', rows: [row('n1', at(21, 12))], statuses: {}, hasMore: true });
    expect(ids(tree)).toEqual(['n1', 'old']);
    // when the page turns out to be the whole list, nothing is kept
    tree.reset({ folder: 'C:\\work', rows: [row('n1', at(21, 12))], statuses: {}, hasMore: false });
    expect(ids(tree)).toEqual(['n1']);
  });

  it('says what to forget when the page is the whole list, with no request', () => {
    const tree = loaded([row('a', at(21, 12))]);
    tree.setOrganization(pinSessions(archiveSessions(organize(), ['arch'], 1), ['gone'], 1));
    const found = tree.orphans({ rows: [row('a', at(21, 12))], hasMore: false });
    expect(found.deleted.sort()).toEqual(['arch', 'gone']);
    expect(found.toRead).toEqual([]);
  });

  /**
   * Protects a session that arrives by `session.upserted` after the last full page and is then
   * organized: `applyLocation` reconciles with that old page when the user returns to editor mode,
   * and it must not be forgotten (review BLOCKER B1). Synthetic events (the model only).
   */
  it('does not call deleted a session the tree holds that the old page lacks', () => {
    const tree = loaded([row('a', at(21, 12))]);
    tree.event({ type: 'session.upserted', session: row('s', at(21, 13)) });
    tree.setOrganization(pinSessions(organize(), ['s', 'gone'], 1));
    const found = tree.orphans({ rows: [row('a', at(21, 12))], hasMore: false });
    expect(found.deleted).toEqual(['gone']);
  });

  it('asks to read only the organized sessions it does not hold when the page is partial', () => {
    const tree = loaded([row('a', at(21, 12))], { hasMore: true });
    tree.append([row('held', at(10, 12))], true);
    tree.setOrganization(pinSessions(archiveSessions(organize(), ['far', 'held'], 1), ['gone'], 1));
    const found = tree.orphans({ rows: [row('a', at(21, 12))], hasMore: true });
    expect(found.deleted).toEqual([]);
    expect(found.toRead.sort()).toEqual(['far', 'gone']);
    tree.adopt([row('far', at(2, 12))]);
    expect(tree.orphans({ rows: [row('a', at(21, 12))], hasMore: true }).toRead).toEqual(['gone']);
  });
});

describe('reset: the snapshot window', () => {
  it('replaces the rows inside the window and keeps the older ones the user loaded', () => {
    const tree = loaded([row('n1', at(21, 12)), row('n2', at(21, 11))], { hasMore: true });
    tree.append([row('o1', at(20, 12)), row('o2', at(19, 12))], false);
    expect(ids(tree)).toEqual(['n1', 'n2', 'o1', 'o2']);
    // The new first page lists a new row n0 and n2 (its oldest). n1 is inside that window and the
    // REST no longer lists it, so it leaves; o1 and o2 are older than the window, so they stay.
    tree.reset({
      folder: 'C:\\work',
      rows: [row('n0', at(21, 14)), row('n2', at(21, 11))],
      statuses: {},
      hasMore: true,
    });
    expect(ids(tree)).toEqual(['n0', 'n2', 'o1', 'o2']);
  });

  it('keeps nothing outside a page that is the whole list', () => {
    const tree = loaded([row('a', at(21, 12)), row('b', at(20, 12))], { hasMore: true });
    tree.reset({
      folder: 'C:\\work',
      rows: [row('a', at(21, 12))],
      statuses: {},
      hasMore: false,
    });
    expect(ids(tree)).toEqual(['a']);
  });

  it('empties the rows when the served folder changes', () => {
    const tree = loaded([row('a', at(21, 12)), row('z', at(1, 12))], { hasMore: true });
    tree.reset({
      folder: 'C:\\other',
      rows: [row('b', at(21, 13))],
      statuses: {},
      hasMore: true,
    });
    expect(ids(tree)).toEqual(['b']);
  });

  // Not a guard against a stale page: no old page is applied here, and `reset` has nothing to
  // resurrect a row from. The real guard (a page read before a delete) is "leaves out of the tree
  // a session deleted during the read" in `chatController.test.ts`.
  it('keeps a row removed by an event out of the tree after the next reset', () => {
    const tree = loaded([row('a', at(21, 12))], { hasMore: true });
    tree.append([row('gone', at(18, 12))], true);
    tree.event({ type: 'session.removed', sessionID: 'gone' });
    tree.reset({ folder: 'C:\\work', rows: [row('a', at(21, 12))], statuses: {}, hasMore: true });
    expect(ids(tree)).toEqual(['a']);
  });

  it('forgets the children it learnt when the served folder changes', () => {
    const tree = loaded([row('a', at(21, 12))]);
    tree.event({ type: 'session.upserted', session: row('kid', at(21, 13), { parentID: 'a' }) });
    tree.setPending([{ sessionID: 'kid' }]);
    expect(only(tree, 'a').state).toBe('needsInput');
    tree.reset({ folder: 'C:\\other', rows: [row('a', at(21, 12))], statuses: {}, hasMore: false });
    expect(only(tree, 'a').state).toBe('idle'); // the kid of the old folder marks nothing
  });

  it('keeps a Failed mark across a reset until the page says otherwise', () => {
    const tree = loaded([row('a', at(21, 12)), row('b', at(21, 11))], {
      statuses: { a: FAILED, b: FAILED },
    });
    tree.reset({
      folder: 'C:\\work',
      rows: [row('a', at(21, 12)), row('b', at(21, 11))],
      statuses: { b: { type: 'idle' } },
      hasMore: false,
    });
    expect(only(tree, 'a').state).toBe('failed');
    expect(only(tree, 'b').state).toBe('idle');
  });

  it('does not take a child session of the page for a row', () => {
    const tree = loaded([row('a', at(21, 12)), row('kid', at(21, 13), { parentID: 'a' })]);
    expect(ids(tree)).toEqual(['a']);
  });
});

describe('events', () => {
  it('puts a new root on top, renames in place and removes', () => {
    const tree = loaded([row('a', at(21, 12))]);
    expect(tree.event({ type: 'session.upserted', session: row('b', at(21, 13)) })).toBe(true);
    expect(ids(tree)).toEqual(['b', 'a']);
    tree.event({
      type: 'session.upserted',
      session: row('a', at(21, 14), { title: 'Renamed' }),
    });
    expect(ids(tree)).toEqual(['a', 'b']);
    expect(only(tree, 'a').label).toBe('Renamed');
    expect(tree.event({ type: 'session.removed', sessionID: 'a' })).toBe(true);
    expect(ids(tree)).toEqual(['b']);
  });

  it('never lets a child session in, whatever its timestamps', () => {
    const tree = loaded([row('a', at(21, 12))]);
    expect(
      tree.event({ type: 'session.upserted', session: row('kid', at(21, 15), { parentID: 'a' }) }),
    ).toBe(false);
    expect(ids(tree)).toEqual(['a']);
    expect(tree.summary().rows).toBe(1);
  });

  it('follows the status: busy and retry run, error fails, idle clears', () => {
    const tree = loaded([row('a', at(21, 12))]);
    tree.event({ type: 'session.status', sessionID: 'a', status: BUSY });
    expect(only(tree, 'a').state).toBe('running');
    tree.event({
      type: 'session.status',
      sessionID: 'a',
      status: { type: 'retry', attempt: 1, message: 'x', nextAt: 1 },
    });
    expect(only(tree, 'a').state).toBe('running');
    tree.event({ type: 'session.status', sessionID: 'a', status: FAILED });
    expect(only(tree, 'a').state).toBe('failed');
    expect(tree.event({ type: 'session.status', sessionID: 'a', status: { type: 'idle' } })).toBe(
      true,
    );
    expect(only(tree, 'a').state).toBe('idle');
  });

  it('reports no change for an upsert that alters nothing the tree shows (a usage tick)', () => {
    const tree = loaded([row('a', at(21, 12))]);
    const same = row('a', at(21, 12), { outcome: 'succeeded' });
    expect(tree.event({ type: 'session.upserted', session: same })).toBe(false);
    expect(tree.event({ type: 'session.status', sessionID: 'a', status: { type: 'idle' } })).toBe(
      false,
    );
    expect(tree.setTabs([])).toBe(false);
    expect(tree.setPending([])).toBe(false);
  });

  // Regression for the tooltip leaving the projection: it used to hold the cost, so every
  // `session.usage.updated` of a turn repainted the whole tree (risk R4 of E3).
  it('does not report a change when only the usage of a row moves, and the tooltip follows it', () => {
    const tree = loaded([row('a', at(21, 12), { usage: USAGE })]);
    const moved = row('a', at(21, 12), { usage: { ...USAGE, cost: 2000 } });
    expect(tree.event({ type: 'session.upserted', session: moved })).toBe(false);
    expect(tree.tooltipOf('a', 'en-US')).toContain('Cost: $2,000.00');
  });
});

describe('needs input', () => {
  it('marks the root for its own request and for a request of a child it knows', () => {
    const tree = loaded([row('root', at(21, 12)), row('other', at(21, 11))]);
    tree.event({
      type: 'session.upserted',
      session: row('kid', at(21, 12), { parentID: 'root' }),
    });
    expect(tree.setPending([{ sessionID: 'kid' }])).toBe(true);
    expect(only(tree, 'root').state).toBe('needsInput');
    expect(only(tree, 'other').state).toBe('idle');
    tree.setPending([{ sessionID: 'other' }]);
    expect(only(tree, 'other').state).toBe('needsInput');
    expect(only(tree, 'root').state).toBe('idle');
  });

  it('marks nothing for a request of a session whose parent it never heard of (E4 owns that)', () => {
    const tree = loaded([row('root', at(21, 12))]);
    expect(tree.setPending([{ sessionID: 'stranger' }])).toBe(false);
    expect(only(tree, 'root').state).toBe('idle');
  });
});

describe('tabs', () => {
  it('marks the sessions that have a tab and unmarks them', () => {
    const tree = loaded([row('a', at(21, 12))]);
    expect(tree.setTabs(['a'])).toBe(true);
    expect(only(tree, 'a').description).toBe('Tab · 12:00');
    tree.setTabs([]);
    expect(only(tree, 'a').description).toBe('12:00');
  });
});

describe('append', () => {
  it('adds the next page without duplicates and takes its "more" flag', () => {
    const tree = loaded([row('a', at(21, 12))], { hasMore: true });
    expect(tree.append([row('a', at(21, 12)), row('b', at(20, 12))], false)).toBe(true);
    expect(ids(tree)).toEqual(['a', 'b']);
    expect(tree.project().some((n) => n.kind === 'more')).toBe(false);
  });
});

describe('msUntilNextLocalMidnight', () => {
  it('counts to the next local midnight', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 9, 21, 23, 0).getTime())).toBe(3_600_000);
    expect(msUntilNextLocalMidnight(new Date(2026, 9, 21, 0, 0, 0, 0).getTime())).toBe(
      new Date(2026, 9, 22).getTime() - new Date(2026, 9, 21).getTime(),
    );
  });
});
