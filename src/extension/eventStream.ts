// Reconnecting loop over the opencode SSE stream (`GET /api/event`), issue #14. Pure: the
// transport is injected (`subscribe`), so Vitest drives it with fakes and fake timers.
//
// Why a loop here: the Promise client does NOT reconnect (it shares one connection and rejects
// the iterator when it fails; read in `shared-events-frbwqjmf.js`), and the stream is volatile
// with no replay, so every reconnection must be followed by a REST snapshot, which is the
// caller's job (`server.connected` arrives as the first event of each connection).

/** Backoff between attempts, in ms: 1, 2, 4, 8, then 15 s. Our own choice (upstream retries at a fixed 1 s). */
export const DEFAULT_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000];

/**
 * How long to wait for `server.connected` after subscribing. 5 s is ours (upstream waits 2 s,
 * `client/src/solid/connection.ts`); HYPOTHESIS that 5 s is safer on a loaded machine.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

/**
 * Silence that marks the stream dead. 45 s is the figure upstream uses with a 15 s heartbeat
 * (`connection.ts:32-35` at v2.0.32, read not run); heartbeat frames count as activity.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 45_000;

/** Connection phase reported through `onState`. */
export type StreamState =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting'; attempt: number; error: unknown };

/** Inputs of {@link runEventStream}. `E` is the event type the transport yields. */
export interface EventStreamOptions<E extends { type: string }> {
  /**
   * Opens ONE connection. `signal` ends it; `onActivity` must be called for every frame,
   * heartbeats included. Production: `client.event.subscribe({ signal, onActivity })`.
   */
  subscribe(signal: AbortSignal, onActivity: () => void): AsyncIterable<E>;
  /** Receives every event with a string `type`; anything else is dropped (and reported to `onDiagnostic`). */
  onEvent(event: E): void;
  onState(state: StreamState): void;
  onDiagnostic?(message: string): void;
  /** Stops the loop for good: the current connection is aborted and nothing is retried. */
  signal: AbortSignal;
  backoffMs?: readonly number[];
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
}

/** Why one connection ended; only used to build the error handed to `onState`. */
class StreamAbortError extends Error {
  constructor(reason: 'connect-timeout' | 'idle-timeout') {
    super(
      reason === 'connect-timeout'
        ? 'no server.connected received in time'
        : 'the event stream went silent',
    );
    this.name = 'StreamAbortError';
  }
}

/** True for an object whose `type` is a string: the minimal check before trusting an event. */
function hasStringType(value: unknown): value is { type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/** Sleeps `ms`, resolving early (without error) if `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Runs one connection until it ends, fails, times out or `signal` aborts. Returns the error that
 * ended it (a clean end returns a generic one: the server closing the stream is a failure for us).
 * Resets `onConnected` when `server.connected` arrives, which the loop uses to restart the backoff.
 */
async function runOnce<E extends { type: string }>(
  options: EventStreamOptions<E>,
  onConnected: () => void,
): Promise<unknown> {
  const connectTimeout = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const idleTimeout = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const attempt = new AbortController();
  const stopOnOuterAbort = (): void => attempt.abort();
  options.signal.addEventListener('abort', stopOnOuterAbort, { once: true });

  let failure: unknown;
  let connected = false;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const fail = (error: unknown): void => {
    failure ??= error;
    attempt.abort();
  };
  const armIdle = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      fail(new StreamAbortError('idle-timeout'));
    }, idleTimeout);
  };
  connectTimer = setTimeout(() => {
    fail(new StreamAbortError('connect-timeout'));
  }, connectTimeout);
  armIdle();

  // The iterator is driven by hand and each `next()` is raced against the attempt's abort, so a
  // transport whose iterator ignores the signal cannot hang the loop (HYPOTHESIS: the real client
  // ends it on abort, read in `shared-events-frbwqjmf.js`; this makes that irrelevant).
  const aborted = new Promise<'aborted'>((resolve) => {
    if (attempt.signal.aborted) resolve('aborted');
    else attempt.signal.addEventListener('abort', () => resolve('aborted'), { once: true });
  });
  let iterator: AsyncIterator<E> | undefined;
  try {
    iterator = options.subscribe(attempt.signal, armIdle)[Symbol.asyncIterator]();
    for (;;) {
      const next = iterator.next();
      next.catch(() => undefined); // if the race below is lost, this rejection must not go unhandled
      const step = await Promise.race([next, aborted]);
      if (step === 'aborted' || step.done === true) break;
      const event = step.value;
      armIdle();
      if (!hasStringType(event)) {
        options.onDiagnostic?.('dropped a stream item without a string type');
        continue;
      }
      if (event.type === 'server.connected' && !connected) {
        connected = true;
        clearTimeout(connectTimer);
        connectTimer = undefined;
        onConnected();
      }
      options.onEvent(event);
    }
  } catch (error) {
    fail(error);
  } finally {
    clearTimeout(connectTimer);
    clearTimeout(idleTimer);
    iterator?.return?.()?.catch(() => undefined);
    options.signal.removeEventListener('abort', stopOnOuterAbort);
    attempt.abort();
  }
  return failure ?? new Error('the event stream ended');
}

/**
 * Keeps an SSE connection alive until `options.signal` aborts, reconnecting with backoff.
 *
 * Contract: `onState` reports `connecting` once, `connected` at each `server.connected`, and
 * `reconnecting { attempt, error }` before each wait (attempt counts from 1 and restarts after a
 * successful `server.connected`, which also restarts the backoff). Events are delivered as they
 * arrive, including `server.connected` and `location.shutdown`; deciding to take a snapshot on
 * those two is the caller's job. A connection that gets no `server.connected` within
 * `connectTimeoutMs`, or no frame at all within `idleTimeoutMs`, is aborted and retried. The
 * returned Promise resolves when the outer `signal` aborts; it never rejects.
 * VERIFIED by unit tests with a fake transport and fake timers (the timing rules), and against a
 * synthetic SSE server in `chatController.e2e.test.ts`. UNVERIFIED against a real opencode: that
 * a `subscribe` aborted mid-stream ends its iterator was only READ (the shared connection
 * finishes the subscriber on abort), and the first real drop of a stream was never observed.
 */
export async function runEventStream<E extends { type: string }>(
  options: EventStreamOptions<E>,
): Promise<void> {
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  let attempt = 0;
  options.onState({ kind: 'connecting' });
  while (!options.signal.aborted) {
    const error = await runOnce(options, () => {
      attempt = 0;
      options.onState({ kind: 'connected' });
    });
    if (options.signal.aborted) return;
    const wait = backoff[Math.min(attempt, backoff.length - 1)] ?? 1_000;
    attempt++;
    options.onState({ kind: 'reconnecting', attempt, error });
    await sleep(wait, options.signal);
  }
}
