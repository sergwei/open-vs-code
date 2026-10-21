// Pure rules for which model a NEW session proposes (issues #23): the `openVsCode.defaultModel`
// setting, the last model a prompt was sent with, and the catalog both are checked against. No
// `vscode` import, so Vitest runs it directly; `chatLifecycle.ts` reads the setting and the
// `globalState` and `chatController.ts` calls {@link resolvePreferredModel}.

import type { ModelRef } from '../shared/model';

/** What {@link parseModelSetting} made of the text of the setting. */
export type ParsedModelSetting =
  { kind: 'none' } | { kind: 'model'; model: ModelRef } | { kind: 'invalid' };

/** Why the setting did not apply: written wrongly, or well written but not in the catalog. */
export type IgnoredSetting = { value: string; reason: 'invalid' | 'unavailable' };

/**
 * Reads `openVsCode.defaultModel`, written `provider/model`.
 *
 * Trims the text; blank means "no setting". The cut is at the FIRST `/`, so a model id that has a
 * slash itself (`openrouter/anthropic/claude`) keeps working: provider `openrouter`, id
 * `anthropic/claude`. Both halves must be non-empty. This is the parse opencode applies to its own
 * `model` config (`Model.parse`, `core/src/model.ts` L321-327 at tag v2.0.32 of
 * github.com/anomalyco/opencode, MIT; read by the planner, and only the RULE is reproduced here,
 * written from scratch: the extra whitespace check is ours). HYPOTHESIS: that opencode's CATALOG ids (`ModelInfo.id`)
 * match what a user would type from its docs; the setting is only ever checked against the
 * catalog, so a mismatch shows up as an ignored setting with a log line, never as a broken session.
 */
export function parseModelSetting(text: string): ParsedModelSetting {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'none' };
  const cut = trimmed.indexOf('/');
  if (cut <= 0) return { kind: 'invalid' };
  const providerID = trimmed.slice(0, cut);
  const id = trimmed.slice(cut + 1);
  if (id === '' || /\s/.test(providerID) || /\s/.test(id)) return { kind: 'invalid' };
  return { kind: 'model', model: { providerID, id } };
}

/** True when the catalog has this provider and model; the variant is ignored on purpose. */
export function isAvailable(
  ref: ModelRef,
  models: readonly { providerID: string; id: string }[],
): boolean {
  return models.some((model) => model.providerID === ref.providerID && model.id === ref.id);
}

/**
 * Chooses the model a new session proposes. Precedence (decision of Sergio, 21/10/2026, Engram
 * #1012): the setting, then the last model used, then nothing (the webview then falls back to the
 * server default). A candidate that is not in `available` is skipped, and a setting that was
 * written but skipped is reported in `ignored` so the controller can tell the user once. The
 * returned model is the CATALOG's own reference (no variant), never the stored one. A `last` that
 * is gone is silently skipped: it is a convenience, not something the user wrote.
 * VERIFIED by unit tests with fabricated data; the catalog comes from `model.list()`.
 */
export function resolvePreferredModel(input: {
  setting: string | undefined;
  last: ModelRef | undefined;
  available: readonly { providerID: string; id: string }[];
}): { model?: ModelRef; ignored?: IgnoredSetting } {
  const parsed = parseModelSetting(input.setting ?? '');
  let ignored: IgnoredSetting | undefined;
  if (parsed.kind === 'model') {
    if (isAvailable(parsed.model, input.available)) return { model: parsed.model };
    ignored = { value: (input.setting ?? '').trim(), reason: 'unavailable' };
  } else if (parsed.kind === 'invalid') {
    ignored = { value: (input.setting ?? '').trim(), reason: 'invalid' };
  }
  const result: { model?: ModelRef; ignored?: IgnoredSetting } = {};
  if (ignored !== undefined) result.ignored = ignored;
  const last = input.last;
  if (last !== undefined && isAvailable(last, input.available)) {
    result.model = { providerID: last.providerID, id: last.id };
  }
  return result;
}
