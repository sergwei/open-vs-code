/**
 * Splits the text of an assistant part into render blocks (issue #15), reusing the previous
 * split while the text only grows.
 */
import { project, stream, type Block, type Projection } from './markdownStream';

/**
 * Settles a block that was still being written: `live` becomes `full` (rendered from its raw
 * text, not from the healed one) and an unclosed code block becomes complete.
 */
function settle(block: Block): Block {
  if (block.mode === 'live') return { raw: block.raw, src: block.raw, mode: 'full' };
  if (block.mode === 'code' && !block.complete) return { ...block, complete: true };
  return block;
}

/**
 * Blocks of `text`. While `live`, only the tail is re-lexed (`project` of the vendored upstream
 * code) and closed blocks keep the same `src`, which is what lets the UI skip re-rendering them.
 * Once the message is finished, the text is split once more with the same lexer and every block
 * is settled.
 *
 * Why not upstream's `completedProjection`: it returns ONE `full` block with the whole text, so
 * the code blocks would lose their Copy / Insert / New file buttons the moment a turn ends.
 * The cost is one more lexer pass per finished part (O(n), once). VERIFIED by `blocks.test.ts`
 * with hand-written Markdown; the speed on a very long reply was not measured.
 */
export function toBlocks(text: string, live: boolean, previous?: Projection): Projection {
  if (live) return project(previous, text, true);
  return { text, blocks: stream(text, true).map(settle) };
}
