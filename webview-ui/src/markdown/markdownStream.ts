// Vendored from opencode (https://github.com/anomalyco/opencode), tag v2.0.32, commit
// 843a6c514e606b436a7fe713422ace0a93ad3d61, file
// packages/session-ui/src/components/markdown-stream.ts.
// License: MIT. Full notice of the upstream LICENSE at that commit (required by the MIT terms):
//
// MIT License
//
// Copyright (c) 2025 opencode
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// MODIFICATIONS (everything else is upstream code, only reformatted by Prettier):
//  - Removed the `markdownMath` import from `@opencode/ui/context/marked-parser`: the lexer is a
//    plain `new Marked()` (math in Markdown is out of scope).
//  - The import of `./markdown-projection` became `./markdownProjection` (file renamed to our
//    naming convention); the comment above `lexer` was rewritten to match.
//
// Why vendored and not imported: docs/research.md section 8 forbids depending on `@opencode/ui`,
// and the session-ui package is not a dependency of ours. Phase 2 of
// E2-mvp-prototype (issue #15).

import { Marked, type Tokens } from 'marked';
import remend from 'remend';
import { completedProjection } from './markdownProjection';

export type Block = {
  raw: string;
  src: string;
  mode: 'full' | 'live' | 'code';
  language?: string;
  complete?: boolean;
};

export type Projection = {
  text: string;
  blocks: Block[];
};

// Plain lexer: upstream splits with its math extension here, which we do not vendor.
const lexer = new Marked();

function refs(text: string) {
  if (!text.includes(']:')) return false;

  return /^[ \t]{0,3}\[[^\]]+\]:[ \t]*(?:\S+|\r?\n[ \t]+\S+)/m.test(text);
}

function language(value: string | undefined) {
  return value?.trim().split(/\s+/, 1)[0] || undefined;
}

function openCode(raw: string) {
  const newline = raw.indexOf('\n');

  return newline < 0 ? '' : raw.slice(newline + 1);
}

function open(raw: string) {
  const match = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/);

  if (!match) return false;
  const mark = match[1];

  if (!mark) return false;
  const char = mark[0];
  const size = mark.length;
  const last = raw.trimEnd().split('\n').at(-1)?.trim() ?? '';

  return !new RegExp(`^[\\t ]{0,3}${char}{${size},}[\\t ]*$`).test(last);
}

function closesFence(raw: string, suffix: string) {
  const mark = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/)?.[1];

  if (!mark) return suffix.includes('```') || suffix.includes('~~~');

  return `${raw.slice(-(mark.length - 1))}${suffix}`.includes(mark);
}

function heal(text: string) {
  return remend(text, { linkMode: 'text-only' });
}

export function stream(text: string, live: boolean): Block[] {
  if (!live) return completedProjection(text).blocks;

  if (refs(text)) return [{ raw: text, src: heal(text), mode: 'live' }] satisfies Block[];
  const tokens = lexer.lexer(text);
  const tail = tokens.findLastIndex((token) => token.type !== 'space');

  if (tail < 0) return [{ raw: text, src: heal(text), mode: 'live' }] satisfies Block[];
  const last = tokens[tail];

  if (!last) return [{ raw: text, src: heal(text), mode: 'live' }] satisfies Block[];

  const result: Block[] = [];

  for (let index = 0; index < tail; index++) {
    const token = tokens[index];

    if (!token || token.type === 'space') continue;
    let raw = token.raw;

    while (tokens[index + 1]?.type === 'space' && index + 1 < tail) raw += tokens[++index]!.raw;

    if (token.type === 'code') {
      // SAFETY: only marked's built-in fence tokenizer emits `code`; the math extensions use their own token types.
      const code = token as Tokens.Code;
      result.push({
        raw,
        src: code.text,
        mode: 'code',
        language: language(code.lang),
        complete: true,
      });
      continue;
    }

    result.push({ raw, src: raw, mode: 'full' });
  }

  const raw = tokens
    .slice(tail)
    .map((token) => token.raw)
    .join('');

  if (last.type !== 'code') return [...result, { raw, src: heal(raw), mode: 'live' }];

  // SAFETY: only marked's built-in fence tokenizer emits `code`; the math extensions use their own token types.
  const code = last as Tokens.Code;

  if (!open(code.raw))
    return [
      ...result,
      { raw, src: code.text, mode: 'code', language: language(code.lang), complete: true },
    ];

  return [...result, { raw, src: openCode(code.raw), mode: 'code', language: language(code.lang) }];
}

export function project(previous: Projection | undefined, text: string, live: boolean): Projection {
  if (!live) {
    const current =
      previous?.text === text
        ? previous
        : previous && text.startsWith(previous.text)
          ? project(previous, text, true)
          : undefined;

    if (!current) return completedProjection(text);

    return {
      text,
      blocks: current.blocks.map((block) => {
        if (block.mode === 'live') return { raw: block.raw, src: block.raw, mode: 'full' };

        if (block.mode === 'code' && !block.complete) return { ...block, complete: true };

        return block;
      }),
    };
  }

  if (!previous || !text.startsWith(previous.text)) return { text, blocks: stream(text, live) };
  const tail = previous.blocks.at(-1);
  const suffix = text.slice(previous.text.length);

  if (!suffix || tail?.mode !== 'code' || tail.complete || closesFence(tail.raw, suffix))
    return { text, blocks: stream(text, live) };

  return {
    text,
    blocks: [
      ...previous.blocks.slice(0, -1),
      {
        ...tail,
        raw: tail.raw + suffix,
        src: tail.src + suffix,
      },
    ],
  };
}
