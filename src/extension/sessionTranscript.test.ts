// Protects the Markdown transcript of "Export" (issue #188): the outline (title, metadata, one
// section per turn separated by `---`), what is in and what is out (reasoning only on request,
// tool calls as one bullet, shell without its output, compaction summary, the other message kinds
// skipped), the fence that content cannot close, and the `\n`-only ending.
// Provenance: an export FABRICATED from the types of `@opencode/client@2.2.7` (cast through JSON,
// like the other host tests), not read from a real server. The outline follows what was read of
// `formatSessionTranscript` of the TUI in the v2.2.7 tag; it is not a golden file of that output.
import type { SessionTransferData } from '@opencode/client';
import { describe, expect, it } from 'vitest';
import { formatSessionTranscript } from './sessionTranscript';

const wire = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

const info = (title?: string) => ({
  id: 'ses_a',
  ...(title === undefined ? {} : { title }),
  projectID: 'p',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: Date.UTC(2026, 10, 12, 10, 0, 0), updated: Date.UTC(2026, 10, 12, 11, 30, 0) },
  location: { directory: 'C:\\work' },
});

const tool = (name: string, state: object) => ({
  type: 'tool',
  id: `t_${name}`,
  name,
  time: { created: 1 },
  state,
});

const FULL = wire<SessionTransferData>({
  info: info('Fix the login'),
  messages: [
    { id: 'm0', type: 'agent-selected', time: { created: 0 }, agent: 'build' },
    {
      id: 'm1',
      type: 'user',
      time: { created: 1 },
      text: 'please fix the login',
      files: [{ name: 'src/login.ts', mime: 'text/plain' }, { mime: 'image/png' }],
    },
    {
      id: 'm2',
      type: 'assistant',
      time: { created: 2 },
      agent: 'build',
      model: { id: 'big', providerID: 'acme' },
      content: [
        { type: 'reasoning', text: 'I should look at the form first' },
        { type: 'text', text: 'Looking at it.' },
        tool('read', { status: 'completed', input: { filePath: 'src/login.ts' }, content: [] }),
        tool('edit', { status: 'error', input: { path: 'src/a.ts' }, error: {} }),
        tool('bash', { status: 'running', input: { command: 'npm\n  test' }, metadata: {} }),
        tool('think', { status: 'streaming', input: '{"par' }),
        tool('todo', { status: 'completed', input: { items: [1] }, content: [] }),
        { type: 'text', text: 'All done.' },
      ],
    },
    {
      id: 'm3',
      type: 'shell',
      time: { created: 3 },
      shellID: 's1',
      command: 'echo ```hi```',
      status: 'exited',
      exit: 0,
      output: { output: 'SECRET OUTPUT', cursor: 0, size: 13, truncated: false },
    },
    { id: 'm4', type: 'synthetic', time: { created: 4 }, text: 'hidden' },
    {
      id: 'm5',
      type: 'compaction',
      time: { created: 5 },
      status: 'completed',
      reason: 'manual',
      summary: 'We fixed the login.',
    },
    {
      id: 'm6',
      type: 'compaction',
      time: { created: 6 },
      status: 'failed',
      reason: 'auto',
      error: {},
    },
    { id: 'm7', type: 'idle', time: { created: 7 } },
  ],
});

