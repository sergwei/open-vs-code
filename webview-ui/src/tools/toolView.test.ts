// Protects the view model of the tool cards (issue #26): what the folded header says for every tool
// name of opencode 2.0.32, the five statuses a user must tell apart (a Reject or a Stop is never an
// error), what the unfolded body holds, and that a block with a wrong `input` or `metadata` falls
// back to the generic view instead of throwing.
//
// Provenance: FABRICATED blocks built from the tool contracts READ in the 2.0.32 tag
// (`packages/core/src/tool/plugin/*.ts@843a6c51`, plan Engram #1035 section 4). Only the
// "The user declined this tool call" error is a real row (copied from `toolOutcome.test.ts`). They
// confirm OUR mapping, NOT that the server sends these shapes: that is `test:visual` step 15.
import { describe, expect, it } from 'vitest';
import type { JsonObject, Part, ToolOutput } from '../../../src/shared/model';
import { filesAt, toolBody, toolStatus, toolSummary } from './toolView';

type ToolPart = Extract<Part, { type: 'tool' }>;

const text = (value: string): ToolOutput => ({ type: 'text', text: value });

/** A completed tool block. */
function done(
  name: string,
  input: JsonObject,
  output: ToolOutput[] = [],
  metadata?: JsonObject,
): ToolPart {
  return {
    type: 'tool',
    id: 'call_1',
    name,
    state: { status: 'completed', input, output, ...(metadata ? { metadata } : {}) },
  };
}

const PATCH = [
  'Index: src/a.ts',
  '===================================================================',
  '--- src/a.ts',
  '+++ src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' one',
  '-two',
  '+TWO',
  '+three',
  '',
].join('\n');

describe('toolStatus', () => {
  const base = { type: 'tool', id: 'c', name: 'shell' } as const;

  it('maps the four lifecycle states to distinct words', () => {
    const streaming: ToolPart = { ...base, state: { status: 'streaming', input: '{"co' } };
    const running: ToolPart = { ...base, state: { status: 'running', input: {} } };
    expect(toolStatus(streaming, false).label).toBe('pending');
    expect(toolStatus(running, false).label).toBe('running');
    expect(toolStatus(running, true).label).toBe('waiting for approval');
    expect(toolStatus(done('shell', {}), false).label).toBe('done');
  });

  it('paints only a real failure as an error', () => {
    const failed: ToolPart = {
      ...base,
      state: { status: 'error', input: {}, error: { code: 'tool.execution', message: 'boom' } },
    };
    expect(toolStatus(failed, false)).toEqual({ status: 'failed', label: 'failed', tone: 'error' });
  });

  it('shows a Reject as rejected and a Stop as stopped, both neutral', () => {
    const rejected: ToolPart = {
      ...base,
      state: {
        status: 'error',
        input: {},
        error: { code: 'aborted', message: 'The user declined this tool call' },
      },
    };
    const stopped: ToolPart = {
      ...base,
      state: {
        status: 'error',
        input: {},
        error: { code: 'aborted', message: 'Tool execution interrupted' },
      },
    };
    expect(toolStatus(rejected, false)).toEqual({
      status: 'rejected',
      label: 'rejected',
      tone: 'neutral',
    });
    expect(toolStatus(stopped, false)).toEqual({
      status: 'stopped',
      label: 'stopped',
      tone: 'neutral',
    });
  });

  it('shows a dismissed question as dismissed', () => {
    const dismissed: ToolPart = {
      type: 'tool',
      id: 'q',
      name: 'question',
      state: {
        status: 'error',
        input: {},
        error: { code: 'aborted', message: 'The user dismissed this question' },
      },
    };
    expect(toolStatus(dismissed, false).status).toBe('dismissed');
  });
});

