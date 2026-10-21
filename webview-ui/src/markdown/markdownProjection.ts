// Vendored from opencode (https://github.com/anomalyco/opencode), tag v2.0.32, commit
// 843a6c514e606b436a7fe713422ace0a93ad3d61, file
// packages/session-ui/src/components/markdown-projection.ts.
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
//  - The import of `./markdown-stream` became `./markdownStream` (file renamed to our naming
//    convention). No other change.
//
// Why vendored and not imported: docs/research.md section 8 forbids depending on `@opencode/ui`,
// and the session-ui package is not a dependency of ours. Phase 2 of
// E2-mvp-prototype (issue #15).

import type { Block, Projection } from './markdownStream';

export function completedProjection(text: string): Projection {
  return { text, blocks: [{ raw: text, src: text, mode: 'full' }] };
}

export function canReusePendingBlock(
  current: Pick<Block, 'mode' | 'raw'> | undefined,
  next: Block,
) {
  if (!current || current.mode !== next.mode) return false;

  if (next.mode === 'code' || next.mode === 'live') return next.raw.startsWith(current.raw);

  return current.raw === next.raw;
}
