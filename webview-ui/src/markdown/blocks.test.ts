// Protects the streaming contract of the Markdown blocks: while the text only grows, the blocks
// that are already closed keep the SAME `src` (so the UI does not rewrite their DOM), an open
// fence is a code block that is not `complete` (shown as plain text), and a finished message
// still has separate code blocks (Copy / Insert / New file need them).
//
// Provenance: hand-written Markdown driven through the vendored upstream `project`/`stream`
// (tag v2.0.32). They confirm our wrapper and the upstream behaviour we rely on, not a long real
// reply, and they do not measure speed.
import { describe, expect, it } from 'vitest';
import { toBlocks } from './blocks';

describe('toBlocks while live', () => {
  it('keeps closed blocks identical as deltas arrive', () => {
    const first = toBlocks('first paragraph\n\nsecond', true);
    const second = toBlocks('first paragraph\n\nsecond paragraph\n\nthi', true, first);
    expect(first.blocks.map((b) => b.mode)).toEqual(['full', 'live']);
    expect(second.blocks[0]?.src).toBe(first.blocks[0]?.src);
    expect(second.blocks[0]).toEqual(first.blocks[0]);
    expect(second.blocks).toHaveLength(3);
  });

  it('shows an open fence as an incomplete code block, and completes it on close', () => {
    const open = toBlocks('text\n\n```ts\nconst a = 1;\n', true);
    const last = open.blocks.at(-1);
    expect(last).toMatchObject({ mode: 'code', language: 'ts', src: 'const a = 1;\n' });
    expect(last?.complete).toBeUndefined();

    const closed = toBlocks('text\n\n```ts\nconst a = 1;\n```\n\nafter', true, open);
    expect(closed.blocks.find((b) => b.mode === 'code')).toMatchObject({
      src: 'const a = 1;',
      complete: true,
    });
  });

  it('treats a reference definition as one live block (upstream behaviour)', () => {
    const result = toBlocks('[a]: https://example.com\n\nA [link][a]', true);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.mode).toBe('live');
  });
});

describe('toBlocks when finished', () => {
  it('settles the live block to full', () => {
    const result = toBlocks('one\n\ntwo', false);
    expect(result.blocks.map((b) => b.mode)).toEqual(['full', 'full']);
    expect(result.blocks[1]?.src).toBe('two');
  });

  it('keeps code blocks separate and complete (completedProjection would merge them)', () => {
    const result = toBlocks('intro\n\n```bash\nls\n```\n\noutro', false);
    expect(result.blocks.map((b) => b.mode)).toEqual(['full', 'code', 'full']);
    expect(result.blocks[1]).toMatchObject({ language: 'bash', src: 'ls', complete: true });
  });

  it('completes a fence that was never closed', () => {
    const result = toBlocks('```py\nprint(1)', false);
    expect(result.blocks.at(-1)).toMatchObject({ mode: 'code', complete: true });
  });

  it('renders the raw text, not the healed text, of the last block', () => {
    expect(toBlocks('a **b', false).blocks[0]?.src).toBe('a **b');
  });
});
