// Inline SVG icons of the setup guide, the error card and the prompt bar (E2, issue #85, P9=1): drawn with
// `currentColor` so every theme, high contrast included, colours them through the CSS of the
// element that holds them. They are decorative (`aria-hidden`): the state is always also text.
// No icon font and no dependency, so the CSP needs nothing new.

/** A check mark: a step that passed. */
export function CheckIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M3 8.5l3.2 3.2L13 4.8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** A cross: the step that failed. */
export function CrossIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

/** A warning triangle: the mark of the error card. */
export function WarningIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M8 2.2L14.6 13.5H1.4L8 2.2zM8 6.4v3.4M8 11.3v.4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** A down chevron: the mark of the agent and model chip (it opens a panel). */
export function ChevronIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M3.5 6l4.5 4.5L12.5 6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** A plus sign: the "Add context" button of the prompt bar. */
export function PlusIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M8 3v10M3 8h10"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

/** An arrow pointing up: the round Send button (its name is the `aria-label`, not the shape). */
export function SendIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M8 13V3.5M3.8 7.2L8 3l4.2 4.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** A filled square: the round Stop button. */
export function StopIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

/** An empty circle: a step that has not started yet. */
export function WaitingIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  );
}
