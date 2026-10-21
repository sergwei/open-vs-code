// Protects the webview's persisted state against garbage: `getState()` can return nothing, or
// the shape of another version of the extension, and the chat must still start.
//
// Provenance: fabricated states; the real `acquireVsCodeApi().getState` is not involved.
import { describe, expect, it } from 'vitest';
import { MAX_HISTORY } from './chat/promptHistory';
import { createUiState } from './uiState';

/** A fake state API holding one value; `writes` records every `setState`. */
function fakeApi(initial: unknown) {
  const writes: unknown[] = [];
  return {
    writes,
    api: {
      getState: () => initial,
      setState: (state: unknown) => {
        writes.push(state);
      },
    },
  };
}

describe('createUiState', () => {
  it('restores a valid state', () => {
    const { api } = fakeApi({ draft: 'hello', history: ['a', 'b'] });
    expect(createUiState(api)).toMatchObject({ draft: 'hello', history: ['a', 'b'] });
  });

  it.each([undefined, null, 'text', 42, [], { draft: 1, history: 'x' }, { history: {} }])(
    'falls back to the defaults for %j',
    (garbage) => {
      const state = createUiState(fakeApi(garbage).api);
      expect(state.draft).toBe('');
      expect(state.history).toEqual([]);
      expect(state.files).toEqual([]);
    },
  );

  it('keeps the valid half of a partly valid state and drops non-string history items', () => {
    const state = createUiState(fakeApi({ draft: 'ok', history: ['a', 3, null, 'b'] }).api);
    expect(state).toMatchObject({ draft: 'ok', history: ['a', 'b'] });
    expect(createUiState(fakeApi({ draft: 7, history: ['a'] }).api)).toMatchObject({
      draft: '',
      history: ['a'],
    });
  });

  it('cuts an oversized history to the newest entries', () => {
    const history = Array.from({ length: MAX_HISTORY + 5 }, (_, index) => `p${String(index)}`);
    const state = createUiState(fakeApi({ draft: '', history }).api);
    expect(state.history).toHaveLength(MAX_HISTORY);
    expect(state.history[0]).toBe('p5');
  });

  it('restores valid pending attachments and drops malformed ones', () => {
    const good = { uri: 'file:///a.ts', name: 'a.ts' };
    const state = createUiState(
      fakeApi({ draft: '', history: [], files: [good, { uri: 1 }, null, { uri: '', name: 'x' }] })
        .api,
    );
    expect(state.files).toEqual([good]);
  });

  it('writes through setState', () => {
    const { api, writes } = fakeApi(undefined);
    createUiState(api).save({ draft: 'd', history: ['h'], files: [] });
    expect(writes).toEqual([{ draft: 'd', history: ['h'], files: [] }]);
  });
});