describe('toolSummary: what the folded header says', () => {
  it('shell: command and exit code, as one accessible name', () => {
    const part = done(
      'shell',
      { command: 'npm test' },
      [text('boom'), text('Exited with code 1')],
      { status: 'completed', exit: 1 },
    );
    const summary = toolSummary(part, false);
    expect(summary).toMatchObject({ verb: 'Shell', arg: 'npm test', result: 'exit 1' });
    expect(summary.name).toBe('Shell npm test · done · exit 1');
  });

  it('shell: takes the exit code from the warning when the metadata has none', () => {
    const part = done('shell', { command: 'x' }, [text(''), text('Exited with code 2')]);
    expect(toolSummary(part, false).result).toBe('exit 2');
  });

  it('shell: says so when it runs in the background', () => {
    const part = done('shell', { command: 'x' }, [text('')], { status: 'running' });
    expect(toolSummary(part, false).result).toBe('running in background');
  });

  it('read: path and line range, openable', () => {
    const part = done(
      'read',
      { path: 'src/a.ts', offset: 5 },
      [text('Read file src/a.ts, lines 1-200\n1: x')],
      { truncated: false },
    );
    const summary = toolSummary(part, false);
    expect(summary).toMatchObject({ verb: 'Read', arg: 'src/a.ts', result: 'lines 1-200' });
    expect(summary.open).toEqual({ path: 'src/a.ts', line: 5 });
  });

  it('read: a directory is not offered to open', () => {
    const part = done('read', { path: 'src' }, [text('Read directory src, entries 3')]);
    const summary = toolSummary(part, false);
    expect(summary.result).toBe('directory');
    expect(summary.open).toBeUndefined();
  });

  it('edit: counters from metadata.files', () => {
    const part = done('edit', { path: 'src/a.ts' }, [text('Edited')], {
      files: [{ file: 'src/a.ts', patch: PATCH, additions: 2, deletions: 1, status: 'modified' }],
    });
    expect(toolSummary(part, false)).toMatchObject({ verb: 'Edit', result: '+2 −1' });
  });

  it('edit: counts from the patch when the counters are missing', () => {
    const part = done('edit', { path: 'src/a.ts' }, [], {
      files: [{ file: 'src/a.ts', patch: PATCH }],
    });
    expect(toolSummary(part, false).result).toBe('+2 −1');
  });

  it('write: number of lines of the content', () => {
    const part = done('write', { path: 'b.ts', content: 'a\nb\nc\n' }, [text('Wrote')]);
    expect(toolSummary(part, false)).toMatchObject({ verb: 'Write', result: '3 lines' });
  });

  it('grep: pattern, place and number of matches', () => {
    const part = done('grep', { pattern: 'greet', path: 'src' }, [text('Found 4 matches')], {
      matches: 4,
    });
    const summary = toolSummary(part, false);
    expect(summary).toMatchObject({
      verb: 'Grep',
      arg: 'greet',
      detail: 'in src',
      result: '4 matches',
    });
    expect(summary.name).toBe('Grep greet in src · done · 4 matches');
  });

  it('glob: number of files, singular for one', () => {
    const part = done('glob', { pattern: '**/*.ts' }, [text('a.ts')], { count: 1 });
    expect(toolSummary(part, false).result).toBe('1 file');
  });

  it('webfetch, websearch, skill and subagent name their main argument', () => {
    expect(toolSummary(done('webfetch', { url: 'https://x.test' }), false)).toMatchObject({
      verb: 'Fetch',
      arg: 'https://x.test',
    });
    expect(toolSummary(done('websearch', { query: 'solid' }), false)).toMatchObject({
      verb: 'Search',
      arg: 'solid',
    });
    expect(toolSummary(done('skill', { name: 'pdf' }), false).arg).toBe('pdf');
    expect(
      toolSummary(done('subagent', { agent: 'general', description: 'Say hello' }), false),
    ).toMatchObject({ verb: 'Subagent', arg: 'Say hello', detail: '(general)' });
  });

  it('an unknown tool shows its name and its first text argument', () => {
    const part = done('mcp_echo', { count: 3, message: 'hi there' });
    expect(toolSummary(part, false)).toMatchObject({ verb: 'mcp_echo', arg: 'hi there' });
  });

  it('while the input streams, only the verb is shown and the JSON is not parsed', () => {
    const part: ToolPart = {
      type: 'tool',
      id: 'c',
      name: 'shell',
      state: { status: 'streaming', input: '{"command":"npm te' },
    };
    const summary = toolSummary(part, false);
    expect(summary.arg).toBeUndefined();
    expect(summary.name).toBe('Shell · pending');
  });

  it('a failed tool shows the first line of the error; a rejected one shows no result', () => {
    const failed: ToolPart = {
      type: 'tool',
      id: 'c',
      name: 'shell',
      state: {
        status: 'error',
        input: { command: 'x' },
        error: { code: 'tool.execution', message: 'Unable to execute command: x\nmore' },
      },
    };
    expect(toolSummary(failed, false).name).toBe('Shell x · failed · Unable to execute command: x');
    const rejected: ToolPart = {
      type: 'tool',
      id: 'c',
      name: 'read',
      state: {
        status: 'error',
        input: { path: '.env' },
        error: { code: 'aborted', message: 'The user declined this tool call' },
      },
    };
    expect(toolSummary(rejected, false).name).toBe('Read .env · rejected');
  });

  it('never throws on a wrong shape: numbers where text should be, null metadata fields', () => {
    const part = done('edit', { path: 42 }, [], { files: [null, 3, { file: 7 }, { file: 'a' }] });
    expect(() => toolSummary(part, false)).not.toThrow();
    expect(toolSummary(part, false).verb).toBe('Edit');
  });

  it('cuts a very long argument', () => {
    const arg = toolSummary(done('shell', { command: 'x'.repeat(500) }), false).arg ?? '';
    expect(arg.length).toBeLessThanOrEqual(80);
    expect(arg.endsWith('…')).toBe(true);
  });
});

