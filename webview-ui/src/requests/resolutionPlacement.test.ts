// Protects the PLACEMENT and the WORDING of answered requests in the history (E3-resolved-history,
// issues #56/#18) from: a line under the wrong tool, a record without a tool block lost or stuck on
// the wrong message, the host's exact decision losing against what the block says, the user feedback
// being dropped, and a sentence mangled by JSX (lesson #926: every sentence is compared whole).
//
// ALL DATA HERE IS FABRICATED by hand from the types, except the tool states copied from real
// opencode 2.0.32 rows (see `toolOutcome.test.ts` for their provenance); the texts under test are
// our own wording, so there is no upstream contract to confirm.
import { describe, expect, it } from 'vitest';
import type { MessageInfo, Part, RequestResolution } from '../../../src/shared/model';
import {
  byToolPart,
  MAX_FEEDBACK_SHOWN,
  outcomeView,
  toolOutcomeViews,
  unanchoredByMessage,
} from './resolutionPlacement';
import { deriveToolOutcome } from './toolOutcome';

type ToolPart = Extract<Part, { type: 'tool' }>;

const permission = (
  id: string,
  extra: Partial<Extract<RequestResolution, { kind: 'permission' }>> = {},
): RequestResolution => ({
  kind: 'permission',
  id,
  sessionID: 'ses_1',
  tool: { messageID: 'msg_1', partID: 'call_1' },
  at: 100,
  decision: 'once',
  action: 'read',
  resource: '.env',
  withFeedback: false,
  ...extra,
});

const form = (
  id: string,
  extra: Partial<Extract<RequestResolution, { kind: 'form' }>> = {},
): RequestResolution => ({
  kind: 'form',
  id,
  sessionID: 'ses_1',
  tool: { messageID: 'msg_1', partID: 'call_2' },
  at: 100,
  outcome: 'answered',
  formKind: 'question',
  title: 'Questions',
  withMessage: false,
  ...extra,
});

const readTool = (state: ToolPart['state']): ToolPart => ({
  type: 'tool',
  id: 'call_1',
  name: 'read',
  state,
});

const user = (id: string, createdAt: number): MessageInfo => ({
  kind: 'user',
  id,
  createdAt,
  text: 'hi',
  files: [],
});
const assistant = (id: string, createdAt: number): MessageInfo => ({
  kind: 'assistant',
  id,
  createdAt,
  agent: 'build',
  model: { providerID: 'p', id: 'm' },
});

describe('byToolPart', () => {
  it('groups by the block id, keeping the order, and skips records with no tool', () => {
    const grouped = byToolPart([
      permission('per_1'),
      permission('per_2', { tool: undefined }),
      form('frm_1', { tool: { messageID: 'msg_1', partID: 'call_1' } }),
      permission('per_3', { tool: { messageID: 'msg_2', partID: 'call_9' } }),
    ]);
    expect(grouped.get('call_1')?.map((r) => r.id)).toEqual(['per_1', 'frm_1']);
    expect(grouped.get('call_9')?.map((r) => r.id)).toEqual(['per_3']);
    expect(grouped.size).toBe(2);
  });
});

