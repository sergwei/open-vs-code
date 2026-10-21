/**
 * Turns Markdown from the model into HTML that is safe to put in `innerHTML` (issue #15), and
 * code into highlighted HTML.
 *
 * The text comes from an LLM that reads arbitrary files, so it is hostile input. Three layers
 * (plan `E2-mvp-prototype/plan-fase2` §3), none trusted on its own:
 *  1. our `marked` renderer: raw HTML is escaped as text, images become `[image: alt]`, links keep
 *     `href` only for `http:`, `https:` and `mailto:`, a relative link or a path-shaped inline
 *     code becomes a file reference (see below);
 *  2. DOMPurify with an explicit tag/attribute whitelist, no `style`, and a hook that re-checks
 *     `href` and adds `rel`;
 *  3. the CSP of the webview (`webviewHtml.ts`), which blocks inline script and style and remote
 *     images anyway.
 *
 * File references are NOT anchors: VS Code forwards the click on any `<a href>` to its own link
 * opener (`handleInnerClick` in the workbench webview `index.html`, read on the `main` branch,
 * not on 1.105 - HYPOTHESIS that it is the same there), so a `file:` or relative `href` would
 * reach the opener behind our back. They are `<code class="file-ref" role="link" tabindex="0">`
 * with `data-path/line/column`, and `Markdown.tsx` handles the click and Enter.
 */
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { Marked, type Tokens } from 'marked';
import { parseFileRef, type FileRef } from './fileRefs';
import { toHighlightLanguage } from './languageIds';

const LANGUAGES = {
  bash,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  markdown,
  powershell,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};
for (const [name, definition] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, definition);

/** Escapes the five characters that matter in HTML text and in a double-quoted attribute. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Inverse of {@link escapeHtml}, for the escaped `text` that `marked` puts in a code span. */
function unescapeHtml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

/** `href`s that survive: absolute web links and mail. Everything else is plain text. */
const SAFE_HREF = /^(?:https?:|mailto:)/i;

/** A relative reference: no scheme (`name:`), not protocol-relative (`//`) and not an anchor. */
function isRelativeHref(href: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//') && !href.startsWith('#');
}

/** The `<code>` of a file reference; `inner` is HTML that is already safe. */
function fileRefElement(ref: FileRef, inner: string): string {
  const line = ref.line === undefined ? '' : ` data-line="${String(ref.line)}"`;
  const column = ref.column === undefined ? '' : ` data-column="${String(ref.column)}"`;
  return `<code class="file-ref" role="link" tabindex="0" data-path="${escapeHtml(ref.path)}"${line}${column}>${inner}</code>`;
}

/**
 * A `marked` instance of our own (not the global one), so nobody else's `use()` affects us.
 *
 * `breaks: true`: a single newline inside a paragraph becomes `<br>`. Models write line-oriented
 * replies (addresses, short lists without markers) and plain CommonMark folded them into one line
 * (CDP run of 20/10/2026). It only changes inline rendering of paragraph text: lists, tables and
 * fenced code are block constructs and are lexed the same (`visualFixes.test.tsx`, "single
 * newlines in Markdown", checks it).
 * The block splitter of the streaming path (`markdownStream.ts`) has its own lexer and is not
 * affected.
 */
const mdParser = new Marked({ gfm: true, breaks: true, async: false });
mdParser.use({
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag): string {
      // Raw HTML from the model is shown, not run.
      const text = escapeHtml(token.text);
      return token.block ? `<p>${text}</p>\n` : text;
    },
    image(token: Tokens.Image): string {
      return escapeHtml(`[image: ${token.text}]`);
    },
    link(token: Tokens.Link): string {
      // A link whose text is a path in backticks must not nest a second file reference: the
      // href wins, so the text is rendered plain (nested clickable code would open the wrong file).
      const inner = this.parser
        .parseInline(token.tokens)
        .replace(/<code class="file-ref"[^>]*>([\s\S]*?)<\/code>/g, '<code>$1</code>');
      if (SAFE_HREF.test(token.href)) {
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        return `<a href="${escapeHtml(token.href)}"${title}>${inner}</a>`;
      }
      if (isRelativeHref(token.href)) {
        let decoded = token.href;
        try {
          decoded = decodeURI(token.href);
        } catch {
          // Malformed escape: keep it as written.
        }
        const ref = parseFileRef(decoded);
        if (ref !== undefined) return fileRefElement(ref, inner);
      }
      return inner;
    },
    codespan(token: Tokens.Codespan): string {
      // `marked` already escaped `token.text`; the shape check needs the original characters.
      const ref = parseFileRef(unescapeHtml(token.text));
      return ref === undefined ? `<code>${token.text}</code>` : fileRefElement(ref, token.text);
    },
  },
});

