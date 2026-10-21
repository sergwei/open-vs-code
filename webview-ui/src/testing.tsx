/**
 * Helpers shared by the component tests (jsdom + Solid). Not part of the bundle: only
 * `*.test.tsx` files import it.
 */
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import type { WebviewToHost } from '../../src/shared/protocol';
import { HostContext } from './chat/hostContext';

/** A mounted component: its container, the messages it sent to the "host", and how to unmount. */
export interface Mounted {
  container: HTMLElement;
  sent: WebviewToHost[];
  dispose(): void;
}

/**
 * Renders `view` inside a `HostContext` whose sender records into `sent`.
 *
 * Remember lesson #906 of the project: Solid effects run when the root's callback returns, so a
 * test that changes state must do it AFTER `mount` has returned, never inside the `view`
 * function.
 */
export function mount(view: () => JSX.Element): Mounted {
  const sent: WebviewToHost[] = [];
  const container = document.createElement('div');
  document.body.append(container);
  const dispose = render(
    () => (
      <HostContext.Provider
        value={(message) => {
          sent.push(message);
        }}
      >
        {view()}
      </HostContext.Provider>
    ),
    container,
  );
  return {
    container,
    sent,
    dispose() {
      dispose();
      container.remove();
    },
  };
}

/**
 * Splits the `requestId` off a message the component sent, so the rest can be compared EXACTLY
 * with `toEqual` (the id is unique per run). Throws when nothing was sent or the message has no id.
 */
export function splitRequestId(message: WebviewToHost | undefined): {
  requestId: string;
  rest: Record<string, unknown>;
} {
  if (message === undefined) throw new Error('nothing was sent');
  const { requestId, ...rest } = message as WebviewToHost & { requestId?: unknown };
  if (typeof requestId !== 'string') throw new Error(`${message.type} carries no requestId`);
  return { requestId, rest };
}

/** The first element matching `selector`, or a failure with a readable message. */
export function must<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`no element matches ${selector}`);
  return element;
}
