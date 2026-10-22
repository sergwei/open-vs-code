import { Show } from 'solid-js';
import { attachmentTarget, openLabel } from './attachmentTarget';
import { useSend } from './hostContext';

/**
 * The name of an attachment chip, as a button that opens the file in the editor (issues #28/#29)
 * at the first line of its range when it has one. Used by the chips of the prompt and by those of
 * the conversation, so both behave the same after a reload or a resync.
 *
 * It sends the existing `editor.open` with the `file:` URL stripped of its query: the host resolves
 * it against the folder the SERVER serves and refuses anything outside it, so a chip for a file
 * elsewhere shows a notice instead of opening. An attachment without a `file:` URL (a `data:` one
 * the host never forwards, or no `uri` at all) stays plain text. A real `<button>` so Tab, Enter
 * and Space work; the accessible name says the range in words (`openLabel`), the visible name and
 * the tooltip stay the short `name`. VERIFIED by `AttachmentOpenButton.test.tsx` and the chip
 * cases of `PromptInput.test.tsx` / `App.test.tsx` (message sent, fabricated chips). VERIFIED in a
 * real VS Code 1.143.0 on Windows 11 (22/10/2026, `test:visual` step 16): "pressing the chip opens
 * src/sample.ts in the editor (1 tab)" for a pending chip, and "the conversation chip opens
 * src/sample.ts at line 2 (status bar: "Ln 2, Col 1")" for a sent one with a range. NOT observed: a
 * chip of a file outside the folder (the host refuses it with a notice), a chip after Reload
 * Window, a screen reader.
 */
export function AttachmentOpenButton(props: { name: string; uri?: string | undefined }) {
  const send = useSend();
  const target = () => attachmentTarget(props.uri);
  return (
    <Show when={target()} fallback={<span class="chip-name">{props.name}</span>}>
      {(resolved) => (
        <button
          type="button"
          class="chip-open"
          title={props.name}
          aria-label={openLabel(props.name, resolved())}
          onClick={() => {
            const { path, line } = resolved();
            send({ type: 'editor.open', path, ...(line === undefined ? {} : { line }) });
          }}
        >
          {props.name}
        </button>
      )}
    </Show>
  );
}
