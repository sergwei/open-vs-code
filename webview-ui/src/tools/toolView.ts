/**
 * View model of a tool call (issue #26): turns a `tool` block of the store into what its card
 * shows, without touching the DOM or Solid so Vitest drives every tool name with plain objects.
 *
 * Two outputs: {@link toolSummary} (the one-line header: verb, main argument, short result,
 * status, accessible name) and {@link toolBody} (the sections of the unfolded card). Everything
 * read from `input` and `metadata` goes through the tolerant `stringAt`/`numberAt`/`filesAt`
 * helpers: the protocol hands them over as free JSON (`isHostToWebview` is shallow on purpose), so
 * a wrong shape must degrade to the generic view and never throw.
 *
 * Provenance of the shapes (2.0.32, tag 843a6c51, `packages/core/src/tool/plugin/*.ts`, READ with
 * `gh api`, plan Engram #1035 section 4). The unit tests (`toolView.test.ts`) use fabricated
 * blocks, so they confirm the mapping and say nothing about the server.
 *
 * VERIFIED against a real opencode 2.0.32 on Windows 11, VS Code 1.143.0, 22/10/2026, by step 15
 * of `test:visual` (the final run, 13:59:27-14:05, the model `opencode/glm-5.3-flash-free`; console
 * output kept in `.vscode-test/visual/run-output.txt`, "all visual checks passed", 326 `ok` lines, 0
 * FAIL; log `.vscode-test/visual/user-data/logs/20261022T135923/window1/exthost/sergwei.open-vs-code/OpenCode.log`,
 * the combined step-15 prompt is `prompt accepted` 14:04:11.728 to `turn finished: succeeded`
 * 14:04:17.265 and the failing-read prompt 14:04:37.157 to 14:04:38.484).
 * What that run printed for the four tools it made the model call (`run-output.txt` lines 304-311,
 * `cards:` and `header:`):
 * - shell `node --version`: header "Shell node --version · done · exit 0" and a body with the command
 *   and the output "v24.22.0" (check "the shell body shows the output of node --version").
 * - read `src/sample.ts`: header "Read src/sample.ts · done · lines 1-30" and the file contents with
 *   `N: ` line prefixes in the body (check "the read body shows the contents of src/sample.ts").
 * - grep `greet` in `src`: header "Grep greet in src · done · 1 match"; the body parsed into 1 group
 *   with a path button and a line button (line 345 "grep matches: 1 grouped, 2 path buttons"); the
 *   path came back ABSOLUTE (`c:\Users\...\src\sample.ts`), not relative.
 * - edit of `value2 = 2;`: header "Edit src/sample.ts · done · +1 −1" and a body with 1 hunk line, 1
 *   added and 1 deleted line, headers removed (line 336 "edit hunk lines: 1" and the check "the edit
 *   body is a diff with added (1) and deleted (1) lines"), so the real `metadata.files[].patch` has
 *   the `@@` shape `parsePatch` expects.
 * - a REAL failed call, read of the missing `src/does-not-exist.ts` (lines 376-383): header "Read
 *   src/does-not-exist.ts · failed · File not found: src/does-not-exist.ts", error tone, folded by
 *   default, and once unfolded the body contains that same line.
 * NOT observed: which source produced "1 match" (`metadata.matches` or the "Found N matches" text)
 * and "+1 −1" (the counters or the patch fallback): each branch is covered only by fabricated unit
 * tests. Never observed in a real run: write, patch, glob, webfetch, websearch, skill, question and
 * MCP cards, a shell with a non-zero exit, signal or timeout (the notice items such as "Exited with
 * code 1", see `isShellNotice`), a background shell, a read of a directory or an image, a tool in
 * `running`, `awaiting`, `rejected` or `stopped` state, a CRLF patch and ANSI output. macOS and Linux
 * are UNVERIFIED.
 */
