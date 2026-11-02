// Tests for `modEvents.ts` (E10-mods, phase 1).
//
// What they protect: the table of plan section 3.4 (which stream event becomes which mod event),
// the lesson `leccion/opencode-api/tool-called-sin-nombre` (the tool name is only in
// `session.tool.input.started`, so it must be remembered and may be missing), the bounded
// name memory, and that a failed turn does not leak the server URL or password to mods.
//
// Provenance: every event is FABRICATED, shaped after `@opencode/client@2.0.32`
// (`dist/promise/generated/types.d.ts`: `SessionExecution*`, `SessionTool*`, `Permission*`). They
// prove OUR mapping, not that a real server emits those shapes in that order; a run against the
// fake server's stream needs the controller wiring of phase 2.

import type { V2Event } from '@opencode/client';
import { describe, expect, it } from 'vitest';
import {
  MAX_TOOL_INPUT_CHARS,
  ModEventMapper,
  TOOL_NAME_CAPACITY,
  isModRelevant,
} from './modEvents';

/** Builds a `V2Event` from a type and its `data`; the envelope fields are irrelevant to the mapper. */
function ev(type: string, data: Record<string, unknown>): V2Event {
  return { id: 'evt_1', created: 1, type, data } as unknown as V2Event;
}

const NO_SECRETS = {};

describe('ModEventMapper turns', () => {
  it('maps the four execution events to turn.started / turn.finished', () => {
    const mapper = new ModEventMapper();
    expect(mapper.map(ev('session.execution.started', { sessionID: 's1' }), NO_SECRETS)).toEqual([
      { type: 'turn.started', sessionID: 's1' },
    ]);
    expect(mapper.map(ev('session.execution.succeeded', { sessionID: 's1' }), NO_SECRETS)).toEqual([
      { type: 'turn.finished', sessionID: 's1', outcome: 'succeeded' },
    ]);
    expect(
      mapper.map(
        ev('session.execution.interrupted', { sessionID: 's1', reason: 'user' }),
        NO_SECRETS,
      ),
    ).toEqual([{ type: 'turn.finished', sessionID: 's1', outcome: 'interrupted' }]);
    expect(
      mapper.map(
        ev('session.execution.failed', {
          sessionID: 's1',
          error: { type: 'ProviderError', message: 'rate limited' },
        }),
        NO_SECRETS,
      ),
    ).toEqual([
      {
        type: 'turn.finished',
        sessionID: 's1',
        outcome: 'failed',
        error: { code: 'ProviderError', message: 'rate limited' },
      },
    ]);
  });

  it('scrubs the server URL and the password out of a failed turn', () => {
    const mapper = new ModEventMapper();
    const [mapped] = mapper.map(
      ev('session.execution.failed', {
        sessionID: 's1',
        error: {
          type: 'Transport',
          message: 'cannot reach http://127.0.0.1:4321/api with hunter2',
        },
      }),
      { url: 'http://127.0.0.1:4321', password: 'hunter2' },
    );
    expect(JSON.stringify(mapped)).not.toContain('4321');
    expect(JSON.stringify(mapped)).not.toContain('hunter2');
  });
});

