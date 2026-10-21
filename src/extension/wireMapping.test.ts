// Protects against: the wire-to-model mapping drifting from the shapes opencode 2.0.32 sends
// (user/assistant/idle messages, tool states, permissions, forms) and, above all, error text
// leaking the server URL, port or password to the webview (architecture rule 1).
//
// Provenance of the data: the JSON below follows the shapes of a REAL opencode 2.0.32 as the
// planner recorded them in the 2026-10-20 spike (REST `message.list` with a user message, an
// assistant `[reasoning, text]` and the `idle`/`failed` message) and the types of
// `@opencode/client@2.0.32`; ids and texts are made up and the tool, permission and form cases
// come from the TYPES only, never from a running server. These tests confirm OUR mapping logic,
// not the contract with the server.
import { describe, expect, it } from 'vitest';
import type {
  FormInfo,
  PermissionRequest,
  SessionInfo,
  SessionMessageInfo,
} from '@opencode/client';
import {
  sanitizeText,
  toErrorInfo,
  toFormAsk,
  toMessage,
  toPermissionAsk,
  toSessionSummary,
} from './wireMapping';

/** Parses a JSON literal into the wire type the test says it is. */
function wire<T>(json: string): T {
  return JSON.parse(json) as T;
}

const SECRETS = { url: 'http://127.0.0.1:43211', password: 'S3cr3t-pass_word' };

describe('toSessionSummary', () => {
  it('maps time.created/updated to createdAt/updatedAt and keeps optional fields', () => {
    const info = wire<SessionInfo>(`{
      "id": "ses_1", "title": "Greeting", "projectID": "prj", "cost": 0,
      "tokens": {"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},
      "agent": "build", "model": {"id": "big-pickle", "providerID": "opencode"},
      "outcome": "succeeded",
      "time": {"created": 1000, "updated": 2000},
      "location": {"directory": "C:\\\\work"}
    }`);
    expect(toSessionSummary(info)).toEqual({
      id: 'ses_1',
      title: 'Greeting',
      agent: 'build',
      model: { providerID: 'opencode', id: 'big-pickle' },
      outcome: 'succeeded',
      createdAt: 1000,
      updatedAt: 2000,
    });
  });
});

describe('toMessage', () => {
  it('maps a user message and drops base64 file data', () => {
    const info = wire<SessionMessageInfo>(`{
      "id": "msg_u", "type": "user", "text": "hello", "time": {"created": 10},
      "files": [{"data": "QUJD", "mime": "text/plain", "name": "a.txt",
                 "source": {"type": "uri", "uri": "file:///a.txt"}}]
    }`);
    const mapped = toMessage(info, {});
    expect(mapped?.message).toEqual({
      kind: 'user',
      id: 'msg_u',
      createdAt: 10,
      text: 'hello',
      files: [{ name: 'a.txt', mime: 'text/plain', uri: 'file:///a.txt' }],
    });
    expect(JSON.stringify(mapped)).not.toContain('QUJD');
  });

  it('maps an assistant [reasoning, text] to positional ids #0 and #1', () => {
    const info = wire<SessionMessageInfo>(`{
      "id": "msg_a", "type": "assistant", "agent": "build",
      "model": {"id": "big-pickle", "providerID": "opencode"},
      "time": {"created": 20, "completed": 30}, "finish": "stop", "cost": 0,
      "tokens": {"input":5,"output":6,"reasoning":7,"cache":{"read":1,"write":2}},
      "content": [
        {"type": "reasoning", "text": "thinking", "time": {"created": 21, "completed": 22}},
        {"type": "text", "text": "hello there"}
      ]
    }`);
    const mapped = toMessage(info, {});
    expect(mapped?.message).toMatchObject({
      kind: 'assistant',
      id: 'msg_a',
      completedAt: 30,
      finish: 'stop',
      tokens: { input: 5, output: 6, reasoning: 7, cacheRead: 1, cacheWrite: 2 },
    });
    expect(mapped?.parts).toEqual([
      { type: 'reasoning', id: 'msg_a#0', text: 'thinking', completed: true },
      { type: 'text', id: 'msg_a#1', text: 'hello there' },
    ]);
  });

  it('gives idle and every other type no message in phase 1', () => {
    const idle = wire<SessionMessageInfo>(
      '{"id":"msg_i","type":"idle","outcome":"failed","time":{"created":1},"error":{"type":"provider.no-route","message":"Model unavailable"}}',
    );
    expect(toMessage(idle, {})).toBeUndefined();
  });

  it('maps the four tool states', () => {
    const message = (state: string): SessionMessageInfo =>
      wire<SessionMessageInfo>(`{
        "id": "msg_t", "type": "assistant", "agent": "build",
        "model": {"id": "m", "providerID": "p"}, "time": {"created": 1},
        "content": [{"type": "tool", "id": "call_1", "name": "read", "time": {"created": 1},
                     "state": ${state}}]
      }`);
    const tool = (state: string) => toMessage(message(state), {})?.parts[0];
    expect(tool('{"status":"streaming","input":"{\\"pa"}')).toMatchObject({
      id: 'call_1',
      name: 'read',
      state: { status: 'streaming', input: '{"pa' },
    });
    expect(tool('{"status":"running","input":{"path":"a"},"metadata":{}}')).toMatchObject({
      state: { status: 'running', input: { path: 'a' } },
    });
    expect(
      tool('{"status":"completed","input":{"path":"a"},"content":[{"type":"text","text":"ok"}]}'),
    ).toMatchObject({
      state: { status: 'completed', output: [{ type: 'text', text: 'ok' }] },
    });
    expect(
      tool('{"status":"error","input":{},"error":{"type":"tool.failed","message":"boom"}}'),
    ).toMatchObject({
      state: { status: 'error', error: { code: 'tool.failed', message: 'boom' } },
    });
  });
});

