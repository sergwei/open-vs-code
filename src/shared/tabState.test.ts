// Protects the contract of the tab state: the webview writes `sessionID` and the host reads it back
// after a Reload Window, so a garbage state must never bind a pane to a bogus session.
//
// Provenance: fabricated states; no VS Code is involved.
import { describe, expect, it } from 'vitest';
import { MAX_TAB_SESSION_ID_LENGTH, readPersistedSessionID, TAB_SESSION_FIELD } from './tabState';

describe('readPersistedSessionID', () => {
  it('reads a valid session id', () => {
    expect(readPersistedSessionID({ draft: 'x', [TAB_SESSION_FIELD]: 'ses_1' })).toBe('ses_1');
  });

  it('accepts an id of exactly the maximum length', () => {
    const id = 'a'.repeat(MAX_TAB_SESSION_ID_LENGTH);
    expect(readPersistedSessionID({ sessionID: id })).toBe(id);
  });

  it.each([
    undefined,
    null,
    'text',
    42,
    [],
    {},
    { sessionID: '' },
    { sessionID: 7 },
    { sessionID: null },
    { sessionID: { id: 'x' } },
    { session: 'ses_1' },
  ])('yields no session for %j', (raw) => {
    expect(readPersistedSessionID(raw)).toBeUndefined();
  });

  it('rejects an id longer than the maximum', () => {
    expect(
      readPersistedSessionID({ sessionID: 'a'.repeat(MAX_TAB_SESSION_ID_LENGTH + 1) }),
    ).toBeUndefined();
  });
});
