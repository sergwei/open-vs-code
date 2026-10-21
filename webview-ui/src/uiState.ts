/**
 * The webview's own persistent state (issue #13): the draft being typed (`draft`), the prompt
 * history (`history`) and the attachments chosen but not sent (`files`), kept with the webview
 * `getState`/`setState` so they survive the view being hidden (VS Code destroys the iframe then).
 * The host never sees them.
 */
import type { AttachmentRef } from '../../src/shared/protocol';
import { MAX_HISTORY } from './chat/promptHistory';

/** Most attachments kept. Our own cap, so a corrupt state cannot create hundreds of chips. */
const MAX_FILES = 20;

/** True for `{ uri: string, name: string }` with both non-empty (the protocol's `AttachmentRef`). */
function isAttachmentRef(value: unknown): value is AttachmentRef {
  if (typeof value !== 'object' || value === null) return false;
  const { uri, name } = value as { uri?: unknown; name?: unknown };
  return typeof uri === 'string' && uri !== '' && typeof name === 'string' && name !== '';
}

/** What is persisted. */
export interface PersistedUi {
  draft: string;
  history: string[];
  files: AttachmentRef[];
}

/** The slice of the VS Code webview API this module uses; `vscodeApi` satisfies it. */
export interface StateApi {
  getState(): unknown;
  setState(state: PersistedUi): void;
}

/** What {@link createUiState} returns: the restored values and a writer. */
export interface UiState extends PersistedUi {
  /** Persists `next` right away (no debounce: see {@link createUiState}). */
  save(next: PersistedUi): void;
}

/**
 * Reads the saved state, validating it, and returns it with a `save` function.
 *
 * `getState` may return anything: nothing at all on the first load, or the shape of another
 * version of this extension. A value that is not `{ draft: string, history: string[] }` yields
 * the defaults for the broken part; non-string history items are dropped and the list is cut to
 * the newest {@link MAX_HISTORY}; pending attachments that are not `{ uri, name }` are dropped
 * (at most 20 kept). `save` writes on every call: one small message per keystroke.
 * That cost was NOT measured (HYPOTHESIS: negligible at typing speed); if it shows up, debounce
 * with a flush on `pagehide`, which is not guaranteed to fire when VS Code destroys the iframe.
 * VERIFIED by `uiState.test.ts` with fabricated states; real persistence across hide/show is
 * UNVERIFIED until the F5.
 */
export function createUiState(api: StateApi): UiState {
  const raw: unknown = api.getState();
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const draft = typeof record.draft === 'string' ? record.draft : '';
  const history = Array.isArray(record.history)
    ? record.history.filter((item): item is string => typeof item === 'string').slice(-MAX_HISTORY)
    : [];
  const files = Array.isArray(record.files)
    ? record.files.filter(isAttachmentRef).slice(0, MAX_FILES)
    : [];
  return {
    draft,
    history,
    files,
    save(next) {
      api.setState({
        draft: next.draft,
        history: next.history.slice(-MAX_HISTORY),
        files: next.files.slice(0, MAX_FILES),
      });
    },
  };
}
