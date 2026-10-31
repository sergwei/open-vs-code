import { createMemo, createSignal, Show } from 'solid-js';
import { isLongUserText } from './longMessage';

/**
 * The text of a user message (issue #105): plain, or folded to six lines behind a "Show more" /
 * "Show less" button when `isLongUserText`. The whole text stays in the DOM, so a screen reader
 * and a text search read all of it; folding is only CSS (`.part-text[data-folded]`, no `style`
 * attribute: the CSP forbids it). The button is a native one with `aria-expanded` and
 * `aria-controls` pointing at the text, so Tab and Enter/Space work without extra code.
 *
 * The unfolded state is a signal of this component, so it survives the store updating the message
 * in place (the list keeps the DOM of a message that reconciles) and is lost when the session is
 * opened again or the view is reloaded (decision P3=1). Its id is derived from the message id,
 * which the server makes unique per session.
 * VERIFIED in jsdom by the `App.test.tsx` checks of "folds a long user message" (fabricated
 * messages). VERIFIED in a real window (`npm run test:visual -- --steps 24,33 --bail`, Windows 11,
 * VS Code 1.144.0, 31/10/2026): "ok   at 300 px, dark: F1 the folded text is shorter than the
 * whole text (105.5999984741211 of 493 px)", "ok   at 300 px, hc-light: F1 the "Show more" button
 * has contrast >= 4.5 (14.55)" and "ok   F2 Enter unfolds it: "Show less", aria-expanded true,
 * taller (105.5999984741211 -> 492.8000183105469 px)". Not observed: macOS, Linux, a screen reader.
 */
export function UserText(props: { id: string; text: string }) {
  const [open, setOpen] = createSignal(false);
  const long = createMemo(() => isLongUserText(props.text));
  const textId = () => `user-text-${props.id}`;
  return (
    <>
      <div class="part-text" id={textId()} data-folded={long() && !open() ? '' : undefined}>
        {props.text}
      </div>
      <Show when={long()}>
        <button
          type="button"
          class="secondary message-fold"
          aria-expanded={open()}
          aria-controls={textId()}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {open() ? 'Show less' : 'Show more'}
        </button>
      </Show>
    </>
  );
}
