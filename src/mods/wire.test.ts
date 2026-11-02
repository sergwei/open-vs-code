// Tests for `wire.ts` (E10-mods, phase 1).
//
// What they protect: the border check of the host against a Worker that runs arbitrary user code.
// A regression here lets a mod push an unbounded string into the status band or the log, or smuggle
// an unknown message type past the switch. Every message is FABRICATED from the unions in
// `wire.ts`; what a real Worker sends is covered by `modHost.test.ts`. Each limit is tested at the
// cap (accepted) and one past it (rejected), because an off-by-one is the likely bug.

import { describe, expect, it } from 'vitest';
import {
  MAX_ACTION_LABEL,
  MAX_COMMAND_DESCRIPTION,
  MAX_COMPOSE_TEXT,
  MAX_LOG_TEXT,
  MAX_PANEL_FILES,
  MAX_PANEL_MESSAGE_BYTES,
  MAX_PANEL_PATH,
  MAX_PANEL_TITLE,
  MAX_STATUS_TEXT,
  MAX_TOAST,
  MAX_TOAST_ACTIONS,
  MAX_TOOLTIP,
  isHostToWorker,
  isPanelData,
  isWorkerToHost,
} from './wire';

const repeat = (n: number): string => 'x'.repeat(n);

describe('isWorkerToHost', () => {
  it.each([
    [{ type: 'ready' }],
    [{ type: 'failed', message: 'boom' }],
    [{ type: 'log', level: 'warn', text: 'hi' }],
    [{ type: 'error', message: 'uncaught' }],
    [{ type: 'command.add', name: 'hello', description: 'Says hello' }],
    [{ type: 'command.remove', name: 'hello' }],
    [{ type: 'command.done', requestId: 'c1' }],
    [{ type: 'command.done', requestId: 'c1', error: 'nope' }],
    [{ type: 'status.set', text: 'Running', tooltip: 'more', severity: 'warning', command: 'go' }],
    [{ type: 'status.clear' }],
    [{ type: 'toast', requestId: 't1', message: 'done', severity: 'error', actions: ['OK'] }],
    [{ type: 'compose', text: 'hello', send: true }],
    [{ type: 'pong', n: 3 }],
  ])('accepts %j', (message) => {
    expect(isWorkerToHost(message)).toBe(true);
  });

  it('accepts each limit exactly at its cap and rejects one past it', () => {
    const cases: Array<[string, (n: number) => unknown, number]> = [
      ['status text', (n) => ({ type: 'status.set', text: repeat(n) }), MAX_STATUS_TEXT],
      ['tooltip', (n) => ({ type: 'status.set', text: 'a', tooltip: repeat(n) }), MAX_TOOLTIP],
      ['toast', (n) => ({ type: 'toast', requestId: 't', message: repeat(n) }), MAX_TOAST],
      [
        'toast action',
        (n) => ({ type: 'toast', requestId: 't', message: 'a', actions: [repeat(n)] }),
        MAX_ACTION_LABEL,
      ],
      [
        'command description',
        (n) => ({ type: 'command.add', name: 'a', description: repeat(n) }),
        MAX_COMMAND_DESCRIPTION,
      ],
      ['log', (n) => ({ type: 'log', level: 'info', text: repeat(n) }), MAX_LOG_TEXT],
      ['compose', (n) => ({ type: 'compose', text: repeat(n) }), MAX_COMPOSE_TEXT],
      ['command name', (n) => ({ type: 'command.add', name: repeat(n) }), 48],
    ];
    for (const [label, build, cap] of cases) {
      expect(isWorkerToHost(build(cap)), `${label} at ${cap}`).toBe(true);
      expect(isWorkerToHost(build(cap + 1)), `${label} at ${cap + 1}`).toBe(false);
    }
  });

  it('limits the toast actions to three', () => {
    const toast = (actions: string[]): unknown => ({
      type: 'toast',
      requestId: 't',
      message: 'a',
      actions,
    });
    expect(isWorkerToHost(toast(Array.from({ length: MAX_TOAST_ACTIONS }, () => 'a')))).toBe(true);
    expect(isWorkerToHost(toast(Array.from({ length: MAX_TOAST_ACTIONS + 1 }, () => 'a')))).toBe(
      false,
    );
  });

  it.each([
    [{ type: 'shell.run', command: 'rm -rf /' }],
    [{ type: 'status.set' }],
    [{ type: 'status.set', text: '' }],
    [{ type: 'status.set', text: 'a', severity: 'fatal' }],
    [{ type: 'status.set', text: 'a', command: 'Bad Name' }],
    [{ type: 'log', level: 'debug', text: 'a' }],
    [{ type: 'command.add', name: 'Bad Name' }],
    [{ type: 'command.add', name: '-lead' }],
    [{ type: 'pong', n: 1.5 }],
    [{ type: 'compose', text: 'a', send: 'yes' }],
    [{ type: 'toast', requestId: 't', message: 'a', actions: 'OK' }],
    [{ type: 'toast', requestId: 't', message: 'a', actions: [''] }],
    [{ type: 'failed' }],
    [null],
    [undefined],
    ['ready'],
    [[]],
    [{}],
    [{ type: 7 }],
  ])('rejects %j', (message) => {
    expect(isWorkerToHost(message)).toBe(false);
  });
});

