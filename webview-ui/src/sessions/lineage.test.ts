// Protects the two rules of the lineage helpers (issue #21): a `subagent` tool block only gets a
// link when the server really gave it a child session id, and the children of a session come out
// oldest first without strangers. DATA IS FABRICATED by hand from the types; the shape of the
// metadata (`{sessionID, status}`) was seen in the planner spike against a real opencode 2.0.32
// (Windows 11, 21/10/2026), these tests only pin the logic.
import { describe, expect, it } from 'vitest';
import type { JsonObject, Part, SessionSummary } from '../../../src/shared/model';
import { childrenOf, subagentOf } from './lineage';

const INPUT: JsonObject = { agent: 'general', description: 'Say hello', prompt: 'hi' };

/** A running tool block named `name`, with `metadata` only when given. */
const running = (metadata?: JsonObject, name = 'subagent'): Part => ({
  type: 'tool',
  id: 'call_1',
  name,
  state: { status: 'running', input: INPUT, ...(metadata ? { metadata } : {}) },
});

describe('subagentOf', () => {
  it('links a running block that carries the child id', () => {
    expect(subagentOf(running({ sessionID: 'ses_kid', status: 'running' }))).toEqual({
      sessionID: 'ses_kid',
      agent: 'general',
      description: 'Say hello',
      running: true,
    });
  });

  it('links a completed block, not running', () => {
    const part: Part = {
      type: 'tool',
      id: 'call_1',
      name: 'subagent',
      state: {
        status: 'completed',
        input: INPUT,
        output: [],
        metadata: { sessionID: 'ses_kid', status: 'completed', truncated: false },
      },
    };
    expect(subagentOf(part)).toMatchObject({ sessionID: 'ses_kid', running: false });
  });

  it('keeps working without the optional labels', () => {
    const part: Part = {
      type: 'tool',
      id: 'call_1',
      name: 'subagent',
      state: {
        status: 'completed',
        input: {},
        output: [],
        metadata: { sessionID: 'ses_kid', status: 'completed' },
      },
    };
    expect(subagentOf(part)).toEqual({ sessionID: 'ses_kid', running: false });
  });

  it('gives no link without metadata (a reload while running, or a failed block)', () => {
    expect(subagentOf(running())).toBeUndefined();
    expect(subagentOf(running({}))).toBeUndefined();
    const failed: Part = {
      type: 'tool',
      id: 'call_1',
      name: 'subagent',
      state: {
        status: 'error',
        input: INPUT,
        error: { code: 'tool.execution', message: 'Subagent failed (sessionID: ses_kid)' },
      },
    };
    expect(subagentOf(failed)).toBeUndefined();
  });

  it('gives no link while the input is still streaming', () => {
    const part: Part = {
      type: 'tool',
      id: 'call_1',
      name: 'subagent',
      state: { status: 'streaming', input: '{"agent":' },
    };
    expect(subagentOf(part)).toBeUndefined();
  });

  it('refuses another tool, an id that is not a session id and a status it does not know', () => {
    expect(
      subagentOf(running({ sessionID: 'ses_kid', status: 'running' }, 'read')),
    ).toBeUndefined();
    expect(subagentOf(running({ sessionID: 'msg_1', status: 'running' }))).toBeUndefined();
    expect(subagentOf(running({ sessionID: 7, status: 'running' }))).toBeUndefined();
    expect(subagentOf(running({ sessionID: 'ses_kid', status: 'failed' }))).toBeUndefined();
    expect(subagentOf(running({ sessionID: 'ses_kid' }))).toBeUndefined();
  });

  it('gives no link for text and reasoning blocks', () => {
    expect(subagentOf({ type: 'text', id: 't', text: 'hi' })).toBeUndefined();
    expect(subagentOf({ type: 'reasoning', id: 'r', text: 'hm', completed: true })).toBeUndefined();
  });
});

const row = (id: string, createdAt: number, parentID?: string): SessionSummary => ({
  id,
  createdAt,
  updatedAt: createdAt,
  ...(parentID === undefined ? {} : { parentID }),
});

describe('childrenOf', () => {
  it('returns only the children of that session, oldest first', () => {
    const sessions = {
      ses_c: row('ses_c', 30, 'ses_p'),
      ses_a: row('ses_a', 10, 'ses_p'),
      ses_p: row('ses_p', 1),
      ses_b: row('ses_b', 20, 'ses_other'),
      ses_grand: row('ses_grand', 40, 'ses_a'),
    };
    expect(childrenOf(sessions, 'ses_p').map((r) => r.id)).toEqual(['ses_a', 'ses_c']);
  });

  it('breaks a tie of creation time by id, and is empty without children', () => {
    const sessions = { ses_z: row('ses_z', 5, 'ses_p'), ses_y: row('ses_y', 5, 'ses_p') };
    expect(childrenOf(sessions, 'ses_p').map((r) => r.id)).toEqual(['ses_y', 'ses_z']);
    expect(childrenOf(sessions, 'ses_none')).toEqual([]);
  });
});
