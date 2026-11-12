// Protects the list of the Quick start model picker (issue #223): models grouped by provider in the
// catalog's order, the current one marked, `default` on the default, a server name unable to inject a
// codicon, and the preferred model's reasoning variant kept when the user picks it again.
// Provenance: FABRICATED catalogs (no server, no VS Code); how the real QuickPick looks is step 50 of
// `test:visual`.
import { describe, expect, it } from 'vitest';
import type { Catalog, ModelOption } from '../shared/model';
import { homeModelItems, pickedRef } from './homeModelPick';

const model = (providerID: string, id: string, name: string, extra: Partial<ModelOption> = {}) => ({
  providerID,
  id,
  name,
  status: 'active' as const,
  contextLimit: 200_000,
  free: false,
  variants: [],
  images: false,
  ...extra,
});

const catalog = (extra: Partial<Catalog> = {}): Catalog => ({
  models: [
    model('opencode', 'big', 'Big Pickle', { free: true }),
    model('acme', 'one', 'Acme One', { status: 'beta', contextLimit: 1_000_000 }),
    model('opencode', 'glm', 'GLM Free', { free: true }),
  ],
  providers: [
    { id: 'opencode', name: 'OpenCode' },
    { id: 'acme', name: 'Acme' },
  ],
  agents: [],
  ...extra,
});

describe('homeModelItems', () => {
  it('groups the models by provider, marks the current one and says default on the default', () => {
    const items = homeModelItems(
      catalog({ serverDefault: { providerID: 'opencode', id: 'big' } }),
      { providerID: 'acme', id: 'one' },
    );
    expect(items).toEqual([
      { kind: 'separator', label: 'OpenCode' },
      {
        kind: 'model',
        label: 'Big Pickle',
        description: 'Free · 200K context · default',
        ref: { providerID: 'opencode', id: 'big' },
      },
      {
        kind: 'model',
        label: 'GLM Free',
        description: 'Free · 200K context',
        ref: { providerID: 'opencode', id: 'glm' },
      },
      { kind: 'separator', label: 'Acme' },
      {
        kind: 'model',
        label: '$(check) Acme One',
        description: '1M context · beta',
        ref: { providerID: 'acme', id: 'one' },
      },
    ]);
  });

  it('marks the default when nothing was chosen, preferring the host preferred model', () => {
    const items = homeModelItems(
      catalog({
        serverDefault: { providerID: 'opencode', id: 'big' },
        preferredModel: { providerID: 'opencode', id: 'glm' },
      }),
      undefined,
    );
    const labels = items.flatMap((item) => (item.kind === 'model' ? [item.label] : []));
    expect(labels).toEqual(['Big Pickle', '$(check) GLM Free', 'Acme One']);
  });

  it('shows a provider without a name by its id, and strips $( from server names', () => {
    const items = homeModelItems(
      catalog({
        providers: [],
        models: [model('mystery', 'x', 'Evil $(trash) Name')],
      }),
      undefined,
    );
    expect(items[0]).toEqual({ kind: 'separator', label: 'mystery' });
    expect(items[1]).toMatchObject({ label: 'Evil trash) Name' });
  });

  it('gives no rows for an empty catalog', () => {
    expect(homeModelItems(catalog({ models: [], providers: [] }), undefined)).toEqual([]);
  });
});

describe('pickedRef', () => {
  it('keeps the variant of the preferred model and gives none to another', () => {
    const withVariant = catalog({
      preferredModel: { providerID: 'opencode', id: 'big', variant: 'high' },
    });
    expect(pickedRef(withVariant, { providerID: 'opencode', id: 'big' })).toEqual({
      providerID: 'opencode',
      id: 'big',
      variant: 'high',
    });
    expect(pickedRef(withVariant, { providerID: 'acme', id: 'one' })).toEqual({
      providerID: 'acme',
      id: 'one',
    });
  });
});
