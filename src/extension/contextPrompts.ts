// The prompts of "Explain with OpenCode" and "Fix with OpenCode" (issue #36), written by the HOST
// (decision T3 of Sergio, 29/10/2026: the webview receives the final text in `prompt.compose`).
// PURE: no `vscode` import, so the wording is tested from any OS.
//
// The texts are the ones Sergio approved (decisions P3=1 and P4=1, Engram
// `E9-context-menus/decisions/p1-p13-t1-t4`): each file is cited with an `@name` mention, the
// convention of the `@` popup (Q1 of #28/#29), so the history and the automatic session title say
// which file is meant, and the chip travels next to it.

import * as l10n from '@vscode/l10n';
import type { AttachmentRef } from '../shared/protocol';
import { plural } from '../shared/l10n';

/** What a context menu entry asks the model for. */
export type ContextAction = 'explain' | 'fix';

/**
 * One problem VS Code reports for a file, as {@link buildContextPrompt} prints it. `line` is
 * 1-based. `source` and `code` are what the language service gave (`ts`, `2304`); either may be
 * absent.
 */
export interface ContextDiagnostic {
  line: number;
  message: string;
  source?: string;
  code?: string;
}

/**
 * Most diagnostics a Fix prompt lists (decision P4=1 of Sergio, 29/10/2026). Our cap: a file full
 * of errors would make the prompt mostly a list, and the first ones are usually the cause of the
 * rest.
 */
export const MAX_PROMPT_DIAGNOSTICS = 20;

/** Longest message of one listed diagnostic; our cap, so a long type error cannot swamp the prompt. */
export const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 300;

/**
 * Joins mentions the way P3=1 words them: one alone, `a and b`, and from three on `a, b and c`.
 * The "and" is the catalog text `{0} and {1}`, so the sentence reads in the language of the host.
 */
function joinMentions(refs: readonly AttachmentRef[]): string {
  const mentions = refs.map((ref) => `@${ref.name}`);
  const last = mentions[mentions.length - 1];
  if (last === undefined) return '';
  if (mentions.length === 1) return last;
  return l10n.t('{0} and {1}', mentions.slice(0, -1).join(', '), last);
}

/** One diagnostic as a list line: `- Line 12: message (ts 2304)`, the message on a single line. */
function diagnosticLine(diagnostic: ContextDiagnostic): string {
  const flat = diagnostic.message.replace(/\s+/g, ' ').trim();
  const message =
    flat.length > MAX_DIAGNOSTIC_MESSAGE_LENGTH
      ? `${flat.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH - 1)}…`
      : flat;
  const origin = [diagnostic.source, diagnostic.code]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ');
  return origin === ''
    ? l10n.t('- Line {0}: {1}', diagnostic.line, message)
    : l10n.t('- Line {0}: {1} ({2})', diagnostic.line, message, origin);
}

/**
 * Builds the prompt text of a context action for the given references.
 *
 * `explain` is `Explain what @a does.` (`do` from two references on, mentions joined by
 * {@link joinMentions}); `fix` is `Fix the problems in @a.` and, when `diagnostics` is not empty,
 * continues with `Problems reported by VS Code:` and one line each, ordered by line, at most
 * {@link MAX_PROMPT_DIAGNOSTICS} with a last `- … and N more` when there were more. `diagnostics`
 * is ignored for `explain`. With no references it returns the generic sentence without a mention
 * (`Explain what this does.`): the controller never calls it that way, but the function must not
 * produce `Explain what  does.`.
 *
 * Every sentence goes through `l10n.t` (decision P4=1 of Sergio, Engram #1921), so
 * with a language catalog loaded the PROMPT TEXT is in that language and the model is asked in it;
 * the singular and plural forms of "does/do" are two catalog entries chosen by `plural`, and the
 * `@name` mentions are never translated.
 * VERIFIED by `contextPrompts.test.ts` (hand-made references and diagnostics, Windows 11,
 * 29/10/2026): the exact strings above. VERIFIED in Spanish by `contextPrompts.test.ts` "writes
 * the Explain and Fix prompts in Spanish with the Spanish catalog" (Windows 11, 04/11/2026). What
 * a real model answers to them, in either language, is not tested.
 */
export function buildContextPrompt(input: {
  action: ContextAction;
  refs: readonly AttachmentRef[];
  diagnostics?: readonly ContextDiagnostic[];
}): string {
  const { action, refs } = input;
  if (action === 'explain') {
    if (refs.length === 0) return l10n.t('Explain what this does.');
    const mentions = joinMentions(refs);
    return plural(
      refs.length,
      l10n.t('Explain what {0} does.', mentions),
      l10n.t('Explain what {0} do.', mentions),
    );
  }
  const head =
    refs.length === 0
      ? l10n.t('Fix the problems.')
      : l10n.t('Fix the problems in {0}.', joinMentions(refs));
  const diagnostics = [...(input.diagnostics ?? [])].sort(
    (a, b) => a.line - b.line || a.message.localeCompare(b.message),
  );
  if (diagnostics.length === 0) return head;
  const lines = diagnostics.slice(0, MAX_PROMPT_DIAGNOSTICS).map(diagnosticLine);
  const more = diagnostics.length - MAX_PROMPT_DIAGNOSTICS;
  if (more > 0) lines.push(l10n.t('- … and {0} more', more));
  return `${head}\n\n${l10n.t('Problems reported by VS Code:')}\n${lines.join('\n')}`;
}
