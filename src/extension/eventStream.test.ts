// Protects against the reconnection rules of the SSE loop breaking: the client does not reconnect
// by itself and the stream has no replay, so a loop that gives up, retries too fast, never resets
// its backoff, or trusts a silent connection leaves the chat frozen without any visible error.
//
// Provenance of the data: a FAKE transport driven by `vi.useFakeTimers`. The timings under test
// (1, 2, 4, 8, 15 s backoff; 5 s to `server.connected`; 45 s of silence) are our own choices or
// upstream's figures read in the source, not behaviour observed from a real opencode. The e2e
// test `chatController.e2e.test.ts` exercises the loop against a synthetic HTTP server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEventStream, type StreamState } from './eventStream';

type Ev = { type: string };

/** Resolves when `signal` aborts; used by fake connections that stay open. */
function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/** A connection that fails right away. */
// eslint-disable-next-line @typescript-eslint/require-await, require-yield
async function* failing(): AsyncGenerator<Ev> {
  throw new Error('connection refused');
}

/** A connection that says `server.connected` and then stays open until aborted. */
async function* connectedThenOpen(_signal: AbortSignal, _activity: () => void): AsyncGenerator<Ev> {
  yield { type: 'server.connected' };
  await untilAborted(_signal);
}

/** A connection that says `server.connected` and then ends cleanly (the server closed it). */
// eslint-disable-next-line @typescript-eslint/require-await
async function* connectedThenClosed(): AsyncGenerator<Ev> {
  yield { type: 'server.connected' };
}

/** A connection that never says anything until aborted. */
// eslint-disable-next-line require-yield -- it is silent on purpose
async function* silent(signal: AbortSignal): AsyncGenerator<Ev> {
  await untilAborted(signal);
}

type Plan = (signal: AbortSignal, onActivity: () => void) => AsyncIterable<Ev>;

/** Runs the loop over scripted connections; returns what it observed. */
function harness(plans: Plan[], overrides: { idleTimeoutMs?: number } = {}) {
  const outer = new AbortController();
  const states: StreamState[] = [];
  const events: string[] = [];
  const subscribedAt: number[] = [];
  const activities: Array<() => void> = [];
  const start = Date.now();
  let call = 0;
  const done = runEventStream<Ev>({
    subscribe: (signal, onActivity) => {
      subscribedAt.push(Date.now() - start);
      activities.push(onActivity);
      const plan = plans[Math.min(call, plans.length - 1)];
      call += 1;
      if (plan === undefined) throw new Error('no plan');
      return plan(signal, onActivity);
    },
    onEvent: (event) => events.push(event.type),
    onState: (state) => states.push(state),
    signal: outer.signal,
    ...overrides,
  });
  return { outer, states, events, subscribedAt, activities, done };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runEventStream', () => {
  it('reconnects after an error with 1 s, 2 s, 4 s ... backoff', async () => {
    const h = harness([failing, failing, failing, connectedThenOpen]);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 10);
    expect(h.subscribedAt).toEqual([0, 1_000, 3_000, 7_000]);
    h.outer.abort();
    await h.done;
  });

  it('caps the wait at 15 s', async () => {
    const h = harness([failing]);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 8_000 + 15_000 + 15_000 + 10);
    const gaps = h.subscribedAt.slice(1).map((at, i) => at - (h.subscribedAt[i] ?? 0));
    expect(gaps).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
    h.outer.abort();
    await h.done;
  });

  it('restarts the backoff after server.connected', async () => {
    // fail, fail (waits 1 s then 2 s), connect and close, then the wait must be 1 s again, not 4 s
    const h = harness([failing, failing, connectedThenClosed, connectedThenOpen]);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 1_000 + 10);
    expect(h.subscribedAt).toEqual([0, 1_000, 3_000, 4_000]);
    h.outer.abort();
    await h.done;
  });

  it('aborts and retries when server.connected does not arrive within 5 s', async () => {
    const h = harness([silent, connectedThenOpen]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(h.subscribedAt).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1 + 1_000 + 10);
    expect(h.subscribedAt).toEqual([0, 6_000]);
    h.outer.abort();
    await h.done;
  });

  it('aborts and retries after 45 s without any frame', async () => {
    const h = harness([connectedThenOpen, connectedThenOpen]);
    await vi.advanceTimersByTimeAsync(44_999);
    expect(h.subscribedAt).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1 + 1_000 + 10);
    expect(h.subscribedAt).toEqual([0, 46_000]);
    h.outer.abort();
    await h.done;
  });

  it('counts heartbeats (onActivity) as life', async () => {
    const h = harness([connectedThenOpen, connectedThenOpen]);
    await vi.advanceTimersByTimeAsync(30_000);
    h.activities[0]?.();
    await vi.advanceTimersByTimeAsync(30_000);
    h.activities[0]?.();
    await vi.advanceTimersByTimeAsync(44_000); // 74 s: 44 s after the last heartbeat
    expect(h.subscribedAt).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1_000 + 1_000 + 10); // 45 s of silence, then the 1 s wait
    expect(h.subscribedAt).toHaveLength(2);
    h.outer.abort();
    await h.done;
  });

  it('ends without retrying when the outer signal aborts, even mid-connection', async () => {
    const h = harness([connectedThenOpen]);
    await vi.advanceTimersByTimeAsync(10);
    h.outer.abort();
    await h.done;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.subscribedAt).toEqual([0]);
  });

  it('ends without retrying when aborted during the backoff wait', async () => {
    const h = harness([failing]);
    await vi.advanceTimersByTimeAsync(500);
    h.outer.abort();
    await h.done;
    expect(h.subscribedAt).toEqual([0]);
  });

  it('reports connecting, connected and reconnecting in order and delivers events', async () => {
    const h = harness([connectedThenClosed, connectedThenOpen]);
    await vi.advanceTimersByTimeAsync(1_000 + 10);
    expect(h.states.map((s) => s.kind)).toEqual([
      'connecting',
      'connected',
      'reconnecting',
      'connected',
    ]);
    expect(h.states[2]).toMatchObject({ kind: 'reconnecting', attempt: 1 });
    expect(h.events).toEqual(['server.connected', 'server.connected']);
    h.outer.abort();
    await h.done;
  });

  it('survives an iterator that ignores the abort signal', async () => {
    // A transport that never ends and never honors the signal: the loop must still move on.
    const stubborn: Plan = () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<Ev>>(() => undefined),
      }),
    });
    const h = harness([stubborn, connectedThenOpen]);
    await vi.advanceTimersByTimeAsync(5_000 + 1_000 + 10);
    expect(h.subscribedAt).toEqual([0, 6_000]);
    h.outer.abort();
    await h.done;
  });

  it('drops an item without a string type and reports it', async () => {
    const diagnostics: string[] = [];
    const outer = new AbortController();
    async function* odd(signal: AbortSignal): AsyncGenerator<Ev> {
      yield { type: 'server.connected' };
      yield 42 as unknown as Ev;
      await untilAborted(signal);
    }
    const events: string[] = [];
    const done = runEventStream<Ev>({
      subscribe: (signal) => odd(signal),
      onEvent: (event) => events.push(event.type),
      onState: () => undefined,
      onDiagnostic: (message) => diagnostics.push(message),
      signal: outer.signal,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(events).toEqual(['server.connected']);
    expect(diagnostics).toHaveLength(1);
    outer.abort();
    await done;
  });
});
