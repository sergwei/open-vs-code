// Test support (E9-chat-editor-tabs, phase 1): lets the controller tests written when the host had
// ONE webview keep their calls and assertions unchanged. Only tests import it; production code
// attaches its panes itself (`chatLifecycle.ts`).

import type { HostToWebview, UiCommand, WebviewToHost } from '../../shared/protocol';
import type { ChatController, FocusTarget } from '../chatController';
import type { ChatPane, PaneSurface } from '../chatPane';

/**
 * The controller as the old tests see it: `handle(message)`, `onWebviewReady()`, `runUiCommand`,
 * `focusRequest` and `addToChat` without a pane id, every other member as it is.
 */
export type OnePaneController = Omit<
  ChatController,
  'handle' | 'runUiCommand' | 'focusRequest' | 'addToChat' | 'onPaneReady'
> & {
  handle(message: WebviewToHost): Promise<void>;
  onWebviewReady(): Promise<void>;
  runUiCommand(command: UiCommand): void;
  focusRequest(target: FocusTarget): void;
  addToChat(uris: readonly string[]): Promise<void>;
  /** The pane the facade talks to. */
  readonly pane: ChatPane;
};

/**
 * Attaches ONE pane to `controller` and returns a view of the controller that talks to it.
 *
 * Why a Proxy and not a subclass: the tests call dozens of members, and most pass straight through;
 * only the five that now take a pane id are wrapped. Methods are bound to the real controller, so
 * its private state is never written through the proxy. Call it BEFORE `onServerState`, as the
 * real wiring does, so the pane exists when the first snapshot goes out.
 * Provenance: it carries no logic of its own, so what the pre-existing controller battery proves
 * through it (the same calls and assertions as before the split) proves the single-pane behaviour
 * did not change; it proves nothing about two panes (`chatController.panes.test.ts` does).
 */
export function onePane(
  controller: ChatController,
  surface: PaneSurface | Sender,
): OnePaneController {
  const pane = controller.attachPane(typeof surface === 'function' ? { post: surface } : surface);
  const overrides = {
    handle: (message: WebviewToHost) => controller.handle(pane.id, message),
    onWebviewReady: () => controller.onPaneReady(pane.id),
    runUiCommand: (command: UiCommand) => {
      controller.runUiCommand(pane.id, command);
    },
    focusRequest: (target: FocusTarget) => {
      controller.focusRequest(pane.id, target);
    },
    addToChat: (uris: readonly string[]) => controller.addToChat(pane.id, uris),
    pane,
  };
  return new Proxy(controller, {
    get(target, property) {
      if (property in overrides) return overrides[property as keyof typeof overrides];
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  }) as unknown as OnePaneController;
}

/** A plain poster, the shorthand the tests use for "the webview". */
type Sender = (message: HostToWebview) => void;
