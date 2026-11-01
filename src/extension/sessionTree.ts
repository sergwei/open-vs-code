// The model behind the native "Sessions" tree of the editor mode (issue #77, delivery E3; sections,
// folders and filters since plan E9-sessions-organize). Pure: no `vscode`, no I/O, so Vitest drives
// it with plain data. The VS Code glue (`TreeDataProvider`, commands, badge) only maps the nodes
// {@link SessionTree.project} returns onto `TreeItem`s and forwards what the controller reports
// (`SessionListSink` in `chatController.ts`), what `chatLifecycle` knows (the pending requests and
// the open tabs) and what the user organized ({@link SessionOrganization}, `sessionOrganization.ts`).
//
// What it holds: the ROOT sessions of the served folder, newest activity first; the live status of
// the sessions (only the non-idle ones); the pending requests per session; the sessions that have
// a tab; the organization (folders, pins, archive); the filters; whether the server is reachable
// (`offline | loading | ready`); and whether the server may have more pages. Sub-agent sessions
// never become rows (decision Q6=1), but a child announced by an event leaves its `parentID`
// behind, so a request of that child marks its ROOT as "Needs input" (one level here). Since issue
// #77 E4 the host hands this model the ROOT of each pending request (`ChatController.rootOf`, which
// walks the whole lineage), so a request of any depth marks its root and the one-level `parentOf`
// below is only the fallback for a chain the host has not completed yet.
//
// The projection, top to bottom: "Needs attention" (a shortcut row, id `attention:<id>`, for every
// session that runs or waits for input; the row also stays in its home), "Pinned", the folders
// (alphabetical, subfolders first, no date groups inside), the date groups of the sessions that are
// in no folder, "Show more sessions", and a last "Archived". Each session has ONE home row
// (`session:<id>`): pinned in Pinned, archived in Archived, placed in its folder, else in its date
// group. A tooltip is NOT part of the projection: {@link SessionTree.tooltipOf} builds it when VS
// Code asks (`resolveTreeItem`), so the cost line changing at every step of a turn repaints nothing.
//
// Why `reset` only prunes inside the page window (opencode-api §4, "el snapshot es una foto"): a
// full resync reads the 50 newest roots, but the user may have loaded older ones with "Show more",
// or the glue may have {@link SessionTree.adopt}ed organized sessions that fell off the page. Rows
// at least as new as the oldest row of the page are replaced by the page (those the REST no longer
// lists are gone); older loaded rows stay, because the REST did not look at them. When the page is
// the whole list (`hasMore` false) nothing is kept.

import type { ModelRef, SessionStatus, SessionSummary, SessionUsage } from '../shared/model';
import type { HostToWebview } from '../shared/protocol';
import { formatSessionTime, groupSessions, type GroupLabel } from '../shared/sessionGroups';
import { sessionLabel } from '../shared/sessionLabel';
import {
  childFolders,
  emptyOrganization,
  folderOf,
  folderPath,
  isArchived,
  isPinned,
  organizedSessionIDs,
  type FolderID,
  type SessionOrganization,
} from './sessionOrganization';

/**
 * Whether the list can be shown: no server, waiting for the first page, loaded, or the first page
 * could not be read (`failed`: empty rows and a message, until the next full resync retries).
 */
export type SessionTreeLoad = 'offline' | 'loading' | 'ready' | 'failed';

/** The most urgent thing a row says, which picks its icon: needs input > running > failed > idle. */
export type SessionTreeState = 'needsInput' | 'running' | 'failed' | 'idle';

/** A codicon id and, when the state has one, the id of the theme color it is drawn with. */
export interface SessionTreeIcon {
  id: string;
  color?: string;
}

/** One date group of the tree ("Today", ...); its children are session rows. */
export interface SessionTreeGroup {
  kind: 'group';
  id: string;
  label: GroupLabel;
  children: SessionTreeSession[];
}

/** The three sections around the folders and the dates. */
export type SessionTreeSectionKind = 'attention' | 'pinned' | 'archived';

/** "Needs attention", "Pinned" or "Archived"; `description` is the number of rows inside. */
export interface SessionTreeSection {
  kind: 'section';
  id: `section:${SessionTreeSectionKind}`;
  section: SessionTreeSectionKind;
  label: string;
  description: string;
  children: SessionTreeSession[];
}

