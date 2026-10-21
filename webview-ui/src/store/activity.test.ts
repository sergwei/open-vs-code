// Protects the mapping from state to the activity line (Thinking / Running <tool> / Writing /
// Working / Retrying / Error), which is the only feedback the user has while a turn runs.
//
// Provenance: fabricated parts and statuses in the shape of `src/shared/model.ts`; whether the
// translator really leaves a reasoning block `completed: false` until it ends is a HYPOTHESIS of
// `deriveActivity` and is not tested here.
import { describe, expect, it } from 'vitest';
import type { Part, SessionStatus } from '../../../src/shared/model';
import type { ConnectionState } from '../../../src/shared/protocol';
import { deriveActivity } from './activity';

const CONNECTED: ConnectionState = { state: 'connected', serverVersion: '2.0.32' };
const BUSY: SessionStatus = { type: 'busy' };

const text: Part = { type: 'text', id: 'm#1', text: 'hi' };
const thinking: Part = { type: 'reasoning', id: 'm#0', text: '…', completed: false };
const thought: Part = { type: 'reasoning', id: 'm#0', text: '…', completed: true };
const tool = (status: 'streaming' | 'running' | 'completed'): Part => ({
  type: 'tool',
  id: 't1',
  name: 'bash',
  state:
    status === 'streaming'
      ? { status, input: '{' }
      : status === 'running'
        ? { status, input: {} }
        : { status, input: {}, output: [] },
});

describe('deriveActivity', () => {
  it('is offline while the server is not usable', () => {
    for (const connection of [
      { state: 'starting' },
      { state: 'stopped' },
      {
        state: 'unavailable',
        reason: 'binary-missing',
        error: { code: 'x', message: 'y' },
      },
    ] as ConnectionState[]) {
      expect(deriveActivity(connection, BUSY, []).kind).toBe('offline');
    }
  });

  it('is idle without a session status or when idle', () => {
    expect(deriveActivity(CONNECTED, undefined, []).kind).toBe('idle');
    expect(deriveActivity(CONNECTED, { type: 'idle' }, [text]).kind).toBe('idle');
  });

  it('still derives from the status while reconnecting', () => {
    expect(deriveActivity({ state: 'reconnecting', attempt: 1 }, BUSY, []).kind).toBe('working');
  });

  it('shows the error with its details', () => {
    const error = { code: 'provider.no-route', message: 'no model' };
    expect(deriveActivity(CONNECTED, { type: 'error', error }, [])).toEqual({
      kind: 'error',
      label: 'Error',
      error,
    });
  });

  it('shows the retry attempt', () => {
    expect(
      deriveActivity(CONNECTED, { type: 'retry', attempt: 3, message: 'm', nextAt: 1 }, []),
    ).toEqual({ kind: 'retrying', label: 'Retrying (attempt 3)' });
  });

  it('is working before any part exists', () => {
    expect(deriveActivity(CONNECTED, BUSY, [])).toEqual({ kind: 'working', label: 'Working' });
  });

  it('is thinking while the last reasoning block is not completed', () => {
    expect(deriveActivity(CONNECTED, BUSY, [thinking]).kind).toBe('thinking');
    expect(deriveActivity(CONNECTED, BUSY, [thought]).kind).toBe('working');
  });

  it('names the running tool, the newest one when several', () => {
    expect(deriveActivity(CONNECTED, BUSY, [text, tool('running')])).toEqual({
      kind: 'tool',
      label: 'Running bash',
    });
    expect(deriveActivity(CONNECTED, BUSY, [tool('streaming'), text]).kind).toBe('tool');
    expect(deriveActivity(CONNECTED, BUSY, [tool('completed')]).kind).toBe('working');
  });

  it('is writing when the last part is text', () => {
    expect(deriveActivity(CONNECTED, BUSY, [thought, text])).toEqual({
      kind: 'writing',
      label: 'Writing',
    });
  });
});
