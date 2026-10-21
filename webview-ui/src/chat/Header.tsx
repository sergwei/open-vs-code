import { createMemo } from 'solid-js';
import type { ChatState } from '../store/chatStore';

/**
 * Title while the session has none. It must differ from the "New session" button next to it:
 * with the same text the bar read "New session [New session]" (seen in the CDP run of 20/10/2026).
 */
export const EMPTY_TITLE = 'Untitled session';

/** Label of the agent/model marker before the first assistant message gives it a value. */
const NO_MODEL_LABEL = 'Agent · model';

/**
 * The top bar (issue #12): session title, a placeholder for the agent/model selector, and New
 * session.
 *
 * The marker is a DISABLED button that shows `agent · providerID/id` of the newest assistant
 * message; the real selector (and the `switchModel`/`switchAgent` calls) is epic E5, so the
 * title says so. It is a button and not plain text so the place and the tab order are already
 * right when E5 lands. New session needs a live server, hence the disabled state otherwise.
 * UNVERIFIED visually until the F5.
 */
export function Header(props: { state: ChatState; onNewSession(): void }) {
  const title = createMemo(() => {
    const id = props.state.open.sessionID;
    return (id === undefined ? undefined : props.state.sessions[id]?.title) ?? EMPTY_TITLE;
  });
  const marker = createMemo(() => {
    const messages = props.state.open.messages;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message?.kind === 'assistant') {
        return `${message.agent} · ${message.model.providerID}/${message.model.id}`;
      }
    }
    return NO_MODEL_LABEL;
  });
  return (
    <header class="chat-header">
      <h1 class="chat-title" title={title()}>
        {title()}
      </h1>
      <button
        type="button"
        class="secondary model-marker"
        disabled
        title="Model and agent selection: coming in E5"
      >
        {marker()}
      </button>
      <button
        type="button"
        class="secondary"
        disabled={props.state.connection.state !== 'connected'}
        onClick={() => props.onNewSession()}
      >
        New session
      </button>
    </header>
  );
}
