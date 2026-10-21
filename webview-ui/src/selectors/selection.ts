/**
 * Pure logic of the model and agent selectors (issues #23/#24): which model and agent the prompt
 * box shows and sends, how the catalog is grouped and searched, and the one-line texts. No DOM, no
 * Solid: `selection.test.ts` drives it with plain objects.
 *
 * The user's choice is a DRAFT held by the webview (decision of 21/10/2026, Engram #1012): the
 * server only hears it when a prompt is sent, and the host validates it first. So everything here
 * answers "what would be used for the NEXT prompt", from the draft, then the open session, then the
 * catalog.
 *
 * The search below is ADAPTED from the opencode app: github.com/anomalyco/opencode, file
 * `packages/app/src/providers/models/search.ts` at tag v2.0.32 (commit 843a6c51), MIT license
 * (https://github.com/anomalyco/opencode/blob/843a6c51/LICENSE), read with `gh api` on 21/10/2026.
 * Changes: the three helpers keep their behaviour; the file's quotes/semicolons follow this
 * repository's style, and they are typed. Everything else in this file is ours.
 */
import type {
  AgentOption,
  Catalog,
  ModelOption,
  ModelRef,
  ProviderOption,
  SessionSummary,
} from '../../../src/shared/model';

/** Lower-cases, turns every run of non-letters/digits into one space and trims (upstream). */
export const normalizeModelSearch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/** The normalized text without any space, so "glm53" finds "GLM-5.3" (upstream). */
export const compactModelSearch = (value: string): string =>
  normalizeModelSearch(value).replaceAll(' ', '');

/** True when `query` is blank or any of `values` contains it, with or without spaces (upstream). */
export const matchesModelSearch = (query: string, values: readonly string[]): boolean => {
  const search = normalizeModelSearch(query);
  if (!search) return true;
  const compactSearch = compactModelSearch(query);
  return values.some(
    (value) =>
      normalizeModelSearch(value).includes(search) ||
      compactModelSearch(value).includes(compactSearch),
  );
};

/** True when both name the same model and variant; an absent variant is "default". */
export function sameModel(a: ModelRef, b: ModelRef): boolean {
  return a.providerID === b.providerID && a.id === b.id && (a.variant ?? '') === (b.variant ?? '');
}

/**
 * A fresh, plain copy of `ref`. The references the selectors read come out of the Solid store (a
 * Proxy), and `postMessage` cannot structured-clone a Proxy: sending one raised `DataCloneError`
 * in a real VS Code and the prompt never left (found by `test:visual` step 11, 21/10/2026, which
 * jsdom cannot see because its `postMessage` does not clone). Anything put in a message is copied.
 */
function plainModel(ref: ModelRef): ModelRef {
  const copy: ModelRef = { providerID: ref.providerID, id: ref.id };
  if (ref.variant !== undefined) copy.variant = ref.variant;
  return copy;
}

/** The user's unsent choices; either may be absent (nothing chosen yet). */
export type SelectionDraft = { model?: ModelRef; agent?: string };

/** What the selectors read: the catalog, the open session's row and the draft. */
export type SelectionInput = {
  catalog: Catalog | undefined;
  /** True when a session is open (it may still have no row or no model). */
  hasSession: boolean;
  /** The summary row of the open session, if the host sent it. */
  row: SessionSummary | undefined;
  draft: SelectionDraft;
};

/** The model the prompt box shows, and why. */
export type EffectiveModel = {
  ref: ModelRef;
  /** The catalog entry, or `undefined` when the model is not offered by the server any more. */
  option: ModelOption | undefined;
  /**
   * Where it came from: the user's pick, the open session's own model, the model the host proposes
   * for a new session, or the server's default (the box then says "(default)").
   */
  source: 'draft' | 'session' | 'preferred' | 'default';
};

/** Finds the catalog entry of `ref` (variant ignored). */
export function findModel(catalog: Catalog | undefined, ref: ModelRef): ModelOption | undefined {
  return catalog?.models.find((m) => m.providerID === ref.providerID && m.id === ref.id);
}

/**
 * The model for the next prompt: the draft, else the open session's own (`row.model`), else (only
 * for a NEW session) the one the host proposes, else the server's default. `undefined` without a
 * catalog or when nothing can be named. An open session that has no stored model uses the server
 * default (VERIFIED, spike, opencode 2.0.32: `session.create({})` leaves `model` unset and the turn
 * runs `Model.default()`), so it shows "(default)" rather than the proposal for new sessions.
 */
export function effectiveModel(input: SelectionInput): EffectiveModel | undefined {
  const { catalog, hasSession, row, draft } = input;
  if (catalog === undefined) return undefined;
  const candidates: Array<[EffectiveModel['source'], ModelRef | undefined]> = [
    ['draft', draft.model],
    ['session', hasSession ? row?.model : undefined],
    ['preferred', hasSession ? undefined : catalog.preferredModel],
    ['default', catalog.serverDefault],
  ];
  for (const [source, ref] of candidates) {
    if (ref !== undefined) return { ref, option: findModel(catalog, ref), source };
  }
  return undefined;
}

