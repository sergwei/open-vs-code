/**
 * Recognises file references in model text (issue #15): `src/a.ts`, `src/a.ts:42`,
 * `src/a.ts:42:7` and `src/a.ts#L10`. PURE (no DOM), shared by the Markdown renderer.
 */

/** A file reference: the path as written, and an optional 1-based line and column. */
export interface FileRef {
  path: string;
  line?: number;
  column?: number;
}

/**
 * Extensions accepted for a bare name with no directory (`README.md`, `index.ts`).
 *
 * Our own list, chosen to keep `console.log`, `e.g` or `Foo.Bar` from being turned into links:
 * with a directory separator any extension is enough (`src/a.xyz`), but without one the name has
 * to look like a file people actually open. Missing an extension only costs a plain `<code>`.
 */
const BARE_NAME_EXTENSIONS = new Set([
  'c',
  'cc',
  'cjs',
  'conf',
  'cpp',
  'cs',
  'css',
  'csv',
  'go',
  'h',
  'hpp',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsonc',
  'jsx',
  'kt',
  'lock',
  'md',
  'mjs',
  'mts',
  'php',
  'ps1',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'svelte',
  'toml',
  'ts',
  'tsx',
  'txt',
  'vue',
  'xml',
  'yaml',
  'yml',
]);

/** `scheme://...`: a URL, never a file reference. */
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Characters a path never contains in this context (also stops HTML-ish or glob text). */
const FORBIDDEN_CHARS = /[<>|"*?\0`]/;

/** `path`, optionally followed by `:line`, `:line:col` or `#Lline` (`#L10-L20` keeps the first). */
const REF_SHAPE = /^(.+?)(?::(\d+)(?::(\d+))?|#L(\d+)(?:-L?\d+)?)?$/;

/**
 * Parses `text` as a file reference, or returns `undefined` when it is not one.
 *
 * Accepts a relative path, a `./`-prefixed one and a Windows drive path (`C:\ws\a.ts:3`).
 * Rejects URLs, anything with whitespace, a trailing separator (a directory) and a name with no
 * separator unless its extension is in {@link BARE_NAME_EXTENSIONS}. A line or column of 0, or
 * one that is not a safe integer, is dropped as if absent, never kept as 0 (the protocol wants
 * 1-based positions). VERIFIED by `fileRefs.test.ts` with hand-written strings (synthetic); what
 * models actually write in backticks was not sampled, so the extension list is a guess.
 */
export function parseFileRef(text: string): FileRef | undefined {
  const trimmed = text.trim();
  if (trimmed === '' || /\s/.test(trimmed) || URL_LIKE.test(trimmed)) return undefined;
  if (FORBIDDEN_CHARS.test(trimmed)) return undefined;
  const match = REF_SHAPE.exec(trimmed);
  if (match === null) return undefined;
  const path = match[1];
  if (path === undefined || path.endsWith('/') || path.endsWith('\\')) return undefined;

  const lastSegment = path.split(/[\\/]/).pop() ?? '';
  const extension = /\.([A-Za-z][A-Za-z0-9]*)$/.exec(lastSegment)?.[1];
  if (extension === undefined) return undefined;
  const hasSeparator = /[\\/]/.test(path);
  if (!hasSeparator && !BARE_NAME_EXTENSIONS.has(extension.toLowerCase())) return undefined;

  const toPosition = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 1 ? number : undefined;
  };
  const line = toPosition(match[2] ?? match[4]);
  const column = line === undefined ? undefined : toPosition(match[3]);
  return {
    path,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}