describe('isHostToWorker', () => {
  it.each([
    [{ type: 'init', entry: 'C:\\m\\index.mjs', mod: { id: 'a', name: 'A', version: '1' } }],
    [{ type: 'event', event: { type: 'turn.started', sessionID: 's' } }],
    [{ type: 'command.run', requestId: 'c1', name: 'hello', args: '', sessionID: 's' }],
    [{ type: 'ping', n: 1 }],
    [{ type: 'toast.result', requestId: 't1', action: 'OK' }],
    [{ type: 'toast.result', requestId: 't1' }],
    [{ type: 'deactivate' }],
  ])('accepts %j', (message) => {
    expect(isHostToWorker(message)).toBe(true);
  });

  it.each([
    [{ type: 'init', entry: '', mod: { id: 'a', name: 'A', version: '1' } }],
    [{ type: 'init', entry: 'x', mod: { id: 'a' } }],
    [{ type: 'event', event: {} }],
    [{ type: 'command.run', requestId: 'c1', name: 'x' }],
    [{ type: 'unknown' }],
    [null],
    [3],
  ])('rejects %j', (message) => {
    expect(isHostToWorker(message)).toBe(false);
  });
});

/**
 * Panel messages (E10-mods phase 4). Protects the border of the host against a mod that names a file
 * outside its folder, a script that is not a script, or a message past 1 MB, and the bootstrap
 * against a malformed panel message from its host. Fabricated messages; a real round trip is
 * covered by `modHost.test.ts` (Worker) and `test:visual` step 39 (VS Code).
 */
describe('panel messages', () => {
  const open = { type: 'panel.open', panelId: 'p1', title: 'T', html: 'panel.html' };

  it.each([
    [open],
    [{ ...open, html: 'ui/Panel.HTM', scripts: ['a.js', 'lib/b.mjs'], styles: ['s.css'] }],
    [{ ...open, title: repeat(MAX_PANEL_TITLE) }],
    [{ ...open, scripts: Array.from({ length: MAX_PANEL_FILES }, (_, i) => `s${i}.js`) }],
    [{ type: 'panel.message', panelId: 'p1', data: { n: 1, list: [true, null, 'x'] } }],
    [{ type: 'panel.message', panelId: 'p1', data: repeat(MAX_PANEL_MESSAGE_BYTES - 2) }],
    [{ type: 'panel.close', panelId: 'p1' }],
  ])('accepts %j', (message) => {
    expect(isWorkerToHost(message)).toBe(true);
  });

  it.each([
    [{ ...open, title: '' }],
    [{ ...open, title: repeat(MAX_PANEL_TITLE + 1) }],
    [{ ...open, html: '../panel.html' }],
    [{ ...open, html: 'a/../../panel.html' }],
    [{ ...open, html: 'a\\..\\panel.html' }],
    [{ ...open, html: '/etc/panel.html' }],
    [{ ...open, html: '\\share\\panel.html' }],
    [{ ...open, html: 'C:\\panel.html' }],
    [{ ...open, html: 'panel.txt' }],
    [{ ...open, html: repeat(MAX_PANEL_PATH) + '.html' }],
    [{ ...open, scripts: ['a.css'] }],
    [{ ...open, styles: ['a.js'] }],
    [{ ...open, scripts: Array.from({ length: MAX_PANEL_FILES + 1 }, (_, i) => `s${i}.js`) }],
    [{ ...open, scripts: 'a.js' }],
    [{ ...open, panelId: '' }],
    [{ type: 'panel.message', panelId: 'p1' }],
    [{ type: 'panel.message', panelId: 'p1', data: repeat(MAX_PANEL_MESSAGE_BYTES - 1) }],
    [{ type: 'panel.close' }],
  ])('rejects %j', (message) => {
    expect(isWorkerToHost(message)).toBe(false);
  });

  it('refuses data that is not JSON: a cycle, a BigInt, undefined', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    expect(isPanelData(cycle)).toBe(false);
    expect(isPanelData(10n)).toBe(false);
    expect(isPanelData(undefined)).toBe(false);
    expect(isPanelData({ ok: [1, 'two', null] })).toBe(true);
  });

  it('measures the size in UTF-8 bytes, not in characters', () => {
    // "é" is 2 bytes: half the cap in characters is the whole cap in bytes (plus the 2 quotes).
    expect(isPanelData('é'.repeat(MAX_PANEL_MESSAGE_BYTES / 2))).toBe(false);
    expect(isPanelData('é'.repeat(MAX_PANEL_MESSAGE_BYTES / 2 - 1))).toBe(true);
  });

  it.each([
    [{ type: 'panel.message', panelId: 'p1', data: { n: 1 } }],
    [{ type: 'panel.closed', panelId: 'p1' }],
  ])('lets the host send %j to the Worker', (message) => {
    expect(isHostToWorker(message)).toBe(true);
  });

  it.each([
    [{ type: 'panel.message', data: 1 }],
    [{ type: 'panel.message', panelId: 'p1', data: undefined }],
    [{ type: 'panel.closed' }],
  ])('rejects %j from the host', (message) => {
    expect(isHostToWorker(message)).toBe(false);
  });
});
