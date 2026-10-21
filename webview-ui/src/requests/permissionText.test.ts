// Protects the wording of permission cards (issue #18): the action a person reads, the
// "N more" folding of long resource lists, and above all the detection of an "Always" that would
// store a broad rule (`*` or `dir/*`), because that warning is the only thing between the user and a
// rule that silently allows reading `.env`.
//
// Provenance: FABRICATED inputs. `read` with `save: ["*"]` mirrors what `file-access.ts@v2.0.32`
// was READ to send; it was not captured from a running server.
import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  describeRequest,
  describeSave,
  MAX_RESOURCES_SHOWN,
  outcomeLabel,
  previewResources,
} from './permissionText';

describe('actionLabel', () => {
  it.each([
    ['read', 'Read'],
    ['edit', 'Edit'],
    ['write', 'Edit'],
    ['shell', 'Run command'],
    ['external_directory', 'Access outside the folder'],
    ['webfetch', 'Fetch URL'],
    ['websearch', 'Search the web'],
    ['question', 'Ask you questions'],
  ])('words %s as "%s"', (action, label) => {
    expect(actionLabel(action)).toBe(label);
  });

  it('returns an unknown action as the server named it, even a prototype key', () => {
    expect(actionLabel('lsp')).toBe('lsp');
    expect(actionLabel('toString')).toBe('toString');
    expect(actionLabel('__proto__')).toBe('__proto__');
  });
});

describe('previewResources', () => {
  it('lists up to five and counts the rest', () => {
    const resources = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(previewResources(resources)).toEqual({ shown: ['a', 'b', 'c', 'd', 'e'], more: 2 });
    expect(MAX_RESOURCES_SHOWN).toBe(5);
  });

  it('shows everything when it fits and handles an empty list', () => {
    expect(previewResources(['a', 'b'])).toEqual({ shown: ['a', 'b'], more: 0 });
    expect(previewResources([])).toEqual({ shown: [], more: 0 });
    expect(previewResources(['a', 'b', 'c'], 2)).toEqual({ shown: ['a', 'b'], more: 1 });
  });
});

describe('describeSave', () => {
  it('flags a bare wildcard as broad (the read of .env)', () => {
    expect(describeSave(['*'], 'read')).toEqual({ rules: ['Read: *'], broad: true });
  });

  it('flags a whole-directory rule as broad, and a specific path as not', () => {
    expect(describeSave(['/home/me/other/*'], 'external_directory').broad).toBe(true);
    expect(describeSave(['src/a.ts'], 'edit').broad).toBe(false);
    expect(describeSave(['*.env'], 'read').broad).toBe(false);
  });

  it('is broad when any rule is, and lists every rule', () => {
    const result = describeSave(['src/a.ts', 'lib/*'], 'edit');
    expect(result.rules).toEqual(['Edit: src/a.ts', 'Edit: lib/*']);
    expect(result.broad).toBe(true);
  });

  it('an empty save list stores nothing and is not broad', () => {
    expect(describeSave([], 'read')).toEqual({ rules: [], broad: false });
  });
});

describe('outcomeLabel and describeRequest', () => {
  it('words the three decisions', () => {
    expect(outcomeLabel('once')).toBe('Allowed once');
    expect(outcomeLabel('always')).toBe('Always allowed');
    expect(outcomeLabel('reject')).toBe('Rejected');
  });

  it('describes a request by its action and first resource', () => {
    expect(describeRequest({ action: 'read', resources: ['.env', 'x'] })).toBe('Read .env');
    expect(describeRequest({ action: 'shell', resources: [] })).toBe('Run command');
  });
});
