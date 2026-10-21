// Protects the reading of "what the user answered" out of a tool block (E3-resolved-history,
// issues #56/#18) from: upstream rewording the `aborted` texts (a rejection would silently stop
// showing), a Stop being shown as a rejection (both are `aborted`), a tool that was merely allowed
// showing a line it cannot justify, and a malformed `metadata.answers` crashing the render.
//
// PROVENANCE. The three REAL fixtures are copies of rows of the `session_message` table of a real
// opencode 2.0.32 (Windows 11), read read-only with `node:sqlite`: `read` rejected, a completed
// `read` (REAL_READ_ALLOWED, session ses_ea4ea72dbffehBPdJAs1DO0qYl) and `question` answered
// `[["A"]]` from the `real-opencode` run of 20/10/2026, and `question` answered `[["Blue"]]` from
// the `test:visual` run of 21/10/2026 (the host's mapping, `wireMapping.ts`, renames the wire
// fields `error.type` to `code` and `content` to `output`, so the copies use the renamed ones).
// Every other fixture is SYNTHETIC, written from the sources (`plugin/host.ts`, `to-session-error.ts`,
// `plugin/question.ts`, `runner/step.ts` at 843a6c51) and marked as such below: they confirm the
// logic, not that opencode emits them.
import { describe, expect, it } from 'vitest';
import type { JsonObject, Part } from '../../../src/shared/model';
import { DECLINED_MESSAGE, DISMISSED_MESSAGE, deriveToolOutcome } from './toolOutcome';

type ToolPart = Extract<Part, { type: 'tool' }>;

const tool = (name: string, state: ToolPart['state'], id = 'call_1'): ToolPart => ({
  type: 'tool',
  id,
  name,
  state,
});

// ---- REAL fixtures (copied from real rows) ----------------------------------------------------

/** REAL: `read` the user rejected with no message (real-opencode run, 20/10/2026). */
const REAL_READ_REJECTED = tool(
  'read',
  {
    status: 'error',
    input: { path: '.env' },
    error: { code: 'aborted', message: 'The user declined this tool call' },
  },
  'call_57aad3b096464df784cda53b',
);

/** REAL: `read` the user allowed: completed, with NO trace of the permission (real-opencode run, 20/10/2026). */
const REAL_READ_ALLOWED = tool(
  'read',
  {
    status: 'completed',
    input: { path: '.env' },
    output: [{ type: 'text', text: 'Read file .env, lines 1-1\n1: OPEN_VS_CODE_TEST=1' }],
    metadata: { truncated: false },
  },
  'call_6e2742247c584b05a76be6dd',
);

/** REAL: `question` answered "Blue" in `test:visual` (21/10/2026). */
const REAL_QUESTION_BLUE = tool(
  'question',
  {
    status: 'completed',
    input: {
      questions: [
        {
          question: 'Which colour do you pick?',
          header: 'Pick a colour',
          options: [
            { label: 'Red', description: 'Choose the colour red' },
            { label: 'Blue', description: 'Choose the colour blue' },
          ],
        },
      ],
    },
    output: [{ type: 'text', text: 'User has answered your questions: …' }],
    metadata: { answers: [['Blue']], truncated: false },
  },
  'call_4f715dfddddf4482936ddf6d',
);

// ---- SYNTHETIC helpers -------------------------------------------------------------------------

const failed = (name: string, code: string, message: string): ToolPart =>
  tool(name, { status: 'error', input: {}, error: { code, message } });

describe('deriveToolOutcome with REAL rows', () => {
  it('reads a rejection without message from the real rejected read', () => {
    expect(deriveToolOutcome(REAL_READ_REJECTED)).toEqual({
      kind: 'permission',
      verdict: 'rejected',
    });
  });

  it('says nothing about a read that was allowed: the server keeps no trace of the permission', () => {
    expect(deriveToolOutcome(REAL_READ_ALLOWED)).toBeUndefined();
  });

  it('reads the answer and the header of the real answered question', () => {
    expect(deriveToolOutcome(REAL_QUESTION_BLUE)).toEqual({
      kind: 'question',
      verdict: 'answered',
      answers: [{ header: 'Pick a colour', values: ['Blue'] }],
    });
  });

  it('keeps the texts of upstream in one place (a reword goes red here, not silently)', () => {
    expect(DECLINED_MESSAGE).toBe('The user declined this tool call');
    expect(DISMISSED_MESSAGE).toBe('The user dismissed this question');
  });
});

describe('deriveToolOutcome with SYNTHETIC rows (written from the sources, never observed)', () => {
  it('a rejection with a message is the user feedback', () => {
    expect(deriveToolOutcome(failed('read', 'permission.rejected', "don't read secrets"))).toEqual({
      kind: 'permission',
      verdict: 'rejected-feedback',
      feedback: "don't read secrets",
    });
  });

  it('a deny rule is "blocked", not a rejection nor feedback', () => {
    expect(
      deriveToolOutcome(failed('read', 'permission.rejected', 'Permission denied: read .env')),
    ).toEqual({ kind: 'permission', verdict: 'blocked' });
  });

  it('a question dismissed without a note, and with the user own words', () => {
    expect(deriveToolOutcome(failed('question', 'aborted', DISMISSED_MESSAGE))).toEqual({
      kind: 'question',
      verdict: 'dismissed',
    });
    expect(deriveToolOutcome(failed('question', 'tool.execution', 'in my own words'))).toEqual({
      kind: 'question',
      verdict: 'own-words',
      message: 'in my own words',
    });
  });

  it('the dismissed text only counts for the question tool', () => {
    expect(deriveToolOutcome(failed('read', 'aborted', DISMISSED_MESSAGE))).toBeUndefined();
  });

  it('a Stop, a closing location and any other error are NOT a rejection', () => {
    expect(
      deriveToolOutcome(failed('read', 'aborted', 'Tool execution interrupted')),
    ).toBeUndefined();
    expect(
      deriveToolOutcome(
        failed('read', 'aborted', 'Interaction cancelled because the location shut down'),
      ),
    ).toBeUndefined();
    expect(deriveToolOutcome(failed('bash', 'tool.execution', 'exit code 1'))).toBeUndefined();
  });

  it('a tool that is still running or streaming has no outcome', () => {
    expect(
      deriveToolOutcome(tool('read', { status: 'running', input: {}, metadata: {} })),
    ).toBeUndefined();
    expect(deriveToolOutcome(tool('read', { status: 'streaming', input: '{"pa' }))).toBeUndefined();
  });

  it('a malformed metadata.answers shows nothing instead of crashing', () => {
    const malformed: JsonObject[] = [
      {},
      { answers: 'Blue' },
      { answers: ['Blue'] },
      { answers: [[1]] },
    ];
    for (const metadata of malformed) {
      expect(
        deriveToolOutcome(
          tool('question', { status: 'completed', input: {}, output: [], metadata }),
        ),
      ).toBeUndefined();
    }
  });

  it('falls back to the question text, then to a number, when the input has no header', () => {
    const answered = (input: JsonObject) =>
      deriveToolOutcome(
        tool('question', {
          status: 'completed',
          input,
          output: [],
          metadata: { answers: [['A'], ['B'], []] },
        }),
      );
    expect(answered({ questions: [{ question: 'Pick one' }, { header: 'Size' }] })).toEqual({
      kind: 'question',
      verdict: 'answered',
      answers: [
        { header: 'Pick one', values: ['A'] },
        { header: 'Size', values: ['B'] },
        { header: 'Question 3', values: [] },
      ],
    });
  });
});
