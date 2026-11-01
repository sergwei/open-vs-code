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
} from './settingsProtocol';

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
    ];
    for (const message of valid) expect(isSettingsWebviewToHost(message)).toBe(true);
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