describe('unanchoredByMessage', () => {
  const messages = [user('u1', 100), assistant('a1', 110), user('u2', 200), assistant('a2', 210)];
  const idsOf = (map: Map<string, RequestResolution[]>) =>
    Object.fromEntries([...map].map(([key, list]) => [key, list.map((r) => r.id)]));

  it('puts a record without tool at the latest message created before it was answered', () => {
    const placed = unanchoredByMessage(messages, {}, [
      permission('before', { tool: undefined, at: 50 }), // before every message: the first one
      permission('between', { tool: undefined, at: 150 }), // after a1, before u2
      permission('after', { tool: undefined, at: 999 }), // after the last
    ]);
    expect(idsOf(placed)).toEqual({ u1: ['before'], a1: ['between'], a2: ['after'] });
  });

  it('treats a record whose tool block is not in the loaded history as unanchored', () => {
    const parts: { [messageID: string]: Part[] } = {
      msg_1: [
        { type: 'tool', id: 'call_1', name: 'read', state: { status: 'running', input: {} } },
      ],
    };
    const placed = unanchoredByMessage(messages, parts, [
      permission('known'),
      permission('lost', { tool: { messageID: 'msg_0', partID: 'call_0' }, at: 150 }),
    ]);
    expect(idsOf(placed)).toEqual({ a1: ['lost'] });
  });

  it('skips notices and places nothing when there is no message', () => {
    const notice: MessageInfo = { kind: 'notice', id: 'n1', createdAt: 120, text: 'x' };
    const placed = unanchoredByMessage([user('u1', 100), notice], {}, [
      permission('r', { tool: undefined, at: 130 }),
    ]);
    expect(idsOf(placed)).toEqual({ u1: ['r'] });
    expect(unanchoredByMessage([], {}, [permission('r', { tool: undefined })]).size).toBe(0);
  });
});

describe('outcomeView with the host record', () => {
  const text = (
    r: RequestResolution,
    derived = undefined as ReturnType<typeof deriveToolOutcome>,
  ) => outcomeView(r, derived, '')?.text;

  it('words every permission decision', () => {
    expect(text(permission('p', { decision: 'once' }))).toBe('Allowed once · Read .env');
    expect(text(permission('p', { decision: 'always' }))).toBe('Always allowed · Read .env');
    expect(text(permission('p', { decision: 'reject' }))).toBe('Rejected · Read .env');
    expect(text(permission('p', { decision: 'reject', withFeedback: true }))).toBe(
      'Rejected with feedback · Read .env',
    );
    expect(text(permission('p', { resource: undefined, action: 'shell' }))).toBe(
      'Allowed once · Run command',
    );
  });

  it('adds the quoted feedback the tool block carries, cut at the limit', () => {
    const feedback = deriveToolOutcome(
      readTool({
        status: 'error',
        input: {},
        error: { code: 'permission.rejected', message: "don't read secrets" },
      }),
    );
    expect(text(permission('p', { decision: 'reject', withFeedback: true }), feedback)).toBe(
      "Rejected with feedback · Read .env — “don't read secrets”",
    );
    const long = 'x'.repeat(MAX_FEEDBACK_SHOWN + 50);
    const longView = outcomeView(
      permission('p', { decision: 'reject', withFeedback: true }),
      { kind: 'permission', verdict: 'rejected-feedback', feedback: long },
      '',
    );
    expect(longView?.text).toBe(
      `Rejected with feedback · Read .env — “${'x'.repeat(MAX_FEEDBACK_SHOWN - 1)}…”`,
    );
  });

  it('the record wins over a block that disagrees (the block of an allowed tool says nothing)', () => {
    expect(
      text(permission('p', { decision: 'once' }), {
        kind: 'permission',
        verdict: 'rejected',
      }),
    ).toBe('Allowed once · Read .env');
  });

  it('words an answered question with the answers from the block, or without them', () => {
    expect(
      text(form('f'), {
        kind: 'question',
        verdict: 'answered',
        answers: [
          { header: 'Pick a colour', values: ['Blue'] },
          { header: 'Extras', values: ['x', 'y'] },
        ],
      }),
    ).toBe('Answered · Pick a colour: Blue; Extras: x, y');
    expect(text(form('f'))).toBe('Answered · Question from the agent');
    expect(text(form('f', { formKind: 'form', title: 'Sign in' }))).toBe('Answered · Sign in');
  });

  it('words a dismissal, with the user own words when the block has them', () => {
    expect(text(form('f', { outcome: 'cancelled' }))).toBe('Dismissed · Question from the agent');
    expect(
      text(form('f', { outcome: 'cancelled', withMessage: true }), {
        kind: 'question',
        verdict: 'own-words',
        message: 'in my own words',
      }),
    ).toBe('Dismissed · Question from the agent — “in my own words”');
  });

  it('sets prefix and tone: a reject or a dismissal is "rejected", never an error', () => {
    expect(outcomeView(permission('p'), undefined, '')).toMatchObject({
      prefix: 'Permission',
      tone: 'allowed',
    });
    expect(outcomeView(permission('p', { decision: 'reject' }), undefined, '')).toMatchObject({
      prefix: 'Permission',
      tone: 'rejected',
    });
    expect(outcomeView(form('f', { outcome: 'cancelled' }), undefined, '')).toMatchObject({
      prefix: 'Question',
      tone: 'rejected',
    });
    expect(outcomeView(form('f', { formKind: 'form' }), undefined, '')).toMatchObject({
      prefix: 'Form',
    });
  });
});