/** A user folder; `description` counts the sessions shown inside it, subfolders included. */
export interface SessionTreeFolder {
  kind: 'folder';
  id: string;
  folderID: FolderID;
  label: string;
  description: string;
  contextValue: 'folder';
  children: (SessionTreeFolder | SessionTreeSession)[];
}

/**
 * One session row. It carries no tooltip (see {@link SessionTree.tooltipOf}). `shortcut` marks the
 * duplicate under "Needs attention" (id `attention:<id>`); the home row has id `session:<id>`.
 * `group` is the date group, `undefined` for a row that sits in a section or a folder.
 */
export interface SessionTreeSession {
  kind: 'session';
  id: string;
  sessionID: string;
  shortcut: boolean;
  group: GroupLabel | undefined;
  label: string;
  description: string;
  state: SessionTreeState;
  icon: SessionTreeIcon;
  contextValue: string;
  accessibilityLabel: string;
}

/** The last row of the date groups while the server may have more pages. */
export interface SessionTreeMore {
  kind: 'more';
  id: 'more';
  label: 'Show more sessions';
}

/** A node of the projection; sessions only appear as children of a section, folder or group. */
export type SessionTreeNode =
  SessionTreeSection | SessionTreeFolder | SessionTreeGroup | SessionTreeSession | SessionTreeMore;

/** What a full read of the first page brings. */
export interface SessionTreePage {
  /** The folder the server serves; another folder than the held one empties the rows first. */
  folder: string;
  /** Root sessions, newest activity first. */
  rows: readonly SessionSummary[];
  /** The live status of the sessions; absent or `idle` means not running. */
  statuses: Readonly<Record<string, SessionStatus>>;
  hasMore: boolean;
}

/** The session events the model follows; everything else the controller publishes is not its. */
export type SessionTreeEvent = Extract<
  HostToWebview,
  { type: 'session.upserted' | 'session.removed' | 'session.status' }
>;

/** What the model needs from the outside, both optional (tests inject them). */
export interface SessionTreeOptions {
  /** Epoch milliseconds "now"; defaults to `Date.now`. Only used to judge whether a change shows. */
  now?: () => number;
  /** BCP 47 tag for the dates; `undefined` is the `Intl` default. */
  locale?: string;
}

/** The title-bar filters; the ones that are on combine with OR, none on means no filter. */
export interface SessionTreeFilters {
  running: boolean;
  needsInput: boolean;
  tab: boolean;
}

/** Organized sessions the page did not bring: the ones to forget and the ones worth reading. */
export interface SessionTreeOrphans {
  /**
   * Organized ids that no longer exist: the page was the whole list, they are not in it AND the
   * tree does not hold them (one that came by an event after the page is alive).
   */
  deleted: string[];
  /** Organized ids not held and not in the page, which the server may still have (page was partial). */
  toRead: string[];
}

/** The model returned by {@link createSessionTree}. */
export interface SessionTree {
  load(): SessionTreeLoad;
  /** Rows held and whether the server may have more; for the host's log line. */
  summary(): { rows: number; more: boolean };
  /** The held root row, if any (the glue reads the current title for the Rename box). */
  rowOf(sessionID: string): SessionSummary | undefined;
  /**
   * The server became reachable (`true`: waits for the first page) or not (`false`: rows and
   * statuses are emptied, decision Q10=1: no row on which Rename or Delete would fail).
   */
  setOnline(online: boolean): boolean;
  /** Applies a full read of the first page; see the header for the window rule. */
  reset(page: SessionTreePage): boolean;
  /**
   * The read of the first page failed: rows and statuses are emptied and the state is `failed`
   * (decision W1 of review 1). Events are ignored until a later `reset` brings the page.
   */
  fail(): boolean;
  /** Adds the next page ("Show more"): rows already held are replaced, nothing is pruned. */
  append(rows: readonly SessionSummary[], hasMore: boolean): boolean;
  /**
   * Adds organized sessions read one by one because they were not in the page (decision Q12=1).
   * Unlike `append` it leaves the "more" flag alone. A later `reset` keeps them while they are
   * older than the page, like the rows of "Show more". Children are ignored.
   */
  adopt(rows: readonly SessionSummary[]): boolean;
  /** Which organized sessions the page does not bring; see {@link SessionTreeOrphans}. */
  orphans(page: Pick<SessionTreePage, 'rows' | 'hasMore'>): SessionTreeOrphans;
  /** Applies one session event. A child session never becomes a row. */
  event(message: SessionTreeEvent): boolean;
  /** Replaces the set of pending requests (only `sessionID` is read). */
  setPending(requests: readonly { sessionID: string }[]): boolean;
  /** Replaces the set of sessions that have a chat tab. */
  setTabs(sessionIDs: Iterable<string>): boolean;
  /** Replaces the organization the tree lays the rows out with. */
  setOrganization(organization: SessionOrganization): boolean;
  /** The organization currently held. */
  organization(): SessionOrganization;
  /** Replaces the filters. */
  setFilters(filters: SessionTreeFilters): boolean;
  /** The filters currently held. */
  filters(): SessionTreeFilters;
  /** `Filtered: Running · Open in a tab` while a filter is on, else `undefined`. */
  filterDescription(): string | undefined;
  /** A filter is on, there are rows, and none matches: the glue shows its "no match" welcome. */
  filteredEmpty(): boolean;
  /** The tree as it reads at `now`; empty unless the load state is `ready`. */
  project(now?: number, locale?: string): SessionTreeNode[];
  /**
   * The tooltip of a row as plain lines, or `undefined` if the session is not held. The glue
   * appends it as text, never as Markdown. `changedFiles` is the count the caller knows (the open
   * tab's diff), absent when unknown.
   */
  tooltipOf(sessionID: string, locale?: string, changedFiles?: number): string | undefined;
}

