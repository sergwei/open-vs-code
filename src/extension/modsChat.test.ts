/**
 * Unit tests for `modsChat.ts` (E10-mods, phase 3).
 *
 * Protects against: a band shown for a mod that is not `active`, a band button that points at a
 * command the mod does not have, a command listed without its mod prefix (the "/" menu and
 * `mod.command.run` must agree on `<modId>:<name>`), a command that reaches a Worker without being
 * listed, and a compose lost silently when no chat is bound. The listing cases (E10-mod-toggles)
 * protect against a switched-off mod shown as running, a toggle of an id the host never listed
 * reaching the stored list, and a listing that does not repaint when only the inventory changes.
 *
 * ALL DATA IS FABRICATED: the source is a hand-written double of `ModHost`, so these cases prove
 * the mapping logic, not what a running host reports.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ModCommandInfo, ModStatus } from './modHost';
import { createModsChat, type ModsSource } from './modsChat';
import type { ModsInventory } from './modsLoader';

/**
 * A source whose statuses and commands the test mutates and whose change listeners it can fire.
 * `inventory` defaults to the mods of `statuses` (all on, persisted) and can be replaced.
 */
function fakeSource(
  statuses: ModStatus[],
  commands: ModCommandInfo[],
  inventory?: ModsInventory,
): ModsSource & {
  fire(): void;
  fireInventory(): void;
  run: ReturnType<typeof vi.fn>;
  toggleSpy: ReturnType<typeof vi.fn>;
  actionSpy: ReturnType<typeof vi.fn>;
} {
  const listeners = new Set<() => void>();
  const inventoryListeners = new Set<() => void>();
  const run = vi.fn(() => Promise.resolve());
  const toggle = vi.fn(() => Promise.resolve());
  const action = vi.fn(() => Promise.resolve());
  const held: ModsInventory = inventory ?? {
    enabled: true,
    persisted: true,
    mods: statuses.map(({ id, name, version }) => ({ id, name, version })),
    skipped: [],
    disabled: [],
  };
  return {
    statuses: () => statuses,
    commands: () => commands,
    onDidChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    runCommand: run,
    inventory: () => held,
    onDidChangeInventory: (listener) => {
      inventoryListeners.add(listener);
      return { dispose: () => inventoryListeners.delete(listener) };
    },
    toggle,
    action,
    toggleSpy: toggle,
    actionSpy: action,
    run,
    fire: () => {
      for (const listener of [...listeners]) listener();
    },
    fireInventory: () => {
      for (const listener of [...inventoryListeners]) listener();
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

  // E10-mod-toggles (issue #181). Fabricated source: these cases prove the translation of the
  // inventory and the statuses into the listing, not what a running host reports.
  it('builds the listing: disabled, starting, active, failed with its error, stopped and the skipped folders', () => {
    const statuses: ModStatus[] = [
      HELLO,
      { id: 'b', name: 'B', version: '1', state: 'starting' },
      { id: 'c', name: 'C', version: '2', state: 'failed', error: 'boom' },
      { id: 'd', name: 'D', version: '3', state: 'active' }, // still in its grace but switched off
    ];
    const inventory: ModsInventory = {
      enabled: true,
      persisted: false,
      mods: [
        { id: 'hello-station', name: 'Hello Station', version: '0.1.0', description: 'Hi' },
        { id: 'b', name: 'B', version: '1' },
        { id: 'c', name: 'C', version: '2' },
        { id: 'd', name: 'D', version: '3' },
        { id: 'e', name: 'E', version: '4' }, // no Worker at all
      ],
      skipped: [{ folder: 'broken', reason: 'no mod.json' }],
      disabled: ['d'],
    };
    const { listing } = createModsChat(fakeSource(statuses, [], inventory), vi.fn()).state();
    expect(listing).toEqual({
      enabled: true,
      persisted: false,
      mods: [
        {
          id: 'hello-station',
          name: 'Hello Station',
          version: '0.1.0',
          description: 'Hi',
          enabled: true,
          state: 'active',
        },
        { id: 'b', name: 'B', version: '1', enabled: true, state: 'starting' },
        { id: 'c', name: 'C', version: '2', enabled: true, state: 'failed', error: 'boom' },
        { id: 'd', name: 'D', version: '3', enabled: false, state: 'disabled' },
        { id: 'e', name: 'E', version: '4', enabled: true, state: 'stopped' },
      ],
      skipped: [{ folder: 'broken', reason: 'no mod.json' }],
    });
  });

  it('lists every mod as stopped when the global switch is off, with the switch reported', () => {
    const inventory: ModsInventory = {
      enabled: false,
      persisted: true,
      mods: [{ id: 'a', name: 'A', version: '1' }],
      skipped: [],
      disabled: [],
    };
    const { listing } = createModsChat(fakeSource([], [], inventory), vi.fn()).state();
    expect(listing.enabled).toBe(false);
    expect(listing.mods).toEqual([
      { id: 'a', name: 'A', version: '1', enabled: true, state: 'stopped' },
    ]);
  });

  it('toggle of an unknown id rejects and writes nothing; a known id reaches the source', async () => {
    const source = fakeSource([HELLO], [HELLO_CMD]);
    const chat = createModsChat(source, vi.fn());
    await expect(chat.toggle('nope', false)).rejects.toThrow(/was not found in the mods folder/);
    expect(source.toggleSpy).not.toHaveBeenCalled();
    await chat.toggle('hello-station', false);
    expect(source.toggleSpy).toHaveBeenCalledWith('hello-station', false);
    await chat.action('openSettings');
    expect(source.actionSpy).toHaveBeenCalledWith('openSettings');
  });

  it('repaints on a change of the inventory too, until disposed', () => {
    const source = fakeSource([HELLO], [HELLO_CMD]);
    const chat = createModsChat(source, vi.fn());
    const listener = vi.fn();
    const subscription = chat.onDidChange(listener);
    source.fireInventory();
    source.fire();
    expect(listener).toHaveBeenCalledTimes(2);
    subscription.dispose();
    source.fireInventory();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
