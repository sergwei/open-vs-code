// Protects the pure rules behind the model and agent selectors (issues #23/#24): which model and
// agent the prompt box shows and sends (draft, then the open session, then the host's proposal, then
// the server default), the grouping and search of the model list, and the one-line texts.
//
// Provenance: FABRICATED catalogs. The model names and ids ("GLM-5.3-Flash Free",
// "glm-5.3-flash-free", "big-pickle") and the agent ids come from the planner's spike against a
// real opencode 2.0.32 (Windows 11, 21/10/2026); everything else (a second provider, a paid model)
// is invented to cover grouping. The search cases follow the behaviour of the upstream helper this
// module is adapted from (MIT, see `selection.ts`). These tests confirm OUR rules, not the server.
import { describe, expect, it } from 'vitest';
import type { Catalog, ModelOption, SessionSummary } from '../../../src/shared/model';
import {
  compactModelSearch,
  effectiveAgent,
  effectiveModel,
  groupModels,
  matchesModelSearch,
  modelLabel,
  modelMeta,
  normalizeModelSearch,
  pickModel,
  replyMeta,
  sameModel,
  selectionToSend,
  variantChoices,
  withVariant,
  type SelectionInput,
} from './selection';

const option = (
  providerID: string,
  id: string,
  name: string,
  extra: Partial<ModelOption> = {},
): ModelOption => ({
  providerID,
  id,
  name,
  status: 'active',
  contextLimit: 200000,
  free: true,
  variants: [],
  images: true,
  ...extra,
});

const PICKLE = { providerID: 'opencode', id: 'big-pickle' };
const GLM = { providerID: 'opencode', id: 'glm-5.3-flash-free' };

const catalog: Catalog = {
  models: [
    option('opencode', 'big-pickle', 'Big Pickle'),
    option('acme', 'sonnet', 'Sonnet 4', { free: false, status: 'beta', contextLimit: 1_000_000 }),
    option('opencode', 'glm-5.3-flash-free', 'GLM-5.3-Flash Free'),
    option('orphan', 'x1', 'Mystery'),
  ],
  providers: [
    { id: 'opencode', name: 'OpenCode' },
    { id: 'acme', name: 'Acme AI' },
  ],
  agents: [
    { id: 'build', name: 'Build' },
    { id: 'plan', name: 'Plan' },
    { id: 'review', name: 'Reviewer' },
  ],
  serverDefault: PICKLE,
  defaultAgent: 'build',
};

const input = (extra: Partial<SelectionInput> = {}): SelectionInput => ({
  catalog,
  hasSession: false,
  row: undefined,
  draft: {},
  ...extra,
});
const row = (extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id: 'ses_1',
  createdAt: 1,
  updatedAt: 2,
  ...extra,
});

describe('effectiveModel', () => {
  it('is undefined without a catalog', () => {
    expect(effectiveModel(input({ catalog: undefined }))).toBeUndefined();
  });

  it('a new session shows the host proposal, else the server default', () => {
    expect(effectiveModel(input({ catalog: { ...catalog, preferredModel: GLM } }))).toMatchObject({
      ref: GLM,
      source: 'preferred',
      option: { name: 'GLM-5.3-Flash Free' },
    });
    expect(effectiveModel(input())).toMatchObject({ ref: PICKLE, source: 'default' });
  });

  it('an open session shows its own model, never the proposal for new ones', () => {
    const open = input({
      hasSession: true,
      row: row({ model: GLM }),
      catalog: { ...catalog, preferredModel: PICKLE },
    });
    expect(effectiveModel(open)).toMatchObject({ ref: GLM, source: 'session' });
    const bare = input({
      hasSession: true,
      row: row(),
      catalog: { ...catalog, preferredModel: GLM },
    });
    expect(effectiveModel(bare)).toMatchObject({ ref: PICKLE, source: 'default' });
  });

  it('the draft wins over everything', () => {
    expect(
      effectiveModel(
        input({ hasSession: true, row: row({ model: GLM }), draft: { model: PICKLE } }),
      ),
    ).toMatchObject({ ref: PICKLE, source: 'draft' });
  });

  it('a model the catalog no longer lists has no option (unavailable)', () => {
    const gone = { providerID: 'opencode', id: 'retired' };
    expect(effectiveModel(input({ hasSession: true, row: row({ model: gone }) }))).toMatchObject({
      ref: gone,
      option: undefined,
      source: 'session',
    });
  });
});

describe('effectiveAgent', () => {
  it('draft, then the open session, then the default agent', () => {
    expect(effectiveAgent(input())).toBe('build');
    expect(effectiveAgent(input({ hasSession: true, row: row({ agent: 'plan' }) }))).toBe('plan');
    expect(
      effectiveAgent(
        input({ hasSession: true, row: row({ agent: 'plan' }), draft: { agent: 'build' } }),
      ),
    ).toBe('build');
    expect(effectiveAgent(input({ catalog: undefined }))).toBeUndefined();
  });
});

