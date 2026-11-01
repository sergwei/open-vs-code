// A minimal MCP server over stdio for the opt-in `real-opencode` suite (E10-config-views, issue
// #128). The real opencode launches it from `mcp.servers.<name>` (given through
// `OPENCODE_CONFIG_CONTENT`, see `realOpencode.test.ts`) and the suite checks that the server
// shows as `connected` with the resource and the template below. NOT part of the extension: it
// ships in no `.vsix` and the fake opencode (`fake-opencode.mjs`) does not use it.
//
// Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout (the MCP stdio transport). It answers
// `initialize`, `ping`, `resources/list`, `resources/templates/list`, `tools/list` and
// `prompts/list`; notifications (no `id`) are ignored; anything else gets `-32601`. Logs go to
// stderr only, because stdout is the protocol channel. The protocol version it answers with is the
// one the client asks for (HYPOTHESIS: opencode's MCP client accepts any version it sent itself).
//
// Provenance: the message shapes follow the public MCP specification (initialize result with
// `protocolVersion`, `capabilities`, `serverInfo`; list results with `resources` /
// `resourceTemplates`). VERIFIED against the real opencode 2.0.32 on Windows 11 (1/11/2026,
// `--label real-opencode`): "✔ lists an MCP server of the config with its resource" (the server
// reached `connected`, its resource and template were in `mcp.resource.catalog`).

import { createInterface } from 'node:readline';

/** The single resource the server lists. */
const RESOURCE = {
  uri: 'file:///fake-mcp/readme.md',
  name: 'fake-readme',
  description: 'A resource of the fake MCP server',
  mimeType: 'text/markdown',
};

/** The single template the server lists. */
const TEMPLATE = {
  uriTemplate: 'file:///fake-mcp/{name}',
  name: 'fake-file',
  description: 'A template of the fake MCP server',
};

/**
 * Writes one JSON-RPC message to stdout, one per line.
 * @param {unknown} message
 */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Answers one request by method name; `undefined` result means "method not found".
 * @param {{ method: string, params?: { protocolVersion?: string } }} request
 * @returns {unknown}
 */
function resultFor(request) {
  switch (request.method) {
    case 'initialize':
      return {
        protocolVersion: request.params?.protocolVersion ?? '2025-03-26',
        capabilities: { resources: {}, tools: {}, prompts: {} },
        serverInfo: { name: 'fake-mcp', version: '0.0.1' },
      };
    case 'ping':
      return {};
    case 'resources/list':
      return { resources: [RESOURCE] };
    case 'resources/templates/list':
      return { resourceTemplates: [TEMPLATE] };
    case 'tools/list':
      return { tools: [] };
    case 'prompts/list':
      return { prompts: [] };
    default:
      return undefined;
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stderr.write('fake-mcp: ignored a line that is not JSON\n');
    return;
  }
  if (typeof message !== 'object' || message === null || message.id === undefined) return;
  const result = resultFor(message);
  if (result === undefined) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Method not found: ${String(message.method)}` },
    });
    return;
  }
  send({ jsonrpc: '2.0', id: message.id, result });
});
// The client closing stdin ends the server.
lines.on('close', () => process.exit(0));