/** Tags a reply may use. No `img`, `svg`, `iframe`, `form`, `style`, `script`, `button`. */
const ALLOWED_TAGS = [
  'a',
  'p',
  'br',
  'hr',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
  'div',
  'input',
];

/** Attributes a reply may use. `style` and every `on*` are out; `rel` is added by the hook. */
const ALLOWED_ATTR = [
  'href',
  'title',
  'class',
  'align',
  'data-path',
  'data-line',
  'data-column',
  'role',
  'tabindex',
  'start',
  'type',
  'checked',
  'disabled',
];

/**
 * DOMPurify checks the VALUE of every attribute that is not "URI safe" against the allowed-URI
 * pattern, so with our strict pattern `data-line="42"` or `align="left"` would be dropped.
 * These are listed as URI-safe on purpose; `href` is the only attribute that stays under the
 * pattern, plus the hook below.
 */
const URI_SAFE_ATTR = [
  'align',
  'data-path',
  'data-line',
  'data-column',
  'tabindex',
  'start',
  'type',
  'checked',
  'disabled',
];

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName !== 'A') return;
  const href = node.getAttribute('href');
  if (href === null || !SAFE_HREF.test(href.trim())) {
    node.removeAttribute('href');
    return;
  }
  node.setAttribute('rel', 'noopener noreferrer');
  node.removeAttribute('target');
});

/** Sanitizes the HTML of a Markdown reply with the whitelist above. */
function sanitizeMarkdown(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_URI_SAFE_ATTR: URI_SAFE_ATTR,
    ALLOWED_URI_REGEXP: SAFE_HREF,
    FORBID_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_TRUSTED_TYPE: false,
  });
}

/** Sanitizes the output of highlight.js: only `span` with a `class`. */
function sanitizeHighlight(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['span'],
    ALLOWED_ATTR: ['class'],
    RETURN_TRUSTED_TYPE: false,
  });
}

/** Size of the render caches. Our own figure: a long chat holds a few hundred blocks. */
const CACHE_SIZE = 200;

/** A bounded `string -> string` cache that evicts the least recently used entry. */
class Lru {
  private readonly entries = new Map<string, string>();

  /** Returns the cached value and marks it most recently used, or `undefined`. */
  get(key: string): string | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  /** Stores `value`, evicting the least recently used entry beyond {@link CACHE_SIZE}. */
  set(key: string, value: string): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > CACHE_SIZE) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }
}

const markdownCache = new Lru();

/**
 * Renders GFM Markdown to sanitized HTML, memoized by source text (a closed block is rendered
 * again whenever a component is rebuilt, e.g. after the view is shown again).
 *
 * VERIFIED against a battery of XSS vectors by `renderMarkdown.test.ts` in jsdom (synthetic
 * inputs, DOMPurify 3.4.x, run on Windows 11): no script, handler, `style`, image, frame or
 * non-web `href` survives. NOT verified: the same vectors in the real webview iframe (F5).
 */
export function renderMarkdown(source: string): string {
  const cached = markdownCache.get(source);
  if (cached !== undefined) return cached;
  const html = sanitizeMarkdown(mdParser.parse(source, { async: false }));
  markdownCache.set(source, html);
  return html;
}

/**
 * Highlights `code` for the fence label `fence`, as sanitized HTML with `hljs-*` classes (the
 * CSS maps them to `--vscode-*` variables; there is no inline style).
 *
 * A label we did not register, or none, gives the code escaped as plain text: no
 * `highlightAuto`, which guesses wrongly on short snippets and costs more. Only call it for a
 * CLOSED fence; a fence still being written is shown as text by the component. highlight.js
 * never throws with `ignoreIllegals`, but a failure is caught anyway and falls back to text.
 */
export function highlightCode(code: string, fence: string | undefined): string {
  const language = toHighlightLanguage(fence);
  if (language === undefined) return escapeHtml(code);
  try {
    return sanitizeHighlight(hljs.highlight(code, { language, ignoreIllegals: true }).value);
  } catch {
    return escapeHtml(code);
  }
}
