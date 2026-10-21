import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { SessionPicker } from '../sessions/SessionPicker';
import { EMPTY_TITLE } from '../sessions/sessionGroups';
import type { ChatStore } from '../store/chatStore';

/** Label of the agent/model marker before the first assistant message gives it a value. */
const NO_MODEL_LABEL = 'Agent · model';

/** `id` of the session list panel, referenced by the `aria-controls` of its button. */
const PICKER_ID = 'session-picker';

/**
 * The top bar (issues #12 and #20): session title, the "Sessions" button that opens the session
 * list under the bar, a placeholder for the agent/model selector, and New session.
 *
 * "Sessions" is a disclosure button (`aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`)
 * that shows {@link SessionPicker} inside the same `position: relative` area, so the panel hangs
 * under the bar and over the conversation. Closing it with Escape returns the focus to this
 * button; a click outside or choosing a session does not (the user is already elsewhere). It, like
 * New session, needs a live server, hence the disabled state otherwise (and a panel left open when
 * the connection drops closes, in an effect). New session is LAZY since issue #20: it only empties the view and
 * the first prompt creates the session; the title therefore reads "Untitled session" until the
 * model names the new session.
 *
 * The marker is a DISABLED button that shows `agent · providerID/id` of the newest assistant
 * message; the real selector (and the `switchModel`/`switchAgent` calls) is epic E5, so the
 * title says so. It is a button and not plain text so the place and the tab order are already
 * right when E5 lands. VERIFIED in jsdom (`App.test.tsx`, `SessionPicker.test.tsx`) and by
 * `npm run test:visual` (steps 1-9, Windows 11, real VS Code); macOS/Linux UNVERIFIED.
 */
export function Header(props: {
  store: ChatStore;
  onNewSession(): void;
  onOpenSession(sessionID: string): void;
}) {
  const state = props.store.state;
  const [pickerOpen, setPickerOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  const connected = () => state.connection.state === 'connected';
  // A panel left open when the connection drops closes, and does not reappear on reconnecting.
  createEffect(() => {
    if (!connected()) setPickerOpen(false);
  });

  const title = createMemo(() => {
    const id = state.open.sessionID;
    return (id === undefined ? undefined : state.sessions[id]?.title) ?? EMPTY_TITLE;
  });
  const marker = createMemo(() => {
    const messages = state.open.messages;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message?.kind === 'assistant') {
        return `${message.agent} · ${message.model.providerID}/${message.model.id}`;
      }
    }
    return NO_MODEL_LABEL;
  });

  /** Closes the panel; `restoreFocus` puts the focus back on the "Sessions" button. */
  const closePicker = (restoreFocus: boolean): void => {
    setPickerOpen(false);
    if (restoreFocus) trigger?.focus();
  };

  return (
    <div class="header-area">
      <header class="chat-header">
        <h1 class="chat-title" title={title()}>
          {title()}
        </h1>
        <button
          type="button"
          class="secondary"
          data-session-trigger
          aria-haspopup="dialog"
          aria-expanded={pickerOpen()}
          aria-controls={PICKER_ID}
          disabled={!connected()}
          ref={(element) => {
            trigger = element;
          }}
          onClick={() => {
            setPickerOpen(!pickerOpen());
          }}
        >
          Sessions
        </button>
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
          disabled={!connected()}
          onClick={() => {
            setPickerOpen(false);
            props.onNewSession();
          }}
        >
          New session
        </button>
      </header>
      <Show when={pickerOpen()}>
        <div id={PICKER_ID}>
          <SessionPicker
            store={props.store}
            onClose={closePicker}
            onOpenSession={(sessionID) => {
              setPickerOpen(false);
              props.onOpenSession(sessionID);
            }}
          />
        </div>
      </Show>
    </div>
  );
}
