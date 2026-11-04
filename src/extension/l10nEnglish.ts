// The English twin of a translated host text, for the log (E11-i18n, decision of Sergio on the
// review of pass 1, Engram `E11-i18n/decisions/logs-ingles-tabla`): the user reads a warning in the
// language of VS Code, but the OutputChannel keeps the English text so that a pasted log, or one
// searched for on the internet, is always the same. Pure: no `vscode` import, so Vitest drives it.
//
// Why a second evaluation and not a second literal: the exporter of `scripts/l10n.mjs` only reads
// `l10n.t('literal')`, so an English copy written next to each call would be a second string to keep
// equal to the first. Running the SAME producer again with an empty catalog gives the English text
// from the one literal.

import * as l10n from '@vscode/l10n';
import type { L10nBundle } from '../shared/l10n';

/**
 * The catalog `@vscode/l10n` holds right now. The library has no getter, so {@link inEnglish}
 * could not put it back; every writer goes through {@link setHostBundle} to keep this copy true.
 */
let active: L10nBundle = {};

/**
 * Hands `bundle` to `@vscode/l10n` and remembers it, so {@link inEnglish} can restore it.
 * `l10nBoot.ts` calls it with `vscode.l10n.bundle`, and the test helper `useSpanish` with the
 * shipped Spanish catalog. Calling `l10n.config` directly elsewhere is invisible to this module.
 */
export function setHostBundle(bundle: L10nBundle): void {
  active = bundle;
  l10n.config({ contents: bundle });
}

/**
 * Runs `produce` with no catalog, so every `l10n.t` inside it returns its English text, and puts
 * the catalog back, also when `produce` throws. Synchronous on purpose: nothing may run between
 * the swap and the restore, so no other text can come out in English by accident. Re-entrant:
 * `active` is the empty catalog while `produce` runs, so a nested call saves the empty one and
 * puts it back, and only the outermost call restores the real catalog.
 * VERIFIED by `l10nEnglish.test.ts` ("gives the English text and puts the Spanish catalog back",
 * "puts the catalog back when the producer throws" and "keeps English through a nested call").
 */
export function inEnglish<T>(produce: () => T): T {
  const previous = active;
  active = {};
  l10n.config({ contents: active });
  try {
    return produce();
  } finally {
    active = previous;
    l10n.config({ contents: previous });
  }
}

/** One text in the two languages it is needed in: `message` for the user, `logMessage` for the log. */
export interface BothTexts {
  message: string;
  logMessage: string;
}

/**
 * Evaluates `produce` twice: as is (the language of VS Code) and through {@link inEnglish}.
 * `produce` must be pure and cheap; it is the only place the `l10n.t` literal is written.
 */
export function bothTexts(produce: () => string): BothTexts {
  return { message: produce(), logMessage: inEnglish(produce) };
}

/**
 * An `Error` whose `message` is the translated text and whose `logMessage` is the English twin of
 * the same `produce` (the one place the `l10n.t` literal is written). `code`, when given, becomes
 * the `name`, which the controller shows as the `ErrorInfo.code`. `logMessage` is NOT enumerable, so
 * it never travels in a structured clone or a JSON dump; {@link logMessageOf} reads it.
 * VERIFIED by `l10nEnglish.test.ts` ("keeps the English twin of a translated error out of its keys").
 */
export function translatedError(produce: () => string, code?: string): Error {
  const { message, logMessage } = bothTexts(produce);
  const error = new Error(message);
  if (code !== undefined) error.name = code;
  Object.defineProperty(error, 'logMessage', { value: logMessage, enumerable: false });
  return error;
}

/**
 * `String(error)` for the log: the same `Name: message` of an `Error`, but with the English
 * `logMessage` when the error carries one, so a thrown {@link translatedError} never writes a
 * translated sentence into the OutputChannel.
 * VERIFIED by `l10nEnglish.test.ts` ("writes a thrown translated error in English").
 */
export function logErrorOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${logMessageOf(error)}` : String(error);
}

/**
 * The text of `error` meant for the log: its `logMessage` when it carries one (`ServerStartError`,
 * `ServerInfoError`), else its `message`, else the value as a string.
 * VERIFIED by `l10nEnglish.test.ts` ("prefers the logMessage of an error").
 */
export function logMessageOf(error: unknown): string {
  if (error instanceof Error) {
    const logMessage = (error as Error & { logMessage?: unknown }).logMessage;
    return typeof logMessage === 'string' ? logMessage : error.message;
  }
  return String(error);
}
