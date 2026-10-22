import { Show } from 'solid-js';
import { useSend } from '../chat/hostContext';

/**
 * A path of a tool result as a button that opens it in the editor (decision (e) of Sergio,
 * 22/10/2026), optionally at a 1-based line.
 *
 * It sends the existing `editor.open`; the host resolves relative paths against the workspace
 * folder and refuses anything outside it (`pathPolicy.ts`), so a path chosen by the model cannot
 * open `~/.ssh`. The model's path is shown as text, never as markup. A real `<button>` and not a
 * `role="link"` code span: it is reachable with Tab and answers Enter and Space for free. The
 * accessible name carries the whole path and the line, because the visible text may be a short
 * name. VERIFIED by `ToolCard.test.tsx` (message sent, fabricated paths). VERIFIED in a real VS Code
 * for the header "Open" button of a read card: `test:visual` step 15 (22/10/2026, final run 13:59-14:05, Windows 11)
 * pressed it with the real mouse and the check "pressing the path opens src/sample.ts in the editor
 * (1 tab)" passed (line 394 of `.vscode-test/visual/run-output.txt`). NOT observed: the line variant (`at line N`) and the grep hit buttons in a real
 * editor (the grep body had them, but the run did not press them), a path outside the folder.
 */
export function PathLink(props: { path: string; line?: number; text?: string }) {
  const send = useSend();
  return (
    <button
      type="button"
      class="tool-path"
      aria-label={`Open ${props.path}${props.line === undefined ? '' : ` at line ${String(props.line)}`}`}
      onClick={() => {
        send({
          type: 'editor.open',
          path: props.path,
          ...(props.line === undefined ? {} : { line: props.line }),
        });
      }}
    >
      <Show when={props.text} fallback={props.path}>
        {(text) => text()}
      </Show>
    </button>
  );
}
