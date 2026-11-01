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
  AgentInfo,
  FormInfo,
  ModelInfo,
  PermissionRequest,
  ProviderInfo,
  SessionInfo,
  SessionMessageInfo,
} from '@opencode/client';
import {
  lastCompactionAt,
  sanitizeText,
  toAgentOptions,
  toErrorInfo,
  toFormAsk,
  toMessage,
  toModelOption,
  toModelRef,
  toPermissionAsk,
  toProviderOption,
  toSessionSummary,
  toToolOutput,
} from './wireMapping';

/** Parses a JSON literal into the wire type the test says it is. */
function wire<T>(json: string): T {
  return JSON.parse(json) as T;
}

const SECRETS = { url: 'http://127.0.0.1:43211', password: 'S3cr3t-pass_word' };

const ZERO_TOKENS = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };

// Issues #23/#24. The model JSON follows the fields of a REAL `ModelInfo` as the planner spike saw
// them (opencode 2.0.32, Windows 11, 21/10/2026: `glm-5.3-flash-free`, variants low/high/max,
// context 200000, cost 0) trimmed to what the mapping reads; the paid, tiered and no-cost models
// and the agent list are FABRICATED from the types (the agent ids and modes of the list are what
// the spike printed). These pin OUR mapping, not the contract.
describe('catalog mapping', () => {
  const model = (cost: string): ModelInfo =>
    wire<ModelInfo>(`{
      "id": "glm-5.3-flash-free", "modelID": "glm-5.3-flash", "providerID": "opencode",
      "name": "GLM-5.3-Flash Free", "capabilities": {"tools": true, "input": [], "output": []},
      "variants": [{"id": "low"}, {"id": "high"}, {"id": "max"}],
      "time": {"released": 1}, "cost": ${cost}, "status": "beta", "enabled": true,
      "limit": {"context": 200000, "output": 32000}
    }`);
  const zero = '{"input": 0, "output": 0, "cache": {"read": 0, "write": 0}}';
  const paid = '{"input": 3, "output": 15, "cache": {"read": 0, "write": 0}}';

  it('maps a free model', () => {
    expect(toModelOption(model(`[${zero}]`))).toEqual({
      providerID: 'opencode',
      id: 'glm-5.3-flash-free',
      name: 'GLM-5.3-Flash Free',
      status: 'beta',
      contextLimit: 200000,
      free: true,
      variants: ['low', 'high', 'max'],
      images: false,
    });
  });

  // Issue #30. The wire JSON is hand-made in the shape of `ModelInfo.capabilities` (client types
  // of 2.0.32); only the fake server was seen to serve it, no real catalog was read for it.
  it('reads images from capabilities.input', () => {
    const withInput = (input: string): ModelInfo =>
      wire<ModelInfo>(`{
        "id": "m", "modelID": "m", "providerID": "p", "name": "M",
        "capabilities": {"tools": true, "input": ${input}, "output": []},
        "variants": [], "time": {"released": 1}, "cost": [], "status": "active", "enabled": true,
        "limit": {"context": 1, "output": 1}
      }`);
    expect(toModelOption(withInput('["text","image"]')).images).toBe(true);
    expect(toModelOption(withInput('["text"]')).images).toBe(false);
  });

  it('is free only when EVERY cost entry is zero, and never with no cost entry at all', () => {
    expect(toModelOption(model(`[${paid}]`)).free).toBe(false);
    expect(toModelOption(model(`[${zero}, ${paid}]`)).free).toBe(false);
    expect(toModelOption(model('[]')).free).toBe(false);
  });

  it('keeps only the selectable agents, in the server order', () => {
    const agent = (id: string, mode: string, hidden: boolean, extra = ''): AgentInfo =>
      wire<AgentInfo>(
        `{"id": "${id}", "name": "${id.toUpperCase()}", "mode": "${mode}", "hidden": ${String(hidden)},
          "request": {}, "permissions": []${extra}}`,
      );
    const list = [
      agent('build', 'primary', false, ', "description": "Builds"'),
      agent('general', 'subagent', false),
      agent('title', 'primary', true),
      agent('plan', 'primary', false),
      agent('both', 'all', false),
    ];
    expect(toAgentOptions(list)).toEqual([
      { id: 'build', name: 'BUILD', description: 'Builds' },
      { id: 'plan', name: 'PLAN' },
      { id: 'both', name: 'BOTH' },
    ]);
  });

  it('turns the variant "default" the server echoes into no variant, and keeps real ones', () => {
    expect(toModelRef({ providerID: 'p', id: 'm', variant: 'default' })).toEqual({
      providerID: 'p',
      id: 'm',
    });
    expect(toModelRef({ providerID: 'p', id: 'm', variant: 'low' })).toEqual({
      providerID: 'p',
      id: 'm',
      variant: 'low',
    });
    expect(toModelRef({ providerID: 'p', id: 'm' })).toEqual({ providerID: 'p', id: 'm' });
  });
});

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
      usage: { cost: 0, tokens: ZERO_TOKENS },
    });
  });

  // Issue #25. The numbers are the totals the planner's spike saw on a real opencode 2.0.32 after
  // one turn (Windows 11, 22/10/2026: `{input:4951, output:4, cache.read:4608}`); the JSON is
  // rebuilt by hand, so this pins OUR mapping (cache.read/write -> cacheRead/cacheWrite), not the
  // contract.
  it('maps the accumulated cost and tokens of the row to usage', () => {
    const info = wire<SessionInfo>(`{
      "id": "ses_1", "projectID": "prj", "cost": 0.0123,
      "tokens": {"input":4951,"output":4,"reasoning":0,"cache":{"read":4608,"write":7}},
      "time": {"created": 1, "updated": 2}
    }`);
    expect(toSessionSummary(info).usage).toEqual({
      cost: 0.0123,
      tokens: { input: 4951, output: 4, reasoning: 0, cacheRead: 4608, cacheWrite: 7 },
    });
  });

  // Issue #25, review S4. FABRICATED rows that lack a field the types call required: the mapping
  // must degrade to "no usage" instead of throwing (a throw would fail the whole resync for a
  // cosmetic line). No real server was seen to send such a row.
  it('sets usage only when both cost and tokens are present, and never throws', () => {
    const noTokens = wire<SessionInfo>(`{
      "id": "ses_1", "projectID": "prj", "cost": 0.5, "time": {"created": 1, "updated": 2}
    }`);
    const noCost = wire<SessionInfo>(`{
      "id": "ses_1", "projectID": "prj",
      "tokens": {"input":1,"output":1,"reasoning":0,"cache":{"read":0,"write":0}},
      "time": {"created": 1, "updated": 2}
    }`);
    expect(toSessionSummary(noTokens)).toEqual({ id: 'ses_1', createdAt: 1, updatedAt: 2 });
    expect(toSessionSummary(noCost)).toEqual({ id: 'ses_1', createdAt: 1, updatedAt: 2 });
  });

  // Issue #21. The `fork` JSON is copied from the shape the planner spike saw (opencode 2.0.32,
  // 21/10/2026: root session, `parentID` absent, `fork.sessionID` = original); the test pins the
  // mapping only. A fork is NOT a child: `parentID` must stay absent.
  it('maps fork.sessionID to forkOf and leaves parentID alone', () => {
    const fork = wire<SessionInfo>(`{
      "id": "ses_2", "projectID": "prj", "cost": 0,
      "tokens": {"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},
      "fork": {"sessionID": "ses_1", "boundary": {"type": "before", "messageID": "msg_9"}},
      "time": {"created": 1, "updated": 2}
    }`);
    expect(toSessionSummary(fork)).toEqual({
      id: 'ses_2',
      forkOf: 'ses_1',
      createdAt: 1,
      updatedAt: 2,
      usage: { cost: 0, tokens: ZERO_TOKENS },
    });
    const child = wire<SessionInfo>(`{
      "id": "ses_3", "parentID": "ses_1", "projectID": "prj", "cost": 0,
      "tokens": {"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},
      "time": {"created": 1, "updated": 2}
    }`);
    expect(toSessionSummary(child).forkOf).toBeUndefined();
    expect(toSessionSummary(child).parentID).toBe('ses_1');
  });
});

