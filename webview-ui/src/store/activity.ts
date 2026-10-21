/**
 * What the assistant is doing, derived from state the store already has (issue #16). PURE: no
 * DOM and no Solid, so it is tested with plain objects. No extra events from the host.
 */
import type { ErrorInfo, Part, SessionStatus } from '../../../src/shared/model';
import type { ConnectionState } from '../../../src/shared/protocol';

/** The line shown above the input. `error` is set only for `kind: 'error'`. */
export interface Activity {
  kind: 'offline' | 'idle' | 'thinking' | 'tool' | 'writing' | 'working' | 'retrying' | 'error';
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
 * (between steps, before the first part) is "Working". Parts are read from the end, since the
 * newest part is the one in progress. HYPOTHESIS: reasoning blocks keep `completed: false` until
 * their `reasoning.ended`, as the translator maps it; not observed in a long real turn.
 */
export function deriveActivity(
  connection: ConnectionState,
  status: SessionStatus | undefined,
  lastAssistantParts: readonly Part[],
): Activity {
  if (
    connection.state === 'starting' ||
    connection.state === 'unavailable' ||
    connection.state === 'stopped'
  ) {
    return { kind: 'offline', label: '' };
  }
  if (status === undefined || status.type === 'idle') return { kind: 'idle', label: '' };
  if (status.type === 'error') return { kind: 'error', label: 'Error', error: status.error };
  if (status.type === 'retry') {
    return { kind: 'retrying', label: `Retrying (attempt ${String(status.attempt)})` };
  }
  const last = lastAssistantParts.at(-1);
  if (last?.type === 'reasoning' && !last.completed) return { kind: 'thinking', label: 'Thinking' };
  for (let index = lastAssistantParts.length - 1; index >= 0; index--) {
    const part = lastAssistantParts[index];
    if (
      part?.type === 'tool' &&
      (part.state.status === 'streaming' || part.state.status === 'running')
    ) {
      return { kind: 'tool', label: `Running ${part.name}` };
    }
  }
  if (last?.type === 'text') return { kind: 'writing', label: 'Writing' };
  return { kind: 'working', label: 'Working' };
}
