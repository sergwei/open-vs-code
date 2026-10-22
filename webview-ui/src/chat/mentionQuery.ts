// Pure text logic of the @ mentions (issue #28): where the mention being typed starts and ends,
// what the prompt text becomes when a result is picked, and where each attached file's `@path`
// sits in the final text. No DOM and no Solid: `mentionQuery.test.ts` drives it directly.
import {
  MAX_FILE_SEARCH_LENGTH,
  type AttachmentRef,
  type PromptFileRef,
} from '../../../src/shared/protocol';

/**
 * The mention being typed: the `@` at `start`, the text to search (`query`, from after the `@` up
 * to the caret) and `end`, where the word really finishes (the first whitespace at or after the
 * caret), so picking a result replaces the whole word and leaves no tail of the old one.
 */
export interface MentionToken {
  start: number;
  end: number;
  query: string;
}

/** True for the whitespace characters that end a word of the prompt (space, tab, line breaks...). */
function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

/**
 * Finds the mention under the caret, or `undefined` when the caret is not inside one.
 *
 * A mention starts with an `@` that opens the text or follows whitespace (so `a@b` and an e-mail
 * address never open the popup) and runs without whitespace up to the caret; the first `@` found
 * walking back from the caret decides, so `@a@b` is not a mention of `b`. A query longer than the
 * protocol cap (`MAX_FILE_SEARCH_LENGTH`) is not a mention either: the host would refuse it. The
 * query may be empty (`@` alone), which the UI answers with a hint, not a search. VERIFIED by
 * `mentionQuery.test.ts` with fabricated texts, and by typing `@sample` with the real keyboard in
 * a real VS Code 1.143.0 on Windows 11 (22/10/2026, `test:visual` step 16: "typing "@sample" lists
 * at least two files"). NOT observed: an `@` in the middle of a multi-line draft with the real
 * keyboard, an IME.
 */
export function findMention(text: string, caret: number): MentionToken | undefined {
  if (caret < 1 || caret > text.length) return undefined;
  for (let index = caret - 1; index >= 0; index--) {
    const char = text[index];
    if (isSpace(char)) return undefined;
    if (char !== '@') continue;
    if (index > 0 && !isSpace(text[index - 1])) return undefined;
    const query = text.slice(index + 1, caret);
    if (query.length > MAX_FILE_SEARCH_LENGTH) return undefined;
    let end = caret;
    while (end < text.length && !isSpace(text[end])) end++;
    return { start: index, end, query };
  }
  return undefined;
}

/**
 * The text after picking `name` for `token`: the word is replaced by `@name` and a space (none is
 * added when whitespace already follows), and the caret goes after it. The `@path` stays in the
 * text on purpose (decision Q1 of Sergio, 22/10/2026: the convention of the opencode TUI), next to
 * the chip: the model reads where each file is cited. Chip and text are independent from here on:
 * deleting one does not delete the other (see {@link mentionsFor}).
 */
export function applyMention(
  text: string,
  token: MentionToken,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name}`;
  const needsSpace = !isSpace(text[token.end]);
  const tail = needsSpace ? ` ${text.slice(token.end)}` : text.slice(token.end);
  const next = `${text.slice(0, token.start)}${inserted}${tail}`;
  return { text: next, caret: token.start + inserted.length + 1 };
}

/**
 * True when a mention may end at `end`: the text ends there, or whitespace or closing punctuation
 * follows. A dot counts only as the end of a sentence (end of text or whitespace after it), so the
 * mention `@a.ts` is not found inside `@a.ts.bak`.
 */
function endsMention(text: string, end: number): boolean {
  const after = text[end];
  if (after === undefined || isSpace(after)) return true;
  if (after === '.') return end + 1 >= text.length || isSpace(text[end + 1]);
  return /[,;:!?)\]}'"]/.test(after);
}

/**
 * Pairs each file with the `{start, end, text}` of its `@name` in `text`, for `prompt.send`.
 *
 * Why computed at send time and not stored when a result is picked: the user keeps editing the
 * text after picking, so offsets taken then would be stale. For each file, in order, the first
 * `@name` that starts the text or follows whitespace, ends the word (see `endsMention`) and does
 * not overlap one already claimed, gets the mention. A file whose `@name` is not in the text (the user
 * deleted it, or the chip came from Attach or Add selection, which write no text) goes without
 * one, and an `@name` whose chip was removed is just text: the two never constrain each other.
 * Offsets are UTF-16 indexes into `text`, so the caller must pass the exact string it sends.
 * HYPOTHESIS that the server accepts any such offsets: the planner's spike stored a mention
 * untouched (opencode 2.0.32) but did not probe an inconsistent one; the host drops a mention
 * whose text does not match the prompt.
 */
export function mentionsFor(text: string, files: readonly AttachmentRef[]): PromptFileRef[] {
  const claimed: Array<{ start: number; end: number }> = [];
  return files.map((file) => {
    const marker = `@${file.name}`;
    let from = 0;
    for (;;) {
      const start = text.indexOf(marker, from);
      if (start === -1) return { uri: file.uri, name: file.name };
      from = start + 1;
      const end = start + marker.length;
      const startsWord = start === 0 || isSpace(text[start - 1]);
      const overlaps = claimed.some((range) => start < range.end && end > range.start);
      if (startsWord && endsMention(text, end) && !overlaps) {
        claimed.push({ start, end });
        return { uri: file.uri, name: file.name, mention: { start, end, text: marker } };
      }
    }
  });
}