// Issue #25. The `compaction` message shape follows the REST message the planner's spike saw after
// a manual `session.compact` on a real opencode 2.0.32 (22/10/2026: `status: "completed"`,
// `time.created` = the `compaction.started` event); the running and failed variants and their
// field sets come from the TYPES only. Protects the rule that only a COMPLETED compaction moves
// the boundary of the context indicator.
describe('lastCompactionAt', () => {
  const compaction = (id: string, status: string, created: number): SessionMessageInfo =>
    wire<SessionMessageInfo>(
      `{"id": "${id}", "type": "compaction", "status": "${status}", "reason": "manual",
        "summary": "s", "recent": "r", "time": {"created": ${String(created)}}}`,
    );
  const user = wire<SessionMessageInfo>(
    '{"id": "msg_u", "type": "user", "text": "hi", "time": {"created": 5}, "files": []}',
  );

  it('is undefined without a compaction', () => {
    expect(lastCompactionAt([])).toBeUndefined();
    expect(lastCompactionAt([user])).toBeUndefined();
  });

  it('reads the time of a completed one', () => {
    expect(lastCompactionAt([user, compaction('msg_c', 'completed', 100)])).toBe(100);
  });

  it('ignores running and failed compactions', () => {
    expect(
      lastCompactionAt([compaction('msg_r', 'running', 300), compaction('msg_f', 'failed', 400)]),
    ).toBeUndefined();
    expect(
      lastCompactionAt([compaction('msg_c', 'completed', 100), compaction('msg_f', 'failed', 400)]),
    ).toBe(100);
  });

  it('takes the newest of several whatever their order', () => {
    expect(
      lastCompactionAt([compaction('b', 'completed', 200), compaction('a', 'completed', 100)]),
    ).toBe(200);
  });
});

