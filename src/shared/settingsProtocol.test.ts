// Protects against: the settings webview (untrusted input, architecture rule 1) smuggling a secret
// or an unbounded payload to the host. A message with `key`, `apiKey` or `secret` must never pass,
// and neither may extra fields, oversized ids/answers, or the chat's own messages.
//
// Provenance: every message here is FABRICATED by the test; it proves OUR validator, not how
// `postMessage` delivers real payloads (the `fake-server` suite feeds messages through
// `test.settingsMessage`, which is not a DOM `postMessage`; `test:visual` steps 35-36 send real ones
// by clicking in the tab, see the header of `isSettingsWebviewToHost`).
import { describe, expect, it } from 'vitest';
import {
  MAX_SETTINGS_ANSWERS,
  MAX_SETTINGS_ID,
  MAX_SETTINGS_VALUE,
  isSettingsHostToWebview,
  isSettingsWebviewToHost,
  SETTINGS_SETTING_KEYS,
} from './settingsProtocol';

/** Spelled out here, not read from the module, so adding a key there fails this list on purpose. */
const SETTING_KEYS = [
  'opencodePath',
  'serverUrl',
  'defaultModel',
  'chatLocation',
  'autoStart',
  'mods.enabled',
] as const;

const CONNECT = { type: 'settings.connect', integrationID: 'azure', method: 0, answer: {} };

