/**
 * Where and how the answered requests show in the history (issues #56/#18). Pure: no DOM, no Solid.
 *
 * Two things live here. PLACEMENT: a resolution hangs under the tool block that asked
 * (`ToolRef.partID`); one without a tool, or whose tool block is not in the loaded history, goes at
 * the end of the latest user/assistant message created before it was answered. WORDING: the text
 * of the line, built from the host's record (exact decision) and from what the tool block itself
 * says (`toolOutcome.ts`: feedback text, answers). The record wins; the block adds the detail the
 * host deliberately does not keep.
 */
import type { MessageInfo, Part, RequestResolution } from '../../../src/shared/model';
import { actionLabel, describeRequest, outcomeLabel } from './permissionText';
import { deriveToolOutcome, type DerivedOutcome } from './toolOutcome';

type ToolPart = Extract<Part, { type: 'tool' }>;

/** Longest quoted feedback in a line; the rest is cut with an ellipsis. Our own choice for a narrow view. */
export const MAX_FEEDBACK_SHOWN = 200;

/** Name shown for the question tool's form, which has no title worth reading. */
const QUESTION_SUBJECT = 'Question from the agent';

/** One line of the history: `prefix` is read by screen readers only, `tone` drives the colour. */
export interface OutcomeView {
  /** Stable key for the list: the request id, or `derived:<partID>` for a line read from a block. */
  key: string;
  prefix: 'Permission' | 'Question' | 'Form';
  text: string;
  tone: 'allowed' | 'rejected' | 'neutral';
}

/**
 * Groups the resolutions that name a tool block by that block's id, in the order given. A
 * question can leave two (the permission to ask and the form itself), hence a list.
 */
export function byToolPart(
  resolutions: readonly RequestResolution[],
): Map<string, RequestResolution[]> {
  const result = new Map<string, RequestResolution[]>();
  for (const resolution of resolutions) {
    if (resolution.tool === undefined) continue;
    const list = result.get(resolution.tool.partID) ?? [];
    list.push(resolution);
    result.set(resolution.tool.partID, list);
  }
  return result;
}

/**
 * Groups by message id the resolutions that have nowhere better to hang: no `tool`, or a `tool`
 * whose block is not among `parts` (the history only loads the latest messages). Each goes to the
 * LAST user or assistant message with `createdAt <= at`, or to the first one when it was answered
 * before every loaded message (clock skew, or a history cut short). Notices are skipped: they have
 * no block of their own to nest a line in. No messages, no placement.
 *
 * `at` is the HOST clock and `createdAt` the server's; both run on the user's machine (HYPOTHESIS:
 * not measured; the only effect of a skew is a line one message too early or late).
 */
export function unanchoredByMessage(
  messages: readonly MessageInfo[],
  parts: { readonly [messageID: string]: readonly Part[] | undefined },
  resolutions: readonly RequestResolution[],
): Map<string, RequestResolution[]> {
  const result = new Map<string, RequestResolution[]>();
  const hosts = messages.filter((message) => message.kind !== 'notice');
  const first = hosts[0];
  if (first === undefined) return result;
  for (const resolution of resolutions) {
    const tool = resolution.tool;
    if (tool !== undefined && parts[tool.messageID]?.some((part) => part.id === tool.partID)) {
      continue;
    }
    let target = first;
    for (const message of hosts) if (message.createdAt <= resolution.at) target = message;
    const list = result.get(target.id) ?? [];
    list.push(resolution);
    result.set(target.id, list);
  }
  return result;
}

/** Quotes the user's own words, cut at {@link MAX_FEEDBACK_SHOWN}. */
function quote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const cut = flat.length > MAX_FEEDBACK_SHOWN ? `${flat.slice(0, MAX_FEEDBACK_SHOWN - 1)}…` : flat;
  return ` — “${cut}”`;
}

/** "Pick a colour: Blue; Size: S, M" */
function describeAnswers(derived: Extract<DerivedOutcome, { verdict: 'answered' }>): string {
  return derived.answers
    .map(
      (answer) =>
        `${answer.header}${answer.values.length > 0 ? ': ' : ''}${answer.values.join(', ')}`,
    )
    .join('; ');
}

/**
 * The line for one answered request.
 *
 * `resolution` is the host's record (may be `undefined` when only the block is known), `derived`
 * what the block says (may be `undefined`), `subject` what a permission was about when there is no
 * record to say it ("Read .env"). Returns `undefined` when neither source has anything to say.
 * Examples: "Allowed once · Read .env", "Always allowed · Read .env", "Rejected · Read .env",
 * "Rejected with feedback · Read .env — “don't read secrets”", "Answered · Pick a colour: Blue",
 * "Dismissed · Question from the agent". Tone: allowed/answered is `allowed`, rejected/dismissed/
 * blocked is `rejected` (a neutral warning colour, never the error red: Reject is a decision, not
 * a failure; lesson #934), anything else `neutral`. Built as whole strings because JSX eats the
 * spaces between `{expr}` and text (lesson #926). VERIFIED by `resolutionPlacement.test.ts`
 * (whole-string comparisons) and, in a real VS Code, by `test:visual` steps 5-8.
 */
