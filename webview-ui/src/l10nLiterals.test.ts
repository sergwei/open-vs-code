import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Guards E11-i18n H7: a visible text added to a webview `.tsx` without `l10n.t` fails here instead
 * of reaching a Spanish user in English.
 *
 * It parses every webview `.tsx` (tests and `testing.tsx` excluded) with the TypeScript compiler and
 * reports three shapes: a `JsxText` with letters, a string literal child (`{'Send'}`), and a
 * literal `aria-label`, `title`, `placeholder` or `alt` attribute. Anything inside an `l10n.t(...)`
 * call is a variable or a call, so it never matches. A text that must stay literal goes in
 * `ALLOWED`, with the reason; there is no per-line escape hatch on purpose.
 *
 * Out of reach, by design: a literal in a `.ts` module (`connectionView.ts` and similar), a text
 * built in a variable and rendered later, and the `label`/`aria-*` props of other attributes. Those
 * are covered by the Spanish cases next to each component and by `scripts/l10n.mjs check`, which
 * keeps the bundle in step with the code.
 *
 * VERIFIED on Windows 11 (04/11/2026) by mutation: with `<span>Hello world</span>` added to
 * `ModBand.tsx`, next to an `aria-label="Close"`, the check "has no visible text outside l10n.t"
 * failed naming that file, the attribute and the text; reverted, the suite passed again. The
 * "finds ..." cases below also run the scanner on fabricated sources, so the guard fails if the
 * scanner itself stops matching. UNVERIFIED on macOS/Linux: only paths are normalized to `/`.
 */

/** Attributes whose literal value is read out or shown to the user. */
const TEXT_ATTRIBUTES = new Set(['aria-label', 'title', 'placeholder', 'alt']);

/**
 * Texts allowed to stay literal. `file` is relative to `webview-ui/src` with `/`. Keep it short:
 * each entry needs a reason a translator would agree with.
 */
const ALLOWED: ReadonlyArray<{ file: string; text: string; reason: string }> = [
  {
    file: 'requests/PermissionCard.tsx',
    text: '.env',
    reason: 'A file name shown as code inside a translated sentence ({env}); it is not prose.',
  },
];

interface Finding {
  readonly kind: 'jsx-text' | 'string-child' | 'attribute';
  readonly text: string;
  readonly line: number;
}

/** True when the text has at least one letter in any script; symbols and punctuation do not count. */
function hasLetters(text: string): boolean {
  return /\p{L}/u.test(text);
}

/**
 * Scans one `.tsx` source and returns the visible literals it renders. Pure: no file access, so
 * the tests can feed it fabricated code.
 */
function findLiterals(fileName: string, source: string): Finding[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Finding[] = [];
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.getText(sf).trim();
      if (hasLetters(text)) found.push({ kind: 'jsx-text', text, line: lineOf(node) });
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      const expr = node.expression;
      if (
        (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) &&
        hasLetters(expr.text)
      ) {
        found.push({ kind: 'string-child', text: expr.text, line: lineOf(node) });
      }
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(sf))) {
      const init = node.initializer;
      const literal =
        init && ts.isStringLiteral(init)
          ? init
          : init &&
              ts.isJsxExpression(init) &&
              init.expression &&
              (ts.isStringLiteral(init.expression) ||
                ts.isNoSubstitutionTemplateLiteral(init.expression))
            ? init.expression
            : undefined;
      if (literal && hasLetters(literal.text)) {
        found.push({ kind: 'attribute', text: literal.text, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * The webview `.tsx` files that render UI (no tests, no `testing.tsx`), as raw text keyed by
 * `./<path>` relative to this folder. Read through Vite like `index.css.test.ts`: the webview
 * tsconfig has no Node types, so no `node:fs`.
 */
const sources = import.meta.glob<string>(['./**/*.tsx', '!./**/*.test.tsx', '!./testing.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('webview visible texts go through l10n.t', () => {
  it('finds a JSX text, a string child and the four literal attributes', () => {
    const source = [
      'export const A = () => (',
      '  <div title="Close" aria-label={"Open"} placeholder={`Type`} alt="Logo">',
      '    Hello world',
      "    {'Send'}",
      '    {l10n.t("Fine")}',
      '    <span>{count()}</span> · <b>42</b>',
      '  </div>',
      ');',
    ].join('\n');
    const kinds = findLiterals('a.tsx', source).map((f) => `${f.kind}:${f.text}`);

    expect(kinds).toContain('attribute:Close');
    expect(kinds).toContain('attribute:Open');
    expect(kinds).toContain('attribute:Logo');
    expect(kinds).toContain('jsx-text:Hello world');
    expect(kinds).toContain('string-child:Send');
    // Symbols, numbers, calls and l10n.t are not findings.
    expect(kinds.join('|')).not.toMatch(/Fine|42|·/);
  });

  it('ignores literals inside l10n.t and non-text attributes', () => {
    const source = 'export const A = () => <div class="row" data-x="y" title={l10n.t("Close")} />;';

    expect(findLiterals('a.tsx', source)).toEqual([]);
  });

  it('has no visible text outside l10n.t', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);

    const problems: string[] = [];
    for (const [key, source] of Object.entries(sources)) {
      const rel = key.replace(/^\.\//, '');
      for (const finding of findLiterals(rel, source)) {
        const allowed = ALLOWED.some((a) => a.file === rel && a.text === finding.text);
        if (!allowed) problems.push(`${rel}:${finding.line} ${finding.kind} "${finding.text}"`);
      }
    }

    expect(problems).toEqual([]);
  });

  it('keeps every allowed literal justified and still present', () => {
    for (const entry of ALLOWED) {
      expect(entry.reason.length).toBeGreaterThan(10);
      const source = sources[`./${entry.file}`];
      expect(source).toBeDefined();
      expect(findLiterals(entry.file, source ?? '').some((f) => f.text === entry.text)).toBe(true);
    }
  });
});