describe('filesAt', () => {
  it('keeps the well-formed entries and skips the rest', () => {
    expect(filesAt({ files: [{ file: 'a', additions: 1 }, { nope: 1 }, 'x'] })).toEqual([
      { file: 'a', additions: 1 },
    ]);
    expect(filesAt(undefined)).toEqual([]);
    expect(filesAt({ files: 'no' })).toEqual([]);
  });
});

describe('toolBody', () => {
  it('shell: command, the TAIL-clipped output and the warning as a note', () => {
    const part = done('shell', { command: 'npm test' }, [
      text('\u001b[31mred\u001b[0m'),
      text('Exited with code 1'),
    ]);
    expect(toolBody(part)).toEqual([
      { kind: 'code', label: 'Command', text: 'npm test', from: 'head' },
      { kind: 'code', label: 'Output', text: 'red', from: 'tail' },
      { kind: 'note', text: 'Exited with code 1' },
    ]);
  });

  // Protects review W1 (Engram #1039): the server builds the content as `[output?, notice?]`
  // (`shell.ts@843a6c51` L80-81, read, not observed in a run), so an EMPTY output with exit 1 is
  // `["Exited with code 1"]` alone and the notice must not be painted as the Output block.
  it('shell: a notice alone is a note and the output is "No output."', () => {
    const part = done('shell', { command: 'false' }, [text('Exited with code 1')]);
    expect(toolBody(part)).toEqual([
      { kind: 'code', label: 'Command', text: 'false', from: 'head' },
      { kind: 'note', text: 'No output.' },
      { kind: 'note', text: 'Exited with code 1' },
    ]);
    expect(toolSummary(part, false).result).toBe('exit 1');
  });

  it('shell: Killed and Timed out notices alone are notes too', () => {
    for (const notice of ['Killed by SIGTERM', 'Timed out before completion']) {
      const sections = toolBody(done('shell', { command: 'x' }, [text(notice)]));
      expect(
        sections.some((section) => section.kind === 'code' && section.label === 'Output'),
      ).toBe(false);
      expect(sections).toContainEqual({ kind: 'note', text: notice });
    }
  });

  it('shell: output that merely mentions a notice is still output', () => {
    const part = done('shell', { command: 'x' }, [text('log: Exited with code 1 earlier')]);
    expect(toolBody(part)[1]).toEqual({
      kind: 'code',
      label: 'Output',
      text: 'log: Exited with code 1 earlier',
      from: 'tail',
    });
  });

  it('shell: says the output is not there yet while it runs', () => {
    const part: ToolPart = {
      type: 'tool',
      id: 'c',
      name: 'shell',
      state: { status: 'running', input: { command: 'sleep 9' } },
    };
    expect(toolBody(part).map((section) => section.kind)).toEqual(['code', 'note']);
  });

  it('read: contents with the extension as language', () => {
    const part = done('read', { path: 'src/a.ts' }, [text('1: x')]);
    expect(toolBody(part)).toEqual([
      { kind: 'code', label: 'Contents', text: '1: x', from: 'head', language: 'ts' },
    ]);
  });

  it('read of an image: a note with the name and mime, no bytes', () => {
    const part = done('read', { path: 'a.png' }, [
      text('Image read successfully'),
      { type: 'file', mime: 'image/png', name: 'a.png' },
    ]);
    expect(toolBody(part)).toContainEqual({ kind: 'note', text: 'File: a.png (image/png)' });
  });

  it('edit: one diff per file of metadata.files, headers removed', () => {
    const part = done('edit', { path: 'src/a.ts' }, [], {
      files: [{ file: 'src/a.ts', patch: PATCH }],
    });
    expect(toolBody(part)).toEqual([
      {
        kind: 'diff',
        label: 'src/a.ts',
        path: 'src/a.ts',
        lines: [
          { kind: 'hunk', text: '@@ -1,2 +1,3 @@' },
          { kind: 'ctx', text: 'one' },
          { kind: 'del', text: 'two' },
          { kind: 'add', text: 'TWO' },
          { kind: 'add', text: 'three' },
        ],
      },
    ]);
  });

  it('edit without metadata: the input as a -old/+new block', () => {
    const part: ToolPart = {
      type: 'tool',
      id: 'c',
      name: 'edit',
      state: {
        status: 'running',
        input: { path: 'a.ts', oldString: 'a', newString: 'b' },
      },
    };
    expect(toolBody(part)).toEqual([
      {
        kind: 'diff',
        label: 'a.ts',
        path: 'a.ts',
        lines: [
          { kind: 'del', text: 'a' },
          { kind: 'add', text: 'b' },
        ],
      },
    ]);
  });

  it('write: the whole content as added lines', () => {
    const part = done('write', { path: 'b.ts', content: 'x\ny' });
    expect(toolBody(part)).toEqual([
      {
        kind: 'diff',
        label: 'b.ts',
        path: 'b.ts',
        lines: [
          { kind: 'add', text: 'x' },
          { kind: 'add', text: 'y' },
        ],
      },
    ]);
  });

  it('grep: matches grouped by file, with line numbers', () => {
    const part = done('grep', { pattern: 'greet' }, [
      text('Found 2 matches\nsrc/a.ts:\n  Line 3: export function greet()\n  Line 9: greet(1)\n'),
    ]);
    expect(toolBody(part)).toEqual([
      {
        kind: 'matches',
        label: 'Matches',
        groups: [
          {
            path: 'src/a.ts',
            hits: [
              { line: 3, text: 'export function greet()' },
              { line: 9, text: 'greet(1)' },
            ],
          },
        ],
      },
    ]);
  });

  it('grep: falls back to plain text when the output does not parse', () => {
    const part = done('grep', { pattern: 'x' }, [text('something else')]);
    expect(toolBody(part)).toEqual([
      { kind: 'code', label: 'Result', text: 'something else', from: 'head' },
    ]);
  });

  it('glob: one path per line', () => {
    const part = done('glob', { pattern: '*.ts' }, [text('a.ts\r\nsrc\\b.ts\n')]);
    expect(toolBody(part)).toEqual([
      { kind: 'paths', label: 'Files', paths: ['a.ts', 'src\\b.ts'] },
    ]);
  });

  it('an unknown tool, or a known one with the wrong input, gets the generic view', () => {
    const unknown = done('mcp_echo', { message: 'hi' }, [text('echo: hi')]);
    expect(toolBody(unknown)).toEqual([
      {
        kind: 'code',
        label: 'Input',
        text: '{\n  "message": "hi"\n}',
        from: 'head',
        language: 'json',
      },
      { kind: 'code', label: 'Output', text: 'echo: hi', from: 'head' },
    ]);
    const wrong = done('shell', { cmd: 'oops' }, [text('out')]);
    expect(
      toolBody(wrong).map((section) => (section.kind === 'code' ? section.label : '?')),
    ).toEqual(['Input', 'Output']);
  });

  it('shows the error of a real failure, and none for a rejection or a stop', () => {
    const failed: ToolPart = {
      type: 'tool',
      id: 'c',
      name: 'shell',
      state: {
        status: 'error',
        input: { command: 'x' },
        error: { code: 'tool.execution', message: 'Unable to execute', detail: 'ENOENT' },
      },
    };
    expect(toolBody(failed)).toContainEqual({ kind: 'error', text: 'Unable to execute\nENOENT' });
    const stopped: ToolPart = {
      type: 'tool',
      id: 'c',
      name: 'shell',
      state: {
        status: 'error',
        input: { command: 'x' },
        error: { code: 'aborted', message: 'Tool execution interrupted' },
      },
    };
    expect(toolBody(stopped).some((section) => section.kind === 'error')).toBe(false);
  });

  it('only a note while the input streams', () => {
    const part: ToolPart = {
      type: 'tool',
      id: 'c',
      name: 'edit',
      state: { status: 'streaming', input: '{"pa' },
    };
    expect(toolBody(part).map((section) => section.kind)).toEqual(['note']);
  });
});
