/**
 * Helpers shared by the component tests (jsdom + Solid). Not part of the bundle: only
 * `*.test.tsx` files import it.
 */
import * as l10n from '@vscode/l10n';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import spanishRaw from '../../l10n/bundle.l10n.es.json?raw';
import { setLocale, type L10nBundle } from '../../src/shared/l10n';
import type { WebviewToHost } from '../../src/shared/protocol';
import { HostContext } from './chat/hostContext';

/** The shipped Spanish catalog, parsed once from the file (not a copy of it written in a test). */
const SPANISH = JSON.parse(spanishRaw) as L10nBundle;

/**
 * Switches the webview texts to Spanish: the shipped `l10n/bundle.l10n.es.json` for `l10n.t` and
 * `es` for `plural` and the date formatters, the way `l10nBoot.ts` does at start-up.
 * Pair it with {@link useEnglish} in an `afterEach`, or the catalog leaks into the other tests of
 * the file. Mount components AFTER calling it: Solid reads the text once, when it renders.
 * VERIFIED by the checks "reads its labels, placeholder and live-region counts from the shipped
 * Spanish catalog" of `PromptInput.test.tsx`, "shows the group titles and the row times in
 * Spanish" of `SessionPicker.test.tsx` and "writes the steps, lines and actions of the guide in
 * Spanish" of `connectionView.test.ts`, which read real Spanish text through it.
 */
export function useSpanish(): void {
  l10n.config({ contents: SPANISH });
  setLocale('es');
}

/** Back to the English default: no catalog (the message is its own text) and `en` as the locale. */
export function useEnglish(): void {
  l10n.config({ contents: {} });
  setLocale('en');
}

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
