// Protects against: the home webview (untrusted input, architecture rule 1) smuggling a port, a
// password or an unbounded payload to the host, or sending an intention outside the closed unions
// (an action or a mode that is not one of ours). Blank start text never reaches the host.
//
// Provenance: every message here is FABRICATED by the test; it proves OUR validator, not how
// `postMessage` delivers real payloads (`test:visual` step 50 sends real ones from the DOM).
import { describe, expect, it } from 'vitest';
import {
  MAX_HOME_ID,
  MAX_HOME_TEXT,
  isHomeHostToWebview,
  isHomeWebviewToHost,
} from './homeProtocol';

describe('isHomeWebviewToHost', () => {
  it('accepts every message of the union in its exact shape', () => {
    const valid: unknown[] = [
      { type: 'home.ready' },
      { type: 'home.start', requestId: 'r1', text: 'fix the build' },
      { type: 'home.stop', requestId: 'r2', sessionID: 'ses_1' },
      { type: 'home.reply', kind: 'permission', sessionID: 'ses_1', id: 'per_1' },
      { type: 'home.reply', kind: 'form', sessionID: 'ses_1', id: 'frm_1' },
      { type: 'home.open', sessionID: 'ses_1' },
      { type: 'home.action', action: 'restart' },
      { type: 'home.action', action: 'logs' },
      { type: 'home.action', action: 'settings' },
      { type: 'home.mode', mode: 'manual' },
      { type: 'home.mode', mode: 'auto' },
    ];
    for (const message of valid) expect(isHomeWebviewToHost(message)).toBe(true);
  });

  it('refuses blank and oversized start text, and keeps the exact bounds', () => {
    const start = (text: unknown): unknown => ({ type: 'home.start', requestId: 'r1', text });
    expect(isHomeWebviewToHost(start(''))).toBe(false);
    expect(isHomeWebviewToHost(start('  \n\t '))).toBe(false);
    expect(isHomeWebviewToHost(start(42))).toBe(false);
    expect(isHomeWebviewToHost(start('x'.repeat(MAX_HOME_TEXT)))).toBe(true);
    expect(isHomeWebviewToHost(start('x'.repeat(MAX_HOME_TEXT + 1)))).toBe(false);
  });

  it('refuses ids that are empty, not strings or too long', () => {
    expect(isHomeWebviewToHost({ type: 'home.open', sessionID: '' })).toBe(false);
    expect(isHomeWebviewToHost({ type: 'home.open', sessionID: 7 })).toBe(false);
    expect(isHomeWebviewToHost({ type: 'home.open', sessionID: 'x'.repeat(MAX_HOME_ID) })).toBe(
      true,
    );
    expect(isHomeWebviewToHost({ type: 'home.open', sessionID: 'x'.repeat(MAX_HOME_ID + 1) })).toBe(
      false,
    );
    expect(isHomeWebviewToHost({ type: 'home.stop', requestId: '', sessionID: 's' })).toBe(false);
    expect(isHomeWebviewToHost({ type: 'home.reply', kind: 'permission', sessionID: 's' })).toBe(
      false,
    );
  });

  it('refuses a value outside the closed unions', () => {
    expect(isHomeWebviewToHost({ type: 'home.action', action: 'rm -rf' })).toBe(false);
    expect(isHomeWebviewToHost({ type: 'home.mode', mode: 'yolo' })).toBe(false);
    expect(
      isHomeWebviewToHost({ type: 'home.reply', kind: 'other', sessionID: 's', id: 'i' }),
    ).toBe(false);
    expect(isHomeWebviewToHost({ type: 'home.nope' })).toBe(false);
    expect(isHomeWebviewToHost({ type: 'prompt.send', text: 'x' })).toBe(false);
  });

  it('refuses extra fields such as a port or a password (rule 1)', () => {
    for (const extra of ['port', 'password', 'url', 'key', 'path']) {
      expect(isHomeWebviewToHost({ type: 'home.ready', [extra]: 'x' })).toBe(false);
      expect(
        isHomeWebviewToHost({ type: 'home.start', requestId: 'r', text: 'hi', [extra]: 'x' }),
      ).toBe(false);
    }
  });

  it('refuses non-objects, inherited fields and a throwing getter without throwing', () => {
    for (const value of [null, undefined, 'home.ready', 3, [], [{ type: 'home.ready' }]]) {
      expect(isHomeWebviewToHost(value)).toBe(false);
    }
    expect(isHomeWebviewToHost(Object.create({ type: 'home.ready' }))).toBe(false);
    const hostile = {
      type: 'home.open',
      get sessionID(): string {
        throw new Error('boom');
      },
    };
    expect(isHomeWebviewToHost(hostile)).toBe(false);
  });
});

describe('isHomeHostToWebview', () => {
  it('accepts the two host messages and nothing else', () => {
    expect(isHomeHostToWebview({ type: 'home.state', state: {} })).toBe(true);
    expect(isHomeHostToWebview({ type: 'home.result', requestId: 'r', ok: true })).toBe(true);
    expect(isHomeHostToWebview({ type: 'settings.state' })).toBe(false);
    expect(isHomeHostToWebview('home.state')).toBe(false);
    expect(isHomeHostToWebview(null)).toBe(false);
  });
});
