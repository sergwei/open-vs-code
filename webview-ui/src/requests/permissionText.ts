/**
 * Plain-language texts for permission requests (issue #18): what the agent wants to do, which
 * resources it touches, what "Always allow" would store, and how a decision is worded afterwards.
 * Pure: no DOM, no Solid, so Vitest drives it directly.
 */
import type { PermissionAsk, PermissionDecision } from '../../../src/shared/model';

/** Most resources a card lists before folding the rest into "N more". Our own choice for a narrow view. */
export const MAX_RESOURCES_SHOWN = 5;

/** Wire action name to the verb a person reads; unknown actions are shown as the server named them. */
const ACTION_LABELS: Record<string, string> = {
  read: 'Read',
  edit: 'Edit',
  write: 'Edit',
  shell: 'Run command',
  external_directory: 'Access outside the folder',
  webfetch: 'Fetch URL',
  websearch: 'Search the web',
  question: 'Ask you questions',
};

/**
 * Wording for the action of a permission request.
 *
 * `read`, `shell`, `external_directory`, `question`, `webfetch` and `websearch` are action names
 * read in the opencode v2.0.32 sources (`file-access.ts`, the `question` tool, the agent rules);
 * VERIFIED against a real server only for `read` (the opt-in `realOpencode.test.ts` asked to read
 * `.env`). `edit` and `write` are HYPOTHESIS (the names of the v1 permissions; not seen in v2).
 * An action not in the table comes back unchanged, so a new server action still renders.
 */
export function actionLabel(action: string): string {
  return Object.hasOwn(ACTION_LABELS, action) ? (ACTION_LABELS[action] ?? action) : action;
}

/** Resources to list, and how many were folded away. */
export type ResourcePreview = { shown: string[]; more: number };

/** First `max` resources and the count of the rest (`more` is 0 when everything fits). */
export function previewResources(
  resources: readonly string[],
  max: number = MAX_RESOURCES_SHOWN,
): ResourcePreview {
  return { shown: resources.slice(0, max), more: Math.max(0, resources.length - max) };
}

/**
 * What "Always allow" would store: one line per rule, and whether any is broad.
 *
 * `save` comes straight from the request. A rule is `broad` when its pattern is `*` or ends with
 * `/*`, i.e. it would let opencode stop asking about EVERYTHING of that action (or of a whole
 * directory). That matters because the reads of v2 ask with `save: ["*"]` (read in
 * `file-access.ts@v2.0.32` L144-159) and saved rules are evaluated last as `allow`, so one
 * "Always" on a `.env` read allows reading every file of the project, `.env` included, from then on.
 */
export function describeSave(
  save: readonly string[],
  action: string,
): { rules: string[]; broad: boolean } {
  return {
    rules: save.map((pattern) => `${actionLabel(action)}: ${pattern}`),
    broad: save.some((pattern) => pattern === '*' || pattern.endsWith('/*')),
  };
}

/** Past-tense wording of a decision, for the result line that stays after the card is gone. */
export function outcomeLabel(decision: PermissionDecision): string {
  switch (decision) {
    case 'once':
      return 'Allowed once';
    case 'always':
      return 'Always allowed';
    case 'reject':
      return 'Rejected';
  }
}

/** One-line description of a request ("Read .env"): the action and its first resource. */
export function describeRequest(ask: Pick<PermissionAsk, 'action' | 'resources'>): string {
  const first = ask.resources[0];
  return first === undefined ? actionLabel(ask.action) : `${actionLabel(ask.action)} ${first}`;
}