/** Children remembered for the "Needs input" rule; the oldest is forgotten past this (own choice). */
const MAX_KNOWN_CHILDREN = 1000;

/** Newest activity first, the id as tie-break: the order the server uses (planner spike, 21/10/2026). */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  return b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1);
}

/**
 * Milliseconds from `now` to the next LOCAL midnight, when "Today" turns into "Yesterday". Built
 * with calendar arithmetic (`new Date(y, m, d + 1)`), not `+ 24 h`, so a daylight-saving day of 23
 * or 25 hours does not make the timer fire an hour early or late. VERIFIED by `sessionTree.test.ts`
 * "counts to the next local midnight" (dates from local components, Windows 11, 29/10/2026).
 */
export function msUntilNextLocalMidnight(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - now;
}

/** One formatter per locale: a projection dates hundreds of rows and builds this on every event. */
const fullDateFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * The full date and hour of the tooltip; same locale rule as {@link formatSessionTime}. The
 * formatter is cached per locale (S2 of review 1: constructing one per row on every event is the
 * expensive part of `Intl`). VERIFIED by `sessionTree.test.ts` "writes the tooltip as plain lines:
 * title, state, dates, agent and model" (Vitest, Windows 11, 29/10/2026); the saving itself was
 * not measured.
 */
function fullDate(ts: number, locale: string | undefined): string {
  const key = locale ?? '';
  let format = fullDateFormats.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    fullDateFormats.set(key, format);
  }
  return format.format(new Date(ts));
}

/** Formatters of the cost line, by locale and number of decimals. */
const costFormats = new Map<string, Intl.NumberFormat>();

/** Token counts are plain integers; one formatter per locale. */
const countFormats = new Map<string, Intl.NumberFormat>();

/**
 * The cost as money. Assumes US dollars, which is what opencode reports (HYPOTHESIS: read in the
 * `usage` of `SessionSummary`, never compared with a bill; the currency is not in the payload). A
 * cost under one cent shows four decimals so that a cheap session does not read as `$0.00`.
 */
function costText(cost: number, locale: string | undefined): string {
  const digits = cost > 0 && cost < 0.01 ? 4 : 2;
  const key = `${locale ?? ''}|${String(digits)}`;
  let format = costFormats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    costFormats.set(key, format);
  }
  return format.format(cost);
}

/** A token count with the grouping of the locale. */
function countText(count: number, locale: string | undefined): string {
  const key = locale ?? '';
  let format = countFormats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale);
    countFormats.set(key, format);
  }
  return format.format(count);
}

/** The cost and tokens line of the tooltip: input and output only, cache and reasoning left out. */
function usageLine(usage: SessionUsage, locale: string | undefined): string {
  return `Cost: ${costText(usage.cost, locale)} · Tokens: ${countText(usage.tokens.input, locale)} in · ${countText(usage.tokens.output, locale)} out`;
}

/** `provider/model`, the way the tooltip names a model. */
function modelText(model: ModelRef): string {
  return `${model.providerID}/${model.id}`;
}

