import { randomBytes } from 'node:crypto';

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
   * Where this document lives: the side-bar `view` or an editor `tab`. Written as
   * `<meta name="open-vs-code-surface">` so the webview can drop the session picker in a tab
   * (issue #77, E3) without a new protocol message.
   */
  surface: ChatSurface;
}

/** The two places a chat webview can live. */
export type ChatSurface = 'view' | 'tab';

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
 * The surface meta carries a closed two-value union, not free text, and the CSP string is untouched
 * by it (the unit test compares the exact policy). VERIFIED by a full `test:visual` (Windows 11, VS
 * Code 1.144.0, 30/10/2026, 0 FAIL): "ok   B7 the chat in a tab has no Sessions button and keeps
 * New session (surface "tab", Sessions button false, New session true)" and "ok   B7 the chat in
 * the side bar view keeps its Sessions button (surface "view", Sessions button true)".
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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="open-vs-code-surface" content="${escapeAttribute(options.surface)}">
  <link rel="stylesheet" href="${escapeAttribute(options.styleUri)}">
</head>
<body>
  <div id="root">Loading...</div>
  <script type="module" nonce="${escapeAttribute(nonce)}" src="${escapeAttribute(options.scriptUri)}"></script>
</body>
</html>`;
}
