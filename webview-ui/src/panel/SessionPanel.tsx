import * as l10n from '@vscode/l10n';
import { createEffect, createMemo, createSignal, createUniqueId, For, on, Show } from 'solid-js';
import {
  LOADED_MESSAGE_LIMIT,
  MAX_INSTRUCTION_LENGTH,
  type ExportFormat,
} from '../../../src/shared/protocol';
import { splitAtRevert } from '../changes/revertView';
import {
  contextUsage,
  describeUsage,
  formatCost,
  HIGH_CONTEXT_PERCENT,
  usageBreakdown,
} from '../chat/usage';
import { compactTokens } from '../selectors/selection';
import { childrenOf } from '../sessions/lineage';
import type { ChatStore } from '../store/chatStore';
import { useSubagents } from '../subagents/SubagentContext';
import { summaryLine } from '../subagents/subagentView';

/** Characters of an instruction kept in the accessible name of its remove button. */
const NAME_TEXT_LIMIT = 40;

/** One line of `text` for a button name: whitespace collapsed, cut at {@link NAME_TEXT_LIMIT}. */
function shortText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > NAME_TEXT_LIMIT ? `${flat.slice(0, NAME_TEXT_LIMIT)}…` : flat;
}

/** The ids of `a` and `b` are the same, in the same order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * The Session tab (issue #188, phase 4; decisions P1/P2 of Sergio, 12/11/2026): five sections about
 * the open session, in this order: Instructions, Context, Usage, Subagents and Export.
 * Presentational over the store: `App` owns what each action sends and mounts the panel only while
 * its tab is active.
 *
 * - Instructions: the text pinned to the session as the server lists it (`state.instructions`), a
 *   remove button per row whose accessible name carries the text ("Remove instruction <text>"), and
 *   a one-line box with "Add". The box is a single-line `<input>` on purpose: the other documents'
 *   queries (`textarea`) find the prompt box first. An instruction another client set as JSON
 *   (`json: true`) is shown and can be removed, never edited. Without an open session the box and
 *   "Add" are `aria-disabled` and a line says why (the server pins instructions to a session, and a
 *   new one only exists after its first message). The text is cleared as soon as it is handed over
 *   (a failed add gives it no way back: UNVERIFIED, a notice says why). When the row that had the
 *   focus is removed the focus goes to the row that takes its place, or to the box, only if the
 *   focus was lost and the document has it (solid-webview skill §7).
 * - Context: a native `<meter>` (implicit role `meter`, no `style`) with used / limit / percent in
 *   words and the same "Compact" action as the header line. Without the model's limit there is no
 *   meter, only the token count. `high` starts at {@link HIGH_CONTEXT_PERCENT} of the limit, like
 *   the header line, and `data-level` carries the same level for the CSS.
 * - Usage: the server's session totals ({@link usageBreakdown}); the turns are the user messages
 *   loaded, with a note when the loaded messages reached {@link LOADED_MESSAGE_LIMIT}.
 * - Subagents: every direct child of the open session, running or finished, with its state in words
 *   and an "Open" button (`monitor.open`). Nothing is drawn without the subagent monitor.
 * - Export: "Markdown" and "JSON" buttons and a line that says the JSON holds the whole text of the
 *   conversation and the paths (decision P1). They are `aria-disabled` without a session and while an
 *   export is in flight (`exporting`, which also sets `aria-busy` on the section).
 * Buttons that can be blocked use `aria-disabled`, never `disabled` (they keep the focus).
 * VERIFIED in jsdom by `SessionPanel.test.tsx` (each section, the disabled states, the focus rules,
 * the meter attributes). VERIFIED in a real VS Code (Windows 11, VS Code 1.146.0, 12/11/2026) by
 * `test:visual` step 55: "S2 with no session Add, the field and both exports are aria-disabled and
 * a line says why", "S3 the meter holds 172000 of 200000 (high at 160000)", "C6 in dark the fill of
 * the high meter stands out from its bar, contrast >= 3" (and in light, hc-dark and hc-light),
 * "W1 the session tab fits 300 px with no style attribute" and "W2 the session tab fits 900 px with
 * no style attribute". UNVERIFIED: the meter below 80 % and a subagent that is still running in
 * the list.
 */
