// The Markdown transcript of a session for the "Export" action (issue #188, plan Engram #2314).
// PURE: no `vscode`, no client calls; `chatController.ts` hands it the server's export and gives the
// text to the save dialog.
//
// Why the host builds it: the server has NO Markdown export. `session.export` answers the
// structured `SessionTransferData` (`{ info, messages }`, settled messages only), and the TUI
// writes its Markdown on the client with `formatSessionTranscript` (`packages/tui/src/routes/
// session/index.tsx` of the v2.2.7 tag, read). This module follows the same outline (title,
// metadata, then one section per turn) without copying it: header lines, `## User` and `## Assistant
// (agent · model)` sections, tool calls as one bullet each, reasoning only on request.
//
// Line endings are always `\n`, whatever the platform, so the file is the same on Windows, macOS
// and Linux (architecture rule 7); the text of the messages is written as the server stored it.

import type {
  SessionMessageAssistant,
  SessionMessageCompaction,
  SessionMessageInfo,
  SessionMessageShell,
  SessionMessageUser,
  SessionTransferData,
} from '@opencode/client';

/** Longest argument of a tool bullet; longer ones are cut with an ellipsis. Our choice: one readable line. */
const MAX_TOOL_ARGUMENT = 120;

/**
 * Input keys that name what a tool acted on, in the order tried. Our choice, from the tool inputs
 * the host already summarises in the webview (`toolSummary`): a file path, a command, a pattern, a
 * URL. A tool with none of them is listed by name only.
 */
const TOOL_ARGUMENT_KEYS = [
  'filePath',
  'path',
  'file',
  'command',
  'pattern',
  'url',
  'query',
  'description',
] as const;

/**
 * One file to save from the "Export" action: the proposed name (with its extension, no directory),
 * its whole text and the folder the server serves (where the save dialog opens). Lives here, not in
 * `sessionExportUi.ts`, because the controller and the tests use it and must not import `vscode`.
 */
export interface ExportFile {
  suggestedName: string;
  content: string;
  folder: string | undefined;
}

/** What {@link formatSessionTranscript} can include beyond the default. */
export type TranscriptOptions = {
  /** Include the model's reasoning blocks. Off by default: it is long and rarely wanted. */
  includeReasoning?: boolean;
};

/**
 * A code fence for `text`: backticks, one more than the longest run of backticks inside it (and at
 * least three), so the content cannot close the block early.
 */
function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/** `text` on one line (whitespace collapsed), cut to {@link MAX_TOOL_ARGUMENT} characters. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_TOOL_ARGUMENT ? flat : `${flat.slice(0, MAX_TOOL_ARGUMENT - 1)}…`;
}

/** The first string input of a tool call among {@link TOOL_ARGUMENT_KEYS}, on one line, or `''`. */
function toolArgument(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const record = input as Record<string, unknown>;
  for (const key of TOOL_ARGUMENT_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return oneLine(value);
  }
  return '';
}

/** One bullet for a tool block: `- tool: argument (status)`, the argument left out when there is none. */
function toolBullet(block: Extract<SessionMessageAssistant['content'][number], { type: 'tool' }>) {
  const argument = toolArgument(block.state.status === 'streaming' ? undefined : block.state.input);
  return `- ${block.name}${argument === '' ? '' : `: ${argument}`} (${block.state.status})`;
}

/** The `## User` section of a user message, with the names of its attachments. */
function userSection(message: SessionMessageUser): string {
  const names = (message.files ?? []).map((file) => file.name).filter((name) => name !== undefined);
  const files = names.length === 0 ? '' : `\n\nAttached: ${names.join(', ')}`;
  return `## User\n\n${message.text}${files}`;
}

/** The `## Assistant (agent · provider/model)` section: text blocks, optional reasoning, tool bullets. */
function assistantSection(message: SessionMessageAssistant, options: TranscriptOptions): string {
  const parts: string[] = [];
  const bullets: string[] = [];
  const flushBullets = (): void => {
    if (bullets.length === 0) return;
    parts.push(bullets.join('\n'));
    bullets.length = 0;
  };
  for (const block of message.content) {
    if (block.type === 'tool') {
      bullets.push(toolBullet(block));
      continue;
    }
    flushBullets();
    if (block.type === 'text' && block.text.trim() !== '') parts.push(block.text);
    if (
      block.type === 'reasoning' &&
      options.includeReasoning === true &&
      block.text.trim() !== ''
    ) {
      parts.push(`_Thinking:_\n\n${block.text}`);
    }
  }
  flushBullets();
  const heading = `## Assistant (${message.agent} · ${message.model.providerID}/${message.model.id})`;
  return parts.length === 0 ? heading : `${heading}\n\n${parts.join('\n\n')}`;
}

/** The `## Shell` section: the command and how it ended, never its output (it can be huge). */
function shellSection(message: SessionMessageShell): string {
  const fence = fenceFor(message.command);
  const exit = message.exit === undefined ? '' : ` (exit ${String(message.exit)})`;
  return `## Shell\n\n${fence}\n$ ${message.command}\n${fence}\n\n${message.status}${exit}`;
}

/** The `## Compaction` section: the summary of a completed compaction, one line for the others. */
function compactionSection(message: SessionMessageCompaction): string {
  if (message.status === 'completed')
    return `## Compaction (${message.reason})\n\n${message.summary}`;
  return `## Compaction (${message.reason})\n\n${message.status}`;
}

/**
 * The Markdown transcript of an exported session: a title, the session id and its dates (a bullet
 * list, one item each: Markdown folds consecutive plain lines into one paragraph), then one
 * `---`-separated section per user message, assistant message (text, tool bullets, reasoning when
 * `includeReasoning`), shell command and compaction, in the order the server gave them. The other
 * kinds (agent, model and location switches, synthetic and system messages, skills, idle markers)
 * are left out: they are not part of the conversation the user read. Ends with exactly one `\n`.
 * A session without a title is called "Untitled session". The dates are ISO 8601 in UTC, so the
 * file does not depend on the machine's time zone.
 * VERIFIED by `sessionTranscript.test.ts` (an export fabricated from the types of
 * `@opencode/client@2.2.7`: user with files, assistant with text, reasoning and a tool of each
 * status, shell, compaction and the skipped kinds; Windows 11, 12/11/2026). HYPOTHESIS: the shapes a
 * real server stores (a tool `input` without any of the argument keys, a `shell` with no `exit`)
 * were read in the types, never exported from a real session; the opt-in case of
 * `realOpencode.test.ts` only checks the export has messages.
 */
export function formatSessionTranscript(
  data: SessionTransferData,
  options: TranscriptOptions = {},
): string {
  const { info } = data;
  const title =
    info.title !== undefined && info.title.trim() !== '' ? info.title : 'Untitled session';
  const sections: string[] = [
    `# ${title}\n\n- **Session:** ${info.id}\n- **Created:** ${new Date(info.time.created).toISOString()}\n- **Updated:** ${new Date(info.time.updated).toISOString()}`,
  ];
  for (const message of data.messages) {
    const section = sectionOf(message, options);
    if (section !== undefined) sections.push(section);
  }
  return `${sections.join('\n\n---\n\n')}\n`;
}

/** The section of one message, or `undefined` for a kind the transcript leaves out. */
function sectionOf(message: SessionMessageInfo, options: TranscriptOptions): string | undefined {
  switch (message.type) {
    case 'user':
      return userSection(message);
    case 'assistant':
      return assistantSection(message, options);
    case 'shell':
      return shellSection(message);
    case 'compaction':
      return compactionSection(message);
    default:
      return undefined;
  }
}
