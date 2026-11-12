// How a model is described and how providers are ordered, for the two lists of the catalog: the
// chat's model panel (webview) and the Quick start picker (host, issue #223). Pure and without
// imports of packages (`neutrality.test.ts`): the words are translated by each side, so the
// `l10n.t('Free')` and `l10n.t('{0} context', …)` literals stay in the folders `scripts/l10n.mjs`
// scans, and this file only holds the rule that both lists must share.

import type { Catalog, ModelOption, ProviderOption } from './model';

/**
 * "200K" / "1M" for a token count; whole numbers only, rounded down. Also used by the context line
 * of the chat header (`chat/usage.ts`, issue #25).
 * VERIFIED by `modelText.test.ts` "compactTokens rounds down to K and M" (Vitest, Windows 11).
 */
export function compactTokens(count: number): string {
  if (count >= 1_000_000) return `${String(Math.floor(count / 1_000_000))}M`;
  if (count >= 1_000) return `${String(Math.floor(count / 1_000))}K`;
  return String(count);
}

/**
 * The one-line detail under a model name, built as ONE string (lesson #926): "Free · 200K context ·
 * beta". "Free" only when the model is free, the status only when it is not `active`. `free` is the
 * translated word and `context` the translated sentence for a compact token count, so each side
 * keeps its own `l10n.t` literals.
 * VERIFIED by `modelText.test.ts` "modelMeta joins Free, context and the status only when not
 * active" and by the chat's `selection.test.ts` "modelMeta is one string: …" (Vitest, Windows 11).
 */
export function modelMetaText(
  option: ModelOption,
  free: string,
  context: (tokens: string) => string,
): string {
  const fields: string[] = [];
  if (option.free) fields.push(free);
  fields.push(context(compactTokens(option.contextLimit)));
  if (option.status !== 'active') fields.push(option.status);
  return fields.join(' · ');
}

/**
 * The providers of `catalog` in the order both model lists show them: the order of `provider.list`,
 * then a provider that owns models but is not listed, by id and named after its id. Providers
 * without models are kept (the callers drop the empty groups).
 * VERIFIED by `modelText.test.ts` "orders the listed providers first and the orphans by id" and by
 * `selection.test.ts` `groupModels` cases (Vitest, Windows 11).
 */
export function orderedProviders(catalog: Catalog): ProviderOption[] {
  const known = new Set(catalog.providers.map((provider) => provider.id));
  const orphans = [...new Set(catalog.models.map((model) => model.providerID))]
    .filter((id) => !known.has(id))
    .sort();
  return [...catalog.providers, ...orphans.map((id) => ({ id, name: id }))];
}
