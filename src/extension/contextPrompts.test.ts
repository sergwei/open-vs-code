// Protects the wording of the context-menu prompts (issue #36, decisions P3=1 and P4=1 of Sergio,
// 29/10/2026): the exact sentence per action and number of references, the `@name` that
// `mentionsFor` pairs with a chip, and the diagnostics list of Fix (order, cap, one line each).
// Provenance: references and diagnostics are FABRICATED by hand; nothing here talks to VS Code or to
// a model, so it proves the strings, not that the model answers well to them.
import { describe, expect, it } from 'vitest';
import {
  buildContextPrompt,
  MAX_DIAGNOSTIC_MESSAGE_LENGTH,
  MAX_PROMPT_DIAGNOSTICS,
  type ContextDiagnostic,
} from './contextPrompts';

const ref = (name: string) => ({ uri: `file:///ws/${name}`, name });

describe('buildContextPrompt explain', () => {
  it('names one selection with does', () => {
    expect(buildContextPrompt({ action: 'explain', refs: [ref('src/a.ts#2-3')] })).toBe(
      'Explain what @src/a.ts#2-3 does.',
    );
  });

  it('joins two with and, and from three on with commas', () => {
    expect(buildContextPrompt({ action: 'explain', refs: [ref('a.ts'), ref('b.ts')] })).toBe(
      'Explain what @a.ts and @b.ts do.',
    );
    expect(
      buildContextPrompt({ action: 'explain', refs: [ref('a.ts'), ref('b.ts'), ref('c.ts')] }),
    ).toBe('Explain what @a.ts, @b.ts and @c.ts do.');
  });

  it('ignores diagnostics', () => {
    expect(
      buildContextPrompt({
        action: 'explain',
        refs: [ref('a.ts')],
        diagnostics: [{ line: 1, message: 'x' }],
      }),
    ).toBe('Explain what @a.ts does.');
  });

  it('does not leave a hole when there are no references', () => {
    expect(buildContextPrompt({ action: 'explain', refs: [] })).toBe('Explain what this does.');
  });
});

describe('buildContextPrompt fix', () => {
  it('is the bare sentence without diagnostics', () => {
    expect(buildContextPrompt({ action: 'fix', refs: [ref('src/a.ts#2-3')] })).toBe(
      'Fix the problems in @src/a.ts#2-3.',
    );
    expect(
      buildContextPrompt({ action: 'fix', refs: [ref('a.ts'), ref('b.ts')], diagnostics: [] }),
    ).toBe('Fix the problems in @a.ts and @b.ts.');
  });

  it('lists the diagnostics by line with source and code, on one line each', () => {
    const diagnostics: ContextDiagnostic[] = [
      { line: 12, message: "Cannot find name 'x'.", source: 'ts', code: '2304' },
      { line: 3, message: 'Unused\n   variable', source: 'eslint' },
      { line: 7, message: 'Bare message' },
    ];
    expect(buildContextPrompt({ action: 'fix', refs: [ref('a.ts')], diagnostics })).toBe(
      [
        'Fix the problems in @a.ts.',
        '',
        'Problems reported by VS Code:',
        '- Line 3: Unused variable (eslint)',
        '- Line 7: Bare message',
        "- Line 12: Cannot find name 'x'. (ts 2304)",
      ].join('\n'),
    );
  });

  it('caps the list and says how many were left out', () => {
    const diagnostics = Array.from({ length: MAX_PROMPT_DIAGNOSTICS + 3 }, (_, n) => ({
      line: n + 1,
      message: `problem ${String(n + 1)}`,
    }));
    const lines = buildContextPrompt({ action: 'fix', refs: [ref('a.ts')], diagnostics }).split(
      '\n',
    );
    expect(lines.filter((line) => line.startsWith('- Line'))).toHaveLength(MAX_PROMPT_DIAGNOSTICS);
    expect(lines.at(-1)).toBe('- … and 3 more');
  });

  it('shortens a very long message', () => {
    const text = buildContextPrompt({
      action: 'fix',
      refs: [ref('a.ts')],
      diagnostics: [{ line: 1, message: 'x'.repeat(MAX_DIAGNOSTIC_MESSAGE_LENGTH * 2) }],
    });
    const line = text.split('\n').at(-1) ?? '';
    expect(line).toBe(`- Line 1: ${'x'.repeat(MAX_DIAGNOSTIC_MESSAGE_LENGTH - 1)}…`);
  });
});