// Issue #125. Protects the compaction line of the conversation: the three statuses and the `auto`
// reason each give their own text with the id of the REST message (the one the stream notice
// uses), and a failure's text goes through the secret scrubbing. Fabricated messages in the shape
// of the types (the completed one also matches the planner's spike of 22/10/2026): they pin OUR
// mapping, not what a running server lists for a running compaction.
describe('toMessage of a compaction', () => {
  const message = (fields: string): SessionMessageInfo =>
    wire<SessionMessageInfo>(
      `{"id": "msg_c", "type": "compaction", "reason": "manual", "time": {"created": 77}, ${fields}}`,
    );

  it('maps running, completed and failed to a notice with the status', () => {
    expect(toMessage(message('"status": "running", "summary": "", "recent": ""'), {})).toEqual({
      message: {
        kind: 'notice',
        id: 'msg_c',
        createdAt: 77,
        text: 'Compacting the conversation…',
        compaction: 'running',
      },
      parts: [],
    });
    expect(
      toMessage(message('"status": "completed", "summary": "s", "recent": "r"'), {})?.message,
    ).toMatchObject({ text: 'Conversation compacted', compaction: 'completed' });
    expect(
      toMessage(
        message(
          '"status": "failed", "error": {"type": "compaction.unavailable", "message": "Nothing to compact yet"}',
        ),
        {},
      )?.message,
    ).toMatchObject({ text: 'Compaction failed: Nothing to compact yet', compaction: 'failed' });
  });

  it('says so when an automatic compaction completed', () => {
    const auto = wire<SessionMessageInfo>(
      '{"id": "msg_a", "type": "compaction", "status": "completed", "reason": "auto", "summary": "s", "recent": "r", "time": {"created": 1}}',
    );
    expect(toMessage(auto, {})?.message).toMatchObject({
      text: 'Conversation compacted automatically',
    });
  });

  it('keeps the server URL and the password out of a failure text', () => {
    const failed = message(
      `"status": "failed", "error": {"type": "x", "message": "down at ${SECRETS.url} with ${SECRETS.password}"}`,
    );
    const text = JSON.stringify(toMessage(failed, SECRETS));
    expect(text).not.toContain('43211');
    expect(text).not.toContain(SECRETS.password);
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

// Issue #26. Protects the rule "no base64 travels to the webview": a `read` of an image yields a
// `file` item whose `uri` is a `data:` URL. Provenance: FABRICATED from the shape read in
// `read.ts@843a6c51` L175-185 (HYPOTHESIS, no real image read observed); confirms OUR mapping only.
describe('toToolOutput files', () => {
  it('drops a data: URI and keeps mime and name', () => {
    const item = wire<{ type: string }>(
      '{"type":"file","uri":"data:image/png;base64,AAAA","mime":"image/png","name":"a.png"}',
    );
    expect(toToolOutput(item)).toEqual({ type: 'file', mime: 'image/png', name: 'a.png' });
  });

  it('drops a data: URI with leading whitespace', () => {
    const item = wire<{ type: string }>(
      '{"type":"file","uri":" \\n data:text/plain,hi","mime":"x/y"}',
    );
    expect(toToolOutput(item)).toEqual({ type: 'file', mime: 'x/y' });
  });

  it('drops a DATA: URI whatever the case', () => {
    const item = wire<{ type: string }>('{"type":"file","uri":"DATA:text/plain,hi","mime":"x/y"}');
    expect(toToolOutput(item)).toEqual({ type: 'file', mime: 'x/y' });
  });

  it('keeps a file:// URI', () => {
    const item = wire<{ type: string }>(
      '{"type":"file","uri":"file:///tmp/a.pdf","mime":"application/pdf"}',
    );
    expect(toToolOutput(item)).toEqual({
      type: 'file',
      uri: 'file:///tmp/a.pdf',
      mime: 'application/pdf',
    });
  });

  it('keeps text items as they are', () => {
    expect(toToolOutput(wire<{ type: string }>('{"type":"text","text":"hi"}'))).toEqual({
      type: 'text',
      text: 'hi',
    });
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

  // Issue #32: the BODY a real opencode 2.0.32 threw for a revert on a busy session (spike of
  // 23/10/2026, Windows 11) has a `_tag` and a `sessionID` but no `message`; it used to be read as
  // "Unknown error". The body here is that shape copied by hand.
  it('keeps the code of a server body with a _tag and no message, with words for the known ones', () => {
    expect(toErrorInfo({ _tag: 'SessionBusyError', sessionID: 'ses_1' }, SECRETS)).toEqual({
      code: 'SessionBusyError',
      message: 'The session is busy with a turn. Try again when it has finished.',
    });
    expect(toErrorInfo({ _tag: 'SomethingNew' }, SECRETS)).toEqual({
      code: 'SomethingNew',
      message: 'SomethingNew',
    });
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

// Issue #128 (E10, phase 1): `provider.list` is the one read the chat catalog makes whose objects
// can carry secrets (`settings.apiKey`, `headers`, `body`). The JSON is FABRICATED from the types
// of `@opencode/client@2.0.32` with markers planted in those places, as the spike saw `settings.apiKey`
// in a real answer; it pins that OUR mapping never forwards them, not what a real server sends.
describe('toProviderOption keeps no secret', () => {
  it('maps only id and name, however much the provider carries', () => {
    const info = wire<ProviderInfo>(`{
      "id": "anthropic", "name": "Anthropic", "activation": "auto", "package": "x",
      "settings": {"apiKey": "sk-planted-api-key", "timeout": 5},
      "headers": {"authorization": "Bearer hdr-planted-token"},
      "body": {"token": "at-planted-access"}
    }`);
    const option = toProviderOption(info);
    expect(option).toEqual({ id: 'anthropic', name: 'Anthropic' });
    const json = JSON.stringify(option);
    for (const secret of ['sk-planted-api-key', 'hdr-planted-token', 'at-planted-access']) {
      expect(json).not.toContain(secret);
    }
  });
});