describe('selectionToSend', () => {
  it('sends nothing without a catalog (the host could not validate it)', () => {
    expect(selectionToSend(input({ catalog: undefined, draft: { agent: 'plan' } }))).toEqual({});
  });

  it('a new session sends the default agent and no model when only the server default applies', () => {
    expect(selectionToSend(input())).toEqual({ agent: 'build' });
  });

  it('a new session sends the proposed model', () => {
    expect(selectionToSend(input({ catalog: { ...catalog, preferredModel: GLM } }))).toEqual({
      agent: 'build',
      model: GLM,
    });
  });

  it('an open session sends its own model and agent (the host compares them)', () => {
    expect(
      selectionToSend(input({ hasSession: true, row: row({ model: GLM, agent: 'plan' }) })),
    ).toEqual({ model: GLM, agent: 'plan' });
  });

  it('an open session with nothing stored and no pick sends nothing', () => {
    expect(selectionToSend(input({ hasSession: true, row: row() }))).toEqual({});
  });

  it('the draft is sent as chosen, even the server default model', () => {
    expect(
      selectionToSend(
        input({
          hasSession: true,
          row: row({ model: GLM, agent: 'plan' }),
          draft: { model: PICKLE, agent: 'build' },
        }),
      ),
    ).toEqual({ model: PICKLE, agent: 'build' });
  });

  it('a subagent session (agent not selectable) sends no agent, so the host does not refuse it', () => {
    expect(
      selectionToSend(input({ hasSession: true, row: row({ agent: 'general', model: GLM }) })),
    ).toEqual({ model: GLM });
  });
});

describe('sameModel', () => {
  it('compares provider, id and variant, an absent variant being the default', () => {
    expect(sameModel(PICKLE, { ...PICKLE })).toBe(true);
    expect(sameModel(PICKLE, GLM)).toBe(false);
    expect(sameModel(PICKLE, { ...PICKLE, variant: 'low' })).toBe(false);
    expect(sameModel({ ...PICKLE, variant: 'low' }, { ...PICKLE, variant: 'low' })).toBe(true);
  });
});

describe('groupModels', () => {
  it('groups by provider in provider.list order, orphans last, models in catalog order', () => {
    const groups = groupModels(catalog, '');
    expect(groups.map((g) => g.provider.name)).toEqual(['OpenCode', 'Acme AI', 'orphan']);
    expect(groups[0]?.models.map((m) => m.id)).toEqual(['big-pickle', 'glm-5.3-flash-free']);
  });

  it('filters on name, id and provider name, and drops empty groups', () => {
    expect(groupModels(catalog, 'glm').flatMap((g) => g.models.map((m) => m.id))).toEqual([
      'glm-5.3-flash-free',
    ]);
    expect(groupModels(catalog, 'acme').map((g) => g.provider.id)).toEqual(['acme']);
    expect(groupModels(catalog, 'zzz')).toEqual([]);
    expect(groupModels(undefined, '')).toEqual([]);
  });

  it('finds a model typed without the punctuation: "glm53" finds "GLM-5.3"', () => {
    expect(groupModels(catalog, 'glm53').flatMap((g) => g.models.map((m) => m.id))).toEqual([
      'glm-5.3-flash-free',
    ]);
    expect(groupModels(catalog, 'SONNET 4')).toHaveLength(1);
  });
});

describe('search helpers (adapted from upstream)', () => {
  it('normalizes case, punctuation and spacing', () => {
    expect(normalizeModelSearch('  GLM-5.3__Flash  ')).toBe('glm 5 3 flash');
    expect(compactModelSearch('GLM-5.3 Flash')).toBe('glm53flash');
  });

  it('a blank query matches everything, a query matches any of the values', () => {
    expect(matchesModelSearch('  ', ['x'])).toBe(true);
    expect(matchesModelSearch('big', ['Big Pickle', 'other'])).toBe(true);
    expect(matchesModelSearch('nope', ['Big Pickle'])).toBe(false);
  });
});