import type { ErrorInfo, JsonObject, JsonValue, Part } from '../../../src/shared/model';
import { deriveToolOutcome } from '../requests/toolOutcome';
import { isStopError } from '../store/activity';
import {
  allAdded,
  basename,
  parsePatch,
  replacement,
  stripAnsi,
  type DiffLine,
} from './patchLines';

type ToolPart = Extract<Part, { type: 'tool' }>;

/** What the card says about the call, in one word (the text of the status chip). */
export type ToolStatus =
  | 'pending'
  | 'running'
  | 'awaiting'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'dismissed'
  | 'stopped';

/** Status of a card: the machine word, the visible text, and whether it is painted as an error. */
export interface StatusView {
  status: ToolStatus;
  label: string;
  /** `error` only for a real failure: a Reject or a Stop is a decision, not an error (lesson #934). */
  tone: 'neutral' | 'error';
}

/** A file the header can open in the editor, with an optional 1-based line. */
export interface OpenTarget {
  path: string;
  line?: number;
}

/** The one-line summary of a card. */
export interface ToolSummary {
  /** "Shell", "Read", "Edit"... or the tool name when unknown. */
  verb: string;
  /** Main argument: the command, the path, the pattern, the URL. */
  arg?: string;
  /** Second argument ("in src", the agent of a subagent). */
  detail?: string;
  /** Short result ("exit 1", "+3 -1", "4 matches", the first line of an error). */
  result?: string;
  status: StatusView;
  /** Path the header offers to open, for read, edit and write. */
  open?: OpenTarget;
  /** The whole header as ONE string, for the accessible name (lesson #926). */
  name: string;
}

/** One file of a `metadata.files` list, as far as the card needs it. */
export interface FileDiff {
  file: string;
  patch?: string;
  additions?: number;
  deletions?: number;
}

/** One file's matches of a `grep` result. */
export interface MatchGroup {
  path: string;
  hits: { line?: number; text: string }[];
}

/** A block of the unfolded card. */
export type BodySection =
  | { kind: 'code'; label: string; text: string; from: 'head' | 'tail'; language?: string }
  | { kind: 'diff'; label: string; path?: string; lines: DiffLine[] }
  | { kind: 'paths'; label: string; paths: string[] }
  | { kind: 'matches'; label: string; groups: MatchGroup[] }
  | { kind: 'note'; text: string }
  | { kind: 'error'; text: string };

/**
 * Longest main argument kept in a header; the CSS ellipsizes the rest.
 *
 * Chosen by the developer while implementing #26 (the plan, Engram #1035, set no figure) as "enough
 * for a command or a path in a side bar without storing a whole script in the DOM". Not measured
 * against real commands or paths: the visible width is decided by the CSS ellipsis, this only caps
 * the text (and the accessible name) of an unusually long first line.
 */
const ARG_MAX_CHARS = 80;

/** Titles by tool name. Names are those of opencode 2.0.32 (`bash` is `shell`, `task` is `subagent`). */
const VERBS: Readonly<Record<string, string>> = {
  shell: 'Shell',
  read: 'Read',
  edit: 'Edit',
  write: 'Write',
  patch: 'Patch',
  grep: 'Grep',
  glob: 'Glob',
  webfetch: 'Fetch',
  websearch: 'Search',
  skill: 'Skill',
  question: 'Question',
  subagent: 'Subagent',
};

type Json = { readonly [key: string]: JsonValue } | undefined;

