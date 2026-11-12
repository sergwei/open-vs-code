import * as l10n from '@vscode/l10n';
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import {
  MAX_HOME_TEXT,
  type HomeActivity,
  type HomeRunning,
  type HomeState,
  type HomeWebviewToHost,
} from '../../../src/shared/homeProtocol';
import { plural } from '../../../src/shared/l10n';
import { ChevronIcon, WarningIcon } from '../chat/icons';
import type { HomeStore } from './homeStore';
import type { HomeUi } from './homeUiState';

/** Built from its code point: a literal one in the source trips `no-irregular-whitespace`. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** Sends one intention to the host (`postHome` in the bundle, a recorder in the tests). */
export type SendHome = (message: HomeWebviewToHost) => void;

/** The elapsed time as `m:ss`, or `h:mm:ss` from the first hour; never negative. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * The elapsed time of a running row in words, for its accessible name (decision S2 of the review,
 * by Sergio): minutes are the finest unit, so the text changes once a minute and the visible clock
 * stays `aria-hidden`. Under a minute it says "less than a minute"; from an hour, hours and minutes.
 * VERIFIED by `HomeApp.test.tsx` "names the elapsed time in the accessible name of a running row"
 * (jsdom, 08/11/2026); how a real screen reader reads it is not observed.
 */
export function elapsedName(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return l10n.t('running for less than a minute');
  if (minutes < 60) {
    return plural(
      minutes,
      l10n.t('running for {0} minute', minutes),
      l10n.t('running for {0} minutes', minutes),
    );
  }
  return l10n.t('running for {0} h {1} min', Math.floor(minutes / 60), minutes % 60);
}

/** What an activity says, in the interface language. */
function activityText(activity: HomeActivity): string {
  if (activity.kind === 'thinking') return l10n.t('Thinking');
  if (activity.kind === 'writing') return l10n.t('Writing');
  return activity.name;
}

/** The line under a running title: the root's activity and what its newest subagent does. */
function runningText(row: HomeRunning): string {
  const parts: string[] = [];
  if (row.activity !== undefined) parts.push(activityText(row.activity));
  if (row.child !== undefined) {
    const agent = row.child.agent ?? '';
    const doing = row.child.activity === undefined ? '' : activityText(row.child.activity);
    parts.push(
      agent === '' && doing === ''
        ? l10n.t('Subagent')
        : l10n.t('Subagent {0}: {1}', agent, doing).replace(/[\s:]+$/, ''),
    );
  }
  if (row.subagents > 1) {
    parts.push(
      plural(
        row.subagents,
        l10n.t('{0} subagent running', row.subagents),
        l10n.t('{0} subagents running', row.subagents),
      ),
    );
  }
  return parts.join(' · ');
}

/** The word of the server pill, which is only drawn while the server is not `connected`. */
function serverText(server: HomeState['server']): string {
  switch (server.state) {
    case 'starting':
      return l10n.t('Starting the server');
    case 'reconnecting':
      return l10n.t('Reconnecting');
    case 'not-started':
      return l10n.t('Server not started');
    default:
      return l10n.t('Server unavailable');
  }
}

/** Why the box cannot be used, or `undefined` when it can. */
function blockedText(state: HomeState): string | undefined {
  if (state.canStart) return undefined;
  return state.server.reason === 'no-workspace'
    ? l10n.t('Open a folder to start a conversation')
    : l10n.t('The OpenCode server is not available');
}