/** Whether a status means the agent is working. */
function isRunning(status: SessionStatus | undefined): boolean {
  return status?.type === 'busy' || status?.type === 'retry';
}

/**
 * The icon of a state. VERIFIED by a full `npm run test:visual` (Windows 11, VS Code 1.144.0,
 * 30/10/2026, 0 FAIL): "ok   V1 setup: the tab of B is the active one and the selection of the tree
 * follows it (active true, row selected true)", then "ok   V1 dark: …" measured N `codicon-bell-dot`
 * 7.69:1 and F `codicon-error` 7.03:1 on rows with "selected false", all >= 3 (same run, N and F:
 * light 5.44:1 and 6.75:1, hc-dark 21.00:1 and 21.00:1, hc-light 14.55:1 and 14.55:1). Not observed: a selected row, where
 * VS Code paints the icon with the list foreground.
 */
function iconOf(state: SessionTreeState): SessionTreeIcon {
  switch (state) {
    case 'needsInput':
      return { id: 'bell-dot', color: 'list.warningForeground' };
    case 'running':
      return { id: 'loading~spin', color: 'charts.blue' };
    case 'failed':
      return { id: 'error', color: 'list.errorForeground' };
    case 'idle':
      return { id: 'comment-discussion' };
  }
}

/**
 * Creates an empty model: `offline`, no rows, no organization, no filter. Decisions: Q1=1 (state
 * words first in the description, when the title leaves room: with a long title VS Code hides the
 * whole description and the state lives in the icon, tooltip and aria; decision C1 of review 1),
 * Q6=1 (roots only), Q10=1 (offline empties the rows), T3=1 (the glue refreshes the whole tree;
 * `changed` below says when). Of E9-sessions-organize: Q4=1 (a session in a folder is only there,
 * not also under its date), Q5=1 (the attention shortcut duplicates the row, "Failed" does not
 * qualify), Q7=1 (filters live in memory, here), Q11=1 (folders alphabetical, sessions by
 * activity, pinned by activity).
 * The order of the rows only changes with the events that move a session's update time, so it can
 * be stale until the next reconnection (risk R3 of the plan; README "Known limitations").
 * Every mutator returns whether the VISIBLE projection changed, judged by comparing the projection
 * before and after: a `session.upserted` that only moves usage (one per agent step) repaints
 * nothing, and now cannot, because the usage lives in the tooltip, which is outside the projection.
 * VERIFIED by `sessionTree.test.ts` (Vitest, Windows 11, 01/11/2026): "reports no change for an
 * upsert that alters nothing the tree shows (a usage tick)" and "does not report a change when only
 * the usage of a row moves" pass. The rows and events are FABRICATED: that proves the logic, not
 * what a real server sends (the shapes come from `chatController.e2e.test.ts`). `fail` is the state
 * of a first page that could not be read.
 * HYPOTHESIS: keeping `error` statuses across a `reset` (REST only says "active or not", so a
 * "Failed" mark would otherwise vanish at every reconnection); to check, fail a turn, reconnect
 * and see whether the row still says Failed until the next run.
 */
