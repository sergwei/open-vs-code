// Maps opencode v2 stream events (`V2Event`) to the `ModEvent`s mods can subscribe to (E10-mods,
// plan Engram #1765 section 3.4). Pure and stateful: no `vscode`, no I/O. `ChatController.onEvent`
// feeds it every event and hands what comes out to the mods host (`createModsSink`).
//
// Why it keeps state: `session.tool.called`, `.success` and `.failed` do NOT carry the tool name;
// it only travels in `session.tool.input.started` (lesson `leccion/opencode-api/tool-called-sin-nombre`;
// types of `@opencode/client@2.0.32`). The mapper remembers `callID -> name` in a bounded FIFO
// map and gives `tool: undefined` when the opening event was lost (the stream has no replay).
//
// What it deliberately does NOT expose: text, reasoning and tool-input deltas (volume, no value for
// a hook). Mods only observe (decision P3=1): the names are `tool.called`, not "before".

import type { V2Event } from '@opencode/client';
import type { ModEvent, ModJson } from '../mods/api';
import type { ModBand, ModCommandOption } from '../shared/model';
import { toStructuredErrorInfo, type ErrorSecrets } from './wireMapping';

/**
 * How many `callID -> tool name` pairs the mapper remembers. Own choice (plan 3.4): a turn rarely
 * has more than a few dozen calls in flight; 512 outlasts any realistic gap between
 * `input.started` and the closing event while keeping memory fixed.
 */
export const TOOL_NAME_CAPACITY = 512;

/**
 * Biggest serialized tool input handed to mods, in characters. Own choice: a `write` or `edit`
 * call can carry a whole file and every mod's Worker would get a copy; bigger inputs go as `{}`
 * with `inputTruncated: true`.
 */
export const MAX_TOOL_INPUT_CHARS = 16 * 1024;

/** True when `event` is of a type some mod could see; lets the caller skip the rest cheaply. */
export function isModRelevant(type: string): boolean {
  return (
    type.startsWith('session.execution.') ||
    type.startsWith('session.tool.') ||
    type === 'permission.asked' ||
    type === 'permission.replied'
  );
}

/**
 * What `ChatController` feeds every stream event to (dependency `mods`, E10-mods phase 2). It must
 * not throw and must return at once: the controller calls it before its early `return`s.
 */
export interface ModsSink {
  event(event: V2Event, secrets: ErrorSecrets): void;
  /**
   * The chat-facing half (E10-mods, phase 3): what the mods UI shows and how the chat runs a mod's
   * command or receives its compose. Absent in the unit tests written before phase 3: then the
   * controller publishes no `mods.state` and answers `mod.command.run` as unavailable.
   */
  chat?: ModsChat;
}

/** What the chat shows of the mods: the bands and the commands, as the protocol carries them. */
export interface ModsState {
  bands: ModBand[];
  commands: ModCommandOption[];
}

/** What a mod asked the chat to compose (`station.chat.compose`). */
export interface ModComposeRequest {
  modId: string;
  text: string;
  send: boolean;
}

/**
 * The part of the mods host the chat controller talks to (E10-mods, phase 3). `state()` is the
 * WHOLE current state (the controller sends it as one replacing `mods.state`), `onDidChange` says
 * when to send it again, `run` runs a command by its qualified `<modId>:<command>` name, and
 * `bindCompose` is how the VS Code side of the chat (which knows the target pane) receives what a
 * mod composes; `undefined` unbinds it.
 */
export interface ModsChat {
  state(): ModsState;
  onDidChange(listener: () => void): { dispose(): void };
  /** Rejects when no active mod has that command, or with the mod's own failure (see `ModHost.runCommand`). */
  run(command: string, args: string, sessionID?: string): Promise<void>;
  bindCompose(handler: ((request: ModComposeRequest) => void) | undefined): void;
}

/**
 * Builds the {@link ModsSink} that maps events with one {@link ModEventMapper} and hands each
 * result to `dispatch` (the mods host). Skips the events no mod can see before touching the
 * mapper, so the high-volume deltas cost one string check. `chat` is attached as it is when given.
 * VERIFIED by `chatController.e2e.test.ts` "mods sink" cases: a whole permission turn against the
 * synthetic server (Windows 11, 02/11/2026); a real opencode is UNVERIFIED.
 */
export function createModsSink(dispatch: (event: ModEvent) => void, chat?: ModsChat): ModsSink {
  const mapper = new ModEventMapper();
  return {
    event: (event, secrets) => {
      if (!isModRelevant(event.type)) return;
      for (const mapped of mapper.map(event, secrets)) dispatch(mapped);
    },
    ...(chat === undefined ? {} : { chat }),
  };
}

