import { For, Match, Show, Switch } from 'solid-js';
import type { Part } from '../../../src/shared/model';
import { RequestOutcome } from '../requests/RequestOutcome';
import type { OutcomeView } from '../requests/resolutionPlacement';
import { subagentOf, type SubagentLink } from '../sessions/lineage';
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
 * The one-line text of a `subagent` tool block, built as ONE string (JSX would swallow the line
 * break between `{expr}` and the next text: lesson #926). The agent and the description are
 * labels from the tool input and are left out when the input did not have them.
 */
function subagentLine(link: SubagentLink): string {
  const fields = ['Subagent'];
  if (link.agent !== undefined) fields.push(link.agent);
  if (link.description !== undefined) fields.push(link.description);
  fields.push(link.running ? 'running' : 'done');
  return fields.join(' · ');
}

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
 * runs once and an `if` would freeze on the first `type`.
 *
 * Issue #21: a `subagent` tool that carries the id of its child session (see `subagentOf`) shows
 * "Subagent · agent · description · running|done" and an "Open subagent session" button that calls
 * `onOpenSession` with that id; its accessible name includes the description, because a page of
 * them would otherwise be a column of identical buttons. Without the id (a reload while it ran,
 * or a failed block) it keeps the plain line. UNVERIFIED visually (themes, high contrast) until
 * the F5; `test:visual` step 10 renders the link in a real VS Code when the model calls the tool.
 */
export function PartView(props: {
  part: Part;
  live: boolean;
  outcomes?: OutcomeView[];
  onOpenSession(sessionID: string): void;
}) {
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
            <Show
              when={subagentOf(part())}
              fallback={
                <div class="part-tool">
                  {part().name} · {part().state.status}
                </div>
              }
            >
              {(link) => (
                <div class="part-tool part-subagent">
                  <span>{subagentLine(link())}</span>
                  <button
                    type="button"
                    class="secondary subagent-link"
                    aria-label={`Open subagent session ${link().description ?? ''}`.trim()}
                    onClick={() => {
                      props.onOpenSession(link().sessionID);
                    }}
                  >
                    Open subagent session
                  </button>
                </div>
              )}
            </Show>
            <For each={props.outcomes ?? []}>{(view) => <RequestOutcome view={view} />}</For>
          </>
        )}
      </Match>
    </Switch>
  );
}