/**
 * The Quick start view (issue #187, E9-sidebar-home): a box to start a conversation, a status strip
 * and the lists "Running" and "Waiting for you". It only sends intentions; the host revalidates each.
 *
 * The box is a `textarea`: Enter sends (a NEW tab with the model, agent and mode of that tab),
 * Shift+Enter breaks the line, blank text does nothing, and a composition in progress (IME) is never
 * sent. The draft lives in the webview state, so hiding the view keeps it; it is cleared only when
 * the host says the conversation started. While it starts, or when the server is unusable, the box is
 * `aria-disabled` (never `disabled`: the focus must not drop to the body) and ignores Enter.
 * The status strip is four kinds of button: server (drawn ONLY while the server is not `connected`,
 * so a healthy server says nothing; Show logs, or Restart when it is down), model (a button with a
 * chevron that sends `home.model`: the host opens a native QuickPick of its catalog and the pick is
 * the model of the NEXT conversations from the box; `data-chosen` and the accessible name say
 * whether it is the user's choice or the default; it never opens Settings), mode (toggles
 * Manual/Auto for the NEXT conversation; the host holds it) and one per MCP server in error (tone
 * in the border and the icon, text in the foreground
 * colour: `--vscode-errorForeground` fails contrast on the sidebar). Stop is `aria-disabled` while
 * the host works on it. The clock of a running row is computed here from `since` once a second and is
 * `aria-hidden`, so a screen reader hears neither ticks nor stale times; the elapsed time reaches
 * a reader through the accessible name of the open button ({@link elapsedName}, by the minute;
 * HYPOTHESIS that it is read only on focus and never announced: what a screen reader does with a
 * label that changes on the focused element was not observed); a separate `aria-live`
 * region announces rows that appear or go, never ticks. The focus never moves by itself, except that
 * after a successful Stop pressed with the keyboard it goes to the box before the row disappears.
 * Colours and sizes are in `index.css` (`.home-*`, `--vscode-*` only, no inline style).
 * The rows come from `store.lists`, whose identities are stable per key (running by sessionID,
 * waiting by `kind:id`, MCP by name), so a state posted on every tool start of a running session
 * keeps the same buttons and the keyboard focus on them.
 * VERIFIED by `HomeApp.test.tsx` (jsdom, fabricated state: Enter, Shift+Enter, blank, draft, Stop
 * with `aria-disabled` and focus, the same Stop button and focus across a new state of the same
 * session, focus to the box after a successful keyboard Stop, focus left alone after a Stop pressed
 * with the focus elsewhere, clock with fake timers, live region,
 * no `style` attribute, the server pill in each state but `connected`, and the model pill's
 * `home.model`, `data-chosen`, accessible names and chevron).
 * VERIFIED in a real window by `--steps 29,34,49,50` (Windows 11, VS Code 1.145.2, 08/11/2026, run
 * after the `lists` and `elapsedName` changes): "all visual checks passed", step 50 among them,
 * e.g. "ok   M3 running row at 170 px (bar 170), light: the running row with its title, clock and
 * Stop is drawn whole inside the view, Stop is a whole button named "Stop …", contrast >= 4.5"
 * (M1 is the idle box and pills, M2 the MCP strip, M3 the running row, M4 the waiting row). Not
 * observed in a real window: a state posted while a row button has the keyboard focus (the jsdom
 * test covers it). UNVERIFIED until a check reads `document.activeElement`: where the focus goes
 * when the native model picker closes (the pill stays mounted across states, which jsdom covers, but
 * the hand-back of the focus by VS Code to the webview was not observed).
 */