describe('isSettingsWebviewToHost', () => {
  it('accepts every message of the union in its exact shape', () => {
    const valid: unknown[] = [
      { type: 'settings.ready' },
      { type: 'settings.refresh' },
      { ...CONNECT, answer: { resourceName: 'my-resource' } },
      { type: 'settings.cancel', integrationID: 'github-copilot' },
      { type: 'settings.copyCode', integrationID: 'github-copilot' },
      { type: 'settings.disconnect', integrationID: 'anthropic', credentialID: 'cred_1' },
      { type: 'settings.action', action: 'logs' },
      { type: 'settings.action', action: 'extensionSettings' },
      { type: 'settings.action', action: 'restart' },
      { type: 'settings.setDefaultModel', model: 'anthropic/claude-sonnet' },
      { type: 'settings.setDefaultModel', model: '' },
      ...SETTING_KEYS.map((key) => ({ type: 'settings.openSetting', key })),
      { type: 'settings.mcp', server: 'docs', op: 'connect' },
      { type: 'settings.mcp', server: 'docs', op: 'disconnect' },
      { type: 'settings.mcpSignIn', server: 'linear' },
    ];
    for (const message of valid) expect(isSettingsWebviewToHost(message)).toBe(true);
  });

  /**
   * Protects the MCP actions of issue #186 (PR2): the webview may connect or disconnect a server of
   * the snapshot and start its sign-in, and NOTHING else of the MCP routes: no add, no remove, no
   * config, no key. Fabricated messages (this proves our validator, not what a real webview posts).
   */
  it('takes a connect or disconnect of an MCP server and a sign-in, and nothing else', () => {
    const bad: unknown[] = [
      { type: 'settings.mcp' },
      { type: 'settings.mcp', server: 'docs' },
      { type: 'settings.mcp', op: 'connect' },
      { type: 'settings.mcp', server: 'docs', op: 'add' },
      { type: 'settings.mcp', server: 'docs', op: 'remove' },
      { type: 'settings.mcp', server: 'docs', op: 'Connect' },
      { type: 'settings.mcp', server: 'docs', op: 1 },
      { type: 'settings.mcp', server: '', op: 'connect' },
      { type: 'settings.mcp', server: 'x'.repeat(MAX_SETTINGS_ID + 1), op: 'connect' },
      { type: 'settings.mcp', server: 7, op: 'connect' },
      { type: 'settings.mcp', server: 'docs', op: 'connect', config: { command: 'x' } },
      { type: 'settings.mcp', server: 'docs', op: 'connect', key: 'sk-planted' },
      { type: 'settings.mcp', server: 'docs', op: 'connect', apiKey: 'sk-planted' },
      { type: 'settings.mcp', server: 'docs', op: 'connect', secret: 'sk-planted' },
      { type: 'settings.mcp', server: 'docs', op: 'connect', add: true },
      { type: 'settings.mcpSignIn' },
      { type: 'settings.mcpSignIn', server: '' },
      { type: 'settings.mcpSignIn', server: 'x'.repeat(MAX_SETTINGS_ID + 1) },
      { type: 'settings.mcpSignIn', server: ['linear'] },
      { type: 'settings.mcpSignIn', server: 'linear', key: 'sk-planted' },
      { type: 'settings.mcpSignIn', server: 'linear', secret: 'sk-planted' },
      { type: 'settings.mcpSignIn', server: 'linear', integrationID: 'mcp_0123456789abcdef' },
    ];
    for (const message of bad) expect(isSettingsWebviewToHost(message)).toBe(false);
    expect(
      isSettingsWebviewToHost({
        type: 'settings.mcp',
        server: 'x'.repeat(MAX_SETTINGS_ID),
        op: 'disconnect',
      }),
    ).toBe(true);
  });

  it('rejects a default-model request with extra fields or a model that is too long or not text', () => {
    const bad: unknown[] = [
      { type: 'settings.setDefaultModel' },
      { type: 'settings.setDefaultModel', model: 'a/b', apiKey: 'sk-planted' },
      { type: 'settings.setDefaultModel', model: 'a/b', secret: 'sk-planted' },
      { type: 'settings.setDefaultModel', model: 'a/b', key: 'sk-planted' },
      { type: 'settings.setDefaultModel', model: 'a/b', token: 'sk-planted' },
      { type: 'settings.setDefaultModel', model: 'x'.repeat(2 * MAX_SETTINGS_ID + 2) },
      { type: 'settings.setDefaultModel', model: 1 },
      { type: 'settings.setDefaultModel', model: ['a/b'] },
    ];
    for (const message of bad) expect(isSettingsWebviewToHost(message)).toBe(false);
    expect(
      isSettingsWebviewToHost({
        type: 'settings.setDefaultModel',
        model: 'x'.repeat(2 * MAX_SETTINGS_ID + 1),
      }),
    ).toBe(true);
  });

  it('opens only the settings of the closed list, and takes nothing besides the key', () => {
    const bad: unknown[] = [
      { type: 'settings.openSetting' },
      { type: 'settings.openSetting', key: 'openVsCode.defaultModel' },
      { type: 'settings.openSetting', key: 'editor.fontSize' },
      { type: 'settings.openSetting', key: '' },
      { type: 'settings.openSetting', key: 'defaultModel', apiKey: 'sk-planted' },
      { type: 'settings.openSetting', key: 'defaultModel', secret: 'sk-planted' },
      { type: 'settings.openSetting', key: 7 },
    ];
    for (const message of bad) expect(isSettingsWebviewToHost(message)).toBe(false);
    expect([...SETTINGS_SETTING_KEYS]).toEqual([...SETTING_KEYS]);
  });

  it('rejects a message that carries a key, an apiKey or a secret (rule 1)', () => {
    for (const extra of ['key', 'apiKey', 'secret', 'token', 'password', 'code']) {
      expect(isSettingsWebviewToHost({ ...CONNECT, [extra]: 'sk-planted' })).toBe(false);
      expect(isSettingsWebviewToHost({ type: 'settings.ready', [extra]: 'sk-planted' })).toBe(
        false,
      );
      expect(
        isSettingsWebviewToHost({ type: 'settings.cancel', integrationID: 'x', [extra]: 'v' }),
      ).toBe(false);
    }
  });

  it('rejects unknown types, the chat protocol and non-objects', () => {
    for (const bad of [
      { type: 'settings.unknown' },
      { type: 'ready' },
      { type: 'toString' },
      { type: 'constructor' },
      { type: 'settings.state' },
      null,
      undefined,
      'settings.ready',
      42,
      [],
      Object.create({ type: 'settings.ready' }) as unknown,
    ]) {
      expect(isSettingsWebviewToHost(bad)).toBe(false);
    }
  });

  it('rejects missing fields, wrong types and out-of-range values', () => {
    const bad: unknown[] = [
      { type: 'settings.connect', integrationID: 'a', method: 0 },
      { ...CONNECT, integrationID: '' },
      { ...CONNECT, integrationID: 'a'.repeat(MAX_SETTINGS_ID + 1) },
      { ...CONNECT, method: -1 },
      { ...CONNECT, method: 1.5 },
      { ...CONNECT, method: 101 },
      { ...CONNECT, method: '0' },
      { ...CONNECT, answer: [] },
      { ...CONNECT, answer: { a: 1 } },
      { ...CONNECT, answer: { a: ['x'] } },
      { ...CONNECT, answer: { a: 'v'.repeat(MAX_SETTINGS_VALUE + 1) } },
      { ...CONNECT, answer: { ['k'.repeat(MAX_SETTINGS_ID + 1)]: 'v' } },
      { type: 'settings.disconnect', integrationID: 'a' },
      { type: 'settings.disconnect', integrationID: 'a', credentialID: '' },
      { type: 'settings.action', action: 'format-disk' },
      { type: 'settings.action' },
    ];
    for (const message of bad) expect(isSettingsWebviewToHost(message)).toBe(false);
  });

  it('caps the number of answers at the limit', () => {
    const answers = (count: number): Record<string, string> =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${String(i)}`, 'v']));
    expect(isSettingsWebviewToHost({ ...CONNECT, answer: answers(MAX_SETTINGS_ANSWERS) })).toBe(
      true,
    );
    expect(isSettingsWebviewToHost({ ...CONNECT, answer: answers(MAX_SETTINGS_ANSWERS + 1) })).toBe(
      false,
    );
  });

  it('does not throw on a hostile object with a throwing getter', () => {
    const hostile = {
      type: 'settings.cancel',
      get integrationID(): string {
        throw new Error('boom');
      },
    };
    expect(isSettingsWebviewToHost(hostile)).toBe(false);
  });
});

describe('isSettingsHostToWebview', () => {
  it('accepts the two host messages and nothing else', () => {
    expect(isSettingsHostToWebview({ type: 'settings.state', state: {} })).toBe(true);
    expect(isSettingsHostToWebview({ type: 'settings.notice', notice: {} })).toBe(true);
    expect(isSettingsHostToWebview({ type: 'settings.ready' })).toBe(false);
    expect(isSettingsHostToWebview({ type: 'connection.state' })).toBe(false);
    expect(isSettingsHostToWebview(null)).toBe(false);
  });
});
