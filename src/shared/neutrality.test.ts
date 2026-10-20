/**
 * Neutrality guard for `src/shared` (issue #3): every module specifier here must be relative,
 * and production files may not pull in ambient types through triple-slash directives.
 *
 * Exceptions: test files may import `vitest` and `node:fs` (tests run in Node; the ESLint rule of
 * issue #4 will exempt them from the Node built-in ban for the same reason, once it lands). Production files may
 * import nothing but relative modules.
 *
 * Protects against: `import "vscode"`, `@opencode/client`, `node:*` or any other package creeping
 * into the code both the extension host and the webview bundle, and against
 * `/// <reference types="node" />` or `/// <reference lib="dom" />`, which would bring `process`
 * or `document` back. The shared tsconfig cannot catch either: `types: []` blocks ambient
 * globals, but TS still resolves a package import to `node_modules/@types/<pkg>` and honours
 * triple-slash directives (review of 20/10/2026, probed with the compiler API).
 *
 * The sources are read with `node:fs` and NOT with Vite's `import.meta.glob`: the glob needed
 * `/// <reference types="vite/client" />`, which leaked `import.meta.glob`/`env` types into the
 * root typecheck of the host (review of 20/10/2026). This file is skipped by name: its fabricated
 * samples below are string literals that the scanner would flag; it imports only `vitest` and
 * `node:fs`, and the ESLint rule of issue #4 will also cover it once it lands.
 *
 * The scanner is a regex over raw text, not a parser: it is deliberately strict (a specifier
 * inside a comment or string is flagged too) and cannot see specifiers built at runtime. The
 * fabricated samples prove each pattern can fail.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const SELF = 'neutrality.test.ts';

/** Packages a TEST file here may import; production files may import none. */
const TEST_ONLY_PACKAGES = ['vitest', 'node:fs'];

const dir = new URL('./', import.meta.url);
const sources: Record<string, string> = Object.fromEntries(
  readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && name !== SELF)
    .map((name) => [name, readFileSync(new URL(name, dir), 'utf8')]),
);

// Quote classes include the backtick: a template-literal specifier also resolves in TS.
const STATIC_FROM = /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(["'`])([^"'`]+)\1/g;
const SIDE_EFFECT_IMPORT = /\bimport\s*(["'`])([^"'`]+)\1/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(["'`])([^"'`]+)\1/g;
const REQUIRE_CALL = /\brequire\s*\(\s*(["'`])([^"'`]+)\1/g;
// `resolution-mode` (or any attribute) may precede types/lib/path, and TS still honours it.
const TRIPLE_SLASH =
  /^[\uFEFF \t]*\/\/\/\s*<reference\b[^>]*?\b(types|lib|path)\s*=\s*["']([^"']+)["']/gm;

/**
 * Returns every module specifier in `source` that is not relative (`./` or `../`).
 *
 * Covers `import ... from`, `export ... from`, bare `import "x"`, dynamic `import("x")` and
 * `require("x")`, with any whitespace before the parenthesis, single, double or backtick quotes,
 * and regardless of what precedes the keyword on the same line. Not covered: specifiers built at
 * runtime.
 */
function nonRelativeSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const pattern of [STATIC_FROM, SIDE_EFFECT_IMPORT, DYNAMIC_IMPORT, REQUIRE_CALL]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier !== undefined && !specifier.startsWith('./') && !specifier.startsWith('../')) {
        found.push(specifier);
      }
    }
  }
  return found;
}

/**
 * Returns every `/// <reference types|lib|path="..." />` directive in `source`, as `kind:value`.
 *
 * Tolerates a leading BOM and indentation. Production files may not have any of these.
 */
function tripleSlashReferences(source: string): string[] {
  return [...source.matchAll(TRIPLE_SLASH)].map((match) => `${match[1]}:${match[2]}`);
}

describe('src/shared neutrality', () => {
  it('scans the shared sources, tests included (an empty listing would pass vacuously)', () => {
    // Failure mode this guards: a wrong directory or filter returns nothing and the next test passes.
    expect(Object.keys(sources)).toEqual(
      expect.arrayContaining(['model.ts', 'protocol.ts', 'protocol.test.ts']),
    );
  });

  it('imports nothing but relative modules', () => {
    for (const [name, source] of Object.entries(sources)) {
      const allowed = name.endsWith('.test.ts') ? TEST_ONLY_PACKAGES : [];
      const offenders = nonRelativeSpecifiers(source).filter(
        (specifier) => !allowed.includes(specifier),
      );
      expect(offenders, name).toEqual([]);
    }
  });

  it('has no triple-slash reference directives in production files', () => {
    for (const [name, source] of Object.entries(sources)) {
      if (name.endsWith('.test.ts')) continue;
      expect(tripleSlashReferences(source), name).toEqual([]);
    }
  });

  // The samples are FABRICATED: they prove the scanner's logic, not that the sources are clean.
  it.each([
    ['import type { Disposable } from "vscode";', 'vscode'],
    ["import type{X}from'vscode';", 'vscode'],
    ['import * as fs from "node:fs";', 'node:fs'],
    ['export { x } from "@opencode/client";', '@opencode/client'],
    ['export * from "pkg";', 'pkg'],
    ['import "side-effect";', 'side-effect'],
    ['const m = await import("lazy");', 'lazy'],
    ['const m = await import ("spaced");', 'spaced'],
    ['const m = await import(`tpl`);', 'tpl'],
    ['const m = require("cjs");', 'cjs'],
    ['const m = require ("cjs-spaced");', 'cjs-spaced'],
    ['const a = 1; import x from "after-semicolon";', 'after-semicolon'],
    ['/* c */ import x from "after-comment";', 'after-comment'],
    ['\uFEFFimport x from "after-bom";', 'after-bom'],
    ['import {\n  a,\n  b,\n} from "multi-line";', 'multi-line'],
  ])('detects a non-relative specifier in: %s', (sample, specifier) => {
    expect(nonRelativeSpecifiers(sample)).toEqual([specifier]);
  });

  it.each([
    ['/// <reference types="node" />', 'types:node'],
    ['/// <reference lib="dom" />', 'lib:dom'],
    ['\uFEFF/// <reference path="../x.d.ts" />', 'path:../x.d.ts'],
    ['  ///<reference types="vite/client"/>', 'types:vite/client'],
    ['/// <reference resolution-mode="import" types="node" />', 'types:node'],
  ])('detects a triple-slash directive in: %s', (sample, found) => {
    expect(tripleSlashReferences(sample)).toEqual([found]);
  });

  it.each([
    'import type { A } from "./model";',
    'import { b } from "../other";',
    'export type { A } from "./model";',
    'const text = "from somewhere";',
    '// a plain comment, not a directive',
  ])('lets through: %s', (sample) => {
    expect(nonRelativeSpecifiers(sample)).toEqual([]);
    expect(tripleSlashReferences(sample)).toEqual([]);
  });
});
