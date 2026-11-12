// Protects the rule both model lists share (issue #223, review C1/S3): the compact token count, the
// one-line detail of a model and the provider order. Provenance: FABRICATED catalogs, no server and
// no VS Code; the chat's own `selection.test.ts` and the picker's `homeModelPick.test.ts` pin the
// translated wording on each side.
import { describe, expect, it } from 'vitest';
import type { Catalog, ModelOption } from './model';
import { compactTokens, modelMetaText, orderedProviders } from './modelText';

const model = (providerID: string, extra: Partial<ModelOption> = {}): ModelOption => ({
  providerID,
  id: 'm',
  name: 'M',
  status: 'active',
  contextLimit: 200_000,
  free: false,
  variants: [],
  images: false,
  ...extra,
});

describe('modelText', () => {
  it('compactTokens rounds down to K and M', () => {
    expect(compactTokens(512)).toBe('512');
    expect(compactTokens(1_999)).toBe('1K');
    expect(compactTokens(200_000)).toBe('200K');
    expect(compactTokens(2_500_000)).toBe('2M');
  });

  it('modelMeta joins Free, context and the status only when not active', () => {
    const context = (tokens: string): string => `${tokens} ctx`;
    expect(modelMetaText(model('p', { free: true }), 'Free', context)).toBe('Free · 200K ctx');
    expect(modelMetaText(model('p', { status: 'beta' }), 'Free', context)).toBe('200K ctx · beta');
  });

  it('orders the listed providers first and the orphans by id', () => {
    const catalog: Catalog = {
      models: [model('zed'), model('acme'), model('listed')],
      providers: [{ id: 'listed', name: 'Listed' }],
      agents: [],
    };
    expect(orderedProviders(catalog)).toEqual([
      { id: 'listed', name: 'Listed' },
      { id: 'acme', name: 'acme' },
      { id: 'zed', name: 'zed' },
    ]);
  });
});
