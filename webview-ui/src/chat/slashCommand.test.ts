// Protects the text rules of the slash commands (issue #33, decisions P3, P4 and P5 of Sergio,
// 28/10/2026, Engram #1416): the popup opens only for the first word of the draft, the filter puts
// prefixes first, a prompt runs the LONGEST listed name (names may hold `/`, `:` or spaces) and
// anything else is a normal prompt, and choosing a command rewrites only the first token.
//
// Provenance: FABRICATED texts and lists; the names `init` and `review` are the built-in ones read
// in opencode v2.0.32, `docs:search` has the MCP shape. No server was involved.
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  filterCommands,
  findSlash,
  isClientCommand,
  parseCommand,
  withClientCommands,
} from './slashCommand';

const LIST = [
  { name: 'init', description: 'guided AGENTS.md setup' },
  { name: 'review' },
  { name: 'a' },
  { name: 'a/b' },
  { name: 'my cmd' },
  { name: 'docs:search' },
];

describe('findSlash', () => {
  it('opens for a lone slash and for the first word, with the caret inside it', () => {
    expect(findSlash('/', 1)).toEqual({ end: 1, query: '' });
    expect(findSlash('/re', 3)).toEqual({ end: 3, query: 're' });
    expect(findSlash('/review x', 3)).toEqual({ end: 7, query: 're' });
  });

  it('does not open for a slash that is not the first character or a caret past the first word', () => {
    expect(findSlash('a /x', 4)).toBeUndefined();
    expect(findSlash('/init args', 8)).toBeUndefined();
    expect(findSlash('/init ', 6)).toBeUndefined();
    expect(findSlash('hello', 5)).toBeUndefined();
    expect(findSlash('/x', 0)).toBeUndefined();
  });
});

describe('filterCommands', () => {
  it('ignores case, puts prefixes first and keeps the server order inside each group', () => {
    const list = [{ name: 'xreview' }, { name: 'review' }, { name: 'preview' }, { name: 'Rev2' }];
    expect(filterCommands(list, 'REV').map((c) => c.name)).toEqual([
      'review',
      'Rev2',
      'xreview',
      'preview',
    ]);
  });

  // Review S1 (Engram #1423): with `review-pr` listed first, `/review` + Tab picked `review-pr`.
  // Fabricated names; without the `exact` group this fails.
  it('puts a name equal to the query before the longer names that start with it', () => {
    const list = [{ name: 'review-pr' }, { name: 'review' }, { name: 'Review2' }];
    expect(filterCommands(list, 'review').map((c) => c.name)).toEqual([
      'review',
      'review-pr',
      'Review2',
    ]);
  });

  it('returns everything for an empty query and nothing for no match', () => {
    expect(filterCommands(LIST, '')).toBe(LIST);
    expect(filterCommands(LIST, 'zzz')).toEqual([]);
  });
});

describe('parseCommand', () => {
  it('finds an exact name with and without arguments', () => {
    expect(parseCommand('/init', LIST)).toEqual({ name: 'init', args: '' });
    expect(parseCommand('/review  main branch', LIST)).toEqual({
      name: 'review',
      args: 'main branch',
    });
  });

  it('is case-sensitive and does not read /initx as init', () => {
    expect(parseCommand('/Init', LIST)).toBeUndefined();
    expect(parseCommand('/initx', LIST)).toBeUndefined();
  });

  it('takes the longest name among a and a/b', () => {
    expect(parseCommand('/a/b x', LIST)).toEqual({ name: 'a/b', args: 'x' });
    expect(parseCommand('/a x', LIST)).toEqual({ name: 'a', args: 'x' });
  });

  it('supports names with a space or a colon', () => {
    expect(parseCommand('/my cmd Ana', LIST)).toEqual({ name: 'my cmd', args: 'Ana' });
    expect(parseCommand('/docs:search foo', LIST)).toEqual({ name: 'docs:search', args: 'foo' });
  });

  it('runs nothing for an unknown name, plain text or an absent list', () => {
    expect(parseCommand('/unknown x', LIST)).toBeUndefined();
    expect(parseCommand('hello /init', LIST)).toBeUndefined();
    expect(parseCommand('/init', undefined)).toBeUndefined();
    expect(parseCommand('/init', [])).toBeUndefined();
  });
});

// Issue #125 (decision P1=1): `/compact` is a client command that the server does not list.
describe('client commands', () => {
  it('appends compact after the server commands', () => {
    expect(withClientCommands(LIST)?.map((c) => c.name)).toEqual([
      ...LIST.map((c) => c.name),
      'compact',
    ]);
    expect(withClientCommands([])?.map((c) => c.name)).toEqual(['compact']);
  });

  it('does not duplicate a compact the server lists, which then runs as the server command', () => {
    const served = [{ name: 'compact', description: 'mine' }];
    expect(withClientCommands(served)).toEqual(served);
    expect(isClientCommand('compact', served)).toBe(false);
    expect(isClientCommand('compact', LIST)).toBe(true);
    expect(isClientCommand('init', LIST)).toBe(false);
  });

  it('keeps an absent list absent, so "loading" and "could not be loaded" still show', () => {
    expect(withClientCommands(undefined)).toBeUndefined();
    expect(isClientCommand('compact', undefined)).toBe(true);
  });

  it('lets parseCommand recognise /compact once it is in the list', () => {
    expect(parseCommand('/compact', withClientCommands(LIST))).toEqual({
      name: 'compact',
      args: '',
    });
    expect(parseCommand('/compact', LIST)).toBeUndefined();
  });
});

describe('applyCommand', () => {
  it('writes the command and a space into an empty draft', () => {
    expect(applyCommand('', 'init')).toEqual({ text: '/init ', caret: 6 });
  });

  it('replaces the first token of a draft that starts with another command, keeping its arguments', () => {
    expect(applyCommand('/re', 'review')).toEqual({ text: '/review ', caret: 8 });
    expect(applyCommand('/other some args', 'init')).toEqual({ text: '/init some args', caret: 6 });
  });

  it('keeps a normal text as the arguments', () => {
    expect(applyCommand('hola', 'init')).toEqual({ text: '/init hola', caret: 6 });
  });
});
