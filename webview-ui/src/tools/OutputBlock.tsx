import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { useSend } from '../chat/hostContext';
import { toVscodeLanguage } from '../markdown/languageIds';
import { clipText } from './patchLines';

/**
 * Most lines of a tool output painted at once. Our own figure (plan Engram #1035 section 6,
 * confirmed by the author, not measured): enough for a test run or a source file at a glance, small
 * enough that unfolding a card never builds thousands of DOM nodes. The full text stays available
 * through Copy and "Open in editor".
 */
export const MAX_LINES = 200;

/** Most characters painted at once; one minified line can be megabytes. Our own figure, see {@link MAX_LINES}. */
export const MAX_CHARS = 20_000;

/** How long "Copied" stays visible; same figure as `CodeBlock`. */
const COPIED_MS = 1500;

/**
 * A labelled block of text from a tool (command, output, file contents) in a scrollable `<pre>`,
 * clipped on screen with a notice and two actions on the FULL text: Copy (`clipboard.write`) and
 * "Open in editor" (`editor.newFile`, with a VS Code language when `language` is a known
 * extension or fence label).
 *
 * Clipping keeps the head or the tail (`from`): a shell keeps the tail because the error is at
 * the end. The notice says how many lines are hidden. No highlighting: the text may carry line
 * numbers (`read`) or terminal noise, and colouring is not worth the risk of colouring it wrong.
 * The `<pre>` is focusable so a keyboard user can scroll it. "Copied" is optimistic, as in
 * `CodeBlock`: the protocol has no answer for the clipboard.
 * VERIFIED by `ToolCard.test.tsx` (messages sent and the clip notice, fabricated text). VERIFIED in a
 * real VS Code only that the shell and read blocks render their text (`test:visual` step 15,
 * 22/10/2026, Windows 11: the checks "the shell body shows the output of node --version" and "the
 * read body shows the contents of src/sample.ts"). NOT observed in a real run: pressing Copy or
 * "Open in editor", a clipped output, scrolling, the `tail` clip.
 */
export function OutputBlock(props: {
  label: string;
  text: string;
  from: 'head' | 'tail';
  language?: string;
}) {
  const send = useSend();
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
  const clipped = createMemo(() => clipText(props.text, MAX_LINES, MAX_CHARS, props.from));
  const notice = createMemo(() => {
    const view = clipped();
    if (view.hidden === 0 && !view.truncatedLine) return undefined;
    const which = props.from === 'tail' ? 'last' : 'first';
    return view.hidden > 0
      ? `Showing the ${which} ${String(view.lines.length)} of ${String(view.total)} lines.`
      : `Showing the ${which} ${String(MAX_CHARS)} characters of a long line.`;
  });
  const name = (): string => props.label.toLowerCase();

  return (
    <div class="tool-section" role="group" aria-label={props.label}>
      <div class="tool-section-header">
        <span class="tool-section-label">{props.label}</span>
        <span class="tool-section-actions">
          <button
            type="button"
            class="code-action"
            aria-label={`Copy ${name()}`}
            onClick={() => {
              send({ type: 'clipboard.write', text: props.text });
              setCopied(true);
              if (timer !== undefined) clearTimeout(timer);
              timer = setTimeout(() => setCopied(false), COPIED_MS);
            }}
          >
            Copy
          </button>
          <button
            type="button"
            class="code-action"
            aria-label={`Open ${name()} in an editor`}
            onClick={() => {
              const language = toVscodeLanguage(props.language);
              send({
                type: 'editor.newFile',
                text: props.text,
                ...(language === undefined ? {} : { language }),
              });
            }}
          >
            Open in editor
          </button>
          <span class="code-copied" role="status">
            {copied() ? 'Copied' : ''}
          </span>
        </span>
      </div>
      <pre class="tool-output" tabindex="0" aria-label={props.label}>
        <code>{clipped().lines.join('\n')}</code>
      </pre>
      <Show when={notice()}>{(text) => <p class="tool-notice">{text()}</p>}</Show>
    </div>
  );
}