/** Stateful `V2Event -> ModEvent` translator; one instance per event stream. */
export class ModEventMapper {
  private readonly toolNames = new Map<string, string>();

  /**
   * Translates one event into zero or one `ModEvent`.
   *
   * Turn events come from `session.execution.started|succeeded|failed|interrupted` (an
   * `interrupted` turn has no error; a `failed` one carries the structured error scrubbed of the
   * server URL and password by {@link toStructuredErrorInfo}, as `onEvent` does). Tool events:
   * the name is looked up by call id; `tool.finished` forgets it, since nothing else closes that
   * call. VERIFIED by `modEvents.test.ts` with fabricated events shaped after the types of
   * `@opencode/client@2.0.32` (Windows 11, 02/11/2026), and against the synthetic server's stream
   * through the real controller by `chatController.e2e.test.ts` "receives a whole permission turn
   * in order, with the tool name". UNVERIFIED: a turn of a real opencode.
   */
  map(event: V2Event, secrets: ErrorSecrets): ModEvent[] {
    switch (event.type) {
      case 'session.execution.started':
        return [{ type: 'turn.started', sessionID: event.data.sessionID }];
      case 'session.execution.succeeded':
        return [{ type: 'turn.finished', sessionID: event.data.sessionID, outcome: 'succeeded' }];
      case 'session.execution.failed':
        return [
          {
            type: 'turn.finished',
            sessionID: event.data.sessionID,
            outcome: 'failed',
            error: toStructuredErrorInfo(event.data.error, secrets),
          },
        ];
      case 'session.execution.interrupted':
        return [{ type: 'turn.finished', sessionID: event.data.sessionID, outcome: 'interrupted' }];
      case 'session.tool.input.started':
        this.remember(event.data.id, event.data.name);
        return [];
      case 'session.tool.called': {
        const { input, truncated } = clampInput(event.data.input);
        const mapped: ModEvent = {
          type: 'tool.called',
          sessionID: event.data.sessionID,
          messageID: event.data.assistantMessageID,
          callID: event.data.id,
          input,
        };
        const tool = this.toolNames.get(event.data.id);
        if (tool !== undefined) mapped.tool = tool;
        if (truncated) mapped.inputTruncated = true;
        return [mapped];
      }
      case 'session.tool.success':
        return [this.finished(event.data, 'completed')];
      case 'session.tool.failed':
        return [
          this.finished(event.data, 'error', toStructuredErrorInfo(event.data.error, secrets)),
        ];
      case 'permission.asked':
        return [
          {
            type: 'permission.asked',
            sessionID: event.data.sessionID,
            id: event.data.id,
            action: event.data.action,
            resources: [...event.data.resources],
          },
        ];
      case 'permission.replied':
        return [
          {
            type: 'permission.replied',
            sessionID: event.data.sessionID,
            id: event.data.requestID,
            reply: event.data.reply,
          },
        ];
      default:
        return [];
    }
  }

  /** Stores a name, evicting the oldest entry (FIFO, insertion order) past the capacity. */
  private remember(callID: string, name: string): void {
    this.toolNames.delete(callID);
    this.toolNames.set(callID, name);
    if (this.toolNames.size > TOOL_NAME_CAPACITY) {
      const oldest = this.toolNames.keys().next();
      if (!oldest.done) this.toolNames.delete(oldest.value);
    }
  }

  /** Builds a `tool.finished` and forgets the call's name. */
  private finished(
    data: { sessionID: string; assistantMessageID: string; id: string },
    status: 'completed' | 'error',
    error?: { code: string; message: string },
  ): ModEvent {
    const mapped: ModEvent = {
      type: 'tool.finished',
      sessionID: data.sessionID,
      messageID: data.assistantMessageID,
      callID: data.id,
      status,
    };
    const tool = this.toolNames.get(data.id);
    if (tool !== undefined) mapped.tool = tool;
    if (error !== undefined) mapped.error = error;
    this.toolNames.delete(data.id);
    return mapped;
  }
}

/** Hands the input over as JSON, or as `{}` flagged truncated when it does not serialize or is too big. */
function clampInput(input: { [key: string]: unknown }): {
  input: { [key: string]: ModJson };
  truncated: boolean;
} {
  let text: string | undefined;
  try {
    text = JSON.stringify(input);
  } catch {
    text = undefined;
  }
  if (text === undefined || text.length > MAX_TOOL_INPUT_CHARS)
    return { input: {}, truncated: true };
  return { input: JSON.parse(text) as { [key: string]: ModJson }, truncated: false };
}
