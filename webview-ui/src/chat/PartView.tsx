import { For, Match, Switch } from 'solid-js';
import type { Part } from '../../../src/shared/model';
import { RequestOutcome } from '../requests/RequestOutcome';
import type { OutcomeView } from '../requests/resolutionPlacement';
import { Markdown } from './Markdown';

type TextPart = Extract<Part, { type: 'text' }>;
type ReasoningPart = Extract<Part, { type: 'reasoning' }>;
type ToolPart = Extract<Part, { type: 'tool' }>;

/** Narrowing helpers for `<Match when>`: the part itself when it has that type, else `undefined`. */
const asText = (part: Part): TextPart | undefined => (part.type === 'text' ? part : undefined);
const asReasoning = (part: Part): ReasoningPart | undefined =>
  part.type === 'reasoning' ? part : undefined;
const asTool = (part: Part): ToolPart | undefined => (part.type === 'tool' ? part : undefined);

/**
 * Renders one content block of an assistant message.
 *
 * Text is Markdown (issue #15; `live` tells it the text is still streaming so only the tail is
 * re-rendered). Reasoning stays plain pre-wrapped text inside a collapsed `<details>` titled
 * "Thinking": it is the model's scratchpad, not worth the cost or the attack surface of rendering
 * it. A tool call is a single `name · status` line (tool rendering is a later issue) followed by
 * the lines in `outcomes`, which say what the user answered when the tool asked for permission or
 * posed a question ("Allowed once · Read .env", issues #56/#18; the caller computes them, see
 * `MessageList`). The branch is a `<Switch>` and not an early `return`, because a Solid component
 * runs once and an `if` would freeze on the first `type`. UNVERIFIED visually (themes, high
 * contrast) until the F5; `test:visual` renders the outcome lines in a real VS Code.
 */
export function PartView(props: { part: Part; live: boolean; outcomes?: OutcomeView[] }) {
  return (
    <Switch>
      <Match when={asText(props.part)}>
        {(part) => <Markdown text={part().text} live={props.live} />}
      </Match>
      <Match when={asReasoning(props.part)}>
        {(part) => (
          <details class="part-reasoning">
            <summary>Thinking</summary>
            <div class="part-reasoning-text">{part().text}</div>
          </details>
        )}
      </Match>
      <Match when={asTool(props.part)}>
        {(part) => (
          <>
            <div class="part-tool">
              {part().name} · {part().state.status}
            </div>
            <For each={props.outcomes ?? []}>{(view) => <RequestOutcome view={view} />}</For>
          </>
        )}
      </Match>
    </Switch>
  );
}
