// Records the SSE events of ONE turn against an opencode-compatible server (the real one or
// `fake-opencode.mjs`), for the event-shape check (`eventShapes.contract.ts`, and the fake-vs-fake
// case of `eventShapes.test.ts`). Node only: it uses the host's own client
// (`createOpencodeClient`),
// so what is recorded is what the extension would receive.

import type { V2Event } from '@opencode/client';
import type { ModelRef } from '../../shared/model';
import { createOpencodeClient, type ChatApi } from '../opencodeClient';
import type { RunningServer } from '../opencodeServer';

/** Why {@link recordTurn} stopped waiting. */
export type TurnOutcome = 'succeeded' | 'failed' | 'interrupted' | 'timeout';

/** What one recorded turn gave. */
export interface TurnRecording {
  /** Every event of the stream from before the session was created until the turn ended. */
  events: V2Event[];
  outcome: TurnOutcome;
  /** `session.execution.failed` error (code and message), when the turn failed. */
  error?: { type: string; message: string };
  /** True when a `permission.asked` arrived and was answered `once`. */
  permissionAnswered: boolean;
}

/** Inputs of {@link recordTurn}. */
export interface RecordTurnOptions {
  client: ChatApi;
  prompt: string;
  /** Chosen with `session.create`; the server's default when absent. */
  model?: ModelRef;
  /** Cut-off for the whole turn, in ms. */
  timeoutMs: number;
  /** Answer a question form with its first option instead of leaving the turn waiting for it. */
  answerForms?: boolean;
  /**
   * After `session.execution.succeeded`, keep recording up to this many ms until a
   * `session.renamed` arrives (the automatic title of the first turn). Absent = do not wait.
   */
  titleWaitMs?: number;
}

/**
 * The host's own client for a server this process started in `folder`. `version` is only a
 * label here (nothing in the client reads it).
 */
export function clientFor(server: RunningServer, folder: string): ChatApi {
  return createOpencodeClient({
    url: server.url,
    password: server.password,
    version: '2.0.32',
    folder,
    binaryPath: undefined,
    pid: server.child.pid,
    source: 'spawned',
  });
}

/** Narrow check of the `type` of an event the SDK types as a union we do not need to enumerate. */
function typeOf(event: V2Event): string {
  return (event as { type: string }).type;
}

/**
 * Subscribes to the event stream, creates a session, sends `prompt`, answers any permission
 * request with `once` (never `always`: nothing is saved) and records everything until
 * `session.execution.succeeded | failed | interrupted`, or `timeoutMs` (then the session is
 * interrupted and the outcome is `timeout`).
 *
 * The stream is opened and its first frame (`server.connected`) awaited BEFORE the session
 * exists, so no event of the turn is missed; the iteration stops by aborting its signal, which a
 * `finally` does even when `session.create` or the prompt throw (and the 15 s timer of the first
 * frame is cleared). The session is left in place for the caller to remove. Throws what the client
 * throws (a rejected `session.create`, say), or `no server.connected frame in 15 s`.
 * With `titleWaitMs` it waits for `session.renamed` after a success; the caller looks in
 * `events` for it and decides (the event-shape check fails when it never comes). Used with the
 * synthetic server in `npm test` (the pipeline) and with a real one by the opt-in contract; neither
 * run proves anything about a server that is not the one it recorded.
 */
export async function recordTurn(
  options: RecordTurnOptions,
): Promise<{ recording: TurnRecording; sessionID: string }> {
  const { client, prompt, model, timeoutMs } = options;
  const events: V2Event[] = [];
  const abort = new AbortController();
  let connected: () => void = () => undefined;
  const hasConnected = new Promise<void>((resolve) => {
    connected = resolve;
  });
  let ended: (outcome: TurnOutcome) => void = () => undefined;
  const finished = new Promise<TurnOutcome>((resolve) => {
    ended = resolve;
  });
  // Filled once the session exists; the stream loop below starts earlier and reads it.
  const turn: { sessionID?: string } = {};
  let error: TurnRecording['error'];
  let permissionAnswered = false;

  const pump = (async () => {
    try {
      for await (const event of client.event.subscribe({ signal: abort.signal })) {
        events.push(event);
        const type = typeOf(event);
        const data = (event as { data?: Record<string, unknown> }).data ?? {};
        if (type === 'server.connected') connected();
        // `form.created` carries the session inside `form`, the others at the top of `data`.
        const owner =
          data['sessionID'] ?? (data['form'] as { sessionID?: string } | undefined)?.sessionID;
        const sessionID = turn.sessionID;
        if (sessionID === undefined || owner !== sessionID) continue;
        if (type === 'permission.asked') {
          permissionAnswered = true;
          await client.permission.reply({
            sessionID,
            requestID: String(data['id']),
            decision: 'once',
          });
        } else if (type === 'form.created' && options.answerForms === true) {
          // `data.form.fields[0]` is the first question (`q0`); its first option, or a word.
          const form = data['form'] as
            | { id: string; fields?: Array<{ key: string; options?: Array<{ value: string }> }> }
            | undefined;
          const field = form?.fields?.[0];
          if (form !== undefined && field !== undefined) {
            await client.session.form.reply({
              sessionID,
              formID: form.id,
              answer: { [field.key]: field.options?.[0]?.value ?? 'ok' },
            });
          }
        } else if (type === 'session.execution.succeeded') {
          ended('succeeded');
        } else if (type === 'session.execution.failed') {
          const failure = data['error'] as { type?: string; message?: string } | undefined;
          error = { type: failure?.type ?? 'unknown', message: failure?.message ?? '' };
          ended('failed');
        } else if (type === 'session.execution.interrupted') {
          ended('interrupted');
        }
      }
    } catch {
      // The abort at the end ends the iteration with an error on some clients; nothing to report.
    }
  })();

  try {
    let connectTimer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        hasConnected,
        new Promise<void>((_, reject) => {
          connectTimer = setTimeout(
            () => reject(new Error('no server.connected frame in 15 s')),
            15_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(connectTimer);
    }
    const created = await client.session.create(model === undefined ? {} : { model });
    const sessionID = created.id;
    turn.sessionID = sessionID;
    await client.session.prompt({ sessionID, text: prompt });

    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      finished,
      new Promise<TurnOutcome>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      await client.session.interrupt({ sessionID }).catch(() => undefined);
    }
    // After a success, wait for the automatic title (`session.renamed`): a second model call
    // that races with `session.execution.succeeded`, so the caller can tell "arrived late" from
    // "never came".
    if (outcome === 'succeeded' && options.titleWaitMs !== undefined) {
      const deadline = Date.now() + options.titleWaitMs;
      while (
        !events.some((event) => typeOf(event) === 'session.renamed') &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    // A short grace so the events that follow the terminal one (`session.usage.updated`, ...) land.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      recording: {
        events,
        outcome,
        ...(error === undefined ? {} : { error }),
        permissionAnswered,
      },
      sessionID,
    };
  } finally {
    // Also when `session.create` or `prompt` throw: otherwise the SSE subscription stays open
    // until the caller stops the server.
    abort.abort();
    await pump;
  }
}
