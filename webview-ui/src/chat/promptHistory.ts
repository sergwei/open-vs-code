/**
 * Recall of previous prompts with the arrow keys (issue #13). PURE: no DOM and no Solid; the
 * input component owns the textarea and the persistence goes through `uiState.ts`.
 */

/** Most prompts kept. Our own figure (the plan's): enough to scroll back, small to persist. */
export const MAX_HISTORY = 50;

/** Cursor over the sent prompts, oldest first. */
export interface PromptHistory {
  /** Copy of the stored prompts, oldest first (what gets persisted). */
  entries(): string[];
  /** Adds a sent prompt: blank text and a repeat of the newest entry are ignored. Ends browsing. */
  push(text: string): void;
  /**
   * Moves to the previous (older) prompt and returns it, or `undefined` at the oldest one (or
   * with no history). The first call of a browse remembers `currentDraft` for {@link next}.
   */
  prev(currentDraft: string): string | undefined;
  /**
   * Moves to the next (newer) prompt. Past the newest it returns the draft saved by the first
   * {@link prev}, and ends browsing. `undefined` when not browsing.
   */
  next(): string | undefined;
  /** Ends browsing without restoring anything (the user edited the text). */
  reset(): void;
}

/** Creates a history seeded with `entries` (oldest first), trimmed to the newest `max`. */
export function createHistory(
  entries: readonly string[],
  max: number = MAX_HISTORY,
): PromptHistory {
  let items = entries.slice(-max);
  let cursor = items.length;
  let savedDraft = '';
  return {
    entries: () => [...items],
    push(text) {
      cursor = items.length;
      savedDraft = '';
      if (text.trim() === '' || items.at(-1) === text) return;
      items = [...items, text].slice(-max);
      cursor = items.length;
    },
    prev(currentDraft) {
      if (items.length === 0 || cursor === 0) return undefined;
      if (cursor === items.length) savedDraft = currentDraft;
      cursor -= 1;
      return items[cursor];
    },
    next() {
      if (cursor >= items.length) return undefined;
      cursor += 1;
      return cursor === items.length ? savedDraft : items[cursor];
    },
    reset() {
      cursor = items.length;
      savedDraft = '';
    },
  };
}