describe('toolOutcomeViews', () => {
  const rejected = readTool({
    status: 'error',
    input: { path: '.env' },
    error: { code: 'aborted', message: 'The user declined this tool call' },
  });

  it('reads a rejection from the block alone when the host has no record (after Reload Window)', () => {
    expect(toolOutcomeViews(rejected, [])).toEqual([
      {
        key: 'derived:call_1',
        prefix: 'Permission',
        text: 'Rejected · Read .env',
        tone: 'rejected',
      },
    ]);
  });

  it('says nothing for an allowed tool with no record: "Allowed once" cannot be derived', () => {
    const allowed = readTool({ status: 'completed', input: { path: '.env' }, output: [] });
    expect(toolOutcomeViews(allowed, [])).toEqual([]);
  });

  it('prefers the record and shows one line per record that names the block', () => {
    const lines = toolOutcomeViews(rejected, [
      permission('per_1', { decision: 'reject' }),
      permission('per_2', { decision: 'once', resource: 'other' }),
    ]);
    expect(lines.map((l) => l.text)).toEqual(['Rejected · Read .env', 'Allowed once · Read other']);
    expect(lines.map((l) => l.key)).toEqual(['per_1', 'per_2']);
  });

  it('reads the answers of a question tool block for the form record only', () => {
    const question: ToolPart = {
      type: 'tool',
      id: 'call_2',
      name: 'question',
      state: {
        status: 'completed',
        input: { questions: [{ header: 'Pick a colour', question: 'Which?' }] },
        output: [],
        metadata: { answers: [['Blue']] },
      },
    };
    const lines = toolOutcomeViews(question, [
      permission('per_q', { action: 'question', resource: undefined, tool: undefined }),
      form('frm_1'),
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      'Allowed once · Ask you questions',
      'Answered · Pick a colour: Blue',
    ]);
  });

  // Protects the answer of a `question` from vanishing when only the permission record survived
  // (the form's was evicted by the LRU, or resolved while the host did not see it). Fabricated.
  it('adds the line read from the block when no record is of the kind the block speaks about', () => {
    const question: ToolPart = {
      type: 'tool',
      id: 'call_2',
      name: 'question',
      state: {
        status: 'completed',
        input: { questions: [{ header: 'Pick a colour', question: 'Which?' }] },
        output: [],
        metadata: { answers: [['Blue']] },
      },
    };
    const lines = toolOutcomeViews(question, [
      permission('per_q', { action: 'question', resource: undefined, tool: undefined }),
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      'Allowed once · Ask you questions',
      'Answered · Pick a colour: Blue',
    ]);
    expect(lines.map((l) => l.key)).toEqual(['per_q', 'derived:call_2']);
  });

  it('names a derived line by the tool label when the block has no path', () => {
    const bare = readTool({
      status: 'error',
      input: {},
      error: { code: 'aborted', message: 'The user declined this tool call' },
    });
    expect(toolOutcomeViews(bare, []).map((l) => l.text)).toEqual(['Rejected · Read']);
  });
});