describe('formatSessionTranscript', () => {
  /**
   * Protects the outline: title, ISO dates in UTC, sections in order, `---` between, one final `\n`.
   * Also review S3: the three metadata lines are bullets (Markdown folds consecutive plain lines
   * into one paragraph, so they would render as a single run-on line).
   */
  it('writes the title, the metadata and one section per turn', () => {
    const text = formatSessionTranscript(FULL);
    expect(text.startsWith('# Fix the login\n\n- **Session:** ses_a\n- **Created:**')).toBe(true);
    expect(text).toContain(
      '- **Created:** 2026-11-12T10:00:00.000Z\n- **Updated:** 2026-11-12T11:30:00.000Z',
    );
    const headings = text.split('\n').filter((line) => line.startsWith('## '));
    expect(headings).toEqual([
      '## User',
      '## Assistant (build · acme/big)',
      '## Shell',
      '## Compaction (manual)',
      '## Compaction (auto)',
    ]);
    expect(text.split('\n\n---\n\n')).toHaveLength(6);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).not.toContain('\r');
  });

  /** Protects the user section: the text and the NAMES of the attachments that have one. */
  it('lists the attachments by name', () => {
    expect(formatSessionTranscript(FULL)).toContain(
      '## User\n\nplease fix the login\n\nAttached: src/login.ts',
    );
  });

  /** Protects the assistant section: text blocks around grouped tool bullets, argument on one line, status. */
  it('writes tool calls as one bullet each, between the text blocks', () => {
    const text = formatSessionTranscript(FULL);
    expect(text).toContain(
      [
        'Looking at it.',
        '',
        '- read: src/login.ts (completed)',
        '- edit: src/a.ts (error)',
        '- bash: npm test (running)',
        '- think (streaming)',
        '- todo (completed)',
        '',
        'All done.',
      ].join('\n'),
    );
  });

  /** Protects the default of leaving the model's reasoning out, and the opt-in. */
  it('includes the reasoning only when asked', () => {
    expect(formatSessionTranscript(FULL)).not.toContain('look at the form first');
    expect(formatSessionTranscript(FULL, { includeReasoning: true })).toContain(
      '_Thinking:_\n\nI should look at the form first',
    );
  });

  /** Protects the shell section: the command in a fence longer than any backtick run in it, no output. */
  it('writes a shell command in a safe fence and never its output', () => {
    const text = formatSessionTranscript(FULL);
    expect(text).toContain('## Shell\n\n````\n$ echo ```hi```\n````\n\nexited (exit 0)');
    expect(text).not.toContain('SECRET OUTPUT');
  });

  /** Protects the compaction sections: the summary of a completed one, the status of a failed one. */
  it('writes the summary of a completed compaction and the status of a failed one', () => {
    const text = formatSessionTranscript(FULL);
    expect(text).toContain('## Compaction (manual)\n\nWe fixed the login.');
    expect(text).toContain('## Compaction (auto)\n\nfailed');
  });

  /** Protects the kinds left out: switches, synthetic, system, skills, idle markers are not conversation. */
  it('leaves out the kinds that are not conversation', () => {
    const text = formatSessionTranscript(FULL);
    expect(text).not.toContain('hidden');
    expect(text).not.toContain('agent-selected');
  });

  /** Protects the empty cases: no title, no messages, an assistant with only tool calls or nothing. */
  it('handles an untitled session with no messages', () => {
    const empty = formatSessionTranscript(
      wire<SessionTransferData>({ info: info(), messages: [] }),
    );
    expect(empty.startsWith('# Untitled session\n')).toBe(true);
    expect(empty.split('---')).toHaveLength(1);
    const bare = formatSessionTranscript(
      wire<SessionTransferData>({
        info: info('t'),
        messages: [
          {
            id: 'm',
            type: 'assistant',
            time: { created: 1 },
            agent: 'plan',
            model: { id: 'x', providerID: 'y' },
            content: [],
          },
        ],
      }),
    );
    expect(bare).toContain('## Assistant (plan · y/x)\n');
  });

  /** Protects the one-line cap: a very long command is cut with an ellipsis. */
  it('cuts a long tool argument', () => {
    const text = formatSessionTranscript(
      wire<SessionTransferData>({
        info: info('t'),
        messages: [
          {
            id: 'm',
            type: 'assistant',
            time: { created: 1 },
            agent: 'build',
            model: { id: 'x', providerID: 'y' },
            content: [
              tool('bash', {
                status: 'completed',
                input: { command: 'a'.repeat(500) },
                content: [],
              }),
            ],
          },
        ],
      }),
    );
    const bullet = text.split('\n').find((line) => line.startsWith('- bash')) ?? '';
    expect(bullet).toContain('…');
    expect(bullet.length).toBeLessThan(160);
  });
});
