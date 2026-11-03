// The consent policy for the plugins a folder brings (issue #153): when the extension may launch
// `opencode serve` there, what is remembered, and the texts shown. Pure: no `vscode`, the store
// sits on a `{ get, update }` pair (a `Memento`) and the wording is built here so it is tested.
// `pluginConsentUi.ts` is the part that talks to VS Code.

import * as path from 'node:path';
import { sanitizeLinkText } from './attentionPolicy';
import { folderKey, type PluginFinding } from './projectPlugins';

/** What was answered for a folder, with the fingerprint of the plugins it was answered for. */
export interface StoredDecision {
  decision: 'allow' | 'deny';
  fingerprint: string;
  /** Epoch milliseconds, only informative. */
  at: number;
}

/**
 * What to do with a launch: `go` launches; `hold` stays unlaunched in silence; `notify` stays
 * unlaunched and shows the non-modal notice; `confirm` asks in a modal and waits for the answer.
 */
export type LaunchAction = 'go' | 'hold' | 'notify' | 'confirm';

/** The part of VS Code's `Memento` the store needs. */
export interface DecisionMemento {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** How many entries a message lists before "and N more". */
export const MAX_LISTED = 5;

/**
 * The decision matrix (plan of issue #153, decisions P1=1 and P2=1). `stored` counts only with
 * the same `fingerprint`: a plugin that appeared or disappeared asks again.
 *
 * - no findings, or an `allow` for these exact plugins: `go`;
 * - the user asked (Start, Restart Server, first prompt) and it is not allowed: `confirm`, even
 *   over a stored `deny`, because they just asked;
 * - the extension acting by itself: a stored `deny` for these plugins is `hold` (no nagging on
 *   every window); anything else is `notify`.
 *
 * VERIFIED by the matrix in `pluginConsent.test.ts` (every row).
 */
export function decideLaunch(input: {
  findings: readonly PluginFinding[];
  stored: StoredDecision | undefined;
  fingerprint: string;
  userAsked: boolean;
}): LaunchAction {
  if (input.findings.length === 0) return 'go';
  const same = input.stored?.fingerprint === input.fingerprint;
  if (same && input.stored?.decision === 'allow') return 'go';
  if (input.userAsked) return 'confirm';
  return same && input.stored?.decision === 'deny' ? 'hold' : 'notify';
}

/** Type guard for what comes back from storage, which may be anything an older build wrote. */
function isStoredDecision(value: unknown): value is StoredDecision {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v['decision'] === 'allow' || v['decision'] === 'deny') &&
    typeof v['fingerprint'] === 'string' &&
    typeof v['at'] === 'number'
  );
}

/** The decisions of all folders, kept under ONE key of the memento and keyed by `folderKey`. */
export interface DecisionStore {
  read(folder: string): StoredDecision | undefined;
  record(folder: string, decision: 'allow' | 'deny', fingerprint: string): Promise<void>;
  /** Removes the folder's entry; false when there was none. */
  forget(folder: string): Promise<boolean>;
}

/**
 * Builds the store over `memento` under `key`. A malformed entry reads as no decision, and a
 * malformed whole value as an empty record, so a corrupt value asks again instead of failing.
 * `now` and `platform` are injectable for tests; the key of a folder is {@link folderKey}.
 */
export function createDecisionStore(
  memento: DecisionMemento,
  key: string,
  options: { now?: () => number; platform?: NodeJS.Platform } = {},
): DecisionStore {
  const now = options.now ?? Date.now;
  const keyOf = (folder: string): string => folderKey(folder, options.platform);
  const all = (): Record<string, unknown> => {
    const value = memento.get(key);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  };
  return {
    read(folder) {
      const entry = all()[keyOf(folder)];
      return isStoredDecision(entry) ? entry : undefined;
    },
    async record(folder, decision, fingerprint) {
      const next = all();
      next[keyOf(folder)] = { decision, fingerprint, at: now() } satisfies StoredDecision;
      await memento.update(key, next);
    },
    async forget(folder) {
      const next = all();
      const k = keyOf(folder);
      if (!(k in next)) return false;
      delete next[k];
      await memento.update(key, next);
      return true;
    },
  };
}

/** One finding as a line: relative to the folder when inside, absolute when from an ancestor. */
function describeFinding(finding: PluginFinding, folder: string): string {
  const shown = (file: string): string =>
    finding.inside ? path.relative(path.resolve(folder), file) || file : file;
  const text =
    finding.kind === 'file'
      ? shown(finding.path)
      : `${finding.spec} (declared in ${shown(finding.config)})`;
  // The names come from the repository: they must not open or close a link in a notification.
  return sanitizeLinkText(text);
}

/** At most {@link MAX_LISTED} lines, then "and N more" when there are more. */
function listFindings(findings: readonly PluginFinding[], folder: string): string[] {
  const lines = findings.slice(0, MAX_LISTED).map((f) => describeFinding(f, folder));
  if (findings.length > MAX_LISTED) lines.push(`and ${findings.length - MAX_LISTED} more`);
  return lines;
}

/**
 * The text of the non-modal notice. File names and plugin specs come from the repository, so they
 * go through `sanitizeLinkText` (brackets and parentheses removed; VS Code links
 * `[x](command:…)` inside a notification, see its header). VERIFIED by `pluginConsent.test.ts`
 * ("[x](command:evil).js" leaves no bracket or parenthesis; seven findings list five plus
 * "and 2 more").
 */
export function noticeMessage(findings: readonly PluginFinding[], folder: string): string {
  return `This folder has opencode plugins that will run with your permissions: ${listFindings(findings, folder).join(', ')}.`;
}

/**
 * The body of the modal, one finding per line, with the same sanitizing and cut as
 * {@link noticeMessage}. Whether a modal `detail` links text at all is HYPOTHESIS; it is
 * sanitized anyway. VERIFIED by `pluginConsent.test.ts` (one line per finding, "and N more").
 */
export function confirmDetail(findings: readonly PluginFinding[], folder: string): string {
  return listFindings(findings, folder).join('\n');
}
