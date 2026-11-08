/**
 * What only the Quick start webview knows (issue #187): the text typed in the box and not sent. It
 * goes through the webview `getState`/`setState` so it survives the view being hidden (VS Code
 * destroys the iframe then; the view has no `retainContextWhenHidden`). The host never sees it
 * until the user sends it.
 */
import { createSignal, type Accessor } from 'solid-js';
import { MAX_HOME_TEXT } from '../../../src/shared/homeProtocol';

/** What is persisted. */
export interface PersistedHomeUi {
  draft: string;
}

/** The slice of the VS Code webview API used here; `vscodeApi` satisfies it. */
export interface HomeStateApi {
  getState(): unknown;
  setState(state: PersistedHomeUi): void;
}

/** The reactive view of the persisted state. */
export interface HomeUi {
  draft: Accessor<string>;
  setDraft(text: string): void;
}

/**
 * Reads the previous document's draft (a non-string or an oversized value is ignored: the saved
 * state is not trusted blindly) and writes every change back.
 */
export function createHomeUi(api: HomeStateApi): HomeUi {
  const saved: unknown = api.getState();
  const previous =
    typeof saved === 'object' && saved !== null ? (saved as { draft?: unknown }).draft : undefined;
  const [draft, set] = createSignal(
    typeof previous === 'string' && previous.length <= MAX_HOME_TEXT ? previous : '',
  );
  return {
    draft,
    setDraft: (text) => {
      set(text);
      api.setState({ draft: text });
    },
  };
}
