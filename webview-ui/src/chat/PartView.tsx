import { For, Match, Switch } from 'solid-js';
import type { Part } from '../../../src/shared/model';
import { RequestOutcome } from '../requests/RequestOutcome';
import type { OutcomeView } from '../requests/resolutionPlacement';
import { ToolCard } from '../tools/ToolCard';
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
 * it. A tool call is a collapsible {@link ToolCard} (issue #26) followed by the lines in
 * `outcomes`, which say what the user answered when the tool asked for permission or posed a
 * question ("Allowed once · Read .env", issues #56/#18; the caller computes them, see
 * `MessageList`); `awaiting` tells the card that one of those requests is still pending. The
 * branch is a `<Switch>` and not an early `return`, because a Solid component runs once and an
 * `if` would freeze on the first `type`.
 *
 * Issue #21: the "Open subagent session" button of a `subagent` tool now lives in the card header
 * and calls `onOpenSession` with the child id (`ToolCard` documents it). VERIFIED by
 * `App.test.tsx` (jsdom, fabricated blocks). VERIFIED in a real VS Code: `test:visual` step 10
 * (22/10/2026, the run of 13:59:27-14:05, Windows 11, VS Code 1.143.0, opencode 2.0.32)
 * printed `ok the tool block reads as a subagent line ("Subagent Say
 * hello (general) · done")`, `ok "Open subagent session" is pressed` and `ok the parent lists its
 * subagent session ("Subagent sessions (1)")`. NOT observed: the
 * `running` header of a subagent card in a real run, and a subagent card without a child id.
 */
export function PartView(props: {
  part: Part;
  live: boolean;
  outcomes?: OutcomeView[];
  awaiting?: boolean;
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
            <ToolCard
              part={part()}
              awaiting={props.awaiting ?? false}
              onOpenSession={(sessionID) => {
                props.onOpenSession(sessionID);
              }}
            />
            <For each={props.outcomes ?? []}>{(view) => <RequestOutcome view={view} />}</For>
          </>
        )}
      </Match>
    </Switch>
  );
}
