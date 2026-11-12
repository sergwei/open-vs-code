// The list of the model picker of the Quick start view (issue #223, E9-home-model-picker). Pure: no
// `vscode`, so Vitest runs it directly; `sidebarHome.ts` turns the items into a native QuickPick.
// The catalog never travels to the webview: the host builds the list from its own copy.

import * as l10n from '@vscode/l10n';
import type { Catalog, ModelOption, ModelRef } from '../shared/model';
import { modelMetaText, orderedProviders } from '../shared/modelText';

/** One row of the picker: a provider heading, or a model the user can choose. */
export type HomeModelItem =
  | { kind: 'separator'; label: string }
  | { kind: 'model'; label: string; description: string; ref: ModelRef };

/** Removes `$(` so a name from the server cannot inject a codicon into a QuickPick label. */
function plain(text: string): string {
  return text.replaceAll('$(', '');
}

/**
 * The detail of a model ("Free · 200K context · beta"): the same `modelMetaText` rule and l10n keys
 * as `modelMeta` of the chat's model panel, so the two lists cannot drift (review of #223, C1).
 */
function meta(model: ModelOption): string {
  return modelMetaText(model, l10n.t('Free'), (tokens) => l10n.t('{0} context', tokens));
}

/**
 * The rows of the picker, grouped by provider in the order of the chat's model list
 * (`orderedProviders`: the catalog's providers, then one it owns models of but does not list, shown
 * by its id; a provider without models gets no heading). `current` is the model the next
 * conversation would use now: its row starts with `$(check) `; when it is `undefined` the effective
 * default (the host's preferred model, else the server's) is the one marked. The default also says
 * `default` in its description, wherever the mark is. An empty catalog gives no rows.
 * VERIFIED by `homeModelPick.test.ts` "groups the models by provider, marks the current one and
 * says default on the default" with a fabricated catalog (Windows 11, Vitest). VERIFIED the real
 * QuickPick lists both fake models (Windows 11, VS Code 1.146.0, 12/11/2026, `test:visual` step 50:
 * "ok   P1 the model pill opens the picker "Model for the next conversation" listing both models,
 * and Escape closes it leaving the pill as it was"). NOT observed: the group separators and the
 * "default" description on screen (the check matches the model names only).
 */
export function homeModelItems(catalog: Catalog, current: ModelRef | undefined): HomeModelItem[] {
  const fallback = catalog.preferredModel ?? catalog.serverDefault;
  const marked = current ?? fallback;
  const same = (a: ModelRef | undefined, model: ModelOption): boolean =>
    a !== undefined && a.providerID === model.providerID && a.id === model.id;
  const items: HomeModelItem[] = [];
  for (const provider of orderedProviders(catalog)) {
    const owned = catalog.models.filter((model) => model.providerID === provider.id);
    if (owned.length === 0) continue;
    items.push({ kind: 'separator', label: plain(provider.name) });
    for (const model of owned) {
      const details = [meta(model)];
      if (same(fallback, model)) details.push(l10n.t('default'));
      items.push({
        kind: 'model',
        label: `${same(marked, model) ? '$(check) ' : ''}${plain(model.name)}`,
        description: details.join(' · '),
        ref: { providerID: model.providerID, id: model.id },
      });
    }
  }
  return items;
}

/**
 * The ref to keep for a model the user picked: the host's preferred model itself when it is the
 * same one (so its remembered reasoning variant is not lost), else the model without a variant,
 * which is the "Default" of the chat's variant picker. The chat tab can still change it.
 * VERIFIED by `homeModelPick.test.ts` "pickedRef keeps the variant of the preferred model and gives
 * none to another" (fabricated catalog, Windows 11, Vitest).
 */
export function pickedRef(catalog: Catalog, ref: ModelRef): ModelRef {
  const preferred = catalog.preferredModel;
  if (preferred?.providerID === ref.providerID && preferred.id === ref.id) return preferred;
  return { providerID: ref.providerID, id: ref.id };
}