describe('texts', () => {
  it('modelMeta is one string: Free, context, and the status only when not active', () => {
    expect(modelMeta(option('p', 'a', 'A'))).toBe('Free · 200K context');
    expect(
      modelMeta(option('p', 'a', 'A', { free: false, status: 'beta', contextLimit: 1_000_000 })),
    ).toBe('1M context · beta');
    expect(modelMeta(option('p', 'a', 'A', { contextLimit: 512 }))).toBe('Free · 512 context');
  });

  it('modelLabel falls back to provider/id for a model the catalog lacks', () => {
    expect(modelLabel(PICKLE, option('opencode', 'big-pickle', 'Big Pickle'))).toBe('Big Pickle');
    expect(modelLabel({ providerID: 'p', id: 'm' }, undefined)).toBe('p/m');
  });

  it('replyMeta names agent and model from the catalog, by id when unknown, plus a variant', () => {
    expect(replyMeta(catalog, 'plan', GLM)).toBe('Plan · GLM-5.3-Flash Free');
    expect(replyMeta(undefined, 'build', PICKLE)).toBe('build · opencode/big-pickle');
    expect(replyMeta(catalog, 'general', { providerID: 'p', id: 'm', variant: 'low' })).toBe(
      'general · p/m · low',
    );
  });
});

// Issue #61. FABRICATED: `variants` low/high/max are what the spike saw for glm-5.3-flash-free; a
// model with variants and one without are enough to cover the rules.
describe('reasoning variants (issue #61)', () => {
  const withVariants: Catalog = {
    ...catalog,
    models: catalog.models.map((m) =>
      m.id === 'glm-5.3-flash-free' ? { ...m, variants: ['low', 'high', 'max'] } : m,
    ),
  };
  const effective = (extra: Partial<SelectionInput> = {}) =>
    effectiveModel(input({ catalog: withVariants, ...extra }));

  it('variantChoices is invisible without an effective model or for a model with no variants', () => {
    expect(variantChoices(undefined)).toEqual({ options: [], visible: false });
    expect(variantChoices(effective())).toEqual({ options: [], visible: false });
  });

  it('variantChoices lists the catalog ids in order with no variant chosen (Default)', () => {
    expect(variantChoices(effective({ draft: { model: GLM } }))).toEqual({
      options: ['low', 'high', 'max'],
      visible: true,
    });
  });

  it('variantChoices marks the current variant, from the draft or from the open session row', () => {
    expect(variantChoices(effective({ draft: { model: { ...GLM, variant: 'high' } } }))).toEqual({
      options: ['low', 'high', 'max'],
      current: 'high',
      visible: true,
    });
    const fromTui = effective({
      hasSession: true,
      row: row({ model: { ...GLM, variant: 'low' } }),
    });
    expect(variantChoices(fromTui)).toMatchObject({ current: 'low', visible: true });
  });

  it('variantChoices reports a variant the catalog does not list as missing, and stays visible', () => {
    const choices = variantChoices(effective({ draft: { model: { ...GLM, variant: 'ultra' } } }));
    expect(choices).toEqual({
      options: ['low', 'high', 'max'],
      current: 'ultra',
      missing: 'ultra',
      visible: true,
    });
    // Even a model with no variants at all shows a variant that was set on it.
    expect(
      variantChoices(effective({ draft: { model: { ...PICKLE, variant: 'low' } } })),
    ).toMatchObject({ options: [], missing: 'low', visible: true });
  });

  it('withVariant returns a plain copy, and undefined removes the variant (never "default")', () => {
    const base = { ...GLM, variant: 'high' };
    expect(withVariant(base, 'low')).toEqual({ ...GLM, variant: 'low' });
    const cleared = withVariant(base, undefined);
    expect(cleared).toEqual(GLM);
    expect('variant' in cleared).toBe(false);
    expect(withVariant(base, 'low')).not.toBe(base);
    expect(structuredClone(withVariant(base, 'low'))).toEqual({ ...GLM, variant: 'low' });
  });

  it('pickModel keeps the variant when the same model is picked again', () => {
    const current = effective({ draft: { model: { ...GLM, variant: 'high' } } });
    expect(pickModel(current, GLM)).toEqual({ ...GLM, variant: 'high' });
  });

  it('pickModel starts any other model on Default (ids do not mean the same across models)', () => {
    const current = effective({ draft: { model: { ...GLM, variant: 'high' } } });
    const picked = pickModel(current, PICKLE);
    expect(picked).toEqual(PICKLE);
    expect('variant' in picked).toBe(false);
    expect(pickModel(undefined, GLM)).toEqual(GLM);
  });

  it('selectionToSend carries the variant of the draft and of the open session row', () => {
    expect(
      selectionToSend(
        input({ catalog: withVariants, draft: { model: { ...GLM, variant: 'high' } } }),
      ),
    ).toEqual({ agent: 'build', model: { ...GLM, variant: 'high' } });
    expect(
      selectionToSend(
        input({
          catalog: withVariants,
          hasSession: true,
          row: row({ model: { ...GLM, variant: 'low' } }),
        }),
      ),
    ).toEqual({ model: { ...GLM, variant: 'low' } });
  });
});