/** The agent the prompt box shows: the draft, else the open session's, else the server's default. */
export function effectiveAgent(input: SelectionInput): string | undefined {
  const { catalog, row, draft } = input;
  if (catalog === undefined) return undefined;
  return draft.agent ?? row?.agent ?? catalog.defaultAgent;
}

/** True when `id` is one of the agents the user may choose. */
export function isSelectableAgent(catalog: Catalog | undefined, id: string): boolean {
  return catalog?.agents.some((agent) => agent.id === id) ?? false;
}

/**
 * What `prompt.send` carries. `model` is the effective model unless it is only the server default
 * (then nothing is sent and the server decides). `agent` is the draft; else the open session's agent
 * when the user could choose it; else, for a new session, the default agent. An open session whose
 * agent is NOT selectable (a subagent session) sends none: the host would refuse it. No catalog, no
 * fields: the host could not validate them. The model is a plain COPY (see {@link plainModel}), so
 * the result can be passed to `postMessage` even when the input came from the store.
 */
export function selectionToSend(input: SelectionInput): { model?: ModelRef; agent?: string } {
  const { catalog, hasSession, row, draft } = input;
  if (catalog === undefined) return {};
  const result: { model?: ModelRef; agent?: string } = {};
  const model = effectiveModel(input);
  if (model !== undefined && model.source !== 'default') result.model = plainModel(model.ref);
  if (draft.agent !== undefined) {
    result.agent = draft.agent;
  } else if (row?.agent !== undefined) {
    if (isSelectableAgent(catalog, row.agent)) result.agent = row.agent;
  } else if (!hasSession && catalog.defaultAgent !== undefined) {
    result.agent = catalog.defaultAgent;
  }
  return result;
}

/** One provider with the models that match the search, in catalog order. */
export type ModelGroup = { provider: ProviderOption; models: ModelOption[] };

/**
 * Groups the catalog by provider and keeps the models that match `search` on their name, id or
 * provider name. Providers keep the order of `provider.list`; a provider that owns models but is
 * not listed goes last, by id, named after its id. Models keep the order of `model.list` (the
 * server puts the newest first). Groups left empty are dropped.
 */
export function groupModels(catalog: Catalog | undefined, search: string): ModelGroup[] {
  if (catalog === undefined) return [];
  const known = new Map<string, ProviderOption>(catalog.providers.map((p) => [p.id, p]));
  const orphans = [...new Set(catalog.models.map((m) => m.providerID))]
    .filter((id) => !known.has(id))
    .sort();
  const providers = [...catalog.providers, ...orphans.map((id) => ({ id, name: id }))];
  const groups: ModelGroup[] = [];
  for (const provider of providers) {
    const models = catalog.models.filter(
      (m) =>
        m.providerID === provider.id && matchesModelSearch(search, [m.name, m.id, provider.name]),
    );
    if (models.length > 0) groups.push({ provider, models });
  }
  return groups;
}

/** "200K" / "1M" for a token count; whole numbers only, rounded down. */
function compactTokens(count: number): string {
  if (count >= 1_000_000) return `${String(Math.floor(count / 1_000_000))}M`;
  if (count >= 1_000) return `${String(Math.floor(count / 1_000))}K`;
  return String(count);
}

/**
 * The one-line detail under a model name, built as ONE string (lesson #926): "Free · 200K context ·
 * beta". "Free" only when the model is free, the status only when it is not `active`.
 */
export function modelMeta(option: ModelOption): string {
  const fields: string[] = [];
  if (option.free) fields.push('Free');
  fields.push(`${compactTokens(option.contextLimit)} context`);
  if (option.status !== 'active') fields.push(option.status);
  return fields.join(' · ');
}

/** The name of the model for display: the catalog's, else `providerID/id` for one that left it. */
export function modelLabel(ref: ModelRef, option: ModelOption | undefined): string {
  return option?.name ?? `${ref.providerID}/${ref.id}`;
}

/** The name of agent `id` for display: the catalog's selectable name, else the id itself. */
export function agentLabel(catalog: Catalog | undefined, id: string): string {
  return catalog?.agents.find((agent: AgentOption) => agent.id === id)?.name ?? id;
}

/**
 * "Plan · GLM-5.3-Flash Free" under an assistant reply: the agent and model that ANSWERED
 * (`session.step.started`), named from the catalog when it knows them and by id otherwise; a
 * variant other than the default is appended ("· low").
 */
export function replyMeta(catalog: Catalog | undefined, agent: string, model: ModelRef): string {
  const fields = [agentLabel(catalog, agent), modelLabel(model, findModel(catalog, model))];
  if (model.variant !== undefined) fields.push(model.variant);
  return fields.join(' · ');
}
