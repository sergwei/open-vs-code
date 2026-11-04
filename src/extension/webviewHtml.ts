import * as l10n from '@vscode/l10n';
import { randomBytes } from 'node:crypto';
import type { L10nBundle } from '../shared/l10n';

/** Inputs of {@link buildWebviewHtml}. All URIs are already passed through `asWebviewUri`. */
export interface WebviewHtmlOptions {
  /** `webview.cspSource`: the origin the webview serves local resources from. */
  cspSource: string;
  /** Webview URI of the bundled script. */
  scriptUri: string;
  /** Webview URI of the bundled stylesheet. */
  styleUri: string;
  /** Per-resolution nonce from {@link createNonce}. */
  nonce: string;
  /**
   * Where this document lives: the side-bar `view`, an editor `tab` or the `settings` tab.
   * Written as `<meta name="open-vs-code-surface">` so the webview can drop the session picker in
   * a tab (issue #77, E3), or mount the settings root (issue #128, E10), without a new protocol
   * message.
   */
  surface: ChatSurface;
  /**
   * `vscode.env.language`: written as `<html lang>`, and read back by `webview-ui/src/l10nBoot.ts`
   * as the language of the plural rules.
   */
  locale: string;
  /**
   * `vscode.l10n.bundle` (undefined in English): written as `<meta name="open-vs-code-l10n">` so
   * the webview translates before its first render, without a protocol message (decision P2=1 of
   * E11-i18n).
   */
  l10nBundle: L10nBundle | undefined;
}

/**
 * The places the bundle can be shown: the chat in the side-bar `view` or in an editor `tab`, and
 * the OpenCode Settings tab (`settings`, issue #128, E10), whose `index.tsx` mounts another root
 * from this meta.
 */
export type ChatSurface = 'view' | 'tab' | 'settings';

/**
 * Creates a fresh CSP nonce: 16 random bytes, base64 (24 characters).
 *
 * Uses `node:crypto` instead of the `Math.random` of the official sample, since
 * the nonce is what keeps injected scripts out. Must be called once per
 * `resolveWebviewView`, never cached across resolutions.
 * HYPOTHESIS: 128 bits is enough; it matches common CSP guidance, not a VS Code requirement.
 */
export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * Escapes a value for use inside a double-quoted HTML attribute.
 *
 * `Uri.toString()` is assumed to already encode most characters (HYPOTHESIS: not
 * checked against the real class), but the builder does not rely on that: an
 * unescaped `"` would let a value break out of the attribute. Covered by the
 * unit test with fabricated input.
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Builds the HTML document of the chat webview, CSP included.
 *
 * Pure on purpose (no `vscode` import) so Vitest can test it.
 * The policy is `default-src 'none'` with scripts only by nonce: no inline scripts
 * or styles, none of the unsafe keywords, and no network directive because the
 * webview never touches the network (architecture rule 1). `img-src` allows `blob:` for the
 * thumbnails of pasted images (issue #30) and has no `https:`/`data:`: Vite inlines nothing.
 * `script-src` has no `cspSource` because the bundle is a single chunk. The
 * "Loading..." text in `#root` stays visible if the CSP blocks the script,
 * instead of a blank panel; `index.tsx` clears it on mount.
 * HYPOTHESIS: VS Code applies this policy as written; confirm in F5 with the
 * webview developer tools (no "Refused to ..." in the console).
 * `webviewHtml.test.ts` guards the shape of the output with fabricated input; it
 * does not prove that VS Code enforces the policy.
 * The surface meta carries a closed three-value union (`view`, `tab`, `settings`), not free text, and
 * the CSP string is untouched by it (the unit test compares the exact policy for all three). VERIFIED by a full `test:visual` (Windows 11, VS
 * Code 1.144.0, 30/10/2026, 0 FAIL): "ok   B7 the chat in a tab has no Sessions button and keeps
 * New session (surface "tab", Sessions button false, New session true)" and "ok   B7 the chat in
 * the side bar view keeps its Sessions button (surface "view", Sessions button true)".
 * E11-i18n: `<html lang>` carries `locale` and a second meta carries the bundle as JSON, both
 * escaped as attributes. The CSP is untouched because a `<meta>` is not a script. The "Loading..."
 * fallback is translated with the host's `@vscode/l10n` configuration, so it needs `l10nBoot.ts`
 * to have run (it has, as first import of `extension.ts`).
 * VERIFIED by the unit tests "writes lang and the l10n meta, escaped, and the meta round-trips
 * through the parser" (`"`, `<`, `&` and `'` in the bundle, same exact CSP as without a bundle) and
 * "translates the Loading fallback with the configured bundle", both with fabricated input. In a
 * real Spanish window (Windows 11, VS Code 1.145.0, 04/11/2026) `test:visual` step 42 passed "A-wide
 * the chat document says <html lang="es">" and "A-wide the prompt box placeholder is the Spanish
 * one of the catalog", so the `lang` attribute and the meta bundle reach the webview. NOT observed
 * in a real window: the translated "Loading..." fallback and the escaping of a bundle with
 * quotes. UNVERIFIED on macOS and Linux.
 */
export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const { cspSource, nonce } = options;
  const csp = [
    "default-src 'none'",
    // `blob:` is only for the thumbnails of pasted images, URLs the webview makes itself with
    // `URL.createObjectURL` (issue #30, decision Q4 of Sergio). No `data:` and no `https:`.
    `img-src ${cspSource} blob:`,
    `style-src ${cspSource}`,
    `font-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="${escapeAttribute(options.locale)}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="open-vs-code-surface" content="${escapeAttribute(options.surface)}">
  <meta name="open-vs-code-l10n" content="${escapeAttribute(JSON.stringify(options.l10nBundle ?? {}))}">
  <link rel="stylesheet" href="${escapeAttribute(options.styleUri)}">
</head>
<body>
  <div id="root">${escapeAttribute(l10n.t('Loading...'))}</div>
  <script type="module" nonce="${escapeAttribute(nonce)}" src="${escapeAttribute(options.scriptUri)}"></script>
</body>
</html>`;
}
