/**
 * What a tool block says by itself about a permission or a question the user answered (issues
 * #56/#18). Pure: no DOM, no Solid.
 *
 * opencode v2.0.32 keeps no record of an answered permission (`permission.ts@843a6c51` deletes it
 * from memory), but the tool block that asked is durable, so a rejection, an answer or a dismissal
 * can be read back from it after a reconnection or a Reload Window. What the block can NOT tell is
 * "Allowed once" against "Always allowed": an allowed tool just completes. That exact decision
 * comes only from the host's record (`RequestResolution`).
 */
import type { JsonObject, Part } from '../../../src/shared/model';

type ToolPart = Extract<Part, { type: 'tool' }>;

/**
 * Text of the `aborted` error opencode writes into a tool the user rejected without a message.
 * Source: `packages/core/src/session/runner/step.ts@843a6c51` L206-214. VERIFIED against a real
 * opencode 2.0.32 (Windows 11, two `read` blocks of the `real-opencode` run of 20/10/2026, read
 * from its database with `node:sqlite`). It is the only thing that tells a Reject from a Stop (both
 * are `aborted`): if a new opencode rewords it, a rejection will simply show no line, and
 * `toolOutcome.test.ts` (real row) goes red. Re-check on every version bump.
 */
export const DECLINED_MESSAGE = 'The user declined this tool call';

/**
 * Text of the `aborted` error of a `question` tool the user dismissed without a message. Source:
 * `packages/core/src/tool/plugin/question.ts@843a6c51` L88-93. HYPOTHESIS: read in the source, not
 * observed (the real runs never dismissed a question); to check it, dismiss a question with no note
 * in `test:visual` and read the row.
 */
export const DISMISSED_MESSAGE = 'The user dismissed this question';

/** Prefix of the message of a rejection caused by a `deny` rule: nobody was asked (`to-session-error.ts` L61). */
const DENIED_PREFIX = 'Permission denied:';

/** One answered question of the `question` tool: its header and what was chosen or typed. */
export interface QuestionAnswer {
  header: string;
  values: string[];
}

/** What a tool block reveals about the request that gated it. */
export type DerivedOutcome =
  | { kind: 'permission'; verdict: 'rejected' }
  | { kind: 'permission'; verdict: 'rejected-feedback'; feedback: string }
  | { kind: 'permission'; verdict: 'blocked' }
  | { kind: 'question'; verdict: 'answered'; answers: QuestionAnswer[] }
  | { kind: 'question'; verdict: 'dismissed' }
  | { kind: 'question'; verdict: 'own-words'; message: string };

/** Reads `metadata.answers` as `string[][]`; anything else (missing, a wrong shape) is `undefined`. */
function readAnswers(metadata: JsonObject | undefined): string[][] | undefined {
  const answers = metadata?.['answers'];
  if (!Array.isArray(answers)) return undefined;
  const result: string[][] = [];
  for (const entry of answers) {
    if (!Array.isArray(entry) || !entry.every((value) => typeof value === 'string')) {
      return undefined;
    }
    result.push(entry);
  }
  return result;
}

/** Header of question `index` from the tool input, falling back to its text and then to a number. */
function headerOf(input: unknown, index: number): string {
  const questions =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)['questions']
      : undefined;
  const question: unknown = Array.isArray(questions) ? questions[index] : undefined;
  if (typeof question === 'object' && question !== null) {
    const record = question as Record<string, unknown>;
    for (const key of ['header', 'question']) {
      const value = record[key];
      if (typeof value === 'string' && value !== '') return value;
    }
  }
  return `Question ${String(index + 1)}`;
}

/**
 * Derives the outcome of the request that gated `part`, from the tool block alone.
 *
 * - `error` + `aborted` + {@link DECLINED_MESSAGE} -> a plain rejection (any tool);
 *   `aborted` + {@link DISMISSED_MESSAGE} on `question` -> dismissed;
 *   `permission.rejected` -> the user's feedback, or `blocked` when the text starts with
 *   "Permission denied:" (a `deny` rule, nobody was asked);
 *   `tool.execution` on `question` -> dismissed with the user's own words.
 * - `completed` on `question` with a well-formed `metadata.answers` -> the answers, each with its
 *   header from `input.questions`.
 * - `undefined` for everything else: a Stop ("Tool execution interrupted"), a closing location, any
 *   other error, a tool that was just allowed, a malformed `metadata.answers`.
 *
 * VERIFIED for the plain rejection, a completed `read` (no trace of the permission) and a
 * completed `question` with `answers` against rows of a real opencode 2.0.32 (Windows 11,
 * 20/10 and 21/10/2026; the fixtures of `toolOutcome.test.ts` are copies). HYPOTHESIS for
 * `permission.rejected`, `blocked`, `dismissed` and `own-words`: read in the sources
 * (`plugin/host.ts` L442, `to-session-error.ts` L61-68, `question.ts` L88-93), never observed.
 */
export function deriveToolOutcome(part: ToolPart): DerivedOutcome | undefined {
  const state = part.state;
  if (state.status === 'error') {
    const { code, message } = state.error;
    if (code === 'aborted' && message === DECLINED_MESSAGE) {
      return { kind: 'permission', verdict: 'rejected' };
    }
    if (code === 'aborted' && part.name === 'question' && message === DISMISSED_MESSAGE) {
      return { kind: 'question', verdict: 'dismissed' };
    }
    if (code === 'permission.rejected') {
      return message.startsWith(DENIED_PREFIX)
        ? { kind: 'permission', verdict: 'blocked' }
        : { kind: 'permission', verdict: 'rejected-feedback', feedback: message };
    }
    if (code === 'tool.execution' && part.name === 'question') {
      return { kind: 'question', verdict: 'own-words', message };
    }
    return undefined;
  }
  if (state.status === 'completed' && part.name === 'question') {
    const answers = readAnswers(state.metadata);
    if (answers === undefined) return undefined;
    return {
      kind: 'question',
      verdict: 'answered',
      answers: answers.map((values, index) => ({ header: headerOf(state.input, index), values })),
    };
  }
  return undefined;
}
