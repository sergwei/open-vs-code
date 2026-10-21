import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { highlightCode } from '../markdown/renderMarkdown';
import { toVscodeLanguage } from '../markdown/languageIds';
import { useSend } from './hostContext';

/** How long "Copied" stays visible. Our own choice: long enough to read, short enough to not nag. */
const COPIED_MS = 1500;

/**
 * One fenced code block with its three actions (issue #15): Copy, Insert at cursor and New file.
 *
 * A closed fence (`complete`) is highlighted with highlight.js (sanitized HTML, `hljs-*` classes
 * styled with `--vscode-*` variables); a fence still being written is plain text, so a half-typed
 * block is never coloured wrongly and no HTML is rebuilt per token. The actions go to the host
 * (`clipboard.write`, `editor.insert`, `editor.newFile`); they have no `requestId`, so a failure
 * (no active editor, say) comes back as a notice, and "Copied" is optimistic: it shows before the
 * host confirms, because the protocol has no answer for it. The New file language is the VS Code
 * id from the fence label, and the host drops it if VS Code does not know it.
 * VERIFIED by `CodeBlock.test.tsx` (messages sent). UNVERIFIED in a real webview: colours in the
 * four theme kinds, focus ring and the accessible names with a screen reader.
 */
export function CodeBlock(props: {
  code: string;
  language: string | undefined;
  complete: boolean;
}) {
  const send = useSend();
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
  const html = createMemo(() =>
    props.complete ? highlightCode(props.code, props.language) : undefined,
  );

  const copy = (): void => {
    send({ type: 'clipboard.write', text: props.code });
    setCopied(true);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => setCopied(false), COPIED_MS);
  };
  const insert = (): void => {
    send({ type: 'editor.insert', text: props.code });
  };
  const newFile = (): void => {
    const language = toVscodeLanguage(props.language);
    send({
      type: 'editor.newFile',
      text: props.code,
      ...(language === undefined ? {} : { language }),
    });
  };

  return (
    <div class="code-block">
      <div class="code-header">
        <span class="code-language">{props.language ?? 'text'}</span>
        <span class="code-actions">
          <button type="button" class="code-action" aria-label="Copy code" onClick={copy}>
            Copy
          </button>
          <button
            type="button"
            class="code-action"
            aria-label="Insert code at cursor"
            onClick={insert}
          >
            Insert
          </button>
          <button
            type="button"
            class="code-action"
            aria-label="Open code in a new file"
            onClick={newFile}
          >
            New file
          </button>
          <span class="code-copied" role="status">
            {copied() ? 'Copied' : ''}
          </span>
        </span>
      </div>
      <pre class="code-body">
        <Show when={html()} fallback={<code>{props.code}</code>}>
          {(highlighted) => <code innerHTML={highlighted()} />}
        </Show>
      </pre>
    </div>
  );
}
