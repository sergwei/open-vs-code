// The chat-facing half of the mods host (E10-mods, phase 3; plan Engram #1765 section 4 F3,
// decisions #1768). Pure: no `vscode`, no I/O. `modsLifecycle.ts` builds one around the real
// `ModHost`; `ChatController` reaches it through `ModsSink.chat`.
//
// It keeps the one thing the host does not: the band each mod pinned (`ModHost` only forwards the
// calls), and turns the host's statuses and commands into the shapes of the protocol (`ModBand`,
// `ModCommandOption`). Commands go out under their QUALIFIED name `<modId>:<command>`, the name the
// user types after the `/` and the one `mod.command.run` carries.

import type { ModBand, ModCommandOption } from '../shared/model';
import type { ModComposeRequest, ModsChat, ModsState } from './modEvents';
import type { ModCommandInfo, ModStatus, ModStatusLine } from './modHost';

/** The part of `ModHost` the chat half reads; tests can inject a fake. */
export interface ModsSource {
  statuses(): ModStatus[];
  commands(): ModCommandInfo[];
  onDidChange(listener: () => void): { dispose(): void };
  runCommand(modId: string, name: string, args: string, sessionID?: string): Promise<void>;
}

/** {@link ModsChat} plus the two doors the mods host calls into (its `ModUi.status` and `.compose`). */
export interface ModsChatController extends ModsChat {
  /** Records (or, with `undefined`, removes) the band of `modId` and tells the listeners. */
  setLine(modId: string, line: ModStatusLine | undefined): void;
  /**
   * Hands a compose of a mod to the bound handler; with none bound (the chat is not registered
   * yet) it calls the `unbound` callback instead so the mod's log says why nothing happened.
   */
  compose(modId: string, request: { text: string }): void;
}

/**
 * The qualified name of a command: `<modId>:<name>`. Command names cannot contain `:` (pattern
 * `^[a-z0-9][a-z0-9-]{0,47}$` of the mods wire) and neither can mod ids, so it splits unambiguously.
 */
export function qualify(modId: string, name: string): string {
  return `${modId}:${name}`;
}

/**
 * Builds the {@link ModsChatController} around `source`.
 *
 * `state()` lists a band only for a mod that is `active` (a band set while `starting` shows once
 * the host reports the change) and gives it `severity: 'info'` when the mod gave none. A band's
 * `command` survives only if that mod really has that command, so the button never offers a
 * dead action. `run` looks the qualified name up among the ACTIVE mods' commands and rejects with
 * `command "x" is not available` otherwise, before anything reaches a Worker.
 * VERIFIED by the cases of `modsChat.test.ts`, which drive it with a fabricated source ("runs a
 * listed command through the host and rejects an unlisted one", "keeps the button command only when
 * that mod has it, qualified"; Windows 11, 02/11/2026). VERIFIED against the real host in VS Code
 * 1.144.0 on Windows 11 (02/11/2026, the final full `test:visual` run): "ok   M4 typing
 * "/hel" lists /hello-station:hello with its description next to the project /hello, inside the
 * view" and "ok   M6 the band button ran the command with no arguments".
 */
export function createModsChat(
  source: ModsSource,
  unbound: (modId: string, text: string) => void,
): ModsChatController {
  const lines = new Map<string, ModStatusLine>();
  const listeners = new Set<() => void>();
  let handler: ((request: ModComposeRequest) => void) | undefined;

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  source.onDidChange(notify);

  return {
    state: (): ModsState => {
      const commands = source.commands();
      const bands: ModBand[] = [];
      for (const status of source.statuses()) {
        const line = lines.get(status.id);
        if (status.state !== 'active' || line === undefined) continue;
        const band: ModBand = {
          modId: status.id,
          modName: status.name,
          text: line.text,
          severity: line.severity ?? 'info',
        };
        if (line.tooltip !== undefined) band.tooltip = line.tooltip;
        if (
          line.command !== undefined &&
          commands.some((c) => c.modId === status.id && c.name === line.command)
        ) {
          band.command = qualify(status.id, line.command);
        }
        bands.push(band);
      }
      const options: ModCommandOption[] = commands.map((c) => ({
        modId: c.modId,
        name: qualify(c.modId, c.name),
        description: c.description ?? c.modName,
      }));
      return { bands, commands: options };
    },
    onDidChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    run: (command, args, sessionID) => {
      const found = source.commands().find((c) => qualify(c.modId, c.name) === command);
      if (found === undefined) {
        return Promise.reject(new Error(`command "${command}" is not available`));
      }
      return source.runCommand(found.modId, found.name, args, sessionID);
    },
    bindCompose: (next) => {
      handler = next;
    },
    setLine: (modId, line) => {
      if (line === undefined) lines.delete(modId);
      else lines.set(modId, line);
      notify();
    },
    compose: (modId, request) => {
      if (handler === undefined) {
        unbound(modId, request.text);
        return;
      }
      handler({ modId, text: request.text });
    },
  };
}
