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

  // Protects the Reload Window restore (issue #77): the shown session must round-trip through
  // setState/getState, and a state saved before the field existed must yield no session.
  it('saves the shown session and reads it back; an old state has none', () => {
    const { api, writes } = fakeApi({ draft: 'd', history: [] });
    const first = createUiState(api);
    expect(first.sessionID).toBeUndefined();
    first.save({ draft: '', history: [], files: [], sessionID: 'ses_9' });
    expect(writes[0]).toMatchObject({ sessionID: 'ses_9' });
    expect(createUiState(fakeApi(writes[0]).api).sessionID).toBe('ses_9');
    first.save({ draft: '', history: [], files: [] });
    expect(writes[1]).not.toHaveProperty('sessionID');
    expect(
      createUiState(fakeApi({ draft: '', history: [], sessionID: 5 }).api).sessionID,
    ).toBeUndefined();
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

  // Issues #23/#24. Fabricated states: they pin the validation, not what VS Code stores.
  it('restores a valid model/agent selection', () => {
    const selection = {
      sessionID: 'ses_1',
      model: { providerID: 'opencode', id: 'big-pickle', variant: 'low' },
      agent: 'plan',
    };
    expect(createUiState(fakeApi({ selection }).api).selection).toEqual(selection);
  });

  it.each([
    ['no selection at all', {}],
    ['a selection that is not an object', { selection: 'plan' }],
    ['a null selection', { selection: null }],
    ['an array', { selection: [] }],
  ])('restores an empty selection for %s', (_name, saved) => {
    expect(createUiState(fakeApi(saved).api).selection).toEqual({});
  });

  it('keeps only the well-formed parts of a selection', () => {
    const state = createUiState(
      fakeApi({
        selection: { sessionID: '', model: { providerID: 'p' }, agent: 7 },
      }).api,
    );
    expect(state.selection).toEqual({});
    const partly = createUiState(
      fakeApi({
        selection: {
          sessionID: 'ses_1',
          model: { providerID: 'p', id: 'm', variant: '' },
          agent: 'plan',
        },
      }).api,
    );
    expect(partly.selection).toEqual({ sessionID: 'ses_1', agent: 'plan' });
  });

  it('writes the selection when given one', () => {
    const { api, writes } = fakeApi(undefined);
    createUiState(api).save({
      draft: '',
      history: [],
      files: [],
      selection: { sessionID: 'ses_1', agent: 'plan' },
    });
    expect(writes).toEqual([
      { draft: '', history: [], files: [], selection: { sessionID: 'ses_1', agent: 'plan' } },
    ]);
  });
});
