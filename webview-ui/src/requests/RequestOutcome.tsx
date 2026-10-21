import type { OutcomeView } from './resolutionPlacement';

/**
 * One line of the history saying what the user answered ("Allowed once · Read .env"), placed under
 * the tool that asked (issues #56/#18).
 *
 * Plain text inside the `role="log"` of the conversation, which is already `aria-live="polite"`:
 * its insertion is announced by that region, so the line has no role of its own (no
 * `role="alert"`: a Reject is a decision, not a failure) and never moves the focus. The prefix
 * ("Permission:" / "Question:") is visually hidden and tells a screen reader what the line is. It
 * is built as one string each, because JSX removes the spaces between `{expr}` and text (lesson
 * #926). VERIFIED by `App.test.tsx` (jsdom) and, rendered in a real VS Code, by `test:visual`;
 * how a screen reader reads it is UNVERIFIED.
 */
export function RequestOutcome(props: { view: OutcomeView }) {
  return (
    <p class="request-outcome" data-tone={props.view.tone}>
      <span class="visually-hidden">{`${props.view.prefix}: `}</span>
      {props.view.text}
    </p>
  );
}
