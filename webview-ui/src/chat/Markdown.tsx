import { createMemo, ErrorBoundary, Index, Match, Switch } from 'solid-js';
import { toBlocks } from '../markdown/blocks';
import type { Block, Projection } from '../markdown/markdownStream';
import { renderMarkdown } from '../markdown/renderMarkdown';
import { CodeBlock } from './CodeBlock';
import { useSend } from './hostContext';

/**
 * One block of the Markdown: a code block gets {@link CodeBlock}; anything else is sanitized HTML.
 *
 * Takes an accessor because it sits under `<Index>`, where the block at a position is a signal.
 * Each field is read through its own memo, so a position whose `src` did not change does not
 * touch the DOM even though the upstream splitter hands out new block objects on every frame.
 */
function BlockView(props: { block: () => Block }) {
  const mode = createMemo(() => props.block().mode);
  const src = createMemo(() => props.block().src);
  const language = createMemo(() => props.block().language);
  const complete = createMemo(() => props.block().complete === true);
  // Not for code blocks: they are drawn by CodeBlock, and rendering each token of a live fence
  // here would cost marked + DOMPurify for nothing and flood the render cache.
  const html = createMemo(() => (mode() === 'code' ? '' : renderMarkdown(src())));
  return (
    <Switch>
      <Match when={mode() === 'code'}>
        <CodeBlock code={src()} language={language()} complete={complete()} />
      </Match>
      <Match when={true}>
        <div class="md" innerHTML={html()} />
      </Match>
    </Switch>
  );
}

/**
 * Renders the Markdown text of an assistant part (issue #15), including while it streams.
 *
 * `live` says the text is still growing: only the tail block is re-split and re-rendered, and
 * closed blocks keep their DOM node (the test holds a reference to one and checks it is the same
 * after a delta). The previous projection lives in a closure, not in a signal, because the memo
 * reads it only to feed the next call. Clicks and Enter on a file reference
 * (`.file-ref`, rendered by `renderMarkdown`) post `editor.open` and stop there, so the click
 * never reaches anything above. An exception while rendering falls back to the plain text.
 * VERIFIED by `Markdown.test.tsx` in jsdom; UNVERIFIED: the look, and that no remote link or
 * `file:` URL ever reaches VS Code's own opener in the real iframe (F5, point 5).
 */
export function Markdown(props: { text: string; live: boolean }) {
  const send = useSend();
  let projection: Projection | undefined;
  const blocks = createMemo(() => {
    projection = toBlocks(props.text, props.live, projection);
    return projection.blocks;
  });

  const open = (reference: Element): void => {
    const path = reference.getAttribute('data-path');
    if (path === null || path === '') return;
    const line = Number(reference.getAttribute('data-line'));
    const column = Number(reference.getAttribute('data-column'));
    send({
      type: 'editor.open',
      path,
      ...(Number.isSafeInteger(line) && line >= 1 ? { line } : {}),
      ...(Number.isSafeInteger(column) && column >= 1 ? { column } : {}),
    });
  };

  return (
    <ErrorBoundary fallback={<div class="part-text">{props.text}</div>}>
      <div
        class="markdown"
        on:click={(event) => {
          const reference = event.target.closest('.file-ref');
          if (reference === null) return;
          event.stopPropagation();
          event.preventDefault();
          open(reference);
        }}
        on:keydown={(event) => {
          if (event.key !== 'Enter') return;
          const target = event.target;
          if (!target.classList.contains('file-ref')) return;
          event.stopPropagation();
          event.preventDefault();
          open(target);
        }}
      >
        <Index each={blocks()}>{(block) => <BlockView block={block} />}</Index>
      </div>
    </ErrorBoundary>
  );
}
