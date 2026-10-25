import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import type { SessionSummary } from '../../../src/shared/model';
import { changedFilesSummary } from '../changes/changedFileText';
import { ChangedFilesList } from '../changes/ChangedFilesList';
import { childrenOf } from '../sessions/lineage';
import { SessionPicker } from '../sessions/SessionPicker';
import { EMPTY_TITLE, sessionLabel } from '../sessions/sessionGroups';
import type { ChatStore } from '../store/chatStore';
import { UsageIndicator } from './UsageIndicator';

/** `id` of the session list panel, referenced by the `aria-controls` of its button. */
const PICKER_ID = 'session-picker';

/**
 * The top bar (issues #12 and #20): session title, the "Sessions" button that opens the session
 * list under the bar, and New session. The agent and model selectors are NOT here: since issues
 * #23/#24 they live in the prompt row (decision of 21/10/2026, Engram #1012, which reverts the
 * placeholder this bar used to hold), and each reply shows the agent and model that answered.
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
 * Issue #21 adds the navigation between related sessions, all driven by the rows the snapshot
 * brings (`state.sessions`), not by the session list (which stays roots only): above the title a
 * `<nav aria-label="Session path">` with "‹ <parent title>" when the open session is a subagent
 * child, or "Forked from <title>" when it is a fork (a plain "Forked session" text when the
 * original is no longer known: nothing to open); under the bar a `<details>` "Subagent sessions
 * (N)" listing the children of the open session, closed by default, one button each with the
 * agent and "Running" / "Needs input" as text. `<details>` gives the keyboard and the expanded
 * state for free. Every phrase is built as one string (lesson #926). The accessible names carry
 * the visible words: "Forked from <title>: open the original session" for the fork crumb, and
 * "Open subagent session <title>, <agent · Running · Needs input>" for each child.
 * Issue #25 adds {@link UsageIndicator} right under the bar: the context and cost line of the open
 * session (Sergio's placement choice, 22/10/2026), above the subagent list and under the title.
 * Issue #31 adds a second `<details>` right after it: "Changed files (N)" (Sergio's choice of
 * 23/10/2026, Engram #1153), closed by default and drawn only when the open session has changed
 * files. It holds {@link ChangedFilesList}, the same presentational rows issue #32 will reuse; a
 * click reports the path through `onOpenChangedFile` and the host opens the diff. When the host
 * could not refresh the list, one line under the summary says so (`state.diff.error`) and the
 * rows are the last list it had.
 * VERIFIED in jsdom (`App.test.tsx`, `SessionPicker.test.tsx`) and by `npm run test:visual`
 * (steps 1-9, Windows 11, real VS Code; step 10 for the lineage); macOS/Linux UNVERIFIED.
 */
export function Header(props: {
  store: ChatStore;
  onNewSession(): void;
  /** Grows each time the host's New Session command runs (issue #35); the session list closes, as on the button. */
  closePickerRequest: number;
  onOpenSession(sessionID: string): void;
  onOpenChangedFile: (path: string) => void;
}) {
  const state = props.store.state;
  const [pickerOpen, setPickerOpen] = createSignal(false);
  createEffect(
    on(
      () => props.closePickerRequest,
      () => {
        setPickerOpen(false);
      },
      { defer: true },
    ),
  );
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
  /** The summary row of the open session, if the host has sent it. */
  const openRow = createMemo(() => {
    const id = state.open.sessionID;
    return id === undefined ? undefined : state.sessions[id];
  });
  /** What the path above the title says and, when there is something to open, where it goes. */
  const path = createMemo(() => {
    const row = openRow();
    if (row === undefined) return undefined;
    if (row.parentID !== undefined) {
      const label = sessionLabel(state.sessions[row.parentID] ?? {});
      return {
        text: `‹ ${label}`,
        name: `Back to parent session ${label}`,
        target: row.parentID,
      };
    }
    if (row.forkOf !== undefined) {
      const origin = state.sessions[row.forkOf];
      if (origin === undefined)
        return { text: 'Forked session', name: undefined, target: undefined };
      const label = sessionLabel(origin);
      return {
        text: `Forked from ${label}`,
        // Starts with the visible text so voice control ("click Forked from") finds it (WCAG 2.5.3).
        name: `Forked from ${label}: open the original session`,
        target: row.forkOf,
      };
    }
    return undefined;
  });
  const children = createMemo(() => {
    const id = state.open.sessionID;
    return id === undefined ? [] : childrenOf(state.sessions, id);
  });
  /** "agent · Running · Needs input" for a child row; the words are the state, not a colour. */
  const childMeta = (child: SessionSummary): string => {
    const status = state.statuses[child.id]?.type;
    const fields: string[] = [];
    if (child.agent !== undefined) fields.push(child.agent);
    if (status === 'busy' || status === 'retry') fields.push('Running');
    if (
      state.requests.permissions.some((ask) => ask.sessionID === child.id) ||
      state.requests.forms.some((ask) => ask.sessionID === child.id)
    ) {
      fields.push('Needs input');
    }
    return fields.join(' · ');
  };
  /**
   * Accessible name of a child button: the action, the title and then the same state words the
   * button shows, so a screen reader hears "Running" / "Needs input" too (an `aria-label` replaces
   * the content, it does not add to it). HYPOTHESIS: a real screen reader was not run; jsdom
   * (`App.test.tsx`) checks the string only.
   */
  const childName = (child: SessionSummary): string => {
    const meta = childMeta(child);
    const base = `Open subagent session ${sessionLabel(child)}`;
    return meta === '' ? base : `${base}, ${meta}`;
  };
  /** Closes the panel; `restoreFocus` puts the focus back on the "Sessions" button. */
  const closePicker = (restoreFocus: boolean): void => {
    setPickerOpen(false);
    if (restoreFocus) trigger?.focus();
  };

  return (
    <div class="header-area">
      <Show when={path()}>
        {(current) => (
          <nav class="session-path" aria-label="Session path">
            <Show
              when={current().target}
              fallback={<span class="session-path-text">{current().text}</span>}
            >
              {(target) => (
                <button
                  type="button"
                  class="secondary session-path-link"
                  aria-label={current().name}
                  onClick={() => {
                    setPickerOpen(false);
                    props.onOpenSession(target());
                  }}
                >
                  {current().text}
                </button>
              )}
            </Show>
          </nav>
        )}
      </Show>
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
      <UsageIndicator store={props.store} />
      <Show when={children().length > 0}>
        <details class="subagent-sessions">
          <summary>{`Subagent sessions (${String(children().length)})`}</summary>
          <ul class="subagent-list">
            <For each={children()}>
              {(child) => (
                <li>
                  <button
                    type="button"
                    class="secondary subagent-child"
                    aria-label={childName(child)}
                    onClick={() => {
                      setPickerOpen(false);
                      props.onOpenSession(child.id);
                    }}
                  >
                    <span class="session-title">{sessionLabel(child)}</span>
                    <Show when={childMeta(child) !== ''}>
                      <span class="session-meta">{childMeta(child)}</span>
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </details>
      </Show>
      <Show when={state.diff.files.length > 0}>
        <details class="changed-files">
          <summary>{changedFilesSummary(state.diff.files.length)}</summary>
          <Show when={state.diff.error}>
            {(failure) => (
              <p class="changed-files-error">{`Could not refresh the list: ${failure().message}`}</p>
            )}
          </Show>
          <ChangedFilesList files={state.diff.files} onOpen={props.onOpenChangedFile} />
        </details>
      </Show>
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
