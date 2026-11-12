// The instructions pinned to a session (issue #188, plan Engram #2314). PURE: no `vscode`, no
// client calls; `chatController.ts` wires the messages and the server calls to these functions.
//
// What the server gives (READ in `@opencode/client@2.2.7` and `core/src/session/instruction-entry.ts`
// of the v2.2.7 tag, never observed on a running server until the opt-in case of
// `realOpencode.test.ts`): a per-session store of `key -> JSON value` entries under the
// EXPERIMENTAL routes `/api/experimental/session/:id/instructions/entries[/:key]`. Keys match
// `^[a-z0-9][a-z0-9._-]*$` and a value may be any JSON up to 256 KiB. The core paints each entry in
// the system prompt as `<context key="k">value</context>`.
//
// What the extension does with it: the user adds free text, the host stores it as a STRING under a
// key it generates (`note-<base36>`), and lists every entry back. An entry written by another client
// may hold any JSON; it is shown as its JSON text and can be removed, but the host never rewrites it.
//
// Security (architecture rule 1 and `isWebviewToHost`): the webview names an entry by the `key` this
// module listed for that session, and the host removes it only if {@link InstructionLedger} lists
// that key for that session, so a hostile webview cannot delete an entry it was never shown.

import type { InstructionEntryInfo } from '@opencode/client';
import { INSTRUCTION_KEY_PATTERN, MAX_INSTRUCTION_LENGTH } from '../shared/protocol';
import type { InstructionView } from '../shared/model';

/** Prefix of the keys the host generates, so the user's own notes are recognisable in a log. */
const NOTE_PREFIX = 'note-';

/**
 * The text of an instruction ready to store, or `undefined` when it must be refused: blank, or
 * longer than {@link MAX_INSTRUCTION_LENGTH} characters once trimmed. The trimmed text is what is
 * stored, so the model never sees padding. The protocol validator already refuses the same, but the
 * host revalidates (the webview is untrusted) and a message with a test double goes through here.
 * VERIFIED by `sessionInstructions.test.ts` "refuses blank and too long text" (fabricated input,
 * Windows 11, 12/11/2026).
 */
export function instructionText(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_INSTRUCTION_LENGTH) return undefined;
  return trimmed;
}

/**
 * A fresh key `note-<base36 time><base36 random>` that is not in `taken`, and that matches the
 * server's key rule. The time part keeps keys roughly ordered by creation; the random part separates
 * two adds in the same millisecond; the loop only repeats on an astronomically rare collision, and
 * exists so that `put` can never overwrite an entry the user already has. `now` and `random` are
 * injected so the function stays pure and testable.
 * VERIFIED by `sessionInstructions.test.ts` "generates a key the server accepts and skips taken
 * ones" (a `random` that first repeats a taken key; fabricated, Windows 11, 12/11/2026).
 */
export function newInstructionKey(
  taken: ReadonlySet<string>,
  now: number,
  random: () => number,
): string {
  for (;;) {
    const suffix = Math.floor(random() * 36 ** 4)
      .toString(36)
      .padStart(4, '0');
    const key = `${NOTE_PREFIX}${now.toString(36)}${suffix}`;
    if (!taken.has(key) && INSTRUCTION_KEY_PATTERN.test(key)) return key;
  }
}

/**
 * The entries the server listed as the views the webview shows, in the server's order. A string
 * value is shown as it is; any other JSON value is shown as its JSON text with `json: true`
 * (two-space indentation, so an object stays readable), because only the host's own notes are
 * strings and an entry from another client must still be visible and removable.
 * VERIFIED by `sessionInstructions.test.ts` "shows a string as it is and any other value as JSON"
 * (fabricated entries, Windows 11, 12/11/2026); a value another client really wrote was never seen.
 */
export function toInstructionViews(entries: readonly InstructionEntryInfo[]): InstructionView[] {
  return entries.map((entry) =>
    typeof entry.value === 'string'
      ? { key: entry.key, text: entry.value, json: false }
      : { key: entry.key, text: JSON.stringify(entry.value, null, 2), json: true },
  );
}

/**
 * What the host last listed for each session: the guard of `instructions.remove` ("only a key I
 * listed for that session") and the list it falls back to when a re-read fails. One per controller;
 * a session the host never listed has no keys, so every removal there is refused.
 * VERIFIED by `sessionInstructions.test.ts` "remembers what it listed per session" (fabricated,
 * Windows 11, 12/11/2026).
 */
export class InstructionLedger {
  private readonly listed = new Map<string, InstructionView[]>();

  /** Remembers `views` as the list of `sessionID`, replacing the previous one. */
  record(sessionID: string, views: readonly InstructionView[]): void {
    this.listed.set(sessionID, [...views]);
  }

  /** The last list recorded for `sessionID`, or `[]` when there is none. */
  viewsOf(sessionID: string): InstructionView[] {
    return [...(this.listed.get(sessionID) ?? [])];
  }

  /** The keys currently listed for `sessionID`. */
  keysOf(sessionID: string): Set<string> {
    return new Set((this.listed.get(sessionID) ?? []).map((view) => view.key));
  }

  /** True when `key` is one of the keys listed for `sessionID`. */
  lists(sessionID: string, key: string): boolean {
    return (this.listed.get(sessionID) ?? []).some((view) => view.key === key);
  }

  /** Forgets everything listed for `sessionID` (it was deleted, or the server went away). */
  forget(sessionID: string): void {
    this.listed.delete(sessionID);
  }

  /** Forgets every session (the server went away: the next list is read afresh). */
  clear(): void {
    this.listed.clear();
  }
}