describe('toPermissionAsk', () => {
  it('maps a tool source and defaults save to []', () => {
    const request = wire<PermissionRequest>(`{
      "id": "per_1", "sessionID": "ses_1", "action": "edit", "resources": ["a.ts"],
      "source": {"type": "tool", "messageID": "msg_a", "id": "call_1"}
    }`);
    expect(toPermissionAsk(request)).toEqual({
      id: 'per_1',
      sessionID: 'ses_1',
      action: 'edit',
      resources: ['a.ts'],
      save: [],
      tool: { messageID: 'msg_a', partID: 'call_1' },
    });
  });

  it('keeps save and message when present and has no tool without a source', () => {
    const request = wire<PermissionRequest>(
      '{"id":"p","sessionID":"s","action":"bash","resources":["ls"],"save":["bash:ls"],"message":"run it?"}',
    );
    const ask = toPermissionAsk(request);
    expect(ask.save).toEqual(['bash:ls']);
    expect(ask.message).toBe('run it?');
    expect(ask.tool).toBeUndefined();
  });
});

describe('toFormAsk', () => {
  it('marks metadata.kind question and reads its tool reference', () => {
    const form = wire<FormInfo>(`{
      "id": "frm_1", "sessionID": "ses_1", "title": "Pick one",
      "metadata": {"kind": "question", "tool": {"messageID": "msg_a", "id": "call_2"}},
      "fields": [
        {"key": "q0", "type": "string", "options": [{"value": "a", "label": "A"}], "custom": true},
        {"key": "q1", "type": "multiselect", "options": [{"value": "x", "label": "X"}]},
        {"key": "n", "type": "integer", "minimum": 1, "maximum": "Infinity"}
      ]
    }`);
    const ask = toFormAsk(form);
    expect(ask.kind).toBe('question');
    expect(ask.tool).toEqual({ messageID: 'msg_a', partID: 'call_2' });
    expect(ask.fields[0]).toMatchObject({ key: 'q0', type: 'string', custom: true });
    expect(ask.fields[2]).toEqual({ key: 'n', type: 'number', integer: true, minimum: 1 });
  });

  it('treats a form without kind question as a plain form', () => {
    const form = wire<FormInfo>(
      '{"id":"f","sessionID":"s","title":"T","fields":[{"key":"k","type":"boolean"}]}',
    );
    expect(toFormAsk(form).kind).toBe('form');
  });
});

describe('error scrubbing', () => {
  it('removes the url, loopback host:port and the password from any text', () => {
    const text = `fetch failed: ${SECRETS.url}/api/x (127.0.0.1:43211, localhost:99) pw=${SECRETS.password}`;
    const clean = sanitizeText(text, SECRETS);
    expect(clean).not.toContain('43211');
    expect(clean).not.toContain('localhost:99');
    expect(clean).not.toContain(SECRETS.password);
  });

  it('also removes the Basic token built from the password', () => {
    const token = Buffer.from(`opencode:${SECRETS.password}`).toString('base64');
    expect(sanitizeText(`Authorization: Basic ${token}`, SECRETS)).not.toContain(token);
  });

  it('scrubs a ClientError-like Error and keeps reason as the code', () => {
    const error = Object.assign(
      new Error(`Transport failed for ${SECRETS.url}`, {
        cause: new Error(`connect ECONNREFUSED 127.0.0.1:43211`),
      }),
      { name: 'ClientError', reason: 'Transport' },
    );
    const info = toErrorInfo(error, SECRETS);
    expect(info.code).toBe('Transport');
    expect(JSON.stringify(info)).not.toContain('43211');
  });

  it('reads a thrown server body { _tag, message }', () => {
    const info = toErrorInfo({ _tag: 'SessionNotFoundError', message: 'no such session' }, SECRETS);
    expect(info).toEqual({ code: 'SessionNotFoundError', message: 'no such session' });
  });

  it('reads a SessionStructuredError { type, message } using type as the code', () => {
    const info = toErrorInfo(
      { type: 'provider.no-route', message: 'Model unavailable: nope/does-not-exist' },
      SECRETS,
    );
    expect(info.code).toBe('provider.no-route');
  });

  it('falls back to Unknown for anything else', () => {
    expect(toErrorInfo(42, SECRETS).code).toBe('Unknown');
  });
});