export function SessionPanel(props: {
  store: ChatStore;
  /** An `instructions.add` or `instructions.remove` is in flight: "Add" is `aria-disabled`. */
  instructionsBusy: boolean;
  /** A `session.export` is in flight (the save dialog may be open). */
  exporting: boolean;
  /** The "Compact" button is `aria-disabled` while true (no host, or a request in flight). */
  compactDisabled: boolean;
  /** Pins `text`; returns true when it was sent (so the box can be emptied). */
  onAddInstruction(text: string): boolean;
  onRemoveInstruction(key: string): void;
  onCompact(): void;
  onExport(format: ExportFormat): void;
}) {
  const state = props.store.state;
  const monitor = useSubagents();
  const ids = {
    instructions: createUniqueId(),
    context: createUniqueId(),
    usage: createUniqueId(),
    subagents: createUniqueId(),
    exportSection: createUniqueId(),
  };
  const sessionID = () => state.open.sessionID;

  // --- Instructions -----------------------------------------------------------------------------
  const entries = () => {
    const id = sessionID();
    return id === undefined ? [] : (state.instructions[id] ?? []);
  };
  const entriesError = () => {
    const id = sessionID();
    return id === undefined ? undefined : state.instructionsError[id];
  };
  const [draft, setDraft] = createSignal('');
  let input: HTMLInputElement | undefined;
  let list: HTMLUListElement | undefined;
  /** The row removed by the user and where it stood, until the list stops listing it. */
  let removed: { key: string; index: number } | undefined;

  const canAdd = (): boolean =>
    sessionID() !== undefined && !props.instructionsBusy && draft().trim() !== '';
  const add = (): void => {
    if (!canAdd()) return;
    if (props.onAddInstruction(draft().trim())) setDraft('');
    input?.focus();
  };
  const remove = (key: string): void => {
    removed = { key, index: entries().findIndex((entry) => entry.key === key) };
    props.onRemoveInstruction(key);
  };

  createEffect(
    on(
      () =>
        entries()
          .map((entry) => entry.key)
          .join('\n'),
      () => {
        const gone = removed;
        if (gone === undefined || entries().some((entry) => entry.key === gone.key)) return;
        removed = undefined;
        const active = document.activeElement;
        if (!document.hasFocus() || (active !== null && active !== document.body)) return;
        // With no row left the list unmounts and its old nodes may still be reachable, so the answer
        // is the box without looking at the DOM.
        const rows = entries().length === 0 ? [] : [...(list?.querySelectorAll('li') ?? [])];
        const button = rows[Math.min(gone.index, rows.length - 1)]?.querySelector('button');
        if (button === undefined || button === null) input?.focus();
        else button.focus();
      },
      { defer: true },
    ),
  );

  // --- Context ----------------------------------------------------------------------------------
  const shown = createMemo(() => splitAtRevert(state.open.messages, state.open.revert).visible);
  const context = createMemo(() => contextUsage(shown(), state.open.compactedAt, state.catalog));
  const contextView = createMemo(() =>
    describeUsage(context(), undefined, state.catalog, undefined),
  );

  // --- Usage ------------------------------------------------------------------------------------
  const usage = createMemo(() => {
    const id = sessionID();
    if (id === undefined) return undefined;
    return usageBreakdown(state.sessions, id, shown(), state.catalog, context()?.model);
  });

  // --- Subagents --------------------------------------------------------------------------------
  const childIds = createMemo(
    () => {
      const id = sessionID();
      return id === undefined ? [] : childrenOf(state.sessions, id).map((row) => row.id);
    },
    [] as string[],
    { equals: sameIds },
  );

  return (
    <div class="session-panel">
      <section class="session-section" aria-labelledby={ids.instructions}>
        <h2 id={ids.instructions}>{l10n.t('Instructions')}</h2>
        <p class="session-note">{l10n.t('Pinned instructions apply to this session only.')}</p>
        <Show when={entriesError()}>
          {(failure) => (
            <p class="session-error">
              {l10n.t('Could not read the instructions: {0}', failure().message)}
            </p>
          )}
        </Show>
        <Show
          when={entries().length > 0}
          fallback={<p class="session-note">{l10n.t('No pinned instructions')}</p>}
        >
          <ul
            class="instruction-list"
            aria-label={l10n.t('Pinned instructions')}
            ref={(element) => {
              list = element;
            }}
          >
            <For each={entries()}>
              {(entry) => (
                <li class="instruction-row" data-json={entry.json ? 'true' : undefined}>
                  <span class="instruction-text">{entry.text}</span>
                  <Show when={entry.json}>
                    <span class="instruction-tag">{l10n.t('set by another client')}</span>
                  </Show>
                  <button
                    type="button"
                    class="chip-remove"
                    aria-label={l10n.t('Remove instruction {0}', shortText(entry.text))}
                    onClick={() => {
                      remove(entry.key);
                    }}
                  >
                    ×
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="instruction-add">
          <input
            type="text"
            class="instruction-input"
            aria-label={l10n.t('New instruction')}
            aria-disabled={sessionID() === undefined}
            maxLength={MAX_INSTRUCTION_LENGTH}
            placeholder={l10n.t('Add an instruction for this session…')}
            value={draft()}
            readOnly={sessionID() === undefined}
            ref={(element) => {
              input = element;
            }}
            onInput={(event) => {
              setDraft(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.isComposing) return;
              event.preventDefault();
              add();
            }}
          />
          <button
            type="button"
            class="secondary"
            aria-disabled={!canAdd()}
            onClick={() => {
              add();
            }}
          >
            {l10n.t('Add')}
          </button>
        </div>
        <Show when={sessionID() === undefined}>
          <p class="session-note">{l10n.t('Send a first message to pin instructions')}</p>
        </Show>
      </section>

      <section class="session-section" aria-labelledby={ids.context}>
        <h2 id={ids.context}>{l10n.t('Context')}</h2>
        <Show
          when={contextView()}
          fallback={<p class="session-note">{l10n.t('No context measured yet')}</p>}
        >
          {(view) => (
            <div class="context-box" data-level={view().level}>
              <Show when={context()?.limit}>
                {(limit) => (
                  <meter
                    class="context-meter"
                    min={0}
                    max={limit()}
                    value={context()?.tokens ?? 0}
                    high={(limit() * HIGH_CONTEXT_PERCENT) / 100}
                    aria-label={l10n.t('Context used')}
                  />
                )}
              </Show>
              <p class="context-text">{view().name}</p>
              <button
                type="button"
                class="secondary"
                aria-disabled={props.compactDisabled}
                onClick={() => {
                  if (!props.compactDisabled) props.onCompact();
                }}
              >
                {l10n.t('Compact')}
              </button>
            </div>
          )}
        </Show>
      </section>

      <section class="session-section" aria-labelledby={ids.usage}>
        <h2 id={ids.usage}>{l10n.t('Usage')}</h2>
        <Show
          when={usage()}
          fallback={<p class="session-note">{l10n.t('No usage recorded yet')}</p>}
        >
          {(figures) => (
            <>
              <dl class="usage-grid">
                <dt>{l10n.t('Input tokens')}</dt>
                <dd>{compactTokens(figures().inputTokens)}</dd>
                <dt>{l10n.t('Output tokens')}</dt>
                <dd>{compactTokens(figures().outputTokens)}</dd>
                <Show when={figures().cost}>
                  {(cost) => (
                    <>
                      <dt>
                        {cost().withSubagents ? l10n.t('Cost with subagents') : l10n.t('Cost')}
                      </dt>
                      <dd>{formatCost(cost().usd)}</dd>
                    </>
                  )}
                </Show>
                <dt>{l10n.t('Turns')}</dt>
                <dd>{figures().turns}</dd>
              </dl>
              <Show when={figures().partial}>
                <p class="session-note">
                  {l10n.t(
                    'Turns are counted over the {0} most recent messages',
                    LOADED_MESSAGE_LIMIT,
                  )}
                </p>
              </Show>
            </>
          )}
        </Show>
      </section>

      <section class="session-section" aria-labelledby={ids.subagents}>
        <h2 id={ids.subagents}>{l10n.t('Subagents')}</h2>
        <Show
          when={monitor !== undefined && childIds().length > 0}
          fallback={<p class="session-note">{l10n.t('No subagents in this session')}</p>}
        >
          <ul class="subagent-rows" role="list">
            <For each={childIds()}>{(id) => <ChildRow id={id} />}</For>
          </ul>
        </Show>
      </section>

      <section
        class="session-section"
        aria-labelledby={ids.exportSection}
        aria-busy={props.exporting ? 'true' : undefined}
      >
        <h2 id={ids.exportSection}>{l10n.t('Export')}</h2>
        <div class="export-buttons">
          <For each={['markdown', 'json'] as const}>
            {(format) => (
              <button
                type="button"
                class="secondary"
                aria-disabled={sessionID() === undefined || props.exporting}
                onClick={() => {
                  if (sessionID() !== undefined && !props.exporting) props.onExport(format);
                }}
              >
                {format === 'markdown' ? l10n.t('Markdown') : l10n.t('JSON')}
              </button>
            )}
          </For>
        </div>
        <p class="session-note">
          {l10n.t('The JSON file holds the full text of the conversation and the file paths.')}
        </p>
        <Show when={sessionID() === undefined}>
          <p class="session-note">{l10n.t('Send a first message to export the session')}</p>
        </Show>
      </section>
    </div>
  );
}

/**
 * One direct child session of the Session tab's Subagents section, keyed by id so its "Open" button
 * keeps the focus while data arrives. Agent, task and state in words (never colour alone); the
 * finished states reuse the one line of the tool cards ({@link summaryLine}, so "Finished · 3 tools"
 * reads the same everywhere). The accessible name of "Open" carries the task, like the bar's.
 */
function ChildRow(props: { id: string }) {
  const monitor = useSubagents();
  const row = () => monitor?.session(props.id);
  const activity = () => monitor?.activity(props.id);
  const task = (): string => row()?.title ?? '';
  const status = (): string => {
    const current = monitor?.stateOf(props.id) ?? 'done';
    if (current === 'waiting') return l10n.t('Waiting for your answer');
    if (current === 'working') return l10n.t('Working');
    return (
      summaryLine({
        state: current,
        toolCount: activity()?.toolCount ?? 0,
        ...(activity()?.partial === true ? { partial: true } : {}),
        ...(row()?.usage === undefined ? {} : { cost: row()?.usage?.cost ?? 0 }),
      }) ?? ''
    );
  };
  // Literal keys on purpose: `l10n:export` only finds `l10n.t('…')` with a string literal.
  const openName = (): string =>
    task() === '' ? l10n.t('Open subagent session') : l10n.t('Open subagent session {0}', task());
  return (
    <li class="subagent-row">
      <div class="subagent-row-info">
        <Show when={row()?.agent}>{(agent) => <span class="subagent-agent">{agent()}</span>}</Show>
        <span class="subagent-task">{task()}</span>
        <span class="subagent-state">{status()}</span>
      </div>
      <div class="subagent-actions">
        <button
          type="button"
          class="secondary"
          aria-label={openName()}
          onClick={() => {
            monitor?.open(props.id);
          }}
        >
          {l10n.t('Open')}
        </button>
      </div>
    </li>
  );
}
