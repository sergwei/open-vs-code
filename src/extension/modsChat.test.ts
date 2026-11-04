/**
 * Unit tests for `modsChat.ts` (E10-mods, phase 3).
 *
 * Protects against: a band shown for a mod that is not `active`, a band button that points at a
 * command the mod does not have, a command listed without its mod prefix (the "/" menu and
 * `mod.command.run` must agree on `<modId>:<name>`), a command that reaches a Worker without being
 * listed, and a compose lost silently when no chat is bound.
 *
 * ALL DATA IS FABRICATED: the source is a hand-written double of `ModHost`, so these cases prove
 * the mapping logic, not what a running host reports.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ModCommandInfo, ModStatus } from './modHost';
import { createModsChat, type ModsSource } from './modsChat';

/** A source whose statuses and commands the test mutates and whose change listeners it can fire. */
function fakeSource(
  statuses: ModStatus[],
  commands: ModCommandInfo[],
): ModsSource & { fire(): void; run: ReturnType<typeof vi.fn> } {
  const listeners = new Set<() => void>();
  const run = vi.fn(() => Promise.resolve());
  return {
    statuses: () => statuses,
    commands: () => commands,
    onDidChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    runCommand: run,
    run,
    fire: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

const HELLO: ModStatus = {
  id: 'hello-station',
  name: 'Hello Station',
  version: '0.1.0',
  state: 'active',
};
const HELLO_CMD: ModCommandInfo = {
  modId: 'hello-station',
  modName: 'Hello Station',
  name: 'hello',
  description: 'Says hello',
};

describe('createModsChat', () => {
  it('lists commands under their qualified name and falls back to the mod name', () => {
    const source = fakeSource(
      [HELLO],
      [HELLO_CMD, { modId: 'hello-station', modName: 'Hello Station', name: 'bye' }],
    );
    const { commands } = createModsChat(source, vi.fn()).state();
    expect(commands).toEqual([
      { modId: 'hello-station', name: 'hello-station:hello', description: 'Says hello' },
      { modId: 'hello-station', name: 'hello-station:bye', description: 'Hello Station' },
    ]);
  });

  it('shows a band only for an active mod, with severity info by default', () => {
    const source = fakeSource(
      [HELLO, { ...HELLO, id: 'other', name: 'Other', state: 'failed' }],
      [HELLO_CMD],
    );
    const chat = createModsChat(source, vi.fn());
    chat.setLine('hello-station', { text: 'Hi', tooltip: 'tip' });
    chat.setLine('other', { text: 'stale', severity: 'error' });
    expect(chat.state().bands).toEqual([
      {
        modId: 'hello-station',
        modName: 'Hello Station',
        text: 'Hi',
        tooltip: 'tip',
        severity: 'info',
      },
    ]);
    chat.setLine('hello-station', undefined);
    expect(chat.state().bands).toEqual([]);
  });

  it('keeps the button command only when that mod has it, qualified', () => {
    const source = fakeSource([HELLO], [HELLO_CMD]);
    const chat = createModsChat(source, vi.fn());
    chat.setLine('hello-station', { text: 'Hi', command: 'hello' });
    expect(chat.state().bands[0]?.command).toBe('hello-station:hello');
    chat.setLine('hello-station', { text: 'Hi', command: 'nope' });
    expect(chat.state().bands[0]).not.toHaveProperty('command');
  });

  it('tells the listeners on a band change and on a change of the host, until disposed', () => {
    const source = fakeSource([HELLO], [HELLO_CMD]);
    const chat = createModsChat(source, vi.fn());
    const listener = vi.fn();
    const subscription = chat.onDidChange(listener);
    chat.setLine('hello-station', { text: 'Hi' });
    source.fire();
    expect(listener).toHaveBeenCalledTimes(2);
    subscription.dispose();
    source.fire();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('runs a listed command through the host and rejects an unlisted one', async () => {
    const source = fakeSource([HELLO], [HELLO_CMD]);
    const chat = createModsChat(source, vi.fn());
    await chat.run('hello-station:hello', 'Ana', 's1');
    expect(source.run).toHaveBeenCalledWith('hello-station', 'hello', 'Ana', 's1');
    await expect(chat.run('hello-station:nope', '')).rejects.toThrow(/not available/);
    await expect(chat.run('hello', '')).rejects.toThrow(/not available/);
    expect(source.run).toHaveBeenCalledTimes(1);
  });

  it('hands a compose to the bound handler as modId and text only, and reports an unbound one', () => {
    const unbound = vi.fn();
    const chat = createModsChat(fakeSource([HELLO], [HELLO_CMD]), unbound);
    chat.compose('hello-station', { text: 'lost' });
    expect(unbound).toHaveBeenCalledWith('hello-station', 'lost');
    const handler = vi.fn();
    chat.bindCompose(handler);
    chat.compose('hello-station', { text: 'a' });
    chat.compose('hello-station', { text: 'b' });
    expect(handler.mock.calls).toEqual([
      [{ modId: 'hello-station', text: 'a' }],
      [{ modId: 'hello-station', text: 'b' }],
    ]);
    chat.bindCompose(undefined);
    chat.compose('hello-station', { text: 'c' });
    expect(unbound).toHaveBeenCalledTimes(2);
  });
});