/** The string under `key`, or `undefined` when it is missing or not a string. */
export function stringAt(object: Json, key: string): string | undefined {
  const value = object?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** The finite number under `key`, or `undefined`. */
export function numberAt(object: Json, key: string): number | undefined {
  const value = object?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The array under `key`, or `undefined`. */
function arrayAt(object: Json, key: string): JsonValue[] | undefined {
  const value = object?.[key];
  return Array.isArray(value) ? value : undefined;
}

/** `value` as an object, or `undefined` for anything else (arrays and null included). */
function asRecord(value: JsonValue | undefined): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

/**
 * The entries of `metadata.files` that look like `{ file, patch, additions, deletions }`. An entry
 * with no string `file` is skipped; the other fields are optional. Never throws.
 */
export function filesAt(metadata: Json): FileDiff[] {
  const result: FileDiff[] = [];
  for (const entry of arrayAt(metadata, 'files') ?? []) {
    const record = asRecord(entry);
    const file = stringAt(record, 'file');
    if (file === undefined) continue;
    const item: FileDiff = { file };
    const patch = stringAt(record, 'patch');
    if (patch !== undefined) item.patch = patch;
    const additions = numberAt(record, 'additions');
    if (additions !== undefined) item.additions = additions;
    const deletions = numberAt(record, 'deletions');
    if (deletions !== undefined) item.deletions = deletions;
    result.push(item);
  }
  return result;
}

/** First line of `text` trimmed, cut to `max` characters with an ellipsis. */
function short(text: string, max = ARG_MAX_CHARS): string {
  const line = (text.split(/\r?\n/)[0] ?? '').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Parsed input of the block, or `undefined` while the JSON is still arriving. */
function inputOf(part: ToolPart): JsonObject | undefined {
  return part.state.status === 'streaming' ? undefined : part.state.input;
}

/** Metadata of the block, or `undefined` when it has none (or is still streaming). */
function metadataOf(part: ToolPart): JsonObject | undefined {
  return part.state.status === 'streaming' ? undefined : part.state.metadata;
}

/** The text items of the block's output, in order; none while it has no output. */
function outputTexts(part: ToolPart): string[] {
  const state = part.state;
  if (state.status !== 'completed' && state.status !== 'error') return [];
  const items = state.status === 'completed' ? state.output : (state.output ?? []);
  const texts: string[] = [];
  for (const item of items) if (item.type === 'text') texts.push(item.text);
  return texts;
}

/** The file items of the output as "name (mime)" notes: the bytes never reach the webview. */
function outputFiles(part: ToolPart): string[] {
  const state = part.state;
  if (state.status !== 'completed' && state.status !== 'error') return [];
  const items = state.status === 'completed' ? state.output : (state.output ?? []);
  const notes: string[] = [];
  for (const item of items) {
    if (item.type === 'file') notes.push(`File: ${item.name ?? 'unnamed'} (${item.mime})`);
  }
  return notes;
}

/** Extension of `path` in lower case, without the dot; `undefined` for none. */
function extensionOf(path: string): string | undefined {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? undefined : name.slice(dot + 1).toLowerCase();
}

/** `n` followed by the noun, singular for 1. */
function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${String(n)} ${n === 1 ? singular : plural}`;
}

/** "+3 −1" from the counters of the files, or `undefined` when none is known. */
function changeCounts(files: FileDiff[]): string | undefined {
  if (files.length === 0) return undefined;
  let added = 0;
  let removed = 0;
  for (const file of files) {
    if (file.additions !== undefined || file.deletions !== undefined) {
      added += file.additions ?? 0;
      removed += file.deletions ?? 0;
    } else if (file.patch !== undefined) {
      for (const line of parsePatch(file.patch)) {
        if (line.kind === 'add') added += 1;
        else if (line.kind === 'del') removed += 1;
      }
    }
  }
  return `+${String(added)} −${String(removed)}`;
}

/**
 * Status of a tool block.
 *
 * `streaming` is "pending" (the input is still arriving); `running` is "waiting for approval"
 * while a permission or question of this tool is pending (`awaiting`, computed by the caller from
 * the pending requests), else "running"; `completed` is "done". An `error` is told apart with
 * {@link deriveToolOutcome} (a rejection or a dismissed question is "rejected"/"dismissed") and
 * `isStopError` (`aborted`: a Stop, "stopped"); only the rest is "failed", the one status painted
 * as an error. Every status has its own word because colour alone is not an accessible signal.
 * VERIFIED by `toolView.test.ts` (fabricated blocks, including the real rejected row copied in
 * `toolOutcome.test.ts`); how a screen reader reads the words is UNVERIFIED.
 */
export function toolStatus(part: ToolPart, awaiting: boolean): StatusView {
  const state = part.state;
  switch (state.status) {
    case 'streaming':
      return { status: 'pending', label: 'pending', tone: 'neutral' };
    case 'running':
      return awaiting
        ? { status: 'awaiting', label: 'waiting for approval', tone: 'neutral' }
        : { status: 'running', label: 'running', tone: 'neutral' };
    case 'completed':
      return { status: 'completed', label: 'done', tone: 'neutral' };
    case 'error': {
      const outcome = deriveToolOutcome(part);
      if (outcome?.kind === 'permission') {
        return { status: 'rejected', label: 'rejected', tone: 'neutral' };
      }
      if (outcome?.kind === 'question') {
        return { status: 'dismissed', label: 'dismissed', tone: 'neutral' };
      }
      if (isStopError(state.error)) return { status: 'stopped', label: 'stopped', tone: 'neutral' };
      return { status: 'failed', label: 'failed', tone: 'error' };
    }
  }
}

/**
 * True for the one-line notices the shell tool appends to its content, wherever they sit.
 *
 * The server builds the content as `[output?, notice?]` (`tool/plugin/shell.ts` L80-81 of tag
 * 843a6c51, READ with `gh api` by the reviewer, Engram #1039 W1), so a command with an empty output
 * yields the notice ALONE at index 0. The wordings are those three; the match is anchored so a
 * command that merely prints "Exited with code 1" among other text is still output.
 * HYPOTHESIS: the exact wordings come from that read; none was observed in a real run (the real
 * shell call of `test:visual` exited 0, which adds no notice). Check against a failing real command.
 */
function isShellNotice(text: string): boolean {
  return /^(Exited with code -?\d+|Killed by \S+|Timed out before completion)$/.test(text);
}

/** Result text of a shell block: the exit code, a signal, a timeout, or background work. */
function shellResult(part: ToolPart): string | undefined {
  const metadata = metadataOf(part);
  if (stringAt(metadata, 'status') === 'running' && part.state.status === 'completed') {
    return 'running in background';
  }
  const exit = numberAt(metadata, 'exit');
  if (exit !== undefined) return `exit ${String(exit)}`;
  const signal = stringAt(metadata, 'signal');
  if (signal !== undefined) return `signal ${signal}`;
  if (metadata?.['timeout'] === true) return 'timed out';
  for (const text of outputTexts(part)) {
    const match = /^Exited with code (-?\d+)$/.exec(text);
    if (match?.[1] !== undefined) return `exit ${match[1]}`;
  }
  return undefined;
}

/** The parts of a summary that do not depend on the status. */
type HeaderParts = Pick<ToolSummary, 'verb' | 'arg' | 'detail' | 'result' | 'open'>;

/** Verb, argument, detail, result and openable path of a block, without its status. */
function headerParts(part: ToolPart): HeaderParts {
  const verb = Object.hasOwn(VERBS, part.name) ? (VERBS[part.name] ?? part.name) : part.name;
  const input = inputOf(part);
  if (input === undefined) return { verb };
  const metadata = metadataOf(part);
  const parts: HeaderParts = { verb };
  const arg = (value: string | undefined): void => {
    if (value !== undefined && value.trim() !== '') parts.arg = short(value);
  };
  switch (part.name) {
    case 'shell':
      arg(stringAt(input, 'command'));
      parts.result = shellResult(part);
      break;
    case 'read': {
      const path = stringAt(input, 'path') ?? stringAt(input, 'filePath');
      arg(path);
      const first = outputTexts(part)[0] ?? '';
      const lines = /lines (\d+-\d+)/.exec(short(first, 200));
      if (/^Read directory/.test(first)) parts.result = 'directory';
      else if (lines?.[1] !== undefined) parts.result = `lines ${lines[1]}`;
      else if (outputFiles(part).length > 0) parts.result = 'file';
      if (path !== undefined && !/^Read directory/.test(first)) {
        parts.open = { path };
        const offset = numberAt(input, 'offset');
        if (offset !== undefined && offset >= 1) parts.open.line = Math.floor(offset);
      }
      break;
    }
    case 'edit': {
      const path = stringAt(input, 'path') ?? stringAt(input, 'filePath');
      arg(path);
      parts.result = changeCounts(filesAt(metadata));
      if (path !== undefined) parts.open = { path };
      break;
    }
    case 'write': {
      const path = stringAt(input, 'path') ?? stringAt(input, 'filePath');
      arg(path);
      const content = stringAt(input, 'content');
      if (content !== undefined) parts.result = count(allAdded(content).length, 'line');
      if (path !== undefined) parts.open = { path };
      break;
    }
    case 'patch': {
      const files = filesAt(metadata);
      if (files.length === 1 && files[0] !== undefined) arg(files[0].file);
      else if (files.length > 1) arg(count(files.length, 'file'));
      parts.result = changeCounts(files);
      break;
    }
    case 'grep': {
      arg(stringAt(input, 'pattern'));
      const where = stringAt(input, 'path');
      if (where !== undefined && where !== '') parts.detail = `in ${short(where)}`;
      const matches = numberAt(metadata, 'matches');
      if (matches !== undefined) parts.result = count(matches, 'match', 'matches');
      else {
        const found = /Found (\d+) match/.exec(outputTexts(part)[0] ?? '');
        if (found?.[1] !== undefined) parts.result = count(Number(found[1]), 'match', 'matches');
      }
      break;
    }
    case 'glob': {
      arg(stringAt(input, 'pattern'));
      const where = stringAt(input, 'path');
      if (where !== undefined && where !== '') parts.detail = `in ${short(where)}`;
      const files = numberAt(metadata, 'count');
      if (files !== undefined) parts.result = count(files, 'file');
      break;
    }
    case 'webfetch':
      arg(stringAt(input, 'url'));
      break;
    case 'websearch':
      arg(stringAt(input, 'query'));
      break;
    case 'skill':
      arg(stringAt(input, 'name') ?? stringAt(metadata, 'name'));
      break;
    case 'question': {
      const first = asRecord(arrayAt(input, 'questions')?.[0]);
      arg(stringAt(first, 'header') ?? stringAt(first, 'question'));
      break;
    }
    case 'subagent': {
      arg(stringAt(input, 'description'));
      const agent = stringAt(input, 'agent');
      if (agent !== undefined) parts.detail = `(${agent})`;
      break;
    }
    default:
      for (const value of Object.values(input)) {
        if (typeof value === 'string' && value.trim() !== '') {
          arg(value);
          break;
        }
      }
  }
  return parts;
}

/**
 * The one-line summary of a tool block: verb, main argument, short result and status, plus the
 * same text as ONE accessible name ("Shell npm test · failed · exit 1"): subject, status and result
 * are separated by " · ", the same separator the card paints between them (decision of Sergio,
 * 22/10/2026, Engram #1042; the status keeps the word "done").
 *
 * Decision (b) of Sergio, 22/10/2026: the folded card must say what happened without opening it.
 * While the input still streams only the verb is known (the JSON is never parsed in pieces:
 * O(n^2) over the tokens). A failed block uses the first line of the error as its result; a
 * rejected, dismissed or stopped one shows none, because the request line under it already
 * explains it; a pending or waiting one shows none either (the result is not known yet).
 * VERIFIED by `toolView.test.ts` for the mapping (fabricated blocks). VERIFIED against a real
 * server for the five headers printed in the header of this file (shell, read, grep, edit and the
 * failed read of a missing file, `run-output.txt` lines 308-311 and 376); every other tool name,
 * and the rejected/stopped/awaiting statuses, are NOT observed in a real run (their headers are
 * fabricated-test only).
 */
export function toolSummary(part: ToolPart, awaiting: boolean): ToolSummary {
  const status = toolStatus(part, awaiting);
  const summary: ToolSummary = { ...headerParts(part), status, name: '' };
  if (status.status === 'failed' && part.state.status === 'error') {
    summary.result = short(part.state.error.message, 120);
  } else if (status.status !== 'completed' && status.status !== 'running') {
    delete summary.result;
  }
  const subject = [summary.verb, summary.arg, summary.detail]
    .filter((piece): piece is string => piece !== undefined)
    .join(' ');
  summary.name = [subject, status.label, summary.result]
    .filter((piece): piece is string => piece !== undefined && piece !== '')
    .join(' · ');
  return summary;
}

/** Text of an error as the body shows it: message plus its detail, when there is one. */
function errorText(error: ErrorInfo): string {
  return error.detail === undefined || error.detail === ''
    ? error.message
    : `${error.message}\n${error.detail}`;
}

/** Parses grep output: "path:" headings followed by indented "Line N: text" hits. */
function parseMatches(text: string): MatchGroup[] {
  const groups: MatchGroup[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '');
    const hit = /^\s+Line (\d+):\s?(.*)$/.exec(line);
    const current = groups[groups.length - 1];
    if (hit !== null && current !== undefined) {
      current.hits.push({ line: Number(hit[1]), text: hit[2] ?? '' });
      continue;
    }
    const heading = /^(\S.*):$/.exec(line);
    if (heading?.[1] !== undefined && !/^Found \d+ match/.test(line)) {
      groups.push({ path: heading[1], hits: [] });
    }
  }
  return groups.filter((group) => group.hits.length > 0);
}

/** Diff sections for edit and patch: the server's patches, else the input as a -old/+new block. */
function diffSections(part: ToolPart): BodySection[] {
  const input = inputOf(part);
  const files = filesAt(metadataOf(part)).filter((file) => file.patch !== undefined);
  if (files.length > 0) {
    return files.map((file) => ({
      kind: 'diff',
      label: file.file,
      path: file.file,
      lines: parsePatch(file.patch ?? ''),
    }));
  }
  const path = stringAt(input, 'path') ?? stringAt(input, 'filePath');
  const oldText = stringAt(input, 'oldString');
  const newText = stringAt(input, 'newString');
  if (oldText !== undefined && newText !== undefined) {
    const section: BodySection = {
      kind: 'diff',
      label: path ?? 'Change',
      lines: replacement(oldText, newText),
    };
    if (path !== undefined) section.path = path;
    return [section];
  }
  const patchText = stringAt(input, 'patchText');
  if (patchText !== undefined) {
    return [{ kind: 'code', label: 'Patch', text: patchText, from: 'head' }];
  }
  return [];
}

/**
 * The sections of the unfolded card of `part`.
 *
 * - `shell`: the command, its output (the TAIL is kept when clipped: the error is at the end and
 *   the server already sends the last 50 KiB) and the warning items ("Exited with code 1").
 * - `read`, `webfetch`, `websearch`, `subagent`: the text, clipped from the head.
 * - `edit`, `patch`: a mini diff per file of `metadata.files`; an `edit` without metadata (still
 *   running or failed) shows its input as "-old / +new" with no alignment; `write`: the whole
 *   content as added lines (the server sends no diff for it; upstream paints it the same way).
 * - `grep`: matches grouped by file; `glob`: one openable path per line.
 * - anything else, or a known tool whose input/metadata does not have the expected shape: the
 *   generic view (input as JSON, output as text), which is the safety net for MCP tools.
 * A failed block ends with an `error` section. While the input streams, a single note says so.
 * VERIFIED against a real server for the shell, read, grep and edit bodies (what the run printed
 * is in the header of this file) and for the text of the `error` section of a failed read (line 383
 * of `run-output.txt`: the unfolded body contains the error line; the section's look was not
 * judged); the bodies of every other tool are HYPOTHESIS. The generic fallback is what protects against being wrong, and `toolView.test.ts`
 * checks it with malformed data (fabricated, so it says nothing about real malformed output).
 */
export function toolBody(part: ToolPart): BodySection[] {
  const state = part.state;
  if (state.status === 'streaming') {
    return [{ kind: 'note', text: 'The tool input is still arriving.' }];
  }
  const sections: BodySection[] = [];
  const input = state.input;
  const texts = outputTexts(part);
  const output = texts.join('\n');
  const path = stringAt(input, 'path') ?? stringAt(input, 'filePath');
  let specific = true;
  switch (part.name) {
    case 'shell': {
      const command = stringAt(input, 'command');
      if (command === undefined) {
        specific = false;
        break;
      }
      sections.push({ kind: 'code', label: 'Command', text: command, from: 'head' });
      if (state.status === 'running') {
        sections.push({ kind: 'note', text: 'The output appears when the command finishes.' });
      } else {
        // The output is the first item that is not a server notice: with an empty output the
        // server sends the notice ALONE ("Exited with code 1"), and it must not be painted as output.
        const outputIndex = texts.findIndex((text) => text !== '' && !isShellNotice(text));
        const outputText = outputIndex === -1 ? undefined : texts[outputIndex];
        if (outputText !== undefined) {
          sections.push({
            kind: 'code',
            label: 'Output',
            text: stripAnsi(outputText),
            from: 'tail',
          });
        } else if (state.status === 'completed') {
          sections.push({ kind: 'note', text: 'No output.' });
        }
        texts.forEach((text, index) => {
          if (index !== outputIndex && text !== '') sections.push({ kind: 'note', text });
        });
      }
      if (stringAt(state.metadata, 'status') === 'running' && state.status === 'completed') {
        sections.push({ kind: 'note', text: 'Still running in the background.' });
      }
      break;
    }
    case 'read': {
      if (path === undefined) {
        specific = false;
        break;
      }
      if (output !== '') {
        const language = extensionOf(path);
        sections.push({
          kind: 'code',
          label: 'Contents',
          text: output,
          from: 'head',
          ...(language === undefined ? {} : { language }),
        });
      }
      for (const note of outputFiles(part)) sections.push({ kind: 'note', text: note });
      break;
    }
    case 'edit':
    case 'patch': {
      const diffs = diffSections(part);
      if (diffs.length === 0) {
        specific = false;
        break;
      }
      sections.push(...diffs);
      break;
    }
    case 'write': {
      const content = stringAt(input, 'content');
      if (content === undefined) {
        specific = false;
        break;
      }
      const section: BodySection = {
        kind: 'diff',
        label: path ?? 'New file',
        lines: allAdded(content),
      };
      if (path !== undefined) section.path = path;
      sections.push(section);
      break;
    }
    case 'grep': {
      const groups = parseMatches(texts[0] ?? '');
      if (groups.length > 0) sections.push({ kind: 'matches', label: 'Matches', groups });
      else if (output !== '') {
        sections.push({ kind: 'code', label: 'Result', text: output, from: 'head' });
      }
      break;
    }
    case 'glob': {
      const paths = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');
      if (paths.length > 0) sections.push({ kind: 'paths', label: 'Files', paths });
      break;
    }
    case 'webfetch':
    case 'websearch':
    case 'subagent': {
      if (output !== '')
        sections.push({ kind: 'code', label: 'Result', text: output, from: 'head' });
      else if (state.status === 'completed') sections.push({ kind: 'note', text: 'No output.' });
      break;
    }
    default:
      specific = false;
  }
  if (!specific) {
    sections.length = 0;
    sections.push({
      kind: 'code',
      label: 'Input',
      text: JSON.stringify(input, null, 2),
      from: 'head',
      language: 'json',
    });
    if (output !== '') sections.push({ kind: 'code', label: 'Output', text: output, from: 'head' });
    for (const note of outputFiles(part)) sections.push({ kind: 'note', text: note });
  }
  if (state.status === 'error') {
    const outcome = deriveToolOutcome(part);
    if (outcome === undefined && !isStopError(state.error)) {
      sections.push({ kind: 'error', text: errorText(state.error) });
    }
  }
  if (sections.length === 0) {
    sections.push({
      kind: 'note',
      text: state.status === 'running' ? 'Running…' : 'Nothing to show.',
    });
  }
  return sections;
}
