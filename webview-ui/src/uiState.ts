/**
 * The webview's own persistent state (issue #13): the draft being typed (`draft`), the prompt
 * history (`history`), the attachments chosen but not sent (`files`) and, since issues #23/#24, the
 * model/agent picked but not sent (`selection`), kept with the webview `getState`/`setState` so
 * they survive the view being hidden (VS Code destroys the iframe then). The host never sees them.
 */
import type { ModelRef } from '../../src/shared/model';
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

/**
 * The model/agent draft (issues #23/#24) as persisted: the session it belongs to (absent for a
 * session not created yet) and the unsent picks. Each field may be absent.
 */
export interface PersistedSelection {
  sessionID?: string;
  model?: ModelRef;
  agent?: string;
}

/** What is persisted. */
export interface PersistedUi {
  draft: string;
  history: string[];
  files: AttachmentRef[];
  selection?: PersistedSelection;
}

/** True for a non-empty string. */
function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * Reads a persisted selection, keeping only the parts that are well formed: ids must be non-empty
 * strings and the model needs both `providerID` and `id` (a `variant` must be non-empty too).
 * Anything else yields an empty selection. The state comes from `getState`, which may hold the
 * shape of another version of this extension.
 */
function readSelection(raw: unknown): PersistedSelection {
  if (typeof raw !== 'object' || raw === null) return {};
  const record = raw as Record<string, unknown>;
  const selection: PersistedSelection = {};
  if (isFilled(record.sessionID)) selection.sessionID = record.sessionID;
  if (isFilled(record.agent)) selection.agent = record.agent;
  const model = record.model;
  if (typeof model === 'object' && model !== null) {
    const { providerID, id, variant } = model as Record<string, unknown>;
    if (isFilled(providerID) && isFilled(id) && (variant === undefined || isFilled(variant))) {
      selection.model = { providerID, id, ...(variant === undefined ? {} : { variant }) };
    }
  }
  return selection;
}

/** The slice of the VS Code webview API this module uses; `vscodeApi` satisfies it. */
export interface StateApi {
  getState(): unknown;
  setState(state: PersistedUi): void;
}

/** What {@link createUiState} returns: the restored values and a writer. */
export interface UiState extends PersistedUi {
  /** The restored model/agent draft; empty when nothing valid was saved. */
  selection: PersistedSelection;
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
 * (at most 20 kept); the selection keeps only its well-formed parts ({@link readSelection}). `save` writes on every call: one small message per keystroke.
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
  const selection = readSelection(record.selection);
  return {
    draft,
    history,
    files,
    selection,
    save(next) {
      api.setState({
        draft: next.draft,
        history: next.history.slice(-MAX_HISTORY),
        files: next.files.slice(0, MAX_FILES),
        ...(next.selection === undefined ? {} : { selection: next.selection }),
      });
    },
  };
}
