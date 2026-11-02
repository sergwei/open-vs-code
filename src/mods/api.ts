// Public API v1 of OpenCode Station mods (E10-mods, plan Engram #1765, decisions #1768).
//
// This file is both the contract the host implements and the type declarations mod authors copy
// (`// @ts-check` + JSDoc against it). It is TYPES ONLY: no `vscode`, no `@opencode/client`, no
// Node. A mod receives a `StationModApi` and nothing else: never the server URL, the password or
// the opencode client (architecture rule 1). Mods only OBSERVE the session: blocking or changing a
// tool call is a server plugin of opencode (`tool.hook("execute.before")`), not something a
// client can do (decision P3=1).
//
// Not a sandbox: a mod runs in its own `worker_threads.Worker` with full Node and the user's
// permissions. The API limits what is STABLE, not what is possible (plan section 3.2).

/** A resource the mod must release; returned by every registration. */
export interface Disposable {
  dispose(): void;
}

/** Severity of a status band entry or a toast. */
export type ModSeverity = 'info' | 'warning' | 'error';

/** Why a turn ended. `interrupted` covers Stop, shutdown, superseded and inactivity. */
export type TurnOutcome = 'succeeded' | 'failed' | 'interrupted';

/** An error as mods see it: the code of the structured error and a message already scrubbed of secrets. */
export interface ModError {
  code: string;
  message: string;
}

/** JSON-compatible value (what a Worker message can carry for the tool input). */
export type ModJson = string | number | boolean | null | ModJson[] | { [key: string]: ModJson };

/**
 * Events a mod can subscribe to, derived from the opencode event stream. Deltas, text and
 * reasoning are NOT exposed. There is no replay: a mod that was down misses what happened.
 * `tool` is `undefined` when the stream did not show the call being opened (the name only
 * travels in `session.tool.input.started`). Sub-agent sessions arrive with their own `sessionID`.
 */
export type ModEvent =
  | { type: 'turn.started'; sessionID: string }
  | { type: 'turn.finished'; sessionID: string; outcome: TurnOutcome; error?: ModError }
  | {
      type: 'tool.called';
      sessionID: string;
      messageID: string;
      callID: string;
      tool?: string;
      /** Empty and `inputTruncated` when the input was too large to hand over. */
      input: { [key: string]: ModJson };
      inputTruncated?: boolean;
    }
  | {
      type: 'tool.finished';
      sessionID: string;
      messageID: string;
      callID: string;
      tool?: string;
      status: 'completed' | 'error';
      error?: ModError;
    }
  | {
      type: 'permission.asked';
      sessionID: string;
      id: string;
      action: string;
      resources: string[];
    }
  | {
      type: 'permission.replied';
      sessionID: string;
      id: string;
      reply: 'once' | 'always' | 'reject';
    };

/** The `type` strings of {@link ModEvent}. */
export type ModEventType = ModEvent['type'];

/** Narrows {@link ModEvent} to the member whose `type` is `T`. */
export type ModEventOf<T extends ModEventType> = Extract<ModEvent, { type: T }>;

/** What `station.mod` says about the running mod. */
export interface ModInfo {
  id: string;
  name: string;
  version: string;
}

/** What a mod command receives when it runs. */
export interface CommandContext {
  /** The session the chat had in front when the command was launched, if any. */
  sessionID?: string;
  /** Text typed after the command name; empty when there was none. */
  args: string;
}

/** A client-side action a mod adds to the `/` menu and the command palette. */
export interface ModCommand {
  /** `^[a-z0-9][a-z0-9-]{0,47}$`; shown to users as `<modId>:<name>`. */
  name: string;
  description?: string;
  run(context: CommandContext): void | Promise<void>;
}

/** One line of text the mod pins above the chat composer (plain text, never HTML). */
export interface StatusOptions {
  /** At most 120 characters. */
  text: string;
  /** At most 500 characters. */
  tooltip?: string;
  severity?: ModSeverity;
  /** Name of a command of THIS mod that a button on the band runs. */
  command?: string;
}

/** A native notification. */
export interface ToastOptions {
  /** At most 500 characters. */
  message: string;
  severity?: ModSeverity;
  /** Up to 3 button labels; the promise resolves with the one that was pressed. */
  actions?: string[];
}

/**
 * A panel that opens in its own editor tab beside the chat. The paths are relative to the mod
 * folder (no `..`, no absolute path) and can only name files inside it. The panel is a web page with
 * its own scripts but no network: its CSP has no `connect-src`, and inline scripts and styles are
 * blocked (put them in `scripts` and `styles`). It talks to the mod only through
 * {@link ModPanel.postMessage} and {@link ModPanel.onMessage}. Colours come from the
 * `--vscode-*` CSS variables, which every VS Code webview has.
 */
export interface PanelOptions {
  /** At most 80 characters; the tab title. */
  title: string;
  /** The `.html` file whose markup goes inside the page `<body>`. */
  html: string;
  /** Up to 16 `.js` / `.mjs` files, loaded in order as classic scripts. */
  scripts?: string[];
  /** Up to 16 `.css` files. */
  styles?: string[];
}

/** The handle `station.ui.panel.open` returns. At most 3 panels per mod can be open. */
export interface ModPanel {
  /** Sends JSON to the page (its `window` receives a `message` event); at most 1 MB once serialized. */
  postMessage(data: ModJson): void;
  /** Called with each JSON value the page sends with `vscode.postMessage`. */
  onMessage(handler: (data: ModJson) => void): Disposable;
  /** Called once when the panel closes, whether the user closed the tab or the mod did. */
  onDidClose(handler: () => void): Disposable;
  /** Closes the tab. Calling it on a closed panel does nothing. */
  dispose(): void;
}

/** Text for the chat composer. */
export interface ComposeOptions {
  text: string;
  /** Send it instead of only filling the composer. */
  send?: boolean;
}

/** Everything a mod receives in `activate(station)`. */
export interface StationModApi {
  /** Always `1` in this version. */
  readonly apiVersion: 1;
  readonly mod: Readonly<ModInfo>;
  readonly log: {
    info(text: string): void;
    warn(text: string): void;
    error(text: string): void;
  };
  readonly events: {
    on<T extends ModEventType>(
      type: T,
      handler: (event: ModEventOf<T>) => void | Promise<void>,
    ): Disposable;
  };
  readonly commands: {
    register(command: ModCommand): Disposable;
  };
  readonly ui: {
    readonly status: {
      set(options: StatusOptions): void;
      clear(): void;
    };
    toast(options: ToastOptions): Promise<string | undefined>;
    readonly panel: {
      /** Throws when the options break a limit or the mod already has 3 panels open. */
      open(options: PanelOptions): ModPanel;
    };
  };
  readonly chat: {
    compose(options: ComposeOptions): void;
  };
}

/** The shape of a mod entry file: `export function activate(station)`, optional `deactivate()`. */
export interface ModModule {
  /** May return a cleanup function (or a promise of one). */
  activate(station: StationModApi): void | (() => void) | Promise<void | (() => void)>;
  deactivate?(): void | Promise<void>;
}
