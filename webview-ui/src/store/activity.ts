/**
 * What the assistant is doing, derived from state the store already has (issue #16). PURE: no
 * DOM and no Solid, so it is tested with plain objects. No extra events from the host.
 */
import * as l10n from '@vscode/l10n';
import type { ErrorInfo, Part, SessionStatus } from '../../../src/shared/model';
import type { ConnectionState } from '../../../src/shared/protocol';

/** The line shown above the input. `error` is set only for `kind: 'error'`. */
export interface Activity {
  kind:
    | 'offline'
    | 'idle'
    | 'thinking'
    | 'tool'
    | 'writing'
    | 'working'
    | 'retrying'
    | 'compacting'
    | 'error';
  label: string;
  error?: ErrorInfo;
}

/**
 * True when the error of an ASSISTANT MESSAGE is opencode's way of saying that a step was cut
 * short, which the UI shows as a neutral "Stopped" instead of a red error. It applies ONLY to
 * message errors (`MessageInfo.error`), never to the session status (decision of Sergio,
 * 20/10/2026, Engram `E2-mvp-prototype/decisions-visual`).
 *
 * VERIFIED against a real opencode 2.0.32 (spike of 20/10/2026, Windows 11, free model): after
 * Stop, and after a Reject with no feedback, the assistant message ends with
 * `session.step.failed { error: { type: 'aborted', message: 'Step interrupted' } }`, which the
 * translator maps to `ErrorInfo { code: 'aborted' }` on the message; the session itself goes
 * idle (`session.execution.interrupted`, reason `user` after Stop) and never reaches an error
 * status. The same code is also published when the location closes in the middle of a turn
 * (Restart Server, closing VS Code: `step.ts@v2.0.32`, read, not run), which is not a user
 * action either; "Stopped" is acceptable there because the turn really was cut short.
 * The session-status case is deliberately NOT neutral: `session.execution.failed` with
 * `{ type: 'aborted' }` is also what the server publishes when an execution was interrupted
 * repeatedly and will not be resumed (`restart.ts@v2.0.32`, read, not run), a system failure
 * that must stay red with its text. Only the exact code `aborted` matches; other cancellation
 * codes are unknown and stay errors.
 */
export function isStopError(error: ErrorInfo | undefined): boolean {
  return error?.code === 'aborted';
}

/**
 * Picks the activity line.
 *
 * `offline` for a server that is not (about to be) there: starting, unavailable or stopped; a
 * `reconnecting` stream still derives from the status, because the snapshot after reconnecting
 * corrects it. While `busy`, the last parts of the newest assistant message decide: a reasoning
 * block that is not completed is "Thinking", a tool that is `streaming` or `running` is
 * "Running <tool>" (the newest one wins), a last text part is "Writing", and anything else
 * (between steps, before the first part) is "Working". E11-i18n: every label goes through
 * `l10n.t`. VERIFIED by `activity.test.ts` for the English text of six labels: "shows the error
 * with its details" ("Error"), "shows the retry attempt" ("Retrying (attempt 3)"), "is working
 * before any part exists" ("Working"), "names the running tool, the newest one when several"
 * ("Running bash"), "is writing when the last part is text" ("Writing") and "is compacting, ahead
 * of the parts, while busy with the compaction line running" ("Compacting"). HYPOTHESIS: the
 * English "Thinking" label (that test checks only the `kind`; to check it, assert the label) and
 * the Spanish text of all of them (no Spanish case exists for this function). Parts are read from the end, since the
 * newest part is the one in progress. HYPOTHESIS: reasoning blocks keep `completed: false` until
 * their `reasoning.ended`, as the translator maps it; not observed in a long real turn.
 * `compacting` (issue #125) is true when the newest visible message is the running compaction line:
 * the session is busy while the summary is made, and without it the last answer's text would read
 * "Writing". It wins over the parts, never over `offline`, `error` or `retrying`.
 */
export function deriveActivity(
  connection: ConnectionState,
  status: SessionStatus | undefined,
  lastAssistantParts: readonly Part[],
  compacting = false,
): Activity {
  if (
    connection.state === 'starting' ||
    connection.state === 'not-started' ||
    connection.state === 'unavailable' ||
    connection.state === 'stopped'
  ) {
    return { kind: 'offline', label: '' };
  }
  if (status === undefined || status.type === 'idle') return { kind: 'idle', label: '' };
  if (status.type === 'error') {
    return { kind: 'error', label: l10n.t('Error'), error: status.error };
  }
  if (status.type === 'retry') {
    return { kind: 'retrying', label: l10n.t('Retrying (attempt {0})', status.attempt) };
  }
  if (compacting) return { kind: 'compacting', label: l10n.t('Compacting') };
  const last = lastAssistantParts.at(-1);
  if (last?.type === 'reasoning' && !last.completed) {
    return { kind: 'thinking', label: l10n.t('Thinking') };
  }
  for (let index = lastAssistantParts.length - 1; index >= 0; index--) {
    const part = lastAssistantParts[index];
    if (
      part?.type === 'tool' &&
      (part.state.status === 'streaming' || part.state.status === 'running')
    ) {
      return { kind: 'tool', label: l10n.t('Running {0}', part.name) };
    }
  }
  if (last?.type === 'text') return { kind: 'writing', label: l10n.t('Writing') };
  return { kind: 'working', label: l10n.t('Working') };
}
