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

/** A slash: the "Commands" button of the prompt bar. */
export function SlashIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M10.5 2.5l-5 11"
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

/** A person (head and shoulders): Manual work mode, where the user answers the permissions. */
export function PersonIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="5.2" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M2.8 13.5c.6-2.6 2.6-3.9 5.2-3.9s4.6 1.3 5.2 3.9"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  );
}

/** A lightning bolt: Auto work mode, where the host answers the permissions. */
export function BoltIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M9.2 1.8L3.6 9h3.9l-.7 5.2L12.4 7H8.5l.7-5.2z"
        fill="currentColor"
        stroke="currentColor"
        stroke-width="0.8"
        stroke-linejoin="round"
      />
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

/** A shield: the tab of a permission request in the request dock. */
export function ShieldIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M8 1.8l5 1.9v4c0 3-2.1 5-5 6.5-2.9-1.5-5-3.5-5-6.5v-4l5-1.9z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** A circled question mark: the tab of a question or form request in the request dock. */
export function QuestionIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path
        d="M6.2 6.4a1.9 1.9 0 1 1 2.6 1.8c-.5.3-.8.6-.8 1.2M8 11.2v.4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  );
}

/** A puzzle piece: the "Mods" button of the prompt bar (its name is the `aria-label`, not the shape). */
export function PuzzleIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M6 2.5h2.5v1.4a1.2 1.2 0 1 0 2.4 0V2.5H13.5v3h-1.4a1.2 1.2 0 1 0 0 2.4h1.4v5.6H8.9v-1.4a1.2 1.2 0 1 0-2.4 0v1.4H2.5V8H3.9a1.2 1.2 0 1 0 0-2.4H2.5v-3H6z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  );
}