describe('ModEventMapper tools', () => {
  const opened = (id: string, name: string): V2Event =>
    ev('session.tool.input.started', { sessionID: 's1', assistantMessageID: 'm1', id, name });
  const called = (id: string, input: Record<string, unknown> = { path: 'a.ts' }): V2Event =>
    ev('session.tool.called', {
      sessionID: 's1',
      assistantMessageID: 'm1',
      id,
      input,
      executed: false,
    });

  it('gives tool.called the name remembered from input.started, and emits nothing for input.started', () => {
    const mapper = new ModEventMapper();
    expect(mapper.map(opened('call_1', 'read'), NO_SECRETS)).toEqual([]);
    expect(mapper.map(called('call_1'), NO_SECRETS)).toEqual([
      {
        type: 'tool.called',
        sessionID: 's1',
        messageID: 'm1',
        callID: 'call_1',
        tool: 'read',
        input: { path: 'a.ts' },
      },
    ]);
  });

  it('leaves tool undefined when input.started was never seen (no replay on the stream)', () => {
    const mapper = new ModEventMapper();
    const [mapped] = mapper.map(called('call_9'), NO_SECRETS);
    expect(mapped).toEqual({
      type: 'tool.called',
      sessionID: 's1',
      messageID: 'm1',
      callID: 'call_9',
      input: { path: 'a.ts' },
    });
    expect(mapped).not.toHaveProperty('tool');
  });

  it('maps success and failure to tool.finished with the name, and forgets the name afterwards', () => {
    const mapper = new ModEventMapper();
    mapper.map(opened('call_1', 'bash'), NO_SECRETS);
    expect(
      mapper.map(
        ev('session.tool.success', {
          sessionID: 's1',
          assistantMessageID: 'm1',
          id: 'call_1',
          content: [{ type: 'text', text: 'ok' }],
          executed: true,
        }),
        NO_SECRETS,
      ),
    ).toEqual([
      {
        type: 'tool.finished',
        sessionID: 's1',
        messageID: 'm1',
        callID: 'call_1',
        tool: 'bash',
        status: 'completed',
      },
    ]);
    // The name is gone: a second closing event for the same call has no tool.
    const [again] = mapper.map(
      ev('session.tool.failed', {
        sessionID: 's1',
        assistantMessageID: 'm1',
        id: 'call_1',
        error: { type: 'ToolError', message: 'exit 1' },
      }),
      NO_SECRETS,
    );
    expect(again).toEqual({
      type: 'tool.finished',
      sessionID: 's1',
      messageID: 'm1',
      callID: 'call_1',
      status: 'error',
      error: { code: 'ToolError', message: 'exit 1' },
    });
  });

  it('bounds the name memory FIFO: the 513th call evicts the 1st', () => {
    const mapper = new ModEventMapper();
    for (let i = 1; i <= TOOL_NAME_CAPACITY + 1; i += 1)
      mapper.map(opened(`c${i}`, `tool${i}`), NO_SECRETS);
    const first = mapper.map(called('c1'), NO_SECRETS)[0];
    const second = mapper.map(called('c2'), NO_SECRETS)[0];
    const last = mapper.map(called(`c${TOOL_NAME_CAPACITY + 1}`), NO_SECRETS)[0];
    expect(first).not.toHaveProperty('tool');
    expect(second).toHaveProperty('tool', 'tool2');
    expect(last).toHaveProperty('tool', `tool${TOOL_NAME_CAPACITY + 1}`);
  });

  it('hands over an oversized input as {} flagged inputTruncated, and a normal one untouched', () => {
    const mapper = new ModEventMapper();
    const [big] = mapper.map(
      called('call_1', { content: 'x'.repeat(MAX_TOOL_INPUT_CHARS) }),
      NO_SECRETS,
    );
    expect(big).toMatchObject({ type: 'tool.called', input: {}, inputTruncated: true });
    const [small] = mapper.map(called('call_2', { content: 'short' }), NO_SECRETS);
    expect(small).toMatchObject({ input: { content: 'short' } });
    expect(small).not.toHaveProperty('inputTruncated');
  });
});

describe('ModEventMapper permissions and everything else', () => {
  it('maps permission.asked and permission.replied (requestID becomes id)', () => {
    const mapper = new ModEventMapper();
    expect(
      mapper.map(
        ev('permission.asked', {
          id: 'per_1',
          sessionID: 's1',
          action: 'read',
          resources: ['src/a.ts'],
          save: ['src/**'],
          message: 'secret prompt text',
        }),
        NO_SECRETS,
      ),
    ).toEqual([
      {
        type: 'permission.asked',
        sessionID: 's1',
        id: 'per_1',
        action: 'read',
        resources: ['src/a.ts'],
      },
    ]);
    expect(
      mapper.map(
        ev('permission.replied', { sessionID: 's1', requestID: 'per_1', reply: 'once' }),
        NO_SECRETS,
      ),
    ).toEqual([{ type: 'permission.replied', sessionID: 's1', id: 'per_1', reply: 'once' }]);
  });

  it('exposes nothing for deltas, text, reasoning or unrelated events', () => {
    const mapper = new ModEventMapper();
    for (const type of [
      'session.text.delta',
      'session.text.ended',
      'session.reasoning.delta',
      'session.tool.input.delta',
      'session.tool.progress',
      'session.usage.updated',
      'server.connected',
    ]) {
      expect(mapper.map(ev(type, { sessionID: 's1' }), NO_SECRETS), type).toEqual([]);
    }
  });

  it('isModRelevant lets the controller skip the high-volume events cheaply', () => {
    expect(isModRelevant('session.tool.called')).toBe(true);
    expect(isModRelevant('permission.asked')).toBe(true);
    expect(isModRelevant('session.execution.failed')).toBe(true);
    expect(isModRelevant('session.text.delta')).toBe(false);
  });
});