export function createSessionTree(options: SessionTreeOptions = {}): SessionTree {
  const clock = options.now ?? Date.now;
  let load: SessionTreeLoad = 'offline';
  let folder: string | undefined;
  let rows: SessionSummary[] = [];
  let hasMore = false;
  /** Non-idle statuses by session id (children included). */
  const statuses = new Map<string, SessionStatus>();
  /** Child session id -> its parent, learnt from events; bounded, oldest first. */
  const parentOf = new Map<string, string>();
  let pending: readonly { sessionID: string }[] = [];
  let tabs = new Set<string>();
  let organization: SessionOrganization = emptyOrganization();
  let filters: SessionTreeFilters = { running: false, needsInput: false, tab: false };

  /** Root ids whose row says "Needs input": an own request or one of a known child. */
  function needsInputIds(): Set<string> {
    const roots = new Set(rows.map((row) => row.id));
    const marked = new Set<string>();
    for (const { sessionID } of pending) {
      if (roots.has(sessionID)) marked.add(sessionID);
      else {
        const parent = parentOf.get(sessionID);
        if (parent !== undefined && roots.has(parent)) marked.add(parent);
      }
    }
    return marked;
  }

  /** Whether any title-bar filter is on. */
  function filtering(): boolean {
    return filters.running || filters.needsInput || filters.tab;
  }

  /** Whether `row` passes the filters (all rows pass when none is on; the ones on are ORed). */
  function passes(row: SessionSummary, marked: ReadonlySet<string>): boolean {
    if (!filtering()) return true;
    return (
      (filters.running && isRunning(statuses.get(row.id))) ||
      (filters.needsInput && marked.has(row.id)) ||
      (filters.tab && tabs.has(row.id))
    );
  }

  /** The state words of a row, in the order the description and the tooltip use. */
  function flagsOf(row: SessionSummary, marked: ReadonlySet<string>) {
    const status = statuses.get(row.id);
    return {
      needsInput: marked.has(row.id),
      running: isRunning(status),
      failed: status?.type === 'error',
      tab: tabs.has(row.id),
      fork: row.forkOf !== undefined,
    };
  }

  /** Builds the node of one row; `shortcut` makes it the "Needs attention" duplicate. */
  function sessionNode(
    row: SessionSummary,
    group: GroupLabel | undefined,
    marked: ReadonlySet<string>,
    now: number,
    locale: string | undefined,
    shortcut: boolean,
  ): SessionTreeSession {
    const { needsInput, running, failed, tab, fork } = flagsOf(row, marked);
    const state: SessionTreeState = needsInput
      ? 'needsInput'
      : running
        ? 'running'
        : failed
          ? 'failed'
          : 'idle';
    const words = [
      ...(needsInput ? ['Needs input'] : []),
      ...(running ? ['Running'] : []),
      ...(failed ? ['Failed'] : []),
      ...(tab ? ['Tab'] : []),
      ...(fork ? ['Fork'] : []),
    ];
    const time = formatSessionTime(row.updatedAt, now, locale);
    const label = sessionLabel(row);
    const pinned = isPinned(organization, row.id);
    const archived = isArchived(organization, row.id);
    const foldered = folderOf(organization, row.id) !== undefined;
    return {
      kind: 'session',
      id: `${shortcut ? 'attention' : 'session'}:${row.id}`,
      sessionID: row.id,
      shortcut,
      group,
      label,
      description: [...words, time].join(' · '),
      state,
      icon: iconOf(state),
      contextValue: `session${running ? ';running' : ''}${tab ? ';tab' : ''}${needsInput ? ';needsInput' : ''}${pinned ? ';pinned' : ''}${archived ? ';archived' : ''}${foldered ? ';foldered' : ''}`,
      accessibilityLabel: [label, ...words, time].join(', '),
    };
  }

  /** The rows that pass the filters, newest first. */
  function visibleRows(marked: ReadonlySet<string>): SessionSummary[] {
    return rows.filter((row) => passes(row, marked));
  }

  /**
   * The tree at `now`: the sections and folders described in the header, then the date groups of
   * the loose sessions and the "Show more sessions" row while the server may have more. Empty
   * unless the state is `ready`, so the glue shows its welcome (offline) or its loading message
   * instead. With a filter on, a folder with nothing that matches is left out and so is an empty
   * section; with none on, every folder shows, empty ones included.
   */
  function project(
    now: number = clock(),
    locale: string | undefined = options.locale,
  ): SessionTreeNode[] {
    if (load !== 'ready') return [];
    const marked = needsInputIds();
    const visible = visibleRows(marked);
    const home = (row: SessionSummary, group?: GroupLabel): SessionTreeSession =>
      sessionNode(row, group, marked, now, locale, false);
    const section = (
      kind: SessionTreeSectionKind,
      label: string,
      children: SessionTreeSession[],
    ): SessionTreeSection[] =>
      children.length === 0
        ? []
        : [
            {
              kind: 'section',
              id: `section:${kind}`,
              section: kind,
              label,
              description: String(children.length),
              children,
            },
          ];

    const attention = visible.filter(
      (row) => isRunning(statuses.get(row.id)) || marked.has(row.id),
    );
    const archivedRows = visible.filter((row) => isArchived(organization, row.id));
    const live = visible.filter((row) => !isArchived(organization, row.id));
    const pinnedRows = live.filter((row) => isPinned(organization, row.id));
    const rest = live.filter((row) => !isPinned(organization, row.id));

    const byFolder = new Map<FolderID, SessionSummary[]>();
    const loose: SessionSummary[] = [];
    for (const row of rest) {
      const where = folderOf(organization, row.id);
      if (where === undefined) loose.push(row);
      else byFolder.set(where, [...(byFolder.get(where) ?? []), row]);
    }

    /** The node of a folder and how many sessions it shows; `undefined` when it is hidden. */
    const folderNode = (
      id: FolderID,
      seen: ReadonlySet<FolderID>,
    ): { node: SessionTreeFolder; count: number } | undefined => {
      if (seen.has(id)) return undefined; // a corrupt loop must not recurse forever
      const nextSeen = new Set(seen).add(id);
      const subfolders = childFolders(organization, id)
        .map((child) => folderNode(child, nextSeen))
        .filter((found): found is { node: SessionTreeFolder; count: number } => found !== undefined)
        .sort((a, b) => a.node.label.localeCompare(b.node.label, locale));
      const own = (byFolder.get(id) ?? []).map((row) => home(row));
      const count = own.length + subfolders.reduce((sum, found) => sum + found.count, 0);
      if (count === 0 && filtering()) return undefined;
      return {
        count,
        node: {
          kind: 'folder',
          id: `folder:${id}`,
          folderID: id,
          label: organization.folders[id]?.name ?? id,
          description: String(count),
          contextValue: 'folder',
          children: [...subfolders.map((found) => found.node), ...own],
        },
      };
    };
    const folders = childFolders(organization, undefined)
      .map((id) => folderNode(id, new Set()))
      .filter((found): found is { node: SessionTreeFolder; count: number } => found !== undefined)
      .map((found) => found.node)
      .sort((a, b) => a.label.localeCompare(b.label, locale));

    const nodes: SessionTreeNode[] = [
      ...section(
        'attention',
        'Needs attention',
        attention.map((row) => sessionNode(row, undefined, marked, now, locale, true)),
      ),
      ...section(
        'pinned',
        'Pinned',
        pinnedRows.map((row) => home(row)),
      ),
      ...folders,
      ...groupSessions(loose, now).map((group): SessionTreeGroup => ({
        kind: 'group',
        id: `group:${group.label}`,
        label: group.label,
        children: group.rows.map((row) => home(row, group.label)),
      })),
    ];
    if (hasMore) nodes.push({ kind: 'more', id: 'more', label: 'Show more sessions' });
    nodes.push(
      ...section(
        'archived',
        'Archived',
        archivedRows.map((row) => home(row)),
      ),
    );
    return nodes;
  }

  /** Runs `change` and says whether what the tree shows is different afterwards. */
  function mutate(change: () => void): boolean {
    const signature = (): string => `${load}|${JSON.stringify(project())}`;
    const before = signature();
    change();
    return signature() !== before;
  }

  /** Remembers that `child` belongs to `parent`, forgetting the oldest entry past the cap. */
  function rememberChild(child: string, parent: string): void {
    parentOf.delete(child);
    parentOf.set(child, parent);
    if (parentOf.size > MAX_KNOWN_CHILDREN) {
      const oldest = parentOf.keys().next();
      if (oldest.done !== true) parentOf.delete(oldest.value);
    }
  }

  /** Puts `row` in the held rows (replacing the same id) and re-sorts. */
  function upsert(row: SessionSummary): void {
    rows = [...rows.filter((held) => held.id !== row.id), row].sort(byRecency);
  }

  return {
    load: () => load,
    summary: () => ({ rows: rows.length, more: hasMore }),
    rowOf: (sessionID) => rows.find((row) => row.id === sessionID),

    setOnline(online) {
      return mutate(() => {
        if (!online) {
          load = 'offline';
          rows = [];
          hasMore = false;
          statuses.clear();
        } else if (load === 'offline') {
          load = 'loading';
        }
      });
    },

    reset(page) {
      return mutate(() => {
        if (page.folder !== folder) {
          folder = page.folder;
          rows = [];
          statuses.clear();
          parentOf.clear();
        }
        const roots = page.rows.filter((row) => row.parentID === undefined);
        const pageIds = new Set(roots.map((row) => row.id));
        const oldest = roots.reduce<number | undefined>(
          (min, row) => (min === undefined ? row.updatedAt : Math.min(min, row.updatedAt)),
          undefined,
        );
        const kept =
          page.hasMore && oldest !== undefined
            ? rows.filter((row) => row.updatedAt < oldest && !pageIds.has(row.id))
            : [];
        const failed = [...statuses].filter(
          ([id, status]) => status.type === 'error' && !(id in page.statuses),
        );
        rows = [...roots, ...kept].sort(byRecency);
        hasMore = page.hasMore;
        statuses.clear();
        const held = new Set(rows.map((row) => row.id));
        for (const [id, status] of failed) if (held.has(id)) statuses.set(id, status);
        for (const [id, status] of Object.entries(page.statuses)) {
          if (status.type !== 'idle') statuses.set(id, status);
        }
        load = 'ready';
      });
    },

    fail() {
      return mutate(() => {
        load = 'failed';
        rows = [];
        hasMore = false;
        statuses.clear();
      });
    },

    append(more, nextHasMore) {
      return mutate(() => {
        for (const row of more) if (row.parentID === undefined) upsert(row);
        hasMore = nextHasMore;
      });
    },

    adopt(adopted) {
      return mutate(() => {
        for (const row of adopted) if (row.parentID === undefined) upsert(row);
      });
    },

    orphans(page) {
      const organized = organizedSessionIDs(organization);
      const inPage = new Set(
        page.rows.filter((row) => row.parentID === undefined).map((row) => row.id),
      );
      const held = new Set(rows.map((row) => row.id));
      if (!page.hasMore) {
        // A session the tree holds but the page lacks arrived by an event after the page: alive.
        return {
          deleted: organized.filter((id) => !inPage.has(id) && !held.has(id)),
          toRead: [],
        };
      }
      return {
        deleted: [],
        toRead: organized.filter((id) => !inPage.has(id) && !held.has(id)),
      };
    },

    event(message) {
      if (load === 'offline' || load === 'failed') return false;
      return mutate(() => {
        switch (message.type) {
          case 'session.upserted': {
            const row = message.session;
            if (row.parentID !== undefined) rememberChild(row.id, row.parentID);
            else upsert(row);
            return;
          }
          case 'session.removed':
            rows = rows.filter((row) => row.id !== message.sessionID);
            statuses.delete(message.sessionID);
            parentOf.delete(message.sessionID);
            return;
          case 'session.status':
            if (message.status.type === 'idle') statuses.delete(message.sessionID);
            else statuses.set(message.sessionID, message.status);
            return;
        }
      });
    },

    setPending(requests) {
      return mutate(() => {
        pending = [...requests];
      });
    },

    setTabs(sessionIDs) {
      return mutate(() => {
        tabs = new Set(sessionIDs);
      });
    },

    setOrganization(next) {
      return mutate(() => {
        organization = next;
      });
    },

    organization: () => organization,

    setFilters(next) {
      return mutate(() => {
        filters = { ...next };
      });
    },

    filters: () => ({ ...filters }),

    filterDescription() {
      if (!filtering()) return undefined;
      const names = [
        ...(filters.running ? ['Running'] : []),
        ...(filters.needsInput ? ['Needs input'] : []),
        ...(filters.tab ? ['Open in a tab'] : []),
      ];
      return `Filtered: ${names.join(' · ')}`;
    },

    filteredEmpty() {
      return (
        load === 'ready' &&
        filtering() &&
        rows.length > 0 &&
        visibleRows(needsInputIds()).length === 0
      );
    },

    project,

    tooltipOf(sessionID, locale = options.locale, changedFiles) {
      const row = rows.find((held) => held.id === sessionID);
      if (row === undefined) return undefined;
      const { needsInput, running, failed, tab, fork } = flagsOf(row, needsInputIds());
      const stateLine = [
        ...(needsInput ? ['Needs input'] : []),
        ...(running ? ['Running'] : []),
        ...(failed ? ['Failed'] : []),
        ...(tab ? ['open in a tab'] : []),
        ...(fork ? ['Fork'] : []),
      ].join(' · ');
      const selection = [row.agent, row.model === undefined ? undefined : modelText(row.model)]
        .filter((part): part is string => part !== undefined)
        .join(' · ');
      const where = folderOf(organization, row.id);
      const path = where === undefined ? [] : folderPath(organization, where);
      return [
        sessionLabel(row),
        ...(stateLine === '' ? [] : [stateLine]),
        `Last activity: ${fullDate(row.updatedAt, locale)}`,
        `Created: ${fullDate(row.createdAt, locale)}`,
        ...(selection === '' ? [] : [selection]),
        ...(row.usage === undefined ? [] : [usageLine(row.usage, locale)]),
        ...(changedFiles === undefined ? [] : [`Changed files: ${String(changedFiles)}`]),
        ...(path.length === 0 ? [] : [`Folder: ${path.join(' / ')}`]),
      ].join('\n');
    },
  };
}
