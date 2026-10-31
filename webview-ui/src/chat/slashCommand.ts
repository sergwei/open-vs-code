// Pure text logic of the slash commands (issue #33): where the `/command` being typed starts and
// ends, how the list is filtered, which command a finished prompt runs, and what the prompt text
// becomes when a command is chosen. No DOM and no Solid: `slashCommand.test.ts` drives it directly.
import type { CommandOption } from '../../../src/shared/model';

/**
 * Slash commands the webview itself carries out (issue #125, decision P1=1 of Sergio, 31/10/2026):
 * the server has no `compact` command, so `/compact` is a client command like upstream's app
 * (`session.compact`, read in `use-session-commands.tsx@843a6c51`). They go through
 * `session.compact`, never through `prompt.send`.
 */
export const CLIENT_COMMANDS: readonly CommandOption[] = [
  { name: 'compact', description: 'Summarize the conversation to free context' },
];

/**
 * The server's command list with the client commands appended, so the "/" menu and the popup list
 * them. One the server also lists wins (a project command called `compact` keeps working as the
 * server's). An absent list stays absent: it must keep saying "Loading…" or "could not be loaded".
 */
export function withClientCommands(
  list: readonly CommandOption[] | undefined,
): readonly CommandOption[] | undefined {
  if (list === undefined) return undefined;
  return [...list, ...CLIENT_COMMANDS.filter((own) => !list.some((it) => it.name === own.name))];
}

/** True when `name` is carried out by the webview: a client command that the server does not list. */
export function isClientCommand(
  name: string,
  serverList: readonly CommandOption[] | undefined,
): boolean {
  return (
    CLIENT_COMMANDS.some((own) => own.name === name) &&
    !(serverList ?? []).some((it) => it.name === name)
  );
}

/**
 * The command word being typed: the text between the leading `/` and the caret (`query`) and `end`,
 * where that first word really finishes (the first whitespace at or after the caret), so choosing a
 * command replaces the whole word and leaves no tail of the old one.
 */
export interface SlashToken {
  end: number;
  query: string;
}

/** True for the whitespace characters that end the first word of the prompt. */
function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

/**
 * Finds the command word under the caret, or `undefined` when the caret is not inside it.
 *
 * Upstream's rule (opencode `client-slash-command.ts`, read in the plan of #33): the `/` must be the
 * first character of the text and the caret must still be in the first word, so `a /x`, a caret
 * after the first space and a bare text never open the popup. The query may be empty (`/` alone).
 * VERIFIED by `slashCommand.test.ts` with fabricated texts, and typed with a real keyboard
 * (Windows 11, VS Code 1.144.0, 28/10/2026) by the `test:visual` check "C2 typing" "/" opens the
 * popup with the rows /hello and its description (full text in `run.mjs`).
 */
export function findSlash(text: string, caret: number): SlashToken | undefined {
  if (text[0] !== '/' || caret < 1 || caret > text.length) return undefined;
  for (let index = 1; index < caret; index++) {
    if (isSpace(text[index])) return undefined;
  }
  let end = caret;
  while (end < text.length && !isSpace(text[end])) end++;
  return { end, query: text.slice(1, caret) };
}

/**
 * The commands that match `query`, case-insensitively: a name EQUAL to it first (so `/review` +
 * Tab picks `review`, not a `review-pr` the server listed before it), then the ones whose name
 * STARTS with it, then the ones that merely contain it, each group in the order the server listed
 * them. An empty query returns the whole list.
 */
export function filterCommands(
  list: readonly CommandOption[],
  query: string,
): readonly CommandOption[] {
  const needle = query.toLowerCase();
  if (needle === '') return list;
  const exact: CommandOption[] = [];
  const prefix: CommandOption[] = [];
  const inside: CommandOption[] = [];
  for (const command of list) {
    const name = command.name.toLowerCase();
    if (name === needle) exact.push(command);
    else if (name.startsWith(needle)) prefix.push(command);
    else if (name.includes(needle)) inside.push(command);
  }
  return [...exact, ...prefix, ...inside];
}

/**
 * Which command `text` runs, or `undefined` when it runs none (a normal prompt, decision P4=1).
 *
 * The match is the LONGEST listed `name` such that the text starts with `/name` followed by
 * whitespace or the end of the text, case-sensitively like the server: that is how names with `/`,
 * `:` or a space (`docs:search`, `a/b`, `my cmd`) work without guessing where the name ends. `args`
 * is the rest without its leading whitespace. `/initx` is not `init`. An absent list (`undefined`,
 * the catalog never arrived or `command.list` failed) runs nothing.
 */
export function parseCommand(
  text: string,
  list: readonly CommandOption[] | undefined,
): { name: string; args: string } | undefined {
  if (list === undefined || text[0] !== '/') return undefined;
  let best: string | undefined;
  for (const { name } of list) {
    if (!text.startsWith(`/${name}`)) continue;
    if (!(text.length === name.length + 1 || isSpace(text[name.length + 1]))) continue;
    if (best === undefined || name.length > best.length) best = name;
  }
  if (best === undefined) return undefined;
  return { name: best, args: text.slice(best.length + 1).trimStart() };
}

/**
 * The text after choosing `name` (decision P3=1): `/name ` at the start and the caret behind it.
 * A draft that already starts with `/other args` has that first token replaced and keeps its
 * arguments; any other text is kept as the arguments after the command.
 */
export function applyCommand(text: string, name: string): { text: string; caret: number } {
  const head = `/${name} `;
  if (text === '') return { text: head, caret: head.length };
  if (text[0] !== '/') return { text: `${head}${text}`, caret: head.length };
  let end = 1;
  while (end < text.length && !isSpace(text[end])) end++;
  const rest = text.slice(end).trimStart();
  return { text: `${head}${rest}`, caret: head.length };
}