export function outcomeView(
  resolution: RequestResolution | undefined,
  derived: DerivedOutcome | undefined,
  subject: string,
  key?: string,
): OutcomeView | undefined {
  if (resolution?.kind === 'permission') {
    const feedback = derived?.kind === 'permission' && derived.verdict === 'rejected-feedback';
    const label =
      resolution.decision === 'reject' && resolution.withFeedback
        ? 'Rejected with feedback'
        : outcomeLabel(resolution.decision);
    const about = describeRequest({
      action: resolution.action,
      resources: resolution.resource === undefined ? [] : [resolution.resource],
    });
    return {
      key: resolution.id,
      prefix: 'Permission',
      text: `${label} · ${about}${feedback ? quote(derived.feedback) : ''}`,
      tone: resolution.decision === 'reject' ? 'rejected' : 'allowed',
    };
  }
  if (resolution?.kind === 'form') {
    const prefix = resolution.formKind === 'question' ? 'Question' : 'Form';
    const about = resolution.formKind === 'question' ? QUESTION_SUBJECT : resolution.title;
    if (resolution.outcome === 'answered') {
      const answers = derived?.kind === 'question' && derived.verdict === 'answered';
      return {
        key: resolution.id,
        prefix,
        text: `Answered · ${answers ? describeAnswers(derived) : about}`,
        tone: 'allowed',
      };
    }
    const words = derived?.kind === 'question' && derived.verdict === 'own-words';
    return {
      key: resolution.id,
      prefix,
      text: `Dismissed · ${about}${words ? quote(derived.message) : ''}`,
      tone: 'rejected',
    };
  }
  if (derived === undefined) return undefined;
  const derivedKey = key ?? 'derived';
  switch (derived.verdict) {
    case 'rejected':
      return {
        key: derivedKey,
        prefix: 'Permission',
        text: `Rejected · ${subject}`,
        tone: 'rejected',
      };
    case 'rejected-feedback':
      return {
        key: derivedKey,
        prefix: 'Permission',
        text: `Rejected with feedback · ${subject}${quote(derived.feedback)}`,
        tone: 'rejected',
      };
    case 'blocked':
      return {
        key: derivedKey,
        prefix: 'Permission',
        text: `Blocked by a permission rule · ${subject}`,
        tone: 'rejected',
      };
    case 'answered':
      return {
        key: derivedKey,
        prefix: 'Question',
        text: `Answered · ${describeAnswers(derived)}`,
        tone: 'allowed',
      };
    case 'dismissed':
      return {
        key: derivedKey,
        prefix: 'Question',
        text: `Dismissed · ${QUESTION_SUBJECT}`,
        tone: 'rejected',
      };
    case 'own-words':
      return {
        key: derivedKey,
        prefix: 'Question',
        text: `Dismissed · ${QUESTION_SUBJECT}${quote(derived.message)}`,
        tone: 'rejected',
      };
  }
}

/** What a tool call was about when no record says so: its label and, if it has one, its `path`. */
function subjectOf(part: ToolPart): string {
  const input = part.state.input;
  const path = typeof input === 'string' ? undefined : input['path'];
  const label = actionLabel(part.name);
  return typeof path === 'string' && path !== '' ? `${label} ${path}` : label;
}

/**
 * The lines to show under one tool block: one per record that names it, each completed with what
 * the block says, or a single line read from the block alone when the host has no record (after a
 * Reload Window). A record of a permission is completed only by a permission verdict of the block,
 * and a record of a form only by a question verdict, so the two lines of a `question` tool never
 * borrow each other's detail. When there are records but none of the kind the block's verdict
 * speaks about (e.g. the permission record of a `question` survived but the form's was evicted or
 * never seen), the line read from the block is added too, so the answer is not lost. VERIFIED by
 * `resolutionPlacement.test.ts` (fabricated records and the real-row fixtures of `toolOutcome.test.ts`).
 */
export function toolOutcomeViews(
  part: ToolPart,
  resolutions: readonly RequestResolution[],
): OutcomeView[] {
  const derived = deriveToolOutcome(part);
  if (resolutions.length === 0) {
    const view = outcomeView(undefined, derived, subjectOf(part), `derived:${part.id}`);
    return view === undefined ? [] : [view];
  }
  const views: OutcomeView[] = [];
  for (const resolution of resolutions) {
    const wanted = resolution.kind === 'permission' ? 'permission' : 'question';
    const matching = derived?.kind === wanted ? derived : undefined;
    const view = outcomeView(resolution, matching, subjectOf(part));
    if (view !== undefined) views.push(view);
  }
  const covered = resolutions.some(
    (r) => (r.kind === 'permission' ? 'permission' : 'question') === derived?.kind,
  );
  if (derived !== undefined && !covered) {
    const view = outcomeView(undefined, derived, subjectOf(part), `derived:${part.id}`);
    if (view !== undefined) views.push(view);
  }
  return views;
}