export function HomeApp(props: { store: HomeStore; send: SendHome; ui: HomeUi }) {
  const [now, setNow] = createSignal(Date.now());
  const [starting, setStarting] = createSignal<string | undefined>();
  const [stopping, setStopping] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [notice, setNotice] = createSignal('');
  const [announcement, setAnnouncement] = createSignal('');
  let flip = false;
  let sequence = 0;
  let box: HTMLTextAreaElement | undefined;
  const stopButtons = new Map<string, HTMLButtonElement>();

  const timer = setInterval(() => {
    setNow(Date.now());
  }, 1000);
  onCleanup(() => {
    clearInterval(timer);
  });

  const nextId = (): string => {
    sequence += 1;
    return `home-${Date.now().toString(36)}-${sequence}`;
  };

  const unsubscribe = props.store.onResult((result) => {
    if (result.requestId === starting()) {
      setStarting(undefined);
      if (result.ok) {
        props.ui.setDraft('');
        setNotice('');
        if (box !== undefined) box.value = '';
      } else {
        setNotice(result.error ?? l10n.t('The conversation could not be started'));
      }
      return;
    }
    const entry = [...stopping()].find(([, id]) => id === result.requestId);
    if (entry === undefined) return;
    const [sessionID] = entry;
    const next = new Map(stopping());
    next.delete(sessionID);
    setStopping(next);
    if (result.ok) {
      const button = stopButtons.get(sessionID);
      if (button !== undefined && document.activeElement === button && document.hasFocus()) {
        box?.focus();
      }
    } else {
      setNotice(result.error ?? l10n.t('That session is not running anymore'));
    }
  });
  onCleanup(unsubscribe);

  const blocked = () => {
    const state = props.store.state();
    return state === undefined || !state.canStart || starting() !== undefined;
  };

  const submit = (): void => {
    const text = props.ui.draft();
    if (text.trim() === '' || blocked()) return;
    if (text.length > MAX_HOME_TEXT) {
      setNotice(l10n.t('That text is too long to send from here'));
      return;
    }
    const requestId = nextId();
    setNotice('');
    setStarting(requestId);
    props.send({ type: 'home.start', requestId, text });
  };

  const stop = (sessionID: string): void => {
    if (stopping().has(sessionID)) return;
    const requestId = nextId();
    setStopping(new Map(stopping()).set(sessionID, requestId));
    props.send({ type: 'home.stop', requestId, sessionID });
  };

  const titleOf = (title: string): string => (title === '' ? l10n.t('Untitled session') : title);

  // Announce rows that appear or go, never the clock: compare the ids of two states.
  let known: { running: Map<string, string>; waiting: Map<string, string> } | undefined;
  createEffect(
    on(props.store.state, (state) => {
      if (state === undefined) return;
      const running = new Map(state.running.map((row) => [row.sessionID, titleOf(row.title)]));
      const waiting = new Map(
        state.waiting.map((row) => [`${row.kind}:${row.id}`, titleOf(row.title)]),
      );
      const said: string[] = [];
      if (known !== undefined) {
        for (const [id, title] of running) {
          if (!known.running.has(id)) said.push(l10n.t('{0} is running', title));
        }
        for (const [id, title] of known.running) {
          if (!running.has(id)) said.push(l10n.t('{0} finished', title));
        }
        for (const [id, title] of waiting) {
          if (!known.waiting.has(id)) said.push(l10n.t('{0} is waiting for you', title));
        }
      }
      known = { running, waiting };
      if (said.length > 0) {
        flip = !flip;
        setAnnouncement(said.join('. ') + (flip ? NO_BREAK_SPACE : ''));
      }
    }),
  );

  return (
    <section class="home-root" aria-label={l10n.t('Quick start')}>
      <div class="home-box-wrap">
        <textarea
          class="home-box"
          ref={(element) => {
            box = element;
            // The draft is set once: re-assigning `value` on every keystroke would move the caret.
            element.value = props.ui.draft();
          }}
          rows="3"
          aria-label={l10n.t('Message to start a conversation')}
          placeholder={l10n.t('What do you want to do?')}
          aria-disabled={blocked() ? 'true' : 'false'}
          onInput={(event) => {
            props.ui.setDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
            event.preventDefault();
            submit();
          }}
        />
        <Show when={props.store.state()}>
          {(state) => (
            <Show when={blockedText(state())}>
              {(reason) => <p class="home-hint">{reason()}</p>}
            </Show>
          )}
        </Show>
        <Show when={notice() !== ''}>
          <p class="home-notice" role="alert">
            {notice()}
          </p>
        </Show>
      </div>

      <Show when={props.store.state()}>
        {(state) => (
          <>
            <ul class="home-pills" role="list" aria-label={l10n.t('Status')}>
              <Show when={state().server.state !== 'connected'}>
                <li>
                  <button
                    type="button"
                    class="home-pill"
                    data-kind="server"
                    data-state={state().server.state}
                    onClick={() => {
                      const down =
                        state().server.state === 'unavailable' ||
                        state().server.state === 'not-started';
                      props.send({ type: 'home.action', action: down ? 'restart' : 'logs' });
                    }}
                  >
                    {serverText(state().server)}
                  </button>
                </li>
              </Show>
              <Show when={state().model}>
                {(model) => (
                  <li>
                    <button
                      type="button"
                      class="home-pill"
                      data-kind="model"
                      data-chosen={state().modelChosen ? 'true' : 'false'}
                      aria-label={
                        state().modelChosen
                          ? l10n.t('Next conversation uses {0}. Choose another model', model())
                          : l10n.t(
                              'New conversations use {0}. Choose a model for the next one',
                              model(),
                            )
                      }
                      onClick={() => {
                        props.send({ type: 'home.model' });
                      }}
                    >
                      <span>{model()}</span>
                      <ChevronIcon />
                    </button>
                  </li>
                )}
              </Show>
              <li>
                <button
                  type="button"
                  class="home-pill"
                  data-kind="mode"
                  data-mode={state().mode}
                  aria-label={
                    state().mode === 'auto'
                      ? l10n.t('Next conversation: Auto. Switch to Manual')
                      : l10n.t('Next conversation: Manual. Switch to Auto')
                  }
                  onClick={() => {
                    props.send({
                      type: 'home.mode',
                      mode: state().mode === 'auto' ? 'manual' : 'auto',
                    });
                  }}
                >
                  {state().mode === 'auto' ? l10n.t('Auto') : l10n.t('Manual')}
                </button>
              </li>
              <For each={props.store.lists.mcp}>
                {(server) => (
                  <li>
                    <button
                      type="button"
                      class="home-pill"
                      data-kind="mcp"
                      data-status={server.status}
                      aria-label={
                        server.status === 'failed'
                          ? l10n.t('MCP server {0} failed. Open settings', server.name)
                          : l10n.t('MCP server {0} needs sign-in. Open settings', server.name)
                      }
                      onClick={() => {
                        props.send({ type: 'home.action', action: 'settings' });
                      }}
                    >
                      <WarningIcon />
                      <span>{server.name}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>

            <Show when={state().waiting.length > 0}>
              <h2 class="home-heading">{l10n.t('Waiting for you')}</h2>
              <ul class="home-list" role="list">
                <For each={props.store.lists.waiting}>
                  {(row) => (
                    <li class="home-row" data-kind="waiting">
                      <span class="home-row-main">
                        <span class="home-row-title">{titleOf(row.title)}</span>
                        <span class="home-row-detail">
                          {row.kind === 'permission'
                            ? l10n.t('Needs your permission')
                            : l10n.t('Has a question')}
                        </span>
                      </span>
                      <button
                        type="button"
                        class="secondary home-action"
                        aria-label={l10n.t('Reply to {0}', titleOf(row.title))}
                        onClick={() => {
                          props.send({
                            type: 'home.reply',
                            kind: row.kind,
                            sessionID: row.sessionID,
                            id: row.id,
                          });
                        }}
                      >
                        {l10n.t('Reply')}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            <h2 class="home-heading">{l10n.t('Running')}</h2>
            <Show
              when={state().running.length > 0}
              fallback={<p class="home-empty">{l10n.t('Nothing running')}</p>}
            >
              <ul class="home-list" role="list">
                <For each={props.store.lists.running}>
                  {(row) => (
                    <li class="home-row" data-kind="running">
                      <button
                        type="button"
                        class="home-row-main home-row-open"
                        aria-label={[
                          titleOf(row.title),
                          runningText(row),
                          row.since === undefined ? '' : elapsedName(now() - row.since),
                        ]
                          .filter((part) => part !== '')
                          .join(', ')}
                        onClick={() => {
                          props.send({ type: 'home.open', sessionID: row.sessionID });
                        }}
                      >
                        <span class="home-row-title">{titleOf(row.title)}</span>
                        <span class="home-row-detail">{runningText(row)}</span>
                      </button>
                      <Show when={row.since}>
                        {(since) => (
                          <span class="home-clock" aria-hidden="true">
                            {formatElapsed(now() - since())}
                          </span>
                        )}
                      </Show>
                      <button
                        type="button"
                        class="secondary home-action"
                        ref={(element) => {
                          stopButtons.set(row.sessionID, element);
                          onCleanup(() => {
                            stopButtons.delete(row.sessionID);
                          });
                        }}
                        aria-label={l10n.t('Stop {0}', titleOf(row.title))}
                        aria-disabled={stopping().has(row.sessionID) ? 'true' : 'false'}
                        onClick={() => {
                          stop(row.sessionID);
                        }}
                      >
                        {l10n.t('Stop')}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        )}
      </Show>
      <div class="visually-hidden" role="status" aria-live="polite">
        {announcement()}
      </div>
    </section>
  );
}
