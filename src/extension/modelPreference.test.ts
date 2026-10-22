/**
 * Unit tests for the precedence of the model a new session proposes (issue #23).
 *
 * Protects against: a setting that wins when it is not in the catalog (it would pin every new
 * session to a model that fails its first turn), a last-used model resurrected after it left the
 * catalog, the precedence setting > last used > server default drifting (decision of Sergio,
 * 21/10/2026, Engram #1012), a model id with a slash being cut in the wrong place, and (issue #61)
 * a remembered reasoning variant that the catalog no longer lists, or one carried to another model.
 *
 * ALL DATA IS FABRICATED. The tests prove OUR rules; the catalog shape they are checked against
 * was seen in a real opencode 2.0.32 (planner spike, Windows 11, 21/10/2026).
 */
import { describe, expect, it } from 'vitest';
import { isAvailable, parseModelSetting, resolvePreferredModel } from './modelPreference';

const available = [
  { providerID: 'opencode', id: 'big-pickle', variants: [] as string[] },
  { providerID: 'opencode', id: 'glm-5.3-flash-free', variants: ['low', 'high'] },
  { providerID: 'openrouter', id: 'anthropic/claude', variants: [] as string[] },
];

describe('parseModelSetting', () => {
  it('reads provider/model, trimmed', () => {
    expect(parseModelSetting('opencode/big-pickle')).toEqual({
      kind: 'model',
      model: { providerID: 'opencode', id: 'big-pickle' },
    });
    expect(parseModelSetting('  opencode/big-pickle \n')).toEqual({
      kind: 'model',
      model: { providerID: 'opencode', id: 'big-pickle' },
    });
  });

  it('cuts at the first slash so an id with a slash survives', () => {
    expect(parseModelSetting('a/b/c')).toEqual({
      kind: 'model',
      model: { providerID: 'a', id: 'b/c' },
    });
  });

  it('treats blank as no setting', () => {
    expect(parseModelSetting('')).toEqual({ kind: 'none' });
    expect(parseModelSetting('   ')).toEqual({ kind: 'none' });
  });

  it.each(['nope', '/x', 'x/', 'a b/c', 'a/b c', '/'])('rejects %j', (text) => {
    expect(parseModelSetting(text)).toEqual({ kind: 'invalid' });
  });
});

describe('isAvailable', () => {
  it('matches provider and id and ignores the variant', () => {
    expect(
      isAvailable({ providerID: 'opencode', id: 'big-pickle', variant: 'high' }, available),
    ).toBe(true);
    expect(isAvailable({ providerID: 'other', id: 'big-pickle' }, available)).toBe(false);
    expect(isAvailable({ providerID: 'opencode', id: 'nope' }, available)).toBe(false);
  });
});

describe('resolvePreferredModel', () => {
  const last = { providerID: 'opencode', id: 'glm-5.3-flash-free', variant: 'low' };

  it('the setting wins over the last used one', () => {
    expect(resolvePreferredModel({ setting: 'opencode/big-pickle', last, available })).toEqual({
      model: { providerID: 'opencode', id: 'big-pickle' },
    });
  });

  // Issue #61 (decision of Sergio, 22/10/2026, Engram #1021): the variant travels with the last
  // model.
  it('with no setting the last used one applies, with its variant while the catalog lists it', () => {
    expect(resolvePreferredModel({ setting: '', last, available })).toEqual({
      model: { providerID: 'opencode', id: 'glm-5.3-flash-free', variant: 'low' },
    });
    expect(resolvePreferredModel({ setting: undefined, last, available })).toEqual({
      model: { providerID: 'opencode', id: 'glm-5.3-flash-free', variant: 'low' },
    });
  });

  it('the last used variant is dropped when the catalog no longer lists it', () => {
    expect(
      resolvePreferredModel({ setting: '', last: { ...last, variant: 'ultra' }, available }),
    ).toEqual({ model: { providerID: 'opencode', id: 'glm-5.3-flash-free' } });
  });

  it('a setting naming the same model as the last one inherits its variant', () => {
    expect(
      resolvePreferredModel({ setting: 'opencode/glm-5.3-flash-free', last, available }),
    ).toEqual({ model: { providerID: 'opencode', id: 'glm-5.3-flash-free', variant: 'low' } });
  });

  it('a setting naming another model gets no variant (ids are never carried across models)', () => {
    expect(resolvePreferredModel({ setting: 'opencode/big-pickle', last, available })).toEqual({
      model: { providerID: 'opencode', id: 'big-pickle' },
    });
  });

  it('with neither there is no preference (the server default applies)', () => {
    expect(resolvePreferredModel({ setting: '', last: undefined, available })).toEqual({});
  });

  it('an unavailable setting is reported and the last used one applies', () => {
    expect(resolvePreferredModel({ setting: 'opencode/gone', last, available })).toEqual({
      model: { providerID: 'opencode', id: 'glm-5.3-flash-free', variant: 'low' },
      ignored: { value: 'opencode/gone', reason: 'unavailable' },
    });
  });

  it('a badly written setting is reported and the last used one applies', () => {
    expect(resolvePreferredModel({ setting: 'nope', last, available })).toEqual({
      model: { providerID: 'opencode', id: 'glm-5.3-flash-free', variant: 'low' },
      ignored: { value: 'nope', reason: 'invalid' },
    });
  });

  it('an unavailable setting and an unavailable last used one leave nothing, with the report', () => {
    expect(
      resolvePreferredModel({
        setting: 'opencode/gone',
        last: { providerID: 'opencode', id: 'also-gone' },
        available,
      }),
    ).toEqual({ ignored: { value: 'opencode/gone', reason: 'unavailable' } });
  });

  it('a last used model that left the catalog is skipped without a report', () => {
    expect(
      resolvePreferredModel({
        setting: '',
        last: { providerID: 'opencode', id: 'also-gone' },
        available,
      }),
    ).toEqual({});
  });

  it('the setting finds a model whose id has a slash', () => {
    expect(
      resolvePreferredModel({ setting: 'openrouter/anthropic/claude', last: undefined, available }),
    ).toEqual({ model: { providerID: 'openrouter', id: 'anthropic/claude' } });
  });
});
